// SLOTS + BINDER of a built arena. PLACEMENT and ASSETS are fully separate:
//   PLACEMENT  web/built/place/<module>.js turns the recipe into SLOT DATA only (no geometry, no material):
//     slot = { id, label, kind, layer (mesh name base = colour-fit layer), parent ("world" | "scene"), default (asset id),
//              items: { n, p[3n], yaw[n], h[n], rad[n], m?[16n] (exact transforms, made for the default asset), col?[3n],
//                       grp?[n] (one mesh per group: sector / variant), attrs?{ name: { size, array } }, list?[] (records) },
//              native: { h, r } (the default asset's size, the units of m), userData{} (what every made mesh carries),
//              meshName(g, part, pi, np)?, meshData(g, idx)?, surface?{...} (outlines / triangles), data{} (measured numbers),
//              place?(state, shape, asset) -> items (keep-out: positions for this fight radius / eye rings, given the
//              BOUND asset's shape), motion?(t, i) -> { p, yaw, h, hidden } (things that move: gulls), lodM? (near/far, m) }
//   ASSETS     web/built/registry.js: by id; make(env, slot) -> { parts [{ geo, mat, attrs? }] (instanced) | build(slot, ctx, items) }
//   BINDER     (this file) builds the scene from slots + chosen assets, ONE rule for every slot:
//     - an asset with build(): it builds itself from the slot's data (procedural piles, spires, surfaces, clouds, sky ...)
//     - an asset with parts: instanced at the slot's items, one InstancedMesh per group and part. The slot's exact
//       matrices m are used for the asset they were made for (asset.native); any other asset stands at p / yaw with
//       its height fitted to h (footprint capped by rad); per-instance colour multiplies (instanceColor)
//     - keep-out (slot.place) runs again with the bound asset's shape on every swap and every fight-radius change;
//       a procedural asset with inst.place() re-lays itself out from the new items
//     - LOD (asset.lod near/far + slot.lodM) and motion (slot.motion) work for any parts asset
//     - meshes are named `layer...` (colour fit follows) and carry slot.userData (the viewer's layer switches, the
//       water's reflection hide list, mirror.js); "change" listeners (mirror.js) rebuild what they derive from a slot
//   Choices: <pack>.slots.json { bind: { slotId: assetId }, at: { slotId: ms } } (tools/swap_asset.mjs, git-ignored), then the
//   viewer's own ("default" there = this slot back to its default). A file binding older than the viewer's "Reset
//   everything" time (fileResetAt, ms) is ignored, so the page's Reset clears file bindings too.
import * as THREE from "../lib3d/three.module.js";
import * as REG from "./registry.js";

const MAXN = 20000;   // most instances a FOREIGN asset draws in one slot (grass blades: 450 000 -> every k-th)
const FIT_R = 3.5;    // a foreign asset's footprint may be this many slot radii wide before the height fit gives way

export const rng = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

/** THREE: Matrix4.compose(p, Quaternion.setFromAxisAngle((0, 1, 0), yaw), (sx, sy, sz)), the same float maths, no
 *  objects (placement data stays plain numbers; a matrix made here is bit-identical to the one three would make) */
