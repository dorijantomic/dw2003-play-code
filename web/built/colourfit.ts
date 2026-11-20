// COLOUR FIT of the BUILT arena look (Arena Viewer look=built): per-layer colour overrides, generic for every arena.
//   tools/fit_built_colours.mjs (ARENA=<meft id>) measures each built layer against the HD Remaster render of the same
//   cameras and writes  assets-hd/battle/built/<pack>.colours.json  (git-ignored, next to the recipe):
//     { arena, layers: { "<layer id>": { gain: [r,g,b], gamma: [r,g,b], visible?: false, ... } } }
//   This file reads that file at build time and applies it. NO file (and no tool flag) = nothing is touched: not one
//   material is patched, so an arena without a colours file renders bit-identically to before.
// LAYERS are DISCOVERED, never listed: every Mesh/Points/Line under the scene is a member of the layer named by its
//   own name with the instance suffixes (_s0, _v2, _lod1, trailing digits) stripped; an unnamed one takes its parent's
//   name, then userData.kind, then its type. A module that adds a mesh to the world is fitted with no change here.
// WHAT is fitted: the layer's final fragment colour c (what the shader writes, sRGB) goes  lin = c^2.2;  lin' = gain *
//   lin^gamma  (per channel);  c' = lin'^(1/2.2). Every material of the layer gets that stage appended to its fragment
//   shader (the original main() is renamed and called first), so any module is covered, whatever its own uniforms are.
//   A layer with  visible:false  is hidden (a layer the HD render has nothing like, e.g. a sparkle cloud).
// The tool drives the same machinery live through  colourFit.set(id, {gain, gamma, on})  and  setVisible(id, v).
import * as THREE from "../lib3d/three.module.js";

const SUFFIX = /(_s\d+|_v\d+|_lod\d+|_\d+)$/;
export function layerId(obj) {
  let n = obj.name || obj.parent?.name || obj.userData?.kind || obj.type;
  while (SUFFIX.test(n) && n.replace(SUFFIX, "")) n = n.replace(SUFFIX, "");
  return n;
}
const isDrawn = (o) => (o.isMesh || o.isPoints || o.isLine) && o.material;

const WRAP_TAIL = /* glsl */`
uniform float uFitOn; uniform vec3 uFitGain, uFitGamma;
void main() {
  fitOrigMain();
  if (uFitOn > 0.5) {
    vec3 l = pow(max(clamp(gl_FragColor.rgb, 0.0, 1.0), vec3(1e-5)), vec3(2.2));
    l = uFitGain * pow(l, uFitGamma);
    gl_FragColor.rgb = pow(clamp(l, 0.0, 1.0), vec3(1.0 / 2.2));
  }
}
`;
const MAIN_RE = /void\s+main\s*\(\s*(?:void)?\s*\)/;
const wrap = (src) => (MAIN_RE.test(src) ? src.replace(MAIN_RE, "void fitOrigMain()") + WRAP_TAIL : src);

function patchMaterial(mat, U) {
  if (!mat || mat.userData.fitPatched || mat.isRawShaderMaterial) return false;
  mat.userData.fitPatched = true;
  if (mat.isShaderMaterial) {
    if (!MAIN_RE.test(mat.fragmentShader)) return false;
    mat.fragmentShader = wrap(mat.fragmentShader); Object.assign(mat.uniforms, U);
  } else {
    const prev = mat.onBeforeCompile, key = mat.customProgramCacheKey;
    mat.onBeforeCompile = (sh, r) => { prev?.call(mat, sh, r); Object.assign(sh.uniforms, U); sh.fragmentShader = wrap(sh.fragmentShader); };
    mat.customProgramCacheKey = () => (key ? key.call(mat) : "") + "|fit";
  }
  mat.needsUpdate = true;
  return true;
}

/** GET  assets-hd/battle/built/<pack>.colours.json  -> object, or null when there is none (the normal case). */
export async function loadColourFit(pack) {
  try {
    const r = await fetch(`assets-hd/battle/built/${pack}.colours.json`, { cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.layers ? j : null;
  } catch { return null; }
}

/** scene: the THREE.Scene of the built arena; fit: the loaded file or null; tool: true when tools/fit_built_colours.mjs drives it. */
export function createColourFit(scene, fit, tool = false) {
  const state = new Map();   // id -> { objs: [], U, patched: n }
  const active = !!fit || tool;
  function discover() {
    const seen = new Set();
    scene.traverse((o) => {
      if (!isDrawn(o)) return;
      const id = layerId(o);
      let L = state.get(id);
      if (!L) { L = { id, objs: [], U: { uFitOn: { value: 0 }, uFitGain: { value: new THREE.Vector3(1, 1, 1) }, uFitGamma: { value: new THREE.Vector3(1, 1, 1) } }, patched: 0, applied: false }; state.set(id, L); }
      if (!L.objs.includes(o)) L.objs.push(o);
      seen.add(id);
    });
    for (const [id, L] of state) if (!seen.has(id)) L.objs.length = 0;
  }
  const api = {
    dirty: true, state,
    ids() { return [...state.keys()].filter((k) => state.get(k).objs.length); },
    objects(id) { return state.get(id)?.objs || []; },
    /** discover layers, patch the materials (only when a file or the tool is present), apply the file's values */
    apply() {
      this.dirty = false; discover();
      if (!active) return;
      for (const L of state.values()) {
        for (const o of L.objs) for (const m of [].concat(o.material)) if (patchMaterial(m, L.U)) L.patched++;
        const f = fit?.layers?.[L.id];
        if (f && !L.applied) {
          L.applied = true;
          if (f.gain) L.U.uFitGain.value.set(...f.gain);
          if (f.gamma) L.U.uFitGamma.value.set(...f.gamma);
          L.U.uFitOn.value = f.gain || f.gamma ? 1 : 0;
          if (f.visible === false) for (const o of L.objs) o.visible = false;
        }
      }
    },
    set(id, { gain, gamma, on = 1 }) {
      const L = state.get(id); if (!L) return false;
      if (gain) L.U.uFitGain.value.set(...gain);
      if (gamma) L.U.uFitGamma.value.set(...gamma);
      L.U.uFitOn.value = on ? 1 : 0; return true;
    },
    /** every material of the layer blends additively: a glow / sparkle effect */
    additive(id) { const o = state.get(id)?.objs || []; return o.length > 0 && o.every((x) => [].concat(x.material).every((m) => m.blending === THREE.AdditiveBlending)); },
    setVisible(id, v) { for (const o of state.get(id)?.objs || []) o.visible = !!v; },
    get(id) { const L = state.get(id); return L ? { gain: L.U.uFitGain.value.toArray(), gamma: L.U.uFitGamma.value.toArray(), on: L.U.uFitOn.value, patched: L.patched } : null; },
  };
  return api;
}
