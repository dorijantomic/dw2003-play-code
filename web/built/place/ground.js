// PLACEMENT of the arena ground (data only, no geometry, no material): the recipe's own ground triangles (grass / soil
// pieces + the soil apron outline), the PAINT MASK baked over them (dirt / rock / path / AO bytes; the texture is made
// by the asset from these bytes), the measured palette, the bank strips (positions + per-vertex bottom / top colours),
// whether hills stand past the ground, and the scattered BOULDERS with their keep-out (placeOrder 0: they are placed
// before the plants). Slots: ground.floor (surface; things stand on it), ground.bank, ground.hills, ground.rocks.
// Defaults mod.ground / mod.bank / mod.hills / mod.ground_rocks (web/built/ground.js). B.ground = this plan's layer.
import * as S from "../shared.js";
import { GROUND } from "../ground.js";
import { soilLand, apronOutline } from "./land.js";
import { itemsFrom, itemsOnTriangles, itemsOnRing, composeYaw } from "../slots.js";

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth01 = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const b8 = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));

// ---------------- palette: the recipe's measured colours, sRGB -> linear once ----------------
/** dirt / path / rock from the bank strips' own measured colours, grass from the ground piece's p10/p90 (the same
 *  two entries grass.js bakes blades against). `src` keeps the measured sRGB bytes for the checks. */
export function groundPalette(rec) {
  const one = (kind) => rec.pieces.find((p) => p.kind === kind)?.colours || {};
  const g = one("grass"), b = one("bank");
  const pick = (c, k, d) => (Array.isArray(c?.[k]) ? c[k] : d);
  const src = {
    grassLo: pick(g, "p10", [91, 127, 54]), grassHi: pick(g, "p90", [110, 156, 85]),
    dirt: pick(b, "other", [136, 99, 81]), path: pick(b, "p90", [195, 155, 113]),
    rockLo: pick(b, "p10", [77, 58, 52]), rockHi: pick(b, "top", [143, 102, 84]),
  };
  return {
    grassLo: S.srgb(src.grassLo), grassHi: S.srgb(src.grassHi), dirt: S.srgb(src.dirt), path: S.srgb(src.path),
    rockLo: S.srgb(src.rockLo), rockHi: S.srgb(src.rockHi), moss: S.srgb(src.grassLo), src,
  };
}

// ---------------- the mask: one baked byte grid over the ground ----------------
/** Height of the ground's own triangles over the mask grid (NaN = no ground): a raster of the triangles (flat
 *  position arrays, world units), barycentric per texel centre, the highest triangle wins. */
function rasterHeight(posList, N, E) {
  const h = new Float32Array(N * N).fill(NaN), span = 2 * E;
  const toTex = (v) => (v + E) / span * N;
  for (const P of posList) {
    const V = [0, 1, 2].map(() => ({ x: 0, y: 0, z: 0 }));
    for (let t = 0; t + 8 < P.length; t += 9) {
      for (let k = 0; k < 3; k++) { V[k].x = P[t + k * 3]; V[k].y = P[t + k * 3 + 1]; V[k].z = P[t + k * 3 + 2]; }
      const minX = Math.min(V[0].x, V[1].x, V[2].x), maxX = Math.max(V[0].x, V[1].x, V[2].x);
      const minZ = Math.min(V[0].z, V[1].z, V[2].z), maxZ = Math.max(V[0].z, V[1].z, V[2].z);
      const i0 = Math.max(0, Math.floor(toTex(minX) - 0.5)), i1 = Math.min(N - 1, Math.ceil(toTex(maxX) - 0.5));
      const j0 = Math.max(0, Math.floor(toTex(minZ) - 0.5)), j1 = Math.min(N - 1, Math.ceil(toTex(maxZ) - 0.5));
      const [a, b, c] = V;
      const d00 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2, d01 = (b.x - a.x) * (c.x - a.x) + (b.z - a.z) * (c.z - a.z);
      const d11 = (c.x - a.x) ** 2 + (c.z - a.z) ** 2, den = d00 * d11 - d01 * d01;
      if (Math.abs(den) < 1e-9) continue;
      for (let j = j0; j <= j1; j++) {
        const z = (j + 0.5) / N * span - E;
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) / N * span - E;
          const vx = x - a.x, vz = z - a.z;
          const d20 = vx * (b.x - a.x) + vz * (b.z - a.z), d21 = vx * (c.x - a.x) + vz * (c.z - a.z);
          const bv = (d11 * d20 - d01 * d21) / den, bw = (d00 * d21 - d01 * d20) / den, bu = 1 - bv - bw;
          if (bu < -1e-4 || bv < -1e-4 || bw < -1e-4) continue;
          const y = bu * a.y + bv * b.y + bw * c.y, k = j * N + i;
          if (Number.isNaN(h[k]) || y > h[k]) h[k] = y;
        }
      }
    }
  }
  return h;
}

