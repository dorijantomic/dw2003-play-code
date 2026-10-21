#!/usr/bin/env python3
"""Build the DW2-motion assets: one generated, git-ignored file per matched species (K22c).

WHAT THIS DOES (all of it local, from the user's own files — nothing here is committed):

  1. converts the species' DW2 battle model (glTF, from the user's DW2 install) into our
     DW3-shaped anim.json  (tools/dw2_motion/convert_dw2.py, the K21d converter);
  2. derives the DW2 rig's bone map with the same arithmetic that produced the DW3 map
     (tools/dw2_motion/k12_map.py, vendored from the K12 tooling), prior = the DW3 twin's
     anatomy record, plus the two root rules of K21d section 3;
  3. writes one BAKE JOB per species (target model, converted donor, bone map, the motion
     letters to bake) into a work dir;
  4. runs tools/dw2_motion/bake.mjs, which bakes each motion onto the DW3 body with
     bakeRetargetByRole, runs the swap gate, and writes
        web/assets/battle/dw2motion/<folder>.json     (one file per species)
        web/fight/dw2-clip-map.js                     (the generated clip-slot table)
        web/assets/battle/dw2motion/cast-types.json   (technique -> DW2 cast type)
     web/assets/ is git-ignored already; dw2-clip-map.js carries no disc data (slot -> letter
     and the DW2 engine's clip roles only).

THE GAME RUNS UNCHANGED WHEN THESE FILES ARE ABSENT: web/fight/dw2-motion.js loads nothing
until a scope enables it, and every lookup misses when the files are not there.

USAGE
    python3 tools/build_dw2_motion.py --all                       # every matched species (108)
    python3 tools/build_dw2_motion.py --species m009mera,m050coca  # a slice
    python3 tools/build_dw2_motion.py --all --dry-run              # convert + map, no bake
  options
    --dw2 DIR      the extracted DW2 model tree   (default ~/dw2-models/extract)
    --match FILE   K21c's species table           (default ~/scratch-research/k21c/species_table.json)
    --anatomy FILE the anatomy table (role prior) (default $DW2_ANATOMY or ~/scratch-research/anatomy/anatomy.json)
    --skills FILE  K21g's DW2 skill table         (default ~/scratch-research/k21g/skills.json)
    --work DIR     conversion cache + job files   (default ~/.cache/dw2-motion)
    --out DIR      where the per-species files go (default web/assets/battle/dw2motion)
"""
import argparse
import glob
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "dw2_motion"))
sys.path.insert(0, HERE)

import convert_dw2          # noqa: E402
import k12_map              # noqa: E402
import k12_lib              # noqa: E402

REPO = os.path.dirname(HERE)
HOME = os.path.expanduser("~")

