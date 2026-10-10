"""Execute declarative low-poly articulated assemblies in the native battle format.

Each program node creates one mesh-owning bone. Profiles describe a shape,
not individual vertices; ring topology and motion bounds come from the decoded
model catalog. Attachments and reflected pairs are executed in parent order.
"""

import math
import statistics

from PIL import Image, ImageDraw


def add(a, b):
    return [a[i]+b[i] for i in range(3)]


def mul(a, k):
    return [v*k for v in a]


def dot(a, b):
    return sum(a[i]*b[i] for i in range(3))


def cross(a, b):
    return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]


def unit(a):
    length = math.sqrt(dot(a, a))
    if length < 1e-8:
        raise ValueError("shape axis cannot be zero")
    return mul(a, 1/length)


def expand_nodes(nodes):
    """A reflected pair is a macro; its children follow the matching side."""
    paired = {node["id"] for node in nodes if node.get("pair")}
    expanded = []
    for node in nodes:
        sides = (("_l", -1), ("_r", 1)) if node.get("pair") else (("", 1),)
        for suffix, sign in sides:
            clone = {**node, "id": node["id"]+suffix}
            if node.get("parent") in paired:
                if not suffix:
                    raise ValueError("an unpaired node cannot attach to a paired parent")
                clone["parent"] = node["parent"]+suffix
            clone["attach"] = [sign*node.get("attach", [0, 0, 0])[0],
                               *node.get("attach", [0, 0, 0])[1:]]
            shape = dict(node["shape"])
            for key in ("axis", "bend", "offset"):
                if key in shape:
                    shape[key] = [sign*shape[key][0], *shape[key][1:]]
            clone["shape"] = shape
            clone["side"] = sign
            expanded.append(clone)
    return expanded


def expand_features(features):
    """Execute reflect and translate macros on mesh details within one bone."""
    for feature in features:
        count = feature.get("repeat", 1)
        if not isinstance(count, int) or not 1 <= count <= 12:
            raise ValueError("feature repeat must be 1..12")
        step = feature.get("step", [0, 0, 0])
        for index in range(count):
            located = {**feature, "attach": add(feature.get("attach", [0, 0, 0]),
                                                 mul(step, index))}
            yield located
            if feature.get("mirror_x"):
                mirrored = dict(located)
                mirrored["attach"] = [-located["attach"][0], *located["attach"][1:]]
                shape = dict(feature["shape"])
                for key in ("axis", "bend", "offset"):
                    if key in shape:
                        shape[key] = [-shape[key][0], *shape[key][1:]]
                mirrored["shape"] = shape
                yield mirrored


def learned_pattern(catalog, shape):
    patterns = [p for p in catalog["patterns"]["clusters"]
                if 3 <= p["ring_vertices_median"] <= 12]
    profile = shape.get("profile", [1, .7])
    target_taper = max(profile[0], .05)/max(profile[-1], .05)
    return min(patterns, key=lambda p: (abs(math.log(max(p["taper_ratio_median"], .05)/target_taper)),
                                        abs(p["ring_vertices_median"]-6)*.06, p["id"]))


def loft(shape, rect, sides):
    """Build a closed swept ring mesh, with a padded rectangular UV island."""
    if not 3 <= sides <= 12:
        raise ValueError("learned ring resolution outside 3..12")
    profile = shape.get("profile", [.6, 1, .8, .5])
    if len(profile) < 2 or any(not .03 <= p <= 2 for p in profile):
        raise ValueError("loft profile needs positive ring radii")
    length = shape["length"]
    width = shape["width"]
    depth = shape.get("depth", width)
    if min(length, width, depth) <= 0:
        raise ValueError("loft dimensions must be positive")
    axis = unit(shape.get("axis", [0, 1, 0]))
    ref = [1, 0, 0] if abs(axis[0]) < .85 else [0, 1, 0]
    radial_a = unit(add(ref, mul(axis, -dot(ref, axis))))
    radial_b = unit(cross(axis, radial_a))
    bend = shape.get("bend", [0, 0, 0])
    offset = shape.get("offset", [0, 0, 0])
    vertices = []
    for ring, radius in enumerate(profile):
        t = ring/(len(profile)-1)
        center = add(add(offset, mul(axis, length*t)), mul(bend, t*t))
        for side in range(sides):
            theta = math.tau*side/sides
            point = add(center, add(mul(radial_a, math.cos(theta)*max(2, width*radius)),
                                    mul(radial_b, math.sin(theta)*max(2, depth*radius))))
            vertices.append([round(value, 4) for value in point])
    start_center = len(vertices)
    vertices.append([round(v, 4) for v in offset])
    end_center = len(vertices)
    vertices.append([round(v, 4) for v in add(add(offset, mul(axis, length)), bend)])
    x0, y0, x1, y1 = rect
    u0, u1 = x0+2, x1-2
    v0, v1 = y0+2, y1-2
    faces = []
    def uv(side, ring):
        return [u0+(u1-u0)*side/sides, v0+(v1-v0)*ring/(len(profile)-1)]
    for ring in range(len(profile)-1):
        for side in range(sides):
            next_side = (side+1)%sides
            a, b = ring*sides+side, ring*sides+next_side
            c, d = (ring+1)*sides+side, (ring+1)*sides+next_side
            faces.append([a, c, b, *uv(side, ring), *uv(side, ring+1), *uv(side+1, ring)])
            faces.append([b, c, d, *uv(side+1, ring), *uv(side, ring+1), *uv(side+1, ring+1)])
    for side in range(sides):
        next_side = (side+1)%sides
        faces.append([start_center, side, next_side,
                      (u0+u1)/2, v0, *uv(side, 0), *uv(side+1, 0)])
        a, b = (len(profile)-1)*sides+side, (len(profile)-1)*sides+next_side
        faces.append([end_center, b, a,
                      (u0+u1)/2, v1, *uv(side+1, len(profile)-1), *uv(side, len(profile)-1)])
    return vertices, faces