export function composeYaw(p, yaw, sx, sy = sx, sz = sx) {
  const h = yaw / 2, sn = Math.sin(h);
  const x = 0 * sn, y = 1 * sn, z = 0 * sn, w = Math.cos(h);
  const x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  return [(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0, (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
          (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0, p[0], p[1], p[2], 1];
}
/** Columnar items from records [{ p, yaw, h, rad, m?, col?, grp? }] (the placement helper). */
export function itemsFrom(list, { attrs = null } = {}) {
  const n = list.length, it = { n, p: new Float64Array(n * 3), yaw: new Float64Array(n), h: new Float64Array(n), rad: new Float64Array(n), list };
  const hasM = n && list[0].m, hasC = n && list[0].col, hasG = n && list[0].grp != null;
  if (hasM) it.m = new Float32Array(n * 16);
  if (hasC) it.col = new Float32Array(n * 3);
  if (hasG) it.grp = new Int32Array(n);
  list.forEach((q, i) => {
    it.p[i * 3] = q.p[0]; it.p[i * 3 + 1] = q.p[1]; it.p[i * 3 + 2] = q.p[2];
    it.yaw[i] = q.yaw || 0; it.h[i] = q.h; it.rad[i] = q.rad;
    if (hasM) (q.m.isMatrix4 ? q.m.toArray(it.m, i * 16) : it.m.set(q.m, i * 16));
    if (hasC) { it.col[i * 3] = q.col[0]; it.col[i * 3 + 1] = q.col[1]; it.col[i * 3 + 2] = q.col[2]; }
    if (hasG) it.grp[i] = q.grp;
  });
  if (attrs) it.attrs = attrs;
  return it;
}
/** n points spread over flat xyz triangle lists by area (deterministic): where a thing stands on a SURFACE slot. */
export function itemsOnTriangles(posList, n = 400, seed = 7, size = 400) {
  const tris = []; let tot = 0;
  for (const pos of posList) for (let i = 0; i + 8 < pos.length; i += 9) {
    const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
    const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
    const a = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (a > 1e-6) { tot += a; tris.push([pos, i, tot]); }
  }
  const r = rng(seed), out = [];
  if (tris.length) for (let k = 0; k < n; k++) {
    const x = r() * tot; let lo = 0, hi = tris.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m][2] < x) lo = m + 1; else hi = m; }
    const [pos, i] = tris[lo], s1 = Math.sqrt(r()), s2 = r(), w = [1 - s1, s1 * (1 - s2), s1 * s2];
    out.push({ p: [0, 1, 2].map((c) => w[0] * pos[i + c] + w[1] * pos[i + 3 + c] + w[2] * pos[i + 6 + c]), yaw: r() * Math.PI * 2, h: size, rad: size * 0.5 });
  }
  return itemsFrom(out);
}
/** n points on a ring of radius R at height y (sky, clouds, horizon). */
export function itemsOnRing(n, R, y, size) {
  return itemsFrom(Array.from({ length: n }, (_, k) => { const a = k / n * Math.PI * 2; return { p: [Math.sin(a) * R, y, Math.cos(a) * R], yaw: a + Math.PI, h: size, rad: size * 0.5 }; }));
}

/** B.layers entry of a placement: reads through to what the default asset of its slot(s) built (meshes, info, ...). */
export function layerFacade(slotsApi, ...ids) {
  const pick = (k) => { for (const id of ids) { const inst = slotsApi.instanceOf(id); if (inst && k in inst) return inst[k]; } return undefined; };
  return new Proxy({}, { get: (t, k) => (k in t ? t[k] : pick(k)), has: (t, k) => k in t || pick(k) !== undefined });
}
/** keep-out shape of a parts asset, in its own units: one sphere round every triangle (+ wind room), grouped in 4
 *  height bands (the trees' rule, web/arena-built.js); its box, farthest vertex and buried vertices. */
export function shapeOfParts(parts, windShare = 0.04) {
  const geo = parts[0]?.geo; if (!geo?.attributes?.position) return null;
  const pa = geo.attributes.position.array, ix = geo.index ? geo.index.array : null, nT = Math.floor((ix ? ix.length : pa.length / 3) / 3);
  const b = new THREE.Box3().setFromBufferAttribute(geo.attributes.position), y0 = b.min.y, y1 = b.max.y, NB = 4;
  const bands = Array.from({ length: NB }, () => []);
  const vi = (t, k) => (ix ? ix[t * 3 + k] : t * 3 + k);
  for (let t = 0; t < nT; t++) {
    const v = [0, 1, 2].map((k) => [pa[vi(t, k) * 3], pa[vi(t, k) * 3 + 1], pa[vi(t, k) * 3 + 2]]);
    const c = [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k]) / 3);
    const r = Math.max(...v.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]))) + windShare * (y1 - y0);
    bands[Math.min(NB - 1, Math.max(0, Math.floor((c[1] - y0) / Math.max(y1 - y0, 1e-9) * NB)))].push({ c, r });
  }
  let maxRad = 0; const bottomVerts = [];
  for (let i = 0; i < pa.length; i += 3) { maxRad = Math.max(maxRad, Math.hypot(pa[i], pa[i + 1], pa[i + 2])); if (pa[i + 1] < -0.02) bottomVerts.push([pa[i], pa[i + 1], pa[i + 2]]); }
  return {
    bands: bands.filter((l) => l.length).map((tris) => {
      const bb = new THREE.Box3(); for (const t of tris) bb.expandByPoint(new THREE.Vector3(...t.c));
      const c = bb.getCenter(new THREE.Vector3()).toArray();
      return { c, r: Math.max(...tris.map((t) => Math.hypot(t.c[0] - c[0], t.c[1] - c[1], t.c[2] - c[2]) + t.r)), tris };
    }),
    box: { min: b.min.toArray(), max: b.max.toArray() }, tris: nT, maxRad, bottomVerts,
  };
}
/** a shape scaled by k (a foreign asset's shape in the slot's native units) */
function scaleShape(sh, k) {
  if (!sh || k === 1) return sh;
  const t = (o) => ({ c: o.c.map((v) => v * k), r: o.r * k });
  return { ...sh, bands: sh.bands.map((b) => ({ ...t(b), tris: b.tris.map(t) })), box: { min: sh.box.min.map((v) => v * k), max: sh.box.max.map((v) => v * k) },
           maxRad: sh.maxRad * k, bottomVerts: sh.bottomVerts.map((v) => v.map((x) => x * k)) };
}

