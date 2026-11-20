// Biome gallery page logic: tabs (Forest / Beach / Lake / Mountain / Shared) x modes (Grid / Biome). Standalone.
import * as THREE from "three";
import { OrbitControls } from "../lib3d/addons/OrbitControls.js";
import { U, light, tickUniforms, skyDome, toonMat, GpuTimer, objStats } from "./toolkit.js";
import { loadStats } from "./loader.js";
import * as Forest from "./forest.js";
import * as Beach from "./beach.js";
import * as Lake from "./lake.js";
import * as Mountain from "./mountain.js";
import * as Shared from "./sharedtab.js";
import * as Anime from "./anime.js";
import * as Objects from "./objects.js";
import { frameSphere } from "./detailframe.js";

const W = 960, H = 720;
const TABS = {
  forest: { label: "Forest", entries: [...Forest.entries, ...Anime.entries("forest")], build: Forest.buildForest, fog: { color: 0xc3dccf, density: 0.0105 }, sky: { zenith: 0x4c7fd0, mid: 0x86b6e6, horizon: 0xc3dccf }, view: [13, 2.2] },
  beach: { label: "Beach", entries: [...Beach.entries, ...Anime.entries("beach")], build: Beach.buildBeach, fog: { color: 0xd3e8f0, density: 0.0042 }, sky: { zenith: 0x2f7bd8, mid: 0x78bff0, horizon: 0xe4f3fa }, view: [16, 2.4] },
  lake: { label: "Lake", entries: [...Lake.entries, ...Anime.entries("lake")], build: Lake.buildLake, fog: { color: 0xcfe3e6, density: 0.0048 }, sky: { zenith: 0x3f7fd0, mid: 0x8fc4ea, horizon: 0xdcecf2 }, view: [20, 2.2] },
  mountain: { label: "Mountain", entries: [...Mountain.entries, ...Anime.entries("mountain")], build: Mountain.buildMountain, fog: { color: 0xc9dcec, density: 0.0034 }, sky: { zenith: 0x2a68c4, mid: 0x7fb6ec, horizon: 0xc9dcec }, view: [24, 2.4] },
  shared: { label: "Shared", entries: [...Shared.entries, ...Anime.entries("shared")], build: Shared.buildShared, fog: { color: 0xd6e8f5, density: 0.0055 }, sky: { zenith: 0x4f86e8, mid: 0x8dc2ff, horizon: 0xd6e8f5 }, view: [16, 2.5] },
  objects: { label: "Objects", entries: Objects.entries, build: null, fog: { color: 0xd6e8f5, density: 0.0055 }, sky: { zenith: 0x4f86e8, mid: 0x8dc2ff, horizon: 0xd6e8f5 }, view: [16, 2.5] },   // own TripoSR objects (grid only)
};
const $ = (id) => document.getElementById(id);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
renderer.setPixelRatio(1); renderer.setSize(W, H); $("view").appendChild(renderer.domElement);
const timer = new GpuTimer(renderer);
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
camera.position.set(0, 4, 13);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.8, 0); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.495; controls.update();

const state = { tab: "forest", mode: "grid", page: 0, cat: "All", PAGE: 12, busy: false, spin: true, anime: false };   // anime = "Use anime set" (Biome mode, default OFF)
let animeInfo = null;
let scene = new THREE.Scene(), biome = null, gridItems = [], frameNo = 0, gridFloor = null;
const made = new Map();     // entry id -> { obj, stats, error }
const buildStats = {};      // "tab/mode" -> {ms, ...}
const log = (...a) => { $("log").textContent = a.join(" "); };
const stoneMat = toonMat({ color: 0x8c9199 }, { shadeK: 0.7, rim: 0.1 });
const padGeo = new THREE.CylinderGeometry(1.5, 1.65, 0.28, 44);

// ------------------------------------------------------------------ entries
async function realise(e) {
  if (made.has(e.id)) return made.get(e.id);
  let rec;
  try {
    const obj = await e.make();
    obj.updateMatrixWorld(true);
    const st = objStats(obj), box = new THREE.Box3().setFromObject(obj);
    rec = { obj, stats: st, size: box.getSize(new THREE.Vector3()), box };
  } catch (err) { rec = { obj: null, error: String(err && err.message || err), stats: { tris: 0, draws: 0 } }; }
  made.set(e.id, rec); return rec;
}

