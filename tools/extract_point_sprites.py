#!/usr/bin/env python3
"""Extract the per-stage ambient point-sprite decorations (windmills, fans,
torches, walk-behind props) to walker assets.

System decoded in docs/research/field/point-sprite-ambient-system.md:
each stage's wstag init stores a table pointer at descriptor[0x80099D80]+0x10;
records are 18 bytes {active, atlasFlag, size, layer, spriteId, mode, min,
max, period, ctr, s16 x, s16 y, s16 ysort, s16 timer}, terminated by size==0.
Rendered by fieldstg F0x80089038: spriteId -> TMPK sub-0 sprite directory
(FIELDCOM record formats, but split across pack entries: entry 0 = 14-byte
frames, entry 1 = ids byte table, entries 2..N = clips) -> pixels in the
stage MASK pack's RLEN TIMs, uploaded as adjacent 64-halfword VRAM columns at
VRAM (320, 256). Frame u is a GLOBAL texel coordinate (bpp from flags bit0:
hw = u/2 for 8bpp, u/4 for 4bpp; subTim = hw//64). CLUT (decoded 2026-07-04
from EXE F0x8001ed6c + fieldstg context setup): 8bpp frames -> the MASK CLUT
block at VRAM (0,496), row = clut_y+clut_y_add-256; 4bpp frames -> raw
halfword rows OF THE MASK IMAGE itself (row = clut_y+clut_y_add, entries at
hw clut_x). Modes 2/3 add the animated ctr byte to the CLUT row (palette
flicker) -- extracted as "sid@ctr" sprite variants. Records with
atlasFlag==0xFF draw from FIELDCOM.BIN instead (anchor -(0x32,0x64)) --
those reference the shipped fieldcom sheets and get no pixels here.

Read MASK from the RAW disc TIMs -- ddw3's tim/.../sNNNmask/{1,2}.png render
indexed data as direct 16bpp color and are unusable for sprite cutting.

Output: web/assets/effects/sNNN.png (per-stage sheet) +
web/assets/data/point_sprites.json.

Fail-soft: a stage that trips any assertion is skipped with a warning; the
tool always exits 0 (summary printed) so build_all never blocks on one bad
stage.
"""
import os

