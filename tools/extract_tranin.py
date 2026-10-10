#!/usr/bin/env python3
"""
Extract the gym mid-training animation packs: DAT/TRAINING/TRANIN{00-04,10-16}
(.BIN, splat-unextracted; found 2026-07-12 via the resident loaded-file
registry @0x80044b40 during a live mid-training RAM dump — see
docs/research/ui/stgtrain-decoded-2026-07-11.md §"Mid-training execution
scene + TRANIN discovery").

One file per drill family (00-04 = Punch/Defense/Yoga/Study/Jump Rope,
10-16 = the 7 tolerances; the super drills reuse the same files). Each file =
9 subdirs: 0-7 = per-STARTER large workout animation sets in the SAME order
as stgtrain's sprite-category table (0 Kotemon, 1 Kumamon, 2 Monmon,
3 Agumon, 4 Veemon, 5 Guilmon, 6 Renamon, 7 Patamon), 8 = the shared props
(Punch: punching bag + chain + ceiling mount + dust clouds).

Subdir format (decoded 2026-07-12 by pixel-verifying records against the
rendered pages — chain @(0,0), mount @(88,8), the three bag rows):
  file0   clip directory: {u32 0x321, u32 nclips, then per clip
          u32 nlayers + nlayers * 20-byte layers
          {u16 atlasPos(v<<8|u), u16 drawOff(dy<<8|dx), u16 c, u16 d,
           u16 w, u16 h, u16 g, u16 flags, u16 sx, u16 sy}}
          flags bit14 (0x4000) selects texture page 1 (page 0 otherwise);
          flags bit15 (0x8000) redirects the layer to the PROPS subdir's
          (subdir 8) texture pages + CLUT blocks — decoded 2026-07-13b from
          the Ice Tolerance freeze: every snow/frost layer in the trainee
          clips carries bit15, and its art pixel-matches the s8 pages in
          runtime VRAM ((896,0)/(960,0) vs trainee (768,0)), NOT the
          trainee's own (mostly empty) page 1. This dissolves the earlier
          "runtime-resident CLUT rows" mystery: the effect rows ship in the
          props blocks (16 rows), never in the trainee blocks.
          sx/sy are 4.12 scale (0x1000 = 1.0, always 1.0 in the data).
          c = relative CLUT id: palette row = (c & 0x7fff) >> 6 into the
          page's multi-row CLUT block, bit15 = semi-transparency enable
          (decoded 2026-07-13; the Study math ticker "10 - 08 = ?" and the
          desk answer screens "2"/"5" only render solid with their selected
          rows 4/2/3). d low 2 bits are exported as the semi cell's `abr`,
          but their mapping to PS1 ABR modes is UNRESOLVED (falling snow
          carries d&3=2 = subtractive-as-ABR, yet renders white at runtime);
          d bit5 tracks bit15 — untranscribed.
  file1-6 anim scripts: {u16 0x124, u16 n, n * {u16 clip, u16 dur(vsync),
          s16 dx, s16 dy}} — dx/dy = SIGNED per-step scene offset (movement
          paths: punch lunge, knockback, jumps; the old "a/b are 0" note was
          wrong — 38 scripts carry non-zero paths).
  file7-8 RLEN pages, same codec as the screen-pack tm (CLUT block of up to
          16 palette rows + 64hw x 256 4bpp page); layers pick their row via
          the `c` field above (base art is row 0 — matches the live
          capture's dust/bag colors).

Output per subdir: web/assets/ui/tranin/t{XX}_s{N}.png + .json
{clips: [{x,y,w,h,ox,oy, semi?:{x,y,w,h,ox,oy}}], anims: [[{clip,dur,dx,dy}]]}
where (ox,oy) is the cell's native scene draw offset (min over its layers'
drawOff — drawing at (sceneX+ox, sceneY+oy) preserves inter-clip alignment),
`semi` is the clip's semi-transparent layers composited into a separate cell
(blend it over the opaque cell), and dx/dy is the step's movement offset.
"""

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_screen_packs import unrlen, _disc_exe, _read_lba, _lba_of  # noqa: E402

from PIL import Image  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/assets/ui/tranin"
# suffix -> LBA index (~/ddw3/rust/dw2003_exe_data/src/lba.rs LBA_TRANINxx_BIN_IDX).
# Read straight from the disc image — the ~/ddw3 checkout only hydrates
# TRANIN00; the others are LFS pointers.
LBA = {"00": 606, "01": 1086, "02": 640, "03": 641, "04": 642,
       "10": 643, "11": 770, "12": 771, "13": 1087, "14": 644,
       "15": 645, "16": 772}


def toplevel_entries(d):
    # top level: bare offset table; entry count = first offset / 4
    first = struct.unpack_from("<I", d, 0)[0]
    n = first // 4
    offs = [struct.unpack_from("<I", d, k * 4)[0] for k in range(n)]
    offs.append(len(d))
    return [(offs[k], offs[k + 1]) for k in range(n)]


