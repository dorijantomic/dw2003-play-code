#!/usr/bin/env python3
"""Measure the field scene engine's shared vs per-place parts across all wstag overlays.

Answers four questions from the disc's own artefacts (read-only):

  1. words per overlay: DATA vs CODE, and how much of the data is the two
     tables the converter actually reads (the 24-byte position-step program and
     the 20-byte event table);
  2. per-place ROUTINES by kind: arrival dispatch (calls start_event
     0x800853f8), completion routine (an event record's on_complete_fn),
     native_fn (an event record's in-overlay native_fn), other;
  3. the most common per-place routine SHAPES (decoded family first, then a
     masked-body cluster for the residue);
  4. how many of the routines are byte-identical copies of another overlay's
     routine (the "shared code" the disc has as copies, not as a library).

Routine identity and bounds come from recovered/ddw3/function-inventory.json
(function starts + provisional ends); each body is re-cut at the NEXT function
start in the same module, which is tighter than the inventory's provisional end
and is what makes the exact-body counts in (4) meaningful.
"""
import collections, json, os, re, sys

ASM = os.path.expanduser("~/ddw3/asm/dw2003/pro")
LBL = re.compile(r"^\.L0x([0-9a-f]{8}):\s*(.*)$")
DATA = re.compile(r"^\.(word|byte|half|short|float|dword|space|asciz|ascii)\b")
START_EVENT = "jal 0x800853f8"


def parse(stage):
    path = os.path.join(ASM, "wstag%s.s" % stage)
    if not os.path.exists(path):
        return None
    blocks = collections.OrderedDict()
    cur = None
    with open(path, errors="replace") as fh:
        for raw in fh:
            m = LBL.match(raw)
            if m:
                cur = int(m.group(1), 16)
                blocks[cur] = []
                if m.group(2).strip():
                    blocks[cur].append(m.group(2))
            elif cur is not None and raw.strip() and not raw.lstrip().startswith("#"):
                blocks[cur].append(raw)
    out = {}
    for off, lines in blocks.items():
        body = [l.split("#")[0].strip() for l in lines]
        body = [l for l in body if l]
        if not body:
            out[off] = ("empty", [])
        elif all(DATA.match(l) for l in body):
            out[off] = ("data", body)
        elif any(DATA.match(l) for l in body):
            out[off] = ("mixed", body)
        else:
            out[off] = ("code", body)
    return out, (max(out) + 4 if out else 0)


def masked_shape(body):
    """Cluster key: opcode + register operands; immediates and branch targets masked."""
    out = []
    for l in body:
        toks = l.split()
        if not toks:
            continue
        regs = []
        for t in toks[1:]:
            t = t.split(",")[0].strip()
            if t.startswith("$"):
                regs.append(t)
            elif re.match(r"^-?(0x[0-9a-f]+|\d+)$", t):
                regs.append("#")
            elif t.startswith(".L"):
                regs.append("L")
            else:
                regs.append(t)
        out.append(toks[0] + " " + " ".join(regs))
    return "\n".join(out)


