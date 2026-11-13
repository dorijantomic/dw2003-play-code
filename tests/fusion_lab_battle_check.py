"""Helper for tests/fusion-lab-battle.test.js: reads the private game data through tools/fusion_battle.py and prints JSON.
Relations only; no disc numbers are stored here. Prints {"skip": true} when the private data is absent."""
import json, os, random, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT + "/tools")
import fusion_battle as fb

if not os.path.exists(fb.DATA + "/enemies.json") or not os.path.exists(fb.GAME + "/battle/model_map.json"):
    print(json.dumps({"skip": True})); sys.exit(0)
out = {}
mm = fb.model_map()
# 1. variant rule: every model named <species><number> with no own stats source resolves to that species
var = {}
for name, folder in mm.items():
    v = fb.variant_of(folder)
    if v:
        var[name] = v[0]
out["variants"] = var
out["digit_variants_ok"] = all(sp == fb.re.sub(r"[0-9]+$", "", n) for n, sp in var.items() if n[-1:].isdigit() and not n.startswith("BK"))
d = fb.battle_data(mm["Growlmon"], [{"part": "head", "donor": mm["MetalGreymon2"]}])
out["growlmon_metalgreymon2"] = {"boss_ready": d["boss_ready"], "blockers": d["blockers"], "sources": [s["text"] for s in d["sources"]]}
# a model of a species with no source and no variant stays "no stats source"
nd = fb.species_node(mm["Three-Tailed Greymon"])
out["three_tailed_has_row"] = bool(nd["base_row"])
# 2. stage-median rule
med = fb.stage_medians()
out["medians"] = {k: v[0] for k, v in med.items()}
forms = {}
for n in ("Growlmon", "WarGreymon", "Greymon"):
    r = fb.form_row(n)
    if r:
        total = sum(r[k] for k in fb.STATS)
        forms[n] = {"stage": r["_form"]["stage"], "total": total, "median": med[r["_form"]["stage"]][0], "str": r["str"]}
out["forms"] = forms
en = fb.enemies()
out["enemy_rows_untouched"] = all("_form" not in r for r in en.values()) and fb.species_node(mm["MetalGreymon"])["base_row"] is en["MetalGreymon"]
# 3. Random is always boss-ready
sys.path.insert(0, ROOT + "/tools")
import fusion_lab_server as srv
res = []
for seed in range(30):
    try:
        r = srv.api_random(random.Random(seed))
    except ValueError as e:
        res.append({"seed": seed, "error": str(e)}); continue
    b = fb.battle_data(r["base"], r["ops"])
    res.append({"seed": seed, "ready": b["boss_ready"], "blockers": b["blockers"]})
out["random"] = res
print(json.dumps(out))
