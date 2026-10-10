#!/usr/bin/env python3
"""
Export DW2003 fight model skeletal animation data to JSON for battle3d.js.

Confirmed format (2026-06-14):
  bin 0:           vertex group descriptor table (62×u32 offsets; skip for anim)
  bins 1..N:       animation keyframe bins, one per bone
  bins N+1..2N:    mesh sub-parts, one per bone (an 0x18 body: sec0 verts,
                   sec1 normals, sec2 display list) — sec1 is emitted per bone as
                   `normals`, the node's normal records (see parse_mesh_bin)
  hierarchy bin:   bone hierarchy table (12-byte triples); found by content scan
  clip index bin:  18 animation clip descriptors; found by magic 0x00000048

Keyframe format (8-byte records):
  (i16 x, i16 y, i16 z, i16 frame_number), sentinel frame_number=30000
  Channel 1 (offset 0x10): primary / rest-pose track
  Channel 2 (ch2_offset):  animation track
  xyz = Euler rotation angles, PS1 units where 4096=360°

Output: web/assets/battle/models/<folder>/anim.json

Run from ~/ddw3-walker:
  ~/.local/bin/uv run python tools/export_fight_anim.py m374kybi
  ~/.local/bin/uv run python tools/export_fight_anim.py --all
"""

import struct
import json
import sys
import os
from pathlib import Path

DDW3 = Path(os.environ.get("DDW3_DIR") or Path.home() / "ddw3")
WALKER = Path(__file__).parent.parent
MODEL_DIR = DDW3 / "pack/dw2003/fight/model"
# ddw3-walker serves the game from web/, so assets live under web/assets/battle/models.
OUT_BASE = WALKER / "web/assets/battle/models"

# The read-only pack tree is not complete: three smdldata keys (468 Agunimon,
# 469 BladeGarurumon, 470 AncientGreymon) name CD files that were never unpacked
# into it. DW3_MODEL_DIR (os.pathsep-separated) names extra pack roots searched
# when a model folder is absent from MODEL_DIR, so a pack carved out of the disc
# by tools/extract_fight_model_pack.py builds through this same pipeline.
MODEL_EXTRA_DIRS = [Path(p) for p in os.environ.get("DW3_MODEL_DIR", "").split(os.pathsep) if p]


def model_folder(folder_name: str) -> Path:
    """The pack folder for one model: the read-only tree first, then overlays."""
    folder = MODEL_DIR / folder_name
    if folder.is_dir():
        return folder
    for root in MODEL_EXTRA_DIRS:
        if (root / folder_name).is_dir():
            return root / folder_name
    return folder


def model_folder_names() -> list[str]:
    """Every pack folder name visible to the build, from all roots."""
    names = {p.name for p in MODEL_DIR.iterdir() if p.is_dir()}
    for root in MODEL_EXTRA_DIRS:
        if root.is_dir():
            names |= {p.name for p in root.iterdir() if p.is_dir()}
    return sorted(names)


def read_bins(folder: Path) -> list[bytes]:
    """Read all .bin files in ascending numeric order."""
    bins = sorted(folder.glob("*.bin"), key=lambda p: int(p.stem))
    return [p.read_bytes() for p in bins]


def read_s16(data, offset):
    v = struct.unpack_from("<H", data, offset)[0]
    return v - 0x10000 if v >= 0x8000 else v


def hierarchy_bin_candidates(bins: list[bytes]):
    """Yield (bone_count, data) for every bin whose head is a bone table.

    A bone table is a u32 count at +4 followed by that many 12-byte
    {parent, mesh_bin, anim_bin} triples, every mesh_bin indexing an 0x18-magic
    bin and every anim_bin an 0x10-magic one. The table must fit in the member;
    what follows it in the member is not the caller's business.
    """
    anim_idxs = {i for i, d in enumerate(bins) if len(d) >= 4 and struct.unpack_from("<I", d, 0)[0] == 0x10}
    mesh_idxs = {i for i, d in enumerate(bins) if len(d) >= 4 and struct.unpack_from("<I", d, 0)[0] == 0x18}

    for data in bins:
        if len(data) < 8:
            continue
        _, num_bones = struct.unpack_from("<II", data, 0)
        if not (1 <= num_bones <= 200):
            continue
        if len(data) < 8 + num_bones * 12:
            continue
        ok = True
        for i in range(num_bones):
            ps, mb, ab = struct.unpack_from("<III", data, 8 + i * 12)
            if ab not in anim_idxs or mb not in mesh_idxs:
                ok = False
                break
        if ok:
            yield num_bones, data


