#!/usr/bin/env python3
"""Digest a UI overlay's decompiled routines into an ordered trace of the calls
that decide what a player sees: window folds, fold waits, sprite draws with
their fold pivots, text-widget creation, palette/face changes and SFX.

This is a READER, not a claim. It prints `file:line` for every row so anything
it shows can be quoted straight into an evidence packet.

Usage: ui_screen_digest.py <dir-with-F0x*.c> [F0xADDR ...]
"""
import re
import sys
import pathlib

CASE = re.compile(r'^\s*(case (0x[0-9A-Fa-f]+|\d+):|default:)')
PATTERNS = [
    # window fold start: through the service table or the direct pointer
    ("FOLD_START", re.compile(r'(?:unk670|0x8009B5D8)\)?\((arg0 \+ (0x[0-9A-Fa-f]+)|[^,]+), (\d)\)')),
    ("FOLD_WAIT",  re.compile(r'(?:unk674|0x8009B5DC)\)?\((arg0 \+ (0x[0-9A-Fa-f]+)|[^)]+)\)')),
    ("TWEEN_START", re.compile(r'(?:unk678|0x8009B5E0)\)?\(([^;]+)\)')),
    ("TWEEN_WAIT",  re.compile(r'(?:unk67C|0x8009B5E4)\)?\(([^;]+)\)')),
    ("SFX",        re.compile(r'0x80055C48\)?\(([^)]*)\)')),
    ("PIVOT",      re.compile(r'\bspA4\((0x[0-9A-Fa-f]+|\d+), (0x[0-9A-Fa-f]+|\d+)\)')),
    ("SCALE",      re.compile(r'\bsp9C\(([^)]*)\)')),
    ("DRAW",       re.compile(r'\bsp94\(([^;]+)\);')),
    ("CLUTROW",    re.compile(r'\bsp98\(([^)]*)\)')),
    ("ORIGIN",     re.compile(r'\bsp84\((0x[0-9A-Fa-f]+|\d+), (0x[0-9A-Fa-f]+|\d+)\)')),
    ("TEXT_NEW",   re.compile(r'F0x8001ae38\(([^;]+)\)')),
    ("CURSOR_NEW", re.compile(r'F0x8001b364\(([^;]+)\)')),
    ("SET_STR",    re.compile(r'->unk114\(([^;]+)\)')),
    ("SET_NUM",    re.compile(r'->unk118\(([^;]+)\)')),
    ("SET_XY",     re.compile(r'->unk84\(([^;]+)\)')),
    ("PALETTE",    re.compile(r'->unk88\(([^;]+)\)')),
    ("COLOUR",     re.compile(r'->unk138\(([^;]+)\)')),
    ("HIDDEN",     re.compile(r'->unk80\(([^;]+)\)')),
    ("HIDE_STR",   re.compile(r'->unk144\(([^;]+)\)')),
    ("RIGHT_ALIGN", re.compile(r'->unk148\(([^;]+)\)')),
    ("GUARD",      re.compile(r'=\s*arg0->(unk[0-9A-Fa-f]+);')),
    ("STATE_SET",  re.compile(r'arg0->unk10 = ')),
    ("CALL",       re.compile(r'\b(F0x[0-9a-f]{8})\(')),
]

def digest(path):
    out = [f"--- {path.name}"]
    case = None
    for n, line in enumerate(path.read_text().splitlines(), 1):
        m = CASE.match(line)
        if m:
            case = m.group(0).strip()
            out.append(f"  {n:4d} [{case}]")
            continue
        hits = []
        for name, rx in PATTERNS:
            for g in rx.finditer(line):
                hits.append(f"{name}({g.group(1) if g.lastindex else ''}{',' + g.group(2) if name=='PIVOT' or name=='ORIGIN' else ''})")
        if hits:
            out.append(f"  {n:4d}      " + " ".join(hits))
    return "\n".join(out)

def main():
    d = pathlib.Path(sys.argv[1])
    names = sys.argv[2:]
    files = [d / f"{n}.c" for n in names] if names else sorted(d.glob("F0x*.c"))
    for f in files:
        if f.exists():
            print(digest(f))
        else:
            print(f"--- {f.name} MISSING")

main()
