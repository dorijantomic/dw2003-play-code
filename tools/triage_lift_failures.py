#!/usr/bin/env python3
"""Triage DDW3 decompilation lift outcomes by mechanical cause.

The recovered inventory reports aggregate counts (`failed_decompilation_files`,
bodies present vs. mechanically complete).  Those counts say how much lift is
missing but not *why*, so they cannot be worked.  This tool classifies every m2c
artifact under the attempt roots into an actionable cause bucket and reports the
buckets ordered by size.

This is a mechanical classification of generated artifacts.  It is not a
semantic claim about original behavior, and a bucket label is a hypothesis about
the *lifter*, never about the game.

Usage:
    python3 tools/triage_lift_failures.py summary
    python3 tools/triage_lift_failures.py list --cause branch_target --limit 20
    python3 tools/triage_lift_failures.py show pro/cardgame:F0x80091e60
"""

from __future__ import annotations

import argparse
import collections
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ATTEMPT_ROOTS = (ROOT / "exe-decomp", ROOT / "recovered/ddw3/decomp")

NAME_RE = re.compile(r"F0x([0-9a-fA-F]{8})\.c")

MIPS2C_ERR_RE = re.compile(r"(?m)^\s*(?:/\*|//)?\s*(Error|Decompilation failure)[^\n]*")
# m2c writes "Decompilation failure in function F0x...:" as a header and puts the
# actual reason on a following non-empty line.  The header alone is not a cause.
FAILURE_HEADER_RE = re.compile(
    r"(?m)^\s*Decompilation failure in function [^\n]*:\s*$"
)


def module_for(path: Path) -> str:
    parent = path.parent.name
    if parent == "c":
        return "exe/fns"
    return f"pro/{parent.removesuffix('_c')}"


def iter_attempts(roots=None):
    for root in roots or ATTEMPT_ROOTS:
        if not root.exists():
            continue
        for path in sorted(root.glob("**/F0x*.c")):
            match = NAME_RE.fullmatch(path.name)
            if not match:
                continue
            yield path, module_for(path), int(match.group(1), 16)


def first_diagnostic(text: str) -> str:
    """Return the most specific failure line m2c emitted, not the header."""
    header = FAILURE_HEADER_RE.search(text)
    if header is not None:
        for line in text[header.end() :].splitlines():
            stripped = line.strip().strip("*/").strip()
            if stripped and not stripped.startswith("Traceback"):
                return stripped
    match = MIPS2C_ERR_RE.search(text)
    return match.group(0).strip() if match else ""


def normalize_diagnostic(diag: str) -> str:
    """Collapse a diagnostic to a cause key by stripping instance detail."""
    key = re.sub(r"0x[0-9a-fA-F]+", "<addr>", diag)
    key = re.sub(r"\b[.$]?(?:\.L|F|D)0x[0-9a-fA-F]+\b", "<label>", key)
    key = re.sub(r"\$[a-z0-9]+", "<reg>", key)
    key = re.sub(r"\s+", " ", key).strip(" /*")
    return key[:140]


_CBODY = None


def cbody():
    """Import the real feature extractor lazily so the tool has one source of truth."""
    global _CBODY
    if _CBODY is None:
        import sys

        sys.path.insert(0, str(ROOT / "tools"))
        from dw3_semantics import cbody as module

        _CBODY = module
    return _CBODY


def classify(text: str, expected_name: str | None = None) -> tuple[str, str, str]:
    """Return (status, cause, detail) for one m2c artifact.

    status is one of: failed, incomplete, complete.
    """
    if not text.strip():
        return "failed", "empty_artifact", ""

    # A body that m2c actually emitted is not a failure even when it carries
    # inline `// Error:` comments: those mark individual unrecovered statements
    # inside an otherwise recovered function, so they belong in `incomplete`.
    features = cbody().extract(text, expected_name=expected_name)
    if features.parsed and not features.empty:
        markers = sorted(set(features.incomplete))
        if re.search(r"(?m)^\s*//\s*Error:", text):
            markers.append("inline_error_marker")
        if not markers:
            return "complete", "complete", ""
        return "incomplete", "+".join(markers), ""

    diag = first_diagnostic(text)
    if diag or "Decompilation failure" in text or "/* TIMEOUT */" in text:
        if "/* TIMEOUT */" in text and not diag:
            return "failed", "timeout", ""
        key = normalize_diagnostic(diag or "Decompilation failure")
        lowered = key.lower()
        if "contains no instructions" in lowered:
            cause = "empty_partition_maybe_rodata"
        elif "branch target" in lowered:
            cause = "branch_target_outside_body"
        elif "jump table" in lowered or "switch" in lowered:
            cause = "unresolved_jump_table"
        elif "not a function" in lowered or "no function" in lowered:
            cause = "bad_function_boundary"
        elif "bad function call operand" in lowered:
            cause = "register_call_operand"
        elif "stack" in lowered:
            cause = "stack_model"
        elif "timeout" in lowered:
            cause = "timeout"
        else:
            cause = "other_diagnostic"
        return "failed", cause, key

    if not features.parsed:
        return "failed", "unparsed_body", ""
    return "incomplete", "empty_body_needs_triage", ""


