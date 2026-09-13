"""Import a bounded sample of public Zhihu search results into PostgreSQL."""

import argparse
import asyncio
import json
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy import case, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from .config import get_settings
from .db import ZhihuContent, utcnow
from .storage import Database

DEFAULT_QUERIES = [
    "同事 开玩笑 贬低 如何建立边界",
    "同事聚餐 不通知 被排挤 怎么办",
    "采购审批 流程受阻 向领导汇报",
    "同事造谣 跳槽 如何澄清",
    "职场 人际关系 内耗 自我成长",
]


def normalize(item: dict[str, Any], query: str) -> dict[str, Any] | None:
    content_id = str(item.get("ContentID") or "").strip()
    content_type = str(item.get("ContentType") or "").strip().lower()
    title = str(item.get("Title") or "").strip()
    summary = str(item.get("ContentText") or "").strip()
    url = str(item.get("Url") or "").strip()
    try:
        parsed = urlsplit(url)
        hostname = parsed.hostname or ""
        valid_url = (
            parsed.scheme == "https"
            and (hostname == "zhihu.com" or hostname.endswith(".zhihu.com"))
            and not parsed.username
            and not parsed.password
            and parsed.port in (None, 443)
        )
        votes = max(0, int(item.get("VoteUpCount") or 0))
        comments = max(0, int(item.get("CommentCount") or 0))
    except (TypeError, ValueError):
        return None
    if not valid_url or not content_id or len(content_id) > 255:
        return None
    if not content_type or len(content_type) > 50 or not title or not summary:
        return None
    return {
        "content_type": content_type,
        "content_id": content_id,
        "title": title,
        "summary": summary,
        "source_url": url,
        "author_name": str(item.get("AuthorName") or ""),
        "vote_count": min(votes, 2147483647),
        "comment_count": min(comments, 2147483647),
        "topics": [query],
        "fetched_at": utcnow(),
    }


async def persist(rows: list[dict[str, Any]], sessions: async_sessionmaker[AsyncSession]) -> int:
    async with sessions.begin() as db:
        for row in rows:
            # Preserve existing topic tags atomically without duplicates on re-import.
            statement = insert(ZhihuContent).values(**row)
            updates = {
                key: value
                for key, value in row.items()
                if key not in ("content_id", "content_type", "topics")
            }
            updates["topics"] = case(
                (ZhihuContent.topics.contains(row["topics"]), ZhihuContent.topics),
                else_=ZhihuContent.topics.op("||")(statement.excluded.topics),
            )
            await db.execute(
                statement.on_conflict_do_update(
                    index_elements=[ZhihuContent.content_type, ZhihuContent.content_id],
                    set_=updates,
                )
            )
    return len(rows)


async def run(
    queries: list[str], count: int, sessions: async_sessionmaker[AsyncSession]
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.zhihu_access_secret:
        raise RuntimeError("ZHIHU_ACCESS_SECRET is not configured")
    report: dict[str, Any] = {"source": "zhihu_search", "queries": [], "imported_unique": 0}
    seen: set[tuple[str, str]] = set()
    async with httpx.AsyncClient(
        base_url="https://developer.zhihu.com", timeout=30, follow_redirects=False
    ) as client:

        async def get(path: str, params: dict[str, str | int]) -> Any:
            response = await client.get(
                path,
                params=params,
                headers={
                    "Authorization": f"Bearer {settings.zhihu_access_secret}",
                    "X-Request-Timestamp": str(int(time.time())),
                    "Content-Type": "application/json",
                },
            )
            if response.status_code != 200:
                raise RuntimeError(f"Zhihu HTTP {response.status_code}")
            data = response.json()
            if data.get("Code") != 0:
                raise RuntimeError(f"Zhihu API code {data.get('Code')}")
            return data["Data"]

        quota = await get("/api/v1/quota", {"APIIDs": "zhihu_search"})
        remaining = next((q["RemainingQuota"] for q in quota if q["APIID"] == "zhihu_search"), 0)
        report["quota_before"] = remaining
        if remaining < len(queries):
            raise RuntimeError("Not enough search quota; nothing imported")
        for index, query in enumerate(queries):
            if index:
                # Daily quota does not remove the provider's short-term rate limit.
                await asyncio.sleep(4)
            data = await get("/api/v1/content/zhihu_search", {"Query": query, "Count": count})
            items = data.get("Items", [])
            rows = [
                row for item in items if isinstance(item, dict) and (row := normalize(item, query))
            ]
            await persist(rows, sessions)
            seen.update((row["content_type"], row["content_id"]) for row in rows)
            report["queries"].append({"query": query, "received": len(items), "stored": len(rows)})
            print(json.dumps(report["queries"][-1], ensure_ascii=False))
    report["imported_unique"] = len(seen)
    async with sessions() as db:
        report["database_total"] = await db.scalar(select(func.count()).select_from(ZhihuContent))
    return report


def write_report(report: dict[str, Any]) -> None:
    """Persist and echo the import report. Blocking on purpose: called outside the loop."""
    directory = Path(__file__).resolve().parents[2] / "artifacts"
    directory.mkdir(exist_ok=True)
    (directory / "zhihu-import.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps(report, ensure_ascii=False))


async def main() -> dict[str, Any]:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", action="append", help="Repeat up to ten times")
    parser.add_argument("--count", type=int, default=5, choices=range(1, 11))
    args = parser.parse_args()
    queries = args.query or DEFAULT_QUERIES
    if len(queries) > 10 or any(not q.strip() for q in queries):
        parser.error("Provide one to ten nonempty queries")
    database = Database(get_settings())
    try:
        return await run(queries, args.count, database.sessions)
    finally:
        await database.close()


if __name__ == "__main__":
    try:
        write_report(asyncio.run(main()))
    except Exception as exc:
        # Do not print request objects, credentials or provider response bodies.
        print(f"Import stopped: {type(exc).__name__}. Earlier query batches remain committed.")
        raise SystemExit(1) from None
