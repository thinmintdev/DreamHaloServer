import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw, ExternalLink, X, GitBranch } from 'lucide-react'
import { getServiceUrl } from '../utils/serviceUrls'

const POLL_INTERVAL = 10000
const HOVER_DELAY = 200

// Layout constants
const NODE_W = 160
const NODE_H = 56
const LAYER_GAP_Y = 160
const NODE_GAP_X = 36
const MAX_OTHER_ROW = 5
const OTHER_SUB_GAP = 90

// Core at top — arrows flow upward (user-facing → middleware → core)
const LAYER_ORDER = ['core', 'middleware', 'user-facing', 'other']

const STATUS_COLORS = {
  healthy:      { bg: '#22c55e', dot: 'bg-green-400',  text: 'text-green-400' },
  degraded:     { bg: '#eab308', dot: 'bg-yellow-400', text: 'text-yellow-400' },
  unhealthy:    { bg: '#ef4444', dot: 'bg-red-400',    text: 'text-red-400' },
  down:         { bg: '#ef4444', dot: 'bg-red-400',    text: 'text-red-400' },
  not_deployed: { bg: '#6b7280', dot: 'bg-zinc-500',   text: 'text-zinc-500' },
  unknown:      { bg: '#6b7280', dot: 'bg-zinc-500',   text: 'text-zinc-500' },
}

// Edge type colors — each connection type has its own color
const EDGE_TYPE = {
  'inference':     { color: '#a855f7', label: 'Inference',     markerId: 'em-inference' },
  'LLM proxy':     { color: '#3b82f6', label: 'LLM Proxy',     markerId: 'em-llm-proxy' },
  'search':        { color: '#f97316', label: 'Search',         markerId: 'em-search' },
  'vector store':  { color: '#06b6d4', label: 'Vector Store',  markerId: 'em-vector-store' },
  'embeddings':    { color: '#14b8a6', label: 'Embeddings',    markerId: 'em-embeddings' },
  'voice input':   { color: '#ec4899', label: 'Voice',         markerId: 'em-voice' },
  'voice output':  { color: '#ec4899', label: 'Voice',         markerId: 'em-voice' },
  'API':           { color: '#6366f1', label: 'API',            markerId: 'em-api' },
  'intercept':     { color: '#f59e0b', label: 'Intercept',     markerId: 'em-intercept' },
  'observability': { color: '#84cc16', label: 'Observability', markerId: 'em-observability' },
  'privacy':       { color: '#f43f5e', label: 'Privacy',        markerId: 'em-privacy' },
}
const EDGE_DEFAULT = { color: '#6b7280', label: 'Other', markerId: 'em-default' }

const MARKER_DEFS = [
  { id: 'em-inference',     color: '#a855f7' },
  { id: 'em-llm-proxy',     color: '#3b82f6' },
  { id: 'em-search',        color: '#f97316' },
  { id: 'em-vector-store',  color: '#06b6d4' },
  { id: 'em-embeddings',    color: '#14b8a6' },
  { id: 'em-voice',         color: '#ec4899' },
  { id: 'em-api',           color: '#6366f1' },
  { id: 'em-intercept',     color: '#f59e0b' },
  { id: 'em-observability', color: '#84cc16' },
  { id: 'em-privacy',       color: '#f43f5e' },
  { id: 'em-default',       color: '#6b7280' },
]

function edgeMeta(label) {
  return EDGE_TYPE[label] || EDGE_DEFAULT
}