def collect(roots=None) -> list[dict]:
    rows = []
    for path, module, address in iter_attempts(roots):
        text = path.read_text(errors="replace")
        status, cause, detail = classify(text, expected_name=f"F0x{address:08x}")
        rows.append(
            {
                "id": f"{module}:F0x{address:08x}",
                "module": module,
                "path": (
                    path.relative_to(ROOT).as_posix()
                    if path.is_relative_to(ROOT)
                    else str(path)
                ),
                "status": status,
                "cause": cause,
                "detail": detail,
                "lines": text.count("\n") + 1,
            }
        )
    return rows


def cmd_summary(rows, args) -> None:
    by_status = collections.Counter(r["status"] for r in rows)
    by_cause = collections.Counter(r["cause"] for r in rows)
    detail_by_cause: dict[str, collections.Counter] = collections.defaultdict(
        collections.Counter
    )
    module_by_cause: dict[str, collections.Counter] = collections.defaultdict(
        collections.Counter
    )
    for r in rows:
        if r["detail"]:
            detail_by_cause[r["cause"]][r["detail"]] += 1
        if r["status"] != "complete":
            module_by_cause[r["cause"]][r["module"]] += 1

    out = {
        "attempts": len(rows),
        "by_status": dict(by_status.most_common()),
        "by_cause": dict(by_cause.most_common()),
        "top_diagnostics": {
            cause: dict(counter.most_common(args.top))
            for cause, counter in detail_by_cause.items()
        },
        "modules_per_cause": {
            cause: dict(counter.most_common(args.top))
            for cause, counter in module_by_cause.items()
        },
    }
    print(json.dumps(out, indent=2))


def cmd_list(rows, args) -> None:
    sel = [
        r
        for r in rows
        if (args.cause is None or r["cause"] == args.cause)
        and (args.status is None or r["status"] == args.status)
        and (args.module is None or r["module"] == args.module)
    ]
    for r in sel[: args.limit]:
        print(f"{r['id']}\t{r['status']}\t{r['cause']}\t{r['path']}\t{r['detail']}")
    print(f"# {len(sel)} matching, showing {min(len(sel), args.limit)}")


def norm_asm_for(module: str) -> Path:
    if module == "exe/fns":
        return ROOT / "exe-decomp/fns.norm.s"
    return ROOT / f"exe-decomp/{module.removeprefix('pro/')}.norm.s"


WORD_RE = re.compile(r"^\s*(?:\.L0x[0-9a-fA-F]+:)?\s*\.word\s+(\S+)")
GLABEL_RE = re.compile(r"^\s*(?:\.global\s+)?(F0x[0-9a-fA-F]{8}):?\s*$")


def partition_bytes(module: str, address: int, limit: int = 64) -> bytes | None:
    """Return the raw bytes emitted under a label, up to the next global label."""
    path = norm_asm_for(module)
    if not path.exists():
        return None
    want = f"f0x{address:08x}"
    out = bytearray()
    seen = False
    for line in path.read_text(errors="replace").splitlines():
        label = GLABEL_RE.match(line)
        if label is not None:
            if label.group(1).lower() == want:
                seen = True
                continue
            if seen:
                break
            continue
        if not seen:
            continue
        word = WORD_RE.match(line)
        if word is None:
            continue
        token = word.group(1)
        if not token.startswith("0x"):
            return None  # a symbolic .word: a pointer, not literal data
        out += int(token, 16).to_bytes(4, "little")
        if len(out) >= limit:
            break
    return bytes(out) if seen else None


