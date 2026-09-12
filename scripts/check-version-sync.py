"""Fail when the backend and frontend versions disagree.

Both files hardcode a version that has never been bumped. A one-sided bump is
the failure mode this catches: it produces a deploy where the two artifacts
claim different identities and no rollback target is unambiguous.

Run from the repository root: python scripts/check-version-sync.py
"""

from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def backend_version() -> str:
    with (REPO_ROOT / "backend" / "pyproject.toml").open("rb") as handle:
        return tomllib.load(handle)["project"]["version"]


def frontend_version() -> str:
    payload = json.loads((REPO_ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    return payload["version"]


def main() -> int:
    backend = backend_version()
    frontend = frontend_version()
    if backend != frontend:
        print(
            f"version mismatch: backend/pyproject.toml={backend} "
            f"frontend/package.json={frontend}\n"
            "Use 'make release V=<version>' to bump both together.",
            file=sys.stderr,
        )
        return 1
    if not re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?", backend):
        print(f"version {backend!r} is not semver", file=sys.stderr)
        return 1
    print(f"version in sync: {backend}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
