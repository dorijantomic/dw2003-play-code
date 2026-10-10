#!/usr/bin/env python3
"""Record a structured, hash-bound local Codex review of a claim bundle."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.dw3_research.cli import LEDGER, REVIEWS_DIR, ROOT, claim_review_bundle
from tools.dw3_research.metadata import atomic_json, index_lock, metadata_lock


def link_review(claim_id: str, path: Path) -> bool:
    """Point the claim at its review file.

    Writing the review file alone left the claim reading as "lacks review", so
    every accepted review had to be linked by hand afterwards. `review` is not
    part of claim_review_bundle's hash (id/system/statement/current_status/
    notes/evidence_ids), so linking after recording cannot make the stored
    review stale.
    """
    ledger = json.loads(LEDGER.read_text())
    rel = str(path.relative_to(ROOT))
    for claim in ledger.get("claims", []):
        if claim.get("id") == claim_id:
            if claim.get("review") == rel:
                return True
            claim["review"] = rel
            LEDGER.write_text(json.dumps(ledger, indent=2))
            return True
    return False


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Record the current agent's closed-packet review decision."
    )
    parser.add_argument("claim_id")
    parser.add_argument(
        "--decision", required=True,
        choices=("accept", "reject", "needs_evidence"),
    )
    parser.add_argument(
        "--recommended-status", required=True,
        choices=("candidate", "partially_verified", "verified", "contradicted"),
    )
    parser.add_argument("--objection", action="append", default=[])
    parser.add_argument("--evidence-needed", action="append", default=[])
    parser.add_argument(
        "--reviewer-model", default="codex-local",
        help="Who performed the review; default is the local Codex path.",
    )
    args = parser.parse_args()

    if args.decision == "accept" and args.recommended_status != "verified":
        parser.error("accept requires --recommended-status verified")
    if args.decision != "accept" and args.recommended_status == "verified":
        parser.error("verified requires --decision accept")
    if args.decision == "accept" and (args.objection or args.evidence_needed):
        parser.error("an accepting review cannot retain objections or evidence requests")

    with metadata_lock(ROOT), index_lock(ROOT, shared=True):
        bundle = claim_review_bundle(args.claim_id)
        review = {
            "decision": args.decision,
            "claim_id": args.claim_id,
            "objections": args.objection,
            "evidence_needed": args.evidence_needed,
            "recommended_status": args.recommended_status,
            "schema_version": 1,
            "bundle_sha256": bundle["bundle_sha256"],
            "reviewer_model": args.reviewer_model,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        }
        path = REVIEWS_DIR / f"{args.claim_id}.review.json"
        atomic_json(path, review)
        linked = link_review(args.claim_id, path)
    print(
        f"review={path.relative_to(ROOT)} decision={args.decision} "
        f"recommended={args.recommended_status} linked={linked}"
    )


if __name__ == "__main__":
    main()