import json
import re
import struct
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import overlay_scan as ovs
from extract_fieldcom import unrlen

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
ASM = DDW3 / "asm/dw2003/pro"
DISC = Path(os.environ.get("DW3_DISC") or Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3") / "build/iso/dw2003.bin")
REPO = Path(__file__).resolve().parent.parent
OUT_SHEETS = REPO / "web/assets/effects"
OUT_JSON = REPO / "web/assets/data/point_sprites.json"

WSTAG_BASE = 0x800A5DE0
DESCRIPTOR = 0x80099D80

# Stages whose native ambience code runs in the MIPS interpreter — their
# FULL sprite directory gets cut (see the full-directory block below).
_native_manifest = REPO / "web/assets/native/manifest.json"
NATIVE_STAGES: frozenset[str] = (
    frozenset(json.loads(_native_manifest.read_text()))
    if _native_manifest.exists()
    else frozenset()
)
# Launch pads (type-0x17 stage actors, tools/extract_launch_pads.py). Their
# clip ids come out of the SAME per-stage TMPK sub-0 sprite directory as the
# point sprites, but nothing in the point-sprite records references them, so
# they have to be cut explicitly. The pad draws its base clip while idle and
# base+1..base+7 during its state-2 strobe (wstag735 script at 0x800a686c).
# The pad ALSO runs a looping idle script whose value is a CLUT-row offset on
# the base clip (obj+0x66 -> EXE F0x8001ecec -> ctx+0x20), so the untouched disc
# pulses through palettes base@1, base@2 — the same `ctr` mechanism the mode-2/3
# point sprites use, cut here as extra "sid@ctr" sprites.
_launch_pads = REPO / "web/assets/data/launch_pads.json"
LAUNCH_PADS: dict = (
    json.loads(_launch_pads.read_text()) if _launch_pads.exists() else {}
)
PAD_STROBE_STEPS = 7


def pad_clip_ids(stage: str) -> set[int]:
    """Every directory id a stage's launch pads can draw."""
    entry = LAUNCH_PADS.get(stage.lstrip("s"))
    ids: set[int] = set()
    for pad in (entry or {}).get("pads", []):
        if not pad.get("enabled"):
            continue
        base = pad["clip"]
        ids.update(range(base, base + PAD_STROBE_STEPS + 1))
    return ids


def pad_palette_ctrs(stage: str) -> dict[int, list[int]]:
    """{base clip -> nonzero idle-script CLUT offsets} for a stage's pads."""
    entry = LAUNCH_PADS.get(stage.lstrip("s")) or {}
    script = (entry.get("idleScript") or {}).get("entries") or []
    ctrs = sorted({v for v, _hold in script if 0 < v < 0x80})
    if not ctrs:
        return {}
    return {
        pad["clip"]: ctrs for pad in entry.get("pads", []) if pad.get("enabled")
    }


EXE_BASE = 0x80010000
LBA_OFFSETS_RAM = 0x80044F6C
LBA_LEN_SECTORS_RAM = 0x800474A4
SECTOR, USER_OFF, USER_LEN = 2352, 24, 2048


# ── disc access ──────────────────────────────────────────────────────────────
class Disc:
    def __init__(self, path: Path):
        self.f = path.open("rb")
        exe = b"".join(self._sector(24 + i) for i in range(0x40000 // USER_LEN))
        off = 0x800 + (LBA_OFFSETS_RAM - EXE_BASE)
        self.lba = struct.unpack_from("<2382I", exe, off)
        off = 0x800 + (LBA_LEN_SECTORS_RAM - EXE_BASE)
        self.lens = struct.unpack_from("<2382H", exe, off)

    def _sector(self, l: int) -> bytes:
        self.f.seek(l * SECTOR + USER_OFF)
        return self.f.read(USER_LEN)

    def file(self, idx: int) -> bytes:
        lba, n = self.lba[idx], self.lens[idx]
        return b"".join(self._sector(lba + i) for i in range(n))


def pack_entries(blob: bytes) -> list[bytes]:
    """Split a standard pack (header = u32 offsets, count = first-nonzero/4).

    Entries may be EMPTY (offset 0) — the s92x/s96x stage TMPKs lead with
    several: their headers look like [0,0,0,0x18,...]. The game resolver
    (F0x800140d8: packBase + packBase[sub*4]) never validates, it just never
    references the zero slots; the header length is the first NONZERO offset
    (nonzero offsets ascend, so the first one is the minimum = header end).
    Empty entries are returned as b"" to keep sub-entry indexing intact.
    """
    count: int | None = None
    offs: list[int] = []
    i = 0
    while count is None or i < count:
        if i * 4 + 4 > len(blob) or (count is None and i >= 1024):
            raise ValueError("not a pack (no nonzero header offset)")
        (w,) = struct.unpack_from("<I", blob, i * 4)
        if count is None and w:
            if w % 4 or w > len(blob) or w // 4 <= i:
                raise ValueError(f"not a pack (first offset {w:#x} at slot {i})")
            count = w // 4
        offs.append(w)
        i += 1
    nz = [o for o in offs if o]
    if nz != sorted(nz) or any(o > len(blob) for o in nz):
        raise ValueError(f"bad pack offsets {offs[:6]}")
    out: list[bytes] = []
    for j, o in enumerate(offs):
        if not o:
            out.append(b"")
            continue
        end = next((x for x in offs[j + 1 :] if x), len(blob))
        out.append(blob[o:end])
    return out


# ── wstag static-data parsing ────────────────────────────────────────────────
def wstag_bytes(path: Path) -> bytes:
    """Flatten the overlay's .word stream into a byte buffer (file-offset keyed)."""
    words = ovs.load_words(path)
    buf = bytearray(max(words) + 4)
    for off, w in words.items():
        struct.pack_into("<I", buf, off, w)
    return bytes(buf)


def descriptor_stores(path: Path) -> dict[int, list[int]]:
    """{descriptor offset: [stored values]} for every `sw rt, off(rX=0x80099D80)`."""
    words = ovs.load_words(path)
    found: dict[int, list[int]] = {}
    for _off, w, regs in ovs.track_consts(sorted(words.items())):
        if (w >> 26) == 0x2B:  # sw
            rs, rt = (w >> 21) & 31, (w >> 16) & 31
            imm = w & 0xFFFF
            simm = imm - 0x10000 if imm >= 0x8000 else imm
            v = regs.get(rt)
            if regs.get(rs) == DESCRIPTOR and v is not None:
                found.setdefault(simm, []).append(v)
    return found


RECORD = struct.Struct("<10B4h")
FIELDS = ("active", "atlasFlag", "size", "layer", "spriteId", "mode",
          "min", "max", "period", "ctr", "x", "y", "ysort", "timer")


def parse_records(buf: bytes, off: int) -> list[dict]:
    recs = []
    while off + 18 <= len(buf):
        vals = RECORD.unpack_from(buf, off)
        r = dict(zip(FIELDS, vals))
        if r["size"] == 0:  # terminator (renderer loop condition, F0x80089038)
            return recs
        del r["ctr"], r["timer"]  # runtime state, always 0 in ROM
        recs.append(r)
        off += 18
        if len(recs) > 512:
            raise ValueError("unterminated point table")
    raise ValueError("point table runs off the overlay")


# ── sprite directory (TMPK sub-0) ────────────────────────────────────────────
def parse_tmpk_directory(sub0: bytes) -> tuple[list[tuple], list[int], list[dict]]:
    """-> (frames, ids, clips); FIELDCOM record formats in pack-entry form."""
    entries = pack_entries(sub0)
    if len(entries) < 3:
        raise ValueError(f"TMPK sub-0 has {len(entries)} entries, need >=3")
    fr = entries[0]
    if len(fr) % 14 > 2:  # tables may carry a 2-byte alignment pad at the end
        raise ValueError(f"frame table len {len(fr)} not /14")
    frames = [struct.unpack_from("<7H", fr, i * 14) for i in range(len(fr) // 14)]
    clips = []
    for c in entries[2:]:
        if not c:  # zero-padding at the pack tail ends the clip list
            break
        count, clut_y_add = struct.unpack_from("<HH", c, 0)
        (semi,) = struct.unpack_from("<h", c, 4)
        layers = [struct.unpack_from("<Hhh", c, 6 + k * 6) for k in range(count)]
        clips.append({"clut_y_add": clut_y_add, "semi": semi, "layers": layers})
    # ids table is 0xFF-terminated but may carry junk before the terminator;
    # the clip count bounds the true length (same quirk as FIELDCOM's).
    ids = []
    for b in entries[1]:
        if b == 0xFF or len(ids) >= len(clips):
            break
        ids.append(b)
    return frames, ids, clips


# ── MASK atlas ───────────────────────────────────────────────────────────────
class MaskAtlas:
    """Adjacent 64-halfword VRAM columns + the CLUT block, from the raw MASK pack."""

    def __init__(self, mask_blob: bytes):
        self.cols: list[bytes] = []  # each: 64 hw * rows, 16bpp rows
        self.rows = 0
        self.clut: list[list[int]] = []
        for sub in pack_entries(mask_blob):
            if not sub:  # zero-padded / empty pack slot
                continue
            tim = unrlen(sub)
            magic, flags = struct.unpack_from("<II", tim, 0)
            if magic != 0x10:
                raise ValueError(f"MASK sub not a TIM (magic {magic:#x})")
            p = 8
            if flags & 8:
                blen, _cx, _cy, cw, ch = struct.unpack_from("<IHHHH", tim, p)
                cd = tim[p + 12 : p + blen]
                self.clut = [
                    [struct.unpack_from("<H", cd, (r * cw + c) * 2)[0] for c in range(cw)]
                    for r in range(ch)
                ]
                p += blen
            blen, _x, _y, w, h = struct.unpack_from("<IHHHH", tim, p)
            if w != 64:
                raise ValueError(f"MASK TIM is {w} hw wide, expected 64")
            self.cols.append(tim[p + 12 : p + 12 + h * 128])
            self.rows = max(self.rows, h)
        # No unconditional CLUT-block check: a MASK whose frames are all 4bpp
        # with image-row palettes (clut_y < 256, e.g. s225's single-TIM mask)
        # legitimately has no block; cut() raises per-frame if an 8bpp frame
        # actually needs the missing block.

    def texel(self, u: int, v: int, bpp: int) -> int:
        hw = u // 2 if bpp == 8 else u // 4
        col, lhw = hw // 64, hw % 64
        if col >= len(self.cols) or v * 128 + lhw * 2 + 2 > len(self.cols[col]):
            raise ValueError(f"texel ({u},{v}) outside MASK columns")
        (val,) = struct.unpack_from("<H", self.cols[col], v * 128 + lhw * 2)
        if bpp == 8:
            return (val >> (8 * (u % 2))) & 0xFF
        return (val >> (4 * (u % 4))) & 0xF

    def texhw(self, hw: int, v: int) -> int:
        """Raw 16bpp halfword at atlas (hw, v) -- used when a palette is stored
        as image rows (the 4bpp CLUT path)."""
        col, lhw = hw // 64, hw % 64
        if col >= len(self.cols) or v * 128 + lhw * 2 + 2 > len(self.cols[col]):
            raise ValueError(f"palette hw ({hw},{v}) outside MASK columns")
        return struct.unpack_from("<H", self.cols[col], v * 128 + lhw * 2)[0]

    def cut(self, frame: tuple, clut_y_add: int, ctr: int = 0,
            semi: int = -1) -> tuple[Image.Image, Image.Image | None]:
        """Decode one directory frame into its plain and blended texels.

        CLUT resolution decoded 2026-07-04 (EXE draw F0x8001ed6c + the fieldstg
        context setup sp8C(0x140,0x100)/sp90(0,0x1F0), byte-verified against a
        live VRAM dump on s400):
        - the MASK atlas uploads at VRAM (320, 256), columns adjacent;
        - 8bpp CLUT base = (0, 496) = the MASK pack's CLUT block (so an 8bpp
          frame's clut_y is 256+blockRow -- the previously shipped model);
        - 4bpp CLUT base = (320, 256) = the MASK IMAGE ITSELF: a 4bpp frame's
          clut_y (< 256) is a pixel ROW of the atlas, its 16 entries are the
          raw halfwords at hw offset clut_x. The palettes are drawn INTO the
          mask art's bottom rows.
        - the draw adds the record's `ctr` byte to the CLUT row (spA0(ctr)):
          that is the mode-2/3 "torch flicker" -- palette-row cycling.

        The clip's `semi` is the primitive blend state (FIELDCOM decode
        L64-72): -1 = ABE off (every texel written straight); otherwise ABE=1,
        ABR=semi&3, and ONLY the texels whose CLUT entry has STP (0x8000) set
        run through the blend equation. So the frame is split: `plain` holds
        the non-STP texels (all of them when semi == -1), `semi` holds the STP
        texels alone (same rect), or None when the clip is opaque.
        """
        u, v, w, h, clut_x, clut_y, flags = frame
        bpp = 8 if flags & 1 else 4
        row = clut_y + clut_y_add + ctr
        if row < 256:
            if bpp != 4:
                raise ValueError(f"8bpp frame with image-row CLUT y={row}")
            pal = [self.texhw(clut_x + k, row) for k in range(16)]
            add_x = 0  # clut_x consumed as the palette's hw position
        else:
            row -= 256
            if not 0 <= row < len(self.clut):
                raise ValueError(f"CLUT row {row} outside mask block "
                                 f"(clut_y={clut_y}, {len(self.clut)} rows)")
            pal = self.clut[row]
            add_x = clut_x if bpp == 4 else 0
        im = Image.new("RGBA", (w, h))
        semi_im = Image.new("RGBA", (w, h)) if semi >= 0 else None
        px = im.load()
        spx = semi_im.load() if semi_im is not None else None
        for yy in range(h):
            for xx in range(w):
                idx = self.texel(u + xx, v + yy, bpp) + add_x
                c = pal[idx]
                if c == 0:
                    continue  # CLUT entry 0 = transparent texel
                rgba = ((c & 31) << 3, ((c >> 5) & 31) << 3, ((c >> 10) & 31) << 3, 255)
                if spx is not None and (c & 0x8000):
                    spx[xx, yy] = rgba
                else:
                    px[xx, yy] = rgba
        return im, semi_im


# ── per-stage extraction ─────────────────────────────────────────────────────
def record_sprite_ids(r: dict) -> set[int]:
    ids = {r["spriteId"]}
    # min..max is a SPRITE-id range only for mode 1 (F0x80089038 case 1 animates
    # the spriteId byte). Modes 2/3 animate the secondary counter instead
    # (palette-cycle style) -- their min..max are not sprite ids.
    if r["mode"] == 1 and r["max"]:
        ids.update(range(r["min"], r["max"] + 1))
    return ids


def extract_stage(disc: Disc, path: Path) -> tuple[dict, Image.Image | None, int] | None:
    stage = path.stem.replace("wstag", "s")
    pad_ids = pad_clip_ids(stage)
    stores = descriptor_stores(path)
    tables = sorted(set(stores.get(0x10, [])))
    if len(tables) > 1:
        print(f"  warn: {path.stem} has {len(tables)} distinct +0x10 tables, using first")

    buf = wstag_bytes(path)
    recs = parse_records(buf, tables[0] - WSTAG_BASE) if tables else []
    if not recs and not pad_ids and stage not in NATIVE_STAGES:
        # A native stage with no point table still draws through the shared
        # 0x1002 shape emitter (its own base-tick shape table, see
        # tools/extract_stage_overlay_shapes.py), so its FULL directory must be
        # cut even when the point table is empty — s375/s949 (Protocol Ruins)
        # hold no point records at all.
        return None  # no point-sprite table and no launch pads

    # Directory + atlas load lazily: a stage whose records are all FIELDCOM
    # sprites needs neither.
    tmpk = sorted(set(stores.get(0xC, [])))
    mask = sorted(set(stores.get(0x1C, [])))
    directory = atlas = None

    def cut_sprite(sid: int, ctr: int = 0) -> list[dict]:
        nonlocal directory, atlas
        if directory is None:
            if not tmpk:
                raise ValueError("no TMPK descriptor store")
            # handle = idx<<16 | sub: the low half picks which TMPK sub-entry
            # holds the sprite directory (usually 0; e.g. s963 uses 4).
            idx, sub = tmpk[0] >> 16, tmpk[0] & 0xFFFF
            directory = parse_tmpk_directory(pack_entries(disc.file(idx))[sub])
        frames, ids, clips = directory
        if sid not in ids:
            raise ValueError(f"spriteId {sid} not in ids table")
        if atlas is None:
            if not mask:
                raise ValueError("no MASK descriptor store")
            atlas = MaskAtlas(disc.file(mask[0]))
        clip = clips[ids.index(sid)]
        layers = []
        for fi, dx, dy in clip["layers"]:
            img, semi_img = atlas.cut(frames[fi], clip["clut_y_add"], ctr, clip["semi"])
            layers.append({"img": img, "semi_img": semi_img, "dx": dx, "dy": dy,
                           "semi": clip["semi"]})
        return layers

    # Cut every sprite each record needs; a record whose sprites can't be cut
    # (id not in the directory, palette row out of range, ...) is dropped
    # individually. Modes 2/3 additionally cycle the record's ctr byte through
    # min..max, which the PS1 draw adds to the CLUT row (palette flicker) --
    # cut those palette variants as extra "sid@ctr" sprites (fail-soft: a
    # missing variant row never drops the record, the base sprite stands in).
    sprites: dict[str, list[dict]] = {}
    bad_ids: dict[int, str] = {}
    kept: list[dict] = []
    dropped = 0
    for r in recs:
        if r["atlasFlag"] == 0xFF:
            kept.append(r)
            continue
        needed = record_sprite_ids(r)
        for sid in sorted(needed):
            if str(sid) not in sprites and sid not in bad_ids:
                try:
                    sprites[str(sid)] = cut_sprite(sid)
                except Exception as e:
                    bad_ids[sid] = str(e)
            if sid in bad_ids or r["mode"] not in (2, 3) or not r["max"]:
                continue
            for ctr in range(r["min"], r["max"] + 1):
                key = f"{sid}@{ctr}"
                if key in sprites:
                    continue
                try:
                    sprites[key] = cut_sprite(sid, ctr)
                except Exception:
                    pass  # variant row out of range -> renderer falls back to base
        if any(sid in bad_ids for sid in needed):
            dropped += 1
        else:
            kept.append(r)

    def key_used(key: str) -> bool:
        sid = int(key.split("@")[0])
        ctr = int(key.split("@")[1]) if "@" in key else None
        for r in kept:
            if r["atlasFlag"] == 0xFF or sid not in record_sprite_ids(r):
                continue
            if ctr is None or (r["mode"] in (2, 3) and r["min"] <= ctr <= r["max"]):
                return True
        return False

    for key in [k for k in sprites if not key_used(k)]:
        del sprites[key]

    # Native-interpreter stages (web/assets/native/manifest.json): the stage's
    # original MIPS ambience code drives records to ANY id in the TMPK sprite
    # directory (s780 lamp variants 10..25, car frames 50..55, ...) and issues
    # its own drawSprite calls — cut the ENTIRE directory for those stages so
    # the renderer can honor every native write.
    if (stage in NATIVE_STAGES or pad_ids) and tmpk:
        wanted = sorted(pad_ids) if stage not in NATIVE_STAGES else None
        try:
            if directory is None:
                idx, sub = tmpk[0] >> 16, tmpk[0] & 0xFFFF
                directory = parse_tmpk_directory(pack_entries(disc.file(idx))[sub])
            for sid in (directory[1] if wanted is None else wanted):
                if str(sid) not in sprites and sid not in bad_ids:
                    try:
                        sprites[str(sid)] = cut_sprite(sid)
                    except Exception as e:
                        bad_ids[sid] = str(e)
            # The idle colour pulse: the pad's base clip under the idle
            # script's CLUT-row offsets (fail-soft, as for the mode-2/3
            # variants — a missing row just leaves the base palette drawn).
            for base, ctrs in pad_palette_ctrs(stage).items():
                for ctr in ctrs:
                    key = f"{base}@{ctr}"
                    if key in sprites or base in bad_ids:
                        continue
                    try:
                        sprites[key] = cut_sprite(base, ctr)
                    except Exception:
                        pass
        except Exception as e:
            print(f"  warn: {path.stem} directory cut failed: {e}")
    if dropped and bad_ids:
        first = next(iter(bad_ids.items()))
        print(f"  part {path.stem}: dropped {dropped}/{len(recs)} records "
              f"(e.g. sprite {first[0]}: {first[1]})")
    recs = kept
    if not recs and not pad_ids and stage not in NATIVE_STAGES:
        return None

    tiles: list[tuple[str, int, Image.Image, Image.Image | None]] = []
    for sid, layers in sprites.items():
        for li, lay in enumerate(layers):
            img = lay.pop("img")
            semi_img = lay.pop("semi_img", None)
            lay["w"], lay["h"] = img.width, img.height
            tiles.append((sid, li, img, semi_img))

    # shelf-pack the sheet
    sheet = None
    semi_sheet = None
    if tiles:
        tiles.sort(key=lambda t: -t[2].height)
        sheet_w = 256
        x = y = shelf_h = 0
        for sid, li, img, _semi_img in tiles:
            if x + img.width > sheet_w:
                x, y, shelf_h = 0, y + shelf_h, 0
            sprites[sid][li]["x"], sprites[sid][li]["y"] = x, y
            x += img.width
            shelf_h = max(shelf_h, img.height)
        sheet = Image.new("RGBA", (sheet_w, y + shelf_h))
        for sid, li, img, _semi_img in tiles:
            sheet.paste(img, (sprites[sid][li]["x"], sprites[sid][li]["y"]))
        # The blended (STP) texels share the plain sheet's layout, so the
        # renderer draws the same rect from sNNN_semi.png under the ABR mode.
        if any(si is not None and si.getbbox() for _, _, _, si in tiles):
            semi_sheet = Image.new("RGBA", sheet.size)
            for sid, li, _img, semi_img in tiles:
                if semi_img is not None:
                    semi_sheet.paste(
                        semi_img, (sprites[sid][li]["x"], sprites[sid][li]["y"])
                    )

    for r in recs:
        r["atlas"] = "fieldcom" if r["atlasFlag"] == 0xFF else "stage"
    out = {"records": recs, "sprites": sprites, "hasSemi": semi_sheet is not None}
    if pad_ids:
        out["padSprites"] = sorted(i for i in pad_ids if str(i) in sprites)
        pal = {
            str(base): [c for c in ctrs if f"{base}@{c}" in sprites]
            for base, ctrs in pad_palette_ctrs(stage).items()
        }
        pal = {k: v for k, v in pal.items() if v}
        if pal:
            out["padPalettes"] = pal
    return out, sheet, semi_sheet, dropped


def main() -> None:
    disc = Disc(DISC)
    OUT_SHEETS.mkdir(parents=True, exist_ok=True)
    out: dict[str, dict] = {}
    skipped: list[str] = []
    n_dropped = 0
    for path in sorted(ASM.glob("wstag*.s")):
        stage = "s" + re.match(r"wstag(\d+)", path.stem).group(1)
        try:
            got = extract_stage(disc, path)
        except Exception as e:  # fail-soft: one bad stage never blocks the build
            print(f"  skip {stage}: {e}")
            skipped.append(stage)
            continue
        if got is None:
            continue
        data, sheet, semi_sheet, dropped = got
        if sheet is not None:
            sheet.save(OUT_SHEETS / f"{stage}.png")
        if semi_sheet is not None:
            semi_sheet.save(OUT_SHEETS / f"{stage}_semi.png")
        else:
            # A stage that used to have blended texels must not keep a stale
            # sheet once the extraction says it has none.
            stale = OUT_SHEETS / f"{stage}_semi.png"
            if stale.exists():
                stale.unlink()
        out[stage] = data
        n_dropped += dropped
    OUT_JSON.write_text(json.dumps(out, indent=1) + "\n")
    n_rec = sum(len(v["records"]) for v in out.values())
    print(f"point sprites: {len(out)} stages, {n_rec} records "
          f"({n_dropped} dropped) -> {OUT_JSON.name}; "
          f"{len(skipped)} stages skipped{': ' + ','.join(skipped) if skipped else ''}")


if __name__ == "__main__":
    main()
