#!/usr/bin/env python3
"""Census of the diagonal scrolling backdrop wall, from the original assembly.

One code shape, ten screens. A screen's wall advances one pixel every SECOND
vertical blank and is drawn at (counter, counter), which is the whole reason it
moves down-right instead of sideways:

    lw    $v0, <toggle>($sN)          # a companion flag next to the counter
    beqz  $v0, <set-toggle>           # not set -> set it, do NOT advance
    lw    $v0, <counter>($sN)
    addiu $v1, $v0, 0x1               # +1
    slti  $v0, $v1, 0x60              # ... only while it stays below 0x60
    beqz  $v0, <store-zero>           # otherwise 0; it never HOLDS 0x60
    sw    $v1, <counter>($sN)
    ...
    li    $a1, <clip>                 # the wall clip (stgtrain reads a field)
    lw    $a2, <counter>($sN)         # x = counter
    jalr  $v0
    move_ $a3, $a2                    # y = counter, in the DELAY SLOT

The matcher looks for all three parts and refuses anything that has not got
them, because the delay-slot `move_ $a3, $a2` on its own is a general diagonal
draw (the stage overlays use it for shadows) and a `slti` on its own is a
bound of no particular interest:

  1. the wrap: `slti $vA, $vB, 0x60`, or its short form `slti $vA, 0x5f`
     (pro/stdgname.s:3548 writes the naming screen's bound as 0x5f in the
     two-operand short form, which is the same 96 phases);
  2. the draw, within the next 40 lines: a `jalr` whose DELAY SLOT is
     `move_ $a3, $a2` (word 0x00c03821);
  3. the arguments of that draw: `lw $a2, <counter>($reg)` for x, and the clip
     from `li $a1, <clip>` or, for stgtrain, `lw $a1, <field>($reg)`.

The toggle is the word loaded into the tested register immediately before the
`beqz` that guards the increment.

Writes data/scrolling_walls.json. Reads ~/ddw3/asm/dw2003/{pro,exe}/*.s, which
is read-only evidence and is never written here.

Usage:
    taskset -c 0 prlimit --as=4294967296 -- .venv/bin/python3 \
        tools/extract_scroll_walls.py [--asm ROOT] [--out data/scrolling_walls.json]
"""
from __future__ import annotations

import argparse
import json
import os
import re
from typing import Any

DEFAULT_ASM = os.path.expanduser("~/ddw3/asm/dw2003")
DEFAULT_OUT = "data/scrolling_walls.json"

#: `slti $v0, $v1, 0x60` (long form) and `slti $v0, 0x5f` (short form).
WRAP = re.compile(r"^slti\s+\$v(?P<rd>[01]),\s*(?:\$v[01],\s*)?0x(?P<bound>[0-9a-f]+)\b")
#: The diagonal draw: the delay slot of a `jalr`. The word is checked separately,
#: because split_line() has already dropped the `# .word` comment.
DELAY_SLOT = re.compile(r"^move_\s+\$a3,\s*\$a2$")
DELAY_SLOT_WORD = "0x00c03821"
JALR = re.compile(r"^jalr\s")
#: `lw $a2, 0x54($s0)` — x, and for stgtrain the clip id, come from a field.
LOAD_A2 = re.compile(r"^lw\s+\$a2,\s*0x(?P<off>[0-9a-f]+)\(\$(?P<reg>\w+)\)")
LOAD_A1_FIELD = re.compile(r"^lw\s+\$a1,\s*0x(?P<off>[0-9a-f]+)\(\$(?P<reg>\w+)\)")
LI_A1 = re.compile(r"^li\s+\$a1,\s*0x(?P<clip>[0-9a-f]+)\b")
#: The toggle: the load immediately before the `beqz` that guards the advance.
LOAD_V = re.compile(r"^lw\s+\$v(?P<reg>[01]),\s*0x(?P<off>[0-9a-f]+)\(\$(?P<base>\w+)\)")
BEQZ_V = re.compile(r"^beqz\s+\$v(?P<reg>[01]),")

WINDOW = 40  # lines between the wrap and its draw
LOOK_BACK = 24  # lines the toggle's load may sit above the wrap's `beqz`


