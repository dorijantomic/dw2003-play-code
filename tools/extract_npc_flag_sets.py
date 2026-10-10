#!/usr/bin/env python3
"""extract_npc_flag_sets.py — mine the per-actor ptrB dialogue-state SET tables.

Every field actor's spawn record carries a `ptrB` pointer to its dialogue state
machine: a list of 12-byte triples `{gate_ptr, set_ptr, id}` (see
`wstag_extract.decode_ptrb_dialogues`). The resident engine walks the array
(`fieldstg` @0x0000de9c), picks the FIRST triple whose `gate_ptr` AND-list passes
(`F0x80016924`), stashes its `set_ptr` into entity+0xfc, and applies that
`{id,value}` table via the applier `F0x80016988` (entity+0xfc path @0x0000e008).

So a triple's `set_ptr` table is a *real, decoded flag producer*, gated by the
triple's `gate` (and predicated on the actor existing — its spawn-record `ptrA`
flag-list). Two existing pipelines miss most of these:

  * `scan_flag_setters.py` only sees `set_flag` *immediate callsites* — these are
    DATA tables, so it never finds them. (That gap is why a prior session wrongly
    believed the gondola second-hunt flags `0x1c45/0x1c46/0x1c47` had no producer
    and fabricated setters — now deleted. They are produced HERE.)
  * `extract_talk_grants.py` reads the committed SCENES, which `gen_scenes` builds
    only for *visible* NPCs. Invisible trigger-actors (sprite handle 0: npc
    63/112/113/198 …) are dropped from scenes, taking their ptrB sets with them —
    e.g. the gondola reject lives on invisible **npc 63** in wstag410 (the triple
    `gate[0x818e==0,0x818f==1,0x1c50==0] → set[0x1c46=1,0x9009=1,0x1c50=1]`).

This tool reads the overlays directly (so invisible actors are included) and emits
every triple whose `set_ptr` writes a STORED-bank flag (bank `(id>>8)&0xfe` <
0x60) — the producer class neither other tool captures. Collection-bank writes
(0x80+, item possession) stay with `extract_talk_grants.py`; virtual banks
(0x60 ordinal / 0x70 roster) cannot be set and are skipped (the engine's
`set_flag` would no-op / throw on them).

Output: web/assets/data/npc_flag_sets.json
    { "sNNN": [ { "npc_id", "slot", "dialogue_id",
                  "gate":  [[flagId, expected], ...],   # spawn_flags AND triple gate
                  "sets":  [[flagId, value], ...] }, ... ] }
`gate` is the AND of the actor's spawn flag-list and the triple's own gate; both
must hold for the engine to reach (and apply) this triple.
"""
import os
import json
import importlib.util
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASM_DIR = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
OUT = ROOT / "web/assets/data/npc_flag_sets.json"

# import wstag_extract as a module (reuse its grounded decoders)
_spec = importlib.util.spec_from_file_location("wstag_extract", ROOT / "tools/wstag_extract.py")
wx = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(wx)
BASE = wx._OVERLAY_BASE

# npc_id -> sprite (the FIELDSTG global sprite table; handle-0/miss = invisible
# marker → a positional/auto trigger, not a talk NPC). See gen_npc_sprites.py.
_SPRITES = json.loads((ROOT / "web/assets/npc_sprites.json").read_text())


def trigger_for(npc_id: int) -> str:
    """A visible NPC applies its set on talk-close (OnTalk); an invisible
    trigger-actor (no sprite) fires automatically on entry (OnEnterMap)."""
    return "talk" if _SPRITES.get(str(npc_id)) else "enter"


