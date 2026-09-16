"""Exercise the documented release command on disposable copies of repository files."""

import json
import runpy
import shutil
import sys
import tomllib
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit


def test_release_updates_both_manifests_and_changelog(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    for name in (
        "scripts/bump-version.py",
        "backend/pyproject.toml",
        "frontend/package.json",
        "CHANGELOG.md",
    ):
        destination = tmp_path / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / name, destination)
    script = tmp_path / "scripts/bump-version.py"
    monkeypatch.setattr(sys, "argv", [str(script), "0.2.0"])
    with pytest.raises(SystemExit) as result:
        runpy.run_path(str(script), run_name="__main__")
    assert result.value.code == 0
    backend = tomllib.loads((tmp_path / "backend/pyproject.toml").read_text())
    frontend = json.loads((tmp_path / "frontend/package.json").read_text())
    assert backend["project"]["version"] == frontend["version"] == "0.2.0"
    assert "## 0.2.0 - unreleased" in (tmp_path / "CHANGELOG.md").read_text()
