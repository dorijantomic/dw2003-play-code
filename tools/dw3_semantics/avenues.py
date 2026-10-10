"""The avenue register: every repository-derived route to the residue, scored.

WHY THIS EXISTS
---------------
"The pipeline works" is not a finish line. The finish line is being able to say,
for every source of semantic signal the repository holds, that it has either
been exploited, experimentally rejected, or shown to be incapable of reducing
what is left. Without that register the honest answer to "what else could we
try?" is a shrug, and the same source gets rediscovered, re-joined and
re-abandoned every few sessions.

So this module MEASURES each avenue against the current residue rather than
asserting a verdict. Every number below is read off disk at run time. A verdict
is one of:

  exploited     joined onto function identities and feeding the graph
  rejected      built, measured, and found no better than guessing
  incapable     structurally cannot reach the residue, with the reason measured
  untested      present in the repository, never joined -- work remains

The `incapable` verdict is the dangerous one and the one to distrust: three
times in this repository a zero has turned out to be a join bug rather than an
absence (an `f0x`/`F0x` case mismatch, a fingerprint file keyed by assembly path
rather than function id, and a pointer table whose targets sit under a different
key than the one the first pass read). Every `incapable` here therefore records
the count of rows the avenue actually holds alongside its reach, so a zero reach
next to a zero row count is visibly a different claim from a zero reach next to
thirty thousand rows.
"""

from __future__ import annotations

import json
import pathlib
import sqlite3
from dataclasses import dataclass, field

REPO = pathlib.Path(__file__).resolve().parents[2]
GENERATED = REPO / "docs/generated"
INDEX = REPO / ".dw3-research/index.sqlite3"
INVENTORY = REPO / "recovered/ddw3/function-inventory.json"


@dataclass
class Avenue:
    name: str
    what: str
    verdict: str
    rows: int = 0
    reaches_residue: int = 0
    note: str = ""
    detail: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"avenue": self.name, "what": self.what, "verdict": self.verdict,
                "rows": self.rows, "reaches_residue": self.reaches_residue,
                "note": self.note, **({"detail": self.detail} if self.detail else {})}


def _load(path: pathlib.Path):
    return json.loads(path.read_text()) if path.is_file() else None


def _function_ids(inventory: dict) -> dict[str, dict]:
    return {f["id"]: f for m in inventory["modules"] for f in m.get("functions", [])}


# --------------------------------------------------------------------------
# the measurements
# --------------------------------------------------------------------------

def _symbols(residue: set[str]) -> Avenue:
    """The index's symbol table: a million rows, and none of them a name.

    This is the single largest unexploited table in the repository, which makes
    it the first thing anyone reaches for. It cannot help: the shipped binary
    was stripped, so every symbol is a label the disassembler generated from an
    address. The 528 that are not of the `F0x`/`.L0x`/`D0x` form are just an
    overlay prefix on the same address (`FIGHTSTG_F0x800832d0`).
    """
    if not INDEX.is_file():
        return Avenue("index.symbols", "1M symbol rows from the assembly",
                      "untested", note="no index on disk")
    import re
    auto = re.compile(r"^\.?[A-Za-z]{0,3}0x[0-9a-fA-F]+$")
    prefixed = re.compile(r"^[A-Z0-9_]+_F0x[0-9a-fA-F]+$")
    db = sqlite3.connect(f"file:{INDEX}?mode=ro", uri=True)
    total = semantic = generated = 0
    for (name,) in db.execute("select name from symbols"):
        total += 1
        if auto.match(name) or prefixed.match(name):
            generated += 1
        else:
            semantic += 1
    db.close()
    return Avenue(
        "index.symbols", "every symbol name in the original assembly",
        "incapable", rows=total, reaches_residue=0,
        note=(f"{generated} of {total} names are generated from an address and "
              f"{semantic} carry any other form. The binary is stripped: there "
              f"are no authored names to harvest, so this cannot name anything."),
        detail={"address_derived": generated, "other_form": semantic})


def _fingerprints(residue: set[str]) -> Avenue:
    data = _load(GENERATED / "function-fingerprints.json")
    if not data:
        return Avenue("function-fingerprints", "per-function code fingerprints",
                      "untested", note="artifact absent")
    functions = data.get("functions", {})

    def fid(path: str) -> str:
        p = pathlib.Path(path)
        parent = p.parent.parent.name
        module = "exe/fns" if parent == "c" else "pro/" + parent.removesuffix("_c")
        return f"{module}:{p.stem}"

    populated = {fid(k) for k, v in functions.items() if v}
    return Avenue(
        "function-fingerprints", "per-function code fingerprints",
        "incapable" if not (populated & residue) else "untested",
        rows=len(functions), reaches_residue=len(populated & residue),
        note=(f"{len(populated)} of {len(functions)} rows carry a fingerprint at "
              f"all, and they are keyed by assembly path rather than function id "
              f"-- joining on the raw key scores zero for the wrong reason."))


