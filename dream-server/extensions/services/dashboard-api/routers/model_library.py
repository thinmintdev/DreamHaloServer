"""Model Library API — model files, Lemonade operations (pull/load/unload/delete), per-model config."""

import asyncio
import json
import logging
import os
import re
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from config import AGENT_URL, DATA_DIR, DREAM_AGENT_KEY
from security import verify_api_key

logger = logging.getLogger(__name__)
router = APIRouter(tags=["model-library"])

_MODELS_DIR = Path(DATA_DIR) / "models"
_CONFIG_FILE = Path(DATA_DIR) / "model-config.json"
_AGENT_TIMEOUT = 8
_LLAMA_CONTAINER = os.environ.get("LLAMA_CONTAINER", "dream-llama-server")

_SPLIT_RE = re.compile(r'-(\d{5})-of-(\d{5})')
_QUANT_TAGS = (
    "Q8_0", "Q6_K", "Q5_K_M", "Q5_K_S", "Q4_K_XL", "Q4_K_M", "Q4_K_S",
    "Q4_0", "Q3_K_M", "Q3_K_S", "Q2_K", "IQ4_XS", "MXFP4", "FP16", "BF16",
)


# ============================================================================
# Request / response models
# ============================================================================

class PullRequest(BaseModel):
    """Pull a model via Lemonade CLI."""
    model: str  # model name or HuggingFace ID
    args: Optional[list[str]] = None  # extra args: --embedding, --reranking, --checkpoint, etc.


class LoadRequest(BaseModel):
    model: str  # Lemonade model ID (e.g., "extra.Qwen3-Coder-Next-MXFP4_MOE.gguf")


class UnloadRequest(BaseModel):
    model: str


class DeleteRequest(BaseModel):
    model: str
    confirm: bool = False


class ModelConfigPatch(BaseModel):
    model: str
    context_size: Optional[int] = None
    backend: Optional[str] = None  # rocm, vulkan, cpu
    tags: Optional[list[str]] = None  # chat, embedding, reranking, voice, custom...


# ============================================================================
# Docker exec helper
# ============================================================================

async def _lemonade_exec(*args: str, timeout: float = 120) -> dict:
    """Run a lemonade-server command inside the llama-server container via docker exec."""
    cmd = ["docker", "exec", _LLAMA_CONTAINER, "/opt/lemonade/lemonade-server", *args]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return {
            "exit_code": proc.returncode,
            "stdout": stdout.decode(errors="replace").strip(),
            "stderr": stderr.decode(errors="replace").strip(),
        }
    except asyncio.TimeoutError:
        proc.kill()
        raise HTTPException(504, "Lemonade command timed out")
    except FileNotFoundError:
        raise HTTPException(503, "Docker CLI not available in dashboard-api container")


# ============================================================================
# Per-model config (stored in DATA_DIR/model-config.json)
# ============================================================================

def _load_model_config() -> dict:
    try:
        return json.loads(_CONFIG_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def _save_model_config(config: dict) -> None:
    _CONFIG_FILE.write_text(json.dumps(config, indent=2))


# ============================================================================
# File scanning (existing)
# ============================================================================

def _scan_model_files() -> list[dict]:
    """Walk the models directory and return metadata for each .gguf file."""
    if not _MODELS_DIR.is_dir():
        return []

    results = []
    for path in sorted(_MODELS_DIR.rglob("*.gguf")):
        try:
            stat = path.stat()
        except (OSError, FileNotFoundError):
            rel = path.relative_to(_MODELS_DIR)
            name = path.stem
            if name.startswith("extra."):
                name = name[6:]
            is_symlink = path.is_symlink()
            results.append({
                "filename": path.name,
                "path": str(rel),
                "abs_path": str(path),
                "size_bytes": 0,
                "size_gb": 0,
                "name": name,
                "quantization": None,
                "is_split": False,
                "split_part": None,
                "split_total": None,
                "modified": 0,
                "symlink": is_symlink,
                "symlink_target": str(path.readlink()) if is_symlink else None,
                "broken": True,
            })
            continue
        size_bytes = stat.st_size
        rel = path.relative_to(_MODELS_DIR)

        name = path.stem
        if name.startswith("extra."):
            name = name[6:]

        quant = None
        for q in _QUANT_TAGS:
            if q in path.name:
                quant = q
                break

        is_split = False
        split_part = None
        split_total = None
        split_match = _SPLIT_RE.search(path.name)
        if split_match:
            is_split = True
            split_part = int(split_match.group(1))
            split_total = int(split_match.group(2))

        results.append({
            "filename": path.name,
            "path": str(rel),
            "abs_path": str(path),
            "size_bytes": size_bytes,
            "size_gb": round(size_bytes / (1024 ** 3), 2),
            "name": name,
            "quantization": quant,
            "is_split": is_split,
            "split_part": split_part,
            "split_total": split_total,
            "modified": stat.st_mtime,
            "symlink": path.is_symlink(),
            "symlink_target": str(path.readlink()) if path.is_symlink() else None,
            "broken": False,
        })

    return results


# ============================================================================
# Endpoints — file listing + logs (existing)
# ============================================================================

@router.get("/api/model-library/files")
async def model_library_files(api_key: str = Depends(verify_api_key)):
    """List all downloaded model files with metadata."""
    files = await asyncio.to_thread(_scan_model_files)
    total_bytes = sum(f["size_bytes"] for f in files)

    return {
        "models_dir": str(_MODELS_DIR),
        "total_files": len(files),
        "total_size_gb": round(total_bytes / (1024 ** 3), 2),
        "files": files,
    }


@router.get("/api/model-library/logs")
async def model_library_logs(
    tail: int = Query(200, ge=1, le=500),
    api_key: str = Depends(verify_api_key),
):
    """Fetch recent llama-server container logs via the host agent."""
    url = f"{AGENT_URL}/v1/service/logs"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DREAM_AGENT_KEY}",
    }
    data = json.dumps({"service_id": "llama-server", "tail": tail}).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=_AGENT_TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            err_body = json.loads(exc.read().decode())
            detail = err_body.get("error", f"Host agent error: HTTP {exc.code}")
        except (json.JSONDecodeError, OSError):
            detail = f"Host agent returned HTTP {exc.code}"
        raise HTTPException(status_code=502, detail=detail)
    except (urllib.error.URLError, OSError):
        raise HTTPException(
            status_code=503,
            detail="Host agent unavailable. Use 'docker logs dream-llama-server' in terminal.",
        )


