from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.game_types import Submission, initial_v3
from app.schemas import TurnInput
from app.story_rules import transition_v3

pytestmark = pytest.mark.unit


def payload(**params):
    return TurnInput(request_id=uuid4(), version=1, action="supplement", params=params)


def test_normalizes_and_restricts_mentions():
    p = payload(supplement_note=" 核对模板 ", mentions=["zhang", "li", "li"])
    assert p.params.mentions == ["li", "zhang"]
    assert p.params.supplement_note == "核对模板"
    for params in [
        {"mentions": ["wang"], "supplement_note": "说明"},
        {"mentions": ["sun"]},
        {"mentions": ["sun"], "supplement_note": "  "},
        {"supplement_note": "a" * 1001},
    ]:
        with pytest.raises(ValidationError):
            payload(**params)
    with pytest.raises(ValidationError):
        TurnInput(request_id=uuid4(), version=1, action="report", params={"mentions": []})


def test_old_submission_defaults_and_no_report_or_approval():
    old = Submission(event_id="old", version=1, purpose="实验", evidence=[], status="returned")
    assert old.supplement_note == "" and old.mentions == []
    state = initial_v3()
    for action in ["begin", "next"]:
        state, _ = transition_v3(state, action, "sun")
    params = {"evidence": ["quote", "purpose"], "supplement_note": "请核对", "mentions": ["zhang"]}
    result, _ = transition_v3(state, "supplement", "sun", params, "entry")
    plain, _ = transition_v3(state, "supplement", "sun", {"evidence": params["evidence"]}, "entry")
    assert result.work.submissions[-1].mentions == ["zhang"]
    assert result.work.submissions[-1].supplement_note == "请核对"
    assert not {"reported", "supported", "purchase_approved"} & result.work.facts.keys()
    assert (result.credit, result.pressure, result.heat, result.rumination) == (
        plain.credit,
        plain.pressure,
        plain.heat,
        plain.rumination,
    )
