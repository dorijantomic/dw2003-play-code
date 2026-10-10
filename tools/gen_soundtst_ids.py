"""SUPERSEDED 2026-08-05 by tools/extract_soundtst.py -- do not "fix" this file
piecemeal.

It contains TWO defects that cancel each other out. (1) The word regex below
accepts only `.word 0x...`, so it silently drops every symbolic `.word D0x...`
word -- including all 72 array terminator name pointers. (2) The terminator test
compares the record against {0, 0}, but a real terminator is
{name_ptr = 0x80082cb0, packed_id = 0}. Because the dropped word reads back as
zero, the walk happens to stop in the right place, which is why its 113
common-bank records are correct. Repairing only the regex will silently over-run
every array. See docs/research/audio/soundtst-full-decode-2026-08-05.md and
ledger AUDIO-SOUNDTST-TABLES-001.

Original docstring follows.
Regenerate soundtst-common-ids.json from the dev Sound Test overlay.

Record layout PROVEN by the overlay's own play code (soundtst.s file 0x1a44-0x1a6c,
RAM 0x800846f4-0x8008471c): row*8 indexes the category array; the PLAYED id is
`lw $a0, 0x4($v0)` (offset +4) and the DRAWN name is `lw $a1, ($s0)` (offset +0),
so each 8-byte record is {name_ptr, packed_id}.

The 2026-07-02f parse assumed {packed_id, name_ptr} and started at file 0x2100
(mid-array; the true common array starts at 0x20c4), which paired every id with
the NEXT record's name -- all 105 names were shifted by one. Discovered
2026-07-03 when the recovered EXE bytes + this raw parse disagreed with it.

Category pointer table: file 0x2a34 (RAM 0x800856e4), one array pointer per
Sound Test category (category N = archive id N+1). Arrays end at a {0,0} record.
Overlay RAM base 0x80082cb0 (pro slot).
"""
import json
import re
from pathlib import Path

import os

HERE = Path(__file__).resolve().parent.parent / "docs/research/audio"
SOUNDTST = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro/soundtst.s"
BASE = 0x80082CB0
PTR_TABLE = 0x2A34
N_CATEGORIES = 72

words = {}
for m in re.finditer(r"\.L0x([0-9a-f]{8}): \.word 0x([0-9a-f]+)", SOUNDTST.read_text()):
    words[int(m.group(1), 16)] = int(m.group(2), 16)


def cstr(file_off):
    out = bytearray()
    while True:
        w = words.get(file_off & ~3, 0).to_bytes(4, "little")
        b = w[file_off & 3]
        if b == 0:
            break
        out.append(b)
        file_off += 1
    # fullwidth Shift-JIS -> ASCII
    return out.decode("shift_jis", "replace").translate(
        {c: c - 0xFEE0 for c in range(0xFF01, 0xFF5F)} | {0x3000: 0x20}
    )


def records(cat):
    arr = words.get(PTR_TABLE + cat * 4, 0)
    off = arr - BASE
    out = []
    while True:
        name_ptr = words.get(off, 0)
        pid = words.get(off + 4, 0)
        if name_ptr == 0 and pid == 0:
            break
        name = cstr(name_ptr - BASE) if BASE < name_ptr < BASE + 0x8000 else None
        out.append({"name": name, "id": pid})
        off += 8
    return out


def main():
    tones = {t["slot"]: t for t in json.load(open(HERE / "common-tones-full.json"))}
    common = []
    for r in records(0):
        pid = r["id"]
        rec = {"id": f"0x{pid:08x}", "slot": pid & 0xFF, "name": r["name"]}
        if not (pid >> 31) & 1:  # 2D flat-slot path: annotate the tone
            t = tones.get(rec["slot"])
            if t:
                rec.update(
                    {k: t[k] for k in ("program", "tone", "vag") if k in t}
                )
        common.append(rec)
    with open(HERE / "soundtst-common-ids.json", "w") as f:
        json.dump(common, f, indent=1)
    print(f"soundtst-common-ids.json: {len(common)} records")

    # cross-check against soundtst-all-categories.json (independent parse),
    # when that research file is present
    if not (HERE / "soundtst-all-categories.json").exists():
        return
    allcats = json.load(open(HERE / "soundtst-all-categories.json"))
    ac = {
        int(r["id"], 16): r["name"]
        for r in allcats
        if isinstance(r, dict) and r.get("category") == 0
    }
    bad = [
        r for r in common if ac.get(int(r["id"], 16)) not in (None, r["name"])
    ]
    print(f"cross-check vs all-categories: {len(bad)} name mismatches")
    for r in bad[:10]:
        print("  MISMATCH", r["id"], r["name"], "vs", ac.get(int(r["id"], 16)))


if __name__ == "__main__":
    main()
