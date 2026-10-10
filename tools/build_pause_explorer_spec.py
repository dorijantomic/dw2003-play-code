#!/usr/bin/env python3
"""Emit the pause-menu explorer's screen key as a Lua table.

`tools/windows-rig/pause-explorer.lua` names a screen by which pause objects are
alive and a few words of each: the step number and the cursors. It finds them
with no code hooks (on this core every exec hook slows the whole emulator; 116
hooks gave 2.4 fps). Instead it walks the object tree every frame:

  * the resident task table: 100 object pointers at 0x8004B610, filled by
    F0x80017FDC and cleared by F0x80018014 (exe-decomp/c/);
  * every object from the resident factory F0x800143DC keeps its main routine
    at +0x48, its child count at +0x20 and its child array at +0x24 (the
    destroy method F0x80014308 frees exactly those children);
  * the pause host keeps its page in that child array (pause-host.ts,
    `arg1 + 0x4`), and each page root passes its own object to its tick.

So a page is present when an object in the tree has the page ROOT at +0x48, and
its tick's fields are read from that object. Every row below cites its source.

Identity: the overlay loads at a base other overlays share, so a routine
address alone could belong to another overlay's object. Each overlay row
carries the first instruction words of its root from its own lift
(`exe-decomp/ststatus_c/_asm/`), and the explorer counts a page only while
those words are in RAM.

State coverage: for each page the tick's `case` labels are read from its
translation, so the report can list the steps a run never reached. This list
is a lead taken from the translation, not from the assembly.

Usage:
    python3 tools/build_pause_explorer_spec.py --out <path>/pause-explorer-spec.lua
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from build_stage_entry_list import EXTENTS, entry_words  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[1]

OVERLAY = "ststatus"

# name, root (the routine at +0x48), tick (for the step list), overlay (None =
# resident), key fields (u32 offsets on the same object), source.
# Only step numbers, cursors, choices and counts are keyed. Timers, fold scales,
# blink frames and map pan are left out: they change while the screen is idle,
# and a key that changes while idle never settles.
PAGES = [
    ("top", 0x8001270C, 0x8001270C, None, [0x0C, 0x10, 0x58, 0x5C, 0x60, 0x64],
     "exe-decomp/c/F0x8001270c.c: unkC state, unk10 sub-step, unk58 row, unk5C rows, unk60 variant, unk64 map allowed"),
    ("host", 0x80099894, 0x80099894, OVERLAY, [0x0C, 0x10],
     "exe-decomp/ststatus_c/F0x80099a80.c F0x80014504(0x80099894, 0x78, 8); pause-host.ts +0x0C state, +0x10 sub"),
    ("items", 0x80091D18, 0x80090264, OVERLAY, [0x0C, 0x10, 0x14, 0x5C, 0x70, 0x3AC, 0x3B0, 0x3B4],
     "engine/dw3/ui/native/pause-items.ts root; pause-items-tick.ts +0x10 state, +0x70 category, +0x3B0 member"),
    ("bag", 0x800934E0, 0x80092BC8, OVERLAY, [0x0C, 0x10, 0x5C, 0x68, 0x6BC, 0x6C8],
     "engine/dw3/ui/native/pause-bag.ts: +0x10 state, +0x5C tab, +0x68 count, +0x6BC cell, +0x6C8 page"),
    ("sort", 0x800980B0, 0x8009744C, OVERLAY, [0x0C, 0x10, 0x5C, 0x70, 0x7C, 0x80, 0x84, 0x88],
     "exe-decomp/ststatus_c/F0x8009824c.c F0x80014504(0x800980B0, 0xF4, 0x8C); pause-sort.ts fields"),
    ("map", 0x8009913C, 0x800986C0, OVERLAY, [0x0C, 0x10, 0x16C, 0x180, 0x184],
     "engine/dw3/ui/native/pause-map.ts: +0x16C cursor showing, +0x180 over a zone, +0x184 zone"),
    ("techniques", 0x80096380, 0x80094FBC, OVERLAY, [0x0C, 0x10, 0x14, 0x5C, 0x78, 0x7C, 0x80, 0x84, 0x88],
     "engine/dw3/ui/native/pause-techniques.ts Object fields header"),
    ("status", 0x8008E744, 0x8008DDB0, OVERLAY, [0x0C, 0x10, 0x14, 0x18, 0x5C, 0x74, 0x78, 0x7C],
     "engine/dw3/ui/native/pause-status.ts Object fields header"),
    ("card_folders", 0x80084A98, 0x80084238, OVERLAY, [0x0C, 0x10, 0x14, 0x5C, 0x70],
     "engine/dw3/ui/native/pause-card-folders.ts Object fields header"),
    ("demo_setup", 0x800862A0, 0x80085B6C, OVERLAY, [0x0C, 0x10],
     "docs/research/ui/pause-menu-screen-tree-2026-08-14.md §1 state machine table"),
    ("digivolve", 0x8008B3C8, 0x80089BF0, OVERLAY, [0x0C, 0x10, 0x5C, 0x60, 0x64, 0x68, 0x6C, 0x70, 0x80],
     "engine/dw3/ui/native/pause-digivolve.ts Object fields header"),
    ("equipment", 0x80088214, 0x8008744C, OVERLAY, [0x0C, 0x10, 0x5C, 0x60, 0x64, 0x68, 0x6C, 0x6C8],
     "engine/dw3/ui/native/pause-equipment.ts Object fields header"),
]

# The translation that holds each page's tick, for the step list.
TICK_SOURCES = {
    "top": None,
    "host": ("engine/dw3/ui/native/pause-host.ts", "pauseHostTick"),
    "items": ("engine/dw3/ui/native/pause-items-tick.ts", None),
    "bag": ("engine/dw3/ui/native/pause-bag.ts", "pauseBagTick"),
    "sort": ("engine/dw3/ui/native/pause-sort.ts", "sortTick"),
    "map": None,
    "techniques": ("engine/dw3/ui/native/pause-techniques.ts", "techniquesTick"),
    "status": ("engine/dw3/ui/native/pause-status.ts", "statusTick"),
    "card_folders": ("engine/dw3/ui/native/pause-card-folders.ts", "cardFoldersTick"),
    "demo_setup": None,
    "digivolve": ("engine/dw3/ui/native/pause-digivolve.ts", "digivolveTick"),
    "equipment": ("engine/dw3/ui/native/pause-equipment.ts", "equipTick"),
}

# Derived key parts: a word of a page object used as an item id, keyed by the item's
# KIND (descriptor bytes 0 and 1: flags and effect type) rather than its number.
# The picked item (+0x78 on the ITEMS object, pause-bag.ts itemsApplyEffect) decides
# where Triangle returns and what Cross does, but keying the id made one screen per
# item (2026-09-30: 106 copies of the category picker in one run). Items of one kind
# behave alike; the coarse check reports it if they do not. Keyed only on the
# partner picker (step 0x19), where Cross applies the item's effect: elsewhere the
# field lingers from the last pick and multiplied every bag cell by it (2026-09-30:
# 299 bag screens for 112 distinct cells). pause-items-tick.ts reads +0x78 only in
# step 0x1E (reopen the bag on that item).
DERIVED = [
    dict(page="items", offset=0x78, table=0x80041838, stride=12, bytes=(0, 1), when_offset=0x10, when_value=0x19,
         source="engine/dw3/item-record.ts itemRecord (0x80041838 + id*12); pause-bag.ts descriptor(); "
                "itemsApplyEffect reads descriptor +1 as the effect type"),
]

# Narrowed steps: while a page waits in one step, key only its first `keep` fields.
# EQUIPMENT step 3 (the slot picker) reads only the member and the slot
# (pause-equipment.ts case 3: +0x60 and, on Cross, +0x5C); the item list's cursor,
# length and scroll top (+0x64/+0x68/+0x6C) linger from the last list until step
# 0xA resets them, and the header flag +0x6C8 stays clear. Keying them made one
# slot-picker screen per last-visited list position (2026-09-30: 155 step-3
# screens for 17 member/slot pairs).
NARROW = [
    dict(page="equipment", when_offset=0x10, when_value=3, keep=4,
         source="engine/dw3/ui/native/pause-equipment.ts equipTick case 3 and case 0xa"),
]

# The resident object tree (see the module docstring).
TASK_TABLE = (0x8004B610, 100, "exe-decomp/c/F0x80017fdc.c: 0x64 slots from D0x8004b610")
OBJECT_LAYOUT = dict(handler=0x48, child_count=0x20, child_array=0x24,
                     source="exe-decomp/c/F0x800143dc.c and F0x80014308.c")

# Resident globals keyed as they are: the chosen row and variant, and the scene.
GLOBALS = [
    ("row", 0x8005CCF0, "engine/dw3/ui/pause-root-session.ts PAUSE_ROW_CELL"),
    ("variant", 0x8005CCF4, "engine/dw3/ui/pause-root-session.ts PAUSE_VARIANT_CELL"),
    ("scene", 0x80055D2C, "C:/bizhawk-rig/bizhawk-agent-interface.lua getSceneID"),
    ("scene_id", 0x8004B3F8,
     "exe-decomp/c/F0x80016b28.c: ctx+0x26C4 current scene (0x20D in this field, 0x1000 in the pause scene, live 2026-09-29)"),
    ("scene_request", 0x8004B3FC,
     "exe-decomp/c/F0x80016b88.c writes ctx+0x26C8 (ctx 0x80048D34); the list calls it with 0x1000 in state 2 sub 6"),
]

# (page, step field, step value): a moment the explorer must never call settled,
# because the game is waiting on something the key cannot see. The list's state
# 2 folds the list shut and, on a confirm, asks for the pause scene; the disc
# load that follows changes no keyed word for longer than SETTLE frames.
# A None page means a resident word at that address.
TRANSITIONAL = [
    ("top", 0x0C, 2, "exe-decomp/c/F0x8001270c.c: switch 3 case 2 (fold shut, then sub 6 requests scene 0x1000)"),
    # In the pause scene, until the host has left its loading step 0 (text banks
    # and packs, pause-host.ts pauseHostTick) or while it is not built yet.
    (None, 0x8004B3F8, 0x1000, ("host", 0x0C, 1),
     "pause-host.ts: state 0 requests and waits for the banks; live 2026-09-29 diag: the scene id is 0x1000 before the host exists"),
    # Outside the pause scene, the field's stage word reads -1 until a stage is
    # built again (live 2026-09-29 probe 3, the frames after a scene switch).
    (None, 0x80055D2C, 0xFFFFFFFF, ("@scene_id", 0x8004B3F8, 0x1000),
     "live 2026-09-29: -1 from the scene switch until the next stage exists; it stays -1 inside the pause scene"),
]

# Scene roots no global points to: the scene's first object is the first heap
# allocation after the switch (live 2026-09-29 diag: pause root at 0x800AB878,
# heap start word 0x8004B5E0 = 0x800AB800). The explorer scans HEAP_WINDOW bytes
# from the heap start for an object with this routine at +0x48, once per scene.
SCENE_ROOTS = [
    ("pause_scene", 0x80083558, OVERLAY,
     "exe-decomp/ststatus_c/F0x80083558.c: state 0 builds the host into *arg1 (its child 0)"),
]
HEAP_START_WORD = (0x8004B5E0, "live 2026-09-29: 0x800AB800 in both the field and the pause scene")
HEAP_WINDOW = 0x4000

# Save data hashed into the key, so "after a swap" differs from "before".
# money + party order + held and worn counts, then the three roster records.
WORLD = [
    ("money_party_bag", 0x80048DA0, 0x800490D6 - 0x80048DA0,
     "engine/dw3/ui/pause-root-session.ts PAUSE_MONEY (ctx+0x6C) through PAUSE_WORN_COUNTS + PAUSE_ITEM_MAX_ID"),
    ("roster", 0x80049494, 3 * 0x3DC,
     "engine/dw3/party-context.ts ROSTER_RECORDS, ROSTER_STRIDE (first three records)"),
]

# The packed-sound entry; its a0 is the sound id (capture-shop-sfx.lua). The
# explorer's only hook: one hook costs about 1% (50.0 -> 49.4 fps measured).
SOUND_ENTRY = 0x8002006C


CASE = re.compile(r"\bcase\s+(0x[0-9a-fA-F]+|\d+)\s*:")


def tick_steps(name: str) -> list[int]:
    """The case labels of a page tick's translation (a lead, not assembly)."""
    src = TICK_SOURCES.get(name)
    if not src:
        return []
    path, fn = src
    text = (ROOT / path).read_text()
    if fn:
        at = re.search(r"export function " + fn + r"\b", text)
        if not at:
            raise SystemExit(f"{path}: no function {fn}")
        text = text[at.start():]
        nxt = re.search(r"\nexport function ", text[1:])
        text = text[: nxt.start() + 1] if nxt else text
    return sorted({int(m.group(1), 0) for m in CASE.finditer(text)})


