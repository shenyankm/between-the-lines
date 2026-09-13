"""Product upgrade: additive persistence for 0005."""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"


def upgrade():
    op.alter_column("events", "turn_id", existing_type=sa.String(36), nullable=True)
    op.add_column("events", sa.Column("source_event_id", sa.String(36)))
    op.execute(
        "\nCREATE TABLE action_proposals (\n\tid VARCHAR(36) NOT NULL, \n\tsave_id VARCHAR(36) NOT NULL, \n\tturn_id VARCHAR(36) NOT NULL, \n\taction VARCHAR(40) NOT NULL, \n\tversion INTEGER NOT NULL, \n\tstatus VARCHAR(16) NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(save_id) REFERENCES saves (id) ON DELETE CASCADE, \n\tFOREIGN KEY(turn_id) REFERENCES turns (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute("CREATE INDEX ix_action_proposals_save_id ON action_proposals (save_id)")
    op.execute(
        "CREATE UNIQUE INDEX uq_proposal_pending ON action_proposals (save_id) WHERE status = 'pending'"
    )
    op.execute(
        "\nCREATE TABLE save_snapshots (\n\tid VARCHAR(36) NOT NULL, \n\tsave_id VARCHAR(36) NOT NULL, \n\tnode VARCHAR(80) NOT NULL, \n\tstate JSONB NOT NULL, \n\thistory JSONB NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (save_id, node), \n\tFOREIGN KEY(save_id) REFERENCES saves (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute("CREATE INDEX ix_save_snapshots_save_id ON save_snapshots (save_id)")
    op.execute(
        "\nCREATE TABLE branch_requests (\n\tid VARCHAR(36) NOT NULL, \n\tuser_id VARCHAR(36) NOT NULL, \n\tsnapshot_id VARCHAR(36) NOT NULL, \n\tsave_id VARCHAR(36) NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(user_id) REFERENCES users (id)\n)\n\n"
    )


def downgrade():
    op.drop_table("branch_requests")
    op.drop_table("save_snapshots")
    op.drop_table("action_proposals")
    op.drop_column("events", "source_event_id")
    op.execute("DELETE FROM events WHERE turn_id IS NULL")
    op.alter_column("events", "turn_id", existing_type=sa.String(36), nullable=False)
