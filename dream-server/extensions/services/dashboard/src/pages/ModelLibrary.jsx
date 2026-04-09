import { useState, useEffect, useCallback, useRef, memo } from 'react'
import {
  Database, ScrollText, RefreshCw, HardDrive, FileText, Layers,
  ChevronDown, ChevronRight, Pause, Play, Plus, Download, Trash2,
  Power, PowerOff, Settings, Tag, Cpu, X, Check, AlertTriangle,
  Upload, Link, FolderOpen,
} from 'lucide-react'

// ============================================================================
// Helpers
// ============================================================================

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

function shortName(id) {
  if (!id) return ''
  return id.replace(/^(extra|user)\./i, '').replace(/\.gguf$/i, '')
    .replace(/[-_](UD[-_])?[A-Z0-9]+_K(_[A-Z0-9]+)?$/i, '')
    .replace(/[-_]MXFP\d+(_MOE)?$/i, '')
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

const TYPE_TAGS = ['chat', 'embedding', 'reranking', 'voice']
const BACKEND_OPTIONS = ['rocm', 'vulkan', 'cpu']

// ============================================================================
// Split group (existing, no changes needed)
// ============================================================================

function SplitGroup({ group }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border border-theme-border rounded-lg overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 p-3 hover:bg-theme-surface-hover transition-colors text-left">
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

// ============================================================================
// Model card with inline controls
// ============================================================================

function ModelFileCard({ file, loadedModels, modelConfig, onLoad, onUnload, onOpenSettings }) {
  const [showPath, setShowPath] = useState(false)
  const displayName = shortName(file.name) || file.name
  const isLoaded = loadedModels.some(m =>
    m.id?.includes(file.name) || m.raw_id?.includes(file.filename) || file.filename.includes(m.id || '')
  )
  const config = modelConfig[file.name] || modelConfig[displayName] || {}
  const tags = config.tags || []

  return (
    <div className={`p-3 border rounded-lg transition-colors ${
      file.broken ? 'border-red-500/30 opacity-60' : isLoaded ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-theme-border hover:border-theme-accent/30'
    }`}>
      <div className="flex items-center gap-3">
        <Database size={16} className={isLoaded ? 'text-emerald-400 shrink-0' : 'text-theme-accent shrink-0'} />
        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setShowPath(!showPath)}>
          <span className="text-sm font-medium text-theme-text truncate block">{displayName}</span>
          <div className="flex items-center gap-2 text-xs text-theme-text-muted mt-0.5">
            <span>{file.size_gb} GB</span>
            {file.quantization && <><span>&bull;</span><span className="text-theme-accent">{file.quantization}</span></>}
            {config.context_size && <><span>&bull;</span><span>{(config.context_size / 1024).toFixed(0)}k ctx</span></>}
            <span>&bull;</span>
            <span>{timeAgo(file.modified)}</span>
          </div>
        </div>

        {/* Inline action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isLoaded ? (
            <button
              onClick={() => onUnload(file)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
              title="Unload from VRAM"
            >
              <PowerOff size={11} /> Unload
            </button>
          ) : (
            <button
              onClick={() => onLoad(file)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
              title="Load into VRAM"
            >
              <Power size={11} /> Load
            </button>
          )}
          <button
            onClick={() => onOpenSettings(file)}
            className="p-1 rounded text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover transition-colors"
            title="Model settings"
          >
            <Settings size={13} />
          </button>
        </div>
      </div>

      {/* Tags row */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2 ml-7">
          {tags.map(t => (
            <span key={t} className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-theme-accent/10 text-theme-accent">{t}</span>
          ))}
        </div>
      )}

      {/* Path details */}
      {showPath && (
        <div className="mt-2 ml-7 text-[11px] font-mono text-theme-text-muted bg-theme-bg/80 rounded px-2 py-1 break-all space-y-0.5">
          <div>{file.abs_path}</div>
          {file.symlink && <div className="text-blue-400">&#x2192; {file.symlink_target}</div>}
          {file.broken && <div className="text-red-400">Broken symlink</div>}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Model settings modal
// ============================================================================

function ModelSettingsModal({ file, config, onClose, onSave, onDelete }) {
  const displayName = shortName(file.name) || file.name
  const [ctxSize, setCtxSize] = useState(config.context_size || '')
  const [backend, setBackend] = useState(config.backend || '')
  const [tags, setTags] = useState(config.tags || [])
  const [customTag, setCustomTag] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [showDelete, setShowDelete] = useState(false)

  const toggleTag = (tag) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const addCustomTag = () => {
    const t = customTag.trim().toLowerCase()
    if (t && !tags.includes(t)) {
      setTags([...tags, t])
      setCustomTag('')
    }
  }

  const handleSave = () => {
    onSave({
      model: file.name,
      context_size: ctxSize ? parseInt(ctxSize) : null,
      backend: backend || null,
      tags: tags.length > 0 ? tags : null,
    })
    onClose()
  }

  const handleDelete = () => {
    if (deleteConfirm === displayName) {
      onDelete(file)
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-theme-card border border-theme-border rounded-2xl w-full max-w-md mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-theme-border">
          <h3 className="text-sm font-semibold text-theme-text">{displayName} Settings</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-theme-surface-hover text-theme-text-muted"><X size={16} /></button>
        </div>
        <div className="p-4 space-y-4">
          {/* Context Size */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted block mb-1">Context Size (tokens)</label>
            <input
              type="number"
              value={ctxSize}
              onChange={e => setCtxSize(e.target.value)}
              placeholder="e.g. 131072"
              className="w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-sm font-mono text-theme-text placeholder:text-theme-text-muted/40 focus:border-theme-accent focus:outline-none"
            />
          </div>

          {/* Backend */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted block mb-1">Backend</label>
            <div className="flex gap-2">
              {BACKEND_OPTIONS.map(b => (
                <button
                  key={b}
                  onClick={() => setBackend(backend === b ? '' : b)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    backend === b
                      ? 'bg-theme-accent/20 text-theme-accent border border-theme-accent/30'
                      : 'bg-theme-bg border border-theme-border text-theme-text-muted hover:text-theme-text'
                  }`}
                >
                  {b.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Type Tags */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted block mb-1">Type Tags</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {TYPE_TAGS.map(t => (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                    tags.includes(t)
                      ? 'bg-theme-accent/20 text-theme-accent border border-theme-accent/30'
                      : 'bg-theme-bg border border-theme-border text-theme-text-muted hover:text-theme-text'
                  }`}
                >
                  {tags.includes(t) ? <Check size={10} /> : <Tag size={10} />}
                  {t}
                </button>
              ))}
            </div>
            {/* Custom tags */}
            {tags.filter(t => !TYPE_TAGS.includes(t)).map(t => (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 mr-1 mb-1 rounded text-xs bg-purple-500/15 text-purple-400">
                {t}
                <button onClick={() => setTags(tags.filter(x => x !== t))} className="hover:text-red-400"><X size={10} /></button>
              </span>
            ))}
            <div className="flex gap-1.5 mt-1">
              <input
                type="text"
                value={customTag}
                onChange={e => setCustomTag(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomTag()}
                placeholder="Custom tag..."
                className="flex-1 bg-theme-bg border border-theme-border rounded px-2 py-1 text-xs text-theme-text placeholder:text-theme-text-muted/40 focus:border-theme-accent focus:outline-none"
              />
              <button onClick={addCustomTag} className="px-2 py-1 rounded bg-theme-bg border border-theme-border text-xs text-theme-text-muted hover:text-theme-text">Add</button>
            </div>
          </div>

          {/* Delete section */}
          <div className="pt-3 border-t border-theme-border">
            {!showDelete ? (
              <button
                onClick={() => setShowDelete(true)}
                className="flex items-center gap-1.5 text-xs text-red-400/70 hover:text-red-400 transition-colors"
              >
                <Trash2 size={12} /> Delete this model...
              </button>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-red-400">
                  <AlertTriangle size={14} />
                  <span>Type <strong>{displayName}</strong> to confirm deletion</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={deleteConfirm}
                    onChange={e => setDeleteConfirm(e.target.value)}
                    placeholder={displayName}
                    className="flex-1 bg-red-500/5 border border-red-500/30 rounded px-2 py-1.5 text-xs font-mono text-theme-text placeholder:text-red-400/30 focus:outline-none"
                  />
                  <button
                    onClick={handleDelete}
                    disabled={deleteConfirm !== displayName}
                    className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                      deleteConfirm === displayName
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : 'bg-red-500/20 text-red-400/40 cursor-not-allowed'
                    }`}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t border-theme-border">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-medium bg-theme-bg border border-theme-border text-theme-text-muted hover:text-theme-text transition-colors">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 rounded-lg text-xs font-semibold bg-theme-accent/20 text-theme-accent border border-theme-accent/30 hover:bg-theme-accent/30 transition-colors">Save</button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Add model modal
// ============================================================================

function AddModelModal({ onClose, onPull }) {
  const [tab, setTab] = useState('pull')
  const [modelId, setModelId] = useState('')
  const [pullArgs, setPullArgs] = useState('')
  const [filePath, setFilePath] = useState('')
  const [pulling, setPulling] = useState(false)
  const [result, setResult] = useState(null)

  const handlePull = async () => {
    if (!modelId.trim()) return
    setPulling(true)
    setResult(null)
    try {
      const args = pullArgs.trim() ? pullArgs.trim().split(/\s+/) : undefined
      const res = await onPull(modelId.trim(), args)
      setResult({ ok: true, msg: res.output || 'Model pulled successfully' })
    } catch (err) {
      setResult({ ok: false, msg: err.message || 'Pull failed' })
    } finally {
      setPulling(false)
    }
  }

  const handleImport = async () => {
    if (!filePath.trim()) return
    setPulling(true)
    setResult(null)
    try {
      const name = filePath.split('/').pop().replace('.gguf', '')
      const args = ['--checkpoint', filePath.trim(), '--recipe', 'llamacpp']
      const res = await onPull(`user.${name}`, args)
      setResult({ ok: true, msg: res.output || 'Model imported successfully' })
    } catch (err) {
      setResult({ ok: false, msg: err.message || 'Import failed' })
    } finally {
      setPulling(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-theme-card border border-theme-border rounded-2xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-theme-border">
          <h3 className="text-sm font-semibold text-theme-text flex items-center gap-2"><Plus size={16} /> Add Model</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-theme-surface-hover text-theme-text-muted"><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-theme-border">
          <button onClick={() => setTab('pull')} className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${tab === 'pull' ? 'text-theme-accent border-b-2 border-theme-accent' : 'text-theme-text-muted hover:text-theme-text'}`}>
            <Download size={12} className="inline mr-1.5" /> Pull from Catalog
          </button>
          <button onClick={() => setTab('import')} className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${tab === 'import' ? 'text-theme-accent border-b-2 border-theme-accent' : 'text-theme-text-muted hover:text-theme-text'}`}>
            <FolderOpen size={12} className="inline mr-1.5" /> Import Local File
          </button>
        </div>

        <div className="p-4 space-y-3">
          {tab === 'pull' ? (
            <>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted block mb-1">Model Name or HuggingFace ID</label>
                <input
                  type="text"
                  value={modelId}
                  onChange={e => setModelId(e.target.value)}
                  placeholder="e.g. Qwen3-8B-GGUF or unsloth/Qwen3-8B-GGUF"
                  className="w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-sm font-mono text-theme-text placeholder:text-theme-text-muted/40 focus:border-theme-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted block mb-1">Extra Args (optional)</label>
                <input
                  type="text"
                  value={pullArgs}
                  onChange={e => setPullArgs(e.target.value)}
                  placeholder="e.g. --embedding --recipe llamacpp"
                  className="w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-xs font-mono text-theme-text placeholder:text-theme-text-muted/40 focus:border-theme-accent focus:outline-none"
                />
              </div>
              <button
                onClick={handlePull}
                disabled={!modelId.trim() || pulling}
                className="w-full py-2 rounded-lg text-xs font-semibold bg-theme-accent/20 text-theme-accent border border-theme-accent/30 hover:bg-theme-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {pulling ? 'Pulling...' : 'Pull Model'}
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-theme-text-muted block mb-1">File Path on Server</label>
                <input
                  type="text"
                  value={filePath}
                  onChange={e => setFilePath(e.target.value)}
                  placeholder="e.g. /mnt/ai-models/my-model.gguf"
                  className="w-full bg-theme-bg border border-theme-border rounded-lg px-3 py-2 text-sm font-mono text-theme-text placeholder:text-theme-text-muted/40 focus:border-theme-accent focus:outline-none"
                />
                <p className="text-[10px] text-theme-text-muted mt-1">Registers the file with Lemonade via <code className="text-theme-accent">lemonade-server pull</code></p>
              </div>
              <button
                onClick={handleImport}
                disabled={!filePath.trim() || pulling}
                className="w-full py-2 rounded-lg text-xs font-semibold bg-theme-accent/20 text-theme-accent border border-theme-accent/30 hover:bg-theme-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {pulling ? 'Importing...' : 'Import Model'}
              </button>
            </>
          )}

          {result && (
            <div className={`p-2 rounded-lg text-xs font-mono whitespace-pre-wrap ${result.ok ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
              {result.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main page
// ============================================================================

export default function ModelLibrary() {
  const [files, setFiles] = useState([])
  const [meta, setMeta] = useState(null)
  const [logs, setLogs] = useState('')
  const [loading, setLoading] = useState(true)
  const [logsLoading, setLogsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [logsError, setLogsError] = useState(null)
  const [logsPaused, setLogsPaused] = useState(false)
  const [loadedModels, setLoadedModels] = useState([])
  const [modelConfig, setModelConfig] = useState({})
  const [settingsFile, setSettingsFile] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [actionMsg, setActionMsg] = useState(null)
  const logsEndRef = useRef(null)
  const logsPausedRef = useRef(false)

  logsPausedRef.current = logsPaused

  const fetchFiles = useCallback(async () => {
    try {
      const [filesRes, summaryRes, configRes] = await Promise.all([
        fetch('/api/model-library/files'),
        fetch('/api/inference/summary'),
        fetch('/api/model-library/config'),
      ])
      if (filesRes.ok) {
        const data = await filesRes.json()
        setFiles(data.files || [])
        setMeta({ models_dir: data.models_dir, total_files: data.total_files, total_size_gb: data.total_size_gb })
      }
      if (summaryRes.ok) {
        const s = await summaryRes.json()
        setLoadedModels(s.loaded_models || [])
      }
      if (configRes.ok) setModelConfig(await configRes.json())
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
    const logInterval = setInterval(fetchLogs, 5000)
    const fileInterval = setInterval(fetchFiles, 15000)
    return () => { clearInterval(logInterval); clearInterval(fileInterval) }
  }, [fetchFiles, fetchLogs])

  useEffect(() => {
    if (!logsPaused && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, logsPaused])

  const flash = (msg, isError = false) => {
    setActionMsg({ msg, isError })
    setTimeout(() => setActionMsg(null), 4000)
  }

  const handleLoad = async (file) => {
    try {
      const lemonadeId = `extra.${file.filename}`
      const res = await fetch('/api/model-library/load', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: lemonadeId }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Load failed')
      flash(`Loading ${shortName(file.name)}...`)
      setTimeout(fetchFiles, 3000)
    } catch (err) { flash(err.message, true) }
  }

  const handleUnload = async (file) => {
    try {
      const lemonadeId = `extra.${file.filename}`
      const res = await fetch('/api/model-library/unload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: lemonadeId }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Unload failed')
      flash(`Unloaded ${shortName(file.name)}`)
      setTimeout(fetchFiles, 2000)
    } catch (err) { flash(err.message, true) }
  }

  const handleSaveConfig = async (patch) => {
    try {
      const res = await fetch('/api/model-library/config', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error('Save failed')
      flash('Settings saved')
      fetchFiles()
    } catch (err) { flash(err.message, true) }
  }

  const handleDelete = async (file) => {
    try {
      const res = await fetch('/api/model-library/delete', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: file.name, confirm: true }),
      })
      if (!res.ok) throw new Error((await res.json()).detail || 'Delete failed')
      flash(`Deleted ${shortName(file.name)}`)
      setTimeout(fetchFiles, 2000)
    } catch (err) { flash(err.message, true) }
  }

  const handlePull = async (modelId, args) => {
    const res = await fetch('/api/model-library/pull', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, args }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || `Pull failed: HTTP ${res.status}`)
    }
    const data = await res.json()
    setTimeout(fetchFiles, 3000)
    return data
  }

  const { standalone, splitGroups } = groupModels(files)

  if (loading) {
    return (
      <div className="p-8 animate-pulse">
        <div className="h-8 bg-theme-card rounded w-1/3 mb-8" />
        <div className="flex gap-6">
          <div className="w-[40%] space-y-4">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-theme-card rounded-xl" />)}</div>
          <div className="w-[60%] h-96 bg-theme-card rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 h-[calc(100vh-0px)] flex flex-col">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-theme-text">Model Library</h1>
          <p className="text-theme-text-muted mt-1">Manage models, configure settings, and monitor inference logs.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-theme-accent/20 text-theme-accent border border-theme-accent/30 hover:bg-theme-accent/30 transition-colors"
          >
            <Plus size={14} /> Add Model
          </button>
          <button onClick={() => { fetchFiles(); fetchLogs() }} className="p-2 text-theme-text-muted hover:text-theme-text hover:bg-theme-surface-hover rounded-lg transition-colors" title="Refresh">
            <RefreshCw size={20} />
          </button>
        </div>
      </div>

      {/* Flash message */}
      {actionMsg && (
        <div className={`mb-4 p-2.5 rounded-xl text-xs font-medium shrink-0 ${actionMsg.isError ? 'bg-red-500/10 border border-red-500/30 text-red-400' : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'}`}>
          {actionMsg.msg}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm shrink-0">{error}</div>
      )}

      {/* Main layout: 40% models / 60% logs */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* Left Column — Models (40%) */}
        <div className="w-[40%] flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <HardDrive size={18} className="text-theme-accent" />
              <h2 className="text-lg font-semibold text-theme-text">Models</h2>
            </div>
            {meta && (
              <span className="text-xs text-theme-text-muted">{meta.total_files} files &bull; {meta.total_size_gb} GB</span>
            )}
          </div>

          {meta && (
            <div className="mb-3 p-2 bg-theme-card border border-theme-border rounded-lg text-xs text-theme-text-muted font-mono">
              <span className="text-theme-accent">DIR</span> {meta.models_dir}
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {standalone.map(f => (
              <ModelFileCard
                key={f.filename}
                file={f}
                loadedModels={loadedModels}
                modelConfig={modelConfig}
                onLoad={handleLoad}
                onUnload={handleUnload}
                onOpenSettings={setSettingsFile}
              />
            ))}
            {splitGroups.map(g => <SplitGroup key={g.name} group={g} />)}
            {files.length === 0 && (
              <div className="text-center py-8 text-theme-text-muted">
                No model files found. Click <strong>Add Model</strong> to get started.
              </div>
            )}
          </div>
        </div>

        {/* Right Column — Logs (60%) */}
        <div className="w-[60%] flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ScrollText size={18} className="text-green-400" />
              <h2 className="text-lg font-semibold text-theme-text">llama-server Logs</h2>
              {!logsPaused && (
                <span className="flex items-center gap-1 text-xs text-green-400">
                  <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" /> LIVE
                </span>
              )}
            </div>
            <button
              onClick={() => setLogsPaused(p => !p)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                logsPaused ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' : 'bg-theme-card text-theme-text-muted hover:text-theme-text'
              }`}
            >
              {logsPaused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
            </button>
          </div>

          {logsError && (
            <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-xs">{logsError}</div>
          )}

          <div className="flex-1 bg-[#0d1117] border border-theme-border rounded-xl p-4 overflow-y-auto font-mono text-xs leading-5">
            {logsLoading ? (
              <div className="text-theme-text-muted animate-pulse">Loading logs...</div>
            ) : (
              <>
                {logs.split('\n').map((line, i) => (
                  <div key={i} className={`whitespace-pre-wrap break-all ${
                    line.includes('error') || line.includes('ERROR') ? 'text-red-400'
                      : line.includes('warn') || line.includes('WARN') ? 'text-yellow-400'
                      : line.includes('model loaded') || line.includes('server listening') ? 'text-green-400'
                      : 'text-zinc-400'
                  }`}>{line}</div>
                ))}
                <div ref={logsEndRef} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Settings modal */}
      {settingsFile && (
        <ModelSettingsModal
          file={settingsFile}
          config={modelConfig[settingsFile.name] || modelConfig[shortName(settingsFile.name)] || {}}
          onClose={() => setSettingsFile(null)}
          onSave={handleSaveConfig}
          onDelete={handleDelete}
        />
      )}

      {/* Add model modal */}
      {showAddModal && (
        <AddModelModal
          onClose={() => setShowAddModal(false)}
          onPull={handlePull}
        />
      )}
    </div>
  )
}
