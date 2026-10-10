"""Guard tests for the PreToolUse research hook.

The destructive-command cases exist because nothing stopped an overbroad
`rm -rf` from destroying 2,132 tracked files in this repository on 2026-08-07.
The lead path checked only corpus-scan patterns, so every deletion shape reached
the normal permission flow with no file list and no confirmation.

Positive controls matter as much as the blocks here: a guard that also blocks
`git commit` or the build would just be routed around, which is how the real
protection gets lost.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

GUARD = Path(__file__).resolve().parents[1] / ".claude/hooks/research_guard.py"
ROOT = str(Path(__file__).resolve().parents[1])


def guard(command: str, mode: str = "lead") -> int:
    payload = {"tool_name": "Bash", "tool_input": {"command": command}, "cwd": ROOT}
    completed = subprocess.run(
        [sys.executable, str(GUARD), mode],
        input=json.dumps(payload), text=True, capture_output=True,
    )
    return completed.returncode


class DestructiveCommandGuardTests(unittest.TestCase):
    BLOCK = (
        "rm -rf docs",
        "rm -rf /home/dorij/ddw3-walker/web",
        "rm -r recovered",
        "rm -rf .",
        "rm -rf *",
        "git clean -fdx",
        "git clean -fd",
        "git reset --hard origin/master",
        "git checkout -- .",
        "find docs -name '*.json' -delete",
    )
    ALLOW = (
        "rm -rf /tmp/claude-1000/x/scratchpad",
        "rm -rf /tmp/build",
        "rm -rf node_modules",
        "rm web/tmpfile.js",
        "git status --short",
        "git commit -m 'message'",
        "npm run build:engine",
        "./dw3-research handoff-check",
        ".venv/bin/python3 build_all.py --dry-run",
        "node --test tests/assets.test.js",
        "git diff --check",
    )

    def test_bulk_deletion_is_blocked_for_the_lead(self) -> None:
        for command in self.BLOCK:
            with self.subTest(command=command):
                self.assertEqual(guard(command), 2)

    def test_ordinary_work_is_not_blocked(self) -> None:
        for command in self.ALLOW:
            with self.subTest(command=command):
                self.assertEqual(guard(command), 0)

    def test_read_only_workers_cannot_delete_at_all(self) -> None:
        """Workers run against an executable allowlist, so `rm` never reaches the guard's
        destructive branch -- but assert it, so relaxing the allowlist cannot silently
        hand deletion back to a read-only researcher."""
        for command in ("rm -rf docs", "git clean -fdx", "rm web/game.js"):
            with self.subTest(command=command):
                self.assertEqual(guard(command, mode="static"), 2)


def run_guard(payload: dict, mode: str = "lead") -> int:
    completed = subprocess.run(
        [sys.executable, str(GUARD), mode],
        input=json.dumps(payload), text=True, capture_output=True,
    )
    return completed.returncode


class GrokHarnessGuardTests(unittest.TestCase):
    def test_grok_bash_payload_blocks_bulk_delete(self) -> None:
        self.assertEqual(run_guard({
            "toolName": "run_terminal_command",
            "toolInput": {"command": "rm -rf docs"},
            "cwd": ROOT,
        }), 2)

    def test_grok_read_file_requires_limit_on_large_files(self) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as handle:
            handle.write("\n".join(f"line {i}" for i in range(200)))
            path = handle.name
        unbounded = {
            "toolName": "read_file",
            "toolInput": {"target_file": path},
            "cwd": ROOT,
        }
        self.assertEqual(run_guard(unbounded), 2)
        sliced = {
            "toolName": "read_file",
            "toolInput": {"target_file": path, "limit": 80},
            "cwd": ROOT,
        }
        self.assertEqual(run_guard(sliced), 0)

    def test_claude_non_bulk_read_without_limit_still_allowed(self) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as handle:
            handle.write("\n".join(f"line {i}" for i in range(200)))
            path = handle.name
        self.assertEqual(run_guard({
            "tool_name": "Read",
            "tool_input": {"file_path": path},
            "cwd": ROOT,
        }), 0)


if __name__ == "__main__":
    unittest.main()