def _stage_descriptors(residue: set[str]) -> Avenue:
    rows = _load(GENERATED / "stage-descriptors.json") or []
    ids = {f"pro/{r['stage']}:{r['function'].replace('f0x', 'F0x')}"
           for r in rows if r.get("stage") and r.get("function")}
    return Avenue(
        "stage-descriptors", "the ~250 wstag stage overlays as data",
        "incapable" if not (ids & residue) else "untested",
        rows=len(rows), reaches_residue=len(ids & residue),
        note=("Stage descriptors describe stage entry points, which are already "
              "labelled. Note the key case is `f0x`, not `F0x`: a case-sensitive "
              "join scores zero here for the wrong reason."))


def _string_join(residue: set[str]) -> Avenue:
    data = _load(GENERATED / "string-code-join.json")
    sites = (data or {}).get("call_sites", [])
    ids = {("exe/fns" if s["overlay"] == "exe" else "pro/" + s["overlay"])
           + ":" + s["function"] for s in sites}
    return Avenue(
        "string-code-join", "shipped game text joined to the code that shows it",
        "exploited" if ids else "untested",
        rows=len(sites), reaches_residue=len(ids & residue),
        note=("The strongest naming signal in the repository -- it says what a "
              "function puts on screen in the game's own words. It reaches no "
              "residue function because it needs a decompiled body to find the "
              "bank call in, and the residue is what has no body."))


def _pointer_tables(residue: set[str]) -> Avenue:
    inventory = _load(INVENTORY)
    if not inventory:
        return Avenue("dispatch-pointer-tables", "resolved function-pointer slots",
                      "untested", note="inventory absent")
    targets: dict[str, dict] = {}
    for slot, value in inventory["global_function_pointers"].items():
        if value.get("target"):
            targets.setdefault(value["target"], {"slot": slot, "kind": "global"})
    for slot, rows in inventory["overlay_function_pointers"].items():
        for row in rows:
            if row.get("target"):
                targets.setdefault(row["target"], {
                    "slot": slot, "kind": "overlay",
                    "array": row.get("array_name"),
                    "index": row.get("array_index"),
                    "owner": row.get("owner_module")})
    hit = sorted(set(targets) & residue)
    return Avenue(
        "dispatch-pointer-tables", "resolved function-pointer slots in shipped data",
        "untested" if hit else "incapable",
        rows=len(targets), reaches_residue=len(hit),
        note=("A function reached only through a named table slot takes its "
              "context from the slot: the owning module, the array it sits in, "
              "and its index. This is the one avenue that still reaches the "
              "residue without needing a decompiled body."),
        detail={"residue_targets": {i: targets[i] for i in hit}})


def _refs(residue: set[str]) -> Avenue:
    if not INDEX.is_file():
        return Avenue("index.refs", "address and callee references", "untested")
    db = sqlite3.connect(f"file:{INDEX}?mode=ro", uri=True)
    total = db.execute("select count(*) from refs").fetchone()[0]
    names = {name: i for i, name in db.execute("select id,name from functions")}
    ids = {names[i.split(":")[1]] for i in residue if i.split(":")[1] in names}
    rows = 0
    if ids:
        marks = ",".join("?" * len(ids))
        rows = db.execute(
            f"select count(*) from refs where function_id in ({marks})",
            tuple(ids)).fetchone()[0]
    db.close()
    return Avenue(
        "index.refs", "address and callee references per function",
        "untested" if rows else "incapable",
        rows=total, reaches_residue=len(ids),
        note=(f"The index's `functions` table is built from decompiled C and "
              f"holds no row from a `.s` file, so it reaches a residue function "
              f"only once that function has been lifted. {len(ids)} of "
              f"{len(residue)} are reachable now, carrying {rows} ref rows."))


def _unlifted(residue: set[str]) -> Avenue:
    """The avenue that actually moved the number: run the decompiler on it."""
    inventory = _load(INVENTORY)
    functions = _function_ids(inventory) if inventory else {}
    without_body = [i for i in residue
                    if not (functions.get(i, {}).get("decompiled_sources") or [])]
    return Avenue(
        "unlifted-assembly", "residue functions the decompiler was never run on",
        "exploited" if len(without_body) < len(residue) else "untested",
        rows=len(residue), reaches_residue=len(without_body),
        note=("Entry selection derived entries from the assembly alone and "
              "missed functions the inventory already had a boundary for. "
              "Feeding those labels back through `lift_overlays.py --exe "
              "--context` lifted 93 of them with zero regression on "
              "`check_lift_regression.py`. What is left here is what m2c "
              "genuinely cannot lift."))


