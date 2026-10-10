"""
Extracts the field engine's stage-entry LOCATION TITLE CARD from FIELDSTG_PRO.

When you walk into a screen the game names the place: an area name near the top
("Kusanagi City") and a place name below it ("Street Corner"), typed out one
character at a time over a set of coloured bars that slide in around them, held
for a second, then wiped away by a horizontal slit closing to nothing.

Two things here are DATA and are read from the overlay:

  1. The name table at 0x80097098 (file 0x143E8), 4 bytes per record:
         +0x0  u8   area string index   -> ESSTAREA bank
         +0x1  u8   place string index  -> ESSTNAME bank
         +0x2  u16  scene id            (0 terminates the table)
     239 records. Claim FIELD-SCENE-PLACENAME-TABLE-2026-08-14.

  2. The ten bar templates at 0x80097458 (file 0x147A8), 0x24 bytes per record,
     copied into the card object at +0x50 by F0x80087974 case 0:
         +0x00 s32  enabled            (0 in the template; the state machine
                                        switches each bar on in its own turn)
         +0x04 s16  x        +0x06 s16 y
         +0x08 s16 w        +0x0A s16 h
         +0x0C u32  colour   (byte 0 = R, 1 = G, 2 = B -- it is written straight
                              into a GP0 0x28 flat quad by F0x80087854)
         +0x10 s32  axis     1 = animate x and w, 2 = animate y and h
                             (F0x80087704's two cases), 0 = finished
         +0x14 s32  target near edge
         +0x18 s32  target far edge
         +0x1C s32  pixels per frame

The rest of the card -- which bar is switched on when, the one-second hold and
the closing wipe -- is CODE, not data, so it lives in engine/dw3/place-card.ts
next to its citations rather than being invented here.

Scene id -> walker map id goes through data/screen_table.json, which carries the
same 239 scenes.

Usage:
  .venv/bin/python3 tools/extract_place_card.py          # writes the JSON
  .venv/bin/python3 tools/extract_place_card.py --print  # dump to stdout
"""

import os
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DISC = Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin")
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
ESSTAREA = DDW3 / "lang_file/dw2003/eng/esstarea.toml"
ESSTNAME = DDW3 / "lang_file/dw2003/eng/esstname.toml"
SCREEN_TABLE = ROOT / "data/screen_table.json"
OUT = ROOT / "web/assets/data/place_card.json"

SECTOR_RAW = 2352
SECTOR_DATA = 2048
DATA_OFFSET = 24
FIELDSTG_LBA_START = 560
FIELDSTG_SECTORS = 50

OVERLAY_BASE = 0x80082CB0
NAME_TABLE = 0x80097098
BAR_TABLE = 0x80097458
BAR_STRIDE = 0x24
BAR_COUNT = 10


def extract_fieldstg(disc: bytes) -> bytes:
    return b"".join(
        disc[(FIELDSTG_LBA_START + s) * SECTOR_RAW + DATA_OFFSET:][:SECTOR_DATA]
        for s in range(FIELDSTG_SECTORS)
    )


def load_strings(path: Path) -> list:
    return re.findall(r'"([^"]*)"', path.read_text())


def read_names(fieldstg: bytes, areas: list, places: list, screens: dict) -> dict:
    """{walker map id: {scene, area, place}} for every record in the table."""
    out = {}
    off = NAME_TABLE - OVERLAY_BASE
    while True:
        area_idx, place_idx = fieldstg[off], fieldstg[off + 1]
        scene = int.from_bytes(fieldstg[off + 2:off + 4], "little")
        if scene == 0:
            break
        row = screens.get(str(scene))
        if row is None:
            raise SystemExit(f"scene 0x{scene:x} is not in data/screen_table.json")
        record = {
            "scene": scene,
            "area": areas[area_idx],
            "place": places[place_idx],
        }
        out[f"s{row['stage']}"] = record
        # A handful of scenes ship a second overlay for the mirrored server; it
        # is the same place and carries the same name.
        if "alt" in row:
            out[f"s{row['alt']['stage']}"] = dict(record)
        off += 4
    return out


def read_bars(fieldstg: bytes) -> list:
    bars = []
    base = BAR_TABLE - OVERLAY_BASE
    for i in range(BAR_COUNT):
        rec = fieldstg[base + i * BAR_STRIDE: base + (i + 1) * BAR_STRIDE]
        x, y, w, h = struct.unpack_from("<4h", rec, 0x04)
        colour = struct.unpack_from("<I", rec, 0x0C)[0]
        axis, near, far, step = struct.unpack_from("<4i", rec, 0x10)
        bars.append({
            "x": x, "y": y, "w": w, "h": h,
            "color": [colour & 0xFF, (colour >> 8) & 0xFF, (colour >> 16) & 0xFF],
            "axis": axis, "near": near, "far": far, "step": step,
        })
    return bars


def build() -> dict:
    disc = DISC.read_bytes()
    fieldstg = extract_fieldstg(disc)
    areas = load_strings(ESSTAREA)
    places = load_strings(ESSTNAME)
    screens = json.loads(SCREEN_TABLE.read_text())
    names = read_names(fieldstg, areas, places, screens)
    bars = read_bars(fieldstg)
    return {
        "_provenance": {
            "source": "FIELDSTG_PRO (disc LBA 560, 50 sectors)",
            "name_table": f"0x{NAME_TABLE:08x} (file 0x{NAME_TABLE - OVERLAY_BASE:05x}), 4-byte records, zero-terminated",
            "bar_table": f"0x{BAR_TABLE:08x} (file 0x{BAR_TABLE - OVERLAY_BASE:05x}), {BAR_COUNT} records of 0x{BAR_STRIDE:x}",
            "strings": "eng/esstarea.toml (resource 0xa9 + language), eng/esstname.toml (0xb7 + language)",
            "claims": [
                "FIELD-SCENE-PLACENAME-TABLE-2026-08-14",
                "FIELD-SCENE-2D7-STREET-CORNER-2026-08-14",
            ],
            "doc": "docs/research/ui/field-location-title-card-2026-08-16.md",
            "note": "Generated by tools/extract_place_card.py - do not hand-edit.",
        },
        "bars": bars,
        "stages": dict(sorted(names.items(), key=lambda kv: int(kv[0][1:]))),
    }


def main() -> None:
    data = build()
    if "--print" in sys.argv:
        json.dump(data, sys.stdout, indent=1)
        print()
        return
    OUT.write_text(json.dumps(data, indent=1) + "\n")
    print(
        f"wrote {OUT} ({len(data['stages'])} stages, {len(data['bars'])} bars)",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
