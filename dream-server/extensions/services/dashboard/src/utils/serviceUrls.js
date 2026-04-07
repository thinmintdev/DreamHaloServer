/**
 * Service URL generation — supports clean SSL subdomains or port-based fallback.
 *
 * When VITE_DREAM_DOMAIN is set (e.g. "dreamhalo.localhost"), services are
 * accessed via https://<service>.dreamhalo.localhost (Caddy auto-TLS).
 * Otherwise falls back to http://<hostname>:<port>.
 */

const DREAM_DOMAIN = import.meta.env.VITE_DREAM_DOMAIN || ''

// Map service IDs / ports to clean subdomain names
const SUBDOMAIN_MAP = {
  3000: 'chat',
  3001: 'dashboard',
  3002: 'api',
  4000: 'llm',
  5678: 'workflows',
  6333: 'vectors',
  7860: 'agent',
  8080: 'inference',
  8085: 'shield',
  8188: 'studio',
  8888: 'search',
  9000: 'stt',
  8880: 'tts',
  3004: 'perplexica',
  3005: 'tokenspy',
  3003: 'code',
}

/**
 * Build an external URL for a service.
 * @param {number} port - The service's external port
 * @param {object} [opts] - Optional overrides
 * @param {string} [opts.subdomain] - Explicit subdomain override
 * @returns {string} Full URL
 */
export function getServiceUrl(port, opts = {}) {
  if (DREAM_DOMAIN) {
    const sub = opts.subdomain || SUBDOMAIN_MAP[port] || `svc-${port}`
    return `https://${sub}.${DREAM_DOMAIN}`
  }
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return `http://${hostname}:${port}`
}

/**
 * Check if we're using SSL subdomain mode.
 */
export function isSSLMode() {
  return !!DREAM_DOMAIN
}

/**
 * Get the display label for a service URL (clean domain or :port).
 */
export function getServiceUrlLabel(port) {
  if (DREAM_DOMAIN) {
    const sub = SUBDOMAIN_MAP[port] || `svc-${port}`
    return `${sub}.${DREAM_DOMAIN}`
  }
  return `:${port}`
}
