#!/usr/bin/env python3
"""Create, validate and install a native browser battle model (anim.json + PNG).

Source bundles live in data/custom/<folder>/. The animation file is the exact
shape consumed by web/battle3d.js; there is no OBJ/GLB conversion or borrowed rig.
"""

import argparse
import json
import re
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent.parent
SOURCE_ROOT = ROOT / "data/custom"
DEST = ROOT / "web/assets/battle"
REGISTRY = SOURCE_ROOT / "registry.json"
FOLDER_RE = re.compile(r"m[0-9]{3}[a-z0-9_]+\Z")


def fail(where, message):
    raise ValueError(f"{where}: {message}")


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and abs(value) < 1e7


def validate(folder, source_root=SOURCE_ROOT):
    if not FOLDER_RE.fullmatch(folder):
        fail(folder, "folder must look like m005new (lowercase letters/digits/underscore)")
    source = source_root / folder
    model = json.loads((source / "anim.json").read_text())
    with Image.open(source / "texture.png") as image:
        width, height = image.size
        if image.mode != "RGBA":
            fail("texture.png", "expected RGBA PNG")
        if width != height or width < 256 or width > 2048 or width & (width - 1):
            fail("texture.png", f"expected square power-of-two 256..2048, got {width}x{height}")
        if image.getbbox() is None:
            fail("texture.png", "image is fully transparent")
    if model.get("folder") != folder:
        fail("anim.json.folder", f"expected {folder}")
    bones = model.get("bones")
    if not isinstance(bones, list) or not bones or model.get("num_bones") != len(bones):
        fail("anim.json.bones", "need nonempty bones and matching num_bones")
    total_frames = model.get("total_frames")
    if not isinstance(total_frames, int) or total_frames < 1 or total_frames > 30000:
        fail("anim.json.total_frames", "expected integer 1..30000")
    triangle_count = 0
    for i, bone in enumerate(bones):
        p = bone.get("parent_slot")
        # Parent indices are 1-based; restricting parents to earlier bones also
        # makes the renderer's single forward FK pass unambiguous.
        if not isinstance(p, int) or p < 0 or p > i:
            fail(f"bone {i}.parent_slot", "use 0 for root or 1-based index of an earlier bone")
        verts, faces = bone.get("verts"), bone.get("faces")
        if not isinstance(verts, list) or not isinstance(faces, list):
            fail(f"bone {i}", "verts and faces must be arrays")
        for j, v in enumerate(verts):
            if not isinstance(v, list) or len(v) != 3 or not all(map(number, v)):
                fail(f"bone {i}.verts[{j}]", "expected numeric local [x,y,z]")
        for j, face in enumerate(faces):
            if not isinstance(face, list) or len(face) != 9:
                fail(f"bone {i}.faces[{j}]", "expected [v0,v1,v2,u0,v0,u1,v1,u2,v2]")
            if any(not isinstance(v, int) or v < 0 or v >= len(verts) for v in face[:3]):
                fail(f"bone {i}.faces[{j}]", "vertex index outside this bone's verts")
            if any(not number(v) or v < 0 or v > 256 for v in face[3:]):
                fail(f"bone {i}.faces[{j}]", "UV must be in 0..256 native atlas units")
        triangle_count += len(faces)
        anim = bone.get("anim")
        if not isinstance(anim, dict):
            fail(f"bone {i}.anim", "expected ch1/ch2/ch3 tracks")
        for channel in ("ch1", "ch2", "ch3"):
            keys = anim.get(channel)
            if not isinstance(keys, list) or not keys:
                fail(f"bone {i}.{channel}", "expected at least one [x,y,z,frame] key")
            last = -1
            for j, key in enumerate(keys):
                if not isinstance(key, list) or len(key) != 4 or not all(map(number, key)):
                    fail(f"bone {i}.{channel}[{j}]", "expected numeric [x,y,z,frame]")
                if not isinstance(key[3], int) or key[3] <= last or key[3] > 30000:
                    fail(f"bone {i}.{channel}[{j}]", "frame must increase and be <=30000")
                last = key[3]
    if not 0 < triangle_count * 3 <= 65535:
        fail("anim.json.bones", "need 1..21845 total triangles for WebGL1 index buffer")
    timelines = model.get("timeline")
    if not isinstance(timelines, list) or not timelines or not isinstance(timelines[0], dict):
        fail("anim.json.timeline", "need timeline[0] idle table")
    for i, entry in enumerate(timelines):
        table = entry.get("table") if isinstance(entry, dict) else None
        if not isinstance(table, list):
            fail(f"timeline[{i}]", "expected {table:[...]}")
        for j, mark in enumerate(table):
            if not isinstance(mark, dict) or not isinstance(mark.get("value"), int):
                fail(f"timeline[{i}][{j}]", "expected integer value")
            value = mark["value"]
            target = mark.get("loop_target")
            if not isinstance(target, int) or not 0 <= target <= 65535:
                fail(f"timeline[{i}][{j}]", "bad loop_target")
            if value == 0x8000 and target >= len(table):
                fail(f"timeline[{i}][{j}]", "loop_target is outside table")
            if not 0 <= value <= 65535:
                fail(f"timeline[{i}][{j}]", "value outside u16")
            if value < 0x8000 and value > total_frames:
                fail(f"timeline[{i}][{j}]", "pose frame exceeds total_frames")
            if value & 0x8000 and value not in (0x8000, 0xffff) and target != 0xffff and target > total_frames:
                fail(f"timeline[{i}][{j}]", "blend target exceeds total_frames")
    if len(timelines[0]["table"]) < 2:
        fail("timeline[0]", "idle needs at least two entries")
    clips, actions = model.get("clips"), model.get("actions")
    if not isinstance(clips, list) or not isinstance(actions, list) or len(clips) != len(actions):
        fail("anim.json", "clips and actions must be equal-length arrays")
    if len(clips) < 18:
        fail("anim.json.clips", "battle expects 18 action slots (0..17)")
    for i, (clip, action) in enumerate(zip(clips, actions)):
        if clip.get("index") != i or not isinstance(clip.get("present"), bool):
            fail(f"clips[{i}]", "index must equal slot and present must be boolean")
        if not (0 <= clip.get("start_frame", -1) <= clip.get("end_frame", -1) <= total_frames):
            fail(f"clips[{i}]", "invalid frame range")
        ops = action.get("ops") if isinstance(action, dict) else None
        if not isinstance(ops, list) or not ops:
            fail(f"actions[{i}]", "need nonempty ops")
        for j, op in enumerate(ops):
            if not isinstance(op, dict) or not isinstance(op.get("op"), int) or not isinstance(op.get("words"), list):
                fail(f"actions[{i}].ops[{j}]", "expected {op:int,words:[]}")
            if op["op"] not in (*range(12), 255) or not all(isinstance(w, int) for w in op["words"]):
                fail(f"actions[{i}].ops[{j}]", "unsupported opcode or non-integer operand")
            if op["op"] == 2 and len(op["words"]) >= 3 and op["words"][0] == 0:
                table = op["words"][2]
                if table > 1 and (table >= len(timelines) or not timelines[table]["table"]):
                    fail(f"actions[{i}].ops[{j}]", f"references empty/missing timeline {table}")
        if ops[-1]["op"] not in (0, 255):
            fail(f"actions[{i}]", "last op must terminate (0 or 255)")
    return {"bones": len(bones), "triangles": triangle_count, "texture": f"{width}x{height}", "timelines": len(timelines)}


