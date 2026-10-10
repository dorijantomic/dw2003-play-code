#!/usr/bin/env python3
"""
Extract and decode the SOUNDTST developer sound-test overlay in full.

Decode source: ~/ddw3/asm/dw2003/pro/soundtst.s (RAM base 0x80082cb0, file
0x2d98 bytes). The overlay is 100% byte-accounted -- see BYTE_MAP below.

`soundtst` is the developers' Sound Test, left on the retail disc alongside
`stagslct`. Start exits it to the Stage Select through the same resident
screen launcher: F0x80084370 (file 0x1708) and the menu handler's state0 == 3
branch (file 0x2064) both call D0x8004b440(0x1500, 0), and 0x1500 is the
launch code stagslct's own record table assigns to its Stage Select row.

THREE TABLES, ALL WALKED STRUCTURALLY:

  file 0x20c4  71 per-category sound arrays, 8-byte records
               {char *name, u32 packed_id}, each terminated by a record whose
               packed_id is 0. Record shape and terminator are proven by the
               overlay's own code: the count loop at file 0x1868-0x188c tests
               `lw $v0, 4($s4)` for zero, the play path at file 0x19e8-0x19ec
               takes the id from +4, and the row drawer at file 0x1a94-0x1a98
               takes the drawn name from +0.
  file 0x2a34  71 pointers, one per category, into the arrays above.
  file 0x2b50  72 category records {char *name, s32 archive_id}, 71 real plus
               a terminator whose archive_id is 0 (count loop, file 0x1c54).

The three regions tile exactly: 0x2a34 + 71*4 == 0x2b50, and
0x2b50 + 72*8 == 0x2d90, which is where the trailing UI descriptor begins.
That mutual agreement is the check that the category count is 71.

TERMINATOR TRAP -- read before touching any parser for this overlay. An array
terminator is {name_ptr = 0x80082cb0, packed_id = 0}, NOT {0, 0}: the name
pointer aims at the overlay's leading zero word, i.e. the empty string. The
disassembler renders that pointer symbolically as `.word D0x80082cb0` because
it equals the overlay base, so a regex matching only `.word 0x...` drops it
and reads the terminator as {0, 0}. docs/research/audio/gen_soundtst_ids.py
has BOTH bugs and they cancel out. Fixing only the regex silently over-runs
every array; fix the terminator test at the same time.

Output: docs/research/audio/soundtst-categories.json
"""

import os
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
SOUNDTST_S = DDW3 / "asm/dw2003/pro/soundtst.s"
OUT = ROOT / "docs/research/audio/soundtst-categories.json"

BASE = 0x80082CB0
FILE_SIZE = 0x2D98
ARRAY_PTR_TABLE = 0x2A34   # file offset, read at file 0x1824
CATEGORY_TABLE = 0x2B50    # file offset, read at file 0x1890 and 0x1c4c

WORD_RE = re.compile(r"\.L0x([0-9a-f]{8}): \.word (?:0x([0-9a-f]+)|D0x([0-9a-f]+))")

BYTE_MAP = [
    {"start": "0x0000", "end": "0x0004", "what": "empty string",
     "detail": "the zero word every array terminator's name pointer aims at"},
    {"start": "0x0004", "end": "0x16c0", "what": "name strings",
     "detail": "NUL-terminated fullwidth Shift-JIS; sound names, category names, "
               "and at 0x167c/0x16ac/0x16bc the screen's own heading, title and cursor"},
    {"start": "0x16c0", "end": "0x20c4", "what": "code", "detail": "eight functions"},
    {"start": "0x20c4", "end": "0x2a34", "what": "71 per-category sound arrays",
     "detail": "8-byte {char *name, u32 packed_id} records, terminated by packed_id == 0"},
    {"start": "0x2a34", "end": "0x2b50", "what": "array pointer table",
     "detail": "71 pointers, indexed by the selected category"},
    {"start": "0x2b50", "end": "0x2d90", "what": "category table",
     "detail": "72 x {char *name, s32 archive_id}; 71 real plus a terminator"},
    {"start": "0x2d90", "end": "0x2d98", "what": "UI service descriptor",
     "detail": "{0x00000000, 0x00f00140}, argument 1 of shared UI service slot "
               "+0x16c at file 0x1f14; stagslct passes the identical pair"},
]

