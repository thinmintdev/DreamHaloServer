import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, ChevronDown, ChevronRight, Globe, ScrollText,
  Container, Search, Cpu, HardDrive, ArrowUpDown,
} from 'lucide-react'

const STATUS_COLORS = {
  running: 'bg-green-500',
  exited: 'bg-red-500/60',
  restarting: 'bg-yellow-500 animate-pulse',
  paused: 'bg-blue-500/60',
  created: 'bg-gray-500/60',
  removing: 'bg-red-500/40',
  dead: 'bg-red-700/60',
}

const STATUS_LABELS = {
  running: 'Running',
  exited: 'Exited',
  restarting: 'Restarting',
  paused: 'Paused',
  created: 'Created',
  removing: 'Removing',
  dead: 'Dead',
}

function formatMemory(memStr) {
  if (!memStr) return { used: '0', limit: '0', display: '--' }
  const parts = memStr.split('/')
  if (parts.length !== 2) return { used: '0', limit: '0', display: memStr }
  return { used: parts[0].trim(), limit: parts[1].trim(), display: memStr.trim() }
}

function formatPorts(portStr) {
  if (!portStr) return []
  return portStr.split(',').map(p => p.trim()).filter(Boolean).map(mapping => {
    const match = mapping.match(/(?:(\d+\.\d+\.\d+\.\d+):)?(\d+)->(\d+)\/(\w+)/)
    if (match) {
      return { host: match[2], container: match[3], proto: match[4] }
    }
    return { raw: mapping }
  })
}

function displayName(name) {
  return name.replace(/^dream-/, '')
}

