import pytest

from app.discussion_mock import discussion_mock

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("act", range(5))
def test_mock_has_three_distinct_selectable_views_and_explicit_provenance(act):
    result = discussion_mock(act)
    assert result["mock"] is True
    assert "非真实知乎检索" in result["label"]
    assert len(result["cards"]) == 3
    assert len({card["view"] for card in result["cards"]}) == 3
    assert len({card["id"] for card in result["cards"]}) == 3
    assert all(card["expression"] and card["sources"] == [] for card in result["cards"])
