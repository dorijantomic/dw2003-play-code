#!/usr/bin/env python3
"""Step 1 of a new Gemini-made field map: write the folder you take to Gemini.

    python3 tools/newmap_export.py <neighbour_map_id> <side> [--size WxH] [--name "Region - Place"] [--id n001]
                                   [--at OFFSET] [--out DIR] [--repo ROOT]

<side> is where the new map sits next to the neighbour: left, right, up or down.
Writes ~/dw3-newmaps/<new_id>/ (outside the repo, never committed; env NEWMAPS_DIR or --out change it):
  prompt.txt   the exact words for Gemini (style, angle, size, where the exit is, and "also return a black/white walk mask")
  ref.png      the neighbour's picture, scaled down, as the STYLE reference (local only, disc art)
  guide.png    an empty canvas of the new map's size with the exit marked: gives Gemini the size and the exit position
  spec.json    new id, size, exits (rectangles that line up with the neighbour's), spawns, the neighbour's new exit
Then: paste prompt.txt + ref.png + guide.png into Gemini, save its two pictures as map.png and walk.png in the same folder,
run tools/newmap_import.py <folder>. Steps in docs/new-maps.md.
"""
import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from newmap_common import *  # noqa: E402,F401,F403
from PIL import Image, ImageDraw  # noqa: E402

REF_MAX = 1024


def fail(msg):
    print("newmap_export: " + msg, file=sys.stderr)
    sys.exit(2)


def parse_size(s):
    try:
        w, h = s.lower().split("x")
        w, h = int(w), int(h)
    except Exception:
        fail("--size must look like 1024x768")
    if w % 64 or h % 64 or not (256 <= w <= 4096 and 256 <= h <= 4096):
        fail("--size: both numbers must be multiples of 64 between 256 and 4096")
    return w, h


