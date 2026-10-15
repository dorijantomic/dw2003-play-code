#!/usr/bin/env python3
"""Draw the sprites of the NEW characters the extra quests add, and write web/extra_npcs.json.

    python3 tools/make_quest_sprites.py

Input: data/authored/quests/new_characters.json (see docs/quests-bible.md, "New characters"). Each character is either

  * "look": {...}   a figure drawn here from a few parameters (skin, hair, outfit...), original art, no game assets used; or
  * "sheet": "path.png"   a finished sprite sheet someone drew (any tool): 120 x 384 px, 8 rows (down, down-left, left, right,
                          up-left, up, down-right, up-right) of 5 frames, each 24 x 48, transparent background.

Output (committed, it is all original art): web/extra_sprites/q<npc_id>.png and web/extra_npcs.json, which game.js reads at
start: the sprite records, the npc_id -> sprite table, and the "residents" (where each character stands on which map).
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC = os.path.join(ROOT, "data", "authored", "quests", "new_characters.json")
OUT_DIR = os.path.join(ROOT, "web", "extra_sprites")
OUT_JSON = os.path.join(ROOT, "web", "extra_npcs.json")
W, H, COLS = 24, 48, 5
ROWS = ["down", "down-left", "left", "right", "up-left", "up", "down-right", "up-right"]
INK = (34, 26, 44, 255)


def rgb(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def shade(c, f):
    return (max(0, min(255, int(c[0] * f))), max(0, min(255, int(c[1] * f))), max(0, min(255, int(c[2] * f))), 255)


class Canvas:
    def __init__(self):
        self.im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        self.px = self.im.load()

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if 0 <= x < W and 0 <= y < H:
                    self.px[x, y] = c

    def oval(self, cx, cy, rx, ry, c):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0 and 0 <= x < W and 0 <= y < H:
                    self.px[x, y] = c

    def outline(self):
        out = self.im.copy()
        o = out.load()
        for y in range(H):
            for x in range(W):
                if self.px[x, y][3]:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < W and 0 <= ny < H and self.px[nx, ny][3]:
                        o[x, y] = INK
                        break
        return out


def figure(look, view, step, dx=0):
    """One frame. view: front | back | side (faces right). step: 0 stand, 1 left foot forward, 2 right foot forward."""
    skin = rgb(look.get("skin", "#f0c8a0"))
    hair = rgb(look.get("hair", "#503020"))
    top = rgb(look.get("top", "#4060a0"))
    bottom = rgb(look.get("bottom", "#303848"))
    shoes = rgb(look.get("shoes", "#202028"))
    accent = rgb(look["accent"]) if look.get("accent") else None
    style = look.get("hairstyle", "short")
    coat = look.get("coat", False)                    # long top down to the knees
    hat = look.get("hat")                             # a colour: a cap
    c = Canvas()
    bob = 1 if step else 0
    cx = 12 + dx
    by = 31 + bob                                     # hip line
    # legs
    legh = 11 - bob
    if view == "side":
        fwd = {0: 0, 1: 2, 2: -2}[step]
        c.rect(cx - 2 - fwd, by, cx + 0 - fwd, by + legh, shade(bottom, 0.85))
        c.rect(cx - 1 + fwd, by, cx + 1 + fwd, by + legh, bottom)
        c.rect(cx - 2 - fwd, by + legh - 1, cx + 1 - fwd, by + legh, shoes)
        c.rect(cx - 1 + fwd, by + legh - 1, cx + 3 + fwd, by + legh, shoes)
    else:
        lo = {0: 0, 1: -1, 2: 0}[step]
        ro = {0: 0, 1: 0, 2: -1}[step]
        c.rect(cx - 4, by, cx - 1, by + legh + lo, bottom)
        c.rect(cx, by, cx + 3, by + legh + ro, shade(bottom, 0.85))
        c.rect(cx - 4, by + legh - 1 + lo, cx - 1, by + legh + lo, shoes)
        c.rect(cx, by + legh - 1 + ro, cx + 3, by + legh + ro, shoes)
    # torso (and a long coat)
    ty0 = 17 + bob
    tend = by + (8 if coat else 0)
    if view == "side":
        c.rect(cx - 3, ty0, cx + 2, tend, top)
        c.rect(cx + 1, ty0, cx + 2, tend, shade(top, 0.82))
        arm = {0: 0, 1: 2, 2: -2}[step]
        c.rect(cx - 1 - arm, ty0 + 1, cx + 0 - arm, ty0 + 9, shade(top, 0.9))
        c.rect(cx - 1 - arm, ty0 + 9, cx + 0 - arm, ty0 + 10, skin)
    else:
        c.rect(cx - 5, ty0, cx + 4, tend, top)
        c.rect(cx + 3, ty0, cx + 4, tend, shade(top, 0.82))
        a1 = {0: 0, 1: 1, 2: -1}[step]
        c.rect(cx - 7, ty0 + 1 + a1, cx - 6, ty0 + 9 + a1, shade(top, 0.9))
        c.rect(cx + 5, ty0 + 1 - a1, cx + 6, ty0 + 9 - a1, shade(top, 0.8))
        c.rect(cx - 7, ty0 + 9 + a1, cx - 6, ty0 + 10 + a1, skin)
        c.rect(cx + 5, ty0 + 9 - a1, cx + 6, ty0 + 10 - a1, skin)
        if accent and view == "front":
            c.rect(cx - 1, ty0, cx, tend - (8 if coat else 3), accent)        # a stripe / zip / tie down the front
    if look.get("pack") and view in ("back", "side"):
        pc = rgb(look["pack"])
        if view == "back":
            c.rect(cx - 4, ty0 + 1, cx + 3, ty0 + 10, pc)
        else:
            c.rect(cx - 5, ty0 + 1, cx - 3, ty0 + 9, pc)
    # head
    hy = 4 + bob
    if view == "side":
        c.oval(cx, hy + 6, 6, 6, skin)
        c.rect(cx + 2, hy + 6, cx + 2, hy + 7, shade(skin, 0.8))
        # hair mass behind and above the face
        c.oval(cx - 1, hy + 3, 6, 3.6, hair)
        c.rect(cx - 6, hy + 4, cx - 3, hy + 9, hair) if style in ("long", "bun") else None
        c.rect(cx + 3, hy + 6, cx + 3, hy + 7, INK)               # eye
    else:
        c.oval(cx, hy + 6, 6, 6, skin)
        if view == "front":
            c.oval(cx, hy + 3, 6.5, 3.4, hair)
            c.rect(cx - 3, hy + 6, cx - 2, hy + 7, INK)
            c.rect(cx + 2, hy + 6, cx + 3, hy + 7, INK)
            c.rect(cx - 1, hy + 10, cx, hy + 10, shade(skin, 0.7))
            c.rect(cx - 6, hy + 4, cx - 5, hy + 8, hair) if style in ("long", "bun", "spiky") else None
            c.rect(cx + 5, hy + 4, cx + 6, hy + 8, hair) if style in ("long", "bun", "spiky") else None
        else:
            c.oval(cx, hy + 5, 6.5, 6.5, hair)
            if style == "long":
                c.rect(cx - 6, hy + 5, cx + 5, hy + 15, hair)
    if style == "bun":
        c.oval(cx + (1 if view != "side" else -2), hy - 1, 2.5, 2.5, hair)
    if style == "spiky":
        for sx in (-4, -1, 2, 5):
            c.rect(cx + sx, hy - 2, cx + sx + 1, hy, hair)
    if look.get("glasses") and view != "back":
        gc = rgb(look["glasses"])
        if view == "front":
            c.rect(cx - 4, hy + 5, cx - 1, hy + 8, gc)
            c.rect(cx + 1, hy + 5, cx + 4, hy + 8, gc)
            c.rect(cx - 3, hy + 6, cx - 2, hy + 7, (255, 255, 255, 255))
            c.rect(cx + 2, hy + 6, cx + 3, hy + 7, (255, 255, 255, 255))
        else:
            c.rect(cx + 1, hy + 5, cx + 4, hy + 8, gc)
    if look.get("headphones"):
        hc = rgb(look["headphones"])
        if view == "side":
            c.rect(cx - 2, hy + 5, cx + 0, hy + 9, hc)
        else:
            c.rect(cx - 7, hy + 5, cx - 5, hy + 9, hc)
            c.rect(cx + 5, hy + 5, cx + 7, hy + 9, hc)
            c.rect(cx - 5, hy, cx + 5, hy, hc)
    if hat:
        hc = rgb(hat)
        c.rect(cx - 6, hy + 1, cx + 6, hy + 3, hc)
        if view == "side":
            c.rect(cx + 3, hy + 3, cx + 8, hy + 4, shade(hc, 0.8))
        elif view == "front":
            c.rect(cx - 6, hy + 4, cx + 6, hy + 4, shade(hc, 0.8))
    if look.get("scarf"):
        sc = rgb(look["scarf"])
        c.rect(cx - 5, hy + 11, cx + 4, hy + 12, sc)
    return c.outline()


def sheet_for(look):
    sheet = Image.new("RGBA", (W * COLS, H * len(ROWS)), (0, 0, 0, 0))
    steps = [0, 1, 0, 2, 0]
    for r, name in enumerate(ROWS):
        for col in range(COLS):
            s = steps[col]
            if name in ("down", "down-left", "down-right"):
                f = figure(look, "front", s, {"down": 0, "down-left": -1, "down-right": 1}[name])
            elif name in ("up", "up-left", "up-right"):
                f = figure(look, "back", s, {"up": 0, "up-left": -1, "up-right": 1}[name])
            else:
                f = figure(look, "side", s)
                if name == "left":
                    f = f.transpose(Image.FLIP_LEFT_RIGHT)
            sheet.alpha_composite(f, (col * W, r * H))
    return sheet


def record(rid, name):
    return {
        "id": rid, "name": name, "sheet": f"extra_sprites/{rid}.png", "frameW": W, "frameH": H, "rows": ROWS,
        "frameCounts": {r: COLS for r in ROWS},
        "frameDurations": {r: [12, 9, 12, 9, 12] for r in ROWS},
        "frameBottomShift": {r: [4] * COLS for r in ROWS},
    }


def main():
    spec = json.load(open(SRC, encoding="utf-8"))
    os.makedirs(OUT_DIR, exist_ok=True)
    npcs, table, residents, problems = [], {}, [], []
    for ch in spec["characters"]:
        nid = int(ch["npc_id"])
        rid = f"q{nid}"
        if nid < 1000:
            problems.append(f"{ch['name']}: npc_id {nid} must be 1000 or more (below that are the game's own characters)")
            continue
        if "sheet" in ch:
            img = Image.open(os.path.join(ROOT, ch["sheet"])).convert("RGBA")
            if img.size != (W * COLS, H * len(ROWS)):
                problems.append(f"{ch['name']}: sheet is {img.size}, must be {(W * COLS, H * len(ROWS))}")
                continue
        else:
            img = sheet_for(ch["look"])
        img.save(os.path.join(OUT_DIR, rid + ".png"))
        npcs.append(record(rid, ch["name"]))
        table[str(nid)] = rid
        for r in ch.get("residents", []):
            residents.append({"npc_id": nid, "map": r["map"], "x": r["x"], "y": r["y"], "dir": r.get("dir", "down")})
    if problems:
        print("PROBLEMS:\n  " + "\n  ".join(problems))
        return 1
    json.dump({"npcs": npcs, "npc_sprites": table, "residents": residents}, open(OUT_JSON, "w", encoding="utf-8"), indent=1)
    print(f"wrote {len(npcs)} sprites and {len(residents)} residents to {os.path.relpath(OUT_JSON, ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
