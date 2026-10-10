"""The inference pipeline: features, families, roles, signatures, propagation."""

from __future__ import annotations

from dataclasses import asdict

from . import RULE_VERSION
from . import cbody, families as families_mod, propagate as propagate_mod, research, roles, signatures


def _lift_status(fn) -> str:
    if not fn.has_body:
        return "no_lift"
    features = fn.features
    if features is None or not features.parsed:
        return "no_lift"
    if features.empty:
        return "empty_body_requires_triage"
    if features.incomplete:
        return "decompiled_c_incomplete"
    return "decompiled_c_complete"


def _mechanical_name(fn, verdict, corpus) -> str | None:
    module = fn.module.split("/")[-1]
    suffix = f"{module}_{fn.address:08x}"
    if verdict.role == "getter":
        return f"get_unk_0x{verdict.detail['offset']:02x}_{suffix}"
    if verdict.role == "setter":
        return f"set_unk_0x{verdict.detail['offset']:02x}_{suffix}"
    if verdict.role == "wrapper":
        # A thunk means whatever its callee means. When the callee already has a
        # name, inherit it; otherwise the address is all that is established.
        callee_name = _callee_name(fn, verdict.detail["callee"], corpus)
        if callee_name:
            return f"{callee_name}_thunk_{suffix}"
        return f"forward_to_{verdict.detail['callee']}_{suffix}"
    return None


def _callee_name(fn, callee_token: str, corpus) -> str | None:
    """Resolve `F0xADDR` from the body to a named function via the call edge.

    Resolution goes through the inventory's own edge, never by assuming the
    address belongs to this module -- overlays share load bases.
    """
    address = callee_token[1:].lower()
    for call in fn.direct_calls:
        target_address = (call.get("target_address") or "").lower()
        if target_address.replace("0x", "") != address.replace("0x", ""):
            continue
        target = call.get("target_id")
        if target and target in corpus.functions:
            return corpus.functions[target].curated_name
    return None


def _summary(fn, verdicts, signature, lift) -> str:
    if lift == "no_lift":
        return ("No successful decompilation exists for this address, so no behavior is "
                "inferred. Only its identity, boundary and call edges are established.")
    if lift == "empty_body_requires_triage":
        return ("The decompiled body is empty. That is either a genuine two-instruction "
                "stub or a false boundary, and the C text cannot distinguish them.")
    if not verdicts:
        return ("No structural rule matched. The body is available for review but its "
                "purpose is not mechanically derivable.")
    top = verdicts[0]
    parts = {
        "getter": f"Reads slot +0x{top.detail.get('offset', 0):02x} of its receiver and returns it.",
        "setter": f"Stores its second argument into slot +0x{top.detail.get('offset', 0):02x} of its receiver.",
        "wrapper": f"Forwards its arguments to {top.detail.get('callee')} and does nothing else.",
        "constructor": "Allocates through a shared object factory and initialises the result's slots.",
        "destructor": f"Clears slots {', '.join(hex(o) for o in top.detail.get('cleared', []))} of its receiver.",
        "state_transition": f"Writes the literal {top.detail.get('value')} into slot +0x{top.detail.get('offset', 0):02x}, a state assignment.",
        "dispatcher": "Selects between several actions, so it is the entry point of a command or state machine.",
        "table_lookup": f"Indexes {top.detail.get('table')} and returns the selected element.",
        "poller": "Tests receiver state and answers yes or no, so callers use it as a readiness check.",
    }
    summary = parts.get(top.role, f"Classified as {top.role}.")
    extra = [v.role for v in verdicts[1:]]
    if extra:
        summary += f" Also matched {', '.join(extra)}."
    return summary


