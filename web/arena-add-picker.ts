// Arena Viewer PLACER, "Add object...": a popup with a card for EVERY registry asset (web/built/registry.js listAllAssets: built pieces,
// the biome gallery sets, "Objects (own)" ...). Each card has a still preview, made lazily when the card scrolls into view by
// ONE small offscreen three.js renderer (cached in memory by asset id), plus name, source, kind. Search + kind/source filters (same
// look as web/arena-slots-ui.js). A click calls onPick(assetId). Not placeable assets (water, sky ...) show "no preview" and onPick reports the error.
import * as THREE from "./lib3d/three.module.js";
import { getAsset, dropCache, listAllAssets } from "./built/registry.js";
import { pickerEntries } from "./placer-format.js";

const SIZE = 128;
const CSS = `
#addGal{position:fixed;inset:4% 6%;background:#10151c;border:1px solid #456;border-radius:6px;z-index:60;display:none;flex-direction:column;font:12px system-ui,sans-serif;color:#cde}
#addGal header{display:flex;gap:8px;align-items:center;padding:8px;border-bottom:1px solid #345}
#addGal header input,#addGal header select{background:#1b232d;color:#cde;border:1px solid #456;padding:3px 5px}
#addGal .grid{overflow:auto;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;align-content:start}
#addGal .card{border:1px solid #345;border-radius:4px;padding:6px;cursor:pointer;background:#161d26;min-height:190px}
#addGal .card:hover{border-color:#8bd;background:#1c2733}
#addGal .card b{display:block;color:#eef;margin:2px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#addGal .card i{display:block;color:#89a;font-style:normal;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#addGal .card .pv{width:100%;height:128px;display:flex;align-items:center;justify-content:center;background:#0c1016;color:#567;margin-bottom:4px}
#addGal .card .pv img{width:128px;height:128px}
`;

/** A group that draws a normalised registry asset (parts: geometry + instanced material) once, base at the group origin, height <= 1.
 *  Each part is a one-instance InstancedMesh (the asset materials are made to draw instanced). userData.placed = tag on all of it. */
export function buildAssetGroup(asset, name = "asset", tag = null) {
  const parts = asset.variants?.[0] || asset.parts;
  if (!parts?.length) throw new Error(`${asset.id}: no mesh parts (a procedural / surface asset, cannot stand as an object)`);
  const g = new THREE.Group(); g.name = name;
  const id = new THREE.Matrix4();
  parts.forEach((part, i) => {
    let geo = part.geo;
    if (part.attrs) {   // constant per-instance attributes some module shaders need
      geo = geo.clone();
      for (const [nm, [size, fill]] of Object.entries(part.attrs)) {
        if (geo.attributes[nm]) continue;
        const arr = new Float32Array(size);
        for (let c = 0; c < size; c++) arr[c] = Array.isArray(fill) ? fill[c] : fill;
        geo.setAttribute(nm, new THREE.InstancedBufferAttribute(arr, size));
      }
    }
    const m = new THREE.InstancedMesh(geo, part.mat, 1);
    m.setMatrixAt(0, id); m.name = `${name}_${i}`;
    if (part.renderOrder != null) m.renderOrder = part.renderOrder;
    m.frustumCulled = false;
    m.userData = { ...(part.userData || {}), placed: tag };
    g.add(m);
  });
  g.userData = { placed: tag, assetGroup: true, assetId: asset.id };
  return g;
}

