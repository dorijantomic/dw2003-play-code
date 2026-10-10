#!/usr/bin/env python3
"""Extract the shared UI font (glyphs + the stat/element icon glyphs) to
walker assets.

Decoded 2026-07-03: every status/shop-menu "sprite" that isn't chrome is a
TEXT LABEL drawn by resident EXE code (object factory F0x8001ae38, drawer
F0x800197a4). Glyphs are 11-byte records {page,u,v,clut_x,clut_y,w,h,dx,dy,
adv,pad}; per-kind bank records live at RAM 0x8004dd74+kind*0x18 with the
basic table ptr at +4 (char-4 indexed) and the extended table at +8
(2-byte chars 0x81,NN -> record NN-1; count at +0x16). Text encoding:
0x01 space, 0x04+d digits, 0x0e+n uppercase, 0x28+n lowercase.

The stat/resistance icons of the status menu are EXTENDED GLYPHS of kind 1:
fist/STR=0x24, shield/DEF=0x25, fairy/SPT=0x26, book/WIS=0x27, hand/SPD=0x28,
sparkle/CHR=0x2b; fire=0x2c water=0x2d ice=0x2f wind=0x30 thunder=0x32
machine=0x34 dark=0x35 (indices into the ext table; the in-string bytes are
0x81, index+1). Verified pixel-exact against savestate 3's live VRAM.

Texture source: CMFONTTM.BIN (disc LBA table idx 647, named in
~/ddw3/rust/dw2003_exe_data/src/lba.rs) = two RLEN 64hw x 256 4bpp atlases =
VRAM font pages 0/1 at x=0x140hw (byte-verified 100% vs live VRAM once; the
committed pipeline reads only static files). Glyph tables read from the
decomp's typed EXE data (rust/dw2003_exe_data/src/data.rs u32 statics — the
same bytes the EXE carries, already labeled by address).

Output: web/assets/ui/uifont.png (kind-1/2/3 glyphs at CLUT offset 0) +
uifont.json (per-kind char tables, 8 CLUT rows per kind, semantic icon
names). Kind 2 is the 8x9 face (bank D0x8004f470). Drawer F0x800197a4
adds widget +0xC0 (unk138) to the glyph's clut_y; those extra rows are
the colour faces (kind-1 offset 1 = cyan, offset 4 = green, offset 3 =
gold).
"""

import os
import json
import re
import struct
import sys
from pathlib import Path

from PIL import Image

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
DISC = Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin")
DATA_RS = DDW3 / "rust/dw2003_exe_data/src/data.rs"
REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "web/assets/ui"

LBA_CMFONTTM = 647  # rust/dw2003_exe_data/src/lba.rs LBA_CMFONTTM_BIN_IDX
BANK_TABLE = 0x8004DD74  # data.rs D0x8004dd74: per-kind font bank records, 0x18B each
EXE_RAM = 0x80010000  # SLES_039.36 t_addr (file data at +0x800, LBA 24)

# data.rs declares the tables word-by-word:  pub static mut D0x8004e5a4 @ "0x8004e5a4": u32 = 0x30126001;
DATA_WORD_RE = re.compile(r'D0x([0-9a-f]{8}) @ "0x[0-9a-f]{8}": u32 = 0x([0-9a-f]+);')
# bank-table pointer words appear as:  ... : *const u32 = unsafe { ptr::addr_of!(D0x8004e5a4) };
DATA_PTR_RE = re.compile(r'D0x([0-9a-f]{8}) @ "0x[0-9a-f]{8}": \*const u32 = unsafe \{ ptr::addr_of!\(D0x([0-9a-f]{8})\) \};')


def load_exe_words() -> dict[int, int]:
    """address -> u32 map of all typed EXE data words (pointers resolved to targets)."""
    src = DATA_RS.read_text()
    words = {int(m[1], 16): int(m[2], 16) for m in DATA_WORD_RE.finditer(src)}
    words.update({int(m[1], 16): int(m[2], 16) for m in DATA_PTR_RE.finditer(src)})
    return words


def exe_slice(words: dict[int, int], addr: int, n: int) -> bytes:
    out = bytearray()
    base = addr & ~3
    for a in range(base, base + ((n + (addr - base) + 3) & ~3), 4):
        out += struct.pack("<I", words.get(a, 0))
    return bytes(out[addr - base : addr - base + n])

