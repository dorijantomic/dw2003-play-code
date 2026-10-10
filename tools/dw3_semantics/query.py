"""Compact queries over semantic-candidates.json.

`semantic-candidates.json` is ~6 MB. Reading it into a conversation costs more
than a million tokens and is never the right move. Every command here loads it
in-process and prints a few lines of plain text, so the cost of an answer is the
answer, not the corpus.

Plain text, not JSON, on purpose: JSON re-serialises keys on every row.
"""

from __future__ import annotations

import json
from pathlib import Path

MAX_ROWS = 40


def load(path: Path) -> dict:
    return json.loads(path.read_text())


def _row(candidate) -> str:
    name = candidate["proposed_name"] or "-"
    return (
        f"{candidate['id']:38s} {str(candidate['role'] or '-'):16s} "
        f"c={candidate['confidence']:.2f} n={candidate['callers']:<3d} "
        f"{candidate['lift'][:22]:22s} {name[:44]}"
    )


def stats(document: dict) -> str:
    lines = ["summary:"]
    lines += [f"  {k:34s} {v}" for k, v in document["summary"].items()]
    lines.append("roles:")
    lines += [f"  {k:34s} {v}" for k, v in document["roles"].items()]
    lines.append("lift:")
    lines += [f"  {k:34s} {v}" for k, v in document["lift"].items()]
    lines.append("name_basis:")
    lines += [f"  {k:34s} {v}" for k, v in document["name_basis"].items()]
    return "\n".join(lines)


def listing(document: dict, *, role=None, lift=None, module=None, basis=None,
            min_callers=0, named=None, sort="callers", limit=MAX_ROWS) -> str:
    rows = []
    for candidate in document["candidates"].values():
        if role and candidate["role"] != role:
            continue
        if lift and candidate["lift"] != lift:
            continue
        if module and not candidate["module"].startswith(module):
            continue
        if basis and candidate["name_basis"] != basis:
            continue
        if candidate["callers"] < min_callers:
            continue
        if named is True and not candidate["proposed_name"]:
            continue
        if named is False and candidate["proposed_name"]:
            continue
        rows.append(candidate)
    keys = {
        "callers": lambda c: (-c["callers"], c["id"]),
        "confidence": lambda c: (-c["confidence"], c["id"]),
        "id": lambda c: c["id"],
    }
    rows.sort(key=keys.get(sort, keys["callers"]))
    head = [f"matched {len(rows)}, showing {min(limit, len(rows))}"]
    return "\n".join(head + [_row(c) for c in rows[:limit]])


def show(document: dict, ids: list[str], *, evidence: int = 6) -> str:
    out = []
    for fid in ids:
        candidate = document["candidates"].get(fid)
        if candidate is None:
            out.append(f"{fid}: not in candidates")
            continue
        out += [
            f"== {candidate['id']}  ({candidate['address']}, {candidate['module']})",
            f"   name       {candidate['proposed_name'] or '-'}  [{candidate['name_basis']}]",
            f"   signature  {candidate['signature']}",
            f"   role       {candidate['role'] or '-'}   confidence {candidate['confidence']}",
            f"   lift       {candidate['lift']}   callers {candidate['callers']}",
            f"   families   {', '.join(candidate['families']) or '-'}",
            f"   summary    {candidate['summary']}",
        ]
        if candidate["structure_fields"]:
            out.append(f"   struct     {', '.join(candidate['structure_fields'][:8])}")
        if candidate["contradictions"]:
            out += [f"   CONTRA     {item}" for item in candidate["contradictions"]]
        out += [f"   evidence   {item}" for item in candidate["evidence"][:evidence]]
        out += [f"   unknown    {item}" for item in candidate["unknowns"][:4]]
        out.append(f"   provenance {' -> '.join(candidate['provenance']['path'])}")
    return "\n".join(out)


def families(document: dict, *, tier=None, unnamed_only=False, limit=MAX_ROWS) -> str:
    candidates = document["candidates"]
    rows = []
    for family in document["families"]:
        if tier and family["tier"] != tier:
            continue
        named = [
            candidates[m]["proposed_name"] for m in family["members"]
            if m in candidates and candidates[m]["name_basis"] == "curated"
        ]
        if unnamed_only and named:
            continue
        fan_in = sum(candidates[m]["callers"] for m in family["members"] if m in candidates)
        rows.append((fan_in, family, named))
    rows.sort(key=lambda item: (-item[0], item[1]["id"]))
    head = [f"matched {len(rows)} families, showing {min(limit, len(rows))}"]
    lines = []
    for fan_in, family, named in rows[:limit]:
        lines.append(
            f"{family['id']:22s} {family['tier']:14s} m={len(family['members']):<3d} "
            f"mod={len(family['modules']):<2d} fan_in={fan_in:<4d} "
            f"carry={'y' if family['can_carry_name'] else 'n'} "
            f"{'named:' + named[0][:30] if named else 'UNNAMED'}",
        )
    return "\n".join(head + lines)


