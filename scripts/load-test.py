"""Exercise 10/20/30 parallel player turns against an explicitly MOCK server.

Every knob is an environment variable so the same script serves a developer's
host and the CI compose stack. In CI it is piped into the api container's own
interpreter (`docker compose exec -T api python - < scripts/load-test.py`) so it
runs against the locked dependency set rather than a freshly installed one; that
mode has no __file__ and no writable checkout, hence the guarded default below.

    BTL_LOAD_TEST_BASE_URL          default http://127.0.0.1:8000
    BTL_LOAD_TEST_LEVELS            default 10,20,30
    BTL_LOAD_TEST_MAX_P95_SECONDS   default 30
    BTL_LOAD_TEST_REPORT            default <repo>/artifacts/load-test.json
"""

import asyncio
import json
import os
import statistics
import time
from pathlib import Path
from uuid import uuid4

import httpx

BASE_URL = os.environ.get("BTL_LOAD_TEST_BASE_URL", "http://127.0.0.1:8000")
LEVELS = [int(level) for level in os.environ.get("BTL_LOAD_TEST_LEVELS", "10,20,30").split(",")]
# A generous ceiling, not a tuned one. Shared CI runners vary several-fold in
# throughput, so a tight budget would flake and a flaky gate gets ignored. This
# catches a turn that stops finishing -- deadlock, accidental serialization, an
# outbound call that should not exist in mock mode -- not a 20% drift; the
# artifact carries exact percentiles for reviewing the trend by hand.
MAX_P95_SECONDS = float(os.environ.get("BTL_LOAD_TEST_MAX_P95_SECONDS", "30"))


def _default_report() -> Path:
    root = Path(__file__).resolve().parents[1] if "__file__" in globals() else Path.cwd()
    return root / "artifacts/load-test.json"


REPORT = Path(os.environ.get("BTL_LOAD_TEST_REPORT") or _default_report())


async def play(concurrency):
    clients = [httpx.AsyncClient(base_url=BASE_URL, timeout=90) for _ in range(concurrency)]

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
                return {"seconds": elapsed, "status": response.status_code}
            turn = (await client.get(f"/api/saves/{save['id']}/turns/{request_id}")).json()
            return {
                "seconds": elapsed,
                "status": turn["status"],
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
            "results": results,
        }
    finally:
        await asyncio.gather(*(c.aclose() for c in clients))


async def main():
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        config = (await client.get("/api/config")).json()
    if config.get("agent_mode") != "mock" or not config.get("dev_login"):
        raise SystemExit(f"Refusing: {BASE_URL} is not a mock server with development login")
    report = [await play(count) for count in LEVELS]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    for row in report:
        print(json.dumps({k: v for k, v in row.items() if k != "results"}))
    failed = [r["concurrency"] for r in report if r["failure_rate"]]
    if failed:
        raise SystemExit(f"load test: turns failed at concurrency {failed}")
    slow = [r["concurrency"] for r in report if r["p95_seconds"] > MAX_P95_SECONDS]
    if slow:
        raise SystemExit(
            f"load test: p95 exceeded {MAX_P95_SECONDS}s at concurrency {slow}; "
            "see the report for percentiles"
        )


asyncio.run(main())
