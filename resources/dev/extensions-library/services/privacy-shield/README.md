# Privacy Shield (PII Protection)

API proxy that sits between your applications and the LLM, automatically scrubbing Personally Identifiable Information (PII) before it leaves your server.

## Requirements

- **GPU:** NVIDIA or AMD
- **Dependencies:** llama-server

## Enable / Disable

```bash
dream enable privacy-shield
dream disable privacy-shield
```

Your data is preserved when disabling. To re-enable later: `dream enable privacy-shield`

## Access

- **API:** `http://localhost:7808`

## First-Time Setup

1. Enable the service: `dream enable privacy-shield`
2. Route your LLM requests through `http://localhost:7808/v1/chat/completions` instead of calling llama-server directly

### Example

```python
import requests

response = requests.post(
    "http://localhost:7808/v1/chat/completions",
    json={
        "model": "qwen2.5-32b-instruct",
        "messages": [{"role": "user", "content": "My email is john@example.com"}]
    }
)
# PII is scrubbed: "Your email is <EMAIL_ADDRESS>"
```

### PII Detection Coverage

| Type | Detected |
|------|----------|
| Email addresses | Yes |
| Phone numbers | Yes |
| SSN | Yes |
| Credit cards | Yes |
| IP addresses | Yes |
| API keys | Yes |
| Person names | No (requires NLP) |
| Addresses | No (requires NLP) |