# ============================================================================
# Endpoints — Lemonade model operations
# ============================================================================

@router.post("/api/model-library/pull")
async def model_pull(req: PullRequest, api_key: str = Depends(verify_api_key)):
    """Pull/download a model via `lemonade-server pull`. Handles HF downloads and registration."""
    args = ["pull", req.model]
    if req.args:
        args.extend(req.args)
    result = await _lemonade_exec(*args, timeout=600)
    if result["exit_code"] != 0:
        raise HTTPException(502, f"Pull failed: {result['stderr'] or result['stdout']}")
    return {"status": "pulled", "model": req.model, "output": result["stdout"]}


@router.post("/api/model-library/load")
async def model_load(req: LoadRequest, api_key: str = Depends(verify_api_key)):
    """Load a model into VRAM via a minimal chat completion (warm-load).

    Using lemonade-server run would start a new server instance.
    Instead, sending a tiny completion triggers Lemonade to load the model.
    """
    from helpers import _get_httpx_client
    from config import SERVICES
    host = SERVICES["llama-server"]["host"]
    port = SERVICES["llama-server"]["port"]
    client = await _get_httpx_client()
    resp = await client.post(
        f"http://{host}:{port}/v1/chat/completions",
        json={"model": req.model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 1},
        timeout=120,
    )
    if resp.status_code >= 400:
        raise HTTPException(502, f"Load failed: HTTP {resp.status_code} — {resp.text[:200]}")
    return {"status": "loaded", "model": req.model}


@router.post("/api/model-library/unload")
async def model_unload(req: UnloadRequest, api_key: str = Depends(verify_api_key)):
    """Unload a model from VRAM via Lemonade's Ollama-compat API."""
    from helpers import _get_httpx_client
    from config import SERVICES
    host = SERVICES["llama-server"]["host"]
    port = SERVICES["llama-server"]["port"]
    client = await _get_httpx_client()
    # Ollama-compat: POST /api/generate with keep_alive=0 evicts model
    resp = await client.post(
        f"http://{host}:{port}/api/generate",
        json={"model": req.model, "keep_alive": 0},
        timeout=30,
    )
    if resp.status_code >= 400:
        raise HTTPException(502, f"Unload failed: HTTP {resp.status_code}")
    return {"status": "unloaded", "model": req.model}


@router.delete("/api/model-library/delete")
async def model_delete(req: DeleteRequest, api_key: str = Depends(verify_api_key)):
    """Delete a model via `lemonade-server delete`. Requires confirm=true."""
    if not req.confirm:
        raise HTTPException(400, "Delete requires confirm=true")
    result = await _lemonade_exec("delete", req.model, timeout=30)
    if result["exit_code"] != 0:
        raise HTTPException(502, f"Delete failed: {result['stderr'] or result['stdout']}")
    return {"status": "deleted", "model": req.model, "output": result["stdout"]}


@router.get("/api/model-library/lemonade-models")
async def lemonade_models(api_key: str = Depends(verify_api_key)):
    """List all models registered with Lemonade (not just files on disk)."""
    result = await _lemonade_exec("list", "--json", timeout=15)
    if result["exit_code"] != 0:
        # Fallback: try without --json
        result = await _lemonade_exec("list", timeout=15)
        return {"format": "text", "output": result["stdout"]}
    try:
        return {"format": "json", "models": json.loads(result["stdout"])}
    except json.JSONDecodeError:
        return {"format": "text", "output": result["stdout"]}


# ============================================================================
# Endpoints — per-model config
# ============================================================================

@router.get("/api/model-library/config")
async def get_model_config(api_key: str = Depends(verify_api_key)):
    """Get per-model configuration (context size, backend, tags)."""
    return await asyncio.to_thread(_load_model_config)


@router.patch("/api/model-library/config")
async def patch_model_config(req: ModelConfigPatch, api_key: str = Depends(verify_api_key)):
    """Update per-model configuration."""
    config = await asyncio.to_thread(_load_model_config)
    entry = config.get(req.model, {})

    if req.context_size is not None:
        entry["context_size"] = req.context_size
    if req.backend is not None:
        entry["backend"] = req.backend
    if req.tags is not None:
        entry["tags"] = req.tags

    config[req.model] = entry
    await asyncio.to_thread(_save_model_config, config)
    return {"status": "updated", "model": req.model, "config": entry}
