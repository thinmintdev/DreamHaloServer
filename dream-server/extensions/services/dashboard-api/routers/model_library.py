"""Model Library API — lists on-disk model files and proxies llama-server logs."""

import asyncio
import json
import logging
import re
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from config import AGENT_URL, DATA_DIR, DREAM_AGENT_KEY
from security import verify_api_key

logger = logging.getLogger(__name__)
router = APIRouter(tags=["model-library"])

_MODELS_DIR = Path(DATA_DIR) / "models"
_AGENT_TIMEOUT = 8

_SPLIT_RE = re.compile(r'-(\d{5})-of-(\d{5})')
_QUANT_TAGS = (
    "Q8_0", "Q6_K", "Q5_K_M", "Q5_K_S", "Q4_K_XL", "Q4_K_M", "Q4_K_S",
    "Q4_0", "Q3_K_M", "Q3_K_S", "Q2_K", "IQ4_XS", "MXFP4", "FP16", "BF16",
)


def _scan_model_files() -> list[dict]:
    """Walk the models directory and return metadata for each .gguf file."""
    if not _MODELS_DIR.is_dir():
        return []

    results = []
    for path in sorted(_MODELS_DIR.rglob("*.gguf")):
        try:
            stat = path.stat()
        except (OSError, FileNotFoundError):
            # Broken symlink or inaccessible file — record it with zero size
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