# ── the DW3 clip slots and the DW2 motion each one takes ────────────────────────────────────────
# The rule, not a per-species list: a DW3 clip slot names a ROLE (idle, flinch, survive, death,
# evade, attack, cast, self, signature, throw), and the DW2 clip inventory has a motion for that
# role (K21a section 2: letter*10+digit = the DW2 motion id, anchored three ways in the decomp).
# `letters` is a list where the choice depends on the TECHNIQUE (the cast family F/G/H is picked
# by the DW2 skill's cast type — F/G/H are played by cast types 0/1/2, 156C.h/anim.c).
DW2_CLIP_MAP = {
    0: {"kind": "idle", "letters": ["A"], "why": "every DW2 fighter spawns on anim_A (fighter.c:261)"},
    1: {"kind": "flinch", "letters": ["C0"], "why": "DW2 hit reacts 0x14/0x15/0x16 = C0/C1/C2 (Stg30_HitReactUpdate); C0 = hop 1, the intermediate flinch (op1 mode 5)"},
    2: {"kind": "survive", "letters": ["C2"], "why": "DW3 clip 2 = survive, tables [4,5,6,11] hit->floor->get up; DW2 C2 = the knockdown reaction"},
    3: {"kind": "death", "letters": ["K"], "why": "DW2 K = death/knockdown; DW3 clip 3 = killed, tables [4,5,6,10]"},
    4: {"kind": "evade", "letters": ["C1"], "why": "the other hit reaction (hop 2) against DW3 clip 4, the miss/evade reaction"},
    5: {"kind": "attack", "letters": ["I"], "why": "DW2 I = the long melee/physical attack clip (fighter.c, state-2 case 2); DW3 clip 5 = the basic attack (tech table: basics 1..52 -> 5)"},
    6: {"kind": "attack", "letters": ["I"], "why": "DW3 clip 6 = the combo (tables [20-24]); the DW2 donor has one melee clip, I"},
    7: {"kind": "attack", "letters": ["I"], "why": "DW3 clip 7 = the two-beat pair; DW2 I"},
    8: {"kind": "attack", "letters": ["I"], "why": "DW3 clip 8 = the 3-beat combo (2x98+1x99 in every authored pack); DW2 I"},
    9: {"kind": "cast", "letters": ["F", "G", "H"], "why": "DW3 clip 9 = the spell (tech groups: attack/magical, 45 rows); the DW2 cast clip is chosen by the skill's cast type (0/1/2 -> F/G/H)"},
    10: {"kind": "self", "letters": ["A"], "why": "DW3 clip 10 = the item/self cast; DW2 has no item pose, so its calmest stream (the idle) is the donor"},
    11: {"kind": "signature", "letters": ["I", "F", "G", "H"], "why": "DW3 clip 11 = the signature (techs 53..104 -> 11); a physical one takes the melee clip I, a magical one the cast family by cast type"},
    12: {"kind": "none", "letters": [], "why": "clip 12 is supplied by the battle presentation actor, not by the model"},
    13: {"kind": "cast", "letters": ["F", "G", "H"], "why": "DW3 clip 13 = the volley (8 rows, 3 hits, magical); a cast, so the cast family"},
    14: {"kind": "attack", "letters": ["I"], "why": "DW3 clip 14 = the thrown-item arm (items 85/90); DW2 has no throw, its melee clip is the body"},
    15: {"kind": "cast", "letters": ["F", "G", "H"], "why": "DW3 clip 15 = the field move (7 rows, authors no contact); a cast, so the cast family"},
    16: {"kind": "cast", "letters": ["F", "G", "H"], "why": "DW3 clip 16 = a spell variant (4 rows); a cast, so the cast family"},
    17: {"kind": "reaction", "letters": ["C1"], "why": "DW3 clip 17 = the other thrown-item reaction arm; DW2's second hit reaction"},
}

# the letters worth baking once per species: every motion any slot above can name
LETTERS = ["A", "C0", "C1", "C2", "K", "I", "F", "G", "H"]
LETTER_KIND = {"A": "idle", "C0": "flinch", "C1": "evade", "C2": "survive", "K": "death",
               "I": "attack", "F": "cast", "G": "cast", "H": "cast"}
OFFSET0 = 6000
OFFSET_STEP = 500
TABLE0 = 128


def _sides(rec, key):
    v = rec.get(key) or []
    if isinstance(v, dict):
        return list(v.values())
    return v


