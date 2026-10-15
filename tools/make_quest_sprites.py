#!/usr/bin/env python3
"""Draw the sprites of the NEW characters the extra quests add, and write web/extra_npcs.json.

    python3 tools/make_quest_sprites.py

Input: data/authored/quests/new_characters.json (see docs/quests-bible.md, "New characters"). Each character is either

  * "look": {...}   a figure drawn here from a few parameters (skin, hair, outfit...), original art, no game assets used; or
  * "views": "path.png"   ONE picture from an image generator: 1 to 4 figures of the same character in a row (front, side facing
                          right, back; a fourth, the other side, is skipped), on ANY flat background. The tool removes the
                          background itself, finds the figures, shrinks them to game size ("height", default 34, the disc's
                          townspeople are 33-35), and builds the walk frames plus the idle "breathing" clip the game plays
                          for anyone standing still. See docs/quests-art-brief.md.
  * "sheet": "path.png"   a finished sprite sheet someone drew (any tool): 120 x 384 px, 8 rows (down, down-left, left, right,
                          up-left, up, down-right, up-right) of 5 frames, each 24 x 48, transparent background.

Output (committed, it is all original art): web/extra_sprites/q<npc_id>.png and web/extra_npcs.json, which game.js reads at
start: the sprite records, the npc_id -> sprite table, and the "residents" (where each character stands on which map).
"""
import json
import os
import sys

from PIL import Image, ImageFilter

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
    """A figure drawn from parameters: the sheet and a function giving the standing frame for a direction."""
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
    return sheet, (lambda name: sheet.crop((0, ROWS.index(name) * H, W, ROWS.index(name) * H + H)))