def classify_partition(data: bytes | None) -> tuple[str, str]:
    if data is None:
        return "no_literal_bytes", ""
    # Shift-JIS lead bytes are 0x81-0x9F/0xE0-0xEF and trail bytes 0x40-0xFC, so
    # a single NUL always terminates the string rather than splitting a pair.
    trimmed = data.split(b"\x00")[0]
    if not trimmed:
        return "zero_fill", ""
    try:
        text = trimmed.decode("shift_jis")
    except UnicodeDecodeError:
        return "unknown_data", trimmed[:16].hex(" ")
    # str.isprintable() is False for every space but U+0020, and these tables pad
    # with the fullwidth space U+3000, so treat any separator as printable.
    if text and all(ch.isprintable() or ch.isspace() for ch in text):
        return "shift_jis_string", text
    return "unknown_data", trimmed[:16].hex(" ")


def cmd_markers(rows, args) -> None:
    """Triage incomplete bodies by the exact markers the real extractor records.

    This uses ``dw3_semantics.cbody`` rather than a local approximation, so the
    buckets here are the same ones that gate ``clean_typed_c`` emission.
    """
    combos = collections.Counter()
    singles = collections.Counter()
    module_by_marker: dict[str, collections.Counter] = collections.defaultdict(
        collections.Counter
    )
    totals = collections.Counter()
    for r in rows:
        if r["status"] == "failed":
            continue
        text = (ROOT / r["path"]).read_text(errors="replace")
        module, _, fid = r["id"].partition(":")
        features = cbody().extract(text, expected_name=fid)
        if not features.parsed:
            totals["unparsed"] += 1
            continue
        if features.complete:
            totals["complete"] += 1
            continue
        totals["incomplete"] += 1
        markers = sorted(set(features.incomplete))
        combos["+".join(markers)] += 1
        for marker in markers:
            singles[marker] += 1
            module_by_marker[marker][module] += 1
    print(
        json.dumps(
            {
                "bodies": sum(totals.values()),
                "totals": dict(totals.most_common()),
                "by_marker": dict(singles.most_common()),
                "by_marker_combination": dict(combos.most_common(args.top)),
                "modules_per_marker": {
                    marker: dict(counter.most_common(args.top))
                    for marker, counter in module_by_marker.items()
                },
            },
            indent=2,
        )
    )


ORIGINAL_ASM = Path.home() / "ddw3/asm/dw2003"
# Overlay assembly writes intra-overlay calls as raw absolute addresses
# (`jal 0x80099a80`) and only cross-module calls into the EXE as `F0x` names, so
# matching `F0x` alone silently misses almost every overlay caller.
JAL_RE = re.compile(
    r"(?m)^\s*(?:\.L[\w.]+:\s*)?\b(?:jal|bal)\s+(?:F)?(?:0x)?([0-9a-fA-F]{8})\b"
)
JUMPTABLE_WORD_RE = re.compile(
    r"(?m)^\s*(?:\.L[\w.]+:\s*)?\.word\s+(?:F)?(?:0x)?([0-9a-fA-F]{8})\b"
)
UNASSIGNED_SAVED_RE = re.compile(r"\bsaved_reg_(\w+)\b")


def original_asm_paths(module: str) -> list[Path]:
    """Original assembly files backing a module id, read-only under ~/ddw3."""
    if module == "exe/fns":
        directory = ORIGINAL_ASM / "exe"
        return sorted(directory.glob("*.s")) if directory.exists() else []
    name = module.removeprefix("pro/")
    candidate = ORIGINAL_ASM / "pro" / f"{name}.s"
    return [candidate] if candidate.exists() else []


_CALL_TARGETS: dict[str, tuple[set[str], set[str]]] = {}


def call_targets(module: str) -> tuple[set[str], set[str]]:
    """Return (jal/bal targets, .word table entries) for a module."""
    if module not in _CALL_TARGETS:
        called: set[str] = set()
        tabled: set[str] = set()
        for path in original_asm_paths(module):
            text = path.read_text(errors="replace")
            called.update(m.lower() for m in JAL_RE.findall(text))
            tabled.update(m.lower() for m in JUMPTABLE_WORD_RE.findall(text))
        # An overlay is also called from the EXE and from other overlays, so a
        # module-local scan alone cannot prove an address is never called.
        if module != "exe/fns":
            for path in original_asm_paths("exe/fns"):
                text = path.read_text(errors="replace")
                called.update(m.lower() for m in JAL_RE.findall(text))
                tabled.update(m.lower() for m in JUMPTABLE_WORD_RE.findall(text))
        _CALL_TARGETS[module] = (called, tabled)
    return _CALL_TARGETS[module]


