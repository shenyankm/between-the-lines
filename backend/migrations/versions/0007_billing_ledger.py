"""Durable billing ledger independent of save cleanup."""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "\nCREATE TABLE ai_spend (\n\tid VARCHAR(36) NOT NULL, \n\tuser_id VARCHAR(36) NOT NULL, \n\tsave_id VARCHAR(36) NOT NULL, \n\tkind VARCHAR(20) NOT NULL, \n\tstatus VARCHAR(16) NOT NULL, \n\treserved_usd FLOAT NOT NULL, \n\tcost_usd FLOAT NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id)\n)\n\n"
    )
    op.execute("CREATE INDEX ix_ai_spend_user_id ON ai_spend (user_id)")
    op.execute("CREATE INDEX ix_ai_spend_created_at ON ai_spend (created_at)")
    op.execute(
        "INSERT INTO ai_spend (id,user_id,save_id,kind,status,reserved_usd,cost_usd,created_at) SELECT id,user_id,save_id,kind,status,reserved_usd,cost_usd,created_at FROM ai_jobs"
    )

    # Preserve pre-task AI costs and usage counts when old saves are later purged.
    op.execute("""
        INSERT INTO ai_spend (id,user_id,save_id,kind,status,reserved_usd,cost_usd,created_at)
        SELECT id,user_id,save_id,'turn',status,0,
               COALESCE((usage->>'cost_estimate_usd')::float,0),created_at
        FROM turns
        WHERE payload->>'action' IN ('speak','epilogue')
           OR COALESCE((usage->>'model_calls')::int,0)>0
        ON CONFLICT (id) DO NOTHING
    """)


def downgrade() -> None:
    op.drop_table("ai_spend")