# kind-1 extended-glyph index -> semantic name. CONFIRMED by the decomp's own
# text codec (~/ddw3/tools/ddw3-lang-file/src/codepoint.rs): the two-byte
# codepoints [0x01,0x25]..[0x01,0x36] are named Dw2003StrengthStatSymbol,
# ...ToleranceSymbol etc., and extended glyph index = second byte - 1.
ICONS = {
    0x24: "str", 0x25: "def", 0x26: "spt", 0x27: "wis", 0x28: "spd",
    0x2B: "chr", 0x2C: "fire", 0x2D: "water", 0x2F: "ice", 0x30: "wind",
    0x32: "thunder", 0x34: "machine", 0x35: "dark",
}

CODEPOINT_RS = DDW3 / "tools/ddw3-lang-file/src/codepoint.rs"
CP1_RE = re.compile(r'^\t0x([0-9a-f]{2}) => \w+\s*, ".*?"\s*, "(.*?)";', re.M)
CP2_RE = re.compile(r'^\t0x01, 0x([0-9a-f]{2}) => \w+\s*, ".*?"\s*, "(.*?)";', re.M)


def parse_charmap() -> dict:
    """The official charset (ddw3-lang-file codepoint.rs) -> glyph table refs.

    Single-byte code c -> basic glyph index c-4 (glyph resolver F0x8001a48c:
    record = basic_table + c*11 - 0x2c). Two-byte [0x01, n] -> extended glyph
    index n-1 (resolver case 1). Values: {"t": "b"|"e", "i": index}.
    """
    src = CODEPOINT_RS.read_text()
    chars = {}
    for m in CP1_RE.finditer(src):
        code, repr_ = int(m[1], 16), m[2]
        if code >= 4 and repr_ and not repr_.startswith("["):
            chars[repr_.replace('\\\\', '\\')] = {"t": "b", "i": code - 4}
    for m in CP2_RE.finditer(src):
        n, repr_ = int(m[1], 16), m[2]
        if repr_ and n >= 1:
            key = repr_.replace('\\\\', '\\')
            chars[key] = {"t": "e", "i": n - 1}
    return chars


def read_disc_file(raw: bytes, lba_idx: int, n_sectors: int, exe: bytes) -> bytes:
    table_off = 0x800 + (0x80044F6C - EXE_RAM)
    lba = struct.unpack_from("<I", exe, table_off + lba_idx * 4)[0]

    def sector(l: int) -> bytes:
        return raw[l * 2352 + 24 : l * 2352 + 24 + 2048]

    return b"".join(sector(lba + i) for i in range(n_sectors))


def unrlen(blob: bytes) -> bytes:
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
    return struct.unpack_from("<H", atlas, ((y & 0xFF) * 64 + (x & 0x3F)) * 2)[0]


