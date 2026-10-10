#!/usr/bin/env python3
"""
Extract the STSTATUS pause/status-menu UI layout so the walker renders the
*exact* original menu chrome (same approach as tools/extract_shop_ui.py for
the shop).

Decode sources:
  ~/ddw3/asm/dw2003/pro/ststatus.s — the overlay (RAM base 0x80082cb0):
     * portrait animation table   @ 0x8009a9c0  (via the static pointer at
       0x8009af68): 8 records x 7 words, one per partner in NATIVE starter
       order; each record is a clip-id animation SEQUENCE terminated by -1
       (e.g. Kotemon = 7,8,9,10,9,8 — a baked ping-pong).
     * card/footer label table    @ 0x8009aaa0  (via the pointer at
       0x8009af6c): 0xC-stride records {esstatus_string_id, x, y}.
     * home right-pane window map @ 0x8009a950: ststat clip id per menu-row
       count (indexed unkDC-1; 5 visible rows -> clip 0x2d = 45).
  exe-decomp/ststatus_c/ — m2c decompile of the overlay (303 fns; reproduce:
  tools/exe_decomp/overlay_to_fns.py -> normalize_asm.py -> decompile_exe.py).
  The literal chrome placements below are transcribed from these draw/ctor
  fns (provenance on each block):
     * home/choose draw F0x800946bc + ctor F0x80093e84
     * status-detail draw F0x8008c954 + ctor F0x8008b520
     * items-bag draw F0x80092fac + ctor F0x80091e94
     * digivolve draw F0x8008f8f0 + ctor F0x8008e94c
     * equip-pick draw F0x800895c8
     * EQUIP full screen (2026-07-10c re-audit) draw F0x80086dd4 + label ctor
       F0x80086498 + fillers F0x80086680 (slots) / F0x80086900 (list rows) /
       F0x800867b8 (desc) / F0x80086c78 (detail panel); entered from the
       status-detail equip panel, exit states 0xd3-0xd5 (table @file 0x34c)
       return to state 3
     * techniques twins F0x80083c94/F0x800855c8 + ctors F0x80083680/F0x80084f54
     * sort draw F0x80096988 + ctor F0x80096590
     * backdrop F0x800997d4 (ststat clip 0x1d at (o,o))

Window FOLD animation (2026-07-10c): every ststatus window opens/closes via
the tween at [0x8009b5d8] = F0x80099d5c — value 0->0x1000 over `steps`
vsyncs (all ststatus windows: steps=0xA, file 0x55c4), close runs the delta
DOUBLED (0x1000/steps*2); open plays packed SFX 0x40019 (SYSTEM03), close
0x4001a (SYSTEM04). The value feeds sp9C scale around the per-window spA4
pivot (pivots transcribed per screen below). Windows open SEQUENTIALLY
(each state handler waits [0x8009b5dc] ready before starting the next).

Chrome pack split (decoded): the PARTY CARD windows and several plates are
CMFONTCS clips (pack handle 0x02860000 = LBA 646), NOT ststat clips — the
clips are frames only. LV/HP/MP/"/" are kind-3 text widgets from the label
table (F0x80093e84). ststat (0x04040000 = LBA 1028) carries the backdrop,
the selection corners, and the per-screen windows.

Animation semantics (disasm-proven):
  * portraits step every 13 vsyncs through the sequence table
    (F0x800946bc: [0x8004de10]->unk188() tick counter, `>= 0xD`).
  * the orange selection corners (ststat clip 0x1e) animate by CLUT-ROW
    CYCLING: sp98(k) stores ctx+0x20, which F0x8001ed6c ADDS to the frame's
    CLUT y (fns.s 0x8001ef80: `lw $a1, 0x20($v1)` ... `addu $v0, $a1` before
    the <<6 CLUT address shift). k cycles 0..7 every 9 vsyncs; k=8 is the
    "locked" palette. extract_screen_packs.py emits these as id "30#k".
  * the items-bag page arrows (clips 0x34/0x35) cycle k=0..3 every 11 vsyncs.
  * the footer blink arrow is CMFONT clip 0xA, palette k=0..4 every 4 vsyncs.
  * the backdrop scrolls +0.5px/vsync (25px/s PAL), wrapping at 96.

Output: web/assets/data/status_ui.json
"""

import os
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STSTATUS_S = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "asm/dw2003/pro/ststatus.s"
OUT = ROOT / "web/assets/data/status_ui.json"

OVERLAY_BASE = 0x80082CB0
PORTRAIT_TABLE = 0x8009A9C0   # [0x8009af68]
LABEL_TABLE = 0x8009AAA0      # [0x8009af6c]
MENU_CLIP_TABLE = 0x8009A950  # right-pane window clip per row count
SLOT_NAME_TABLE = 0x8009A7AC  # 6 words: esstatus id per equip slot (F0x80086680)
WIELD_NAME_TABLE = 0x8009A7C4 # 8 words: esstatus id per item equip-kind f2-1 (F0x800867b8)
ESSTATUS_TOML = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "lang_file/dw2003/eng/esstatus.toml"

# ── MAP screen tables (draw F0x80098b84, step fn 0x8009913c, decoded +
# rig-verified 2026-07-11; see status-menu-chrome-decompiled-2026-07-10.md) ──
MAP_MARKER_TABLE = 0x8009AB60   # [0x8009af70]: 0xC-stride {icon clip, x, y},
                                # records 1..46; index doubles as the location
                                # name string id in esaskmap/esamtmap
MAP_AREA_POS_TABLE = 0x8009AD94 # [0x8009af74]: 8-stride {x, y} indexed by
                                # AREA id 1..22 — position of the revealed-
                                # terrain patch clip (stwmp sub 1, clip a-1)
MAP_TIER_TABLE = 0x8009AF40     # 10 ptrs: [server*5 + tier] -> 0-terminated
                                # area-id list (F0x80099f5c)
