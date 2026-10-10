"""Self-contained evidence bundles for review and for reasoning over names.

A bundle is everything needed to judge one candidate or one cluster without
opening the corpus by hand: module-qualified identity, the recovered C, the
exact assembly range, callers, callees, globals, pointer slots, constants,
structure accesses, the family comparison, research citations and
contradictions. Rules can settle getters and wrappers; a name like
`launchEncounter` needs a reader, and this is what the reader is given.
"""

from __future__ import annotations

from itertools import islice
from pathlib import Path

MAX_ASSEMBLY_LINES = 400
MAX_BODY_CHARS = 6000


def _resolve(source: str) -> Path:
    return Path(source.replace("~", str(Path.home()), 1)) if source.startswith("~") else Path(source)


def assembly_slice(fn, limit: int = MAX_ASSEMBLY_LINES) -> dict:
    """Read only this function's own line range from the original assembly."""
    path = _resolve(fn.source)
    if not fn.source_line or not path.is_file():
        return {"available": False, "reason": "no source line recorded or source unavailable"}
    start = fn.source_line
    try:
        with path.open(errors="replace") as handle:
            lines = list(islice(handle, start - 1, start - 1 + limit))
    except OSError as error:
        return {"available": False, "reason": str(error)}
    end_marker = f"0x{fn.end_address:08x}" if fn.end_address else None
    kept: list[str] = []
    for line in lines:
        kept.append(line.rstrip("\n"))
        if end_marker and end_marker in line and len(kept) > 1:
            break
    return {
        "available": True,
        "source": fn.source,
        "first_line": start,
        "last_line": start + len(kept) - 1,
        "truncated": len(kept) >= limit,
        "text": "\n".join(kept),
    }


def _callees(corpus, fn) -> list[dict]:
    seen: dict[str, dict] = {}
    for call in fn.direct_calls:
        target = call.get("target_id")
        entry = seen.setdefault(target or call.get("target_address", "?"), {
            "target": target,
            "target_address": call.get("target_address"),
            "kind": "direct",
            "resolution": call.get("resolution"),
            "callsites": [],
            "name": corpus.functions[target].curated_name if target in corpus.functions else None,
        })
        entry["callsites"].append(call.get("callsite"))
    for call in fn.indirect_calls:
        key = call.get("target_id") or call.get("global_address") or call.get("callsite")
        entry = seen.setdefault(key, {
            "target": call.get("target_id"),
            "kind": "indirect",
            "classification": call.get("classification"),
            "global_address": call.get("global_address"),
            "slot_offset": call.get("slot_offset"),
            "callsites": [],
            "name": None,
        })
        entry["callsites"].append(call.get("callsite"))
    return list(seen.values())


def _pointer_slots(corpus, fn) -> list[dict]:
    slots = []
    for symbol, annotation in corpus.global_function_pointers.items():
        if annotation.get("target") == fn.id:
            slots.append({
                "symbol": symbol, "kind": "global_function_pointer",
                "name": annotation.get("name"),
                "basis": annotation.get("resolution_basis"),
            })
    for symbol, entries in corpus.overlay_function_pointers.items():
        for entry in entries:
            if entry.get("target") == fn.id:
                slots.append({
                    "symbol": symbol, "kind": "overlay_function_pointer",
                    "basis": entry.get("resolution_basis"),
                    "owner_module": entry.get("owner_module"),
                })
    return slots


