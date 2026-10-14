#!/usr/bin/env python3
"""Consistency scan: does every item box's on_close write its own spawn gate?

The item box (p126itmb) spawns while its own stored bit reads 0 and is removed
by the talk body's close arm the moment its textbox closes (fieldstg
F0x80090afc, file 0xdfa4-0xdfc0; engine/systems/box-actor.ts). The spawn gate
only hides the box on the NEXT stage entry, so a box whose on_close table never
flips its own gate would re-appear when the map is re-entered -- exactly as the
disc's would, but worth knowing which records those are.

For every p126itmb instance in web/assets/scenes/*.json:
  * its gate = the spawn flag(s) with expected 0 on a stored bank (bank <= 0x40;
    bank 0x7E route-pair and the computed banks are arrival/possession
    conditions, not the opened bit);
  * flipped = some dialogue state's on_close writes one of those ids to 1;
  * first_flipped = the FIRST dialogue state (the one a fresh session shows)
    does.

Exit code is non-zero when an instance's gate is never flipped by any state.
Run: .venv/bin/python3 tools/check_box_gates.py
"""
import glob
import json
import sys

SCENES = "web/assets/scenes/*.json"


def bank_of(flag_id: int) -> int:
    return (flag_id >> 8) & 0xFE


def stored_bank(flag_id: int) -> bool:
    # web/flag-store.js: bank <= 0x40 is the delegated stored bit; 0x7E is the
    # route pair and 0x80..0x92 the possession banks -- all computed, never the
    # box's own opened bit.
    return bank_of(flag_id) <= 0x40


def scan() -> dict:
    instances = []
    for path in sorted(glob.glob(SCENES)):
        scene = json.load(open(path))
        map_id = path.rsplit("/", 1)[-1][:-5]
        for npc in scene.get("npcs", []):
            if npc.get("sprite") != "p126itmb":
                continue
            gates = [f["id"] for f in npc.get("spawn_flags", []) if f.get("expected") == 0 and stored_bank(f["id"])]
            states = npc.get("dialogue_states") or []
            flipped = set()
            for st in states:
                for c in st.get("on_close") or []:
                    if c.get("expected") == 1 and c.get("id") in gates:
                        flipped.add(c["id"])
            first_flipped = False
            if states:
                for c in states[0].get("on_close") or []:
                    if c.get("expected") == 1 and c.get("id") in gates:
                        first_flipped = True
            instances.append({
                "map": map_id,
                "npc_id": npc.get("npc_id"),
                "id": npc.get("id"),
                "x": npc.get("x"),
                "y": npc.get("y"),
                "gates": gates,
                "flipped": sorted(flipped),
                "first_state_flips": first_flipped,
                "states": len(states),
            })
    return {"instances": instances}


def main() -> int:
    data = scan()
    inst = data["instances"]
    never = [i for i in inst if not i["flipped"]]
    first_never = [i for i in inst if not i["first_state_flips"]]
    print(f"p126itmb instances: {len(inst)}")
    print(f"gate flipped by SOME state's on_close: {len(inst) - len(never)}")
    print(f"gate flipped by the FIRST state's on_close: {len(inst) - len(first_never)}")
    for i in never:
        print(f"  NEVER-FLIPPED {i['map']} npc {i['npc_id']} at {i['x']},{i['y']} gates={i['gates']} states={i['states']}")
    for i in first_never:
        if i["flipped"]:
            print(f"  first-state-only {i['map']} npc {i['npc_id']} at {i['x']},{i['y']} "
                  f"gates={i['gates']} flipped_by={i['flipped']}")
    return 1 if never else 0


if __name__ == "__main__":
    sys.exit(main())
