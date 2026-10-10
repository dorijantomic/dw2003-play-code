#!/usr/bin/env python3
"""
Extract the STGMCARD (MEMORY CARD save/load) chrome so the walker renders real
coordinates and real screen-pack art instead of hand-guessed geometry.

IDENTITY CORRECTION (2026-08-05).  `docs/todo/2026-07-10-full-ui-decompile-
master-plan.md` lists the census row `stgmcard / cardgame` as "card battle
game", and left it unstarted as "the biggest block".  That is wrong.
`pro/stgmcard.s` is the MEMORY CARD SAVE/LOAD screen; the card-battle game is
`pro/cardgame.s` (a separate file), whose front-ends are the already-decoded
stcrdshp / stcrdabm / stcrddek overlays.  Three independent proofs:

  1. String bank.  Every text widget resolves its bank with the standard
     `0x80044B38->unk414(*(s32*)0x8005CCA8 + BASE)` idiom (the same one
     stgdglab uses with BASE 0x39).  stgmcard's base is 0x78 = 120 =
     LBA_MSMEMCRD_BIN_IDX in ~/ddw3/rust/dw2003_exe_data/src/lba.rs, and the
     language variable 0x8005CCA8 holds 2 for English, giving 122 =
     LBA_ESMEMCRD_BIN_IDX -- ~/ddw3/lang_file/dw2003/eng/esmemcrd.toml, a
     41-string SAVE / LOAD / "Choose MEMORY CARD slot." bank.
     (stgmcard.s L0x000005a4, L0x000006e0, ... -- 16 call sites.)
  2. Screen pack.  `0x80044B38->unk424(0x029D0000)` (stgmcard.s L0x00000e2c)
     and `unk424(0x029E0000)` (L0x00004fac): handle hi-word = LBA index, so
     0x29D/0x29E = 669/670 = LBA_STMCRDCS_BIN_IDX / LBA_STMCRDTM_BIN_IDX,
     the disc files AAA/DAT/MCARD/STMCRD{CS,TM}.BIN.
  3. The pack art itself.  Clip 0x22 is three PS1 MEMORY CARDS side by side and
     clip 0x23 is a console with its two card slots; clips 0x28..0x2F are the
     eight per-starter save nameplates.  See web/assets/ui/stmcrd_sheet.png.

Reproduce the decompile (overlay RAM base 0x80082cb0):
  taskset -c 0 prlimit --as=4294967296 -- .venv/bin/python3 \\
    tools/exe_decomp/overlay_to_fns.py \\
    ~/ddw3/asm/dw2003/pro/stgmcard.s exe-decomp/stgmcard.fns.s
  ... normalize_asm.py ... decompile_exe.py -> exe-decomp/stgmcard_c/
m2c handles this overlay cleanly: ok=23 entries / 30 .c files, `_failures.txt`
empty, and every draw-context owner decompiled -- no hand transcription of a
`Decompilation failure` marker was needed (unlike stitshop / stagslct).

Draw-context owners (functions calling the resident ctx factory F0x8001f648):
  F0x800836c4  save-file card window + the three animated party icons
  F0x8008316c  the same window's text populate pass (no ctx of its own)
  F0x80083c50  the rotating/expanding transition quad + clip 0x26
  F0x800843d8  MEMORY CARD slot chooser
  F0x80087368  message / confirm window + footer blink arrow
  F0x800877f0  "accessing" background (scrolling tile + vertical bar)
  F0x80087534  the message window's widget constructor (F0x8001ae38 /
               F0x8001b364 cursor)

Shared-infrastructure notes (reused, not re-derived):
  * Widget class = the resident F0x8001ae38 class-A text widget, whose 25 slots
    are decoded in the ledger (UI-WIDGETCLASS-AE38-*).  The slots this overlay
    uses: +0x114 set line 0 from a resource string (index < 0 installs the
    pointer as a literal), +0x118 set line N from an integer, +0x134 set
    position (x,y), +0x144 visibility, +0x148 JUSTIFICATION -- non-zero
    measures line 0 and shifts it left by its own width, i.e. RIGHT-ALIGN at x.
    That last one is what makes the play-time and BIT columns line up.
  * Window fold = the generic linear 8.8 tween family.  This overlay's pair is
    F0x80087fdc (start(obj, from, to, steps): +0x08 value, +0x10 target,
    +0x14 delta = ((to-from)<<8)/steps) and F0x8008801c (per-vsync tick),
    reached indirectly through the data pointers at 0x80088798 / 0x8008879C.
    The message window starts (0x97 -> 0, 10 steps) in F0x80087534.

Everything below is either read straight out of the overlay's DATA section by
`words()` or transcribed from the decompiled C with its function named.
"""
from __future__ import annotations
import os