def init(folder):
    if not FOLDER_RE.fullmatch(folder):
        fail(folder, "folder must look like m005new")
    source = SOURCE_ROOT / folder
    source.mkdir(parents=True, exist_ok=False)
    # Two separately authored bone meshes and a short, independent tail motion.
    # This is a format demonstration, not a creature design.
    square = {"verts": [[-120, -80, 0], [120, -80, 0], [120, 80, 0], [-120, 80, 0]],
              "faces": [[0, 1, 2, 0, 0, 128, 0, 128, 128], [0, 2, 3, 0, 0, 128, 128, 0, 128]]}
    tracks = {"ch1": [[0, 0, 0, 0]], "ch2": [[0, 0, 0, 0]], "ch3": [[4096, 4096, 4096, 0]]}
    bones = [{"parent_slot": 0, "anim": tracks, **square},
             {"parent_slot": 1,
              "anim": {"ch1": [[120, 0, 0, 0]], "ch2": [[0, 0, -120, 0], [0, 0, 120, 10], [0, 0, -120, 20]], "ch3": tracks["ch3"]},
              "verts": [[0, -35, 0], [180, -20, 0], [180, 20, 0], [0, 35, 0]],
              "faces": [[0, 1, 2, 128, 0, 256, 0, 256, 128], [0, 2, 3, 128, 0, 256, 128, 128, 128]]}]
    table = [{"value": frame, "loop_target": 0, "aux": None} for frame in range(21)]
    table.append({"value": 0x8000, "loop_target": 0, "aux": None})
    model = {"folder": folder, "num_bones": 2, "total_frames": 20,
             "clips": [{"index": i, "present": True, "start_frame": 0, "end_frame": 20, "loop_count": 1} for i in range(18)],
             "bones": bones, "timeline": [{"table": table}] + [{"table": []} for _ in range(61)],
             "actions": [{"ops": [{"op": 2, "words": [0, 0, 1]}, {"op": 255, "words": []}], "overrun": False} for _ in range(18)]}
    (source / "anim.json").write_text(json.dumps(model, indent=2) + "\n")
    image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    image.paste((39, 109, 174, 255), (0, 0, 128, 128))
    image.paste((240, 148, 51, 255), (128, 0, 256, 128))
    image.save(source / "texture.png")
    return source


