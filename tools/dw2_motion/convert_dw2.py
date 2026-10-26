#!/usr/bin/env python3
"""K21d: convert a Digimon World 2 glTF battle model into our DW3-shaped model JSON.

Generic: nothing here knows any species. Give it a glTF path and it writes
<out>/<folder>/anim.json in the shape web/assets/battle/models/<folder>/anim.json uses:

    folder, num_bones, total_frames, clips[], bones[], timeline[], actions[]

Bones carry parent_slot and anim.ch1 (local translation) / ch2 (local rotation, 4096/turn,
RZ(c2)*RY(c1)*RX(c0)) / ch3 (scale), sampled at 30 fps with the game's own step holds
(a key is written only where the pose changes; the DW2 clips are pose-to-pose with no
interpolation, so the converted channels are exact, not resampled).

The frame change (why the maths below looks odd)
------------------------------------------------
DW2's glTF is Y-up, the renderer's PS1 space is +Y DOWN, +Z facing, +X right, and our model
format's composition is NOT a plain frame change: the renderer builds
    W_i = W_parent * L_i                      (rotation, no flip)
    P_i = P_parent + S * (W_parent * c1_i)    (translation flipped by S = diag(-1,1,-1))
so a glTF world pose (R_i, P_i) maps to (S R_i S, S P_i) and the local channels must be
solved back out of that composition:
    c1_i = W_parent^-1 * S * (p_i - p_parent)      (-P_i for a root)
    L_i  = W_parent^-1 * W_i                       (W_i = S R_i S)

Read-back: every converted channel is sampled again through the renderer's own sampler
(web/fight/firing-axis.js poseFromChannels, run by k21d/verify_convert.mjs) and compared to
the glTF node positions this file dumps to <out>/<folder>/gltf-poses.json.

Usage:
  dw2_to_model.py --gltf <file.gltf> --out <dir> [--folder NAME] [--fps 30]
"""
import argparse, base64, json, math, os, struct, sys

TAU = (math.pi * 2) / 4096
COMP = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


# ── glTF plumbing ────────────────────────────────────────────────────────────────────────────
class GLTF:
    def __init__(self, path):
        with open(path, encoding="utf-8", errors="replace") as f:
            self.g = json.load(f)
        self.bufs = []
        for b in self.g.get("buffers", []):
            uri = b.get("uri", "")
            if uri.startswith("data:"):
                self.bufs.append(base64.b64decode(uri.split(",", 1)[1]))
            else:
                self.bufs.append(open(os.path.join(os.path.dirname(path), uri), "rb").read())

    def accessor(self, idx):
        a = self.g["accessors"][idx]
        n = NCOMP[a["type"]]
        fmt, size = COMP[a["componentType"]]
        view = self.g["bufferViews"][a["bufferView"]]
        data = self.bufs[view["buffer"]]
        start = view.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = view.get("byteStride") or n * size
        out = []
        for i in range(a["count"]):
            off = start + i * stride
            out.append(struct.unpack_from("<" + fmt * n, data, off))
        return out


def qmat(q):
    """glTF quaternion (x,y,z,w) -> row-major 3x3 rotation."""
    x, y, z, w = q
    return [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]


def m3mul(A, B):
    return [[sum(A[r][k] * B[k][c] for k in range(3)) for c in range(3)] for r in range(3)]


def m3tr(A):
    return [[A[c][r] for c in range(3)] for r in range(3)]


def m3v(A, v):
    return [sum(A[r][k] * v[k] for k in range(3)) for r in range(3)]


def m3scale_cols(A, s):
    return [[A[r][c] * s[c] for c in range(3)] for r in range(3)]


S = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]]      # the renderer's x/z flip
# The glTF is Y-UP; our models are the PS1 frame (+Y DOWN, +Z facing, +X right). The exporter baked
# that change into every node as a scale of diag(1,-1,-1) (a 180 deg turn about X, visible in the file
# as "S [0.9997, -0.9997, -0.9997]"), so the model's own frame is M = diag(1,-1,-1) away from ours:
#   p = M * P,  w = M * R * M,  c1 = w_parent^-1 * (S*M) * (P - P_parent)
M = [[1, 0, 0], [0, -1, 0], [0, 0, -1]]
SM = [[-1, 0, 0], [0, -1, 0], [0, 0, 1]]    # S * M (what turns a glTF offset into a ch1)


