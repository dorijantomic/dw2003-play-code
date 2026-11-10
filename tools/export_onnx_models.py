#!/usr/bin/env python3
"""Export the HD upscaler's models to ONNX, with a json (sha256, size, scale, buckets) next to each.

    python tools/export_onnx_models.py --out onnx-models [--cache DIR] [--only KEY ...]

release.yml runs this in CI and attaches the files to the GitHub release. A player's install downloads
the ones for its own version (tools/upscale_assets.py ensure_onnx), checks the sha256 and caches them,
so the ONNX Runtime path needs no torch. Needs torch, spandrel and onnx (CI only).

Only the models that export (input_multiple == 1) are written. HAT and ATD stay torch-only.
Also writes MODEL-LICENSES.txt: the licence, author and source of every model, with the credit that
CC-BY-NC-SA 4.0 requires for FatePlus-lite. Model weights are never committed to git.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import upscale_assets as up  # noqa: E402

# Verified against each model's source (2026-11-10):
#   FatePlus-lite  OpenModelDB data/models/4x-FatePlus-lite.json: author kim2091, CC-BY-NC-SA-4.0
#   Real-ESRGAN    github.com/xinntao/Real-ESRGAN LICENSE: BSD 3-Clause, (c) 2021 Xintao Wang
CREDITS = {
    "fateplus-lite-x4": ("4x-FatePlus-lite by kim2091", "https://openmodeldb.info/models/4x-FatePlus-lite",
                         "CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/). "
                         "Non-commercial. This ONNX file is an adapted (format-converted) copy and is shared "
                         "under the same licence."),
    "realesrgan-anime-x4": ("RealESRGAN_x4plus_anime_6B by Xintao Wang et al.",
                            "https://github.com/xinntao/Real-ESRGAN",
                            "BSD 3-Clause (Copyright (c) 2021 Xintao Wang)."),
}


def licences_text(infos: list[dict]) -> str:
    lines = ["Models used by the Digimon World 2003 HD Remaster (ONNX conversions of the originals).",
             "No model is part of the game's source repository; they are release downloads.", ""]
    for info in infos:
        credit, url, terms = CREDITS[info["key"]]
        lines += [f"{info['file']}  ({info['bytes']} bytes, sha256 {info['sha256']})",
                  f"  Credit:  {credit}", f"  Source:  {url}", f"  Licence: {terms}", ""]
    return chr(10).join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--cache", type=Path, default=up.CACHE, help="where the .pth weights are downloaded")
    ap.add_argument("--only", nargs="*", help="model keys (default: every exportable model)")
    a = ap.parse_args(argv)
    keys = a.only or [k for k, s in up.MODEL_SPECS.items() if s.input_multiple == 1]
    infos = []
    for key in keys:
        spec = up.MODEL_SPECS[key]
        if spec.input_multiple != 1 or key not in CREDITS:
            raise SystemExit(f"{key} cannot be exported (input_multiple {spec.input_multiple}) or has no credit entry")
        weights = up.ensure_model(spec, a.cache)
        _path, info = up.export_dynamic_onnx(weights, a.out, spec)
        infos.append(info)
        print(f"{key}: {info['bytes']} bytes sha256 {info['sha256']}", flush=True)
    (a.out / "MODEL-LICENSES.txt").write_text(licences_text(infos) + chr(10), encoding="utf-8")
    print(f"total {sum(i['bytes'] for i in infos)} bytes in {len(infos)} models -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
