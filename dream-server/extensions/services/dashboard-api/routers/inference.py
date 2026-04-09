"""Inference analytics router — per-model metrics, rolling history, and lifetime summary."""

import asyncio
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlparse

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
_AGGREGATE_HISTORY: deque = deque(maxlen=300)
_MODEL_HISTORY: dict[str, deque] = {}  # model_name -> deque(maxlen=300)
_HISTORY_POLL_INTERVAL = 5.0

# Per-model previous samples for computing deltas
_model_prev: dict[str, dict] = {}

# Aggregate previous sample (backward compat with helpers.py _compute_rates)
_prev: dict = {"tokens": 0, "tokens_secs": 0.0, "prompt_tokens": 0, "prompt_secs": 0.0, "time": 0.0}

# Model color assignments (stable across polls)
_MODEL_COLORS = ["#818cf8", "#f472b6", "#34d399", "#fb923c"]
_model_color_map: dict[str, str] = {}


# ============================================================================
# Internal helpers
# ============================================================================

async def _discover_model_backends() -> list[dict]:
    """Query Lemonade /api/v1/health to discover loaded models and their backend ports.

    Returns list of: [{"name": "qwen3-coder-next", "raw_name": "extra.Qwen...",
                       "metrics_url": "http://127.0.0.1:8001/metrics", "type": "llm"}, ...]
    """
    host = SERVICES["llama-server"]["host"]
    port = SERVICES["llama-server"]["port"]
    client = await _get_httpx_client()
    resp = await client.get(f"http://{host}:{port}/api/v1/health")
    data = resp.json()
    backends = []
    for m in data.get("all_models_loaded", []):
        backend_url = m.get("backend_url", "")
        if not backend_url:
            continue
        parsed = urlparse(backend_url)
        # Backend ports listen inside llama-server container; reach them via the container hostname
        metrics_url = f"http://{host}:{parsed.port}/metrics"
        raw_name = m.get("model_name", "")
        # Clean display name
        display = raw_name.removeprefix("extra.").removeprefix("user.")
        if display.endswith(".gguf"):
            display = display[:-5]
        backends.append({
            "name": display,
            "raw_name": raw_name,
            "metrics_url": metrics_url,
            "type": m.get("type", "llm"),
            "ctx_size": m.get("recipe_options", {}).get("ctx_size"),
        })
    return backends


async def _fetch_raw_metrics(url: Optional[str] = None) -> str:
    """Fetch raw Prometheus metrics text from a llama-server backend."""
    if url is None:
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
        parts = line.split()
        if len(parts) < 2:
            continue
        name = parts[0].split("{")[0]
        try:
            value = float(parts[-1])
        except ValueError:
            continue
        if name not in metrics:
            metrics[name] = value
    return metrics


def _compute_rates(metrics: dict) -> dict:
    """Compute aggregate tokens/sec and prompt tokens/sec from cumulative counters."""
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


def _compute_model_rates(model_key: str, metrics: dict) -> dict:
    """Compute per-model tokens/sec from cumulative counters."""
    # llamacpp prefixes metrics with "llamacpp:" when accessed per-backend
    tokens = metrics.get("llamacpp:tokens_predicted_total", metrics.get("tokens_predicted_total", 0))
    tokens_secs = metrics.get("llamacpp:tokens_predicted_seconds_total", metrics.get("tokens_predicted_seconds_total", 0))
    prompt_tokens = metrics.get("llamacpp:prompt_tokens_total", metrics.get("prompt_tokens_total", 0))
    prompt_secs = metrics.get("llamacpp:prompt_seconds_total", metrics.get("prompt_tokens_seconds_total", 0))
    kv_ratio = metrics.get("llamacpp:kv_cache_usage_ratio", metrics.get("kv_cache_usage_ratio", 0))
    requests = int(metrics.get("llamacpp:requests_processing", metrics.get("requests_processing", 0)))

    prev = _model_prev.get(model_key)
    tps = 0.0
    prompt_tps = 0.0

    if prev and prev["time"] > 0:
        dt_secs = tokens_secs - prev["tokens_secs"]
        if dt_secs > 0 and tokens > prev["tokens"]:
            tps = round((tokens - prev["tokens"]) / dt_secs, 1)

        dp_secs = prompt_secs - prev["prompt_secs"]
        if dp_secs > 0 and prompt_tokens > prev["prompt_tokens"]:
            prompt_tps = round((prompt_tokens - prev["prompt_tokens"]) / dp_secs, 1)

    _model_prev[model_key] = {
        "tokens": tokens,
        "tokens_secs": tokens_secs,
        "prompt_tokens": prompt_tokens,
        "prompt_secs": prompt_secs,
        "time": time.time(),
    }

    return {
        "tps": tps,
        "prompt_tps": prompt_tps,
        "kv_cache_usage": round(kv_ratio * 100, 1),
        "active_requests": requests,
    }


