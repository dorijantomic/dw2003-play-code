#!/usr/bin/env python3
"""Extract the 170 card-duel opponent records from CARD_NPC.BIN.

Source of truth for the layout is `F0x8009D6E0` in `~/ddw3/asm/dw2003/pro/cardgame.s`
(load base 0x80082CB0, function at file offset 0x1AA30), which is the only reader of
the resource.  It loads disc resource 0x7A4 (= LBA index 1956 = dw2003/AAA/DAT/CARD/
CARD_NPC.BIN), indexes it with `(opponentId - 1) * 0xD0`, and unpacks one record into
the CardDuel object.  Every field below is named after what that function does with it.

Record, 0xD0 bytes, opponent ids 1..170 (35360 = 208 * 170 exactly):

    +0x00..+0x9F  40 deck entries of 4 bytes each:
                    u16 packed   -- (packed & 0x0FFF) is the 1-based card id;
                                    bit 15 is a per-entry flag the loader isolates
                                    with `srl 15; andi 1` into duel+0x35D+4i.
                    u8  setGroup  -- 1..7, non-decreasing across the deck.  Copied
                                    with the entry index into the 40 (index, group)
                                    pairs at duel+0x30A/+0x30B.  This gates how much
                                    of the deck the opponent may use in each set of
                                    the best-of-three; see SET_GROUP below.
                    u8  aiClass   -- 1..7, the opponent's play class.  Stored to
                                    duel+0x35C+4i and switched through the 7-entry
                                    jump table at 0x800837A0 into a sort weight at
                                    duel+0x35E+4i.  See AI_CLASS below.

`setGroup` -- `F0x8009D9E4(duel)` runs at duel start (after `sb $zr, 0x300`) and again
after every `duel+0x300 += 1`, i.e. once per set.  It walks the group-ordered pile and
writes:
    duel+0x41B = number of entries whose setGroup <= 2 * duel[0x300] + 2
    duel+0x41C = index of the first entry whose setGroup == 7
`F0x80090350`'s selector likewise admits an entry only when its setGroup equals
`2 * duel[0x300] + 2` exactly.  With duel+0x300 counting sets 0, 1, 2 the threshold is
2, 4 then 6, so groups 1-2 are live in set 1, groups 3-4 join in set 2, groups 5-6 in
set 3, and group 7 is a reserve reached through duel+0x41C rather than the window.
The shipped decks are built to this shape: about 6, 2, 6, 2, 6, 2 entries in groups
1..6 and about 16 in group 7, so the opponent plays out of 8 cards in the first set,
16 in the second and 24 in the third.

`aiClass` -- `F0x8008C5F0`, the greedy summon pass, reads
`duel+0x35C + 4 * (slot - 0x28)` for each affordable hand card and skips the card when
the byte equals 5.  Class 5 is therefore "hold, never summon".  The class is authored
per deck slot, not per card: the same card id carries different classes in different
opponents' decks.
    +0xA0..        u16[] AI response list, 1-based, zero-terminated, at most 27 read.
                  The loader stores each entry minus one to duel+0x400+i and then
                  appends a fixed default suffix (see DEFAULT_RESPONSE_SUFFIX).
    +0xC8  u8     the opponent tamer's LEVEL -> duel+0x2E9 -> view->unk5E.
                  Corrected 2026-08-14: this was recorded as a portrait/model
                  id, which nothing supports.  The loader's `sb $v0,0x2e9` is
                  read back at exactly one place, F0x800A2F00, which copies it
                  to the duel view; the view's plate branch for message id 0x3E
                  draws escardgm string 0x3E -- literally "LV" -- and then puts
                  this byte in the number field beside it (F0x80097ACC).  The
                  values are a difficulty ladder, not indices: the ten opening
                  tamers run 4,5,6,...,13 and the Asuka masters run 22,24,26,
                  28,29 up to the Asuka Duel King at 30.
    ALSO: the plate's second line is the opponent's FOLDER NAME, taken from the
                  language bank escrddek (group 0x2b) at index (id + 1) / 2.
                  The 170 records are 85 pairs -- two 40-card decks per tamer,
                  and both records of a pair carry the same level, the same
                  booster group and the same folder name.  That name table is
                  the one the 2026-07-12 pass mistook for the folder editor's
                  own content; see docs/research/ui/card-folder-editor-2026-08-14.md.
    +0xCC  s32    BOOSTER GROUP index into the halfword table at 0x800A5C2C,
                  whose value lands in duel+0x2EC and identifies which booster
                  set a win rewards (stock at save + setId + 0x7C).

The loader also derives, per deck entry i:
    duel+0x248 + 2i = (packed & 0x0FFF) - 1     the opponent's 40-card deck pile
    duel+0x35E + 4i = TIER_SORT_WEIGHT[tier] + i  composite sort key (ties by index)

Usage:
    python3 tools/extract_card_opponents.py [--out web/assets/data/card_opponents.json]
"""
from __future__ import annotations
import os

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
CARD_NPC = DDW3 / "dw2003/AAA/DAT/CARD/CARD_NPC.BIN"

