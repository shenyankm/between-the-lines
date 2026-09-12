"""Initial game and account tables."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision = "0001"
down_revision = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("subject", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
    )
    op.create_table(
        "login_sessions",
        sa.Column("token_hash", sa.String(64), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "saves",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("state", pg.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_saves_user_id", "saves", ["user_id"])
    op.create_table(
        "turns",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "save_id", sa.String(36), sa.ForeignKey("saves.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_id", sa.String(36), nullable=False),
        sa.Column("payload", pg.JSONB(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("result", pg.JSONB()),
        sa.Column("usage", pg.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("save_id", "request_id"),
    )
    op.create_index("ix_turns_save_id", "turns", ["save_id"])
    op.create_index("ix_turns_user_id", "turns", ["user_id"])
    op.create_table(
        "events",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "save_id", sa.String(36), sa.ForeignKey("saves.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "turn_id", sa.String(36), sa.ForeignKey("turns.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("operation", sa.String(100), nullable=False),
        sa.Column("audience", pg.JSONB(), nullable=False),
        sa.Column("data", pg.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("turn_id", "operation"),
    )
    op.create_index("ix_events_save_id", "events", ["save_id"])


def downgrade():
    for name in ("events", "turns", "saves", "login_sessions", "users"):
        op.drop_table(name)
