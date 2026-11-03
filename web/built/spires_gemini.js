// GEMINI SPIRE option of the built spires layer (web/built/spires.js). OFF by default: spires.js builds this lazily
// the first time `setGemini(true)` is called (tuning panel > Spires > "gemini spires"), then hides its own rock,
// bushes and cards and shows these instead. Nothing here is built, and nothing changes, while it is off.
//
// ROCK   ported from the user's Gemini reference (spire-ref/gemini_spire.html, r128 -> r186): the same simplex fbm
//        noise, the same pale lavender limestone canvas texture (vertical stripes, grain, cavities, used as colour
//        AND bump), the same high-poly CylinderGeometry spire (48 radial x 80 height segments, flutes + crags,
//        needle taper, slight curve). Four variants (flutes 6..9) are built ONCE and instanced for every pillar of the
//        palisade (front row full detail, a back row of 24 x 40 versions fills the gaps between spires).
//        Bump is done in the shader from the texture luma (screen-space derivatives), lighting by the shared
//        toonLight/aerial like every other built layer.
// SHRUBS the reference's crossed canvas cards are NOT ported. Recipe of spire-ref/shrub-online.md (instanced leaf
//        quads, clumps grown from the rock's own summit / crevice anchors, clump-centre normals, outer-AO, back-light
//        translucency, alphaTest leaf atlas, one InstancedMesh per wall panel so frustum culling works).
//        No wind yet (recipe item 6 not done).
import * as THREE from "../lib3d/three.module.js";

// ---------------------------------------------------------------- 1. simplex noise (verbatim algorithm of the reference)
const F3 = 1 / 3, G3 = 1 / 6;
class SimplexNoise {
  constructor(seed = 5555) {
    this.p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) this.p[i] = i;
    for (let i = 255; i > 0; i--) {
      const n = Math.floor((seed = (seed * 16807) % 2147483647) / 2147483647 * (i + 1));
      [this.p[i], this.p[n]] = [this.p[n], this.p[i]];
    }
    this.perm = new Uint8Array(512); this.permMod12 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) { this.perm[i] = this.p[i & 255]; this.permMod12[i] = this.perm[i] % 12; }
    this.grad3 = new Float32Array([1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1]);
  }
  noise3D(xin, yin, zin) {
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3;
    const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3;
    const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=1; k2=0; }
      else if (x0 >= z0) { i1=1; j1=0; k1=0; i2=1; j2=0; k2=1; }
      else { i1=0; j1=0; k1=1; i2=1; j2=0; k2=1; }
    } else {
      if (y0 < z0) { i1=0; j1=0; k1=1; i2=0; j2=1; k2=1; }
      else if (x0 < z0) { i1=0; j1=1; k1=0; i2=0; j2=1; k2=1; }
      else { i1=0; j1=1; k1=0; i2=1; j2=1; k2=0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255, g = this.grad3, pm = this.permMod12, pr = this.perm;
    let t0 = 0.6 - x0*x0 - y0*y0 - z0*z0;
    if (t0 < 0) n0 = 0; else { const a = pm[ii + pr[jj + pr[kk]]] * 3; t0 *= t0; n0 = t0 * t0 * (g[a]*x0 + g[a+1]*y0 + g[a+2]*z0); }
    let t1 = 0.6 - x1*x1 - y1*y1 - z1*z1;
    if (t1 < 0) n1 = 0; else { const a = pm[ii + i1 + pr[jj + j1 + pr[kk + k1]]] * 3; t1 *= t1; n1 = t1 * t1 * (g[a]*x1 + g[a+1]*y1 + g[a+2]*z1); }
    let t2 = 0.6 - x2*x2 - y2*y2 - z2*z2;
    if (t2 < 0) n2 = 0; else { const a = pm[ii + i2 + pr[jj + j2 + pr[kk + k2]]] * 3; t2 *= t2; n2 = t2 * t2 * (g[a]*x2 + g[a+1]*y2 + g[a+2]*z2); }
    let t3 = 0.6 - x3*x3 - y3*y3 - z3*z3;
    if (t3 < 0) n3 = 0; else { const a = pm[ii + 1 + pr[jj + 1 + pr[kk + 1]]] * 3; t3 *= t3; n3 = t3 * t3 * (g[a]*x3 + g[a+1]*y3 + g[a+2]*z3); }
    return 32 * (n0 + n1 + n2 + n3);
  }
  fbm(x, y, z, octaves = 4) {
    let sum = 0, amp = 1, freq = 1;
    for (let i = 0; i < octaves; i++) { sum += amp * this.noise3D(x * freq, y * freq, z * freq); freq *= 2.05; amp *= 0.5; }
    return sum;
  }
}
const noise = new SimplexNoise(777);

