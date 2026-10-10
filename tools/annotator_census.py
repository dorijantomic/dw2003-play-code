#!/usr/bin/env python3
"""Re-derive the census of 0x1002 draw-context callers and check the port's list.

The service is reached through the registry getter at 0x8004DF8C, which the
overlays load as `lui $v?, 0x8005` / `lw $v?, -0x2074($v?)` -- the assembler
prints that instruction's word as 0x8c42df8c. This tool finds every such load in
every overlay and in the EXE, resolves the `$a0` in effect at the `jalr` that
consumes it, and keeps the sites whose id is 0x1002.

    usage: tools/annotator_census.py [--check] [--list]

`--check` fails when the code's list (engine/systems/shape-annotator.ts,
ANNOTATOR_STAGE_USERS) differs from what this finds, so a stage overlay that
grows a new caller cannot land without being added to the port.
"""
from __future__ import annotations

import argparse
import glob
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASM = os.path.expanduser("~/ddw3/asm/dw2003")
PORT = os.path.join(REPO, "engine/systems/shape-annotator.ts")

GETTER = re.compile(r"^\.L[0-9a-fx]+:\s*lw\s+\$\w+, -0x2074\(\$\w+\)")
JALR = re.compile(r"^\.L[0-9a-fx]+:\s*jalr\s+")
A0_IMM = re.compile(r"^\.L[0-9a-fx]+:\s*(?:li|addiu|ori)\s+\$a0, (\S+)")
A0_MOVE = re.compile(r"^\.L[0-9a-fx]+:\s*move_\s+\$a0, (\$\w+)")
A0_LOAD = re.compile(r"^\.L[0-9a-fx]+:\s*(?:lw|lhu|lb|lbu|lh)\s+\$a0,")

# The slot each site reaches for after the getter. Read from the first `lw $v?,
# 0xNN($reg)` at or after the call, and named here so the list reads as prose.
SLOT_NAMES = {
    0x128: "cull",
    0x14c: "queue",
    0x11c: "scroll",
    0x12c: "tint",
    0x154: "flush",
    0x4: "emit",
}


def scan(path: str) -> list[tuple[str, str]]:
    """[(id-at-call, file-offset-label)] for every getter site in one file."""
    lines = open(path).read().split("\n")
    out = []
    for i, line in enumerate(lines):
        if not (GETTER.match(line) and "lw " in line):
            continue
        start = 0
        for k in range(i, -1, -1):
            if lines[k].startswith(".global"):
                start = k
                break
        call = None
        for k in range(i, min(i + 70, len(lines))):
            if JALR.match(lines[k]):
                call = k
                break
        if call is None:
            continue
        ident = None
        m = A0_IMM.match(lines[call + 1]) if call + 1 < len(lines) else None
        if m:
            ident = m.group(1)
        if ident is None:
            for k in range(call, i, -1):
                m = A0_IMM.match(lines[k])
                if m:
                    ident = m.group(1)
                    break
                m = A0_MOVE.match(lines[k])
                if m:
                    ident = "mov " + m.group(1)
                    break
        if ident is None:
            for k in range(i, start - 1, -1):
                m = A0_IMM.match(lines[k])
                if m:
                    ident = m.group(1)
                    break
                m = A0_MOVE.match(lines[k])
                if m:
                    ident = "mov " + m.group(1)
                    break
                if A0_LOAD.match(lines[k]):
                    ident = "load"
                    break
        if ident != "0x1002":
            continue
        slot = None
        for k in range(call, min(call + 20, len(lines))):
            m = re.search(r"lw \$v0, (0x[0-9a-f]+)\(\$", lines[k])
            if m:
                slot = SLOT_NAMES.get(int(m.group(1), 16), m.group(1))
                break
        label = line.split(":")[0].strip().replace(".L0x", "")
        out.append((label, slot or "emit"))
    return out


def sites(rows: list[tuple[str, str, str]]) -> list[tuple[str, int]]:
    """[(overlay, file offset)] -- the member list the census compares."""
    return [(name, int(site, 16)) for name, site, _ in rows]


def census() -> list[tuple[str, str, str]]:
    rows: list[tuple[str, str, str]] = []
    for path in sorted(glob.glob(os.path.join(ASM, "pro", "*.s"))):
        name = os.path.basename(path)[: -len(".s")]
        for label, slot in scan(path):
            rows.append((name, label, slot))
    return rows


def port_rows() -> list[tuple[str, str, str]]:
    text = open(PORT).read()
    body = text[text.index("ANNOTATOR_STAGE_USERS: readonly AnnotatorStageUser[] = [") :]
    body = body[: body.index("];")]
    rows = []
    for m in re.finditer(r'overlay: "([^"]+)", site: "([^"]+)", slot: "([^"]+)"', body):
        rows.append((m.group(1), m.group(2), m.group(3)))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    found = census()
    if args.list:
        for name, site, slot in found:
            print(f"{name:<16} {site:<10} {slot}")
        print(f"{len(found)} sites")
        return 0

    want = sites(found)
    have = [(name, int(site, 16)) for name, site, _ in port_rows()]
    ok = True
    if len(want) != len(have):
        print(f"annotator_census: assembly has {len(want)} 0x1002 sites, the port lists {len(have)}", file=sys.stderr)
        ok = False
    for a, b in zip(want, have):
        if a != b:
            print(f"annotator_census: assembly {a} != port {b}", file=sys.stderr)
            ok = False
    if not ok:
        return 1
    if args.check:
        print(f"annotator_census: {len(found)} sites in {len({r[0] for r in found})} files match the port")
        return 0
    for name, site, slot in found:
        print(f"{name:<16} {site:<10} {slot}")
    return 0


if __name__ == "__main__":
    sys.exit(main())