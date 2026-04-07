import { useState, useEffect, useCallback } from 'react'

// Mock data for development/demo - gated behind VITE_USE_MOCK_DATA env var
const USE_MOCK_DATA = import.meta.env.VITE_USE_MOCK_DATA === 'true'

function getMockModels() {
  return [
    {
      id: 'extra.Qwen3-Coder-Next-MXFP4_MOE.gguf',
      name: 'Qwen3 Coder Next',
      size: '24.0 GB',
      sizeGb: 24.0,
      vramRequired: 28,
      contextLength: 131072,
      specialty: 'Code',
      description: 'Next-gen MoE coding model with 128k context',
      tokensPerSec: 42,
      quantization: 'MXFP4',
      status: 'loaded',
      fitsVram: true,
      fitsCurrentVram: true,
    },
    {
      id: 'extra.Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf',
      name: 'Qwen3.5 35B A3B',
      size: '20.0 GB',
      sizeGb: 20.0,
      vramRequired: 24,
      contextLength: 131072,
      specialty: 'General',
      description: 'Strong general-purpose MoE model',
      tokensPerSec: 38,
      quantization: 'Q4_K_XL',
      status: 'downloaded',
      fitsVram: true,
      fitsCurrentVram: true,
    },
    {
      id: 'extra.GLM-4.7-Flash-UD-Q4_K_XL.gguf',
      name: 'GLM 4.7 Flash',
      size: '17.0 GB',
      sizeGb: 17.0,
      vramRequired: 20,
      contextLength: 131072,
      specialty: 'Fast',
      description: 'Ultra-fast flash model for quick tasks',
      tokensPerSec: 65,
      quantization: 'Q4_K_XL',
      status: 'loaded',
      fitsVram: true,
      fitsCurrentVram: true,
    },
    {
      id: 'extra.Devstral-Small-2507-Q4_K_M.gguf',
      name: 'Devstral Small',
      size: '14.0 GB',
      sizeGb: 14.0,
      vramRequired: 16,
      contextLength: 131072,
      specialty: 'Code',
      description: 'Mistral coding model, strong at agentic tasks',
      tokensPerSec: 55,
      quantization: 'Q4_K_M',
      status: 'available',
      fitsVram: true,
      fitsCurrentVram: true,
    },
  ]
}

const MOCK_GPU = { vramTotal: 96, vramUsed: 18.4, vramFree: 77.6 }
const MOCK_CURRENT_MODEL = 'extra.Qwen3-Coder-Next-MXFP4_MOE.gguf'

// Named export for dev-only mocking (explicit opt-in via VITE_USE_MOCK_DATA)
export { getMockModels }

export function useModels() {
  const [models, setModels] = useState(USE_MOCK_DATA ? getMockModels() : [])
  const [gpu, setGpu] = useState(USE_MOCK_DATA ? MOCK_GPU : null)
  const [currentModel, setCurrentModel] = useState(USE_MOCK_DATA ? MOCK_CURRENT_MODEL : null)
  const [loading, setLoading] = useState(USE_MOCK_DATA ? false : true)
  const [error, setError] = useState(null)
  const [actionLoading, setActionLoading] = useState(null)

  const fetchModels = useCallback(async () => {
    // If using mock data, don't attempt API call
    if (USE_MOCK_DATA) {
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/models')
      if (!response.ok) throw new Error('Failed to fetch models')
      const data = await response.json()
      setModels(data.models)
      setGpu(data.gpu)
      setCurrentModel(data.currentModel)
      setError(null)
    } catch (err) {
      setError(err.message)
      // No silent fallback - let error propagate to UI
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchModels()
    // Refresh every 30 seconds
    const interval = setInterval(fetchModels, 30000)
    return () => clearInterval(interval)
  }, [fetchModels])

  const downloadModel = async (modelId) => {
    setActionLoading(modelId)
    try {
      const response = await fetch(`/api/models/${encodeURIComponent(modelId)}/download`, {
        method: 'POST'
      })
      if (!response.ok) throw new Error('Failed to start download')
      await fetchModels() // Refresh
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const loadModel = async (modelId) => {
    setActionLoading(modelId)
    try {
      const response = await fetch(`/api/models/${encodeURIComponent(modelId)}/load`, {
        method: 'POST'
      })
      if (!response.ok) throw new Error('Failed to load model')
      await fetchModels() // Refresh
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  const deleteModel = async (modelId) => {
    if (!confirm(`Delete ${modelId}? This cannot be undone.`)) return
    
    setActionLoading(modelId)
    try {
      const response = await fetch(`/api/models/${encodeURIComponent(modelId)}`, {
        method: 'DELETE'
      })
      if (!response.ok) throw new Error('Failed to delete model')
      await fetchModels() // Refresh
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(null)
    }
  }

  return {
    models,
    gpu,
    currentModel,
    loading,
    error,
    actionLoading,
    downloadModel,
    loadModel,
    deleteModel,
    refresh: fetchModels
  }
}
