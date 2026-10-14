#!/usr/bin/env python3
"""Make the enemy-only Digimon obtainable: derive their player forms from the disc's own enemy rows.

Reads (all already built from the disc by the other stages, none of it is committed):
  web/assets/data/enemies.json            stats, resistances, the enemy's own attack and specials, family
  web/assets/data/digimon.json            the 55 base species + the technique list (the form template)
  web/assets/data/digimon_profiles.bin    the disc's 55 profile rows (template bytes for the new rows)
  web/assets/data/fight_tech_table.json   per technique: element, power
  web/assets/battle/model_map.json        species -> model folder (the folder's number is the row's value0)
  web/assets/data/battlecmd/79.bin        the disc's English Digimon-name bank 0x4E (it already names every enemy)
and data/authored/web/assets/data/extra_species_canon.json (ours: fixed ids + canonical pre-evolutions).

Writes
  web/assets/data/extra_species.json   {digimon: [rows in digimon.json's shape, ids 56..], tree: {line: [records]},
                                        meta: {name: {tier, family, affinity, parents}}}
  web/assets/data/extra_profiles.bin   the same rows as 0x58-byte disc profile records (ids 56.. in order)

How a species becomes a form (the same shape the disc's 44 forms have, see tools/extract_evolutions.py):
  tier      from the enemy's stat total (A..E); sets the stat bonus total, resist cap and DV cap like the base forms
  stats     the tier's bonus total split by the enemy's own stat shares; resistances the enemy's, scaled to the cap
  family    the enemy's digimon_type (it is the same 1..11 classification the base forms use)
  techs     the enemy's own attack is the basic; its special (if any) the signature; the rest are picked from the
            generic technique pool by the enemy's element and tier, so every one is a technique the disc animates
  unlock    appended after each line's 44 records: needs its canonical pre-evolution(s) at a form level, and one stat
            gate scaled from the enemy. A line that suits the family (AFFINITY) meets the base gate; the others need
            more of everything ("which Digimon becomes which")
"""
from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web/assets/data"
CANON = ROOT / "data/authored/web/assets/data/extra_species_canon.json"

STAT_KEYS = ("str", "def", "spt", "wis", "spd")
ELEMS = ("fire", "water", "ice", "wind", "thunder", "machine", "dark")
EXTRA_FIRST_ID = 56

# tier -> (stat bonus total, resist cap, dv cap, template base form id, parent form level, root line level)
TIERS = {
    1: dict(total=100, res=60, dv=100, template=12, parent_lv=10, root_lv=4),     # Greymon
    2: dict(total=150, res=80, dv=95, template=20, parent_lv=15, root_lv=10),     # Kyukimon
    3: dict(total=200, res=100, dv=90, template=38, parent_lv=20, root_lv=18),    # Gallantmon
    4: dict(total=225, res=120, dv=80, template=48, parent_lv=30, root_lv=26),    # Phoenixmon
    5: dict(total=250, res=120, dv=60, template=51, parent_lv=40, root_lv=34),    # Beelzemon
}
TIER_CUTS = ((1000, 1), (2000, 2), (2600, 3), (3200, 4), (10**9, 5))

# the line slots (0 Kotemon, 1 Kumamon, 2 Monmon, 3 Agumon, 4 Veemon, 5 Guilmon, 6 Renamon, 7 Patamon)
# whose Digimon would plausibly grow into each family
AFFINITY = {
    1: (7, 0), 2: (3, 5, 0), 3: (5, 6), 4: (5, 6), 5: (2, 4), 6: (1, 6),
    7: (7, 6), 8: (4, 2), 9: (7, 6), 10: (1, 4), 11: (4, 5),
}
OFF_LINE_EXTRA_LEVEL = 10
OFF_LINE_GATE_FACTOR = 1.25