const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

// ---------------------------------------------------------------- 2. limestone texture (the reference's, 1024 canvas)
function createRockTexture(size = 1024) {
  const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#dbd6e8"; ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size), d = img.data, k = 1024 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const idx = (y * size + x) * 4, X = x * k, Y = y * k;
    const val = Math.sin(X * 0.09) * 16 + noise.fbm(X * 0.018, Y * 0.005, 0.1, 4) * 26 + (noise.fbm(X * 0.05, Y * 0.05, 2.5, 2) < -0.3 ? -35 : 0);
    d[idx] = Math.min(255, Math.max(0, d[idx] + val));
    d[idx + 1] = Math.min(255, Math.max(0, d[idx + 1] + val * 0.95));
    d[idx + 2] = Math.min(255, Math.max(0, d[idx + 2] + val * 1.08));
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// ---------------------------------------------------------------- 3. the fluted spire (reference geometry, base at y 0)
function createSpire(height, radiusBottom, flutes, segR, segH, seed) {
  const geo = new THREE.CylinderGeometry(0.12, radiusBottom, height, segR, segH, true);
  const pos = geo.attributes.position, n = pos.count;
  const ao = new Float32Array(n), rnd = mulberry(seed);
  const summit = [], crevice = [];
  let rSum = 0, rCnt = 0;
  for (let i = 0; i < n; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const normY = (y + height / 2) / height;
    const angle = Math.atan2(z, x);
    const fluteShape = Math.abs(Math.sin(angle * (flutes / 2))) * 1.45;
    const crags = noise.fbm(x * 0.14, y * 0.06, z * 0.14, 3) * 1.1;
    const taper = Math.pow(1 - normY, 0.45);
    const disp = (fluteShape + crags) * taper;
    x += Math.cos(angle) * disp; z += Math.sin(angle) * disp;
    x += Math.sin(normY * Math.PI) * 0.6;
    y += height / 2;                                   // base at 0
    pos.setXYZ(i, x, y, z);
    ao[i] = Math.min(1, Math.max(0, 0.42 + 0.58 * (fluteShape / 1.45) + crags * 0.12));   // dark in the flute valleys
    if (normY < 0.02) { rSum += Math.hypot(x, z); rCnt++; }
    if (normY > 0.84 && normY < 0.94 && rnd() < 0.09) summit.push({ p: [x, y, z], n: [0.15, 1, 0.1] });
    if (normY > 0.35 && normY < 0.78 && fluteShape > 0.95 && rnd() < 0.04)
      crevice.push({ p: [x, y, z], n: new THREE.Vector3(Math.cos(angle), 0.35, Math.sin(angle)).normalize().toArray() });
  }
  geo.computeVertexNormals();
  const nor = geo.attributes.normal, rowLen = segR + 1;       // weld the seam normals (vertex 0 and vertex segR of each ring)
  for (let r = 0; r <= segH; r++) {
    const a = r * rowLen, b = a + segR;
    const x = nor.getX(a) + nor.getX(b), y = nor.getY(a) + nor.getY(b), z = nor.getZ(a) + nor.getZ(b), L = Math.hypot(x, y, z) || 1;
    nor.setXYZ(a, x / L, y / L, z / L); nor.setXYZ(b, x / L, y / L, z / L);
  }
  geo.setAttribute("aAO", new THREE.BufferAttribute(ao, 1));
  geo.userData = { height, rMean: rSum / Math.max(1, rCnt), tris: geo.index.count / 3, verts: n, summit, crevice };
  return geo;
}

// ---------------------------------------------------------------- 4. materials
function rockMaterial(S, tex) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({ uMap: { value: tex }, uBump: { value: 26 }, uTexRep: { value: 1 } }),
    vertexShader: /* glsl */`
      attribute float aAO;
      varying vec3 vW, vN; varying vec2 vUv; varying float vAO, vY; varying vec3 vTone;
      void main() {
        mat4 im = instanceMatrix;
        vec4 w = modelMatrix * im * vec4(position, 1.0);
        vW = w.xyz;
        mat3 m = mat3(modelMatrix) * mat3(im);
        vN = normalize(transpose(inverse(m)) * normal);
        vUv = uv; vAO = aAO; vY = uv.y;
        vTone = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vTone = instanceColor;
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform float uBump, uTexRep;
      varying vec3 vW, vN; varying vec2 vUv; varying float vAO, vY; varying vec3 vTone;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        vec2 uv = vec2(vUv.x * uTexRep, vUv.y);
        vec3 tex = texture2D(uMap, uv).rgb;
        float h = dot(tex, vec3(0.333));
        vec3 N = normalize(vN);
        vec3 dpx = dFdx(vW), dpy = dFdy(vW);
        float hx = dFdx(h), hy = dFdy(h);
        vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
        float det = dot(dpx, r1);
        vec3 grad = sign(det) * (hx * r1 + hy * r2);
        N = normalize(abs(det) * N - uBump * grad);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vW);
        float ao = vAO * mix(0.5, 1.0, smoothstep(0.0, 0.22, vY));
        vec3 base = tex * vTone * mix(0.38, 1.0, ao);
        vec3 col = toonLight(base, N, V, vW, 1.0, 0.1);
        gl_FragColor = vec4(aerial(col, vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

function drawLeafAtlas() {          // 2 x 2 cells, each one pointed leaf with a midrib; grey (tinted per instance), alpha cut-out
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const x = c.getContext("2d"), rnd = mulberry(5);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * 64, oy = Math.floor(cell / 2) * 64;
    x.save(); x.translate(ox + 32, oy + 32); x.rotate((rnd() - 0.5) * 0.5);
    const wd = 12 + rnd() * 6, ln = 27 + rnd() * 3;
    x.beginPath(); x.moveTo(0, ln); x.quadraticCurveTo(wd, ln * 0.2, 0, -ln); x.quadraticCurveTo(-wd, ln * 0.2, 0, ln); x.closePath();
    x.fillStyle = "#d8d8d8"; x.fill();
    x.strokeStyle = "#ffffff"; x.lineWidth = 2; x.beginPath(); x.moveTo(0, ln); x.lineTo(0, -ln * 0.8); x.stroke();
    x.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; t.anisotropy = 2;
  return t;
}

function shrubMaterial(S, tex) {
  return new THREE.ShaderMaterial({
    uniforms: S.uniformsWith({ uLeafTex: { value: tex }, uAlpha: { value: 0.5 }, uTrans: { value: 0.55 }, uNormMix: { value: 0.8 } }),
    vertexShader: /* glsl */`
      attribute vec3 aClump; attribute float aAO, aCell;
      uniform float uNormMix;
      varying vec3 vW, vN, vCol; varying vec2 vUv; varying float vAO;
      void main() {
        mat4 im = instanceMatrix;
        vec4 w = modelMatrix * im * vec4(position, 1.0);
        vW = w.xyz;
        vec3 cardN = normalize(mat3(modelMatrix) * mat3(im) * normal);
        vec3 clumpN = normalize(w.xyz - (modelMatrix * vec4(aClump, 1.0)).xyz);
        vec3 n = normalize(mix(cardN, clumpN, uNormMix));
        vN = normalize(n + vec3(0.0, 0.25, 0.0));
        vCol = vec3(1.0);
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #endif
        vAO = aAO;
        vUv = (uv + vec2(mod(aCell, 2.0), floor(aCell / 2.0))) * 0.5;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uLeafTex; uniform float uAlpha, uTrans;
      varying vec3 vW, vN, vCol; varying vec2 vUv; varying float vAO;
      ${S.NOISE_GLSL}
      ${S.LIGHT_GLSL}
      void main() {
        vec4 t = texture2D(uLeafTex, vUv);
        vec2 tu = vUv * vec2(textureSize(uLeafTex, 0));
        float mip = max(0.0, 0.5 * log2(max(dot(dFdx(tu), dFdx(tu)), dot(dFdy(tu), dFdy(tu)))));
        if (t.a * (1.0 + mip * 0.25) < uAlpha) discard;
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vW);
        vec3 base = vCol * (0.55 + 0.6 * t.r) * mix(0.22, 1.0, vAO);
        base = mix(base, base * vec3(1.3, 1.1, 0.55), vAO * vAO * 0.45);
        vec3 col = toonLight(base, N, V, vW, 1.0, 0.1);
        float back = pow(max(-dot(V, uLightDir), 0.0), 3.0);
        col += base * vec3(1.0, 0.78, 0.3) * uLightColor * back * uTrans * vAO;
        gl_FragColor = vec4(aerial(min(col, vec3(0.97)), vW), 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------- 5. the layer
export const GEMINI = {
  FRONT: [[48, 80, 6], [48, 80, 7], [48, 80, 8], [48, 80, 9]],   // radial, height segments, flutes (the reference's 48 x 80)
  BACK: [[24, 40, 7], [24, 40, 8]],                              // back row: same shape, half resolution
  H: 48, RB: 4.8,
  BACK_K: 0.88, BACK_DEPTH_K: 0.9, BACK_TONE: 0.62,
  CLUMP_SUMMIT: 1, CLUMP_CREVICE: 3, LEAVES: 90, CLUMP_R_K: 0.55, LEAF_K: 0.34,
  TINTS: [0x6b7a2a, 0x7d8a2e, 0x9aa83a, 0x8a9632, 0xc8a035],   // olive .. yellow-green, one yellow-orange
};

export function createGeminiSpires(ctx, groups) {
  const S = ctx.S, G = GEMINI, t0 = performance.now();
  const root = new THREE.Group(); root.name = "builtSpireGemini";
  const tex = createRockTexture(1024), texMs = performance.now() - t0;
  const rockMat = rockMaterial(S, tex), leafMat = shrubMaterial(S, drawLeafAtlas());
  ctx.materials?.push(rockMat, leafMat);
  const front = G.FRONT.map(([r, h, f], i) => createSpire(G.H, G.RB, f, r, h, 11 + i * 17));
  const back = G.BACK.map(([r, h, f], i) => createSpire(G.H, G.RB, f, r, h, 71 + i * 13));
  // instance counts
  const pillarsOf = (g) => g.parts.filter((p) => p.type === "pillar");
  let nFront = 0, nBack = 0;
  for (const g of groups) { const n = pillarsOf(g).length; nFront += n; if (g.kind === "wall") nBack += n; }
  const mk = (geo, count, mat, name) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    m.name = name; m.userData.kind = "spire"; m.userData.gemini = true; m.frustumCulled = false; m.count = 0;
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    root.add(m); return m;
  };
  const fMesh = front.map((g, i) => mk(g, Math.ceil(nFront / front.length) + 2, rockMat, `builtSpireGeminiF${i}`));
  const bMesh = back.map((g, i) => mk(g, Math.ceil(nBack / back.length) + 2, rockMat, `builtSpireGeminiB${i}`));

  // shrubs: one InstancedMesh per group (culling), the leaf quad shared
  const quad = new THREE.PlaneGeometry(1, 1);
  const perClump = G.LEAVES, perPillar = (G.CLUMP_SUMMIT + G.CLUMP_CREVICE) * perClump;
  const shrubs = groups.map((g) => {
    const cap = Math.max(1, pillarsOf(g).length * perPillar);
    const m = new THREE.InstancedMesh(quad.clone(), leafMat, cap);
    m.name = `builtSpireGeminiShrub${g.id}`; m.userData.kind = "spire"; m.userData.gemini = true; m.count = 0;
    m.geometry.setAttribute("aClump", new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
    m.geometry.setAttribute("aAO", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    m.geometry.setAttribute("aCell", new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    root.add(m); return m;
  });
  ctx.world.add(root);

  const M = new THREE.Matrix4(), PM = new THREE.Matrix4(), NM = new THREE.Matrix3(), V = new THREE.Vector3(), Nv = new THREE.Vector3(),
        T1 = new THREE.Vector3(), T2 = new THREE.Vector3(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(),
        Z = new THREE.Vector3(0, 0, 1), C = new THREE.Color(), SC = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
  const tints = G.TINTS.map((h) => new THREE.Color(h));
  const stat = { leaves: 0, pillars: 0, layoutMs: 0, layouts: 0 };

  function instanceMatrix(p, g, H, sxz, tpl, rowBack, out) {
    const ax = Math.sin(p.az), az = Math.cos(p.az), tx = Math.cos(p.az), tz = -Math.sin(p.az);
    const depth = rowBack ? G.BACK_DEPTH_K * p.R : 0;
    let cx = p.cx + g.dx, cz = p.cz + g.dz;
    if (rowBack) {
      // between two front pillars (half a slot along the wall) and behind them
      cx += ax * depth + tx * (p.pitch / 2); cz += az * depth + tz * (p.pitch / 2);
    }
    const phi = ((p.vvar * 12.9898) % 6.28318);
    const c = Math.cos(phi), s = Math.sin(phi);
    const sy = (H + p.skirt) / tpl.userData.height, sx = sxz / tpl.userData.rMean;
    const lean = p.lean * sy;
    // columns: local X, Y, Z (yawed by phi) mapped to wall tangent / up(+lean) / radial
    const Xc = [sx * (c * tx - s * ax), 0, sx * (c * tz - s * az)];
    const Yc = [ax * lean, sy, az * lean];
    const Zc = [sx * (s * tx + c * ax), 0, sx * (s * tz + c * az)];
    out.set(Xc[0], Yc[0], Zc[0], cx,
            Xc[1], Yc[1], Zc[1], p.y0 - p.skirt,
            Xc[2], Yc[2], Zc[2], cz,
            0, 0, 0, 1);
    return out;
  }

  function clump(mesh, n, anchorW, nor, cr, rnd, ledge, tint) {
    const Cc = anchorW.clone().addScaledVector(nor, 0.35 * cr);
    T1.set(nor.y, -nor.x, 0); if (T1.lengthSq() < 1e-4) T1.set(0, nor.z, -nor.y); T1.normalize();
    T2.crossVectors(nor, T1);
    const aClump = mesh.geometry.attributes.aClump, aAO = mesh.geometry.attributes.aAO, aCell = mesh.geometry.attributes.aCell;
    for (let i = 0; i < perClump; i++) {
      let ux, uy, uz, tries = 0;
      do { ux = rnd() * 2 - 1; uy = rnd() * 2 - 1; uz = rnd() * 2 - 1; } while (ux*ux + uy*uy + uz*uz > 1 && ++tries < 20);
      uz = Math.abs(uz) * 0.8 - 0.1;                     // flattened half-ellipsoid hugging the rock
      V.copy(Cc).addScaledVector(T1, ux * cr).addScaledVector(T2, uy * cr).addScaledVector(nor, uz * cr * 0.65);
      const d = Math.hypot(ux, uy, uz);
      if (ledge) V.y -= cr * 0.55 * rnd() * rnd() * d;       // draped over the face
      Nv.copy(V).sub(Cc).normalize(); Nv.y -= 0.3; Nv.normalize();
      Q.setFromUnitVectors(Z, Nv); Q2.setFromAxisAngle(Z, rnd() * 6.2832); Q.multiply(Q2);
      const sz = cr * G.LEAF_K * (0.8 + 0.4 * rnd());
      M.compose(V, Q, SC.setScalar(sz));
      mesh.setMatrixAt(n, M);
      C.copy(rnd() < 0.1 ? tints[4] : tints[Math.floor(rnd() * 4)]);
      mesh.setColorAt(n, C);
      aClump.setXYZ(n, Cc.x, Cc.y, Cc.z);
      aAO.setX(n, Math.min(1, 0.25 + 0.75 * d)); aCell.setX(n, Math.floor(rnd() * 4));
      n++;
    }
    return n;
  }

  /** Place every instance from the groups' CURRENT state (dx/dz after the keep-out, hidden). */
  function layout() {
    const t = performance.now();
    const cf = fMesh.map(() => 0), cb = bMesh.map(() => 0);
    let leaves = 0, pillars = 0;
    groups.forEach((g, gi) => {
      const sh = shrubs[gi]; let n = 0;
      if (!g.hidden) {
        pillarsOf(g).forEach((p, k) => {
          pillars++;
          const rnd = mulberry(g.id * 1009 + k * 31 + 7);
          const vi = (g.id + k) % front.length, tpl = front[vi];
          const sxz = p.R;
          instanceMatrix(p, g, p.H, sxz, tpl, false, PM);
          fMesh[vi].setMatrixAt(cf[vi], PM);
          fMesh[vi].setColorAt(cf[vi], C.setScalar(0.92 + rnd() * 0.16));
          cf[vi]++;
          // shrubs: the pillar's own summit / crevice anchors
          NM.getNormalMatrix(PM);
          const pick = (arr, cnt) => { const out = [], used = new Set(); for (let i = 0; i < cnt && arr.length; i++) { let j = Math.floor(rnd() * arr.length), tr = 0; while (used.has(j) && tr++ < 8) j = Math.floor(rnd() * arr.length); used.add(j); out.push(arr[j]); } return out; };
          const jobs = [...pick(tpl.userData.summit, G.CLUMP_SUMMIT).map((a) => [a, false]), ...pick(tpl.userData.crevice, G.CLUMP_CREVICE).map((a) => [a, true])];
          for (const [a, ledge] of jobs) {
            V.fromArray(a.p).applyMatrix4(PM);
            const nw = new THREE.Vector3().fromArray(a.n).applyMatrix3(NM).normalize();
            n = clump(sh, n, V.clone(), nw, G.CLUMP_R_K * p.R * (ledge ? 1 : 0.8), rnd, ledge);
          }
          if (g.kind === "wall") {
            const bi = (g.id + k) % back.length, btpl = back[bi];
            instanceMatrix(p, g, p.H * G.BACK_K, p.R, btpl, true, M);
            bMesh[bi].setMatrixAt(cb[bi], M);
            bMesh[bi].setColorAt(cb[bi], C.setScalar(G.BACK_TONE * (0.9 + rnd() * 0.2)));
            cb[bi]++;
          }
        });
      }
      sh.count = n; leaves += n;
      sh.instanceMatrix.needsUpdate = true; if (sh.instanceColor) sh.instanceColor.needsUpdate = true;
      for (const a of ["aClump", "aAO", "aCell"]) sh.geometry.attributes[a].needsUpdate = true;
      if (n) sh.computeBoundingSphere();
      sh.visible = n > 0;
    });
    fMesh.forEach((m, i) => { m.count = cf[i]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); m.visible = cf[i] > 0; });
    bMesh.forEach((m, i) => { m.count = cb[i]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); m.visible = cb[i] > 0; });
    stat.leaves = leaves; stat.pillars = pillars; stat.layouts++; stat.layoutMs = Math.round(performance.now() - t);
    stat.frontInstances = cf.reduce((a, b) => a + b, 0); stat.backInstances = cb.reduce((a, b) => a + b, 0);
    stat.tris = stat.frontInstances * front[0].userData.tris + stat.backInstances * back[0].userData.tris + leaves * 2;
    stat.drawCalls = fMesh.filter((m) => m.visible).length + bMesh.filter((m) => m.visible).length + shrubs.filter((m) => m.visible).length;
  }
  layout();
  stat.buildMs = Math.round(performance.now() - t0); stat.textureMs = Math.round(texMs);
  stat.spireTris = { front: front[0].userData.tris, back: back[0].userData.tris, verts: front[0].userData.verts };
  stat.anchors = front.map((g) => [g.userData.summit.length, g.userData.crevice.length]);
  return { root, layout, stat, materials: [rockMat, leafMat], meshes: [...fMesh, ...bMesh, ...shrubs] };
}
