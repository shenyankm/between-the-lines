from uuid import uuid4

import pytest
from sqlalchemy import delete

from app.config import get_settings
from app.db import ZhihuContent
from app.storage import Database
from app.zhihu_import import normalize, persist


def sample(content_id="test"):
    return {
        "ContentID": content_id,
        "ContentType": "Answer",
        "Title": "沟通边界",
        "ContentText": "这是服务提供的摘要。",
        "Url": "https://www.zhihu.com/question/1/answer/2?utm_source=test",
        "AuthorName": "公开作者",
        "VoteUpCount": 12,
        "CommentCount": 2,
    }


@pytest.mark.unit
def test_reject_untrusted_links_and_incomplete_content():
    for url in [
        "javascript:alert(1)",
        "https://zhihu.com.evil.example/",
        "https://secret@zhihu.com/",
        "http://www.zhihu.com/",
        "https://www.zhihu.com:9000/",
    ]:
        assert normalize({**sample(), "Url": url}, "边界") is None
    assert normalize({**sample(), "ContentText": ""}, "边界") is None
    row = normalize(sample(), "边界")
    assert row["source_url"].endswith("?utm_source=test")
    assert row["author_name"] == "公开作者"


@pytest.mark.asyncio
@pytest.mark.integration
async def test_reimport_deduplicates_content_and_keeps_topics():
    database = Database(get_settings())
    Session = database.sessions
    content_id = f"ci-{uuid4()}"
    first = normalize(sample(content_id), "边界")
    second = normalize({**sample(content_id), "VoteUpCount": 20}, "职场")
    try:
        await persist([first, first, second, second], Session)
        async with Session() as db:
            row = await db.get(ZhihuContent, ("answer", content_id))
            assert row.topics == ["边界", "职场"]
            assert row.vote_count == 20
            assert row.summary == first["summary"]
    finally:
        async with Session.begin() as db:
            await db.execute(delete(ZhihuContent).where(ZhihuContent.content_id == content_id))
        await database.close()
