#!/usr/bin/env python3
"""Decompile the ddw3 resident EXE (asm/dw2003/exe/fns.s) to C with m2c.

The disassembly marks ~987 `F0x........` global labels, but only ~420 are real
function entries (jal targets) plus ~150 reached through static function-pointer
tables (`.word F0x...`). The rest are jump-table cases / mid-function labels the
splitter over-globalized, and many functions branch into a *shared epilogue*
block that physically lives in a later "function". m2c decompiles one function
at a time and cannot follow a branch into another function, so feeding it the
raw sections fails ("Cannot find branch target ...").

Fix: for each real entry we compute the reachable control-flow CLOSURE at
instruction granularity (following fall-through, conditional branches, and
intra `j`/`b` targets; stopping at returns/calls' targets), emit exactly those
instructions under a single `glabel`, and demote every other `F0x` label in the
body to a local `.L` label. Each function then carries its own copy of any
shared epilogue, so all branch targets resolve.

Input is the macro-normalized asm from normalize_asm.py.

Usage:
    decompile_exe.py <fns.norm.s> <out_dir> [--only F0xADDR]
    decompile_exe.py <fns.norm.s> <out_dir> --entries-file <path>
"""
import os
import re
import shutil
import subprocess
import sys

M2C_DIR = os.path.join(os.path.dirname(__file__), "..", "m2c")
M2C = os.path.join(M2C_DIR, "m2c.py")

LABEL_RE = re.compile(r'^((?:\.?[A-Za-z_][\w.$]*|"[^"]+")):\s*(.*)$')
ADDR_RE = re.compile(r"(?:\.L|F|D)0x([0-9a-fA-F]+)$")

UNCOND = {"j", "b"}
RETURNS = {"jr", "jalr_zr"}
CALLS = {"jal", "jalr", "bal"}
RA_REGS = {"$ra", "$31"}
COND = {
    "beq", "bne", "blez", "bgtz", "bltz", "bgez", "beqz", "bnez",
    "bgezal", "bltzal", "bc1t", "bc1f", "bc1tl", "bc1fl",
    "beql", "bnel", "blezl", "bgtzl", "bltzl", "bgezl",
}


class Unit:
    __slots__ = ("label", "lines", "mnem", "target", "kind")

    def __init__(self, label, kind):
        self.label = label      # defining label, or None
        self.lines = []         # raw asm lines (1 src instr; may be 2 for la_)
        self.mnem = None        # mnemonic of the (first) instruction
        self.target = None      # branch/jump label operand, if any
        self.kind = kind        # "text" | "rodata"


def parse_units(path):
    units = []
    kind = "text"
    cur = None
    for raw in open(path):
        line = raw.rstrip("\n")
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if s in (".text", ".rodata", ".data", ".bss"):
            kind = s[1:]
            continue
        if s.startswith(".set") or s.startswith(".global"):
            continue
        m = LABEL_RE.match(s)
        label, body = (m.group(1), m.group(2).strip()) if m else (None, s)
        if label is not None:
            cur = Unit(label, kind)
            units.append(cur)
            if body:
                _set_instr(cur, body)
        else:
            # continuation (e.g. la_ second line) or stray instr
            if cur is None:
                cur = Unit(None, kind)
                units.append(cur)
            if cur.mnem is None:
                _set_instr(cur, body)
            else:
                cur.lines.append("\t" + body)
    return units


def _set_instr(unit, body):
    parts = body.split(None, 1)
    unit.mnem = parts[0]
    unit.lines.append("\t" + body)
    if len(parts) > 1:
        # last operand that looks like a code label is the branch target
        for tok in re.findall(r"(?:\.L|F)0x[0-9a-fA-F]+", parts[1]):
            unit.target = tok  # keep last (branch target is final operand)


def _switch_jr(unit):
    """True for an indirect `jr $reg` (reg != $ra) — a jump-table dispatch."""
    if unit.mnem != "jr":
        return False
    m = re.search(r"\bjr\s+(\$\w+)", " ".join(unit.lines))
    return bool(m) and m.group(1) not in RA_REGS


def _drefs(unit):
    return re.findall(r"D0x[0-9a-fA-F]+", " ".join(unit.lines))


