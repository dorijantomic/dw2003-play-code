"""Structural role classification.

Each rule returns a verdict carrying an explicit evidence class. Rules marked
`mechanical` are decided entirely by the recovered body -- they are the only
ones eligible for automatic application. Everything else is a heuristic lead
whose confidence is capped regardless of how often it happens to be right.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# The two shared object factories the inventory already resolves call arguments
# for. Treated as known by address, not by name.
FACTORY_IDS = frozenset({"exe/fns:F0x800143dc", "exe/fns:F0x80014504"})

RETURN_OF_CALL_RE = re.compile(r"^\s*(?:return\s+)?F0x[0-9a-fA-F]{8}\s*\(")


@dataclass
class RoleVerdict:
    role: str
    confidence: float
    evidence_class: str
    evidence: list[str] = field(default_factory=list)
    mechanical: bool = False
    detail: dict = field(default_factory=dict)


def _slots(features):
    """Distinct (base, offset) slots, split by whether they are written."""
    reads = {(a.base, a.offset) for a in features.accesses if not a.write}
    writes = {(a.base, a.offset) for a in features.accesses if a.write}
    return reads - writes, writes


def _rule_getter(fn, features, ctx) -> RoleVerdict | None:
    reads, writes = _slots(features)
    if writes or len(reads) != 1 or features.call_count:
        return None
    if features.statements > 3 or not features.returns or features.return_type == "void":
        return None
    base, offset = next(iter(reads))
    parameters = {name for name, _ in features.params}
    if base not in parameters:
        return None
    # The value read must be the value returned, directly or through one local.
    returned = features.returns[0].lower()
    forwarded = {
        lhs.strip().lower() for lhs, rhs in features.assignments
        if f"unk{offset:x}" in rhs.lower()
    }
    if f"unk{offset:x}" not in returned and returned not in forwarded:
        return None
    return RoleVerdict(
        "getter", 0.95, "body_shape", mechanical=True,
        evidence=[f"reads only {base}+0x{offset:x} and returns it; no writes, no calls"],
        detail={"offset": offset, "receiver": base},
    )


def _rule_setter(fn, features, ctx) -> RoleVerdict | None:
    reads, writes = _slots(features)
    if len(writes) != 1 or reads or features.call_count:
        return None
    if features.statements > 3 or features.returns or features.return_type != "void":
        return None
    base, offset = next(iter(writes))
    parameters = [name for name, _ in features.params]
    if base not in parameters:
        return None
    values = [
        rhs.strip() for lhs, rhs in features.assignments
        if f"unk{offset:x}" in lhs.lower()
    ]
    if not any(value in parameters for value in values):
        return None
    return RoleVerdict(
        "setter", 0.95, "body_shape", mechanical=True,
        evidence=[f"writes a parameter to {base}+0x{offset:x} and nothing else"],
        detail={"offset": offset, "receiver": base},
    )


def _rule_wrapper(fn, features, ctx) -> RoleVerdict | None:
    if len(features.direct_calls) != 1 or features.slot_calls:
        return None
    if features.statements > 2 or features.accesses:
        return None
    callee = features.direct_calls[0]
    return RoleVerdict(
        "wrapper", 0.9, "body_shape", mechanical=True,
        evidence=[f"body forwards to {callee} with no other statements"],
        detail={"callee": callee},
    )


def _rule_constructor(fn, features, ctx) -> RoleVerdict | None:
    factories = [c for c in ctx["direct_call_ids"](fn) if c in FACTORY_IDS]
    if not factories:
        return None
    writes = [a for a in features.accesses if a.write]
    if not writes:
        return None
    return RoleVerdict(
        "constructor", 0.7, "call_graph",
        evidence=[f"calls shared object factory {factories[0]} then initialises "
                  f"{len({a.offset for a in writes})} slots"],
        detail={"factory": factories[0]},
    )


def _rule_field_clear(fn, features, ctx) -> RoleVerdict | None:
    """Zeroing several slots.

    Deliberately **not** reported as a destructor. Clearing fields is equally
    the shape of an initialiser, a reset and a teardown, and no deallocation
    function has been established in this corpus to tell them apart. Calling
    this a destructor would be a name claim the body does not support.
    """
    cleared = sorted({
        a.offset for a in features.accesses
        if a.write and any(
            rhs.strip() in ("0", "NULL") and f"unk{a.offset:x}" in lhs.lower()
            for lhs, rhs in features.assignments
        )
    })
    if len(cleared) < 2 or features.returns or features.return_type != "void":
        return None
    return RoleVerdict(
        "field_clear", 0.45, "body_shape",
        evidence=[
            f"zeroes slots {', '.join(hex(o) for o in cleared)} and returns nothing; "
            "initialiser, reset and teardown are all consistent with this shape",
        ],
        detail={"cleared": cleared,
                "alternatives": ["constructor", "destructor", "reset"]},
    )


def _rule_state_transition(fn, features, ctx) -> RoleVerdict | None:
    constants = [
        (lhs, rhs) for lhs, rhs in features.assignments
        if re.search(r"->unk[0-9A-Fa-f]+$", lhs.strip()) and re.fullmatch(r"0[xX][0-9a-fA-F]+|\d+", rhs.strip())
    ]
    if len(constants) != 1 or features.statements > 6 or features.call_count > 1:
        return None
    lhs, rhs = constants[0]
    offset = int(re.search(r"unk([0-9A-Fa-f]+)$", lhs.strip()).group(1), 16)
    return RoleVerdict(
        "state_transition", 0.6, "body_shape",
        evidence=[f"writes literal {rhs} to slot +0x{offset:x} of its receiver"],
        detail={"offset": offset, "value": rhs},
    )


def _rule_dispatcher(fn, features, ctx) -> RoleVerdict | None:
    cases = features.control.get("case", 0)
    indexed_slot_calls = [b for b, _ in features.slot_calls if "[" in b or "+" in b]
    if cases >= 3:
        return RoleVerdict(
            "dispatcher", 0.8, "body_shape",
            evidence=[f"switch with {cases} cases selects the action"],
            detail={"cases": cases},
        )
    if indexed_slot_calls:
        return RoleVerdict(
            "dispatcher", 0.6, "body_shape",
            evidence=[f"calls through an indexed slot ({indexed_slot_calls[0]})"],
        )
    return None


def _rule_table_lookup(fn, features, ctx) -> RoleVerdict | None:
    if features.call_count or not features.returns or features.return_type == "void":
        return None
    if features.statements > 4 or not features.globals:
        return None
    if not any(
        op in features.body for op in ("*", "<<", "[")
    ):
        return None
    return RoleVerdict(
        "table_lookup", 0.6, "body_shape",
        evidence=[f"indexes global {features.globals[0]} and returns the element"],
        detail={"table": features.globals[0]},
    )


def _rule_poller(fn, features, ctx) -> RoleVerdict | None:
    if features.call_count or features.returns == []:
        return None
    if not features.control.get("if") or features.return_type == "void":
        return None
    reads = [a for a in features.accesses if not a.write]
    writes = [a for a in features.accesses if a.write]
    if not reads or len(writes) > 1 or features.statements > 8:
        return None
    if not all(re.fullmatch(r"[01]", r.strip()) for r in features.returns if r.strip()):
        return None
    return RoleVerdict(
        "poller", 0.55, "body_shape",
        evidence=["reads receiver state, branches, and returns only 0 or 1"],
    )


RULES = (
    _rule_getter,
    _rule_setter,
    _rule_wrapper,
    _rule_constructor,
    _rule_field_clear,
    _rule_state_transition,
    _rule_dispatcher,
    _rule_table_lookup,
    _rule_poller,
)

# Roles that describe genuinely different behavior. Two of these firing at once
# is a contradiction, not a refinement.
INCOMPATIBLE = (
    frozenset({"getter", "setter"}),
    frozenset({"getter", "dispatcher"}),
    frozenset({"setter", "table_lookup"}),
    frozenset({"constructor", "field_clear"}),
    frozenset({"wrapper", "dispatcher"}),
)


def classify(fn, corpus) -> tuple[list[RoleVerdict], list[str]]:
    """Return (verdicts ranked by confidence, contradictions)."""
    features = fn.features
    if features is None or not features.parsed or features.empty:
        return [], []
    ctx = {
        "direct_call_ids": lambda f: [
            c.get("target_id") for c in f.direct_calls if c.get("target_id")
        ],
    }
    verdicts: list[RoleVerdict] = []
    for rule in RULES:
        try:
            verdict = rule(fn, features, ctx)
        except (AttributeError, IndexError, ValueError):
            continue
        if verdict is not None:
            verdicts.append(verdict)

    roles = {v.role for v in verdicts}
    contradictions = [
        f"incompatible roles both matched: {' and '.join(sorted(pair))}"
        for pair in INCOMPATIBLE if pair <= roles
    ]
    if contradictions:
        for verdict in verdicts:
            verdict.confidence *= 0.5
            verdict.mechanical = False
    verdicts.sort(key=lambda v: -v.confidence)
    return verdicts, contradictions
