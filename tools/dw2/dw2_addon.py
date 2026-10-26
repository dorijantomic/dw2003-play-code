#!/usr/bin/env python3
"""The optional Digimon World 2 extras: the player's own DW2 disc -> the DW2 models the game uses.

    dw2_addon.py --disc <DW2 .bin/.iso> --converter <dw2_model_converter> --out <web/dw2models> [--work DIR] [--all]

1. dw2_disc.py reads the disc's AAA/4.AAA/MODEL folder (hidden from the root listing; found via the path table).
2. jype's dw2_model_converter (MIT, https://gitlab.com/jype/dw2_model_converter) turns every model + its
   animations into glTF (<stem>.gltf, texture inside).
3. The models in tools/dw2/needed.json are copied to --out (--all copies every one). A stamp file
   (.dw2-addon.json) records what was built. Nothing leaves the player's computer.

Checked 2026-10-26 on Digimon World 2 (USA): 395 models in ~6 s; 328QUNI and 033UNIM come out with the same
glTF content as the files the mount was built with.
"""
import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import dw2_disc  # noqa: E402

STAMP = ".dw2-addon.json"


def needed() -> dict:
    return json.loads((HERE / "needed.json").read_text(encoding="utf-8"))["models"]


def build(disc: Path, converter: Path, out: Path, work: Path, everything: bool = False, log=print) -> dict:
    err = dw2_disc.check(disc)
    if err:
        raise SystemExit(err)
    if not converter.is_file():
        raise SystemExit(f"the DW2 model converter is missing ({converter})")
    model_dir, gltf_dir = work / "MODEL", work / "gltf"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    t0 = time.time()
    with dw2_disc.Disc(disc) as d:
        n, volume = d.extract(dw2_disc.MODEL_DIR, model_dir), d.volume_id
    log(f"read {n} files from the disc's MODEL folder")
    r = subprocess.run([str(converter), str(model_dir), str(gltf_dir)], capture_output=True, text=True,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if r.returncode != 0:
        raise SystemExit(f"the DW2 model converter stopped (exit {r.returncode}): {r.stderr.strip()[-400:]}")
    made = sorted(p.stem for p in gltf_dir.glob("*.gltf"))
    log(f"converted {len(made)} models")
    want = made if everything else list(needed())
    missing = [m for m in want if m not in made]
    if missing:
        raise SystemExit(f"this disc did not give the models {', '.join(missing)}")
    out.mkdir(parents=True, exist_ok=True)
    for m in want:
        shutil.copy2(gltf_dir / f"{m}.gltf", out / f"{m}.gltf")
    stamp = {"models": want, "converted": len(made), "volume": volume,
             "seconds": round(time.time() - t0, 1), "built": time.strftime("%Y-%m-%dT%H:%M:%S")}
    (out / STAMP).write_text(json.dumps(stamp, indent=1), encoding="utf-8")
    shutil.rmtree(work, ignore_errors=True)
    log(f"DW2 extras ready: {len(want)} models in {out}")
    return stamp


def status(out: Path) -> dict | None:
    """The stamp when every needed model is present, else None."""
    try:
        stamp = json.loads((out / STAMP).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return stamp if all((out / f"{m}.gltf").is_file() for m in needed()) else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--disc", type=Path, required=True)
    ap.add_argument("--converter", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--work", type=Path)
    ap.add_argument("--all", action="store_true", help="copy every converted model, not only needed.json")
    a = ap.parse_args(argv)
    build(a.disc, a.converter, a.out, a.work or a.out.parent / "_dw2work", a.all)
    return 0


if __name__ == "__main__":
    sys.exit(main())
