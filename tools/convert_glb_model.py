#!/usr/bin/env python3
"""Convert a generated GLB into a native, articulated battle-model bundle.

The recipe supplies a small skeleton guide in the GLB's normalized coordinates.
All mesh decimation, per-face bone ownership, local-space conversion, atlas
allocation, clip construction, and format validation are deterministic.
"""

import argparse
import json
import math
import shutil
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image, ImageDraw

from custom_fight_model import validate as validate_native
from model_authoring import pose, validate_generated


ROOT = Path(__file__).resolve().parent.parent


def checked_recipe(recipe):
    joints = recipe.get("joints")
    if not isinstance(joints, list) or not joints:
        raise ValueError("recipe needs an ordered joints array")
    ids = {}
    for i, row in enumerate(joints):
        name = row.get("id")
        if not isinstance(name, str) or name in ids:
            raise ValueError(f"joint {i}: missing or duplicate id")
        parent = row.get("parent")
        if parent is not None and parent not in ids:
            raise ValueError(f"joint {name}: parent must precede child")
        point = np.asarray(row.get("joint"), dtype=float)
        tip = np.asarray(row.get("tip", row.get("joint")), dtype=float)
        if point.shape != (3,) or tip.shape != (3,) or not np.isfinite(point).all() or not np.isfinite(tip).all():
            raise ValueError(f"joint {name}: joint/tip must be finite xyz vectors")
        radius = row.get("radius", 0.25)
        if not isinstance(radius, (int, float)) or not .01 <= radius <= 3:
            raise ValueError(f"joint {name}: radius must be .01..3")
        ids[name] = i
    axes = recipe.get("axes", [1, 2, 3])
    if sorted(abs(v) for v in axes) != [1, 2, 3]:
        raise ValueError("axes must be a signed permutation of 1,2,3")
    return ids


def transform(points, recipe):
    axes = recipe.get("axes", [1, 2, 3])
    points = np.asarray(points, dtype=float)
    return np.stack([np.sign(axis) * points[..., abs(axis)-1] for axis in axes], axis=-1)


def load_mesh(path, max_faces, scale=1100):
    scene = trimesh.load(path, force="scene", process=False)
    meshes = tuple(scene.dump())
    if not meshes or any(not isinstance(mesh, trimesh.Trimesh) for mesh in meshes):
        raise ValueError("GLB must contain triangle meshes")
    mesh = trimesh.util.concatenate(meshes)
    if not np.isfinite(mesh.vertices).all() or len(mesh.faces) == 0:
        raise ValueError("GLB has nonfinite positions or no faces")
    if not mesh.is_watertight:
        raise ValueError("source GLB is not watertight")
    source_faces = len(mesh.faces)
    if source_faces > max_faces:
        mesh = mesh.simplify_quadric_decimation(face_count=max_faces)
    triangle = mesh.vertices[mesh.faces]
    area2 = np.linalg.norm(np.cross(triangle[:, 1]-triangle[:, 0],
                                    triangle[:, 2]-triangle[:, 0]), axis=1)
    valid = area2 * float(scale**2) >= 1
    if not valid.all():
        mesh.update_faces(valid)
    mesh.remove_unreferenced_vertices()
    if len(mesh.faces) > max_faces or len(mesh.faces) * 3 > 65535:
        raise ValueError("decimation exceeded renderer triangle limit")
    return mesh, source_faces


def segment_owners(mesh, recipe):
    """Assign whole triangles to the nearest guided bone segment.

    Whole-triangle ownership keeps the rest-pose shell exactly closed. A small
    movement limit in the recipe bounds cracks when adjacent bones rotate.
    """
    centroids = mesh.vertices[mesh.faces].mean(axis=1)
    scores = []
    for row in recipe["joints"]:
        start = np.asarray(row["joint"], float)
        end = np.asarray(row.get("tip", start), float)
        axis = end - start
        length2 = float(axis @ axis)
        t = np.clip(((centroids-start) @ axis) / length2, 0, 1) if length2 > 1e-9 else np.zeros(len(centroids))
        closest = start + t[:, None] * axis
        distance = np.linalg.norm(centroids-closest, axis=1)
        score = distance / row.get("radius", .25) + float(row.get("bias", 0))
        if "region" in row:
            lo, hi = np.asarray(row["region"], float)
            score += 100 * np.linalg.norm(np.maximum(lo-centroids, 0) +
                                          np.maximum(centroids-hi, 0), axis=1)
        scores.append(score)
    return np.argmin(np.stack(scores, axis=1), axis=1)


