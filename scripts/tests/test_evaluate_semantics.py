"""The shared runner selects each version without exposing private history."""

import importlib.util
import json
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("evaluate", ROOT / "scripts/evaluate-semantics.py")
assert SPEC and SPEC.loader
evaluate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evaluate)


class SemanticVersions(unittest.IsolatedAsyncioTestCase):
    async def test_versioned_world_and_context(self):
        for version in (2, 3):
            with self.subTest(version=version):
                sample = json.loads((ROOT / f"backend/evals/semantic-v{version}.json").read_text())[
                    0
                ]
                world = evaluate.World(sample, version)
                context = await world.context_for(SimpleNamespace(id="evaluation"))
                self.assertEqual(world.state.story_version, version)
                self.assertEqual(world.state.act, sample["act"])
                self.assertEqual(context.story_version, version)
                self.assertEqual(context.checkpoint_namespace, "evaluation")
                self.assertNotIn("PRIVATE_SENTINEL_9Q", context.model_dump_json())