def is_advancing_chain(rows: list[dict]) -> bool:
    """Do these triples of ONE actor form a state chain the player steps through?

    True when a triple's gate reads a flag another triple of the same actor writes:
    state N gates on the bit state N-1 set, so the actor holds a counter rather than
    a single latch. The engine applies only the FIRST passing triple per selection
    (fieldstg @0x0000de9c), and the s235 shelf was measured on the rig advancing one
    step per examine, six examines to the 300 BIT find
    (docs/research/field/repeat-examine-search-points-2026-07-26.md). A counter is
    therefore stepped by the player interacting, not by walking into the map -- an
    entry trigger would run the whole chain the moment the map loads and consume the
    reward state before the player ever searches.
    """
    written = {fid for r in rows for fid, _ in r["sets"]}
    return any(fid in written and any(o is not r and any(w == fid for w, _ in o["sets"])
                                      for o in rows)
               for r in rows for fid, _ in r["gate"])


def bank(fid: int) -> int:
    return (fid >> 8) & 0xFE


def is_stored(fid: int) -> bool:
    """Settable, non-virtual flag bit (banks 0x00..0x5e). Excludes virtual
    ordinal/roster (>=0x60) and item/collection possession (>=0x80)."""
    return bank(fid) < 0x60


# Structural validators + the whole-overlay record scanner now live in
# wstag_extract.py (reused by extract_npcs so the SCENES get these puppets too).
find_records = wx.find_puppet_records


def extract_stage(stage: str):
    data = wx.overlay_bytes(stage)
    if not data:
        return []
    out = []
    seen = set()
    for r in find_records(data):
        spawn = [(f["id"], f["expected"]) for f in r["spawn_flags"]]
        for tri in wx.decode_ptrb_dialogues(data, r["ptrB"]):
            sets = [(c["id"], c["expected"]) for c in tri.get("on_close", [])
                    if is_stored(c["id"])]
            if not sets:
                continue
            gate = spawn + [(c["id"], c["expected"]) for c in tri.get("gate", [])]
            key = (r["slot"], r["id"], tuple(sorted(gate)), tuple(sorted(sets)))
            if key in seen:        # identical record across spawn variants — emit once
                continue
            seen.add(key)
            out.append({
                "npc_id": r["id"],
                "slot": r["slot"],
                "dialogue_id": tri.get("id"),
                "trigger": trigger_for(r["id"]),
                "gate": [[fid, exp] for fid, exp in gate],
                "sets": [[fid, val] for fid, val in sets],
            })
    # An invisible actor holding a stepped chain (a search point) is interaction-driven:
    # re-label the whole actor, so no state of the chain is applied at map load.
    by_actor: dict[int, list[dict]] = {}
    for row in out:
        by_actor.setdefault(row["npc_id"], []).append(row)
    for rows in by_actor.values():
        if rows[0]["trigger"] == "enter" and is_advancing_chain(rows):
            for row in rows:
                row["trigger"] = "talk"
    return out


def main():
    flag_sets = []
    stages = 0
    for p in sorted(ASM_DIR.glob("wstag*.s")):
        stage = p.stem[len("wstag"):]
        recs = extract_stage(stage)
        if recs:
            stages += 1
            for r in recs:
                flag_sets.append({"stage": f"s{stage}", **r})
    OUT.write_text(json.dumps({"flag_sets": flag_sets}, indent=2) + "\n")
    flags = {s[0] for r in flag_sets for s in r["sets"]}
    print(f"Wrote {OUT}")
    print(f"{stages} stages, {len(flag_sets)} set-records, {len(flags)} distinct stored flags")
    # spotlight the questline flags
    for tgt in (0x1c45, 0x1c46, 0x1c47):
        for r in flag_sets:
            if any(fid == tgt for fid, _ in r["sets"]):
                g = ", ".join(f"{hex(a)}=={b}" for a, b in r["gate"])
                st = ", ".join(f"{hex(a)}:={b}" for a, b in r["sets"])
                print(f"  0x{tgt:x}: {r['stage']} npc{r['npc_id']} dlg{r['dialogue_id']} [{r['trigger']}]  gate[{g}]  set[{st}]")


if __name__ == "__main__":
    main()
