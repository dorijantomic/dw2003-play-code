#!/usr/bin/env python3
"""Extract the STDWTITL title-screen chrome.

Decode source (see docs/research/ui/stdwtitl-decoded-2026-07-11.md):
  ~/ddw3/asm/dw2003/pro/stdwtitl.s        -- overlay, RAM base 0x80082cb0
  exe-decomp/stdwtitl_c/                  -- m2c decompile (80/82 ok)
  ~/ddw3/rust/dw2003_exe_data/src/lba.rs  -- pack-handle high-u16 -> LBA index

Two packs are proven loaded by this overlay (both via the standard
`0x80044B38->unk424(handle)` pack-handle resolver -- grep `lui $a0, 0x<hi>`
sequences feeding that call site, per the UI master-plan recipe step 3):

1. **ttcommpk** (handle hi 0x0887 = LBA_TTCOMMPK_BIN_IDX=2183, stdwtitl.s
   L3380-L3418, function F0x80086108 @ RAM 0x80086108). This is the FULL
   320x240 background -- three FIELDCOM-style sprite-directory draws
   (sub-dirs 0/1/2 of ttcommpk, each `sp94(pack, clip=0, x=0, y=0)`), each
   directory's own clip lays its layer(s) out with baked absolute dx/dy so
   the three draws tile continuously: dir0 -> x=0..128 (texture sub4),
   dir1 -> x=128..256 (texture sub5), dir2 -> x=256..320 (texture sub6).
   This is the same "green circuit board" texture already characterized in
   docs/research/ui/screen-pack-format.md's ttcommpk section (there
   misidentified as dialogue-box chrome and corrected 2026-07-01) --
   confirmed here by direct overlay evidence to be the STDWTITL background,
   not talk-box chrome.

2. **tlogo{jpn,usa,pal}** (region-selected: stdwtitl.s L5489-L5492 is a
   7-entry x 2-word table at D0x8008824c; F0x80086df8 reads
   `entry = table[*(s32*)0x8005CCA8]`, calls
   `sp3C(unk424(entry.word0))` -- a VRAM-preload call, not an immediate
   draw -- and stashes `entry.word1` to a global (0x80088234) for a second,
   un-transcribed consumer. Region index 0 -> tlogojpn (0x0886), index 1
   -> tlogousa (0x08a4 = LBA_TLOGOUSA_BIN_IDX=2212), indices 2-6 all ->
   tlogopal (0x094d). This VALIDATES tools/decode_title_art.py's existing
   asset (tlogousa/1/{0,1}.bin, region index 1 = USA) as the correct pack
   source for the logo; 1/2.bin is a 0-byte file so the existing 2-layer
   composite already uses everything sub-dir 1 has.

   **CORRECTED 2026-08-14.** The stashed `entry.word1` (sub-directory 0, the
   handle at 0x80088234) is NOT an un-transcribed consumer's animation table:
   it is an ordinary eleven-clip sprite directory, and it is where the whole
   title screen is drawn from. Its positioned draws are F0x800850c8 (the
   logo), F0x80084c3c (the wordmark), F0x8008426c (the numeral and its
   reveal glow) and F0x800852f0 (the menu). See `title_menu` below and
   docs/research/ui/stdwtitl-title-menu-2026-08-14.md.

No text-widget ctors (`F0x8001ae38`/`F0x8001b364`) appear anywhere in this
overlay. That finding is true; the conclusion drawn from it in 2026-07-11 was
not. **There IS a native two-option menu -- Start and Continue** -- and the
reason a font-widget search could not find it is that every word on this
screen is a picture in a sprite pack. The walker's title screen now renders
that native menu (web/titlescreen.js); do not re-describe it as
walker-authored UX.

Output:
  web/assets/ui/stdwtitl_bg.png   -- 320x240 RGBA background composite
  web/assets/data/stdwtitl_ui.json -- pack identities + provenance
"""
import os
import json
import struct
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
TTCOMMPK = DDW3 / "pack/dw2003/screen/ttcommpk"
OUT_PNG = REPO / "web/assets/ui/stdwtitl_bg.png"
OUT_JSON = REPO / "web/assets/data/stdwtitl_ui.json"
OUT_TWINKLE_JS = REPO / "web/title-twinkle-data.js"
OVERLAY_BIN = REPO / "web/assets/native/screens/pro_stdwtitl.bin"

