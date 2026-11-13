#!/usr/bin/env python3
"""Battle data for a Fusion Lab fusion (dev tool, used by tools/fusion_lab_server.py).

A fusion is a base Digimon with parts (head, arms, tail, wings, legs) taken from donors.
This module works out how it fights and, for a saved favourite, writes a boss record the
game can load. Everything it reads is disc-derived and stays private; everything it writes
goes only to the git-ignored web/assets/data/fusion_lab_bosses.json.

  stats          per stat: the largest value among the base and the donors + 0.25 x the second
                 largest (web/fusion.js blendValues; with two Digimon this is the original
                 max + 0.25 x min rule exactly). Rows are enemies.json rows.
  kept from base resistances, status resists, family (digimon_type), drop: the base's row,
                 as web/battle.js fuseIntoBoss keeps them.
  attacks        the base's Fight + two specials (enemies.json attack / move_1 / move_2). Each
                 technique is tied to a body part by ~/dw3-knowledge/moves.json `emitter`
                 (mouth/head/eyes = head, arms = arms, tail, wings; self / whole-body / chest /
                 back stay with the whole body). A swapped part's techniques come from the
                 donor; the technique plays on the base model's clip slot of the same number.
  who may fuse   not one of the 8 evolution-line roots (the rookies); and, for a species that HAS an enemies.json
                 row, not the lowest stat-total tier of tools/build_extra_species.py (tier_of, tier 1).
  variant model  a model whose name is another model of the same Digimon ("MetalGreymon2" = MetalGreymon, found by
                 variant_of()) takes that species' stats: its enemies.json row, or its form row when it has none.
  no enemy row   (the partner forms: Greymon, WarGreymon, Angemon, Beelzemon ...) stats = digimon.json /
                 extra_species.json base + growth x (level - 1) (docs/research/battle/battle-system.md "Stat scaling
                 formula"), at the level form_levels() works out from evolutions.json (rule in that function), then SCALED
                 to enemy size: the stat TOTAL becomes the median total of the enemies.json rows of the same stage
                 (stage_medians()), split by the form's own base + growth shares. enemies.json rows are untouched.
                 Fight = tech_basic, special 1 = tech_signature, special 2 empty (the form row's own fields).
  boss record    level = highest level any part's Digimon is met at in field_encounters.json (a part with no enemy
                 row: its form level above), HP = the parts' strongest-screen HP added (the original two-screen add
                 rule; a part with no enemy row: web/battle.js enemyHp, max(30, round(str x 2.5 + level x 5)) at its
                 level), stat scale = the highest of those screens' stat_scale (a part with no screen: 16 = identity).
"""
import json
import math
import os
import re
import sys
import time

HOME = os.path.expanduser("~")
ROOT = HOME + "/dw2003-play-integration"
GAME = ROOT + "/web/assets"
DATA = GAME + "/data"
MODELS = GAME + "/battle/models"
FUS = HOME + "/dw3-fusion"
MOVES = HOME + "/dw3-knowledge/moves.json"          # research data: read at run time only, never copied into a repo
BOSS_FILE = DATA + "/fusion_lab_bosses.json"        # private: web/assets is git-ignored

sys.path.insert(0, ROOT + "/tools")
import build_extra_species as bes                   # noqa: E402  (tier_of, base_tier, STAT_KEYS: the tier rule already in use)

KINDS = ("arms", "legs", "head", "tail", "wings")
STATS = bes.STAT_KEYS                               # str def spt wis spd
SLOTS = ("attack", "move_1", "move_2")
SLOT_WORDS = {"attack": "Fight (basic attack)", "move_1": "special 1", "move_2": "special 2"}
GROUP_OF = {
    "mouth": "head", "head": "head", "eyes": "head",
    "both-arms": "arms", "right-arm": "arms", "left-arm": "arms", "arms-unspecified": "arms",
    "tail": "tail", "wings": "wings",
    "self": "body", "whole-body": "body", "chest": "body", "back": "body",
}
GROUP_WORDS = {"head": "mouth/head", "arms": "arm", "tail": "tail", "wings": "wing"}
LAB_ID_RE = re.compile(r"^m[0-9]{3}[a-z0-9_]+$")
_cache = {}


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def cached(path, default=None):
    """JSON file, re-read only when it changes."""
    try:
        m = os.path.getmtime(path)
    except OSError:
        return default
    hit = _cache.get(path)
    if hit and hit[0] == m:
        return hit[1]
    v = read_json(path, default)
    _cache[path] = (m, v)
    return v


