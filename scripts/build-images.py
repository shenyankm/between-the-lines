"""Rebuild responsive, content-addressed WebP files from retained PNG masters.

Run with a Python interpreter providing Pillow; never rewrites source assets.
"""

import hashlib
import io
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
assets = ROOT / "frontend/public/assets"
manifest = {}
for source in sorted(assets.glob("*.png")):
    if source.stem == "brand-logo":
        continue  # The logo has a separate fixed-size rendering path.
    character = source.stem.split("-")[0] in {"sun", "li", "zhang", "zhou"}
    variants = []
    with Image.open(source) as image:
        for width in [256, 512, 1024] if character else [768, 1280, 1672]:
            height = round(image.height * width / image.width)
            resized = image.resize((width, height), Image.Resampling.LANCZOS)
            stream = io.BytesIO()
            resized.save(stream, format="WEBP", quality=82, method=6)
            data = stream.getvalue()
            name = f"{source.stem}-{width}-{hashlib.sha256(data).hexdigest()[:12]}.webp"
            (assets / name).write_bytes(data)
            variants.append({"width": width, "src": f"/assets/{name}", "bytes": len(data)})
    manifest[f"/assets/{source.name}"] = variants
(ROOT / "frontend/src/assets.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(
    json.dumps(
        {name: [v["bytes"] for v in variants] for name, variants in manifest.items()},
        indent=2,
    )
)
