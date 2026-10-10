#!/usr/bin/env python3
"""Author the 2010 Greymon variant in the browser battle model format.

The game's Greymon supplies the working body, skeleton, UV layout and clips.
Changed geometry and the newly painted atlas live in data/custom/m605xros.
"""

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web/assets/battle/models/m005grey/anim.json"
SOURCE_TEXTURE = ROOT / "web/assets/battle/textures/m005grey.png"
OUT = ROOT / "data/custom/m605xros"

# UV rectangles in the same 256-unit coordinate space as the extracted model.
# All are in formerly unused space below the original Greymon artwork.
UV = {
    "bright_steel": (3, 84, 29, 111),
    "shadow_steel": (35, 84, 61, 111),
    "blade": (67, 84, 93, 111),
    "blue": (99, 84, 125, 111),
    "orange": (131, 84, 157, 111),
}

BONE_NAMES = [
    "upper_torso", "neck", "helmeted_head", "jaw",
    "right_upper_arm", "right_forearm", "right_hand",
    "left_upper_arm", "left_forearm", "left_hand",
    "pelvis", "right_thigh", "right_shin", "right_ankle", "right_foot",
    "tail_base", "tail_middle", "tail_tip",
    "left_thigh", "left_shin", "left_ankle", "left_foot",
]


def point_uv(material, u, v):
    x0, y0, x1, y1 = UV[material]
    return (round(x0 + (x1 - x0) * u, 3),
            round(y0 + (y1 - y0) * v, 3))


def triangle(bone, points, material, coords=((0, 0), (1, 0), (.5, 1))):
    start = len(bone["verts"])
    bone["verts"].extend([list(p) for p in points])
    face = [start, start + 1, start + 2]
    for u, v in coords:
        face.extend(point_uv(material, u, v))
    bone["faces"].append(face)


def triangle_uv(bone, points, coords):
    start = len(bone["verts"])
    bone["verts"].extend([list(p) for p in points])
    bone["faces"].append([start, start + 1, start + 2,
                          *(n for uv in coords for n in uv)])


def raised_plate(bone, corners, ridge, material="bright_steel"):
    for k in range(len(corners)):
        triangle(bone, (corners[k], corners[(k + 1) % len(corners)], ridge),
                 material, ((0, 0), (1, 0), (.5, 1)))


def rebuild_tail(bones):
    """Loft a continuous curved profile over Greymon's three moving tail bones.

    The end center of each section is the next bone's ch1 attachment point.
    That keeps the surfaces joined at idle without changing animation keys.
    """
    profiles = {
        15: [(0, 0, 0, 195, 175), (0, -5, 125, 190, 165),
             (0, 15, 260, 165, 145), (0, 40, 368, 145, 125)],
        16: [(0, 0, 0, 145, 125), (0, -10, 115, 135, 112),
             (0, -65, 220, 115, 95), (0, -128, 323, 95, 78)],
        17: [(0, 0, 0, 95, 78), (0, -110, 155, 83, 65),
             (0, -260, 300, 67, 53), (0, -430, 450, 47, 38),
             (0, -600, 565, 29, 23), (0, -750, 675, 3, 3)],
    }
    sides = 12
    uv_offsets = {15: 0, 16: 368, 17: 691}
    total = 1366
    for index, profile in profiles.items():
        bone = bones[index]
        bone["verts"] = []
        bone["faces"] = []
        rings = []
        for cx, cy, cz, rx, ry in profile:
            rings.append([(round(cx + rx * math.cos(2 * math.pi * k / sides)),
                           round(cy + ry * math.sin(2 * math.pi * k / sides)), cz)
                          for k in range(sides)])
        for i in range(len(rings) - 1):
            for k in range(sides):
                j = (k + 1) % sides
                u0 = 4 + 248 * (uv_offsets[index] + profile[i][2]) / total
                u1 = 4 + 248 * (uv_offsets[index] + profile[i + 1][2]) / total
                v0 = 120 + 64 * k / sides
                v1 = 120 + 64 * (k + 1) / sides
                a, b, c, d = ((u0, v0), (u1, v0), (u1, v1), (u0, v1))
                triangle_uv(bone, (rings[i][k], rings[i + 1][k], rings[i + 1][j]),
                            (a, b, c))
                triangle_uv(bone, (rings[i][k], rings[i + 1][j], rings[i][j]),
                            (a, c, d))


