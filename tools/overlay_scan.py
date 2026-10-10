#!/usr/bin/env python3
"""Generic overlay analysis tool for the ddw3 disasm (~/ddw3/asm/dw2003).

Solves the recurring failure modes of ad-hoc greps over splat .s files:
  * words live BOTH as raw `.word 0x...` lines AND as `# .word 0x...` comments
    on disassembled lines (missing the latter falsified the emote jump table);
  * address materialization uses BOTH `lui hi/addiu +lo` and the carry form
    `lui hi+1/addiu -lo` (missing the latter hid wstag212's scene writer);
  * packed-sound ids are built across delay slots and register moves.

Run with: tools/run-overlay-scan.sh ...

Subcommands:
  calls <ovl>                 all [0x80055c48/5c4c/5c54/5c68] call sites with
                              register-tracked a0 (packed sound / play ids)
  refs  <ovl> <addr>          every code lui/addiu pair or data word that
                              yields RAM <addr> (hex)
  jal   <ovl> <addr>          every direct jal/j whose absolute target is <addr>
  dis   <ovl> <start> <end>   capstone disasm; accepts file offsets or RAM addresses
  fn    <ovl> <start>         disasm to next jr $ra; accepts file offset or RAM address
  words <ovl> <start> <end>   raw words; accepts file offsets or RAM addresses
  loads  <ovl> <offset> [op]  same, for lb/lbu/lh/lhu/lw reads of a field
  stores <ovl> <offset> [op]  find every sb/sh/sw through a computed pointer at
                              the exact signed struct offset; optional op filters
                              to sb, sh, or sw; stack stores are omitted
  writes <ovl> <base_ram> <lo> <hi>  find `sw rt, off(rX)` where rX was
                              materialized as <base_ram> and lo<=off<=hi,
                              resolving rt to a tracked constant when possible

Overlay may be a path or a bare name (wstagNNN, fieldstg...); base is inferred:
wstag*/wfight* -> 0x800a5de0, fieldstg/fightstg/st*/soundtst/cardgame -> 0x80082cb0.
Override with --base 0x....
"""
import os
import argparse
import re
import sys
from pathlib import Path

ASM = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"

WORD_RE = re.compile(
    r"\.L0x([0-9a-f]{8}): (?:\.word 0x([0-9a-f]+)|.*?# \.word 0x([0-9a-f]+))"
)


def load_words(path: Path, base: int | None = None) -> dict[int, int]:
    """Map FILE OFFSET -> encoded word.

    BLIND TO `.byte`. This matches `.word` directives only, so any offset an
    overlay covers with a trailing `.byte` run is absent here and every caller
    -- `words`, `dis`, `fn` -- silently reports it as ZERO. Nine files in the
    corpus end that way. It cost a published reading once: cnty_sel's
    cursor-to-language table is a `.word` plus three `.byte`s, and
    `overlay_scan.py words` reporting those three as 0 is exactly why
    docs/research/ui/cnty_sel-decoded-2026-07-11.md concluded only 4 of its 7
    rows were wired (see UI-CNTYSEL-TABLE-CORRECTION-001). If a region matters
    and sits at end of file, read the `.s` directly.

    Overlays use two `.L0x` label conventions: most spell file offsets, but some
    (fightstg) spell absolute RAM addresses. Keying by the raw label made every
    lookup miss on an absolute-labelled overlay, because callers convert their
    arguments to file offsets first — `words` silently printed zeros for a region
    `refs` had just reported a pointer in, and `fn` died with a MemoryError from
    the resulting nonsense range. Normalize to file offsets here instead.
    """
    if base is None:
        base = _stem_base(path)
    words = {}
    for m in WORD_RE.finditer(path.read_text()):
        key = int(m.group(1), 16)
        if key >= base:
            key -= base
        words[key] = int(m.group(2) or m.group(3), 16)
    return words


LABEL_RE = re.compile(r"^\.L0x([0-9a-f]{8}):\s*(.*?)\s*$")


