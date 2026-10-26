#!/usr/bin/env python3
"""Draw the placeholder effect sheets the extra quests' scenes place on the map (web/quest-scenes.js `fx` steps).

    python3 tools/make_quest_fx.py

Input is PARAMS below: one entry per effect, with its cell size, the colours it is drawn from, and the clips it holds. Two
effects exist as examples, both original art drawn here from those parameters (no game asset is read):

  crate   a wooden crate that falls, squashes on landing and throws up dust -- for a `fall` motion with a bounce
  shard   a glowing data shard that appears, pulses and fades -- for `appear` / `fxplay` / `fxremove` with a fade

Output, committed (it is all original art):

  web/extra_fx/<name>.png    ONE strip of frames, left to right, each `frame` pixels, transparent background
  web/extra_fx/<name>.json   { "name", "frame": [w, h], "anchor": [ax, ay], "clips": {...}, "default" }

A clip is { "frames": [cell indices], "hold": field blanks per frame, "loop": bool }. The game plays the clip's frames in
order; a clip without "loop" holds its last frame, which is what makes "settle"/"gone" poses work. See
docs/quests-fx-brief.md for how to add a sheet drawn by an artist or an image generator instead.
"""
import json
import os

from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
OUT = os.path.join(ROOT, "web", "extra_fx")

# --------------------------------------------------------------------------------------------- the two effects
PARAMS = {
    "crate": {
        "frame": [24, 24],
        # feet on the bottom line of the cell, horizontally centred
        "anchor": [0.5, 1.0],
        "wood": "#b0783c",
        "wood_dark": "#5b3417",
        "wood_light": "#d8a25c",
        "metal": "#8a8a96",
        "dust": "#e3d3ad",
        "ink": "#2a1a0e",
        # cells: 0/1 fall, 2 squash, 3 stand, 4/5 dust, 6 puff, 7 faint puff
        "clips": {
            "fall": {"frames": [0, 1], "hold": 3, "loop": True},
            "hit": {"frames": [2], "hold": 5},
            "settle": {"frames": [3, 4, 5], "hold": 6},
            "idle": {"frames": [3], "hold": 30},
        },
        "default": "idle",
    },
    "shard": {
        "frame": [24, 24],
        "anchor": [0.5, 0.75],          # a shard floats: its point sits above the ground line
        "glow": "#3fd8ff",
        "core": "#eafdff",
        "deep": "#1b6f8f",
        "spark": "#b06bff",
        "ink": "#0d2a38",
        # cells: 0 small, 1 open, 2 full, 3 glow, 4 dim, 5 almost gone
        "clips": {
            "appear": {"frames": [0, 1, 2], "hold": 5},
            "idle": {"frames": [2, 1], "hold": 8, "loop": True},
            "fade": {"frames": [3, 4, 5], "hold": 5},
        },
        "default": "idle",
    },
    # A PROP sheet (the "props" of a quest, web/quest-props.js): art that stays on a map once a quest's state says the
    # world changed. The frame is a small signboard on two posts, standing on the ground -- the placeholder until a real
    # picture is drawn (docs/quests-fx-brief.md section 3).
    "frame": {
        "frame": [24, 32],
        "anchor": [0.5, 1.0],            # feet on the bottom line of the cell, horizontally centred
        "wood": "#8a5a2e",
        "wood_dark": "#4a2c12",
        "wood_light": "#c58a4e",
        "sky": "#7fc4e8",
        "hill": "#6fae4e",
        "sun": "#ffd85e",
        "nail": "#b9b9c4",
        "ink": "#2a1a0e",
        # cells: 0 the sign standing, 1 the same with a glint on its top rail
        "clips": {
            "idle": {"frames": [0], "hold": 30},
            "glint": {"frames": [1, 0], "hold": 14, "loop": True},
        },
        "default": "idle",
    },
}


def rgb(value, alpha=255):
    value = value.lstrip("#")
    return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16), alpha)


def shade(colour, factor, alpha=255):
    return (max(0, min(255, int(colour[0] * factor))), max(0, min(255, int(colour[1] * factor))),
            max(0, min(255, int(colour[2] * factor))), alpha)


