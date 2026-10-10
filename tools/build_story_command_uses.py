#!/usr/bin/env python3
"""Rewrite the story-command census snapshot from the shipped scenes.

`data/story-command-uses.json` is the golden `tests/lane-b/story-command-dispatch.test.js`
diffs against, and `tools/story-command-census.mjs` builds it out of
`web/assets/engine-content.json` (the converted event rows) plus `web/assets/data/story_steps.json`.
Neither input is hand-written, so the snapshot has a producing build_all stage: without one a
generator change regenerated the scenes but left the census describing the old ones -- which is
exactly what 374b9e3a did, costing that test until someone re-ran the census by hand.

The census itself is node (it walks the converted event rows the way the test does), and
build_all only runs python stages, so this wrapper is the stage body. Run standalone with
`.venv/bin/python3 tools/build_story_command_uses.py`.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

sys.exit(subprocess.call(["node", "tools/story-command-census.mjs", "--write"], cwd=str(ROOT)))