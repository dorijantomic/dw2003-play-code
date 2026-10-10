#!/usr/bin/env python3
"""Extract the menu screen packs (<name>cs sprite directory + <name>tm RLEN
texture atlases) from ~/ddw3/pack/dw2003/screen to walker assets.

Decoded 2026-07-03 (supersedes build_ui_assets.py's TIM interpretation of
ststattm, which produced the garbled ststat.png): the *tm packs are NOT TIMs —
they're RLEN-compressed 64hw x 256 4bpp atlases with CLUTs in the bottom rows,
and the *cs packs are FIELDCOM-format sprite directories over them (frame u
crosses atlases: u<256 -> atlas 0, 256..511 -> atlas 1, ...; CLUTs read from
atlas 0). Format reference: docs/research/ui/fieldcom-sprite-directory-decoded-
2026-07-02.md; the ddw3 pack extractor splits the directory into 0/0.bin
(frames), 0/1.bin (ids), 0/2+.bin (clips).

ststatcs frames 0-28 are the Choose-Digimon pedestal portraits; 29+ are the
status-menu chrome; 45-47 the diamond-tile backdrop. Same format for stshop,
namedt, stalbm, stcdsp, stfrpt, cmnbgd, stwmp0/1.

Output per pack: web/assets/ui/<name>_sheet.png + <name>_sheet.json
(ids -> clip layers with sheet rects, matching fieldcom.json's shape).
"""

import os
import json
import struct
import sys
from pathlib import Path

from PIL import Image

SCREEN = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "pack/dw2003/screen"
COUNTRY = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "pack/dw2003/country"
DISC = Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin")
REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "web/assets/ui"

# Packs the walker uses today. The remaining pairs (namedt, stalbm, stcdsp,
# stfrpt) decode with the same code — add them here when a screen needs them.
# "cmfont" is special-cased: its cs directory lives in pack/dw2003/country
# and its atlases are the two RLEN font pages inside CMFONTTM.BIN on disc
# (same source extract_ui_font.py uses). The status menu's PARTY CARD chrome,
# header/EXP plates and blink arrow are CMFONTCS clips (ststatus.s draws them
# with pack handle 0x02860000 = LBA 646) — see tools/extract_status_ui.py.
#
# stwmp0 (cs LBA 0x799, tm 0x79a; Asuka) / stwmp1 (cs 0x79b, tm 0x79c;
# Amaterasu) are the MAP-screen packs: the pack handle LOW u16 = cs/tm
# SUB-DIRECTORY index — sub 0 = the dark "unexplored" world map (ONE clip
# assembling 28 tiles into 392x352 + a 16px banner strip above the origin),
# sub 1 = the per-AREA revealed-terrain patches (clip = area id - 1, drawn
# over the base at status_ui.json map.area_positions[area]; rig-verified
# 2026-07-11), sub 2 = location markers (ids 1-37) + cursor/legend (50-61).
# The map tiles are 8bpp (frame flag bit 0): atlas index = u_px // 128, and
# their three 256-color CLUTs are a separate type-9 block in tm file 0
# (see load_pack), uploaded to VRAM (0x140, 0x100+k); frame clut y 0x100+k
# selects CLUT row k. Entries: (name, csdir, tmdir) — plain names keep dir 0.
PACKS = ("ststat", "stshop", "cmnbgd", "cmfont", "stcdsp", "stalbm", "namedt",
         "stfrpt",
         ("stwmp0map", "stwmp0", 0), ("stwmp0area", "stwmp0", 1),
         ("stwmp0icon", "stwmp0", 2), ("stwmp1map", "stwmp1", 0),
         ("stwmp1area", "stwmp1", 1), ("stwmp1icon", "stwmp1", 2))