export function createAddPicker({ getBuilt, onPick }) {
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  const gal = document.createElement("div"); gal.id = "addGal";
  gal.innerHTML = `<header><b>Add object</b><input id="addSearch" placeholder="search name / source / kind" size="28">
    <select id="addKind"><option value="">all kinds</option></select><select id="addSrc"><option value="">all sources</option></select>
    <span id="addCount"></span><span id="addMsg" style="color:#e88"></span><span style="flex:1"></span><button id="addClose">close</button></header><div class="grid" id="addGrid">loading ...</div>`;
  document.body.appendChild(gal);
  const $ = (id) => gal.querySelector("#" + id);
  let entries = null, io = null;
  const cache = new Map();      // asset id -> dataURL | "fail"
  const queue = [];             // card elements waiting for a preview (one at a time)
  let busy = false, rend = null, scene = null, cam = null;

  function setup() {
    if (rend) return;
    rend = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    rend.setSize(SIZE, SIZE, false); rend.setPixelRatio(1);
    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.4));
    const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 3, 2); scene.add(d);
    cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  }
  async function previewOf(id) {
    if (cache.has(id)) return cache.get(id);
    const b = getBuilt();
    setup();
    let url = "fail", asset = null;
    const pk = "preview:" + (b?.info?.pack || "");
    try {
      asset = await getAsset(id, b.slots.env, pk, null);
      const g = buildAssetGroup(asset, "preview");
      scene.add(g);
      const h = asset.h || 1, r = asset.r || 1, dist = Math.max(h, r * 2) * 2.6;
      cam.position.set(dist * 0.62, h * 0.5 + dist * 0.32, dist * 0.78); cam.lookAt(0, h * 0.45, 0);
      rend.render(scene, cam);
      url = rend.domElement.toDataURL("image/png");
      scene.remove(g);
    } catch (e) { console.warn("[add-picker] preview", id, e?.message || e); }
    try { asset?.dispose?.(); for (const p of asset?.parts || []) p.mat?.dispose?.(); } catch {}
    dropCache(pk);
    cache.set(id, url);
    return url;
  }
  async function pump() {
    if (busy) return; busy = true;
    while (queue.length) {
      const c = queue.shift();
      if (!c.isConnected) continue;
      const url = await previewOf(c.dataset.asset), pv = c.querySelector(".pv");
      if (url === "fail") pv.textContent = "no preview";
      else { pv.textContent = ""; const im = new Image(); im.src = url; pv.appendChild(im); }
    }
    busy = false;
  }
  function lazy(card) {
    io ||= new IntersectionObserver((ents) => {
      for (const e of ents) if (e.isIntersecting) { io.unobserve(e.target); queue.push(e.target); }
      pump();
    }, { root: $("addGrid"), rootMargin: "200px" });
    io.observe(card);
  }
  function draw() {
    const q = $("addSearch").value.toLowerCase().trim(), kind = $("addKind").value, src = $("addSrc").value;
    const hit = entries.filter((a) => (!kind || a.kinds.includes(kind)) && (!src || a.source === src)
      && (!q || `${a.name} ${a.source} ${a.licence} ${a.kinds.join(" ")} ${a.id}`.toLowerCase().includes(q)));
    $("addCount").textContent = `${hit.length} of ${entries.length}`;
    const g = $("addGrid"); g.innerHTML = ""; queue.length = 0;
    for (const a of hit.slice(0, 400)) {
      const c = document.createElement("div"); c.className = "card"; c.dataset.asset = a.id;
      c.innerHTML = `<div class="pv">...</div><b></b><i></i><i></i>`;
      c.children[1].textContent = a.name; c.children[1].title = a.id; c.children[2].textContent = `${a.source}, ${a.licence}`; c.children[3].textContent = a.kinds.join(", ");
      const done = cache.get(a.id);
      if (done && done !== "fail") { c.querySelector(".pv").textContent = ""; const im = new Image(); im.src = done; c.querySelector(".pv").appendChild(im); }
      else if (done === "fail") c.querySelector(".pv").textContent = "no preview";
      else lazy(c);
      c.onclick = async () => { $("addMsg").textContent = ""; try { const ok = await onPick(a.id); if (ok !== false) close(); } catch (e) { $("addMsg").textContent = String(e?.message || e); } };
      g.appendChild(c);
    }
    if (hit.length > 400) { const m = document.createElement("div"); m.textContent = `... ${hit.length - 400} more: narrow the search`; g.appendChild(m); }
  }
  async function open() {
    gal.style.display = "flex"; $("addMsg").textContent = "";
    if (!entries) {
      $("addGrid").textContent = "loading assets ...";
      entries = pickerEntries(await listAllAssets());
      for (const k of [...new Set(entries.flatMap((a) => a.kinds))].sort()) $("addKind").add(new Option(k, k));
      for (const s of [...new Set(entries.map((a) => a.source))].sort()) $("addSrc").add(new Option(s, s));
    }
    draw();
  }
  function close() { gal.style.display = "none"; queue.length = 0; }
  for (const id of ["addSearch", "addKind", "addSrc"]) $(id).oninput = () => entries && draw();
  $("addClose").onclick = close;
  const onEsc = (e) => { if (e.key === "Escape" && gal.style.display !== "none") close(); };
  addEventListener("keydown", onEsc);
  return { open, close, previewOf, get isOpen() { return gal.style.display !== "none"; }, get entries() { return entries; },
    destroy() { close(); removeEventListener("keydown", onEsc); gal.remove(); st.remove(); rend?.dispose(); } };
}
