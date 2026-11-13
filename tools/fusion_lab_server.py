#!/usr/bin/env python3
"""Fusion Lab helper server (dev only, localhost only, port 8791).

The page web/fusion-lab.html cannot run python, so it talks to this small server, which runs
~/dw3-fusion/tools/fuse.py and keeps ~/dw3-fusion/favorites.json.

  python3 ~/dw2003-play-integration/tools/fusion_lab_server.py [port]

API (JSON, CORS only for localhost pages):
  GET  /api/models                       names + ids + rookie flag, earlier fusions
  GET  /api/candidates?model=&kind=      the parts fuse.py finds on a model (by position), each with its bone-list spec and trust (trusted + reasons, from ~/dw3-fusion/part_trust.json)
  POST /api/build  {base, ops:[{part, donor, base_chain?, donor_chain?}], out?}   runs fuse.py --install --check
  GET  /api/favorites
  POST /api/favorites {name, recipe, model}
  POST /api/favorites/delete {model}
  POST /api/battle {base, ops}           battle data of a recipe in plain words (stats and where they came from, kept-from-base, moves with reasons, who may fuse)
  GET  /api/bosses                       the Lab bosses written so far
  POST /api/boss {model}                 "Make boss" on a favourite: writes web/assets/data/fusion_lab_bosses.json (private, git-ignored)
  POST /api/boss/delete {model}
Private: models and favorites are disc-derived and live in git-ignored places only.
"""
import os, sys, re, json, time, threading, subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HOME = os.path.expanduser("~")
FUS = HOME + "/dw3-fusion"
TOOLS = FUS + "/tools"
GAME = HOME + "/dw2003-play-integration/web/assets"
MODELS = GAME + "/battle/models"
FAV = FUS + "/favorites.json"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8791
KINDS = ("arms", "legs", "head", "tail", "wings")
ID_RE = re.compile(r"^m[0-9]{3}[a-z0-9_]+$")
CHAIN_RE = re.compile(r"^(upper|lower|top|bottom|[0-9]+(,[0-9]+)*(;[0-9]+(,[0-9]+)*)?)$")
LOCK = threading.Lock()          # fuse.py analysis and builds one at a time
FAVLOCK = threading.Lock()

sys.path.insert(0, TOOLS)
import fuse                       # noqa: E402  (the real fuse.py, imported for candidate listing)
sys.path.insert(0, HOME + "/dw2003-play-integration/tools")
import fusion_battle as fb        # noqa: E402  (battle data + boss file; tools/fusion_battle.py)


def read_json(path, default):
    try:
        with open(path) as f: return json.load(f)
    except (OSError, ValueError): return default


def rookies():
    """Rookie = the 8 evolution-line roots of the game's own evolutions.json (names from digimon.json)."""
    return fb.rookie_names()


def is_model(i): return bool(ID_RE.match(i)) and os.path.exists(MODELS + "/%s/anim.json" % i)


def is_fusion(i): return bool(ID_RE.match(i)) and os.path.exists(FUS + "/%s/anim.json" % i)


def api_models():
    mm = read_json(GAME + "/battle/model_map.json", {})
    rk = rookies()
    byid = {}
    for name, mid in mm.items():
        if not is_model(mid): continue
        e = byid.setdefault(mid, {"id": mid, "names": [], "rookie": False, "blocked": fb.species_block(mid)})
        e["names"].append(name)
        if name in rk: e["rookie"] = True
    out = []
    for e in byid.values():
        e["name"] = e["names"][0]
        out.append(e)
    out.sort(key=lambda e: e["name"].lower())
    favs = {f["model"]: f["name"] for f in read_json(FAV, [])}
    fus = []
    if os.path.isdir(FUS):
        for n in sorted(os.listdir(FUS)):
            if ID_RE.match(n) and is_fusion(n): fus.append({"id": n, "name": favs.get(n), "blocked": fb.folder_block(n)})
    return {"models": out, "fusions": fus,
            "rookie_note": ("Only true rookies are blocked: the %d evolution-line roots of evolutions.json (%s), and, for a Digimon that has an "
                            "enemies.json row, the lowest stat-total tier (tier 1 of tools/build_extra_species.py). A partner form with no enemies.json row "
                            "(Greymon, WarGreymon, Angemon, Beelzemon ...) is allowed: its stats are digimon.json base + growth x (level - 1) at a level read "
                            "from its place in evolutions.json (rookie-level gate, or the highest level its source forms need). The page shows each stat's source."
                            % (len(rk), ", ".join(sorted(rk)))),
            "rookie_names": sorted(rk)}