def function_bundle(corpus, fn, candidate, families, family_by_member, research_links,
                    *, with_assembly: bool = True) -> dict:
    features = fn.features
    family_view = []
    for family_id in family_by_member.get(fn.id, []):
        family = families[family_id]
        family_view.append({
            "family": family_id,
            "tier": family.tier,
            "member_count": family.member_count,
            "modules": family.modules,
            "representative": family.representative,
            "can_carry_name": family.can_carry_name,
            "this_member_parameters": family.parameters.get(fn.id),
            "representative_parameters": family.parameters.get(family.representative),
            "members": family.members[:40],
        })
    body = fn.body_text or ""
    return {
        "id": fn.id,
        "module": fn.module,
        "module_source": fn.source,
        "module_source_sha256": corpus.modules[fn.module]["source_sha256"],
        "load_base": corpus.modules[fn.module]["load_base"],
        "address": fn.address_hex,
        "provisional_end_address": f"0x{fn.end_address:08x}" if fn.end_address else None,
        "boundary_status": fn.boundary_status,
        "entry_evidence": list(fn.entry_evidence),
        "lift": candidate["lift"],
        "proposed_name": candidate["proposed_name"],
        "signature": candidate["signature"],
        "role": candidate["role"],
        "confidence": candidate["confidence"],
        "recovered_c": body[:MAX_BODY_CHARS] + ("\n/* ...truncated... */" if len(body) > MAX_BODY_CHARS else ""),
        "recovered_c_path": fn.body_path.as_posix() if fn.body_path else None,
        "assembly": assembly_slice(fn) if with_assembly else {"available": False, "reason": "omitted"},
        "callers": sorted(corpus.callers.get(fn.id, set())),
        "caller_names": {
            caller: corpus.functions[caller].curated_name
            for caller in sorted(corpus.callers.get(fn.id, set()))
            if corpus.functions[caller].curated_name
        },
        "callees": _callees(corpus, fn),
        "globals": features.globals if features else [],
        "global_types": features.externs if features else {},
        "pointer_slots": _pointer_slots(corpus, fn),
        "constants": sorted(set(features.constants))[:60] if features else [],
        "strings": features.strings[:20] if features else [],
        "structure_accesses": [
            {"base": a.base, "offset": f"0x{a.offset:02x}", "access": "write" if a.write else "read"}
            for a in (features.accesses if features else [])
        ][:80],
        "structure_fields": candidate["structure_fields"],
        "family_comparison": family_view,
        "research_citations": research_links.get(fn.id, []),
        "contradictions": candidate["contradictions"],
        "unknowns": candidate["unknowns"],
        "evidence": candidate["evidence"],
    }


def cluster_bundle(corpus, family, candidates, families, family_by_member, research_links,
                   *, sample: int = 3) -> dict:
    """A bundle for a whole family: the representative in full, peers in brief."""
    members = family.members
    representative = family.representative
    detail_ids = [representative] + [m for m in members if m != representative][:sample - 1]
    return {
        "cluster": family.id,
        "tier": family.tier,
        "member_count": family.member_count,
        "modules": family.modules,
        "statements": family.statements,
        "can_carry_name": family.can_carry_name,
        "representative": representative,
        "curated_members": sorted(set(members) & corpus.curated_ids()),
        "question": (
            "Name and summarise this family. Rules established its shape and "
            "membership; the behavioural name is not mechanically derivable."
        ),
        "detailed_members": [
            function_bundle(
                corpus, corpus.functions[fid], candidates[fid],
                families, family_by_member, research_links,
                with_assembly=(fid == representative),
            )
            for fid in detail_ids if fid in candidates
        ],
        "other_members": [
            {
                "id": fid,
                "module": fid.split(":")[0],
                "proposed_name": candidates[fid]["proposed_name"] if fid in candidates else None,
                "parameters": family.parameters.get(fid),
                "callers": len(corpus.callers.get(fid, set())),
            }
            for fid in members if fid not in detail_ids
        ],
        "parameter_variation": _parameter_variation(family),
    }


def _parameter_variation(family) -> dict:
    """What actually differs between members of a parameterized family."""
    if not family.parameters:
        return {}
    keys = ("constants", "globals", "callees")
    variation: dict[str, dict] = {}
    for key in keys:
        values = {fid: tuple(spec.get(key) or ()) for fid, spec in family.parameters.items()}
        distinct = set(values.values())
        variation[key] = {
            "distinct_values": len(distinct),
            "varies": len(distinct) > 1,
            "by_member": {fid: list(value) for fid, value in sorted(values.items())} if len(distinct) > 1 else {},
        }
    return variation