class Cell:
    """One frame: a transparent square with the little set of pixel operations these effects need."""

    def __init__(self, w, h):
        self.im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        self.px = self.im.load()
        self.w, self.h = w, h

    def set(self, x, y, colour):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[x, y] = colour

    def rect(self, x0, y0, x1, y1, colour):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set(x, y, colour)

    def rect_outline(self, x0, y0, x1, y1, colour):
        for x in range(x0, x1 + 1):
            self.set(x, y0, colour)
            self.set(x, y1, colour)
        for y in range(y0, y1 + 1):
            self.set(x0, y, colour)
            self.set(x1, y, colour)

    def line(self, x0, y0, x1, y1, colour):
        dx, dy = abs(x1 - x0), abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx - dy
        while True:
            self.set(x0, y0, colour)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 > -dy:
                err -= dy
                x0 += sx
            if e2 < dx:
                err += dx
                y0 += sy

    def diamond(self, cx, cy, rx, ry, fill, edge=None):
        for y in range(cy - ry, cy + ry + 1):
            span = int(rx * (1 - abs(y - cy) / (ry + 0.001)))
            for x in range(cx - span, cx + span + 1):
                self.set(x, y, fill)
        if edge:
            for y in range(cy - ry, cy + ry + 1):
                span = int(rx * (1 - abs(y - cy) / (ry + 0.001)))
                self.set(cx - span, y, edge)
                self.set(cx + span, y, edge)
            for x in range(cx - rx, cx + rx + 1):
                top = cy - int(ry * (1 - abs(x - cx) / (rx + 0.001)))
                self.set(x, top, edge)
                self.set(x, cy + (cy - top), edge)


def draw_crate(p, index):
    """A 24x24 cell of the crate: box, X brace, ink outline; frames 2..7 are the landing and its dust."""
    w, h = p["frame"]
    c = Cell(w, h)
    wood, dark, light = rgb(p["wood"]), rgb(p["wood_dark"]), rgb(p["wood_light"])
    metal, dust, ink = rgb(p["metal"]), rgb(p["dust"]), rgb(p["ink"])
    base = h - 2                                    # the crate's feet line

    def box(x0, y0, x1, y1, tone=wood):
        c.rect(x0, y0, x1, y1, tone)
        c.rect_outline(x0, y0, x1, y1, ink)
        # the slats: two light bands across the face
        c.rect(x0 + 1, y0 + 2, x1 - 1, y0 + 2, light)
        c.rect(x0 + 1, y1 - 3, x1 - 1, y1 - 3, dark)
        # the diagonal brace
        c.line(x0 + 1, y1 - 1, x1 - 1, y0 + 1, dark)
        c.line(x0 + 1, y1 - 2, x1 - 1, y0 + 2, light)
        # the corner nails
        for (nx, ny) in ((x0 + 1, y0 + 1), (x1 - 1, y0 + 1), (x0 + 1, y1 - 1), (x1 - 1, y1 - 1)):
            c.set(nx, ny, metal)

    if index in (0, 1):
        # falling: the box drops a pixel and tips a little (the X brace leans)
        lift = 0 if index == 0 else 1
        box(5, 4 + lift, 18, base - 3 + lift)
        if index == 1:
            c.set(5, 4 + lift, (0, 0, 0, 0))
            c.set(18, base - 3 + lift, (0, 0, 0, 0))
            c.line(4, 5 + lift, 6, 6 + lift, ink)
    elif index == 2:
        # the impact: squashed wide and flat
        box(3, base - 8, 20, base, tone=shade(wood, 0.92))
        for x in range(4, 20, 3):                    # split slats
            c.line(x, base - 6, x + 2, base - 1, ink)
    elif index == 3:
        # standing still
        box(5, base - 14, 18, base)
    elif index in (4, 5):
        # settling, with dust thrown out to both sides
        box(5, base - 14, 18, base)
        spread = 2 if index == 4 else 4
        for (dx, dy) in ((-spread, 0), (spread, 0), (-spread + 1, -1), (spread - 1, -1)):
            c.set(12 + dx * 2, base - 1 + dy, dust)
            c.set(12 + dx * 2 + 1, base - 1 + dy, dust)
            c.set(12 + dx * 2, base - 2 + dy, shade(dust, 0.85))
    elif index == 6:
        # the puff alone, drifting up
        for (dx, dy, tone) in ((-5, -2, dust), (0, -3, dust), (5, -2, shade(dust, 0.9)), (-2, -5, shade(dust, 0.8)),
                               (3, -5, shade(dust, 0.8))):
            c.set(12 + dx, base + dy, tone)
            c.set(12 + dx + 1, base + dy, tone)
    else:
        # the last of the dust
        for (dx, dy) in ((-4, -4), (4, -4), (0, -6)):
            c.set(12 + dx, base + dy, shade(dust, 0.7, 160))
    return c


