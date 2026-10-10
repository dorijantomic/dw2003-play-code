"""Leak-free validation of the inference rules against curated ground truth.

Four capabilities are benchmarked **separately**, because they are not the same
skill and a high score on one says nothing about the others. Recognising that a
three-line body reads one slot and returns it is easy; deciding that a function
is `launchEncounter` is not.

Leakage is prevented on three fronts:

* the inventory used for inference is rebuilt with no curated semantics at all,
  so no entry exists, and no boundary is drawn, because a human named it;
* curated names are withheld for every held-out id, along with the
  `curated_semantics` entry-evidence marker that would reveal membership;
* folds are split by whole **group**, where a group unions every module with
  every family that spans it, so no member of a homolog family is ever in a
  different fold from its peers.
"""

from __future__ import annotations

import re
from collections import defaultdict

from . import engine
from .corpus import load_corpus

# Proxy role labels derived from curated names and signatures. This is an
# approximation -- the curated layer has no independent role field -- and is
# reported as such.
ROLE_HINTS = (
    (re.compile(r"^(get|read|fetch|lookup)[A-Z_]"), {"getter", "table_lookup"}),
    (re.compile(r"^(set|write|store|assign)[A-Z_]"), {"setter"}),
    (re.compile(r"^(is|has|can|should)[A-Z_]"), {"poller"}),
    (re.compile(r"^(create|new|init|alloc|make|build)[A-Z_]"), {"constructor"}),
    (re.compile(r"^(free|destroy|release|close|delete|reset|clear)[A-Z_]"), {"field_clear"}),
    (re.compile(r"(tick|update|advance|step|poll)"), {"poller", "state_transition"}),
    (re.compile(r"(dispatch|handle|exec|run|command)"), {"dispatcher"}),
    (re.compile(r"(start|begin|open|enter)"), {"state_transition", "constructor"}),
)


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, item: str) -> str:
        self.parent.setdefault(item, item)
        while self.parent[item] != item:
            self.parent[item] = self.parent[self.parent[item]]
            item = self.parent[item]
        return item

    def union(self, left: str, right: str) -> None:
        a, b = self.find(left), self.find(right)
        if a != b:
            self.parent[b] = a


def build_groups(truth) -> dict[str, str]:
    """Assign every curated id to a group that no fold may split."""
    union = UnionFind()
    for fid in truth.curated_ids():
        union.union(f"module:{fid.split(':')[0]}", fid)
    for name, family in truth.curated_families.items():
        members = list(family.get("members", {}))
        if not members:
            continue
        anchor = f"family:{name}"
        for member in members:
            union.union(anchor, member)
            union.union(anchor, f"module:{member.split(':')[0]}")
    return {fid: union.find(fid) for fid in truth.curated_ids()}


def make_folds(groups: dict[str, str], folds: int) -> list[set[str]]:
    by_group: dict[str, list[str]] = defaultdict(list)
    for fid, group in groups.items():
        by_group[group].append(fid)
    # Largest groups first into the currently smallest fold, so folds stay even
    # despite very uneven group sizes.
    buckets: list[set[str]] = [set() for _ in range(folds)]
    for _, members in sorted(by_group.items(), key=lambda item: (-len(item[1]), item[0])):
        target = min(buckets, key=len)
        target.update(members)
    return buckets


# Roles any proxy label can produce. A rule whose role is absent here can never
# score against these labels, so reporting 0% for it would be an artifact of the
# label set rather than a measurement of the rule.
PROXY_ROLES = frozenset().union(*(roles for _, roles in ROLE_HINTS))


def _expected_roles(name: str) -> set[str]:
    expected: set[str] = set()
    for pattern, roles in ROLE_HINTS:
        if pattern.search(name):
            expected |= roles
    return expected


def _curated_name(truth, fid: str) -> str | None:
    """Ground-truth name from semantics.json.

    Never read from the inventory: the holdout inventory is built with no
    curated semantics at all, so its `semantic_name` fields are empty by
    design and would silently reduce the benchmark to family members only.
    """
    entry = truth.curated.get(fid)
    if entry and entry.get("name"):
        return entry["name"]
    for family in truth.curated_families.values():
        if fid in family.get("members", {}):
            return family["members"][fid]
    return None