def build(folder, register=None):
    stats = validate(folder, SOURCE_ROOT)
    src = SOURCE_ROOT / folder
    registry = json.loads(REGISTRY.read_text())
    index_path = DEST / "models/index.json"
    index = json.loads(index_path.read_text())
    if folder in index and folder not in registry.values():
        fail(folder, "folder already belongs to an extracted model; choose a new ID")
    map_path = DEST / "model_map.json"
    if register:
        mapping = json.loads(map_path.read_text())
        if register in mapping and mapping[register] != folder:
            fail("--register", f"{register} already maps to {mapping[register]}; choose a new name")
    target = DEST / "models" / folder / "anim.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes((src / "anim.json").read_bytes())
    (DEST / "textures" / f"{folder}.png").write_bytes((src / "texture.png").read_bytes())
    if register:
        if folder not in index:
            index.append(folder)
            index_path.write_text(json.dumps(index, indent=2) + "\n")
        mapping[register] = folder
        map_path.write_text(json.dumps(mapping, indent=2) + "\n")
        registry[register] = folder
        REGISTRY.write_text(json.dumps(registry, indent=2) + "\n")
    return stats


def build_all():
    # Only registered models are installed into the game. Unregistered source bundles are
    # drafts: they stay editable in data/custom and are validated, but are not shipped.
    registry = json.loads(REGISTRY.read_text())
    sources = sorted(p.name for p in SOURCE_ROOT.iterdir() if (p / "anim.json").is_file())
    for name, folder in registry.items():
        if folder not in sources:
            fail("registry.json", f"{name} references missing source bundle {folder}")
        build(folder, register=name)
    folders = sorted(registry.values())
    (DEST / "models/custom-manifest.json").write_text(json.dumps(folders, indent=2) + "\n")
    return folders


def inspect(folder, bone_index=None, atlas_out=None):
    """Report the actual native geometry and optionally annotate its atlas."""
    if not FOLDER_RE.fullmatch(folder):
        fail(folder, "folder must look like m005grey")
    source = SOURCE_ROOT / folder
    if not (source / "anim.json").is_file():
        source = DEST / "models" / folder
        texture_path = DEST / "textures" / f"{folder}.png"
    else:
        texture_path = source / "texture.png"
    model = json.loads((source / "anim.json").read_text())
    bones = model["bones"]
    if bone_index is not None and not 0 <= bone_index < len(bones):
        fail("--bone", f"expected index 0..{len(bones)-1}")
    rows = []
    for i, bone in enumerate(bones):
        if bone_index is not None and i != bone_index:
            continue
        verts, faces = bone.get("verts", []), bone.get("faces", [])
        uv = [(f[3 + 2*k], f[4 + 2*k]) for f in faces for k in range(3)]
        rows.append({"bone": i, "parent_slot": bone["parent_slot"],
                     "vertices": len(verts), "triangles": len(faces),
                     "xyz_min": [min(v[a] for v in verts) for a in range(3)] if verts else None,
                     "xyz_max": [max(v[a] for v in verts) for a in range(3)] if verts else None,
                     "uv_min": [min(v[a] for v in uv) for a in range(2)] if uv else None,
                     "uv_max": [max(v[a] for v in uv) for a in range(2)] if uv else None})
    if atlas_out:
        with Image.open(texture_path) as original:
            image = original.convert("RGBA")
        scale = image.width / 256
        draw = ImageDraw.Draw(image, "RGBA")
        for row in rows:
            i = row["bone"]
            color = ((i * 67 + 40) % 256, (i * 113 + 80) % 256, (i * 173 + 160) % 256, 255)
            for face in bones[i].get("faces", []):
                points = [(round(face[3 + 2*k] * scale), round(face[4 + 2*k] * scale)) for k in range(3)]
                draw.line(points + points[:1], fill=color, width=max(1, round(scale)))
        image.save(atlas_out)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("init", "validate", "build", "build-all", "inspect"))
    parser.add_argument("folder", nargs="?")
    parser.add_argument("--register", metavar="DISPLAY_NAME", help="add a new selectable name during build")
    parser.add_argument("--bone", type=int, help="inspect only this zero-based bone")
    parser.add_argument("--atlas-out", type=Path, help="save the PNG with selected UV triangles outlined")
    args = parser.parse_args()
    if args.command == "build-all":
        print(json.dumps(build_all()))
    elif not args.folder:
        parser.error("folder is required for init, validate and build")
    elif args.command == "init":
        print(f"Created {init(args.folder)}")
    elif args.command == "validate":
        print(json.dumps(validate(args.folder)))
    elif args.command == "inspect":
        print(json.dumps(inspect(args.folder, args.bone, args.atlas_out), indent=2))
    else:
        print(json.dumps(build(args.folder, args.register)))


if __name__ == "__main__":
    main()