MAP_STAGE_LOC_TABLE = 0x8009B5FC  # byte per stage&0xff (0x00..0xd6):
                                  # location record index | 0x80 (Amaterasu)
MAP_CURSOR_ANIM = 0x8009A978    # 4 words [0,1,2,1]
ESASKMAP_TOML = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "lang_file/dw2003/eng/esaskmap.toml"
ESAMTMAP_TOML = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "lang_file/dw2003/eng/esamtmap.toml"
# The walker names maps sNNN by their WSTAG "stage" number, which is remapped
# from the PS1 stage id (= screen index) via data/screen_table.json (e.g. PS1
# 0x23e -> walker 500). The MAP tables above are all PS1-keyed, so compose
# through this to give the walker a walker-stage -> marker/server lookup.
SCREEN_TABLE = ROOT / "data/screen_table.json"

# Which starter names each ROW of the portrait table, as digimon.json ids.
#
# The row index is not a guess and not merely pinned by the art: it IS the ROSTER
# SLOT. Every reader reaches the table by that number. The pause STATUS cards and
# the fight report ask [0x80048D34]+0x2718 (F0x80016D94) for the roster slot at a
# party position and put the return value straight into the x7 row stride
# (pro/ststatus.s:10074-10077, exe/fns.s:7506-7516); the Digimon Lab asks
# [0x80048D34]+0x2728 (F0x80016FD8), which re-derives the same slot from the
# roster record's +0x760 word less three (pro/stgdglab.s:8318-8324,
# exe/fns.s:7672-7686); the memory card asks the save record's starter byte less
# three (pro/stgmcard.s:882-893). F0x80016DC0 fills ctx+0x70 with the three roster
# slots of the chosen starter pack (exe/fns.s:7520-7548), and the eight slots are
# the eight starter lines (engine/dw3/roster.ts ROSTER_SLOT_CHARIDS), so the row
# is the digimon.json id minus one. Ledger claim
# digimon-picture-row-is-the-roster-slot-2026-10-03.
#
# The art agrees, and that is the cross-check rather than the source: Kotemon 7-10,
# Kumamon 14-16, Monmon 11-13, Agumon 3-6, Veemon 25-28, Guilmon 0-2, Renamon
# 17-20, Patamon 21-24, checked by eye on ststat_sheet.png and stdglabo_sheet.png
# (2026-10-03). The older pixel-clustered order swapped Kumamon and Veemon.
NATIVE_PORTRAIT_ORDER = [1, 2, 3, 4, 5, 6, 7, 8]  # digimon.json ids


def read_words(path: Path) -> dict[int, int]:
    words = {}
    rx = re.compile(r"\.L0x([0-9a-f]{8}):\s*\.word\s+0x([0-9a-fA-F]+)")
    for ln in path.open():
        m = rx.match(ln)
        if m:
            words[int(m.group(1), 16)] = int(m.group(2), 16)
    return words