# CLUT-cycled clips: the game animates these by adding k to the frame's CLUT
# row (sp98(k) -> ctx+0x20, added at fns.s 0x8001ef80..b0 before the <<6 CLUT
# address shift). Emitted as extra manifest ids "<id>#<k>" (k=0 = base id).
#   ststat 0x1e (30) = orange selection corners, k 0..7 cycle + k=8 locked;
#   ststat 0x34/0x35 (52/53) = items-bag page arrows, k 0..3;
#   cmfont 0x0a (10) = footer blink arrow, k 0..4.
#   stmcrd 0x23 (35) = the memory-card console graphic, pulsed by the slot
#     chooser's own 0..0xC ping-pong counter (stgmcard.s F0x800843d8:
#     sp98(unk D4), counter capped at 0xC then walked back to 0).
#   carddata3 (the card duel's board sheet) animates three clips by CLUT row:
#     0 = the 30-tile field backdrop, faded in 0 -> 0xB then held (F0x80096950);
#     8 = the card select/highlight border -- rows 0..3 from the ping-pong
#         table at 0x800A5B0C, row 4 for the plain highlight, and rows 5..8 for
#         the same table + 5 (F0x8009acac, F0x80099de8);
#     9 = the active-card border, row = (timer/2) % 5 (F0x8009b76c).
#   endall (the END card) fades by CLUT row, not by alpha: stdwtitl's
#     F0x8008453c pushes the screen object's +0x50 level through draw-context
#     slot +0x88 (set CLUT row offset), and the state machine F0x80084628 walks
#     that level 15 -> 0 and back 0 -> 15, two timer units per step. The frames
#     name CLUT y 240 inside a 256-row page, so rows 240..255 are exactly the
#     16 steps.
CLUT_CYCLES = {
    # Title glow (0..11), the two legal marks (0..11 / 0..7), and the
    # three-frame selection-box flash use the decoded title palette rows.
    # The menu puts its unselected choice at row +1; both labels need it.
    "tlogojpn": {3: 12, 4: 12, 5: 8, 7: 4, 9: 2, 10: 2},
    "tlogousa": {3: 12, 4: 12, 5: 8, 7: 4, 9: 2, 10: 2},
    "tlogopal": {3: 12, 4: 12, 5: 8, 7: 4,
                 **{clip_id: 2 for clip_id in (9, 10, 12, 13, 15, 16, 18, 19, 21, 22)}},
    # Native naming draws resting action keys at row +4 and the selected
    # key at +0. Keep the intervening authored rows for the colour pulse.
    "namedt": {sid: 5 for sid in (44, 45, *range(60, 67),
                                  *range(68, 75), *range(76, 83))},
    "endall": {0: 16, 1: 16, 2: 16, 3: 16},
    "ststat": {30: 9, 52: 4, 53: 4},
    "cmfont": {10: 5},
    "stmcrd": {35: 13},
    "carddata3": {0: 12, 8: 9, 9: 5},
    # The folder chooser's two row plates. The capture shows the selected
    # row in amber against blue for the others, which is a CLUT row, not a
    # second clip -- clip 71 differs from 70 only by the 4px arrow tab.
    # The folder chooser's selected plate (clip 71, the folder-cursor marker)
    # cycles its CLUT row mod 16 while looping, then min(counter>>1,7) once
    # confirmed (F0x80095e58 file 0x130e0-0x1327c; claim
    # cardgame-folder-row-clut-cycle-2026-09-13). The carddata2 CLUT block
    # really has 16 rows: cutting k=0..15 gives a white->amber->white ramp whose
    # k=8..15 half mirrors k=7..0, so all 16 are extracted (the old 8 was the
    # unresolved disagreement the claim recorded).
    "carddata2": {70: 8, 71: 16},
    # stnmet (the registration wizard's window art). The wizard chrome
    # (pro/stplnmet F0x80083774) draws its message-box clip 0x0F with
    # setClutRow(chrome.pose) -- the SAME clip at a shifted palette row, not a
    # second picture. pose ramps 0..3 while the box opens (clamped at 3) and
    # reaches 7 when the message is fully revealed, so the box needs rows
    # 0..7. Row 0 (the wheel's own cy 248) is a LIGHT blue (64,120,160); row 3
    # (cy 251) is the DEEP blue (0,16,32) the console draws once the box has
    # settled. Cutting only row 0 made every shifted draw fall back to the
    # light row -- the operator's "light blue where the original is deep blue".
    "stnmet": {15: 8},
    # Command-row cel 0x22: selected-row CLUT 0..4 from +0x80>>2 (F0x8009add4).
    "pgfgc00": {34: 5},
    # The fight report's marks (F0x80083744). The mark over the page's partner
    # and the mark over one digivolution bar cycle four colours; the level
    # arrow, its plate, the bar marker and its bar RAMP through eleven and stop.
    "stfrpt": {36: 4, 37: 4, 34: 11, 35: 11, 31: 11, 32: 11},
}

LBA_CMFONTTM = 647  # rust/dw2003_exe_data/src/lba.rs LBA_CMFONTTM_BIN_IDX
EXE_RAM = 0x80010000