def vertex_influences(mesh, owners):
    """Give every copy of a cut vertex the same joint weights.

    Triangle ownership alone opens the generated shell when a limb bends.
    Shared source vertices need identical blended positions on both sides.
    """
    counts = [dict() for _ in mesh.vertices]
    for face, owner in zip(mesh.faces, owners):
        for vertex in face:
            weights = counts[int(vertex)]
            bone = int(owner)
            weights[bone] = weights.get(bone, 0) + 1
    return [{bone: count / sum(weights.values()) for bone, count in weights.items()}
            for weights in counts]


CLIP_RANGES = {"idle": (0, 40), "attack": (150, 240),
               "hit": (290, 350), "victory": (400, 500)}


def timeline(first, last, loop=False):
    records = [{"value": frame, "loop_target": 0, "aux": None}
               for frame in range(first, last + 1)]
    records.append({"value": 0x8000 if loop else 0xffff,
                    "loop_target": 0 if loop else 0xffff, "aux": None})
    return {"table": records}


def keyed_motion(row):
    """Sample per-joint, clip-local Euler curves declared in a model recipe.

    A curve point is [clip fraction, x, y, z] in native 4096-unit turns.
    Shared clip boundaries are held at rest to avoid a snap between actions.
    """
    curves = row.get("motion_curves")
    if not curves:
        return None
    result = []
    for name, (start, end) in CLIP_RANGES.items():
        points = curves.get(name, [[0, 0, 0, 0], [1, 0, 0, 0]])
        if (not isinstance(points, list) or len(points) < 2 or
                any(not isinstance(p, list) or len(p) != 4 or
                    not all(isinstance(v, (int, float)) and math.isfinite(v) for v in p)
                    for p in points)):
            raise ValueError(f"{row['id']}: invalid {name} motion curve")
        times = [p[0] for p in points]
        if times[0] != 0 or times[-1] != 1 or any(a >= b for a, b in zip(times, times[1:])):
            raise ValueError(f"{row['id']}: {name} curve must span 0..1 with increasing times")
        if any(abs(angle) > 600 for p in points for angle in p[1:]):
            raise ValueError(f"{row['id']}: {name} rotation exceeds 600 units")
        frames = sorted({round(start + p[0]*(end-start)) for p in points} |
                        {round(start + i*(end-start)/24) for i in range(25)})
        for frame in frames:
            t = (frame-start)/(end-start)
            upper = next(i for i in range(1, len(points)) if points[i][0] >= t-1e-9)
            lower = upper-1
            blend = (t-points[lower][0])/(points[upper][0]-points[lower][0])
            angles = [round(points[lower][axis]*(1-blend)+points[upper][axis]*blend)
                      for axis in (1, 2, 3)]
            result.append([*angles, frame])
    return result


def make_tracks(row):
    keyed = keyed_motion(row)
    if keyed is not None:
        return keyed
    raise ValueError(f"{row['id']}: every GLB joint needs authored motion_curves")


def make_root_track(attach, recipe):
    movement = recipe.get("root_motion_curves")
    if not movement:
        return [[*np.round(attach, 4).tolist(), 0]]
    keys = []
    for name, (start, end) in CLIP_RANGES.items():
        points = movement[name]
        if len(points) < 2 or points[0][0] != 0 or points[-1][0] != 1 or any(
                a[0] >= b[0] for a, b in zip(points, points[1:])):
            raise ValueError(f"root_motion_curves {name} must span 0..1")
        for point in points:
            if len(point) != 4 or not all(math.isfinite(v) and abs(v) <= 300 for v in point[1:]):
                raise ValueError(f"root_motion_curves {name} needs bounded side/up/forward")
            side, up, forward = point[1:]
            position = attach + np.asarray([side, -up, forward])
            keys.append([*np.round(position, 4).tolist(), round(start + point[0]*(end-start))])
    return keys