def model_map():
    return cached(GAME + "/battle/model_map.json", {})


def enemies():
    return {r["enemy_id"]: r for r in (cached(DATA + "/enemies.json", {}) or {}).get("enemies", [])}


def names_of(folder):
    return [n for n, f in model_map().items() if f == folder]


def enemy_name_of(folder):
    en = enemies()
    for n in names_of(folder):
        if n in en and n != "Null":
            return n
    return None


def rookie_names():
    """The 8 evolution-line roots of evolutions.json (names from digimon.json)."""
    names = {x["id"]: x["name"] for x in (cached(DATA + "/digimon.json", {}) or {}).get("digimon", [])}
    lines = (cached(DATA + "/evolutions.json", {}) or {}).get("lines", [])
    src = {l["digimonId"] for l in lines}
    to = {r["to"] for l in lines for r in l["records"]}
    return {names[i] for i in (src - to) if i in names}


def is_fusion_folder(folder):
    if folder in set(model_map().values()):
        return False
    return bool((read_json("%s/%s/build_info.json" % (FUS, folder), {}) or {}).get("base"))


def moves_species(folder):
    return ((cached(MOVES, {}) or {}).get("species") or {}).get(folder)


# ---- partner forms: stats and level when there is no enemies.json row ------------------

EXTRA_FILE = DATA + "/extra_species.json"
ELEMS = bes.ELEMS


def form_table():
    """name -> (profile row, file) from digimon.json, then extra_species.json (the first wins)."""
    out = {}
    for fname, path in (("digimon.json", DATA + "/digimon.json"), ("extra_species.json", EXTRA_FILE)):
        for x in (cached(path, {}) or {}).get("digimon", []):
            out.setdefault(x["name"], (x, fname))
    return out


ANATOMY = HOME + "/scratch-research/anatomy/anatomy.json"      # research data, read at run time only, never copied into a repo
# Two Imperialdramon models are named for their mode; digimon.json names the same Digimon "-F" / "-P". anatomy.json's
# canonicalName of the models is "Imperialdramon: Fighter Mode" / "Imperialdramon: Paladin Mode".
MODE_ALIASES = {"ImperialdramonFM": "Imperialdramon-F", "ImperialdramonPM": "Imperialdramon-P"}


def anatomy_rows():
    return cached(ANATOMY, []) or []


def has_stats_name(n):
    return n in enemies() or n in form_table()


def variant_of(folder):
    """(species name, rule in words) when this model is another model of a Digimon that has a stats source, else None.
    Only used when none of the model's own names has an enemies.json row or a profile. Patterns found in model_map.json:
      1. trailing number      "MetalGreymon2" -> "MetalGreymon" (Kyukimon2, MagnaAngemon2, MetalGreymon2, Taomon2, Armormon2,
                              GrapLeomon2, Paildramon2, WarGrowlmon2; Numemon2..6 style names already have their own rows)
      2. same canonical name  anatomy.json gives the model the same canonicalName as a record that has a Digimon id
                              ("BKWarGreymon" and "BKWayGreymon" are both "BlackWarGreymon")
      3. mode suffix          ImperialdramonFM / PM = digimon.json Imperialdramon-F / -P (MODE_ALIASES)"""
    names = [n for n in names_of(folder) if n != "Null"]
    if any(has_stats_name(n) for n in names):
        return None
    for n in names:
        base = re.sub(r"[0-9]+$", "", n)
        if base != n and has_stats_name(base):
            return base, "%s is %s plus a number: the same Digimon, another model" % (n, base)
    recs = anatomy_rows()
    for r in recs:
        if r.get("folder") == folder and r.get("canonicalName"):
            for o in recs:
                if o.get("canonicalName") == r["canonicalName"] and o.get("id") is not None and o.get("name") not in names \
                        and has_stats_name(o["name"]):
                    return o["name"], "anatomy.json gives both the same canonical name (%s): the same Digimon, another model" % r["canonicalName"]
    for n in names:
        if MODE_ALIASES.get(n) and has_stats_name(MODE_ALIASES[n]):
            return MODE_ALIASES[n], "%s is digimon.json's %s (Fighter / Paladin Mode)" % (n, MODE_ALIASES[n])
    return None