def load_source_text(path: Path, base: int | None = None) -> dict[int, str]:
    """Map FILE OFFSET -> raw source text, for label lines WORD_RE cannot parse.

    The corpus uses three `.L0x` line shapes and WORD_RE only handles two:
    `.word 0x… # mnemonic` and `mnemonic # .word 0x…`. A bare `mnemonic` with
    no `.word` anywhere is invisible to it. That third shape is not rare --
    fightstg.s is 92% bare, shocktst.s 93%, stdwtitl.s and wfightts.s 77% --
    so a scan of those overlays used to come back as a solid run of `nop`,
    indistinguishable from genuinely empty space. This keeps the text so the
    disassembler can fall back to it and so callers can be warned.
    """
    if base is None:
        base = _stem_base(path)
    text = {}
    for line in path.read_text(errors="replace").splitlines():
        m = LABEL_RE.match(line)
        if not m:
            continue
        key = int(m.group(1), 16)
        if key >= base:
            key -= base
        body = m.group(2)
        if body.startswith(".word 0x") or "# .word 0x" in body:
            continue
        text[key] = body.split("#")[0].strip() or body
    return text


def warn_unparsed(path: Path, base: int, start: int, end: int) -> dict[int, str]:
    """Print a loud banner when the requested range is not fully decodable.

    Silence here is the dangerous outcome: an unparsed range reads as zeros,
    and zeros read as padding. Callers get the text map back so they can show
    something truthful instead.
    """
    text = load_source_text(path, base)
    hit = {o: t for o, t in text.items() if start <= o < end}
    if hit:
        print(
            f"!! {len(hit)} of {(end - start) // 4} words in this range are NOT "
            f"encoded in {path.name} -- the source gives a bare mnemonic with no "
            f".word. They are shown below as [src] lines, NOT decoded bytes. "
            f"Numeric output for those offsets is unavailable, not zero.",
            file=sys.stderr,
        )
    return hit


def _stem_base(path: Path) -> int:
    """Load base implied by the overlay's filename.

    Overlay families share load addresses, so the stem is the only thing a
    caller holding just a path can key off. `load_words` defaults to this so
    the dozen extractors that pass a path alone keep working.
    """
    return 0x800A5DE0 if path.stem.startswith(("wstag", "wfight")) else 0x80082CB0


def resolve_overlay(name: str) -> tuple[Path, int]:
    p = Path(name)
    if not p.exists():
        p = ASM / (name if name.endswith(".s") else name + ".s")
    return p, _stem_base(p)


def file_offset(value: str, base: int) -> int:
    """Accept either an overlay file offset or its loaded RAM address."""
    parsed = int(value, 0)
    if parsed >= base:
        parsed -= base
    if parsed < 0:
        raise ValueError(f"address {value} is below overlay base 0x{base:08x}")
    return parsed


# ── register-tracking constant propagation (linear scan, branch-oblivious) ──
def track_consts(seq):
    """Yield (off, word, regs) with a per-instruction snapshot of known consts.

    Handles lui/ori/addiu/move; clears a register on any other write to it.
    Good enough for id/address materialization (they're built in straight lines).
    """
    regs: dict[int, int | None] = {}
    for off, w in seq:
        op = w >> 26
        rs, rt = (w >> 21) & 31, (w >> 16) & 31
        imm = w & 0xFFFF
        simm = imm - 0x10000 if imm >= 0x8000 else imm
        yield off, w, dict(regs)
        if op == 0x0F:  # lui
            regs[rt] = (imm << 16) & 0xFFFFFFFF
        elif op == 0x0D:  # ori
            regs[rt] = (regs.get(rs) or 0) | imm if regs.get(rs) is not None or rs == 0 else None
            if rs == 0:
                regs[rt] = imm
        elif op in (0x08, 0x09):  # addi/addiu
            if rs == 0:
                regs[rt] = simm & 0xFFFFFFFF
            elif regs.get(rs) is not None:
                regs[rt] = (regs[rs] + simm) & 0xFFFFFFFF
            else:
                regs[rt] = None
        elif op == 0 and (w & 0x3F) == 0x21 and ((w >> 6) & 31) == 0:  # addu rd,rs,rt
            rd = (w >> 11) & 31
            a, b = regs.get(rs), regs.get((w >> 16) & 31)
            if rs == 0:
                regs[rd] = b
            elif ((w >> 16) & 31) == 0:
                regs[rd] = a
            elif a is not None and b is not None:
                regs[rd] = (a + b) & 0xFFFFFFFF
            else:
                regs[rd] = None
        elif op == 0x23 or op == 0 or op in (0x20, 0x21, 0x24, 0x25):  # loads/alu
            rd = (w >> 11) & 31 if op == 0 else rt
            if rd:
                regs[rd] = None