NORM_ASM_OVERRIDES = {"pro/ststatus": "exe-decomp/ststatus_c_norm.s"}
ASM_LINE_RE = re.compile(r"^\s*(?:\.L0x([0-9a-fA-F]+):)?\s*(.*?)\s*(?:#.*)?$")
JR_RE = re.compile(r"^jr\s+\$(\w+)")
LA_RE = re.compile(r"^la_\s+\$\w+,\s*(?:D0x|F0x)?([0-9a-fA-F]{8})")
LUI_RE = re.compile(r"^lui\s+\$(\w+),\s*(?:0x)?([0-9a-fA-F]+)")
ADDIU_RE = re.compile(r"^addiu\s+\$(\w+),\s*(?:\$\w+,\s*)?(?:0x)?(-?[0-9a-fA-F]+)")
SLTIU_RE = re.compile(r"^sltiu\s+\$\w+,\s*\$\w+,\s*(?:0x)?([0-9a-fA-F]+)")
WORD_ENTRY_RE = re.compile(r"^\.word\s+(?:D0x|F0x)?(?:0x)?([0-9a-fA-F]{8})\b")
# Normalized EXE assembly builds table addresses with relocation macros.
HI_RE = re.compile(r"^lui\s+\$(\w+),\s*%hi\((?:D0x|F0x)([0-9a-fA-F]{8})\)")
# Overlay norm files label instructions by file offset but write `.word` entries
# and table bases as absolute addresses, so lookups must try both spaces.
OVERLAY_DEFAULT_BASE = 0x80082CB0


def norm_asm_path(module: str) -> Path | None:
    if module in NORM_ASM_OVERRIDES:
        path = ROOT / NORM_ASM_OVERRIDES[module]
    elif module == "exe/fns":
        path = ROOT / "exe-decomp/fns.norm.s"
    else:
        path = ROOT / f"exe-decomp/{module.removeprefix('pro/')}.norm.s"
    return path if path.exists() else None


def _parse_norm(module: str):
    """Return (ordered [(addr, text)], {addr: index}) for a normalized module."""
    path = norm_asm_path(module)
    if path is None:
        return None, None
    lines = []
    for raw in path.read_text(errors="replace").splitlines():
        match = ASM_LINE_RE.match(raw)
        if not match:
            continue
        text = match.group(2)
        if not text or text.startswith((".global", ".set", ".text", ".rodata", ".section")):
            continue
        addr = int(match.group(1), 16) if match.group(1) else None
        lines.append((addr, text))
    index = {addr: i for i, (addr, _) in enumerate(lines) if addr is not None}
    return lines, index


_SWITCH_CACHE: dict[str, dict] = {}


def switch_cases(module: str) -> dict:
    """Locate `jr`-dispatched switch tables and the case labels they target.

    Only a `jr` (jump) through a table makes its entries case labels sharing the
    parent's frame; a `jalr` through a table calls real functions.  The table
    base is recovered from the `la_`/`lui`+`addiu` pair feeding the load, and the
    case count from the preceding `sltiu` bounds check.
    """
    if module in _SWITCH_CACHE:
        return _SWITCH_CACHE[module]
    lines, index = _parse_norm(module)
    result = {"available": lines is not None, "dispatchers": [], "cases": set()}
    if lines is None:
        _SWITCH_CACHE[module] = result
        return result

    for position, (addr, text) in enumerate(lines):
        jr = JR_RE.match(text)
        if not jr or jr.group(1) in ("ra", "31"):
            continue
        base = count = None
        pending_lui: dict[str, int] = {}
        for back in range(max(0, position - 14), position):
            prior = lines[back][1]
            la = LA_RE.match(prior)
            if la:
                base = int(la.group(1), 16)
            hi = HI_RE.match(prior)
            if hi:
                base = int(hi.group(2), 16)
            lui = LUI_RE.match(prior)
            if lui:
                pending_lui[lui.group(1)] = int(lui.group(2), 16) << 16
            addiu = ADDIU_RE.match(prior)
            if addiu and addiu.group(1) in pending_lui:
                base = pending_lui[addiu.group(1)] + int(addiu.group(2), 16)
            bounds = SLTIU_RE.match(prior)
            if bounds:
                count = int(bounds.group(1), 16)
        entry = {
            "dispatch": f"0x{addr:08x}" if addr is not None else None,
            "table": f"0x{base:08x}" if base else None,
            "cases": count,
            "resolved": [],
        }
        if base is not None and count:
            offset_base = base - (0 if module == "exe/fns" else OVERLAY_DEFAULT_BASE)
            for slot in range(count):
                slot_index = index.get(base + slot * 4)
                if slot_index is None:
                    slot_index = index.get(offset_base + slot * 4)
                if slot_index is None:
                    continue
                word = WORD_ENTRY_RE.match(lines[slot_index][1])
                if word:
                    entry["resolved"].append(int(word.group(1), 16))
            result["cases"].update(entry["resolved"])
        result["dispatchers"].append(entry)
    _SWITCH_CACHE[module] = result
    return result


