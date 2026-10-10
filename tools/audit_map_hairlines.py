"""Hairlines baked into the stitched base maps.

A stitched map is one flat picture, so every pixel that is not fully opaque
blends with whatever the frame was cleared to — black. A one-pixel line of such
pixels between two opaque neighbours therefore reads to the player as a dark
line along the join, and it shimmers as the camera moves under it.

Two kinds are counted, both only when the pixels on both sides are fully opaque:
  gap   alpha == 0    — nothing there at all
  faint 0 < alpha < 255 — the PS1 semi-transparent flag, kept as alpha by the
                          stitcher, with no tile behind it to blend against

Run: .venv/bin/python3 tools/audit_map_hairlines.py [--min-run 8]
"""
import argparse, glob, json, os
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--min-run", type=int, default=8)
ap.add_argument("--json", default="")
args = ap.parse_args()
MIN = args.min_run

def scan(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    a = im.getchannel("A").load()
    hits = []
    for axis in ("v", "h"):
        outer, inner = (w, h) if axis == "v" else (h, w)
        for i in range(1, outer - 1):
            run_start, run_kind, run = 0, None, 0
            for j in range(inner + 1):
                if j < inner:
                    cur = a[i, j] if axis == "v" else a[j, i]
                    lo = a[i - 1, j] if axis == "v" else a[j, i - 1]
                    hi = a[i + 1, j] if axis == "v" else a[j, i + 1]
                    kind = None
                    if lo == 255 and hi == 255 and cur < 255:
                        kind = "gap" if cur == 0 else "faint"
                else:
                    kind = None
                if kind is not None and kind == run_kind:
                    run += 1
                else:
                    if run >= MIN:
                        x, y = (i, run_start) if axis == "v" else (run_start, i)
                        hits.append({"x": x, "y": y, "len": run, "axis": axis, "kind": run_kind})
                    run_kind, run, run_start = kind, (1 if kind else 0), j
    return w, h, hits

rows = []
for p in sorted(glob.glob("web/assets/maps/*.png")):
    name = os.path.basename(p)[:-4]
    if name.endswith("_fg"):
        continue
    w, h, hits = scan(p)
    if hits:
        rows.append({"stage": name, "w": w, "h": h,
                     "gap": sum(1 for x in hits if x["kind"] == "gap"),
                     "faint": sum(1 for x in hits if x["kind"] == "faint"),
                     "hits": hits})

rows.sort(key=lambda r: -(r["gap"] + r["faint"]))
print(f"{len(rows)} stages carry a hairline (run >= {MIN} px)")
print(f"{sum(r['gap'] for r in rows)} gap lines, {sum(r['faint'] for r in rows)} faint lines")
for r in rows[:30]:
    print(f"  {r['stage']}  {r['w']}x{r['h']}  gap={r['gap']} faint={r['faint']}"
          f"  first={r['hits'][0]['x']},{r['hits'][0]['y']} {r['hits'][0]['axis']} {r['hits'][0]['len']}px {r['hits'][0]['kind']}")
if args.json:
    json.dump(rows, open(args.json, "w"), indent=1)
    print("wrote", args.json)