SOUND_PTRS = {0x5C48: "play_packed", 0x5C4C: "play_b", 0x5C54: "request_archive", 0x5C68: "play_c"}


def cmd_calls(path, base, args):
    words = load_words(path, base)
    seq = sorted(words.items())
    # find lw rX, 0x5cNN(rY) where rY holds 0x80050000
    out = []
    snap = list(track_consts(seq))
    idx = {off: i for i, (off, w, r) in enumerate(snap)}
    for i, (off, w, regs) in enumerate(snap):
        if (w >> 26) == 0x23 and (w & 0xFFFF) in SOUND_PTRS:
            rs = (w >> 21) & 31
            if regs.get(rs) != 0x80050000:
                continue
            fn = SOUND_PTRS[w & 0xFFFF]
            rt = (w >> 16) & 31
            # find the jalr rt within the next 6 instructions, a0 at its delay slot
            for j in range(1, 7):
                if i + j >= len(snap):
                    break
                off2, w2, regs2 = snap[i + j]
                if (w2 >> 26) == 0 and (w2 & 0x3F) == 0x09 and ((w2 >> 21) & 31) == rt:  # jalr
                    # a0 after the delay slot executes
                    off3, w3, regs3 = snap[i + j + 1] if i + j + 1 < len(snap) else (0, 0, {})
                    # apply delay slot manually: take snapshot AFTER it
                    a0 = None
                    if i + j + 2 < len(snap):
                        a0 = snap[i + j + 2][2].get(4)
                    out.append((off, fn, a0, off2))
                    break
    for off, fn, a0, callsite in out:
        print(f"file 0x{off:06x} (RAM 0x{base+off:08x})  {fn:16} a0={'0x%08x' % a0 if a0 is not None else '?'}")
    return out


def cmd_refs(path, base, args):
    words = load_words(path, base)
    target = int(args.addr, 16)
    seq = sorted(words.items())
    for off, w in seq:
        if w == target:
            print(f"data word at file 0x{off:06x} (RAM 0x{base+off:08x})")
    for off, w, regs in track_consts(seq):
        op = w >> 26
        if op in (0x08, 0x09, 0x0D):
            rs = (w >> 21) & 31
            imm = w & 0xFFFF
            simm = imm - 0x10000 if imm >= 0x8000 and op != 0x0D else imm
            v = regs.get(rs)
            if v is not None and (v + simm) & 0xFFFFFFFF == target:
                print(f"code materializes 0x{target:08x} at file 0x{off:06x} (RAM 0x{base+off:08x})")


def cmd_jal(path, base, args):
    """Every `jal`/`j` whose absolute target equals <addr> (hex).

    `refs` only sees lui/addiu materialization and raw data words, so direct
    calls into always-resident EXE routines were invisible to it.
    """
    words = load_words(path, base)
    target = int(args.addr, 16)
    for off, w in sorted(words.items()):
        op = w >> 26
        if op not in (0x02, 0x03):
            continue
        ram = base + off
        dest = ((ram + 4) & 0xF0000000) | ((w & 0x03FFFFFF) << 2)
        if dest == target:
            kind = "j" if op == 0x02 else "jal"
            print(f"{kind} 0x{target:08x} at file 0x{off:06x} (RAM 0x{ram:08x})")


