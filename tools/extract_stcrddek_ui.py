#!/usr/bin/env python3
"""
Extract the Card Folder editor's (STCRDDEK) chrome layout so the walker renders
real coordinates and real screen-pack art instead of hand-guessed geometry.

REWRITTEN 2026-08-14. The 2026-07-12 version of this file recorded the same
coordinates under the WRONG identities: it read the overlay as a picker over the
87 preset folder names in ~/ddw3/lang_file/dw2003/eng/escrddek.toml. The overlay
never loads that bank -- F0x8008a100 asks for CARDPAK0..4 and the text banks
+0x16 (CARDNM), +0x1D (CARDST), +0x32 (CRDSHP -- the card shop's bank, which is
where every label on this screen comes from) and +0x86 (NAMEDT), and `0x2b`,
escrddek's own group, does not occur as an immediate anywhere in stcrddek.s.
A name-matched language file is not evidence that an overlay reads it.

See docs/research/ui/card-folder-editor-2026-08-14.md for the full decode. The
screen is three surfaces, not the three that were recorded:

FOLDER LIST -- ctor F0x80088b34, draw F0x80088e74, state machine F0x80089354.
  One prompt label at (0x97,0x22)=(151,34): card-shop bank string 0x19,
  "Choose a folder." Then THREE groups, one per saved folder: a name label at
  (0x1C, 0x53+0x2D*g) = (28, 83/128/173), and six counter labels at
  (0x3B+0x23*i, 0x64+0x2D*g), x = 59/94/129/164/199/234. The six counters are
  the folder's COLOUR SPREAD: F0x8008924c zeroes six counters per folder, walks
  its 40 slots, and increments counter[catalog colour byte - 1].
  The draw puts a row icon (clip 0x41) at (0x17, 0x50+0x2D*row) = (23,
  80/125/170) with the blinking highlight 0x42 (or the static 0x44 once
  confirmed) over the selected row -- three rows because there are three
  folders, which is also why the cursor clamps to 0..2.
  Confirming opens a two-row submenu at (167,35) and (167,49) -- bank strings
  0x1A "Edit Folder" and 0x1B "Change name" -- with its cursor at
  (0x9A,0x23)=(154,35), stepping 0xE to (154,49).

FOLDER GRID (the 40 slots) -- draw F0x800835d8: col = i%9, row = i/9,
  x = col*32+16, y = row*32+58, icon clip = (card colour byte) + 0x52 from the
  stcdsp pack. F0x800837b4 deals the cards out one per frame and stops at 40.
  The cursor clamps make the shape explicit: four rows of nine plus a last row
  of four.

EDITOR CHROME -- ctor F0x8008397c, draw F0x80084890:
  header0 (193,23) and header1 (21,24); the SIX colour counters of the folder
  being edited at x = 0x34+0x23*i = 52..227, y = 0x29 = 41 (the "6-wide tab
  strip" the July pass could not explain); the eight swap-list rows at
  y = 0x27+0xE*i = 39..137 with their three text columns at x = 163/273/288
  (card name, the "X" string, and how many you may still place -- F0x80084278);
  the grid cursor sprite, clip 0x43 with a six-frame CLUT pulse every fifth
  tick, at ((col<<5)|0x10, (row<<5)+0x3A) -- i.e. on the grid, not the list.
  The swap list's icon column is x = 0x94 = 148 with cell frame clip 0x31, and
  its L1/R1 scroll arrows (clip 0x45 at (294,34), clip 0x46 at (294,143)) blink
  every ninth tick and appear only when the list is nine entries or longer.
  Two card-detail popups share one shape: the grid card's at the top (labels
  (259,36)/(252,34), frame 0xB at (74,18) or 0xC at (199,18)) and the swap
  list's at the bottom (labels (259,159)/(252,157), frame at y=179, fold pivot
  (320,168), fixed clip 0xA at (130,157)). The five-way branch on card ids
  0x45/0x70/0x9B/0xC6/0xF1 inside them is the card-detail bottom line, decoded
  in docs/research/ui/card-detail-bottom-line-2026-08-14.md.

Reproduce the decompile:
  python3 tools/exe_decomp/overlay_to_fns.py \
    ~/ddw3/asm/dw2003/pro/stcrddek.s exe-decomp/stcrddek.fns.s
  python3 tools/exe_decomp/normalize_asm.py \
    exe-decomp/stcrddek.fns.s exe-decomp/stcrddek.norm.s
  python3 tools/exe_decomp/decompile_exe.py \
    exe-decomp/stcrddek.norm.s exe-decomp/stcrddek_c
(overlay base 0x80082cb0; ok=95/102.)

Packs: chrome is STCDSPCS/STCDSPTM (handle 0x063E0000), the same card-shop pack
stcrdshp and stcrdabm use, registered as "stcdsp". The rename keyboard pulls
NAMEDTCS/NAMEDTTM (handle 0x77000000), registered as "namedt".

Output: web/assets/data/stcrddek_ui.json
"""

