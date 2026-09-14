"""Check committed image variants and production transport budgets without image tooling."""

import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / "frontend/src/assets.json").read_text())
largest_background = largest_portrait = 0
for source, variants in manifest.items():
    assert (ROOT / "frontend/public" / source.lstrip("/")).is_file(), source
    assert [v["width"] for v in variants] in ([768, 1280, 1672], [256, 512, 1024])
    for variant in variants:
        path = ROOT / "frontend/public" / variant["src"].lstrip("/")
        data = path.read_bytes()
        assert len(data) == variant["bytes"]
        assert hashlib.sha256(data).hexdigest()[:12] in path.name
        assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    maximum = max(v["bytes"] for v in variants)
    if variants[0]["width"] == 768:
        largest_background = max(largest_background, maximum)
    else:
        largest_portrait = max(largest_portrait, maximum)
# A conservative bound includes three small avatars as well as current stage/portrait.
avatars = sum(v[0]["bytes"] for v in manifest.values() if v[0]["width"] == 256)
critical = largest_background + largest_portrait + avatars
assert critical <= 800_000, critical
bundles = list((ROOT / "frontend/dist/assets").glob("*.js"))
assert bundles, "Build the frontend first"
js_bytes = sum(len(gzip.compress(file.read_bytes())) for file in bundles)
# HeroUI migration (#9): approved 160 KB ceiling; measured baseline was ~127 KB
# and the migrated controls/accessible modal are ~153 KB after lite variants.
assert js_bytes <= 160_000, js_bytes
report = {
    "passed": True,
    "critical_image_upper_bound_bytes": critical,
    "production_js_gzip_bytes": js_bytes,
    "images": sum(len(v) for v in manifest.values()),
}
(ROOT / "artifacts").mkdir(exist_ok=True)
(ROOT / "artifacts/product-assets.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
