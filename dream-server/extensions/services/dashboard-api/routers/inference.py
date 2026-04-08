"""Inference analytics router — deep metrics, rolling history, and lifetime summary."""

import asyncio
import json
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends

from config import SERVICES, DATA_DIR, LLM_BACKEND
from helpers import (
    _get_httpx_client,
    _get_lifetime_tokens,
    get_all_loaded_models,
    get_llama_context_size,
    get_loaded_model,
    get_uptime,
)
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["inference"])

# Lemonade serves at /api/v1 instead of llama.cpp's /v1
_LLM_API_PREFIX = "/api/v1" if LLM_BACKEND == "lemonade" else "/v1"

# Rolling history — 300 samples at 5s intervals = 25 min window
_INFERENCE_HISTORY: deque = deque(maxlen=300)
_HISTORY_POLL_INTERVAL = 5.0

# Previous sample for computing deltas (tokens/sec, prompt tokens/sec)
_prev: dict = {"tokens": 0, "tokens_secs": 0.0, "prompt_tokens": 0, "prompt_secs": 0.0, "time": 0.0}


# ============================================================================
# Internal helpers
# ============================================================================

async def _fetch_raw_metrics() -> str:
    """Fetch raw Prometheus metrics text from llama-server."""
    host = SERVICES["llama-server"]["host"]
    port = SERVICES["llama-server"]["port"]
    metrics_port = int(os.environ.get("LLAMA_METRICS_PORT", port))
    url = f"http://{host}:{metrics_port}/metrics"
    client = await _get_httpx_client()
    resp = await client.get(url)
    return resp.text


def _parse_prometheus(text: str) -> dict:
    """Parse Prometheus exposition text into a flat dict of metric_name -> float."""
    metrics: dict[str, float] = {}
    for line in text.split("\n"):
        if not line or line.startswith("#"):
            continue
        # Handle lines like: metric_name{labels} value
        # or simply: metric_name value
        parts = line.split()
        if len(parts) < 2:
            continue
        raw_name = parts[0]
        # Strip label suffix for simple access (e.g. "metric{model=...}" -> "metric")
        name = raw_name.split("{")[0]
        try:
            value = float(parts[-1])
        except ValueError:
            continue
        # Keep the first occurrence (some metrics have multiple label sets)
        if name not in metrics:
            metrics[name] = value
    return metrics