def face_color(center, normal, fallback, reference, recipe, bounds):
    projection = recipe.get("reference_projection")
    color = fallback
    if projection and abs(normal[projection.get("side_axis", 2)]) >= projection.get("min_side_normal", .45):
        crop = projection["crop"]
        u_axis, v_axis = projection.get("axes", [0, 1])
        u = (center[u_axis]-bounds[0, u_axis]) / (bounds[1, u_axis]-bounds[0, u_axis])
        v = (center[v_axis]-bounds[0, v_axis]) / (bounds[1, v_axis]-bounds[0, v_axis])
        if projection.get("flip_u", False):
            u = 1-u
        if projection.get("flip_v", True):
            v = 1-v
        px = round((crop[0]+u*(crop[2]-crop[0]))*(reference.width-1))
        py = round((crop[1]+v*(crop[3]-crop[1]))*(reference.height-1))
        if 0 <= px < reference.width and 0 <= py < reference.height:
            sampled = reference.getpixel((px, py))[:3]
            # White grid/page space is not a color on the creature.
            red, green, blue = sampled
            is_blue = blue > 65 and blue > red*1.12 and blue > green*1.04
            is_orange = red > 110 and red > green*1.25 and red > blue*1.3 and green > 35
            is_red = red > 65 and red > green*1.5 and red > blue*1.4
            is_gray = max(sampled)-min(sampled) < 35 and 55 < red < 180
            if is_blue or is_orange or is_red or (is_gray and projection.get("allow_gray", False)):
                color = sampled
    light = np.asarray(recipe.get("light", [.3, .4, 1.0]), float)
    light /= np.linalg.norm(light)
    shade = .72 + .28*max(0, float(normal @ light))
    return tuple(max(0, min(255, round(channel*shade))) for channel in color)