FUNCTIONS = [
    {"addr": "0x80084370", "file": "0x16c0", "name": "screenTaskHandler",
     "role": "Outer screen task handler. On state0 == 1 it polls D0x8004bbc4(0) "
             "and, if bit 3 is set, calls D0x8004b440(0x1500, 0) -- the resident "
             "screen launcher, with stagslct's Stage Select launch code. On "
             "state0 == 0 it creates the menu task via F0x80084d48 and publishes "
             "the pointer through its second argument. States 2 and 3 do nothing."},
    {"addr": "0x80084410", "file": "0x1760", "name": "registerScreenTask",
     "role": "F0x80014504(F0x80084370, 0x50, 4)."},
    {"addr": "0x8008443c", "file": "0x178c", "name": "moveCursor",
     "role": "Shared list mover for both list screens. Takes (self, delta, "
             "&cursor, &scroll) with the row count on the stack at 0x10(sp). "
             "Clamps the absolute cursor to 0..count-1, then slides the scroll "
             "so the cursor stays inside an EIGHT-row window: scroll = cursor-7 "
             "when the cursor passes the bottom, scroll = cursor when it passes "
             "the top."},
    {"addr": "0x800844a8", "file": "0x17f8", "name": "soundListScreen",
     "role": "state1 == 2. Counts the selected category's records, drives Up/Down "
             "through F0x8008443c, and plays and stops sounds. See INPUT."},
    {"addr": "0x80084808", "file": "0x1b58", "name": "archiveLoader",
     "role": "state1 == 1. Issues the archive load for the chosen category -- "
             "D0x80055c58(0, 1) for archive id 1 (the COMMON bank) and "
             "D0x80055c54(archive_id) otherwise -- then polls D0x80055c60() and "
             "advances to the sound list once it returns zero."},
    {"addr": "0x800848bc", "file": "0x1c0c", "name": "categoryListScreen",
     "role": "state1 == 0. Counts the 71 category records, drives Up/Down through "
             "F0x8008443c, and on Circle stores the chosen record's archive_id at "
             "self+0x5c and advances to the loader."},
    {"addr": "0x80084b2c", "file": "0x1e7c", "name": "menuTaskHandler",
     "role": "The screen. state0 == 0 builds the widgets; state0 == 1 dispatches "
             "on state1 to the category list, the loader or the sound list; "
             "state0 == 2 idles; state0 == 3 calls D0x8004b440(0x1500, 0) to "
             "leave for the Stage Select."},
    {"addr": "0x80084d48", "file": "0x2098", "name": "registerMenuTask",
     "role": "F0x80014504(F0x80084b2c, 0x74, 0x2c)."},
]

STATE_MACHINE = {
    "dispatch": "state0 at self+0xc (file 0x1e9c), then state1 at self+0x10 (file 0x200c)",
    "states": [
        {"state0": 0, "file": "0x1ecc-0x2008", "name": "build",
         "does": "Initialises the shared UI service (D0x8004de10 slots +0x150, "
                 "+0x154 with 0x5000, +0x174 with 320x240, +0x16c with the "
                 "trailing descriptor) and builds eleven class-A text widgets: "
                 "title at (16, 30), heading at (32, 50), eight rows at "
                 "(48, 70 + 16*i), and the cursor at (32, 70)."},
        {"state0": 1, "state1": 0, "file": "0x1c0c", "name": "categoryList",
         "does": "Pick one of the 71 VAB categories."},
        {"state0": 1, "state1": 1, "file": "0x1b58", "name": "load",
         "does": "Transfer the chosen archive, waiting on D0x80055c60()."},
        {"state0": 1, "state1": 2, "file": "0x17f8", "name": "soundList",
         "does": "Pick and audition sounds from the loaded category."},
        {"state0": 2, "name": "idle", "does": "Returns immediately."},
        {"state0": 3, "file": "0x2064", "name": "exit",
         "does": "D0x8004b440(0x1500, 0) -- leave for the Stage Select."},
    ],
}

INPUT = {
    "pad_service": "D0x8004b7d0",
    "held_fn": "+0x3F4", "edge_fn_a": "+0x3F8", "edge_fn_b": "+0x3FC",
    "note": "Both list screens read the held mask ORed with the edge mask, so a "
            "held direction repeats every frame.",
    "category_list": [
        {"button": "Up", "bit": 4, "file": "0x1cf8-0x1d40", "does": "previous category"},
        {"button": "Down", "bit": 6, "file": "0x1cbc-0x1cf4", "does": "next category"},
        {"button": "Circle", "bit": 13, "file": "0x1d4c-0x1d88",
         "does": "load the category's archive and open its sound list"},
    ],
    "sound_list": [
        {"button": "Up", "bit": 4, "file": "0x190c-0x1940", "does": "previous sound"},
        {"button": "Down", "bit": 6, "file": "0x18d0-0x1908", "does": "next sound"},
        {"button": "Circle", "bit": 13, "file": "0x19bc-0x1a14",
         "does": "play the selected packed id through D0x80055c48 and keep the "
                 "returned handle at self+0x70; releasing Circle stops it through "
                 "D0x80055c50(packed_id, handle) at file 0x1a44-0x1a68"},
        {"button": "Cross", "bit": 14, "file": "0x1994-0x19b8",
         "does": "back to the category list, via base slot +0x2c"},
        {"button": "Square", "bit": 15, "file": "0x1960-0x1990",
         "does": "call D0x80055c64() -- the sound service's stop-everything entry"},
    ],
}

