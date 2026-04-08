#!/usr/bin/env python3
"""Qdrant MCP server — vector search and memory management for DreamHalo.

Exposes Qdrant collections as MCP tools, including a high-level
semantic_search tool that auto-embeds queries via LiteLLM.
"""
import os

import httpx
from fastmcp import FastMCP

QDRANT_URL = os.environ.get("QDRANT_URL", "http://qdrant:6333")
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY", "")
LITELLM_URL = os.environ.get("LITELLM_URL", "http://litellm:4000")
LITELLM_KEY = os.environ.get("LITELLM_KEY", "")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small")


def _qdrant_headers() -> dict:
    h: dict = {"Content-Type": "application/json"}
    if QDRANT_API_KEY:
        h["api-key"] = QDRANT_API_KEY
    return h


def _litellm_headers() -> dict:
    h: dict = {"Content-Type": "application/json"}
    if LITELLM_KEY:
        h["Authorization"] = f"Bearer {LITELLM_KEY}"
    return h


mcp = FastMCP("qdrant")


@mcp.tool()
async def list_collections() -> str:
    """List all available Qdrant vector collections."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(f"{QDRANT_URL}/collections", headers=_qdrant_headers())
        r.raise_for_status()
    collections = [c["name"] for c in r.json().get("result", {}).get("collections", [])]
    return ", ".join(collections) if collections else "No collections found."


@mcp.tool()
async def collection_info(collection: str) -> str:
    """Get size and configuration for a Qdrant collection.

    Args:
        collection: Collection name
    """
    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.get(
            f"{QDRANT_URL}/collections/{collection}", headers=_qdrant_headers()
        )
        r.raise_for_status()
    info = r.json().get("result", {})
    count = info.get("points_count", 0)
    status = info.get("status", "unknown")
    params = info.get("config", {}).get("params", {})
    vec = params.get("vectors", {})
    size = vec.get("size") if isinstance(vec, dict) else "named vectors"
    return f"'{collection}': status={status}, points={count}, vector_size={size}"


@mcp.tool()
async def semantic_search(collection: str, query: str, limit: int = 5) -> str:
    """Search a Qdrant collection by semantic similarity.

    Generates an embedding for the query via LiteLLM then searches Qdrant.

    Args:
        collection: Qdrant collection to search
        query: Natural language query text
        limit: Max number of results to return (default: 5)
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        emb_r = await client.post(
            f"{LITELLM_URL}/v1/embeddings",
            json={"model": EMBEDDING_MODEL, "input": query, "encoding_format": "float"},
            headers=_litellm_headers(),
        )
        emb_r.raise_for_status()
    embedding: list[float] = emb_r.json()["data"][0]["embedding"]

    body = {"vector": embedding, "limit": limit, "with_payload": True}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"{QDRANT_URL}/collections/{collection}/points/search",
            json=body,
            headers=_qdrant_headers(),
        )
        r.raise_for_status()
    results = r.json().get("result", [])
    if not results:
        return f"No results found in '{collection}' for: {query}"
    lines = [f"{len(results)} results from '{collection}' for: {query}\n"]
    for i, pt in enumerate(results, 1):
        lines.append(f"{i}. ID={pt['id']}  score={pt.get('score', 0):.4f}")
        if pt.get("payload"):
            for k, v in list(pt["payload"].items())[:4]:
                lines.append(f"   {k}: {str(v)[:150]}")
        lines.append("")
    return "\n".join(lines)


@mcp.tool()
async def scroll_collection(collection: str, limit: int = 10, offset: int = 0) -> str:
    """Browse points in a Qdrant collection without a query vector.

    Args:
        collection: Collection name
        limit: Number of points to return (default: 10)
        offset: Number of points to skip (default: 0)
    """
    body = {"limit": limit, "offset": offset, "with_payload": True, "with_vector": False}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(
            f"{QDRANT_URL}/collections/{collection}/points/scroll",
            json=body,
            headers=_qdrant_headers(),
        )
        r.raise_for_status()
    points = r.json().get("result", {}).get("points", [])
    if not points:
        return f"No points in '{collection}'."
    lines = [f"{len(points)} points from '{collection}' (offset={offset}):\n"]
    for pt in points:
        lines.append(f"ID={pt['id']}")
        if pt.get("payload"):
            for k, v in list(pt["payload"].items())[:3]:
                lines.append(f"  {k}: {str(v)[:150]}")
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    port = int(os.environ.get("MCP_PORT", "8812"))
    host = os.environ.get("MCP_HOST", "0.0.0.0")
    mcp.run(transport="streamable-http", host=host, port=port)
