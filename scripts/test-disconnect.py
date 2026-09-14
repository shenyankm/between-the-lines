"""Real TCP subscriber disconnect: accepted execution survives and commits once."""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import httpx

root = Path(__file__).resolve().parents[1]
test_database_url = os.environ.get(
    "BTL_TEST_DATABASE_URL", "postgresql+asyncpg://btl:btl@localhost:54329/btl_test"
)
if not test_database_url.rsplit("/", 1)[-1].startswith(("btl_test", "btl_upgrade_test_")):
    raise RuntimeError("Recovery drills require a dedicated test database")
child = """
import asyncio
import uvicorn
from app.main import app
async def reply(turn, checkpointer):
    await app.state.runtime.service.npc_operation(turn.id, 'sun', 'request_materials')
    await asyncio.sleep(0.4)
    yield '材料要求已记录。'
app.state.dependencies.reply = reply
uvicorn.run(app, host='127.0.0.1', port=8003, log_level='error')
"""


async def main():
    process = subprocess.Popen(
        [sys.executable, "-c", child],
        cwd=root / "backend",
        env={
            **os.environ,
            "ENVIRONMENT": "test",
            "AGENT_MODE": "mock",
            "DATABASE_URL": test_database_url,
            "STORY_V2_ENABLED": "false",
            "CHECKPOINT_URL": test_database_url.replace("postgresql+asyncpg://", "postgresql://"),
        },
        stdout=subprocess.DEVNULL,
    )
    try:
        async with httpx.AsyncClient(base_url="http://127.0.0.1:8003", timeout=10) as client:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError("Isolated server exited")
                try:
                    if (await client.get("/api/health")).status_code == 200:
                        break
                except httpx.TransportError:
                    pass
                await asyncio.sleep(0.1)
            (await client.post("/api/auth/dev", json={})).raise_for_status()
            save = (await client.post("/api/saves", json={})).json()
            for action in ("begin", "boundary", "next"):
                (
                    await client.post(
                        f"/api/saves/{save['id']}/turns",
                        json={
                            "request_id": str(uuid4()),
                            "version": save["version"],
                            "action": action,
                        },
                    )
                ).raise_for_status()
                save = (await client.get(f"/api/saves/{save['id']}")).json()
            payload = {
                "request_id": str(uuid4()),
                "version": save["version"],
                "action": "speak",
                "text": "请明确材料要求",
            }
            async with client.stream(
                "POST", f"/api/saves/{save['id']}/turns", json=payload
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("event: status"):
                        break
            # Context exit closes the actual socket while the model is still delayed.
            for _ in range(100):
                turn = (
                    await client.get(f"/api/saves/{save['id']}/turns/{payload['request_id']}")
                ).json()
                if turn["status"] != "running":
                    break
                await asyncio.sleep(0.05)
            assert turn["status"] == "completed", turn
            replay = await client.post(f"/api/saves/{save['id']}/turns", json=payload)
            assert replay.status_code == 200
            view = (await client.get(f"/api/saves/{save['id']}/play-state")).json()
            assert sum(e["kind"] == "work" for e in view["events"]) == 1
            assert sum(e["kind"] == "npc" for e in view["events"]) == 1
            assert view["active_turn"] is None
            report = {
                "status": "passed",
                "tcp_disconnect_survived": True,
                "duplicate_tools": 0,
                "duplicate_replies": 0,
            }
            (root / "artifacts").mkdir(exist_ok=True)
            (root / "artifacts/disconnect-test.json").write_text(json.dumps(report, indent=2))
            print(json.dumps(report))
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


asyncio.run(main())
