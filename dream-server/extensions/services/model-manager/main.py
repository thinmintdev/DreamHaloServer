"""
Model Manager API — browse, load/unload, download, and delete AI models.
Default port: MODEL_MANAGER_PORT (3010)
"""
import os
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Dream Model Manager", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS_DIR = Path(os.environ.get("AI_MODELS_PATH", "/models"))
LITELLM_URL = os.environ.get("LITELLM_URL", "http://litellm:4000")
LITELLM_KEY = os.environ.get("LITELLM_KEY", "")

MODEL_EXTENSIONS = {".gguf", ".safetensors", ".bin", ".pth"}


class ModelInfo(BaseModel):
    name: str
    filename: str
    size_gb: float
    format: str  # gguf, safetensors, bin, pth
    status: str  # available, loaded
    path: str


class DownloadRequest(BaseModel):
    url: str
    filename: str
    subfolder: Optional[str] = None


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/models", response_model=list[ModelInfo])
async def list_models():
    """List all model files in the models directory with their status."""
    loaded = await _get_loaded_models()
    models = []

    for path in MODELS_DIR.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in MODEL_EXTENSIONS:
            continue

        size_gb = round(path.stat().st_size / (1024**3), 2)
        fmt = path.suffix.lstrip(".").lower()
        name = path.stem
        status = "loaded" if name in loaded else "available"

        models.append(ModelInfo(
            name=name,
            filename=path.name,
            size_gb=size_gb,
            format=fmt,
            status=status,
            path=str(path.relative_to(MODELS_DIR)),
        ))

    return sorted(models, key=lambda m: m.name)


@app.post("/api/models/{name}/load")
async def load_model(name: str):
    """Signal LiteLLM to add this model."""
    if not _find_model(name):
        raise HTTPException(404, f"Model '{name}' not found in {MODELS_DIR}")
    return {"status": "load_requested", "model": name, "note": "Register in LiteLLM config to load"}


@app.post("/api/models/{name}/unload")
async def unload_model(name: str):
    """Signal to unload a model."""
    return {"status": "unload_requested", "model": name}


@app.delete("/api/models/{name}")
async def delete_model(name: str):
    """Delete a model file from disk."""
    match = _find_model(name)
    if not match:
        raise HTTPException(404, f"Model '{name}' not found")
    match.unlink()
    return {"status": "deleted", "model": name}


@app.get("/api/models/{name}/logs")
async def model_logs(name: str):
    """Get recent log lines for a model (from LiteLLM)."""
    return {"model": name, "logs": [], "note": "Connect to LiteLLM logs endpoint for live data"}


@app.post("/api/models/download")
async def download_model(req: DownloadRequest):
    """Download a model file from a URL."""
    target_dir = MODELS_DIR / (req.subfolder or "")
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / req.filename

    if target.exists():
        raise HTTPException(409, f"File {req.filename} already exists")

    async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
        async with client.stream("GET", req.url) as resp:
            if resp.status_code != 200:
                raise HTTPException(502, f"Download failed: HTTP {resp.status_code}")
            with open(target, "wb") as f:
                async for chunk in resp.aiter_bytes(chunk_size=8192):
                    f.write(chunk)

    size_gb = round(target.stat().st_size / (1024**3), 2)
    return {"status": "downloaded", "filename": req.filename, "size_gb": size_gb}


async def _get_loaded_models() -> set[str]:
    """Query LiteLLM for currently loaded models."""
    headers = {"Authorization": f"Bearer {LITELLM_KEY}"} if LITELLM_KEY else {}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{LITELLM_URL}/v1/models", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return {m.get("id", "") for m in data.get("data", [])}
    except httpx.HTTPError:
        pass
    return set()


def _find_model(name: str) -> Optional[Path]:
    """Find a model file by stem name."""
    for path in MODELS_DIR.rglob("*"):
        if path.is_file() and path.stem == name:
            return path
    return None