// ---------------------------------------------------------------------------
// Barycenter heuristic — orders nodes within each layer to minimize
// edge crossings between layers.  Disconnected nodes float to the end.
// ---------------------------------------------------------------------------
function smartOrder(nodes, edges) {
  const layers = {}
  for (const layer of LAYER_ORDER) layers[layer] = []
  for (const node of nodes) {
    const cat = LAYER_ORDER.includes(node.category) ? node.category : 'other'
    layers[cat].push(node)
  }
  // Alphabetical baseline
  for (const layer of LAYER_ORDER) {
    layers[layer].sort((a, b) => a.name.localeCompare(b.name))
  }

  const nodeLayer = {}
  for (const node of nodes) {
    nodeLayer[node.id] = LAYER_ORDER.includes(node.category) ? node.category : 'other'
  }
  const crossAdj = {}
  for (const edge of edges) {
    if (nodeLayer[edge.source] !== nodeLayer[edge.target]) {
      if (!crossAdj[edge.source]) crossAdj[edge.source] = []
      if (!crossAdj[edge.target]) crossAdj[edge.target] = []
      crossAdj[edge.source].push(edge.target)
      crossAdj[edge.target].push(edge.source)
    }
  }

  for (let pass = 0; pass < 4; pass++) {
    const posIdx = {}
    for (const layer of LAYER_ORDER) {
      layers[layer].forEach((n, i) => { posIdx[n.id] = i })
    }
    for (const layer of LAYER_ORDER) {
      const row = layers[layer]
      if (row.length <= 1) continue
      for (const node of row) {
        const nbrs = crossAdj[node.id]
        node._bary = (nbrs && nbrs.length > 0)
          ? nbrs.reduce((s, id) => s + (posIdx[id] ?? 0), 0) / nbrs.length
          : Infinity
      }
      row.sort((a, b) => {
        if (a._bary !== b._bary) return a._bary - b._bary
        return a.name.localeCompare(b.name)
      })
    }
  }

  return layers
}

// ---------------------------------------------------------------------------
// Layout — positions each node.  "other" row wraps at MAX_OTHER_ROW.
// ---------------------------------------------------------------------------
function computeLayout(nodes, edges) {
  const layers = smartOrder(nodes, edges)
  const subRows = []
  let maxRowWidth = 0

  for (const layer of LAYER_ORDER) {
    const row = layers[layer]
    if (row.length === 0) continue
    if (layer === 'other' && row.length > MAX_OTHER_ROW) {
      for (let i = 0; i < row.length; i += MAX_OTHER_ROW) {
        const chunk = row.slice(i, i + MAX_OTHER_ROW)
        subRows.push({ layer, nodes: chunk, isFirst: i === 0 })
        const rw = chunk.length * NODE_W + (chunk.length - 1) * NODE_GAP_X
        if (rw > maxRowWidth) maxRowWidth = rw
      }
    } else {
      subRows.push({ layer, nodes: row, isFirst: true })
      const rw = row.length * NODE_W + (row.length - 1) * NODE_GAP_X
      if (rw > maxRowWidth) maxRowWidth = rw
    }
  }

  const PADDING = 60
  const svgWidth = Math.max(maxRowWidth + PADDING * 2, 800)
  const positions = {}
  const layerLabelY = {}
  let currentY = 50

  for (let i = 0; i < subRows.length; i++) {
    const sr = subRows[i]
    const rowWidth = sr.nodes.length * NODE_W + (sr.nodes.length - 1) * NODE_GAP_X
    const startX = (svgWidth - rowWidth) / 2
    for (let j = 0; j < sr.nodes.length; j++) {
      positions[sr.nodes[j].id] = { x: startX + j * (NODE_W + NODE_GAP_X), y: currentY }
    }
    if (sr.isFirst) layerLabelY[sr.layer] = currentY

    const next = subRows[i + 1]
    currentY += (next && next.layer === sr.layer) ? OTHER_SUB_GAP : LAYER_GAP_Y
  }

  const nodeLayerMap = {}
  for (const node of nodes) {
    nodeLayerMap[node.id] = LAYER_ORDER.includes(node.category) ? node.category : 'other'
  }

  return { positions, svgWidth, svgHeight: currentY + 30, layerLabelY, nodeLayerMap }
}

