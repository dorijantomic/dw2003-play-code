#!/usr/bin/env python3
"""Cut the HD Remaster field maps into tiles so the game loads only what is on screen.

A whole HD map is up to 7680x5632 (90 MB PNG, 176 MB decoded); the screen shows about
1280x960 of it.  This writes, for every map PNG the HD pack lists:

  web/assets-hd/map-tiles/<name>/<col>_<row>.webp   lossless WebP, TILE x TILE plus a
                                                    GUTTER of neighbouring pixels on each
                                                    side (bilinear sampling at a tile edge
                                                    then reads the real neighbour, no seam)
  web/assets-hd/map-tiles/index.json                {"tile", "gutter", "scale", "maps": {name:
                                                    {"w","h","cols","rows","skip":[[c,r]..],"src"}}}

Fully transparent tiles are not written (listed in "skip"); foreground overlays are mostly empty.
Re-running only redoes maps whose source PNG changed (size + mtime in "src").
Read by web/map-tiles.js (always on in HD Remaster).

Usage: python3 tools/tile_hd_maps.py [--web web] [--jobs 4] [--only s540,s540_fg]
"""
import argparse, json, os, sys, time
from concurrent.futures import ProcessPoolExecutor

TILE = 1024
GUTTER = 4
SCALE = 4


def stamp(path):
    st = os.stat(path)
    return f"{st.st_size}:{int(st.st_mtime)}"


def cut(args):
    src, out_dir, name = args
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    t0 = time.perf_counter()
    with Image.open(src) as im:
        im = im.convert("RGBA")
        w, h = im.size
        cols, rows = (w + TILE - 1) // TILE, (h + TILE - 1) // TILE
        os.makedirs(out_dir, exist_ok=True)
        alpha = im.getchannel("A")
        skip, written = [], 0
        for r in range(rows):
            for c in range(cols):
                x0, y0 = c * TILE, r * TILE
                x1, y1 = min(w, x0 + TILE), min(h, y0 + TILE)
                if alpha.crop((x0, y0, x1, y1)).getbbox() is None:
                    skip.append([c, r])
                    continue
                # Gutter: real neighbour pixels where they exist, edge pixels repeated at the map border.
                gx0, gy0 = max(0, x0 - GUTTER), max(0, y0 - GUTTER)
                gx1, gy1 = min(w, x1 + GUTTER), min(h, y1 + GUTTER)
                part = im.crop((gx0, gy0, gx1, gy1))
                tile = Image.new("RGBA", (x1 - x0 + 2 * GUTTER, y1 - y0 + 2 * GUTTER))
                ox, oy = GUTTER - (x0 - gx0), GUTTER - (y0 - gy0)
                tile.paste(part, (ox, oy))
                if ox:   # left border: repeat the first column
                    tile.paste(tile.crop((ox, 0, ox + 1, tile.height)).resize((ox, tile.height)), (0, 0))
                if oy:
                    tile.paste(tile.crop((0, oy, tile.width, oy + 1)).resize((tile.width, oy)), (0, 0))
                rx = ox + (gx1 - gx0)
                if rx < tile.width:
                    tile.paste(tile.crop((rx - 1, 0, rx, tile.height)).resize((tile.width - rx, tile.height)), (rx, 0))
                ry = oy + (gy1 - gy0)
                if ry < tile.height:
                    tile.paste(tile.crop((0, ry - 1, tile.width, ry)).resize((tile.width, tile.height - ry)), (0, ry))
                tile.save(os.path.join(out_dir, f"{c}_{r}.webp"), format="WEBP", lossless=True, method=4)
                written += 1
    return name, {"w": w, "h": h, "cols": cols, "rows": rows, "skip": skip, "src": stamp(src)}, written, time.perf_counter() - t0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--web", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web"))
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("--only", default="")
    a = ap.parse_args()

    hd = os.path.join(a.web, "assets-hd")
    try:
        with open(os.path.join(hd, "manifest.json")) as f:
            listed = {r["path"] for r in json.load(f).get("assets", []) if not r.get("native")}
    except OSError:
        sys.exit("no assets-hd/manifest.json: build the HD pack first")
    out_root = os.path.join(hd, "map-tiles")
    idx_path = os.path.join(out_root, "index.json")
    try:
        with open(idx_path) as f:
            index = json.load(f)
        if index.get("tile") != TILE or index.get("gutter") != GUTTER:
            index = None
    except (OSError, ValueError):
        index = None
    index = index or {"tile": TILE, "gutter": GUTTER, "scale": SCALE, "maps": {}}

    only = set(filter(None, a.only.split(",")))
    jobs = []
    for rel in sorted(listed):
        if not (rel.startswith("maps/") and rel.endswith(".png")) or "/" in rel[5:]:
            continue
        name = rel[5:-4]
        if only and name not in only:
            continue
        src = os.path.join(hd, rel)
        if not os.path.exists(src):
            continue
        if index["maps"].get(name, {}).get("src") == stamp(src):
            continue
        jobs.append((src, os.path.join(out_root, name), name))
    print(f"{len(jobs)} maps to tile ({len(index['maps'])} already done)", flush=True)

    t0 = time.perf_counter()
    done = 0
    with ProcessPoolExecutor(max_workers=max(1, a.jobs)) as pool:
        for name, info, written, dt in pool.map(cut, jobs):
            index["maps"][name] = info
            done += 1
            print(f"[{done}/{len(jobs)}] {name} {info['w']}x{info['h']} {written} tiles, {len(info['skip'])} empty, {dt:.1f}s", flush=True)
            if done % 20 == 0:
                with open(idx_path, "w") as f:
                    json.dump(index, f, separators=(",", ":"))
    os.makedirs(out_root, exist_ok=True)
    with open(idx_path, "w") as f:
        json.dump(index, f, separators=(",", ":"))
    print(f"done in {time.perf_counter() - t0:.0f}s -> {idx_path}")


if __name__ == "__main__":
    main()
