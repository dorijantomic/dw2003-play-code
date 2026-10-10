#!/usr/bin/env python3
"""Decode the SHAPE SET every member of the two-pass annotator family draws from.

The family (fifteen stage overlays, the census in
`tools/annotator_census.py`) reaches the resident 2D draw-context service's
emitter `F0x8001ED6C` (`exe/fns.s:16377`) with

    lw   $a0, -0x6274($v0)      # 0x80049D8C = the resident field object's +0x0C
    lw   $v0, 0x4f5c($v0)       # 0x80044F5C = F0x800140D8
    jalr $v0                    # -> the shape set
    lh   $a1, 4($s0)            # the shape id (wstag805.s:914), or 0($s3) on s820

`F0x800140D8` (`exe/fns.s:4602-4616`) splits the handle it is given as
`resource = arg >> 16`, `member = arg & 0xffff` and returns
`base + *(u32 *)(base + member * 4)`, so the handle names a PACK MEMBER.  Every
overlay's field-config stub stores `lui $v0, <resource>` at the field object's
`+0x0C` (wstag820.s:704-708, wstag805.s:932-936), whose low half is zero, and
`tools/extract_annotator_tables.py` lifts those fifteen ids into
`ANNOTATOR_SHAPE_SETS`.

**That member is the stage's own TMPK sprite directory, member 0** -- the same
one the ambient point sprites and the launch pads read
(`docs/research/field/point-sprite-ambient-system.md` §"sprite directory"), and
this tool re-derives it from the extracted pack tree with nothing hand-copied:

    header   n words:  [0] frame-table offset, [1] id-list offset,
                        [2 + i] clip i's offset
    frames   14 bytes: {u16 u, v, w, h, clut_x, clut_y, flags}  (flags bit0:
                        1 = 8bpp, 0 = 4bpp)
    ids      bytes, 0xFF-terminated, one per clip
    clips    {u16 layer_count, u16 clut_y_add, s16 semi,
              layers x {u16 frame, s16 dx, s16 dy}}

The header is the pack's own offset table (`~/ddw3/tools/ddw3-pack/src/lib.rs`:
a pack member is `n` ascending u32 offsets followed by the members' bytes), so
reassembling it from the extracted `<member>/<n>.bin` files reproduces the disc
bytes exactly.  Three independent facts pin the reading, all of them checked
below and none of them assumed:

  * header[0] == 4 * n, i.e. the frame table starts where the header ends;
  * header[1] == the id list's offset and the bytes there rise and stop at 0xFF;
  * the ids are the ones the overlays ask for: s820's four children draw 44 and
    60..67 and its id list is 0x2c..0x43; s805's disc walk returns 42..45 and
    its list ends 0x2a, 0x2b, 0x2c, 0x2d.

The frame layout is the point-sprite system's, byte-verified against the art in
that document (s420's windmill blades: `u,v` = 0/60 and 0/74, 60x74).

    usage: tools/extract_annotator_shapes.py [--check] [--json STAGE]
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import struct
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
PACK = pathlib.Path.home() / "ddw3/pack/dw2003/field/stage"
LBA_RS = pathlib.Path.home() / "ddw3/rust/dw2003_exe_data/src/lba.rs"
OUT = REPO / "engine/dw3/annotator-shapes.ts"
TABLES = REPO / "engine/dw3/annotator-tables.ts"

FRAME_STRIDE = 14
LAYER_STRIDE = 6


def lba_index() -> dict[int, str]:
    """`{file index: 'S820TMPK_BIN'}` from the decompilation's own table."""
    out: dict[int, str] = {}
    for line in LBA_RS.read_text().splitlines():
        m = re.match(r"pub const (\w+): usize = (\d+);", line)
        if m:
            out[int(m.group(2))] = m.group(1)
    return out


def shape_set_ids() -> dict[str, int]:
    """`{'s820': 0x715, ...}` from the generated overlay table."""
    block = TABLES.read_text().split("ANNOTATOR_SHAPE_SETS")[1]
    return {
        m.group(1): int(m.group(2), 16)
        for m in re.finditer(r'"(s\d+)": \{ resource: 0x([0-9A-F]+)', block)
    }


