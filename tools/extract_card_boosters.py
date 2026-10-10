#!/usr/bin/env python3
"""Extract the card-shop booster-pack pools from pro/stcrdshp.

Decoded 2026-08-07 from the pack-opening handler F0x800844B8 case 0xB
(exe-decomp/stcrdshp_c/F0x800844b8.c), verified against
~/ddw3/asm/dw2003/pro/stcrdshp.s:

  * The set table is at 0x8008C708, stride 0x1C (7 words):
        { u32 setId, u32 poolPtr[6] }
    and is terminated by a record whose setId is 0.
  * `setId` is matched against the halfword the shop list holds at obj+0x98,
    and the same id indexes the per-set pack stock at save + setId + 0x7C.
  * Opening a pack draws SIX cards. Draw i reads poolPtr[i] -- one pool per
    slot in the pack, not six interchangeable pools -- and indexes it with
    the resident RNG reduced `% 16`.
  * Each pool is therefore 16 u32 card ids. Repeated ids are the rarity
    weighting; there is no separate weight field.

Usage: .venv/bin/python3 tools/extract_card_boosters.py [--out PATH]
"""

from __future__ import annotations
import os

import argparse
import json
import re
from pathlib import Path

ASM = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro/stcrdshp.s"
LOAD_BASE = 0x80082CB0
TABLE_ADDR = 0x8008C708
RECORD_STRIDE = 0x1C
POOLS_PER_SET = 6
POOL_ENTRIES = 16
CATALOG_SIZE = 316

WORD = re.compile(r"^\.L0x([0-9a-fA-F]+):\s+\.word\s+(?:D0x([0-9a-fA-F]+)|0x([0-9a-fA-F]+))")


def read_words(path: Path) -> dict[int, int]:
    """file offset -> word value, for every `.word` datum in the overlay."""
    out: dict[int, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = WORD.match(line.strip())
        if m:
            off = int(m.group(1), 16)
            out[off] = int(m.group(2) or m.group(3), 16)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="web/assets/data/card_boosters.json")
    ap.add_argument("--asm", default=str(ASM))
    args = ap.parse_args()

    asm = Path(args.asm).expanduser()
    words = read_words(asm)

    def at(addr: int) -> int | None:
        return words.get(addr - LOAD_BASE)

    sets = []
    warnings: list[str] = []
    index = 0
    while True:
        rec = TABLE_ADDR + index * RECORD_STRIDE
        set_id = at(rec)
        if set_id is None:
            warnings.append(f"record {index} at {rec:#x} is not word data; stopped")
            break
        if set_id == 0:
            break

        pools = []
        for slot in range(POOLS_PER_SET):
            ptr = at(rec + 4 + slot * 4)
            if ptr is None:
                warnings.append(f"set {set_id}: pool pointer {slot} missing")
                pools.append(None)
                continue
            cards = []
            for entry in range(POOL_ENTRIES):
                v = at(ptr + entry * 4)
                if v is None:
                    warnings.append(f"set {set_id} pool {slot}: entry {entry} missing")
                    break
                cards.append(v)
            pools.append({"address": f"{ptr:#010x}", "cards": cards})
        sets.append({"setId": set_id, "record": f"{rec:#010x}", "pools": pools})
        index += 1

    every = [c for s in sets for p in s["pools"] if p for c in p["cards"]]
    bad = sorted({c for c in every if not 0 < c <= CATALOG_SIZE})
    if bad:
        warnings.append(f"card ids outside 1..{CATALOG_SIZE}: {bad}")

    doc = {
        "_source": "pro/stcrdshp, table 0x8008C708, via F0x800844B8 case 0xB",
        "_note": (
            "Draw i of a six-card pack comes from pools[i]; each pool is 16 u32 "
            "card ids indexed by the resident RNG mod 16. Repeated ids ARE the "
            "rarity weighting."
        ),
        "recordStride": RECORD_STRIDE,
        "poolsPerSet": POOLS_PER_SET,
        "poolEntries": POOL_ENTRIES,
        "cardsPerPack": POOLS_PER_SET,
        "sets": sets,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")

    print(f"sets={len(sets)} pools={sum(1 for s in sets for p in s['pools'] if p)} "
          f"card-slots={len(every)} distinct={len(set(every))}")
    print(f"set ids: {[s['setId'] for s in sets]}")
    for w in warnings:
        print("WARN:", w)
    print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
