#!/usr/bin/env python3
"""Make the enemy-only Digimon obtainable: derive their player forms from the disc's own enemy rows.

Reads (all already built from the disc by the other stages, none of it is committed):
  web/assets/data/enemies.json            stats, resistances, the enemy's own attack and specials, family
  web/assets/data/digimon.json            the 55 base species + the technique list (the form template)
  web/assets/data/digimon_profiles.bin    the disc's 55 profile rows (template bytes for the new rows)
  web/assets/data/fight_tech_table.json   per technique: element, power
  web/assets/battle/model_map.json        species -> model folder (the folder's number is the row's value0)
  web/assets/data/battlecmd/79.bin        the disc's English Digimon-name bank 0x4E (it already names every enemy)
  web/assets/data/evolutions.json         the disc's eight digivolution lines (donor gates for the new partners' lines)
and data/authored/web/assets/data/extra_species_canon.json (ours: fixed ids + canonical pre-evolutions)
and data/authored/web/assets/data/new_starters.json (ours: partners beyond the disc's eight, ids after the extras).

Writes
  web/assets/data/extra_species.json   {digimon: [rows in digimon.json's shape, ids 56..], tree: {line: [records]},
                                        meta: {name: {tier, family, affinity, parents}}, starters: [new partners]}
  web/assets/data/extra_profiles.bin   the same rows as 0x58-byte disc profile records (ids 56.. in order)

New partners (new_starters.json) are starter-shaped rows after the extras (is_starter, their own base stats, growth and
Blast forms) and each gets a whole line of its own in `tree` (roster slot 8..): its canonical forms at line level 5/20/40
like every disc starter's, then the donor line's gates for the disc's 44 forms (the donor's own champion/ultimate/mega
ten levels later, since every other gate hangs off them), then every enemy-only species. `starters` lists them for the engine (slot, id, charId, formId).

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
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "web/assets/data"
# Where extra_species.json / extra_profiles.bin are written (the default is the shared data folder; a scratch folder
# lets a variant be built and simulated without touching it).
OUT = Path(os.environ["EXTRA_SPECIES_OUT"]) if os.environ.get("EXTRA_SPECIES_OUT") else DATA
# Aspect routes (docs/aspect-system-plan.md): ASPECT_ROUTES=1 gives every form that has a parent a second unlock record,
# gated on an element bonus (the disc's own gate kinds 8..14) instead of a stat, and orders the whole table weakest tier first.
ASPECT_ROUTES = os.environ.get("ASPECT_ROUTES", "0") == "1"
# element bonus a fully committed player holds at the tier's intended level (planner: aspect-planner.html, Silver at Lv 10,
# 5 training points a level, the normal drills, the line's own passive growth); a line that does not suit the family needs 25% more
ELEMENT_GATE = {1: 110, 2: 150, 3: 200, 4: 290, 5: 350}
ELEMENT_GATE_ADDS_BASE = False   # measured: the live game counts the trained points only, so the gate leaves out the line's base tolerance
CANON = ROOT / "data/authored/web/assets/data/extra_species_canon.json"
NEW_STARTERS = ROOT / "data/authored/web/assets/data/new_starters.json"
DISC_LINES = 8

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


STATUS_KEYS = ("poison", "paralyze", "confuse", "sleep", "ko")
GROWTH_KEYS = ("str", "def", "spt", "wis", "spd", "chr")


def encode_starter(row: dict, template: bytes, form_id: int, name_idx: int, blasts: list[int]) -> bytes:
    """A starter row as the disc's 0x58-byte profile record (the layout of rows 0..7, checked against them)."""
    rec = bytearray(template)
    struct.pack_into("<H", rec, 0x00, form_id)
    for i, k in enumerate(GROWTH_KEYS):
        struct.pack_into("<H", rec, 0x02 + 2 * i, row[k])
    for i, k in enumerate(ELEMS):
        struct.pack_into("<H", rec, 0x0E + 2 * i, row["resistances"][k])
    struct.pack_into("<H", rec, 0x1C, row["tech_basic"])
    for i in range(5):
        struct.pack_into("<H", rec, 0x1E + 2 * i, 0)
    struct.pack_into("<H", rec, 0x28, row["tech_signature"])
    struct.pack_into("<H", rec, 0x2A, 0)
    for i, k in enumerate(STATUS_KEYS):
        rec[0x2C + i] = row["status_resist"][k]
    rec[0x31:0x3C] = bytes(11)
    rec[0x3C] = row.get("dv_cap", 100)
    rec[0x3D] = 0
    rec[0x3E] = row["growth_xp"]
    rec[0x3F] = row["hp"]
    rec[0x40] = row["mp"]
    rec[0x41] = row["growth"]["hp"]
    rec[0x42] = row["growth"]["mp"]
    for i, k in enumerate(GROWTH_KEYS):
        rec[0x43 + i] = row["growth"][k]
    for i, k in enumerate(ELEMS):
        rec[0x49 + i] = row["resistance_growth"][k]
    rec[0x50:0x55] = bytes(blasts)
    rec[0x55] = name_idx
    rec[0x56] = row["family"]
    rec[0x57] = 0
    return bytes(rec)


