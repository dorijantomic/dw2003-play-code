// Arena Viewer PLACER (look=built): place anything anywhere in a built arena and save it.
//  - the saved placements of the arena (web/built/placements/<pack>.json, or this browser's unsaved draft) are applied
//    whenever a built arena loads, and again after the world re-plants itself (keep-out rebuild). No file and no
//    draft = nothing changes.
//  - with "placer" ticked (UI): click a thing to select it (one tree of an instanced forest is ONE instance), then
//    move / rotate / scale it with the three.js TransformControls gizmo (r186 addon, MIT, web/lib3d/addons/
//    TransformControls.js), hide it, reset it, or copy it (the copy is a new object you can move anywhere).
//    "add" puts a copy of any listed object of this arena in front of the camera.
//  - every change is kept at once in this browser (localStorage draft); "save to file" writes
//    web/built/placements/<pack>.json (Chrome asks once for the web/built/placements folder and remembers it;
//    elsewhere the file is downloaded).
//   "Add object..." (web/arena-add-picker.js) lists EVERY registry asset with a preview; a click stands it on the ground in front of the
//   camera (an { id, asset, m } entry, re-made from the registry on reload). In move mode (key 1) a mouse drag on the selected thing slides
//   it along the ground (web/placer-format.js groundPoint over built.groundHeight).
// Keys while the placer is on: 1 move, 2 rotate, 3 scale, C copy, H or Delete hide/delete, Esc deselect.
// File format: { version: 1, pack, savedAt, edits: { "<path>|<instance or -1>": { m: [16] } | { hidden: true } },
//   added: [ { id, src: { path, inst }, m: [16] } | { id, asset: "<registry asset id>", m: [16] } ] }. <path> = names (or types) from the scene down, "#n" = n-th
//   sibling with that name. m = the local matrix (an instance: its instance matrix; an added copy: in the world group).
import * as THREE from "./lib3d/three.module.js";
import { TransformControls } from "./lib3d/addons/TransformControls.js";
import { getAsset } from "./built/registry.js";
import { buildAssetGroup, createAddPicker } from "./arena-add-picker.js";
import { normaliseData, isAssetEntry, newAssetEntry, groundPoint } from "./placer-format.js";

// big surfaces: not picked unless "pick ground too" is ticked (else every click lands on the floor or the water)
const SURFACE = new Set(["grass", "soil", "sand", "shore", "water", "sea", "mirror", "bank", "hills", "clouds", "grassBlades"]);
const DRAFT = (pack) => `arenaPlacer:${pack}`;

