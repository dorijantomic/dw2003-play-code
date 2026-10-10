#!/usr/bin/env python3
"""
Build web/assets/data/digimon.json from decoded game data.

Sources:
  ~/ddw3/data/digimon_profiles.toml          — HP/MP/stat/tech profiles (55 entries)
  ~/ddw3/lang_file/dw2003/eng/esdignam.toml  — Digimon names
  ~/ddw3/lang_file/dw2003/eng/essklnam.toml  — skill names (444 entries, 0=empty)
  ~/ddw3/lang_file/dw2003/eng/essklinf.toml  — skill descriptions
  ~/ddw3/rust/dw2003_exe_data/src/data.rs    — D0x80042bdc: 443 Unknown3 entries
                                               = real tech stat table (mp_cost, power, element)

Unknown3 field decode (cross-referenced with known skills — 2026-06-13 RE):
  f0: u16 = mp_cost
  f1: u16 = power (damage/heal amount base)
  f2: u8  = attack_category: 2=physical (uses STR/DEF), 3=magical (uses SPT/WIS), 4=support
             NOTE: f2 is NOT the element — see f4 below.
  f3: u8  = type (2=attack, 3=heal-self, 4=support/buff)
  f4: u16 = (element << 8) | target_type
             element high byte: 1=normal, 2=fire, 3=water, 4=ice, 5=wind, 6=thunder, 7=machine, 8=dark
             target low byte: 0x7f=enemy single, 0x6e=self, 0x64=multi-hit pattern
             Confirmed: Pepper Breath=0x027f(fire/enemy), Diamond Storm=0x047f(ice/enemy),
             Boom Bubble=0x057f(wind/enemy), Plasma Blade=0x067f(thunder/enemy)
  f5: u8  = special flags (0x20=status_chance, 0x40=aoe, 0x48=aoe+status)
  f6: u8  = effect type for buff/heal (1=none, 2=regen, 3=revive, 4=cure, 5=full_heal)
  f7: u8  = status applied to enemy (1=none, else = status id)
  f8/f9   = status chance values
  f10: u8 = animation index
  f11: u8 = hit count (if >1)
  f12: u8 = accuracy (0x39=57=normal, 0x40=64=high, 0x19=25=low)
  f13: u8 = sound/animation group
  f14: u8 = hits (1=single, 3=3-hit, 4=4-hit)

tech_basic skills (id 1–52, idx 0–51) are unnamed placeholder entries with:
  mp_cost=0, element=normal, type=attack. Power is tier-scaled:
  Rookies (1–8)=60, Champions (9–19)=100, some=130/160, Ultimates/Megas 160–400.
  These are included in output as "Fight_<DigimonName>" for use by battle.js.

Notes on HP stats:
  Rookies (id 1-8) have real stat_hp (130-180) and real growth rates.
  Champions+ (id 9-55) have stat_hp=1, growth_hp=1 — these are level-derived.
  For wild enemies we approximate champion HP = 80 + str * level.

Elemental resistances (stat_fire etc. in profiles):
  Values are damage-received multipliers × 100. 100=neutral, 60=resists(takes 60%), 130=weak(takes 130%).
  elemental_factor = stat / 100  (DIRECT multiplier — confirmed from TOML 2026-06-13).
  Confirmed: Agumon stat_fire=60 (fire-type, resists fire), stat_ice=130 (weak to ice).
  Also decoded: growth_fire..growth_dark — resistances grow per level by these amounts.
  Also decoded: res_poison..res_ko — status effect resistance values (u8).
"""

import os
import json
import re
from pathlib import Path

try:
    import tomllib
except ImportError:  # pragma: no cover - Python <3.11 fallback
    tomllib = None

try:
    import toml
except ImportError:  # pragma: no cover - stdlib path is preferred in CI/local
    toml = None

DDW3  = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
OUT   = Path(__file__).parent.parent / "web" / "assets" / "data" / "digimon.json"