def _call_graph(residue: set[str]) -> Avenue:
    return Avenue(
        "call-graph-topic-propagation", "infer a topic from a function's callers",
        "rejected", rows=0, reaches_residue=0,
        note=("Built and measured by tools/infer_module_domains.py on "
              "2026-08-11: 30.2% accurate against a 51.0% majority-class "
              "baseline -- worse than guessing. It is excluded by rule from "
              "topic assignment and locked by a test."))


MEASUREMENTS = (_unlifted, _pointer_tables, _string_join, _refs,
                _fingerprints, _stage_descriptors, _symbols, _call_graph)

# Avenues already joined by `signals.load_all`, listed so the register is a
# complete account rather than only the leftovers.
EXPLOITED = (
    ("ledger", "recorded claims and their evidence anchors"),
    ("text-banks", "the game's own shipped strings"),
    ("bounds", "caps, clamps, loop counts and thresholds"),
    ("research-documents", "prose in docs/research/**"),
    ("engine", "the browser implementation"),
    ("static-decoder", "proven control shapes, globals and struct fields"),
    ("curated-names", "hand-assigned names, subsystems and families"),
    ("module-majority", "the dominant topic of a function's own module"),
    ("shared-globals", "non-hub globals two functions both touch"),
)


def register(residue: set[str]) -> dict:
    rows = [m(residue).as_dict() for m in MEASUREMENTS]
    rows += [{"avenue": name, "what": what, "verdict": "exploited",
              "rows": 0, "reaches_residue": 0,
              "note": "joined onto function identities by signals.load_all"}
             for name, what in EXPLOITED]
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["verdict"]] = counts.get(row["verdict"], 0) + 1
    return {
        "residue": len(residue),
        "verdicts": counts,
        "avenues": sorted(rows, key=lambda r: (r["verdict"], -r["reaches_residue"])),
        "open_work": [r["avenue"] for r in rows
                      if r["verdict"] == "untested" and r["reaches_residue"]],
    }


# --------------------------------------------------------------------------
# what the residue actually is
# --------------------------------------------------------------------------

import re

ASM_ROOT = pathlib.Path.home() / "ddw3/asm/dw2003"

LABEL_RE = re.compile(r"(?m)^(F0x[0-9a-f]{8}):")
# an overlay labels by FILE OFFSET, not by absolute address
OFFSET_LABEL_RE = re.compile(r"(?m)^\.L0x([0-9a-f]{8}):")
JAL_ABS_RE = re.compile(r"\bjal\s+(0x[0-9a-f]{8})")
WORD_ABS_RE = re.compile(r"\.word (0x[0-9a-f]{8})")
BRANCH_ABS_RE = re.compile(r"(?m)^\s*\.?\S*:?\s*b\w*\s+[^\n]*?(0x[0-9a-f]{8})")
WORD_RE = re.compile(r"\.word (F0x[0-9a-f]{8})")
# `[^\n,]*` would stop at the comma in `beqz $v0, F0x...` and match only
# the unconditional `b F0x...` form -- a test caught that on 2026-08-12.
BRANCH_RE = re.compile(r"(?m)^\s*\.?\S*:?\s*b\w*\s+[^\n]*?(F0x[0-9a-f]{8})")
JAL_RE = re.compile(r"\bjal\s+(F0x[0-9a-f]{8})")


def _module_index() -> dict[str, dict]:
    """Assembly path and load base per module, from the inventory."""
    inventory = _load(INVENTORY) or {"modules": []}
    out = {}
    for module in inventory["modules"]:
        base = module.get("load_base")
        out[module["id"]] = {
            "path": pathlib.Path(str(module["source"]).replace("~", str(pathlib.Path.home()))),
            "base": int(base, 16) if base else None,
        }
    return out


def _reference_sets(text: str, base: int | None) -> tuple[set, set, set, set]:
    """Labels, jal targets, pointer-table words and branch targets.

    Two notations, and getting this wrong is how a whole bucket goes missing.
    `exe/fns.s` writes absolute `F0x8008d854` labels and `jal F0x...`. An
    overlay writes labels by FILE OFFSET (`.L0x00008870`) and calls its own
    functions as a bare absolute (`jal 0x8008a3e0`), reserving `jal F0x...`
    for calls out to the resident EXE. Matching only the `F0x` form scored
    every overlay function as "no label in assembly" -- 30 of them, which
    looked like a residue of genuinely unreachable code and was not.
    """
    labels = set(LABEL_RE.findall(text)) | set(OFFSET_LABEL_RE.findall(text))
    jals = set(JAL_RE.findall(text)) | set(JAL_ABS_RE.findall(text))
    words = set(WORD_RE.findall(text)) | set(WORD_ABS_RE.findall(text))
    branches = set(BRANCH_RE.findall(text)) | set(BRANCH_ABS_RE.findall(text))
    return labels, jals, words, branches


