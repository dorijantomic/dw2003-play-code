#!/usr/bin/env python3
"""Draw the two GIANT walkers and their ground marks, as original art (no game asset is read).

    python3 tools/make_giant_art.py

Four sheets land in web/extra_fx (committed: they are ours):

  big_claw    a giant metal tyrannosaur, 8 cells: walk-left 0-3, walk-right 4-7 (128 x 152)
  big_horn    a giant horned brute, same layout (128 x 152)
  print_claw  one three-toed claw print in the ground (32 x 32)
  print_horn  one round heavy print (32 x 32)
  log         a fallen tree trunk left lying where something big went past (64 x 32)

`web/extra_fx/giant_metal.*` and `giant_trike.*` are the same idea rendered from the game's own battle models by
tools/giant-fx.sh; those are disc-derived (git-ignored) and not what the quests use today (the model renderer scatters
the big models' parts, see tools/make_giant_fx.py).
"""
import json
import os

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "web", "extra_fx")
W, H = 128, 152


def rgb(v):
    v = v.lstrip("#")
    return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16), 255)


class C:
    def __init__(self, w, h):
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.px = self.im.load()
        self.w, self.h = w, h

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[int(x), int(y)] = c

    def rect(self, x0, y0, x1, y1, c):
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.set(x, y, c)

    def poly(self, pts, c):
        ys = [p[1] for p in pts]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            xs = []
            for i in range(len(pts)):
                (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % len(pts)]
                if (y1 <= y < y2) or (y2 <= y < y1):
                    xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                for x in range(int(xs[i]), int(xs[i + 1]) + 1):
                    self.set(x, y, c)

    def disc(self, cx, cy, r, c):
        for y in range(int(cy - r), int(cy + r) + 1):
            for x in range(int(cx - r), int(cx + r) + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.set(x, y, c)

    def thick(self, pts, w, c):
        for i in range(len(pts) - 1):
            (x1, y1), (x2, y2) = pts[i], pts[i + 1]
            n = int(max(abs(x2 - x1), abs(y2 - y1))) + 1
            for k in range(n + 1):
                t = k / n
                self.disc(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w / 2, c)


def limb(c, hip, knee, foot, width, metal, dark, ink):
    """One leg: a thick thigh/shin from the hip to the foot, then a heavy foot with claws."""
    c.thick([hip, knee, foot], width, metal)
    c.thick([hip, knee, foot], width - 3, dark)
    fx, fy = foot
    c.rect(fx - 9, fy - 3, fx + 9, fy + 3, metal)
    for dx in (-7, 0, 7):
        c.set(fx + dx, fy + 4, ink)
        c.set(fx + dx, fy + 5, ink)


def metal_body(c, phase):
    """A metal tyrannosaur seen from the side, walking left. `phase` 0..3 moves the legs and the body."""
    metal, dark, light = rgb("#9aa3ad"), rgb("#4a525c"), rgb("#d8e0e8")
    ink, red, eye = rgb("#1a1d22"), rgb("#c8323c"), rgb("#7fe3ff")
    step = [0, 5, 0, -5][phase]                    # the stride
    bob = [0, -2, 0, -2][phase]
    base = H - 12
    # tail, body, neck, head
    c.thick([(18, base - 46 + bob), (44, base - 44 + bob), (66, base - 40 + bob)], 12, dark)
    c.poly([(30, base - 62 + bob), (86, base - 66 + bob), (96, base - 38 + bob), (36, base - 34 + bob)], metal)
    c.poly([(40, base - 58 + bob), (84, base - 60 + bob), (88, base - 46 + bob), (42, base - 44 + bob)], dark)
    c.thick([(84, base - 58 + bob), (100, base - 76 + bob)], 20, metal)          # neck
    c.poly([(92, base - 96 + bob), (124, base - 92 + bob), (126, base - 70 + bob), (94, base - 70 + bob)], metal)
    c.rect(96, base - 84 + bob, 122, base - 78 + bob, dark)                        # jaw line
    for x in range(98, 122, 5):
        c.set(x, base - 76 + bob, light)
    c.disc(112, base - 88 + bob, 4, eye)                                           # eye
    c.set(124, base - 88 + bob, red)                                               # muzzle cannon glow
    c.set(123, base - 89 + bob, red)
    # arms
    c.thick([(88, base - 44 + bob), (78, base - 30 + bob)], 6, metal)
    c.thick([(96, base - 46 + bob), (88, base - 32 + bob)], 6, metal)
    # legs: the near one strides, the far one is half a cycle behind
    limb(c, (52, base - 38 + bob), (46 + step, base - 20 + bob), (44 + step * 2, base - 2), 16, metal, dark, ink)
    limb(c, (74, base - 40 + bob), (80 - step, base - 22 + bob), (78 - step * 2, base - 2), 16, dark, dark, ink)
    # back plates
    for x in (54, 68, 82):
        c.poly([(x, base - 66 + bob), (x + 6, base - 74 + bob), (x + 12, base - 66 + bob)], light)
    return c


def horn_body(c, phase):
    """A horned brute with a big collar, walking left."""
    skin, dark, light = rgb("#6f9a52"), rgb("#3d5c2e"), rgb("#a8cf84")
    bone, ink, eye = rgb("#e8dcb4"), rgb("#20261a"), rgb("#ffd05a")
    step = [0, 5, 0, -5][phase]
    bob = [0, -2, 0, -2][phase]
    base = H - 12
    c.thick([(16, base - 52 + bob), (40, base - 50 + bob)], 10, dark)                # tail
    c.poly([(28, base - 72 + bob), (92, base - 76 + bob), (98, base - 34 + bob), (34, base - 32 + bob)], skin)
    c.poly([(38, base - 56 + bob), (92, base - 58 + bob), (94, base - 36 + bob), (40, base - 35 + bob)], light)
    # the collar (Triceramon's frill) and three horns
    c.poly([(88, base - 96 + bob), (124, base - 88 + bob), (122, base - 52 + bob), (86, base - 58 + bob)], dark)
    c.poly([(90, base - 92 + bob), (120, base - 86 + bob), (118, base - 58 + bob), (90, base - 62 + bob)], skin)
    for hx, hy, ang in ((118, base - 88 + bob, -8), (104, base - 94 + bob, -14), (92, base - 90 + bob, -18)):
        c.thick([(hx, hy), (hx + 8, hy + ang)], 5, bone)
    c.rect(120, base - 78 + bob, 126, base - 74 + bob, bone)                         # beak
    c.disc(112, base - 80 + bob, 3, eye)
    limb(c, (48, base - 36 + bob), (44 + step, base - 18 + bob), (42 + step * 2, base - 2), 18, skin, dark, ink)
    limb(c, (78, base - 38 + bob), (84 - step, base - 20 + bob), (82 - step * 2, base - 2), 18, dark, dark, ink)
    for x in (56, 70):
        c.poly([(x, base - 76 + bob), (x + 7, base - 86 + bob), (x + 13, base - 76 + bob)], light)
    return c


def claw_print():
    c = C(32, 32)
    ground, dark = rgb("#5a4630"), rgb("#3a2c1c")
    for i, (x, y, r) in enumerate(((7, 24, 6), (16, 26, 5), (25, 24, 6))):     # three toes
        c.disc(x, y, r, dark)
        c.disc(x, y + 1, r - 2, ground)
        c.thick([(16, 8), (x, y - 2)], 4, dark)
        c.thick([(16, 9), (x, y - 1)], 2, ground)
    c.disc(16, 10, 6, dark)
    c.disc(16, 11, 4, ground)
    return c


def horn_print():
    c = C(32, 32)
    ground, dark = rgb("#5a4630"), rgb("#3a2c1c")
    c.disc(16, 18, 12, dark)
    c.disc(16, 19, 10, ground)
    c.disc(16, 19, 6, dark)
    c.disc(16, 20, 3, ground)
    return c


def fallen_log():
    c = C(64, 32)
    wood, dark, light, leaf = rgb("#7a5230"), rgb("#3f2a16"), rgb("#a8763f"), rgb("#6f9a52")
    c.thick([(6, 26), (58, 22)], 14, wood)
    c.thick([(6, 28), (58, 24)], 6, dark)
    c.thick([(8, 22), (56, 19)], 3, light)
    for x, y in ((14, 18), (30, 16), (46, 15)):
        c.disc(x, y, 3, leaf)
    c.disc(6, 26, 7, dark)
    c.disc(6, 26, 5, light)
    for x in (22, 38, 52):
        c.thick([(x, 18), (x + 4, 8)], 2, dark)
    return c


def sheet(name, draw, frames, default="walk-left", hold=7):
    im = Image.new("RGBA", (W * frames, H), (0, 0, 0, 0))
    for i in range(frames):
        im.alpha_composite(draw(i).im, (i * W, 0))
    im.save(os.path.join(OUT, name + ".png"))
    meta = {"name": name, "frame": [W, H], "anchor": [0.5, 1.0],
            "clips": {"walk-left": {"frames": list(range(frames)), "hold": hold, "loop": True}},
            "default": default}
    with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
        f.write("\n")
    print("wrote", name, im.size)


def prop_sheet(name, cell, cells, clip="idle"):
    w, h = cell
    im = Image.new("RGBA", (w * len(cells), h), (0, 0, 0, 0))
    for i, cellim in enumerate(cells):
        im.alpha_composite(cellim.im, (i * w, 0))
    im.save(os.path.join(OUT, name + ".png"))
    meta = {"name": name, "frame": [w, h], "anchor": [0.5, 1.0],
            "clips": {clip: {"frames": [0], "hold": 30}}, "default": clip}
    with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
        f.write("\n")
    print("wrote", name, im.size)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    # one pose per cell: left 0-3, then right 4-7 - but the clips below name them properly
    for name, draw in (("big_claw", metal_body), ("big_horn", horn_body)):
        im = Image.new("RGBA", (W * 8, H), (0, 0, 0, 0))
        for i in range(4):
            im.alpha_composite(draw(C(W, H), i).im, (i * W, 0))
            im.alpha_composite(draw(C(W, H), i).im.transpose(Image.FLIP_LEFT_RIGHT), ((i + 4) * W, 0))
        im.save(os.path.join(OUT, name + ".png"))
        meta = {"name": name, "frame": [W, H], "anchor": [0.5, 1.0],
                "clips": {"walk-left": {"frames": [0, 1, 2, 3], "hold": 7, "loop": True},
                          "walk-right": {"frames": [4, 5, 6, 7], "hold": 7, "loop": True}},
                "default": "walk-left"}
        with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
            f.write("\n")
        print("wrote", name, im.size)
    prop_sheet("print_claw", (32, 32), [claw_print()])
    prop_sheet("print_horn", (32, 32), [horn_print()])
    prop_sheet("log", (64, 32), [fallen_log()])
