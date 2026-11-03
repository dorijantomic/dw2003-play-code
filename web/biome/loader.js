// GLB loading for the biome gallery: GLB -> flat parts [{geo, mat}] with one TOON material per source material.
import * as THREE from "three";
import { GLTFLoader } from "./vendor/GLTFLoader.js";
import { mergeGeometries } from "./vendor/BufferGeometryUtils.js";
import { toonify, normaliseGeo, tris, GRADE_PHOTO } from "./toolkit.js";

const loader = new GLTFLoader();
const cache = new Map();
export const loadStats = { requested: 0, loaded: 0, failed: [] };

/** Load a GLB once; returns {parts:[{geo, src(material)}], box:Box3, size:Vector3}. Geometry is baked to world of the scene root. */
export function loadRaw(url, color = false) {   // color = keep COLOR_0 (opt-in, own objects only); the cache is per url
  if (cache.has(url)) return cache.get(url);
  loadStats.requested++;
  const p = new Promise((res, rej) => {
    const fail = (e) => { loadStats.failed.push(url); rej(new Error("load " + url + " " + (e && e.message || e))); };
    // plain fetch + parse (GLTFLoader's own FileLoader stream reads show as ERR_ABORTED in Chromium request logs)
    fetch(url).then((r) => { if (!r.ok) throw new Error("http " + r.status); return r.arrayBuffer(); }).then((buf) => loader.parse(buf, url.slice(0, url.lastIndexOf("/") + 1), (g) => {
      g.scene.updateMatrixWorld(true);
      const by = new Map();
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const geo = normaliseGeo(o.geometry.clone(), color); geo.applyMatrix4(o.matrixWorld);
        const key = o.material.uuid; if (!by.has(key)) by.set(key, { src: o.material, geos: [] }); by.get(key).geos.push(geo);
      });
      const parts = [];   // geometries that cannot be merged (mixed attributes / indexed vs not) stay separate parts of the same material
      for (const b of by.values()) { const m = b.geos.length > 1 ? mergeGeometries(b.geos) : b.geos[0]; if (m) parts.push({ geo: m, src: b.src }); else for (const g of b.geos) parts.push({ geo: g, src: b.src }); }
      const box = new THREE.Box3(); for (const p of parts) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
      loadStats.loaded++; res({ parts, box, size: box.getSize(new THREE.Vector3()), url });
    }, fail)).catch(fail);
  });
  cache.set(url, p); return p;
}

/**
 * Toon parts from a loaded GLB. o: { wind (0..1), flutter, fade, grade (true=photo grade), scale (uniform pre-scale), tint, trans, ground (sit on y=0) }
 * Foliage / MASK materials get alpha-to-coverage + double side.
 */
export async function loadToon(url, o = {}) {
  const raw = await loadRaw(url, !!o.vertexColors);
  const k = o.h ? o.h / raw.size.y : (o.scale || 1), h = raw.size.y * k;
  const lift = o.ground === false ? 0 : -raw.box.min.y * k;
  const parts = raw.parts.map((p) => {
    const geo = p.geo.clone(); geo.scale(k, k, k); geo.translate(0, lift, 0); geo.computeBoundingSphere();
    const s = p.src, mask = s.alphaTest > 0 || s.transparent;
    const m = new THREE.MeshLambertMaterial({ map: s.map || null, color: s.map ? 0xffffff : s.color, side: mask || o.double ? THREE.DoubleSide : THREE.FrontSide,
      alphaTest: mask ? 0.5 : 0, vertexColors: !!(o.vertexColors && p.geo.attributes.color) });
    if (mask) m.alphaToCoverage = true;
    if (s.map) { s.map.anisotropy = 4; }
    toonify(m, { wind: o.wind || 0, height: h, flutter: mask ? (o.flutter || 0) : 0, fade: o.fade || null, grade: o.grade ? (o.grade === true ? GRADE_PHOTO : o.grade) : null, tint: o.tint || null, trans: mask ? (o.trans || 0) : 0, shadeK: o.shadeK ?? 0.72, rim: o.rim ?? 0.28 });
    return { geo, mat: m };
  });
  return { parts, height: h, size: raw.size.clone().multiplyScalar(k), tris: parts.reduce((a, p) => a + tris(p.geo), 0), draws: parts.length, url };
}

export function partsGroup(parts) {
  const g = new THREE.Group();
  for (const p of parts) g.add(new THREE.Mesh(p.geo, p.mat));
  return g;
}
export const texLoader = new THREE.TextureLoader();
export function loadTex(url, srgb = true, anis = 8) {
  return new Promise((res, rej) => texLoader.load(url, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = anis; res(t); }, undefined, () => { loadStats.failed.push(url); rej(new Error(url)); }));
}
