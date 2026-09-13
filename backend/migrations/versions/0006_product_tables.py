"""Product upgrade: additive persistence for 0006."""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"


def upgrade():
    op.add_column(
        "zhihu_contents",
        sa.Column("review_status", sa.String(16), nullable=False, server_default="candidate"),
    )
    op.add_column(
        "zhihu_contents",
        sa.Column("content_hash", sa.String(64), nullable=False, server_default=""),
    )
    op.add_column(
        "zhihu_contents", sa.Column("review_note", sa.Text(), nullable=False, server_default="")
    )
    op.execute(
        "\nCREATE TABLE ai_jobs (\n\tid VARCHAR(36) NOT NULL, \n\trequest_id VARCHAR(36) NOT NULL, \n\tuser_id VARCHAR(36) NOT NULL, \n\tsave_id VARCHAR(36) NOT NULL, \n\tkind VARCHAR(20) NOT NULL, \n\tstatus VARCHAR(16) NOT NULL, \n\treserved_usd FLOAT NOT NULL, \n\tcost_usd FLOAT NOT NULL, \n\tusage JSONB NOT NULL, \n\tpayload JSONB NOT NULL, \n\tresult JSONB, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (save_id, request_id), \n\tFOREIGN KEY(user_id) REFERENCES users (id), \n\tFOREIGN KEY(save_id) REFERENCES saves (id) ON DELETE CASCADE\n)\n\n"
    )
    op.execute("CREATE INDEX ix_ai_jobs_created_at ON ai_jobs (created_at)")
    op.execute("CREATE INDEX ix_ai_jobs_save_id ON ai_jobs (save_id)")
    op.execute("CREATE INDEX ix_ai_jobs_user_id ON ai_jobs (user_id)")
    op.execute(
        "\nCREATE TABLE oauth_bindings (\n\tstate_hash VARCHAR(64) NOT NULL, \n\tguest_id VARCHAR(36) NOT NULL, \n\tmember_id VARCHAR(36), \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tstatus VARCHAR(16) NOT NULL, \n\tPRIMARY KEY (state_hash), \n\tFOREIGN KEY(guest_id) REFERENCES users (id)\n)\n\n"
    )
    op.execute(
        "\nCREATE TABLE product_events (\n\tid VARCHAR(36) NOT NULL, \n\tuser_id VARCHAR(36), \n\tname VARCHAR(50) NOT NULL, \n\tdata JSONB NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (id)\n)\n\n"
    )
    op.execute("CREATE INDEX ix_product_events_created_at ON product_events (created_at)")
    op.execute("CREATE INDEX ix_product_events_name ON product_events (name)")
    op.execute("CREATE INDEX ix_product_events_user_id ON product_events (user_id)")
    op.execute(
        "\nCREATE TABLE rate_buckets (\n\tkey VARCHAR(128) NOT NULL, \n\tcount INTEGER NOT NULL, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\tPRIMARY KEY (key)\n)\n\n"
    )
    op.execute("CREATE INDEX ix_rate_buckets_expires_at ON rate_buckets (expires_at)")
    op.execute(
        "\nCREATE TABLE product_aggregates (\n\tday VARCHAR(10) NOT NULL, \n\tname VARCHAR(50) NOT NULL, \n\tcount INTEGER NOT NULL, \n\tPRIMARY KEY (day, name)\n)\n\n"
    )


def downgrade():
    op.drop_table("product_aggregates")
    op.drop_table("rate_buckets")
    op.drop_table("product_events")
    op.drop_table("oauth_bindings")
    op.drop_table("ai_jobs")
    for name in ["review_note", "content_hash", "review_status"]:
        op.drop_column("zhihu_contents", name)
