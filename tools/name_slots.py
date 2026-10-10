#!/usr/bin/env python3
"""Give each typed call a NAME, by joining the receiver typing to prior work.

`docs/research/ui/symbols/*.json` already names 991 UI functions and harvests
every `obj->unkNN(...)` call site. But it keys a slot by the OFFSET NUMBER and
by whatever text stood in front of the arrow, so one number collects the names
of several unrelated objects. `shared-objects.md` says so in its own words:

    Harvest is by offset number, not by receiver. The same `unk114` on a text
    element, a GPU block, and a screen actor are three methods.

and it records the cost -- 40 offsets split across two or more receivers, 140
slot records left `disputed`, and the twelve slots of the draw context left
unnamed outright, because "cursor and DRI occupied the same numbers".

tools/type_receivers.py now says WHICH class each call is made on. So the
harvest can be re-keyed by (class, slot) instead of by offset, which is the
missing half of the join. This file does that and nothing else:

  * it INVENTS no name. A name is written only where the harvest, once split
    by class, leaves exactly one non-placeholder name for that (class, slot).
  * where the harvest leaves two names for one (class, slot) it writes none and
    reports the disagreement. Picking a winner would be inventing one.
  * a handful of names are seeded from `shared-objects.md`'s own established
    table, each carrying the document line that established it.

Only calls whose typing is `exact` or `checked` are joined. The `weak` source
cannot check itself, so it may not put a name on anything.

The report's tail is the work queue: every (class, slot) that carries calls and
still has no name, largest first. That is the list to read by hand, and the
draw context sits at the top of it exactly as `shared-objects.md` predicted.

Usage:
  tools/name_slots.py            # write `name` into the typed rows
  tools/name_slots.py --report   # measure, write nothing
  tools/name_slots.py --queue    # the unnamed (class, slot) pairs, largest first
"""
from __future__ import annotations

import argparse
import collections
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SYMBOLS = ROOT / "docs/research/ui/symbols"
STATE = ROOT / ".dw3-research/decode-static"

PLACEHOLDER = re.compile(r"^unk[_0-9a-fx]*$", re.IGNORECASE)
TRUSTED = ("exact", "checked")

