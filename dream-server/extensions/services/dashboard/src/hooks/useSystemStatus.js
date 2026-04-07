import { useState, useEffect, useRef } from 'react'

const POLL_INTERVAL = 5000 // 5 seconds

// Mock data for development/demo - gated behind VITE_USE_MOCK_DATA env var
const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === 'true'

// Mock data for development/demo
function getMockStatus() {
  return {
    gpu: {
      name: 'AMD Radeon RX 7900 XTX',
      vramUsed: 18.4,
      vramTotal: 96,
      utilization: 32,
      temperature: 58,
      memoryType: 'unified',
      backend: 'amd',
      gpu_count: 1,
    },
    services: [
      { name: 'Lemonade', status: 'healthy', port: 8080, uptime: 14400 },
      { name: 'Open WebUI', status: 'healthy', port: 3000, uptime: 14400 },
      { name: 'LiteLLM', status: 'healthy', port: 4000, uptime: 14400 },
      { name: 'OpenClaw', status: 'healthy', port: 7860, uptime: 14400 },
      { name: 'Qdrant', status: 'healthy', port: 6333, uptime: 14400 },
      { name: 'SearXNG', status: 'healthy', port: 8888, uptime: 14400 },
      { name: 'Whisper (STT)', status: 'healthy', port: 9000, uptime: 14400 },
      { name: 'Kokoro (TTS)', status: 'healthy', port: 8880, uptime: 14400 },
      { name: 'n8n', status: 'healthy', port: 5678, uptime: 14400 },
    ],
    model: {
      name: 'extra.Qwen3-Coder-Next-MXFP4_MOE.gguf',
      tokensPerSecond: 42,
      contextLength: 131072,
    },
    bootstrap: null,
    uptime: 14400,
    version: '2.0.0',
    tier: 'Strix Halo 90+',
    cpu: { percent: 18, temp_c: 52 },
    ram: { used_gb: 22.4, total_gb: 96, percent: 23.3 },
    inference: {
      tokensPerSecond: 42,
      lifetimeTokens: 2_850_000,
      loadedModel: 'extra.Qwen3-Coder-Next-MXFP4_MOE.gguf',
      loadedModels: [
        { id: 'extra.Qwen3-Coder-Next-MXFP4_MOE.gguf', active: true },
        { id: 'extra.GLM-4.7-Flash-UD-Q4_K_XL.gguf', active: false },
        { id: 'user.nomic-embed', active: false },
      ],
      contextSize: 131072,
    },
  }
}

const MOCK_STATUS = getMockStatus()

// Named export for dev-only mocking (explicit opt-in via VITE_USE_MOCK_DATA)
export { getMockStatus }

export function useSystemStatus() {
  const [status, setStatus] = useState(USE_MOCK_DATA ? MOCK_STATUS : {
    gpu: null,
    services: [],
    model: null,
    bootstrap: null,
    uptime: 0
  })
  const [loading, setLoading] = useState(!USE_MOCK_DATA)
  const [error, setError] = useState(null)
  // Guard against overlapping fetches — if the API is slow (e.g.
  // llama-server under inference load) we skip the next poll rather
  // than stacking concurrent requests that can amplify the problem.
  const fetchInFlight = useRef(false)

  useEffect(() => {
    const fetchStatus = async () => {
      if (USE_MOCK_DATA) {
        setLoading(false)
        return
      }

      // Pause polling when the tab is hidden to save CPU/network
      if (document.hidden) return

      // Skip this tick if the previous fetch hasn't returned yet.
      if (fetchInFlight.current) return
      fetchInFlight.current = true

      try {
        const response = await fetch('/api/status')
        if (!response.ok) throw new Error('Failed to fetch status')
        const data = await response.json()
        setStatus(data)
        setError(null)
      } catch (err) {
        setError(err.message)
      } finally {
        fetchInFlight.current = false
        setLoading(false)
      }
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, POLL_INTERVAL)

    // Resume immediately when the tab becomes visible again
    const onVisibility = () => { if (!document.hidden) fetchStatus() }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return { status, loading, error }
}
