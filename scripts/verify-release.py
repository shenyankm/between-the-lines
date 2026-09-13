"""Gate deployment on successful push/main CI and Audit runs for the same SHA."""

import json
import os
import re
import time
import urllib.request
from pathlib import Path

REPO = "shenyankm/between-the-lines"


def get(path: str):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/{path}",
        headers={
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310 - fixed HTTPS GitHub API origin
        return json.load(response)


def main():
    sha = os.environ["RELEASE_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Invalid source SHA")
    if get("git/ref/heads/main")["object"]["sha"] != sha:
        raise RuntimeError("Superseded release: main has advanced")
    deadline = time.monotonic() + 1200
    last = None
    while time.monotonic() < deadline:
        runs = get(f"actions/runs?head_sha={sha}&event=push&per_page=100")["workflow_runs"]
        selected = {}
        for name in ("CI", "Audit"):
            candidates = [
                r
                for r in runs
                if r["name"] == name
                and r["head_branch"] == "main"
                and r["head_repository"]["full_name"] == REPO
            ]
            if candidates:
                selected[name] = max(candidates, key=lambda r: r["id"])
        status = {n: r["conclusion"] or r["status"] for n, r in selected.items()}
        if status != last:
            print(json.dumps(status), flush=True)
            last = status
        if any(
            r["status"] == "completed" and r["conclusion"] != "success" for r in selected.values()
        ):
            raise RuntimeError("Required verification failed")
        if len(selected) == 2 and all(r["conclusion"] == "success" for r in selected.values()):
            audit = str(selected["Audit"]["id"])
            with Path(os.environ["GITHUB_OUTPUT"]).open("a") as out:
                out.write(f"sha={sha}\naudit_run_id={audit}\n")
            return
        time.sleep(15)
    raise TimeoutError("Required verification did not complete")


if __name__ == "__main__":
    main()
