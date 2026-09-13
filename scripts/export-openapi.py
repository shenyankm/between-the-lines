"""Export the deterministic development contract without starting application I/O."""

import argparse
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "backend"))
from app.config import Settings  # noqa: E402 - add the backend source root before importing
from app.factory import create_app  # noqa: E402 - same source-root bootstrap
from app.story import load_story  # noqa: E402 - source-root bootstrap

parser = argparse.ArgumentParser()
parser.add_argument("--output", type=Path, default=root / "backend/openapi.json")
parser.add_argument("--story-output", type=Path, default=root / "frontend/src/testing/story.json")
parser.add_argument("--story-version", type=int, choices=[1, 2, 3], default=1)
args = parser.parse_args()
app = create_app(Settings(_env_file=None, environment="test", agent_mode="mock"))
args.output.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2))

args.story_output.write_text(
    json.dumps(
        load_story(args.story_version).public().model_dump(exclude_none=True),
        ensure_ascii=False,
        indent=2,
    )
    + "\n"
)
