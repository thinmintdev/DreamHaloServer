import { coreRoutes, coreExternalLinks } from './core'
import {
  MessageSquare, Network, Bot, Terminal, Search, Image, ExternalLink
} from 'lucide-react'

const ICON_MAP = {
  MessageSquare, Network, Bot, Terminal, Search, Image, ExternalLink,
}

const routeExtensions = []
const externalLinkExtensions = []

export function registerRoutes(routes = []) {
  routeExtensions.push(...routes)
}

export function registerExternalLinks(links = []) {
  externalLinkExtensions.push(...links)
}

/**
 * Flatten routes: top-level routes + children from groups.
 * Group parents with no component are excluded from route rendering
 * but kept for sidebar grouping.
 */
export function getInternalRoutes(context = {}) {
  const allRoutes = [...coreRoutes, ...routeExtensions]
  const flat = []
  for (const route of allRoutes) {
    const enabled = typeof route.enabled === 'function' ? route.enabled(context) : true
    if (!enabled) continue
    // Add the route itself if it has a component
    if (route.component) {
      flat.push(route)
    }
    // Add children
    if (route.children) {
      for (const child of route.children) {
        const childEnabled = typeof child.enabled === 'function' ? child.enabled(context) : true
        if (childEnabled) flat.push(child)
      }
    }
  }
  return flat.sort((a, b) => (a.order || 0) - (b.order || 0))
}

/**
 * Return sidebar nav items, preserving group structure for expandable sections.
 */
export function getSidebarNavItems(context = {}) {
  const allRoutes = [...coreRoutes, ...routeExtensions]
  return allRoutes
    .filter(route => {
      const enabled = typeof route.enabled === 'function' ? route.enabled(context) : true
      if (!enabled) return false
      if (typeof route.sidebar === 'function') return route.sidebar(context)
      return route.sidebar !== false
    })
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(route => {
      const item = {
        id: route.id,
        path: route.path,
        label: route.label,
        icon: route.icon,
      }
      if (route.children) {
        item.children = route.children.map(child => ({
          id: child.id,
          path: child.path,
          label: child.label,
          icon: child.icon,
        }))
      }
      return item
    })
}

function isServiceHealthy(status, needles = []) {
  const services = status?.services || []
  return needles.some(needle =>
    services.some(s => (s.name || '').toLowerCase().includes(needle.toLowerCase()) && s.status === 'healthy')
  )
}

export function getSidebarExternalLinks(context = {}) {
  const { status, getExternalUrl, apiLinks = [] } = context
  // Merge static plugin links with API-fetched links
  const allLinks = [...coreExternalLinks, ...externalLinkExtensions, ...apiLinks]
  // Deduplicate by id (API links take priority)
  const seen = new Set()
  const deduped = []
  for (const link of allLinks.reverse()) {
    if (!seen.has(link.id)) {
      seen.add(link.id)
      deduped.unshift(link)
    }
  }
  return deduped.map(link => {
    const healthy = link.alwaysHealthy ? true : isServiceHealthy(status, link.healthNeedles || [])
    return {
      key: link.id,
      label: link.label,
      icon: typeof link.icon === 'string' ? (ICON_MAP[link.icon] || ExternalLink) : (link.icon || ExternalLink),
      healthy,
      url: (typeof getExternalUrl === 'function' ? getExternalUrl(link.port) : `http://localhost:${link.port}`) + (link.ui_path && link.ui_path !== '/' ? link.ui_path : ''),
    }
  })
}
