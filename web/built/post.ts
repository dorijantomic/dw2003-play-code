// LOOK / POST of the BUILT arena (plan Step 5, ~/dw3-knowledge/research/PLAN-built-arena.md).
//
// The viewer draws the built world into one canvas (builtCv, web/arena-built.js) and the Digimon into a
// second, see-through one (off, web/battle3d.js); the page composites them with 2D drawImage. This module
// replaces only what the VISIBLE canvas receives: both canvases are composited in ONE own render target, and
// that target is post-processed and drawn to the visible canvas in a single pass.
//
//   composite   world texel (sRGB -> linear by the GPU, SRGB8_ALPHA8) over which the fighter texel is laid
//               with straight alpha: c = mix(world, fighter.rgb, fighter.a). Same source-over the 2D
//               drawImage did, done in linear light. Goes into `target`, a WebGLRenderTarget with samples: 4.
//   bloom       UnrealBloomPass' own numbers (threshold 1.05, smooth width 0.01, strength 0.28): bright pass
//               (LuminosityHighPassShader, copied from three r186 MIT), 4-level downsample chain at 1/2, 1/4,
//               1/8, 1/16, a 9-tap separable Gaussian per level (the pass' own kernel), summed with the pass'
//               bloom factors. three's addons are not vendored, so the passes are written here in plain three.
//   grade       split tone: a cool multiplicative tint in the shadows, a warm one in the highlights, both
//               weighted by linear luma with masks that are exactly 0 at luma 0.5 (so mid grey is a fixed
//               point of the grade and the tone-map check can run with the grade on).
//   tone map    ACESFilmicToneMapping, three r186's fit (ACESInputMat -> RRTAndODTFit -> ACESOutputMat,
//               exposure / 0.6), applied EXACTLY ONCE for the whole frame, here, after the grade. Nothing else
//               in the chain tone-maps: see TONE_MAP below.
//   dither      8x8 ordered (Bayer) dither of 1/255 amplitude, applied to the sRGB-encoded value just before
//               the 8-bit store, and gated off within 1.2/255 of 0 and 1 so a solid black (0) or white (255)
//               stays exactly 0 or 255. Its mean over an 8x8 block is 0, so solid colours are not lifted.
//   encode      the one sRGB OETF of the chain, also in the final pass (three's <colorspace_fragment> is
//               deliberately not used: this renderer's outputColorSpace is linear).
//
// Nothing here touches the built world's geometry, its canvases, or the battle renderer: builtCv and off keep
// exactly the contents they had, and ?post=0 in the viewer skips this module completely.
import * as THREE from "../lib3d/three.module.js";

// ---------------- the look's numbers (every one of them in one place) ----------------
export const SETTINGS = {
  samples: 4,                                   // MSAA on the composite target (the plan's 4x)
  bloom: {
    threshold: 1.05,                            // UnrealBloomPass default
    smoothWidth: 0.01,                          // LuminosityHighPassShader smoothWidth
    strength: 0.28,
    levels: 4,
    weights: [1.0, 0.8, 0.6, 0.4],              // UnrealBloomPass bloomFactors, first four
  },
  exposure: 1.0,                                // ACES exposure (three's toneMappingExposure)
  // share of the ACES tone map that is applied: 1 = the full chain (every arena by default). The viewer lowers it to 0
  // on an arena whose MEASURED palette is pale (arena-viewer.html: bg luma >= 0.85, meft1008 only): ACES maps the
  // measured pale lavender sky [208,200,232] to [208,204,217] and the lake/background [240,232,248] to [223,219,222],
  // i.e. flat grey, and the saturated clump greens [26,86,20] to [0,78,6] (measured with twin.chain, 2026-10-30).
  toneMix: 1.0,
  grade: {
    shadow: [0.93, 0.98, 1.10],                 // cool shadows: pass on blue, take from red
    highlight: [1.07, 1.01, 0.92],              // warm highlights: the other way round
    amount: 1.0,
  },
  dither: 1 / 255,                              // 1/255 ordered dither
};

// ---------------- GLSL shared by the passes ----------------
const QUAD_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// three r186 src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js, ACESFilmicToneMapping,
// verbatim except that the exposure is passed in (the renderer's uniform is not bound to a ShaderMaterial).
const ACES_GLSL = /* glsl */`
  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 acesFilmic(vec3 color, float exposure) {
    const mat3 ACESInputMat = mat3(
      vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383),
      vec3(0.04823, 0.01566, 0.83777)
    );
    const mat3 ACESOutputMat = mat3(
      vec3( 1.60475, -0.10208, -0.00327), vec3(-0.53108,  1.10813, -0.07276),
      vec3(-0.07367, -0.00605,   1.07602)
    );
    color *= exposure / 0.6;
    color = ACESInputMat * color;
    color = RRTAndODTFit(color);
    color = ACESOutputMat * color;
    return clamp(color, 0.0, 1.0);
  }`;

