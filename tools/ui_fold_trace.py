#!/usr/bin/env python3
"""Trace one screen object's window choreography: which window opens or closes
in which state, what it waits for, which slide tween runs, and which sound
plays. Reads the decompiled tick routine; prints one line per event with its
source line so every row can be quoted as evidence.

Usage: ui_fold_trace.py <dir> F0xADDR [F0xADDR ...]
"""
import re, sys, pathlib

CASE = re.compile(r'^\s*(?:case (0x[0-9A-Fa-f]+|\d+):|(default):)')
EV = [
 ("open/close", re.compile(r'(?:unk670|0x8009B5D8)\)?\(\s*(?:arg0 \+ )?(0x[0-9A-Fa-f]+|var_a0|[A-Za-z0-9_]+)\s*,\s*(\d)\s*\)')),
 ("wait",       re.compile(r'(?:unk674|0x8009B5DC)\)?\(\s*(?:arg0 \+ )?(0x[0-9A-Fa-f]+|var_a0|[A-Za-z0-9_]+)\s*\)')),
 ("slide",      re.compile(r'(?:unk678|0x8009B5E0)\)?\(\s*(?:arg0 \+ )?(0x[0-9A-Fa-f]+)\s*,\s*(-?\w+)\s*,\s*(-?\w+)\s*,\s*(\d+)\s*\)')),
 ("slide-wait", re.compile(r'(?:unk67C|0x8009B5E4)\)?\(\s*(?:arg0 \+ )?(0x[0-9A-Fa-f]+)\s*\)')),
 ("sfx",        re.compile(r'0x80055C48\)?\(\s*(0x[0-9A-Fa-f]+)\s*\)')),
 ("goto-state", re.compile(r'var_v0(?:_\d+)? = (0x[0-9A-Fa-f]+|\d+);')),
 ("set-state",  re.compile(r'arg0->unk10 = \(?(?:u32\) )?\(?([^;]+);')),
 ("lifecycle",  re.compile(r'arg0->unkC = (\d+);')),
]

for name in sys.argv[2:]:
    p = pathlib.Path(sys.argv[1]) / f"{name}.c"
    print(f"===== {name}")
    if not p.exists():
        print("  MISSING"); continue
    case = "(entry)"
    for n, line in enumerate(p.read_text().splitlines(), 1):
        m = CASE.match(line)
        if m:
            case = m.group(1) or m.group(2)
            print(f"  state {case}")
            continue
        for label, rx in EV:
            for g in rx.finditer(line):
                args = ",".join(x for x in g.groups() if x is not None)
                print(f"    {n:5d} {label:11s} {args}")