def _assign_color(model_name: str) -> str:
    """Assign a stable color to a model name."""
    if model_name not in _model_color_map:
        idx = len(_model_color_map) % len(_MODEL_COLORS)
        _model_color_map[model_name] = _MODEL_COLORS[idx]
    return _model_color_map[model_name]


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/api/inference/metrics", dependencies=[Depends(verify_api_key)])
async def inference_metrics():
    """Full parsed Prometheus metrics from llama-server, with per-model breakdown."""
    try:
        # Try per-model metrics via Lemonade health API
        per_model = {}
        try:
            backends = await _discover_model_backends()
            for backend in backends:
                try:
                    raw = await _fetch_raw_metrics(backend["metrics_url"])
                    m = _parse_prometheus(raw)
                    rates = _compute_model_rates(backend["name"], m)
                    per_model[backend["name"]] = {
                        "tps": rates["tps"],
                        "prompt_tps": rates["prompt_tps"],
                        "kv_cache_usage": rates["kv_cache_usage"],
                        "active_requests": rates["active_requests"],
                        "type": backend["type"],
                        "color": _assign_color(backend["name"]),
                    }
                except (httpx.HTTPError, httpx.TimeoutException):
                    logger.debug("Per-model metrics failed for %s", backend["name"])
        except (httpx.HTTPError, httpx.TimeoutException):
            logger.debug("Model backend discovery failed, falling back to aggregate")

        # Aggregate metrics (sum per-model or fallback to direct fetch)
        if per_model:
            agg_tps = sum(m["tps"] for m in per_model.values())
            agg_prompt_tps = sum(m["prompt_tps"] for m in per_model.values())
            agg_kv = max((m["kv_cache_usage"] for m in per_model.values()), default=0)
            agg_requests = sum(m["active_requests"] for m in per_model.values())
        else:
            # Fallback: fetch aggregate from main port
            raw = await _fetch_raw_metrics()
            metrics = _parse_prometheus(raw)
            rates = _compute_rates(metrics)
            agg_tps = rates["tps"]
            agg_prompt_tps = rates["prompt_tps"]
            agg_kv = round(metrics.get("kv_cache_usage_ratio", 0) * 100, 1)
            agg_requests = int(metrics.get("requests_processing", 0))

        return {
            "tokens_per_second": agg_tps,
            "prompt_tokens_per_second": agg_prompt_tps,
            "requests_processing": agg_requests,
            "kv_cache_usage_ratio": agg_kv / 100 if agg_kv else 0,
            "n_ctx_total": 0,
            "tokens_drafted_total": 0,
            "tokens_drafted_accepted_total": 0,
            "draft_acceptance_pct": None,
            "tokens_predicted_total": 0,
            "tokens_predicted_seconds_total": 0,
            "prompt_tokens_total": 0,
            "prompt_tokens_seconds_total": 0,
            "all_metrics": {},
            "per_model": per_model,
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
            "per_model": {},
        }


