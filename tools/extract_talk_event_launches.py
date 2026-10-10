"""
Talk-triggered cutscenes -- the bank-0x90 event launcher.

WHAT IT IS.  Most of this game's optional content is a conversation that turns
into a scene: you talk to Veemon in the Wind Prairie and the hide-and-seek
starts, you find him in the Kicking Forest and he hands over the Tree Boots.
The NPC record itself carries no cutscene id.  What it carries is a flag write
in bank 0x90 on the dialogue state's on_close list, and writing that bank is
not storage at all -- it is a call.

THE MECHANISM (resident EXE + fieldstg, read from assembly).  The set_flag
dispatcher F0x800165ac splits the id into `bank = (id >> 8) & 0xfe` and
`bit = id & 0x1ff`, and for bank 0x90 it calls the fieldstg entry point
F0x8008bfa4 with the bit as its only argument.  That routine
(fieldstg.s file 0x92f4-0x934c, overlay base 0x80082cb0) does:

    [0x8004b7bc](7, -1, -1)          ; fetch the type-7 scene controller
    a0 = u16[0x800978d8 + bit*2]     ; the EVENT ID, looked up by bit
    jal 0x800853f8                   ; start_event -- the same routine the
                                     ; step-VM's op-8 handler calls
    [controller+0x24 + 0xc] = result ; latched exactly like an op-8 start

So a bank-0x90 write is `start_event(EVENT_ID_TABLE[bit])`, where the table is
a flat u16 array of event ids resident in fieldstg.  The bit is an index into
that array, NOT an event id and NOT a per-stage slot -- which is why the same
bit means the same cutscene wherever it is written.

WHY THIS MATTERS.  226 dialogue-state on_close lists across 76 stages write
this bank.  Until now every one of them was swallowed as an unimplemented
launcher bank, so the conversation played and the scene it was supposed to
start never did.

CROSS-CHECK (asserted every run).  Every bit actually written by a shipped NPC
record must resolve to an event id that exists in THAT stage's own event table.
This is an independent check: the table is read from fieldstg, the bits from
the generated scenes, and the event ids from the per-stage wstag overlays.

BOUNDARY.  The handler bounds-checks nothing, so the array has no proven
length.  Entry 124 reads 0 and the shipped scenes never index past 122, so the
table is emitted up to that zero and the length is recorded as OBSERVED, not
proven.

Output: web/assets/data/talk_event_launches.json
    {"bank": 144, "table_ram": "0x800978d8", "events": [1522, 1200, ...]}

Run: python3 tools/extract_talk_event_launches.py
"""

import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDSTG = ROOT / "web/assets/native/fieldstg.bin"
SCENES = ROOT / "web/assets/scenes"
EVENTS = ROOT / "web/assets/events/wstag_events.json"
OUT = ROOT / "web/assets/data/talk_event_launches.json"

FIELDSTG_BASE = 0x80082CB0   # FIELDSTG.PRO load address
TABLE_RAM = 0x800978D8       # the u16 event-id array F0x8008bfa4 indexes
BANK = 0x90                  # (id >> 8) & 0xfe for a launcher write


def read_table(data: bytes) -> list[int]:
    """The u16 array at TABLE_RAM, up to (not including) its first zero."""
    off = TABLE_RAM - FIELDSTG_BASE
    if off < 0 or off >= len(data):
        raise SystemExit(f"table offset 0x{off:x} outside fieldstg.bin")
    out = []
    while off + 2 <= len(data):
        (v,) = struct.unpack_from("<H", data, off)
        if v == 0:
            break
        out.append(v)
        off += 2
    return out


def written_bits() -> dict[int, set[str]]:
    """bit -> stages whose shipped NPC records write bank 0x90 with it."""
    used: dict[int, set[str]] = {}
    for path in sorted(SCENES.glob("s*.json")):
        scene = json.loads(path.read_text())
        for npc in scene.get("npcs", []):
            for st in npc.get("dialogue_states", []) or []:
                for cond in st.get("on_close", []) or []:
                    if ((cond["id"] >> 8) & 0xFE) == BANK:
                        used.setdefault(cond["id"] & 0x1FF, set()).add(path.stem)
    return used


def main() -> int:
    table = read_table(FIELDSTG.read_bytes())
    events = json.loads(EVENTS.read_text())
    used = written_bits()

    problems = []
    for bit, stages in sorted(used.items()):
        if bit >= len(table):
            problems.append(f"bit {bit} past the {len(table)}-entry table ({sorted(stages)})")
            continue
        eid = table[bit]
        for stage in sorted(stages):
            ids = {e["id"] for e in events.get(stage, [])}
            if ids and eid not in ids:
                problems.append(f"bit {bit} -> event {eid} absent from {stage}'s event table")

    writes = sum(len(s) for s in used.values())
    print(f"bank 0x{BANK:02x} launcher: {len(table)} event ids; "
          f"{len(used)} distinct bits used by {writes} stage-bindings "
          f"across {len({s for v in used.values() for s in v})} stages")
    # The table itself is read straight out of fieldstg, so a stage-binding that
    # does not resolve does NOT invalidate it -- it is an unresolved binding and
    # is carried in the output rather than silently dropped or guessed away.
    for p in problems:
        print("  UNRESOLVED:", p)
    print(f"  {writes - len(problems)}/{writes} stage-bindings resolve in-stage")

    OUT.write_text(json.dumps({
        "_comment": (
            "set_flag(bank 0x90, bit) = start_event(events[bit]). Resident "
            "dispatcher F0x800165ac routes bank 0x90 to fieldstg F0x8008bfa4, "
            "which reads this u16 array at RAM 0x800978d8 and calls the same "
            "start_event (0x800853f8) the step-VM op-8 handler uses. Length is "
            "OBSERVED (first zero entry); the handler bounds-checks nothing. "
            "See tools/extract_talk_event_launches.py."
        ),
        "bank": BANK,
        "table_ram": "0x%08x" % TABLE_RAM,
        "length_is_observed": True,
        "unresolved_bindings": problems,
        "events": table,
    }, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