def main() -> int:
    words = read_words(STSTATUS_S)

    def w(ram: int) -> int:
        return words[ram - OVERLAY_BASE]

    # ── portrait animation sequences ──
    portraits = {}
    for i, dig_id in enumerate(NATIVE_PORTRAIT_ORDER):
        seq = []
        for k in range(7):
            v = w(PORTRAIT_TABLE + i * 0x1C + k * 4)
            if v == 0xFFFFFFFF:
                break
            seq.append(v)
        portraits[str(dig_id)] = seq

    # ── card/footer label records {esstatus string id, x, y} ──
    def rec(off: int):
        base = LABEL_TABLE + off
        return {"str": w(base), "x": w(base + 4), "y": w(base + 8)}

    card_labels = {
        "name": rec(0x00),                       # str 12 "ーーーーー" @ (55,19)
        "static": [rec(0x0C), rec(0x18), rec(0x24), rec(0x30), rec(0x3C)],
        # LV @(16,28)  HP @(16,37)  / @(61,37)  MP @(16,46)  / @(61,46)
        "values": [rec(0x48), rec(0x54), rec(0x60), rec(0x6C), rec(0x78)],
        # LV @(44,28)  HPcur @(59,37)  HPmax @(94,37)  MPcur @(59,46)  MPmax @(94,46)
    }
    footer_labels = {
        "line1": rec(0x90),   # (20,198) — footer text line 1
        # line 2 is created at line1.y + 0xE by the ctors (F0x80093e84)
        "bit_value": rec(0x9C),   # (265,212)
        "bit_label": rec(0xA8),   # (300,212) — "BIT" (esstatus 5)
    }

    menu_window_clips = [w(MENU_CLIP_TABLE + i * 4) for i in range(5)]

    # esstatus string table (for resolving slot/wield name ids to text)
    def toml_strings(path: Path):
        m = re.search(r"strings\s*=\s*\[(.*)\]",
                      path.read_text(encoding="utf-8", errors="replace"), re.S)
        return re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))

    esstatus = toml_strings(ESSTATUS_TOML)
    slot_names = [esstatus[w(SLOT_NAME_TABLE + i * 4)] for i in range(6)]
    wield_names = [esstatus[w(WIELD_NAME_TABLE + i * 4)] for i in range(8)]

    # ── MAP screen data ──
    def byte(ram: int) -> int:
        wd = words.get((ram - OVERLAY_BASE) & ~3, 0)
        return (wd >> (((ram - OVERLAY_BASE) & 3) * 8)) & 0xFF

    markers = []
    for i in range(1, 47):
        base = MAP_MARKER_TABLE + i * 0xC
        markers.append({"loc": i, "clip": w(base),
                        "x": w(base + 4), "y": w(base + 8)})
    area_pos = {a: [w(MAP_AREA_POS_TABLE + a * 8),
                    w(MAP_AREA_POS_TABLE + a * 8 + 4)] for a in range(1, 23)}

    def area_list(p: int):
        out = []
        while w(p):
            out.append(w(p))
            p += 4
        return out

    tier_lists = [area_list(w(MAP_TIER_TABLE + i * 4)) for i in range(10)]
    stage_loc = {}                       # PS1 stage id -> marker record index
    for lo in range(0x00, 0xD7):
        stage_loc[str(0x200 + lo)] = byte(MAP_STAGE_LOC_TABLE + lo) & 0x7F
    loc_names = {"asuka": toml_strings(ESASKMAP_TOML),
                 "amaterasu": toml_strings(ESAMTMAP_TOML)}

    # Compose the walker-facing lookup through screen_table.json: for each
    # WSTAG "stage" number the walker uses as a map id, record its PS1 stage
    # id (for the server split, PS1 >= 0x270 = Amaterasu) and its location
    # marker record. This is the ONLY walker-keyed table; everything else is
    # the raw PS1 decode with provenance.
    screen_tab = json.loads(SCREEN_TABLE.read_text())
    walker_map = {}   # walker stage number -> {ps1, server, loc}
    for ps1_str, ent in screen_tab.items():
        ps1 = int(ps1_str)
        loc = stage_loc.get(str(ps1), 0)
        walker_map[str(ent["stage"])] = {
            "ps1": ps1, "server": 1 if ps1 >= 0x270 else 0, "loc": loc}

    ui = {
        "_source": "tools/extract_status_ui.py — ststatus.s tables + "
                   "exe-decomp/ststatus_c transcriptions (see tool header)",
        "overlay_base": OVERLAY_BASE,
        "portrait_sequences": portraits,   # digimon.json id -> ststat clip ids
        "card_labels": card_labels,
        "footer_labels": footer_labels,
        # home right-pane window clip, indexed by (visible menu rows - 1);
        # the standard 5-row menu (ITEMS/SORT/MAP/TECHNIQUES/STATUS) -> [4].
        "menu_window_clips": menu_window_clips,
        "timings_vsync": {                 # PAL 50Hz vsync counts
            "portrait_step": 13,           # F0x800946bc `>= 0xD`
            "selection_clut_cycle": 9,     # F0x8008c954 `>= 9`, k 0..7 (+8 locked)
            "footer_arrow_blink": 4,       # F0x800946bc `>= 4`, k 0..4
            "items_arrow_cycle": 11,       # F0x80092fac `>= 0xB`, k 0..3
            "backdrop_px_per_vsync": 0.5,  # shared with stshop (25 px/s)
        },
        # Window fold tween — F0x80099d5c ([0x8009b5d8]): value 0..0x1000,
        # delta 0x1000/steps per vsync (steps=0xA everywhere, file 0x55c4);
        # CLOSE doubles the delta. Open plays packed SFX 0x40019 (SYSTEM03),
        # close 0x4001a (SYSTEM04). Windows open sequentially (ready-gated).
        "window_fold": {
            "steps_vsync": 10,
            "close_speed_mult": 2,
            "sfx_open": "system03",
            "sfx_close": "system04",
        },
        # ── literal chrome/text placements (decompile transcriptions) ──
        # pack: "ststat" = 0x04040000 (STSTATCS), "cmfont" = 0x02860000
        # (CMFONTCS). All coordinates are native 320x240 pixels.
        "screens": {
            "shared": {
                "_fn": "F0x800946bc/F0x8008c954 party-card loops",
                "card_pitch": 0x2E,        # 46px per card
                "card_chrome": [           # per card i: y += 46*i
                    {"pack": "cmfont", "clip": 0x15, "x": 0, "y": 0x11},
                    {"pack": "cmfont", "clip": 0x16, "x": 0x67, "y": 0x13},
                    {"pack": "cmfont", "clip": 0x17, "x": 0, "y": 0x11},
                ],
                "portrait": {"x": 0x6B, "y": 0x13},
                "selection": {"pack": "ststat", "clip": 0x1E, "x": 0,
                              "y_base": 0x11, "pitch": 0x2E},
                # ── how a party card folds ────────────────────────────
                # F0x8008c954 / F0x800946bc draw the card in three pieces under
                # TWO different scale/pivot pairs, not one:
                #   clip 0x15 @ (0, 17+46i)   scale (v,1,1) pivot (0,   37+46i)
                #   clip 0x16 @ (103,19+46i)  scale (v,v,1) pivot (124, 39+46i)
                #   clip 0x17 @ (0, 17+46i)   scale (v,1,1) pivot (0,   37+46i)
                # so the frame unrolls sideways from x=0 while the portrait
                # plate grows from its own corner.
                "card_fold": {
                    "side": {"pivot_x": 0, "dy": 0x25, "axis": "x"},
                    "plate": {"pivot_x": 0x7C, "dy": 0x27, "axis": "xy"},
                },
                # fold pivots (F0x800946bc): header (0x140,0x19), footer
                # (0,0xd3)
                "header": {"pack": "cmfont", "clip": 0x18, "x": 0x22, "y": 0xD,
                           "pivot": [0x140, 0x19]},
                # Header string widget: F0x80093e84 / F0x8008b520 create it
                # with kind 1 at label-table +0x84 (x=152, y=19). The ctor
                # writes a placeholder; the screen filler then sets string
                # 0x27 "Choose Digimon" / 0x2B "Use it on who?".
                "header_text": rec(0x84),
                "footer": {"pack": "ststat", "clip": 0x20, "x": 0, "y": 0xC2,
                           "pivot": [0, 0xD3]},
                "card_pivot_x": 0x7C,
                "footer_arrow": {"pack": "cmfont", "clip": 0xA,
                                 "x": 0x123, "y": 0xD6},
                "backdrop_clip": 0x1D,
            },
            # RENAMED 2026-08-14 (was "home"). This block is the TECHNIQUES
            # panel, not the top-level menu: its draw fn F0x800946bc sizes the
            # window from unkDC, unkDC comes from F0x800937a4, and F0x800937a4
            # counts the Digimon's HEALING techniques (ids 0xb8..0xbc). The rows
            # are filled with skill names by F0x80094388 from text bank 0xa2.
            # See docs/research/ui/pause-menu-screen-tree-2026-08-14.md §1/§9 and
            # ledger UI-PAUSEMENU-SCREEN-FACTORY-TABLE-2026-08-14.
            "techniques": {
                "_fn": "draw F0x800946bc + ctor F0x80093e84 (root F0x80096380)",
                "menu_window": {"pack": "ststat", "x": 0x94, "y": 0x2F,
                                "pivot": [0x140, 0x63]},
                "menu_rows": {"x": 0xB1, "y_base": 0x41, "pitch": 0xE},
                "menu_header": {"x": 0x9C, "y": 0x31},
                "cursor_x": 0xA6,
            },
            # The TOP-LEVEL START menu is NOT in this overlay at all — it is the
            # resident executable's F0x8001270c, widgets built by F0x800121b4.
            # Rows and cursor below are read from that constructor. The window
            # sprite behind them is NOT decoded, so the renderer keeps reusing
            # the techniques window until it is.
            "topmenu": {
                "_fn": "resident F0x8001270c + ctor F0x800121b4 (NOT ststatus)",
                "rows": {"x": 0xBD, "y_base": 0x31, "pitch": 0xE},
                "cursor_x": 0xB0,
                "bit_label": {"x": 0x46, "y": 0xA6},
                "bit_value": {"x": 0x42, "y": 0xA6},
                "row_ids_table": "D0x8003ef14",
                "row_ids": [[6, 7, 8, 9, 10, 0], [6, 7, 8, 9, 10, 11]],
                "card_folder_gate": "D0x80048f42",
                "_window_undecoded": True,
            },
            "detail": {
                "_fn": "draw F0x8008c954 + ctor F0x8008b520",
                # The sheet opens on a TWO-row prompt (decoded 2026-08-14):
                # esstatus 0x2d "See Digivolve" / 0x2e "See Equipment", filled by
                # F0x8008bd70 (its loop runs exactly twice), rows built at
                # (0xac, 0x13 + 0xe*i) by F0x8008b520 and the cursor placed at
                # (0x98, unk74 * 0xe + 0x13) by F0x8008d684 state 5.
                "prompt": {"x": 0xAC, "y_base": 0x13, "pitch": 0xE,
                           "cursor_x": 0x98, "n": 2,
                           "rows": ["See Digivolve", "See Equipment"]},
                # ── the sheet's six fold windows ──────────────────────
                # F0x8008d684 owns them; F0x8008c954 draws each under its own
                # scale/pivot pair. Slot = the 16-byte tween struct in the
                # screen object, value at slot+8 (the draw's guard field).
                #   +0xd8 card   +0xe8 name tab   +0xf8 stat window (+TP plate)
                #   +0x108 digivolve panel  +0x118 equip panel  +0x128 EXP plate
                # Every one folds on X except the card's middle piece.
                "name_tab": {"pack": "ststat", "clip": 0x1F, "x": 0x14, "y": 0xD,
                             "slot": 0xE8, "pivot": [0x140, 0x20]},
                "exp_plate": {"pack": "cmfont", "clip": 0x1A, "x": 0, "y": 0x3D,
                              "slot": 0x128, "pivot": [0, 0x47]},
                "exp_value": {"x": 0x42, "y": 0x45},
                # F0x8008b520 builds TWO kind-3 widgets on this row: the value
                # (right-anchored at 0x42) and the esstatus 0x35 "EXP" label at
                # 0x46. F0x8008d684 fills them together.
                "exp_label": {"x": 0x46, "y": 0x45, "str": esstatus[0x35]},
                "stat_window": {"pack": "ststat", "clip": 0x21, "x": 0, "y": 0x54,
                                "slot": 0xF8, "pivot": [0, 0x88]},
                "stat_icons": {"pack": "cmfont", "clip": 0xF, "x": 0, "y": 0x57},
                "stat_values": {"x": 0x32, "y_base": 0x5B, "pitch": 0xE, "n": 6},
                "res_values": {"x": 0x5B, "y_base": 0x5B, "pitch": 0xE, "n": 7},
                # The TP plate shares the stat window's fold slot and has its
                # own pivot (F0x8008c954: same unk100 guard, spA4(0,0xd0)).
                "tp_plate": {"pack": "ststat", "clip": 0x3C, "x": 0, "y": 0xC4,
                             "slot": 0xF8, "pivot": [0, 0xD0]},
                "tp_value": {"x": 0x2D, "y": 0xCB},
                # F0x8008b520 tail: esstatus 0x4e "TP" at (0x10,0xcb) and the
                # right-anchored number at (0x2d,0xcb); F0x8008c1c0 fills both
                # and hides both together.
                "tp_label": {"x": 0x10, "y": 0xCB, "str": esstatus[0x4E]},
                "digivolve_window": {"pack": "ststat", "clip": 0x22,
                                     "x": 0xA0, "y": 0x35,
                                     "slot": 0x108, "pivot": [0x140, 0x55]},
                "digivolve_header": {"x": 0xA7, "y": 0x37},
                "digivolve_rows": {"x": 0xB2, "y_base": 0x47, "pitch": 0xE, "n": 3},
                "equip_window": {"pack": "ststat", "clip": 0x23,
                                 "x": 0xA0, "y": 0x77,
                                 "slot": 0x118, "pivot": [0x140, 0xAC]},
                "equip_header": {"x": 0xA7, "y": 0x79},
                "equip_rows": {"x": 0xC0, "y_base": 0x89, "pitch": 0xE, "n": 6,
                               # per-item icon clip (runtime f5 vtable +4 —
                               # icon ids NOT yet extracted)
                               "icon_x": 0xB2},
            },
            "items": {
                "_fn": "draw F0x80092fac + ctor F0x80091e94",
                "title_plate": {"pack": "ststat", "clip": 0x30, "x": 0xC, "y": 0x12,
                                "pivot": [0xC, 0x17]},
                "title_text": {"x": 0x13, "y": 0x14},
                "list_window": {"pack": "ststat", "clip": 0x2E, "x": 0, "y": 0x1E,
                                "pivot": [0xA0, 0x60]},
                "cat_plate": {"pack": "ststat", "clip": 0x26, "x": 0xA0, "y": 0x12,
                              "pivot": [0x140, 0x26]},
                "grid": {"cols": 2, "rows": 8, "col_pitch": 0x83, "row_pitch": 0xE,
                         "icon_x": 0x29, "label_x": 0x38, "y_base": 0x25,
                         "cell_band_clip": 0x31, "cursor_x": 0x1E},
                "page_arrows": [
                    {"pack": "ststat", "clip": 0x34, "x": 0x1E, "y": 0x98},
                    {"pack": "ststat", "clip": 0x35, "x": 0xFD, "y": 0x98},
                ],
                # The bottom row is the PAGE COUNTER, not a quantity:
                # F0x80092340 puts the page number (unk6C8 + 1) in the widget
                # at 0x9b, esstatus 4 "/" in the one at 0x9e and the page total
                # (unk6CC) in the one at 0xb2, all on y 0x9c, the two numbers
                # right-anchored (unk148(...,1)).
                "page_counter": {"y": 0x9C, "current_x": 0x9B, "sep_x": 0x9E,
                                 "total_x": 0xB2, "sep": esstatus[4]},
                # ...and the two widgets beside the page arrows are the SHOULDER
                # BUTTON hints, shown only when that page exists: esstatus 0x22
                # "L1" hidden on the first page, 0x23 "R1" on the last.
                "page_hint_l1": {"x": 0x2D, "y": 0x97, "str": esstatus[0x22]},
                "page_hint_r1": {"x": 0x102, "y": 0x97, "str": esstatus[0x23]},
                # The band under the bag: the highlighted item's NAME, then two
                # counts that both belong to that same item. F0x8008e94c:89-93
                # builds the five kind-1 widgets, and F0x8008f0dc fills them —
                # the name from bank +0x6A by item id, then esstatus 0x20 with
                # the +0x20F count, then esstatus 0x16 with the +0x7C count.
                # Both numbers are right-anchored (unk148(...,1)).
                # Confirmed against docs/research/ui/captures/
                # pause-items-bag-2026-08-20.png: "Power Charge | Equip 0 |
                # Items 56", where 56 is the stock of that one item.
                "detail_band": {
                    "_fn": "ctor F0x8008e94c:89-93 + fill F0x8008f0dc",
                    "name": {"x": 0x25, "y": 0xAE},
                    "equip_label": {"x": 0xA1, "y": 0xAF, "str": esstatus[0x20]},
                    "equip_value_x": 0xE0,
                    "held_label": {"x": 0xEA, "y": 0xAF, "str": esstatus[0x16]},
                    "held_value_x": 0x128,
                },
            },
            "digivolve": {
                "_fn": "draw F0x8008f8f0 + ctor F0x8008e94c",
                "list_window": {"pack": "cmfont", "clip": 0x1C, "x": 0xA8, "y": 0x28},
                "rows": {"x": 0xC0, "y_base": 0x31, "pitch": 0xE},
                "cursor_x": 0xB0,
                "info_plate": {"pack": "cmfont", "clip": 0x1A, "x": 0, "y": 0x9E},
                "info_panel": {"pack": "ststat", "clip": 0x2F, "x": 0xF, "y": 0xA5},
                "dvexp_value": {"x": 0x42, "y": 0xA6},
                # F0x8008f8f0 draws the highlighted digivolution's icon
                # (cmfont, id from 0x80042B9C) at the left of the info row.
                "info_icon": {"x": 0x16, "y": 0xAE},
                "info_row": [{"x": 0x25, "y": 0xAE}, {"x": 0xA1, "y": 0xAF},
                             {"x": 0xE0, "y": 0xAF}, {"x": 0xEA, "y": 0xAF},
                             {"x": 0x128, "y": 0xAF}],
            },
            # The FULL equip screen (opened from the status-detail equip
            # panel; exit states 0xd3-0xd5 return to detail state 3). All
            # values transcribed from draw F0x80086dd4 + label ctor
            # F0x80086498 + fillers F0x80086680/F0x80086900/F0x800867b8/
            # F0x80086c78. Four fold windows: obj+0x6cc header, +0x6dc
            # slots, +0x6ec list, +0x6fc detail — steps=0xA (file 0x55c4),
            # opened sequentially in that order.
            "equip": {
                "_fn": "draw F0x80086dd4 + ctor F0x80086498",
                # Travelling bar down the right of the bag list. Only drawn
                # when the bag holds 9 or more pieces; 8 rows are visible.
                "scrollbar": {
                    "x": 0x125, "width": 0xC, "y0": 0x4E, "y1": 0xB3,
                    "visible": 8, "min_rows": 9,
                    "disasm": "F0x8008744c case 0xE: unk8C(0x125,0xC) "
                              "unk90(0x4E,0xB3) unk94(8, bagLength) only "
                              "when bag >= 9",
                },
                # header plate (cmfont 0x18) + prompt esstatus 0x3f
                # "Change which one?" (F0x800874bc)
                "header_plate": {"pack": "cmfont", "clip": 0x18, "x": 0x22,
                                 "y": 0xD, "pivot": [0x140, 0x19]},
                "header_text": {"x": 0x98, "y": 0x13,
                                "str": esstatus[0x3F]},
                # slots window: 6 equip slots (profile +0x3c0), item icon
                # ([0x80042b98] family clip) at x=0xb2, name at x=0xc0;
                # empty slot shows the grey slot name from 0x8009a7ac.
                "slots_window": {"pack": "ststat", "clip": 0x2A, "x": 0x9D,
                                 "y": 0x28, "pivot": [0x140, 0x58]},
                "slots": {"icon_x": 0xB2, "label_x": 0xC0, "y_base": 0x31,
                          "pitch": 0xE, "n": 6, "cursor_x": 0xA5},
                "slot_names": slot_names,   # 0x8009a7ac -> esstatus
                # bag list window: 8 visible rows, icon backplate ststat
                # 0x31 + item icon at x=0x91, name x=0xa0, grey "X"
                # (esstatus 0x40) right-aligned at x=0x10d, bag count
                # right-aligned at x=0x120; row -1 = "Unequip"
                # (esstatus 0x45); scroll offset obj+0x6c.
                "list_window": {"pack": "ststat", "clip": 0x2B, "x": 0x77,
                                "y": 0x39, "pivot": [0x140, 0x89]},
                "list": {"plate_clip": 0x31, "icon_x": 0x91, "label_x": 0xA0,
                         "x_label_x": 0x10D, "qty_x": 0x120, "y_base": 0x4B,
                         "pitch": 0xE, "rows": 8,
                         "header": {"x": 0x7F, "y": 0x3B}, "cursor_x": 0x86},
                "x_label": esstatus[0x40],       # "X"
                "unequip_label": esstatus[0x45],  # "Unequip"
                # scroll arrows blink (toggle every 9 vsyncs) when >8 rows
                "scroll_arrows": {
                    "up": {"pack": "ststat", "clip": 0x32, "x": 0x126, "y": 0x45},
                    "down": {"pack": "ststat", "clip": 0x33, "x": 0x126, "y": 0xB3},
                    "blink_vsync": 9,
                },
                # top-right current-equipment panel: "Equip" (esstatus
                # 0x20), equipped item icon + name (or grey slot name)
                "detail_window": {"pack": "ststat", "clip": 0x2C, "x": 0xA0,
                                  "y": 0x11, "pivot": [0x140, 0x20]},
                "detail": {"label": {"x": 0xA7, "y": 0x13, "str": esstatus[0x20]},
                           "icon_x": 0xB2, "value_x": 0xC0, "value_y": 0x23},
                # footer plate (clip 0x20 @ (0,0xc2), fold pivot (0,0xd3)):
                # line1 = item desc (or esstatus 0x51 for Unequip), line2 =
                # wield-slot string (0x8009a7c4[item.f2-1], weapon slots only)
                "desc_lines": [{"x": 0x14, "y": 0xC6}, {"x": 0x14, "y": 0xD5}],
                "unequip_desc": esstatus[0x51],
                "wield_names": wield_names,   # index = item equip-kind f2-1
            },
            # RENAMED 2026-09-03 (was "equip_pick"): this object is the SEE
            # DIGIVOLVE screen reached from the status-detail prompt, not an
            # equipment picker. Its pictures come from F0x800895c8 and its text
            # widgets from ctor F0x8008833c (the entry list never named that
            # ctor's siblings; see docs/research/ui/screen-object-methods.md).
            # F0x8008b3c8 picks between this object and the full equip screen.
            "see_digivolve": {
                "_fn": "draw F0x800895c8 + ctor F0x8008833c (states F0x80089bf0)",
                # ── the five fold windows, read off draw F0x800895c8 ──
                # slot = the tween struct in the screen object; the draw guards
                # on slot+8. States F0x80089bf0 opens them name -> list ->
                # panel and swaps list <-> action as the cursor moves in.
                #   +0xac name plate  +0xbc candidate list  +0xcc action pair
                #   +0xdc lower panel +0xec footer plate
                "window": {"pack": "ststat", "clip": 0x24, "x": 0xA8, "y": 0x28,
                           "slot": 0xBC, "pivot": [0x140, 0x44]},
                "window_alt": {"pack": "ststat", "clip": 0x26, "x": 0xA8, "y": 0x28,
                               "slot": 0xCC, "pivot": [0x140, 0x41]},
                # the element icon beside each technique slot, drawn by
                # F0x800895c8 from cmfont clip 0x37 + the technique record's
                # element field, one per slot beside tech_rows
                "tech_icons": {"x": 0xB6, "y_base": 0x88, "pitch": 0xE, "n": 6},
                # The lower panel and everything in it is drawn at a Y OFFSET
                # held in the screen object (+0x8c), the published value of the
                # slide tween at +0x84. It is 0 while the list is up and -0x22
                # (34 px UP) while the footer message or the technique
                # explanation is on screen: F0x80089bf0 runs
                # tween_linear_start(+0x84, 0, -0x22, 4) going in and
                # (-0x22, 0, 4) coming back. F0x800891a4 re-lays every text
                # widget in the panel at that offset each frame.
                "band": {"pack": "ststat", "clip": 0x27, "x": 0x48, "dy": 0x61,
                         "slot": 0xDC, "pivot": [0x140, 0xA2]},
                "label": {"pack": "cmfont", "clip": 0x14, "x": 0x4F, "dy": 0x7C},
                "panel_slide": {"tween": 0x84, "from": 0, "to": -0x22, "steps": 4},
                "header": {"x": 0x98, "y": 0x13},
                # the partner card's name plate this screen draws for itself
                # (F0x800895c8 tail: cmfont clip 0x18 at (0x22, 0x0d))
                # Same clip as every other screen's header plate, but this
                # screen hinges it at y=0x0d, not the 0x19 the sheet and the
                # equip screen use.
                "name_plate": {"pack": "cmfont", "clip": 0x18, "x": 0x22,
                               "y": 0xD, "slot": 0xAC, "pivot": [0x140, 0xD]},
                # the digivolution candidates (F0x8008833c first loop, cursor
                # F0x8001b364 at (0xb0, unk5C * 0xe + 0x31))
                "list_rows": {"x": 0xBD, "y_base": 0x31, "pitch": 0xE, "n": 3,
                              "cursor_x": 0xB0},
                # the action pair under the highlighted candidate: row 0 is
                # esstatus 0x39/0x3A "Battle Digivolve On"/"Off" (F0x8008886c
                # compares the roster current-form field), row 1 is 0x3B
                # "Techique Explanation". Cursor at (0xb4, row * 0xe + 0x3a).
                "action_rows": {"x": 0xBD, "y_base": 0x3A, "pitch": 0xE, "n": 2,
                                "cursor_x": 0xB4,
                                "row0": [esstatus[0x39], esstatus[0x3A]],
                                "row1": esstatus[0x3B]},
                # the highlighted candidate's name. F0x8008886c fills it in
                # the SAME call that fills the two action rows and hides it in
                # the same call that hides them, so it belongs to the action
                # step and is NOT on screen while the candidate list is up
                # (capture 03-choose-digivolve.png shows nothing here).
                "form_name": {"x": 0xB2, "y": 0x2A},
                # the partner's OWN name, in its own plate on the left. The
                # tail of F0x8008865c fills it from the partner record (stride
                # 0x58 at 0x8003ef5c), never from a candidate, and it is on
                # screen whenever the screen is.
                "partner_name": {"x": 0x5E, "y": 0x4D},
                # the stat panel's own header row: the name of whatever the
                # panel is showing, then esstatus 0x38 "Skill LV", then the
                # level. F0x80088a44 fills all three: with a candidate
                # highlighted the name is the CANDIDATE's and the level is the
                # digivolution record's field +2; with none it is the PARTNER's
                # name and esstatus 0x0d "--".
                "panel_row": {"name_x": 0x4F, "label_x": 0xEB, "level_x": 0x12F,
                              "y": 0x68, "label": esstatus[0x38],
                              "level_none": esstatus[0xD]},
                # the same 6 stats + 7 resistances the status sheet shows,
                # in this screen's own columns. F0x80088a44 fills them from the
                # PARTNER's live block; with a candidate highlighted it adds
                # that species record's per-stat field (+2 onward) and per-
                # resistance field (+0xe onward) and clamps each to 999.
                "stat_values": {"x": 0x71, "y_base": 0x7C, "pitch": 0xE, "n": 6},
                "res_values": {"x": 0x9B, "y_base": 0x7C, "pitch": 0xE, "n": 7},
                # six technique slots (names from bank +0xa2): the CANDIDATE's
                # when one is highlighted, the PARTNER's own when none is.
                # They are on screen in every state, not only the technique
                # step (capture 03-choose-digivolve.png shows one filled slot
                # while the candidate list is up).
                "tech_rows": {"x": 0xC4, "y_base": 0x88, "pitch": 0xE, "n": 6,
                              "cursor_x": 0xA9},
                # the blink arrow and the footer bar this screen draws itself
                "blink_arrow": {"pack": "cmfont", "clip": 0xA, "x": 0x123,
                                "y": 0xD6},
                "footer_bar": {"pack": "ststat", "clip": 0x20, "x": 0, "y": 0xC2,
                               "slot": 0xEC, "pivot": [0, 0xD3]},
                # The technique explanation the footer carries, and the MP pair
                # beside it: ctor F0x8008833c builds all three from the shared
                # label table (+0x90, +0x9c, +0xa8) and F0x8008933c fills them
                # from bank 0x9b (explanations), esstatus 3 ("MP") and the
                # technique record's cost byte, the number right-anchored.
                "explanation": rec(0x90),
                "mp_label": dict(rec(0x9C), str=esstatus[3]),
                "mp_value": rec(0xA8),
                # The candidate cursor's HOME position. F0x80089bf0 state 3
                # parks the list cursor at (0x50,0x4d) beside the partner's
                # name; RIGHT (pad bit 5) moves it into the list at
                # (0xb0, 0x31+14i) and LEFT (bit 7) brings it back.
                "cursor_home": {"x": 0x50, "y": 0x4D},
            },
            # SORT (formation change). F0x80096988 draws one marker beside the
            # party cards, CLUT-cycled k=0..7 every 11 vsyncs: clip 0x28 or
            # 0x29 at x 0x93, at y 0x22 while the pick is above and y 0x4f once
            # a second slot is being chosen.
            "sort": {
                "_fn": "draw F0x80096988 + ctor F0x80096590",
                "swap_marker": {"pack": "ststat", "x": 0x93, "y_high": 0x22,
                                "y_low": 0x4F, "clip_a": 0x28, "clip_b": 0x29,
                                "clut_cycle_vsync": 0xB,
                                # the switch in F0x80096988, verbatim: rows are
                                # [unk84, unk88, clip, y]. What unk84 and unk88
                                # index is NOT established, so the walker does
                                # not draw this yet.
                                "rule": [[None, 1, 0x29, 0x22],
                                         [None, "other", 0x28, 0x22],
                                         [1, 0, 0x29, 0x22],
                                         [1, "other", 0x29, 0x4F],
                                         [2, 0, 0x28, 0x22],
                                         [2, "other", 0x29, 0x4F]]},
                "header_plate": {"pack": "cmfont", "clip": 0x18, "x": 0x22,
                                 "y": 0xD, "pivot": [0x140, 0x19]},
                "footer_bar": {"pack": "ststat", "clip": 0x20, "x": 0, "y": 0xC2,
                               "slot": 0xEC, "pivot": [0, 0xD3]},
                # The technique explanation the footer carries, and the MP pair
                # beside it: ctor F0x8008833c builds all three from the shared
                # label table (+0x90, +0x9c, +0xa8) and F0x8008933c fills them
                # from bank 0x9b (explanations), esstatus 3 ("MP") and the
                # technique record's cost byte, the number right-anchored.
                "explanation": rec(0x90),
                "mp_label": dict(rec(0x9C), str=esstatus[3]),
                "mp_value": rec(0xA8),
                # The candidate cursor's HOME position. F0x80089bf0 state 3
                # parks the list cursor at (0x50,0x4d) beside the partner's
                # name; RIGHT (pad bit 5) moves it into the list at
                # (0xb0, 0x31+14i) and LEFT (bit 7) brings it back.
                "cursor_home": {"x": 0x50, "y": 0x4D},
            },
            # RENAMED 2026-08-14 (was "techniques"). This block is the CARD
            # FOLDERS panel: F0x80084238 state 0xA moves its cursor to
            # (0xb8, row * 0xe + 0x3a), which is exactly the numbers below, and
            # F0x80083b58 fills its two rows from esstatus 0x4a "Card Album" and
            # 0x4b "Edit Folder" under header 0xb "CARD FOLDERS".
            # Ledger: UI-PAUSEMENU-CARDFOLDERS-LAUNCH-2026-08-14.
            "cardfolder": {
                "_fn": "draw F0x80083c94 + ctor F0x80083680 (root F0x80084A98)",
                # Fold hinge: F0x80083c94 sets transform_origin(0x140, 0x40)
                # at .L0x00001524 before drawing clip 0x3A.
                "window": {"pack": "ststat", "clip": 0x3A, "x": 0xA8, "y": 0x28,
                           "pivot": [0x140, 0x40]},
                "header": {"x": 0xB2, "y": 0x2A},
                "rows": {"x": 0xC5, "y_base": 0x3A, "pitch": 0xE},
                "cursor_x": 0xB8,
                # Both rows hand a launch code to the resident screen launcher
                # 0x8004b440: 0x1200 = STALBM (card album), 0x400 = STDECK.
                "launch_codes": [0x1200, 0x400],
            },
            # The world MAP screen (draw F0x80098b84, step fn 0x8009913c,
            # cursor/pan F0x80098450, hover F0x80098294, visited filler
            # F0x8009a6b8; decoded + rig-verified 2026-07-11). Art packs:
            # stwmp0 (Asuka) / stwmp1 (Amaterasu), sub 0 = dark base map
            # (one clip, 392x352 + 16px banner above its origin), sub 1 =
            # per-AREA revealed-terrain patch clips (clip = area id - 1,
            # drawn at area_positions[area]), sub 2 = location marker icons
            # + cursor/arrow clips. Reveal = master ordinal [0x8004b370]
            # tier (thresholds below) -> tier_area_lists[server*5+tier].
            # Visited = stored flag 0x2000 | (stage id & 0xff) (resident
            # 0x80048ABC->unk10(lo|0x2000,1) per stage in the server range;
            # a location marker shows when ANY stage mapping to it via
            # stage_to_location is visited). Current-location arrow points
            # at marker[loc] + (12,12) (loc = stage_to_location[stage]),
            # clips 0x3b..0x3d when the cursor is left of it, else
            # 0x35..0x37 (anim +unkA0 0..2). Cursor: icon-pack clip
            # 0x32+anim free / 0x38+anim on a marker, anim table
            # cursor_anim every 4 vsyncs, drawn at marker+(12,12) when
            # locked. Hover hit box = marker+(7..18) square; hover plays
            # SFX 0x4001c and shows the name window (ststat clip 0x3b at
            # y=0x14, or y=0xb4 when the cursor is in the top half; text
            # at (0x10, 0x19|0xb9), string = esaskmap/esamtmap[record #]).
            # Pan (F0x80098450): cursor free-moves x 0x16..0x12a,
            # y 0xf..0xc2; crossing screen center (x=0xa0 / y=0x78)
            # scrolls the map instead, scroll_x 0..-0x48, scroll_y
            # 0..-0x60; speed = 2 on press, +1/vsync held, capped 4.
            # Map body drawn at (scroll_x, scroll_y + 0x10).
            "map": {
                "_fn": "draw F0x80098b84 + step 0x8009913c",
                "origin_y": 0x10,
                "tier_thresholds": [7, 0xF, 0x1B, 0x1E],
                "tier_area_lists": tier_lists,   # [server*5 + tier]
                "area_positions": area_pos,      # area id -> [x, y]
                "markers": markers,              # {loc, clip, x, y} 1..46
                "stage_to_location": stage_loc,  # PS1 stage id -> marker loc
                "walker_map": walker_map,        # walker sNNN -> {ps1,server,loc}
                "location_names": loc_names,     # esaskmap/esamtmap strings
                "visited_flag_base": 0x2000,     # flag 0x2000|(stage&0xff)
                "cursor": {"anim": [w(MAP_CURSOR_ANIM + i * 4) for i in range(4)],
                           "anim_vsync": 4, "free_clip": 0x32, "lock_clip": 0x38,
                           "lock_offset": 0xC,
                           "x_min": 0x16, "x_max": 0x12A, "y_min": 0xF,
                           "y_max": 0xC2, "pan_x": 0xA0, "pan_y": 0x78,
                           "scroll_x_min": -0x48, "scroll_y_min": -0x60,
                           "speed_initial": 2, "speed_max": 4},
                "current_arrow": {"clip_left": 0x3B, "clip_right": 0x35,
                                  "anim_frames": 3, "anim_vsync": 4,
                                  "offset": [0xC, 0xC]},
                "hover": {"box_min": 7, "box_max": 0x12, "sfx": 0x4001C,
                          "window": {"pack": "ststat", "clip": 0x3B, "x": 0,
                                     "y_top": 0x14, "y_bottom": 0xB4},
                          # F0x8009913c builds this widget at (0x14,0x16) and
                          # F0x80098294 immediately moves it to one of the two
                          # positions below, so the build position never shows.
                          "text": {"x": 0x10, "y_top": 0x19, "y_bottom": 0xB9,
                                   "ctor_x": 0x14, "ctor_y": 0x16}},
            },
        },
    }

    OUT.write_text(json.dumps(ui, indent=1) + "\n")
    n = len(portraits)
    print(f"wrote {OUT.relative_to(ROOT)} ({n} portrait sequences, "
          f"menu window clips {menu_window_clips})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