def own_line_record(r: dict) -> bool:
    """A line's own champion/ultimate/mega gate: no prerequisite, line level 5, 20 or 40."""
    return not r["req0"] and not r["req1"] and r["kind"] == 7 and r["threshold"] in (5, 20, 40)


def build_new_starters(ids, bank, profiles, base, extra_records, tree, problems, value_taken):
    """The partners beyond the disc's eight: rows, profile records and a line each (see the module doc)."""
    if not NEW_STARTERS.exists():
        return [], [], []
    authored = load(NEW_STARTERS)["starters"]
    lines = load(DATA / "evolutions.json")["lines"]
    # the encoder must reproduce the disc's own eight starter records byte for byte
    for i, b in enumerate(base[:DISC_LINES]):
        disc = profiles[0x58 * i: 0x58 * (i + 1)]
        got = encode_starter(b, disc, struct.unpack_from("<H", disc, 0)[0], disc[0x55], b["blasts"])
        if got != disc:
            problems.append(f"starter encoder does not reproduce {b['name']}'s disc record")
    out, rows, blobs = [], [], []
    next_id = max(ids.values()) + 1
    for k, st in enumerate(authored):
        sid, slot, name = st["id"], st["slot"], st["name"]
        if sid != next_id + k:
            problems.append(f"{name}: id {sid} is not {next_id + k} (new partners follow the extras in order)")
        if slot != DISC_LINES + k:
            problems.append(f"{name}: slot {slot} is not {DISC_LINES + k} (slots follow the disc's eight in order)")
        if st["formId"] in value_taken:
            problems.append(f"{name}: form id {st['formId']} is taken")
        value_taken.add(st["formId"])
        idx = bank.get(re.sub(r"[^A-Za-z]", "", st["model"]))
        if idx is None:
            problems.append(f"{name}: {st['model']} not in the name bank")
            continue
        stat_total = sum(st[k2] for k2 in STAT_KEYS)
        if stat_total != 200:
            problems.append(f"{name}: stat total {stat_total}, the disc's starters all have 200")
        if sum(st["resistances"].values()) != 680 or sum(st["resistance_growth"].values()) != 21:
            problems.append(f"{name}: resistances must sum 680 (growth 21) like the disc's starters")
        if sum(st["status_resist"].values()) != 150:
            problems.append(f"{name}: status resistances must sum 150 like the disc's starters")
        blasts = []
        for bn in st["blasts"]:
            if bn not in ids:
                problems.append(f"{name}: Blast form {bn} unknown")
            else:
                blasts.append(ids[bn])
        canon = []
        for cn, lv in st["canon"]:
            if cn not in ids:
                problems.append(f"{name}: canonical form {cn} unknown")
            else:
                canon.append((ids[cn], lv))
        if problems:
            continue
        row = {
            "id": sid, "name": name, "hp": st["hp"], "mp": st["mp"],
            **{k2: st[k2] for k2 in GROWTH_KEYS},
            "growth": st["growth"], "resistances": st["resistances"], "resistance_growth": st["resistance_growth"],
            "growth_xp": st["growth_xp"], "dv_cap": 100, "status_resist": st["status_resist"],
            "family": st["family"], "tech_basic": st["tech_basic"], "tech_signature": st["tech_signature"],
            "tech_dna_dv": 0, "tech_level_learn": [0] * 5, "tech_level_load": [0] * 5,
            "tech_slots": [0, 0, 0, 0, 0, st["tech_signature"]], "tech_learn_levels": [0] * 6,
            "tech_load_levels": [0] * 5, "blasts": blasts, "techs": [st["tech_basic"], st["tech_signature"]],
            "is_starter": True,
        }
        rows.append(row)
        blobs.append(encode_starter(row, profiles[0:0x58], st["formId"], idx, blasts))
        # never its own species as a form: a DemiDevimon does not digivolve into a DemiDevimon, and a form that
        # needs that species needs nothing more of this line than being it
        own = ids.get(st["model"])
        extras = []
        for r in extra_records(slot, tuple(st["families"])):
            if r["to"] == own:
                continue
            r = dict(r)
            if r["req1"] == own:
                r["req1"], r["req1Level"] = 0, 1
            if r["req0"] == own:
                r["req0"], r["req0Level"], r["req1"], r["req1Level"] = r["req1"], r["req1Level"], 0, 1
            extras.append(r)
        tree[str(slot)] = new_line_records(lines, st["donor_line"], canon, extras)
        out.append({"id": sid, "slot": slot, "name": name, "model": st["model"], "charId": st["charId"],
                    "formId": st["formId"], "bank": idx, "gearSlot": st.get("gear_line", st["donor_line"])})
    return out, rows, blobs


