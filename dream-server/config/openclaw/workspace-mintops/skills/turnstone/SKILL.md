---
name: turnstone
description: Turnstone orchestration for MintOps. Triggers on "turnstone", "workstream", "orchestrate", "turnstone audit", "turnstone health", "infra research", "parallel investigation". Use Turnstone to dispatch autonomous infra investigations, run parallel health audits, and leverage web search + vector search via MCP tools.
---

# Turnstone Orchestration (MintOps)

Dispatch autonomous tasks to Turnstone for infrastructure operations that benefit from multi-tool reasoning, web research, or parallel execution. Turnstone runs at `http://turnstone:8080` with 19 built-in tools + 3 MCP servers (Proxmox, Qdrant, SearXNG).

## When to Use Turnstone vs Direct Tools

| Use Turnstone | Use Direct Tools |
|---------------|------------------|
| Multi-step investigation needing web + infra context | Simple `mcporter call proxmox.get_nodes` |
| Parallel research across multiple topics | Single Proxmox operation |
| Autonomous audit that runs while you do other work | Quick health check |
| Tasks needing Turnstone's built-in web_search/memory | SSH commands to LXC 201 |

## Quick Reference

```bash
# Auth (store for session)
TOKEN=$(curl -sf http://turnstone:8080/v1/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<password>"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
AUTH="-H 'Authorization: Bearer $TOKEN'"

# Create workstream + send task
WS=$(curl -sf $AUTH http://turnstone:8080/v1/api/workstreams/new \
  -H 'Content-Type: application/json' \
  -d '{"name": "infra-audit"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['ws_id'])")

curl -sf $AUTH http://turnstone:8080/v1/api/send \
  -H 'Content-Type: application/json' \
  -d "{\"ws_id\": \"$WS\", \"content\": \"<task description>\"}"

# Check status
curl -sf $AUTH http://turnstone:8080/v1/api/workstreams

# Close when done
curl -sf $AUTH http://turnstone:8080/v1/api/workstreams/close \
  -H 'Content-Type: application/json' -d "{\"ws_id\": \"$WS\"}"
```

## MCP Tools Turnstone Can Use

- **Proxmox** (`mcp__proxmox__*`): All 35 Proxmox tools — same as your mcporter tools
- **Qdrant** (`mcp__qdrant__*`): `list_collections`, `collection_info`, `semantic_search`, `scroll_collection`
- **SearXNG** (`mcp__searxng__*`): `web_search`, `news_search`

## MintOps Recipes

### Infrastructure Audit Workstream

```bash
curl -sf $AUTH http://turnstone:8080/v1/api/send \
  -H 'Content-Type: application/json' \
  -d "{\"ws_id\": \"$WS\", \"content\": \"Run a full infrastructure audit: 1) Get Proxmox node status and resource usage via MCP. 2) List all LXC containers and their states. 3) Check storage pools for capacity. 4) Search the web for any known CVEs or advisories for our stack versions (Proxmox 8, Qdrant 1.16, n8n 2.6). Report findings with severity ratings.\"}"
```

### Research Before Upgrade

```bash
curl -sf $AUTH http://turnstone:8080/v1/api/send \
  -H 'Content-Type: application/json' \
  -d "{\"ws_id\": \"$WS\", \"content\": \"Research upgrading Qdrant from 1.16.3 to latest. Check the Qdrant changelog, breaking changes, migration guide, and any reported issues. Also search for DreamServer/homelab-specific gotchas. Recommend whether to upgrade and outline the steps.\"}"
```

## Rules

1. **Name workstreams with infra context**: `disk-audit-lxc201`, `rocm-upgrade-research`
2. **Close workstreams when done** — max 50 concurrent
3. **Don't duplicate mcporter**: Simple Proxmox calls go through mcporter directly
4. **Check state before reading results**: IDLE = done, RUNNING = working, ERROR = failed
5. **skip_permissions is ON**: No need to approve tool calls