def stage_of_level(L):
    """Stage of a form from its level: the rookie levels that unlock the stages are 5 = champion, 20 = ultimate, 40 = mega
    (docs/research/reference/dw3-systems-reference.md, method.tiers; the same gates are the kind-7 records form_levels() reads)."""
    return "champion" if L < 20 else ("ultimate" if L < 40 else "mega")


_stage_memo = {}


def stage_medians():
    """{stage: (median stat total, number of enemies.json rows)} over the enemies.json rows whose Digimon has a form level in
    form_levels() (digimon.json + extra_species.json = the evolution lines). Line roots (rookies) have no level: left out."""
    key = tuple(os.path.getmtime(f) if os.path.exists(f) else 0 for f in (DATA + "/enemies.json", DATA + "/evolutions.json", EXTRA_FILE))
    if _stage_memo.get("key") == key:
        return _stage_memo["val"]
    ft, lv = form_table(), form_levels()["level"]
    tot = {}
    for n, row in enemies().items():
        if n == "Null" or n not in ft:
            continue
        l = lv.get(ft[n][0]["id"])
        if l is None or l[0] is None:
            continue
        tot.setdefault(stage_of_level(l[0]), []).append(sum(row[k] for k in STATS))
    val = {}
    for st, v in tot.items():
        v.sort()
        m = len(v) // 2
        val[st] = ((v[m] if len(v) % 2 else (v[m - 1] + v[m]) / 2.0), len(v))
    _stage_memo["key"] = key; _stage_memo["val"] = val
    return val


_lv_memo = {}


def form_levels():
    """{"level": {digimon id: (level, how)}, "roots": {ids}} worked out from evolutions.json (+ the extra species' tree).

    The game's data has no level per Digimon, so the level of a form is read from where it sits in the evolution lines:
      * a line root (a digimonId of a line that no record leads to: the 8 starters) is a rookie: no level, never fused;
      * a record with no source form and kind 7 is the "rookie's own level" gate: the form is reached when the rookie
        is at level `threshold` (5, 20 or 40 in the disc's lines). Level = that threshold;
      * a record with source forms needs them at levels (req0Level, req1Level): level = the highest of the sources'
        own levels and those required levels;
      * the form's level is the LOWEST such value over all its records in all 8 lines (the earliest the game lets
        the form exist). Unreachable forms get no level.
    """
    key = tuple(os.path.getmtime(f) if os.path.exists(f) else 0 for f in (DATA + "/evolutions.json", EXTRA_FILE))
    if _lv_memo.get("key") == key:
        return _lv_memo["val"]
    lines = (cached(DATA + "/evolutions.json", {}) or {}).get("lines", [])
    recs = [r for l in lines for r in l["records"]]
    for rl in ((cached(EXTRA_FILE, {}) or {}).get("tree") or {}).values():
        recs += list(rl)
    roots = {l["digimonId"] for l in lines} - {r["to"] for l in lines for r in l["records"]}
    lv = {i: (None, "line root (rookie)") for i in roots}
    changed = True
    while changed:
        changed = False
        for r in recs:
            if r["to"] in roots:
                continue
            src = [x for x in (r.get("req0"), r.get("req1")) if x]
            if not src:
                if r.get("kind") != 7:
                    continue
                cand = (int(r["threshold"]), "rookie-level gate (kind 7, no source form): the rookie must be level %d" % r["threshold"])
            else:
                if any(x not in lv for x in src):
                    continue
                levels = [lv[x][0] or 1 for x in src]
                reqs = [r["req0Level"] if r.get("req0") else 1, r["req1Level"] if r.get("req1") else 1]
                n = max(levels + reqs)
                cand = (n, "needs source form(s) %s at form level %s, whose own levels are %s: the highest of both, %d"
                        % (src, [q for q in reqs if q > 1] or reqs[:1], levels, n))
            old = lv.get(r["to"])
            if old is None or cand[0] < old[0]:
                lv[r["to"]] = cand; changed = True
    val = {"level": lv, "roots": roots}
    _lv_memo["key"] = key; _lv_memo["val"] = val
    return val


