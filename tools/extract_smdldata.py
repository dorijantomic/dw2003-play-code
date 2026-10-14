#!/usr/bin/env python3
"""Extract the per-Digimon battle presentation table from `pro/smdldata.s`.

The consumer is `FIGHTSTG_F0x8009e994`, reached through the fightstg data pointer
`D0x800a4570` (claim `smdldata-consumer-is-fightstg-f8009e994-record-lookup-2026-08-18`).
It requests resource 0x1cc, walks the 4-byte index entries by their u16 key, and
resolves the record as `section2 + selfIndex * 0xC4` when the entry's slot byte is
below 58, else `section3 + selfIndex * 0x48`.

Two record fields place the fighter (claim
`smdldata-record-0x10-standoff-0x18-hover-2026-08-18`), read by the arena placement
routine `FIGHTSTG_F0x80087f38`:

    x = 0
    y = -record[+0x18]                       # hover; 0 stands on the floor
    z = -+(0x1400 + record[+0x10])           # near side negative, far side positive

and the canned camera shots come from arrays on the same record (claim
`fight-camera-canned-shots-are-per-model-smdldata-arrays-2026-08-18`), read by
`FIGHTSTG_F0x800923b4` -- twelve shots in a 0xC4 record, three in a 0x48 one.

The key is the Digimon's model number, which is the numeric prefix of its pack
folder under `web/assets/battle/models`.

2026-08-18, second pass -- the rest of the record (claim
`smdldata-record-head-is-three-packed-model-pack-references-2026-08-18` and
`smdldata-record-0x44-is-the-far-side-canned-shot-number-2026-08-18`):

    +0x00  packed reference (resource << 16) | member, the model's part directory
    +0x04  packed reference, member 0 in 246 of 248 records
    +0x08  packed reference, member+1 of the +0x00 one in 203 of 248 records
    +0x02  the high half all three share: the CD resource index of that Digimon's
           own model pack, handed to the loader's ready-test and request calls
    +0x0c  self-relative pointer into the shared pool
    +0x10  arena stand-off              +0x18  hover height
    +0x12/+0x14/+0x16   read by NO instruction in the game (see the claim
                        `smdldata-record-0x12-0x14-0x16-have-no-reader-2026-08-18`)
    +0x1a.. camera arrays
    +0x44  section-3 records only: the 1-based canned shot number the intro camera
           uses for that enemy. Inside a section-2 record that offset is eye[7].x.

The shared pool `+0x0c` points at is that Digimon's animated-texture list (claim
`smdldata-pool-slot-is-the-per-model-animated-texture-patch-list-2026-08-18`):
up to 16 ten-byte entries, `0xff` in byte 0 ending the walk and a zero width in
byte 2 skipping an entry. Each entry is a VRAM rectangle copy re-issued every
frame -- `FIGHTSTG_F0x8008b160` builds a GP0(0x80) copy-rectangle primitive from
it through `F0x8002918c` -- with three alternative source rectangles:

    byte 0,1   destination x, y        byte 2,3   width, height
    byte 4,5   source x, y for variant 0
    byte 6,7   source x, y for variant 1
    byte 8,9   source x, y for variant 2

All four coordinates are relative to the fighter's own 64x256 VRAM strip, whose
origin comes from the four-entry table `D0x800a2530` in fightstg, not from this
file. Entries 0 and 1 run on a blink timer and hold the eye open, half closed and shut;
entries 2..15 cycle 0,1,2 forever and hold looping body animation such as flames.
See tools/render_texture_patches.py, which resolves and draws them.
"""
from __future__ import annotations
import os

import argparse
import json
import re
import struct
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_SRC = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro/smdldata.s"
DEFAULT_OUT = REPO / "web/assets/battle/model_placement.json"

# F0x80087f38: the constant the stand-off is added to, and the side test.
BASE_Z = 0x1400
# F0x8009e994: the slot byte that separates the two sections.
SECTION_SPLIT = 0x3A
# F0x8008b508: the pool walk -- 16 slots of 10 bytes, 0xff in byte 0 ends it and
# a zero byte 2 (the width) skips the slot.
POOL_SLOTS = 16
POOL_STRIDE = 10
POOL_END = 0xFF
# D0x800a2530 in pro/fightstg.s: the VRAM origin of each of the four fighter
# strips, which is what every pool coordinate is relative to. Carried here so the
# extracted rectangles can be placed; it is NOT part of smdldata.
SLOT_TEXTURE_ORIGINS = [[0x340, 0x000], [0x380, 0x000], [0x3C0, 0x000], [0x3C0, 0x100]]
# F0x800140d8: a packed resource reference splits (resource << 16) | member.
RESOURCE_SHIFT = 16
MEMBER_MASK = 0xFFFF

