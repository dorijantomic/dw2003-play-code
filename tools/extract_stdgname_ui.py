#!/usr/bin/env python3
"""
Extract the STDGNAME name-entry UI chrome (new-game naming + DRI Digimon
rename share one overlay/screen — see web/game.js hooks on `nameentry` /
bank 0x7c index 1).

Decode source (see docs/research/ui/stdgname-decoded-2026-07-11.md):
  ~/ddw3/asm/dw2003/pro/stdgname.s        — overlay, RAM base 0x80082cb0
  exe-decomp/stdgname_c/                  — m2c decompile (52/60 ok)
  ~/ddw3/lang_file/dw2003/eng/esnamedt.toml — the 3 character-grid pages,
                                              button-hint strings, validation
                                              message (string table used by
                                              this overlay)
  ~/ddw3/rust/dw2003_exe_data/src/lba.rs  — LBA_STDGNMCS_BIN_IDX=648,
                                              LBA_STDGNMTM_BIN_IDX=649 (pack
                                              handle = LBA idx << 16, proven
                                              by `lui $a0, 0x288` / `0x289` in
                                              stdgname.norm.s L2804/L3797)

Every literal below carries a `disasm:` provenance comment citing the exact
source function + stdgname.s line it was read from. Nothing here is guessed;
values NOT resolvable from static evidence are omitted and flagged as an open
gap in the companion doc instead (see "OPEN GAPS" there) rather than filled
with a plausible number.

Output: web/assets/data/stdgname_ui.json
"""
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
NAMEDT_TOML = DDW3 / "lang_file/dw2003/eng/esnamedt.toml"
STDGNAME_ASM = DDW3 / "asm/dw2003/pro/stdgname.s"
NAMEDT_SHEET = ROOT / "web/assets/ui/namedt_sheet.json"
OUT = ROOT / "web/assets/data/stdgname_ui.json"

OVERLAY_BASE = 0x80082CB0

# ---------------------------------------------------------------------------
# String table (esnamedt.toml, authority=4 original_strings; ledger evidence
# SRC-506a08577676). Index -> role, established by cross-referencing the grid
# glyph counts (5 cols x N rows, exactly matching the '\n'-joined runs) and
# the button-hint labels against the F0x80083478 widget ctor call order.
# ---------------------------------------------------------------------------
STRING_ROLES = {
    0: "unused_empty",
    1: "title",              # "Enter Name"
    2: "unused_template_a",  # placeholder "AAAAA..." blocks (7 lines) - role
    3: "unused_template_b",  # unresolved; not referenced by any decoded draw
    4: "unused_template_c",  # fn in stdgname_c. Left unused by this screen.
    5: "unused_template_d",
    6: "unused_template_e",
    7: "unused_template_f",
    8: "grid_upper",   # "ABCDE\nFGHIJ\nKLMNO\nPQRST\nUVWXY\nZ"
    9: "grid_lower",   # "abcde\nfghij\nklmno\npqrst\nuvwxy\nz"
    10: "grid_symbol",  # "01234\n56789\n-~・?!"
    11: "default_name",  # "Junior"
    12: "cursor_glyph_a",   # "a" — exact use unresolved (open gap)
    13: "hint_arrow_left",  # "[arrow-left]"
    14: "hint_arrow_right",  # "[arrow-right]"
    15: "cursor_glyph_b",   # "a" — exact use unresolved (open gap)
    16: "hint_l1",  # "L1"
    17: "hint_r1",  # "R1"
    18: "validation_message",  # "That name is not allowed."
}


def load_strings():
    text = NAMEDT_TOML.read_text(encoding="utf-8")
    # esnamedt.toml is `strings = ["...", "...", ...]`; TOML-parse the array
    # by hand (tomllib chokes on the bare unescaped newlines the dumped file
    # uses inside its \n-escaped strings — but these ARE escaped \n, so a
    # plain toml parser is fine; avoid the extra dependency and parse simply).
    import re
    body = text[text.index("[") + 1: text.rindex("]")]
    items = []
    for m in re.finditer(r'"((?:[^"\\]|\\.)*)"', body, re.S):
        # Only \n is escaped in this file; literal UTF-8 (e.g. the "・"
        # separator in the symbol grid) must NOT go through a byte-oriented
        # unicode_escape decode (that mangles multi-byte UTF-8 sequences).
        items.append(m.group(1).replace("\\n", "\n"))
    return items


def grid_from_string(s: str):
    rows = s.split("\n")
    return rows


PACK = {
    "cs": {"name": "STDGNMCS", "lba_idx": 648, "handle": 0x02880000,
           "disasm": "stdgname.norm.s L2804 `lui $a0, 0x288` "
                     "(F0x80083994 draw-ctx setup, ~stdgname.s L0x2aa4)"},
    "tm": {"name": "STDGNMTM", "lba_idx": 649, "handle": 0x02890000,
           "disasm": "stdgname.norm.s L3797 `lui $a0, 0x289` "
                     "(F0x80083994 body, ~stdgname.s L0x3998)"},
}