RECORD_SIZE = 0xD0
RECORD_COUNT = 170
DECK_SIZE = 40
MAX_RESPONSES = 27

# `~/ddw3/rust/dw2003_exe_data/src/lba.rs` L1959: LBA_CARD_NPC_BIN_IDX.
RESOURCE_ID = 0x7A4

# The blob behind the git-lfs pointer checked into ~/ddw3.  Guards against silently
# extracting a pointer file or a different revision of the disc.
EXPECTED_SHA256 = "5b4dad5cff64080435f7992f99ef9266a8e80d1936444ee71ad1288316c92468"

# Jump table at 0x800837A0, cases indexed by `aiClass - 1`; each case is
# `addiu $v0, $a1, IMM` in the delay slot of a jump to the common `sh $v0, 0x35e($a2)`.
# $a1 is the deck-entry index, so the stored key is IMM + index: the class is the
# primary sort weight and the deck position breaks ties.
AI_CLASS_SORT_WEIGHT = {1: 400, 2: 300, 3: 500, 4: 200, 5: 600, 6: 100, 7: 700}

# F0x8008C5F0 skips a hand card outright when its class byte equals this.
AI_CLASS_NEVER_SUMMON = 5

# Written verbatim at duel+0x400+n when the record's response list terminates, where
# n is the number of entries consumed.  0xFF is the list terminator.
DEFAULT_RESPONSE_SUFFIX = [7, 8, 0x18, 0x1F, 0x20, 0, 6, 0x0C, 0x12, 0x1B, 0x1E,
                           0x21, 0x25, 0x26]
RESPONSE_TERMINATOR = 0xFF

# Halfword table at 0x800A5C2C (cardgame.s file offset 0x22F7C), 36 entries
# indexed 0..35: {91, 91, 361, 362, ... 394}.
# It maps an opponent's +0xCC group index to a BOOSTER SET ID. Confirmed at
# cardgame.s 0x8009d744-0x8009d75c:
#     lw $v0, 0xcc($t0) / addiu $v1, 0x5c2c / sll $v0, 0x1 / lh $v0, ($v0)
#     sw $v0, 0x2ec($s0)
# and duel+0x2EC is what the duel-win bonus offsets by to reach the per-set pack
# stock at save + setId + 0x7C. The same id keys the pool table at 0x8008C708
# (see tools/extract_card_boosters.py).
#
# NOTE 2026-08-07: this was previously called NAME_TABLE and its resolved value
# "nameStringId". That was a mislabel -- the values are set ids, not name string
# ids. The numbers were always right; only the name was wrong.
PACK_SET_TABLE = [0x005B, 0x005B] + [0x0167 + n for n in range(2, 36)]

# The opponent folder-name bank, LBA group 0x2b (escrddek). Read verbatim from
# the shipped language file rather than transcribed: the 2026-07-12 hand-typed
# copy of this table had 87 entries with a duplicate, and the file has 85.
FOLDER_NAME_BANK = DDW3 / "lang_file/dw2003/eng/escrddek.toml"


def _folder_names(path: Path = FOLDER_NAME_BANK) -> list[str]:
    """The bank's strings, index 0 first (it is empty, as every bank's is)."""
    import re

    if not path.exists():
        return []
    return re.findall(r'^\t"(.*)",?$', path.read_text(encoding="utf-8"), re.M)


FOLDER_NAMES = _folder_names()


def _class_sort_key(ai_class: int, index: int):
    """Reproduce duel+0x35E+4i.

    The jump table is entered only when `(aiClass - 1) < 7` unsigned, so a class of 0
    (or above 7) skips the store and leaves the halfword at whatever it held.
    """
    weight = AI_CLASS_SORT_WEIGHT.get(ai_class)
    return None if weight is None else weight + index


