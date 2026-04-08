# DreamHalo

**A bleeding-edge Dream Server variant built for AMD Strix Halo hardware (96 GB unified memory).**

DreamHalo extends upstream [Dream Server](https://github.com/Light-Heart-Labs/DreamServer) with multi-model inference, a unified AI gateway, autonomous agents with persistent memory, and a richer dashboard — all running fully local on a single machine.

---

## What's Different from Upstream

DreamHalo adds **20 commits** on top of upstream Dream Server. Here's what changed:

### Multi-Model Inference (Lemonade Stacks)

Upstream Dream Server loads one model at a time. DreamHalo runs **multiple models simultaneously** using Lemonade's `--max-loaded-models` with named stack presets.

```bash
dream stack list          # Show available stacks
dream stack apply coder   # Load coder stack (49 GB)
dream stack status        # See what's currently loaded
```

**Included stacks:**

| Stack | Models | VRAM |
|-------|--------|------|
| `coder` | Qwen3-Coder-Next (80B MoE) + embeddings + reranker | ~49 GB |
| `balanced` | Qwen3-Coder-Next + GLM-4.7-Flash + embeddings + reranker | ~58 GB |
| `minimal` | GLM-4.7-Flash + embeddings + reranker | ~25 GB |
| `kappa-solo` | Kappa-20B-131K (BF16 split) | ~40 GB |
| `oss-solo` | All open-source models without cloud routing | variable |

Solo stacks (`*-solo.yaml`) load a single primary model for maximum context or experimentation.

### Unified LiteLLM Gateway

All inference — local and cloud — routes through a single LiteLLM gateway at `:4000`.

- **15 model routes**: 3 Claude (via CLIProxyAPI OAuth), 8 local Lemonade models, embeddings, reranking, 2 aliases
- **Fallback chains**: Claude primary → local fallback (or vice versa)
- **Single endpoint** for Open WebUI, OpenClaw, n8n, and any client

Config: `config/litellm/dreamhalo.yaml`

### OpenClaw Agent

OpenClaw runs as an autonomous agent with:

- **Qdrant vector memory** — persistent semantic memory with search, compaction, and quality guards
- **SearXNG web search** — privacy-respecting search integration
- **Browser support** — Playwright Chromium for web interaction
- **Telegram bot** — mobile access via configured bot
- **12 bundled skills** (main agent) + 5 ops skills (ops agent)
- **Memory maintenance** — automated light/daily/weekly memory hygiene tiers
- All models routed through LiteLLM (Claude + local)

Config: `config/openclaw/openclaw-dreamhalo.json`

### Dashboard Enhancements

- **SSL subdomain URLs** — `VITE_DREAM_DOMAIN` enables clean URLs like `chat.dreamhalo.localhost` instead of `host:port`
- **Model Stack Panel** — replaces single-model metric with a live view of all loaded models from Lemonade
- **Memory page** — browse, search, and manage OpenClaw's Qdrant vector memory collections with semantic search
- **Service Map** — visual topology of running services
- **Inference Analytics** — model usage and performance metrics
- **Model Library** — browse and manage available models
- **Command Palette** — quick navigation across dashboard features

### New Extensions

| Extension | Purpose |
|-----------|---------|
| **CLIProxyAPI** | OAuth-based proxy for Claude API access (replaces API keys) |
| **Model Manager** | Browse, download, load/unload models via FastAPI (`:3010`) |
| **Proxmox MCP** | MCP server for Proxmox VE infrastructure management |
| **OpenCode** | AI-powered code editor extension |
| **Qdrant MCP** | MCP server for Qdrant vector database operations |
| **SearXNG MCP** | MCP server for SearXNG search integration |
| **Turnstone** | Configuration management service |

### Installer: DreamHalo Phase

A new **phase 14** (`installers/phases/14-dreamhalo.sh`) runs after the standard installer:

- Enables CLIProxyAPI and Model Manager extensions
- Sets `DREAM_MODE=dreamhalo`
- Wires OpenClaw to the DreamHalo agent config
- Triggered by `./install.sh --dreamhalo`

### Infrastructure

- **Proxmox LXC networking** — all ports bound to `0.0.0.0` for LAN access from containers
- **Lemonade entrypoint** — shell wrapper for model type registration (embedding/reranker) and max-loaded-models passthrough
- **`/mnt/ai-models` mount** — model symlinks resolve inside containers
- **n8n voice workflow** — starter Webhook → Whisper STT → LiteLLM → Kokoro TTS pipeline

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Open WebUI (:3000)                    │
└────────────────────────────┬─────────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────────┐
│                    LiteLLM Gateway (:4000)                   │
│          Claude (CLIProxyAPI) + Local (Lemonade)             │
└──────┬──────────────────┬────────────────────────┬───────────┘
       │                  │                        │
┌──────▼──────┐  ┌────────▼────────┐  ┌────────────▼──────────┐
│  Lemonade   │  │   CLIProxyAPI   │  │     OpenClaw Agent    │
│  (ROCm)     │  │   (OAuth)       │  │  AgentMint (:7860)    │
│  Multi-model│  │   Claude API    │  │  + Telegram bot       │
└─────────────┘  └─────────────────┘  └───────────┬───────────┘
                                                   │
       ┌───────────────┬──────────────┬────────────┤
       │               │              │            │
┌──────▼──┐  ┌─────────▼──┐  ┌───────▼───┐  ┌─────▼─────┐
│ Qdrant  │  │  SearXNG   │  │ Dashboard │  │   n8n     │
│ Memory  │  │  Search    │  │  (:3001)  │  │ Workflows │
│ (:6333) │  │  (:8888)   │  │  + API    │  │  (:5678)  │
└─────────┘  └────────────┘  └───────────┘  └───────────┘
```

## Commit History

All DreamHalo changes are layered on top of upstream, organized in merge waves:

1. **Wave 1** — Networking (Proxmox LXC fix), Unsloth Studio, 9Router + LiteLLM config
2. **Wave 2** — OpenClaw DreamHalo config, Model Manager extension
3. **Wave 3** — Installer phase 14, `--dreamhalo` flag, n8n voice workflow
4. **Post-wave** — CLIProxyAPI migration, unified gateway, Kappa-20B, Telegram, multi-model stacks, dashboard overhaul, MintOps skills, MCP extensions

---

## Quick Start

```bash
# Clone and install with DreamHalo extensions
git clone https://github.com/mint/dream-halo.git
cd dream-halo/dream-server
./install.sh --dreamhalo

# Apply a model stack
dream stack apply balanced

# Check status
dream status
dream stack status
```

## Hardware

DreamHalo is built for **AMD Ryzen AI MAX+ 395** with 96 GB unified memory, running in a Proxmox LXC container. The multi-model stack system is designed to maximize utilization of the large unified memory pool.

| Component | Spec |
|-----------|------|
| CPU/GPU | AMD Ryzen AI MAX+ 395 (Strix Halo) |
| Memory | 96 GB unified (shared CPU/GPU) |
| Host | Proxmox VE (LXC container) |
| GPU Compute | ROCm (gfx1151) |

---

*Built by [mint](https://github.com/mint) — extending Dream Server for Strix Halo*
