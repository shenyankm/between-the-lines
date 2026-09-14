import pytest
from pydantic import ValidationError

from app.game_types import GameStateV3, PurchaseForm, initial_v3
from app.schemas import ActionParameters
from app.story_rules import transition_v3

pytestmark = pytest.mark.unit

FORM = {
    "applicant": "周菱菱",
    "department": "研发工位",
    "material_category": "电子元器件",
    "quantity": 100,
    "budget": "研发项目经费",
    "expected_arrival": "2026-09-20",
    "notes": "",
}


def test_purchase_form_roundtrip_and_revision_preserve_history():
    state = initial_v3().model_copy(update={"act": 2})
    submitted, _ = transition_v3(
        state,
        "submit_purchase",
        params={
            "purpose": "用于新产品试制与功能验证。",
            "purchase_form": FORM,
        },
    )
    restored = GameStateV3.model_validate_json(submitted.model_dump_json())
    assert restored.work.submissions[0].purchase_form.quantity == 100
    revised, _ = transition_v3(
        restored,
        "supplement",
        params={
            "purpose": "第二批试制",
            "purchase_form": {**FORM, "quantity": 200, "notes": "分批到货"},
            "evidence": ["quote", "purpose"],
        },
    )
    assert revised.work.submissions[0].purchase_form.quantity == 100
    assert revised.work.submissions[1].purchase_form.quantity == 200
    assert revised.work.submissions[1].purchase_form.notes == "分批到货"
    assert revised.work.submissions[1].purpose == "第二批试制"
    assert restored.work.submissions[0].purpose == "用于新产品试制与功能验证。"


def test_legacy_submission_without_form_still_loads_and_resubmits():
    state = initial_v3().model_copy(update={"act": 2})
    submitted, _ = transition_v3(state, "submit_purchase")
    data = submitted.model_dump(mode="json")
    del data["work"]["submissions"][0]["purchase_form"]
    restored = GameStateV3.model_validate(data)
    revised, _ = transition_v3(restored, "supplement", params={"evidence": ["quote", "purpose"]})
    assert revised.work.submissions[-1].purchase_form is None
    assert revised.work.submissions[-1].purpose == restored.work.submissions[-1].purpose


@pytest.mark.parametrize(
    "patch",
    [
        {"quantity": 0},
        {"quantity": 1.5},
        {"quantity": 1000001},
        {"expected_arrival": "2026-02-30"},
        {"applicant": "   "},
        {"notes": "x" * 301},
    ],
)
def test_invalid_purchase_form_rejected(patch):
    with pytest.raises(ValidationError):
        ActionParameters(purchase_form={**FORM, **patch})


def test_form_accepts_date_and_normalizes_text():
    form = PurchaseForm.model_validate({**FORM, "department": "  研发工位  "})
    assert form.department == "研发工位"
    assert form.expected_arrival.isoformat() == "2026-09-20"
