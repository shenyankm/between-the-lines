"""Read-only public-topic search; never receives conversation or player text."""

import asyncio
import hashlib
import time
from datetime import timedelta
from typing import Any

import httpx
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .db import SearchCache, utcnow
from .zhihu_import import normalize

TOPICS = {
    0: "职场 人际关系 内耗 自我成长",
    1: "同事 开玩笑 如何建立边界",
    2: "采购审批 流程受阻 向领导汇报",
    3: "同事造谣 如何澄清",
    4: "职场 人际关系 边界",
}


async def search(
    client: httpx.AsyncClient, secret: str, query: str, count: int = 10
) -> list[dict[str, Any]]:
    response = await client.get(
        "/api/v1/content/zhihu_search",
        params={"Query": query, "Count": min(10, count)},
        headers={
            "Authorization": f"Bearer {secret}",
            "X-Request-Timestamp": str(int(time.time())),
            "Content-Type": "application/json",
        },
    )
    response.raise_for_status()
    raw = response.json()
    if not isinstance(raw, dict) or raw.get("Code") != 0:
        raise ValueError("Search unavailable")
    data = raw.get("Data")
    if not isinstance(data, dict) or not isinstance(data.get("Items"), list):
        raise ValueError("Invalid search response")
    rows = [
        row
        for item in data["Items"][:10]
        if isinstance(item, dict) and (row := normalize(item, query))
    ]
    unique = {(r["content_type"], r["content_id"]): r for r in rows}
    return [
        {
            "id": f"{r['content_type']}:{r['content_id']}",
            "title": r["title"],
            "author": r["author_name"],
            "url": r["source_url"],
            "summary": r["summary"][:1500],
            "hash": hashlib.sha256(r["summary"].encode()).hexdigest(),
        }
        for r in list(unique.values())[:6]
    ]


async def topic_sources(
    sessions: async_sessionmaker[AsyncSession], secret: str, act: int
) -> tuple[list[dict[str, Any]], str]:
    query = TOPICS[act]
    # Database advisory lock coalesces across processes, not just one worker.
    async with sessions.begin() as db:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
            {"key": "search:" + query},
        )
        cached = await db.scalar(select(SearchCache).where(SearchCache.topic == query))
        if cached and cached.expires_at > utcnow():
            return cached.sources, "实时检索缓存 · AI 整理"
        try:
            if not secret:
                raise ValueError("Search unconfigured")
            async with (
                asyncio.timeout(8),
                httpx.AsyncClient(
                    base_url="https://developer.zhihu.com", timeout=7, follow_redirects=False
                ) as client,
            ):
                sources = await search(client, secret, query)
            if not sources:
                raise ValueError("No sources")
        except (ValueError, httpx.HTTPError, TimeoutError):
            if cached and cached.sources:
                return cached.sources, "历史检索缓存（更新失败） · AI 整理"
            return [], "已审核资料 · AI 整理"
        if cached:
            cached.sources = sources
            cached.expires_at = utcnow() + timedelta(hours=24)
        else:
            db.add(
                SearchCache(topic=query, sources=sources, expires_at=utcnow() + timedelta(hours=24))
            )
        return sources, "实时检索 · AI 整理"
