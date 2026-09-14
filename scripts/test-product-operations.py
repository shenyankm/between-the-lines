"""Restore a dedicated test database, exercise moderation/retention, then drop only the copy."""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--container", default="between-the-lines-db-1")
    args = parser.parse_args()
    if not args.source.startswith(("btl_upgrade_preview_", "btl_upgrade_test_", "btl_test")):
        parser.error("Only a dedicated test source is accepted")
    target = "btl_upgrade_test_ops_" + uuid4().hex[:12]
    container = args.container

    def pg(*parts, **kwargs):
        return subprocess.run(
            [shutil.which("docker") or "/usr/local/bin/docker", "exec", "-i", container, *parts],
            check=True,
            **kwargs,
        )

    with tempfile.TemporaryDirectory(prefix="btl-product-ops-") as directory:
        folder = Path(directory)
        dump = folder / "restore.dump"
        with dump.open("wb") as output:
            pg("pg_dump", "-U", "btl", "-d", args.source, "-Fc", stdout=output)
        pg("createdb", "-U", "btl", target)
        try:
            with dump.open("rb") as source:
                pg("pg_restore", "-U", "btl", "-d", target, "--exit-on-error", stdin=source)
            dsn = f"postgresql://btl:btl@localhost:54329/{target}"
            environment = {
                **os.environ,
                "ENVIRONMENT": "test",
                "AGENT_MODE": "mock",
                "CHECKPOINT_URL": dsn,
                "DATABASE_URL": dsn.replace("postgresql://", "postgresql+asyncpg://"),
            }

            def admin(*parts, expected=0):
                result = subprocess.run(
                    [sys.executable, str(ROOT / "scripts/product-admin.py"), *parts],
                    env=environment,
                    capture_output=True,
                    text=True,
                )
                assert result.returncode == expected, result.stderr
                return result.stdout

            with psycopg.connect(dsn) as db:
                version = db.execute("SELECT version_num FROM alembic_version").fetchone()[0]
                assert version == "0009"
                saves = db.execute("SELECT count(*) FROM saves").fetchone()[0]
                branches = db.execute(
                    "SELECT count(*) FROM saves WHERE parent_save_id IS NOT NULL"
                ).fetchone()[0]
                snapshots = db.execute("SELECT count(*) FROM save_snapshots").fetchone()[0]
                checkpoints = db.execute(
                    "SELECT count(*) FROM agent_checkpoints.checkpoints"
                ).fetchone()[0]
                assert saves and branches and snapshots and checkpoints
                assert not db.execute(
                    "SELECT count(*) FROM turns WHERE status='running'"
                ).fetchone()[0]
                assert not db.execute(
                    "SELECT count(*) FROM ai_jobs WHERE status='running'"
                ).fetchone()[0]
                assert db.execute("SELECT to_regclass('ai_spend')").fetchone()[0] is None
                db.execute(
                    "INSERT INTO zhihu_contents(content_type,content_id,title,summary,source_url,author_name,vote_count,comment_count,topics,fetched_at) VALUES ('answer','ops-fixture','审核测试','只用于隔离测试','https://www.zhihu.com/question/1/answer/2','测试',0,0,'[\"act_1\"]',now())"
                )
            file = folder / "review.json"
            admin("review-export", "--file", str(file))
            entries = json.loads(file.read_text())
            candidate = next(row for row in entries if row["content_id"] == "ops-fixture")
            candidate.update(
                review_status="approved", review_note="隔离运维验收", topics=["act_1", "act_2"]
            )
            file.write_text(json.dumps([candidate]))
            assert json.loads(admin("review-import", "--file", str(file)))["dry_run"]
            with psycopg.connect(dsn) as db:
                assert (
                    db.execute(
                        "SELECT review_status FROM zhihu_contents WHERE content_id='ops-fixture'"
                    ).fetchone()[0]
                    == "candidate"
                )
            admin("review-import", "--file", str(file), "--apply")
            with psycopg.connect(dsn) as db:
                assert (
                    db.execute(
                        "SELECT review_status FROM zhihu_contents WHERE content_id='ops-fixture'"
                    ).fetchone()[0]
                    == "approved"
                )
                assert db.execute(
                    "SELECT topics FROM zhihu_contents WHERE content_id='ops-fixture'"
                ).fetchone()[0] == ["act_1", "act_2"]
                db.execute(
                    "UPDATE zhihu_contents SET summary='更新后需要重新审核' WHERE content_id='ops-fixture'"
                )
            admin("review-import", "--file", str(file), "--apply", expected=1)
            metrics = json.loads(admin("metrics"))
            assert set(metrics) == {"funnel", "turns"}
            assert {"average_ms", "p95_ms"} <= metrics["turns"].keys()
            with psycopg.connect(dsn) as db:
                db.execute("UPDATE saves SET deleted_at=now()-interval '31 days'")
            dry = json.loads(admin("cleanup"))
            assert dry["saves"] == saves
            with psycopg.connect(dsn) as db:
                assert db.execute("SELECT count(*) FROM saves").fetchone()[0] == saves
            admin("cleanup", "--apply")
            with psycopg.connect(dsn) as db:
                for table in ("saves", "turns", "events", "save_snapshots", "ai_jobs"):
                    assert (
                        db.execute(
                            sql.SQL("SELECT count(*) FROM {}").format(sql.Identifier(table))
                        ).fetchone()[0]
                        == 0
                    )
                for table in ("checkpoints", "checkpoint_writes", "checkpoint_blobs"):
                    assert (
                        db.execute(
                            sql.SQL("SELECT count(*) FROM agent_checkpoints.{}").format(
                                sql.Identifier(table)
                            )
                        ).fetchone()[0]
                        == 0
                    )
                assert db.execute("SELECT to_regclass('ai_spend')").fetchone()[0] is None
            report = {
                "passed": True,
                "restored": {
                    "saves": saves,
                    "branches": branches,
                    "snapshots": snapshots,
                    "checkpoints": checkpoints,
                },
                "accounting_removed": True,
                "review_dry_run_and_stale_hash": True,
                "cleanup_dry_run_and_checkpoints": True,
                "metrics_available": bool(metrics),
            }
            artifact = ROOT / "artifacts/product-operations.json"
            artifact.parent.mkdir(exist_ok=True)
            artifact.write_text(json.dumps(report, indent=2) + "\n")
            print(json.dumps(report))
        finally:
            pg("dropdb", "-U", "btl", "--if-exists", target)


if __name__ == "__main__":
    main()
