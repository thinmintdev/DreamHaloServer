import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Brain,
  FileText,
  Trash2,
  RefreshCw,
  Loader2,
  Plus,
  Save,
  X,
  ChevronRight,
  FolderOpen,
  Clock,
  Tag,
  Users,
  Edit3,
  Eye,
  Search,
  FolderPlus,
} from 'lucide-react'

const fetchJson = async (url, opts = {}) => {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), opts.timeout || 10000)
  try {
    return await fetch(url, { ...opts, signal: c.signal })
  } finally {
    clearTimeout(t)
  }
}

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference', '']

const TYPE_COLORS = {
  user: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  feedback: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  project: 'bg-green-500/15 text-green-400 border-green-500/20',
  reference: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
}

function formatTime(epoch) {
  if (!epoch) return ''
  const d = new Date(epoch * 1000)
  const now = new Date()
  const diffMs = now - d
  const diffH = Math.floor(diffMs / 3600000)
  if (diffH < 1) return `${Math.max(1, Math.floor(diffMs / 60000))}m ago`
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 7) return `${diffD}d ago`
  return d.toLocaleDateString()
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

/* ---------- Lightweight Markdown Renderer ---------- */

function renderMarkdown(text) {
  if (!text) return ''

  const escapeHtml = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Split into blocks, handling code blocks specially
  const blocks = []
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      blocks.push(
        `<pre class="bg-black/20 border border-white/5 rounded-lg p-3 my-2 overflow-x-auto"><code class="text-xs font-mono text-theme-text">${escapeHtml(codeLines.join('\n'))}</code></pre>`
      )
      continue
    }

    // Blank line
    if (line.trim() === '') {
      i++
      continue
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      const content = inlineMarkdown(escapeHtml(headingMatch[2]))
      const sizes = {
        1: 'text-xl font-bold',
        2: 'text-lg font-bold',
        3: 'text-base font-semibold',
        4: 'text-sm font-semibold',
        5: 'text-sm font-medium',
        6: 'text-xs font-medium',
      }
      blocks.push(
        `<div class="${sizes[level] || sizes[6]} text-theme-text mt-3 mb-1">${content}</div>`
      )
      i++
      continue
    }

    // Unordered list items (collect consecutive)
    if (line.match(/^\s*[-*+]\s/)) {
      const items = []
      while (i < lines.length && lines[i].match(/^\s*[-*+]\s/)) {
        items.push(inlineMarkdown(escapeHtml(lines[i].replace(/^\s*[-*+]\s+/, ''))))
        i++
      }
      blocks.push(
        `<ul class="list-disc list-inside space-y-0.5 my-1 text-sm text-theme-text">${items.map((it) => `<li>${it}</li>`).join('')}</ul>`
      )
      continue
    }

    // Ordered list items
    if (line.match(/^\s*\d+\.\s/)) {
      const items = []
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s/)) {
        items.push(inlineMarkdown(escapeHtml(lines[i].replace(/^\s*\d+\.\s+/, ''))))
        i++
      }
      blocks.push(
        `<ol class="list-decimal list-inside space-y-0.5 my-1 text-sm text-theme-text">${items.map((it) => `<li>${it}</li>`).join('')}</ol>`
      )
      continue
    }

    // Paragraph (collect until blank line or block element)
    const paraLines = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,6}\s/) &&
      !lines[i].trimStart().startsWith('```') &&
      !lines[i].match(/^\s*[-*+]\s/) &&
      !lines[i].match(/^\s*\d+\.\s/)
    ) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length) {
      blocks.push(
        `<p class="text-sm text-theme-text my-1">${inlineMarkdown(escapeHtml(paraLines.join(' ')))}</p>`
      )
    }
  }

  return blocks.join('\n')
}