// ------------------------------------------------------------------ grid
function clearScene() { scene.traverse((o) => { if (o.parent && o.userData.tmp) o.parent.remove(o); }); }
function baseScene(tabKey, fog) {
  const t = TABS[tabKey], sc = new THREE.Scene();
  const sky = skyDome({ zenith: t.sky.zenith, mid: t.sky.mid, horizon: t.sky.horizon, clouds: fog });   // clouds only in biome mode
  sc.add(sky); sc.userData.sky = sky;
  return sc;
}
async function showGrid() {
  state.busy = true;
  const t = TABS[state.tab], list = t.entries.filter((e) => state.cat === "All" || e.cat === state.cat);
  const pages = Math.max(1, Math.ceil(list.length / state.PAGE)); state.page = Math.min(state.page, pages - 1);
  const slice = list.slice(state.page * state.PAGE, state.page * state.PAGE + state.PAGE);
  scene = baseScene(state.tab, false); scene.fog = null;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), toonMat({ color: 0x5d7a4a }, { shadeK: 0.8, rim: 0 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; scene.add(floor); gridFloor = floor;
  gridItems = []; $("labels").innerHTML = "";
  const cols = 4, sp = 4.6;
  for (let i = 0; i < slice.length; i++) {
    const e = slice[i], rec = await realise(e), c = i % cols, r = Math.floor(i / cols);
    const cell = new THREE.Group(); cell.position.set((c - (cols - 1) / 2) * sp, 0, (r - 1) * sp * 0.95);
    const pad = new THREE.Mesh(padGeo, stoneMat); pad.position.y = 0.14; cell.add(pad);
    const spin = new THREE.Group(); spin.position.y = 0.28; cell.add(spin);
    if (rec.obj) {
      const b = rec.box, s = Math.min(2.5 / Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 1e-3), 3.0 / Math.max(b.max.y - b.min.y, 1e-3), 40);
      const holder = new THREE.Group(); holder.scale.setScalar(s); holder.position.set(-(b.max.x + b.min.x) / 2 * s, 0, -(b.max.z + b.min.z) / 2 * s);
      holder.add(rec.obj); spin.add(holder);
    } else { const bad = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff2020 })); bad.position.y = 0.5; spin.add(bad); }
    scene.add(cell);
    const lab = document.createElement("div"); lab.className = "lab";
    const sz = rec.size ? `${rec.size.x.toFixed(2)}x${rec.size.y.toFixed(2)}x${rec.size.z.toFixed(2)} m` : "";
    lab.innerHTML = `<b>${e.name}</b><br>${e.source}<br>${e.licence} &middot; ${rec.stats.tris} tris &middot; ${rec.stats.draws} draw${rec.stats.draws === 1 ? "" : "s"}<br>${sz}${rec.error ? "<br><span class=err>" + rec.error + "</span>" : ""}`;
    $("labels").appendChild(lab);
    gridItems.push({ e, cell, spin, lab, pad, rec, noSpin: !!e.noSpin });
  }
  controls.target.set(0, 1.2, 0); camera.position.set(0, 9.5, 17.5); controls.update();
  biome = null; state.busy = false;
  $("pageinfo").textContent = `${state.page + 1}/${pages}  (${list.length} assets)`;
}

// ------------------------------------------------------------------ biome
async function showBiome() {
  state.busy = true;
  const t = TABS[state.tab];
  scene = baseScene(state.tab, true);
  scene.fog = new THREE.FogExp2(t.fog.color, t.fog.density);
  const t0 = performance.now();
  biome = await t.build({ renderer, scene, camera });
  animeInfo = state.anime ? await Anime.apply(state.tab, { renderer, scene, camera }, biome) : null;
  scene.add(biome.root);
  buildStats[state.tab + "/biome" + (state.anime ? "+anime" : "")] = { buildMs: Math.round(performance.now() - t0), species: biome.info.species.length, anime: animeInfo ? { hidden: animeInfo.hidden.length, added: animeInfo.added, species: animeInfo.species } : null };
  gridItems = []; $("labels").innerHTML = "";
  const [dist, h] = t.view; camera.position.set(0, h + 2.2, dist); controls.target.set(0, h * 0.7, 0); camera.far = 400; camera.updateProjectionMatrix(); controls.update();
  frameNo = 0; state.busy = false;
  $("pageinfo").textContent = `${biome.info.species.length} species`;
}

