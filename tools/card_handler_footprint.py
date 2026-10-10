#!/usr/bin/env python3
"""Board footprint of each card effect-opcode handler.

§G of the card model was a call map: it said which function an opcode invokes,
not what that function does to the board.  Reading 92 bodies one at a time is the
thorough route; this is the breadth route that makes the call map answerable.

For each handler it reports, from the checked decompilation:

* the STEP BYTE it switches on (`duel+0x422` for most, `duel+0x423` for the
  nested presentation handlers) — this is the per-opcode step protocol;
* every `duel+0xNNN` field it WRITES, separated from those it only reads, since a
  write is a board effect and a read is not;
* the view method slots it drives;
* the other cardgame functions it calls.

A field that is written is a claim about the board that can then be checked; a
handler with no writes is presentation only.  Use this to triage which bodies are
worth reading in full, and to answer "does any opcode touch field X".

**`arg0` is not always the duel.** Effect-opcode handlers take the duel first, so
for them the "duel writes" column means what it says.  But CardDuelView methods
take the VIEW first, and this tool cannot tell the two apart — it only knows the
receiver is named `arg0`.  `F0x80097ACC`, for instance, reports writes to `+0xDF0`
and `+0xDFA`, which are view fields, not duel fields: the duel object is only
0x824 bytes, so any reported offset at or above that is a tell that `arg0` is
something else.  Check the offset against the object's size before believing the
column.

Usage:
    python3 tools/card_handler_footprint.py <dir-of-lifted-c> [--opcode-map FILE]
    python3 tools/card_handler_footprint.py exe-decomp/cardgame_c --writes 0x46F
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# The RECEIVER matters: `arg0->unkNNN` is a duel field, `arg1->unkNNN` is a view
# field, and conflating them invents board effects that do not exist — on
# 2026-08-07 that conflation briefly made four view fields look like board writes
# in the Battle-Phase handlers.
#
# A duel field is reached either directly as `arg0->unkNNN` or, for the many
# arrays in the object, through a computed base `(arg0 + <expr>)->unkNNN`; both
# count.  A receiver that is a local (`temp_s0_5->unkNNN`) is NOT attributed: it
# may well be a duel sub-object such as a per-player block, but which one is a
# question for the body, not for a regex.  Those are listed separately so they are
# visible rather than silently dropped.
DUEL = r'(?:\barg0|\(\s*arg0\s*\+[^)]*\))'
FIELD = re.compile(DUEL + r'->unk([0-9A-Fa-f]{2,4})\b')
WRITE = re.compile(DUEL + r'->unk([0-9A-Fa-f]{2,4})\s*(?:=[^=]|\+=|-=|\|=|&=|\^=)')
OTHER = re.compile(r'\b(?!arg0\b)(\w+)->unk([0-9A-Fa-f]{2,4})\s*(?:=[^=]|\+=|-=|\|=|&=|\^=)')
STEP = re.compile(r'=\s*arg0->unk(42[23])\b')
VIEW = re.compile(r'->unk(E[0-9A-Fa-f]{2}|F[0-9A-Fa-f]{2})\s*\(')
CALL = re.compile(r'\b(F0x[0-9a-f]{8})\s*\(')
# view method slots live at +0xEA0..+0xF44; anything else in that range is a field
VIEW_LO, VIEW_HI = 0xEA0, 0xF44


def analyse(path: Path) -> dict:
    src = path.read_text()
    body = src
    writes, reads = set(), set()
    for m in WRITE.finditer(body):
        writes.add(int(m.group(1), 16))
    for m in FIELD.finditer(body):
        v = int(m.group(1), 16)
        if v not in writes:
            reads.add(v)
    views = set()
    for m in VIEW.finditer(body):
        v = int(m.group(1), 16)
        if VIEW_LO <= v <= VIEW_HI:
            views.add(v)
    other = sorted({(m.group(1), int(m.group(2), 16)) for m in OTHER.finditer(body)})
    steps = {m.group(1) for m in STEP.finditer(body)}
    calls = sorted({m.group(1) for m in CALL.finditer(body)} - {path.stem})
    lifted = 'Decompilation failure' not in src
    return {
        'name': path.stem,
        'lines': len(src.splitlines()),
        'lifted': lifted,
        'step': sorted(steps),
        'writes': sorted(w for w in writes if w not in views),
        'reads': sorted(reads - views),
        'views': sorted(views),
        'calls': calls,
        'other': other,
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('directory', type=Path)
    ap.add_argument('--only', nargs='*', help='restrict to these function names')
    ap.add_argument('--writes', help='list only handlers writing this field, e.g. 0x46F')
    a = ap.parse_args(argv)

    files = sorted(a.directory.glob('F0x*.c'))
    if a.only:
        want = {n.lower() for n in a.only}
        files = [f for f in files if f.stem.lower() in want]
    rows = [analyse(f) for f in files]

    if a.writes:
        target = int(a.writes, 16)
        hit = [r for r in rows if target in r['writes']]
        print(f"handlers writing duel+0x{target:03X}: {len(hit)}")
        for r in hit:
            print(f"  {r['name']}")
        return 0

    unlifted = [r for r in rows if not r['lifted']]
    print(f"# {len(rows)} functions; {len(unlifted)} could not be lifted")
    for r in rows:
        if not r['lifted']:
            print(f"{r['name']}: NOT LIFTED (m2c failure) - must be read in assembly")
            continue
        step = ','.join('+0x' + s.upper() for s in r['step']) or '-'
        print(f"{r['name']} ({r['lines']}L) step={step}")
        if r['writes']:
            print(f"    writes: {', '.join(f'+0x{w:03X}' for w in r['writes'])}")
        if r['other']:
            shown = ', '.join(f"{n}+0x{v:03X}" for n, v in r['other'][:12])
            print(f"    other receivers (NOT duel fields): {shown}")
        if r['views']:
            print(f"    view:   {', '.join(f'+0x{v:03X}' for v in r['views'])}")
        if r['calls']:
            print(f"    calls:  {', '.join(r['calls'])}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