# ststatcs ids 0-28 are the pedestal portraits, 3-4 animation clips per
# partner. Id 29 is the full pre-composed diamond-tile backdrop.
#
# CORRECTED 2026-09-04. Kumamon and Veemon were the wrong way round, so the
# status screen showed each of them as the other. The fight report's own
# picture table, read out of the running game, gives Kumamon 14,15,16 and
# Veemon 25..28, and the two packs carry the SAME art at the SAME ids -- clip
# 14 is the bear in a cap and clip 25 is the blue dragon, in both. Claim
# FIGHT-REPORT-PORTRAIT-FRAMES-001.
STSTAT_PORTRAITS = {  # digimon id -> animation clip ids
    1: [7, 8, 9, 10],    # Kotemon
    2: [14, 15, 16],      # Kumamon
    3: [11, 12, 13],      # Monmon
    4: [3, 4, 5, 6],      # Agumon
    5: [25, 26, 27, 28],  # Veemon
    6: [0, 1, 2],         # Guilmon
    7: [17, 18, 19, 20],  # Renamon
    8: [21, 22, 23, 24],  # Patamon
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
    # y unmasked: stwmp atlas 0 carries 256-color CLUTs in rows 256..267
    return struct.unpack_from("<H", atlas, (y * 64 + (x & 0x3F)) * 2)[0]


def _disc_exe():
    raw = DISC.read_bytes()
    exe = b"".join(raw[l * 2352 + 24 : l * 2352 + 24 + 2048]
                   for l in range(24, 24 + 0x48000 // 2048))
    return raw, exe


def _lba_of(exe: bytes, idx: int) -> int:
    """Disc sector for pack-handle high-u16 `idx` (the lui value = LBA table
    index; e.g. ststat 0x404, cmfont 0x286, stdglabo 0x2c5)."""
    return struct.unpack_from("<I", exe, 0x800 + (0x80044F6C - EXE_RAM) + idx * 4)[0]


def _read_lba(raw: bytes, lba: int, nsec: int) -> bytes:
    return b"".join(raw[(lba + i) * 2352 + 24 : (lba + i) * 2352 + 24 + 2048]
                    for i in range(nsec))


def unpack_archive(blob: bytes):
    """ddw3 PACK archive (tools/ddw3-pack): a u32 offset table whose length is
    (first non-null offset)/4; each entry spans to the next non-null offset (or
    EOF). Nestable — a screen pack is archive(cs_subdirs) / archive(files)."""
    i = 0
    while struct.unpack_from("<I", blob, i * 4)[0] == 0:
        i += 1
    n = struct.unpack_from("<I", blob, i * 4)[0] // 4
    offs = [struct.unpack_from("<I", blob, k * 4)[0] for k in range(n)]
    out = []
    for idx, st in enumerate(offs):
        if st == 0:
            out.append(b"")
            continue
        end = next((o for o in offs[idx + 1:] if o != 0), len(blob))
        out.append(blob[st:end])
    return out


def load_disc_pack(cs_idx: int, tm_idx: int, sub: int, tm_sub: int = None):
    """Load a screen pack straight from the disc image by pack-handle index
    (for packs the ddw3 splat left unextracted, e.g. stdglabo cs=0x2c5,
    tm=0x2c6). Returns the same 5-tuple as load_pack. The cs archive nests
    one level (subdirs), each subdir = [frames, ids, clip0, clip1, ...]; the
    tm is a 16-byte wrapper + RLEN blob (magic at +0x10) -> the 64hw x 256
    4bpp atlas (block chain, same as load_pack's tm branch).

    `sub` indexes the cs archive's PHYSICAL top-level slot (matches the pack
    handle's low u16 directly, e.g. sttrng uses handles 0x028c0000/0x028c0003
    -> physical cs slots 0/3, with slots 1/2 empty padding). `tm_sub`
    optionally indexes the (separately-filtered, non-empty-only) tm file list
    when it doesn't share the cs slot numbering 1:1 (sttrng ships only ONE
    non-empty tm entry shared by both cs subdirs, unlike stdglabo's 2)."""
    if tm_sub is None:
        tm_sub = sub
    raw, exe = _disc_exe()
    cs = _read_lba(raw, _lba_of(exe, cs_idx), 16)
    subdir = unpack_archive(unpack_archive(cs)[sub])
    frames = [struct.unpack_from("<7H", subdir[0], i * 14)
              for i in range(len(subdir[0]) // 14)]
    ids = []
    for b in subdir[1]:
        if b == 0xFF:
            break
        ids.append(b)
    clips = []
    for d in subdir[2:2 + len(ids)]:
        count, clut_y_add = struct.unpack_from("<HH", d, 0)
        (semi,) = struct.unpack_from("<h", d, 4)
        layers = [struct.unpack_from("<Hhh", d, 6 + k * 6) for k in range(count)]
        clips.append({"clut_y_add": clut_y_add, "semi": semi, "layers": layers})
    # tm archive file 0 = a wrapper {u32 pageoff[...], 0} pointing at N RLEN
    # blobs, each a 64hw x 256 4bpp VRAM page (stacked horizontally: frame u
    # 0..255 = page 0, 256..511 = page 1, ...). TM archives can contain empty
    # padding entries (stdglabo uses physical entries 0 and 2 for logical CS
    # subdirs 0 and 1), so pair logical subdirs by non-empty entry order.
    # Read enough sectors for the largest sparse entry's final RLEN page.
    tm_files = [b for b in unpack_archive(_read_lba(raw, _lba_of(exe, tm_idx), 80)) if b]
    tm = tm_files[tm_sub]
    page_offs = []
    k = 0
    while True:
        o = struct.unpack_from("<I", tm, k * 4)[0]
        if o == 0:
            break
        page_offs.append(o)
        k += 1
    atlases, cluts = [], []
    for o in page_offs:
        d = unrlen(tm[o:])
        pos = 8
        while True:
            link, _dest, bw, bh = struct.unpack_from("<IIHH", d, pos)
            data = d[pos + 12 : pos + 12 + bw * bh * 2]
            (cluts if bw == 0x100 else atlases).append(data)
            if link & 0x8000:
                break
            pos += link & 0x7FFF
    return frames, ids, clips, atlases, cluts


def load_pgfgc_pack():
    """PGFGTC00/PGFGTW00 (LBA 1109/1110): fight-HUD sprite directory + one
    64hw×256 4bpp atlas. The W file is not a standard screen-pack tm wrapper
    — unpack_archive yields a 16bpp TIM then an RLEN page (magic at +8).
    Handle 0x04550000; cels 0/1 (HP name plates at (8,15)/(161,15)),
    0xA (face bezel), 0x22 (command row)."""
    raw, exe = _disc_exe()
    cs = _read_lba(raw, _lba_of(exe, 1109), 32)
    tm = _read_lba(raw, _lba_of(exe, 1110), 80)
    nested = unpack_archive(unpack_archive(cs)[0])
    frames = [struct.unpack_from("<7H", nested[0], i * 14)
              for i in range(len(nested[0]) // 14)]
    ids = []
    for b in nested[1]:
        if b == 0xFF:
            break
        ids.append(b)
    clips = []
    for d in nested[2:2 + len(ids)]:
        count, clut_y_add = struct.unpack_from("<HH", d, 0)
        (semi,) = struct.unpack_from("<h", d, 4)
        layers = [struct.unpack_from("<Hhh", d, 6 + k * 6) for k in range(count)]
        clips.append({"clut_y_add": clut_y_add, "semi": semi, "layers": layers})
    page_blob = unpack_archive(tm)[1]
    rlen_at = page_blob.find(b"RLEN")
    d = unrlen(page_blob[rlen_at:])
    pos = 8
    atlases = []
    while True:
        link, _dest, bw, bh = struct.unpack_from("<IIHH", d, pos)
        data = d[pos + 12: pos + 12 + bw * bh * 2]
        if bw != 0x100:
            atlases.append(data)
        if link & 0x8000:
            break
        pos += link & 0x7FFF
    return frames, ids, clips, atlases, []


def cmfont_atlases():
    """The two CMFONTTM.BIN font pages, straight from the disc image (the
    committed pack tree only has LFS pointers / an empty raw blob for them).
    Header {u32 4, u32 off0, u32 off1, 0}; RLEN blob at off+4; decompressed =
    20-byte header + 32768 4bpp pixel bytes (same as the screen-pack atlases).
    Byte-verified against live VRAM in menu-assets-decoded-2026-07-03.md."""
    raw = DISC.read_bytes()
    exe = b"".join(raw[l * 2352 + 24 : l * 2352 + 24 + 2048]
                   for l in range(24, 24 + 0x48000 // 2048))
    table_off = 0x800 + (0x80044F6C - EXE_RAM)
    lba = struct.unpack_from("<I", exe, table_off + LBA_CMFONTTM * 4)[0]
    tm = b"".join(raw[(lba + i) * 2352 + 24 : (lba + i) * 2352 + 24 + 2048]
                  for i in range(22))
    offs = struct.unpack_from("<2I", tm, 4)
    return [unrlen(tm[o + 4 :])[20:] for o in offs]


def load_pack(name: str, sub: int = 0):
    root = COUNTRY if name == "cmfont" else SCREEN
    cs, tm = root / f"{name}cs/{sub}", root / f"{name}tm/{sub}"
    frames_blob = (cs / "0.bin").read_bytes()
    frames = [struct.unpack_from("<7H", frames_blob, i * 14)
              for i in range(len(frames_blob) // 14)]
    ids_blob = (cs / "1.bin").read_bytes()
    n_clips = len(list(cs.glob("*.bin"))) - 2
    ids = []
    for b in ids_blob:
        if b == 0xFF or len(ids) >= n_clips:
            break
        ids.append(b)
    clips = []
    for n in range(n_clips):
        d = (cs / f"{n + 2}.bin").read_bytes()
        count, clut_y_add = struct.unpack_from("<HH", d, 0)
        (semi,) = struct.unpack_from("<h", d, 4)
        layers = [struct.unpack_from("<Hhh", d, 6 + k * 6) for k in range(count)]
        clips.append({"clut_y_add": clut_y_add, "semi": semi, "layers": layers})
    if name == "cmfont":
        atlases, cluts = cmfont_atlases(), []
    else:
        atlases, cluts = [], []
        for f in sorted(tm.glob("*.bin"), key=lambda p: int(p.stem)):
            b = f.read_bytes()
            if len(b) < 4 or b[:4] != b"RLEN":
                continue
            # Decompressed tm file = u32 {0x10, type}, then a block chain:
            # each block {u32 link (bit15 = last, low bits = offset from
            # block start to the next block), u32 dest, u16 w, u16 h, data}.
            # type 2 = one 64hw x 256 4bpp/8bpp pixel page; type 9 (stwmp
            # map files) = a 256 x N 16-bit CLUT block, THEN the pixel page
            # (so pixels start 12 bytes later than the naive [20:] slice —
            # that off-by-12 corrupted the first stwmp map extraction).
            d = unrlen(b)
            pos = 8
            while True:
                link, _dest, bw, bh = struct.unpack_from("<IIHH", d, pos)
                data = d[pos + 12 : pos + 12 + bw * bh * 2]
                (cluts if bw == 0x100 else atlases).append(data)
                if link & 0x8000:
                    break
                pos += link & 0x7FFF
    return frames, ids, clips, atlases, cluts


def cut_frame(frames, atlases, fi: int, clut_y_add: int, cluts=()) -> Image.Image:
    u, v, w, h, cx, cy, fl = frames[fi]
    to_rgba = lambda p: ((p & 31) << 3, ((p >> 5) & 31) << 3,
                         ((p >> 10) & 31) << 3, 0 if p == 0 else 255)
    img = Image.new("RGBA", (w, h))
    put = img.putpixel
    if fl & 1:
        # 8bpp (stwmp map tiles): atlas index = u_px // 128; the 256-color
        # CLUTs come from the pack's type-9 CLUT block (load_pack `cluts`,
        # 256 u16 per row), frame cy 0x100+k -> CLUT row k. The game uploads
        # that block to VRAM (0x140, 0x100) and draws with sp88(0x140,0x100)
        # (ststatus 0x80099894 loader + F0x80098b84 map draw).
        ai, ul = divmod(u, 128)
        k = cy - 0x100 + clut_y_add
        clut = cluts[0]
        rgba = [to_rgba(struct.unpack_from("<H", clut, (k * 256 + i) * 2)[0])
                for i in range(256)]
        for yy in range(h):
            for xx in range(w):
                t = ul + xx
                half = hw(atlases[ai], t // 2, v + yy)
                put((xx, yy), rgba[(half >> ((t % 2) * 8)) & 0xFF])
        return img
    ai, ul = divmod(u, 256)
    cy = (cy + clut_y_add) & 0xFF
    if ai >= len(atlases):
        return img  # frame lives on an atlas page this pack didn't ship
    rgba = [to_rgba(hw(atlases[0], cx + i, cy)) for i in range(16)]
    for yy in range(h):
        for xx in range(w):
            t = ul + xx
            half = hw(atlases[ai], t // 4, v + yy)
            put((xx, yy), rgba[(half >> ((t % 4) * 4)) & 0xF])
    return img


def clip_visible_stp(frames, atlases, clip, cluts, k=0) -> bool:
    """True when any VISIBLE texel of the clip carries the palette STP bit
    (bit 15 of its CLUT entry).

    The PS1 blends a textured primitive per texel: a primitive whose
    semi-transparency flag is set only blends the texels whose palette entry has
    STP set, so the pack record's `semi` field alone is not the blend decision.
    Measured 2026-09-16: carddata2 clips 25/26 carry semi=0 (an ABR mode) but
    every visible texel has STP=0 and only the invisible index-0 texels have
    STP=1, and the console reference draws both plates opaque. Conversely the
    genuinely blended clips (carddata3 semi=1/2) have STP set on their visible
    texels. The boolean is exact when a clip's visible texels agree, which is
    the case for every semi=0 clip in the shipped packs; a clip with visible
    texels on both sides still blends as a whole (the per-texel mask is a
    later refinement).
    """
    for fi, _dx, _dy in clip["layers"]:
        u, v, w, h, cx, cy, fl = frames[fi]
        if fl & 1:
            ai, ul = divmod(u, 128)
            kk = cy - 0x100 + clip["clut_y_add"] + k
            words = [struct.unpack_from("<H", cluts[0], (kk * 256 + i) * 2)[0]
                     for i in range(256)]
            for yy in range(h):
                for xx in range(w):
                    t = ul + xx
                    half = hw(atlases[ai], t // 2, v + yy)
                    idx = (half >> ((t % 2) * 8)) & 0xFF
                    if idx != 0 and (words[idx] & 0x8000):
                        return True
            continue
        ai, ul = divmod(u, 256)
        if ai >= len(atlases):
            continue
        cyy = (cy + clip["clut_y_add"] + k) & 0xFF
        words = [hw(atlases[0], cx + i, cyy) for i in range(16)]
        for yy in range(h):
            for xx in range(w):
                t = ul + xx
                half = hw(atlases[ai], t // 4, v + yy)
                idx = (half >> ((t % 4) * 4)) & 0xF
                if idx != 0 and (words[idx] & 0x8000):
                    return True
    return False


def build_sheet(frames, ids, clips, atlases, cycles=None, cluts=()):
    """Cut every referenced (frame, clut_y_add) once; shelf-pack into a sheet.
    `cycles` maps clip id -> n CLUT-cycle variants (extra ids "<id>#<k>")."""
    cycles = cycles or {}
    id_to_clip = dict(zip(ids, clips))
    cuts = {}
    want = [(clip, 0) for clip in clips]
    want += [(id_to_clip[sid], k) for sid, n in cycles.items()
             for k in range(1, n) if sid in id_to_clip]
    for clip, k in want:
        for fi, _, _ in clip["layers"]:
            key = (fi, clip["clut_y_add"] + k)
            if key not in cuts:
                cuts[key] = cut_frame(frames, atlases, fi,
                                      clip["clut_y_add"] + k, cluts)
    keys = sorted(cuts, key=lambda k: -cuts[k].height)
    SHEET_W = 256
    x = y = shelf_h = 0
    pos = {}
    for k in keys:
        im = cuts[k]
        if x + im.width > SHEET_W:
            x, y, shelf_h = 0, y + shelf_h, 0
        pos[k] = (x, y)
        x += im.width
        shelf_h = max(shelf_h, im.height)
    sheet = Image.new("RGBA", (SHEET_W, y + shelf_h))
    for k, (px, py) in pos.items():
        sheet.paste(cuts[k], (px, py))
    manifest = {}

    def emit(key, clip, k):
        layers = []
        for fi, dx, dy in clip["layers"]:
            px, py = pos[(fi, clip["clut_y_add"] + k)]
            im = cuts[(fi, clip["clut_y_add"] + k)]
            layers.append({"frame": fi, "x": px, "y": py, "w": im.width,
                           "h": im.height, "dx": dx, "dy": dy})
        manifest[key] = {"semi": clip["semi"],
                         "stp": clip_visible_stp(frames, atlases, clip, cluts, k),
                         "layers": layers}

    for sid, clip in zip(ids, clips):
        emit(str(sid), clip, 0)
    for sid, n in (cycles or {}).items():
        if sid in id_to_clip:
            for k in range(1, n):
                emit(f"{sid}#{k}", id_to_clip[sid], k)
    return sheet, manifest


# Disc-only packs the ddw3 splat left unextracted: (name, cs_idx, tm_idx, sub).
# stdglabo (the DRI Digimon-Lab overlay, handles cs=0x2c5 / tm=0x2c6) — its cs
# archive has 2 subdirs (0 = the lab chrome + digivolve-chart portraits, ids
# 0..68; 1 = the digivolve sub-screen art), and its tm packs 3 stacked 256x256
# 4bpp VRAM pages per subdir (frame u 0..255 = page 0, 256..511 = page 1, ...).
DISC_PACKS = (
    ("stdglabo", 0x2c5, 0x2c6, 0),
    # F0x8008365c requests handle 0x02c50001 for chart node portraits.
    ("stdglabo_portraits", 0x2c5, 0x2c6, 1),
    # stgtrain (gym training UI, LBA_STTRNGCS/TM idx 0x28c/0x28d): pack handle
    # low u16 = physical cs slot (0x028c0000 -> cs slot 0, 0x028c0003 -> cs
    # slot 3; slots 1/2 are empty padding). Both cs subdirs share the SAME
    # (single, non-empty) tm entry, unlike stdglabo's per-subdir tm files —
    # hence the explicit tm_sub=0 override. Confirmed via stgtrain.s draw fns
    # F0x80084838/86c0c/88348/8008a524 (sp84(0x240,0x100) + handle 0x028c0003
    # for the bulk of the chrome; a separate F0x80088348 call site references
    # 0x028c0000 for a second widget). See docs/research/ui/
    # stgtrain-decoded-2026-07-11.md.
    ("sttrng0", 0x28c, 0x28d, 0, 0),
    ("sttrng3", 0x28c, 0x28d, 3, 0),
    # stgmcard (the MEMORY CARD save/load screen -- NOT the card-battle game;
    # see docs/research/ui/stgmcard-decoded-2026-08-05.md). Pack handles
    # 0x029d0000 / 0x029e0000 = LBA_STMCRDCS/TM_BIN_IDX 669/670 in
    # ~/ddw3/rust/dw2003_exe_data/src/lba.rs, resolved through the standard
    # 0x80044B38->unk424(handle) getter at stgmcard.s L0x00000e2c and
    # L0x00004fac. The disc ships them at AAA/DAT/MCARD/STMCRD{CS,TM}.BIN;
    # the ddw3 splat leaves them unextracted, hence DISC_PACKS.
    ("stmcrd", 0x29d, 0x29e, 0),
    # stnmet (registration wizard window: pack-select frame, A/B/C tabs,
    # row plates). Handle 0x028A0000 / 0x028B0000 = LBA_STNMETCS/TM 650/651.
    # The splat under pack/dw2003/nameent/stnmettm is empty (pointer at
    # /build/...). stplnmet F0x80087444 draws clips 7, 8, 0x32 at (16,44).
    ("stnmet", 0x28A, 0x28B, 0),
    # stdgnm (name-entry overlay's own cs/tm). Handle 0x02880000 / 0x02890000
    # = LBA_STDGNMCS/TM 648/649. The splat tm slot is empty; the NAMEDT pack
    # already covers the wizard keyboard chrome. This is the overlay-owned
    # cell-border atlas stdgname_ui.json flags as unextracted.
    ("stdgnm", 0x288, 0x289, 0),
)

# Packs that ship their texture pages and their sprite directories inside ONE
# archive instead of the usual cs/tm LBA pair: (name, lba_idx, page_slot,
# cs_slot, nsec). The pack handle's low u16 is the PHYSICAL top-level slot, the
# same rule sttrng follows, so `cs_slot` is exactly the number the code ors in.
#
# carddata (LBA_CARDDATA_BIN_IDX 605 = handle hi-word 0x25d) is the CARD DUEL
# screen's pack -- the duel engine pro/cardgame.s requests only slots 2 and 3
# (`lui $a0, 0x25d` + `ori $a0, 0x2` / `0x3`, 20 and 23 call sites), and loads
# slots 0 and 1 as textures through the same `0x80044B38->unk424` getter at
# cardgame.s L19464/L19474. Its four slots are:
#   0,1 = archive{RLEN -> 16bpp TIM, 64hw x 256} = the two VRAM texture pages
#   2   = sprite directory, 82 frames / 65 clips -- the CARD sprites (six
#         class-coloured 40x46 card frames, 16x16 board chips, the X'd back)
#   3   = sprite directory, 58 frames / 70 clips -- the BOARD chrome (the
#         30-tile 64x64 backdrop id 0, windows, the digit strip, the yellow /
#         blue attack effects, the deck-pile stacks ids 60-68)
# Slot 2 pairs with page 0 and slot 3 with page 1, in order. Both directories'
# frame u values are < 256, so u//256 cannot pick the page: the pairing is
# established by exclusion -- rendering either directory against the other page
# produces incoherent colour noise, and each directory's CLUT rows (slot 2 uses
# cy 156..167 at cx 48; slot 3 uses cy 241..251 at cx 0/16/32/48) only carry
# palette data on its own page. See docs/research/card/.
BUNDLED_PACKS = (
    ("carddata2", 0x25d, 0, 2, 96),
    ("carddata3", 0x25d, 1, 3, 96),
)

# Packs the splat leaves as ONE directory holding both halves as numbered
# subdirs, instead of the usual sibling `<name>cs/<name>tm` pair.
#   end__all (LBA_END__ALL_BIN_IDX 2214, handle 0x08A60000) is the game's END
#   card: four 128x40 images stacked in one 4bpp page, drawn centred at
#   (96, 100). stdwtitl's F0x8008453c picks which by language. See
#   docs/research/ui/end-screen-decoded-2026-08-14.md.
#   tlogousa: the title screen. Sub 0 is the cs half -- eleven clips covering
#   the DIGIMON logo, the DIGIMON WORLD wordmark, the numeral 3 and its glow,
#   the selection box, and the three words "Press Start Button" / "Start" /
#   "Continue". Sub 1 is the texture half that tools/decode_title_art.py has
#   been reading all along without the metadata that carves it up. The overlay
#   keeps this half's handle at 0x80088234 and draws from it in F0x800850c8,
#   F0x80084c3c, F0x8008426c and F0x800852f0. See
#   docs/research/ui/stdwtitl-title-menu-2026-08-14.md.
SPLIT_PACKS = (
    ("endall", "end__all", 0, 1),
    ("tlogojpn", "tlogojpn", 0, 1),
    ("tlogousa", "tlogousa", 0, 1),
    # tlogopal (LBA_TLOGOPAL_BIN_IDX 2381, handle 0x094D0000): the region table at
    # D0x8008824c maps language indices 2..6 to it, so an ENG-language boot
    # (D0x8005CCA8 = 2) selects this logo, not tlogousa.
    ("tlogopal", "tlogopal", 0, 1),
)

# cntselwn lives under pack/dw2003/country (archive 0x21), numbered 0=cs / 1=tm,
# the same split shape as endall. 14 rlen tiles; the language-select overlay
# draws five panes from it (cnty_sel-full-decode-2026-08-05.md).
COUNTRY_SPLIT_PACKS = (
    ("cntselwn", "cntselwn", 0, 1),
)

# Packs whose disc file is ONE archive with two entries [cs_archive, tm_archive]
# instead of the local splat's <name>/0 and <name>/1 directories. The language
# select's tm half is empty in this checkout's splat, so read the disc directly:
# cntselwn = LBA index 2211, archive entries 0=cs (23 frames / 12 clips, ids
# 0..11) and 1=tm (one RLEN 64hw x 256 4bpp page). The overlay draws ids 0..3.
DISC_SPLIT_PACKS = (
    ("cntselwn", 2211),
)

# A bundle whose archive holds several sprite sub-directories AND several texture
# sub-directories, each pair named by its own archive entry: (sheet name, lba
# index, cs entry, tm entry). ttcommpk (2183) tiles its 320x240 startup screen
# from dirs 0/1/2 with texture pages 4/5/6 (docs/research/ui/
# stdwtitl-decoded-2026-07-11.md; tools/extract_stdwtitl_ui.py).
BUNDLE_SUB_PACKS = (
    ("ttcommpk0", 2183, 0, 4),
    ("ttcommpk1", 2183, 1, 5),
    ("ttcommpk2", 2183, 2, 6),
    # Sub 3 (98 clips) is the title screen's sparkle/decoration directory and sub
    # 8 (46 clips) the second one; both are drawn from the SAME 4bpp page, sub 7
    # (sub 9 is byte-identical). F0x80086DF8 uploads sub 7 to VRAM (0x3C0, 0) and
    # the draw routine F0x80086228 draws 0x08870003 / 0x08870008 against that
    # origin; the frames' palette row (cy=255) is baked into the page itself, so
    # cut_frame's 4bpp path reads it with no CLUT block. Research answer
    # ttcommpk-sub3-atlas (accepted 2026-09-22).
    ("ttcommpk3", 2183, 3, 7),
    ("ttcommpk8", 2183, 8, 9),
)


def load_split_pack(src: str, cs_sub: int, tm_sub: int, root=None):
    """A splat pack whose cs and tm halves are numbered subdirs of one
    directory. Same 5-tuple as load_pack."""
    root = (root or SCREEN) / src
    cs, tm = root / str(cs_sub), root / str(tm_sub)
    frames_blob = (cs / "0.bin").read_bytes()
    frames = [struct.unpack_from("<7H", frames_blob, i * 14)
              for i in range(len(frames_blob) // 14)]
    n_clips = len(list(cs.glob("*.bin"))) - 2
    ids = []
    for b in (cs / "1.bin").read_bytes():
        if b == 0xFF or len(ids) >= n_clips:
            break
        ids.append(b)
    clips = []
    for n in range(n_clips):
        d = (cs / f"{n + 2}.bin").read_bytes()
        count, clut_y_add = struct.unpack_from("<HH", d, 0)
        (semi,) = struct.unpack_from("<h", d, 4)
        layers = [struct.unpack_from("<Hhh", d, 6 + k * 6) for k in range(count)]
        clips.append({"clut_y_add": clut_y_add, "semi": semi, "layers": layers})
    atlases, cluts = [], []
    for f in sorted(tm.glob("*.bin"), key=lambda p: int(p.stem)):
        b = f.read_bytes()
        if len(b) < 4 or b[:4] != b"RLEN":
            continue
        d = unrlen(b)
        pos = 8
        while True:
            link, _dest, bw, bh = struct.unpack_from("<IIHH", d, pos)
            data = d[pos + 12: pos + 12 + bw * bh * 2]
            (cluts if bw == 0x100 else atlases).append(data)
            if link & 0x8000:
                break
            pos += link & 0x7FFF
    return frames, ids, clips, atlases, cluts


def load_disc_split_pack(lba_idx: int):
    """A split pack read from its disc archive (see DISC_SPLIT_PACKS): outer =
    [cs_archive, tm_archive], each unpacked once more into [frames, ids,
    clips...] / [RLEN pages]. Same 5-tuple as load_split_pack; the tm parse
    mirrors it exactly so the sheets stay byte-compatible."""
    raw, exe = _disc_exe()
    outer = unpack_archive(_read_lba(raw, _lba_of(exe, lba_idx), 24))
    cs = unpack_archive(outer[0])
    frames = [struct.unpack_from("<7H", cs[0], i * 14)
              for i in range(len(cs[0]) // 14)]
    n_clips = len(cs) - 2
    ids = []
    for b in cs[1]:
        if b == 0xFF or len(ids) >= n_clips:
            break
        ids.append(b)
    clips = []
    for d in cs[2:2 + len(ids)]:
        count, clut_y_add = struct.unpack_from("<HH", d, 0)
        (semi,) = struct.unpack_from("<h", d, 4)
        layers = [struct.unpack_from("<Hhh", d, 6 + k * 6) for k in range(count)]
        clips.append({"clut_y_add": clut_y_add, "semi": semi, "layers": layers})
    atlases, cluts = [], []
    for f in [b for b in unpack_archive(outer[1]) if len(b) >= 4 and b[:4] == b"RLEN"]:
        d = unrlen(f)
        pos = 8
        while True:
            link, _dest, bw, bh = struct.unpack_from("<IIHH", d, pos)
            data = d[pos + 12: pos + 12 + bw * bh * 2]
            (cluts if bw == 0x100 else atlases).append(data)
            if link & 0x8000:
                break
            pos += link & 0x7FFF
    return frames, ids, clips, atlases, cluts


def load_disc_bundle_sub(lba_idx: int, cs_entry: int, tm_entry: int):
    """One sprite sub-directory + its paired texture page from a bundle archive
    (see BUNDLE_SUB_PACKS). Same 5-tuple as load_disc_split_pack."""
    raw, exe = _disc_exe()
    outer = unpack_archive(_read_lba(raw, _lba_of(exe, lba_idx), 80))
    cs = unpack_archive(outer[cs_entry])
    frames = [struct.unpack_from("<7H", cs[0], i * 14)
              for i in range(len(cs[0]) // 14)]
    n_clips = len(cs) - 2
    ids = []
    for b in cs[1]:
        if b == 0xFF or len(ids) >= n_clips:
            break
        ids.append(b)
    clips = []
    for d in cs[2:2 + len(ids)]:
        count, clut_y_add = struct.unpack_from("<HH", d, 0)
        (semi,) = struct.unpack_from("<h", d, 4)
        layers = [struct.unpack_from("<Hhh", d, 6 + k * 6) for k in range(count)]
        clips.append({"clut_y_add": clut_y_add, "semi": semi, "layers": layers})
    atlases, cluts = [], []
    for f in [b for b in unpack_archive(outer[tm_entry]) if len(b) >= 4 and b[:4] == b"RLEN"]:
        d = unrlen(f)
        pos = 8
        while True:
            link, _dest, bw, bh = struct.unpack_from("<IIHH", d, pos)
            data = d[pos + 12: pos + 12 + bw * bh * 2]
            (cluts if bw == 0x100 else atlases).append(data)
            if link & 0x8000:
                break
            pos += link & 0x7FFF
    return frames, ids, clips, atlases, cluts


def load_bundled_pack(lba_idx: int, page_slot: int, cs_slot: int, nsec: int):
    """Load a screen pack whose texture pages and sprite directories share one
    archive. Returns the same 5-tuple as load_pack."""
    raw, exe = _disc_exe()
    top = unpack_archive(_read_lba(raw, _lba_of(exe, lba_idx), nsec))
    # page slot = archive{RLEN blob, ...}; RLEN -> 16bpp TIM whose 20-byte
    # header (8 magic/flags + 12 block {len, dx, dy, w=0x40, h=0x100}) is
    # followed by the raw 64hw x 256 VRAM page, byte-identical to a tm block.
    page = unrlen(unpack_archive(top[page_slot])[0])[20 : 20 + 64 * 256 * 2]
    subdir = unpack_archive(top[cs_slot])
    frames = [struct.unpack_from("<7H", subdir[0], i * 14)
              for i in range(len(subdir[0]) // 14)]
    ids = []
    for b in subdir[1]:
        if b == 0xFF:
            break
        ids.append(b)
    clips = []
    for d in subdir[2:2 + len(ids)]:
        count, clut_y_add = struct.unpack_from("<HH", d, 0)
        (semi,) = struct.unpack_from("<h", d, 4)
        layers = [struct.unpack_from("<Hhh", d, 6 + k * 6) for k in range(count)]
        clips.append({"clut_y_add": clut_y_add, "semi": semi, "layers": layers})
    return frames, ids, clips, [page], []


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for entry in PACKS:
        name, src, sub = entry if isinstance(entry, tuple) else (entry, entry, 0)
        frames, ids, clips, atlases, cluts = load_pack(src, sub)
        sheet, manifest = build_sheet(frames, ids, clips, atlases,
                                      CLUT_CYCLES.get(name), cluts)
        if name == "ststat":
            manifest = {"portraits": STSTAT_PORTRAITS, "backdrop": 29, "ids": manifest}
        sheet.save(OUT_DIR / f"{name}_sheet.png")
        (OUT_DIR / f"{name}_sheet.json").write_text(json.dumps(manifest, indent=1))
        print(f"{name}: {len(ids)} ids / {len(frames)} frames / "
              f"{len(atlases)} atlases -> {name}_sheet.png")
    for entry in DISC_PACKS:
        name, cs_idx, tm_idx, sub = entry[:4]
        tm_sub = entry[4] if len(entry) > 4 else None
        frames, ids, clips, atlases, cluts = load_disc_pack(cs_idx, tm_idx, sub, tm_sub)
        sheet, manifest = build_sheet(frames, ids, clips, atlases,
                                      CLUT_CYCLES.get(name), cluts)
        sheet.save(OUT_DIR / f"{name}_sheet.png")
        (OUT_DIR / f"{name}_sheet.json").write_text(json.dumps(manifest, indent=1))
        print(f"{name}: {len(ids)} ids / {len(frames)} frames / "
              f"{len(atlases)} atlases -> {name}_sheet.png")
    for name, src, cs_sub, tm_sub in SPLIT_PACKS:
        frames, ids, clips, atlases, cluts = load_split_pack(src, cs_sub, tm_sub)
        sheet, manifest = build_sheet(frames, ids, clips, atlases,
                                      CLUT_CYCLES.get(name), cluts)
        sheet.save(OUT_DIR / f"{name}_sheet.png")
        (OUT_DIR / f"{name}_sheet.json").write_text(json.dumps(manifest, indent=1))
        print(f"{name}: {len(ids)} ids / {len(frames)} frames / "
              f"{len(atlases)} atlases -> {name}_sheet.png")
    for name, src, cs_sub, tm_sub in COUNTRY_SPLIT_PACKS:
        root = COUNTRY / src
        tm0 = root / str(tm_sub)
        bins = list(tm0.glob("*.bin"))
        # country/cntselwn in this checkout is git-lfs pointers plus an empty
        # tm half; skip rather than fail the rest of the pack build.
        if not bins or any(p.stat().st_size < 16 for p in bins):
            print(f"{name}: skipped (no unpacked tm under {tm0})")
            continue
        frames, ids, clips, atlases, cluts = load_split_pack(
            src, cs_sub, tm_sub, COUNTRY)
        sheet, manifest = build_sheet(frames, ids, clips, atlases,
                                      CLUT_CYCLES.get(name), cluts)
        sheet.save(OUT_DIR / f"{name}_sheet.png")
        (OUT_DIR / f"{name}_sheet.json").write_text(json.dumps(manifest, indent=1))
        print(f"{name}: {len(ids)} ids / {len(frames)} frames / "
              f"{len(atlases)} atlases -> {name}_sheet.png")
    for name, lba_idx in DISC_SPLIT_PACKS:
        frames, ids, clips, atlases, cluts = load_disc_split_pack(lba_idx)
        sheet, manifest = build_sheet(frames, ids, clips, atlases,
                                      CLUT_CYCLES.get(name), cluts)
        sheet.save(OUT_DIR / f"{name}_sheet.png")
        (OUT_DIR / f"{name}_sheet.json").write_text(json.dumps(manifest, indent=1))
        print(f"{name}: {len(ids)} ids / {len(frames)} frames / "
              f"{len(atlases)} atlases -> {name}_sheet.png")
    for name, lba_idx, cs_entry, tm_entry in BUNDLE_SUB_PACKS:
        frames, ids, clips, atlases, cluts = load_disc_bundle_sub(lba_idx, cs_entry, tm_entry)
        sheet, manifest = build_sheet(frames, ids, clips, atlases,
                                      CLUT_CYCLES.get(name), cluts)
        sheet.save(OUT_DIR / f"{name}_sheet.png")
        (OUT_DIR / f"{name}_sheet.json").write_text(json.dumps(manifest, indent=1))
        print(f"{name}: {len(ids)} ids / {len(frames)} frames / "
              f"{len(atlases)} atlases -> {name}_sheet.png")
    for name, lba_idx, page_slot, cs_slot, nsec in BUNDLED_PACKS:
        frames, ids, clips, atlases, cluts = load_bundled_pack(
            lba_idx, page_slot, cs_slot, nsec)
        sheet, manifest = build_sheet(frames, ids, clips, atlases,
                                      CLUT_CYCLES.get(name), cluts)
        sheet.save(OUT_DIR / f"{name}_sheet.png")
        (OUT_DIR / f"{name}_sheet.json").write_text(json.dumps(manifest, indent=1))
        print(f"{name}: {len(ids)} ids / {len(frames)} frames / "
              f"{len(atlases)} atlases -> {name}_sheet.png")
    frames, ids, clips, atlases, cluts = load_pgfgc_pack()
    sheet, manifest = build_sheet(frames, ids, clips, atlases,
                                  CLUT_CYCLES.get("pgfgc00"), cluts)
    sheet.save(OUT_DIR / "pgfgc00_sheet.png")
    (OUT_DIR / "pgfgc00_sheet.json").write_text(json.dumps(manifest, indent=1))
    print(f"pgfgc00: {len(ids)} ids / {len(frames)} frames / "
          f"{len(atlases)} atlases -> pgfgc00_sheet.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
