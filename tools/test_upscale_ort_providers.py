"""ONNX Runtime provider choice and the torch fallback, tested without the hardware (fake platform and providers)."""
from __future__ import annotations

import importlib.util
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import upscale_assets as up


class FakeOrt:
    """Stands in for onnxruntime: the providers it reports and what a session does."""

    class ExecutionMode:
        ORT_SEQUENTIAL = 0

    class SessionOptions:
        def __init__(self):
            self.free_dimensions = {}

        def add_free_dimension_override_by_name(self, name, value):
            self.free_dimensions[name] = value

    def __init__(self, providers, session_providers=None, raises=None):
        self.providers, self.raises = list(providers), raises
        self.session_providers = session_providers

    def get_available_providers(self):
        return self.providers

    def InferenceSession(self, path, options, providers):
        if self.raises:
            raise self.raises
        wanted = providers[0][0]
        got = self.session_providers if self.session_providers is not None else [wanted, "CPUExecutionProvider"]

        class Session:
            def get_providers(self):
                return got

        return Session()


class OrtProviderTests(unittest.TestCase):
    SPEC = up.MODEL_SPECS["realesrgan-anime-x4"]

    def create(self, fake, platform, device_name, device_index=None):
        out = io.StringIO()
        with mock.patch.dict(sys.modules, {"onnx": mock.MagicMock(), "onnxruntime": fake}), redirect_stdout(out):
            runner = up.OrtRunner.create(
                self.SPEC, Path("w.pth"), device_index, device_name, "torch-fallback", platform=platform,
                onnx_files=(Path("m.onnx"), {}),
            )
        return runner, out.getvalue()

    def test_pick_provider_per_platform(self):
        pick = up.ort_pick_provider
        self.assertEqual(pick("win32", ["DmlExecutionProvider", "CPUExecutionProvider"], 1)[0],
                         ("DmlExecutionProvider", {"device_id": 1}))
        self.assertEqual(pick("linux", ["CUDAExecutionProvider", "CPUExecutionProvider"], None)[0],
                         ("CUDAExecutionProvider", {"device_id": 0}))
        self.assertEqual(pick("darwin", ["CoreMLExecutionProvider", "CPUExecutionProvider"], None)[0],
                         ("CoreMLExecutionProvider", {}))

    def test_linux_prefers_cuda_then_rocm_then_migraphx(self):
        everything = ["MIGraphXExecutionProvider", "ROCMExecutionProvider", "CUDAExecutionProvider"]
        self.assertEqual(up.ort_pick_provider("linux", everything, 0)[0][0], "CUDAExecutionProvider")
        self.assertEqual(up.ort_pick_provider("linux", everything[:2], 0)[0][0], "ROCMExecutionProvider")
        self.assertEqual(up.ort_pick_provider("linux", everything[:1], 0)[0][0], "MIGraphXExecutionProvider")

    def test_cpu_only_build_or_unknown_platform_picks_nothing(self):
        for platform in ("win32", "linux", "darwin"):
            provider, why = up.ort_pick_provider(platform, ["CPUExecutionProvider"], 0)
            self.assertIsNone(provider)
            self.assertIn("CPUExecutionProvider", why)
        self.assertIsNone(up.ort_pick_provider("freebsd14", ["CUDAExecutionProvider"], 0)[0])

    def test_create_uses_each_platforms_provider(self):
        for platform, device, provider in (
            ("win32", "directml", "DmlExecutionProvider"),
            ("linux", "auto", "CUDAExecutionProvider"),
            ("linux", "cuda", "CUDAExecutionProvider"),
            ("darwin", "auto", "CoreMLExecutionProvider"),
            ("darwin", "mps", "CoreMLExecutionProvider"),
        ):
            runner, _ = self.create(FakeOrt([provider, "CPUExecutionProvider"]), platform, device)
            self.assertIsNotNone(runner, (platform, device))
            self.assertEqual(runner.provider[0], provider)

    def test_create_falls_back_and_says_why(self):
        runner, out = self.create(FakeOrt(["CPUExecutionProvider"]), "linux", "auto")
        self.assertIsNone(runner)
        self.assertIn("inference on torch-fallback", out)
        self.assertIn("CUDAExecutionProvider", out)
        runner, _ = self.create(FakeOrt(["DmlExecutionProvider"]), "win32", "cuda")
        self.assertIsNone(runner)
        runner, out = self.create(FakeOrt(["CUDAExecutionProvider"]), "linux", "cpu")
        self.assertIsNone(runner)
        self.assertIn("CPU device was requested", out)

    def test_create_without_onnxruntime_installed(self):
        out = io.StringIO()
        with mock.patch.dict(sys.modules, {"onnx": None, "onnxruntime": None}), redirect_stdout(out):
            runner = up.OrtRunner.create(self.SPEC, Path("w.pth"), None, "auto", "torch", platform="linux",
                                         onnx_files=(Path("m.onnx"), {}))
        self.assertIsNone(runner)
        self.assertIn("ONNX Runtime unused", out.getvalue())

    def make_runner(self, fake, provider):
        return up.OrtRunner(fake, (Path("fake.onnx"), {}), None, "k", (provider, {"device_id": 0}), "torch-fallback")

    def test_session_throwing_raises_for_the_torch_fallback(self):
        runner = self.make_runner(FakeOrt(["CUDAExecutionProvider"], raises=RuntimeError("lib missing")),
                                  "CUDAExecutionProvider")
        with self.assertRaises(RuntimeError):
            runner._session(64)

    def test_session_that_silently_fell_to_cpu_is_rejected(self):
        fake = FakeOrt(["CUDAExecutionProvider"], session_providers=["CPUExecutionProvider"])
        runner = self.make_runner(fake, "CUDAExecutionProvider")
        with self.assertRaisesRegex(RuntimeError, "not CUDAExecutionProvider"):
            runner._session(64)

    def test_session_reports_the_provider_it_used(self):
        runner = self.make_runner(FakeOrt(["CoreMLExecutionProvider"]), "CoreMLExecutionProvider")
        out = io.StringIO()
        with redirect_stdout(out):
            runner._session(64)
        self.assertIn("ONNX Runtime provider CoreMLExecutionProvider", out.getvalue())

    @unittest.skipIf(importlib.util.find_spec("torch") is None, "torch not installed")
    def test_sr_rgb_uses_torch_after_ort_failure(self):
        import numpy as np

        class Boom:
            key, fallback, failed, provider = "k", "torch-fallback", None, ("CUDAExecutionProvider", {})

            def run(self, rgb):
                raise RuntimeError("session exploded")

        model = up.LoadedModel(object(), None, self.SPEC, ort=Boom())
        out = io.StringIO()
        with mock.patch.object(up, "descriptor_forward", side_effect=RuntimeError("torch reached")), \
                redirect_stdout(out), self.assertRaisesRegex(RuntimeError, "torch reached"):
            up.sr_rgb(model, np.zeros((8, 8, 3), np.float32))
        self.assertIn("ONNX Runtime (CUDAExecutionProvider) failed, using torch-fallback", out.getvalue())
        self.assertIn("session exploded", model.ort.failed)