def fallback_hp(strength, level):
    """web/battle.js enemyHp: max(30, round(str x 2.5 + level x 5)) (the wild-enemy formula, used when no encounter gives a real HP)."""
    return max(30, int(math.floor(strength * 2.5 + level * 5 + 0.5)))


def fallback_mp(spirit, level):
    """web/battle.js enemyMp: max(10, round(spt x 1.5 + level x 3))."""
    return max(10, int(math.floor(spirit * 1.5 + level * 3 + 0.5)))


def form_row(name):
    """A battle row for a Digimon that has no enemies.json row, or None (no profile, or no level in the lines).

    Keys like an enemies.json row (str def spt wis spd, resistances, status_resist, digimon_type, attack, move_1, move_2,
    drop_item, drop_rate) plus "_form": where every number came from."""
    hit = form_table().get(name)
    if not hit:
        return None
    f, fname = hit
    lvl = form_levels()["level"].get(f["id"])
    if lvl is None or lvl[0] is None:
        return None
    L = lvl[0]
    raw = {k: f[k] + f["growth"][k] * (L - 1) for k in STATS}
    stage = stage_of_level(L)
    med = stage_medians().get(stage)
    raw_total = sum(raw.values())
    if med and raw_total > 0:
        row = {k: int(math.floor(raw[k] * med[0] / raw_total + 0.5)) for k in STATS}
    else:
        row = dict(raw); med = None
    row["resistances"] = {e: f["resistances"][e] + f["resistance_growth"][e] * (L - 1) for e in ELEMS}
    row["status_resist"] = dict(f["status_resist"])
    row["digimon_type"] = f["family"]
    row["drop_item"] = 0; row["drop_rate"] = 0
    row["attack"] = f.get("tech_basic") or 0; row["move_1"] = f.get("tech_signature") or 0; row["move_2"] = 0
    row["_form"] = {
        "name": name, "id": f["id"], "level": L, "file": fname, "level_rule": lvl[1],
        "stage": stage, "stage_median": med[0] if med else None, "stage_rows": med[1] if med else 0, "raw_total": raw_total,
        "stats": {k: ("%d = %d x %g / %d (own %d = %d + %d x (%d - 1); own total %d, stage median %g)"
                      % (row[k], raw[k], med[0], raw_total, raw[k], f[k], f["growth"][k], L, raw_total, med[0]))
                  if med else "%d = %d + %d x (%d - 1)" % (row[k], f[k], f["growth"][k], L) for k in STATS},
        "hp": fallback_hp(row["str"], L), "mp": fallback_mp(row["spt"], L),
    }
    return row


# ---- who may fuse ---------------------------------------------------------------------

def species_block(folder):
    """Why this species may not be fused, or None. Line roots always; the tier-1 rule only with an enemy row."""
    names = names_of(folder)
    vr = variant_of(folder)
    if vr:                          # another model of a Digimon: its rules are that Digimon's
        names = names + [vr[0]]
    rk = rookie_names()
    hit = [n for n in names if n in rk]
    if hit:
        return ("blocked by the line-root rule: %s is one of the %d evolution-line roots in evolutions.json "
                "(the rookies)." % (hit[0], len(rk)))
    en = enemies()
    for n in names:
        if n in en and n != "Null":
            total = sum(en[n][k] for k in STATS)
            if bes.tier_of(total) == 1:
                return ("blocked by the lowest-tier rule: %s has an enemy stat total of %d, below %d = tier 1, the "
                        "lowest tier tools/build_extra_species.py uses (rookie-like)." % (n, total, bes.TIER_CUTS[0][0]))
            return None
    forms = form_table()
    for n in names:
        if n in forms:     # no enemy row: a partner form. Only a true rookie is blocked; the form needs a level from the lines.
            lvl = form_levels()["level"].get(forms[n][0]["id"])
            if lvl is None or lvl[0] is None:
                return "blocked: %s has no enemies.json row and no level could be read from evolutions.json (no record leads to it)." % n
            return None
    return None


