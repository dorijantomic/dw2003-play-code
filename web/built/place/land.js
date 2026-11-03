// LAND of a soil arena (PLACEMENT data, no geometry): the floor triangles + the apron under the tree ring, and the shore
// outline; and the apron's own flat triangles. Moved here from web/built/soil.js (which re-exports soilLand). See the
// soil.js header for the rule (apron IN / OUT, STEP, CARD_R_MAX, shore outline steps).
import { SOIL, APRON_KINDS } from "../soil.js";

// ---------------- land: floor triangles + apron, and the shore outline ----------------
const azOf = (x, z) => Math.atan2(x, z) * 180 / Math.PI;
const wrapDeg = (a) => ((a + 180) % 360 + 360) % 360 - 180;
const LAND = new WeakMap();

/** Land of a soil arena from its recipe (cached per recipe object). */
export function soilLand(rec) {
  if (LAND.has(rec)) return LAND.get(rec);
  const t0 = performance.now();
  const tris = [];
  for (const p of rec.pieces) {
    if (p.kind !== "soil" || !p.pos) continue;
    for (let i = 0; i + 8 < p.pos.length; i += 9) tris.push([p.pos[i], p.pos[i + 2], p.pos[i + 3], p.pos[i + 5], p.pos[i + 6], p.pos[i + 8]]);
  }
  // a bucket grid of the triangles' xz boxes, 500 units a cell
  const C = 500, cells = new Map();
  let rim = 0;
  for (const [ti, t] of tris.entries()) {
    for (let k = 0; k < 3; k++) rim = Math.max(rim, Math.hypot(t[k * 2], t[k * 2 + 1]));
    const x0 = Math.floor(Math.min(t[0], t[2], t[4]) / C), x1 = Math.floor(Math.max(t[0], t[2], t[4]) / C);
    const z0 = Math.floor(Math.min(t[1], t[3], t[5]) / C), z1 = Math.floor(Math.max(t[1], t[3], t[5]) / C);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const key = i * 100003 + j; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(ti); }
  }
  function floorAt(x, z) {
    const list = cells.get(Math.floor(x / C) * 100003 + Math.floor(z / C));
    if (!list) return false;
    for (const ti of list) {
      const [ax, az, bx, bz, cx, cz] = tris[ti];
      const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz), d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz), d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
      const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) return true;
    }
    return false;
  }
  // the upright cards that stand at the floor's rim (the tree ring): every piece with cards, cards within CARD_R_MAX.
