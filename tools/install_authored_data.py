#!/usr/bin/env python3
"""Copy the hand-authored (non-game) data files into the web tree.

data/authored/<path> is installed at <path>. Everything under data/authored is
written by this project -- curated mappings and research tables, not bytes or
text from the game -- and has no generator in build_all.py. Each file says
where it came from in its own `_comment`/`note` field where the format allows.
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data/authored"


def main() -> int:
    n = 0
    for src in sorted(p for p in SRC.rglob("*") if p.is_file() and p.parent != SRC):
        dst = ROOT / src.relative_to(SRC)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        n += 1
    print(f"installed {n} authored files from {SRC}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