def folder_block(folder):
    """Same for a species or an earlier fusion (any of its parts blocked = blocked)."""
    if is_fusion_folder(folder):
        for p in node(folder)["participants"]:
            r = species_block(p["folder"])
            if r:
                return "%s (a part of %s)" % (r, folder)
        return None
    return species_block(folder)


# ---- one Digimon's moves --------------------------------------------------------------

def species_node(folder):
    name = enemy_name_of(folder)
    row = enemies().get(name) if name else None
    label = name or (names_of(folder) or [folder])[0]
    variant = None
    if not row:
        for n in names_of(folder):
            fr = form_row(n)
            if fr:
                row, label = fr, n
                break
    if not row:
        vr = variant_of(folder)
        if vr:
            sp, rule = vr
            row = enemies().get(sp) or form_row(sp)
            if row:
                label = (names_of(folder) or [folder])[0]
                variant = {"species": sp, "rule": rule, "enemy": sp if sp in enemies() else None}
                name = variant["enemy"]
    ms = moves_species(folder) or {}
    tech = {t["id"]: t for t in ms.get("techniques", [])}
    if variant:     # the species' own model may list techniques this model's moves.json does not
        sf = model_map().get(variant["species"])
        for t in ((moves_species(sf) or {}).get("techniques", []) if sf else []):
            tech.setdefault(t["id"], t)
    moves = []
    if row:
        for slot in SLOTS:
            tid = int(row.get(slot) or 0)
            if not tid:
                continue
            t = tech.get(tid)
            em = (t or {}).get("emitter") or "unknown"
            moves.append({
                "slot": slot, "id": tid, "name": (t or {}).get("name") or "technique %d" % tid,
                "emitter": em, "group": GROUP_OF.get(em, "unknown"),
                "clip": (t or {}).get("clip"), "slot_kind": (t or {}).get("slot_kind"),
                "from": label, "origin": "base", "reason": "",
                "flags": [] if t else ["emitter unknown: not listed in moves.json for this Digimon"],
            })
    return {"folder": folder, "root": folder, "label": label, "base_row": row,
            "participants": [{"folder": folder, "name": label, "enemy": name, "row": row, "variant": variant}], "moves": moves, "notes": []}


def node(folder):
    if not is_fusion_folder(folder):
        return species_node(folder)
    info = read_json("%s/%s/build_info.json" % (FUS, folder), {})
    ops = [{"part": o.get("kind"), "donor": os.path.basename(os.path.dirname(o.get("donor_path", ""))) or o.get("donor")}
           for o in info.get("ops", [])]
    r = compute_node(info.get("base"), ops)
    r["folder"] = folder
    return r


