#!/usr/bin/env python3
"""Light sources per stage, read from the game own ambient-prop records.

A record is a light when its sprite is a small additive (blend mode 1, B+F) clip
driven by animMode 2 - the lit torches, lamps and door lights. We keep the
record position and the sprite itself (every palette variant "id@ctr" the game
cycles through), so the renderer can redraw the game own sprite at night in the
game own colours instead of inventing a glow.
Writes web/assets/data/lights.json.   Usage: python3 tools/gen_lights.py
"""
import json, os

WEB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web")
A = json.load(open(f"{WEB}/assets/data/point_sprites.json"))
out, total = {}, 0
for stage, v in A.items():
    if not os.path.exists(f"{WEB}/assets/effects/{stage}_semi.png"):
        continue
    sprites, lights = {}, []
    for r in v["records"]:
        sid = str(r["spriteId"])
        fr = v["sprites"].get(sid)
        if not (r["active"] and r["mode"] == 2 and fr):
            continue
        f = fr[0]
        if f["semi"] != 1 or f["w"] > 32 or f["h"] > 32 or f["w"] * f["h"] <= 64:   # 8x8 is the ice sparkle, not a lamp
            continue
        if sid not in sprites:
            vs = []
            for c in range(r["min"], r["max"] + 1):
                L = v["sprites"].get(f"{sid}@{c}") or fr
                vs.append([[l["x"], l["y"], l["w"], l["h"], l["dx"], l["dy"]] for l in L])
            sprites[sid] = vs
        lights.append({"x": r["x"], "y": r["y"], "s": int(sid), "p": r["period"], "z": r["layer"]})
    if lights:
        out[stage] = {"sprites": sprites, "lights": lights}; total += len(lights)
json.dump(out, open(f"{WEB}/assets/data/lights.json", "w"), separators=(",", ":"))
print(len(out), "stages", total, "lights", os.path.getsize(f"{WEB}/assets/data/lights.json"), "bytes")