def _curated_signature(truth, fid: str) -> str | None:
    entry = truth.curated.get(fid)
    if entry:
        return entry.get("signature")
    for family in truth.curated_families.values():
        if fid in family.get("members", {}):
            return family["template"].get("signature")
    return None


def _signature_shape(text: str) -> tuple[str, int] | None:
    match = re.match(r"^\s*([\w \*]+?)\s*\w+\s*\((?P<args>[^)]*)\)", text or "")
    if not match:
        return None
    args = match.group("args").strip()
    count = 0 if args in ("", "void") else len([a for a in args.split(",") if a.strip()])
    return ("void" if match.group(1).strip() == "void" else "value", count)


def _name_stem(name: str) -> str:
    return re.split(r"[_\d]", name)[0].lower()


def _drop_generated(truth) -> int:
    """Remove tool-written entries from the ground truth.

    Once `apply` has run, semantics.json contains entries this tool produced.
    Scoring against them would be measuring the tool against itself. They are
    dropped from the truth set entirely, which also keeps them out of every
    training fold, so validation runs as though they had never been written.
    """
    generated = [
        fid for fid, entry in truth.curated.items()
        if isinstance(entry, dict) and entry.get("generated")
    ]
    for fid in generated:
        del truth.curated[fid]
    return len(generated)


def run(holdout_inventory, semantics_path, *, folds: int = 4) -> dict:
    truth = load_corpus(holdout_inventory, semantics_path)
    generated_excluded = _drop_generated(truth)
    groups = build_groups(truth)
    buckets = make_folds(groups, folds)

    name_hits = name_total = name_proposed = 0
    role_hits = role_total = role_predicted = 0
    sig_hits = sig_total = 0
    per_rule: dict[str, dict[str, int]] = defaultdict(lambda: {"fired": 0, "consistent": 0})
    failures: list[dict] = []
    leakage: list[str] = []

    for index, held_out in enumerate(buckets):
        training = set(truth.curated_ids()) - held_out
        corpus = load_corpus(holdout_inventory, semantics_path, keep_curated=training)
        for fid in held_out:
            fn = corpus.functions.get(fid)
            if fn is not None and (fn.curated_name or "curated_semantics" in fn.entry_evidence):
                leakage.append(fid)
        result = engine.run(corpus, with_research=False)
        candidates = result["candidates"]

        for fid in sorted(held_out):
            if fid not in candidates:
                continue
            candidate = candidates[fid]
            expected_name = _curated_name(truth, fid)
            if not expected_name:
                continue

            name_total += 1
            proposed = candidate["proposed_name"]
            if proposed:
                name_proposed += 1
                if _name_stem(proposed) == _name_stem(expected_name):
                    name_hits += 1
                else:
                    failures.append({
                        "fold": index, "id": fid, "benchmark": "semantic_name",
                        "expected": expected_name, "proposed": proposed,
                        "basis": candidate["name_basis"],
                        "confidence": candidate["confidence"],
                    })

            expected_roles = _expected_roles(expected_name)
            if expected_roles:
                role_total += 1
                if candidate["role"] is not None:
                    role_predicted += 1
                if candidate["role"] in expected_roles:
                    role_hits += 1
                elif candidate["role"] is not None:
                    failures.append({
                        "fold": index, "id": fid, "benchmark": "structural_role",
                        "expected": sorted(expected_roles), "proposed": candidate["role"],
                    })
            for verdict in candidate["roles"]:
                per_rule[verdict["role"]]["fired"] += 1
                if verdict["role"] in expected_roles:
                    per_rule[verdict["role"]]["consistent"] += 1

            expected_signature = _curated_signature(truth, fid)
            expected_shape = _signature_shape(expected_signature or "")
            proposed_shape = _signature_shape(candidate["signature"])
            if expected_shape and proposed_shape:
                sig_total += 1
                if expected_shape == proposed_shape:
                    sig_hits += 1
                else:
                    failures.append({
                        "fold": index, "id": fid, "benchmark": "signature",
                        "expected": expected_signature, "proposed": candidate["signature"],
                    })

    family_scores = _family_benchmark(holdout_inventory, semantics_path, truth)

    def ratio(hits: int, total: int) -> float | None:
        return round(hits / total, 4) if total else None

    return {
        "method": {
            "inventory": str(holdout_inventory),
            "folds": folds,
            "split": "group-wise; a group unions each module with every curated "
                     "family spanning it, so homolog peers never straddle a fold",
            "leakage_guard": "curated names, subsystems, families and the "
                             "curated_semantics entry-evidence marker are withheld "
                             "for held-out ids; the inventory itself is built with "
                             "no curated semantics",
        },
        "leakage_detected": sorted(set(leakage)),
        "generated_entries_excluded_from_truth": generated_excluded,
        "benchmarks": {
            "structural_role": {
                "support": role_total,
                "predicted": role_predicted,
                "correct": role_hits,
                "precision": ratio(role_hits, role_predicted),
                "coverage": ratio(role_predicted, role_total),
                "accuracy": ratio(role_hits, role_total),
                "caveat": "labels are a proxy derived from curated names; the "
                          "curated layer carries no independent role field. "
                          "`precision` counts only functions the rules actually "
                          "classified; `accuracy` counts declining to classify "
                          "as a miss.",
            },
            "signature": {
                "support": sig_total, "correct": sig_hits,
                "accuracy": ratio(sig_hits, sig_total),
                "measures": "return void-ness and parameter count only",
            },
            "family": family_scores,
            "semantic_name": {
                "support": name_total, "proposed": name_proposed,
                "correct": name_hits,
                "precision": ratio(name_hits, name_proposed),
                "recall": ratio(name_hits, name_total),
                "caveat": "the only benchmark that measures naming; role accuracy "
                          "must never be reported in its place",
            },
        },
        "per_rule": {
            role: {
                **counts,
                "measurable": role in PROXY_ROLES,
                "consistency": (
                    ratio(counts["consistent"], counts["fired"])
                    if role in PROXY_ROLES else None
                ),
                "note": None if role in PROXY_ROLES else (
                    "no curated-name proxy label maps to this role, so it cannot "
                    "be scored against them; its firing count is reported alone"
                ),
            }
            for role, counts in sorted(per_rule.items())
        },
        "per_rule_caveat": (
            "proxy labels cover only "
            f"{role_total} of {name_total} held-out names, so per-rule "
            "consistency is weak evidence and is not a precision figure"
        ),
        "failures": failures[:200],
        "failure_count": len(failures),
    }