SOUND_SERVICE = {
    "play": "D0x80055c48",
    "stop": "D0x80055c50",
    "load_archive": "D0x80055c54",
    "load_common": "D0x80055c58",
    "load_busy": "D0x80055c60",
    "panic_stop": "D0x80055c64",
    "note": "D0x80055c48 is the 'play packed sound' pointer already documented in "
            "docs/research/audio/sound-system.md; the five neighbours are read "
            "here from soundtst's own use of them and are consistent with a "
            "single sound-service pointer block at D0x80055c48..D0x80055c64.",
}


def load_words():
    """Every .word in the overlay, keyed by file offset.

    Words whose value equals a known symbol address are rendered symbolically
    (`.word D0x80082cb0`). They must be read, not skipped -- see the terminator
    trap in the module docstring.
    """
    words = {}
    for m in WORD_RE.finditer(SOUNDTST_S.read_text()):
        words[int(m.group(1), 16)] = int(m.group(2) or m.group(3), 16)
    return words


def read_name(words, ram):
    """A NUL-terminated fullwidth Shift-JIS string, folded to ASCII."""
    if not (BASE <= ram < BASE + FILE_SIZE):
        return None
    off = ram - BASE
    out = bytearray()
    while True:
        word = words.get(off & ~3)
        if word is None:
            return None
        byte = word.to_bytes(4, "little")[off & 3]
        if byte == 0:
            break
        out.append(byte)
        off += 1
    text = out.decode("shift_jis", "replace")
    return text.translate(
        {c: c - 0xFEE0 for c in range(0xFF01, 0xFF5F)} | {0x3000: 0x20})


def read_categories(words):
    """Walk the category table and every per-category sound array.

    Terminators are tested on the SECOND word of the record, exactly as the
    overlay's own count loops do -- never on the name pointer, which is the
    overlay base rather than zero at the end of every array.
    """
    categories = []
    index = 0
    while True:
        rec = CATEGORY_TABLE + index * 8
        archive_id = words.get(rec + 4)
        if archive_id is None:
            raise SystemExit(f"category table runs past the overlay at 0x{rec:04x}")
        if archive_id == 0:
            break
        name = read_name(words, words.get(rec, 0))
        array = words.get(ARRAY_PTR_TABLE + index * 4)
        off = array - BASE
        sounds = []
        while True:
            packed = words.get(off + 4)
            if packed is None:
                raise SystemExit(f"sound array runs past the overlay at 0x{off:04x}")
            if packed == 0:
                break
            sounds.append({
                "name": read_name(words, words.get(off, 0)),
                "id": f"0x{packed:08x}",
            })
            off += 8
        categories.append({
            "category": index,
            "archive_id": archive_id,
            "name": name,
            "array_file_offset": f"0x{array - BASE:04x}",
            "count": len(sounds),
            "sounds": sounds,
        })
        index += 1
    return categories


def main():
    words = load_words()
    categories = read_categories(words)

    # The three tables must tile exactly. If they do not, the category count is
    # wrong and every downstream id is suspect, so fail rather than emit.
    n = len(categories)
    assert ARRAY_PTR_TABLE + n * 4 == CATEGORY_TABLE, (
        f"{n} categories leaves a gap between the pointer table and the "
        f"category table")
    assert CATEGORY_TABLE + (n + 1) * 8 == 0x2D90, (
        f"{n} categories does not reach the trailing descriptor")
    arrays = sorted(int(c["array_file_offset"], 16) for c in categories)
    assert arrays[0] == 0x20C4, f"first array at 0x{arrays[0]:04x}, expected 0x20c4"
    end = arrays[-1] + (categories[-1]["count"] + 1) * 8
    assert end == ARRAY_PTR_TABLE, (
        f"sound arrays end at 0x{end:04x}, expected 0x{ARRAY_PTR_TABLE:04x}")

    out = {
        "provenance": {
            "source": "~/ddw3/asm/dw2003/pro/soundtst.s",
            "overlay_base": f"0x{BASE:08x}",
            "array_pointer_table": f"0x{BASE + ARRAY_PTR_TABLE:08x}",
            "category_table": f"0x{BASE + CATEGORY_TABLE:08x}",
            "record": "{char *name, u32 packed_id}, 8 bytes, terminated by packed_id == 0",
            "terminator_trap": (
                "the terminator's name pointer is the overlay base, not 0, and the "
                "disassembler writes it as `.word D0x80082cb0`; a parser that "
                "matches only `.word 0x...` reads it as {0,0} and happens to stop "
                "in the right place, so fixing the regex alone over-runs every array"),
            "note": "Decoded 2026-08-05 from original assembly. All three tables "
                    "tile exactly, which is what fixes the category count at 71.",
        },
        "byteMap": BYTE_MAP,
        "functions": FUNCTIONS,
        "stateMachine": STATE_MACHINE,
        "input": INPUT,
        "soundService": SOUND_SERVICE,
        "categoryCount": n,
        "soundCount": sum(c["count"] for c in categories),
        "categories": categories,
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"wrote {OUT}: {n} categories, {out['soundCount']} sounds "
          f"(arrays 0x{arrays[0]:04x}-0x{end:04x}, all three tables tile exactly)")


if __name__ == "__main__":
    main()