OVERLAY_BASE = 0x80082CB0
TWINKLE_TABLES = (0x80087DDC, 0x80087E20, 0x80087E74, 0x80087F2C,
                  0x80087FF8, 0x800880F4, 0x8008816C, 0x800881BC)


def extract_twinkles():
    """Copy the eight {clip, duration} scripts and two position tables."""
    binary = OVERLAY_BIN.read_bytes()

    def pair(addr):
        off = addr - OVERLAY_BASE
        if off < 0 or off + 4 > len(binary):
            raise ValueError(f"title twinkle table outside overlay: {addr:#x}")
        return list(struct.unpack_from("<hh", binary, off))

    scripts = []
    for addr in TWINKLE_TABLES:
        script = []
        for index in range(96):
            value = pair(addr + index * 4)
            script.append(value)
            if value[0] == 0xFF:
                break
        else:
            raise ValueError(f"unterminated title twinkle script: {addr:#x}")
        scripts.append(script)
    return {
        "scripts": scripts,
        "positions": [
            [pair(0x80088214 + i * 4) for i in range(3)],
            [pair(0x80088220 + i * 4) for i in range(5)],
        ],
    }


def unrlen(blob: bytes) -> bytes:
    """RLEN RLE: op<0x80 = copy op literal bytes; op>=0x80 = repeat next byte op-0x80 times."""
    if blob[:4] != b"RLEN":
        raise ValueError(f"bad RLEN magic: {blob[:4]!r}")
    total = struct.unpack_from("<I", blob, 4)[0]
    out = bytearray()
    i = 8
    while len(out) < total:
        op = blob[i]
        i += 1
        if op < 0x80:
            out += blob[i : i + op]
            i += op
        else:
            out += bytes([blob[i]]) * (op - 0x80)
            i += 1
    return bytes(out)


def hw(atlas: bytes, x: int, y: int) -> int:
    return struct.unpack_from("<H", atlas, (y * 64 + (x & 0x3F)) * 2)[0]


def load_texture(sub: int):
    """ttcommpk/<sub>/0.bin: RLEN block chain -> (atlas pages, CLUT blocks).
    Same block-chain shape as extract_screen_packs.load_pack's tm branch
    (link/dest/bw/bh header per block; bw==0x100 => CLUT, else pixel page)."""
    d = unrlen((TTCOMMPK / str(sub) / "0.bin").read_bytes())
    pos = 8
    atlases, cluts = [], []
    while True:
        link, _dest, bw, bh = struct.unpack_from("<IIHH", d, pos)
        data = d[pos + 12 : pos + 12 + bw * bh * 2]
        (cluts if bw == 0x100 else atlases).append(data)
        if link & 0x8000:
            break
        pos += link & 0x7FFF
    return atlases, cluts


