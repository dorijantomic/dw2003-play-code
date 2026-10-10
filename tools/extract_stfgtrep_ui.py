#!/usr/bin/env python3
"""
Extract the STFGTREP (post-battle fight-report screen) chrome layout so the
walker renders real coordinates and real screen-pack art instead of the
hand-guessed win/lose panel text in web/battle.js.

Census row: `stfgtrep | battle result/report | check -- may be the post-battle
EXP screen`. CONFIRMED: stfgtrep is exactly that screen -- the multi-page
report shown after a won battle (EXP/BIT/DVEXP totals, level-up, tech/
digivolve learned, item drop), one page per esfgtrpt string ("EXP gained" /
"Level gained!" / "Learned Tech" / "{1} Level {2}!" / "Digivolve learned" /
"BIT gained" / "Item gained"). The underlying NUMERICS (EXP curve, per-battle
reward table, DVEXP bank, stat rolls) were already fully decoded --
docs/research/battle/exp-levelup-rewards-decoded-2026-07-10.md -- this only
covers the screen's geometry/art (the doc's own citations, e.g.
"battle id index 0x80086a88", "stfgtrep 0x80086184" level-up loop, are
REUSED here verbatim, not re-derived).

Decode sources:
  ~/ddw3/asm/dw2003/pro/stfgtrep.s (overlay, RAM base 0x80082cb0). Reproduce
  the decompile:
    python3 tools/exe_decomp/overlay_to_fns.py \
      ~/ddw3/asm/dw2003/pro/stfgtrep.s exe-decomp/stfgtrep.fns.s
    python3 tools/exe_decomp/normalize_asm.py \
      exe-decomp/stfgtrep.fns.s exe-decomp/stfgtrep.norm.s
    python3 tools/exe_decomp/decompile_exe.py \
      exe-decomp/stfgtrep.norm.s exe-decomp/stfgtrep_c
  (43/48 fns decompiled cleanly; 5 failures are unrelated numeric helpers,
  not chrome-owning -- grep "Decompilation failure" in exe-decomp/stfgtrep_c/
  to reproduce the list.)

  Pack: STFRPTCS/STFRPTTM (LBA_STFRPTCS_BIN_IDX/LBA_STFRPTTM_BIN_IDX = 1951/
  1952 in ~/ddw3/rust/dw2003_exe_data/src/lba.rs; pack handle 0x079F0000 seen
  at every sp94() call site below -- high u16 0x079F = 1951 decimal, matching
  the LBA index directly, same convention as cmfont's 0x0286=646). Unlike
  sttrng/stdglabo this pack IS present in the normal ddw3 splat
  (~/ddw3/pack/dw2003/screen/stfrptcs, stfrpttm) and follows the same
  cs/tm-subdir-0 shape as stcdsp/stalbm/ststat, so it needed only ONE new
  entry ("stfrpt") in tools/extract_screen_packs.py:PACKS -- no DISC_PACKS
  disc-read plumbing. 38 clips / 44 atlas frames, 1 atlas page.
  The blink/"press button" cursor (see next section) uses the SHARED
  cmfont pack (handle 0x02860000, already extracted as "cmfont"), clip 10,
  which is the SAME clip already registered in CLUT_CYCLES["cmfont"][10]=5
  (footer blink arrow reused verbatim from every other menu screen).

Chrome facts (every coordinate is a literal immediate in the decompiled C;
provenance per block):

  * Report-page background (F0x80084c20, the fn holding the F0x8001f648
    draw-ctx acquisition + sp84(0x280,0) screen-pack mode):
      - message backdrop bar: clip 0x1D=29 (296x38 composite), placed at
        (0xB,0xBC)=(11,188) -- sits directly under the message-text anchor
        (20,194) below, so this is the report's bottom message panel, not a
        header (native y=188 is near the SCREEN BOTTOM, 240 tall). Vertical
        window-fold-in via the generic 8.8 tween helper (arg0->unk98: scale
        0x1000, pivot spA4(0xA0,0xCE)=(160,206) while mid-fold) -- same
        fold() pattern as web/shop.js.
      - corner badge: clip 0x21=33 (32x21), placed at (0,0xF)=(0,15) --
        top-left corner panel, also fold-in scaled via arg0->unk88, pivot
        spA4(0,0x18)=(0,24).
      - ambient background: clip 0x1E=30 (a large multi-tile composite,
        dx range 0..288+); drawn via sp94(pack,0x1E,k,k) where
        k=arg0->unk58 is a 0..0x5F (0..95) sawtooth counter used as BOTH the
        x and y draw arg -- a diagonal wipe/slide animation of the
        composite's screen ORIGIN (sp94's 3rd/4th args are destination
        pixel coords, not a source-texture offset), not a static position.
        2026-07-12: cadence fully resolved by reading F0x80084c20's body --
        unk58 increments by 1 every OTHER vsync (gated by a unk5C 0/1
        toggle flipped each call), and resets to 0 the instant it would
        reach 0x60=96 (`if (unk58+1) < 0x60: keep else 0`) -- i.e. a clean
        linear 0..95 ramp, 2 vsyncs/step, 192 vsyncs/cycle (3.84s @ PAL
        50Hz), then snaps back to 0 and repeats. Wired into the walker
        (see ambient_bg.animated below).
      - blink cursor (cmfont clip 10, CLUT-cycled every ~5 vsyncs via
        arg0->unk7C 0..4): placed at (0x123,0xD0)=(291,208) -- bottom-right
        "press button to continue" prompt, reusing the SAME shared clip as
        every other decoded menu screen.

  * Per-partner group (F0x80083260 ctor; F0x8001ae38(handle,kind,x,y),
    kind 1 = white face, kind 3 = gold number face). arg0->unk5C is the
    PARTY SLOT, not a report page: F0x80083744 feeds the same field to
    *0x8004B44C() to choose which rookie's portrait animation the group
    shows, and a capture of the running original
    (docs/research/ui/captures/original-status-2026-09-03/05-fightreport-exp.png)
    shows all three partners on one page, 50px apart. The 2026-07-12 pass
    read unk5C as a page index and the walker inherited that error: it drew
    the three partners into what are really ONE partner's three digivolve
    bars. base = unk5C * 0x32 = the party slot * 50.
      - name (kind1) at (0x3D, base+0x28) = (61, base+40) -- the partner.
      - "LV" label (kind3) at (0x3E, base+0x38) = (62, base+56).
      - level value (kind3) at (0x5B, base+0x38) = (91, base+56).
      - EXP value (kind3) at (0x67, base+0x45) = (103, base+69).
      - "EXP" label (kind3) at (0x6A, base+0x45) = (106, base+69).
        The value/label pair repeats the status sheet's own arrangement: the
        number ends where the label begins.
      - digivolve slot j (j=0..2, 3 iterations): form name (kind1) at
        (0x8D, base+0x28+0xF*j) = (141, base+40+15*j); form value (kind3) at
        (0x114, base+0x2C+0xF*j) = (276, base+44+15*j). These are the three
        bars the capture shows empty beside each partner. They fill as that
        Digimon digivolves.
      - message text (kind1, justify 2 via widget->unk160(2)) at
        (0x14,0xC2) = (20,194) -- one message for the page, not per group.

  * Compact 2-digit widget (F0x80084b98 ctor, a SEPARATE/simpler ctor also
    reachable from the report's state machine): two adjacent gold-digit
    slots (kind3) at (0x42,0x17)=(66,23) and (0x45,0x17)=(69,23) -- 3px
    apart, consistent with two single-digit glyphs of a compact top-left
    "Lv NN" readout used on the "Level gained!" page; plus the SAME message
    widget at (0x14,0xC2)=(20,194) as above. Exact semantic pinning is
    inferred from position + page context -- OPEN GAP.

  * Per-group pictures (F0x80083744). Same base = unk5C * 0x32:
      - group plate: clip 0x1F=31 (116x45 composite plus a 32x20 inset) at
        (0x11, base+0x26) = (17, base+38). This is the frame the partner's
        name, level and EXP sit in, and the extractor had never recorded it.
      - portrait: clip taken from a 7-entry-per-roster-slot animation table at
        0x8008905C, index (rosterSlot*7 + frame), terminated by -1, advancing one
        frame every 13 vsyncs, drawn at (0x14, base+0x28) = (20, base+40).
        THE ROW IS THE ROSTER SLOT: F0x80083744 feeds unk5C to *0x8004B44C, which
        is the resident party-position service F0x80016D94, the same one the pause
        STATUS cards ask (ledger claim
        digimon-picture-row-is-the-roster-slot-2026-10-03). The table is this
        overlay's copy of the disc's ONE eight-row picture table, so the rows come
        from engine/dw3/ui/digimon-picture.ts and the values below are only the
        cross-check (and they match word for word).
        RESOLVED: the table sits in the overlay's DATA segment, past the end of the
        assembly in ~/ddw3, which is why two earlier passes could not find it and one
        recorded it as all-zero. It is now shipped as part of
        web/assets/data/report/tables.bin (base 0x80086A88), which is the loaded
        overlay image, and the drawn clip comes from the shared module through it.
      - digivolve slot bar: clip 0x20=32 (172x18) at
        (0x87, base+0x26+0xF*j) = (135, base+38+15*j) -- one per bar, fold
        pivot spA4(0x87, base+0x2D+0xF*j).
      - slot highlight: clip 0x25=37 at (0x87, base+0x26+0xF*k) =
        (135, base+38+15*k), drawn for the one slot index in unkE8 when that
        slot's +0x74 field is >= 4. WHAT THAT FIELD COUNTS IS NOT DECODED.
      - group sparkle: clip 0x22=34 (semi-blended, frames 0..10, one step
        every 3 vsyncs) at (0x63, base+0x2B) = (99, base+43).
      - slot sparkle: clip 0x23=35 (semi-blended, same 0..10 cadence) at
        (0xEF, base+0x23+0xF*j) = (239, base+35+15*j).
      - "Digivolve learned" banner: clip 0x24=36 at (0x11, base+0x26) =
        (17, base+38), CLUT cycling 0..3 one step every 5 vsyncs.

Output: web/assets/data/stfgtrep_ui.json
"""