import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/assets/data/stcrddek_ui.json"

# Card-shop bank (escrdshp.toml) strings this screen draws. The folder editor
# has no string bank of its own -- see the module note.
STRINGS = {
    "back": "[triangle] Button:Back",          # 0x04, the editor's fixed header
    "countX": "X",                             # 0x08, between a card and its count
    "ap": "AP",                                # 0x11
    "hp": "HP",                                # 0x12
    "chooseFolder": "Choose a folder.",        # 0x19
    "editFolder": "Edit Folder",               # 0x1a
    "changeName": "Change name",               # 0x1b
    "explainOn": "R1: Explain Card",           # 0x1c
    "explainOff": "R1: Don't explain card",    # 0x1d
    "tooManyCopies": "Only four of the same card\nin one folder.",  # 0x1e
    "sort": "[circle] Button:Sort",            # 0x1f
    # The rename keyboard is NAMEDT, not this overlay's pack; these two
    # come from esnamedt (string 1 and 0x12). Ledger
    # UI-CARDDECK-RENAME-KEYBOARD-2026-08-14.
    "enterName": "Enter Name",
    "nameNotAllowed": "That name is not allowed.",
    "renameDisasm": "NAMEDT string 1 / 0x12; ledger UI-CARDDECK-RENAME-KEYBOARD-2026-08-14",
}

