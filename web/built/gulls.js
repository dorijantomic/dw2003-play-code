// Seagulls of the BUILT arena (Arena Viewer look=built only; recipe kind "gulls", e.g. meft1002 floor_07).
// ASSET ONLY (geometry, material, flap shader, buildGulls from slot data); the placement below is done by
// web/built/place/gulls.js (slot gulls.flock: the records, orbit motion and keep-out).
// WHERE: one gull per PICTURE COPY of each upright card of the piece (the recipe's `cards`, measured from the arena's
// own triangles by tools/arena_built_recipe.py: on meft1002 14 triangles = 7 quads of 24x16 texels, and each quad
// carries `copies: 2` — its picture is tiled twice across the card's width, so each card holds TWO birds, each one
// picture wide = half the card). A gull therefore spans 0.96 x (card width / copies) and sits at its own copy's
// centre on the card: offset ((k + 0.5) / copies - 0.5) x card width along the card's own `dir`, so 7 cards = 14 gulls.
// Each gull keeps its own copy centre's distance from the fight centre exactly and glides slowly round the arena on
// that circle, bobbing inside its card's own height range (so it never leaves the measured distance and height band).
// LOOK: a small white gull: spindle body + tail + two wings with the gull's "M" bend (inner panel up, outer panel
// down), one InstancedMesh, one draw call. Flap and glide are done in the vertex shader (GULL_GLSL): a slow per-gull
// envelope switches between gliding (wings held in the M) and flapping bursts. Idea from three.js's
// webgl_gpgpu_birds example (MIT, (c) three.js authors: bird = body + two wing triangles, wing tips moved by
// sin(phase) in the vertex shader); written anew here with an elbow so the wing folds as an M. No code copied.
// Toon-shaded with the shared light (shared.js toonLight: sun by day, moon by night) and the shared aerial haze.
// Colours from the piece's measured colours: white = p90, shade (underside, lower body) = the lavender bucket
// ("green": g > r), wing tips = p10 (dark), beak = colours.accent if the recipe has one, else ACCENT_FALLBACK.
// KEEP-OUT: a gull's whole orbit (every 6 deg, the bob range in one sphere) is tested against the fight radius and
// every view cone (ctx.keepOut.reject, the trees' test) whenever the keep-out changes; a gull that fails is hidden.
// A quick bound skips the exact test when the orbit lies wholly outside every eye ring and fighter.
//
// VALUES PICKED (not measured), gull object units (1 = half the wing span):
//   SPAN_K 0.96 (span = 0.96 x the copy width = 0.96 x card width / copies: the picture's shape fills 23 of its 24
//   texel columns), wing root 0.06, elbow 0.42, glide angles inner +0.28 rad / outer -0.62 rad (relative), flap
//   amplitude inner 0.55 / outer 0.35 rad, outer lag 0.9 rad, flap 2.4 Hz, breathing 0.04 rad at 1.3 rad/s, envelope
//   = smoothstep 0.45..0.75 of a slow sine at 0.35-0.6 rad/s (flapping about 30 % of the time), orbit 0.018-0.03
//   rad/s counter-clockwise seen from above, bank 0.14 rad into the turn, bob 0.25-0.4 rad/s with 0.8 x the free
//   room in the card, wing tip dark beyond 0.86, beak beyond z 0.24.
import * as THREE from "../lib3d/three.module.js";
import * as S0 from "./shared.js";