def compute_node(base, ops):
    """The fusion of `base` with the donors of `ops` ([{part, donor}], the last op of a kind wins)."""
    bn = node(base)
    label = bn["label"]
    moves = [dict(m, origin="base", reason="the base's own technique (%s)" % SLOT_WORDS[m["slot"]]) for m in bn["moves"]]
    parts = list(bn["participants"])
    notes = list(bn.get("notes", []))
    swapped = {}
    for o in ops:
        if o.get("part") in KINDS:
            swapped[o["part"]] = o["donor"]
    for kind in KINDS:
        if kind not in swapped:
            continue
        dn = node(swapped[kind])
        for p in dn["participants"]:
            if all(q["folder"] != p["folder"] for q in parts):
                parts.append(p)
        if kind == "legs":
            notes.append("legs from %s: no technique in moves.json is fired from the legs, so no move changes." % dn["label"])
            continue
        gw = GROUP_WORDS[kind]
        for m in dn["moves"]:
            if m["group"] == "unknown":
                notes.append("%s's %s (id %d) has an unknown emitter: not carried over." % (dn["label"], m["name"], m["id"]))
        cands = [m for m in dn["moves"] if m["group"] == kind and all(m["id"] != x["id"] for x in moves)]
        had = [i for i, m in enumerate(moves) if m["group"] == kind and m["origin"] == "base"]
        if not had and not cands:
            notes.append("%s from %s: neither has a %s technique, so no move changes." % (kind, dn["label"], gw))
        for i in had:
            old = moves[i]
            pick = next((c for c in cands if (c["slot"] == "attack") == (old["slot"] == "attack")), None)
            if pick is None and cands:
                pick = cands[0]
            if pick is None:
                moves[i] = dict(old, reason="kept the base's %s: %s has no %s technique to put in its place, although the %s "
                                "now come from %s" % (old["name"], dn["label"], gw, kind, dn["label"]))
                continue
            cands.remove(pick)
            moves[i] = dict(pick, slot=old["slot"], origin="donor", reason=(
                "%s's %s technique (emitter %s), because the %s now come from %s; it replaces the base's %s and "
                "keeps the base's %s slot" % (dn["label"], gw, pick["emitter"], kind, dn["label"], old["name"], SLOT_WORDS[old["slot"]])))
        used = {m["slot"] for m in moves}
        for c in cands:
            free = [s for s in ("move_1", "move_2") if s not in used]
            if free:
                used.add(free[0])
                moves.append(dict(c, slot=free[0], origin="donor", reason=(
                    "%s's %s technique (emitter %s), added in the free %s: the %s now come from %s"
                    % (dn["label"], gw, c["emitter"], SLOT_WORDS[free[0]], kind, dn["label"]))))
            else:
                notes.append("%s's %s (id %d, %s) was left out: a Digimon has only Fight and two special slots."
                             % (dn["label"], c["name"], c["id"], gw))
    for m in moves:
        if m["emitter"] == "unknown" and not any(f.startswith("emitter unknown") for f in m["flags"]):
            m["flags"] = m["flags"] + ["emitter unknown: cannot tell whether a swapped part fires it"]
    moves.sort(key=lambda m: SLOTS.index(m["slot"]))
    return {"folder": None, "root": bn["root"], "label": label, "participants": parts, "moves": moves, "notes": notes,
            "base_row": bn["base_row"]}


# ---- numbers --------------------------------------------------------------------------

def blend(values):
    """web/fusion.js blendValues: round(max + 0.25 * second largest)."""
    v = sorted(values, reverse=True)
    return int(math.floor((v[0] if v else 0) + 0.25 * (v[1] if len(v) > 1 else 0) + 0.5))


def part_tag(p):
    """Name of a part in the stats lines, with its source when it is not the part's own enemies.json row."""
    f = (p["row"] or {}).get("_form")
    v = p.get("variant")
    tag = p["name"] + (" [stats from %s]" % v["species"] if v else "")
    return "%s [form row, level %d]" % (tag, f["level"]) if f else tag


def sources_of(parts):
    """Per part: where its numbers come from, in plain words (shown on the page)."""
    out = []
    for p in parts:
        f = (p["row"] or {}).get("_form")
        v = p.get("variant")
        pre = ("%s: stats from %s (same Digimon, other model). %s. " % (p["name"], v["species"], v["rule"])) if v else ""
        if f:
            if f.get("stage_median"):
                how = ("No enemies.json row, so %s's own base + growth x (level - 1) at level %d gives the shares (total %d), "
                       "scaled to the median total %g of the %d enemies.json rows of the %s stage (level rule: %s)."
                       % (f["name"], f["level"], f["raw_total"], f["stage_median"], f["stage_rows"], f["stage"], f["level_rule"]))
            else:
                how = ("Stats from %s: base + growth x (level - 1) at level %d (no enemy rows of the %s stage to scale to). Level rule: %s."
                       % (f["file"], f["level"], f["stage"], f["level_rule"]))
            out.append({"name": p["name"], "kind": "variant" if v else "form",
                        "text": pre + ("%s has no enemies.json row. " % v["species"] if v else "%s: " % p["name"]) + how,
                        "stats": ["%s: %s" % (k, x) for k, x in f["stats"].items()]})
        elif p["row"]:
            out.append({"name": p["name"], "kind": "variant" if v else "enemy",
                        "text": pre + ("Stats from the enemies.json row of %s." % v["species"] if v else "%s: stats from its enemies.json row." % p["name"]),
                        "stats": []})
        else:
            out.append({"name": p["name"], "kind": "none", "text": "%s: no stats source (no enemies.json row, no level in evolutions.json, not a variant of a Digimon that has either)." % p["name"], "stats": []})
    return out