# generic techniques by element (the disc's own, all animated): ordered weak -> strong
POOL = {
    2: [137, 141, 138, 142, 139, 143, 144, 140],
    3: [145, 146, 147, 148],
    4: [149, 150, 151, 152],
    5: [153, 154, 155],
    6: [156, 157, 158, 159],
    7: [160, 161, 162, 163],
    8: [164, 165, 166, 167],
    1: [105, 123, 125, 107, 124, 126, 109],
}
SUPPORT = [198, 200, 202, 184]
# element of the generic techniques a species gets when its own attack is plain (1 normal ... 8 dark, as the tech table numbers them)
FAMILY_ELEMENT = {1: 6, 2: 2, 3: 8, 4: 8, 5: 7, 6: 4, 7: 5, 8: 6, 9: 5, 10: 3, 11: 2}


def load(path: Path):
    return json.loads(path.read_text())


def bank_names() -> dict[str, int]:
    """Entry index of each Digimon name in the English name bank 0x4E (letters only, so the odd separator bytes are ignored)."""
    raw = (DATA / "battlecmd/79.bin").read_bytes()
    n = struct.unpack_from("<I", raw, 0)[0]
    offs = [struct.unpack_from("<I", raw, 4 * (i + 1))[0] for i in range(n)]
    out: dict[str, int] = {}
    for i in range(n):
        a = offs[i]
        e = offs[i + 1] if i + 1 < n else len(raw)
        s = ""
        for c in raw[a:e].split(b"\0")[0]:
            if 0x0E <= c <= 0x27:
                s += chr(c + 0x33)
            elif 0x28 <= c <= 0x41:
                s += chr(c + 0x39)
        if s and s not in out and i >= 56:
            out[s] = i
    return out


def tier_of(total: int) -> int:
    return next(t for cut, t in TIER_CUTS if total < cut)


def base_tier(form: dict) -> int:
    total = sum(form[k] for k in STAT_KEYS)
    return 1 if total <= 110 else 2 if total <= 170 else 3 if total <= 210 else 4 if total <= 235 else 5


# enemy names whose letters differ from the bank's spelling
BANK_ALIAS = {"HKabuterimon": "HMKabuterimon", "BKWayGreymon": "BKWarGreymon"}


def r5(v: float) -> int:
    return int(round(v / 5.0)) * 5


