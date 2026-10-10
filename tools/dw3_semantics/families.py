"""Deterministic clustering of homologous function bodies.

Three tiers of decreasing strength. **Only `exact` carries a name between
members.** A `parameterized` cluster shares only a shape with its integers,
globals and callees erased, and the audit found 15 such clusters merging
differently-named functions (`title-draw-fullscreen-a` with `-b`,
`menuPanelObjectConstruct` with `fade_object_create`, ...), so a parameterised
match is a review lead, not a naming warrant. `structural` is likewise a lead.
Bodies that are empty or below the triviality floor are quarantined rather than
clustered, because a forwarder shape is shared by unrelated functions and a
shared *address* is not a family at all.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

# A body must do at least this much before shape alone is allowed to carry a
# name. Below it, dozens of unrelated one-line forwarders collapse together.
TRIVIALITY_FLOOR = 4


@dataclass
class Family:
    id: str
    tier: str
    fingerprint: str
    members: list[str]
    modules: list[str]
    statements: int
    parameters: dict[str, dict] = field(default_factory=dict)
    representative: str | None = None

    @property
    def member_count(self) -> int:
        return len(self.members)

    @property
    def can_carry_name(self) -> bool:
        # Exact-tier only. A parameterised match erases the integers, globals
        # and callees that distinguish two differently-named functions, so it
        # may not carry a name (audit FP-2: 15 such over-merges).
        return self.tier == "exact" and self.statements >= TRIVIALITY_FLOOR


def _control_signature(features) -> tuple:
    return tuple(sorted((k, v) for k, v in features.control.items() if v))


def build_families(corpus) -> tuple[dict[str, Family], dict[str, list[str]]]:
    """Cluster bodies. Returns (families by id, quarantine buckets)."""
    quarantine: dict[str, list[str]] = defaultdict(list)
    usable: list = []
    for fn in corpus.functions.values():
        features = fn.features
        if features is None or not features.parsed:
            quarantine["no_parsable_body"].append(fn.id)
            continue
        if features.empty:
            # Two incompatible causes -- a genuine jr $ra stub and a false
            # boundary -- that the C text cannot distinguish. Never cluster.
            quarantine["trivial_empty_body_requires_triage"].append(fn.id)
            continue
        if features.statements < TRIVIALITY_FLOOR:
            quarantine["below_triviality_floor"].append(fn.id)
            continue
        usable.append(fn)

    exact_groups: dict[str, list] = defaultdict(list)
    for fn in usable:
        exact_groups[fn.features.exact_hash].append(fn)

    families: dict[str, Family] = {}
    clustered: set[str] = set()
    for fingerprint, members in sorted(exact_groups.items()):
        if len(members) < 2:
            continue
        family = Family(
            id=f"exact:{fingerprint[:12]}",
            tier="exact",
            fingerprint=fingerprint,
            members=sorted(fn.id for fn in members),
            modules=sorted({fn.module for fn in members}),
            statements=members[0].features.statements,
        )
        families[family.id] = family
        clustered.update(family.members)

    shape_groups: dict[str, list] = defaultdict(list)
    for fn in usable:
        shape_groups[fn.features.shape_hash].append(fn)
    for fingerprint, members in sorted(shape_groups.items()):
        distinct_exact = {fn.features.exact_hash for fn in members}
        if len(members) < 2 or len(distinct_exact) < 2:
            continue
        family = Family(
            id=f"param:{fingerprint[:12]}",
            tier="parameterized",
            fingerprint=fingerprint,
            members=sorted(fn.id for fn in members),
            modules=sorted({fn.module for fn in members}),
            statements=members[0].features.statements,
            parameters={
                fn.id: {
                    "constants": sorted(set(fn.features.constants)),
                    "globals": fn.features.globals,
                    "callees": sorted(set(fn.features.direct_calls)),
                }
                for fn in members
            },
        )
        families[family.id] = family
        clustered.update(family.members)

    structural_groups: dict[tuple, list] = defaultdict(list)
    for fn in usable:
        if fn.id in clustered:
            continue
        structural_groups[(fn.features.struct_hash, _control_signature(fn.features))].append(fn)
    for key, members in sorted(structural_groups.items(), key=lambda item: str(item[0])):
        if len(members) < 3:
            continue
        family = Family(
            id=f"struct:{key[0][:12]}",
            tier="structural",
            fingerprint=key[0],
            members=sorted(fn.id for fn in members),
            modules=sorted({fn.module for fn in members}),
            statements=min(fn.features.statements for fn in members),
        )
        families[family.id] = family

    for family in families.values():
        family.representative = _pick_representative(corpus, family)
    return families, dict(quarantine)


def _pick_representative(corpus, family: Family) -> str:
    """Prefer a curated member, then the strongest entry evidence."""
    curated = corpus.curated_ids()
    ranked = sorted(
        family.members,
        key=lambda fid: (
            fid not in curated,
            not corpus.functions[fid].strong_entry_evidence,
            not corpus.functions[fid].features.complete,
            fid,
        ),
    )
    return ranked[0]


def family_index(families: dict[str, Family]) -> dict[str, list[str]]:
    index: dict[str, list[str]] = defaultdict(list)
    for family in families.values():
        for member in family.members:
            index[member].append(family.id)
    return dict(index)
