#!/usr/bin/env python3
"""The battle message banks' decoded English strings, as JSON.

Bank `0x7f` (+ language) is the in-battle message bank: the six command names at
0x01..0x06 and every line the battle message panel (pro/fightstg
FIGHTSTG_F0x80099588, the 22-arm jump table at `.L0x8008318c`) draws from 0x07
onwards. `tools/build_translated_screen_data.py::extract_battlecmd_data` copies
the seven disc images to `web/assets/data/battlecmd/<0x7f + language>.bin` in
the game's own token encoding (basic glyph codes: 4+digit, 14+capital,
40+lower case, `01 NN` extended pairs). The English one is `129.bin`
(language 2, the boot default).

Bank `0x6a` (+ language) is the item-name bank: **string index == ItemId**. Kind
14 of the message panel — the page the item action puts up *before* its effect
runs — reads it for the second line's slot 1 (`fightstg.s:23838` `addiu $a0,
0x6a`, then `fightstg.s:23841` `lw $a2, 0x4($s2)` and `:23842` `:23845`
`+0x120(line2, handle, payload[1], 1)`), and so does the in-battle ITEM list's
row names (`FIGHTSTG_F0x800957b4`, `fightstg.s:19334` the row's ItemId halfword,
`:19342` the bank, `:19348` the index).

    .venv/bin/python3 tools/extract_battle_text.py

`extract_battlecmd_data` does not copy the 0x6a group's disc image into
`web/assets/data/battlecmd/`, but `tools/build_translated_screen_data.py` already
ships it as `web/assets/data/shop-banks/108.bin` (that file's `PAUSE_SHARED_BANKS` /
`REPORT_SHARED_BANKS` tables call bank `0x6A` "item-names"), so the entry-count check
below reads that image too. `verify_bank_layout()` proves the bank's identity three
ways that no guess could pass:

  * **Name.** `~/ddw3/rust/dw2003_exe_data/src/lba.rs` names the disc file index
    of every lang bank, and a bank id IS a file index (`tools/build_native_screens.py`
    reads bank id `n` out of the exe's own directory at `0x80044F6C` / `0x800474A4`).
    `LBA_ESITMNAM_BIN_IDX: usize = 108` and `0x6a + 2 = 108`, so bank 0x6a in
    English is the disc's ESITMNAM.BIN. The same check runs over the four banks
    whose English images the walker does ship, so the naming convention is
    pinned by four known-good cases rather than assumed.
  * **Size.** For each name bank the strings' size in the game's own token
    encoding must land on the sector count the exe's directory records. It
    reproduces all four (0x4e esdignam 2, 0x6a esitmnam 4, 0x7f esmfight 2,
    0xa2 essklnam 3) and misses both DESCRIPTION banks (0x9b essklinf measures
    3 against the directory's 4; 0x63 esitminf 6 against 8), because a
    description line spends more of its width on extended glyphs than one byte
    each. So the size check is applied to name banks only.
  * **Entry count.** Each bank's decoded entry count must equal the u32 its own disc
    image carries at offset 0, whichever of the two shipped copies holds it.

Both banks are written from the research repo's decoded copy of the same
language file, `~/ddw3/lang_file/dw2003/eng/<name>.toml`. Entries are decoded the
way `tools/build_item_names.py` already decodes them for `engine/dw3/item-names.ts`
— read as written, no `unicode_escape` round trip — because these files hold
raw UTF-8 (the eight Japanese badge/item names at ids 26..33 and 400). An earlier
revision of this extractor did run `unicode_escape`, which turned those into
mojibake; `web/assets/ui/uifont.json` has no glyph for `¼` or `»`, so the five
esmfight words that hold a `ー` or a `・` (indices 0x0f, 0x17, 0x18, 0x1a, 0x24)
drew as blank gaps.
"""
from pathlib import Path

import os
import json
import pathlib
import re
import struct
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DDW3 = pathlib.Path(os.environ.get("DDW3_DIR") or pathlib.Path.home() / "ddw3")
LANG = DDW3 / "lang_file/dw2003/eng"
# language 2 (English) is the boot default: web/game.js `state.languageByte ?? 2`.
LANGUAGE = 2
ENTRY = re.compile(r'^\s*"(.*)",?\s*$')

