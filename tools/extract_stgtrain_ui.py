#!/usr/bin/env python3
"""
Extract the STGTRAIN (gym training UI) chrome layout so the walker renders
real coordinates and real screen-pack art instead of hand-guessed geometry.

Decode sources:
  ~/ddw3/asm/dw2003/pro/stgtrain.s (overlay, RAM base 0x80082cb0). Reproduce
  the decompile:
    python3 tools/exe_decomp/overlay_to_fns.py \
      ~/ddw3/asm/dw2003/pro/stgtrain.s exe-decomp/stgtrain.fns.s
    python3 tools/exe_decomp/normalize_asm.py \
      exe-decomp/stgtrain.fns.s exe-decomp/stgtrain.norm.s
    python3 tools/exe_decomp/decompile_exe.py \
      exe-decomp/stgtrain.norm.s exe-decomp/stgtrain_c

  Pack: STTRNGCS/STTRNGTM (LBA_STTRNGCS_BIN_IDX/LBA_STTRNGTM_BIN_IDX = 0x28c/
  0x28d in ~/ddw3/rust/dw2003_exe_data/src/lba.rs), left unextracted by the
  ddw3 splat (same shape as stdglabo) — loaded straight from the disc image
  by tools/extract_screen_packs.py:load_disc_pack, registered there as
  DISC_PACKS entries "sttrng0"/"sttrng3". The pack handle's low u16 selects
  the physical cs subdir directly (0x028c0000 -> subdir 0 = "sttrng0", the
  drill training-pose animation frames; 0x028c0003 -> subdir 3 = "sttrng3",
  the chrome: cave-wall background composite ids 45/46, rep success/fail
  icons id 69 (blue ring) / id 70 (red X), misc UI icon strip ids 0-52).
  Both cs subdirs share the SAME (single) tm entry -> tm_sub=0 override.

Chrome facts transcribed from exe-decomp/stgtrain_c/ (provenance per block
below; every coordinate is a literal immediate in the decompiled C, i.e. a
disasm-level fact, not a guess):

  * TP plate (F0x80086b24 ctor, reused verbatim by F0x8008a354's ctor):
    label glyph at (0x74,0xC0)=(116,192), value digits at (0x74,0xCE)=
    (116,206) -- native y is near the BOTTOM of the 320x240 screen, not the
    top the walker previously guessed.
  * TP amount menu (F0x80086b24 ctor): three option rows at x=0xA2=162,
    y = 0x75/0x91/0xA1 = 117/145/161; cursor glyph (F0x8001b364) anchored at
    (0x94,0x91) = (148,145).
  * Drill list (F0x80083aec ctor): a 6-row vertical list at x=0x33=51,
    y = 0x4F0000>>16 + i*(0xE0000>>16) = 79 + 14*i for i in 0..5 (79, 93,
    107, 121, 135, 149) -- reused for the walker's drill list rows (text
    only; the overlay ALSO owns a distinct 4x2 icon-grid picker described
    below, whose per-drill icon frame table (0x8008CFCC) is not decoded, so
    it is NOT wired -- open gap).
  * Drill icon grid (F0x8008a524): 4 cols x 2 rows, cell pitch 40x40, icon
    top-left at (0xA8 + col*0x28, 0x76 + row*0x28) = (168+40*col, 118+40*row).
  * Drill icon frame table -- RESOLVED 2026-07-12 via a live rig RAM read
    (user-supplied savestate `SLES03936.sstate9`, parked at the stgtrain
    drill-select screen; `%APPDATA%/Roaming/pcsx-redux/`, not the headless
    rig's `C:/dw3-rig/states/` dir). Static disasm alone could not resolve
    this (the frame-table pointer at RAM 0x8008cfcc+0x2dc has zero writers
    anywhere in the six overlays that reference it -- it's populated by
    resident/base-exe code at runtime). With the overlay live, the pointer
    at 0x8008d2a8 resolved to 0x8008cbe4; dumping 24 populated 0x18-byte
    entries there (word0=drill id 19-42, words[2..5]=4-frame idle-anim clip
    ids into the "sttrng0" pack) gave a complete, self-describing table --
    one row per drill id, independent of the picker's internal iteration
    order. Cross-checked against `DRILL_NAMES` (id-18 = compact index) and
    visually confirmed: drill 20 "Defense" -> clips [4,5,6,7] crop from
    `sttrng0_sheet.png` is pixel-identical to the "Defense" pose in the
    supplied screenshot (blond muscular figure, breath/steam animation).
    Full table below (`DRILL_ICON_FRAMES`).
  * Rep result row (F0x80086c0c): 5 slots at x = 0x80 + i*0x11 = 128+17*i,
    y=0x58=88; clip 0x45=69 (sttrng3, blue ring = success) when the slot's
    +0x64 flag is 1, clip 0x46=70 (sttrng3, red X = fail/empty) when 0.
    (The decoded mechanics doc says the OFFER gate reads exactly 3 poll
    results (+0x64/+0x68/+0x6c of the challenge-session struct); this is a
    *different*, 5-slot struct array read by a different function, so the
    walker keeps its existing 3-poll offer logic and only borrows the real
    icon art + spacing for however many slots it shows.)
  * Confirm/result label columns (F0x80088214 ctor): (0xA2,0x49)=(162,73),
    (0xBC,0x14)=(188,20), (0xC0,0x29)=(192,41), then a 3-column row at
    y=0x66=102: x=0x98/0xC0/0xE6 = 152/192/230 (before/arrow/after spacing
    -- reused here for the result screen's stat delta rows, values sourced
    from the already-decoded gymTrainingResult()/applyGymEffects() engine
    functions in web/battle.js, not fabricated), plus (0x94,0x87)=(148,135),
    (0xA2,0x64)=(162,100), (0xA2,0x74)=(162,116); cursor glyph anchored at
    (0,0) (repositioned per-menu at runtime, exact base not resolved here).
  * Cave-wall background (F0x80086c0c body draws sttrng3 clip ids 45/46 as a
    pre-composed multi-tile backdrop): rendered as a static first frame
    (id 45) full-screen at (0,0); the exact 45/46 toggle cadence is not
    transcribed (open gap -- cosmetic only).

Output: web/assets/data/stgtrain_ui.json
"""

