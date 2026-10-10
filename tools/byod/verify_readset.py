#!/usr/bin/env python3
"""Readset verification: every file the dw2003-play-code build reads from the
ddw3 tree must be byte-identical in the generated tree (or, for .png,
pixel-identical — the 2023 PNG encoder is not reproducible).

Usage: python3 verify_readset.py <tree>   (or BYOD_TREE=<tree>)
Compares <tree> vs DDW3_DIR (default ~/ddw3) for every path in
data/readset.tsv (captured from an audit-hooked reference build) and prints
per-group counts. For .png it also pixel-compares the differing files.
"""
import collections
import io
import os
import sys
from pathlib import Path

TREE = Path(sys.argv[1] if len(sys.argv) > 1 else os.environ.get("BYOD_TREE", "tree"))
DD = Path(os.environ.get("DDW3_DIR") or os.path.expanduser("~/ddw3"))
RS = Path(__file__).resolve().parent / "data" / "readset.tsv"

groups = collections.defaultdict(lambda: collections.Counter())
differing = []
missing = []
png_differ_bytes = []


def group_of(rel: str) -> str:
    top = rel.split("/")[0]
    if top == "tim" and rel.endswith(".png"):
        return "tim (.png)"
    return top


for line in open(RS):
    rel = line.split("\t")[0]
    a = TREE / rel
    b = DD / rel
    g = group_of(rel)
    if not a.exists():
        missing.append(rel)
        groups[g]["missing"] += 1
        continue
    if not b.exists():
        groups[g]["ref-missing"] += 1
        continue
    da = a.read_bytes()
    db = b.read_bytes()
    if da == db:
        groups[g]["identical"] += 1
    elif rel.endswith(".png"):
        groups[g]["png-bytes-differ"] += 1
        png_differ_bytes.append(rel)
    else:
        groups[g]["differ"] += 1
        if len(differing) < 40:
            differing.append(rel)

print(f"{'group':14s} {'identical':>9s} {'png-diff':>8s} {'differ':>7s} {'missing':>7s} {'total':>7s}")
total = collections.Counter()
for g in sorted(groups):
    c = groups[g]
    n = sum(c.values())
    for k, v in c.items():
        total[k] += v
    print(f"{g:14s} {c['identical']:>9d} {c['png-bytes-differ']:>8d} {c['differ']:>7d} "
          f"{c['missing']:>7d} {n:>7d}")
print(f"{'TOTAL':14s} {total['identical']:>9d} {total['png-bytes-differ']:>8d} "
      f"{total['differ']:>7d} {total['missing']:>7d} {sum(total.values()):>7d}")

if png_differ_bytes:
    print(f"\npixel-checking {len(png_differ_bytes)} png files ...")
    from PIL import Image
    bad = 0
    for rel in png_differ_bytes:
        try:
            ia = Image.open(TREE / rel)
            ib = Image.open(DD / rel)
            if ia.size != ib.size or ia.mode != ib.mode or \
               list(ia.convert("RGBA").getdata()) != list(ib.convert("RGBA").getdata()):
                bad += 1
                if bad <= 10:
                    print("  PIXEL DIFF:", rel)
        except Exception as e:
            bad += 1
            print("  ERROR:", rel, e)
    print(f"png pixel mismatches: {bad} of {len(png_differ_bytes)} "
          f"-> pixel-identical (output-identical): {len(png_differ_bytes)-bad}")
if differing:
    print("\nnon-png differing (first 40):")
    for d in differing:
        print("  ", d)
if missing:
    print(f"\nmissing files ({len(missing)}), first 40:")
    for m in missing[:40]:
        print("  ", m)
