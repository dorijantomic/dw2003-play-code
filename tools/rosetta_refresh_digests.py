#!/usr/bin/env python3
"""Refresh the source digests recorded in recovered/ddw3/rosetta-links.json.

Mechanical maintenance, not evidence: recompute maintenance.source_digests.
Changed supported mappings become stale and retain their old/new hashes for
review. Updating a hash cannot establish that the correspondence still holds.
Original participant hashes are never refreshed here. Missing inputs abort the
entire write. Neither this tool nor a rebuild restores mapping support.
Run after any integration that touched a cited source (the ledger changes on
every epoch), then `rosetta build` + `index`.

Usage: python3 tools/rosetta_refresh_digests.py [--check]
  --check: exit 1 if any digest is stale, without writing.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINKS = ROOT / "recovered/ddw3/rosetta-links.json"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def refresh(doc: dict, root: Path) -> tuple[dict, list[str], list[str]]:
    updated = json.loads(json.dumps(doc))
    changed: list[str] = []
    missing: list[str] = []
    hashes: dict[str, str] = {}
    for link in updated.get("links", []):
        maintenance = link.get("maintenance", {})
        digests = maintenance.get("source_digests", {})
        changes = []
        for rel, recorded in digests.items():
            source = root / rel
            if not source.is_file():
                missing.append(f"{link.get('id')}: missing source {rel}")
                continue
            if rel not in hashes:
                hashes[rel] = sha256_file(source)
            current = hashes[rel]
            if current != recorded:
                changed.append(f"{link.get('id')}: stale {rel}")
                changes.append({"source": rel, "before": recorded, "after": current})
                digests[rel] = current
        if changes:
            previous = link.get("mapping_review")
            maintenance.setdefault("invalidations", []).append({
                "previous_mapping_review": previous,
                "reason": "Maintenance inputs changed; hashes are not a correspondence review.",
                "source_changes": changes,
            })
            if previous == "supported":
                link["mapping_review"] = "stale"
    return updated, changed, missing


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="report stale digests, write nothing")
    args = parser.parse_args()

    doc = json.loads(LINKS.read_text())
    updated, stale, missing = refresh(doc, ROOT)
    if missing:
        print("refresh-aborted: missing sources; no changes written")
        for row in missing:
            print(row)
        return 1
    if args.check:
        for row in stale:
            print(row)
        return 1 if stale else 0
    if stale:
        LINKS.write_text(json.dumps(updated, indent=2, ensure_ascii=False) + "\n")
    print(f"refreshed {len(stale)} digest(s)")
    for row in stale:
        print(row)
    return 0


if __name__ == "__main__":
    sys.exit(main())