// Spread port x-positions evenly across a node's width
function spreadX(nodePos, count, index) {
  const margin = 18
  const usable = NODE_W - margin * 2
  if (count <= 1) return nodePos.x + NODE_W / 2
  return nodePos.x + margin + (index / (count - 1)) * usable
}

// ---------------------------------------------------------------------------
// Port computation — places connection dots on the node edge closest to
// the connected peer.  Ports sharing an edge are spread left-to-right
// ordered by the peer's x-position.
// ---------------------------------------------------------------------------
function computePorts(edges, positions, nodeLayerMap) {
  const nodeTop = {}
  const nodeBottom = {}

  for (const edge of edges) {
    const sp = positions[edge.source]
    const tp = positions[edge.target]
    if (!sp || !tp) continue

    const sameLayer = nodeLayerMap[edge.source] === nodeLayerMap[edge.target]

    if (sameLayer) {
      ;(nodeBottom[edge.source] ??= []).push({ edge, role: 'source' })
      ;(nodeTop[edge.target] ??= []).push({ edge, role: 'target' })
    } else if (tp.y < sp.y) {
      ;(nodeTop[edge.source] ??= []).push({ edge, role: 'source' })
      ;(nodeBottom[edge.target] ??= []).push({ edge, role: 'target' })
    } else {
      ;(nodeBottom[edge.source] ??= []).push({ edge, role: 'source' })
      ;(nodeTop[edge.target] ??= []).push({ edge, role: 'target' })
    }
  }

  const ports = {}

  const assignPorts = (nodePorts, side) => {
    for (const [nodeId, list] of Object.entries(nodePorts)) {
      const pos = positions[nodeId]
      if (!pos) continue
      list.sort((a, b) => {
        const ax = positions[a.role === 'source' ? a.edge.target : a.edge.source]?.x ?? 0
        const bx = positions[b.role === 'source' ? b.edge.target : b.edge.source]?.x ?? 0
        return ax - bx
      })
      const y = side === 'top' ? pos.y : pos.y + NODE_H
      list.forEach((item, i) => {
        const k = `${item.edge.source}-${item.edge.target}`
        if (!ports[k]) ports[k] = { sameLayer: false }
        const px = spreadX(pos, list.length, i)
        if (item.role === 'source') { ports[k].sx = px; ports[k].sy = y }
        else                        { ports[k].tx = px; ports[k].ty = y }
        if (nodeLayerMap[item.edge.source] === nodeLayerMap[item.edge.target]) {
          ports[k].sameLayer = true
        }
      })
    }
  }

  assignPorts(nodeTop, 'top')
  assignPorts(nodeBottom, 'bottom')

  return ports
}

// ---------------------------------------------------------------------------
// Orthogonal elbow paths
// ---------------------------------------------------------------------------
function elbowPath(sx, sy, tx, ty, sameLayer) {
  if (sameLayer) {
    const loopY = Math.max(sy, ty) + 28
    return `M ${sx} ${sy} L ${sx} ${loopY} L ${tx} ${loopY} L ${tx} ${ty}`
  }
  const midY = (sy + ty) / 2
  return `M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`
}

// ---------------------------------------------------------------------------
// Hover highlight — builds the set of active node IDs and edge keys
// ---------------------------------------------------------------------------
function buildActiveSet(hoveredTarget, edges) {
  const activeNodeIds = new Set()
  const activeEdgeKeys = new Set()

  if (!hoveredTarget) return { activeNodeIds, activeEdgeKeys }

  if (hoveredTarget.type === 'node') {
    activeNodeIds.add(hoveredTarget.id)
    for (const edge of edges) {
      if (edge.source === hoveredTarget.id || edge.target === hoveredTarget.id) {
        activeEdgeKeys.add(`${edge.source}-${edge.target}`)
        activeNodeIds.add(edge.source)
        activeNodeIds.add(edge.target)
      }
    }
  } else {
    activeEdgeKeys.add(hoveredTarget.id)
    const edge = edges.find(e => `${e.source}-${e.target}` === hoveredTarget.id)
    if (edge) {
      activeNodeIds.add(edge.source)
      activeNodeIds.add(edge.target)
    }
  }

  return { activeNodeIds, activeEdgeKeys }
}