# ------------------------------------------------------------------ pictures from an image generator
def cutout(im, tolerance=105):
    """Make the background transparent, whatever it is, with no manual step.

    A picture that already has real transparency is left alone. Otherwise the background colour is the commonest colour
    along the picture's border, and everything of about that colour that is connected to the border is removed (so a
    green backpack or a white shoe inside the figure stays). Then a few pixels are shaved off the figure's edge: the
    picture is shrunk about twelve times afterwards, so this costs nothing and keeps the background's tint out."""
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    clear = sum(1 for x in range(0, w, 7) for y in range(0, h, 7) if px[x, y][3] < 200)
    if clear > (w // 7) * (h // 7) * 0.05:
        return im                                                  # already cut out
    border = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    bins = {}
    for r, g, b, _ in border:
        bins.setdefault((r // 24, g // 24, b // 24), []).append((r, g, b))
    key = max(bins.values(), key=len)
    bg = tuple(sum(c[i] for c in key) // len(key) for i in range(3))
    near = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) < tolerance:
                near[y * w + x] = 1
    gone = bytearray(w * h)
    stack = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    while stack:
        x, y = stack.pop()
        i = y * w + x
        if gone[i] or not near[i]:
            continue
        gone[i] = 1
        if x > 0:
            stack.append((x - 1, y))
        if x < w - 1:
            stack.append((x + 1, y))
        if y > 0:
            stack.append((x, y - 1))
        if y < h - 1:
            stack.append((x, y + 1))
    for y in range(h):
        for x in range(w):
            if gone[y * w + x]:
                px[x, y] = (0, 0, 0, 0)
    im.putalpha(im.getchannel("A").filter(ImageFilter.MinFilter(7)))
    return im


def find_figures(im, gap=14):
    """The separate figures in a cut-out picture, left to right, as (left, right) pixel columns: runs of columns that hold
    something, split wherever there are at least `gap` empty columns."""
    a = im.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    w, h = a.size
    cols = [a.crop((x, 0, x + 1, h)).getbbox() is not None for x in range(w)]
    runs, start, empty = [], None, 0
    for x in range(w):
        if cols[x]:
            if start is None:
                start = x
            empty = 0
            last = x
        elif start is not None:
            empty += 1
            if empty >= gap:
                runs.append((start, last + 1))
                start, empty = None, 0
    if start is not None:
        runs.append((start, last + 1))
    return [r for r in runs if r[1] - r[0] >= 20]


def _fit(view, height=34, aspect=0.6):
    """Crop to the figure, shrink to `height` px tall (the disc's townspeople are 26 to 40 tall, mostly 33 to 35), with the
    colours reduced to a game-like palette, hard edges, and a dark outline."""
    box = view.getbbox()
    if not box:
        return Image.new("RGBA", (W, H), (0, 0, 0, 0))
    view = view.crop(box)
    height -= 2                                  # the outline added below makes the sprite 2 px taller and wider
    scale = height / view.height
    # generated characters come out slimmer than the disc's chunky chibi people, so never narrower than `aspect` x height
    nw = max(1, min(21, max(round(view.width * scale), round(height * aspect))))
    small = view.convert("RGBa").resize((nw, height), Image.LANCZOS).convert("RGBA")      # premultiplied: edges do not smear
    spx = small.load()
    solid = [(x, y) for y in range(height) for x in range(nw) if spx[x, y][3] > 128]
    strip = Image.new("RGB", (max(1, len(solid)), 1))
    for i, (x, y) in enumerate(solid):
        strip.putpixel((i, 0), spx[x, y][:3])
    pal = strip.quantize(colors=22, method=Image.MEDIANCUT)         # only the figure's own pixels count
    cols = pal.getpalette()
    cell = Image.new("RGBA", (nw, height), (0, 0, 0, 0))
    cpx = cell.load()
    for i, (x, y) in enumerate(solid):
        k = pal.getpixel((i, 0))
        cpx[x, y] = (cols[3 * k], cols[3 * k + 1], cols[3 * k + 2], 255)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.alpha_composite(cell, ((W - nw) // 2, 44 - height))
    c = Canvas()
    c.im = out
    c.px = out.load()
    return c.outline()


def views_from_picture(path, height=34, flip_side=False, aspect=0.6):
    """Front, side (facing right) and back figures from one picture with 2 to 4 figures in a row: 3 = front, side, back;
    4 = front, side, other side, back; 2 = front, side (the back is the front)."""
    im = cutout(Image.open(path))
    figs = find_figures(im)
    pick = {1: (0, 0, 0), 2: (0, 1, 0), 3: (0, 1, 2), 4: (0, 1, 3)}.get(len(figs))
    if pick is None:
        raise ValueError(f"{os.path.basename(path)}: found {len(figs)} separate figures, expected 1 to 4 in a row "
                         "(they must not touch, and the background must be one flat colour)")
    views = [_fit(im.crop((figs[i][0] - 2, 0, figs[i][1] + 2, im.height)), height, aspect) for i in pick]
    if flip_side:
        views[1] = views[1].transpose(Image.FLIP_LEFT_RIGHT)
    return views


def base_from_views(views):
    def base(name):
        if name.startswith("down"):
            v, dx = views[0], {"down": 0, "down-left": -1, "down-right": 1}[name]
        elif name.startswith("up"):
            v, dx = views[2], {"up": 0, "up-left": -1, "up-right": 1}[name]
        else:
            v, dx = (views[1].transpose(Image.FLIP_LEFT_RIGHT) if name == "left" else views[1]), 0
        f = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        f.alpha_composite(v, (dx, 0))
        return f
    return base


def sheet_from_base(base):
    sheet = Image.new("RGBA", (W * COLS, H * len(ROWS)), (0, 0, 0, 0))
    for r, name in enumerate(ROWS):
        f = base(name)
        for col, dy in enumerate((0, -1, 0, -1, 0)):
            sheet.alpha_composite(_shift(f, dy=dy), (col * W, r * H))
    return sheet


# ------------------------------------------------------------------ the game's own animation clips
CLIP_DIRS = ["down", "down-left", "left", "up-left", "up"]       # the game mirrors the right-hand ones
PER_DIR = 8
SPLIT = 31                                                     # rows above this line move when the figure breathes


def _shift(f, dx=0, dy=0, upper_only=False, upper_dx=0):
    """The figure moved; with upper_only the head and body move (breathing) and the legs stay planted."""
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if not upper_only:
        out.alpha_composite(f, (dx, dy))
        return out
    out.alpha_composite(f.crop((0, SPLIT, W, H)), (0, SPLIT))
    out.alpha_composite(f.crop((0, 0, W, SPLIT)), (upper_dx, dy))
    return out


def clip_sheet(base):
    """Clip 1 (idle: stand, breathe in, stand, breathe in) and clip 4 (scripted walk: a bob and a sway) for each direction.
    The game plays clip 1 for anyone standing still, which is why a plain sheet looks frozen next to the disc's characters."""
    sheet = Image.new("RGBA", (W * PER_DIR * len(CLIP_DIRS), H), (0, 0, 0, 0))
    for di, d in enumerate(CLIP_DIRS):
        f = base(d)
        frames = [f, _shift(f, dy=1, upper_only=True), f,
                  _shift(f, dy=-1), f, _shift(f, dy=-1)]
        for k, fr in enumerate(frames):
            sheet.alpha_composite(fr, ((di * PER_DIR + k) * W, 0))
    return sheet


def clip_data():
    clips = {"1": {}, "4": {}}
    for di, d in enumerate(CLIP_DIRS):
        b = di * PER_DIR
        clips["1"][d] = {"cols": [b, b + 1, b + 2, b + 1], "durations": [26, 20, 26, 20], "bottoms": [4, 4, 4, 4]}
        clips["4"][d] = {"cols": [b + 3, b + 4, b + 5, b + 4], "durations": [9, 10, 9, 10], "bottoms": [4, 4, 4, 4]}
    return clips


def record(rid, name):
    return {
        "id": rid, "name": name, "sheet": f"extra_sprites/{rid}.png", "frameW": W, "frameH": H, "rows": ROWS,
        "frameCounts": {r: COLS for r in ROWS},
        "frameDurations": {r: [12, 9, 12, 9, 12] for r in ROWS},
        "frameBottomShift": {r: [4] * COLS for r in ROWS},
        "clipSheet": f"extra_sprites/clips/{rid}.png", "clipFrameW": W, "clipFrameH": H, "clips": clip_data(),
    }


def main():
    spec = json.load(open(SRC, encoding="utf-8"))
    os.makedirs(os.path.join(OUT_DIR, "clips"), exist_ok=True)
    npcs, table, residents, problems = [], {}, [], []
    for ch in spec["characters"]:
        nid = int(ch["npc_id"])
        rid = f"q{nid}"
        if nid < 1000:
            problems.append(f"{ch['name']}: npc_id {nid} must be 1000 or more (below that are the game's own characters)")
            continue
        try:
            if "views" in ch:
                base = base_from_views(views_from_picture(os.path.join(ROOT, ch["views"]), ch.get("height", 34), ch.get("flip_side", False), ch.get("aspect", 0.6)))
                img = sheet_from_base(base)
            elif "sheet" in ch:
                img = Image.open(os.path.join(ROOT, ch["sheet"])).convert("RGBA")
                if img.size != (W * COLS, H * len(ROWS)):
                    problems.append(f"{ch['name']}: sheet is {img.size}, must be {(W * COLS, H * len(ROWS))}")
                    continue
                base = (lambda name, im_=img: im_.crop((0, ROWS.index(name) * H, W, ROWS.index(name) * H + H)))
            else:
                img, base = sheet_for(ch["look"])
        except ValueError as e:
            problems.append(f"{ch['name']}: {e}")
            continue
        img.save(os.path.join(OUT_DIR, rid + ".png"))
        clip_sheet(base).save(os.path.join(OUT_DIR, "clips", rid + ".png"))
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
