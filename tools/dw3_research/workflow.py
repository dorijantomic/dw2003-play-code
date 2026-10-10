"""Immutable research epochs and single-writer evidence packet integration."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .metadata import atomic_json


PACKET_SCHEMA_VERSION = 1
EPOCH_SCHEMA_VERSION = 1
RESOURCE_CLASSES = {"static", "overlay", "rig"}
RESEARCH_AGENT_ROUTES = {
    "ddw3-static-researcher": "standard",
    "ddw3-deep-researcher": "deep",
    "ddw3-runtime-researcher": "runtime",
    # General-purpose subagents dispatched through the operator Task tool with
    # a bounded static brief perform the standard-tier role de facto (indexed
    # lookups plus exact-range reads, no Ghidra/rig/synthesis). Recording them
    # as ddw3-static-researcher would put false provenance in the ledger, so
    # they get their own route at the same tier. Added 2026-09-07 after epoch
    # rosetta-wave1-2026-09-07 packets were rejected for naming their real type.
    "general": "standard",
    # The lead sometimes produces a finding itself — typically when reconciling
    # a contradiction between an existing claim and live repository state, which
    # is the lead's own job and not delegable to a read-only worker. Recording
    # that as one of the worker agent types would put false provenance in the
    # ledger, so it gets its own route. It is NOT a licence to skip delegation:
    # ordinary bounded research still goes to a worker.
    "lead": "lead",
}
CLAIM_STATUSES = {"unresearched", "candidate", "partially_verified", "contradicted"}
FRONTIER_STATUSES = {"open", "assigned", "needs_evidence", "blocked", "resolved"}

# Sources whose bytes are text we can literally quote. Anything else (a binary,
# a dump) cannot contain its own quote, so the substring test is skipped there.
QUOTABLE_SUFFIXES = {
    ".c", ".h", ".s", ".md", ".txt", ".json", ".toml", ".lua", ".py",
}

# A universal or absolute scope word turns a claim about the lines actually read
# into a claim about every line that exists. That gap is the single most common
# defect in this ledger's history: on 2026-08-09 a mechanically derived census
# ("each dispatch block ends in at most one jal", "92 distinct callees") was
# recorded, and a five-line coverage audit falsified it within the hour, because
# the deriving walk never followed conditional branches. The statement was not
# wrong about what was read; it was wrong about what was NOT read.
#
# So a quantified claim must carry `coverage`: how the quantifier was TESTED,
# not merely restated. See the message in validate_packets for what counts.
QUANTIFIER = re.compile(
    r"\b(every|all|always|never|none|nothing|no other|only|exactly|entire|"
    r"whole|complete|completely|exhaustive|exhaustively|any|each|both|"
    r"unconditionally|invariably|universally)\b",
    re.IGNORECASE,
)

# Evidence authority: 1 runtime comparison, 2 original assembly, 3 decompilation
# checked against assembly, 4 extraction checked against source, 5 research,
# 6 browser implementation. 5 and 6 are navigation aids; the project rules say
# the browser implementation is "never proof". A claim asserting original-game
# behaviour above `candidate` therefore needs at least one primary anchor.
PRIMARY_AUTHORITY = 4


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_snapshot(root: Path) -> tuple[str, str]:
    """Return HEAD and a digest of tracked/index/worktree changes."""
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=root, text=True,
        capture_output=True, check=True,
    ).stdout.strip()
    digest = hashlib.sha256()
    for command in (
        ["git", "diff", "--no-ext-diff", "--binary", "--cached"],
        ["git", "diff", "--no-ext-diff", "--binary"],
    ):
        completed = subprocess.run(command, cwd=root, capture_output=True, check=True)
        digest.update(completed.stdout)
        digest.update(b"\0")
    return head, digest.hexdigest()


def current_snapshot(root: Path, db: Path, ledger: Path, catalog: Path) -> dict[str, str]:
    head, worktree = git_snapshot(root)
    conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        meta = dict(conn.execute("SELECT key,value FROM meta"))
    finally:
        conn.close()
    generation = meta.get("generation")
    if not generation:
        raise ValueError("index has no generation; rebuild it before creating an epoch")
    return {
        "git_head": head,
        "git_worktree_sha256": worktree,
        "ledger_sha256": sha256_file(ledger),
        "catalog_sha256": sha256_file(catalog),
        "index_generation": generation,
    }


def frontier_map(catalog: dict) -> dict[str, tuple[str, dict]]:
    found: dict[str, tuple[str, dict]] = {}
    for system in catalog.get("systems", []):
        for frontier in system.get("frontiers", []):
            found[frontier["id"]] = (system["system"], frontier)
    return found


def create_epoch(
    root: Path,
    db: Path,
    ledger: Path,
    catalog_path: Path,
    epoch_id: str,
    frontier_ids: Iterable[str],
    resource: str,
) -> tuple[Path, dict]:
    if resource not in RESOURCE_CLASSES:
        raise ValueError(f"unknown resource class: {resource}")
    epoch_dir = root / ".dw3-research/epochs" / epoch_id
    if epoch_dir.exists():
        raise ValueError(f"epoch already exists: {epoch_id}")
    catalog = json.loads(catalog_path.read_text())
    frontiers = frontier_map(catalog)
    assignments = []
    for position, frontier_id in enumerate(dict.fromkeys(frontier_ids), 1):
        if frontier_id not in frontiers:
            raise ValueError(f"unknown frontier: {frontier_id}")
        system, frontier = frontiers[frontier_id]
        if frontier.get("status", "open") not in {"open", "needs_evidence"}:
            raise ValueError(f"frontier is not actionable: {frontier_id}")
        assignments.append({
            "frontier_id": frontier_id,
            "system": system,
            "slot": ((position - 1) % 3) + 1,
            "resource": resource,
        })
    if not assignments:
        raise ValueError("an epoch requires at least one frontier")
    epoch = {
        "schema_version": EPOCH_SCHEMA_VERSION,
        "epoch_id": epoch_id,
        "state": "open",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "snapshot": current_snapshot(root, db, ledger, catalog_path),
        "assignments": assignments,
    }
    atomic_json(epoch_dir / "epoch.json", epoch)
    for assignment in assignments:
        packet = {
            "schema_version": PACKET_SCHEMA_VERSION,
            "epoch_id": epoch_id,
            "frontier_id": assignment["frontier_id"],
            "system": assignment["system"],
            "slot": assignment["slot"],
            "resource": assignment["resource"],
            "snapshot": epoch["snapshot"],
            "worker": {"agent_id": "", "agent_type": "", "model": ""},
            "model_selection": {
                "selected_agent": "", "tier": "", "reason": "",
            },
            "proposed_evidence": [],
            "proposed_claims": [],
            "frontier_update": None,
            "limitations": [],
            "commands": [],
        }
        atomic_json(epoch_dir / f"{assignment['frontier_id']}.packet.template.json", packet)
    return epoch_dir, epoch


def packet_paths(epoch_dir: Path) -> list[Path]:
    return sorted(
        path for path in epoch_dir.glob("*.packet.json")
        if not path.name.endswith(".template.json")
    )


def validate_packets(epoch: dict, packets: list[dict], ledger: dict, catalog: dict) -> list[str]:
    errors: list[str] = []
    assignments = {
        item["frontier_id"]: item for item in epoch.get("assignments", [])
    }
    frontiers = frontier_map(catalog)
    known_evidence = {item["id"] for item in ledger.get("evidence", [])}
    known_claims = {item["id"] for item in ledger.get("claims", [])}
    authority_of: dict[str, object] = {
        item["id"]: item.get("authority") for item in ledger.get("evidence", [])
    }
    proposed_evidence: set[str] = set()
    proposed_claims: set[str] = set()
    seen_frontiers: set[str] = set()
    for number, packet in enumerate(packets, 1):
        label = f"packet[{number}]"
        if packet.get("schema_version") != PACKET_SCHEMA_VERSION:
            errors.append(f"{label}: unsupported schema_version")
        if packet.get("epoch_id") != epoch.get("epoch_id"):
            errors.append(f"{label}: epoch mismatch")
        if packet.get("snapshot") != epoch.get("snapshot"):
            errors.append(f"{label}: snapshot mismatch")
        frontier_id = packet.get("frontier_id")
        assignment = assignments.get(frontier_id)
        if assignment is None:
            errors.append(f"{label}: unassigned frontier {frontier_id!r}")
            continue
        if frontier_id in seen_frontiers:
            errors.append(f"{label}: duplicate packet for frontier {frontier_id}")
        seen_frontiers.add(frontier_id)
        if packet.get("system") != assignment["system"]:
            errors.append(f"{label}: system does not match assignment")
        if packet.get("resource") != assignment["resource"]:
            errors.append(f"{label}: resource does not match assignment")
        worker = packet.get("worker") or {}
        if not all(worker.get(key) for key in ("agent_id", "agent_type", "model")):
            errors.append(f"{label}: worker provenance is incomplete")
        selection = packet.get("model_selection") or {}
        selected_agent = selection.get("selected_agent")
        if not all(selection.get(key) for key in ("selected_agent", "tier", "reason")):
            errors.append(f"{label}: model-selection rationale is incomplete")
        elif selected_agent != worker.get("agent_type"):
            errors.append(f"{label}: selected agent does not match worker provenance")
        elif RESEARCH_AGENT_ROUTES.get(selected_agent) != selection.get("tier"):
            errors.append(f"{label}: selected agent does not match model tier")
        elif assignment["resource"] == "rig" and selection.get("tier") != "runtime":
            errors.append(f"{label}: rig work requires the runtime model tier")
        elif assignment["resource"] != "rig" and selection.get("tier") == "runtime":
            errors.append(f"{label}: runtime model tier requires a rig assignment")
        for evidence in packet.get("proposed_evidence", []):
            evidence_id = evidence.get("id")
            required = {
                "id", "kind", "source", "source_sha256", "locator",
                "authority", "summary", "exact",
            }
            if not required <= evidence.keys():
                errors.append(f"{label}: evidence {evidence_id!r} is missing required fields")
                continue
            if evidence_id in known_evidence or evidence_id in proposed_evidence:
                errors.append(f"{label}: duplicate evidence ID {evidence_id}")
            if evidence.get("authority") not in range(1, 7):
                errors.append(f"{label}: invalid evidence authority {evidence_id}")
            source = Path(evidence.get("source", ""))
            source_path = source if source.is_absolute() else root_for_catalog(catalog) / source
            if not source_path.exists():
                errors.append(f"{label}: evidence source does not exist: {source}")
            elif evidence.get("source_sha256") != sha256_file(source_path):
                errors.append(f"{label}: evidence source digest mismatch: {source}")
            elif source_path.suffix.lower() in QUOTABLE_SUFFIXES:
                exact = evidence.get("exact", "")
                # An EMPTY `exact` used to skip the substring test entirely, so a
                # text anchor could be recorded with nothing verifiable in it and
                # still pass. That is the one check standing between the ledger
                # and a fabricated citation, so it may not be opted out of.
                if not str(exact).strip():
                    errors.append(
                        f"{label}: evidence {evidence_id!r} cites the text source {source} "
                        f"with an empty `exact`. Quote one verbatim line from the file. "
                        f"A negative finding still needs a real anchor line plus a `summary` "
                        f"saying what was searched and with which matcher."
                    )
                elif exact not in source_path.read_text(errors="replace"):
                    errors.append(f"{label}: exact evidence is absent from source: {source}")
            proposed_evidence.add(evidence_id)
            authority_of[evidence_id] = evidence.get("authority")
        for claim in packet.get("proposed_claims", []):
            claim_id = claim.get("id")
            if claim_id in known_claims or claim_id in proposed_claims:
                errors.append(f"{label}: duplicate claim ID {claim_id}")
            if claim.get("system") != assignment["system"]:
                errors.append(f"{label}: claim {claim_id} has wrong system")
            if claim.get("status") not in CLAIM_STATUSES:
                errors.append(f"{label}: claim {claim_id} has invalid packet status")
            evidence_ids = claim.get("evidence", [])
            if claim.get("status") != "unresearched" and not evidence_ids:
                errors.append(f"{label}: claim {claim_id} requires evidence")
            if not set(evidence_ids) <= known_evidence | proposed_evidence:
                errors.append(f"{label}: claim {claim_id} references unknown evidence")
            if frontier_id not in claim.get("frontier_ids", []):
                errors.append(f"{label}: claim {claim_id} must reference {frontier_id}")
            statement = str(claim.get("statement") or "").strip()
            if not statement:
                # An absent `statement` also crashes claim_review_bundle, which
                # subscripts it directly, so this reached the review gate as a
                # KeyError rather than a validation error.
                errors.append(
                    f"{label}: claim {claim_id} has no `statement`. State the finding in "
                    f"prose; the id is not the claim."
                )
            elif claim.get("status") != "unresearched":
                quantifiers = sorted({
                    word.lower() for word in QUANTIFIER.findall(statement)
                })
                coverage = str(claim.get("coverage") or "").strip()
                if quantifiers and not coverage:
                    errors.append(
                        f"{label}: claim {claim_id} makes a universal statement "
                        f"({', '.join(quantifiers)}) but has no `coverage` field. "
                        f"State how the quantifier was TESTED, not what it asserts: the "
                        f"enumeration that was exhausted, the denominator searched, or the "
                        f"independent check that would have found a counterexample. If it "
                        f"was not tested, narrow the statement to the cases actually read."
                    )
                elif quantifiers and not [
                    command for command in packet.get("commands", [])
                    if isinstance(command, dict) and str(command.get("command", "")).strip()
                ]:
                    # Prose is unfalsifiable on its own. A universal that was
                    # really tested was tested by running something, so the
                    # packet has to name it. This cannot tell a genuine coverage
                    # test from a restatement -- only the reviewer can, and the
                    # review bundle now shows `coverage` so it can -- but it does
                    # stop a bare assertion from being dressed up as one.
                    errors.append(
                        f"{label}: claim {claim_id} makes a universal statement "
                        f"({', '.join(quantifiers)}) and declares `coverage`, but the packet "
                        f"records no commands. Name the command whose output tested the "
                        f"quantifier, with its result."
                    )
            if claim.get("status") in {"partially_verified", "verified"}:
                authorities = [
                    authority_of.get(evidence_id)
                    for evidence_id in evidence_ids
                    if isinstance(authority_of.get(evidence_id), int)
                ]
                if authorities and min(authorities) > PRIMARY_AUTHORITY:
                    errors.append(
                        f"{label}: claim {claim_id} is {claim.get('status')} but its strongest "
                        f"evidence is authority {min(authorities)} (research/browser). Those are "
                        f"navigation aids, never proof of original behaviour. Cite runtime, "
                        f"assembly, checked decompilation or checked extraction, or record it "
                        f"as `candidate`."
                    )
            if claim.get("status") == "contradicted" and not (
                claim.get("superseded_by") or claim.get("contradiction_rationale")
            ):
                errors.append(f"{label}: contradicted claim {claim_id} needs supersession or rationale")
            # A bare string passes the truthiness test above and then gets iterated
            # character-by-character downstream, so completion-check reports one
            # "unknown superseding claim" per LETTER. Two packets have shipped this.
            if isinstance(claim.get("superseded_by"), str):
                errors.append(
                    f"{label}: claim {claim_id} superseded_by must be a LIST of claim ids, "
                    f"not the bare string {claim['superseded_by']!r}"
                )
            proposed_claims.add(claim_id)
        update = packet.get("frontier_update")
        if update:
            if update.get("status") not in FRONTIER_STATUSES:
                errors.append(f"{label}: invalid frontier update status")
            if update.get("status") == "blocked" and not update.get("blocked_reason"):
                errors.append(f"{label}: blocked frontier requires blocked_reason")
            if update.get("status") == "resolved" and not update.get("resolution_claims"):
                errors.append(f"{label}: resolved frontier requires resolution_claims")
            if frontier_id not in frontiers:
                errors.append(f"{label}: frontier no longer exists")
        if not isinstance(packet.get("commands", []), list):
            errors.append(f"{label}: commands must be a list")
        else:
            for command in packet.get("commands", []):
                if not isinstance(command, dict) or not {
                    "command", "exit_code", "result"
                } <= command.keys():
                    errors.append(f"{label}: every command needs command, exit_code, and result")
        if not isinstance(packet.get("limitations", []), list):
            errors.append(f"{label}: limitations must be a list")
    return errors


CONTEXT_ADDRESS = re.compile(r"\bF?0x[0-9a-fA-F]{7,8}\b")
CONTEXT_OPCODE = re.compile(
    r"\bopcodes?\s+0x[0-9a-fA-F]{1,2}\b(?:\s*(?:,|and|\.\.|to)\s*0x[0-9a-fA-F]{1,2}\b)*",
    re.IGNORECASE,
)
SUMMARY_LITERAL = re.compile(r"0x([0-9a-fA-F]{1,8})")


def summary_literal_warnings(packets: list[dict]) -> list[str]:
    """Flag evidence whose summary names a hex value absent from the line it quotes.

    This is the miscitation check. On 2026-08-09 two evidence entries pointed at
    the wrong instruction -- each off by one -- claiming "opcode 0x38 passes mask
    0x81" while quoting the ZONE line `li $a3, 0x2`. Nothing in the validator
    noticed, because the quote was a real line from the right file; only the
    summary was false about it. Replayed against this check, both are flagged.

    ADVISORY, NOT A GATE, and deliberately so. Measured over the 802 assembly
    anchors already in the ledger it flags about one in five, and most of those
    are legitimate: a summary that says the count sits at block `+0x08` while the
    instruction encodes the duel-relative `0x5a4` is correct and unmatchable
    without understanding the struct. Function addresses and "opcode 0xNN"
    phrases are stripped first, since those name context rather than the line.
    Making it blocking would only breed per-entry opt-outs, which is worse than
    a short list somebody reads.
    """
    warnings: list[str] = []
    for number, packet in enumerate(packets, 1):
        for evidence in packet.get("proposed_evidence", []):
            exact = str(evidence.get("exact", ""))
            if not exact.strip() or not str(evidence.get("source", "")).endswith(".s"):
                continue
            summary = CONTEXT_OPCODE.sub(" ", str(evidence.get("summary", "")))
            summary = CONTEXT_ADDRESS.sub(" ", summary)
            literals = {found.lower() for found in SUMMARY_LITERAL.findall(summary)}
            if not literals:
                continue
            lowered = exact.lower()
            if any(f"0x{item}" in lowered or (len(item) > 1 and item in lowered)
                   for item in literals):
                continue
            warnings.append(
                f"packet[{number}]: evidence {evidence.get('id')} names "
                f"{', '.join('0x' + item for item in sorted(literals))} but its quoted line "
                f"does not contain it -- confirm the locator points at the right "
                f"instruction: {exact.strip()[:70]}"
            )
    return warnings


def root_for_catalog(catalog: dict) -> Path:
    """Resolve repository root supplied internally by the integration caller."""
    marker = catalog.get("_repository_root")
    return Path(marker) if marker else Path.cwd()


def apply_packets(epoch: dict, packets: list[dict], ledger: dict, catalog: dict) -> tuple[dict, dict]:
    evidence = ledger.setdefault("evidence", [])
    claims = ledger.setdefault("claims", [])
    frontiers = frontier_map(catalog)
    for packet in packets:
        evidence.extend(packet.get("proposed_evidence", []))
        # The packet's limitations and the commands that produced it used to be
        # validated and then thrown away, so the ledger kept the conclusion and
        # dropped every caveat attached to it. A reader of `system-status` then
        # saw an unqualified assertion. Carry both onto each claim the packet
        # records, without overwriting a claim that scoped itself.
        limitations = [
            item for item in packet.get("limitations", []) if str(item).strip()
        ]
        derivation = [
            command.get("command")
            for command in packet.get("commands", [])
            if isinstance(command, dict) and command.get("command")
        ]
        for claim in packet.get("proposed_claims", []):
            if limitations and not claim.get("limitations"):
                claim["limitations"] = limitations
            if derivation and not claim.get("derivation"):
                claim["derivation"] = derivation
        claims.extend(packet.get("proposed_claims", []))
        update = packet.get("frontier_update")
        if update:
            frontier = frontiers[packet["frontier_id"]][1]
            for key in ("status", "assignee", "blocked_reason", "resolution_claims"):
                if key in update:
                    frontier[key] = update[key]
    ledger["evidence"] = sorted(evidence, key=lambda item: item["id"])
    ledger["claims"] = sorted(claims, key=lambda item: item["id"])
    catalog.pop("_repository_root", None)
    return ledger, catalog


def write_journal(path: Path, epoch_path: Path, ledger: dict, catalog: dict) -> None:
    atomic_json(path, {
        "schema_version": 1,
        "epoch_path": str(epoch_path),
        "ledger": ledger,
        "catalog": catalog,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


def clear_journal(path: Path) -> None:
    path.unlink(missing_ok=True)
    directory_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