# ---------------------------------------------------------------------------
# CHROME — every entry cites the exact draw-ctx-owning function + line.
# ---------------------------------------------------------------------------
CHROME = {
    # F0x80086368 (stdgname.s L3509 .L0x000036b8): draw-ctx owner. Draws a
    # full-frame background (clip 0x31=49, pos (0,0), src mode sp84(0x280,0)
    # i.e. screen-pack src) then a second clip (0x24=36) at a position that
    # tracks a 0..0x5F (95) sawtooth counter `arg0->unk58`, x==y each frame
    # (stdgname.s L0x000036e4-L0x00003764). Exact visual role of the 0x24
    # clip (moving highlight vs. scan-line sweep) is NOT resolved from static
    # evidence alone -- flagged open in the doc.
    "background": {
        "clip": 49, "x": 0, "y": 0,
        "disasm": "F0x80086368 stdgname.s L0x00003708-L0x00003724",
    },
    "diagonal_sweep_clip": {
        "clip": 36, "range": [0, 0x5F],
        "note": "x==y==counter; exact semantic unresolved (open gap)",
        "disasm": "F0x80086368 stdgname.s L0x00003728-L0x00003764",
    },
    # F0x8008559c (stdgname.s L2638 .L0x0000291c): draw-ctx owner, draws the
    # 3-entry hint-icon table @ D0x80087BC4 (7 u32 words/entry: clip, ?,
    # x0, y0, x1, y1, flag) -- x/y pair chosen by whether the widget's own
    # scale (unk88) != 0x1000 (i.e. mid-tween). Raw table dumped verbatim
    # via `tools/overlay_scan.py words stdgname 0x80087bc4 0x80087c18`.
    "hint_icons": {
        "disasm": "3-entry table at D0x80087BC4 (7 u32 per entry: clip, ?, x0, "
                  "y0, x1, y1, flag), drawn by the draw-ctx owner F0x8008559c "
                  "(stdgname.s L2638, .L0x0000291c); the x/y pair used depends "
                  "on whether the widget's own scale (unk88) differs from "
                  "0x1000, i.e. whether it is mid-tween. Table dumped verbatim "
                  "with `tools/overlay_scan.py words stdgname 0x80087bc4 "
                  "0x80087c18`.",
        "entries": [
            {"clip": 0x1D, "x": 0x18, "y": 0x15, "x_alt": 0x18, "y_alt": 0x20,
             "special": False},
            {"clip": 0x23, "x": 0xC6, "y": 0xC0, "x_alt": 0x140, "y_alt": 0xCE,
             "special": False},
            {"clip": 0x20, "x": 0x1C, "y": 0x31, "x_alt": 0x6D, "y_alt": 0x47,
             "special": True,
             "note": "unk0==0x20 -> CLUT-cycled draw, y offset += "
                     "D0x80087F38.unk4*0x2B per active page"},
        ],
    },
    # D0x80087D68 (4x (x,y) pairs) -- typed-character preview row anchors,
    # consumed by F0x8008559c's second loop (arg0->unk78 letters, per-column
    # step var_s5 += 0x2B == 43px) and third loop (label pair clip 0x1F then
    # 0x1E per typed char, same 0x2B column step).
    "preview_row_anchors": {
        "disasm": "four (x,y) pairs at D0x80087D68, consumed by F0x8008559c's "
                  "second loop (arg0->unk78 letters, per-column step "
                  "var_s5 += 0x2B) and its third loop (label pair clip 0x1F "
                  "then 0x1E per typed character, same column step).",
        "entries": [
            {"x": 0x20, "y": 0x35}, {"x": 0x20, "y": 0x4F},
            {"x": 0x20, "y": 0x2E}, {"x": 0x20, "y": 0x49},
        ],
    },
    "preview_column_pitch": {
        "value": 0x2B,
        "disasm": "var_s5 += 0x2B (43px) per column in both preview loops of "
                  "F0x8008559c.",
    },
    # D0x80087E58 -- per-page (upper/lower/symbol=0/1/2, 7 columns each)
    # CMFONTCS clip lookup for the typed-name preview glyphs; -1 = blank.
    # Raw dump via `tools/overlay_scan.py words stdgname 0x80087e58 0x80087ea0`.
    "preview_glyph_clip_table": {
        "cols": 7,
        "rows": [
            [7, 8, 9, 10, 9, 8, -1],
            [14, 15, 16, 15, -1, -1, -1],
            [-1, 11, 12, 13, 12, -1, -1],
        ],
        "disasm": "D0x80087E58, consumed F0x8008559c stdgname.s L0x00002988+",
    },
    # F0x80083478 (stdgname.s L505 .L0x000007c8): widget ctor for the static
    # text labels. Anchors are literal args to F0x8001ae38(handle,kind,x,y).
    "labels": [
        {"role": "title", "x": 0x20, "y": 0x1A, "kind": 1, "clut": 4,
         "disasm": "F0x80083478 stdgname.s L0x00000804 (call site 1/8); unk138(4)"},
        {"role": "subtitle", "x": 0x4B, "y": 0x40, "kind": 1,
         "disasm": "F0x80083478 stdgname.s L0x00000830 (call site 2/8)"},
        {"role": "page_tab_0", "x": 0x2F, "y": 0x5B, "kind": 1,
         "disasm": "F0x80083478 stdgname.s L0x0000087c (call site 3/8, "
                   "do-while loop iter 0)"},
        {"role": "page_tab_1", "x": 0x7D, "y": 0x5B, "kind": 1,
         "disasm": "F0x80083478 stdgname.s L0x0000087c (loop iter 1, "
                   "+0x4E0000 per iter)"},
        {"role": "page_tab_2", "x": 0xCB, "y": 0x5B, "kind": 1,
         "disasm": "F0x80083478 stdgname.s L0x0000087c (loop iter 2)"},
        {"role": "hint_right_a", "x": 0xCE, "y": 0xC6, "kind": 1,
         "disasm": "F0x80083478 stdgname.s L0x000008f8 (call site 4/8)"},
        {"role": "hint_right_b", "x": 0xE1, "y": 0xC6, "kind": 1,
         "disasm": "F0x80083478 stdgname.s L0x00000910 (call site 5/8)"},
        {"role": "side_panel_left", "x": 0x13, "y": 0x62, "kind": 1,
         "disasm": "F0x80083478 stdgname.s L0x00000928 (call site 6/8)"},
        {"role": "side_panel_right", "x": 0x123, "y": 0x62, "kind": 1,
         "disasm": "F0x80083478 stdgname.s L0x00000958 (call site 7/8)"},
        {"role": "center_label", "x": 0x3E, "y": 0x72, "kind": 1,
         "disasm": "F0x80083478 stdgname.s L0x00000988 (call site 8/8)"},
    ],
    # The shared NAMEDT keyboard, drawn by stplnmet F0x8008438c and by
    # stcrddek F0x80086e04 (folder rename). Hand-transcribed from those
    # two routines; kept HERE rather than in the shipped json because a
    # rerun of this tool overwrites the json, and this block was lost
    # that way once already.
    "namedt_overlay": {
        "note": "NAMEDTCS draws from stplnmet F0x8008438c (exe-decomp/stplnmet_c/F0x8008438c.c, handle 0x07700000). Title-bar xy matches stdgname hint_icons[0]; name-box xy matches the subtitle label and F0x80083478/F0x80083e70 unk140 pitch 0x13. Portrait fallback is the unk64==-1 clip.",
        "disasm": "F0x8008438c stplnmet.s / exe-decomp/stplnmet_c/F0x8008438c.c",
        "title_bar": {
            "clip": 29,
            "x": 24,
            "y": 21,
            "disasm": "sp94(0x07700000, 0x1D, 0x18, 0x15)"
        },
        "portrait_frame": {
            "clip": 30,
            "clip_shimmer": 31,
            "x": 32,
            "y": 46,
            "w": 40,
            "h": 38,
            "disasm": "sp94(0x07700000, 0x1E, 0x20, 0x2E) then 0x1F at the same origin"
        },
        "portrait_fallback": {
            "clip": 54,
            "x": 32,
            "y": 46,
            "disasm": "unk64==-1 branch: sp94(0x07700000, 0x36, 0x20, 0x2E)"
        },
        "portrait_anim": {
            "x": 34,
            "y": 48,
            "disasm": "unk64!=-1 branch: clip from 0x80089934 at (0x22, 0x30)"
        },
        "name_boxes_english": {
            "clip": 55,
            "x": 75,
            "y": 64,
            "pitch": 19,
            "w": 20,
            "h": 20,
            "count": 8,
            "disasm": "language!=0: sp94(0x07700000, 0x37, 0x4B, 0x40); pitch from unk140(0x13, 0)"
        },
        "name_boxes_japanese": {
            "clip": 52,
            "x": 75,
            "y": 64,
            "pitch": 19,
            "w": 20,
            "h": 20,
            "count": 5,
            "disasm": "language==0: sp94(0x07700000, 0x34, 0x4B, 0x40)"
        },
        "name_cursor": {
            "clip": 40,
            "y": 64,
            "pitch": 19,
            "disasm": "sp94(0x07700000, 0x28, unk90*0x13+0x4B, 0x40)"
        },
        "grid_frame": {
            "clip": 37,
            "x": 29,
            "y": 84,
            "disasm": "sp94(0x07700000, 0x25, 0x1D, 0x54) -- the 15x7 cell atlas"
        },
        "name_boxes_ten": {
            "clip": 53,
            "x": 75,
            "y": 64,
            "pitch": 19,
            "w": 20,
            "h": 20,
            "count": 10,
            "disasm": "unk50 == 2 branch: sp94(0x07700000, 0x35, 0x4B, 0x40). The ten-box plate the folder rename uses; language does not select it, the caller's mode does."
        },
        "message_bar": {
            "clip": 38,
            "x": 0,
            "y": 100,
            "pivot": [
                0,
                120
            ],
            "disasm": "unk48C fold: sp9C(0x1000, unk48C, 0x1000), spA4(0, 0x78), sp94(0x07700000, 0x26, 0, 0x64)"
        },
        "page_arrows": {
            "clip_left": 50,
            "left_x": 10,
            "left_y": 94,
            "clip_right": 51,
            "right_x": 281,
            "right_y": 94,
            "clut_table": "0x8008B818",
            "clut_entries": 6,
            "clut_step_vsync": 7,
            "shown_when_pages_at_least": 2,
            "disasm": "gated on [0x8008B848] >= 2. F0x800884e8 writes that word: 3 when the language index at 0x8005CCA8 is 0 (Japanese), else 1 -- so in English the keyboard has ONE page and these arrows never appear."
        }
    },
}