def stats_of(parts):
    out = {}
    for k in STATS:
        ranked = sorted([(p["row"][k], i, part_tag(p)) for i, p in enumerate(parts)], key=lambda t: (-t[0], t[1]))
        top = ranked[0]
        sec = ranked[1] if len(ranked) > 1 else None
        v = blend([t[0] for t in ranked])
        text = "%d (%s)" % (top[0], top[2])
        if sec:
            text += " + 1/4 of %d (%s)" % (sec[0], sec[2])
        out[k] = {"value": v, "top": {"name": top[2], "value": top[0]},
                  "second": {"name": sec[2], "value": sec[0]} if sec else None,
                  "text": "%s = %d" % (text, v)}
    return out


def strongest_entry(name):
    best = None
    for sid, party in ((cached(DATA + "/field_encounters.json", {}) or {}).get("screens") or {}).items():
        for e in party:
            if e.get("name") == name and (best is None or (e["level"], e["hp"]) > (best["level"], best["hp"])):
                best = dict(e, screen=int(sid))
    return best


def part_entry(p):
    """The encounter entry a part counts as: its strongest field_encounters screen, or for a part with no enemy row its
    form level, the web/battle.js fallback HP/MP at that level and stat scale 16 (identity)."""
    f = (p["row"] or {}).get("_form")
    if f:
        return {"id": f["id"], "level": f["level"], "hp": f["hp"], "mp": f["mp"], "stat_scale": 16, "screen": None,
                "str": p["row"]["str"], "digimonId": f["id"]}
    return strongest_entry(p["enemy"]) if p["enemy"] else None


def clip_present(root, clip):
    a = cached("%s/%s/anim.json" % (MODELS, root), {}) or {}
    for c in a.get("clips", []):
        if c.get("index") == clip:
            return bool(c.get("present"))
    return False


def boss_ready_folder(folder):
    """True when a plain species (not an earlier fusion) can be a part of a boss: not blocked, has a stats source and a level."""
    if species_block(folder):
        return False
    nd = species_node(folder)
    return bool(nd["base_row"]) and part_entry(nd["participants"][0]) is not None


def battle_data(base, ops):
    """Everything the Lab page shows for a recipe {base, ops:[{part, donor}]}."""
    ops = [o for o in ops if o.get("part") and o.get("donor")]
    nd = compute_node(base, ops)
    parts = nd["participants"]
    root = nd["root"]
    res = {"ok": True, "base": nd["label"], "participants": [p["name"] for p in parts], "notes": nd["notes"]}
    elig, blockers = [], []
    for p in parts:
        r = species_block(p["folder"])
        elig.append({"name": p["name"], "blocked": r})
        if r:
            blockers.append(r)
    res["eligibility"] = elig
    res["sources"] = sources_of(parts)
    unavailable = [p["name"] for p in parts if not p["row"]]
    res["stats"] = None
    res["kept"] = None
    if unavailable:
        res["unavailable"] = ("No battle row in enemies.json for %s: the game has no enemy stats for it, so battle data "
                              "and a boss cannot be made from it." % ", ".join(unavailable))
        blockers.append(res["unavailable"])
    else:
        res["stats"] = stats_of(parts)
        br = nd["base_row"]
        res["kept"] = {
            "from": nd["label"],
            "resistances": br["resistances"], "status_resist": br["status_resist"],
            "family": br["digimon_type"], "drop_item": br["drop_item"], "drop_rate": br["drop_rate"],
        }
    mv = []
    for m in nd["moves"]:
        c = m.get("clip")
        mv.append({
            "slot": m["slot"], "slot_text": SLOT_WORDS[m["slot"]], "id": m["id"], "name": m["name"], "emitter": m["emitter"],
            "from": m["from"], "reason": m["reason"], "flags": m["flags"], "clip": c, "clip_kind": m.get("slot_kind"),
            "base_authors_clip": clip_present(root, c) if c is not None else None,
        })
    res["moves"] = mv
    if not any(m["slot"] == "attack" for m in mv) and not unavailable:
        blockers.append("no Fight (basic attack) could be worked out.")
    ents = [(p["name"], part_entry(p)) for p in parts]
    if all(e for _, e in ents):
        res["level"] = {
            "level": max(e["level"] for _, e in ents),
            "hp": sum(e["hp"] for _, e in ents),
            "stat_scale": max(e["stat_scale"] for _, e in ents),
            "from": [("%s: level %d, HP %d, stat scale %d (screen %d)" % (n, e["level"], e["hp"], e["stat_scale"], e["screen"])) if e.get("screen") is not None else
                     ("%s: level %d (form level from evolutions.json), HP %d (web/battle.js enemyHp: max(30, round(str %d x 2.5 + level %d x 5))), "
                      "stat scale %d (no encounter screen: identity)" % (n, e["level"], e["hp"], e["str"], e["level"], e["stat_scale"])) for n, e in ents],
            "body_entry": ents[0][1],
        }
    else:
        res["level"] = None
        if not unavailable:
            blockers.append("a part is on no encounter screen, so level and HP have no source.")
    res["blockers"] = blockers
    res["boss_ready"] = not blockers
    return res


