#!/usr/bin/env python3
"""Extract typed zonemgr resource ids from wstag overlay init stubs.

Each per-map wstag overlay init seeds the scene struct, then calls the field zonemgr
`set_resource(type, id)` method at `0x8009b6c4 + 0x40`.

Two call shapes matter:

1. Compact registrations, common for type-7 and type-4:

    li   $a0, <type>
    lui  $a1, <hi>
    lw   $v0, 0x40($s0)
    jalr $v0
    ori  $a1, <lo>

2. Expanded first registrations, common for type-0:

    move_ $a0, $zr            # type 0
    lui   $a1, <hi>
    ori   $a1, <lo>
    ... scene init stores ...
    lw    $v1, 0x40($s0)
    jalr  $v1
    sw    $ptr, 0x20($scene)  # unrelated delay-slot store

The earlier extractor only matched the compact shape, so it missed authentic type-0
registrations on stages like the gym maps. Here we parse the textual disasm, track the
current immediate values in `$a0`/`$a1`, and record any call that goes through a just-loaded
`lw $v?, 0x40($r)` zonemgr method cell.
"""
import glob, re

INSTR = re.compile(r'^\S+:\s+([A-Za-z0-9_]+)\s*(.*?)\s+#')
LW_METHOD = re.compile(r'^\$(\w+),\s*0x40\(\$(\w+)\)$')
REG_WRITE = re.compile(r'^\$(\w+)')


def parse_int(token):
    token = token.strip()
    if token.startswith("-0x"):
        return -int(token[3:], 16)
    return int(token, 0)


def instructions(path):
    out = []
    for line in open(path):
        if "# End of code" in line:
            break
        m = INSTR.match(line)
        if not m:
            continue
        op = m.group(1)
        args = [a.strip() for a in m.group(2).split(",") if a.strip()]
        out.append((op, args))
    return out


def parse(path):
    ins = instructions(path)
    res = {}
    regs = {"a0": None, "a1": None}
    pending_method_reg = None
    for i, (op, args) in enumerate(ins):
        if op == "li" and len(args) == 2 and args[0] in {"$a0", "$a1"}:
            regs[args[0][1:]] = parse_int(args[1])
        elif op in {"move", "move_"} and len(args) == 2 and args[0] in {"$a0", "$a1"}:
            regs[args[0][1:]] = 0 if args[1] == "$zr" else None
        elif op == "lui" and len(args) == 2 and args[0] == "$a1":
            regs["a1"] = parse_int(args[1]) << 16
        elif op == "ori" and len(args) == 2 and args[0] == "$a1":
            if regs["a1"] is not None:
                regs["a1"] |= parse_int(args[1]) & 0xffff
        else:
            m = REG_WRITE.match(args[0]) if args else None
            if m and m.group(1) in regs:
                regs[m.group(1)] = None

        if op == "lw" and len(args) == 2:
            m = LW_METHOD.match(", ".join(args))
            pending_method_reg = m.group(1) if m else None
            continue

        if op == "jalr" and len(args) == 1 and pending_method_reg and args[0] == f"${pending_method_reg}":
            t = regs["a0"]
            rid = regs["a1"]
            if i + 1 < len(ins):
                next_op, next_args = ins[i + 1]
                if next_op == "ori" and len(next_args) == 2 and next_args[0] == "$a1" and rid is not None:
                    rid |= parse_int(next_args[1]) & 0xffff
            if isinstance(t, int) and isinstance(rid, int) and 0 <= t <= 0x20:
                res.setdefault(t, []).append(rid)
            pending_method_reg = None
            continue

        if args:
            m = REG_WRITE.match(args[0])
            if m and pending_method_reg and m.group(1) == pending_method_reg:
                pending_method_reg = None
    return res

def main():
    files = sorted(glob.glob('/home/dorij/ddw3/asm/dw2003/pro/wstag*.s'))
    type4 = {}
    alltypes = {}
    for f in files:
        stage = re.search(r'wstag(\d+)', f).group(1)
        r = parse(f)
        for t, ids in r.items():
            alltypes.setdefault(t, 0)
            alltypes[t] += len(ids)
        if 4 in r:
            type4[stage] = r[4]
    print("resource types registered across wstag overlays (type -> #calls):")
    for t in sorted(alltypes): print(f"  type {t}: {alltypes[t]}")
    print(f"\nstages registering a TYPE-4 zone map: {len(type4)}")
    for stage in sorted(type4, key=int):
        ids = type4[stage]
        print(f"  s{stage}: " + ", ".join(hex(x) for x in ids))

if __name__ == '__main__':
    main()
