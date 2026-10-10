#!/usr/bin/env python3
"""extract_native_item_grants.py — mine native (non-bytecode) item grants from
the per-stage wstag*.s overlays.

Background (established this session, see docs handoff report):
  The resident set_flag/get_flag dispatch table lives at D0x80048abc:
    +0xc  ($v0 = *(0x80048ac8)) -> F0x800165ac  SET_FLAG(id, val)  (WRITE)
    +0x10 ($v0 = *(0x80048acc)) -> F0x800163b0  GET_FLAG(id, ...)  (READ, ignored here)
  set_flag's dispatcher (F0x800165ac) routes ids whose bank
  `(id>>8)&0xFE` is 0x80..0x8E to F0x800161d8(itemId, val):
      if (val != 0) count++  (capped at 0x63)   <- GRANT (add one unit)
      else          count--  (floor at 0)        <- CONSUME/CLEAR, NOT a grant
  So a native grant is: a call through the resolved address 0x80048ac8
  (the SET pointer, never 0x80048acc the GET pointer) with
  $a0 bank in 0x80..0x8E and $a1 == 1 (nonzero -> increment branch; only
  literal 1 is ever observed and is what "grant" means here).

Two call-site codegen shapes both resolve to the SAME address 0x80048ac8 and
are both handled by tracking constant-valued registers linearly per function:
  (A) lui $s0,0x8005 ; addiu $s0,-0x7544  (s0=0x80048abc) ... lw $v0,0xc($s0)
  (B) lui $v0,0x8005 ; lw $v0,-0x7538($v0)                (folds the +0xc)

This scanner is a tiny per-function constant-propagation simulator (NOT a
regex on one literal instruction string) so it catches both shapes uniformly,
including any other register chosen by the compiler. Function boundaries are
detected by the `addiu $sp, -N` prologue and reset all tracked registers,
so incoming argument registers are never mistaken for the resident base
pointer carried over from a previous, unrelated function.

Output: web/assets/data/native_item_grants.json
  { "grants": [ {overlay, stage, offset, item_id, item_name, flag_id, a1}, ... ],
    "ambiguous": [ {overlay, offset, reason, ...}, ... ] }
"""
import os
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASM = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm" / "dw2003" / "pro"
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
OUT = ROOT / "web/assets/data/native_item_grants.json"
WSTAG_EVENTS = ROOT / "web/assets/events/wstag_events.json"

SET_PTR_ADDR = 0x80048ac8
GET_PTR_ADDR = 0x80048acc

LABEL_RE = re.compile(r"^\.L(0x[0-9a-f]+):\s*(.*?)\s*(#.*)?$")

LUI_RE = re.compile(r"^lui \$(\w+), (0x[0-9a-f]+)$")
LI_RE = re.compile(r"^li \$(\w+), (-?0x[0-9a-f]+)$")
ADDIU2_RE = re.compile(r"^addiu \$(\w+), (-?0x[0-9a-f]+)$")
ADDIU3_RE = re.compile(r"^addiu \$(\w+), \$(\w+), (-?0x[0-9a-f]+)$")
MOVE_RE = re.compile(r"^move_? \$(\w+), \$(\w+)$")
LW_RE = re.compile(r"^lw \$(\w+), (-?0x[0-9a-f]+)\(\$(\w+)\)$")
JALR_RE = re.compile(r"^jalr \$(\w+)$")
PROLOGUE_RE = re.compile(r"^addiu \$sp, -0x[0-9a-f]+$")
DEST_RE = re.compile(r"^\w+_?\s+\$(\w+)")  # generic "op $dest, ..." for invalidation


def mask32(v):
    return v & 0xFFFFFFFF


def parse_insns(text):
    """Yield (offset_int, mnemonic_str) for each instruction line, comments stripped."""
    out = []
    for line in text.splitlines():
        m = LABEL_RE.match(line)
        if not m:
            continue
        off = int(m.group(1), 16)
        out.append((off, m.group(2).strip()))
    return out


