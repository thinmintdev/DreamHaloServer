import { useState, useEffect, useCallback } from 'react'
import {
  Brain,
  Search,
  Trash2,
  RefreshCw,
  Database,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileText,
  Clock,
  Tag,
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

export default function Memory() {
  const [collections, setCollections] = useState([])
  const [activeCollection, setActiveCollection] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [collectionInfo, setCollectionInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const fetchCollections = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetchJson('/api/memory/collections')
      if (!res.ok) throw new Error('Failed to fetch collections')
      const data = await res.json()
      setCollections(data.collections || [])
      if (!activeCollection && data.collections?.length) {
        setActiveCollection(data.collections[0].name)
      }
    } catch (err) {
      setError(err.name === 'AbortError' ? 'Request timed out' : err.message)
    } finally {
      setLoading(false)
    }
  }, [activeCollection])

  const fetchCollectionInfo = useCallback(async (name) => {
    try {
      const res = await fetchJson(`/api/memory/collections/${encodeURIComponent(name)}`)
      if (!res.ok) return
      setCollectionInfo(await res.json())
    } catch {
      // Non-critical — collection info is supplementary
    }
  }, [])

  useEffect(() => {
    fetchCollections()
  }, [fetchCollections])

  useEffect(() => {
    if (activeCollection) {
      fetchCollectionInfo(activeCollection)
      setSearchResults(null)
      setSearchQuery('')
    }
  }, [activeCollection, fetchCollectionInfo])

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!searchQuery.trim() || !activeCollection) return

    setSearching(true)
    try {
      const res = await fetchJson('/api/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: activeCollection,
          query: searchQuery.trim(),
          limit: 20,
        }),
      })
      if (!res.ok) throw new Error('Search failed')
      const data = await res.json()
      setSearchResults(data.results || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setSearching(false)
    }
  }

  const handleDeletePoint = async (collection, pointId) => {
    if (!confirm('Delete this memory point? This cannot be undone.')) return

    try {
      const res = await fetchJson(`/api/memory/collections/${encodeURIComponent(collection)}/points/${pointId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete point')
      setNotice({ type: 'info', text: 'Memory point deleted.' })
      // Refresh search results if we have them
      if (searchResults) {
        setSearchResults(prev => prev.filter(r => r.id !== pointId))
      }
      fetchCollectionInfo(collection)
    } catch (err) {
      setNotice({ type: 'danger', text: err.message })
    }
  }

  const handleCompactCollection = async (name) => {
    if (!confirm(`Compact collection "${name}"? This merges duplicate vectors and optimizes storage.`)) return

    try {
      setNotice({ type: 'info', text: `Compacting ${name}...` })
      const res = await fetchJson(`/api/memory/collections/${encodeURIComponent(name)}/compact`, {
        method: 'POST',
        timeout: 30000,
      })
      if (!res.ok) throw new Error('Compaction failed')
      const data = await res.json()
      setNotice({ type: 'info', text: data.message || 'Compaction complete.' })
      fetchCollectionInfo(name)
    } catch (err) {
      setNotice({ type: 'danger', text: err.message })
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-theme-accent" size={32} />
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text">Memory</h1>
          <p className="text-theme-text-muted mt-1">
            Browse and manage OpenClaw's vector memory collections.
          </p>
        </div>
        <button
          onClick={fetchCollections}
          className="text-sm text-theme-accent-light hover:text-theme-accent-light flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {error} — <button className="underline" onClick={fetchCollections}>Retry</button>
        </div>
      )}

      {notice && (
        <div className={`mb-6 rounded-xl border p-4 text-sm flex items-center justify-between ${
          notice.type === 'danger' ? 'border-red-500/20 bg-red-500/10 text-red-200' :
          'border-theme-accent/20 bg-theme-accent/10 text-theme-text'
        }`}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="ml-4 opacity-60 hover:opacity-100">×</button>
        </div>
      )}

      <div className="max-w-4xl">
        {/* Collection Selector */}
        {collections.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
            {/* Collections sidebar */}
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-theme-text-muted/70 px-1 mb-2">
                Collections
              </p>
              {collections.map((col) => (
                <button
                  key={col.name}
                  onClick={() => setActiveCollection(col.name)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                    activeCollection === col.name
                      ? 'border-theme-accent/30 bg-theme-accent/10 text-theme-text'
                      : 'border-theme-border bg-theme-card text-theme-text-muted hover:text-theme-text hover:border-theme-border'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Database size={14} className={activeCollection === col.name ? 'text-theme-accent' : 'text-theme-text-muted/50'} />
                    <span className="text-sm font-medium truncate">{col.name}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 ml-5 text-[10px] text-theme-text-muted/60">
                    <span>{col.points_count?.toLocaleString() || 0} points</span>
                    {col.vectors_count != null && (
                      <span>{col.vectors_count.toLocaleString()} vectors</span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Main panel */}
            <div className="space-y-4">
              {/* Collection stats */}
              {collectionInfo && (
                <div className="liquid-metal-frame bg-theme-card border border-theme-border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold text-theme-text flex items-center gap-2">
                      <Database size={18} className="text-theme-accent" />
                      {activeCollection}
                    </h2>
                    <button
                      onClick={() => handleCompactCollection(activeCollection)}
                      className="text-xs text-theme-accent-light hover:text-theme-accent flex items-center gap-1 transition-colors"
                    >
                      <RefreshCw size={12} />
                      Compact
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <StatBox label="Points" value={collectionInfo.points_count?.toLocaleString() || '0'} />
                    <StatBox label="Vectors" value={collectionInfo.vectors_count?.toLocaleString() || '0'} />
                    <StatBox label="Dimensions" value={collectionInfo.vector_size || '—'} />
                  </div>
                  {collectionInfo.disk_size_bytes != null && (
                    <p className="text-[10px] text-theme-text-muted/60 mt-2">
                      Storage: {(collectionInfo.disk_size_bytes / 1024 / 1024).toFixed(1)} MB on disk
                    </p>
                  )}
                </div>
              )}

              {/* Search */}
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-muted/50" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search memory by semantic query..."
                    className="w-full pl-9 pr-4 py-2.5 bg-theme-card border border-theme-border rounded-xl text-sm text-theme-text placeholder:text-theme-text-muted/40 focus:outline-none focus:border-theme-accent/40"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching || !searchQuery.trim()}
                  className="px-4 py-2 bg-theme-accent hover:bg-theme-accent-hover text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
                >
                  {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  Search
                </button>
              </form>

              {/* Results */}
              {searchResults && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-theme-text-muted/70">
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
                  </p>
                  {searchResults.length === 0 ? (
                    <p className="text-sm text-theme-text-muted py-8 text-center">
                      No memories found for this query.
                    </p>
                  ) : (
                    searchResults.map((result) => (
                      <MemoryPoint
                        key={result.id}
                        result={result}
                        collection={activeCollection}
                        onDelete={handleDeletePoint}
                      />
                    ))
                  )}
                </div>
              )}

              {!searchResults && (
                <div className="text-center py-12">
                  <Brain size={40} className="mx-auto text-theme-text-muted/20 mb-3" />
                  <p className="text-sm text-theme-text-muted">
                    Search to explore stored memories
                  </p>
                  <p className="text-xs text-theme-text-muted/60 mt-1">
                    Semantic search finds related memories by meaning, not just keywords
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-16">
            <Database size={48} className="mx-auto text-theme-text-muted/20 mb-4" />
            <h2 className="text-lg font-semibold text-theme-text mb-2">No Collections Found</h2>
            <p className="text-sm text-theme-text-muted">
              Vector memory collections will appear here once OpenClaw starts storing memories in Qdrant.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function StatBox({ label, value }) {
  return (
    <div className="bg-black/[0.1] border border-white/5 rounded-lg px-3 py-2">
      <p className="text-[9px] font-semibold uppercase tracking-[0.13em] text-theme-text-muted/55">{label}</p>
      <p className="text-lg font-bold text-theme-text font-mono">{value}</p>
    </div>
  )
}

function MemoryPoint({ result, collection, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const payload = result.payload || {}
  const text = payload.text || payload.content || payload.document || JSON.stringify(payload, null, 2)
  const truncated = text.length > 200
  const displayText = expanded ? text : text.slice(0, 200)
  const score = result.score != null ? (result.score * 100).toFixed(1) : null
  const metadata = payload.metadata || {}

  return (
    <div className="liquid-metal-frame bg-theme-card border border-theme-border rounded-xl p-3 group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Score badge + metadata */}
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            {score && (
              <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-theme-accent/15 text-theme-accent rounded">
                {score}% match
              </span>
            )}
            {metadata.source && (
              <span className="flex items-center gap-1 text-[10px] text-theme-text-muted/60">
                <FileText size={10} />
                {metadata.source}
              </span>
            )}
            {metadata.timestamp && (
              <span className="flex items-center gap-1 text-[10px] text-theme-text-muted/60">
                <Clock size={10} />
                {new Date(metadata.timestamp).toLocaleDateString()}
              </span>
            )}
            {metadata.tags?.length > 0 && metadata.tags.map((tag) => (
              <span key={tag} className="flex items-center gap-0.5 text-[10px] text-purple-400/70">
                <Tag size={9} />
                {tag}
              </span>
            ))}
          </div>

          {/* Content */}
          <p className="text-sm text-theme-text whitespace-pre-wrap break-words leading-relaxed">
            {displayText}
            {truncated && !expanded && '...'}
          </p>

          {truncated && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="mt-1 text-[10px] text-theme-accent-light hover:text-theme-accent flex items-center gap-0.5 transition-colors"
            >
              {expanded ? <><ChevronUp size={10} /> Show less</> : <><ChevronDown size={10} /> Show more</>}
            </button>
          )}
        </div>

        {/* Delete */}
        <button
          onClick={() => onDelete(collection, result.id)}
          className="p-1.5 text-theme-text-muted/30 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
          title="Delete memory point"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Point ID */}
      <p className="mt-1.5 text-[9px] font-mono text-theme-text-muted/30">
        id: {result.id}
      </p>
    </div>
  )
}
