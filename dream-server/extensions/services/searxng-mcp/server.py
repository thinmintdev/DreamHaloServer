#!/usr/bin/env python3
"""SearXNG MCP server — web search for DreamHalo AI stack.

Wraps the local SearXNG instance as an MCP tool so agents can
perform live web searches without leaving the dream-network.
"""
import os

import httpx
from fastmcp import FastMCP

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://searxng:8080")

mcp = FastMCP("searxng")


@mcp.tool()
async def web_search(
    query: str,
    categories: str = "general",
    language: str = "en",
    max_results: int = 10,
) -> str:
    """Search the web using the local SearXNG instance.

    Args:
        query: Search query string
        categories: Comma-separated categories (general, news, science, it, etc.)
        language: Language code for results (en, fr, de, etc.)
        max_results: Max number of results to return (1–20, default: 10)
    """
    params = {
        "q": query,
        "categories": categories,
        "language": language,
        "format": "json",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(f"{SEARXNG_URL}/search", params=params)
        r.raise_for_status()
    data = r.json()
    results = data.get("results", [])[:max_results]
    if not results:
        return f"No results found for: {query}"
    lines = [f"Search results for: {query}\n"]
    for i, result in enumerate(results, 1):
        lines.append(f"{i}. {result.get('title', 'Untitled')}")
        lines.append(f"   URL: {result.get('url', '')}")
        if snippet := result.get("content", ""):
            lines.append(f"   {snippet[:200]}")
        lines.append("")
    return "\n".join(lines)


@mcp.tool()
async def news_search(query: str, max_results: int = 10) -> str:
    """Search for recent news articles via SearXNG.

    Args:
        query: News topic or keywords to search
        max_results: Max number of articles to return (1–20, default: 10)
    """
    params = {"q": query, "categories": "news", "format": "json"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(f"{SEARXNG_URL}/search", params=params)
        r.raise_for_status()
    data = r.json()
    results = data.get("results", [])[:max_results]
    if not results:
        return f"No news found for: {query}"
    lines = [f"News results for: {query}\n"]
    for i, result in enumerate(results, 1):
        lines.append(f"{i}. {result.get('title', 'Untitled')}")
        lines.append(f"   URL: {result.get('url', '')}")
        if pub_date := result.get("publishedDate", ""):
            lines.append(f"   Published: {pub_date}")
        if snippet := result.get("content", ""):
            lines.append(f"   {snippet[:200]}")
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    port = int(os.environ.get("MCP_PORT", "8813"))
    host = os.environ.get("MCP_HOST", "0.0.0.0")
    mcp.run(transport="streamable-http", host=host, port=port)