// ---------------------------------------------------------------------------
// SVG sub-components
// ---------------------------------------------------------------------------

function EdgeLayer({ edges, ports, activeEdgeKeys, hasActiveHover, onHoverStart, onHoverEnd }) {
  return (
    <>
      {edges.map(edge => {
        const k = `${edge.source}-${edge.target}`
        const p = ports[k]
        if (!p?.sx || !p?.tx) return null

        const { color, markerId } = edgeMeta(edge.label)
        const isDegraded = edge.status !== 'healthy'
        const d = elbowPath(p.sx, p.sy, p.tx, p.ty, p.sameLayer)

        const isHighlighted = activeEdgeKeys.has(k)
        const isDimmed = hasActiveHover && !isHighlighted
        const baseOpacity = isDegraded ? 0.3 : 0.65

        return (
          <g key={k}>
            {/* Wide invisible hit area for hover detection */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={14}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => onHoverStart('edge', k)}
              onMouseLeave={onHoverEnd}
            />
            <g
              pointerEvents="none"
              style={{ opacity: isDimmed ? 0.12 : 1, transition: 'opacity 0.3s ease' }}
            >
              {/* Dark halo for contrast */}
              <path d={d} fill="none" stroke="#09090b" strokeWidth={isHighlighted ? 6 : 4} strokeOpacity={0.8} />
              {/* Pulsing glow layer when highlighted */}
              {isHighlighted && (
                <path
                  d={d}
                  fill="none"
                  stroke={color}
                  strokeWidth={8}
                  className="pulse-glow"
                  filter="url(#edge-glow)"
                />
              )}
              {/* Main colored line */}
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeWidth={isHighlighted ? 2.5 : 1.75}
                strokeOpacity={isHighlighted ? 1 : baseOpacity}
                strokeDasharray={isDegraded ? '5 4' : undefined}
                markerEnd={`url(#${markerId})`}
              />
            </g>
          </g>
        )
      })}
    </>
  )
}

// Port dots — rendered last so connection points sit above everything
function PortDots({ edges, ports, activeEdgeKeys, hasActiveHover }) {
  return (
    <>
      {edges.map(edge => {
        const k = `${edge.source}-${edge.target}`
        const p = ports[k]
        if (!p?.sx || !p?.tx) return null

        const { color } = edgeMeta(edge.label)
        const isHighlighted = activeEdgeKeys.has(k)
        const isDimmed = hasActiveHover && !isHighlighted
        const r = isHighlighted ? 5 : 4

        return (
          <g
            key={k}
            pointerEvents="none"
            style={{ opacity: isDimmed ? 0.12 : 1, transition: 'opacity 0.3s ease' }}
          >
            <circle cx={p.sx} cy={p.sy} r={r} fill={color} fillOpacity={0.9} stroke="#09090b" strokeWidth={1.5} />
            <circle cx={p.tx} cy={p.ty} r={r} fill={color} fillOpacity={0.9} stroke="#09090b" strokeWidth={1.5} />
          </g>
        )
      })}
    </>
  )
}

