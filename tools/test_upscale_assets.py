"""Focused tests for the asset-wide super-resolution pipeline."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

import upscale_assets as up
from upscale_textures import legacy_args

try:
    import numpy as np
except ImportError:
    np = None


class DiscoveryTests(unittest.TestCase):
    def test_discovers_runtime_tree_and_excludes_reference_art(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            src, out = root / "assets", root / "assets-hd"
            for rel in ("maps/s200.png", "ui/menu.png", "ref/capture.png", "ui/font_test.png"):
                path = src / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGBA", (2, 2)).save(path)

            assets, excluded, dead = up.discover_assets(src, out)
            self.assertEqual([a.rel.as_posix() for a in assets], ["maps/s200.png", "ui/menu.png"])
            self.assertEqual(
                [p.as_posix() for p in excluded], ["ref/capture.png", "ui/font_test.png"]
            )

    def test_include_glob_selects_one_asset_family(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            src, out = root / "assets", root / "assets-hd"
            for rel in ("battle/textures/a.png", "battle/effects/b.png", "maps/s200.png"):
                path = src / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGB", (1, 1)).save(path)
            assets, _, _dead = up.discover_assets(src, out, includes=("battle/textures/**",))
            self.assertEqual([a.rel.as_posix() for a in assets], ["battle/textures/a.png"])


class ProgressTests(unittest.TestCase):
    def test_progress_bar_uses_pixel_work_for_eta(self):
        line = up.progress_line(
            5,
            10,
            processed_work=1_000,
            total_work=4_000,
            elapsed=10,
            width=10,
        )
        self.assertEqual(
            line,
            "Progress [#####-----] 5/10 ( 50.0%)"
            " | elapsed 00:00:10 | ETA 00:00:30",
        )

    def test_progress_eta_starts_as_calculating(self):
        self.assertIn(
            "ETA calculating...",
            up.progress_line(
                0,
                10,
                processed_work=0,
                total_work=1_000,
                elapsed=0,
            ),
        )

    def test_rejects_only_images_whose_4x_axis_exceeds_browser_limit(self):
        self.assertTrue(up.hd_dimensions_supported([8191, 512]))
        self.assertFalse(up.hd_dimensions_supported([512, 24906]))


class GpuSelectionTests(unittest.TestCase):
    def test_auto_selection_ignores_intel_and_chooses_amd(self):
        self.assertEqual(
            up.preferred_directml_device([
                "Intel(R) Radeon-compatible Graphics",
                "AMD Radeon RX 7900 XTX",
            ]),
            1,
        )

    def test_auto_selection_prefers_nvidia_when_both_vendors_exist(self):
        self.assertEqual(
            up.preferred_directml_device([
                "AMD Radeon Graphics",
                "NVIDIA GeForce RTX 4080",
            ]),
            1,
        )

    def test_auto_selection_rejects_unsupported_adapters(self):
        with self.assertRaisesRegex(RuntimeError, "no AMD or Nvidia"):
            up.preferred_directml_device(["Intel Arc Graphics"])

    def test_extra_architectures_are_registered_only_once(self):
        install = mock.Mock()
        old = up._EXTRA_ARCHES_INSTALLED
        try:
            up._EXTRA_ARCHES_INSTALLED = False
            up.ensure_extra_arches_installed(install)
            up.ensure_extra_arches_installed(install)
        finally:
            up._EXTRA_ARCHES_INSTALLED = old
        install.assert_called_once_with(ignore_duplicates=True)

    def test_directml_forward_bypasses_spandrel_inference_wrapper(self):
        class Output:
            def clamp(self, low, high):
                self.range = (low, high)
                return self

        output = Output()

        class Descriptor:
            model = object()

            def __call__(self, _tensor):
                raise AssertionError("Spandrel inference_mode wrapper was called")

            @staticmethod
            def _call_fn(model, tensor):
                self.assertIs(model, Descriptor.model)
                self.assertEqual(tensor, "tile")
                return output

        result = up.descriptor_forward(Descriptor(), "tile", directml_safe=True)
        self.assertIs(result, output)
        self.assertEqual(result.range, (0, 1))

    def test_directml_smoke_test_covers_entire_recipe(self):
        recipe_models = {
            model
            for rel in (
                Path("maps/s200.png"),
                Path("ui/field_portrait.png"),
                Path("battle/textures/m003agum.png"),
            )
            for model in up.processing_recipe(rel)["models"]
        }
        self.assertEqual(set(up.DIRECTML_RECIPE_MODELS), recipe_models)

        loaded = []

        def fake_load(spec, **kwargs):
            loaded.append((spec.key, kwargs["device_name"]))
            return object()

        with (
            mock.patch.object(up, "load_model", side_effect=fake_load),
            mock.patch.object(
                up,
                "upscale_image",
                return_value=(Image.new("RGB", (128, 128)), 4, "none"),
            ),
        ):
            up.run_directml_smoke_test(device_index=0, cache=Path("models"))

        self.assertEqual(
            loaded,
            [(key, "directml") for key in up.DIRECTML_RECIPE_MODELS],
        )

    def test_directml_cat_skips_only_empty_operands(self):
        class Tensor:
            def __init__(self, size):
                self.size = size

            def numel(self):
                return self.size

        calls = []

        class Torch:
            @staticmethod
            def cat(values, *args, **kwargs):
                calls.append((tuple(value.size for value in values), args, kwargs))
                return "joined"

        native = Torch.cat
        with up.directml_compatibility_ops(Torch, True):
            self.assertEqual(
                Torch.cat((Tensor(12), Tensor(0)), dim=1),
                "joined",
            )
        self.assertIs(Torch.cat, native)
        self.assertEqual(calls, [((12,), (), {"dim": 1})])


class AlphaTests(unittest.TestCase):
    @unittest.skipUnless(np is not None, "numpy is an upscaler dependency")
    def test_dilate_does_not_wrap_across_edges(self):
        rgb = np.zeros((3, 4, 3), dtype=np.float32)
        rgb[1, 0] = (1, 0, 0)
        mask = np.zeros((3, 4), dtype=bool)
        mask[1, 0] = True
        filled = up.dilate_fill(rgb, mask, 1)
        np.testing.assert_array_equal(filled[1, 1], (1, 0, 0))
        np.testing.assert_array_equal(filled[1, 3], (0, 0, 0))

    @unittest.skipUnless(np is not None, "numpy is an upscaler dependency")
    def test_tiled_upscale_keeps_native_alpha_shape(self):
        source = Image.new("RGBA", (3, 2), (40, 80, 120, 0))
        source.putpixel((1, 0), (40, 80, 120, 255))

        def nearest_four(_model, rgb):
            return np.repeat(np.repeat(rgb, 4, axis=0), 4, axis=1)

        with mock.patch.object(up, "sr_rgb", nearest_four):
            output, scale, alpha_mode = up.upscale_image(
                object(), source, tile=2, overlap=1, dilate=1
            )
        self.assertEqual(scale, 4)
        self.assertEqual(alpha_mode, "binary")
        self.assertEqual(output.size, (12, 8))
        alpha = output.getchannel("A")
        self.assertEqual(alpha.getpixel((4, 0)), 255)
        self.assertEqual(alpha.getpixel((3, 0)), 0)

    @unittest.skipUnless(np is not None, "numpy is an upscaler dependency")
    def test_ncnn_staging_restores_nearest_alpha(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            source = root / "source.png"
            staged_input = root / "input.png"
            staged_output = root / "output.png"
            final = root / "final.png"
            image = Image.new("RGBA", (2, 1), (10, 20, 30, 0))
            image.putpixel((0, 0), (100, 120, 140, 255))
            image.save(source)

            size, has_alpha = up.prepare_ncnn_input(source, staged_input, dilate=1)
            self.assertEqual(size, [2, 1])
            self.assertTrue(has_alpha)
            with Image.open(staged_input) as prepared:
                self.assertEqual(prepared.mode, "RGB")
                prepared.resize((8, 4), Image.Resampling.NEAREST).save(staged_output)

            high_size = up.finish_ncnn_output(
                source,
                staged_output,
                final,
                size=size,
                has_alpha=has_alpha,
            )
            self.assertEqual(high_size, (8, 4))
            with Image.open(final) as result:
                self.assertEqual(result.mode, "RGBA")
                self.assertEqual(result.getchannel("A").getpixel((3, 0)), 255)
                self.assertEqual(result.getchannel("A").getpixel((4, 0)), 0)


class PixelPreservationTests(unittest.TestCase):
    def test_asset_classes_have_deterministic_model_chains(self):
        self.assertEqual(
            up.processing_recipe(Path("sprites/p002plyk.png")),
            {"assetClass": "tiny-sprite", "method": "nearest", "models": []},
        )
        self.assertEqual(
            up.processing_recipe(Path("maps/s200.png")),
            {
                "assetClass": "map",
                "method": "ai",
                "models": [
                    "fateplus-lite-x4",
                    "hat-classical-x4",
                    "realesrgan-anime-x4",
                ],
            },
        )
        # The shipped sheet has 32x32 cells, which the size test keeps exact.
        self.assertEqual(
            up.processing_recipe(Path("ui/stdglabo_portraits_sheet.png")),
            {"assetClass": "portrait-tiny", "method": "nearest", "models": []},
        )
        self.assertEqual(
            up.processing_recipe(Path("ui/uifont.png"))["method"], "nearest"
        )
        # Same for the mixed status atlas: its portrait cells are 32x32 too.
        self.assertEqual(
            up.processing_recipe(Path("ui/ststat_sheet.png"))["method"], "nearest"
        )
        self.assertEqual(
            up.processing_recipe(Path("battle/textures/m003agum.png"))["models"][0],
            "fateplus-lite-x4",
        )

    def test_tiny_sprite_is_exact_nearest(self):
        source = Image.new("RGBA", (1, 1), (100, 50, 0, 255))
        result, alpha_mode = up.nearest_upscale(source)
        self.assertEqual(result.size, (4, 4))
        self.assertEqual(result.getpixel((2, 2)), (100, 50, 0, 255))
        self.assertEqual(alpha_mode, "binary")

    def test_legacy_manifest_record_is_full_ai_not_new_sprite_recipe(self):
        legacy = {"path": "sprites/p002plyk.png", "sourceSize": [1, 1], "scale": 4}
        self.assertTrue(
            up.processing_matches(legacy, {"method": "ai"})
        )
        self.assertFalse(
            up.processing_matches(legacy, up.processing_recipe(Path(legacy["path"])))
        )

    def test_directml_retry_upgrades_vulkan_ai_but_keeps_nearest_assets(self):
        map_recipe = up.processing_recipe(Path("maps/s200.png"))
        vulkan = {
            "processing": map_recipe,
            "backend": "ncnn-vulkan",
            "modelUsed": "realesrgan-anime-x4",
        }
        self.assertTrue(up.processing_matches(vulkan, map_recipe, "ncnn"))
        self.assertFalse(up.processing_matches(vulkan, map_recipe, "torch"))

        sprite_recipe = up.processing_recipe(Path("sprites/p002play.png"))
        nearest = {
            "processing": sprite_recipe,
            "backend": "cpu",
            "modelUsed": "nearest",
        }
        self.assertTrue(up.processing_matches(nearest, sprite_recipe, "torch"))

    def test_previous_atd_map_recipe_is_invalidated(self):
        old_record = {
            "processing": {
                "assetClass": "map",
                "method": "ai",
                "models": [
                    "atd-classical-x4",
                    "hat-classical-x4",
                    "realesrgan-anime-x4",
                ],
            },
            "backend": "directml",
            "modelUsed": "atd-classical-x4",
        }
        self.assertFalse(
            up.processing_matches(
                old_record,
                up.processing_recipe(Path("maps/s200.png")),
                "torch",
            )
        )

    def test_gpu_oom_retries_smaller_tile_without_disabling_model(self):
        recipe = {"method": "ai", "models": ["atd-classical-x4"]}
        unavailable = {}
        tile_limits = {}
        calls = []

        def fake_upscale(model, image, *, tile, overlap, dilate):
            calls.append(tile)
            if tile == 512:
                raise RuntimeError(
                    "Could not allocate tensor. There is not enough GPU video memory available!"
                )
            return Image.new("RGB", (4, 4)), 4, "none"

        with mock.patch.object(up, "upscale_image", side_effect=fake_upscale):
            _high, scale, _alpha, used = up.upscale_with_models(
                Image.new("RGB", (1, 1)),
                recipe,
                device_name="directml",
                device_index=0,
                cache=Path("models"),
                models={"atd-classical-x4": object()},
                unavailable=unavailable,
                tile=512,
                overlap=64,
                dilate=16,
                tile_limits=tile_limits,
            )

        self.assertEqual((scale, used), (4, "atd-classical-x4"))
        self.assertEqual(calls, [512, 256])
        self.assertEqual(tile_limits, {"atd-classical-x4": 256})
        self.assertEqual(unavailable, {})


class AlphaPolicyTests(unittest.TestCase):
    def test_soft_alpha_uses_conventional_interpolation(self):
        alpha = Image.new("L", (2, 1))
        alpha.putdata([0, 128])
        resampling, kind = up.alpha_resampling(alpha)
        self.assertEqual(kind, "soft")
        self.assertEqual(resampling, Image.Resampling.BICUBIC)

    def test_binary_alpha_uses_nearest(self):
        alpha = Image.new("L", (2, 1))
        alpha.putdata([0, 255])
        resampling, kind = up.alpha_resampling(alpha)
        self.assertEqual(kind, "binary")
        self.assertEqual(resampling, Image.Resampling.NEAREST)


class PortraitAtlasTests(unittest.TestCase):
    def test_only_decoded_portrait_layer_rectangles_are_selected(self):
        with tempfile.TemporaryDirectory() as raw:
            image_path = Path(raw) / "ststat_sheet.png"
            image_path.touch()
            image_path.with_suffix(".json").write_text(json.dumps({
                "portraits": {"1": [7, 8]},
                "backdrop": 29,
                "ids": {
                    "7": {"layers": [{"x": 4, "y": 5, "w": 32, "h": 32}]},
                    "8": {"layers": [{"x": 40, "y": 5, "w": 32, "h": 32}]},
                    "29": {"layers": [{"x": 0, "y": 0, "w": 256, "h": 100}]},
                },
            }))
            self.assertEqual(
                up.portrait_atlas_regions(image_path),
                [(4, 5, 36, 37), (40, 5, 72, 37)],
            )


class NcnnBatchTests(unittest.TestCase):
    @unittest.skipUnless(np is not None, "numpy is an upscaler dependency")
    def test_batch_invokes_one_process_for_multiple_assets(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            exe = root / "realesrgan-ncnn-vulkan.exe"
            exe.touch()
            batch = []
            for index in range(2):
                source = root / f"source-{index}.png"
                Image.new("RGB", (2, 3), (index, 20, 30)).save(source)
                asset = up.Asset(source, Path(f"ui/{index}.png"))
                batch.append((index + 1, asset, root / f"final-{index}.png"))

            def fake_run(command, *, cwd, check):
                inputs = Path(command[command.index("-i") + 1])
                outputs = Path(command[command.index("-o") + 1])
                for source in inputs.iterdir():
                    with Image.open(source) as image:
                        image.resize((8, 12), Image.Resampling.NEAREST).save(
                            outputs / source.name
                        )
                self.assertEqual(cwd, exe.parent)
                self.assertTrue(check)

            with mock.patch.object(up.subprocess, "run", side_effect=fake_run) as run:
                completed = up.run_ncnn_batch(
                    exe, batch, tile=256, dilate=1, jobs="2:2:2"
                )
            run.assert_called_once()
            self.assertEqual(len(completed), 2)
            self.assertTrue((root / "final-0.png").is_file())
            self.assertTrue((root / "final-1.png").is_file())

    @unittest.skipUnless(np is not None, "numpy is an upscaler dependency")
    def test_invalid_batch_output_is_retried_alone(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            exe = root / "realesrgan-ncnn-vulkan.exe"
            exe.touch()
            source = root / "source.png"
            final = root / "final.png"
            Image.new("RGB", (2, 3), (10, 20, 30)).save(source)
            asset = up.Asset(source, Path("ui/retry.png"))
            calls = 0

            def fake_run(command, *, cwd, check):
                nonlocal calls
                calls += 1
                inputs = Path(command[command.index("-i") + 1])
                outputs = Path(command[command.index("-o") + 1])
                target = outputs / "000000.png"
                if calls == 1:
                    target.write_bytes(b"not a png")
                else:
                    with Image.open(inputs / "000000.png") as image:
                        image.resize((8, 12), Image.Resampling.NEAREST).save(target)

            with mock.patch.object(up.subprocess, "run", side_effect=fake_run):
                completed = up.run_ncnn_batch(
                    exe,
                    [(1, asset, final)],
                    tile=256,
                    dilate=1,
                    jobs="2:2:2",
                )
            self.assertEqual(calls, 2)
            self.assertEqual(len(completed), 1)
            self.assertTrue(final.is_file())


class CompatibilityTests(unittest.TestCase):
    def test_legacy_model_and_iters(self):
        self.assertEqual(
            legacy_args(["--model", "m373rena", "--iters", "8", "--dry-run"]),
            [
                "--include",
                "battle/textures/m373rena.png",
                "--dilate",
                "8",
                "--dry-run",
            ],
        )


def portrait_sheet(root: Path, rel: str, cell: int, *, atlas: bool = False, meta=True):
    """Write a 4-cell portrait sheet with its decoded rectangle manifest."""
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", (cell * 4, cell), (10, 20, 30, 255)).save(path)
    if meta:
        ids = {
            str(i): {"layers": [{"frame": i, "x": i * cell, "y": 0, "w": cell, "h": cell}]}
            for i in range(4)
        }
        data = {"ids": ids, "portraits": {"a": list(ids)}} if atlas else ids
        path.with_suffix(".json").write_text(json.dumps(data))
    return path


class PortraitCellSizeTests(unittest.TestCase):
    """A restoration model has nothing to rebuild inside a 32x32 portrait cell:
    it merges limbs, moves eyes, and on a sheet it bleeds one cell into the next."""

    def test_tiny_cells_stay_exact(self):
        with tempfile.TemporaryDirectory() as raw:
            src = portrait_sheet(Path(raw), "ui/stdglabo_portraits_sheet.png", 32)
            rel = Path("ui/stdglabo_portraits_sheet.png")
            self.assertEqual(up.asset_class(rel, src), "portrait-tiny")
            self.assertEqual(up.processing_recipe(rel, src=src)["method"], "nearest")

    def test_tiny_atlas_cells_stay_exact(self):
        with tempfile.TemporaryDirectory() as raw:
            src = portrait_sheet(Path(raw), "ui/ststat_sheet.png", 32, atlas=True)
            rel = Path("ui/ststat_sheet.png")
            self.assertEqual(up.asset_class(rel, src), "portrait-tiny")
            self.assertEqual(up.processing_recipe(rel, src=src)["method"], "nearest")

    def test_large_cells_still_use_the_portrait_model(self):
        with tempfile.TemporaryDirectory() as raw:
            src = portrait_sheet(Path(raw), "ui/big_portraits_sheet.png", 128)
            rel = Path("ui/big_portraits_sheet.png")
            self.assertEqual(up.asset_class(rel, src), "portrait")
            recipe = up.processing_recipe(rel, src=src)
            self.assertEqual(recipe["method"], "ai")
            self.assertEqual(recipe["models"][0], "apisr-x4")

    def test_unmeasurable_sheet_keeps_the_portrait_recipe(self):
        """Without decoded rectangles the size test cannot fire, so do not guess."""
        with tempfile.TemporaryDirectory() as raw:
            src = portrait_sheet(Path(raw), "ui/mystery_portraits_sheet.png", 32, meta=False)
            rel = Path("ui/mystery_portraits_sheet.png")
            self.assertEqual(up.asset_class(rel, src), "portrait")


class DeadAssetTests(unittest.TestCase):
    def test_arena_atlases_are_not_discovered(self):
        """F000COM1..4 are mis-decoded noise that web/battle3d.js no longer reads."""
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            src, out = root / "assets", root / "assets-hd"
            for rel in ("battle/arena/f000com1.png", "sprites/keep.png"):
                path = src / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGBA", (8, 8)).save(path)
            assets, excluded, dead = up.discover_assets(src, out)
            self.assertEqual([a.rel.as_posix() for a in assets], ["sprites/keep.png"])
            self.assertEqual([d.as_posix() for d in dead], ["battle/arena/f000com1.png"])
            self.assertEqual(excluded, [])


if __name__ == "__main__":
    unittest.main()