def load_directory(sub: int):
    """ttcommpk/<sub>/{0,1,2}.bin: a single-id FIELDCOM-style sprite
    directory (frames=0.bin, ids=1.bin, clip=2.bin). Same 14B frame record
    and clip record layout as tools/extract_fieldcom.py / extract_screen_packs.py."""
    root = TTCOMMPK / str(sub)
    fr = (root / "0.bin").read_bytes()
    frames = [struct.unpack_from("<7H", fr, i * 14) for i in range(len(fr) // 14)]
    clip = (root / "2.bin").read_bytes()
    count, clut_y_add = struct.unpack_from("<HH", clip, 0)
    (semi,) = struct.unpack_from("<h", clip, 4)
    layers = [struct.unpack_from("<Hhh", clip, 6 + k * 6) for k in range(count)]
    return frames, clut_y_add, semi, layers


def cut_frame_8bpp(frames, atlases, cluts, fi: int, clut_y_add: int) -> Image.Image:
    """8bpp frame cut (frame flags bit0=1): 2 texels/halfword, 256-color CLUT
    rows stacked in the pack's own CLUT block. Identical formula to
    extract_screen_packs.cut_frame's `fl & 1` branch."""
    u, v, w, h, _cx, cy, fl = frames[fi]
    assert fl & 1, f"expected 8bpp frame, got flags={fl:#x}"
    ai, ul = divmod(u, 128)
    k = cy - 0x100 + clut_y_add
    clut = cluts[0]
    to_rgba = lambda p: ((p & 31) << 3, ((p >> 5) & 31) << 3, ((p >> 10) & 31) << 3, 0 if p == 0 else 255)
    rgba = [to_rgba(struct.unpack_from("<H", clut, (k * 256 + i) * 2)[0]) for i in range(256)]
    img = Image.new("RGBA", (w, h))
    put = img.putpixel
    for yy in range(h):
        for xx in range(w):
            t = ul + xx
            half = hw(atlases[ai], t // 2, v + yy)
            put((xx, yy), rgba[(half >> ((t % 2) * 8)) & 0xFF])
    return img


# (directory sub, texture sub) pairs, in F0x80086108's draw order
# (stdwtitl.s L3388-L3396: sp84(0x300,0)+draw dir0, sp84(0x340,0)+draw dir1,
# sp84(0x380,0)+draw dir2 -- the sp84 mode switch is read as "bind texture
# page N", matched here by directory index -> texture sub via ai=0 stability
# and screen-covering dx placement baked in each directory's own clip).
BACKGROUND_LAYERS = ((0, 4), (1, 5), (2, 6))


def build_background() -> Image.Image:
    canvas = Image.new("RGBA", (320, 240), (0, 0, 0, 0))
    for dir_sub, tex_sub in BACKGROUND_LAYERS:
        frames, clut_y_add, _semi, layers = load_directory(dir_sub)
        atlases, cluts = load_texture(tex_sub)
        for fi, dx, dy in layers:
            im = cut_frame_8bpp(frames, atlases, cluts, fi, clut_y_add)
            canvas.alpha_composite(im, (dx, dy))
    return canvas


MANIFEST = {
    "_provenance": (
        "docs/research/ui/stdwtitl-decoded-2026-07-11.md; overlay "
        "~/ddw3/asm/dw2003/pro/stdwtitl.s, RAM base 0x80082cb0"
    ),
    "background": {
        "pack": "ttcommpk",
        "handle_hi": "0x0887",
        "lba_idx": 2183,
        "lba_const": "LBA_TTCOMMPK_BIN_IDX",
        "disasm": "F0x80086108 @ RAM 0x80086108 (stdwtitl.s L3358-L3428); "
                   "sp94(unk424(0x08870000..2), 0, 0, 0) x3",
        "image": "web/assets/ui/stdwtitl_bg.png",
        # Three full-screen clips at the origin, one per texture page.
        "x": 0, "y": 0,
        "size": [320, 240],
        "note": "full-screen 'circuit board' terminal-boot background; "
                "previously characterized in screen-pack-format.md as "
                "possible dialogue chrome (corrected 2026-07-01) -- this "
                "overlay is the first direct evidence of ttcommpk's real "
                "screen (STDWTITL, not talk-box chrome).",
    },
    "logo": {
        "pack_family": "tlogo{jpn,usa,pal}",
        "region_table": {
            "addr": "D0x8008824c",
            "disasm": "stdwtitl.s L5489-L5492; selector *(s32*)0x8005CCA8, "
                       "F0x80086df8 @ RAM 0x80086df8",
            "entries": [
                {"region": 0, "name": "tlogojpn", "handle": "0x08860001", "handle_alt": "0x08860000"},
                {"region": 1, "name": "tlogousa", "handle": "0x08a40001", "handle_alt": "0x08a40000"},
                {"region": 2, "name": "tlogopal", "handle": "0x094d0001", "handle_alt": "0x094d0000"},
            ],
        },
        "existing_asset": "web/assets/title_logo.png (tools/decode_title_art.py, "
                           "region=USA tlogousa/1/{0,1}.bin; 1/2.bin is a "
                           "0-byte file so nothing is missing from that "
                           "2-layer composite) -- pack source CONFIRMED "
                           "correct by this overlay's own region table.",
        "open_gap": "RESOLVED 2026-08-14 -- see `title_menu` below. The logo's "
                     "positioned draws are F0x800850c8 (clip 0) and "
                     "F0x80084c3c (clip 1), both drawing from the COMPANION "
                     "handle at 0x80088234 (sub-directory 0), not from the "
                     "sp3C-preloaded handle. The companion is an ordinary "
                     "eleven-clip sprite directory, not the animation table "
                     "the 2026-07-11 note guessed at.",
    },
    # ── The END card ────────────────────────────────────────────────────────
    # DECODED 2026-08-14. F0x8008453c is not a boot-animation dispatcher: it is
    # a seven-entry jump table indexed by the LANGUAGE global that picks which
    # of four END images to draw, and F0x80084628 is the sequence around it.
    "end_screen": {
        "pack": "endall",
        "pack_source": "~/ddw3/pack/dw2003/screen/end__all (LBA_END__ALL_BIN_"
                       "IDX 2214); handle 0x08A60000 resolved through "
                       "[0x80044f5c] at stdwtitl.s L0x00001934-L0x00001944",
        "sheet": "web/assets/ui/endall_sheet.png",
        # The clip's own layer offset is (96, 100) and the draw call passes
        # (0, 0), so the card lands at (96, 100). A 128x40 image there is
        # exactly centred on the 320x240 screen, both ways.
        "x": 96, "y": 100, "w": 128, "h": 40,
        "language_table": {
            "addr": "0x80082cb0",
            "selector": "[0x8005cca8]",
            "entries": 7,
            "gate": "sltiu 0x7 @stdwtitl.s L0x000018a8; out of range falls to "
                    "clip 0",
            # language index -> clip. Read from the seven words at file 0x0,
            # whose targets set the clip in $s0 at L0x000018d4-L0x000018ec.
            "clip_by_language": {
                "0": 0, "1": 0, "2": 0, "3": 2, "4": 3, "5": 1, "6": 2,
            },
            "language_order": ["jpn", "usa", "eng", "fra", "ita", "ger", "spn"],
            "note": "The art reads END / Ende / Fin / Fine for clips 0/1/2/3, "
                    "so jpn, usa and eng take END, ger takes Ende, fra and spn "
                    "take Fin, and ita takes Fine. That is a fourth "
                    "independent reproduction of the language index order.",
        },
        "clip_labels": {"0": "END", "1": "Ende", "2": "Fin", "3": "Fine"},
        # The fade is a CLUT row walk, not alpha. The screen object's +0x50
        # level goes through draw-context slot +0x88 (set CLUT row offset,
        # ledger UI-DRAWCTX-VTABLE-001) at L0x00001920-L0x0000192c. The frames
        # name CLUT y 240 in a 256-row page, so the levels are rows 240..255,
        # and those 16 rows are a white-to-green ramp: level 15 is white and
        # level 0 the settled green. The sheet carries all 16 as ids "<clip>"
        # and "<clip>#1".."<clip>#15".
        "fade": {
            "levels": 16, "min": 0, "max": 15,
            "ticks_per_step": 2,
            "clut_row_base": 240,
            "level_15": "white", "level_0": "green",
            "draw_ctx_slot": "+0x88 (set CLUT row offset)",
        },
        # F0x80084628, the state machine. `timer` is +0x52, advanced every
        # frame by the resident vsync delta; `level` is +0x50.
        "sequence": [
            {"state": 0, "does": "fade in: level 15 -> 0, one step per 2 timer "
                                 "units, then advance", "disasm": "default arm"},
            {"state": 1, "does": "hold until timer >= 0x78 (120)"},
            {"state": 2, "does": "hold until timer >= 0x4650 (18000), or until "
                                 "the player presses logical button 3, which "
                                 "sets the timer straight to 0x4650"},
            {"state": 3, "does": "fade out: level 0 -> 15, one step per 2 "
                                 "timer units, then advance"},
            {"state": 4, "does": "hold until timer >= 0x3c (60)"},
            {"state": 5, "does": "call the resident loading message 0xE01 and "
                                 "hand off"},
        ],
        "entry": "on entry the object sets level 15 and timer 0",
        "disasm": "stdwtitl.s F0x8008453c (draw) + F0x80084628 (sequence); "
                  "exe-decomp/stdwtitl_c/F0x80084628.c",
    },
    "menu_text": {
        "finding": "No F0x8001ae38 (text-label ctor) or F0x8001b364 "
                    "(cursor-sprite ctor) call appears anywhere in this "
                    "overlay -- the real STDWTITL screen draws NO dynamic "
                    "menu text via the standard CMFONT widget system.",
        "implication": "CORRECTED 2026-08-14. The 2026-07-11 conclusion drawn "
                        "from this -- 'the walker's New Game / Continue "
                        "buttons are walker-authored UX, not decoded chrome' "
                        "-- is WRONG. The finding above is true and its "
                        "explanation is simply that every word on this screen "
                        "is a picture in a sprite pack, so a search for font "
                        "widgets could not have found the menu. There IS a "
                        "native two-option menu; see `title_menu`.",
    },
    # ── The title menu ──────────────────────────────────────────────────────
    # DECODED 2026-08-14, ledger UI-TITLE-MENU-2026-08-14 /
    # UI-TITLE-LOGO-PLACEMENT-2026-08-14 / UI-TITLE-SEQUENCE-2026-08-14.
    # F0x800869d0 (the nine-state title sequence), F0x80085594 (the menu's own
    # state machine), F0x800852f0 (the menu draw) and F0x80086834 (what each
    # choice does). All coordinates are the literal arguments of the draw
    # calls, on the 320x240 screen.
    "title_menu": {
        "sheet": "web/assets/ui/tlogousa_sheet.png",
        "pack": "tlogousa",
        "pack_half": "sub-directory 0, the handle the overlay stashes at "
                     "0x80088234; its pixels are in sub-directory 1",
        # The legal block. F0x80083054 draws all three whenever its object's
        # +0x54 is set, and F0x800831e8 runs two CLUT-row scripts into it:
        # 0x80087C54 (0..11 then -1) drives clip 3 and 0x80087C6E (0..7 then
        # -1) drives clip 5. State 2 settles them at 11 and 7 and holds. Clip 6
        # takes no shift. In the USA pack only clip 6 has pixels -- the frames
        # clips 3 and 5 name are empty in the extracted sheet, and whether that
        # is the disc or our extraction is NOT established.
        "legal_block": {
            "draw": "F0x80083054; script F0x800831e8",
            "gate": "the object's +0x54",
            "clips": {
                "6": {"what": "the copyright line", "at": [29, 209]},
                "3": {"what": "unread; no pixels in the USA sheet",
                      "at": [8, 28], "clut_script_ram": "0x80087C54",
                      "clut_script": list(range(12)), "settles_at_row": 11},
                "5": {"what": "unread; no pixels in the USA sheet",
                      "at": [20, 202], "clut_script_ram": "0x80087C6E",
                      "clut_script": list(range(8)), "settles_at_row": 7},
            },
            "draw_order": [6, 3, 5],
        },
        "clips": {
            "0": {"what": "DIGIMON / Digital Monsters logo",
                  "draw": "F0x800850c8", "settles_at": [19, 24],
                  "starts_at": [-301, 24],
                  "slides_from": "left", "steps": 10,
                  "x_from_counter": "19 - counter*32 (F0x80085160, unk54=10..0)"},
            "1": {"what": "DIGIMON WORLD wordmark",
                  "draw": "F0x80084c3c", "settles_at": [19, 111],
                  "starts_at": [339, 111],
                  "slides_from": "right", "steps": 10,
                  "x_from_counter": "19 + counter*32 (F0x80084cd4, unk54=10..0)"},
            "2": {"what": "the numeral 3", "draw": "F0x8008426c",
                  "at": [253, 100]},
            "4": {"what": "the glow that REVEALS the 3 -- the numeral is "
                          "hidden while this plays, and the two swap in one "
                          "step (F0x800843a4 states 1 and 2). They are never "
                          "on screen together.",
                  "draw": "F0x8008426c", "at": [243, 90],
                  "script_ram": "0x80087d58",
                  "script": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
                             10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
                  "script_end": -1,
                  "note": "s16 table: 0..11 then 10..0 then -1. Each value is "
                          "a CLUT-row offset via sp98. JSON 2026-08-14 said "
                          "0..11 then 11..0; the overlay does not repeat 11 "
                          "on the way down.",
                  "jpn_differs": "F0x800840a8 walks 0..11 at 0x80087d40 (12 "
                                 "steps) then LEAVES glow level 11 behind the "
                                 "numeral. Glow draw F0x80083f80 always issues "
                                 "clip 4; numeral clip 2 only when unk5C!=0."},
            "7": {"what": "the selection box, hollow blue 164x18",
                  "draw": "F0x800852f0", "at": "the chosen option, y - 1"},
            "8": {"what": "Press Start Button", "at": [79, 166]},
            "9": {"what": "Start (the upper option)", "settles_at": [79, 154]},
            "10": {"what": "Continue (the lower option)",
                   "settles_at": [79, 174]},
        },
        # The two options slide apart from the prompt's position over 15
        # frames; their settled positions are the two (x, y) pairs at
        # 0x80087d88, and the prompt's own position is the third pair there.
        "split": {"from": [79, 166], "to": [[79, 154], [79, 174]],
                  "frames": 15},
        # Which three clips get drawn, by language index [0x8005cca8]. Four
        # bytes per language at 0x80087da0: prompt, upper option, lower option.
        "clip_by_language": {
            "0": [8, 9, 10], "1": [8, 9, 10], "2": [8, 9, 10],
            "3": [17, 18, 19], "4": [11, 12, 13],
            "5": [20, 21, 22], "6": [14, 15, 16],
        },
        "language_order": ["jpn", "usa", "eng", "fra", "ita", "ger", "spn"],
        "language_note": "The USA pack ships clips 0..10, the trio index 1 "
                          "needs. The PAL sheet is now extracted; its option "
                          "clips 9, 10, 12, 13, 15, 16, 18, 19, 21 and 22 "
                          "have selected and unselected palette rows.",
        # F0x800852f0 passes (chosen row != this option) to the palette slot.
        "option_palette": {"selected": 0, "unselected": 1},
        "controls": {"pad_bit_4": "highlight the upper option",
                     "pad_bit_6": "highlight the lower option",
                     "pad_bit_13": "confirm",
                     "pad_bit_3": "leave the prompt phase"},
        "sfx": {"cursor_move": "0x8004513e", "confirm": "0x8004503c",
                "split": "0x8004113e"},
        "idle_timeout_ticks": 600,
        "outcomes": {
            "upper": "archive load 0x166 (LBA_FIELDSTG_PRO_IDX 358), then "
                     "scene 0x2d7 -- DECODED 2026-08-14 as the Street Corner "
                     "in Kusanagi City, stage overlay 780, which is also "
                     "where the ending movie hands off. Ledger "
                     "FIELD-SCENE-2D7-STREET-CORNER-2026-08-14.",
            "lower": "launch code 0xc00 argument 0 -- the stmcrd overlay's "
                     "LOAD row in the stage-select table",
            "idle": "launch code 0xe01 / 0xe02 -- RESOLVED 2026-08-14. A "
                    "launch code's LOW BYTE selects the entry point inside "
                    "the loaded overlay: 0x00 the title screen, 0x0d the END "
                    "card, otherwise movie index = lowByte - 1. So 0xe01 is "
                    "the MOVIEOP2 opening and 0xe02 the MOVIEOPN opening, and "
                    "both hand back to 0x0e00, the title screen. The "
                    "international build always takes 0xe02; the Japanese "
                    "build reads the PREVIOUS screen code and alternates "
                    "between the two. Ledger "
                    "UI-SCREEN-LAUNCH-CODE-SHAPE-2026-08-14 and "
                    "UI-TITLE-ATTRACT-LOOP-2026-08-14.",
        },
        "attract_loop": {
            "international": ["0xe02 (MOVIEOPN)", "back to 0x0e00 (title)"],
            "japanese": "alternates 0xe01 / 0xe02 by the previous screen code",
            "after_the_end_card": "0xe01 (MOVIEOP2), no language test",
        },
        # The player uses a 320x480, 24-bit interlaced display
        # (F0x80083cc0). The stream header gives 320x416. The movie transfer
        # callback sets the upload rectangle's Y to 0x24 (36), then walks its
        # 24-word-wide strips across the display (stdwtitl.s L0x00000b38 and
        # L0x00000be8). Half the interlaced display height is the browser's
        # 320x240 logical picture, so Y=18 and height=208 there.
        "movie_display": {
            "interlaced": [320, 480], "picture": [0, 36, 320, 416],
            "logical": [0, 18, 320, 208], "fps": 15,
            # The picture count the movie player ends on. The frame fetch
            # (stdwtitl.s L0x00000960-L0x00000988) compares the stream header's
            # frame number (+0x08 of the STR header; +0x10, read next, is the
            # width) with [0x8008926C], and raises the end flag once the frame
            # number is no longer below it. F0x80083cc0 fills [0x8008926C] from the
            # movie row's second word, which is 0x6F0 = 1776 in both opening rows
            # (stdwtitl.s L0x00004fec, L0x00004ff8). The streams themselves carry
            # 1792 pictures, so the disc stops 16 pictures (1.07 s) before the
            # file's end, and the walker does the same.
            "frames": 0x6F0,
            "launch": {"0xe01": "movieop2.mp4", "0xe02": "movieopn.mp4"},
        },
        "fade_out": {"frames": 30, "shape": "one full-screen quad given as "
                                            "four corners, eased 0..255",
                     "disasm": "F0x80085f44 + F0x80085cd4 + F0x80085d64"},
        "prompt_hold_frames": 6,
        "settle_frames": 6,
        "prompt_hold_disasm": "F0x80085594 case1/default: unk54 >= 6 then box",
        "jpn_layout": {
            "logo": {"settles_at": [17, 61], "starts_at": [-303, 61],
                     "x_from_counter": "17 - counter*32",
                     "disasm": "F0x80084edc"},
            "wordmark": {"settles_at": [207, 34], "starts_at": [527, 34],
                         "x_from_counter": "207 + counter*32",
                         "disasm": "F0x80084a70"},
            "numeral": {"at": [49, 121], "disasm": "F0x80083f80 clip 2"},
            "glow": {"at": [37, 114], "disasm": "F0x80083f80 clip 4",
                     "script_ram": "0x80087d40",
                     "script": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
                     "stays_lit_at": 11},
        },
    },
    "open_gaps": [
        "Where launch codes 0xe01 / 0xe02 actually go. The country-select "
        "screen and the END card hand off with the same pair, so all three "
        "funnel to one place, but that place is not identified.",
        "What is at launch code 0x2d7 beyond the developer label.",
        "The Japanese build's three boot-screen state machines (F0x800840a8, "
        "F0x80084a70, F0x80084edc) -- identified by constructor only.",
        "About fourteen functions in 0x80086fa0..0x80087b5c, probably "
        "movie-decoder helpers per the overlay's MDEC assert strings.",
        "tlogousa clips 3, 5 and 6, which render flat white under the palette "
        "row their frames name.",
    ],
}


def main() -> int:
    OUT_PNG.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    bg = build_background()
    bg.save(OUT_PNG)
    twinkles = extract_twinkles()
    MANIFEST["background"]["twinkles"] = twinkles
    OUT_JSON.write_text(json.dumps(MANIFEST, indent=2) + "\n")
    OUT_TWINKLE_JS.write_text("// Generated by tools/extract_stdwtitl_ui.py from the title overlay.\n"
                              "export const TITLE_TWINKLES = "
                              + json.dumps(twinkles, separators=(",", ":")) + ";\n")
    print(f"wrote {OUT_PNG} ({bg.size[0]}x{bg.size[1]}) and {OUT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
