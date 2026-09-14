"""Remove provider accounting, retaining execution timing and business results.

Downgrade recreates empty accounting structures, not deleted billing data.
Restore a backup when rolling back a production deployment.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("turns", sa.Column("elapsed_ms", sa.Integer(), nullable=True))
    # Only accept nonnegative integral JSON numbers representable by INTEGER.
    # CASE prevents malformed legacy values from ever reaching the numeric cast.
    op.execute("""
        UPDATE turns SET elapsed_ms = CASE
            WHEN jsonb_typeof(usage->'elapsed_ms') = 'number' THEN
                CASE WHEN (usage->>'elapsed_ms')::numeric BETWEEN 0 AND 2147483647
                     AND trunc((usage->>'elapsed_ms')::numeric) = (usage->>'elapsed_ms')::numeric
                     THEN (usage->>'elapsed_ms')::numeric::integer END
            END
    """)
    op.drop_column("turns", "usage")
    for column in ("reserved_usd", "cost_usd", "usage"):
        op.drop_column("ai_jobs", column)
    op.drop_table("ai_spend")
    op.execute("DELETE FROM rate_buckets WHERE key LIKE 'turn:%' OR key LIKE 'artifact:%'")


def downgrade() -> None:
    op.add_column(
        "turns", sa.Column("usage", postgresql.JSONB(), nullable=False, server_default="{}")
    )
    op.execute("""
        UPDATE turns SET usage = jsonb_build_object('elapsed_ms', elapsed_ms)
        WHERE elapsed_ms IS NOT NULL
    """)
    op.alter_column("turns", "usage", server_default=None)
    op.drop_column("turns", "elapsed_ms")
    for column in ("reserved_usd", "cost_usd"):
        op.add_column("ai_jobs", sa.Column(column, sa.Float(), nullable=False, server_default="0"))
        op.alter_column("ai_jobs", column, server_default=None)
    op.add_column(
        "ai_jobs", sa.Column("usage", postgresql.JSONB(), nullable=False, server_default="{}")
    )
    op.alter_column("ai_jobs", "usage", server_default=None)
    op.create_table(
        "ai_spend",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("save_id", sa.String(36), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("reserved_usd", sa.Float(), nullable=False),
        sa.Column("cost_usd", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_ai_spend_user_id", "ai_spend", ["user_id"])
    op.create_index("ix_ai_spend_created_at", "ai_spend", ["created_at"])
