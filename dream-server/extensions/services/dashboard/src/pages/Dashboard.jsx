import {
  Activity,
  Cpu,
  HardDrive,
  Thermometer,
  Power,
  Zap,
  Clock,
  Brain,
  Brackets,
  Layers,
  MessageSquare,
  Mic,
  FileText,
  Workflow,
  Image,
  Code,
  ChevronRight,
  CircleHelp,
} from 'lucide-react'
import { memo, useEffect, useRef, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FeatureDiscoveryBanner } from '../components/FeatureDiscovery'
import { getServiceUrl } from '../utils/serviceUrls'

// ============================================================================
// Inference data polling (same pattern as standalone InferenceAnalytics page)
// ============================================================================

function useInferenceData() {
  const [metrics, setMetrics] = useState(null)
  const [history, setHistory] = useState(null)
  const [summary, setSummary] = useState(null)
  const fetchInFlight = useRef(false)

  useEffect(() => {
    const fetchAll = async () => {
      if (document.hidden || fetchInFlight.current) return
      fetchInFlight.current = true
      try {
        const [mRes, hRes, sRes] = await Promise.all([
          fetch('/api/inference/metrics'),
          fetch('/api/inference/history'),
          fetch('/api/inference/summary'),
        ])
        if (mRes.ok) setMetrics(await mRes.json())
        if (hRes.ok) setHistory(await hRes.json())
        if (sRes.ok) setSummary(await sRes.json())
      } catch {
        // Inference data degrades gracefully — dashboard still shows system status
      } finally {
        fetchInFlight.current = false
      }
    }

    fetchAll()
    const interval = setInterval(fetchAll, 5000)
    const onVis = () => { if (!document.hidden) fetchAll() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  return { metrics, history, summary }
}

// Compute overall health from services (excludes not_deployed from counts)
function computeHealth(services) {
  if (!services?.length) return { text: 'Waiting for telemetry...', color: 'text-theme-text-secondary' }
  const deployed = services.filter(s => s.status !== 'not_deployed')
  if (!deployed.length) return { text: 'No services deployed', color: 'text-theme-text-secondary' }
  const healthy = deployed.filter(s => s.status === 'healthy').length
  return { text: `${healthy}/${deployed.length} services online.`, color: healthy === deployed.length ? 'text-green-400' : 'text-theme-text-secondary' }
}

const FEATURE_ICONS = {
  MessageSquare,
  Mic,
  FileText,
  Workflow,
  Image,
  Code,
}

function pickFeatureLink(feature, services) {
  const svc = services || []
  const req = feature?.requirements || {}
  const wanted = [...(req.servicesAll || req.services || []), ...(req.servicesAny || req.services_any || [])]

  // Match by name substring since status API uses display names, not IDs
  const matchService = (needle) =>
    svc.find(s => s.status === 'healthy' && s.port &&
      (s.name || '').toLowerCase().includes(needle.toLowerCase()))

  const firstHealthy = wanted.map(matchService).find(Boolean)
  if (firstHealthy) {
    return getServiceUrl(firstHealthy.port)
  }

  const fallbackWebUi = matchService('webui') || matchService('open webui')
  return fallbackWebUi ? getServiceUrl(fallbackWebUi.port) : null
}

function normalizeFeatureStatus(featureStatus) {
  switch (featureStatus) {
    case 'enabled':
      return 'ready'
    case 'available':
      return 'ready'
    case 'services_needed':
    case 'insufficient_vram':
      return 'disabled'
    default:
      return 'disabled'
  }
}

// Sort services: down/unhealthy first, then degraded, then healthy; exclude not_deployed
const severityOrder = { down: 0, unhealthy: 1, degraded: 2, unknown: 3, healthy: 4 }
function sortBySeverity(services) {
  return [...(services || [])]
    .filter(s => s.status !== 'not_deployed')
    .sort((a, b) =>
      (severityOrder[a.status] ?? 9) - (severityOrder[b.status] ?? 9)
    )
}

// Format large token counts: 1234 → "1.2k", 1500000 → "1.5M", 1500000000 → "1.5B"
function formatTokenCount(n) {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

// Format uptime: 90061 → "1d 1h 1m"
function formatUptime(seconds) {
  if (!seconds) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function shortModelName(id) {
  if (!id) return '--'
  let name = id.replace(/^(extra|user)\./i, '').replace(/\.gguf$/i, '')
  name = name.replace(/[-_](UD[-_])?[A-Z0-9]+_K(_[A-Z0-9]+)?$/i, '')
    .replace(/[-_]MXFP\d+(_MOE)?$/i, '')
  return name || id
}

const MAX_HISTORY_PTS = 60

export default function Dashboard({ status, loading }) {
  const { metrics: infMetrics, history: infHistory, summary: infSummary } = useInferenceData()
  const [featuresData, setFeaturesData] = useState(null)

  // Client-side rolling history built from the working /api/status source.
  // infHistory.tps is always 0 because inference.py's rate computation breaks;
  // status.inference.tokensPerSecond is the already-working path via helpers.py.
  const localHistoryRef = useRef({ timestamps: [], tps: [], kvCache: [], requests: [] })
  const [localHistory, setLocalHistory] = useState({ timestamps: [], tps: [], kvCache: [], requests: [] })

  useEffect(() => {
    if (!status) return
    const h = localHistoryRef.current
    const now = new Date().toISOString()
    const tps = status?.inference?.tokensPerSecond ?? 0
    const kvCache = infMetrics?.kv_cache_usage_ratio != null
      ? infMetrics.kv_cache_usage_ratio * 100
      : 0
    const requests = infMetrics?.active_requests ?? 0

    h.timestamps = [...h.timestamps, now].slice(-MAX_HISTORY_PTS)
    h.tps = [...h.tps, tps].slice(-MAX_HISTORY_PTS)
    h.kvCache = [...h.kvCache, kvCache].slice(-MAX_HISTORY_PTS)
    h.requests = [...h.requests, requests].slice(-MAX_HISTORY_PTS)
    setLocalHistory({ ...h })
  }, [status, infMetrics])

  useEffect(() => {
    let mounted = true

    const fetchFeatures = async () => {
      try {
        const res = await fetch('/api/features')
        if (!res.ok) return
        const data = await res.json()
        if (mounted) setFeaturesData(data)
      } catch {
        // Feature cards degrade gracefully to status-only view when API fails.
      }
    }

    fetchFeatures()
    const timer = setInterval(fetchFeatures, 15000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  // All hooks must be called before any conditional returns (React rules of hooks)
  const features = useMemo(() => {
    if (featuresData?.features?.length) {
      return [...featuresData.features].sort((a, b) => (a.priority || 999) - (b.priority || 999))
    }
    return []
  }, [featuresData])

  if (loading) {
    return (
      <div className="p-8 animate-pulse">
        <div className="h-8 bg-theme-card rounded w-1/3 mb-4" />
        <p className="text-sm text-theme-text-muted mb-8">Linking modules... reading telemetry...</p>
        <div className="grid grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-40 bg-theme-card rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  const health = computeHealth(status?.services)
  const servicesSorted = sortBySeverity(status?.services)
  // Model stack — show all loaded models (Lemonade multi-model support)
  const loadedModels = status?.inference?.loadedModels || []
  const activeModel = status?.inference?.loadedModel || null

  return (
    <div className="p-8">
      {/* Header with live meta strip */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text">Dashboard</h1>
          <p className={`mt-1 ${health.color}`}>
            {health.text}
          </p>
        </div>
        <div className="liquid-metal-frame liquid-metal-frame--soft flex items-center gap-4 text-xs text-theme-text-muted font-mono bg-theme-card border border-theme-border rounded-lg px-3 py-2">
          {status?.tier && <span className="text-theme-accent-light">{status.tier}</span>}
          {status?.model?.name && <span>{status.model.name}</span>}
          {status?.version && <span>v{status.version}</span>}
        </div>
      </div>

      {/* Feature Discovery Banner */}
      <FeatureDiscoveryBanner />


      {/* Multi-GPU summary strip — only shown when gpu_count > 1 */}
      {status?.gpu?.gpu_count > 1 && (
        <Link to="/gpu" className="block mb-6">
          <div className="liquid-metal-frame flex items-center justify-between p-4 bg-indigo-500/10 border border-indigo-500/25 rounded-xl transition-colors group">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-500/15 rounded-lg">
                <Activity size={18} className="text-indigo-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  Multi-GPU System · {status.gpu.gpu_count} GPUs
                </p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  {status.gpu.name} · {status.gpu.utilization}% avg util · {status.gpu.vramUsed?.toFixed(1)}/{status.gpu.vramTotal} GB VRAM
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-indigo-400 group-hover:text-indigo-300 transition-colors font-medium">
              GPU Monitor
              <ChevronRight size={14} />
            </div>
          </div>
        </Link>
      )}

      {/* Inference & System Telemetry */}
      <h2 className="text-lg font-semibold text-theme-text mb-5">System Telemetry</h2>

      {/* Summary cards — inference + system metrics combined */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <InferenceSummaryCard icon={Zap} label="Tokens/sec" value={infMetrics?.tokens_per_second || status?.inference?.tokensPerSecond || '--'} subvalue="generation speed" />
        <InferenceSummaryCard icon={Zap} label="Prompt tok/s" value={infMetrics?.prompt_tokens_per_second || '--'} subvalue="prompt processing" />
        <InferenceSummaryCard icon={Layers} label="KV Cache" value={infMetrics?.kv_cache_usage_ratio != null ? `${(infMetrics.kv_cache_usage_ratio * 100).toFixed(1)}%` : '--'} subvalue="context utilization" />
        <InferenceSummaryCard icon={Activity} label="Lifetime" value={formatTokenCount(infSummary?.lifetime_tokens || status?.inference?.lifetimeTokens || 0)} subvalue="total generated" />
        <InferenceSummaryCard icon={Brain} label="Model" value={infSummary?.active_model ? shortModelName(infSummary.active_model) : (activeModel ? shortModelName(activeModel) : '--')} subvalue={status?.inference?.contextSize ? `${(status.inference.contextSize / 1024).toFixed(0)}k context` : ''} />
        <InferenceSummaryCard icon={Clock} label="Uptime" value={formatUptime(status?.uptime || 0)} subvalue="system" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        {status?.gpu && (
          <InferenceSummaryCard icon={Activity} label="GPU" value={`${status.gpu.utilization}%`} subvalue={status.gpu.name.replace('NVIDIA ', '').replace('AMD ', '')} percent={status.gpu.utilization} />
        )}
        {status?.gpu?.memoryType === 'unified' ? (
          status?.ram && <InferenceSummaryCard icon={HardDrive} label="Mem Used" value={`${status.ram.used_gb} GB`} subvalue={`of ${status.ram.total_gb} GB`} percent={status.ram.percent} />
        ) : (
          status?.gpu && <InferenceSummaryCard icon={HardDrive} label="VRAM" value={`${status.gpu.vramUsed.toFixed(1)} GB`} subvalue={`of ${status.gpu.vramTotal} GB`} percent={(status.gpu.vramUsed / status.gpu.vramTotal) * 100} />
        )}
        {status?.cpu && (
          <InferenceSummaryCard icon={Cpu} label="CPU" value={`${status.cpu.percent}%`} subvalue="utilization" percent={status.cpu.percent} />
        )}
        {status?.ram && status?.gpu?.memoryType !== 'unified' && (
          <InferenceSummaryCard icon={HardDrive} label="RAM" value={`${status.ram.used_gb} GB`} subvalue={`of ${status.ram.total_gb} GB`} percent={status.ram.percent} />
        )}
        {status?.gpu?.powerDraw != null && (
          <InferenceSummaryCard icon={Power} label="GPU Power" value={`${status.gpu.powerDraw}W`} subvalue="live" />
        )}
        <InferenceSummaryCard icon={Thermometer} label="GPU Temp" value={status?.gpu?.temperature != null ? `${status.gpu.temperature}°C` : '—'} subvalue={status?.gpu?.temperature != null ? (status.gpu.temperature < 70 ? 'normal' : status.gpu.temperature < 85 ? 'warm' : 'hot') : 'thermal'} alert={status?.gpu?.temperature >= 85} />
      </div>

      {/* Speculative decoding banner */}
      {infMetrics?.draft_acceptance_pct != null && (
        <div className="mb-6 p-3 bg-theme-card border border-theme-border rounded-xl flex items-center gap-3">
          <div className="p-2 bg-theme-accent/10 rounded-lg">
            <Zap size={16} className="text-theme-accent" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-theme-text">Speculative Decoding Active</p>
            <p className="text-[10px] text-theme-text-muted">
              Draft acceptance: <span className="font-mono text-theme-accent">{infMetrics.draft_acceptance_pct}%</span>
              {' '}&middot;{' '}
              Drafted: <span className="font-mono">{formatTokenCount(infMetrics?.tokens_drafted_total || 0)}</span>
              {' '}&middot;{' '}
              Accepted: <span className="font-mono">{formatTokenCount(infMetrics?.tokens_drafted_accepted_total || 0)}</span>
            </p>
          </div>
        </div>
      )}

      {/* Time-series charts — sourced from client-side history via /api/status (working path) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <DashTimeSeriesChart timestamps={localHistory.timestamps} values={localHistory.tps} label="Tokens / sec" unit="t/s" color="#818cf8" />
        <DashTimeSeriesChart timestamps={localHistory.timestamps} values={localHistory.kvCache} label="KV Cache Utilization" unit="%" color="#34d399" maxOverride={100} />
        <DashTimeSeriesChart timestamps={localHistory.timestamps} values={localHistory.requests} label="Active Requests" unit="" color="#fb923c" />
      </div>

      {/* Model stack + Prometheus metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4 mb-10">
        <ModelStackPanel models={loadedModels} activeModel={activeModel} summary={infSummary} contextSize={status?.inference?.contextSize || infSummary?.context_size} />
        <PrometheusTable allMetrics={infMetrics?.all_metrics} />
      </div>

      {/* Services */}
      <h2 className="text-lg font-semibold text-theme-text mb-5">Services</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-12">
        {servicesSorted.map(service => (
          <ServiceCard key={service.name} service={service} />
        ))}
        {servicesSorted.length === 0 && (
          <p className="col-span-6 text-xs text-theme-text-muted">Waiting for service telemetry...</p>
        )}
      </div>

    </div>
  )
}


const FeatureCard = memo(function FeatureCard({ icon: Icon, title, description, href, status, hint }) {
  const isExternal = href?.startsWith('http')
  const statusColors = {
    ready: 'border-theme-border bg-theme-card hover:border-theme-accent/30',
    disabled: 'border-theme-border/60 bg-theme-card opacity-60',
    coming: 'border-transparent bg-theme-bg/50 opacity-30'
  }
  const statusMeta = {
    ready: {
      label: 'Ready',
      dotClass: 'bg-emerald-400',
      textClass: 'text-theme-text-secondary'
    },
    coming: {
      label: 'Coming soon',
      dotClass: 'bg-theme-text-muted/45',
      textClass: 'text-theme-text-muted'
    }
  }
  const detailText = hint ? `${description} ${hint}` : description

  const content = (
    <div
      className={`feature-card-compact liquid-metal-frame liquid-metal-sequence-card group h-full min-h-[56px] px-2.5 py-2 rounded-xl border ${statusColors[status]} transition-all cursor-pointer hover:bg-theme-surface-hover hover:shadow-md flex items-center justify-between gap-2`}
      style={{ overflow: 'visible' }}
    >
      <div className="min-w-0 flex items-center gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-theme-bg border border-white/5">
          <Icon size={16} className="text-theme-text-secondary" />
        </div>

        <div className="min-w-0 flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold text-theme-text">
            {title}
          </h3>

          {statusMeta[status] && (
            <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.12em] ${statusMeta[status].textClass}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusMeta[status].dotClass}`} />
              {statusMeta[status].label}
            </span>
          )}
        </div>
      </div>

      <div className="relative shrink-0 group/info" title={detailText}>
        <div className="flex h-6.5 w-6.5 items-center justify-center rounded-full border border-white/10 bg-theme-bg/80 text-theme-text-muted/75 transition-colors group-hover:text-theme-text-secondary group-hover:border-theme-accent/20">
          <CircleHelp size={13} />
        </div>

        <div className="pointer-events-none absolute bottom-[calc(100%+0.45rem)] right-0 z-20 w-52 rounded-lg border border-white/10 bg-[#0d0b12]/95 px-3 py-2 text-[11px] leading-4 text-theme-text-muted opacity-0 shadow-2xl transition-all duration-150 group-hover/info:translate-y-0 group-hover/info:opacity-100 translate-y-1">
          {description}
          {status === 'disabled' && hint && (
            <p className="mt-2 font-mono text-[10px] text-theme-text-secondary">{hint}</p>
          )}
        </div>
      </div>
    </div>
  )

  if (status === 'disabled' || status === 'coming' || !href) {
    return <div className="block h-full liquid-metal-sequence-slot">{content}</div>
  }

  if (isExternal) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full liquid-metal-sequence-slot">
        {content}
      </a>
    )
  }

  return <Link to={href} className="block h-full liquid-metal-sequence-slot">{content}</Link>
})

// ============================================================================
// Inference-styled summary card
// ============================================================================

const InferenceSummaryCard = memo(function InferenceSummaryCard({ icon: Icon, label, value, subvalue, percent, alert }) {
  const progressTone = percent > 90
    ? 'liquid-metal-progress-fill liquid-metal-progress-fill--danger'
    : percent > 70
      ? 'liquid-metal-progress-fill liquid-metal-progress-fill--warn'
      : 'liquid-metal-progress-fill'

  return (
    <div className="bg-theme-card border border-theme-border rounded-xl px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={13} className={alert ? 'text-red-400' : 'text-theme-text-muted'} />
        <span className="text-[9px] font-semibold uppercase tracking-[0.13em] text-theme-text-muted">{label}</span>
      </div>
      <div className="text-xl font-bold text-theme-text font-mono leading-none truncate" title={String(value)}>{value}</div>
      {subvalue && <div className="text-[10px] text-theme-text-muted mt-0.5 truncate">{subvalue}</div>}
      {percent != null && (
        <div className="liquid-metal-progress-track rounded-full mt-1.5 h-[2px] overflow-hidden">
          <div className={`h-full rounded-full transition-all ${progressTone}`} style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>
      )}
    </div>
  )
})

// ============================================================================
// Time-series chart for dashboard (from InferenceAnalytics)
// ============================================================================

const DashTimeSeriesChart = memo(function DashTimeSeriesChart({ timestamps, values, label, unit, color, maxOverride, height = 140 }) {
  const data = (values || []).filter(v => v != null)
  if (data.length < 2) {
    return (
      <div className="bg-theme-card border border-theme-border rounded-xl p-4">
        <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide mb-3">{label}</p>
        <div className="flex items-center justify-center h-28 text-theme-text-muted text-xs">Collecting samples...</div>
      </div>
    )
  }

  const W = 400, H = height, padX = 4, padY = 8
  const max = maxOverride != null ? maxOverride : Math.max(...data, 1) * 1.1
  const latest = data[data.length - 1]

  const pts = data.map((v, i) => {
    const x = padX + (i / (data.length - 1)) * (W - padX * 2)
    const y = H - padY - (v / max) * (H - padY * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  const firstX = padX
  const lastX = padX + ((data.length - 1) / (data.length - 1)) * (W - padX * 2)
  const areaPath = `M ${firstX},${H - padY} L ${pts.split(' ').map(p => p).join(' L ')} L ${lastX},${H - padY} Z`

  const ts = timestamps || []
  const timeRange = ts.length >= 2
    ? `${new Date(ts[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(ts[ts.length - 1]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : ''

  return (
    <div className="bg-theme-card border border-theme-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide">{label}</p>
        <span className="text-sm font-mono font-bold text-theme-text">
          {typeof latest === 'number' ? (Number.isInteger(latest) ? latest : latest.toFixed(1)) : '--'}
          {unit ? <span className="text-theme-text-muted ml-0.5 text-xs font-normal">{unit}</span> : null}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: `${height}px` }}>
        <defs>
          <linearGradient id={`area-dash-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(ratio => {
          const y = H - padY - ratio * (H - padY * 2)
          return <line key={ratio} x1={padX} x2={W - padX} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        })}
        <path d={areaPath} fill={`url(#area-dash-${label})`} />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.length > 0 && (() => { const lp = pts.split(' ').pop().split(','); return <circle cx={lp[0]} cy={lp[1]} r="3" fill={color} /> })()}
      </svg>
      {timeRange && <p className="text-[10px] text-theme-text-muted mt-1.5 font-mono text-center">{timeRange}</p>}
    </div>
  )
})

// ============================================================================
// Model stack panel (enhanced with context size)
// ============================================================================

const ModelStackPanel = memo(function ModelStackPanel({ models, activeModel, summary, contextSize }) {
  const allModels = summary?.loaded_models || models || []
  const displayModels = allModels.length ? allModels : (activeModel ? [{ id: activeModel, active: true }] : [])
  const ctx = contextSize || summary?.context_size || null

  return (
    <div className="bg-theme-card border border-theme-border rounded-xl p-4">
      <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide mb-3">Model Stack</p>
      {displayModels.length > 0 ? (
        <div className="space-y-2">
          {displayModels.map((model) => {
            const id = typeof model === 'string' ? model : model.id
            const isActive = typeof model === 'string' ? id === activeModel : model.active
            return (
              <div key={id} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${isActive ? 'bg-emerald-500/10 border border-emerald-500/20' : 'bg-theme-bg border border-theme-border/50'}`}>
                <span className={`h-2 w-2 rounded-full shrink-0 ${isActive ? 'bg-emerald-400' : 'bg-theme-text-muted/30'}`} />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-theme-text truncate block" title={id}>{shortModelName(id)}</span>
                  {model.size_gb && <span className="text-[10px] text-theme-text-muted">{model.size_gb} GB</span>}
                </div>
                {isActive && <span className="text-[8px] font-semibold uppercase tracking-wide text-emerald-400">active</span>}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-theme-text-muted">No models loaded</p>
      )}
      {ctx && (
        <div className="mt-3 pt-3 border-t border-theme-border">
          <div className="flex items-center justify-between text-xs">
            <span className="text-theme-text-muted">Context size</span>
            <span className="font-mono text-theme-text">{(ctx / 1024).toFixed(0)}k tokens</span>
          </div>
        </div>
      )}
    </div>
  )
})

// ============================================================================
// Prometheus metrics table
// ============================================================================

const PrometheusTable = memo(function PrometheusTable({ allMetrics }) {
  const entries = useMemo(() => {
    if (!allMetrics) return []
    return Object.entries(allMetrics).sort(([a], [b]) => a.localeCompare(b))
  }, [allMetrics])

  if (!entries.length) {
    return (
      <div className="bg-theme-card border border-theme-border rounded-xl p-4">
        <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide mb-3">Prometheus Metrics</p>
        <p className="text-xs text-theme-text-muted">Collecting metrics...</p>
      </div>
    )
  }

  return (
    <div className="bg-theme-card border border-theme-border rounded-xl p-4">
      <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide mb-3">
        Prometheus Metrics
        <span className="ml-2 text-theme-text-muted font-normal lowercase">{entries.length} metrics</span>
      </p>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-theme-border">
              <th className="text-left py-1.5 pr-3 text-theme-text-muted font-medium">Metric</th>
              <th className="text-right py-1.5 text-theme-text-muted font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, value]) => (
              <tr key={name} className="border-b border-theme-border/30 hover:bg-theme-bg/30">
                <td className="py-1.5 pr-3 font-mono text-theme-text truncate max-w-xs" title={name}>{name}</td>
                <td className="py-1.5 text-right font-mono text-theme-accent">
                  {typeof value === 'number' ? (Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4)) : String(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})

const SERVICE_STATUS_META = {
  healthy:     { dot: 'bg-emerald-400', label: 'Online',   border: 'border-emerald-500/20',  bg: '' },
  degraded:    { dot: 'bg-amber-400',   label: 'Degraded', border: 'border-amber-500/20',    bg: '' },
  down:        { dot: 'bg-red-500',     label: 'Down',     border: 'border-red-500/20',      bg: '' },
  unhealthy:   { dot: 'bg-red-500',     label: 'Unhealthy',border: 'border-red-500/20',      bg: '' },
  unknown:     { dot: 'bg-zinc-500',    label: 'Unknown',  border: 'border-theme-border',    bg: '' },
}

const ServiceCard = memo(function ServiceCard({ service }) {
  const meta = SERVICE_STATUS_META[service.status] || SERVICE_STATUS_META.unknown

  return (
    <div className={`bg-theme-card border ${meta.border || 'border-theme-border'} rounded-xl px-4 py-3`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dot}`} />
        <span className="text-[9px] font-semibold uppercase tracking-[0.13em] text-theme-text-muted">{meta.label}</span>
      </div>
      <div className="text-sm font-bold text-theme-text leading-tight truncate" title={service.name}>{service.name}</div>
      <div className="text-[10px] text-theme-text-muted mt-0.5 font-mono">
        {service.port ? `${service.port}` : '—'}
        {service.uptime ? <span className="ml-1.5">{formatUptime(service.uptime)}</span> : null}
      </div>
    </div>
  )
})

// BootstrapBanner moved to App.jsx for app-wide visibility