import os
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/assets/data/stgtrain_ui.json"
# The words on every one of this screen's plates. The screen asks for them by
# index from message bank 0x10B (`*(s32 *)0x8005CCA8 + 0x10B` at every fill
# site in F0x800888bc, F0x8008706c and F0x8008aad4), and that bank is this
# file, already extracted with the rest of the game's text. Two passes on
# 2026-09-04 recorded "the wording is not established, the message file is not
# extracted"; it was extracted all along, under the screen's own name.
BANK = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "lang_file/dw2003/eng/estraini.toml"


def bank_strings(path: Path) -> list[str]:
    """The flat `strings = [...]` array, index == the index the screen asks for."""
    return re.findall(r'^\t"(.*)",?$', path.read_text(errors="replace"), re.M)

# Drill id (19-42, matches DRILL_NAMES[id-18] in web/gym.js) -> 4-frame idle
# animation clip ids into the "sttrng0" pack. Read live from RAM at
# 0x8008cbe4 (the frame-table pointer stored at 0x8008cfcc+0x2dc resolves
# here only once the overlay is actually loaded -- see doc comment above).
DRILL_ICON_FRAMES = {
    19: [0, 1, 2, 3], 20: [4, 5, 6, 7], 21: [8, 9, 10, 11],
    22: [12, 13, 14, 15], 23: [16, 17, 18, 19], 24: [45, 46, 47, 48],
    25: [49, 50, 51, 52], 26: [53, 54, 55, 56], 27: [57, 58, 59, 60],
    28: [61, 62, 63, 64], 29: [20, 21, 22, 23], 30: [24, 25, 26, 27],
    31: [28, 29, 30, 31], 32: [32, 33, 34, 35], 33: [36, 37, 38, 39],
    34: [40, 41, 42, 43], 35: [95, 96, 97, 98], 36: [65, 66, 67, 68],
    37: [71, 72, 73, 74], 38: [75, 76, 77, 78], 39: [79, 80, 81, 82],
    40: [83, 84, 85, 86], 41: [87, 88, 89, 90], 42: [91, 92, 93, 94],
}

