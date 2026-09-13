#!/usr/bin/python3
"""Download a GitHub release artifact with bounded parallel ranges on slow links."""

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import shutil
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

REPO = "shenyankm/between-the-lines"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api(path):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/{path}",
        headers={
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
        },
    )
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 302:
            url = error.headers["Location"]
            if not url.startswith("https://"):
                raise ValueError("Expected HTTPS artifact storage") from None
            return url
        raise RuntimeError(f"GitHub API status {error.code}") from None


def download(url, path, size):
    if not url.startswith("https://"):
        raise ValueError("Expected HTTPS storage URL")
    # Signed storage URL is never logged and never receives the GitHub token.
    chunk_size = 2 * 1024 * 1024
    with path.open("wb") as file:
        file.truncate(size)
    fd = os.open(path, os.O_WRONLY)

    def chunk(start):
        end = min(start + chunk_size, size) - 1
        for attempt in range(4):
            try:
                request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})  # noqa: S310 - HTTPS checked above
                with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - HTTPS URL from authenticated GitHub API
                    if (
                        response.status != 206
                        or response.headers.get("Content-Range") != f"bytes {start}-{end}/{size}"
                    ):
                        raise ValueError("Storage did not honor the requested range")
                    data = response.read(end - start + 2)
                if len(data) != end - start + 1:
                    raise ValueError("Incomplete artifact range")
                position = 0
                while position < len(data):
                    position += os.pwrite(fd, data[position:], start + position)
                return len(data)
            except (OSError, ValueError):
                if attempt == 3:
                    raise RuntimeError("Artifact range download failed") from None
                time.sleep(attempt + 1)
        return 0

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
            total = 0
            last = 0
            for count in pool.map(chunk, range(0, size, chunk_size)):
                total += count
                progress = total * 100 // size
                if progress >= last + 10:
                    print(f"Artifact downloaded: {progress}%", flush=True)
                    last = progress
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sha", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.sha) or not args.run_id.isdecimal():
        raise ValueError("Invalid release identity")
    artifacts = api(f"actions/runs/{args.run_id}/artifacts?per_page=100")["artifacts"]
    candidates = [a for a in artifacts if a["name"] == f"release-{args.sha}" and not a["expired"]]
    if len(candidates) != 1:
        raise ValueError("Expected exactly one unexpired release")
    artifact = candidates[0]
    digest = artifact.get("digest", "")
    if (
        not re.fullmatch(r"sha256:[0-9a-f]{64}", digest)
        or not 0 < artifact["size_in_bytes"] < 2 * 1024**3
    ):
        raise ValueError("Artifact lacks a trusted digest or valid size")
    url = api(f"actions/artifacts/{artifact['id']}/zip")
    args.out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="release-fetch-", dir=args.out.parent) as temp:
        archive = Path(temp) / "release.zip"
        download(url, archive, artifact["size_in_bytes"])
        with archive.open("rb") as file:
            if "sha256:" + hashlib.file_digest(file, "sha256").hexdigest() != digest:
                raise ValueError("Artifact digest mismatch")
        with zipfile.ZipFile(archive) as bundle:
            if sorted(bundle.namelist()) != ["api.tar.gz", "manifest.json", "web.tar.gz"]:
                raise ValueError("Unexpected artifact contents")
            for name in bundle.namelist():
                target = args.out / name
                if target.is_symlink():
                    raise ValueError("Refusing symlink output")
                with bundle.open(name) as source, target.open("wb") as dest:
                    shutil.copyfileobj(source, dest)
    print("Verified release artifact downloaded", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"download_failed": type(error).__name__}), flush=True)
        raise SystemExit(1) from None
