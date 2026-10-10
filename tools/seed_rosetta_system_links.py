#!/usr/bin/env python3
"""Add one explicit, unresolved Rosetta join for every catalog system.

This is a one-time population helper.  It deliberately creates candidate
system-to-shipped-code records without inventing original function matches.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LINKS = ROOT / "recovered/ddw3/rosetta-links.json"
CATALOG = ROOT / "docs/research/systems/catalog.json"
CENSUS = ROOT / "recovered/ddw3/rosetta-source-census.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    links = json.loads(LINKS.read_text())
    catalog = json.loads(CATALOG.read_text())
    census = json.loads(CENSUS.read_text())
    census_by_path = {row["path"]: row for row in census["files"]}
    existing = {row["id"] for row in links["links"]}
    added = 0
    for system in catalog["systems"]:
        system_id = system["system"]
        link_id = f"SYSTEM-{system_id.upper().replace('-', '-')}"
        if link_id in existing:
            continue
        implementation = system.get("implementation", {})
        modules = implementation.get("modules", [])
        production_modules = [
            path for path in modules
            if census_by_path.get(path, {}).get("reachability") == "production"
        ]
        reachability = "production" if production_modules else "unresolved"
        system_status = system.get("implementation_status", "partial")
        engine = [
            {"file": path, "symbol": "<module>", "role": "catalog implementation module"}
            for path in modules if path.startswith("engine/")
        ]
        web = [
            {
                "file": path,
                "symbol": "<module>",
                "role": "catalog browser implementation module",
                "entry_page": "web/index.html",
                "trigger": "system path; exact trigger remains to be joined",
            }
            for path in modules if path.startswith("web/")
        ]
        source_digests = {
            path: sha256(ROOT / path)
            for path in modules if (ROOT / path).is_file()
        }
        gaps = [{
            "kind": "link",
            "evidence_needed": "Join this shipped module/test population to exact original routines, tables, or dispatch records from the listed canonical source scope; do not infer the match from the system name.",
        }]
        if system_status in {"partial", "missing"}:
            gaps.append({
                "kind": "implementation",
                "evidence_needed": "Use the catalog's implementation status and named tests to identify the bounded missing or partial behavior before claiming parity.",
            })
        if not modules:
            gaps.append({
                "kind": "host_only",
                "evidence_needed": "Confirm whether this catalog system is intentionally outside the shipped browser scope or needs an implementation record.",
            })
        links["links"].append({
            "id": link_id,
            "behavior_id": f"system.{system_id}.integrated",
            "system_ids": [system_id],
            "presentation_row_ids": [],
            "player_surface": f"The shipped {system_id} path as reached through the browser game.",
            "relationship_kind": "adapts" if modules else "host_support",
            "mapping_review": "candidate",
            "reachability": {
                "status": reachability,
                "proof": production_modules or ["catalog implementation.modules is empty"],
            },
            "original": [],
            "knowledge": {
                "canonical_docs": system.get("canonical_docs", []),
                "claim_ids": [],
                "relationship_scope": "This is an inventory and attribution record only. It does not claim an original routine match or upgrade catalog status.",
                "unresolved_alternatives": system.get("source_map", []),
            },
            "engine": engine,
            "web": web,
            "data": [],
            "translation": {
                "kind": "catalog-to-shipped-code inventory join",
                "fields": "Not established; the original representation remains an open join.",
                "units": "Not established.",
                "timing": "Not established.",
                "host_adaptations": ["Browser modules and tests are recorded as shipped participants, not as proof of original behavior."],
            },
            "proof": {
                "mapping_justification": ["The catalog explicitly names the implementation modules and tests."],
                "original_evidence": [],
                "implementation_tests": implementation.get("tests", []),
                "runtime_path": [f"source census reachability for {path}" for path in production_modules],
                "visual_audio_comparison": [],
            },
            "open_work": {
                "gaps": gaps,
                "frontier_ids": [frontier.get("id") for frontier in system.get("frontiers", []) if frontier.get("id")],
                "dependencies": [],
                "candidate_ghidra_anchors": [],
                "counterexample": "A canonical original source review that identifies a different routine/table boundary or an unreachable shipped module rejects this candidate join.",
            },
            "maintenance": {
                "generator_version": "rosetta-system-seed-1",
                "last_checked_snapshot": "2026-09-05",
                "source_digests": source_digests,
                "invalidation_reason": "Any catalog implementation-module or source change requires rechecking this inventory join.",
                "durable_job_id": f"rosetta-2026-09-05/system-{system_id}",
            },
        })
        added += 1
    LINKS.write_text(json.dumps(links, indent=2) + "\n")
    print(f"seeded-system-links added={added} total={len(links['links'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
