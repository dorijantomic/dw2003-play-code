"""Mine per-battle MUSIC from the wstag battle-trigger tables.

Decoded 2026-07-03 (closes the boss-music producer thread, sound-system.md
§2026-07-03h/i): the per-stage battle-trigger records (battle-invocation.md
step 2 — 12-byte structs `{screen_id:u16, 0, param:u16, 0, tag:u32}` in zone
blocks of 8, empty slot = `{0,0,0x60040000}`) carry the battle's MUSIC in the
`tag` field. The field caller (fieldstg 0x80092780, battle-invocation.md step
3) copies `record+0x8` into `0x80042b1c+0x14` — which IS the address
`0x80042b30`, the "battle music global" wfightmn plays (archive=(id>>18)&0x7f;
§2026-07-03g). So bosses get their theme by DATA: e.g. wstag205 has
`{screen 0x107, 18, 0x608c0000}` = boss01 for the Keith fight, while regular
zone records carry 0x60080000 (batl00) / 0x600c0000 (batl10).

Detection: scan each wstagNNN.s raw data words for runs of 12-byte records
where every record's tag has the battle sentinel shape 0x60XX0000
(XX = archive id, even, <=0x7f<<1) and empty slots are exactly
{0,0,0x60040000}. A block qualifies if it has >=4 empty sentinel records
(zone blocks are 8 records, mostly empty) or any non-empty record whose
tag maps to a known sound archive.

Output: web/assets/data/battle_music.json
  { "s205": [ {"screen_id": 263, "param": 18, "tag": "0x608c0000",
               "bank": "boss01"} ... ], ... }
"""
import os
import json
import re
import sys
from pathlib import Path

ASM = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro"
OUT = Path(__file__).parent.parent / "web/assets/data/battle_music.json"
DOCS = Path(__file__).parent.parent / "docs/research/audio"

WORD = re.compile(r"\.L0x([0-9a-f]{8}): (?:\.word 0x([0-9a-f]+)|(\w))")


def load_words(path):
    words = {}
    for m in re.finditer(r"\.L0x([0-9a-f]{8}): \.word 0x([0-9a-f]+)", path.read_text()):
        words[int(m.group(1), 16)] = int(m.group(2), 16)
    return words


def archive_names():
    """archive id -> bank name, from the Sound Test's own category table.

    Read from tools/extract_soundtst.py's structural walk of the overlay
    (docs/research/audio/soundtst-categories.json): the 71 category records,
    each `{name, archive_id}`; the record's name is the bank directory
    (COMMON -> `common`, BOSS04 -> `boss04`). This replaces the hand-kept
    soundtst-all-categories.json list, which had drifted: it carried 201 of
    the disc's 231 rows across 70 categories and dropped category 70 (TTLBGM,
    archive 71) entirely.
    """
    cats = json.load(open(DOCS / "soundtst-categories.json"))
    out = {}
    for cat in cats["categories"]:
        out[cat["archive_id"]] = cat["name"].lower()
    return out


def mine(path, banks):
    words = load_words(path)
    offs = sorted(words)
    found = []
    seen_blocks = set()
    for off in offs:
        # candidate block start: try 8 records of 12 bytes
        recs = []
        ok = True
        empties = 0
        for i in range(8):
            base = off + i * 12
            a, b, t = (words.get(base + j) for j in (0, 4, 8))
            if a is None and b is None and t is None:
                # .word dumps skip zero-only lines sometimes; treat missing as 0
                a, b, t = a or 0, b or 0, t or 0
            a, b, t = a or 0, b or 0, t or 0
            if (a, b, t) == (0, 0, 0x60040000):
                empties += 1
                recs.append(None)
                continue
            # non-empty: screen_id u16 (upper half 0), param u16, sentinel tag
            if (
                a != 0
                and (a >> 16) == 0
                and (b >> 16) == 0
                and (t & 0xFF03FFFF) == 0x60000000
                and ((t >> 18) & 0x7F) in banks
            ):
                recs.append((a, b, t))
            else:
                ok = False
                break
        if not ok or empties < 4:
            continue
        if any(r for r in recs):
            if off in seen_blocks:
                continue
            seen_blocks.update(off + i * 12 for i in range(8))
            for r in recs:
                if r:
                    found.append(
                        {
                            "screen_id": r[0],
                            "param": r[1],
                            "tag": f"0x{r[2]:08x}",
                            "bank": banks[(r[2] >> 18) & 0x7F],
                        }
                    )
    return found


def main():
    banks = archive_names()
    result = {}
    for p in sorted(ASM.glob("wstag*.s")):
        stage = "s" + p.stem[5:]
        recs = mine(p, banks)
        # overlapping scan windows can re-emit a record; keep unique triples
        uniq, seen = [], set()
        for r in recs:
            k = (r["screen_id"], r["param"], r["tag"])
            if k not in seen:
                seen.add(k)
                uniq.append(r)
        if uniq:
            result[stage] = uniq
    OUT.write_text(json.dumps(result, indent=1))
    n = sum(len(v) for v in result.values())
    nonbatl = {
        s: [r for r in v if not r["bank"].startswith("batl")]
        for s, v in result.items()
    }
    nonbatl = {s: v for s, v in nonbatl.items() if v}
    print(f"{n} battle-trigger records across {len(result)} stages -> {OUT}")
    print(f"{sum(len(v) for v in nonbatl.values())} non-batl (boss/special) records:")
    for s, v in sorted(nonbatl.items()):
        for r in v:
            print(f"  {s}: screen {r['screen_id']} (0x{r['screen_id']:x}) param {r['param']} -> {r['bank']}")


if __name__ == "__main__":
    main()