/** The paint mask bytes (R dirt, G rock, B path, A ao) over the ground triangles (flat position arrays) + its JS
 *  readers. The texture of these bytes is the asset's (web/built/ground.js maskTexture). */
export function bakeArenaMask(posList) {
  const t0 = performance.now();
  const N = GROUND.MASK_RES, E = GROUND.MASK_EXTENT, span = 2 * E, P = GROUND;
  const data = new Uint8Array(N * N * 4);
  const hgt = rasterHeight(posList, N, E);
  let baked = 0, hMax = 0;
  for (let j = 0; j < N; j++) {
    const z = (j + 0.5) / N * span - E;
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N * span - E, r = Math.hypot(x, z);
      // dirt: a worn clearing round the fight, noise patches everywhere, more bare earth where the ground rises
      const wob = (S.noise3JS(x / 2100 + 11.3, 7.31, z / 2100 - 4.7) - 0.5) * 1300;
      const clear = smooth01(P.DIRT_CLEAR[0], P.DIRT_CLEAR[1], r + wob);
      const patch = S.fbm3JS(x / P.DIRT_SCALE, 5.13, z / P.DIRT_SCALE);
      const dirt = 0.5 + 0.55 * (0.5 - clear) + 0.60 * (patch - 0.5) + 0.30 * smooth01(P.DIRT_FAR[0], P.DIRT_FAR[1], r);
      // rock: outcrops, more of them on the rising outer ground (the slope band in the shader does the cliffs)
      const rock = P.ROCK_BASE + P.ROCK_NOISE * (S.fbm3JS(x / P.ROCK_SCALE, 2.37, z / P.ROCK_SCALE) - 0.5) * 2
                 + 0.45 * smooth01(P.ROCK_FAR[0], P.ROCK_FAR[1], r);
      // path: a worn ring round the fight, its radius wandering with the same noise
      const rw = r + (S.noise3JS(x / 2000, 9.11, z / 2000) - 0.5) * 700;
      const path = 0.5 + (P.PATH_W * 0.5 - Math.abs(rw - P.PATH_R)) / P.PATH_W;
      // AO: from the baked ground height, plus a little patchiness
      const hh = hgt[j * N + i], hy = Number.isNaN(hh) ? 0 : hh;
      if (!Number.isNaN(hh)) { baked++; hMax = Math.max(hMax, hh); }
      const ao = 1 - P.AO_RIM * smooth01(P.AO_H[0], P.AO_H[1], Math.max(0, hy))
               - 0.07 * smooth01(0.35, 0.65, S.noise3JS(x / 700, 1.7, z / 700));
      const o = (j * N + i) * 4;
      data[o] = b8(dirt); data[o + 1] = b8(rock); data[o + 2] = b8(path); data[o + 3] = b8(ao);
    }
  }
  // the JS twin of the shader's read: the SAME bytes, bilinear, same uv mapping
  const at = (i, j) => { const k = ((j < 0 ? 0 : j > N - 1 ? N - 1 : j) * N + (i < 0 ? 0 : i > N - 1 ? N - 1 : i)) * 4; return [data[k] / 255, data[k + 1] / 255, data[k + 2] / 255, data[k + 3] / 255]; };
  function sample(x, z) {
    const u = (x + E) / span * N - 0.5, v = (z + E) / span * N - 0.5;
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1), out = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) out[k] = (a[k] * (1 - fu) + b[k] * fu) * (1 - fv) + (c[k] * (1 - fu) + d[k] * fu) * fv;
    return { dirt: out[0], rock: out[1], path: out[2], ao: out[3] };
  }
  /** the ground's own height where the AO raster saw it (null off the ground) — the mask is over the ground */
  function heightAt(x, z) {
    const u = (x + E) / span * N - 0.5, v = (z + E) / span * N - 0.5;
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const get = (a, b) => { const ii = Math.max(0, Math.min(N - 1, a)), jj = Math.max(0, Math.min(N - 1, b)); const y = hgt[jj * N + ii]; return Number.isNaN(y) ? 0 : y; };
    return (get(i, j) * (1 - fu) + get(i + 1, j) * fu) * (1 - fv) + (get(i, j + 1) * (1 - fu) + get(i + 1, j + 1) * fu) * fv;
  }
  const info = { res: N, extent: E, texel: span / N, channels: "R dirt, G rock, B path, A ao", groundTexels: baked,
                 heightMax: Math.round(hMax), ms: Math.round(performance.now() - t0) };
  return { data, res: N, extent: E, span, sample, heightAt, info };
}

