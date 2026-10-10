#!/usr/bin/env python3
"""Every opcode the duel's OWN drivers latch, read out of the overlay.

WHY THIS EXISTS. Which beats the ceremony issues had only ever been answered
from a rig capture, so the answer was whatever that duel happened to do: one
capture latches 38 opcodes out of 174 and says nothing about the rest. The
drivers themselves are legible. Every ceremony beat is a store of an immediate
into the pending-opcode byte `duel+0x421`, so listing those stores lists the
ceremony -- including the branches a single duel never took.

This does NOT cover opcodes a card program latches; those come from the
program's own step list. It covers what the phase and battle machines issue.

CAVEAT, measured 2026-08-27. A store to the pending byte is not always a
DRIVER issuing a beat: an opcode's own update handler can chain into another
opcode the same way, and the two are indistinguishable from the store alone.
The 0x97 row is one of those — it is opcode 0x96 handing over. Read the
enclosing routine before treating a row as a ceremony beat.

Load base 0x80082CB0: the overlay's labels are file offsets, and RAM = base +
offset (`docs/research/card/card-battle-complete-model-2026-08-06.md`).

Usage:
  python3 tools/cardduel_ceremony_issuers.py [--asm PATH] [--json]
"""
import argparse, json, re

ASM = "/home/dorij/ddw3/asm/dw2003/pro/cardgame.s"
LOAD_BASE = 0x80082CB0
LATCH = 0x421

LABEL = re.compile(r"^\.L0x([0-9a-f]+):")
STORE = re.compile(r"\bsb \$(\w+), 0x%x\(" % LATCH)
IMM = re.compile(r"\bli \$(\w+), (0x[0-9a-f]+)")


def scan(path):
    lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    out = []
    for i, line in enumerate(lines):
        m = STORE.search(line)
        if not m:
            continue
        reg = m.group(1)
        lab = LABEL.match(line.strip())
        addr = LOAD_BASE + int(lab.group(1), 16) if lab else None

        if reg == "zr":
            out.append({"line": i + 1, "address": addr, "op": None,
                        "how": "clear"})
            continue

        # The value is the nearest preceding `li $reg` on the fall-through
        # path. A SECOND arm counts only when some branch jumps straight at
        # this store's own label -- then the `li` in that branch's delay slot
        # reaches it too. Without that test a comparison constant a few lines
        # up gets mistaken for a latched opcode.
        vals = []
        for j in range(i - 1, max(-1, i - 6), -1):
            mi = IMM.search(lines[j])
            if mi and mi.group(1) == reg:
                vals.append(int(mi.group(2), 16))
                break
            if re.search(r"\b(jal|jalr)\b", lines[j]):
                break

        label = lab.group(0).rstrip(":") if lab else None
        if label:
            for j in range(max(0, i - 12), i):
                if re.search(r"\b(beqz|bnez|beq|bne|blez|bgtz)\b.*%s\b" % re.escape(label),
                             lines[j]):
                    mi = IMM.search(lines[j + 1])       # the delay slot
                    if mi and mi.group(1) == reg:
                        v = int(mi.group(2), 16)
                        if v not in vals:
                            vals.append(v)

        if not vals:
            out.append({"line": i + 1, "address": addr, "op": None,
                        "how": "computed or table-driven -- read this one by hand"})
        elif len(vals) == 1:
            out.append({"line": i + 1, "address": addr, "op": vals[0],
                        "how": "immediate"})
        else:
            out.append({"line": i + 1, "address": addr, "op": vals[0],
                        "alt": vals[1:], "how": "one of a pick"})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--asm", default=ASM)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    rows = scan(a.asm)
    if a.json:
        print(json.dumps(rows, indent=1))
        return

    issued, unresolved = set(), 0
    print(f"{'line':>7}  {'address':>10}  op    how")
    for r in rows:
        if r["how"] == "clear":
            continue
        ops = ([r["op"]] + r.get("alt", [])) if r["op"] is not None else []
        for op in ops:
            issued.add(op)
        if not ops:
            unresolved += 1
        shown = " ".join(f"0x{o:02X}" for o in ops) or "?"
        print(f"{r['line']:7d}  0x{r['address']:08X}  {shown:9s} {r['how']}")

    print(f"\n{len(issued)} distinct opcodes latched by the drivers:",
          " ".join(f"0x{o:02X}" for o in sorted(issued)))
    if unresolved:
        print(f"{unresolved} store(s) whose value is not an immediate -- "
              f"these are NOT counted above")


if __name__ == "__main__":
    main()
