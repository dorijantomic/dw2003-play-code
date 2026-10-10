#!/usr/bin/env python3
"""Run one isolated, structured Fable/Opus review of a claim bundle."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.dw3_research.cli import REVIEWS_DIR, ROOT, claim_review_bundle
from tools.dw3_research.metadata import atomic_json, index_lock, metadata_lock


SCHEMA = {
    "type": "object",
    "properties": {
        "decision": {"enum": ["accept", "reject", "needs_evidence"]},
        "claim_id": {"type": "string"},
        "objections": {"type": "array", "items": {"type": "string"}},
        "evidence_needed": {"type": "array", "items": {"type": "string"}},
        "recommended_status": {
            "enum": ["candidate", "partially_verified", "verified", "contradicted"]
        },
    },
    "required": [
        "decision", "claim_id", "objections", "evidence_needed", "recommended_status"
    ],
    "additionalProperties": False,
}


def parse_result(raw: str) -> dict:
    outer = json.loads(raw)
    if "decision" in outer:
        return outer
    if isinstance(outer.get("structured_output"), dict):
        return outer["structured_output"]
    result = outer.get("result")
    if isinstance(result, str):
        return json.loads(result)
    raise ValueError("Claude output did not contain structured review data")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("claim_id")
    parser.add_argument("--model", default="fable", choices=("fable", "opus"))
    parser.add_argument("--max-budget-usd", type=float, default=1.0)
    parser.add_argument("--db", type=Path, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    with index_lock(ROOT, shared=True):
        bundle = claim_review_bundle(args.claim_id, args.db) if args.db else claim_review_bundle(args.claim_id)
    prompt = (
        "Act as an independent reverse-engineering claim reviewer. Review only the supplied "
        "bundle. Do not rely on outside knowledge. A decision of accept requires recommending "
        "verified; otherwise use reject or needs_evidence and name the smallest exact missing "
        "artifact. Return only the requested structured result.\n\n"
        + json.dumps(bundle, indent=2)
    )
    if args.dry_run:
        print(json.dumps({"model": args.model, "bundle": bundle}, indent=2))
        return

    command = [
        "claude", "--safe-mode", "--print", "--model", args.model,
        "--tools", "", "--no-session-persistence",
        "--max-budget-usd", str(args.max_budget_usd),
        "--output-format", "json", "--json-schema", json.dumps(SCHEMA),
    ]
    completed = subprocess.run(
        command, input=prompt, text=True, capture_output=True, cwd=ROOT, check=False,
    )
    if completed.returncode != 0:
        raise SystemExit(completed.stderr.strip() or f"claude exited {completed.returncode}")
    review = parse_result(completed.stdout)
    if review.get("claim_id") != args.claim_id:
        raise SystemExit(f"review claim mismatch: {review.get('claim_id')} != {args.claim_id}")
    review.update({
        "schema_version": 1,
        "bundle_sha256": bundle["bundle_sha256"],
        "reviewer_model": args.model,
        "reviewed_at": datetime.now(timezone.utc).isoformat(),
    })
    path = REVIEWS_DIR / f"{args.claim_id}.review.json"
    with metadata_lock(ROOT):
        atomic_json(path, review)
    print(f"review={path.relative_to(ROOT)} decision={review['decision']} recommended={review['recommended_status']}")


if __name__ == "__main__":
    main()
