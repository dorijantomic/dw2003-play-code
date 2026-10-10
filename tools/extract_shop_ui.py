#!/usr/bin/env python3
"""
Extract the STITSHOP shop-UI assets needed to render the *exact* original shop.

Decode source (see docs/research/ui/shop-system-decompiled.md):
  ~/ddw3/asm/dw2003/pro/stitshop.s  — the overlay (RAM base 0x80082cb0):
     * 204-entry state dispatch jump table @ 0x80082d80 (file 0xd0)
  ~/ddw3/rust/dw2003_pro_stitshop/src/data.rs:
     * STITSHOP_D0x00009df8 (the 68-u32 submenu table)
     * STITSHOP_SHOPS (31 Shop{len, items}) — directory lengths

The pixel geometry / SFX ids / input bits are constants lifted from the
decompiled state handlers (exe-decomp/stitshop_c/); they are not encoded in a
table, so they are emitted from the decoded LAYOUT block below and cross-checked
against the disasm where possible.

Output: web/assets/data/shop_ui.json
"""

import os
import json
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
STITSHOP_S = DDW3 / "asm/dw2003/pro/stitshop.s"
DATA_RS = DDW3 / "rust/dw2003_pro_stitshop/src/data.rs"
EXE_DATA_RS = DDW3 / "rust/dw2003_exe_data/src/data.rs"
OUT = ROOT / "web/assets/data/shop_ui.json"

OVERLAY_BASE = 0x80082CB0
DISPATCH_OFF = 0xD0          # file offset of the 204-entry jump table
N_STATES = 0xCC              # 204
IDLE_HANDLER = 0x80085FA0    # the no-op slot every unused state points at

# Human labels for the live states (from the decompile, §3 of the doc).
STATE_ROLE = {
    0x01: "draw_main_menu",
    0x02: "main_menu_input",
    0x03: "open_submenu",
    0x04: "submenu_wait",
    0x05: "submenu_ready",
    0x06: "submenu_input",
    0x14: "buylist_open",
    0x15: "buylist_build",
    0x16: "buylist_ready",
    0x17: "buylist_input",
    0x18: "qty_a",
    0x19: "qty_b",
    0x1A: "qty_c",
    0x1E: "buy_commit_a",
    0x1F: "buy_commit_b",
    0x20: "buy_commit_c",
    0x21: "buy_commit_d",
    0x22: "buy_commit_e",
    0x27: "post_buy_a",
    0x28: "post_buy_b",
    0x29: "post_buy_c",
    0x32: "cancel_leave",
    0x33: "teardown",
    0x64: "child_mark",
    0x65: "child_wait",
    0xC8: "message_open",
    0xC9: "message_ready",
    0xCA: "message_wait",
    0xCB: "message_dismiss",
}

