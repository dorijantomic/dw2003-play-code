// PLACEMENT of the forest-floor cover (meft1008 wall_02 soil; data only): where every fern, clover, grass tuft, leaf,
// twig and pebble lies, its lean / yaw / size and its colour (the measured wall_02 colours, web/built/floorcover.js
// MEAS). WHERE: land only (soilLand(rec).landAt); nothing inside the fight clear radius (the keep-out state's fightR;
// before the first place() a default of 8.5 m); the tall plants (ferns) also avoid the eye -> fighter view cones.
// From there to the land edge of each azimuth the density rises as t^P. One slot per type (floorcover.fern ..
// floorcover.pebble), each by azimuth sector; the ferns switch near / far geometry by distance (slot lodM).
// A new keep-out only re-plans when its signature changes (fight radius step, fighter / ring counts).
// Defaults: mod.fc_<type> (web/built/floorcover.js geometry + cover material).
import * as THREE from "../../lib3d/three.module.js";   // maths only (Euler -> Quaternion -> Matrix4, sRGB -> linear)
import { itemsFrom } from "../slots.js";
import { COVER, MEAS } from "../floorcover.js";
import { soilLand } from "./land.js";
const M = 400;

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickW = (list, u) => { let tot = 0; for (const c of list) tot += c[3]; let a = u * tot; for (const c of list) { a -= c[3]; if (a <= 0) return c; } return list[list.length - 1]; };
const azOfXZ = (x, z) => Math.atan2(x, z) * 180 / Math.PI;

/** The land edge radius (render units) of the azimuth, from the land outline (1 degree steps). */
function edgeAt(land, az) {
  const o = land.outline, k = Math.max(0, Math.min(o.landEnd.length - 1, Math.floor((az - o.az0) / o.stepDeg)));
  return o.landEnd[k] ?? o.stepR * 0;
}
/** Deterministic placement of one type. Returns [{x, z, yaw, s, lean, t, u}] */
function planType(kind, spec, land, clearR, keepOut, state, noise3JS) {
  const r = rng(COVER.SEED + kind.charCodeAt(0) * 131 + kind.length), out = [];
  const rim = land.rim || 6700;
  let tries = 0;
  const maxTries = spec.n * 400;
  const wantTall = kind === "fern";
  while (out.length < spec.n && tries++ < maxTries) {
    const rad = Math.sqrt(r()) * rim, az = r() * 360 - 180;
    const x = Math.sin(az * Math.PI / 180) * rad, z = Math.cos(az * Math.PI / 180) * rad;
    if (rad <= clearR) continue;
    const edge = edgeAt(land, az);
    if (!(edge - clearR > 200)) continue;
    if (rad > edge - 20) continue;
    const t = Math.max(0, Math.min(1, (rad - clearR) / (edge - clearR)));
    if (t < spec.tMin) continue;
    if (!land.landAt(x, z)) continue;
    const n = noise3JS(x / (COVER.PATCH_M * M), 0.5, z / (COVER.PATCH_M * M));
    const dens = Math.pow(t, spec.p) * Math.max(0.06, Math.min(1.4, 0.35 + 1.5 * (n - 0.3)));
    if (r() > dens) continue;
    const s = (spec.h[0] + (spec.h[1] - spec.h[0]) * Math.pow(r(), 1.6)) * M * (0.85 + 0.3 * t);   // bigger toward the trees
    const it = { x, z, yaw: r() * Math.PI * 2, s, lean: r(), t, u: r() };
    if (wantTall && keepOut?.reject && state && keepOut.reject([x, s * 0.5, z], s * 0.9)) continue;
    out.push(it);
  }
  return { items: out, tries };
}
function colourFor(kind, it, u2) {
  if (kind === "fern" || kind === "clover" || kind === "tuft") {
    const g = MEAS.green[0], k = 0.9 + 0.35 * u2;
    return [g[0] * k, g[1] * k, g[2] * k];
  }
  if (kind === "litter") {
    const tot = MEAS.shares.brown + MEAS.shares.light + MEAS.shares.green, x = u2 * tot;
    const c = x < MEAS.shares.brown ? pickW(MEAS.brown, (x / MEAS.shares.brown))
      : x < MEAS.shares.brown + MEAS.shares.light ? pickW(MEAS.light, (x - MEAS.shares.brown) / MEAS.shares.light)
      : MEAS.green[0];
    const k = 0.92 + 0.16 * it.u;
    return [c[0] * k, c[1] * k, c[2] * k];
  }
  if (kind === "twig") { const c = pickW(MEAS.brown, u2); return [c[0] * 1.0, c[1] * 1.0, c[2] * 1.0]; }
  const c = u2 < 0.6 ? pickW(MEAS.neutral, u2 / 0.6) : MEAS.light[1];
  return [c[0], c[1], c[2]];
}
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), C = new THREE.Color();
function placeMatrix(kind, it) {
  // flat things lie on the floor: yaw about Y, a small lean, lifted by half their lean so no edge dips below y 0
  const lean = (kind === "litter" ? 0.30 : kind === "twig" ? 0.10 : kind === "pebble" ? 0.2 : 0.18) * (it.lean - 0.5) * 2;
  E.set(kind === "litter" || kind === "twig" || kind === "pebble" ? lean : lean * 0.8, it.yaw, kind === "litter" ? lean * 0.6 : lean * 0.5, "YXZ");
  Q.setFromEuler(E);
  let y = 0;
  if (kind === "litter") y = 1.5 + it.s * 0.30 * Math.abs(Math.sin(lean)) * 0.9;
  else if (kind === "twig") y = it.s * 0.026 * 0.6;
  else if (kind === "pebble") y = -it.s * 0.04;
  const sx = it.s, sy = it.s;
  M4.compose(V1.set(it.x, y, it.z), Q, V2.set(sx, sy, kind === "pebble" ? it.s * (0.8 + 0.4 * it.u) : sx));
  return M4;
}

