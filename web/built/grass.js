// Grass blades of the BUILT arena (Arena Viewer look=built only). Plan ~/dw3-knowledge/research/PLAN-built-arena.md,
// Step 2. LOOK after al-ro's "Field of grass swaying in the wind" (discourse.threejs.org/t/13965, codepen.io/al-ro/pen/
// GRJzYQK; the same program is in github.com/al-ro/al-ro.github.io projects/grass/grass.js, which carries no licence
// file; CodePen's own rule is "public pens are automatically MIT licensed" - the pen page itself could not be read
// here (Cloudflare check), so no line of either is copied: only the ideas, re-written for our ground and toon light):
//   - each blade TWISTS round its own spine from root to tip (al-ro slerps 90 deg about Y at the root to ~0 at the
//     tip) and CURLS forward along an arc, so it reads as a 3D ribbon from every side;
//   - roots blend into the ground: at the root the blade takes the ground's own albedo (pattern x baked AO, read from
//     the ground material's own mask texture) AND the ground's own normal, so the root shades as the ground does;
//   - translucency when the light is behind the blade (diffuse -N.L plus a forward lobe pow(V.-L, 16), the
//     wikibooks "GLSL Programming/Unity/Translucent Surfaces" model al-ro cites), stronger toward the tip;
//   - wind WAVES rolling over the field: two travelling sine waves along the wind plus a per-blade flutter; the crest
//     also lifts the tips' brightness so the wave reads as a sheen running over the field;
//   - a root-to-tip colour gradient from the recipe palette (ground colour -> grass p10..p90 per blade -> lifted tip).
// Kept from the first Step 2 (structure from GrassField in cortiz2894/stylized-components, github.com/cortiz2894/
// stylized-components, src/components/grassField, MIT, credit: Christian Ortiz (Cortiz), link required by its
// licence): one InstancedMesh, world wind brought into blade space with the transpose of the instance rotation, wind
// phase per blade anchor, opaque, no shadow cast; area-weighted scatter on the recipe's grass triangles (cumulative
// areas + binary search, as three's MeshSurfaceSampler, MIT; that addon is not vendored). New: blades only where the
// ground paints grass (not dirt / path / rock / cliff: the ground material's own mask + slope threshold). Shared
// toonLight + aerial + wind uniforms (web/built/shared.js; uLightDir/uLightColor = whatever lights the scene, sun or moon). Per frame,
// blades under a fighter are capped so a blade's on-screen height <= 3 % of the fighter's on-screen height, from the
// battle renderer's own fighter box (opts.keepOut().fighters[].min/max) and this frame's camera.
//
// VALUES PICKED (not measured), render units (400 = 1 m):
//   COUNT 450000, RADIUS 4000 (camera ring measured 3990), EDGE 0.85, height 55-115, width 9-15, 4 rows + a tip
//   (9 vertices / 7 triangles), half-widths 0.5/0.46/0.38/0.24, curl 0.25-0.75 rad, twist 0.8-1.6 rad,
//   BLADE_N 0.55 (how far the blade's own normal takes over from the ground's), TIP_MIX 0.6, TIP_LIFT 1.15,
//   per-blade albedo mix p10..p90 x 0.6, TRANS 0.45 (diffuse 1.0, forward 1.6, power 16), wave length 1800 / 700
//   units, wave speeds 1.7 / 2.6 rad/s, flutter 0.15, WAVE_LIFT 0.18, wind gain 6, camera fade 6000-8200,
//   fighter ring 2.0, cap safety 0.8, grass mask edge 0.30-0.48.
import * as THREE from "../lib3d/three.module.js";
import * as S from "./shared.js";

