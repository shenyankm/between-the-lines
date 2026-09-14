"""Reading positions must support every authored story branch."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.routes.game import ReadingInput

SCENES = json.loads((Path(__file__).parents[1] / "app/story-v3.json").read_text())["scenes"]


@pytest.mark.parametrize("key", SCENES)
def test_accepts_every_authored_scene(key):
    assert ReadingInput(key=key, position=len(SCENES[key])).key == key


@pytest.mark.parametrize("key", ["unknown", "act_1_invalid", "dm_unknown"])
def test_rejects_unknown_reading_keys(key):
    with pytest.raises(ValidationError):
        ReadingInput(key=key, position=1)