TRUST = FUS + "/part_trust.json"     # private, made by tools/fusion_part_trust.py
_trust_cache = {"mtime": None, "models": {}}


def trust_models():
    """{model: {kind: {trusted, reasons, cands}}}; re-read when the file changes. Empty when the file is missing."""
    try: mt = os.path.getmtime(TRUST)
    except OSError: mt = None
    if mt != _trust_cache["mtime"]:
        _trust_cache["models"] = read_json(TRUST, {}).get("models", {}) if mt else {}
        _trust_cache["mtime"] = mt
    return _trust_cache["models"]


def trust_of(model, kind):
    """Is fuse.py's pick for this part of this model confirmed by bodies.json and anatomy.json? Unknown model = doubtful."""
    r = (trust_models().get(model) or {}).get(kind)
    if r: return r
    return {"trusted": False, "cands": [], "reasons": ["no trust data for this model (built fusions and unscanned models have none; run tools/fusion_part_trust.py)"]}


def api_candidates(model, kind):
    if kind not in KINDS: raise ValueError("unknown part kind")
    if not (is_model(model) or is_fusion(model)): raise ValueError("unknown model " + model)
    with LOCK:
        a = fuse.analyse(fuse.load_model(model))
        out = []
        tr = trust_of(model, kind)
        for i, u in enumerate(a.units[kind]):
            spec = ";".join(",".join(str(b) for b in ch) for ch in u["chains"])
            tc = next((c for c in tr["cands"] if c["spec"] == spec), None)
            out.append({"index": i, "spec": spec, "text": fuse.describe(a, kind, u),
                        "height": round(-float(u["y"]) / a.H, 2),
                        "trusted": bool(tc and tc["trusted"]), "reasons": (tc["reasons"] if tc else tr["reasons"])})
        return {"model": model, "kind": kind, "candidates": out, "trusted": tr["trusted"], "reasons": tr["reasons"]}


def next_id():
    n = 800
    while True:
        i = "m%03dlab1" % n
        if not os.path.exists(FUS + "/" + i) and not os.path.exists(MODELS + "/" + i): return i
        n += 1


def plain_summary(text):
    """Check numbers in plain words, from the CHECK block of fuse.py."""
    out = []
    part = None
    for ln in text.splitlines():
        m = re.match(r"^(arms|legs|head|tail|wings) side (\d+) bones", ln)
        if m: part = "%s side %s" % (m.group(1), m.group(2)); continue
        m = re.match(r"^(\w+) bones \[", ln)
        m2 = re.search(r"joint gap .*max ([\d.]+) units = ([\d.]+) body heights", ln)
        if m2: out.append("%s: joint gap %s units (%.1f%% of body height); 0 means the new part is attached exactly where the old one was." % (part, m2.group(1), float(m2.group(2)) * 100)); continue
        m2 = re.search(r"part length \(.*\) new/base: ([\d.]+)", ln)
        if m2: out.append("%s: new part is %.0f%% as long as the original one." % (part, float(m2.group(1)) * 100)); continue
        m2 = re.search(r"direction error vs base, table frames, max/mean/p99 deg per segment: (.*)$", ln)
        if m2:
            mx = [float(x) for x in re.findall(r"\(([\d.]+),", m2.group(1))]
            if mx: out.append("%s: the part follows the original's movement to within %.2f degrees at worst (all animation keyframes)." % (part, max(mx)))
            continue
        m2 = re.search(r"^lowest vertex at idle frame \d+ .*diff ([-\d.]+) units \(([-\d.]+) H\)", ln)
        if m2: out.append("Standing: lowest point differs from the original by %s units (%.1f%% of body height); 0 means the feet stay on the ground." % (m2.group(1), float(m2.group(2)) * 100))
        m2 = re.search(r"^engine FK .*, (\d+) frames: direction error max deg per segment ([\d. ]+),", ln)
        if m2:
            mx = [float(x) for x in m2.group(2).split()]
            out.append("Game-engine check (%s frames): worst direction error %.2f degrees." % (m2.group(1), max(mx)))
        if "every bone has ch1 and ch2 keys" in ln:
            out.append("Every bone has animation keys: %s." % ("yes" if ln.strip().endswith("True") else "NO, a bone is missing keys"))
    return out


