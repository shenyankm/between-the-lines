"""Compare generated artifacts in a temporary directory; never rewrite the checkout."""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("kind", choices=["contract", "lock"])
args = parser.parse_args()
with tempfile.TemporaryDirectory(prefix="btl-check-") as directory:
    output = Path(directory)
    if args.kind == "contract":
        subprocess.run(
            [
                sys.executable,
                str(root / "scripts/export-openapi.py"),
                "--output",
                str(output / "openapi.json"),
                "--story-output",
                str(output / "story.json"),
            ],
            check=True,
        )
        pnpm = ["corepack", "pnpm"] if shutil.which("corepack") else ["pnpm"]
        subprocess.run(
            [
                *pnpm,
                "exec",
                "openapi-typescript",
                str(output / "openapi.json"),
                "-o",
                str(output / "api.d.ts"),
            ],
            cwd=root / "frontend",
            check=True,
        )
        pairs = [
            (output / "story.json", root / "frontend/src/testing/story.json"),
            (output / "openapi.json", root / "backend/openapi.json"),
            (output / "api.d.ts", root / "frontend/src/generated/api.d.ts"),
        ]
    else:
        subprocess.run(
            [shutil.which("uv") or "uv", "lock", "--project", str(root / "backend"), "--check"],
            check=True,
        )
        subprocess.run(
            [
                shutil.which("uv") or "uv",
                "export",
                "--project",
                str(root / "backend"),
                "--frozen",
                "--no-emit-project",
                "--format",
                "requirements-txt",
                "--output-file",
                str(output / "requirements.lock"),
                "--quiet",
            ],
            check=True,
        )
        pairs = [(output / "requirements.lock", root / "backend/requirements.lock")]
    for generated, saved in pairs:
        actual, expected = generated.read_bytes(), saved.read_bytes()
        if args.kind == "lock":
            # uv records its output path in this informational command header.
            # Only that line differs when exporting outside the checkout.
            actual = b"\n".join(actual.split(b"\n")[:1] + actual.split(b"\n")[2:])
            expected = b"\n".join(expected.split(b"\n")[:1] + expected.split(b"\n")[2:])
        if actual != expected:
            raise SystemExit(
                f"Generated artifact drift: {saved.relative_to(root)}; run the explicit generation command."
            )
print(f"{args.kind}: no drift; checkout unchanged")