def draw_shard(p, index):
    """A 24x24 cell of the glowing data shard: the crystal, its glow and its sparks."""
    w, h = p["frame"]
    c = Cell(w, h)
    glow, core, deep = rgb(p["glow"]), rgb(p["core"]), rgb(p["deep"])
    spark, ink = rgb(p["spark"]), rgb(p["ink"])
    cx, cy = w // 2, h // 2 - 2
    if index == 0:
        c.diamond(cx, cy, 2, 4, glow, deep)
        c.set(cx, cy - 1, core)
    elif index == 1:
        c.diamond(cx, cy, 3, 6, glow, deep)
        c.diamond(cx, cy, 1, 3, core)
        c.set(cx - 4, cy - 6, spark)
        c.set(cx + 5, cy + 4, spark)
    elif index == 2:
        c.diamond(cx, cy, 4, 7, glow, ink)
        c.diamond(cx, cy, 2, 4, core)
        for (sx, sy) in ((-6, -7), (6, -5), (-5, 7), (7, 6)):
            c.set(cx + sx, cy + sy, spark)
        # a soft second halo, not a box: two rows of dim glow one step out from the crystal
        for (dx, dy) in ((-5, 0), (5, 0), (0, -9), (0, 8)):
            c.set(cx + dx, cy + dy, shade(glow, 0.75, 140))
    elif index == 3:
        c.diamond(cx, cy, 4, 7, shade(glow, 0.85, 200), shade(ink, 1.0, 180))
        c.diamond(cx, cy, 2, 4, shade(core, 0.95, 220))
        for (sx, sy) in ((-6, -6), (6, 5)):
            c.set(cx + sx, cy + sy, shade(spark, 0.8, 160))
    elif index == 4:
        c.diamond(cx, cy, 3, 5, shade(glow, 0.7, 150), None)
        c.diamond(cx, cy, 1, 2, shade(core, 0.8, 170))
    else:
        for (sx, sy) in ((-1, -3), (1, -1), (0, 2), (2, 3)):
            c.set(cx + sx, cy + sy, shade(glow, 0.6, 110))
    return c


def draw_frame(p, index):
    """A 24x32 cell of the signboard prop: two posts, a framed picture, a nail; cell 1 has a glint on the top rail."""
    w, h = p["frame"]
    c = Cell(w, h)
    wood, dark, light = rgb(p["wood"]), rgb(p["wood_dark"]), rgb(p["wood_light"])
    sky, hill, sun = rgb(p["sky"]), rgb(p["hill"]), rgb(p["sun"])
    nail, ink = rgb(p["nail"]), rgb(p["ink"])
    base = h - 1                                    # the feet line (anchor 1.0 is the bottom of the cell)
    top, bottom, left, right = 3, 17, 3, 20         # the board

    # the two posts, from under the board into the ground
    for x0 in (6, 16):
        c.rect(x0, bottom - 2, x0 + 1, base, wood)
        c.rect_outline(x0, bottom - 2, x0 + 1, base, ink)
        c.rect(x0, base - 1, x0 + 1, base, dark)    # a darker foot where it meets the ground

    # the board: a wooden frame around a little picture
    c.rect(left, top, right, bottom, wood)
    c.rect_outline(left, top, right, bottom, ink)
    c.rect(left + 1, top + 1, right - 1, top + 3, light)      # the lit top rail
    c.rect(left + 1, bottom - 2, right - 1, bottom - 1, dark)  # the shadowed bottom rail
    # the picture itself: sky, a hill and a sun
    c.rect(left + 3, top + 4, right - 3, bottom - 3, sky)
    c.rect_outline(left + 3, top + 4, right - 3, bottom - 3, dark)
    for x in range(left + 3, right - 2):
        for y in range(bottom - 3, bottom - 3 - int((x - (left + 3)) % 5 == 2), -1):
            c.set(x, y, hill)
    c.rect(left + 4, bottom - 4, right - 4, bottom - 3, hill)
    c.set(left + 5, top + 6, sun)
    c.set(left + 6, top + 6, sun)
    c.set(left + 5, top + 7, shade(sun, 0.85))
    # the nail that holds the board to the posts
    c.set(12, top + 2, nail)
    if index == 1:                                  # the glint: the top rail catches the light
        c.set(left + 2, top + 1, rgb("#fff6d0"))
        c.set(left + 3, top + 1, rgb("#fff6d0"))
        c.set(left + 2, top + 2, rgb("#fff6d0"))
    return c


DRAW = {"crate": draw_crate, "shard": draw_shard, "frame": draw_frame}


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, params in PARAMS.items():
        w, h = params["frame"]
        cells = sorted({i for clip in params["clips"].values() for i in clip["frames"]} | {0})
        count = max(cells) + 1
        sheet = Image.new("RGBA", (w * count, h), (0, 0, 0, 0))
        drawn = {}
        for i in cells:
            cell = DRAW[name](params, i)
            drawn[i] = cell
            sheet.paste(cell.im, (i * w, 0))
        png = os.path.join(OUT, f"{name}.png")
        sheet.save(png)
        meta = {
            "name": name,
            "frame": [w, h],
            "anchor": params["anchor"],
            "clips": params["clips"],
            "default": params["default"],
        }
        with open(os.path.join(OUT, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
            f.write("\n")
        print(f"wrote {png} ({sheet.width}x{sheet.height}, {len(cells)} frames) and {name}.json "
              f"({', '.join(params['clips'])})")


if __name__ == "__main__":
    main()
