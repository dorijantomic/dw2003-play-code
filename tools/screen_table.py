"""
Extracts the game-wide screen→stage warp table from FIELDSTG_PRO.

Every stage has a global *screen id* (u32, 0x200..0x2ee): doors warp by
screen id, never by stage number or LBA index. The mapping lives in
FIELDSTG_PRO as 294 records of 12 bytes {screen_id u32, wstag_lba_idx u32,
overlay_entry_ptr u32}. The ddw3 repo only disassembles the first 64KB of
FIELDSTG, so the canonical source is the raw disc image: the file is
hidden (not in the ISO filesystem), addressed by LBA table index 358.

Provenance + verification: docs/research/wstag-vm-notes.md
(sessions 2-4) -- table found live in RAM, located on disc at sector 607,
verified against an emulator-observed inn→city transition.

Usage:
  python3 tools/screen_table.py            # writes data/screen_table.json
  python3 tools/screen_table.py --print    # table to stdout
"""

import os
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DISC = Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin")
LBA_RS = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "rust/dw2003_exe_data/src/lba.rs"
OUT = ROOT / "data/screen_table.json"
# The same table is served to the browser at assets/data/screen_table.json
# (web/game.js fetches it for handoff routing) and read by the inn/stagslct UI
# extractors, so the build ships a copy in the web tree.
WEB_OUT = ROOT / "web/assets/data/screen_table.json"

SECTOR_RAW = 2352  # MODE2/2352 raw sector
SECTOR_DATA = 2048
DATA_OFFSET = 24   # user data starts after sync+header+subheader

FIELDSTG_LBA_START = 560   # from LBA_OFFSETS[358], read out of a RAM dump
FIELDSTG_SECTORS = 50      # from LBA_LEN_SECTORS[358]

SCREEN_MIN, SCREEN_MAX = 0x200, 0x2FF
LBA_FILE_COUNT = 2382


def parse_lba_names(rs_text):
    """LBA index -> file name, from lba.rs `LBA_<NAME>_IDX` constants."""
    return {int(idx): name for name, idx in
            re.findall(r"pub const LBA_(\w+)_IDX: usize = (\d+);", rs_text)}


def extract_file(disc_bytes, lba_start, sectors):
    return b"".join(
        disc_bytes[(lba_start + s) * SECTOR_RAW + DATA_OFFSET:]
        [:SECTOR_DATA] for s in range(sectors))


def _valid_record(blob, off):
    if off + 12 > len(blob):
        return None
    sid, lba, ptr = struct.unpack_from("<3I", blob, off)
    if SCREEN_MIN <= sid <= SCREEN_MAX and 0 < lba < LBA_FILE_COUNT:
        return (sid, lba)
    return None


def find_warp_table(blob, min_records=200):
    """Longest run of valid 12-byte warp records anywhere in the file."""
    # Run length at every 4-byte offset, computed back-to-front: a run
    # starting at a misframed offset must not shadow the true table start.
    runlen = {}
    for off in range(((len(blob) - 12) // 4) * 4, -4, -4):
        runlen[off] = 1 + runlen.get(off + 12, 0) if _valid_record(blob, off) \
            else 0
    best_off = max(runlen, key=runlen.get, default=None)
    n = runlen.get(best_off, 0)
    if n < min_records:
        raise ValueError(f"no warp-record run >= {min_records} found "
                         f"(best: {n} at {best_off})")
    return [_valid_record(blob, best_off + i * 12) for i in range(n)]


def build_table(records, lba_names):
    """{screen_id: {stage, lbaIdx, file[, alt]}}.

    Screens 0x200..0x26f map 1:1 to base stages (sorted). Screens 0x270+
    are the story-variant stages (s201, s203, ...) sorted among
    themselves; 55 of them carry a second record aliasing a s920..s974
    stage (the s9xx record comes first in table order). The sub-900 stage
    is stored as primary, the s9xx alias under "alt".
    """
    table = {}
    for sid, lba in records:
        name = lba_names.get(lba, "")
        m = re.fullmatch(r"WSTAG(\d+)_PRO", name)
        if not m:
            raise ValueError(f"screen {sid:#x} -> lba {lba} = {name!r}, "
                             "not a WSTAG overlay")
        entry = {"stage": int(m.group(1)), "lbaIdx": lba, "file": name}
        prev = table.get(str(sid))
        if prev:
            primary, alt = sorted([prev, entry], key=lambda e: e["stage"])
            alt.pop("alt", None)
            entry = {**primary, "alt": alt}
        table[str(sid)] = entry
    return table


def main():
    names = parse_lba_names(LBA_RS.read_text())
    fieldstg = extract_file(DISC.read_bytes(), FIELDSTG_LBA_START,
                            FIELDSTG_SECTORS)
    records = find_warp_table(fieldstg)
    table = build_table(records, names)

    # Sanity: primary stage numbers ascend with screen id within each
    # region (base stages 0x200..0x26f, story variants 0x270+).
    sids = sorted(table, key=int)
    for region in (lambda s: int(s) < 0x270, lambda s: int(s) >= 0x270):
        stages = [table[s]["stage"] for s in sids if region(s)]
        assert stages == sorted(stages), "screen ids not stage-ordered"
    duals = sum("alt" in table[s] for s in sids)
    print(f"{len(records)} records -> {len(table)} screens "
          f"({duals} with s9xx alias)", file=sys.stderr)

    if "--print" in sys.argv:
        for sid in sorted(table, key=int):
            v = table[sid]
            print(f"{int(sid):#x} ({sid}) -> s{v['stage']} (lba {v['lbaIdx']})")
    else:
        text = json.dumps(table, indent=1, sort_keys=True)
        OUT.write_text(text)
        WEB_OUT.parent.mkdir(parents=True, exist_ok=True)
        WEB_OUT.write_text(text)
        print(f"wrote {OUT} + {WEB_OUT.relative_to(ROOT)} ({len(table)} screens)",
              file=sys.stderr)


if __name__ == "__main__":
    main()