function ProgressBar({ value, max = 100, color = 'default', size = 'sm' }) {
  const pct = Math.min((value / max) * 100, 100)
  const fillClass = pct > 90
    ? 'liquid-metal-progress-fill liquid-metal-progress-fill--danger'
    : pct > 75
      ? 'liquid-metal-progress-fill liquid-metal-progress-fill--warn'
      : 'liquid-metal-progress-fill'
  const h = size === 'sm' ? 'h-1.5' : 'h-2'

  return (
    <div className={`w-full ${h} rounded-full overflow-hidden liquid-metal-progress-track`}>
      <div
        className={`${h} rounded-full transition-all duration-500 ${fillClass}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function ExpandedRow({ container }) {
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/containers/${container.name}/inspect`)
      .then(r => r.ok ? r.json() : null)
      .then(setDetails)
      .catch(() => setDetails(null))
      .finally(() => setLoading(false))
  }, [container.name])

  if (loading) {
    return (
      <tr>
        <td colSpan={8} className="px-6 py-4">
          <div className="animate-pulse space-y-2">
            <div className="h-3 bg-theme-border rounded w-1/3" />
            <div className="h-3 bg-theme-border rounded w-1/2" />
          </div>
        </td>
      </tr>
    )
  }

  if (!details) return null

  return (
    <tr className="bg-white/[0.01]">
      <td colSpan={8} className="px-6 py-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <p className="text-theme-text-muted font-semibold uppercase tracking-wider mb-1">Container ID</p>
            <p className="font-mono text-theme-text">{details.id}</p>
          </div>
          <div>
            <p className="text-theme-text-muted font-semibold uppercase tracking-wider mb-1">Network I/O</p>
            <p className="font-mono text-theme-text">{container.net_io}</p>
          </div>
          <div>
            <p className="text-theme-text-muted font-semibold uppercase tracking-wider mb-1">Block I/O</p>
            <p className="font-mono text-theme-text">{container.block_io}</p>
          </div>
          <div>
            <p className="text-theme-text-muted font-semibold uppercase tracking-wider mb-1">PIDs</p>
            <p className="font-mono text-theme-text">{container.pids}</p>
          </div>
          <div>
            <p className="text-theme-text-muted font-semibold uppercase tracking-wider mb-1">Restart Policy</p>
            <p className="font-mono text-theme-text">{details.restart_policy?.name || 'none'}</p>
          </div>
          <div>
            <p className="text-theme-text-muted font-semibold uppercase tracking-wider mb-1">Started</p>
            <p className="font-mono text-theme-text">{details.state?.started_at ? new Date(details.state.started_at).toLocaleString() : '--'}</p>
          </div>
          <div>
            <p className="text-theme-text-muted font-semibold uppercase tracking-wider mb-1">Health</p>
            <p className="font-mono text-theme-text">{details.state?.health || 'none'}</p>
          </div>
          <div>
            <p className="text-theme-text-muted font-semibold uppercase tracking-wider mb-1">Image</p>
            <p className="font-mono text-theme-text break-all">{details.image}</p>
          </div>
        </div>

        {/* Mounts */}
        {details.mounts?.length > 0 && (
          <div className="mt-4">
            <p className="text-theme-text-muted font-semibold uppercase tracking-wider text-xs mb-2">Volumes</p>
            <div className="space-y-1">
              {details.mounts.map((m, i) => (
                <div key={i} className="flex gap-2 text-xs font-mono">
                  <span className="text-theme-text-muted">{m.type}</span>
                  <span className="text-theme-text">{m.source}</span>
                  <span className="text-theme-text-muted">→</span>
                  <span className="text-theme-text">{m.destination}</span>
                  <span className="text-theme-text-muted">{m.rw ? 'rw' : 'ro'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Networks */}
        {details.networks && Object.keys(details.networks).length > 0 && (
          <div className="mt-4">
            <p className="text-theme-text-muted font-semibold uppercase tracking-wider text-xs mb-2">Networks</p>
            <div className="space-y-1">
              {Object.entries(details.networks).map(([name, net]) => (
                <div key={name} className="flex gap-3 text-xs font-mono">
                  <span className="text-theme-accent">{name}</span>
                  <span className="text-theme-text">{net.ip}</span>
                  {net.gateway && <span className="text-theme-text-muted">gw: {net.gateway}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </td>
    </tr>
  )
}


export default function Services() {
  const [containers, setContainers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortField, setSortField] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const navigate = useNavigate()

  const fetchContainers = useCallback(async () => {
    try {
      const res = await fetch('/api/containers')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setContainers(await res.json())
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchContainers()
    const interval = setInterval(fetchContainers, 5000)
    return () => clearInterval(interval)
  }, [fetchContainers])

  const toggleExpand = (id) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const filtered = useMemo(() => {
    let list = containers
    if (filter) {
      const q = filter.toLowerCase()
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.image.toLowerCase().includes(q))
    }
    if (statusFilter !== 'all') {
      list = list.filter(c => c.status === statusFilter)
    }
    list = [...list].sort((a, b) => {
      let av = a[sortField] ?? ''
      let bv = b[sortField] ?? ''
      if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return list
  }, [containers, filter, statusFilter, sortField, sortDir])

  const summary = useMemo(() => {
    const running = containers.filter(c => c.status === 'running').length
    const stopped = containers.filter(c => c.status !== 'running').length
    const totalCpu = containers.reduce((s, c) => s + (c.cpu_percent || 0), 0)
    const totalMem = containers.reduce((s, c) => s + (c.memory_percent || 0), 0)
    return { total: containers.length, running, stopped, totalCpu, totalMem }
  }, [containers])

  const SortHeader = ({ field, children, className = '' }) => (
    <th
      className={`text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-theme-text-muted cursor-pointer hover:text-theme-text select-none ${className}`}
      onClick={() => toggleSort(field)}
    >
      <span className="flex items-center gap-1">
        {children}
        {sortField === field && (
          <ArrowUpDown size={12} className={sortDir === 'desc' ? 'rotate-180' : ''} />
        )}
      </span>
    </th>
  )

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-text flex items-center gap-3">
            <Container size={28} />
            Services
          </h1>
          <p className="text-theme-text-muted mt-1">Docker container overview</p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchContainers() }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-theme-border text-theme-text-muted hover:text-theme-text hover:border-theme-accent/50 transition-colors"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-theme-card border border-theme-border rounded-xl p-4 liquid-metal-frame">
          <p className="text-xs text-theme-text-muted uppercase tracking-wider">Total</p>
          <p className="text-2xl font-bold text-theme-text mt-1">{summary.total}</p>
        </div>
        <div className="bg-theme-card border border-theme-border rounded-xl p-4 liquid-metal-frame">
          <p className="text-xs text-theme-text-muted uppercase tracking-wider">Running</p>
          <p className="text-2xl font-bold text-green-400 mt-1">{summary.running}</p>
        </div>
        <div className="bg-theme-card border border-theme-border rounded-xl p-4 liquid-metal-frame">
          <p className="text-xs text-theme-text-muted uppercase tracking-wider">Aggregate CPU</p>
          <p className="text-2xl font-bold text-theme-text mt-1">{summary.totalCpu.toFixed(1)}%</p>
          <ProgressBar value={summary.totalCpu} max={summary.total * 100 || 100} size="sm" />
        </div>
        <div className="bg-theme-card border border-theme-border rounded-xl p-4 liquid-metal-frame">
          <p className="text-xs text-theme-text-muted uppercase tracking-wider">Aggregate Memory</p>
          <p className="text-2xl font-bold text-theme-text mt-1">{summary.totalMem.toFixed(1)}%</p>
          <ProgressBar value={summary.totalMem} max={summary.total * 100 || 100} size="sm" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
          <input
            type="text"
            placeholder="Filter containers..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-theme-card border border-theme-border text-theme-text placeholder-theme-text-muted text-sm focus:outline-none focus:border-theme-accent/50"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-theme-card border border-theme-border text-theme-text text-sm focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="running">Running</option>
          <option value="exited">Exited</option>
          <option value="restarting">Restarting</option>
          <option value="paused">Paused</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-red-200 mb-4">
          Failed to load containers: {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-theme-card border border-theme-border rounded-xl overflow-hidden liquid-metal-frame">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-theme-border">
                <th className="w-8 px-4 py-3" />
                <th className="w-10 px-2 py-3" />
                <SortHeader field="name">Name</SortHeader>
                <SortHeader field="image">Image</SortHeader>
                <SortHeader field="state">State</SortHeader>
                <SortHeader field="cpu_percent" className="w-32">
                  <Cpu size={14} className="mr-1" /> CPU
                </SortHeader>
                <SortHeader field="memory_percent" className="w-40">
                  <HardDrive size={14} className="mr-1" /> Memory
                </SortHeader>
                <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider text-theme-text-muted">Ports</th>
                <th className="text-right px-4 py-3 text-xs font-semibold uppercase tracking-wider text-theme-text-muted w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && containers.length === 0 ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="border-b border-theme-border/50">
                    <td colSpan={9} className="px-4 py-3">
                      <div className="h-4 bg-theme-border/50 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-theme-text-muted">
                    No containers found
                  </td>
                </tr>
              ) : (
                filtered.map(c => {
                  const ports = formatPorts(c.ports)
                  const mem = formatMemory(c.memory_usage)
                  const isExpanded = expanded[c.id]
                  const firstPort = ports.find(p => p.host)

                  return (
                    <tbody key={c.id}>
                      <tr className="border-b border-theme-border/50 hover:bg-white/[0.02] transition-colors">
                        {/* Expand */}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleExpand(c.id)}
                            className="text-theme-text-muted hover:text-theme-text transition-colors"
                          >
                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </td>
                        {/* Status dot */}
                        <td className="px-2 py-3">
                          <span
                            className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_COLORS[c.status] || 'bg-gray-500/60'}`}
                            title={STATUS_LABELS[c.status] || c.status}
                          />
                        </td>
                        {/* Name */}
                        <td className="px-4 py-3 font-medium text-theme-text" title={c.name}>
                          {displayName(c.name)}
                        </td>
                        {/* Image */}
                        <td className="px-4 py-3 text-theme-text-muted font-mono text-xs max-w-[200px] truncate" title={c.image}>
                          {c.image.split('/').pop()}
                        </td>
                        {/* State */}
                        <td className="px-4 py-3 text-theme-text-muted text-xs">{c.state}</td>
                        {/* CPU */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16">
                              <ProgressBar value={c.cpu_percent} />
                            </div>
                            <span className="text-xs font-mono text-theme-text-muted w-12 text-right">
                              {c.cpu_percent.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        {/* Memory */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16">
                              <ProgressBar value={c.memory_percent} />
                            </div>
                            <span className="text-xs font-mono text-theme-text-muted truncate" title={mem.display}>
                              {mem.used}
                            </span>
                          </div>
                        </td>
                        {/* Ports */}
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {ports.slice(0, 3).map((p, i) => (
                              <span
                                key={i}
                                className="inline-block px-1.5 py-0.5 rounded text-xs font-mono bg-theme-border/40 text-theme-text-muted"
                              >
                                {p.host ? `${p.host}:${p.container}` : p.raw}
                              </span>
                            ))}
                            {ports.length > 3 && (
                              <span className="text-xs text-theme-text-muted">+{ports.length - 3}</span>
                            )}
                          </div>
                        </td>
                        {/* Actions */}
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {firstPort && (
                              <a
                                href={`http://localhost:${firstPort.host}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-accent hover:bg-white/[0.05] transition-colors"
                                title="Open in browser"
                              >
                                <Globe size={15} />
                              </a>
                            )}
                            <button
                              onClick={() => navigate(`/extensions/logs?container=${c.name}`)}
                              className="p-1.5 rounded-lg text-theme-text-muted hover:text-theme-accent hover:bg-white/[0.05] transition-colors"
                              title="View logs"
                            >
                              <ScrollText size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && <ExpandedRow container={c} />}
                    </tbody>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