def main() -> int:
    canon = load(CANON)["species"]
    digi = load(DATA / "digimon.json")
    base = digi["digimon"]
    skills = {s["id"]: s for s in digi["skills"]}
    tech = load(DATA / "fight_tech_table.json")
    enemies = {}
    for e in load(DATA / "enemies.json")["enemies"]:
        enemies.setdefault(e["enemy_id"], e)
    model_map = load(ROOT / "web/assets/battle/model_map.json")
    profiles = (DATA / "digimon_profiles.bin").read_bytes()
    bank = bank_names()
    by_name = {m["name"]: m for m in base}
    by_name["BK WarGreymon"] = by_name.get("BK WarGreymon")
    problems: list[str] = []

    # a form is never weaker than the forms it digivolves from, whatever area its enemy copy was scaled for
    raw_tier: dict[str, int] = {}
    for sp in canon:
        e0 = enemies.get(sp["name"])
        if e0:
            raw_tier[sp["name"]] = tier_of(sum(e0[k] for k in STAT_KEYS))
    for b in base[8:52]:
        raw_tier[b["name"]] = base_tier(b)
    final_tier: dict[str, int] = {}

    def resolve(n: str, seen=()) -> int:
        if n in final_tier:
            return final_tier[n]
        if n in seen:
            return raw_tier.get(n, 1)
        parents = next((s["from"] for s in canon if s["name"] == n), [])
        t = max([raw_tier.get(n, 1)] + [resolve(p, seen + (n,)) for p in parents])
        final_tier[n] = t
        return t

    for sp in canon:
        resolve(sp["name"])

    rows: list[dict] = []
    blobs: list[bytes] = []
    meta: dict[str, dict] = {}
    used_values = {struct.unpack_from("<H", profiles, 0x58 * i)[0] for i in range(55)}

    for sp in canon:
        name = sp["name"]
        e = enemies.get(name)
        if e is None:
            problems.append(f"{name}: no enemy row")
            continue
        folder = model_map.get(name)
        m = re.match(r"m(\d+)", folder or "")
        if not m:
            problems.append(f"{name}: no model folder ({folder})")
            continue
        value0 = int(m.group(1))
        if value0 in used_values:
            problems.append(f"{name}: model number {value0} already the game id of another species")
        used_values.add(value0)
        letters = BANK_ALIAS.get(name) or re.sub(r"[^A-Za-z]", "", name)
        idx = bank.get(letters)
        if idx is None:
            problems.append(f"{name}: not found in the name bank")
            continue

        total = sum(e[k] for k in STAT_KEYS)
        tier = final_tier[name]
        T = TIERS[tier]
        tpl = base[T["template"] - 1]
        # stat bonuses by the enemy's shares
        share = {k: e[k] / max(1, total) for k in STAT_KEYS}
        bonus = {k: r5(T["total"] * share[k]) for k in STAT_KEYS}
        # resistances scaled into the tier's cap
        res = e["resistances"]
        lo, hi = min(res[k] for k in ELEMS), max(res[k] for k in ELEMS)
        span = max(1, hi - lo)
        resist = {k: r5(T["res"] * (res[k] - lo) / span) for k in ELEMS}
        sr = e["status_resist"]
        status = {k: min(100, int(sr[k] * 0.5) // 5 * 5) for k in ("poison", "paralyze", "confuse", "sleep", "ko")}

        # techniques
        basic = e["attack"]
        trow = tech.get(str(basic))
        element = (trow or {}).get("elem1") or 1
        if element == 1:
            element = FAMILY_ELEMENT.get(e["digimon_type"], 1)
        special = next((x for x in (e["move_1"], e["move_2"]) if x and skills.get(x, {}).get("type") == "attack"), 0)
        pool = POOL.get(element, POOL[1])
        pick = lambda f: pool[min(len(pool) - 1, int(round(f * (len(pool) - 1))))]
        f = (tier - 1) / 4.0
        support = SUPPORT[(sp["id"]) % len(SUPPORT)]
        signature = special or pick(min(1.0, f + 0.25))
        slots = [pick(0.0), pick(f * 0.5), support, pick(f)]
        slots = list(dict.fromkeys(slots))
        for filler in SUPPORT + pool:
            if len(slots) >= 4:
                break
            if filler not in slots and filler != signature:
                slots.append(filler)
        tech_slots = slots[:4] + [0, signature]
        techs_list = [basic, signature] + slots[:4]

        row = {
            "id": sp["id"], "name": name, "hp": 1, "mp": 0, **bonus, "chr": 1,
            "growth": {k: 1 for k in ("hp", "mp", "str", "def", "spt", "wis", "spd", "chr")},
            "resistances": resist, "resistance_growth": {k: 1 for k in ELEMS},
            "growth_xp": 1, "dv_cap": T["dv"], "status_resist": status,
            "family": e["digimon_type"], "tech_basic": basic, "tech_signature": signature, "tech_dna_dv": 0,
            "tech_level_learn": tpl["tech_level_learn"], "tech_level_load": tpl["tech_level_load"],
            "tech_slots": tech_slots, "tech_learn_levels": tpl["tech_learn_levels"], "tech_load_levels": tpl["tech_load_levels"],
            "blasts": [0, 0, 0, 0, 0], "techs": techs_list, "is_starter": False,
        }
        rows.append(row)

        # the disc's 0x58-byte record: the template form's bytes, then this species' own numbers
        rec = bytearray(profiles[0x58 * (T["template"] - 1): 0x58 * T["template"]])
        struct.pack_into("<H", rec, 0x00, value0)
        for i, k in enumerate(("str", "def", "spt", "wis", "spd")):
            struct.pack_into("<H", rec, 0x02 + 2 * i, bonus[k])
        struct.pack_into("<H", rec, 0x0C, 1)
        for i, k in enumerate(ELEMS):
            struct.pack_into("<H", rec, 0x0E + 2 * i, resist[k])
        struct.pack_into("<H", rec, 0x1C, basic)
        for i in range(5):
            struct.pack_into("<H", rec, 0x1E + 2 * i, 0)
        for i, t in enumerate(techs_list[2:6]):
            struct.pack_into("<H", rec, 0x1E + 2 * i, t)
        struct.pack_into("<H", rec, 0x28, signature)
        struct.pack_into("<H", rec, 0x2A, 0)
        for i, k in enumerate(("poison", "paralyze", "confuse", "sleep", "ko")):
            rec[0x2C + i] = status[k]
        rec[0x3D] = 0                      # no DNA partner
        rec[0x50:0x55] = bytes(5)          # no Blast forms
        rec[0x55] = idx                    # the name's entry in bank 0x4E
        blobs.append(bytes(rec))

        # unlock rule
        top = max(STAT_KEYS, key=lambda k: e[k])
        meta[name] = {
            "id": sp["id"], "value0": value0, "tier": tier, "family": e["digimon_type"], "bank": idx,
            "affinity": list(sp.get("lines") or AFFINITY.get(e["digimon_type"], ())), "parents": sp["from"],
            "gateStat": top, "gateValue": min(460, max(30, int(e[top] * 0.55 / 10) * 10)),
        }

    ids = {r["name"]: r["id"] for r in rows}
    for b in base:
        ids.setdefault(b["name"], b["id"])
    tiers = {n: m["tier"] for n, m in meta.items()}
    for b in base[8:52]:
        tiers.setdefault(b["name"], base_tier(b))
    # structure checks: parents exist, none is stronger than its child, no loops
    for name, m in meta.items():
        for p in m["parents"]:
            if p not in ids:
                problems.append(f"{name}: parent {p} unknown")
            elif tiers.get(p, 0) > m["tier"]:
                problems.append(f"{name} (tier {m['tier']}) comes from stronger {p} (tier {tiers[p]})")

    def depth(n, seen=()):
        if n in seen:
            problems.append(f"loop at {n}")
            return 0
        ps = meta.get(n, {}).get("parents", [])
        return 1 + max((depth(p, seen + (n,)) for p in ps), default=0)

    for n in meta:
        depth(n)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1

    # the records appended to each of the eight lines
    kind_of = {"str": 1, "def": 2, "spt": 3, "wis": 4, "spd": 5}
    tree: dict[str, list[dict]] = {}
    for line in range(8):
        recs = []
        for name, m in sorted(meta.items(), key=lambda kv: kv[1]["id"]):
            T = TIERS[m["tier"]]
            on = line in m["affinity"]
            extra_lv = 0 if on else OFF_LINE_EXTRA_LEVEL
            parents = m["parents"][:2]
            r = {"to": m["id"], "req0": 0, "req0Level": 1, "req1": 0, "req1Level": 1, "kind": 0, "threshold": 0}
            if parents:
                r["req0"], r["req0Level"] = ids[parents[0]], T["parent_lv"] + extra_lv
                if len(parents) > 1:
                    r["req1"], r["req1Level"] = ids[parents[1]], T["parent_lv"] + extra_lv
                gate = m["gateValue"] if on else int(m["gateValue"] * OFF_LINE_GATE_FACTOR / 10) * 10
                r["kind"], r["threshold"] = kind_of[m["gateStat"]], min(gate, 32000)
            else:
                r["kind"], r["threshold"] = 7, T["root_lv"] + extra_lv
            recs.append(r)
        tree[str(line)] = recs

    (DATA / "extra_species.json").write_text(json.dumps({"digimon": rows, "tree": tree, "meta": meta}, separators=(",", ":")))
    (DATA / "extra_profiles.bin").write_bytes(b"".join(blobs))
    print(f"{len(rows)} extra species -> extra_species.json, extra_profiles.bin ({len(blobs) * 0x58} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