def find_hierarchy_bin(bins: list[bytes]) -> tuple[int, bytes] | tuple[None, None]:
    """Find the bone hierarchy bin by scanning all bins.

    The hierarchy bin is the part directory smdldata's +0x00 member names: a u32
    count at +4 then 12-byte {parent, mesh_bin, anim_bin} triples, every mesh_bin
    referencing an 0x18-magic bin and every anim_bin an 0x10-magic one.

    A member whose length is exactly 8 + num_bones * 12 is preferred, which is
    how all 245 packs of the read-only tree read. Three Jogress-only packs
    (m468agnm, m469garm, m470agry) put that member last in the CD file, so it
    also carries the file's trailing sector padding -- all zeros past the table --
    and only the table-prefix form matches there.

    Returns (bone_count, data) or (None, None) if not found.
    """
    fallback = None
    for num_bones, data in hierarchy_bin_candidates(bins):
        if len(data) == 8 + num_bones * 12:
            return num_bones, data
        if fallback is None and not data[8 + num_bones * 12:].strip(b"\0"):
            fallback = (num_bones, data)
    return fallback if fallback is not None else (None, None)


def is_offset_table(data: bytes) -> bool:
    """True if `data` heads an 18 x u32 offset table into itself.

    The clip/action bin (magic word 0x48 = 72, the first entry's byte offset) is
    identified in every pack by that magic alone, which is not unique: m469garm's
    bone table happens to begin with the value 72. An offset table's 18 entries are
    byte offsets of consecutive scripts, so the ones that are present (0 = script
    absent) cannot decrease -- and m469garm's bone table's do, 72 then 35 then 33.
    """
    if len(data) < 72:
        return False
    present = [o for o in struct.unpack_from("<18I", data, 0) if o != 0]
    return all(a <= b for a, b in zip(present, present[1:]))


def parse_hierarchy(data: bytes) -> tuple[int, list[dict]]:
    """Parse the hierarchy bin content. Returns (num_bones, list of triples)."""
    if len(data) < 8:
        return 0, []
    _, num_bones = struct.unpack_from("<II", data, 0)
    bones = []
    for i in range(num_bones):
        off = 8 + i * 12
        if off + 12 > len(data):
            break
        parent_slot, mesh_bin, anim_bin = struct.unpack_from("<III", data, off)
        bones.append({"parent_slot": parent_slot, "mesh_bin": mesh_bin, "anim_bin": anim_bin})
    return num_bones, bones


def parse_anim_bin(data: bytes) -> dict | None:
    """Parse animation keyframe bin.
    Returns {ch1: [[x,y,z,frame],...], ch2: [[x,y,z,frame],...], ch3: [[x,y,z,frame],...]}.

    ch3 = per-axis scale, confirmed 2026-06-18 via direct hex dump of a real
    anim bin (m003agum/14.bin): the bytes between seca_off and secb_off use the
    exact same 8-byte (i16 x, i16 y, i16 z, i16 frame) record format and 30000
    sentinel as ch1/ch2 — not the "alternating visibility toggle" this region
    was previously guessed to be. 4096 = 1.0 fixed-point, same convention as
    ch1/ch2's own units. secb_off..end (8 bytes) still isn't parsed here; it
    looks like a fixed end-of-stream marker rather than per-bone data, but
    that's only been confirmed against one sample so far.
    """
    if len(data) < 0x10:
        return None
    magic, ch2_off, seca_off, secb_off = struct.unpack_from("<4I", data, 0)
    if magic != 0x10:
        return None

    def read_channel(start, end):
        records = []
        off = start
        while off + 8 <= min(end, len(data)):
            x, y, z, frame = struct.unpack_from("<4h", data, off)
            records.append([x, y, z, frame])
            off += 8
            if frame == 30000:
                break
        return records

    ch1 = read_channel(0x10, ch2_off)
    ch2 = read_channel(ch2_off, seca_off)
    ch3 = read_channel(seca_off, secb_off)
    return {"ch1": ch1, "ch2": ch2, "ch3": ch3}


