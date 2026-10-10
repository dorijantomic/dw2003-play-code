#!/usr/bin/env python3
"""Extract the FIELDCOM.BIN field-UI sprite directories to walker assets.

FIELDCOM.BIN (disc LBA idx 352) holds the shared field icons: talk balloon,
"!" indicator, ladder/door glyphs, selection rings, sparkles, etc. Format and
draw math decoded in docs/research/ui/fieldcom-sprite-directory-decoded-2026-07-02.md:

  header: 4 u32 sub-entry offsets
    sub 0: sprite directory A (108 ids)   -> pixels/CLUTs in sub 2
    sub 1: sprite directory B (83 ids)    -> pixels/CLUTs in sub 3
    sub 2/3: RLEN-compressed 4bpp atlases (256x256 texels, CLUTs in bottom rows)

  directory: { u32 frames_off; u32 ids_off; u32 clip_off[n_ids] }
    ids:   byte table, 0xff-terminated
    clip:  u16 layer_count; u16 clut_y_add; s16 semi; layer_count x
           { u16 frame_idx; s16 dx; s16 dy }   (layers composited back-to-front)
    frame: 14B { u16 u,v,w,h, clut_x_off, clut_y_off, flags(bit0: 0=4bpp,1=8bpp) }

Output: web/assets/ui/fieldcom0.png / fieldcom1.png (opaque frame sheets, RGBA),
fieldcom0_semi.png / fieldcom1_semi.png (the STP/blended texels of the same
frames, same layout) +
web/assets/ui/fieldcom.json (per-id clips with sheet rects + layer offsets).
"""

import os
import json
import struct
import sys
from pathlib import Path

from PIL import Image

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
FIELDCOM = DDW3 / "dw2003/AAA/DAT/FIELD/FIELDCOM.BIN"
DISC = Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin")
REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "web/assets/ui"

# FIELDSTG.PRO holds the indicator glyph-program table (FIELDSTG overlay base
# 0x80082cb0, table at RAM 0x800975c0 -> flat file offset 0x14910). Rows are
# 9 bytes of {sprite_id, delay_frames} pairs, 0xff-terminated. Row index =
# indicator "kind", selected by the trigger dispatcher (fieldstg.s 0x5840):
#   act 1 (door)    -> kind = record.dir >> 1 + 6  (dir 4 -> kind 10)
#   act 2/3 (ladder)-> kind 2      act 4 -> kind 4
#   act 5/6 (zone)  -> kind 0 ("!") act 7 -> kind 5
LBA_FIELDSTG = 358  # LBA table index (rust/dw2003_exe_data/src/lba.rs)
GLYPH_TABLE_OFF = 0x800975C0 - 0x80082CB0
N_PROGRAMS = 11

# --- field character drop shadow -------------------------------------------
# FIELDSTG.PRO also carries the baked VRAM texture-slot descriptor table at RAM
# 0x80097d0c (scene_struct+0x28). Slot 0 is the drop-shadow texture the actor
# renderer F0x8008f52c hands to its SPRT (see
# docs/research/field/character-drop-shadow-decoded-2026-07-27.md). Descriptor
# is 0x10 bytes: {s16 tpage_x, s16 tpage_y, u16 vram_x, u16 vram_y,
# u16 u, u16 v, u16 clut_x, u16 clut_y}, all in VRAM halfword coords except
# u/v which the SPRT reads as the low byte (texel offset inside the tpage).
# The 32x16 size is immediate in the draw code (sh 0x20/0x10 at 0x8008f920).
# Every wstagNNN overlay ships a byte-identical copy of this table, so the
# shadow texture is global, not per stage.
SHADOW_SLOT_OFF = 0x80097D0C - 0x80082CB0
SHADOW_W, SHADOW_H = 32, 16
# FIELDCOM sub-entry 2 is resident at VRAM halfword (512, 256), sub-entry 3 at
# (576, 256) — VRAM-verified, see docs/research/ui/fieldcom-sprite-directory-
# decoded-2026-07-02.md. tpage origin therefore selects the atlas.
ATLAS_VRAM_ORIGIN = {(512, 256): 0, (576, 256): 1}


