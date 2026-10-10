#!/usr/bin/env python3
"""Census every sub-entry's type tag + byte length across the field-MEFT packs
used by web/assets/data/meft_placements.json. Ground truth for the format
decode work in docs/research/field/map-effects-meft.md -- see
docs/superpowers/plans/2026-07-04-meft-format-decode.md Task 1."""
import json, struct
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PLACEMENTS = REPO / "web/assets/data/meft_placements.json"
PACK_ROOT = Path.home() / "ddw3/pack/dw2003/fight/effect"
OUT = REPO / "docs/research/field/meft-pack-tag-census.json"


def main():
    placements = json.loads(PLACEMENTS.read_text())
    meft_numbers = sorted({r["meft"] for recs in placements.values() for r in recs})

    result = {}
    for n in meft_numbers:
        pack_dir = PACK_ROOT / f"meft{n}"
        if not pack_dir.exists():
            result[str(n)] = {"error": "pack dir missing"}
            continue
        entries = []
        for f in sorted(pack_dir.glob("*.bin"), key=lambda p: int(p.stem)):
            data = f.read_bytes()
            tag = struct.unpack_from("<I", data, 0)[0] if len(data) >= 4 else None
            entries.append({"sub": int(f.stem), "tag": tag, "bytes": len(data)})
        result[str(n)] = entries

    OUT.write_text(json.dumps(result, indent=2) + "\n")
    all_tags = sorted({e["tag"] for entries in result.values() if isinstance(entries, list)
                        for e in entries if e["tag"] is not None})
    print(f"{len(meft_numbers)} MEFT numbers, {len(all_tags)} distinct tags: "
          f"{[hex(t) for t in all_tags]}")


if __name__ == "__main__":
    main()
