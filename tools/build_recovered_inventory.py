#!/usr/bin/env python3
"""Build the durable DDW3 original-function recovery inventory.

This is deliberately a structural extractor, not a semantic oracle.  The
resident executable has explicit F0x labels, while most overlays do not.  For
an overlay we therefore distinguish callable entry points established by a
direct ``jal`` (plus the overlay's code entry) from pointer-shaped candidates
found in its data.  Candidate pointers are never silently promoted to
functions: jump-table destinations have the same binary shape.

The generated inventory is the common join point for later recovered code,
semantic annotations, call-graph propagation, and measurable coverage.  Run
this scanner under the repository overlay resource cap, for example:

    taskset -c 0 prlimit --as=4294967296 -- \
      python3 tools/build_recovered_inventory.py
"""

from __future__ import annotations

import os
import argparse
import bisect
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


# The PS1 has 2 MiB of main RAM mapped at 0x80000000 in KSEG0, so no overlay
# function can live at or above 0x80200000. Data regions that the upstream
# splat did not instruction-decode (smdldata is model data, not code) produce
# bytes that disassemble as `jal` to arbitrary addresses; without an upper
# bound those garbage targets were promoted into 332 phantom function entries,
# 8.9% of the inventory. A target outside this window is decoded noise, not an
# entry point.
RAM_START = 0x80000000
RAM_END = 0x80200000