# Full static chrome draw-graph, transcribed 2026-07-10 from the overlay draw
# fns (three of which m2c FAILED on — F0x80083970/F0x8008af50/F0x8008adec — so
# they were read from _stitshop.norm.s; extractor: scratchpad extract_all_draws
# session, every sp94/sp9C/spA4/sp8C call resolved).  Draw ctx vtable
# (resident F0x8001f648): sp84=src-res, sp8C=bind OT layer, sp94=draw clip,
# sp98=CLUT-cycle row, sp9C=xyz scale (0x1000=1.0, open/close fold anim),
# spA4=scale pivot.
#
# `mode` below = band-object unk58: 0 = BUY (ctor F0x80083f30), 1 = SELL
# (ctor F0x80086360); the whole lower band shifts by mode*42 (band/labels) and
# mode*40 (desc window).  Rig cross-check: both 2026-07-10 BUY screenshots
# measure band y=108, desc y=156..193 => mode 0 (scale-calibrated).
CHROME = {
    "root": {  # F0x8008b60c (draw) + F0x8008b524 (labels)
        "layer": 1,
        "draws": [
            {"clip": 1, "x": 0x16, "y": 0x12, "pivot": [0x57, 0x19], "role": "shop-name plate"},
            {"clip": 2, "x": 0xD6, "y": 0x0F, "pivot": [0x140, 0x18], "role": "BIT balance plate"},
            {"clip": 5, "x": 0xA9, "y": 0x26, "pivot": [0x140, 0x3B], "role": "BUY/SELL window"},
            {"clip": 0, "x": 0xC6, "y": 0xC4, "pivot": [0x140, 0xD2], "role": "footer plate"},
        ],
        "backdrop": {"clip": 20, "layer": 7, "scroll": "(o,o) += 0.5/vsync, wrap 96"},
        "labels": {  # F0x8008b524: F0x8001ae38(handle, kind, x, y)
            "footer": [0xD3, 0xCC], "shop_name": [0x1D, 0x14],
            "bit_digits_k3": [0x11A, 0x17], "bit_BIT_k3": [0x117, 0x17],
            "row0": [0xBE, 0x2F], "row1": [0xBE, 0x3D], "cursor_x": 0xB0,
        },
    },
    "list": {  # F0x80087920 (draw) + F0x80087428 (labels); u5C = mode
        "window": {"clip": "6 + mode", "x": 0, "y": 0x1D,
                   "pivot": [0xA0, 0x47], "anim": "y-fold"},
        "cell": {"icon_x": "0x28 + 0x83*col", "text_x": "0x37 + 0x83*col",
                 "y": "0x24 + 0x0E*row", "underline": {"clip": 0x31, "at": "icon pos"},
                 "per_page": {"buy": 8, "sell": 14}, "cols": 2},
        "tabs": {"l1_clip": 0x10, "l1_x": 0x1E, "r1_clip": 0x11, "r1_x": 0xFD,
                 "y": "0x5F + 0x2A*mode", "clut_cycle": "k=0..3 every 11 vsync",
                 "l1_text": [0x2D, "0x5C + 0x2A*mode"], "r1_text": [0x102, "0x5C + 0x2A*mode"]},
        "page_indicator": {"n_x": 0x9B, "slash_x": 0x9C, "m_x": 0xB0,
                           "y": "0x60 + 0x28*mode"},
        "cursor_spawn": [0x1D, 0x24],
    },
    "band": {  # F0x8008af50 blob (m2c FAILED; asm-transcribed) + F0x80089a44 labels
        "disasm": "F0x8008af50 (m2c failed; transcribed from stitshop.s) plus "
                  "the label pass F0x80089a44",
        "layer": "obj.unk54 - 1  (in front of list)",
        "band_plate": {"clip": 0xE, "x": 0x0F, "y": "0x6C + 42*mode",
                       "note": "left = icon+name lozenge + Equip/Items bar; right = the price plate (double height)"},
        "item_icon": {"pack": "CMFONT", "x": 0x16, "y": "0x73 + 42*mode"},
        "desc_window": {"clip": 3, "x": 0, "y": "0x9C + 40*mode",
                        "pivot": [0xA0, "0xAE + 40*mode"]},
        "labels": {
            "name": [0x25, "0x73 + 42*mode"],
            "equip_lbl": [0xA1, "0x75 + 42*mode"], "equip_n": [0xE1, "0x75 + 42*mode"],
            "items_lbl": [0xEA, "0x75 + 42*mode"], "items_n": [0x12A, "0x75 + 42*mode"],
            "price_digits_k3": [0x11A, "0x8B + 42*mode"], "price_BIT_k3": [0x117, "0x8B + 42*mode"],
            "desc_line1": [0x14, "0xA1 + 40*mode"], "desc_line2": [0x14, "0xAF + 40*mode"],
            "prompt_msg": [0x13, 0x87],
        },
    },
    "cards": {  # F0x8008a450 — BUY (mode 0) only, equipment items
        "prompt_plate": {"clip": 9, "x": 0, "y": 0x81,
                         "role": "the '[circle] Button: Effects' plate row"},
        "card": {"clip": 8, "x": "0x0B + 0x63*i", "y": 0x9C, "x0": 0x0B, "y0": 0x9C},
        "cant_equip_x": {"clip": 0x16, "x": "0x19 + 0x63*i", "y": 0xAD,
                         "x0": 0x19, "y0": 0xAD},
        "equipped_icon_table": 0x8008CAB8,
        "select_frame": {"clip": 0xF, "x": "0x10 + 0x63*i", "y": 0x9C,
                         "clut_cycle": "k=0..7 every 9 vsync (F0x80083970 tail)"},
        "member_name": [0x17, 0x9E],  # + 0x63*i
        # The four stat rows on each card, ctor F0x80089a44 and fill
        # F0x80089274 + F0x800890b0, all + 0x63*i for member i. Rows 0 and 1
        # are the item's own two stats and carry the "[arrow-right]" glyph,
        # esitshop string 0xC, between the before and after values. Rows 2 and
        # 3 are whatever else the item changes and carry no arrow; their after
        # value is right-anchored nine pixels further right than rows 0 and 1.
        "stat_rows": {
            "member_pitch": 0x63,
            "arrow_str": 0xC,
            "row0": {"y": 0xAC, "before_x": 0x39, "arrow_x": 0x3C, "after_x": 0x5A},
            "row1": {"y": 0xBA, "before_x": 0x39, "arrow_x": 0x3C, "after_x": 0x5A},
            "row2": {"y": 0xC8, "before_x": 0x39, "after_x": 0x63},
            "row3": {"y": 0xD6, "before_x": 0x39, "after_x": 0x63},
        },
    },
    "windows": {  # twin window fns: F0x80083970 (BUY) / F0x80085b18 (SELL)
        "disasm": "twin window functions F0x80083970 (BUY) and F0x80085b18 "
                  "(SELL); every plate below is a literal clip/x/y argument in "
                  "one of the two",
        "howmany_plate": {"clip": 0xA, "x": 0x9A, "y": 0x34},
        "spinner": {"clip": 0xB, "x": 0xF6, "y": 0x4F},
        "spin_up": {"clip": 0x12, "x": 0x122, "y": 0x51},
        "spin_down": {"clip": 0x13, "x": 0x122, "y": 0x5B},
        "prompt_plate": {"clip": 0x15, "x": 0x7B, "y": 0x26,
                         "note": "up to 3 stacked window instances, same pos"},
        "confirm_window": {"clip": 0xC, "x": 0xAF, "y": 0x43},
        "message_plate": {"clip": 0x15, "x": 0x7B, "y": 0x84},
        "sell_only": {"qty_plate": {"clip": 0xD, "x": 0xA0, "y": 0x24},
                      "category_window": {"clip": 4, "x": 0xA9, "y": 0x26}},
        # The confirm/quantity dialog's own TEXT, built by F0x8008360c on the
        # buy side and F0x800859c0 on the sell side -- the same seven places,
        # plus one more the sell side owns. Filled by F0x80083eb0 / F0x80085f48
        # out of esitshop (bank 0x71 + the language index).
        "text": {
            "disasm": "ctor F0x8008360c (buy) / F0x800859c0 (sell); fill "
                      "F0x80083eb0 / F0x80085f48",
            "howmany": {"x": 0xB9, "y": 0x3A, "str": 0x11},
            "qty_times": {"x": 0x103, "y": 0x54, "str": 8},
            "qty_number": {"x": 0x11E, "y": 0x54},
            "prompt": {"x": 0x9A, "y": 0x2C,
                       "str_confirm": 0x15, "str_not_enough_bit": 0x1B,
                       "str_too_many_items": 0x1C},
            "yes": {"x": 0xC5, "y": 0x49, "str": 0x16},
            "no": {"x": 0xC5, "y": 0x59, "str": 0x17},
            "yes_no_cursor": {"x": 0xB8, "y": 0x49, "pitch": 0x10, "rows": 2},
            # Sell side only: "Don't have {1}." with the category name, which
            # is esitshop 0x1D + the category cursor.
            "sell_empty": {"x": 0x9A, "y": 0x8A, "str": 1,
                           "insert_str_base": 0x1D},
        },
    },
}

