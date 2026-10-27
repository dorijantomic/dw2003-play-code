#!/usr/bin/env python3
"""Build an asset-aware 4x HD mirror without changing native coordinates.

The original extracted PNGs remain in ``web/assets``.  Upscaled files are written
to the same relative paths below ``web/assets-hd`` and recorded in a manifest.
Keeping the two trees separate matters: field sprites, effects, and UI sheets use
native pixel crop rectangles in JSON, whereas fight-model textures use normalized
UVs.  Overwriting every source image would therefore break most non-model assets.

Each raster is classified before processing.  Maps use fidelity-oriented classical
SR, explicit portraits use anime restoration, pre-rendered game textures use a
game-art model, tiny sprites and UI/glyph atlases remain exact nearest-neighbour.
The specialist DirectML/torch path works on AMD and Nvidia DirectX 12 GPUs; the
portable NCNN/Vulkan backend remains a broad compatibility fallback.

Examples:
    # Inventory everything that would be processed (no ML dependencies required).
    .venv/bin/python3 tools/upscale_assets.py --dry-run

    # Build every runtime raster asset. uv supplies the heavyweight ML packages.
    ~/.local/bin/uv run --python 3.12 --with torch --with spandrel \
        --with spandrel-extra-arches --with gdown --with pillow --with numpy \
        python tools/upscale_assets.py

    # Rebuild one subtree or include captures/diagnostics too.
    ... python tools/upscale_assets.py --include 'ui/**'
    ... python tools/upscale_assets.py --include-reference

    # Native Windows Vulkan build (normally called by build-hd-assets.ps1).
    py tools/upscale_assets.py --backend ncnn \
        --ncnn-exe C:\\path\\to\\realesrgan-ncnn-vulkan.exe
"""
from __future__ import annotations

import argparse
import contextlib
import fnmatch
import functools
import gc
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
DEFAULT_SRC = REPO / "web/assets"
DEFAULT_OUT = REPO / "web/assets-hd"
CACHE = Path.home() / ".cache/ddw3-walker-sr"
LEGACY_MODEL_PATH = (
    Path.home() / ".cache/skeletal-lab-sr/RealESRGAN_x4plus_anime_6B.pth"
)
MODEL_URL = (
    "https://github.com/xinntao/Real-ESRGAN/releases/download/"
    "v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
)
MODEL_PATH = CACHE / "RealESRGAN_x4plus_anime_6B.pth"
RASTER_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})
DEFAULT_EXCLUDED_DIRS = frozenset({"ref"})
# Dead extractions.  F000COM1..4 are the common effect texture atlases, decoded as
# raw 16bpp when the format is 4bpp+CLUT, so the files are rainbow noise rather
# than art.  web/battle3d.js stopped reading them and builds the arena floor
# procedurally, so an AI pass only turns the noise into swirls and burns GPU time.
DEAD_ASSET_PATTERNS = ("battle/arena/*",)
# Developer-only rasters: no game path requests them through the HD loader (web/assets.js), so an HD
# copy is never shown.  thumbs/ is the stage-wiring tool's preview set (web/wire.js loads it with a
# plain <img>); an arena's whole-page floor.png/wall.png and every *_void.png are battle3d.js debug
# views (arenaDebug.legacy / voidRaw).  The game draws only {page}_c{col}_r{row}.png.
DEV_ONLY_PATTERNS = (
    "thumbs/*",
    "battle/arenas/*/floor.png",
    "battle/arenas/*/wall.png",
    "battle/arenas/*/*_void.png",
)
# An anime-restoration model has nothing to reconstruct in a 32x32 portrait cell:
# it merges limbs, moves eyes, and on a shared sheet it bleeds one cell into its
# neighbour, which native crop rectangles then show.  Cells at or below this edge
# stay exact nearest-neighbour.
MAX_NEAREST_PORTRAIT_CELL = 64
# Chromium/canvas and common PNG tooling become unreliable above 32K on either
# axis. arch00.png is a 24,906px-tall generated effect atlas, so its 4x form
# would be 99,624px tall and must remain an automatic native-file fallback.
MAX_HD_DIMENSION = 32_767
SCALE = 4
DEFAULT_TILE = 512
DEFAULT_OVERLAP = 32


@dataclass(frozen=True)
class ModelSpec:
    key: str
    filename: str
    url: str
    architecture: str
    license: str
    input_multiple: int = 1


MODEL_SPECS = {
    "atd-classical-x4": ModelSpec(
        "atd-classical-x4",
        "003_ATD_SRx4_finetune.pth",
        "gdrive:1J9kR9OyrOxtJ5Ygbr_W116BLBwnD4VNL",
        "ATD",
        "Apache-2.0",
        16,
    ),
    "hat-classical-x4": ModelSpec(
        "hat-classical-x4",
        "HAT-L_SRx4_ImageNet-pretrain.pth",
        "gdrive:1uefIctjoNE3Tg6GTzelesTTshVogQdUf",
        "HAT",
        "Apache-2.0",
        16,
    ),
    "fateplus-lite-x4": ModelSpec(
        "fateplus-lite-x4",
        "4x-FatePlus-lite.pth",
        "https://objectstorage.us-phoenix-1.oraclecloud.com/n/ax6ygfvpvzka/"
        "b/open-modeldb-files/o/4x-FatePlus-lite.pth",
        "ESRGAN",
        "CC-BY-NC-SA-4.0",
    ),
    "apisr-x4": ModelSpec(
        "apisr-x4",
        "4x_APISR_RRDB_GAN_generator.pth",
        "https://github.com/Kiteretsu77/APISR/releases/download/v0.2.0/"
        "4x_APISR_RRDB_GAN_generator.pth",
        "RRDB",
        "GPL-3.0; upstream model disclaimer applies",
    ),
    "realesrgan-anime-x4": ModelSpec(
        "realesrgan-anime-x4",
        "RealESRGAN_x4plus_anime_6B.pth",
        MODEL_URL,
        "RRDB",
        "BSD-3-Clause",
    ),
}

DIRECTML_RECIPE_MODELS = (
    "fateplus-lite-x4",
    "apisr-x4",
    "hat-classical-x4",
    "realesrgan-anime-x4",
)


@dataclass(frozen=True)
class Asset:
    src: Path
    rel: Path


def portrait_cell_max_edge(src: Path, atlas: bool) -> int | None:
    """Return the largest decoded portrait cell edge, or None when unknown."""
    manifest_path = src.with_suffix(".json")
    try:
        if atlas:
            boxes = portrait_atlas_regions(src)
            edges = [max(x1 - x0, y1 - y0) for x0, y0, x1, y1 in boxes]
        else:
            data = json.loads(manifest_path.read_text())
            records = data["ids"] if isinstance(data.get("ids"), dict) else data
            edges = [
                max(int(layer.get("w", 0)), int(layer.get("h", 0)))
                for record in records.values()
                if isinstance(record, dict)
                for layer in record.get("layers", []) or []
            ]
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return max(edges) if edges else None


# Overworld AI (default on since 2026-10-27; --no-overworld-ai turns it off): field character sheets and the stage prop sheets go through
# the map model one FRAME at a time instead of staying exact pixels.  Frames on these sheets touch
# (15,875 of 15,881 prop rects lie within 2 px of another), so a whole-sheet pass would bleed one
# frame into the next; each frame is inferred alone with its own edges reflected as context.
OVERWORLD_AI = True
CELL_MODELS = ["fateplus-lite-x4", "hat-classical-x4", "realesrgan-anime-x4"]


def _stage_sheet(rel: Path) -> tuple[str, bool] | None:
    """effects/s200.png -> ("s200", False); effects/s200_semi.png -> ("s200", True)."""
    match = re.fullmatch(r"effects/(s\d+)(_semi)?\.png", rel.as_posix())
    return (match.group(1), bool(match.group(2))) if match else None


@functools.lru_cache(maxsize=4)
def _read_json(path: str):
    return json.loads(Path(path).read_text())


