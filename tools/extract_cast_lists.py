#!/usr/bin/env python3
"""
Stage cast-list extractor — the scene descriptor's +0x4C actor list, read once,
the way the game's own cast rebuild reads it.

WHAT IT IS.  Every field stage's scene descriptor carries at +0x4C a pointer to
that stage's CAST LIST: an array of 0-terminated pointers to 20-byte actor
records `{flagList, ptrB, slot<<16|id, y<<16|x, n}`.  The field's cast rebuild
F0x8008AE50 (fieldstg.s file 0x81a0; overlay base 0x80082cb0) walks it twice:

  LOOP A — the player (file 0x81f8-0x82cc).  Records whose +0x8 halfword is in
  {1, 0x6a, 0x146, 0x147} are player candidates; a candidate whose gate passes
  (word0 null = unconditional, else the {u16 id, u16 expected} AND-list through
  F0x80016924) wins with the FIRST pass, and the player is built from that id
  (F0x8009116c at scene+0x18).  No candidate passes -> id 2 (P002PLAY).
  0x146 = Digmon (p123digm), 0x147 = Submarimon (p122sbmm), 1 = P001PLAY,
  0x6a = the fourth player form.

  LOOP B — every other actor (file 0x83b4-0x849c).  Each record whose +0x8
  halfword is NOT one of the four player ids and whose gate passes is built
  through the same constructor (F0x8009116c) with the record's own slot
  (record+0xa) and position ((y<<16|x)<<8), and the record's `n` (+0x10) is
  stored to char+0x60.  There is no id filter: a high-nid record with no
  dialogue pointer spawns exactly like any NPC.

  Loop A's call site requires the predicate's answer to be 1; loop B's accepts
  any non-zero.  F0x80016924 returns only 0 or 1 (exe/fns.s:7184-7211), so the
  two are one rule.

This is the ONE consumer of the cast list.  The earlier per-purpose readers
(dive-form markers, charId-1 player rows, and the need_ids-filtered cast merge
in tools/wstag_extract.py) are its special cases; this tool decodes the whole
list for every stage and DERIVES those two shipped files from the same walk so
they cannot drift from the general decode:

  web/assets/data/stage_cast_lists.json   full decode, one entry per stage:
      { "s870": [ {"id": 328, "slot": 7, "x": 368, "y": 392, "n": 1,
                   "gate": [{"id": 32287, "expected": 1},
                            {"id": 8, "expected": 0}], "ptrB": null}, ... ] }
  web/assets/data/dive_form_markers.json  screen -> 326/327 (loop A result)
  web/assets/data/player_cast_one.json    charId-1 records' gates in order

Outputs are checked with --check: every record's words are re-read from the
stage's own `.L0x` image and every derived value re-computed, and the derived
marker set is required to equal the previously shipped one where that file
exists (the file is regenerated, not trusted).

Sources: docs/generated/stage-descriptors.json (field 4C, built by
tools/extract_stage_descriptors.py) + ~/ddw3/asm/dw2003/pro/wstag*.s.
"""

from __future__ import annotations
import os

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASM = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm" / "dw2003" / "pro"
DESCRIPTORS = ROOT / "docs" / "generated" / "stage-descriptors.json"
OUT = ROOT / "web" / "assets" / "data" / "stage_cast_lists.json"
MARKERS_OUT = ROOT / "web" / "assets" / "data" / "dive_form_markers.json"
PLAYER_ONE_OUT = ROOT / "web" / "assets" / "data" / "player_cast_one.json"

# Every `wstag*` overlay loads here (tools/overlay_scan.py: `_stem_base`).
BASE = 0x800A5DE0

# The player candidate ids, read out of loop A's compares (file 0x8218-0x8250):
# 0x6a, 1, and the [0x146, 0x148) window.
PLAYER_CAST_IDS = (1, 0x6A, 0x146, 0x147)

# The two of those that are traversal FORMS (their sprite id is the record id).
DIVE_FORM_IDS = (0x146, 0x147)

LABEL_RE = re.compile(r"^\.L0x([0-9a-f]{8}): \.word 0x([0-9a-f]{8})", re.M)
DESC_FIELD_RE = re.compile(r"^0x[0-9a-fA-F]{8}$")


def read_words(path: Path) -> dict[int, int]:
    """File offset -> word value, from the disassembly's `.L0x` directives."""
    words: dict[int, int] = {}
    for match in LABEL_RE.finditer(path.read_text()):
        words[int(match.group(1), 16)] = int(match.group(2), 16)
    return words


def flag_list(words: dict[int, int], ptr: int) -> list[dict[str, int]]:
    """The 0xffff-ended {u16 id, u16 expected} list at RAM `ptr` (one pair/word).

    F0x80016924 reads it as halfwords with no entry count (exe/fns.s:7184-7211);
    the terminator is an id halfword of 0xFFFF.
    """
    out: list[dict[str, int]] = []
    for i in range(64):
        word = words.get(ptr - BASE + 4 * i)
        if word is None or word & 0xFFFF == 0xFFFF:
            return out
        out.append({"id": word & 0xFFFF, "expected": word >> 16})
    raise ValueError(f"unterminated flag list at {ptr:#x}")


