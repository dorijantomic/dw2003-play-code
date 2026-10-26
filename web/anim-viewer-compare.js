// K21h — the side-by-side compare: Digimon World 2's original clip beside our DW3 body playing the
// same clip baked onto it (K21d's retarget), on ONE tick, with a per-role displacement table.
//
// The two models live in different frames and different units, and this module is where that is
// stated once, in code:
//
//   * Frame. The DW2 files are glTF 2.0 (Y-up, the converter's node scales carry diag(1,-1,-1)) and
//     the converter maps a glTF world point P to ours as p = M·P with M = diag(1,-1,-1) — see
//     ~/scratch-research/k21d/dw2_to_model.py (`M`, `conj`, `p_dw = M * Pj`). So a DW2 joint at
//     character coordinates (x = right, y = DOWN, z = forward) is [P.x, -P.y, -P.z].
//   * Units. The retarget scaled the donor's motion by sizeRatio = our body's height / the DW2
//     model's height (web/fight/motion-swap-gate.js writes the same number). A DW2 displacement is
//     multiplied by it before it is compared with our body's, so the two columns are in ONE unit:
//     the DW3 model's own.
//   * Roles. Our side's bone roles come from web/fight/digimon-bonemap.js (K12, high confidence).
//     The DW2 side's come from <dw2root>/dw2-bonemaps.json (tools/build_dw2_bonemaps.mjs, geometry
//     over each rig with the twin's anatomy as the prior, side confidence LOW). Both are shown with
//     their bone indices, and one geometry rule is applied to the DW2 torso: a DW2 rig may carry the
//     whole body as ONE part, and when that part's own mesh is at least 4× the volume of the mapped
//     torso's, it IS the body and is used as the torso (Kokatorimon: part 18, the 1959×1510×983
//     piece, not the 422×686×462 part the map names). The override is reported, never silent.
//
// Pure functions only; the DOM wiring lives in anim-viewer.html (tests/anim-viewer-compare.test.js).

/** Roles the table shows, in order. */
export const ROLE_ORDER = ["torso", "head", "footL", "footR", "wingL", "wingR"];
export const ROLE_LABELS = {
  torso: "torso", head: "head", footL: "left foot", footR: "right foot", wingL: "left wing", wingR: "right wing",
};

/** The DW2 glTF frame -> our character space (x right, y down, z forward). k21d's M = diag(1,-1,-1). */
export const toCharacter = (p) => (p ? [p[0], -p[1], -p[2]] : null);

/** A DW2 displacement in our units: the converter's frame change plus the retarget's sizeRatio. */
export function toBodyUnits(v, sizeRatio = 1) {
  const c = toCharacter(v);
  const s = Number.isFinite(+sizeRatio) && +sizeRatio > 0 ? +sizeRatio : 1;
  return c ? [c[0] * s, c[1] * s, c[2] * s] : null;
}

const tip = (chain) => (Array.isArray(chain) && chain.length ? chain[chain.length - 1] : null);
const firstOf = (v) => (Array.isArray(v) && v.length ? v[0] : Number.isInteger(v) ? v : null);

/**
 * Bone indices for the six roles out of a short-key bone map (`t`,`h`,`lL`,`lR`,`wL`,`wR`, where the
 * leg/wing keys are CHAINS and the role is the chain's tip — the foot / the wing tip).
 */
export function roleBones(map) {
  if (!map) return {};
  const out = {
    torso: firstOf(map.t),
    head: firstOf(map.h),
    footL: tip(map.lL),
    footR: tip(map.lR),
    wingL: tip(map.wL),
    wingR: tip(map.wR),
  };
  for (const k of ROLE_ORDER) if (out[k] == null) delete out[k];
  return out;
}

/**
 * The DW2 torso, corrected by the `whole body` geometry rule. `parts` is the per-bone mesh volume
 * measured on the DW2 rig in its bind pose (`[{bone, volume}]`, any units), `map` the DW2 map.
 * Returns { bones, torsoNote } — the note is null when the map's own torso stands.
 */
export function dw2RoleBones(map, parts = null) {
  const bones = roleBones(map);
  if (!bones.torso || !Array.isArray(parts) || !parts.length) return { bones, torsoNote: null };
  const mapped = parts.find((p) => p.bone === bones.torso);
  const big = parts.reduce((a, b) => ((b.volume || 0) > (a.volume || 0) ? b : a), parts[0]);
  if (!mapped || !big || big.bone === bones.torso) return { bones, torsoNote: null };
  if (!(mapped.volume > 0) || big.volume < 4 * mapped.volume) return { bones, torsoNote: null };
  const note = `torso j${big.bone} (the whole-body part; the map named j${bones.torso})`;
  return { bones: { ...bones, torso: big.bone }, torsoNote: note };
}