const SRGB_GLSL = /* glsl */`
  vec3 srgbEncode(vec3 c) {
    return mix(1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, c * 12.92, step(c, vec3(0.0031308)));
  }
  // 8x8 ordered dither in [0, 1): the usual recursive Bayer construction, no lookup table needed.
  float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
  float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
  float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }`;

// ---------------- JS twins (the same maths, for the checks and for CPU work) ----------------
const IN = [[0.59719, 0.35458, 0.04823], [0.07600, 0.90834, 0.01566], [0.02840, 0.13383, 0.83777]];
const OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mul3 = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** three r186 ACESFilmicToneMapping. */
export function acesJS(c, exposure = 1) {
  let v = [c[0] * exposure / 0.6, c[1] * exposure / 0.6, c[2] * exposure / 0.6];
  v = mul3(IN, v);
  v = v.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081));
  v = mul3(OUT, v);
  return v.map(clamp01);
}
/** the sRGB OETF (three r186 SRGBTransfer). */
export function srgbJS(c) {
  return c.map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055));
}
export function bayer8JS(x, y) {
  const b2 = (ax, ay) => { ax = Math.floor(ax); ay = Math.floor(ay); const f = ax * 0.5 + ay * ay * 0.75; return f - Math.floor(f); };
  const b4 = (ax, ay) => b2(ax * 0.5, ay * 0.5) * 0.25 + b2(ax, ay);
  return b4(x * 0.5, y * 0.5) * 0.25 + b2(x, y);
}
/** split tone: cool shadows, warm highlights, both masks 0 at luma 0.5. */
export function splitToneJS(c, g = SETTINGS.grade) {
  const l = lumaOf(c);
  const sh = 1 - smoothstep(0, 0.5, l), hi = smoothstep(0.5, 1, l);
  return c.map((v, k) => v * (sh > 0 ? 1 + (g.shadow[k] - 1) * sh * g.amount : 1) * (hi > 0 ? 1 + (g.highlight[k] - 1) * hi * g.amount : 1));
}
/** the dither stored into 8 bits: gated off within 1.2/255 of 0 and 1 so solid black/white stay exact. */
export function ditherJS(e, x, y, amp = SETTINGS.dither) {
  return e.map((v) => {
    const gate = smoothstep(0, 0.0047, v) * (1 - smoothstep(0.9953, 1.0, v));
    return clamp01(v + (bayer8JS(x, y) - 0.5) * amp * gate);
  });
}
/** The whole chain for one linear colour at one pixel (x, y in gl_FragCoord terms), 0-1 sRGB out. */
export function chainJS(c, x = 0, y = 0, s = SETTINGS) {
  const t = splitToneJS(c, s.grade), a = acesJS(t, s.exposure), m = s.toneMix ?? 1;
  const mapped = m >= 1 ? a : a.map((v, k) => v * m + clamp01(t[k]) * (1 - m));   // toneMix 1 = ACES, 0 = no tone map
  return ditherJS(srgbJS(mapped), x, y, s.dither);
}

// ---------------- the pass sources ----------------
const COMPOSITE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tWorld, tFighter;
  uniform float uWorld;          // 0 when there is no built world canvas
  uniform vec4 uOverride;        // rgb + mode: 0 = the canvases, 1 = flat colour, 2 = a disc
  uniform float uOverrideGrad;   // flat colour: + this * vUv.y (a slow vertical ramp, for the banding check)
  uniform vec3 uSpot;            // disc: radius, edge softness, unused
  varying vec2 vUv;
  void main() {
    // both canvases are sRGB-encoded 8-bit images: the GPU decodes them (SRGB8_ALPHA8) into linear light
    vec3 world = uWorld > 0.5 ? texture2D(tWorld, vUv).rgb : vec3(0.0);
    vec4 f = texture2D(tFighter, vUv);
    // straight alpha, source-over in linear light (the canvas holds straight alpha: premultipliedAlpha false)
    vec3 c = mix(world, f.rgb, clamp(f.a, 0.0, 1.0));
    if (uOverride.a > 1.5) {
      float d = length(vUv - vec2(0.5)) - uSpot.x;
      c = uOverride.rgb * (1.0 - smoothstep(0.0, max(uSpot.y, 1e-4), d));
    } else if (uOverride.a > 0.5) {
      c = uOverride.rgb + uOverrideGrad * vUv.y;
    }
    gl_FragColor = vec4(max(c, vec3(0.0)), 1.0);
  }`;

// three r186 UnrealBloomPass / LuminosityHighPassShader: soft knee of width smoothWidth at the threshold.
const BRIGHT_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform float uThreshold, uSmoothWidth;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    vec3 luma = vec3(0.299, 0.587, 0.114);
    float v = dot(texel.xyz, luma);
    vec4 outputColor = vec4(0.0, 0.0, 0.0, 1.0);
    float alpha = smoothstep(uThreshold, uThreshold + uSmoothWidth, v);
    gl_FragColor = mix(outputColor, texel, alpha);
  }`;

