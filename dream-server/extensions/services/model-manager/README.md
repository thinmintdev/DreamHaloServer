# Model Manager

Browse, load, unload, download, and delete AI models stored in the shared model directory. Integrates with LiteLLM to reflect which models are currently active.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/models` | List all model files with status |
| POST | `/api/models/{name}/load` | Signal LiteLLM to load a model |
| POST | `/api/models/{name}/unload` | Signal to unload a model |
| DELETE | `/api/models/{name}` | Delete a model file from disk |
| GET | `/api/models/{name}/logs` | Get log info for a model |
| POST | `/api/models/download` | Download a model file from a URL |

## Enable

```bash
dream enable model-manager
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_MODELS_PATH` | `./data/models` | Path to shared model storage directory |
| `LITELLM_URL` | `http://litellm:4000` | LiteLLM base URL |
| `LITELLM_KEY` | _(empty)_ | LiteLLM admin API key |
| `MODEL_MANAGER_PORT` | `3010` | External port to expose the API on |