def archive_entries(d, off, end):
    # subdir level: {u32 count, count * u32 absolute offsets}. Offset slots can
    # be ZERO = empty file (e.g. TRANIN14 subdir 6 has no win/lose scripts);
    # a real entry ends at the next NONZERO offset. Treating 0 as a real end
    # silently dropped every script that preceded a zero slot (the Thunder
    # Defense charred-Renamon MISS script) — same family of bug as the
    # leading-zero toplevel headers in other packs.
    n = struct.unpack_from("<I", d, off)[0]
    offs = [struct.unpack_from("<I", d, off + 4 + k * 4)[0] for k in range(n)]
    out = []
    for k, o in enumerate(offs):
        if o == 0:
            out.append((0, 0))  # empty slot -> zero-length entry
            continue
        out.append((o, next((x for x in offs[k + 1:] if x), end)))
    return out


def decode_page(d, off):
    """Return (per-row RGBA renders, row count) for one texture page.

    The CLUT block carries up to 16 palette ROWS (bh); layers select a row via
    their `c` clut-id field (row = (c & 0x7fff) >> 6 — decoded 2026-07-13 from
    TRANIN03 subdir 8, where the Study math ticker/answer-screen layers carry
    c=0x8110/0x0090/0x80d0 = rows 4/2/3; row 0 gave hollow outline digits, the
    selected rows give the real solid ones). Rendering is lazy per row.
    """
    blob = unrlen(d[off:])
    pos, blocks = 8, []
    while pos + 12 <= len(blob):
        link, dest, bw, bh = struct.unpack_from("<IIHH", blob, pos)
        blocks.append((dest, bw, bh, blob[pos + 12 : pos + 12 + bw * bh * 2]))
        if link & 0x8000:
            break
        pos += link & 0x7FFF
    _cd, cw, crows, clut = blocks[0]
    _dest, bw, bh, data = blocks[1]
    w = bw * 4
    cache = {}

    def render(row):
        if row in cache:
            return cache[row]
        pal = []
        for i in range(16):
            c = struct.unpack_from("<H", clut, (row * cw + i) * 2)[0]
            pal.append(((c & 31) << 3, ((c >> 5) & 31) << 3,
                        ((c >> 10) & 31) << 3, 0 if c == 0 else 255))
        img = Image.new("RGBA", (w, bh))
        px = img.load()
        for y in range(bh):
            rowb = y * bw * 2
            for x in range(w):
                b = data[rowb + x // 2]
                v = b & 0xF if x % 2 == 0 else b >> 4
                px[x, y] = pal[v]
        cache[row] = img
        return img

    return render, crows


def parse_clips(d, start, end):
    b = d[start:end]
    magic, nclips, _first = struct.unpack_from("<3I", b, 0)
    assert magic == 0x321, hex(magic)
    pos, clips = 8, []
    for _ in range(nclips):
        cnt = struct.unpack_from("<I", b, pos)[0]
        pos += 4
        layers = []
        for _l in range(cnt):
            ap, do, c, d_, w, h, _g, fl, _sx, _sy = struct.unpack_from("<10H", b, pos)
            pos += 20
            # c = relative CLUT id: row = (c & 0x7fff) >> 6 into the page's
            # multi-row CLUT block; bit15 = PS1 semi-transparency enable
            # (the Thunder Defense flash, Yoga spotlight cone, Heat explosion
            # glow, the Ice frost encasing — the real game blends these over
            # the trainee, which is why the body stays visible inside).
            # flags bit15 = props-page redirect (see module docstring);
            # abr = d & 3 = PS1 semi blend mode (only meaningful when semi).
            layers.append({"u": ap & 0xFF, "v": ap >> 8, "dx": do & 0xFF,
                           "dy": do >> 8, "w": w, "h": h,
                           "page": 1 if fl & 0x4000 else 0,
                           "props": 1 if fl & 0x8000 else 0,
                           "clut": (c & 0x7FFF) >> 6, "semi": c >> 15,
                           "abr": d_ & 3})
        clips.append(layers)
    assert pos == len(b), (hex(pos), hex(len(b)))
    return clips


def parse_anim(d, start, end):
    b = d[start:end]
    if len(b) < 4:
        return []
    magic, n = struct.unpack_from("<2H", b, 0)
    if magic != 0x124:
        return []
    steps = []
    for k in range(n):
        clip, dur, a, b2 = struct.unpack_from("<4H", b, 4 + k * 8)
        # a/b = SIGNED per-step scene offset (dx,dy) — the sprite's movement
        # path (punch lunge, knockback, the Study desk run). The old "0 in
        # the data" note was wrong: 38 scripts carry non-zero paths.
        sx = a - 0x10000 if a >= 0x8000 else a
        sy = b2 - 0x10000 if b2 >= 0x8000 else b2
        steps.append({"clip": clip, "dur": dur, "dx": sx, "dy": sy})
    return steps


def extract_subdir(d, start, end, out_base, props_pages=None):
    files = archive_entries(d, start, end)
    clips = parse_clips(d, *files[0])
    anims = [parse_anim(d, *files[k]) for k in range(1, len(files) - 2)]
    pages = [decode_page(d, files[-2][0]), decode_page(d, files[-1][0])]
    # Layers with the props-redirect flag sample the props subdir's pages
    # (subdir 8: snow mounds/snowman, dust, flashes) and its CLUT rows.
    # For subdir 8 itself the redirect is the identity.
    props_pages = props_pages or pages
    # Composite each clip; keep native scene offset (ox,oy). Native draw
    # order = record order, LATER layers on top (PS1 submission order).
    # Decided 2026-07-13 by the Study props (t03_s8): the answer digits
    # (layers 2-4) must render over the opaque desk row (layer 0).
    # Semi-transparent layers (c bit15) go into a SEPARATE cell per clip
    # ("semi" sub-entry) so the renderer can blend them over the scene —
    # flattening them opaque hid the trainee under the Thunder flash / Yoga
    # spotlight. (A semi-opaque-semi layer sandwich collapses to
    # opaque-then-semi — an approximation; only the Yoga spotlight clip has
    # one, and blended layers nearly commute.)
    def build_cell(layers):
        ox = min(l["dx"] for l in layers)
        oy = min(l["dy"] for l in layers)
        cw = max(l["dx"] + l["w"] for l in layers) - ox
        ch = max(l["dy"] + l["h"] for l in layers) - oy
        cell = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        for l in layers:
            render, crows = (props_pages if l["props"] else pages)[l["page"]]
            # out-of-range rows keep the previous row-0 behavior (should no
            # longer trigger now that props layers resolve against the props
            # blocks, which ship the full effect-row suite).
            pg = render(l["clut"] if l["clut"] < crows else 0)
            cell.alpha_composite(pg.crop((l["u"], l["v"], l["u"] + l["w"],
                                          l["v"] + l["h"])),
                                 (l["dx"] - ox, l["dy"] - oy))
        return cell, {"w": cw, "h": ch, "ox": ox, "oy": oy}
    cells, metas = [], []
    for layers in clips:
        opq = [l for l in layers if not l["semi"]]
        sem = [l for l in layers if l["semi"]]
        if opq:
            cell, m = build_cell(opq)
        else:
            cell, m = None, {"w": 0, "h": 0, "ox": 0, "oy": 0, "x": 0, "y": 0}
        if sem:
            scell, sm = build_cell(sem)
            # d & 3 of the semi layers, exported for future blend research;
            # NOT a verified PS1 ABR mapping (see docstring).
            sm["abr"] = max(l["abr"] for l in sem)
            m["semi"] = sm
            cells.append((sm, scell))
        metas.append(m)
        if cell is not None:
            cells.append((m, cell))
    # pack cells into a sheet, simple shelf layout
    sheet_w = 512
    x = y = shelf_h = 0
    for m, cell in cells:
        if x + m["w"] > sheet_w:
            x, y = 0, y + shelf_h
            shelf_h = 0
        m["x"], m["y"] = x, y
        x += m["w"]
        shelf_h = max(shelf_h, m["h"])
    sheet = Image.new("RGBA", (sheet_w, y + shelf_h), (0, 0, 0, 0))
    for m, cell in cells:
        sheet.alpha_composite(cell, (m["x"], m["y"]))
    sheet.save(out_base.with_suffix(".png"))
    out_base.with_suffix(".json").write_text(
        json.dumps({"clips": metas, "anims": anims}, separators=(",", ":")) + "\n")
    return len(clips)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    raw, exe = _disc_exe()
    for fx, lba_idx in sorted(LBA.items()):
        d = _read_lba(raw, _lba_of(exe, lba_idx), 128)  # >= 0x34000 max size
        tops = toplevel_entries(d)
        # Decode the props subdir's (8) pages first: trainee clips with the
        # props-redirect flag sample them (snow/frost/dust effect layers).
        props_pages = None
        if len(tops) > 8 and tops[8][0] and tops[8][1] > tops[8][0]:
            pfiles = archive_entries(d, *tops[8])
            if pfiles and pfiles[0][1] > pfiles[0][0]:
                props_pages = [decode_page(d, pfiles[-2][0]),
                               decode_page(d, pfiles[-1][0])]
        for si, (s, e) in enumerate(tops):
            if s == 0 or e <= s:
                continue
            files = archive_entries(d, s, e)
            if not files or files[0][1] <= files[0][0]:
                continue  # empty padding slot
            n = extract_subdir(d, s, e, OUT / f"t{fx}_s{si}",
                               props_pages=None if si == 8 else props_pages)
            total += n
    print(f"wrote {OUT} ({total} clips)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
