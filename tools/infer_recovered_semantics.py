#!/usr/bin/env python3
"""Whole-corpus semantic inference and recovered-C generation for DDW3.

Consumes `recovered/ddw3/function-inventory.json` and the checked-in m2c bodies
and proposes, for every established function, a name, a typed signature, a
behavior summary, evidence, confidence, contradictions and unknowns.

It has no authority of its own over original behavior. Nothing it produces is
`verified`, and only mechanically established results are ever written back
into the curated `semantics.json`.

    infer     whole-corpus pass -> semantic-candidates.json
    validate  leak-free benchmarks against curated ground truth
    bundle    self-contained evidence packets for review and naming
    emit-c    recovered C / pseudocode / typed skeletons
    apply     reviewable batches into semantics.json (reversible)
    report    the markdown summary
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dw3_semantics import RULE_VERSION, apply as apply_mod, bundles, emitc, engine, report as report_mod, validate
from dw3_semantics.corpus import INVENTORY_PATH, REPO_ROOT, SEMANTICS_PATH, load_corpus

CANDIDATES_PATH = REPO_ROOT / "recovered/ddw3/semantic-candidates.json"
BUNDLE_ROOT = REPO_ROOT / "recovered/ddw3/semantic-bundles"
RECOVERED_C_ROOT = REPO_ROOT / "recovered/ddw3/recovered-c"
VALIDATION_PATH = REPO_ROOT / "recovered/ddw3/semantic-validation.json"
REPORT_PATH = REPO_ROOT / "recovered/ddw3/semantic-inference-report.md"


def _write(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, default=str) + "\n")


def _load_and_run(args):
    corpus = load_corpus(args.inventory, args.semantics)
    result = engine.run(corpus, with_research=not args.no_research)
    return corpus, result


def cmd_infer(args) -> int:
    corpus, result = _load_and_run(args)
    candidates = result["candidates"]
    families = result["families"]
    collisions = engine.detect_collisions(corpus)

    weak = [
        fid for fid, candidate in candidates.items()
        if candidate["proposed_name"] and len(candidate["evidence"]) < 2
    ]
    document = {
        "schema_version": 1,
        "generated_by": "tools/infer_recovered_semantics.py",
        "rule_version": RULE_VERSION,
        "authority": "candidate inference; never proof of original behavior",
        "inventory": str(args.inventory),
        "inventory_summary": corpus.summary,
        "summary": {
            "functions": len(candidates),
            "with_body": sum(1 for c in candidates.values() if c["lift"].startswith("decompiled")),
            "no_lift": sum(1 for c in candidates.values() if c["lift"] == "no_lift"),
            "empty_body_requires_triage": sum(
                1 for c in candidates.values() if c["lift"] == "empty_body_requires_triage"),
            "named": sum(1 for c in candidates.values() if c["proposed_name"]),
            "curated": sum(1 for c in candidates.values() if c["name_basis"] == "curated"),
            "mechanically_established": sum(
                1 for c in candidates.values() if c["mechanically_established"]),
            "with_role": sum(1 for c in candidates.values() if c["role"]),
            "with_contradictions": sum(1 for c in candidates.values() if c["contradictions"]),
            "weak_single_clue_names": len(weak),
            "families": len(families),
            "families_exact": sum(1 for f in families.values() if f.tier == "exact"),
            "families_parameterized": sum(1 for f in families.values() if f.tier == "parameterized"),
            "families_structural": sum(1 for f in families.values() if f.tier == "structural"),
            "address_collisions": len(collisions),
            "rejected_phantom_entries": len(corpus.rejected_entries),
        },
        "roles": _count(candidates, "role"),
        "lift": _count(candidates, "lift"),
        "name_basis": _count(candidates, "name_basis"),
        "quality_flags": {
            "weak_single_clue_names": sorted(weak)[:200],
            "address_collisions": collisions,
            "rejected_phantom_entries": corpus.rejected_entries,
            "quarantine": {k: len(v) for k, v in result["quarantine"].items()},
            "quarantined_ids": {k: sorted(v)[:100] for k, v in result["quarantine"].items()},
        },
        "families": [
            {
                "id": family.id, "tier": family.tier, "members": family.members,
                "modules": family.modules, "statements": family.statements,
                "representative": family.representative,
                "can_carry_name": family.can_carry_name,
                "parameters": family.parameters,
            }
            for family in sorted(families.values(), key=lambda f: (-f.member_count, f.id))
        ],
        "candidates": dict(sorted(candidates.items())),
    }
    _write(args.out, document)
    print(json.dumps(document["summary"], indent=2))
    return 0


def _count(candidates, key) -> dict:
    counts: dict[str, int] = {}
    for candidate in candidates.values():
        counts[str(candidate[key])] = counts.get(str(candidate[key]), 0) + 1
    return dict(sorted(counts.items(), key=lambda item: -item[1]))


def cmd_validate(args) -> int:
    result = validate.run(args.inventory, args.semantics, folds=args.folds)
    _write(args.out, result)
    print(json.dumps({
        "leakage_detected": len(result["leakage_detected"]),
        "benchmarks": {
            name: {k: v for k, v in scores.items() if k != "per_family"}
            for name, scores in result["benchmarks"].items()
        },
    }, indent=2))
    return 1 if result["leakage_detected"] else 0


def cmd_bundle(args) -> int:
    corpus, result = _load_and_run(args)
    candidates = result["candidates"]
    families = result["families"]
    index = result["family_by_member"]
    links = result["research_links"]
    BUNDLE_ROOT.mkdir(parents=True, exist_ok=True)

    written = 0
    if args.function:
        for fid in args.function:
            if fid not in corpus.functions:
                print(f"unknown function id: {fid}", file=sys.stderr)
                return 2
            bundle = bundles.function_bundle(
                corpus, corpus.functions[fid], candidates[fid], families, index, links,
                with_assembly=not args.no_assembly)
            print(json.dumps(bundle, indent=2, default=str))
        return 0

    ranked = sorted(
        (f for f in families.values() if f.tier in ("exact", "parameterized")),
        key=lambda f: (
            -sum(len(corpus.callers.get(m, set())) for m in f.members),
            -f.member_count,
        ),
    )
    unnamed = [
        family for family in ranked
        if not (set(family.members) & corpus.curated_ids())
    ]
    selection = (unnamed if args.unnamed_only else ranked)[:args.limit]
    for family in selection:
        bundle = bundles.cluster_bundle(
            corpus, family, candidates, families, index, links, sample=args.sample)
        path = BUNDLE_ROOT / f"{family.id.replace(':', '-')}.json"
        _write(path, bundle)
        written += 1
    index_path = BUNDLE_ROOT / "index.json"
    _write(index_path, {
        "generated_by": "tools/infer_recovered_semantics.py",
        "rule_version": RULE_VERSION,
        "selection": "unnamed clusters ranked by total caller fan-in"
                     if args.unnamed_only else "all clusters ranked by caller fan-in",
        "bundles": [
            {
                "cluster": family.id, "tier": family.tier,
                "members": family.member_count,
                "modules": len(family.modules),
                "caller_fan_in": sum(len(corpus.callers.get(m, set())) for m in family.members),
                "path": f"recovered/ddw3/semantic-bundles/{family.id.replace(':', '-')}.json",
            }
            for family in selection
        ],
    })
    print(f"wrote {written} cluster bundles to {BUNDLE_ROOT}")
    return 0


def cmd_emit_c(args) -> int:
    corpus, result = _load_and_run(args)
    candidates = result["candidates"]
    names = {
        f"F0x{corpus.functions[fid].address:08x}": candidate["proposed_name"]
        for fid, candidate in candidates.items() if candidate["proposed_name"]
    }
    from dw3_semantics import signatures

    targets = []
    for fid, candidate in sorted(candidates.items()):
        fn = corpus.functions[fid]
        if candidate["lift"] == "no_lift" and not args.include_skeletons:
            continue
        # "Mechanically established" for emission means the body is a complete
        # representation of the original instructions -- not that the *name* was
        # mechanically derived. A function whose generated name has since been
        # recorded is still mechanically complete, and family representatives
        # are emitted regardless so every cluster has a readable exemplar.
        if args.mechanical_only and not (
            (fn.features is not None and fn.features.complete)
            or fid in {f.representative for f in result["families"].values()}
        ):
            continue
        targets.append((fid, fn, candidate))

    counts = {"clean_typed_c": 0, "recovered_pseudocode": 0, "typed_skeleton": 0}
    manifest = []
    for fid, fn, candidate in targets[:args.limit] if args.limit else targets:
        family = None
        for family_id in result["family_by_member"].get(fid, []):
            if result["families"][family_id].can_carry_name:
                family = result["families"][family_id]
                break
        signature = signatures.infer(fn, fn.features, [], family)
        # Use the signature the candidate settled on, so the emitted definition
        # carries the proposed name rather than the provisional placeholder.
        signature.text = candidate["signature"]
        emission = emitc.emit(candidate, fn, signature, names)
        counts[emission.grade] += 1
        path = RECOVERED_C_ROOT / fn.module / f"F0x{fn.address:08x}.c"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(emission.text + "\n")
        manifest.append({
            "id": fid, "grade": emission.grade, "syntax_ok": emission.syntax_ok,
            "diagnostic": emission.diagnostic,
            "path": path.relative_to(REPO_ROOT).as_posix(),
        })
    _write(RECOVERED_C_ROOT / "manifest.json", {
        "generated_by": "tools/infer_recovered_semantics.py",
        "rule_version": RULE_VERSION,
        "grades": counts,
        "note": "clean_typed_c passed gcc -fsyntax-only; every other grade is "
                "explicitly marked and is not compilable C",
        "files": manifest,
    })
    print(json.dumps(counts, indent=2))
    return 0


def cmd_apply(args) -> int:
    if args.revert:
        print(json.dumps(apply_mod.revert(args.semantics), indent=2)[:2000])
        return 0
    corpus, result = _load_and_run(args)
    outcome = apply_mod.apply(
        args.semantics, result["candidates"], corpus,
        batch_size=args.batch_size, limit=args.limit, dry_run=args.dry_run,
    )
    _write(REPO_ROOT / "recovered/ddw3/semantic-apply-log.json", outcome)
    print(json.dumps({
        "dry_run": outcome["dry_run"],
        "eligible": outcome["eligible"],
        "skipped_not_mechanical": outcome["skipped_not_mechanical"],
        "batches": len(outcome["batches"]),
        "coverage_before": outcome["coverage_before"],
        "coverage_after": outcome["coverage_after"],
    }, indent=2))
    return 0


def cmd_query(args) -> int:
    from dw3_semantics import query as query_mod
    document = query_mod.load(args.candidates)
    if args.what == "stats":
        print(query_mod.stats(document))
    elif args.what == "list":
        named = True if args.named else (False if args.unnamed else None)
        print(query_mod.listing(
            document, role=args.role, lift=args.lift, module=args.module,
            basis=args.basis, min_callers=args.min_callers, named=named,
            sort=args.sort, limit=args.limit))
    elif args.what == "show":
        print(query_mod.show(document, args.id))
    elif args.what == "families":
        print(query_mod.families(
            document, tier=args.tier, unnamed_only=args.unnamed_only, limit=args.limit))
    elif args.what == "family":
        print(query_mod.family_detail(document, args.id, limit=args.limit))
    elif args.what == "flags":
        print(query_mod.flags(document, limit=args.limit))
    elif args.what == "next":
        print(query_mod.work_queue(document, limit=args.limit))
    return 0


def cmd_report(args) -> int:
    text = report_mod.build(
        candidates_path=args.out_candidates,
        validation_path=args.out_validation,
        apply_log=REPO_ROOT / "recovered/ddw3/semantic-apply-log.json",
        manifest=RECOVERED_C_ROOT / "manifest.json",
    )
    REPORT_PATH.write_text(text)
    print(f"wrote {REPORT_PATH}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--inventory", type=Path, default=INVENTORY_PATH)
    parser.add_argument("--semantics", type=Path, default=SEMANTICS_PATH)
    parser.add_argument("--no-research", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    infer = sub.add_parser("infer")
    infer.add_argument("--out", type=Path, default=CANDIDATES_PATH)
    infer.set_defaults(func=cmd_infer)

    val = sub.add_parser("validate")
    val.add_argument("--folds", type=int, default=4)
    val.add_argument("--out", type=Path, default=VALIDATION_PATH)
    val.set_defaults(func=cmd_validate)

    bundle = sub.add_parser("bundle")
    bundle.add_argument("--limit", type=int, default=25)
    bundle.add_argument("--sample", type=int, default=3)
    bundle.add_argument("--unnamed-only", action="store_true")
    bundle.add_argument("--function", nargs="*")
    bundle.add_argument("--no-assembly", action="store_true",
                        help="omit the assembly slice; roughly halves the size")
    bundle.set_defaults(func=cmd_bundle)

    emit = sub.add_parser("emit-c")
    emit.add_argument("--limit", type=int, default=None)
    emit.add_argument("--mechanical-only", action="store_true")
    emit.add_argument("--include-skeletons", action="store_true")
    emit.set_defaults(func=cmd_emit_c)

    apply_parser = sub.add_parser("apply")
    apply_parser.add_argument("--batch-size", type=int, default=50)
    apply_parser.add_argument("--limit", type=int, default=None)
    apply_parser.add_argument("--dry-run", action="store_true")
    apply_parser.add_argument("--revert", action="store_true")
    apply_parser.set_defaults(func=cmd_apply)

    q = sub.add_parser("query", help="compact text answers; never dump the 6MB json")
    q.add_argument(
        "what",
        choices=["stats", "list", "show", "families", "family", "flags", "next"],
    )
    q.add_argument("id", nargs="*")
    q.add_argument("--candidates", type=Path, default=CANDIDATES_PATH)
    q.add_argument("--role")
    q.add_argument("--lift")
    q.add_argument("--module")
    q.add_argument("--basis")
    q.add_argument("--tier")
    q.add_argument("--min-callers", type=int, default=0)
    q.add_argument("--named", action="store_true")
    q.add_argument("--unnamed", action="store_true")
    q.add_argument("--unnamed-only", action="store_true")
    q.add_argument("--sort", default="callers", choices=["callers", "confidence", "id"])
    q.add_argument("--limit", type=int, default=25)
    q.set_defaults(func=cmd_query)

    rep = sub.add_parser("report")
    rep.add_argument("--out-candidates", type=Path, default=CANDIDATES_PATH)
    rep.add_argument("--out-validation", type=Path, default=VALIDATION_PATH)
    rep.set_defaults(func=cmd_report)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