# Layout decoded from the state handlers (see doc §4). Sourced, not guessed.
LAYOUT = {
    "main_menu": {
        "options": 4,
        "cursor_x": 0xB0,
        "cursor_y_base": 0x2F,      # y = index * row_pitch + cursor_y_base
        "row_pitch": 0x0E,          # 14 px
        "cursor_y": [i * 0x0E + 0x2F for i in range(4)],  # 47,61,75,89
        "text_row_index_base": 0x1D,
    },
    "windows": {
        "main_menu": "+0x7C",
        "buy_list": "+0x8C",
        "message": "+0xBC",
    },
    "sfx": {
        "cursor_move": 0x8004513E,
        "confirm": 0x8004503C,
        "cancel": 0x800450BD,
    },
    "input": {
        "device": 0x8004B7D0,
        "held_fn": "+0x3F4",
        "repeat_fn": "+0x3FC",
        "bit_fn": "+0x408",
        "buttons": {"up": 4, "down": 6, "confirm": 0xD, "cancel": 0xE},
    },
    "helpers": {
        "play_sfx": 0x80055C48,
        "palette_color_fn": 0x80044B38,
        "palette_base": 0x8005CCA8,
        "window_open": 0x8008D1B8,
        "window_ready": 0x8008D1BC,
        "game_state": 0x80048D34,
    },
    "directory": {
        "shops": 0x8008D0B4,        # STITSHOP_SHOPS[31] {len, *items}
        "shop_load": 0x8008C488,    # shop_load(shop_id) -> items ptr
        "len_global": 0x8008D1AC,
        "submenu_table": 0x8008CAA8,  # STITSHOP_D0x00009df8 (the 68 u32)
    },
}


