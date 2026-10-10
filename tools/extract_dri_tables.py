#!/usr/bin/env python3
"""Extract stable stgdglab tables from the checked-in 2 MiB RAM dumps.

The addresses and types come from the stgdglab disassembly, not screenshots:

* 0x8008F470: eight chart-root IDs (F0x8008365c)
* 0x8008F4C4: eight rows of seven portrait animation clip IDs
* 0x8008F628: sentinel-terminated {u16 key, s16 portrait, u16 metadata}
  records searched by F0x8008f3d8/F0x8008f424
* 0x80042BDC: 0x12-byte item rows; byte +4 selects cmfont clip +0x37
  (F0x80085ec4 and the other Switch render states)

All six captures must agree on these static ranges. Runtime screen structures are
state-specific and intentionally belong in a separate extractor once their owning
context pointers have been proved.
"""

from __future__ import annotations

import argparse
import json
import sys
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
DEFAULT_DUMPS = ROOT / "docs" / "research" / "ui" / "dri-states"
DEFAULT_OUT = ROOT / "web" / "assets" / "data" / "dri_tables.json"
ITEMS = ROOT / "web" / "assets" / "data" / "items.json"
STGDGLAB_DISC_INDEX = 492  # data/native_screen_roots.json pro/stgdglab


def ram_offset(address: int) -> int:
    return address & 0x1FFFFF


def read_at(data: bytes, address: int, size: int) -> bytes:
    offset = ram_offset(address)
    chunk = data[offset : offset + size]
    if len(chunk) != size:
        raise ValueError(f"RAM read 0x{address:08x}+0x{size:x} exceeds dump")
    return chunk


def resolver_records(data: bytes) -> list[dict[str, int]]:
    records = []
    address = 0x8008F628
    while True:
        key, portrait, metadata = struct.unpack_from("<HhH", data, ram_offset(address))
        if key == 0:
            return records
        records.append({"id": key, "portrait_clip": portrait, "metadata": metadata})
        address += 6
        if len(records) > 256:
            raise ValueError("portrait resolver has no sentinel within 256 records")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dumps", type=Path, default=DEFAULT_DUMPS)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--disc", action="store_true",
                        help="read the static ranges from the disc (resident EXE + "
                             "pro/stgdglab, disc file 492) instead of RAM dumps")
    args = parser.parse_args()

    if args.disc:
        from ram_image import ram_image
        dumps = [(Path("dw2003.bin"), ram_image(overlay_index=STGDGLAB_DISC_INDEX))]
    else:
        paths = sorted(args.dumps.glob("dri_s*.bin"))
        if len(paths) != 6:
            raise ValueError(f"expected 6 DRI RAM dumps in {args.dumps}, found {len(paths)}")
        dumps = [(path, path.read_bytes()) for path in paths]
    for path, data in dumps:
        if len(data) != 2 * 1024 * 1024:
            raise ValueError(f"{path}: expected 2 MiB, got {len(data)} bytes")

    item_data = json.loads(ITEMS.read_text())
    item_count = max(int(row["id"]) for row in item_data["catalog"])
    baseline_path, baseline = dumps[0]
    resolver = resolver_records(baseline)
    ranges = {
        "chart_root_ids": (0x8008F470, 8 * 4),
        "portrait_animation_rows": (0x8008F4C4, 8 * 7 * 4),
        "portrait_resolver": (0x8008F628, (len(resolver) + 1) * 6),
        "chart_layouts": (0x8008F768, 8 * 0xC0),
        "item_rows": (0x80042BDC, item_count * 0x12),
    }
    for name, (address, size) in ranges.items():
        expected = read_at(baseline, address, size)
        for path, data in dumps[1:]:
            if read_at(data, address, size) != expected:
                raise ValueError(f"{name} differs between {baseline_path.name} and {path.name}")

    root_ids = list(struct.unpack("<8I", read_at(baseline, 0x8008F470, 32)))
    animation_words = struct.unpack("<56i", read_at(baseline, 0x8008F4C4, 224))
    animations = [list(animation_words[i : i + 7]) for i in range(0, 56, 7)]
    portraits = {row["id"]: row["portrait_clip"] for row in resolver}
    digimon_ids = {row["id"]: index + 1 for index, row in enumerate(resolver)}

    chart_layout = {}
    chart_addresses = [
        0x8008F768, 0x8008F828, 0x8008F8E8, 0x8008F9A8,
        0x8008FA68, 0x8008FB28, 0x8008FBE8, 0x8008FCA8,
    ]
    for starter_id, address in enumerate(chart_addresses, 1):
        pages = []
        for page_index in range(4):
            rows = []
            for row_index in range(4):
                record_address = address + (page_index * 4 + row_index) * 12
                count, *node_ids = struct.unpack(
                    "<6H", read_at(baseline, record_address, 12)
                )
                rows.append([
                    {
                        "node_id": node_id,
                        "digimon_id": digimon_ids.get(node_id),
                        "portrait_clip": portraits.get(node_id),
                    }
                    for node_id in node_ids[:count]
                ])
            pages.append(rows)
        chart_layout[str(starter_id)] = pages

    item_rows = []
    raw_rows = read_at(baseline, 0x80042BDC, item_count * 0x12)
    for index in range(item_count):
        raw = raw_rows[index * 0x12 : (index + 1) * 0x12]
        item_rows.append(
            {
                "item_id": index + 1,
                "icon_index": raw[4],
                "cmfont_clip": raw[4] + 0x37,
                "raw_hex": raw.hex(),
            }
        )

    output = {
        "_comment": (
            "Byte-exact stgdglab tables extracted from all six checked-in RAM dumps; "
            "see tools/extract_dri_tables.py for address and disassembly provenance."
        ),
        "chart_root_ids": root_ids,
        "chart_root_portrait_clips": [portraits[value] for value in root_ids],
        "portrait_animation_clips": animations,
        "portrait_resolver": resolver,
        # Resolver records are stored in DigimonId order (1..52). The first
        # eight entries resolve the eight chart roots at 0x8008F470.
        "portrait_clip_by_digimon_id": {
            str(index + 1): row["portrait_clip"] for index, row in enumerate(resolver)
        },
        "chart_layout_by_starter_id": chart_layout,
        "item_icon_rows": item_rows,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(output, indent=1) + "\n")
    print(
        f"wrote {args.out} ({len(resolver)} portrait records, "
        f"{len(item_rows)} item rows; verified across {len(dumps)} dumps)"
    )


if __name__ == "__main__":
    main()