// ------------------------------------------------------------------ UI
function buildCats() {
  const sel = $("cat"), t = TABS[state.tab], cats = ["All", ...new Set(t.entries.map((e) => e.cat))];
  sel.innerHTML = cats.map((c) => `<option>${c}</option>`).join(""); sel.value = state.cat;
}
export async function setView(tab, mode) {
  exitDetail();
  if (tab) { if (tab !== state.tab) { state.cat = "All"; state.page = 0; } state.tab = tab; }
  if (mode) state.mode = mode;
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.mode));
  const t = TABS[state.tab];
  if (!t.build) state.mode = "grid";   // tabs without a biome (Objects)
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === state.mode));
  buildCats();
  $("grid-ui").style.display = state.mode === "grid" ? "" : "none";
  $("anime-ui").style.display = state.mode === "biome" ? "" : "none"; $("anime").checked = state.anime;
  if (!t.entries.length) { scene = baseScene(state.tab in TABS && t.sky ? state.tab : "forest", false); $("labels").innerHTML = ""; gridItems = []; biome = null; $("pageinfo").textContent = t.note; log(t.label + ": " + t.note); return; }
  log("building " + state.tab + " / " + state.mode + " ...");
  const t0 = performance.now();
  if (state.mode === "grid") await showGrid(); else await showBiome();
  log(`${state.tab}/${state.mode} built in ${Math.round(performance.now() - t0)} ms`);
}
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.tab, null)));
document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setView(null, b.dataset.mode)));
$("anime").addEventListener("change", (ev) => { state.anime = ev.target.checked; setView(); });
$("cat").addEventListener("change", (ev) => { state.cat = ev.target.value; state.page = 0; setView(); });
$("prev").addEventListener("click", () => { state.page = Math.max(0, state.page - 1); setView(); });
$("next").addEventListener("click", () => { state.page++; setView(); });

// ------------------------------------------------------------------ detail view: one grid object alone, close up
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), box3 = new THREE.Box3(), corner = new THREE.Vector3();
function pickGrid(clientX, clientY) {
  const r = renderer.domElement.getBoundingClientRect(), px = clientX - r.left, py = clientY - r.top;
  ndc.set((px / r.width) * 2 - 1, -(py / r.height) * 2 + 1); camera.updateMatrixWorld();
  try {
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(gridItems.map((g) => g.cell), true)[0];
    if (hit) { for (let o = hit.object; o; o = o.parent) { const g = gridItems.find((x) => x.cell === o); if (g) return g; } }
  } catch (err) { /* sprites / odd objects: fall through to the screen-box test */ }
  let best = null, bd = 1e9;   // fallback: click inside the projected box of an object (thin things such as grass)
  for (const g of gridItems) {
    box3.setFromObject(g.spin); if (box3.isEmpty()) continue;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, behind = false;
    for (let i = 0; i < 8; i++) { corner.set(i & 1 ? box3.max.x : box3.min.x, i & 2 ? box3.max.y : box3.min.y, i & 4 ? box3.max.z : box3.min.z).project(camera); if (corner.z > 1) behind = true; x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x); y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y); }
    if (!behind && ndc.x >= x0 && ndc.x <= x1 && ndc.y >= y0 && ndc.y <= y1) { const d = camera.position.distanceTo(g.cell.position); if (d < bd) { bd = d; best = g; } }
  }
  return best;
}
function detailText(g) {
  const e = g.e, rec = g.rec, esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const sz = rec.size ? `${rec.size.x.toFixed(2)} x ${rec.size.y.toFixed(2)} x ${rec.size.z.toFixed(2)} m` : "";
  const L = [`<b>${esc(e.name)}</b>`, `Map / group: ${esc(e.cat)} &middot; tab ${esc(TABS[state.tab].label)}`, `Source: ${esc(e.source)} &middot; ${esc(e.licence)}`,
    `${rec.stats.tris} tris &middot; ${rec.stats.draws} draw${rec.stats.draws === 1 ? "" : "s"}${sz ? " &middot; " + sz : ""}`];
  if (e.paint) L.push(`Paint: front ${e.paint.front}% / back ${e.paint.back}% / side ${e.paint.vertex}% &middot; camera IoU ${e.paint.iou} &middot; side faces left raw ${e.paint.left_raw}`);
  if (e.flags) L.push(e.flags.length ? `<span class=flag>FLAGS: ${e.flags.map(esc).join("; ")}</span>` : `<span class=ok>FLAGS: none</span>`);
  if (rec.error) L.push(`<span class=err>${esc(rec.error)}</span>`);
  return L.join("<br>");
}
function enterDetail(g) {
  if (state.detail || state.busy || !g) return;
  box3.setFromObject(g.spin); if (box3.isEmpty()) return;
  const sph = box3.getBoundingSphere(new THREE.Sphere()), rad = Math.max(sph.radius, 1e-3);
  state.detail = { item: g, saved: { pos: camera.position.clone(), target: controls.target.clone(), minD: controls.minDistance, maxD: controls.maxDistance, maxP: controls.maxPolarAngle, near: camera.near } };
  for (const o of gridItems) { o.cell.visible = o === g; }
  g.pad.visible = false; if (gridFloor) gridFloor.visible = false; $("labels").style.display = "none";
  const fr = frameSphere([sph.center.x, sph.center.y, sph.center.z], rad, camera.fov, camera.aspect);   // whole bounding sphere fits, centred
  camera.near = fr.near; camera.updateProjectionMatrix();
  controls.minDistance = fr.minDistance; controls.maxDistance = fr.maxDistance; controls.maxPolarAngle = Math.PI;
  controls.target.copy(sph.center); camera.position.set(...fr.position); controls.update();
  $("detail-text").innerHTML = detailText(g); $("detail").style.display = "block";
  log("detail: " + g.e.name);
}
function exitDetail() {
  const d = state.detail; if (!d) return; state.detail = null;
  const s = d.saved; for (const o of gridItems) o.cell.visible = true;
  d.item.pad.visible = true; if (gridFloor) gridFloor.visible = true; $("labels").style.display = "";
  camera.near = s.near; camera.updateProjectionMatrix(); controls.minDistance = s.minD; controls.maxDistance = s.maxD; controls.maxPolarAngle = s.maxP;
  camera.position.copy(s.pos); controls.target.copy(s.target); controls.update();
  $("detail").style.display = "none"; log("back to the grid, page " + (state.page + 1));
}
let down = null;
renderer.domElement.addEventListener("pointerdown", (ev) => { down = ev.button === 0 ? { x: ev.clientX, y: ev.clientY, t: performance.now() } : null; });
renderer.domElement.addEventListener("pointerup", (ev) => {
  const d = down; down = null;
  if (!d || ev.button !== 0 || state.detail || state.mode !== "grid") return;
  if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 5 || performance.now() - d.t > 500) return;   // a drag (orbit) is not a click
  enterDetail(pickGrid(ev.clientX, ev.clientY));
});
$("back").addEventListener("click", exitDetail);
window.addEventListener("keydown", (ev) => { if (ev.key === "Escape") exitDetail(); });

