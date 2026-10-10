#!/usr/bin/env python3
"""
Extract the STCRDSHP (Card Shop) chrome layout so the walker renders real
coordinates and real screen-pack art instead of hand-guessed geometry.

Identity (2026-07-12): STCRDSHP is the DW3 CARD BATTLE minigame's SHOP, not
the item shop. Strings ~/ddw3/lang_file/dw2003/eng/escrdshp.toml give the
3-option root menu verbatim: "Buy One Card" (5), "Open Booster" (6), "Edit
Folder" (7). "Edit Folder" hands off into the separate deck-editor overlay
(stcrddek — a different census row; out of scope here). AP/HP (17/18) confirm
individual cards carry the same AP/HP stat pair as escardgm.toml's card-battle
strings.

Reproduce the decompile:
  python3 tools/exe_decomp/overlay_to_fns.py \
    ~/ddw3/asm/dw2003/pro/stcrdshp.s exe-decomp/stcrdshp.fns.s
  python3 tools/exe_decomp/normalize_asm.py \
    exe-decomp/stcrdshp.fns.s exe-decomp/stcrdshp.norm.s
  python3 tools/exe_decomp/decompile_exe.py \
    exe-decomp/stcrdshp.norm.s exe-decomp/stcrdshp_c
(overlay base 0x80082cb0). NOTE: this overlay decompiles far worse than prior
UI overlays (ok=75/311 -- the back two-thirds of the file is card-record/deck
data-table logic, not chrome, and m2c loses the plot there). The 5 draw-ctx-
owning functions (found by grepping `jal F0x8001f648` in stcrdshp.norm.s) and
their 3 ctors all decompiled CLEANLY (0 `Decompilation failure` markers) and
are the source of every constant below.

Pack: STCDSPCS/STCDSPTM (LBA_STCDSPCS_BIN_IDX/LBA_STCDSPTM_BIN_IDX = 0x63e/
0x642 in ~/ddw3/rust/dw2003_exe_data/src/lba.rs), pack handle 0x063E0000,
resolved via `0x80044B38->unk424(handle)` (same mechanism as every other
screen pack). UNLIKE stgtrain/stdglabo/sttrng*, this pack IS already
extracted by the ddw3 splat (~/ddw3/pack/dw2003/screen/stcdsp{cs,tm}) -- no
DISC_PACKS disc-read needed. Registered as a plain PACKS entry in
tools/extract_screen_packs.py ("stcdsp" -> stcdsp_sheet.png/.json, 74 clips /
2 atlases). Card art/icons themselves use the CMFONTCS pack (handle
0x02860000, same as the item shop), addressed by a per-card "family" field
read through the getter `0x80042B98->unk4(cardId)` -- the same shape as the
item-shop icon decode, but the CARD family->clip mapping is NOT re-derived
here (open gap; card-record table itself is undecoded, tracked as CARD-Q001).

Chrome facts (every coordinate is a literal immediate in the decompiled C):

ROOT MENU (F0x80087d00 ctor, RAM 0x80087d00):
  header text (0x1D,0x16)=(29,22); footer "[triangle] Button:Back"
  (0xD3,0xCC)=(211,204); gold BIT digits (kind 3) (0x117,0x1C)=(279,28),
  "BIT" label (kind 3) (0x11A,0x1C)=(282,28); 3 option rows at x=0xA7=167,
  y = 0x35 + 0xE*i = 53,67,81 for i in 0..2 ("Buy One Card"/"Open
  Booster"/"Edit Folder", escrdshp strings 5/6/7); cursor sprite
  (F0x8001b364) created at (0xA7, 0x35+0xE*initial_row); prompt/subtitle
  text (0x9A,0x71)=(154,113).

BUY ONE CARD list -- ctor F0x8008300c + draw F0x80083ba8:
  8-slot icon grid, 2 cols x 4 rows: label x = 0x37 + col*0x83 = 55+131*col,
  y = 0x39 + row*0xE = 57+14*row (ctor); icon draw (CMFONTCS clip = card
  family) at x = 0x28 + col*0x83 = 40+131*col, y = 0x39+row*0xE-0x -- exact
  draw fn form: x=((i%2)*0x83)+0x28, y=((i/2)*0xE)+0x39 (F0x80083ba8), i.e.
  icons sit 15px left of / flush with their labels; stcdsp cell-frame clip
  0x31=49 drawn at the SAME (x,y) as the icon (overlay). Cursor
  (F0x8001b364) at (0x1D,0x39)=(29,57). L1/R1 scroll arrows: clip 0x48=72 at
  (0x1E,0x74)=(30,116) when not at top, clip 0x47=71 at (0xFD,0x74)=
  (253,116) when not at bottom (CLUT-cycled via sp98, 4-step). "L1"/"R1"
  labels (ctor) at (0x2D,0x71)=(45,113)/(0x102,0x71)=(258,113). Info plate
  clip 0x2B=43 at (0,0x32)=(0,50) (drawn whenever the grid is non-empty).

CARD DETAIL / CONFIRM popup -- draw F0x80083ba8 (arg0->unk728 block) and
F0x8008674c (arg0->unkB4 block, identical layout, reused for the folder-grid
cursor's popup):
  AP/HP-or-warning label (escrdshp string 18 "HP" / 19 "Not enough BIT." /
  19+class) at (0x103,0x7E)=(259,126); a second label (string 0xD=13
  "BUY") at (0xFC,0x7C)=(252,124); another at (0x82,0x7C)=(130,124);
  (0x103,0xA4)=(259,164); (0xFC,0xA2)=(252,162); and a bottom line at
  y=0x92=146 that is EITHER escrdshp string 0x0c "{1} BIT" at x=0xc7=199 or
  string 0x0b "R1" at x=0x4a=74. DECODED 2026-08-14: the choice is a 5-way
  match of the selected slot's +0x70 CARD ID against 0x45/0x70/0x9B/0xC6/0xF1
  (stcrdshp.s L0x00001558-L0x000015f4). Those are five real cards, one per
  colour, and they show the R1 hint because they carry no price. The old note
  here read the pair as a "card/stack-explain plate at (11,74)/(12,199)",
  which transposed the string index and the x. See `bottomLine` below.
  F0x8008674c additionally draws a 2-line "explain card" window:
  clip 0x2C=44 at (0x7B,0x33)=(123,51), clip 0x2D=45 at (0xAF,0x50)=
  (175,80) (R1: Explain/Don't-explain toggle, escrdshp strings 30/31).

FOLDER CARD GRID -- draw F0x800857b0 (6 cols, cell pitch 0x2A x 0x36 =
  42x54): card art (CMFONTCS, family field) at x=temp_s5+0x27=42*col+39,
  y=temp_s4+0x65=54*row+101 when a placeholder-sort marker is set (clip
  0x1D=29, "sorted slot" icon), else a per-card 3+2 digit AP/HP readout
  (7px digit pitch) at the same cell, plus the card-back/frame clip
  (spB0->unk0-1) at x=temp_s5+0x23=42*col+35, y=temp_s4+0x44=54*row+68.
  Folder SLOT-COUNT cursor overlay -- draw F0x80085bac: stcdsp clip 6 (a
  card-back silhouette) at x=((i%6)*0x2A)+0x23=42*col+35,
  y=((i/6)*0x36)+0x44=54*row+68 for arg0->unk68 filled slots (CLUT-cycled
  via sp98(arg0->unk70) -- the "only 4 of the same card" full-folder
  indicator, escrdshp string 32).

INPUT (F0x80086ee4, the BUY-list/folder-grid cursor handler): L1/R1 (buttons
  10/11) move the folder page (unk6C, clamped [0, unk70-1]); D-pad moves the
  in-page cursor (unk5C, clamped [0,5]) and re-skips to the old cell if the
  new cell is empty; CONFIRM (button 0xD) reads the card id, looks up its
  price via table 0x8008CB9C(cardId), rejects the purchase into state 0xA/
  message 0x13 ("Not enough BIT.") if the BIT balance [0x80048D34+0x6C] is
  under price, or into state 0xA/message 0x14 ("Too many cards") if the
  card's owned-count field (+0x3A2) reads class 9 (4-of-a-kind cap, matches
  string 32's wording), else proceeds to state 5 (buy confirm); CANCEL
  (button 0xE) plays the resident cancel SFX and returns to state 0x32.

Open gaps (see docs/research/ui/stcrdshp-decoded-2026-07-12.md):
  - RESOLVED: the card record table is decoded and ships. CARD-Q001 is closed
    in docs/research/systems/catalog.json; web/assets/data/card_catalog.json
    carries 316 cards with name, colour, kind, AP/HP, strength rank and effect
    text, alongside card_prices/card_boosters/card_shops/card_starter/
    card_opponents. The live card gap is CARD-Q002 (the card-effect opcode
    handler bodies), which is not chrome.
  - "Open Booster" flow (states referenced by strings 15/16/17/21/23) not
    chrome-traced this session -- shares the same 8-slot grid primitive but
    a distinct state range; open.
  - "Edit Folder" hands off to stcrddek (separate census row); not traced.
  - Which flag-bank index (0x1e..0x30) maps to which of the 8 real-world
    Card Shops (Seiryu/Qing Long/Suzaku/Zhu Que/Byakko/Bai Hu/Genbu/Xuan Wu)
    is unresolved -- extract_merchant_shops.py's D0x8008c000 "param path
    unpinned" note is still open; the walker opens a single undifferentiated
    card-shop screen for every card_shop merchant.

Output: web/assets/data/stcrdshp_ui.json
"""

