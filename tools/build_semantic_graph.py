#!/usr/bin/env python3
"""Join every semantic signal in the repository into one evidence graph.

WHY THIS EXISTS
---------------
The repository holds a dozen independent kinds of semantic knowledge -- the
ledger, the game's own shipped text, mechanically extracted bounds, research
prose, families, the call graph, the browser implementation. Until now only four
met each other (`tools/infer_recovered_semantics.py`: C bodies, families, call
graph, address citations in prose). The other five had never been joined onto
function identities at all, which is why the same facts kept being re-derived.

This tool joins them, assigns topics from the bases that were MEASURED to work,
reports what each research statement is and is not supported by, and ranks the
residue by how much of the rest of the program it would unlock.

WHAT IT DELIBERATELY DOES NOT DO
--------------------------------
It does not derive a topic from a call edge. That was built and measured on
2026-08-11 by `tools/infer_module_domains.py` at 30.2% against a 51.0%
majority-class baseline -- worse than guessing. See `dw3_semantics/graph.py`.

AUTHORITY
---------
Nothing here is proof of original behaviour. It emits CANDIDATES with full
provenance so a person reviews conclusions instead of re-reading functions. Only
the existing gates (`record-finding`, `record-packets`, the isolated review in
`ddw3-verify-handoff`) can turn any of this into a ledger claim.

    build       join, assign, validate, rank -> recovered/ddw3/semantic-graph.json
    stats       joined corpus state, counted from disk
    validate    leak-free hold-out accuracy per label space
    rank        highest information-gain unresolved targets
    show        everything joined onto one function
    crosscheck  research prose against the ledger and the extracted bounds
    avenues     every repository-derived route to the residue, scored
    residue     why nothing is known about each function still unknown
    explained   functions the pipeline calls unnamed that another source covers
    report      the markdown summary
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import textwrap
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dw3_semantics import RULE_VERSION, avenues, engine, graph, signals as signals_mod
from dw3_semantics.corpus import INVENTORY_PATH, REPO_ROOT, SEMANTICS_PATH, load_corpus

# The CLI import inside ledger_claim_status needs the repository root importable
# (dw3_research.cli -> tools.rosetta_dispositions). Running this file as a script
# puts only tools/ on sys.path.
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

GRAPH_PATH = REPO_ROOT / "recovered/ddw3/semantic-graph.json"
REPORT_PATH = REPO_ROOT / "docs/generated/semantic-graph.md"
FUNCTION_TABLE_PATH = REPO_ROOT / "docs/generated/function-table.json"
FUNCTION_TABLE_REPORT_PATH = REPO_ROOT / "docs/generated/function-table.md"
DISPOSITION_PATH = REPO_ROOT / "docs/generated/exe-disposition.json"
CATALOG_PATH = REPO_ROOT / "docs/research/systems/catalog.json"
TRACES_PATH = REPO_ROOT / "docs/generated/resident-traces.json"
INTERIOR_LABELS_PATH = REPO_ROOT / "recovered/ddw3/interior-labels.json"


def load_interior_labels(path: Path | None = None) -> dict[str, dict]:
    """Inventory starts that are labels inside another routine, keyed by id.

    The inventory records a `.global`/`.section` entry for jump-table case
    bodies and shared continuations, so they appear as separate functions. They
    are not: a case body has no return of its own and consumes registers set by
    its owner. `recovered/ddw3/interior-labels.json` lists them; a missing file
    degrades to empty so the table still builds.
    """
    path = path or INTERIOR_LABELS_PATH
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    out: dict[str, dict] = {}
    for item in payload.get("labels", []):
        if item.get("owner") and item.get("address"):
            out[item["address"]] = item
    return out


def ledger_claim_status(addresses) -> dict[str, dict]:
    """Per-address ledger claim status, via the `dw3-research known` join.

    An unnamed function is not necessarily an unread one. The worklist this
    feeds is built from `semantics.json` names, so a function with established
    ledger claims but no curated entry reads as new ground. This join separates
    "already anchored, needs a name and review" from "genuinely unread" -- the
    distinction that decides where a reader should spend a session.

    Best row wins: an exact-start DECODED row from a precise assembly extent
    (`.s`) is DECODED. An exact-start row whose only source is `exe-decomp/c`
    is FALLBACK: the decompiled-only extent is a 0x400 window that can absorb
    the next routine's anchors, so the claim may belong to a neighbour. Only a
    surrounding function anchored is ENCLOSING, which per `known` establishes
    nothing about this address. Pure navigation: a missing or stale index
    degrades to an empty map.
    """
    if not addresses:
        return {}
    try:
        from tools.dw3_research.cli import known_report
        report = known_report([int(a, 16) for a in addresses], no_docs=True)
    except Exception:
        return {}
    out: dict[str, dict] = {}
    for address, item in report:
        precise = None
        fallback = None
        enclosing = False
        for row in item["rows"]:
            if row["verdict"] != "DECODED":
                continue
            if not row["exact_start"]:
                enclosing = True
                continue
            assembly = str(row["source"]).endswith(".s")
            if assembly and precise is None:
                precise = row
            elif not assembly and fallback is None:
                fallback = row
        chosen = precise or fallback
        if chosen is not None:
            claims = sorted(claim["id"] for claim in chosen["claims"])
            entry = {
                "verdict": "DECODED" if precise is not None else "FALLBACK",
                "decoded": precise is not None,
                "claims": claims,
                "statuses": sorted({claim.get("status") for claim in chosen["claims"]}),
            }
        elif enclosing:
            entry = {"verdict": "ENCLOSING", "decoded": False, "claims": []}
        elif item["mentions"]:
            entry = {"verdict": "MENTIONED", "decoded": False, "claims": []}
        else:
            entry = {"verdict": "UNKNOWN", "decoded": False, "claims": []}
        out[f"0x{address:08x}"] = entry
    return out


# --------------------------------------------------------------------------
# information gain
# --------------------------------------------------------------------------

def _cost(candidate) -> float:
    """Rough analyst cost to settle one function, from what we can read of it."""
    return {
        "no_lift": 4.0,
        "decompiled_c_incomplete": 2.5,
        "empty_body_requires_triage": 1.5,
    }.get(candidate["lift"], 1.0)


def information_gain(corpus, result, topics, signals, *, limit: int) -> dict:
    """Rank unresolved functions by how much they would unlock.

    The unit of gain is deliberately rule-consistent with `graph.assign`: an
    unknown function counts as unlockable only if a topic would actually reach
    it -- through its family, or by lifting its module over the donor purity
    floor. Call edges are excluded, because assign() does not use them either.
    Counting callers here would inflate exactly the hubs the measurement showed
    carry no topical signal.

    Structural leverage (a hub whose meaning helps a person read its callers,
    without carrying a topic) is real but different, so it is reported as its
    own list rather than mixed into the same number.
    """
    candidates = result["candidates"]
    families = result["families"]
    family_by_member = result["family_by_member"]
    edges_by_function = signals.by_function()

    unresolved = {fid for fid in candidates if fid not in topics}
    module_unresolved: dict[str, int] = defaultdict(int)
    module_total: dict[str, int] = defaultdict(int)
    for fid, fn in corpus.functions.items():
        module_total[fn.module] += 1
        if fid in unresolved:
            module_unresolved[fn.module] += 1

    rows = []
    for fid in sorted(unresolved):
        candidate = candidates[fid]
        fn = corpus.functions[fid]
        reach: set[str] = set()
        for family_id in family_by_member.get(fid, []):
            family = families[family_id]
            if family.can_carry_name:
                reach |= {m for m in family.members if m != fid and m in unresolved}
        # Module lift: labelling this one may put its module over the floor and
        # release every unlabelled peer at once.
        labelled_peers = module_total[fn.module] - module_unresolved[fn.module]
        module_gain = 0
        if labelled_peers == 0 and module_unresolved[fn.module] > 1:
            module_gain = module_unresolved[fn.module] - 1

        unlockable = len(reach) + module_gain
        if unlockable == 0:
            continue

        edges = edges_by_function.get(fid, [])
        classes = {edge.kind for edge in edges}
        if candidate["lift"] == "decompiled_c_complete":
            classes.add("decompiled_c")
        if family_by_member.get(fid):
            classes.add("family")
        strength = min(1.0, 0.25 + 0.18 * len(classes))
        gain = unlockable * strength / _cost(candidate)

        rows.append({
            "id": fid,
            "module": candidate["module"],
            "address": candidate["address"],
            "gain": round(gain, 2),
            "unlockable_unknowns": unlockable,
            "via": ("family" if reach and not module_gain
                    else "module" if module_gain and not reach else "family+module"),
            "evidence_classes": sorted(classes),
            "evidence_strength": round(strength, 2),
            "cost": _cost(candidate),
            "callers": candidate["callers"],
            "role": candidate["role"],
            "lift": candidate["lift"],
            "families": family_by_member.get(fid, []),
            "lexicon": sorted({word for edge in edges for word in edge.lexicon})[:8],
            "why": _why(candidate, edges, unlockable),
        })
    rows.sort(key=lambda row: -row["gain"])

    # Structural leverage: unresolved functions many others call. Understanding
    # one of these helps a person read its callers even though, by measurement,
    # it must not hand them a topic.
    structural = sorted(
        ({
            "id": fid,
            "address": candidates[fid]["address"],
            "module": candidates[fid]["module"],
            "callers": candidates[fid]["callers"],
            "lift": candidates[fid]["lift"],
            "evidence_classes": sorted({e.kind for e in edges_by_function.get(fid, [])}),
            "note": "high fan-in: settling it aids reading its callers, but the "
                    "2026-08-11 measurement forbids handing them its topic",
        } for fid in unresolved if candidates[fid]["callers"] >= 8),
        key=lambda row: -row["callers"],
    )
    return {"topic_gain": rows[:limit], "structural_leverage": structural[:limit],
            "unresolved_functions": len(unresolved)}


def _why(candidate, edges, unlockable) -> str:
    parts = [f"a topic would reach {unlockable} still-unlabelled functions"]
    kinds = sorted({edge.kind for edge in edges})
    if kinds:
        parts.append("already carries " + ", ".join(kinds) + " evidence")
    if candidate["lift"] == "no_lift":
        parts.append("no decompilation exists, so this needs assembly")
    elif candidate["lift"] == "decompiled_c_complete":
        parts.append("a complete C body is available to read")
    return "; ".join(parts)


# --------------------------------------------------------------------------
# research prose cross-check
# --------------------------------------------------------------------------

# Match thousands separators too: "clamps to 999,999" must read as 999999, not
# as two 999s. That misparse produced a false disagreement on 2026-08-12.
NUMBER_RE = re.compile(r"\b(\d{1,3}(?:,\d{3})+|\d{2,7})\b")
# A bare number in prose is usually a date, an instruction count or a struct
# offset, none of which `bounds.json` claims to hold. Only compare a number when
# the sentence says it is a limit -- otherwise the bucket fills with noise.
BOUND_WORDS = re.compile(
    r"\b(cap(?:s|ped|ping)?|clamp(?:s|ed|ing)?|limit(?:s|ed)?|maximum|minimum|"
    r"max|min|ceiling|floor|at most|no more than|up to)\b", re.IGNORECASE)


def crosscheck(signals) -> dict:
    """Compare anchored research statements against the ledger and bounds.

    Only mechanically decidable relationships are reported. "Contradicted" here
    means a specific checkable disagreement, never a difference of wording, and
    "unsupported" means nothing anchors the statement -- not that it is wrong.
    """
    claim_by_function: dict[str, list[str]] = defaultdict(list)
    for cid, targets in signals.claim_functions.items():
        for fid in targets:
            claim_by_function[fid].append(cid)

    bounds_by_function: dict[str, set[int]] = defaultdict(set)
    for edge in signals.edges:
        if edge.kind != "bound":
            continue
        for word in edge.lexicon:
            _, _, value = word.partition("=")
            if value.isdigit():
                bounds_by_function[edge.function_id].add(int(value))

    buckets: dict[str, list[dict]] = {
        "corroborated_by_ledger": [], "mechanically_provable_now": [],
        "anchored_only_to_contradicted_claims": [], "unsupported": [],
        "numeric_disagreement_with_extracted_bounds": [],
    }
    for statement in signals.doc_statements:
        fid = statement["function_id"]
        claims = claim_by_function.get(fid, [])
        live = [cid for cid in claims
                if signals.claims.get(cid, {}).get("status") != "contradicted"]
        dead = [cid for cid in claims if cid not in live]
        text = statement["statement"]
        claims_a_bound = bool(BOUND_WORDS.search(text))
        numbers = ({int(n.replace(",", "")) for n in NUMBER_RE.findall(text)}
                   if claims_a_bound else set())
        known = bounds_by_function.get(fid, set())

        row = dict(statement)
        row["ledger_claims"] = claims
        if dead and not live:
            row["reason"] = ("every ledger claim anchored to this function is marked "
                             "contradicted: " + ", ".join(dead))
            buckets["anchored_only_to_contradicted_claims"].append(row)
        elif live:
            row["reason"] = f"live ledger claim(s) anchored to the same function: {', '.join(live[:3])}"
            buckets["corroborated_by_ledger"].append(row)
        elif numbers & known:
            row["reason"] = ("the statement's number matches a bound extracted "
                             "mechanically from this function: "
                             + ", ".join(str(n) for n in sorted(numbers & known)))
            buckets["mechanically_provable_now"].append(row)
        elif known and numbers and not (numbers & known):
            row["reason"] = (f"the statement cites {sorted(numbers)} but the only bounds "
                             f"extracted from this function are {sorted(known)} -- "
                             "read this one")
            buckets["numeric_disagreement_with_extracted_bounds"].append(row)
        else:
            row["reason"] = "no ledger claim and no extracted bound anchors this statement"
            buckets["unsupported"].append(row)

    return {
        **buckets,
        "summary": {key: len(value) for key, value in buckets.items()},
        "note": ("'unsupported' means nothing anchors the statement to the same "
                 "function. It is not a finding that the statement is wrong. "
                 "'numeric_disagreement' is a read-this-one flag, not a refutation: "
                 "a function legitimately holds bounds a sentence does not mention."),
    }


# The ladder from "an address" to "a decoded routine". A structural label is a
# real intermediate state: knowing a routine polls until something completes is
# less than knowing which system it serves, and far more than knowing nothing.
# Keeping these apart stops a bare count of unnamed functions from reading as if
# the whole residue were equally opaque -- it is not.
SEMANTIC_STATES = ("named", "topic", "structural", "readable", "opaque")


def semantic_state(fid, candidate, topics, shaped, has_c) -> str:
    if candidate["proposed_name"]:
        return "named"
    if fid in topics:
        return "topic"
    if fid in shaped or candidate["role"]:
        return "structural"
    if fid in has_c or candidate["lift"] == "decompiled_c_complete":
        return "readable"
    return "opaque"


def readable_bodies(corpus) -> set[str]:
    """Functions whose decompiled C can actually be read.

    Asking the candidates file for `lift == "decompiled_c_complete"` is not the
    same question and gets a much smaller answer: that vocabulary covers only
    the functions the candidate generator processed. Measured 2026-08-12, 428
    functions the ladder called `opaque` on that test have a complete C body on
    disk with no lift failure in it -- so `opaque` was overstating the genuinely
    unknown residue by roughly three times. The filesystem is the authority for
    "is there a body", so ask it.
    """
    return {fid for fid, function in corpus.functions.items()
            if function.has_body
            and "Decompilation failure" not in (function.body_text or "")}


def semantic_ladder(corpus, result, topics, signals) -> dict:
    """Every function placed on the ladder, with the residue broken out.

    `opaque` is the only bucket where the repository holds nothing usable, and
    it is far smaller than "unnamed" suggests: measured 2026-08-12, 931 of the
    2,036 unlabelled functions already carry a proven control shape or a
    structural role, and every one of the rest that has a C body is `readable`.
    What is left in `opaque` is the assembly-only residue -- no decompiled body
    exists for it at all.
    """
    shaped = {edge.function_id for edge in signals.edges if edge.kind == "static_shape"}
    has_c = readable_bodies(corpus)
    states: dict[str, str] = {}
    for fid, candidate in result["candidates"].items():
        states[fid] = semantic_state(fid, candidate, topics, shaped, has_c)
    counts = {state: sum(1 for value in states.values() if value == state)
              for state in SEMANTIC_STATES}
    opaque = [fid for fid, state in states.items() if state == "opaque"]
    by_module = defaultdict(int)
    for fid in opaque:
        by_module[corpus.functions[fid].module] += 1
    return {
        "counts": counts,
        "states": states,
        "opaque_by_module": dict(sorted(by_module.items(), key=lambda kv: -kv[1])[:15]),
        "note": ("`structural` means a proven control shape or classified role but no "
                 "system; `readable` means a complete C body exists and nobody has "
                 "read it; `opaque` means the repository holds nothing usable."),
    }


def vocabulary_bound_pairs(signals) -> list[dict]:
    """Functions where the game's own words and an extracted bound coincide.

    This is the strongest shape the joined graph produces, because the two sides
    are independent: the words come from the shipped text banks by way of the
    call site's literal index, and the bound comes from a mechanical pass over
    the instructions. Neither was derived from the other.

    Example produced on 2026-08-12: `stcrddek:F0x80085210` draws "Only four of
    the same card in one folder" and clamps against 4 -- the sentence the game
    shows a player and the number the code enforces, agreeing.

    These are CANDIDATES. A coincidence is not a proof that the clamp implements
    the sentence, and a function commonly draws one label while bounding
    something else entirely. Each row is a read-this-one, not a finding.
    """
    per_function: dict[str, dict[str, set]] = defaultdict(
        lambda: {"words": set(), "bounds": set(), "sources": set()})
    for edge in signals.edges:
        if edge.kind == "text_bank" and len(edge.lexicon) == 1:
            per_function[edge.function_id]["words"].add(edge.lexicon[0])
            per_function[edge.function_id]["sources"].add(f"{edge.source}:{edge.locator}")
        elif edge.kind == "bound":
            per_function[edge.function_id]["bounds"].add(edge.detail)
            per_function[edge.function_id]["sources"].add(f"{edge.source}:{edge.locator}")
    rows = [
        {
            "id": fid,
            "words": sorted(data["words"]),
            "bounds": sorted(data["bounds"]),
            "sources": sorted(data["sources"])[:6],
            "authority": "text 4 (bank ordering is a hypothesis) x bounds 2 (instructions)",
        }
        for fid, data in per_function.items() if data["words"] and data["bounds"]
    ]
    rows.sort(key=lambda row: (-len(row["bounds"]), row["id"]))
    return rows


def already_explained(result, signals, topics) -> list[dict]:
    """Functions the naming pipeline leaves blank that another source covers.

    This is the recurring cost in this repository: work redone because the
    knowledge sits in a file nobody joined to the corpus.
    """
    rows = []
    edges_by_function = signals.by_function()
    for fid, candidate in result["candidates"].items():
        if candidate["proposed_name"]:
            continue
        edges = edges_by_function.get(fid, [])
        strong = [edge for edge in edges if edge.kind in ("ledger", "text_bank")]
        if not strong:
            continue
        topic = topics.get(fid)
        rows.append({
            "id": fid,
            "address": candidate["address"],
            "module": candidate["module"],
            "explained_by": sorted({f"{e.kind}:{e.locator}" for e in strong})[:6],
            "sources": sorted({edge.source for edge in strong}),
            "best_authority": min(edge.authority for edge in strong),
            "topic": topic.topic if topic else None,
            "topic_basis": topic.basis if topic else None,
            "lexicon": sorted({w for edge in edges for w in edge.lexicon})[:8],
        })
    rows.sort(key=lambda row: (row["best_authority"], row["id"]))
    return rows


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------

def function_table(corpus, result, topics, states, family_by_member,
                   disposition, catalog, traces) -> dict:
    """One generated row per function with the axes that separate identity from understanding.

    The repository already has the pieces -- inventory identities, the semantic
    ladder, ledger claims, the PsyQ disposition, catalog implementation status --
    but no single artifact joined them, so "how many functions are actually
    understood" had no denominator that was not a name count. This table is that
    join. It is a navigation aid (authority 6): `state`, `verification` and
    `implementation` quote their own sources; nothing here is a new claim.

    The axes are deliberately separate: `name` is identity, `state` is how far
    the pipeline got, `verification` is the ledger recovery mark, `disposition`
    is bibliographic (PsyQ/game/block), `implementation` is what the walker
    ships, and `observed_in` is which runtime traces executed it. Collapsing
    them was what let `forward_to_*` names read as progress.
    """
    addresses = (disposition or {}).get("addresses", {})
    implementation = {
        item["system"]: item.get("implementation_status")
        for item in (catalog or {}).get("systems", [])
    }
    observed = (traces or {}).get("observed", {})
    rows: dict[str, dict] = {}
    for fid, fn in corpus.functions.items():
        candidate = result["candidates"][fid]
        topic = topics.get(fid)
        dispo = addresses.get(fn.address_hex) if fn.module == "exe/fns" else None
        recovery = fn.recovery or {}
        row = {
            "module": fn.module,
            "address": fn.address_hex,
            "name": candidate["proposed_name"],
            "state": states.get(fid),
            "role": "block" if candidate.get("role") else "function",
            "family": (family_by_member.get(fid) or [None])[0],
            "topic": topic.topic if topic else None,
            "subsystem": fn.curated_subsystem,
            "verification": recovery.get("verification"),
            "implementation": implementation.get(fn.curated_subsystem),
            "direct_callers": len(corpus.callers.get(fid, ())),
            "disposition": None,
            "psyq": None,
            "zone": None,
            "interior_of": None,
            "interior_of_label": None,
            "observed_in": sorted(observed.get(fid, [])),
        }
        if dispo:
            row["disposition"] = dispo.get("disposition")
            row["zone"] = dispo.get("zone")
            if dispo.get("disposition") == "psyq":
                row["psyq"] = dispo.get("name")
            interior = dispo.get("interior_of")
            if interior:
                row["interior_of"] = interior.get("name")
        rows[fid] = row

    interior_labels = load_interior_labels()
    for fid, row in rows.items():
        label = interior_labels.get(row["address"])
        if label:
            row["interior_of_label"] = label.get("owner")

    by_state = defaultdict(int)
    by_disposition = defaultdict(int)
    by_module: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    observed_functions = 0
    for row in rows.values():
        by_state[row["state"]] += 1
        by_disposition[row["disposition"] or "not-resident"] += 1
        module = by_module[row["module"]]
        module["functions"] += 1
        if row["name"]:
            module["named"] += 1
        if row["disposition"]:
            module[row["disposition"]] += 1
        if row["state"] in ("readable", "opaque"):
            module[row["state"]] += 1
        if row["observed_in"]:
            module["observed"] += 1
            observed_functions += 1
    # The exe game-zone worklist: unnamed resident game functions, ordered by
    # how many callers already route through them. Named functions are identities
    # already; their remaining work is verification, not reading.
    #
    # Membership is the disposition, not the inference's `role`. A jump-table
    # dispatcher head (e.g. F0x800110e0, F0x8001270c) is a real game function
    # that owns its case bodies, but the inference marks it `block` because it
    # contains the table; filtering on `role == "function"` silently hid those
    # heads from the worklist. `interior_of_label` is the only correct exclusion.
    worklist_rows = [
        (fid, row) for fid, row in rows.items()
        if row["module"] == "exe/fns"
        and row["disposition"] == "game"
        and not row["name"]
        and not row["interior_of_label"]
    ]
    ledger = ledger_claim_status([row["address"] for _, row in worklist_rows])
    worklist = sorted(
        (
            {
                "id": fid,
                "address": row["address"],
                "name": row["name"],
                "state": row["state"],
                "disposition": row["disposition"],
                "direct_callers": row["direct_callers"],
                "verification": row["verification"],
                "ledger": ledger.get(row["address"], {}).get("verdict"),
                "ledger_claims": ledger.get(row["address"], {}).get("claims", []),
                "observed_in": row["observed_in"],
            }
            for fid, row in worklist_rows
        ),
        key=lambda item: (-item["direct_callers"], item["address"]),
    )
    game_named = sum(
        1 for row in rows.values()
        if row["module"] == "exe/fns" and row["disposition"] == "game"
        and row["name"])
    return {
        "note": ("Navigation join only. `state` is the semantic ladder; "
                 "`verification` quotes semantics.json's recovery mark; "
                 "`disposition` quotes docs/generated/exe-disposition.json; "
                 "`implementation` quotes docs/research/systems/catalog.json; "
                 "`observed_in` quotes docs/generated/resident-traces.json."),
        "summary": {
            "functions": len(rows),
            "observed_functions": observed_functions,
            "by_state": dict(sorted(by_state.items())),
            "by_disposition": dict(sorted(by_disposition.items())),
            "exe_game_worklist": len(worklist),
            "exe_game_named": game_named,
            "exe_game_labels_excluded": sum(
                1 for fid, row in rows.items()
                if row["module"] == "exe/fns" and row["role"] == "function"
                and row["zone"] == "game" and not row["name"]
                and row["interior_of_label"]),
            "exe_game_worklist_anchored": sum(
                1 for item in worklist if item["ledger"] == "DECODED"),
            "exe_game_worklist_fallback": sum(
                1 for item in worklist if item["ledger"] == "FALLBACK"),
            "exe_game_worklist_unread": sum(
                1 for item in worklist if item["ledger"]
                not in ("DECODED", "FALLBACK", "ENCLOSING")),
            "exe_game_worklist_enclosing_only": sum(
                1 for item in worklist if item["ledger"] == "ENCLOSING"),
            "by_module": {module: dict(sorted(counts.items()))
                          for module, counts in sorted(by_module.items())},
        },
        "worklist": worklist,
        "rows": rows,
    }


def build(args) -> dict:
    corpus = load_corpus(args.inventory, args.semantics)
    result = engine.run(corpus, with_research=False)
    signals = signals_mod.load_all(corpus)
    families = result["families"]
    family_by_member = result["family_by_member"]

    topics, rounds = graph.assign(corpus, signals, families, family_by_member)
    seeded = graph.seed_topics(corpus, signals)
    ranked = information_gain(corpus, result, topics, signals, limit=args.top)
    checks = crosscheck(signals)
    explained = already_explained(result, signals, topics)
    vocab_bounds = vocabulary_bound_pairs(signals)
    ladder = semantic_ladder(corpus, result, topics, signals)

    validations = {}
    if not args.no_validate:
        for space in ("curated", "curated_direct", "ledger"):
            validations[space] = graph.validate(
                corpus, signals, families, family_by_member,
                space=space, folds=args.folds, semantics_path=args.semantics)

    by_basis: dict[str, int] = defaultdict(int)
    for topic in topics.values():
        by_basis[topic.basis] += 1

    family_resolved = sum(
        1 for family in families.values()
        if family.members and all(m in topics for m in family.members))

    candidates = result["candidates"]
    claim_touched = {fid for targets in signals.claim_functions.values() for fid in targets}

    document = {
        "schema_version": 1,
        "generated_by": "tools/build_semantic_graph.py",
        "rule_version": RULE_VERSION,
        "authority": ("candidate inference joined from existing sources; never proof of "
                      "original behaviour. Promotion runs through record-packets and the "
                      "ddw3-verify-handoff review, not through this file."),
        "design_note": ("Topics are never derived from call edges. That was measured at "
                        "30.2% against a 51.0% majority-class baseline on 2026-08-11 by "
                        "tools/infer_module_domains.py -- worse than guessing."),
        "corpus": {
            "functions": len(candidates),
            "named_by_existing_pipeline": sum(1 for c in candidates.values() if c["proposed_name"]),
            "curated_names": sum(1 for c in candidates.values() if c["name_basis"] == "curated"),
            "with_complete_c": sum(1 for c in candidates.values() if c["lift"] == "decompiled_c_complete"),
            "with_any_c": sum(1 for c in candidates.values() if c["lift"].startswith("decompiled")),
            "no_lift": sum(1 for c in candidates.values() if c["lift"] == "no_lift"),
            "with_structural_role": sum(1 for c in candidates.values() if c["role"]),
            "in_a_family": len(family_by_member),
            "families": len(families),
            "with_call_graph_context": sum(
                1 for fid, fn in corpus.functions.items()
                if fn.direct_calls or corpus.callers.get(fid)),
            "touched_by_a_ledger_claim": len(claim_touched),
        },
        "signals": signals.stats,
        "inference": {
            "functions_with_a_topic": len(topics),
            "seeded_directly_from_a_source": len(seeded),
            "gained_a_topic_by_inference": len(topics) - len(seeded),
            "by_basis": dict(sorted(by_basis.items(), key=lambda item: -item[1])),
            "distinct_topics": len({t.topic for t in topics.values()}),
            "families_fully_topic_covered": family_resolved,
            "convergence": rounds,
            "still_without_a_topic": len(candidates) - len(topics),
        },
        "validation": validations,
        "crosscheck": checks["summary"],
        "crosscheck_note": checks["note"],
        "already_explained_elsewhere": len(explained),
        "vocabulary_bound_pairs": vocab_bounds,
        "semantic_ladder": {k: v for k, v in ladder.items() if k != "states"},
        "semantic_state": ladder["states"],
        "ranking": ranked,
        "already_explained": explained[:args.top],
        "crosscheck_detail": {
            key: value[:150] for key, value in checks.items() if isinstance(value, list)
        },
        "topics": {fid: topic.as_dict() for fid, topic in sorted(topics.items())},
        "text_banks": signals.banks,
    }
    def _optional(path: Path) -> dict | None:
        return json.loads(path.read_text()) if path and path.is_file() else None

    table = function_table(
        corpus, result, topics, ladder["states"], family_by_member,
        _optional(getattr(args, "disposition", DISPOSITION_PATH)),
        _optional(getattr(args, "catalog", CATALOG_PATH)),
        _optional(getattr(args, "traces", TRACES_PATH)),
    )
    return document, table


# --------------------------------------------------------------------------
# commands
# --------------------------------------------------------------------------

def cmd_build(args) -> int:
    document, table = build(args)
    GRAPH_PATH.parent.mkdir(parents=True, exist_ok=True)
    GRAPH_PATH.write_text(json.dumps(document, indent=2, default=str) + "\n")
    FUNCTION_TABLE_PATH.write_text(json.dumps(table, indent=2, default=str) + "\n")
    print(json.dumps({
        "corpus": document["corpus"],
        "signals": document["signals"],
        "inference": document["inference"],
        "validation": document["validation"],
        "crosscheck": document["crosscheck"],
        "already_explained_elsewhere": document["already_explained_elsewhere"],
        "vocabulary_bound_pairs": len(document["vocabulary_bound_pairs"]),
        "semantic_ladder": document["semantic_ladder"]["counts"],
        "function_table": table["summary"],
        "unresolved_functions": document["ranking"]["unresolved_functions"],
        "written": GRAPH_PATH.relative_to(REPO_ROOT).as_posix(),
    }, indent=2))
    return 0


def _load(path: Path) -> dict:
    if not path.is_file():
        print(f"no graph at {path}; run: python3 tools/build_semantic_graph.py build",
              file=sys.stderr)
        raise SystemExit(2)
    return json.loads(path.read_text())


def cmd_stats(args) -> int:
    document = _load(args.graph)
    for section in ("corpus", "signals", "inference", "crosscheck"):
        print(f"== {section}")
        print(json.dumps(document[section], indent=2))
    return 0


def cmd_validate(args) -> int:
    document = _load(args.graph)
    print(json.dumps(document["validation"], indent=2))
    return 0


def cmd_rank(args) -> int:
    document = _load(args.graph)
    rows = document["ranking"]["topic_gain"][:args.limit]
    if not rows:
        print("no unresolved function would release a topic to another; "
              "the residue is isolated code, listed under structural_leverage")
    width = max((len(row["id"]) for row in rows), default=10)
    print(f"{'gain':>6} {'unlocks':>7}  {'via':<13} {'id':<{width}}  evidence")
    for row in rows:
        print(f"{row['gain']:>6} {row['unlockable_unknowns']:>7}  {row['via']:<13} "
              f"{row['id']:<{width}}  {','.join(row['evidence_classes'])}")
        print(f"{'':>16}{row['why']}")
        if row["lexicon"]:
            print(f"{'':>16}game words: {', '.join(row['lexicon'])}")
    print("\n-- structural leverage (high fan-in, no topic transfer) --")
    for row in document["ranking"]["structural_leverage"][:args.limit]:
        print(f"{row['callers']:>6} callers  {row['id']}  "
              f"{','.join(row['evidence_classes']) or 'no joined evidence'}  [{row['lift']}]")
    return 0


def cmd_show(args) -> int:
    document = _load(args.graph)
    for fid in args.id:
        print(f"== {fid}")
        topic = document["topics"].get(fid)
        if not topic:
            print("  no topic: nothing in the repository labels this function")
        else:
            print(f"  topic {topic['topic']}  score {topic['score']}  "
                  f"basis {topic['basis']}  donor {topic['donor']}  hops {topic['hops']}")
            for line in topic["evidence"]:
                print(f"    {line}")
        for row in document["ranking"]["topic_gain"]:
            if row["id"] == fid:
                print(f"  information gain {row['gain']}: {row['why']}")
        for row in document["already_explained"]:
            if row["id"] == fid:
                print(f"  ALREADY EXPLAINED elsewhere (authority {row['best_authority']}): "
                      f"{', '.join(row['explained_by'])}")
    return 0


def cmd_crosscheck(args) -> int:
    document = _load(args.graph)
    print(json.dumps(document["crosscheck"], indent=2))
    print(document["crosscheck_note"])
    for row in document["crosscheck_detail"].get(args.bucket, [])[:args.limit]:
        print(f"- {row['document']}:{row['line']} -> {row['function_id']}")
        print(f"    {row['statement'][:150]}")
        print(f"    {row['reason']}")
    return 0


def cmd_explained(args) -> int:
    document = _load(args.graph)
    print(f"{document['already_explained_elsewhere']} functions carry ledger or "
          f"text-bank evidence but no name from the inference pipeline")
    for row in document["already_explained"][:args.limit]:
        print(f"- {row['id']} (authority {row['best_authority']}, topic {row['topic']})")
        print(f"    {', '.join(row['explained_by'])}")
    return 0


def cmd_avenues(args) -> int:
    """Score every repository-derived route to the residue.

    The pipeline working is not the finish line. The finish line is being able
    to say, for each source of signal the repository holds, that it is either
    exploited, measured and rejected, or structurally unable to reach what is
    left -- so "what else could we try?" has an answer that is not a shrug.
    """
    document = _load(args.graph)
    residue = {fid for fid, state in document["semantic_state"].items()
               if state == "opaque"}
    report = avenues.register(residue)
    if args.json:
        print(json.dumps(report, indent=1))
        return 0
    print(f"residue = {report['residue']} functions with nothing usable\n")
    for row in report["avenues"]:
        reach = (f"reaches {row['reaches_residue']}" if row["reaches_residue"]
                 else "reaches none")
        rows = f"{row['rows']} rows" if row["rows"] else "-"
        print(f"[{row['verdict']:9}] {row['avenue']:30} {rows:>14}  {reach}")
        if args.verbose and row["note"]:
            for line in textwrap.wrap(row["note"], 76):
                print(f"              {line}")
    print("\nverdicts: " + ", ".join(f"{k}={v}" for k, v in
                                     sorted(report["verdicts"].items())))
    if report["open_work"]:
        print("still reaching the residue: " + ", ".join(report["open_work"]))
    else:
        print("no untested avenue reaches the residue")
    return 0


def cmd_residue(args) -> int:
    """Say, for every function still unknown, WHY nothing is known about it."""
    document = _load(args.graph)
    residue = {fid for fid, state in document["semantic_state"].items()
               if state == "opaque"}
    report = avenues.characterize(residue)
    if args.json:
        print(json.dumps(report, indent=1))
        return 0
    print(f"{report['residue']} functions with nothing usable:\n")
    for bucket, count in report["buckets"].items():
        print(f"  {count:5}  {bucket}")
        for fid in report["members"][bucket][:args.limit]:
            print(f"           {fid}")
    print(f"\nmanual queue (code the lifter declined): {report['manual_queue']}")
    for line in textwrap.wrap(report["note"], 76):
        print(f"  {line}")
    return 0


def cmd_words(args) -> int:
    document = _load(args.graph)
    rows = document["vocabulary_bound_pairs"]
    print(f"{len(rows)} functions draw a known on-screen word AND carry an "
          f"extracted bound. Candidates to read, not findings.\n")
    for row in rows[:args.limit]:
        print(f"- {row['id']}")
        print(f"    words : {' | '.join(w[:44] for w in row['words'][:4])}")
        print(f"    bounds: {', '.join(row['bounds'][:6])}")
    return 0


def cmd_report(args) -> int:
    document = _load(args.graph)
    lines = [
        "# Semantic evidence graph",
        "",
        "Generated by `tools/build_semantic_graph.py`. **Candidate inference only.**",
        "Nothing here is a decoded claim; promotion runs through `record-packets`",
        "and the `ddw3-verify-handoff` review as usual.",
        "",
        f"> {document['design_note']}",
        "",
        "## Corpus, counted from disk",
        "", "| measure | count |", "| --- | --- |",
    ]
    lines += [f"| {k.replace('_', ' ')} | {v} |" for k, v in document["corpus"].items()]
    lines += ["", "## Semantic state ladder", "",
              "| state | functions |", "| --- | --- |"]
    for state, count in document["semantic_ladder"]["counts"].items():
        lines.append(f"| {state} | {count} |")
    lines += ["", document["semantic_ladder"]["note"]]
    lines += ["", "## Joined signals", "", "| signal | count |", "| --- | --- |"]
    lines += [f"| {k.replace('_', ' ')} | {v} |" for k, v in document["signals"].items()]
    lines += ["", "## Topic assignment", "", "| measure | value |", "| --- | --- |"]
    for key, value in document["inference"].items():
        if key in ("convergence", "by_basis"):
            continue
        lines.append(f"| {key.replace('_', ' ')} | {value} |")
    for basis, count in document["inference"]["by_basis"].items():
        lines.append(f"| by basis: {basis} | {count} |")
    lines += ["", "Convergence: " + ", ".join(
        f"round {r['round']}: {r['topics_changed']} changed"
        for r in document["inference"]["convergence"])]

    lines += ["", "## Measured accuracy (leak-free hold-out)", ""]
    for space, scores in document["validation"].items():
        if "skipped" in scores:
            lines.append(f"- **{space}**: {scores['skipped']}")
            continue
        lines += [
            f"### {space} label space",
            "",
            f"- {scores['labelled_functions']} labelled functions, "
            f"{scores['distinct_labels']} distinct labels, {scores['folds']} folds",
            f"- majority-class baseline: **{scores['majority_class_baseline']:.1%}** "
            f"(`{scores['majority_class']}`)",
            f"- coverage: {scores['coverage']:.1%} of held-out functions got a prediction",
            f"- accuracy where predicted: **{scores['accuracy_where_predicted']:.1%}**",
            f"- accuracy over all labelled: {scores['accuracy_over_all_labelled']:.1%}",
            f"- verdict: {scores['verdict']}",
            "",
            "| basis | predictions | accuracy |", "| --- | --- | --- |",
        ]
        for basis, row in scores["per_basis"].items():
            accuracy = f"{row['accuracy']:.1%}" if row["accuracy"] is not None else "n/a"
            lines.append(f"| {basis} | {row['predictions']} | {accuracy} |")
        lines.append("")

    lines += ["## Research prose cross-check", "", "| bucket | statements |", "| --- | --- |"]
    lines += [f"| {k.replace('_', ' ')} | {v} |" for k, v in document["crosscheck"].items()]
    lines += ["", document["crosscheck_note"], "",
              "## Highest information-gain unresolved targets", "",
              "| gain | unlocks | via | function | evidence |",
              "| --- | --- | --- | --- | --- |"]
    for row in document["ranking"]["topic_gain"][:25]:
        lines.append(f"| {row['gain']} | {row['unlockable_unknowns']} | {row['via']} | "
                     f"`{row['id']}` | {', '.join(row['evidence_classes'])} |")
    lines += ["", "## Structural leverage (high fan-in; no topic transfer)", "",
              "| callers | function | lift |", "| --- | --- | --- |"]
    for row in document["ranking"]["structural_leverage"][:15]:
        lines.append(f"| {row['callers']} | `{row['id']}` | {row['lift']} |")
    lines.append("")
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text("\n".join(lines))
    print(f"wrote {REPORT_PATH.relative_to(REPO_ROOT)}")

    table = _load(FUNCTION_TABLE_PATH)
    if table:
        FUNCTION_TABLE_REPORT_PATH.write_text(function_table_report(table))
        print(f"wrote {FUNCTION_TABLE_REPORT_PATH.relative_to(REPO_ROOT)}")
    return 0


def function_table_report(table: dict) -> str:
    summary = table["summary"]
    rows = table["rows"]
    lines = [
        "---",
        "reach: Reading the per-function coverage table, finding the resident worklist, or checking which functions the runtime traces observed.",
        "status: generated",
        "---",
        "",
        "# Resident function table",
        "",
        "Generated by `tools/build_semantic_graph.py build` and written by "
        "`report`. **Navigation only** -- every column quotes its own source; "
        "none of this is a new claim. The machine-readable rows are "
        "`docs/generated/function-table.json`.",
        "",
        f"> {table['note']}",
        "",
        "## State at a glance",
        "",
        "| semantic state | functions |",
        "| --- | --- |",
    ]
    lines += [f"| {state} | {count} |" for state, count in summary["by_state"].items()]
    lines += [
        "",
        "`readable` and `opaque` are the reading residue. `named` means the "
        "pipeline or the curator has an identity; it does not mean the behavior "
        "is verified.",
        "",
        "## Disposition (resident executable)",
        "",
        "| disposition | functions |",
        "| --- | --- |",
    ]
    lines += [f"| {name} | {count} |"
              for name, count in summary["by_disposition"].items() if name != "not-resident"]
    lines += [
        "",
        f"`observed_functions` = {summary['observed_functions']} (what the runtime "
        "traces have executed so far; empty until `docs/generated/resident-traces.json` "
        "exists).",
        "",
        f"## exe game-zone worklist ({summary['exe_game_worklist']} unnamed; "
        f"{summary['exe_game_named']} already named)",
        "",
        f"Of the unnamed functions, **{summary['exe_game_worklist_anchored']} are "
        "anchored by a live claim at a precise assembly extent** (the only "
        "`ledger: DECODED` rows); "
        f"{summary['exe_game_worklist_fallback']} have a claim only under the "
        "decompiler's 0x400 fallback window, which can absorb a neighbour's "
        "evidence and must be checked; "
        f"{summary['exe_game_worklist_enclosing_only']} are anchored only inside a "
        f"neighbouring function (establishes nothing); "
        f"{summary['exe_game_worklist_unread']} are genuinely unread or mention-only. "
        f"{summary.get('exe_game_labels_excluded', 0)} more inventory starts are labels inside another "
        "routine (jump-table case bodies) and are held out of the worklist by "
        "`recovered/ddw3/interior-labels.json`. "
        "`ledger` is the `dw3-research known` verdict, not the `semantics.json` "
        "recovery mark, so it can say DECODED while `verification` is empty.",
        "",
        "Unnamed resident game functions, ordered by direct callers. This is the "
        "reading frontier; `observed_in` is the evidence that the function runs in "
        "a captured state.",
        "",
        "| address | state | name | callers | ledger | verification | observed |",
        "| --- | --- | --- | ---: | --- | --- | --- |",
    ]
    for row in table["worklist"][:150]:
        lines.append(
            f"| `{row['address']}` | {row['state']} | {row['name'] or ''} | "
            f"{row['direct_callers']} | {row.get('ledger') or ''} | "
            f"{row['verification'] or ''} | "
            f"{', '.join(row['observed_in']) or ''} |")
    if len(table["worklist"]) > 150:
        lines.append(f"| ... {len(table['worklist']) - 150} more rows in the JSON | | | | | | |")
    lines += [
        "",
        "## Modules with reading residue or observed execution",
        "",
        "| module | functions | named | readable | opaque | observed |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
    ]
    for module, counts in sorted(
            summary["by_module"].items(),
            key=lambda item: (-(item[1].get("readable", 0) + item[1].get("opaque", 0)),
                              item[0])):
        if not (counts.get("readable") or counts.get("opaque") or counts.get("observed")):
            continue
        lines.append(
            f"| {module} | {counts.get('functions', 0)} | {counts.get('named', 0)} | "
            f"{counts.get('readable', 0)} | {counts.get('opaque', 0)} | "
            f"{counts.get('observed', 0)} |")
    lines += [
        "",
        "## What this table is not",
        "",
        "- A `named` row is an identity, not a behaviour: `forward_to_*` and "
        "`thunk_fns_*` entries are mechanical names.",
        "- `verification` quotes `semantics.json`; a `readable` row with a name "
        "has not been through the review gate.",
        "- `ledger` quotes the `dw3-research known` verdict at this address. "
        "`DECODED` requires a precise `.s` extent; `FALLBACK` means the claim is "
        "only inside a decompiled-only 0x400 window and may describe a neighbour.",
        "- `disposition: library_unidentified` is the signature database failing "
        "to name a resident library routine (most of the sound driver), not game code.",
        "- `observed_in` is populated only from the machine-local RAM dump corpus; "
        "an empty cell means unobserved, not unreachable.",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--inventory", type=Path, default=INVENTORY_PATH)
    parser.add_argument("--semantics", type=Path, default=SEMANTICS_PATH)
    parser.add_argument("--graph", type=Path, default=GRAPH_PATH)
    sub = parser.add_subparsers(dest="command", required=True)

    b = sub.add_parser("build")
    b.add_argument("--top", type=int, default=200)
    b.add_argument("--folds", type=int, default=5)
    b.add_argument("--no-validate", action="store_true")
    b.add_argument("--disposition", type=Path, default=DISPOSITION_PATH)
    b.add_argument("--catalog", type=Path, default=CATALOG_PATH)
    b.add_argument("--traces", type=Path, default=TRACES_PATH)
    b.set_defaults(func=cmd_build)

    sub.add_parser("stats").set_defaults(func=cmd_stats)
    sub.add_parser("validate").set_defaults(func=cmd_validate)

    r = sub.add_parser("rank")
    r.add_argument("--limit", type=int, default=25)
    r.set_defaults(func=cmd_rank)

    s = sub.add_parser("show")
    s.add_argument("id", nargs="+")
    s.set_defaults(func=cmd_show)

    c = sub.add_parser("crosscheck")
    c.add_argument("--bucket", default="mechanically_provable_now")
    c.add_argument("--limit", type=int, default=20)
    c.set_defaults(func=cmd_crosscheck)

    e = sub.add_parser("explained")
    e.add_argument("--limit", type=int, default=25)
    e.set_defaults(func=cmd_explained)

    w = sub.add_parser("words")
    w.add_argument("--limit", type=int, default=30)
    w.set_defaults(func=cmd_words)

    d = sub.add_parser("residue")
    d.add_argument("--json", action="store_true")
    d.add_argument("--limit", type=int, default=0)
    d.set_defaults(func=cmd_residue)

    a = sub.add_parser("avenues")
    a.add_argument("--json", action="store_true")
    a.add_argument("--verbose", action="store_true")
    a.set_defaults(func=cmd_avenues)

    sub.add_parser("report").set_defaults(func=cmd_report)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
