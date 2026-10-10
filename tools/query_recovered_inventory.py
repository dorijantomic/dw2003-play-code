#!/usr/bin/env python3
"""Compact queries over the generated DDW3 recovered-function inventory."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path


DEFAULT_INVENTORY = Path("recovered/ddw3/function-inventory.json")


def load(path: Path) -> dict[str, object]:
    return json.loads(path.read_text())


def functions(inventory: dict[str, object]):
    for module in inventory["modules"]:
        for function in module["functions"]:
            yield module, function


def compact_function(module: dict[str, object], function: dict[str, object]) -> dict[str, object]:
    return {
        "id": function["id"],
        "name": function["semantic_name"] or function["original_name"],
        "module": module["id"],
        "source": module["source"],
        "line": function["source_line"],
        "address": function["address"],
        "boundary_status": function["boundary_status"],
        "recovery": function["recovery"],
        "semantic_family": function.get("semantic_family"),
    }


def command_summary(inventory: dict[str, object]) -> dict[str, object]:
    recovery = {
        key: Counter()
        for key in ("lift", "structure", "semantics", "verification", "implementation")
    }
    for _, function in functions(inventory):
        for key, counter in recovery.items():
            counter[function["recovery"][key]] += 1
    return {
        "inventory": inventory["summary"],
        "recovery": {key: dict(sorted(value.items())) for key, value in recovery.items()},
    }


def command_translation_coverage(inventory: dict, registry: list[dict]) -> dict:
    """Join exact module/entry identities without mistaking missing joins for gaps."""
    def address(value):
        return int(value, 0) if isinstance(value, str) else int(value)

    registered = {(row["module"], address(row["address"])) for row in registry}
    inventoried = set()
    rows = []
    for module in inventory["modules"]:
        entries = {(module["id"], address(fn["address"])) for fn in module["functions"]}
        inventoried.update(entries)
        ports = {key for key in registered if key[0] == module["id"]}
        rows.append({
            "module": module["id"], "inventory_entries": len(entries),
            "registered_entries": len(ports), "exact_joins": len(entries & ports),
            "inventory_without_registry_join": len(entries - ports),
            "registry_without_inventory_join": len(ports - entries),
        })
    return {
        "scope": "Exact module/address join of existing registers; not a gameplay or understanding percentage. Missing joins can be existing unregistered implementations, case arms, family aliases, or inventory boundary gaps.",
        "inventory_entries": len(inventoried), "registered_entries": len(registered),
        "exact_joins": len(inventoried & registered),
        "inventory_without_registry_join": len(inventoried - registered),
        "registry_without_inventory_join": len(registered - inventoried),
        "modules": rows,
        "unjoined_registry": [row for row in registry if (row["module"], address(row["address"])) not in inventoried],
    }


def find(inventory: dict[str, object], identifier: str):
    exact = []
    loose = []
    lowered = identifier.lower()
    for module, function in functions(inventory):
        names = (function["id"], function["original_name"], function["semantic_name"] or "")
        if any(lowered == name.lower() for name in names):
            exact.append((module, function))
        elif any(lowered in name.lower() for name in names):
            loose.append((module, function))
    return exact or loose


def command_function(inventory: dict[str, object], identifier: str) -> list[dict[str, object]]:
    rows = []
    for module, function in find(inventory, identifier):
        row = compact_function(module, function)
        row["entry_evidence"] = function["entry_evidence"]
        row["decompiled_sources"] = function["decompiled_sources"]
        row["semantic_subsystem"] = function["semantic_subsystem"]
        row["direct_calls"] = function["direct_calls"]
        row["indirect_calls"] = function.get("indirect_calls", [])
        rows.append(row)
    return rows


def command_callers(
    inventory: dict[str, object], identifier: str, limit: int = 20, expand: bool = False,
) -> dict[str, object]:
    targets = find(inventory, identifier)
    if len(targets) != 1:
        return {
            "error": "identifier must resolve to exactly one stable function",
            "matches": [compact_function(module, function) for module, function in targets],
        }
    target_id = targets[0][1]["id"]
    callers = []
    unattributed = []
    direct_caller_count = 0
    indirect_caller_count = 0
    for module, function in functions(inventory):
        for edge in function["direct_calls"]:
            if edge["target_id"] == target_id:
                callers.append({**compact_function(module, function), "edge_type": "direct", "edge": edge})
                direct_caller_count += 1
        for edge in function.get("indirect_calls", []):
            if edge["target_id"] == target_id:
                callers.append({**compact_function(module, function), "edge_type": "indirect", "edge": edge})
                indirect_caller_count += 1
    for module in inventory["modules"]:
        for edge in module["unattributed_direct_calls"]:
            if edge["target_id"] == target_id:
                unattributed.append({"module": module["id"], "source": module["source"], "edge_type": "direct", "edge": edge})
        for edge in module.get("unattributed_indirect_calls", []):
            if edge["target_id"] == target_id:
                unattributed.append({"module": module["id"], "source": module["source"], "edge_type": "indirect", "edge": edge})
    modules = sorted({row["module"] for row in callers} | {row["module"] for row in unattributed})
    returned_callers = callers if expand else callers[:limit]
    returned_unattributed = unattributed if expand else unattributed[:limit]
    return {
        "target": compact_function(*targets[0]),
        "caller_count": len(callers),
        "direct_caller_count": direct_caller_count,
        "indirect_caller_count": indirect_caller_count,
        "unattributed_call_count": len(unattributed),
        "module_count": len(modules),
        "modules": modules if expand else modules[:limit],
        "modules_omitted": 0 if expand else max(0, len(modules) - limit),
        "callers": returned_callers,
        "callers_omitted": 0 if expand else max(0, len(callers) - len(returned_callers)),
        "unattributed_calls": returned_unattributed,
        "unattributed_calls_omitted": 0 if expand else max(0, len(unattributed) - len(returned_unattributed)),
    }


def command_factory_families(
    inventory: dict[str, object], min_count: int = 2, limit: int = 30,
) -> list[dict[str, object]]:
    families: dict[tuple[int, int], dict[str, object]] = {}
    target_id = "exe/fns:F0x80014504"
    for module, function in functions(inventory):
        for edge in function["direct_calls"]:
            if edge["target_id"] != target_id:
                continue
            arguments = edge.get("arguments", {})
            size = arguments.get("a1")
            extra = arguments.get("a2")
            if not size or not extra or size["kind"] != "integer" or extra["kind"] != "integer":
                continue
            key = (size["value"], extra["value"])
            family = families.setdefault(key, {
                "object_size": key[0], "extra_state_size": key[1],
                "call_count": 0, "modules": set(), "callbacks": [],
            })
            family["call_count"] += 1
            family["modules"].add(module["id"])
            callback = arguments.get("a0")
            if callback and callback["kind"] == "address":
                callback_id = f"{module['id']}:F{callback['value']}"
                if callback_id not in family["callbacks"]:
                    family["callbacks"].append(callback_id)
    rows = []
    for family in families.values():
        if family["call_count"] < min_count:
            continue
        modules = sorted(family["modules"])
        callbacks = sorted(family["callbacks"])
        rows.append({
            "object_size": family["object_size"],
            "extra_state_size": family["extra_state_size"],
            "call_count": family["call_count"],
            "module_count": len(modules),
            "modules": modules[:10],
            "modules_omitted": max(0, len(modules) - 10),
            "callbacks": callbacks[:10],
            "callbacks_omitted": max(0, len(callbacks) - 10),
        })
    rows.sort(key=lambda item: (-item["call_count"], -item["module_count"], item["object_size"], item["extra_state_size"]))
    return rows[:limit]


def command_global_pointers(
    inventory: dict[str, object], unresolved_only: bool = False, limit: int = 50,
) -> list[dict[str, object]]:
    groups: dict[str, dict[str, object]] = {}
    known = inventory.get("global_function_pointers", {})
    for module, function in functions(inventory):
        for edge in function.get("indirect_calls", []):
            if edge["kind"] not in ("global_function_pointer", "absolute_memory_function_pointer"):
                continue
            symbol = edge.get("global_symbol") or edge.get("global_address")
            group = groups.setdefault(symbol, {
                "symbol": symbol,
                "target_id": edge.get("target_id"),
                "resolution": edge["resolution"],
                "call_count": 0,
                "modules": set(),
                "callers": set(),
            })
            group["call_count"] += 1
            group["modules"].add(module["id"])
            group["callers"].add(function["id"])
            if edge.get("target_id"):
                group["target_id"] = edge["target_id"]
                group["resolution"] = edge["resolution"]
    rows = []
    for symbol, group in groups.items():
        if unresolved_only and group["target_id"]:
            continue
        annotation = known.get(symbol, {})
        modules = sorted(group["modules"])
        callers = sorted(group["callers"])
        rows.append({
            "symbol": symbol,
            "target_id": group["target_id"],
            "semantic_name": annotation.get("name"),
            "resolution": group["resolution"],
            "call_count": group["call_count"],
            "module_count": len(modules),
            "modules": modules[:10],
            "modules_omitted": max(0, len(modules) - 10),
            "caller_count": len(callers),
            "callers": callers[:10],
            "callers_omitted": max(0, len(callers) - 10),
        })
    rows.sort(key=lambda item: (-item["call_count"], item["symbol"]))
    return rows[:limit]


def command_slot_families(
    inventory: dict[str, object], min_count: int = 2, limit: int = 50,
) -> list[dict[str, object]]:
    groups: dict[tuple[int, str, str | None], dict[str, object]] = {}
    for module, function in functions(inventory):
        for edge in function.get("indirect_calls", []):
            if edge["kind"] != "struct_function_slot":
                continue
            key = (
                edge["slot_offset"], edge["resolution"],
                edge.get("candidate_target_id"),
            )
            group = groups.setdefault(key, {
                "slot_offset": key[0],
                "resolution": key[1],
                "candidate_target_id": key[2],
                "call_count": 0,
                "modules": set(),
                "callers": set(),
            })
            group["call_count"] += 1
            group["modules"].add(module["id"])
            group["callers"].add(function["id"])
    rows = []
    for group in groups.values():
        if group["call_count"] < min_count:
            continue
        modules = sorted(group["modules"])
        callers = sorted(group["callers"])
        rows.append({
            "slot_offset": group["slot_offset"],
            "slot_hex": f"0x{group['slot_offset'] & 0xffffffff:x}",
            "resolution": group["resolution"],
            "candidate_target_id": group["candidate_target_id"],
            "call_count": group["call_count"],
            "module_count": len(modules),
            "modules": modules[:10],
            "modules_omitted": max(0, len(modules) - 10),
            "caller_count": len(callers),
            "callers": callers[:10],
            "callers_omitted": max(0, len(callers) - 10),
        })
    rows.sort(key=lambda item: (-item["call_count"], item["slot_offset"]))
    return rows[:limit]


def command_promoted_targets(
    inventory: dict[str, object], limit: int = 100,
) -> list[dict[str, object]]:
    rows = []
    for module, function in functions(inventory):
        if "extracted_called_function_pointer" not in function["entry_evidence"]:
            continue
        rows.append({
            **compact_function(module, function),
            "entry_evidence": function["entry_evidence"],
            "decompiled_sources": function["decompiled_sources"],
        })
    rows.sort(key=lambda item: (item["module"], item["address"]))
    return rows[:limit]


def command_overlay_service_tables(
    inventory: dict[str, object], limit: int = 50, max_gap: int = 4,
) -> list[dict[str, object]]:
    """Cluster promoted overlay callbacks by proximity within extracted data."""
    function_index = {
        function["id"]: (module, function)
        for module, function in functions(inventory)
    }
    callers: dict[tuple[str, str], set[str]] = {}
    caller_modules: dict[tuple[str, str], set[str]] = {}
    for module, function in functions(inventory):
        for edge in function.get("indirect_calls", []):
            symbol = edge.get("global_symbol")
            target = edge.get("target_id")
            if not symbol or not target:
                continue
            key = (symbol, target)
            callers.setdefault(key, set()).add(function["id"])
            caller_modules.setdefault(key, set()).add(module["id"])

    tables: dict[tuple[str, str, str], dict[str, object]] = {}
    for symbol, candidates in inventory.get("overlay_function_pointers", {}).items():
        for candidate in candidates:
            key = (
                candidate["owner_module"],
                candidate.get("array_address", symbol[1:]),
                candidate.get("array_name") or "unknown_array",
            )
            table = tables.setdefault(key, {
                "owner_module": key[0],
                "array_address": key[1],
                "array_name": key[2],
                "declared_slot_count": candidate.get("array_length"),
                "source": candidate["source"],
                "slots": [],
            })
            target_id = candidate["target"]
            target = function_index.get(target_id)
            use_key = (symbol, target_id)
            use_callers = sorted(callers.get(use_key, set()))
            use_modules = sorted(caller_modules.get(use_key, set()))
            table["slots"].append({
                "index": candidate.get("array_index"),
                "cell": symbol,
                "target_id": target_id,
                "target_name": (
                    target[1]["semantic_name"] or target[1]["original_name"]
                    if target else None
                ),
                "target_recovery": target[1]["recovery"] if target else None,
                "call_count": len(use_callers),
                "caller_count": len(use_callers),
                "callers": use_callers,
                "caller_module_count": len(use_modules),
                "caller_modules": use_modules,
            })

    rows = []
    for table in tables.values():
        table["slots"].sort(key=lambda item: (item["index"] is None, item["index"] or 0))
        clusters = []
        for slot in table["slots"]:
            if (
                not clusters
                or slot["index"] is None
                or clusters[-1][-1]["index"] is None
                or slot["index"] - clusters[-1][-1]["index"] > max_gap
            ):
                clusters.append([slot])
            else:
                clusters[-1].append(slot)
        for ordinal, cluster in enumerate(clusters):
            indices = [slot["index"] for slot in cluster if slot["index"] is not None]
            first = min(indices) if indices else None
            last = max(indices) if indices else None
            established = set(indices)
            rows.append({
                "owner_module": table["owner_module"],
                "array_name": table["array_name"],
                "array_address": table["array_address"],
                "array_declared_slot_count": table["declared_slot_count"],
                "cluster_ordinal": ordinal,
                "cluster_start_index": first,
                "cluster_end_index": last,
                "cluster_start_cell": cluster[0]["cell"],
                "span_slot_count": (last - first + 1) if first is not None else None,
                "established_slot_count": len(cluster),
                "unestablished_indices_within_span": (
                    [index for index in range(first, last + 1) if index not in established]
                    if first is not None else None
                ),
                "maximum_join_gap": max_gap,
                "source": table["source"],
                "slots": cluster,
                "call_count": sum(slot["call_count"] for slot in cluster),
                "classification": "proximity_cluster_within_exact_extracted_array",
            })
    rows.sort(key=lambda item: (
        item["owner_module"], item["array_address"],
        item["cluster_start_index"] if item["cluster_start_index"] is not None else -1,
    ))
    return rows[:limit]


def normalize_decompiled_c(text: str) -> str:
    """Normalize only relocatable F-label identities, preserving all behavior."""
    text = re.sub(r"F0x[0-9a-fA-F]{8}", "F0xADDR", text)
    return " ".join(text.split())


# A body with no statements carries no structural signal, so grouping by its
# text asserts a shared implementation that was never observed. Empty m2c
# output has at least two distinct causes that must not be merged: a genuine
# two-instruction `jr $ra` / `nop` callback stub, and a false function boundary
# where the partitioner started an "entry" on a shared epilogue label that is
# reached by fall-through from inside the owning function. Both were confirmed
# against original assembly on 2026-08-04 (stgtrain 0x80088100/08/30 are real
# stubs; stplnmet 0x80085a4c, stcrddek 0x800884c4 and stitshop 0x8008af50 are
# convergence labels). Cluster them separately so a human triages the cause
# instead of the two silently joining one bogus 13-member "family".
TRIVIAL_EMPTY_BODY = re.compile(r"^\w[\w\s*]*F0xADDR\([^)]*\)\s*\{\s*\}$")


def is_trivial_empty_body(normalized: str) -> bool:
    """True when the normalized body declares a function with no statements."""
    return bool(TRIVIAL_EMPTY_BODY.match(normalized))


# The same trap in a second form. A body that is one tail call matches every other
# such body after label normalization, but the calls go to DIFFERENT targets and do
# different things. exe/fns:F0x80014504 is createUnregisteredObject, called in the
# corpus as F0x80014504(&vtable, 0xf48, 0) and returning a pointer; m2c renders it
# `void F0x80014504(void) { F0x800143dc(0); }` because it DROPS leading arguments
# passed through in registers to a tail call. Its four "homologs" share only that
# shape. Six of 49 families were this.
TRIVIAL_FORWARDER = re.compile(
    r"[\w?][\w\s*?]*F0xADDR\([^)]*\)\s*\{\s*(?:return\s+)?F0xADDR\([^;{}]*\)\s*;\s*\}$"
)


def is_trivial_forwarder(normalized: str) -> bool:
    """True when the normalized body is a single call and nothing else.

    Matched at the END of the normalized text rather than the start: m2c emits
    `extern` prototypes ahead of the definition, and the normalizer keeps them.
    """
    return bool(TRIVIAL_FORWARDER.search(normalized))


RESEARCH_ROOT = Path("docs/research")
ADDRESS_PATTERN = re.compile(r"0x800[0-9a-f]{5}")


def command_research_links(
    inventory: dict[str, object], limit: int = 50, classified: bool = False,
) -> list[dict[str, object]]:
    """Join existing research documents onto inventory functions by address.

    A function can carry `semantics: unknown` purely because nothing links the
    decoded knowledge in docs/research to the generated inventory, not because
    the behavior is undecoded. Seven promoted overlay targets turned out to be
    fully decoded already on 2026-08-04. This surfaces the rest of that backlog
    so documented functions are annotated before anything new is traced.

    A mention is a lead, never a claim: an address can appear in a document that
    merely lists or rules it out, so every hit still needs reading before the
    function is named.
    """
    by_address: dict[str, list[dict[str, object]]] = {}
    annotated_at: dict[str, list[str]] = {}
    for module, function in functions(inventory):
        address = function["address"].lower()
        if function["recovery"]["semantics"] != "unknown":
            annotated_at.setdefault(address, []).append(function["id"])
        if (function["recovery"]["semantics"] == "unknown") == classified:
            continue
        by_address.setdefault(address, []).append(function)
    documents: dict[str, set[str]] = {}
    for path in sorted(RESEARCH_ROOT.rglob("*")):
        if path.suffix not in {".md", ".json"} or not path.is_file():
            continue
        text = path.read_text(errors="replace").lower()
        for address in set(ADDRESS_PATTERN.findall(text)):
            if address in by_address:
                documents.setdefault(address, set()).add(str(path))
    rows = []
    for address, sources in documents.items():
        # Grouped by address, not by function: overlays that share a load base
        # (every wstag entry sits at 0x800a5de0) would otherwise emit dozens of
        # identical rows and crowd out genuinely well-documented functions.
        owners = sorted(function["id"] for function in by_address[address])
        # The likeliest false join: a sibling at the SAME address in another
        # overlay is already named, so the documents almost certainly describe
        # that one. 0x8008b798 is documented throughout as a fieldstg battle
        # handoff, and its unannotated stgdglab twin is a different function.
        siblings = sorted(set(annotated_at.get(address, [])) - set(owners))
        row = {
            "address": address,
            "function_count": len(owners),
            "functions": owners,
            "document_count": len(sources),
            "documents": sorted(sources),
            "classification": "address_mentioned_in_existing_research",
        }
        if siblings:
            row["already_named_at_this_address"] = siblings
            row["collision_warning"] = (
                "another overlay's function at this exact address is already "
                "named; the cited documents most likely describe THAT function, "
                "not this one. Word-match the overlay text before naming."
            )
        rows.append({
            **row,
            "semantic_caveat": (
                "A document mentioning this address is a lead, not a claim: it "
                "may list, defer or explicitly rule out the function, and an "
                "address shared by several overlays may be a different function "
                "in each. Read the citation before naming."
            ),
        })
    rows.sort(key=lambda item: (-item["document_count"], item["address"]))
    return rows[:limit]


def command_homolog_families(
    inventory: dict[str, object], min_count: int = 2, limit: int = 50,
) -> list[dict[str, object]]:
    groups: dict[str, list[tuple[dict[str, object], dict[str, object], str]]] = {}
    trivial: list[tuple[dict[str, object], dict[str, object], str]] = []
    forwarders: list[tuple[dict[str, object], dict[str, object], str]] = []
    for module, function in functions(inventory):
        sources = function.get("decompiled_sources", [])
        if not sources:
            continue
        path = Path(sources[0])
        if not path.is_file():
            continue
        normalized = normalize_decompiled_c(path.read_text(errors="replace"))
        if is_trivial_empty_body(normalized):
            trivial.append((module, function, sources[0]))
            continue
        if is_trivial_forwarder(normalized):
            forwarders.append((module, function, sources[0]))
            continue
        digest = hashlib.sha256(normalized.encode()).hexdigest()
        groups.setdefault(digest, []).append((module, function, sources[0]))
    rows = []
    for digest, members in groups.items():
        if len(members) < min_count:
            continue
        modules = sorted({module["id"] for module, _, _ in members})
        rows.append({
            "fingerprint": "sha256:" + digest,
            "member_count": len(members),
            "module_count": len(modules),
            "modules": modules,
            "members": [
                {
                    "id": function["id"],
                    "name": function["semantic_name"] or function["original_name"],
                    "source": source,
                }
                for module, function, source in sorted(
                    members, key=lambda item: item[1]["id"],
                )
            ],
            "classification": "exact_m2c_text_after_function_label_normalization",
            "semantic_caveat": "Structural homology is established; shared purpose still requires contextual evidence.",
        })
    rows.sort(key=lambda item: (-item["member_count"], -item["module_count"], item["fingerprint"]))
    rows = rows[:limit]
    if len(trivial) >= min_count:
        # Reported, never silently dropped: an empty body is a triage signal,
        # not a semantic family. Kept out of the ranked families above so it
        # cannot be mistaken for evidence of a shared implementation.
        rows.append({
            "fingerprint": "trivial-empty-body",
            "member_count": len(trivial),
            "module_count": len(sorted({module["id"] for module, _, _ in trivial})),
            "modules": sorted({module["id"] for module, _, _ in trivial}),
            "members": [
                {
                    "id": function["id"],
                    "name": function["semantic_name"] or function["original_name"],
                    "source": source,
                }
                for module, function, source in sorted(trivial, key=lambda item: item[1]["id"])
            ],
            "classification": "trivial_empty_body_requires_triage",
            "semantic_caveat": (
                "NOT a homolog family. An empty m2c body is either a real `jr $ra`/`nop` "
                "callback stub or a false function boundary on a shared epilogue label; "
                "the two are indistinguishable from the C text and must be separated "
                "against original assembly before any member is named."
            ),
        })
    if len(forwarders) >= min_count:
        rows.append({
            "fingerprint": "trivial-forwarder",
            "member_count": len(forwarders),
            "module_count": len(sorted({module["id"] for module, _, _ in forwarders})),
            "modules": sorted({module["id"] for module, _, _ in forwarders}),
            "members": [
                {
                    "id": function["id"],
                    "name": function["semantic_name"] or function["original_name"],
                    "source": source,
                }
                for module, function, source in sorted(forwarders, key=lambda item: item[1]["id"])
            ],
            "classification": "trivial_forwarder_requires_triage",
            "semantic_caveat": (
                "NOT a homolog family. A one-tail-call body matches every other such "
                "body after label normalization while calling an entirely different "
                "target, and m2c DROPS the arguments passed through in registers -- "
                "createUnregisteredObject renders this way despite taking three. Read "
                "each member's call target and the original assembly's argument setup."
            ),
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", type=Path, default=DEFAULT_INVENTORY)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("summary")
    translations_parser = subparsers.add_parser("translation-coverage")
    translations_parser.add_argument("--registry", type=Path, default=Path("data/translated_functions.json"))
    function_parser = subparsers.add_parser("function")
    function_parser.add_argument("identifier")
    callers_parser = subparsers.add_parser("callers")
    callers_parser.add_argument("identifier")
    callers_parser.add_argument("--limit", type=int, default=20)
    callers_parser.add_argument("--expand", action="store_true")
    families_parser = subparsers.add_parser("factory-families")
    families_parser.add_argument("--min-count", type=int, default=2)
    families_parser.add_argument("--limit", type=int, default=30)
    globals_parser = subparsers.add_parser("global-pointers")
    globals_parser.add_argument("--unresolved", action="store_true")
    globals_parser.add_argument("--limit", type=int, default=50)
    slots_parser = subparsers.add_parser("slot-families")
    slots_parser.add_argument("--min-count", type=int, default=2)
    slots_parser.add_argument("--limit", type=int, default=50)
    promoted_parser = subparsers.add_parser("promoted-targets")
    promoted_parser.add_argument("--limit", type=int, default=100)
    services_parser = subparsers.add_parser("overlay-services")
    services_parser.add_argument("--limit", type=int, default=50)
    services_parser.add_argument("--max-gap", type=int, default=4)
    homologs_parser = subparsers.add_parser("homolog-families")
    homologs_parser.add_argument("--min-count", type=int, default=2)
    homologs_parser.add_argument("--limit", type=int, default=50)
    links_parser = subparsers.add_parser("research-links")
    links_parser.add_argument("--limit", type=int, default=50)
    links_parser.add_argument(
        "--classified", action="store_true",
        help="show already-annotated functions instead of the unannotated backlog",
    )
    args = parser.parse_args()
    inventory = load(args.inventory)
    if args.command == "summary":
        result = command_summary(inventory)
    elif args.command == "translation-coverage":
        result = command_translation_coverage(inventory, load(args.registry))
    elif args.command == "function":
        result = command_function(inventory, args.identifier)
    elif args.command == "callers":
        result = command_callers(inventory, args.identifier, args.limit, args.expand)
    elif args.command == "factory-families":
        result = command_factory_families(inventory, args.min_count, args.limit)
    elif args.command == "global-pointers":
        result = command_global_pointers(inventory, args.unresolved, args.limit)
    elif args.command == "slot-families":
        result = command_slot_families(inventory, args.min_count, args.limit)
    elif args.command == "promoted-targets":
        result = command_promoted_targets(inventory, args.limit)
    elif args.command == "overlay-services":
        result = command_overlay_service_tables(inventory, args.limit, args.max_gap)
    elif args.command == "research-links":
        result = command_research_links(inventory, args.limit, args.classified)
    else:
        result = command_homolog_families(inventory, args.min_count, args.limit)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
