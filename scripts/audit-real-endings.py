"""Explicit real-provider audit against an already isolated local API."""

import argparse
import json
import sys
import time
from pathlib import Path
from uuid import uuid4

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.story_rules import CATALOG, MAJOR  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--real", action="store_true", required=True)
    parser.add_argument("--url", default="http://localhost:18081")
    parser.add_argument(
        "--output", type=Path, default=ROOT / "artifacts/ending-audit/real-ai-results.json"
    )
    parser.add_argument("--skip-discussion", action="store_true")
    args = parser.parse_args()
    if httpx.URL(args.url).host not in {"localhost", "127.0.0.1"}:
        raise SystemExit("Only isolated localhost servers are supported")
    report = {"config": None, "routes": [], "npc_checks": [], "discussions": []}
    output = args.output
    output.parent.mkdir(parents=True, exist_ok=True)

    def flush():
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2))

    base = [
        "next",
        "dispute_return",
        "approve_purchase",
        "next",
        "clarify",
        "review_clarification",
        "deliver",
    ]
    paths = {
        "rules_rewritten": [
            *base,
            "confirm_responsibility",
            "change_rules",
            "project_review",
            "apply_rules",
        ],
        "professional_boundary": [*base, "cut_ties", "project_review", "follow_up"],
        "limited_repair": [
            *base,
            "repair_friendship",
            "acknowledge_harm",
            "complete_remedy",
            "project_review",
            "follow_up",
        ],
        "active_exit": ["draft_exit", "submit_exit"],
        "career_cost": ["next", "next", "project_review"],
        "unresolved": ["next", "next"],
    }
    for expected, path in paths.items():
        with httpx.Client(base_url=args.url, timeout=90) as client:

            def request(method, url, **kw):
                response = client.request(method, url, **kw)
                response.raise_for_status()
                return response

            config = request("GET", "/api/config").json()
            assert config["agent_mode"] == "deepseek" and config["model_ready"]
            report["config"] = config
            request("POST", "/api/auth/dev", json={"name": "真实AI分支审查"})
            save = request("POST", "/api/saves", json={"story_version": 3}).json()

            def turn(action, npc="sun", **extra):
                nonlocal save
                body = {
                    "request_id": str(uuid4()),
                    "version": save["version"],
                    "action": action,
                    "npc": npc,
                    **extra,
                }
                response = request("POST", f"/api/saves/{save['id']}/turns", json=body)
                frame = next(f for f in response.text.split("\n\n") if f.startswith("event: done"))
                result = json.loads(frame.split("data: ", 1)[1])
                save = result["save"]
                assert result["status"] == "completed", result
                return result

            def step(action):
                npc = CATALOG[action][2] or "sun"
                extra = (
                    {"params": {"boundary_response": "decline"}} if action == "follow_up" else {}
                )
                if action in MAJOR:
                    proposed = turn("propose", npc, proposed_action=action)
                    extra["proposal_id"] = proposed["proposal"]["id"]
                return turn(action, npc, **extra)

            def job(kind, snapshot):
                body = {
                    "request_id": str(uuid4()),
                    "version": snapshot["version"],
                    "kind": kind,
                }
                result = request("POST", f"/api/saves/{snapshot['id']}/jobs", json=body).json()
                deadline = time.monotonic() + 100
                while result["status"] == "running" and time.monotonic() < deadline:
                    time.sleep(1)
                    jobs = request("GET", f"/api/saves/{snapshot['id']}/jobs").json()
                    result = next(j for j in jobs if j["id"] == result["id"])
                print(
                    kind,
                    snapshot["state"]["act"],
                    result["status"],
                    result.get("result", {}).get("label"),
                    flush=True,
                )
                assert result["status"] == "completed", result
                if kind == "discussion":
                    cards = result.get("result", {}).get("cards", [])
                    assert cards and all(card.get("sources") for card in cards), result
                return result

            step("begin")
            if expected == "rules_rewritten":
                for npc, text, flag in [
                    ("sun", "我不接受这种玩笑，请尊重我的边界。", "boundary"),
                    (
                        "wang",
                        "我担心同事把私人情绪带进采购审核，怎样核对退回意见才比较稳妥？",
                        None,
                    ),
                ]:
                    value = turn("speak", npc, text=text, channel="dm", target=npc)
                    report["npc_checks"].append(
                        {
                            "npc": npc,
                            "input": text,
                            "expected_flag": flag,
                            "flag_recorded": flag in save["state"]["flags"] if flag else None,
                            "turn": value,
                        }
                    )
                    print(
                        "npc",
                        npc,
                        report["npc_checks"][-1]["flag_recorded"],
                        flush=True,
                    )
                if not args.skip_discussion:
                    report["discussions"].append(job("discussion", save))
                flush()
            for action in path:
                step(action)
                if expected == "rules_rewritten" and action == "next":
                    if save["state"]["act"] == 2:
                        for npc, text, flag in [
                            ("li", "请说明普通采购所需材料。", "requirements"),
                            (
                                "zhang",
                                "向你同步采购受阻的风险：昨天已按模板提交，今天收到没有指出缺项的退回。",
                                "reported",
                            ),
                        ]:
                            value = turn("speak", npc, text=text, channel="dm", target=npc)
                            report["npc_checks"].append(
                                {
                                    "npc": npc,
                                    "input": text,
                                    "expected_flag": flag,
                                    "flag_recorded": flag in save["state"]["flags"],
                                    "turn": value,
                                }
                            )
                            print(
                                "npc",
                                npc,
                                report["npc_checks"][-1]["flag_recorded"],
                                flush=True,
                            )
                    if not args.skip_discussion:
                        report["discussions"].append(job("discussion", save))
                    flush()
            if not save["state"]["ending"]:
                step("close_story")
            assert save["state"]["outcome"]["id"] == expected
            route = {
                "expected": expected,
                "save": save,
                "ending": job("ending", save),
                "reflection": job("reflection", save),
            }
            report["routes"].append(route)
            flush()
            print("route", expected, save["id"], flush=True)
    print("Report:", output, flush=True)


if __name__ == "__main__":
    main()
