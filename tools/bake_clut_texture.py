#!/usr/bin/env python3
"""Bake a correct per-primitive-CLUT RGBA texture for a fight model.

Proven (session 15): the per-primitive CLUTs (cmd-0x01 b4/b5) are UV-region-disjoint
(tools/check_clut_region_disjoint.py: 0 texels shared between palettes). So instead of
a shader-side palette lookup we resolve each texel to its single covering face's palette
and bake one 256x256 RGBA page. Drop-in replacement for the stopgap single-CLUT PNG.

Pipeline: 4bpp index page (rows 0..239) + 16-color CLUTs in the page band (rows 240/248,
offset b5*128 + b4*2) + per-face (b4,b5) from the mesh cmd-stream. No RAM dependency.

Usage:
  uv run --with pillow python tools/bake_clut_texture.py --model m373rena \
      --out assets/battle/textures/m373rena.png
"""
import argparse, os, sys, struct, glob
from collections import defaultdict
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Every sibling module is next to this file. A hard-coded "~/ddw3-walker/tools"
# ahead of it made a model build import the OTHER worktree's copy of
# decode_action_scripts, so a build run from a second worktree silently read a
# different decoder than the one in the tree being edited.
from decode_title_art import rlen_decompress      # noqa: E402
from export_fight_anim import is_mesh_bin          # noqa: E402

W = H = 256


def load_page(folder):
    for p in sorted(glob.glob(folder + "/*.bin"),
                    key=lambda x: int(os.path.splitext(os.path.basename(x))[0])):
        d = open(p, "rb").read()
        if d.find(b"RLEN") >= 0:
            raw = rlen_decompress(d[d.find(b"RLEN"):])
            if len(raw) >= 8 and struct.unpack_from("<I", raw, 0)[0] == 0x10:
                ibs = struct.unpack_from("<I", raw, 8)[0]
                return raw[8 + 12: 8 + ibs]          # 32768 bytes, 128 B/row
    raise SystemExit("no texture bin")


def rgba(c):
    if c == 0x0000:
        return (0, 0, 0, 0)                          # PS1: 0x0000 = transparent
    return ((c & 0x1F) << 3, ((c >> 5) & 0x1F) << 3, ((c >> 10) & 0x1F) << 3, 255)


def palette(page, b4, b5):
    off = b5 * 128 + b4 * 2
    return [rgba(struct.unpack_from("<H", page, off + i * 2)[0]) for i in range(16)]


def walk_faces(data, face_off, face_size, vc):
    is_quad = has_uv = has_norm = False
    b1 = b3 = b4 = b5 = 0
    pos, end = face_off, min(face_off + face_size, len(data))
    while pos < end:
        cmd = data[pos]
        if cmd == 0xFF:
            break
        hi = (cmd >> 4) & 0xF
        if hi == 0x8:
            is_quad = (cmd & 0xF) != 0; pos += 1
        elif hi == 0x9:
            has_uv = (cmd & 0xF) != 0; pos += 1
        elif hi == 0xC:
            has_norm = (cmd & 0xF) != 0; pos += 1
        elif hi in (0xA, 0xB, 0xD, 0xE):
            pos += 1
        elif cmd == 0x01:
            if pos + 7 > end:
                break
            b1, b3, b4, b5 = data[pos+1], data[pos+3], data[pos+4], data[pos+5]
            pos += 7
        elif cmd in (0x02, 0x03, 0x04, 0x05):
            pos += 4
        elif cmd == 0x00:
            pos += 1
            n = 4 if is_quad else 3
            while True:
                needed = n + (n if has_norm else 0) + (n*2 if has_uv else 0)
                if pos + needed > end:
                    return
                vi = list(data[pos:pos+n]); pos += n
                if has_norm:
                    pos += n
                uvs = [(0, 0)] * n
                if has_uv:
                    raw = list(data[pos:pos+n*2]); pos += n*2
                    uvs = [(b1 + raw[2*i], b3 + raw[2*i+1]) for i in range(n)]
                if all(v < vc for v in vi):
                    if not is_quad:
                        yield (b4, b5), [uvs[0], uvs[1], uvs[2]]
                    else:
                        # Z-order quad (GP0 0x28): the two tris share diagonal v1-v2.
                        # Must match export_fight_anim's triangulation so baked texel
                        # coverage aligns with the rendered tris (was uvs[0],uvs[2],uvs[3],
                        # a fan split that painted the wrong half of every quad).
                        yield (b4, b5), [uvs[0], uvs[1], uvs[2]]
                        yield (b4, b5), [uvs[1], uvs[2], uvs[3]]
                if pos < end and data[pos] == 0x00:
                    pos += 1; continue
                break
        else:
            pos += 1