function ServiceNode({ node, pos, onClick, isSelected, isHighlighted, isDimmed, onHoverStart, onHoverEnd }) {
  const colors = STATUS_COLORS[node.status] || STATUS_COLORS.unknown

  return (
    <g
      onClick={() => onClick(node)}
      onMouseEnter={() => onHoverStart('node', node.id)}
      onMouseLeave={onHoverEnd}
      style={{
        cursor: 'pointer',
        opacity: isDimmed ? 0.25 : 1,
        transition: 'opacity 0.3s ease',
      }}
    >
      {/* Pulsing highlight border */}
      {isHighlighted && (
        <rect
          x={pos.x - 4} y={pos.y - 4}
          width={NODE_W + 8} height={NODE_H + 8}
          rx={15}
          fill="none" stroke={colors.bg} strokeWidth={2}
          className="pulse-glow"
          filter="url(#edge-glow)"
        />
      )}
      {isSelected && (
        <rect
          x={pos.x - 3} y={pos.y - 3}
          width={NODE_W + 6} height={NODE_H + 6}
          rx={14}
          fill="none" stroke={colors.bg} strokeWidth={2} strokeOpacity={0.5}
        />
      )}
      <rect
        x={pos.x} y={pos.y}
        width={NODE_W} height={NODE_H}
        rx={12}
        className="fill-zinc-900 stroke-zinc-700"
        strokeWidth={1}
        filter="url(#node-shadow)"
      />
      {/* Status indicator */}
      <circle cx={pos.x + 14} cy={pos.y + NODE_H / 2 - 6} r={4} fill={colors.bg} />
      {/* Name */}
      <text
        x={pos.x + 24} y={pos.y + NODE_H / 2 - 2}
        className="fill-zinc-100"
        style={{ fontSize: '12px', fontWeight: 600 }}
      >
        {node.name.length > 14 ? node.name.slice(0, 13) + '\u2026' : node.name}
      </text>
      {/* Port */}
      <text
        x={pos.x + 14} y={pos.y + NODE_H / 2 + 14}
        className="fill-zinc-500"
        style={{ fontSize: '10px', fontFamily: 'monospace' }}
      >
        :{node.port}
      </text>
      {/* Status label */}
      <text
        x={pos.x + NODE_W - 10} y={pos.y + NODE_H / 2 + 14}
        textAnchor="end"
        style={{ fontSize: '9px', fill: colors.bg }}
      >
        {node.status}
      </text>
    </g>
  )
}

