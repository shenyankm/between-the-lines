"""Stable reviewed-source fingerprint shared with the offline moderation CLI."""

import hashlib
import json
from typing import Any


def content_hash(row: Any) -> str:
    fields = ("title", "summary", "source_url", "author_name", "topics")
    value = {key: row[key] if isinstance(row, dict) else getattr(row, key) for key in fields}
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()
