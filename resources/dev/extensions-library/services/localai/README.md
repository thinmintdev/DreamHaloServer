# LocalAI

OpenAI-compatible local inference API. Run LLMs, generate images, audio, video, and clone voices — all through the same API format as OpenAI, entirely on your own hardware.

## Requirements

- **GPU:** NVIDIA or AMD (min 4 GB VRAM; CPU fallback available)
- **Dependencies:** llama-server

## Enable / Disable

```bash
dream enable localai
dream disable localai
```

Your data is preserved when disabling. To re-enable later: `dream enable localai`

## Access

- **URL:** `http://localhost:7803`

## First-Time Setup

1. Enable the service: `dream enable localai`
2. Open `http://localhost:7803` to access the web interface
3. Use the OpenAI-compatible API for integration with existing applications

### API Usage

```bash
# Chat completion (OpenAI-compatible)
curl -X POST http://localhost:7803/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello!"}]}'

# List available models
curl http://localhost:7803/v1/models
```
