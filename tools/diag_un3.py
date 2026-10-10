#!/usr/bin/env python3
"""Inspect live Unknown4 Digimon structs from 2 MB PS1 RAM dumps.

DIGIMON_CUR_STATS @ 0x8004949c : [Unknown4; 8], 0x3dc bytes each.
Unknown4:
  un0[6] u32        @ 0x00
  exp u32           @ 0x18
  stats[19] u16     @ 0x1c
  un2 u16           @ 0x42
  un3[...]          @ 0x44..0x3bf
  items[6] u16      @ 0x3c0
  un5[8] u16        @ 0x3ce

Useful modes:
  - one dump: full per-slot decode
  - two or more dumps: compare core fields and changed un3 cells across dumps
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

BASE = 0x8004949C
RAMBASE = 0x80000000
SLOT = 0x3DC
DEFAULT_DUMP = "/home/dorij/vm-spike/dumps/fight_rena.bin"

STAT_NAMES = [
    "level",
    "tp",
    "cur_hp",
    "max_hp",
    "cur_mp",
    "max_mp",
    "str",
    "def",
    "spt",
    "wis",
    "spd",
    "chr",
    "fire",
    "water",
    "ice",
    "wind",
    "thunder",
    "machine",
    "dark",
]
ITEM_NAMES = ["head", "body", "right", "left", "acc0", "acc1"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dumps", nargs="*", default=[DEFAULT_DUMP], help="2 MB RAM dump(s)")
    parser.add_argument(
        "--slot",
        type=int,
        action="append",
        choices=range(8),
        help="only inspect the given slot(s); may be repeated",
    )
    parser.add_argument(
        "--brief",
        action="store_true",
        help="print a one-line summary per populated slot",
    )
    return parser.parse_args()


def parse_slot(data: bytes, slot_idx: int) -> dict:
    def off(addr: int) -> int:
        return addr - RAMBASE

    def u16(addr: int) -> int:
        return struct.unpack_from("<H", data, off(addr))[0]

    def u32(addr: int) -> int:
        return struct.unpack_from("<I", data, off(addr))[0]

    base = BASE + slot_idx * SLOT
    stats = [u16(base + 0x1C + 2 * j) for j in range(len(STAT_NAMES))]
    items = [u16(base + 0x3C0 + 2 * j) for j in range(len(ITEM_NAMES))]
    un0 = [u32(base + 4 * j) for j in range(6)]
    un5 = [u16(base + 0x3CE + 2 * j) for j in range(8)]
    un3_u16 = {o: u16(base + o) for o in range(0x44, 0x3C0, 2)}
    maxhp = stats[3]
    level = stats[0]
    return {
        "slot": slot_idx,
        "addr": base,
        "level": level,
        "maxhp": maxhp,
        "exp": u32(base + 0x18),
        "un0": un0,
        "un2": u16(base + 0x42),
        "stats": stats,
        "items": items,
        "un5": un5,
        "un3_u16": un3_u16,
        "populated": 0 < level < 200 and maxhp > 0,
    }


def format_changed_offsets(before: dict[int, int], after: dict[int, int]) -> list[str]:
    changed = []
    for off in sorted(before):
        if before[off] != after[off]:
            changed.append(f"+0x{off:03x}:{before[off]}->{after[off]}")
    return changed


def print_wrapped(prefix: str, values: list[str], per_line: int = 6) -> None:
    if not values:
        print(prefix + "(none)")
        return
    for start in range(0, len(values), per_line):
        chunk = values[start : start + per_line]
        print(prefix + "  ".join(chunk))


def print_slot_detail(slot: dict) -> None:
    tag = "  <-- POPULATED" if slot["populated"] else ""
    print(f"slot {slot['slot']} @0x{slot['addr']:x}  level={slot['level']} maxhp={slot['maxhp']}{tag}")
    if not slot["populated"]:
        return
    print(
        "  un0[6]:",
        " ".join(f"{x:08x}" for x in slot["un0"]),
        " exp=",
        slot["exp"],
        " un2=",
        slot["un2"],
    )
    print("  stats:", ", ".join(f"{n}={v}" for n, v in zip(STAT_NAMES, slot["stats"])))
    print("  items:", ", ".join(f"{n}={v}" for n, v in zip(ITEM_NAMES, slot["items"])))
    print("  un5[8]:", " ".join(str(x) for x in slot["un5"]))
    non_zero = [f"+0x{o:03x}={v}" for o, v in slot["un3_u16"].items() if v != 0]
    print("  un3 non-zero (u16, struct-relative offset):")
    print_wrapped("    ", non_zero)
    print()


def print_slot_brief(slot: dict) -> None:
    if not slot["populated"]:
        return
    stats = slot["stats"]
    print(
        f"slot {slot['slot']} lvl={stats[0]} exp={slot['exp']} tp={stats[1]} "
        f"hp={stats[2]}/{stats[3]} mp={stats[4]}/{stats[5]} items={slot['items']}"
    )


def print_dump(path: Path, slots: list[int], brief: bool) -> list[dict]:
    data = path.read_bytes()
    parsed = [parse_slot(data, slot_idx) for slot_idx in slots]
    print(f"dump={path}  size=0x{len(data):x}  DIGIMON_CUR_STATS@0x{BASE:x}\n")
    for slot in parsed:
        if brief:
            print_slot_brief(slot)
        else:
            print_slot_detail(slot)
    if brief:
        print()
    return parsed


def print_comparison(paths: list[Path], parsed_dumps: list[list[dict]]) -> None:
    print("comparisons:\n")
    for slot_idx in range(len(parsed_dumps[0])):
        dump_slots = [dump[slot_idx] for dump in parsed_dumps]
        real_slot = dump_slots[0]["slot"]
        populated = any(slot["populated"] for slot in dump_slots)
        if not populated:
            continue
        print(f"slot {real_slot}")
        for path, slot in zip(paths, dump_slots):
            if not slot["populated"]:
                print(f"  {path.name}: <empty>")
                continue
            stats = slot["stats"]
            print(
                f"  {path.name}: lvl={stats[0]} exp={slot['exp']} tp={stats[1]} "
                f"hp={stats[2]}/{stats[3]} mp={stats[4]}/{stats[5]}"
            )
        for idx in range(len(paths) - 1):
            before = dump_slots[idx]
            after = dump_slots[idx + 1]
            label = f"  {paths[idx].name} -> {paths[idx + 1].name}:"
            scalar_changes = []
            if before["exp"] != after["exp"]:
                scalar_changes.append(f"exp {before['exp']}->{after['exp']}")
            for name, bval, aval in zip(STAT_NAMES, before["stats"], after["stats"]):
                if bval != aval:
                    scalar_changes.append(f"{name} {bval}->{aval}")
            if before["items"] != after["items"]:
                scalar_changes.append(f"items {before['items']}->{after['items']}")
            if before["un5"] != after["un5"]:
                scalar_changes.append(f"un5 {before['un5']}->{after['un5']}")
            print(label, ", ".join(scalar_changes) if scalar_changes else "no core-field changes")
            changed_un3 = format_changed_offsets(before["un3_u16"], after["un3_u16"])
            print_wrapped("    un3: ", changed_un3)
        print()


def main() -> None:
    args = parse_args()
    paths = [Path(p) for p in args.dumps]
    slots = args.slot if args.slot else list(range(8))
    parsed_dumps = [print_dump(path, slots, args.brief) for path in paths]
    if len(parsed_dumps) > 1:
        print_comparison(paths, parsed_dumps)


if __name__ == "__main__":
    main()