# Screen-lifecycle dispatch table: overlay file offset 0x0 (RAM 0x80082cb0),
# 135 x u32 function-pointer entries (`.word F0x........`), read as a state
# index -> handler jump table (same shape as stitshop's 204-entry dispatch --
# shop-system-decompiled.md). Handler frequency: F0x80084370 x92 (dominant
# "idle/main" handler), F0x80083bac x30, F0x80084d74 x29, F0x80086090 x2, and
# ~13 handlers used exactly once each (the distinct one-shot actions -- e.g.
# F0x800860c0/861d4/861f4/8621c/86270 are a fold-in-wait SEQUENCE: each bumps
# a `saved_reg_s3->unk10` sub-state counter by 1 once its precondition (a
# window-fold-done poll via D0x80087F38.unk14, or a data-ready check) is met
# -- structurally the same "open -> wait -> ready" pattern as shop's
# submenu_wait/submenu_ready, not a per-grid-cell handler. Whether this table
# is a SCREEN lifecycle FSM (open/fold/ready/close) or is ALSO reused to
# dispatch per-grid-cell input is not resolved -- see open_gaps.
DISPATCH_TABLE = {
    "file_offset": "0x0", "ram": "0x80082cb0", "entries": 135,
    "entry_size": 4,
    "handler_histogram": {
        "0x80084370": 92, "0x80083bac": 30, "0x80084d74": 29,
        "0x80086090": 2,
    },
    "disasm": "stdgname.s L6-L546 (raw .word table at file start)",
}

