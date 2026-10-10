#!/usr/bin/env python3
"""Call-graph closure over one disassembled overlay.

Motivation: `tools/run-overlay-scan.sh loads/stores <ovl> 0xNNN` matches
`lbu/sb $r, 0xNNN($base)` and is **blind** to any field reached through a pointer
computed at the call site, and `dw3-research code-search` cannot see a call whose
target is built in a register.  A zero from either therefore carries no
information about "nothing anywhere does X".  This tool answers that class of
question the only way that is sound: by following the call graph.

What it models, per function:

* direct `jal 0x8...` edges inside the overlay;
* calls through an absolute resident pointer (`lui`/`addiu` then `lw` then
  `jalr`), reported as the imported slot address — this is how the overlay
  reaches the resident kernel, including `RAND_U16 @0x8004DC0C`;
* calls through an object field (`lw $v, 0xNNN($obj)` then `jalr`), reported as
  the field offset, because that is a virtual dispatch whose target is installed
  elsewhere and which no textual search can resolve;
* calls through a pointer reloaded from the stack (`lw $v, 0xNN($sp)`), which are
  counted separately — the offset is a stack slot, not a method slot, so
  attributing it to an object would invent a vtable that does not exist.

Both indirect categories are call-graph *leaks*: `closure` does not follow them,
so a "nothing reachable does X" conclusion is only as strong as the separate
argument that the leaks cannot reach X.  The tool prints them for that reason.

Function boundaries are the union of every `jal` target and every address that
follows a `jr $ra` and its delay slot.

Usage:
    python3 tools/overlay_callgraph.py <overlay.s> closure 0x800a3934 [0x...]
    python3 tools/overlay_callgraph.py <overlay.s> reaches  0x8004dc0c
    python3 tools/overlay_callgraph.py <overlay.s> imports
    python3 tools/overlay_callgraph.py <overlay.s> vslots

Run it under the mandated cap, e.g.
    taskset -c 0 prlimit --as=4294967296 -- python3 tools/overlay_callgraph.py ...
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict

LINE = re.compile(r'^\.L0x([0-9a-f]+): (\S+)\s*(.*)$')
JAL = re.compile(r'^(?:F0x|0x)([0-9a-f]+)$')
LUI = re.compile(r'^\$(\w+), (0x[0-9a-f]+)$')
IMM3 = re.compile(r'^\$(\w+), \$(\w+), (-?0x[0-9a-f]+)$')
IMM2 = re.compile(r'^\$(\w+), (-?0x[0-9a-f]+)$')
LW = re.compile(r'^\$(\w+), (-?0x[0-9a-f]+)\((\$\w+)\)$')
JALR = re.compile(r'^\$(\w+)$')

RESIDENT_LO, RESIDENT_HI = 0x80040000, 0x80070000
NO_DEST = {'sw', 'sh', 'sb', 'swl', 'swr', 'swc1', 'jalr', 'jr', 'j', 'jal',
           'nop', 'div', 'divu', 'mult', 'multu', 'break_'}


def _dest(mnem: str, args: str):
    if mnem in NO_DEST or mnem.startswith('b'):
        return None
    m = re.match(r'^\$(\w+)', args)
    return m.group(1) if m else None


class Overlay:
    def __init__(self, path, load_base=None):
        self.path = path
        self.insns = []            # (addr, mnem, args)
        for line in open(path):
            m = LINE.match(line.split('#')[0].strip())
            if m:
                self.insns.append((int(m.group(1), 16), m.group(2), m.group(3).strip()))
        self.load_base = load_base if load_base is not None else self._infer_base()
        self.index = {a: i for i, (a, _, _) in enumerate(self.insns)}
        self._analyse()

    def _infer_base(self):
        """Labels are file offsets; recover the load base from any jal into the file."""
        offsets = {a for a, _, _ in self.insns}
        counts = defaultdict(int)
        for _, mnem, args in self.insns:
            if mnem == 'jal':
                m = JAL.match(args)
                if m:
                    t = int(m.group(1), 16)
                    for cand in (0x80082CB0, 0x80010000, 0x800A0000):
                        if (t - cand) in offsets:
                            counts[cand] += 1
        return max(counts, key=counts.get) if counts else 0x80082CB0

    def off(self, addr):
        return addr - self.load_base

    def _analyse(self):
        starts = set()
        # every jal target that lands inside the file
        for _, mnem, args in self.insns:
            if mnem == 'jal':
                m = JAL.match(args)
                if m:
                    o = self.off(int(m.group(1), 16))
                    if o in self.index:
                        starts.add(o)
        # every address after a `jr $ra` plus its delay slot
        for i, (a, mnem, args) in enumerate(self.insns):
            if mnem == 'jr' and args == '$ra' and i + 2 < len(self.insns):
                starts.add(self.insns[i + 2][0])
        if self.insns:
            starts.add(self.insns[0][0])
        self.starts = sorted(starts)

        self.calls = defaultdict(set)     # func off -> set of callee offs
        self.imports = defaultdict(set)   # func off -> set of resident slot addrs
        self.vslots = defaultdict(set)    # func off -> set of object field offsets
        self.stackptr = defaultdict(set)  # func off -> set of stack slots called through
        cur = None
        const, ptr, field = {}, {}, {}
        for a, mnem, args in self.insns:
            if a in starts:
                cur = a
                const, ptr, field = {}, {}, {}
            if cur is None:
                continue
            if mnem == 'jal':
                m = JAL.match(args)
                if m:
                    o = self.off(int(m.group(1), 16))
                    if o in self.index:
                        self.calls[cur].add(o)
                    else:
                        self.imports[cur].add(int(m.group(1), 16))
                continue
            if mnem == 'jalr':
                j = JALR.match(args)
                r = j.group(1) if j else None
                if r in ptr and RESIDENT_LO <= ptr[r] < RESIDENT_HI:
                    self.imports[cur].add(ptr[r])
                elif r in field:
                    base, off = field[r]
                    if base in ('sp', 'gp'):
                        self.stackptr[cur].add(off)
                    else:
                        self.vslots[cur].add(off)
                continue
            if mnem == 'lui':
                g = LUI.match(args)
                if g:
                    const[g.group(1)] = int(g.group(2), 16) << 16
                    ptr.pop(g.group(1), None); field.pop(g.group(1), None)
                    continue
            elif mnem in ('addiu', 'ori'):
                g = IMM3.match(args) or IMM2.match(args)
                if g:
                    if g.re is IMM3:
                        dst, src, imm = g.group(1), g.group(2), int(g.group(3), 16)
                    else:
                        dst = src = g.group(1); imm = int(g.group(2), 16)
                    if src in const:
                        const[dst] = (const[src] + imm) & 0xFFFFFFFF
                        ptr.pop(dst, None); field.pop(dst, None)
                        continue
            elif mnem == 'lw':
                g = LW.match(args)
                if g:
                    dst, o, base = g.group(1), int(g.group(2), 16), g.group(3).lstrip('$')
                    const.pop(dst, None)
                    if base in const:
                        ptr[dst] = (const[base] + o) & 0xFFFFFFFF
                        field.pop(dst, None)
                    else:
                        ptr.pop(dst, None)
                        field[dst] = (base, o)
                    continue
            d = _dest(mnem, args)
            if d:
                const.pop(d, None); ptr.pop(d, None); field.pop(d, None)

    def closure(self, entries):
        seen, stack = set(), list(entries)
        while stack:
            f = stack.pop()
            if f in seen:
                continue
            seen.add(f)
            stack.extend(self.calls.get(f, ()))
        return seen

    def fname(self, o):
        return f"F0x{o + self.load_base:08x}"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('overlay')
    ap.add_argument('command', choices=('closure', 'reaches', 'imports', 'vslots'))
    ap.add_argument('args', nargs='*')
    ap.add_argument('--load-base', type=lambda s: int(s, 16), default=None)
    a = ap.parse_args(argv)

    ov = Overlay(a.overlay, a.load_base)
    print(f"# {a.overlay}: {len(ov.insns)} instructions, "
          f"{len(ov.starts)} functions, load base 0x{ov.load_base:08x}")

    if a.command == 'imports':
        tally = defaultdict(set)
        for f, slots in ov.imports.items():
            for s in slots:
                tally[s].add(f)
        for s in sorted(tally):
            print(f"0x{s:08x}  called by {len(tally[s])} function(s): "
                  f"{', '.join(ov.fname(f) for f in sorted(tally[s])[:10])}")
        return 0

    if a.command == 'vslots':
        tally = defaultdict(set)
        for f, offs in ov.vslots.items():
            for o in offs:
                tally[o].add(f)
        for o in sorted(tally):
            print(f"+0x{o:03x}  dispatched from {len(tally[o])} function(s)")
        return 0

    if a.command == 'reaches':
        target = int(a.args[0], 16)
        direct = sorted(f for f, s in ov.imports.items() if target in s)
        print(f"functions calling 0x{target:08x} directly: {len(direct)}")
        for f in direct:
            print(f"  {ov.fname(f)}")
        # who transitively reaches them
        rev = defaultdict(set)
        for f, cs in ov.calls.items():
            for c in cs:
                rev[c].add(f)
        seen, stack = set(direct), list(direct)
        while stack:
            f = stack.pop()
            for p in rev.get(f, ()):
                if p not in seen:
                    seen.add(p); stack.append(p)
        print(f"functions that transitively reach it via direct calls: {len(seen)}")
        return 0

    entries = [int(x, 16) - ov.load_base for x in a.args]
    reach = ov.closure(entries)
    imports = sorted({s for f in reach for s in ov.imports.get(f, ())})
    vslots = sorted({o for f in reach for o in ov.vslots.get(f, ())})
    stack = sorted({o for f in reach for o in ov.stackptr.get(f, ())})
    print(f"entries: {', '.join(ov.fname(e) for e in entries)}")
    print(f"reachable functions (direct jal closure): {len(reach)}")
    for f in sorted(reach):
        print(f"  {ov.fname(f)}")
    print(f"\nresident imports reachable: {len(imports)}")
    for s in imports:
        print(f"  0x{s:08x}")
    print(f"\nobject-field dispatch slots reachable (call-graph leaks): {len(vslots)}")
    for o in vslots:
        print(f"  +0x{o:03x}")
    print(f"\nstack-spilled pointer calls reachable (call-graph leaks): {len(stack)}")
    for o in stack:
        print(f"  $sp+0x{o:02x}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
