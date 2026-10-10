#!/usr/bin/env python3
"""
Build the game's language table by joining two overlays that decode each other.

The game holds one global language index at D0x8005cca8. Two developer
overlays touch it, and neither is sufficient alone:

  stagslct  NAMES the languages. A seven-entry char* table at file 0x3220
            (RAM 0x80085ed0) is indexed by D0x8005cca8 to draw the current
            language, giving index -> name.

  cnty_sel  SELECTS a language. A seven-BYTE table at file 0x1774
            (RAM 0x80084424) is indexed by the cursor row and its byte is
            written straight to D0x8005cca8 (cnty_sel.s L1181-1187,
            `lbu $v1, ($v1)` then `sw $v1, -0x3358($v0)`), giving
            cursor row -> index.

Composing them yields cursor row -> language name, which is what
docs/research/ui/cnty_sel-decoded-2026-07-11.md recorded as an open gap
needing "a runtime capture or the esdmg loader's sector->prefix table".
Neither is needed: a second overlay's own data answers it.

The result is corroborated by the filesystem: ~/ddw3/pack/dw2003/country/
holds exactly seven per-language subtrees -- eng, fra, ger, ita, jpn, spn,
usa -- matching the seven names one-for-one.

TWO TOOLING TRAPS, both of which produced wrong published readings:

1. `.word D0x...` symbolic words. stagslct's seventh language pointer is
   written symbolically because it equals the overlay base; a regex matching
   only `.word 0x...` drops it.
2. `.byte` directives. cnty_sel's cursor table is a WORD followed by three
   trailing `.byte` lines. tools/overlay_scan.py's WORD_RE matches only
   `.word`, so `overlay_scan.py words` silently reports those three bytes as
   ZERO -- which is exactly how the 2026-07-11 doc concluded that "only 4 of
   the 7 cursor rows are wired" and that cursors 4-6 select 0. All seven are
   wired. Every `.byte` run in the whole asm corpus (9 files) sits at end of
   file with a stride-4 label, which is a splat formatting artifact: the
   bytes are consecutive.

Output: data/language_table.json
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
DDW3 = Path.home() / "ddw3"
STAGSLCT_S = DDW3 / "asm/dw2003/pro/stagslct.s"
CNTY_SEL_S = DDW3 / "asm/dw2003/pro/cnty_sel.s"
COUNTRY_DIR = DDW3 / "pack/dw2003/country"
OUT = ROOT / "data/language_table.json"

BASE = 0x80082CB0
LANG_NAME_TABLE = 0x3220   # stagslct file offset, read at stagslct file 0x297c
CURSOR_TABLE = 0x1774      # cnty_sel file offset, read at cnty_sel file 0x125c
LANGUAGE_GLOBAL = "D0x8005cca8"
N = 7

WORD_RE = re.compile(r"\.L0x([0-9a-f]{8}): \.word (?:0x([0-9a-f]+)|D0x([0-9a-f]+))")
BYTE_RE = re.compile(r"\.L0x([0-9a-f]{8}): \.byte 0x([0-9a-f]+)")


def load_words(path):
    """Every `.word`, including the symbolic `D0x`/`F0x` spellings."""
    return {int(m.group(1), 16): int(m.group(2) or m.group(3), 16)
            for m in WORD_RE.finditer(path.read_text())}


def load_trailing_bytes(path):
    """Trailing `.byte` directives, re-keyed to consecutive file offsets.

    Splat writes each trailing sub-word byte on its own line and advances the
    label by 4 rather than by 1. The bytes are consecutive in the file, so the
    label sequence is renumbered here from the first one. This is the step
    tools/overlay_scan.py skips entirely.
    """
    entries = [(int(m.group(1), 16), int(m.group(2), 16))
               for m in BYTE_RE.finditer(path.read_text())]
    if not entries:
        return {}
    start = min(off for off, _ in entries)
    return {start + i: value
            for i, (_, value) in enumerate(sorted(entries))}


def read_cstring(words, ram):
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
    return text.translate({c: c - 0xFEE0 for c in range(0xFF01, 0xFF5F)})


def main():
    stagslct = load_words(STAGSLCT_S)
    names = []
    for i in range(N):
        ptr = stagslct[LANG_NAME_TABLE + i * 4]
        names.append(read_cstring(stagslct, ptr))
    assert all(names), f"unreadable language name in {names}"
    assert len(set(names)) == N, f"duplicate language name in {names}"

    cnty = load_words(CNTY_SEL_S)
    tail = load_trailing_bytes(CNTY_SEL_S)
    cursor_to_index = []
    for i in range(N):
        off = CURSOR_TABLE + i
        if off in tail:
            cursor_to_index.append(tail[off])
        else:
            cursor_to_index.append(
                cnty[off & ~3].to_bytes(4, "little")[off & 3])

    # The seven cursor rows must select the seven language indices exactly once
    # each. If they did not, either the trailing-byte handling or the table
    # length would be wrong, so fail rather than emit a broken mapping.
    assert sorted(cursor_to_index) == list(range(N)), (
        f"cursor table {cursor_to_index} is not a permutation of 0..{N - 1}; "
        f"trailing `.byte` handling is probably wrong")

    folders = sorted(p.name for p in COUNTRY_DIR.iterdir()
                     if p.is_dir() and len(p.name) == 3) if COUNTRY_DIR.is_dir() else []

    entries = []
    for cursor, index in enumerate(cursor_to_index):
        name = names[index]
        folder = name.lower()
        entries.append({
            "cursor_row": cursor,
            "language_index": index,
            "name": name,
            "country_pack": folder if folder in folders else None,
            "selectable_by": "Up/Down in the main list" if cursor <= 4
                             else "Right (side position)" if cursor == 5
                             else "Left (side position)",
        })

    out = {
        "provenance": {
            "language_global": LANGUAGE_GLOBAL,
            "names_from": f"~/ddw3/asm/dw2003/pro/stagslct.s file 0x{LANG_NAME_TABLE:04x}"
                          f" (RAM 0x{BASE + LANG_NAME_TABLE:08x})",
            "cursor_from": f"~/ddw3/asm/dw2003/pro/cnty_sel.s file 0x{CURSOR_TABLE:04x}"
                           f" (RAM 0x{BASE + CURSOR_TABLE:08x})",
            "write_site": "cnty_sel.s L1181-1187: lbu the byte, sw it to 0x8005cca8",
            "corroboration": "~/ddw3/pack/dw2003/country/ holds exactly these seven "
                             "per-language subtrees",
            "note": "Decoded 2026-08-05. Closes the language-mapping gap left open in "
                    "docs/research/ui/cnty_sel-decoded-2026-07-11.md without a runtime "
                    "capture: a second overlay's own name table supplies it.",
        },
        "byIndex": {str(i): names[i] for i in range(N)},
        "entries": entries,
        "countryPacks": folders,
    }
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    order = " ".join(e["name"] for e in entries)
    print(f"wrote {OUT}: {N} languages; cursor order {order}")


if __name__ == "__main__":
    main()
