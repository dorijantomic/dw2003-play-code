// Numbers check of the Arena Viewer's "built" look (web/arena-built.js, no pictures) for ANY arena:
//  - page and shader errors (three.js reports shader compile errors on the console)
//  - the built world loaded: pieces, tree instances, triangles drawn
//  - the battle canvas is see-through except the fighters (share of alpha-0 pixels)
//  - SAME CAMERA on both canvases: each fighter's box centre projected with the three.js camera lands on opaque
//    (fighter) pixels of the battle canvas, over several frames of the orbiting idle camera
//  - the fighters stand on the built ground: three.js ray down at each fighter's x,z vs its feet height
//  - nothing built stands in the fight: nearest tree/bush/boulder from the centre vs the farthest fighter
//  Step 0 (web/built/shared.js): noise JS twin vs GLSL on 1000 points (< 1e-3), seed repeatability, ONE shared
//    uniform object (same references in every material), programs compile
//  Step 1 (trees, ONLY when the arena has tree/bush pieces; a beach is not failed for having no trees):
//    foliage opaque + alphaTest 0.4; fluffy crowns (every leaf vertex inside its clump, shader normal from the clump
//    centre, sun-facing share 20-80 %); GPU vertex probe through the material's own builtWorldPos(): wind off =
//    instanceMatrix x vertex (< 1e-4 of plant scale), wind on over 21 times <= 4 % of height and every plant moving
//    differently; trunks on the ground (< 1e-3); keep-out (rejected-candidate count > 0; every plant vertex outside
//    farthest fighter + 1000 and outside every view cone of the eyes seen); trees alone <= 16 draw calls,
//    <= 25k triangles; frame time over 600 frames, foliage shown vs hidden
//  Beach (ONLY when the arena has sand/shore pieces, meft1002): the sand's colours ARE the piece's measured
//    p10/p90/all and the paint (the CC0 photo tinted) has the measured mean and is continuous at 960x720 (ripples:
//    tools/verify_built_sand.mjs, close up); the shore's row colours ARE the piece's
//    measured picture rows and the band paints only them; aGreen IS the measured green share; grass blades only where
//    aGreen > 0.5, none on the sand, roots on the shore's measured greens
//   VERIFY_PORT=8090 [ARENA=meft1013] tools/run-playwright.sh tools/verify_arena_built.mjs
import fs from "node:fs";
import { launch } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1013";
const REC = JSON.parse(fs.readFileSync(new URL(`../web/assets-hd/battle/built/${ARENA}.json`, import.meta.url), "utf8"));
const KINDS = new Set(REC.pieces.map((p) => p.kind));
const HAS_TREES = ["pine", "tree", "treeline"].some((k) => KINDS.has(k));
const HAS_BEACH = KINDS.has("sand") || KINDS.has("shore");
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 300)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 60000 }).catch(() => {});
let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };

const loaded = await page.evaluate(() => window.__built && { missing: !!window.__built.missing, info: window.__built.info });
check(loaded && !loaded.missing, `built world loaded: ${JSON.stringify(loaded?.info?.pieces)}`);
check(loaded?.info?.triangles > 0, `drawn: ${loaded?.info?.triangles} triangles, ${loaded?.info?.calls} calls, instances ${JSON.stringify(loaded?.info?.instances)}`);

