#!/usr/bin/env python3
"""
Player charId-1 cast marker extractor — on which stages the player is built as
charId 1 (P001PLAY) instead of charId 2 (Junior, P002PLAY).

DECODE.  Cast rebuild F0x8008aa10 (fieldstg.s 8368-8379, `.L0x000081f0` to
`.L0x000082d0`) walks the stage's cast list (scene descriptor +0x4C) and, for a
record whose halfword +8 is 1, 0x6a, 0x146 or 0x147 and whose predicate passes
(word0 null, or the method at 0x80048abc+8 returns 1), builds the player
(constructor F0x8009116c, index 0) with that id; with no match it uses 2.
Story scripts name actors by charId (resolver 0x80084d8c), so on these stages
the scripts move the player as actor 1, elsewhere as actor 2.

The predicate (word0) is the NPC spawn-gate list read by F0x80016924 through
the pointer at 0x80048ac4: `{u16 flag_id, u16 expected}` pairs, 0xffff-ended,
true iff every get_flag(id) == expected.  Most lists test the bank-0x60
progress ordinal (s200: ordinal == 3).  A null word0 is unconditional (s415,
s790).  Records are tried in cast-list order and the first that passes wins.
The 20 stages are exactly the stages whose scripts use actor 1 (checked
2026-10-01 against web/assets/events/wstag_events.json).

Output: web/assets/data/player_cast_one.json
    { "s200": [[{"id": 24579, "expected": 1}]], "s415": [[]], ... }
    stage -> one condition list per charId-1 record, in cast-list order.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_dive_form_markers import ASM, BASE, DESCRIPTORS, ROOT, read_words  # noqa: E402

OUT = ROOT / "web" / "assets" / "data" / "player_cast_one.json"


def flag_list(words: dict[int, int], ptr: int) -> list[dict[str, int]]:
    """The 0xffff-ended {u16 id, u16 expected} list at RAM `ptr` (one pair per word)."""
    out = []
    for i in range(64):
        word = words.get(ptr - BASE + 4 * i)
        if word is None or word & 0xFFFF == 0xFFFF:
            return out
        out.append({"id": word & 0xFFFF, "expected": word >> 16})
    raise ValueError(f"unterminated flag list at {ptr:#x}")


def char_one_records(words: dict[int, int], cast_list_ram: int) -> list[list[dict[str, int]]]:
    array = cast_list_ram - BASE
    records = []
    for i in range(64):
        record_ptr = words.get(array + 4 * i, 0)
        if record_ptr == 0:
            break
        word8 = words.get(record_ptr - BASE + 8)
        if word8 is not None and word8 & 0xFFFF == 1:
            word0 = words.get(record_ptr - BASE, 0)
            records.append(flag_list(words, word0) if word0 else [])
    return records


def main() -> int:
    stages: dict[str, list] = {}
    for entry in json.loads(DESCRIPTORS.read_text()):
        stage = entry.get("stage", "")
        cast_list = entry.get("fields", {}).get("4C", "")
        if not stage.startswith("wstag") or not re.fullmatch(r"0x[0-9a-fA-F]{8}", str(cast_list)):
            continue
        path = ASM / f"{stage}.s"
        if not path.exists():
            continue
        records = char_one_records(read_words(path), int(cast_list, 16))
        if records:
            stages[stage.replace("wstag", "s")] = records
    OUT.write_text(json.dumps(dict(sorted(stages.items())), indent=1) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(stages)} stages build the player as charId 1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