# Overlay assembly builds a table address with a raw `lui`/`addiu` pair instead
# of a `D0x` relocation, and labels its own instructions by file offset, so an
# absolute base has to be tried in both address spaces.
OVERLAY_BASE = 0x80082CB0
_LUI_RE = re.compile(r"\blui\s+\$\w+,\s*(?:0x)?([0-9a-fA-F]+)\b")
_ADDIU_RE = re.compile(r"\baddiu\s+\$\w+,\s*(?:\$\w+,\s*)?(?:0x)?([0-9a-fA-F]+)\b")


def _table_labels(window, idx_of):
    """Labels the units in `window` may be loading a jump-table base from.

    The `lui`/`addiu` pair that builds an overlay table address occupies two
    separate units, so the whole lookback window is scanned rather than one unit.
    """
    labels = []
    hi = None
    for unit in window:
        labels.extend(d for d in _drefs(unit) if d in idx_of)
        text = " ".join(unit.lines)
        lui = _LUI_RE.search(text)
        if lui:
            hi = int(lui.group(1), 16) << 16
        addiu = _ADDIU_RE.search(text)
        if addiu and hi is not None:
            base = hi + int(addiu.group(1), 16)
            for candidate in (
                "D0x%08x" % base,
                ".L0x%08x" % base,
                ".L0x%08x" % (base - OVERLAY_BASE),
            ):
                if candidate in idx_of:
                    labels.append(candidate)
    return labels


def jumptable_block(units, idx_of, dlabel):
    """If `dlabel` is a jump table (contiguous `.word <code-label>` rodata),
    return (table_unit_idxs, target_labels); else (None, None)."""
    n = len(units)
    ai = idx_of.get(dlabel)
    if ai is None:
        return None, None
    tbl = [ai]
    targets = []
    j = ai + 1
    while j < n:
        u = units[j]
        # next data block starts -> table ends
        if u.label and u.label.startswith("D0x") and u.mnem is None:
            break
        if u.mnem != ".word":
            break
        tgs = re.findall(r"(?:F|\.L)0x[0-9a-fA-F]+", " ".join(u.lines))
        if not tgs:        # .word of a constant -> not a jump-table entry
            break
        tbl.append(j)
        targets.extend(tgs)
        j += 1
    return (tbl, targets) if targets else (None, None)


def closure(units, idx_of, start):
    """Reachable unit indices of start's function body.

    Returns (text_idxs, rodata_idxs). For `jr $reg` switches we additionally
    pull in the referenced jump table (rodata) and its case targets, to a
    fixpoint, so m2c can resolve the indirect branch."""
    n = len(units)
    text_seen = set()
    rodata_seen = set()
    drefs = set()
    has_switch = False
    frontier = [start]
    while frontier:
        stack, frontier = frontier, []
        while stack:
            i = stack.pop()
            if i in text_seen or i < 0 or i >= n:
                continue
            u = units[i]
            if u.kind != "text":
                continue
            text_seen.add(i)
            m = u.mnem
            drefs.update(_drefs(u))
            if _switch_jr(u):
                has_switch = True
            # intra-function branch/jump target (not calls)
            if u.target and m not in CALLS:
                t = idx_of.get(u.target)
                if t is not None:
                    stack.append(t)
            if m in RETURNS:
                # return / switch jr: include delay slot, no fall-through past it
                if i + 1 < n:
                    text_seen.add(i + 1)
                continue
            if m in UNCOND:
                # unconditional jump: include delay slot, then stop fall-through
                if i + 1 < n:
                    text_seen.add(i + 1)
                continue
            # conditional branch / call / normal: delay slot falls through too
            stack.append(i + 1)
        # expand jump tables referenced by this body -> new text targets
        if has_switch:
            for dl in list(drefs):
                ai = idx_of.get(dl)
                if ai is None or ai in rodata_seen:
                    continue
                tbl, tgts = jumptable_block(units, idx_of, dl)
                if tbl is None:
                    continue
                rodata_seen.update(tbl)
                for tg in tgts:
                    ti = idx_of.get(tg)
                    if ti is not None and ti not in text_seen:
                        frontier.append(ti)
    return text_seen, rodata_seen