def _disasm(words, base, start, end):
    try:
        from capstone import Cs, CS_ARCH_MIPS, CS_MODE_MIPS32, CS_MODE_LITTLE_ENDIAN
    except ImportError:
        sys.exit("capstone missing: run via tools/run-overlay-scan.sh ...")
    md = Cs(CS_ARCH_MIPS, CS_MODE_MIPS32 | CS_MODE_LITTLE_ENDIAN)
    md.skipdata = True
    blob = b"".join((words.get(o, 0)).to_bytes(4, "little") for o in range(start, end, 4))
    for ins in md.disasm(blob, base + start):
        yield ins


def cmd_dis(path, base, args):
    words = load_words(path, base)
    s, e = file_offset(args.start, base), file_offset(args.end, base)
    src = warn_unparsed(path, base, s, e)
    if not src:
        for ins in _disasm(words, base, s, e):
            print(f"{ins.address:08x} (f{ins.address - base:06x})  {ins.mnemonic} {ins.op_str}")
        return
    # Mixed range: decode what is encoded, and print the source line verbatim
    # for what is not, so the two can never be confused for one another.
    decoded = {ins.address - base: f"{ins.mnemonic} {ins.op_str}"
               for ins in _disasm(words, base, s, e)}
    for off in range(s, e, 4):
        if off in src:
            print(f"{base + off:08x} (f{off:06x})  [src] {src[off]}")
        elif off in decoded:
            print(f"{base + off:08x} (f{off:06x})  {decoded[off]}")


def cmd_fn(path, base, args):
    words = load_words(path, base)
    s = file_offset(args.start, base)
    e = s
    seq = sorted(o for o in words if o >= s)
    for o in seq:
        e = o + 8  # include delay slot
        if words[o] == 0x03E00008:  # jr $ra
            break
    for ins in _disasm(words, base, s, e):
        print(f"{ins.address:08x} (f{ins.address - base:06x})  {ins.mnemonic} {ins.op_str}")


def cmd_words(path, base, args):
    words = load_words(path, base)
    s, e = file_offset(args.start, base), file_offset(args.end, base)
    src = warn_unparsed(path, base, s, e)
    stride = args.stride
    for row in range(s, e, stride):
        vals = " ".join(
            f"{words[row + i]:08x}" if row + i in words
            else ("????????" if row + i in src else "00000000")
            for i in range(0, stride, 4))
        print(f"f{row:06x} (RAM 0x{base+row:08x}): {vals}")


def cmd_writes(path, base, args):
    words = load_words(path, base)
    tgt = int(args.base_ram, 16)
    lo, hi = int(args.lo, 16), int(args.hi, 16)
    for off, w, regs in track_consts(sorted(words.items())):
        if (w >> 26) == 0x2B:  # sw
            rs = (w >> 21) & 31
            imm = w & 0xFFFF
            simm = imm - 0x10000 if imm >= 0x8000 else imm
            if regs.get(rs) == tgt and lo <= simm <= hi:
                rt = (w >> 16) & 31
                v = regs.get(rt)
                print(f"file 0x{off:06x}: sw r{rt}, 0x{simm:x}(base)  value={'0x%08x' % v if v is not None else '?'}")


def cmd_stores(path, base, args):
    target = int(args.offset, 0)
    store_re = re.compile(
        r"^\.L0x([0-9a-fA-F]{8}):\s+(sb|sh|sw)\s+"
        r"(\$[^,]+),\s*(-?0x[0-9a-fA-F]+|-?\d+)\((\$[^)]+)\)"
    )
    tracker = PointerTracker(int(args.via, 0)) if getattr(args, "via", None) else None
    function = "<local>"
    for line in path.read_text().splitlines():
        if line.startswith(".global "):
            function = line.split(None, 1)[1]
            if tracker:
                tracker.reset()
        match = store_re.match(line)
        if tracker and not match:
            tracker.feed(line)
        if not match or int(match.group(4), 0) != target:
            continue
        if args.width and match.group(2) != args.width:
            continue
        if match.group(5) == "$sp":
            continue
        addr = int(match.group(1), 16)
        ram = addr if addr >= 0x80000000 else base + addr
        off = ram - base
        mark = ""
        if tracker and match.group(5) in tracker.inferred:
            mark = "  [INFERRED base: high half set off this path -- verify]"
        print(
            f"file 0x{off:06x} (RAM 0x{ram:08x}): "
            f"{match.group(2)} {match.group(3)}, 0x{target:x}({match.group(5)})  "
            f"fn={function}{mark}"
        )