def cmd_switchcases(rows, args) -> None:
    modules = sorted({r["id"].partition(":")[0] for r in rows})
    report = {}
    for module in modules:
        info = switch_cases(module)
        if not info["available"]:
            report[module] = {"normalized_assembly": "missing"}
            continue
        resolved = [d for d in info["dispatchers"] if d["resolved"]]
        report[module] = {
            "jr_dispatchers": len(info["dispatchers"]),
            "with_resolved_table": len(resolved),
            "distinct_case_labels": len(info["cases"]),
            "sample": [
                {
                    **d,
                    "resolved": sorted({f"F0x{a:08x}" for a in d["resolved"]}),
                }
                for d in resolved[: args.samples]
            ],
        }
    print(json.dumps(report, indent=2))


def cmd_boundaries(rows, args) -> None:
    """Test whether `saved_reg` bodies are false boundaries rather than lift gaps.

    A block that reads a callee-saved register it never assigns depends on a
    parent's frame.  If the original assembly never reaches that address with
    `jal`/`bal`, it is a switch case or shared tail, not a function entry, and no
    decompiler flag can lift it -- the boundary has to be repaired first.

    `shared_frame_block_in_word_table` records only what is checked here: the
    address is never a `jal`/`bal` target and does appear as a `.word`.  Whether
    the consumer is a `jr` switch dispatch (making it a case label) or a `jalr`
    callback table (making it a real entry) is NOT decided by this test.  It was
    confirmed to be `jr` dispatch in two independent modules by reading the
    original assembly -- `exe/fns` table `D0x80010000` at `.L0x8001112c: jr $v0`,
    and `pro/ststatus` table `STSTATUS+0` at `.L0x000015d4: jr $v0`, whose delay
    slot is immediately followed by `F0x8008428c` (case 0).  Both tables repeat
    one default entry across unused indices.  Other modules are consistent with
    this shape but unconfirmed; check the dispatcher before treating their
    members as non-functions.
    """
    buckets = collections.Counter()
    modules = collections.defaultdict(collections.Counter)
    examples = collections.defaultdict(list)
    for r in rows:
        if r["status"] != "incomplete" or "saved_reg" not in r["cause"]:
            continue
        module, _, fid = r["id"].partition(":")
        text = (ROOT / r["path"]).read_text(errors="replace")
        features = cbody().extract(text, expected_name=fid)
        body = features.body
        read = set(UNASSIGNED_SAVED_RE.findall(body))
        assigned = {
            m for m in read
            if re.search(r"\bsaved_reg_" + re.escape(m) + r"\s*=", body)
        }
        called, tabled = call_targets(module)
        key = fid.lower().removeprefix("f0x")
        confirmed_cases = switch_cases(module)["cases"]
        if not read - assigned:
            bucket = "saved_reg_assigned_locally"
        elif key in called:
            bucket = "real_entry_lift_gap"
        elif int(key, 16) in confirmed_cases:
            # Proven: reached only through a `jr` dispatch table, so it is a case
            # label inside the dispatching function rather than an entry point.
            bucket = "confirmed_switch_case_label"
        elif key in tabled:
            bucket = "shared_frame_block_in_word_table"
        elif not called and not tabled:
            bucket = "module_asm_unavailable"
        else:
            bucket = "shared_frame_block_unreferenced"
        buckets[bucket] += 1
        modules[bucket][module] += 1
        if len(examples[bucket]) < args.samples:
            examples[bucket].append(r["id"])
    print(
        json.dumps(
            {
                "saved_reg_bodies": sum(buckets.values()),
                "by_bucket": dict(buckets.most_common()),
                "modules_per_bucket": {
                    b: dict(c.most_common(args.top)) for b, c in modules.items()
                },
                "examples": dict(examples),
            },
            indent=2,
        )
    )


