#!/usr/bin/env python3
"""Recompute ledger claims that assert statistics over extracted artifacts.

`handoff-check` proves the ledger is internally consistent, and
`audit_evidence_digests.py` proves each anchor still matches the file it cites.
Neither re-derives an ARITHMETIC assertion. A claim can keep a valid quote and a
matching digest while the extracted table it counts has been rebuilt underneath
it -- that is how `RANK-E01` came to quote its card correctly while the catalog
it counted had grown from 315 to 316 entries.

So this audits the one class of claim that can be checked with no judgement at
all: a claim that names an artifact under `web/assets/data/` and asserts a
number about it. Every check below re-derives the number from the live file.

Scope, stated plainly because it is small: this reaches 8 of ~505 live claims.
A prose claim about assembly cannot be recomputed and is NOT covered here.
A green run means "no recomputable claim has drifted", never "the ledger is
correct".

Usage:
  .venv/bin/python3 tools/audit_claim_arithmetic.py            # report
  .venv/bin/python3 tools/audit_claim_arithmetic.py --check    # exit 1 on drift
"""

from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "web/assets/data"


def load(name: str):
    path = DATA / name
    return json.loads(path.read_text()) if path.exists() else None


def checks() -> list[tuple[str, str, object, object]]:
    """(claim id, what, asserted, recomputed) for every recomputable assertion."""
    rows: list[tuple[str, str, object, object]] = []
    catalog = load("card_catalog.json")
    boosters = load("card_boosters.json")
    starter = load("card_starter.json")
    digimon = load("digimon.json")
    enemies = load("enemies.json")

    if catalog:
        cards = catalog["cards"]
        ids = {card["id"] for card in cards}
        claim = "card-catalog-cardpak-1580-stride"
        digimon_cards = [card for card in cards if card["kind"] == "digimon"]
        histogram = sorted(
            collections.Counter(card["colour"] for card in digimon_cards).values(),
            reverse=True,
        )
        rows.append((claim, "catalog records", 316, len(cards)))
        rows.append((claim, "Digimon cards", 256, len(digimon_cards)))
        rows.append((claim, "colour split over Digimon cards",
                     [43, 43, 43, 43, 43, 41], histogram))
        rows.append((claim, "Program cards", 60,
                     sum(1 for card in cards if card["kind"] == "program")))

        if boosters:
            claim = "cardgame-booster-pools-are-35-sets-of-six-per-slot-pools-of-sixteen"
            sets = boosters["sets"]
            pools = [pool for item in sets for pool in item.get("pools", [])]
            slots = [
                slot for pool in pools
                for slot in (pool if isinstance(pool, list) else pool.get("cards", []))
            ]
            rows.append((claim, "booster sets", 35, len(sets)))
            rows.append((claim, "pools", 210, len(pools)))
            rows.append((claim, "card slots", 3360, len(slots)))
            rows.append((claim, "distinct ids", 299, len(set(slots))))
            rows.append((claim, "slot ids outside the catalog", 0,
                         len(set(slots) - ids)))

        if starter:
            claim = "cardgame-starter-folder-forty-ids-extracted"
            rows.append((claim, "starter ids", 40, len(starter["cardIds"])))
            rows.append((claim, "starter ids outside the catalog", 0,
                         len(set(starter["cardIds"]) - ids)))

    claim = "smdldata-population-counts-match-partner-and-enemy-rosters"
    if digimon:
        playable = digimon["digimon"]
        rows.append((claim, "playable Digimon", 55, len(playable)))
        rows.append((claim, "playable ids are exactly 1..55", list(range(1, 56)),
                     sorted(item["id"] for item in playable)))
    if enemies:
        # The claim itself states enemies.json holds 194 against smdldata's 193 and
        # calls the off-by-one unexplained. 194 is therefore the ASSERTED value; a
        # change here means the artifact moved under a disclosed discrepancy.
        rows.append((claim, "enemy records (claim discloses 194 vs smdldata 193)",
                     194, len(enemies["enemies"])))
    return rows


def main() -> int:
    rows = checks()
    drifted = [row for row in rows if row[2] != row[3]]
    by_claim: dict[str, list] = collections.defaultdict(list)
    for row in rows:
        by_claim[row[0]].append(row)
    for claim, items in by_claim.items():
        bad = [item for item in items if item[2] != item[3]]
        print(f"{'DRIFT' if bad else 'ok   '}  {claim}")
        for _, what, asserted, actual in items:
            if asserted != actual:
                print(f"         {what}: claim says {asserted!r}, recomputed {actual!r}")
    print(f"\n{len(rows)} recomputable assertions across {len(by_claim)} claims; "
          f"{len(drifted)} drifted")
    if drifted and "--check" in sys.argv:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