def item_names():
    src = (DDW3 / "rust/types/src/item_id.rs").read_text()
    return re.findall(r"^\t(\w+),", src, re.M)


KEY_RE = re.compile(r"DDNA|Card|Pass|Badge|Egg|DE(Sincerity|Knowledge)|Mask|"
                     r"Trophy|Pack|Suit|Herb|Mike|FolderBag|ID$|Mod")


def is_key(item_id, name):
    return 1 <= item_id <= 42 or bool(KEY_RE.search(name))


def scan_file(insns, pointer_addr=SET_PTR_ADDR, accepted_values=(1,)):
    """Return (grants, ambiguous) for one overlay's instruction stream."""
    grants = []
    ambiguous = []
    regs = {}  # register name -> known 32-bit int constant, or 'SETPTR'/'GETPTR' sentinel
    func_start = None  # file offset of the most recent function prologue

    def invalidate(name):
        regs.pop(name, None)

    n = len(insns)
    for i, (off, ins) in enumerate(insns):
        if PROLOGUE_RE.match(ins):
            regs = {}
            func_start = off
            continue

        m = LUI_RE.match(ins)
        if m:
            regs[m.group(1)] = mask32(int(m.group(2), 16) << 16)
            continue
        m = LI_RE.match(ins)
        if m:
            regs[m.group(1)] = mask32(int(m.group(2), 16))
            continue
        m = ADDIU3_RE.match(ins)
        if m:
            dst, src, imm = m.group(1), m.group(2), int(m.group(3), 16)
            if src in regs:
                regs[dst] = mask32(regs[src] + imm)
            else:
                invalidate(dst)
            continue
        m = ADDIU2_RE.match(ins)
        if m:
            dst, imm = m.group(1), int(m.group(2), 16)
            if dst in regs:
                regs[dst] = mask32(regs[dst] + imm)
            else:
                invalidate(dst)
            continue
        m = MOVE_RE.match(ins)
        if m:
            dst, src = m.group(1), m.group(2)
            if src == "zr" or src == "zero":
                regs[dst] = 0
            elif src in regs:
                regs[dst] = regs[src]
            else:
                invalidate(dst)
            continue
        m = LW_RE.match(ins)
        if m:
            dst, imm, base = m.group(1), int(m.group(2), 16), m.group(3)
            if base in regs and isinstance(regs[base], int):
                eff = mask32(regs[base] + imm)
                if eff == SET_PTR_ADDR:
                    regs[dst] = "SETPTR"
                    continue
                if eff == GET_PTR_ADDR:
                    regs[dst] = "GETPTR"
                    continue
            invalidate(dst)
            continue
        m = JALR_RE.match(ins)
        if m:
            target_reg = m.group(1)
            kind = regs.get(target_reg)
            if kind == ("GETPTR" if pointer_addr == GET_PTR_ADDR else "SETPTR"):
                a0 = regs.get("a0")
                # a1 is normally set in the branch-delay slot (next instruction)
                a1 = None
                a1_source = None
                if i + 1 < n:
                    delay_off, delay_ins = insns[i + 1]
                    dm = LI_RE.match(delay_ins)
                    if dm and dm.group(1) == "a1":
                        a1 = mask32(int(dm.group(2), 16))
                        a1_source = "delay-slot"
                    dm = MOVE_RE.match(delay_ins)
                    if dm and dm.group(1) == "a1":
                        a1 = 0 if dm.group(2) in ("zr", "zero") else regs.get(dm.group(2))
                        a1_source = "delay-slot"
                if a1 is None:
                    a1 = regs.get("a1")
                    a1_source = "carried" if isinstance(a1, int) else None
                if not isinstance(a0, int):
                    ambiguous.append({"offset": hex(off), "reason": "a0 not a resolved immediate", "a0": a0})
                elif not isinstance(a1, int):
                    ambiguous.append({"offset": hex(off), "reason": "a1 not resolvable", "flag_id": hex(a0)})
                else:
                    bank = (a0 >> 8) & 0xFE
                    if 0x80 <= bank <= 0x8E:
                        if a1 in accepted_values:
                            grants.append({"offset": hex(off), "flag_id": a0, "a1": a1, "a1_source": a1_source,
                                            "func_start": hex(func_start) if func_start is not None else None})
                        else:
                            ambiguous.append({"offset": hex(off), "reason": f"a1={a1} (not the grant value 1)",
                                               "flag_id": hex(a0)})
                    # non-collection banks through the same pointer are ordinary
                    # flag sets (e.g. progress ordinal) -- not item grants, ignore silently.
            # call clobbers all caller-saved regs
            for r in ("v0", "v1", "a0", "a1", "a2", "a3",
                      "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9"):
                invalidate(r)
            continue

        # generic invalidation for any other instruction that writes a register
        dm = DEST_RE.match(ins)
        if dm and not ins.startswith(("sw ", "sb ", "sh ", "nop", "beq", "bne", "beqz", "bnez",
                                       "bltz", "bgez", "blez", "bgtz", "j ", "jal ", "jr ")):
            invalidate(dm.group(1))

    return grants, ambiguous