# Element from f4 high byte (confirmed 2026-06-13 by cross-referencing known skill visuals)
ELEMENT_NAMES = {
    0: "normal",   # f4 high=0 → no element specified
    1: "normal",   # explicitly normal
    2: "fire",     # Pepper Breath (0x027f), Pyrosphere (0x027f)
    3: "water",    # inferred; no confirmed example yet
    4: "ice",      # Diamond Storm (0x047f), Frost Cutter (0x046e)
    5: "wind",     # Boom Bubble (0x057f), Whirlwind (0x056e)
    6: "thunder",  # Plasma Blade (0x067f), Electro Shocker (0x067f)
    7: "machine",  # inferred from context
    8: "dark",     # Grisly Wing (0x087f), NM Syndromer (0x087f)
}

ATTACK_CATEGORY = {
    2: "physical",  # uses STR for offense, DEF for defense
    3: "magical",   # uses SPT for offense, WIS for defense
    4: "support",   # buffs/heals
}

TECH_TYPE_NAMES = {
    2: "attack",
    3: "heal",
    4: "support",
}

# Secondary-effect type, decoded from tech-struct field f7 (2026-06-22). Each cluster is
# confirmed by every member skill's in-game description (e.g. all f7==8 skills say "drain HP";
# all f7==2 say "poison"). f8/f9 are the effect's params (proc-chance / magnitude / drain
# ratio, on a ~0..128 scale). Emitted as `effect` + `effect_p1`(f8) + `effect_p2`(f9).
EFFECT_TYPE_NAMES = {
    1:  "none",
    2:  "poison",         # Poison Bites, Venom Stab, Evil/Deadly Poison, Thorn Whipping
    3:  "paralyze",       # Spinal Tap, Brain Freeze, Stun/Paralyze Shock, T-Sword
    4:  "confuse",        # Panic/Confuse Stab, Confuse Gas/Nebula
    5:  "sleep",          # Hypno Gas/Nebula, Mugenhadou
    6:  "instant_death",  # Dimension Scissors, Soul Snatcher/Plunder ("destroy")
    8:  "drain",          # Touch of Evil, Energy Leech, Energy Drain (heal attacker)
    9:  "multihit",       # Lizard Dance, Justice Strike, rapid-blow / "multiple" skills
    10: "counter",        # Maul Attack, Counter Alert/Strike, Final Purification
    11: "precision",      # Swing Swing, Big Shot, Pinpoint Shot ("if it hits")
    12: "steal",          # Picking Claw, Snapping Claw ("steal items")
}


def load_toml(path: Path):
    if tomllib is not None:
        with path.open("rb") as fh:
            return tomllib.load(fh)
    if toml is not None:
        return toml.load(path)
    raise RuntimeError("No TOML parser available; need Python 3.11+ or the 'toml' package")


