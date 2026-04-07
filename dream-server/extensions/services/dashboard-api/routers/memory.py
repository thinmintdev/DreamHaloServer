"""Vector memory management — browse, search, and manage Qdrant collections.

Provides the dashboard Memory page with access to OpenClaw's vector
memory stored in Qdrant. Supports collection listing, semantic search,
point deletion, and collection compaction.
"""

import logging
import os
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException

from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memory", tags=["memory"], dependencies=[Depends(verify_api_key)])

QDRANT_HOST = os.environ.get("QDRANT_HOST", "qdrant")
QDRANT_PORT = int(os.environ.get("QDRANT_INTERNAL_PORT", "6333"))
QDRANT_URL = f"http://{QDRANT_HOST}:{QDRANT_PORT}"

# Embedding endpoint for semantic search
EMBEDDINGS_HOST = os.environ.get("EMBEDDINGS_HOST", "llama-server")
EMBEDDINGS_PORT = int(os.environ.get("EMBEDDINGS_INTERNAL_PORT", "8080"))
EMBEDDINGS_URL = f"http://{EMBEDDINGS_HOST}:{EMBEDDINGS_PORT}"
EMBEDDINGS_MODEL = os.environ.get("EMBEDDINGS_MODEL", "user.nomic-embed")


async def _qdrant_get(path: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{QDRANT_URL}{path}")
        resp.raise_for_status()
        return resp.json()


async def _qdrant_post(path: str, body: dict) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{QDRANT_URL}{path}", json=body)
        resp.raise_for_status()
        return resp.json()


async def _qdrant_delete(path: str, body: dict | None = None) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.request("DELETE", f"{QDRANT_URL}{path}", json=body)
        resp.raise_for_status()
        return resp.json()


async def _get_embedding(text: str) -> list[float]:
    """Get embedding vector for semantic search via the embeddings endpoint."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"{EMBEDDINGS_URL}/v1/embeddings",
            json={"input": text, "model": EMBEDDINGS_MODEL, "encoding_format": "float"},
        )
        resp.raise_for_status()
        data = resp.json()
        return data["data"][0]["embedding"]


@router.get("/collections")
async def list_collections():
    """List all Qdrant collections with point counts."""
    try:
        data = await _qdrant_get("/collections")
        collections = []
        for col in data.get("result", {}).get("collections", []):
            name = col.get("name", "")
            try:
                info = await _qdrant_get(f"/collections/{name}")
                result = info.get("result", {})
                collections.append({
                    "name": name,
                    "points_count": result.get("points_count", 0),
                    "vectors_count": result.get("vectors_count", 0),
                })
            except httpx.HTTPError:
                collections.append({"name": name, "points_count": 0, "vectors_count": 0})
        return {"collections": collections}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Qdrant unavailable: {e}")


@router.get("/collections/{name}")
async def get_collection(name: str):
    """Get detailed info about a collection."""
    try:
        data = await _qdrant_get(f"/collections/{name}")
        result = data.get("result", {})
        config = result.get("config", {})
        vectors_config = config.get("params", {}).get("vectors", {})

        # vector_size can be in different places depending on Qdrant config
        vector_size = None
        if isinstance(vectors_config, dict):
            vector_size = vectors_config.get("size")
            if vector_size is None:
                # Named vectors — get the first one
                for v in vectors_config.values():
                    if isinstance(v, dict) and "size" in v:
                        vector_size = v["size"]
                        break

        return {
            "name": name,
            "points_count": result.get("points_count", 0),
            "vectors_count": result.get("vectors_count", 0),
            "vector_size": vector_size,
            "disk_size_bytes": result.get("disk_data_size", 0) + result.get("ram_data_size", 0),
            "status": result.get("status"),
        }
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Qdrant unavailable: {e}")


@router.post("/search")
async def search_memories(body: dict):
    """Semantic search within a collection."""
    collection = body.get("collection")
    query = body.get("query", "")
    limit = min(body.get("limit", 20), 100)

    if not collection or not query:
        raise HTTPException(status_code=400, detail="collection and query are required")

    try:
        embedding = await _get_embedding(query)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Embedding service unavailable: {e}")

    try:
        data = await _qdrant_post(f"/collections/{collection}/points/query", {
            "query": embedding,
            "limit": limit,
            "with_payload": True,
        })
        points = data.get("result", {}).get("points", [])
        results = []
        for p in points:
            results.append({
                "id": p.get("id"),
                "score": p.get("score"),
                "payload": p.get("payload", {}),
            })
        return {"results": results}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Qdrant search failed: {e}")


@router.delete("/collections/{name}/points/{point_id}")
async def delete_point(name: str, point_id: str):
    """Delete a single point from a collection."""
    try:
        # Point IDs can be int or UUID string
        try:
            pid = int(point_id)
        except ValueError:
            pid = point_id

        await _qdrant_post(f"/collections/{name}/points/delete", {
            "points": [pid],
        })
        return {"status": "ok"}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Delete failed: {e}")


@router.post("/collections/{name}/compact")
async def compact_collection(name: str):
    """Trigger optimization/compaction on a collection."""
    try:
        # Qdrant uses "optimize" to trigger segment merging
        await _qdrant_post(f"/collections/{name}/points/delete", {
            "filter": {"must": [{"is_empty": {"key": "__nonexistent_field__"}}]},
        })
        # The real compaction happens via collection update with optimizer config
        await _qdrant_post(f"/collections/{name}", {
            "optimizers_config": {"indexing_threshold": 10000},
        })
        return {"message": f"Compaction triggered for {name}. Qdrant will optimize segments in the background."}
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Compaction failed: {e}")