def emit_function(units, text_idxs, rodata_idxs, entry_label):
    """Render one self-contained .s for m2c. Demote non-entry F0x defs.

    Jump-table rodata (from `jr $reg` switches) is emitted in a `.rodata`
    section; its `.word F0x...` entries are rewritten to the demoted local
    labels so they point into this function's copy of the case bodies."""
    idxs = sorted(text_idxs)
    # F0x labels defined in this body (other than the entry) -> local labels.
    demote = {}
    for i in idxs:
        lab = units[i].label
        if lab and lab.startswith("F0x") and lab != entry_label:
            demote[lab] = ".L_" + lab
    # Jump-table anchors -> a `jtbl_`-prefixed name so m2c recognizes the
    # indirect `jr` (it keys switch detection on jtbl/jpt_/lbl_ symbols).
    for i in rodata_idxs:
        lab = units[i].label
        if lab and lab.startswith("D0x"):
            demote[lab] = "jtbl_" + lab

    def sub(text):
        for f, l in demote.items():
            text = re.sub(r"\b" + re.escape(f) + r"\b", l, text)
        return text

    out = ["# m2c input (closure of %s)" % entry_label, ".set noat", ".text",
           "glabel " + entry_label]
    for i in idxs:
        u = units[i]
        block = []
        # `glabel <entry>` above already defines the entry label, so the entry
        # unit's own copy of it is a second definition of one symbol, and any
        # branch back to the function head then fails to resolve ("Cannot find
        # branch target F0x800a5de0"). Drop it only when the entry unit is
        # first: when the closure reaches below the entry, `glabel` sits above
        # unrelated blocks and this label is the only thing marking where the
        # function actually starts -- removing it there made m2c analyse from
        # the wrong block and lose three jump tables.
        if u.label and not (u.label == entry_label and i == idxs[0]):
            block.append(demote.get(u.label, u.label) + ":")
        block.extend(u.lines)
        out.append(sub("\n".join(block)))
    if rodata_idxs:
        out.append(".rodata")
        for i in sorted(rodata_idxs):
            u = units[i]
            block = []
            # Keep only the `jtbl_` anchor label; drop the per-entry `.L`
            # labels so the `.word` run sits directly under the jtbl symbol
            # (m2c reads switch cases as consecutive `.word`s under it).
            if u.label and u.label.startswith("D0x"):
                block.append(u.label + ":")
            block.extend(u.lines)
            out.append(sub("\n".join(block)))
    return "\n".join(out) + "\n"


def switch_case_labels(units, idx_of, lookback=14):
    """Labels that a `jr` dispatch table targets.

    A `jr` (jump) through a table transfers control *within* the dispatching
    function: the target shares that function's stack frame and callee-saved
    registers, so it is a case label, not an entry point. Treating one as an
    entry yields a body that reads registers it never sets -- m2c renders those
    as `saved_reg_*` -- while truncating the real function.

    Only `jr` qualifies. A `jalr` through a table calls genuine functions, and
    those targets must keep their entries.
    """
    cases = set()
    for i, u in enumerate(units):
        if not _switch_jr(u):
            continue
        # Walk back to the address computation feeding this dispatch.
        window = units[max(0, i - lookback) : i]
        for dl in _table_labels(window, idx_of):
            _, targets = jumptable_block(units, idx_of, dl)
            if targets:
                cases.update(t for t in targets if t.startswith("F0x"))
    return cases


# `addiu $sp, $sp, -N` / `addiu $sp, -N`: the frame allocation that opens a
# non-leaf function.
_PROLOGUE_RE = re.compile(r"^addiu\s+\$sp,\s*(?:\$sp,\s*)?-0?x?[0-9a-fA-F]+\b")


def call_target_labels(units):
    """Labels the code calls or takes the address of -- proven function entries."""
    called = set()
    for u in units:
        if u.mnem in CALLS and u.target and u.target.startswith("F0x"):
            called.add(u.target)
        elif u.mnem not in CALLS:
            called.update(
                re.findall(r"%(?:hi|lo)\((F0x[0-9a-fA-F]+)", " ".join(u.lines))
            )
    return called


