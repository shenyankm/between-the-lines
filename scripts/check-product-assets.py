"""Check committed image variants and production transport budgets without image tooling."""

import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "frontend/src/assets.json").read_text())
largest_background = largest_portrait = largest_ending = 0
for source, variants in manifest.items():
    assert (ROOT / "frontend/public" / source.lstrip("/")).is_file(), source
    ending = source.startswith("/assets/ending-")
    widths = [v["width"] for v in variants]
    if ending:
        # Read PNG IHDR without adding an image-library dependency to CI.
        original = (ROOT / "frontend/public" / source.lstrip("/")).read_bytes()
        native_width = int.from_bytes(original[16:20], "big")
        assert widths == sorted({min(width, native_width) for width in [480, 768, 941]})
    else:
        assert widths in ([768, 1280, 1672], [256, 512, 1024])
    for variant in variants:
        path = ROOT / "frontend/public" / variant["src"].lstrip("/")
        data = path.read_bytes()
        assert len(data) == variant["bytes"]
        assert hashlib.sha256(data).hexdigest()[:12] in path.name
        assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    maximum = max(v["bytes"] for v in variants)
    if ending:
        largest_ending = max(largest_ending, maximum)
    elif variants[0]["width"] == 768:
        largest_background = max(largest_background, maximum)
    else:
        largest_portrait = max(largest_portrait, maximum)
# A conservative bound includes three small avatars as well as current stage/portrait.
avatars = sum(v[0]["bytes"] for v in manifest.values() if v[0]["width"] == 256)
critical = largest_background + largest_portrait + avatars
assert critical <= 800_000, critical
assert largest_ending <= 800_000, largest_ending
bundles = list((ROOT / "frontend/dist/assets").glob("*.js"))
assert bundles, "Build the frontend first"
js_bytes = sum(len(gzip.compress(file.read_bytes())) for file in bundles)
# Product transport budget: at most 1 MB of gzip-compressed JavaScript.
assert js_bytes <= 1_000_000, js_bytes
report = {
    "passed": True,
    "critical_image_upper_bound_bytes": critical,
    "ending_image_upper_bound_bytes": largest_ending,
    "production_js_gzip_bytes": js_bytes,
    "images": sum(len(v) for v in manifest.values()),
}
(ROOT / "artifacts").mkdir(exist_ok=True)
(ROOT / "artifacts/product-assets.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