def _compute_rates(metrics: dict) -> dict:
    """Compute tokens/sec and prompt tokens/sec from cumulative counters."""
    global _prev

    tokens = metrics.get("tokens_predicted_total", 0)
    tokens_secs = metrics.get("tokens_predicted_seconds_total", 0)
    prompt_tokens = metrics.get("prompt_tokens_total", 0)
    prompt_secs = metrics.get("prompt_tokens_seconds_total", 0)

    tps = 0.0
    prompt_tps = 0.0

    if _prev["time"] > 0:
        dt_secs = tokens_secs - _prev["tokens_secs"]
        if dt_secs > 0 and tokens > _prev["tokens"]:
            tps = round((tokens - _prev["tokens"]) / dt_secs, 1)

        dp_secs = prompt_secs - _prev["prompt_secs"]
        if dp_secs > 0 and prompt_tokens > _prev["prompt_tokens"]:
            prompt_tps = round((prompt_tokens - _prev["prompt_tokens"]) / dp_secs, 1)

    _prev.update({
        "tokens": tokens,
        "tokens_secs": tokens_secs,
        "prompt_tokens": prompt_tokens,
        "prompt_secs": prompt_secs,
        "time": time.time(),
    })

    return {"tps": tps, "prompt_tps": prompt_tps}


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/api/inference/metrics", dependencies=[Depends(verify_api_key)])
async def inference_metrics():
    """Full parsed Prometheus metrics from llama-server."""
    try:
        raw = await _fetch_raw_metrics()
        metrics = _parse_prometheus(raw)
        rates = _compute_rates(metrics)

        # Speculative decoding stats (may not be present)
        drafted = metrics.get("tokens_drafted_total", 0)
        accepted = metrics.get("tokens_drafted_accepted_total", 0)
        draft_acceptance = round(accepted / drafted * 100, 1) if drafted > 0 else None

        return {
            "tokens_predicted_total": metrics.get("tokens_predicted_total", 0),
            "tokens_predicted_seconds_total": metrics.get("tokens_predicted_seconds_total", 0),
            "prompt_tokens_total": metrics.get("prompt_tokens_total", 0),
            "prompt_tokens_seconds_total": metrics.get("prompt_tokens_seconds_total", 0),
            "tokens_drafted_total": drafted,
            "tokens_drafted_accepted_total": accepted,
            "draft_acceptance_pct": draft_acceptance,
            "requests_processing": metrics.get("requests_processing", 0),
            "kv_cache_usage_ratio": metrics.get("kv_cache_usage_ratio", 0),
            "n_ctx_total": metrics.get("n_ctx_total", 0),
            "tokens_per_second": rates["tps"],
            "prompt_tokens_per_second": rates["prompt_tps"],
            # Pass through all raw metrics for the full table
            "all_metrics": metrics,
        }
    except (httpx.HTTPError, httpx.TimeoutException, KeyError, OSError) as e:
        logger.warning("inference_metrics failed: %s", e)
        return {
            "tokens_predicted_total": 0,
            "tokens_predicted_seconds_total": 0,
            "prompt_tokens_total": 0,
            "prompt_tokens_seconds_total": 0,
            "tokens_drafted_total": 0,
            "tokens_drafted_accepted_total": 0,
            "draft_acceptance_pct": None,
            "requests_processing": 0,
            "kv_cache_usage_ratio": 0,
            "n_ctx_total": 0,
            "tokens_per_second": 0,
            "prompt_tokens_per_second": 0,
            "all_metrics": {},
        }


@router.get("/api/inference/history", dependencies=[Depends(verify_api_key)])
async def inference_history():
    """Rolling 25-min inference metrics history sampled every 5s."""
    if not _INFERENCE_HISTORY:
        return {"timestamps": [], "tps": [], "prompt_tps": [], "kv_cache_usage": [], "active_requests": []}

    return {
        "timestamps": [s["timestamp"] for s in _INFERENCE_HISTORY],
        "tps": [s["tps"] for s in _INFERENCE_HISTORY],
        "prompt_tps": [s["prompt_tps"] for s in _INFERENCE_HISTORY],
        "kv_cache_usage": [s["kv_cache_usage"] for s in _INFERENCE_HISTORY],
        "active_requests": [s["active_requests"] for s in _INFERENCE_HISTORY],
    }


@router.get("/api/inference/summary", dependencies=[Depends(verify_api_key)])
async def inference_summary():
    """Lifetime stats: total tokens, current model, context size, uptime."""
    models = await get_all_loaded_models()
    active_model = None
    for m in models:
        if m.get("active"):
            active_model = m["id"]
            break
    if not active_model and models:
        active_model = models[0]["id"]

    ctx_size = await get_llama_context_size(model_hint=active_model)

    return {
        "lifetime_tokens": _get_lifetime_tokens(),
        "active_model": active_model,
        "loaded_models": models,
        "context_size": ctx_size,
        "uptime": get_uptime(),
    }


# ============================================================================
# Background task
# ============================================================================

async def poll_inference_history() -> None:
    """Background task: append an inference sample to _INFERENCE_HISTORY every 5s."""
    while True:
        try:
            raw = await _fetch_raw_metrics()
            metrics = _parse_prometheus(raw)
            rates = _compute_rates(metrics)

            sample = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "tps": rates["tps"],
                "prompt_tps": rates["prompt_tps"],
                "kv_cache_usage": round(metrics.get("kv_cache_usage_ratio", 0) * 100, 1),
                "active_requests": int(metrics.get("requests_processing", 0)),
            }
            _INFERENCE_HISTORY.append(sample)
        except Exception:  # Broad catch: background task must survive transient failures
            logger.exception("Inference history poll failed")
        await asyncio.sleep(_HISTORY_POLL_INTERVAL)
