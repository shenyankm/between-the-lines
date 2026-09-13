"""Product persistence helpers. No model call runs inside these transactions."""

from datetime import timedelta
from typing import Any, cast

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from .content import content_hash
from .db import (
    AIJob,
    AISpend,
    BranchRequest,
    Event,
    LoginSession,
    OAuthBinding,
    ProductEvent,
    RateBucket,
    Save,
    SaveSnapshot,
    Turn,
    User,
    ZhihuContent,
    new_id,
    utcnow,
)
from .errors import ApiError
from .schemas import BranchInput, TurnInput


async def rate_limit(db: AsyncSession, key: str, limit: int, seconds: int) -> None:
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": key})
    bucket = await db.get(RateBucket, key)
    now = utcnow()
    if not bucket:
        bucket = RateBucket(key=key, count=0, expires_at=now + timedelta(seconds=seconds))
        db.add(bucket)
    elif bucket.expires_at <= now:
        bucket.count = 0
        bucket.expires_at = now + timedelta(seconds=seconds)
    if bucket.count >= limit:
        raise ApiError(
            429,
            "concurrency_budget_exhausted",
            headers={"Retry-After": str(max(1, int((bucket.expires_at - now).total_seconds())))},
        )
    bucket.count += 1


async def check_save_capacity(db: AsyncSession, user: User, limit: int) -> None:
    count = (
        await db.scalar(
            select(func.count())
            .select_from(Save)
            .where(
                Save.user_id == user.id,
                Save.story_version == 3,
                Save.state["content_revision"].as_integer() == 2,
                *(
                    []
                    if user.identity_type == "guest"
                    else [Save.archived_at.is_(None), Save.deleted_at.is_(None)]
                ),
            )
        )
        or 0
    )
    if count >= (1 if user.identity_type == "guest" else limit):
        raise ApiError(
            422,
            "rule_violation",
            "访客只能保留一个试玩存档。"
            if user.identity_type == "guest"
            else "已有二十个未归档存档，请先归档。",
        )


async def validate_reference(db: AsyncSession, save: Save, body: TurnInput) -> None:
    job = await db.get(AIJob, str(body.discussion_id))
    if (
        body.action != "speak"
        or not job
        or job.save_id != save.id
        or job.kind != "discussion"
        or job.status != "completed"
        or job.payload.get("act") != save.state["act"]
    ):
        raise ApiError(422, "rule_violation", "观点卡不属于当前存档或幕次。")
    if body.perspective_id not in {card["id"] for card in (job.result or {}).get("cards", [])}:
        raise ApiError(422, "rule_violation", "未知的观点卡引用。")

    if job.payload.get("live_sources"):
        # Server-frozen public search sources cannot be supplied or rewritten by players.
        return
    for source in job.payload.get("sources", []):
        kind, identifier = source["id"].split(":", 1)
        row = await db.get(ZhihuContent, (kind, identifier))
        if not row or row.review_status != "approved" or content_hash(row) != source["hash"]:
            raise ApiError(
                422, "rule_violation", "观点资料已变化或撤销审核，请重新读取本幕观点卡。"
            )


async def branch_save(
    db: AsyncSession, user: User, source: Save, body: BranchInput, limit: int
) -> Save:
    prior = await db.get(BranchRequest, str(body.request_id))
    if prior:
        if prior.user_id != user.id or prior.snapshot_id != str(body.snapshot_id):
            raise ApiError(409, "request_id_reused")
        result = await db.get(Save, prior.save_id)
        if result is None or result.deleted_at:
            raise ApiError(404, "save_not_found")
        return result
    point = await db.get(SaveSnapshot, str(body.snapshot_id))
    if (
        not point
        or point.save_id != source.id
        or source.story_version != 3
        or source.state.get("content_revision", 1) < 2
    ):
        raise ApiError(422, "rule_violation", "这个节点无法可靠还原，请新建故事。")
    await check_save_capacity(db, user, limit)
    import copy

    state = copy.deepcopy(point.state)
    event_ids = {event["id"]: new_id() for event in point.history}

    def remap(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key == "event_id" and item in event_ids:
                    value[key] = event_ids[item]
                else:
                    remap(item)
        elif isinstance(value, list):
            for item in value:
                remap(item)

    remap(state)
    save = Save(
        user_id=user.id,
        state=state,
        state_schema_version=3,
        story_version=3,
        parent_save_id=source.id,
        checkpoint_namespace=new_id(),
    )
    db.add(save)
    await db.flush()
    base = utcnow()
    groups: dict[str, str] = {}
    for index, event in enumerate(point.history):
        data = dict(event["data"])
        if event.get("turn_key"):
            data["history_group"] = groups.setdefault(event["turn_key"], new_id())
        db.add(
            Event(
                save_id=save.id,
                turn_id=None,
                id=event_ids[event["id"]],
                source_event_id=event["id"],
                operation=event["operation"],
                audience=event["audience"],
                data=data,
                created_at=base + timedelta(microseconds=index),
            )
        )
    db.add(
        BranchRequest(
            id=str(body.request_id), user_id=user.id, snapshot_id=point.id, save_id=save.id
        )
    )
    db.add(ProductEvent(user_id=user.id, name="replay_created", data={"node": point.node}))
    return save


async def process_bindings(sessions: Any) -> None:
    async with sessions() as db:
        ids = list(
            (
                await db.scalars(
                    select(OAuthBinding.state_hash).where(OAuthBinding.status == "waiting")
                )
            ).all()
        )
    for key in ids:
        async with sessions.begin() as db:
            pending = await db.get(OAuthBinding, key)
            if not pending or not pending.member_id:
                continue
            for identity in sorted({pending.guest_id, pending.member_id}):
                await db.scalar(select(User).where(User.id == identity).with_for_update())
            await db.refresh(pending)
            if pending.status != "waiting":
                continue
            running = await db.scalar(
                select(Turn.id)
                .where(
                    Turn.user_id.in_([pending.guest_id, pending.member_id]),
                    Turn.status == "running",
                )
                .limit(1)
            )
            jobs = await db.scalar(
                select(AIJob.id)
                .where(
                    AIJob.user_id.in_([pending.guest_id, pending.member_id]),
                    AIJob.status == "running",
                )
                .limit(1)
            )
            if running or jobs:
                continue
            guest = cast(User, await db.get(User, pending.guest_id))
            if guest.merged_into:
                pending.status = "completed"
                continue
            for model in (Save, Turn, AIJob, AISpend):
                await db.execute(
                    update(model).where(model.user_id == guest.id).values(user_id=pending.member_id)
                )
            await db.execute(delete(LoginSession).where(LoginSession.user_id == guest.id))
            guest.merged_into = pending.member_id
            pending.status = "completed"
            db.add(ProductEvent(user_id=pending.member_id, name="binding_completed", data={}))


async def record_product_event(sessions: Any, user_id: str, name: str, key: str) -> None:
    """Once per opaque business key; never stores dialogue in analytics."""
    async with sessions.begin() as db:
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"event:{user_id}:{name}:{key}"},
        )
        if not await db.scalar(
            select(ProductEvent.id)
            .where(
                ProductEvent.user_id == user_id,
                ProductEvent.name == name,
                ProductEvent.data["key"].astext == key,
            )
            .limit(1)
        ):
            db.add(ProductEvent(user_id=user_id, name=name, data={"key": key}))