# From docs/research/ui/symbols/shared-objects.md, section "Names now applied
# everywhere" and the established pairs it quotes. Each carries the line that
# established it, so nothing here is this file's own opinion.
SEED = {
    ("fns 0x8001AE38", "+0x114"): ("set_text", "shared-objects.md:398"),
    ("fns 0x8001AE38", "+0x118"): ("set_number", "shared-objects.md:399"),
    ("fns 0x8001AE38", "+0x144"): ("close", "shared-objects.md:400"),
    ("fns 0x8001B364", "+0x80"): ("cursor_show", "shared-objects.md:78"),
    ("fns 0x8001B364", "+0x84"): ("cursor_move", "shared-objects.md:79"),
    # The draw context, keyed by the CLASS's own slot. `shared-objects.md`
    # section 14 could not name any of these, because the offset-only harvest
    # could not tell a draw context from a cursor or a DRI capsule. The
    # receiver typing separates them; UI-DRAWCTX-SLOTS-002 reads them.
    ("fns 0x8001F648", "+0x74"): ("set_texture_page", "EV-drawctx-settexpage-slot74-2026-08-04"),
    ("fns 0x8001F648", "+0x7C"): ("set_layer", "resident-core-services-2026-08-04.md:143"),
    ("fns 0x8001F648", "+0x80"): ("bind_source", "UI-DRAWCTX-SLOTS-002"),
    ("fns 0x8001F648", "+0x84"): ("draw_by_id", "EV-fish-fieldcom-art-2026-07-29"),
    ("fns 0x8001F648", "+0x88"): ("set_frame", "EV-BATTLE-Q001-ecec-unk20-2026-08-20"),
    ("fns 0x8001F648", "+0x8C"): ("set_scale", "UI-DRAWCTX-SLOTS-002"),
    ("fns 0x8001F648", "+0x90"): ("set_rotation", "UI-DRAWCTX-SLOTS-002"),
    ("fns 0x8001F648", "+0x94"): ("set_pivot", "UI-DRAWCTX-SLOTS-002"),
    ("fns 0x8001F648", "+0x98"): ("set_enabled", "UI-DRAWCTX-SLOTS-002"),
    # The base task object. Every screen actor is built on it. Four nested
    # levels, each with a set and an advance, and each clears every level
    # below it. Already fully decoded; the symbol map simply never applied
    # the answer, which is why four readers proposed four names.
    ("fns 0x800143DC", "+0x28"): ("set_state0", "UI-TASKOBJ-STATEMACHINE-001"),
    ("fns 0x800143DC", "+0x2C"): ("set_state1", "UI-TASKOBJ-STATEMACHINE-001"),
    ("fns 0x800143DC", "+0x30"): ("set_state2", "UI-TASKOBJ-STATEMACHINE-001"),
    ("fns 0x800143DC", "+0x34"): ("set_state3", "UI-TASKOBJ-STATEMACHINE-001"),
    ("fns 0x800143DC", "+0x38"): ("advance_state0", "UI-TASKOBJ-STATEMACHINE-001"),
    ("fns 0x800143DC", "+0x3C"): ("advance_state1", "UI-TASKOBJ-STATEMACHINE-001"),
    ("fns 0x800143DC", "+0x40"): ("advance_state2", "UI-TASKOBJ-STATEMACHINE-001"),
    ("fns 0x800143DC", "+0x44"): ("advance_state3", "UI-TASKOBJ-STATEMACHINE-001"),
    # The text element -- every dialogue line, menu label, item name and
    # number the player reads. Names come from the READER of each field.
    ("fns 0x8001AE38", "+0x110"): ("set_line0_from_string", "UI-WIDGETCLASS-AE38-SETLINE-001"),
    ("fns 0x8001AE38", "+0x120"): ("set_line_from_resource", "UI-WIDGETCLASS-AE38-SETLINE-001"),
    ("fns 0x8001AE38", "+0x128"): ("skip_typewriter", "UI-WIDGETCLASS-AE38-READERS-001"),
    ("fns 0x8001AE38", "+0x130"): ("start_typewriter", "UI-WIDGETCLASS-AE38-READERS-001"),
    ("fns 0x8001AE38", "+0x134"): ("set_position", "UI-WIDGETCLASS-AE38-CONSUMER-001"),
    ("fns 0x8001AE38", "+0x138"): ("set_text_colour", "UI-WIDGETCLASS-AE38-READERS-001"),
    ("fns 0x8001AE38", "+0x140"): ("set_glyph_cell", "UI-WIDGETCLASS-AE38-READERS-001"),
    ("fns 0x8001AE38", "+0x148"): ("set_right_align", "UI-WIDGETCLASS-AE38-READERS-001"),
    ("fns 0x8001AE38", "+0x15C"): ("set_ot_row", "UI-WIDGETCLASS-AE38-READERS-001"),
    ("fns 0x8001AE38", "+0x160"): ("set_page_line_count", "UI-WIDGETCLASS-AE38-READERS-001"),
    ("fns 0x8001AE38", "+0x168"): ("is_paused", "UI-WIDGETCLASS-AE38-READERS-001"),
    # The cursor.
    ("fns 0x8001B364", "+0x88"): ("set_cursor_colour", "UI-WIDGETCLASS-AE38-READERS-001"),
    ("fns 0x8001B364", "+0x94"): ("set_cursor_frozen", "UI-WIDGETCLASS-AE38-READERS-001"),
    # +0x170 stays UNNAMED on purpose. UI-WIDGETCLASS-AE38-TAIL-001 shows only
    # that it returns true when the inherited state1 equals 1. Reading that as
    # "waiting for the confirm button" is a reading of ONE consumer arm, not of
    # the slot, so a name here would be invented rather than established.
    # ------------------------------------------------------------------
    # The card duel board object. Its builder writes 43 routine pointers
    # into the object; 39 of them had never been lifted to C, because the
    # disassembler's entry list missed them, so no earlier pass could read
    # one. The lift was verified first against the three that DID have C:
    # all three came back character-for-character identical.
    #
    # Ten of these were already named in the ledger or in
    # CARD-DUEL-VERIFIED.md and are carried over verbatim, not re-invented.
    # Fifteen were read for the first time; each was named by the routine
    # that READS the field it writes, never by one caller's situation.
    # CARD-DUEL-VERIFIED.md's own animation-state table (line 486-493)
    # independently confirms every mode number used below.
    ("cardgame 0x8009D310", "+0xEA0"): ("set_hud_counter", "CARD-DUEL-VERIFIED.md:441"),
    ("cardgame 0x8009D310", "+0xEAC"): ("open_info_banner", "cardduel-phase-banners-are-one-routine-and-wait-for-a-button-2026-08-27"),
    ("cardgame 0x8009D310", "+0xEB0"): ("write_banner_record", "cardduel-view-slot-eb0-writes-banner-record-2026-08-28"),
    ("cardgame 0x8009D310", "+0xEB4"): ("clear_hud_highlights", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xEB8"): ("set_hud_highlights", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xED8"): ("cardFanOut", "CARD-DUEL-VERIFIED.md:2359"),
    ("cardgame 0x8009D310", "+0xEE4"): ("openPrompt", "cardduel-phase-banners-are-one-routine-and-wait-for-a-button-2026-08-27"),
    ("cardgame 0x8009D310", "+0xEE8"): ("close_prompt", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xEEC"): ("confirm_prompt", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xEF8"): ("close_prompt_b", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xEFC"): ("confirm_prompt_b", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xF00"): ("set_prompt_cursor_b", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xF08"): ("cardStartMoveWithSfx", "CARD-DUEL-VERIFIED.md:2390"),
    ("cardgame 0x8009D310", "+0xF0C"): ("card_start_move_silent", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xF10"): ("card_start_summon", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xF14"): ("placeCardResetVisual", "CARD-DUEL-VERIFIED.md:2387"),
    ("cardgame 0x8009D310", "+0xF18"): ("hide_card_sprite", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xF1C"): ("card_start_settle", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xF20"): ("set_card_scale_endpoints", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xF24"): ("scaleSlot", "EV-CARD-OP13-SCALE"),
    ("cardgame 0x8009D310", "+0xF28"): ("card_start_flip", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xF2C"): ("card_start_shake_xy", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xF30"): ("card_start_shake_x", "CARD-VIEW-SLOTS-001"),
    ("cardgame 0x8009D310", "+0xF3C"): ("bind_slot_to_card", "EV-CARD-OP13-BIND-CARD"),
    ("cardgame 0x8009D310", "+0xF40"): ("field_slot_colour", "cardgame-f8009cf60-is-the-field-slot-cardpak-colour-lookup"),
    # +0xEA4 and +0xEA8 stay UNNAMED on purpose. Both write a mode byte on
    # the centre-plate record, 1 and 3. Nothing in the recovered C reads
    # that byte, so neither has a reader, and a name would be a guess at
    # what a mode number means. What settles them: the tick that reads the
    # plate record's mode byte and draws from it.
    # The screen objects, read for the first time after the entry-list
    # defect was fixed. Ledger SCREEN-OBJECT-METHODS-001. Each name is
    # the routine that READS the field the slot writes, not the caller.
    ("stitshop 0x800889A8", "+0x6F0"): ("shop_list_get_selected_item", "SCREEN-OBJECT-METHODS-001"),
    ("stitshop 0x800889A8", "+0x6EC"): ("shop_list_stop_browsing", "SCREEN-OBJECT-METHODS-001"),
    ("stitshop 0x800889A8", "+0x6E8"): ("shop_list_set_running", "SCREEN-OBJECT-METHODS-001"),
    ("stitshop 0x8008B484", "+0x234"): ("item_panel_bind_item", "SCREEN-OBJECT-METHODS-001"),
    ("stitshop 0x800889A8", "+0x6F4"): ("shop_list_place_cursor", "SCREEN-OBJECT-METHODS-001"),
    ("stitshop 0x800889A8", "+0x6F8"): ("shop_list_set_cursor_live", "SCREEN-OBJECT-METHODS-001"),
    ("stitshop 0x8008B484", "+0x238"): ("item_panel_leave_ready", "SCREEN-OBJECT-METHODS-001"),
    ("fieldstg 0x800873D8", "+0x238"): ("getMapChunkLoadFlag", "SCREEN-OBJECT-METHODS-001"),
    ("fieldstg 0x800873D8", "+0x234"): ("setMapChunkCellId", "SCREEN-OBJECT-METHODS-001"),
    ("fieldstg 0x800873D8", "+0x248"): ("getMapChunkBoundSlot", "SCREEN-OBJECT-METHODS-001"),
    ("fieldstg 0x800873D8", "+0x24C"): ("clearMapChunkBoundSlot", "SCREEN-OBJECT-METHODS-001"),
    ("stitshop 0x800889A8", "+0x700"): ("shop_list_collect_sellable", "SCREEN-OBJECT-METHODS-001"),
}


def load_records() -> dict:
    out = {}
    for path in sorted(STATE.glob("*.json")):
        record = json.loads(path.read_text())
        out[(record["overlay"], record["address"])] = (path, record)
    return out


def harvest() -> dict:
    """(overlay, containing function, slot offset) -> the names proposed there.

    Keyed by the CALL SITE, never by the offset alone, so the join below can
    re-key it by the class the typing establishes.
    """
    out: dict[tuple, set[str]] = collections.defaultdict(set)
    for path in sorted(SYMBOLS.glob("*.json")):
        data = json.loads(path.read_text())
        overlay = data.get("overlay") or path.stem
        for slot in data.get("method_slots") or []:
            name = str(slot.get("proposed_name") or "")
            if not name or PLACEHOLDER.match(name):
                continue
            for site in slot.get("call_sites") or []:
                fn = str(site.get("fn") or "")
                off = str(site.get("off") or slot.get("off") or "")
                if not fn.startswith("0x") or not off:
                    continue
                key = (overlay, int(fn, 16), f"+0x{int(off, 16):X}")
                out[key].add(name)
    return dict(out)


def own_slot(row: dict) -> str:
    """The slot number the CLASS carries, not the one the caller writes.

    A class is often embedded a fixed distance inside a bigger thing the caller
    owns, so the same job appears as two different numbers depending on which
    source typed the call. Keying a name by the caller's number merges two
    different jobs of one class, which is the very confusion this file exists
    to undo. The check that this is right: the draw context's busiest job comes
    out at +0x84, and the ledger already records F0x8001ed6c installed at
    draw-context +0x84 by F0x8001f648 (EV-fish-fieldcom-art-2026-07-29).
    """
    shift = int(row.get("embedded_at", "+0x0").lstrip("+"), 16)
    return f"+0x{int(row['slot'].lstrip('+'), 16) - shift:X}"


def joined(records: dict, names: dict) -> tuple[dict, dict]:
    """Re-key the harvest by (class, slot), and count the calls each carries.

    The join runs on the CALLER's offset, because that is what the decompiled
    quote the harvest read shows. The result is grouped by the CLASS's offset,
    because that is the job's identity.
    """
    proposed: dict[tuple, set[str]] = collections.defaultdict(set)
    calls: collections.Counter = collections.Counter()
    for (overlay, address), (_, record) in records.items():
        for row in record.get("receiver") or []:
            if row["contradicted"] or row["confidence"] not in TRUSTED:
                continue
            pair = (row["object"], own_slot(row))
            calls[pair] += 1
            proposed[pair] |= names.get((overlay, address, row["slot"]), set())
    return dict(proposed), calls


def settle(proposed: dict) -> tuple[dict, dict]:
    """One name per (class, slot), or a recorded disagreement.

    A disagreement is NOT resolved by counting. Two names for one class and one
    slot mean two people read it differently, and the harvest carries no
    evidence that decides between them.
    """
    settled = dict(SEED)
    disputed = {}
    for pair, found in proposed.items():
        if pair in settled or not found:
            continue
        if len(found) == 1:
            settled[pair] = (sorted(found)[0], "ui symbol map, one name")
        else:
            disputed[pair] = sorted(found)
    return settled, disputed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", action="store_true")
    parser.add_argument("--queue", action="store_true")
    args = parser.parse_args()

    records = load_records()
    proposed, calls = joined(records, harvest())
    settled, disputed = settle(proposed)

    total = sum(calls.values())
    named = sum(n for pair, n in calls.items() if pair in settled)
    print(f"trusted calls: {total} over {len(calls)} (thing, job) pairs")
    print(f"  a name the prior work agrees on: {len(settled & calls.keys())} "
          f"pairs, {named} calls ({named / max(total, 1):.0%})")
    print(f"  prior work disagrees:            {len(disputed)} pairs, "
          f"{sum(calls[p] for p in disputed)} calls")
    unnamed = {p: n for p, n in calls.items()
               if p not in settled and p not in disputed}
    print(f"  no name at all:                  {len(unnamed)} pairs, "
          f"{sum(unnamed.values())} calls")

    if args.queue:
        print("\nunnamed, largest first -- this is the reading queue")
        for pair, n in sorted(unnamed.items(), key=lambda kv: -kv[1]):
            print(f"  {pair[0]:22s} {pair[1]:8s} {n:5d} calls")
        print("\nprior work disagrees, largest first")
        for pair in sorted(disputed, key=lambda p: -calls[p]):
            print(f"  {pair[0]:22s} {pair[1]:8s} {calls[pair]:5d} calls  "
                  + " / ".join(disputed[pair]))
        return 0

    if args.report:
        return 0

    written = 0
    for (path, record) in records.values():
        for row in record.get("receiver") or []:
            pair = (row["object"], own_slot(row))
            found = settled.get(pair)
            if not found or row["contradicted"] \
                    or row["confidence"] not in TRUSTED:
                row.pop("name", None)
                row.pop("name_source", None)
                continue
            row["name"], row["name_source"] = found
            written += 1
        path.write_text(json.dumps(record, indent=1))
    print(f"{written} calls now carry a name.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
