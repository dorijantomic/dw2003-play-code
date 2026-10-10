#!/usr/bin/env python3
"""Copy the FIELDSTG overlay image the field interpreter reads out of the disc.

web/assets/native/fieldstg.bin is the whole on-disc FIELDSTG.PRO extent -- the
50 sectors LBA_LEN_SECTORS gives file index 358 -- exactly as the console loads
it into the resident overlay slot. Tools that decode fieldstg tables
(extract_step_enable_table.py, extract_npc_confirm_box.py, ...) and the browser's
native stage interpreter read it. The disc is ddw3's rebuilt image
($DDW3/build/iso/dw2003.bin, see tools/build_ddw3_disc.py).
"""
import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_native_screens import DEFAULT_DISC, LBA_LEN_SECTORS, LBA_OFFSETS, load_exe  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web/assets/native/fieldstg.bin"
FIELDSTG_INDEX = 358
SECTOR, DATA = 2352, 2048


def main() -> int:
    disc = Path(os.environ.get("DW3_DISC") or DEFAULT_DISC)
    with open(disc, "rb") as fh:
        base, exe = load_exe(fh)
        lba = struct.unpack_from("<I", exe, LBA_OFFSETS + FIELDSTG_INDEX * 4 - base)[0]
        n = struct.unpack_from("<H", exe, LBA_LEN_SECTORS + FIELDSTG_INDEX * 2 - base)[0]
        blob = bytearray()
        for s in range(n):
            fh.seek((lba + s) * SECTOR + 24)
            blob += fh.read(DATA)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(bytes(blob))
    print(f"wrote {OUT} ({len(blob)} bytes, LBA {lba}, {n} sectors)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