/** The mask read in JS exactly as the GPU reads the painted ground's uMask (uv = xz / span + 0.5, bilinear, texel
 *  centres at +0.5, clamped) + the ground paint's AO amount and cliff slope: what grass.js grows blades against. */
export function maskReader(mask) {
  const data = mask.data, N = mask.res, span = mask.span;
  const at = (i, j) => (Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))) * 4;
  return {
    span, aoAmt: GROUND.AO_AMT, cliffLo: GROUND.CLIFF_LO,
    sample(x, z) {
      const uu = (x / span + 0.5) * N - 0.5, vv = (z / span + 0.5) * N - 0.5;
      const i = Math.floor(uu), j = Math.floor(vv), fu = uu - i, fv = vv - j, out = [0, 0, 0, 0];
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      for (let k = 0; k < 4; k++) out[k] = ((data[a + k] * (1 - fu) + data[b + k] * fu) * (1 - fv) + (data[c + k] * (1 - fu) + data[d + k] * fu) * fv) / 255;
      return { dirt: out[0], rock: out[1], path: out[2], ao: out[3] };
    },
  };
}

/** Candidate boulders: along the bank strips' top edges (outward of them) plus a scattered ring on the rising
 *  ground. Cheap boxes only - every one is tested against the keep-out at placement time. */
export function rockCandidates(rec) {
  const P = GROUND.ROCKS, r = rng(P.SEED), list = [];
  for (const p of rec.pieces) {
    if (p.kind !== "bank") continue;
    for (let i = 0; i + 8 < p.pos.length; i += 9) {
      const v = [0, 1, 2].map((k) => p.pos.slice(i + k * 3, i + k * 3 + 3)).sort((a, b) => b[1] - a[1]);
      const [a, b] = v, L = Math.hypot(a[0] - b[0], a[2] - b[2]);
      if (L < 220) continue;
      for (let t = 380; t < L; t += P.BANK_STRIDE) {
        const x = a[0] + (b[0] - a[0]) * t / L, z = a[2] + (b[2] - a[2]) * t / L, out = Math.hypot(x, z) || 1;
        const rad = Math.min(out + P.BANK_OUT, P.MAX_R);   // stay on the ground: the rim has no triangles past it
        list.push({ q: [x / out * rad, 0, z / out * rad], s: P.S[0] + r() * (P.S[1] - P.S[0]), seed: list.length + 1 });
      }
    }
  }
  for (let k = 0; k < P.SCATTER; k++) {
    const az = r() * Math.PI * 2, rad = 3650 + r() * 2800, big = k < P.BIG;
    list.push({ q: [Math.sin(az) * rad, 0, Math.cos(az) * rad],
                s: big ? P.BIG_S[0] + r() * (P.BIG_S[1] - P.BIG_S[0]) : P.S[0] + r() * (P.S[1] - P.S[0]), seed: list.length + 1, big });
  }
  return list;
}

