#!/usr/bin/env python3
"""Render one source image through several configured SR models for visual QA."""
from __future__ import annotations

import argparse
import gc
import hashlib
import json
import shutil
import time
from pathlib import Path

import upscale_assets as up


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("source", type=Path)
    result.add_argument("out_dir", type=Path)
    result.add_argument(
        "--models",
        nargs="+",
        choices=tuple(up.MODEL_SPECS),
        default=[
            "atd-classical-x4",
            "fateplus-lite-x4",
            "realesrgan-anime-x4",
        ],
    )
    result.add_argument("--device", default="directml")
    result.add_argument("--device-index", type=int)
    result.add_argument("--model-cache", type=Path, default=up.CACHE)
    result.add_argument("--tile", type=int, default=up.DEFAULT_TILE)
    result.add_argument("--overlap", type=int, default=up.DEFAULT_OVERLAP)
    result.add_argument("--dilate", type=int, default=16)
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    authentic = args.out_dir / f"{args.source.stem}-authentic{args.source.suffix}"
    shutil.copy2(args.source, authentic)

    from PIL import Image

    results = []
    for key in args.models:
        started = time.monotonic()
        with Image.open(args.source) as source:
            size = [source.width, source.height]
            high, scale, alpha, used = up.upscale_with_models(
                source,
                {"method": "ai", "models": [key]},
                device_name=args.device,
                device_index=args.device_index,
                cache=args.model_cache,
                models={},
                unavailable={},
                tile_limits={},
                tile=args.tile,
                overlap=args.overlap,
                dilate=args.dilate,
            )
        output = args.out_dir / f"{args.source.stem}-{key}.png"
        up.save_atomic(high, output)
        elapsed = time.monotonic() - started
        results.append({
            "path": output.name,
            "modelUsed": used,
            "backend": args.device,
            "sourceSize": size,
            "outputSize": list(high.size),
            "scale": scale,
            "alphaMode": alpha,
            "seconds": round(elapsed, 3),
            "sha256": digest(output),
        })
        print(f"{key}: {elapsed:.1f}s -> {output}", flush=True)
        del high
        gc.collect()

    metadata = {
        "source": str(args.source),
        "authentic": authentic.name,
        "authenticSha256": digest(authentic),
        "tile": args.tile,
        "overlap": args.overlap,
        "results": results,
    }
    (args.out_dir / "comparison.json").write_text(
        json.dumps(metadata, indent=2) + "\n"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
