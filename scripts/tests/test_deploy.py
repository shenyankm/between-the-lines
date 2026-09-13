"""Release integrity and rollback boundaries, without touching Docker or production."""

import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "deploy", Path(__file__).parents[1] / "deploy-release.py"
)
assert SPEC and SPEC.loader
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.sha = "a" * 40
        self.manifest = {
            "format": 1,
            "repository": "shenyankm/between-the-lines",
            "sha": self.sha,
            "audit_run_id": "12",
            "schema_revision": "0007",
            "images": {},
        }
        for role in ("api", "web"):
            data = role.encode()
            (self.path / f"{role}.tar.gz").write_bytes(data)
            self.manifest["images"][role] = {
                "ref": f"btl-release-{role}:{self.sha}",
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        (self.path / "manifest.json").write_text(json.dumps(self.manifest))

    def test_identity_and_archive_integrity(self):
        self.assertEqual(deploy.validate_manifest(self.path, self.sha, "12"), self.manifest)
        with self.assertRaises(ValueError):
            deploy.validate_manifest(self.path, self.sha, "13")
        (self.path / "api.tar.gz").write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            deploy.validate_manifest(self.path, self.sha, "12")

    def test_symlink_archive_is_rejected(self):
        (self.path / "api.tar.gz").unlink()
        (self.path / "api.tar.gz").symlink_to(self.path / "web.tar.gz")
        with self.assertRaises(ValueError):
            deploy.validate_manifest(self.path, self.sha, "12")

    def test_environment_preserves_quoted_values(self):
        secret_line = "EXAMPLE_VALUE='spaces and # punctuation'\n"
        (self.path / ".env").write_text(secret_line + "BTL_API_IMAGE=old\n")
        with patch.object(deploy, "PROJECT", self.path):
            deploy.update_images({"api": "sha256:" + "1" * 64, "web": "sha256:" + "2" * 64})
        self.assertTrue((self.path / ".env").read_text().startswith(secret_line))
        self.assertEqual((self.path / ".env").stat().st_mode & 0o777, 0o600)

    def test_incompatible_rollback_never_stops_application(self):
        with (
            patch.object(deploy, "read_state", return_value={"current": {}}),
            patch.object(deploy, "schema", return_value="0008"),
            patch.object(deploy, "command") as command,
        ):
            with self.assertRaises(RuntimeError):
                deploy.transition({"schema_revision": "0007"}, migrate=False)
            command.assert_not_called()

    def test_failed_health_restores_previous_images_without_advancing_ledger(self):
        prior = {"schema_revision": "0007", "image_ids": {"api": "old", "web": "old"}}
        target = {"schema_revision": "0007", "image_ids": {"api": "new", "web": "new"}}
        with (
            patch.object(deploy, "read_state", return_value={"current": prior}),
            patch.object(deploy, "schema", return_value="0007"),
            patch.object(deploy, "command"),
            patch.object(deploy, "backup", return_value="backup"),
            patch.object(deploy, "update_images") as update,
            patch.object(deploy, "healthy", side_effect=[RuntimeError("unhealthy"), None]),
            patch.object(deploy, "atomic_json") as ledger,
        ):
            with self.assertRaises(RuntimeError):
                deploy.transition(target, migrate=True)
            self.assertEqual(update.call_args_list[-1].args[0], prior["image_ids"])
            ledger.assert_not_called()


if __name__ == "__main__":
    unittest.main()
