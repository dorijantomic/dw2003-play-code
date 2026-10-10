"""Topic assignment over the joined evidence graph, with measured bases.

DESIGN CONSTRAINT INHERITED FROM A MEASUREMENT, NOT FROM TASTE
--------------------------------------------------------------
`tools/infer_module_domains.py` measured semantic propagation against held-out
labels on 2026-08-11 and recorded the result in its own docstring:

    always guess the most common label ........ 51.0%
    call-graph propagation (coarse) ........... 30.2%
    call-graph propagation (fine) .............. 9.4%
    same module as labelled neighbours ........ 79.6%

Call-graph propagation scores WORSE THAN GUESSING, because every part of the
game calls the same resident helpers. This module therefore never derives a
topic from a call edge. Call edges are retained as context on a function's
evidence list, where they help a person read the code, and are excluded from
every confidence number.

The bases that do carry a topic, strongest first:

    ledger          a ledger claim's `system`, anchored to this function through
                    the FILE its evidence cites (module-qualified, authority 1-6)
    text_bank       the function requests one of the game's own text banks
    curated         a hand-checked subsystem in semantics.json
    family          a homolog cluster member carries one. Family is byte/shape
                    identity, a different mechanism from call-graph adjacency,
                    and `tools/propagate_family_names.py` verifies that identity
                    against the assembly.
    module_majority >=80% of the module's labelled peers agree. This is the
                    79.6% signal above: the game is filed into overlays by
                    purpose, so where code LIVES predicts what it does.

Everything here is candidate inference. Promotion to a ledger claim runs through
`record-packets` and the `ddw3-verify-handoff` review, never through this file.
"""

from __future__ import annotations

import random
from collections import Counter, defaultdict
from dataclasses import dataclass, field

# Per-basis prior strength. Ordered so a stronger basis always wins a tie.
BASIS_SCORE = {
    "ledger": 0.85,
    "text_bank": 0.70,
    "curated": 0.90,
    "family": 0.85,          # multiplied by the donor's score
    "module_majority": 0.70,  # multiplied by measured module purity
    # Measured 2026-08-12: 57% on held-out ledger systems (7 predictions) and
    # 40% on curated (5). Above the 29.5%/7.0% baselines but far below module
    # majority, and on a small sample. The prior is set to the measurement, so
    # a shared_global topic never reads as more certain than it tested.
    #
    # Re-audited per space the same day under GLOBAL_DONOR_FLOOR = 3: 68% on 19
    # leave-one-out predictions in the ledger space, against a 28.6% baseline.
    # The prior stays at 0.50 -- 19 predictions do not justify raising it, and
    # the policy above only requires that it never exceed what was measured.
    "shared_global": 0.50,    # multiplied by measured donor purity
}
BASIS_RANK = ("curated", "ledger", "family", "text_bank", "shared_global",
              "module_majority")

# A `text:<bank>` topic is not a system label. It is the OBSERVATION that this
# function requests that text bank, read out of docs/generated/string-code-join
# .json. Only that observation can establish it.
#
# Propagating it means asserting a bank request that was never seen. Measured
# 2026-08-12 on the 13 rows shared_global had produced -- 8 `text:esstatus`,
# 5 `text:esdglabo` -- NONE of the 13 functions appears in string-code-join at
# all. Touching the status screen's state is not requesting the status bank.
#
# It is also unfalsifiable where it fires: both validation spaces mark a
# `text:` topic unscoreable (`_has_text_bank`), because neither the curated nor
# the ledger vocabulary contains one. So these rows could never be measured
# right or wrong by any validator -- they were pure unchecked output.
def is_observation_only(topic: str) -> bool:
    """Topics that only their own direct observation may assign."""
    return topic.startswith("text:")

