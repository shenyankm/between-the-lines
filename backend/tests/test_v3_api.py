import json
from uuid import uuid4

import pytest
from starlette.testclient import TestClient

from app.story_rules import CATALOG, MAJOR

pytestmark = pytest.mark.integration


def result(response):
    assert response.status_code == 200, response.text
    done = next(f for f in response.text.split("\n\n") if f.startswith("event: done"))
    data = json.loads(done.split("data: ", 1)[1])
    assert data["status"] == "completed", data
    return data


def login(client):
    response = client.post("/api/auth/dev", json={"name": "v3 verifier"})
    assert response.status_code == 200, response.text
    r = client.post("/api/saves", json={"story_version": 3})
    assert r.status_code == 200, r.text
    return r.json()


def step(client, save, action):
    npc = CATALOG[action][2] or "sun"
    extra = {}
    if action in MAJOR:
        proposed = result(
            client.post(
                f"/api/saves/{save['id']}/turns",
                json={
                    "request_id": str(uuid4()),
                    "version": save["version"],
                    "npc": npc,
                    "action": "propose",
                    "proposed_action": action,
                },
            )
        )
        save = proposed["save"]
        extra["proposal_id"] = proposed["proposal"]["id"]
    body = {
        "request_id": str(uuid4()),
        "version": save["version"],
        "action": action,
        "npc": npc,
        **extra,
        **(
            {"params": {"evidence": ["quote", "purpose", "urgency"]}}
            if action == "supplement"
            else {"params": {"boundary_response": "decline"}}
            if action == "follow_up"
            else {}
        ),
    }
    value = result(client.post(f"/api/saves/{save['id']}/turns", json=body))
    assert result(client.post(f"/api/saves/{save['id']}/turns", json=body)) == value
    return value["save"]


BASE = [
    "begin",
    "next",
    "supplement",
    "approve_purchase",
    "next",
    "deliver",
    "clarify",
    "review_clarification",
]


@pytest.mark.parametrize(
    "path,ending",
    [
        (["begin", "draft_exit", "submit_exit"], "active_exit"),
        (["begin", "next", "next", "project_review", "close_story"], "career_cost"),
        (
            [
                *BASE,
                "dispute_return",
                "confirm_responsibility",
                "change_rules",
                "project_review",
                "apply_rules",
                "close_story",
            ],
            "rules_rewritten",
        ),
        (
            [
                *BASE,
                "repair_friendship",
                "acknowledge_harm",
                "complete_remedy",
                "project_review",
                "follow_up",
                "close_story",
            ],
            "limited_repair",
        ),
        (
            [*BASE, "cut_ties", "project_review", "follow_up", "close_story"],
            "professional_boundary",
        ),
        (["begin", "next", "next", "close_story"], "unresolved"),
    ],
)
def test_routes(app, path, ending):
    with TestClient(app) as client:
        save = login(client)
        assert save["read_only"] is False
        for action in path:
            save = step(client, save, action)
        assert save["state"]["outcome"]["id"] == ending
        history = client.get(f"/api/saves/{save['id']}/events?limit=100").json()
        ids = {e["id"] for e in history}
        for fact in save["state"]["work"]["facts"].values():
            assert fact["event_id"] in ids


def test_reading_branch_and_old_create(app):
    with TestClient(app) as client:
        save = login(client)
        assert client.post("/api/saves", json={"story_version": 2}).status_code == 422
        assert (
            client.post(
                f"/api/saves/{save['id']}/reading", json={"key": "prologue", "position": 3}
            ).status_code
            == 200
        )
        assert client.get(f"/api/saves/{save['id']}").json()["version"] == 0
        save = step(client, save, "begin")
        save = step(client, save, "next")
        points = client.get(f"/api/saves/{save['id']}/snapshots").json()
        branch = client.post(
            f"/api/saves/{save['id']}/branches",
            json={"request_id": str(uuid4()), "snapshot_id": points[0]["id"]},
        )
        assert branch.status_code == 200, branch.text
        b = branch.json()
        assert b["id"] != save["id"]
        events = client.get(f"/api/saves/{b['id']}/events").json()
        assert b["state"]["work"]["facts"]["started"]["event_id"] in {e["id"] for e in events}


