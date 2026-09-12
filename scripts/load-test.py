"""Exercise 10/20/30 parallel player turns against an explicitly MOCK local server."""

import asyncio
import json
import statistics
import time
from pathlib import Path
from uuid import uuid4

import httpx


async def play(concurrency):
    clients = [
        httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=90) for _ in range(concurrency)
    ]

    async def setup(client):
        (await client.post("/api/auth/dev", json={"name": "并发测试"})).raise_for_status()
        save = (await client.post("/api/saves", json={})).json()
        for action in ("begin", "boundary", "next"):
            response = await client.post(
                f"/api/saves/{save['id']}/turns",
                json={
                    "request_id": str(uuid4()),
                    "version": save["version"],
                    "action": action,
                },
            )
            response.raise_for_status()
            save = (await client.get(f"/api/saves/{save['id']}")).json()
        return save

    try:
        saves = await asyncio.gather(*(setup(c) for c in clients))

        async def request(client, save):
            request_id = str(uuid4())
            start = time.perf_counter()
            response = await client.post(
                f"/api/saves/{save['id']}/turns",
                json={
                    "request_id": request_id,
                    "version": save["version"],
                    "npc": "sun",
                    "action": "speak",
                    "text": "请说明采购还缺哪些材料。",
                },
            )
            elapsed = time.perf_counter() - start
            if response.status_code != 200:
                return {"seconds": elapsed, "status": response.status_code, "usage": {}}
            turn = (await client.get(f"/api/saves/{save['id']}/turns/{request_id}")).json()
            return {
                "seconds": elapsed,
                "status": turn["status"],
                "usage": turn["usage"],
            }

        results = await asyncio.gather(
            *(request(c, s) for c, s in zip(clients, saves, strict=True))
        )
        durations = sorted(r["seconds"] for r in results)
        return {
            "concurrency": concurrency,
            "mode": "mock_deepseek_transport_real_agent_graph",
            "completed": sum(r["status"] == "completed" for r in results),
            "failure_rate": sum(r["status"] != "completed" for r in results) / concurrency,
            "p50_seconds": round(statistics.median(durations), 3),
            "p95_seconds": round(durations[max(0, int(len(durations) * 0.95) - 1)], 3),
            "model_calls": sum(r["usage"].get("model_calls", 0) for r in results),
            "cost_estimate_usd": sum(r["usage"].get("cost_estimate_usd", 0) for r in results),
            "results": results,
        }
    finally:
        await asyncio.gather(*(c.aclose() for c in clients))


async def main():
    async with httpx.AsyncClient() as client:
        config = (await client.get("http://127.0.0.1:8000/api/config")).json()
        if config.get("agent_mode") != "mock" or not config.get("dev_login"):
            raise SystemExit("Refusing: load test requires development mock mode")
    report = [await play(count) for count in (10, 20, 30)]
    path = Path(__file__).resolve().parents[1] / "artifacts/load-test.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    for row in report:
        print(json.dumps({k: v for k, v in row.items() if k != "results"}))
    if any(r["failure_rate"] for r in report):
        raise SystemExit(1)


asyncio.run(main())