def k12_record_to_bonemap(rec):
    bm = {"r": rec["root"], "ro": rec["roots"], "t": rec["torso"], "h": rec["head"],
          "m": rec["mouth"], "e": rec["eyes"], "loc": rec["locomotion"]}
    arms = _sides(rec, "arms")
    for side, key in (("left", "aL"), ("right", "aR")):
        ch = next((a["chain"] for a in arms if a.get("side") == side), None)
        bm[key] = ch or []
        extras = [a["chain"] for a in arms if a.get("side") == side and a["chain"] != ch]
        if extras:
            bm[key + "e"] = extras
    legs = _sides(rec, "legs")
    for side, key in (("left", "lL"), ("right", "lR")):
        ch = next((a["chain"] for a in legs if a.get("side") == side), None)
        bm[key] = ch or []
        extras = [a["chain"] for a in legs if a.get("side") == side and a["chain"] != ch]
        if extras:
            bm[key + "2"] = extras
    for side, key in (("left", "wL"), ("right", "wR")):
        ch = next((a["chain"] for a in _sides(rec, "wings") if a.get("side") == side), None)
        bm[key] = ch or []
    bm["tl"] = rec.get("tail") or []
    bm["dom"] = rec.get("dominantSide")
    # no side audit exists for a DW2 rig: the only side evidence is the geometry itself, so the map
    # is marked LOW and every side-specific decision is left off (no dominant-side launch).
    bm["sc"] = "low"
    bm["f"] = {}
    bm["fb"] = []
    return bm


def _ancestors(bones, i):
    out = []
    while i > -1:
        out.append(i)
        i = (bones[i].get("parent_slot") or 0) - 1
    return out


def align_roots(bm, rec, model):
    """Pair LIKE roots (K21d section 3, rule 1): `r` is the root that carries the legs, a second
    root that carries the upper body is the torso."""
    bones = model["bones"]
    legs = [a["chain"] for a in _sides(rec, "legs")]
    roots = [i for i, b in enumerate(bones) if (b.get("parent_slot") or 0) <= 0]
    leg_roots = [r for r in roots if legs and all(r in _ancestors(bones, c[0]) for c in legs)]
    note = []
    if len(roots) >= 2 and leg_roots and bm["r"] not in leg_roots:
        upper = [r for r in roots if r not in leg_roots]
        bm["r"] = leg_roots[0]
        if upper:
            bm["t"] = upper[0]
        note.append("roots: bone 0 is the upper body, so r=%d (legs) and t=%d" % (bm["r"], bm["t"]))
    return bm, note


def mirror_needed(bm, model, twin_bm, twin_model):
    """Decide the arm-side mirror by MEASUREMENT, not by species: compare the x sign of the donor's
    right-arm tip with the target's right-arm tip in their own rest poses. DW2 and DW3 agree on the
    frame (+X right) but not always on which physical arm the modeller put there (K21c: 6 of 10
    single-prop species disagree), so the decision has to be per pair."""
    t_arm = twin_bm.get("aR")
    if t_arm is None:                      # the K12 record shape (arms: [{side, chain}])
        arms = twin_bm.get("arms") or []
        if isinstance(arms, dict):
            arms = list(arms.values())
        t_arm = next((a.get("chain") for a in arms if a.get("side") == "right"), None)
    if not bm.get("aR") or not t_arm:
        return False, "no arm chain on one side"
    try:
        _r1, p1 = k12_lib.rest_pose(model["bones"])
        _r2, p2 = k12_lib.rest_pose(twin_model["bones"])
        xs = p1[bm["aR"][-1]][0]
        xt = p2[t_arm[-1]][0]
    except Exception as e:                                   # noqa: BLE001
        return False, "rest pose failed: %s" % e
    if abs(xs) < 1e-6 or abs(xt) < 1e-6:
        return False, "arm tip on the centre line"
    return (xs * xt < 0), "donor right-arm tip x=%.0f, target x=%.0f" % (xs, xt)