GRID_COLS = 5  # literal from every grid_* string's row width -- this is the
               # esnamedt CHARACTER INVENTORY row width (26 letters wrapped 5
               # per line), NOT the on-screen keyboard geometry. The real
               # interactive grid is 15 cols x 7 rows (see INTERACTIVE_GRID).

# INTERACTIVE_GRID -- the real cursor coordinate system, decoded 2026-07-14 by
# hand-transcribing F0x80083994 (render/dispatch) + the movement handler at
# F0x8008..0x800845f0-0x80084b10. Authority=2 (original assembly); still
# `partially_verified` pending a rig pixel-compare. This supersedes the old
# "col*18+90, geometry NOT resolved" open gap.
#
# Fields on the screen object ($s2 in render / $s1 in movement, same object):
#   +0x9c = cursor column, wraps 0..14  (movement `slti 0xf` @0x80084910;
#           decrement wraps to 0xe @0x800847d4) -> 15 columns.
#   +0xa0 = cursor row, wraps 0..6      (down `slti 7`,sw$zero @0x80084af0;
#           up wraps to 6 @0x800846ac) -> 7 rows.
#   +0xb0 = section/plane index (validity-map stride page*210). NOT a charset
#           page: the rig framebuffer (save state 5) proves upper/lower/symbol
#           render as 3 SIMULTANEOUS column-groups (cols 0-4 / 5-9 / 10-14),
#           not switchable pages. The 3 map planes index some other section
#           (wizard step, unconfirmed) -- do not label them upper/lower/symbol.
#
# Per-cell validity/linkage map: a u16[] whose base pointer is stored at
# [0x80048e34 + 8] (resident, loaded from STDGNMCS data). Cell index =
#   page*210 + (row*15 + col)*2   (bytes; 7*15=105 u16 cells per page).
# A cell value of 1 = a real single-width key; a NEGATIVE value = a wide key
# whose left edge is `col + value` columns back (movement adds it to snap the
# cursor onto the key's origin). Cells with 0 are empty gaps. The exact
# per-cell glyph binding lives in this runtime map, NOT decoded statically --
# extracting STDGNMCS is the remaining blocker before the walker can render
# the native letter layout (see open_gaps).
#
# Cursor sprite geometry (render block A, stdgname.s L0x00000df0-L0x00000e58,
# DRAW = sp94(pack,clip,x,y), so a2=x a3=y). The `floor(col/5)` term is the
# div-by-5 reciprocal idiom (`mult 0x66666667; mfhi; sra 1`) confirmed at
# f000dfc-f000e48 -- it inserts an 8px gap every 5 columns, so the 15 columns
# render as 3 visual groups of 5 (matching the 5-wide character inventory):
#   x = col*14 + floor(col/5)*8 + 47
#   y = row*18 + 90
# cursor clip = 0x27, drawn from the NAMEDTCS chrome pack (handle 0x07700000,
# resolved via [0x80044f5c]) -- note the letters/backdrop use STDGNMCS/TM
# (0x288/0x289) but the cursor + button chrome come from NAMEDTCS.
#
# Action-key (function-key) region: render builds a linear index
# `col' + row*15` (col' = validity-snapped column), subtracts 0x46 (70), and
# `sltiu 0x22` gates a 34-entry jump table (stdgname.s L0x00000ee0, base
# words at F0x800843b8-rel). So linear cells 70..103 (rows 4..6, right-hand
# columns) are the OK/DEL/space/page action keys; cells 0..69 are the
# character keys. Individual jump-table case semantics (which action each of
# the 34 cells performs) are only partially sampled -- see open_gaps.
INTERACTIVE_GRID = {
    "cols": 15,
    "rows": 7,
    "pages": 3,
    "field_col": "0x9c", "field_row": "0xa0", "field_page": "0xb0",
    "col_wrap": "0..14 (slti 0xf @0x80084910; dec wraps to 0xe @0x800847d4)",
    "row_wrap": "0..6 (down slti 7,sw zero @0x80084af0; up wraps to 6 @0x800846ac)",
    "validity_map": {
        "base_ptr": "[0x80048e34 + 8]",
        "kind": "u16 per cell",
        "index": "page*210 + (row*15 + col)*2",
        "cells_per_page": 105,
        "value_1": "real single-width key",
        "value_negative": "wide key; left edge is col+value (movement snaps to origin)",
        "value_0": "empty gap",
        "note": "per-cell glyph binding is in this runtime STDGNMCS buffer, "
                "NOT decoded statically -- extracting STDGNMCS is the blocker "
                "for native letter rendering.",
    },
    "cursor_geometry": {
        "x": "col*14 + floor(col/5)*8 + 47",
        "y": "row*18 + 90",
        "verified": "rig framebuffer save state 5: rows y=90/108/126/144/162/"
                    "180/198, uppercase cols x=47/61/75/89/103, lowercase "
                    "group at x=125 -- exact match.",
        "x_note": "floor(col/5) via div-by-5 reciprocal (mult 0x66666667; "
                  "mfhi; sra 1) = 8px gap every 5 cols -> 3 groups of 5",
        "clip": "0x27",
        "pack": "NAMEDTCS 0x07700000 (via resolver [0x80044f5c])",
        "disasm": "F0x80083994 render block A, stdgname.s L0x00000df0-L0x00000e58",
    },
    "action_key_region": {
        "linear_index": "col + row*15",
        "range": "70..103 (34 cells, rows 4..6 right columns)",
        "dispatch": "sltiu 0x22 -> 34-entry jump table @stdgname.s L0x00000ee0 "
                    "(base words at F0x800843b8-rel); char keys = cells 0..69",
        "semantics": "RESOLVED 2026-08-14 -- every case is decoded; see "
                     "`action_keys` for the five keys, their origin cells, "
                     "clips and draw positions.",
    },
    "glyph_layout": {
        "note": "Full cell->glyph map read directly from the rig framebuffer "
                "(save state 5). 15 cols x 7 rows; '.' = empty cell. Cols 0-4 "
                "= uppercase, 5-9 = lowercase, 10-14 = digits/symbols + wide "
                "action keys (DEL/SPC span multiple cols; arrows + OK on the "
                "bottom action row). This is the authentic keyboard.",
        "rows": [
            "A B C D E   a b c d e   0 1 2 3 4",
            "F G H I J   f g h i j   5 6 7 8 9",
            "K L M N O   k l m n o   - ~ . ? !",
            "P Q R S T   p q r s t   . . . . .",
            "U V W X Y   u v w x y   [ DEL ...]",
            "Z . . . .   z . . . .   [ SPC ...]",
            ".  .  .  .   . . . . .   <- -> [OK]",
        ],
        "row_correction": "CORRECTED 2026-08-14. The action keys were "
                          "previously transcribed onto rows 3/4/5 by eye from "
                          "the framebuffer capture. Their sprites are drawn at "
                          "y=153/174/195 while the character rows sit at "
                          "y=144/162/180/198, so each button straddles two "
                          "rows and the transcription came out one row high. "
                          "The dispatch index (origin_col + row*15 - 0x46, "
                          "range 0..33) is unambiguous and puts the origins on "
                          "rows 4, 5 and 6; row 3 of cols 10..14 is a spacer. "
                          "The drawn positions themselves are unchanged and "
                          "still match the capture exactly.",
    },
    "status": "verified (authority=1 runtime framebuffer compare, "
              "SLES03936.sstate5): rows measured at y=90,108,126,144,162,180,"
              "198 = row*18+90; uppercase cols at x=47,61,75,89,103 = "
              "col*14+47; lowercase group starts at x=125 = 5*14+8+47, "
              "confirming the floor(col/5)*8 group gap. Note: the savestate "
              "runs the stplnmet wizard overlay, which renders the identical "
              "shared keyboard chrome (NAMEDTCS), so this verifies the shared "
              "layout that stdgname's F0x80083994 also produces.",
    "disasm": "F0x80083994 (render/dispatch) + movement handler "
              "0x800845f0-0x80084b10, stdgname.s",
}