def cell_regions(src: Path, rel: Path) -> list[tuple[int, int, int, int]]:
    """The frames of a field sheet: prop rects from data/point_sprites.json, or the frame grid that
    manifest.json gives a character sheet.  Empty when the sheet has no known frames."""
    from PIL import Image

    root = src.parents[len(rel.parts) - 1]
    with Image.open(src) as image:
        width, height = image.size
    boxes: set[tuple[int, int, int, int]] = set()
    stage = _stage_sheet(rel)
    if stage:
        sprites = _read_json(str(root / "data/point_sprites.json")).get(stage[0], {}).get("sprites", {})
        for layers in sprites.values():
            for layer in layers:
                x0, y0 = max(0, int(layer["x"])), max(0, int(layer["y"]))
                x1 = min(width, int(layer["x"]) + int(layer["w"]))
                y1 = min(height, int(layer["y"]) + int(layer["h"]))
                if x1 > x0 and y1 > y0:
                    boxes.add((x0, y0, x1, y1))
    elif rel.parts and rel.parts[0] == "sprites":
        manifest = _read_json(str(root / "manifest.json"))
        wanted = "assets/" + rel.as_posix()
        for entry in manifest.get("characters", []) + manifest.get("npcs", []):
            for sheet, fw_key, fh_key in (("sheet", "frameW", "frameH"), ("clipSheet", "clipFrameW", "clipFrameH")):
                if entry.get(sheet) == wanted and entry.get(fw_key) and entry.get(fh_key):
                    fw, fh = int(entry[fw_key]), int(entry[fh_key])
                    boxes |= {
                        (x, y, min(width, x + fw), min(height, y + fh))
                        for y in range(0, height, fh) for x in range(0, width, fw)
                    }
    return sorted(boxes, key=lambda box: (box[1], box[0], box[3], box[2]))


def upscale_cells(src: Path, rel: Path, image, recipe: dict, **model_args):
    """Nearest-scale the sheet, then replace each frame with its own AI upscale.

    A stage prop sheet's plain and blended (_semi) halves never share a texel, so both are inferred
    from their union (same colours on both sides of the split) and each keeps only its own alpha."""
    import numpy as np
    from PIL import Image

    own = image.convert("RGBA")
    colour = own
    stage = _stage_sheet(rel)
    if stage:
        other = src.with_name(f"{stage[0]}.png" if stage[1] else f"{stage[0]}_semi.png")
        if other.is_file():
            with Image.open(other) as companion:
                companion = companion.convert("RGBA")
            if companion.size == own.size:
                merged = np.asarray(own).copy()
                extra = np.asarray(companion)
                take = (merged[..., 3] == 0) & (extra[..., 3] > 0)
                merged[take] = extra[take]
                colour = Image.fromarray(merged, "RGBA")
    base, alpha_mode = nearest_upscale(own)
    inference = {"method": "ai", "models": recipe["models"]}
    used = set()
    for box in cell_regions(src, rel):
        own_alpha = own.crop(box).getchannel("A")
        if own_alpha.getextrema()[1] == 0:
            continue                                   # nothing of this sheet in this frame
        high, scale, _alpha, model_used = upscale_with_models(colour.crop(box), inference, **model_args)
        if scale != SCALE:
            raise ValueError(f"frame model returned scale {scale}")
        high = high.convert("RGBA")
        # exact 4x transparency, also for sheets with half-transparent texels (alpha 127): the game's
        # pixel outline stays where it was and the AI only redraws the colours inside it
        high.putalpha(own_alpha.resize(high.size, Image.Resampling.NEAREST))
        base.paste(high, (box[0] * SCALE, box[1] * SCALE))
        used.add(model_used)
    model_used = "+".join(sorted(used)) if used else "nearest"
    return base, SCALE, alpha_mode, f"{model_used}-frames"


def asset_class(rel: Path, src: Path | None = None) -> str:
    """Conservatively classify a runtime raster from its canonical build path."""
    path = rel.as_posix().lower()
    root = rel.parts[0].lower() if rel.parts else ""
    name = rel.name.lower()
    source = src if src is not None else DEFAULT_SRC / rel
    if root in {"maps", "bg_override", "thumbs"}:
        return "map"
    if "portrait" in name:
        return _portrait_class(source, "portrait", atlas=False)
    if root == "ui" and name == "ststat_sheet.png":
        return _portrait_class(source, "portrait-atlas", atlas=True)
    if OVERWORLD_AI and root == "sprites":
        return "sprite-frames"
    if OVERWORLD_AI and _stage_sheet(rel):
        return "prop-frames"
    if root in {"sprites", "effects", "cards"}:
        return "tiny-sprite"
    if path.startswith("battle/effects/"):
        return "tiny-sprite"
    if path.startswith("battle/arenas/"):
        return "arena-palette"
    if path.startswith("battle/textures/") or path.startswith("battle/backdrops/"):
        return "medium-prerendered"
    if root == "ui" or name in {"title_logo.png"}:
        # Screen-pack sheets can contain text and portraits in one atlas.  Only
        # explicitly separated portrait sheets are safe to send through AI.
        return "ui-text"
    return "medium-prerendered"


def _portrait_class(src: Path, kind: str, *, atlas: bool) -> str:
    """Downgrade a portrait sheet to exact scaling when its cells are tiny."""
    edge = portrait_cell_max_edge(src, atlas)
    if edge is not None and edge <= MAX_NEAREST_PORTRAIT_CELL:
        return "portrait-tiny"
    return kind


def processing_recipe(
    rel: Path, _legacy_strength: float | None = None, src: Path | None = None
) -> dict:
    """Return the deterministic HD recipe and ordered inference fallbacks."""
    kind = asset_class(rel, src)
    if kind in {"tiny-sprite", "ui-text", "portrait-tiny"}:
        return {"assetClass": kind, "method": "nearest", "models": []}
    if kind in {"sprite-frames", "prop-frames"}:
        return {"assetClass": kind, "method": "ai-frames", "models": list(CELL_MODELS)}
    if kind == "map":
        models = ["fateplus-lite-x4", "hat-classical-x4", "realesrgan-anime-x4"]
    elif kind in {"portrait", "portrait-atlas"}:
        models = ["apisr-x4", "hat-classical-x4", "realesrgan-anime-x4"]
    else:
        models = ["fateplus-lite-x4", "hat-classical-x4", "realesrgan-anime-x4"]
    method = "portrait-atlas" if kind == "portrait-atlas" else "ai"
    recipe = {"assetClass": kind, "method": method, "models": models}
    if kind == "arena-palette":
        # One arena page is decoded once per palette, and regions drawn with OTHER palettes touch the
        # ones this file is drawn for (42 of 43 multi-palette pages, 0 texels apart).  Those foreign
        # texels hold wrong colours; the model would smear them across the drawn edges.  Only the
        # texels this palette draws are kept; the rest are filled from them before inference.
        recipe["fill"] = "arena-clut-mask"
    return recipe


def processing_matches(
    record: dict | None, recipe: dict, required_backend: str | None = None
) -> bool:
    """Check recipe identity and prevent Vulkan fallbacks masking DirectML work."""
    if not record:
        return False
    actual = record.get("processing", {"method": "ai"})
    if actual != recipe:
        return False
    if required_backend == "torch" and recipe["method"] != "nearest":
        return (
            record.get("backend") != "ncnn-vulkan"
            and record.get("modelUsed") != "nearest"
        )
    return True


def record_for(
    rel: Path, size: list[int], scale: int, src: Path | None = None, **extra
) -> dict:
    record = {
        "path": rel.as_posix(),
        "sourceSize": size,
        "scale": scale,
        "processing": processing_recipe(rel, src=src),
    }
    record.update(extra)
    return record