def family_detail(document: dict, ids: list[str], *, limit: int = MAX_ROWS) -> str:
    candidates = document["candidates"]
    by_id = {family["id"]: family for family in document["families"]}
    out = []
    for fam_id in ids:
        family = by_id.get(fam_id)
        if family is None:
            out.append(f"{fam_id}: not a family id")
            continue
        fan_in = sum(candidates[m]["callers"] for m in family["members"] if m in candidates)
        out += [
            f"== {family['id']}  tier={family['tier']}  members={len(family['members'])}"
            f"  modules={len(family['modules'])}  fan_in={fan_in}"
            f"  carry={'y' if family['can_carry_name'] else 'n'}",
            f"   representative {family['representative']}",
            f"   modules        {', '.join(sorted(family['modules']))}",
        ]
        out.append(f"   statements     {family.get('statements')}")
        parameters = family.get("parameters") or []
        if isinstance(parameters, dict):
            parameters = [f"{k}={v}" for k, v in parameters.items()]
        for parameter in list(parameters)[:8]:
            out.append(f"   parameter      {parameter}")
        members = sorted(
            (candidates[m] for m in family["members"] if m in candidates),
            key=lambda c: (-c["callers"], c["id"]),
        )
        for candidate in members[:limit]:
            out.append(
                f"   {candidate['id']:34s} {candidate['address']:12s} "
                f"{candidate['module'][:20]:20s} n={candidate['callers']:<3d} "
                f"{str(candidate['role'] or '-'):14s} {(candidate['proposed_name'] or '-')[:28]}",
            )
            out.append(f"       {candidate['summary'][:150]}")
    return "\n".join(out)


def flags(document: dict, *, limit: int = 15) -> str:
    quality = document["quality_flags"]
    lines = [
        f"rejected_phantom_entries  {len(quality['rejected_phantom_entries'])}",
        f"address_collisions        {len(quality['address_collisions'])}",
        f"weak_single_clue_names    {document['summary']['weak_single_clue_names']}",
        f"with_contradictions       {document['summary']['with_contradictions']}",
        "quarantine:",
    ]
    lines += [f"  {k:38s} {v}" for k, v in quality["quarantine"].items()]
    lines.append("rejected entries (false boundaries removed):")
    for entry in quality["rejected_phantom_entries"][:limit]:
        lines.append(f"  {entry['id']:34s} prev {entry['preceding_instruction']}")
    lines.append("largest address collisions:")
    for collision in sorted(
        quality["address_collisions"], key=lambda c: -c["function_count"],
    )[:limit]:
        lines.append(
            f"  {collision['address']} x{collision['function_count']:<4d} "
            f"{len(collision['modules'])} modules",
        )
    return "\n".join(lines)


def work_queue(document: dict, *, limit: int = 20) -> str:
    """Highest-value unnamed work, ranked by how much each answer explains.

    A cluster is worth more than a lone function because naming it settles every
    member at once, so clusters are ranked by total caller fan-in across members
    and singletons only compete once clusters run out.
    """
    candidates = document["candidates"]
    rows = []
    for family in document["families"]:
        if not family["can_carry_name"]:
            continue
        members = [m for m in family["members"] if m in candidates]
        if any(candidates[m]["name_basis"] == "curated" for m in members):
            continue
        fan_in = sum(candidates[m]["callers"] for m in members)
        rows.append((fan_in * len(members), "cluster", family["id"],
                     f"{len(members)} members, fan_in {fan_in}"))
    for candidate in candidates.values():
        if candidate["proposed_name"] or candidate["lift"] != "decompiled_c_complete":
            continue
        if candidate["families"]:
            continue
        rows.append((candidate["callers"], "function", candidate["id"],
                     f"role {candidate['role'] or '-'}, {candidate['callers']} callers"))
    rows.sort(key=lambda item: (-item[0], item[2]))
    lines = [f"top {min(limit, len(rows))} of {len(rows)} unnamed targets, "
             "highest explanatory value first"]
    for score, kind, ident, detail in rows[:limit]:
        lines.append(f"  {score:<6d} {kind:8s} {ident:24s} {detail}")
    lines.append("next: bundle --function <id>, or read "
                 "recovered/ddw3/semantic-bundles/<cluster>.json for a cluster")
    return "\n".join(lines)
