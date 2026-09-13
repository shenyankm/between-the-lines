"""Liveness, readiness and the healthcheck the containers already depend on.

`/api/health` predates this split and three things call it -- the image
HEALTHCHECK, compose's `service_healthy` gate, and CI's mock-mode assertion -- so
it must keep answering exactly as before. `/api/live` and `/api/ready` separate
the two questions it conflated, and the tests below are what makes that separation
observable rather than merely documented.

`/metrics` is in this router too. Its rendering rules are covered by the
unit-marked test_metrics.py; what needs the live app is the contract it presents
to a scraper, which is asserted at the bottom of this file.
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import health
from app.routes.health import _PROBE_TIMEOUT_SECONDS

pytestmark = pytest.mark.integration


def bare_app() -> FastAPI:
    """The same router with no lifespan: the pre-setup window, staged.

    Two things make the real app unusable for that. `app.state` outlives the
    lifespan that populated it, so asserting an attribute is absent would only hold
    if this ran first -- which pytest-randomly guarantees it does not. And the
    lifespan's `finally` is what disposes the shared engine; a TestClient used
    without `with` skips it, leaving pooled connections bound to an event loop that
    has already closed. The next test to acquire one gets asyncpg's "another
    operation is in progress", in a module that had nothing to do with the cause.
    """
    staged = FastAPI()
    staged.include_router(health.router)
    return staged


class ExplodingSession:
    """Stands in for the async session factory so a database outage can be staged.

    Any attempt to use it raises, which is what distinguishes the three endpoints:
    /api/live must not notice, /api/health must fail, /api/ready must report.
    """

    def __call__(self) -> "ExplodingSession":
        return self

    async def __aenter__(self) -> "ExplodingSession":
        raise RuntimeError("postgresql://btl:secret-pw@db.internal:5432/btl refused")

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    async def execute(self, *_args: object) -> None:
        raise RuntimeError("unreachable")


@pytest.fixture
def db_down():
    return ExplodingSession()


def test_health_is_unchanged_for_the_container_healthcheck(app):
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_health_fails_when_the_database_is_down(app, db_down):
    with TestClient(app, raise_server_exceptions=False) as client:
        app.state.runtime.sessions = db_down
        response = client.get("/api/health")
    # A 500, not a 200 with ok=false: compose's healthcheck gates on the status
    # code, and a body it does not parse is the only thing keeping that honest.
    assert response.status_code == 500


def test_live_answers_with_the_database_down(app, db_down):
    with TestClient(app, raise_server_exceptions=False) as client:
        app.state.runtime.sessions = db_down
        response = client.get("/api/live")
    # The whole point of the split: a restart policy needs "is this process
    # wedged", and restarting a healthy process because the database blipped makes
    # the outage worse.
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


def test_ready_reports_both_checks_ok(app):
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ready"
    assert body["checks"] == {"database": "ok", "checkpoint_pool": "ok"}


def test_ready_names_the_failed_dependency_without_quoting_its_error(app, db_down):
    with TestClient(app, raise_server_exceptions=False) as client:
        app.state.runtime.sessions = db_down
        response = client.get("/api/ready")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "not_ready"
    assert body["checks"]["database"] == "error"
    # The checkpoint pool is a separate connection path, so it stays healthy while
    # the ORM engine does not. Reporting them together is what the split buys.
    assert body["checks"]["checkpoint_pool"] == "ok"

    text = response.text
    # A database error string can carry a DSN fragment, including the password.
    assert "secret-pw" not in text
    assert "db.internal" not in text
    # Constrained to two values by the schema, so no free-form detail can appear.
    assert set(body["checks"].values()) <= {"ok", "error"}


def test_ready_fails_when_the_checkpoint_pool_was_never_initialised(db_down):
    # Outside the lifespan app.state has no checkpoint_pool: the state a worker is
    # in between process start and setup() completing, which must not read as ready.
    # The database is stubbed out too, so the probe reaches neither dependency --
    # `checkpoint_pool` is "error" because it is absent, not because it failed.
    response = TestClient(bare_app(), raise_server_exceptions=False).get("/api/ready")
    assert response.status_code == 503
    assert response.json()["checks"] == {"database": "error", "checkpoint_pool": "error"}


def test_the_readiness_probe_has_a_bound_shorter_than_an_orchestrator_timeout():
    # A probe that blocks longer than the orchestrator's own timeout turns
    # "degraded" into "unreachable", which is a strictly worse answer.
    assert 0 < _PROBE_TIMEOUT_SECONDS <= 5.0


def test_ready_is_not_an_envelope_error_even_at_503(app):
    # The deliberate exception to the one-error-shape rule, pinned so a future
    # cleanup does not "fix" it by wrapping the diagnostic payload away.
    with TestClient(app, raise_server_exceptions=False) as client:
        ok = client.get("/api/ready")
    assert "error" not in ok.json()
    schema = app.openapi()["paths"]["/api/ready"]["get"]["responses"]
    # The app-level 500 reaches every route, this one included. What must not happen
    # is the diagnostic payload being wrapped at the two statuses that carry it.
    assert set(schema) == {"200", "500", "503"}
    for status in ("200", "503"):
        ref = schema[status]["content"]["application/json"]["schema"]["$ref"]
        assert ref.endswith("/ReadyOut"), status
    envelope = schema["500"]["content"]["application/json"]["schema"]["$ref"]
    assert envelope.endswith("/ErrorEnvelope")


def sample(text: str, name: str) -> float:
    """One unlabeled sample line's value, from rendered exposition text."""
    prefix = f"{name} "
    matches = [line for line in text.splitlines() if line.startswith(prefix)]
    assert len(matches) == 1, matches
    return float(matches[0].removeprefix(prefix))


def test_the_metrics_endpoint_is_plaintext_and_absent_from_the_contract(app):
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/metrics")
    assert response.status_code == 200
    # The version is part of the media type; without it a scraper may refuse.
    assert response.headers["content-type"] == "text/plain; version=0.0.4; charset=utf-8"
    assert "btl_turns_active" in response.text
    # Unpublished on purpose: it is an operator surface behind nginx's 404, not part
    # of the API a frontend generates types from. Documenting it would advertise a
    # path clients are told to call and the deployment refuses to route.
    assert "/metrics" not in app.openapi()["paths"]


def test_the_metrics_endpoint_answers_before_the_lifespan_has_run():
    # A scraper must never get a 500 from the endpoint it uses to detect trouble.
    # Before the lifespan runs app.state.runtime.runner.active does not exist, which is exactly the
    # window where reading the gauge would otherwise raise AttributeError.
    response = TestClient(bare_app(), raise_server_exceptions=False).get("/metrics")
    assert response.status_code == 200
    assert sample(response.text, "btl_turns_active") == 0
