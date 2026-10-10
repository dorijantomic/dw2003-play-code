"""
Extracts the stage display-name table from FIELDSTG_PRO.

Each of the 112 base screens (0x200–0x26f) has an 8-byte record:
  +0  u8  area_idx   → esstarea.toml[area_idx]
  +1  u8  name_idx   → esstname.toml[name_idx]
  +2  u8  (counter / cross-ref, ignored)
  +3  u8  0x02       (constant)
  +4  u8  alt_area_idx   (other-server variant of same stage)
  +5  u8  alt_name_idx
  +6  u8  (counter)
  +7  u8  0x02

Table location: fieldstg+0x143e8, stride=8, 112 entries.
Found by scanning for the run that satisfies all known-good anchors
(s200, s205, s210, s350, s400; verified 2026-06-13).

Usage:
  python3 tools/stage_names.py            # writes data/stage_names.json
  python3 tools/stage_names.py --print    # dump to stdout
"""

import os
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DISC = Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin")
SCREEN_TABLE = ROOT / "data/screen_table.json"
OUT = ROOT / "data/stage_names.json"

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
ESSTNAME = DDW3 / "lang_file/dw2003/eng/esstname.toml"
ESSTAREA = DDW3 / "lang_file/dw2003/eng/esstarea.toml"

SECTOR_RAW = 2352
SECTOR_DATA = 2048
DATA_OFFSET = 24
FIELDSTG_LBA_START = 560
FIELDSTG_SECTORS = 50

TABLE_OFFSET = 0x143e8
RECORD_STRIDE = 8
BASE_SCREEN_MAX = 0x270   # screens 0x200–0x26f are the 112 base screens


def load_strings(path):
    return re.findall(r'"([^"]*)"', path.read_text())


def extract_fieldstg(disc_bytes):
    return b"".join(
        disc_bytes[(FIELDSTG_LBA_START + s) * SECTOR_RAW + DATA_OFFSET:][:SECTOR_DATA]
        for s in range(FIELDSTG_SECTORS)
    )


def compose_name(area_str, name_str):
    if area_str and name_str and area_str != name_str:
        return f"{area_str} — {name_str}"
    return area_str or name_str or ""


def extract(disc_bytes):
    """Return {stage_id_str: display_name} for all decodable stages.

    Pass 1: primary (bytes 0-1) for each of the 112 base screens.
    Pass 2: secondary (bytes 4-5) for variant stages pointed to by byte 6
            (byte 6 = screen_table index of the stage that owns the secondary name).
            Secondary names are only added for stages not already covered by pass 1.
    """
    fieldstg = extract_fieldstg(disc_bytes)
    areas = load_strings(ESSTAREA)
    names = load_strings(ESSTNAME)

    screen_table = json.loads(SCREEN_TABLE.read_text())
    all_screens = sorted(screen_table.items(), key=lambda x: int(x[0]))
    base_screens = [(sid, v) for sid, v in all_screens if int(sid) < BASE_SCREEN_MAX]

    result = {}

    # Find all valid records: a record is valid if its first half passes
    # (area < len(areas), name < len(names), byte3 == 0x02).
    # The table has 112 base-screen entries followed by extended entries (indices 112+)
    # that cover the remaining high-range screens not reachable via byte2/byte6 cross-refs.
    all_records = []
    for i in range(512):  # well above the actual count
        off = TABLE_OFFSET + i * RECORD_STRIDE
        a, n, b2, b3 = fieldstg[off], fieldstg[off+1], fieldstg[off+2], fieldstg[off+3]
        if a >= len(areas) or n >= len(names) or b3 != 0x02:
            break
        all_records.append(i)

    def _add(stage_key, a, n):
        if stage_key not in result and a < len(areas) and n < len(names):
            nm = compose_name(areas[a], names[n])
            if nm:
                result[stage_key] = nm

    for i in all_records:
        off = TABLE_OFFSET + i * RECORD_STRIDE
        a,  n  = fieldstg[off],     fieldstg[off + 1]
        b2     = fieldstg[off + 2]
        a2, n2 = fieldstg[off + 4], fieldstg[off + 5]
        b6     = fieldstg[off + 6]

        # For base-screen entries (first 112): the stage comes from base_screens[i]
        if i < len(base_screens):
            _, v = base_screens[i]
            _add(f"s{v['stage']}", a, n)

        # byte 2 cross-ref: primary name also applies to the stage at all_screens[b2]
        if b2 < len(all_screens):
            _, vv = all_screens[b2]
            _add(f"s{vv['stage']}", a, n)

        # byte 6 cross-ref: secondary name applies to the stage at all_screens[b6]
        if b6 < len(all_screens) and a2 < len(areas) and n2 < len(names):
            _, vv = all_screens[b6]
            _add(f"s{vv['stage']}", a2, n2)

    return result


def main():
    disc = DISC.read_bytes()
    table = extract(disc)

    if "--print" in sys.argv:
        for k in sorted(table, key=lambda s: int(s[1:])):
            print(f"{k}: {table[k]}")
    else:
        OUT.write_text(json.dumps(table, indent=1, sort_keys=True))
        print(f"wrote {OUT} ({len(table)} stages)", file=sys.stderr)


if __name__ == "__main__":
    main()