def pack_member(stage: str, sub: int) -> tuple[bytes, list[int], list[int]]:
    """`S<stage>TMPK` member `sub`, rebuilt from the extracted sub-bins.

    Returns `(bytes, offsets, sizes)`.  The extracted tree
    (`s<stage>tmpk/<sub>/<i>.bin`) is the unpacked form: the pack's own header
    is not on disk, so it is rebuilt from the member sizes.  The rebuilt header's
    length is then checked against `header[0]` below, which is an independent
    confirmation that it is right rather than merely plausible.
    """
    d = PACK / f"{stage}tmpk" / str(sub)
    if not d.is_dir():
        raise SystemExit(f"{stage}: no tmpk member {sub} at {d}")
    bins = sorted(d.glob("*.bin"), key=lambda f: int(f.stem))
    if not bins:
        raise SystemExit(f"{stage}: tmpk member {sub} is empty")
    if [int(b.stem) for b in bins] != list(range(len(bins))):
        raise SystemExit(f"{stage}: member {sub} bins are not 0..n-1")
    offs, cur, sizes = [], len(bins) * 4, []
    for b in bins:
        offs.append(cur)
        cur += b.stat().st_size
        sizes.append(b.stat().st_size)
    blob = struct.pack(f"<{len(bins)}I", *offs) + b"".join(b.read_bytes() for b in bins)
    return blob, offs, sizes


def decode(stage: str, resource: int) -> dict:
    blob, offs, sizes = pack_member(stage, 0)
    frames_at, ids_at = struct.unpack_from("<2I", blob, 0)
    n = len(offs)
    if frames_at != 4 * n:
        raise SystemExit(
            f"{stage}: frame table at 0x{frames_at:x}, rebuilt header is 0x{4 * n:x}")
    if ids_at != offs[1] or sizes[0] % FRAME_STRIDE > 2:
        raise SystemExit(
            f"{stage}: id list at 0x{ids_at:x} is not member 1 (0x{offs[1]:x}), "
            f"or the frame table length {sizes[0]} is not /{FRAME_STRIDE}")
    clips = n - 2
    ids: list[int] = []
    for byte in blob[ids_at:offs[2]]:
        # 0xFF ends the list, and the clip count bounds it too: the emitter walks
        # the list until it finds the id it wants (exe/fns.s:16391-16400) and a
        # longer list would let it read a clip record as an id.
        if byte == 0xFF or len(ids) >= clips:
            break
        ids.append(byte)
    out_clips: dict[int, dict] = {}
    for i, sid in enumerate(ids):
        at = struct.unpack_from("<I", blob, 8 + 4 * i)[0]
        count, clut_y_add, semi = struct.unpack_from("<3H", blob, at)
        if semi >= 0x8000:
            semi -= 0x10000
        if not 0 < count <= 64:
            raise SystemExit(f"{stage}: clip {sid} has {count} layers")
        layers = []
        for k in range(count):
            frame, dx, dy = struct.unpack_from("<3h", blob, at + 6 + LAYER_STRIDE * k)
            if dx >= 0x8000:
                dx -= 0x10000
            if dy >= 0x8000:
                dy -= 0x10000
            p = frames_at + FRAME_STRIDE * frame
            if not frames_at <= p <= len(blob) - FRAME_STRIDE:
                raise SystemExit(f"{stage}: clip {sid} layer {k} frame {frame} outside")
            u, v, w, h, clut_x, clut_y, flags = struct.unpack_from("<7H", blob, p)
            layers.append({
                "frame": frame, "dx": dx, "dy": dy,
                "u": u, "v": v, "w": w, "h": h,
                "clutX": clut_x, "clutY": clut_y, "flags": flags,
            })
        out_clips[sid] = {"clutYAdd": clut_y_add, "semi": semi, "layers": layers}
    return {
        "resource": resource, "frames": sizes[0] // FRAME_STRIDE, "members": n,
        "bytes": len(blob), "header": 4 * n, "framesAt": frames_at, "idsAt": ids_at,
        "ids": ids, "clips": out_clips,
    }