def test_legacy_readonly_and_quota(app):
    import os

    import psycopg

    with TestClient(app) as client:
        save = login(client)
        with psycopg.connect(os.environ["CHECKPOINT_URL"]) as conn:
            conn.execute(
                "UPDATE saves SET story_version=1,state_schema_version=1,state=state - 'story_version' WHERE id=%s",
                (save["id"],),
            )
        read = client.get(f"/api/saves/{save['id']}")
        assert read.status_code == 200 and read.json()["read_only"]
        assert (
            client.post(
                f"/api/saves/{save['id']}/turns",
                json={"request_id": str(uuid4()), "version": 0, "action": "begin"},
            ).status_code
            == 422
        )
        assert (
            client.post(
                f"/api/saves/{save['id']}/jobs",
                json={"request_id": str(uuid4()), "version": 0, "kind": "discussion"},
            ).status_code
            == 422
        )
        assert client.post("/api/saves", json={}).status_code == 200


def test_stale_confirmation_and_private_channels(app):
    import os

    import psycopg

    with TestClient(app) as client:
        save = step(client, login(client), "begin")
        proposal = result(
            client.post(
                f"/api/saves/{save['id']}/turns",
                json={
                    "request_id": str(uuid4()),
                    "version": save["version"],
                    "action": "propose",
                    "proposed_action": "public_confront",
                },
            )
        )
        save = step(client, proposal["save"], "next")
        stale = client.post(
            f"/api/saves/{save['id']}/turns",
            json={
                "request_id": str(uuid4()),
                "version": save["version"],
                "action": "public_confront",
                "proposal_id": proposal["proposal"]["id"],
            },
        )
        assert stale.status_code == 409
        save = step(client, save, "partner_undecided")
        with psycopg.connect(os.environ["CHECKPOINT_URL"]) as conn:
            rows = conn.execute(
                "SELECT audience FROM events WHERE save_id=%s AND data->>'action'='partner_undecided'",
                (save["id"],),
            ).fetchall()
            assert rows == [([],)]


def test_original_v3_revision_readonly_preserves_history(app):
    import os

    import psycopg

    with TestClient(app) as client:
        save = step(client, login(client), "begin")
        history = client.get(f"/api/saves/{save['id']}/events").json()
        points = client.get(f"/api/saves/{save['id']}/snapshots").json()
        with psycopg.connect(os.environ["CHECKPOINT_URL"]) as conn:
            conn.execute(
                "UPDATE saves SET state=state - 'content_revision' WHERE id=%s", (save["id"],)
            )
        read = client.get(f"/api/saves/{save['id']}/play-state")
        assert read.status_code == 200, read.text
        assert read.json()["save"]["read_only"]
        assert read.json()["available_actions"] == []
        assert client.get(f"/api/saves/{save['id']}/events").json() == history
        assert (
            client.post(
                f"/api/saves/{save['id']}/turns",
                json={"request_id": str(uuid4()), "version": save["version"], "action": "next"},
            ).status_code
            == 422
        )
        assert (
            client.post(
                f"/api/saves/{save['id']}/jobs",
                json={"request_id": str(uuid4()), "version": save["version"], "kind": "discussion"},
            ).status_code
            == 422
        )
        assert (
            client.post(
                f"/api/saves/{save['id']}/branches",
                json={"request_id": str(uuid4()), "snapshot_id": points[0]["id"]},
            ).status_code
            == 422
        )
        old_story = client.get("/api/story?version=3&revision=1").json()
        assert old_story["scenes"]["act_1"][0]["id"] == "farewell"