def cmd_unknowns(rows, args) -> None:
    """Locate every `?` that makes a body incomplete, so the fix is identifiable.

    A `?` on the return type, a parameter, a local, or a global needs a different
    input to m2c, and the aggregate `unknown_type` marker hides that difference.
    """
    sites = collections.Counter()
    globals_needing_type = collections.Counter()
    functions = 0
    for r in rows:
        if r["status"] != "incomplete" or "unknown_type" not in r["cause"]:
            continue
        functions += 1
        text = (ROOT / r["path"]).read_text(errors="replace")
        module, _, fid = r["id"].partition(":")
        features = cbody().extract(text, expected_name=fid)
        signature = re.search(
            r"^([^\n]*?\b" + re.escape(fid) + r"\s*\([^)]*\))\s*\{", text, re.MULTILINE
        )
        if signature and "?" in signature.group(1):
            head, _, params = signature.group(1).partition("(")
            if "?" in head:
                sites["return_type"] += 1
            if "?" in params:
                sites["parameter"] += 1
        # DECL_RE requires a type starting with a letter, so `? sp10;` never
        # reaches features.locals; count those declarations from the body text.
        body = features.body
        untyped_locals = re.findall(r"(?m)^\s*\?\s*\**(\w+);\s*$", body)
        if untyped_locals:
            sites["local"] += 1
            for local in untyped_locals:
                sites["local_stack_slot" if local.startswith("sp") else "local_other"] += 1
        # An untyped global is declared as `extern ? D0x...;` above the body and
        # is the input a context file can supply.
        for match in re.finditer(r"^extern\s+\?\s+(D0x[0-9a-fA-F]{8})\s*;", text, re.MULTILINE):
            sites["untyped_global_referenced"] += 1
            globals_needing_type[match.group(1)] += 1
            break
    print(
        json.dumps(
            {
                "unknown_type_bodies": functions,
                "unknown_sites": dict(sites.most_common()),
                "distinct_untyped_globals": len(globals_needing_type),
                "top_untyped_globals": dict(globals_needing_type.most_common(args.top)),
            },
            indent=2,
        )
    )


def cmd_partitions(rows, args) -> None:
    sel = [r for r in rows if r["cause"] == "empty_partition_maybe_rodata"]
    kinds = collections.Counter()
    samples: dict[str, list[str]] = collections.defaultdict(list)
    for r in sel:
        module, _, fid = r["id"].partition(":")
        data = partition_bytes(module, int(fid[3:], 16))
        kind, detail = classify_partition(data)
        kinds[kind] += 1
        if len(samples[kind]) < args.samples:
            samples[kind].append(f"{r['id']} {detail}")
    print(
        json.dumps(
            {
                "empty_partitions": len(sel),
                "by_content": dict(kinds.most_common()),
                "samples": dict(samples),
            },
            indent=2,
            ensure_ascii=False,
        )
    )


def cmd_show(rows, args) -> None:
    index = {r["id"]: r for r in rows}
    for fid in args.id:
        row = index.get(fid)
        if row is None:
            print(f"{fid}: no attempt artifact")
            continue
        print(json.dumps(row, indent=2))
        print((ROOT / row["path"]).read_text(errors="replace")[: args.chars])


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("summary")
    p.add_argument("--top", type=int, default=8)
    p.set_defaults(func=cmd_summary)

    p = sub.add_parser("list")
    p.add_argument("--cause")
    p.add_argument("--status")
    p.add_argument("--module")
    p.add_argument("--limit", type=int, default=40)
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("switchcases")
    p.add_argument("--samples", type=int, default=2)
    p.set_defaults(func=cmd_switchcases)

    p = sub.add_parser("boundaries")
    p.add_argument("--top", type=int, default=8)
    p.add_argument("--samples", type=int, default=5)
    p.set_defaults(func=cmd_boundaries)

    p = sub.add_parser("unknowns")
    p.add_argument("--top", type=int, default=15)
    p.set_defaults(func=cmd_unknowns)

    p = sub.add_parser("markers")
    p.add_argument("--top", type=int, default=10)
    p.set_defaults(func=cmd_markers)

    p = sub.add_parser("partitions")
    p.add_argument("--samples", type=int, default=6)
    p.set_defaults(func=cmd_partitions)

    p = sub.add_parser("show")
    p.add_argument("id", nargs="+")
    p.add_argument("--chars", type=int, default=3000)
    p.set_defaults(func=cmd_show)

    parser.add_argument(
        "--root", type=Path, action="append", dest="roots",
        help="Scan this attempt directory instead of the committed roots "
             "(repeatable). Use to compare a pipeline change against the baseline.",
    )
    args = parser.parse_args()
    args.func(collect(args.roots), args)


if __name__ == "__main__":
    main()
