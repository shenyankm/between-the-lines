"""Add state format version and transaction invariants without rewriting history."""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade():
    op.add_column(
        "saves", sa.Column("state_schema_version", sa.Integer(), nullable=False, server_default="1")
    )
    op.create_check_constraint(
        "ck_turns_status", "turns", "status IN ('running', 'completed', 'failed')"
    )
    op.create_index(
        "uq_turns_running_save",
        "turns",
        ["save_id"],
        unique=True,
        postgresql_where=sa.text("status = 'running'"),
    )
    op.create_index("ix_turns_user_created", "turns", ["user_id", "created_at"])
    op.create_index("ix_events_save_order", "events", ["save_id", "created_at", "id"])


def downgrade():
    op.drop_index("ix_events_save_order", "events")
    op.drop_index("ix_turns_user_created", "turns")
    op.drop_index("uq_turns_running_save", "turns")
    op.drop_constraint("ck_turns_status", "turns", type_="check")
    op.drop_column("saves", "state_schema_version")