def paint_atlas():
    original = Image.open(SOURCE_TEXTURE).convert("RGBA")
    atlas = original.copy()
    pix = atlas.load()
    # Keep the hand-painted game islands aligned with their established UVs.
    # Shift the blue skin slightly toward the deeper violet blue in the shared
    # character reference. Metal, eyes, orange marks and transparent gaps stay.
    for y in range(320):
        for x in range(1024):
            r, g, b, a = pix[x, y]
            if a and b > r * 1.16 and b > g * 1.05 and 42 < b < 225:
                pix[x, y] = (max(0, int(r * .93)), max(0, int(g * .95)),
                             min(255, int(b * 1.10)), a)

    draw = ImageDraw.Draw(atlas)
    for name, palette in {
        "bright_steel": ((180, 194, 202, 255), (99, 116, 128, 255), (233, 239, 237, 255)),
        "shadow_steel": ((76, 88, 100, 255), (43, 55, 66, 255), (155, 172, 181, 255)),
        "blade": ((148, 161, 162, 255), (66, 78, 87, 255), (229, 235, 229, 255)),
        "blue": ((67, 87, 127, 255), (40, 57, 91, 255), (117, 141, 178, 255)),
        "orange": ((225, 105, 74, 255), (151, 64, 54, 255), (249, 155, 112, 255)),
    }.items():
        x0, y0, x1, y1 = (round(v * 4) for v in UV[name])
        base, dark, light = palette
        draw.rectangle((x0, y0, x1, y1), fill=base)
        draw.polygon([(x0, y0), (x1, y0), (x0, y1)], fill=light)
        draw.polygon([(x1, y0), (x1, y1), (x0, y1)], fill=dark)
        draw.line([(x0 + 8, y1 - 10), (x1 - 12, y0 + 13)],
                  fill=(38, 48, 59, 255), width=5)
        draw.line([(x0 + 12, y1 - 12), (x1 - 14, y0 + 16)],
                  fill=(216, 224, 225, 255), width=2)
        for px, py in ((x0 + 14, y0 + 14), (x1 - 14, y1 - 14)):
            draw.ellipse((px - 3, py - 3, px + 3, py + 3), fill=dark)
    # One continuous UV strip runs from the hip through all three animated
    # tail sections. Orange crescents are painted across that strip, and the
    # silver terminal starts only at the tapered tip.
    pix = atlas.load()
    for py in range(480, 737):
        v = (py - 480) / 256
        side_light = .80 + .20 * math.cos((v - .15) * math.tau)
        for px in range(16, 1009):
            t = (px - 16) / 992
            curve = .014 * math.sin(v * math.tau)
            stripe = any(abs(t - center - curve) < .018 for center in (.21, .40, .62, .80))
            if t > .91:
                c = (int(171 * side_light), int(186 * side_light),
                     int(193 * side_light), 255)
            elif stripe:
                c = (int(231 * side_light), int(105 * side_light),
                     int(76 * side_light), 255)
            else:
                c = (int(80 * side_light), int(101 * side_light),
                     int(146 * side_light), 255)
            pix[px, py] = c
    draw = ImageDraw.Draw(atlas)
    for center in (.21, .40, .62, .80):
        x = round(16 + 992 * center)
        draw.line((x + 16, 485, x + 16, 730), fill=(39, 54, 84, 255), width=3)
    draw.line((round(16 + 992 * .91), 480, round(16 + 992 * .91), 736),
              fill=(45, 58, 68, 255), width=8)
    atlas.save(OUT / "texture.png")


def author_model():
    model = json.loads(SOURCE.read_text())
    model["folder"] = "m605xros"
    model["custom_variant"] = "Greymon (2010 Anime Version)"
    bones = model["bones"]
    head = bones[2]

    # Existing horns and moving jaw remain connected to their original bones.
    # Raise the side horn tips and form the helmet's center ridge and cheeks.
    for i in (33, 35):
        head["verts"][i][1] -= 155
    raised_plate(head,
                 ((-125, -345, -275), (125, -345, -275),
                  (105, -385, -780), (-105, -385, -780)),
                 (0, -465, -625), "shadow_steel")
    for side in (-1, 1):
        raised_plate(head,
                     ((side * 175, -255, -370), (side * 345, -200, -370),
                      (side * 340, -60, -700), (side * 190, -130, -825)),
                     (side * 405, -255, -615), "shadow_steel")
    rebuild_tail(bones)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "anim.json").write_text(json.dumps(model, separators=(",", ":")))
    (OUT / "bone_names.json").write_text(json.dumps(BONE_NAMES, indent=2) + "\n")
    paint_atlas()
    print(f"Authored {OUT.relative_to(ROOT)}: {len(bones)} animated bones, "
          f"{sum(len(b['faces']) for b in bones)} triangles")


if __name__ == "__main__":
    author_model()