def make_model(mesh, recipe, reference):
    ids = checked_recipe(recipe)
    scale = float(recipe.get("scale", 1100))
    if not math.isfinite(scale) or not 100 <= scale <= 10000:
        raise ValueError("scale must be 100..10000")
    owners = segment_owners(mesh, recipe)
    joints = recipe["joints"]
    influences = vertex_influences(mesh, owners)
    if len(joints) > 64:
        raise ValueError("atlas supports at most 64 joints")
    tile = 8
    side = 1 << math.ceil(math.log2(max(256, math.ceil(math.sqrt(len(mesh.faces)))*tile)))
    if side > 2048:
        raise ValueError("mesh needs atlas larger than 2048")
    atlas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    draw = ImageDraw.Draw(atlas)
    bones = []
    stats = []
    for index, row in enumerate(joints):
        face_ids = np.flatnonzero(owners == index)
        if len(face_ids) < 4:
            raise ValueError(f"joint {row['id']} owns only {len(face_ids)} faces; refine its guide")
        source_faces = mesh.faces[face_ids]
        unique, inverse = np.unique(source_faces.reshape(-1), return_inverse=True)
        parent = ids[row["parent"]] if row.get("parent") else None
        world_joint = np.asarray(row["joint"], float)
        local_joint = world_joint - np.asarray(joints[parent]["joint"], float) if parent is not None else world_joint
        verts = transform(mesh.vertices[unique] - world_joint, recipe) * scale
        skin = []
        for vertex in unique:
            weights = influences[int(vertex)]
            if len(weights) == 1:
                skin.append(None)
                continue
            skin.append([[other, round(weight, 8), *np.round(
                transform(mesh.vertices[int(vertex)] - np.asarray(joints[other]["joint"]), recipe)
                * scale, 4).tolist()] for other, weight in sorted(weights.items())])
        attach = transform(local_joint, recipe) * scale
        if not np.isfinite(verts).all() or np.max(np.abs(verts)) > 20000:
            raise ValueError(f"joint {row['id']} has invalid or extreme local coordinates")
        sample = row.get("sample", [.2, .5])
        px = min(reference.width-1, max(0, round(sample[0]*(reference.width-1))))
        py = min(reference.height-1, max(0, round(sample[1]*(reference.height-1))))
        color = reference.getpixel((px, py))[:3]
        faces = []
        for face_id, (a, b, c) in zip(face_ids, inverse.reshape(-1, 3)):
            col, line = int(face_id) % (side//tile), int(face_id) // (side//tile)
            x0, y0 = col*tile, line*tile
            pigment = face_color(mesh.triangles_center[face_id], mesh.face_normals[face_id],
                                 color, reference, recipe, mesh.bounds)
            draw.rectangle((x0, y0, x0+tile-1, y0+tile-1), fill=(*pigment, 255))
            uv = [(x0+4)*256/side, (y0+4)*256/side]
            faces.append([int(a), int(b), int(c), *uv, *uv, *uv])
        bones.append({"parent_slot": parent+1 if parent is not None else 0,
                      "verts": np.round(verts, 4).tolist(), "faces": faces,
                      "skin": skin,
                      "anim": {"ch1": make_root_track(attach, recipe) if parent is None
                               else [[*np.round(attach, 4).tolist(), 0]],
                               "ch2": make_tracks(row),
                               "ch3": [[4096, 4096, 4096, 0]]}})
        stats.append({"id": row["id"], "faces": len(faces), "vertices": len(verts), "color": color})
    tables = [{"table": []} for _ in range(62)]
    for index, first, last, loop in ((0, 0, 40, True),
                                     (14, 150, 176, False),  # crouch and draw back
                                     (15, 177, 209, False),  # drive the claw forward
                                     (16, 210, 225, False),  # weight follows the strike
                                     (17, 226, 239, False),  # step back
                                     (18, 240, 255, False),  # settle into idle
                                     (3, 290, 315, False), (4, 316, 350, False),
                                     (44, 400, 500, False)):
        tables[index] = timeline(first, last, loop)
    slots = recipe.get("action_slots", {"attack": [5], "hit": [1, 2, 3, 4], "victory": [17]})
    used_slots = [slot for group in slots.values() for slot in group]
    if any(not isinstance(slot, int) or not 0 <= slot < 18 for slot in used_slots) or len(set(used_slots)) != len(used_slots):
        raise ValueError("action_slots must contain distinct slot numbers 0..17")
    ranges = {"idle": (0, 40), "attack": (150, 255),
              "hit": (290, 350), "victory": (400, 500)}
    clips = []
    actions = []
    for i in range(18):
        name = next((kind for kind, group in slots.items() if i in group), "idle")
        start, end = ranges[name]
        clips.append({"index": i, "name": name, "present": True, "start_frame": start,
                      "end_frame": end, "loop_count": 1})
        sequence = {"idle": [], "attack": [14, 15, 16, 17, 18],
                    "hit": [3, 4], "victory": [44]}[name]
        ops = []
        for table in sequence:
            ops.extend(({"op": 2, "words": [0, 0, table]},
                        {"op": 2, "words": [0, 0, 0]}))
            if name == "attack" and table == 15:
                ops.append({"op": 10, "words": [99, 0]})
        if name != "victory":
            ops.append({"op": 2, "words": [0, 0, 1]})
            ops.append({"op": 4, "words": [0, 0]})
        ops.append({"op": 255, "words": []})
        actions.append({"ops": ops, "overrun": False})
    model = {"folder": recipe["output_model"], "num_bones": len(bones),
             "total_frames": 500, "bones": bones, "timeline": tables,
             "clips": clips, "actions": actions}
    # The battle arena places a model's ground at raw Y=0. Align the lowest
    # rest-pose foot instead of centering the imported GLB around the floor.
    rest = pose(model, 0)
    ground_y = max(float((np.asarray(rotation) @ np.asarray(bone["verts"]).T)[1].max()
                         + translation[1]) for bone, (translation, rotation) in zip(bones, rest))
    for key in bones[0]["anim"]["ch1"]:
        key[1] = round(key[1] - ground_y, 4)
    model["ground_offset"] = round(ground_y, 4)
    if "preview_clip" in recipe:
        preview = recipe["preview_clip"]
        if not isinstance(preview, int) or not 0 <= preview < len(clips):
            raise ValueError("preview_clip must be a clip index 0..17")
        model["preview_clip"] = preview
    return model, atlas, stats, owners


def validate_seams(mesh, owners, recipe, model, frames):
    # The import is a single watertight shell; face partitioning must preserve
    # every original edge in the bind pose (including cuts between bones).
    edge_faces = mesh.face_adjacency
    seams = edge_faces[owners[edge_faces[:, 0]] != owners[edge_faces[:, 1]]]
    _, edge_uses = np.unique(mesh.edges_unique_inverse, return_counts=True)
    boundary = int(np.count_nonzero(edge_uses == 1))
    if boundary > max(40, len(edge_uses)*.005):
        raise ValueError(f"decimation left {boundary} open mesh edges")
    if np.count_nonzero(edge_uses > 2) > max(30, len(edge_uses)*.005):
        raise ValueError("decimation created excessive nonmanifold edges")
    incident = {}
    for triangle, owner in zip(mesh.faces, owners):
        for vertex in triangle:
            incident.setdefault(int(vertex), set()).add(int(owner))
    shared = {vertex: sorted(parts) for vertex, parts in incident.items() if len(parts) > 1}
    source_local = {}
    for part in range(len(model["bones"])):
        face_ids = np.flatnonzero(owners == part)
        source_local[part] = {int(vertex): index for index, vertex in enumerate(
            np.unique(mesh.faces[face_ids].reshape(-1)))}
    max_gap = 0.0
    worst = None
    scale = float(recipe.get("scale", 1100))
    for frame in frames:
        matrices = pose(model, frame)
        for vertex, parts in shared.items():
            original = mesh.vertices[vertex]
            world = []
            for part in parts:
                local_index = source_local[part][vertex]
                entries = model["bones"][part]["skin"][local_index]
                if entries is None:
                    local = transform(original - recipe["joints"][part]["joint"], recipe) * scale
                    entries = [[part, 1.0, *local.tolist()]]
                point = np.zeros(3)
                for influence, weight, *local in entries:
                    translation, rotation = matrices[influence]
                    point += weight*(np.asarray(translation) + np.asarray(rotation) @ local)
                world.append(point)
            for i, a in enumerate(world):
                for j in range(i+1, len(world)):
                    distance = float(np.linalg.norm(a-world[j]))
                    if distance > max_gap:
                        max_gap = distance
                        worst = (frame, recipe["joints"][parts[i]]["id"],
                                 recipe["joints"][parts[j]]["id"])
    allowed = float(recipe.get("max_seam_gap", 0.1))
    if max_gap > allowed:
        raise ValueError(f"animated seam opens {max_gap:.1f} units at {worst}, limit {allowed:.1f}")
    return {"edges": len(seams), "vertices": len(shared), "max_animated_gap": round(max_gap, 2)}


def convert(recipe_path, output=None):
    recipe_path = Path(recipe_path).resolve()
    recipe = json.loads(recipe_path.read_text())
    checked_recipe(recipe)
    source = Path(recipe["source_glb"])
    if not source.is_absolute():
        source = ROOT / source
    reference = Path(recipe["reference"])
    if not reference.is_absolute():
        reference = ROOT / reference
    target = Path(output).resolve() if output else ROOT / "data/custom" / recipe["output_model"]
    max_faces = int(recipe.get("max_faces", 5000))
    if not 100 <= max_faces <= 20000:
        raise ValueError("max_faces must be 100..20000")
    mesh, source_faces = load_mesh(source, max_faces, float(recipe.get("scale", 1100)))
    with Image.open(reference) as image:
        model, atlas, stats, owners = make_model(mesh, recipe, image.convert("RGB"))
    frames = sorted({key[3] for bone in model["bones"] for key in bone["anim"]["ch2"]})
    seams = validate_seams(mesh, owners, recipe, model, frames)
    validate_generated(model, atlas, [], frames, [0]*len(model["bones"]))
    target.mkdir(parents=True, exist_ok=True)
    (target / "anim.json").write_text(json.dumps(model, separators=(",", ":")) + "\n")
    atlas.save(target / "texture.png")
    validated = validate_native(recipe["output_model"], target.parent)
    report = {"source": str(source), "source_faces": source_faces,
              "converted_faces": len(mesh.faces), "seams": seams,
              "native_validation": validated, "parts": stats}
    (target / "conversion-report.json").write_text(json.dumps(report, indent=2) + "\n")
    return target, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recipe", help="JSON recipe with source_glb, reference and joint guides")
    parser.add_argument("--output", help="output folder (default data/custom/<output_model>)")
    parser.add_argument("--install-web", action="store_true",
                        help="copy the validated bundle into the standalone model viewer")
    args = parser.parse_args()
    target, report = convert(args.recipe, args.output)
    if args.install_web:
        model_id = json.loads(Path(args.recipe).read_text())["output_model"]
        model_dir = ROOT / "web/assets/battle/models" / model_id
        model_dir.mkdir(parents=True, exist_ok=True)
        texture_dir = ROOT / "web/assets/battle/textures"
        texture_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(target / "anim.json", model_dir / "anim.json")
        shutil.copyfile(target / "texture.png", texture_dir / f"{model_id}.png")
    print(json.dumps({"output": str(target), **report}, indent=2))


if __name__ == "__main__":
    main()