export function createSlots({ world, scene, env, colourFit = null, pack = "", file = null, choices = null, fileResetAt = 0, onChange = () => {} }) {
  const slots = new Map();           // id -> slot (the placement's data + its binding)
  const wanted = new Map();          // slot id -> asset id (file, then the viewer's choices)
  const fileAt = file?.at || {};
  for (const [k, v] of Object.entries(file?.bind || {})) if (!(fileResetAt > 0) || (fileAt[k] || 0) > fileResetAt) wanted.set(k, v);
  for (const [k, v] of Object.entries(choices || {})) { if (v === "default") wanted.delete(k); else wanted.set(k, v); }
  const view = { choices: { ...(choices || {}) } };
  const listeners = new Set();
  let pending = 0, keep = null;
  const waiters = [];
  const flush = () => { if (pending === 0) while (waiters.length) waiters.shift()(); };
  const emit = (id) => { for (const f of listeners) { try { f(id); } catch (e) { console.warn("[slots] listener", e); } } };
  const ctx = { ...env, world, scene };

  // ---------------- the instancer (every parts asset, any slot) ----------------
  const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _P = new THREE.Vector3(), _S = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
  const nativeOf = (s, asset) => s.native || { h: asset.h, r: asset.r };
  /** a foreign asset's scale at the slot's native size (per item it is (h / native h) x this) */
  const fitOf = (s, asset) => { const N = nativeOf(s, asset); return Math.min(N.h / asset.h, FIT_R * N.r / asset.r); };
  const useNative = (asset, items) => !!(asset.native && items.m);
  const itemScale = (s, asset, items, i) => Math.max(1e-6, Math.min(items.h[i] / asset.h, FIT_R * items.rad[i] / asset.r));
  function instanceMatrices(s, asset, items, idx) {
    const out = new Float32Array(idx.length * 16), native = useNative(asset, items);
    idx.forEach((i, j) => {
      if (native) { out.set(items.m.subarray(i * 16, i * 16 + 16), j * 16); return; }
      _Q.setFromAxisAngle(_Y, items.yaw[i]); _P.set(items.p[i * 3], items.p[i * 3 + 1], items.p[i * 3 + 2]); _S.setScalar(itemScale(s, asset, items, i));
      _M.compose(_P, _Q, _S).toArray(out, j * 16);
    });
    return out;
  }
  function groupsOf(items, cap) {   // [[g, idx[]]] in group order; a foreign asset draws at most `cap` of them
    const n = items.n, stride = cap && n > cap ? Math.ceil(n / cap) : 1, by = new Map();
    for (let i = 0; i < n; i += stride) { const g = items.grp ? items.grp[i] : 0; (by.get(g) || by.set(g, []).get(g)).push(i); }
    return [...by.entries()].sort((a, b) => a[0] - b[0]);
  }
  const lodSets = new Map();
  function buildInstanced(s, asset, items) {
    const parent = s.group ? new THREE.Group() : null;
    if (parent) parent.name = s.group;
    const meshes = [], native = useNative(asset, items);
    const variants = asset.variants || [asset.parts];
    const groups = groupsOf(items, native ? 0 : MAXN);
    const np = variants[0].length;
    const lod = asset.lod && s.lodM ? asset.lod : null;
    const nameOf = (g, part, pi) => (s.meshName ? s.meshName(g, part, pi, np, asset) : `${s.layer}_s${g}${np > 1 ? "_" + pi : ""}`);
    for (let pi = 0; pi < np; pi++) {          // parts outer, groups inner: a composite keeps its parts' draws together
      for (const [g, idx] of groups) {
        const parts = variants.length > 1 ? variants[native ? Math.min(g, variants.length - 1) : (g % variants.length)] : variants[0];
        const part = parts[pi]; if (!part) continue;
        const mats = instanceMatrices(s, asset, items, idx);
        const mk = (geo, name) => {
          let gg = geo;
          const own = native ? items.attrs : null;
          if (own || part.attrs) {   // per-instance attributes: the slot's own (placement data) or the asset's constants
            gg = geo.clone();
            for (const [nm, a] of Object.entries(own || {})) {
              const arr = new Float32Array(idx.length * a.size);
              idx.forEach((i, j) => { for (let c = 0; c < a.size; c++) arr[j * a.size + c] = a.array[i * a.size + c]; });
              gg.setAttribute(nm, new THREE.InstancedBufferAttribute(arr, a.size));
            }
            for (const [nm, [size, fill]] of Object.entries(part.attrs || {})) {
              if (gg.attributes[nm]) continue;
              const arr = new Float32Array(idx.length * size);
              for (let j = 0; j < idx.length; j++) for (let c = 0; c < size; c++) arr[j * size + c] = Array.isArray(fill) ? fill[c] : fill;
              gg.setAttribute(nm, new THREE.InstancedBufferAttribute(arr, size));
            }
          }
          const m = new THREE.InstancedMesh(gg, part.mat, idx.length);
          m.instanceMatrix.array.set(mats);
          if (items.col) {
            const c = new Float32Array(idx.length * 3);
            idx.forEach((i, j) => { c[j * 3] = items.col[i * 3]; c[j * 3 + 1] = items.col[i * 3 + 1]; c[j * 3 + 2] = items.col[i * 3 + 2]; });
            m.instanceColor = new THREE.InstancedBufferAttribute(c, 3);
          }
          m.name = name;
          m.userData = { ...(s.userData || {}), ...(s.meshData ? s.meshData(g, idx, part, pi) : {}), ...(part.userData || {}) };
          if (part.renderOrder != null) m.renderOrder = part.renderOrder;
          if (part.frustumCulled === false || s.frustumCulled === false || lod) m.frustumCulled = false;
          if (part.onBeforeRender) m.onBeforeRender = part.onBeforeRender;
          return m;
        };
        if (lod) {   // near / far geometry, full capacity each; update() moves the instances between them (floor cover ferns)
          const near = mk(lod.near[pi].geo, `${s.layer}_${lod.names?.[0] ?? "near"}`), far = mk(lod.far[pi].geo, `${s.layer}_${lod.names?.[1] ?? "far"}`);
          for (const m of [near, far]) {
            if (s.lodData) Object.assign(m.userData, s.lodData(m === near ? 0 : 1));
            m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            if (!m.instanceColor) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(idx.length * 3).fill(1), 3);
            m.instanceColor.setUsage(THREE.DynamicDrawUsage);
            (parent || parentOf(s)).add(m); meshes.push(m);
          }
          lodSets.set(s.id, { near, far, mats, cols: near.instanceColor.array.slice(), idx, items, mask: "" });
        } else {
          const m = mk(part.geo, nameOf(g, part, pi));
          m.computeBoundingSphere();
          meshes.push(m);
          if (parent) parent.add(m);
        }
      }
    }
    return { objects: parent ? [parent] : meshes.filter((m) => !m.parent), meshes, parent, instanced: true };
  }
  function lodStep(s, eye, force) {
    const L = lodSets.get(s.id); if (!L || !eye) return;
    const near = s.lodM * 400, nearIdx = [], farIdx = []; let mask = "";
    L.idx.forEach((i, j) => { const n = Math.hypot(L.items.p[i * 3] - eye.x, L.items.p[i * 3 + 2] - eye.z) < near; (n ? nearIdx : farIdx).push(j); mask += n ? "1" : "0"; });
    if (!force && mask === L.mask) return;
    L.mask = mask;
    for (const [m, list] of [[L.near, nearIdx], [L.far, farIdx]]) {
      list.forEach((src, j) => { m.instanceMatrix.array.set(L.mats.subarray(src * 16, src * 16 + 16), j * 16); m.instanceColor.setXYZ(j, L.cols[src * 3], L.cols[src * 3 + 1], L.cols[src * 3 + 2]); });
      m.count = list.length; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    }
    s.lodInfo = { near: nearIdx.length, far: farIdx.length };
  }
  function buildSurface(s, asset) {   // a surface asset on a SURFACE slot: the slot's own outline triangles, the asset's material
    const meshes = s.surface.pos.map((pos, k) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos instanceof Float32Array ? pos : Float32Array.from(pos), 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, asset.surfaceMat);
      m.name = `${s.layer}_${k}`; m.userData = { ...(s.userData || {}) };
      if (s.surface.renderOrder != null) m.renderOrder = s.surface.renderOrder;
      return m;
    });
    return { objects: meshes, meshes, dispose() { for (const m of meshes) m.geometry.dispose(); } };
  }
  function moveForeign(s, t) {   // a moving slot (gulls) carries ANY asset along its paths
    for (const m of s.inst.meshes) {
      for (let i = 0; i < m.count; i++) {
        const q = s.motion(t, i); if (!q) continue;
        _Q.setFromAxisAngle(_Y, q.yaw); _P.set(q.p[0], q.p[1], q.p[2]);
        _S.setScalar(q.hidden ? 0 : itemScale(s, s.asset, s.cur, i));
        m.setMatrixAt(i, _M.compose(_P, _Q, _S));
      }
      m.instanceMatrix.needsUpdate = true;
    }
  }

  // ---------------- binding ----------------
  const parentOf = (s) => (s.parent?.isObject3D ? s.parent : s.parent === "scene" ? scene : world);
  function teardown(s) {
    if (!s.inst) return;
    for (const o of s.inst.objects || []) o.parent?.remove(o);
    try { s.inst.dispose?.(); } catch {}
    lodSets.delete(s.id);
    s.inst = null;
  }
  function itemsNow(s, asset, state = keep) {   // keep-out with the bound asset's shape (a foreign one scaled into the slot's native units)
    if (!s.place || !state) return s.cur || s.items;
    let shape = null;
    if (s.wantsShape && asset.parts) {
      shape = asset.shape ||= (asset.keepShape || shapeOfParts(asset.parts, s.windShare ?? 0.04));
      if (shape && !asset.native) shape = scaleShape(shape, fitOf(s, asset));
    }
    return s.place(state, shape, asset) || s.items;
  }
  function apply(s, asset, given = null) {
    teardown(s);
    s.bound = asset.id; s.asset = asset; s.error = null;
    if (asset.native && !s.native && asset.parts?.length) s.native = { h: asset.h, r: asset.r };   // the units of the slot's exact matrices
    if (asset.none) { s.inst = { objects: [], meshes: [] }; s.cur = s.items; emit(s.id); return; }
    const items = (s.cur = given || itemsNow(s, asset));
    if (asset.build && (asset.native || !asset.parts?.length)) s.inst = asset.build(s, ctx, items) || { objects: [], meshes: [] };
    else if (s.surface?.pos && asset.surfaceMat) s.inst = buildSurface(s, asset);
    else s.inst = buildInstanced(s, asset, items);
    if (asset.update && !s.inst.update) s.inst.update = (cam, ms) => asset.update(cam, ms, s);
    s.inst.meshes ||= [];
    const par = parentOf(s);
    for (const o of s.inst.objects || []) if (!o.parent) par.add(o);
    if (!asset.native) for (const m of s.inst.meshes) { m.userData.slot = s.id; m.userData.asset = asset.id; }
    if (s.visible === false) setVisible(s.id, false);
    if (lodSets.has(s.id) && s.lastEye) lodStep(s, s.lastEye, true);
    if (colourFit) colourFit.dirty = true;
    emit(s.id);
  }
  async function bindNow(s, assetId) {
    const seq = ++s.seq; pending++;
    try {
      const asset = await REG.getAsset(assetId, ctx, pack, s);
      if (seq !== s.seq) return false;
      apply(s, asset);
      return true;
    } catch (e) { s.error = String(e?.message || e).slice(0, 200); throw e; }
    finally { pending--; flush(); }
  }

  /** Register a placement's slots (in build order) and build each with its wanted, else its default asset. */
  async function add(list) {
    for (const s of list) {
      Object.assign(s, { bound: null, inst: null, seq: 0, error: null, asset: null, cur: null });
      slots.set(s.id, s);
      const want = wanted.get(s.id);
      if (want && want !== s.default) { try { await bindNow(s, want); continue; } catch (e) { console.warn(`[slots] ${s.id} <- ${want}:`, e?.message || e); } }
      await bindNow(s, s.default);
    }
  }
  /** keep-out changed (fight radius / fighters / eye rings): every slot with a place() rule lays out again, in order. */
  function place(state) {
    keep = state;
    for (const s of [...slots.values()].sort((a, b) => (a.placeOrder ?? 2) - (b.placeOrder ?? 2))) relay(s, state);
  }
  function relay(s, state) {   // one slot's keep-out again; an unchanged answer (the same items object) rebuilds nothing
    if (!s.asset || s.asset.none || !s.place) return;
    const items = itemsNow(s, s.asset, state);
    if (items === s.cur && s.inst) return;
    if (s.inst?.place) { s.cur = items; s.inst.place(state, items); return; }   // a procedural asset re-lays itself out
    apply(s, s.asset, items);
  }
  function update(camera, ms) {
    const sc = world.scale.x || 1, eye = camera ? { x: camera.position.x / sc, z: camera.position.z / sc } : null;
    for (const s of slots.values()) {
      if (!s.inst) continue;
      s.inst.update?.(camera, ms);
      if (lodSets.has(s.id)) { s.lastEye = eye; lodStep(s, eye, false); }
      if (s.motion && s.inst.instanced && !s.asset.native) moveForeign(s, ms / 1000);
    }
    const tk = REG.toolkit();
    if (tk) { tk.light?.dir?.copy?.(env.S.U.uSunDir.value); tk.tickUniforms?.(camera, ms / 1000); }
  }

  async function bind(id, assetId) {
    const s = slots.get(id); if (!s) throw new Error("no slot " + id);
    if (!assetId || assetId === "default") return reset(id);
    await bindNow(s, assetId);
    view.choices[id] = assetId; wanted.set(id, assetId); onChange(api.choices());
    return true;
  }
  async function reset(id, { remember = true } = {}) {
    const s = slots.get(id); if (!s) return false;
    wanted.delete(id);
    if (remember) view.choices[id] = "default";
    onChange(api.choices());
    if (s.bound !== s.default) await bindNow(s, s.default);
    return true;
  }
  async function resetAll() {
    view.choices = {}; wanted.clear();
    onChange(api.choices());
    for (const s of slots.values()) if (s.bound !== s.default) await bindNow(s, s.default);
  }
  function setVisible(id, v) { const s = slots.get(id); if (!s) return; s.visible = !!v; for (const o of s.inst?.objects || []) o.visible = !!v; for (const m of s.inst?.meshes || []) m.visible = !!v; }

  const api = {
    env: ctx, pack, slots,
    add, place, update, bind, reset, resetAll, setVisible,
    /** one slot's keep-out with this state (a placement's own "place again" button) */
    replace: (id, state) => { const s = slots.get(id); if (s && state) relay(s, state); },
    /** build one slot again with what is bound (a slot that derives from other slots: the lake's mirrored copies) */
    rebuild: (id) => { const s = slots.get(id); if (s?.asset) apply(s, s.asset, s.cur); },
    list: () => [...slots.values()].map((s) => ({ id: s.id, label: s.label, kind: s.kind, surface: !!s.surface, count: (s.cur || s.items)?.n ?? 0,
                                                  bound: s.bound === s.default ? null : s.bound, default: s.default, wanted: wanted.get(s.id) || null, layer: s.layer, error: s.error })),
    get: (id) => slots.get(id),
    meshesOf: (id) => slots.get(id)?.inst?.meshes || [],
    instanceOf: (id) => slots.get(id)?.inst || null,
    /** "change" listener: f(slotId) after every (re)build of a slot */
    on: (f) => { listeners.add(f); return () => listeners.delete(f); },
    choices: () => ({ ...view.choices }),
    idle: () => (pending === 0 ? Promise.resolve() : new Promise((r) => waiters.push(r))),
    pending: () => pending,
    /** the placement DATA of every slot (no asset anywhere in it) */
    exportPlacements() {
      const out = { arena: pack, units: "render units (400 = 1 m)", slots: {} };
      for (const s of slots.values()) {
        const it = s.cur || s.items || { n: 0 }, pl = [];
        for (let i = 0; i < Math.min(it.n, MAXN); i++) pl.push([+it.p[i * 3].toFixed(1), +it.p[i * 3 + 1].toFixed(1), +it.p[i * 3 + 2].toFixed(1), +it.yaw[i].toFixed(3), +it.h[i].toFixed(1), +it.rad[i].toFixed(1)]);
        out.slots[s.id] = { label: s.label, kind: s.kind, surface: !!s.surface, default: s.default, count: it.n, placements: pl };
      }
      return out;
    },
    placements: (id) => { const s = slots.get(id); return s ? s.cur || s.items : null; },
  };
  return api;
}