def parse_section_c_faces(data: bytes, face_off: int, face_size: int,
                          vc: int, nc: int) -> list[list[int]]:
    """Parse Section C face stream. Returns flat triangle records
    [v0,v1,v2, u0,v0, u1,v1, u2,v2] (9 ints). Quads split into 2 tris.

    CORRECTED 2026-06-20 (session 21), folding in the session-15/16 fixes that
    previously lived only in rebake_faces.py:
      - FULL region: parse face_off -> END-OF-BIN, not the truncated h[5] block
        (h[5] holds only the first of several concatenated batches -> 228 of 858
        tris). `face_size` is ignored on purpose.
      - UV base = cmd-0x01 bytes b1(U)/b3(V) (NOT the old adj_a/adj_b = b4/b5),
        UV = (b1+raw_u, b3+raw_v), no &0xFF, no V seam-unwrap. Renderer divides
        both axes by 256 (4bpp 256x256 page). b4/b5 are the per-primitive CLUT
        coords, consumed by the texture baker, not needed in anim.json.
    """
    is_quad = has_uv = has_norm = False
    b1 = b3 = 0
    triangles: list[list[int]] = []
    pos = face_off
    end = len(data)                       # FULL region (ignore face_size/h[5])

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
            b1, b3 = data[pos + 1], data[pos + 3]
            pos += 7
        elif cmd in (0x02, 0x03, 0x04, 0x05):
            pos += 4
        elif cmd == 0x00:
            pos += 1
            n = 4 if is_quad else 3
            while True:
                needed = n + (n if has_norm else 0) + (n * 2 if has_uv else 0)
                if pos + needed > end:
                    pos = end
                    break
                vi = list(data[pos: pos + n]); pos += n
                if has_norm:
                    pos += n
                uvs = [[0, 0]] * n
                if has_uv:
                    raw = list(data[pos: pos + n * 2]); pos += n * 2
                    uvs = [[b1 + raw[2*i], b3 + raw[2*i + 1]] for i in range(n)]
                if all(v < vc for v in vi):
                    if not is_quad:
                        triangles.append([vi[0], vi[1], vi[2],
                                          uvs[0][0], uvs[0][1],
                                          uvs[1][0], uvs[1][1],
                                          uvs[2][0], uvs[2][1]])
                    else:
                        # PS1 4-point polys (GP0 0x28) are Z-ORDERED: the two tris are
                        # (v0,v1,v2) and (v1,v2,v3), sharing the v1-v2 diagonal. The old
                        # fan split (v0,v2,v3) shared edge v0-v2 -- a SIDE in Z-order --
                        # so the 2nd tri was mis-placed, leaving a triangular hole + a
                        # stray sliver in EVERY quad. Verified assumption-free on real
                        # geometry: tools/diag_quad_order.py -> 100% z-order across all
                        # models. THIS was the "holes in every model incl Renamon" bug.
                        triangles.append([vi[0], vi[1], vi[2],
                                          uvs[0][0], uvs[0][1],
                                          uvs[1][0], uvs[1][1],
                                          uvs[2][0], uvs[2][1]])
                        triangles.append([vi[1], vi[2], vi[3],
                                          uvs[1][0], uvs[1][1],
                                          uvs[2][0], uvs[2][1],
                                          uvs[3][0], uvs[3][1]])
                if pos < end and data[pos] == 0x00:
                    pos += 1
                    continue
                break
        else:
            pos += 1  # skip unknown

    return triangles


def parse_mesh_bin(data: bytes) -> tuple[list[list[int]], list[list[int]], list[list[int]]] | tuple[None, None, None]:
    """Parse mesh sub-part bin: returns (verts, faces, normals).
    Header: 6×u32. Section A (sec0): verts. Section B (sec1): normals. Section C (sec2): faces.
    """
    if len(data) < 0x18 + 8:
        return None, None, None
    h = struct.unpack_from("<6I", data, 0)
    if h[0] != 0x18:
        return None, None, None
    sec_a_off = 0x18
    if sec_a_off + 8 > len(data):
        return None, None, None
    vc = struct.unpack_from("<I", data, sec_a_off)[0]
    if vc == 0 or vc > 10000:
        return None, None, None
    verts = []
    # Section A: [count:u32 @ sec_a_off][2 bytes][verts @ sec_a_off+6].
    # NOTE (2026-06-20): verts start at +6, NOT +8. The old +8 read every vertex
    # one int16 too late, so each (x,y,z) became (prev.z, x, y) -- a 2-byte phase
    # shift that scrambled the whole mesh. Confirmed against the live RAM draw
    # buffers (game RTPS's verts at draw-node +0x60) for all 21 Renamon bones,
    # and against the disc bin (m373rena/31.bin verts@0x1e == runtime ground truth).
    # This was the long-standing "inter-bone fragmentation" root cause.
    voff = sec_a_off + 6
    for i in range(vc):
        if voff + 6 > len(data):
            break
        x, y, z = struct.unpack_from("<3h", data, voff)
        verts.append([x, y, z])
        voff += 6

    # Section B (sec1) — the node's normal records. `i16 count` at +0, a 4-byte
    # pad, then `count` x {x,y,z:i16} at +6, stride 6, padded to a 4-byte tail.
    # FIGHTSTG_F0x800847f4 shades from exactly this block (it reads `node+0x64`,
    # `lh` count at +0 then 6-byte records from +6, fightstg.s L1785-1787 /
    # L1897-1901) and it is the table the display list's lit run (s40, opcode
    # 0xCn) indexes by normal index. engine/dw3/battle-mesh.ts `readMeshBlob`
    # parses the same block (secs[1]) into `normals`. This section was dropped
    # here (the extractor read sec0 and sec2 only) until 2026-10-07, so the
    # shipped anim.json carried no normals; doc:
    # docs/research/battle/effect-mesh-normal-block-2026-10-07.md §6.
    norm_off = h[1]
    normals: list[list[int]] = []
    if 0 < norm_off < len(data):
        ncnt = struct.unpack_from("<h", data, norm_off)[0]
        if 0 <= ncnt <= 10000:
            noff = norm_off + 6
            for i in range(ncnt):
                if noff + 6 > len(data):
                    break
                x, y, z = struct.unpack_from("<3h", data, noff)
                normals.append([x, y, z])
                noff += 6

    # Section B norm count (needed for Section C parse)
    nc = 0
    if norm_off + 4 <= len(data):
        nc = struct.unpack_from("<I", data, norm_off)[0]
        if nc > 10000:
            nc = 0

    face_off = h[2]
    face_size = h[5]
    faces = parse_section_c_faces(data, face_off, face_size, vc, nc)
    return verts, faces, normals