// every frame's eye and fighter spheres, for the keep-out check (the viewer's own frame loop drives the camera)
await page.evaluate(() => {
  window.__seen = [];
  const f = () => {
    const c = window.__r.getCameraInfo()?.render;
    if (c) window.__seen.push({ eye: [...c.eye], fighters: ["player", "enemy"].map((side) => window.__r.getFighterBounds(side)).filter(Boolean)
      .map((b) => ({ c: [...b.center], r: Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2 })) });
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
const frames = [];
for (let k = 0; k < 5; k++) {
  await page.waitForTimeout(1200);
  frames.push(await page.evaluate(async () => {
    const THREE = await import("./lib3d/three.module.js");
    const B = window.__built, r = window.__r, off = window.__off;
    r.render(0); const cam = r.getCameraInfo().render; B.render(cam);   // one fresh frame, both canvases, same camera
    const W = off.width, H = off.height, c2 = new OffscreenCanvas(W, H), x2 = c2.getContext("2d");
    x2.drawImage(off, 0, 0);
    const A = x2.getImageData(0, 0, W, H).data;
    let clear = 0; for (let i = 3; i < A.length; i += 4) if (A[i] === 0) clear++;
    const pv = new THREE.Matrix4().fromArray(B.info.pv);
    const out = { clear: clear / (W * H), fighters: [] };
    for (const side of ["player", "enemy"]) {
      const b = r.getFighterBounds(side); if (!b) continue;
      const v = new THREE.Vector3(...b.center).applyMatrix4(pv);
      const px = Math.round((v.x * 0.5 + 0.5) * W), py = Math.round((0.5 - v.y * 0.5) * H);
      let opaque = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = px + dx, y = py + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue;
        n++; if (A[(y * W + x) * 4 + 3] > 0) opaque++;
      }
      // the built ground under the fighter, through the built layer's own ray (the arena's own floor triangles:
      // grass in a forest arena, sand in a beach arena)
      const gy = B.groundHeight(b.center[0], b.center[2]);
      out.fighters.push({ side, px, py, onScreen: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1, opaque: n ? opaque / n : 0,
                          feet: +b.min[1].toFixed(1), ground: gy == null ? null : +gy.toFixed(1),
                          r: Math.round(Math.hypot(b.center[0], b.center[2])) });
    }
    let near = Infinity;
    B.scene.traverse((o) => { for (const q of o.userData?.at || []) near = Math.min(near, Math.hypot(q[0], q[2])); });
    out.nearestBuilt = Math.round(near);
    // same camera: points of the built world projected by the battle renderer's own matrix and by three.js's camera
    // must land on the same pixel (the depth range differs: fighters use an 8000 far plane, the arena 60000).
    // The points are the placed plants/boulders; an arena with fewer than 20 of them adds its ground vertices, so the
    // test is never "0 of 0" (a beach has no trees).
    const pts = [];
    B.scene.traverse((o) => { for (const q of o.userData?.at || []) if (q.every(Number.isFinite)) pts.push(q); });
    // the plants alone are NOT enough of a sample: the spire shrubs sit on one side of a cliff, so a frame that looks
    // the other way sees 0 of them and the check would report "0 of 0" as a mismatch. The arena's own floor is the
    // largest built surface in every arena (grass in a forest, sand+shore on a beach), so it joins the pool as soon as
    // the plant points are thin.
    if (pts.length < 200) for (const m of B.ground?.ground || []) {
      const a = m.geometry.attributes.position, step = Math.max(1, Math.floor(a.count / 200));
      for (let i = 0; i < a.count; i += step) pts.push([a.getX(i), a.getY(i), a.getZ(i)]);
    }
    const bpv = new THREE.Matrix4().fromArray(r.getViewProjection());
    let worst = 0, used = 0;
    for (const q of pts) {
      const a = new THREE.Vector3(...q).applyMatrix4(bpv), c = new THREE.Vector3(...q).applyMatrix4(pv);
      const w1 = new THREE.Vector4(...q, 1).applyMatrix4(bpv).w; if (w1 <= 1) continue;   // behind the camera
      if (Math.abs(c.x) > 1.5 || Math.abs(c.y) > 1.5) continue;
      used++; worst = Math.max(worst, Math.hypot((a.x - c.x) * W / 2, (a.y - c.y) * H / 2));
    }
    out.camPx = worst; out.camPts = used;
    return out;
  }));
}
// ---- Step 0 (shared module) + Step 1 (trees): numbers measured in the page ----
const s01 = await page.evaluate(async () => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const B = window.__built, R = B.renderer, out = {};
  const cam = new THREE.Camera();
  const pointsPass = (geo, mat, W, H) => {   // draw points into a W x H float target, read it back
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const sc = new THREE.Scene(), pts = new THREE.Points(geo, mat); pts.frustumCulled = false; sc.add(pts);
    const prev = R.getRenderTarget(); R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, cam);
    const px = new Float32Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px); R.setRenderTarget(prev); rt.dispose();
    return px;
  };
  // 1. noise: JS twin vs GLSL on 1000 points, same seed = same numbers, another seed = other numbers
  {
    let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const N = 1000, P = new Float32Array(N * 3), id = new Float32Array(N);
    for (let i = 0; i < N; i++) { for (let k = 0; k < 3; k++) P[i * 3 + k] = (rnd() - 0.5) * 600; id[i] = i; }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("pid", new THREE.BufferAttribute(id, 1));
    const mat = new THREE.ShaderMaterial({ uniforms: S.uniformsWith(),
      vertexShader: `attribute float pid; varying vec3 vP; void main(){ vP = position; gl_PointSize = 1.0;
        gl_Position = vec4((mod(pid, 100.0) + 0.5) / 50.0 - 1.0, (floor(pid / 100.0) + 0.5) / 5.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: `varying vec3 vP; ${S.NOISE_GLSL} void main(){ gl_FragColor = vec4(noise3(vP), fbm3(vP), 0.0, 1.0); }` });
    const px = pointsPass(g, mat, 100, 10);
    let errN = 0, errF = 0;
    const js = []; for (let i = 0; i < N; i++) js.push(S.noise3JS(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    for (let i = 0; i < N; i++) {
      errN = Math.max(errN, Math.abs(px[i * 4] - js[i]));
      errF = Math.max(errF, Math.abs(px[i * 4 + 1] - S.fbm3JS(P[i * 3], P[i * 3 + 1], P[i * 3 + 2])));
    }
    const seed = B.shared.U.uNoiseSeed.value;
    S.initNoise(seed); const again = js.every((v, i) => v === S.noise3JS(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    S.initNoise(seed + 1); let diff = 0; for (let i = 0; i < N; i++) diff += Math.abs(js[i] - S.noise3JS(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    S.initNoise(seed);
    out.noise = { errNoise: errN, errFbm: errF, sameSeedSame: again, otherSeedMeanDiff: diff / N, seed };
    mat.dispose(); g.dispose();
  }
  // 2. one shared uniform object: every built material holds the SAME uniform objects as shared.js's U
  {
    const mats = new Set(); B.scene.traverse((o) => { if (o.material?.isShaderMaterial) mats.add(o.material); });
    for (const m of B.materials) mats.add(m);
    let refs = 0, bad = 0;
    for (const m of mats) for (const k of Object.keys(S.U)) { refs++; if (m.uniforms[k] !== S.U[k]) bad++; }
    out.uniforms = { materials: mats.size, refs, bad, sameModule: B.shared.U === S.U };
    out.programs = { count: R.info.programs.length, failed: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length };
  }
  // 3. foliage material rules
  const fol = B.foliage.children;
  out.material = fol.map((m) => ({ n: m.name, transparent: m.material.transparent, alphaTest: m.material.alphaTest, side: m.material.side, blending: m.material.blending }));
  // 3b. fluffy crowns (fluffytree method): every leaf vertex carries its clump (centre, radius) and lies inside it
  //     (card centre <= 0.62 R + half the card diagonal 0.53 R = 1.15 R); the shader takes the normal from the clump
  //     centre and bends the centre with the same wind; the clump-centre directions face both toward and away from
  //     the sun (a sphere's worth of shading, not one flat tone)
  out.fluffy = {};
  for (const [name, sp] of Object.entries(B.species)) {
    const g = sp.geo, P = g.attributes.position, L = g.attributes.leaf, K = g.attributes.clump, sun = S.U.uSunDir.value;
    let leafV = 0, noClump = 0, worst = 0, toward = 0;
    for (let i = 0; i < P.count; i++) {
      if (L.getX(i) < 0.5) continue;
      leafV++;
      const R = K.getW(i); if (!(R > 0)) { noClump++; continue; }
      const d = [P.getX(i) - K.getX(i), P.getY(i) - K.getY(i), P.getZ(i) - K.getZ(i)], l = Math.hypot(...d);
      worst = Math.max(worst, l / R);
      if ((d[0] * sun.x + d[1] * sun.y + d[2] * sun.z) / (l || 1) > 0) toward++;
    }
    const vs = sp.mat.vertexShader, fs = sp.mat.fragmentShader;
    out.fluffy[name] = { leafV, noClump, worst, toward: leafV ? toward / leafV : 0, clumps: g.userData.clumps?.length || 0,
      shader: fs.includes("N = fluffyNormal(vW, vClump, vCrown)") && vs.includes("vClump = builtWorldPos(clump.xyz, vec2(0.0), 0.0, im)") };
  }
  // 4. vertex probe: every foliage vertex of every instance through the SAME builtWorldPos() the material uses
  const probe = (mesh) => {
    const g0 = mesh.geometry, nv = g0.attributes.position.count, ni = mesh.count;
    const g = new THREE.InstancedBufferGeometry();
    for (const a of ["position", "uv", "leaf"]) g.setAttribute(a, g0.attributes[a]);
    g.setAttribute("instanceMatrix", new THREE.InstancedBufferAttribute(mesh.instanceMatrix.array.slice(), 16));
    g.instanceCount = ni;
    const mat = new THREE.ShaderMaterial({ uniforms: S.uniformsWith({ uSize: { value: new THREE.Vector2(nv, ni) }, uModel: { value: mesh.matrixWorld } }),
      defines: { USE_INSTANCING: "" },
      vertexShader: `attribute float leaf; uniform vec2 uSize; uniform mat4 uModel; varying vec3 vP;
        ${S.NOISE_GLSL}
        ${S.WIND_GLSL.replace("(modelMatrix * im", "(uModel * im")}
        void main(){ vP = builtWorldPos(position, uv, leaf, instanceMatrix); gl_PointSize = 1.0;
          gl_Position = vec4((float(gl_VertexID) + 0.5) / uSize.x * 2.0 - 1.0, (float(gl_InstanceID) + 0.5) / uSize.y * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: `varying vec3 vP; void main(){ gl_FragColor = vec4(vP, 1.0); }` });
    const px = pointsPass(g, mat, nv, ni); mat.dispose(); g.dispose();
    return { px, nv, ni };
  };
  const sameFn = B.species.broadleaf.mat.vertexShader.includes("builtWorldPos(position, uv, leaf, im)") && S.WIND_GLSL.includes("(modelMatrix * im");
  const U = S.U, keepS = U.uWindStrength.value, keepT = U.uWindTime.value;
  const res = { sameFunction: sameFn, maxErrObj: 0, maxErrUnits: 0, verts: 0, species: {} };
  const M = new THREE.Matrix4(), v = new THREE.Vector3();
  U.uWindStrength.value = 0;
  const still = new Map();
  for (const mesh of fol) {
    const { px, nv, ni } = probe(mesh); still.set(mesh, px);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < ni; i++) {
      mesh.getMatrixAt(i, M); M.premultiply(mesh.matrixWorld); const sc = mesh.userData.scale[i];
      for (let j = 0; j < nv; j++) {
        v.fromBufferAttribute(pos, j).applyMatrix4(M);
        const o = (i * nv + j) * 4, e = Math.hypot(px[o] - v.x, px[o + 1] - v.y, px[o + 2] - v.z);
        res.maxErrUnits = Math.max(res.maxErrUnits, e); res.maxErrObj = Math.max(res.maxErrObj, e / sc); res.verts++;
      }
    }
  }
  U.uWindStrength.value = keepS;
  // wind on: 21 times; largest move as a share of plant height; distinct per-plant motion
  const series = new Map();
  for (let k = 0; k < 21; k++) {
    U.uWindTime.value = 3.0 + k * 0.5;
    for (const mesh of fol) {
      const { px, nv, ni } = probe(mesh), p0 = still.get(mesh), sp = B.species[mesh.userData.species];
      const H = sp.box.max[1] - sp.box.min[1];
      let top = 0; const pa = mesh.geometry.attributes.position; for (let j = 1; j < nv; j++) if (pa.getY(j) > pa.getY(top)) top = j;
      const r = res.species[mesh.userData.species] ||= { maxShare: 0, plants: 0, distinct: 0 };
      for (let i = 0; i < ni; i++) {
        const sc = mesh.userData.scale[i];
        for (let j = 0; j < nv; j++) { const o = (i * nv + j) * 4; r.maxShare = Math.max(r.maxShare, Math.hypot(px[o] - p0[o], px[o + 1] - p0[o + 1], px[o + 2] - p0[o + 2]) / (sc * H)); }
        const key = `${mesh.name}#${i}`, o = (i * nv + top) * 4;
        (series.get(key) || series.set(key, []).get(key)).push((px[o] - p0[o]) / sc, (px[o + 2] - p0[o + 2]) / sc);
      }
    }
  }
  U.uWindTime.value = keepT;
  for (const [sp, r] of Object.entries(res.species)) {
    const keys = [...series.keys()].filter((k) => fol.find((m) => k.startsWith(m.name + "#")).userData.species === sp);
    r.plants = keys.length;
    r.distinct = keys.filter((a) => keys.every((b) => a === b || series.get(a).some((x, i) => Math.abs(x - series.get(b)[i]) > 1e-4))).length;
  }
  out.probe = res;
  // 5. trunks on the ground (trees; bushes sit on the bank's top edge by construction)
  let worstG = 0, trunks = 0, noGround = 0;
  for (const m of fol) m.userData.at.forEach((q, i) => {
    if (!m.userData.onGround[i]) return;
    const g = B.groundHeight(q[0], q[2]); trunks++;
    if (g == null) noGround++; else worstG = Math.max(worstG, Math.abs(g - q[1]));
  });
  out.ground = { trunks, worstG, noGround };
  // 6. draw calls and triangles of the trees alone, over the frames' camera
  const camInfo = window.__r.getCameraInfo().render;
  const hide = [];
  B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && !o.isInstancedMesh && o.visible) { hide.push(o); o.visible = false; } });
  B.render(camInfo); out.treeDraw = { calls: B.info.calls, triangles: B.info.triangles };
  for (const o of hide) o.visible = true;
  out.foliage = B.info.foliage; const { list, ...ko } = B.info.keepOut; out.keepOut = ko; out.instances = B.info.instances;
  // independent keep-out: every plant vertex (no wind) vs the fight circle and the view cones of every eye seen
  {
    const seen = window.__seen || [], fighters = [], eyes = [];
    for (const s of seen) {
      if (!eyes.some((e) => Math.hypot(e[0] - s.eye[0], e[1] - s.eye[1], e[2] - s.eye[2]) < 25)) eyes.push(s.eye);
      for (const f of s.fighters) { const g = fighters.find((g) => Math.hypot(g.c[0] - f.c[0], g.c[1] - f.c[1], g.c[2] - f.c[2]) < 50); if (!g) fighters.push({ ...f }); else g.r = Math.max(g.r, f.r); }
    }
    const fightR = Math.max(...fighters.map((f) => Math.hypot(f.c[0], f.c[2]))) + 1000;
    // the idle camera spins (measured over 5 min: the 3990/672 ring covers all 360 deg), so each eye distance/height
    // seen is also swept round the circle in 3 deg steps
    const rings = [];
    for (const e of eyes) { const r = Math.hypot(e[0], e[2]); if (!rings.some((g) => Math.abs(g[0] - r) < 100 && Math.abs(g[1] - e[1]) < 100)) rings.push([r, e[1]]); }
    for (const [r, y] of rings) for (let a = 0; a < 360; a += 3) eyes.push([Math.sin(a * Math.PI / 180) * r, y, Math.cos(a * Math.PI / 180) * r]);
    let verts = 0, inFight = 0, inCone = 0;
    const M = new THREE.Matrix4(), v = new THREE.Vector3();
    for (const m of fol) {
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, M); M.premultiply(m.matrixWorld);
        for (let j = 0; j < pos.count; j++) {
          v.fromBufferAttribute(pos, j).applyMatrix4(M); verts++;
          if (Math.hypot(v.x, v.z) < fightR) inFight++;
          const c = [v.x, v.y, v.z];
          if (eyes.some((e) => fighters.some((f) => S.inViewCone(c, 0, e, f.c, f.r)))) inCone++;
        }
      }
    }
    out.kv = { verts, inFight, inCone, eyes: eyes.length, fighters: fighters.length, fightR: Math.round(fightR) };
  }
  // 7. frame time over 600 frames, the arena's own layer shown vs hidden (readPixels forces the GPU to finish each
  //    frame). Tree arenas: the foliage; beach arenas: the sand + shore meshes.
  const gl = R.getContext(), one = new Uint8Array(4);
  const time = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(camInfo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
  time(20);
  const beachMeshes = [];
  B.scene.traverse((o) => { if (o.isMesh && (o.userData.kind === "sand" || o.userData.kind === "shore")) beachMeshes.push(o); });
  const timed = B.foliage.children.length ? B.foliage : { set visible(v) { for (const m of beachMeshes) m.visible = v; }, get visible() { return beachMeshes.every((m) => m.visible); } };
  timed.visible = true; const shown = time(600);
  timed.visible = false; const hidden = time(600);
  timed.visible = true;
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");   // the real backend, not "WebKit WebGL"
  out.frame = { shown, hidden, layer: B.foliage.children.length ? "foliage" : "sand+shore",
                renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  return out;
});
// ---- Beach (sand + shore): measured only when the arena HAS sand/shore pieces (meft1002). The deep per-pixel
//      numbers live in tools/verify_built_sand.mjs; these are the beach's own rules, measured the same way: the paint
//      alone (no light, no haze) through the material's own uniforms and GLSL, read back at 960x720 top-down.
const beach = HAS_BEACH ? await page.evaluate(async ({ rec }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const SD = await import("./built/sand.js");
  const B = window.__built, R = B.renderer, W = 960, H = 720, out = {};
  const to8 = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  const rgb8 = (c) => [to8(c.r ?? c[0]), to8(c.g ?? c[1]), to8(c.b ?? c[2])];
  const d8 = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const meshes = [];
  B.scene.traverse((o) => { if (o.isMesh && (o.userData.kind === "sand" || o.userData.kind === "shore")) meshes.push(o); });
  const sandMesh = meshes.find((m) => m.userData.kind === "sand") || null;
  const shoreMesh = meshes.find((m) => m.userData.kind === "shore") || null;
  const recSand = rec.pieces.find((p) => p.kind === "sand") || null;
  const recShore = rec.pieces.find((p) => p.kind === "shore") || null;
  out.meshes = meshes.length; out.tris = meshes.reduce((s, m) => s + m.geometry.attributes.position.count / 3, 0);
  const paintPass = (mesh) => {
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
    const probe = SD.paintProbeMaterial(mesh);
    const hid = [];
    B.scene.traverse((o) => { if ((o.isMesh || o.isPoints || o.isInstancedMesh) && o !== mesh && o.visible) { hid.push(o); o.visible = false; } });
    const bg = B.scene.background; B.scene.background = null;
    const keepMat = mesh.material; mesh.material = probe;
    const prev = R.getRenderTarget(), pc = R.getClearColor(new THREE.Color()), pa = R.getClearAlpha();
    const cam = new THREE.OrthographicCamera(-5200, 5200, 3900, -3900, 1, 40000);
    cam.position.set(0, 20000, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(B.scene, cam);
    const px = new Float32Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px);
    R.setRenderTarget(prev); R.setClearColor(pc, pa); mesh.material = keepMat; probe.dispose(); rt.dispose(); B.scene.background = bg;
    for (const o of hid) o.visible = true;
    return px;
  };
  if (sandMesh) {
    const u = sandMesh.material.uniforms;
    const lo = [u.uSandLo.value.r, u.uSandLo.value.g, u.uSandLo.value.b], hi = [u.uSandHi.value.r, u.uSandHi.value.g, u.uSandHi.value.b];
    const all = [u.uSandAll.value.r, u.uSandAll.value.g, u.uSandAll.value.b];
    out.tones8 = [rgb8(lo), rgb8(hi), rgb8(all)];
    out.toneErr = recSand ? Math.max(d8(rgb8(lo), recSand.colours.p10), d8(rgb8(hi), recSand.colours.p90), d8(rgb8(all), recSand.colours.all)) : null;
    // the paint is the CC0 photo tinted to the measured `all` (sand.js): wait until the photo's mean is read
    for (let k = 0; k < 400 && u.uTexOn.value !== 1; k++) { window.__renderFrame?.(performance.now()); await new Promise((r) => setTimeout(r, 25)); }
    const px = paintPass(sandMesh);
    let painted = 0; const m = [0, 0, 0], seen = new Map();
    for (let i = 0; i < W * H; i++) {
      const o = i * 4, c = [px[o], px[o + 1], px[o + 2]];
      if (c[0] + c[1] + c[2] <= 1e-6) continue;
      painted++; m[0] += c[0]; m[1] += c[1]; m[2] += c[2];
      const k = c.map(to8).join(","); seen.set(k, (seen.get(k) || 0) + 1);
    }
    const top = [...seen.values()].sort((a, b) => b - a);
    out.sandPaint = { painted: painted / (W * H), texOn: u.uTexOn.value, mean8: rgb8(m.map((v) => v / Math.max(1, painted))),
                      meanErr: recSand ? d8(rgb8(m.map((v) => v / Math.max(1, painted))), recSand.colours.all) : null,
                      distinct: seen.size, top2: ((top[0] || 0) + (top[1] || 0)) / Math.max(1, painted) };
  }
  if (shoreMesh) {
    const u = shoreMesh.material.uniforms, rows = u.uRows.value, N = rows.length;
    const rows8 = rows.map(rgb8);
    out.rows8 = rows8;
    out.rowErr = recShore ? Math.max(...rows8.map((c, b) => d8(c, recShore.rows[b].rgb))) : null;
    // the paint at each picture-row centre, through the material's own uniforms and the same shoreRow() GLSL
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute("aRow", new THREE.BufferAttribute(new Float32Array(Array.from({ length: N }, (_, b) => (b + 0.5) / N)), 1));
    const mat = new THREE.ShaderMaterial({ uniforms: u,
      vertexShader: `attribute float aRow; varying vec3 vW; varying vec3 vN; varying float vRow;
        void main() { vRow = aRow; vW = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); gl_PointSize = 1.0;
          gl_Position = vec4((float(gl_VertexID) + 0.5) / ${N.toFixed(1)} * 2.0 - 1.0, 0.0, 0.0, 1.0); }`,
      fragmentShader: `varying vec3 vW; varying vec3 vN; varying float vRow;\n${SD.SHORE_ROW_GLSL}\nvoid main() { gl_FragColor = vec4(shoreRow(vRow), 1.0); }` });
    const rt = new THREE.WebGLRenderTarget(N, 1, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
    const sc = new THREE.Scene(), pts = new THREE.Points(g, mat); pts.frustumCulled = false; sc.add(pts);
    const prev = R.getRenderTarget();
    R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, new THREE.Camera());
    const pp = new Float32Array(N * 4); R.readRenderTargetPixels(rt, 0, 0, N, 1, pp);
    R.setRenderTarget(prev); rt.dispose(); mat.dispose(); g.dispose();
    out.bin8 = []; out.binErr = 0;
    for (let b = 0; b < N; b++) {
      const c = [pp[b * 4], pp[b * 4 + 1], pp[b * 4 + 2]].map(to8);
      out.bin8.push(c);
      if (recShore) out.binErr = Math.max(out.binErr, d8(c, recShore.rows[b].rgb));
    }
    const ar = shoreMesh.geometry.attributes.aRow.array, ag = shoreMesh.geometry.attributes.aGreen?.array || null;
    if (recShore && ag) {
      let worstG = 0;
      for (let i = 0; i < ar.length; i++) worstG = Math.max(worstG, Math.abs(ag[i] - SD.rowValue(recShore.rows, ar[i], (r) => r.green)));
      out.greenErr = worstG; out.aGreen = [Math.min(...ag), Math.max(...ag)];
    }
    const bc = shoreMesh.userData.bladeColours;
    const greenest = recShore ? recShore.rows.filter(Boolean).sort((a, b) => b.green - a.green).slice(0, 2).map((r) => r.rgb)
      .sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2])) : null;
    out.bladeColours = bc ? [bc.p10, bc.p90] : null;
    out.bladeErr = bc && greenest ? Math.max(d8(bc.p10, greenest[0]), d8(bc.p90, greenest[greenest.length - 1])) : null;
  }
  // grass: on the shore's green only, never on the sand; roots on the shore's measured greens
  const gm = B.scene.getObjectByName("grass_blades");
  out.grass = { blades: gm ? gm.count : 0 };
  if (gm && gm.count) {
    const { tris, triOf, bary } = gm.userData, n = gm.count;
    const sandName = sandMesh?.name, shoreName = shoreMesh?.name;
    let minGreen = 1, onSand = 0, onShore = 0;
    for (let i = 0; i < n; i++) {
      const tr = tris[triOf[i]], w = [bary[i * 3], bary[i * 3 + 1], bary[i * 3 + 2]];
      const gg = tr.green ? w[0] * tr.green[0] + w[1] * tr.green[1] + w[2] * tr.green[2] : 0;
      minGreen = Math.min(minGreen, gg);
      if (tr.mesh === sandName) onSand++; else if (tr.mesh === shoreName) onShore++;
    }
    out.grass = { ...out.grass, minGreen, onSand, onShore, sandTris: tris.filter((t) => t.mesh === sandName).length };
    const bc = shoreMesh?.userData.bladeColours;
    if (bc) {
      const blo = S.srgb(bc.p10), bhi = S.srgb(bc.p90);
      const d2 = [bhi.r - blo.r, bhi.g - blo.g, bhi.b - blo.b], dd2 = d2[0] ** 2 + d2[1] ** 2 + d2[2] ** 2;
      const root = gm.geometry.attributes.aRoot.array;
      let worst = 0;
      for (let i = 0; i < n; i++) {
        const c = [root[i * 3], root[i * 3 + 1], root[i * 3 + 2]];
        const tt = ((c[0] - blo.r) * d2[0] + (c[1] - blo.g) * d2[1] + (c[2] - blo.b) * d2[2]) / dd2;
        worst = Math.max(worst, Math.hypot(c[0] - (blo.r + d2[0] * tt), c[1] - (blo.g + d2[1] * tt), c[2] - (blo.b + d2[2] * tt)));
      }
      out.grass.rootErr = worst;
    }
  }
  return out;
}, { rec: REC }) : null;
await browser.close().catch(() => {});
for (const [k, f] of frames.entries()) console.log(`frame ${k}: battle canvas clear ${(f.clear * 100).toFixed(1)}%, nearest built thing ${f.nearestBuilt}, `
  + f.fighters.map((x) => `${x.side} px ${x.px},${x.py} onScreen ${x.onScreen} opaque ${x.opaque.toFixed(2)} feet ${x.feet} ground ${x.ground} r ${x.r}`).join(" | "));
