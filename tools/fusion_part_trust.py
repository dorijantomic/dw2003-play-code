#!/usr/bin/env python3
"""Fusion Lab part trust: regenerates ~/dw3-fusion/part_trust.json (private, outside every repo).

fuse.py finds the parts of a model by itself. Two other sources describe the same bodies:
  ~/dw3-knowledge/bodies.json              limb chains (bone lists) per model
  ~/scratch-research/anatomy/anatomy.json  how many legs / arms / wings, tail yes/no
A part of a model is TRUSTED when fuse.py agrees with both: the count equals the anatomy count, every chain the tool found
shares bones with a bodies.json chain of the SAME kind, and every bodies.json chain of that kind was found.
Otherwise it is DOUBTFUL, with the reasons in plain words.

  python3 ~/dw2003-play-integration/tools/fusion_part_trust.py        (a minute or two)

File layout: {"models": {id: {kind: {"trusted": bool, "reasons": [..], "cands": [{"index", "spec", "trusted", "reasons"}]}}}}
The candidate index/spec are the same as /api/candidates (fuse.analyse units, highest first).
"""
import os, sys, json, time

HOME = os.path.expanduser("~")
sys.path.insert(0, HOME + "/dw3-fusion/tools")
import fuse  # noqa: E402

OUT = HOME + "/dw3-fusion/part_trust.json"
BODIES = HOME + "/dw3-knowledge/bodies.json"
ANATOMY = HOME + "/scratch-research/anatomy/anatomy.json"
MODELS = HOME + "/dw2003-play-integration/web/assets/battle/models"
KINDS = ("arms", "legs", "head", "tail", "wings")
LIMBS = ("arms", "legs", "wings", "tail")
NOUN = {"arms": "arms", "legs": "legs", "wings": "wings", "tail": "a tail"}
PREFIX = {"legs": "leg", "arms": "arm", "wings": "wing", "tail": "tail"}
OVERLAP = 0.5      # two chains agree when they share at least this share of the shorter one's bones


def overlaps(a, b):
    a, b = set(a), set(b)
    return bool(a and b) and len(a & b) / min(len(a), len(b)) >= OVERLAP


def body_chains(rec):
    out = {k: [] for k in LIMBS}
    for name, v in (rec.get("chains") or {}).items():
        for k in LIMBS:
            if name.startswith(PREFIX[k]):
                out[k].append(list(v) if isinstance(v, list) else [v]); break
    return out


def other_kinds(bch, chain, own):
    """the other kinds bodies.json gives to this bone chain"""
    return [k for k in LIMBS if k != own and any(overlaps(chain, c) for c in bch[k])]


def judge_model(a, brec, arec):
    res = {}
    bch = body_chains(brec) if brec else None
    for kind in KINDS:
        units = a.units[kind]
        cands, kr = [], []
        if kind == "head":
            if not brec: kr.append("no bodies.json record for this model")
            else:
                hb = (brec.get("sites", {}).get("head") or {}).get("bone")
                limb = set(x for k in ("legs", "arms", "wings") for c in bch[k] for x in c)
                if hb is None: kr.append("bodies data has no head bone")
                elif hb not in a.head_sub: kr.append("the tool is not sure about the head: bodies data says bone %s, the tool took bone %s" % (hb, a.head))
                elif set(a.head_sub) & limb: kr.append("the tool is not sure about the head: its head group includes bones that bodies data calls limbs")
            for i, u in enumerate(units):
                cands.append({"index": i, "spec": ",".join(str(b) for b in u["chains"][0]), "trusted": not kr, "reasons": list(kr)})
            res[kind] = {"trusted": not kr and bool(units), "reasons": kr, "cands": cands}
            continue
        found = (len(units) > 0) if kind == "tail" else 2 * len(units)
        if not brec: kr.append("no bodies.json record for this model")
        if not arec: kr.append("no anatomy.json record for this model")
        else:
            want = {"legs": arec.get("legs") or 0, "wings": arec.get("wings") or 0, "arms": len(arec.get("arms") or []), "tail": bool(arec.get("tail"))}[kind]
            if found != want:
                if kind == "tail": kr.append("anatomy says %s, the tool found %s" % ("a tail" if want else "no tail", "a tail" if found else "no tail"))
                else: kr.append("anatomy says %d %s, the tool found %d" % (want, kind, found))
        if brec:
            for c in bch[kind]:
                if not any(overlaps(c, ch) for u in units for ch in u["chains"]):
                    kr.append("bodies data has a chain for the %s (bones %s) that the tool did not find" % (kind, c))
        model_bad = bool(kr)
        for i, u in enumerate(units):
            cr = []
            if brec:
                for ch in u["chains"]:
                    if any(overlaps(ch, c) for c in bch[kind]): continue
                    other = other_kinds(bch, ch, kind)
                    if other: cr.append("the tool is not sure these are the %s: bodies data says %s (bones %s)" % (kind, " / ".join(NOUN[o] for o in other), ch))
                    else: cr.append("the tool is not sure these are the %s: bodies data has no %s chain there (bones %s)" % (kind, kind, ch))
                    break
            cands.append({"index": i, "spec": ";".join(",".join(str(b) for b in ch) for ch in u["chains"]),
                          "trusted": not cr and not model_bad, "reasons": kr + cr})
        allr = kr + [r for c in cands for r in c["reasons"] if r not in kr]
        if not units and not allr: allr = ["no such part found on this model"]
        res[kind] = {"trusted": not allr and bool(units), "reasons": allr, "cands": cands}
    return res


def main():
    B = json.load(open(BODIES))["models"]
    A = {}
    for e in json.load(open(ANATOMY)):
        if e.get("folder"): A.setdefault(e["folder"], e)
    ids = sorted(d for d in os.listdir(MODELS) if d.startswith("m") and os.path.exists(MODELS + "/%s/anim.json" % d))
    out, errs = {}, {}
    t0 = time.time()
    for f in ids:
        if f.startswith("m8") or f.startswith("m99"): continue       # fusions
        try: a = fuse.analyse(fuse.load_model(f))
        except Exception as e: errs[f] = repr(e); continue
        out[f] = judge_model(a, B.get(f), A.get(f))
    tmp = OUT + ".tmp"
    with open(tmp, "w") as fh: json.dump({"generated": time.strftime("%Y-%m-%d %H:%M"), "models": out, "errors": errs}, fh, indent=1)
    os.replace(tmp, OUT)
    print("models %d, errors %d, %.0f s -> %s" % (len(out), len(errs), time.time() - t0, OUT))
    for k in KINDS:
        have = [m for m in out.values() if m[k]["cands"]]
        print("%-6s found on %3d models, trusted on %3d" % (k, len(have), sum(1 for m in have if m[k]["trusted"])))


if __name__ == "__main__":
    main()