def conj(R):
    return m3mul(m3mul(M, R), M)


def orthonormalize(A):
    """Columns -> unit length (the exporter's scale is a sign flip times ~0.9997)."""
    out = [[0.0] * 3 for _ in range(3)]
    for c in range(3):
        col = [A[r][c] for r in range(3)]
        n = math.sqrt(sum(v * v for v in col)) or 1.0
        for r in range(3):
            out[r][c] = col[r] / n
    return out


def euler_zyx(R):
    """R = RZ(c2)*RY(c1)*RX(c0) -> (c0, c1, c2) in radians (ZYX Tait-Bryan)."""
    cb = math.hypot(R[0][0], R[1][0])
    if cb > 1e-7:
        c1 = math.atan2(-R[2][0], cb)
        c2 = math.atan2(R[1][0], R[0][0])
        c0 = math.atan2(R[2][1], R[2][2])
    else:
        c1 = math.atan2(-R[2][0], cb)
        c2 = math.atan2(-R[0][1], R[1][1])
        c0 = 0.0
    return c0, c1, c2


def to_ch2(M, prev=None):
    c0, c1, c2 = euler_zyx(M)
    t = [c0 / TAU, c1 / TAU, c2 / TAU]

    def wrap_near(x, p):
        d = (x - p) % 4096
        if d > 2048:
            d -= 4096
        return p + d

    if prev:
        alt = [t[0] + 2048, 2048 - t[1], t[2] + 2048]
        cost = lambda v: abs(v[0] - prev[0]) + abs(v[1] - prev[1]) + abs(v[2] - prev[2])
        a = [wrap_near(x, prev[i]) for i, x in enumerate(t)]
        b = [wrap_near(x, prev[i]) for i, x in enumerate(alt)]
        t = a if cost(a) <= cost(b) else b

    def norm(x):
        r = int(round(x)) % 4096
        if r < 0:
            r += 4096
        return r - 4096 if r >= 2048 else r

    return [norm(t[0]), norm(t[1]), norm(t[2])]