# ---------------------------------------------------------------------------
# Action keys (DEL / SPC / name-cursor arrows / OK), decoded 2026-08-14 from
# F0x80083994's action-region branch. This closes open gap (b): the 34-entry
# jump table's case semantics.
#
# How the render/dispatch path works (stdgname.s, overlay base 0x80082cb0):
#
#   L0x00000dc4  a3 = obj+0x9c (col); `slti $a3, 0xa` -> cols 0..9 take the
#                plain-character path (block A: draw cursor clip 0x27 at
#                cellX/cellY). Only cols >= 10 continue.
#   L0x00000dd8  a2 = obj+0xa0 (row); `slti $a2, 0x3` -> rows 0..2 also take
#                the plain path. So the action region is cols>=10 AND rows>=3.
#   L0x00000e5c  t0 = [0x80088e3c] + page*210 -- the same per-cell validity map
#                the movement handler walks (u16 per cell, 105 cells/page).
#   L0x00000e94  scan LEFT along the row (a1 starts 0, decrements) until the
#                cell's low byte == 1. Byte 1 marks a key's ORIGIN cell, so a
#                key wider than one column resolves to its leftmost cell.
#   L0x00000eb8  index = (col + a1) + row*15 - 0x46, gated `sltiu 0x22`:
#                34 in-range origin cells, 70..103.
#   L0x00000ee4  jr through the 34-word table at overlay file 0x0.
#   L0x00000f5c  every case converges here: draw record[s0] of the 5 x 12-byte
#                table at 0x80087b70 (file 0x4ec0) as (clip, x, y) through the
#                NAMEDTCS pack (handle 0x07700000 via resolver [0x80044f5c]).
#
# Three of the five records have their clip word rewritten at dispatch time
# with `[0x8005cca8] + K` (K = 0x3c / 0x44 / 0x4c at L0x00000f1c / f38 / f54),
# where 0x8005cca8 is the language/region selector. The shipped table already
# holds those same K values, i.e. the static image is the language-0 clip. The
# sprite sheet corroborates the mechanism exactly: clips 0x3c..0x42, 0x44..0x4a
# and 0x4c..0x52 are three blocks of SEVEN, one per language, and the art reads
# (in order) delete/space/OK in Japanese, English, English, French, Italian,
# German, Spanish.
JUMP_TABLE_OFF = 0x0        # 34 x u32, stdgname.s L6..L138
JUMP_TABLE_LEN = 0x22       # `sltiu $v0, $v1, 0x22` @L0x00000ed4
CELL_INDEX_BIAS = 0x46      # `addiu $v1, -0x46` @L0x00000ed0
DRAW_RECORD_OFF = 0x4EC0    # 5 x 3 x u32 @RAM 0x80087b70, stdgname.s L5044..
DRAW_RECORD_COUNT = 5

