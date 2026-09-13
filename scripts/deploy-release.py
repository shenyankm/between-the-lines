#!/usr/bin/python3
"""Root-owned production entrypoint. Runner gets no Docker group or general sudo."""

import argparse
import fcntl
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from uuid import uuid4

PROJECT = Path("/srv/between-the-lines/current")
STORE = Path("/var/lib/btl-releases")
BACKUPS = Path("/var/backups/between-the-lines")
WORK = Path("/var/lib/btl-runner/_work")
DOCKER = "/usr/bin/docker"
ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "HOME": "/root"}
SHA = re.compile(r"[0-9a-f]{40}")
REVISION = re.compile(r"[A-Za-z0-9_]{1,80}")


def command(args, **kwargs):
    return subprocess.run(args, check=True, env=ENV, timeout=1200, **kwargs)


def output(args):
    return command(args, stdout=subprocess.PIPE, text=True).stdout.strip()


def compose(*args):
    return [
        DOCKER,
        "compose",
        "--project-directory",
        str(PROJECT),
        "-f",
        str(PROJECT / "compose.yaml"),
        "-f",
        str(PROJECT / "compose.server.yaml"),
        *args,
    ]


def atomic_json(path, value):
    tmp = path.with_suffix(".tmp")
    with tmp.open("w") as file:
        tmp.chmod(0o600)
        json.dump(value, file, indent=2)
        file.write("\n")
        file.flush()
        os.fsync(file.fileno())
    tmp.replace(path)


def read_state():
    return json.loads((STORE / "state.json").read_text())


def schema():
    value = output(
        [
            DOCKER,
            "exec",
            "between-the-lines-db-1",
            "psql",
            "-U",
            "btl",
            "-d",
            "btl",
            "-Atc",
            "select version_num from alembic_version",
        ]
    )
    if not REVISION.fullmatch(value):
        raise RuntimeError("Unexpected database migration state")
    return value


def inspect(ref):
    return json.loads(output([DOCKER, "image", "inspect", ref]))[0]


def update_images(images):
    path = PROJECT / ".env"
    text = path.read_text()
    for key, value in [("BTL_API_IMAGE", images["api"]), ("BTL_WEB_IMAGE", images["web"])]:
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", value):
            raise ValueError("Deployment requires immutable image IDs")
        line = f"{key}={value}"
        pattern = rf"^{key}=.*$"
        text = (
            re.sub(pattern, line, text, flags=re.MULTILINE)
            if re.search(pattern, text, re.MULTILINE)
            else text + "\n" + line + "\n"
        )
    temporary = path.with_name(".env.next")
    with temporary.open("w") as file:
        temporary.chmod(0o600)
        file.write(text)
    temporary.replace(path)


def validate_manifest(folder, sha, run_id):
    if not SHA.fullmatch(sha) or not run_id.isdecimal():
        raise ValueError("Invalid release identity")
    path = folder / "manifest.json"
    if path.is_symlink() or path.stat().st_size > 16384:
        raise ValueError("Invalid manifest file")
    data = json.loads(path.read_text())
    if (
        data.get("format") != 1
        or data.get("repository") != "shenyankm/between-the-lines"
        or data.get("sha") != sha
        or data.get("audit_run_id") != run_id
        or not REVISION.fullmatch(str(data.get("schema_revision", "")))
    ):
        raise ValueError("Manifest does not match the approved run")
    if set(data["images"]) != {"api", "web"}:
        raise ValueError("Expected exactly two images")
    for role in ("api", "web"):
        info = data["images"][role]
        if info["ref"] != f"btl-release-{role}:{sha}":
            raise ValueError("Unexpected image name")
        archive = folder / f"{role}.tar.gz"
        if not archive.is_file() or archive.is_symlink() or archive.stat().st_size > 2 * 1024**3:
            raise ValueError("Invalid image archive")
        with archive.open("rb") as file:
            digest = hashlib.file_digest(file, "sha256").hexdigest()
        if digest != info["sha256"]:
            raise ValueError("Image archive checksum mismatch")
    return data