# ---- the boss file --------------------------------------------------------------------

def read_bosses():
    return (read_json(BOSS_FILE, {}) or {}).get("bosses", {})


def write_bosses(bosses):
    os.makedirs(DATA, exist_ok=True)
    tmp = BOSS_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"_comment": "Fusion Lab bosses. PRIVATE and git-ignored (disc-derived). Written by tools/fusion_lab_server.py "
                               "(Make boss); read by web/battle.js only when F2 -> Extras -> Fusion bosses is on.",
                   "bosses": bosses}, f, indent=1)
    os.replace(tmp, BOSS_FILE)


def make_boss(model, name, recipe):
    if not LAB_ID_RE.match(model) or not is_fusion_folder(model):
        raise ValueError("model %r is not a built fusion" % model)
    ops = recipe.get("ops") or []
    d = battle_data(recipe["base"], ops)
    if d["blockers"]:
        raise ValueError("cannot make a boss: " + " ".join(d["blockers"]))
    parts = compute_node(recipe["base"], ops)["participants"]
    lv = d["level"]
    be = lv["body_entry"]
    ids = {m["slot"]: m["id"] for m in d["moves"]}
    rec = {
        "id": "lab_" + model, "lab": True, "displayName": name, "body": d["base"], "modelFolder": model,
        "halves": [p["enemy"] or p["name"] for p in parts], "level": lv["level"], "hp": lv["hp"], "statScale": lv["stat_scale"],
        "moves": [ids.get("attack", 0), ids.get("move_1", 0), ids.get("move_2", 0)],
        "party": dict({"id": be["id"], "level": be["level"], "hp": be["hp"], "mp": be["mp"], "stat_scale": be["stat_scale"]},
                      **({"digimonId": be["digimonId"]} if be.get("digimonId") else {})),
        "preview": {"stats": {k: v["value"] for k, v in d["stats"].items()}, "kept_from": d["kept"]["from"],
                    "moves": [{k: m[k] for k in ("slot_text", "id", "name", "emitter", "from", "reason")} for m in d["moves"]]},
        "made": time.strftime("%Y-%m-%d %H:%M"),
    }
    rows = {p["name"]: {k: v for k, v in p["row"].items() if k != "_form"} for p in parts if (p["row"] or {}).get("_form")}
    if rows:   # parts with no enemies.json row: the game takes their stat rows from here (web/battle.js fuseIntoBoss)
        rec["rows"] = rows
    bosses = read_bosses()
    bosses[rec["id"]] = rec
    write_bosses(bosses)
    return rec


def delete_boss(model):
    bosses = read_bosses()
    gone = bosses.pop("lab_" + model, None) is not None
    write_bosses(bosses)
    return gone
