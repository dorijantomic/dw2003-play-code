#!/usr/bin/env python3
"""Run the node route census (tools/report_item_routes.mjs) as a build stage.

The census itself is node (it imports the engine's own item tables), so this
stage wrapper just shells out to it with the repo root as cwd.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.exit(subprocess.call(["node", "tools/report_item_routes.mjs"], cwd=str(ROOT)))