def is_anim_bin(data: bytes) -> bool:
    """Return True if this bin looks like an animation keyframe bin."""
    if len(data) < 0x10:
        return False
    magic = struct.unpack_from("<I", data, 0)[0]
    return magic == 0x10


def is_mesh_bin(data: bytes) -> bool:
    """Return True if this bin looks like a mesh sub-part bin."""
    if len(data) < 0x18:
        return False
    h0 = struct.unpack_from("<I", data, 0)[0]
    return h0 == 0x18


def find_clip_index_bin(bins: list[bytes]) -> bytes | None:
    """Find the clip index bin by magic 0x48 (= 72 = 18 × 4 bytes).

    The magic alone also matches a bone table whose first word is 72 (m469garm's
    part directory), so a candidate must be a real offset table — see
    `is_offset_table`.
    """
    for data in bins:
        if len(data) >= 4 and struct.unpack_from("<I", data, 0)[0] == 0x48 and is_offset_table(data):
            return data
    return None


def parse_clip_index(data: bytes, total_frames: int) -> list[dict]:
    """Parse the 0x48-magic clip index bin. Returns list of 18 clip dicts.

    Header: 18 × u32 = 72 bytes, each is byte offset into this bin for clip N's
    data (0 = absent). Per-clip: variable-length opcode stream terminated by
    sentinel i16 value 255.

    Opcodes:
      [2, sub, a, b]  — 4 i16s; sub=0: b = loop count
      [3, sub, val]   — 3 i16s; sub=1, val≠9999: end_frame
      [4, sub, val]   — 3 i16s; sub=1, val>0: start_frame
      [6, sub, val]   — 3 i16s; sub=1, val>0: start_frame (alternate marker)
      [10,11,sub,val] — 3 i16s
      [255, X]        — 2 i16s: sentinel
      other           — skip 2 i16s (4 bytes)
    """
    if len(data) < 72:
        return []

    offsets = list(struct.unpack_from("<18I", data, 0))
    clips = []

    for idx, off in enumerate(offsets):
        if off == 0 or off >= len(data):
            clips.append({
                "index": idx,
                "present": False,
                "start_frame": 0,
                "end_frame": total_frames,
                "loop_count": 1,
            })
            continue

        start_frame = 0
        end_frame = total_frames
        loop_count = 1
        pos = off
        # Track whether we've already set each field to avoid overwriting with blob garbage
        _start_set = False
        _end_set = False

        while pos < len(data):
            if pos + 2 > len(data):
                break
            op = struct.unpack_from("<h", data, pos)[0]
            if op == 255:
                break
            elif op == 2:
                if pos + 8 > len(data):
                    break
                _, sub, a, b = struct.unpack_from("<4h", data, pos)
                if sub == 0:
                    loop_count = b
                pos += 8
            elif op in (3, 4, 6, 10, 11):
                if pos + 6 > len(data):
                    break
                _, sub, val = struct.unpack_from("<3h", data, pos)
                if not _start_set and op in (4, 6) and sub == 1 and val > 0:
                    start_frame = val
                    _start_set = True
                elif not _end_set and op == 3 and sub == 1 and val != 9999 and val > max(start_frame, 10):
                    # Accept as end_frame only if it's meaningfully larger than start;
                    # small values like 2 or 5 are loop-back targets, not end frames.
                    end_frame = val
                    _end_set = True
                pos += 6
            else:
                # Unknown opcode: skip 2 i16s (4 bytes) and continue
                pos += 4

        clips.append({
            "index": idx,
            "present": True,
            "start_frame": start_frame,
            "end_frame": min(end_frame, total_frames),
            "loop_count": loop_count,
        })

    # For purely parametric clips (start=0, end still at total_frames), set end to
    # first_explicit_start - 1 so they cover the short "intro" section of the timeline.
    first_explicit = min(
        (c["start_frame"] for c in clips if c.get("present") and c["start_frame"] > 0),
        default=total_frames,
    )
    for c in clips:
        if (
            c.get("present")
            and c["start_frame"] == 0
            and c["end_frame"] == total_frames
            and first_explicit > 0
        ):
            c["end_frame"] = first_explicit - 1

    return clips


