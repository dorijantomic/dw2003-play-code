// Arena Viewer (web/arena-viewer.html) tools, loaded only when used:
//  FREE CAMERA  "camera: free": mouse orbit / pan / zoom with three.js OrbitControls (r186 addon, MIT,
//               web/lib3d/addons/OrbitControls.js) plus W A S D (fly forward / left / back / right), Q / E (down / up),
//               Shift = 4x faster. It starts from the battle camera's pose of that frame. The page hands its view to
//               battle3d through setFreeCameraView(), and the built world (web/arena-built.js) is drawn with
//               battle3d's getCameraInfo().render as always, so the Digimon and the arena share ONE camera.
//  TUNING PANEL (look=built only, collapsed): lil-gui 0.20.0 (MIT, (c) 2019 George Michael Brower,
//               web/lib3d/lil-gui.esm.js + lil-gui.LICENSE). Its controls are made from the uniforms that are really
//               on the built world's materials (grouped by mesh userData.kind / name), changed at RUNTIME only: no
//               web/built/*.js module is edited. Nothing is read or written until the panel is first opened (the
//               start values are taken then). "reset" writes the start values back; "copy values" puts a JSON of
//               the changed values on the clipboard (to bake into the modules later).
import * as THREE from "./lib3d/three.module.js";
import { OrbitControls } from "./lib3d/addons/OrbitControls.js";
import GUI from "./lib3d/lil-gui.esm.js";

// ---------------------------------------------------------------- free camera
export function createFreeCam({ r, canvas, init }) {
  // init = { eye, look, up, fovDeg, aspect }: a remembered pose (the viewer's saved state), used instead of the battle
  // camera's, so nothing jumps on a reload or a look switch
  const c = init ? { eye: init.eye, look: init.look, up: init.up, fovRad: init.fovDeg * Math.PI / 180, aspect: init.aspect }
    : r.getCameraInfo()?.render;
  if (!c) return null;
  const camera = new THREE.PerspectiveCamera(c.fovRad * 180 / Math.PI, c.aspect, 1, 60000);
  camera.position.fromArray(c.eye);
  camera.up.fromArray(c.up);                       // OrbitControls orbits about camera.up (read in its constructor)
  const controls = new OrbitControls(camera, canvas);
  controls.target.fromArray(c.look);
  controls.maxDistance = 50000;
  controls.update();
  const keys = new Set();
  const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || "") || e.ctrlKey || e.metaKey || e.altKey;
  const down = (e) => { if (typing(e)) return; const k = e.key.toLowerCase(); if ("wasdqe".includes(k) && k.length === 1) { keys.add(k); e.preventDefault(); } if (e.key === "Shift") keys.add("shift"); };
  const up = (e) => { keys.delete(e.key.toLowerCase()); if (e.key === "Shift") keys.delete("shift"); };
  const blur = () => keys.clear();
  addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("blur", blur);
  const SPEED = 1500;   // render units per second (400 units ~ 1 m)
  const f = new THREE.Vector3(), s = new THREE.Vector3(), mv = new THREE.Vector3();
  return {
    camera, controls, start: { eye: [...c.eye], look: [...c.look], up: [...c.up], fovDeg: camera.fov },
    /** move with the held keys; dt in seconds */
    step(dt) {
      if (!keys.size || !(dt > 0)) return;
      f.subVectors(controls.target, camera.position).normalize();
      s.crossVectors(f, camera.up).normalize();
      mv.set(0, 0, 0);
      if (keys.has("w")) mv.add(f); if (keys.has("s")) mv.sub(f);
      if (keys.has("d")) mv.add(s); if (keys.has("a")) mv.sub(s);
      if (keys.has("e")) mv.add(camera.up); if (keys.has("q")) mv.sub(camera.up);
      if (!mv.lengthSq()) return;
      mv.normalize().multiplyScalar(SPEED * (keys.has("shift") ? 4 : 1) * dt);
      camera.position.add(mv); controls.target.add(mv); controls.update();
    },
    /** put the camera at eye looking at look (render space), as a mouse drag would leave it */
    set(eye, look) { camera.position.fromArray(eye); controls.target.fromArray(look); controls.update(); },
    /** the view battle3d draws through (setFreeCameraView): render space */
    view() {
      return { eye: camera.position.toArray(), look: controls.target.toArray(), up: camera.up.toArray(), fovDeg: camera.fov };
    },
    dispose() {
      controls.dispose(); removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", blur);
    },
  };
}