const all = frames.flatMap((f) => f.fighters.filter((x) => x.onScreen));
check(frames.every((f) => f.clear > 0.5), `battle canvas see-through outside the fighters (min ${(Math.min(...frames.map((f) => f.clear)) * 100).toFixed(1)}%)`);
check(frames.every((f) => f.camPts > 0 && f.camPx < 0.5), `same camera: built points projected by the battle matrix and by three.js differ by at most ${Math.max(...frames.map((f) => f.camPx)).toFixed(3)} px (${frames.map((f) => f.camPts).join("/")} points)`);
console.log(`     (info) fighter box centre on fighter pixels: ${all.map((x) => x.opaque.toFixed(2)).join(" ")}; a centre between the legs reads 0)`);
// the built ground IS the disc ground (same triangles), and the disc floor under the fight is y 0; the feet are the
// models' own (enemy slot hover/sink), so only the ground is checked
const grounds = frames.flatMap((f) => f.fighters).map((x) => x.ground);
check(grounds.every((g) => g != null && Math.abs(g) <= 1), `built ground under every fighter at the disc floor y 0 (${[...new Set(grounds)].join(", ")}; feet ${frames.flatMap((f) => f.fighters).map((x) => x.feet).join(" ")})`);
const far = Math.max(...frames.flatMap((f) => f.fighters).map((x) => x.r));
check(frames[0].nearestBuilt > far + 1000, `nothing built in the fight: nearest tree/bush/boulder ${frames[0].nearestBuilt} vs farthest fighter ${far} (+1000 clear)`);
// ---- Step 0 ----
const n = s01.noise;
check(n.errNoise < 1e-3 && n.errFbm < 1e-3, `noise JS twin vs GLSL on 1000 points: max error noise3 ${n.errNoise.toExponential(2)}, fbm3 ${n.errFbm.toExponential(2)} (< 1e-3), seed ${n.seed}`);
check(n.sameSeedSame && n.otherSeedMeanDiff > 0.05, `same seed gives the same numbers (${n.sameSeedSame}); another seed differs (mean |diff| ${n.otherSeedMeanDiff.toFixed(3)})`);
check(s01.uniforms.bad === 0 && s01.uniforms.sameModule && s01.uniforms.materials > 0, `one shared uniform object: ${s01.uniforms.materials} materials x ${Object.keys(s01.uniforms).length && s01.uniforms.refs / s01.uniforms.materials} shared uniforms, ${s01.uniforms.bad} not the same reference`);
check(s01.programs.failed === 0, `shader programs compile: ${s01.programs.count} programs, ${s01.programs.failed} failed`);
// ---- Step 1 (trees): only when the arena HAS tree/bush pieces. A beach has none, and "0 of 0" is not a pass, so
//      every tree rule below is skipped there instead of being failed for an empty foliage group.
if (HAS_TREES) {
check(s01.material.every((m) => !m.transparent && m.alphaTest === 0.4 && m.side === 2 && m.blending === 1),
  `foliage materials opaque, alphaTest 0.4, double-sided, not blended (${s01.material.length} meshes)`);
for (const [sp, f] of Object.entries(s01.fluffy)) {
  if (!f.leafV) continue;   // pines: cone stacks, no leaf cards
  check(f.shader && f.clumps > 0 && f.noClump === 0 && f.worst <= 1.15 && f.toward > 0.2 && f.toward < 0.8,
    `fluffy ${sp}: ${f.clumps} clumps, ${f.leafV} leaf vertices, ${f.noClump} without a clump, farthest ${f.worst.toFixed(3)} R (<= 1.15), ${(f.toward * 100).toFixed(0)}% face the sun (20-80%), shader normal from clump centre + wind-bent centre ${f.shader}`);
}
const p = s01.probe;
check(p.sameFunction && p.verts > 0 && p.maxErrObj < 1e-4, `vertex probe (GPU, same builtWorldPos), wind off: ${p.verts} vertices = instanceMatrix x vertex, max error ${p.maxErrObj.toExponential(2)} of plant scale (${p.maxErrUnits.toFixed(4)} units) (< 1e-4)`);
for (const [sp, r] of Object.entries(p.species))
  check(r.maxShare <= 0.04 && r.distinct === r.plants, `wind ${sp}: largest move over 21 times ${(r.maxShare * 100).toFixed(2)}% of plant height (<= 4%); ${r.distinct}/${r.plants} plants move differently`);
const gr = s01.ground;
check(gr.trunks > 0 && gr.noGround === 0 && gr.worstG < 1e-3, `trunks on the ground: ${gr.trunks} trees, worst |base - ground| ${gr.worstG.toExponential(2)} (< 1e-3), ${gr.noGround} with no ground`);
const ko = s01.keepOut, kv = s01.kv, loaded2 = { instances: s01.instances };
// independent keep-out check: every vertex of every placed plant (wind-free) vs the fight circle and the view cones
// from every eye this run saw (cone = hull of the eye and the fighter's bounding sphere)
console.log(`     (info) keep-out: ${ko.candidates} candidates, ${ko.rejectedAtRecipeSpot} rejected at the recipe spot (fight ${ko.byReason.fight}, cone ${ko.byReason.cone}), ${ko.moved} moved outward, ${ko.dropped} dropped, ${ko.accepted} placed; fight radius ${ko.fightR}; eye rings ${JSON.stringify(ko.rings)}; ${ko.rebuilds} placements, ${ko.ms} ms`);
check(ko.rejectedAtRecipeSpot > 0, `keep-out test runs: ${ko.rejectedAtRecipeSpot} candidates rejected at their recipe spot`);
check(kv.inFight === 0 && kv.inCone === 0 && kv.verts > 0, `keep-out by vertices: ${kv.verts} plant vertices, ${kv.inFight} inside ${kv.fightR} of the centre, ${kv.inCone} in a view cone (${kv.eyes} eyes: those seen + their rings swept round, x ${kv.fighters} fighter spheres seen)`);
check(s01.treeDraw.calls <= 16, `trees alone: ${s01.treeDraw.calls} draw calls (<= 16), ${s01.treeDraw.triangles} triangles drawn`);
check(s01.foliage.triangles <= 25000, `tree triangles ${s01.foliage.triangles} (<= 25k) in ${s01.foliage.meshes} meshes: per plant ${Object.entries(s01.foliage.species).map(([k, v]) => `${k} ${v.trisPerPlant}`).join(", ")}; plants ${JSON.stringify(loaded2.instances)}`);
} else {
  console.log(`     (info) ${ARENA} has no tree/bush pieces: foliage material, crown, wind, trunk and keep-out rules not applied; plants ${JSON.stringify(s01.instances)}`);
}
// ---- Beach (sand + shore) ----
if (HAS_BEACH) {
  const b = beach, beachTris = REC.pieces.filter((p) => p.kind === "sand" || p.kind === "shore").reduce((s, p) => s + p.tris, 0);
  check(b && b.tris === beachTris, `beach built: ${b?.meshes} sand/shore meshes, ${b?.tris} triangles = the recipe's ${beachTris}`);
  check(b.toneErr != null && b.toneErr <= 2, `sand colours ARE the piece's measured p10/p90/all: ${JSON.stringify(b.tones8)} (${b.toneErr}/255 off, <= 2)`);
  const sp = b.sandPaint;
  check(sp.painted > 0.15 && sp.texOn === 1 && sp.meanErr != null && sp.meanErr <= 3 && sp.distinct >= 300 && sp.top2 < 0.10,
    `sand paint (960x720 top-down, the paint alone: the CC0 photo tinted to the measured all): ${(sp.painted * 100).toFixed(1)}% of the frame painted, mean ${JSON.stringify(sp.mean8)} (${sp.meanErr}/255 off the measured all, <= 3), continuous: ${sp.distinct} distinct colours, two commonest ${(sp.top2 * 100).toFixed(2)}% (>= 300, < 10 %)`);
  // the 10 cm wind ripples are faded by the pixel footprint at this top-down scale (sand.js rippleFade); their share,
  // direction and wavelength are checked close up in tools/verify_built_sand.mjs
  check(b.rowErr != null && b.rowErr <= 2 && b.binErr <= 2,
    `shore row colours ARE the piece's measured rows: uRows worst ${b.rowErr}/255 off, the paint at the 8 row centres worst ${b.binErr}/255 off (<= 2); row 0 ${JSON.stringify(b.rows8?.[0])}, row 7 ${JSON.stringify(b.rows8?.[7])}`);
  check(b.greenErr != null && b.greenErr < 1e-6 && b.bladeErr != null && b.bladeErr <= 2,
    `shore aGreen IS the measured green share (worst ${b.greenErr?.toExponential(1)}, aGreen ${b.aGreen?.[0].toFixed(3)}..${b.aGreen?.[1].toFixed(3)}) and bladeColours ARE the two greenest measured rows ${JSON.stringify(b.bladeColours?.[0])}..${JSON.stringify(b.bladeColours?.[1])} (${b.bladeErr}/255 off)`);
  check(b.grass.blades > 0 && b.grass.minGreen > 0.5,
    `grass blades only where aGreen > 0.5: ${b.grass.blades} blades, smallest green share ${b.grass.minGreen?.toFixed(3)} (${b.grass.minGreen > 0.5 ? "> 0.5" : "BELOW 0.5: grass.js keeps a blade with probability = the measured green share, not a hard cut"})`);
  check(b.grass.onSand === 0 && b.grass.sandTris === 0, `no blades on the sand: ${b.grass.onSand} of ${b.grass.blades} blades on a sand triangle, ${b.grass.sandTris} sand triangles in the grass scatter list (0 of each)`);
  check(b.grass.rootErr != null && b.grass.rootErr < 1e-4, `blade roots on the shore's measured greens: worst ${b.grass.rootErr?.toExponential(1)} off the p10..p90 segment`);
} else console.log(`     (info) ${ARENA} has no sand/shore pieces: the beach rules are not applied`);
const fr = s01.frame;
const fdt = fr.shown - fr.hidden;
console.log(`     (info) frame time over 600 frames: ${fr.layer} shown ${fr.shown.toFixed(2)} ms, hidden ${fr.hidden.toFixed(2)} ms, ${fr.layer} ${fdt.toFixed(2)} ms on ${fr.renderer}`
  + (Math.abs(fdt) < 0.3 ? ` - below the 0.3 ms resolution of this measurement, no cost claimed` : ``));
check(fr.shown > 0 && fr.hidden > 0, `frame time measured (600 frames each)`);
for (const e of errors) console.log("   error:", e);
check(errors.length === 0, `errors: ${errors.length}`);
process.exit(fails ? 1 : 0);