def _family_benchmark(holdout_inventory, semantics_path, truth) -> dict:
    """Do our clusters reproduce the curated family partition?

    Scored on member pairs: a curated family of n members contributes n*(n-1)/2
    pairs that ought to be clustered together.
    """
    corpus = load_corpus(holdout_inventory, semantics_path, strip_curated=True)
    result = engine.run(corpus, with_research=False)
    index = result["family_by_member"]
    families = result["families"]

    def cluster_ids(fid: str) -> set[str]:
        return {
            family_id for family_id in index.get(fid, [])
            if families[family_id].tier in ("exact", "parameterized")
        }

    tp = fn_ = 0
    per_family = []
    for name, family in truth.curated_families.items():
        members = [m for m in family.get("members", {}) if m in corpus.functions]
        pairs = together = 0
        for i, left in enumerate(members):
            for right in members[i + 1:]:
                pairs += 1
                if cluster_ids(left) & cluster_ids(right):
                    together += 1
        tp += together
        fn_ += pairs - together
        if pairs:
            per_family.append({
                "curated_family": name, "members": len(members),
                "pairs": pairs, "clustered_together": together,
                "recall": round(together / pairs, 4),
            })
    return {
        "curated_families": len(per_family),
        "member_pairs": tp + fn_,
        "clustered_together": tp,
        "recall": round(tp / (tp + fn_), 4) if (tp + fn_) else None,
        "measures": "pairwise recall of curated family membership by the exact and "
                    "parameterized tiers, with all curated input withheld",
        "per_family": sorted(per_family, key=lambda item: item["recall"]),
    }
