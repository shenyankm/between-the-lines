"""Persist reading separately from gameplay versions and model budgets."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "search_cache",
        sa.Column("topic", sa.String(200), primary_key=True),
        sa.Column("sources", postgresql.JSONB(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.add_column(
        "saves", sa.Column("reading", postgresql.JSONB(), nullable=False, server_default="{}")
    )


def downgrade() -> None:
    op.drop_table("search_cache")
    op.drop_column("saves", "reading")
