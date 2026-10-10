#!/usr/bin/env python3
"""Extract the 3D-fight visual-effect system into web assets.

Decode log: docs/research/fight-3d/tech-effects-decode.md (2026-07-05).

Sources (all static data — no emulator):
  * fightstg overlay static tables (parsed from ~/ddw3/asm/dw2003/pro/fightstg.s words):
      - effect registry @0x800a2ea4: 8-byte {type:i16, texArchIdx:i16, (file<<16)|bin:u32},
        terminated by type == -1  → which program bin an op3 effect type runs
      - texture archives @0x800a2b74: 16-byte {(file<<16)|rlenBin (0=preloaded F-file),
        (file<<16)|dirBin, vramX, vramY} → sprite directory + atlas VRAM slot
      - op10 sound table @0x800a368c: u32 packed sound id per op10 effect type
  * effect pack bins (~/ddw3/pack/dw2003/fight/effect/<pack>/<n>.bin):
      - program bins: u32 offset dir (0-terminated, ≤30) → records
        {chanMask:u16, stride:u16, duration:u16, 9×u16 defaults} + per-frame masked u16s.
        Channels: 0 frame, 1 clutShift, 2 dx, 3 dy, 4 scaleX, 5 scaleY (0x1000=1.0,
        0 ⇒ skip draw), 6/7/8 color terms.
      - sprite dir bins: FIELDCOM format {frames_off, ids_off, clip_off[...]}, frames
        14 B {u,v,w,h,clut_x,clut_y,flags}
      - RLEN atlas bins (per-model packs)
  * F000COM1..4.BIN (~/ddw3/dw2003/AAA/DAT/FIGHT/) = common RLEN atlases, uploaded at
    VRAM (0x140,0x100) (0x1c0,0x100) (0x200,0x100) (0x240,0x100) by wfightmn states 2-5.
  * LBA file-id → name: ~/ddw3/rust/dw2003_exe_data/src/lba.rs

Output:
  web/assets/battle/effects/manifest.json   registry + programs + archive frame maps
  web/assets/battle/effects/arch<N>.png     one RGBA sheet per texture archive
"""
from __future__ import annotations
import os

import json
import re
import struct
import subprocess
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "web/assets/battle/effects"
FIGHTSTG = DDW3 / "asm/dw2003/pro/fightstg.s"
LBA_RS = DDW3 / "rust/dw2003_exe_data/src/lba.rs"
EFFECT_DIR = DDW3 / "pack/dw2003/fight/effect"
FIGHT_RAW = DDW3 / "dw2003/AAA/DAT/FIGHT"

REG_BASE = 0x800A2EA4
PROJ_BASE = 0x800A2550   # op6 projectile registry: 12-byte {id, (file<<16)|descBin, (file<<16)|metaBin}
TEXARCH_BASE = 0x800A2B74
SOUND_BASE = 0x800A368C
SOUND_END = 0x800A37F4  # descriptor block after the table

# F000COM uploads (wfightmn setup states 2-5)
FCOM_SLOTS = {1: (0x140, 0x100), 2: (0x1C0, 0x100), 3: (0x200, 0x100), 4: (0x240, 0x100)}

VRAM_W, VRAM_H = 1024, 512


def load_words() -> dict[int, int]:
    words = {}
    for line in FIGHTSTG.read_text().splitlines():
        m = re.match(r"\.L0x(800[89a-f][0-9a-f]{4}): \.word (0x[0-9a-f]+|\S+)", line)
        if m:
            v = m.group(2)
            words[int(m.group(1), 16)] = int(v, 16) if v.startswith("0x") else 0
    return words


def load_lba_names() -> dict[int, str]:
    names = {}
    for line in LBA_RS.read_text().splitlines():
        m = re.match(r"pub const LBA_(\w+)_(BIN|PRO)_IDX: usize = (\d+);", line)
        if m:
            names[int(m.group(3))] = m.group(1)
    return names


def pack_path(lba_names: dict[int, str], file_id: int, bin_idx: int) -> Path:
    name = lba_names[file_id]
    p = EFFECT_DIR / name.lower() / f"{bin_idx}.bin"
    if not p.exists():
        raise FileNotFoundError(f"{p} (file 0x{file_id:x} = {name})")
    return p


def unrlen(blob: bytes) -> bytes:
    if blob[:4] != b"RLEN":
        raise ValueError(f"bad RLEN magic {blob[:4]!r}")
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