function inlineMarkdown(text) {
  return text
    // inline code
    .replace(/`([^`]+)`/g, '<code class="bg-black/20 px-1 py-0.5 rounded text-xs font-mono text-theme-accent">$1</code>')
    // bold + italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // links
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" class="text-theme-accent underline hover:text-theme-accent-light" target="_blank" rel="noopener">$1</a>'
    )
}

/* ---------- Search Results Panel ---------- */

function SearchResults({ results, query, onOpenFile }) {
  if (!results.length) {
    return (
      <div className="text-center py-8">
        <Search size={24} className="mx-auto text-theme-text-muted/20 mb-2" />
        <p className="text-sm text-theme-text-muted">
          No results found for "<span className="text-theme-text">{query}</span>"
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {results.map((agentResult) => (
        <div key={agentResult.agent_id} className="bg-theme-card border border-theme-border rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-theme-border bg-black/[0.1]">
            <span className="text-sm font-semibold text-theme-accent">{agentResult.agent_id}</span>
            <span className="text-xs text-theme-text-muted ml-2">
              {agentResult.files.length} file{agentResult.files.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="divide-y divide-theme-border">
            {agentResult.files.map((fileResult, fi) => (
              <div key={fi} className="px-4 py-3">
                <button
                  onClick={() => onOpenFile(agentResult.agent_id, fileResult.file, fileResult.is_index)}
                  className="text-sm font-medium text-theme-text hover:text-theme-accent transition-colors flex items-center gap-1.5"
                >
                  <FileText size={13} className="text-theme-text-muted/50" />
                  {fileResult.file}
                </button>
                <div className="mt-2 space-y-1.5">
                  {fileResult.matches.map((match, mi) => (
                    <div
                      key={mi}
                      className="bg-black/[0.1] border border-white/5 rounded-lg px-3 py-2 text-xs font-mono text-theme-text-muted leading-relaxed"
                    >
                      <span className="text-theme-text-muted/40 mr-2">L{match.line}</span>
                      {match.snippet}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Create Workspace Modal ---------- */

function CreateWorkspaceModal({ onClose, onCreated }) {
  const [agentId, setAgentId] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  const handleCreate = async () => {
    if (!agentId.trim()) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetchJson('/api/memory/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId.trim() }),
        timeout: 15000,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to create workspace')
      }
      const data = await res.json()
      onCreated(data.agent_id)
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-theme-card border border-theme-border rounded-xl w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-theme-border">
          <div className="flex items-center gap-2">
            <FolderPlus size={18} className="text-theme-accent" />
            <h2 className="text-lg font-semibold text-theme-text">Create Workspace</h2>
          </div>
          <button onClick={onClose} className="p-1 text-theme-text-muted hover:text-theme-text rounded-lg transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-[0.13em] text-theme-text-muted/55 mb-1 block">
              Agent ID
            </label>
            <input
              type="text"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. researcher, planner"
              className="w-full px-3 py-2 bg-black/[0.15] border border-theme-border rounded-lg text-sm text-theme-text placeholder:text-theme-text-muted/40 focus:outline-none focus:border-theme-accent/40 font-mono"
              autoFocus
            />
            <p className="text-[10px] text-theme-text-muted/50 mt-1">
              Alphanumeric characters, hyphens, and underscores only.
            </p>
          </div>
          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-200">{error}</div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !agentId.trim()}
              className="px-3 py-1.5 text-sm bg-theme-accent hover:bg-theme-accent-hover text-white rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              {creating ? <Loader2 size={13} className="animate-spin" /> : <FolderPlus size={13} />}
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Main Component ---------- */

export default function Memory() {
  const [agents, setAgents] = useState([])
  const [activeAgent, setActiveAgent] = useState(null)
  const [files, setFiles] = useState([])
  const [activeFile, setActiveFile] = useState(null)
  const [fileContent, setFileContent] = useState(null)
  const [editContent, setEditContent] = useState('')
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [viewMode, setViewMode] = useState('rendered') // 'rendered' or 'raw'

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [searchExecuted, setSearchExecuted] = useState(false)

  // Create workspace modal
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)

  // Load agents
  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetchJson('/api/memory/agents')
      if (!res.ok) throw new Error('Failed to fetch agents')
      const data = await res.json()
      setAgents(data.agents || [])
      if (!activeAgent && data.agents?.length) {
        setActiveAgent(data.agents[0].id)
      }
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Request timed out' : err.message)
    } finally {
      setLoading(false)
    }
  }, [activeAgent])

  // Load files for active agent
  const fetchFiles = useCallback(async () => {
    if (!activeAgent) return
    try {
      const res = await fetchJson(`/api/memory/agents/${activeAgent}/files`)
      if (!res.ok) throw new Error('Failed to fetch files')
      const data = await res.json()
      setFiles(data.files || [])
    } catch (err) {
      setError(err.message)
    }
  }, [activeAgent])

  // Load a specific file
  const openFile = useCallback(async (path) => {
    try {
      const res = await fetchJson(`/api/memory/agents/${activeAgent}/files/${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error('Failed to read file')
      const data = await res.json()
      setFileContent(data)
      setEditContent(data.content)
      setActiveFile(path)
      setEditing(false)
      setCreating(false)
      setSearchResults(null)
      setSearchExecuted(false)
      setViewMode('rendered')
    } catch (err) {
      setError(err.message)
    }
  }, [activeAgent])

  // Search across all agents
  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim()
    if (!q) return
    setSearching(true)
    setSearchExecuted(true)
    try {
      const res = await fetchJson(`/api/memory/search?q=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      setSearchResults(data.results || [])
      setActiveFile(null)
      setFileContent(null)
      setCreating(false)
      setEditing(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  // Navigate from search result to a file
  const handleSearchOpenFile = useCallback(
    (agentId, filePath, isIndex) => {
      setActiveAgent(agentId)
      setSearchResults(null)
      setSearchExecuted(false)
      // Wait for agent switch, then open file
      setTimeout(() => {
        if (isIndex) {
          // Index files aren't in the memory/ dir list — just switch to agent
          // The user can view them via the existing index mechanism
        } else {
          openFile(filePath)
        }
      }, 200)
    },
    [openFile]
  )

  useEffect(() => { fetchAgents() }, [fetchAgents])
  useEffect(() => {
    if (activeAgent) {
      fetchFiles()
      setActiveFile(null)
      setFileContent(null)
      setEditing(false)
      setCreating(false)
    }
  }, [activeAgent, fetchFiles])

  const handleSave = async () => {
    const path = creating ? newFileName.replace(/^\/+/, '') : activeFile
    if (!path) return

    setSaving(true)
    try {
      const res = await fetchJson(`/api/memory/agents/${activeAgent}/files/${encodeURIComponent(path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
        timeout: 15000,
      })
      if (!res.ok) throw new Error('Save failed')
      setNotice({ type: 'info', text: creating ? 'Memory file created.' : 'Changes saved.' })
      setEditing(false)
      setCreating(false)
      await fetchFiles()
      await openFile(path)
      // Refresh agent stats
      const agentRes = await fetchJson('/api/memory/agents')
      if (agentRes.ok) {
        const data = await agentRes.json()
        setAgents(data.agents || [])
      }
    } catch (err) {
      setNotice({ type: 'danger', text: err.message })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (path) => {
    if (!confirm(`Delete "${path}"? This cannot be undone.`)) return

    try {
      const res = await fetchJson(`/api/memory/agents/${activeAgent}/files/${encodeURIComponent(path)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Delete failed')
      setNotice({ type: 'info', text: 'File deleted.' })
      if (activeFile === path) {
        setActiveFile(null)
        setFileContent(null)
      }
      await fetchFiles()
      const agentRes = await fetchJson('/api/memory/agents')
      if (agentRes.ok) {
        const data = await agentRes.json()
        setAgents(data.agents || [])
      }
    } catch (err) {
      setNotice({ type: 'danger', text: err.message })
    }
  }

  const startCreate = () => {
    setCreating(true)
    setEditing(true)
    setActiveFile(null)
    setFileContent(null)
    setNewFileName('')
    setSearchResults(null)
    setSearchExecuted(false)
    setEditContent(`---
name:
description:
type: user
---

`)
  }

  const handleRefresh = async () => {
    await fetchAgents()
    if (activeAgent) await fetchFiles()
  }

  const handleWorkspaceCreated = async (agentId) => {
    setShowCreateWorkspace(false)
    await fetchAgents()
    setActiveAgent(agentId)
    setNotice({ type: 'info', text: `Workspace "${agentId}" created.` })
  }

  const renderedContent = useMemo(() => {
    if (!fileContent?.content) return ''
    return renderMarkdown(fileContent.content)
  }, [fileContent?.content])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-theme-accent" size={32} />
      </div>
    )
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text">Memory</h1>
          <p className="text-theme-text-muted mt-1">
            Browse and manage OpenClaw agent memory files.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreateWorkspace(true)}
            className="text-sm text-theme-text-muted hover:text-theme-text bg-theme-card border border-theme-border hover:border-theme-border px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <FolderPlus size={14} />
            Create Workspace
          </button>
          <button
            onClick={startCreate}
            className="text-sm text-theme-text bg-theme-accent hover:bg-theme-accent-hover px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <Plus size={14} />
            New Memory
          </button>
          <button
            onClick={handleRefresh}
            className="text-sm text-theme-accent-light hover:text-theme-accent flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted/50" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search across all agents' memory files..."
              className="w-full pl-9 pr-3 py-2 bg-theme-card border border-theme-border rounded-lg text-sm text-theme-text placeholder:text-theme-text-muted/40 focus:outline-none focus:border-theme-accent/40"
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
            className="px-4 py-2 text-sm bg-theme-accent hover:bg-theme-accent-hover text-white rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Search
          </button>
          {searchExecuted && (
            <button
              onClick={() => { setSearchResults(null); setSearchExecuted(false); setSearchQuery('') }}
              className="px-3 py-2 text-sm text-theme-text-muted hover:text-theme-text rounded-lg transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {error} — <button className="underline" onClick={handleRefresh}>Retry</button>
        </div>
      )}

      {notice && (
        <div className={`mb-6 rounded-xl border p-4 text-sm flex items-center justify-between ${
          notice.type === 'danger' ? 'border-red-500/20 bg-red-500/10 text-red-200' :
          'border-theme-accent/20 bg-theme-accent/10 text-theme-text'
        }`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="ml-4 opacity-60 hover:opacity-100">x</button>
        </div>
      )}

      {/* Search Results View */}
      {searchExecuted && searchResults !== null ? (
        <SearchResults results={searchResults} query={searchQuery} onOpenFile={handleSearchOpenFile} />
      ) : (
        <>
          {/* Agent Tabs */}
          {agents.length > 0 && (
            <div className="flex items-center gap-2 mb-6 flex-wrap">
              <Users size={14} className="text-theme-text-muted/50" />
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setActiveAgent(agent.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    activeAgent === agent.id
                      ? 'bg-theme-accent/15 text-theme-accent border border-theme-accent/30'
                      : 'bg-theme-card text-theme-text-muted border border-theme-border hover:text-theme-text hover:border-theme-border'
                  }`}
                >
                  {agent.id}
                  <span className="ml-1.5 text-[10px] opacity-60">
                    {agent.files} file{agent.files !== 1 ? 's' : ''}
                  </span>
                </button>
              ))}
            </div>
          )}

          {agents.length === 0 && (
            <div className="text-center py-16">
              <Users size={48} className="mx-auto text-theme-text-muted/20 mb-4" />
              <h2 className="text-lg font-semibold text-theme-text mb-2">No Agent Workspaces Found</h2>
              <p className="text-sm text-theme-text-muted mb-4">
                No OpenClaw workspaces were detected. Create one to get started.
              </p>
              <button
                onClick={() => setShowCreateWorkspace(true)}
                className="text-sm bg-theme-accent hover:bg-theme-accent-hover text-white px-4 py-2 rounded-lg inline-flex items-center gap-1.5 transition-colors"
              >
                <FolderPlus size={14} />
                Create Workspace
              </button>
            </div>
          )}

          {/* Main Layout */}
          {agents.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
              {/* File List Sidebar */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-theme-text-muted/70 px-1 mb-2">
                  Memory Files
                </p>
                {files.length === 0 && !creating ? (
                  <div className="text-center py-8">
                    <FolderOpen size={24} className="mx-auto text-theme-text-muted/20 mb-2" />
                    <p className="text-xs text-theme-text-muted">No memory files yet</p>
                  </div>
                ) : (
                  files.map((file) => (
                    <button
                      key={file.path}
                      onClick={() => openFile(file.path)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all group ${
                        activeFile === file.path
                          ? 'border-theme-accent/30 bg-theme-accent/10 text-theme-text'
                          : 'border-theme-border bg-theme-card text-theme-text-muted hover:text-theme-text hover:border-theme-border'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText size={13} className={activeFile === file.path ? 'text-theme-accent shrink-0' : 'text-theme-text-muted/50 shrink-0'} />
                          <span className="text-sm font-medium truncate">{file.name || file.path}</span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(file.path) }}
                          className="p-1 text-theme-text-muted/30 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                          title="Delete file"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 mt-1 ml-5 flex-wrap">
                        {file.type && (
                          <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded border ${TYPE_COLORS[file.type] || 'bg-theme-border/50 text-theme-text-muted border-theme-border'}`}>
                            {file.type}
                          </span>
                        )}
                        <span className="text-[10px] text-theme-text-muted/50 flex items-center gap-0.5">
                          <Clock size={9} />
                          {formatTime(file.modified)}
                        </span>
                        <span className="text-[10px] text-theme-text-muted/50">
                          {formatSize(file.size)}
                        </span>
                      </div>
                      {file.description && (
                        <p className="text-[10px] text-theme-text-muted/50 mt-1 ml-5 truncate">
                          {file.description}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>

              {/* Content Panel */}
              <div>
                {creating ? (
                  <div className="liquid-metal-frame bg-theme-card border border-theme-border rounded-xl">
                    {/* Create header */}
                    <div className="flex items-center justify-between p-4 border-b border-theme-border">
                      <div className="flex items-center gap-3">
                        <Plus size={18} className="text-theme-accent" />
                        <h2 className="text-lg font-semibold text-theme-text">New Memory File</h2>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setCreating(false); setEditing(false) }}
                          className="px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={saving || !newFileName.trim()}
                          className="px-3 py-1.5 text-sm bg-theme-accent hover:bg-theme-accent-hover text-white rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                        >
                          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                          Create
                        </button>
                      </div>
                    </div>
                    <div className="p-4 space-y-3">
                      <div>
                        <label className="text-[10px] font-semibold uppercase tracking-[0.13em] text-theme-text-muted/55 mb-1 block">
                          File Path (relative to memory/)
                        </label>
                        <input
                          type="text"
                          value={newFileName}
                          onChange={(e) => setNewFileName(e.target.value)}
                          placeholder="e.g. platform/my-memory.md"
                          className="w-full px-3 py-2 bg-black/[0.15] border border-theme-border rounded-lg text-sm text-theme-text placeholder:text-theme-text-muted/40 focus:outline-none focus:border-theme-accent/40 font-mono"
                        />
                      </div>
                      <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full h-80 px-3 py-2 bg-black/[0.15] border border-theme-border rounded-lg text-sm text-theme-text font-mono leading-relaxed resize-y focus:outline-none focus:border-theme-accent/40"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                ) : activeFile && fileContent ? (
                  <div className="liquid-metal-frame bg-theme-card border border-theme-border rounded-xl">
                    {/* File header */}
                    <div className="flex items-center justify-between p-4 border-b border-theme-border">
                      <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-theme-text flex items-center gap-2">
                          <FileText size={18} className="text-theme-accent shrink-0" />
                          <span className="truncate">{fileContent.name || activeFile}</span>
                        </h2>
                        <div className="flex items-center gap-3 mt-1 ml-7">
                          <span className="text-[10px] text-theme-text-muted/60 font-mono">{activeFile}</span>
                          {fileContent.type && (
                            <span className={`px-1.5 py-0.5 text-[9px] font-semibold rounded border ${TYPE_COLORS[fileContent.type] || 'bg-theme-border/50 text-theme-text-muted border-theme-border'}`}>
                              {fileContent.type}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {editing ? (
                          <>
                            <button
                              onClick={() => { setEditing(false); setEditContent(fileContent.content) }}
                              className="px-3 py-1.5 text-sm text-theme-text-muted hover:text-theme-text rounded-lg transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleSave}
                              disabled={saving}
                              className="px-3 py-1.5 text-sm bg-theme-accent hover:bg-theme-accent-hover text-white rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                            >
                              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                              Save
                            </button>
                          </>
                        ) : (
                          <>
                            {/* View mode toggle */}
                            <div className="flex items-center border border-theme-border rounded-lg overflow-hidden mr-1">
                              <button
                                onClick={() => setViewMode('rendered')}
                                className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors ${
                                  viewMode === 'rendered'
                                    ? 'bg-theme-accent/15 text-theme-accent'
                                    : 'text-theme-text-muted hover:text-theme-text'
                                }`}
                                title="Rendered view"
                              >
                                <Eye size={12} />
                                Rendered
                              </button>
                              <button
                                onClick={() => setViewMode('raw')}
                                className={`px-2.5 py-1.5 text-xs flex items-center gap-1 transition-colors border-l border-theme-border ${
                                  viewMode === 'raw'
                                    ? 'bg-theme-accent/15 text-theme-accent'
                                    : 'text-theme-text-muted hover:text-theme-text'
                                }`}
                                title="Raw markdown"
                              >
                                <FileText size={12} />
                                Raw
                              </button>
                            </div>
                            <button
                              onClick={() => setEditing(true)}
                              className="px-3 py-1.5 text-sm text-theme-accent-light hover:text-theme-accent flex items-center gap-1.5 rounded-lg transition-colors"
                            >
                              <Edit3 size={13} />
                              Edit
                            </button>
                            <button
                              onClick={() => handleDelete(activeFile)}
                              className="p-1.5 text-theme-text-muted/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                              title="Delete file"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* File stats */}
                    <div className="grid grid-cols-3 gap-4 p-4 border-b border-theme-border">
                      <StatBox label="Size" value={formatSize(fileContent.size)} />
                      <StatBox label="Modified" value={formatTime(fileContent.modified)} />
                      <StatBox label="Type" value={fileContent.type || 'none'} />
                    </div>

                    {/* Content */}
                    <div className="p-4">
                      {editing ? (
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full h-96 px-3 py-2 bg-black/[0.15] border border-theme-border rounded-lg text-sm text-theme-text font-mono leading-relaxed resize-y focus:outline-none focus:border-theme-accent/40"
                          spellCheck={false}
                        />
                      ) : viewMode === 'rendered' ? (
                        <div
                          className="prose-custom leading-relaxed"
                          dangerouslySetInnerHTML={{ __html: renderedContent }}
                        />
                      ) : (
                        <pre className="text-sm text-theme-text whitespace-pre-wrap break-words leading-relaxed font-mono">
                          {fileContent.content}
                        </pre>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-16">
                    <Brain size={48} className="mx-auto text-theme-text-muted/20 mb-4" />
                    <h2 className="text-lg font-semibold text-theme-text mb-2">Agent Memory</h2>
                    <p className="text-sm text-theme-text-muted">
                      Select a memory file to view or edit, or create a new one.
                    </p>
                    <p className="text-xs text-theme-text-muted/60 mt-1">
                      Memory files persist context across OpenClaw sessions.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Create Workspace Modal */}
      {showCreateWorkspace && (
        <CreateWorkspaceModal
          onClose={() => setShowCreateWorkspace(false)}
          onCreated={handleWorkspaceCreated}
        />
      )}
    </div>
  )
}

function StatBox({ label, value }) {
  return (
    <div className="bg-black/[0.1] border border-white/5 rounded-lg px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-theme-text-muted/55">{label}</p>
      <p className="text-sm font-bold text-theme-text font-mono">{value}</p>
    </div>
  )
}
