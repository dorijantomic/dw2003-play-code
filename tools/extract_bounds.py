#!/usr/bin/env python3
"""Extract every hard bound the game applies: caps, clamps, loop counts, gates.

Why this exists: the numbers a player can check -- "level stops at 99", "the
list shows 16 items", "resistances cap at 999" -- are the most verifiable thing
in the decompilation, and reading them by hand is slow and lossy. A pass over
all 2,561 functions found four caps I had confirmed by hand plus several I had
missed entirely. Scripts do not get tired or transcribe wrong.

It finds five shapes:

  clamp    compare against K, then assign K (or K-1) -- a ceiling or floor
  saturate compare against K, then assign X+1 or X-1 -- a counter that stops
  loop     a do/while bound: `while (i < N)` -- a row/slot/page count
  gate     a bare threshold compare that decides a branch
  mask     `& 0xF`-style periodicity -- "every 16th frame"

`saturate` was added 2026-08-12 after `pro/cardgame:F0x8008d854` was read by
hand. It stops a counter at 99 with `if (temp_v1 < 0x63U) { ... = temp_v1 + 1; }`
and `clamp` could not see it, because a saturating increment assigns `X+1`, not
K. Every row also carries the exact `file:line` and the source line, so a row can
be quoted into an evidence packet without re-finding the site.

What it does NOT do is say what any number MEANS. `99` here is just 99; whether
that is a level cap or a TP cap needs a person. Treat the output as the list of
questions worth asking, not as answers.

Usage:
    python3 tools/extract_bounds.py ststatus
    python3 tools/extract_bounds.py --all --min-count 2
    python3 tools/extract_bounds.py --all --markdown docs/generated/bounds.md
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re
import sys

NUM = r"(0x[0-9A-Fa-f]+|\d+)"

# compare against K on one line, assign K or K-1 on the next -> a clamp
CLAMP = re.compile(
    rf"(?:>=?|<=?)\s*{NUM}\)?\s*\)?\s*\{{?\s*\n\s*[^\n;=]*=\s*{NUM};"
)
# compare a value against K, then step THAT SAME value by one -> a counter that
# saturates at K. `if (v < 0x63U) { s->f = (u8)(v + 1); }` is a cap at 99 that
# CLAMP cannot see, because the assignment is `v + 1`, not K.
#
# The same-value check is the whole of the precision. Without it the shape also
# matched `if (a >= 9) { b = c + 1; }` (a threshold that steps an unrelated
# field) and `if (a >= 0x2E) { var_v0 = -1; }` (a constant, not a step) -- three
# of the first four `>=` hits were false caps of exactly those two forms.
OPERAND = r"[A-Za-z_][A-Za-z0-9_]*(?:(?:->|\.)[A-Za-z0-9_]+|\[[^\]\n]*\])*"
SATURATE = re.compile(
    rf"(?P<lhs>{OPERAND})\s*(?P<op><=?|>=?)\s*(?P<value>{NUM})[Uu]?\s*\)?\s*\)?\s*\{{?\s*\n"
    rf"\s*[^\n;=]*?=\s*(?P<rhs>[^\n;]*?)\s*;"
)
STEP_UP = re.compile(r"\+\s*1\s*\)*\s*$")
STEP_DOWN = re.compile(r"-\s*1\s*\)*\s*$")


def _saturates(match: re.Match) -> bool:
    """True when the guarded assignment steps the value the guard compared."""
    lhs, rhs, op = match["lhs"], match["rhs"], match["op"]
    if lhs not in rhs:  # a different variable was stepped -- not a cap
        return False
    # Only the ceiling form is reported. The floor form (`> K` then `- 1`) reads
    # identically to a one-shot decrement in m2c's SSA output -- the store target
    # is a fresh name either way, so `if (v >= 5) { g = v - 1; }` cannot be told
    # apart from a counter that stops at 5 without resolving where `v` was
    # loaded from. The single corpus-wide hit was of that ambiguous kind, so it
    # is left to `gate` rather than asserted as a bound.
    return bool(op.startswith("<") and STEP_UP.search(rhs))
# do { ... } while (x < N)  /  while (x < N)
LOOP = re.compile(rf"while\s*\([^)]*?<\s*{NUM}\s*\)")
# if (x >= K) / if (x < K) with no paired assignment -- a threshold
GATE = re.compile(rf"if\s*\([^)]*?(?:>=|<)\s*{NUM}\s*\)")
# & 0xF style periodicity
MASK = re.compile(r"&\s*(0x[0-9A-Fa-f]*[Ff])\)")

# Values that carry no information: fixed-point 1.0, colour bytes, common
# sentinels, and small loop counts that are almost always struct arity.
NOISE = {0, 1, 2, 3, 0x1000, 0xFF, 0xFFFF, 0x100, 0x10000, 0x7F, 0xFF00}


def parse(v: str) -> int:
    return int(v, 16) if v.lower().startswith("0x") else int(v)


def scan_file(path: pathlib.Path) -> list[dict]:
    try:
        text = path.read_text(errors="replace")
    except OSError:
        return []
    if "Decompilation failure" in text:
        return []

    addr = path.stem.lstrip("F").lower()
    out: list[dict] = []

    # A row without a citation cannot become evidence: it only says a number
    # exists somewhere in an overlay, so the site has to be found again by hand.
    lines = text.split("\n")

    def site(match: re.Match, kind: str, value: int) -> dict:
        line = text.count("\n", 0, match.start()) + 1
        return {"kind": kind, "value": value, "addr": addr,
                "line": line, "quote": lines[line - 1].strip(),
                "path": str(path)}

    for m in CLAMP.finditer(text):
        a, b = parse(m.group(1)), parse(m.group(2))
        # a real clamp tests K and assigns K or K-1
        if abs(a - b) <= 1 and b not in NOISE:
            out.append(site(m, "clamp", b))

    for m in SATURATE.finditer(text):
        n = parse(m["value"])
        if n not in NOISE and n > 3 and _saturates(m):
            out.append(site(m, "saturate", n))

    for m in LOOP.finditer(text):
        n = parse(m.group(1))
        if 3 < n <= 512:  # below 4 is noise; above 512 is a buffer wipe
            out.append(site(m, "loop", n))

    for m in GATE.finditer(text):
        n = parse(m.group(1))
        if n not in NOISE and n > 3:
            out.append(site(m, "gate", n))

    for m in MASK.finditer(text):
        n = parse(m.group(1))
        if n >= 0xF:
            out.append(site(m, "mask", n + 1))

    return out


def scan_overlay(d: pathlib.Path) -> list[dict]:
    # `exe-decomp/c/` is the main executable, not an overlay, so it has no
    # `_c` suffix -- which is exactly why the `*_c` glob skipped all 749 of its
    # functions until 2026-08-12. Name it `exe` to match the function ids.
    ov = "exe" if d.name == "c" else d.name.removesuffix("_c")
    rows = []
    for f in sorted(d.glob("*.c")):
        for r in scan_file(f):
            r["overlay"] = ov
            rows.append(r)
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("overlays", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--min-count", type=int, default=1,
                    help="only report a value seen at least this many times")
    ap.add_argument("--kind",
                    choices=("clamp", "saturate", "loop", "gate", "mask"))
    ap.add_argument("--json", type=pathlib.Path)
    ap.add_argument("--markdown", type=pathlib.Path)
    args = ap.parse_args()

    root = pathlib.Path("exe-decomp")
    if args.all:
        dirs = sorted(d for d in root.glob("*_c")
                      if not d.name.startswith("wstag"))
        if (root / "c").is_dir():
            dirs.append(root / "c")
    elif args.overlays:
        dirs = [root / "c" if o == "exe" else root / f"{o}_c"
                for o in args.overlays]
    else:
        ap.error("give an overlay or --all")

    rows = []
    for d in dirs:
        if d.is_dir():
            rows += scan_overlay(d)
    if args.kind:
        rows = [r for r in rows if r["kind"] == args.kind]

    # group: (overlay, kind, value) -> the functions it appears in
    grouped: dict[tuple, list[str]] = collections.defaultdict(list)
    sites: dict[tuple, list[dict]] = collections.defaultdict(list)
    for r in rows:
        key = (r["overlay"], r["kind"], r["value"])
        grouped[key].append(r["addr"])
        sites[key].append({"function": r["addr"], "path": r["path"],
                           "line": r["line"], "quote": r["quote"]})

    print(f"{len(rows)} bounds across {len(dirs)} overlays\n")
    by_ov = collections.defaultdict(list)
    for (ov, kind, val), addrs in grouped.items():
        if len(addrs) >= args.min_count:
            by_ov[ov].append((kind, val, sorted(set(addrs))))

    for ov in sorted(by_ov):
        print(f"### {ov}")
        for kind, val, addrs in sorted(by_ov[ov], key=lambda t: (t[0], -t[1])):
            dec = f"{val}" if val < 10 else f"{val} (0x{val:X})"
            where = f"{len(addrs)} fns" if len(addrs) > 2 else \
                    ", ".join("0x" + a[2:] for a in addrs)
            print(f"  {kind:6s} {dec:18s} {where}")
        print()

    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(
            [{"overlay": o, "kind": k, "value": v, "functions": a,
              "sites": sites[(o, k, v)]}
             for (o, k, v), a in sorted(grouped.items())], indent=1))
        print(f"wrote {args.json}")

    if args.markdown:
        out = [
            "# Every hard bound in the game, extracted",
            "",
            "Caps, clamps, loop counts, thresholds and periodicities, pulled",
            "mechanically from the decompiled C by `tools/extract_bounds.py`.",
            "",
            "**These are numbers, not meanings.** The tool does not know whether",
            "a 99 is a level cap or a TP cap. Use this as the list of questions",
            "worth asking — a value here is something a player could go and",
            "check, if someone works out what it governs.",
            "",
            "`saturate` is a counter that stops: the code tests against K and",
            "then steps by one, so the value never passes K. `overlay = exe` is",
            "the main executable rather than an overlay.",
            "",
            "The exact `file:line` of every site is in the companion",
            "`bounds.json`, so a row can be quoted into an evidence packet",
            "without re-finding it. The `where` column below shows the first.",
            "",
            "| overlay | kind | value | functions | where |",
            "|---|---|---|---|---|",
        ]
        for ov in sorted(by_ov):
            for kind, val, addrs in sorted(by_ov[ov], key=lambda t: (t[0], -t[1])):
                dec = f"{val}" if val < 10 else f"{val} (0x{val:X})"
                fns = ", ".join("`0x" + a[2:] + "`" for a in addrs[:3])
                if len(addrs) > 3:
                    fns += f" +{len(addrs)-3}"
                first = sites[(ov, kind, val)][0]
                where = f"`{first['path']}:{first['line']}`"
                out.append(f"| {ov} | {kind} | {dec} | {fns} | {where} |")
        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text("\n".join(out) + "\n")
        print(f"wrote {args.markdown}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