# The resident exe's bank directory, as `tools/build_native_screens.py` reads it.
RESIDENT = ROOT / "web/assets/native/screens/resident.bin"
RESIDENT_BASE = 0x80010000
LBA_OFFSETS = 0x80044F6C      # u32 start sector per bank id
LBA_LEN_SECTORS = 0x800474A4  # u16 sector count per bank id
SECTOR = 2048

# The disc's own file-index names for the lang banks, as the research repo records
# them. A bank id is a file index, so `LBA_<NAME>_BIN_IDX` must be `base + LANGUAGE`.
LBA_RS = DDW3 / "rust/dw2003_exe_data/src/lba.rs"

# (bank base, disc file stem, language file, is it a NAME bank)
# `is_name` only says whether the token-size estimate below is calibrated for it.
NAMED = (
    (0x4E, "ESDIGNAM", "esdignam.toml", True),
    (0x63, "ESITMINF", "esitminf.toml", False),
    (0x6A, "ESITMNAM", "esitmnam.toml", True),
    (0x7F, "ESMFIGHT", "esmfight.toml", True),
    (0x9B, "ESSKLINF", "essklinf.toml", False),
    (0xA2, "ESSKLNAM", "essklnam.toml", True),
)

# (bank base, language file, output json, who reads it)
BANKS = (
    (0x7F, "esmfight.toml", "esmfight.json",
     "FIGHTSTG_F0x80099588 (pro/fightstg), addiu $a0, 0x7f"),
    (0x6A, "esitmnam.toml", "esitmnam.json",
     "FIGHTSTG_F0x80099588 kind 14 (pro/fightstg .L0x80099ca0, fightstg.s:23838 "
     "addiu $a0, 0x6a) and the in-battle ITEM list's row names "
     "(FIGHTSTG_F0x800957b4, fightstg.s:19342)"),
)


def load_strings(path: pathlib.Path) -> list[str]:
    """The bank's entries, read the way a TOML basic string decodes.

    `json.loads` is that reader for these files: `\\"` and `\\uXXXX` become their
    characters, raw UTF-8 is left alone, and an escape neither language allows
    raises instead of shipping. `tools/build_item_names.py` gets the same result
    because it writes each entry back out with `json.dumps`."""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        m = ENTRY.match(line)
        if m:
            out.append(json.loads('"' + m.group(1) + '"'))
    return out


def bank_count(path: pathlib.Path) -> int:
    data = path.read_bytes()
    count = struct.unpack_from("<I", data)[0]
    if struct.unpack_from("<I", data, 4)[0] != 4 + count * 4:
        raise ValueError(f"{path.name} is not an indexed text table")
    return count


def bank_extent(bank_id: int) -> tuple[int, int]:
    """(start sector, sector count) for one bank id, out of the exe's directory."""
    data = RESIDENT.read_bytes()
    lba = struct.unpack_from("<I", data, LBA_OFFSETS + bank_id * 4 - RESIDENT_BASE)[0]
    sectors = struct.unpack_from("<H", data, LBA_LEN_SECTORS + bank_id * 2 - RESIDENT_BASE)[0]
    return lba, sectors


def encoded_bytes(strings: list[str]) -> int:
    """The bank's own size in the game's token encoding: 4 + count*4 index bytes,
    then every string as its glyph codes (one byte per basic code, two per `01 NN`
    pair) plus its terminator. Over-counts a little where a string uses an extended
    glyph the ASCII estimate calls one byte, which is why the check below is
    `ceil(predicted) == sectors` on the banks it has been calibrated against."""
    return 4 + len(strings) * 4 + sum(
        sum(2 if ord(c) > 255 else 1 for c in s) + 1 for s in strings)