import json
import re
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
ASM = DDW3 / "asm/dw2003/pro/stgmcard.s"
STRINGS = DDW3 / "lang_file/dw2003/eng/esmemcrd.toml"
AREA_STRINGS = DDW3 / "lang_file/dw2003/eng/esstarea.toml"
PLACE_STRINGS = DDW3 / "lang_file/dw2003/eng/esshpnam.toml"
OUT = Path(__file__).resolve().parent.parent / "web/assets/data/stgmcard_ui.json"

BASE = 0x80082CB0  # overlay RAM base for every pro/st* overlay

# The .s renders the code region as `<mnemonic> # .word 0xVALUE` and the data
# region as `.word 0xVALUE # <bogus disassembly>`.  tools/overlay_scan.py's
# `words` subcommand only understands the first form and reports the data
# region as unreadable -- per docs/research/infra, that is a property of the
# scanner, NOT absence.  Both forms are parsed here.
_CODE_WORD = re.compile(r"^\.L0x([0-9a-fA-F]+):.*#\s*\.word\s+(0x[0-9a-fA-F]+)")
_DATA_WORD = re.compile(r"^\.L0x([0-9a-fA-F]+):\s*\.word\s+(0x[0-9a-fA-F]+)")


def words() -> dict[int, int]:
    out: dict[int, int] = {}
    for line in ASM.read_text().splitlines():
        m = _DATA_WORD.match(line) or _CODE_WORD.match(line)
        if m:
            out[BASE + int(m.group(1), 16)] = int(m.group(2), 16)
    return out


def toml_strings(path: Path) -> list[str]:
    body = path.read_text().split("[", 1)[1]
    return [s.encode().decode("unicode_escape")
            for s in re.findall(r'"((?:[^"\\]|\\.)*)"', body)]


def s32(v: int) -> int:
    return v - (1 << 32) if v >= 0x80000000 else v


