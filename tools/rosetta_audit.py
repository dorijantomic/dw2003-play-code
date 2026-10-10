"""Live, read-only Rosetta bookkeeping audit; no original-behavior verdicts.

This deliberately works when the derived index is stale. Counts describe
records and missing joins, never how much of the original game is understood.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path


def is_inventory(link: dict) -> bool:
    # The existing seed generator gives system inventories these stable IDs.
    # A system row stays an inventory even after it gains some original anchors.
    behavior = link.get("behavior_id", "")
    return behavior.startswith("system.") and behavior.endswith(".integrated")


def link_population(links: list[dict]) -> dict:
    return {
        "links": len(links),
        "system_inventory_rows": sum(is_inventory(row) for row in links),
        "behavior_rows": sum(not is_inventory(row) for row in links),
        "rows_without_original": sum(not row.get("original") for row in links),
        "rows_without_claims": sum(not row.get("knowledge", {}).get("claim_ids") for row in links),
        "original_ids": len({p["id"] for row in links for p in row.get("original", [])}),
        "mapping_review": dict(sorted(Counter(row.get("mapping_review") for row in links).items())),
        "feature_denominator": "not established; modules, symbols and rows are not features",
    }


def audit(root: Path, system: str | None = None, limit: int = 10) -> list[dict]:
    def read(path: str) -> dict:
        return json.loads((root / path).read_text())

    links = read("recovered/ddw3/rosetta-links.json").get("links", [])
    catalog = read("docs/research/systems/catalog.json")
    claims = read("docs/research/evidence/ledger.json").get("claims", [])
    claim_by_id = {row["id"]: row for row in claims}
    frontiers = {
        frontier["id"]: frontier
        for row in catalog.get("systems", [])
        for frontier in row.get("frontiers", [])
    }
    if system:
        links = [row for row in links if system in row.get("system_ids", [])]
    rows = []
    hashes: dict[str, str | None] = {}
    for link in links:
        work = link.get("open_work", {})
        cited = set(link.get("knowledge", {}).get("claim_ids", []))
        frontier_ids = set(work.get("frontier_ids", []))
        # These are review leads, not claims to attach automatically: frontier
        # membership does not establish the scope of a source-to-port mapping.
        leads = sorted(row["id"] for row in claims
                       if row.get("status") == "verified"
                       and row.get("system") in link.get("system_ids", [])
                       and frontier_ids.intersection(row.get("frontier_ids", []))
                       and row["id"] not in cited)
        sources = list(link.get("maintenance", {}).get("source_digests", {}).items())
        for participant in link.get("original", []):
            sources.append((participant["source"], participant["source_sha256"]))
        changed = set()
        for source, expected in sources:
            if source not in hashes:
                path = Path(source).expanduser()
                path = path if path.is_absolute() else root / path
                hashes[source] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
            if expected != hashes[source]:
                changed.add(source)
        statuses = {key: frontiers.get(key, {}).get("status", "missing") for key in sorted(frontier_ids)}
        action = ("review_changed_mapping" if changed or link.get("mapping_review") == "stale" else
                  "reconcile_existing_evidence" if leads else
                  "split_system_inventory" if is_inventory(link) else
                  "inspect_recorded_gaps")
        rows.append({
            "behavior": link["behavior_id"], "next_action": action,
            "mapping_review": link.get("mapping_review"),
            "original_participants": len(link.get("original", [])),
            "linked_claims": dict(sorted(Counter(claim_by_id.get(key, {}).get("status", "missing") for key in cited).items())),
            "verified_claim_leads": len(leads), "claim_lead_sample": leads[:3],
            "frontiers": statuses,
            "changed_sources": sorted(changed),
            "gap_kinds": sorted({gap["kind"] for gap in work.get("gaps", [])}),
        })
    summary = link_population(links)
    summary.update({
        "audit": "live records; not a verification or completion gate",
        "rows_with_changed_sources": sum(bool(row["changed_sources"]) for row in rows),
        "rows_with_verified_claim_leads": sum(bool(row["verified_claim_leads"]) for row in rows),
        "rows_with_resolved_frontier_references": sum("resolved" in row["frontiers"].values() for row in rows),
        "rows_with_missing_frontier_references": sum("missing" in row["frontiers"].values() for row in rows),
        "rows_returned": min(len(rows), max(0, limit)),
    })
    priorities = {"review_changed_mapping": 0, "reconcile_existing_evidence": 1,
                  "split_system_inventory": 2, "inspect_recorded_gaps": 3}
    rows.sort(key=lambda row: (priorities[row["next_action"]], -row["verified_claim_leads"], row["behavior"]))
    return [summary, *rows[:max(0, limit)]]
