#!/usr/bin/env python3
"""Compile an authored OBJ and an existing animation rig into a battle model.

OBJ groups are named body parts in bone-local coordinates. Each face has its
own UVs; the renderer's existing per-bone vertex transform handles movement.
This keeps editable geometry separate from extracted animation data.
"""

import argparse
import json
from copy import deepcopy
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent


def parse_obj(path):
    positions, texcoords, groups = [], [], {}
    group = None
    for line_no, line in enumerate(path.read_text().splitlines(), 1):
        words = line.split()
        if not words or words[0] == "#":
            continue
        kind = words[0]
        if kind == "v":
            positions.append(tuple(float(v) for v in words[1:4]))
        elif kind == "vt":
            texcoords.append(tuple(float(v) for v in words[1:3]))
        elif kind in ("g", "o"):
            group = words[1]
            groups.setdefault(group, [])
        elif kind == "f":
            if group is None:
                raise ValueError(f"{path}:{line_no}: face has no named group")
            corners = []
            for token in words[1:]:
                parts = token.split("/")
                if len(parts) < 2 or not parts[1]:
                    raise ValueError(f"{path}:{line_no}: every face needs UVs")
                vi, ti = int(parts[0]) - 1, int(parts[1]) - 1
                if not (0 <= vi < len(positions) and 0 <= ti < len(texcoords)):
                    raise ValueError(f"{path}:{line_no}: vertex or UV index out of range")
                corners.append((positions[vi], texcoords[ti]))
            if len(corners) < 3:
                raise ValueError(f"{path}:{line_no}: face needs at least three corners")
            for k in range(1, len(corners) - 1):
                groups[group].append((corners[0], corners[k], corners[k + 1]))
    return groups


def compile_model(spec_path):
    spec = json.loads(spec_path.read_text())
    source = json.loads((ROOT / spec["animation_source"]).read_text())
    groups = parse_obj(ROOT / spec["mesh"])
    bindings = spec["bone_bindings"]
    unknown = set(groups) - set(bindings)
    if unknown:
        raise ValueError(f"OBJ groups have no bone binding: {sorted(unknown)}")
    missing = set(bindings) - set(groups)
    if missing:
        raise ValueError(f"bone bindings have no OBJ group: {sorted(missing)}")

    model = deepcopy(source)
    model["folder"] = spec["folder"]
    model["custom_variant"] = spec["name"]
    for bone in model["bones"]:
        bone["verts"] = []
        bone["faces"] = []
    for group, triangles in groups.items():
        bone_index = bindings[group]
        if not isinstance(bone_index, int) or not 0 <= bone_index < len(model["bones"]):
            raise ValueError(f"invalid bone binding for {group}: {bone_index}")
        bone = model["bones"][bone_index]
        for tri in triangles:
            face = []
            for pos, _uv in tri:
                face.append(len(bone["verts"]))
                bone["verts"].append([round(v, 4) for v in pos])
            for _pos, uv in tri:
                u, v = uv
                if not (0 <= u <= 1 and 0 <= v <= 1):
                    raise ValueError(f"UV outside atlas in {group}: {uv}")
                face.extend((round(u * 256, 4), round(v * 256, 4)))
            bone["faces"].append(face)
    triangle_count = sum(len(b["faces"]) for b in model["bones"])
    if not triangle_count or triangle_count * 3 > 65535:
        raise ValueError("model must have 1..21845 triangles for the 16-bit renderer")

    texture = Image.open(ROOT / spec["texture"]).convert("RGBA")
    w, h = texture.size
    if w != h or w < 256 or w & (w - 1):
        raise ValueError(f"texture must be square power of two, got {w}x{h}")
    out_base = ROOT / "web/assets/battle"
    out_model = out_base / "models" / spec["folder"] / "anim.json"
    out_texture = out_base / "textures" / f"{spec['folder']}.png"
    out_model.parent.mkdir(parents=True, exist_ok=True)
    out_model.write_text(json.dumps(model, separators=(",", ":")))
    texture.save(out_texture)
    if spec.get("register", False):
        index_path = out_base / "models/index.json"
        index = json.loads(index_path.read_text())
        if spec["folder"] not in index:
            index.append(spec["folder"])
            index_path.write_text(json.dumps(index))
        map_path = out_base / "model_map.json"
        model_map = json.loads(map_path.read_text())
        model_map[spec["model_name"]] = spec["folder"]
        map_path.write_text(json.dumps(model_map, indent=2) + "\n")
    print(f"{spec['folder']}: {len(groups)} authored parts, {triangle_count} triangles, {w}x{h} atlas")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", type=Path)
    args = parser.parse_args()
    compile_model(args.spec)