@router.get("/api/inference/history", dependencies=[Depends(verify_api_key)])
async def inference_history():
    """Rolling 25-min inference metrics history sampled every 5s, with per-model breakdown."""
    agg = {
        "timestamps": [s["timestamp"] for s in _AGGREGATE_HISTORY],
        "tps": [s["tps"] for s in _AGGREGATE_HISTORY],
        "prompt_tps": [s["prompt_tps"] for s in _AGGREGATE_HISTORY],
        "kv_cache_usage": [s["kv_cache_usage"] for s in _AGGREGATE_HISTORY],
        "active_requests": [s["active_requests"] for s in _AGGREGATE_HISTORY],
    }

    per_model = {}
    for model_name, history in _MODEL_HISTORY.items():
        per_model[model_name] = {
            "tps": [s["tps"] for s in history],
            "prompt_tps": [s["prompt_tps"] for s in history],
            "kv_cache_usage": [s["kv_cache_usage"] for s in history],
            "active_requests": [s["active_requests"] for s in history],
            "color": _assign_color(model_name),
        }

    agg["per_model"] = per_model
    return agg


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
    """Background task: sample per-model inference metrics every 5s."""
    while True:
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            agg_tps = 0.0
            agg_prompt_tps = 0.0
            agg_kv = 0.0
            agg_requests = 0
            got_per_model = False

            try:
                backends = await _discover_model_backends()
                for backend in backends:
                    name = backend["name"]
                    try:
                        raw = await _fetch_raw_metrics(backend["metrics_url"])
                        m = _parse_prometheus(raw)
                        rates = _compute_model_rates(name, m)

                        if name not in _MODEL_HISTORY:
                            _MODEL_HISTORY[name] = deque(maxlen=300)
                        _MODEL_HISTORY[name].append({
                            "timestamp": now_iso,
                            "tps": rates["tps"],
                            "prompt_tps": rates["prompt_tps"],
                            "kv_cache_usage": rates["kv_cache_usage"],
                            "active_requests": rates["active_requests"],
                        })

                        agg_tps += rates["tps"]
                        agg_prompt_tps += rates["prompt_tps"]
                        agg_kv = max(agg_kv, rates["kv_cache_usage"])
                        agg_requests += rates["active_requests"]
                        got_per_model = True
                    except (httpx.HTTPError, httpx.TimeoutException):
                        logger.debug("Per-model poll failed for %s", name)
            except (httpx.HTTPError, httpx.TimeoutException):
                logger.debug("Backend discovery failed in history poll")

            if not got_per_model:
                # Fallback: no per-model data, try aggregate
                try:
                    raw = await _fetch_raw_metrics()
                    metrics = _parse_prometheus(raw)
                    rates = _compute_rates(metrics)
                    agg_tps = rates["tps"]
                    agg_prompt_tps = rates["prompt_tps"]
                    agg_kv = round(metrics.get("kv_cache_usage_ratio", 0) * 100, 1)
                    agg_requests = int(metrics.get("requests_processing", 0))
                except (httpx.HTTPError, httpx.TimeoutException):
                    pass

            _AGGREGATE_HISTORY.append({
                "timestamp": now_iso,
                "tps": agg_tps,
                "prompt_tps": agg_prompt_tps,
                "kv_cache_usage": agg_kv,
                "active_requests": agg_requests,
            })

            # Prune model histories for models no longer loaded
            try:
                current_names = {b["name"] for b in backends} if got_per_model else set()
                stale = [k for k in _MODEL_HISTORY if k not in current_names]
                for k in stale:
                    # Keep history for 5 min after unload (60 samples), then prune
                    if len(_MODEL_HISTORY[k]) > 0 and _MODEL_HISTORY[k][-1] == _MODEL_HISTORY[k][0]:
                        del _MODEL_HISTORY[k]
                        _model_prev.pop(k, None)
            except Exception:
                pass

        except Exception:
            logger.exception("Inference history poll failed")
        await asyncio.sleep(_HISTORY_POLL_INTERVAL)
