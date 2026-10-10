#!/usr/bin/env python3
"""Symbolic analyzer for one MIPS function.

It walks the instructions and remembers what each register holds. That is what
lets a load or a store name the OBJECT it touches -- `lw $v0, 0x5A4($s0)` is a
read of field +0x5A4 of the first argument when $s0 came from $a0, and knowing
that is the whole reason this file exists.

Everything it reports is derived from the instructions and carries the address
that proves it. It never states purpose.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from tools.mips_parse import Instruction, Operand

REGISTERS = (
    "zr", "at", "v0", "v1", "a0", "a1", "a2", "a3",
    "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
    "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
    "t8", "t9", "k0", "k1", "gp", "sp", "fp", "ra",
    "s8",   # $30 is written both ways by this disassembler
)
ARGUMENT_REGISTERS = ("a0", "a1", "a2", "a3")


@dataclass(frozen=True)
class Value:
    kind: str                   # arg|const|global|stack|load|scaled|table|returned|reached|unknown
    name: str = ""              # kind=arg, or a named global
    number: int = 0             # const value, global address, or shift amount
    obj: "Value | None" = None  # kind=load base, kind=scaled index
    offset: int = 0             # kind=load
    width: str = ""             # kind=load
    at: int = 0                 # address that produced this value


def arg(name: str) -> Value:
    return Value(kind="arg", name=name)


def const(number: int) -> Value:
    return Value(kind="const", number=number)


def glob(address: int, name: str = "") -> Value:
    return Value(kind="global", number=address, name=name)


def stack(offset: int = 0) -> Value:
    """The stack pointer, and how far the frame has moved since entry.

    Without the offset the pointer died at the prologue: `addiu $sp, $sp, -0x100`
    fell through to `unknown`, so every local for the rest of the function read
    as an anonymous object field. 314 calls through a stack local at +0x9C and
    266 at +0xA4 were being matched against real object method slots that
    happen to carry the same number.
    """
    return Value(kind="stack", number=offset)


def scaled(index: Value, shift: int, at: int) -> Value:
    return Value(kind="scaled", obj=index, number=shift, at=at)


def returned(target: int, at: int) -> Value:
    """What a named call left in $v0.

    The ABI puts a function's result there, so naming WHICH call produced the
    value invents nothing -- it records an edge the instruction already states.
    Before this existed a call wiped $v0 to `unknown`, and the object a
    constructor hands back became untraceable one instruction after it was
    built. That is why receiver typing found zero of 1,721 objects: every
    method call on a freshly built object read a register the walk had already
    given up on.
    """
    return Value(kind="returned", number=target, at=at)


def reached(target: int, at: int) -> Value:
    """What a call THROUGH AN OBJECT SLOT left in $v0.

    The instruction does not name this callee; receiver typing does, by working
    out the class of the object and reading the slot out of its table. So the
    edge is inferred, not stated, and it is kept apart from `returned` for that
    reason alone. A wrong class would otherwise propagate into the next pass
    disguised as an identity.
    """
    return Value(kind="reached", number=target, at=at)


def unknown(at: int) -> Value:
    return Value(kind="unknown", at=at)


def join(first: Value, second: Value) -> Value:
    """Two paths met. Agreement survives; disagreement becomes unknown."""
    if first == second:
        return first
    return unknown(max(first.at, second.at))


def initial_state() -> dict[str, Value]:
    state = {name: unknown(0) for name in REGISTERS}
    for name in ARGUMENT_REGISTERS:
        state[name] = arg(name)
    state["zr"] = const(0)
    state["sp"] = stack()
    return state


def read(state: dict[str, Value], operand: Operand | None) -> Value:
    if operand is None or operand.kind != "reg" or operand.reg is None:
        return unknown(0)
    if operand.reg == "zr":
        return const(0)
    return state.get(operand.reg, unknown(0))


def write(state: dict[str, Value], operand: Operand | None, value: Value) -> None:
    """Set a tracked register. A coprocessor register is not one.

    `mtc2 $t3, $9` names GTE register 9, and writing `$9` into the map made the
    state disagree in shape with every other path, so the branch-join merge
    raised KeyError: '9' and lost the whole function. Three functions crashed
    this way. The analyzer models no coprocessor state, so dropping the write is
    the same honest answer the GTE moves already give.
    """
    if operand is not None and operand.kind == "reg" \
            and operand.reg not in (None, "zr") and operand.reg in state:
        state[operand.reg] = value


def symbol_value(operand: Operand) -> Value | None:
    """A global from an address, or from a NAME.

    65 routines in this assembly are written by name over 231 call sites, so a
    check written as `operand.symbol is not None` ignores all of them.
    """
    if operand.symbol is not None:
        return glob(operand.symbol, operand.name or "")
    if operand.name:
        return glob(0, operand.name)
    return None


def apply_arithmetic(state: dict[str, Value], insn: Instruction | None) -> bool:
    """Apply one non-memory instruction. True when this function consumed it."""
    if insn is None:
        return True
    op, ops = insn.mnemonic, insn.operands
    if op == "nop":
        return True
    if op in ("li", "la_", "lui"):
        source = ops[1] if len(ops) > 1 else None
        if source is None:
            return False
        named = symbol_value(source) if source.kind == "sym" else None
        if named is not None:
            write(state, ops[0], named)
        elif source.kind == "imm":
            value = source.value or 0
            write(state, ops[0], const(value << 16 if op == "lui" else value))
        else:
            write(state, ops[0], unknown(insn.address))
        return True
    if op in ("move_", "move"):
        write(state, ops[0], read(state, ops[1] if len(ops) > 1 else None))
        return True
    if op in ("addu", "add"):
        if len(ops) > 2:
            left, right = read(state, ops[1]), read(state, ops[2])
        else:
            left, right = read(state, ops[0]), read(state, ops[1])
        for one, two in ((left, right), (right, left)):
            if one.kind == "scaled" and two.kind == "global":
                write(state, ops[0], Value(kind="table", number=one.number,
                                           obj=one.obj, at=insn.address))
                return True
            if one.kind == "const" and one.number == 0:
                write(state, ops[0], two)
                return True
        write(state, ops[0], unknown(insn.address))
        return True
    if op in ("addiu", "addi", "ori", "sltiu", "slti", "andi", "xori"):
        base = read(state, ops[1]) if len(ops) > 2 else read(state, ops[0])
        # `lui $v0, %hi(D0x80048750)` then `addiu $a1, $v0, %lo(D0x80048750)`
        # materialises an address. The %lo is a SYMBOL operand, not an
        # immediate, so treating it as one threw the address away -- 321
        # instances of this idiom exist in fns.s alone.
        if ops and ops[-1].kind == "sym":
            completed = symbol_value(ops[-1])
            if completed is not None:
                write(state, ops[0], completed)
                return True
        immediate = ops[-1].value if ops and ops[-1].kind == "imm" else None
        if immediate is None:
            write(state, ops[0], unknown(insn.address))
        elif op in ("addiu", "addi") and base.kind == "const":
            write(state, ops[0], const(base.number + immediate))
        elif op in ("addiu", "addi") and base.kind == "stack":
            write(state, ops[0], stack(base.number + immediate))
        elif op in ("addiu", "addi") and base.kind == "global":
            write(state, ops[0], glob(base.number + immediate, base.name))
        elif op == "ori" and base.kind == "const":
            write(state, ops[0], const(base.number | immediate))
        else:
            write(state, ops[0], unknown(insn.address))
        return True
    if op in ("sll", "sra", "srl"):
        source = read(state, ops[1]) if len(ops) > 2 else unknown(insn.address)
        amount = ops[-1].value if ops and ops[-1].kind == "imm" else None
        if op == "sll" and amount is not None and source.kind == "const":
            write(state, ops[0], const(source.number << amount))
        elif op == "sll" and amount is not None:
            write(state, ops[0], scaled(source, amount, insn.address))
        else:
            write(state, ops[0], unknown(insn.address))
        return True
    if op in ("mult", "multu", "div", "divu"):
        return True                      # writes hi/lo, no tracked register
    if op in ("subu", "sub", "and", "or", "xor", "nor", "slt", "sltu",
              "negu", "neg", "sllv", "srlv", "srav", "mflo", "mfhi"):
        write(state, ops[0], unknown(insn.address))
        return True
    return False


WIDTHS = {
    "lb": "byte", "lbu": "byte", "sb": "byte",
    "lh": "halfword", "lhu": "halfword", "sh": "halfword",
    "lw": "word", "sw": "word",
    "lwl": "word-unaligned", "lwr": "word-unaligned",
    "swl": "word-unaligned", "swr": "word-unaligned",
    "lwc2": "word", "swc2": "word",
}
LOADS = {"lb", "lbu", "lh", "lhu", "lw", "lwl", "lwr", "lwc2"}
STORES = {"sb", "sh", "sw", "swl", "swr", "swc2"}
HARDWARE_LOW, HARDWARE_HIGH = 0x1F800000, 0x20000000


def load(obj: Value, offset: int, width: str, at: int) -> Value:
    return Value(kind="load", obj=obj, offset=offset, width=width, at=at)


def describe_object(value: Value) -> str:
    if value.kind == "arg":
        return value.name
    if value.kind == "stack":
        # WHERE in the frame, the same as describe_value already says. Every
        # frame address collapsed to plain `stack`, which made two unrelated
        # things render identically: a function pointer fetched out of a frame
        # slot, and a method slot of an object that LIVES in the frame. Both
        # came out `load(stack+0xN, word)`, so the second was unreachable and
        # the 2,151 calls of the first kind looked like method calls on shared
        # objects. The base now names the local; the offset after it is the
        # slot. Three tests asserted the old collapse and were updated with it.
        return f"stack+0x{value.number:X}" if value.number >= 0 \
            else f"stack-0x{-value.number:X}"
    if value.kind == "global":
        return "hardware" if HARDWARE_LOW <= value.number < HARDWARE_HIGH else "global"
    if value.kind == "const":
        return "hardware" if HARDWARE_LOW <= value.number < HARDWARE_HIGH else "other"
    if value.kind == "returned":
        return f"returned(0x{value.number:08X})"
    if value.kind == "reached":
        return f"reached(0x{value.number:08X})"
    return "other"


def describe_value(value: Value) -> str:
    if value.kind == "arg":
        return f"arg({value.name})"
    if value.kind == "const":
        return f"const(0x{value.number:X})"
    if value.kind == "global":
        return f"global({value.name})" if value.name and not value.number \
            else f"global(0x{value.number:08X})"
    if value.kind == "stack":
        # WHERE in the frame, not merely that it is the frame. An object a
        # function builds in its own frame is handed to its constructor as this
        # address, and without the number there is no way to tell which of the
        # function's locals was the one built.
        return f"stack+0x{value.number:X}" if value.number >= 0 \
            else f"stack-0x{-value.number:X}"
    if value.kind == "load":
        base = value.obj
        where = describe_object(base) if base else "other"
        # Name WHICH global. A call made through a pointer loaded from a global
        # is the game reaching a handler slot, and "global" alone cannot say
        # which slot -- 1,540 indirect calls read that way and none of them
        # could be matched to the function somebody stored there.
        if base is not None and base.kind == "global" and where == "global":
            where = f"global(0x{base.number:08X})"
        # A base that is ITSELF a load is the two-level call this game is built
        # on: the object holds a pointer to a shared table, and the method comes
        # out of that table. Flattening it to "other" hid the first hop and left
        # two thirds of the pointer calls unmatchable.
        elif base is not None and base.kind == "load":
            where = describe_value(base)
        return f"load({where}+0x{value.offset:X}, {value.width})"
    if value.kind == "scaled":
        return f"index<<{value.number}"
    if value.kind == "table":
        return f"table-entry<<{value.number}"
    if value.kind == "returned":
        return f"returned(0x{value.number:08X})"
    if value.kind == "reached":
        return f"reached(0x{value.number:08X})"
    return "unknown"


def apply_memory(state: dict[str, Value], insn: Instruction | None,
                 sink: list[dict]) -> bool:
    """Apply one load or store. True when this function consumed it."""
    if insn is None or insn.mnemonic not in WIDTHS:
        return False
    op = insn.mnemonic
    memory = next((o for o in insn.operands if o.kind == "mem"), None)
    if memory is None:
        return False
    width = WIDTHS[op]
    index_value = state.get(memory.base or "", unknown(insn.address))
    named = symbol_value(memory) if (memory.symbol is not None or memory.name) else None
    if named is not None:
        base, offset = named, 0
    else:
        base = index_value
        offset = memory.offset
        if base.kind == "const":
            base = glob(base.number, base.name)
        # Keep base and displacement APART. Folding them lost the structure:
        # `sw $v1, 0x90($a1)` with $a1 = global 0x80048750 is field +0x90 of the
        # object at 0x80048750, not an anonymous write to 0x800487E0.
    entry = {
        "object": describe_object(base),
        "address": base.number if base.kind in ("global", "const") and base.number
                   else None,
        "name": base.name or None,
        "offset": offset,
        "access": "read" if op in LOADS else "write",
        "width": width,
        "at": insn.address,
    }
    if named is not None and index_value.kind == "table":
        entry["table_base"] = named.number
        entry["table_stride"] = 1 << index_value.number
        entry["table_index"] = describe_value(index_value.obj) if index_value.obj \
            else "unknown"
    # A local is not a field of anything. Following what a function puts in its
    # own frame and takes back out is what makes a pointer held in a local
    # traceable at the call that uses it.
    cell = f"frame{base.number + offset}" if base.kind == "stack" else None
    if op in STORES:
        held = state.get(insn.operands[0].reg or "", unknown(insn.address))
        entry["value"] = describe_value(held)
        if cell is not None and width == "word":
            state[cell] = held
    else:
        entry["value"] = None
        if cell is not None and width == "word" and cell in state:
            write(state, insn.operands[0], state[cell])
        else:
            write(state, insn.operands[0], load(base, offset, width, insn.address))
    sink.append(entry)
    return True


LOOP_CAP = 8
BRANCHES = frozenset({"beq", "bne", "beqz", "bnez", "blez", "bgez", "bgtz",
                      "bltz", "b"})
CALLS = frozenset({"jal", "jalr", "bios_call"})
JUMPS = frozenset({"j", "jr"}) | CALLS
# These touch state the analyzer does not track (GTE registers, the trap
# handler), so consuming them is honest. `lwc2`/`swc2` are NOT here: they are
# memory accesses and apply_memory handles them.
CONSUMED_WITHOUT_EFFECT = frozenset({"nop", "break", "syscall", "mtc2", "mfc2",
                                     "ctc2", "cfc2", "c2"})
CALLER_SAVED = ("v0", "v1", "a0", "a1", "a2", "a3", "t0", "t1", "t2", "t3",
                "t4", "t5", "t6", "t7", "t8", "t9")


LABEL_SELF = re.compile(r"\.L0x([0-9a-fA-F]{8}):")


def is_coprocessor_word(insn: Instruction) -> bool:
    """A raw word the disassembler emitted for a coprocessor-0 instruction."""
    if insn.mnemonic != ".word" or not insn.operands:
        return False
    value = insn.operands[0].value
    return value is not None and (value >> 26) == 0x10


def label_base_of(lines: list[str]) -> int:
    """RAM address of label offset zero, so label-relative branches convert.

    Same derivation as tools/fingerprint_functions.py:source_base -- a line
    carries both its RAM address and its own label, and the difference is the
    base. Sources whose labels are already absolute yield 0, a no-op.
    """
    for text in lines:
        head, _, body = text.partition("  ")
        found = LABEL_SELF.search(body)
        if found:
            try:
                return int(head.strip(), 16) - int(found.group(1), 16)
            except ValueError:
                continue
    return 0


def _target_of(insn: Instruction, label_base: int) -> int | None:
    """Branch or jump target as a RAM address, whatever form it was written in.

    A conditional branch can be written with a function-style symbol rather than
    a local label -- `beqz $v0, F0x800148f4` -- when the target happens to carry
    one. Accepting the symbol form only for `j` and `b` left 8 functions with a
    branch that resolved to nothing and code behind it reported unreachable.
    """
    if insn.mnemonic not in BRANCHES and insn.mnemonic not in ("j", "b"):
        return None
    for operand in insn.operands:
        if operand.kind == "label" and operand.symbol is not None:
            return operand.symbol + label_base
        if operand.kind == "imm" and operand.value is not None \
                and insn.mnemonic in ("j", "b"):
            return operand.value
        if operand.kind == "sym" and operand.symbol is not None:
            return operand.symbol
    return None


@dataclass(frozen=True)
class WalkResult:
    states: dict          # register state on ENTRY to each reached address
    exits: dict           # state after each `jr $ra` and its delay slot
    memory: dict          # instruction address -> access entry
    unmodelled: list      # reached but consumed by no rule
    unreached: list
    capped: bool
    reached: int = 0


def _called_address(insn: Instruction) -> int | None:
    """The address a `jal` names, or None when the target is not a literal."""
    if insn.mnemonic != "jal":
        return None
    for operand in insn.operands:
        if operand.symbol is not None:
            return operand.symbol
    return None


def _step(state: dict[str, Value], insn: Instruction, memory: dict,
          unmodelled: set, executed: set,
          reached_targets: dict[int, int] | None = None) -> None:
    """Execute one instruction. Never raises; an unknown one is recorded."""
    # A delay-slot instruction runs but never gets an entry state of its own,
    # so counting coverage from entry states alone would report it unreached.
    executed.add(insn.address)
    sink: list[dict] = []
    if apply_memory(state, insn, sink):
        memory[insn.address] = sink[0]
        return
    if apply_arithmetic(state, insn):
        return
    if insn.mnemonic in CONSUMED_WITHOUT_EFFECT:
        return
    if insn.mnemonic in BRANCHES or insn.mnemonic in JUMPS:
        if insn.mnemonic in CALLS:
            # A call destroys the caller-saved registers. Saying otherwise
            # would invent facts about what the callee left behind -- with one
            # exception the ABI states outright: $v0 IS the result. Naming
            # which call produced it records an edge the instruction already
            # carries. See returned().
            for name in CALLER_SAVED:
                state[name] = unknown(insn.address)
            called = _called_address(insn)
            if called is not None:
                state["v0"] = returned(called, insn.address)
            elif reached_targets and insn.address in reached_targets:
                state["v0"] = reached(reached_targets[insn.address], insn.address)
        return
    if insn.mnemonic == ".word" and insn.operands:
        value = insn.operands[0].value
        # The disassembler does not decode coprocessor 0 and emits the raw word.
        # `mfc0`/`mtc0` read and write the CPU's own status, cause and return
        # registers -- what a critical section uses to mask interrupts. The
        # analyzer tracks none of those, so consuming it is honest in the same
        # way the GTE moves are, and it is not an unknown instruction.
        if (value >> 26) == 0x10 if value is not None else False:
            return
    unmodelled.add(insn.address)


def walk(instructions: list[Instruction], label_base: int = 0,
         jump_targets: frozenset[int] = frozenset(),
         reached_targets: dict[int, int] | None = None) -> WalkResult:
    """Walk to a fixpoint.

    Three rules, each of which is silent rather than loud when broken:
      1. the instruction in a delay slot executes before the transfer;
      2. two paths meeting with different values yield `unknown`;
      3. loops repeat until nothing changes, capped at LOOP_CAP passes.

    `label_base` converts file-relative branch labels to RAM addresses. Overlay
    sources write `beq ..., .L0x00010f24` for a branch whose RAM target is
    0x80093bd4; without the conversion every overlay branch target resolves to
    nothing and the code beyond it is reported unreachable.

    `jump_targets` are addresses stored in the overlay's data as code pointers.
    A computed `jr $reg` goes to one of them, and which one depends on a value
    only the running game knows -- so the walk follows ALL of them that land
    inside this function. That is the honest reading of a jump table: every
    entry is reachable, and no entry is claimed to be the one taken. Without
    this, 32 functions had a dispatch they could not step past.
    """
    instructions = [i for i in instructions if i is not None]
    if not instructions:
        return WalkResult({}, {}, {}, [], [], False, 0)
    position_of = {insn.address: n for n, insn in enumerate(instructions)}
    entry: dict[int, dict[str, Value]] = {instructions[0].address: initial_state()}
    exits: dict[int, dict[str, Value]] = {}
    memory: dict[int, dict] = {}
    unmodelled: set[int] = set()
    executed: set[int] = set()
    visits: dict[int, int] = {}
    capped = False
    pending = [instructions[0].address]

    while pending:
        address = pending.pop()
        position = position_of.get(address)
        if position is None:
            continue
        visits[address] = visits.get(address, 0) + 1
        if visits[address] > LOOP_CAP:
            capped = True
            continue
        state = dict(entry[address])
        insn = instructions[position]
        _step(state, insn, memory, unmodelled, executed, reached_targets)
        transfers = insn.mnemonic in BRANCHES or insn.mnemonic in JUMPS
        if transfers and position + 1 < len(instructions):
            _step(state, instructions[position + 1], memory, unmodelled,
                  executed, reached_targets)
        if insn.mnemonic == "jr" and any(o.reg == "ra" for o in insn.operands):
            exits[insn.address] = dict(state)

        targets: list[int] = []
        label = _target_of(insn, label_base)
        after = instructions[position + 2].address \
            if position + 2 < len(instructions) else None
        if insn.mnemonic in BRANCHES:
            if label is not None:
                targets.append(label)
            if insn.mnemonic != "b" and after is not None:
                targets.append(after)
        elif insn.mnemonic == "j":
            if label is not None:
                targets.append(label)
        elif insn.mnemonic in CALLS:
            if after is not None:
                targets.append(after)
        elif insn.mnemonic == "jr":
            if not any(o.reg == "ra" for o in insn.operands):
                targets.extend(t for t in jump_targets if t in position_of)
        elif insn.mnemonic == ".word" and not is_coprocessor_word(insn):
            # Data is not code. Marching through a `.word` blob as if it were
            # straight-line instructions made 128 stage overlays report
            # thousands of "unknown instructions" -- wstag400 alone claimed
            # 2,146 -- when the region is the stage's own script data. Stopping
            # here leaves it unreached, where the data rule classifies it.
            pass
        elif position + 1 < len(instructions):
            targets.append(instructions[position + 1].address)

        for target in targets:
            if target not in entry:
                entry[target] = state
                pending.append(target)
                continue
            # The state now carries frame cells beside the registers, and two
            # paths need not have written the same ones. A cell only one path
            # knows is not agreement, so it joins against `unknown`.
            names = set(entry[target]) | set(state)
            merged = {name: join(entry[target].get(name, unknown(0)),
                                 state.get(name, unknown(0)))
                      for name in names}
            if merged != entry[target]:
                entry[target] = merged
                pending.append(target)

    unreached = [i.address for i in instructions if i.address not in executed]
    return WalkResult(entry, exits, memory, sorted(unmodelled), unreached, capped,
                      len(executed))


def next_function_at(instructions: list[Instruction],
                     unreached: list[int]) -> int | None:
    """Where a second function starts inside these lines, if one does.

    Reachability is the boundary rule. Code that no path from the entry reaches,
    sitting directly after a `jr $ra` and its delay slot, is not a gap in this
    function -- it is the next function, and the extent it was read from covers
    both. Measured over the 188 functions that reported a gap, 156 are this:
    101 start with a stack frame, and the rest are leaves that need none, which
    is why testing for a prologue instead of testing reachability misses a third
    of them.
    """
    position = {insn.address: n for n, insn in enumerate(instructions)}
    waiting = set(unreached)
    for address in sorted(unreached):
        n = position.get(address)
        # No function starts with a `nop` or with a data word. Alignment padding
        # after a return is unreached too, and calling it an entry point cost
        # the padding rule that 382 functions depend on.
        if n is None or n < 2 or instructions[n].mnemonic in ("nop", ".word"):
            continue
        back = n - 1
        while back >= 0 and instructions[back].mnemonic in ("nop", ".word") \
                and instructions[back].address in waiting:
            back -= 1                     # step over padding and data, if any
        if back >= 1:
            earlier = instructions[back - 1]
            if earlier.mnemonic == "jr" \
                    and any(o.reg == "ra" for o in earlier.operands):
                return address
    return None


def decode_function(lines: list[str],
                    jump_targets: frozenset[int] = frozenset(),
                    reached_targets: dict[int, int] | None = None) -> dict:
    """Decode one function from its indexed assembly lines.

    `jump_targets` are addresses the overlay's data holds as code pointers; the
    walk uses them to step through a computed `jr $reg`.

    `reached_targets` maps a call site to the function receiver typing says the
    call reaches. It is the second pass: without it a call through an object
    slot leaves $v0 unknown, so an object handed back by such a call cannot be
    traced. See reached().
    """
    from tools.mips_parse import parse_line

    instructions = [i for i in (parse_line(text) for text in lines) if i is not None]
    label_base = label_base_of(lines)
    result = walk(instructions, label_base, jump_targets, reached_targets)

    fields, globals_, hardware, tables = [], [], [], {}
    for address in sorted(result.memory):
        row = result.memory[address]
        if row.get("table_base") is not None:
            tables.setdefault(row["table_base"], {
                "address": row["table_base"], "stride": row["table_stride"],
                "indexed_by": row["table_index"], "at": row["at"]})
        if row["object"] in ARGUMENT_REGISTERS:
            fields.append(row)
        elif row["object"] == "hardware":
            hardware.append(row)
        elif row["object"] == "global":
            globals_.append(row)
        else:
            fields.append(row)

    calls, conditions = [], []
    for insn in instructions:
        state = result.states.get(insn.address)
        if state is None:
            continue
        if insn.mnemonic == "jal":
            target = next((o for o in insn.operands
                           if o.symbol is not None or o.name), None)
            calls.append({
                "at": insn.address,
                "target": (f"0x{target.symbol:08X}" if target and target.symbol
                           is not None else target.name if target else "unresolved"),
                "through": None,
                "arguments": _call_arguments(state)})
        elif insn.mnemonic in ("jalr", "bios_call"):
            through = read(state, insn.operands[0] if insn.operands else None)
            calls.append({"at": insn.address, "target": "indirect",
                          "through": describe_value(through),
                          "arguments": _call_arguments(state)})
        elif insn.mnemonic in BRANCHES:
            target = _target_of(insn, label_base)
            operands = " ".join(describe_value(read(state, o))
                                for o in insn.operands if o.kind == "reg")
            conditions.append({
                "at": insn.address,
                "test": f"{insn.mnemonic} {operands}".strip(),
                "then": f"continue at 0x{target:X}" if target is not None
                        else "continue at an unresolved target"})

    # Instructions after the last one that executed are alignment padding, not
    # a reachability failure. Counting them as a gap made 382 correctly decoded
    # functions look broken and hid the 10 that really are.
    unreached_set = set(result.unreached)
    executed_addresses = [i.address for i in instructions
                          if i.address not in unreached_set]
    last_executed = max(executed_addresses) if executed_addresses else -1
    mnemonics = {i.address: i.mnemonic for i in instructions}
    # Anything past the next function's entry belongs to that function, not to
    # this one, and counting it here reported a gap where there is none.
    boundary = next_function_at(instructions, result.unreached)
    own = [i for i in instructions if boundary is None or i.address < boundary]
    unreached_own = [a for a in result.unreached
                     if boundary is None or a < boundary]
    # Padding is trailing NOPs only. Classifying every trailing unreached
    # instruction as padding would hide real tail code that no path reaches --
    # exactly what happens after a computed `jr $reg` the walk cannot follow.
    padding = [a for a in unreached_own
               if a > last_executed and mnemonics.get(a) == "nop"]
    # A data word no path reaches is data, not code the walk failed to follow.
    # Three of the last five reported gaps were this: 225 words of table data
    # sitting inside one wfightts extent, counted as unreachable code. A word
    # that IS reached stays an unknown instruction, which is the honest reading
    # of a region the extractor dumped without disassembling it.
    data = [a for a in unreached_own if mnemonics.get(a) == ".word"]
    skip = set(padding) | set(data)
    interior = [a for a in unreached_own if a not in skip]

    paths = {f"0x{at:X}": describe_value(state["v0"])
             for at, state in sorted(result.exits.items())}
    distinct = sorted(set(paths.values()))
    reached = result.reached
    return {
        "proven": {
            "arguments": {name: "used" for name in ARGUMENT_REGISTERS
                          if _mentions_argument(result, name)},
            "fields": fields, "globals": globals_, "hardware": hardware,
            "tables": list(tables.values()), "calls": calls,
            "conditions": conditions,
            "returns": {"v0": distinct[0] if len(distinct) == 1 else
                        ("nothing" if not distinct else "varies"), "paths": paths}},
        "coverage": {
            "modelled": reached - len(result.unmodelled),
            "total": len(own),
            "reached": reached,
            "unmodelled": result.unmodelled,
            "unreached": interior,
            "padding": padding,
            "data": data,
            "capped": result.capped,
            "next_function": boundary},
    }


def _call_arguments(state: dict[str, Value]) -> dict[str, str]:
    return {name: describe_value(state[name]) for name in ARGUMENT_REGISTERS
            if state[name].kind != "unknown"}


def _mentions_argument(result: WalkResult, name: str) -> bool:
    """True when the argument is used as a base or stored somewhere."""
    for row in result.memory.values():
        if row["object"] == name or (row.get("value") or "") == f"arg({name})":
            return True
    return False
