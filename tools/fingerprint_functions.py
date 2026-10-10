#!/usr/bin/env python3
"""Deterministic per-function fingerprints for the original assembly corpus.

No model, no network, no tokens. Runs in seconds over all 2,514 known functions
and can run every minute for years at zero cost. Design:
docs/superpowers/specs/2026-08-09-function-fingerprinting-design.md

The point is to spend model reasoning only on what a script cannot settle. On
2026-08-09 the mechanical passes -- dispatch-table harvest, control-flow walk,
argument extraction, function extents -- did most of the real decoding work, and
a mechanical coverage check falsified a claim the author's own reasoning had
passed. So: derive everything derivable here, and hand the residue on.

**Known limitation, found by the model in the 2026-08-09 trial.** `reads` and
`writes` name the base register AS WRITTEN, so an entry like `+0xEAC(a0)` is wrong
whenever that register was reassigned earlier in the function -- in F0x800894E4 it
is really the view object. Treat field attributions as hints, not facts; the
offset is reliable, the object it belongs to is not.

**The boundary this file must not cross.** It emits FACTS -- who calls whom with
which constants, which struct offsets are touched, what a table contains, what
control shape a function has. It does NOT emit meaning: that an offset "is the
hand", that a shape "is a targeting prompt". Shape implies structure, never
semantics. Interpretation is a separate, gated step.

Usage:
  .venv/bin/python3 tools/fingerprint_functions.py                 # build + queue
  .venv/bin/python3 tools/fingerprint_functions.py --overlay cardgame --report
  .venv/bin/python3 tools/fingerprint_functions.py --function 0x8008ec44
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / ".dw3-research/index.sqlite3"
EXTENTS = ROOT / "docs/generated/function-extents.json"
LEDGER = ROOT / "docs/research/evidence/ledger.json"
OUT = ROOT / "docs/generated/function-fingerprints.json"

ADDRESS = re.compile(r"0x(8[0-9a-fA-F]{7})(?![0-9a-fA-F])")
RAM_LOW, RAM_HIGH = 0x80000000, 0x80800000

# Instruction shapes. The corpus renders calls three ways (`jal 0x…`,
# `jal NAME_F0x…`, `jal .L0x…`) -- matching only the numeric form under-counted
# one overlay by a factor of four when the extents tool made that mistake.
CALL = re.compile(r"\bjal\s+(?:\S*?(?:F0x|\.L0x)|0x)([0-9a-fA-F]{6,8})(?![0-9a-fA-F])")
INDIRECT = re.compile(r"\bjalr\b")
MEMORY = re.compile(
    r"\b(lw|lh|lhu|lb|lbu|sw|sh|sb)\s+\$(\w+),\s*(-?(?:0x)?[0-9a-fA-F]*)\(\$(\w+)\)")
LUI = re.compile(r"\blui\s+\$(\w+),\s*0x([0-9a-fA-F]+)")
ADDIU = re.compile(r"\b(?:addiu|ori)\s+\$(\w+),\s*(?:\$(\w+),\s*)?(-?0x[0-9a-fA-F]+|-?\d+)")
IMMEDIATE = re.compile(r"\b(?:addiu|li|ori)\s+\$(\w+),\s*(?:\$zero,\s*)?(-?0x[0-9a-fA-F]+|-?\d+)")
# `andi` is deliberately its own pattern: it is not an immediate LOAD, and folding
# it into IMMEDIATE (which lists addiu/li/ori) meant the mask set was empty for
# every function in the corpus until a unit test caught it.
MASK = re.compile(r"\band(?:i)?\s+\$\w+,\s*(?:\$\w+,\s*)?(-?0x[0-9a-fA-F]+|\d+)")
MOVE = re.compile(r"\bmove_?\s+\$(\w+),\s*\$(\w+)")
BRANCH = re.compile(r"\b(beq|bne|beqz|bnez|blez|bgez|bgtz|bltz|b)\w*\s+.*?(?:0x|\.L0x)([0-9a-fA-F]+)")
ANDI = re.compile(r"\band(?:i)?\b")
JUMP_REGISTER = re.compile(r"\bjr\s+\$(?!ra\b)\w+")
RETURN = re.compile(r"\bjr\s+\$ra\b")
ARG_REGISTERS = ("a0", "a1", "a2", "a3")

# The shared pad service. Formed as lui 0x8005 / addiu -0x4830 across three
# different card prompts, which is why it is recognised structurally rather than
# by name -- it never appears as a symbol.
PAD_SERVICE = 0x8004B7D0


LABEL_PREFIX = re.compile(r"^\s*\.L0x[0-9a-fA-F]+:\s*")
TRAILING_COMMENT = re.compile(r"\s*#.*$")


def instruction(text: str) -> str:
    """Just the instruction: no `.L0x…:` label, no trailing `# .word` encoding.

    Every assembly line here carries both. Matching mnemonics against the raw line
    silently failed for anything anchored at position 0 -- mask collection never
    fired once across the whole corpus until a unit test caught it -- and the
    trailing comment repeats the encoding, which can be mistaken for operands.
    """
    return TRAILING_COMMENT.sub("", LABEL_PREFIX.sub("", text)).strip()


def parse_immediate(text: str) -> int | None:
    try:
        return int(text, 16) if text.lower().startswith(("0x", "-0x")) else int(text, 10)
    except (TypeError, ValueError):
        return None


def constants_before(lines: dict[int, str], site: int, window: int = 10) -> dict[str, int]:
    """Resolve $a0..$a3 at a call site by walking backwards, lui/addiu aware.

    The delay slot AFTER the call counts: MIPS executes it before the branch is
    taken, and card-effect dispatch blocks routinely put the discriminating
    argument there. Missing that reported opcode 0x7E's mask as 0xF when the
    `lui` makes it 0x000F0000.
    """
    resolved: dict[str, int] = {}
    pending: dict[str, int] = {}
    for offset in range(-window, 2):
        text = lines.get(site + offset * 4)
        if text is None or offset == 0:
            continue
        found = LUI.search(text)
        if found:
            pending[found.group(1)] = int(found.group(2), 16) << 16
            if found.group(1) in ARG_REGISTERS:
                resolved[found.group(1)] = pending[found.group(1)]
            continue
        found = ADDIU.search(text)
        if found and (found.group(2) or found.group(1)) in pending:
            value = parse_immediate(found.group(3))
            if value is not None:
                combined = (pending[found.group(2) or found.group(1)] + value) & 0xFFFFFFFF
                pending[found.group(1)] = combined
                if found.group(1) in ARG_REGISTERS:
                    resolved[found.group(1)] = combined
            continue
        found = IMMEDIATE.search(text)
        if found and found.group(1) in ARG_REGISTERS:
            value = parse_immediate(found.group(2))
            if value is not None:
                resolved[found.group(1)] = value
            continue
        found = MOVE.search(text)
        if found and found.group(1) in ARG_REGISTERS and found.group(2) == "zero":
            resolved[found.group(1)] = 0
    return resolved


def fingerprint(lines: dict[int, str], start: int, end: int, base: int = 0) -> dict:
    """Structural facts for one function. Never semantics."""
    body = {address: text for address, text in lines.items() if start <= address < end}
    calls: list[dict] = []
    indirect = 0
    reads: set[str] = set()
    writes: set[str] = set()
    constructed: set[int] = set()
    pending_lui: dict[str, int] = {}
    backward_branch = False
    dispatch = False
    masks: set[int] = set()
    touches_pad = False
    equality_tests = 0

    for address in sorted(body):
        text = instruction(body[address])
        found = CALL.search(text)
        if found:
            target = int(found.group(1), 16)
            calls.append({"target": target, "site": address,
                          "args": constants_before(body, address)})
        if INDIRECT.search(text):
            indirect += 1
        found = MEMORY.search(text)
        if found:
            kind, _, offset, base_register = found.groups()
            value = parse_immediate(offset) if offset else 0
            field = f"+0x{(value or 0):X}({base_register})"
            (writes if kind.startswith("s") else reads).add(field)
        found = LUI.search(text)
        if found:
            pending_lui[found.group(1)] = int(found.group(2), 16) << 16
        found = ADDIU.search(text)
        if found and (found.group(2) or found.group(1)) in pending_lui:
            value = parse_immediate(found.group(3))
            if value is not None:
                combined = (pending_lui[found.group(2) or found.group(1)] + value) & 0xFFFFFFFF
                if RAM_LOW <= combined < RAM_HIGH:
                    constructed.add(combined)
                if combined == PAD_SERVICE:
                    touches_pad = True
        if text.split(" ")[0] in ("and", "andi"):
            found = MASK.search(text)
            if found:
                value = parse_immediate(found.group(1))
                if value:
                    masks.add(value)
        if re.match(r"(beq|bne)\s+\$\w+,\s*\$\w+", text):
            equality_tests += 1
        found = BRANCH.search(text)
        if found:
            try:
                target = int(found.group(2), 16)
            except ValueError:
                target = None
            if target is not None:
                # Overlays differ: pro/cardgame labels its lines by FILE OFFSET while
                # pro/fightstg labels them by RAM address. A branch target read from
                # the text is therefore an offset in the first case, and comparing it
                # against a RAM address made every cardgame loop invisible -- which is
                # why the sweep at F0x8008EC44 first classified as unclassified.
                if target < RAM_LOW:
                    target += base
                if start <= target <= address:
                    backward_branch = True
        if JUMP_REGISTER.search(text) and not RETURN.search(text):
            dispatch = True

    if PAD_SERVICE in constructed:
        touches_pad = True
    return {
        "address": start, "end": end, "size": end - start,
        "instructions": len(body),
        "calls": calls,
        "callees": sorted({call["target"] for call in calls}),
        "indirect_calls": indirect,
        "reads": sorted(reads), "writes": sorted(writes),
        "constructed_addresses": sorted(constructed),
        "masks": sorted(masks),
        "has_loop": backward_branch,
        "equality_tests": equality_tests,
        "has_register_dispatch": dispatch,
        "touches_pad_service": touches_pad,
        "returns": any(RETURN.search(text) for text in body.values()),
    }


def classify(item: dict) -> list[str]:
    """Ordered structural rules. A function may match more than one shape.

    Every rule tests structure the fingerprint already proved. None assigns
    meaning: `prompt_confirm` says "references the pad service and branches on a
    small constant", never "asks the player to confirm".
    """
    shapes: list[str] = []
    # Stack traffic is not state access. Saving $ra at 0x10($sp) and restoring it
    # reads and writes "the same field", which made every ordinary wrapper look
    # like a PC branch -- the unbiased trial sampled one (0x800A5F6C) and the
    # classifier called it branch_pc when it is a two-constant thunk.
    reads = {f for f in item["reads"] if not f.endswith("(sp)")}
    writes = {f for f in item["writes"] if not f.endswith("(sp)")}
    both = reads & writes

    if item["touches_pad_service"]:
        shapes.append("prompt_confirm")
    # A compiled switch is either a register dispatch through a jump table, or a
    # chain of equality tests against small constants. F0x80089580 is the second
    # kind, and looking only for the first missed it.
    if item["has_register_dispatch"] or item["equality_tests"] >= 3:
        shapes.append("step_machine")
    if item["has_loop"] and (item["masks"] or item["equality_tests"]) and writes:
        shapes.append("masked_sweep")
    if both and not item["has_loop"] and len(both) == 1 \
            and item["instructions"] <= 24 and not item["calls"] \
            and item["indirect_calls"] == 0:
        shapes.append("branch_pc")
    if item["indirect_calls"] >= 2 and item["constructed_addresses"]:
        shapes.append("table_index_call")
    if len(item["calls"]) == 1 and item["instructions"] <= 20 and not item["has_loop"]:
        shapes.append("poll_complete")
    # Presentation setup: drive several object methods and write several fields,
    # with no table of its own. F0x8008CA4C is the archetype -- six view calls and
    # a batch of field writes -- and it fell through every other rule, which is how
    # this shape was found rather than assumed.
    if item["indirect_calls"] >= 3 and len(item["writes"]) >= 3 \
            and not item["constructed_addresses"]:
        shapes.append("view_batch")
    if not shapes:
        shapes.append("unclassified")
    return shapes


def source_base(source: dict[int, str]) -> int:
    """RAM address of label offset zero, so label-relative branch targets convert.

    Derived from any line: the locator gives its RAM address and the text gives its
    own label. For overlays whose labels are already absolute this yields 0, which
    makes the conversion a no-op.
    """
    for address, text in source.items():
        found = re.match(r"\.L0x([0-9a-fA-F]{8}):", text.strip())
        if found:
            return address - int(found.group(1), 16)
    return 0


def load_lines(conn: sqlite3.Connection) -> dict[str, dict[int, str]]:
    lines: dict[str, dict[int, str]] = collections.defaultdict(dict)
    for row in conn.execute(
        "SELECT source_path, locator, exact FROM evidence WHERE source_path LIKE '%.s'"):
        found = ADDRESS.search(row["locator"] or "")
        if not found:
            continue
        address = int(found.group(1), 16)
        if RAM_LOW <= address < RAM_HIGH:
            lines[row["source_path"]][address] = row["exact"] or ""
    return lines


def decoded_addresses(ledger: dict) -> set[int]:
    """Addresses with a live claim anchored on them, so decoded work is not requeued."""
    live = {"candidate", "partially_verified", "verified"}
    wanted = {
        eid for claim in ledger.get("claims", [])
        if claim.get("status") in live for eid in claim.get("evidence", [])
    }
    found: set[int] = set()
    for item in ledger.get("evidence", []):
        if item["id"] not in wanted:
            continue
        for hit in ADDRESS.findall(str(item.get("locator", ""))):
            found.add(int(hit, 16))
    return found


def build(conn: sqlite3.Connection, ledger: dict, overlay: str | None) -> dict:
    extents = json.loads(EXTENTS.read_text())["sources"]
    lines = load_lines(conn)
    anchored = decoded_addresses(ledger)
    callers: collections.Counter = collections.Counter()
    result: dict[str, list] = {}

    for path, item in extents.items():
        if overlay and not path.endswith(f"{overlay}.s"):
            continue
        source = lines.get(path, {})
        base = source_base(source)
        entries = []
        for function in item["functions"]:
            print_item = fingerprint(source, function["address"], function["end"], base)
            print_item["shapes"] = classify(print_item)
            print_item["overlay"] = path.split("/")[-1][:-2]
            print_item["source"] = path
            # The symbol the assembly names, where the extents recovered one.
            # Carried through untouched so the decoder can report a named
            # library stub as named rather than as an undecodable error.
            if function.get("name"):
                print_item["name"] = function["name"]
            print_item["anchored_claims"] = any(
                function["address"] <= address < function["end"] for address in anchored
            )
            for call in print_item["calls"]:
                callers[(path, call["target"])] += 1
            entries.append(print_item)
        result[path] = entries

    for path, entries in result.items():
        for entry in entries:
            entry["callers"] = callers.get((path, entry["address"]), 0)
    return result


def queue(result: dict) -> list[dict]:
    """Undecoded functions, highest yield first, with routine work marked routine."""
    decoded_shapes: collections.Counter = collections.Counter()
    for entries in result.values():
        for entry in entries:
            if entry["anchored_claims"]:
                for shape in entry["shapes"]:
                    decoded_shapes[shape] += 1
    rows = []
    for entries in result.values():
        for entry in entries:
            if entry["anchored_claims"]:
                continue
            routine = all(decoded_shapes.get(shape, 0) > 0 for shape in entry["shapes"]) \
                and "unclassified" not in entry["shapes"]
            rows.append({
                "address": entry["address"], "overlay": entry["overlay"],
                "shapes": entry["shapes"], "callers": entry["callers"],
                "size": entry["size"], "routine": routine,
                "precedent": min((decoded_shapes.get(s, 0) for s in entry["shapes"]),
                                 default=0),
            })
    rows.sort(key=lambda row: (-row["callers"], row["routine"], -row["size"]))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--overlay")
    parser.add_argument("--function")
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--limit", type=int, default=25)
    args = parser.parse_args()

    conn = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        ledger = json.loads(LEDGER.read_text())
        result = build(conn, ledger, args.overlay)
    finally:
        conn.close()

    everything = [entry for entries in result.values() for entry in entries]
    if args.function:
        wanted = int(args.function, 16)
        for entry in everything:
            if entry["address"] == wanted:
                print(json.dumps(entry, indent=1))
        return 0

    shapes: collections.Counter = collections.Counter()
    for entry in everything:
        for shape in entry["shapes"]:
            shapes[shape] += 1
    pending = queue(result)
    print(f"functions={len(everything)} decoded={sum(1 for e in everything if e['anchored_claims'])} "
          f"queued={len(pending)}")
    print("shapes: " + ", ".join(f"{name}={count}" for name, count in shapes.most_common()))
    routine = sum(1 for row in pending if row["routine"])
    print(f"queued and matching an already-decoded shape (routine): {routine} "
          f"({100 * routine / len(pending):.0f}%)" if pending else "queue empty")

    if args.report:
        print("\nhighest-yield undecoded functions:")
        for row in pending[:args.limit]:
            print(f"  0x{row['address']:08x} {row['overlay']:<12} callers={row['callers']:3} "
                  f"size={row['size']:5} {'routine' if row['routine'] else 'NOVEL  '} "
                  f"{','.join(row['shapes'])}")

    if not args.overlay:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(
            {"_provenance": {
                "generated_by": "tools/fingerprint_functions.py",
                "authority": 2,
                "contains": "structural facts only: call graph with resolved argument "
                            "constants, struct offsets touched, constructed addresses, "
                            "control-shape classification. NO semantics -- a shape says "
                            "how a function is built, never what it means.",
            }, "functions": result, "queue": pending}, indent=1, sort_keys=True))
        print(f"\nwrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