def rasterize(tri):
    (x0, y0), (x1, y1), (x2, y2) = tri
    minx, maxx = max(0, min(x0, x1, x2)), min(W-1, max(x0, x1, x2))
    miny, maxy = max(0, min(y0, y1, y2)), min(H-1, max(y0, y1, y2))
    area = (x1-x0)*(y2-y0) - (x2-x0)*(y1-y0)
    if area == 0:
        for x in range(minx, maxx+1):
            for y in range(miny, maxy+1):
                yield x, y
        return
    for y in range(miny, maxy+1):
        for x in range(minx, maxx+1):
            w0 = (x1-x)*(y2-y) - (x2-x)*(y1-y)
            w1 = (x2-x)*(y0-y) - (x0-x)*(y2-y)
            w2 = (x0-x)*(y1-y) - (x1-x)*(y0-y)
            if (w0 >= 0 and w1 >= 0 and w2 >= 0) or (w0 <= 0 and w1 <= 0 and w2 <= 0):
                yield x, y


def bake_texture(folder, out, dilate=1):
    """Bake a per-primitive-CLUT RGBA 256x256 page for one model folder -> `out` PNG.
    Returns a (npalettes, ntexels, conflicts) tuple. Raises SystemExit if no texture bin.
    Callable entry point so a single driver can do geometry+texture (session 21)."""
    page = load_page(folder)
    # 4bpp indices, row-major: index[y*256 + x]
    idx = []
    for byte in page[:W*H//2]:
        idx.append(byte & 0xF); idx.append(byte >> 4)

    pals = {}                          # (b4,b5) -> [16 rgba]
    texel_pal = {}                     # (x,y) -> (b4,b5)
    conflicts = 0
    for p in sorted(glob.glob(folder + "/*.bin"), key=lambda x: int(os.path.splitext(os.path.basename(x))[0])):
        data = open(p, "rb").read()
        if not is_mesh_bin(data):
            continue
        h = struct.unpack_from("<6I", data, 0)
        vc = struct.unpack_from("<I", data, 0x18)[0]
        if vc == 0 or vc > 10000:
            continue
        for pal, tri in walk_faces(data, h[2], len(data) - h[2], vc):  # full face region (all LODs/batches)
            if pal not in pals:
                pals[pal] = palette(page, pal[0], pal[1])
            for t in rasterize(tri):
                if t in texel_pal and texel_pal[t] != pal:
                    conflicts += 1
                texel_pal[t] = pal

    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    for (x, y), pal in texel_pal.items():
        px[x, y] = pals[pal][idx[y*W + x]]

    # dilate: fill transparent neighbours of covered texels with the nearest covered
    # color so edge filtering doesn't sample empty texels (region-disjoint => unambiguous)
    for _ in range(dilate):
        fills = []
        for (x, y), pal in list(texel_pal.items()):
            col = pals[pal][idx[y*W + x]]
            if col[3] == 0:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x+dx, y+dy
                if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in texel_pal:
                    fills.append((nx, ny, col))
        for nx, ny, col in fills:
            if (nx, ny) not in texel_pal:
                px[nx, ny] = col
                texel_pal[(nx, ny)] = None  # mark filled (no palette, just color)

    out = os.path.expanduser(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out)
    ntex = sum(1 for v in texel_pal.values() if v)
    return len(pals), ntex, conflicts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--pack", default="~/ddw3/pack/dw2003/fight/model")
    ap.add_argument("--dilate", type=int, default=1, help="grow covered region NPx to avoid edge bleed")
    args = ap.parse_args()
    folder = os.path.expanduser(os.path.join(args.pack, args.model))
    npals, ntex, conflicts = bake_texture(folder, args.out, args.dilate)
    print(f"wrote {args.out}  ({npals} palettes, {ntex} texels, {conflicts} conflicts)")


if __name__ == "__main__":
    main()