def api_build(body):
    base = str(body.get("base", "")); ops = body.get("ops") or []
    if not (is_model(base) or is_fusion(base)): raise ValueError("unknown base model: %r" % base)
    if not ops: raise ValueError("add at least one part row")
    for who in [base] + [str(o.get("donor", "")) for o in ops]:
        why = fb.folder_block(who) if (is_model(who) or is_fusion(who)) else None
        if why: raise ValueError("%s: %s" % (who, why))
    args = ["--base", base]
    for o in ops:
        kind = o.get("part"); donor = str(o.get("donor", ""))
        if kind not in KINDS: raise ValueError("bad part kind %r" % kind)
        if not (is_model(donor) or is_fusion(donor)): raise ValueError("unknown donor model: %r" % donor)
        args += ["--part", kind, "--donor", donor]
        for key, flag in (("donor_chain", "--donor-chain"), ("base_chain", "--base-chain")):
            v = o.get(key)
            if v:
                if not CHAIN_RE.match(str(v)): raise ValueError("bad chain spec %r" % v)
                args += [flag, str(v)]
    out = body.get("out")
    if out:
        if not ID_RE.match(str(out)) or not (is_fusion(out) or not os.path.exists(MODELS + "/" + out)):
            raise ValueError("bad or taken output id %r" % out)
    else:
        out = next_id()
    args += ["--out", out, "--install", "--check"]
    t0 = time.time()
    with LOCK:
        r = subprocess.run([sys.executable, FUS + "/tools/fuse.py"] + args, capture_output=True, text=True, timeout=900)
    text = (r.stdout or "") + (("\n" + r.stderr) if r.stderr.strip() else "")
    ok = r.returncode == 0 and os.path.exists(MODELS + "/%s/anim.json" % out)
    res = {"ok": ok, "rc": r.returncode, "model": out if ok else None, "output": text, "seconds": round(time.time() - t0, 1),
           "command": "python3 fuse.py " + " ".join(args)}
    if ok: res["summary"] = plain_summary(text)
    else:
        m = re.search(r"^STOP: (.*)", text, re.M | re.S)
        res["error"] = m.group(1).strip() if m else (text.strip()[-800:] or "fuse.py failed")
    return res


def api_fav_save(body):
    name = str(body.get("name", "")).strip(); model = str(body.get("model", ""))
    if not name: raise ValueError("give the fusion a name")
    if not is_fusion(model): raise ValueError("model %r is not a built fusion" % model)
    rec = body.get("recipe") or {}
    with FAVLOCK:
        favs = read_json(FAV, [])
        favs = [f for f in favs if f.get("model") != model]
        favs.append({"name": name[:80], "recipe": rec, "model": model, "saved": time.strftime("%Y-%m-%d %H:%M")})
        tmp = FAV + ".tmp"
        with open(tmp, "w") as f: json.dump(favs, f, indent=1)
        os.replace(tmp, FAV)
    return {"ok": True, "favorites": favs}


def api_fav_delete(body):
    model = str(body.get("model", ""))
    with FAVLOCK:
        favs = [f for f in read_json(FAV, []) if f.get("model") != model]
        with open(FAV + ".tmp", "w") as f: json.dump(favs, f, indent=1)
        os.replace(FAV + ".tmp", FAV)
    return {"ok": True, "favorites": favs}