def parse_tech_stats(data_rs: Path) -> list[dict]:
    """
    Parse D0x80042bdc: [Unknown3; 443] from the Rust exe_data source.
    Returns list of 443 dicts with real mp_cost, power, element, etc.
    """
    src = data_rs.read_text()
    # Find the block — skip the type annotation "[Unknown3; 443]" and find "= ["
    start = src.index("D0x80042bdc")
    eq_pos = src.index("= [", start)
    block_start = eq_pos + 2  # position of the '[' in "= ["
    # Find matching closing bracket
    depth = 0
    i = block_start
    while i < len(src):
        if src[i] == "[":
            depth += 1
        elif src[i] == "]":
            depth -= 1
            if depth == 0:
                break
        i += 1
    block = src[block_start : i + 1]

    # Each entry: Unknown3 { f0: HEX, f1: HEX, ... }
    pattern = re.compile(
        r"Unknown3\s*\{\s*"
        r"f0:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f1:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f2:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f3:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f4:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f5:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f6:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f7:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f8:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f9:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f10:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f11:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f12:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f13:\s*(0x[0-9a-fA-F]+|\d+),\s*"
        r"f14:\s*(0x[0-9a-fA-F]+|\d+)\s*\}"
    )

    entries = []
    for m in pattern.finditer(block):
        f = [int(x, 16) if x.startswith("0x") else int(x) for x in m.groups()]
        element_id = (f[4] >> 8) & 0xff  # high byte of f4 encodes element
        entries.append({
            "mp_cost":        f[0],
            "power":          f[1],
            "attack_cat":     f[2],      # 2=physical, 3=magical, 4=support
            "type":           f[3],
            "target":         f[4] & 0xff,
            "element_id":     element_id,
            "flags":          f[5],
            "target_family":  f[6],      # raw skill +0x09, matched to defender profile +0x56
            "damage_scalar":  f[5],      # raw skill +0x08, used by magical crit roll
            "status":         f[7],      # secondary-effect TYPE id (see EFFECT_TYPE_NAMES)
            "effect_p1":      f[8],      # effect param 1 (proc-chance / magnitude)
            "effect_p2":      f[9],      # effect param 2 (magnitude / drain ratio, ~0..128)
            "acc":            f[12],
            "hits":           f[14],
            # Raw record byte +0x10, the action-script clip. The Multi-Crest
            # plain-attack gate skips the 3-hit diversion and the 0.4x stage when
            # it is 0x0b or 0x0c (F0x8009e0cc .L0x8009e24c / F0x8009f6dc
            # .L0x8009f88c), so the battle resolver has to be able to read it.
            "clip":           f[13],
        })

    return entries