def rlen_images(blob: bytes):
    """A texture bin = u32 offset dir (0-terminated) of RLEN images; each image may
    carry a small pre-header before the RLEN magic (skip to the magic)."""
    offs = []
    i = 0
    while True:
        (o,) = struct.unpack_from("<I", blob, i)
        if o == 0:
            break
        offs.append(o)
        i += 4
    imgs = []
    for o in offs:
        j = blob.find(b"RLEN", o)
        if j < 0 or j - o > 32:
            raise ValueError(f"no RLEN near offset 0x{o:x}")
        imgs.append(unrlen(blob[j:]))
    return imgs


class Vram:
    """15-bit VRAM model: halfword grid 1024x512."""

    def __init__(self):
        self.hw = bytearray(VRAM_W * VRAM_H * 2)

    def upload(self, data: bytes, x: int, y: int, w_hw: int = 64):
        """Upload a linear atlas (w_hw halfwords wide) at (x, y)."""
        rows = len(data) // (w_hw * 2)
        for r in range(rows):
            dst = ((y + r) * VRAM_W + x) * 2
            src = r * w_hw * 2
            self.hw[dst : dst + w_hw * 2] = data[src : src + w_hw * 2]

    def get(self, x: int, y: int) -> int:
        return struct.unpack_from("<H", self.hw, ((y % VRAM_H) * VRAM_W + (x % VRAM_W)) * 2)[0]