def ingest(folder, sha, run_id):
    source = folder.resolve(strict=True)
    if not source.is_relative_to(WORK):
        raise ValueError("Release must come from the runner workspace")
    validate_manifest(source, sha, run_id)
    # Copy into root-owned storage, then validate the copy as well. Deployment
    # does not execute or source any script/Compose file from the artifact.
    with tempfile.TemporaryDirectory(prefix="incoming-", dir=STORE) as temp:
        dest = Path(temp)
        for name in ("manifest.json", "api.tar.gz", "web.tar.gz"):
            shutil.copyfile(source / name, dest / name, follow_symlinks=False)
        data = validate_manifest(dest, sha, run_id)
        images = {}
        for role in ("api", "web"):
            with gzip.open(dest / f"{role}.tar.gz", "rb") as archive:
                proc = subprocess.Popen(
                    [DOCKER, "load"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, env=ENV
                )
                try:
                    shutil.copyfileobj(archive, proc.stdin)
                    proc.stdin.close()
                    if proc.wait(timeout=300):
                        raise RuntimeError("Docker image import failed")
                finally:
                    if proc.poll() is None:
                        proc.kill()
                        proc.wait()
            image = inspect(data["images"][role]["ref"])
            if (
                image["Architecture"] != "amd64"
                or image["Os"] != "linux"
                or image["Config"].get("Labels", {}).get("org.opencontainers.image.revision") != sha
            ):
                raise ValueError("Imported image provenance mismatch")
            images[role] = image["Id"]
        data["image_ids"] = images
        atomic_json(STORE / f"{sha}.json", data)
        return data


def backup():
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + uuid4().hex[:8]
    path = BACKUPS / (stamp + ".dump")
    with path.open("wb") as file:
        path.chmod(0o600)
        command(
            [DOCKER, "exec", "between-the-lines-db-1", "pg_dump", "-U", "btl", "-d", "btl", "-Fc"],
            stdout=file,
        )
    if path.stat().st_size == 0:
        raise RuntimeError("Empty backup")
    with path.open("rb") as file:
        command(
            [DOCKER, "exec", "-i", "between-the-lines-db-1", "pg_restore", "--list"],
            stdin=file,
            stdout=subprocess.DEVNULL,
        )
    return str(path)


def healthy():
    command(compose("up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "150"))
    for _attempt in range(12):
        try:
            result = output(
                [
                    "/usr/bin/curl",
                    "-fsS",
                    "--max-time",
                    "10",
                    "https://www.openwook.cloud/api/ready",
                ]
            )
            if json.loads(result)["status"] == "ready":
                command(
                    ["/usr/bin/curl", "-fsS", "--max-time", "10", "https://www.openwook.cloud/"],
                    stdout=subprocess.DEVNULL,
                )
                return
        except (subprocess.SubprocessError, ValueError, KeyError):
            pass
        time.sleep(5)
    raise RuntimeError("Public health check failed")


def transition(target, migrate):
    state = read_state()
    prior = state["current"]
    if not migrate and schema() != target["schema_revision"]:
        raise RuntimeError("Rollback refused: target does not support the current schema")
    command(compose("stop", "api"))
    dump = None
    try:
        dump = backup()
        update_images(target["image_ids"])
        if migrate:
            command(
                compose(
                    "run",
                    "--rm",
                    "--no-deps",
                    "--entrypoint",
                    "python",
                    "api",
                    "-m",
                    "alembic",
                    "upgrade",
                    "head",
                )
            )
        if schema() != target["schema_revision"]:
            raise RuntimeError("Unexpected schema after migration")
        healthy()
    except Exception:
        # A snapshot is never silently restored over live player data. Only the
        # previous schema-compatible application can be restarted automatically.
        if schema() == prior["schema_revision"]:
            update_images(prior["image_ids"])
            healthy()
            print("Previous compatible application restored", flush=True)
        else:
            command(compose("stop", "api"))
            print("Schema changed; automatic application rollback refused", flush=True)
        raise
    next_state = {
        "current": target,
        "previous": prior,
        "last_backup": dump,
        "deployed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    atomic_json(STORE / "state.json", next_state)
    print(json.dumps({"release": target["sha"], "healthy": True, "backup": dump}))


def verify_backup():
    path = Path(read_state()["last_backup"])
    if not path.is_relative_to(BACKUPS) or not path.is_file():
        raise ValueError("No managed backup")
    database = "btl_restore_check_" + uuid4().hex[:12]
    command([DOCKER, "exec", "between-the-lines-db-1", "createdb", "-U", "btl", database])
    try:
        with path.open("rb") as file:
            command(
                [
                    DOCKER,
                    "exec",
                    "-i",
                    "between-the-lines-db-1",
                    "pg_restore",
                    "-U",
                    "btl",
                    "-d",
                    database,
                    "--exit-on-error",
                ],
                stdin=file,
            )
        counts = output(
            [
                DOCKER,
                "exec",
                "between-the-lines-db-1",
                "psql",
                "-U",
                "btl",
                "-d",
                database,
                "-Atc",
                "select count(*) from saves; select count(*) from agent_checkpoints.checkpoints;",
            ]
        )
        print(
            json.dumps(
                {"restore_verified": True, "saved_rows_and_checkpoints": counts.splitlines()}
            )
        )
    finally:
        command([DOCKER, "exec", "between-the-lines-db-1", "dropdb", "-U", "btl", database])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "action", choices=["bootstrap", "deploy", "rollback", "status", "verify-backup"]
    )
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--sha", default="")
    parser.add_argument("--run-id", default="")
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise PermissionError("Run through the installed sudo entrypoint")
    os.umask(0o077)
    STORE.mkdir(mode=0o700, parents=True, exist_ok=True)
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (STORE / "deploy.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.action == "bootstrap":
            if (STORE / "state.json").exists():
                raise RuntimeError("Bootstrap already recorded")
            images = {
                r: output([DOCKER, "inspect", f"between-the-lines-{r}-1", "--format", "{{.Image}}"])
                for r in ("api", "web")
            }
            atomic_json(
                STORE / "state.json",
                {
                    "current": {
                        "sha": "bootstrap",
                        "schema_revision": schema(),
                        "image_ids": images,
                    },
                    "previous": None,
                },
            )
        elif args.action == "status":
            print(json.dumps(read_state()))
        elif args.action == "deploy":
            if args.bundle is None:
                raise ValueError("Missing bundle")
            if read_state()["current"]["sha"] == args.sha:
                print("Release already active; checking health without migration")
                healthy()
                return
            transition(ingest(args.bundle, args.sha, args.run_id), migrate=True)
        elif args.action == "rollback":
            target = read_state()["previous"]
            if not target:
                raise RuntimeError("No previous release")
            transition(target, migrate=False)
        else:
            verify_backup()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Exceptions can contain connection details; disclose type, not content.
        print(json.dumps({"deployment_failed": type(error).__name__}), flush=True)
        raise SystemExit(1) from None