# ── the technique -> DW2 cast type table (from the user's disc, so generated + git-ignored) ─────
def cast_types(skills_path, dw3_skills_path):
    """DW2 cast type per DW3 technique.

    Anchor 1: a DW3 technique with a DW2 NAMESAKE takes that skill's own cast type
              (K21g's dw3-match rows; names are the disc's glyph names).
    Anchor 2: every other technique takes the majority cast type of the DW2 skills in its own
              GROUP, where the group is (DW3 type, DW3 attack_category) mapped onto the DW2
              skill record's own fields: attack/physical -> skillType 0 + effectKind 0 (damage),
              attack/magical -> skillType 0 + a non-damage effect, heal -> skillType 1,
              support -> skillType 3 (the buff family: 28 statusFlags + 21 buffFlags of its 43 rows).
              The share of the majority is recorded per group, so a thin group is visible.
    """
    out = {"source": None, "groups": {}, "bySkill": {}, "via": {}}
    if not (os.path.exists(skills_path) and os.path.exists(dw3_skills_path)):
        return out
    dw2 = json.load(open(skills_path))["skills"]
    dw3 = json.load(open(dw3_skills_path))["skills"]
    match_path = os.path.join(os.path.dirname(skills_path), "dw3-match.json")
    namesake = {}
    if os.path.exists(match_path):
        for row in json.load(open(match_path)).get("rows", []):
            namesake[int(row["dw3Id"])] = int(row["dw2CastAnim"])

    def bucket(s):
        st = s["skillType"] | 0
        if st == 1:
            return "heal"
        if st == 3:
            return "support"
        if st == 2:
            return "support2"
        return "attack_damage" if (s["effectKind"] | 0) == 0 else "attack_effect"

    counts = {}
    for s in dw2:
        counts.setdefault(bucket(s), {}).setdefault(s["castAnim"] | 0, 0)
        counts[bucket(s)][s["castAnim"] | 0] += 1
    groups = {}
    for k, c in counts.items():
        tot = sum(c.values())
        best = max(c.items(), key=lambda kv: kv[1])
        groups[k] = {"castType": best[0], "share": round(best[1] / tot, 2), "n": tot, "hist": c}
    out["groups"] = groups

    def group_of(s):
        if (s.get("type") or "attack") == "heal":
            return "heal"
        if (s.get("type") or "attack") == "support":
            return "support"
        return "attack_damage" if (s.get("attack_category") or "physical") == "physical" else "attack_effect"

    for s in dw3:
        sid = int(s["id"])
        if sid in namesake:
            out["bySkill"][sid] = namesake[sid]
            out["via"][sid] = "namesake"
        else:
            g = group_of(s)
            grp = groups.get(g) or groups.get("attack_damage") or {"castType": 0, "share": 0.0}
            out["bySkill"][sid] = grp["castType"]
            out["via"][sid] = "group:%s(%.2f)" % (g, grp.get("share", 0.0))
    out["source"] = {"skills": skills_path, "dw3skills": dw3_skills_path,
                     "note": "cast type 0/1/2 -> DW2 clips F/G/H (156C.h animFiles, anim.c Anim_SetModelAnim; K21a section 2)"}
    return out


