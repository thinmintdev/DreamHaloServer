# 9Router — Claude API Proxy

9Router is a lightweight proxy that routes requests to Anthropic's Claude API.
It sits between LiteLLM and Anthropic, adding authentication and routing logic.

## Configuration

| Variable            | Description                          | Required |
|---------------------|--------------------------------------|----------|
| `NINEROUTER_API_KEY` | API key for authenticating requests | Yes      |
| `ANTHROPIC_API_KEY`  | Anthropic API key passed through    | Yes      |
| `NINEROUTER_PORT`    | External port (default: 8082)       | No       |

## Usage

Enable via dream-cli:

```bash
dream ext enable 9router
```

LiteLLM will route Claude model requests through `http://9router:8082/v1`.
See `dream-server/config/litellm/dreamhalo.yaml` for the matching LiteLLM config.
