import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  ScrollText, Pause, Play, Trash2, ArrowDown, Search, X,
} from 'lucide-react'

const LEVEL_STYLES = {
  error: {
    badge: 'text-red-400',
    message: 'text-red-200',
    bg: 'bg-red-500/[0.04]',
    border: 'border-l-red-500',
  },
  warn: {
    badge: 'text-yellow-400',
    message: 'text-yellow-200/90',
    bg: 'bg-yellow-500/[0.03]',
    border: 'border-l-yellow-500',
  },
  debug: {
    badge: 'text-gray-500',
    message: 'text-gray-400',
    bg: '',
    border: 'border-l-gray-600',
  },
  info: {
    badge: 'text-blue-400',
    message: 'text-theme-text',
    bg: '',
    border: 'border-l-blue-500/50',
  },
}

function formatTime(timestamp) {
  if (!timestamp) return '--:--:--'
  try {
    const d = new Date(timestamp)
    if (isNaN(d.getTime())) return timestamp.slice(11, 19) || '--:--:--'
    return d.toLocaleTimeString('en-US', { hour12: false })
  } catch {
    return '--:--:--'
  }
}

function LogLine({ entry, index }) {
  const style = LEVEL_STYLES[entry.level] || LEVEL_STYLES.info
  const isEven = index % 2 === 0

  return (
    <div
      className={`flex items-start gap-0 px-4 py-[3px] font-mono text-[13px] leading-5 border-l-2 ${style.border} ${style.bg} ${isEven ? 'bg-white/[0.008]' : ''}`}
    >
      <span className="text-theme-text-muted/60 text-xs shrink-0 w-[72px] tabular-nums">
        {formatTime(entry.timestamp)}
      </span>
      <span className={`w-[52px] shrink-0 font-bold text-xs uppercase ${style.badge}`}>
        {entry.level}
      </span>
      <span className="text-theme-text-muted/30 shrink-0 mr-2">▸</span>
      <span className={`break-all whitespace-pre-wrap ${style.message}`}>
        {entry.line}
      </span>
    </div>
  )
}