/** The role rows the table renders: which bone each role is on each side. */
export function roleRows(dw2Bones, dw3Bones) {
  const rows = [];
  for (const role of ROLE_ORDER) {
    const a = dw2Bones?.[role], b = dw3Bones?.[role];
    if (a == null && b == null) continue;
    rows.push({ role, label: ROLE_LABELS[role], dw2: a ?? null, dw3: b ?? null, both: a != null && b != null });
  }
  return rows;
}

export const displacement = (from, to) => (from && to ? [to[0] - from[0], to[1] - from[1], to[2] - from[2]] : null);
export const length3 = (v) => (v ? Math.hypot(v[0], v[1], v[2]) : 0);

/** cos of the angle between two vectors; null when either has no length (direction undefined). */
export function cosine(a, b) {
  const la = length3(a), lb = length3(b);
  if (!(la > 0) || !(lb > 0)) return null;
  return (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb);
}

/**
 * One row's comparison. The DW2 vector is already in our body's units (see toBodyUnits).
 * `ok` = the direction agrees (cos >= 0.5) AND the size is within 2x. A role that moves on one side
 * and stands still on the other is a SIZE mismatch (ratio undefined -> fails), which is the finding
 * the table exists to show.
 */
export function compareRow(dw2Vec, dw3Vec, { epsilon = 1 } = {}) {
  const l2 = length3(dw2Vec), l3 = length3(dw3Vec);
  const moving2 = l2 > epsilon, moving3 = l3 > epsilon;
  const cos = moving2 && moving3 ? cosine(dw2Vec, dw3Vec) : null;
  const ratio = moving2 && moving3 ? (l3 > 0 ? l2 / l3 : Infinity) : (moving2 || moving3 ? Infinity : 1);
  const dirOk = cos == null ? !(moving2 || moving3) : cos >= 0.5;
  const sizeOk = ratio >= 0.5 && ratio <= 2;
  return { dw2: dw2Vec, dw3: dw3Vec, len2: l2, len3: l3, cos, ratio, dirOk, sizeOk, ok: dirOk && sizeOk, moving2, moving3 };
}

/** The roles that agree somewhere in the clip: the top-line "direction agreement N of M roles". */
export function maxAgreement(frames) {
  const byRole = new Map();
  for (const rows of frames || []) {
    for (const r of rows || []) {
      if (!r || !r.both || r.role == null) continue;
      const cur = byRole.get(r.role) || { role: r.role, agree: false, bestCos: null, bestRatio: null };
      const c = r.cmp || r;
      if (c.cos != null && (cur.bestCos == null || c.cos > cur.bestCos)) cur.bestCos = c.cos;
      if (Number.isFinite(c.ratio) && (cur.bestRatio == null || Math.abs(Math.log(c.ratio)) < Math.abs(Math.log(cur.bestRatio)))) cur.bestRatio = c.ratio;
      cur.agree = cur.agree || !!(c.cos != null && c.cos >= 0.5 && c.ratio >= 0.5 && c.ratio <= 2);
      byRole.set(r.role, cur);
    }
  }
  const roles = [...byRole.values()];
  return { agree: roles.filter((r) => r.agree).length, total: roles.length, roles };
}

export const agreementText = (sum) => `direction agreement: ${sum?.agree ?? 0} of ${sum?.total ?? 0} roles`;

// ── clip / tick plumbing ───────────────────────────────────────────────────────────────────────
/** `m050coca` -> `050COCA` (the DW2 file code the K21d source names), null when it does not fit. */
export function dw2CodeForFolder(folder) {
  const m = /^m(\d{3})([a-z0-9]+)$/.exec(String(folder || ""));
  return m ? `${m[1]}${m[2].toUpperCase()}` : null;
}

export function findDw2Entry(models, code) {
  if (!code) return null;
  return (models || []).find((e) => String(e.code || "").toUpperCase() === String(code).toUpperCase()) || null;
}

/** The DW2 clip for a DW2 letter F/G/H/…: the file's own `anim_F` (exact letter wins, then the group). */
export function clipIndexForLetter(anims, letter) {
  const want = String(letter || "").toUpperCase();
  if (!want) return -1;
  const names = (anims || []).map((a, i) => ({
    name: String(typeof a === "string" ? a : a?.name || "").replace(/^anim_/, "").toUpperCase(), i,
  }));
  return names.find((n) => n.name === want)?.i ?? names.find((n) => n.name[0] === want)?.i ?? -1;
}

