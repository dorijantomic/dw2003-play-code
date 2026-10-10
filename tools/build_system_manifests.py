#!/usr/bin/env python3
"""Generate conservative per-system manifests from the coverage catalog."""

from __future__ import annotations

import json
from pathlib import Path

try:  # script execution adds tools/ to sys.path; tests import tools.*
    from dw3_research.metadata import atomic_json, metadata_lock
except ModuleNotFoundError:  # pragma: no cover - import-mode compatibility
    from tools.dw3_research.metadata import atomic_json, metadata_lock


ROOT = Path(__file__).resolve().parents[1]
SYSTEMS = ROOT / "docs/research/systems"
CATALOG = SYSTEMS / "catalog.json"
LEDGER = ROOT / "docs/research/evidence/ledger.json"


def aggregate_status(statuses: list[str]) -> str:
    if not statuses or set(statuses) == {"unresearched"}:
        return "unresearched"
    if set(statuses) == {"verified"}:
        return "verified"
    if set(statuses) == {"contradicted"}:
        return "contradicted"
    if set(statuses) <= {"unresearched", "candidate"}:
        return "candidate"
    return "partially_verified"


def build(
    systems_dir: Path = SYSTEMS,
    catalog_path: Path = CATALOG,
    ledger_path: Path = LEDGER,
    root: Path = ROOT,
) -> None:
    catalog = json.loads(catalog_path.read_text())
    ledger = json.loads(ledger_path.read_text())
    claims_by_system: dict[str, list[dict[str, str]]] = {}
    for claim in ledger.get("claims", []):
        claims_by_system.setdefault(claim["system"], []).append({
            "id": claim["id"],
            "status": claim["status"],
        })
    for item in catalog["systems"]:
        system_claims = claims_by_system.get(item["system"], [])
        item["status"] = aggregate_status([claim["status"] for claim in system_claims])
        path = systems_dir / f"{item['system']}.manifest.json"
        if path.exists():
            manifest = json.loads(path.read_text())
        else:
            manifest = {
                "schema_version": 1,
                "system": item["system"],
                "status": item["status"],
                "updated": catalog["updated"],
                "claims": [],
                "unresolved_questions": [],
            }
        manifest.update({
            "aliases": item.get("aliases", []),
            "coverage_summary": item["summary"],
            "implementation_status": item["implementation_status"],
            # The evidence behind that mark: the engine/web modules and the tests
            # that justify it. Checked by tools/check_implementation_status.py.
            # Before 2026-08-12 the mark travelled alone and went stale unnoticed.
            "implementation": item.get("implementation", {}),
            "canonical_docs": item.get("canonical_docs", []),
            "source_map": item.get("source_map", []),
            "priority": item.get("priority", 100),
            "research_frontiers": item.get("frontiers", []),
            "catalog_note": catalog.get("note", ""),
        })
        manifest["claims"] = sorted(system_claims, key=lambda claim: claim["id"])
        manifest["status"] = item["status"]
        if not manifest.get("unresolved_questions"):
            manifest["unresolved_questions"] = item.get("frontiers", [])
        atomic_json(path, manifest)
        print(path.relative_to(root))
    atomic_json(catalog_path, catalog)


def main() -> None:
    with metadata_lock(ROOT):
        build()


if __name__ == "__main__":
    main()