# A module whose labelled peers disagree more than this is not a donor. Taken
# from infer_module_domains.py, which measured it.
PURITY_FLOOR = 0.8
# How many already-labelled functions must touch a global before it may donate
# a topic. It was 2.
#
# This constant was first set to 5 on 2026-08-12 on a leave-one-out audit that
# merged curated and ledger labels into one ground truth. That audit was void,
# for the reason `curated_subsystem_vs_ledger_system` is documented below: the
# two vocabularies agree on only 20 of the 106 functions carrying both, so a
# merged audit scores the taxonomy gap and reports it as basis error. It
# returned "0/8 correct below 5 donors". Re-run per space, on the ledger truth
# alone, the same basis gives:
#
#     donors 2     0/1          -- one sample; no information either way
#     donors 3-4   5/8  = 62%
#     donors 5-9   8/10 = 80%
#     overall     13/19 = 68%   (baseline 28.6%)
#
# So 3-4 donors is NOT worthless, and the floor of 5 threw away a bucket that
# measures 62% against a 28.6% baseline.
#
# The floor is 3. That excludes the 2-donor case on a STRUCTURAL argument, not
# a measurement: with two donors, purity is 0.5 or 1.0, and PURITY_FLOOR admits
# only 1.0 -- so "100% agree" is true by construction and carries no
# information. The audit has one 2-donor sample, which settles nothing. Do not
# cite this comment as evidence that 2 donors were measured and failed.
#
# The decisive evidence is a floor sweep, not the accuracy table. A global's
# donor pool counts ALREADY-PROPAGATED topics, so this basis could feed on
# itself, and it did:
#
#     floor=2   81 rows, 79 of them fed by another shared_global row
#     floor=3    8 rows
#     floor=4    8 rows   (identical output)
#     floor=5    8 rows   (identical output)
#     floor=6    2 rows
#
# 79 of 81 rows rested on a pool containing another row of the same basis, and
# the whole cascade seeds from the 2-donor case. Excluding it collapses the
# basis to 8 rows that stand on labelled evidence. Floors 3, 4 and 5 produce
# the SAME 8 rows, so the exact value is immaterial -- only excluding 2 matters.
#
# module_majority and family were checked for the same defect and do not have
# it: assignment converges in one round, and all 249 module_majority rows
# re-derive identically from seed donors alone, as do all 7 family rows.
GLOBAL_DONOR_FLOOR = 3
# Below this a topic is not worth carrying anywhere.
MIN_SCORE = 0.20
MAX_ROUNDS = 8
# Bases whose label a family may pass on. See the measurement in `assign`.
FAMILY_TRANSFERABLE = frozenset({"curated", "family"})
# Curated placeholder that means "not classified", not a subsystem.
UNCLASSIFIED = "unclassified"


@dataclass
class Topic:
    """One topic label held by one function."""

    topic: str
    score: float
    basis: str
    evidence: list[str] = field(default_factory=list)
    donor: str | None = None
    hops: int = 0

    def as_dict(self) -> dict:
        return {
            "topic": self.topic,
            "score": round(self.score, 3),
            "basis": self.basis,
            "donor": self.donor,
            "hops": self.hops,
            "evidence": self.evidence[:6],
        }


def _better(new: Topic, old: Topic | None) -> bool:
    if old is None:
        return True
    if abs(new.score - old.score) > 1e-9:
        return new.score > old.score
    return BASIS_RANK.index(new.basis) < BASIS_RANK.index(old.basis)


def seed_topics(corpus, signals, *, hidden: set[str] = frozenset()) -> dict[str, Topic]:
    """Round-zero topics: what a joined source states about a function directly.

    `hidden` withholds the label-bearing bases (ledger, curated) for those
    function ids. It is the leakage guard for validation: a held-out function
    must not see its own answer, from either label space.
    """
    best: dict[str, Topic] = {}

    def offer(fid, topic, score, basis, note, donor=None, hops=0):
        if not topic or score < MIN_SCORE:
            return
        candidate = Topic(topic, score, basis, [note], donor, hops)
        if _better(candidate, best.get(fid)):
            best[fid] = candidate
        elif best[fid].topic == topic:
            best[fid].evidence.append(note)

    for edge in signals.edges:
        if not edge.topic:
            continue
        if edge.kind == "ledger" and edge.function_id in hidden:
            continue
        if edge.kind not in ("ledger", "text_bank"):
            continue
        offer(edge.function_id, edge.topic,
              BASIS_SCORE[edge.kind] * edge.weight if edge.kind == "ledger"
              else BASIS_SCORE["text_bank"] * edge.weight,
              edge.kind,
              f"[{edge.kind}] {edge.source}:{edge.locator} -- {edge.detail}")

    for fid, fn in corpus.functions.items():
        subsystem = fn.curated_subsystem
        if not subsystem or subsystem == UNCLASSIFIED or fid in hidden:
            continue
        offer(fid, subsystem, BASIS_SCORE["curated"], "curated",
              "[curated] recovered/ddw3/semantics.json")
    return best