export const GULL = {
  SPAN_K: 0.96, ROOT: 0.06, ELBOW: 0.42, A1: 0.28, A2: -0.62, F1: 0.55, F2: 0.35, LAG: 0.9, FLAP_HZ: 2.4,
  BREATHE: 0.04, BREATHE_W: 1.3, ENV: [0.45, 0.75], ENV_W: [0.35, 0.6], ORBIT_W: [0.018, 0.03], BANK: 0.14,
  BOB_W: [0.25, 0.4], BOB_K: 0.8, TIP: 0.86, BEAK_Z: 0.24, ORBIT_STEP_DEG: 6, SEED: 1002,
  ACCENT_FALLBACK: [248, 232, 136],   // measured on meft1002's floor_07 picture (its 2 yellow texels of 68)
};

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// one gull, unit half span, forward +Z, up +Y, span along X. aSeg: 0 body/tail, 1 inner wing, 2 outer wing.
export function gullGeometry() {
  const pos = [], seg = [];
  const tri = (a, b, c, s) => { pos.push(...a, ...b, ...c); seg.push(s, s, s); };
  const nose = [0, 0, 0.30], tail = [0, 0.01, -0.30];
  const R = [0.065, 0, 0.04], L = [-0.065, 0, 0.04], Up = [0, 0.055, 0.04], Dn = [0, -0.05, 0.04];
  tri(nose, R, Up, 0); tri(nose, Up, L, 0); tri(nose, L, Dn, 0); tri(nose, Dn, R, 0);
  tri(tail, Up, R, 0); tri(tail, L, Up, 0); tri(tail, Dn, L, 0); tri(tail, R, Dn, 0);
  tri([0, 0, -0.20], [0.09, 0, -0.40], [-0.09, 0, -0.40], 0);
  const { ROOT, ELBOW } = GULL;
  for (const sx of [1, -1]) {
    const v = (x, z) => [sx * x, 0, z];
    tri(v(ROOT, 0.12), v(ROOT, -0.12), v(ELBOW, 0.10), 1);
    tri(v(ELBOW, 0.10), v(ROOT, -0.12), v(ELBOW, -0.10), 1);
    tri(v(ELBOW, 0.10), v(ELBOW, -0.10), v(1.0, -0.14), 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("aSeg", new THREE.BufferAttribute(new Float32Array(seg), 1));
  g.computeVertexNormals();   // body faces; the wings' normals are made in the shader
  return g;
}

// The one place a gull vertex's flapped position is made (material and the checker's GPU probe both call it).
// g = per-gull (flap phase, envelope phase, envelope speed), t seconds.
const f = (x) => x.toFixed(4);
export const GULL_GLSL = /* glsl */`
  vec2 gullAngles(vec3 g, float t) {
    float env = smoothstep(${f(GULL.ENV[0])}, ${f(GULL.ENV[1])}, 0.5 + 0.5 * sin(t * g.z + g.y));
    float w = ${f(GULL.FLAP_HZ * 2 * Math.PI)};
    float a1 = ${f(GULL.A1)} + env * ${f(GULL.F1)} * sin(t * w + g.x) + ${f(GULL.BREATHE)} * sin(t * ${f(GULL.BREATHE_W)} + g.x);
    float a2 = ${f(GULL.A2)} + env * ${f(GULL.F2)} * sin(t * w + g.x - ${f(GULL.LAG)});
    return vec2(a1, a2);
  }
  vec3 gullFlap(vec3 p, float seg, vec3 g, float t, inout vec3 n) {
    if (seg < 0.5) return p;
    vec2 a = gullAngles(g, t);
    float side = p.x < 0.0 ? -1.0 : 1.0, d = abs(p.x);
    float q = clamp(d - ${f(GULL.ROOT)}, 0.0, ${f(GULL.ELBOW - GULL.ROOT)});
    float x = ${f(GULL.ROOT)} + q * cos(a.x), y = q * sin(a.x);
    float o = max(d - ${f(GULL.ELBOW)}, 0.0);
    x += o * cos(a.x + a.y); y += o * sin(a.x + a.y);
    float ang = seg < 1.5 ? a.x : a.x + a.y;
    n = vec3(-side * sin(ang), cos(ang), 0.0);
    return vec3(side * x, p.y + y, p.z);
  }
`;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** JS twin of gullFlap (position only), for the bob room and the checker. */
export function gullFlapJS(p, seg, g, t) {
  if (seg < 0.5) return [...p];
  const env = smooth(GULL.ENV[0], GULL.ENV[1], 0.5 + 0.5 * Math.sin(t * g[2] + g[1])), w = GULL.FLAP_HZ * 2 * Math.PI;
  const a1 = GULL.A1 + env * GULL.F1 * Math.sin(t * w + g[0]) + GULL.BREATHE * Math.sin(t * GULL.BREATHE_W + g[0]);
  const a2 = GULL.A2 + env * GULL.F2 * Math.sin(t * w + g[0] - GULL.LAG);
  const side = p[0] < 0 ? -1 : 1, d = Math.abs(p[0]);
  const q = Math.min(Math.max(d - GULL.ROOT, 0), GULL.ELBOW - GULL.ROOT), o = Math.max(d - GULL.ELBOW, 0);
  const x = GULL.ROOT + q * Math.cos(a1) + o * Math.cos(a1 + a2), y = q * Math.sin(a1) + o * Math.sin(a1 + a2);
  return [side * x, p[1] + y, p[2]];
}

// the most a gull reaches above / below its centre (object units), over every flap state, with the bank roll
export function verticalReach() {
  let up = 0.06, dn = 0.06;   // the body
  const s = Math.sin(GULL.BANK), c = Math.cos(GULL.BANK);
  for (let e = 0; e <= 1; e += 0.25) for (let k = 0; k < 64; k++) for (const x of [GULL.ELBOW, 1, -GULL.ELBOW, -1]) {
    // env forced to e: pick the envelope phase so smooth(...) = e is not needed; bound with the extreme angles
    const ph = k / 64 * 2 * Math.PI;
    const a1 = GULL.A1 + e * GULL.F1 * Math.sin(ph) + GULL.BREATHE, a1b = a1 - 2 * GULL.BREATHE;
    for (const A of [a1, a1b]) {
      const a2 = GULL.A2 + e * GULL.F2 * Math.sin(ph - GULL.LAG), d = Math.abs(x), side = Math.sign(x);
      const q = Math.min(Math.max(d - GULL.ROOT, 0), GULL.ELBOW - GULL.ROOT), o = Math.max(d - GULL.ELBOW, 0);
      const px = side * (GULL.ROOT + q * Math.cos(A) + o * Math.cos(A + a2)), py = q * Math.sin(A) + o * Math.sin(A + a2);
      const y = px * s + py * c;   // roll by the bank, either way
      const y2 = -px * s + py * c;
      up = Math.max(up, y, y2); dn = Math.max(dn, -y, -y2);
    }
  }
  return { up, dn };
}

export function gullMaterial(S, col) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({ uGullTime: { value: 0 }, uWhite: { value: col.white }, uShade: { value: col.shade },
      uTip: { value: col.tip }, uBeak: { value: col.beak } }),
    vertexShader: /* glsl */`
      attribute float aSeg; attribute vec3 aGull;
      uniform float uGullTime;
      varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying float vSeg;
      ${GULL_GLSL}
      void main() {
        mat4 im = mat4(1.0);
        #ifdef USE_INSTANCING
          im = instanceMatrix;
        #endif
        vec3 n = normal;
        vec3 p = gullFlap(position, aSeg, aGull, uGullTime, n);
        vec4 w = modelMatrix * im * vec4(p, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * mat3(im) * n); vObj = position; vSeg = aSeg;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uWhite, uShade, uTip, uBeak;
      varying vec3 vW; varying vec3 vN; varying vec3 vObj; varying float vSeg;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        vec3 V = normalize(cameraPosition - vW), N = normalize(vN);
        bool under = dot(N, V) < 0.0;
        if (under) N = -N;                        // double sided: shade the side we see
        vec3 base = uWhite;
        if (vSeg > 0.5) {
          if (under) base = uShade;               // wing undersides in the lavender shade colour
          if (abs(vObj.x) > ${f(GULL.TIP)}) base = uTip;
        } else {
          if (vObj.y < -0.005) base = uShade;
          if (vObj.z > ${f(GULL.BEAK_Z)}) base = uBeak;
        }
        vec3 col = toonLight(base, N, V, vW, 1.0, 0.5);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, transparent: false,
  });
}

/** the default asset of the slot gulls.flock: the flock drawn from the slot's gull records (web/built/place/gulls.js).
 *  Returns { objects, meshes, place, update, info, ... }. */
export function buildGulls(slot, env) {
  const S = env.S || S0;
  const D = slot.data, gulls = D.gulls, c0 = D.colours, reach = D.reach, cards = { length: D.cards }, cardCopies = D.cardCopies;
  const col = { white: S.srgb(c0.p90 || [247, 245, 250]), shade: S.srgb(c0.green || [196, 200, 241]),
                tip: S.srgb(c0.p10 || [15, 19, 29]), beak: S.srgb(c0.accent || GULL.ACCENT_FALLBACK) };
  const n = gulls.length;
  const geo = gullGeometry();
  const ga = new Float32Array(n * 3); gulls.forEach((q, i) => ga.set(q.g, i * 3));
  geo.setAttribute("aGull", new THREE.InstancedBufferAttribute(ga, 3));
  const mat = gullMaterial(S, col); env.materials?.push(mat);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = "builtGulls"; mesh.userData.kind = "gulls"; mesh.frustumCulled = false;   // they move: no stale bounds

  const M = new THREE.Matrix4(), Qy = new THREE.Quaternion(), Qr = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  Qr.setFromAxisAngle(Z, -GULL.BANK);   // +X (the inner wing) dips toward the centre
  const at = D.at;   // where gull q is at time t (s): the placement's orbit; the same numbers set the instance matrix
  let tNow = 0;
  function setTime(t) {
    tNow = t; mat.uniforms.uGullTime.value = t;
    for (const q of gulls) {
      const a = at(q, t);
      Qy.setFromAxisAngle(Y, a.yaw).multiply(Qr);
      const s = q.hidden ? 0 : q.hs;
      M.compose(P.set(...a.c), Qy, Sc.set(s, s, s));
      mesh.setMatrixAt(q.i, M);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  // the placement's keep-out (slot.place) has set q.hidden: draw it
  function place() {
    info.shown = gulls.filter((q) => !q.hidden).length; info.exactTests = D.keep.exactTests; info.hiddenWhy = D.keep.hiddenWhy;
    setTime(tNow);
  }
  const info = {
    count: n, shown: n, cards: cards.length, cardCopies,
    trisPerGull: geo.attributes.position.count / 3, reach,
    band: D.band,
    gulls: gulls.map((q) => ({ card: q.card, copy: q.copy, copies: q.copies, cw: +q.cw.toFixed(1), R: +q.R.toFixed(1),
                               yc: +q.yc.toFixed(1), y: [q.y0, +q.y1.toFixed(1)], hs: +q.hs.toFixed(1), bob: +q.bob.toFixed(1), w: +q.w.toFixed(4) })),
    values: GULL,
  };
  env.info && (env.info.gulls = info);
  setTime(0);
  place();
  const api = {
    objects: [mesh], meshes: [mesh], info, place,
    update(camera, timeMs) { setTime((timeMs ?? performance.now()) / 1000); },
    setTime, at: (i, t) => at(gulls[i], t), gulls, geo, mesh, GULL_GLSL,
  };
  mesh.userData.gulls = api;   // for the checker
  return api;
}