import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/assets/data/stcrdshp_ui.json"

DATA = {
    "packs": {"chrome": "stcdsp", "cardIcons": "cmfont"},
    "root_menu": {
        "header": [29, 22],
        "footerBack": [211, 204],
        "bitDigits": [279, 28],
        "bitLabel": [282, 28],
        "optionsX": 167,
        "optionsY0": 53,
        "optionsStepY": 14,
        "optionCount": 3,
        "optionStrings": ["Buy One Card", "Open Booster", "Edit Folder"],
        "prompt": [154, 113],
        "disasm": "F0x80087d00",
    },
    "buy_list": {
        "cols": 2,
        "rows": 4,
        "labelX0": 55, "labelStepX": 131,
        "labelY0": 57, "labelStepY": 14,
        "iconX0": 40, "iconStepX": 131,
        "iconY0": 57, "iconStepY": 14,
        "cellFrameClip": 49,
        "cursor": [29, 57],
        "scrollUpClip": 72, "scrollUpXY": [30, 116],
        "scrollDownClip": 71, "scrollDownXY": [253, 116],
        "l1Label": [45, 113], "r1Label": [258, 113],
        "infoPlateClip": 43, "infoPlateXY": [0, 50],
        "disasm": "F0x8008300c (ctor) + F0x80083ba8 (draw)",
    },
    # The detail panel's TEXT, built twice -- F0x8008300c for the buy list and
    # F0x80086074 for the booster panel -- at the same fourteen places. It is
    # the Card Album's popup shape moved up: name, an "X" plus the summon
    # cost, an "X" plus the copies held, the card text, and the AP and HP
    # pairs. Claim CARD-SHOP-DETAIL-TEXT-001.
    "card_detail_text": {
        "disasm": "ctor F0x8008300c (buy list) and F0x80086074 (boosters)",
        "name": {"x": 0x88, "y": 0x80},
        "costLabel": {"x": 0x115, "y": 0x80},
        "cost": {"x": 0x126, "y": 0x80},
        "heldLabel": {"x": 0x115, "y": 0xA6},
        "held": {"x": 0x12C, "y": 0xA6},
        "effect": {"x": 0x50, "y": 0x97},
        "apLabel": {"x": 0xCE, "y": 0x97},
        "ap": {"x": 0xF0, "y": 0x97},
        "hpLabel": {"x": 0xCE, "y": 0xA4},
        "hp": {"x": 0xF0, "y": 0xA4},
    },
    # The buy list's own remaining text, same constructor.
    "buy_list_text": {
        "disasm": "ctor F0x8008300c",
        "page_current": {"x": 0x92, "y": 0x75},
        "page_slash": {"x": 0x93, "y": 0x75},
        "page_total": {"x": 0xA6, "y": 0x75},
        "l1": {"x": 0x2D, "y": 0x71},
        "r1": {"x": 0x102, "y": 0x71},
        "price_current": {"x": 0x8F, "y": 0x8A},
        "price_label": {"x": 0x10B, "y": 0x8A},
        "price_value": {"x": 0x121, "y": 0x8A},
        "desc_line1": {"x": 0x14, "y": 0xC2},
        "desc_line2": {"x": 0x14, "y": 0xD0},
        "list_cursor": {"x": 0x1D, "y": 0x39},
    },
    # The booster panel's own remaining text, F0x80086074.
    "booster_text": {
        "disasm": "ctor F0x80086074",
        "bit_value_k3": {"x": 0x11A, "y": 0xC7},
        "bit_label_k3": {"x": 0x117, "y": 0xC7},
        "l1": {"x": 0x12, "y": 0x67},
        "r1": {"x": 0x121, "y": 0x67},
    },
    # Pictures the buy list and the booster panel draw that our data did not
    # hold. Clip 46 is the frame the selected card's own art sits in, and the
    # computed clip at (128,138) is that art. Clip 42 is the bottom plate,
    # hinged on y 207. Clips 26 and 27 are the booster panel's scroll arrows,
    # the same pair the Card Album uses, and clip 41 is its lower plate.
    "detail_pictures": {
        "disasm": "F0x80083ba8 (buy list) and F0x8008674c (boosters)",
        "card_art_frame": {"clip": 46, "x": 121, "y": 131},
        "card_art": {"x": 128, "y": 138, "clip": "computed from the card id"},
        "bottom_plate": {"clip": 42, "x": 0, "y": 189, "pivot_y": 207},
        "scroll_up": {"clip": 26, "x": 14, "y": 85},
        "scroll_down": {"clip": 27, "x": 289, "y": 85},
        "booster_plate": {"clip": 41, "x": 214, "y": 191},
    },
    "card_detail_popup": {
        "statOrWarnLabel": [259, 126],
        "buyLabel": [252, 124],
        "priceLabel": [130, 124],
        "extra": [[259, 164], [252, 162]],
        "explainWindowClip": 44, "explainWindowXY": [123, 51],
        "explainSubClip": 45, "explainSubXY": [175, 80],
        # DECODED 2026-08-14 -- this is the line the old "0x45/0x70/0x9B/0xC6/
        # 0xF1 5-way magic numbers unexplained" gap was about. They are not
        # magic and they are not a rarity band: they are five CARD IDS, and the
        # branch picks which of two strings goes on the popup's bottom line.
        #
        #   stcrdshp.s L0x00001558  beqz $s4  -> skip the 5-way when the
        #                           purchase-status call already returned
        #                           non-zero (that path takes the same string
        #                           and x as a match).
        #   L0x0000155c..L0x000015a0  $s2 (the selected slot's +0x70 card id)
        #                           compared against 0x45, 0x70, 0x9b, 0xc6,
        #                           0xf1.
        #   match   -> escrdshp string 0x0b "R1"      at x 0x4a (74)
        #   no match-> escrdshp string 0x0c "{1} BIT" at x 0xc7 (199)
        #   both    -> drawn at y 0x92 (146), L0x000015e8-L0x000015f4.
        #
        # So an ordinary card shows its PRICE on that line and these five show
        # the R1 hint instead. The five ids are one per card colour and are
        # exactly the five the catalogue ranks 1st to 5th; no shop stock list,
        # booster pool or starter deck contains any of them.
        "bottomLine": {
            "y": 146,
            "priceString": "bitTotal", "priceX": 199,
            "hintString": "explainHint", "hintX": 74,
            "hintCardIds": [0x45, 0x70, 0x9B, 0xC6, 0xF1],
            "hintCardNames": ["RosemonII", "MarineAngemon", "SaberLeomon",
                              "Gryphonmon", "Creepymon"],
            "note": "hintCardNames is the catalogue lookup of hintCardIds, "
                    "carried so the list can be checked by eye; the ids are "
                    "what the code compares.",
            "disasm": "stcrdshp.s L0x00001558-L0x000015f4",
        },
        "disasm": "F0x80083ba8 (unk728 block) / F0x8008674c (unkB4 block)",
    },
    "folder_grid": {
        "cols": 6,
        "cellW": 42, "cellH": 54,
        "cardArtX0": 39, "cardArtY0": 101,
        "cardBackX0": 35, "cardBackY0": 68,
        "sortedMarkerClip": 29,
        "cursorClip": 6,
        "cursorX0": 35, "cursorStepX": 42,
        "cursorY0": 68, "cursorStepY": 54,
        "disasm": "F0x800857b0 (grid) + F0x80085bac (slot cursor overlay)",
    },
    # F0x800880c4 shop_draw_chrome: after the scrolling wall (clip 8 at the
    # 96-step counter) the root menu draws these plates while their fold
    # words are nonzero. Literal immediates from exe-decomp/stcrdshp_c/F0x800880c4.c.
    "furniture": {
        "titlePlate": {"clip": 0x28, "xy": [0x16, 0x14]},
        "titlePlateB": {"clip": 0x29, "xy": [0xD6, 0x15]},
        "optionPlate": {"clip": 0x2F, "xy": [0x92, 0x2E]},
        "backPlate": {"clip": 0xF, "xy": [0xC6, 0xC4]},
        "extraPlate": {"clip": 0x2C, "xy": [0x7B, 0x6B]},
        "disasm": "F0x800880c4",
    },
    # BUY / NO confirm. Ctor F0x80086074 places the two strings and the
    # cursor widget; buy_flow_tick case 7 moves the cursor with Up/Down
    # (unk94 0..1) at y = 0x56 + 0x10*row. Confirm on row 0 grants one
    # copy — there is no quantity stepper. The symbol-map "choose quantity"
    # row for buy_flow state 2 is the 6-wide stock cursor, not a count.
    "buy_confirm": {
        "prompt": [0x9A, 0x39],
        "buy": [0xC5, 0x56],
        "no": [0xC5, 0x66],
        "cursor": [0xB8, 0x56],
        "cursorStepY": 0x10,
        "disasm": "F0x80086074 + F0x80086dc4 cases 6-7",
    },
    "strings": {
        "source": "~/ddw3/lang_file/dw2003/eng/escrdshp.toml",
        "buyOneCard": "Buy One Card",
        "openBooster": "Open Booster",
        "editFolder": "Edit Folder",
        "back": "[triangle] Button:Back",
        "bit": "BIT",
        "times": "X",         # escrdshp 8, the glyph before a count
        "l1": "L1",            # escrdshp 0x0a
        "r1": "R1",            # escrdshp 0x0b as the L1/R1 pair on the list
        "explainHint": "R1",   # escrdshp 0x0b -- the popup's bottom line for
                               # the five cards that carry no price
        "bitTotal": "{1} BIT",  # escrdshp 0x0c
        "buy": "BUY",
        "no": "NO",
        "openWhichBooster": "Open which booster?",
        "openedBooster": "Opened booster.",
        "ap": "AP",
        "hp": "HP",
        "notEnoughBit": "Not enough BIT.",
        "tooManyCards": "Too many cards",
        "noBoosters": "No boosters",
        "folder1": "Folder 1",
        "folder2": "Folder 2",
        "folder3": "Folder 3",
        "chooseFolder": "Choose a folder.",
        "editFolderTitle": "Edit Folder",
        "changeName": "Change name",
        "explainCard": "R1: Explain Card",
        "dontExplainCard": "R1: Don't explain card",
        "fourCopyLimit": "Only four of the same card\nin one folder.",
        "sort": "[circle] Button:Sort",
    },
    "open_gaps": [
        "RESOLVED -- CARD-Q001 is closed in the catalogue. The card record table ships as web/assets/data/card_catalog.json (316 cards with name, colour, kind, AP/HP, strength rank and effect text) plus card_prices, card_boosters, card_shops, card_starter and card_opponents. The remaining card decode gap is CARD-Q002, the ~175 card-effect opcode handler bodies, which is not a chrome gap for this screen.",
        "Open Booster pack-list chrome is the 8-slot grid (F0x8008300c); Buy One Card is the 6-wide stock row (F0x80086dc4 case 2).",
        "Edit Folder hands off to stcrddek (separate census row)",
        "flag-bank index -> physical card-shop identity unresolved",
    ],
}


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(DATA, indent=1) + "\n")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
