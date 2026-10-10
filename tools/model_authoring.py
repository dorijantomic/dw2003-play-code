#!/usr/bin/env python3
"""Data-driven authoring for the browser's decoded DW3 battle-model format.

Catalog rows contain measurements; the original anim.json and PNG remain the
lossless, lazy-loaded part payload. Recipes contain selections and dimensions,
never vertex indices or hand-authored polygons.
"""

import argparse
import copy
import io
import json
import math
import statistics
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "web/assets/battle"
CATALOG = ROOT / "data/model-authoring/catalog.json"
DATABASE = ROOT / "data/model-authoring/catalog.sqlite"


def vec(a, b):
    return [a[i] + b[i] for i in range(3)]


def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def mul(a, k):
    return [v * k for v in a]


def dot(a, b):
    return sum(a[i] * b[i] for i in range(3))


def norm(a):
    d = math.sqrt(dot(a, a))
    return mul(a, 1 / d) if d else [0, 0, 0]


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def matmul(a, b):
    return [[sum(a[i][k]*b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def mv(a, v):
    return [dot(row, v) for row in a]


IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]


def rotation(ch2):
    # Decoded channel order: [az, ay, ax]; local Rz(ax) Ry(ay) Rx(az).
    az, ay, ax = [n * math.tau / 4096 for n in ch2[:3]]
    cx, sx, cy, sy, cz, sz = math.cos(az), math.sin(az), math.cos(ay), math.sin(ay), math.cos(ax), math.sin(ax)
    rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return matmul(matmul(rz, ry), rx)


def sample(keys, frame):
    if frame <= keys[0][3]:
        return keys[0][:3]
    for a, b in zip(keys, keys[1:]):
        if frame <= b[3]:
            t = (frame-a[3])/(b[3]-a[3])
            return [a[i]*(1-t)+b[i]*t for i in range(3)]
    return keys[-1][:3]


def pose(model, frame=0):
    """Math-space FK; renderer's final D flip does not alter distances."""
    out = []
    for bone in model["bones"]:
        parent = bone["parent_slot"] - 1
        anim = bone.get("anim") or {"ch1": [[0, 0, 0, 0]], "ch2": [[0, 0, 0, 0]]}
        translation = sample(anim["ch1"], frame)
        local_rot = rotation(sample(anim["ch2"], frame))
        if parent < 0:
            out.append((translation, local_rot))
        else:
            pt, pr = out[parent]
            out.append((vec(pt, mv(pr, translation)), matmul(pr, local_rot)))
    return out


def bounds(points):
    return [[min(p[i] for p in points), max(p[i] for p in points)] for i in range(3)] if points else [[0, 0]]*3


def center(box):
    return [(lo+hi)/2 for lo, hi in box]


def regions(bone):
    """Triangle connected components via shared vertex ownership."""
    faces = bone["faces"]
    linked = defaultdict(list)
    for fi, f in enumerate(faces):
        for vi in f[:3]:
            linked[vi].append(fi)
    seen, result = set(), []
    for fi in range(len(faces)):
        if fi in seen:
            continue
        queue, members, vertices = [fi], [], set()
        seen.add(fi)
        while queue:
            fidx = queue.pop()
            members.append(fidx)
            for vi in faces[fidx][:3]:
                vertices.add(vi)
                for next_face in linked[vi]:
                    if next_face not in seen:
                        seen.add(next_face)
                        queue.append(next_face)
        points = [bone["verts"][i] for i in vertices]
        edges = Counter(tuple(sorted((faces[fidx][a], faces[fidx][b])))
                        for fidx in members for a, b in ((0, 1), (1, 2), (2, 0)))
        result.append({"faces": len(members), "vertices": len(vertices), "bounds": bounds(points),
                       "centroid": [statistics.fmean(p[i] for p in points) for i in range(3)],
                       "boundary_edges": sum(n == 1 for n in edges.values()),
                       "nonmanifold_edges": sum(n > 2 for n in edges.values())})
    return sorted(result, key=lambda r: -r["faces"])


def children(model):
    result = defaultdict(list)
    for i, bone in enumerate(model["bones"]):
        anim = bone.get("anim") or {"ch1": [[0, 0, 0, 0]], "ch2": [[0, 0, 0, 0]], "ch3": [[4096, 4096, 4096, 0]]}
        if bone["parent_slot"]:
            result[bone["parent_slot"]-1].append(i)
    return result


def subtree(root, tree):
    found = [root]
    for node in found:
        found.extend(tree[node])
    return found


def cross_section(bone, axis, end="start"):
    points = bone["verts"]
    if len(points) < 4:
        return 0, 0
    axis = norm(axis)
    projections = [dot(p, axis) for p in points]
    lo, hi = min(projections), max(projections)
    if hi-lo < 2:
        return 0, 0
    selected = [p for p, value in zip(points, projections)
                if (value <= lo+(hi-lo)*.22 if end == "start" else value >= hi-(hi-lo)*.22)]
    if len(selected) < 3:
        selected = sorted(points, key=lambda p: dot(p, axis), reverse=end == "end")[:max(3, len(points)//5)]
    centroid = [statistics.fmean(p[j] for p in selected) for j in range(3)]
    radii = [math.sqrt(max(0, dot(sub(p, centroid), sub(p, centroid)) - dot(sub(p, centroid), axis)**2)) for p in selected]
    return statistics.median(radii), len(selected)


def describe(model):
    poses = pose(model)
    tree = children(model)
    all_points = [vec(t, mv(r, v)) for (t, r), b in zip(poses, model["bones"]) for v in b["verts"]]
    overall = bounds(all_points)
    bones = []
    for i, bone in enumerate(model["bones"]):
        anim = bone.get("anim") or {"ch1": [[0, 0, 0, 0]], "ch2": [[0, 0, 0, 0]], "ch3": [[4096, 4096, 4096, 0]]}
        vertices = bone["verts"]
        box = bounds(vertices)
        normals = []
        for f in bone["faces"]:
            a, b, c = [vertices[k] for k in f[:3]]
            n = cross(sub(b, a), sub(c, a))
            if dot(n, n) > 1:
                normals.append(norm(n))
        uv = [(f[k], f[k+1]) for f in bone["faces"] for k in (3, 5, 7)]
        t, r = poses[i]
        pts = [vec(t, mv(r, v)) for v in vertices]
        bones.append({"parent": bone["parent_slot"]-1, "children": tree[i],
                      "bind_local": anim["ch1"][0][:3], "bind_world": t,
                      "bind_rotation": anim["ch2"][0][:3],
                      "vertices": len(vertices), "triangles": len(bone["faces"]),
                      "bounds_local": box, "bounds_world": bounds(pts),
                      "uv_bounds": bounds([[u, v, 0] for u, v in uv])[:2],
                      "regions": regions(bone),
                      "mean_normal": norm([sum(n[j] for n in normals) for j in range(3)]) if normals else [0, 0, 0],
                      "motion": {ch: {"keys": len(anim[ch]),
                                      "range": [max(k[j] for k in anim[ch])-min(k[j] for k in anim[ch]) for j in range(3)]}
                                 for ch in ("ch1", "ch2", "ch3")}})
    # Every branch-root candidate is a lossless transplantable subtree. No label is inferred.
    parts = []
    size = max(max(hi-lo for lo, hi in overall), 1)
    for root in range(1, len(bones)):
        nodes = subtree(root, tree)
        if len(nodes) > 9 or sum(bones[i]["triangles"] for i in nodes) < 3:
            continue
        root_pt = poses[root][0]
        tips = [i for i in nodes if not tree[i]]
        far_tip = max(tips, key=lambda i: dot(sub(poses[i][0], root_pt), sub(poses[i][0], root_pt)))
        delta = sub(poses[far_tip][0], root_pt)
        first_child = model["bones"][tree[root][0]] if tree[root] else None
        start_axis = first_child["anim"]["ch1"][0][:3] if first_child and first_child.get("anim") else delta
        root_radius, ring_count = cross_section(model["bones"][root], start_axis)
        tip_radius, _ = cross_section(model["bones"][far_tip], delta, "end")
        taper = tip_radius/root_radius if root_radius > 1 else 1
        local_boxes = [bones[i]["bounds_world"] for i in nodes]
        pts = [[min(box[j][0] for box in local_boxes), max(box[j][1] for box in local_boxes)] for j in range(3)]
        parts.append({"root": root, "bones": nodes, "bone_count": len(nodes),
                      "triangles": sum(bones[i]["triangles"] for i in nodes),
                      "direction": norm(delta), "length": math.sqrt(dot(delta, delta)),
                      "relative_length": math.sqrt(dot(delta, delta))/size,
                      "root_position": root_pt, "tip_position": poses[far_tip][0],
                      "bounds_world": pts,
                      "branching": sum(len(tree[i]) > 1 for i in nodes),
                      "taper_ratio": round(min(taper, 4), 5), "ring_vertices": ring_count,
                      "animation_energy": sum(sum(bones[i]["motion"]["ch2"]["range"]) for i in nodes)})
    return {"folder": model["folder"], "bones": bones, "bounds": overall,
            "parts": parts, "bone_count": len(bones), "triangles": sum(b["triangles"] for b in bones)}


def build_catalog(asset_root=ASSETS):
    model_root = asset_root / "models"
    index = json.loads((model_root / "index.json").read_text())
    catalog = {"schema": 1, "models": {}, "patterns": {}}
    lengths, segments, triangles = [], [], []
    from export_fight_anim import MODEL_DIR
    for folder in index:
        # Index may include custom browser models; the library is the decoded
        # game collection, identified by source-pack membership, not names.
        if not (MODEL_DIR / folder).is_dir():
            continue
        model = json.loads((model_root / folder / "anim.json").read_text())
        row = describe(model)
        row["model_path"] = str((model_root / folder / "anim.json").relative_to(ROOT))
        row["texture_path"] = str((asset_root / "textures" / f"{folder}.png").relative_to(ROOT))
        catalog["models"][folder] = row
        for part in row["parts"]:
            if 2 <= part["bone_count"] <= 7:
                lengths.append(part["relative_length"])
                segments.append(part["bone_count"])
            triangles.extend(region["faces"] for bone in row["bones"] for region in bone["regions"] if region["faces"] <= 20)
    if not catalog["models"]:
        raise ValueError("no decoded models found")
    clusters = discover_patterns(catalog)
    catalog["patterns"] = {"articulated_relative_length_median": statistics.median(lengths),
                            "articulated_bones_median": statistics.median(segments),
                            "small_component_faces_median": statistics.median(triangles),
                            "sampled_parts": len(lengths), "clusters": clusters}
    return catalog


def part_features(row, part):
    """Dimensionless, orientation-aware features for unlabeled part families."""
    box = row["bounds"]
    size = [max(hi-lo, 1) for lo, hi in box]
    center_pt = center(box)
    root = part["root_position"]
    regions = [region for i in part["bones"] for region in row["bones"][i]["regions"]]
    boundary = sum(region["boundary_edges"] for region in regions)
    edge_estimate = max(sum(region["faces"]*3 for region in regions), 1)
    return [min(part["bone_count"]/7, 1), min(part["relative_length"], 1),
            min(part["triangles"]/400, 1), min(part["branching"]/3, 1),
            *part["direction"],
            *((root[i]-center_pt[i])/size[i] for i in range(3)),
            min(part["animation_energy"]/6000, 1),
            min(len(regions)/8, 1), boundary/edge_estimate,
            min(part["taper_ratio"]/2, 1)]


def discover_patterns(catalog, count=18):
    """Deterministic structural clustering; labels are optional annotations."""
    rows = [(folder, part, part_features(row, part))
            for folder, row in catalog["models"].items() for part in row["parts"]]
    vectors = [r[2] for r in rows]
    if not vectors:
        return []
    count = min(count, len(vectors))
    # Quantile seeds are reproducible across runs and avoid name-derived classes.
    centroids = [vectors[i*(len(vectors)-1)//count][:] for i in range(count)]
    for _ in range(12):
        memberships = [[] for _ in centroids]
        for i, point in enumerate(vectors):
            ci = min(range(count), key=lambda c: sum((point[j]-centroids[c][j])**2 for j in range(len(point))))
            memberships[ci].append(i)
        new = [[statistics.fmean(vectors[i][j] for i in group) for j in range(len(vectors[0]))]
               if group else centroids[c] for c, group in enumerate(memberships)]
        if all(math.dist(a, b) < 1e-5 for a, b in zip(centroids, new)):
            break
        centroids = new
    patterns = []
    for ci, group in enumerate(memberships):
        if not group:
            continue
        ranked = sorted(group, key=lambda i: math.dist(vectors[i], centroids[ci]))
        examples = [{"model": rows[i][0], "root": rows[i][1]["root"]} for i in ranked[:5]]
        patterns.append({"id": ci, "members": len(group), "center": [round(x, 5) for x in centroids[ci]],
                         "examples": examples,
                         "bone_count_median": statistics.median(rows[i][1]["bone_count"] for i in group),
                         "ring_vertices_median": statistics.median(rows[i][1]["ring_vertices"] for i in group),
                         "taper_ratio_median": statistics.median(rows[i][1]["taper_ratio"] for i in group),
                         "relative_length_median": statistics.median(rows[i][1]["relative_length"] for i in group),
                         "triangles_median": statistics.median(rows[i][1]["triangles"] for i in group),
                         "animation_energy_median": statistics.median(rows[i][1]["animation_energy"] for i in group)})
        for i in group:
            rows[i][1]["pattern"] = ci
    return patterns


def write_database(catalog, destination=DATABASE):
    """Lossless normalized store: geometry, rig, tracks, UVs and PNG pixels."""
    import sqlite3
    import tempfile
    from bake_clut_texture import bake_texture
    from export_fight_anim import MODEL_DIR
    pending = destination.with_suffix(".sqlite.tmp")
    if pending.exists():
        pending.unlink()
    with sqlite3.connect(pending) as db:
        db.executescript("""
            CREATE TABLE models (id TEXT PRIMARY KEY, bounds TEXT NOT NULL, texture_png BLOB NOT NULL);
            CREATE TABLE bones (model_id TEXT NOT NULL, bone_id INTEGER NOT NULL,
                parent_id INTEGER NOT NULL, bind_local TEXT NOT NULL, bind_world TEXT NOT NULL,
                bounds_local TEXT NOT NULL, bounds_world TEXT NOT NULL, regions TEXT NOT NULL,
                mean_normal TEXT NOT NULL, motion TEXT NOT NULL,
                vertices TEXT NOT NULL, triangles TEXT NOT NULL, animation_tracks TEXT,
                PRIMARY KEY(model_id, bone_id));
            CREATE TABLE parts (model_id TEXT NOT NULL, root_bone INTEGER NOT NULL,
                pattern INTEGER NOT NULL, bone_count INTEGER NOT NULL, triangle_count INTEGER NOT NULL,
                relative_length REAL NOT NULL, direction_x REAL NOT NULL, direction_y REAL NOT NULL,
                direction_z REAL NOT NULL, descriptor TEXT NOT NULL,
                PRIMARY KEY(model_id, root_bone));
            CREATE INDEX parts_shape ON parts(pattern, bone_count, relative_length);
            CREATE INDEX parts_direction ON parts(direction_x, direction_y, direction_z);
        """)
        with tempfile.TemporaryDirectory() as scratch:
            for folder, row in catalog["models"].items():
                model = json.loads((ROOT / row["model_path"]).read_text())
                baked = Path(scratch) / f"{folder}.png"
                bake_texture(str(MODEL_DIR / folder), str(baked), 1)
                png = baked.read_bytes()
                db.execute("INSERT INTO models VALUES (?,?,?)", (folder, json.dumps(row["bounds"]), png))
                for i, (bone, data) in enumerate(zip(model["bones"], row["bones"])):
                    db.execute("INSERT INTO bones VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                               (folder, i, data["parent"], json.dumps(data["bind_local"]),
                                json.dumps(data["bind_world"]), json.dumps(data["bounds_local"]),
                                json.dumps(data["bounds_world"]), json.dumps(data["regions"]),
                                json.dumps(data["mean_normal"]), json.dumps(data["motion"]),
                                json.dumps(bone["verts"]), json.dumps(bone["faces"]),
                                json.dumps(bone.get("anim"))))
                for part in row["parts"]:
                    db.execute("INSERT INTO parts VALUES (?,?,?,?,?,?,?,?,?,?)",
                               (folder, part["root"], part["pattern"], part["bone_count"],
                                part["triangles"], part["relative_length"], *part["direction"],
                                json.dumps(part)))
    pending.replace(destination)


def source_texture(folder, database=DATABASE):
    import sqlite3
    with sqlite3.connect(database) as db:
        row = db.execute("SELECT texture_png FROM models WHERE id=?", (folder,)).fetchone()
    if row is None:
        raise ValueError(f"no decoded source texture for {folder}")
    return Image.open(io.BytesIO(row[0])).convert("RGBA")


def search_parts(catalog, query, limit=8):
    """Rank by structure and optional size/anchor/axis descriptors.

    The optional descriptor follows the retrieval terms in Kinematic
    Kitbashing (Appendix F), using DW3's measured bounds as its local frame.
    """
    scored = []
    for folder, row in catalog["models"].items():
        if folder in query.get("exclude_models", []):
            continue
        for part in row["parts"]:
            score = 0
            if "pattern" in query and part["pattern"] != query["pattern"]:
                continue
            if "direction" in query:
                score += 3*(1-dot(part["direction"], norm(query["direction"])))
            if "bone_count" in query:
                score += abs(part["bone_count"]-query["bone_count"])*0.65
            if "relative_length" in query:
                score += abs(part["relative_length"]-query["relative_length"])*4
            if "branching" in query:
                score += abs(part["branching"]-query["branching"])*2
            if "centerline" in query and query["centerline"]:
                score += abs(part["root_position"][0])/max(row["bounds"][0][1]-row["bounds"][0][0], 1)*4
            if "box" in query:
                extents = [max(hi-lo, 1) for lo, hi in part["bounds_world"]]
                if len(query["box"]) != 3 or any(v <= 0 for v in query["box"]):
                    raise ValueError("box descriptor requires three positive extents")
                score += sum((math.log(extents[i]/query["box"][i]))**2 for i in range(3))
            if "anchor" in query:
                extents = [max(hi-lo, 1) for lo, hi in part["bounds_world"]]
                anchor = [(part["root_position"][i]-part["bounds_world"][i][0])/extents[i]
                          for i in range(3)]
                if len(query["anchor"]) != 3:
                    raise ValueError("anchor descriptor requires three coordinates")
                score += sum((anchor[i]-query["anchor"][i])**2 for i in range(3))
            if "joint_axis" in query:
                motion = row["bones"][part["root"]]["motion"]["ch2"]["range"]
                axis = max(range(3), key=lambda i: motion[i])
                if motion[axis] > 0:
                    canonical = [[0, 0, 1], [0, 1, 0], [1, 0, 0]][axis]
                    score += 1-abs(dot(canonical, norm(query["joint_axis"])))
            scored.append((round(score, 5), folder, part))
    return sorted(scored, key=lambda x: (x[0], x[1], x[2]["root"]))[:limit]


def select_part(row, query):
    if query.get("root") is not None:  # Expert override; not required by recipes.
        return next(p for p in row["parts"] if p["root"] == query["root"])
    scored = []
    for part in row["parts"]:
        score = 0
        if query.get("centerline"):
            width = max(row["bounds"][0][1]-row["bounds"][0][0], 1)
            score += abs(part["root_position"][0])/width*5
        if "direction" in query:
            score += 3*(1-dot(part["direction"], norm(query["direction"])))
        if "bone_count" in query:
            score += abs(part["bone_count"]-query["bone_count"])*0.7
        if "root_position" in query:
            origin = center(row["bounds"])
            extent = [max(hi-lo, 1) for lo, hi in row["bounds"]]
            relative = [(part["root_position"][i]-origin[i])/extent[i] for i in range(3)]
            score += sum(abs(relative[i]-query["root_position"][i]) for i in range(3))*3
        scored.append((score, part["root"], part))
    if not scored:
        raise ValueError("no matching part")
    return min(scored)[2]


def adapt_chain(model, part, axis, length_scale, thickness_scale):
    """Scale an entire articulated chain, including child bind translations."""
    if not .4 <= length_scale <= 2.5 or not .4 <= thickness_scale <= 2.5:
        raise ValueError("adapt scale outside supported range")
    axis = norm(axis)
    if dot(axis, axis) < .99:
        raise ValueError("zero adaptation axis")
    nodes = set(part["bones"])
    for i in nodes:
        bone = model["bones"][i]
        for v in bone["verts"]:
            projection = dot(v, axis)
            changed = vec(mul(axis, projection*length_scale), mul(sub(v, mul(axis, projection)), thickness_scale))
            v[:] = [round(x, 4) for x in changed]
        if i != part["root"]:
            for key in bone["anim"]["ch1"]:
                projection = dot(key[:3], axis)
                changed = vec(mul(axis, projection*length_scale), mul(sub(key[:3], mul(axis, projection)), thickness_scale))
                key[:3] = [round(x, 4) for x in changed]


def curve_chain_to_reference(model, part, start, tip, image_aspect=1):
    """Fit an articulated chain's side elevation from two image landmarks."""
    if len(part["bones"]) < 2 or abs(tip[0]-start[0]) < .01:
        raise ValueError("chain curve needs an articulated part and separated side landmarks")
    target_angle = math.degrees(math.atan2(start[1]-tip[1], abs(tip[0]-start[0])*image_aspect))
    last = part["bones"][-1]
    initial_pose = pose(model)
    root = part["root"]
    origin = initial_pose[root][0]
    end_vertices = [vec(initial_pose[last][0], mv(initial_pose[last][1], v))
                    for v in model["bones"][last]["verts"]]
    endpoint_index = max(range(len(end_vertices)), key=lambda i: end_vertices[i][2])

    def elevation():
        matrices = pose(model)
        endpoint = vec(matrices[last][0], mv(matrices[last][1], model["bones"][last]["verts"][endpoint_index]))
        delta = sub(endpoint, matrices[root][0])
        return math.degrees(math.atan2(-delta[1], abs(delta[2])))

    initial = elevation()
    best = (abs(initial-target_angle), 0, initial)
    weights = {bone: index/max(len(part["bones"])-1, 1)*1.5
               for index, bone in enumerate(part["bones"])}
    for degrees in range(-60, 61):
        offset = round(degrees*4096/360)
        for i in part["bones"]:
            model["bones"][i]["anim"]["ch2"][0][0] += round(offset*weights[i])
        found = elevation()
        if abs(found-target_angle) < best[0]:
            best = (abs(found-target_angle), degrees, found)
        for i in part["bones"]:
            model["bones"][i]["anim"]["ch2"][0][0] -= round(offset*weights[i])
    if best[0] > 12:
        raise ValueError(f"chain cannot reach reference angle: error {best[0]:.1f} degrees")
    offset = round(best[1]*4096/360)
    for i in part["bones"]:
        for key in model["bones"][i]["anim"]["ch2"]:
            key[0] += round(offset*weights[i])
    return {"root": root, "bones": part["bones"], "before_degrees": round(initial, 2),
            "target_degrees": round(target_angle, 2), "after_degrees": round(best[2], 2)}


def align_vectors(source, target):
    """Shortest 3D rotation between measured chain directions."""
    a, b = norm(source), norm(target)
    v = cross(a, b)
    cosine = max(-1, min(1, dot(a, b)))
    if cosine < -.9999:
        ref = [1, 0, 0] if abs(a[0]) < .8 else [0, 1, 0]
        v = norm(cross(a, ref))
        return [[2*v[i]*v[j] - (1 if i == j else 0) for j in range(3)] for i in range(3)]
    vx = [[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]]
    vv = matmul(vx, vx)
    factor = 1/(1+cosine)
    return [[IDENTITY[i][j] + vx[i][j] + vv[i][j]*factor for j in range(3)] for i in range(3)]


def point_triangle_distance(point, a, b, c):
    """Unsigned point-to-surface distance for motion-sampled joint clearance."""
    ab, ac, ap = sub(b, a), sub(c, a), sub(point, a)
    d00, d01, d11 = dot(ab, ab), dot(ab, ac), dot(ac, ac)
    d20, d21 = dot(ap, ab), dot(ap, ac)
    denominator = d00*d11-d01*d01
    if abs(denominator) > 1e-9:
        u = (d11*d20-d01*d21)/denominator
        v = (d00*d21-d01*d20)/denominator
        if u >= 0 and v >= 0 and u+v <= 1:
            return math.dist(point, vec(a, vec(mul(ab, u), mul(ac, v))))
    def segment(p, q):
        delta = sub(q, p)
        t = max(0, min(1, dot(sub(point, p), delta)/max(dot(delta, delta), 1e-9)))
        return math.dist(point, vec(p, mul(delta, t)))
    return min(segment(a, b), segment(b, c), segment(c, a))


def attachment_clearance(model, child, parent, vertex_indices, frames):
    """Sample the child-to-parent surface gap over several articulated poses."""
    profile = []
    parent_faces = model["bones"][parent]["faces"]
    if not parent_faces:
        raise ValueError("attachment parent has no mesh")
    for frame in frames:
        transforms = pose(model, frame)
        ct, cr = transforms[child]
        pt, pr = transforms[parent]
        child_vertices = model["bones"][child]["verts"]
        parent_vertices = [vec(pt, mv(pr, v)) for v in model["bones"][parent]["verts"]]
        triangles = [[parent_vertices[i] for i in f[:3]] for f in parent_faces]
        distances = []
        for i in vertex_indices:
            point = vec(ct, mv(cr, child_vertices[i]))
            distances.append(min(point_triangle_distance(point, *tri) for tri in triangles))
        profile.append(distances)
    return profile


def attachment_profile_error(source, target, scale):
    if len(source) != len(target) or any(len(a) != len(b) for a, b in zip(source, target)):
        raise ValueError("attachment profiles are incompatible")
    return statistics.fmean(abs(scale*a-b) for left, right in zip(source, target)
                            for a, b in zip(left, right))


def transplant(model, donor, donor_part, target_bone, attachment, scale=1, motion="inherit", direction=None):
    """Copy a complete subtree and rebase its root into target-bone local space."""
    if motion not in ("inherit", "retarget", "derived"):
        raise ValueError("motion must be inherit, retarget, or derived")
    if not .25 <= scale <= 3:
        raise ValueError("transplant scale outside supported range")
    if not 0 <= target_bone < len(model["bones"]):
        raise ValueError("target bone outside skeleton")
    if motion == "retarget" and abs(len(donor_part["bones"])-len(subtree(target_bone, children(model)))) > 1:
        raise ValueError("retarget requires compatible bone-chain depth")
    rot = align_vectors(donor_part["direction"], direction) if direction else IDENTITY
    mapping = {}
    for old in donor_part["bones"]:
        source = donor["bones"][old]
        copied = copy.deepcopy(source)
        parent = source["parent_slot"] - 1
        copied["parent_slot"] = target_bone+1 if old == donor_part["root"] else mapping[parent]+1
        copied["verts"] = [[round(x*scale, 4) for x in (mv(rot, v) if old == donor_part["root"] else v)] for v in copied["verts"]]
        if old == donor_part["root"]:
            copied["anim"]["ch1"] = [[*attachment, 0]]
        else:
            copied["anim"]["ch1"] = [[round(x*scale, 4) for x in (mv(rot, key[:3]) if parent == donor_part["root"] else key[:3])]+[key[3]] for key in copied["anim"]["ch1"]]
        if motion == "inherit":
            copied["anim"]["ch2"] = [[0, 0, 0, 0]]
            copied["anim"]["ch3"] = [[4096, 4096, 4096, 0]]
        elif motion == "derived":
            # Keep the observed donor motion shape at half amplitude, while
            # following the new parent's complete battle animation.
            first = copied["anim"]["ch2"][0][:3]
            copied["anim"]["ch2"] = [[round((key[j]-first[j])*.5) for j in range(3)]+[key[3]] for key in copied["anim"]["ch2"]]
        mapping[old] = len(model["bones"])
        model["bones"].append(copied)
    model["num_bones"] = len(model["bones"])
    return mapping


def copy_part_texture(model, copied_indices, donor, donor_indices, image, donor_image, occupied):
    """Copy the source UV patch with padding and remap its copied faces."""
    faces = [f for i in donor_indices for f in donor["bones"][i]["faces"]]
    if not faces:
        raise ValueError("source part has no textured faces")
    x0 = max(0, math.floor(min(f[k] for f in faces for k in (3, 5, 7)))-2)
    y0 = max(0, math.floor(min(f[k] for f in faces for k in (4, 6, 8)))-2)
    x1 = min(256, math.ceil(max(f[k] for f in faces for k in (3, 5, 7)))+2)
    y1 = min(256, math.ceil(max(f[k] for f in faces for k in (4, 6, 8)))+2)
    width, height = x1-x0, y1-y0
    if width >= 252 or height >= 252:
        raise ValueError("source UV patch is too large for target atlas")
    tx0, ty0, _, _ = allocate(occupied, width, height)
    scale = image.width/256
    if donor_image.width != image.width:
        donor_image = donor_image.resize(image.size, Image.Resampling.NEAREST)
    crop = donor_image.crop(tuple(round(n*scale) for n in (x0, y0, x1, y1)))
    image.paste(crop, (round(tx0*scale), round(ty0*scale)))
    du, dv = tx0-x0, ty0-y0
    for new_idx in copied_indices:
        for f in model["bones"][new_idx]["faces"]:
            for k in (3, 5, 7):
                f[k] += du
                f[k+1] += dv
    return {"source_uv": [x0, y0, x1, y1], "target_uv": [tx0, ty0, tx0+width, ty0+height]}


def surface_face(bone, position, direction, source_faces=None):
    """Find a face on the requested part of a surface with compatible normal."""
    box = bounds(bone["verts"])
    point = [box[i][0]+position[i]*(box[i][1]-box[i][0]) for i in range(3)]
    span = max(max(hi-lo for lo, hi in box), 1)
    face_edges = [statistics.median(math.dist(bone["verts"][f[i]], bone["verts"][f[(i+1)%3]]) for i in range(3))
                  for f in bone["faces"][:source_faces]]
    typical_edge = statistics.median(face_edges)
    picks = []
    for f, edge in zip(bone["faces"][:source_faces], face_edges):
        verts = [bone["verts"][i] for i in f[:3]]
        c = [statistics.fmean(v[j] for v in verts) for j in range(3)]
        normal = norm(cross(sub(verts[1], verts[0]), sub(verts[2], verts[0])))
        if dot(normal, normal) == 0:
            continue
        score = (math.sqrt(dot(sub(c, point), sub(c, point)))/span
                 + max(0, .4-dot(normal, direction))
                 + .25*max(0, edge/max(typical_edge, 1)-1))
        picks.append((score, f, c, normal))
    if not picks:
        raise ValueError("target mesh has no usable attachment face")
    return min(picks, key=lambda entry: entry[0])


def surface_bone(model, part, choice="most_faces"):
    if choice == "root":
        return part["root"]
    if choice == "tip":
        return part["bones"][-1]
    if choice == "most_faces":
        return max(part["bones"], key=lambda i: len(model["bones"][i]["faces"]))
    raise ValueError(f"unsupported surface-bone selector: {choice}")


def expand_sites(sites):
    """Execute a declarative symmetry macro in normalized part coordinates."""
    for site in sites:
        yield site
        if "mirror_axis" in site:
            axis = site["mirror_axis"]
            if not isinstance(axis, int) or axis not in (0, 1, 2):
                raise ValueError("mirror_axis must be 0, 1, or 2")
            reflected = copy.deepcopy(site)
            reflected["position"][axis] = 1-site["position"][axis]
            reflected["direction"][axis] = -site["direction"][axis]
            reflected.pop("mirror_axis")
            yield reflected


def protrusion(model, bone_id, position, direction, length_ratio, atlas_rect, learned):
    """Create a closed low-poly ridge on an existing triangle; it shares its rim."""
    bone = model["bones"][bone_id]
    direction = norm(direction)
    score, face, midpoint, face_normal = surface_face(bone, position, direction)
    if score > 1.2:
        raise ValueError(f"surface attachment too far from requested point ({score:.2f})")
    a, b, c = [bone["verts"][i] for i in face[:3]]
    edge = statistics.median([math.dist(a, b), math.dist(b, c), math.dist(c, a)])
    all_edges = [math.dist(bone["verts"][f[i]], bone["verts"][f[(i+1)%3]])
                 for f in bone["faces"] for i in range(3)]
    typical_edge = statistics.median(all_edges)
    if edge < 2:
        raise ValueError("attachment triangle too small")
    if edge > typical_edge*3:
        raise ValueError("attachment face is too large for a local protrusion")
    if not .35 <= length_ratio <= 5:
        raise ValueError("protrusion ratio outside supported range")
    # The mesh height is measured against its own edge and a library-derived
    # typical small-component face count; it is never authored as vertices.
    ratio = min(length_ratio, max(1, learned["small_component_faces_median"]/4))
    body_size = max(hi-lo for lo, hi in describe(model)["bounds"])
    height = min(edge*ratio, body_size*.14)
    tip = vec(midpoint, mul(direction, height))
    new_index = len(bone["verts"])
    bone["verts"].append([round(n, 4) for n in tip])
    u0, v0, u1, v1 = atlas_rect
    uvm = ((u0+2, v1-2), (u1-2, v1-2), ((u0+u1)/2, v0+2))
    rim = face[:3]
    for j in range(3):
        bone["faces"].append([rim[j], rim[(j+1)%3], new_index,
                              *uvm[j], *uvm[(j+1)%3], *uvm[2]])
    return {"bone": bone_id, "face": rim, "root": midpoint, "tip": tip, "edge": edge,
            "seam_distance": 0, "attachment_score": score}


def armor_shell(model, bone_id, position, direction, face_count, lift_ratio, atlas_rect, source_faces=None):
    """Raise a connected patch into a shallow fitted plate, retaining its rim.

    Face adjacency, position, normals and edge scale come from the source mesh.
    This works on any selected bone and does not depend on model or part names.
    """
    bone = model["bones"][bone_id]
    if not 2 <= face_count <= 32 or not .03 <= lift_ratio <= .4:
        raise ValueError("armor shell outside supported face count or lift range")
    score, seed, _, outward = surface_face(bone, position, norm(direction), source_faces)
    if score > 1.2:
        raise ValueError(f"armor shell attachment too far ({score:.2f})")
    faces = bone["faces"][:source_faces]
    seed_id = next(i for i, f in enumerate(faces) if f is seed)
    edge_map = defaultdict(list)
    for i, f in enumerate(faces):
        for j in range(3):
            edge_map[tuple(sorted((f[j], f[(j+1)%3])))].append(i)
    selected = {seed_id}
    while len(selected) < face_count:
        candidates = set()
        for i in selected:
            f = faces[i]
            for j in range(3):
                candidates.update(edge_map[tuple(sorted((f[j], f[(j+1)%3])))])
        candidates -= selected
        candidates = {i for i in candidates if abs(dot(norm(cross(
            sub(bone["verts"][faces[i][1]], bone["verts"][faces[i][0]]),
            sub(bone["verts"][faces[i][2]], bone["verts"][faces[i][0]]))), outward)) > .2}
        if not candidates:
            break
        selected.add(min(candidates, key=lambda i: math.dist(
            [statistics.fmean(bone["verts"][faces[i][k]][j] for k in range(3)) for j in range(3)],
            [statistics.fmean(bone["verts"][seed[k]][j] for k in range(3)) for j in range(3)])))
    verts = sorted({faces[i][k] for i in selected for k in range(3)})
    edges = [math.dist(bone["verts"][faces[i][j]], bone["verts"][faces[i][(j+1)%3]])
             for i in selected for j in range(3)]
    lift = statistics.median(edges)*lift_ratio
    normals = defaultdict(lambda: [0., 0., 0.])
    for i in selected:
        f = faces[i]
        n = norm(cross(sub(bone["verts"][f[1]], bone["verts"][f[0]]),
                       sub(bone["verts"][f[2]], bone["verts"][f[0]])))
        if dot(n, outward) < 0:
            n = mul(n, -1)
        for k in f[:3]:
            normals[k] = vec(normals[k], n)
    mapping = {}
    for v in verts:
        mapping[v] = len(bone["verts"])
        bone["verts"].append([round(x, 4) for x in vec(bone["verts"][v],
                                   mul(norm(normals[v]), lift))])
    u0, v0, u1, v1 = atlas_rect
    xyz = [bone["verts"][v] for v in verts]
    axis = min(range(3), key=lambda j: max(p[j] for p in xyz)-min(p[j] for p in xyz))
    axes = [j for j in range(3) if j != axis]
    lo = [min(p[j] for p in xyz) for j in axes]
    span = [max(max(p[j] for p in xyz)-lo[k], 1) for k, j in enumerate(axes)]
    uv = {v: (u0+3+(bone["verts"][v][axes[0]]-lo[0])/span[0]*(u1-u0-6),
              v0+3+(bone["verts"][v][axes[1]]-lo[1])/span[1]*(v1-v0-6)) for v in verts}
    new_faces = []
    for i in sorted(selected):
        f = faces[i]
        tri = [mapping[v] for v in f[:3]]
        new_faces.append(tri+[q for v in f[:3] for q in uv[v]])
        for j in range(3):
            a, b = f[j], f[(j+1)%3]
            if len(edge_map[tuple(sorted((a, b)))]) == 1 or any(
                    other not in selected for other in edge_map[tuple(sorted((a, b)))]):
                new_faces.append([a, b, mapping[b], *uv[a], *uv[b], *uv[b]])
                new_faces.append([a, mapping[b], mapping[a], *uv[a], *uv[b], *uv[a]])
    bone["faces"].extend(new_faces)
    return {"bone": bone_id, "faces": len(selected), "new_vertices": len(verts),
            "lift": round(lift, 3), "seam_distance": 0, "attachment_score": score}


def generate_chain(model, target_bone, position, direction, length_ratio, pattern,
                   image, color, occupied, motion="derived"):
    """Synthesize an articulated tapered limb using a measured part family."""
    if motion not in ("inherit", "derived"):
        raise ValueError("generated chain motion must be inherit or derived")
    if not .1 <= length_ratio <= 1:
        raise ValueError("generated chain length outside body-relative range")
    direction = norm(direction)
    if dot(direction, direction) < .99:
        raise ValueError("zero chain direction")
    _, face, attachment, _ = surface_face(model["bones"][target_bone], position, direction)
    body_box = bounds([v for b in model["bones"] for v in b["verts"]])
    body_size = max(hi-lo for lo, hi in body_box)
    segments = max(2, min(6, round(pattern["bone_count_median"])))
    sides = max(3, min(12, round(pattern["ring_vertices_median"])))
    taper = max(.2, min(2, pattern["taper_ratio_median"]))
    segment_length = body_size*length_ratio/segments
    face_pts = [model["bones"][target_bone]["verts"][i] for i in face[:3]]
    radius = min(statistics.median(math.dist(face_pts[i], face_pts[(i+1)%3]) for i in range(3))*.42,
                 body_size*.045)
    if radius < 4:
        raise ValueError("attachment surface too small for generated chain")
    radial = norm(cross(direction, [0, 1, 0] if abs(direction[1]) < .8 else [1, 0, 0]))
    other = norm(cross(direction, radial))
    first = len(model["bones"])
    atlas_rect = allocate(occupied, 32, 32)
    fill_island(image, atlas_rect, color)
    u0, v0, u1, v1 = atlas_rect
    total_frames = model["total_frames"]
    amplitude = max(24, min(220, round(pattern["animation_energy_median"]/max(segments, 1)/8)))
    for segment in range(segments):
        root_translation = attachment if segment == 0 else mul(direction, segment_length)
        def ring(distance, r):
            return [vec(mul(direction, distance), vec(mul(radial, r*math.cos(k*math.tau/sides)),
                                                      mul(other, r*math.sin(k*math.tau/sides)))) for k in range(sides)]
        start = ring(0, radius*(1-(1-taper)*segment/segments))
        end = ring(segment_length, radius*(1-(1-taper)*(segment+1)/segments))
        verts = [[round(x, 4) for x in v] for v in start+end]
        faces = []
        for k in range(sides):
            j = (k+1)%sides
            uu0 = u0+2+(u1-u0-4)*k/sides
            uu1 = u0+2+(u1-u0-4)*(k+1)/sides
            faces.append([k, j, sides+k, uu0, v0+2, uu1, v0+2, uu0, v1-2])
            faces.append([j, sides+j, sides+k, uu1, v0+2, uu1, v1-2, uu0, v1-2])
        for k in range(1, sides-1):
            faces.append([0, k+1, k, u0+2, v0+2, u1-2, v0+2, u0+2, v1-2])
            faces.append([sides, sides+k, sides+k+1, u0+2, v0+2, u1-2, v0+2, u0+2, v1-2])
        turn = [[0, 0, 0, 0]]
        if segment and motion == "derived":
            turn = [[0, 0, 0, 0], [amplitude, 0, 0, total_frames//4],
                    [0, 0, 0, total_frames//2], [-amplitude, 0, 0, 3*total_frames//4],
                    [0, 0, 0, total_frames]]
        model["bones"].append({"parent_slot": target_bone+1 if segment == 0 else first+segment,
                               "verts": verts, "faces": faces,
                               "anim": {"ch1": [[*root_translation, 0]], "ch2": turn,
                                        "ch3": [[4096, 4096, 4096, 0]]}})
    model["num_bones"] = len(model["bones"])
    return {"root_bone": first, "segments": segments, "target_bone": target_bone,
            "attachment": attachment, "seam_distance": 0, "pattern": pattern["id"]}


def atlas_occupancy(model, pad=2):
    occupied = [[False]*256 for _ in range(256)]
    for bone in model["bones"]:
        for f in bone["faces"]:
            us, vs = f[3::2], f[4::2]
            for y in range(max(0, math.floor(min(vs))-pad), min(256, math.ceil(max(vs))+pad+1)):
                for x in range(max(0, math.floor(min(us))-pad), min(256, math.ceil(max(us))+pad+1)):
                    occupied[y][x] = True
    return occupied


def allocate(occupied, width=32, height=32):
    for y in range(2, 256-height-2, 2):
        for x in range(2, 256-width-2, 2):
            if any(occupied[yy][xx] for yy in range(y, y+height) for xx in range(x, x+width)):
                continue
            for yy in range(y, y+height):
                for xx in range(x, x+width):
                    occupied[yy][xx] = True
            return [x, y, x+width, y+height]
    raise ValueError("texture atlas has no free padded island")


def reference_color(image, point):
    x, y = [min(max(round(point[i]*(image.size[i]-1)), 0), image.size[i]-1) for i in range(2)]
    pixels = [image.getpixel((xx, yy))[:3] for yy in range(max(0, y-3), min(image.height, y+4))
              for xx in range(max(0, x-3), min(image.width, x+4))]
    return tuple(round(statistics.median(p[i] for p in pixels)) for i in range(3))


def repaint_palette(image, reference, rules, count=8, source_image=None):
    """Learn the source page's color families and recolor them from image swatches.

    Alpha and native UV coordinates remain unchanged. Relative source shading
    within a color family is retained as an RGB offset from its learned center.
    """
    palette_source = source_image or image
    get_pixels = getattr(palette_source, "get_flattened_data", palette_source.getdata)
    sampled = [rgba[:3] for rgba in list(get_pixels())[::max(1, image.width//128)] if rgba[3] > 180]
    if len(sampled) < count:
        raise ValueError("texture has too few opaque pixels for palette analysis")
    bins = Counter(tuple((c//32)*32+16 for c in rgb) for rgb in sampled)
    centers = [list(rgb) for rgb, _ in bins.most_common(count)]
    if len(centers) < count:
        count = len(centers)
    for _ in range(8):
        sums = [[0, 0, 0, 0] for _ in centers]
        for rgb in sampled:
            i = min(range(count), key=lambda k: sum((rgb[j]-centers[k][j])**2 for j in range(3)))
            for j in range(3):
                sums[i][j] += rgb[j]
            sums[i][3] += 1
        centers = [[s[j]/s[3] for j in range(3)] if s[3] else centers[i]
                   for i, s in enumerate(sums)]
    ranks = sorted(range(count), key=lambda i: -sums[i][3])
    assignments = {}
    groups = defaultdict(list)
    for rule in rules:
        groups[tuple(rule["reference_sample"])].append(rule["source_rank"])
    for rule in rules:
        rank = rule["source_rank"]
        if not 0 <= rank < count:
            raise ValueError(f"source palette rank {rank} outside 0..{count-1}")
        target = reference_color(reference, rule["reference_sample"])
        members = groups[tuple(rule["reference_sample"])]
        if len(members) > 1:
            luminances = [sum(centers[ranks[r]])/3 for r in members]
            shade = (sum(centers[ranks[rank]])/3-statistics.median(luminances))*.4
            target = tuple(max(0, min(255, round(c+shade))) for c in target)
        assignments[ranks[rank]] = target
    pixels = []
    source_pixels = list(get_pixels())
    output_pixels = list(getattr(image, "get_flattened_data", image.getdata)())
    for rgba, original in zip(output_pixels, source_pixels):
        if rgba[3] == 0:
            pixels.append(rgba)
            continue
        if source_image is not None and original[3] == 0:
            pixels.append(rgba)
            continue
        i = min(range(count), key=lambda k: sum((rgba[j]-centers[k][j])**2 for j in range(3)))
        if i not in assignments:
            pixels.append(rgba)
            continue
        target = assignments[i]
        pixels.append(tuple(max(0, min(255, round(target[j]+rgba[j]-centers[i][j]))) for j in range(3))+(rgba[3],))
    image.putdata(pixels)
    return [{"source_rank": rank, "source_color": [round(c) for c in centers[ranks[rank]]],
             "reference_color": assignments[ranks[rank]]} for rank in sorted(rule["source_rank"] for rule in rules)]


def repaint_surface(model, image, bone_id, reference, sample, preserve_saturated=True):
    """Color one measured mesh surface through its UV faces, preserving shading."""
    target = Image.new("1", image.size, 0)
    others = Image.new("1", image.size, 0)
    target_draw, others_draw = ImageDraw.Draw(target), ImageDraw.Draw(others)
    scale = image.width/256
    for i, bone in enumerate(model["bones"]):
        draw = target_draw if i == bone_id else others_draw
        for face in bone["faces"]:
            polygon = [(round(face[k]*scale), round(face[k+1]*scale)) for k in (3, 5, 7)]
            draw.polygon(polygon, fill=1)
    mask = target.load()
    overlap = others.load()
    source = image.load()
    colors = []
    for y in range(image.height):
        for x in range(image.width):
            rgba = source[x, y]
            if mask[x, y] and not overlap[x, y] and rgba[3] and not (
                preserve_saturated and max(rgba[:3])-min(rgba[:3]) > 45
                and rgba[0] > max(rgba[1], rgba[2])*1.35):
                colors.append(sum(rgba[:3])/3)
    if len(colors) < 20:
        raise ValueError("selected surface has no exclusive opaque texture area")
    base_luminance = statistics.median(colors)
    target_color = reference_color(reference, sample)
    painted = 0
    for y in range(image.height):
        for x in range(image.width):
            rgba = source[x, y]
            if not mask[x, y] or overlap[x, y] or not rgba[3]:
                continue
            if preserve_saturated and max(rgba[:3])-min(rgba[:3]) > 45 and rgba[0] > max(rgba[1], rgba[2])*1.35:
                continue
            shift = (sum(rgba[:3])/3-base_luminance)*.5
            source[x, y] = tuple(max(0, min(255, round(c+shift))) for c in target_color)+(rgba[3],)
            painted += 1
    return {"bone": bone_id, "pixels": painted, "reference_color": target_color}


def paint_mesh_region(model, image, bone_ids, reference, sample, axis, intervals):
    """Color a part by local position through its existing UV triangles."""
    color = reference_color(reference, sample)
    blocked_image = Image.new("1", image.size, 0)
    draw = ImageDraw.Draw(blocked_image)
    scale = image.width / 256
    for i, bone in enumerate(model["bones"]):
        if i in bone_ids:
            continue
        for f in bone["faces"]:
            draw.polygon([(round(f[k]*scale), round(f[k+1]*scale)) for k in (3, 5, 7)], fill=1)
    blocked = blocked_image.load()
    pixels = image.load()
    painted = set()
    for bone_id in bone_ids:
        bone = model["bones"][bone_id]
        lo, hi = bounds(bone["verts"])[axis]
        span = max(hi-lo, 1)
        for f in bone["faces"]:
            uv = [(f[k]*scale, f[k+1]*scale) for k in (3, 5, 7)]
            den = ((uv[1][1]-uv[2][1])*(uv[0][0]-uv[2][0])
                   +(uv[2][0]-uv[1][0])*(uv[0][1]-uv[2][1]))
            if abs(den) < .01:
                continue
            for y in range(max(0, math.floor(min(p[1] for p in uv))),
                           min(image.height, math.ceil(max(p[1] for p in uv))+1)):
                for x in range(max(0, math.floor(min(p[0] for p in uv))),
                               min(image.width, math.ceil(max(p[0] for p in uv))+1)):
                    w0 = ((uv[1][1]-uv[2][1])*(x+.5-uv[2][0])
                          +(uv[2][0]-uv[1][0])*(y+.5-uv[2][1]))/den
                    w1 = ((uv[2][1]-uv[0][1])*(x+.5-uv[2][0])
                          +(uv[0][0]-uv[2][0])*(y+.5-uv[2][1]))/den
                    w2 = 1-w0-w1
                    if min(w0, w1, w2) < -.001 or blocked[x, y] or (x, y) in painted:
                        continue
                    coordinate = sum(w*bone["verts"][f[i]][axis] for i, w in enumerate((w0, w1, w2)))
                    if not any(a <= (coordinate-lo)/span <= b for a, b in intervals):
                        continue
                    old = pixels[x, y]
                    if not old[3] or (max(old[:3])-min(old[:3]) > 45
                                      and old[0] > max(old[1], old[2])*1.35):
                        continue
                    shade = max(.7, min(1.25, sum(old[:3])/max(1, sum(color))))
                    pixels[x, y] = tuple(max(0, min(255, round(c*shade))) for c in color)+(old[3],)
                    painted.add((x, y))
    if len(painted) < 12:
        raise ValueError("mesh region missed visible atlas pixels")
    return {"bones": bone_ids, "axis": axis, "intervals": intervals,
            "pixels": len(painted), "reference_color": list(color)}


def project_reference_texture(model, image, reference, views, strength=.85,
                              mode="accent", accent_sample=None):
    """Project front/side/back artwork through the posed mesh into native UVs.

    White paper, grid lines and labels are excluded by a foreground color gate;
    texels with no credible artwork sample keep their existing paint.
    """
    if not 0 < strength <= 1:
        raise ValueError("projection strength must be in (0,1]")
    if mode not in ("accent", "full"):
        raise ValueError("projection mode must be accent or full")
    if mode == "accent" and accent_sample is None:
        raise ValueError("accent projection requires a reference sample")
    required = {"front", "side", "back"}
    if not required.issubset(views):
        raise ValueError("projection requires front, side and back view crops")
    poses = pose(model, 0)
    world_vertices = [[vec(t, mv(r, v)) for v in bone["verts"]]
                      for (t, r), bone in zip(poses, model["bones"])]
    all_vertices = [v for bone in world_vertices for v in bone]
    box = bounds(all_vertices)
    minval = [axis[0] for axis in box]
    span = [max(axis[1]-axis[0], 1) for axis in box]
    atlas_scale = image.width/256
    sums = defaultdict(lambda: [0., 0., 0., 0., 0.])
    counts = Counter()

    def foreground(rgb):
        r, g, b = rgb
        light = (r+g+b)/3
        chroma = max(rgb)-min(rgb)
        return (32 < light < 205 and (chroma > 22 or light < 175))

    def source_color(view, point):
        crop = views[view]
        x0, y0, x1, y1 = [crop[i]*reference.size[i%2] for i in range(4)]
        if view == "front":
            u = (point[0]-minval[0])/span[0]
        elif view == "back":
            u = 1-(point[0]-minval[0])/span[0]
        else:
            u = (point[2]-minval[2])/span[2]
        v = (point[1]-minval[1])/span[1]
        x = round(x0+u*(x1-x0))
        y = round(y0+v*(y1-y0))
        if not 0 <= x < reference.width or not 0 <= y < reference.height:
            return None
        color = reference.getpixel((x, y))[:3]
        if foreground(color):
            return color
        # Background can occur when the posed source and drawing differ.
        # Search locally, never borrow a color from a distant labeled panel.
        for radius in (2, 4, 7):
            found = []
            for dx, dy in ((radius, 0), (-radius, 0), (0, radius), (0, -radius),
                           (radius, radius), (-radius, radius), (radius, -radius), (-radius, -radius)):
                xx, yy = x+dx, y+dy
                if x0 <= xx < x1 and y0 <= yy < y1:
                    rgb = reference.getpixel((xx, yy))[:3]
                    if foreground(rgb):
                        found.append(rgb)
            if found:
                return tuple(round(statistics.median(c[i] for c in found)) for i in range(3))
        return None

    for i, bone in enumerate(model["bones"]):
        world = world_vertices[i]
        for f in bone["faces"]:
            a, b, c = [world[k] for k in f[:3]]
            n = norm(cross(sub(b, a), sub(c, a)))
            weights = {"front": max(0, -n[2]), "back": max(0, n[2]), "side": abs(n[0])}
            view = max(weights, key=weights.get)
            if weights[view] < .2:
                continue
            uv = [(f[k]*atlas_scale, f[k+1]*atlas_scale) for k in (3, 5, 7)]
            denominator = ((uv[1][1]-uv[2][1])*(uv[0][0]-uv[2][0])
                           +(uv[2][0]-uv[1][0])*(uv[0][1]-uv[2][1]))
            if abs(denominator) < .01:
                continue
            xmin = max(0, math.floor(min(p[0] for p in uv)))
            xmax = min(image.width-1, math.ceil(max(p[0] for p in uv)))
            ymin = max(0, math.floor(min(p[1] for p in uv)))
            ymax = min(image.height-1, math.ceil(max(p[1] for p in uv)))
            for y in range(ymin, ymax+1):
                for x in range(xmin, xmax+1):
                    w0 = ((uv[1][1]-uv[2][1])*(x+.5-uv[2][0])
                          +(uv[2][0]-uv[1][0])*(y+.5-uv[2][1]))/denominator
                    w1 = ((uv[2][1]-uv[0][1])*(x+.5-uv[2][0])
                          +(uv[0][0]-uv[2][0])*(y+.5-uv[2][1]))/denominator
                    w2 = 1-w0-w1
                    if min(w0, w1, w2) < -.001:
                        continue
                    point = [a[j]*w0+b[j]*w1+c[j]*w2 for j in range(3)]
                    color = source_color(view, point)
                    if color is None:
                        continue
                    weight = max(weights[view], .2)
                    entry = sums[(x, y)]
                    for j in range(3):
                        entry[j] += color[j]*weight
                    entry[3] += weight
                    if color[0] > color[1]*1.2 and color[0] > color[2]*1.35 and color[0]-color[2] > 35:
                        entry[4] += weight
                    counts[view] += 1
    pixels = image.load()
    painted = 0
    orange = reference_color(reference, accent_sample) if accent_sample else None
    accent_mask = Image.new("L", image.size, 0)
    mask_pixels = accent_mask.load()
    if mode == "accent":
        for (x, y), entry in sums.items():
            if entry[3] >= .3 and entry[4]/entry[3] >= .65:
                mask_pixels[x, y] = 255
        from PIL import ImageFilter
        accent_mask = accent_mask.filter(ImageFilter.MedianFilter(3))
        mask_pixels = accent_mask.load()
    for (x, y), entry in sums.items():
        old = pixels[x, y]
        if not old[3] or not entry[3]:
            continue
        if mode == "accent":
            if not mask_pixels[x, y]:
                continue
            shading = max(.7, min(1.25, sum(old[:3])/3/100))
            color = [min(255, c*shading) for c in orange]
        else:
            color = [entry[j]/entry[3] for j in range(3)]
        pixels[x, y] = tuple(round((1-strength)*old[j]+strength*color[j]) for j in range(3))+(old[3],)
        painted += 1
    if painted < 20:
        raise ValueError("reference projection produced too few painted texels")
    return {"mode": mode, "painted_pixels": painted, "view_samples": dict(counts)}


def fill_island(image, rect, color):
    scale = image.width / 256
    box = tuple(round(v*scale) for v in rect)
    image.paste((*color, 255), box)


def validate_generated(model, image, attachments, frames, original_face_counts=None):
    # Extracted game models may have empty action slots; validate their native
    # geometry without imposing the optional custom-starter action convention.
    if image.mode != "RGBA" or image.width != image.height or image.width & (image.width-1):
        raise ValueError("texture must be square power-of-two RGBA")
    if model["num_bones"] != len(model["bones"]):
        raise ValueError("num_bones disagrees with skeleton")
    for i, bone in enumerate(model["bones"]):
        if not isinstance(bone["parent_slot"], int) or not 0 <= bone["parent_slot"] <= i:
            raise ValueError(f"invalid parent at bone {i}")
        vertices = bone["verts"]
        used = set()
        for f in bone["faces"]:
            if len(f) != 9 or any(not isinstance(k, int) or not 0 <= k < len(vertices) for k in f[:3]):
                raise ValueError(f"invalid triangle indices at bone {i}")
            if any(not math.isfinite(v) or not 0 <= v <= 256 for v in f[3:]):
                raise ValueError(f"invalid UV at bone {i}")
            a, b, c = [vertices[k] for k in f[:3]]
            if dot(cross(sub(b, a), sub(c, a)), cross(sub(b, a), sub(c, a))) < 1:
                raise ValueError(f"malformed triangle at bone {i}")
            used.update(f[:3])
        if len(used) != len(vertices):
            raise ValueError(f"detached vertices at bone {i}")
        if not all(math.isfinite(n) for v in vertices for n in v):
            raise ValueError(f"invalid vertex at bone {i}")
        anim = bone.get("anim")
        if anim:
            for ch in ("ch1", "ch2", "ch3"):
                keys = anim.get(ch, [])
                if not keys or any(len(k) != 4 or not all(math.isfinite(n) for n in k) for k in keys):
                    raise ValueError(f"invalid {ch} at bone {i}")
                if any(a[3] >= b[3] for a, b in zip(keys, keys[1:])):
                    raise ValueError(f"unordered {ch} keys at bone {i}")
    if any(a["seam_distance"] > 1e-3 for a in attachments):
        raise ValueError("detached attachment")
    if original_face_counts is not None:
        missing, added = 0, 0
        alpha = image.getchannel("A")
        for i, bone in enumerate(model["bones"]):
            first = original_face_counts[i] if i < len(original_face_counts) else 0
            for f in bone["faces"][first:]:
                u = sum(f[k] for k in (3, 5, 7))/3
                v = sum(f[k] for k in (4, 6, 8))/3
                x = min(image.width-1, int(u*image.width/256))
                y = min(image.height-1, int(v*image.height/256))
                added += 1
                missing += alpha.getpixel((x, y)) == 0
        if missing:
            raise ValueError(f"{missing}/{added} new triangles sample missing atlas pixels")
    for frame in frames:
        matrices = pose(model, frame)
        for i, (t, r) in enumerate(matrices):
            if not all(math.isfinite(v) for v in t+sum(r, [])):
                raise ValueError(f"invalid transform at frame {frame}, bone {i}")
        points = [vec(t, mv(r, v)) for (t, r), bone in zip(matrices, model["bones"]) for v in bone["verts"]]
        if points:
            box = bounds(points)
            if max(hi-lo for lo, hi in box) > 20000:
                raise ValueError(f"mesh explosion at frame {frame}")
        for attachment in attachments:
            if "root_bone" not in attachment:
                continue
            parent_t, parent_r = matrices[attachment["target_bone"]]
            expected = vec(parent_t, mv(parent_r, attachment["attachment"]))
            actual = matrices[attachment["root_bone"]][0]
            if math.dist(expected, actual) > 1:
                raise ValueError(f"part detachment at frame {frame}")
    return {"frames": frames, "attachments": len(attachments), "triangles": sum(len(b["faces"]) for b in model["bones"])}


def validation_frames(model, specification):
    """Choose actual pose frames from named timeline tables in a recipe."""
    chosen = {}
    for name, table_index in specification.items():
        if not isinstance(table_index, int) or not 0 <= table_index < len(model["timeline"]):
            raise ValueError(f"{name}: missing timeline table")
        values = [m["value"] for m in model["timeline"][table_index]["table"]
                  if 0 <= m["value"] < 0x8000]
        if not values:
            raise ValueError(f"{name}: empty timeline table")
        candidates = sorted(values, key=lambda value: abs(value-statistics.median(values)))
        chosen[name] = next((value for value in candidates if value not in chosen.values()), candidates[0])
    required = {"idle", "attack", "hit", "victory"}
    if not required.issubset(chosen):
        raise ValueError(f"validation requires {', '.join(sorted(required))}")
    return chosen


def validate_captures(paths):
    """Reject blank viewer output even when WebGL reports no error."""
    import hashlib
    signatures = {}
    for path in paths:
        with Image.open(path) as image:
            rgb = image.convert("RGB")
            width, height = rgb.size
            background = rgb.getpixel((width-5, 5))
            visible = 0
            for y in range(height//5, 4*height//5, 4):
                for x in range(width//5, 4*width//5, 4):
                    color = rgb.getpixel((x, y))
                    if sum(abs(color[i]-background[i]) for i in range(3)) > 48:
                        visible += 1
            if visible < 100:
                raise ValueError(f"blank or tiny model capture: {path} ({visible} pixels)")
            signatures[Path(path).name] = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    if len(set(signatures.values())) < 2:
        raise ValueError("all model captures are identical")
    return {"captures": len(paths), "distinct": len(set(signatures.values()))}


def build_recipe(recipe, catalog):
    if "assembly" in recipe:
        from model_assembly import assemble
        reference = Image.open(ROOT / recipe["reference"]).convert("RGB")
        model, texture, parts = assemble(recipe, catalog, reference, allocate, reference_color)
        samples = validation_frames(model, recipe["validation"])
        result = validate_generated(model, texture, [], sorted(set(samples.values())),
                                    [0]*len(model["bones"]))
        return model, texture, {"base": "generated", "reference": recipe["reference"],
                                "operations": [{"operation": "assemble", "parts": parts}],
                                "validation": {**result, "samples": samples}}
    base_id = recipe["base_model"]
    row = catalog["models"][base_id]
    model = json.loads((ROOT / row["model_path"]).read_text())
    model["folder"] = recipe["output_model"]
    original_face_counts = [len(b["faces"]) for b in model["bones"]]
    original_texture = source_texture(base_id)
    texture = original_texture.copy()
    reference = Image.open(ROOT / recipe["reference"]).convert("RGB")
    occupancy = atlas_occupancy(model)
    attachments, operations = [], []
    for change in recipe["changes"]:
        kind = change["operation"]
        if kind == "adapt_chain":
            part = select_part(describe(model), change["select"])
            adapt_chain(model, part, change["axis"], change["length_scale"], change.get("thickness_scale", 1))
            operations.append({"operation": kind, "selected_bone": part["root"], "chain": part["bones"]})
        elif kind == "curve_chain":
            part = select_part(describe(model), change["select"])
            result = curve_chain_to_reference(model, part, change["reference_start"], change["reference_tip"],
                                              reference.width/reference.height)
            operations.append({"operation": kind, **result})
        elif kind == "repaint":
            swatches = repaint_palette(texture, reference, change["swatches"], change.get("clusters", 8),
                                       original_texture)
            operations.append({"operation": kind, "swatches": swatches})
        elif kind == "repaint_surface":
            part = select_part(describe(model), change["select"])
            bone_id = surface_bone(model, part, change.get("surface_bone", "most_faces"))
            result = repaint_surface(model, texture, bone_id, reference, change["reference_sample"],
                                     change.get("preserve_saturated", True))
            operations.append({"operation": kind, **result})
        elif kind == "paint_mesh_region":
            part = select_part(describe(model), change["select"])
            target = change.get("target", "root")
            if target == "chain":
                bones = part["bones"]
            elif target == "parent":
                parent = model["bones"][part["root"]]["parent_slot"]-1
                if parent < 0:
                    raise ValueError("selected part has no parent mesh")
                bones = [parent]
            else:
                bones = [surface_bone(model, part, target)]
            result = paint_mesh_region(model, texture, bones, reference,
                                       change["reference_sample"], change["axis"], change["intervals"])
            operations.append({"operation": kind, **result})
        elif kind == "project_reference":
            result = project_reference_texture(model, texture, reference, change["views"],
                                               change.get("strength", .85),
                                               change.get("mode", "accent"), change.get("accent_sample"))
            operations.append({"operation": kind, **result})
        elif kind == "surface_protrusions":
            part = select_part(describe(model), change["select"])
            target = surface_bone(model, part, change.get("surface_bone", "most_faces"))
            color = reference_color(reference, change["reference_sample"])
            count_before = len(attachments)
            for site in expand_sites(change["sites"]):
                rect = allocate(occupancy, 24, 24)
                fill_island(texture, rect, color)
                attachments.append(protrusion(model, target, site["position"], site["direction"],
                                               site["length_ratio"], rect, catalog["patterns"]))
            operations.append({"operation": kind, "selected_bone": target,
                               "count": len(attachments)-count_before, "color": color})
        elif kind == "armor_shell":
            part = select_part(describe(model), change["select"])
            target = surface_bone(model, part, change.get("surface_bone", "most_faces"))
            color = reference_color(reference, change["reference_sample"])
            shells = []
            source_faces = len(model["bones"][target]["faces"])
            for site in expand_sites(change["sites"]):
                rect = allocate(occupancy, site.get("atlas_width", 32), site.get("atlas_height", 32))
                fill_island(texture, rect, color)
                shells.append(armor_shell(model, target, site["position"], site["direction"],
                                          site.get("face_count", 8), site.get("lift_ratio", .12), rect, source_faces))
            operations.append({"operation": kind, "selected_bone": target, "shells": shells,
                               "reference_color": color})
        elif kind == "transplant":
            target_part = select_part(describe(model), change["target_query"])
            target_bone = target_part["root"]
            target_mesh = model["bones"][target_bone]
            _, _, attachment, _ = surface_face(target_mesh, change["target_position"], norm(change["direction"]))
            target_face = surface_face(target_mesh, change["target_position"], norm(change["direction"]))[1]
            edge = statistics.median(math.dist(target_mesh["verts"][target_face[i]],
                                               target_mesh["verts"][target_face[(i+1)%3]]) for i in range(3))
            candidates = []
            failures = []
            for _, source_id, source_part in search_parts(catalog, change["source_query"], change.get("search_limit", 50)):
                if len(candidates) >= change.get("fit_limit", 8):
                    break
                donor = json.loads((ROOT / catalog["models"][source_id]["model_path"]).read_text())
                proposed = copy.deepcopy(model)
                proposed_texture = texture.copy()
                proposed_occupancy = [row[:] for row in occupancy]
                try:
                    mapping = transplant(proposed, donor, source_part, target_bone, attachment,
                                         change.get("scale", 1), change.get("motion", "inherit"), change["direction"])
                    first_root = mapping[source_part["root"]]
                    gap = min(math.dist(v, [0, 0, 0]) for v in proposed["bones"][first_root]["verts"])
                    if gap > edge*1.5:
                        raise ValueError(f"root mesh misses surface by {gap-edge*1.5:.1f} units")
                    donor_texture = source_texture(source_id)
                    uv = copy_part_texture(proposed, mapping.values(), donor, source_part["bones"],
                                           proposed_texture, donor_texture, proposed_occupancy)
                    donor_parent = donor["bones"][source_part["root"]]["parent_slot"]-1
                    if donor_parent < 0:
                        raise ValueError("source part has no exemplar parent")
                    root_count = len(donor["bones"][source_part["root"]]["verts"])
                    source_gaps = attachment_clearance(donor, source_part["root"], donor_parent,
                                                       range(root_count), [0])[0]
                    interface = sorted(range(root_count), key=lambda i: source_gaps[i])[:min(8, root_count)]
                    source_profile = attachment_clearance(donor, source_part["root"], donor_parent,
                                                          interface, [0, 100, 300, 500])
                    target_profile = attachment_clearance(proposed, first_root, target_bone,
                                                          interface, [0, 100, 300, 500])
                    fit_error = attachment_profile_error(source_profile, target_profile,
                                                         change.get("scale", 1))
                except ValueError as error:
                    failures.append(f"{source_id}:{source_part['root']}: {error}")
                    continue
                candidates.append((fit_error, source_id, source_part["root"], proposed,
                                   proposed_texture, proposed_occupancy, source_part, mapping, first_root, gap, uv))
            if not candidates:
                raise ValueError("no transplant candidate passed geometry/atlas checks: " + "; ".join(failures[:5]))
            (fit_error, source_id, _, model, texture, occupancy, source_part,
             mapping, first_root, gap, uv) = min(candidates, key=lambda entry: (entry[0], entry[1], entry[2]))
            attachments.append({"root_bone": first_root, "target_bone": target_bone,
                                "attachment": attachment, "seam_distance": 0})
            operations.append({"operation": kind, "source": source_id, "source_root": source_part["root"],
                               "target_bone": target_bone, "copied_bones": list(mapping.values()),
                               "mesh_root_gap": gap, "motion_clearance_error": round(fit_error, 3), "uv": uv})
        elif kind == "generate_chain":
            part = select_part(describe(model), change["select"])
            target = surface_bone(model, part, change.get("surface_bone", "root"))
            pattern = next(p for p in catalog["patterns"]["clusters"] if p["id"] == change["pattern"])
            color = reference_color(reference, change["reference_sample"])
            attachment = generate_chain(model, target, change["position"], change["direction"],
                                        change["length_ratio"], pattern, texture, color, occupancy,
                                        change.get("motion", "derived"))
            attachments.append(attachment)
            operations.append({"operation": kind, **attachment})
        else:
            raise ValueError(f"unknown operation: {kind}")
    samples = validation_frames(model, recipe["validation"])
    frames = sorted(set(samples.values()))
    result = validate_generated(model, texture, attachments, frames, original_face_counts)
    return model, texture, {"base": base_id, "reference": recipe["reference"],
                            "operations": operations, "validation": {**result, "samples": samples}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("catalog")
    lookup = sub.add_parser("search")
    lookup.add_argument("query", help="JSON structural query, e.g. '{\"direction\":[0,0,1]}'")
    make = sub.add_parser("build")
    make.add_argument("recipe", type=Path)
    args = parser.parse_args()
    if args.cmd == "catalog":
        catalog = build_catalog()
        CATALOG.parent.mkdir(parents=True, exist_ok=True)
        CATALOG.write_text(json.dumps(catalog, separators=(",", ":")))
        write_database(catalog)
        print(json.dumps({"catalog": str(CATALOG), "database": str(DATABASE), "models": len(catalog["models"]),
                          "parts": sum(len(r["parts"]) for r in catalog["models"].values()),
                          "pattern_count": len(catalog["patterns"]["clusters"])}))
        return
    catalog = json.loads(CATALOG.read_text())
    if args.cmd == "search":
        print(json.dumps(search_parts(catalog, json.loads(args.query)), indent=2))
        return
    recipe = json.loads(args.recipe.read_text())
    model, texture, report = build_recipe(recipe, catalog)
    report["recipe"] = str(args.recipe)
    target = ROOT / "data/custom" / model["folder"]
    if target.exists():
        previous = target / "build-report.json"
        if not previous.exists():
            raise ValueError(f"refusing to overwrite non-recipe custom source: {target}")
        old = json.loads(previous.read_text())
        if old.get("base") != report["base"] or old.get("reference") != report["reference"]:
            raise ValueError(f"refusing to overwrite source from a different recipe: {target}")
    # Render the staged result through the production viewer before publishing
    # any browser asset. A failed browser check leaves no installed model.
    import subprocess
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        staged = Path(directory)
        (staged / "anim.json").write_text(json.dumps(model, separators=(",", ":")))
        texture.save(staged / "texture.png")
        captures = ROOT / "captures/model-authoring" / model["folder"]
        check = subprocess.run([str(ROOT / "tools/run-playwright.sh"),
                                str(ROOT / "tools/verify_generated_model.mjs"), model["folder"],
                                str(captures), ",".join(map(str, report["validation"]["frames"])), str(staged)],
                               cwd=ROOT, text=True, capture_output=True)
        if check.returncode:
            raise ValueError(f"browser validation failed:\n{check.stdout}{check.stderr}")
        report["browser"] = json.loads(check.stdout)
        report["capture_check"] = validate_captures(report["browser"]["screenshots"])
        target.mkdir(parents=True, exist_ok=True)
        (target / "anim.json").write_bytes((staged / "anim.json").read_bytes())
        (target / "texture.png").write_bytes((staged / "texture.png").read_bytes())
        (target / "build-report.json").write_text(json.dumps(report, indent=2)+"\n")
    runtime_model = ASSETS / "models" / model["folder"] / "anim.json"
    runtime_model.parent.mkdir(parents=True, exist_ok=True)
    runtime_model.write_bytes((target / "anim.json").read_bytes())
    (ASSETS / "textures" / f"{model['folder']}.png").write_bytes((target / "texture.png").read_bytes())
    print(json.dumps({"source": str(target), **report}))


if __name__ == "__main__":
    main()
