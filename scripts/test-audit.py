"""Exercise the actual audit shell gates, including failures and intentional skips."""

import itertools
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = yaml.safe_load((ROOT / ".github/workflows/audit.yml").read_text())


class AuditGates(unittest.TestCase):
    def test_aggregate_requires_every_applicable_scan(self):
        script = WORKFLOW["jobs"]["audit"]["steps"][0]["run"]
        self.assertEqual(
            set(WORKFLOW["jobs"]["audit"]["needs"]), {"secrets", "dependencies", "images"}
        )
        for secrets, dependencies, images, required in itertools.product(
            ("success", "failure", "cancelled"),
            ("success", "failure", "skipped"),
            ("success", "failure", "skipped"),
            ("true", "false"),
        ):
            with self.subTest(
                secrets=secrets, dependencies=dependencies, images=images, required=required
            ):
                result = subprocess.run(
                    ["/bin/sh", "-e", "-c", script],
                    env={
                        **os.environ,
                        "SECRETS_RESULT": secrets,
                        "DEPENDENCIES_RESULT": dependencies,
                        "IMAGES_RESULT": images,
                        "IMAGES_REQUIRED": required,
                    },
                    check=False,
                )
                expected = secrets == dependencies == "success" and images == (
                    "success" if required == "true" else "skipped"
                )
                self.assertEqual(result.returncode == 0, expected)

    def test_both_images_are_scanned_even_when_one_fails(self):
        script = next(
            step["run"]
            for step in WORKFLOW["jobs"]["images"]["steps"]
            if step.get("name") == "Scan images"
        )
        for failing in ("btl-api-audit", "btl-web-audit", "none"):
            with self.subTest(failing=failing), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                scanner = root / "trivy"
                scanner.write_text(
                    '#!/bin/sh\necho "$*" >> "$BTL_CALLS"\n'
                    'case "$*" in *"$BTL_FAIL"*) exit 1;; esac\nexit 0\n'
                )
                scanner.chmod(0o755)
                result = subprocess.run(
                    ["/bin/sh", "-e", "-c", script],
                    cwd=root,
                    env={
                        **os.environ,
                        "PATH": f"{root}:{os.environ['PATH']}",
                        "BTL_CALLS": str(root / "calls"),
                        "BTL_FAIL": failing,
                    },
                    check=False,
                )
                calls = (root / "calls").read_text().splitlines()
                self.assertEqual(len(calls), 2)
                self.assertIn("btl-api-audit", calls[0])
                self.assertIn("btl-web-audit", calls[1])
                self.assertEqual(result.returncode == 0, failing == "none")


if __name__ == "__main__":
    unittest.main()