export function plan(pctx) {
  const { rec, pal, info } = pctx, t0 = performance.now(), P = GROUND;
  // 1. the arena's own ground triangles (the fighters stand on exactly these)
  const pieces = rec.pieces.filter((p) => p.kind === "grass" || p.kind === "soil").map((p) => {
    info.pieces[p.name] = { kind: p.kind, tris: p.tris };
    return { name: p.name, kind: p.kind, pos: new Float32Array(p.pos), colours: p.colours || {} };
  });
  // 2. the mask over them, and the palette
  const mask = bakeArenaMask(pieces.map((q) => q.pos));
  const gp = groundPalette(rec);
  gp.haze = pal.haze.clone(); gp.skyHorizon = pal.skyHorizon.clone();   // the hills paint with the sky's own haze
  const soilGround = pieces.some((q) => q.kind === "soil");   // forest floor on a lake: no hills, no scattered boulders
  const hasGround = pieces.length > 0;
  // the soil apron under the tree ring (one outline from the land, soil.js)
  let apron = null;
  if (soilGround) {
    const land = soilLand(rec), o = apronOutline(land);
    apron = { pos: o.pos, outline: o, land: { cards: land.cards.length, rim: land.rim, stepDeg: land.outline.stepDeg, az0: land.outline.az0,
              landEnd: land.outline.landEnd, floorEnd: land.outline.floorEnd, ms: land.ms } };
  }
  // 3. the bank strips: positions and per-vertex bottom / top colours (linear)
  const bank = rec.pieces.filter((p) => p.kind === "bank").map((p) => {
    info.pieces[p.name] = { kind: "bank", tris: p.tris };
    const pos = new Float32Array(p.pos), ys = [];
    for (let i = 1; i < pos.length; i += 3) ys.push(pos[i]);
    const bottom = S.srgb(p.colours.other || p.colours.all, 0.8), top = S.srgb(p.colours.top || p.colours.all);
    return { name: p.name, pos, tris: p.tris, y0: Math.min(...ys), y1: Math.max(...ys), bottom: [bottom.r, bottom.g, bottom.b], top: [top.r, top.g, top.b] };
  });
  const bankTris = bank.reduce((s, b) => s + b.tris, 0);
  const data = { pieces, mask, gp, apron, bank, soilGround, hasGround, maskReader: maskReader(mask) };

  const floorPos = [...pieces.map((q) => q.pos), ...(apron ? [apron.pos] : [])];
  const slots = [];
  if (pieces.length) {
    slots.push({ id: "ground.floor", label: soilGround ? "Forest floor (soil + apron)" : "Ground (painted grass)", kind: "surface", layer: "ground", default: "mod.ground",
                 surface: { pos: floorPos }, items: itemsOnTriangles(floorPos), data });
    pctx.addGround("ground.floor");
  }
  if (bank.length) slots.push({ id: "ground.bank", label: "Bank strips", kind: "surface", layer: "builtBank", default: "mod.bank",
                                surface: { pos: bank.map((b) => b.pos) }, items: itemsOnTriangles(bank.map((b) => b.pos), 120), data, userData: { kind: "bank" } });
  const scatter = hasGround && !soilGround;
  if (scatter) slots.push({ id: "ground.hills", label: "Distant hills", kind: "hill", layer: "builtHills", default: "mod.hills", data,
                            items: itemsOnRing(36, P.HILLS.R[0], P.HILLS.BASE, P.HILLS.H[0]), userData: { kind: "hills" } });

  // 4. the scattered boulders: placed against the same keep-out the plants use, BEFORE them (placeOrder 0)
  const cands = rockCandidates(rec);
  const trisPerRock = 2 * P.ROCKS.HULL_PTS - 4;
  let rockInfo = null;
  const groundHeight = (x, z) => pctx.ko.groundHeight(x, z);
  function rejectRock(c, rho, ko) {
    if (Math.hypot(c[0], c[2]) - rho < ko.fightR) return "fight";
    for (const f of ko.fighters) for (const g of ko.rings) {
      for (let a = 0; a < 360; a += 3) {
        const e = [Math.sin(a * Math.PI / 180) * g.r, g.y, Math.cos(a * Math.PI / 180) * g.r];
        if (S.inViewCone(c, rho, e, f.c, f.r)) return "cone";
      }
    }
    return null;
  }
  /** the bound rock's buried vertices and reach (its own geometry, native units: width 1) */
  function rockShape(asset) {
    const g = asset?.native ? asset.parts?.[0]?.geo : null, a = g?.attributes?.position?.array;
    if (!a) return { bottom: [], maxRad: 0.5 };
    const v = []; for (let i = 0; i < a.length; i += 3) v.push([a[i], a[i + 1], a[i + 2]]);
    return { bottom: v.filter((q) => q[1] < -0.02), maxRad: Math.max(...v.map((q) => Math.hypot(q[0], q[1], q[2]))) };
  }
  function placeRock(it, ko, sh) {
    const r = rng(it.seed * 131 + 7), yaw = r() * Math.PI * 2;
    const sx = it.s, sz = it.s * (0.85 + r() * 0.30), sy = it.s * P.ROCKS.FLAT;
    const cs = Math.cos(yaw), sn = Math.sin(yaw), out = Math.hypot(it.q[0], it.q[2]) || 1, ux = it.q[0] / out, uz = it.q[2] / out;
    let last = null, firstWhy = null;
    for (let push = 0; push <= P.ROCKS.PUSH_MAX + 1e-6; push += P.ROCKS.PUSH) {
      const x = it.q[0] + ux * push * it.s, z = it.q[2] + uz * push * it.s;
      const g = groundHeight(x, z);
      if (g == null) { last = "offGround"; if (!firstWhy) firstWhy = last; continue; }
      // only on ground that is flat enough for a half-buried boulder to sit in
      let lo = g, hi = g, off = false;
      for (const [dx, dz] of [[sx * 0.5, 0], [-sx * 0.5, 0], [0, sz * 0.5], [0, -sz * 0.5]]) {
        const q = groundHeight(x + dx, z + dz);
        if (q == null) { off = true; break; }
        lo = Math.min(lo, q); hi = Math.max(hi, q);
      }
      if (off) { last = "offGround"; if (!firstWhy) firstWhy = last; continue; }
      if (hi - lo > 0.62 * sy) { last = "steep"; if (!firstWhy) firstWhy = last; continue; }
      // its widest ring on the ground (half buried), lowered until every buried vertex is at or below the ground under
      // it, then sunk by SINK (float32 instance matrices read back a hair above an exact surface)
      let y = g;
      for (const v of sh.bottom) {
        const wx = x + cs * v[0] * sx + sn * v[2] * sz, wz = z - sn * v[0] * sx + cs * v[2] * sz;
        const gy = groundHeight(wx, wz);
        if (gy != null) y = Math.min(y, gy - v[1] * sy);
      }
      y -= P.ROCKS.SINK;
      const why = rejectRock([x, y, z], it.s * sh.maxRad * 1.02, ko);
      if (!why) return { at: [x, y, z], yaw, sx, sy, sz, push, firstWhy };
      last = why; if (!firstWhy) firstWhy = why;
    }
    return { why: last, firstWhy };
  }
  const report = () => { if (info.ground) { info.ground.rocks = rockInfo; layer.partsInfo(); } };
  function placeRocks(ko, asset) {
    const t = performance.now(), sh = rockShape(asset);
    const st = { fightR: Math.round(ko.fightR || 0), candidates: cands.length, accepted: 0, rejectedAtSpot: 0,
                 pushed: 0, dropped: 0, byReason: { fight: 0, cone: 0, steep: 0, offGround: 0 }, list: [] };
    const picked = [];
    for (const it of cands) {
      const res = placeRock(it, ko, sh);
      if (res.firstWhy === "fight" || res.firstWhy === "cone") st.rejectedAtSpot++;
      st.list.push([Math.round(it.q[0]), Math.round(it.q[2]), Math.round(it.s), res.at ? "ok" : res.why, res.push ?? null]);
      if (!res.at) { st.byReason[res.why] = (st.byReason[res.why] || 0) + 1; st.dropped++; continue; }
      if (res.push > 0) st.pushed++;
      picked.push({ ...it, ...res });
    }
    const keep = [];   // two boulders may not overlap each other
    for (const p of picked) {
      if (keep.some((q) => Math.hypot(q.at[0] - p.at[0], q.at[2] - p.at[2]) < 0.62 * (q.s + p.s))) { st.dropped++; continue; }
      keep.push(p);
    }
    st.accepted = keep.length;
    st.ms = Math.round(performance.now() - t);
    rockInfo = { ...st, trisPerRock, triangles: st.accepted * trisPerRock };
    return itemsFrom(keep.map((p) => {
      const r = rng(p.seed * 17 + 3), tone = 0.86 + r() * 0.28;
      return { p: p.at, yaw: p.yaw, h: p.sy * 0.78, rad: Math.max(p.sx, p.sz) / 2, m: composeYaw(p.at, p.yaw, p.sx, p.sy, p.sz), col: [tone, r(), 1], at: p.at, s: p.sx };
    }));
  }
  if (scatter) slots.push({
    id: "ground.rocks", label: "Scattered boulders", kind: "rock", layer: "builtBoulders", default: "mod.ground_rocks", placeOrder: 0, data,
    items: itemsFrom([]), meshName: () => "builtBoulders",
    meshData: (g, idx) => { const it = rocksSlot().cur; return { kind: "rocks", at: idx.map((i) => it.list[i].at), scale: idx.map((i) => it.list[i].s) }; },
    place(state, shape, asset) { const it = placeRocks(state, asset); report(); return it; },
  });
  /** no scattered boulders here (no hillside / a forest floor): the numbers say so on every keep-out round */
  function skipRocks(ko) {
    const st = { fightR: Math.round(ko?.fightR || 0), candidates: cands.length, accepted: 0, rejectedAtSpot: 0,
                 pushed: 0, dropped: 0, byReason: { fight: 0, cone: 0, steep: 0, offGround: 0 }, list: [] };
    rockInfo = { ...st, skipped: !hasGround ? "no grass ground in this arena: no hillside to bury a boulder in" : "soil ground: no scattered boulders (the original floor has none)",
                 trisPerRock, triangles: 0 };
    report();
  }
  const rocksSlot = () => pctx.slots.get("ground.rocks");

  const meshesOf = (id) => pctx.slots.meshesOf(id);
  const floorMeshes = () => meshesOf("ground.floor").filter((m) => m.isMesh);
  const layer = {
    get ground() { return floorMeshes(); }, mask, palette: gp,
    get bank() { return meshesOf("ground.bank")[0] || null; }, get hills() { return meshesOf("ground.hills")[0] || null; },
    get rocks() { return meshesOf("ground.rocks")[0] || null; },
    groundHeight, rockCandidates: cands,
    place: (st) => { if (scatter) pctx.slots.replace("ground.rocks", st); else skipRocks(st); },
    meshes: () => [...meshesOf("ground.bank"), ...meshesOf("ground.hills"), ...meshesOf("ground.rocks"), ...floorMeshes()],
    setVisible: (v) => { for (const s of slots) pctx.slots.setVisible(s.id, v); },
    partsInfo: () => (info.ground ? (info.ground.parts = partsInfo()) : partsInfo()),
  };
  const triOf = (m) => (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  const partsInfo = () => {
    const fl = floorMeshes(), hm = meshesOf("ground.hills")[0];
    return {
      ground: { tris: fl.reduce((s, m) => s + m.geometry.attributes.position.count / 3, 0), meshes: fl.length },
      bank: { tris: bankTris, meshes: meshesOf("ground.bank").length ? 1 : 0 },
      rocks: rockInfo ? { count: rockInfo.accepted, trisPerRock: rockInfo.trisPerRock, tris: rockInfo.triangles } : { count: 0, tris: 0 },
      hills: hm ? { ribbons: GROUND.HILLS.R.length, tris: triOf(hm) }
                : { ribbons: 0, tris: 0, skipped: soilGround ? "soil ground: forest on a lake, no hills (the far treeline is the horizon)"
                                                             : "no grass ground in this arena: no ground edge for hills to stand past" },
    };
  };
  function after() {   // info.ground: the numbers of what is placed and bound
    const p = partsInfo(), soil = pctx.slots.instanceOf("ground.floor")?.soilInfo || null;
    info.ground = {
      mask: mask.info, palette: { measured: gp.src }, parts: p,
      triangles: p.ground.tris + p.bank.tris + p.rocks.tris + p.hills.tris,
      ms: Math.round(performance.now() - t0), rocks: rockInfo,
      cliff: { slopeLo: GROUND.CLIFF_LO, slopeHi: GROUND.CLIFF_HI, stepPx: GROUND.STEP_W },
    };
    if (soil) info.ground.soil = soil;
  }
  return { slots, layer, data, after, afterPlace: (st) => { if (!scatter) skipRocks(st); } };
}