// ---------------------------------------------------------------- tuning panel
// which panel folder a built mesh belongs to (its userData.kind, set by arena-built.js and the web/built modules)
function folderOf(o) {
  const k = o.userData?.kind;
  if (k === "water" || k === "sea") return "Water";
  if (k === "sand" || k === "shore") return "Sand";
  if (k === "spire") return "Spires";
  if (k === "gulls") return "Gulls";
  if (k === "mirror") return "Lake";   // web/built/mirror.js: the lake surface and its reflections (meft1008)
  if (k === "foliage") return "Trees";
  if (k === "mushroom") return "Mushrooms";   // meft1008 wall_06 (web/built/mushrooms.js)
  if (k === "floorcover") return "Floor cover";   // meft1008 forest-floor plants and litter (web/built/floorcover.js)
  if (k === "fringe") return "Fringe";        // meft1008 wall_07 (web/built/fringe.js)
  if (k === "grassBlades") return "Grass blades";
  if (k === "grass" || k === "soil" || k === "bank" || k === "rocks" || k === "hills") return "Ground";
  if (k === "clouds" || o.name === "builtSky" || o.name === "builtClouds") return "Sky / clouds";
  return null;
}
// shared uniforms (web/built/shared.js U and SKY_U, ONE object for every material) go to these folders by name
const LIGHT_NAMES = ["uLightDir", "uLightColor", "uAmbient", "uShadowTint", "uShadowMix", "uShadeK", "uShadeCore", "uSkyFill",
  "uGroundBounce", "uRimColor", "uUnlitK", "uSoft", "uPaint", "uSunDir"];
const WIND_NAMES = ["uWindDir", "uWindStrength", "uWindGust", "uWindBend", "uWindPhaseScale", "uWindFreq", "uWindRing"];
// not offered: written by the modules every frame (camera, clock), or mapping / geometry / counts that a slider breaks.
// Any other uniform that is SEEN changing between frames without the panel is greyed out when the panel opens.
const SKIP = new Set(["uPxRad", "uRingEye", "uBandS", "uRingT", "uRingN", "uBandY", "uRing", "uGullTime", "uGrassEye",
  "uGrassFighter", "uWindTime", "uTime", "uNoiseSeed", "uShoreSpan", "uMaskSpan", "uSeaY", "uTexOn", "uGradS", "uPerm",
  "uMusTime", "uSporeScale"]);   // uMusTime / uSporeScale: written every frame by web/built/mushrooms.js
const DIRS = new Set(["uLightDir", "uSunDir", "uGlowDir", "uMoonDir"]);

const kindOf = (v) => typeof v === "number" ? "num" : v?.isColor ? "col"
  : (v?.isVector2 || v?.isVector3 || v?.isVector4) ? "vec" : null;
const snap = (v) => typeof v === "number" ? v : v.clone();
const same = (a, b) => typeof a === "number" ? a === b : a.equals(b);
function range(v) {
  if (v > 0) return [0, v <= 0.5 ? 1 : 2 * v];
  if (v < 0) return [2 * v, -2 * v];
  return [0, 1];
}

/**
 * opts: { built, post, container, shoreNames: Set (uniform names water.js shares between the sea and the sand),
 *         skyMode: () => "auto"|"day"|"night", setSkyMode(m) }
 */