function DetailPanel({ node, edges, onClose }) {
  if (!node) return null

  const colors = STATUS_COLORS[node.status] || STATUS_COLORS.unknown
  const upstream   = edges.filter(e => e.target === node.id).map(e => ({ id: e.source, label: e.label }))
  const downstream = edges.filter(e => e.source === node.id).map(e => ({ id: e.target, label: e.label }))
  const serviceUrl = node.port ? getServiceUrl(node.port) : null

  return (
    <div className="absolute top-4 right-4 w-72 bg-theme-card border border-theme-border rounded-xl shadow-2xl z-10 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-theme-border">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
          <span className="text-theme-text font-semibold text-sm">{node.name}</span>
        </div>
        <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="px-4 py-3 space-y-3 text-xs">
        <div className="flex justify-between">
          <span className="text-theme-text-muted">Status</span>
          <span className={colors.text}>{node.status}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-theme-text-muted">Port</span>
          <span className="text-theme-text font-mono">{node.port}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-theme-text-muted">Layer</span>
          <span className="text-theme-text">{node.category}</span>
        </div>

        {upstream.length > 0 && (
          <div>
            <span className="text-theme-text-muted block mb-1">Used by:</span>
            <div className="space-y-1">
              {upstream.map(u => {
                const { color } = edgeMeta(u.label)
                return (
                  <div key={u.id} className="flex items-center gap-1.5 text-theme-text">
                    <span style={{ color, fontSize: '10px' }}>●</span>
                    {u.id}
                    <span className="text-theme-text-muted ml-auto">({u.label})</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {downstream.length > 0 && (
          <div>
            <span className="text-theme-text-muted block mb-1">Depends on:</span>
            <div className="space-y-1">
              {downstream.map(d => {
                const { color } = edgeMeta(d.label)
                return (
                  <div key={d.id} className="flex items-center gap-1.5 text-theme-text">
                    <span style={{ color, fontSize: '10px' }}>●</span>
                    {d.id}
                    <span className="text-theme-text-muted ml-auto">({d.label})</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {serviceUrl && (
          <a
            href={serviceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-theme-accent hover:underline mt-2"
          >
            <ExternalLink size={12} />
            Open service
          </a>
        )}
      </div>
    </div>
  )
}

export default function ServiceMap() {
  const [topology, setTopology] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const fetchInFlight = useRef(false)

  // Hover highlight state — activates after HOVER_DELAY ms of sustained hover
  const [hoveredTarget, setHoveredTarget] = useState(null)
  const [activeHover, setActiveHover] = useState(false)
  const hoverTimerRef = useRef(null)

  const handleHoverStart = useCallback((type, id) => {
    setHoveredTarget({ type, id })
    setActiveHover(false)
    clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setActiveHover(true), HOVER_DELAY)
  }, [])

  const handleHoverEnd = useCallback(() => {
    clearTimeout(hoverTimerRef.current)
    setHoveredTarget(null)
    setActiveHover(false)
  }, [])

  useEffect(() => {
    return () => clearTimeout(hoverTimerRef.current)
  }, [])

  const fetchTopology = useCallback(async () => {
    if (document.hidden) return
    if (fetchInFlight.current) return
    fetchInFlight.current = true
    try {
      const res = await fetch('/api/services/topology')
      if (!res.ok) throw new Error('Failed to fetch topology')
      const data = await res.json()
      setTopology(data)
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      fetchInFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTopology()
    const interval = setInterval(fetchTopology, POLL_INTERVAL)
    const onVisibility = () => { if (!document.hidden) fetchTopology() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchTopology])

  if (loading) {
    return (
      <div className="p-8 animate-pulse">
        <div className="h-8 bg-theme-card rounded w-1/3 mb-6" />
        <div className="h-96 bg-theme-card rounded-xl" />
      </div>
    )
  }

  if (error || !topology) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm">
          <span className="text-red-400 shrink-0">!</span>
          <div>
            <p className="text-theme-text font-medium">Topology data unavailable</p>
            <p className="text-theme-text-muted mt-0.5">{error || 'No topology data returned.'}</p>
          </div>
        </div>
      </div>
    )
  }

  const { nodes, edges } = topology
  const { positions, svgWidth, svgHeight, layerLabelY, nodeLayerMap } = computeLayout(nodes, edges)
  const ports = computePorts(edges, positions, nodeLayerMap)

  // Build active highlight sets
  const { activeNodeIds, activeEdgeKeys } = activeHover
    ? buildActiveSet(hoveredTarget, edges)
    : { activeNodeIds: new Set(), activeEdgeKeys: new Set() }
  const hasActiveHover = activeHover && hoveredTarget != null

  const counts = { healthy: 0, degraded: 0, down: 0, other: 0 }
  for (const n of nodes) {
    if (n.status === 'healthy') counts.healthy++
    else if (n.status === 'degraded') counts.degraded++
    else if (n.status === 'down' || n.status === 'unhealthy') counts.down++
    else counts.other++
  }

  // Unique edge types present in this graph for the legend
  const usedEdgeTypes = [...new Map(
    edges.map(e => [e.label, edgeMeta(e.label)])
  ).entries()].map(([label, meta]) => ({ label, ...meta }))

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text flex items-center gap-2">
            <GitBranch size={22} className="text-theme-accent" />
            Integrations
          </h1>
          <p className="mt-1 text-sm text-theme-text-muted">
            {nodes.length} services &middot;{' '}
            <span className="text-green-400">{counts.healthy} healthy</span>
            {counts.degraded > 0 && <>, <span className="text-yellow-400">{counts.degraded} degraded</span></>}
            {counts.down > 0 && <>, <span className="text-red-400">{counts.down} down</span></>}
            {counts.other > 0 && <>, <span className="text-zinc-500">{counts.other} other</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono bg-theme-card border border-theme-border rounded-lg px-3 py-2 text-theme-text-muted">
          <RefreshCw size={12} className="text-theme-accent" />
          live &middot; 10s
        </div>
      </div>

      {/* Status legend */}
      <div className="mb-4 flex flex-wrap gap-4 text-xs text-theme-text-muted">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-400" /> Healthy</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-400" /> Degraded</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-400" /> Down</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-zinc-500" /> Not deployed</span>
        <span className="border-l border-theme-border pl-4 flex items-center gap-1.5 text-zinc-600">
          <span className="inline-block w-4 border-t border-dashed border-zinc-600" /> Degraded path
        </span>
      </div>

      {/* Graph */}
      <div className="relative bg-theme-card border border-theme-border rounded-xl overflow-auto">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="block mx-auto"
        >
          <defs>
            <style>{`
              @keyframes pulseGlow {
                0%, 100% { opacity: 0.3; }
                50% { opacity: 1; }
              }
              .pulse-glow {
                animation: pulseGlow 2s ease-in-out infinite;
              }
            `}</style>

            {MARKER_DEFS.map(({ id, color }) => (
              <marker key={id} id={id} markerWidth="7" markerHeight="5" refX="7" refY="2.5" orient="auto">
                <path d="M 0 0 L 7 2.5 L 0 5 Z" fill={color} fillOpacity="0.85" />
              </marker>
            ))}

            {/* Node card shadow — pronounced dark aura that masks passing lines */}
            <filter id="node-shadow" x="-25%" y="-60%" width="150%" height="230%">
              <feDropShadow dx="0" dy="2" stdDeviation="10" floodColor="#000000" floodOpacity="0.7" />
            </filter>

            {/* Soft glow for highlighted edges and node borders */}
            <filter id="edge-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
            </filter>
          </defs>

          {/* Layer labels */}
          {LAYER_ORDER.map(layer => {
            const y = layerLabelY[layer]
            if (y == null) return null
            return (
              <text
                key={layer}
                x={16}
                y={y + NODE_H / 2}
                className="fill-zinc-600"
                style={{ fontSize: '10px', fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' }}
              >
                {layer}
              </text>
            )
          })}

          {/* Edges — behind nodes */}
          <EdgeLayer
            edges={edges}
            ports={ports}
            activeEdgeKeys={activeEdgeKeys}
            hasActiveHover={hasActiveHover}
            onHoverStart={handleHoverStart}
            onHoverEnd={handleHoverEnd}
          />

          {/* Nodes — shadow covers passing lines */}
          {nodes.map(node => {
            const pos = positions[node.id]
            if (!pos) return null
            return (
              <ServiceNode
                key={node.id}
                node={node}
                pos={pos}
                onClick={setSelectedNode}
                isSelected={selectedNode?.id === node.id}
                isHighlighted={activeNodeIds.has(node.id)}
                isDimmed={hasActiveHover && !activeNodeIds.has(node.id)}
                onHoverStart={handleHoverStart}
                onHoverEnd={handleHoverEnd}
              />
            )
          })}

          {/* Port dots — above everything */}
          <PortDots
            edges={edges}
            ports={ports}
            activeEdgeKeys={activeEdgeKeys}
            hasActiveHover={hasActiveHover}
          />
        </svg>

        {/* Connection type legend */}
        <div className="px-4 py-3 border-t border-theme-border flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="text-xs text-zinc-600 font-medium">Connections:</span>
          {usedEdgeTypes.map(({ label, color }) => (
            <span key={label} className="flex items-center gap-1.5 text-xs text-theme-text-muted">
              <svg width="20" height="10" className="shrink-0">
                <circle cx="5" cy="5" r="3.5" fill={color} fillOpacity="0.9" />
                <line x1="9" y1="5" x2="17" y2="5" stroke={color} strokeWidth="1.75" strokeOpacity="0.8" />
                <polygon points="17,2.5 20,5 17,7.5" fill={color} fillOpacity="0.85" />
              </svg>
              {label}
            </span>
          ))}
        </div>

        <DetailPanel node={selectedNode} edges={edges} onClose={() => setSelectedNode(null)} />
      </div>
    </div>
  )
}