LUI_RE = re.compile(r"^\.L0x[0-9a-fA-F]{8}:\s+lui\s+(\$\w+),\s*(0x[0-9a-fA-F]+|\d+)\s*$")
ADDIU2_RE = re.compile(r"^\.L0x[0-9a-fA-F]{8}:\s+addiu\s+(\$\w+),\s*(-?0x[0-9a-fA-F]+|-?\d+)\s*$")
ADDIU3_RE = re.compile(r"^\.L0x[0-9a-fA-F]{8}:\s+addiu\s+(\$\w+),\s*(\$\w+),\s*(-?0x[0-9a-fA-F]+|-?\d+)\s*$")
MOVE_RE = re.compile(r"^\.L0x[0-9a-fA-F]{8}:\s+move_?\s+(\$\w+),\s*(\$\w+)\s*$")
LA_RE = re.compile(r"^\.L0x[0-9a-fA-F]{8}:\s+la_?\s+(\$\w+),\s*\w?0x?([0-9a-fA-F]{8})")
DEST_RE = re.compile(r"^\.L0x[0-9a-fA-F]{8}:\s+\w+_?\s+(\$\w+)\s*,")


class PointerTracker:
    """Follow which register currently holds one specific absolute address.

    `loads`/`stores` key on a struct OFFSET alone, so `+0x3c` matches every
    object type in the overlay at once. When you already know the struct's
    address -- a resident global such as the field scene sheet at 0x80099d80 --
    this narrows the answer to that one struct by following the `lui`/`addiu`
    pair that materialises it.

    A miss is NOT absence. A base arriving in a register as a function argument,
    or loaded from memory, is invisible here; so is one built by arithmetic this
    does not model. Use it to find sites, never to prove there are none.
    """

    def __init__(self, want):
        self.want = want
        self.regs = {}
        self.inferred = set()
        # The low half as `addiu` encodes it, so the delay-slot idiom below can
        # be recognised. 0x80099d80 -> -0x6280, because the negative low half
        # borrows from the high half (0x800a0000 - 0x6280).
        low = want & 0xFFFF
        self.low_imm = low - 0x10000 if low >= 0x8000 else low

    def feed(self, line):
        """Update register state from one line. Returns nothing."""
        text = line.split("#")[0].rstrip()
        m = LA_RE.match(text)
        if m:
            self._set(m.group(1), int(m.group(2), 16))
            return
        m = LUI_RE.match(text)
        if m:
            self._set(m.group(1), int(m.group(2), 0) << 16)
            return
        m = ADDIU3_RE.match(text)
        if m:
            src = self.regs.get(m.group(2))
            self._set(m.group(1), None if src is None else src + int(m.group(3), 0))
            return
        m = ADDIU2_RE.match(text)
        if m:
            reg, imm = m.group(1), int(m.group(2), 0)
            src = self.regs.get(reg)
            if src is None and imm == self.low_imm:
                # The high half was set on a path this linear scan did not
                # follow -- classically a `lui` sitting in a branch delay slot,
                # which executes even when the branch is taken. The low half
                # alone is not proof, so the site is reported but MARKED.
                self._set(reg, self.want)
                self.inferred.add(reg)
            else:
                self._set(reg, None if src is None else src + imm)
                self.inferred.discard(reg)
            return
        m = MOVE_RE.match(text)
        if m:
            self._set(m.group(1), self.regs.get(m.group(2)))
            return
        m = DEST_RE.match(text)
        if m:
            self._set(m.group(1), None)

    def _set(self, reg, value):
        self.regs[reg] = value & 0xFFFFFFFF if value is not None else None
        if value is None or (value & 0xFFFFFFFF) != self.want:
            self.inferred.discard(reg)

    def holds(self, reg):
        return self.regs.get(reg) == self.want

    def reset(self):
        self.regs = {}