def main() -> int:
    W = words()
    txt = toml_strings(STRINGS)

    # ---- widget descriptor table -----------------------------------------
    # F0x800836c4 constructs the save-file card's widgets from a table of
    # 0x14-byte records starting at 0x80088088 (`var_s0 = 0x80090000 - 0x7F78`
    # in the decompile), count = screen->unk20, calling
    # F0x8001ae38(handle, rec+0x4 kind, rec+0x8 x, rec+0xC y).
    # F0x8008316c's "no data on this card" pass then sets each widget's text
    # to esmemcrd string rec+0x0, and for rec+0x10 != 0 also marks it numeric
    # (+0x118 line 1 = 0), right-aligns it (+0x148) and repositions it to the
    # record's own (x,y).  The table ends exactly where the icon-frame table
    # at 0x80088204 begins: 19 records.
    DESC = 0x80088088
    DESC_END = 0x80088204
    widgets = []
    for i in range((DESC_END - DESC) // 0x14):
        b = DESC + i * 0x14
        rec = [W[b + k * 4] for k in range(5)]
        widgets.append({
            "string": rec[0],
            "kind": rec[1],          # 1 = white text, 3 = gold digits
            "x": s32(rec[2]),
            "y": s32(rec[3]),
            "numeric": bool(rec[4]),  # right-aligned integer field
            "text": txt[rec[0]] if rec[0] < len(txt) else None,
        })

    # F0x800836c4 patches record 0's string id by language before constructing:
    # `var_v1 = 0x20; if (*(s32*)0x8005CCA8 != 0) var_v1 = 0x21;`
    # -- English (0x8005CCA8 == 2) therefore gets 0x21, "--------", not 0x20.
    widgets[0]["string_by_language"] = {"0": 0x20, "nonzero": 0x21}
    widgets[0]["string"] = 0x21
    widgets[0]["text"] = txt[0x21]

    # Roles, from the "card has data" branch of F0x8008316c.  `rec` below is
    # the per-slot save record at screen->unk50 + slot*0x44 + 0x74.
    roles = {
        0:  ("fileName", "+0x114(rec, -1) -- the record's own name string"),
        1:  ("areaName", "+0x114(bank 0xA9 = esstarea, rec+0x18)"),
        2:  ("placeName", "+0x114(bank 0x94 = esshpnam, rec+0x1C)"),
        3:  ("bitLabelA", "+0x114(bank 0x78, 0x15 = \"BIT\")"),
        4:  ("bitLabelB", "+0x114(bank 0x78, 0x15 = \"BIT\") "
                         "-- second pass of the same loop as widget 3; see "
                         "stgmcard.s L0x000006cc-L0x00000708"),
        5:  ("bitValue", "+0x118(0, rec+0x20) + 0x148(1) right-aligned"),
        6:  ("lvLabel0", "+0x114(bank 0x78, 0x14 = \"LV\")"),
        7:  ("lvLabel1", "+0x114(bank 0x78, 0x14 = \"LV\")"),
        8:  ("lvLabel2", "+0x114(bank 0x78, 0x14 = \"LV\")"),
        9:  ("lvValue0", "+0x118(rec+0x3C) or \"--\" (0x23) when the slot is empty"),
        10: ("lvValue1", "+0x118(rec+0x3E) or \"--\" (0x23) when the slot is empty"),
        11: ("lvValue2", "+0x118(rec+0x40) or \"--\" (0x23) when the slot is empty"),
        12: ("timeHours", "+0x118(0, rec+0x28) + 0x148(1) right-aligned"),
        13: ("timeMinutes", "+0x118(0, rec+0x2A) + 0x148(1) right-aligned"),
        14: ("timeSeconds", "+0x118(0, rec+0x2C) + 0x148(1) right-aligned"),
        15: ("timeColonA", "+0x114(bank 0x78, 0x13 = \":\") left-aligned"),
        16: ("timeColonB", "+0x114(bank 0x78, 0x13 = \":\") left-aligned"),
        17: ("timeMinutesLeadingZero",
             "shown at (0x111,0xB2) only when rec+0x2A < 10, else hidden"),
        18: ("timeSecondsLeadingZero",
             "shown at (0x124,0xB2) only when rec+0x2C < 10, else hidden"),
    }
    for i, w in enumerate(widgets):
        w["role"], w["disasm"] = roles[i][0], f"F0x8008316c {roles[i][1]}"
    # The two leading-zero widgets are repositioned at populate time; the
    # descriptor coordinates are only their pre-move placeholders.
    widgets[17]["x"], widgets[17]["y"] = 0x111, 0xB2
    widgets[18]["x"], widgets[18]["y"] = 0x124, 0xB2

    # ---- per-starter icon animation table --------------------------------
    # F0x800836c4: frame = 0x80088204[(type - 3) * 7 + counter]; the counter
    # advances while the entry is not -1 and wraps at 8, so each row is a
    # ping-pong terminated by -1.  `type` is the save record's byte at
    # rec+0x30 + 4*i (screen->unk50 + slot*0x44 + 0xA4 in the decompile).
    ICON = 0x80088204
    icon_frames = []
    for t in range(8):
        row = [s32(W[ICON + (t * 7 + i) * 4]) for i in range(7)]
        icon_frames.append([f for f in row if f != -1])

    # ---- slot-chooser tables ---------------------------------------------
    # F0x800843d8: nameplate clip = 0x800882E4[type - 3], drawn at
    # x = 0x80088304[i] + scroll, y = 0x23.
    plate_clips = [s32(W[0x800882E4 + i * 4]) for i in range(8)]
    slot_x = [s32(W[0x80088304 + i * 4]) for i in range(3)]

    # The stmcrd pack's clips 0..0x1C are the SAME eight per-starter portrait
    # animations as ststat clips 0..0x1C, with the same clip-id groupings
    # (tools/extract_screen_packs.py STSTAT_PORTRAITS, pinned there by pixel
    # clustering + savestate match). Matching each icon-frame row's clip set
    # against that mapping resolves the save record's starter byte to a
    # digimon.json id without inventing a second table.
    ststat_portraits = {1: {7, 8, 9, 10}, 2: {25, 26, 27, 28}, 3: {11, 12, 13},
                        4: {3, 4, 5, 6}, 5: {14, 15, 16}, 6: {0, 1, 2},
                        7: {17, 18, 19, 20}, 8: {21, 22, 23, 24}}
    digimon_by_type = {}
    for row, frames in enumerate(icon_frames):
        for did, clips in ststat_portraits.items():
            if set(frames) == clips:
                digimon_by_type[str(3 + row)] = did
                break
    assert len(digimon_by_type) == 8, digimon_by_type

    data = {
        "_source": (
            "tools/extract_stgmcard_ui.py -- every value is either read from "
            "the overlay DATA section of ~/ddw3/asm/dw2003/pro/stgmcard.s or "
            "transcribed from exe-decomp/stgmcard_c/ with the owning function "
            "named in a `disasm` key. No value on this screen is measured."
        ),
        "packs": {"chrome": "stmcrd", "font": "cmfont"},
        "identity": {
            "overlay": "pro/stgmcard",
            "screen": "MEMORY CARD save / load",
            "note": (
                "TRACED 2026-08-05, correcting the master-plan census row that "
                "called stgmcard the card battle game. String bank base 0x78 = "
                "LBA_MSMEMCRD_BIN_IDX 120 (English esmemcrd = 122); pack "
                "handles 0x029D0000/0x029E0000 = LBA_STMCRDCS/TM 669/670."
            ),
        },

        "file_card": {
            "window": {
                "clip": 0x21,
                "xy": [5, 0x59],
                "disasm": (
                    "F0x80087368 sp94(unk424(0x029D0000), 0x21, "
                    "unk58 + fold.x, unk5C + fold.y); the base (5, 0x59) is "
                    "set in F0x80087534"
                ),
            },
            "fold": {
                "from": 0x97, "to": 0, "steps": 10, "axis": "y",
                "disasm": (
                    "F0x80087534 0x80088798(screen+0x2824, 0x97, 0, 0xA) -- the "
                    "F0x80087fdc/F0x8008801c 8.8 linear tween; value at +0x08 "
                    "is read back as screen+0x282C and added to the window y"
                ),
            },
            "widgets": widgets,
            "party": {
                "count": 3,
                "iconXY": [[0x9A, 0x85], [0x9A + 0x34, 0x85], [0x9A + 0x34 * 2, 0x85]],
                "iconStepX": 0x34,
                "frameTicks": 0xD,
                "frames": icon_frames,
                "typeBase": 3,
                "digimonIdByType": digimon_by_type,
                "disasm": (
                    "F0x800836c4 -- icons at x = 0x9A + 0x34*i, y = 0x85, frame "
                    "table 0x80088204 indexed by (recordType - 3), advanced when "
                    "the shared clock 0x8004DE10->unk188() has moved 0xD ticks"
                ),
            },
            "layers": {
                "front": 0x24, "back": 0x25, "xy": [0x10, 0x74],
                "disasm": (
                    "F0x800836c4 -- sp94(clip 0x24, 0x10, 0x74) on the window "
                    "layer, then sp8C(handle, layer-1) and sp94(clip 0x25, "
                    "0x10, 0x74) so 0x25 renders behind 0x24"
                ),
            },
            "openFold": {
                "pivot": [0xA0, 0x94],
                "disasm": (
                    "F0x800836c4 -- when screen->unk7C != 0x1000, "
                    "sp9C(0x1000, unk7C, 0x1000) about spA4(0xA0, 0x94)"
                ),
            },
        },

        "message_window": {
            "text": {
                "xy": [5 + 0xC8, 0x59 + 9],
                "followsFold": True,
                "disasm": "F0x80087534 F0x8001ae38(h, 1, unk58+0xC8, unk5C+fold+9)",
            },
            "lines": [
                {"xy": [5 + 0xF, 0x59 + 0x18],
                 "disasm": "F0x80087534 F0x8001ae38(h, 1, unk58+0xF, unk5C+0x18)"},
                {"xy": [5 + 0xF, 0x59 + 0x28], "lineCount": 5, "field58": 1,
                 "disasm": "F0x80087534 + 0x160(5) + 0x15C(1)"},
                {"xy": [5 + 0xF, 0x59 + 0x67], "lineCount": 2,
                 "disasm": "F0x80087534 + 0x160(2)"},
            ],
            "yes": {"xy": [0xCF, 0xBD],
                    "disasm": "F0x80087534 F0x8001ae38(h, 1, 0xCF, 0xBD)"},
            "no": {"xy": [0xCF, 0xCB],
                   "disasm": "F0x80087534 F0x8001ae38(h, 1, 0xCF, 0xCB)"},
            "cursor": {"xy": [0xCF, 0xBD],
                       "disasm": "F0x80087534 F0x8001b364(h, 0, 0xCF, 0xBD)"},
            "yesNoPlate": {"clip": 0x1D, "xy": [0xBC, 0xB9],
                           "disasm": "F0x80087368 -- drawn on layer 1 when unk284C"},
            "blinkArrow": {"pack": "cmfont", "clip": 0x0A, "xy": [0x126, 0xD0],
                           "clutRows": 5, "frameTicks": 3,
                           "disasm": "F0x80087368 sp84(0x140,0) + sp98(counter)"},

            # ── Which message lands in which box, decoded 2026-08-14 ──────
            # The constructor stores its widgets in the caller's block:
            #   +0x00 the fold-following title at (205, 98)   -> `text`
            #   +0x14 the one-line box at (20, 113)           -> lines[0]
            #   +0x04 the FIVE-line box at (20, 129)          -> lines[1]
            #   +0x08 the TWO-line box at (20, 192)           -> lines[2]
            #   +0x0C "YES" at (207, 189) / +0x10 "NO" at (207, 203)
            # F0x80084dcc then binds text through the widget class's slot
            # +0x114, the set-line-0-from-a-resource-string setter
            # (UI-WIDGETCLASS-AE38-SETLINE-001). All sixteen of its +0x114 call
            # sites take the bank `[0x8005cca8] + 0x78` -- the language index
            # plus the esmemcrd base, LBA_MSMEMCRD 120 -- so the strings below
            # are esmemcrd indices.
            "binding": {
                "note": "The five-line box carries the WAITING messages and "
                        "the card's result; the two-line box carries the "
                        "prompts and the outcome. The walker previously put "
                        "every message in the five-line box.",
                "lines[1]": {
                    "widget": "+0x04", "lineCount": 5,
                    "strings": [4, 5],
                    "plusResultTable": True,
                    "sites": "F0x80084dcc L223, L261, L646",
                },
                "lines[2]": {
                    "widget": "+0x08", "lineCount": 2,
                    "strings": [7, 8, 9, 0x11, 0x12, 0x18, 0x1D],
                    "sites": "F0x80084dcc L371, L410, L945, L1040, L1044, "
                             "L1096, L1104",
                },
                "yes": {"widget": "+0x0C", "strings": [0x16, 3],
                        "sites": "F0x80084dcc L373, L704, L947"},
                "no": {"widget": "+0x10", "strings": [0x17, 3],
                       "sites": "F0x80084dcc L375, L706, L951"},
                "unbound": "lines[0] (+0x14) is never touched by any of the "
                           "sixteen +0x114 sites, so what it holds is still "
                           "not established. The walker draws the SAVE/LOAD "
                           "title there, which remains an assumption.",
                "slot_chooser": "When the two-line box shows 0x1D 'Choose "
                                "MEMORY CARD slot.', YES and NO are both set "
                                "to string 3, '{1}' -- so the two option rows "
                                "become the slot numbers rather than yes/no "
                                "(F0x80084dcc L945-L951).",
            },

            # The five-line box's result message comes from a table of
            # esmemcrd indices at 0x80088310 (overlay file 0x5660), indexed by
            # the memory-card result code the screen stores at +0x68. That code
            # is the return value of the resident card services [0x80048A88]
            # and [0x80048A94] called on the card handle at +0x64
            # (F0x80084dcc L276, L293).
            "result_messages": {
                "table": "0x80088310", "file_offset": "0x5660",
                "index": "screen+0x68, the card service's return code",
                # index -> esmemcrd string, read word by word.
                "strings": [1, 0x0A, 0x1B, 0x0A, 0x0B, 0x0C, 0x1C, 0x0D,
                            0x26, 0x24, 0x25],
                "text": ["SAVE",
                         "MEMORY CARD is not inserted.",
                         "Cannot access MEMORY CARD.",
                         "MEMORY CARD is not inserted.",
                         "MEMORY CARD is not formatted.",
                         "File cannot be found.",
                         "File already exists.",
                         "There are not enough blocks.\n"
                         "4 blocks are needed to save.",
                         "MEMORY CARD error.\nPlease check MEMORY CARD.",
                         "Save failed.",
                         "Save Failed."],
                "extent_note": "The table has no terminator and the index is "
                               "not bounds-checked, so its length is inferred: "
                               "entries 0..10 are all valid esmemcrd indices "
                               "and entry 11 onward exceeds esmemcrd's 41 "
                               "strings while forming a consecutive ascending "
                               "run, i.e. a different table. Codes 1, 4 and 5 "
                               "are the ones F0x80084dcc branches on by name.",
            },
        },

        "slot_select": {
            "console": {"clip": 0x23, "y": 0x12, "clutPulse": [0, 0xC],
                        "pulseTicks": 3,
                        "disasm": "F0x800843d8 sp98(unkD4) + sp94(clip 0x23, ...)"},
            "bar": {"clip": 0x20, "x": 0, "yOffset": 0x10,
                    "disasm": "F0x800843d8 sp94(clip 0x20, 0, unk80 + 0x10)"},
            "cards": {"clip": 0x22, "xOffset": 0x62, "y": 0x20,
                      "disasm": "F0x800843d8 sp94(0x80044F5C(0x029D0000), 0x22, "
                                "unk64 + 0x62, 0x20)"},
            "slots": 3,
            "slotX": slot_x,
            "plateY": 0x23,
            "plateClipByType": plate_clips,
            "typeBase": 3,
            "header": {"xy": [0x15, 0x18], "string": 3,
                       "disasm": "F0x800843d8 widget +0x134(0x15, unk80+0x18), "
                                 "+0x114(bank 0x78, 3) + 0x118(1, slot+1)"},
            "moveSfx": 0x4001B,
            "disasm": "F0x800843d8",
        },

        "transition": {
            "background": {"clip": 0x1E, "scroll": [0, 0x5F],
                           "disasm": "F0x800877f0 sp94(clip 0x1E, t, t)"},
            "bar": {"clip": 0x1F, "xy": [0x19, 0],
                    "disasm": "F0x800877f0 sp94(clip 0x1F, 0x19, 0)"},
            "quadClip": {"clip": 0x26, "xy": [0xCC, 0xC0],
                         "disasm": "F0x80083c50 spD4(... 0x26, 0xCC, 0xC0)"},
            "quadScale": {"to": 0x1000, "clamp": 0xF33,
                          "disasm": "F0x80083c50 unk8C += 0x1000 / unk74"},

            # ── The rotating quad, decoded 2026-08-14 ──────────────────────
            # F0x80083c50 builds ONE GPU primitive per frame and it is a
            # POLY_G4, the gouraud-shaded untextured four-point polygon: it
            # writes the tag's word count 8 at prim+0x3 and the GP0 command
            # 0x38 at prim+0x7, then fills four vertex colours at prim+0x4,
            # +0xC, +0x14 and +0x1C -- exactly the POLY_G4 colour offsets.
            #
            # Vertices 0 and 2 take the byte triple at the object's +0x6C, and
            # vertices 1 and 3 the triple at +0x70, so the quad is a TWO-colour
            # gradient across one axis rather than four independent corners.
            #
            # Those triples are not literals in the draw function. The object
            # installs its own five-slot method table at +0xC4..+0xD4 in its
            # constructor F0x80084058, and slots +0xCC (0x80083C1C) and +0xD0
            # (0x80083C30) are three-`sb` colour setters -- stgmcard.s
            # L0x00000f6c-L0x00000f74 and L0x00000f80-L0x00000f88. The one call
            # site, F0x80084dcc L237/L239, passes the two colours below.
            "quad": {
                "primitive": "POLY_G4",
                "gp0_code": 0x38,
                "tag_words": 8,
                "colorA": [0x7F, 0x32, 0xF2],   # vertices 0 and 2
                "colorB": [0xD1, 0x2F, 0xDE],   # vertices 1 and 3
                "colorA_hex": "#7F32F2",
                "colorB_hex": "#D12FDE",
                "vertex_colors": [0, 1, 0, 1],  # index into [colorA, colorB]
                # Constructor F0x80084058(0xCD, 0xC1, 0x62, 0xA) -> +0x58 x,
                # +0x5C y, +0x60 width, +0x64 height.
                "x": 0xCD, "y": 0xC1, "w": 0x62, "h": 0xA,
                "rotation": {"full_turn": 0x1000, "clamp": 0xF33,
                             "step": "0x1000 / obj+0x74 per frame"},
                "note": "A 98x10 bar at (205, 193) that turns through almost a "
                        "full revolution while shading from violet to magenta. "
                        "The two triples are plain 0..255 RGB, not the GPU's "
                        "0x80-is-unmodulated texture convention, because the "
                        "polygon carries no texture.",
                "disasm": "F0x80083c50 (build) + F0x80084058 (ctor) + "
                          "F0x80084dcc L237/L239 (the colours) + stgmcard.s "
                          "L0x00000f6c/L0x00000f80 (the setters)",
                "unwired_note": "The walker draws this in the UI lab only. The "
                                "state that raises it is the card-access "
                                "phase, and this port has no memory card to "
                                "check -- faking one would break the rule this "
                                "screen already states, that the card-insert, "
                                "format, block-count and read-error paths have "
                                "no walker equivalent and are not faked.",
            },
        },

        "strings": {
            "source": "~/ddw3/lang_file/dw2003/eng/esmemcrd.toml",
            "all": txt,
            "areaBank": {
                "source": "~/ddw3/lang_file/dw2003/eng/esstarea.toml",
                "base": 0xA9, "all": toml_strings(AREA_STRINGS),
            },
            "placeBank": {
                "source": "~/ddw3/lang_file/dw2003/eng/esshpnam.toml",
                "base": 0x94, "all": toml_strings(PLACE_STRINGS),
            },
        },

        "open_gaps": [
            "The save-record struct (stride 0x44, fields +0x00 name, +0x18 area, "
            "+0x1C place, +0x20 bit, +0x28/+0x2A/+0x2C play time, +0x30.. party "
            "types, +0x3C.. party levels) is read only through this screen; the "
            "producer that fills it has not been traced.",
            "RESOLVED 2026-08-14 (ledger UI-STGMCARD-BIT-LABEL-LOOP-2026-08-14): "
            "the loop runs TWICE and sets BOTH widget 3 and widget 4. The m2c "
            "output showed one iteration because it mishandled the branch DELAY "
            "SLOT: stgmcard.s increments the counter at L0x000006cc before the "
            "loop and again at L0x00000708, which is the delay slot of the "
            "`bnez` at L0x00000704 and therefore executes on the taken path too. "
            "The counter enters at 1, the test is `slti 0x2`, and the widget "
            "pointer at L0x000006e8 is read from s0+0xC with s0 advanced by 4 in "
            "the delay slot at L0x000006fc -- so iteration 1 takes widget 3 and "
            "iteration 2 widget 4. Both carry esmemcrd 0x15, \"BIT\".",
            "No caller of the stgmcard overlay entry has been located, so the "
            "in-game trigger site (inn save points) is not proven from code -- the "
            "same class of gap as stcrdabm and stagslct.",
            "RESOLVED 2026-08-14 (ledger UI-STGMCARD-CLOSE-STAGGER-2026-08-14): "
            "the two flags are deliberately STAGGERED, and the frame does outlive "
            "the record text. F0x800836c4's exit band (screen->unk10 == 2, with "
            "the sub-counter unk14 not yet at the running value) starts the fold "
            "CLOSING via [0x80088790](screen+0x74, 0), clears screen->unk60 and "
            "calls F0x8008316c, which hides all 19 record widgets -- all in the "
            "same step. It clears screen->unk5C, which gates the inner record "
            "frame and the party icons, only on a later pass once the fold-done "
            "poll [0x80088794](screen+0x74) returns non-zero. So the text goes "
            "first and the frame rides the window shut. The opening band passes 1 "
            "to the same fold start. The walker now plays that fold-out when the "
            "file card is left.",
            "MOSTLY RESOLVED 2026-08-14 (ledger "
            "UI-STGMCARD-MESSAGE-BINDING-2026-08-14): all sixteen of "
            "F0x80084dcc's +0x114 resource-string sites are read and every one "
            "of them is now attributed to a widget -- see message_window."
            "binding and message_window.result_messages. The five-line box "
            "takes the waiting messages and the card result, the two-line box "
            "the prompts and outcomes, and YES/NO double as the slot numbers "
            "on the slot chooser. STILL OPEN: lines[0] (+0x14) is bound by "
            "none of those sites, so what it holds is unestablished and the "
            "walker's SAVE/LOAD title there is still an assumption; strings 6 "
            "('Save here?') and 0x10 ('Load which game?') are bound somewhere "
            "other than a +0x114 site and were not traced; and the multi-line "
            "pitch inside one widget is still not decoded -- the walker reuses "
            "the card descriptor table's own 14/15px row pitch.",
            "RESOLVED 2026-08-14 (ledger UI-STGMCARD-TRANSITION-QUAD-2026-08-14): "
            "the primitive is a POLY_G4 (GP0 command 0x38, tag word count 8) and "
            "its four vertex colours are two triples, not four -- vertices 0 and 2 "
            "take screen+0x6C..+0x6E and vertices 1 and 3 take +0x70..+0x72. Both "
            "are set through the object's own method table, slots +0xCC and +0xD0, "
            "whose three-`sb` setters live at stgmcard.s L0x00000f6c and "
            "L0x00000f80; the single call site F0x80084dcc L237/L239 passes "
            "(0x7F, 0x32, 0xF2) and (0xD1, 0x2F, 0xDE). See transition.quad. "
            "STILL OPEN: the pivot offsets at +0x84/+0x88 that the corner loop "
            "subtracts before the transform and adds back after are written by no "
            "decompiled function, so the rotation centre is not established.",
        ],
    }

    OUT.write_text(json.dumps(data, indent=1) + "\n")
    print(f"stgmcard: {len(widgets)} card widgets / {len(icon_frames)} starter "
          f"icon rows / {len(plate_clips)} nameplates -> {OUT.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