def test_ending_job_includes_confirmed_facts_without_inventing_player_quotes(app):
    import os
    import time

    import psycopg

    with TestClient(app) as client:
        save = login(client)
        for action in [
            *BASE,
            "repair_friendship",
            "acknowledge_harm",
            "complete_remedy",
            "project_review",
            "follow_up",
            "close_story",
        ]:
            save = step(client, save, action)
        request = {"request_id": str(uuid4()), "version": save["version"], "kind": "ending"}
        response = client.post(f"/api/saves/{save['id']}/jobs", json=request)
        assert response.status_code == 200, response.text
        job = response.json()
        for _ in range(100):
            job = next(
                row
                for row in client.get(f"/api/saves/{save['id']}/jobs").json()
                if row["id"] == job["id"]
            )
            if job["status"] != "running":
                break
            time.sleep(0.01)
        assert job["status"] == "completed", job
        assert job["result"]["outcome"] == save["state"]["outcome"]
        assert job["result"]["interactions"]
        with psycopg.connect(os.environ["CHECKPOINT_URL"]) as conn:
            payload = conn.execute(
                "SELECT payload FROM ai_jobs WHERE id=%s", (job["id"],)
            ).fetchone()[0]
        assert payload["confirmed_facts"]["work"] == save["state"]["work"]["facts"]
        assert "friendship_offer" in save["state"]["relationship"]["facts"]
        assert "friendship_offer" not in payload["confirmed_facts"]["relationship"]
        assert "friendship" in payload["confirmed_facts"]["relationship"]
        assert payload["relationship_intention"] == "friendship"
        assert len(payload["facts"]) <= 3
        assert all(
            fact["actual_expression"] == "" and fact["event_summary"] for fact in payload["facts"]
        )
        replay = client.post(f"/api/saves/{save['id']}/jobs", json=request)
        assert replay.status_code == 200 and replay.json()["id"] == job["id"]


def test_relationship_evidence_is_readable_only_with_its_own_save(app):
    with TestClient(app) as client:
        save = step(client, login(client), "begin")
        save = step(client, save, "boundary")
        sun = next(row for row in save["relationships"] if row["id"] == "sun")
        event_id = sun["evidence_event_ids"][0]
        response = client.get(f"/api/saves/{save['id']}/events/{event_id}")
        assert response.status_code == 200 and response.json()["id"] == event_id
        other = client.post("/api/saves", json={}).json()
        assert client.get(f"/api/saves/{other['id']}/events/{event_id}").status_code == 404
        client.post("/api/auth/dev", json={"name": "another event reader"})
        assert client.get(f"/api/saves/{save['id']}/events/{event_id}").status_code == 404


def test_natural_invitation_request_uses_same_action_and_does_not_attend(app):
    with TestClient(app) as client:
        save = step(client, login(client), "begin")
        reply = result(
            client.post(
                f"/api/saves/{save['id']}/turns",
                json={
                    "request_id": str(uuid4()),
                    "version": save["version"],
                    "npc": "sun",
                    "action": "speak",
                    "text": "欢送会的名单，可以把我加上吗？",
                },
            )
        )
        facts = reply["save"]["state"]["work"]["facts"]
        assert "farewell_requested" in facts
        assert "farewell_attended" not in facts


def test_reflection_without_player_actions_keeps_facts_and_request_identity(app):
    with TestClient(app) as client:
        save = login(client)
        for action in ["begin", "next", "next", "close_story"]:
            save = step(client, save, action)
        body = {"kind": "reflection", "version": save["version"], "request_id": str(uuid4())}
        response = client.post(f"/api/saves/{save['id']}/jobs", json=body)
        assert response.status_code == 200
        job = response.json()
        assert job["status"] == "completed"
        assert "仅保留事实回顾" in job["result"]["label"]
        assert job["result"]["nodes"]
        assert all(
            "alternative" not in n and "role_context" not in n for n in job["result"]["nodes"]
        )
        assert client.post(f"/api/saves/{save['id']}/jobs", json=body).json() == job