import json
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/assets/data/stfgtrep_ui.json"

DATA = {
    "packs": {"chrome": "stfrpt"},
    "message_bar": {
        "clip": 29, "x": 11, "y": 188,
        "pivot": [0xA0, 0xCE],
        "disasm": "F0x80084c20 (sp94 pack 0x079F0000 clip 0x1D; fold pivot spA4(0xA0,0xCE))",
    },
    "corner_badge": {
        "clip": 33, "x": 0, "y": 15,
        "pivot": [0, 0x18],
        # F0x80084b98 builds the badge's own two widgets INSIDE this picture:
        # the running EXP total, right-anchored so it ends at 66, and the
        # "EXP" label starting at 69 -- the same value/label arrangement the
        # status sheet uses. The 2026-07-12 pass read this pair as a compact
        # "Lv NN" readout on the level page; the captures show "6 EXP" there,
        # in the badge, on both the EXP page and the level page.
        "value": {"x": 66, "y": 23, "kind": 3},
        "label": {"x": 69, "y": 23, "kind": 3, "str": "EXP"},
        # The whole badge, picture and text together, is absent from the BIT
        # page capture and present on the EXP and level pages. THE RULE FOR
        # THE OTHER PAGES IS NOT ESTABLISHED -- only three of the seven page
        # types were captured.
        "pages": ["exp", "partner-level"],
        "disasm": "F0x80084c20 (sp94 pack 0x079F0000 clip 0x21; fold pivot "
                  "spA4(0,0x18)) + F0x80084b98 ctor for the value/label pair",
    },
    "ambient_bg": {
        "clip": 30, "x": 0, "y": 0,
        "animated": {
            "min": 0, "max": 95, "stepMs": 40,
            "note": "diagonal wipe: draw pos (k,k), k ramps 0..95 then "
                    "resets; 1 step per 2 vsyncs (~40ms PAL)",
        },
        "disasm": "F0x80084c20 (sp94 clip 0x1E; unk58 0..95 ramp, "
                  "2 vsyncs/step, resets at 96 -- see docs)",
    },
    "blink_cursor": {
        "pack": "cmfont", "clip": 10, "x": 291, "y": 208,
        "disasm": "F0x80084c20 (sp84(0x140,0) + pack 0x02860000 clip 0xA; "
                  "same shared cursor as every other decoded menu)",
    },
    "group": {
        "count": 3, "stepY": 50,
        "plate": {"clip": 31, "x": 17, "yOff": 38},
        # The animation table was READ OFF THE RUNNING GAME on 2026-09-04, with
        # the report on screen: eight rows of seven words, each row ending in
        # -1. It sits in the overlay's data segment, past the end of the
        # assembly this repository carries, which is why two earlier passes
        # could not find it and one recorded it as all-zero.
        #
        # Each row was identified by looking at the first clip of the row. Its
        # eight groups reproduce, independently, the grouping the sprite sheet's
        # own per-clip offsets already imply, and the three partners in
        # 05-fightreport-exp.png sit on rows 0, 6 and 7 exactly as their
        # pictures say. Keyed here by the walker's rookie id.
        "portrait": {
            "x": 20, "yOff": 40, "stepVsync": 13,
            "frames": {
                "1": [7, 8, 9, 10, 9, 8],        # Kotemon
                "2": [14, 15, 16, 15],           # Kumamon
                "3": [11, 12, 13, 12],           # Monmon
                "4": [3, 4, 5, 6, 5, 4],         # Agumon
                "5": [25, 26, 27, 28, 27, 26],   # Veemon
                "6": [0, 1, 2, 1],               # Guilmon
                "7": [17, 18, 19, 20, 19, 18],   # Renamon
                "8": [21, 22, 23, 24, 23, 22],   # Patamon
            },
        },
        "name": {"x": 61, "yOff": 40, "kind": 1},
        "level_label": {"x": 62, "yOff": 56, "kind": 3, "str": "LV"},
        "level_value": {"x": 91, "yOff": 56, "kind": 3},
        "xp_value": {"x": 103, "yOff": 69, "kind": 3},
        "xp_label": {"x": 106, "yOff": 69, "kind": 3, "str": "EXP"},
        # The bracketed picture frame and the white name strip that mark the
        # partner the page is about. Clip 0x24=36 at (0x11, base+0x26), colour
        # cycling 0..3 one step every 5 vsyncs. The 2026-07-12 pass called this
        # a "Digivolve learned banner"; the art is a 44x43 bracket frame plus a
        # 60-wide strip, and captures 04 and 05 show it over the picture box and
        # the name plate of the partner each page is about. Capture 06, the BIT
        # page, names no partner and shows no mark.
        "highlight": {"clip": 36, "x": 17, "yOff": 38,
                      "frames": 4, "stepVsync": 5},
        # The orange arrow beside the level, clip 0x22=34 at (0x63, base+0x2B).
        # Its palette RAMPS 0..10 one step every 3 vsyncs and STOPS at 10; it
        # does not loop. The group plate is drawn at the same palette row on the
        # same frames, so the whole plate brightens with the arrow. Both are
        # gated on the field the level jingle sets. Capture 04 shows the arrow
        # on the partner that gained a level; capture 05 shows none.
        "level_arrow": {"clip": 34, "x": 99, "yOff": 43,
                        "rampSteps": 11, "stepVsync": 3,
                        "pages": ["partner-level"]},
        "disasm": "F0x80083260 ctor + F0x80083744; base = unk5C * 0x32, "
                  "unk5C is the party slot (F0x80083744 feeds it to "
                  "*0x8004B44C to pick the rookie portrait animation)",
    },
    "form_slot": {
        "count": 3, "stepY": 15,
        "bar": {"clip": 32, "x": 135, "yOff": 38},
        # The bar-wide mark over the digivolution the page is about, clip
        # 0x25=37, drawn on the same colour cycle as the group mark.
        "highlight": {"clip": 37, "x": 135, "yOff": 38,
                      "frames": 4, "stepVsync": 5},
        "name": {"x": 141, "yOff": 40, "kind": 1},
        "value": {"x": 276, "yOff": 44, "kind": 3},
        # The per-bar marker at the right end of the bar, clip 0x23=35. Its
        # palette ramps 0..10 every 3 vsyncs and stops at 10, and the bar
        # picture is drawn at the same row, so the bar brightens with it.
        "marker": {"clip": 35, "x": 239, "yOff": 35,
                   "rampSteps": 11, "stepVsync": 3},
        "disasm": "F0x80083260 loop (3 iterations) + F0x80083744 clip 0x20 "
                  "loop -- the three digivolve bars beside one partner",
    },
    "message": {
        "x": 20, "y": 194, "kind": 1, "justify": 2,
        "disasm": "F0x80083260 / F0x80084b98 (shared message widget)",
    },

    # Which jingle goes with which page, closed 2026-09-04 from the overlay.
    # The one at file 0x18e8 is played on the branch that sets the field gating
    # the level arrow, so it is the partner's level. The one at file 0x1418 is
    # played on the branch that sets the selected bar's own marker field, so it
    # is the digivolution bar. The audio document had both as "result kind
    # unidentified -- not wired".
    "jingles": {
        "partner-level": "jingle02",
        "form-level": "jingle03",
        "disasm": "pro/stfgtrep.s 0x18e8 sets [s3+0xf0]=1 then plays 0x4000b; "
                  "0x1418 stores into [s3+(unkE8<<4)+0x100] then plays 0x4000c",
    },
}


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(DATA, indent=1) + "\n")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
