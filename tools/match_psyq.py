#!/usr/bin/env python3
"""Full-offset PsyQ signature scan of the resident executable.

Why this exists
---------------
The 2026-09-12 pilot hash-matched only the 987 inventory function starts against
PS1Recomp's pinned `psyq_signatures.toml`, found 122 SDK routines, and left
`docs/todo/2026-09-11-resident-core-sweep.md` ordering a full-offset scan next:
a library routine the inventory folded into a block, or never indexed at all,
was invisible to a start-only pass. This tool is that pass, plus the two
deliverables the plan needs from it:

  * a version pin -- the SDK release hypothesis from the intersection of each
    signature's `sources`, per match and per library;
  * boundary reconciliation -- where a matched signature's extent crosses an
    inventory start, that start is an interior label of the library routine,
    not a function, and the disposition says so.

A match identifies the SDK routine the bytes came from. It never says what the
game does with it. Authority 2 (original bytes) only for the identity; the
version pin is a hypothesis until the review gate passes it.

Imported signature sets (`--imports`)
-------------------------------------
The pinned TOML is PS1Recomp's hash database and identifies 157 starts. Bodies
it does not cover -- libgte/libgs matrix helpers, libc/libc2 internals, libcd
and libspu objects the database's generator never recovered -- can still be
identified against a second, community-made set,
[`lab313ru/psx_psyq_signatures`](https://github.com/lab313ru/psx_psyq_signatures).
That set is per-object byte patterns with `??` wildcards plus the SDK symbol
labels, so `--imports DIR` loads it through `tools/psyq_imports.py` and adds a
byte/wildcard pass. The hash database is tried first; the imported set only
supplies a name where the hash pass found nothing. Imported identifications are
recorded `hash_kind: "pattern"` and are candidates like every other match.

The source repository ships no LICENSE file; the fetched tree is kept untracked
under `.dw3-research/` and never vendored. Only names and patterns are read.

What it cannot see
------------------
* The database covers Sony PsyQ objects only. The resident sound driver's own
  routines (0x8002e7xx-0x800390xx) are not in it and never will be matched.
* Masking clears every immediate, so two structurally identical routines from
  different programs collide; short masked hits stay shape-only.
* The RAM dump is a European (SLES03936) build. Matches are to the running
  image, not to `~/ddw3` bytes.

Usage
-----
    taskset -c 0 prlimit --as=4294967296 -- \\
      .venv/bin/python3 tools/match_psyq.py --scan text \\
      --out recovered/ddw3/psyq-matches.json \\
      --disposition docs/generated/exe-disposition.json

The pinned inputs are the digests printed in
`docs/research/engine/psyq-library-signatures.md`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tomllib
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = ROOT / ".dw3-research/psyq-signature-pilot-2026-09-12/psyq_signatures.toml"
#: Fetched lab313ru/psx_psyq_signatures tree (untracked); see tools/psyq_imports.py.
DEFAULT_IMPORTS = ROOT / ".dw3-research/psyq-imported-signatures-2026-10-06"
DEFAULT_DUMP = Path("/home/dorij/.config/pcsx-redux/SLES03936_mem_wram.bin")

try:  # package import under `python3 -m tools.test_match_psyq`
    from tools.psyq_imports import (
        build_pattern_index,
        load_signatures as load_imported_signatures,
        match_imported,
    )
except ImportError:  # script import under `python3 tools/match_psyq.py`
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from psyq_imports import (  # type: ignore
        build_pattern_index,
        load_signatures as load_imported_signatures,
        match_imported,
    )
DEFAULT_INVENTORY = ROOT / "recovered/ddw3/function-inventory.json"
DEFAULT_EXTENTS = ROOT / "docs/generated/function-extents.json"
DEFAULT_OUT = ROOT / "recovered/ddw3/psyq-matches.json"
DEFAULT_DISPOSITION = ROOT / "docs/generated/exe-disposition.json"

PINNED_DB_SHA256 = "5ae9ada5788f9915ce0df87b701e635efe22801d3553847040d14f999872aee0"
PINNED_DUMP_SHA256 = "671e88b8ffb4b9a646579e5abf84798ec431a43a4a0d01e7b00814271d501bc3"
RAM_BASE = 0x80000000
TEXT_START = 0x80010000
TEXT_END = 0x80041000
# The first 16-byte BIOS stub (InitHeap). Before the 2026-09-12 full-offset
# scan this boundary read 0x8002511c because the stubs themselves were missing
# from the inventory.
LIBRARY_ZONE_START = 0x8002507C


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def mask_word(word: int) -> int:
    """PS1Recomp's `maskImmediates`: clear every immediate a linker can move.

    j/jal keep the opcode only; branches and the ALU-immediate and load/store
    groups keep opcode+rs+rt. R-type is untouched.
    """
    op = (word >> 26) & 0x3F
    if op == 0x00:
        return word
    if op in (0x02, 0x03):
        return word & 0xFC000000
    if op == 0x01 or 0x04 <= op <= 0x07 or 0x14 <= op <= 0x17:
        return word & 0xFFFF0000
    if 0x08 <= op <= 0x0F:
        return word & 0xFFFF0000
    if op >= 0x20:
        return word & 0xFFFF0000
    return word


def load_signatures(path: Path) -> list[dict]:
    return tomllib.load(open(path, "rb"))["signature"]


def build_index(signatures: list[dict]) -> dict:
    """Per-size digest lookups, excluding any digest more than one name claims.

    A digest shared by two SDK routine names is not an identity; guessing one
    would be exactly the false confidence this pass exists to prevent.
    """
    lookup_full: dict[int, dict[str, dict]] = defaultdict(dict)
    lookup_masked: dict[int, dict[str, dict]] = defaultdict(dict)
    names_full: dict[str, set[str]] = defaultdict(set)
    names_masked: dict[str, set[str]] = defaultdict(set)
    for entry in signatures:
        names_full[entry["hash_full"]].add(entry["name"])
        names_masked[entry["hash_masked"]].add(entry["name"])
    ambiguous_full = {h for h, names in names_full.items() if len(names) > 1}
    ambiguous_masked = {h for h, names in names_masked.items() if len(names) > 1}
    for entry in signatures:
        if entry["hash_full"] not in ambiguous_full:
            lookup_full[entry["size"]][entry["hash_full"]] = entry
        if entry["hash_masked"] not in ambiguous_masked:
            lookup_masked[entry["size"]][entry["hash_masked"]] = entry
    return {
        "by_size": defaultdict(list, {
            size: [e for e in signatures if e["size"] == size]
            for size in {e["size"] for e in signatures}
        }),
        "lookup_full": dict(lookup_full),
        "lookup_masked": dict(lookup_masked),
        "ambiguous_full": ambiguous_full,
        "ambiguous_masked": ambiguous_masked,
        "sizes": sorted({e["size"] for e in signatures}),
    }


def masked_image(dump: bytes, start: int, end: int) -> bytes:
    out = bytearray(end - start)
    for offset in range(0, end - start, 4):
        word = int.from_bytes(dump[start - RAM_BASE + offset:start - RAM_BASE + offset + 4], "little")
        out[offset:offset + 4] = mask_word(word).to_bytes(4, "little")
    return bytes(out)


def match_offset(
    dump: bytes,
    masked: bytes,
    address: int,
    index: dict,
    *,
    text_start: int,
    text_end: int,
) -> dict | None:
    """Best signature match at one address, full identity preferred over masked."""
    best: dict | None = None
    base = address - text_start
    if base < 0:
        return None
    for size in index["sizes"]:
        if address + size > text_end:
            break
        digest = hashlib.sha256(masked[base:base + size]).hexdigest()[:16]
        entry = index["lookup_masked"].get(size, {}).get(digest)
        if entry is None and digest not in index["ambiguous_masked"]:
            continue
        full_digest = None
        if entry is not None or digest in index["ambiguous_masked"]:
            full_digest = hashlib.sha256(dump[address - RAM_BASE:address - RAM_BASE + size]).hexdigest()[:16]
        if full_digest is not None and full_digest not in index["ambiguous_full"]:
            full_entry = index["lookup_full"].get(size, {}).get(full_digest)
            if full_entry is not None:
                candidate = {
                    "name": full_entry["name"], "library": full_entry.get("library", ""),
                    "size": size, "hash_kind": "full",
                    "sources": sorted(full_entry.get("sources", [])),
                    "match_mode": full_entry.get("match_mode", ""),
                }
                if _better(candidate, best):
                    best = candidate
                continue
        if entry is not None:
            candidate = {
                "name": entry["name"], "library": entry.get("library", ""),
                "size": size, "hash_kind": "masked",
                "sources": sorted(entry.get("sources", [])),
                "match_mode": entry.get("match_mode", ""),
            }
            if _better(candidate, best):
                best = candidate
    return best


def _better(candidate: dict, current: dict | None) -> bool:
    if current is None:
        return True
    if candidate["hash_kind"] != current["hash_kind"]:
        return candidate["hash_kind"] == "full"
    if candidate["size"] != current["size"]:
        return candidate["size"] > current["size"]
    return candidate["name"] < current["name"]


def scan(
    dump: bytes,
    index: dict,
    offsets: list[int],
    *,
    text_start: int,
    text_end: int,
    import_index: dict[int, list[dict]] | None = None,
    import_offsets: set[int] | None = None,
    import_min_size: int = 8,
    import_min_address: int = 0,
) -> list[dict]:
    masked = masked_image(dump, text_start, text_end)
    matches = []
    for address in offsets:
        found = match_offset(
            dump, masked, address, index, text_start=text_start, text_end=text_end
        )
        if found is None and import_index is not None and address >= import_min_address:
            if import_offsets is None or address in import_offsets:
                found = match_imported(
                    dump, address, RAM_BASE, text_end, import_index,
                    min_size=import_min_size,
                )
        if found is not None:
            found["address"] = f"0x{address:08x}"
            matches.append(found)
    return matches


def load_inventory(path: Path) -> dict:
    inventory = json.loads(path.read_text())
    starts: dict[int, dict] = {}
    for module in inventory["modules"]:
        if not module["id"].startswith("exe"):
            continue
        for function in module["functions"]:
            address = int(function["address"], 16)
            starts[address] = {
                "module": module["id"],
                "id": function["id"],
                "role": function.get("role") or "function",
                "semantic_name": function.get("semantic_name"),
                "provisional_end_address": function.get("provisional_end_address"),
            }
    return {"raw": inventory, "starts": starts}


def load_extent_starts(path: Path) -> set[int]:
    if not path.exists():
        return set()
    payload = json.loads(path.read_text()).get("sources", {})
    addresses: set[int] = set()
    for source, item in payload.items():
        if "exe" not in source:
            continue
        for function in item.get("functions", []):
            addresses.add(int(function["address"]))
    return addresses


def reconcile(matches: list[dict], starts: dict[int, dict], extent_starts: set[int]) -> dict:
    """Which matches are new starts, and which inventory starts are interiors.

    A start inside a matched extent is an interior label only when it does not
    itself byte-match a signature. `SetDrawEnv@v5`'s 6352-byte database entry
    spans `_status`, `_param`, `_addque`, `set_alarm` and other routines that DO
    have their own signatures; flagging them as interiors would bury real
    routines. The genuinely interesting set is the starts a library span covers
    that no signature identifies on their own.
    """
    ordered = sorted(matches, key=lambda m: int(m["address"], 16))
    match_addresses = {int(m["address"], 16) for m in ordered}
    interior: list[dict] = []
    new_starts: list[dict] = []
    for position, match in enumerate(ordered):
        address = int(match["address"], 16)
        end = address + match["size"]
        match["at_inventory_start"] = address in starts
        match["known_extent_start"] = address in extent_starts
        match["interior_labels"] = [
            {"address": f"0x{x:08x}", **starts[x]}
            for x in sorted(starts) if address < x < end and x not in match_addresses
        ]
        for label in match["interior_labels"]:
            interior.append({
                "address": label["address"],
                "interior_of": {"address": match["address"], "name": match["name"],
                                "library": match["library"], "size": match["size"]},
                "inventory": starts[int(label["address"], 16)],
            })
        previous_end = (
            int(ordered[position - 1]["address"], 16) + ordered[position - 1]["size"]
            if position > 0 else None
        )
        next_address = int(ordered[position + 1]["address"], 16) if position + 1 < len(ordered) else None
        match["abuts_previous"] = previous_end == address
        match["abuts_next"] = next_address == end
        if address not in starts:
            new_starts.append({
                "address": match["address"], "name": match["name"],
                "library": match["library"], "size": match["size"],
                "hash_kind": match["hash_kind"], "sources": match["sources"],
                "known_extent_start": match["known_extent_start"],
                "abuts_previous": match["abuts_previous"],
                "abuts_next": match["abuts_next"],
                "interior_labels": match["interior_labels"],
            })
    return {"matches": ordered, "new_starts": new_starts, "interior": interior}


def pin_versions(matches: list[dict]) -> dict:
    """SDK release hypothesis from the `sources` sets.

    A version that appears in EVERY match's sources is a candidate for the
    linked release; a version missing from one match is contradicted by it.
    Per library, the same intersection says which object files agree.
    """
    def versions_of(match: dict) -> set[str]:
        found = set()
        for source in match["sources"]:
            head = source.split("/", 1)[0]
            if head.startswith("v"):
                found.add(head)
        return found

    per_match = [versions_of(m) for m in matches]
    versions = sorted({version for group in per_match for version in group})
    universal = [v for v in versions if all(v in group for group in per_match)]
    support = {
        v: sum(1 for group in per_match if v in group) for v in versions
    }
    excluded_by = {
        v: [m["name"] for m, group in zip(matches, per_match) if v not in group][:10]
        for v in versions
    }
    per_library: dict[str, dict] = {}
    by_library: dict[str, list[dict]] = defaultdict(list)
    for match in matches:
        by_library[match["library"]].append(match)
    for library, group in sorted(by_library.items()):
        intersections = None
        for match in group:
            versions_here = versions_of(match)
            intersections = versions_here if intersections is None else (intersections & versions_here)
        per_library[library] = {
            "matches": len(group),
            "candidates": sorted(intersections or set()),
            "versions_seen": sorted({v for m in group for v in versions_of(m)}),
        }
    return {
        "universal_candidates": universal,
        "support": support,
        "excluded_by_first": {v: names for v, names in excluded_by.items() if names},
        "per_library": per_library,
        "note": (
            "universal_candidates is the release intersection across every match. "
            "An empty list means the matches do not all come from one database build; "
            "read per_library before pinning."
        ),
    }


def disposition(exe: dict, matches: list[dict], interior: list[dict]) -> dict:
    match_at = {int(m["address"], 16): m for m in matches}
    interior_of = {int(row["address"], 16): row["interior_of"] for row in interior}
    addresses: dict[str, dict] = {}
    counts = {"psyq": 0, "game": 0, "block": 0, "library_unidentified": 0,
              "library_interior": 0}
    for address, start in sorted(exe["starts"].items()):
        match = match_at.get(address)
        zone = "library" if address >= LIBRARY_ZONE_START else "game"
        if match is not None and match.get("name"):
            row = {
                "disposition": "psyq" if match["hash_kind"] != "pattern" else "psyq_imported",
                "name": match["name"],
                "library": match["library"],
                "size": match["size"],
                "hash_kind": match["hash_kind"],
                "sources": match["sources"],
            }
            if match["hash_kind"] == "pattern":
                row["weak"] = bool(match.get("weak"))
        elif match is not None and match["hash_kind"] == "pattern":
            # Imported match on a placeholder label: the library object is known
            # but the SDK exported no symbol. Keep it unidentified, carry the hint.
            row = {
                "disposition": "library_unidentified",
                "library": match["library"],
                "enclosing": match.get("enclosing"),
                "local_label": match.get("local_label"),
                "size": match["size"],
                "match_mode": "imported",
            }
        elif start["role"] == "block":
            row = {"disposition": "block"}
        elif zone == "library":
            row = {"disposition": "library_unidentified"}
        else:
            row = {"disposition": "game"}
        row["zone"] = zone
        if address in interior_of:
            row["interior_of"] = interior_of[address]
            counts["library_interior"] += 1
        counts[row["disposition"]] = counts.get(row["disposition"], 0) + 1
        addresses[f"0x{address:08x}"] = {**row, "inventory": start}
    return {"counts": counts, "addresses": addresses}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dump", type=Path, default=DEFAULT_DUMP)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB,
                        help="PS1Recomp psyq_signatures.toml (default: the pinned copy)")
    parser.add_argument("--imports", type=Path, default=None,
                        help="lab313ru/psx_psyq_signatures tree or JSON file; adds a "
                             "byte/wildcard pass where the hash database finds nothing")
    parser.add_argument("--import-min-size", type=int, default=8,
                        help="ignore imported slices smaller than this (default 8)")
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    parser.add_argument("--extents", type=Path, default=DEFAULT_EXTENTS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--disposition", type=Path, default=None,
                        help="write the per-address disposition here")
    parser.add_argument("--scan", choices=("starts", "text"), default="text")
    parser.add_argument("--text-start", type=lambda v: int(v, 0), default=TEXT_START)
    parser.add_argument("--text-end", type=lambda v: int(v, 0), default=TEXT_END)
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    if not args.dump.exists():
        parser.error(f"RAM dump not found: {args.dump}")
    if not args.db.exists():
        parser.error(f"signature database not found: {args.db}")

    dump_digest = sha256_file(args.dump)
    db_digest = sha256_file(args.db)
    if not args.quiet:
        if dump_digest != PINNED_DUMP_SHA256:
            print(f"WARNING: dump digest {dump_digest} != pinned {PINNED_DUMP_SHA256}", file=sys.stderr)
        if db_digest != PINNED_DB_SHA256:
            print(f"WARNING: db digest {db_digest} != pinned {PINNED_DB_SHA256}", file=sys.stderr)

    dump = args.dump.read_bytes()
    signatures = load_signatures(args.db)
    index = build_index(signatures)
    exe = load_inventory(args.inventory)

    import_index = None
    imported_entries: list[dict] = []
    if args.imports is not None:
        if not args.imports.exists():
            parser.error(f"imported signature set not found: {args.imports}")
        imported_entries = load_imported_signatures(args.imports, min_size=max(1, args.import_min_size))
        import_index = build_pattern_index(imported_entries)
        if not args.quiet:
            print(f"imported signatures: {len(imported_entries)} slices from {args.imports}",
                  file=sys.stderr)

    # The imported byte pass is bounded to inventory starts: a full-offset sweep
    # would compare every 4-byte offset against every slice size.
    import_offsets = set(exe["starts"]) if import_index is not None else None

    if args.scan == "starts":
        offsets = sorted(exe["starts"])
    else:
        offsets = list(range(args.text_start, args.text_end, 4))
        if not args.quiet:
            print(f"full-offset scan: {len(offsets)} offsets x {len(index['sizes'])} sizes", file=sys.stderr)

    matches = scan(
        dump, index, offsets,
        text_start=args.text_start, text_end=args.text_end,
        import_index=import_index, import_offsets=import_offsets,
        import_min_size=args.import_min_size,
        import_min_address=LIBRARY_ZONE_START,
    )
    reconciled = reconcile(matches, exe["starts"], load_extent_starts(args.extents))
    pin = pin_versions(reconciled["matches"])
    selected = [
        m for m in reconciled["matches"]
        if m["at_inventory_start"] or m["abuts_previous"] or m["abuts_next"]
        or m["known_extent_start"] or m["interior_labels"]
    ]
    selected_addresses = {int(m["address"], 16) for m in selected}
    selected_new = [n for n in reconciled["new_starts"] if int(n["address"], 16) in selected_addresses]

    payload = {
        "schema_version": 1,
        "generated_by": "tools/match_psyq.py",
        "authority": 2,
        "warning": (
            "A match identifies the SDK routine the bytes came from, never what the "
            "game does with it. Masked matches clear every immediate; short ones are "
            "shape-only. The version pin is a hypothesis until reviewed."
        ),
        "inputs": {
            "dump": {"path": str(args.dump), "sha256": dump_digest, "bytes": len(dump)},
            "db": {"path": str(args.db), "sha256": db_digest,
                   "matches_pinned": db_digest == PINNED_DB_SHA256},
            "imports": ({"path": str(args.imports), "signatures": len(imported_entries),
                         "min_size": args.import_min_size}
                        if import_index is not None else None),
            "inventory": {"path": str(args.inventory), "sha256": sha256_file(args.inventory)},
            "scan": args.scan,
            "text_range": [f"0x{args.text_start:08x}", f"0x{args.text_end:08x}"],
        },
        "counts": {
            "signatures": len(signatures),
            "offsets_tried": len(offsets),
            "matches": len(reconciled["matches"]),
            "full": sum(1 for m in reconciled["matches"] if m["hash_kind"] == "full"),
            "masked": sum(1 for m in reconciled["matches"] if m["hash_kind"] == "masked"),
            "pattern": sum(1 for m in reconciled["matches"] if m["hash_kind"] == "pattern"),
            "at_inventory_start": sum(1 for m in reconciled["matches"] if m["at_inventory_start"]),
            "selected": len(selected),
            "new_starts": len(selected_new),
            "interior_inventory_labels": len(reconciled["interior"]),
        },
        "version_pin": pin,
        "matches": selected,
        "new_starts": selected_new,
        "interior": reconciled["interior"],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=1) + "\n")

    if args.disposition:
        output = disposition(exe, reconciled["matches"], reconciled["interior"])
        output.update({
            "schema_version": 1,
            "generated_by": "tools/match_psyq.py",
            "authority": 2,
            "source": str(args.out),
        })
        args.disposition.parent.mkdir(parents=True, exist_ok=True)
        args.disposition.write_text(json.dumps(output, indent=1) + "\n")

    if not args.quiet:
        print(f"offsets={len(offsets)} matches={len(reconciled['matches'])} "
              f"inventory={sum(1 for m in reconciled['matches'] if m['at_inventory_start'])} "
              f"new={len(selected_new)} interior={len(reconciled['interior'])}")
        print(f"version universal candidates: {pin['universal_candidates']}")
        print(f"wrote {args.out}")
        if args.disposition:
            print(f"wrote {args.disposition}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