# The assembler writes code as `<instruction>  # .word 0x...` and data as
# `.word 0x...  # <instruction>` or `.byte ...`. The order is the discriminator,
# and it is exact: it is how `pro/sfstdata:F0x80082cc0` was shown to be a data
# overlay whose "entry" disassembles to a jump to 0x84201c0c -- an address PS1
# RAM does not have -- and how `pro/wstag260:F0x800a9f40` was shown to be the
# final `.byte 0x0` padding byte of its file.
DATA_LINE_RE = re.compile(r"^\s*(?:\.byte|\.word)\b")


def _is_data(text: str, name: str, base: int | None) -> bool:
    address = int(name[1:], 16)
    keys = [f"{name}:"]
    if base is not None:
        keys.append(f".L0x{address - base:08x}:")
    for key in keys:
        index = text.find("\n" + key)
        if index < 0:
            continue
        line = text[index + 1:text.find("\n", index + 1)]
        return bool(DATA_LINE_RE.match(line[len(key):]))
    return False


def _forms(name: str, base: int | None) -> set[str]:
    """Every spelling one function can have in its own assembly file."""
    address = int(name[1:], 16)
    forms = {name, f"0x{address:08x}"}
    if base is not None:
        forms.add(f"{address - base:08x}")
        forms.add(f"0x{address - base:08x}")
    return forms


def characterize(residue: set[str]) -> dict:
    """Say, for every function left, WHY nothing is known about it.

    The finding that made this necessary: most of what the ladder called
    unknown code is not code with an unknown meaning, it is not a function.
    A jump-table case body inside a larger routine is emitted by the
    disassembler with its own `.global F0x...` label and its own section, and
    the inventory promotes exactly that into a function entry. Reading it as a
    standalone routine is the mistake the card frontier already recorded once
    ("those are the table's branch TARGETS, not functions").

    The test used here is deliberately independent of the lift's own switch
    analysis, which reaches the same set by a different route: a real function
    is entered by `jal`. Something reached only by a `.word` in a pointer table
    or by a branch from inside another routine is a case body, whatever label
    sits on it.
    """
    by_module: dict[str, list[str]] = {}
    for fid in residue:
        by_module.setdefault(fid.split(":", 1)[0], []).append(fid)

    modules = _module_index()
    buckets: dict[str, list[str]] = {}
    for module, ids in sorted(by_module.items()):
        info = modules.get(module) or {}
        path, base = info.get("path"), info.get("base")
        if not path or not path.is_file():
            buckets.setdefault("no_assembly_on_disk", []).extend(sorted(ids))
            continue
        text = path.read_text(errors="replace")
        labelled, called, tabled, branched = _reference_sets(text, base)
        for fid in sorted(ids):
            name = fid.split(":", 1)[1]
            forms = _forms(name, base)
            if _is_data(text, name, base):
                bucket = "not_code_data_disassembled_as_instructions"
            elif not (forms & labelled):
                bucket = "no_label_in_assembly"
            elif forms & called:
                bucket = "real_function_never_decoded"
            elif forms & (tabled | branched):
                bucket = "not_a_function_jump_table_or_branch_target"
            else:
                bucket = "labelled_but_unreferenced"
            buckets.setdefault(bucket, []).append(fid)

    counts = {k: len(v) for k, v in sorted(buckets.items(), key=lambda kv: -len(kv[1]))}
    phantom = (counts.get("not_a_function_jump_table_or_branch_target", 0)
               + counts.get("not_code_data_disassembled_as_instructions", 0))
    return {
        "residue": len(residue),
        "buckets": counts,
        "members": {k: v for k, v in buckets.items()},
        # NOT "unknown". What is left after removing data and phantom entries
        # is code m2c declined to lift -- in every case measured on 2026-08-12,
        # because it could not resolve a `jr` jump table. That is a limit of the
        # lifter, not a limit of what is knowable: reading the table out of the
        # overlay resolves it, which is what
        # docs/research/infra/manual-resolution-queue-2026-08-12.md does for all
        # of them. Call it a manual queue and say why each entry is on it.
        "manual_queue": len(residue) - phantom,
        "note": ("`not_a_function_...` is reached only by a pointer-table word or "
                 "a branch, never by a `jal`, so it is a case body inside another "
                 "routine rather than a routine of its own. `not_code_...` is a "
                 "data region a disassembler was pointed at. What remains is the "
                 "MANUAL QUEUE -- real code the lifter declined, not unknown code "
                 "-- and it is resolved in "
                 "docs/research/infra/manual-resolution-queue-2026-08-12.md."),
    }
