#!/usr/bin/env python3
"""
Extract the STCRDABM (Card Album) chrome layout so the walker renders real
coordinates and real screen-pack art instead of hand-guessed geometry.

Identity (2026-07-12): STCRDABM is the DW3 CARD BATTLE minigame's "Card
Album" -- a browse-only 6-column grid of every card in the 315-card catalog
(0x13B = 315, the same absolute card-id space used by stcrdshp), showing an
owned/AP/HP readout for owned cards and an unowned placeholder for the rest.
Ground truth: ~/ddw3/lang_file/dw2003/eng/escrdabm.toml (this overlay's own
string bank) is a literal 9-string set with no menu options, only chrome
labels:
  ["", "Card Album", "[triangle] Button: Back", "L1", "R1", "/", "AP", "HP", "X"]
-- there is no "root menu" the way stcrdshp has one; the album IS the grid
screen. This confirms and narrows the census guess ("card album" -> browse
collected cards, not an editor).

Reproduce the decompile:
  python3 tools/exe_decomp/overlay_to_fns.py \
    ~/ddw3/asm/dw2003/pro/stcrdabm.s exe-decomp/stcrdabm.fns.s
  python3 tools/exe_decomp/normalize_asm.py \
    exe-decomp/stcrdabm.fns.s exe-decomp/stcrdabm.norm.s
  python3 tools/exe_decomp/decompile_exe.py \
    exe-decomp/stcrdabm.norm.s exe-decomp/stcrdabm_c
(overlay base 0x80082cb0). This overlay decompiles MUCH better than
stcrdshp: ok=32/33, only ONE `Decompilation failure` marker
(F0x80084c38 -- a 54-entry state-dispatch jump table at overlay-base
0x80082cb0..0x80082d84, hand-transcribed below via
`tools/overlay_scan.py words stcrdabm 0x80082cb0 0xd8`; every other function,
including all 3 draw-ctx owners, is clean).

Pack: STALBMCS/STALBMTM (LBA_STALBMCS_BIN_IDX/LBA_STALBMTM_BIN_IDX = 0x605/
0x606 in ~/ddw3/rust/dw2003_exe_data/src/lba.rs), pack handle 0x06050000,
resolved via `0x80044B38->unk424(handle)` (the standard mechanism, same as
stcdsp). Like stcdsp, this pack IS already extracted by the ddw3 splat
(~/ddw3/pack/dw2003/screen/stalbm{cs,tm}) -- no DISC_PACKS handling needed.
Registered as a plain PACKS entry "stalbm" in tools/extract_screen_packs.py.
A second handle `0x80044F5C(0x06050000)` (note: F5C not B38 -- a different
resident getter, same handle argument) is used for a handful of clips
(scroll arrows clip 0x1A/0x1B, grid cursor clip 7) -- transcribed verbatim,
not re-derived; both resolve into the same stalbm pack in every observed
call site.

Chrome facts (every coordinate is a literal immediate in the decompiled C).
Draw-ctx-owning functions found by grepping `jal F0x8001f648` in
stcrdabm.norm.s: F0x80083174 (grid cells), F0x800835bc (grid selection
overlay), F0x80084500 (page chrome + popups). All three decompiled cleanly.

PAGE CHROME -- ctor F0x80083bfc + label-fill F0x80083e14 (called with
  arg2=1 to show / arg2=0 to hide before the card-count is known):
  header "Card Album" (escrdabm string 1) at (0x10,0x19)=(16,25); footer
  "[triangle] Button: Back" (string 2) at (0xD0,0x19)=(208,25); current-page
  gold digits (kind 3, arg0->unk60+1) at (0x34,0x9E)=(52,158); "/" (string 5)
  at (0x35,0x9E)=(53,158); total-page gold digits (arg0->unk64) at
  (0x4A,0x9E)=(74,158); "L1" (string 3, shown only if unk60>0) at
  (0x12,0x6C)=(18,108); "R1" (string 4, shown only if unk60<unk64-1) at
  (0x121,0x6C)=(289,108).

GRID -- draw F0x80083174: 6 columns, cell pitch 0x2A x 0x36 = 42x54, over the
  full 0x13B=315-card absolute id space (col=i%6, row=i/6, temp_s3=col*42,
  temp_s2=row*54). For an OWNED card ((cardId+0x80048D34)->unk4DF != 0):
  if sp100()!=0 ("mystery/undexed" mode) draws a single count clip 0x1D=29
  at (temp_s3+0x27,temp_s2+0x53)=(col*42+39,row*54+83); else draws a 3-digit
  AP readout (7px pitch) at (temp_s3+0x27+7*i,temp_s2+0x53) and a 2-digit HP
  readout at (temp_s3+0x3A+7*i,temp_s2+0x53) -- both from the shared
  per-card record struct read via F0x8001ebf8 (spB0), fields unk1 (AP tens/
  units) and unk2 (HP tens/units), IDENTICAL struct shape to stcrdshp's
  card-detail popup (see docs/research/ui/stcrdshp-decoded-2026-07-12.md
  Sec 2 "CARD DETAIL / CONFIRM popup"). The card-family frame clip
  (spB0->unk0-1) is then drawn at (temp_s3+0x23,temp_s2+0x32)=
  (col*42+35,row*54+50). For an UNOWNED or out-of-range (>=0x13B) slot: a
  generic placeholder clip 6 (card-back silhouette, same clip id as
  stcrdshp's folder-grid card-back) is drawn at the same (col*42+35,
  row*54+50) instead.

GRID SELECTION OVERLAY -- draw F0x800835bc: for each of arg0->unk68 visible
  cells this vsync, draws clip 6 at (col*42+35,row*54+50) again, CLUT-cycled
  via sp98(arg0->unk70) when the underlying slot is owned-and-in-range,
  sp98(0) otherwise -- a highlight/pulse pass layered on top of the base
  grid, not a separate cursor (the actual cursor is drawn by F0x80084500,
  below).

PAGE-LEVEL CHROME + POPUPS -- draw F0x80084500:
  - a small bouncing corner icon: clip 8 at (n,n) where n = arg0->unk58,
    incremented by 1 every OTHER vsync (arg0->unk5C toggles 0/1) and clamped
    to [0,0x60) -- a diagonal pulse animation, not otherwise explained.
  - a fold-in popup window (only when arg0->unkC0 != 0): clip 9 at (0,0x15)=
    (0,21) with scale tween(unkC0,0x1000,0x1000) pivot (0,0x20)=(0,32); clip
    0xF at (0xC8,0x15)=(200,21) pivot (0x140,0x20)=(320,32); clip 0xE at
    (0x22,0x9A)=(34,154) pivot (0x3A,0xA5)=(58,165) -- the generic linear
    8.8 window-fold tween documented for shop/stgtrain, reused verbatim
    (unkC0 is the fold value, 0x1000=1.0).
  - L1/R1 scroll-page arrows (shown only if arg0->unk68!=0 and
    arg0->unk64>=2, blinking every 0x11=17 ticks via unk6C): clip 0x1A=26
    at (0xE,0x5A)=(14,90) when unk60>0; clip 0x1B=27 at (0x121,0x5A)=
    (289,90) when unk60<unk64-1.
  - the real GRID CURSOR (shown only if arg0->unk7C!=0, i.e. this page has
    at least one owned card): clip 7 at ((unk74%6)*42+36,(unk74/6)*54+50),
    CLUT-cycled via a 6-step table at 0x80085A4C indexed by unk80, advancing
    every 17 ticks (unkB4/unkB0).
  - CARD DETAIL POPUP (shown only if arg0->unkD0!=0, i.e. a card is
    selected): the same five-way compare on the selected card id
    (temp_a0_4==0x45|0x70|0x9B|0xC6|0xF1) that stcrdshp's popup uses, and the
    same pair of outcomes -- string 0x0b at x 0x4A=74 versus string 0x0c at
    x 0xC7=199, here on the album's own line y 0xB3=179 rather than the shop's
    146. DECODED 2026-08-14 for the shop (see
    docs/research/ui/card-detail-bottom-line-2026-08-14.md): the five are card
    ids, not a class, and the line is the card's PRICE except for the five that
    have none. NOTE: 0x0b/0x0c are string indices and 74/199 are x -- the old
    note here read them as two clip ids. Which string bank the ALBUM feeds them
    from was not re-read; escrdabm.toml has only 9 strings, so it is not this
    overlay's own bank. There is a fold-scale tween
    on unkD0 (pivot (0x140,0xA8)=(320,168) / (0x140,0xC6)=(320,198)). Label
    text (from a 3-way sp100() switch, same shape as stcrdshp): a stat-or-
    warning label at (0x103,0x9F)=(259,159); a second label at (0xFC,0x9D)=
    (252,157); a third at (0x82,0x9D)=(130,157); a fourth pair at
    (0x103,0xC5)=(259,197) / (0xFC,0xC3)=(252,195).

CARD-NAME / CARD-TEXT STRING BANKS -- RESOLVED 2026-08-14. The card-detail
  populating function F0x800840ac reads text through
  `0x80044B38->unk414(*(s32*)0x8005CCA8 + BANK_OFFSET)` with BANK_OFFSET 0x16
  and 0x1D, both DISTINCT from this overlay's own +0x24 (escrdabm.toml) bank.
  `0x8005cca8` is the LANGUAGE index, 0..6 (see `./dw3-research languages`),
  so each of these is a base + language and each names one of a run of seven
  consecutive LBA entries in ~/ddw3/rust/dw2003_exe_data/src/lba.rs:

    0x16 = 22 -> LBA_{MS,US,ES,FS,IS,DS,SS}CARDNM_BIN_IDX = 22..28
    0x1D = 29 -> LBA_{MS,US,ES,FS,IS,DS,SS}CARDST_BIN_IDX = 29..35

  The MS/US/ES/FS/IS/DS/SS prefixes run in exactly the decoded language order
  jpn/usa/eng/fra/ita/ger/spn, which is a third independent reproduction of
  that table.

  So +0x16 is the card NAME bank (eng = LBA 24 = escardnm.toml) and +0x1D is
  the card TEXT bank (eng = LBA 31 = escardst.toml) -- the effect/description
  line, NOT the "mystery/class label" the old note called it. Both already
  ship: all 316 names in web/assets/data/card_catalog.json match escardnm
  index for index, and the catalogue's `effect` field is escardst.

INPUT / STATE MACHINE -- state-dispatch table at overlay base 0x80082cb0
  (0x36=54 entries, hand-read via overlay_scan words, F0x80084c38's failed
  jump table): state 0 (F0x80084c8c) recomputes the current page's 12
  owned/unowned flags (F0x80084bc8, arg0+0..0x2C stride 4, unk80 field) and
  starts the input-tracker object (F0x80083a78); state 4 (F0x80084d2c) is
  the D-pad/L1/R1 navigation handler: L1/R1 page (unk60, clamped
  [0,unk64-1]), D-pad moves the in-page cursor (unk74, clamped [0,11]) with
  the SAME "snap to nearest non-empty cell" search as stcrdshp's folder-grid
  handler, CONFIRM (state jumps into F0x800853ec/0x10, which opens the
  detail popup via F0x800840ac(...,1)) and CANCEL (button 0xE plays the
  resident cancel SFX 0x800450BD, sets state 0x32, starts a fold-out
  transition via F0x80083008(...,0,0xA) -- the same 10-step linear tween as
  every other census row). States 0x31-0x34 (F0x80085468/85488/854d0/85500)
  are the close-popup / close-screen sequence, ending in a callback
  `arg0->unk28(arg0,3)` (the generic "return to caller" hook seen in the
  other UI overlays).

Open gaps (mirrors stcrdshp's Sec 4, plus the entry-point gap):
  - The card-record table (id -> AP/HP/family/rarity/price/name) is
    undecoded -- CARD-Q001. Without it there is no real catalog to render;
    the walker ships the real 6-col grid chrome with a real "no cards
    owned" empty state instead of invented card data (see web/cardalbum.js).
  - RESOLVED 2026-08-14: both shared banks are base + the language index at
    0x8005cca8 -- +0x16 is the CARDNM run (LBA 22..28, eng escardnm.toml, the
    card names) and +0x1D the CARDST run (LBA 29..35, eng escardst.toml, the
    card text). Both already ship in card_catalog.json.
  - No caller of the stcrdabm overlay entry (LBA_STCRDABM_PRO_IDX=389) was
    found by string/const search this session -- the real-world trigger
    site (pause-menu option? NPC desk?) is UNRESOLVED; the walker screen is
    built but not wired into a story/menu trigger (see web/cardalbum.js
    header and docs/research/ui/stcrdabm-decoded-2026-07-12.md Sec 5).
  - The 0x45/0x70/0x9B/0xC6/0xF1 5-way card-class magic numbers are
    transcribed (again) but not semantically explained (same open item as
    stcrdshp).

Output: web/assets/data/stcrdabm_ui.json
"""