def format_duration(seconds: float) -> str:
    total = max(0, round(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def progress_line(
    completed: int,
    total: int,
    *,
    processed_work: int,
    total_work: int,
    elapsed: float,
    width: int = 30,
) -> str:
    """Return an asset-count bar with a pixel-weighted remaining-time estimate."""
    ratio = completed / total if total else 1.0
    filled = min(width, max(0, int(ratio * width)))
    bar = "#" * filled + "-" * (width - filled)
    if processed_work > 0 and total_work > processed_work and elapsed > 0:
        rate = processed_work / elapsed
        eta = format_duration((total_work - processed_work) / rate)
    elif total_work <= processed_work:
        eta = "00:00:00"
    else:
        eta = "calculating..."
    return (
        f"Progress [{bar}] {completed}/{total} ({ratio * 100:5.1f}%)"
        f" | elapsed {format_duration(elapsed)} | ETA {eta}"
    )


def hd_dimensions_supported(size: list[int], scale: int = 4) -> bool:
    return all(dimension * scale <= MAX_HD_DIMENSION for dimension in size)


def _matches(rel: Path, patterns: Iterable[str]) -> bool:
    posix = rel.as_posix()
    return any(fnmatch.fnmatchcase(posix, pattern) for pattern in patterns)


def discover_assets(
    src_dir: Path,
    out_dir: Path,
    *,
    includes: tuple[str, ...] = (),
    excludes: tuple[str, ...] = (),
    include_reference: bool = False,
) -> tuple[list[Asset], list[Path]]:
    """Return processable runtime images and default-excluded reference images."""
    src_dir = src_dir.resolve()
    out_dir = out_dir.resolve()
    assets: list[Asset] = []
    default_excluded: list[Path] = []
    dead: list[Path] = []
    if not src_dir.is_dir():
        raise FileNotFoundError(f"asset source directory does not exist: {src_dir}")

    for path in sorted(src_dir.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in RASTER_SUFFIXES:
            continue
        # src_dir is already resolved, so rglob yields real paths; resolving each file again costs a
        # filesystem round trip per file (minutes over the Windows -> WSL share).
        resolved = path
        if out_dir != src_dir and out_dir in resolved.parents:
            continue
        rel = resolved.relative_to(src_dir)
        is_reference = (
            bool(rel.parts and rel.parts[0] in DEFAULT_EXCLUDED_DIRS)
            or rel.name.lower().endswith("_test.png")
        )
        if is_reference and not include_reference:
            default_excluded.append(rel)
            continue
        if _matches(rel, DEAD_ASSET_PATTERNS) or _matches(rel, DEV_ONLY_PATTERNS):
            dead.append(rel)
            continue
        if includes and not _matches(rel, includes):
            continue
        if excludes and _matches(rel, excludes):
            continue
        assets.append(Asset(resolved, rel))
    return assets, default_excluded, dead


def _download_google_drive(file_id: str, destination: Path) -> None:
    try:
        import gdown
    except ImportError as exc:
        raise RuntimeError(
            "Google Drive model download requires gdown; install it with "
            "'pip install gdown' or use the Windows HD launcher"
        ) from exc
    result = gdown.download(id=file_id, output=str(destination), quiet=False)
    if not result:
        raise RuntimeError(f"Google Drive download failed for {destination.name}")


def ensure_model(spec: ModelSpec | None = None, cache: Path = CACHE) -> Path:
    spec = spec or MODEL_SPECS["realesrgan-anime-x4"]
    destination = cache / spec.filename
    legacy = LEGACY_MODEL_PATH if spec.key == "realesrgan-anime-x4" else None
    for candidate in (destination, legacy):
        if candidate and candidate.exists() and candidate.stat().st_size > 1_000_000:
            return candidate
    cache.mkdir(parents=True, exist_ok=True)
    partial = destination.with_suffix(destination.suffix + ".download")
    print(f"downloading {spec.key} -> {destination} ...", flush=True)
    try:
        if spec.url.startswith("gdrive:"):
            _download_google_drive(spec.url.removeprefix("gdrive:"), partial)
        else:
            urllib.request.urlretrieve(spec.url, partial)
        if partial.stat().st_size <= 1_000_000:
            raise RuntimeError(f"downloaded model is unexpectedly small: {partial}")
        os.replace(partial, destination)
    finally:
        if partial.exists():
            partial.unlink()
    print(f"  got {destination.stat().st_size // 1024} KiB")
    return destination


@dataclass
class LoadedModel:
    descriptor: object
    device: object
    spec: ModelSpec
    directml_safe_forward: bool = False


_EXTRA_ARCHES_INSTALLED = False


def ensure_extra_arches_installed(installer=None) -> None:
    """Install Spandrel's process-global extra registry exactly once."""
    global _EXTRA_ARCHES_INSTALLED
    if _EXTRA_ARCHES_INSTALLED:
        return
    if installer is None:
        try:
            import spandrel_extra_arches
        except ImportError:
            return
        installer = spandrel_extra_arches.install
    # Some Spandrel releases may already have installed these through another
    # importer. Ignore those duplicates, but never repeatedly mutate the global
    # registry while walking a model fallback chain.
    installer(ignore_duplicates=True)
    _EXTRA_ARCHES_INSTALLED = True


def preferred_directml_device(names: list[str]) -> int:
    """Choose a discrete-vendor adapter and deliberately ignore Intel in auto mode."""
    scored = []
    for index, adapter_name in enumerate(names):
        lowered = adapter_name.lower()
        if "intel" in lowered:
            continue
        if "nvidia" in lowered or "geforce" in lowered or "quadro" in lowered:
            scored.append((0, index))
        elif "amd" in lowered or "radeon" in lowered:
            scored.append((1, index))
    if not scored:
        available = ", ".join(f"[{i}] {value}" for i, value in enumerate(names))
        raise RuntimeError(
            "no AMD or Nvidia DirectML adapter found"
            + (f"; detected: {available}" if available else "")
        )
    return min(scored)[1]


def torch_device(name: str, device_index: int | None = None):
    import torch

    if name == "cpu":
        return torch.device("cpu")
    if name == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested but no CUDA device is available")
        return torch.device("cuda")
    if name == "directml":
        try:
            import torch_directml
        except ImportError as exc:
            raise RuntimeError(
                "DirectML requires torch-directml; use tools/build-hd-assets.ps1"
            ) from exc
        count = torch_directml.device_count()
        names = [torch_directml.device_name(index) for index in range(count)]
        selected = (
            device_index
            if device_index is not None
            else preferred_directml_device(names)
        )
        if not 0 <= selected < count:
            raise RuntimeError(
                f"DirectML device index {selected} is invalid; detected {count} adapters"
            )
        print(f"DirectML GPU [{selected}]: {names[selected]}", flush=True)
        return torch_directml.device(selected)
    if name == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    raise ValueError(f"unknown torch device: {name}")


def load_model(
    spec: ModelSpec | None = None,
    *,
    device_name: str = "auto",
    device_index: int | None = None,
    cache: Path = CACHE,
):
    try:
        import torch
        from spandrel import ImageModelDescriptor, ModelLoader
    except ImportError as exc:
        sys.exit(
            "missing ML dependencies; run through uv as shown in --help "
            f"({exc.name} is not installed)"
        )
    ensure_extra_arches_installed()
    spec = spec or MODEL_SPECS["realesrgan-anime-x4"]
    model = ModelLoader().load_from_file(str(ensure_model(spec, cache)))
    if not isinstance(model, ImageModelDescriptor):
        raise TypeError(f"not an image SR model: {type(model)}")
    device = torch_device(device_name, device_index)
    model.to(device).eval()
    return LoadedModel(
        model,
        device,
        spec,
        directml_safe_forward=device_name.lower() == "directml",
    )


def dilate_fill(rgb, mask, iterations: int):
    """Grow opaque edge colors without wrapping across opposite image edges."""
    import numpy as np

    rgb = rgb.astype(np.float32).copy()
    known = mask.copy()
    height, width = known.shape
    for _ in range(iterations):
        if known.all():
            break
        acc = np.zeros_like(rgb)
        count = np.zeros((height, width), dtype=np.float32)
        for ys, yd, xs, xd in (
            (slice(0, -1), slice(1, None), slice(None), slice(None)),
            (slice(1, None), slice(0, -1), slice(None), slice(None)),
            (slice(None), slice(None), slice(0, -1), slice(1, None)),
            (slice(None), slice(None), slice(1, None), slice(0, -1)),
        ):
            take = known[ys, xs] & ~known[yd, xd]
            acc[yd, xd][take] += rgb[ys, xs][take]
            count[yd, xd][take] += 1
        new = count > 0
        rgb[new] = acc[new] / count[new, None]
        known |= new
    return rgb


def descriptor_forward(descriptor, tensor, *, directml_safe: bool):
    """Run a descriptor without Spandrel inference tensors on DirectML."""
    if directml_safe:
        return descriptor._call_fn(descriptor.model, tensor).clamp(0, 1)
    return descriptor(tensor).clamp(0, 1)


@contextlib.contextmanager
def directml_compatibility_ops(torch_module, enabled: bool):
    """Work around DirectML rejecting semantically empty cat operands."""
    if not enabled:
        yield
        return
    native_cat = torch_module.cat

    def cat_without_empty(tensors, *args, **kwargs):
        values = tuple(tensors)
        nonempty = tuple(tensor for tensor in values if tensor.numel() != 0)
        return native_cat(nonempty or values, *args, **kwargs)

    torch_module.cat = cat_without_empty
    try:
        yield
    finally:
        torch_module.cat = native_cat


def sr_rgb(model, rgb01):
    import torch

    descriptor = model.descriptor if isinstance(model, LoadedModel) else model
    device = model.device if isinstance(model, LoadedModel) else torch.device("cpu")
    tensor = (
        torch.from_numpy(rgb01.transpose(2, 0, 1))
        .unsqueeze(0)
        .float()
        .to(device)
    )
    with torch.no_grad():
        directml_safe = (
            isinstance(model, LoadedModel) and model.directml_safe_forward
        )
        # Spandrel 0.4.x decorates ImageModelDescriptor.__call__ with
        # torch.inference_mode() and finishes with clamp_(). DirectML cannot
        # update the version counter of that inference tensor. The DirectML-safe
        # branch calls the decoded model function under no_grad and uses a
        # non-mutating clamp, preserving the model math without inference tensors.
        with directml_compatibility_ops(torch, directml_safe):
            result = descriptor_forward(
                descriptor, tensor, directml_safe=directml_safe
            )
        result = result[0].cpu().numpy().transpose(1, 2, 0)
    return result


def alpha_resampling(alpha) -> tuple[object, str]:
    """Select exact edges for binary alpha and smooth interpolation otherwise."""
    from PIL import Image

    extrema = alpha.getextrema()
    if extrema in ((0, 0), (255, 255)):
        return Image.Resampling.NEAREST, "binary"
    colors = alpha.getcolors(maxcolors=257)
    if colors is not None and all(value in (0, 255) for _count, value in colors):
        return Image.Resampling.NEAREST, "binary"
    return Image.Resampling.BICUBIC, "soft"


def _pad_to_multiple(rgb, multiple: int):
    import numpy as np

    if multiple <= 1:
        return rgb
    add_h = (-rgb.shape[0]) % multiple
    add_w = (-rgb.shape[1]) % multiple
    if not add_h and not add_w:
        return rgb
    mode = "reflect" if rgb.shape[0] > 1 and rgb.shape[1] > 1 else "edge"
    return np.pad(rgb, ((0, add_h), (0, add_w), (0, 0)), mode=mode)


def arena_palette_mask(src: Path, margin: int = 2):
    """Texels of an arena palette page that the game draws WITH this palette, or None.

    `battle/arenas/<pack>/<page>_c<col>_r<row>.png` is one atlas page decoded with one palette; the
    pack's geometry.json lists every triangle with its page, palette (clut) and UVs (0..1 of the
    page).  Texel centres inside those triangles are drawn; `margin` texels around them are kept too
    (bilinear sampling and the 4x texture read one texel past an edge)."""
    import re

    import numpy as np

    match = re.fullmatch(r"(floor|wall)_c(\d+)_r(\d+)\.png", src.name)
    geometry = src.parent / "geometry.json"
    if not match or not geometry.is_file():
        return None
    page, col, row = match.group(1), int(match.group(2)), int(match.group(3))
    from PIL import Image

    with Image.open(src) as image:
        width, height = image.size
    groups = json.loads(geometry.read_text()).get("groups", [])
    mask = np.zeros((height, width), dtype=bool)
    ys, xs = np.mgrid[0:height, 0:width]
    cx, cy = xs + 0.5, ys + 0.5
    for group in groups:
        clut = group.get("clut") or [0, 255]
        if (group.get("page") or "wall") != page or [int(clut[0]), int(clut[1])] != [col, row]:
            continue
        uv = group.get("uv") or []
        for t in range(0, len(uv) - 5, 6):
            ax, ay = uv[t] * width, uv[t + 1] * height
            bx, by = uv[t + 2] * width, uv[t + 3] * height
            qx, qy = uv[t + 4] * width, uv[t + 5] * height
            x0, x1 = int(max(0, min(ax, bx, qx) - 1)), int(min(width, max(ax, bx, qx) + 2))
            y0, y1 = int(max(0, min(ay, by, qy) - 1)), int(min(height, max(ay, by, qy) + 2))
            if x0 >= x1 or y0 >= y1:
                continue
            px, py = cx[y0:y1, x0:x1], cy[y0:y1, x0:x1]
            e0 = (bx - ax) * (py - ay) - (by - ay) * (px - ax)
            e1 = (qx - bx) * (py - by) - (qy - by) * (px - bx)
            e2 = (ax - qx) * (py - qy) - (ay - qy) * (px - qx)
            inside = ((e0 >= 0) & (e1 >= 0) & (e2 >= 0)) | ((e0 <= 0) & (e1 <= 0) & (e2 <= 0))
            mask[y0:y1, x0:x1] |= inside
            # a triangle thinner than a texel (the disc has flat ones that stretch one texel row)
            # still marks every texel its edges run through
            for (sx, sy), (tx, ty) in (((ax, ay), (bx, by)), ((bx, by), (qx, qy)), ((qx, qy), (ax, ay))):
                steps = int(max(abs(tx - sx), abs(ty - sy)) * 2) + 1
                for k in range(steps + 1):
                    ex, ey = sx + (tx - sx) * k / steps, sy + (ty - sy) * k / steps
                    mask[min(height - 1, max(0, int(ey))), min(width - 1, max(0, int(ex)))] = True
    if not mask.any():
        return None
    for _ in range(margin):
        grown = mask.copy()
        grown[1:, :] |= mask[:-1, :]
        grown[:-1, :] |= mask[1:, :]
        grown[:, 1:] |= mask[:, :-1]
        grown[:, :-1] |= mask[:, 1:]
        mask = grown
    return mask


def upscale_image(model, image, *, tile: int, overlap: int, dilate: int, fill_mask=None):
    """Return tiled SR with reflective context, cropped halos, and separate alpha.

    `fill_mask` (bool array, source size) marks the only texels whose colours are real; every other
    texel is replaced by its nearest real neighbour colour before inference (alpha is unchanged)."""
    import numpy as np
    from PIL import Image

    has_alpha = image.mode in ("RGBA", "LA") or "transparency" in image.info
    source = image.convert("RGBA" if has_alpha else "RGB")
    width, height = source.size
    output = None
    scale = None
    pixels = np.asarray(source, dtype=np.float32) / 255.0
    rgb_source = pixels[..., :3]
    # Only this rectangle is inferred.  With a fill mask it is the bounding box of the masked texels;
    # nothing outside it is drawn, so that part keeps the filled colours at 4x nearest.
    rx0, ry0, rx1, ry1 = 0, 0, width, height
    if fill_mask is not None:
        known = fill_mask & (pixels[..., 3] > 0.0) if has_alpha else fill_mask
        if known.any():
            rgb_source = dilate_fill(rgb_source, known, width + height)
            rows, cols = np.nonzero(fill_mask)
            rx0, rx1 = max(0, int(cols.min()) - 1), min(width, int(cols.max()) + 2)
            ry0, ry1 = max(0, int(rows.min()) - 1), min(height, int(rows.max()) + 2)
    elif has_alpha:
        rgb_source = dilate_fill(rgb_source, pixels[..., 3] > 0.0, dilate)
    pad_mode = "reflect" if width > 1 and height > 1 else "edge"
    padded = np.pad(
        rgb_source,
        ((overlap, overlap), (overlap, overlap), (0, 0)),
        mode=pad_mode,
    )
    multiple = model.spec.input_multiple if isinstance(model, LoadedModel) else 1
    alpha_filter = alpha_kind = None
    if has_alpha:
        alpha_filter, alpha_kind = alpha_resampling(source.getchannel("A"))

    for y0 in range(ry0, ry1, tile):
        y1 = min(y0 + tile, ry1)
        for x0 in range(rx0, rx1, tile):
            x1 = min(x0 + tile, rx1)
            patch_h = y1 - y0 + overlap * 2
            patch_w = x1 - x0 + overlap * 2
            rgb = padded[y0 : y1 + overlap * 2, x0 : x1 + overlap * 2]
            padded_rgb = _pad_to_multiple(rgb, multiple)
            high = sr_rgb(model, padded_rgb)
            patch_scale_x = high.shape[1] // padded_rgb.shape[1]
            patch_scale_y = high.shape[0] // padded_rgb.shape[0]
            if patch_scale_x != patch_scale_y or patch_scale_x < 1:
                raise ValueError(
                    f"model returned unexpected shape {high.shape} for "
                    f"{(padded_rgb.shape[1], padded_rgb.shape[0])}"
                )
            if scale is None:
                scale = patch_scale_x
                output = Image.new(source.mode, (width * scale, height * scale))
                if (rx0, ry0, rx1, ry1) != (0, 0, width, height):
                    filled = Image.fromarray(
                        (np.clip(rgb_source, 0, 1) * 255).round().astype(np.uint8), "RGB"
                    ).resize((width * scale, height * scale), Image.Resampling.NEAREST)
                    if has_alpha:
                        filled = filled.convert("RGBA")
                        filled.putalpha(source.getchannel("A").resize(
                            (width * scale, height * scale), alpha_filter))
                    output.paste(filled, (0, 0))
            elif scale != patch_scale_x:
                raise ValueError("model scale changed between tiles")

            # Discard model padding and the entire overlap halo. Adjacent cores
            # are cut from one globally padded source, so no blend seam remains.
            crop_box = (
                overlap * scale,
                overlap * scale,
                (patch_w - overlap) * scale,
                (patch_h - overlap) * scale,
            )
            core_rgb = high[crop_box[1] : crop_box[3], crop_box[0] : crop_box[2]]
            core_u8 = (np.clip(core_rgb, 0, 1) * 255).round().astype(np.uint8)
            if has_alpha:
                alpha_core = source.getchannel("A").crop((x0, y0, x1, y1))
                alpha_high = alpha_core.resize(
                    ((x1 - x0) * scale, (y1 - y0) * scale), alpha_filter
                )
                core = Image.fromarray(core_u8, "RGB").convert("RGBA")
                core.putalpha(alpha_high)
            else:
                core = Image.fromarray(core_u8, "RGB")
            output.paste(core, (x0 * scale, y0 * scale))

    if output is None or scale is None:
        raise ValueError("cannot upscale an empty image")
    return output, scale, alpha_kind


def apply_processing(source, ai_output, recipe: dict):
    """Apply a non-AI recipe or return the already inferred output."""
    from PIL import Image

    if recipe["method"] == "ai":
        return ai_output
    if recipe["method"] == "nearest":
        return source.resize(ai_output.size, Image.Resampling.NEAREST)
    if recipe["method"] != "nearest-ai-blend":
        raise ValueError(f"unknown processing method: {recipe['method']}")

    strength = float(recipe["aiStrength"])
    if not 0.0 <= strength <= 1.0:
        raise ValueError(f"AI blend strength must be between 0 and 1, got {strength}")
    nearest = source.convert(ai_output.mode).resize(
        ai_output.size, Image.Resampling.NEAREST
    )
    return Image.blend(nearest, ai_output, strength)


def _has_alpha(image) -> bool:
    return image.mode in ("RGBA", "LA") or "transparency" in image.info


def source_alpha_mode(image) -> str:
    if not _has_alpha(image):
        return "none"
    return alpha_resampling(image.convert("RGBA").getchannel("A"))[1]


def nearest_upscale(image):
    from PIL import Image

    source = image.convert("RGBA" if _has_alpha(image) else "RGB")
    return (
        source.resize((source.width * SCALE, source.height * SCALE), Image.Resampling.NEAREST),
        source_alpha_mode(source),
    )


def is_device_memory_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(fragment in text for fragment in (
        "not enough gpu video memory",
        "could not allocate tensor",
        "out of memory",
    ))


def tile_retry_sizes(requested: int) -> list[int]:
    """Return largest-first tiles down to 64px (or the requested size)."""
    minimum = min(64, requested)
    sizes = []
    current = requested
    while True:
        sizes.append(current)
        if current <= minimum:
            return sizes
        current = max(minimum, current // 2)


def upscale_with_models(
    image,
    recipe: dict,
    *,
    device_name: str,
    device_index: int | None,
    cache: Path,
    models: dict[str, LoadedModel],
    unavailable: dict[str, str],
    tile: int,
    overlap: int,
    dilate: int,
    tile_limits: dict[str, int] | None = None,
    fill_mask=None,
):
    """Run a model chain, adapting tile size without globally disabling on OOM."""
    if recipe["method"] == "nearest":
        high, alpha_mode = nearest_upscale(image)
        return high, SCALE, alpha_mode, "nearest"

    errors = []
    for key in recipe["models"]:
        if key in unavailable:
            errors.append(f"{key}: {unavailable[key]}")
            continue
        try:
            model = models.get(key)
            if model is None:
                model = load_model(
                    MODEL_SPECS[key],
                    device_name=device_name,
                    device_index=device_index,
                    cache=cache,
                )
                models[key] = model
            preferred_tile = (tile_limits or {}).get(key, tile)
            oom_errors = []
            attempts = tile_retry_sizes(preferred_tile)
            for attempt_index, attempt_tile in enumerate(attempts):
                try:
                    high, scale, alpha_mode = upscale_image(
                        model,
                        image,
                        tile=attempt_tile,
                        overlap=overlap,
                        dilate=dilate,
                        **({"fill_mask": fill_mask} if fill_mask is not None else {}),
                    )
                    if tile_limits is not None:
                        tile_limits[key] = attempt_tile
                    return high, scale, alpha_mode or "none", key
                except Exception as exc:
                    if not is_device_memory_error(exc):
                        raise
                    oom_errors.append(f"tile {attempt_tile}: {exc}")
                    gc.collect()
                    if attempt_index + 1 < len(attempts):
                        print(
                            f"  {key}: tile {attempt_tile} exceeded VRAM; "
                            f"retrying at {attempts[attempt_index + 1]}",
                            flush=True,
                        )
            reason = " | ".join(oom_errors)
            errors.append(f"{key}: {reason}")
            print(
                f"  {key} could not fit this asset at the minimum tile; "
                f"trying recipe fallback ({reason})",
                flush=True,
            )
            # This asset caused the memory failure. Keep the model available for
            # smaller later assets instead of poisoning the rest of the build.
            continue
        except Exception as exc:
            reason = f"{type(exc).__name__}: {exc}"
            unavailable[key] = reason
            errors.append(f"{key}: {reason}")
            print(f"  {key} unavailable; trying recipe fallback ({reason})", flush=True)
    raise RuntimeError("all models in recipe failed: " + " | ".join(errors))


def portrait_atlas_regions(image_path: Path) -> list[tuple[int, int, int, int]]:
    """Read the decoded ststat portrait rectangles without touching UI regions."""
    manifest_path = image_path.with_suffix(".json")
    data = json.loads(manifest_path.read_text())
    portrait_ids = {
        int(frame_id)
        for sequence in data.get("portraits", {}).values()
        for frame_id in sequence
    }
    regions = set()
    for frame_id in portrait_ids:
        record = data.get("ids", {}).get(str(frame_id), {})
        for layer in record.get("layers", []):
            x, y = int(layer["x"]), int(layer["y"])
            w, h = int(layer["w"]), int(layer["h"])
            if w > 0 and h > 0:
                regions.add((x, y, x + w, y + h))
    if not regions:
        raise ValueError(f"no decoded portrait regions in {manifest_path}")
    return sorted(regions, key=lambda box: (box[1], box[0], box[3], box[2]))


def upscale_portrait_atlas(
    image_path: Path,
    image,
    recipe: dict,
    **model_args,
):
    """Nearest-scale a mixed atlas, then replace only decoded portrait cells."""
    base, alpha_mode = nearest_upscale(image)
    used = []
    inference_recipe = {"method": "ai", "models": recipe["models"]}
    for box in portrait_atlas_regions(image_path):
        crop = image.crop(box)
        high, scale, _crop_alpha, model_used = upscale_with_models(
            crop, inference_recipe, **model_args
        )
        if scale != SCALE:
            raise ValueError(f"portrait model returned scale {scale}")
        base.paste(high, (box[0] * SCALE, box[1] * SCALE))
        used.append(model_used)
    model_used = used[0] if len(set(used)) == 1 else "+".join(sorted(set(used)))
    return base, SCALE, alpha_mode, f"nearest-ui+{model_used}-portraits"


def prepare_ncnn_input(src: Path, staged: Path, *, dilate: int) -> tuple[list[int], bool]:
    """Write an opaque RGB PNG for NCNN and return native size/alpha metadata."""
    import numpy as np
    from PIL import Image

    with Image.open(src) as image:
        has_alpha = _has_alpha(image)
        source = image.convert("RGBA" if has_alpha else "RGB")
        size = [source.width, source.height]
        pixels = np.asarray(source, dtype=np.float32)
        rgb = pixels[..., :3] / 255.0
        if has_alpha:
            rgb = dilate_fill(rgb, pixels[..., 3] > 0, dilate)
        rgb_u8 = (np.clip(rgb, 0, 1) * 255).round().astype(np.uint8)
        Image.fromarray(rgb_u8, "RGB").save(staged, format="PNG")
    return size, has_alpha


def finish_ncnn_output(
    src: Path,
    staged: Path,
    dst: Path,
    *,
    size: list[int],
    has_alpha: bool,
    recipe: dict | None = None,
) -> tuple[int, int]:
    """Restore native alpha, validate 4x output, and atomically save the asset."""
    from PIL import Image

    with Image.open(staged) as result:
        high = result.convert("RGB")
        expected = (size[0] * 4, size[1] * 4)
        if high.size != expected:
            raise ValueError(f"NCNN returned {high.size} for {src}; expected {expected}")
        if has_alpha:
            with Image.open(src) as source:
                native_alpha = source.convert("RGBA").getchannel("A")
                alpha_filter, _alpha_kind = alpha_resampling(native_alpha)
                alpha = native_alpha.resize(expected, alpha_filter)
            high = high.convert("RGBA")
            high.putalpha(alpha)
        with Image.open(src) as source:
            high = apply_processing(
                source,
                high,
                recipe or {"method": "ai"},
            )
        save_atomic(high, dst)
        return high.size


def run_ncnn_batch(
    exe: Path,
    batch: list[tuple[int, Asset, Path]],
    *,
    tile: int,
    dilate: int,
    jobs: str,
    sprite_ai_strength: float = 0.0,
    retry_invalid: bool = True,
) -> list[tuple[int, Asset, Path, list[int], tuple[int, int]]]:
    """Upscale a batch through one portable NCNN/Vulkan process."""
    exe = exe.resolve()
    if not exe.is_file():
        raise FileNotFoundError(f"NCNN executable does not exist: {exe}")

    completed = []
    with tempfile.TemporaryDirectory(prefix="ddw3-upscale-ncnn-") as raw:
        temp = Path(raw)
        inputs, outputs = temp / "input", temp / "output"
        inputs.mkdir()
        outputs.mkdir()
        metadata = []
        for slot, (index, asset, dst) in enumerate(batch):
            name = f"{slot:06d}.png"
            size, has_alpha = prepare_ncnn_input(
                asset.src, inputs / name, dilate=dilate
            )
            metadata.append((index, asset, dst, name, size, has_alpha))

        command = [
            str(exe),
            "-i", str(inputs),
            "-o", str(outputs),
            "-n", "realesrgan-x4plus-anime",
            "-s", "4",
            "-t", str(tile),
            "-j", jobs,
            "-f", "png",
        ]
        subprocess.run(command, cwd=exe.parent, check=True)

        invalid = []
        for index, asset, dst, name, size, has_alpha in metadata:
            staged = outputs / name
            valid = staged.is_file()
            if valid:
                try:
                    from PIL import Image

                    with Image.open(staged) as result:
                        valid = result.size == (size[0] * 4, size[1] * 4)
                        result.verify()
                except OSError:
                    valid = False
            if not valid:
                invalid.append((index, asset, dst))
                continue
            high_size = finish_ncnn_output(
                asset.src,
                staged,
                dst,
                size=size,
                has_alpha=has_alpha,
                recipe=processing_recipe(asset.rel, src=asset.src),
            )
            completed.append((index, asset, dst, size, high_size))

    if invalid:
        if not retry_invalid:
            paths = ", ".join(str(asset.rel) for _index, asset, _dst in invalid)
            raise RuntimeError(
                f"NCNN produced invalid output twice for: {paths}. "
                "Try a smaller -Tile value or update the AMD graphics driver."
            )
        for entry in invalid:
            print(f"NCNN output invalid for {entry[1].rel}; retrying it alone...", flush=True)
            completed.extend(
                run_ncnn_batch(
                    exe,
                    [entry],
                    tile=tile,
                    dilate=dilate,
                    jobs="1:1:1",
                    sprite_ai_strength=sprite_ai_strength,
                    retry_invalid=False,
                )
            )
    return completed


def output_is_current(src: Path, dst: Path, scale: int = 4) -> bool:
    if not dst.is_file() or dst.stat().st_mtime_ns < src.stat().st_mtime_ns:
        return False
    try:
        from PIL import Image

        with Image.open(src) as source, Image.open(dst) as output:
            return output.size == (source.width * scale, source.height * scale)
    except OSError:
        return False


def save_atomic(image, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    temp = dst.with_name(f".{dst.stem}.upscaling{dst.suffix}")
    try:
        save_image = image
        if dst.suffix.lower() in {".jpg", ".jpeg"} and image.mode != "RGB":
            save_image = image.convert("RGB")
        save_image.save(temp)
        os.replace(temp, dst)
    finally:
        if temp.exists():
            temp.unlink()


def write_manifest(
    out_dir: Path,
    records: list[dict],
    excluded: int,
    *,
    model: str = "asset-aware-v3",
    native_fallbacks: list[dict] | None = None,
    dead_assets: list[str] | None = None,
) -> None:
    manifest = {
        "version": 3,
        "model": model,
        "profile": "asset-aware",
        "models": {
            key: {
                "filename": spec.filename,
                "architecture": spec.architecture,
                "license": spec.license,
            }
            for key, spec in MODEL_SPECS.items()
        },
        "scale": 4,
        "sourceRoot": "web/assets",
        "excludedReferenceAssets": excluded,
        "excludedDeadAssets": dead_assets or [],
        "nativeFallbacks": native_fallbacks or [],
        "assets": records,
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "manifest.json"
    temp = out_dir / ".manifest.upscaling.json"
    temp.write_text(json.dumps(manifest, indent=2) + "\n")
    os.replace(temp, path)


def run_directml_smoke_test(
    *, device_index: int | None, cache: Path
) -> None:
    """Execute one small real inference through each specialist primary model."""
    from PIL import Image

    sample = Image.new("RGB", (32, 32), (73, 121, 167))
    print("DirectML specialist-model smoke test...", flush=True)
    for key in DIRECTML_RECIPE_MODELS:
        model = load_model(
            MODEL_SPECS[key],
            device_name="directml",
            device_index=device_index,
            cache=cache,
        )
        high, scale, _alpha = upscale_image(
            model, sample, tile=32, overlap=16, dilate=0
        )
        if scale != SCALE or high.size != (128, 128):
            raise RuntimeError(
                f"{key} smoke test returned {high.size} at scale {scale}"
            )
        print(f"  {key}: OK", flush=True)
    print("DirectML specialist recipe: ready", flush=True)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build a parallel asset-aware 4x HD tree for all runtime rasters.",
        epilog=(
            "ML run: ~/.local/bin/uv run --python 3.12 --with torch --with "
            "spandrel --with spandrel-extra-arches --with gdown --with pillow "
            "--with numpy python tools/upscale_assets.py"
        ),
    )
    parser.add_argument("--src-dir", type=Path, default=DEFAULT_SRC)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "--backend", choices=("auto", "torch", "ncnn"), default="auto",
        help="auto uses NCNN when --ncnn-exe or REALESRGAN_NCNN_EXE is set",
    )
    parser.add_argument(
        "--device", choices=("auto", "directml", "cuda", "cpu"), default="auto",
        help="torch inference device (Windows launcher defaults to directml)",
    )
    parser.add_argument(
        "--device-index", type=int,
        help="DirectML adapter index; automatic selection prefers Nvidia, then AMD",
    )
    parser.add_argument(
        "--model-cache", type=Path, default=CACHE,
        help="download/cache directory for specialist model weights",
    )
    parser.add_argument(
        "--ncnn-exe", type=Path,
        help="path to the portable realesrgan-ncnn-vulkan executable",
    )
    parser.add_argument(
        "--ncnn-batch", type=int, default=64,
        help="images per NCNN process (default: 64; bounds temporary disk use)",
    )
    parser.add_argument(
        "--ncnn-jobs", default="2:2:2", metavar="LOAD:PROC:SAVE",
        help="NCNN pipeline concurrency (default: 2:2:2)",
    )
    parser.add_argument(
        "--include", action="append", default=[], metavar="GLOB",
        help="only include relative paths matching this glob (repeatable)",
    )
    parser.add_argument(
        "--exclude", action="append", default=[], metavar="GLOB",
        help="exclude relative paths matching this glob (repeatable)",
    )
    parser.add_argument(
        "--include-reference", action="store_true",
        help="also process ref/ captures and diagnostic *_test.png files",
    )
    parser.add_argument("--dry-run", action="store_true", help="inventory only; do not load ML")
    parser.add_argument(
        "--directml-smoke-test",
        action="store_true",
        help="test every specialist and fallback model on DirectML, then exit",
    )
    parser.add_argument("--force", action="store_true", help="rebuild current outputs")
    parser.add_argument(
        "--sprite-ai-strength",
        type=float,
        default=0.0,
        metavar="0..1",
        help=(
            "deprecated compatibility option; tiny sprites are exact nearest-neighbour"
        ),
    )
    parser.add_argument(
        "--reuse-current-ai",
        action="store_true",
        help="deprecated; retained so older launch commands continue to parse",
    )
    parser.add_argument("--limit", type=int, help="process at most N matching assets")
    parser.add_argument(
        "--tile", type=int, default=DEFAULT_TILE,
        help=f"input tile size (default: {DEFAULT_TILE})",
    )
    parser.add_argument(
        "--overlap", type=int, default=DEFAULT_OVERLAP,
        help=f"reflective context in source pixels (default: {DEFAULT_OVERLAP})",
    )
    parser.add_argument("--dilate", type=int, default=16, help="transparent-edge fill passes")
    parser.add_argument(
        "--overworld-ai", action=argparse.BooleanOptionalAction, default=True,
        help="AI-upscale field character sheets and stage prop sheets frame by frame (default: on)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    global OVERWORLD_AI
    OVERWORLD_AI = bool(args.overworld_ai)
    if args.tile < 16 or args.overlap < 0 or args.dilate < 0:
        _parser().error("--tile must be >= 16; --overlap and --dilate must be >= 0")
    if args.src_dir.resolve() == args.out_dir.resolve():
        _parser().error("--out-dir must differ from --src-dir (native assets cannot be overwritten)")
    if args.ncnn_batch < 1:
        _parser().error("--ncnn-batch must be >= 1")
    if args.device_index is not None and args.device_index < 0:
        _parser().error("--device-index must be >= 0")
    if args.device_index is not None and args.device != "directml":
        _parser().error("--device-index is only valid with --device directml")
    if not 0.0 <= args.sprite_ai_strength <= 1.0:
        _parser().error("--sprite-ai-strength must be between 0 and 1")

    env_ncnn = os.environ.get("REALESRGAN_NCNN_EXE")
    ncnn_exe = args.ncnn_exe or (Path(env_ncnn) if env_ncnn else None)
    backend = args.backend
    if backend == "auto":
        backend = "ncnn" if ncnn_exe else "torch"
    if backend == "ncnn" and not ncnn_exe:
        _parser().error(
            "--backend ncnn requires --ncnn-exe or REALESRGAN_NCNN_EXE"
        )
    if args.directml_smoke_test:
        if backend != "torch" or args.device != "directml":
            _parser().error(
                "--directml-smoke-test requires --backend torch --device directml"
            )
        run_directml_smoke_test(
            device_index=args.device_index,
            cache=args.model_cache,
        )
        return 0

    assets, excluded, dead = discover_assets(
        args.src_dir,
        args.out_dir,
        includes=tuple(args.include),
        excludes=tuple(args.exclude),
        include_reference=args.include_reference,
    )
    if args.limit is not None:
        if args.limit < 0:
            _parser().error("--limit must be >= 0")
        assets = assets[: args.limit]

    category_counts: dict[str, int] = {}
    for asset in assets:
        category = asset_class(asset.rel, asset.src)
        category_counts[category] = category_counts.get(category, 0) + 1
    print(f"{len(assets)} runtime raster assets from {args.src_dir.resolve()}")
    for category, count in sorted(category_counts.items()):
        print(f"  {category:<16} {count:>5}")
    if excluded and not args.include_reference:
        print(f"  excluded refs/test {len(excluded):>5} (use --include-reference)")
    dead_paths = [rel.as_posix() for rel in dead]
    if dead:
        print(f"  excluded dead/dev-only {len(dead):>3} ({', '.join(DEAD_ASSET_PATTERNS + DEV_ONLY_PATTERNS)})")
    if args.dry_run:
        return 0
    if not assets:
        print("nothing to upscale")
        write_manifest(
            args.out_dir.resolve(), [], len(excluded),
            model="asset-aware-v3-ncnn-fallback" if backend == "ncnn" else "asset-aware-v3",
            dead_assets=dead_paths,
        )
        return 0

    from PIL import Image

    old_manifest_path = args.out_dir.resolve() / "manifest.json"
    old_manifest: dict = {}
    if old_manifest_path.is_file():
        try:
            old_manifest = json.loads(old_manifest_path.read_text())
        except (OSError, json.JSONDecodeError):
            old_manifest = {}
    old_records = {
        record.get("path"): record
        for record in old_manifest.get("assets", [])
        if isinstance(record, dict) and isinstance(record.get("path"), str)
    }

    records: list[dict] = []
    done = skipped = 0
    native_fallbacks: list[dict] = []
    pending: list[tuple[int, Asset, Path]] = []
    work_by_source: dict[Path, int] = {}
    for index, asset in enumerate(assets, 1):
        dst = args.out_dir.resolve() / asset.rel
        with Image.open(asset.src) as source:
            size = [source.width, source.height]
        if not hd_dimensions_supported(size):
            old_records.pop(asset.rel.as_posix(), None)
            native_fallbacks.append({
                "path": asset.rel.as_posix(),
                "sourceSize": size,
                "reason": "4x dimensions exceed safe 32767px image limit",
            })
            print(
                f"[{index}/{len(assets)}] {asset.rel}: native fallback "
                f"({size[0] * SCALE}x{size[1] * SCALE} exceeds safe image dimensions)",
                flush=True,
            )
            continue
        recipe = processing_recipe(asset.rel, src=asset.src)
        old_record = old_records.get(asset.rel.as_posix())
        if recipe["method"] == "nearest":
            # Exact pixels: a 4x nearest copy shows the same pixels as the native file (the game
            # draws native art unsmoothed) at 16x the download, so the pack only records it and the
            # game keeps the native file.  A copy left by an older build is removed.
            if dst.is_file():
                dst.unlink()
            record = record_for(
                asset.rel, size, SCALE, src=asset.src,
                modelUsed="nearest", backend="native", alphaMode="native", native=True,
            )
            records.append(record)
            old_records[record["path"]] = record
            skipped += 1
            continue
        if (
            not args.force
            and output_is_current(asset.src, dst)
            and processing_matches(old_record, recipe, backend)
        ):
            skipped += 1
            records.append(old_record)
            print(f"[{index}/{len(assets)}] {asset.rel}: current")
            continue
        work_by_source[asset.src] = size[0] * size[1]
        pending.append((index, asset, dst))

    total_work = sum(work_by_source.values())
    processed_work = 0
    started = time.monotonic()

    def checkpoint_manifest():
        checkpoint_fallbacks = {
            record.get("path"): record
            for record in old_manifest.get("nativeFallbacks", [])
            if isinstance(record, dict) and isinstance(record.get("path"), str)
        }
        checkpoint_fallbacks.update({record["path"]: record for record in native_fallbacks})
        write_manifest(
            args.out_dir.resolve(),
            sorted(old_records.values(), key=lambda record: record["path"]),
            len(excluded),
            model="asset-aware-v3-ncnn-fallback" if backend == "ncnn" else "asset-aware-v3",
            native_fallbacks=sorted(
                checkpoint_fallbacks.values(), key=lambda record: record["path"]
            ),
            dead_assets=dead_paths,
        )

    def report(index, asset, size, high, model_used, alpha_mode, backend_used):
        nonlocal done, processed_work
        record = record_for(
            asset.rel,
            size,
            SCALE,
            src=asset.src,
            modelUsed=model_used,
            backend=backend_used,
            alphaMode=alpha_mode,
        )
        records.append(record)
        old_records[record["path"]] = record
        done += 1
        processed_work += work_by_source[asset.src]
        print(
            f"[{index}/{len(assets)}] {asset.rel}: {size[0]}x{size[1]} -> "
            f"{high[0]}x{high[1]} [{model_used}; alpha={alpha_mode}]",
            flush=True,
        )
        if done % 16 == 0:
            checkpoint_manifest()

    ai_pending = list(pending)

    if backend == "ncnn":
        # The compatibility backend cannot target decoded sub-regions. Keep the
        # mixed status atlas exact rather than sending its glyphs through AI.
        ncnn_atlases = [
            entry
            for entry in ai_pending
            if processing_recipe(entry[1].rel, src=entry[1].src)["method"]
            in ("portrait-atlas", "ai-frames")
        ]
        ai_pending = [entry for entry in ai_pending if entry not in ncnn_atlases]
        for index, asset, dst in ncnn_atlases:
            with Image.open(asset.src) as source:
                size = [source.width, source.height]
                high, alpha_mode = nearest_upscale(source)
            save_atomic(high, dst)
            report(index, asset, size, high.size, "nearest", alpha_mode, "cpu")
        for start in range(0, len(ai_pending), args.ncnn_batch):
            batch = ai_pending[start : start + args.ncnn_batch]
            for index, asset, _dst, size, high_size in run_ncnn_batch(
                ncnn_exe,
                batch,
                tile=args.tile,
                dilate=args.dilate,
                jobs=args.ncnn_jobs,
            ):
                with Image.open(asset.src) as source:
                    alpha_mode = source_alpha_mode(source)
                report(
                    index, asset, size, high_size,
                    "realesrgan-anime-x4", alpha_mode, "ncnn-vulkan",
                )
    else:
        import hashlib
        import shutil
        from concurrent.futures import ThreadPoolExecutor

        models: dict[str, LoadedModel] = {}
        unavailable: dict[str, str] = {}
        tile_limits: dict[str, int] = {}
        # PNG encoding is ~1/3 of the GPU time per image and Pillow's encoder releases the GIL, so
        # it runs on a worker while the GPU does the next image (at most 3 images waiting).
        saver = ThreadPoolExecutor(max_workers=2)
        in_flight: list = []

        def drain(limit: int) -> None:
            while len(in_flight) > limit:
                future, done_args = in_flight.pop(0)
                future.result()
                report(*done_args)

        # Identical sources (same pixels, same recipe) are inferred once and the result copied.
        first_of: dict[tuple, tuple] = {}
        copies: list[tuple] = []
        unique: list[tuple] = []
        for entry in ai_pending:
            with Image.open(entry[1].src) as source:
                key = (
                    hashlib.sha1(
                        source.mode.encode() + repr(source.size).encode() + source.tobytes()
                    ).hexdigest(),
                    json.dumps(processing_recipe(entry[1].rel, src=entry[1].src), sort_keys=True),
                    # a palette mask depends on the page's geometry, not only on its pixels
                    entry[1].src.parent.as_posix() if "battle/arenas/" in entry[1].rel.as_posix() else "",
                    entry[1].rel.as_posix()
                    if processing_recipe(entry[1].rel, src=entry[1].src)["method"] == "ai-frames" else "",
                )
            if key in first_of:
                copies.append((entry, first_of[key]))
            else:
                first_of[key] = entry
                unique.append(entry)
        if copies:
            print(f"{len(copies)} identical sources will be copied, not inferred", flush=True)
        results: dict[Path, tuple] = {}
        for index, asset, dst in unique:
            recipe = processing_recipe(asset.rel, src=asset.src)
            with Image.open(asset.src) as source:
                size = [source.width, source.height]
                model_args = {
                    "device_name": args.device,
                    "device_index": args.device_index,
                    "cache": args.model_cache,
                    "models": models,
                    "unavailable": unavailable,
                    "tile_limits": tile_limits,
                    "tile": args.tile,
                    "overlap": args.overlap,
                    "dilate": args.dilate,
                }
                if recipe.get("fill") == "arena-clut-mask":
                    model_args["fill_mask"] = arena_palette_mask(asset.src)
                if recipe["method"] == "ai-frames":
                    high, scale, alpha_mode, model_used = upscale_cells(
                        asset.src, asset.rel, source, recipe, **model_args
                    )
                elif recipe["method"] == "portrait-atlas":
                    high, scale, alpha_mode, model_used = upscale_portrait_atlas(
                        asset.src, source, recipe, **model_args
                    )
                else:
                    high, scale, alpha_mode, model_used = upscale_with_models(
                        source, recipe, **model_args
                    )
            if scale != SCALE:
                raise ValueError(f"{model_used} returned scale {scale}; expected {SCALE}")
            results[asset.src] = (size, high.size, model_used, alpha_mode)
            in_flight.append((
                saver.submit(save_atomic, high, dst),
                (index, asset, size, high.size, model_used, alpha_mode, args.device),
            ))
            del high
            drain(3)
        drain(0)
        saver.shutdown()
        for (index, asset, dst), (_i, first, first_dst) in copies:
            size, high_size, model_used, alpha_mode = results[first.src]
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(first_dst, dst)
            report(index, asset, size, high_size, model_used, alpha_mode, args.device)

    print(
        progress_line(
            skipped + len(native_fallbacks) + done,
            len(assets),
            processed_work=processed_work,
            total_work=total_work,
            elapsed=time.monotonic() - started,
        ),
        flush=True,
    )

    partial = bool(args.include or args.exclude or args.limit is not None)
    if partial:
        selected_paths = {asset.rel.as_posix() for asset in assets}
        records = [
            record
            for path, record in old_records.items()
            if path not in selected_paths
        ] + records
        old_fallbacks = {
            record.get("path"): record
            for record in old_manifest.get("nativeFallbacks", [])
            if isinstance(record, dict) and isinstance(record.get("path"), str)
        }
        native_fallbacks = [
            record
            for path, record in old_fallbacks.items()
            if path not in selected_paths
        ] + native_fallbacks
    records.sort(key=lambda record: record["path"])
    write_manifest(
        args.out_dir.resolve(),
        records,
        len(excluded),
        model="asset-aware-v3-ncnn-fallback" if backend == "ncnn" else "asset-aware-v3",
        native_fallbacks=native_fallbacks,
        dead_assets=dead_paths,
    )
    print(
        f"done: {done} upscaled, {skipped} current, "
        f"{len(native_fallbacks)} native fallback -> {args.out_dir.resolve()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