export default function Logs() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialContainer = searchParams.get('container') || ''

  const [containers, setContainers] = useState([])
  const [selectedContainer, setSelectedContainer] = useState(initialContainer)
  const [logs, setLogs] = useState([])
  const [paused, setPaused] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const [tailLines, setTailLines] = useState(200)
  const [connected, setConnected] = useState(false)

  const logRef = useRef(null)
  const eventSourceRef = useRef(null)
  const pausedRef = useRef(paused)
  const bufferRef = useRef([])

  // Keep pausedRef in sync
  useEffect(() => { pausedRef.current = paused }, [paused])

  // Load container list
  useEffect(() => {
    fetch('/api/containers')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setContainers(data)
        // Auto-select first running container if none selected
        if (!selectedContainer && data.length > 0) {
          const running = data.find(c => c.status === 'running')
          const first = running || data[0]
          setSelectedContainer(first.name)
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Connect to log stream
  useEffect(() => {
    if (!selectedContainer) return

    // Update URL
    setSearchParams({ container: selectedContainer }, { replace: true })

    const connect = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }

      setLogs([])
      bufferRef.current = []
      setConnected(false)

      const url = `/api/containers/${encodeURIComponent(selectedContainer)}/logs?tail=${tailLines}&follow=true`
      const es = new EventSource(url)
      eventSourceRef.current = es

      es.onopen = () => setConnected(true)

      es.onmessage = (event) => {
        try {
          const entry = JSON.parse(event.data)
          if (pausedRef.current) {
            bufferRef.current.push(entry)
          } else {
            setLogs(prev => {
              const next = [...prev, entry]
              // Cap at 5000 lines to prevent memory bloat
              return next.length > 5000 ? next.slice(-4000) : next
            })
          }
        } catch {
          // skip malformed
        }
      }

      es.onerror = () => {
        setConnected(false)
        es.close()
      }
    }

    connect()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [selectedContainer, tailLines]) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush buffer when unpaused
  useEffect(() => {
    if (!paused && bufferRef.current.length > 0) {
      setLogs(prev => {
        const next = [...prev, ...bufferRef.current]
        bufferRef.current = []
        return next.length > 5000 ? next.slice(-4000) : next
      })
    }
  }, [paused])

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs, autoScroll])

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!logRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = logRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40
    setAutoScroll(isAtBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
      setAutoScroll(true)
    }
  }, [])

  const clearLogs = () => {
    setLogs([])
    bufferRef.current = []
  }

  const togglePause = () => {
    setPaused(p => !p)
  }

  const filteredLogs = useMemo(() => {
    if (!filter) return logs
    const q = filter.toLowerCase()
    return logs.filter(l => l.line.toLowerCase().includes(q) || l.level.includes(q))
  }, [logs, filter])

  const levelCounts = useMemo(() => {
    const counts = { error: 0, warn: 0, info: 0, debug: 0 }
    for (const l of logs) {
      counts[l.level] = (counts[l.level] || 0) + 1
    }
    return counts
  }, [logs])

  return (
    <div className="p-8 flex flex-col" style={{ height: 'calc(100vh - 0px)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-theme-text flex items-center gap-3">
            <ScrollText size={28} />
            Container Logs
          </h1>
          <p className="text-theme-text-muted mt-1">Live log streaming with prettified output</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500/60'}`} />
          <span className="text-xs text-theme-text-muted">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4 shrink-0 flex-wrap">
        {/* Container selector */}
        <select
          value={selectedContainer}
          onChange={e => setSelectedContainer(e.target.value)}
          className="px-3 py-2 rounded-lg bg-theme-card border border-theme-border text-theme-text text-sm focus:outline-none focus:border-theme-accent/50 min-w-[200px]"
        >
          <option value="">Select container...</option>
          {containers.map(c => (
            <option key={c.name} value={c.name}>
              {c.name.replace(/^dream-/, '')} {c.status === 'running' ? '' : `(${c.status})`}
            </option>
          ))}
        </select>

        {/* Tail lines */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-theme-text-muted">Tail:</span>
          <input
            type="number"
            value={tailLines}
            onChange={e => setTailLines(Math.max(1, Math.min(10000, parseInt(e.target.value) || 100)))}
            className="w-20 px-2 py-2 rounded-lg bg-theme-card border border-theme-border text-theme-text text-sm text-center focus:outline-none"
          />
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted" />
          <input
            type="text"
            placeholder="Filter logs..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="w-full pl-9 pr-8 py-2 rounded-lg bg-theme-card border border-theme-border text-theme-text placeholder-theme-text-muted text-sm focus:outline-none focus:border-theme-accent/50"
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-theme-text-muted hover:text-theme-text"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {/* Pause/Resume */}
          <button
            onClick={togglePause}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${
              paused
                ? 'border-yellow-500/40 text-yellow-400 bg-yellow-500/10'
                : 'border-theme-border text-theme-text-muted hover:text-theme-text'
            }`}
            title={paused ? 'Resume' : 'Pause'}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
            {paused ? 'Resume' : 'Pause'}
            {paused && bufferRef.current.length > 0 && (
              <span className="text-xs opacity-60">({bufferRef.current.length})</span>
            )}
          </button>

          {/* Clear */}
          <button
            onClick={clearLogs}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-theme-border text-theme-text-muted hover:text-theme-text text-sm transition-colors"
            title="Clear logs"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Level counts */}
      <div className="flex items-center gap-4 mb-3 shrink-0">
        <span className="text-xs text-theme-text-muted">{filteredLogs.length} lines</span>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-red-400">{levelCounts.error} errors</span>
          <span className="text-yellow-400">{levelCounts.warn} warnings</span>
          <span className="text-blue-400">{levelCounts.info} info</span>
          <span className="text-gray-500">{levelCounts.debug} debug</span>
        </div>
      </div>

      {/* Log output */}
      <div className="flex-1 relative min-h-0">
        <div
          ref={logRef}
          onScroll={handleScroll}
          className="absolute inset-0 overflow-auto rounded-xl border border-theme-border bg-black/40 liquid-metal-frame"
        >
          {filteredLogs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-theme-text-muted text-sm">
              {selectedContainer ? 'Waiting for logs...' : 'Select a container to view logs'}
            </div>
          ) : (
            <div className="py-2">
              {filteredLogs.map((entry, i) => (
                <LogLine key={i} entry={entry} index={i} />
              ))}
            </div>
          )}
        </div>

        {/* Scroll to bottom FAB */}
        {!autoScroll && filteredLogs.length > 0 && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-theme-accent text-white text-sm shadow-lg hover:bg-theme-accent/80 transition-colors"
          >
            <ArrowDown size={14} />
            Latest
          </button>
        )}
      </div>
    </div>
  )
}