# Jump-table target -> the `li $s0, N` it executes, i.e. which draw record the
# converged tail selects. Read from stdgname.s L0x00000efc..L0x00000f5c.
CASE_TARGETS = {
    0x80083BAC: 0,   # `move $s0, $zr`            L0x00000efc
    0x80083BB4: 1,   # `li $s0, 0x1`              L0x00000f04
    0x80083BBC: 2,   # `li $s0, 0x2` + clip patch L0x00000f0c
    0x80083BD8: 3,   # `li $s0, 0x3` + clip patch L0x00000f28
    0x80083BF4: 4,   # `li $s0, 0x4` + clip patch L0x00000f44
}
# Which record each language-patch site rewrites, and with what addend.
CLIP_PATCH = {2: 0x3C, 3: 0x44, 4: 0x4C}
# Roles, from the extracted NAMEDTCS art of each 7-clip language block.
CASE_ROLES = {
    0: ("cursor_left", "[arrow-left]"),
    1: ("cursor_right", "[arrow-right]"),
    2: ("delete", "DEL"),
    3: ("space", "SPC"),
    4: ("confirm", "OK"),
}
# Language index -> pack, already decoded for the cnty_sel selector that writes
# this very global (`./dw3-research languages`, global D0x8005cca8). Reading the
# rendered clips of blocks 0x3c..0x42 and 0x44..0x4a reproduces that table
# independently, which is the corroboration this decode rests on: 0 JPN
# (さくじょ / くうはく), 1 USA and 2 ENG (DEL / SPC, pixel-identical), 3 FRA
# ("EFF" effacer / "ESP" espace), 4 ITA ("CAN." cancella / "SPZ." spazio),
# 5 GER ("Ent" Entfernen / "LT" Leertaste), 6 SPN ("BOR." borrar / "ESP."
# espacio).
LANGUAGE_ORDER = ["jpn", "usa", "eng", "fra", "ita", "ger", "spn"]
LANGUAGE_ENGLISH = 2  # the `eng` pack, which is what the walker ships


def _overlay_words(count_by_offset):
    """Read raw `.word` values out of stdgname.s at given overlay file offsets.

    The dumped assembly writes data either as a bare `.word 0x...` or as a
    decoded instruction with the encoding in a trailing `# .word 0x...`
    comment; both forms carry the same 32-bit value.
    """
    wanted = set()
    for off, n in count_by_offset:
        wanted.update(off + 4 * i for i in range(n))
    words = {}
    label = re.compile(r"^\.L0x([0-9a-fA-F]{8}):")
    bare = re.compile(r":\s*\.word\s+(0x[0-9a-fA-F]+)")
    trail = re.compile(r"#\s*\.word\s+(0x[0-9a-fA-F]+)")
    for line in STDGNAME_ASM.read_text(encoding="utf-8", errors="replace").splitlines():
        m = label.match(line.strip())
        if not m:
            continue
        off = int(m.group(1), 16)
        if off not in wanted:
            continue
        hit = bare.search(line) or trail.search(line)
        if hit:
            words[off] = int(hit.group(1), 16)
    missing = wanted - set(words)
    if missing:
        raise SystemExit(
            f"stdgname.s: missing {len(missing)} word(s), first at "
            f"0x{min(missing):08x}")
    return words


