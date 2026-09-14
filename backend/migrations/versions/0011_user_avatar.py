"""Persist authorized user avatars."""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_url", sa.String(2048), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_url")
