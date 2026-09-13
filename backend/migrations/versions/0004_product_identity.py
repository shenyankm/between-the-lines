"""Add stable story and identity metadata without rewriting existing state."""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"


def upgrade():
    op.add_column(
        "users", sa.Column("identity_type", sa.String(16), nullable=False, server_default="member")
    )
    op.add_column("users", sa.Column("guest_expires_at", sa.DateTime(timezone=True)))
    op.add_column("users", sa.Column("merged_into", sa.String(36)))
    op.add_column(
        "saves", sa.Column("story_id", sa.String(50), nullable=False, server_default="workplace-s1")
    )
    op.add_column(
        "saves", sa.Column("story_version", sa.Integer(), nullable=False, server_default="1")
    )
    op.add_column(
        "saves",
        sa.Column(
            "last_played_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.add_column(
        "saves",
        sa.Column("checkpoint_namespace", sa.String(150), nullable=False, server_default=""),
    )
    op.add_column("saves", sa.Column("parent_save_id", sa.String(36)))
    op.add_column("saves", sa.Column("archived_at", sa.DateTime(timezone=True)))
    op.add_column("saves", sa.Column("deleted_at", sa.DateTime(timezone=True)))
    op.execute(
        "UPDATE saves SET last_played_at=created_at, checkpoint_namespace=user_id || ':' || id"
    )


def downgrade():
    for name in [
        "deleted_at",
        "archived_at",
        "parent_save_id",
        "checkpoint_namespace",
        "last_played_at",
        "story_version",
        "story_id",
    ]:
        op.drop_column("saves", name)
    for name in ["merged_into", "guest_expires_at", "identity_type"]:
        op.drop_column("users", name)
