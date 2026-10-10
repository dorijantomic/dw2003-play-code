#!/usr/bin/env python3
"""
Extract the CARD DUEL screen's art binding and geometry from `pro/cardgame.s`
so the walker draws the duel with the original's clips, pivots and coordinates
instead of hand-invented ones.

Until this pass the duel screen was the one card surface with NO decoded
layout: `stcrdshp` / `stcrdabm` / `stcrddek` (shop, album, folder editor) were
decoded in July 2026 and `pro/cardgame` -- the duel engine itself -- had its
rules machinery mapped on 2026-08-04 (docs/research/card/card-duel-engine-
2026-08-04.md) but nothing about what it draws.

THE PACK.  The duel's art is CARDDATA.BIN, LBA_CARDDATA_BIN_IDX = 605 in
~/ddw3/rust/dw2003_exe_data/src/lba.rs, i.e. pack-handle hi-word 0x25d.  Unlike
every screen pack decoded so far it is NOT a cs/tm LBA pair: one archive holds
both, in four top-level slots, and the handle's LOW u16 selects the slot
directly (the rule sttrng already follows):

  slot 0  archive{RLEN -> 16bpp TIM 64hw x 256} -- texture page, VRAM (0x280,0)
  slot 1  archive{RLEN -> 16bpp TIM 64hw x 256} -- texture page, VRAM (0x340,0)
  slot 2  sprite directory, 82 frames / 65 clips -- THE CARD SHEET
  slot 3  sprite directory, 58 frames / 70 clips -- THE BOARD SHEET

`F0x80095bfc` (the duel scene's default/entry case) uploads both pages and
names the VRAM destinations outright:

    sp34(0x280, 0); sp3C((void *)0x80044B38->unk424(0x025D0000));
    sp34(0x340, 0); sp3C((void *)0x80044B38->unk424(0x025D0001));

and every draw site then selects its page with `sp84`, so the slot <-> page
pairing is read off the code rather than guessed: a draw that does
`sp84(0x280, 0)` always passes handle `0x025D0002`, and one that does
`sp84(0x340, 0)` always passes `0x025D0003` (20 and 23 call sites; see
tools/extract_screen_packs.py BUNDLED_PACKS).  Rendering either directory
against the other page produces incoherent colour noise, which is the
independent check.

THE DRAW IDIOM.  Every duel draw builds a context with the resident factory
`F0x8001f648` and then:

    sp8C(0x100, layer)          semi-transparency mode + layer
    sp84(page, 0)               texture page base (0x280 card / 0x340 board)
    sp98(k [, table])           add k to the frame's CLUT row (colour cycle)
    spA4(px, py)                rotate/scale pivot, in SCREEN coordinates
    sp9C(rot, sx, sy)           rotation + 12.4 scale (0x1000 = 1.0)
    sp94(pack, clipId, x, y)    draw clip `clipId` at (x, y)

Card sprites carry their position as 8.8 fixed point in the sprite object's
+0x00 / +0x04 and are drawn at `>> 8`, with the pivot at `+0x14, +0x17`
(20, 23) -- exactly half of the 40x46 card, which is what pins the card size
from the code rather than from the atlas.

Everything emitted below is either read straight out of the overlay's DATA
region by `words()` or transcribed from the decompiled C in
`exe-decomp/cardgame_c/`, with the owning function named in a `disasm` key.
Values that are NOT established are absent, not guessed -- see the
`not_decoded` block in the output and the research doc.
"""
from __future__ import annotations
import os

import json
import re
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
ASM = DDW3 / "asm/dw2003/pro/cardgame.s"
OUT = Path(__file__).resolve().parent.parent / "web/assets/data/cardduel_ui.json"

BASE = 0x80082CB0  # cardgame overlay RAM base (shared by every pro/* overlay)

# `pro/cardgame.s` renders the code region as `<mnemonic> # .word 0xVALUE` and
# the data region as `.word 0xVALUE # <bogus disassembly>`.  overlay_scan.py's
# `words` subcommand understands only the first form, so parse both here (the
# same reason tools/extract_stgmcard_ui.py carries its own reader).
_CODE_WORD = re.compile(r"^\.L0x([0-9a-fA-F]+):.*#\s*\.word\s+(0x[0-9a-fA-F]+)")
_DATA_WORD = re.compile(r"^\.L0x([0-9a-fA-F]+):\s*\.word\s+(0x[0-9a-fA-F]+)")


def words() -> dict[int, int]:
    out: dict[int, int] = {}
    for line in ASM.read_text().splitlines():
        m = _DATA_WORD.match(line) or _CODE_WORD.match(line)
        if m:
            out[BASE + int(m.group(1), 16)] = int(m.group(2), 16)
    return out