def new_line_records(lines, donor: int, canon: list, extras: list) -> list[dict]:
    """A new partner's whole line: its canonical forms first, then the disc's 44 on the donor's gates, then the extras."""
    disc = [dict(r) for r in lines[donor]["records"][:44]]
    for r in disc:
        # the donor's own champion/ultimate/mega are this line's roots too (every other gate hangs off them), but
        # they are not its own line: ten levels later than the donor's, so this line's canonical forms come first
        if own_line_record(r):
            r["threshold"] += OFF_LINE_EXTRA_LEVEL
    canon_ids = {cid for cid, _ in canon}
    head = [{"to": cid, "req0": 0, "req0Level": 1, "req1": 0, "req1Level": 1, "kind": 7, "threshold": lv}
            for cid, lv in canon]
    return head + [r for r in disc if r["to"] not in canon_ids] + [r for r in extras if r["to"] not in canon_ids]


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
        if sp.get("tier"):
            raw_tier[sp["name"]] = int(sp["tier"])
        elif e0:
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
        # the element it belongs to: its own attack's element (techs 2..8 are fire..dark), else its strongest resistance
        signature_element = ELEMS[element - 2] if 2 <= element <= 8 else max(ELEMS, key=lambda k: (res[k], -ELEMS.index(k)))
        meta[name] = {
            "id": sp["id"], "value0": value0, "tier": tier, "family": e["digimon_type"], "bank": idx, "element": signature_element,
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

    def extra_records(line: int, families: tuple = ()) -> list[dict]:
        recs = []
        for name, m in sorted(meta.items(), key=lambda kv: kv[1]["id"]):
            T = TIERS[m["tier"]]
            on = line in m["affinity"] or m["family"] in families
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
            if ASPECT_ROUTES and parents:
                # the element route: the same prerequisites, a gate on the form's own element bonus. A player who
                # trains that element reaches the form without the stat gate; any one passing record unlocks it.
                # The live game compares the TRAINED points only (tools/verify_aspect_route.mjs: a gate met only by adding the
                # line's own base tolerance does not unlock). ELEMENT_GATE_ADDS_BASE keeps the disc's native reading open
                # (base tolerance + trained points; engine/dw3/ui/native/fight-report-rewards.ts).
                trained = ELEMENT_GATE[m["tier"]] if on else int(ELEMENT_GATE[m["tier"]] * OFF_LINE_GATE_FACTOR / 10) * 10
                own_base = base[line]["resistances"][m["element"]] if (ELEMENT_GATE_ADDS_BASE and line < DISC_LINES) else 0
                recs.append({**r, "kind": 8 + ELEMS.index(m["element"]), "threshold": min(999, own_base + trained)})
        if ASPECT_ROUTES:
            # the unlock rule takes the first passing record in table order, one form per battle: weakest tier first
            tier_of_to = {m["id"]: m["tier"] for m in meta.values()}
            recs.sort(key=lambda r: (tier_of_to[r["to"]], r["to"], r["kind"] >= 8))
        return recs

    for line in range(DISC_LINES):
        tree[str(line)] = extra_records(line)

    starters, starter_rows, starter_blobs = build_new_starters(
        ids, bank, profiles, base, extra_records, tree, problems, value_taken=used_values)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    rows += starter_rows
    blobs += starter_blobs

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "extra_species.json").write_text(json.dumps(
        {"digimon": rows, "tree": tree, "meta": meta, "starters": starters}, separators=(",", ":")))
    (OUT / "extra_profiles.bin").write_bytes(b"".join(blobs))
    print(f"{len(rows)} extra species ({len(starters)} new partners) -> extra_species.json, extra_profiles.bin "
          f"({len(blobs) * 0x58} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