// ------------------------------------------------------------------ loop
const tmpV = new THREE.Vector3();
let lastT = performance.now(), hudAcc = 0, finishMode = false, finishMs = [];
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  controls.update();
  tickUniforms(camera, now / 1000);
  if (!state.detail) for (const g of gridItems) if (!g.noSpin && state.spin) g.spin.rotation.y += dt * 0.6;
  if (biome) biome.update(camera, frameNo);
  frameNo++;
  const gl = renderer.getContext();
  timer.begin();
  const f0 = performance.now();
  renderer.render(scene, camera);
  if (finishMode) { gl.finish(); finishMs.push(performance.now() - f0); }
  timer.end();
  // labels follow their pedestals
  for (const g of gridItems) {
    tmpV.set(g.cell.position.x, 0, g.cell.position.z + 1.9).project(camera);
    g.lab.style.left = ((tmpV.x * 0.5 + 0.5) * W - 105) + "px"; g.lab.style.top = ((-tmpV.y * 0.5 + 0.5) * H) + "px";
  }
  hudAcc += dt; if (hudAcc > 0.5) { hudAcc = 0; hud(); }
}
function hud() {
  const i = renderer.info.render, gms = timer.gpuMs(), cms = timer.cpuMs();
  $("stats").textContent = `GPU ${gms == null ? (timer.supported ? "..." : "n/a") : gms.toFixed(2)} ms | CPU submit ${cms == null ? "-" : cms.toFixed(2)} ms | draws ${i.calls} | tris ${i.triangles}`;
}