// ---------------------------------------------------------------- paths (stable names across rebuilds)
function seg(o) {
  const label = o.name || o.type;
  let n = 0;
  for (const s of o.parent.children) { if (s === o) break; if ((s.name || s.type) === label) n++; }
  return n ? `${label}#${n}` : label;
}
export function pathOf(o, root) {
  const p = [];
  for (let x = o; x && x !== root; x = x.parent) p.unshift(seg(x));
  return p.join("/");
}
export function findByPath(root, path) {
  let x = root;
  for (const s of path.split("/")) {
    const m = /^(.*?)(?:#(\d+))?$/.exec(s), label = m[1], want = +(m[2] || 0);
    let n = 0, hit = null;
    for (const c of x.children) if ((c.name || c.type) === label) { if (n === want) { hit = c; break; } n++; }
    if (!hit) return null;
    x = hit;
  }
  return x;
}

// ---------------------------------------------------------------- remembered folder handle (Chrome)
const idb = () => new Promise((ok, no) => {
  const r = indexedDB.open("arenaPlacer", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("kv");
  r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
});
async function idbGet(k) { try { const d = await idb(); return await new Promise((ok) => { const q = d.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); }); } catch { return null; } }
async function idbSet(k, v) { try { const d = await idb(); await new Promise((ok) => { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = ok; t.onerror = ok; }); } catch {} }

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpM = new THREE.Matrix4();

/**
 * opts: { canvas (the visible canvas, gets the clicks), getBuilt: () => built world (web/arena-built.js),
 *         getFreeCam: () => free camera (arena-viewer-tools.js) or null }
 * returns { tick() after each built.render, setUI(on, container), data(), destroy() }
 */
export function createPlacer({ canvas, getBuilt, getFreeCam = () => null }) {
  let built = null, world = null, pack = null, data = null, rebuilds = null, loading = null;
  let orig = new Map();          // "<path>|inst" -> the matrix before any edit (to reset / un-hide)
  let addedObjs = new Map();     // added id -> its mesh
  let ui = null, tc = null, sel = null, pickGround = false, gen = 0, picker = null;
  const ray = new THREE.Raycaster();

  const empty = () => ({ version: 1, pack, savedAt: 0, edits: {}, added: [] });
  const draftSave = () => { try { localStorage.setItem(DRAFT(pack), JSON.stringify({ ...data, draftAt: Date.now() })); } catch {} ; status(); };

  async function load() {
    const file = await fetch(`built/placements/${pack}.json`, { cache: "no-store" }).then((r) => r.ok ? r.json() : null).catch(() => null);
    let draft = null; try { draft = JSON.parse(localStorage.getItem(DRAFT(pack)) || "null"); } catch {}
    const pickD = draft && (!file || (draft.draftAt || 0) > (file.savedAt || 0));
    data = normaliseData(pickD ? draft : file || empty(), pack);
    data.unsaved = !!pickD;
  }

  // the instanced trees / plants are re-made when the keep-out changes: put every edit and copy back
  function apply() {
    orig = new Map();
    for (const [key, e] of Object.entries(data.edits)) {
      const [path, i] = key.split("|"), inst = +i, o = findByPath(built.scene, path);
      if (!o) continue;
      if (inst >= 0 && o.isInstancedMesh) {
        if (inst >= o.count) continue;
        o.getMatrixAt(inst, tmpM); orig.set(key, tmpM.clone());
        o.setMatrixAt(inst, e.hidden ? ZERO : tmpM.fromArray(e.m)); o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere();
      } else if (inst < 0) {
        orig.set(key, { m: o.matrix.clone(), visible: o.visible });
        if (e.hidden) o.visible = false; else { tmpM.fromArray(e.m).decompose(o.position, o.quaternion, o.scale); o.updateMatrix(); }
      }
    }
    for (const a of addedObjs.values()) a.removeFromParent();
    addedObjs = new Map();
    for (const a of data.added) {
      if (isAssetEntry(a)) makeAsset(a).catch((err) => console.warn("[placer] asset", a.asset, err?.message || err));
      else makeCopy(a);
    }
  }

  // put every touched thing back as the world made it, and take the copies away
  function restoreAll() {
    for (const [key, was] of orig) {
      const [path, i] = key.split("|"), inst = +i, o = findByPath(built.scene, path);
      if (!o) continue;
      if (inst >= 0 && o.isInstancedMesh) { o.setMatrixAt(inst, was); o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere(); }
      else { was.m.decompose(o.position, o.quaternion, o.scale); o.visible = was.visible; o.updateMatrix(); }
    }
    orig = new Map();
    for (const a of addedObjs.values()) a.removeFromParent();
    addedObjs = new Map();
  }

  function addedGroup() {
    let g = world.getObjectByName("placerAdded");
    if (!g) { g = new THREE.Group(); g.name = "placerAdded"; world.add(g); }
    return g;
  }
  // an added registry asset: made from the registry (cached per loaded arena), stands alone in the "placerAdded" group
  async function makeAsset(a) {
    const b = built, asset = await getAsset(a.asset, b.slots.env, `${pack}:placer${gen}`, null);
    if (built !== b || !data.added.includes(a) || addedObjs.has(a.id)) return null;
    const g = buildAssetGroup(asset, `placed_${a.id}`, a.id);
    tmpM.fromArray(a.m).decompose(g.position, g.quaternion, g.scale);
    addedGroup().add(g); g.updateMatrixWorld(true);
    addedObjs.set(a.id, g);
    return g;
  }
  const ADD_SCALE = 800;   // a registry asset is normalised to height <= 1: 800 render units = 2 m tall to start with (scale it with key 3)
  async function addAsset(assetId) {
    if (!ui || !built) throw new Error("placer is off");
    const cam = built.camera, f = new THREE.Vector3(); cam.getWorldDirection(f);
    const at = cam.position.clone().addScaledVector(f.setY(0).normalize(), 4000 * world.scale.x);
    at.y = built.groundHeight?.(at.x, at.z) ?? 0;
    world.worldToLocal(at);
    const m = new THREE.Matrix4().compose(at, new THREE.Quaternion(), new THREE.Vector3(ADD_SCALE, ADD_SCALE, ADD_SCALE));
    const a = newAssetEntry(`a${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, assetId, m.toArray());
    data.added.push(a);
    let g;
    try { g = await makeAsset(a); } catch (err) { data.added = data.added.filter((x) => x !== a); throw err; }
    if (!g) { data.added = data.added.filter((x) => x !== a); throw new Error("arena changed, try again"); }
    data.unsaved = true; draftSave(); select(g, null);
    return true;
  }

  // a copy of a mesh or of ONE instance: shares geometry + material, stands alone in the "placerAdded" group
  function makeCopy(a) {
    const src = findByPath(built.scene, a.src.path);
    if (!src?.isMesh) return null;
    let c;
    if (src.isInstancedMesh) {
      c = new THREE.InstancedMesh(src.geometry, src.material, 1);
      c.setMatrixAt(0, new THREE.Matrix4());
      if (src.instanceColor && a.src.inst >= 0) {
        c.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
        const col = new THREE.Color(); src.getColorAt(Math.min(a.src.inst, src.count - 1), col); c.setColorAt(0, col);
      }
    } else c = new THREE.Mesh(src.geometry, src.material);
    c.name = `placed_${a.id}`; c.userData = { ...src.userData, placed: a.id };
    c.renderOrder = src.renderOrder; c.castShadow = src.castShadow; c.receiveShadow = src.receiveShadow;
    tmpM.fromArray(a.m).decompose(c.position, c.quaternion, c.scale);
    addedGroup().add(c); c.updateMatrixWorld(true);
    if (c.isInstancedMesh) c.computeBoundingSphere();
    addedObjs.set(a.id, c);
    return c;
  }

  // ---------------------------------------------------------------- selection
  function keyOf(o, inst) { return `${pathOf(o, built.scene)}|${inst ?? -1}`; }
  function deselect() {
    tc?.detach();
    if (sel?.proxy) sel.proxy.removeFromParent();
    sel = null; status();
  }
  function select(o, inst) {
    deselect();
    if (!o) return;
    const added = o.userData?.placed != null ? data.added.find((a) => a.id === o.userData.placed) : null;
    if (added) { sel = { obj: o, added }; tc?.attach(o); status(); return; }
    if (o.isInstancedMesh && inst != null) {
      const proxy = new THREE.Object3D(); o.add(proxy);
      o.getMatrixAt(inst, tmpM); tmpM.decompose(proxy.position, proxy.quaternion, proxy.scale);
      sel = { obj: o, inst, proxy, key: keyOf(o, inst) };
      tc?.attach(proxy);
    } else { sel = { obj: o, inst: null, key: keyOf(o, null) }; tc?.attach(o); }
    status();
  }
  function changed() {
    if (!sel) return;
    if (sel.added) { sel.obj.updateMatrix(); sel.added.m = sel.obj.matrix.toArray(); if (sel.obj.isInstancedMesh) sel.obj.computeBoundingSphere(); }
    else if (sel.proxy) {
      const o = sel.obj;
      if (!orig.has(sel.key)) { o.getMatrixAt(sel.inst, tmpM); orig.set(sel.key, tmpM.clone()); }
      sel.proxy.updateMatrix(); o.setMatrixAt(sel.inst, sel.proxy.matrix); o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere();
      data.edits[sel.key] = { m: sel.proxy.matrix.toArray() };
    } else {
      const o = sel.obj;
      if (!orig.has(sel.key)) orig.set(sel.key, { m: o.matrix.clone(), visible: o.visible });
      o.updateMatrix(); data.edits[sel.key] = { m: o.matrix.toArray() };
    }
    data.unsaved = true;
  }
  function hideSel() {
    if (!sel) return;
    if (sel.added) { data.added = data.added.filter((a) => a !== sel.added); sel.obj.removeFromParent(); addedObjs.delete(sel.added.id); }
    else if (sel.proxy) {
      const o = sel.obj; if (!orig.has(sel.key)) { o.getMatrixAt(sel.inst, tmpM); orig.set(sel.key, tmpM.clone()); }
      o.setMatrixAt(sel.inst, ZERO); o.instanceMatrix.needsUpdate = true; data.edits[sel.key] = { hidden: true };
    } else {
      if (!orig.has(sel.key)) orig.set(sel.key, { m: sel.obj.matrix.clone(), visible: sel.obj.visible });
      sel.obj.visible = false; data.edits[sel.key] = { hidden: true };
    }
    data.unsaved = true; deselect(); draftSave();
  }
  function resetSel() {
    if (!sel || sel.added) return;
    const o = sel.obj, was = orig.get(sel.key);
    delete data.edits[sel.key];
    if (was) {
      if (sel.proxy) { o.setMatrixAt(sel.inst, was); o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere(); }
      else { was.m.decompose(o.position, o.quaternion, o.scale); o.visible = was.visible; o.updateMatrix(); }
    }
    data.unsaved = true; const s = [sel.obj, sel.inst]; deselect(); select(...s); draftSave();
  }
  // world-group-local matrix of the selected thing (an instance: through its mesh)
  function localMatrixOf(o, inst) {
    const w = new THREE.Matrix4().copy(world.matrixWorld).invert();
    o.updateMatrixWorld(true);
    const m = new THREE.Matrix4().multiplyMatrices(w, o.matrixWorld);
    if (inst != null && o.isInstancedMesh) { o.getMatrixAt(inst, tmpM); m.multiply(tmpM); }
    return m;
  }
  function copyOf(o, inst, at = null) {
    const ent = o.userData?.placed != null ? data.added.find((a) => a.id === o.userData.placed) : null;
    if (ent && isAssetEntry(ent)) {   // a copy of an added registry asset: a second entry of the same asset, beside it
      const m = localMatrixOf(o, null), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s);
      p.x += Math.max(s.x, s.z) * 1.2; m.compose(p, q, s);
      const a = newAssetEntry(`a${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, ent.asset, m.toArray());
      data.added.push(a); data.unsaved = true;
      makeAsset(a).then((g) => { draftSave(); if (g) select(g, null); });
      return;
    }
    const srcObj = o.userData?.placed != null ? findByPath(built.scene, data.added.find((a) => a.id === o.userData.placed)?.src.path || "") : o;
    const srcInfo = o.userData?.placed != null ? data.added.find((a) => a.id === o.userData.placed).src : { path: pathOf(o, built.scene), inst: inst ?? -1 };
    if (!srcObj) return;
    const m = localMatrixOf(o, inst);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s);
    if (at) p.copy(at);
    else {   // beside the original: one bounding radius sideways
      const g = srcObj.geometry; g.boundingSphere || g.computeBoundingSphere();
      p.x += g.boundingSphere.radius * Math.max(s.x, s.z) * 1.2;
    }
    m.compose(p, q, s);
    const a = { id: `a${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, src: srcInfo, m: m.toArray() };
    data.added.push(a); data.unsaved = true;
    const c = makeCopy(a); draftSave();
    if (c) select(c, null);
  }

  // ---------------------------------------------------------------- picking (a click, not a drag)
  let down = null;
  const onDown = (e) => { down = [e.clientX, e.clientY]; };
  const onUp = (e) => {
    if (!ui || !down || !built || tc?.dragging) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]); down = null;
    if (moved > 4 || e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, built.camera);
    const cands = [];
    world.traverseVisible((o) => { if (o.isMesh && (pickGround || !SURFACE.has(o.userData?.kind))) cands.push(o); });
    const hit = ray.intersectObjects(cands, false).find((h) => !(h.object.isInstancedMesh && h.instanceId == null));
    if (!hit) { deselect(); return; }
    const tgt = hit.object.parent?.userData?.assetGroup ? hit.object.parent : hit.object;   // an added asset is picked as its whole group
    select(tgt, tgt.isInstancedMesh && tgt.userData?.placed == null ? hit.instanceId : null);
  };
  // ---------------------------------------------------------------- drag along the ground (move mode, the selected thing, not on a gizmo handle)
  let drag = null;
  const groundAt = (e, h0) => {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), built.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    return groundPoint([o.x, o.y, o.z], [d.x, d.y, d.z], (x, z) => built.groundHeight?.(x, z) ?? null, h0);
  };
  const onDragMove = (e) => {
    if (!drag) return;
    const gp = groundAt(e, drag.lastY); if (!gp) return;
    drag.lastY = gp.y;
    const w = new THREE.Vector3(gp.x + drag.off.x, gp.y + drag.off.y, gp.z + drag.off.z);
    drag.obj.parent.updateMatrixWorld(true);
    drag.obj.position.copy(drag.obj.parent.worldToLocal(w));
    drag.obj.updateMatrix(); changed();
  };
  const onDragEnd = () => {
    if (!drag) return; drag = null;
    removeEventListener("pointermove", onDragMove); removeEventListener("pointerup", onDragEnd); removeEventListener("pointercancel", onDragEnd);
    const fc = getFreeCam(); if (fc) fc.controls.enabled = true;
    draftSave();
  };
  const onDragDown = (e) => {
    if (!ui || !sel || !built || e.button !== 0 || tc?.dragging || tc?.axis || (tc && tc.mode !== "translate")) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), built.camera);
    if (!ray.intersectObject(sel.obj, true).some((h) => !sel.proxy || (h.object === sel.obj && h.instanceId === sel.inst))) return;
    const obj = sel.proxy || sel.obj;
    obj.updateWorldMatrix(true, false);
    const cur = obj.getWorldPosition(new THREE.Vector3()), gp = groundAt(e, cur.y); if (!gp) return;
    drag = { obj, lastY: gp.y, off: new THREE.Vector3(cur.x - gp.x, cur.y - gp.y, cur.z - gp.z) };
    const fc = getFreeCam(); if (fc) fc.controls.enabled = false;
    addEventListener("pointermove", onDragMove); addEventListener("pointerup", onDragEnd); addEventListener("pointercancel", onDragEnd);
    e.stopImmediatePropagation(); e.preventDefault();
  };
  canvas.addEventListener("pointerdown", onDragDown, true);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || "") || e.ctrlKey || e.metaKey || e.altKey;
  const onKey = (e) => {
    if (!ui || typing(e)) return;
    const k = e.key.toLowerCase();
    if (k === "1") tc?.setMode("translate"); else if (k === "2") tc?.setMode("rotate"); else if (k === "3") tc?.setMode("scale");
    else if (k === "c" && sel) copyOf(sel.obj, sel.inst);
    else if ((k === "h" || e.key === "Delete") && sel) hideSel();
    else if (e.key === "Escape") deselect();
    else return;
    e.preventDefault();
  };
  addEventListener("keydown", onKey);

  function makeGizmo() {
    tc?.detach(); tc?.getHelper().removeFromParent(); tc?.dispose(); tc = null;
    if (!ui || !built) return;
    tc = new TransformControls(built.camera, canvas);
    tc.setSpace("local");
    tc.addEventListener("dragging-changed", (ev) => { const fc = getFreeCam(); if (fc) fc.controls.enabled = !ev.value; if (!ev.value) draftSave(); });
    tc.addEventListener("objectChange", changed);
    built.scene.add(tc.getHelper());
  }

  // ---------------------------------------------------------------- panel
  function status() {
    if (!ui) return;
    const n = Object.keys(data?.edits || {}).length, a = data?.added?.length || 0;
    ui.q("#plSel").textContent = !sel ? "nothing selected (click a thing)"
      : `${sel.added ? (sel.added.asset ? "added " + sel.added.asset : "copy of " + sel.added.src.path.split("/").pop()) : sel.obj.name || sel.obj.type}${sel.inst != null && !sel.added ? " #" + sel.inst : ""} (${sel.obj.userData?.kind || "?"})`;
    ui.q("#plStat").textContent = `${pack}: ${n} changed, ${a} added${data?.unsaved ? ", NOT saved to file" : ", saved"}`;
  }
  function fillList() {
    if (!ui || !world) return;
    const s = ui.q("#plList"); s.innerHTML = "";
    world.traverse((o) => {
      if (!o.isMesh || o.userData?.placed != null || SURFACE.has(o.userData?.kind) || o.name === "builtSky") return;
      const opt = document.createElement("option");
      opt.value = pathOf(o, built.scene);
      opt.textContent = `${o.userData?.kind || "-"}: ${o.name || o.type}${o.isInstancedMesh ? ` (${o.count})` : ""}`;
      s.appendChild(opt);
    });
  }
  async function saveFile() {
    const out = { ...data, savedAt: Date.now() }; delete out.unsaved; delete out.draftAt;
    const text = JSON.stringify(out, null, 1);
    let ok = false;
    if (window.showDirectoryPicker) {
      try {
        let dir = await idbGet("dir");
        if (dir && (await dir.queryPermission({ mode: "readwrite" })) !== "granted" && (await dir.requestPermission({ mode: "readwrite" })) !== "granted") dir = null;
        if (!dir) { dir = await window.showDirectoryPicker({ id: "arenaPlacements", mode: "readwrite" }); await idbSet("dir", dir); }
        const fh = await dir.getFileHandle(`${pack}.json`, { create: true }), w = await fh.createWritable();
        await w.write(text); await w.close(); ok = true;
      } catch (err) { console.warn("[placer] save to folder failed, downloading instead", err); }
    }
    if (!ok) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = `${pack}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
    data.savedAt = out.savedAt; data.unsaved = false;
    try { localStorage.removeItem(DRAFT(pack)); } catch {}
    status();
  }
  function setUI(on, container) {
    if (!on) { picker?.close(); deselect(); tc?.getHelper().removeFromParent(); tc?.dispose(); tc = null; ui?.el.remove(); ui = null; return; }
    if (ui) return;
    const el = document.createElement("div");
    el.innerHTML = `
      <div style="color:#678;font-size:11px">click a thing to pick it; with 1 (move) drag it on the ground; 2 rotate, 3 scale, C copy, H hide, Esc drop</div>
      <div id="plSel" style="color:#cfe;margin:4px 0"></div>
      <button data-a="t">move</button><button data-a="r">rotate</button><button data-a="s">scale</button>
      <button data-a="sp">local/world</button><br>
      <button data-a="c">copy</button><button data-a="h">hide / delete</button><button data-a="z">reset</button><br>
      <label><input id="plGround" type="checkbox"> pick ground and water too</label><br>
      <button data-a="addObj" style="font-weight:bold">Add object...</button> (pick any asset, drag it on the ground)<br>
      copy of a thing here: <select id="plList" style="max-width:270px"></select> <button data-a="add">add in view</button><br>
      <button data-a="save" style="font-weight:bold">Save</button> <button data-a="undoAll">Discard unsaved changes</button>
      <div id="plStat" style="color:#9ab;font-size:11px;margin-top:4px"></div>`;
    container.appendChild(el);
    ui = { el, q: (s) => el.querySelector(s) };
    el.onclick = (e) => {
      const a = e.target.dataset?.a; if (!a) return;
      if (a === "t") tc?.setMode("translate"); else if (a === "r") tc?.setMode("rotate"); else if (a === "s") tc?.setMode("scale");
      else if (a === "sp") tc?.setSpace(tc.space === "local" ? "world" : "local");
      else if (a === "c" && sel) copyOf(sel.obj, sel.inst);
      else if (a === "h") hideSel(); else if (a === "z") resetSel();
      else if (a === "add") {
        const o = findByPath(built.scene, ui.q("#plList").value); if (!o) return;
        // in front of the camera, on the floor height of the world group
        const cam = built.camera, f = new THREE.Vector3(); cam.getWorldDirection(f);
        const at = cam.position.clone().addScaledVector(f.setY(0).normalize(), 4000 * world.scale.x);
        world.worldToLocal(at); at.y = 0;
        copyOf(o, o.isInstancedMesh ? 0 : null, at);
      }
      else if (a === "addObj") { picker ||= createAddPicker({ getBuilt: () => built, onPick: addAsset }); picker.open(); }
      else if (a === "save") saveFile();
      else if (a === "undoAll") { try { localStorage.removeItem(DRAFT(pack)); } catch {} ; deselect(); restoreAll(); built = null; }   // tick() reloads from the file
    };
    ui.q("#plGround").onchange = (e) => { pickGround = e.target.checked; };
    makeGizmo(); fillList(); status();
  }

  function tick() {
    const b = getBuilt();
    if (!b?.scene || b.missing) return;
    if (b !== built) {
      if (loading) return;
      deselect(); built = b; gen++; pack = b.info.pack; world = b.foliage?.parent || b.scene.children.find((c) => c.isGroup) || b.scene;
      rebuilds = null; data = null;
      loading = load().then(() => { loading = null; if (built === b) { makeGizmo(); fillList(); status(); } });
      return;
    }
    if (!data) return;
    const rb = b.info.keepOut?.rebuilds ?? 0;
    if (rb !== rebuilds) { rebuilds = rb; if (sel?.proxy) deselect(); apply(); fillList(); status(); }
  }

  return {
    tick, setUI,
    data: () => data, selection: () => sel,
    select: (path, inst = null) => select(findByPath(built.scene, path), inst),   // for checkers
    destroy() { setUI(false); canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointerdown", onDragDown, true); onDragEnd(); picker?.destroy(); picker = null; canvas.removeEventListener("pointerup", onUp); removeEventListener("keydown", onKey); },
  };
}
