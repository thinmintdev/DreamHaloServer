"""File-based memory management for OpenClaw agent workspaces.

Provides the dashboard Memory page with CRUD access to OpenClaw's
markdown memory files stored on disk. Supports auto-discovering agent
workspaces, listing agents, browsing memory files, reading/editing
content, searching across all agents, and managing the MEMORY.md index.
"""

import logging
import os
import re
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memory", tags=["memory"], dependencies=[Depends(verify_api_key)])

# Agent workspace roots — mounted read-write from host
WORKSPACE_BASE = Path(os.environ.get("OPENCLAW_WORKSPACE_DIR", "/openclaw-workspaces"))


def _discover_agents() -> dict[str, str]:
    """Auto-discover agent workspaces by scanning WORKSPACE_BASE.

    A valid agent workspace is any subdirectory that contains either:
    - a `.claude/` folder (standard Claude workspace)
    - a `memory/` folder with .md files
    - a `MEMORY.md` file

    Returns a dict mapping agent_id -> directory name.
    """
    agents: dict[str, str] = {}
    if not WORKSPACE_BASE.is_dir():
        return agents

    for entry in sorted(WORKSPACE_BASE.iterdir()):
        if not entry.is_dir():
            continue
        # Skip hidden directories
        if entry.name.startswith("."):
            continue

        has_claude = (entry / ".claude").is_dir()
        has_memory_dir = (entry / "memory").is_dir()
        has_memory_index = (entry / "MEMORY.md").is_file()

        if has_claude or has_memory_dir or has_memory_index:
            # Derive agent id from directory name:
            # "workspace" -> "agentmint" (primary), "workspace-X" -> "X"
            dir_name = entry.name
            if dir_name == "workspace":
                agent_id = "agentmint"
            elif dir_name.startswith("workspace-"):
                agent_id = dir_name[len("workspace-"):]
            else:
                agent_id = dir_name
            agents[agent_id] = dir_name

    return agents


def _agent_workspace(agent_id: str) -> Path:
    agents = _discover_agents()
    dir_name = agents.get(agent_id)
    if not dir_name:
        raise HTTPException(status_code=404, detail=f"Unknown agent: {agent_id}")
    ws = WORKSPACE_BASE / dir_name
    if not ws.is_dir():
        raise HTTPException(status_code=404, detail=f"Workspace not found for {agent_id}")
    return ws


def _memory_dir(agent_id: str) -> Path:
    return _agent_workspace(agent_id) / "memory"


def _safe_path(base: Path, relative: str) -> Path:
    """Resolve a relative path under base, preventing traversal."""
    resolved = (base / relative).resolve()
    if not str(resolved).startswith(str(base.resolve())):
        raise HTTPException(status_code=400, detail="Invalid path")
    return resolved