def cmd_loads(path, base, args):
    """Every lb/lbu/lh/lhu/lw through a non-$sp pointer at the exact signed
    struct offset. Mirror of `stores`; needed to find who *reads* a struct
    field (e.g. an entity method pointer) rather than who writes it."""
    target = int(args.offset, 0)
    load_re = re.compile(
        r"^\.L0x([0-9a-fA-F]{8}):\s+(lb|lbu|lh|lhu|lw)\s+"
        r"(\$[^,]+),\s*(-?0x[0-9a-fA-F]+|-?\d+)\((\$[^)]+)\)"
    )
    tracker = PointerTracker(int(args.via, 0)) if getattr(args, "via", None) else None
    function = "<local>"
    for line in path.read_text().splitlines():
        if line.startswith(".global "):
            function = line.split(None, 1)[1]
            if tracker:
                tracker.reset()
        match = load_re.match(line)
        if tracker and not match:
            tracker.feed(line)
        if not match or int(match.group(4), 0) != target:
            continue
        if args.width and match.group(2) != args.width:
            continue
        if match.group(5) in ("$sp", "$gp"):
            continue
        if tracker and not tracker.holds(match.group(5)):
            tracker.feed(line)
            continue
        if tracker:
            tracker.feed(line)
        addr = int(match.group(1), 16)
        ram = addr if addr >= 0x80000000 else base + addr
        off = ram - base
        mark = ""
        if tracker and match.group(5) in tracker.inferred:
            mark = "  [INFERRED base: high half set off this path -- verify]"
        print(
            f"file 0x{off:06x} (RAM 0x{ram:08x}): "
            f"{match.group(2)} {match.group(3)}, 0x{target:x}({match.group(5)})  "
            f"fn={function}{mark}"
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["calls", "refs", "jal", "dis", "fn", "words", "stores", "loads", "writes"])
    ap.add_argument("overlay")
    ap.add_argument("start", nargs="?")
    ap.add_argument("end", nargs="?")
    ap.add_argument("extra", nargs="?")
    ap.add_argument("--base", default=None)
    ap.add_argument("--stride", type=int, default=16)
    ap.add_argument("--via", default=None,
                    help="loads/stores: only report accesses through a register "
                         "holding this absolute address (e.g. 0x80099d80). "
                         "A miss is not absence -- see PointerTracker.")
    args = ap.parse_args()
    path, base = resolve_overlay(args.overlay)
    if args.base:
        base = int(args.base, 0)
    if args.cmd in ("refs", "jal"):
        args.addr = args.start
    if args.cmd == "writes":
        args.base_ram = args.start
        args.lo = args.end or "0"
        args.hi = args.extra or "0x100"
    if args.cmd in ("stores", "loads"):
        args.offset = args.start
        args.width = args.end
    # Every word-driven subcommand reads the `# .word 0x...` encoding comments, and
    # coverage is NOT uniform: fightstg.s labels its instructions with absolute RAM
    # and carries no encoding comment on them, so only ~2600 of its ~34700 lines are
    # readable this way. Queries into the unreadable part printed a screenful of
    # 00000000 / nop that reads exactly like a real answer of "nothing is here".
    # Fail loudly instead — a silent wrong answer is worse than no answer.
    if args.cmd in ("dis", "fn", "words") and args.start:
        words = load_words(path, base)
        lo = file_offset(args.start, base)
        hi = file_offset(args.end, base) if args.end else lo + 0x40
        if not any(lo <= k <= hi for k in words):
            raise SystemExit(
                f"{path.name} has no `# .word 0x...` encoding comments in "
                f"f{lo:06x}..f{hi:06x} ({len(words)} words exist elsewhere in the "
                f"file), so `{args.cmd}` cannot read this range. This is a property "
                f"of the file, NOT a finding: an empty result here is NOT absence. "
                f"Use the text subcommands (stores/loads) or read the assembly."
            )
    globals()["cmd_" + args.cmd](path, base, args)


if __name__ == "__main__":
    main()
