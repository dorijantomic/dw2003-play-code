#!/usr/bin/env python3
"""Adapt a raw DDW3 overlay disassembly to F0x form for the m2c pipeline.

Direct-call and pointer-shaped entries retain the legacy behavior.  When a
recovered inventory is supplied, every established entry for the selected
module is also labeled, including functions proven callable through extracted
overlay tables.
"""
import argparse
import json
import re
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("src", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--base", type=lambda value: int(value, 0))
    parser.add_argument("--inventory", type=Path)
    parser.add_argument("--module")
    parser.add_argument(
        "--entries-out", type=Path,
        help="Write the established entry labels here, so the decompiler can "
             "union them with the entries it re-derives from the assembly.",
    )
    return parser.parse_args()


args = parse_args()
src, out = args.src, args.out
module_name = args.module or f"pro/{src.stem}"
BASE = args.base or (
    0x800A5DE0 if src.stem.startswith(("wstag", "wfight")) else 0x80082CB0
)
lines = src.read_text(errors="replace").splitlines()
# Overlays use two label conventions. Most spell `.L0x` labels as file offsets
# from the load base, but some (fightstg) spell them as absolute RAM addresses.
# Assuming offsets for an absolute-labeled overlay computes ram = BASE + ram,
# so no entry ever matches and the whole module fails to lift.
label_values = [
    int(m.group(1), 16)
    for m in (re.match(r"\.L0x([0-9a-fA-F]+):", ln) for ln in lines)
    if m
]
ABSOLUTE_LABELS = bool(label_values) and max(label_values) >= 0x80000000


def label_to_ram(value: int) -> int:
    return value if ABSOLUTE_LABELS else BASE + value


maxoff = max((label_to_ram(v) - BASE for v in label_values), default=0)
lo, hi = BASE, BASE + maxoff + 0x10
BR = re.compile(r"^\s*(j|b|beq|bne|blez|bgtz|bltz|bgez|beqz|bnez|bgezal|bltzal|bc1t|bc1f|b_)\b")
def ram2L(a):
    return f".L0x{a-BASE:08x}" if lo<=a<hi else None

# --- code region -----------------------------------------------------------
# Overlays mix code and data with no section directive, so "which offsets hold
# instructions" has to be recovered.  Getting this wrong in either direction is
# expensive: too wide and every Shift-JIS string label is lifted as a function
# ("contains no instructions. Maybe it is rodata?"), too narrow and real
# functions are dropped.
INSTRUCTION_LINE = re.compile(r"^\.L0x[0-9a-fA-F]+:\s+[a-z]")
WORD_LINE = re.compile(
    r"^\.L0x([0-9a-fA-F]+):\s*\.word\s+0x([0-9a-fA-F]{8})\s*(?:#\s*(.*?))?\s*$"
)
# A word the disassembler could not render falls back to bare hex or to a
# coprocessor stub, and marks the end of a decodable run.
UNDECODED_COMMENT = re.compile(r"^(?:0x[0-9a-fA-F]+|c[0-3]\b.*)$")

word_rows = []  # (offset, word, comment) for every data-formatted line
for ln in lines:
    match = WORD_LINE.match(ln)
    if match:
        word_rows.append((
            label_to_ram(int(match.group(1), 16)) - BASE,
            int(match.group(2), 16),
            (match.group(3) or "").strip(),
        ))

recovered_entries: set[int] = set()
decoded_offsets = [
    label_to_ram(int(re.match(r"\.L0x([0-9a-fA-F]+):", ln).group(1), 16)) - BASE
    for ln in lines if INSTRUCTION_LINE.match(ln)
]
if decoded_offsets:
    # The disassembler already separated code from data; trust its span.
    CODE_LO, CODE_HI = BASE + min(decoded_offsets), BASE + max(decoded_offsets) + 4
else:
    # Nothing was decoded: the overlay is one undifferentiated `.word` stream
    # (stagslct), with the mnemonic present only in each line's comment. Anchor
    # the code region on evidence that is structurally impossible in text or in
    # a pointer table -- a stack-frame prologue, a `jr $ra` return, and an
    # in-overlay `jal` -- then take the span they bound. `+ 8` covers the last
    # return's delay slot.
    anchors = [
        offset for offset, word, _ in word_rows
        if word == 0x03E00008                                    # jr $ra
        or ((word >> 16) == 0x27BD and (word & 0xFFFF) >= 0x8000)  # addiu $sp, -n
        or ((word >> 26) == 3
            and lo <= ((BASE & 0xF0000000) | ((word & 0x03FFFFFF) << 2)) < hi)
    ]
    if anchors:
        CODE_LO, CODE_HI = BASE + min(anchors), BASE + max(anchors) + 8
    else:
        CODE_LO = CODE_HI = BASE + maxoff + 0x10  # no code found: gate everything out

    # Rewrite the code region's words to the disassembler's own rendering of
    # them. The comment is that same disassembler's output -- verified against
    # capstone for all 1345 words of stagslct's code region, 0 mismatches -- so
    # this recovers mnemonics rather than inventing them. A word whose comment
    # is the undecoded fallback is left as data.
    decoded = 0
    for index, ln in enumerate(lines):
        match = WORD_LINE.match(ln)
        if not match:
            continue
        offset = label_to_ram(int(match.group(1), 16)) - BASE
        comment = (match.group(3) or "").strip()
        if not (CODE_LO - BASE) <= offset < (CODE_HI - BASE):
            continue
        if not comment or UNDECODED_COMMENT.match(comment):
            continue
        lines[index] = f".L0x{match.group(1)}: {comment}"
        decoded += 1
    # Nothing in such an overlay points at its own code, and only four of
    # stagslct's functions are in-overlay `jal` targets, so entry discovery has
    # to come from the code's own shape. A stack-frame prologue placed
    # immediately after a `jr $ra` and its delay slot cannot be reached by
    # fall-through from the function that just returned, so it starts a new one.
    # Requiring BOTH conditions keeps this conservative: a post-return block
    # with no prologue could still be a branch target inside the same function.
    words = {offset: word for offset, word, _ in word_rows}
    for offset, word in sorted(words.items()):
        if not (CODE_LO - BASE) <= offset < (CODE_HI - BASE):
            continue
        if (word >> 16) != 0x27BD or (word & 0xFFFF) < 0x8000:
            continue  # not `addiu $sp, -n`
        if offset == CODE_LO - BASE or words.get(offset - 8) == 0x03E00008:
            recovered_entries.add(BASE + offset)
    if decoded:
        print(f"recovered {decoded} instructions in "
              f"0x{CODE_LO:08x}-0x{CODE_HI:08x} from `.word` comments, "
              f"{len(recovered_entries)} prologue entries")

targets=set(recovered_entries)
data_pointer_cells={}
before_code=True
for ln in lines:
    if ln.strip() == "# Start of code":
        before_code=False
    for m in re.finditer(r"\bjal\s+0x([0-9a-fA-F]+)", ln):
        a=int(m.group(1),16)
        if lo<=a<hi: targets.add(a)
    mw=re.match(r"\.L0x[0-9a-fA-F]+:\s*\.word\s+0x([0-9a-fA-F]+)", ln)
    if mw:
        a=int(mw.group(1),16)
        # Only a pointer into the code region is a function pointer. Gating on a
        # fixed `BASE+0xb00` floor instead promoted every string-table and
        # binary-table word to an `F0x` entry, which is where 507 of the 518
        # "contains no instructions" artifacts came from.
        if CODE_LO<=a<CODE_HI:
            targets.add(a)
            if before_code:
                cell=re.match(r"\.L0x([0-9a-fA-F]+):", ln)
                if cell:
                    data_pointer_cells[label_to_ram(int(cell.group(1),16))]=a
if args.inventory:
    inventory = json.loads(args.inventory.read_text())
    module = next(
        (item for item in inventory["modules"] if item["id"] == module_name),
        None,
    )
    if module is None:
        raise SystemExit(f"module not found in recovered inventory: {module_name}")
    targets.update(int(function["address"], 16) for function in module["functions"])

# Overlay disassembly spells jump-table addresses as literal lui/addiu pairs.
# Recover relocations when the computed address is a pointer-shaped data cell,
# allowing the closure builder to pull the table and its case bodies in.
relocations={}
jump_table_bases=set()
for index, ln in enumerate(lines):
    code=ln.split("#",1)[0]
    high=re.search(r"\blui\s+\$([a-z0-9]+),\s*(0x[0-9a-fA-F]+|\d+)", code)
    if not high:
        continue
    register=high.group(1)
    upper=int(high.group(2),0)&0xffff
    for low_index in range(index+1,min(index+5,len(lines))):
        low_code=lines[low_index].split("#",1)[0]
        low=re.search(
            rf"\b(addiu|ori)\s+\${register},(?:\s*\${register},)?\s*"
            r"(-?0x[0-9a-fA-F]+|-?\d+)",
            low_code,
        )
        if not low:
            continue
        low_bits=int(low.group(2),0)&0xffff
        immediate=(low_bits-0x10000 if low_bits>=0x8000 else low_bits) if low.group(1)=="addiu" else low_bits
        address=((upper<<16)+immediate)&0xffffffff
        if address in data_pointer_cells:
            symbol=f"D0x{address:08x}"
            relocations[index]=f"lui ${register}, %hi({symbol})"
            relocations[low_index]=f"{low.group(1)} ${register}, %lo({symbol})"
            jump_table_bases.add(address)
        break
out_lines=[".include \"macros.s\"", ".section .text"]
# The overlay's own all-caps symbols (FIELDSTG:, FIGHTSTG_F0x800832d0:) would
# collide with the F0x labels generated below for the same addresses. The
# all-caps class deliberately does not match a lowercase-x F0x name.
MODULE_SYMBOL = re.compile(r"^(?:\.global\s+)?[A-Z][A-Z0-9_]*(?:_F0x[0-9a-fA-F]+)?:?\s*$")
for line_index, ln in enumerate(lines):
    if ln.startswith((".include",".section")): continue
    if MODULE_SYMBOL.match(ln): continue
    m=re.match(r"(\.L0x[0-9a-fA-F]+:)(.*)$", ln)
    if not m:
        out_lines.append(ln); continue
    lab, rest = m.group(1), m.group(2)
    ram = label_to_ram(int(lab[4:-1], 16))
    # Emit one canonical offset-form label whichever convention the source uses,
    # so it matches the offset-form targets that branch rewriting below produces.
    lab = f".L0x{ram - BASE:08x}:"
    # split off trailing comment so we don't rewrite inside it
    code, _, cmt = rest.partition("#")
    if line_index in relocations:
        indent=re.match(r"\s*",code).group(0)
        code=indent+relocations[line_index]+" "
    # jal -> F0x
    code=re.sub(r"\bjal\s+0x([0-9a-fA-F]+)",
        lambda x:f"jal F0x{int(x.group(1),16):08x}" if lo<=int(x.group(1),16)<hi else x.group(0), code)
    # branch/jump raw-RAM target -> .L label (or F0x if it's a known entry = tail call)
    if BR.match(code):
        def repl(x):
            a=int(x.group(1),16)
            if not (lo<=a<hi): return x.group(0)
            return f"F0x{a:08x}" if a in targets else f".L0x{a-BASE:08x}"
        # Absolute-label overlays already spell branch operands as `.L0x<abs>`,
        # and the disassembler spells a jump into a range it classified as data
        # as `j D0x<abs>`. Matching only the bare `0x...` inside such a token
        # rewrote the tail and left the old prefix, producing `.L.L0x...` and
        # `D.L0x...` -- labels that exist nowhere, so m2c failed the whole
        # function with "Cannot find branch target". Consume the prefix too, and
        # never match inside an `F0x` name, which is already correct.
        code=re.sub(r"(?<![A-Za-z0-9_])(?:\.L|D)?0x([0-9a-fA-F]{6,8})\b", repl, code)
    # code-range .word function pointers -> F0x (so they're recognized entries)
    code=re.sub(r"\.word\s+0x([0-9a-fA-F]+)",
        lambda x:(".word F0x%08x"%int(x.group(1),16)) if CODE_LO<=int(x.group(1),16)<CODE_HI else x.group(0), code)
    newline = lab+code+("#"+cmt if cmt else "")
    if ram in jump_table_bases:
        out_lines.append(f".global D0x{ram:08x}")
        out_lines.append(f"D0x{ram:08x}:")
    if ram in targets:
        out_lines.append(f".global F0x{ram:08x}")
        out_lines.append(f"F0x{ram:08x}:")
    out_lines.append(newline)
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text("\n".join(out_lines)+"\n")
if args.entries_out:
    # `decompile_exe.real_entries` re-derives entries from the assembly alone and
    # cannot see an inventory-established function that is reached only through a
    # table this module does not contain. Hand those labels over explicitly.
    args.entries_out.parent.mkdir(parents=True, exist_ok=True)
    args.entries_out.write_text(
        "".join(f"F0x{address:08x}\n" for address in sorted(targets))
    )
print(f"module={module_name} entries={len(targets)} size=0x{maxoff:x}")
