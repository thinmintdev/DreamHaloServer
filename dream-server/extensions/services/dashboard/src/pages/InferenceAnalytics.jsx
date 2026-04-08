import { memo, useState, useEffect, useRef, useMemo } from 'react'
import { BarChart2, RefreshCw, Zap, Clock, Brain, Layers, Activity } from 'lucide-react'

// ============================================================================
// Polling hook (mirrors useGPUDetailed / useSystemStatus pattern)
// ============================================================================

const POLL_INTERVAL = 5000

function useInferenceData() {
  const [metrics, setMetrics] = useState(null)
  const [history, setHistory] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fetchInFlight = useRef(false)

  useEffect(() => {
    const fetchAll = async () => {
      if (document.hidden) return
      if (fetchInFlight.current) return
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
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        fetchInFlight.current = false
        setLoading(false)
      }
    }

    fetchAll()
    const interval = setInterval(fetchAll, POLL_INTERVAL)
    const onVisibility = () => { if (!document.hidden) fetchAll() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return { metrics, history, summary, loading, error }
}

// ============================================================================
// Formatters
// ============================================================================

function formatTokenCount(n) {
  if (n == null) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

function formatUptime(seconds) {
  if (!seconds) return '--'
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

// ============================================================================
// SVG Time-series chart (no external deps)
// ============================================================================

const TimeSeriesChart = memo(function TimeSeriesChart({
  timestamps,
  values,
  label,
  unit,
  color,
  maxOverride,
  height = 160,
}) {
  const data = (values || []).filter(v => v != null)
  if (data.length < 2) {
    return (
      <div className="bg-theme-card border border-theme-border rounded-xl p-4">
        <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide mb-3">{label}</p>
        <div className="flex items-center justify-center h-32 text-theme-text-muted text-xs">
          Collecting samples...
        </div>
      </div>
    )
  }

  const W = 400
  const H = height
  const padX = 4
  const padY = 8
  const max = maxOverride != null ? maxOverride : Math.max(...data, 1) * 1.1
  const latest = data[data.length - 1]

  const pts = data.map((v, i) => {
    const x = padX + (i / (data.length - 1)) * (W - padX * 2)
    const y = H - padY - (v / max) * (H - padY * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  // Area fill path
  const firstX = padX
  const lastX = padX + ((data.length - 1) / (data.length - 1)) * (W - padX * 2)
  const areaPath = `M ${firstX},${H - padY} L ${pts.split(' ').map(p => p).join(' L ')} L ${lastX},${H - padY} Z`

  // Time range label
  const ts = timestamps || []
  const timeRange = ts.length >= 2
    ? `${new Date(ts[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${new Date(ts[ts.length - 1]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : ''

  return (
    <div className="bg-theme-card border border-theme-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide">{label}</p>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold text-theme-text">
            {typeof latest === 'number' ? (Number.isInteger(latest) ? latest : latest.toFixed(1)) : '--'}
            {unit ? <span className="text-theme-text-muted ml-0.5 text-xs font-normal">{unit}</span> : null}
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height: `${height}px` }}
      >
        <defs>
          <linearGradient id={`area-${label}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(ratio => {
          const y = H - padY - ratio * (H - padY * 2)
          return (
            <line key={ratio} x1={padX} x2={W - padX} y1={y} y2={y}
              stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          )
        })}
        {/* Area fill */}
        <path d={areaPath} fill={`url(#area-${label})`} />
        {/* Line */}
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {/* Latest value dot */}
        {data.length > 0 && (() => {
          const lastPt = pts.split(' ').pop().split(',')
          return <circle cx={lastPt[0]} cy={lastPt[1]} r="3" fill={color} />
        })()}
      </svg>
      {timeRange && (
        <p className="text-[10px] text-theme-text-muted mt-1.5 font-mono text-center">{timeRange}</p>
      )}
    </div>
  )
})

// ============================================================================
// Summary card
// ============================================================================

const SummaryCard = memo(function SummaryCard({ icon: Icon, label, value, subvalue }) {
  return (
    <div className="bg-theme-card border border-theme-border rounded-xl px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={13} className="text-theme-text-muted" />
        <span className="text-[9px] font-semibold uppercase tracking-[0.13em] text-theme-text-muted">{label}</span>
      </div>
      <div className="text-xl font-bold text-theme-text font-mono leading-none truncate" title={String(value)}>
        {value}
      </div>
      {subvalue && (
        <div className="text-[10px] text-theme-text-muted mt-0.5 truncate">{subvalue}</div>
      )}
    </div>
  )
})

// ============================================================================
// Prometheus metrics table
// ============================================================================

const MetricsTable = memo(function MetricsTable({ allMetrics }) {
  const entries = useMemo(() => {
    if (!allMetrics) return []
    return Object.entries(allMetrics)
      .sort(([a], [b]) => a.localeCompare(b))
  }, [allMetrics])

  if (!entries.length) {
    return (
      <div className="bg-theme-card border border-theme-border rounded-xl p-4">
        <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide mb-3">Prometheus Metrics</p>
        <p className="text-xs text-theme-text-muted">No metrics available</p>
      </div>
    )
  }

  return (
    <div className="bg-theme-card border border-theme-border rounded-xl p-4">
      <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide mb-3">
        All Prometheus Metrics
        <span className="ml-2 text-theme-text-muted font-normal lowercase">{entries.length} metrics</span>
      </p>
      <div className="max-h-80 overflow-y-auto">
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
                <td className="py-1.5 pr-3 font-mono text-theme-text truncate max-w-xs" title={name}>
                  {name}
                </td>
                <td className="py-1.5 text-right font-mono text-theme-accent">
                  {typeof value === 'number'
                    ? (Number.isInteger(value) ? value.toLocaleString() : value.toFixed(4))
                    : String(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})

// ============================================================================
// Model info panel
// ============================================================================

const ModelInfoPanel = memo(function ModelInfoPanel({ summary, metrics }) {
  const models = summary?.loaded_models || []
  const ctx = summary?.context_size || metrics?.n_ctx_total || null

  return (
    <div className="bg-theme-card border border-theme-border rounded-xl p-4">
      <p className="text-xs font-semibold text-theme-text-muted uppercase tracking-wide mb-3">Model Info</p>
      {models.length > 0 ? (
        <div className="space-y-2">
          {models.map(model => (
            <div
              key={model.id || model.raw_id}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${
                model.active
                  ? 'bg-emerald-500/10 border border-emerald-500/20'
                  : 'bg-theme-bg border border-theme-border/50'
              }`}
            >
              <span className={`h-2 w-2 rounded-full shrink-0 ${model.active ? 'bg-emerald-400' : 'bg-theme-text-muted/30'}`} />
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-theme-text truncate block" title={model.id}>
                  {shortModelName(model.id)}
                </span>
                {model.size_gb && (
                  <span className="text-[10px] text-theme-text-muted">{model.size_gb} GB</span>
                )}
              </div>
              {model.active && (
                <span className="text-[8px] font-semibold uppercase tracking-wide text-emerald-400">active</span>
              )}
            </div>
          ))}
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
// Main page
// ============================================================================

export default function InferenceAnalytics() {
  const { metrics, history, summary, loading, error } = useInferenceData()

  if (loading) {
    return (
      <div className="p-8 animate-pulse">
        <div className="h-8 bg-theme-card rounded w-1/4 mb-6" />
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
          {[...Array(6)].map((_, i) => <div key={i} className="h-20 bg-theme-card rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <div key={i} className="h-48 bg-theme-card rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (error && !metrics) {
    return (
      <div className="p-8">
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm">
          <Activity size={18} className="text-red-400 shrink-0" />
          <div>
            <p className="text-theme-text font-medium">Inference data unavailable</p>
            <p className="text-theme-text-muted mt-0.5">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  const tps = metrics?.tokens_per_second || 0
  const promptTps = metrics?.prompt_tokens_per_second || 0
  const kvUsage = metrics?.kv_cache_usage_ratio != null
    ? (metrics.kv_cache_usage_ratio * 100).toFixed(1)
    : '--'
  const activeRequests = metrics?.requests_processing || 0
  const lifetimeTokens = summary?.lifetime_tokens || 0
  const activeModel = summary?.active_model || null
  const ctxSize = summary?.context_size || metrics?.n_ctx_total || null
  const uptime = summary?.uptime || 0

  // Spec decode stats
  const draftAcceptance = metrics?.draft_acceptance_pct

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text flex items-center gap-2">
            <BarChart2 size={22} className="text-theme-accent" />
            Inference Analytics
          </h1>
          <p className="mt-1 text-sm text-theme-text-muted">
            Deep inference metrics and performance history
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono bg-theme-card border border-theme-border rounded-lg px-3 py-2 text-theme-text-muted">
          <RefreshCw size={12} className="text-theme-accent" />
          live &middot; 5s
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-8">
        <SummaryCard
          icon={Zap}
          label="Tokens/sec"
          value={tps || '--'}
          subvalue="generation speed"
        />
        <SummaryCard
          icon={Zap}
          label="Prompt tok/s"
          value={promptTps || '--'}
          subvalue="prompt processing"
        />
        <SummaryCard
          icon={Activity}
          label="Lifetime Tokens"
          value={formatTokenCount(lifetimeTokens)}
          subvalue="total generated"
        />
        <SummaryCard
          icon={Brain}
          label="Active Model"
          value={activeModel ? shortModelName(activeModel) : '--'}
          subvalue={ctxSize ? `${(ctxSize / 1024).toFixed(0)}k context` : ''}
        />
        <SummaryCard
          icon={Layers}
          label="KV Cache"
          value={`${kvUsage}%`}
          subvalue="context utilization"
        />
        <SummaryCard
          icon={Clock}
          label="Uptime"
          value={formatUptime(uptime)}
          subvalue="system"
        />
      </div>

      {/* Speculative decoding banner (if available) */}
      {draftAcceptance != null && (
        <div className="mb-6 p-3 bg-theme-card border border-theme-border rounded-xl flex items-center gap-3">
          <div className="p-2 bg-theme-accent/10 rounded-lg">
            <Zap size={16} className="text-theme-accent" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-theme-text">Speculative Decoding Active</p>
            <p className="text-[10px] text-theme-text-muted">
              Draft acceptance rate: <span className="font-mono text-theme-accent">{draftAcceptance}%</span>
              {' '} &middot; {' '}
              Drafted: <span className="font-mono">{formatTokenCount(metrics?.tokens_drafted_total || 0)}</span>
              {' '} &middot; {' '}
              Accepted: <span className="font-mono">{formatTokenCount(metrics?.tokens_drafted_accepted_total || 0)}</span>
            </p>
          </div>
        </div>
      )}

      {/* Time-series charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <TimeSeriesChart
          timestamps={history?.timestamps}
          values={history?.tps}
          label="Tokens / sec"
          unit="t/s"
          color="#818cf8"
        />
        <TimeSeriesChart
          timestamps={history?.timestamps}
          values={history?.kv_cache_usage}
          label="KV Cache Utilization"
          unit="%"
          color="#34d399"
          maxOverride={100}
        />
        <TimeSeriesChart
          timestamps={history?.timestamps}
          values={history?.active_requests}
          label="Active Requests"
          unit=""
          color="#fb923c"
        />
      </div>

      {/* Bottom row: model info + metrics table */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4">
        <ModelInfoPanel summary={summary} metrics={metrics} />
        <MetricsTable allMetrics={metrics?.all_metrics} />
      </div>
    </div>
  )
}