def parse_sprite_dir(blob: bytes):
    """Full FIELDCOM single-bin directory: frames + CLIPS. The effect programs' channel-0
    is a CLIP ID drawn via EXE F0x8001ed6c (the point-sprite/screen-pack draw), resolved
    through the ids byte table — NOT a raw frame index (root-caused 2026-07-05: basic
    attacks drew the green summon ring = frame 2 instead of clip id 2 = frame 34 spark)."""
    frames_off, ids_off = struct.unpack_from("<II", blob, 0)
    frames = [struct.unpack_from("<3H4h", blob, frames_off + i * 14)
              for i in range((ids_off - frames_off) // 14)]
    clip_offs = []
    i = 8
    while i < frames_off:
        (o,) = struct.unpack_from("<I", blob, i)
        if o == 0 or o >= len(blob):
            break
        clip_offs.append(o)
        i += 4
    ids = []
    j = ids_off
    while j < len(blob) and blob[j] != 0xFF and len(ids) < len(clip_offs):
        ids.append(blob[j])
        j += 1
    clips = []
    for o in clip_offs[: len(ids)]:
        count, cya = struct.unpack_from("<HH", blob, o)
        (semi,) = struct.unpack_from("<h", blob, o + 4)
        layers = []
        for k in range(count):
            if o + 6 + k * 6 + 6 > len(blob):
                break                                   # truncated trailing clip (some packs)
            layers.append(struct.unpack_from("<Hhh", blob, o + 6 + k * 6))
        clips.append({"clut_y_add": cya, "semi": semi, "layers": layers})
    return frames, ids, clips


def parse_program(blob: bytes):
    offs = []
    i = 0
    while i + 4 <= len(blob):
        (o,) = struct.unpack_from("<I", blob, i)
        if o == 0:
            break
        offs.append(o)
        i += 4
        if len(offs) >= 30:
            break
    recs = []
    for k, o in enumerate(offs):
        end = offs[k + 1] if k + 1 < len(offs) else len(blob)
        mask, stride, duration = struct.unpack_from("<3H", blob, o)
        defaults = list(struct.unpack_from("<9h", blob, o + 6))
        nchan = bin(mask & 0x1FF).count("1")
        fdata = blob[o + 24 : end]
        frames = []
        if stride and nchan:
            per = stride * 2
            n = min(len(fdata) // per, duration + 1 if duration else len(fdata) // per)
            for f in range(n):
                vals = list(struct.unpack_from(f"<{nchan}h", fdata, f * per))
                frames.append(vals)
        recs.append(
            {
                "mask": mask,
                "stride": stride,
                "duration": duration,
                "defaults": defaults,
                "frames": frames,
            }
        )
    return recs


def rgb5(p: int):
    return ((p & 31) << 3, ((p >> 5) & 31) << 3, ((p >> 10) & 31) << 3, p)


def cut_frame(vram: Vram, page_x: int, page_y: int, frame, clut_shift: int = 0,
              split_stp: bool = False):
    """Cut one FIELDCOM frame from VRAM. 4bpp unless flags say 8bpp (bit semantics as
    in the field point-sprite decode). u is in texels; texpage x is in halfwords.

    `split_stp` returns (blended, solid) instead of one image. Inside a semi-transparent
    primitive the PS1 blends only those texels whose palette entry has bit 15 (STP) set; a
    texel with the bit clear is drawn SOLID even though the primitive is semi-transparent.
    Six shipped sprite frames rely on it, five of them for a third to a half of their area -
    E144ROSE's 128x128 petal is the clearest: indices 1-8 and 11 are the bright greens with
    STP clear (the solid body) and 9, 10, 12-14 the darker greens with STP set (the blended
    trailing edge). Pass it only for a clip that is actually blended; an opaque clip draws
    every texel solid and the split would be meaningless."""
    u, v, w, h, cx, cy, fl = frame
    is8 = bool(fl & 0x1)
    img = Image.new("RGBA", (max(w, 1), max(h, 1)), (0, 0, 0, 0))
    solid = Image.new("RGBA", (max(w, 1), max(h, 1)), (0, 0, 0, 0)) if split_stp else None
    put = img.putpixel
    put_solid = solid.putpixel if solid is not None else None
    # CLUT: rows relative to the atlas' own VRAM slot (art stores palettes in-image).
    crow = page_y + ((cy + clut_shift) & 0xFF)
    pal, stp = [], []
    for i in range(256 if is8 else 16):
        p = vram.get(page_x + cx + i, crow)
        r, g, b, raw = rgb5(p)
        pal.append((r, g, b, 0 if raw == 0 else 255))
        stp.append(bool(raw & 0x8000))
    for yy in range(h):
        for xx in range(w):
            if is8:
                halfw = vram.get(page_x + (u + xx) // 2, page_y + v + yy)
                idx = (halfw >> (8 * ((u + xx) % 2))) & 0xFF
            else:
                halfw = vram.get(page_x + (u + xx) // 4, page_y + v + yy)
                idx = (halfw >> (4 * ((u + xx) % 4))) & 0xF
            if solid is not None and pal[idx][3] and not stp[idx]:
                put_solid((xx, yy), pal[idx])
            else:
                put((xx, yy), pal[idx])
    return (img, solid) if split_stp else img


def decode_ctrl(blob: bytes):
    """Decode a MEFT `0x10` ctrl bin (layer animation; fightstg F0x800835f4).

    Header = u32 offsets[4]; the per-frame applier samples sub-tracks 0/1/2 into the
    layer block at +0x10/+0x18/+0x20 = TRANSLATION / ROTATION / SCALE. Each track is
    8-byte keyframes {i16 x, i16 y, i16 z, u16 frame}; frame 30000 = hold sentinel.
    Between keyframes the values are lerped (GTE fixed-point in the original). Units:
    translation = PS1 world units, rotation = PS1 angles (4096 = 360°), scale
    0x1000 = 1.0 (a layer whose |sx|+|sy|+|sz| < 0x31 is skipped — the hide state).
    Returns {"t": [[frame,x,y,z]...], "r": [...], "s": [...]} or None."""
    if len(blob) < 16:
        return None
    offs = struct.unpack_from("<4I", blob, 0)
    if offs[0] != 0x10:
        return None
    names = ("t", "r", "s")
    out = {}
    for ti, name in enumerate(names):
        o, end = offs[ti], min(offs[ti + 1] if ti + 1 < 4 else len(blob), len(blob))
        keys = []
        while o + 8 <= end:
            x, y, z, f = struct.unpack_from("<3hH", blob, o)
            keys.append([f, x, y, z])
            o += 8
            if f >= 30000:
                break
        out[name] = keys
    return out


def decode_clip(blob: bytes):
    """Decode a projectile pack's META bin: the effect's playback CLIP.

    This is the second bin named in the op6 registry row. FIGHTSTG_F0x8008970c puts it in
    the animator at +0x58, and FIGHTSTG_F0x80083a54 compiles it into a per-tick stream of
    frame numbers, which FIGHTSTG_F0x80083c30 then walks one entry per tick to decide which
    frame the layer tracks are sampled at -- and, when it walks off the end, to end the
    effect.

    Layout: a u32 directory (one offset per clip; every shipped pack has exactly one, at
    offset 4), then 8-byte records of four i16 {prevLast, count, first, last}. The stream is
    terminated by a record whose first field is 0x7fff.

    The compiler has two record forms, distinguished by `last`:
      * last != 0 -- a plain ramp: emit `count` entries holding frames first .. first+count-1.
      * last == 0 with count != 0 -- an interpolating hold, which emits `count` entries with
        bit 15 set and a 12-bit fraction. NO SHIPPED PACK USES THIS (0 records across all
        129), so it is reported rather than guessed at.
      * count == 0 -- the terminal record: one entry holding `first`, then the stream stops.
        `first` is 0xffff (end) in every shipped pack; 0x8000 would mean loop back instead.

    A segment may REPLAY an earlier frame range: packs 108 and 109 (Positron Laser) run
    frames 36..80 four times over, which is what sustains the beam.

    Returns {"segments": [[first, count], ...], "end": <terminal value>, "ticks": <n>} or
    None. `ticks` counts the terminal entry, matching the compiled stream length the
    original stores at animator+0xa0."""
    if len(blob) < 12:
        return None
    off = struct.unpack_from("<I", blob, 0)[0]
    if off < 4 or off >= len(blob):
        return None
    segments, end, o = [], None, off
    while o + 8 <= len(blob):
        prev, count, first, last = struct.unpack_from("<hhHh", blob, o)
        if prev == 0x7FFF:
            break
        if count == 0:
            end = first
            break
        if last == 0:
            print(f"    clip: interpolating record (count={count}) is not decoded - skipped")
            return None
        segments.append([first, count])
        o += 8
    if not segments or end is None:
        return None
    return {"segments": segments, "end": end,
            "ticks": sum(count for _first, count in segments) + 1}


PORT_MESH_TOOL = REPO / "tools/decode_fight_mesh_dl.mjs"


def decode_mesh(path: Path) -> dict:
    """Decode a MEFT `0x18` mesh body THROUGH THE PORTED DISPLAY-LIST LOOP.

    The display-list walk this tool used to hand-write (the `sec2` GTE opcode
    grammar) is FIGHTSTG_F0x80085110, ported once in
    engine/dw3/battle-displaylist.ts. It is no longer decoded here: the body is
    handed to `tools/decode_fight_mesh_dl.mjs`, which runs that port over the raw
    `sec2` bytes and returns the vertices, the raw display list (`dl`, so the
    shipped geometry carries the exact bytes the port needs at runtime) and the
    primitives (idx / uv / abr / clut / textured / color) the port computes.

    A `0x18` body is a u32 section table, a vertex block (sec0: i16 count, 2 pad,
    count x SVECTOR), a normals block (sec1) and the display list (sec2). sec1 is
    the node's normal records FIGHTSTG_F0x800847f4 shades (i16 count, then 6-byte
    SVECTOR records): it is returned as `normals` and shipped on each layer so the
    ported colour path can be fed. The port
    reads the list exactly as before — 0x8n..0xEn state sets, a 0x01 descriptor
    (its cursor[1..3] are the UV bases and cursor[4..5] the CLUT), 0x02..0x05
    colour packets and 0x00 mesh emissions ending at the 0xff terminator.
    """
    out = subprocess.run(
        ["node", str(PORT_MESH_TOOL), str(path)],
        capture_output=True, check=True,
    )
    return json.loads(out.stdout)


def _page_raw(blob: bytes) -> bytes:
    return unrlen(blob[blob.find(b"RLEN"):])[20:]


def _clut_entries(raw: bytes, clut_xy) -> list:
    W_HW = 64
    return [struct.unpack_from("<H", raw, ((clut_xy[1] * W_HW) + clut_xy[0] + k) * 2)[0]
            for k in range(16)]


def _palette_score(cl: list) -> float:
    """How 'real palette' a 16-entry CLUT looks. The genuine fight-effect palettes are a
    smooth ABGR1555 ramp with the STP bit set; garbage CLUT positions (pixel data read as a
    palette) jump around. Score = monotone-ish steps + STP coverage + variety."""
    if len(set(cl)) < 4:
        return -1                                       # all-same (e.g. the 0xffff fill row)
    nz = [c & 0x7FFF for c in cl if c]
    mono = sum(1 for i in range(1, len(nz)) if nz[i] >= nz[i - 1])
    stp = sum(1 for c in cl if c & 0x8000)
    return mono + stp * 0.5 + len(set(cl)) * 0.25


def clut_is_live(raw: bytes, clut_xy) -> bool:
    """Is there a palette at this slot, or is it the 0xffff fill?

    The test is exactly "not the fill row". An earlier version of this demanded four distinct
    entries, borrowing the threshold from `_palette_score`, and that was wrong: 1,181
    primitives across 20 packs name a SMALL but perfectly real palette — 1,149 with two
    distinct entries, 16 with three, 16 with one — and were being pushed onto the best-ramp
    fallback. MEFT0089 layer 1 is the clearest: its slot holds {0x958c, then 0x0000 fifteen
    times}, a one-colour stencil where index 0 is the ink and every other index is
    transparent. Nothing in the 129 shipped packs names a slot that is actually all 0xffff,
    so on this data the fallback never fires."""
    return set(_clut_entries(raw, clut_xy)) != {0xFFFF}


def best_clut(raw: bytes, candidates) -> tuple:
    """Fallback only. The mesh tex-op's CLUT bytes ARE the palette selector (see the
    per-primitive CLUT note in main), so this is used solely for a primitive whose named slot
    holds the 0xffff fill: score the standard embedded-palette slots and take the best ramp."""
    cands = set(candidates)
    for y in (255, 254):
        for x in (0, 16, 32, 48):
            cands.add((x, y))
    return max(cands, key=lambda c: _palette_score(_clut_entries(raw, c)))


def decode_atlas(blob: bytes, clut_xy=(16, 255)):
    """MEFT fight-effect texture bin → 256×256 RGBA. `{u32 tag, [sizehint], RLEN}` → 20-byte
    header + a 4bpp indexed VRAM page (64 halfwords = 256px wide, 256 tall; all 129 packs
    carry the identical header). CLUT = 16 ABGR1555 entries at (halfword x, y).

    Transparency is the PS1 rule — a texel is transparent when its CLUT ENTRY is 0x0000, not
    when its index is 15. Both halves of that mattered:

      * Index 0 is the background. It is 29.4% of all texels inside the rectangles the meshes
        actually sample, and entry 0 is 0x0000 in 322 of the 476 live palettes. It used to be
        baked as opaque BLACK, which is invisible under an additive blend and therefore went
        unnoticed — until the nibble-0 primitives were correctly drawn opaque.
        (This line read "entry 0 is 0x0000 in every real palette here" until 2026-08-17. That
        universal was false: 154 of the 476 have a non-zero entry 0. Never infer transparency
        from the INDEX being 0 — the rule is the `cl[idx] == 0` test below, and it is the whole
        reason this function does not special-case any index. Claim
        fx-mesh-palette-entry-zero-count-corrected-2026-08-17.)
      * Index 15 is the brightest step of the ramp, 7.7% of sampled texels. It used to be
        punched out as transparent, which deleted the highlight core of every effect.

    The 89% index-15 figure over the WHOLE page is the unused remainder of the 256x256 page,
    filled with 0xffff halfwords; no mesh samples it, so what is baked there is immaterial."""
    raw = _page_raw(blob)
    W_HW = 64
    cl = _clut_entries(raw, clut_xy)
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    px = img.load()
    for y in range(256):
        for xhw in range(W_HW):
            hw = struct.unpack_from("<H", raw, (y * W_HW + xhw) * 2)[0]
            for nib in range(4):
                idx = (hw >> (4 * nib)) & 0xF
                r, g, b, _ = rgb5(cl[idx])
                px[xhw * 4 + nib, y] = (r, g, b, 0 if cl[idx] == 0 else 255)
    return img


def main() -> int:
    words = load_words()
    lba = load_lba_names()

    def w(addr):
        return words.get(addr, 0)

    # --- registry ---
    registry = {}
    addr = REG_BASE
    while True:
        w0, w1 = w(addr), w(addr + 4)
        t = w0 & 0xFFFF
        if t == 0xFFFF:
            break
        registry[t] = {"arch": (w0 >> 16) & 0xFFFF, "file": w1 >> 16, "bin": w1 & 0xFFFF}
        addr += 8
    print(f"registry: {len(registry)} effect types (end @0x{addr:x})")

    # --- texture archives ---
    arch_max = max(r["arch"] for r in registry.values())
    archives = {}
    for a in range(arch_max + 1):
        base = TEXARCH_BASE + a * 16
        w0, w1, vx, vy = w(base), w(base + 4), w(base + 8), w(base + 12)
        if w1 == 0:
            continue
        archives[a] = {
            "rlen_file": w0 >> 16, "rlen_bin": w0 & 0xFFFF,
            "dir_file": w1 >> 16, "dir_bin": w1 & 0xFFFF,
            "vram_x": vx, "vram_y": vy,
        }
    print(f"archives: {len(archives)}")

    # --- op6 projectile registry (12-byte {id, (file<<16)|descBin, (file<<16)|metaBin}) ---
    # descBin = 5×u32 {atlasBin, dirBin, ?, progBin, count} inside the SAME pack: the
    # projectiles reuse the sprite-program system with a self-contained MEFT00xx pack.
    projectiles = {}
    addr = PROJ_BASE
    while True:
        pid = w(addr)
        if pid == 0:
            break
        w1, w2 = w(addr + 4), w(addr + 8)
        projectiles[pid] = {"file": w1 >> 16, "desc_bin": w1 & 0xFFFF, "meta_bin": w2 & 0xFFFF}
        addr += 12
    print(f"projectiles: {len(projectiles)} (end @0x{addr:x})")

    # --- op10 sound table ---
    sounds = {}
    addr = SOUND_BASE
    t = 0
    while addr < SOUND_END:
        sounds[t] = w(addr)
        addr += 4
        t += 1

    # --- VRAM: upload common F-files + per-model RLENs ---
    vram = Vram()
    for n, (x, y) in FCOM_SLOTS.items():
        blob = (FIGHT_RAW / f"F000COM{n}.BIN").read_bytes()
        for img in rlen_images(blob):
            vram.upload(img[20:] if img[:4] != b"" else img, x, y)
            break  # first image at the slot; extras handled if seen
    # Per-model archives share VRAM slots (0x300/0x380 …) — in the real game only the
    # current battle's packs are resident. Upload each archive's RLEN right before
    # cutting its frames (inside the sheet loop below), not all up front.

    # --- programs ---
    types_out = {}
    for t, r in sorted(registry.items()):
        try:
            blob = pack_path(lba, r["file"], r["bin"]).read_bytes()
        except FileNotFoundError as e:
            print(f"  type {t}: MISSING {e}")
            continue
        types_out[str(t)] = {
            "arch": r["arch"],
            "file": lba.get(r["file"], hex(r["file"])),
            "bin": r["bin"],
            "records": parse_program(blob),
        }

    # --- per-clip CLUT-shift usage (channel 1 = the sid@ctr palette-cycling of the
    # field point-sprite system).  This must be tracked jointly with channel 0:
    # E000EVOL uses shifts 0..12 across the archive, but any one clip uses only a
    # small subset.  Taking the archive-wide cross product produced a 58K-high
    # arch06 sheet that exceeded browser image limits and obscured the real DNA
    # type-1003 orb program.
    arch_clip_shifts: dict[int, dict[int, set[int]]] = {}
    for t, r in types_out.items():
        by_clip = arch_clip_shifts.setdefault(r["arch"], {})
        for rec in r["records"]:
            chans = rec["defaults"].copy()
            rows = rec["frames"] or [[]]
            for row in rows:
                k = 0
                for c in range(9):
                    if rec["mask"] & (1 << c):
                        if k < len(row):
                            chans[c] = row[k]
                        k += 1
                by_clip.setdefault(chans[0] & 0xFF, set()).add(chans[1] & 0xFF)

    # --- sprite sheets per archive ---
    OUT.mkdir(parents=True, exist_ok=True)
    arch_out = {}
    for a, rec in sorted(archives.items()):
        if rec["rlen_file"]:
            blob = pack_path(lba, rec["rlen_file"], rec["rlen_bin"]).read_bytes()
            vram.upload(rlen_images(blob)[0][20:], rec["vram_x"], rec["vram_y"])
        stp_solid = {}
        dir_blob = pack_path(lba, rec["dir_file"], rec["dir_bin"]).read_bytes()
        frames, ids, clips = parse_sprite_dir(dir_blob)
        # Compose each CLIP (layers back-to-front at their dx/dy) once per used CLUT shift
        # (shift adds to the clip's clut_y_add at draw time — palette cycling/recolor).
        comps = {}   # (clipIdx, shift) -> (img, ox, oy, semi, solid|None)
        for ci, clip in enumerate(clips):
            cid = ids[ci] if ci < len(ids) else None
            shifts = sorted(arch_clip_shifts.get(a, {}).get(cid, {0}) | {0})
            # `semi` is a ZERO-based ABR mode with -1 meaning "not semi-transparent"
            # (the shipped values are -1/0/1/2/3), so the per-texel STP bit is consulted
            # exactly when semi >= 0. An opaque clip draws every texel solid.
            blended = clip["semi"] >= 0
            for shift in shifts:
                lay = []
                for fi, dx, dy in clip["layers"]:
                    if fi >= len(frames):
                        continue
                    try:
                        cut = cut_frame(vram, rec["vram_x"], rec["vram_y"], frames[fi],
                                        clip["clut_y_add"] + shift, split_stp=blended)
                    except Exception:
                        continue
                    lay.append((cut if blended else (cut, None), dx, dy))
                if not lay:
                    continue
                x0 = min(dx for _, dx, _ in lay)
                y0 = min(dy for _, _, dy in lay)
                x1 = max(dx + pair[0].width for pair, dx, _ in lay)
                y1 = max(dy + pair[0].height for pair, _, dy in lay)
                size = (max(x1 - x0, 1), max(y1 - y0, 1))
                comp = Image.new("RGBA", size)
                solid = Image.new("RGBA", size) if blended else None
                for (im, sim), dx, dy in lay:
                    comp.alpha_composite(im, (dx - x0, dy - y0))
                    if solid is not None and sim is not None:
                        solid.alpha_composite(sim, (dx - x0, dy - y0))
                # Keep the solid half only when it holds something: 6 shipped frames do.
                if solid is not None and not solid.getbbox():
                    solid = None
                comps[(ci, shift)] = (comp, x0, y0, clip["semi"], solid)
        # shelf-pack the composites, the solid halves alongside them
        SHEET_W = 512
        x = y = shelf = 0
        pos = {}
        boxes = [(k, comps[k][0], False) for k in comps]
        boxes += [((k, "solid"), comps[k][4], True) for k in comps if comps[k][4] is not None]
        for k, im, _ in sorted(boxes, key=lambda b: -b[1].height):
            if x + im.width > SHEET_W:
                x, y, shelf = 0, y + shelf, 0
            pos[k] = (x, y)
            x += im.width
            shelf = max(shelf, im.height)
        sheet = Image.new("RGBA", (SHEET_W, max(y + shelf, 1)))
        clip_out = {}
        for (ci, shift), (comp, ox, oy, semi, solid) in comps.items():
            cid = ids[ci] if ci < len(ids) else None
            if cid is None:
                continue
            px, py = pos[(ci, shift)]
            sheet.paste(comp, (px, py))
            key = str(cid) if shift == 0 else f"{cid}@{shift}"
            if solid is not None:
                sx, sy = pos[((ci, shift), "solid")]
                sheet.paste(solid, (sx, sy))
                stp_solid[key] = {"x": sx, "y": sy, "w": solid.width, "h": solid.height}
            clip_out[key] = {"x": px, "y": py, "w": comp.width, "h": comp.height,
                             "ox": ox, "oy": oy, "semi": semi}
            if key in stp_solid:
                # The texels the PS1 draws SOLID inside this blended clip, packed into the
                # same sheet. The two halves occupy disjoint texels, so draw order between
                # them does not matter.
                clip_out[key]["solid"] = stp_solid.pop(key)
        name = f"arch{a:02d}"
        sheet.save(OUT / f"{name}.png")
        arch_out[str(a)] = {
            "sheet": f"{name}.png",
            "clips": clip_out,
            "dir": f"{lba.get(rec['dir_file'])}/{rec['dir_bin']}",
        }
        print(f"  arch {a}: {len(ids)} clips / {len(frames)} frames -> {name}.png {sheet.size}")

    # --- op6 projectile packs: MEFT 3D mesh projectiles ---
    # descBin = the MEFT program table {texIdx, count, count×(parentIdx, meshIdx, ctrlIdx)}.
    # The row's FIRST u32 is the layer's PARENT INDEX, not a zero pad: the animator ctor
    # FIGHTSTG_F0x80084560 allocates count+1 layer blocks of 0x84 bytes (`$s4 = count+1`,
    # `(count+1)*0x21*4`) and copies each row's three words to layer[i]+0x00/+0x04/+0x08 for
    # i = 1..count, so layer 0 is an implicit ROOT with no mesh and no ctrl bin, whose parent
    # matrix pointer is the fixed identity D0x8004dc20. Per frame FIGHTSTG_F0x80083e0c reads
    # layer[i]+0x00, scales it by 0x84 and adds 0x4c to point layer[i]+0x48 at the PARENT's
    # concatenated matrix. 184 of the 572 shipped rows name a non-root parent, so dropping
    # this field flattens the hierarchy. Emitted below as `parent` (0 = the root node, which
    # carries op6's from/to) with the 1-based game index as `idx`.
    # Each
    # layer's meshIdx is a `0x18` mesh (verts + GTE display list, decode_mesh) whose prims
    # carry a per-layer CLUT (x,y) from the tex-op; texIdx is a shared 4bpp indexed 256×256
    # VRAM page. We bake one RGBA atlas per distinct CLUT (decode_atlas) and emit geometry +
    # absolute (0..255) UVs. ctrlIdx is the layer's animation ctrl bin (decode_ctrl):
    # keyframed translation/rotation/scale tracks — the projectile's travel is authored
    # in the translation track (fightstg F0x800835f4), not computed by the flight object.
    proj_dir = OUT / "proj"
    proj_dir.mkdir(exist_ok=True)
    proj_out = {}
    baked = {}                                          # (file, tex_idx, clut) -> atlas png name
    fallback_prims = [0]   # primitives whose named CLUT slot held the 0xffff fill
    for pid, pr in sorted(projectiles.items()):
        fname = lba.get(pr["file"], hex(pr["file"]))
        try:
            desc = pack_path(lba, pr["file"], pr["desc_bin"]).read_bytes()
            tex_idx, count = struct.unpack_from("<2I", desc, 0)
            table = [struct.unpack_from("<3I", desc, 8 + k * 12) for k in range(count)
                     if 8 + k * 12 + 12 <= len(desc)]
            tex_blob = pack_path(lba, pr["file"], tex_idx).read_bytes()
            page = _page_raw(tex_blob)
            layers = []
            for row, (parent_idx, mesh_idx, ctrl_idx) in enumerate(table, start=1):
                mesh = decode_mesh(pack_path(lba, pr["file"], mesh_idx))
                tprims = [p for p in mesh["prims"] if p.get("uv")]
                # A layer with no textured prim still has to be emitted: it may be the PARENT
                # of one that draws, and dropping it would break the `parent` indices below.
                # (No shipped layer currently hits this — 572 rows in, 572 layers out.)
                #
                # The tex-op's CLUT bytes are the palette selector, PER PRIMITIVE. They are a
                # VRAM position offset by the mesh object's own palette base, which
                # FIGHTSTG_F0x8008610c takes as its two arguments and stores at mesh+0x70 and
                # +0x74; for every op6 projectile that base is (640, 256), the same pair the
                # flight object holds at +0x6c/+0x70. The pack's 4bpp page is loaded at that
                # very origin and spans VRAM x 640..703, y 256..511, so a CLUT at
                # (640 + byte4, 256 + byte5) lands inside the page's own last rows and the
                # base cancels: the raw bytes ARE page-local coordinates. Pack 39 proves the
                # point — its page holds exactly three palettes, at row 255 x 0/16/32, and its
                # three groups of layers name exactly those three.
                #
                # A layer may name more than one palette across its primitives (183 of the 572
                # do), so the atlas is chosen per primitive and the walker groups a layer's
                # primitives by palette at draw time.
                atlas_of = {}
                for p in tprims:
                    clut = tuple(p["clut"])
                    if not clut_is_live(page, clut):
                        # The named slot holds the 0xffff fill. Fall back to the page's best
                        # ramp rather than baking a single-colour atlas, and count it.
                        clut = best_clut(page, [tuple(q["clut"]) for q in tprims])
                        fallback_prims[0] += 1
                    p["clut"] = list(clut)
                    key = f"{clut[0]}_{clut[1]}"
                    if key not in atlas_of:
                        bkey = (fname, tex_idx, clut)
                        name = baked.get(bkey)
                        if name is None:
                            name = f"{fname}_{tex_idx}_{clut[0]}_{clut[1]}.png"
                            decode_atlas(tex_blob, clut).save(proj_dir / name)
                            baked[bkey] = name
                        atlas_of[key] = name
                # `tex` stays the atlas of the layer's commonest palette so a consumer that
                # does not group by palette still draws something sane.
                clut = tuple(tprims[0]["clut"]) if tprims else (0, 0)
                if tprims:
                    common = Counter(tuple(p["clut"]) for p in tprims).most_common(1)[0][0]
                    clut = common
                atlas_name = atlas_of.get(f"{clut[0]}_{clut[1]}")
                tracks = decode_ctrl(pack_path(lba, pr["file"], ctrl_idx).read_bytes())
                layers.append({"idx": row, "parent": parent_idx,
                               "mesh_bin": mesh_idx, "ctrl_bin": ctrl_idx,
                               "tex": atlas_name, "clut": list(clut),
                               "tex_by_clut": atlas_of,
                               "verts": mesh["verts"], "prims": tprims,
                               "dl": mesh["dl"],
                               "normals": mesh["normals"],
                               "tracks": tracks})
            clip = decode_clip(pack_path(lba, pr["file"], pr["meta_bin"]).read_bytes())
            entry = {"file": fname, "tex_size": [256, 256], "clip": clip, "layers": layers}
            (proj_dir / f"{pid}.json").write_text(json.dumps(entry))
            # dur = last authored keyframe across all tracks (30000 = hold sentinel, excluded).
            # This is NOT the effect's lifetime -- it is only how far the layer tracks were
            # authored. The lifetime is the compiled CLIP stream (`ticks`), which walks off
            # its terminator and ends the flight. The two disagree for 17 of the 129 packs:
            # some tracks are authored past the clip's end and some clips outlive their
            # tracks, and packs 108/109 replay a segment so their stream is far longer than
            # any keyframe. `dur` is kept only as the fallback for a pack whose clip fails
            # to decode.
            dur = 0
            for lay in layers:
                for keys in (lay["tracks"] or {}).values():
                    for k in keys:
                        if k[0] < 30000:
                            dur = max(dur, k[0])
            proj_out[str(pid)] = {"file": fname, "tex_bin": tex_idx, "dur": dur,
                                  "ticks": (clip or {}).get("ticks", 0),
                                  "clip": clip,
                                  "layers": [{"parent": p, "mesh": m, "ctrl": c}
                                             for p, m, c in table]}
        except Exception as e:
            print(f"  projectile {pid}: SKIP ({e})")
    print(f"projectiles: {len(proj_out)} entries, {len(baked)} atlases, meshes in {proj_dir}")
    print(f"  primitives falling back to the best-ramp palette: {fallback_prims[0]}")

    manifest = {"types": types_out, "archives": arch_out, "op10_sounds": sounds,
                "projectiles": proj_out}
    (OUT / "manifest.json").write_text(json.dumps(manifest))
    print(f"wrote {OUT/'manifest.json'} ({len(types_out)} types)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