DATA = {
    "packs": {"chrome": "stcdsp", "nameEntry": "namedt"},
    "strings": STRINGS,
    "rules": {
        "folders": 3,
        "folderSize": 40,
        "maxCopiesPerFolder": 4,
        "nameLength": 10,
        "colours": ["white", "blue", "green", "red", "black", "brown"],
    },
    "folder_list": {
        "prompt": [151, 34],
        "rows": 3,
        "nameX": 28, "nameY0": 83, "nameYStep": 45,
        "counters": 6, "counterX0": 59, "counterXStep": 35,
        "counterY0": 100, "counterYStep": 45,
        "rowIconClip": 0x41, "rowIconX": 23, "rowIconY0": 80, "rowIconYStep": 45,
        "highlightClipPulse": 0x42, "highlightClipStatic": 0x44,
        "bounceIconClip": 8, "bounceIconRange": [0, 0x60],
        "headerClipA": 0x30, "headerXYA": [123, 28],
        "headerClipB": 0x2D, "headerXYB": [146, 28],
        "options": [[167, 35], [167, 49]],
        "optionCursor": [154, 35], "optionCursorYStep": 14,
        "disasm": "F0x80088b34 (ctor), F0x80088e74 (draw), F0x80089354 (states)",
    },
    "folder_grid": {
        "cols": 9, "cellW": 32, "cellH": 32, "x0": 16, "y0": 58,
        "slots": 40, "lastRowCols": 4,
        "iconClipFieldOffset": 0x52,
        "cursorClip": 0x43, "cursorFrames": 6, "cursorTicks": 5,
        "disasm": "F0x800835d8 (draw), F0x800837b4 (deal-in)",
    },
    "editor": {
        "header0": [193, 23], "header1": [21, 24],
        "colourCounters": {"x0": 52, "xStep": 35, "count": 6, "y": 41},
        "swapList": {
            "cols": [163, 273, 288], "y0": 39, "yStep": 14, "rows": 8,
            "iconX": 148, "cellFrameClip": 0x31,
            "scrollUpClip": 0x45, "scrollUpXY": [294, 34],
            "scrollDownClip": 0x46, "scrollDownXY": [294, 143],
            "scrollArrowsFrom": 9, "scrollBlinkTicks": 9, "pageStep": 7,
            "headerClip": 0x3F, "headerXY": [129, 30],
        },
        "cursor": [137, 39],
        "statTop": {"pairA": [277, 38], "pairB": [294, 38],
                    "quadA": [80, 23], "quadB": [206, 23], "quadC": [240, 23],
                    "quadD": [206, 36], "quadE": [240, 36]},
        "statBottom": {"pairA": [136, 161], "pairB": [277, 161], "pairC": [294, 161],
                       "quadA": [80, 184], "quadB": [206, 184], "quadC": [240, 184],
                       "quadD": [206, 197], "quadE": [240, 197]},
        "prompt": [62, 107],
        # The card under the folder-grid cursor, named under the grid, and the
        # footer line under that. F0x8008397c builds them at (0x96,0xBD) and
        # (0x96,0xCC); F0x80083d28 fills the first from escardnm by card id and
        # the second from escrdshp: index 31 "[circle] Button:Sort" while the
        # message timer (+0x440) has run past 0x3C, else 0x1C + the message
        # selector (+0x43C), which is 28 "R1: Explain Card", 29 "R1: Don't
        # explain card" or 30 "Only four of the same card in one folder."
        "cardName": [150, 189],
        "footerLine": [150, 204],
        "footerSteadyStr": 31,
        "footerMessageStrBase": 28,
        "footerMessageVsync": 0x3C,
        # The editor's own window, and the message plate that folds up over it.
        # F0x80084890: clip 0x40 at (0x10,0x15) scaled about (0xA0,0x74), and
        # clip 0x36 at (0,0x64) scaled about (0,0x78) one bucket in front.
        "window": {"clip": 0x40, "x": 16, "y": 21, "pivot": [160, 116]},
        "messageBar": {"clip": 0x36, "x": 0, "y": 100, "pivot": [0, 120]},
        "footerCycleTicks": 120,
        "detailTop": {
            "frameClipA": 0xB, "frameClipB": 0xC,
            "xyA": [74, 18], "xyB": [199, 18],
            "labels": [[259, 36], [252, 34]],
        },
        "detailBottom": {
            "frameClipA": 0xB, "frameClipB": 0xC,
            "xyA": [74, 179], "xyB": [199, 179],
            "pivot": [320, 168],
            "labels": [[259, 159], [252, 157], [130, 157], [259, 179]],
            "fixedLabelClip": 0xA, "fixedLabelXY": [130, 157],
            "bottomLineCardIds": [0x45, 0x70, 0x9B, 0xC6, 0xF1],
        },
        "disasm": "F0x8008397c (ctor), F0x80084890 (draw), F0x80085210 (states)",
    },
    "open_gaps": [
        "Which colour is which counter is inferred from the catalog's colour byte order (white/blue/green/red/black/brown, tools/extract_card_catalog.py:104). The folder list itself only proves there are six and that counter i counts colour byte i+1.",
        "RESOLVED 2026-09-03: the editor ctor's statTop/statBottom widgets are now matched to their fill sites in F0x80083d28, which uses the same shape the Card Album's F0x800840ac uses. pairA/pairB of statTop and pairB/pairC of statBottom are escrdshp string 8 \"X\" plus the card's summon cost (CARDPAK +0x05); statBottom pairA is the card name from escardnm; quadA is the card text from escardst, shown for a Program card and for the five Digimon in bottomLineCardIds; quadB/quadC and quadD/quadE are the AP and HP label/value pairs, shown for every other Digimon card.",
        "RESOLVED 2026-09-03: the page count is NOT installed at runtime by something unreachable -- F0x800884e8 writes it before the keyboard is built. Japanese (language index 0 at 0x8005CCA8) gets 3 pages and the tables at 0x8008B368/0x8008B38C; every other language gets 1 page and 0x8008B604/0x8008B610. Because English has ONE page, F0x80086e04's page arrows (NAMEDT clips 0x32/0x33 at (10,94) and (281,94), CLUT-cycled from the 6-entry table at 0x8008B818 every 7 vsync) never appear in the English game -- their gate is [0x8008B848] >= 2. Still open: the character tables' own contents, which are pack data rather than code. Bindings that ARE decoded: ledger UI-CARDDECK-RENAME-KEYBOARD-2026-08-14, string 1 'Enter Name', 0x12 'That name is not allowed.'",
        "What the 87 names in escrddek.toml are for. They are real shipped data and something loads bank group 0x2b; this overlay does not. Likely candidates -- the duel naming an opponent's folder, or the routine that hands you your first folders -- were not searched.",
    ],
}


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(DATA, indent=1) + "\n")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
