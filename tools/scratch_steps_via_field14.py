#!/usr/bin/env python3
"""Read every stage's step program via scene_struct+0x14, with no event-table anchor.

tools/extract_story_steps.py finds the program by walking BACK from the event
table, so a stage with no events is skipped entirely (98 of 294 covered). But the
stage init stores the program pointer into scene_struct+0x14: in wstag320 the
`addiu` building 0x800a71b0 at file 0x184 is immediately followed by
`sw r2, 0x14(r17)` at file 0x188, and 0x800a71b0 is exactly where the known s320
program starts. So the pointer is directly readable.

Walk FORWARD from there over 24-byte records until the op==0 terminator.
"""
import json, struct, sys
sys.path.insert(0, "tools")
import wstag_extract as W

BASE = 0x800A5DE0
STEP = 24
screens = W.load_screens()


def field14_ptr(data):
    """The overlay pointer stored to +0x14 by the init: lui/addiu then sw rX,0x14(rY)."""
    regs = {}
    for o in range(0, min(len(data) - 4, 0x1200), 4):
        w = struct.unpack_from("<I", data, o)[0]
        op, rs, rt, imm = w >> 26, (w >> 21) & 31, (w >> 16) & 31, w & 0xFFFF
        if op == 0x0F:                                  # lui rt, imm
            regs[rt] = imm << 16
        elif op == 9 and rs in regs:                    # addiu rt, rs, imm
            simm = imm - 0x10000 if imm & 0x8000 else imm
            regs[rt] = (regs[rs] + simm) & 0xFFFFFFFF
        elif op == 0x2B and imm == 0x14:                # sw rt, 0x14(rs)
            v = regs.get(rt)
            if v and BASE <= v < BASE + len(data):
                return v
    return None


def program_at(data, off):
    recs = []
    while off + STEP <= len(data):
        ca, aa, cb, ab, op = struct.unpack_from("<HHHHH", data, off)
        p = list(struct.unpack_from("<7H", data, off + 10))
        recs.append((ca, aa, cb, ab, op, p))
        if op == 0:
            break
        if not (1 <= op <= 14) or len(recs) > 128:
            return None                                  # not a program
        off += STEP
    return recs


def main():
    stages = sorted(W.ASM_DIR.glob("wstag*.s"))
    known = json.load(open("web/assets/data/story_steps.json"))["stages"]
    out, agree, disagree, newly = {}, 0, [], 0
    for p in stages:
        stg = p.stem.replace("wstag", "")
        if not stg.isdigit():
            continue
        data = W.overlay_bytes(stg)
        if data is None:
            continue
        ptr = field14_ptr(data)
        if ptr is None:
            continue
        recs = program_at(data, ptr - BASE)
        if not recs:
            continue
        steps = [{"cond_a": ca, "arg_a": aa, "cond_b": cb, "arg_b": ab, "op": op,
                  "params": pp} for (ca, aa, cb, ab, op, pp) in recs]
        out[stg] = steps
        if stg in known:
            k = known[stg]["steps"]
            # the anchored extractor omits the trailing op-0 terminator? compare ops+params
            a = [(s["op"], tuple(s["params"])) for s in steps]
            b = [(s["op"], tuple(s["params"])) for s in k]
            if a == b or a[:-1] == b or a == b[:-1]:
                agree += 1
            else:
                disagree.append(stg)
        else:
            newly += 1
    print(f"overlays with a readable +0x14 program: {len(out)}")
    print(f"  agree with the anchored extractor: {agree}")
    print(f"  DISAGREE: {len(disagree)} {disagree[:12]}")
    print(f"  newly covered (no anchored program): {newly}")
    json.dump(out, open(sys.argv[0] + ".json", "w"))


main()