// ------------------------------------------------------------------ test API (tools/verify_biome_gallery.mjs)
const VIEWS = [
  (t) => { camera.position.set(0, t.view[1] + 2.2, t.view[0]); controls.target.set(0, t.view[1] * 0.7, 0); },
  (t) => { camera.position.set(9, 1.5, -8); controls.target.set(-6, 3.5, 12); },
  (t) => { camera.position.set(-24, 26, 24); controls.target.set(0, 0, 0); },
];
window.__gallery = {
  state, TABS, loadStats, buildStats,
  setView,
  /** detail view test API: open grid item i (index on the page), close, and read what is shown */
  openDetail(i) { enterDetail(gridItems[i]); return !!state.detail; },
  closeDetail: exitDetail,
  detailInfo() { const d = state.detail; if (!d) return null; return { name: d.item.e.name, text: $("detail-text").textContent, camDist: camera.position.distanceTo(controls.target), visibleCells: gridItems.filter((g) => g.cell.visible).length, floorVisible: gridFloor ? gridFloor.visible : null, page: state.page }; },
  pickAt: (x, y) => { const g = pickGrid(x, y); return g ? gridItems.indexOf(g) : -1; },
  /** "Use anime set" toggle (Biome mode); rebuilds the biome */
  async setAnime(on) { state.anime = !!on; await setView(); },
  animeInfo: () => animeInfo,
  /** realise every entry of a tab: counts + per-asset stats */
  async loadAll(tab) {
    const out = { tab, total: 0, ok: 0, failed: [], assets: [] };
    for (const e of TABS[tab].entries) {
      const rec = await realise(e); out.total++;
      if (rec.obj && rec.stats.tris > 0) out.ok++; else out.failed.push({ id: e.id, error: rec.error || "no triangles" });
      out.assets.push({ id: e.id, cat: e.cat, name: e.name, source: e.source, licence: e.licence, tris: rec.stats.tris, draws: rec.stats.draws });
    }
    return out;
  },
  setCamera(i) { const t = TABS[state.tab]; if (t.view) { VIEWS[i](t); controls.update(); camera.updateMatrixWorld(); if (biome) biome.update(camera, 0); } },
  /** average ms over `frames` rendered frames: GPU timer when present, and render+gl.finish() wall time (always) */
  async measure(frames = 120, warm = 30) {
    for (let i = 0; i < warm; i++) await new Promise((r) => requestAnimationFrame(r));
    timer.reset(); finishMs = []; finishMode = true;
    for (let i = 0; i < frames; i++) await new Promise((r) => requestAnimationFrame(r));
    finishMode = false;
    const s = [...finishMs].sort((a, b) => a - b), mean = s.reduce((a, b) => a + b, 0) / Math.max(1, s.length);
    const info = renderer.info.render;
    return { finishMeanMs: +mean.toFixed(3), finishP50Ms: +(s[Math.floor(s.length / 2)] || 0).toFixed(3), finishP95Ms: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(3),
      gpuMs: timer.gpuMs() == null ? null : +timer.gpuMs().toFixed(3), gpuTimerSupported: timer.supported, cpuSubmitMs: +(timer.cpuMs() || 0).toFixed(3), draws: info.calls, tris: info.triangles, frames: finishMs.length };
  },
  rendererInfo() { const gl = renderer.getContext(), d = gl.getExtension("WEBGL_debug_renderer_info"); return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : "?", size: [renderer.domElement.width, renderer.domElement.height], textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, programs: renderer.info.programs.length }; },
  /** render once and read the canvas back: coarse colour statistics (numbers only) */
  sample() {
    renderer.render(scene, camera);
    const gl = renderer.getContext(), w = renderer.domElement.width, h = renderer.domElement.height, px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const band = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], cnt = [0, 0, 0]; let ls = 0, ls2 = 0, n = 0, dark = 0;
    for (let y = 0; y < h; y += 6) for (let x = 0; x < w; x += 6) {
      const i = (y * w + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2], b3 = Math.min(2, Math.floor((h - 1 - y) / h * 3)), L = 0.299 * r + 0.587 * g + 0.114 * b;
      band[b3][0] += r; band[b3][1] += g; band[b3][2] += b; cnt[b3]++; ls += L; ls2 += L * L; n++; if (L < 8) dark++;
    }
    const m = ls / n;
    return { meanLuma: +m.toFixed(1), stdLuma: +Math.sqrt(ls2 / n - m * m).toFixed(1), nearBlack: +(dark / n).toFixed(3),
      topRGB: band[0].slice(0, 3).map((v) => Math.round(v / cnt[0])), midRGB: band[1].slice(0, 3).map((v) => Math.round(v / cnt[1])), bottomRGB: band[2].slice(0, 3).map((v) => Math.round(v / cnt[2])) };
  },
  biomeInfo() { return biome ? { species: biome.info.species, impostors: biome.info.impostors, lod: biome.lodCounts ? biome.lodCounts() : null } : null; },
  stats: () => ({ ...renderer.info.render }),
  renderer, getBiome: () => biome,
  ready: null,
};
const q0 = new URLSearchParams(location.search);
window.__gallery.ready = setView(q0.get("tab") || "forest", q0.get("mode") || "grid");
requestAnimationFrame(frame);
window.addEventListener("error", (e) => log("ERROR " + e.message));
