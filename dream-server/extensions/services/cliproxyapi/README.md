# CLI Proxy API

Wraps Claude Code, Gemini CLI, and other AI CLIs as OpenAI-compatible API
endpoints. Uses your existing subscriptions (Claude Pro/Max, etc.) via OAuth
instead of API keys.

## Enable

```bash
dream enable cliproxyapi
dream start cliproxyapi
```

## First-time Setup

After starting, authenticate with Claude inside the container:

```bash
docker exec -it dream-cliproxyapi /CLIProxyAPI/CLIProxyAPI -no-browser --claude-login
```

Follow the OAuth flow to link your Claude subscription.

## API Endpoint

Once authenticated, the OpenAI-compatible API is at:

```
http://<host>:8317/v1
```

Point LiteLLM or other services to this endpoint.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CLIPROXYAPI_PORT` | `8317` | External port |

## Links

- [GitHub](https://github.com/router-for-me/CLIProxyAPI)
- [Docker Docs](https://help.router-for.me/docker/docker-compose)