def real_entries(units, idx_of):
    jal = set()
    word = set()
    for u in units:
        if u.mnem in CALLS and u.target and u.target.startswith("F0x"):
            jal.add(u.target)
        if u.mnem == ".word":
            for tok in re.findall(r"F0x[0-9a-fA-F]+", " ".join(u.lines)):
                word.add(tok)
        # Building a function's address with a `%hi`/`%lo` relocation means the
        # code hands that function to something -- a callback registration, a
        # dispatch slot written at runtime. It is as much an entry as a `jal`
        # target, and `F0x80013780` is one: reached only this way, so without
        # this it was never lifted despite carrying its own `.global`.
        elif u.mnem not in CALLS:
            for tok in re.findall(r"%(?:hi|lo)\((F0x[0-9a-fA-F]+)", " ".join(u.lines)):
                jal.add(tok)
    # A `.word` reference alone does not make a label an entry: jump tables are
    # `.word` arrays too. Drop table-only case labels, but keep any label that is
    # also a genuine call target.
    word -= switch_case_labels(units, idx_of) - jal
    entries = jal | word
    # A `.word` can also point at data the splitter over-globalized as `F0x`:
    # string tables, binary tables and padding. Overlay assembly carries no
    # section directive to separate those, so test the label itself -- an entry
    # whose first unit is a `.word` holds data, and m2c rejects it with
    # "contains no instructions. Maybe it is rodata?".
    # NOTE: data labels (string/table constants the splitter over-globalized as
    # `F0x`) are deliberately NOT filtered here. The obvious test -- "the entry's
    # first unit is a `.word`" -- is unsafe, because some overlays encode every
    # instruction as `.word 0x... # <disassembly>` with the mnemonic only in a
    # comment. In `stagslct.norm.s` that test discards the whole module,
    # including real functions such as `F0x80084a5c` (`move_ $a2, $a0`).
    # Those entries fail m2c harmlessly with "contains no instructions"; the real
    # defect there is that the overlay was never decoded to mnemonics.
    # A label that opens a stack frame immediately after a `jr $ra` and its
    # delay slot cannot be reached by fall-through from the function that just
    # returned, so it is an entry even when nothing in the corpus we can see
    # calls it. Overlays such as `stagslct` are entered from the resident EXE
    # through addresses that never appear as a `jal` or a `.word` here, and
    # without this rule their functions are simply never lifted.
    # A bare `F0x...:` line is its own label-only unit, so the prologue sits in
    # the next instruction-bearing unit and the return two before it.
    def _next_instruction(start, step):
        i = start
        while 0 <= i < len(units):
            if units[i].mnem is not None:
                return i
            i += step
        return None

    for i, u in enumerate(units):
        lab = u.label
        if not lab or not lab.startswith("F0x") or u.kind != "text":
            continue
        head = _next_instruction(i, 1)
        if head is None or not _PROLOGUE_RE.match(" ".join(units[head].lines).strip()):
            continue
        slot = _next_instruction(i - 1, -1)
        ret = _next_instruction(slot - 1, -1) if slot is not None else None
        if ret is not None and units[ret].mnem == "jr" and any(
            r in " ".join(units[ret].lines) for r in RA_REGS
        ):
            entries.add(lab)
    # first text function label, as a safety anchor
    for u in units:
        if u.kind == "text" and u.label and u.label.startswith("F0x"):
            entries.add(u.label)
            break
    return sorted(e for e in entries if e in idx_of)


def _m2c_command(asm_path, context):
    """Run m2c with this interpreter when it already carries pycparser.

    The uv path below resolves `--with pycparser==2.22` from a cache and, with
    `--offline`, fails outright when that cache is cold -- which pointed every
    lift at a hard-coded `/tmp/uv-cache` that a fresh machine does not have.
    Preferring the project interpreter (the documented `.venv`, which installs
    pycparser) makes the lift work with no network and no warm cache; uv stays
    as the fallback for an interpreter without the dependency.
    """
    base = ["m2c.py", "--target", "mips-ido-c"]
    if context:
        base += ["--context", os.path.abspath(context)]
    base.append(asm_path)
    try:
        import pycparser  # noqa: F401  (probe the current interpreter)
        return [sys.executable, *base]
    except ImportError:
        return [shutil.which("uv") or os.path.expanduser("~/.local/bin/uv"), "run", "--offline",
                "--with", "pycparser==2.22", "python3", *base]


def run_m2c(asm_path, context=None):
    cmd = _m2c_command(asm_path, context)
    r = subprocess.run(cmd, cwd=M2C_DIR, capture_output=True, text=True, timeout=300)
    return r.stdout, r.stderr, r.returncode


