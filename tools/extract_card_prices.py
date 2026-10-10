#!/usr/bin/env python3
"""Extract the card-shop price table from pro/stcrdshp.

Decoded 2026-08-08 from ~/ddw3/asm/dw2003/pro/stcrdshp.s (authority 2).

How the shop reaches a price
----------------------------
The purchase/list handler builds the grid index and looks the card up, at
`.L0x000046b4`..`.L0x0000471c`:

    index  = [obj+0x6C]*6 + [obj+0x5C]     # row*6 + column, the 6-card grid
    cardId = halfword at ([obj+0xA8]+0x8)[index]
    [obj+0x98] = cardId
    v0     = *(0x8008CB9C)                 # a function POINTER
    price  = (s16) v0(cardId)
    [obj+0x9C] = price

`obj+0x9C` is then the value compared against the player's money at
`save+0x6C` (F0x80086DC4) and subtracted from it on purchase. The SAME pointer
is called again at `.L0x0000369c` with a card id, its result sign-extended and
handed to the number-draw method `+0x118` -- that is the shop printing each
card's price. Two call sites, one signature: card id in, price out.

CAUTION -- the borrow. Those sites read `lui 0x8009` + `addiu/lw -0x3464`,
which is `0x80090000 - 0x3464 = 0x8008CB9C`, NOT `0x8009CB9C`. Reading it as
0x8009CB9C puts the slot outside the overlay and sends you to the emulator for
nothing. The same borrow makes the neighbouring `-0x38f8` resolve to
0x8008C708, the booster-pool table extract_card_boosters.py already reads --
which is the cross-check that the borrow reading is the correct one.

The lookup itself
-----------------
`0x8008CB9C` holds `0x8008923C`. That function (offset 0x658C) is a linear
search over `(u16 cardId, u16 price)` pairs based at 0x8008CD20:

    if halfword[base] == 0: return 1
    p = base
    loop: if halfword[p] == cardId: return halfword[p+2]
          p += 4
          if halfword[p] != 0: goto loop
    return 1

so the table is zero-terminated on the card id, and **a card that is not
listed costs 1** -- the `li $v0, 0x1` in the `jr $ra` delay slot at
`.L0x000065d0`. That default is a real game rule, not an error path: most of
the 316-card catalog is absent from this table.

Verification: the 44 extracted entries were checked against 43 independent
(card, price) pairs transcribed from eleven shop lists in a community guide --
43 agree, 0 disagree, none missing. The guide is not evidence (see
reference-external/README.md); it is a cross-check that the table was read
correctly.

Usage: .venv/bin/python3 tools/extract_card_prices.py [--out PATH]
"""

from __future__ import annotations
import os

import argparse
import json
import re
from pathlib import Path

ASM = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro/stcrdshp.s"
LOAD_BASE = 0x80082CB0
#: holds the price-function pointer
PTR_SLOT = 0x8008CB9C
#: the function that slot is expected to hold
PRICE_FN = 0x8008923C
#: base of the (cardId, price) pair list
TABLE_ADDR = 0x8008CD20
#: price returned for a card the table does not list
DEFAULT_PRICE = 1
CATALOG_SIZE = 316

WORD = re.compile(r"^\.L0x([0-9a-fA-F]+):\s+\.word\s+(?:D0x([0-9a-fA-F]+)|0x([0-9a-fA-F]+))")


def read_words(path: Path) -> dict[int, int]:
    """file offset -> word value, for every `.word` datum in the overlay."""
    out: dict[int, int] = {}
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        m = WORD.match(line.strip())
        if m:
            out[int(m.group(1), 16)] = int(m.group(2) or m.group(3), 16)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="web/assets/data/card_prices.json")
    ap.add_argument("--asm", default=str(ASM))
    ap.add_argument("--catalog", default="web/assets/data/card_catalog.json")
    args = ap.parse_args()

    words = read_words(Path(args.asm).expanduser())
    warnings: list[str] = []

    def at(addr: int) -> int | None:
        return words.get(addr - LOAD_BASE)

    # Follow the pointer rather than trusting the constant: if the overlay ever
    # changes, this fails loudly instead of silently reading the wrong bytes.
    held = at(PTR_SLOT)
    if held is None:
        print(f"FATAL: {PTR_SLOT:#010x} is not word data in this overlay")
        return 1
    if held != PRICE_FN:
        print(f"FATAL: {PTR_SLOT:#010x} holds {held:#010x}, expected the price "
              f"function {PRICE_FN:#010x}; the layout changed -- re-derive before trusting this")
        return 1

    # Each word is a little-endian (u16 cardId, u16 price) pair: the low half is
    # the id the search compares, the high half is the price it returns.
    prices: list[dict] = []
    seen: set[int] = set()
    addr = TABLE_ADDR
    while True:
        w = at(addr)
        if w is None:
            warnings.append(f"entry at {addr:#x} is not word data; stopped")
            break
        card_id, price = w & 0xFFFF, (w >> 16) & 0xFFFF
        if card_id == 0:
            break
        if card_id in seen:
            # The search returns the FIRST match, so a duplicate id would make
            # later entries dead. Worth knowing about.
            warnings.append(f"card id {card_id} listed more than once; the first wins")
        seen.add(card_id)
        if not 0 < card_id <= CATALOG_SIZE:
            warnings.append(f"card id {card_id} outside 1..{CATALOG_SIZE}")
        prices.append({"id": card_id, "price": price})
        addr += 4

    # Name them from the catalog when it is available -- readability only; the
    # id is what the lookup uses.
    cat_path = Path(args.catalog)
    if cat_path.exists():
        by_id = {c["id"]: c for c in json.loads(cat_path.read_text())["cards"]}
        for row in prices:
            rec = by_id.get(row["id"])
            if rec:
                row["name"] = rec["name"]
            else:
                warnings.append(f"card id {row['id']} is not in the catalog")

    doc = {
        "_source": f"pro/stcrdshp, table {TABLE_ADDR:#010x} via {PRICE_FN:#010x}, "
                   f"reached through the pointer at {PTR_SLOT:#010x}",
        "_note": (
            "Linear search over (u16 cardId, u16 price) pairs, zero-terminated on "
            "the card id. A card NOT listed here costs defaultPrice, which the "
            "original returns from the jr delay slot -- that is a game rule, not "
            "a fallback for missing data."
        ),
        "tableAddress": f"{TABLE_ADDR:#010x}",
        "defaultPrice": DEFAULT_PRICE,
        "prices": prices,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")

    distinct = sorted({p["price"] for p in prices})
    print(f"entries={len(prices)} distinct-prices={len(distinct)} default={DEFAULT_PRICE}")
    print(f"prices: {distinct}")
    for w in warnings:
        print("WARN:", w)
    print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
