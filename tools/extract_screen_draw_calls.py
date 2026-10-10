#!/usr/bin/env python3
"""Every 2D picture-draw call every screen makes, pulled out of the original assembly.

The game draws a picture by building a drawable on the stack (`F0x8001f648`),
setting it up through its own method block, and calling its draw slot. This
walks the assembly, finds each such drawable, and reports the ordered sequence of
calls made against it -- texture origin, palette shift, render target, depth
bucket, scale, rotation, tint, and every picture id with its screen position.

That makes "what does this screen draw, and where" a measurement instead of a
reading. See docs/research/ui/screen-rendering-model.md.

Authority 2: it parses ~/ddw3/asm/dw2003 directly.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ASM = Path.home() / "ddw3" / "asm" / "dw2003"
CTOR = "F0x8001f648"
RESOURCE_GET = 0x424      # resource bank slot: handle -> sprite directory
TEXT_CTOR = "F0x8001ae38"   # new text element: (target, font kind, x, y)

# Method block installed by F0x8001f648, as offsets from the drawable's base.
METHODS = {
    0x70: ("make_current", 1),
    0x74: ("texture_origin", 2),
    0x78: ("palette8_origin", 2),
    0x7C: ("target", 2),
    0x80: ("target_obj", 2),
    0x84: ("draw", 4),
    0x88: ("palette_shift", 1),
    0x8C: ("scale", 3),
    0x90: ("rotation", 3),
    0x94: ("transform_origin", 2),
    0x98: ("camera_subtract", 1),
    0x9C: ("tint", 1),
}

INSTR = re.compile(r"^\.L0x([0-9a-fA-F]+):\s+(\S+)\s*(.*)$")
LABEL = re.compile(r"^(F0x[0-9a-fA-F]+|\.L0x[0-9a-fA-F]+):\s*$")
ARGS = ("$a0", "$a1", "$a2", "$a3")


def _imm(text: str):
    text = text.strip()
    neg = text.startswith("-")
    body = text[1:] if neg else text
    try:
        value = int(body, 16) if body.lower().startswith("0x") else int(body, 10)
    except ValueError:
        return None
    return -value if neg else value


class Expr(str):
    """A value we could not reduce to a number, but can still describe."""


class Regs:
    """Just enough register tracking to recover call arguments."""

    def __init__(self) -> None:
        self.v: dict[str, object] = {}

    def set(self, reg: str, val) -> None:
        self.v[reg] = val

    def get(self, reg: str):
        if reg == "$zr":
            return 0
        return self.v.get(reg)

    def step(self, op: str, ops: str) -> None:
        parts = [p.strip() for p in ops.split(",")]
        if op in ("li", "li_") and len(parts) == 2:
            self.set(parts[0], _imm(parts[1]))
        elif op in ("move", "move_") and len(parts) == 2:
            self.set(parts[0], self.get(parts[1]))
        elif op == "addiu" and len(parts) == 3:
            base = self.get(parts[1])
            off = _imm(parts[2])
            if parts[1] == "$sp":
                self.set(parts[0], ("sp", off))
            elif isinstance(base, int) and off is not None:
                self.set(parts[0], base + off)
            else:
                self.set(parts[0], None)
        elif op in ("lui",) and len(parts) == 2:
            imm = _imm(parts[1])
            self.set(parts[0], (imm << 16) if imm is not None else None)
        elif op in ("lw", "lh", "lhu", "lb", "lbu") and len(parts) == 2:
            m = re.match(r"(-?(?:0x)?[0-9a-fA-F]+)?\((\$\w+)\)$", parts[1])
            if m:
                off = _imm(m.group(1)) if m.group(1) else 0
                base = self.get(m.group(2))
                # A `lui` base makes the load an absolute address, which is how
                # pack handles and other globals are reached.
                if isinstance(base, int) and not isinstance(base, Expr) \
                        and base >= 0x80000000:
                    self.set(parts[0], ("abs", base + off))
                else:
                    self.set(parts[0], ("mem", m.group(2), off))
            else:
                self.set(parts[0], None)
        elif op in ("addu", "subu", "and", "or", "xor") and len(parts) in (2, 3):
            # `addu $d, $s, $t`, and the two-operand form `addu $d, $t`
            d = parts[0]
            src = (d, parts[1]) if len(parts) == 2 else (parts[1], parts[2])
            a, b = self.get(src[0]), self.get(src[1])
            if isinstance(a, int) and isinstance(b, int) and not isinstance(a, Expr) \
                    and not isinstance(b, Expr):
                self.set(d, {"addu": a + b, "subu": a - b, "and": a & b,
                             "or": a | b, "xor": a ^ b}[op])
            else:
                sign = {"addu": "+", "subu": "-", "and": "&",
                        "or": "|", "xor": "^"}[op]
                self.set(d, Expr(f"{fmt(a)}{sign}{fmt(b)}"))
        elif op in ("sll", "sra", "srl") and len(parts) in (2, 3):
            d = parts[0]
            s = parts[0] if len(parts) == 2 else parts[1]
            n = parts[-1]
            a, shift = self.get(s), _imm(n)
            if isinstance(a, int) and not isinstance(a, Expr) and shift is not None:
                self.set(d, (a << shift) if op == "sll" else (a >> shift))
            else:
                sign = {"sll": "<<", "sra": ">>", "srl": ">>>"}[op]
                self.set(d, Expr(f"{fmt(a)}{sign}{n}"))
        elif len(parts) >= 1 and parts[0].startswith("$"):
            self.set(parts[0], None)


def fmt(val) -> str:
    if val is None:
        return "?"
    if isinstance(val, Expr):
        return val if len(val) <= 40 else "?"
    if isinstance(val, int):
        return f"{val}" if -256 < val < 4096 else f"0x{val:x}"
    if isinstance(val, tuple) and val[0] == "abs":
        return f"[0x{val[1]:08x}]"
    if isinstance(val, tuple) and val[0] == "mem":
        sign = "-" if val[2] < 0 else "+"
        return f"[{val[1]}{sign}0x{abs(val[2]):x}]"
    if isinstance(val, tuple) and val[0] == "sp":
        return f"sp+0x{val[1]:x}"
    return "?"


def scan(path: Path):
    """Yield (routine_label, [(addr, method, [args])]) for one assembly file."""
    lines = path.read_text(errors="replace").splitlines()
    routine = path.stem
    after_return = True
    regs = Regs()
    # stack offset of each live drawable -> its ordinal in this routine
    drawables: dict[int, int] = {}
    ndraw = 0
    out: list[tuple[str, list]] = []
    calls: list = []
    pending = None  # (kind, payload) waiting on its delay slot

    def flush():
        nonlocal calls, drawables, ndraw
        if calls:
            out.append((routine, calls))
        calls = []
        drawables = {}
        ndraw = 0

    for raw in lines:
        lab = LABEL.match(raw.split("#", 1)[0].strip())
        if lab and lab.group(1).startswith("F0x"):
            flush()
            routine = lab.group(1)
            regs = Regs()
            continue
        line = raw.split("#", 1)[0].strip()
        m = INSTR.match(line)
        if not m:
            continue
        addr, op, ops = m.group(1), m.group(2), m.group(3)

        # Overlay assembly carries no function labels. A routine starts at the
        # standard prologue that follows a return.
        if after_return and op == "addiu" and ops.replace(" ", "").startswith("$sp,-"):
            flush()
            routine = f"0x{addr}"
            regs = Regs()
            after_return = False
        if op == "jr" and "$ra" in ops:
            after_return = True

        if pending is not None:
            regs.step(op, ops)          # the delay slot runs first
            kind, at, extra = pending
            pending = None
            # Argument registers are caller-saved: after a call, whatever they
            # held is not an argument to the NEXT call. Keeping them made stale
            # values masquerade as arguments.
            clobber = kind in ("ctor", "call", "text", "resource", "skip")
            if kind == "ctor":
                a0 = regs.get("$a0")
                if isinstance(a0, tuple) and a0[0] == "sp":
                    ndraw += 1
                    drawables[a0[1]] = ndraw
                    calls.append((at, "new_drawable", [f"#{ndraw}"]))
            elif kind == "resource":
                handle = regs.get("$a0")
                regs.set("$v0", Expr(f"pack {fmt(handle)}")
                         if handle is not None else Expr("pack ?"))
            elif kind == "text":
                calls.append((at, "text_element",
                              [fmt(regs.get(r)) for r in ARGS]))
            elif kind == "call":
                slot_off = extra
                for off, ordinal in sorted(drawables.items(), reverse=True):
                    if off <= slot_off < off + 0xA0:
                        name, argc = METHODS.get(slot_off - off, (None, 0))
                        if name:
                            args = [fmt(regs.get(r)) for r in ARGS[:argc]]
                            calls.append((at, name, [f"#{ordinal}"] + args))
                        break
            if clobber:
                for reg in ARGS:
                    regs.set(reg, None)
            continue

        if op == "jal" and ops.strip() == CTOR:
            pending = ("ctor", addr, None)
            continue
        if op == "jal" and ops.strip() == TEXT_CTOR:
            pending = ("text", addr, None)
            continue
        if op == "jalr":
            reg = ops.strip().split(",")[-1].strip()
            src = regs.get(reg)
            if isinstance(src, tuple) and src[0] == "mem" and src[1] == "$sp":
                pending = ("call", addr, src[2])
                continue
            # The resource bank's entry getter sits at +0x424 of the bank object.
            # Its argument is the pack handle, and its result is the sprite
            # directory a draw reads from -- so carry the handle forward.
            if isinstance(src, tuple) and src[0] == "mem" and src[2] == RESOURCE_GET:
                pending = ("resource", addr, None)
                continue
            regs.set("$v0", Expr("call"))
            regs.step(op, ops)
            continue
        if op in ("jal", "j", "b", "beq", "bne", "beqz", "bnez", "jr"):
            pending = ("skip", addr, None)
            continue
        regs.step(op, ops)

    flush()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("overlay", nargs="*", help="overlay name(s); default: all")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    files = []
    for sub in ("pro", "exe"):
        d = ASM / sub
        if d.is_dir():
            files.extend(sorted(d.glob("*.s")))
    if args.overlay:
        want = set(args.overlay)
        files = [f for f in files if f.stem in want]
    if not files:
        print("no matching assembly files", file=sys.stderr)
        return 1

    result = {}
    for f in files:
        found = scan(f)
        if found:
            result[f.stem] = [
                {"routine": r, "calls": [{"at": a, "op": o, "args": g} for a, o, g in c]}
                for r, c in found
            ]

    if args.json:
        print(json.dumps(result, indent=1))
        return 0

    for overlay, routines in result.items():
        total = sum(1 for r in routines for c in r["calls"] if c["op"] == "draw")
        texts = sum(1 for r in routines for c in r["calls"] if c["op"] == "text_element")
        print(f"\n=== {overlay}  ({total} picture draws, {texts} text elements,"
              f" in {len(routines)} routines)")
        for r in routines:
            print(f"  {r['routine']}")
            for c in r["calls"]:
                print(f"    0x{c['at']}  {c['op']:<17} {' '.join(c['args'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
