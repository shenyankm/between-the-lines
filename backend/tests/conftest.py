import os

# Set before any application imports; test traffic never reaches a real LLM.
os.environ["ENVIRONMENT"] = "test"
os.environ["AGENT_MODE"] = "mock"
os.environ["DATABASE_URL"] = os.environ.get(
    "BTL_TEST_DATABASE_URL", "postgresql+asyncpg://btl:btl@localhost:54329/btl_test"
)
os.environ["CHECKPOINT_URL"] = os.environ["DATABASE_URL"].replace(
    "postgresql+asyncpg:", "postgresql:"
)

import psycopg
import pytest

# alembic_version records the schema revision and checkpoint_migrations records
# which LangGraph tables already exist. Truncating either would leave the next
# `alembic upgrade` or checkpointer setup believing the schema is uninitialised.
_KEEP = frozenset({"alembic_version", "checkpoint_migrations"})


def _truncate() -> None:
    # Synchronous on purpose: this fixture serves sync and async tests alike, and
    # driving the async engine from here would need an event loop that is either
    # absent (sync tests) or already owned by the test (async tests).
    from urllib.parse import urlsplit

    database = urlsplit(os.environ["CHECKPOINT_URL"]).path.removeprefix("/")
    if database != "btl_test" and not database.startswith("btl_upgrade_test_"):
        raise RuntimeError("Refusing to truncate a non-test database")
    with psycopg.connect(os.environ["CHECKPOINT_URL"]) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT schemaname, tablename FROM pg_tables "
            "WHERE schemaname IN ('public', 'agent_checkpoints')"
        )
        tables = [f'"{schema}"."{name}"' for schema, name in cur.fetchall() if name not in _KEEP]
        if tables:
            # These identifiers come from pg_tables, never from input, and SQL has no
            # way to bind an identifier as a parameter.
            cur.execute(f"TRUNCATE TABLE {', '.join(tables)} CASCADE")


@pytest.fixture(autouse=True)
def isolated_database(request: pytest.FixtureRequest) -> None:
    """Give every non-unit test an empty database.

    These tests already pass under pytest-randomly, but only because dev_login
    mints a random identity per call, so no two tests ever observe each other's
    rows. That isolation is incidental to one endpoint's implementation and
    would silently vanish if it ever changed. Truncating makes it structural:
    nothing can pass or fail because of rows a previous test left behind.

    Unit-marked tests are exempt so `pytest -m unit` still passes with
    PostgreSQL stopped, which is the entire point of the marker split.
    """
    if request.node.get_closest_marker("unit") is None:
        _truncate()


@pytest.fixture
def app():
    from app.config import Settings
    from app.factory import create_app

    return create_app(
        Settings(
            _env_file=None,
            environment="test",
            agent_mode="mock",
            story_v2_enabled=False,
            database_url=os.environ["DATABASE_URL"],
            checkpoint_url=os.environ["CHECKPOINT_URL"],
        )
    )
