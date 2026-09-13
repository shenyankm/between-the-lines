import httpx
import pytest

from app.jobs import JobRunner
from app.zhihu_search import search

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_search_bounds_and_source_validation():
    def response(request):
        assert request.url.params["Count"] == "10"
        assert request.url.params["Query"] == "职场边界"
        items = [
            {
                "ContentID": str(i),
                "ContentType": "answer",
                "Title": "公开问题",
                "ContentText": "公开观点",
                "Url": f"https://www.zhihu.com/question/1/answer/{i}",
            }
            for i in range(12)
        ]
        items[0]["Url"] = "https://evil.example/leak"
        return httpx.Response(200, json={"Code": 0, "Data": {"Items": items}})

    async with httpx.AsyncClient(
        base_url="https://developer.zhihu.com", transport=httpx.MockTransport(response)
    ) as client:
        sources = await search(client, "test", "职场边界", 99)
    assert len(sources) == 6
    assert all(s["url"].startswith("https://www.zhihu.com/") for s in sources)


def test_artifact_rejects_invented_source():
    runner = object.__new__(JobRunner)
    with pytest.raises(KeyError):
        runner.validate(
            "discussion",
            {"sources": []},
            {
                "cards": [
                    {
                        "view": "a",
                        "situation": "b",
                        "expression": "c",
                        "possible_cost": "d",
                        "source_ids": ["invented"],
                    }
                ]
            },
        )


def test_ending_fixed_outcome():
    runner = object.__new__(JobRunner)
    outcome = {"id": "unresolved", "title": "尚未破局"}
    assert (
        runner.validate("ending", {"outcome": outcome}, {"text": "你保留了自己的决定。"})["outcome"]
        == outcome
    )
