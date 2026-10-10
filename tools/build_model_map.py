#!/usr/bin/env python3
"""Derive web/assets/battle/model_map.json from the disc's species -> model-number table.

Context
-------
Every battle model is chosen by NAME through `resolveModelFolder`
(`web/battle3d.js:3922-3932`), which reads
`web/assets/battle/model_map.json`. That table used to be hand-authored, and a
hand row is not evidence: it mapped MasterTyrannomon, MetalTyrannomon and
Tyrannomon all onto `m008tyra`, so the two boss variants rendered as the
ordinary Tyrannomon.

The disc gives the species its own model number. `web/assets/battle/model_id_map.json`
carries that rule (the `EnemyId` enum of `~/ddw3/rust/types/src/enemy_id.rs`,
whose values the smdldata key field independently matches — see
`docs/research/battle/smdldata-container-2026-08-05.md`, "the key is the
Digimon's model number"). A model pack is `<number>` -> `m<NNN><mnemonic>`.

This tool reads only in-repo data (`model_id_map.json`, `models/index.json`,
`digimon.json`) so the table is reproducible without the read-only tree. Run it
when the model-number table changes; it rewrites model_map.json in place.

Usage:
    python3 tools/build_model_map.py [--check]

`--check` exits non-zero if model_map.json differs from what the rule produces.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAP_PATH = ROOT / "web/assets/battle/model_map.json"
ID_MAP_PATH = ROOT / "web/assets/battle/model_id_map.json"
INDEX_PATH = ROOT / "web/assets/battle/models/index.json"
DIGIMON_PATH = ROOT / "web/assets/data/digimon.json"


def load(path: Path):
    return json.loads(path.read_text())


def target_folder(name: str, enemy_id: dict[str, int], aliases: dict[str, str],
                  folder_for: dict[int, str], partners: set[str],
                  current: str | None) -> tuple[str | None, str | None]:
    """The folder the rule gives for one model_map key, or (None, reason) to keep it."""
    key = aliases.get(name, name)
    if key in enemy_id:
        # A partner's own name is the player model (kept as authored: it is the
        # smdldata table-A model, not the enemy one). The wild form of a partner
        # is the "<name>2" key, which enemy_id names after the partner.
        if name in partners:
            return None, "partner base name"
        return folder_for.get(enemy_id[key]), f"enemy_id.rs {key}={enemy_id[key]}"
    if name[-1:].isdigit():
        stem = name[:-1]
        skey = aliases.get(stem, stem)
        if skey in enemy_id and stem in partners:
            return folder_for.get(enemy_id[skey]), (
                f"wild variant of partner {stem} (enemy_id.rs {skey}={enemy_id[skey]})")
    return None, "no rule"


def build() -> tuple[dict[str, str], list[tuple[str, str, str, str | None]]]:
    model_map = load(MAP_PATH)
    id_map = load(ID_MAP_PATH)
    enemy_id = {k: int(v) for k, v in id_map["enemyId"].items()}
    aliases = {k: v for k, v in id_map.get("aliases", {}).items() if isinstance(v, str)}
    folder_for = {int(k): v for k, v in id_map["modelFolderForNumber"].items()}
    partners = {d["name"] for d in load(DIGIMON_PATH)["digimon"]}
    existing = set(load(INDEX_PATH))

    out = dict(model_map)
    changes: list[tuple[str, str, str, str | None]] = []
    for name in model_map:
        cur = model_map[name]
        tgt, reason = target_folder(name, enemy_id, aliases, folder_for, partners, cur)
        if tgt is None or tgt == cur:
            continue
        if tgt not in existing:
            print(f"  ! {name}: rule wants {tgt} but no such model pack; keeping {cur}")
            continue
        out[name] = tgt
        changes.append((name, cur, tgt, reason))
    return out, changes


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true",
                    help="verify model_map.json matches the rule; do not write")
    args = ap.parse_args()

    out, changes = build()
    if args.check:
        if changes:
            for name, cur, tgt, reason in sorted(changes):
                print(f"  {name}: {cur} -> {tgt}   [{reason}]")
            print(f"model_map.json is out of date ({len(changes)} rows). "
                  f"Run tools/build_model_map.py")
            return 1
        print("model_map.json matches the species -> model-number rule")
        return 0

    MAP_PATH.write_text(json.dumps(out, indent=2) + "\n")
    for name, cur, tgt, reason in sorted(changes):
        print(f"  {name}: {cur} -> {tgt}   [{reason}]")
    print(f"wrote {MAP_PATH.relative_to(ROOT)} ({len(changes)} rows changed)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
