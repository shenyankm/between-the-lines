from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import get_settings


def utcnow():
    return datetime.now(UTC)


def new_id():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    subject: Mapped[str] = mapped_column(String(255), unique=True)
    name: Mapped[str] = mapped_column(String(100))


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
    state: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Turn(Base):
    __tablename__ = "turns"
    __table_args__ = (UniqueConstraint("save_id", "request_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    request_id: Mapped[str] = mapped_column(String(36))
    payload: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="running")
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    usage: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (UniqueConstraint("turn_id", "operation"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    save_id: Mapped[str] = mapped_column(ForeignKey("saves.id", ondelete="CASCADE"), index=True)
    turn_id: Mapped[str] = mapped_column(ForeignKey("turns.id", ondelete="CASCADE"))
    operation: Mapped[str] = mapped_column(String(100))
    audience: Mapped[list] = mapped_column(JSONB)
    data: Mapped[dict] = mapped_column(JSONB)
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
    topics: Mapped[list] = mapped_column(JSONB)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


settings = get_settings()
engine = create_async_engine(settings.database_url, pool_size=10, max_overflow=20)
Session = async_sessionmaker(engine, expire_on_commit=False)