def _module_donors(corpus, topics) -> dict[str, tuple[str, float, int]]:
    """module -> (topic, purity, labelled peers), for modules pure enough to donate."""
    per_module: dict[str, Counter] = defaultdict(Counter)
    for fid, topic in topics.items():
        fn = corpus.functions.get(fid)
        if fn is not None:
            per_module[fn.module][topic.topic] += 1
    donors: dict[str, tuple[str, float, int]] = {}
    for module, counts in per_module.items():
        total = sum(counts.values())
        topic, top = counts.most_common(1)[0]
        purity = top / total
        if purity >= PURITY_FLOOR and total >= 2 and not is_observation_only(topic):
            donors[module] = (topic, purity, total)
    return donors


def assign(corpus, signals, families, family_by_member, *,
           hidden: set[str] = frozenset()) -> tuple[dict[str, Topic], list[dict]]:
    """Seed, then iterate family and module bases until nothing changes."""
    topics = seed_topics(corpus, signals, hidden=hidden)
    rounds: list[dict] = []

    for round_index in range(MAX_ROUNDS):
        changed = 0

        # --- family: a homolog cluster shares one SHAPE ---------------------
        # Measured 2026-08-12 on held-out labels: family transfer predicts a
        # fine curated subsystem at 100% (12/12) but a coarse ledger SYSTEM at
        # 6.7% (1/15). Families are byte/shape identity, so the same display-
        # object routine is copied into cardgame and fieldstg alike -- shared
        # shape, different game system. Family therefore carries structural
        # labels only, never a game-system label taken from the ledger.
        for family_id, family in families.items():
            if not family.can_carry_name:
                continue
            donors = [(m, topics[m]) for m in family.members
                      if m in topics and topics[m].basis in FAMILY_TRANSFERABLE]
            if not donors:
                continue
            donor_id, donor = max(donors, key=lambda item: item[1].score)
            score = donor.score * BASIS_SCORE["family"]
            for member in family.members:
                if member == donor_id or member in hidden:
                    continue
                candidate = Topic(
                    donor.topic, score, "family",
                    [f"[family] {family.tier} homolog of {donor_id} in {family_id} "
                     f"({family.member_count} members, {family.statements} statements)"],
                    donor_id, donor.hops + 1)
                if _better(candidate, topics.get(member)):
                    topics[member] = candidate
                    changed += 1

        # --- shared global: proven access to the same RAM address -----------
        # A global's address is absolute, so it identifies the same state
        # across overlays -- a link neither the call graph nor module
        # membership provides. Hub globals (>20 functions) are already removed
        # upstream, for the same reason hub functions carry no topic.
        for donors_ids in signals.global_index.values():
            labelled = [topics[m] for m in donors_ids if m in topics]
            if len(labelled) < GLOBAL_DONOR_FLOOR:
                continue
            counts = Counter(topic.topic for topic in labelled)
            winner, top = counts.most_common(1)[0]
            purity = top / len(labelled)
            if purity < PURITY_FLOOR or is_observation_only(winner):
                continue
            for member in donors_ids:
                if member in topics or member in hidden:
                    continue
                candidate = Topic(
                    winner, BASIS_SCORE["shared_global"] * purity, "shared_global",
                    [f"[shared_global] {len(labelled)} functions proven to touch the "
                     f"same global(s) carry a topic, {purity:.0%} agree on {winner}"],
                    None, 1)
                if _better(candidate, topics.get(member)):
                    topics[member] = candidate
                    changed += 1

        # --- module: the game is filed into overlays by purpose -------------
        donors_by_module = _module_donors(corpus, topics)
        for fid, fn in corpus.functions.items():
            if fid in topics or fid in hidden:
                continue
            donor = donors_by_module.get(fn.module)
            if donor is None:
                continue
            topic, purity, peers = donor
            candidate = Topic(
                topic, BASIS_SCORE["module_majority"] * purity, "module_majority",
                [f"[module_majority] {peers} labelled peers in {fn.module}, "
                 f"{purity:.0%} agree on {topic}"],
                fn.module, 1)
            if _better(candidate, topics.get(fid)):
                topics[fid] = candidate
                changed += 1

        rounds.append({"round": round_index + 1, "topics_changed": changed})
        if changed == 0:
            break
    return topics, rounds


# --------------------------------------------------------------------------
# validation: does any of this actually predict a label it was not shown?
# --------------------------------------------------------------------------

