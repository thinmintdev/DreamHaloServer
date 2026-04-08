"""Container management endpoints — list, stats, logs, inspect."""

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.responses import StreamingResponse

from security import verify_api_key

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(verify_api_key)])


async def _run_docker(*args: str) -> str:
    """Run a docker CLI command and return stdout."""
    proc = await asyncio.create_subprocess_exec(
        "docker", *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise HTTPException(status_code=502, detail=f"docker {args[0]} failed: {stderr.decode().strip()}")
    return stdout.decode()


def _parse_jsonlines(raw: str) -> list[dict]:
    """Parse newline-delimited JSON (docker --format json output)."""
    results = []
    for line in raw.strip().splitlines():
        line = line.strip()
        if line:
            try:
                results.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return results


def _parse_memory(mem_str: str) -> tuple[float, str]:
    """Parse docker stats memory string like '45.2MiB / 512MiB' into (percent, display)."""
    if not mem_str or "/" not in mem_str:
        return 0.0, mem_str or "0B / 0B"
    parts = mem_str.split("/")
    return 0.0, mem_str.strip()


def _parse_percent(val: str) -> float:
    """Parse '12.34%' into 12.34."""
    try:
        return float(val.strip().rstrip("%"))
    except (ValueError, AttributeError):
        return 0.0


@router.get("/api/containers")
async def list_containers():
    """List all containers with live resource stats."""
    ps_raw, stats_raw = await asyncio.gather(
        _run_docker(
            "ps", "-a",
            "--format", '{"ID":"{{.ID}}","Name":"{{.Names}}","Image":"{{.Image}}","Status":"{{.Status}}","State":"{{.State}}","Ports":"{{.Ports}}","CreatedAt":"{{.CreatedAt}}"}',
        ),
        _run_docker(
            "stats", "--no-stream",
            "--format", '{"Name":"{{.Name}}","CPUPerc":"{{.CPUPerc}}","MemUsage":"{{.MemUsage}}","MemPerc":"{{.MemPerc}}","NetIO":"{{.NetIO}}","BlockIO":"{{.BlockIO}}","PIDs":"{{.PIDs}}"}',
        ),
    )

    containers = _parse_jsonlines(ps_raw)
    stats_by_name = {s["Name"]: s for s in _parse_jsonlines(stats_raw)}

    result = []
    for c in containers:
        name = c.get("Name", "")
        stats = stats_by_name.get(name, {})
        result.append({
            "id": c.get("ID", ""),
            "name": name,
            "image": c.get("Image", ""),
            "status": c.get("State", "unknown").lower(),
            "state": c.get("Status", ""),
            "ports": c.get("Ports", ""),
            "created": c.get("CreatedAt", ""),
            "cpu_percent": _parse_percent(stats.get("CPUPerc", "0%")),
            "memory_usage": stats.get("MemUsage", "0B / 0B"),
            "memory_percent": _parse_percent(stats.get("MemPerc", "0%")),
            "net_io": stats.get("NetIO", "0B / 0B"),
            "block_io": stats.get("BlockIO", "0B / 0B"),
            "pids": stats.get("PIDs", "0"),
        })

    return result


@router.get("/api/containers/{container_id}/logs")
async def stream_container_logs(
    container_id: str,
    tail: int = Query(default=200, ge=1, le=10000),
    follow: bool = Query(default=True),
):
    """Stream container logs as Server-Sent Events."""

    async def event_generator():
        args = ["logs", "--tail", str(tail), "--timestamps"]
        if follow:
            args.append("-f")
        args.append(container_id)

        proc = await asyncio.create_subprocess_exec(
            "docker", *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        try:
            async for raw_line in proc.stdout:
                line = raw_line.decode("utf-8", errors="replace").rstrip("\n")
                if not line:
                    continue

                # Split timestamp from message (docker --timestamps format)
                timestamp = ""
                message = line
                if len(line) > 30 and line[4] == "-" and "T" in line[:30]:
                    space_idx = line.find(" ", 20)
                    if space_idx > 0:
                        timestamp = line[:space_idx]
                        message = line[space_idx + 1:]

                # Detect log level
                msg_lower = message.lower()
                if "error" in msg_lower or "fatal" in msg_lower or "panic" in msg_lower:
                    level = "error"
                elif "warn" in msg_lower:
                    level = "warn"
                elif "debug" in msg_lower or "trace" in msg_lower:
                    level = "debug"
                else:
                    level = "info"

                payload = json.dumps({"timestamp": timestamp, "line": message, "level": level})
                yield f"data: {payload}\n\n"
        except asyncio.CancelledError:
            proc.kill()
            raise
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/api/containers/{container_id}/inspect")
async def inspect_container(container_id: str):
    """Return detailed container inspection data."""
    raw = await _run_docker("inspect", container_id)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="Failed to parse docker inspect output") from exc

    if not data:
        raise HTTPException(status_code=404, detail=f"Container {container_id} not found")

    info = data[0]
    config = info.get("Config", {})
    host_config = info.get("HostConfig", {})
    network_settings = info.get("NetworkSettings", {})
    state = info.get("State", {})

    mounts = []
    for m in info.get("Mounts", []):
        mounts.append({
            "type": m.get("Type", ""),
            "source": m.get("Source", ""),
            "destination": m.get("Destination", ""),
            "mode": m.get("Mode", ""),
            "rw": m.get("RW", False),
        })

    networks = {}
    for name, net in network_settings.get("Networks", {}).items():
        networks[name] = {
            "ip": net.get("IPAddress", ""),
            "gateway": net.get("Gateway", ""),
            "mac": net.get("MacAddress", ""),
        }

    return {
        "id": info.get("Id", "")[:12],
        "name": info.get("Name", "").lstrip("/"),
        "image": config.get("Image", ""),
        "created": info.get("Created", ""),
        "state": {
            "status": state.get("Status", ""),
            "running": state.get("Running", False),
            "started_at": state.get("StartedAt", ""),
            "finished_at": state.get("FinishedAt", ""),
            "exit_code": state.get("ExitCode", 0),
            "health": state.get("Health", {}).get("Status", ""),
        },
        "env": config.get("Env", []),
        "cmd": config.get("Cmd", []),
        "entrypoint": config.get("Entrypoint", []),
        "labels": config.get("Labels", {}),
        "mounts": mounts,
        "networks": networks,
        "restart_policy": {
            "name": host_config.get("RestartPolicy", {}).get("Name", ""),
            "max_retry": host_config.get("RestartPolicy", {}).get("MaximumRetryCount", 0),
        },
        "resources": {
            "cpu_shares": host_config.get("CpuShares", 0),
            "memory_limit": host_config.get("Memory", 0),
            "nano_cpus": host_config.get("NanoCpus", 0),
        },
    }
