# Open Interpreter

Let LLMs run code locally (Python, JavaScript, Shell). Provides a ChatGPT-like interface that can control Chrome, create/edit files, analyze datasets, and more — fully local, no API costs.

## Requirements

- **GPU:** CPU only — no GPU required
- **Dependencies:** None

## Enable / Disable

```bash
dream enable open-interpreter
dream disable open-interpreter
```

Your data is preserved when disabling. To re-enable later: `dream enable open-interpreter`

## Access

- **API:** `http://localhost:7805`

## First-Time Setup

1. Enable the service: `dream enable open-interpreter`
2. Use the REST API or run interactively via CLI

### API Usage

```bash
# Health check
curl http://localhost:7805/health

# Chat (non-streaming)
curl -X POST http://localhost:7805/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What OS are we running?", "stream": false}'
```

### CLI Usage

```bash
# Interactive session
docker compose run --rm open-interpreter

# Single command
docker compose run --rm open-interpreter -y "Create a file called test.txt"
```

## Configuration

| Variable | Description | Default |
|----------|------------|---------|
| `OPEN_INTERPRETER_API_KEY` | API key for authentication | _(required)_ |