def load_event_index():
    """stage -> {on_complete_fn_decimal_offset: event_id} from the already-decoded
    wstag_events.json (on_complete_fn is the native handler's file offset, decimal)."""
    if not WSTAG_EVENTS.exists():
        return {}
    data = json.loads(WSTAG_EVENTS.read_text())
    idx = {}
    for stage, events in data.items():
        m = {}
        for e in events:
            ocf = e.get("on_complete_fn")
            if ocf:
                m[ocf] = e
        idx[stage] = m
    return idx


def main():
    if not ASM.exists():
        raise SystemExit(f"disasm not found at {ASM}")
    names = item_names()
    event_index = load_event_index()
    all_grants = []
    all_ambiguous = []
    unattributed = 0
    for f in sorted(ASM.glob("wstag*.s")):
        overlay = f.stem
        stage = overlay.replace("wstag", "s", 1) if overlay.startswith("wstag") else overlay
        insns = parse_insns(f.read_text(errors="replace"))
        grants, ambiguous = scan_file(insns)
        stage_events = event_index.get(stage, {})
        for g in grants:
            item_id = g["flag_id"] & 0x1FF
            if item_id == 0:
                continue
            name = names[item_id] if item_id < len(names) else f"item#{item_id}"
            func_start_dec = int(g["func_start"], 16) if g["func_start"] else None
            ev = stage_events.get(func_start_dec) if func_start_dec is not None else None
            if ev is None:
                unattributed += 1
            all_grants.append({
                "overlay": overlay,
                "stage": stage,
                "offset": g["offset"],
                "flag_id": g["flag_id"],
                "item_id": item_id,
                "item_name": name,
                "key": is_key(item_id, name),
                "a1": g["a1"],
                "func_start": g["func_start"],
                "event_id": ev["id"] if ev else None,
                "esdmg_stage": ev.get("esdmg_stage") if ev else None,
                "esdmg_entry": ev.get("esdmg_entry") if ev else None,
                "attribution": "on_complete_fn" if ev else "unattributed",
            })
        for a in ambiguous:
            a["overlay"] = overlay
            all_ambiguous.append(a)

    all_grants.sort(key=lambda g: (g["stage"], g["item_id"], g["offset"]))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"grants": all_grants, "ambiguous": all_ambiguous}, indent=2, ensure_ascii=False) + "\n")
    keyn = sum(1 for g in all_grants if g["key"])
    print(f"wrote {OUT.relative_to(ROOT)}: {len(all_grants)} native grants ({keyn} key items), "
          f"{len(all_ambiguous)} ambiguous sites excluded, {unattributed} without an on_complete_fn match")
    for g in all_grants:
        tag = " [KEY]" if g["key"] else ""
        ev = f"event {g['event_id']}" if g["event_id"] is not None else "UNATTRIBUTED"
        print(f"  {g['overlay']:10} @{g['offset']}  {g['item_name']} (#{g['item_id']}) flag={hex(g['flag_id'])}{tag}  <- {ev}")


if __name__ == "__main__":
    main()
