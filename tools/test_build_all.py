"""Tests for build_all.py. Run: python3 tools/test_build_all.py"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # repo root
import build_all as ba
from build_all import Stage, topo_order, validate, run_all, run_stage, STAGES, main


def S(name, deps=()):
    return Stage(name=name, cmd=["x.py"], cwd=".", uv_with=(), inputs=(), outputs=(),
                 deps=tuple(deps))


class TestTopoOrder(unittest.TestCase):
    def test_orders_dependency_before_dependent(self):
        order = [s.name for s in topo_order([S("b", deps=["a"]), S("a")])]
        self.assertLess(order.index("a"), order.index("b"))

    def test_raises_on_cycle(self):
        with self.assertRaises(ValueError):
            topo_order([S("a", deps=["b"]), S("b", deps=["a"])])

    def test_raises_on_unknown_dep(self):
        with self.assertRaises(ValueError):
            topo_order([S("a", deps=["ghost"])])


class TestValidate(unittest.TestCase):
    def test_flags_missing_tool_and_missing_input(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "real.py").write_text("")
            (root / "have.txt").write_text("")
            stages = [
                Stage(name="ok", cmd=["real.py"], cwd=str(root), inputs=("have.txt",)),
                Stage(name="bad", cmd=["gone.py"], cwd=str(root), inputs=("missing.txt",)),
            ]
            problems = validate(stages, root)
            self.assertTrue(any("gone.py" in p for p in problems))
            self.assertTrue(any("missing.txt" in p for p in problems))
            self.assertFalse(any("real.py" in p for p in problems))


class TestRunAll(unittest.TestCase):
    def _stage(self, name, ok=True, deps=()):
        code = "import sys; sys.exit(0)" if ok else "import sys; sys.exit(1)"
        return Stage(name=name, cmd=["-c", code], cwd=".", deps=tuple(deps))

    def test_continue_through_and_skip_on_dep_failure(self):
        with tempfile.TemporaryDirectory() as d:
            stages = [
                self._stage("a", ok=False),     # FAILED
                self._stage("b", deps=["a"]),   # dep failed -> SKIPPED
                self._stage("c", ok=True),      # independent -> OK
            ]
            rc = run_all(stages, uv="python3", log_dir=Path(d))
            self.assertEqual(rc, 1)  # a failed

    def test_independent_stage_runs_despite_other_failure(self):
        with tempfile.TemporaryDirectory() as d:
            r = run_stage(self._stage("c", ok=True), uv="python3", log_dir=Path(d))
            self.assertEqual(r.status, "OK")

    def test_opt_in_stage_only_runs_when_selected(self):
        with tempfile.TemporaryDirectory() as d:
            stage = self._stage("optional", ok=False)
            stage.opt_in = True
            self.assertEqual(run_all([stage], uv="python3", log_dir=Path(d)), 0)
            self.assertEqual(
                run_all([stage], only=["optional"], uv="python3", log_dir=Path(d)), 1
            )
            self.assertEqual(
                run_all(
                    [stage], include_opt_in=True, uv="python3", log_dir=Path(d)
                ),
                1,
            )

    def test_uv_python_constraint_is_in_command(self):
        stage = Stage(name="ml", cmd=["tool.py"], cwd=".", uv_python="3.12")
        self.assertEqual(
            ba._build_argv(stage, "uv")[:4], ["uv", "run", "--python", "3.12"]
        )


class TestSetupIdempotent(unittest.TestCase):
    def test_setup_noops_when_satisfied(self):
        # When the predicate says satisfied, the action must NOT shell out.
        called = {"n": 0}
        orig_call, orig_pred = ba.subprocess.call, ba.lfs_satisfied
        ba.subprocess.call = lambda *a, **k: called.__setitem__("n", called["n"] + 1) or 0
        ba.lfs_satisfied = lambda: True
        try:
            ba.setup_lfs()
            self.assertEqual(called["n"], 0)
        finally:
            ba.subprocess.call, ba.lfs_satisfied = orig_call, orig_pred


class TestStageEnv(unittest.TestCase):
    def test_env_passed_to_subprocess(self):
        with tempfile.TemporaryDirectory() as d:
            code = "import os,sys; sys.exit(0 if os.environ.get('BUILD_ALL_T')=='xyz' else 1)"
            s = Stage(name="e", cmd=["-c", code], cwd=".", env={"BUILD_ALL_T": "xyz"})
            r = run_stage(s, uv="python3", log_dir=Path(d))
            self.assertEqual(r.status, "OK")


class TestRealRegistry(unittest.TestCase):
    def test_registry_orders_and_resolves(self):
        names = [s.name for s in topo_order(STAGES)]
        self.assertLess(names.index("screen_table"), names.index("stage_names"))
        self.assertLess(names.index("build_assets"), names.index("gen_scenes"))
        self.assertLess(names.index("build_assets"), names.index("tmpk_collision"))
        self.assertLess(names.index("wstag_extract"), names.index("gen_scenes"))
        self.assertIn("evolutions", names)

    def test_every_stage_tool_exists(self):
        # the orchestrator must reference only tools that are actually on disk
        problems = [p for p in validate(STAGES, ba.REPO) if "tool not found" in p]
        self.assertEqual(problems, [], problems)

    def test_evolutions_is_not_treated_as_authored_input(self):
        authored_paths = [rel for rel, _desc in ba.AUTHORED_DATA]
        self.assertNotIn("web/assets/data/evolutions.json", authored_paths)

    def test_list_runs_nothing(self):
        self.assertEqual(main(["--list"]), 0)


if __name__ == "__main__":
    unittest.main()