LABEL = re.compile(r"^\.L0x([0-9a-fA-F]+):")
# A `.word` row is sometimes emitted as a symbol (`.word D0x80082cb0`); the two
# such rows in this file are header word 0 and one record's +0x0c pool pointer,
# so a hex-only pattern silently reads both as zero.
WORD = re.compile(r"\.word\s+D?(0x[0-9a-fA-F]+)")


def load_image(path: Path) -> bytes:
    """Flatten the disassembler's `.word` rows back into the file image."""
    words: dict[int, int] = {}
    cursor: int | None = None
    for line in path.read_text(errors="replace").splitlines():
        text = line.strip()
        match = LABEL.match(text)
        if match:
            cursor = int(match.group(1), 16)
        word = WORD.search(text)
        if word and cursor is not None:
            words[cursor] = int(word.group(1), 16)
            cursor += 4
    if not words:
        raise SystemExit(f"no .word rows in {path}")
    image = bytearray(max(words) + 4)
    for offset, value in words.items():
        struct.pack_into("<I", image, offset, value)
    return bytes(image)


def s16(image: bytes, offset: int) -> int:
    return struct.unpack_from("<h", image, offset)[0]


def u16(image: bytes, offset: int) -> int:
    return struct.unpack_from("<H", image, offset)[0]


def u32(image: bytes, offset: int) -> int:
    return struct.unpack_from("<I", image, offset)[0]


def packed(image: bytes, offset: int) -> tuple[int, int]:
    """One packed resource reference, split the way F0x800140d8 splits it."""
    word = u32(image, offset)
    return word >> RESOURCE_SHIFT, word & MEMBER_MASK


def texture_anim(image: bytes, offset: int) -> list[dict]:
    """The record's shared-pool slot, walked exactly as F0x8008b508 walks it."""
    entries = []
    for index in range(POOL_SLOTS):
        raw = image[offset + index * POOL_STRIDE: offset + (index + 1) * POOL_STRIDE]
        if raw[0] == POOL_END:
            break
        if raw[2] == 0:
            continue
        entries.append({
            "slot": index,
            "dst": [raw[0], raw[1]],
            "size": [raw[2], raw[3]],
            "src": [[raw[4], raw[5]], [raw[6], raw[7]], [raw[8], raw[9]]],
        })
    return entries


def triple(image: bytes, offset: int) -> list[int]:
    """One camera vector. The routine negates the second and third components."""
    return [s16(image, offset), -s16(image, offset + 2), -s16(image, offset + 4)]


# FIGHTSTG_F0x80091C1C (fightstg.s:15355-15409) picks one of the record's camera groups by the
# side of the speaker and reads three vectors out of it: eye at record+0x1A+6g, the point it
# looks at at record+0x62+6g, and the projection distance H at record+0xAA+2g. Y and Z of both
# vectors are negated on the way in (fightstg.s:15380, :15390, :15398, :153a8-153b0). The
# group index is 6 when the speaker's code at (the line record)+0x18 is zero and 7 when it is
# not, i.e. group 6 is the player side and group 7 the enemy side.
FACE_BOX_EYE_AT = 0x1A
FACE_BOX_TARGET_AT = 0x62
FACE_BOX_H_AT = 0xAA
FACE_BOX_GROUPS = (6, 7)


def face_box(image: bytes, record: int) -> list[dict | None]:
    """The close-up face box's per-side shot, read at the game's own offsets.

    A 0x48 record only carries three camera groups, so group 6 and group 7 fall past its end.
    F0x80091C1C does not care and reads the neighbouring record's bytes; this reads them the
    same way, out of the flattened image, so a short record's framing is what the console
    computes rather than a zero-filled stand-in. Where the read leaves the file altogether the
    console is reading whatever the loader put after the resource, which this file does not
    describe, and the row is None.
    """
    rows = []
    for group in FACE_BOX_GROUPS:
        eye_at = record + FACE_BOX_EYE_AT + 6 * group
        target_at = record + FACE_BOX_TARGET_AT + 6 * group
        h_at = record + FACE_BOX_H_AT + 2 * group
        if h_at + 2 > len(image):
            rows.append(None)
            continue
        rows.append({
            "group": group,
            "eye": triple(image, eye_at),
            "target": triple(image, target_at),
            "H": s16(image, h_at),
        })
    return rows