def main(out_path=None):
    ev = json.load(open("web/assets/events/wstag_events.json"))
    steps = json.load(open("web/assets/data/story_steps.json"))["stages"]
    inv = json.load(open("recovered/ddw3/function-inventory.json"))
    mods = {m["id"].split("/")[-1]: m for m in inv["modules"] if m["id"].startswith("pro/wstag")}
    sem_fam = {}
    for m in inv["modules"]:
        for f in m["functions"]:
            if f.get("semantic_family"):
                sem_fam[f["id"]] = f["semantic_family"]

    stages = sorted(set([s.replace("wstag", "") for s in mods]))
    T = collections.Counter()
    rows = []
    fam_all = collections.Counter()
    shape_other = collections.Counter()
    shape_arrival = collections.Counter()
    shape_completion = collections.Counter()
    fns_by_shape = collections.defaultdict(list)
    example_bodies = {}
    exact = collections.Counter()

    for st in stages:
        sid = "s" + st
        p = parse(st)
        if not p:
            continue
        blocks, size = p
        words = size // 4
        data = sum(len(b) for k, b in blocks.values() if k == "data")
        code = sum(len(b) for k, b in blocks.values() if k in ("code", "mixed"))
        ss = steps.get(st, {})
        stepprog = len(ss.get("steps", [])) * 6            # 24 bytes = 6 words
        nev = len(ev.get(sid, []))
        evtable = (nev + 1) * 5                          # 20B/record + terminator

        m = mods.get("wstag" + st)
        fns = sorted(((int(f["file_offset"], 16), f["id"]) for f in (m["functions"] if m else [])))
        # AGENTS.md: the disassembler's function-start list misses the routines a
        # constructor installs as method pointers. The inventory's
        # pointer_candidates are exactly those, so add the ones that are not
        # already a start -- the real per-place routine count is at least this.
        have = {o for o, _ in fns}
        extra = 0
        if m:
            starts = {f["address"] for f in m["functions"]}
            for p in m["pointer_candidates"]:
                t = p.get("address")
                if not t or t in starts:
                    continue
                o = int(p.get("file_offset", "0"), 16)
                if o not in have:
                    fns.append((o, "pro/wstag%s:%s(ptr)" % (st, t)))
                    have.add(o)
                    extra += 1
            fns.sort()
        T["installed_ptr_starts"] += extra
        offs = [o for o, _ in fns]
        rout = []
        for i, (off, fid) in enumerate(fns):
            end = offs[i + 1] if i + 1 < len(offs) else size
            body = [x for o, (k, b) in sorted(blocks.items()) if off <= o < end and k in ("code", "mixed") for x in b]
            rout.append((off, fid, body))

        evs = ev.get(sid, [])
        completion = {e["on_complete_fn"] for e in evs if e.get("on_complete_fn")}
        native = {e["native_fn"] for e in evs if e.get("native_fn")}
        arrival, comp, nat, other = set(), set(), set(), []
        for off, fid, body in rout:
            txt = "\n".join(body)
            if START_EVENT in txt:
                arrival.add(off)
                shape_arrival[masked_shape(body)] += 1
                fam_all["ARRIVAL/" + (sem_fam.get(fid) or "<no family>")] += 1
            elif off in completion:
                comp.add(off)
                shape_completion[masked_shape(body)] += 1
                fns_by_shape[masked_shape(body)].append((st, off))
                example_bodies["%s@%x" % (st, off)] = body
            elif off in native:
                nat.add(off)
            else:
                other.append((off, fid, body))
                shape_other[masked_shape(body)] += 1
            exact[txt] += 1
            fam = sem_fam.get(fid)
            if fam:
                fam_all[fam] += 1
        rows.append(dict(stage=sid, words=words, data=data, code=code,
                         stepprog=stepprog, evtable=evtable, routines=len(rout),
                         arrival=len(arrival), completion=len(comp),
                         native=len(nat), other=len(other)))
        T["words"] += words; T["data"] += data; T["code"] += code
        T["stepprog"] += stepprog; T["evtable"] += evtable
        T["routines"] += len(rout); T["arrival"] += len(arrival)
        T["completion"] += len(comp); T["native"] += len(nat); T["other"] += len(other)

    print("overlays measured: %d" % len(rows))
    print("per-place routine starts: %d = %d inventory function starts + %d constructor-installed "
          "method pointers the list misses"
          % (T["routines"], T["routines"] - T["installed_ptr_starts"], T["installed_ptr_starts"]))
    print("\n== 1. words ==")
    print("overlay words        %7d" % T["words"])
    print("  data words         %7d  (%.1f%%)" % (T["data"], 100 * T["data"] / T["words"]))
    print("  code words         %7d  (%.1f%%)" % (T["code"], 100 * T["code"] / T["words"]))
    print("  of the DATA, the two tables the converter reads:")
    print("    step program     %7d  (%.1f%% of data)" % (T["stepprog"], 100 * T["stepprog"] / max(T["data"], 1)))
    print("    event table      %7d  (%.1f%% of data)" % (T["evtable"], 100 * T["evtable"] / max(T["data"], 1)))
    print("    both              %7d  (%.1f%% of data, %.2f%% of all words)"
          % (T["stepprog"] + T["evtable"], 100 * (T["stepprog"] + T["evtable"]) / max(T["data"], 1),
             100 * (T["stepprog"] + T["evtable"]) / T["words"]))

    print("\n== 2. per-place routines by kind ==")
    for k, lbl in (("routines", "all"), ("arrival", "arrival dispatch (jal start_event)"),
                   ("completion", "completion routine (event on_complete_fn)"),
                   ("native", "native_fn (event native_fn, in overlay)"),
                   ("other", "other")):
        print("  %-22s %6d  (%4.1f%%)" % (lbl, T[k], 100 * T[k] / max(T["routines"], 1)))
    scene = T["arrival"] + T["completion"] + T["native"]
    print("  %-22s %6d  (%4.1f%% of all, %4.1f%% of 'other')"
          % ("scene-system total", scene, 100 * scene / max(T["routines"], 1),
             100 * scene / max(T["routines"] - scene, 1)))

    print("\n== 3. most common per-place routine shapes ==")
    print("-- decoded families (from recovered semantics), top 8 --")
    for k, v in fam_all.most_common(8):
        print("  %4d  %s" % (v, k))
    print("-- unmasked exact-body clusters over 'other' routines, top 8 --")
    tot_other = sum(shape_other.values())
    acc = 0
    for i, (k, v) in enumerate(shape_other.most_common(8), 1):
        acc += v
        print("  %4d (%4.1f%% of other, cum %4.1f%%)  %d instructions: %s"
              % (v, 100 * v / max(tot_other, 1), 100 * acc / max(tot_other, 1),
                 len(k.split("\n")), " / ".join(k.split("\n")[:4])))
    print("-- arrival-dispatch bodies, top 5 clusters (immediates + branch targets masked) --")
    for i, (k, v) in enumerate(shape_arrival.most_common(5), 1):
        print("  %4d  %d instructions: %s" % (v, len(k.split("\n")), " / ".join(k.split("\n")[:5])))
    print("-- completion-routine bodies, top 5 clusters (immediates masked) --")
    for i, (k, v) in enumerate(shape_completion.most_common(5), 1):
        print("  %4d  %d instructions: %s" % (v, len(k.split("\n")), " / ".join(k.split("\n")[:5])))

    print("\n== 4. how much per-place CODE is a byte-identical copy of another overlay's routine ==")
    dup = sum(v for k, v in exact.items() if v > 1)
    print("  routines whose exact body appears more than once: %d of %d (%.1f%%)"
          % (dup, sum(exact.values()), 100 * dup / max(sum(exact.values()), 1)))
    print("  distinct bodies: %d" % len(exact))
    print("  five largest exact-copy clusters:")
    for k, v in [x for x in exact.most_common() if x[1] > 1 and len(x[0]) > 20][:5]:
        print("    %4d copies  %3d instructions  %s" % (v, len(k.split("\n")),
                                                       " / ".join(x for x in k.split("\n")[:3])))

    for k, v in shape_completion.most_common(5):
        ex = fns_by_shape.get(k, [])
        if not ex:
            continue
        print("\n---- completion shape x%d  example s%s file 0x%x ----" % (v, ex[0][0], ex[0][1]))
        print("\n".join(example_bodies.get("%s@%x" % (ex[0][0], ex[0][1]), [])[:32]))
    if out_path:
        json.dump({"totals": dict(T), "per_stage": rows, "families": dict(fam_all),
                   "arrival_shapes": [{"n": v, "instructions": len(k.split("\n"))}
                                      for k, v in shape_arrival.most_common(12)],
                   "other_shapes": [{"n": v, "instructions": len(k.split("\n")),
                                     "head": k.split("\n")[:6]}
                                    for k, v in shape_other.most_common(12)]},
                  open(out_path, "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
