"""Kill an isolated test API after a tool commits, then verify process recovery."""

import asyncio
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

import httpx

root = Path(__file__).resolve().parents[1]
test_database_url = os.environ.get(
    "BTL_TEST_DATABASE_URL", "postgresql+asyncpg://btl:btl@localhost:54329/btl_test"
)
if not test_database_url.rsplit("/", 1)[-1].startswith(("btl_test", "btl_upgrade_test_")):
    raise RuntimeError("Recovery drills require a dedicated test database")
env = {
    **os.environ,
    "ENVIRONMENT": "test",
    "AGENT_MODE": "mock",
    "DATABASE_URL": test_database_url,
    "STORY_V2_ENABLED": "false",
    "CHECKPOINT_URL": test_database_url.replace("postgresql+asyncpg://", "postgresql://"),
}
child_code = """
import asyncio, os
from pathlib import Path
import app.main as main

async def paused(turn, checkpointer, usage):
    await main.app.state.runtime.service.npc_operation(turn.id, 'sun', 'request_materials')
    Path(os.environ['TEST_MARKER']).write_text('committed')
    await asyncio.sleep(120)
    yield 'unreachable'
main.app.state.dependencies.reply = paused
import uvicorn
uvicorn.run(main.app, host='127.0.0.1', port=8002, log_level='error')
"""


async def ready(client, process):
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError("Test server exited")
        try:
            if (await client.get("/api/health")).status_code == 200:
                return
        except httpx.TransportError:
            pass
        await asyncio.sleep(0.1)
    raise RuntimeError("Test server did not start")


async def main():
    with tempfile.TemporaryDirectory(prefix="btl-restart-") as directory:
        marker = Path(directory) / "committed"
        process = subprocess.Popen(
            [sys.executable, "-c", child_code],
            cwd=root / "backend",
            env={**env, "TEST_MARKER": str(marker)},
            stdout=subprocess.DEVNULL,
        )
        async with httpx.AsyncClient(base_url="http://127.0.0.1:8002", timeout=15) as client:
            try:
                await ready(client, process)
                (await client.post("/api/auth/dev", json={"name": "重启验证"})).raise_for_status()
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
                request_id = str(uuid4())
                task = asyncio.create_task(
                    client.post(
                        f"/api/saves/{save['id']}/turns",
                        json={
                            "request_id": request_id,
                            "version": save["version"],
                            "action": "speak",
                            "npc": "sun",
                            "text": "请确认材料要求",
                        },
                    )
                )
                for _ in range(100):
                    if marker.exists():
                        break
                    await asyncio.sleep(0.05)
                assert marker.exists(), "Tool never committed"
                process.kill()
                process.wait()
                await asyncio.gather(task, return_exceptions=True)
                process = subprocess.Popen(
                    [
                        sys.executable,
                        "-m",
                        "uvicorn",
                        "app.main:app",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        "8002",
                        "--log-level",
                        "error",
                    ],
                    cwd=root / "backend",
                    env=env,
                    stdout=subprocess.DEVNULL,
                )
                await ready(client, process)
                recovered = (await client.get(f"/api/saves/{save['id']}")).json()
                assert "requirements" in recovered["state"]["flags"]
                turn = (await client.get(f"/api/saves/{save['id']}/turns/{request_id}")).json()
                assert turn["status"] == "failed" and turn["result"]["retryable"]
                events = (await client.get(f"/api/saves/{save['id']}/events")).json()
                assert sum(e["kind"] == "work" for e in events) == 1
                assert not any(e["kind"] == "npc" for e in events)
                report = {
                    "status": "passed",
                    "tool_survived": True,
                    "duplicate_tool_events": 0,
                    "incomplete_reply_persisted": False,
                    "session_survived": True,
                }
                (root / "artifacts").mkdir(exist_ok=True)
                (root / "artifacts/restart-test.json").write_text(json.dumps(report, indent=2))
                print(json.dumps(report))
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=15)


asyncio.run(main())
