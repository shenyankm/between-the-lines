"""Bump the backend and frontend versions together.

Keeping the two in lockstep is what makes a git tag an unambiguous rollback
target; scripts/check-version-sync.py enforces it in CI.

Run from the repository root: python scripts/bump-version.py 0.2.0
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$")


def bump_pyproject(version: str) -> None:
    path = REPO_ROOT / "backend" / "pyproject.toml"
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'^(version = ")[^"]*(")$',
        rf"\g<1>{version}\g<2>",
        text,
        count=1,
        flags=re.MULTILINE,
    )
    if count != 1:
        raise SystemExit(f"could not find a version field in {path}")
    path.write_text(updated, encoding="utf-8")


def bump_package_json(version: str) -> None:
    path = REPO_ROOT / "frontend" / "package.json"
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'^(\s*"version": ")[^"]*(")$',
        rf"\g<1>{version}\g<2>",
        text,
        count=1,
        flags=re.MULTILINE,
    )
    if count != 1:
        raise SystemExit(f"could not find a version field in {path}")
    path.write_text(updated, encoding="utf-8")


def prepend_changelog_stub(version: str) -> None:
    path = REPO_ROOT / "CHANGELOG.md"
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    marker = "<!-- next -->"
    stub = f"{marker}\n\n## {version} - unreleased\n\n- _fill in_\n"
    if marker in text:
        path.write_text(text.replace(marker, stub, 1), encoding="utf-8")
    else:
        path.write_text(
            text.rstrip("\n") + "\n\n" + stub.replace(marker + "\n\n", ""), encoding="utf-8"
        )


def main(argv: list[str]) -> int:
    if len(argv) != 2 or not SEMVER.match(argv[1]):
        print("usage: python scripts/bump-version.py <semver>", file=sys.stderr)
        return 2
    version = argv[1]
    bump_pyproject(version)
    bump_package_json(version)
    prepend_changelog_stub(version)
    print(f"bumped backend and frontend to {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