export const GRASS = { COUNT: 450000, RADIUS: 4000, EDGE: 0.85, H: [55, 115], W: [9, 15], HW: [0.5, 0.46, 0.38, 0.24],
                       CURL: [0.25, 0.75], TWIST: [0.8, 1.6], BLADE_N: 0.55, TIP_MIX: 0.6, TIP_LIFT: 1.15, VAR: 0.6,
                       TRANS: 0.45, TRANS_D: 1.0, TRANS_F: 1.6, WAVE: [1800, 700], WAVE_SPEED: [1.7, 2.6], FLUTTER: 0.15,
                       WAVE_LIFT: 0.18, WIND_GAIN: 6, FADE: [6000, 8200], RING: 2.0, RULE: 0.03, SAFETY: 0.8,
                       MASK_EDGE: [0.30, 0.48], GREEN_MIN: 0.5, GREEN_FULL: 0.8, DENSITY: 0.01, MIN_COUNT: 4000, SEED: 2002 };

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// one blade, FLAT and unit size: x = signed half-width share, y = height fraction (0 root .. 1 tip). The shader bends
// it (curl along an arc, twist round the spine) after scaling, so the bend keeps its shape whatever the width/height.
export function bladeGeometry() {
  const hw = GRASS.HW, rows = hw.length, pos = [], idx = [];
  for (let k = 0; k < rows; k++) { const y = k / rows; pos.push(-hw[k], y, 0, hw[k], y, 0); }
  pos.push(0, 1, 0);
  for (let k = 0; k < rows - 1; k++) { const a = 2 * k; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  idx.push(2 * rows - 2, 2 * rows - 1, 2 * rows);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return g;
}

// The one place a blade vertex's world position is made (material and the checker's GPU probe both call it).
// aBlade = (curl rad, twist rad, wind phase rad), per blade.
export const GRASS_GLSL = /* glsl */`
  attribute vec3 aBlade;
  uniform vec4 uGrassFighter[2];   // world x, z, foot radius, height cap (world units); cap <= 0: no fighter
  uniform vec3 uGrassEye; uniform vec2 uGrassFade; uniform float uGrassWind, uGrassRing;
  uniform vec2 uGrassWave, uGrassWaveSpeed; uniform float uGrassFlutter;
  float grassHeightScale(vec3 aw, float H) {
    float s = 1.0;
    for (int i = 0; i < 2; i++) {
      vec4 f = uGrassFighter[i]; if (f.w <= 0.0) continue;
      float cap = mix(f.w, H, smoothstep(f.z, f.z * uGrassRing, length(aw.xz - f.xy)));
      s = min(s, cap / H);
    }
    return s * (1.0 - smoothstep(uGrassFade.x, uGrassFade.y, length(aw - uGrassEye)));
  }
  // 0..1: the rolling wave at a blade anchor (two travelling sines along the wind, the second turned 35 deg)
  float grassWave(vec2 a) {
    vec2 d2 = vec2(uWindDir.x * 0.819 - uWindDir.y * 0.574, uWindDir.x * 0.574 + uWindDir.y * 0.819);
    float w1 = sin(dot(a, uWindDir) * 6.2831853 / uGrassWave.x - uWindTime * uGrassWaveSpeed.x);
    float w2 = sin(dot(a, d2) * 6.2831853 / uGrassWave.y - uWindTime * uGrassWaveSpeed.y);
    float w = 0.5 + 0.5 * (0.65 * w1 + 0.35 * w2);
    return w * w;
  }
  // blade-space vertex (before the instance rotation), its normal, the wave; p = flat unit blade vertex
  vec3 grassBladePos(vec3 p, vec3 sc, float hs, vec2 anchor, mat3 R, out vec3 nB, out float wave) {
    float H = sc.y * hs, y = p.y, c = max(aBlade.x, 1e-3), phi = aBlade.y * (1.0 - y);
    // spine: an arc of length H*y bending toward +z by curl c over the whole blade
    vec3 spine = vec3(0.0, sin(c * y), 1.0 - cos(c * y)) * (H / c);
    vec3 T = vec3(0.0, cos(c * y), sin(c * y));
    vec3 D = vec3(cos(phi), 0.0, sin(phi));               // width direction, twisted round the spine
    vec3 v = spine + D * (p.x * sc.x);
    nB = normalize(cross(D, T));
    wave = 0.0;
    if (uWindStrength > 0.0) {
      vec3 wB = transpose(R) * vec3(uWindDir.x, 0.0, uWindDir.y);         // world wind in blade space
      wave = grassWave(anchor);
      float amp = uWindStrength * uGrassWind * (0.25 + 0.75 * wave + uGrassFlutter * sin(uWindTime * uWindFreq * 3.0 + aBlade.z));
      float L = length(v);
      v.xz += wB.xz * amp * H * y * y;                                    // base pinned, tip swings
      if (L > 1e-5) v = normalize(v) * L;                                  // no stretch
    }
    return v;
  }
  vec3 grassWorldPosN(vec3 p, mat4 im, out vec3 nW, out float wave) {
    vec3 sc = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz));
    mat3 R = mat3(im[0].xyz / sc.x, im[1].xyz / sc.y, im[2].xyz / sc.z);   // rotation only
    vec3 aw = (modelMatrix * vec4(im[3].xyz, 1.0)).xyz;
    float hs = grassHeightScale(aw, sc.y * length(modelMatrix[1].xyz));
    vec3 nB; vec3 v = grassBladePos(p, sc, hs, im[3].xz, R, nB, wave);
    nW = normalize(mat3(modelMatrix) * (R * nB));
    return (modelMatrix * vec4(R * v + im[3].xyz, 1.0)).xyz;
  }
  vec3 grassWorldPos(vec3 p, mat4 im) { vec3 n; float w; return grassWorldPosN(p, im, n, w); }
`;

function grassMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({
      uGrassFighter: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uGrassEye: { value: new THREE.Vector3() },
      uGrassFade: { value: new THREE.Vector2(...GRASS.FADE) }, uGrassWind: { value: GRASS.WIND_GAIN }, uGrassRing: { value: GRASS.RING },
      uGrassWave: { value: new THREE.Vector2(...GRASS.WAVE) }, uGrassWaveSpeed: { value: new THREE.Vector2(...GRASS.WAVE_SPEED) },
      uGrassFlutter: { value: GRASS.FLUTTER }, uGrassBladeN: { value: GRASS.BLADE_N },
      uGrassTrans: { value: new THREE.Vector3(GRASS.TRANS, GRASS.TRANS_D, GRASS.TRANS_F) }, uGrassWaveLift: { value: GRASS.WAVE_LIFT },
    }),
    vertexShader: /* glsl */`
      attribute vec3 aRoot, aMid, aTip, aGroundN;
      varying vec3 vW; varying vec3 vN; varying vec3 vGN; varying vec3 vCol; varying float vY; varying float vWave;
      ${S.NOISE_GLSL}
      ${S.WIND_GLSL}
      ${GRASS_GLSL}
      void main() {
        vW = grassWorldPosN(position, instanceMatrix, vN, vWave);
        vGN = normalize(mat3(modelMatrix) * aGroundN);
        vY = position.y;
        // gradient: ground colour at the root -> this blade's palette colour at mid height -> the lifted tip
        vCol = position.y < 0.5 ? mix(aRoot, aMid, smoothstep(0.0, 0.5, position.y)) : mix(aMid, aTip, (position.y - 0.5) * 2.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uGrassBladeN, uGrassWaveLift; uniform vec3 uGrassTrans;
      varying vec3 vW; varying vec3 vN; varying vec3 vGN; varying vec3 vCol; varying float vY; varying float vWave;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        vec3 Nb = normalize(gl_FrontFacing ? vN : -vN);                   // the face toward the eye
        vec3 GN = normalize(vGN);
        // the root shades as the ground does (same albedo, same normal); the blade's own normal takes over upward
        vec3 N = normalize(mix(GN, Nb, uGrassBladeN * smoothstep(0.0, 0.5, vY)));
        vec3 col = toonLight(vCol, N, V, vW, 1.0, 0.0);
        // translucency: light from behind the blade comes through it (diffuse + a forward lobe toward the light)
        float dNL = dot(Nb, uLightDir);                                   // the light now: sun by day, moon by night
        float tr = max(-dNL, 0.0) * uGrassTrans.y + pow(max(dot(-uLightDir, V), 0.0), 16.0) * uGrassTrans.z * step(dNL, 0.0);
        col += vCol * uLightColor * tr * uGrassTrans.x * smoothstep(0.15, 1.0, vY);
        col *= 1.0 + uGrassWaveLift * vWave * vY;                          // the wave's sheen over the tips
        gl_FragColor = vec4(aerial(min(col, vec3(0.97)), vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide, transparent: false,
  });
}

/** Ground colour of the built ground's GRASS step (ground.js groundPaint: mix(uA, uB, smoothstep(.35,.65,fbm3(w*0.0016))))
 *  at a world point, through the shared noise's JS twin. */
export const GROUND_SCALE = 0.0016;
export function groundAlbedo(a, b, p) {
  const t = smooth(0.35, 0.65, S.fbm3JS(p[0] * GROUND_SCALE, p[1] * GROUND_SCALE, p[2] * GROUND_SCALE));
  return [a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t];
}

/** The ground material's own mask texture, read in JS as the GPU reads it (uv = xz / span + 0.5, bilinear, texel
 *  centres at +0.5, clamped). Returns null when the ground has no mask (then every grass triangle grows grass). */
export function groundMaskReader(groundMesh) {
  const u = groundMesh?.material?.uniforms;
  const tex = u?.uMask?.value, data = tex?.image?.data, N = tex?.image?.width;
  if (!data || !N || !u.uMaskSpan) return null;
  const span = u.uMaskSpan.value;
  const at = (i, j) => (Math.max(0, Math.min(N - 1, j)) * N + Math.max(0, Math.min(N - 1, i))) * 4;
  return {
    span, aoAmt: u.uAOAmt?.value ?? 0, cliffLo: u.uCliffLo?.value ?? 1,
    sample(x, z) {
      const uu = (x / span + 0.5) * N - 0.5, vv = (z / span + 0.5) * N - 0.5;
      const i = Math.floor(uu), j = Math.floor(vv), fu = uu - i, fv = vv - j, out = [0, 0, 0, 0];
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      for (let k = 0; k < 4; k++) out[k] = ((data[a + k] * (1 - fu) + data[b + k] * fu) * (1 - fv) + (data[c + k] * (1 - fu) + data[d + k] * fu) * fv) / 255;
      return { dirt: out[0], rock: out[1], path: out[2], ao: out[3] };
    },
  };
}

/** ASSET mod.grass: one blade (bladeGeometry) in the grass shader, instanced. The placement (web/built/place/grass.js)
 *  gives each blade its matrix and its per-instance colours (aRoot / aMid / aTip, aGroundN, aBlade); in any other slot
 *  the blades take neutral constants. Every frame the fighters' height caps and the eye are set from this frame's
 *  camera (slot.data.fighters(): the battle renderer's fighter boxes). */
export function grassAsset(env, slot) {
  const geo = bladeGeometry(), mat = grassMaterial();
  env?.materials?.push(mat);
  const U = mat.uniforms, PV = new THREE.Matrix4(), V4 = new THREE.Vector4();
  const state = { fighters: [] };
  const fightersNow = () => (slot?.default === "mod.grass" && slot.data?.fighters ? slot.data.fighters() : []);
  function update(camera) {
    camera.updateMatrixWorld();
    U.uGrassEye.value.setFromMatrixPosition(camera.matrixWorld);
    PV.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const P5 = camera.projectionMatrix.elements[5];
    const fs = fightersNow().filter((f) => f.min && f.max);
    state.fighters = [];
    for (let i = 0; i < 2; i++) {
      const f = fs[i], out = U.uGrassFighter.value[i];
      if (!f) { out.set(0, 0, 0, 0); continue; }
      const { min: a, max: b } = f;
      let y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k < 8; k++) {   // the box's 8 corners on screen (NDC y)
        V4.set(k & 1 ? b[0] : a[0], k & 2 ? b[1] : a[1], k & 4 ? b[2] : a[2], 1).applyMatrix4(PV);
        const y = V4.y / V4.w; y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      const cx = (a[0] + b[0]) / 2, cz = (a[2] + b[2]) / 2, foot = Math.hypot((b[0] - a[0]) / 2, (b[2] - a[2]) / 2);
      V4.set(cx, a[1], cz, 1).applyMatrix4(camera.matrixWorldInverse);
      const zNear = -V4.z - foot;                       // nearest view depth a blade under the fighter can have
      const cap = zNear > 1 ? GRASS.RULE * GRASS.SAFETY * (y1 - y0) * zNear / P5 : 1e-3;
      out.set(cx, cz, foot, Math.max(cap, 1e-3));
      state.fighters.push({ side: f.side, foot, ndcH: y1 - y0, zNear, cap });
    }
  }
  const one = [0.3, 0.45, 0.2];
  return { geo, mat, frustumCulled: false, onBeforeRender: (renderer, scene, camera) => update(camera), userData: { update, state },
           attrs: { aRoot: [3, one], aMid: [3, [0.35, 0.5, 0.22]], aTip: [3, [0.45, 0.6, 0.28]], aGroundN: [3, [0, 1, 0]], aBlade: [3, [0.3, 0.5, 0]] } };
}
