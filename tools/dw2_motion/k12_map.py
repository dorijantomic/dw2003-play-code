#!/usr/bin/env python3
"""K12: map every model's skeleton to anatomical roles.

Reads the anatomy table (public design knowledge, K1..K11) and each model's own skeleton
(web/assets/battle/models/<folder>/anim.json) and assigns:

    root, roots, torso, chest, back, head, mouth, eyes
    arms   left/right: shoulder -> hand chain, the firing bone (prop if the arm carries one)
    legs   per side (front/back for quadrupeds): hip -> foot chain
    wings  per side: root -> tip chain
    tail   root -> tip chain
    locomotion  legs, or the body chain when the design has no legs
    extras      bones that are real (antennae, fins, capes) but are not one of the roles above

Everything is decided by ARITHMETIC over the rest pose, the hierarchy and the mesh boxes,
with the anatomy record as the prior for limb counts, sides and kinds:

  * the rest pose is the renderer's own formula (battle3d.js buildBoneWorldMatrices via
    anim-retarget.js restPose): +Y is DOWN, +Z is the facing direction, +X is the character's RIGHT.
  * chains are maximal non-branching paths; a branch starts a new chain (an arm that forks into
    fingers, a pelvis that carries four legs).
  * legs: paired floor-touching chains (a lone central floor chain is a tail, not a leg)
  * wings: the largest meshes in the upper body when the design has wings (their bone origins are
    near the centre line - it is the MEMBRANE that is lateral, so the mesh extent decides)
  * head: the far end of the body along its own axis (top-most for a body taller than it is deep,
    front-most for a body that lies down); for blob/floating designs the body IS the head
  * mouth: the head's forward-most child chain, tip
  * arms: the most lateral chains in the shoulder band (the torso's own height band), which keeps
    tall antennae, eye stalks and wings out of the arm set
  * tail: the central chain at the rear end

No disc-derived data is written here: the table this produces holds bone INDICES and roles only.
Output: bone-map.json next to this script (see --out).
"""
import json, math, os, sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from k12_lib import load, rest_pose, mesh_box, ROOT, MODELS, ANAT
from k11_lib import classify_mode, body_family

# a technique needs a launch bone when it does anything but buff the caster
NO_BONE_MODES = {"self"}
BLOB_PLANS = {"blob", "floating", "humanoid-torso-only"}
HORIZONTAL_FAMILY = {"serpentine", "quadruped"}


def vsub(a, b):
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]