def _availability_set(set_group: int):
    """Lowest set index (0-based) at which `2 * set + 2 >= setGroup` admits the entry.

    Group 7 never satisfies the window; it is reached through duel+0x41C instead.
    """
    if set_group == 7 or set_group < 1:
        return None
    return max(0, -(-(set_group - 2) // 2))


def parse_record(raw: bytes, opponent_id: int) -> dict:
    if len(raw) != RECORD_SIZE:
        raise ValueError(f"opponent {opponent_id}: expected {RECORD_SIZE} bytes, got {len(raw)}")

    deck = []
    for i in range(DECK_SIZE):
        packed, set_group, ai_class = struct.unpack_from("<HBB", raw, i * 4)
        deck.append({
            "index": i,
            "cardId": packed & 0x0FFF,
            "flagBit15": (packed >> 15) & 1,
            "setGroup": set_group,
            "availableFromSet": _availability_set(set_group),
            "aiClass": ai_class,
            "neverSummon": ai_class == AI_CLASS_NEVER_SUMMON,
            "aiClassSortKey": _class_sort_key(ai_class, i),
        })

    responses = []
    for i in range(MAX_RESPONSES):
        entry = struct.unpack_from("<H", raw, 0xA0 + 2 * i)[0]
        if entry == 0:
            break
        responses.append(entry)

    pack_group = struct.unpack_from("<i", raw, 0xCC)[0]
    pack_set_id = (
        PACK_SET_TABLE[pack_group] if 0 <= pack_group < len(PACK_SET_TABLE) else None
    )

    return {
        "id": opponent_id,
        "deck": deck,
        # Stored zero-based at duel+0x400; the loader always appends the default suffix.
        "aiResponses": [entry - 1 for entry in responses],
        "aiResponsesResolved": [entry - 1 for entry in responses] + DEFAULT_RESPONSE_SUFFIX,
        "level": raw[0xC8],
        "folderNameIndex": (opponent_id + 1) // 2,
        "folderName": FOLDER_NAMES[(opponent_id + 1) // 2]
        if (opponent_id + 1) // 2 < len(FOLDER_NAMES)
        else None,
        "packGroup": pack_group,
        "packSetId": pack_set_id,
    }


def build(path: Path = CARD_NPC) -> dict:
    if not path.exists():
        raise SystemExit(f"missing {path}")
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != EXPECTED_SHA256:
        raise SystemExit(
            f"{path} sha256 {digest} != expected {EXPECTED_SHA256}\n"
            "The checkout may still hold the git-lfs pointer; run\n"
            "  git -C ~/ddw3 lfs pull --include 'dw2003/AAA/DAT/CARD/*'"
        )
    if len(data) != RECORD_SIZE * RECORD_COUNT:
        raise SystemExit(f"{path}: expected {RECORD_SIZE * RECORD_COUNT} bytes, got {len(data)}")

    opponents = [parse_record(data[(i - 1) * RECORD_SIZE: i * RECORD_SIZE], i)
                 for i in range(1, RECORD_COUNT + 1)]

    return {
        "source": "dw2003/AAA/DAT/CARD/CARD_NPC.BIN",
        "sourceSha256": digest,
        "resourceId": RESOURCE_ID,
        "reader": "F0x8009D6E0 (pro/cardgame, file offset 0x1AA30)",
        "recordSize": RECORD_SIZE,
        "count": RECORD_COUNT,
        "aiClassSortWeight": {str(k): v for k, v in AI_CLASS_SORT_WEIGHT.items()},
        "aiClassNeverSummon": AI_CLASS_NEVER_SUMMON,
        "setWindowThreshold": "setGroup <= 2 * setIndex + 2 (setIndex = duel+0x300, 0..2)",
        "defaultResponseSuffix": DEFAULT_RESPONSE_SUFFIX,
        "responseTerminator": RESPONSE_TERMINATOR,
        "packSetTable": PACK_SET_TABLE,
        "opponents": opponents,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--input", type=Path, default=CARD_NPC)
    ap.add_argument("--out", type=Path, default=REPO / "web/assets/data/card_opponents.json")
    args = ap.parse_args(argv)

    payload = build(args.input)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=1) + "\n")
    print(f"wrote {args.out} ({payload['count']} opponents)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