const DOWN_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;           // source texel size
  varying vec2 vUv;
  void main() {
    // 4-tap box: enough for a 1/2, 1/4, 1/8, 1/16 chain that is then blurred at every level
    gl_FragColor = 0.25 * (texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5))
                         + texture2D(tSrc, vUv + uTexel * vec2( 0.5, -0.5))
                         + texture2D(tSrc, vUv + uTexel * vec2(-0.5,  0.5))
                         + texture2D(tSrc, vUv + uTexel * vec2( 0.5,  0.5)));
  }`;

// 9-tap Gaussian, the pass' own weights (sigma ~ 2), separable: uDir picks the axis.
const BLUR_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tSrc;
  uniform vec2 uDir;             // one texel step along the axis being blurred
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tSrc, vUv).rgb * 0.2270270270;
    s += (texture2D(tSrc, vUv + uDir * 1.3846153846).rgb + texture2D(tSrc, vUv - uDir * 1.3846153846).rgb) * 0.3162162162;
    s += (texture2D(tSrc, vUv + uDir * 3.2307692308).rgb + texture2D(tSrc, vUv - uDir * 3.2307692308).rgb) * 0.0702702703;
    gl_FragColor = vec4(s, 1.0);
  }`;

const FINAL_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tColor, tB0, tB1, tB2, tB3;
  uniform vec4 uBloomW;          // weights of the four levels (already normalised)
  uniform float uBloomStrength, uBloomOn, uExposure, uDither, uGrade, uToneMix;
  uniform vec3 uShadowTint, uHighlightTint;
  varying vec2 vUv;
  ${ACES_GLSL}
  ${SRGB_GLSL}
  vec3 splitTone(vec3 c) {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float sh = 1.0 - smoothstep(0.0, 0.5, l);      // 1 at black .. exactly 0 at luma 0.5
    float hi = smoothstep(0.5, 1.0, l);            // exactly 0 at luma 0.5 .. 1 at white
    vec3 t = mix(vec3(1.0), uShadowTint, sh * uGrade);
    t = mix(t, uHighlightTint, hi * uGrade);
    return c * t;
  }
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    if (uBloomOn > 0.5) {
      vec3 b = uBloomW.x * texture2D(tB0, vUv).rgb + uBloomW.y * texture2D(tB1, vUv).rgb
             + uBloomW.z * texture2D(tB2, vUv).rgb + uBloomW.w * texture2D(tB3, vUv).rgb;
      c += b * uBloomStrength;
    }
    c = splitTone(c);
    c = mix(clamp(c, 0.0, 1.0), acesFilmic(c, uExposure), uToneMix);   // the ONE tone map of the frame (uToneMix 1 = ACES)
    vec3 e = srgbEncode(c);                        // the ONE sRGB encode
    // the dither, before the 8-bit store; gated off at the two plateaus so solid black / white stay exact
    vec3 gate = smoothstep(vec3(0.0), vec3(0.0047), e) * (vec3(1.0) - smoothstep(vec3(0.9953), vec3(1.0), e));
    e += (bayer8(gl_FragCoord.xy) - 0.5) * uDither * gate;
    gl_FragColor = vec4(clamp(e, 0.0, 1.0), 1.0);
  }`;

const COPY_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tSrc;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tSrc, vUv); }`;

