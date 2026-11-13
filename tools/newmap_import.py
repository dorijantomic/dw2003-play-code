#!/usr/bin/env python3
"""Step 2 of a new Gemini-made field map: read what Gemini returned and make the map playable.

    python3 tools/newmap_import.py <folder> [--original-art] [--repo ROOT] [--check-only]

<folder> = the export folder (spec.json) holding map.png (picture) and walk.png (white = walkable, black = blocked).
Checks: both pictures have the spec's aspect (resized to the spec size when bigger/smaller), the walk mask is black/white,
every exit rectangle and the arrival spawn are walkable, and they are all one connected area (flood fill with the game's
12 x 8 foot box). Then it writes, in data/authored/web/assets/data/newmaps/ (our own data, committable):
  <id>.json            map record + scene (exit back to the neighbour) + the exit added to the neighbour
  <id>.collision.json  the game's collision grid (cell 8, rows of 0/1)
  index.json           the list of new maps (the game reads this at start)
and copies those files to web/assets/data/newmaps/ plus the picture to web/assets/maps/<id>.png (web/assets is git-ignored).
The picture is the user's Gemini art: it is NOT written into data/authored unless you pass --original-art.
Never runs tools/install_authored_data.py.
"""
import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from newmap_common import *  # noqa: E402,F401,F403
from PIL import Image  # noqa: E402

BLACK_FRACTION = 0.5     # a collision cell (8 x 8 px) is blocked when more than this share of its mask pixels are black


def fail(msg):
    print("newmap_import: " + msg, file=sys.stderr)
    sys.exit(2)


def find_pic(folder, stem):
    for ext in ("png", "webp", "jpg", "jpeg"):
        p = folder / f"{stem}.{ext}"
        if p.exists():
            return p
    fail(f"{folder}/{stem}.png is missing (save the Gemini picture there)")


def to_size(im, W, H, what, resample):
    if im.size == (W, H):
        return im
    if abs(im.width / im.height - W / H) > 0.02 * (W / H):
        fail(f"{what} is {im.width}x{im.height}, aspect differs from {W}x{H}; ask Gemini again with the size in the prompt")
    return im.resize((W, H), resample)


def mask_to_grid(mask, W, H):
    """mask: PIL 'L' image W x H, white walkable. Returns (Grid, grey_share)."""
    import numpy as np
    arr = np.asarray(mask, dtype=np.uint8)
    grey = float(((arr > 40) & (arr < 215)).sum()) / float(W * H)
    cols, rows = W // CELL, H // CELL
    black = (arr[:rows * CELL, :cols * CELL] < 128).reshape(rows, CELL, cols, CELL).sum(axis=(1, 3))
    blocked = black > BLACK_FRACTION * CELL * CELL
    return Grid(cols, rows, [bytearray(row.astype(np.uint8).tobytes()) for row in blocked]), grey