import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/assets/data/stcrdabm_ui.json"

DATA = {
    "packs": {"chrome": "stalbm"},
    "page_chrome": {
        "header": [16, 25],
        "footerBack": [208, 25],
        "pageDigits": [52, 158],
        "pageSlash": [53, 158],
        "pageTotalDigits": [74, 158],
        "l1Label": [18, 108],
        "r1Label": [289, 108],
        "disasm": "F0x80083bfc (ctor) + F0x80083e14 (label fill)",
    },
    "grid": {
        "cols": 6,
        "cellW": 42,
        "cellH": 54,
        "cardCountAbs": 0x13B,
        "ownedCountClip": 29,
        "ownedCountXY": [39, 83],
        "apDigitsX0": 39, "apDigitsY": 83, "apDigitStep": 7,
        "hpDigitsX0": 58, "hpDigitsY": 83, "hpDigitStep": 7,
        "familyFrameX0": 35, "familyFrameY0": 50,
        "unownedPlaceholderClip": 6,
        # Decoded 2026-08-14, docs/research/ui/card-album-screen-2026-08-14.md.
        # The cell's stat line is drawn from the pack's own digit strip at
        # y=159 of stalbm_sheet.png, which reads "/ (P) 0123456789":
        #   clip 0x1C  8x12  the "/" between the AP and HP numbers, at x+0x35
        #   clip 0x1D 32x12  the "(P)" plate, drawn INSTEAD of the numbers
        #                    when the card's record type says it is a Program
        #                    card, at the AP digits' own x+0x27
        #   clip 0x1E..0x27  the ten digit glyphs, value + 0x1E
        # Leading zeros are suppressed: F0x80083174 skips the tens slot when
        # value/10 is zero rather than shifting the units left.
        "digitClipBase": 0x1E,
        "separatorClip": 0x1C, "separatorX0": 53,
        "programPlateClip": 0x1D, "programPlateX0": 39,
        "statLineY": 83,
        "suppressLeadingZero": True,
        "disasm": "F0x80083174",
    },
    "grid_selection_overlay": {
        "clip": 6,
        "x0": 35, "y0": 50,
        "disasm": "F0x800835bc",
    },
    "page_popups": {
        "bounceIconClip": 8,
        "bounceIconRange": [0, 0x60],
        "foldWindow": {
            "clip9": {"clip": 9, "xy": [0, 21], "pivot": [0, 32]},
            "clip15": {"clip": 15, "xy": [200, 21], "pivot": [320, 32]},
            "clip14": {"clip": 14, "xy": [34, 154], "pivot": [58, 165]},
        },
        "scrollUp": {"clip": 26, "xy": [14, 90]},
        "scrollDown": {"clip": 27, "xy": [289, 90]},
        # F0x80084500 unk6C period 0x11 vsyncs.
        "scrollBlinkTicks": 0x11,
        "cursor": {"clip": 7, "x0": 36, "xStep": 42, "y0": 50, "yStep": 54},
        "cardDetailPopup": {
            "frameClipA": 11, "frameClipB": 12,
            "xyA": [74, 179], "xyB": [199, 179],
            "pivotA": [320, 168], "pivotB": [320, 198],
            "labels": [[259, 159], [252, 157], [130, 157], [259, 197], [252, 195]],
            "classMagicNumbers": [0x45, 0x70, 0x9B, 0xC6, 0xF1],
            # The popup's TEXT, as opposed to its pictures above. The screen
            # object builds 17 kind-1 text widgets in F0x80083bfc; seven are
            # the page chrome and these ten are the popup. F0x800840ac fills
            # them and decides which are shown:
            #   name           always, escardnm[card id]        (widget +0x1C)
            #   costLabel/cost Digimon cards only, escrdabm 8 "X" plus
            #                  CARDPAK +0x05, the summon cost  (+0x20, +0x24)
            #   heldLabel/held always, "X" plus the copy count
            #                  at 0x80048D34 +0x3A2 +card id   (+0x28, +0x2C)
            #   effect         Program cards, and the five special Digimon
            #                  in classMagicNumbers, escardst  (+0x30)
            #   ap/hp          Digimon cards except those five, escrdabm 6
            #                  and 7 plus CARDPAK +0x01/+0x02
            #                                        (+0x34,+0x38,+0x3C,+0x40)
            "text": {
                "name": {"x": 136, "y": 161},
                "costLabel": {"x": 277, "y": 161, "str": 8},
                "cost": {"x": 294, "y": 161},
                "heldLabel": {"x": 277, "y": 199, "str": 8},
                "held": {"x": 300, "y": 199},
                "effect": {"x": 80, "y": 184},
                "apLabel": {"x": 206, "y": 184, "str": 6},
                "ap": {"x": 240, "y": 184},
                "hpLabel": {"x": 206, "y": 197, "str": 7},
                "hp": {"x": 240, "y": 197},
                "disasm": "ctor F0x80083bfc widgets +0x1C..+0x40; fill F0x800840ac",
            },
        },
        "disasm": "F0x80084500",
    },
    "strings": {
        "source": "~/ddw3/lang_file/dw2003/eng/escrdabm.toml",
        "title": "Card Album",
        "back": "[triangle] Button: Back",
        "l1": "L1",
        "r1": "R1",
        "slash": "/",
        "ap": "AP",
        "hp": "HP",
        "close": "X",
    },
    "open_gaps": [
        "RESOLVED -- CARD-Q001 is closed in the catalogue. The card record table ships as web/assets/data/card_catalog.json (316 cards with name, colour, kind, AP/HP, strength rank and effect text) plus card_prices, card_boosters, card_shops, card_starter and card_opponents. The remaining card decode gap is CARD-Q002, the ~175 card-effect opcode handler bodies, which is not a chrome gap for this screen.",
        "RESOLVED 2026-08-14 (ledger UI-CARDTEXT-BANKS-ARE-LANGUAGE-RUNS-2026-08-14): both banks are base + the language index at 0x8005cca8. +0x16 is LBA 22..28, the seven CARDNM files, so eng is escardnm.toml, the card NAMES; +0x1D is LBA 29..35, the seven CARDST files, so eng is escardst.toml, the card TEXT (effect/description) -- not a class label. Both already ship: all 316 names in card_catalog.json match escardnm index for index.",
        "no caller of the stcrdabm overlay entry (LBA idx 389) found -- real trigger site unresolved, screen built but unwired",
        "RESOLVED 2026-08-14 (ledger UI-CARDSHOP-DETAIL-BOTTOM-LINE-2026-08-14): the 0x45/0x70/0x9B/0xC6/0xF1 five-way is not a card class or a rarity band. They are five CARD IDS -- RosemonII, MarineAngemon, SaberLeomon, Gryphonmon and Creepymon, one per colour and the five the catalogue ranks highest -- and the branch only chooses the card detail popup's bottom line: those five show the 'R1' hint where every other card shows its price. See docs/research/ui/card-detail-bottom-line-2026-08-14.md.",
    ],
}


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(DATA, indent=1) + "\n")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
