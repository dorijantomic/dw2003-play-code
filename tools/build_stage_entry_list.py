#!/usr/bin/env python3
"""Emit the function-entry addresses of one stage overlay as a Lua list.

The stage overlays all load at the same RAM base, so an execution trace can only
attribute an address to a stage while that stage's overlay is the resident one.
This tool therefore always runs together with `trace-stage-entries.lua`, which
re-checks residency every frame and refuses to record on a mismatch.

Addresses come from `docs/generated/function-extents.json` (built from the
original assembly), keyed by the overlay's own `.s` path -- never from the
decompiled C directory, which also holds jump-table case bodies and stale lifts.

Usage:
    python3 tools/build_stage_entry_list.py --stage 780
    python3 tools/build_stage_entry_list.py --stages 780,740,310 --out /tmp/opencode/fn.lua
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

EXTENTS = pathlib.Path("docs/generated/function-extents.json")
WORD_TAIL = re.compile(r"\.word\s+0x([0-9a-fA-F]+)")


def entry_words(overlay: str, addr: int, limit: int = 4) -> list[int]:
    """The first instruction words at one function entry, from its own lift.

    `exe-decomp/<overlay>_c/_asm/F0x<addr>.s` is the m2c input closure for exactly
    that address: its `glabel` names the address and its `.word` lines are the
    instructions the CPU fetches there. Using it means no assumption about where an
    overlay loads -- the per-function lift is already addressed.

    More than one word is carried because a single prologue instruction is a weak
    identity: `addiu sp,sp,-N` opens many unrelated functions in every overlay, and
    a one-word match let a trace arm on the previous stage's code (a "tainted"
    run). The tracer requires a majority of entries to match on all their words.
    """
    src = pathlib.Path("exe-decomp") / f"{overlay}_c" / "_asm" / f"F0x{addr:08x}.s"
    if not src.exists():
        return []
    seen_glabel = False
    words: list[int] = []
    for line in src.read_text(encoding="utf8", errors="replace").splitlines():
        if line.startswith("glabel"):
            seen_glabel = True
            continue
        if seen_glabel:
            m = WORD_TAIL.search(line)
            if m:
                words.append(int(m.group(1), 16))
                if len(words) >= limit:
                    break
    return words


def stage_entries(extents: dict, overlay: str) -> list[int]:
    # Matched on the suffix because function-extents.json stores absolute paths;
    # a prefix built from a guessed checkout root silently returns nothing.
    needle = f"/exe-decomp/{overlay}_c/_asm/"
    addrs: set[int] = set()
    for path in extents["sources"]:
        if needle not in path:
            continue
        stem = pathlib.Path(path).stem
        if stem.startswith("F0x"):
            addrs.add(int(stem[3:], 16))
    return sorted(addrs)


def busiest(extents: dict, limit: int) -> list[tuple[int, int]]:
    counts: dict[int, int] = {}
    for path in extents["sources"]:
        marker = "/exe-decomp/wstag"
        if marker not in path or "/_asm/" not in path:
            continue
        name = path.split("exe-decomp/")[1].split("_c/")[0]
        stage = int(name.replace("wstag", ""))
        counts[stage] = counts.get(stage, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    return ranked[:limit]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--stage", type=int, help="one stage number, e.g. 780")
    ap.add_argument("--stages", help="comma-separated stage numbers")
    ap.add_argument("--busiest", type=int, metavar="N", help="list the N stages with most entries")
    ap.add_argument("--out", type=pathlib.Path, help="write the Lua here instead of stdout")
    ap.add_argument("--overlay", help="any overlay name, e.g. fieldstg")
    ap.add_argument("--overlays", help="comma-separated overlay names")
    args = ap.parse_args()

    if not EXTENTS.exists():
        sys.exit(f"missing {EXTENTS}; rebuild it first")
    extents = json.loads(EXTENTS.read_text())

    if args.busiest:
        for stage, n in busiest(extents, args.busiest):
            print(f"wstag{stage} {n}")
        return 0

    names: list[str] = list(args.overlays.split(",")) if args.overlays else []
    if args.overlay:
        names.insert(0, args.overlay)
    stages: list[int] = []
    if args.stage is not None:
        stages.append(args.stage)
    if args.stages:
        stages.extend(int(s) for s in args.stages.split(",") if s.strip())
    if not stages and not names:
        ap.error("give --stage, --stages, --overlay, --overlays or --busiest")

    chunks = []
    for stage in stages:
        overlay = f"wstag{stage}"
        addrs = stage_entries(extents, overlay)
        if not addrs:
            print(f"# wstag{stage}: no entries found", file=sys.stderr)
            continue
        # Every wstag overlay is emitted with its own lowest entry as assembly
        # offset 0; the tracer confirms that assumption against live RAM before
        # it records anything, so a wrong guess fails loudly instead of
        # misattributing another stage's code.
        pairs = []
        for a in addrs:
            ws = entry_words(overlay, a)
            if ws:
                pairs.append((a, ws))
        lines = ",\n".join(
            "  {0x%08x%s}" % (a, "".join(f",0x{w:08x}" for w in ws)) for a, ws in pairs
        )
        chunks.append(
            f"DW3FN['{stage}'] = {{\n{lines}\n}}  -- {len(pairs)}/{len(addrs)} with expected words"
        )
        print(f"# wstag{stage}: {len(pairs)}/{len(addrs)} entries carry an expected word", file=sys.stderr)
    for overlay in names:
        addrs = stage_entries(extents, overlay)
        if not addrs:
            print(f"# {overlay}: no entries found", file=sys.stderr)
            continue
        pairs = [(a, entry_words(overlay, a)) for a in addrs]
        pairs = [(a, ws) for a, ws in pairs if ws]
        lines = ",\n".join(
            "  {0x%08x%s}" % (a, "".join(f",0x{w:08x}" for w in ws)) for a, ws in pairs
        )
        chunks.append(
            f"DW3FN['{overlay}'] = {{\n{lines}\n}}  -- {len(pairs)}/{len(addrs)} with expected words"
        )
        print(f"# {overlay}: {len(pairs)}/{len(addrs)} entries carry an expected word", file=sys.stderr)

    text = "DW3FN = {}\n" + "\n".join(chunks) + "\n"
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text)
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