def _clip_sizes():
    """clip id -> (w, h) from the extracted NAMEDTCS sheet, when available."""
    if not NAMEDT_SHEET.exists():
        return {}
    sheet = json.loads(NAMEDT_SHEET.read_text(encoding="utf-8"))
    sizes = {}
    for key, clip in sheet.items():
        if not key.isdigit():
            continue  # frame variants ("44#1", ...); the base key carries the size
        layers = (clip or {}).get("layers") or []
        if len(layers) != 1:
            continue
        sizes[int(key)] = (layers[0]["w"], layers[0]["h"])
    return sizes


def action_keys():
    words = _overlay_words([(JUMP_TABLE_OFF, JUMP_TABLE_LEN),
                            (DRAW_RECORD_OFF, DRAW_RECORD_COUNT * 3)])
    sizes = _clip_sizes()

    records = []
    for i in range(DRAW_RECORD_COUNT):
        base = DRAW_RECORD_OFF + i * 12
        records.append({
            "clip": words[base], "x": words[base + 4], "y": words[base + 8]})

    # Origin cell -> case. Only cells whose jump-table word is not the default
    # target are real keys; the rest are never reached, because a non-origin
    # cell resolves leftward onto its own origin first.
    default_target = min(CASE_TARGETS, key=lambda a: CASE_TARGETS[a])
    origins = []
    for i in range(JUMP_TABLE_LEN):
        target = words[JUMP_TABLE_OFF + 4 * i]
        if target not in CASE_TARGETS:
            raise SystemExit(f"stdgname.s: unknown jump target 0x{target:08x}")
        if target == default_target:
            continue
        cell = i + CELL_INDEX_BIAS
        origins.append((cell, CASE_TARGETS[target]))
    # Record 0 is also the tail's default, so the key that uses it has no
    # distinguishing table entry; its own draw position identifies it. It is
    # the one remaining origin on the bottom action row, left of the first
    # tabled origin on that row.
    rows_with_keys = {cell // 15 for cell, _ in origins}
    bottom = max(rows_with_keys)
    first_on_bottom = min(cell for cell, _ in origins if cell // 15 == bottom)
    origins.append((first_on_bottom - 1, 0))
    origins.sort()

    by_row = {}
    for cell, _ in origins:
        by_row.setdefault(cell // 15, []).append(cell % 15)
    keys = []
    for cell, case in origins:
        row, col = divmod(cell, 15)
        siblings = sorted(by_row[row])
        nxt = next((c for c in siblings if c > col), 15)
        role, label = CASE_ROLES[case]
        rec = records[case]
        entry = {
            "role": role, "label_eng": label,
            "cell": cell, "row": row, "col": col,
            "col_span": [col, nxt - 1],
            "x": rec["x"], "y": rec["y"],
            "clip": rec["clip"],
        }
        if case in CLIP_PATCH:
            entry["clip_base"] = CLIP_PATCH[case]
            entry["clip_per_language"] = True
            entry["clip_english"] = CLIP_PATCH[case] + LANGUAGE_ENGLISH
        else:
            entry["clip_per_language"] = False
            entry["clip_english"] = rec["clip"]
        if entry["clip_english"] in sizes:
            entry["w"], entry["h"] = sizes[entry["clip_english"]]
        keys.append(entry)

    return {
        "note": "The five keys of the right-hand action column. `x`/`y` are "
                "the highlight sprite's own top-left, NOT cellX/cellY -- the "
                "buttons use a 21px pitch of their own (153/174/195) while the "
                "character cells use 18px (row*18+90). Confirmed against the "
                "rig framebuffer capture web/assets/ref/keyboard.png: the "
                "three button rows' top borders sit at y=153/174/195 and the "
                "bottom row's three sprite origins show as single lit pixels "
                "at x=203/222/246, y=211.",
        "region": "col >= 10 and row >= 3 (slti 0xa @L0x00000dc4, "
                  "slti 0x3 @L0x00000dd8)",
        "origin_scan": "walk left along the row until the validity map's low "
                       "byte is 1 (L0x00000e94-L0x00000eb4), so a wide key is "
                       "always dispatched from its leftmost column",
        "index": "(origin_col + row*15) - 0x46, gated sltiu 0x22",
        "jump_table": {"file_offset": hex(JUMP_TABLE_OFF),
                       "ram": hex(OVERLAY_BASE + JUMP_TABLE_OFF),
                       "entries": JUMP_TABLE_LEN},
        "draw_records": {"file_offset": hex(DRAW_RECORD_OFF),
                         "ram": hex(OVERLAY_BASE + DRAW_RECORD_OFF),
                         "count": DRAW_RECORD_COUNT, "stride": 12,
                         "fields": ["clip", "x", "y"]},
        "pack": "NAMEDTCS 0x07700000 (via resolver [0x80044f5c])",
        "language_selector": "[0x8005cca8]",
        "language_order": LANGUAGE_ORDER,
        "language_index_english": LANGUAGE_ENGLISH,
        "language_note": "clip = base + [0x8005cca8]; each block is exactly 7 "
                         "clips, one per language, matching the seven indices "
                         "cnty_sel writes into that same global. Indices 1 "
                         "(usa) and 2 (eng) are both English and their art is "
                         "pixel-identical, so which of the two a given build "
                         "carries is not observable on this screen.",
        "empty_row": "row 3 of cols 10..14 holds no key origin (its index "
                     "would be negative), so it is a spacer the cursor skips; "
                     "the capture shows the 9px gap under the symbol block.",
        "keys": keys,
        "disasm": "stdgname.s L0x00000dc4-L0x00000fa0 (F0x80083994)",
    }


def main() -> int:
    strings = load_strings()
    pages = {
        "upper": grid_from_string(strings[8]),
        "lower": grid_from_string(strings[9]),
        "symbol": grid_from_string(strings[10]),
    }
    out = {
        "overlay_base": hex(OVERLAY_BASE),
        "pack": PACK,
        "strings": {STRING_ROLES.get(i, f"unk_{i}"): s
                    for i, s in enumerate(strings)},
        "grid": {
            "cols": GRID_COLS,
            "pages": pages,
            "page_order": ["upper", "lower", "symbol"],
            "note": "`cols`/`pages` here are the esnamedt CHARACTER INVENTORY "
                    "(26 letters wrapped 5-per-line), not the screen layout. "
                    "The real on-screen keyboard geometry is in `interactive` "
                    "(15 cols x 7 rows x 3 pages, decoded 2026-07-14). The "
                    "walker's canvas fallback still uses the 5-col inventory "
                    "until STDGNMCS glyph data is extracted (see open_gaps).",
            "interactive": dict(INTERACTIVE_GRID, action_keys=action_keys()),
        },
        "chrome": CHROME,
        "dispatch_table": DISPATCH_TABLE,
        "open_gaps": [
            "RESOLVED 2026-07-14 (see grid.interactive): F0x80083994's cursor "
            "geometry (x=col*14+floor(col/10)*8+47, y=row*18+90; the old "
            "`col*18+90` guess was actually the row-y term) and the 15x7x3 "
            "grid topology + movement wrap bounds are now decoded from static "
            "disasm. REMAINING: (a) the per-cell glyph/validity map is a "
            "runtime STDGNMCS buffer ([0x80048e34+8]) not decoded statically, "
            "so the exact letter-per-cell layout still needs STDGNMCS "
            "extraction. Sub-gap (b), the 34-entry action-key jump table's "
            "case semantics, is RESOLVED 2026-08-14 -- see "
            "grid.interactive.action_keys.",
            "8 functions failed m2c decompilation (grep `Decompilation "
            "failure` in exe-decomp/stdgname_c/*.c): F0x80084318, "
            "F0x800843b8, F0x80086184, F0x80087214, F0x80087f50, "
            "F0x80088934, F0x80088e1c, F0x80083994 (also listed above).",
            "STDGNMTM sub-file 0/0.bin (the RLEN texture atlas) was never "
            "extracted by the ddw3 splat -- pack/dw2003/nameent/stdgnmtm/"
            "0.toml points its slot 0 at `/build/rlen/...` (a reconstructed "
            "path, not original disc data) and slot 1 is empty. A "
            "pre-decoded true-color PNG exists at "
            "tim/dw2003/nameent/stdgnmtm/0/0.png but its bpp/addressing "
            "convention relative to the STDGNMCS frame table (u values up "
            "to 248, i.e. a 256px-wide 4bpp-packed layout) is inconsistent "
            "with the PNG's own 64x256 physical size, so pixel-level sprite "
            "art extraction is NOT shipped -- this is the same wrong-format "
            "risk class flagged for the old ststattm decode. The walker "
            "renders the keyboard chrome as plain vector/text, not native "
            "sprite art, until this is resolved. EXTRACTED 2026-08-19 from "
            "the disc as web/assets/ui/stdgnm_sheet.png (DISC_PACKS LBA "
            "648/649). The wizard keyboard chrome the walker draws is still "
            "NAMEDT (already extracted); STDGNM is the overlay-owned pack "
            "(header, partner figures, name boxes). Keyboard cell-grid "
            "remains NAMEDT clip 37.",
            "RESOLVED 2026-08-13 (ledger "
            "UI-PADSERVICE-BUTTON-REMAP-IS-IDENTITY-2026-08-13): this "
            "overlay reads buttons through the shared pad service at "
            "0x8004b7d0, whose logical-id remap is filled by pad init from "
            "the static table at 0x8004bbf4 -- the byte run 00..0f, an "
            "identity permutation installed for all 2 ports x 4 multitap "
            "slots with no branch on language or region. Logical id N is "
            "therefore pad bit N, so the menus' confirm 13 / cancel 14 are "
            "CIRCLE and CROSS. The old note here, which called the mapping "
            "'inferred from the DW3 UI-wide convention (X=confirm, O=back)', "
            "had the two buttons the wrong way round. Still open: whether "
            "anything calls the sibling swapper F0x80018928 after init.",
            "New-game naming vs. DRI Digimon-rename flow difference (if "
            "any -- e.g. default prefill, backdrop) was not distinguished "
            "in the decompiled functions; both walker call sites "
            "(web/game.js) reuse one createNameEntry() with no observed "
            "flow-specific parameter in the traced code.",
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"wrote {OUT} ({len(json.dumps(out))} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