def read_disc_file(lba_idx: int, n_sectors: int) -> bytes:
    """Read a file from the raw disc image via the EXE's LBA table."""
    raw = DISC.read_bytes()

    def sector(l: int) -> bytes:  # 2352-byte raw sectors, data at +24
        return raw[l * 2352 + 24 : l * 2352 + 24 + 2048]

    # LBA offsets table lives in the EXE (RAM 0x80044f6c; SLES_039.36 at LBA 24,
    # t_addr 0x80010000, header 0x800).
    exe = b"".join(sector(24 + i) for i in range(0, 0x36000 // 2048 + 2))
    table_off = 0x800 + (0x80044F6C - 0x80010000)
    lba = struct.unpack_from("<I", exe, table_off + lba_idx * 4)[0]
    return b"".join(sector(lba + i) for i in range(n_sectors))


_FIELDSTG: bytes | None = None


def fieldstg_image() -> bytes:
    """FIELDSTG.PRO, enough sectors to cover every table this script reads."""
    global _FIELDSTG
    if _FIELDSTG is None:
        need = max(GLYPH_TABLE_OFF + N_PROGRAMS * 9, SHADOW_SLOT_OFF + 0x10)
        _FIELDSTG = read_disc_file(LBA_FIELDSTG, need // 2048 + 1)
    return _FIELDSTG


def parse_glyph_programs() -> list:
    """The 11 indicator glyph animation programs from FIELDSTG.PRO."""
    d = fieldstg_image()
    programs = []
    for row in range(N_PROGRAMS):
        b = d[GLYPH_TABLE_OFF + row * 9 : GLYPH_TABLE_OFF + (row + 1) * 9]
        steps = []
        for k in range(0, 9, 2):
            if b[k] == 0xFF:
                break
            steps.append({"id": b[k], "delay": b[k + 1]})
        programs.append(steps)
    return programs


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


def parse_directory(d: bytes) -> dict:
    """Parse a sprite directory blob -> {id: clip}."""
    frames_off, ids_off = struct.unpack_from("<II", d, 0)
    # id table is 0xff-terminated but may carry alignment junk before the
    # terminator; the clip-offset table between +8 and frames_off bounds the
    # true count (dir0: 100 ids exactly, dir1: 83 exactly).
    max_ids = (frames_off - 8) // 4
    ids = []
    a = ids_off
    while d[a] != 0xFF and len(ids) < max_ids:
        ids.append(d[a])
        a += 1
    entries = {}
    for n, sid in enumerate(ids):
        clip_off = struct.unpack_from("<I", d, 8 + n * 4)[0]
        count, clut_y_add = struct.unpack_from("<HH", d, clip_off)
        (semi,) = struct.unpack_from("<h", d, clip_off + 4)
        layers = []
        for k in range(count):
            fi, dx, dy = struct.unpack_from("<Hhh", d, clip_off + 6 + k * 6)
            u, v, w, h, cx, cy, flags = struct.unpack_from("<7H", d, frames_off + fi * 14)
            layers.append(
                {"frame": fi, "dx": dx, "dy": dy, "u": u, "v": v, "w": w, "h": h,
                 "clut_x": cx, "clut_y": cy, "flags": flags}
            )
        entries[sid] = {"clut_y_add": clut_y_add, "semi": semi, "layers": layers}
    return entries


def atlas_hw(atlas: bytes, x: int, y: int) -> int:
    return struct.unpack_from("<H", atlas, (y * 64 + x) * 2)[0]


def cut_drop_shadow(atlases: list) -> tuple:
    """The field character drop-shadow texture, from FIELDSTG texture slot 0.

    Reads the baked descriptor, resolves which resident FIELDCOM atlas the
    tpage origin names, and cuts the 32x16 4bpp rect with its 16-entry CLUT.
    Returns (Image, meta dict). Every step is asserted against the descriptor
    so a wrong table would fail loudly rather than emit a plausible blob.
    """
    d = fieldstg_image()
    tp_x, tp_y, vram_x, vram_y, u, v, clut_x, clut_y = struct.unpack_from(
        "<hhHHHHHH", d, SHADOW_SLOT_OFF
    )
    ai = ATLAS_VRAM_ORIGIN[(tp_x, tp_y)]
    atlas = atlases[ai]
    u &= 0xFF  # the SPRT reads u/v as bytes (lbu 8/0xa)
    v &= 0xFF
    # u/v must be the texel offset of the texture's VRAM corner inside the page
    assert u == (vram_x - tp_x) * 4, (u, vram_x, tp_x)
    assert v == vram_y - tp_y, (v, vram_y, tp_y)
    cx, cy = clut_x - tp_x, clut_y - tp_y  # atlas-local CLUT halfword coords
    pal = [atlas_hw(atlas, cx + i, cy) for i in range(16)]
    rgba = [((p & 31) << 3, ((p >> 5) & 31) << 3, ((p >> 10) & 31) << 3,
             0 if p == 0 else 255) for p in pal]
    img = Image.new("RGBA", (SHADOW_W, SHADOW_H))
    used = set()
    for yy in range(SHADOW_H):
        for xx in range(SHADOW_W):
            t = u + xx
            half = atlas_hw(atlas, t // 4, v + yy)
            idx = (half >> ((t % 4) * 4)) & 0xF
            used.add(idx)
            img.putpixel((xx, yy), rgba[idx])
    # The five authority-1 s415 reference frames show every shadow pixel at
    # exactly RGB(0x30,0x30,0x38) = 15-bit halfword 0x1cc6 over a patterned
    # floor. The texture must be a single opaque index on transparent index 0.
    assert used == {0, 1}, sorted(used)
    assert pal[0] == 0x0000 and pal[1] & 0x7FFF == 0x1CC6, [hex(p) for p in pal[:2]]
    meta = {
        "atlas": ai, "u": u, "v": v, "w": SHADOW_W, "h": SHADOW_H,
        "clut_x": clut_x, "clut_y": clut_y,
        "color": "#%02x%02x%02x" % rgba[1][:3],
    }
    return img, meta


def cut_frame(atlas: bytes, lay: dict, clut_y_add: int, abe: bool) -> tuple:
    """Decode one frame from a 64hw x 256 4bpp atlas using its embedded CLUT.

    The draw context puts both the texture origin and the CLUT base at the
    atlas's own VRAM corner, so frame u/v and clut_x/clut_y(-256) are directly
    atlas-local (VRAM-verified byte-exact on the s200 savestate).

    Returns (opaque, semi): the GPU splits a textured primitive by the CLUT
    entry's STP bit (0x8000) whenever the primitive has ABE=1, i.e. whenever the
    clip's `semi` field is not -1. STP texels go through the tpage's blend
    equation; every other texel is written straight. So each frame is cut twice
    into the same rect — once with only the plain texels, once with only the
    blended ones — and the renderer draws the two layers with the two different
    canvas composite modes. With ABE=0 the STP bit is ignored by the hardware
    and `semi` is empty.
    """
    if lay["flags"] & 1:
        raise NotImplementedError("8bpp FIELDCOM frame (none exist in this file)")
    cy = (lay["clut_y"] + clut_y_add) & 0xFF  # base 256 + off, atlas-local row
    pal = [atlas_hw(atlas, 0, cy) if False else
           struct.unpack_from("<H", atlas, (cy * 64) * 2 + (lay["clut_x"] + i) * 2)[0]
           for i in range(16)]
    rgba = [((p & 31) << 3, ((p >> 5) & 31) << 3, ((p >> 10) & 31) << 3,
             0 if p == 0 else 255) for p in pal]
    # Index 0 with STP clear is the one always-transparent texel; index 0 with
    # STP set is a legal fully-black blended texel, but no FIELDCOM CLUT uses it.
    stp = [abe and bool(p & 0x8000) for p in pal]
    img = Image.new("RGBA", (lay["w"], lay["h"]))
    semi = Image.new("RGBA", (lay["w"], lay["h"]))
    put, put_s = img.putpixel, semi.putpixel
    for yy in range(lay["h"]):
        for xx in range(lay["w"]):
            t = lay["u"] + xx
            half = atlas_hw(atlas, t // 4, lay["v"] + yy)
            idx = (half >> ((t % 4) * 4)) & 0xF
            (put_s if stp[idx] else put)((xx, yy), rgba[idx])
    return img, semi


# CLUT-cycle variants. The draw context's `sp98` slot ADDS a row to every
# frame's CLUT row for the rest of the draw (shop chrome doc §3d, "CLUT-cycle
# row add"), and a few actors drive it from a frame counter instead of leaving
# it at zero. The tree-kick radar card is one: its rings are concentric bands of
# one 16-entry palette, and F0x8008c6b8 (fieldstg file 0x9b40) feeds it
# `(timer / rate) % 10`, so the rings appear to pulse outward. Cutting those ten
# rows here is what makes the card animate in the walker — see
# engine/systems/tree-kick.ts. {dir: {sprite id: row count}}.
CLUT_CYCLE = {1: {0x50: 10, 0x51: 10, 0x52: 10}}


def build_sheet(entries: dict, atlas: bytes, cycle: dict[int, int] | None = None):
    """Cut every referenced frame once; pack into a sheet.

    Returns (opaque_sheet, semi_sheet, frame->rect). Both sheets share one
    layout, so a clip's blended layer is the same rect on the semi sheet.
    Frames are keyed by (frame, clut row, ABE) because the STP split depends on
    the owning clip's blend flag.
    """
    frames = {}
    semis = {}
    for sid, e in entries.items():
        adds = [e["clut_y_add"] + k for k in range((cycle or {}).get(sid, 1))]
        abe = e["semi"] >= 0
        for lay in e["layers"]:
            for add in adds:
                key = (lay["frame"], add, abe)
                if key not in frames:
                    frames[key], semis[key] = cut_frame(atlas, lay, add, abe)
    # simple shelf pack
    keys = sorted(frames, key=lambda k: -frames[k].height)
    SHEET_W = 256
    x = y = shelf_h = 0
    pos = {}
    for k in keys:
        im = frames[k]
        if x + im.width > SHEET_W:
            x = 0
            y += shelf_h
            shelf_h = 0
        pos[k] = (x, y)
        x += im.width
        shelf_h = max(shelf_h, im.height)
    sheet = Image.new("RGBA", (SHEET_W, y + shelf_h))
    semi_sheet = Image.new("RGBA", (SHEET_W, y + shelf_h))
    for k, (px, py) in pos.items():
        sheet.paste(frames[k], (px, py))
        semi_sheet.paste(semis[k], (px, py))
    return sheet, semi_sheet, pos


def main() -> int:
    d = FIELDCOM.read_bytes()
    offs = list(struct.unpack_from("<4I", d, 0)) + [len(d)]
    dirs = [parse_directory(d[offs[0] : offs[1]]), parse_directory(d[offs[1] : offs[2]])]
    atlases = [unrlen(d[offs[2] + 8 :])[20:], unrlen(d[offs[3] + 8 :])[20:]]

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for di, (entries, atlas) in enumerate(zip(dirs, atlases)):
        cycle = CLUT_CYCLE.get(di, {})
        sheet, semi_sheet, pos = build_sheet(entries, atlas, cycle)
        sheet.save(OUT_DIR / f"fieldcom{di}.png")
        semi_sheet.save(OUT_DIR / f"fieldcom{di}_semi.png")
        mdir = {}
        for sid, e in entries.items():
            for k in range(cycle.get(sid, 1)):
                layers = []
                for lay in e["layers"]:
                    px, py = pos[(lay["frame"], e["clut_y_add"] + k, e["semi"] >= 0)]
                    layers.append({"x": px, "y": py, "w": lay["w"], "h": lay["h"],
                                   "dx": lay["dx"], "dy": lay["dy"]})
                # Row 0 keeps the plain id; the extra rows ship as "id@row".
                mdir[str(sid) if k == 0 else f"{sid}@{k}"] = {
                    "semi": e["semi"], "layers": layers}
        manifest[f"dir{di}"] = mdir
    manifest["programs"] = parse_glyph_programs()
    shadow, manifest["shadow"] = cut_drop_shadow(atlases)
    shadow.save(OUT_DIR / "field_shadow.png")
    (OUT_DIR / "fieldcom.json").write_text(json.dumps(manifest, indent=1))
    n0, n1 = len(manifest["dir0"]), len(manifest["dir1"])
    print(f"fieldcom: dir0={n0} ids, dir1={n1} ids -> {OUT_DIR}/fieldcom[01](_semi).png + fieldcom.json")
    print(f"fieldcom: drop shadow {SHADOW_W}x{SHADOW_H} {manifest['shadow']['color']} "
          f"-> {OUT_DIR}/field_shadow.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