def failure_artifact(entry, returncode, stdout, stderr):
    diagnostic_parts = []
    if stdout.strip():
        diagnostic_parts.append("stdout:\n" + stdout.strip())
    if stderr.strip():
        diagnostic_parts.append("stderr:\n" + stderr.strip())
    diagnostic = "\n\n".join(diagnostic_parts) or "m2c produced no diagnostic output"
    diagnostic = diagnostic.replace("*/", "* /")
    return (
        f"/* Decompilation failure in function {entry} (exit {returncode}).\n"
        f"{diagnostic}\n*/\n"
    )


def main():
    args = sys.argv[1:]
    only = None
    entries_file = None
    if "--only" in args:
        i = args.index("--only"); only = args[i + 1]; del args[i:i + 2]
    also_entries = None
    context = None
    if "--context" in args:
        i = args.index("--context")
        context = args[i + 1]
        del args[i:i + 2]
    if "--entries-file" in args:
        i = args.index("--entries-file")
        entries_file = args[i + 1]
        del args[i:i + 2]
    if "--also-entries" in args:
        i = args.index("--also-entries")
        also_entries = args[i + 1]
        del args[i:i + 2]
    if only and entries_file:
        raise SystemExit("--only and --entries-file are mutually exclusive")
    src, out_dir = args[0], args[1]
    os.makedirs(out_dir, exist_ok=True)
    tmp_dir = os.path.join(out_dir, "_asm")
    os.makedirs(tmp_dir, exist_ok=True)

    units = parse_units(src)
    idx_of = {u.label: i for i, u in enumerate(units) if u.label}
    entries = real_entries(units, idx_of)
    if only:
        entries = [only]
    elif entries_file:
        requested = [
            line.strip() for line in open(entries_file)
            if line.strip() and not line.lstrip().startswith("#")
        ]
        missing = [entry for entry in requested if entry not in idx_of]
        if missing:
            raise SystemExit("requested entries missing from normalized assembly: " + ", ".join(missing))
        entries = requested
    if also_entries and not only:
        extra = [
            line.strip() for line in open(also_entries)
            if line.strip() and not line.lstrip().startswith("#")
        ]
        # A label absent from the normalized assembly was gated out as data; the
        # union must not resurrect it.
        cases = switch_case_labels(units, idx_of)
        entries = sorted(
            set(entries) | {e for e in extra if e in idx_of and e not in cases}
        )
    print(f"{len(units)} units, {len(entries)} entries", file=sys.stderr)

    ok = fail = 0
    fails = []
    for e in entries:
        text_idxs, rodata_idxs = closure(units, idx_of, idx_of[e])
        # NOTE: do not reject an entry whose closure reaches below itself.
        # It looks like a sound test for a `jr` dispatch case sitting inside a
        # larger function, and it does remove 41 phantom entries -- but a real
        # function may branch into a shared block that physically precedes it,
        # and the obvious guard ("keep it if something calls it") does not work
        # either: this pass sees one module, so a function called only from
        # *another* module has no call site here. Applied with that guard it
        # still discarded 213 real functions, `F0x8001ae38` among them, which
        # `pro/stitshop` calls by name. The ~57 "Cannot find branch target"
        # failures it would have hidden are honest failures; deleting real
        # bodies to improve a bucket count is not a trade worth making.
        asm = emit_function(units, text_idxs, rodata_idxs, e)
        asm_path = os.path.abspath(os.path.join(tmp_dir, e + ".s"))
        open(asm_path, "w").write(asm)
        try:
            c, diagnostic, rc = run_m2c(asm_path, context)
        except subprocess.TimeoutExpired as error:
            c, diagnostic, rc = "", str(error), 124
        failed = (
            rc != 0
            or "Decompilation failure" in c
            or "Error" in c[:200]
            or not c.strip()
        )
        if failed:
            c = failure_artifact(e, rc, c, diagnostic)
        open(os.path.join(out_dir, e + ".c"), "w").write(c)
        if failed:
            fail += 1
            fails.append(e)
        else:
            ok += 1
        if (ok + fail) % 25 == 0:
            print(f"  {ok+fail}/{len(entries)}  ok={ok} fail={fail}", file=sys.stderr)
    print(f"DONE ok={ok} fail={fail}", file=sys.stderr)
    open(os.path.join(out_dir, "_failures.txt"), "w").write("\n".join(fails) + "\n")


if __name__ == "__main__":
    main()