// Only the TREE kinds: meft1008's fringe (wall_07) and mushrooms (wall_06) now carry cards too, and the fringe stands
// IN THE LAKE (17.4..24.4 m), so an apron under its cards would fill the bay with soil (the bay must stay open).
  const A = SOIL.APRON, cards = [];
  for (const p of rec.pieces) {
    if (!APRON_KINDS.has(p.kind)) continue;
    for (const c of p.cards || []) {
      const r = Math.hypot(c.base[0], c.base[2]);
      if (r > rim * A.CARD_R_MAX) continue;
      const h = c.w / 2, a = [c.base[0] - c.dir[0] * h, c.base[2] - c.dir[1] * h], b = [c.base[0] + c.dir[0] * h, c.base[2] + c.dir[1] * h];
      let a0 = azOf(a[0], a[1]), a1 = azOf(b[0], b[1]);
      if (wrapDeg(a1 - a0) < 0) [a0, a1] = [a1, a0];
      cards.push({ piece: p.name, a, b, az0: a0, az1: a0 + wrapDeg(a1 - a0), r });
    }
  }
  /** where the ray at azimuth az (deg) meets a card line: r, or null */
  const cardR = (cd, az) => {
    const s = Math.sin(az * Math.PI / 180), c = Math.cos(az * Math.PI / 180);   // ray (x, z) = (s, c) * r
    const ex = cd.b[0] - cd.a[0], ez = cd.b[1] - cd.a[1], den = s * ez - c * ex;
    if (Math.abs(den) < 1e-9) return null;
    const r = (cd.a[0] * ez - cd.a[1] * ex) / den;
    return r > 0 ? r : null;
  };
  function apronRange(az) {
    let lo = Infinity, hi = -Infinity;
    for (const cd of cards) {
      // 0.01 deg of slack at each end: card ends are rounded in the recipe (floor_02 ends at az 135.00 to 2 decimals)
      if (wrapDeg(az - cd.az0) < -0.01 || wrapDeg(az - cd.az0) > cd.az1 - cd.az0 + 0.01) continue;
      const r = cardR(cd, az); if (r == null) continue;
      lo = Math.min(lo, r - A.IN); hi = Math.max(hi, r + A.OUT);
    }
    return hi > lo ? [Math.max(0, lo), hi] : null;
  }
  function apronAt(x, z) { const g = apronRange(azOf(x, z)), r = Math.hypot(x, z); return !!g && r >= g[0] && r <= g[1]; }
  const landAt = (x, z) => floorAt(x, z) || apronAt(x, z);
  // shore outline: per STEP_DEG of azimuth, the land intervals along the ray (STEP_R steps), first lake radius
  const SH = SOIL.SHORE, nb = Math.round(360 / SH.STEP_DEG);
  const outline = { stepDeg: SH.STEP_DEG, stepR: SH.STEP_R, az0: -180, landEnd: [], floorEnd: [], intervals: [] };
  for (let k = 0; k < nb; k++) {
    const az = -180 + k * SH.STEP_DEG, s = Math.sin(az * Math.PI / 180), c = Math.cos(az * Math.PI / 180);
    const iv = []; let inLand = false, start = 0, fEnd = null, lEnd = null;
    for (let r = 0; r <= SH.R_MAX; r += SH.STEP_R) {
      const x = s * r, z = c * r, f = floorAt(x, z), l = f || apronAt(x, z);
      if (!f && fEnd == null) fEnd = r;
      if (!l && lEnd == null) lEnd = r;
      if (l && !inLand) { inLand = true; start = r; }
      if (!l && inLand) { inLand = false; iv.push([start, r - SH.STEP_R]); }
    }
    if (inLand) iv.push([start, SH.R_MAX]);
    outline.landEnd.push(lEnd); outline.floorEnd.push(fEnd); outline.intervals.push(iv);
  }
  const out = { rim, tris: tris.length, cards, floorAt, apronAt, apronRange, landAt, outline, ms: Math.round(performance.now() - t0) };
  LAND.set(rec, out);
  return out;
}

/** The apron OUTLINE (flat triangles, data): polar cells STEP_DEG x STEP_R inside each azimuth's apron range, dropped where the
 *  floor already covers the whole cell (its 4 corners and centre), all at y 0, normal +y. */
export function apronOutline(land) {
  const A = SOIL.APRON, pos = [];
  let cellsKept = 0, cellsOnFloor = 0;
  for (let a = -180; a < 180; a += A.STEP_DEG) {
    // a cell column is kept if a card covers its start, middle or end azimuth (union), so a card ending exactly on a
    // column edge still has soil under its last foot
    const rs = [a, a + A.STEP_DEG / 2, a + A.STEP_DEG].map((x) => land.apronRange(x)).filter(Boolean);
    if (!rs.length) continue;
    const g = [Math.min(...rs.map((q) => q[0])), Math.max(...rs.map((q) => q[1]))];
    const a0 = a * Math.PI / 180, a1 = (a + A.STEP_DEG) * Math.PI / 180;
    for (let r0 = g[0]; r0 < g[1] - 1e-6; r0 += A.STEP_R) {
      const r1 = Math.min(g[1], r0 + A.STEP_R);
      const P = [[a0, r0], [a1, r0], [a1, r1], [a0, r1]].map(([t, r]) => [Math.sin(t) * r, 0, Math.cos(t) * r]);
      const am = (a0 + a1) / 2, rm = (r0 + r1) / 2;
      if (P.every((q) => land.floorAt(q[0], q[2])) && land.floorAt(Math.sin(am) * rm, Math.cos(am) * rm)) { cellsOnFloor++; continue; }
      pos.push(...P[0], ...P[2], ...P[1], ...P[0], ...P[3], ...P[2]);   // wound to face +y
      cellsKept++;
    }
  }
  return { pos: new Float32Array(pos), cellsKept, cellsOnFloor };
}