def direct_curated_ids(semantics_path) -> set[str]:
    """Function ids semantics.json annotates ONE BY ONE.

    Measured 2026-08-12: of the 745 functions carrying a curated subsystem, 558
    have it only because a curated FAMILY assigned it to every member at once,
    and those 558 are disjoint from the 187 annotated individually. Scoring a
    family-based prediction against one of the 558 therefore re-measures the
    propagation that created the label -- it is guaranteed to score 100% and
    means nothing. The 187 direct entries are in no curated family at all, so
    they are the only honest ground truth for a family-based basis.
    """
    import json
    from pathlib import Path
    path = Path(semantics_path)
    if not path.is_file():
        return set()
    return set(json.loads(path.read_text()).get("functions", {}))


def validate(corpus, signals, families, family_by_member, *,
             space: str, folds: int = 5, seed: int = 20260812,
             semantics_path=None) -> dict:
    """Leak-free hold-out accuracy inside ONE label space.

    The label spaces are NOT comparable. Measured 2026-08-12: of the 106
    functions carrying both a curated subsystem and a ledger system, the strings
    agree only 20 times. Curated subsystems are fine ('field-stage-actors',
    'window-fold-ui'), ledger systems are coarse ('world-exploration'). Scoring
    a prediction from one space against the other measures the taxonomy gap, not
    the pipeline. So each space is measured on its own ground truth.

    Spaces:
      curated        all 745 curated subsystems -- CIRCULAR for the family basis,
                     kept only to show the size of that circularity
      curated_direct the 187 individually annotated ones -- the honest version
      ledger         systems from ledger claims, assigned by neither family nor
                     module propagation, so every basis is independent of it
    """
    truth: dict[str, str] = {}
    if space in ("curated", "curated_direct"):
        allowed = None
        if space == "curated_direct":
            allowed = direct_curated_ids(semantics_path)
        for fid, fn in corpus.functions.items():
            if allowed is not None and fid not in allowed:
                continue
            if fn.curated_subsystem and fn.curated_subsystem != UNCLASSIFIED:
                truth[fid] = fn.curated_subsystem
    elif space == "ledger":
        per_function: dict[str, set[str]] = defaultdict(set)
        for edge in signals.edges:
            if edge.kind == "ledger" and edge.topic:
                per_function[edge.function_id].add(edge.topic)
        # Only functions a single system claims: a function two systems both
        # claim has no single right answer to score against.
        truth = {fid: next(iter(labels)) for fid, labels in per_function.items()
                 if len(labels) == 1}
    else:
        raise ValueError(f"unknown label space: {space}")

    if len(truth) < folds:
        return {"space": space, "labelled_functions": len(truth), "skipped": "too few labels"}

    ids = sorted(truth)
    random.Random(seed).shuffle(ids)
    buckets = [ids[i::folds] for i in range(folds)]

    majority = Counter(truth.values()).most_common(1)[0]
    baseline = majority[1] / len(truth)

    per_basis: dict[str, list[int]] = defaultdict(lambda: [0, 0])  # [correct, total]
    per_basis_invocab: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    vocabulary = set(truth.values())
    predicted = correct = unscoreable = 0
    cross_vocabulary = in_vocab_predicted = in_vocab_correct = 0
    for bucket in buckets:
        hidden = set(bucket)
        topics, _ = assign(corpus, signals, families, family_by_member, hidden=hidden)
        # The held-out functions were withheld from seeding AND from receiving,
        # so re-run the receiving bases against them alone: predict each held-out
        # function from the labels that remain visible.
        visible = {fid: topic for fid, topic in topics.items() if fid not in hidden}
        donors_by_module = _module_donors(corpus, visible)
        for fid in bucket:
            if _has_text_bank(signals, fid):
                # A text-bank topic is `text:<file>`; neither label space uses
                # that vocabulary, so it can never string-match and scoring it
                # would measure the vocabulary gap, not the signal.
                unscoreable += 1
            guess = _predict_one(corpus, fid, families, family_by_member,
                                 visible, donors_by_module, signals)
            if guess is None:
                continue
            predicted += 1
            hit = int(guess.topic == truth[fid])
            correct += hit
            per_basis[guess.basis][0] += hit
            per_basis[guess.basis][1] += 1
            if guess.topic not in vocabulary:
                # The predicted label does not exist in this space's vocabulary,
                # so this space cannot represent that answer and string equality
                # measures the taxonomy gap rather than the prediction. Counted
                # as wrong above (strict) and excluded below (in-vocabulary).
                cross_vocabulary += 1
                per_basis_invocab[guess.basis][1] -= 0
            else:
                per_basis_invocab[guess.basis][0] += hit
                per_basis_invocab[guess.basis][1] += 1
                in_vocab_predicted += 1
                in_vocab_correct += hit

    return {
        "space": space,
        "labelled_functions": len(truth),
        "distinct_labels": len(set(truth.values())),
        "folds": folds,
        "majority_class": majority[0],
        "majority_class_baseline": round(baseline, 3),
        "coverage": round(predicted / len(truth), 3),
        "accuracy_where_predicted": round(correct / predicted, 3) if predicted else None,
        "accuracy_over_all_labelled": round(correct / len(truth), 3),
        "text_bank_signals_not_scoreable_here": unscoreable,
        "cross_vocabulary_predictions": cross_vocabulary,
        "in_vocabulary_predictions": in_vocab_predicted,
        "accuracy_in_vocabulary": (round(in_vocab_correct / in_vocab_predicted, 3)
                                   if in_vocab_predicted else None),
        "per_basis": {
            basis: {
                "predictions": total,
                "accuracy": round(hits / total, 3) if total else None,
                "in_vocabulary_predictions": per_basis_invocab[basis][1],
                "accuracy_in_vocabulary": (
                    round(per_basis_invocab[basis][0] / per_basis_invocab[basis][1], 3)
                    if per_basis_invocab[basis][1] else None),
            }
            for basis, (hits, total) in sorted(per_basis.items())
        },
        "verdict": _verdict(
            in_vocab_correct / in_vocab_predicted if in_vocab_predicted else 0.0, baseline),
        "circularity_warning": (
            "The `curated` space is circular for the family basis: 558 of its 745 "
            "labels were themselves assigned family-wide. Use `curated_direct`."
        ) if space == "curated" else None,
    }


