#!/usr/bin/env python3
"""Extract the battle item-use effect table (fightstg @0x800a336c) into web assets.

The item machine FIGHTSTG_F0x8008d3b4 (pro/fightstg.s:10676) runs the item-use
action. For a used item OUTSIDE the 77..90 throw band it takes the default arm
(.L0x8008d8e0, line 11008), which plays clip 10 and scans a table of 6-byte
records at RAM 0x800a336c (.L0x8008d8fc-.L0x8008d934; apply arm .L0x8008d8c0):

    record = {item:u16, effect:u16, sound:u16}   (little-endian halfwords)
    terminated by item == 0xffff (-1)
    the FIRST record whose item equals ctx+0x70 (the used item's id) wins:
      actor+0x6c = record.effect   (op3's 9999 sentinel reads this field)
      actor+0x70 = record.sound    (op10's 98/99 strike reads this field, and
                                    F0x8009b774 plays op10 sound table[value])

fightstg's RAM base is 0x80082cb0, so the table sits at file offset 0x206bc of
pro_fightstg.bin. Re-derived 2026-10-14 from both the assembly words and the raw
overlay bytes — byte-identical:

    2b0021001f00 2c0021001f00 2d0021001f00 2e0021001f00 420022001f00 430022001f00
    440022001f00 450022001f00 460023001f00 470021001f00 480028001f00 490024001f00
    4a0026001f00 4b002e001e00 4c002e001e00 ffff

i.e. items 43-46 -> effect 33 sound 31; 66-69 -> 34/31; 70 -> 35/31; 71 -> 33/31;
72 -> 40/31; 73 -> 36/31; 74 -> 38/31; 75 -> 46/30; 76 -> 46/30.

The walker consumes this as web/assets/data/item_use_effects.json: battle3d sets
it on fight-tables (setItemUseEffects) and the item path passes record.effect as
the actor's current effect (ActorAnimator.setAnimByItem) and record.sound as the
contact-sound type, so clip 10's op3 9999 spawn fires and its op10 99 strike
plays the item's own sound.

Usage: tools/extract_item_use_effects.py [--check]
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/assets/data/item_use_effects.json"
FIGHTSTG = DDW3 / "asm/dw2003/pro/fightstg.s"

TABLE_BASE = 0x800A336C
STRIDE = 6
TERMINATOR = 0xFFFF

WORD_RE = re.compile(r"^\.L0x(800[0-9a-f]{5}):\s+\.word\s+(0x[0-9a-fA-F]+|\S+)")


def load_words() -> dict[int, int]:
    """RAM address -> word, from the disassembly's own `.word` labels."""
    words: dict[int, int] = {}
    for line in FIGHTSTG.read_text().splitlines():
        m = WORD_RE.match(line)
        if m:
            try:
                words[int(m.group(1), 16)] = int(m.group(2), 16)
            except ValueError:
                pass  # a symbolic operand; the table region carries only hex
    return words


def u16(words: dict[int, int], addr: int) -> int:
    w = words.get(addr & ~3)
    if w is None:
        raise SystemExit(f"extract_item_use_effects: no .word at RAM {addr:#x}")
    return (w & 0xFFFF) if (addr & 2) == 0 else (w >> 16)


def build() -> dict:
    words = load_words()
    records = []
    addr = TABLE_BASE
    while True:
        item = u16(words, addr)
        if item == TERMINATOR:
            break
        records.append({"item": item, "effect": u16(words, addr + 2), "sound": u16(words, addr + 4)})
        addr += STRIDE
        if addr > TABLE_BASE + 0x1000:
            raise SystemExit("extract_item_use_effects: table never terminated")

    # Structural invariants (the census itself is asserted by the test suite).
    items = [r["item"] for r in records]
    assert records, "empty table"
    assert items == sorted(items) and len(set(items)) == len(items), f"item ids not strictly ascending: {items}"
    assert all(1 <= r["item"] < 0xFFFF for r in records)
    assert all(1 <= r["effect"] < 100 for r in records), "effect out of the op3 type space"
    assert all(1 <= r["sound"] < 100 for r in records), "sound out of the op10 table space"
    assert addr == TABLE_BASE + STRIDE * len(records), "terminator not on a record boundary"

    return {
        "source": "asm/dw2003/pro/fightstg.s .L0x800a336c (fightstg, RAM base 0x80082cb0)",
        "table_base": "0x800a336c",
        "stride": STRIDE,
        "terminator": -1,
        "records": records,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="fail if the output is stale")
    args = ap.parse_args()

    data = build()
    text = json.dumps(data, indent=1) + "\n"

    if args.check:
        try:
            if json.loads(OUT.read_text()) != data:
                print("extract_item_use_effects: item_use_effects.json is stale", file=sys.stderr)
                return 1
        except OSError:
            print("extract_item_use_effects: item_use_effects.json missing", file=sys.stderr)
            return 1
        print("extract_item_use_effects: up to date")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"item use effects: wrote {OUT.name} ({len(data['records'])} records)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
