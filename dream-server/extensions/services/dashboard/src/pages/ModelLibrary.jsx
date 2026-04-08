import { useState, useEffect, useCallback, useRef } from 'react'
import { Database, ScrollText, RefreshCw, HardDrive, FileText, Layers, ChevronDown, ChevronRight, Pause, Play } from 'lucide-react'

function formatBytes(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

function timeAgo(mtime) {
  const diff = Date.now() / 1000 - mtime
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function groupModels(files) {
  const groups = new Map()
  const standalone = []

  for (const f of files) {
    if (f.is_split) {
      const key = f.filename.replace(/-\d{5}-of-\d{5}/, '')
      if (!groups.has(key)) {
        groups.set(key, { name: f.name.replace(/-\d{5}-of-\d{5}/, ''), parts: [], totalBytes: 0, quantization: f.quantization, modified: f.modified, path: f.path.replace(f.filename, '') })
      }
      const g = groups.get(key)
      g.parts.push(f)
      g.totalBytes += f.size_bytes
      g.modified = Math.max(g.modified, f.modified)
    } else {
      standalone.push(f)
    }
  }

  return { standalone, splitGroups: [...groups.values()] }
}

function SplitGroup({ group }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border border-theme-border rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 hover:bg-theme-surface-hover transition-colors text-left"
      >
        {expanded ? <ChevronDown size={14} className="text-theme-text-muted shrink-0" /> : <ChevronRight size={14} className="text-theme-text-muted shrink-0" />}
        <Layers size={16} className="text-purple-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-theme-text truncate block">{group.name}</span>
          <span className="text-xs text-theme-text-muted">
            {group.parts.length} parts &bull; {formatBytes(group.totalBytes)}
            {group.quantization && <> &bull; <span className="text-theme-accent">{group.quantization}</span></>}
          </span>
        </div>
        <span className="text-xs text-theme-text-muted shrink-0">{timeAgo(group.modified)}</span>
      </button>
      {expanded && (
        <div className="border-t border-theme-border bg-theme-bg/50">
          {group.parts.sort((a, b) => a.split_part - b.split_part).map(f => (
            <div key={f.filename} className="flex items-center gap-3 px-3 py-1.5 text-xs border-b border-theme-border/50 last:border-0">
              <FileText size={12} className="text-theme-text-muted shrink-0 ml-7" />
              <span className="text-theme-text-muted font-mono truncate flex-1">{f.filename}</span>
              <span className="text-theme-text-muted shrink-0">Part {f.split_part}/{f.split_total}</span>
              <span className="text-theme-text-muted shrink-0">{formatBytes(f.size_bytes)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ModelFileCard({ file }) {
  const [showPath, setShowPath] = useState(false)

  return (
    <div
      className={`flex items-center gap-3 p-3 border rounded-lg hover:border-theme-accent/30 transition-colors cursor-pointer ${
        file.broken ? 'border-red-500/30 opacity-60' : 'border-theme-border'
      }`}
      onClick={() => setShowPath(!showPath)}
    >
      <Database size={16} className="text-theme-accent shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-theme-text truncate block">{file.name}</span>
        <div className="flex items-center gap-2 text-xs text-theme-text-muted mt-0.5">
          <span>{file.size_gb} GB</span>
          {file.quantization && (
            <>
              <span>&bull;</span>
              <span className="text-theme-accent">{file.quantization}</span>
            </>
          )}
          <span>&bull;</span>
          <span>{timeAgo(file.modified)}</span>
        </div>
        {showPath && (
          <div className="mt-1.5 text-[11px] font-mono text-theme-text-muted bg-theme-bg/80 rounded px-2 py-1 break-all space-y-0.5">
            <div>{file.abs_path}</div>
            {file.symlink && <div className="text-blue-400">&#x2192; {file.symlink_target}</div>}
            {file.broken && <div className="text-red-400">Broken symlink — target not accessible</div>}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ModelLibrary() {
  const [files, setFiles] = useState([])
  const [meta, setMeta] = useState(null)
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(true)
  const [logsLoading, setLogsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [logsError, setLogsError] = useState(null)
  const [logsPaused, setLogsPaused] = useState(false)
  const logsEndRef = useRef(null)
  const logsContainerRef = useRef(null)
  const logsPausedRef = useRef(false)

  logsPausedRef.current = logsPaused

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/model-library/files')
      if (!res.ok) throw new Error('Failed to fetch model files')
      const data = await res.json()
      setFiles(data.files || [])
      setMeta({ models_dir: data.models_dir, total_files: data.total_files, total_size_gb: data.total_size_gb })
      setError(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchLogs = useCallback(async () => {
    if (logsPausedRef.current) return
    try {
      const res = await fetch('/api/model-library/logs?tail=200')
      if (!res.ok) throw new Error('Failed to fetch logs')
      const data = await res.json()
      setLogs(data.logs || 'No logs available.')
      setLogsError(null)
    } catch (err) {
      setLogsError(err.message)
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFiles()
    fetchLogs()
    const interval = setInterval(fetchLogs, 5000)
    return () => clearInterval(interval)
  }, [fetchFiles, fetchLogs])

  useEffect(() => {
    if (!logsPaused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, logsPaused])

  const { standalone, splitGroups } = groupModels(files)

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-theme-card rounded w-1/3 mb-8" />
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-theme-card rounded-xl" />)}
            </div>
            <div className="h-96 bg-theme-card rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 h-[calc(100vh-0px)] flex flex-col">
      <div className="mb-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-theme-text">Model Library</h1>
          <p className="text-theme-text-muted mt-1">
            Downloaded model files and live inference logs.
          </p>
        </div>
        <button
          onClick={() => { fetchFiles(); fetchLogs() }}
          className="p-2 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw size={20} />
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm shrink-0">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6 flex-1 min-h-0">
        {/* Left Column - Model Files */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <HardDrive size={18} className="text-theme-accent" />
              <h2 className="text-lg font-semibold text-theme-text">Downloaded Models</h2>
            </div>
            {meta && (
              <span className="text-xs text-theme-text-muted">
                {meta.total_files} files &bull; {meta.total_size_gb} GB total
              </span>
            )}
          </div>

          {meta && (
            <div className="mb-3 p-2 bg-theme-card border border-theme-border rounded-lg text-xs text-theme-text-muted font-mono">
              <span className="text-theme-accent">DIR</span> {meta.models_dir}
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {standalone.map(f => (
              <ModelFileCard key={f.filename} file={f} />
            ))}
            {splitGroups.map(g => (
              <SplitGroup key={g.name} group={g} />
            ))}
            {files.length === 0 && (
              <div className="text-center py-8 text-theme-text-muted">
                No model files found in {meta?.models_dir || 'models directory'}.
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Live Logs */}
        <div className="flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ScrollText size={18} className="text-green-400" />
              <h2 className="text-lg font-semibold text-theme-text">llama-server Logs</h2>
              {!logsPaused && (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
                  LIVE
                </span>
              )}
            </div>
            <button
              onClick={() => setLogsPaused(p => !p)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                logsPaused
                  ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                  : 'bg-theme-card text-theme-text-muted hover:text-theme-text'
              }`}
              title={logsPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
            >
              {logsPaused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
            </button>
          </div>

          {logsError && (
            <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">
              {logsError}
            </div>
          )}

          <div
            ref={logsContainerRef}
            className="flex-1 bg-[#0d1117] border border-theme-border rounded-xl p-4 overflow-y-auto font-mono text-xs leading-5"
          >
            {logsLoading ? (
              <div className="text-theme-text-muted animate-pulse">Loading logs...</div>
            ) : (
              <>
                {logs.split('\n').map((line, i) => (
                  <div
                    key={i}
                    className={`whitespace-pre-wrap break-all ${
                      line.includes('error') || line.includes('ERROR')
                        ? 'text-red-400'
                        : line.includes('warn') || line.includes('WARN')
                        ? 'text-yellow-400'
                        : line.includes('model loaded') || line.includes('server listening')
                        ? 'text-green-400'
                        : 'text-zinc-400'
                    }`}
                  >
                    {line}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
