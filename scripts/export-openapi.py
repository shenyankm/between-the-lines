"""Run with Miniconda Python from the repository root."""

import importlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
app = importlib.import_module("app.main").app

(root / "backend/openapi.json").write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2))