def motion_track(node, pattern, catalog):
    motion = node.get("motion")
    if not motion:
        return [[0, 0, 0, 0]]
    axis = motion.get("axis", 0)
    if axis not in (0, 1, 2):
        raise ValueError("motion axis must be 0, 1, or 2")
    examples = []
    for exemplar in pattern["examples"]:
        row = catalog["models"][exemplar["model"]]
        examples.append(row["bones"][exemplar["root"]]["motion"]["ch2"]["range"][axis])
    learned = max(80, min(650, statistics.median(examples))) if examples else 200
    strength = motion.get("strength", 1)
    if not .05 <= strength <= 2:
        raise ValueError("motion strength outside supported range")
    amplitude = round(learned*strength*node["side"])
    base = motion.get("rest", 0)
    frames = [0, 10, 20, 30, 40, 150, 175, 200, 225, 240,
              290, 320, 350, 400, 450, 500]
    factors = [0, .2, 0, -.2, 0, 0, .4, 1, .3, 0,
               0, -.4, 0, .2, .6, 0]
    return [[base+(round(amplitude*f) if i == axis else 0) if i == axis else 0
             for i in range(3)]+[frame] for frame, f in zip(frames, factors)]


def timeline(start, end, loop=False):
    frames = list(range(start, end+1, 10))
    records = [{"value": frame, "loop_target": 0, "aux": None} for frame in frames]
    records.append({"value": 0x8000 if loop else 0xffff,
                    "loop_target": 0 if loop else 0xffff, "aux": None})
    return {"table": records}


def assemble(recipe, catalog, reference, allocate, reference_color):
    nodes = expand_nodes(recipe["assembly"])
    if len({n["id"] for n in nodes}) != len(nodes):
        raise ValueError("assembly node ids must be unique")
    image = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    occupied = [[False]*256 for _ in range(256)]
    ids = {}
    bones = []
    details = []
    for node in nodes:
        parent = node.get("parent")
        if parent is not None and parent not in ids:
            raise ValueError(f"parent {parent} must precede {node['id']}")
        parent_slot = ids[parent]+1 if parent is not None else 0
        shape = node["shape"]
        pattern = learned_pattern(catalog, shape)
        sides = round(pattern["ring_vertices_median"])
        rect = allocate(occupied, 24, 32)
        color = reference_color(reference, node["color_sample"])
        draw.rectangle((rect[0], rect[1], rect[2]-1, rect[3]-1), fill=(*color, 255))
        for band in node.get("bands", []):
            accent = reference_color(reference, band["color_sample"])
            y0 = rect[1]+2+round((rect[3]-rect[1]-4)*band["range"][0])
            y1 = rect[1]+2+round((rect[3]-rect[1]-4)*band["range"][1])
            draw.rectangle((rect[0]+2, y0, rect[2]-3, y1), fill=(*accent, 255))
        verts, faces = loft(shape, rect, sides)
        feature_count = 0
        for feature in expand_features(node.get("features", [])):
            feature_shape = feature["shape"]
            feature_pattern = learned_pattern(catalog, feature_shape)
            feature_rect = allocate(occupied, 16, 20)
            feature_color = reference_color(reference, feature["color_sample"])
            draw.rectangle((feature_rect[0], feature_rect[1], feature_rect[2]-1,
                            feature_rect[3]-1), fill=(*feature_color, 255))
            extra_verts, extra_faces = loft(feature_shape, feature_rect,
                                           round(feature_pattern["ring_vertices_median"]))
            offset = len(verts)
            anchor = feature["attach"]
            verts.extend([[round(v[i]+anchor[i], 4) for i in range(3)] for v in extra_verts])
            faces.extend([[f[0]+offset, f[1]+offset, f[2]+offset, *f[3:]]
                          for f in extra_faces])
            feature_count += 1
        rotations = motion_track(node, pattern, catalog)
        attach = node["attach"]
        bones.append({"parent_slot": parent_slot,
                      "verts": verts, "faces": faces,
                      "anim": {"ch1": [[*attach, 0]], "ch2": rotations,
                               "ch3": [[4096, 4096, 4096, 0]]}})
        ids[node["id"]] = len(bones)-1
        details.append({"id": node["id"], "parent": parent, "pattern": pattern["id"],
                        "rings": len(shape.get("profile", [.6, 1, .8, .5])), "sides": sides,
                        "features": feature_count})
    if len(bones) < 10:
        raise ValueError("assembly needs at least ten articulated parts")
    tables = [{"table": []} for _ in range(62)]
    for index, start, end, loop in ((0, 0, 40, True), (14, 150, 240, False),
                                    (20, 290, 350, False), (44, 400, 500, False)):
        tables[index] = timeline(start, end, loop)
    clips = [{"index": i, "present": True, "start_frame": 0,
              "end_frame": 500, "loop_count": 1} for i in range(18)]
    actions = []
    for i in range(18):
        table = 14 if i in (0, 1, 2) else 20 if i in (3, 4) else 44 if i == 17 else 0
        actions.append({"ops": [{"op": 2, "words": [0, 0, table]},
                                {"op": 255, "words": []}], "overrun": False})
    model = {"folder": recipe["output_model"], "num_bones": len(bones),
             "total_frames": 500, "bones": bones, "timeline": tables,
             "clips": clips, "actions": actions}
    return model, image, details
