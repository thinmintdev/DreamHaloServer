import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  LayoutDashboard,
  Database,
  Brain,
  Puzzle,
  Settings,
  Activity,
  Map as MapIcon,
  BarChart3,
  ExternalLink,
  RotateCcw,
  RefreshCw,
  Download,
  PanelLeftClose,
  Check,
  Cpu,
  Command,
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
} from 'lucide-react'
import { useCommandPalette } from '../hooks/useCommandPalette'
import { getServiceUrl } from '../utils/serviceUrls'

// ---------------------------------------------------------------------------
// Fuzzy match — simple substring/character-order match with scoring
// ---------------------------------------------------------------------------

function fuzzyMatch(query, text) {
  if (!query) return { match: true, score: 0 }
  const lower = text.toLowerCase()
  const q = query.toLowerCase()

  // Exact substring match scores highest
  if (lower.includes(q)) {
    return { match: true, score: lower.indexOf(q) === 0 ? 2 : 1 }
  }

  // Character-order match (each query char appears in order in text)
  let qi = 0
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++
  }
  if (qi === q.length) return { match: true, score: 0.5 }

  return { match: false, score: 0 }
}

// ---------------------------------------------------------------------------
// Navigation commands (static)
// ---------------------------------------------------------------------------

const NAVIGATION_COMMANDS = [
  { id: 'nav-dashboard',  label: 'Go to Dashboard',           path: '/',              icon: LayoutDashboard, category: 'Navigation' },
  { id: 'nav-models',     label: 'Go to Model Library',       path: '/model-library', icon: Database,        category: 'Navigation' },
  { id: 'nav-memory',     label: 'Go to Memory',              path: '/memory',        icon: Brain,           category: 'Navigation' },
  { id: 'nav-extensions', label: 'Go to Extensions',          path: '/extensions',    icon: Puzzle,          category: 'Navigation' },
  { id: 'nav-settings',   label: 'Go to Settings',            path: '/settings',      icon: Settings,        category: 'Navigation' },
  { id: 'nav-gpu',        label: 'Go to GPU Monitor',         path: '/gpu',           icon: Activity,        category: 'Navigation' },
  { id: 'nav-service-map',label: 'Go to Service Map',         path: '/service-map',   icon: MapIcon,         category: 'Navigation' },
  { id: 'nav-analytics',  label: 'Go to Inference Analytics', path: '/analytics',     icon: BarChart3,       category: 'Navigation' },
]

// ---------------------------------------------------------------------------
// Action commands (static)
// ---------------------------------------------------------------------------

const ACTION_COMMANDS = [
  { id: 'action-check-updates', label: 'Check for Updates',       icon: Download,        category: 'Actions' },
  { id: 'action-export-config', label: 'Export Configuration',     icon: Download,        category: 'Actions' },
  { id: 'action-refresh',       label: 'Refresh All Data',        icon: RefreshCw,       category: 'Actions' },
  { id: 'action-toggle-sidebar',label: 'Toggle Sidebar',          icon: PanelLeftClose,  category: 'Actions' },
]

// ---------------------------------------------------------------------------
// Build dynamic commands from status data
// ---------------------------------------------------------------------------

function buildServiceCommands(services) {
  if (!services?.length) return []
  const deployed = services.filter(s => s.status !== 'not_deployed')
  const commands = []
  for (const svc of deployed) {
    if (svc.port) {
      commands.push({
        id: `svc-open-${svc.name}`,
        label: `Open ${svc.name}`,
        icon: ExternalLink,
        category: 'Services',
        servicePort: svc.port,
      })
    }
    commands.push({
      id: `svc-restart-${svc.name}`,
      label: `Restart ${svc.name}`,
      icon: RotateCcw,
      category: 'Services',
      serviceName: svc.name,
    })
  }
  return commands
}