class PrebuiltOnnxTests(unittest.TestCase):
    """The prebuilt ONNX models: release download, sha256, cache, and the no-torch exit."""
    SPEC = up.MODEL_SPECS["fateplus-lite-x4"]

    def release(self, root: Path, payload: bytes = b"onnx-bytes", sha: str | None = None):
        import hashlib, json
        root.mkdir(parents=True, exist_ok=True)
        (root / f"{self.SPEC.key}.onnx").write_bytes(payload)
        info = {"sha256": sha or hashlib.sha256(payload).hexdigest(), "bytes": len(payload), "scale": 4,
                "buckets": [64, 128]}
        (root / f"{self.SPEC.key}.json").write_text(json.dumps(info))

    def fetcher(self, root: Path, calls: list):
        import shutil

        def fetch(url, dest):
            calls.append(url)
            shutil.copyfile(root / url.rsplit("/", 1)[1], dest)
        return fetch

    def test_downloads_checks_and_caches(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            self.release(tmp / "rel")
            calls = []
            got = up.ensure_onnx(self.SPEC, tmp / "cache", "v9.9.9", fetch=self.fetcher(tmp / "rel", calls))
            self.assertIsNotNone(got)
            self.assertEqual(len(calls), 2)
            self.assertEqual(got[1]["buckets"], [64, 128])
            again = up.ensure_onnx(self.SPEC, tmp / "cache", "v9.9.9", fetch=self.fetcher(tmp / "rel", calls))
            self.assertIsNotNone(again)
            self.assertEqual(len(calls), 2, "a cached, verified model is not downloaded again")

    def test_wrong_sha256_is_discarded(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            self.release(tmp / "rel", sha="0" * 64)
            with redirect_stdout(io.StringIO()):
                got = up.ensure_onnx(self.SPEC, tmp / "cache", "v9.9.9", fetch=self.fetcher(tmp / "rel", []))
            self.assertIsNone(got)
            self.assertFalse((tmp / "cache" / "onnx" / "fateplus-lite-x4.onnx").exists())

    def test_no_release_or_download_error_is_none(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(up.ensure_onnx(self.SPEC, Path(tmp), None))   # a checkout has no version
            def boom(url, dest):
                raise OSError("404")
            with redirect_stdout(io.StringIO()):
                self.assertIsNone(up.ensure_onnx(self.SPEC, Path(tmp), "v9.9.9", fetch=boom))

    def test_runner_takes_scale_and_buckets_from_the_json(self):
        runner = up.OrtRunner(FakeOrt(["CUDAExecutionProvider"]), (Path("m.onnx"), {"scale": 2, "buckets": [32, 64]}),
                              None, "k", ("CUDAExecutionProvider", {}))
        self.assertEqual((runner.scale, runner.buckets), (2, (32, 64)))

    def test_free_dimensions_are_pinned_per_session(self):
        seen = {}

        class Fake(FakeOrt):
            def InferenceSession(self, path, options, providers):
                seen.update(options.free_dimensions)
                return super().InferenceSession(path, options, providers)

        runner = up.OrtRunner(Fake(["CUDAExecutionProvider"]), (Path("m.onnx"), {"free_dimensions": ["h", "w"]}),
                              None, "k", ("CUDAExecutionProvider", {}))
        with redirect_stdout(io.StringIO()):
            runner._session(128)
        self.assertEqual(seen, {"h": 128, "w": 128})

    @unittest.skipIf(importlib.util.find_spec("torch") is not None, "torch is installed here")
    def test_without_torch_and_without_ort_the_run_asks_for_torch(self):
        with mock.patch.object(up.OrtRunner, "create", return_value=None), redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit) as caught:
                up.load_model(self.SPEC, device_name="cpu")
        self.assertEqual(caught.exception.code, up.EXIT_NEEDS_TORCH)


class TorchDeviceOrderTests(unittest.TestCase):
    def pick(self, cuda, mps, name="auto"):
        torch = mock.MagicMock()
        torch.cuda.is_available.return_value = cuda
        torch.backends.mps.is_available.return_value = mps
        torch.device.side_effect = lambda value: value
        with mock.patch.dict(sys.modules, {"torch": torch}):
            return up.torch_device(name)

    def test_auto_order_is_cuda_then_mps_then_cpu(self):
        self.assertEqual(self.pick(True, True), "cuda")
        self.assertEqual(self.pick(False, True), "mps")
        self.assertEqual(self.pick(False, False), "cpu")

    def test_explicit_mps_needs_an_apple_gpu(self):
        self.assertEqual(self.pick(False, True, "mps"), "mps")
        with self.assertRaises(RuntimeError):
            self.pick(False, False, "mps")


class AutoDeviceTests(unittest.TestCase):
    def test_auto_is_directml_on_windows_when_installed(self):
        self.assertEqual(up.resolve_device_name("auto", "win32", lambda: True), "directml")
        self.assertEqual(up.resolve_device_name("AUTO", "win32", lambda: True), "directml")

    def test_auto_stays_auto_elsewhere_or_without_torch_directml(self):
        self.assertEqual(up.resolve_device_name("auto", "win32", lambda: False), "auto")
        self.assertEqual(up.resolve_device_name("auto", "linux", lambda: True), "auto")
        self.assertEqual(up.resolve_device_name("auto", "win32", mock.Mock(side_effect=OSError)), "auto")

    def test_explicit_choices_are_never_changed(self):
        for name in ("cpu", "cuda", "mps", "directml"):
            self.assertEqual(up.resolve_device_name(name, "win32", lambda: True), name)


class UvWithMarkerTests(unittest.TestCase):
    def test_each_onnxruntime_build_is_platform_marked(self):
        root = Path(__file__).resolve().parent.parent
        sys.path.insert(0, str(root))
        try:
            import build_all
        finally:
            sys.path.remove(str(root))
        stage = next(s for s in build_all.STAGES if s.name == "upscale_assets")
        ort = [w for w in stage.uv_with if w.startswith("onnxruntime")]
        self.assertEqual(len(ort), 3)
        for requirement in ort:
            self.assertIn("; sys_platform ==", requirement)
        # the light path carries no torch; torch comes only with the fallback run
        for heavy in ("torch", "spandrel", "onnx"):
            self.assertFalse([w for w in stage.uv_with if w.split(";")[0].strip() == heavy or w.startswith(heavy + "-")], heavy)
        self.assertIn("torch-directml; sys_platform == 'win32'", stage.uv_with_fallback)
        self.assertIn("torch", stage.uv_with_fallback)
        self.assertIn("spandrel", stage.uv_with_fallback)


if __name__ == "__main__":
    unittest.main()
