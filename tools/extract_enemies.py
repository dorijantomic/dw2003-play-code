#!/usr/bin/env python3
"""web/assets/data/enemies.json: the 194 enemy stat records of SDIGIEDT.PRO.

Source: ddw3 rust/dw2003_pro_sdigiedt/src/data.rs, `ENEMY_DIGIMON_STATS`
(`[EnemyStats; 194]`, the overlay's whole data section). Each record is read
field by field; `Moves::MOVE1` / `Moves::NULL` are that file's own named
constants ({1,0,0} / {0,0,0}). Enum values keep their ddw3 variant names.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
SRC = DDW3 / "rust/dw2003_pro_sdigiedt/src/data.rs"
OUT = ROOT / "web/assets/data/enemies.json"

NAMED_MOVES = {"Moves::MOVE1": (1, 0, 0), "Moves::NULL": (0, 0, 0)}
MOVE_RE = re.compile(r"Moves::\w+|Moves\s*\{[^}]*\}")


def parse_move(text: str) -> dict:
    text = text.strip()
    if text in NAMED_MOVES:
        a, c, v = NAMED_MOVES[text]
    else:
        f = dict(re.findall(r"(\w+):\s*(\d+)", text))
        a, c, v = int(f["action"]), int(f["comparator"]), int(f["value"])
    return {"action": a, "comparator": c, "value": v}


def records(src: str) -> list[str]:
    body = src[src.index("ENEMY_DIGIMON_STATS"):]
    out, i = [], 0
    while True:
        i = body.find("EnemyStats {", i)
        if i < 0:
            return out
        j = body.index("{", i)
        depth = 0
        for k in range(j, len(body)):
            if body[k] == "{":
                depth += 1
            elif body[k] == "}":
                depth -= 1
                if depth == 0:
                    out.append(body[j + 1:k])
                    i = k + 1
                    break


def field(rec: str, name: str) -> str:
    m = re.search(rf"\b{name}:\s*([^,\n]+),", rec)
    if not m:
        raise ValueError(f"field {name} missing in record: {rec[:80]}")
    return m.group(1).strip()


def enum(v: str) -> str:
    return v.split("::", 1)[1] if "::" in v else v


def main() -> int:
    recs = records(SRC.read_text())
    enemies = []
    for rec in recs:
        moves_txt = rec[rec.index("moves:"):rec.index("counter:")]
        moves = [parse_move(m) for m in MOVE_RE.findall(moves_txt)]
        if len(moves) != 4:
            raise ValueError(f"{field(rec, 'enemy_id')}: {len(moves)} AI moves, expected 4")
        # action 0 ends the AI script (the table's own NULL terminator row)
        if any(m["action"] == 0 for m in moves):
            moves = moves[:next(i for i, m in enumerate(moves) if m["action"] == 0)]
        counter = parse_move(MOVE_RE.findall(rec[rec.index("counter:"):])[0])
        n = lambda k: int(field(rec, k), 0)  # noqa: E731
        enemies.append({
            "enemy_id": enum(field(rec, "enemy_id")),
            "digimon_id": enum(field(rec, "digimon_id")),
            "attack": n("attack"), "move_1": n("move_1"), "move_2": n("move_2"),
            "str": n("stat_str"), "def": n("stat_def"), "spt": n("stat_spt"),
            "wis": n("stat_wis"), "spd": n("stat_spd"),
            "resistances": {k: n(f"stat_{k}") for k in
                            ("fire", "water", "ice", "wind", "thunder", "machine", "dark")},
            "status_resist": {k: n(f"res_{k}") for k in
                              ("poison", "paralyze", "confuse", "sleep", "ko")},
            "digimon_type": n("digimon_type"),
            "drop_item": enum(field(rec, "droppable_item")),
            "drop_rate": n("drop_rate"),
            "ai_moves": moves,
            "counter": counter,
        })
    if len(enemies) != 194:
        raise ValueError(f"expected 194 enemy records, parsed {len(enemies)}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"enemies": enemies}, indent=2))
    print(f"wrote {OUT} ({len(enemies)} enemies)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
