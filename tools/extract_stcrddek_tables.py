#!/usr/bin/env python3
"""Extract the card-folder editor's static data tables.

The folder editor's card grid and its "Change name" keyboard read two fixed
data slabs:

  * the overlay's own tables (pro/stcrddek) — the six cursor-pulse frame words
    at 0x8008A484, and the NAMEDT keyboard's tables: the character-page struct
    and its label/grid pages (0x8008B368 lang0, 0x8008B604 other), the glyph
    object 0x8008B6E4, the hint table 0x8008B6FC, the wide-key clips
    0x8008B7DC and the arrow CLUT frames 0x8008B818.
  * the resident glyph tables the keyboard's glyph object points into:
    0x8004E010 (the glyph code table) and 0x8004E3BC (the blank-glyph entry).

Both are data only; no instruction bytes are emitted. Reproduce with:

  python3 tools/exe_decomp/overlay_to_fns.py ~/ddw3/asm/dw2003/pro/stcrddek.s \
      exe-decomp/stcrddek.fns.s
  tools/build_native_screens.py   # produces web/assets/native/screens/*.bin

then run this file. Output: web/assets/data/stcrddek_tables.json.

The overlay base is 0x80082CB0; the resident base is 0x80010000.
"""

import base64
import json
from hashlib import sha256
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OVERLAY_BIN = REPO / "web/assets/native/screens/pro_stcrddek.bin"
RESIDENT_BIN = REPO / "web/assets/native/screens/resident.bin"
OUT = REPO / "web/assets/data/stcrddek_tables.json"

OVERLAY_BASE = 0x80082CB0
RESIDENT_BASE = 0x80010000

# (base, length) of each slab, in load order. The overlay slab runs from the
# cursor-frame table to just past the keyboard's char-page struct; the resident
# slab covers the glyph code table and the blank-glyph entry it points to.
SLABS = (
    (0x8004D000, 0x2000),   # resident: glyph code table + blank entry
    (0x8008A484, 0x13DC),   # overlay: cursor frames + NAMEDT keyboard tables
)


def main() -> int:
    overlay = OVERLAY_BIN.read_bytes()
    resident = RESIDENT_BIN.read_bytes()
    slabs = []
    for base, length in SLABS:
        source, source_base = ((overlay, OVERLAY_BASE) if base >= 0x80080000
                               else (resident, RESIDENT_BASE))
        offset = base - source_base
        if offset < 0 or offset + length > len(source):
            raise SystemExit(f"slab {base:#x}+{length:#x} outside {source_base:#x} image")
        data = source[offset:offset + length]
        slabs.append({
            "base": base,
            "size": length,
            "sha256": sha256(data).hexdigest(),
            "bytes_base64": base64.b64encode(data).decode("ascii"),
        })
    OUT.write_text(json.dumps({"schema": 1, "slabs": slabs}, indent=1) + "\n")
    print(f"wrote {OUT} ({len(slabs)} slabs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
