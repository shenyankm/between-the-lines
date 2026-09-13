"""Exercise the old storage format through downgrade/upgrade in the isolated test DB."""

import json
import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.auth import digest
from app.domain import initial_state

pytestmark = pytest.mark.integration


def test_legacy_saves_payloads_events_and_sessions_survive_migration(app):
    url = os.environ["CHECKPOINT_URL"]
    assert url.endswith("/btl_test") or "/btl_upgrade_test_" in url, (
        "Migration drill only runs on the dedicated test database"
    )
    cwd = Path(__file__).resolve().parents[1]
    subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "0002"],
        cwd=cwd,
        check=True,
        capture_output=True,
    )
    user, token = str(uuid4()), "migration-test-session"
    originals = []
    try:
        with psycopg.connect(url) as conn:
            conn.execute("INSERT INTO users(id,subject,name) VALUES (%s,%s,'legacy')", (user, user))
            conn.execute(
                "INSERT INTO login_sessions(token_hash,user_id,expires_at) VALUES (%s,%s,now()+interval '1 day')",
                (digest(token), user),
            )
            for act in range(5):
                save_id, turn_id, event_id = (str(uuid4()) for _ in range(3))
                state = initial_state().model_dump()
                state.update(act=act, ending="主动离开" if act == 4 else None)
                payload = {
                    "request_id": str(uuid4()),
                    "version": 2,
                    "npc": "sun",
                    "action": "speak",
                    "text": "legacy",
                }
                conn.execute(
                    "INSERT INTO saves(id,user_id,version,state,created_at) VALUES (%s,%s,3,%s::jsonb,now())",
                    (save_id, user, json.dumps(state)),
                )
                result = {
                    "turn_id": turn_id,
                    "status": "completed",
                    "save": {"id": save_id, "version": 3, "state": state},
                    "text": "legacy",
                }
                conn.execute(
                    "INSERT INTO turns(id,save_id,user_id,request_id,payload,status,attempt,result,usage,created_at,updated_at) VALUES (%s,%s,%s,%s,%s::jsonb,'completed',1,%s::jsonb,'{}',now(),now())",
                    (
                        turn_id,
                        save_id,
                        user,
                        payload["request_id"],
                        json.dumps(payload),
                        json.dumps(result),
                    ),
                )
                event = {"kind": "npc", "npc": "sun", "text": "legacy", "act": act}
                conn.execute(
                    "INSERT INTO events(id,save_id,turn_id,operation,audience,data,created_at) VALUES (%s,%s,%s,'reply','[\"sun\"]',%s::jsonb,now())",
                    (event_id, save_id, turn_id, json.dumps(event)),
                )
                originals.append((save_id, state, payload, event))
    finally:
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=cwd,
            check=True,
            capture_output=True,
        )
    with TestClient(app) as client:
        client.cookies.set("btl_session", token)
        for save_id, state, payload, event in originals:
            view = client.get(f"/api/saves/{save_id}/play-state").json()
            assert view["save"]["state"] == state
            assert view["events"][0]["text"] == event["text"]
            old = client.get(f"/api/saves/{save_id}/turns/{payload['request_id']}").json()
            assert old["usage"]["billing_complete"] is False
            assert old["result"]["retryable"] is False
        # Replay the exact old payload, even though its version predates the save.
        save_id, _, payload, _ = originals[0]
        assert client.post(f"/api/saves/{save_id}/turns", json=payload).status_code == 200
    with psycopg.connect(url) as conn:
        for save_id, state, payload, event in originals:
            assert conn.execute(
                "SELECT state,state_schema_version FROM saves WHERE id=%s", (save_id,)
            ).fetchone() == (state, 1)
            assert (
                conn.execute("SELECT payload FROM turns WHERE save_id=%s", (save_id,)).fetchone()[0]
                == payload
            )
            assert (
                conn.execute("SELECT data FROM events WHERE save_id=%s", (save_id,)).fetchone()[0]
                == event
            )