def _parse_frontmatter(content: str) -> dict:
    """Extract YAML frontmatter from markdown content."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if not match:
        return {}
    fm = {}
    for line in match.group(1).strip().splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            fm[key.strip()] = value.strip()
    return fm


def _file_info(filepath: Path, memory_dir: Path) -> dict:
    """Build file info dict for a memory file."""
    relative = str(filepath.relative_to(memory_dir))
    stat = filepath.stat()
    content = filepath.read_text(encoding="utf-8", errors="replace")
    fm = _parse_frontmatter(content)
    return {
        "path": relative,
        "name": fm.get("name", filepath.stem),
        "description": fm.get("description", ""),
        "type": fm.get("type", ""),
        "size": stat.st_size,
        "modified": stat.st_mtime,
        "lines": content.count("\n") + 1,
    }


@router.get("/agents")
async def list_agents():
    """List available agents with their memory stats (auto-discovered)."""
    agents_map = _discover_agents()
    agents = []
    for agent_id, dir_name in agents_map.items():
        ws = WORKSPACE_BASE / dir_name
        if not ws.is_dir():
            continue
        mem_dir = ws / "memory"
        file_count = 0
        total_size = 0
        if mem_dir.is_dir():
            for f in mem_dir.rglob("*.md"):
                file_count += 1
                total_size += f.stat().st_size
        index_path = ws / "MEMORY.md"
        agents.append({
            "id": agent_id,
            "directory": dir_name,
            "files": file_count,
            "total_size": total_size,
            "has_index": index_path.is_file(),
        })
    return {"agents": agents}


class CreateAgentBody(BaseModel):
    agent_id: str


@router.post("/agents")
async def create_agent(body: CreateAgentBody):
    """Create a new agent workspace with initial directory structure."""
    agent_id = body.agent_id.strip()
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id is required")
    if not re.match(r"^[a-zA-Z0-9_-]+$", agent_id):
        raise HTTPException(status_code=400, detail="agent_id must be alphanumeric (with hyphens/underscores)")

    # Check if agent already exists
    existing = _discover_agents()
    if agent_id in existing:
        raise HTTPException(status_code=409, detail=f"Agent '{agent_id}' already exists")

    # Derive directory name
    dir_name = f"workspace-{agent_id}"
    ws = WORKSPACE_BASE / dir_name

    # Create directory structure
    ws.mkdir(parents=True, exist_ok=True)
    (ws / ".claude").mkdir(exist_ok=True)
    (ws / "memory").mkdir(exist_ok=True)

    # Create initial MEMORY.md
    index_path = ws / "MEMORY.md"
    index_path.write_text(
        f"# Memory Index\n\nAgent workspace for **{agent_id}**.\n",
        encoding="utf-8",
    )

    return {
        "status": "ok",
        "agent_id": agent_id,
        "directory": dir_name,
    }


@router.get("/search")
async def search_memory(q: str = ""):
    """Search across all agent memory files for a query string."""
    if not q.strip():
        raise HTTPException(status_code=400, detail="Query parameter 'q' is required")

    query = q.strip()
    try:
        pattern = re.compile(re.escape(query), re.IGNORECASE)
    except re.error:
        raise HTTPException(status_code=400, detail="Invalid search query")

    agents_map = _discover_agents()
    results: list[dict] = []

    for agent_id, dir_name in agents_map.items():
        ws = WORKSPACE_BASE / dir_name
        if not ws.is_dir():
            continue

        agent_matches: list[dict] = []

        # Search MEMORY.md index
        index_path = ws / "MEMORY.md"
        if index_path.is_file():
            content = index_path.read_text(encoding="utf-8", errors="replace")
            matches = _find_matches(content, pattern)
            if matches:
                agent_matches.append({
                    "file": "MEMORY.md",
                    "is_index": True,
                    "matches": matches,
                })

        # Search memory/ files
        mem_dir = ws / "memory"
        if mem_dir.is_dir():
            for filepath in sorted(mem_dir.rglob("*.md")):
                content = filepath.read_text(encoding="utf-8", errors="replace")
                matches = _find_matches(content, pattern)
                if matches:
                    agent_matches.append({
                        "file": str(filepath.relative_to(mem_dir)),
                        "is_index": False,
                        "matches": matches,
                    })

        if agent_matches:
            results.append({
                "agent_id": agent_id,
                "files": agent_matches,
            })

    return {"query": query, "results": results}


def _find_matches(content: str, pattern: re.Pattern, context_lines: int = 1) -> list[dict]:
    """Find all matches of a pattern in content, returning line-based context snippets."""
    lines = content.splitlines()
    matches: list[dict] = []
    seen_lines: set[int] = set()

    for i, line in enumerate(lines):
        if pattern.search(line) and i not in seen_lines:
            start = max(0, i - context_lines)
            end = min(len(lines), i + context_lines + 1)
            snippet = "\n".join(lines[start:end])
            matches.append({
                "line": i + 1,
                "snippet": snippet[:500],  # cap snippet length
            })
            seen_lines.update(range(start, end))

    return matches[:20]  # cap total matches per file


@router.get("/agents/{agent_id}/files")
async def list_files(agent_id: str):
    """List all memory files for an agent."""
    mem_dir = _memory_dir(agent_id)
    if not mem_dir.is_dir():
        return {"files": []}
    files = []
    for filepath in sorted(mem_dir.rglob("*.md")):
        files.append(_file_info(filepath, mem_dir))
    return {"files": files}


@router.get("/agents/{agent_id}/index")
async def get_index(agent_id: str):
    """Read the MEMORY.md index file."""
    ws = _agent_workspace(agent_id)
    index_path = ws / "MEMORY.md"
    if not index_path.is_file():
        return {"content": "", "exists": False}
    return {
        "content": index_path.read_text(encoding="utf-8", errors="replace"),
        "exists": True,
        "modified": index_path.stat().st_mtime,
    }


@router.put("/agents/{agent_id}/index")
async def update_index(agent_id: str, body: dict):
    """Update the MEMORY.md index file."""
    content = body.get("content")
    if content is None:
        raise HTTPException(status_code=400, detail="content is required")
    ws = _agent_workspace(agent_id)
    index_path = ws / "MEMORY.md"
    index_path.write_text(content, encoding="utf-8")
    return {"status": "ok", "modified": index_path.stat().st_mtime}


@router.get("/agents/{agent_id}/files/{file_path:path}")
async def read_file(agent_id: str, file_path: str):
    """Read a memory file's content."""
    mem_dir = _memory_dir(agent_id)
    filepath = _safe_path(mem_dir, file_path)
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    content = filepath.read_text(encoding="utf-8", errors="replace")
    stat = filepath.stat()
    fm = _parse_frontmatter(content)
    return {
        "path": file_path,
        "content": content,
        "name": fm.get("name", filepath.stem),
        "description": fm.get("description", ""),
        "type": fm.get("type", ""),
        "size": stat.st_size,
        "modified": stat.st_mtime,
    }


@router.put("/agents/{agent_id}/files/{file_path:path}")
async def write_file(agent_id: str, file_path: str, body: dict):
    """Create or update a memory file."""
    content = body.get("content")
    if content is None:
        raise HTTPException(status_code=400, detail="content is required")
    mem_dir = _memory_dir(agent_id)
    if not mem_dir.is_dir():
        mem_dir.mkdir(parents=True, exist_ok=True)
    filepath = _safe_path(mem_dir, file_path)
    filepath.parent.mkdir(parents=True, exist_ok=True)
    filepath.write_text(content, encoding="utf-8")
    return {"status": "ok", "path": file_path, "modified": filepath.stat().st_mtime}


@router.delete("/agents/{agent_id}/files/{file_path:path}")
async def delete_file(agent_id: str, file_path: str):
    """Delete a memory file."""
    mem_dir = _memory_dir(agent_id)
    filepath = _safe_path(mem_dir, file_path)
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    filepath.unlink()
    # Clean up empty parent directories
    parent = filepath.parent
    while parent != mem_dir and not any(parent.iterdir()):
        parent.rmdir()
        parent = parent.parent
    return {"status": "ok"}
