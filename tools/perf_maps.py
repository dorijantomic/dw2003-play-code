#!/usr/bin/env python3
"""Measure what one field area costs to load, Authentic vs HD Remaster.

Mirrors web/game.js ensureMapImg + web/stage-locality.js stageWorkingSet:
an area loads its own map + every directly reachable stage (scene exits[].to),
each with its _fg overlay (assets/data/map_overlays.json) and, for stages in
map_ground_index.json, two more full-size canvases (ground + layer-2 split).

Decode time is measured with Pillow (a proxy for the browser's PNG decoder, not
the browser itself).  Usage:  python3 tools/perf_maps.py [--decode N] [--out f.json]
"""
import argparse, json, os, struct, time
from PIL import Image

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
Image.MAX_IMAGE_PIXELS = None


def j(p, default):
    try:
        with open(os.path.join(WEB, p)) as f:
            return json.load(f)
    except OSError:
        return default


def png_dims(path):
    with open(path, "rb") as f:
        h = f.read(24)
    return struct.unpack(">II", h[16:24])


def file_info(rel):
    out = {}
    for key, p in (("native", rel), ("hd", rel.replace("assets/", "assets-hd/", 1))):
        full = os.path.join(WEB, p)
        if os.path.exists(full):
            w, h = png_dims(full)
            out[key] = {"bytes": os.path.getsize(full), "w": w, "h": h}
        else:
            out[key] = None
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--decode", type=int, default=12, help="time Pillow decode of the N biggest HD maps (+N/2 median ones)")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()

    maps = {m["id"]: m for m in j("assets/manifest.json", {}).get("maps", [])}
    overlays = j("assets/data/map_overlays.json", {})
    ground = j("assets/data/map_ground_index.json", {})
    hd_listed = {r["path"] for r in j("assets-hd/manifest.json", {}).get("assets", []) if not r.get("native")}

    def files_for(sid):
        m = maps[sid]
        src = m.get("assetSource")
        files = [m["image"]]
        ov = sid if overlays.get(sid) else (src if src and overlays.get(src) else None)
        if ov:
            files.append(f"assets/maps/{ov}_fg.png")
        g = ground.get(sid) is True or bool(src and ground.get(src) is True)
        return files, g

    def cost(sid, mode):
        files, g = files_for(sid)
        disk = mem = biggest = 0
        for rel in files:
            fi = file_info(rel)
            hd_ok = mode == "hd" and fi["hd"] and rel[len("assets/"):] in hd_listed
            use = fi["hd"] if hd_ok else fi["native"]
            if not use:
                continue
            disk += use["bytes"]
            px = use["w"] * use["h"] * 4
            mem += px
            biggest = max(biggest, px)
            if rel == files[0] and g:
                mem += 2 * px  # ground + layer-2 canvases built at load
        return disk, mem, biggest

    areas = []
    for sid in maps:
        scene = j(f"assets/scenes/{sid}.json", {})
        nb = []
        for e in scene.get("exits", []) or []:
            t = (e or {}).get("to")
            if t and t != sid and t in maps and t not in nb:
                nb.append(t)
        row = {"id": sid, "name": maps[sid].get("name"), "neighbours": len(nb)}
        for mode in ("authentic", "hd"):
            d0, m0, b0 = cost(sid, mode)
            dn = mn = 0
            for n in nb:
                d, m, _ = cost(n, mode)
                dn += d
                mn += m
            row[mode] = {"own_disk_mb": d0 / 1e6, "own_mem_mb": m0 / 1e6, "area_disk_mb": (d0 + dn) / 1e6,
                         "area_mem_mb": (m0 + mn) / 1e6, "biggest_image_mb": b0 / 1e6}
        areas.append(row)

    def med(vals):
        v = sorted(vals)
        return v[len(v) // 2] if v else 0

    rep = {"areas": len(areas)}
    for mode in ("authentic", "hd"):
        rep[mode] = {k: {"median": round(med([r[mode][k] for r in areas]), 1),
                         "max": round(max(r[mode][k] for r in areas), 1)}
                     for k in ("own_disk_mb", "own_mem_mb", "area_disk_mb", "area_mem_mb")}
    worst = sorted(areas, key=lambda r: -r["hd"]["area_mem_mb"])[:8]
    rep["worst_hd_areas"] = [{"id": r["id"], "name": r["name"], "neighbours": r["neighbours"],
                              "area_disk_mb": round(r["hd"]["area_disk_mb"]),
                              "area_mem_mb": round(r["hd"]["area_mem_mb"]),
                              "authentic_area_mem_mb": round(r["authentic"]["area_mem_mb"])} for r in worst]

    d = os.path.join(WEB, "assets-hd/maps")
    hdmaps = sorted((os.path.join(d, f) for f in os.listdir(d) if f.endswith(".png")), key=os.path.getsize)
    mid = len(hdmaps) // 2
    pick = (hdmaps[-a.decode:] + hdmaps[mid - a.decode // 4: mid + a.decode // 4]) if a.decode else []
    timings = []
    for p in pick:
        t = time.perf_counter()
        with Image.open(p) as im:
            im.load()
            w, h = im.size
        timings.append({"file": os.path.basename(p), "disk_mb": round(os.path.getsize(p) / 1e6, 1),
                        "px": f"{w}x{h}", "decode_s": round(time.perf_counter() - t, 3)})
    rep["decode_pillow"] = timings
    if timings:
        rep["decode_pillow_mb_per_s"] = round(sum(t["disk_mb"] for t in timings) / sum(t["decode_s"] for t in timings), 1)

    if a.out:
        with open(a.out, "w") as f:
            json.dump({"summary": rep, "areas": areas}, f, indent=1, ensure_ascii=False)
    print(json.dumps(rep, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
