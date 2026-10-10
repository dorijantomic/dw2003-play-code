#!/usr/bin/env python3
"""Extract the 40-card starter folder granted to a new game.

Decoded from the starter grant F0x80016E6C (exe-decomp/c/F0x80016e6c.c),
verified against ~/ddw3/asm/dw2003/exe/fns.s L7574-7590:

    lw    $a0, ($s1)        # one u32 card id
    addiu $s1, 0x4          # stride 4
    ...
    slti  $v0, $s0, 0x28    # 40 entries

The routine grants one copy of each id through the collection add routine
F0x80016E2C (which clamps at nine), then writes the same 40 ids into the
folder entry array THREE times at the 0x66 folder stride -- so a new game
starts with all three folders pre-built and identical, not empty.

The table itself lives in the resident executable at 0x8004B49C and is
already carried, one word per symbol, by the decompilation's data table.

Usage: .venv/bin/python3 tools/extract_card_starter.py [--out PATH]
"""

from __future__ import annotations
import os

import argparse
import json
import re
from collections import Counter
from pathlib import Path

DATA_RS = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "rust/dw2003_exe_data/src/data.rs"
TABLE_ADDR = 0x8004B49C
ENTRIES = 40
FOLDERS = 3
FOLDER_STRIDE = 0x66
CATALOG_SIZE = 316

SYM = re.compile(r'D0x([0-9a-f]{8})\s*@\s*"0x[0-9a-f]{8}"\s*:\s*u32\s*=\s*0x([0-9a-fA-F]{8});')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="web/assets/data/card_starter.json")
    ap.add_argument("--data-rs", default=str(DATA_RS))
    ap.add_argument("--catalog", default="web/assets/data/card_catalog.json")
    args = ap.parse_args()

    words: dict[int, int] = {}
    for line in Path(args.data_rs).expanduser().read_text(
        encoding="utf-8", errors="replace"
    ).splitlines():
        m = SYM.search(line)
        if m:
            words[int(m.group(1), 16)] = int(m.group(2), 16)

    ids, missing = [], []
    for i in range(ENTRIES):
        a = TABLE_ADDR + i * 4
        if a in words:
            ids.append(words[a])
        else:
            missing.append(f"{a:#010x}")
    if missing:
        raise SystemExit(f"missing starter entries: {missing}")

    names: dict[int, str] = {}
    cat = Path(args.catalog)
    if cat.exists():
        raw = json.loads(cat.read_text(encoding="utf-8"))
        rows = raw["cards"] if isinstance(raw, dict) and "cards" in raw else raw
        names = {r["id"]: r.get("name", "") for r in rows if "id" in r}

    counts = Counter(ids)
    bad = sorted(i for i in counts if not 0 < i <= CATALOG_SIZE)
    over = sorted(i for i, n in counts.items() if n > 9)

    doc = {
        "_source": "resident EXE table 0x8004B49C, granted by F0x80016E6C",
        "_note": (
            "One copy of each id is added to the collection, then the same 40 ids "
            "are written into all three folders at the 0x66 folder stride. A new "
            "game therefore starts with three identical, full folders."
        ),
        "address": f"{TABLE_ADDR:#010x}",
        "entryStride": 4,
        "folders": FOLDERS,
        "folderStride": FOLDER_STRIDE,
        "cardIds": ids,
        "distinct": [
            {"id": i, "copies": counts[i], "name": names.get(i, "")}
            for i in sorted(counts)
        ],
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")

    print(f"entries={len(ids)} distinct={len(counts)} max_copies={max(counts.values())}")
    if bad:
        print("WARN: ids outside catalog:", bad)
    if over:
        print("WARN: ids above the nine-copy cap:", over)
    print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