def parse_dispatch() -> list[dict]:
    """Read the 204-entry state jump table from the overlay disasm."""
    handlers: dict[int, int] = {}
    pat = re.compile(r"\.L0x([0-9a-fA-F]+): \.word 0x([0-9a-fA-F]{8})")
    for ln in STITSHOP_S.read_text().splitlines():
        m = pat.match(ln)
        if not m:
            continue
        off, val = int(m.group(1), 16), int(m.group(2), 16)
        lo = DISPATCH_OFF
        hi = DISPATCH_OFF + N_STATES * 4
        if lo <= off < hi and 0x80082CB0 <= val < 0x80093000:
            handlers[(off - lo) // 4] = val
    states = []
    for st in sorted(handlers):
        h = handlers[st]
        if h == IDLE_HANDLER:
            continue
        states.append({
            "state": st,
            "handler": f"F0x{h:08x}",
            "role": STATE_ROLE.get(st, "unknown"),
        })
    return states


def parse_submenu_table() -> list[int]:
    """The 68-u32 STITSHOP_D0x00009df8 table (indexed by main-menu cursor)."""
    src = DATA_RS.read_text()
    m = re.search(r"STITSHOP_D0x00009df8[^=]*=\s*\[(.*?)\];", src, re.S)
    if not m:
        raise SystemExit("STITSHOP_D0x00009df8 not found in data.rs")
    # one value per line; strip the trailing `// 0xADDR` comment first
    vals = []
    for line in m.group(1).splitlines():
        code = line.split("//", 1)[0]
        hit = re.search(r"0x[0-9a-fA-F]+", code)
        if hit:
            vals.append(int(hit.group(0), 16))
    return vals


def parse_shop_lengths() -> list[int]:
    """Directory lengths from STITSHOP_SHOPS (per-shop item count)."""
    src = DATA_RS.read_text()
    block = re.search(r"STITSHOP_SHOPS[^=]*=\s*\[(.*?)\];", src, re.S)
    if not block:
        return []
    return [int(x, 0) for x in re.findall(r"len:\s*(0x[0-9a-fA-F]+|\d+)", block.group(1))]


def parse_sell_catalog() -> list[list[int]]:
    """Resident item-directory order used by the SELL list provider.

    F0x800888e4 calls the resident provider with category indices 1..4.
    The provider scans the pointed-to u16 table until its zero terminator.
    """
    src = EXE_DATA_RS.read_text()
    table = re.search(r'pub static mut D0x80042bc8[^=]*= unsafe \{ \[(.*?)\] \};', src, re.S)
    if not table:
        raise SystemExit("resident item-directory pointer table not found")
    addresses = re.findall(r'&D0x([0-9a-fA-F]+)\[0\]', table.group(1))
    if len(addresses) != 5:
        raise SystemExit(f"expected five item-directory pointers, got {len(addresses)}")
    categories = []
    for address in addresses[1:]:  # index 0 is not a SELL category
        row = re.search(rf'pub static mut D0x{address}[^=]*= \[(.*?)\];', src, re.S)
        if not row:
            raise SystemExit(f"item-directory array D0x{address} not found")
        code = '\n'.join(line.split('//', 1)[0] for line in row.group(1).splitlines())
        values = [int(value, 16) for value in re.findall(r'0x([0-9a-fA-F]+)', code)]
        if not values or values[-1] != 0 or 0 in values[:-1]:
            raise SystemExit(f"item-directory array D0x{address} has invalid terminator")
        categories.append(values[:-1])
    return categories


def main() -> None:
    states = parse_dispatch()
    table = parse_submenu_table()
    lengths = parse_shop_lengths()
    sell_catalog = parse_sell_catalog()

    out = {
        "_source": "docs/research/ui/shop-system-decompiled.md",
        "overlay_base": OVERLAY_BASE,
        "dispatch": {
            "table_addr": OVERLAY_BASE + DISPATCH_OFF,
            "key": "shop_obj+0x10",
            "n_states": N_STATES,
            "idle_handler": f"F0x{IDLE_HANDLER:08x}",
            "states": states,
        },
        "submenu_table": {
            "addr": LAYOUT["directory"]["submenu_table"],
            "indexed_by": "main_menu_cursor (0..3)",
            "submode_map": table[:4],   # the 4 live entries
            "raw": table,
        },
        "shop_lengths": lengths,
        "sell_catalog": sell_catalog,
        "layout": LAYOUT,
        "chrome": CHROME,
        "object_fields": {
            "0x10": "state_id",
            "0x14": "purchase_made_flag",
            "0x2C": "transition_method_ptr",
            "0x60": "menu_cursor (0..3)",
            "0x64": "selected_item_index",
            "0x68": "quantity",
            "0x6C": "item_price_or_stock",
            "0x7C": "window_main_menu",
            "0x8C": "window_buy_list",
            "0xBC": "window_message",
        },
    }
    OUT.write_text(json.dumps(out, indent=2))
    print(f"Wrote {OUT}")
    print(f"  {len(states)} live states / {N_STATES}")
    print(f"  submenu table: {len(table)} u32, submode map = {table[:4]}")
    print(f"  shop lengths: {len(lengths)} shops")
    print(f"  sell catalog: {[len(row) for row in sell_catalog]} entries by category")


if __name__ == "__main__":
    main()