LABEL_RE = re.compile(r"^\.L0x([0-9a-fA-F]{8}):\s*(.*)$")
FUNCTION_LABEL_RE = re.compile(r"^(F0x([0-9a-fA-F]{8})):\s*$")
JAL_RE = re.compile(r"\bjal\s+(?:[A-Za-z0-9_]*F)?(0x[0-9a-fA-F]{8})\b")
JALR_RE = re.compile(
    r"\bjalr\s+\$([a-z0-9]+)(?:\s*,\s*\$([a-z0-9]+))?\b"
)
WORD_RE = re.compile(r"(?:^|\s)\.word\s+0x([0-9a-fA-F]{1,8})\b")
COMMENT_WORD_RE = re.compile(r"#\s*\.word\s+0x([0-9a-fA-F]{1,8})\b")
# Roughly half the corpus was emitted as raw `.word` rows carrying the
# disassembly only in a trailing comment. The two forms are mirror images:
# a decoded line is `addiu $s1, $v0, -0x4830  # .word 0x2451b7d0`, an undecoded
# one is `.word 0x24845ee4  # addiu $a0, 0x5ee4`. Requiring the comment to open
# with a mnemonic keeps plain data rows, whose comments are bare addresses, out.
WORD_DISASM_RE = re.compile(
    r"^\.word\s+0x[0-9a-fA-F]{1,8}\s*#\s*([a-z][a-z0-9_.]*\b.*?)\s*$"
)
ARG_DIRECT_RE = re.compile(
    r"^(?:li|la_)\s+\$(a[0-3]),\s*([-.A-Za-z_0-9]+)"
)
ARG_ZERO_RE = re.compile(r"^move_\s+\$(a[0-3]),\s*\$zr\b")
ARG_ADDIU_ZERO_RE = re.compile(
    r"^(?:addiu|ori)\s+\$(a[0-3]),\s*\$zr,\s*(-?0x[0-9a-fA-F]+|-?\d+)"
)
ARG_LOW_RE = re.compile(r"^(?:addiu|ori)\s+\$(a[0-3]),\s*(-?0x[0-9a-fA-F]+|-?\d+)")
ARG_LUI_RE = re.compile(r"^lui\s+\$(a[0-3]),\s*(0x[0-9a-fA-F]+|\d+)")
ARG_WRITE_RE = re.compile(r"^[A-Za-z0-9_.]+\s+\$(a[0-3])(?:,|\s)")
KNOWN_CALL_ARITY = {0x800143DC: 4, 0x80014504: 3}
REGISTER_LA_RE = re.compile(
    r"^la_\s+\$([a-z0-9]+),\s*([-.A-Za-z_0-9]+)"
)
REGISTER_LUI_ANY_RE = re.compile(
    r"^lui\s+\$([a-z0-9]+),\s*(-?0x[0-9a-fA-F]+|-?\d+)"
)
REGISTER_LOW_SELF_RE = re.compile(
    r"^(addiu|ori)\s+\$([a-z0-9]+),\s*(-?0x[0-9a-fA-F]+|-?\d+)"
)
# The cross-register half of the same idiom: the disassembler prints the
# two-operand form only when destination and source are the same register, so
# `lui $v0, 0x8005` / `addiu $s1, $v0, -0x4830` needs its own recogniser.
REGISTER_LOW_PAIR_RE = re.compile(
    r"^(addiu|ori)\s+\$([a-z0-9]+),\s*\$([a-z0-9]+),\s*(-?0x[0-9a-fA-F]+|-?\d+)"
)
REGISTER_LOAD_RE = re.compile(
    r"^lw\s+\$([a-z0-9]+),\s*([^()]*)\(\$([a-z0-9]+)\)"
)
GLOBAL_REGISTER_LOAD_RE = re.compile(
    r"^lw\s+\$([a-z0-9]+),\s*%lo\(D0x([0-9a-fA-F]{8})\)\(\$([a-z0-9]+)\)"
)
REGISTER_WRITE_RE = re.compile(r"^[A-Za-z0-9_.]+\s+\$([a-z0-9]+)(?:,|\s)")
# Registers the MIPS o32 convention preserves across a call.  A constant base
# held in one of these is normally materialised once in the prologue and then
# used for the whole body, so recovering it may look further back than the
# fixed local window without crossing a call that could have rewritten it.
# Caller-saved registers must keep the local window.
CALLEE_SAVED_REGISTERS = frozenset(
    {"s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "fp", "gp"}
)
LOCAL_PRODUCER_WINDOW = 0x40
SHARED_OBJECT_METHOD_SLOTS = {
    0x28: "exe/fns:F0x80014274",
    0x2C: "exe/fns:F0x80014288",
    0x30: "exe/fns:F0x80014298",
    0x34: "exe/fns:F0x800142a4",
    0x38: "exe/fns:F0x800142ac",
    0x3C: "exe/fns:F0x800142c8",
    0x40: "exe/fns:F0x800142e0",
    0x44: "exe/fns:F0x800142f4",
    0x4C: "exe/fns:F0x80014308",
}
STATIC_POINTER_SCALAR_RE = re.compile(
    r"pub static mut ([A-Za-z_][A-Za-z_0-9]*)\s+@\s+\"(0x[0-9a-fA-F]{8})\".*"
    r"ptr::addr_of!\(((?:F0x)[0-9a-fA-F]{8}|f\d+)\)"
)
STATIC_NAMED_FN_POINTER_RE = re.compile(
    r"pub static mut ([A-Za-z_][A-Za-z_0-9]*)\s+@\s+\"(0x[0-9a-fA-F]{8})\"\s*:"
    r"\s*unsafe extern \"C\" fn.*=\s*([A-Za-z_][A-Za-z_0-9]*)\s*;"
)
STATIC_FUNCTION_POINTER_ARRAY_RE = re.compile(
    r"pub static mut (D0x[0-9a-fA-F]{8}).*:\s*"
    r"\[\*const u32;\s*(\d+)\]"
)
STATIC_POINTER_ITEM_RE = re.compile(
    r"ptr::addr_of!\(((?:F0x|D0x)[0-9a-fA-F]{8}|f\d+)\)"
)
STATIC_NULL_POINTER_RE = re.compile(r"core::ptr::null\(\)")
OVERLAY_U32_ARRAY_RE = re.compile(
    r"pub static mut ([A-Za-z_][A-Za-z_0-9]*)\s+@\s+\"(0x[0-9a-fA-F]{8})\"\s*:"
    r"\s*\[u32;\s*(\d+)\]"
)
OVERLAY_U32_WORD_RE = re.compile(r"^\s*(0x[0-9a-fA-F]{8}),")
OVERLAY_OFFSET_COMMENT_RE = re.compile(r"//\s*(0x[0-9a-fA-F]{8})")


@dataclass(frozen=True)
class Instruction:
    line: int
    address: int
    file_offset: int | None
    text: str


@dataclass
class Entry:
    address: int
    line: int
    origins: set[str] = field(default_factory=set)


@dataclass
class Module:
    name: str
    source: str
    path: Path
    base: int | None
    sha256: str
    instructions: list[Instruction]
    instructions_by_address: dict[int, Instruction]
    # ``instructions`` in ascending address order, plus its key list, so a
    # backward producer search can slice a window instead of rescanning the
    # whole module for every call site.
    ordered_instructions: list[Instruction]
    ordered_addresses: list[int]
    address_lines: dict[int, int]
    entries: dict[int, Entry]
    pointer_candidates: dict[int, list[int]]
    calls: list[tuple[Instruction, int]]
    indirect_calls: list[tuple[Instruction, str]]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def module_base(stem: str) -> int:
    return 0x800A5DE0 if stem.startswith(("wstag", "wfight")) else 0x80082CB0


def stable_module_name(path: Path, asm_root: Path) -> str:
    relative = path.relative_to(asm_root).with_suffix("")
    return relative.as_posix()


def stable_source(path: Path, asm_root: Path) -> str:
    return "~/ddw3/asm/dw2003/" + path.relative_to(asm_root).as_posix()


def canonical_id(module: str, address: int) -> str:
    return f"{module}:F0x{address:08x}"


def jalr_call_target(text: str) -> str | None:
    """Return the target register only when jalr writes the return address."""
    match = JALR_RE.search(text)
    if not match:
        return None
    link_register, explicit_target = match.groups()
    if explicit_target is None:
        return link_register
    if link_register in ("ra", "31"):
        return explicit_target
    return None


def parse_module(path: Path, asm_root: Path) -> Module:
    name = stable_module_name(path, asm_root)
    source = stable_source(path, asm_root)
    base = None if name == "exe/fns" else module_base(path.stem)
    lines = path.read_text(errors="replace").splitlines()
    instructions: list[Instruction] = []
    decoded_instructions: list[Instruction] = []
    address_lines: dict[int, int] = {}
    entries: dict[int, Entry] = {}
    calls: list[tuple[Instruction, int]] = []
    indirect_calls: list[tuple[Instruction, str]] = []
    pointer_rows: list[tuple[int, int]] = []
    first_code_after_marker: Instruction | None = None
    saw_code_marker = False

    def add_entry(address: int, line: int, origin: str) -> None:
        entry = entries.setdefault(address, Entry(address=address, line=line))
        entry.line = min(entry.line, line)
        entry.origins.add(origin)

    for line_number, line in enumerate(lines, 1):
        if line.strip() == "# Start of code":
            saw_code_marker = True
            continue
        function = FUNCTION_LABEL_RE.match(line)
        if function:
            add_entry(int(function.group(2), 16), line_number, "original_label")
            continue
        label = LABEL_RE.match(line)
        if not label:
            continue
        raw_address = int(label.group(1), 16)
        address = raw_address if raw_address >= 0x80000000 else (base or 0) + raw_address
        file_offset = raw_address if raw_address < 0x80000000 else (
            address - base if base is not None and address >= base else None
        )
        address_lines[address] = line_number
        body = label.group(2)
        raw_word = WORD_RE.search(body) or COMMENT_WORD_RE.search(body)
        if raw_word:
            pointer_rows.append((line_number, int(raw_word.group(1), 16)))
        if body.startswith(".word"):
            # Some overlays were not instruction-decoded by the upstream splat,
            # but their comments still expose direct calls. A jal target is a
            # sound entry-point fact even when the caller boundary is unknown.
            jal = JAL_RE.search(body)
            if jal:
                target = int(jal.group(1), 16)
                raw_call = Instruction(line_number, address, file_offset, body)
                calls.append((raw_call, target))
                if base is not None and base <= target < RAM_END:
                    add_entry(target, address_lines.get(target, line_number), "direct_call_target")
            jalr_target = jalr_call_target(body)
            if jalr_target:
                indirect_calls.append((Instruction(line_number, address, file_offset, body), jalr_target))
            # The row is still an instruction. Keeping its disassembly in the
            # scan list is what lets a backward producer search see these
            # regions at all; call edges stay recorded above, so no edge is
            # counted twice.
            disassembled = WORD_DISASM_RE.match(body)
            if disassembled:
                instructions.append(
                    Instruction(line_number, address, file_offset, disassembled.group(1))
                )
            continue
        instruction = Instruction(line_number, address, file_offset, body)
        instructions.append(instruction)
        decoded_instructions.append(instruction)
        if saw_code_marker and first_code_after_marker is None:
            first_code_after_marker = instruction
        jal = JAL_RE.search(body)
        if jal:
            target = int(jal.group(1), 16)
            calls.append((instruction, target))
            if base is not None:
                # A direct call into this overlay is authoritative evidence of a
                # callable entry point. Resident calls are resolved later.
                if base <= target < RAM_END:
                    add_entry(target, line_number, "direct_call_target")
        jalr_target = jalr_call_target(body)
        if jalr_target:
            indirect_calls.append((instruction, jalr_target))

    if base is not None and instructions:
        entry = first_code_after_marker or min(instructions, key=lambda item: item.address)
        add_entry(entry.address, entry.line, "overlay_code_entry")

    # fns.s labels are authoritative and complete enough to own direct calls by
    # address. Other executable fragments are intentionally excluded upstream.
    if base is None:
        for instruction, target in calls:
            if target in entries:
                entries[target].origins.add("direct_call_target")

    # Overlays at 0x80082cb0 and 0x800a5de0 are resident together, so a `jal`
    # from one into the other's window is a genuine cross-overlay call, not a
    # function of the calling module. Bounding promotion only by RAM_END
    # attributed 52 such targets to whichever module happened to call them.
    # A direct call is evidence that an entry point EXISTS, never evidence of
    # which module owns it, so drop the ones outside this module's own extent
    # unless the module's own disassembly independently labels them.
    if base is not None and address_lines:
        module_end = max(address_lines) + 0x10
        for address in [
            address for address in entries
            if not (base <= address < module_end)
            and entries[address].origins == {"direct_call_target"}
        ]:
            del entries[address]

    for address, entry in entries.items():
        if address in address_lines:
            entry.line = address_lines[address]

    pointer_candidates: dict[int, list[int]] = {}
    # Deliberately the DECODED rows only. Widening this to `.word` rows would
    # give every `.word`-only overlay a full code range and turn every aligned
    # data word inside it into a candidate -- 2,298 candidates became 36,270
    # when measured. Whether that range is the right one is a separate question
    # from making the producer scans see these regions; do not merge the two.
    if base is not None and decoded_instructions:
        code_start = min(item.address for item in decoded_instructions)
        code_end = max(item.address for item in decoded_instructions)
        for line_number, value in pointer_rows:
            if value % 4 == 0 and code_start <= value <= code_end and value not in entries:
                pointer_candidates.setdefault(value, []).append(line_number)

    ordered_instructions = sorted(instructions, key=lambda item: item.address)
    return Module(
        name=name,
        source=source,
        path=path,
        base=base,
        sha256=sha256_file(path),
        instructions=instructions,
        instructions_by_address={item.address: item for item in instructions},
        ordered_instructions=ordered_instructions,
        ordered_addresses=[item.address for item in ordered_instructions],
        address_lines=address_lines,
        entries=entries,
        pointer_candidates=pointer_candidates,
        calls=calls,
        indirect_calls=indirect_calls,
    )


UNCONDITIONAL_TRANSFER_RE = re.compile(r"^\s*(?:jr|jalr|j|b)\s")


def terminates_preceding_function(module: Module, address: int) -> bool:
    """Whether the instruction stream before `address` leaves the function.

    A compiler-emitted MIPS function is preceded by an unconditional transfer
    plus its delay slot, so the word two instructions back is the terminator.
    When nothing precedes the address inside this module the boundary is the
    module's own start and is therefore genuine.
    """
    previous = module.instructions_by_address.get(address - 8)
    if previous is None:
        # Either the module starts here or the preceding words were not
        # instruction-decoded. Neither is evidence of fall-through.
        return module.instructions_by_address.get(address - 4) is None
    return bool(UNCONDITIONAL_TRANSFER_RE.match(previous.text))


def has_control_transfer(module: Module, address: int) -> bool:
    """Whether the contiguous decoded run from `address` transfers control.

    A MIPS function must return (`jr $ra`), tail-jump (`j`) or at least branch.
    When the address is not decoded, or the run walks straight from the entry
    into data without any of those, the address is a data label that some
    artifact promoted, not a function.
    """
    current = address
    while True:
        instruction = module.instructions_by_address.get(current)
        if instruction is None:
            return False
        if UNCONDITIONAL_TRANSFER_RE.match(instruction.text):
            return True
        current += 4


def reject_data_label_entries(modules: list[Module]) -> list[dict[str, object]]:
    """Delete pointer-target data words that only an artifact promoted.

    `.word` pointer tables name data records; when a record's first words were
    decoded as instructions, the upstream splatter promoted the address to an
    entry, m2c then lifted the word, and the entry sustained itself through its
    own C file. An m2c file with no terminator (m2c: `missing "jr $ra"`), or an
    overlay-entry fallback in an overlay that has no code marker, is the only
    evidence such an address ever carries. A real function also reached through
    a call, a factory argument, a curated annotation or a label keeps its entry
    regardless.
    """
    rejected: list[dict[str, object]] = []
    for module in modules:
        data_labels = [
            address
            for address, entry in module.entries.items()
            if entry.origins in ({"decompiled_c"}, {"overlay_code_entry"})
            and not has_control_transfer(module, address)
        ]
        for address in data_labels:
            rejected.append({
                "id": canonical_id(module.name, address),
                "module": module.name,
                "address": f"0x{address:08x}",
                "line": module.entries[address].line,
                "reason": "no_control_transfer_in_decoded_run",
                "entry_evidence": sorted(module.entries[address].origins),
            })
            del module.entries[address]
    rejected.sort(key=lambda item: (item["module"], item["address"]))
    return rejected


def reject_phantom_entries(modules: list[Module]) -> list[dict[str, object]]:
    """Delete false function boundaries from the authoritative entry set.

    m2c will happily decompile from a shared epilogue label that is reached by
    fall-through from inside the owning function. Such a label is not a
    function, and an entry resting on the existence of that C file alone has no
    independent evidence that it is one. An entry that any caller, label,
    factory callback, pointer cell or curated annotation also establishes is
    kept regardless: those are real entry points that merely happen to be
    reachable by fall-through as well.
    """
    rejected: list[dict[str, object]] = []
    for module in modules:
        phantoms = [
            address
            for address, entry in module.entries.items()
            if entry.origins == {"decompiled_c"}
            and address in module.instructions_by_address
            and not terminates_preceding_function(module, address)
        ]
        for address in phantoms:
            previous = module.instructions_by_address.get(address - 8)
            rejected.append({
                "id": canonical_id(module.name, address),
                "module": module.name,
                "address": f"0x{address:08x}",
                "line": module.entries[address].line,
                "reason": "intra_overlay_fall_through_into_entry",
                "entry_evidence": sorted(module.entries[address].origins),
                "preceding_instruction": previous.text.strip() if previous else None,
                "preceding_address": f"0x{address - 8:08x}" if previous else None,
            })
            del module.entries[address]
    rejected.sort(key=lambda item: (item["module"], item["address"]))
    return rejected


def discover_sources(asm_root: Path) -> list[Path]:
    sources = [asm_root / "exe/fns.s"]
    sources.extend(sorted((asm_root / "pro").glob("*.s")))
    return [path for path in sources if path.is_file()]


def nearest_entry(entries: list[int], address: int) -> int | None:
    result = None
    for entry in entries:
        if entry > address:
            break
        result = entry
    return result


def argument_value(token: str, base: int | None) -> dict[str, object] | None:
    if token.startswith(("F0x", "D0x")):
        return {"kind": "address", "value": f"0x{int(token[1:], 16):08x}"}
    if token.startswith(".L0x"):
        raw = int(token[4:], 16)
        address = raw if raw >= 0x80000000 else (base or 0) + raw
        return {"kind": "address", "value": f"0x{address:08x}"}
    try:
        value = int(token, 0)
    except ValueError:
        return {"kind": "symbol", "value": token}
    return {"kind": "integer", "value": value}


def recover_call_arguments(
    module: Module, call: Instruction, argument_count: int,
) -> dict[str, dict[str, object]]:
    """Recover only literal/macro argument assignments near a direct call.

    This intentionally does not perform branch-sensitive constant propagation.
    The delay slot is checked first because its assignment overrides any earlier
    value. Unknown writes stop recovery for that register instead of guessing.
    """
    by_address = module.instructions_by_address
    wanted = {f"a{index}" for index in range(argument_count)}
    delay = by_address.get(call.address + 4)
    before = [
        item for item in module.instructions
        if call.address - 0x40 <= item.address < call.address
    ]
    scan = ([delay] if delay else []) + list(reversed(before))
    values: dict[str, dict[str, object]] = {}
    blocked: set[str] = set()
    for instruction in scan:
        text = instruction.text.strip()
        zero = ARG_ZERO_RE.match(text)
        if zero and zero.group(1) in wanted and zero.group(1) not in values and zero.group(1) not in blocked:
            values[zero.group(1)] = {"kind": "integer", "value": 0}
            continue
        addiu = ARG_ADDIU_ZERO_RE.match(text)
        if addiu and addiu.group(1) in wanted and addiu.group(1) not in values and addiu.group(1) not in blocked:
            values[addiu.group(1)] = {"kind": "integer", "value": int(addiu.group(2), 0)}
            continue
        direct = ARG_DIRECT_RE.match(text)
        if direct and direct.group(1) in wanted and direct.group(1) not in values and direct.group(1) not in blocked:
            value = argument_value(direct.group(2), module.base)
            if value is not None:
                values[direct.group(1)] = value
            continue
        low = ARG_LOW_RE.match(text)
        if low and low.group(1) in wanted and low.group(1) not in values and low.group(1) not in blocked:
            previous = by_address.get(instruction.address - 4)
            high = ARG_LUI_RE.match(previous.text.strip()) if previous else None
            if high and high.group(1) == low.group(1):
                high_value = int(high.group(2), 0) << 16
                low_value = int(low.group(2), 0)
                if text.startswith("addiu") and low_value >= 0x8000:
                    low_value -= 0x10000
                address = (high_value + low_value) & 0xFFFFFFFF
                values[low.group(1)] = {"kind": "address", "value": f"0x{address:08x}"}
                continue
        write = ARG_WRITE_RE.match(text)
        if write and write.group(1) in wanted and write.group(1) not in values:
            blocked.add(write.group(1))
        if len(values) + len(blocked) == len(wanted):
            break
    return values


def resolve_address_target(
    module: Module,
    address: int,
    exe_entries: dict[int, Entry],
    address_candidates: dict[int, list[str]],
) -> tuple[str, str | None, list[str]]:
    """Resolve an address without treating reused overlay VAs as unique."""
    if address in module.entries:
        return "local", canonical_id(module.name, address), []
    if address in exe_entries:
        return "resident", canonical_id("exe/fns", address), []
    alternatives = address_candidates.get(address, [])
    if len(alternatives) == 1:
        return "unique_other_module", alternatives[0], alternatives
    if alternatives:
        return "ambiguous_overlay_address", None, alternatives
    return "unresolved", None, []


def recover_constant_register(
    module: Module,
    instructions: list[Instruction],
    before_address: int,
    register: str,
) -> tuple[int, int] | None:
    """Recover a nearby literal/hi+lo value and its final producer address."""
    by_address = module.instructions_by_address
    for instruction in reversed([
        item for item in instructions if item.address < before_address
    ]):
        text = instruction.text.strip()
        direct = REGISTER_LA_RE.match(text)
        if direct and direct.group(1) == register:
            value = argument_value(direct.group(2), module.base)
            if value and value["kind"] == "address":
                return int(value["value"], 16), instruction.address
        pair = REGISTER_LOW_PAIR_RE.match(text)
        if pair and pair.group(2) == register:
            previous = by_address.get(instruction.address - 4)
            high = REGISTER_LUI_ANY_RE.match(previous.text.strip()) if previous else None
            if high and high.group(1) == pair.group(3):
                high_value = int(high.group(2), 0) << 16
                low_value = int(pair.group(4), 0)
                if pair.group(1) == "addiu" and low_value >= 0x8000:
                    low_value -= 0x10000
                return (high_value + low_value) & 0xFFFFFFFF, instruction.address
            # Otherwise the register is written with a value this reader cannot
            # recover; the write check below stops the search rather than
            # letting it reach a stale earlier base.
        low = REGISTER_LOW_SELF_RE.match(text)
        if low and low.group(2) == register:
            previous = by_address.get(instruction.address - 4)
            high = REGISTER_LUI_ANY_RE.match(previous.text.strip()) if previous else None
            if high and high.group(1) == register:
                high_value = int(high.group(2), 0) << 16
                low_value = int(low.group(3), 0)
                if low.group(1) == "addiu" and low_value >= 0x8000:
                    low_value -= 0x10000
                return (high_value + low_value) & 0xFFFFFFFF, instruction.address
        high = REGISTER_LUI_ANY_RE.match(text)
        if high and high.group(1) == register:
            return (int(high.group(2), 0) << 16) & 0xFFFFFFFF, instruction.address
        write = REGISTER_WRITE_RE.match(text)
        if write and write.group(1) == register:
            break
    return None


def instruction_window(
    module: Module, start: int, stop: int,
) -> list[Instruction]:
    """Instructions with ``start <= address < stop``, in ascending address order."""
    addresses = module.ordered_addresses
    return module.ordered_instructions[
        bisect.bisect_left(addresses, start):bisect.bisect_left(addresses, stop)
    ]


def resolve_global_pointer_cell(
    module: Module,
    symbol: str,
    exe_targets: dict[str, dict[str, object]],
    overlay_targets: dict[str, list[dict[str, object]]],
) -> tuple[dict[str, object] | None, list[str]]:
    annotation = exe_targets.get(symbol)
    if annotation is not None:
        return annotation, []
    candidates = overlay_targets.get(symbol, [])
    local = [item for item in candidates if item["owner_module"] == module.name]
    selected = local if local else candidates
    if len(selected) == 1:
        return selected[0], []
    alternatives = sorted({
        item["target"] for item in selected if item.get("target") is not None
    })
    return None, alternatives


def recover_indirect_call(
    module: Module,
    call: Instruction,
    register: str,
    exe_entries: dict[int, Entry],
    address_candidates: dict[int, list[str]],
    global_targets: dict[str, dict[str, object]],
    overlay_global_targets: dict[str, list[dict[str, object]]] | None = None,
    function_start: int | None = None,
) -> dict[str, object]:
    """Classify the closest sound producer of a jalr target register.

    This is deliberately local and non-flow-sensitive. A shared-object slot
    match remains a candidate unless the receiver type is independently
    established; unrelated interfaces can reuse the same numeric offsets.

    The one exception is the base register of a pointer load: when it is
    callee-saved and the enclosing function start is known, the base search
    runs back to that start instead of the local window, because such a base
    is materialised once in the prologue and reused for the whole body.  The
    search still stops at the first instruction that writes the register, so
    the recovered base is the one live at the load.
    """
    overlay_global_targets = overlay_global_targets or {}
    before = instruction_window(
        module, call.address - LOCAL_PRODUCER_WINDOW, call.address,
    )
    for instruction in reversed(before):
        text = instruction.text.strip()
        global_load = GLOBAL_REGISTER_LOAD_RE.match(text)
        if global_load and global_load.group(1) == register:
            symbol = f"D0x{global_load.group(2).lower()}"
            annotation, alternatives = resolve_global_pointer_cell(
                module, symbol, global_targets, overlay_global_targets,
            )
            target_id = annotation.get("target") if annotation else None
            return {
                "kind": "global_function_pointer",
                "producer_address": f"0x{instruction.address:08x}",
                "global_symbol": symbol,
                "global_address": f"0x{int(symbol[3:], 16):08x}",
                "target_id": target_id,
                "resolution": (
                    annotation.get("resolution_basis", "curated_semantics")
                    if annotation else (
                        "ambiguous_overlay_function_pointer"
                        if alternatives else "unresolved_global_pointer"
                    )
                ),
                "alternatives": alternatives or None,
            }

        direct = REGISTER_LA_RE.match(text)
        if direct and direct.group(1) == register:
            value = argument_value(direct.group(2), module.base)
            if value and value["kind"] == "address":
                address = int(value["value"], 16)
                resolution, target_id, alternatives = resolve_address_target(
                    module, address, exe_entries, address_candidates,
                )
                return {
                    "kind": "literal_function_pointer",
                    "producer_address": f"0x{instruction.address:08x}",
                    "target_address": f"0x{address:08x}",
                    "target_id": target_id,
                    "resolution": resolution,
                    "alternatives": alternatives or None,
                }

        load = REGISTER_LOAD_RE.match(text)
        if load and load.group(1) == register:
            raw_offset = load.group(2).strip() or "0"
            try:
                offset = int(raw_offset, 0)
            except ValueError:
                return {
                    "kind": "memory_function_pointer",
                    "producer_address": f"0x{instruction.address:08x}",
                    "base_register": load.group(3),
                    "raw_offset": raw_offset,
                    "target_id": None,
                    "resolution": "unresolved_memory_pointer",
                    "alternatives": None,
                }
            base_register = load.group(3)
            window_start = call.address - LOCAL_PRODUCER_WINDOW
            base_scan = before
            if (
                function_start is not None
                and base_register in CALLEE_SAVED_REGISTERS
                and function_start < window_start
            ):
                base_scan = instruction_window(
                    module, function_start, call.address,
                )
            constant_base = recover_constant_register(
                module, base_scan, instruction.address, base_register,
            )
            if constant_base is not None:
                base_address, base_producer = constant_base
                base_recovery = (
                    "callee_saved_literal_base_from_function_start"
                    if base_producer < window_start
                    else "nearest_local_literal_base_non_flow_sensitive"
                )
                cell_address = (base_address + offset) & 0xFFFFFFFF
                symbol = f"D0x{cell_address:08x}"
                annotation, alternatives = resolve_global_pointer_cell(
                    module, symbol, global_targets, overlay_global_targets,
                )
                target_id = annotation.get("target") if annotation else None
                return {
                    "kind": (
                        "global_function_pointer" if annotation or alternatives
                        else "absolute_memory_function_pointer"
                    ),
                    "producer_address": f"0x{instruction.address:08x}",
                    "base_producer_address": f"0x{base_producer:08x}",
                    "base_register": base_register,
                    "address_recovery": base_recovery,
                    "global_address": f"0x{cell_address:08x}",
                    "global_symbol": symbol,
                    "target_id": target_id,
                    "resolution": (
                        annotation.get("resolution_basis", "curated_semantics")
                        if annotation else (
                            "ambiguous_overlay_function_pointer"
                            if alternatives else "unresolved_absolute_memory_pointer"
                        )
                    ),
                    "alternatives": alternatives or None,
                }
            candidate = SHARED_OBJECT_METHOD_SLOTS.get(offset)
            if candidate:
                resolution = "candidate_shared_object_method"
            elif offset == 0x48:
                resolution = "dynamic_object_callback_slot"
            else:
                resolution = "struct_function_slot"
            return {
                "kind": "struct_function_slot",
                "producer_address": f"0x{instruction.address:08x}",
                "base_register": load.group(3),
                "slot_offset": offset,
                "candidate_target_id": candidate,
                "target_id": None,
                "resolution": resolution,
                "alternatives": [candidate] if candidate else None,
            }

        write = REGISTER_WRITE_RE.match(text)
        if write and write.group(1) == register:
            break

    return {
        "kind": "register_function_pointer",
        "target_id": None,
        "resolution": "unclassified_register_pointer",
        "alternatives": None,
    }


def decompilation_failed(path: Path) -> bool:
    """Return whether an m2c artifact records an unsuccessful lift."""
    text = path.read_text(errors="replace")
    return (
        not text.strip()
        or "Decompilation failure" in text
        or "/* TIMEOUT */" in text
        or "Error" in text[:200]
    )


def scan_decompiled_function_sources(
    decomp_root: Path | None,
    recovered_decomp_root: Path | None = None,
) -> tuple[dict[tuple[str, int], list[str]], dict[str, int]]:
    result: dict[tuple[str, int], list[str]] = {}
    counts = {"attempted": 0, "successful": 0, "failed": 0}

    def add(path: Path, module: str, address: int) -> None:
        counts["attempted"] += 1
        if decompilation_failed(path):
            counts["failed"] += 1
            return
        counts["successful"] += 1
        key = (module, address)
        try:
            source = path.relative_to(Path.cwd()).as_posix()
        except ValueError:
            source = str(path)
        result.setdefault(key, []).append(source)

    if decomp_root is not None and decomp_root.exists():
        for path in sorted(decomp_root.glob("**/F0x*.c")):
            match = re.fullmatch(r"F0x([0-9a-fA-F]{8})\.c", path.name)
            if not match:
                continue
            parent = path.parent.name
            module = "exe/fns" if parent == "c" else f"pro/{parent.removesuffix('_c')}"
            add(path, module, int(match.group(1), 16))
    if recovered_decomp_root is not None and recovered_decomp_root.exists():
        for path in sorted(recovered_decomp_root.glob("pro/*/F0x*.c")):
            match = re.fullmatch(r"F0x([0-9a-fA-F]{8})\.c", path.name)
            if not match:
                continue
            module = path.parent.relative_to(recovered_decomp_root).as_posix()
            add(path, module, int(match.group(1), 16))
    return result, counts


def decompiled_function_sources(
    decomp_root: Path | None,
    recovered_decomp_root: Path | None = None,
) -> dict[tuple[str, int], list[str]]:
    """Compatibility wrapper returning only successful structural lifts."""
    return scan_decompiled_function_sources(decomp_root, recovered_decomp_root)[0]


def load_semantics_bundle(path: Path | None) -> dict[str, object]:
    if path is None or not path.exists():
        return {"functions": {}, "globals": {}, "families": {}, "blocks": {}}
    payload = json.loads(path.read_text())
    if payload.get("schema_version") != 1 or not isinstance(payload.get("functions"), dict):
        raise ValueError(f"invalid recovered semantics file: {path}")
    if not isinstance(payload.get("globals", {}), dict):
        raise ValueError(f"invalid recovered semantics globals: {path}")
    if not isinstance(payload.get("families", {}), dict):
        raise ValueError(f"invalid recovered semantics families: {path}")
    if not isinstance(payload.get("blocks", {}), dict):
        raise ValueError(f"invalid recovered semantics blocks: {path}")
    payload["blocks"] = payload.get("blocks", {})
    expanded = dict(payload["functions"])
    for family_id, family in payload.get("families", {}).items():
        if not isinstance(family, dict):
            raise ValueError(f"invalid recovered semantics family: {family_id}")
        template = family.get("template")
        members = family.get("members")
        if not isinstance(template, dict) or not isinstance(members, dict):
            raise ValueError(f"semantic family needs template and members: {family_id}")
        for function_id, name in members.items():
            if function_id in expanded:
                raise ValueError(f"duplicate semantic function annotation: {function_id}")
            if not isinstance(name, str) or not name:
                raise ValueError(f"invalid semantic family member name: {function_id}")
            expanded[function_id] = {
                "name": name,
                **template,
                "semantic_family": family_id,
            }
    payload["functions"] = expanded
    return payload


def _ddw3_source_label(path: Path) -> str:
    """'~/ddw3/<rel>' for a file in the data tree ($DDW3_DIR), wherever the tree lives."""
    root = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
    try:
        return "~/ddw3/" + path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def load_extracted_global_targets(path: Path | None) -> dict[str, dict[str, object]]:
    """Read function-pointer initializers from the extracted EXE data map."""
    if path is None or not path.exists():
        return {}
    source_hash = sha256_file(path)
    source = _ddw3_source_label(path)
    result: dict[str, dict[str, object]] = {}
    array_base: int | None = None
    array_base_symbol: str | None = None
    array_length = 0
    array_index = 0
    for line_number, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
        array = STATIC_FUNCTION_POINTER_ARRAY_RE.search(line)
        if array:
            array_base_symbol = array.group(1)
            array_base = int(array_base_symbol[3:], 16)
            array_length = int(array.group(2))
            array_index = 0
            continue
        if array_base is not None:
            tokens = sorted(
                [(match.start(), match.group(1)) for match in STATIC_POINTER_ITEM_RE.finditer(line)]
                + [(match.start(), None) for match in STATIC_NULL_POINTER_RE.finditer(line)]
            )
            for _, target in tokens:
                if target is not None and not target.startswith("D0x"):
                    cell_address = array_base + array_index * 4
                    resolved = target.startswith("F0x")
                    target_address = int(target[3:], 16) if resolved else None
                    result[f"D0x{cell_address:08x}"] = {
                        "target": (
                            canonical_id("exe/fns", target_address)
                            if target_address is not None else None
                        ),
                        "target_address": (
                            f"0x{target_address:08x}" if target_address is not None else None
                        ),
                        "target_symbol": target,
                        "resolution_basis": (
                            "extracted_static_initializer" if resolved
                            else "extracted_static_initializer_unresolved_symbol"
                        ),
                        "source": source,
                        "source_line": line_number,
                        "source_sha256": source_hash,
                        "authority": 4,
                        "array_base_symbol": array_base_symbol,
                        "array_index": array_index,
                    }
                array_index += 1
            if "]" in line:
                if array_index != array_length:
                    raise ValueError(
                        f"pointer array length mismatch at {array_base_symbol}: "
                        f"expected {array_length}, parsed {array_index}"
                    )
                array_base = None
                array_base_symbol = None
            continue
        match = STATIC_POINTER_SCALAR_RE.search(line)
        if not match:
            named = STATIC_NAMED_FN_POINTER_RE.search(line)
            if not named:
                continue
            declaration_name, raw_address, target_symbol = named.groups()
        else:
            declaration_name, raw_address, target_symbol = match.groups()
        symbol = f"D0x{int(raw_address, 16):08x}"
        resolved = target_symbol.startswith("F0x")
        target_address = int(target_symbol[3:], 16) if resolved else None
        result[symbol] = {
            "target": (
                canonical_id("exe/fns", target_address)
                if target_address is not None else None
            ),
            "target_address": (
                f"0x{target_address:08x}" if target_address is not None else None
            ),
            "target_symbol": target_symbol,
            "name": declaration_name if not declaration_name.startswith("D0x") else None,
            "resolution_basis": (
                "extracted_static_initializer" if resolved
                else "extracted_static_initializer_unresolved_symbol"
            ),
            "source": source,
            "source_line": line_number,
            "source_sha256": source_hash,
            "authority": 4,
        }
    return result


def load_extracted_overlay_pointer_candidates(
    root: Path | None,
    modules: dict[str, Module],
) -> list[dict[str, object]]:
    """Read address-shaped u32 cells from available extracted overlay data."""
    if root is None or not root.exists():
        return []
    result: list[dict[str, object]] = []
    for path in sorted(root.glob("dw2003_pro_*/src/data.rs")):
        overlay_name = path.parents[1].name.removeprefix("dw2003_pro_").lower()
        module_name = f"pro/{overlay_name}"
        module = modules.get(module_name)
        if module is None or module.base is None:
            continue
        source_hash = sha256_file(path)
        source = _ddw3_source_label(path)
        array_address: int | None = None
        array_name: str | None = None
        array_length = 0
        array_index = 0
        for line_number, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
            array = OVERLAY_U32_ARRAY_RE.search(line)
            if array:
                array_name = array.group(1)
                array_address = int(array.group(2), 16)
                array_length = int(array.group(3))
                array_index = 0
                continue
            if array_address is None:
                continue
            word = OVERLAY_U32_WORD_RE.match(line)
            if word:
                target_address = int(word.group(1), 16)
                offset_comment = OVERLAY_OFFSET_COMMENT_RE.search(line)
                cell_address = (
                    module.base + int(offset_comment.group(1), 16)
                    if offset_comment else array_address + array_index * 4
                )
                if target_address in module.address_lines:
                    result.append({
                        "owner_module": module_name,
                        "cell_address": cell_address,
                        "target_address": target_address,
                        "array_name": array_name,
                        "array_address": f"0x{array_address:08x}",
                        "array_index": array_index,
                        "array_length": array_length,
                        "source": source,
                        "source_line": line_number,
                        "source_sha256": source_hash,
                        "authority": 4,
                    })
                array_index += 1
            if "]" in line:
                # Some typed arrays omit per-word comments, so the declaration
                # address remains the fallback source for cell positions.
                if array_index != array_length:
                    raise ValueError(
                        f"overlay u32 array length mismatch at {path}:{line_number}: "
                        f"expected {array_length}, parsed {array_index}"
                    )
                array_address = None
                array_name = None
    return result


def load_function_extent_functions(path: Path | None) -> dict[str, list[int]]:
    """Starts the extents gate admitted, keyed by module id.

    The inventory's own discovery reads `F0x` labels, `jal` targets and the
    decompiled corpus. A `.section`+label that only a return or a data pointer
    backs (`InitHeap` and the 16-byte BIOS stubs at 0x8002507c, `DeliverEvent`,
    `CdIntToPos`, the overlay entry functions) is invisible to all three, which
    is why the 2026-09-12 full-offset PsyQ scan found 35 library starts the
    inventory did not hold. `build_function_extents.py` already derives and
    gates those entries at authority 2; union them here instead of re-deriving
    the gate. Cross-overlay projections are dropped exactly as `parse_module`
    drops them: a call is evidence that an entry exists, never of which overlay
    owns it.
    """
    if path is None or not path.exists():
        return {}
    payload = json.loads(path.read_text())
    result: dict[str, list[int]] = {}
    marker = "asm/dw2003/"
    for source, item in payload.get("sources", {}).items():
        if marker not in source or ";" in source or "~" in source or "{" in source:
            continue
        module = source.split(marker, 1)[1].removesuffix(".s")
        addresses = [int(entry["address"]) for entry in item.get("functions", [])]
        if addresses:
            result.setdefault(module, []).extend(addresses)
    return result


def load_psyq_match_starts(path: Path | None) -> list[int]:
    """Resident starts a PsyQ signature byte-matches, from `match_psyq.py`.

    The extents gate admits a `.section`+label, a jal target and a data
    pointer. A library routine reached only through an indirect call
    (`CD_vol`, `GetRCnt`, `CdIntToPos`) is none of those, so seven real library
    starts had no boundary in any source. The full-offset signature scan finds
    them by their bytes; the match is authority 2 evidence of the start, so the
    inventory unions it. The scan writes `recovered/ddw3/psyq-matches.json`
    without needing this inventory, so the pipeline order is: match_psyq ->
    build_recovered_inventory -> census.
    """
    if path is None or not path.exists():
        return []
    payload = json.loads(path.read_text())
    addresses: list[int] = []
    for match in payload.get("matches", []):
        addresses.append(int(match["address"], 16))
    for match in payload.get("new_starts", []):
        addresses.append(int(match["address"], 16))
    return sorted(set(addresses))


def load_function_extent_blocks(path: Path | None) -> dict[str, set[int]]:
    """Declared starts the extents gate refused, keyed by module id.

    `build_function_extents.py` admits a `.section`+label only when a call, an
    open frame, or a return backs it up, and now emits the addresses it refused
    under each source's `rejected` list. Those are blocks of a function -- the
    handler blocks reached through the table at D0x80010000 -- so the inventory
    carries the disposition instead of re-deriving the gate.
    """
    if path is None or not path.exists():
        return {}
    payload = json.loads(path.read_text())
    result: dict[str, set[int]] = {}
    for source, item in payload.get("sources", {}).items():
        marker = "asm/dw2003/"
        if marker not in source:
            continue
        module = source.split(marker, 1)[1].removesuffix(".s")
        addresses = {
            int(entry["address"])
            for entry in item.get("rejected", [])
            if isinstance(entry, dict) and "address" in entry
        }
        if addresses:
            result.setdefault(module, set()).update(addresses)
    return result


def build_inventory(
    asm_root: Path,
    decomp_root: Path | None = None,
    semantics_path: Path | None = None,
    exe_data_path: Path | None = None,
    overlay_data_root: Path | None = None,
    recovered_decomp_root: Path | None = None,
    function_extents_path: Path | None = None,
    psyq_matches_path: Path | None = None,
) -> dict[str, object]:
    modules = [parse_module(path, asm_root) for path in discover_sources(asm_root)]
    by_name = {module.name: module for module in modules}
    factory_callbacks: set[tuple[str, int]] = set()
    for module in modules:
        if module.base is None:
            continue
        for call, target in module.calls:
            if target not in (0x800143DC, 0x80014504):
                continue
            arguments = recover_call_arguments(module, call, KNOWN_CALL_ARITY[target])
            callback = arguments.get("a0")
            if not callback or callback["kind"] != "address":
                continue
            address = int(callback["value"], 16)
            if address not in module.address_lines:
                continue
            entry = module.entries.setdefault(
                address, Entry(address=address, line=module.address_lines[address]),
            )
            entry.origins.add("factory_callback")
            factory_callbacks.add((module.name, address))
    decompiled, decompilation_counts = scan_decompiled_function_sources(
        decomp_root, recovered_decomp_root,
    )
    for (module_name, address), sources in decompiled.items():
        module = by_name.get(module_name)
        if module is None:
            continue
        line = module.address_lines.get(address, 0)
        entry = module.entries.setdefault(address, Entry(address=address, line=line))
        entry.origins.add("decompiled_c")
    extent_functions = load_function_extent_functions(function_extents_path)
    assembly_section_added = 0
    for module_name, addresses in extent_functions.items():
        module = by_name.get(module_name)
        if module is None:
            continue
        module_end = max(module.address_lines) + 0x10 if module.address_lines else None
        for address in addresses:
            if module.base is not None and (
                module_end is None or not (module.base <= address < module_end)
            ):
                continue
            if address not in module.entries:
                assembly_section_added += 1
            entry = module.entries.setdefault(
                address,
                Entry(address=address, line=module.address_lines.get(address, 0)),
            )
            entry.origins.add("assembly_section")
    psyq_added = 0
    resident = by_name.get("exe/fns")
    if resident is not None:
        for address in load_psyq_match_starts(psyq_matches_path):
            if address not in resident.entries:
                psyq_added += 1
            entry = resident.entries.setdefault(
                address,
                Entry(address=address, line=resident.address_lines.get(address, 0)),
            )
            entry.origins.add("psyq_signature")
    semantics_bundle = load_semantics_bundle(semantics_path)
    semantics = semantics_bundle["functions"]
    semantic_families = semantics_bundle.get("families", {})
    curated_blocks = semantics_bundle.get("blocks", {})
    extent_blocks = load_function_extent_blocks(function_extents_path)
    curated_global_targets = semantics_bundle.get("globals", {})
    extracted_global_targets = load_extracted_global_targets(exe_data_path)
    global_targets = dict(extracted_global_targets)
    for symbol, annotation in curated_global_targets.items():
        extracted = global_targets.get(symbol)
        if (
            extracted and extracted.get("target") is not None
            and extracted["target"] != annotation.get("target")
        ):
            raise ValueError(f"curated and extracted global targets disagree: {symbol}")
        global_targets[symbol] = {
            **(extracted or {}),
            **annotation,
            "resolution_basis": (
                "extracted_static_initializer_and_curated_semantics"
                if extracted else "curated_semantics"
            ),
        }
    preliminary_exe = by_name.get("exe/fns")
    preliminary_exe_entries = preliminary_exe.entries if preliminary_exe else {}
    called_cells_by_module: dict[str, set[int]] = {}
    all_called_cells: set[int] = set()
    for module in modules:
        preliminary_starts = sorted(module.entries)
        for instruction, register in module.indirect_calls:
            edge = recover_indirect_call(
                module, instruction, register, preliminary_exe_entries, {},
                global_targets,
                function_start=nearest_entry(preliminary_starts, instruction.address),
            )
            raw_address = edge.get("global_address")
            if raw_address is None:
                continue
            cell_address = int(raw_address, 16)
            called_cells_by_module.setdefault(module.name, set()).add(cell_address)
            all_called_cells.add(cell_address)

    overlay_pointer_candidates = load_extracted_overlay_pointer_candidates(
        overlay_data_root, by_name,
    )
    owners_by_cell: dict[int, set[str]] = {}
    for candidate in overlay_pointer_candidates:
        owners_by_cell.setdefault(candidate["cell_address"], set()).add(
            candidate["owner_module"],
        )
    overlay_global_targets: dict[str, list[dict[str, object]]] = {}
    promoted_overlay_pointer_targets: set[tuple[str, int]] = set()
    for candidate in overlay_pointer_candidates:
        owner = candidate["owner_module"]
        cell_address = candidate["cell_address"]
        owner_calls = called_cells_by_module.get(owner, set())
        if cell_address not in owner_calls and not (
            cell_address in all_called_cells and len(owners_by_cell[cell_address]) == 1
        ):
            continue
        module = by_name[owner]
        target_address = candidate["target_address"]
        entry = module.entries.setdefault(
            target_address,
            Entry(address=target_address, line=module.address_lines[target_address]),
        )
        entry.origins.add("extracted_called_function_pointer")
        promoted_overlay_pointer_targets.add((owner, target_address))
        symbol = f"D0x{cell_address:08x}"
        overlay_global_targets.setdefault(symbol, []).append({
            **candidate,
            "target": canonical_id(owner, target_address),
            "target_address": f"0x{target_address:08x}",
            "resolution_basis": "extracted_overlay_static_initializer",
        })
    semantic_id_re = re.compile(r"^(.+):F0x([0-9a-fA-F]{8})$")
    for function_id in semantics:
        match = semantic_id_re.fullmatch(function_id)
        if not match or match.group(1) not in by_name:
            raise ValueError(f"semantic annotation has unknown function id: {function_id}")
        module = by_name[match.group(1)]
        address = int(match.group(2), 16)
        line = module.address_lines.get(address, 0)
        entry = module.entries.setdefault(address, Entry(address=address, line=line))
        entry.origins.add("curated_semantics")
    for block_id in curated_blocks:
        match = semantic_id_re.fullmatch(block_id)
        if not match or match.group(1) not in by_name:
            raise ValueError(f"curated block has unknown function id: {block_id}")
        if int(match.group(2), 16) not in by_name[match.group(1)].entries:
            raise ValueError(f"curated block has no inventory entry: {block_id}")
    rejected_entries = reject_phantom_entries(modules)
    rejected_entries += reject_data_label_entries(modules)
    rejected_entries.sort(key=lambda item: (item["module"], item["address"]))
    exe = by_name.get("exe/fns")
    exe_entries = exe.entries if exe else {}
    address_candidates: dict[int, list[str]] = {}
    for module in modules:
        for address in module.entries:
            address_candidates.setdefault(address, []).append(canonical_id(module.name, address))
    established_ids = {
        function_id
        for candidates in address_candidates.values()
        for function_id in candidates
    }
    for symbol, annotation in global_targets.items():
        if not re.fullmatch(r"D0x[0-9a-fA-F]{8}", symbol):
            raise ValueError(f"invalid semantic global id: {symbol}")
        if not isinstance(annotation, dict):
            raise ValueError(f"invalid semantic global: {symbol}")
        if annotation.get("target") is not None and annotation.get("target") not in established_ids:
            raise ValueError(f"semantic global has unknown target: {symbol}")

    result_modules: list[dict[str, object]] = []
    totals = {
        "modules": len(modules),
        "original_functions": 0,
        "labeled_functions": 0,
        "overlay_discovered_functions": 0,
        "rejected_phantom_entries": len(rejected_entries),
        "pointer_candidates": 0,
        "direct_calls": 0,
        "resolved_direct_calls": 0,
        "ambiguous_direct_calls": 0,
        "unresolved_direct_calls": 0,
        "unattributed_direct_calls": 0,
        "indirect_calls": 0,
        "resolved_indirect_calls": 0,
        "candidate_shared_object_method_calls": 0,
        "global_pointer_calls": 0,
        "resolved_global_pointer_calls": 0,
        "unclassified_indirect_calls": 0,
        "unattributed_indirect_calls": 0,
        "functions_with_decompiled_c": 0,
        "decompilation_attempt_files": decompilation_counts["attempted"],
        "decompiled_c_files": decompilation_counts["successful"],
        "failed_decompilation_files": decompilation_counts["failed"],
        "semantic_annotations": len(semantics),
        "semantic_families": len(semantic_families),
        "block_functions": 0,
        "curated_blocks": len(curated_blocks),
        "extent_block_functions": 0,
        "factory_callbacks": len(factory_callbacks),
        "assembly_section_added": assembly_section_added,
        "assembly_section_functions": 0,
        "psyq_signature_functions_added": psyq_added,
        "known_global_function_pointers": len(global_targets),
        "extracted_static_global_function_pointers": len(extracted_global_targets),
        "curated_global_function_pointers": len(curated_global_targets),
        "extracted_overlay_function_pointer_cells": sum(
            len(items) for items in overlay_global_targets.values()
        ),
        "promoted_overlay_function_pointer_targets": len(promoted_overlay_pointer_targets),
    }

    for module in modules:
        starts = sorted(module.entries)
        instructions_by_address = {item.address: item for item in module.instructions}
        module_functions: list[dict[str, object]] = []
        module_blocks = 0
        calls_by_caller: dict[int, list[dict[str, object]]] = {address: [] for address in starts}
        indirect_by_caller: dict[int, list[dict[str, object]]] = {address: [] for address in starts}
        unattributed_calls: list[dict[str, object]] = []
        unattributed_indirect_calls: list[dict[str, object]] = []

        for instruction, target in module.calls:
            caller = nearest_entry(starts, instruction.address)
            argument_count = KNOWN_CALL_ARITY.get(target)
            arguments = (
                recover_call_arguments(module, instruction, argument_count)
                if argument_count is not None else {}
            )
            resolution, target_id, alternatives = resolve_address_target(
                module, target, exe_entries, address_candidates,
            )

            edge = {
                "callsite": f"0x{instruction.address:08x}",
                "source_line": instruction.line,
                "target_address": f"0x{target:08x}",
                "target_id": target_id,
                "resolution": resolution,
                "alternatives": alternatives or None,
                "caller_attribution": (
                    "exact_labeled_boundary" if module.base is None
                    else "provisional_nearest_discovered_entry"
                ),
                "arguments": arguments,
            }
            if caller is not None:
                calls_by_caller[caller].append(edge)
            else:
                unattributed_calls.append(edge)
                totals["unattributed_direct_calls"] += 1
            totals["direct_calls"] += 1
            if target_id:
                totals["resolved_direct_calls"] += 1
            elif alternatives:
                totals["ambiguous_direct_calls"] += 1
            else:
                totals["unresolved_direct_calls"] += 1

        for instruction, register in module.indirect_calls:
            caller = nearest_entry(starts, instruction.address)
            recovered = recover_indirect_call(
                module, instruction, register, exe_entries, address_candidates,
                global_targets, overlay_global_targets,
                function_start=caller,
            )
            edge = {
                "callsite": f"0x{instruction.address:08x}",
                "source_line": instruction.line,
                "target_register": register,
                "caller_attribution": (
                    "exact_labeled_boundary" if module.base is None
                    else "provisional_nearest_discovered_entry"
                ),
                **recovered,
            }
            if caller is not None:
                indirect_by_caller[caller].append(edge)
            else:
                unattributed_indirect_calls.append(edge)
                totals["unattributed_indirect_calls"] += 1
            totals["indirect_calls"] += 1
            if edge["target_id"]:
                totals["resolved_indirect_calls"] += 1
            if edge["resolution"] == "candidate_shared_object_method":
                totals["candidate_shared_object_method_calls"] += 1
            if edge["kind"] == "global_function_pointer":
                totals["global_pointer_calls"] += 1
                if edge["target_id"]:
                    totals["resolved_global_pointer_calls"] += 1
            if edge["resolution"] == "unclassified_register_pointer":
                totals["unclassified_indirect_calls"] += 1

        for index, address in enumerate(starts):
            entry = module.entries[address]
            next_address = starts[index + 1] if index + 1 < len(starts) else None
            end_address = next_address - 4 if next_address is not None else (
                max(instructions_by_address) if instructions_by_address else address
            )
            origins = sorted(entry.origins)
            is_labeled = "original_label" in origins
            decompiled_sources = decompiled.get((module.name, address), [])
            function_id = canonical_id(module.name, address)
            annotation = semantics.get(function_id)
            curated = curated_blocks.get(function_id)
            if curated is not None:
                block = {
                    "reason": curated.get("reason", ""),
                    "parent": curated.get("parent"),
                    "source": "curated_semantics",
                }
            elif address in extent_blocks.get(module.name, ()):
                block = {
                    "reason": "declared_section_without_call_return_or_frame",
                    "parent": None,
                    "source": "function_extents_gate",
                }
            else:
                block = None
            recovery = annotation["recovery"] if annotation else {
                "lift": (
                    "decompiled_c_present" if decompiled_sources
                    else "assembly_inventoried"
                ),
                "structure": "unknown",
                "semantics": "unknown",
                "verification": "unresearched",
                "implementation": "unknown",
            }
            module_functions.append({
                "id": function_id,
                "original_name": f"F0x{address:08x}",
                "address": f"0x{address:08x}",
                "file_offset": (
                    f"0x{address - module.base:08x}" if module.base is not None else None
                ),
                "source_line": entry.line,
                "provisional_end_address": f"0x{end_address:08x}",
                "boundary_status": (
                    "labeled" if is_labeled else "provisional_discovered_entries"
                ),
                "entry_evidence": origins,
                "decompiled_sources": decompiled_sources,
                "direct_calls": calls_by_caller[address],
                "indirect_calls": indirect_by_caller[address],
                "semantic_name": annotation["name"] if annotation else None,
                "semantic_subsystem": annotation["subsystem"] if annotation else None,
                "semantic_family": annotation.get("semantic_family") if annotation else None,
                "role": "block" if block else "function",
                "block": block,
                "recovery": recovery,
            })
            totals["original_functions"] += 1
            if "assembly_section" in origins:
                totals["assembly_section_functions"] += 1
            if block:
                module_blocks += 1
                totals["block_functions"] += 1
                if block["source"] == "function_extents_gate":
                    totals["extent_block_functions"] += 1
            if is_labeled:
                totals["labeled_functions"] += 1
            else:
                totals["overlay_discovered_functions"] += 1
            if decompiled_sources:
                totals["functions_with_decompiled_c"] += 1

        candidates = [{
            "id": f"{module.name}:C0x{address:08x}",
            "address": f"0x{address:08x}",
            "file_offset": f"0x{address - module.base:08x}" if module.base is not None else None,
            "pointer_source_lines": lines,
            "status": "candidate_callable_or_jump_target",
            "decisive_evidence": "Find a call/allocator/vtable consumer or recover the containing dispatch table.",
        } for address, lines in sorted(module.pointer_candidates.items())
          if address not in module.entries]
        totals["pointer_candidates"] += len(candidates)

        result_modules.append({
            "id": module.name,
            "source": module.source,
            "source_sha256": module.sha256,
            "load_base": f"0x{module.base:08x}" if module.base is not None else None,
            "function_count": len(module_functions),
            "block_count": module_blocks,
            "pointer_candidate_count": len(candidates),
            "functions": module_functions,
            "pointer_candidates": candidates,
            "unattributed_direct_calls": unattributed_calls,
            "unattributed_indirect_calls": unattributed_indirect_calls,
        })

    return {
        "schema_version": 1,
        "authority": 2,
        "scope": "original DDW3 executable fns.s and pro overlays",
        "method": {
            "resident_functions": "Original F0x labels in exe/fns.s.",
            "overlay_functions": "Overlay code entry plus same-overlay direct jal targets.",
            "pointer_candidates": "Aligned words into an overlay's code range; retained separately because jump-table labels are indistinguishable from callable pointers by shape alone.",
            "boundaries": "Resident labeled boundaries are authoritative; overlay ends and caller ownership are provisional nearest-entry partitions.",
            "indirect_calls": "jalr targets are classified from the nearest local register producer; shared-slot matches remain candidates until receiver type is independently established.",
            "rejected_entries": "An entry established only by the existence of an m2c file, whose preceding instruction stream falls through into it, is a shared label rather than a function and is removed. An entry established only by an m2c file or by the overlay-entry fallback, whose decoded instruction run never transfers control, is a data label and is removed.",
        },
        "summary": totals,
        "rejected_entries": rejected_entries,
        "global_function_pointers": dict(sorted(global_targets.items())),
        "overlay_function_pointers": {
            symbol: items for symbol, items in sorted(overlay_global_targets.items())
        },
        "modules": result_modules,
    }


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--asm-root", type=Path,
        default=Path.home() / "ddw3/asm/dw2003",
    )
    parser.add_argument(
        "--output", type=Path,
        default=Path("recovered/ddw3/function-inventory.json"),
    )
    parser.add_argument(
        "--decomp-root", type=Path,
        default=Path("exe-decomp"),
    )
    parser.add_argument(
        "--semantics", type=Path,
        default=Path("recovered/ddw3/semantics.json"),
    )
    parser.add_argument(
        "--exe-data", type=Path,
        default=Path.home() / "ddw3/rust/dw2003_exe_data/src/data.rs",
    )
    parser.add_argument(
        "--overlay-data-root", type=Path,
        default=Path.home() / "ddw3/rust",
    )
    parser.add_argument(
        "--recovered-decomp-root", type=Path,
        default=Path("recovered/ddw3/decomp"),
    )
    parser.add_argument(
        "--function-extents", type=Path,
        default=Path("docs/generated/function-extents.json"),
    )
    parser.add_argument(
        "--psyq-matches", type=Path,
        default=Path("recovered/ddw3/psyq-matches.json"),
    )
    args = parser.parse_args()
    inventory = build_inventory(
        args.asm_root.resolve(), args.decomp_root.resolve(), args.semantics.resolve(),
        args.exe_data.resolve(), args.overlay_data_root.resolve(),
        args.recovered_decomp_root.resolve(), args.function_extents.resolve(),
        args.psyq_matches.resolve(),
    )
    write_json(args.output, inventory)
    summary = inventory["summary"]
    print(
        f"modules={summary['modules']} functions={summary['original_functions']} "
        f"blocks={summary['block_functions']} "
        f"calls={summary['direct_calls']} resolved={summary['resolved_direct_calls']} "
        f"indirect={summary['indirect_calls']} indirect_resolved={summary['resolved_indirect_calls']} "
        f"candidates={summary['pointer_candidates']} output={args.output}"
    )


if __name__ == "__main__":
    main()