def render(data: dict) -> str:
    out = [
        "// GENERATED by tools/extract_annotator_shapes.py -- do not edit.",
        "//",
        "// Every member of the two-pass annotator family's shape set: the stage's",
        "// own TMPK sprite directory, member 0, decoded through the header the",
        "// emitter F0x8001ED6C reads (exe/fns.s:16383-16400).  `framesAt` equals",
        "// 4 * the pack's member count, which is what proves the rebuilt pack",
        "// header rather than the frame table's own start.",
        "// Decode: docs/research/field/draw-context-service-2026-10-04.md",
        "",
        "/** One rectangle of a shape: the frame's own texels and where it sits. */",
        "export interface AnnotatorLayer {",
        "  /** the frame this rectangle names, into the directory's own table */",
        "  frame: number;",
        "  /** the layer's offset from the marker's position, the clip's own words */",
        "  dx: number; dy: number;",
        "  /** the frame's texture position and size, in texels */",
        "  u: number; v: number; w: number; h: number;",
        "  /** the frame's palette, before the context's CLUT base is added */",
        "  clutX: number; clutY: number;",
        "  /** the frame's mode word: bit0 set = 8bpp, clear = 4bpp */",
        "  flags: number;",
        "}",
        "",
        "/** One shape id of the directory: a clip and the rectangles it draws. */",
        "export interface AnnotatorClip {",
        "  /** the clip's own CLUT-row offset, added to every frame's `clutY` */",
        "  clutYAdd: number;",
        "  /** the primitive blend state: -1 = every texel plain, else ABE on */",
        "  semi: number;",
        "  layers: readonly AnnotatorLayer[];",
        "}",
        "",
        "export interface AnnotatorShapeSet {",
        "  /** the CD file index the overlay's field-config stub stored */",
        "  resource: number;",
        "  /** the pack member's byte length, member count, and frame count */",
        "  bytes: number; members: number; frames: number;",
        "  /** where the header says the frame table and the id list start */",
        "  framesAt: number; idsAt: number;",
        "  /** every shape id the directory holds, in its own order */",
        "  ids: readonly number[];",
        "  clips: Readonly<Record<number, AnnotatorClip>>;",
        "}",
        "",
        "export const ANNOTATOR_SHAPE_SETS: Readonly<Record<string, AnnotatorShapeSet>> = {",
    ]
    for stage, info in data.items():
        out.append(f'  "{stage}": {{')
        out.append(f'    resource: 0x{info["resource"]:X}, bytes: {info["bytes"]}, '
                   f'members: {info["members"]}, frames: {info["frames"]},')
        out.append(f'    framesAt: {info["framesAt"]}, idsAt: {info["idsAt"]},')
        out.append(f'    ids: [{", ".join(str(i) for i in info["ids"])}],')
        out.append("    clips: {")
        for sid in info["ids"]:
            clip = info["clips"][sid]
            out.append(f'      {sid}: {{ clutYAdd: {clip["clutYAdd"]}, semi: {clip["semi"]}, layers: [')
            for l in clip["layers"]:
                out.append(
                    f'        {{ frame: {l["frame"]}, dx: {l["dx"]}, dy: {l["dy"]}, '
                    f'u: {l["u"]}, v: {l["v"]}, '
                    f'w: {l["w"]}, h: {l["h"]}, clutX: {l["clutX"]}, '
                    f'clutY: {l["clutY"]}, flags: {l["flags"]} }},')
            out.append("      ] },")
        out.append("    },")
        out.append("  },")
    out.append("};")
    out.append("")
    return "\n".join(out)


def collect() -> dict:
    index = lba_index()
    data: dict[str, dict] = {}
    for stage, resource in sorted(shape_set_ids().items(), key=lambda kv: int(kv[0][1:])):
        name = index.get(resource)
        want = f"LBA_{stage.upper()}TMPK_BIN_IDX"
        if name != want:
            raise SystemExit(f"{stage}: LBA index 0x{resource:X} is {name}, expected {want}")
        data[stage] = decode(stage, resource)
    return data


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="fail if the generated file differs")
    ap.add_argument("--json", metavar="STAGE", help="print one stage's shape set as JSON")
    args = ap.parse_args()

    data = collect()
    if args.json:
        info = dict(data[args.json])
        info["clips"] = {str(k): v for k, v in info["clips"].items()}
        json.dump(info, sys.stdout, indent=1)
        print()
        return 0

    text = render(data)
    if args.check:
        if not OUT.exists():
            print(f"missing {OUT}", file=sys.stderr)
            return 1
        if OUT.read_text() == text:
            print(f"{OUT.name} up to date")
            return 0
        print(f"{OUT.name} is stale", file=sys.stderr)
        return 1
    OUT.write_text(text)
    shapes = sum(len(i["clips"]) for i in data.values())
    layers = sum(len(c["layers"]) for i in data.values() for c in i["clips"].values())
    print(f"wrote {OUT.name}: {len(data)} stages, {shapes} shapes, {layers} rectangles")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
