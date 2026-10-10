#!/usr/bin/env python3
"""
Extract item-possession GATES (the consumers) — every place the game checks
"do you own item N" to gate an NPC spawn, a dialogue branch, or a step event.

Source of truth:
  web/assets/scenes/s*.json   — npcs[].spawn_flags + npcs[].dialogue_states[].gate
  web/assets/data/story_steps.json — op-8 step conditions (cond_a/cond_b)
  ~/ddw3/rust/types/src/item_id.rs — ItemId enum (id → name).

A flag id whose bank ((id>>8)&0xfe) is in 0x80..0x9e is a collection/possession
read (get-flag-banked-predicate-system.md §banks 0x80-0x8e/0x92). The item is the
low 9 bits (id & 0x1ff); `expected` 1 = must own, 0 = must NOT own.

Output: web/assets/data/item_gates.json
  { "gates": [ {stage, kind, who, item_id, item_name, expected}, ... ] }
"""

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
SCENES = ROOT / "web/assets/scenes"
STEPS = ROOT / "web/assets/data/story_steps.json"
OUT = ROOT / "web/assets/data/item_gates.json"


def item_names() -> list[str]:
    return re.findall(r"^\t(\w+),", (DDW3 / "rust/types/src/item_id.rs").read_text(), re.M)


def is_possession(fid: int) -> bool:
    return 0x80 <= ((fid >> 8) & 0xFE) <= 0x9E


def main() -> None:
    names = item_names()
    gates = []

    def name_of(item_id: int) -> str:
        return names[item_id] if item_id < len(names) else f"item#{item_id}"

    for scene in sorted(SCENES.glob("s*.json")):
        stage = scene.stem
        data = json.loads(scene.read_text())
        for npc in data.get("npcs", []):
            who = f"{npc.get('sprite')}#{npc.get('npc_id')}"
            for f in npc.get("spawn_flags", []):
                if is_possession(f["id"]):
                    iid = f["id"] & 0x1FF
                    gates.append({"stage": stage, "kind": "npc_spawn", "who": who,
                                  "item_id": iid, "item_name": name_of(iid),
                                  "expected": f["expected"]})
            for ds in npc.get("dialogue_states", []):
                for f in ds.get("gate", []):
                    if is_possession(f["id"]):
                        iid = f["id"] & 0x1FF
                        gates.append({"stage": stage, "kind": "dialogue", "who": who,
                                      "item_id": iid, "item_name": name_of(iid),
                                      "expected": f["expected"]})

    # op-8 step-event conditions
    steps = json.loads(STEPS.read_text())
    for n, st in steps.get("stages", {}).items():
        for step in st.get("steps", []):
            if step.get("op") != 8:
                continue
            for cond, arg in ((step.get("cond_a", 0xFFFF), step.get("arg_a", 0)),
                              (step.get("cond_b", 0xFFFF), step.get("arg_b", 0))):
                if cond != 0xFFFF and is_possession(cond):
                    iid = cond & 0x1FF
                    gates.append({"stage": "s" + n, "kind": "step", "who": f"evt{step['params'][0]}",
                                  "item_id": iid, "item_name": name_of(iid), "expected": arg})

    # de-dup
    seen, uniq = set(), []
    for g in gates:
        k = (g["stage"], g["kind"], g["who"], g["item_id"], g["expected"])
        if k not in seen:
            seen.add(k); uniq.append(g)
    uniq.sort(key=lambda g: (g["stage"], g["item_id"]))
    OUT.write_text(json.dumps({"gates": uniq}, indent=2, ensure_ascii=False))

    from collections import Counter
    by_item = Counter(g["item_name"] for g in uniq)
    print(f"Wrote {len(uniq)} possession gates → {OUT}")
    for name, c in by_item.most_common():
        print(f"  {name}: {c} gate(s)")


if __name__ == "__main__":
    main()
