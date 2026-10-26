#!/usr/bin/env python3
"""K12 survey: walk every model, compute rest pose + hierarchy + mesh boxes, print skeletons.

Read-only. Used to design the role assignment arithmetic.
"""
import json, os, math, sys
from collections import Counter

ROOT = os.environ.get('DW3_REPO', '/home/dorij/dw2003-play-anim')
MODELS = os.path.join(ROOT, 'web/assets/battle/models')
# The anatomy table is research data generated from the user's own disc — it is NOT in the repo.
# The DW2 bone-map derivation reads it as the role PRIOR; point DW2_ANATOMY elsewhere to use another copy.
ANAT = os.environ.get('DW2_ANATOMY', '/home/dorij/scratch-research/anatomy/anatomy.json')
TAU = (math.pi * 2) / 4096


def sample(ch, frame):
    if not ch:
        return [0, 0, 0]
    lo = ch[0]
    hi = ch[0]
    for rec in ch:
        if rec[3] == 30000:
            break
        if rec[3] <= frame:
            lo = rec
        else:
            hi = rec
            break
    if lo is hi or hi[3] == 30000 or hi[3] <= lo[3]:
        return [lo[0], lo[1], lo[2]]
    t = (frame - lo[3]) / (hi[3] - lo[3])
    return [lo[0] + t * (hi[0] - lo[0]), lo[1] + t * (hi[1] - lo[1]), lo[2] + t * (hi[2] - lo[2])]


def mul3(a, b):
    o = [0.0] * 9
    for r in range(3):
        for c in range(3):
            s = 0.0
            for k in range(3):
                s += a[k * 3 + r] * b[c * 3 + k]
            o[c * 3 + r] = s
    return o


def ps1mat3(ax, ay, az):
    cx, sx = math.cos(ax * TAU), math.sin(ax * TAU)
    cy, sy = math.cos(ay * TAU), math.sin(ay * TAU)
    cz, sz = math.cos(az * TAU), math.sin(az * TAU)
    Rz = [cx, sx, 0, -sx, cx, 0, 0, 0, 1]
    Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy]
    Rx = [1, 0, 0, 0, cz, sz, 0, -sz, cz]
    return mul3(Rz, mul3(Ry, Rx))


def compose(a, b):
    o = [0.0] * 9
    for i in range(3):
        for j in range(3):
            s = 0.0
            for k in range(3):
                s += a[k * 3 + j] * b[i * 3 + k]
            o[i * 3 + j] = s
    return o


def app(R, v):
    return [R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
            R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
            R[2] * v[0] + R[5] * v[1] + R[8] * v[2]]


def rest_pose(bones, frame=0):
    n = len(bones)
    rot = [None] * n
    pos = [None] * n

    def proc(i):
        b = bones[i]
        anim = b.get('anim') or {}
        c2 = sample(anim.get('ch2'), frame)
        c1 = sample(anim.get('ch1'), frame)
        R = ps1mat3(c2[2], c2[1], c2[0])
        p = (b.get('parent_slot') or 0) - 1
        if p < 0 or p >= n:
            rot[i] = R
            pos[i] = [-c1[0], c1[1], -c1[2]]
            return
        if rot[p] is None:
            proc(p)
        rot[i] = compose(rot[p], R)
        rt = app(rot[p], c1)
        pos[i] = [pos[p][0] - rt[0], pos[p][1] + rt[1], pos[p][2] - rt[2]]

    for i in range(n):
        if rot[i] is None:
            proc(i)
    return rot, pos


def mesh_box(bones, i, rot, pos):
    vs = bones[i].get('verts') or []
    if not vs:
        return None
    R, t = rot[i], pos[i]
    mn = [1e18] * 3
    mx = [-1e18] * 3
    for v in vs:
        x = -(R[0] * v[0] + R[3] * v[1] + R[6] * v[2]) + t[0]
        y = (R[1] * v[0] + R[4] * v[1] + R[7] * v[2]) + t[1]
        z = -(R[2] * v[0] + R[5] * v[1] + R[8] * v[2]) + t[2]
        mn[0] = min(mn[0], x); mx[0] = max(mx[0], x)
        mn[1] = min(mn[1], y); mx[1] = max(mx[1], y)
        mn[2] = min(mn[2], z); mx[2] = max(mx[2], z)
    return {'mn': mn, 'mx': mx, 'd': [mx[k] - mn[k] for k in range(3)]}


def load(folder):
    with open(os.path.join(MODELS, folder, 'anim.json')) as f:
        return json.load(f)


def main():
    an = json.load(open(ANAT))
    folders = sorted({r['folder'] for r in an})
    print('folders in anatomy:', len(folders))
    print('folders on disk:', len([d for d in os.listdir(MODELS) if os.path.isdir(os.path.join(MODELS, d))]))
    missing = [f for f in folders if not os.path.exists(os.path.join(MODELS, f, 'anim.json'))]
    print('missing anim.json:', missing[:20], len(missing))
    nhist = Counter()
    roothist = Counter()
    for f in folders:
        m = load(f)
        bones = m['bones']
        n = len(bones)
        nhist[n] += 1
        roots = [i for i, b in enumerate(bones) if (b.get('parent_slot') or 0) <= 0]
        roothist[len(roots)] += 1
    print('bone count histogram:', dict(sorted(nhist.items())))
    print('root count histogram:', dict(roothist))


if __name__ == '__main__':
    main()