# ── model conversion ────────────────────────────────────────────────────────────────────────
def convert(path, folder=None, fps=30):
    G = GLTF(path)
    g = G.g
    nodes = g["nodes"]
    joints = g["skins"][0]["joints"]
    joint_of_node = {n: j for j, n in enumerate(joints)}
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = i
    n = len(joints)

    def node_parent_joint(j):
        p = parent.get(joints[j])
        while p is not None and p not in joint_of_node:
            p = parent.get(p)
        return joint_of_node.get(p, -1) if p is not None else -1

    pj = [node_parent_joint(j) for j in range(n)]

    # one mesh per bone (mesh nodes are children of the bone node, with no TRS of their own)
    meshes = {}
    for i, nd in enumerate(nodes):
        if nd.get("mesh") is None:
            continue
        p = parent.get(i)
        if p in joint_of_node:
            meshes[joint_of_node[p]] = nd["mesh"]

    verts, faces = [], []
    for j in range(n):
        if j in meshes:
            prim = g["meshes"][meshes[j]]["primitives"][0]
            pos = G.accessor(prim["attributes"]["POSITION"])
            vs = [[v[0], -v[1], -v[2]] for v in pos]      # v_dw3 = M * v_gltf
            verts.append(vs)
            if prim.get("indices") is not None:
                idx = [a[0] for a in G.accessor(prim["indices"])]
            else:
                idx = list(range(len(vs)))
            faces.append(idx)
        else:
            verts.append([])
            faces.append([])

    # ── clips: every animation, sampled at its own key times (1/30 s grid) ──
    clips = []
    for anim in g.get("animations", []):
        chans = {}          # (node, path) -> sampler
        for ch in anim["channels"]:
            chans[(ch["target"]["node"], ch["target"]["path"])] = ch["sampler"]
        times = set()
        for smp in anim["samplers"]:
            for t in G.accessor(smp["input"]):
                times.add(round(t[0], 6))
        times = sorted(times)
        frames = len(times)
        # per joint per frame: local T, R, S from the animation (fallback: the node's own TRS);
        # each sampler is decoded once and paired with its own input times, so a channel with a
        # different key count still lands on the right frame.
        tracks = {}
        for ch in anim["channels"]:
            key = (ch["target"]["node"], ch["target"]["path"])
            smp = anim["samplers"][ch["sampler"]]
            ins = [round(t[0], 6) for t in G.accessor(smp["input"])]
            outs = G.accessor(smp["output"])
            tracks[key] = dict(zip(ins, outs))
        world_R = [[None] * frames for _ in range(n)]
        world_P = [[None] * frames for _ in range(n)]
        cache = {}
        for j in range(n):
            nd = nodes[joints[j]]
            for k, t in enumerate(times):
                tri = []
                for path, default in (("translation", nd.get("translation", [0, 0, 0])),
                                      ("rotation", nd.get("rotation", [0, 0, 0, 1])),
                                      ("scale", nd.get("scale", [1, 1, 1]))):
                    tr = tracks.get((joints[j], path))
                    tri.append(tr.get(t, default) if tr else default)
                cache[(j, k)] = tri

        def world(j, k):
            if world_R[j][k] is not None:
                return world_R[j][k], world_P[j][k]
            t, q, s = cache[(j, k)]
            R = m3scale_cols(qmat(q), s)          # local with its own scale (sign flip included)
            P = list(t)
            p = pj[j]
            if p >= 0:
                Rp, Pp = world(p, k)
                P = [Pp[r] + sum(Rp[r][c] * t[c] for c in range(3)) for r in range(3)]
                R = m3mul(Rp, R)
            world_R[j][k], world_P[j][k] = R, P
            return R, P

        # DW3 local channels per joint per frame
        frames1 = [[None] * frames for _ in range(n)]
        frames2 = [[None] * frames for _ in range(n)]
        prev2 = [None] * n
        gltf_pose = []
        for k in range(frames):
            pose_k = []
            for j in range(n):
                Rj, Pj = world(j, k)
                Rj = orthonormalize(Rj)
                Wj = conj(Rj)
                p_dw = m3v(M, Pj)
                pose_k.append([round(p_dw[0], 2), round(p_dw[1], 2), round(p_dw[2], 2)])
                p = pj[j]
                if p < 0:
                    c1 = m3v(SM, Pj)              # root: p = S*c1 and p = M*P  ->  c1 = (S*M)*P
                    L = Wj
                else:
                    Wp, Pp = world(p, k)
                    Wp = conj(orthonormalize(Wp))
                    d = m3v(SM, [Pj[r] - Pp[r] for r in range(3)])
                    c1 = m3v(m3tr(Wp), d)          # c1 = Wparent^-1 * S * (p - p_parent)
                    L = m3mul(m3tr(Wp), Wj)
                t2 = to_ch2(L, prev2[j])
                prev2[j] = t2
                frames1[j][k] = [int(round(c1[0])), int(round(c1[1])), int(round(c1[2]))]
                frames2[j][k] = t2
            gltf_pose.append(pose_k)
        # STEP HOLDS, kept exactly: the renderer's sampler interpolates LINEARLY between keys, so a
        # value held over a run of frames gets a key at the run's first AND last frame (interpolating
        # between two equal values reproduces the hold), and the jump to the next value stays a jump.
        ch1 = [[] for _ in range(n)]
        ch2 = [[] for _ in range(n)]
        for j in range(n):
            for (src, dst) in ((frames1[j], ch1[j]), (frames2[j], ch2[j])):
                a = 0
                while a < frames:
                    b = a
                    while b + 1 < frames and src[b + 1] == src[a]:
                        b += 1
                    dst.append(src[a] + [a])
                    if b > a:
                        dst.append(src[a] + [b])
                    a = b + 1
        for j in range(n):
            if not ch1[j]:
                ch1[j] = [[0, 0, 0, 0]]
            if not ch2[j]:
                ch2[j] = [[0, 0, 0, 0]]
            ch1[j].append(list(ch1[j][-1][0:3]) + [30000])
            ch2[j].append(list(ch2[j][-1][0:3]) + [30000])
        clips.append({"name": anim["name"], "frames": frames, "times": times,
                      "ch1": ch1, "ch2": ch2, "gltf_pose": gltf_pose})

    # ── the DW3-shaped model ──
    # clips are indexed by the DW2 clip letter order (A, B, C0..): the motions this file
    # carries, in the game's own order; `motion_id` is the engine id the letter encodes.
    LETTERS = "ABCDEFGHIJK"
    slot = {}
    for c in clips:
        nm = c["name"].replace("anim_", "")
        slot.setdefault(nm[0], []).append(nm)
    out_clips, bones, timeline, actions = [], [], [], []
    body_h = 0.0
    for idx, c in enumerate(clips):
        nm = c["name"].replace("anim_", "")
        letter = nm[0]
        motion_id = LETTERS.index(letter) * 10 + (int(nm[1:]) if len(nm) > 1 else 0)
        table_index = idx
        frames = c["frames"]
        keyframe_lo, keyframe_hi = 0, frames - 1
        timeline.append({"table": [{"value": f, "loop_target": 0, "aux": None} for f in range(frames)]
                         + [{"value": 0xFFFF, "loop_target": 0, "aux": None}]})
        actions.append({"ops": [{"op": 2, "words": [0, 0, table_index]}, {"op": 255, "words": []}],
                        "overrun": False})
        out_clips.append({"index": idx, "present": True, "name": nm, "letter": letter,
                          "motion_id": motion_id, "start_frame": keyframe_lo,
                          "end_frame": keyframe_hi, "loop_count": 0, "table": table_index})
    for j in range(n):
        # every clip's keys live in ONE channel per bone: offset each clip past the previous one
        a1, a2 = [], []
        off = 0
        for c in clips:
            k1 = [[r[0], r[1], r[2], r[3] + off] for r in c["ch1"][j] if r[3] != 30000]
            k2 = [[r[0], r[1], r[2], r[3] + off] for r in c["ch2"][j] if r[3] != 30000]
            a1 += k1
            a2 += k2
            off += c["frames"] + 40
        a1.append(list(a1[-1][0:3]) + [30000])
        a2.append(list(a2[-1][0:3]) + [30000])
        bones.append({"parent_slot": pj[j] + 1, "anim": {"ch1": a1, "ch2": a2,
                                                         "ch3": [[4096, 4096, 4096, 0], [4096, 4096, 4096, 30000]]},
                      "verts": verts[j], "faces": faces[j], "normals": []})
        # the clip tables were written per clip before the offsets were known: rewrite them
    for idx, c in enumerate(clips):
        off = sum(clips[q]["frames"] + 40 for q in range(idx))
        timeline[idx] = {"table": [{"value": f + off, "loop_target": 0, "aux": None} for f in range(c["frames"])]
                         + [{"value": 0xFFFF, "loop_target": 0, "aux": None}]}
        out_clips[idx]["start_frame"] = off
        out_clips[idx]["end_frame"] = off + c["frames"] - 1

    # body height in the rest pose (clip A frame 0) for the reports
    ys = []
    for j in range(n):
        for v in verts[j]:
            ys.append(v[1])
    model = {
        "folder": folder or os.path.basename(os.path.dirname(path)).lower(),
        "num_bones": n, "total_frames": sum(c["frames"] + 40 for c in clips),
        "clips": out_clips, "bones": bones, "timeline": timeline, "actions": actions,
        "converted_from": os.path.basename(path),
        "fps": fps,
    }
    return model, clips


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gltf", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--folder", default=None)
    ap.add_argument("--fps", type=int, default=30)
    a = ap.parse_args()
    model, clips = convert(a.gltf, a.folder, a.fps)
    dest = os.path.join(a.out, model["folder"])
    os.makedirs(dest, exist_ok=True)
    with open(os.path.join(dest, "anim.json"), "w") as f:
        json.dump(model, f, separators=(",", ":"))
    with open(os.path.join(dest, "gltf-poses.json"), "w") as f:
        json.dump({"names": [c["name"] for c in clips],
                   "poses": [c["gltf_pose"] for c in clips]}, f)
    print("wrote %s/anim.json  bones=%d clips=%d" % (dest, model["num_bones"], len(clips)))
    for c in model["clips"]:
        print("  clip %-5s motion %3d  frames %3d  keys %s..%s" %
              (c["name"], c["motion_id"], c["end_frame"] - c["start_frame"] + 1,
               c["start_frame"], c["end_frame"]))


if __name__ == "__main__":
    main()
