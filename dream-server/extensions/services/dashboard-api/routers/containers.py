"""Container management endpoints — list, stats, logs, inspect.

Uses Docker Engine API over Unix socket (/var/run/docker.sock) directly
via aiohttp, avoiding the need for Docker CLI in the container.
"""

import asyncio
import json
import logging

import aiohttp
from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.responses import StreamingResponse

from security import verify_api_key

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(verify_api_key)])

DOCKER_SOCKET = "/var/run/docker.sock"


async def _docker_get(path: str, params: dict | None = None, timeout: int = 30) -> dict | list:
    """GET request to Docker Engine API via Unix socket."""
    connector = aiohttp.UnixConnector(path=DOCKER_SOCKET)
    try:
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(
                f"http://localhost{path}",
                params=params,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                if resp.status >= 400:
                    body = await resp.text()
                    raise HTTPException(status_code=502, detail=f"Docker API {path}: {resp.status} {body[:200]}")
                return await resp.json()
    except aiohttp.ClientError as exc:
        raise HTTPException(status_code=502, detail=f"Docker socket error: {exc}") from exc


def _format_ports(ports_config: dict | None) -> str:
    """Format Docker API port bindings into human-readable string."""
    if not ports_config:
        return ""
    parts = []
    for container_port, bindings in ports_config.items():
        if bindings:
            for b in bindings:
                host_ip = b.get("HostIp", "0.0.0.0")
                host_port = b.get("HostPort", "")
                parts.append(f"{host_ip}:{host_port}->{container_port}")
        else:
            parts.append(container_port)
    return ", ".join(parts)


def _bytes_to_human(b: int | float) -> str:
    """Convert bytes to human-readable string."""
    if b < 1024:
        return f"{b}B"
    if b < 1024 ** 2:
        return f"{b / 1024:.1f}KiB"
    if b < 1024 ** 3:
        return f"{b / 1024**2:.1f}MiB"
    return f"{b / 1024**3:.2f}GiB"


@router.get("/api/containers")
async def list_containers():
    """List all containers with live resource stats."""
    # Fetch container list and stats in parallel
    containers_data = await _docker_get("/containers/json", {"all": "true"})

    # Fetch stats for running containers (no-stream)
    running = [c for c in containers_data if c.get("State") == "running"]

    async def get_stats(cid: str) -> dict | None:
        try:
            return await _docker_get(f"/containers/{cid}/stats", {"stream": "false"}, timeout=10)
        except Exception:
            return None

    stats_list = await asyncio.gather(*(get_stats(c["Id"][:12]) for c in running))
    stats_by_id = {}
    for c, s in zip(running, stats_list):
        if s:
            stats_by_id[c["Id"][:12]] = s

    result = []
    for c in containers_data:
        cid = c["Id"][:12]
        name = (c.get("Names") or ["/unknown"])[0].lstrip("/")
        state = c.get("State", "unknown").lower()
        status_str = c.get("Status", "")
        image = c.get("Image", "")
        ports = _format_ports(c.get("Ports") if isinstance(c.get("Ports"), dict) else None)

        # Parse ports from the list format the API returns
        if not ports and isinstance(c.get("Ports"), list):
            port_parts = []
            for p in c["Ports"]:
                if p.get("PublicPort"):
                    port_parts.append(f"{p.get('IP', '0.0.0.0')}:{p['PublicPort']}->{p['PrivatePort']}/{p.get('Type', 'tcp')}")
                else:
                    port_parts.append(f"{p['PrivatePort']}/{p.get('Type', 'tcp')}")
            ports = ", ".join(port_parts)

        created = c.get("Created", 0)

        # Calculate stats
        cpu_pct = 0.0
        mem_pct = 0.0
        mem_usage_str = "0B / 0B"
        net_io = "0B / 0B"
        block_io = "0B / 0B"
        pids = "0"

        stats = stats_by_id.get(cid)
        if stats:
            # CPU percentage
            cpu_delta = stats.get("cpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0) - \
                        stats.get("precpu_stats", {}).get("cpu_usage", {}).get("total_usage", 0)
            sys_delta = stats.get("cpu_stats", {}).get("system_cpu_usage", 0) - \
                        stats.get("precpu_stats", {}).get("system_cpu_usage", 0)
            num_cpus = stats.get("cpu_stats", {}).get("online_cpus", 1) or 1
            if sys_delta > 0 and cpu_delta > 0:
                cpu_pct = round((cpu_delta / sys_delta) * num_cpus * 100, 2)

            # Memory
            mem_stats = stats.get("memory_stats", {})
            mem_used = mem_stats.get("usage", 0) - mem_stats.get("stats", {}).get("cache", 0)
            mem_limit = mem_stats.get("limit", 0)
            if mem_limit > 0:
                mem_pct = round((mem_used / mem_limit) * 100, 2)
            mem_usage_str = f"{_bytes_to_human(mem_used)} / {_bytes_to_human(mem_limit)}"

            # Network I/O
            net = stats.get("networks", {})
            rx = sum(n.get("rx_bytes", 0) for n in net.values())
            tx = sum(n.get("tx_bytes", 0) for n in net.values())
            net_io = f"{_bytes_to_human(rx)} / {_bytes_to_human(tx)}"

            # Block I/O
            blk = stats.get("blkio_stats", {}).get("io_service_bytes_recursive") or []
            blk_read = sum(e.get("value", 0) for e in blk if e.get("op") == "read")
            blk_write = sum(e.get("value", 0) for e in blk if e.get("op") == "write")
            block_io = f"{_bytes_to_human(blk_read)} / {_bytes_to_human(blk_write)}"

            pids = str(stats.get("pids_stats", {}).get("current", 0))

        result.append({
            "id": cid,
            "name": name,
            "image": image,
            "status": state,
            "state": status_str,
            "ports": ports,
            "created": created,
            "cpu_percent": cpu_pct,
            "memory_usage": mem_usage_str,
            "memory_percent": mem_pct,
            "net_io": net_io,
            "block_io": block_io,
            "pids": pids,
        })

    return result


@router.get("/api/containers/{container_id}/logs")
async def stream_container_logs(
    container_id: str,
    tail: int = Query(default=200, ge=1, le=10000),
    follow: bool = Query(default=True),
):
    """Stream container logs as Server-Sent Events via Docker Engine API."""

    async def event_generator():
        connector = aiohttp.UnixConnector(path=DOCKER_SOCKET)
        params = {
            "stdout": "true",
            "stderr": "true",
            "timestamps": "true",
            "tail": str(tail),
        }
        if follow:
            params["follow"] = "true"

        try:
            async with aiohttp.ClientSession(connector=connector) as session:
                async with session.get(
                    f"http://localhost/containers/{container_id}/logs",
                    params=params,
                    timeout=aiohttp.ClientTimeout(total=0),  # no timeout for streaming
                ) as resp:
                    if resp.status >= 400:
                        body = await resp.text()
                        yield f"data: {json.dumps({'level': 'error', 'line': f'Docker API error: {resp.status} {body[:200]}', 'timestamp': ''})}\n\n"
                        return

                    buffer = b""
                    async for chunk in resp.content.iter_any():
                        buffer += chunk
                        while b"\n" in buffer:
                            raw_line, buffer = buffer.split(b"\n", 1)
                            # Docker multiplexed stream: first 8 bytes are header
                            # [stream_type(1), 0, 0, 0, size(4)]
                            if len(raw_line) >= 8:
                                line = raw_line[8:].decode("utf-8", errors="replace").rstrip()
                            else:
                                line = raw_line.decode("utf-8", errors="replace").rstrip()

                            if not line:
                                continue

                            # Split timestamp from message
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
            raise
        except aiohttp.ClientError as exc:
            yield f"data: {json.dumps({'level': 'error', 'line': f'Connection lost: {exc}', 'timestamp': ''})}\n\n"

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
    info = await _docker_get(f"/containers/{container_id}/json")

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