def write_clip_map(path):
    rows = []
    for slot in sorted(DW2_CLIP_MAP):
        r = DW2_CLIP_MAP[slot]
        rows.append('  %d: { kind: "%s", letters: %s, why: %s },' % (
            slot, r["kind"], json.dumps(r["letters"]), json.dumps(r["why"])))
    body = "\n".join(rows)
    txt = '''// WHICH DW2 MOTION each DW3 clip slot takes — GENERATED by tools/build_dw2_motion.py.
// Do not hand-edit: change DW2_CLIP_MAP in that tool and rebuild.
//
// This file carries NO disc data: it is the ROLE of each DW3 clip slot (the engine's own slot
// semantics, from web/fight/fight-tables.js and the action-VM playlist) and the DW2 engine's clip
// letters (K21a section 2: letter A..K = animation file 0..10, digit = slot, so motion id =
// letter*10+digit; anchored on the hit reacts 0x14/0x15/0x16 = C0/C1/C2, the cast types 0/1/2 =
// 0x32/0x3C/0x46 = F/G/H, and the city walkers' 0x1E/0x1F/0x20 = D0/D1/D2).
//
// A slot's `letters` list is ordered: when it has more than one entry the choice is the
// TECHNIQUE's (a cast takes F/G/H by the skill's DW2 cast type; a magical signature takes the cast
// family, a physical one the melee clip).

export const DW2_CLIP_MAP = {
%s
};

/** The DW2 cast family, in cast-type order: the DW2 engine plays F for type 0, G for 1, H for 2. */
export const DW2_CAST_LETTERS = ["F", "G", "H"];

/** The DW2 motion letter for a DW3 clip slot, or null when the slot has no donor motion.
 *  `castType` is the technique's DW2 cast type (0/1/2); `magical` picks the cast family for the
 *  signature slot 11, whose body is a melee swing for a physical technique. */
export function dw2LetterForSlot(slot, { castType = 0, magical = false } = {}) {
  const row = DW2_CLIP_MAP[slot];
  if (!row || !row.letters.length) return null;
  if (row.letters.length === 1) return row.letters[0];
  if (slot === 11 && !magical) return row.letters[0];
  const i = Math.max(0, Math.min(2, castType | 0));
  return DW2_CAST_LETTERS[i] ?? row.letters[0];
}

/** Every DW2 motion letter any slot can name (what the batch build bakes per species). */
export const DW2_MOTION_LETTERS = %s;
''' % (body, json.dumps(LETTERS))
    with open(path, "w") as f:
        f.write(txt)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--species", default=None, help="comma-separated DW3 folders")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--dw2", default=os.path.join(HOME, "dw2-models", "extract"))
    ap.add_argument("--match", default=os.path.join(HOME, "scratch-research", "k21c", "species_table.json"))
    ap.add_argument("--anatomy", default=k12_lib.ANAT)
    ap.add_argument("--skills", default=os.path.join(HOME, "scratch-research", "k21g", "skills.json"))
    ap.add_argument("--dw3skills", default=os.path.join(REPO, "web/assets/data/digimon.json"))
    ap.add_argument("--work", default=os.path.join(HOME, ".cache", "dw2-motion"))
    ap.add_argument("--out", default=os.path.join(REPO, "web/assets/battle/dw2motion"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    os.makedirs(a.work, exist_ok=True)
    os.makedirs(os.path.join(a.work, "converted"), exist_ok=True)
    os.makedirs(os.path.join(a.work, "jobs"), exist_ok=True)
    os.makedirs(a.out, exist_ok=True)

    rows = json.load(open(a.match))
    if a.species:
        want = {s.strip() for s in a.species.split(",") if s.strip()}
        rows = [r for r in rows if r["folder"] in want]
    elif not a.all:
        print("nothing to do: pass --all or --species f1,f2", file=sys.stderr)
        return 2
    rows.sort(key=lambda r: r["folder"])
    if a.limit:
        rows = rows[:a.limit]

    anat = {r["folder"]: r for r in json.load(open(a.anatomy))} if os.path.exists(a.anatomy) else {}
    jobs = []
    skipped = []
    for r in rows:
        folder = r["folder"]
        rec = anat.get(folder)
        if not rec:
            skipped.append((folder, "no anatomy prior"))
            continue
        cand = glob.glob(os.path.join(a.dw2, "Digimon", r["dw2rel"], "*.gltf"))
        cand = [c for c in cand if "Overworld" not in c]
        if len(cand) != 1:
            skipped.append((folder, "gltf %d candidates under %s/%s" % (len(cand), r["dw2stage"], r["dw2rel"])))
            continue
        gltf = cand[0]
        code = os.path.splitext(os.path.basename(gltf))[0].lower()
        dw2folder = "dw2_%s" % code
        conv = os.path.join(a.work, "converted", dw2folder, "anim.json")
        if not os.path.exists(conv):
            try:
                model, _clips = convert_dw2.convert(gltf, dw2folder, 30)
            except Exception as e:                              # noqa: BLE001
                skipped.append((folder, "convert failed: %s" % e))
                continue
            os.makedirs(os.path.dirname(conv), exist_ok=True)
            with open(conv, "w") as f:
                json.dump(model, f, separators=(",", ":"))
        source = json.load(open(conv))
        source["folder"] = dw2folder
        out = k12_map.analyse(dw2folder, rec, source)
        bm = k12_record_to_bonemap(out)
        bm, notes = align_roots(bm, out, source)
        target = json.load(open(os.path.join(REPO, "web/assets/battle/models", folder, "anim.json")))
        bonemap_path = os.environ.get("DW2_BONEMAP_JSON", os.path.join(HOME, "scratch-research", "anatomy", "bone-map.json"))
        twin_bm = json.load(open(bonemap_path))["models"][folder]
        mirror, mnote = mirror_needed(bm, source, twin_bm, target)
        have = {c.get("letter") for c in source.get("clips", [])} | {c.get("name") for c in source.get("clips", [])}
        # ── THE USER RULE: DW2 motion FILLS a slot the model does not own; it never replaces one ────
        # Ownership is the model's own action script (the same test resolveClipScript uses): a slot with
        # ops is authored, its body is ground truth. A gap is a slot in the engine's clip set (0..17, 12
        # is the presentation actor's) with no own script.
        acts = target.get("actions") or []
        owned = sorted(int(k) for k, a in (acts.items() if isinstance(acts, dict) else enumerate(acts))
                       if a and a.get("ops"))
        gap_slots = [s for s in sorted(DW2_CLIP_MAP) if s not in owned and DW2_CLIP_MAP[s]["letters"]]
        need = []
        for s in gap_slots:
            for L in DW2_CLIP_MAP[s]["letters"]:
                if L not in need:
                    need.append(L)
        letters = [L for L in LETTERS if L in have and L in need]
        job = {
            "folder": folder, "name": r.get("name"), "dw2folder": dw2folder,
            "source": conv, "target": os.path.join(REPO, "web/assets/battle/models", folder, "anim.json"),
            "bonemap": bm, "mirror": mirror, "mirrorNote": mnote,
            "plan": r.get("plan"), "coverageK21c": r.get("coverage"), "notes": notes,
            "ownedSlots": owned, "gapSlots": gap_slots,
            # the letters this species' GAPS can take, and the letters its donor has
            "missingDonor": [s for s in gap_slots if not set(DW2_CLIP_MAP[s]["letters"]) & have],
            "letters": [{"letter": L, "kind": LETTER_KIND[L], "offset": OFFSET0 + OFFSET_STEP * i,
                         "table": TABLE0 + i} for i, L in enumerate(letters)],
        }
        with open(os.path.join(a.work, "jobs", "%s.json" % folder), "w") as f:
            json.dump(job, f)
        jobs.append(folder)

    print("jobs: %d   skipped: %d" % (len(jobs), len(skipped)))
    for f, why in skipped:
        print("  skip %-10s %s" % (f, why))
    cm = write_clip_map(os.path.join(REPO, "web/fight", "dw2-clip-map.js"))
    print("wrote", cm)
    ct = cast_types(a.skills, a.dw3skills)
    if ct.get("bySkill"):
        with open(os.path.join(a.out, "cast-types.json"), "w") as f:
            json.dump(ct, f, separators=(",", ":"))
        print("cast types: %d techniques (%d by namesake)  groups %s" % (
            len(ct["bySkill"]), sum(1 for v in ct["via"].values() if v == "namesake"),
            {k: v["castType"] for k, v in ct["groups"].items()}))
    if a.dry_run:
        return 0
    node = ["node", os.path.join(HERE, "dw2_motion", "bake.mjs"),
            "--jobs", os.path.join(a.work, "jobs"), "--only", ",".join(jobs), "--out", a.out]
    print("baking:", " ".join(node[:2]), "...")
    rc = subprocess.call(node)
    return rc


if __name__ == "__main__":
    sys.exit(main())
