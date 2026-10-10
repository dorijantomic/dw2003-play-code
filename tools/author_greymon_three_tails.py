#!/usr/bin/env python3
"""Author two additional animated tails on a separate Greymon battle variant."""

import copy
import json
import math
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web/assets/battle/models/m005grey/anim.json"
SOURCE_TEXTURE = ROOT / "web/assets/battle/textures/m005grey.png"
FOLDER = "m005tri"
OUT = ROOT / "data/custom" / FOLDER

SIDES = 12
SEGMENTS = (
    # length, rise, radius at root, radius at end
    (350, 28, 145, 105),
    (335, 20, 105, 65),
    (390, 8, 65, 3),
)
TOTAL_LENGTH = sum(part[0] for part in SEGMENTS)


def pose_keys(reference, side, section):
    """Follow every original battle motion, with a distinct outward tail sweep."""
    spread = (245, 75, 55)[section]
    return [
        [round(az * 0.78 + side * 25 * math.sin(frame / 38 + section)),
         round(ay * 0.72 + side * spread),
         round(ax * 0.78), frame]
        for az, ay, ax, frame in reference
    ]


def make_section(length, rise, root_radius, end_radius, distance, section):
    """Make one tapered, closed ring mesh whose end meets the next bone."""
    bone = {"verts": [], "faces": []}
    rings = []
    for step in range(5):
        t = step / 4
        # Put the first ring inside its parent so a turning joint stays covered.
        z = round(length * t - (32 * (1 - t) if section else 40 * (1 - t)))
        y = round(rise * t + 12 * math.sin(math.pi * t))
        radius = root_radius * (1 - t) + end_radius * t
        if step == 0 and section:
            radius *= 1.08
        ring = []
        for corner in range(SIDES):
            angle = 2 * math.pi * corner / SIDES
            ring.append(len(bone["verts"]))
            bone["verts"].append([
                round(radius * math.cos(angle)),
                round(y + radius * .84 * math.sin(angle)), z,
            ])
        rings.append(ring)

    for step in range(4):
        for corner in range(SIDES):
            nxt = (corner + 1) % SIDES
            u0 = 5 + 246 * (distance + length * step / 4) / TOTAL_LENGTH
            u1 = 5 + 246 * (distance + length * (step + 1) / 4) / TOTAL_LENGTH
            v0 = 104 + 72 * corner / SIDES
            v1 = 104 + 72 * (corner + 1) / SIDES
            a, b = rings[step][corner], rings[step + 1][corner]
            c, d = rings[step + 1][nxt], rings[step][nxt]
            bone["faces"].append([a, b, c, u0, v0, u1, v0, u1, v1])
            bone["faces"].append([a, c, d, u0, v0, u1, v1, u0, v1])
    return bone


def paint_texture():
    atlas = Image.open(SOURCE_TEXTURE).convert("RGBA")
    pixels = atlas.load()
    # The original Greymon faces stop above native V=80. This strip is used
    # only by the two new tails; all original face colours remain untouched.
    for y in range(104 * 4, 177 * 4):
        around = (y / 4 - 104) / 72
        shade = .86 + .14 * math.cos((around - .18) * 2 * math.pi)
        for x in range(5 * 4, 252 * 4):
            along = (x / 4 - 5) / 246
            chevron = .038 * abs(around - .5)
            marking = any(abs(along - center - chevron) < .021
                          for center in (.18, .39, .62, .81))
            if along > .955:
                base = (190, 197, 190)
            elif marking:
                base = (208, 90, 69)
            else:
                base = (94, 124, 160)
            pixels[x, y] = tuple(round(channel * shade) for channel in base) + (255,)
    atlas.save(OUT / "texture.png")


def author():
    model = json.loads(SOURCE.read_text())
    assert max(face[index] for bone in model["bones"] for face in bone["faces"]
               for index in (4, 6, 8)) < 104, "new tail atlas strip overlaps Greymon's UVs"
    model["folder"] = FOLDER
    model["custom_variant"] = "Three-Tailed Greymon"
    original = model["bones"]
    hip = original[10]
    for side in (-1, 1):
        parent = 10  # original hip/root of the center tail
        distance = 0
        for section, (length, rise, r0, r1) in enumerate(SEGMENTS):
            mesh = make_section(length, rise, r0, r1, distance, section)
            distance += length
            if section == 0:
                translation = [side * 260, 405, 395, 0]
                # A broad hip socket moves with Greymon's pelvis. The tail's
                # first ring sits inside it as the tail rotates in battle.
                socket = make_section(175, 0, 185, 125, 0, 0)
                offset = len(hip["verts"])
                hip["verts"].extend([[x + side * 260, y + 405, z + 300]
                                     for x, y, z in socket["verts"]])
                hip["faces"].extend([[a + offset, b + offset, c + offset,
                                      *face[3:]] for face in socket["faces"]
                                     for a, b, c in [face[:3]]])
            else:
                prev_length, prev_rise, _, _ = SEGMENTS[section - 1]
                translation = [0, prev_rise, prev_length, 0]
            bone = {
                "parent_slot": parent + 1,
                "verts": mesh["verts"],
                "faces": mesh["faces"],
                "anim": {
                    "ch1": [translation, translation[:3] + [30000]],
                    "ch2": pose_keys(original[15 + section]["anim"]["ch2"], side, section),
                    "ch3": copy.deepcopy(original[15 + section]["anim"]["ch3"]),
                },
            }
            model["bones"].append(bone)
            parent = len(model["bones"]) - 1
    model["num_bones"] = len(model["bones"])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "anim.json").write_text(json.dumps(model, separators=(",", ":")) + "\n")
    paint_texture()
    print(f"{FOLDER}: {model['num_bones']} bones, "
          f"{sum(len(b['faces']) for b in model['bones'])} triangles")


if __name__ == "__main__":
    author()