def split_line(text: str) -> tuple[str, int]:
    """The mnemonic part of an assembly line, and its 1-based line number."""
    line = text.rstrip("\n")
    body = line.split("#", 1)[0].strip()
    label = ""
    if ":" in body:
        label, body = body.split(":", 1)
        label = label.strip()
        body = body.strip()
    number = 0
    m = re.match(r"^\.L(?P<addr>[0-9a-f]+):", label or "")
    if m:
        number = int(m.group("addr"), 16)
    return body, number


def toggle_offset(lines: list[tuple[str, int]], wrap_index: int) -> str | None:
    """The offset loaded into the register the advance's `beqz` tests.

    That load sits ABOVE the `beqz` and BELOW the counter's own load, so the
    search starts at the `beqz` and walks up until it finds the load of the
    register the branch tested — the counter's load would otherwise answer.
    """
    low = max(0, wrap_index - LOOK_BACK)
    for i in range(wrap_index, low - 1, -1):
        branch = BEQZ_V.match(lines[i][0])
        if not branch:
            continue
        reg = branch.group("reg")
        for k in range(i - 1, low - 1, -1):
            load = LOAD_V.match(lines[k][0])
            if load and load.group("reg") == reg:
                return f"0x{load.group('off')}"
        return None
    return None


def scan(path: str) -> list[dict[str, Any]]:
    """Every wall site in one overlay, with the file line of each part."""
    with open(path, errors="replace") as handle:
        raw = handle.readlines()
    lines = [split_line(text) for text in raw]
    sites: list[dict[str, Any]] = []
    for i, (body, _) in enumerate(lines):
        wrap = WRAP.match(body)
        if not wrap:
            continue
        bound = int(wrap.group("bound"), 16)
        # The counter's period is 96 phases; the bound is 0x5f or 0x60 written
        # either way, and both stop it before the 97th value.
        if bound not in (0x5F, 0x60):
            continue
        for j in range(i + 1, min(len(lines), i + WINDOW)):
            if not (DELAY_SLOT.match(lines[j][0]) and DELAY_SLOT_WORD in raw[j]):
                continue
            # The word must really sit in a branch/jump delay slot, which is the
            # whole reason y equals x: the instruction after `jalr` executes.
            if j == 0 or not JALR.match(lines[j - 1][0]):
                continue
            counter = None
            clip = None
            clip_field = None
            for k in range(j, max(i - 1, j - 8), -1):
                a2 = LOAD_A2.match(lines[k][0])
                if a2 and counter is None:
                    counter = f"0x{a2.group('off')}"
                field = LOAD_A1_FIELD.match(lines[k][0])
                if field and clip is None and clip_field is None:
                    clip_field = f"0x{field.group('off')}"
                li = LI_A1.match(lines[k][0])
                if li and clip is None:
                    # Two hex digits, so 0x8 and 0x08 are the same spelling.
                    clip = f"0x{int(li.group('clip'), 16):02x}"
            if counter is None:
                break
            sites.append({
                "wrap_file_line": i + 1,
                "wrap_text": raw[i].strip(),
                "wrap_bound": f"0x{bound:02x}",
                "counter": counter,
                "toggle": toggle_offset(lines, i),
                "clip": clip,
                "clip_field": clip_field,
                "draw_file_line": j + 1,
                "draw_text": raw[j].strip(),
            })
            break
    return sites


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asm", default=DEFAULT_ASM)
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args()

    overlays: list[dict[str, Any]] = []
    for directory in ("pro", "exe"):
        base = os.path.join(args.asm, directory)
        if not os.path.isdir(base):
            continue
        for name in sorted(os.listdir(base)):
            if not name.endswith(".s"):
                continue
            for site in scan(os.path.join(base, name)):
                overlays.append({
                    "overlay": name[:-2],
                    "source": f"{directory}/{name}",
                    **site,
                })

    document = {
        "summary": {
            "generated_by": "tools/extract_scroll_walls.py",
            "asm_root": "~/ddw3/asm/dw2003",
            "shape": "toggle + counter, +1 every second blank, wrap below 0x60, drawn at (counter, counter)",
            "period_px": 96,
            "rate_px_per_s": 25,
            "members": len(overlays),
        },
        "members": overlays,
    }
    with open(args.out, "w") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")
    for member in overlays:
        print(f"{member['overlay']:10s} clip={member['clip'] or 'field ' + str(member['clip_field'])} "
              f"counter={member['counter']} toggle={member['toggle']} "
              f"wrap={member['source']}:{member['wrap_file_line']} draw=:{member['draw_file_line']}")
    print(f"{len(overlays)} members -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