def run(corpus, *, with_research: bool = True) -> dict:
    for fn in corpus.functions.values():
        if fn.body_text is not None:
            fn.features = cbody.extract(fn.body_text, f"F0x{fn.address:08x}")

    families, quarantine = families_mod.build_families(corpus)
    family_by_member = families_mod.family_index(families)

    role_results: dict[str, tuple[list, list[str]]] = {}
    mechanical: dict[str, object] = {}
    for fn in corpus.functions.values():
        verdicts, contradictions = roles.classify(fn, corpus)
        role_results[fn.id] = (verdicts, contradictions)
        for verdict in verdicts:
            if verdict.mechanical and fn.features and fn.features.complete:
                mechanical[fn.id] = verdict
                break

    research_links = research.collect(corpus) if with_research else {}
    propagated = propagate_mod.propagate(
        corpus, families, family_by_member, mechanical,
        research.naming_usable(research_links),
    )

    candidates: dict[str, dict] = {}
    for fn in corpus.functions.values():
        verdicts, contradictions = role_results[fn.id]
        lift = _lift_status(fn)
        family = None
        for family_id in family_by_member.get(fn.id, []):
            candidate_family = families[family_id]
            if candidate_family.can_carry_name:
                family = candidate_family
                break
        signature = signatures.infer(fn, fn.features, verdicts, family)
        hop = propagated.get(fn.id)

        name = None
        basis = "none"
        confidence = 0.0
        evidence: list[str] = []
        mechanically_established = False

        if fn.curated_name:
            name, basis, confidence = fn.curated_name, "curated", 1.0
            evidence.append("curated annotation in recovered/ddw3/semantics.json")
        elif lift in ("no_lift", "empty_body_requires_triage"):
            basis = lift
        else:
            if fn.id in mechanical:
                verdict = mechanical[fn.id]
                name = _mechanical_name(fn, verdict, corpus)
                if name:
                    basis = "mechanical_role"
                    confidence = verdict.confidence
                    mechanically_established = True
                    evidence.extend(verdict.evidence)
            if hop is not None and hop.name and (name is None or hop.confidence > confidence):
                name, basis, confidence = hop.name, f"propagated_{hop.origin_kind}", hop.confidence
                mechanically_established = (
                    hop.origin_kind == "curated"
                    and family is not None
                    and family.tier == "exact"
                )
                evidence.extend(hop.evidence)
            elif hop is not None:
                evidence.extend(hop.evidence)
                confidence = max(confidence, 0.0)

        if name:
            # Keep the rendered signature consistent with the name finally
            # chosen; `signatures.infer` runs before naming is resolved.
            signature.text = signature.text.replace(
                signatures._provisional_name(fn), name, 1)

        for verdict in verdicts:
            evidence.extend(f"[{verdict.evidence_class}] {item}" for item in verdict.evidence)
        for citation in research_links.get(fn.id, [])[:5]:
            evidence.append(
                f"[research] {citation['document']}:{citation['line']} ({citation['basis']})",
            )

        if not verdicts and confidence == 0.0 and lift == "decompiled_c_complete":
            confidence = 0.0

        role = verdicts[0].role if verdicts else None
        if verdicts and confidence == 0.0:
            confidence = verdicts[0].confidence * 0.6

        unknowns = list(signature.unknowns)
        if lift == "no_lift":
            unknowns.append("no successful decompilation; nothing beyond identity is established")
        if lift == "empty_body_requires_triage":
            unknowns.append("empty body: genuine stub or false boundary, undetermined")
        if not fn.strong_entry_evidence:
            unknowns.append("entry point rests on decompiler output alone; boundary is provisional")
        if any(c["basis"] == "module_ambiguous" for c in research_links.get(fn.id, [])):
            unknowns.append("research citations at this address do not name a module; "
                            "the overlay sharing this load base cannot be distinguished")

        candidates[fn.id] = {
            "id": fn.id,
            "module": fn.module,
            "address": fn.address_hex,
            "proposed_name": name,
            "name_basis": basis,
            "signature": signature.text,
            "return_type": signature.return_type,
            "parameters": [{"name": n, "type": t} for n, t in signature.params],
            "structure_fields": signature.structure_fields,
            "structures": signature.structs,
            "summary": _summary(fn, verdicts, signature, lift),
            "role": role,
            "roles": [
                {"role": v.role, "confidence": round(v.confidence, 3),
                 "evidence_class": v.evidence_class, "mechanical": v.mechanical}
                for v in verdicts
            ],
            "lift": lift,
            "confidence": round(min(confidence, 1.0), 3),
            "confidence_basis": basis,
            "mechanically_established": mechanically_established,
            "evidence": evidence,
            "evidence_classes": sorted(
                {v.evidence_class for v in verdicts}
                | (set(hop.evidence_classes) if hop else set()),
            ),
            "provenance": {
                "origin": hop.origin if hop else (fn.id if basis == "curated" else None),
                "origin_kind": hop.origin_kind if hop else basis,
                "path": hop.path if hop else [fn.id],
                "hops": (len(hop.path) - 1) if hop else 0,
            },
            "families": family_by_member.get(fn.id, []),
            "contradictions": contradictions,
            "unknowns": unknowns,
            "entry_evidence": list(fn.entry_evidence),
            "callers": len(corpus.callers.get(fn.id, set())),
            "generated_by": "tools/infer_recovered_semantics.py",
            "rule_version": RULE_VERSION,
            "evidence_paths": sorted({
                *(fn.decompiled_sources or ()),
                fn.source,
            }),
        }

    return {
        "candidates": candidates,
        "families": families,
        "family_by_member": family_by_member,
        "quarantine": quarantine,
        "research_links": research_links,
        "propagated": propagated,
        "mechanical": mechanical,
    }


def detect_collisions(corpus) -> list[dict]:
    """Addresses claimed by more than one module (shared overlay load bases)."""
    by_address: dict[int, list[str]] = {}
    for fn in corpus.functions.values():
        by_address.setdefault(fn.address, []).append(fn.id)
    collisions = []
    for address, ids in sorted(by_address.items()):
        if len(ids) < 2:
            continue
        collisions.append({
            "address": f"0x{address:08x}",
            "function_count": len(ids),
            "modules": sorted({fid.split(":")[0] for fid in ids}),
            "rule": "names and research citations must never be shared across these "
                    "without module-qualified evidence",
        })
    return collisions
