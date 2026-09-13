"""Local review, metrics and dry-run lifecycle maintenance. No public admin API."""

import argparse
import json
import math
import sys
from pathlib import Path

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import Settings  # noqa: E402
from app.content import content_hash  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command",
        choices=["review-export", "review-import", "metrics", "cleanup", "reconcile"],
    )
    parser.add_argument("--file", type=Path)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit review, cleanup or reconciliation changes; default dry-run",
    )
    args = parser.parse_args()
    settings = Settings()
    with psycopg.connect(settings.checkpoint_url, row_factory=psycopg.rows.dict_row) as db:
        if args.command == "review-export":
            rows = db.execute("SELECT * FROM zhihu_contents ORDER BY fetched_at DESC").fetchall()
            data = [
                {k: v for k, v in row.items() if k != "fetched_at"}
                | {
                    "content_hash": content_hash(row),
                    "review_status": row["review_status"]
                    if row["content_hash"] == content_hash(row)
                    else "candidate",
                }
                for row in rows
            ]
            output = json.dumps(data, ensure_ascii=False, indent=2)
            if args.file:
                args.file.write_text(output + "\n")
            else:
                print(output)
        elif args.command == "review-import":
            if not args.file:
                parser.error("--file is required")
            items = json.loads(args.file.read_text())
            for item in items:
                if item["review_status"] not in {"candidate", "approved", "rejected"}:
                    raise ValueError("Invalid review status")
                row = db.execute(
                    "SELECT * FROM zhihu_contents WHERE content_type=%s AND content_id=%s FOR UPDATE",
                    (item["content_type"], item["content_id"]),
                ).fetchone()
                if not row or content_hash(row) != item["content_hash"]:
                    raise ValueError("Source changed; export and review again")
                if row["source_url"] and not row["source_url"].startswith("https://"):
                    raise ValueError("Sources require HTTPS")
                topics = item.get("topics", row["topics"])
                if (
                    not isinstance(topics, list)
                    or len(topics) > 12
                    or any(
                        not isinstance(topic, str) or not 0 < len(topic) <= 80 for topic in topics
                    )
                ):
                    raise ValueError("Topics must be at most twelve short text tags")
                reviewed_hash = content_hash({**row, "topics": topics})
                if args.apply:
                    db.execute(
                        "UPDATE zhihu_contents SET review_status=%s,review_note=%s,content_hash=%s,topics=%s::jsonb WHERE content_type=%s AND content_id=%s",
                        (
                            item["review_status"],
                            str(item.get("review_note", ""))[:2000],
                            reviewed_hash,
                            json.dumps(topics),
                            item["content_type"],
                            item["content_id"],
                        ),
                    )
            print(json.dumps({"dry_run": not args.apply, "reviewed": len(items)}))
        elif args.command == "metrics":
            funnel = db.execute(
                "SELECT name,count(*) AS events,count(DISTINCT user_id) AS players FROM product_events WHERE created_at > now()-interval '30 days' GROUP BY name ORDER BY name"
            ).fetchall()
            turns = db.execute(
                "SELECT count(*) AS total,count(*) FILTER (WHERE status='failed') AS failed,avg((usage->>'elapsed_ms')::numeric) AS average_ms,percentile_cont(.95) WITHIN GROUP (ORDER BY (usage->>'elapsed_ms')::numeric) AS p95_ms FROM turns WHERE created_at>now()-interval '30 days'"
            ).fetchone()
            billing = db.execute(
                "SELECT sum(cost_usd) AS estimated_usd,sum(reserved_usd) AS reserved_usd,count(*) FILTER (WHERE status='unknown') AS unknown FROM ai_spend WHERE created_at > now()-interval '30 days'"
            ).fetchone()
            completed = db.execute(
                "SELECT count(*) AS count FROM saves WHERE state->>'ending' IS NOT NULL AND last_played_at>now()-interval '30 days'"
            ).fetchone()["count"]
            print(
                json.dumps(
                    {
                        "funnel": funnel,
                        "turns": turns,
                        "billing": billing,
                        "estimated_usd_per_completed_story": float(billing["estimated_usd"] or 0)
                        / completed
                        if completed
                        else None,
                        "note": "应用估算；待核对用量单列，不能代替供应商账单",
                    },
                    ensure_ascii=False,
                    default=str,
                    indent=2,
                )
            )
        elif args.command == "reconcile":
            if not args.file:
                parser.error("--file JSON list of {id,cost_usd} is required")
            items = json.loads(args.file.read_text())
            for item in items:
                cost = float(item["cost_usd"])
                if cost < 0 or not math.isfinite(cost):
                    raise ValueError("Invalid cost")
                row = db.execute(
                    "SELECT id FROM ai_spend WHERE id=%s AND status='unknown' FOR UPDATE",
                    (item["id"],),
                ).fetchone()
                if not row:
                    raise ValueError("Not an unresolved billing entry")
                if args.apply:
                    db.execute(
                        "UPDATE ai_spend SET cost_usd=%s,reserved_usd=0,status='reconciled' WHERE id=%s",
                        (cost, item["id"]),
                    )
            print(json.dumps({"dry_run": not args.apply, "entries": len(items)}))
        else:
            rows = db.execute(
                "SELECT s.id,s.checkpoint_namespace FROM saves s JOIN users u ON u.id=s.user_id WHERE (s.deleted_at<now()-interval '30 days' OR (u.identity_type='guest' AND u.merged_into IS NULL AND u.guest_expires_at<now()-interval '7 days')) AND NOT EXISTS (SELECT 1 FROM oauth_bindings b WHERE b.guest_id=u.id AND b.status='waiting') AND NOT EXISTS (SELECT 1 FROM turns t WHERE t.save_id=s.id AND t.status='running') AND NOT EXISTS (SELECT 1 FROM ai_jobs j WHERE j.save_id=s.id AND j.status='running') FOR UPDATE OF s"
            ).fetchall()
            print(
                json.dumps(
                    {
                        "dry_run": not args.apply,
                        "saves": len(rows),
                        "checkpoints": len(rows) * 3,
                    }
                )
            )
            if args.apply:
                for row in rows:
                    # Checkpoint tables have no business foreign key: remove each namespace explicitly.
                    for table in (
                        "checkpoint_writes",
                        "checkpoint_blobs",
                        "checkpoints",
                    ):
                        if db.execute(
                            "SELECT to_regclass(%s) AS table_name",
                            ("agent_checkpoints." + table,),
                        ).fetchone()["table_name"]:
                            db.execute(
                                sql.SQL(
                                    "DELETE FROM agent_checkpoints.{} WHERE thread_id = ANY(%s)"
                                ).format(sql.Identifier(table)),
                                (
                                    [
                                        row["checkpoint_namespace"] + ":" + npc
                                        for npc in ("sun", "li", "zhang")
                                    ],
                                ),
                            )
                    db.execute("DELETE FROM branch_requests WHERE save_id=%s", (row["id"],))
                    db.execute("DELETE FROM saves WHERE id=%s", (row["id"],))
                db.execute(
                    "INSERT INTO product_aggregates(day,name,count) SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD'),name,count(*) FROM product_events WHERE created_at<now()-interval '30 days' GROUP BY 1,2 ON CONFLICT (day,name) DO UPDATE SET count=product_aggregates.count+EXCLUDED.count"
                )
                db.execute("DELETE FROM product_events WHERE created_at<now()-interval '30 days'")
                db.execute(
                    "DELETE FROM product_aggregates WHERE day < to_char(now()-interval '180 days','YYYY-MM-DD')"
                )
                db.execute("DELETE FROM rate_buckets WHERE expires_at<now()")
                db.execute("DELETE FROM login_sessions WHERE expires_at<now()")
                # Keep minimal expired/merged identity tombstones for billing ownership and binding replay protection.
                db.execute(
                    "UPDATE users SET name='过期试玩者' WHERE identity_type='guest' AND guest_expires_at<now()-interval '7 days'"
                )
        if not args.apply:
            db.rollback()


if __name__ == "__main__":
    main()