def check(spec, grid, W, H):
    """Returns (errors list, info dict)."""
    ok = grid.lattice()
    errs = []
    sp = spec["spawns"][0]
    sp_pt = (sp["x"] // STEP, sp["y"] // STEP)
    if sp_pt not in ok:
        errs.append(f"the arrival spawn ({sp['x']},{sp['y']}) is not walkable: the mask there is black/too narrow")
    comps = components(ok)
    comp_of = None
    for c in comps:
        if sp_pt in c:
            comp_of = c
            break
    area = len(comp_of) if comp_of else 0
    for k, e in enumerate(spec["exits"]):
        r = e["rect"]
        pts = rect_points(ok, r["x"], r["y"], r["w"], r["h"])
        if not pts:
            errs.append(f"exit {k} (to {e['to']}) rectangle {r} has no walkable ground: the mask must be white there")
        elif comp_of is None or not any(p in comp_of for p in pts):
            errs.append(f"exit {k} (to {e['to']}) rectangle {r} is walkable but NOT connected to the arrival spawn")
    info = {"walkable_points": len(ok), "connected_to_spawn": area,
            "walkable_share": round(len(ok) / float((W // STEP + 1) * (H // STEP + 1)), 3),
            "disconnected_points": len(ok) - area}
    if ok and area < 0.5 * len(ok):
        errs.append(f"only {area} of {len(ok)} walkable points are connected to the spawn: the mask has big cut-off islands")
    return errs, info


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder")
    ap.add_argument("--original-art", action="store_true",
                    help="the picture is clearly original: also write it into data/authored (committable)")
    ap.add_argument("--check-only", action="store_true", help="run the checks, write nothing")
    ap.add_argument("--repo", default=str(default_repo()))
    a = ap.parse_args()

    folder = Path(a.folder)
    repo = Path(a.repo)
    if not (folder / "spec.json").exists():
        fail(f"{folder}/spec.json is missing (run tools/newmap_export.py first)")
    spec = read_json(folder / "spec.json")
    nid, W, H = spec["id"], spec["size"]["w"], spec["size"]["h"]
    if not valid_id(nid):
        fail("bad id in spec.json")

    web = repo / "web"
    man = read_json(web / "assets" / "manifest.json")
    if any(m["id"] == nid for m in man["maps"]):
        fail(f"map id {nid} is already in the manifest")
    nb_id = spec["neighbour"]["id"]
    if not any(m["id"] == nb_id for m in man["maps"]):
        fail(f"neighbour {nb_id} is not in the manifest")

    map_im = to_size(Image.open(find_pic(folder, "map")).convert("RGB"), W, H, "map.png", Image.LANCZOS)
    walk_im = to_size(Image.open(find_pic(folder, "walk")).convert("L"), W, H, "walk.png", Image.NEAREST)
    grid, grey = mask_to_grid(walk_im, W, H)
    if grey > 0.15:
        fail(f"walk.png is {grey:.0%} grey: it must be pure black and white (ask Gemini again, 'no grey, no anti-aliasing')")
    errs, info = check(spec, grid, W, H)
    print(f"{nid}: mask {W}x{H} -> grid {grid.cols}x{grid.rows} (cell {CELL}); walkable share {info['walkable_share']}, "
          f"{info['connected_to_spawn']} of {info['walkable_points']} foot points connected to the spawn, grey {grey:.1%}")
    if errs:
        for e in errs:
            print("  PROBLEM: " + e, file=sys.stderr)
        fail("checks failed, nothing written")
    if a.check_only:
        print("checks passed (--check-only, nothing written)")
        return

    def rect(r):
        return {"x": r["x"], "y": r["y"], "w": r["w"], "h": r["h"]}

    scene_exits = [{**rect(e["rect"]), "to": e["to"], "spawnX": e["spawnX"], "spawnY": e["spawnY"], "dir": e["dir"]}
                   for e in spec["exits"]]
    ne = spec["neighbour_exit"]
    nb_exit = {**rect(ne["rect"]), "to": nid, "spawnX": ne["spawnX"], "spawnY": ne["spawnY"], "dir": ne["dir"], "_newMap": nid}
    record = {"id": nid, "name": spec["name"], "image": f"assets/maps/{nid}.png", "width": W, "height": H,
              "collision": f"assets/data/newmaps/{nid}.collision.json", "newMap": True}
    if spec.get("music"):
        record["music"] = spec["music"]
    doc = {"_comment": "A map made with Gemini (tools/newmap_export.py / newmap_import.py). Authored data of this project; "
                       "the picture web/assets/maps/%s.png is the user's art and is not committed." % nid,
           "id": nid, "record": record,
           "scene": {"npcs": [], "exits": scene_exits, "zones": [], "doors": [], "warps": [], "ladders": []},
           "neighbourExits": [{"map": nb_id, "exit": nb_exit}]}

    auth = repo / "data" / "authored" / "web" / "assets" / "data" / "newmaps"
    write_json(auth / f"{nid}.json", doc)
    write_json(auth / f"{nid}.collision.json", grid.to_json(), indent=None)
    idx_p = auth / "index.json"
    idx = read_json(idx_p) if idx_p.exists() else {"maps": []}
    idx["maps"] = sorted(set(idx.get("maps", [])) | {nid})
    write_json(idx_p, idx)

    # install for local play: copy only these files (never tools/install_authored_data.py)
    dst = web / "assets" / "data" / "newmaps"
    dst.mkdir(parents=True, exist_ok=True)
    for f in (f"{nid}.json", f"{nid}.collision.json", "index.json"):
        shutil.copyfile(auth / f, dst / f)
    (web / "assets" / "maps").mkdir(parents=True, exist_ok=True)
    map_im.save(web / "assets" / "maps" / f"{nid}.png")
    if a.original_art:
        art = repo / "data" / "authored" / "web" / "assets" / "maps"
        art.mkdir(parents=True, exist_ok=True)
        map_im.save(art / f"{nid}.png")
    print(f"authored: {auth}/{nid}.json, {nid}.collision.json, index.json")
    print(f"installed: {dst}/..., {web}/assets/maps/{nid}.png (git-ignored art)")
    print(f"play: {nid} is reached from {nb_id} through the new exit at {ne['rect']}")


if __name__ == "__main__":
    main()
