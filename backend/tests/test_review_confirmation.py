from uuid import uuid4

import pytest
from starlette.testclient import TestClient
from tests.test_v3_api import login, result, step

from app.actions import available_actions
from app.game_types import Fact, initial_v3
from app.story_rules import transition_v3


@pytest.mark.unit
@pytest.mark.parametrize("fact", [None, "delivered", "extension"])
def test_review_forecasts_exactly_the_committed_loss(fact):
    state = initial_v3()
    state.act = 3
    if fact:
        state.work.facts[fact] = Fact(event_id="saved", detail=fact)
    option = next(a for a in available_actions(state) if a.action == "project_review")
    assert option.requires_confirmation is (fact is None)
    after, _ = transition_v3(state, "project_review", "zhang")
    assert ("career_loss" in after.work.facts) is (fact is None)
    assert after.credit - state.credit == (-20 if fact is None else 0)
    assert not state.work.facts.get("project_reviewed")


def test_risky_review_requires_current_confirmation_and_cancel_changes_no_facts(app):
    with TestClient(app) as client:
        save = step(client, step(client, step(client, login(client), "begin"), "next"), "next")
        url = f"/api/saves/{save['id']}/turns"

        def send(action, **extra):
            return client.post(
                url,
                json={
                    "request_id": str(uuid4()),
                    "version": save["version"],
                    "npc": "zhang",
                    "action": action,
                    **extra,
                },
            )

        assert send("project_review").status_code == 409
        old = save["state"]
        proposed = result(send("propose", proposed_action="project_review"))
        save = proposed["save"]
        assert "-20" in proposed["proposal"]["effect"]
        save = result(send("cancel_proposal"))["save"]
        assert save["state"] == old
        assert send("project_review", proposal_id=proposed["proposal"]["id"]).status_code == 409
        save = step(client, save, "project_review")  # Includes idempotent repeat.
        assert save["state"]["credit"] == old["credit"] - 20


@pytest.mark.unit
def test_effects_capture_facts_and_actual_clamped_deltas_without_mutating_history():
    from app.actions import effects

    before = initial_v3()
    before.act = 1
    before.credit = 99
    after, text = transition_v3(before, "boundary", "sun", event_id="boundary-event")
    receipt = effects(before, after, text)[0]
    assert receipt["changes"]["credit"] == 1
    assert any("代替决定" in str(fact["after"]) for fact in receipt["facts"])
    assert not before.relationship.facts
    assert effects(after, after, text) == []