export function createTuner(opts) {
  const { built, post, container } = opts;
  const S = built.shared;
  const changed_ = () => { try { opts.onChange?.(); } catch {} };
  const gui = new GUI({ container, title: "tuning panel (built look)", width: 285 });
  gui.close();
  const entries = [];   // { id, folder, name, kind, targets: [uniform objects], start, ctl, live, mats: [names] }
  let ready = false, live = null;
  const params = {};

  function collect() {
    const shared = new Set([...Object.values(S.U), ...Object.values(S.SKY_U)]);
    const sharedName = new Map([...Object.entries(S.U), ...Object.entries(S.SKY_U)].map(([n, u]) => [u, n]));
    // own uniforms: folder -> name -> [{u, mat}]
    const own = new Map();
    const seenMat = new Set();
    const addOwn = (folder, name, u, label) => {
      if (!own.has(folder)) own.set(folder, new Map());
      const f = own.get(folder); if (!f.has(name)) f.set(name, []);
      if (!f.get(name).some((t) => t.u === u)) f.get(name).push({ u, label });
    };
    built.scene.traverse((o) => {
      if (!o.material) return;
      const folder = folderOf(o); if (!folder) return;
      for (const m of [].concat(o.material)) {
        if (!m.uniforms) continue;
        const label = o.name || m.name || o.userData.kind;
        for (const [n, u] of Object.entries(m.uniforms)) {
          if (shared.has(u) || SKIP.has(n) || !kindOf(u.value)) continue;
          // water.js gives the sea AND the sand the same shore uniforms (one waterline, one swash): one control
          const f = opts.shoreNames?.has(n) && (folder === "Water" || folder === "Sand") ? "Water" : folder;
          addOwn(f, n, u, label);
        }
        seenMat.add(m);
      }
    });
    for (const m of post?.materials || []) for (const [n, u] of Object.entries(m.uniforms || {}))
      if (!SKIP.has(n) && kindOf(u.value) && !/^t[A-Z]/.test(n)) addOwn("Colour pass", n, u, "post");
    const out = [];
    // shared: Light, Wind, Sky / clouds (only the ones some built material really uses)
    const used = new Set();
    built.scene.traverse((o) => { for (const m of [].concat(o.material || [])) for (const u of Object.values(m.uniforms || {})) if (shared.has(u)) used.add(u); });
    for (const u of used) {
      const n = sharedName.get(u);
      if (SKIP.has(n) || !kindOf(u.value)) continue;
      const folder = LIGHT_NAMES.includes(n) ? "Light" : WIND_NAMES.includes(n) ? "Wind" : "Sky / clouds";
      out.push({ folder, name: n, targets: [u], mats: ["shared"] });
    }
    for (const [folder, names] of own) for (const [n, list] of names) {
      // one control per name per folder when every copy starts equal (the same constant), else one per material
      const v0 = list[0].u.value;
      if (list.every((t) => kindOf(t.u.value) === kindOf(v0) && same(t.u.value, v0)))
        out.push({ folder, name: n, targets: list.map((t) => t.u), mats: [...new Set(list.map((t) => t.label))] });
      else for (const t of list) out.push({ folder, name: n, sub: t.label, targets: [t.u], mats: [t.label] });
    }
    return out;
  }

  function write(e, v) {
    for (const u of e.targets) {
      if (e.kind === "num") u.value = v; else u.value.copy(v);
    }
  }
  function current(e) { return e.targets[0].value; }
  function showFrom(e) {   // the control's displayed value from the uniform
    const v = current(e);
    if (e.kind === "num") params[e.id] = v;
    else if (e.kind === "col") params[e.id] = "#" + v.getHexString();
    else if (e.dir) {
      const d = v.clone().normalize();
      params[e.id + ".az"] = +(Math.atan2(d.x, d.z) * 180 / Math.PI).toFixed(3);
      params[e.id + ".el"] = +(Math.asin(Math.max(-1, Math.min(1, d.y))) * 180 / Math.PI).toFixed(3);
    } else for (const c of ["x", "y", "z", "w"]) if (c in v) params[e.id + "." + c] = v[c];
  }

  function build() {
    if (ready) return;
    ready = true;
    const list = collect();
    const folders = {};
    const order = ["Light", "Water", "Lake", "Sand", "Sky / clouds", "Spires", "Ground", "Grass blades", "Trees", "Floor cover", "Gulls", "Wind", "Colour pass"];
    list.sort((a, b) => order.indexOf(a.folder) - order.indexOf(b.folder) || a.name.localeCompare(b.name));
    const folder = (name) => folders[name] ||= gui.addFolder(name).close();
    // Light: the sky time switch first (the viewer's own sky time: auto / day / night)
    if (opts.setSkyMode) {
      params.skyTime = opts.skyMode();
      folder("Light").add(params, "skyTime", ["auto", "day", "night"]).name("time of day (sky)").onChange((m) => opts.setSkyMode(m));
    }
    for (const it of list) {
      let id = `${it.folder}/${it.mats.join("+")}/${it.name}`;
      for (let k = 2; entries.some((x) => x.id === id); k++) id = `${it.folder}/${it.mats.join("+")}#${k}/${it.name}`;
      const e = { ...it, kind: kindOf(it.targets[0].value), id };
      e.dir = DIRS.has(e.name) && e.kind === "vec" && e.targets[0].value.isVector3;
      e.start = snap(current(e));
      showFrom(e);
      const f = folder(e.folder);
      // an own uniform that has a shared namesake in the same folder (the clouds' own uCloudLit) is named by its mesh
      const twin = !e.sub && e.mats[0] !== "shared" && list.some((x) => x !== it && x.folder === e.folder && x.name === e.name);
      const label = e.name.replace(/^u/, "") + (e.sub ? ` (${e.sub})` : "") + (e.mats.length > 1 || twin ? ` (${e.mats.join(" + ")})` : "");
      e.ctls = [];
      if (e.kind === "num") {
        const [lo, hi] = range(e.start);
        e.ctls.push(f.add(params, e.id, lo, hi, (hi - lo) / 1000).name(label).onChange((v) => write(e, v)));
      } else if (e.kind === "col") {
        e.ctls.push(f.addColor(params, e.id).name(label).onChange((hex) =>
          write(e, new THREE.Color().setStyle(hex).multiplyScalar(e.name === "uLightColor" ? params.lightStrength ?? 1 : 1))));
      } else if (e.dir) {
        const apply = () => {
          const az = params[e.id + ".az"] * Math.PI / 180, el = params[e.id + ".el"] * Math.PI / 180;
          const len = e.start.length() || 1;
          write(e, new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(len));
        };
        e.ctls.push(f.add(params, e.id + ".az", -180, 180, 0.1).name(label + " azimuth").onChange(apply));
        e.ctls.push(f.add(params, e.id + ".el", -90, 90, 0.1).name(label + " elevation").onChange(apply));
      } else {
        for (const c of ["x", "y", "z", "w"]) {
          if (!(c in e.start)) continue;
          const [lo, hi] = range(e.start[c]);
          e.ctls.push(f.add(params, e.id + "." + c, lo, hi, (hi - lo) / 1000).name(`${label}.${c}`).onChange((v) => {
            const nv = current(e).clone(); nv[c] = v; write(e, nv);
          }));
        }
      }
      entries.push(e);
    }
    // light strength: a multiplier on the light colour (uLightColor), kept beside it
    const lc = entries.find((e) => e.name === "uLightColor");
    if (lc) {
      params.lightStrength = 1;
      lc.strength = folder("Light").add(params, "lightStrength", 0, 3, 0.001).name("light strength (x LightColor)").onChange((k) => {
        write(lc, new THREE.Color().setStyle(params[lc.id]).multiplyScalar(k));
      });
    }
    // option: the Gemini spire rock + instanced shrubs (web/built/spires_gemini.js). Off until switched on here.
    const spireLayer = (built.layers || []).find((l) => l.id === "spires" && l.setGemini);
    if (spireLayer) {
      params.geminiSpires = !!spireLayer.gemini?.root?.visible;
      folder("Spires").add(params, "geminiSpires").name("gemini spires (rock + shrubs)")
        .onChange((v) => { spireLayer.setGemini(v).catch((e) => console.error("gemini spires", e)); });
    }
    gui.add({ reset }, "reset").name("reset (start values)");
    gui.add({ copy }, "copy").name("copy values (JSON)");
    // live check: a uniform that changes between frames while nobody touches the panel is the module's own (camera,
    // clock): it is greyed out, not fought over. Measured on the next frames the viewer reports (frameTick).
    live = { frames: 0, snap: entries.map((e) => snap(current(e))) };
  }

  function frameTick() {
    if (!live || live.frames > 3) return;
    live.frames++;
    entries.forEach((e, i) => {
      if (!e.touched && !same(current(e), live.snap[i])) { e.live = true; for (const c of e.ctls) c.disable().name(c._name + " (live)"); }
    });
    if (live.frames > 3) live.done = true;
  }

  function changed(e) { return !same(current(e), e.start); }
  function reset() {
    for (const e of entries) { if (e.live) continue; write(e, e.start); e.touched = false; showFrom(e); }
    if (params.lightStrength != null) params.lightStrength = 1;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    changed_();
  }
  function changes() {
    const out = {};
    for (const e of entries) {
      if (e.live || !changed(e)) continue;
      const enc = (v) => typeof v === "number" ? +v.toPrecision(6) : v.isColor ? { srgb: "#" + v.getHexString(), linear: v.toArray().map((x) => +x.toPrecision(6)) } : v.toArray().map((x) => +x.toPrecision(6));
      (out[e.folder] ||= {})[e.name + (e.mats[0] === "shared" ? "" : ` (${e.mats.join(" + ")})`)] = { from: enc(e.start), to: enc(current(e)), on: e.mats };
    }
    return out;
  }
  async function copy() {
    const txt = JSON.stringify({ pack: built.info?.pack, changed: changes() }, null, 2);
    api.lastCopy = txt;
    try { await navigator.clipboard.writeText(txt); }
    catch {
      const t = document.createElement("textarea"); t.value = txt; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } catch {} t.remove();
    }
    console.log(txt);
    return txt;
  }
  // the viewer rebuilt the sky / rewrote the light (sky time, layer switch): keep what the user changed, and take the
  // new values as the start of everything they did not touch
  function afterRebuild() {
    if (!ready) return;
    for (const e of entries) {
      if (e.live) continue;
      if (e.touched) write(e, e.value);
      else { e.start = snap(current(e)); showFrom(e); }
    }
    if (params.skyTime != null) params.skyTime = opts.skyMode();
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  // remember what a control wrote (so afterRebuild can write it again)
  // lil-gui calls the parent's onChange BEFORE the control's own (which writes the uniform): read the value one microtask
  // later, when it is written (reading it at once kept the old value, so afterRebuild wrote the old value back)
  gui.onChange(({ property }) => {
    queueMicrotask(() => {
      const e = entries.find((x) => property === x.id || property.startsWith(x.id + "."));
      if (e) { e.touched = true; e.value = snap(current(e)); }
      else if (property === "lightStrength") { const lc = entries.find((x) => x.name === "uLightColor"); if (lc) { lc.touched = true; lc.value = snap(current(lc)); } }
      changed_();
    });
  });
  gui.onOpenClose((g) => { if (g === gui && !g._closed) build(); if (g === gui) changed_(); });
  // remembered panel values (viewer state): { id: number | [..] (linear) } of every control the user touched
  const enc = (v) => typeof v === "number" ? v : v.toArray();
  function touchedValues() {
    const out = {};
    for (const e of entries) if (e.touched && !e.live && e.value != null) out[e.id] = enc(e.value);
    return out;
  }
  function applyTouched(saved) {
    build();
    for (const e of entries) {
      const v = saved?.[e.id]; if (v == null || e.live) continue;
      let nv;
      if (e.kind === "num") nv = +v; else if (e.kind === "col") nv = new THREE.Color().fromArray(v);
      else nv = current(e).clone().fromArray(v);
      write(e, nv); e.touched = true; e.value = snap(nv); showFrom(e);
    }
    const lc = entries.find((x) => x.name === "uLightColor");
    if (lc && saved?.lightStrength != null) { params.lightStrength = saved.lightStrength; }
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  const lightStrength = () => params.lightStrength;

  const api = {
    gui, entries, build, reset, touchedValues, applyTouched, lightStrength, copy, changes, afterRebuild, frameTick, lastCopy: null,
    /** for checkers: set a control by its id (as a user drag would) */
    set(id, v) {
      build();
      const c = gui.controllersRecursive().find((k) => k.property === id);
      if (!c) return false;
      c.setValue(v); return true;
    },
    get ready() { return ready; },
    get isOpen() { return !gui._closed; },
    setOpen(v) { v ? gui.open() : gui.close(); },
    destroy() { gui.destroy(); },
  };
  return api;
}

/** uniform names declared in water.js's shore and water-body GLSL chunks (the ones sand.js takes from shoreUniforms) */
export async function shoreUniformNames() {
  const W = await import("./built/water.js").catch(() => null);
  const names = new Set();
  for (const src of [W?.SHORE_GLSL, W?.WATER_BODY_GLSL]) {
    if (typeof src !== "string") continue;
    for (const m of src.matchAll(/uniform\s+\w+\s+([^;]+);/g))
      for (const n of m[1].split(",")) names.add(n.trim().replace(/\[.*$/, ""));
  }
  return names;
}