def extract(src: Path) -> dict:
    image = load_image(src)
    pool_base, index_off, section2, section3 = struct.unpack_from("<4I", image, 0)

    models: dict[str, dict] = {}
    offset = index_off
    while True:
        key = s16(image, offset)
        if key == 0:
            break
        self_index = image[offset + 2]
        slot = image[offset + 3]
        offset += 4

        far = slot >= SECTION_SPLIT
        record = (section3 + self_index * 0x48) if far else (section2 + self_index * 0xC4)
        # Twelve shots fit a 0xC4 record, three fit a 0x48 one; the look-at and
        # view-size arrays sit at different offsets on each side.
        shots = 3 if far else 12
        look_at, view_at = (0x2C, 0x3E) if far else (0x62, 0xAA)

        resource, member0 = packed(image, record + 0x00)
        _r1, member1 = packed(image, record + 0x04)
        _r2, member2 = packed(image, record + 0x08)

        models[str(key)] = {
            "section": 3 if far else 2,
            "slot": slot,
            # The Digimon's own model pack, and the three members of it the
            # fight actor is built from.
            "resource": resource,
            "members": [member0, member1, member2],
            # +0x0c is stored as an absolute pointer against header word 0.
            "pool": u32(image, record + 0x0C) - pool_base,
            "texture_anim": texture_anim(image, u32(image, record + 0x0C) - pool_base),
            # F0x80087F38 reads both with `lhu` (fightstg.s:5437-5441, :5450-5454): the fields are
            # UNSIGNED and are negated into the slot afterwards. A record that ever set the high
            # bit would diverge under a signed read; none of the shipped 248 do.
            "standoff": u16(image, record + 0x10),
            "hover": u16(image, record + 0x18),
            # Carried, not interpreted: no instruction in the game reads these.
            "unread": [s16(image, record + 0x12), s16(image, record + 0x14),
                       s16(image, record + 0x16)],
            "camera": {
                "eye": [triple(image, record + 0x1A + 6 * i) for i in range(shots)],
                "look": [triple(image, record + look_at + 6 * i) for i in range(shots)],
                "view": [s16(image, record + view_at + 2 * i) for i in range(shots)],
            },
        }
        # Only a 0x48 record has a field here; in a 0xC4 one the offset is eye[7].x.
        if far:
            models[str(key)]["shot"] = s16(image, record + 0x44)
        # The battle close-up face box reads groups 6 and 7 whatever the record's length,
        # so every record carries both of its side framings. See face_box() above.
        models[str(key)]["face_box"] = face_box(image, record)

    return {
        "source": "pro/smdldata.s",
        "resource": "0x1cc",
        "base_z": BASE_Z,
        "pool_base": pool_base,
        "slot_texture_origins": SLOT_TEXTURE_ORIGINS,
        "note": (
            "Per-Digimon battle placement and canned camera shots. Slot position is "
            "x=0, y=-hover, z=-(base_z+standoff) on the near side and +(base_z+standoff) "
            "on the far side. Keyed by model number (the numeric prefix of the pack folder). "
            "`resource` is that Digimon's own model-pack resource index and `members` are the "
            "three members of it the fight actor is built from; `shot` is the far-side intro "
            "camera's 1-based shot number; `unread` carries +0x12/+0x14/+0x16, which no "
            "instruction in the game reads. `texture_anim` is the record's shared-pool "
            "slot: per-frame VRAM rectangle copies with three variants each, in coordinates "
            "relative to `slot_texture_origins[arena slot]`. Entries in pool slots 0 and 1 "
            "are the blink; 2 and up cycle their three variants continuously. "
            "`face_box` is the battle close-up box's per-side framing (group 6 = player "
            "side, group 7 = enemy side): the eye, the point it looks at and the projection "
            "distance H, read at the offsets FIGHTSTG_F0x80091C1C uses, so a record too "
            "short to hold them carries whatever the console reads past its end."
        ),
        "models": models,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", type=Path, default=DEFAULT_SRC)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    data = extract(args.src)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, separators=(",", ":")) + "\n")

    models = data["models"]
    hovering = sum(1 for row in models.values() if row["hover"])
    animated = sum(1 for row in models.values() if row["texture_anim"])
    near = sum(1 for row in models.values() if row["section"] == 2)
    print(f"{args.out}: {len(models)} models ({near} near-side, {len(models) - near} far-side), "
          f"{hovering} hovering, {animated} with an animated texture patch")


if __name__ == "__main__":
    main()