def _has_text_bank(signals, fid: str) -> bool:
    return any(edge.kind == "text_bank" and edge.function_id == fid
               for edge in signals.edges)


def _predict_one(corpus, fid, families, family_by_member, visible,
                 donors_by_module, signals=None) -> Topic | None:
    """Best scoreable topic for one held-out function, from labels it never saw.

    Only the bases whose vocabulary is the label space itself can be scored, so
    text_bank is excluded here and counted separately.
    """
    options: list[Topic] = []

    for family_id in family_by_member.get(fid, []):
        family = families[family_id]
        if not family.can_carry_name:
            continue
        donors = [(m, visible[m]) for m in family.members
                  if m in visible and m != fid and visible[m].basis in FAMILY_TRANSFERABLE]
        if not donors:
            continue
        donor_id, donor = max(donors, key=lambda item: item[1].score)
        options.append(Topic(donor.topic, donor.score * BASIS_SCORE["family"],
                             "family", [f"homolog of {donor_id}"], donor_id, 1))

    if signals is not None:
        for donor_ids in signals.global_index.values():
            if fid not in donor_ids:
                continue
            labelled = [visible[m] for m in donor_ids if m in visible and m != fid]
            if len(labelled) < GLOBAL_DONOR_FLOOR:
                continue
            counts = Counter(topic.topic for topic in labelled)
            winner, top = counts.most_common(1)[0]
            purity = top / len(labelled)
            if purity >= PURITY_FLOOR and not is_observation_only(winner):
                options.append(Topic(winner, BASIS_SCORE["shared_global"] * purity,
                                     "shared_global", [f"{len(labelled)} donors"], None, 1))

    fn = corpus.functions.get(fid)
    if fn is not None:
        donor = donors_by_module.get(fn.module)
        if donor is not None:
            topic, purity, peers = donor
            options.append(Topic(topic, BASIS_SCORE["module_majority"] * purity,
                                 "module_majority", [f"{peers} peers, {purity:.0%}"],
                                 fn.module, 1))
    if not options:
        return None
    best = options[0]
    for option in options[1:]:
        if _better(option, best):
            best = option
    return best


def _verdict(accuracy: float, baseline: float) -> str:
    if accuracy > baseline + 0.10:
        return f"beats the majority-class baseline by {accuracy - baseline:+.1%}"
    if accuracy > baseline:
        return (f"only {accuracy - baseline:+.1%} over the majority-class baseline; "
                "too close to rely on")
    return (f"does NOT beat the majority-class baseline ({accuracy:.1%} vs "
            f"{baseline:.1%}); this basis set must not be used for this space")
