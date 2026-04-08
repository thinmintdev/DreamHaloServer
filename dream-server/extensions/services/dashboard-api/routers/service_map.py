"""Service dependency topology graph."""

import logging

from fastapi import APIRouter, Depends

from config import SERVICES
from helpers import get_cached_services
from security import verify_api_key

logger = logging.getLogger(__name__)
router = APIRouter(tags=["service-map"])

# --- Dependency Graph Definition ---
# Each entry: (source, target, label)
# Direction: source depends on target (arrow points from source -> target)

_DEPENDENCY_EDGES = [
    ("open-webui", "litellm", "LLM proxy"),
    ("litellm", "llama-server", "inference"),
    ("perplexica", "searxng", "search"),
    ("n8n", "litellm", "LLM proxy"),
    ("n8n", "qdrant", "vector store"),
    ("openclaw", "litellm", "LLM proxy"),
    ("openclaw", "qdrant", "vector store"),
    ("litellm", "langfuse", "observability"),
    ("qdrant", "embeddings", "embeddings"),
    ("open-webui", "whisper", "voice input"),
    ("open-webui", "tts", "voice output"),
    ("dashboard", "dashboard-api", "API"),
    ("token-spy", "litellm", "intercept"),
    ("privacy-shield", "litellm", "privacy"),
]

# Categories for layout layering (top to bottom)
_CATEGORY_MAP = {
    "open-webui": "user-facing",
    "perplexica": "user-facing",
    "n8n": "user-facing",
    "openclaw": "user-facing",
    "dashboard": "user-facing",
    "comfyui": "user-facing",
    "litellm": "middleware",
    "dashboard-api": "middleware",
    "token-spy": "middleware",
    "privacy-shield": "middleware",
    "langfuse": "middleware",
    "llama-server": "core",
    "qdrant": "core",
    "searxng": "core",
    "embeddings": "core",
    "whisper": "core",
    "tts": "core",
}


@router.get("/api/services/topology")
async def service_topology(api_key: str = Depends(verify_api_key)):
    """Return the service dependency graph with health status."""
    cached = get_cached_services()
    status_map: dict[str, str] = {}
    if cached:
        for svc in cached:
            sid = svc.id if hasattr(svc, "id") else svc.get("id", "")
            st = svc.status if hasattr(svc, "status") else svc.get("status", "unknown")
            status_map[sid] = st

    # Build nodes from SERVICES dict
    nodes = []
    known_ids = set(SERVICES.keys())
    for service_id, config in SERVICES.items():
        nodes.append({
            "id": service_id,
            "name": config["name"],
            "status": status_map.get(service_id, "unknown"),
            "port": config.get("external_port", config["port"]),
            "category": _CATEGORY_MAP.get(service_id, "other"),
        })

    # Filter edges to only include services that exist in SERVICES
    edges = []
    for source, target, label in _DEPENDENCY_EDGES:
        if source in known_ids and target in known_ids:
            source_healthy = status_map.get(source) == "healthy"
            target_healthy = status_map.get(target) == "healthy"
            edge_status = "healthy" if (source_healthy and target_healthy) else "degraded"
            edges.append({
                "source": source,
                "target": target,
                "label": label,
                "status": edge_status,
            })

    return {"nodes": nodes, "edges": edges}