const TYPES = { fern: COVER.FERN, clover: COVER.CLOVER, tuft: COVER.TUFT, litter: COVER.LITTER, twig: COVER.TWIG, pebble: COVER.PEBBLE };
const LABEL = { fern: "Ferns", clover: "Clover", tuft: "Grass tufts", litter: "Leaf litter", twig: "Twigs", pebble: "Pebbles" };

export function plan(pctx) {
  if (!pctx.pieces("soil").length) return null;
  const land = soilLand(pctx.rec);
  const group = pctx.newGroup("builtFloorcover");
  const api = { group, built: null, clearR: 0, sig: "", visible: true };
  const info_ = { types: {}, tris: 0, instances: 0, drawCallsMax: 0, buildMs: 0, builds: 0, clearM: 0, shared: [] };
  const per = {};
  let dirty = false, t0 = 0;
  const sigOf = (st) => st ? `${Math.round(st.fightR / COVER.REBUILD_STEP)}|${st.fighters?.length || 0}|${st.rings?.length || 0}` : "none";
  const ferns = { items: [], mats: [], cols: [] };
  function itemsOf(kind, clearR, state) {
    if (!dirty) { dirty = true; t0 = performance.now(); }
    const spec = TYPES[kind];
    const { items, tries } = planType(kind, spec, land, clearR, pctx.keepOut, state, pctx.S.noise3JS);
    const rr = rng(COVER.SEED ^ (kind.charCodeAt(0) * 977));
    items.forEach((it) => { it.col = colourFor(kind, it, rr()); });
    per[kind] = { planned: spec.n, placed: items.length, tries };
    const nS = spec.sectors, list = [];
    const bySector = Array.from({ length: nS }, () => []);
    for (const it of items) bySector[kind === "fern" ? 0 : Math.min(nS - 1, Math.floor((azOfXZ(it.x, it.z) + 180) / 360 * nS))].push(it);
    bySector.forEach((l, si) => l.forEach((it) => {
      const m = placeMatrix(kind, it).toArray();
      C.setRGB(it.col[0] / 255, it.col[1] / 255, it.col[2] / 255, THREE.SRGBColorSpace);
      list.push({ p: [it.x, m[13], it.z], yaw: it.yaw, h: it.s, rad: it.s * 0.5, grp: si, m, col: [C.r, C.g, C.b], src: it });
    }));
    if (kind === "fern") { ferns.items = items; ferns.mats = items.map((it) => placeMatrix(kind, it).clone()); ferns.cols = list.map((q) => q.col.slice()); }
    return itemsFrom(list);
  }
  const clear0 = COVER.CLEAR_DEFAULT_M * M;
  const slots = Object.keys(TYPES).map((kind) => {
    const fern = kind === "fern";
    return {
      id: "floorcover." + kind, label: LABEL[kind], kind: kind === "pebble" ? "rock" : kind === "litter" || kind === "twig" ? "litter" : "plant",
      layer: "builtFloorcover_" + kind, parent: group, default: "mod.fc_" + kind, items: itemsOf(kind, clear0, null),
      meshName: (g) => `builtFloorcover_${kind}_s${g}`,
      meshData: (g) => (fern ? {} : { kind: "floorcover", type: kind, sector: g }),
      ...(fern ? { lodM: COVER.FERN_NEAR_M, lodData: (i) => ({ kind: "floorcover", type: "fern", lod: i ? "far" : "near" }) } : {}),
      sig: "none",
      place(state) {
        const sig = sigOf(state);
        if (sig === this.sig) return this.cur || this.items;   // unchanged keep-out: nothing re-planned, nothing rebuilt
        this.sig = sig;
        return itemsOf(kind, Math.max(state.fightR, 0), state);   // the arena's own fight radius; ferns also avoid the view cones
      },
    };
  });
  const ids = slots.map((s) => s.id);
  function report(clearR) {   // B.info.floorcover: the numbers of what is placed and bound now
    let tris = 0, inst = 0;
    for (const s of slots) {
      const kind = s.id.slice(11), meshes = pctx.slots.meshesOf(s.id), a = s.asset;
      const p = per[kind] || {};
      if (kind === "fern") {
        if (a?.lod) { p.trisNear = a.lod.near[0].geo.userData.tris; p.trisFar = a.lod.far[0].geo.userData.tris; }
        inst += (s.cur || s.items).n;
      } else if ((s.cur || s.items).n) {
        p.draws = meshes.length; p.trisEach = a?.parts?.[0]?.geo?.userData?.tris;
        for (const m of meshes) { tris += (m.geometry.userData?.tris ?? 0) * m.count; inst += m.count; }
      }
      per[kind] = p;
    }
    const lod = pctx.slots.get("floorcover.fern")?.lodInfo;
    Object.assign(info_, { types: per, tris, instances: inst, clearM: +(clearR / M).toFixed(2), buildMs: Math.round(performance.now() - t0) });
    if (lod) { info_.fernNear = lod.near; info_.fernFar = lod.far; }
    info_.builds++; dirty = false;
    api.clearR = clearR; api.built = true;
  }
  const layer = {
    get meshes() { return group.children; },
    group, api: Object.defineProperty(api, "ferns", { get: () => (ferns.items.length ? ferns : null) }), info: info_,
    get uniforms() { return pctx.slots.env.shared?.fcUniforms; },
    get types() { return Object.fromEntries(slots.map((s) => [s.id.slice(11), { spec: TYPES[s.id.slice(11)], mat: s.asset?.parts?.[0]?.mat, geo: s.asset?.parts?.[0]?.geo }])); },
    place(state) { for (const id of ids) pctx.slots.replace(id, state); if (dirty) report(Math.max(state?.fightR ?? 0, 0)); },
    setVisible(v) { api.visible = !!v; for (const id of ids) pctx.slots.setVisible(id, v); },
  };
  pctx.info.floorcover = info_;
  return { slots, layer, after: () => { info_.shared = Object.keys(pctx.slots.env.shared?.fcUniforms || {}); report(clear0); }, afterPlace: (st) => { if (dirty) report(Math.max(st.fightR, 0)); } };
}