def build(extents: dict) -> tuple[str, dict]:
    lines = ["-- Generated by tools/build_pause_explorer_spec.py. Do not edit.",
             "PAUSE_SPEC = {}",
             "PAUSE_SPEC.tasks = {addr=0x%08x, slots=%d}  -- %s" % TASK_TABLE,
             "PAUSE_SPEC.object = {handler=0x%x, child_count=0x%x, child_array=0x%x}  -- %s" % (
                 OBJECT_LAYOUT["handler"], OBJECT_LAYOUT["child_count"], OBJECT_LAYOUT["child_array"],
                 OBJECT_LAYOUT["source"]),
             "PAUSE_SPEC.pages = {"]
    missing = []
    steps = {}
    for name, root, tick, overlay, fields, source in PAGES:
        words = entry_words(overlay, root) if overlay else []
        if overlay and not words:
            missing.append(f"{name} 0x{root:08x}")
        steps[name] = tick_steps(name)
        lines.append("  {name=%r, handler=0x%08x, tick=0x%08x, words={%s}, fields={%s}, steps={%s}},  -- %s" % (
            name, root, tick, ",".join(f"0x{w:08x}" for w in words),
            ",".join(f"0x{f:x}" for f in fields), ",".join(str(v) for v in steps[name]), source))
    lines.append("}")
    lines.append("PAUSE_SPEC.derived = {")
    for d in DERIVED:
        lines.append("  {page=%r, offset=0x%x, table=0x%08x, stride=%d, bytes={%s}, when_offset=0x%x, when_value=0x%x},  -- %s" % (
            d["page"], d["offset"], d["table"], d["stride"], ",".join(str(b) for b in d["bytes"]),
            d["when_offset"], d["when_value"], d["source"]))
    lines.append("}")
    lines.append("PAUSE_SPEC.narrow = {")
    for d in NARROW:
        lines.append("  {page=%r, when_offset=0x%x, when_value=0x%x, keep=%d},  -- %s" % (
            d["page"], d["when_offset"], d["when_value"], d["keep"], d["source"]))
    lines.append("}")
    lines.append("PAUSE_SPEC.globals = {")
    for name, addr, source in GLOBALS:
        lines.append("  {name=%r, addr=0x%08x},  -- %s" % (name, addr, source))
    lines.append("}")
    lines.append("PAUSE_SPEC.world = {")
    for name, addr, size, source in WORLD:
        lines.append("  {name=%r, addr=0x%08x, size=0x%x},  -- %s" % (name, addr, size, source))
    lines.append("}")
    lines.append("PAUSE_SPEC.transitional = {")
    for rule in TRANSITIONAL:
        if rule[0] is None:
            _, addr, value, until, source = rule
            if until[0].startswith("@"):
                lines.append("  {addr=0x%08x, value=0x%x, unless_addr=0x%08x, unless_value=0x%x},  -- %s" % (
                    addr, value, until[1], until[2], source))
            else:
                lines.append("  {addr=0x%08x, value=0x%x, until_page=%r, until_offset=0x%x, until_min=%d},  -- %s" % (
                    addr, value, until[0], until[1], until[2], source))
        else:
            page, off, value, source = rule
            lines.append("  {page=%r, offset=0x%x, value=%d},  -- %s" % (page, off, value, source))
    lines.append("}")
    lines.append("PAUSE_SPEC.scene_roots = {")
    for name, handler, overlay, source in SCENE_ROOTS:
        words = entry_words(overlay, handler)
        if not words:
            missing.append(f"{name} 0x{handler:08x}")
        lines.append("  {name=%r, handler=0x%08x, words={%s}},  -- %s" % (
            name, handler, ",".join(f"0x{w:08x}" for w in words), source))
    lines.append("}")
    lines.append("PAUSE_SPEC.heap = {start_word=0x%08x, window=0x%x}  -- %s" % (
        HEAP_START_WORD[0], HEAP_WINDOW, HEAP_START_WORD[1]))
    lines.append("PAUSE_SPEC.sound_entry = 0x%08x" % SOUND_ENTRY)
    if missing:
        raise SystemExit("no lift words for: " + ", ".join(missing))
    summary = {"pages": len(PAGES), "steps": {k: len(v) for k, v in steps.items()},
               "world_bytes": sum(w[2] for w in WORLD)}
    return "\n".join(lines) + "\n", summary


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=pathlib.Path, required=True)
    ap.add_argument("--json", type=pathlib.Path,
                    help="also write the pages, fields and wait rules as JSON (tools/compare_pause_map.mjs)")
    args = ap.parse_args()
    if not EXTENTS.exists():
        sys.exit(f"missing {EXTENTS}; rebuild it first")
    text, summary = build(json.loads(EXTENTS.read_text()))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(json.dumps(dict(
            pages=[dict(name=n, handler=h, tick=t, fields=f) for n, h, t, _o, f, _s in PAGES],
            world=[dict(name=n, addr=a, size=z) for n, a, z, _s in WORLD],
            derived=[{k: (list(v) if isinstance(v, tuple) else v) for k, v in d.items() if k != "source"} for d in DERIVED],
            narrow=[{k: v for k, v in d.items() if k != "source"} for d in NARROW]),
            indent=1) + "\n")
    print(json.dumps(dict(summary, out=str(args.out))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