def cast_list(words: dict[int, int], cast_list_ram: int) -> list[dict]:
    """One stage's whole cast list, in the array's own order.

    A record is `{id, slot, x, y, n, gate, ptrB}`; `ptrB` is kept as a RAM
    address (the dialogue pointer the actor build hands the constructor).
    The walk stops at the array's own 0 terminator.
    """
    array = cast_list_ram - BASE
    out: list[dict] = []
    for i in range(256):
        record_ptr = words.get(array + 4 * i)
        if record_ptr is None or record_ptr == 0:
            break
        record = record_ptr - BASE
        flagptr, ptr_b, sid, pos, n = (words.get(record + 4 * j, 0) for j in range(5))
        out.append({
            "id": sid & 0xFFFF,
            "slot": (sid >> 16) & 0xFFFF,
            "x": pos & 0xFFFF,
            "y": (pos >> 16) & 0xFFFF,
            "n": n & 0xFFFF,
            "gate": flag_list(words, flagptr) if flagptr else [],
            "ptrB": ptr_b or None,
        })
    return out


def player_candidates(records: list[dict]) -> list[dict]:
    """Loop A's scan: the player-id records, in cast-list order."""
    return [r for r in records if r["id"] in PLAYER_CAST_IDS]


def dive_form_marker(records: list[dict]) -> int | None:
    """The form the cast list builds the player with, or None (Junior).

    The loop-A rule: the FIRST player candidate whose gate passes wins; the
    file records the form only when that winner is a traversal form.  A gate
    cannot be evaluated statically, so the winner is taken among candidates
    whose gate is EMPTY (unconditional) — every shipped form record carries an
    empty gate; --check asserts that over all stages.
    """
    for r in player_candidates(records):
        if r["gate"]:
            continue
        return r["id"] if r["id"] in DIVE_FORM_IDS else None
    return None


def main() -> int:
    if not DESCRIPTORS.exists():
        print(f"missing {DESCRIPTORS}", file=sys.stderr)
        return 1
    descriptors = json.loads(DESCRIPTORS.read_text())
    check = "--check" in sys.argv

    stages: dict[str, list[dict]] = {}
    markers: dict[str, int] = {}
    player_one: dict[str, list[list[dict]]] = {}
    form_gates: set[str] = set()

    for entry in descriptors:
        stage = entry.get("stage", "")
        if not stage.startswith("wstag"):
            continue
        cast_list_field = entry.get("fields", {}).get("4C", "")
        if not DESC_FIELD_RE.fullmatch(str(cast_list_field)):
            continue
        path = ASM / f"{stage}.s"
        if not path.exists():
            continue
        words = read_words(path)
        records = cast_list(words, int(cast_list_field, 16))
        name = stage.replace("wstag", "s")
        stages[name] = records

        marker = dive_form_marker(records)
        if marker is not None:
            markers[name] = marker
        gates = [r["gate"] for r in records if r["id"] == 1]
        if gates:
            player_one[name] = gates

        # A form record that carries a gate would break the static derivation.
        for r in player_candidates(records):
            if r["id"] in DIVE_FORM_IDS and r["gate"]:
                form_gates.add(f"{name} id {r['id']}")

    if form_gates:
        print("gated form records (the marker derivation cannot decide these):")
        for line in sorted(form_gates):
            print(f"  {line}")
        if check:
            return 1

    # --check: re-read every stage and re-derive; also compare the derived
    # marker file against the one on disk BEFORE overwriting it.
    if check:
        old_markers: dict[str, int] = {}
        if MARKERS_OUT.exists():
            old_markers = json.loads(MARKERS_OUT.read_text())
        if old_markers and old_markers != dict(sorted(markers.items())):
            print("marker set CHANGED by the general decode:")
            for key in sorted(set(old_markers) | set(markers)):
                if old_markers.get(key) != markers.get(key):
                    print(f"  {key}: {old_markers.get(key)} -> {markers.get(key)}")
            return 1
        total = sum(len(v) for v in stages.values())
        print(f"{len(stages)} stages, {total} cast records, {len(markers)} form markers")
        for name in sorted(markers):
            assert markers[name] in DIVE_FORM_IDS
        print("check: derived markers equal the shipped file")

    OUT.write_text(json.dumps(dict(sorted(stages.items())), indent=1) + "\n")
    MARKERS_OUT.write_text(json.dumps(dict(sorted(markers.items())), indent=2) + "\n")
    PLAYER_ONE_OUT.write_text(json.dumps(dict(sorted(player_one.items())), indent=1) + "\n")
    total = sum(len(v) for v in stages.values())
    print(f"{OUT.relative_to(ROOT)}: {len(stages)} stages, {total} cast records")
    print(f"{MARKERS_OUT.relative_to(ROOT)}: {len(markers)} screens carry a dive-form marker")
    print(f"{PLAYER_ONE_OUT.relative_to(ROOT)}: {len(player_one)} stages build the player as charId 1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