def build_payload(ddw3: Path = DDW3) -> dict:
    profiles = load_toml(ddw3 / "data" / "digimon_profiles.toml")["profiles"]
    names    = load_toml(ddw3 / "lang_file/dw2003/eng/esdignam.toml")["strings"]
    sklnames = load_toml(ddw3 / "lang_file/dw2003/eng/essklnam.toml")["strings"]
    sklinfo  = load_toml(ddw3 / "lang_file/dw2003/eng/essklinf.toml")["strings"]

    tech_stats = parse_tech_stats(ddw3 / "rust/dw2003_exe_data/src/data.rs")

    def sklname(i):
        s = sklnames[i] if i < len(sklnames) else ""
        return s if s and s != "a" else None

    def sklinfo_(i):
        s = sklinfo[i] if i < len(sklinfo) else ""
        return s if s and s != "a" else None

    def tech_entry(skill_id):
        # Array index = skill_id - 1 (array is 0-indexed, skills are 1-indexed)
        idx = skill_id - 1
        if 0 <= idx < len(tech_stats):
            return tech_stats[idx]
        return None

    # Build skill table
    skill_ids_used = set()
    tech_basic_ids = set()
    for p in profiles:
        if p["tech_basic"]:
            skill_ids_used.add(p["tech_basic"])
            tech_basic_ids.add(p["tech_basic"])
        if p["tech_signature"]: skill_ids_used.add(p["tech_signature"])
        for t in p["techs"]:
            if t: skill_ids_used.add(t)

    # Enemy species use their OWN tech ids (sdigiedt `attack` = the basic-fight tech,
    # `move_1`/`move_2` = specials) that are absent from the 55 player profiles —
    # e.g. Triceramon attack 237 (contact sound type 64, the deep hit) or Zanbamon 393.
    # Without them battle.js resolves skillDB[attack] to undefined and the 3D fight
    # gets no tech id (wrong damage stats + generic/no contact sound + no hit effect).
    enemy_move_ids = set()
    enemies_path = Path(__file__).resolve().parent.parent / "web/assets/data/enemies.json"
    for e in json.loads(enemies_path.read_text())["enemies"]:
        if e.get("attack"):
            skill_ids_used.add(e["attack"])
            tech_basic_ids.add(e["attack"])   # basic-fight slot: unnamed, shows "X attacks!"
        for mv in (e.get("move_1"), e.get("move_2")):
            if mv:
                skill_ids_used.add(mv)
                enemy_move_ids.add(mv)    # keep even when unnamed (e.g. Galacticmon3 438)

    skills = []
    for sid in sorted(skill_ids_used):
        nm = sklname(sid)
        is_basic = sid in tech_basic_ids
        # Include tech_basic slots and enemy moves even without a name — they carry
        # the real stat/element/contact data the fight needs.
        if not nm and not is_basic and sid not in enemy_move_ids:
            continue
        ts = tech_entry(sid)
        entry = {
            "id":      sid,
            "name":    nm if nm else "Fight",
            "desc":    sklinfo_(sid) or "",
        }
        if is_basic:
            entry["tech_basic"] = True
        if ts:
            entry["mp_cost"]        = ts["mp_cost"]
            entry["power"]          = ts["power"]
            entry["element"]        = ELEMENT_NAMES.get(ts["element_id"], "normal")
            entry["attack_category"] = ATTACK_CATEGORY.get(ts["attack_cat"], "physical")
            # The RAW byte as well as the name. The status screen's technique
            # badge is cmfont clip 0x37 + this byte (F0x800895c8.c:60 draws
            # `((tech_id - 1) * 0x12 + 0x80042BDC)->unk4 + 0x37`), and the byte
            # takes five values across all 443 records (2..6) -- more than
            # ATTACK_CATEGORY names, so the name cannot stand in for it.
            entry["attack_cat"] = ts["attack_cat"]
            entry["type"]           = TECH_TYPE_NAMES.get(ts["type"], "attack")
            entry["target_family"]  = ts["target_family"]
            entry["damage_scalar"]  = ts["damage_scalar"]
            entry["hits"]           = ts["hits"] if ts["hits"] > 0 else 1
            entry["clip"]           = ts["clip"]
            # Secondary effect (poison/paralyze/confuse/sleep/drain/multihit/…) + its params.
            eff = EFFECT_TYPE_NAMES.get(ts["status"], "none")
            if eff != "none":
                entry["effect"]    = eff
                entry["effect_p1"] = ts["effect_p1"]
                entry["effect_p2"] = ts["effect_p2"]
        else:
            entry["mp_cost"]         = 0
            entry["power"]           = 60
            entry["element"]         = "normal"
            entry["attack_category"] = "physical"
            entry["attack_cat"]      = 2
            entry["type"]            = "attack"
            entry["hits"]            = 1
        skills.append(entry)

    # Build Digimon table
    digimon = []
    for p in profiles:
        idx  = p["this"]
        name = names[idx] if idx < len(names) else f"Digimon{idx}"
        tech_ids = []
        if p["tech_basic"]:     tech_ids.append(p["tech_basic"])
        if p["tech_signature"]: tech_ids.append(p["tech_signature"])
        for t in p["techs"]:
            if t and t not in tech_ids: tech_ids.append(t)

        is_starter = (1 <= idx <= 8)
        digimon.append({
            "id":   idx,
            "name": name,
            "hp":   p["stat_hp"],
            "mp":   p["stat_mp"],
            "str":  p["stat_str"],
            "def":  p["stat_def"],
            "spt":  p["stat_spt"],
            "wis":  p["stat_wis"],
            "spd":  p["stat_spd"],
            "chr":  p["stat_chr"],
            "growth": {
                "hp":       p["growth_hp"],
                "mp":       p["growth_mp"],
                "str":      p["growth_str"],
                "def":      p["growth_def"],
                "spt":      p["growth_spt"],
                "wis":      p["growth_wis"],
                "spd":      p["growth_spd"],
                "chr":      p["growth_chr"],
            },
            # Elemental damage-received multipliers ×100 (100=neutral, 60=resists 60%, 130=weak 130%).
            # factor = stat/100. Confirmed: Agumon fire=60 (resists), ice=130 (weak).
            "resistances": {
                "fire":    p["stat_fire"],
                "water":   p["stat_water"],
                "ice":     p["stat_ice"],
                "wind":    p["stat_wind"],
                "thunder": p["stat_thunder"],
                "machine": p["stat_machine"],
                "dark":    p["stat_dark"],
            },
            # Resistance growth per level (add to base per level-1)
            "resistance_growth": {
                "fire":    p["growth_fire"],
                "water":   p["growth_water"],
                "ice":     p["growth_ice"],
                "wind":    p["growth_wind"],
                "thunder": p["growth_thunder"],
                "machine": p["growth_machine"],
                "dark":    p["growth_dark"],
            },
            "growth_xp":      p["growth_xp"],
            # DV-level cap (profile byte +0x3c = unknown1[0]): below it DVEXP gains cap
            # at 10/battle and the ladder step is 10/level; at/past it 50/battle, 50/level
            # (stfgtrep 0x80086924 / 0x800865c0).
            "dv_cap":         p["unknown1"][0],
            # Status effect resistance (0=no resist, higher=more resistant)
            "status_resist": {
                "poison":   p["res_poison"],
                "paralyze": p["res_paralyze"],
                "confuse":  p["res_confuse"],
                "sleep":    p["res_sleep"],
                "ko":       p["res_ko"],
            },
            # Raw profile byte +0x56, copied into effective +0x25 for the
            # player-side magical target-family bonus.
            "family":         p["unknown2"][0],
            "tech_basic":     p["tech_basic"] or None,
            "tech_signature": p["tech_signature"] or None,
            "tech_dna_dv":    p["tech_dna_dv"],
            "tech_level_learn": list(p["tech_level_learn"]),
            "tech_level_load":  list(p["tech_level_load"]),
            # The disc's own six technique slots and their gate bytes, aligned to
            # the ledger. The extraction's label files SHIFT the boundary bytes
            # (docs/research/battle/digivolution-tech-system-decoded-2026-07-11.md
            # §4): the six LEARN gates are profile +0x31..+0x36 -- five ordinary
            # techniques then the signature's own gate, which the label files call
            # tech_level_load[0]; the five non-signature LOAD gates are profile
            # +0x37..+0x3b -- the label files' tech_level_load[1..4] then
            # unknown0[0]. Emitted aligned so no consumer re-derives the shift or
            # compacts the six slots (which drops an empty slot and slides the
            # signature down onto a zero gate).
            "tech_slots":        [int(t) for t in p["techs"]] + [int(p["tech_signature"])],
            "tech_learn_levels": [int(x) for x in p["tech_level_learn"]] + [int(p["tech_level_load"][0])],
            "tech_load_levels":  [int(x) for x in p["tech_level_load"][1:]] + [int(p["unknown0"][0])],
            "blasts":           list(p["blasts"]),
            "techs":          tech_ids,
            "is_starter":     is_starter,
        })

    return {"digimon": digimon, "skills": skills}


def main():
    out = build_payload()
    OUT.write_text(json.dumps(out, indent=2) + "\n")
    print(f"Prepared {len(out['skills'])} battle skill rows from decoded profile + tech data")
    print(f"Wrote {len(out['digimon'])} digimon + {len(out['skills'])} skills → {OUT}")

    # Print sample to verify
    skill_map = {s["id"]: s for s in out["skills"]}
    print("\nStarter signatures:")
    for d in out["digimon"][:8]:
        sig_id = d["tech_signature"]
        s = skill_map.get(sig_id, {})
        print(f"  [{d['id']}] {d['name']}: {s.get('name','?')} "
              f"MP={s.get('mp_cost','?')} PWR={s.get('power','?')} "
              f"elem={s.get('element','?')} type={s.get('type','?')}")


if __name__ == "__main__":
    main()