/** Frames a clip carries on the 30 Hz key grid the DW2 files and the bake table both use. */
export const clipFrames = (durSec, fps = 30) => Math.max(1, 1 + Math.round((durSec || 0) * fps));

/** The shared tick -> frame mapping: one timeline entry per TICK_SPEED ticks, clamped to the last. */
export const frameAtTick = (tick, tickSpeed, lastFrame) => Math.max(0, Math.min(lastFrame | 0, (tick | 0) * (tickSpeed | 0)));

/** Ticks a clip of `frames` entries lasts at `tickSpeed` entries per tick. */
export const ticksForFrames = (frames, tickSpeed) => Math.max(1, Math.ceil(Math.max(1, frames | 0) / Math.max(1, tickSpeed | 0)));

/** The conversion, as Info-tab rows (the brief asks that it be visible, not implied). */
export function conversionRows(sizeRatio = null) {
  const r = [
    ["character space", "x = character right · y = down · z = forward (the PS1 frame our models use)"],
    ["DW2 -> character", "p = diag(1,−1,−1)·P_gltf (the converter's M; k21d/dw2_to_model.py §frame change)"],
    ["units", sizeRatio ? `DW2 displacement × ${(+sizeRatio).toFixed(3)} (sizeRatio = our body height / the DW2 body height, the retarget's own scale)` : "DW2 displacement × 1 (no sizeRatio served: the two columns are raw model units)"],
  ];
  return r;
}

/** The role-bones row for the Info tab: what was compared, bone by bone. */
export function roleBonesRow(dw2Bones, dw3Bones, torsoNote = null) {
  const bits = [];
  for (const role of ROLE_ORDER) {
    const a = dw2Bones?.[role], b = dw3Bones?.[role];
    if (a == null && b == null) continue;
    bits.push(`${ROLE_LABELS[role]} j${a ?? "—"}/${b ?? "—"}`);
  }
  return bits.join(" · ") + (torsoNote ? ` — ${torsoNote}` : "");
}

/** The deep link of a compare view: `?compare=<bake id>[&t=<tick>]`. */
export function compareQuery({ id, tick = null } = {}) {
  const q = new URLSearchParams();
  if (!id) return "";
  q.set("compare", id);
  if (tick != null) q.set("t", String(tick));
  return q.toString();
}

/** One table cell: a displacement as "x / y / z", integers when they are large. */
export function fmtVec(v) {
  if (!v) return "—";
  const one = (x) => {
    const a = Math.abs(x);
    return a >= 10 ? String(Math.round(x)) : a >= 1 ? x.toFixed(1) : x.toFixed(2);
  };
  return v.map(one).join(" / ");
}

/**
 * The bind-pose bounding-box VOLUME of every DW2 joint's own mesh, in file units (the whole-body
 * rule's input). `pose` is the reader's own pose (anim-viewer-dw2.js samplePose/bindPose); a rig
 * whose geometry is one triangle list per bone gets one number per bone, and the part a DW2 export
 * made the whole body out of is simply the biggest one.
 */
export function partVolumes(model, pose) {
  const nodes = model?.json?.nodes || [];
  const joints = model?.json?.skins?.[0]?.joints || [];
  if (!pose?.world || !joints.length) return [];
  const out = [];
  for (let j = 0; j < joints.length; j++) {
    const node = joints[j];
    const kid = (nodes[node]?.children || []).find((c) => nodes[c]?.mesh != null);
    if (kid == null) continue;
    const prim = model.meshes?.[nodes[kid].mesh]?.prims?.[0];
    if (!prim || !prim.count) continue;
    const m = pose.world.subarray(kid * 16, kid * 16 + 16);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < prim.count; i++) {
      const x = prim.pos[i * 3], y = prim.pos[i * 3 + 1], z = prim.pos[i * 3 + 2];
      const w = [
        m[0] * x + m[4] * y + m[8] * z + m[12],
        m[1] * x + m[5] * y + m[9] * z + m[13],
        m[2] * x + m[6] * y + m[10] * z + m[14],
      ];
      for (let k = 0; k < 3; k++) { if (w[k] < mn[k]) mn[k] = w[k]; if (w[k] > mx[k]) mx[k] = w[k]; }
    }
    const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    if (!size.every(Number.isFinite)) continue;
    out.push({ bone: j, volume: size[0] * size[1] * size[2], size, center: mn.map((v, k) => (v + mx[k]) / 2) });
  }
  return out;
}