def pick_exit(ok, comps, side, W, H, ref_along, depth=EXIT_DEPTH):
    """The neighbour's new exit rectangle on `side`: nearest to ref_along where its ground is walkable (the biggest
    connected area of the neighbour). Returns (rect, spawn_xy, inset)."""
    main = comps[0] if comps else set()
    n = edge_len(side, W, H)
    cands = sorted(range(EXIT_LEN // 2, n - EXIT_LEN // 2 + 1, 8), key=lambda a: abs(a - ref_along))
    for inset in (0, 64, 128, 192):
        for a in cands:
            r = exit_rect(side, W, H, a, depth, EXIT_LEN, inset)
            pts = [p for p in rect_points(ok, r["x"], r["y"], r["w"], r["h"]) if p in main]
            if len(pts) < 20:
                continue
            # arrival spot of someone coming back: the walkable point of the main area nearest the rect centre, outside it
            cx, cy = r["x"] + r["w"] / 2, r["y"] + r["h"] / 2
            best = None
            for (i, j) in main:
                x, y = i * STEP, j * STEP
                if r["x"] - 8 <= x < r["x"] + r["w"] + 8 and r["y"] - 8 <= y < r["y"] + r["h"] + 8:
                    continue
                d = (x - cx) ** 2 + (y - cy) ** 2
                if d > 160 ** 2:
                    continue
                if best is None or d < best[0]:
                    best = (d, x, y)
            if best:
                return r, (best[1], best[2]), inset
    return None, None, None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("neighbour")
    ap.add_argument("side")
    ap.add_argument("--size", default="1024x768")
    ap.add_argument("--name", default=None)
    ap.add_argument("--id", default=None)
    ap.add_argument("--at", type=int, default=None, help="position of the connection along the neighbour's edge, px")
    ap.add_argument("--out", default=None)
    ap.add_argument("--repo", default=str(default_repo()))
    a = ap.parse_args()

    repo = Path(a.repo)
    web = repo / "web"
    side = SIDES.get(a.side.lower())
    if not side:
        fail("side must be left, right, up or down")
    W, H = parse_size(a.size)
    man = read_json(web / "assets" / "manifest.json")
    maps = {m["id"]: m for m in man["maps"]}
    nb = maps.get(a.neighbour)
    if not nb:
        fail(f"neighbour {a.neighbour!r} is not in web/assets/manifest.json")
    nW, nH = nb["width"], nb["height"]

    # new id: next free nNNN (manifest, authored index, existing export folders)
    out_root = Path(a.out) if a.out else newmaps_dir()
    taken = set(maps)
    idx = repo / "data" / "authored" / "web" / "assets" / "data" / "newmaps" / "index.json"
    if idx.exists():
        taken |= set(read_json(idx).get("maps", []))
    if out_root.is_dir() and not a.out:
        taken |= {p.name for p in out_root.iterdir() if p.is_dir()}
    nid = a.id
    if nid is None:
        k = 1
        while f"n{k:03d}" in taken:
            k += 1
        nid = f"n{k:03d}"
    elif not valid_id(nid):
        fail("--id may hold letters, digits, _ and - only")
    elif nid in maps:
        fail(f"id {nid} already exists in the manifest")
    folder = out_root if a.out else out_root / nid
    if folder.exists() and any(folder.iterdir()):
        fail(f"{folder} already has files; pick another --id or remove it")

    # neighbour's walkable ground
    cp = web / "assets" / "collision" / f"{a.neighbour}.json"
    if not cp.exists():
        fail(f"no collision file for {a.neighbour}: {cp}")
    grid = Grid.from_json(read_json(cp))
    ok = grid.lattice()
    comps = components(ok)

    # where along the neighbour's edge: --at, else the neighbour's own exit nearest that edge, else the edge centre
    scene_p = web / "assets" / "scenes" / f"{a.neighbour}.json"
    ref_along = edge_len(side, nW, nH) // 2
    ref_note = "edge centre"
    if a.at is not None:
        ref_along, ref_note = a.at, "--at"
    elif scene_p.exists():
        best = None
        across = nW if side in ("left", "right") else nH
        for e in read_json(scene_p).get("exits", []):
            ex, ey = e["x"] + e["w"] / 2, e["y"] + e["h"] / 2
            dist = {"left": ex, "right": nW - ex, "up": ey, "down": nH - ey}[side]
            if dist < 0.2 * across and (best is None or dist < best[0]):
                best = (dist, int(along_of(side, ex, ey)), e.get("to"))
        if best:
            ref_along, ref_note = best[1], f"the neighbour's own exit on that side (to {best[2]})"
    rect_n, spawn_n, inset = pick_exit(ok, comps, side, nW, nH, ref_along)
    if rect_n is None:
        fail(f"no walkable ground on the {side} edge of {a.neighbour}; try another side or --at")
    along_n = int(along_of(side, rect_n["x"] + rect_n["w"] / 2, rect_n["y"] + rect_n["h"] / 2))

    # the new map: opposite edge, same position along the edge as far as it fits
    opp = OPPOSITE[side]
    along_new = max(EXIT_LEN // 2, min(edge_len(opp, W, H) - EXIT_LEN // 2, along_n))
    along_new = (along_new // 8) * 8
    rect_new = exit_rect(opp, W, H, along_new)
    sp_new = edge_point(opp, W, H, along_new, SPAWN_IN)

    dash = " — "
    name = a.name or f"{nb['name'].split(dash)[0]}{dash}New place {nid}"
    spec = {
        "id": nid, "name": name, "size": {"w": W, "h": H}, "music": nb.get("music"),
        "neighbour": {"id": a.neighbour, "name": nb["name"], "side": side, "size": {"w": nW, "h": nH},
                      "position_from": ref_note},
        # exits OF THE NEW MAP (back to the neighbour). spawn* = where the player lands in the neighbour.
        "exits": [{"rect": rect_new, "to": a.neighbour, "spawnX": spawn_n[0], "spawnY": spawn_n[1], "dir": FACING[opp]}],
        # exit ADDED TO THE NEIGHBOUR (leads here). spawn* = where the player lands in the new map.
        "neighbour_exit": {"rect": rect_n, "to": nid, "spawnX": sp_new[0], "spawnY": sp_new[1], "dir": FACING[side]},
        "spawns": [{"name": "from_neighbour", "x": sp_new[0], "y": sp_new[1], "dir": FACING[side]}],
        "foot_box": {"w": 12, "h": 8},
        "created": time.strftime("%Y-%m-%d"),
    }

    folder.mkdir(parents=True, exist_ok=True)
    write_json(folder / "spec.json", spec)

    # ref.png: the neighbour picture, scaled
    src = web / nb["image"]
    palette = ""
    if src.exists():
        im = Image.open(src).convert("RGB")
        s = REF_MAX / max(im.size)
        if s < 1:
            im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
        im.save(folder / "ref.png")
        q = im.resize((64, 64)).quantize(6)
        pal = q.getpalette()[:18]
        cols = sorted(q.getcolors(), reverse=True)
        palette = ", ".join("#%02x%02x%02x" % tuple(pal[i * 3:i * 3 + 3]) for _, i in cols[:6])
    else:
        print(f"note: {src} is missing, no ref.png written", file=sys.stderr)

    # guide.png: empty canvas at the new size, exit marked
    g = Image.new("RGB", (W, H), (200, 200, 200))
    d = ImageDraw.Draw(g)
    d.rectangle([rect_new["x"], rect_new["y"], rect_new["x"] + rect_new["w"] - 1, rect_new["y"] + rect_new["h"] - 1], fill=(0, 200, 0))
    g.save(folder / "guide.png")

    edge_word = {"left": "LEFT", "right": "RIGHT", "up": "TOP", "down": "BOTTOM"}[opp]
    pos_word = f"y = {rect_new['y']} to {rect_new['y'] + rect_new['h']}" if opp in ("left", "right") \
        else f"x = {rect_new['x']} to {rect_new['x'] + rect_new['w']}"
    prompt = f"""Make two pictures for a video game map. Both must be exactly {W} x {H} pixels (aspect {W}:{H}).

PICTURE 1 - the map ("{name}")
Paint a new outdoor area of the same game world as the reference picture I attached (ref.png). Match its art style exactly:
same painting technique, line weight, lighting direction, saturation and the same family of colours (main colours {palette or 'as in the reference'}).
Camera: the same fixed top-down three-quarter angle as the reference, like a classic 2D role-playing game field map,
looking down at the ground at a steep angle. No perspective vanishing point, no horizon, no sky. Objects (trees, rocks, buildings, water)
are drawn upright facing the camera like in the reference. No characters, no text, no UI, no border, no frame, no watermark.
The area continues the reference map: the neighbouring map lies on the {edge_word} side of this one, so the ground along the
{edge_word} edge must open out and look like the reference's ground, in the same colour.
EXIT: on the {edge_word} edge there is a clear open walkable gap, {pos_word} (see guide.png, the green rectangle), at least 96 pixels wide,
no trees, rocks, water or walls in it. It is where the player walks to the neighbouring map. Everything else along that edge may be
closed in by trees, cliffs or water.
Inside, make winding walkable ground paths and open clearings (about 40 to 60 percent of the picture), with obstacles around them
(dense trees, rocks, cliffs, water, buildings) that clearly look like they cannot be walked through. Walkable ground must be one connected
area that reaches the exit gap. Give it one or two points of interest.

PICTURE 2 - the walk mask
The SAME picture again at exactly the same size and layout, but only two colours: pure WHITE (#FFFFFF) where the player can walk,
pure BLACK (#000000) where the player cannot (water, cliffs, walls, trees, rocks, buildings, the outside of the paths).
No grey, no anti-aliasing, no gradients, no outlines, no text. Every walkable path, clearing and the exit gap must be solid white;
obstacles must be solid black exactly where they are in picture 1. The exit gap on the {edge_word} edge must be white up to the very edge.

Return picture 1 first, then picture 2, as two separate images."""
    (folder / "prompt.txt").write_text(prompt + "\n", encoding="utf-8")

    print(f"new map {nid} ({W}x{H}) {side} of {a.neighbour}; folder {folder}")
    print(f"  neighbour exit {rect_n} (inset {inset}), lands in the new map at {sp_new}")
    print(f"  new map exit   {rect_new}, lands in {a.neighbour} at {spawn_n}")
    print("  next: Gemini <- prompt.txt + ref.png + guide.png; save results as map.png + walk.png; then tools/newmap_import.py " + str(folder))


if __name__ == "__main__":
    main()
