"""The launcher's HD Remaster choice and its background job (no GPU: the job is a tiny stand-in script)."""
from __future__ import annotations

import importlib.util
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("dw2003_launcher", ROOT / "launcher" / "dw2003.py")
dw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dw)

FAKE_OK = ("import pathlib,sys;a=pathlib.Path(sys.argv[1]);"
           "(a/'build/logs').mkdir(parents=True,exist_ok=True);"
           "(a/'build/logs/upscale_assets.log').write_text('[1/4] a.png: current\\n[3/4] b.png: 8x8 -> 32x32\\n');"
           "(a/'web/assets-hd').mkdir(parents=True,exist_ok=True);(a/'web/assets-hd/manifest.json').write_text('{}')")
FAKE_BAD = "import sys;print('upscale_assets: FAILED boom');sys.exit(3)"


class HdChoiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        self.app = root / "app"
        self.app.mkdir()
        self.b = dw.Build(root / "data", {"python": sys.executable, "path": [], "extractors": Path(".")}, self.app)
        self.b.HD_POLL = 0.05
        self.b.state = "done"                       # the game is playable
        which = mock.patch.object(dw.shutil, "which", return_value=sys.executable)
        which.start()
        self.addCleanup(which.stop)

    def tearDown(self):
        # never leave the stand-in job (or a real one) running after a test
        proc = self.b.hd_proc
        if proc is not None and proc.poll() is None:
            proc.kill()
            proc.wait(10)

    def wait(self, want):
        for _ in range(200):
            if self.b.hd["state"] in want:
                return
            time.sleep(0.05)
        self.fail(f"hd state stayed {self.b.hd['state']}")

    def use(self, code):
        self.b.hd_argv = lambda: ["-c", code, str(self.app)]

    def test_ticked_by_default_and_remembered(self):
        self.assertTrue(self.b.hd_status()["enabled"])
        self.b.hd_auto = False
        self.b.hd_set(False)
        self.assertFalse(dw.Build(self.b.data, self.b.tools, self.app).hd_enabled())   # a fresh launch reads state.json
        self.assertFalse(self.b.status()["hd"]["enabled"])

    def test_real_job_is_the_hidden_upscale_stage(self):
        self.assertEqual(dw.Build.hd_argv(self.b), ["build_all.py", "--only", "upscale_assets"])

    def test_does_not_start_before_playable_or_when_off(self):
        self.use(FAKE_OK)
        self.b.state = "building"
        self.b.hd_start()
        self.assertEqual(self.b.hd["state"], "none")
        self.b.state = "done"
        self.b._save(hd=False)
        self.b.hd_start()
        self.assertEqual(self.b.hd["state"], "none")

    def test_background_run_reports_progress_and_resumes_once(self):
        self.use(FAKE_OK)
        self.b.hd_start()
        self.assertEqual(self.b.hd["state"], "running")
        self.wait({"done", "failed"})
        st = self.b.status()["hd"]
        self.assertEqual((st["state"], st["done"], st["total"], st["progress"]), ("done", 3, 4, 100.0))
        self.assertEqual(self.b.state, "done")
        self.use(FAKE_BAD)                                  # a finished pack is not started again
        self.b.hd["state"] = "none"
        self.b.hd_start()
        self.assertEqual(self.b.hd["state"], "done")

    def test_failure_shows_the_error_and_the_game_stays_playable(self):
        self.use(FAKE_BAD)
        self.b.hd_start()
        self.wait({"done", "failed"})
        st = self.b.status()
        self.assertEqual(st["hd"]["state"], "failed")
        self.assertIn("exit code 3", st["hd"]["error"])
        self.assertIn("boom", st["hd"]["error"])
        self.assertEqual(st["state"], "done")

    def test_missing_uv_is_an_error_not_a_crash(self):
        self.use(FAKE_OK)
        with mock.patch.object(dw.shutil, "which", return_value=None), \
                mock.patch.object(dw.Path, "is_file", return_value=False):
            self.b.hd_start()
            self.wait({"done", "failed"})
        self.assertEqual(self.b.hd["state"], "failed")
        self.assertIn("uv", self.b.hd["error"])

    def test_bundled_uv_is_found_before_path(self):
        bundled = Path(self.tmp.name) / ("uv.exe" if dw.os.name == "nt" else "uv")
        bundled.write_text("")
        self.assertEqual(dw.find_uv({"uv": bundled}), str(bundled))          # path says sys.executable (setUp)
        self.b.tools["uv"] = bundled
        self.assertEqual(self.b._env()["DW2003_UV"], str(bundled))

    def test_uv_from_path_when_nothing_is_bundled(self):
        self.assertEqual(dw.find_uv({"uv": Path(self.tmp.name) / "missing"}), sys.executable)
        with mock.patch.object(dw.shutil, "which", return_value=None),                 mock.patch.object(dw.Path, "home", return_value=Path(self.tmp.name)):
            self.assertIsNone(dw.find_uv({}))


if __name__ == "__main__":
    unittest.main()