def vlen(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def center(b):
    return [(b['mn'][k] + b['mx'][k]) / 2 for k in range(3)]


def volume(b):
    return b['d'][0] * b['d'][1] * b['d'][2]


def chains_of(bones):
    """Every maximal non-branching path, starting at a root child or at a branch child."""
    n = len(bones)
    kids = defaultdict(list)
    for i, b in enumerate(bones):
        kids[(b.get('parent_slot') or 0) - 1].append(i)
    starts = []
    for p in list(kids.keys()):
        if p < 0 or len(kids[p]) >= 2:
            for c in kids[p]:
                starts.append(c)
    out = []
    for c in sorted(set(starts)):
        path = []
        cur = c
        guard = 0
        while True:
            path.append(cur)
            ks = kids.get(cur) or []
            guard += 1
            if len(ks) != 1 or guard > 24:
                break
            cur = ks[0]
        out.append({'bones': path, 'start': path[0], 'tip': path[-1]})
    return out, kids


def chain_features(ch, bones, pos, boxes, W, H, D):
    b0, bt = ch['start'], ch['tip']
    ch['startPos'] = pos[b0]
    ch['tipPos'] = pos[bt]
    ch['length'] = sum(vlen(vsub(pos[ch['bones'][i + 1]], pos[ch['bones'][i]]))
                       for i in range(len(ch['bones']) - 1))
    ch['reach'] = max(abs(pos[i][0]) for i in ch['bones'])
    ch['meshReach'] = max((max(abs(boxes[i]['mn'][0]), abs(boxes[i]['mx'][0]))
                           for i in ch['bones'] if boxes[i]), default=0)
    ch['meshVol'] = sum(volume(boxes[i]) for i in ch['bones'] if boxes[i])
    ch['meshMax'] = max((max(boxes[i]['d']) for i in ch['bones'] if boxes[i]), default=0)
    ch['tipBox'] = boxes[bt]
    # the mesh reaches further than the bone origin: a foot mesh touches the floor even when the
    # ankle bone sits above it, and a horn reaches above the head bone
    ch['lowY'] = max((boxes[i]['mx'][1] for i in ch['bones'] if boxes[i]), default=ch['tipPos'][1])
    ch['highY'] = min((boxes[i]['mn'][1] for i in ch['bones'] if boxes[i]), default=ch['startPos'][1])
    ch['n'] = len(ch['bones'])
    ch['side'] = 'left' if ch['startPos'][0] < 0 else ('right' if ch['startPos'][0] > 0 else None)
    ch['tipSide'] = 'left' if ch['tipPos'][0] < 0 else ('right' if ch['tipPos'][0] > 0 else None)
    return ch


def extents(boxes, withmesh):
    if not withmesh:
        return [0, 0, 0], [0, 0, 0], [1, 1, 1]
    mn = [min(boxes[i]['mn'][k] for i in withmesh) for k in range(3)]
    mx = [max(boxes[i]['mx'][k] for i in withmesh) for k in range(3)]
    return mn, mx, [max(mx[k] - mn[k], 1) for k in range(3)]


def is_plate(i, boxes, span):
    """A huge, paper-thin mesh at the model's feet: the cast shadow / ground plate, not anatomy."""
    if not boxes[i]:
        return False
    d = sorted(boxes[i]['d'], reverse=True)
    return d[0] > 0.30 * span and d[1] > 0.30 * span and d[2] < 0.03 * d[0]


def analyse(folder, rec, model):
    bones = model['bones']
    n = len(bones)
    rot, pos = rest_pose(bones)
    boxes = [mesh_box(bones, i, rot, pos) for i in range(n)]
    withmesh = [i for i in range(n) if boxes[i]]
    allmn, allmx, _dims = extents(boxes, withmesh)
    span = max(_dims)
    # the cast-shadow plate sits on the ground and is bigger than the character: it would decide
    # "the floor" and "the torso" for us, so it is not anatomy and is excluded from the extents
    plates = [i for i in withmesh if is_plate(i, boxes, span)]
    solid = [i for i in withmesh if i not in plates]
    allmn, allmx, _dims = extents(boxes, solid)
    W, H, D = _dims
    floorY = allmx[1]
    plan = rec['bodyPlan']
    fam = body_family(plan)
    armsA = rec.get('arms') or []
    nLegs = rec.get('legs') or 0
    nWings = rec.get('wings') or 0
    wantTail = bool(rec.get('tail'))
    dom = rec.get('dominantSide')

    chains, kids = chains_of(bones)
    for ch in chains:
        chain_features(ch, bones, pos, boxes, W, H, D)
    roots = [i for i, b in enumerate(bones) if (b.get('parent_slot') or 0) <= 0] or [0]

    claimed = {}
    method = {}
    deviations = []
    unresolved = []

    def claim(ch, tag):
        for i in ch['bones']:
            claimed.setdefault(i, tag)

    def free(ch):
        return not any(i in claimed for i in ch['bones'])

    for r in roots:
        claimed.setdefault(r, 'root')

    volumes = {i: volume(boxes[i]) for i in solid}
    horizontal = D > 1.25 * H and fam in HORIZONTAL_FAMILY
    for i in plates:
        claimed.setdefault(i, 'shadow')

    # ---------------------------------------------------------------- legs
    # floor-touching chains, paired left/right (a lone central floor chain is a tail or a skirt)
    floor_band = 0.14 * H
    # A rig can hang a whole limb off its own root (one root per arm/leg/wing: 7-root rigs exist).
    # Such a chain START is a root bone, and roots are claimed before this pass, which would make the
    # limb unclaimable and the body legless. A root that carries exactly one child and begins a chain
    # of two or more bones is a limb root, not the body root, so it may be claimed by the limb.
    def limb_root(ch):
        return (ch['start'] in roots and len(ch['bones']) >= 2
                and len(kids.get(ch['start'], [])) == 1)
    legCands = [ch for ch in chains if (free(ch) or limb_root(ch)) and not any(i in plates for i in ch['bones'])
                and ch['lowY'] >= floorY - floor_band
                and (ch['reach'] > 0.02 * W or abs(ch['tipPos'][0]) > 0.02 * W)]
    # the FOOT MESH is what stands on the floor (a foot bone sits above its boot, a hanging hand
    # mesh can dip low): +Y is DOWN, so the chain whose mesh reaches lowest (largest lowY) first
    legCands.sort(key=lambda ch: ch['lowY'], reverse=True)
    pairs = []
    used = set()
    for i, a_ in enumerate(legCands):
        if i in used:
            continue
        for j in range(i + 1, len(legCands)):
            b_ = legCands[j]
            if b_['tipPos'][0] * a_['tipPos'][0] < 0 and abs(abs(a_['tipPos'][0]) - abs(b_['tipPos'][0])) < 0.12 * W:
                pairs.append((a_, b_))
                used.add(i)
                used.add(j)
                break
    legs = []
    wantLegs = nLegs if nLegs >= 2 else 0
    for a_, b_ in pairs:
        if wantLegs and len(legs) >= wantLegs:
            break
        if not wantLegs:
            # the design has NO legs: a pair of floor-reaching chains on a slug/blob body is its
            # arms hanging low, not legs - locomotion comes from the body chain instead
            continue
        legs.extend([a_, b_])
    if not wantLegs and not pairs:
        legs = []
    legs.sort(key=lambda ch: (ch['tipPos'][0] < 0, -ch['tipPos'][2]))
    legRoles = []
    sideCount = Counter()
    for ch in legs:
        s = 'left' if ch['tipPos'][0] < 0 else 'right'
        sideCount[s] += 1
        slot = s if sideCount[s] == 1 else '%s%d' % (s, sideCount[s])
        legRoles.append({'slot': slot, 'side': s, 'chain': ch['bones'], 'foot': ch['tip'],
                         'tip': [round(v) for v in ch['tipPos']],
                         'start': [round(v) for v in ch['startPos']]})
        claim(ch, 'leg:' + slot)
    method['legs'] = 'paired floor chains (tip y >= floor - 0.14H)'
    if wantLegs and len(legs) < wantLegs:
        deviations.append('legs: design %d, skeleton pair %d' % (wantLegs, len(legs)))

    # ---------------------------------------------------------------- wings
    wingRoles = []
    if nWings:
        def wing_area(ch):
            b = boxes[ch['start']]
            return (b['d'][0] * b['d'][1]) if b else 0

        wingCands = [ch for ch in chains if free(ch)
                     and ch['meshReach'] > 0.20 * W]
        wingCands.sort(key=lambda ch: -wing_area(ch))
        per = Counter()
        cap = max(1, (nWings + 1) // 2)
        for ch in wingCands:
            if len(wingRoles) >= nWings:
                break
            # side from the bone origin: a wing membrane is drawn centred on its bone and can
            # span both sides, so the box centre would be useless
            s = 'left' if ch['startPos'][0] < 0 else 'right'
            if per[s] >= cap:
                continue
            per[s] += 1
            wingRoles.append({'side': s, 'chain': ch['bones'], 'root': ch['start'], 'tip': ch['tip']})
            claim(ch, 'wing:' + s)
        method['wings'] = 'largest lateral membranes in the upper body (design says %d)' % nWings
        if len(wingRoles) < nWings:
            deviations.append('wings: design %d, skeleton %d' % (nWings, len(wingRoles)))

    # ---------------------------------------------------------------- torso
    trunk_candidates = set(i for i in roots if i not in plates) | set(
        i for ch in chains for i in ch['bones']
        if abs(pos[i][0]) <= 0.18 * W and i not in claimed and i in solid)
    torso = max(trunk_candidates, key=lambda i: volumes.get(i, 0)) if trunk_candidates else roots[0]
    method['torso'] = 'largest free central trunk mesh'

    # ---------------------------------------------------------------- head
    central = [ch for ch in chains if free(ch) and all(abs(pos[i][0]) <= 0.22 * W for i in ch['bones'])]
    if fam in ('blob',) or plan in BLOB_PLANS:
        head = torso
        method['head'] = 'body is the head (plan %s)' % plan
    elif central:
        if horizontal:
            head = max((pos[i][2], i) for ch in central for i in ch['bones'])[1]
            method['head'] = 'central chain far end, front (max z)'
        else:
            head = min((pos[i][1], i) for ch in central for i in ch['bones'])[1]
            method['head'] = 'central chain far end, top (min y)'
    else:
        head = torso
        method['head'] = 'fallback: torso (no central chain)'
    claim({'bones': [head]}, 'head')

    # ---------------------------------------------------------------- mouth
    mouth = head
    hk = [k for k in kids.get(head, []) if boxes[k] and k not in claimed]
    if hk:
        cands = []
        for k in hk:
            ch = next((c for c in chains if c['start'] == k), None)
            if not ch or not free(ch):
                continue
            cands.append((max(pos[i][2] for i in ch['bones']), ch))
        if cands:
            cands.sort(key=lambda t: -t[0])
            if cands[0][0] > pos[head][2] + 0.02 * D:
                mouth = cands[0][1]['tip']
                claim(cands[0][1], 'mouth')
    method['mouth'] = 'head child chain, tip (front)' if mouth != head else 'head (no jaw bone)'
    eyes = head

    # ---------------------------------------------------------------- arms
    torso_y = pos[torso][1]
    armCands = [ch for ch in chains if free(ch) and ch['reach'] > 0.05 * W
                and ch['tipPos'][1] < floorY - 0.10 * H]
    armCands.sort(key=lambda ch: -ch['meshReach'])
    want = Counter()
    for a in armsA:
        s = a.get('side')
        if s in ('left', 'right'):
            want[s] += 1
        elif s == 'center':
            want['right'] += 1
    armRoles = {}
    arms = {'left': [], 'right': []}
    for ch in armCands:
        s = ch['tipSide'] or ch['side']
        if s not in arms:
            continue
        cap = want[s] if want[s] else (1 if armsA else 0)
        if len(arms[s]) >= max(cap, 1 if armsA else 0):
            continue
        arms[s].append(ch)
    for s in ('left', 'right'):
        if arms[s]:
            ch = arms[s][0]
            kind = next((a['kind'] for a in armsA if a.get('side') == s), None)
            armRoles[s] = {'side': s, 'chain': ch['bones'], 'shoulder': ch['start'], 'hand': ch['tip'],
                           'firing': ch['tip'], 'kind': kind, 'reach': round(ch['reach'])}
            claim(ch, 'arm:' + s)
            if len(arms[s]) > 1:
                armRoles[s]['extra'] = [c['bones'] for c in arms[s][1:]]
                for c in arms[s][1:]:
                    claim(c, 'arm:' + s + '2')
        elif want[s]:
            unresolved.append('arm:%s (design %d, none found)' % (s, want[s]))
    if len(armsA) > 2 and len(armRoles) * 2 < len(armsA):
        deviations.append('multi-arm: design %d, mapped %d' % (len(armsA), len(armRoles) * 2))
    method['arms'] = 'most lateral chains in the shoulder band, capped by the design arm count'

    # ---------------------------------------------------------------- tail
    tail = None
    if wantTail:
        rest = [ch for ch in chains if free(ch) and all(abs(pos[i][0]) <= 0.25 * W for i in ch['bones'])]
        if rest:
            if horizontal:
                pick = min(rest, key=lambda ch: min(pos[i][2] for i in ch['bones']))
                ok = min(pos[i][2] for i in pick['bones']) < 0.0
            else:
                pick = max(rest, key=lambda ch: max(pos[i][1] for i in ch['bones']))
                ok = max(pos[i][1] for i in pick['bones']) > floorY - 0.45 * H
            if ok:
                tail = {'root': pick['start'], 'tip': pick['tip'], 'chain': pick['bones'],
                        'tipPos': [round(v) for v in pick['tipPos']]}
                claim(pick, 'tail')
        method['tail'] = 'central chain at the rear end (%s)' % ('min z' if horizontal else 'max y')
        if not tail:
            deviations.append('tail: design "%s", no tail chain' % str(rec.get('tail'))[:36])

    # ---------------------------------------------------------------- locomotion
    locomotion = [i for leg in legRoles for i in leg['chain']]
    locMethod = 'leg chains'
    if not locomotion:
        # the rig's trees: a body tree and (often) a second root that carries the limbs. The body
        # chain is the longest chain that starts at a child of a root (or at the torso).
        rootkids = set()
        for r in roots:
            rootkids.update(kids.get(r, []))
        body = [ch for ch in chains if ch['start'] in rootkids or ch['start'] == torso]
        body.sort(key=lambda ch: -ch['n'])
        if body:
            locomotion = body[0]['bones']
            locMethod = 'body chain (no leg bones in the rig)'
        else:
            locomotion = sorted(set([roots[0]] + ([head] if head != roots[0] else [])))
            locMethod = 'root+head fallback'
    if len(locomotion) < 2:
        # a one-bone body still moves: the root, its children (a star-shaped rig: a card body with
        # corner bones), the torso and the head are its locomotion chain
        first = locomotion[0] if locomotion else roots[0]
        locomotion = sorted(set(locomotion) | set([roots[0], torso, head]) | set(kids.get(first, [])))
        locMethod += ' + root/children (single-bone body)'
    method['locomotion'] = locMethod

    # ---------------------------------------------------------------- extras
    extras = []
    for ch in chains:
        if not free(ch):
            continue
        if not any(boxes[i] for i in ch['bones']):
            continue
        extras.append({'chain': ch['bones'], 'why': 'unclaimed chain',
                       'start': [round(v) for v in ch['startPos']], 'tip': [round(v) for v in ch['tipPos']]})
        claim(ch, 'extra')

    # ---------------------------------------------------------------- emitters
    def arm_firing(side):
        a = armRoles.get(side)
        return a['firing'] if a else None

    emit = {}
    for mode in ('left-arm', 'right-arm', 'both-arms', 'mouth', 'head', 'eyes', 'chest', 'back',
                 'tail', 'wings', 'whole-body'):
        if mode == 'left-arm':
            b = arm_firing('left')
        elif mode == 'right-arm':
            b = arm_firing('right')
        elif mode == 'both-arms':
            l, r = arm_firing('left'), arm_firing('right')
            b = r if r is not None else l
            if l is not None and r is not None:
                emit['both-arms-bones'] = [l, r]
        elif mode == 'mouth':
            b = mouth
        elif mode == 'eyes':
            b = eyes
        elif mode == 'head':
            b = head
        elif mode == 'chest':
            b = torso
        elif mode == 'back':
            b = torso
        elif mode == 'tail':
            b = tail['tip'] if tail else None
        elif mode == 'wings':
            b = wingRoles[0]['tip'] if wingRoles else None
            if len(wingRoles) > 1:
                emit['wings-bones'] = [w['tip'] for w in wingRoles]
        else:
            b = roots[0]
        if b is not None:
            emit[mode] = b

    # ---------------------------------------------------------------- per technique
    techs = []
    proj_total = proj_ok = 0
    srcCount = Counter()
    for a in rec.get('attackSources') or []:
        name = a.get('technique')
        mode = classify_mode(a.get('style'), a.get('bodyPart'))
        style = a.get('style')
        bone = None
        source = 'annotation'
        if mode == 'self':
            source = 'self'
        elif mode in emit:
            bone = emit[mode]
            source = 'annotation' if mode not in ('chest', 'back') else 'torso'
        elif mode in ('left-arm', 'right-arm', 'both-arms', 'arms-unspecified', 'unknown', 'other'):
            # an arm mode with no such arm in the rig: the annotated side first (a left-arm
            # technique prefers the left arm even when the design's dominant side is the other
            # one), then the dominant side, then right, then left.
            order = []
            if mode in ('left-arm', 'right-arm'):
                order.append(mode.split('-')[0])
            if dom in ('left', 'right') and dom not in order:
                order.append(dom)
            order += [s for s in ('right', 'left') if s not in order]
            for s in order:
                if arm_firing(s) is not None:
                    bone = arm_firing(s)
                    source = 'dominant-side' if s == dom else 'first-arm'
                    break
        # a non-arm emitter the rig cannot provide (no mouth/tail/wing bone) leaves from the
        # whole body: the root is the body's own emitter bone
        if mode != 'self' and bone is None:
            bone = emit.get('whole-body', torso)
            source = 'fallback-body'
        if mode != 'self' and bone is None:
            bone = torso
            source = 'fallback-torso'
        srcCount[source] += 1
        proj = mode != 'self'
        if proj:
            proj_total += 1
            if bone is not None:
                proj_ok += 1
        techs.append({'name': name, 'style': style, 'mode': mode, 'bone': bone, 'source': source})
        if proj and bone is None:
            unresolved.append('tech:%s (%s %s)' % (name, style, mode))

    # ---------------------------------------------------------------- symmetry
    sym = {}
    if armRoles.get('left') and armRoles.get('right'):
        L, R = armRoles['left']['chain'], armRoles['right']['chain']
        err = 0.0
        for k in range(min(len(L), len(R))):
            pl, pr = pos[L[k]], pos[R[k]]
            err = max(err, abs(pl[0] + pr[0]) / W, abs(pl[1] - pr[1]) / H, abs(pl[2] - pr[2]) / D)
        sym['arms'] = round(err, 4)
    if len(legRoles) >= 2:
        err = 0.0
        for a_ in legRoles:
            if a_['side'] != 'left':
                continue
            b_ = next((x for x in legRoles if x['side'] == 'right' and len(x['chain']) == len(a_['chain'])
                       and abs(x['tip'][2] - a_['tip'][2]) <= abs(x['tip'][2] - a_['tip'][2])), None)
            if not b_:
                continue
            for k in range(len(a_['chain'])):
                pl, pr = pos[a_['chain'][k]], pos[b_['chain'][k]]
                err = max(err, abs(pl[0] + pr[0]) / W, abs(pl[1] - pr[1]) / H, abs(pl[2] - pr[2]) / D)
        sym['legs'] = round(err, 4)

    coverage = len([i for i in withmesh if i in claimed]) / max(1, len(withmesh))
    return {
        'folder': folder, 'name': rec.get('name'), 'numBones': n,
        'plan': plan, 'family': fam, 'horizontal': bool(horizontal),
        'dominantSide': dom,
        'root': roots[0] if roots else 0, 'roots': roots,
        'torso': torso, 'chest': torso, 'back': torso,
        'head': head, 'mouth': mouth, 'eyes': eyes,
        'arms': armRoles,
        'legs': legRoles,
        'wings': wingRoles,
        'tail': tail,
        'locomotion': locomotion,
        'extras': extras,
        'emit': emit,
        'techs': techs,
        'method': method,
        'symmetry': sym,
        'coverage': round(coverage, 3),
        'deviations': deviations,
        'unresolved': unresolved,
        'size': {'W': round(W), 'H': round(H), 'D': round(D)},
        'sources': dict(srcCount),
        'proj': [proj_ok, proj_total],
    }


def main():
    an = json.load(open(ANAT))
    byFolder = {}
    for r in an:
        byFolder.setdefault(r['folder'], r)
    folders = sorted(byFolder)
    out = {}
    for f in folders:
        out[f] = analyse(f, byFolder[f], load(f))
    dest = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'bone-map.json')
    if '--out' in sys.argv:
        dest = sys.argv[sys.argv.index('--out') + 1]
    with open(dest, 'w') as fh:
        json.dump({'models': out}, fh)
    unresolved = Counter()
    for m in out.values():
        for u in m['unresolved']:
            unresolved[u.split(' ')[0]] += 1
    proj = sum(m['proj'][0] for m in out.values()), sum(m['proj'][1] for m in out.values())
    cov = sum(m['coverage'] for m in out.values()) / len(out)
    src = Counter()
    for m in out.values():
        src.update(m['sources'])
    print('models %d  -> %s' % (len(out), dest))
    print('models without arms: %d' % len([f for f, m in out.items() if not m['arms']]))
    print('arms unresolved sides: %d' % len([1 for m in out.values() for u in m['unresolved'] if u.startswith('arm:')]))
    print('techniques with a launch bone: %d/%d' % proj)
    print('resolution sources:', dict(src))
    print('mean mesh-bone coverage: %.3f' % cov)
    print('unresolved keys:', unresolved.most_common(8))
    dev = Counter()
    for m in out.values():
        for d in m['deviations']:
            dev[d.split(':')[0]] += 1
    print('deviations:', dev.most_common())
    for f, m in out.items():
        if m['unresolved']:
            print('  UNRESOLVED', f, m['unresolved'][:4])


if __name__ == '__main__':
    main()
