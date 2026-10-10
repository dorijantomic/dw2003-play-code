#!/usr/bin/env python3
"""
The bank-0x90 talk launcher, resolved PER STAGE: which scene each conversation starts.

WHAT IT IS.  `tools/extract_talk_event_launches.py` proves the mechanism and emits the
resident event-id table (`web/assets/data/talk_event_launches.json`): `set_flag(bank 0x90,
bit)` is not storage, it is `start_event(events[bit])`, dispatched by the resident
F0x800165ac into fieldstg F0x8008bfa4, which indexes a flat u16 array at RAM 0x800978d8
and calls the same `start_event` (0x800853f8) the step-VM's op-8 handler calls.

That table says WHICH EVENT a bit names. It does not say WHERE the write happens, so
"which conversation starts this scene" was answered twice, twice differently:

  * `tools/engine-convert/lib.ts` guessed it from the event's own disassembly
    (`eventActor`) and emitted an ungated `OnTalk` row matched to that npc id, so the
    scene started the first time you spoke to ANY record carrying that npc id, at any
    story step. Measured: 89 such rows across 89 places, of which the six that close a
    story beat fired at every one of the 46 story steps (s305 event 895 -> step 34,
    s520 event 695 -> step 26, s685 event 690 -> step 25, s750 event 820 -> step 32,
    s380 event 205 -> step 9, s237 event 300 -> step 13, s325 event 560 -> step 22).
    Worse, the row PRESENTED a cutscene, so the talk handler never opened the spoken
    line -- and the spoken line's `on_close` is the very write that starts the scene.
  * `tools/extract_ordinal_owner.py` guessed it a second way (`speaker_of` on the same
    disassembly), which is why it recorded no start at all for s750 event 820.

THIS FILE replaces both guesses with the evidence that is already shipped and is the
thing the game itself reads: the `on_close` list of each NPC dialogue state in
`web/assets/scenes/*.json`. A site is one (stage, npc, dialogue state) whose `on_close`
writes bank 0x90; its bit indexes the resident table; the result is the event id, and it
is only a start site if that id is in THIS stage's own event table (start_event has no
cross-stage lookup -- fieldstg F0x800853f8 walks the current stage's 20-byte records and
falls out at the 0xffffffff terminator without filling the runner).

CROSS-CHECK, every run: re-resolve every site straight from fieldstg.bin and compare.
A mismatch fails the run, so this file cannot drift from the table it claims to index.

Output: web/assets/data/talk_launch_bindings.json
    {"stages": {"s520": [{"bit":64,"event":695,"npc":66,"file":"estalk01","index":163,
                          "gate":[{"id":24601,"expected":1}],
                          "spawn_flags":[{"id":24601,"expected":1}]}, ...]}}

Run: python3 tools/extract_talk_launch_bindings.py
"""

import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIELDSTG = ROOT / "web/assets/native/fieldstg.bin"
SCENES = ROOT / "web/assets/scenes"
EVENTS = ROOT / "web/assets/events/wstag_events.json"
LAUNCH = ROOT / "web/assets/data/talk_event_launches.json"
OUT = ROOT / "web/assets/data/talk_launch_bindings.json"

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


def sites() -> dict[str, list[dict]]:
    """stage -> one record per dialogue state whose on_close writes bank 0x90."""
    table = json.loads(LAUNCH.read_text())
    shipped = table["events"]
    raw = FIELDSTG.read_bytes()
    fresh = read_table(raw)
    if fresh != shipped:
        raise SystemExit("talk_event_launches.json disagrees with fieldstg.bin")

    events = json.loads(EVENTS.read_text())
    out: dict[str, list[dict]] = {}
    unresolved = []
    for path in sorted(SCENES.glob("s*.json")):
        stage = path.stem
        stage_ids = {e["id"] for e in events.get(stage, [])}
        rows = []
        for npc in json.loads(path.read_text()).get("npcs", []):
            for idx, st in enumerate(npc.get("dialogue_states", []) or []):
                for oc in st.get("on_close", []) or []:
                    if ((oc["id"] >> 8) & 0xFE) != BANK:
                        continue
                    bit = oc["id"] & 0x1FF
                    if bit >= len(shipped):
                        unresolved.append(f"{stage}: bit {bit} past the {len(shipped)}-entry table")
                        continue
                    eid = shipped[bit]
                    row = {
                        "bit": bit,
                        "event": eid,
                        "npc": npc["npc_id"],
                        "state": idx,
                        "file": st["dialogue"]["file"],
                        "index": st["dialogue"]["index"],
                        "write": oc["id"],
                        "gate": st.get("gate") or [],
                        "spawn_flags": npc.get("spawn_flags") or [],
                    }
                    if stage_ids and eid not in stage_ids:
                        # start_event finds nothing on this stage. Carried, never redirected.
                        row["in_stage"] = False
                        unresolved.append(
                            f"{stage}: bit {bit} -> event {eid} absent from this stage's event table")
                    else:
                        row["in_stage"] = True
                    rows.append(row)
        if rows:
            out[stage] = rows
    return out, unresolved


def main() -> int:
    table = read_table(FIELDSTG.read_bytes())
    by_stage, unresolved = sites()
    total = sum(len(v) for v in by_stage.values())
    resolved = sum(1 for v in by_stage.values() for r in v if r["in_stage"])
    ids = sorted({r["event"] for v in by_stage.values() for r in v if r["in_stage"]})

    print(f"bank 0x{BANK:02x} launch SITES: {total} dialogue states across {len(by_stage)} stages")
    print(f"  {resolved}/{total} resolve to an event in their own stage's table "
          f"({len(ids)} distinct events)")

    payload = {
        "_comment": (
            "Per-stage resolution of the bank-0x90 TALK launcher: one record per NPC "
            "dialogue state whose on_close writes bank 0x90, the bit it writes, and the "
            "event the resident table at RAM 0x800978d8 names for that bit. This is the "
            "START SITE of those scenes -- the conversation's own on_close, behind the "
            "dialogue state's own gate. It replaces two guesses that read the event's "
            "disassembly instead (tools/engine-convert/lib.ts eventActor, "
            "tools/extract_ordinal_owner.py speaker_of). See "
            "tools/extract_talk_launch_bindings.py."
        ),
        "bank": BANK,
        "table_ram": "0x%08x" % TABLE_RAM,
        "table_len": len(table),
        "stages": by_stage,
        "unresolved": unresolved,
    }
    OUT.write_text(json.dumps(payload, indent=1) + "\n")
    for u in unresolved:
        print("  UNRESOLVED:", u)
    return 0


if __name__ == "__main__":
    sys.exit(main())