ANATOMY = HOME + "/scratch-research/anatomy/anatomy.json"      # research data, read at run time only, never copied into a repo
PART_WORDS = {
    "arms": ("arm", "hand", "fist", "claw", "pincer", "blade", "sword", "tentacle", "punch", "sickle", "cannon", "gun", "shield", "finger", "palm"),
    "legs": ("leg", "foot", "feet", "kick", "hoof", "paw", "stomp"),
    "head": ("head", "mouth", "horn", "eye", "face", "jaw", "beak", "tooth", "teeth", "fang", "antenna", "hair", "mask", "helmet", "crest"),
    "tail": ("tail", "stinger"),
    "wings": ("wing", "feather", "pinion"),
}


def anatomy_by_folder():
    out = {}
    for r in read_json(ANATOMY, []):
        if r.get("folder"): out.setdefault(r["folder"], r)
    return out


def anat_has(rec, kind):
    """Does anatomy.json say this Digimon has the part?"""
    if kind == "arms": return bool(rec.get("arms"))
    if kind == "legs": return (rec.get("legs") or 0) > 0
    if kind == "wings": return (rec.get("wings") or 0) > 0
    if kind == "tail": return bool(rec.get("tail"))
    return True        # every Digimon has a head


def api_attacks(model, kind):
    if kind not in KINDS: raise ValueError("unknown part kind")
    rec = anatomy_by_folder().get(model)
    if not rec: return {"model": model, "kind": kind, "known": False, "mine": [], "others": []}
    mine, others = [], []
    for s in rec.get("attackSources") or []:
        bp = (s.get("bodyPart") or "").lower()
        item = {"technique": s.get("technique"), "bodyPart": s.get("bodyPart"), "style": s.get("style")}
        (mine if any(w in bp for w in PART_WORDS[kind]) else others).append(item)
    return {"model": model, "kind": kind, "known": True, "mine": mine, "others": others}


def lore_set(r):
    out = set()
    for v in [r.get("speciesType"), r.get("speciesSecondary")] + list(r.get("speciesTags") or []):
        if isinstance(v, list): out |= {x for x in v if isinstance(x, str)}
        elif isinstance(v, str): out.add(v)
    return {x for x in out if x and x != "other"}


def shared_lore(a, b):
    return sorted(lore_set(a) & lore_set(b))


def pick_cand(kind, cands):
    """Several measured candidates: legs use the lowest pair, everything else the highest."""
    if not cands: return None, ""
    c = cands[-1] if kind == "legs" else cands[0]
    note = "" if len(cands) == 1 else " (%d %s pairs found, used the %s one)" % (len(cands), kind, "lowest" if kind == "legs" else "highest")
    return c["spec"], note