DATA = {
    "packs": {"drills": "sttrng0", "chrome": "sttrng3"},
    "tp_plate": {
        "labelX": 116, "labelY": 192, "valueX": 116, "valueY": 206,
        "disasm": "F0x80086b24 unk0/unk4 ctor; reused by F0x8008a354. NOTE "
                  "2026-07-12b: this is the TP-MENU ctor's own widget; the "
                  "persistent HUD TP plate is hud.tp_plate below (x=0).",
    },
    # Persistent left HUD, F0x80084838 (decompiled 2026-07-12b — every draw
    # call is a literal chrome clip + coordinate; nothing guessed):
    #   sp94(sttrng3 0x1F, 0, 0xF)  + cmfont 0xE  -> partner card backing
    #   sp94(category sprite, 0x10, 0x16)         -> card bust (sttrng3 0-28
    #       via the 0x8008C224 category table; species->category resolver
    #       still unlocated, walker substitutes the DRI portrait table)
    #   sp94(sttrng3 0x20, 0, 0x4B) + cmfont 0xF  -> stat panel (cmfont 0xF is
    #       the same 6-core/7-res icon composite the status screen draws)
    #   sp94(sttrng3 0x21, 0, 0xB6)               -> TP plate
    # Pod-select right side (same function):
    #   sp94(sttrng3 0x27, 0x8F, 0xF)   -> "Stop training" top plate
    #   sp94(sttrng3 0x22, 0x92, 0x43)  -> header banner (shared slot)
    #   sp94(sttrng3 0x24, 0x8F, 0x5F)  -> tube/grid window
    #   cmfont 0x11/0x10 @(0x8F, 0x5F)  -> capsule towers / glass glint
    "hud": {
        "card": {"chrome_clip": 0x1F, "cmfont_clip": 0x0E, "x": 0, "y": 15,
                 "sprite_x": 16, "sprite_y": 22},
        "stat_panel": {"chrome_clip": 0x20, "cmfont_clip": 0x0F, "x": 0, "y": 75},
        "tp_plate": {"chrome_clip": 0x21, "x": 0, "y": 182},
        "disasm": "F0x80084838",
    },
    "select_chrome": {
        # textX/textY CORRECTED 2026-09-04: widget +0x68 of F0x80083aec is
        # built at (0xA1,0x17) = (161,23); the shipped (165,22) was measured,
        # not read.
        "top_plate": {"clip": 0x27, "x": 143, "y": 15, "textX": 161, "textY": 23},
        "banner": {"clip": 0x22, "x": 146, "y": 67, "textX": 174, "textY": 73},
        "window": {"clip": 0x24, "x": 143, "y": 95},
        # Pods and the light beam above the chosen one. ADDED 2026-09-04: the
        # walker already drew these at exactly these places, but the numbers
        # lived in web/gym.js, so the coverage audit could not see them.
        # F0x80084838: pod sprite at (0xA4 + 0x30*i, 0x81), cmfont 0xD beam at
        # (0xA4 + 0x30*sel, 0x65).
        "pods": {"x0": 164, "stepX": 48, "y": 129, "count": 3},
        "pod_cursor": {"cmfont_clip": 0x0D, "x0": 164, "stepX": 48, "y": 101},
        "towers": {"cmfont_clip": 0x11, "glint_clip": 0x10, "x": 143, "y": 95},
        "disasm": "F0x80084838",
    },
    # CORRECTION 2026-09-04. The block that used to sit here as "tp_menu"
    # (x=162, rows at y=117/145/161, cursor at (148,145)) is NOT the TP amount
    # menu. F0x80086b24 is called by F0x80087f28, the TRAINING SESSION's
    # lifecycle, and F0x8008706c fills those three widgets in session states 12
    # and 13 with a banner and a two-way choice, moving the cursor by 16 per
    # step. That is the Ultra Training Chance offer. The walker drew the TP
    # amounts on it, which is why they sat below the boxes instead of inside
    # them.
    "ultra_menu": {
        "bannerX": 162, "bannerY": 117,
        "rowsX": 162, "rowsY": [145, 161],
        "cursorX": 148, "cursorY0": 145, "cursorStepY": 16,
        "disasm": "F0x80086b24 ctor (+0x8/+0xC/+0x10 and the cursor); "
                  "F0x8008706c cases 12-14 fill and move it.",
    },
    # The real TP amount menu: three boxes side by side, each with its amount
    # written inside it, chosen with LEFT and RIGHT.
    #   boxes   F0x80088348 record +0xD8: clip 0x2A at (148 + 40*i, 99), with
    #           the gold frame clip 0x29 on the chosen one at the same origin.
    #   labels  F0x80088214 widgets +0xC/+0x10/+0x14 at (152,102), (192,102)
    #           and (230,102) -- one inside each box. F0x800888bc case 5 fills
    #           them from message entries 0xE, 0xF and 0x10 and then turns the
    #           frame on; case 6 moves the choice on pad left and pad right.
    "tp_amount_menu": {
        "labelsX": [152, 192, 230], "labelY": 102,
        "boxClip": 0x2A, "boxX0": 148, "boxStepX": 40, "boxY": 99,
        "cursorClip": 0x29,
        "headerX": 162, "headerY": 73,
        "titleX": 188, "titleY": 20,
        "disasm": "F0x80088214 ctor; F0x80088348 draw; F0x800888bc cases 3-6.",
    },
    # Persistent left-HUD text block. CONSTRUCTOR F0x80083aec
    # (gym_hud_text_construct, stgtrain.s file 0xe3c) builds seventeen text
    # widgets plus two counted columns; the fills are F0x80083d10
    # (name/level/HP/MP), F0x80084064 (the two stat columns) and F0x80084270
    # (the TP plate).
    #
    # CORRECTION 2026-09-04: the block previously shipped here as "drill_list"
    # (x=51, y0=79, 6 rows) is NOT a drill list. F0x80084064 fills those six
    # widgets with the six core stat numbers and the SEVEN widgets of a second
    # column at x=0x5D=93 with the seven resistances -- the same 6-core/7-res
    # split the shared cmfont 0xF icon composite draws. The 2026-07-11 note
    # calling it a drill list, and the walker's pixel-guessed x=56/x=100, are
    # both superseded.
    #
    # ALIGNMENT: every widget marked "right" below has `+0x148` called with 1
    # (F0x8001a25c), which stores the measured string width into `+0xBC`; the
    # widget draw F0x800197a4 L76 sets the pen origin to `+0xB8 = -(+0xBC)`,
    # so the recorded x is the RIGHT edge of the number. Every other widget
    # draws from its x to the right.
    #
    # FONT: arg1 of F0x8001ae38 is the font kind, clamped to 1..3, indexing
    # D0x8004de00 + kind*0x18. The name, the two stat columns and the TP plate
    # are kind 1; the level/HP/MP block is kind 3.
    #
    # LABELS: the four labels and the separator come from message file
    # (0x10B + language) entries 1 (level), 2 (HP), 3 (MP), 4 (TP) and 0x43
    # (the separator between the two numbers). That file is NOT extracted, so
    # the walker keeps its own English labels; only the geometry is decoded.
    "hud_text": {
        "name": {"x": 51, "y": 19, "kind": 1},
        "level": {"labelX": 51, "y": 34, "valueX": 80, "valueRight": True,
                  "kind": 3},
        "hp": {"labelX": 51, "y": 44, "curX": 93, "sepX": 95, "maxX": 128,
               "curRight": True, "maxRight": True, "kind": 3},
        "mp": {"labelX": 51, "y": 53, "curX": 93, "sepX": 95, "maxX": 128,
               "curRight": True, "maxRight": True, "kind": 3},
        "core": {"x": 51, "y0": 79, "stepY": 14, "rows": 6, "right": True,
                 "kind": 1},
        "res": {"x": 93, "y0": 79, "stepY": 14, "rows": 7, "right": True,
                "kind": 1},
        "tp": {"labelX": 16, "valueX": 44, "y": 187, "valueRight": True,
               "kind": 1},
        "disasm": "F0x80083aec ctor (0x4F0000 base, 0xE0000 16.16 step for "
                  "both columns); F0x80083d10 / F0x80084064 / F0x80084270 "
                  "fills; F0x8001a25c + F0x800197a4 L76 for the right edge.",
    },
    "drill_icon_grid": {
        "cols": 4, "rows": 2, "cellW": 40, "cellH": 40,
        "iconX": 148, "iconY": 100,
        "disasm": "F0x8008a524 sp94(pack, clip, temp_s2+0x94, temp_s3+0x64). "
                  "CORRECTED 2026-07-12b: the previously-shipped (168,118) "
                  "came from spA4(temp_s2+0xA8, temp_s3+0x76), which is the "
                  "per-cell SCALE PIVOT (cell center), not the draw origin. "
                  "All sttrng0 icon clips are 36x36 dx=0/dy=0, so icons, the "
                  "gold-frame cursor (sttrng3 0x1E at the SAME origin -- the "
                  "old 'sttrng0 0x1E' pack attribution was wrong and drew an "
                  "ice-drill sprite), and the empty-slot wooden-X (sttrng3 "
                  "0x5F, drawn for -1 table entries) all share one origin. "
                  "Selected icon: 4-frame anim, CLUT row 0; non-selected: "
                  "static frame 0 on CLUT row 1 (dimmed). Page arrows: page 0 "
                  "-> sttrng3 0x2C @(0xE4,0xA0), later pages -> 0x2B "
                  "@(0x94,0xA0). Grid window: sttrng3 0x24 @(0x8F,0x5F). "
                  "Description plate: sttrng3 0x23 @(0x46,0xBA). NOTE: the "
                  "frame table is keyed by RAW estraini id 19-42, and the "
                  "compact drill order (progression.json) DIFFERS from "
                  "estraini order -- gym.js maps through ESTRAINI_IDX, not "
                  "+18.",
        # Split out 2026-08-05: these two anchors were the only pixel-measured
        # values in this block, but the caveat lived in the block-level note
        # above, which made every traced grid number read as measured. They now
        # carry their own provenance so the audit bins them correctly.
        "description_text": {
            "nameX": 116, "nameY": 192,
            "descX": 116, "descY": 206,
            "disasm": "TRACED 2026-08-05, replacing the pixel-measured "
                      "(112,192)/(112,208). The drill-select screen's label "
                      "constructor F0x8008a354 builds four class-A text "
                      "widgets, the last two being the name and description "
                      "lines: stgtrain.s file 0x76ec/0x76fc a2=0x74 a3=0xc0 "
                      "and file 0x7704/0x7714 a2=0x74 a3=0xce, i.e. (116,192) "
                      "and (116,206). Verified in original assembly via "
                      "run-overlay-scan.sh fn stgtrain 0x76a4, not only in "
                      "the m2c output. The old measurement had x 4px left and "
                      "the second line 2px low. CORROBORATION: a second, "
                      "independent label constructor in the same overlay "
                      "(F0x80086b24, the TP-menu screen) builds its own pair "
                      "at exactly the same (0x74,0xc0)/(0x74,0xce), so the "
                      "description line position is shared across sub-screens "
                      "and does not depend on which constructor owns it -- "
                      "which is why the older note's warning about the "
                      "(116,192) TP widget being misattributed to the HUD "
                      "does not undermine this anchor.",
        },
        "frames": DRILL_ICON_FRAMES,
        "frameStepMs": 320,  # unk84 gate: (vsync - unk84) >= 0x10 (16 vsyncs @ PAL 50Hz)
        "cursorStepMs": 220,  # cursor/arrow CLUT cycle: >= 0xB (11 vsyncs)
        "pack": "drills",
    },
    "rep_row": {
        "x": 128, "y": 88, "stepX": 17, "count": 5,
        "iconOk": 69, "iconFail": 70, "pack": "chrome",
        "disasm": "F0x80086c0c",
    },
    # The "Is this ok?" prompt, same object and same constructor as the TP
    # amounts. F0x800888bc case 0x11 writes the chosen amount to the widget at
    # (192,41), the question to (162,73), the two answers to (162,100) and
    # (162,116), and parks the cursor at (148,100); case 0x12 moves it on pad
    # up and pad down, 16 per step.
    #
    # CORRECTION 2026-09-04: the three places at y=102 were shipped from
    # 2026-07-11 as a before / arrow / after row for the training result. They
    # are the three TP amount labels, one inside each box -- see
    # tp_amount_menu above. The training result is ONE line, elsewhere; see
    # session_result.
    "confirm_prompt": {
        "headerX": 162, "headerY": 73,
        "amountX": 192, "amountY": 41,
        "rowsX": 162, "rowsY": [100, 116],
        "cursorX": 148, "cursorY0": 100, "cursorStepY": 16,
        "spare": [[148, 135]],
        "disasm": "F0x80088214 ctor; F0x800888bc cases 0x11-0x12.",
    },
    # What a finished session says. F0x8008706c writes ONE line into the top
    # line of the bottom plate and hides the second: with no change at all it
    # is message entry 0x71; with one change it is a template chosen by the
    # stat (+0x5B, or +0x5D for stat ids 1..5) with one number substituted;
    # with two changes it is template +0x62 with two numbers. The block then
    # sets the plate's palette byte to 0 -- +0x138(0), the widget's +0xC0 that
    # the drawer turns into the primitive's CLUT row -- and its text reveal
    # rate to 6 -- +0x130(6), the widget's +0xAA the tick counts between
    # characters. CORRECTED 2026-10-06: the 6 was filed here as the palette
    # for years; the palette is 0 and the 6 is the reveal rate (stgtrain.s
    # file 0x4a68-0x4aac; fns.s L11134 sb $a1,0xc0 / L11119 sh $a1,0xaa).
    #
    # NOT established: the wording. The message file is not extracted, so the
    # walker writes its own English into the same one line.
    "session_result": {
        "lineX": 116, "lineY": 192, "clut": 0, "revealRate": 6,
        "disasm": "F0x8008706c case 5: +0x138(0) palette, +0x130(6) reveal "
                  "rate, +0x144(second line, 0) hides it.",
    },
    # Confirm / TP-amount screen chrome, F0x80088348 (gym_large_drill_icon_draw,
    # stgtrain.s file 0x5698). Every entry is a literal clip id and coordinate
    # pair in that function; each one is gated by its own fold record on the
    # confirm object (record base + 0x8 is the fold scale, 0 = shut,
    # 0x1000 = fully open), started by F0x800888bc (gym_confirm_tick).
    #   +0x78 -> bar 0x26 @(133,67)          +0xB8 -> result plate 0x1D @(130,94)
    #   +0x88 -> plate 0x25 @(143,15)        +0xC8 -> question plate 0x27 @(130,94)
    #   +0x98 -> large drill icon @(148,20)  +0xD8 -> row cursor 0x2A
    #   +0xA8 -> plate 0x2A @(188,38)        +0xE8 -> prompt plate 0x27 @(130,127)
    "confirm_chrome": {
        "large_icon": {"x": 148, "y": 20, "frames": 4, "period_vsync": 16,
                       "pack": "drills"},
        "plates": [
            {"clip": 0x25, "x": 143, "y": 15, "role": "title"},
            {"clip": 0x26, "x": 133, "y": 67, "role": "banner"},
            {"clip": 0x2A, "x": 188, "y": 38, "role": "icon_frame"},
            {"clip": 0x27, "x": 130, "y": 94, "role": "question"},
            {"clip": 0x1D, "x": 130, "y": 94, "role": "result"},
            {"clip": 0x27, "x": 130, "y": 127, "role": "prompt"},
        ],
        "row_cursor": {"clip": 0x29, "x0": 148, "stepX": 40, "y": 99,
                       "frames": 4, "period_vsync": 11},
        "pack": "chrome",
        "disasm": "F0x80088348; folds started by F0x800888bc.",
    },
    # Training-session chrome, F0x80086c0c (gym_session_chrome_draw, file
    # 0x3f5c). The viewport and the rep row are already above; these are the
    # three plates the walker used to fake with plain boxes.
    "session_chrome": {
        "bar": {"clip": 0x26, "x": 133, "y": 112},
        "panel": {"clip": 0x1D, "x": 130, "y": 139},
        "description_plate": {"clip": 0x23, "x": 70, "y": 186},
        "page_glyph": {"pack": "cmfont", "clip": 0x0A, "x": 292, "y": 205,
                       "frames": 5, "period_vsync": 4},
        "pack": "chrome",
        "disasm": "F0x80086c0c.",
    },
    # Drill-grid screen chrome, F0x8008a524 (file 0x7874). The page arrow and
    # its label swap sides with the page: page 0 draws clip 0x2C at x=228 with
    # the label at x=228, any later page draws clip 0x2B at x=148 with the
    # label at x=163. Both sit at y=160 and cycle four CLUT rows every 11
    # vsyncs. F0x8008aad4 shows the pair only when the shared field at
    # 0x8008CFCC+0 is 6 or more.
    #
    # NOT ESTABLISHED: whether that field is the drill count or the gym rank.
    # It does not matter for the walker -- a rank holds either 5 drills or ten
    # or more, so "six or more drills" and "rank six or more" agree on every
    # rank in progression.json gym.rank_menus.
    "grid_chrome": {
        "page_arrow": {
            "frames": 4, "period_vsync": 11, "min_drills": 6,
            "first": {"clip": 0x2C, "x": 228, "y": 160, "labelX": 228,
                      "labelY": 160},
            "later": {"clip": 0x2B, "x": 148, "y": 160, "labelX": 163,
                      "labelY": 160},
        },
        "description_plate": {"clip": 0x23, "x": 70, "y": 186},
        "pack": "chrome",
        "disasm": "F0x8008a524; page gate and label in F0x8008aad4.",
    },
    "cave_backdrop": {
        "clip": 45, "x": 0, "y": 0, "pack": "chrome",
        "scroll": {"step_frames": 2, "wrap": 0x60, "axis": "xy"},
        "disasm": "SCROLL CADENCE DECODED 2026-08-14, closing the old 'static "
                  "first frame; toggle cadence open gap' note. stgtrain.s "
                  "L1866-L1893 (file 0x2424-0x2498): the counter at +0x5c is "
                  "incremented by 1 ONLY on frames where the +0x60 toggle is "
                  "already set (the toggle is cleared at L1879 and set at "
                  "L1880), is reset to 0 rather than ever holding 0x60 (slti "
                  "at L1873), and is passed as BOTH x (lw $a2 at L1889) and y "
                  "(move_ $a3, $a2 at L1893, in the jalr delay slot, so it "
                  "executes). That is 0.5px/vsync down-right with a 96px "
                  "period -- the same shape the other eight scrolling walls "
                  "use (see web/screenpack.js drawPackBackdrop). "
                  "STILL OPEN: the draw reads its clip id from the object "
                  "field +0x58 (stored by the constructor at L246), not an "
                  "immediate, and sttrng3 carries eight such mosaics "
                  "(0x2d..0x34). Which training ground selects which wall is "
                  "NOT established; clip 45 here is the previously recorded "
                  "value, retained rather than re-derived.",
    },
    "training_viewport": {
        "x0": 114, "y0": 75, "x1": 299, "y1": 178,
        "window_clip": 0x28,  # sttrng3 40: 186x104 native viewport window,
                              # matches the pixel-measured box exactly
        "disasm": "TRACED 2026-08-05, replacing the pixel-measured origin. The "
                  "rep-loop function F0x80086c0c DOES draw this window itself: "
                  "stgtrain.s file 0x4220/0x4224/0x4234 load a1=0x28, a2=0x72, "
                  "a3=0x4b, i.e. chrome clip 0x28 at (114,75) -- exactly the "
                  "value the 2026-07-12 screenshot measurement produced, so "
                  "the old number was right but unproven. Verified in original "
                  "assembly via run-overlay-scan.sh fn stgtrain 0x3f5c, not "
                  "only in the m2c output (exe-decomp/stgtrain_c/"
                  "F0x80086c0c.c L72). x1/y1 are x0/y0 plus the clip's own "
                  "186x104 extent from the extracted pack, not independent "
                  "measurements. CORRECTION: the earlier note here asserted "
                  "'stgtrain.s has no dedicated spawn/draw code for this "
                  "viewport in its own overlay (exhaustively checked)'. That "
                  "is FALSE for the window; the draw is the plain chrome-clip "
                  "call above and was missed because the search looked for a "
                  "spawn rather than a clip blit. It remains true for the "
                  "Digimon SPRITE inside the window, which stgtrain does not "
                  "own -- that half of the old note still stands, as do the "
                  "punching-bag art and idle-vs-punch clip gaps.",
    },
}


