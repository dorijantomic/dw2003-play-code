#!/usr/bin/env python3
"""Rank unnamed functions by naming LEVERAGE, not by family size.

The question this answers is not "which family is biggest" but:

    expected downstream functions resolved
    --------------------------------------
    cost to understand this function

A 30-line dispatcher that fixes the meaning of 80 callees outranks eleven
interchangeable leaves. Sorting families by member count gets that backwards,
which is what this tool exists to correct.

SIGNALS USED (all already present in the repo, none newly derived):
  * call graph      -- `direct_calls` / `indirect_calls` per function in
                       recovered/ddw3/function-inventory.json
  * existing names  -- `semantic_name` on the inventory record, i.e. the 903
                       functions already named, used as propagation seeds
  * family edges    -- `families` on the candidate record: naming any member
                       carries to the whole family, so family size multiplies
                       a function's yield
  * body size       -- decompiled C line count, the cost denominator
  * role/shape      -- `roles` on the candidate record, used only to report
                       what KIND of thing a high-leverage function is

WHAT IT DOES NOT DO. It proposes no names and writes nothing into the ledger or
semantics.json. It is a work-ordering tool: its output says where a read pays
off most, and nothing about what any function means.

Usage:
    tools/naming_leverage.py rank --limit 25
    tools/naming_leverage.py frontier
    tools/naming_leverage.py json --out /tmp/leverage.json
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib

REPO = pathlib.Path(__file__).resolve().parent.parent
INV = REPO / "recovered/ddw3/function-inventory.json"
CAND = REPO / "recovered/ddw3/semantic-candidates.json"


def load_graph():
    """Return (nodes, out_edges, in_edges, named, family_of, family_size)."""
    inv = json.loads(INV.read_text())
    cand = json.loads(CAND.read_text())

    nodes: dict[str, dict] = {}
    out_edges: dict[str, set[str]] = collections.defaultdict(set)
    in_edges: dict[str, set[str]] = collections.defaultdict(set)

    mods = inv["modules"]
    for m in (mods.values() if isinstance(mods, dict) else mods):
        for f in m.get("functions", []):
            fid = f["id"]
            nodes[fid] = {
                "id": fid,
                "address": f.get("address"),
                "module": m.get("id"),
                "name": f.get("semantic_name"),
                "family": f.get("semantic_family"),
                "sources": f.get("decompiled_sources") or [],
            }
            for call in (f.get("direct_calls") or []) + (f.get("indirect_calls") or []):
                tgt = call.get("target_id") if isinstance(call, dict) else call
                if isinstance(tgt, str):
                    out_edges[fid].add(tgt)
                    in_edges[tgt].add(fid)

    # Candidate records carry the family membership and the role labels.
    items = cand["candidates"]
    items = list(items.values()) if isinstance(items, dict) else items
    fam_members: dict[str, set[str]] = collections.defaultdict(set)
    for r in items:
        fid = r.get("id")
        if fid in nodes:
            nodes[fid]["roles"] = r.get("roles") or ([r["role"]] if r.get("role") else [])
            nodes[fid]["proposed"] = r.get("proposed_name")
            nodes[fid]["basis"] = r.get("name_basis")
        for fam in (r.get("families") or []):
            key = fam if isinstance(fam, str) else fam.get("id")
            if key and fid:
                fam_members[key].add(fid)

    for fid, n in nodes.items():
        fams = [k for k, v in fam_members.items() if fid in v]
        n["families"] = fams
        n["family_size"] = max((len(fam_members[k]) for k in fams), default=1)

    named = {fid for fid, n in nodes.items()
             if n.get("name") or n.get("basis") in ("curated", "propagated_curated")}
    return nodes, out_edges, in_edges, named


def body_cost(node) -> int:
    """Cost proxy: lines of decompiled C. No C at all is expensive, not free."""
    total = 0
    for s in node.get("sources") or []:
        p = REPO / s
        if p.exists():
            total += p.read_text(errors="replace").count("\n")
    return total or 120  # no lift: assume an expensive assembly read


def score(nodes, out_edges, in_edges, named):
    """Leverage = unnamed functions this one would give evidence about / cost."""
    rows = []
    for fid, n in nodes.items():
        if fid in named:
            continue
        callees = out_edges.get(fid, set())
        callers = in_edges.get(fid, set())
        # Downstream reach: unnamed neighbours that would gain a named
        # neighbour. A callee of a named dispatcher inherits caller context,
        # which is the mechanism that makes dispatchers worth more than leaves.
        unnamed_callees = {c for c in callees if c not in named and c in nodes}
        unnamed_callers = {c for c in callers if c not in named and c in nodes}
        # Yield is ADDITIVE, deliberately.
        #
        # A first cut multiplied reach by family size. That made family size
        # dominate every score -- the top 20 were all members of one 24-member
        # family -- which is sorting by family size wearing a disguise, the
        # exact failure this tool exists to avoid. A family of 24 hands you 23
        # extra functions; it does not multiply the value of a callee.
        fam = n.get("family_size", 1)
        reach = len(unnamed_callees) + 0.5 * len(unnamed_callers)
        yield_ = reach + (fam - 1)
        # Cost floor: without it, dividing by a 7-line body inflates trivial
        # leaves that resolve nothing to the top of the ranking.
        cost = max(body_cost(n), 25)
        rows.append({
            "id": fid,
            "address": n.get("address"),
            "module": n.get("module"),
            "roles": n.get("roles") or [],
            "unnamed_callees": len(unnamed_callees),
            "unnamed_callers": len(unnamed_callers),
            "family_size": fam,
            "cost_lines": cost,
            "yield": round(yield_, 1),
            "leverage": round(yield_ / cost * 100, 2),
        })
    rows.sort(key=lambda r: (-r["leverage"], -r["yield"]))
    return rows


def cmd_frontier(args):
    nodes, out_e, in_e, named = load_graph()
    unnamed = [f for f in nodes if f not in named]
    adjacent = 0
    for fid in unnamed:
        nbrs = out_e.get(fid, set()) | in_e.get(fid, set())
        if nbrs & named:
            adjacent += 1
    isolated = sum(1 for fid in unnamed
                   if not (out_e.get(fid, set()) | in_e.get(fid, set())))
    print(f"functions            {len(nodes)}")
    print(f"named (seeds)        {len(named)}")
    print(f"unnamed              {len(unnamed)}")
    print(f"  touching a named function   {adjacent}"
          f"   <- propagation frontier, reachable in ONE hop")
    print(f"  no call edges at all        {isolated}"
          f"   <- call graph gives these nothing")
    print(f"  unnamed, edges, but no named neighbour  "
          f"{len(unnamed) - adjacent - isolated}")


def cmd_rank(args):
    nodes, out_e, in_e, named = load_graph()
    rows = score(nodes, out_e, in_e, named)
    print(f"{'address':12s} {'module':16s} {'lev':>6s} {'yield':>6s} "
          f"{'lines':>6s} {'callees':>7s} {'callers':>7s} {'fam':>4s}  roles")
    for r in rows[: args.limit]:
        print(f"{str(r['address']):12s} {str(r['module'])[:16]:16s} "
              f"{r['leverage']:6.2f} {r['yield']:6.1f} {r['cost_lines']:6d} "
              f"{r['unnamed_callees']:7d} {r['unnamed_callers']:7d} "
              f"{r['family_size']:4d}  {','.join(r['roles'])[:26]}")
    top = rows[: args.limit]
    print(f"\ntop {len(top)} would give evidence about "
          f"{sum(r['unnamed_callees'] for r in top)} unnamed callees "
          f"across {sum(r['cost_lines'] for r in top)} lines of C")


def cmd_json(args):
    nodes, out_e, in_e, named = load_graph()
    rows = score(nodes, out_e, in_e, named)
    pathlib.Path(args.out).write_text(json.dumps(
        {"schema_version": 1, "seeds": len(named), "ranked": rows}, indent=1) + "\n")
    print(f"wrote {args.out} ({len(rows)} unnamed functions ranked)")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("rank"); p.add_argument("--limit", type=int, default=25)
    p.set_defaults(func=cmd_rank)
    p = sub.add_parser("frontier"); p.set_defaults(func=cmd_frontier)
    p = sub.add_parser("json"); p.add_argument("--out", default="/tmp/leverage.json")
    p.set_defaults(func=cmd_json)
    a = ap.parse_args(); a.func(a)


if __name__ == "__main__":
    main()
