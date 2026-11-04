#!/usr/bin/env python3
"""Build web/assets/data/soundtst_catalogue.json from the decoded SOUND TEST tables.

The source is the walker's extraction of the soundtst overlay's own three
tables (docs/research/audio/soundtst-full-decode-2026-08-05.md, section "Three
tables that tile exactly"): 71 VAB categories and 231 packed-sound records. The
source file is locally extracted game data and stays git-ignored; so does this
script's output, because web/assets is the real assets folder (a symlink inside
a build worktree). Only the screen that reads the catalogue is tracked.

The catalogue keeps what the screen needs -- category, archive id, name, the
record count and its {name, id} rows -- and drops the decode document's prose.
It also checks the counts it copies: every category's `count` must match its
sound list, the totals must match the source's own declared totals, and every
packed id must be distinct (231 records, 231 ids). A mismatch stops the build.

Usage:
  python3 tools/build_soundtst_catalogue.py [--source PATH] [--out PATH]
"""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs/research/audio/soundtst-categories.json"
OUT = ROOT / "web/assets/data/soundtst_catalogue.json"


def build_catalogue(source: dict) -> dict:
    categories = source["categories"]
    out = []
    for c in categories:
        sounds = [{"name": s["name"], "id": s["id"]} for s in c["sounds"]]
        if len(sounds) != c["count"]:
            raise SystemExit(
                f"{c['name']}: count says {c['count']}, the table has {len(sounds)} records"
            )
        out.append({
            "category": c["category"],
            "archive_id": c["archive_id"],
            "name": c["name"],
            "count": c["count"],
            "sounds": sounds,
        })

    sound_count = sum(c["count"] for c in out)
    if len(out) != source["categoryCount"]:
        raise SystemExit(
            f"categoryCount says {source['categoryCount']}, the table has {len(out)}"
        )
    if sound_count != source["soundCount"]:
        raise SystemExit(f"soundCount says {source['soundCount']}, the rows add up to {sound_count}")
    ids = [s["id"].lower() for c in out for s in c["sounds"]]
    if len(set(ids)) != len(ids):
        raise SystemExit("duplicate packed id in the catalogue")

    return {
        "categoryCount": len(out),
        "soundCount": sound_count,
        "categories": out,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default=str(SOURCE))
    ap.add_argument("--out", default=str(OUT))
    a = ap.parse_args()

    source = json.loads(Path(a.source).read_text())
    catalogue = build_catalogue(source)
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(catalogue, indent=1) + "\n")
    common = next(c for c in catalogue["categories"] if c["name"] == "COMMON")
    last = catalogue["categories"][-1]
    print(
        f"{out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}: "
        f"{catalogue['categoryCount']} categories, {catalogue['soundCount']} sounds "
        f"(COMMON {common['count']}, last {last['name']} archive {last['archive_id']})"
    )


if __name__ == "__main__":
    main()