# Which index each place on the screen asks for. Every entry was read off a
# fill site, not guessed from the text: the ctor F0x80088214 builds the widgets,
# F0x800888bc fills them (case 3 -> 8, case 0x11 -> 9 / 0xA / 0xB, case 5 ->
# 0xE..0x10, case 0xB -> 0x12), F0x8008706c fills the session's own (case 12 ->
# 0x11, case 13 -> 0xC / 0xD, case 5 -> the result templates), F0x8008aad4 the
# page labels, and F0x80083aec the left HUD's labels.
STRING_ROLES = {
    "stop_training": 0x05,
    "train_which_digimon": 0x06,
    "which_training": 0x07,
    "pick_tp_amount": 0x08,
    "is_this_ok": 0x09,
    "yes": 0x0A,
    "no": 0x0B,
    "challenge": 0x0C,
    "as_is": 0x0D,
    "tp_amounts": [0x0E, 0x0F, 0x10],
    "ultra_chance": 0x11,
    "not_enough_tp": 0x12,
    "hud_labels": {"level": 0x01, "hp": 0x02, "mp": 0x03, "tp": 0x04,
                   "separator": 0x43},
    "page_labels": {"prev": 0x44, "next": 0x45},
    "failed": 0x46,
    # The drill's name is at its own estraini id; its description is 24 later.
    "drill_name_base": 0x13,
    "drill_desc_offset": 24,
    # The finished session's line, F0x8008706c case 5. Nothing gained -> one
    # fixed message. A core stat (id 1..5) -> base + id, one number. A
    # resistance drill that also moved a second stat -> two_base + id, two
    # numbers. A resistance drill on its own -> elem_base + id, one number.
    "result_none": 0x71,
    "result_core_base": 0x5D,
    "result_elem_base": 0x5B,
    "result_two_base": 0x62,
}


def main() -> int:
    strings = bank_strings(BANK)
    if len(strings) < 0x76:
        raise SystemExit(f"{BANK}: only {len(strings)} strings, expected 118")
    DATA["strings"] = {
        "source": "lang_file/dw2003/eng/estraini.toml",
        "bank": 0x10B,
        "roles": STRING_ROLES,
        "all": strings,
        "disasm": "Every fill site passes bank 0x10B: F0x800888bc, F0x8008706c, "
                  "F0x8008aad4 and F0x80083aec.",
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(DATA, indent=1) + "\n")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