const EDGE_VERT = /* glsl */`
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const EDGE_FRAG = /* glsl */`
  precision highp float;
  void main() { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); }`;

// ---------------- how many tone maps are there in this chain ----------------
// A tone-map site is a CALL of the ACES fit in a shader that writes the frame; the definition alone is not a
// site. Counted from the sources above so the checker reads a number, not a promise.
function countToneMapSites(sources) {
  let calls = 0, defs = 0;
  for (const s of sources) {
    calls += (s.match(/acesFilmic\s*\(/g) || []).length;
    defs += (s.match(/vec3\s+acesFilmic\s*\(/g) || []).length;
  }
  return { calls, defs, sites: calls - defs };
}

// ---------------- the module ----------------
/**
 * @param {number} width
 * @param {number} height
 * @param {{canvas?: HTMLCanvasElement, settings?: object}} [opts]
 */
export function createPost(width, height, opts = {}) {
  const S = Object.assign({}, SETTINGS, opts.settings || {});
  S.bloom = Object.assign({}, SETTINGS.bloom, opts.settings?.bloom || {});
  S.grade = Object.assign({}, SETTINGS.grade, opts.settings?.grade || {});
  const wSum = S.bloom.weights.reduce((a, b) => a + b, 0);

  const canvas = opts.canvas || document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, premultipliedAlpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  // the one sRGB encode of the chain is in the final shader, and the one tone map too: keep the renderer's
  // own colour pipeline out of the way so neither can happen twice
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;
  renderer.info.autoReset = false;      // count every pass of a frame, not only the last one
  renderer.setClearColor(0x000000, 1);

  const gl = renderer.getContext();

  // ---- the composite target: 4x MSAA ----
  const target = new THREE.WebGLRenderTarget(width, height, {
    samples: S.samples, type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  target.texture.generateMipmaps = false;

  // ---- bloom: one bright level then the downsample chain, each level own blur scratch ----
  const levels = [];
  for (let i = 0; i < S.bloom.levels; i++) {
    const w = Math.max(1, Math.round(width / 2 ** (i + 1))), h = Math.max(1, Math.round(height / 2 ** (i + 1)));
    const mk = () => { const t = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      t.texture.generateMipmaps = false; return t; };
    levels.push({ rt: mk(), tmp: mk(), w, h });
  }

  // ---- one quad, one camera, one scene: every pass is a full-screen triangle pair ----
  const quadGeo = new THREE.BufferGeometry();
  quadGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  quadGeo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const passScene = new THREE.Scene();
  const passCam = new THREE.Camera();
  const passMesh = new THREE.Mesh(quadGeo, null);
  passMesh.frustumCulled = false;
  passScene.add(passMesh);
  const pass = (mat, to) => { passMesh.material = mat; renderer.setRenderTarget(to); renderer.render(passScene, passCam); };

  // ---- UVs and uniforms ----
  const U = {
    uOverride: { value: new THREE.Vector4(0, 0, 0, 0) },      // rgb + mode (0 canvases, 1 flat, 2 disc)
    uOverrideGrad: { value: 0 },
    uSpot: { value: new THREE.Vector3(0.08, 0.01, 0) },
    uBloom: { value: S.bloom.strength },
    uExposure: { value: S.exposure },
    uDither: { value: S.dither },
    uGrade: { value: S.grade.amount },
    uToneMix: { value: S.toneMix },
  };

  const compositeMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({
      tWorld: { value: null }, tFighter: { value: null }, uWorld: { value: 0 },
    }, U),
    vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG,
    depthTest: false, depthWrite: false,
  });
  const brightMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: target.texture }, uThreshold: { value: S.bloom.threshold }, uSmoothWidth: { value: S.bloom.smoothWidth } },
    vertexShader: QUAD_VERT, fragmentShader: BRIGHT_FRAG, depthTest: false, depthWrite: false,
  });
  const downMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: QUAD_VERT, fragmentShader: DOWN_FRAG, depthTest: false, depthWrite: false,
  });
  const blurMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: QUAD_VERT, fragmentShader: BLUR_FRAG, depthTest: false, depthWrite: false,
  });
  const finalMat = new THREE.ShaderMaterial({
    uniforms: {
      tColor: { value: target.texture },
      tB0: { value: levels[0].rt.texture }, tB1: { value: levels[1].rt.texture },
      tB2: { value: levels[2].rt.texture }, tB3: { value: levels[3].rt.texture },
      uBloomW: { value: new THREE.Vector4(...S.bloom.weights.map((w) => w / wSum)) },
      uBloomStrength: U.uBloom, uBloomOn: { value: 1 },
      uExposure: U.uExposure, uDither: U.uDither, uGrade: U.uGrade, uToneMix: U.uToneMix,
      uShadowTint: { value: new THREE.Vector3(...S.grade.shadow) },
      uHighlightTint: { value: new THREE.Vector3(...S.grade.highlight) },
    },
    vertexShader: QUAD_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
  });
  const copyMat = new THREE.ShaderMaterial({
    uniforms: { tSrc: { value: null } }, vertexShader: QUAD_VERT, fragmentShader: COPY_FRAG,
    depthTest: false, depthWrite: false,
  });

  // ---- the two source canvases, as sRGB textures the GPU decodes on sample ----
  let worldTex = null, fighterTex = null;
  const makeTex = (image) => {
    const t = new THREE.CanvasTexture(image);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    return t;
  };
  function setSource(kind, image) {
    const cur = kind === "world" ? worldTex : fighterTex;
    if (cur && cur.image === image) { cur.needsUpdate = true; return cur; }
    cur?.dispose();
    const t = image ? makeTex(image) : null;
    if (kind === "world") { worldTex = t; compositeMat.uniforms.tWorld.value = t; }
    else { fighterTex = t; compositeMat.uniforms.tFighter.value = t; }
    return t;
  }
  // a 1x1 transparent texture so both samplers are always complete
  const emptyTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  emptyTex.needsUpdate = true;
  compositeMat.uniforms.tWorld.value = emptyTex;
  compositeMat.uniforms.tFighter.value = emptyTex;

  const info = { frames: 0, passes: 0, calls: 0, triangles: 0, lastMs: 0 };

  /** Composite both canvases into the MSAA target, bloom, grade, tone map, dither, sRGB -> this.canvas. */
  function render(worldCanvas, fighterCanvas) {
    const t0 = performance.now();
    renderer.info.reset();
    if (worldCanvas) setSource("world", worldCanvas);
    if (fighterCanvas) setSource("fighter", fighterCanvas);
    compositeMat.uniforms.tWorld.value = worldTex || emptyTex;
    compositeMat.uniforms.tFighter.value = fighterTex || emptyTex;
    compositeMat.uniforms.uWorld.value = worldTex ? 1 : 0;

    let passes = 0;
    pass(compositeMat, target); passes++;                       // 4x MSAA: resolved by three at the end of render()

    const bloomOn = U.uBloom.value > 0;
    finalMat.uniforms.uBloomOn.value = bloomOn ? 1 : 0;
    if (bloomOn) {
      pass(brightMat, levels[0].rt); passes++;
      for (let i = 1; i < levels.length; i++) {
        downMat.uniforms.tSrc.value = levels[i - 1].rt.texture;
        downMat.uniforms.uTexel.value.set(1 / levels[i - 1].w, 1 / levels[i - 1].h);
        pass(downMat, levels[i].rt); passes++;
      }
      for (const L of levels) {                                  // separable 9-tap Gaussian per level
        blurMat.uniforms.tSrc.value = L.rt.texture;
        blurMat.uniforms.uDir.value.set(1 / L.w, 0);
        pass(blurMat, L.tmp); passes++;
        blurMat.uniforms.tSrc.value = L.tmp.texture;
        blurMat.uniforms.uDir.value.set(0, 1 / L.h);
        pass(blurMat, L.rt); passes++;
      }
    }
    pass(finalMat, null); passes++;

    info.frames++; info.passes = passes;
    info.calls = renderer.info.render.calls;
    info.triangles = renderer.info.render.triangles;
    info.lastMs = performance.now() - t0;
    return info;
  }

  // ---- readback helpers (checks only: they cost a copy + a GPU sync) ----
  // Note for whoever reads these numbers: the viewer's source canvases are not bit-stable frame to frame on this
  // GPU (a handful of sky texels flip 1/255 between two renders of the same camera), so a check that compares two
  // frames must feed BOTH renders the same pixels; readBloom() reports an exact non-zero texel count so "empty"
  // is never a rounded max.
  const scratch = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, format: THREE.RGBAFormat,
    depthBuffer: false, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  scratch.texture.generateMipmaps = false;
  /** Copy a render target into a float target and read it back (works for HalfFloat targets too). */
  function readRT(rt, rw = rt.width, rh = rt.height) {
    copyMat.uniforms.tSrc.value = rt.texture;
    const s = (rw === scratch.width && rh === scratch.height) ? scratch : new THREE.WebGLRenderTarget(rw, rh, {
      type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
    pass(copyMat, s);
    const px = new Float32Array(rw * rh * 4);
    renderer.readRenderTargetPixels(s, 0, 0, rw, rh, px);
    renderer.setRenderTarget(null);
    if (s !== scratch) s.dispose();
    return px;
  }

  // ---- MSAA probe: a high-contrast diagonal edge into a target with `samples` samples ----
  const edgeScene = new THREE.Scene();
  const edgeMesh = new THREE.Mesh(quadGeo, new THREE.ShaderMaterial({
    vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG, depthTest: false, depthWrite: false,
  }));
  edgeMesh.frustumCulled = false;
  edgeScene.add(edgeMesh);
  const edgeGeo = new THREE.BufferGeometry();
  // (u,v) = (-1,-1), (1,1), (-1,1): a right triangle whose hypotenuse runs corner to corner at 45 deg
  edgeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  edgeMesh.geometry = edgeGeo;

  /**
   * Render the diagonal into `rt` (the real target by default) and count the pixels the rasterizer blended:
   * 0 with no MSAA, three per diagonal pixel with 4 samples.
   */
  function probeEdge(samples = target.samples) {
    const own = !(samples === target.samples);
    const rt = own ? new THREE.WebGLRenderTarget(width, height, {
      samples, type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false,
    }) : target;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(edgeScene, passCam);
    const px = readRT(rt);
    if (own) rt.dispose();
    let mid = 0, dark = 0, light = 0;
    const seen = new Map();
    for (let i = 0; i < px.length; i += 4) {
      const v = px[i];
      if (v <= 0.02) { dark++; continue; }
      if (v >= 0.98) { light++; continue; }
      mid++;
      const k = Math.round(v * 16) / 16;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    const vals = [...seen.entries()].sort((a, b) => a[0] - b[0]);
    return { samples: rt.samples, width, height, dark, light, intermediate: mid, levels: vals.map(([k, n]) => [k, n]) };
  }

  /** One bloom level, read back (checks only): its size and its pixels. */
  function readLevel(i) {
    const L = levels[i];
    return { w: L.w, h: L.h, px: readRT(L.rt, L.w, L.h) };
  }

  /**
   * The four bloom levels, read back: max and mean of the summed (weighted) bloom, plus level 0's max, plus how
   * many of the texels are non-zero AT ALL (an exact count, so "the bright pass is empty" is not a rounded max).
   */
  function readBloom() {
    if (U.uBloom.value <= 0) return { max: 0, mean: 0, l0max: 0, nonzero: 0, texels: 0 };
    let max = 0, sum = 0, n = 0, l0max = 0, nonzero = 0;
    for (let i = 0; i < levels.length; i++) {
      const L = levels[i], px = readRT(L.rt, L.w, L.h), w = S.bloom.weights[i] / wSum;
      for (let k = 0; k < px.length; k += 4) {
        const v = (px[k] + px[k + 1] + px[k + 2]) / 3;
        if (px[k] !== 0 || px[k + 1] !== 0 || px[k + 2] !== 0) nonzero++;
        if (i === 0) l0max = Math.max(l0max, v);
        const wv = v * w; max = Math.max(max, wv); sum += wv; n++;
      }
    }
    return { max, mean: sum / n, l0max, nonzero, texels: n };
  }

  const toneMap = countToneMapSites([COMPOSITE_FRAG, BRIGHT_FRAG, DOWN_FRAG, BLUR_FRAG, FINAL_FRAG, COPY_FRAG]);

  function dispose() {
    target.dispose(); scratch.dispose();
    for (const L of levels) { L.rt.dispose(); L.tmp.dispose(); }
    for (const m of [compositeMat, brightMat, downMat, blurMat, finalMat, copyMat, edgeMesh.material]) m.dispose();
    quadGeo.dispose(); edgeGeo.dispose();
    worldTex?.dispose(); fighterTex?.dispose(); emptyTex.dispose();
    renderer.dispose();
  }

  return {
    canvas, renderer, gl, target, info, U, settings: S, toneMap, dispose,
    render, readRT, readLevel, readBloom, probeEdge, setSource,
    levels: levels.map((L) => ({ w: L.w, h: L.h })),
    twin: { aces: acesJS, srgb: srgbJS, splitTone: splitToneJS, dither: ditherJS, chain: chainJS, bayer8: bayer8JS },
    // what the checker asserts about the target: it IS a multisampled target, not a promise
    samples: target.samples,
    materials: [compositeMat, brightMat, downMat, blurMat, finalMat, copyMat],
  };
}