function buildModelCommands(status) {
  const models = status?.inference?.loadedModels
  if (!models?.length) return []
  return models.map(m => ({
    id: `model-switch-${m.id}`,
    label: `Switch to ${m.id}`,
    icon: Cpu,
    category: 'Models',
    modelId: m.id,
    isActive: m.active,
  }))
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CommandPalette() {
  const { isOpen, close } = useCommandPalette()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [status, setStatus] = useState(null)
  const [toast, setToast] = useState(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const navigate = useNavigate()

  // ---- Fetch status when palette opens ----
  useEffect(() => {
    if (!isOpen) return
    setQuery('')
    setSelectedIndex(0)
    fetch('/api/status')
      .then(r => r.ok ? r.json() : null)
      .then(setStatus)
      .catch(() => {})
  }, [isOpen])

  // ---- Auto-focus input on open ----
  useEffect(() => {
    if (isOpen) {
      // Small delay to let the DOM render before focusing
      const id = requestAnimationFrame(() => inputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [isOpen])

  // ---- Build command list ----
  const allCommands = useMemo(() => [
    ...NAVIGATION_COMMANDS,
    ...buildServiceCommands(status?.services),
    ...buildModelCommands(status),
    ...ACTION_COMMANDS,
  ], [status])

  // ---- Filtered + grouped results ----
  const filtered = useMemo(() => {
    const results = []
    for (const cmd of allCommands) {
      const { match, score } = fuzzyMatch(query, cmd.label)
      if (match) results.push({ ...cmd, _score: score })
    }
    results.sort((a, b) => b._score - a._score)
    return results
  }, [allCommands, query])

  // Group by category, preserving filter order within each group
  const grouped = useMemo(() => {
    const categoryOrder = ['Navigation', 'Services', 'Models', 'Actions']
    const map = new Map()
    for (const cmd of filtered) {
      if (!map.has(cmd.category)) map.set(cmd.category, [])
      map.get(cmd.category).push(cmd)
    }
    const result = []
    for (const cat of categoryOrder) {
      if (map.has(cat)) result.push({ category: cat, items: map.get(cat) })
    }
    return result
  }, [filtered])

  // Flat list for keyboard navigation index
  const flatItems = useMemo(() => grouped.flatMap(g => g.items), [grouped])

  // ---- Reset selection when filter changes ----
  useEffect(() => { setSelectedIndex(0) }, [query])

  // ---- Scroll selected item into view ----
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector('[data-selected="true"]')
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // ---- Toast auto-dismiss ----
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  // ---- Execute a command ----
  const execute = useCallback(async (cmd) => {
    // Navigation
    if (cmd.path) {
      navigate(cmd.path)
      close()
      return
    }

    // Open service URL
    if (cmd.servicePort) {
      window.open(getServiceUrl(cmd.servicePort), '_blank', 'noopener,noreferrer')
      close()
      return
    }

    // Restart service (with confirmation)
    if (cmd.serviceName) {
      if (!confirm(`Restart ${cmd.serviceName}?`)) return
      try {
        await fetch('/api/services/restart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ service: cmd.serviceName }),
        })
        setToast(`Restart requested for ${cmd.serviceName}`)
      } catch {
        setToast(`Failed to restart ${cmd.serviceName}`)
      }
      close()
      return
    }

    // Switch model
    if (cmd.modelId) {
      close()
      try {
        const res = await fetch(`/api/models/${encodeURIComponent(cmd.modelId)}/load`, { method: 'POST' })
        if (!res.ok) throw new Error()
        setToast(`Loading ${cmd.modelId}...`)
      } catch {
        setToast(`Failed to load ${cmd.modelId}`)
      }
      return
    }

    // Actions
    switch (cmd.id) {
      case 'action-check-updates': {
        close()
        try {
          const res = await fetch('/api/version')
          const data = await res.json()
          if (data.update_available) {
            setToast(`Update available: ${data.latest} (current: ${data.current})`)
          } else {
            setToast(`Up to date (${data.current || data.version || 'unknown'})`)
          }
        } catch {
          setToast('Failed to check for updates')
        }
        return
      }
      case 'action-export-config': {
        close()
        try {
          const res = await fetch('/api/status')
          const data = await res.json()
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `dream-server-config-${new Date().toISOString().slice(0, 10)}.json`
          a.click()
          URL.revokeObjectURL(url)
          setToast('Configuration exported')
        } catch {
          setToast('Failed to export configuration')
        }
        return
      }
      case 'action-refresh':
        close()
        window.location.reload()
        return
      case 'action-toggle-sidebar':
        // Dispatch a custom event that App.jsx can listen for
        window.dispatchEvent(new CustomEvent('dream:toggle-sidebar'))
        close()
        return
      default:
        break
    }
  }, [navigate, close])

  // ---- Keyboard navigation ----
  const handleKeyDown = useCallback((e) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, flatItems.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (flatItems[selectedIndex]) execute(flatItems[selectedIndex])
        break
      case 'Escape':
        e.preventDefault()
        close()
        break
      default:
        break
    }
  }, [flatItems, selectedIndex, execute, close])

  // ---- Render nothing when closed (but keep hook active for shortcut) ----
  if (!isOpen) {
    return toast ? <Toast message={toast} /> : null
  }

  let runningIndex = -1

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-[15vh] animate-palette-fade-in"
        onClick={close}
      >
        {/* Palette container */}
        <div
          className="w-full max-w-lg bg-theme-card border border-theme-border rounded-xl shadow-2xl overflow-hidden animate-palette-scale-in"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-theme-border">
            <Search size={18} className="text-theme-text-muted shrink-0" />
            <input
              ref={inputRef}
              type="text"
              className="flex-1 bg-transparent text-theme-text text-base placeholder:text-theme-text-muted outline-none"
              placeholder="Type a command..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-theme-text-muted border border-theme-border bg-theme-bg">
              ESC
            </kbd>
          </div>

          {/* Results list */}
          <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
            {flatItems.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-theme-text-muted">
                No commands found
              </div>
            )}

            {grouped.map(({ category, items }) => (
              <div key={category}>
                <div className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-theme-text-muted">
                  {category}
                </div>
                {items.map((cmd) => {
                  runningIndex++
                  const idx = runningIndex
                  const isSelected = idx === selectedIndex
                  const Icon = cmd.icon
                  return (
                    <button
                      key={cmd.id}
                      data-selected={isSelected}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                        isSelected
                          ? 'bg-theme-accent/20 text-theme-text'
                          : 'text-theme-text-muted hover:bg-white/[0.04] hover:text-theme-text'
                      }`}
                      onClick={() => execute(cmd)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="flex-1 text-sm truncate">{cmd.label}</span>
                      {cmd.isActive && (
                        <Check size={14} className="text-green-400 shrink-0" />
                      )}
                      <span className="text-[10px] font-mono uppercase tracking-wider text-theme-text-muted/60 shrink-0">
                        {cmd.category}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Footer hints */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-theme-border text-[10px] text-theme-text-muted">
            <span className="inline-flex items-center gap-1">
              <ArrowUp size={10} /><ArrowDown size={10} /> navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <CornerDownLeft size={10} /> select
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded border border-theme-border bg-theme-bg font-mono text-[9px]">esc</kbd> close
            </span>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast} />}

      {/* Inline keyframes — scoped so they don't require global CSS changes */}
      <style>{`
        @keyframes palette-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes palette-scale-in {
          from { opacity: 0; transform: scale(0.96) translateY(-8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        .animate-palette-fade-in  { animation: palette-fade-in  150ms ease-out; }
        .animate-palette-scale-in { animation: palette-scale-in 150ms ease-out; }
      `}</style>
    </>
  )
}

// ---------------------------------------------------------------------------
// Toast notification (shown after actions complete)
// ---------------------------------------------------------------------------

function Toast({ message }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-lg bg-theme-card border border-theme-border shadow-lg text-sm text-theme-text animate-palette-fade-in">
      {message}
      <style>{`
        @keyframes palette-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
        .animate-palette-fade-in { animation: palette-fade-in 150ms ease-out; }
      `}</style>
    </div>
  )
}