def verify_bank_layout() -> list[str]:
    """The checks that stand in for the disc image bank 0x6a's group is missing."""
    if not LBA_RS.exists():
        raise ValueError(f"{LBA_RS} is missing: it is what names the disc's lang banks")
    lba_rs = LBA_RS.read_text(encoding="utf-8")
    notes = []
    for base, stem, name, is_name in NAMED:
        bank_id = base + LANGUAGE
        # (a) NAME. A bank id is the disc's file index, so the research repo's own
        # index table has to carry this name at this id. Four of the six are banks
        # whose English image the walker ships, so the convention is pinned rather
        # than trusted.
        named = re.search(rf"LBA_{stem}_BIN_IDX\s*:\s*usize\s*=\s*(\d+)", lba_rs)
        if not named:
            raise ValueError(f"{LBA_RS.name} has no LBA_{stem}_BIN_IDX constant")
        if int(named.group(1)) != bank_id:
            raise ValueError(f"LBA_{stem}_BIN_IDX is {named.group(1)}, "
                             f"but bank 0x{base:x} + lang {LANGUAGE} is {bank_id}")
        note = f"bank 0x{base:x} + lang {LANGUAGE} = id {bank_id} = {stem}.BIN"

        strings = load_strings(LANG / name)
        # (b) SIZE. The exe's directory says how many sectors the bank occupies.
        lba, sectors = bank_extent(bank_id)
        if not sectors:
            raise ValueError(f"bank 0x{base:x} + lang {LANGUAGE} has no disc extent")
        # (c) ENTRY COUNT, against every disc image the walker ships for this bank id.
        # The battle-command extractor writes `battlecmd/<id>.bin`; the translated
        # screen extractor writes `shop-banks/<id>.bin`, `wizard/<id>.bin` or
        # `pause/<id>.bin` (its own PAUSE_SHARED_BANKS / REPORT_SHARED_BANKS tables),
        # and bank 0x6a is one of those: 108.bin is the item-name bank on the disc.
        images = [ROOT / f"web/assets/data/{d}/{bank_id}.bin"
                  for d in ("battlecmd", "shop-banks", "wizard", "pause")]
        shipped = [p for p in images if p.exists()]
        if not shipped:
            raise ValueError(f"bank 0x{base:x} + lang {LANGUAGE} ({bank_id}) has no "
                             f"shipped disc image to check its entry count against")
        for binary in shipped:
            count = bank_count(binary)
            if len(strings) != count:
                raise ValueError(f"{name} has {len(strings)} strings, "
                                 f"{binary.name} has {count}")
        note += (f", {len(strings)} entries (the shipped "
                 f"{', '.join(str(p.relative_to(ROOT / 'web/assets/data')) for p in shipped)}"
                 f" agree)")
        if is_name:
            predicted = -(-encoded_bytes(strings) // SECTOR)   # ceil
            if predicted != sectors:
                raise ValueError(f"bank 0x{base:x} names measure {predicted} sectors, "
                                 f"the exe directory says {sectors} for sector {lba}")
            note += f", {predicted} sectors (the token estimate matches)"
        notes.append(note)

    # Bank 0x6a is the item-name bank: index 0 is the unused item id, and the count
    # reaches past the whole consumable band the in-battle ITEM list can hand it.
    items = load_strings(LANG / "esitmnam.toml")
    if items[0] != "":
        raise ValueError("bank 0x6a index 0 is the unused item id and must be empty")
    missing = [i for i in range(43, 91) if not items[i]]
    if missing:
        raise ValueError(f"bank 0x6a has no name for item {missing}")
    notes.append(f"bank 0x6a carries the consumable band: ids 43..90 all named")
    return notes


def main() -> int:
    try:
        for note in verify_bank_layout():
            print(note)
    except (ValueError, OSError) as error:
        print(f"bank layout check failed: {error}", file=sys.stderr)
        return 1
    out_dir = ROOT / "web/assets/data/battlecmd"
    for base, name, out_name, read_by in BANKS:
        strings = load_strings(LANG / name)
        payload = {
            "schema": 1,
            "bank": base,
            "language": LANGUAGE,
            "count": len(strings),
            "strings": strings,
            "source": {
                "languageFile": f"~/ddw3/lang_file/dw2003/eng/{name}",
                "discBank": f"web/assets/data/battlecmd/{base + LANGUAGE}.bin",
                "discFile": f"LBA_{'ESITMNAM' if base == 0x6A else 'ESMFIGHT'}_BIN_IDX",
                "readBy": read_by,
            },
        }
        out = out_dir / out_name
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n")
        print(f"{out.relative_to(ROOT)}: {len(strings)} strings from bank 0x{base:x}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