def blob(W: dict[int, int], start: int, end: int) -> bytes:
    """Little-endian byte view of the word range [start, end)."""
    return b"".join(W[a].to_bytes(4, "little") for a in range(start, end, 4))


def u16(b: bytes, off: int) -> int:
    return int.from_bytes(b[off:off + 2], "little")


def s16(b: bytes, off: int) -> int:
    """Signed halfword -- the per-player records place a few widgets at a
    NEGATIVE offset from the screen origin (e.g. -15, -22), so reading these
    as unsigned would push them off the right-hand edge instead."""
    v = u16(b, off)
    return v - 0x10000 if v >= 0x8000 else v


def main() -> int:
    W = words()

    # ---- the full-screen RECT, used as a self-check on the halfword order ---
    # F0x80095bfc: `0x8004DE10->unk16C(0x800A5938, 3, 0x100)`.  The record is
    # {s16 x, s16 y, s16 w, s16 h} = {0, 0, 320, 240}: if the halfword order
    # were the other way round this would read {0, 0, 240, 320}, so every
    # {x, y} pair below is anchored by it.
    scr = blob(W, 0x800A5938, 0x800A5940)
    screen = [u16(scr, 0), u16(scr, 2), u16(scr, 4), u16(scr, 6)]
    assert screen == [0, 0, 320, 240], f"halfword order check failed: {screen}"

    # ---- board slot positions ---------------------------------------------
    # F0x80096c20 draws a board sprite through `(arg2 * 4) + 0x800A5978`,
    # reading +0x00 as x and +0x02 as y, with the pivot at (+4, +0x17).  Three
    # records, ending exactly where the phase-banner table at 0x800A5984
    # begins.
    bs = blob(W, 0x800A5978, 0x800A5984)
    board_slots = [[u16(bs, i * 4), u16(bs, i * 4 + 2)] for i in range(3)]

    # ---- phase banner / plate table ---------------------------------------
    # F0x80096e8c indexes 6-byte records at 0x800A5984 by the banner object's
    # `unkC`: {s16 dx, s16 dy, u8 clip, u8 pack}.  `pack == 2` selects handle
    # 0x025D0003 (the board sheet); anything else selects 0x025D0002 (the card
    # sheet).  Six records: the seventh 6-byte slot would name clip 0x49, which
    # neither directory ships (card sheet ids stop at 71), so the table ends at
    # 0x800A59A8.
    bt = blob(W, 0x800A5984, 0x800A59A8)
    banners = []
    for i in range(6):
        r = bt[i * 6:(i + 1) * 6]
        banners.append({
            "dx": u16(r, 0), "dy": u16(r, 2),
            "clip": r[4],
            "sheet": "board" if r[5] == 2 else "card",
        })

    # ---- the six-across label strip ---------------------------------------
    # F0x80096418 builds seven class-A text widgets: a title at (+5, +3) off
    # the screen object's (unk58, unk5A), then six more positioned from the
    # 4-byte records at 0x800A5940, each showing an integer (+0x118).  Six is
    # also the hand size the language file names ("You cannot draw 6 cards, so
    # you lose this set." -- ~/ddw3/lang_file/dw2003/eng/escardgm.toml).
    ls = blob(W, 0x800A5940, 0x800A5958)
    labels = [[u16(ls, i * 4), u16(ls, i * 4 + 2)] for i in range(6)]

    # ---- the per-player board layout --------------------------------------
    # F0x80098898(screen, player) draws one player's whole half of the board
    # from a 0x4C-byte record at `(player * 0x4C) + 0x800A59D0`, so there are
    # exactly TWO records and every position below is a {s16 x, s16 y} pair at
    # a named offset inside one.  Positions are relative to the screen object's
    # (unkC, unkE) origin, except the three marked `alt_origin`, which the
    # function adds to the screen's (unk20, unk22) instead.
    #
    # The two records are the same layout mirrored vertically -- the five field
    # slots sit at y 67 for record 0 and y 12 for record 1, sharing x -- which
    # is what identifies the pair as the near and far player.
    PLAYER = 0x800A59D0
    STRIDE = 0x4C
    pb = blob(W, PLAYER, PLAYER + 2 * STRIDE)

    def xy(rec: int, off: int) -> list[int]:
        b = rec * STRIDE
        return [s16(pb, b + off), s16(pb, b + off + 2)]

    # Each entry: json key -> (offset, what draws it).
    SLOTS = {
        # the five field slots: `do { ... x += 0x2A } while (i < 5)`
        "field_slots": (0x34, "board clip 0x0D, 5 slots, x step 0x2A, "
                              "gated per slot by screen->unk30[i]"),
        # The S-ENERGY CUBES.  The last do-loop of F0x80098898 draws, per slot,
        # CARD-sheet clip `0x800A5A98[i] + 0x800A5AA0[k]` at record +0x04 with
        # the same 0x2A step, where k = (screen->unk8 % 30) / 6 when that
        # slot's screen->unk30[i] is set and 0 when it is not.  Missing from
        # the first pass, which read only the board-sheet plate at +0x34.
        "energy_cubes": (0x04, "card clip 0x800A5A98[i] + 0x800A5AA0[k], "
                               "5 slots, x step 0x2A"),
        "field_numbers": (0x08, "F0x80096a94 2-digit, 5 slots, x step 0x2A"),
        "counter_a": (0x0C, "F0x80096a94 2-digit, value screen->unk1D"),
        "counter_b": (0x10, "F0x80096a94 2-digit, value screen->unk1E"),
        "total_a": (0x1C, "F0x80096a94 3-digit, value screen->unk10"),
        "total_b": (0x24, "F0x80096a94 3-digit, value screen->unk12"),
        "label_a": (0x18, "board clip 0x800A5A70[lang*2 + 0]"),
        "label_b": (0x20, "board clip 0x800A5A70[lang*2 + 1]"),
        "icon_a": (0x2C, "card clip 0x800A5A80[k] + 9, gated by screen->unk37"),
        "icon_b": (0x28, "card clip 0x800A5A88[k] + 6, gated by screen->unk36"),
        "marker_a": (0x38, "board clip 0x0E, gated by screen->unk36"),
        "marker_b": (0x3C, "board clip 0x0E, gated by screen->unk37"),
        "pile_a": (0x44, "board clip 0x0C, gated by screen->unk38"),
        "pile_b": (0x48, "board clip 0x0C, gated by screen->unk39"),
    }
    ALT_ORIGIN = {
        "alt_number": (0x14, "F0x80096a94 2-digit, value screen->unk28"),
        "alt_marker": (0x40, "board clip 0x0F, gated by screen->unk35"),
        # the final card-sheet draw of the alt cluster, clip = record byte +0x03
        "alt_card": (0x30, "card clip record[+0x03], unconditional"),
    }
    players = []
    for r in range(2):
        rec = {k: xy(r, off) for k, (off, _) in SLOTS.items()}
        rec["alt"] = {k: xy(r, off) for k, (off, _) in ALT_ORIGIN.items()}
        # +0x02 is a BYTE: `sp1EC(cardPack, rec->unk2 + screen->unk44, ...)`
        rec["plate_clip_base"] = pb[r * STRIDE + 2]
        # +0x01 is a BYTE too, and it is the LAST draw of the function:
        # `sp1EC(cardPack, rec->unk1, screen->unkC, screen->unkE)` -- one
        # multi-layer card-sheet clip at the record's own origin.  Clips 14 and
        # 15 are the whole HUD strip's CHROME: the swooshes, the five recessed
        # cube plates, the AP/HP plaques and the two counter plaques, 320 wide.
        # This is the "board chrome behind the HUD strips" the first pass
        # listed as not identified.
        rec["chrome_clip"] = pb[r * STRIDE + 1]
        # +0x03 is the clip for the alt cluster's card-sized panel.
        rec["alt_card_clip"] = pb[r * STRIDE + 3]
        players.append(rec)
    player_fields = {k: v[1] for k, v in {**SLOTS, **ALT_ORIGIN}.items()}

    # ---- small animation / language tables used by that function ----------
    # `screen->unk8 % 36 / 6` and `% 24 / 6` and `% 30 / 6` all index 6-entry
    # ping-pong tables; 0x800A5A98 is the 5 field slots' card-sheet clip bases.
    aux = {
        "board_clut_cycle": list(blob(W, 0x800A5A68, 0x800A5A70))[:6],
        "label_clips_by_lang": [list(blob(W, 0x800A5A70, 0x800A5A80))[i * 2:i * 2 + 2]
                                for i in range(4)],
        "icon_a_cycle": list(blob(W, 0x800A5A80, 0x800A5A88))[:6],
        "icon_b_cycle": list(blob(W, 0x800A5A88, 0x800A5A90))[:6],
        "alt_marker_cycle": list(blob(W, 0x800A5A90, 0x800A5A98))[:6],
        "field_slot_clip_bases": list(blob(W, 0x800A5A98, 0x800A5AA0))[:5],
        "slot_number_cycle": list(blob(W, 0x800A5AA0, 0x800A5AA8))[:6],
    }

    # ---- the two score plates ---------------------------------------------
    # F0x800999a0(screens, widgets, player, anim) reads a 0x10-byte record at
    # `(country * 0x10) + 0x800A5AA8`: {plate xy for player 1, plate xy for
    # player 0, label xy for player 1, label xy for player 0}.  It draws card
    # clip 0x44 for player 0 and 0x43 for player 1 at the plate position, and
    # puts a text widget (string bank index lang + 0xF) at the label position.
    sp = blob(W, 0x800A5AA8, 0x800A5AC8)
    score_plates = []
    for c in range(2):
        b = c * 0x10
        score_plates.append({
            "plate": [[u16(sp, b + 4), u16(sp, b + 6)], [u16(sp, b), u16(sp, b + 2)]],
            "label": [[u16(sp, b + 12), u16(sp, b + 14)], [u16(sp, b + 8), u16(sp, b + 10)]],
            "clip": [0x44, 0x43],
        })

    # ---- the card sprite ANIMATION state machine --------------------------
    # F0x8009b890(screen, sprite) is called for all 40 pool sprites every frame
    # by F0x8009bac8, BEFORE the draw pass, and switches on the sprite's `unk42`
    # animation state.  The switch compiles to the 12-entry jump table at
    # 0x80083748, which is the authority-2 confirmation of the state count and
    # of states 2 and 3 sharing one animator (their targets are the same word).
    JUMP = 0x80083748
    jump_table = [W[JUMP + i * 4] for i in range(12)]
    assert jump_table[2] == jump_table[3], \
        f"states 2/3 should share an animator: {jump_table[2]:#x} {jump_table[3]:#x}"

    # The two shake offset tables are 8 signed halfwords each, indexed `& 7`,
    # and they OVERLAP: 0x800A5AC8 + 8 bytes == 0x800A5AD0, so the last four
    # entries of the x-shake table are the first four of the xy-shake table.
    # Both bases are read off the assembly (`lui 0x800a` + `addiu 0x5ac8` in
    # F0x8009a454, `addiu 0x5ad0` in F0x8009a62c), not from the decompilation.
    # One consequence is worth stating rather than smoothing over: the xy
    # table's last four halfwords are 12, 0, 28, 0, which are also exactly the
    # two animation durations 0xC and 0x1C.  Whether the assembler laid two
    # arrays down adjacently or those words are shared with something else, the
    # index is masked `& 7`, so the original DOES read all eight -- as 8.8 that
    # is a shake which swings +-4 px for four frames and then sits still.  The
    # bytes are copied verbatim rather than truncated to the "nice" four.
    sh = blob(W, 0x800A5AC8, 0x800A5AE0)
    shake_x_table = [s16(sh, i * 2) for i in range(8)]
    shake_xy_table = [s16(sh, 8 + i * 2) for i in range(8)]

    doc = {
        "_source": "~/ddw3/asm/dw2003/pro/cardgame.s + exe-decomp/cardgame_c/",
        "_pack": "CARDDATA.BIN (LBA 605, pack handle hi-word 0x25d)",
        "screen": screen,

        "sheets": {
            # name -> (walker sheet, pack handle, VRAM texture base)
            "card": {"sheet": "carddata2", "handle": "0x025D0002",
                     "vram": [0x280, 0],
                     "disasm": "F0x80095bfc sp34(0x280,0)+sp3C(unk424(0x025D0000)); "
                               "every sp84(0x280,0) site passes 0x025D0002"},
            "board": {"sheet": "carddata3", "handle": "0x025D0003",
                      "vram": [0x340, 0],
                      "disasm": "F0x80095bfc sp34(0x340,0)+sp3C(unk424(0x025D0001)); "
                                "every sp84(0x340,0) site passes 0x025D0003"},
        },

        # ---- the card sprite --------------------------------------------
        "card": {
            "size": [40, 46],
            "pivot": [0x14, 0x17],
            "body": {"sheet": "board", "clip": 0x0A,
                     "disasm": "F0x8009b678 sp94(0x025D0003, 0xA, x>>8, y>>8) "
                               "with spA4(x>>8 + 0x14, y>>8 + 0x17)"},
            "select": {"sheet": "board", "clip": 0x08,
                       "disasm": "F0x8009acac (unk48 & 6 -> CLUT row 4, "
                                 "unk48 & 1 -> cycled row from 0x800A5B0C); "
                                 "F0x80099de8 blinks the same clip 0,3,1"},
            "active": {"sheet": "board", "clip": 0x09,
                       "disasm": "F0x8009b76c, drawn only for unk42 == 0xB, "
                                 "CLUT row = (unk2C/2) % 5"},
            # the three small pips along the card's lower edge
            "pips": {"sheet": "card", "base": 0x37, "count": 3,
                     "pos": [3, 0x15], "step_x": 8,
                     "disasm": "F0x8009b028 sp94(0x025D0002, i + 0x37, "
                               "x>>8 + (n*8 + 3), y>>8 + 0x15) for i in 0..2"},
            # the badge in the card's top-left corner
            "badge": {"sheet": "card", "base": 0x33, "pos": [3, 2],
                      "disasm": "F0x8009af28 sp94(0x025D0002, unk46 + 0x33, "
                                "x>>8 + 3, y>>8 + 2)"},
        },

        # ---- the number widget -------------------------------------------
        # F0x80096a94 walks the value's decimal digits from the LOW end and
        # places digit k of an `unkE`-wide field at x + (unkE - 1 - k) * 7, so
        # the field is right-aligned in a fixed 7px-per-digit box.  `unkF == 0`
        # suppresses leading zeros.
        "digits": {"sheet": "board", "base": 0x14, "advance": 7,
                   "disasm": "F0x80096a94 sp94(unk424(0x025D0003), d + 0x14, "
                             "unk2 + ((unkE - (k+1)) * 7), unk4)"},

        # ---- the board backdrop ------------------------------------------
        # F0x80096950 draws board clip 0 (the 30-tile 64x64 field) at
        # (t, t) where t = (screen->unk58 >> 1) & 0x3F -- a diagonal scroll
        # that wraps every 64 px -- and fades it in by walking the CLUT row
        # 0 -> 0xB (11 steps of 4/256 per vsync), holding at 0xB.
        "backdrop": {"sheet": "board", "clip": 0, "tile": 64,
                     "clut_rows": 12, "fade_step": 4,
                     "scroll": "((t >> 1) & 0x3F, same)",
                     "disasm": "F0x80096950"},

        # ---- per-card-sprite effect animations ---------------------------
        # F0x8009a998 switches on the sprite's `unk47`; each case is a clip run
        # played from the same (x, y) as the card.  Cases 1 and 2 index the
        # 4-entry frame-order tables at 0x800A5B04 / 0x800A5B08; cases 3 and 4
        # are plain (t >> 1) % n runs.
        "effects": {
            "1": {"sheet": "board", "base": 0x28, "frames": 4,
                  "order": list(blob(W, 0x800A5B04, 0x800A5B08)),
                  "rate": 4, "disasm": "F0x8009a998 case 1 (0x800A5B04)"},
            "2": {"sheet": "board", "base": 0x2C, "frames": 4,
                  "order": list(blob(W, 0x800A5B08, 0x800A5B0C)),
                  "rate": 4, "disasm": "F0x8009a998 case 2 (0x800A5B08)"},
            "3": {"sheet": "board", "base": 0x3C, "frames": 9, "rate": 2,
                  "end": 0x24, "disasm": "F0x8009a998 case 3"},
            "4": {"sheet": "board", "base": 0x46, "frames": 7, "rate": 2,
                  "end": 0x1C, "disasm": "F0x8009a998 case 4"},
        },
        # the 6-entry CLUT-row cycle the select/highlight clips run on
        "select_clut_cycle": list(blob(W, 0x800A5B0C, 0x800A5B14))[:6],

        # ---- the card face ------------------------------------------------
        # F0x8009b168 switches on the sprite's `unk45` render kind:
        #   1 = a Digimon card -- the class frame (CARD sheet clip `unk38`,
        #       or `unk38 + 0x3C` when `unk49 == 1`, i.e. the six 40x46 frames
        #       at ids 0..5 and their six alternates at 60..65) drawn at the
        #       card origin, then either the AP/HP readout (board clip 0x1F
        #       separator at +0x12,+0x21 with a number at +4,+0x21 for `unk43`
        #       and one at +0x17,+0x21 for `unk44`) or, when `unk3C == 0`, the
        #       blank board clip 0x1E at +4,+0x21;
        #   2 = CARD sheet clip 0x10 at the card origin;
        #   3 = CARD sheet clip 0x0C at the card origin;
        #   0 = nothing.
        # The frames' interior is transparent over a 30x28 window at (5, 4) --
        # measured from the extracted clips, which is where the record's own
        # 32x32 TIM artwork shows through.
        "face": {
            # The flip animation (F0x8009a75c) XORs this field with 3 half way
            # through, which is what identifies the kinds: the XOR pairs 1 with
            # 2, so kind 2 is the REVERSE of a Digimon card face rather than a
            # separate card type, and kind 3 -- which the same XOR would send to
            # 0 -- is nobody's reverse. This supersedes the provisional
            # "program"/"back" labels, which were guessed from clip content
            # alone with nothing tying the pair together.
            "kinds": {"1": "digimon", "2": "reverse", "3": "alt"},
            "kinds_disasm": "F0x8009b168 switch; pairing from F0x8009a75c "
                            "unk45 ^= 3",
            "frame": {"sheet": "card", "base": 0, "count": 6, "alt_add": 0x3C,
                      "disasm": "F0x8009b168 case 1 sp94(0x025D0002, unk38 "
                                "[+ 0x3C if unk49 == 1], x>>8, y>>8)"},
            # The six frames' border colours, sampled from the extracted clips,
            # are pale (168,176,144), blue (0,0,248), green (0,160,40), red
            # (248,56,0), black (64,64,64) and brown (96,48,0) -- the record's
            # own colour byte order (tools/extract_card_catalog.py COLOURS,
            # +0x00 = 1..6), so the frame index is `colour - 1`.  Clips 60..65
            # are the same six at roughly half brightness, which is what the
            # `unk49 == 1` alternate selects.
            "frame_by_colour": {"white": 0, "blue": 1, "green": 2,
                                "red": 3, "black": 4, "brown": 5},
            # kind 2 -- the reverse a flip turns a Digimon card into
            "reverse_clip": {"sheet": "card", "clip": 0x10},
            # kind 3 -- the standalone kind, which the flip's XOR would erase
            "alt_clip": {"sheet": "card", "clip": 0x0C},
            "art_window": [5, 4, 30, 28],
            "stats": {
                "sep": {"sheet": "board", "clip": 0x1F, "pos": [0x12, 0x21]},
                "blank": {"sheet": "board", "clip": 0x1E, "pos": [4, 0x21]},
                "ap": [4, 0x21],
                "hp": [0x17, 0x21],
                "disasm": "F0x8009b168 case 1",
            },
        },

        "board_slots": board_slots,
        "banners": banners,
        "labels": labels,
        "player_field_offsets": player_fields,
        "players": players,

        # ---- the screen origin every record position hangs off -------------
        # F0x80099440(screen, player) is the strip's slide animator, called on
        # the same two structs immediately before F0x80098898.  Its immediates
        # settle the origin outright, so this is no longer the runtime unknown
        # the first pass recorded.  Case 1 (slide in) comes to rest with
        # unkE = var_s7 and case 3 (slide out) with unkE = var_s6:
        #
        #   player 0:  var_s7 = 0x8D (141) on screen, var_s6 = 0xF1 (241) off
        #   player 1:  var_s7 = 0x00 (0)   on screen, var_s6 = -0x64 (-100) off
        #
        # unkC is 0 for both in every case, which is why the two strips share
        # their x.  F0x80098898 then applies a display-height correction when
        # *(s32 *)0x8005CCB0 is non-zero (the PAL/50Hz flag): +0xC for player 0
        # and -0xC for player 1.  The 2026-08-05 rig captures are PAL, and both
        # halves check out against them -- the near cube row lands at
        # 153 + 69 = 222 and the far one at -12 + 14 = 2, which is where
        # web/assets/ref/cardduel/board-dealt.png puts them.
        "strip_origin": {
            "ntsc": [[0, 0x8D], [0, 0]],
            "pal": [[0, 0x8D + 0xC], [0, 0 - 0xC]],
            "offscreen_ntsc": [[0, 0xF1], [0, -0x64]],
            "alt_ntsc": [[0x120, 0x8F], [0x120, 0x50]],
            "plate_ntsc": [[0x113, 0xBD], [0x113, 0x26]],
            "disasm": "F0x80099440 cases 1/3 resting values; F0x80098898 "
                      "prologue adds/subtracts 0xC when *(s32*)0x8005CCB0 != 0",
        },
        "score_plates": score_plates,
        "aux": aux,

        # ---- the card sprite animation system -----------------------------
        # Every card on the duel board is one of 40 pooled 0x4C-byte sprites.
        # F0x8009bac8 steps all of them each frame (F0x8009b890) and then draws
        # them in two passes; the animators below are the whole of the duel's
        # card motion.  Positions are 8.8 fixed point (`>> 8` to pixels) and
        # scales are 12.4 with 0x1000 = 1.0.  `dt` is the resident per-frame
        # delta returned by (*0x8004DF9C)(), i.e. these durations are in frames
        # at the original's tick rate.
        "animation": {
            "disasm": "F0x8009b890 dispatch (jump table 0x80083748); animators "
                      "F0x80099ffc/F0x8009a1a0/F0x8009a454/F0x8009a540/"
                      "F0x8009a5b0/F0x8009a62c/F0x8009a75c; commands "
                      "F0x8009c510..F0x8009ce94",
            "pool": {"count": 40, "stride": 0x4C, "base_offset": 0x108,
                     "disasm": "F0x8009bac8 walks 0x27..0 at 0xC9C step -0x4C; "
                               "F0x8009c510 memsets 0x4C bytes per sprite"},
            # sprite field offsets, all confirmed against the assembly
            "fields": {
                "x": 0x00, "y": 0x04, "dest_x": 0x08, "dest_y": 0x0C,
                "start_x": 0x10, "start_y": 0x14,
                "scale_x": 0x18, "scale_y": 0x1A,
                "dest_scale_x": 0x1C, "dest_scale_y": 0x1E,
                "start_scale_x": 0x20, "start_scale_y": 0x22,
                "layer": 0x26, "timer": 0x28, "duration": 0x2C,
                "intro_timer": 0x30, "slot": 0x24,
                "state": 0x42, "render_kind": 0x45, "badge": 0x46,
                "effect": 0x47, "flags": 0x48,
            },
            "jump_table": [f"{a:#010x}" for a in jump_table],
            "states": {
                "0": "hidden", "1": "idle", "2": "move", "3": "move_silent",
                "4": "flip", "5": "summon_arc", "6": "shake_xy",
                "7": "shake_x", "8": "hold", "9": "effect_long",
                "10": "effect_short", "11": "settle",
            },
            "scale_one": 0x1000,
            # states 2 and 3 -- the plain move.  A LINEAR tween on both position
            # and scale, with the timer counting DOWN from `duration` to 0:
            #   cur = dest - (dest - start) * timer / duration
            # so cur == start at timer == duration and cur == dest at 0.  On
            # completion it snaps to dest, drops to `idle`, and -- for state 2
            # only -- plays the landing SFX.
            "move": {"lerp": "cur = dest - (dest - start) * timer / duration",
                     "counts": "down", "on_end": 1,
                     "sfx_unless_state_3": "0x800460BD",
                     "disasm": "F0x80099ffc"},
            # state 4 -- the card flip.  scale_x sweeps 0x1000 -> 0 -> 0x1000 as
            # a half sine over 12 frames, and at the halfway point (t >= 7) the
            # render kind is XORed with 3, swapping face (1) and back (2).  That
            # XOR is what makes this a FLIP rather than a squash.
            "flip": {"duration": 0xC, "swap_at": 7, "angle_div": 24,
                     "kind_xor": 3, "sfx": "0x8004613E",
                     "formula": "scale_x = 0x1000 - rsin((t << 12) / 24)",
                     "disasm": "F0x8009a75c, started by 0x8009C5D8"},
            # states 6 and 7 -- the two hit shakes, both 12 frames, both firing
            # effect run 1.  The x offset is table[t & 7]; the xy variant also
            # jitters y by table[frameCounter & 7], so its vertical component is
            # tied to the global frame counter rather than the sprite's own
            # timer.
            "shake_x": {"duration": 0xC, "table": shake_x_table,
                        "table_addr": "0x800A5AC8", "angle_div": 24,
                        "scale_shift": 4, "scale_sign": 1, "effect": 1,
                        "sfx": "0x009C0003",
                        "formula": "x = start_x + table[t & 7]; "
                                   "scale_y = 0x1000 + (rsin((t << 12) / 24) >> 4)",
                        "disasm": "F0x8009a454, started by 0x8009C6E8"},
            "shake_xy": {"duration": 0xC, "table": shake_xy_table,
                         "table_addr": "0x800A5AD0", "angle_div": 24,
                         "scale_shift": 3, "scale_sign": -1, "effect": 1,
                         "sfx": "0x009C0003",
                         "formula": "x = start_x + table[t & 7]; "
                                    "y = start_y + table[frame & 7]; "
                                    "scale_y = 0x1000 - (rsin((t << 12) / 24) >> 3)",
                         "disasm": "F0x8009a62c, started by 0x8009C654"},
            # state 8 -- a 10-frame hold running effect run 2, which then hands
            # over to state 11, an 11-frame settle before returning to idle.
            "hold": {"duration": 0xA, "next": 11, "effect": 2,
                     "sfx": "0x00040014",
                     "disasm": "F0x8009a540, started by 0x8009C770"},
            "settle": {"duration": 0xB, "next": 1,
                       "sfx": "0x0004001C",
                       "disasm": "F0x8009b890 case 11, started by 0x8009CE28"},
            # states 9 and 10 -- pure effect holds.  Their durations are exactly
            # the end points of effect runs 3 and 4 in the `effects` block
            # above, which is what pairs each state with its clip run.
            "effect_long": {"duration": 0x24, "effect": 3, "next": 1,
                            "disasm": "F0x8009a5b0(.., 0x24), started by "
                                      "0x8009C7F8 with arg2 != 1"},
            "effect_short": {"duration": 0x1C, "effect": 4, "next": 1,
                             "disasm": "F0x8009a5b0(.., 0x1C), started by "
                                       "0x8009C7F8 with arg2 == 1"},
            # state 5 -- the summon.  A two-part animation: an intro that grows
            # the sprite from nothing to 0x1C00 over `intro` frames, then a move
            # to the destination with a sine ARC added to y (peak 0x1C00 = 28px,
            # inverted when travelling downwards), then a return leg at 2.5x the
            # duration that swaps start and destination and settles to 1.0.
            "summon": {"intro_scale": 0x1C00, "intro_step": 0xC0,
                       "rest_scale": 0x1200, "arc": 0x1C00,
                       "end_scale": 0x1000, "return_duration_mul": [2, 0.5],
                       "on_end": 2, "sfx": "0x8004603C",
                       "formula": "y += (rsin((t << 12) / (duration * 2)) * "
                                  "0x1C00) >> 12, negated when dest_y > start_y",
                       "disasm": "F0x8009a1a0, started by 0x8009CA80"},
            # The fan-out that places a run of cards in a row.  0x8009CE94 walks
            # a run of `count` sprites and puts sprite i at
            # `rowX + F0x80098864(count, i)`, all sharing one row y.  So the
            # PITCH is decoded even though the row origins are not: 41.0 px
            # (0x2900 in 8.8) up to 6 cards, and above that the row is squeezed
            # to a fixed 246.0 px total so the cards overlap.
            "fanout": {"pitch": 0x2900, "wide_total": 0xF600, "threshold": 7,
                       "formula": "count < 7 ? 0x2900 * i : (0xF600 / count) * i",
                       "disasm": "F0x80098864, applied by 0x8009CE94"},
            # The AP/HP plates do not jump to their new value: they step by one
            # per frame towards the target held at duel+0x734 / +0x736.
            "counter_roll": {"step": 1, "targets": ["0x734", "0x736"],
                             "fields": ["0x43", "0x44"],
                             "disasm": "cardgame.s 0x12744..0x12794"},
        },

        # ---- honest gaps --------------------------------------------------
        "not_decoded": [
            "What sets screen->unk30[i] and screen->unk35..unk39 -- the flags "
            "that pick the animated frame of the cubes, the deck/trash icons "
            "and the alt marker, and that brighten the AP/HP labels. The value "
            "setter at 0x8009CAE0 writes the ten readouts and no flag. Until "
            "one is found the walker draws the resting frame of each.",
            "screen->unk44, the index added to the record's +0x02 plate clip. "
            "Its position is decoded (strip_origin.plate_ntsc) but the clip "
            "run it walks is not, so the walker does not draw that plate.",
            "Which of the two per-player records is the human player's. They "
            "are a vertical mirror (field rows at y 67 and y 12); the walker "
            "assumes record 0 is the near/player side because its row sits in "
            "the lower half of the 320x240 screen.",
            "The player-facing meaning of the counters and totals the HUD "
            "shows (screen->unk10/unk12/unk1D/unk1E/unk28).",
            "The meaning of the card sprite's `unk46` badge index in player "
            "terms. (`unk47` IS decoded: it selects one of the four effect "
            "clip runs, and every animator that sets it clears it on "
            "completion -- see the `animation` block.)",
            "The CALLER of 0x8009CE94. It takes the row's (x, y) as arguments "
            "and no `jal` or pointer-table entry anywhere in the original "
            "assembly reaches it, so which duel code supplies a row position "
            "is not identified. CORRECTED 2026-08-25: this is a gap in the "
            "CALL GRAPH, not in the origins. The origins are recovered at "
            "authority 1 from the rig captures -- rowX 24, rows at y 38/97/156 "
            "-- and they reproduce the captured 34-card fan EXACTLY: 24, 31, "
            "38, 45, 52, 60, 67, 74, 81 ... 262, all thirty-four, from "
            "rowX + (cardFanOut(34, i) >> 8) with the decoded 0xF600/count "
            "pitch. What remains unknown is what MAKES a 34-card fan appear, "
            "not where it is drawn.",
            "Which game events start which animation. The animation COMMANDS "
            "are decoded (one entry point per state, listed in `animation`), "
            "but the duel logic sites that call them are not traced, so the "
            "walker chooses which animation plays for each rules event.",
            "Program-card effect scripts (the 60-entry opcode table).",
            "Shop prices, booster-pack pools and the folder size limit.",
            "The opponent AI and the original set-resolution path "
            "(the writer of the result code at duel+0x440).",
        ],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1))
    print(f"cardduel_ui.json: {len(banners)} banners / {len(board_slots)} board "
          f"slots / {len(labels)} labels -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
