#!/usr/bin/env python3
"""The optional Digimon World 2 extras: the player's own DW2 disc -> the DW2 models the game uses.

    dw2_addon.py --disc <DW2 .bin/.iso> --converter <dw2_model_converter> --out <web/dw2models> [--work DIR] [--all]
                 [--motion --battle <web/assets/battle> [--cache DIR] [--node PATH]]

1. dw2_disc.py reads the disc's AAA/4.AAA/MODEL folder (hidden from the root listing; found via the path table).
2. jype's dw2_model_converter (MIT, https://gitlab.com/jype/dw2_model_converter) turns every model + its
   animations into glTF (<stem>.gltf, texture inside).
3. The models in tools/dw2/needed.json are copied to --out (--all copies every one). A stamp file
   (.dw2-addon.json) records what was built. Nothing leaves the player's computer.
4. --motion (needs the DW3 game built first, so both discs): DW2's battle animations for the DW3 Digimon that have a
   DW2 twin. Each twin's glTF -> our model format (tools/dw2_motion/convert_dw2.py), then
   tools/dw2_motion/retarget/build.mjs re-poses every DW2 clip on the DW3 body and writes <battle>/dw2motion/
   (the game plays them with DW2 motion on). Takes a while; the game keeps running.

Checked 2026-10-26 on Digimon World 2 (USA): 395 models in ~6 s; 328QUNI and 033UNIM come out with the same
glTF content as the files the mount was built with. The 108 twins convert to exactly the DW2 data the motions
were made from.
"""
import argparse
import json
import os
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


REPO = HERE.parent.parent
MOTION_STAMP = ".dw2-motion.json"


def build_motion(gltf_dir: Path, battle: Path, cache: Path, node: str | None = None, log=print) -> dict:
    """Step 4: the DW2 animations for the DW3 Digimon, from the DW2 glTF in gltf_dir and the DW3 models in battle/models."""
    if not (battle / "models").is_dir():
        raise SystemExit("the DW3 game is not built yet (no battle models): give the DW3 disc first")
    node = node or shutil.which("node")
    if not node:
        raise SystemExit("node (Node.js 18+) is needed for the DW2 animations")
    species = json.loads((REPO / "data/authored/dw2_motion/pairs.json").read_text(encoding="utf-8"))["species"]
    anim = cache / "dw2-anim"
    t0 = time.time()
    for s in species:
        g = gltf_dir / f"{s['dw2'].upper()}.gltf"
        if not g.is_file():
            raise SystemExit(f"this disc did not give the model {g.stem}")
        r = subprocess.run([sys.executable, str(REPO / "tools/dw2_motion/convert_dw2.py"), "--gltf", str(g), "--out", str(anim),
                            "--folder", f"dw2_{s['dw2']}"], capture_output=True, text=True,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if r.returncode != 0:
            raise SystemExit(f"converting {g.stem} stopped: {r.stderr.strip()[-300:]}")
    log(f"read the animations of {len(species)} DW2 Digimon; re-posing them on the DW3 bodies (this takes a while)")
    env = {**os.environ, "DW2M_GAME": str(battle), "DW2M_DW2": str(anim), "DW2M_WORK": str(cache / "dw2-motion-work")}
    p = subprocess.Popen([node, str(REPO / "tools/dw2_motion/retarget/build.mjs")], env=env, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    last = ""
    for line in p.stdout:
        last = line.rstrip()
        if last:
            log(last)
    if p.wait() != 0:
        raise SystemExit(f"the DW2 animation build stopped: {last}")
    shutil.rmtree(cache / "dw2-motion-work", ignore_errors=True)
    stamp = {"species": len(species), "seconds": round(time.time() - t0, 1), "built": time.strftime("%Y-%m-%dT%H:%M:%S"),
             "result": last}
    (battle / "dw2motion" / MOTION_STAMP).write_text(json.dumps(stamp, indent=1), encoding="utf-8")
    return stamp


def motion_status(battle: Path) -> dict | None:
    try:
        return json.loads((battle / "dw2motion" / MOTION_STAMP).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def build(disc: Path, converter: Path, out: Path, work: Path, everything: bool = False, log=print,
          motion_battle: Path | None = None, cache: Path | None = None, node: str | None = None) -> dict:
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
    log(f"DW2 extras ready: {len(want)} models in {out}")
    if motion_battle is not None:
        stamp["motion"] = build_motion(gltf_dir, motion_battle, cache or work.parent / "_dw2cache", node, log)
        log(f"DW2 animations ready: {stamp['motion']['result']}")
    shutil.rmtree(work, ignore_errors=True)
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
    ap.add_argument("--motion", action="store_true", help="also build the DW2 animations for the DW3 Digimon (needs --battle)")
    ap.add_argument("--battle", type=Path, help="the built DW3 game's web/assets/battle")
    ap.add_argument("--cache", type=Path, help="scratch space for the animation build")
    ap.add_argument("--node", help="the node executable (default: node on PATH)")
    a = ap.parse_args(argv)
    if a.motion and not a.battle:
        ap.error("--motion needs --battle")
    build(a.disc, a.converter, a.out, a.work or a.out.parent / "_dw2work", a.all,
          motion_battle=a.battle if a.motion else None, cache=a.cache, node=a.node)
    return 0


if __name__ == "__main__":
    sys.exit(main())
