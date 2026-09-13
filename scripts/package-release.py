"""Package already-scanned images from this exact GitHub commit; no production secrets."""

import argparse
import gzip
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path

DOCKER = shutil.which("docker") or "/usr/bin/docker"


def run(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()


def package(out: Path, sha: str, run_id: str, api: str, web: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or not run_id.isdecimal():
        raise ValueError("Invalid release identity")
    if run("git", "rev-parse", "HEAD") != sha:
        raise ValueError("Release must match checkout")
    out.mkdir(parents=True, exist_ok=False)
    manifest = {
        "format": 1,
        "repository": "shenyankm/between-the-lines",
        "sha": sha,
        "audit_run_id": run_id,
        "images": {},
    }
    for role, source in (("api", api), ("web", web)):
        ref = f"btl-release-{role}:{sha}"
        subprocess.run([DOCKER, "tag", source, ref], check=True)
        info = json.loads(run("docker", "image", "inspect", ref))[0]
        if info["Architecture"] != "amd64" or info["Os"] != "linux":
            raise ValueError("Release requires linux/amd64")
        if info["Config"].get("Labels", {}).get("org.opencontainers.image.revision") != sha:
            raise ValueError("Missing immutable source label")
        archive = out / f"{role}.tar.gz"
        with gzip.open(archive, "wb", compresslevel=1) as dest:
            proc = subprocess.Popen([DOCKER, "save", ref], stdout=subprocess.PIPE)
            assert proc.stdout
            for chunk in iter(lambda stream=proc.stdout: stream.read(1024 * 1024), b""):
                dest.write(chunk)
            if proc.wait() != 0:
                raise RuntimeError("Image export failed")
        with archive.open("rb") as file:
            digest = hashlib.file_digest(file, "sha256").hexdigest()
        manifest["images"][role] = {
            "ref": ref,
            "sha256": digest,
        }
    head = run("docker", "run", "--rm", "--entrypoint", "python", api, "-m", "alembic", "heads")
    revisions = re.findall(r"^(\w+) \(head\)$", head, re.MULTILINE)
    if len(revisions) != 1:
        raise ValueError("Expected a single migration head")
    manifest["schema_revision"] = revisions[0]
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"sha": sha, "schema_revision": revisions[0], "packaged": True}))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--sha", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--api", default="btl-api-audit")
    p.add_argument("--web", default="btl-web-audit")
    a = p.parse_args()
    package(a.out, a.sha, a.run_id, a.api, a.web)
