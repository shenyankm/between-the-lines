"""Retire the save archive state machine.

Dropping the column returns every archived save to the ordinary list, so all
remaining saves are either active or deleted. Downgrade recreates the empty
column; restore a backup to recover historical archive timestamps.
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("saves", "archived_at")


def downgrade() -> None:
    op.add_column("saves", sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True))
