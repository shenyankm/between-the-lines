from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    subject: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    identity_type: Mapped[str] = mapped_column(
        String(16), default="member", server_default="member"
    )
    guest_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    merged_into: Mapped[str | None] = mapped_column(String(36))


class LoginSession(Base):
    __tablename__ = "login_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Save(Base):
    __tablename__ = "saves"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=0)
    reading: Mapped[dict[str, int]] = mapped_column(JSONB, default=dict, server_default="{}")
    state_schema_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    state: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    story_id: Mapped[str] = mapped_column(
        String(50), default="workplace-s1", server_default="workplace-s1"
    )
    story_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    last_played_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, server_default=text("now()")
    )
    checkpoint_namespace: Mapped[str] = mapped_column(
        String(150), default=new_id, server_default=""
    )
    parent_save_id: Mapped[str | None] = mapped_column(String(36))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Turn(Base):
    __tablename__ = "turns"
    __table_args__ = (
        UniqueConstraint("save_id", "request_id"),
        CheckConstraint("status IN ('running', 'completed', 'failed')", name="ck_turns_status"),
        Index(
            "uq_turns_running_save",
            "save_id",
            unique=True,
            postgresql_where=text("status = 'running'"),
        ),
        Index("ix_turns_user_created", "user_id", "created_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="running")
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    elapsed_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("turn_id", "operation"),
        Index("ix_events_save_order", "save_id", "created_at", "id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    turn_id: Mapped[str | None] = mapped_column(
        ForeignKey("turns.id", ondelete="CASCADE"), nullable=True
    )
    source_event_id: Mapped[str | None] = mapped_column(String(36))
    operation: Mapped[str] = mapped_column(String(100))
    audience: Mapped[list[str]] = mapped_column(JSONB)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ZhihuContent(Base):
    """Public reference material, separate from player accounts and NPC memory."""

    __tablename__ = "zhihu_contents"
    content_type: Mapped[str] = mapped_column(String(50), primary_key=True)
    content_id: Mapped[str] = mapped_column(String(255), primary_key=True)
    title: Mapped[str] = mapped_column(Text)
    summary: Mapped[str] = mapped_column(Text)
    source_url: Mapped[str] = mapped_column(Text)
    author_name: Mapped[str] = mapped_column(Text)
    vote_count: Mapped[int] = mapped_column(Integer)
    comment_count: Mapped[int] = mapped_column(Integer)
    topics: Mapped[list[str]] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    review_status: Mapped[str] = mapped_column(
        String(16), default="candidate", server_default="candidate"
    )
    content_hash: Mapped[str] = mapped_column(String(64), default="", server_default="")
    review_note: Mapped[str] = mapped_column(Text, default="", server_default="")


class Proposal(Base):
    __tablename__ = "action_proposals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    turn_id: Mapped[str] = mapped_column(ForeignKey("turns.id", ondelete="CASCADE"))
    action: Mapped[str] = mapped_column(String(40))
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    __table_args__ = (
        Index(
            "uq_proposal_pending",
            "save_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
        ),
    )


class SaveSnapshot(Base):
    __tablename__ = "save_snapshots"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    node: Mapped[str] = mapped_column(String(80))
    state: Mapped[dict[str, Any]] = mapped_column(JSONB)
    history: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    __table_args__ = (UniqueConstraint("save_id", "node"),)


class BranchRequest(Base):
    __tablename__ = "branch_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    snapshot_id: Mapped[str] = mapped_column(String(36))
    save_id: Mapped[str] = mapped_column(String(36))


class AIJob(Base):
    __tablename__ = "ai_jobs"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    request_id: Mapped[str] = mapped_column(String(36))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(16), default="running")
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )
    __table_args__ = (UniqueConstraint("save_id", "request_id"),)


class OAuthBinding(Base):
    __tablename__ = "oauth_bindings"
    state_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    guest_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    member_id: Mapped[str | None] = mapped_column(String(36))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="pending")


class ProductEvent(Base):
    __tablename__ = "product_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    name: Mapped[str] = mapped_column(String(50), index=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )


class RateBucket(Base):
    __tablename__ = "rate_buckets"
    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class ProductAggregate(Base):
    __tablename__ = "product_aggregates"
    day: Mapped[str] = mapped_column(String(10), primary_key=True)
    name: Mapped[str] = mapped_column(String(50), primary_key=True)
    count: Mapped[int] = mapped_column(Integer)


class SearchCache(Base):
    __tablename__ = "search_cache"
    topic: Mapped[str] = mapped_column(String(200), primary_key=True)
    sources: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