def glyph_img(atlases, rec):
    page, u, v, cx, cy, w, h = rec[0], rec[1], rec[2], rec[3], rec[4], rec[5], rec[6]
    if w == 0 or h == 0 or page >= len(atlases):
        return None
    atlas = atlases[page]
    clut_x = cx & ~15
    pal = [hw(atlases[0], clut_x + i, cy) for i in range(16)]
    rgba = [((p & 31) << 3, ((p >> 5) & 31) << 3, ((p >> 10) & 31) << 3,
             0 if p == 0 else 255) for p in pal]
    img = Image.new("RGBA", (w, h))
    put = img.putpixel
    for yy in range(h):
        for xx in range(w):
            t = u + xx
            put((xx, yy), rgba[(hw(atlas, t // 4, v + yy) >> ((t % 4) * 4)) & 0xF])
    return img


def main() -> int:
    raw = DISC.read_bytes()
    # The EXE image is only needed for the LBA offsets table (idx -> sector).
    exe = b"".join(raw[l * 2352 + 24 : l * 2352 + 24 + 2048]
                   for l in range(24, 24 + 0x48000 // 2048))
    tm = read_disc_file(raw, LBA_CMFONTTM, 22, exe)
    words = load_exe_words()
    # header: {u32 n_entries=4?, u32 off0=0xc, u32 off1, u32 0}; each entry is
    # a u32 size-ish word followed by the RLEN blob (blobs at off+4).
    off0, off1 = struct.unpack_from("<2I", tm, 0x4)
    atlases = [unrlen(tm[o + 4:])[20:] for o in (off0, off1)]

    def exe_bytes(ram_addr: int, n: int) -> bytes:
        # Read the SHIPPED EXE image, not the typed data.rs word map. data.rs
        # declares only the words somebody has typed, and `exe_slice` fills the
        # rest with zeroes — one undeclared word inside the kind-3 glyph table
        # zeroed the 'E' record's page/u, so the number font drew "EXP" as
        # " XP" on the status sheet's EXP plate. data.rs stays the fallback for
        # anything outside the loaded image.
        off = 0x800 + (ram_addr - EXE_RAM)
        if 0 <= off and off + n <= len(exe):
            return exe[off : off + n]
        return exe_slice(words, ram_addr, n)

    manifest = {"kinds": {}, "icons": {}, "chars": parse_charmap(), "cluts": {}}
    cells = []  # (key, img, meta)
    # F0x8001ae38 keeps kinds 1..3 and clamps anything else to 1.
    for kind in (1, 2, 3):
        bank = exe_bytes(BANK_TABLE + kind * 0x18, 0x18)
        basic_ptr, ext_ptr = struct.unpack_from("<II", bank, 4)
        n_ext = struct.unpack_from("<h", bank, 0x16)[0]
        n_basic = (ext_ptr - basic_ptr) // 11
        clut_x = clut_y = None
        for tbl, ptr, count in (("basic", basic_ptr, n_basic),
                                ("ext", ext_ptr, n_ext)):
            recs = exe_bytes(ptr, count * 11)
            for i in range(count):
                rec = recs[i * 11 : i * 11 + 11]
                if clut_x is None and rec[5] and rec[6]:
                    clut_x, clut_y = rec[3], rec[4]
                img = glyph_img(atlases, rec)
                if img is None:
                    continue
                cells.append(((kind, tbl, i), img,
                              {"dx": struct.unpack("b", rec[7:8])[0],
                               "dy": struct.unpack("b", rec[8:9])[0],
                               "adv": rec[9]}))
        if clut_x is not None:
            rows = {}
            for off in range(8):
                pal = [hw(atlases[0], (clut_x & ~15) + i, clut_y + off)
                       for i in range(16)]
                rows[str(off)] = [
                    [(p & 31) << 3, ((p >> 5) & 31) << 3, ((p >> 10) & 31) << 3,
                     0 if p == 0 else 255]
                    for p in pal
                ]
            manifest["cluts"][str(kind)] = {
                "x": clut_x & ~15, "y": clut_y, "rows": rows,
            }

    # shelf-pack
    SHEET_W = 512
    x = y = shelf_h = 0
    pos = {}
    for key, img, _ in cells:
        if x + img.width > SHEET_W:
            x, y, shelf_h = 0, y + shelf_h, 0
        pos[key] = (x, y)
        x += img.width
        shelf_h = max(shelf_h, img.height)
    sheet = Image.new("RGBA", (SHEET_W, y + shelf_h))
    for key, img, _ in cells:
        sheet.paste(img, pos[key])

    for (kind, tbl, i), img, meta in cells:
        k = manifest["kinds"].setdefault(str(kind), {"basic": {}, "ext": {}})
        px, py = pos[(kind, tbl, i)]
        k[tbl][str(i)] = {"x": px, "y": py, "w": img.width, "h": img.height, **meta}
        if kind == 1 and tbl == "ext" and i in ICONS:
            manifest["icons"][ICONS[i]] = {"x": px, "y": py,
                                           "w": img.width, "h": img.height}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sheet.save(OUT_DIR / "uifont.png")
    (OUT_DIR / "uifont.json").write_text(json.dumps(manifest, indent=1))
    counts = {
        k: len(v["basic"]) + len(v["ext"])
        for k, v in manifest["kinds"].items()
    }
    print(f"uifont: {counts} glyphs, {len(manifest['icons'])} named icons, "
          f"cluts {sorted(manifest['cluts'])} -> uifont.png + uifont.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