def api_random(rng=None):
    import random
    rng = rng or random.Random()
    rk = rookies()
    anat = anatomy_by_folder()
    pool = []
    for mid, rec in anat.items():
        if not is_model(mid): continue
        if rec.get("name") in rk or rec.get("canonicalName") in rk: continue
        if not fb.boss_ready_folder(mid): continue     # blocked, or no stats source (own row, variant of a species, or stage-scaled form), or no level
        pool.append(mid)
    if not trust_models(): raise ValueError("no part trust file: run python3 ~/dw2003-play-integration/tools/fusion_part_trust.py first")
    if len(pool) < 3: raise ValueError("anatomy.json gives too few usable Digimon")
    cache = {}

    def cands(mid, kind):
        """only parts that fuse.py, bodies.json and anatomy.json all agree on (part_trust.json)"""
        if (mid, kind) not in cache:
            try:
                d = api_candidates(mid, kind)
                cache[(mid, kind)] = [c for c in d["candidates"] if c["trusted"]] if d["trusted"] else []
            except Exception: cache[(mid, kind)] = []
        return cache[(mid, kind)]

    for _ in range(60):
        base = rng.choice(pool); brec = anat[base]
        kinds = [k for k in KINDS if anat_has(brec, k) and cands(base, k)]
        if not kinds: continue
        n = rng.randint(1, min(3, len(kinds)))
        chosen = rng.sample(kinds, n)
        max_donors = rng.randint(1, n)
        donors, ops, reasons = [], [], []
        ok = True
        for kind in chosen:
            opts = [d for d in pool if d != base and anat_has(anat[d], kind) and cands(d, kind)]
            if len(donors) >= max_donors: opts = [d for d in opts if d in donors] or opts
            lore = [d for d in opts if shared_lore(brec, anat[d])]
            use = lore or opts
            if not use: ok = False; break
            d = rng.choice(use); drec = anat[d]
            if d not in donors: donors.append(d)
            bs, bnote = pick_cand(kind, cands(base, kind)); ds, dnote = pick_cand(kind, cands(d, kind))
            sh = shared_lore(brec, drec)
            why = ("both %s" % " / ".join(sh)) if sh else ("no shared type or tag with %s (%s vs %s): no lore match was available for this part" % (brec["name"], brec.get("speciesType"), drec.get("speciesType")))
            reasons.append("%s from %s: %s. Anatomy: base has %s, donor has %s.%s%s" % (kind, drec["name"], why, kind, kind, bnote and " Base" + bnote, dnote and " Donor" + dnote))
            op = {"part": kind, "donor": d}
            if bs and len(cands(base, kind)) > 1: op["base_chain"] = bs
            if ds and len(cands(d, kind)) > 1: op["donor_chain"] = ds
            ops.append(op)
        if ok and ops:
            if not fb.battle_data(base, ops)["boss_ready"]: continue      # every Random result can become a boss
            return {"base": base, "base_name": brec["name"], "ops": ops, "reasons": reasons}
    raise ValueError("could not find a fitting random fusion; try again")


def api_battle(body):
    base = str(body.get("base", "")); ops = body.get("ops") or []
    for who in [base] + [str(o.get("donor", "")) for o in ops]:
        if not (is_model(who) or is_fusion(who)): raise ValueError("unknown model %r" % who)
    return fb.battle_data(base, ops)


def api_boss(body):
    model = str(body.get("model", ""))
    fav = next((f for f in read_json(FAV, []) if f.get("model") == model), None)
    if not fav: raise ValueError("make the boss from a saved favourite: save this fusion first")
    rec = fb.make_boss(model, fav["name"], fav["recipe"])
    return {"ok": True, "boss": rec, "file": fb.BOSS_FILE}


def api_boss_delete(body):
    return {"ok": True, "removed": fb.delete_boss(str(body.get("model", "")))}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _cors(self):
        o = self.headers.get("Origin", "")
        if re.match(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$", o):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code); self._cors()
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store"); self.end_headers(); self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def _run(self, fn):
        try: self._send(200, fn())
        except ValueError as e: self._send(400, {"ok": False, "error": str(e)})
        except Exception as e: self._send(500, {"ok": False, "error": "%s: %s" % (type(e).__name__, e)})

    def do_GET(self):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == "/api/models": self._run(api_models)
        elif u.path == "/api/candidates": self._run(lambda: api_candidates(q.get("model", ""), q.get("kind", "")))
        elif u.path == "/api/attacks": self._run(lambda: api_attacks(q.get("model", ""), q.get("kind", "")))
        elif u.path == "/api/random": self._run(api_random)
        elif u.path == "/api/favorites": self._run(lambda: {"favorites": read_json(FAV, [])})
        elif u.path == "/api/bosses": self._run(lambda: {"bosses": sorted(fb.read_bosses())})
        elif u.path == "/api/ping": self._send(200, {"ok": True})
        else: self._send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        try: body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except ValueError: return self._send(400, {"ok": False, "error": "bad JSON"})
        if u.path == "/api/build": self._run(lambda: api_build(body))
        elif u.path == "/api/favorites": self._run(lambda: api_fav_save(body))
        elif u.path == "/api/favorites/delete": self._run(lambda: api_fav_delete(body))
        elif u.path == "/api/battle": self._run(lambda: api_battle(body))
        elif u.path == "/api/boss": self._run(lambda: api_boss(body))
        elif u.path == "/api/boss/delete": self._run(lambda: api_boss_delete(body))
        else: self._send(404, {"error": "not found"})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