def export_model(folder_name: str) -> bool:
    folder = model_folder(folder_name)
    if not folder.exists():
        print(f"  Model folder not found: {folder}")
        return False

    bins = read_bins(folder)
    n = len(bins)
    if n < 4:
        print(f"  Too few bins: {n}")
        return False

    # Find and parse hierarchy bin (robust scan — position varies per model)
    num_bones, hier_data = find_hierarchy_bin(bins)
    if num_bones is None:
        print(f"  No hierarchy bin found (total={n})")
        return False
    _, hierarchy = parse_hierarchy(hier_data)

    # Parse animation data for each bone
    bones_out = []
    for i, bone in enumerate(hierarchy):
        anim_idx = bone["anim_bin"]   # absolute bin index
        mesh_idx = bone["mesh_bin"]   # absolute bin index

        # Get animation keyframes
        anim_data = None
        if 0 < anim_idx < n:
            anim_data = parse_anim_bin(bins[anim_idx])

        # Get mesh vertices + faces + normals
        mesh_verts, mesh_faces, mesh_normals = None, None, None
        if 0 < mesh_idx < n:
            mesh_verts, mesh_faces, mesh_normals = parse_mesh_bin(bins[mesh_idx])

        bones_out.append({
            "parent_slot": bone["parent_slot"],
            "anim_bin": bone["anim_bin"],
            "mesh_bin": bone["mesh_bin"],
            "anim": anim_data,
            "verts": mesh_verts or [],
            "faces": mesh_faces or [],
            "normals": mesh_normals or [],
        })

    # Compute total_frames from highest non-sentinel frame number across all anim channels
    total_frames = 0
    for bone_out in bones_out:
        anim = bone_out.get("anim")
        if anim:
            for ch in (anim.get("ch1", []), anim.get("ch2", [])):
                for kf in ch:
                    if kf[3] != 30000 and kf[3] > total_frames:
                        total_frames = kf[3]

    # Find and parse clip index bin (magic 0x48 = 72 bytes header)
    clip_data = find_clip_index_bin(bins)
    try:
        clips_out = parse_clip_index(clip_data, total_frames) if clip_data else []
    except Exception:
        clips_out = []

    out = {
        "folder": folder_name,
        "num_bones": num_bones,
        "total_frames": total_frames,
        "clips": clips_out,
        "bones": bones_out,
    }

    out_dir = OUT_BASE / folder_name
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "anim.json"
    with open(out_path, "w") as f:
        json.dump(out, f, separators=(",", ":"))

    total_verts = sum(len(b["verts"]) for b in bones_out)
    total_faces = sum(len(b["faces"]) for b in bones_out)
    total_kf = sum(
        len(b["anim"]["ch1"]) + len(b["anim"]["ch2"])
        for b in bones_out if b["anim"]
    )
    clip_count = sum(1 for c in clips_out if c.get("present"))
    print(f"  {folder_name}: {num_bones} bones, {total_verts}v, {total_faces}f, {total_kf}kf, {clip_count}/18 clips, maxframe={total_frames}")
    return True


def main():
    if len(sys.argv) < 2 or sys.argv[1] == "--help":
        print(__doc__)
        sys.exit(0)

    if sys.argv[1] == "--all":
        folders = model_folder_names()
        ok = 0
        for name in folders:
            if export_model(name):
                ok += 1
        print(f"\nExported {ok}/{len(folders)} models")
    else:
        for name in sys.argv[1:]:
            export_model(name)


if __name__ == "__main__":
    main()
