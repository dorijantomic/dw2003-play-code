#!/usr/bin/env python3
"""Masked-body signature database for the DDW3 original code corpus.

The literature this follows
---------------------------
IDA's FLIRT and Ghidra's FunctionID both build a signature database by hashing
each known function's body with operands and branch targets masked, then match
unknown functions against it, so a routine survives being linked at a different
address. Binary code-similarity work grades twins as clone types 1 to 4 --
identical / renamed-or-immediates-changed / gapped / semantically equal. A
matcher tuned for type 1 (exact bytes) misses type 2 and type 3 members, which
is exactly the failure the stage overlays hit: one stage's routine is one
stage's constant away from the next stage's, and an address-sensitive hash sees
two functions where a human sees one family.

What this tool is
-----------------
The inverse of ``tools/match_psyq.py``. That tool matches the resident code
against an *external* SDK database (PS1Recomp's PsyQ signatures). This tool
mines an *internal* database out of the functions we have already named -- the
``semantic_name``/``semantic_family`` entries in
``recovered/ddw3/function-inventory.json`` and the addresses the evidence ledger
anchors -- and matches every still-unnamed function in every overlay and in the
main executable against it. A match does not create a claim; it says "this
unnamed body is the same code as a body that was already read", which is a
decoding shortcut, not a finding.

Four mask levels, one hash per level
------------------------------------
* ``full``   -- the raw instruction words. Identical body (clone type 1).
* ``imm``    -- ALU-immediate and load/store displacement fields cleared;
               branch and jump targets left intact. Constant-different copy
               (clone type 2).
* ``branch`` -- the above plus every branch offset and ``j``/``jal`` target
               cleared (PS1Recomp's ``maskImmediates``). Address-different
               copy of the same code (clone type 2).
* ``reg``    -- clone ``branch``, then renumber every general-purpose register
               by first appearance in the body, ``$zero`` fixed. Survives a
               different compiler register allocation (clone type 2).

Clone type 3 (gapped) has no hash -- a gap changes the length -- so it is found
separately, by token-sequence similarity on the branch-masked words. Clone
type 4 (semantically equal, structurally different) is **not detectable from a
body hash at all** and is reported as zero, not guessed at; a type-4 identity
needs a behavioural proof.

Boundary discipline
-------------------
Bodies come from ``recovered/ddw3/function-inventory.json`` source slices. A
body is bounded by the next function start in the same module, exactly as
``tools/propagate_family_names.py`` bounds it, so a missing boundary cannot
silently extend a comparison to end of file. 27 of the 319 modules -- including
the main executable -- carry no ``# .word`` encoding column in their assembly;
for the executable the words are read from the pinned PCSX-Redux RAM dump
(authority 2), and for the rest the module is reported **unreadable**, which is
not evidence of a mismatch (see ``propagate_family_names``).

The overlay sources are parsed under the mandated one-core / 4 GiB scan cap,
taken automatically by re-executing this tool under ``taskset -c 0 prlimit
--as=4294967296 --`` unless ``DW3_SCAN_CAPPED=1`` is already set.

Usage
-----
    tools/function_signature_db.py --build
    tools/function_signature_db.py --match wstag300
    tools/function_signature_db.py --report
    tools/function_signature_db.py --report --json

Run with ``taskset -c 0 prlimit --as=4294967296 -- .venv/bin/python3 ...`` or
let the tool cap itself.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INVENTORY = ROOT / "recovered/ddw3/function-inventory.json"
LEDGER = ROOT / "docs/research/evidence/ledger.json"
DB_OUT = ROOT / "recovered/ddw3/function-signature-db.json"
MATCH_OUT = ROOT / "recovered/ddw3/function-signature-matches.json"
RAM_DUMP = Path("/home/dorij/.config/pcsx-redux/SLES03936_mem_wram.bin")

# Word extraction is shared with the family matcher and the census via
# tools/encoded_words.py: it reads both assembly column shapes, falls back to
# the overlay's disc image for the mnemonic-only disassemblies, and to the
# pinned RAM dump for the executable. `parse_word_column` is re-exported here
# because the tests import it from this module.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from encoded_words import (  # noqa: E402
    DUMP_PINNED_SHA256,
    RAM_BASE,
    ModuleWords,
    load_overlay_images,
    parse_word_column,
)


MASK_LEVELS = ("full", "imm", "branch", "reg")
# Specificity order: a body is reported at the strongest level it matches.
LEVEL_ORDER = ("full", "imm", "branch", "reg")
CLONE_TYPE = {"full": 1, "imm": 2, "branch": 2, "reg": 2, "gapped": 3}

# Gapped (type 3) detection: a near copy whose length changed. It is a
# candidate grade, not an identity: token-sequence similarity on short bodies is
# noisy, so tiny functions and sub-0.90 matches are excluded rather than
# reported. The threshold was set against the corpus, not guessed -- at 0.85 a
# band of one-instruction-different library stubs dominated the type-3 count.
GAPPED_MIN_RATIO = 0.90
GAPPED_MIN_SIZE = 8
GAPPED_SIZE_LO = 0.75
GAPPED_SIZE_HI = 1.30

# `word` columns are read by tools/encoded_words.py, which handles both the
# decoded (`# .word`) and raw (`.word` directive) shapes.
ADDRESS_RE = re.compile(r"0x(8[0-9a-fA-F]{7})(?![0-9a-fA-F])")

VALUE_OPS = {0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F}  # ALU immediate
BRANCH_OPS = {0x01} | set(range(0x04, 0x08))
JUMP_OPS = {0x02, 0x03}
LOADSTORE_OPS = set(range(0x20, 0x40))


# --- masking --------------------------------------------------------------

def mask_immediate(word: int) -> int:
    """Clear ALU-immediate fields and load/store displacements only.

    Branch and jump targets are left intact, so a copy that changed a constant
    matches here while a copy that moved to a different address does not.
    """
    op = (word >> 26) & 0x3F
    if op == 0:
        return word
    if op in BRANCH_OPS or op in JUMP_OPS:
        return word
    if op in VALUE_OPS or op in LOADSTORE_OPS:
        return word & 0xFFFF0000
    return word


def mask_branch(word: int) -> int:
    """PS1Recomp's ``maskImmediates``: every linker-moveable field cleared.

    ``j``/``jal`` keep the opcode only; branches and the ALU-immediate and
    load/store groups keep opcode+rs+rt. R-type is untouched.
    """
    op = (word >> 26) & 0x3F
    if op == 0:
        return word
    if op in JUMP_OPS:
        return word & 0xFC000000
    if op in BRANCH_OPS:
        return word & 0xFFFF0000
    if op in VALUE_OPS or op in LOADSTORE_OPS:
        return word & 0xFFFF0000
    return word


def canonicalize_registers(words: list[int]) -> list[int]:
    """Renumber general-purpose registers by first appearance in the body.

    ``$zero`` stays 0; every other register becomes its ordinal of first use, so
    two copies compiled with a different temporary allocation serialise to the
    same words. Applied on top of the branch mask.
    """
    mapping: dict[int, int] = {}

    def canon(reg: int) -> int:
        if reg == 0:
            return 0
        if reg not in mapping:
            mapping[reg] = len(mapping) + 1
        return mapping[reg]

    out: list[int] = []
    for word in words:
        op = (word >> 26) & 0x3F
        if op in JUMP_OPS:
            out.append(word)
            continue
        if op == 0:
            rs, rt, rd = (word >> 21) & 31, (word >> 16) & 31, (word >> 11) & 31
            word &= ~((0x1F << 21) | (0x1F << 16) | (0x1F << 11))
            word |= (canon(rs) << 21) | (canon(rt) << 16) | (canon(rd) << 11)
        else:
            rs, rt = (word >> 21) & 31, (word >> 16) & 31
            word &= ~((0x1F << 21) | (0x1F << 16))
            word |= (canon(rs) << 21) | (canon(rt) << 16)
        out.append(word)
    return out


def _digest(words: list[int]) -> str:
    payload = b"".join(w.to_bytes(4, "little") for w in words)
    return hashlib.sha256(payload).hexdigest()[:16]


def fingerprint_words(words: list[int]) -> dict:
    """One hash per mask level for a bounded instruction-word body."""
    masked_imm = [mask_immediate(w) for w in words]
    masked_branch = [mask_branch(w) for w in words]
    masked_reg = canonicalize_registers(masked_branch)
    return {
        "size": len(words),
        "full": _digest(words),
        "imm": _digest(masked_imm),
        "branch": _digest(masked_branch),
        "reg": _digest(masked_reg),
        "branch_tokens": masked_branch,
    }


# --- reading bodies -------------------------------------------------------

class ModuleBodies(ModuleWords):
    """Back-compat name for the shared reader in tools/encoded_words.py.

    Kept so the tests and the census can import it from here; all extraction
    (both word-column shapes, the disc overlay image, the RAM dump) lives in
    the shared module.
    """

    def __init__(self, module: dict, dump: bytes | None = None,
                 images: dict | None = None) -> None:
        if images is None:
            images = load_overlay_images()
        super().__init__(module, dump=dump, images=images)


# --- database -------------------------------------------------------------

def empty_index() -> dict:
    return {level: {} for level in MASK_LEVELS}


def add_to_index(index: dict, entry: dict, fp: dict) -> None:
    for level in MASK_LEVELS:
        bucket = index[level].setdefault(fp[level], {"size": fp["size"], "entries": []})
        bucket["entries"].append({
            "id": entry["id"], "name": entry["name"], "family": entry["family"],
            "module": entry["module"], "address": entry["address"],
        })


def ledger_anchored_addresses(ledger: dict) -> set[int]:
    """Addresses with a live claim anchored on them, from the evidence ledger."""
    live = {"candidate", "partially_verified", "verified"}
    wanted = {
        eid for claim in ledger.get("claims", [])
        if claim.get("status") in live for eid in claim.get("evidence", [])
    }
    found: set[int] = set()
    for item in ledger.get("evidence", []):
        if item["id"] not in wanted:
            continue
        for hit in ADDRESS_RE.findall(str(item.get("locator", ""))):
            found.add(int(hit, 16))
    return found


def load_inventory(path: Path = INVENTORY) -> dict:
    return json.loads(path.read_text())


def mine(inventory: dict, ledger: dict, dump: bytes | None = None,
         images: dict | None = None) -> dict:
    """Build the signature database from every function that carries a name."""
    anchored = ledger_anchored_addresses(ledger)
    index = empty_index()
    named: list[dict] = []
    unreadable: list[dict] = []
    families: dict[str, set] = defaultdict(set)
    if images is None:
        images = load_overlay_images()

    for module in inventory["modules"]:
        bodies = ModuleBodies(module, dump, images)
        for function in module.get("functions", []):
            name = function.get("semantic_name")
            if not name:
                continue
            address = int(function["address"], 16) if function.get("address") else None
            if address is None:
                continue
            words = bodies.body(function)
            if not words:
                unreadable.append({"id": function["id"], "module": module["id"],
                                   "reason": bodies.reason or "no-bounded-body"})
                continue
            fp = fingerprint_words(words)
            family = function.get("semantic_family") or name
            entry = {
                "id": function["id"], "module": module["id"], "address": function["address"],
                "name": name, "family": family,
                "ledger_anchored": address in anchored,
            }
            named.append({**entry, "size": fp["size"], "branch_tokens": fp["branch_tokens"]})
            families[family].add(function["id"])
            add_to_index(index, entry, fp)

    counts = Counter()
    for e in named:
        counts[e["module"]] += 1
    return {
        "index": index,
        "named": named,
        "unreadable": unreadable,
        "families": families,
        "counts": {
            "named_functions": len(named) + len(unreadable),
            "fingerprinted": len(named),
            "unreadable": len(unreadable),
            "families": len(families),
            "by_overlay": dict(sorted(counts.items())),
        },
    }


# --- matching -------------------------------------------------------------

def _entries_for(index: dict, level: str, digest: str) -> list[dict]:
    bucket = index[level].get(digest)
    return bucket["entries"] if bucket else []


def grade(fp: dict, tokens: list[int], named_index: dict, named_tokens: dict,
          *, gapped: bool = True) -> dict | None:
    """Best clone match for one fingerprint, or None.

    Levels are tried most-specific first. A hash shared by more than one family
    is reported ``ambiguous`` rather than resolved to a guess, exactly as
    ``match_psyq`` refuses a digest two library names claim.
    """
    for level in LEVEL_ORDER:
        entries = _entries_for(named_index, level, fp[level])
        if not entries:
            continue
        families = sorted({e["family"] for e in entries if e["family"]})
        if len(families) != 1:
            return {"matched": False, "ambiguous": True, "level": level,
                    "clone_type": CLONE_TYPE[level], "families": families,
                    "candidates": _compact(entries)}
        best = sorted(entries, key=lambda e: (e["name"], e["module"]))[0]
        return {"matched": True, "ambiguous": False, "level": level,
                "clone_type": CLONE_TYPE[level], "family": families[0],
                "name": best["name"], "source": best["id"], "source_module": best["module"],
                "candidates": _compact(entries)}

    if gapped:
        found = gapped_match(tokens, fp["size"], named_tokens)
        if found is not None:
            return {"matched": True, "ambiguous": False, "level": "gapped",
                    "clone_type": 3, "family": found["family"], "name": found["name"],
                    "source": found["id"], "source_module": found["module"],
                    "ratio": found["ratio"], "size_delta": found["size_delta"],
                    "candidates": [found["id"]]}
    return None


def _compact(entries: list[dict]) -> list[dict]:
    return [{"id": e["id"], "name": e["name"], "family": e["family"],
             "module": e["module"]} for e in entries[:12]]


def gapped_match(tokens: list[int], size: int,
                 named_tokens: dict[int, list[tuple[list[int], dict]]]) -> dict | None:
    """Type-3 clone: same code with instructions inserted or removed."""
    if size < GAPPED_MIN_SIZE:
        return None
    lo = int(size * GAPPED_SIZE_LO)
    hi = int(size * GAPPED_SIZE_HI) + 1
    best: dict | None = None
    for candidate_size in range(lo, hi):
        for cand_tokens, entry in named_tokens.get(candidate_size, ()):
            ratio = difflib.SequenceMatcher(None, tokens, cand_tokens, autojunk=False).ratio()
            if ratio < GAPPED_MIN_RATIO:
                continue
            if best is None or ratio > best["ratio"]:
                best = {"id": entry["id"], "name": entry["name"], "family": entry["family"],
                        "module": entry["module"], "ratio": round(ratio, 4),
                        "size_delta": candidate_size - size}
    return best


def build_named_tokens(named: list[dict]) -> dict[int, list[tuple[list[int], dict]]]:
    by_size: dict[int, list[tuple[list[int], dict]]] = defaultdict(list)
    for entry in named:
        tokens = [int(w, 16) if isinstance(w, str) else w for w in entry["branch_tokens"]]
        by_size[entry["size"]].append((tokens, entry))
    return by_size


def match_functions(db: dict, inventory: dict, modules: list[dict],
                    dump: bytes | None = None, images: dict | None = None) -> list[dict]:
    """Match every unnamed function in the given modules against the database."""
    index = db["index"]
    named_tokens = build_named_tokens(db["named"])
    rows: list[dict] = []
    if images is None:
        images = load_overlay_images()
    for module in modules:
        bodies = ModuleBodies(module, dump, images)
        for function in module.get("functions", []):
            if function.get("semantic_name"):
                continue
            if function.get("role") == "block":
                continue
            words = bodies.body(function)
            row = {"id": function["id"], "module": module["id"],
                   "address": function.get("address")}
            if not words:
                row["status"] = "unreadable"
                rows.append(row)
                continue
            fp = fingerprint_words(words)
            tokens = fp["branch_tokens"]
            result = grade(fp, tokens, index, named_tokens)
            if result is None:
                row["status"] = "unmatched"
            elif result.get("ambiguous"):
                row.update({"status": "ambiguous", "level": result["level"],
                            "families": result["families"]})
            else:
                row.update({"status": "matched", "level": result["level"],
                            "clone_type": result["clone_type"],
                            "family": result["family"], "name": result["name"],
                            "source": result["source"]})
                if result["level"] == "gapped":
                    row["ratio"] = result["ratio"]
                    row["size_delta"] = result["size_delta"]
            rows.append(row)
    return rows


def summarize(rows: list[dict]) -> dict:
    """True counts per overlay: unnamed, matched, level, clone type."""
    per_overlay: dict[str, dict] = {}
    for row in rows:
        bucket = per_overlay.setdefault(row["module"], {
            "unnamed": 0, "matched": 0, "unmatched": 0, "ambiguous": 0, "unreadable": 0,
            "by_level": Counter(), "by_clone_type": Counter(),
        })
        bucket["unnamed"] += 1
        if row["status"] == "unreadable":
            bucket["unreadable"] += 1
        elif row["status"] == "unmatched":
            bucket["unmatched"] += 1
        elif row["status"] == "ambiguous":
            bucket["ambiguous"] += 1
        else:
            bucket["matched"] += 1
            bucket["by_level"][row["level"]] += 1
            bucket["by_clone_type"][row["clone_type"]] += 1
    for bucket in per_overlay.values():
        bucket["by_level"] = dict(sorted(bucket["by_level"].items()))
        bucket["by_clone_type"] = dict(sorted(bucket["by_clone_type"].items()))
    return per_overlay


def totals(rows: list[dict]) -> dict:
    summary = summarize(rows)
    agg = {
        "unnamed": sum(b["unnamed"] for b in summary.values()),
        "matched": sum(b["matched"] for b in summary.values()),
        "unmatched": sum(b["unmatched"] for b in summary.values()),
        "ambiguous": sum(b["ambiguous"] for b in summary.values()),
        "unreadable": sum(b["unreadable"] for b in summary.values()),
        "by_level": Counter(), "by_clone_type": Counter(),
    }
    for bucket in summary.values():
        for k, v in bucket["by_level"].items():
            agg["by_level"][k] += v
        for k, v in bucket["by_clone_type"].items():
            agg["by_clone_type"][k] += v
    agg["by_level"] = dict(sorted(agg["by_level"].items()))
    agg["by_clone_type"] = dict(sorted(agg["by_clone_type"].items()))
    agg["overlays"] = len(summary)
    return agg


def resolve_modules(inventory: dict, overlay: str | None) -> list[dict]:
    modules = inventory["modules"]
    if overlay is None:
        return modules
    key = overlay.rstrip("/")
    hits = [m for m in modules if m["id"] == key or m["id"].endswith("/" + key)
            or m["id"].split("/")[-1] == key]
    return hits


def load_dump(path: Path = RAM_DUMP) -> bytes:
    return path.read_bytes()


# --- scan cap -------------------------------------------------------------

def scan_cap_argv() -> list[str] | None:
    """The re-exec argv that applies the one-core / 4 GiB scan cap, or None.

    Separated from the exec so the decision is unit-testable without spawning.
    """
    if os.environ.get("DW3_SCAN_CAPPED") == "1":
        return None
    if not sys.platform.startswith("linux"):
        return None
    if not os.path.exists("/usr/bin/taskset"):
        return None
    return ["taskset", "-c", "0", "prlimit", "--as=4294967296", "--",
            sys.executable, os.path.abspath(__file__), *sys.argv[1:]]


def ensure_scan_cap() -> None:
    """Re-exec under the mandated one-core / 4 GiB cap before parsing sources.

    ``tools/run-overlay-scan.sh`` enforces the same cap for the capstone
    scanner; this tool takes it by hand because it parses the assembly text
    directly rather than shelling out to that script.
    """
    argv = scan_cap_argv()
    if argv is None:
        return
    os.execvpe(argv[0], argv, dict(os.environ, DW3_SCAN_CAPPED="1"))


# --- db io ----------------------------------------------------------------

def write_db(db: dict, path: Path, inventory_path: Path) -> None:
    dump_info = None
    if RAM_DUMP.exists():
        dump_sha = hashlib.sha256(RAM_DUMP.read_bytes()).hexdigest()
        dump_info = {"path": str(RAM_DUMP), "sha256": dump_sha,
                     "pinned_match": dump_sha == DUMP_PINNED_SHA256}
    payload = {
        "schema_version": 1,
        "generated_by": "tools/function_signature_db.py",
        "authority": 2,
        "method": (
            "Masked-body hashes at four levels (full/imm/branch/reg) mined from every "
            "named function; clone-type 3 (gapped) found by token-sequence similarity. "
            "A match says two bodies are the same code, never what the code means."
        ),
        "mask_levels": list(MASK_LEVELS),
        "inputs": {
            "inventory": {"path": str(inventory_path),
                          "sha256": hashlib.sha256(inventory_path.read_bytes()).hexdigest()},
            "dump": dump_info,
        },
        "counts": db["counts"],
        "index": db["index"],
        "named": db["named"],
        "unreadable": db["unreadable"],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1) + "\n")


def load_db(path: Path) -> dict:
    return json.loads(path.read_text())


# --- cli ------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--build", action="store_true", help="mine the database")
    parser.add_argument("--match", metavar="OVERLAY", help="match one overlay")
    parser.add_argument("--report", action="store_true", help="match every overlay and total")
    parser.add_argument("--db", type=Path, default=DB_OUT)
    parser.add_argument("--json", action="store_true", help="write the match report JSON")
    parser.add_argument("--no-cap", action="store_true", help="do not re-exec under taskset")
    args = parser.parse_args(argv)

    if not (args.build or args.match or args.report):
        parser.error("choose --build, --match <overlay>, or --report")

    if not args.no_cap:
        ensure_scan_cap()

    if args.build:
        inventory = load_inventory()
        ledger = json.loads(LEDGER.read_text())
        dump = load_dump() if RAM_DUMP.exists() else None
        db = mine(inventory, ledger, dump)
        write_db(db, args.db, INVENTORY)
        counts = db["counts"]
        print(f"fingerprints built: {counts['fingerprinted']} named functions "
              f"in {counts['families']} families")
        print(f"unreadable (no word column, not a mismatch): {counts['unreadable']}")
        print(f"wrote {args.db.relative_to(ROOT)}")
        return 0

    db = load_db(args.db)
    inventory = load_inventory()
    dump = load_dump() if RAM_DUMP.exists() else None

    if args.match:
        modules = resolve_modules(inventory, args.match)
        if not modules:
            parser.error(f"no module matches overlay {args.match!r}")
        rows = match_functions(db, inventory, modules, dump)
        summary = summarize(rows)
        for module_id, bucket in summary.items():
            print(f"{module_id}: unnamed={bucket['unnamed']} matched={bucket['matched']} "
                  f"unmatched={bucket['unmatched']} ambiguous={bucket['ambiguous']} "
                  f"unreadable={bucket['unreadable']}")
            print(f"   by level: {bucket['by_level']}")
            print(f"   by clone type: {bucket['by_clone_type']}")
        for row in rows:
            if row["status"] == "matched":
                print(f"   {row['address']} {row['id']} -> {row['family']} "
                      f"({row['level']}, type {row['clone_type']})")
        return 0

    # --report
    rows = match_functions(db, inventory, inventory["modules"], dump)
    summary = summarize(rows)
    agg = totals(rows)
    print(f"database: {db['counts']['fingerprinted']} fingerprints, "
          f"{db['counts']['families']} families; "
          f"{db['counts']['unreadable']} named functions unreadable")
    print(f"unnamed functions scanned: {agg['unnamed']} across {agg['overlays']} modules")
    print(f"matched: {agg['matched']}  unmatched: {agg['unmatched']}  "
          f"ambiguous: {agg['ambiguous']}  unreadable: {agg['unreadable']}")
    print(f"by mask level: {agg['by_level']}")
    print(f"by clone type: {agg['by_clone_type']}")
    print("\nper overlay (matched / unnamed):")
    for module_id, bucket in sorted(summary.items(),
                                    key=lambda kv: -kv[1]["matched"]):
        if bucket["matched"] or bucket["unreadable"]:
            print(f"  {module_id:18s} {bucket['matched']:4d}/{bucket['unnamed']:<4d} "
                  f"level={bucket['by_level']} type={bucket['by_clone_type']} "
                  f"ambiguous={bucket['ambiguous']} unreadable={bucket['unreadable']}")

    if args.json:
        payload = {
            "schema_version": 1,
            "generated_by": "tools/function_signature_db.py",
            "authority": 2,
            "note": ("A match identifies the named family an unnamed body is the same code as. "
                     "It is a decoding shortcut, not a finding; clone type 4 (semantically "
                     "equal, structurally different) is not detectable from a body hash."),
            "database": {"path": str(args.db), "counts": db["counts"]},
            "totals": agg,
            "per_overlay": summary,
            "rows": rows,
        }
        MATCH_OUT.parent.mkdir(parents=True, exist_ok=True)
        MATCH_OUT.write_text(json.dumps(payload, indent=1) + "\n")
        print(f"\nwrote {MATCH_OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
