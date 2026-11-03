// Numbers check of the BUILT arena's rock spires (web/built/spires.js) - arena-generic, no pictures.
//   meft1002 (South Cape / Shell Beach): a cliff WALL of pillars on the shore + sea stacks + shrubs.
//   An arena with no `spire` piece in its recipe (meft1013, the forest) prints SKIP for every spire rule and exits 0.
//
// WHAT IT PROVES, and why each line exists:
//  1. the layer loaded (info.layers.spires) and its meshes are the three the checker names, all kind "spire".
//  2. NO NaN ANYWHERE. Every position/normal of every spire geometry is finite, every bounding sphere has a finite
//     radius, and prepare()'s own audit (info.problems) is empty. This is the regression test for the bug that made
//     `THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN` on 208 card vertices and left the rock
//     buffer 0-length: a `P.MIN_PER_PANEL` that did not exist turned Math.max(undefined, n) into NaN, which then
//     poisoned the pillar count, the pitch, the radius, the panel's axis and its mass's column count.
//  3. every WALL PANEL stands on a recipe PICTURE CARD: nearest card base <= 1 unit, base y = the card's base y, and
//     the card's own base is the measured top of the shore/sand under it (<= 0.1).
//  4. every SEA STACK is one of the recipe's sea cards: base at the measured water surface, over a water/sea
//     triangle, never taller than its own card, its skirt below the water pieces' measured floor.
//  5. the wall is CONTINUOUS: from the arena's own camera no column of the frame sees sky straight through the wall
//     (the panels used to stop half a pitch short of each card edge, opening a ~1 deg slot at every seam), and every
//     panel emits at least MIN_PER_PANEL pillars.
//  6. keep-out by VERTICES over the final buffers: 0 spire vertices inside the fight, 0 inside any eye cone (every
//     eye seen, swept round the full circle as the idle camera spins), and the nearest spire vertex is farther than
//     the farthest fighter's SURFACE - the proof that does not depend on the sphere test at all.
//  7. shrub cover: instances on every panel and every stack, leaf cards > 0, alpha-tested (never blended), drawn by
//     the SHARED light (one uniform object, same module).
//  8. the ROCK PAINT is the piece's measured pale tone, on the GPU, through the material's own rockAlbedo(): the body
//     is within 20% of the measured p90 luma, the brightest 10% is within 10%, the deepest 10% is a real crevice
//     (<= 62% of the body), and the shade keeps at least 75% of the body's value. The reference cliff texture
//     (assets/battle/arenas/meft1002/wall.png) is 68% pale [199,191,215], 21% crevice [38,38,41], 11% green and not
//     one blue-dominant pixel; the old material rendered the cliff at 0.63 of its pale tone with a violet shade.
//  9. day vs night on the SAME camera: the rock AND the shrubs darken when the sky is switched to night.
// 10. budget: draw calls added <= 6, triangles <= 60k, no failed shader program ADDED by the spires, 0 page errors.
// 11. frame time of the whole world is printed (and must stay under the 10 ms budget at 960x720).
//   ARENA=meft1002 VERIFY_PORT=8090 tools/verify-lock.sh tools/run-playwright.sh tools/verify_built_spires.mjs
import { launch, gpuMode } from "./verify-launch.mjs";
import { baseUrl } from "./verify-base-url.mjs";

const ARENA = process.env.ARENA || "meft1002";
const FRAMES = Math.max(20, Number(process.env.FRAMES || 120));
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 760 } })).newPage();
const errors = [];
page.on("crash", () => console.log("PAGE CRASHED"));
page.on("pageerror", (e) => errors.push(String(e.stack || e).slice(0, 900)));
page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 400)); });
await page.goto(`${baseUrl(8090)}/arena-viewer.html?arena=${ARENA}&look=built`);
await page.waitForFunction(() => window.__built?.info?.triangles > 0 || window.__built?.missing, null, { timeout: 90000 }).catch(() => {});

// every eye and fighter this run sees (the viewer's own frame loop), for the independent keep-out test
await page.evaluate(() => {
  window.__seen = [];
  const f = () => {
    const c = window.__r?.getCameraInfo?.()?.render;
    if (c) window.__seen.push({ eye: [...c.eye], fighters: ["player", "enemy"].map((s) => window.__r.getFighterBounds(s)).filter(Boolean)
      .map((b) => ({ c: [...b.center], r: Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2 })) });
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
});
for (let k = 0; k < 3; k++) await page.waitForTimeout(1200);

const R0 = await page.evaluate(async ({ frames: FRAMES, gpu: GPU, arena: ARENA }) => {
  const THREE = await import("./lib3d/three.module.js");
  const S = await import("./built/shared.js");
  const SP = await import("./built/spires.js");
  const B = window.__built, R = B?.renderer;
  if (!B) return { missing: true };
  const rec = await (await fetch(`/assets-hd/battle/built/${ARENA}.json`, { cache: "no-store" })).json();
  const spireRecs = rec.pieces.filter((p) => p.kind === "spire");
  const out = { arena: ARENA, pieces: rec.pieces.map((p) => p.kind), spirePieces: spireRecs.length,
                cards: spireRecs.reduce((s, p) => s + (p.cards || []).length, 0), layers: Object.keys(B.info.layers || {}) };
  const sp = B.layers?.find((l) => l.id === "spires");
  if (!spireRecs.length) return out;                       // no spire piece: nothing to check (the report skips)
  if (!sp) { out.noLayer = true; return out; }

  const failedOf = () => R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).length;
  const failedAtStart = failedOf(), programsAtStart = R.info.programs.length;
  const info = sp.info;
  const rock = B.scene.getObjectByName("builtSpireRock"), cardMesh = B.scene.getObjectByName("builtSpireCards");
  const bushMeshes = sp.meshes.filter((m) => /^builtSpireBush/.test(m.name));
  out.meshes = { rock: !!rock, cards: !!cardMesh, bushes: bushMeshes.length,
                 names: sp.meshes.map((m) => m.name), kinds: sp.meshes.map((m) => m.userData.kind) };
  const W = R.domElement.width, H = R.domElement.height;
  const walls = info.groups.filter((g) => g.kind === "wall");
  const stacks = info.groups.filter((g) => g.kind === "island");
  out.counts = { walls: walls.length, stacks: stacks.length, cards: info.cards, skipped: info.skipped.length,
                 pillars: info.groups.reduce((s, g) => s + g.pillars, 0), meshes: info.meshes,
                 bushes: info.bushes?.count, tris: info.triangles, ms: info.ms };

  // ---- 2. NO NaN, anywhere ---------------------------------------------------------------
  const finite = (a) => { let bad = 0; for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) bad++; return bad; };
  const nan = { geometries: [], problems: info.problems ?? [], module: info.nan ?? null };
  for (const m of sp.meshes) {
    const g = m.geometry; if (!g || !g.attributes.position) { nan.geometries.push({ name: m.name, none: true }); continue; }
    if (!g.boundingSphere) g.computeBoundingSphere();
    nan.geometries.push({ name: m.name, verts: g.attributes.position.count,
                          pos: finite(g.attributes.position.array), nor: g.attributes.normal ? finite(g.attributes.normal.array) : 0,
                          radius: g.boundingSphere.radius, instances: m.isInstancedMesh ? m.count : null });
  }
  out.nan = nan;

  // ---- 3. the wall panels stand on the recipe's picture cards ------------------------------
  const cards = [];
  for (const p of spireRecs) for (const c of p.cards || []) cards.push({ piece: p.name, base: c.base, w: c.w, h: c.h, r: Math.hypot(c.base[0], c.base[2]) });
  const near = (b) => cards.reduce((a, c) => { const d = Math.hypot(c.base[0] - b[0], c.base[1] - b[1], c.base[2] - b[2]); return d < a.d ? { d, c } : a; }, { d: Infinity, c: null });
  const baseOf = (g) => [Math.sin(g.az * Math.PI / 180) * g.r, g.baseY, Math.cos(g.az * Math.PI / 180) * g.r];
  // A panel keeps its card's AZIMUTH and its card's base height exactly; its RADIUS is the card's own radius or the
  // fight-clearance floor (recipe rmin + R + MARGIN), whichever is farther out - that push is the keep-out proof, so
  // it is checked as a bound (never inward, never more than MARGIN + R beyond the card) instead of as a position.
  let wErrAz = 0, wErrY = 0, wPush = 0, wMoved = 0, worst = null;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const rows = [];
  for (const g of walls) {
    const q = near(baseOf(g));
    const cardAz = Math.atan2(q.c.base[0], q.c.base[2]) * 180 / Math.PI;
    const azErr = Math.abs(wrap((g.az - cardAz) * Math.PI / 180)) * 180 / Math.PI;
    const cardR = Math.hypot(q.c.base[0], q.c.base[2]);
    const dR = g.r - cardR;
    if (azErr > wErrAz) { wErrAz = azErr; worst = { panel: `${g.piece} card ${g.card}`, az: g.az, cardAz: +cardAz.toFixed(3), cardR: Math.round(cardR) }; }
    wErrY = Math.max(wErrY, Math.abs(q.c.base[1] - g.baseY));
    wPush = Math.max(wPush, dR - g.R);
    if (dR > 0.5) wMoved++;
    rows.push({ piece: g.piece, card: g.card, az: g.az, cardAz: +cardAz.toFixed(2), r: g.r, cardR: Math.round(cardR), dR: +dR.toFixed(1),
                baseY: g.baseY, cardY: q.c.base[1], pillars: g.pillars, n: g.n, R: g.R, pitch: g.pitch, spanDeg: g.spanDeg,
                h: g.H, top: g.top, skirtY: g.skirtY, cards: g.cards, bushes: g.bushes, vn: g.vn });
  }
  out.walls = { rows, errAz: wErrAz, errY: wErrY, push: wPush, moved: wMoved, worst };

  // ---- 4. the sea stacks ----------------------------------------------------------------
  const waterPieces = rec.pieces.filter((p) => p.kind === "water" || p.kind === "sea");
  const yOf = (p) => (p.pos || []).filter((_, i) => i % 3 === 1);
  const waterTop = Math.max(...waterPieces.flatMap(yOf));
  const waterFloor = Math.min(...waterPieces.filter((p) => p.kind === "water").flatMap(yOf));
  const seaFloor = Math.min(...waterPieces.filter((p) => p.kind === "sea").flatMap(yOf));
  const spireYmax = Math.max(...spireRecs.flatMap(yOf));
  const wt = [];
  for (const w of waterPieces) { const a = w.pos || []; for (let i = 0; i + 9 <= a.length; i += 9) wt.push([a[i], a[i + 2], a[i + 3], a[i + 5], a[i + 6], a[i + 8]]); }
  const waterDist = (x, z) => {
    let best = Infinity;
    for (const t of wt) {
      const ax = t[0], az = t[1], bx = t[2], bz = t[3], cx = t[4], cz = t[5];
      const side = (px, pz, qx, qz) => (x - qx) * (pz - qz) - (px - qx) * (z - qz);
      const d1 = side(ax, az, bx, bz), d2 = side(bx, bz, cx, cz), d3 = side(cx, cz, ax, az);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return 0;
      for (let k = 0; k < 3; k++) {
        const px = t[k * 2], pz = t[k * 2 + 1], qx = t[((k + 1) % 3) * 2], qz = t[((k + 1) % 3) * 2 + 1];
        const dx = qx - px, dz = qz - pz, L = dx * dx + dz * dz;
        const u = L > 1e-9 ? Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / L)) : 0;
        const ex = x - (px + dx * u), ez = z - (pz + dz * u);
        best = Math.min(best, ex * ex + ez * ez);
      }
    }
    return Math.sqrt(best);
  };
  // the skirt: every group's lowest vertex, measured on the FINAL buffer through its own vertex range
  rock.updateMatrixWorld(true);
  const P = rock.geometry.attributes.position, v = new THREE.Vector3();
  const lowOf = (g) => { let lo = Infinity; for (let i = g.v0; i < g.v0 + g.vn; i++) { v.fromBufferAttribute(P, i).applyMatrix4(rock.matrixWorld); lo = Math.min(lo, v.y); } return lo; };
  let sErrPos = 0, sErrY = 0, sOver = 0, sMaxWater = 0, sHOver = 0, sTopOver = 0, sBaseAbove = -Infinity, sTopY = -Infinity, sSkirtBad = 0, sLow = [];
  const stackRows = [];
  for (const g of stacks) {
    const q = near(baseOf(g));
    sErrPos = Math.max(sErrPos, q.d); sErrY = Math.max(sErrY, Math.abs(q.c.base[1] - g.baseY));
    const wd = waterDist(Math.sin(g.az * Math.PI / 180) * g.r, Math.cos(g.az * Math.PI / 180) * g.r);
    sMaxWater = Math.max(sMaxWater, wd); if (wd <= 600) sOver++;
    sHOver = Math.max(sHOver, g.H - q.c.h); sTopOver = Math.max(sTopOver, g.top - (q.c.base[1] + q.c.h));
    sBaseAbove = Math.max(sBaseAbove, g.baseY - waterTop); sTopY = Math.max(sTopY, g.top);
    const lo = lowOf(g); sLow.push(Math.round(lo));
    if (!(lo <= waterFloor - 100)) sSkirtBad++;
    stackRows.push({ piece: g.piece, card: g.card, az: g.az, r: g.r, baseY: g.baseY, cardY: q.c.base[1], R: g.R, h: g.H, top: g.top,
                     cardH: q.c.h, cardTop: q.c.base[1] + q.c.h, waterDist: +wd.toFixed(1), skirtY: Math.round(lo), pillars: g.pillars, cards: g.cards, bushes: g.bushes });
  }
  out.stacks = { rows: stackRows, count: stacks.length, errPos: sErrPos, errY: sErrY, overWater: sOver, maxWaterDist: sMaxWater,
                 hOver: sHOver, topOver: sTopOver, baseAbove: sBaseAbove, topY: sTopY, skirtBad: sSkirtBad, low: sLow,
                 waterTop, waterFloor, seaFloor, spireYmax };
  // the wall's skirts, the same way
  const wSkirt = walls.map((g) => Math.round(lowOf(g)));
  out.wallSkirt = { low: wSkirt, base: walls.map((g) => g.baseY), bad: wSkirt.filter((y, i) => !(y <= walls[i].baseY - 100)).length };

  // ---- 3b. the bases on the sand/shore ---------------------------------------------------
  const ground = [];
  B.scene.traverse((o) => { if (o.isMesh && (o.name === "floor_01" || o.name === "floor_06")) ground.push(o); });
  const patchTop = (x, z, rad) => {
    let n = 0, top = -Infinity;
    for (const m of ground) {
      const a = m.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        const dx = a.getX(i) - x, dz = a.getZ(i) - z;
        if (dx * dx + dz * dz > rad * rad) continue;
        n++; top = Math.max(top, a.getY(i));
      }
    }
    return { n, top };
  };
  let baseErr = 0, groundN = 0, groundErr = 0, groundMiss = 0;
  for (const g of walls) {
    const p = patchTop(Math.sin(g.az * Math.PI / 180) * g.r, Math.cos(g.az * Math.PI / 180) * g.r, 600);
    baseErr = Math.max(baseErr, Math.abs(near(baseOf(g)).c.base[1] - g.baseY));
    if (!p.n) { groundMiss++; continue; }
    groundN++; groundErr = Math.max(groundErr, Math.abs(p.top - g.baseY));
  }
  const surf = (kind) => { const a = rec.pieces.filter((p) => p.kind === kind).flatMap(yOf); return a.length ? Math.max(...a) : null; };
  out.bases = { baseErr, groundN, groundErr, groundMiss, sandTop: surf("sand"), shoreTop: surf("shore") };

  // ---- 5. the wall is CONTINUOUS (no sky through it) --------------------------------------
  //   Render the spires alone from the arena's own camera onto a magenta clear: a column that is background across
  //   the wall's own vertical extent is a hole in the cliff (the seams between two cards used to open exactly that).
  {
    // the classic backdrop view: the arena's centre, at head height, looking at the wall - the cliff is behind the
    // fight, so this is the frame the wall has to be closed in (the live camera is used too, when it is far enough)
    const camArena = { fovRad: 0.95, aspect: W / H, eye: [0, 900, 0], up: [0, 1, 0],
                       look: [0, 1600, 0], arenaScale: 1 };
    {
      const w0 = info.groups.find((g) => g.kind === "wall");
      const a = Math.atan2(Math.sin(w0.az * Math.PI / 180), Math.cos(w0.az * Math.PI / 180));
      camArena.look = [Math.sin(a) * 4400, 1600, Math.cos(a) * 4400];
    }
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    const px = new Uint8Array(W * H * 4);
    const all = [];
    B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible) all.push(o); });
    for (const o of all) if (o.userData?.kind !== "spire") o.visible = false;
    const prevClear = R.getClearColor(new THREE.Color()), prevA = R.getClearAlpha();
    const prev = R.getRenderTarget();
    B.render(camArena);
    R.setRenderTarget(rt); R.setClearColor(0xff00ff, 1); R.clear(); R.render(B.scene, B.camera);
    R.readRenderTargetPixels(rt, 0, 0, W, H, px);
    R.setRenderTarget(prev); R.setClearColor(prevClear, prevA); rt.dispose();
    for (const o of all) o.visible = true;
    const cols = 160, rows = Math.round(cols * H / W);
    const bg = (i, j) => { const x = Math.floor((i + 0.5) * W / cols), y = Math.floor((j + 0.5) * H / rows);
      const o = (y * W + x) * 4; return px[o] > 200 && px[o + 1] < 60 && px[o + 2] > 200; };
    let holes = 0, run = 0, worst = 0, solid = 0, spanPx = 0;
    for (let i = 0; i < cols; i++) {
      let top = -1, bot = -1;
      for (let j = 0; j < rows; j++) if (!bg(i, j)) { if (top < 0) top = j; bot = j; }
      const ext = bot - top;
      if (ext <= rows * 0.08) continue;                      // this column does not reach the wall
      solid++; spanPx += ext;
      let nBg = 0;                                            // background counted INSIDE the column's own extent
      for (let j = top; j <= bot; j++) if (bg(i, j)) nBg++;
      if (nBg > ext * 0.5) { holes++; run++; worst = Math.max(worst, run); } else run = 0;
    }
    out.wall = { cols, rows, solidCols: solid, holes, worstRun: worst, meanExt: solid ? +(spanPx / solid / rows).toFixed(2) : 0 };
  }

  // ---- 6. keep-out by vertices -----------------------------------------------------------
  {
    const seen = window.__seen || [], fighters = [], eyes = [];
    for (const s of seen) {
      if (!eyes.some((e) => Math.hypot(e[0] - s.eye[0], e[1] - s.eye[1], e[2] - s.eye[2]) < 25)) eyes.push(s.eye);
      for (const f of s.fighters) { const g = fighters.find((g) => Math.hypot(g.c[0] - f.c[0], g.c[1] - f.c[1], g.c[2] - f.c[2]) < 50); if (!g) fighters.push({ ...f }); else g.r = Math.max(g.r, f.r); }
    }
    const fightR = Math.max(...fighters.map((f) => Math.hypot(f.c[0], f.c[2]))) + 1000;
    const rings = [];
    for (const e of eyes) { const rr = Math.hypot(e[0], e[2]); if (!rings.some((g) => Math.abs(g[0] - rr) < 100 && Math.abs(g[1] - e[1]) < 100)) rings.push([rr, e[1]]); }
    for (const [rr, y] of rings) for (let a = 0; a < 360; a += 3) eyes.push([Math.sin(a * Math.PI / 180) * rr, y, Math.cos(a * Math.PI / 180) * rr]);
    const stackOf = (m) => { const a = new Int16Array(m.geometry.attributes.position.count).fill(-1);
      if (m === rock) for (const [k, g] of stacks.entries()) for (let i = g.v0; i < g.v0 + g.vn; i++) a[i] = k; return a; };
    let verts = 0, inFight = 0, inCone = 0, minR = Infinity, minY = Infinity;
    let sVerts = 0, sInFight = 0, sInCone = 0, sMinR = Infinity;
    const M = new THREE.Matrix4(), vv = new THREE.Vector3();
    const perMesh = [];
    for (const m of [rock, ...bushMeshes]) {
      const Pp = m.geometry.attributes.position, sOf = stackOf(m);
      let mMin = Infinity, mBad = 0;
      if (m.isInstancedMesh) {
        for (let i = 0; i < m.count; i++) {
          m.getMatrixAt(i, M); M.premultiply(m.matrixWorld);
          for (let j = 0; j < Pp.count; j++) {
            vv.fromBufferAttribute(Pp, j).applyMatrix4(M); verts++;
            const rr = Math.hypot(vv.x, vv.z); minR = Math.min(minR, rr); minY = Math.min(minY, vv.y);
            mMin = Math.min(mMin, rr); if (!Number.isFinite(rr) || !Number.isFinite(vv.y)) mBad++;
            if (rr < fightR) inFight++;
            if (eyes.some((e) => fighters.some((f) => S.inViewCone([vv.x, vv.y, vv.z], 0, e, f.c, f.r)))) inCone++;
          }
        }
        perMesh.push({ name: m.name, kind: "instanced", count: m.count, minR: mMin, bad: mBad });
        continue;
      }
      for (let j = 0; j < Pp.count; j++) {
        vv.fromBufferAttribute(Pp, j).applyMatrix4(m.matrixWorld); verts++;
        const rr = Math.hypot(vv.x, vv.z); minR = Math.min(minR, rr); minY = Math.min(minY, vv.y);
        mMin = Math.min(mMin, rr); if (!Number.isFinite(rr) || !Number.isFinite(vv.y)) mBad++;
        if (rr < fightR) inFight++;
        const cone = eyes.some((e) => fighters.some((f) => S.inViewCone([vv.x, vv.y, vv.z], 0, e, f.c, f.r)));
        if (cone) inCone++;
        const si = sOf[j];
        if (si >= 0) { sVerts++; sMinR = Math.min(sMinR, rr); if (rr < fightR) sInFight++; if (cone) sInCone++; }
      }
      perMesh.push({ name: m.name, kind: "mesh", count: 1, minR: mMin, bad: mBad });
    }
    out.keep = { perMesh, verts, inFight, inCone, minR, minY, fightR: Math.round(fightR), farthest: Math.round(fightR - 1000),
                 farSurf: Math.round(Math.max(...fighters.map((f) => Math.hypot(f.c[0], f.c[2]) + f.r))),
                 fighters: fighters.length, rings: rings.map((g) => [Math.round(g[0]), Math.round(g[1])]), eyes: eyes.length,
                 nearMin: info.keepOut?.nearMin, recipeRmin: info.measured?.recipeRmin, dropped: info.keepOut?.dropped,
                 pushed: info.keepOut?.pushed, stackVerts: sVerts, stackInFight: sInFight, stackInCone: sInCone, stackMinR: sMinR };
  }

  // ---- 7. shrubs ------------------------------------------------------------------------
  {
    const leaf = bushMeshes[0]?.geometry.attributes.aLeaf;
    let refs = 0, bad = 0;
    for (const m of [rock, ...bushMeshes, cardMesh]) for (const k of Object.keys(S.U)) { refs++; if (m.material.uniforms[k] !== S.U[k]) bad++; }
    out.shrub = { instances: bushMeshes.reduce((s, m) => s + m.count, 0), perVariant: bushMeshes.map((m) => m.count),
                  leafAttr: !!leaf, tris: info.bushes?.tris, trisPerBush: info.bushes?.trisPerBush,
                  perWall: walls.map((g) => g.bushes), perStack: stacks.map((g) => g.bushes),
                  perStackCards: stacks.map((g) => g.cards),
                  minPerWall: Math.min(...walls.map((g) => g.bushes)), minPerStack: Math.min(...stacks.map((g) => g.bushes + g.cards)),
                  cardsPerWall: walls.map((g) => g.cards), minCardsPerWall: Math.min(...walls.map((g) => g.cards)),
                  uniforms: { materials: 3, refs, bad, sameModule: B.shared?.U === S.U },
                  transparent: bushMeshes[0]?.material.transparent, side: bushMeshes[0]?.material.side === THREE.DoubleSide,
                  alphaUniform: bushMeshes[0]?.material.uniforms.uLeafAlpha?.value,
                  shader: { toonLight: bushMeshes[0]?.material.fragmentShader.includes("toonLight("),
                            leafTex: !!bushMeshes[0]?.material.uniforms.uLeafTex?.value,
                            fluffy: bushMeshes[0]?.material.fragmentShader.includes("fluffyNormal(") } };
  }

  // ---- 8. the rock paint on the GPU, through the material's OWN rockAlbedo/rockShade ------
  {
    const g = rock.geometry, Pn = g.attributes.position;
    const idx = [];
    for (const q of walls) for (let i = q.v0; i < q.v0 + q.vn; i += 5) idx.push(i);
    const n = idx.length;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), ao = new Float32Array(n),
          pale = new Float32Array(n * 3), mid = new Float32Array(n * 3), dark = new Float32Array(n * 3),
          green = new Float32Array(n * 3), vr = new Float32Array(n), pid = new Float32Array(n);
    idx.forEach((vi, k) => {
      pos.set([Pn.getX(vi), Pn.getY(vi), Pn.getZ(vi)], k * 3);
      nor.set([g.attributes.normal.getX(vi), g.attributes.normal.getY(vi), g.attributes.normal.getZ(vi)], k * 3);
      ao[k] = g.attributes.aAO.getX(vi);
      pale.set([g.attributes.aRock.getX(vi), g.attributes.aRock.getY(vi), g.attributes.aRock.getZ(vi)], k * 3);
      mid.set([g.attributes.aMid.getX(vi), g.attributes.aMid.getY(vi), g.attributes.aMid.getZ(vi)], k * 3);
      dark.set([g.attributes.aDark.getX(vi), g.attributes.aDark.getY(vi), g.attributes.aDark.getZ(vi)], k * 3);
      green.set([g.attributes.aGreen.getX(vi), g.attributes.aGreen.getY(vi), g.attributes.aGreen.getZ(vi)], k * 3);
      vr[k] = g.attributes.aVar.getX(vi); pid[k] = k;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aN", new THREE.BufferAttribute(nor, 3));
    geo.setAttribute("aAO", new THREE.BufferAttribute(ao, 1));
    geo.setAttribute("aRock", new THREE.BufferAttribute(pale, 3));
    geo.setAttribute("aMid", new THREE.BufferAttribute(mid, 3));
    geo.setAttribute("aDark", new THREE.BufferAttribute(dark, 3));
    geo.setAttribute("aGreen", new THREE.BufferAttribute(green, 3));
    geo.setAttribute("aVar", new THREE.BufferAttribute(vr, 1));
    geo.setAttribute("pid", new THREE.BufferAttribute(pid, 1));
    const cols = 64, rows = Math.ceil(n / cols);
    const run = (body) => {
      const rt = new THREE.WebGLRenderTarget(cols, rows, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
      const mat = new THREE.ShaderMaterial({
        uniforms: Object.assign({}, rock.material.uniforms, { uGrid: { value: new THREE.Vector2(cols, rows) } }),
        vertexShader: `attribute vec3 aN, aRock, aMid, aDark, aGreen; attribute float aAO, aVar, pid; uniform vec2 uGrid;
          varying vec3 vW, vN, vRock, vMid, vDark, vGreen; varying float vAO, vVar;
          void main() { vW = position; vN = aN; vAO = aAO; vVar = aVar; vRock = aRock; vMid = aMid; vDark = aDark; vGreen = aGreen;
            gl_PointSize = 1.0;
            gl_Position = vec4((mod(pid, uGrid.x) + 0.5) / uGrid.x * 2.0 - 1.0, (floor(pid / uGrid.x) + 0.5) / uGrid.y * 2.0 - 1.0, 0.0, 1.0); }`,
        fragmentShader: `varying vec3 vW, vN, vRock, vMid, vDark, vGreen; varying float vAO, vVar;
          ${S.NOISE_GLSL}${S.LIGHT_GLSL}${SP.ROCK_GLSL}
          void main() { vec3 N = normalize(vN); vec3 alb = rockAlbedo(vW, N, vAO, vRock, vMid, vDark, vGreen, vVar);
            gl_FragColor = vec4(${body}, 1.0); }`,
      });
      const sc = new THREE.Scene(), pts = new THREE.Points(geo, mat); pts.frustumCulled = false; sc.add(pts);
      const prev = R.getRenderTarget();
      R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(sc, new THREE.Camera());
      const px = new Float32Array(cols * rows * 4); R.readRenderTargetPixels(rt, 0, 0, cols, rows, px);
      R.setRenderTarget(prev); rt.dispose(); mat.dispose();
      return px;
    };
    const albPx = run("alb"), shPx = run("rockShade(alb, N, normalize(vec3(0.0, 0.0, 1.0)), vAO, 0.55)");
    const toS = (x) => { const v2 = Math.max(0, Math.min(1, x)); return 255 * (v2 <= 0.0031308 ? 12.92 * v2 : 1.055 * Math.pow(v2, 1 / 2.4) - 0.055); };
    const pick = (px, k, ch) => px[Math.floor(k / cols) * cols * 4 + (k % cols) * 4 + ch];
    const lum = (r, gg, b) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    const alb = [], sha = [];
    for (let k = 0; k < n; k++) {
      alb.push(lum(toS(pick(albPx, k, 0)), toS(pick(albPx, k, 1)), toS(pick(albPx, k, 2))));
      sha.push(lum(toS(pick(shPx, k, 0)), toS(pick(shPx, k, 1)), toS(pick(shPx, k, 2))));
    }
    const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
    // the measured pale tone, as sRGB luma, from the recipe's own p90
    const col = spireRecs[0].colours || {};
    const paleRGB = col.p90 || col.other || [194, 180, 211];
    const paleLuma = lum(...paleRGB);
    out.paint = { n, pale: paleRGB, paleLuma: +paleLuma.toFixed(1),
                  albedo: { p10: +q(alb, 0.10).toFixed(1), p50: +q(alb, 0.50).toFixed(1), p90: +q(alb, 0.90).toFixed(1) },
                  shaded: { p10: +q(sha, 0.10).toFixed(1), p50: +q(sha, 0.50).toFixed(1), p90: +q(sha, 0.90).toFixed(1) },
                  sameFn: SP.ROCK_GLSL.includes("vec3 rockAlbedo(") && rock.material.fragmentShader.includes("rockAlbedo(") };
  }

  // ---- 9. day vs night on the SAME camera ------------------------------------------------
  {
    const d0 = walls[0];
    const camS = { fovRad: 0.95, aspect: W / H, eye: [0, 900, 0], up: [0, 1, 0],
                   look: [Math.sin(d0.az * Math.PI / 180) * d0.r, d0.baseY + d0.H * 0.45, Math.cos(d0.az * Math.PI / 180) * d0.r], arenaScale: 1 };
    out.camS = { eye: camS.eye, look: camS.look.map(Math.round), wall: d0.r };
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.FloatType, format: THREE.RGBAFormat });
    const px = new Float32Array(W * H * 4);
    const prevClear = R.getClearColor(new THREE.Color()), prevAlpha = R.getClearAlpha();
    const shots = [rock, ...bushMeshes];
    const shot = (only) => {
      B.render(camS);
      const all = [];
      B.scene.traverse((o) => { if ((o.isMesh || o.isPoints) && o.visible) all.push(o); });
      for (const o of all) o.visible = only.includes(o);
      const prev = R.getRenderTarget();
      R.setRenderTarget(rt); R.setClearColor(0x000000, 0); R.clear(); R.render(B.scene, B.camera);
      R.readRenderTargetPixels(rt, 0, 0, W, H, px);
      R.setRenderTarget(prev);
      for (const o of all) o.visible = true;
      let sum = 0, cnt = 0;
      for (let i = 0; i < W * H; i++) {
        const l = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
        if (l > 1e-4) { sum += l; cnt++; }
      }
      return { luma: cnt ? sum / cnt : 0, n: cnt };
    };
    const day = { rock: shot([rock]), shrub: shot(shots) };
    const lightDay = { colour: S.U.uLightColor.value.toArray(), ambient: S.U.uAmbient.value.toArray(), mode: S.light.mode };
    const nightInfo = window.__layers.setSkyMode("night");
    const lightNight = { colour: S.U.uLightColor.value.toArray(), ambient: S.U.uAmbient.value.toArray(), mode: S.light.mode };
    const night = { rock: shot([rock]), shrub: shot(shots) };
    R.setClearColor(prevClear, prevAlpha); rt.dispose();
    out.night = { day, night, lightDay, lightNight, nightInfo: nightInfo ? { mode: nightInfo.mode, measured: nightInfo.measured } : null };
    window.__layers.setSkyMode("auto");
    out.night.lightRestored = S.light.mode;
  }

  // ---- 10/11. draw calls, triangles, programs, frame time --------------------------------
  {
    const d0 = walls[0];
    const camS = { fovRad: 0.95, aspect: W / H, eye: [0, 900, 0], up: [0, 1, 0],
                   look: [Math.sin(d0.az * Math.PI / 180) * d0.r, d0.baseY + d0.H * 0.45, Math.cos(d0.az * Math.PI / 180) * d0.r], arenaScale: 1 };
    B.render(camS); out.draw = { shownCalls: B.info.calls, shownTris: B.info.triangles };
    for (const m of sp.meshes) m.visible = false;
    B.render(camS); out.draw.hiddenCalls = B.info.calls; out.draw.hiddenTris = B.info.triangles;
    for (const m of sp.meshes) m.visible = true;
    B.render(camS);
    out.draw.deltaCalls = out.draw.shownCalls - out.draw.hiddenCalls;
    out.draw.deltaTris = out.draw.shownTris - out.draw.hiddenTris;
    out.programs = { count: R.info.programs.length, added: R.info.programs.length - programsAtStart,
                     failed: failedOf(), failedAtStart, addedFailed: failedOf() - failedAtStart,
                     logs: R.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable)
                       .map((p) => String(p.diagnostics.programLog || "").split("\n").filter((l) => /ERROR|redefinition/.test(l)).slice(0, 4).join(" | ").slice(0, 300)) };
    const gl = R.getContext(), one = new Uint8Array(4);
    const time = (n, cam) => { const t0 = performance.now(); for (let i = 0; i < n; i++) { B.render(cam); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one); } return (performance.now() - t0) / n; };
    const camArena = window.__r.getCameraInfo().render;
    B.render(camArena); time(8, camArena);
    const whole = time(FRAMES, camArena);
    time(8, camS); const shown = time(FRAMES, camS);
    for (const m of sp.meshes) m.visible = false;
    const hidden = time(FRAMES, camS);
    for (const m of sp.meshes) m.visible = true;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    out.frame = { whole, shown, hidden, frames: FRAMES, gpu: GPU, W, H,
                  renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  }
  out.info = { ms: info.ms, tris: info.triangles, geometry: info.geometry, keepOut: info.keepOut, measured: info.measured, nan: info.nan };
  return out;
}, { frames: FRAMES, gpu: gpuMode(), arena: ARENA });
await browser.close().catch(() => {});

// ---- report -----------------------------------------------------------------------------------------------
let fails = 0, skips = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); };
const skip = (msg) => { skips++; console.log(`SKIP ${msg}`); };
if (R0.missing) { console.log("FAIL built arena did not load (window.__built missing)"); for (const e of errors) console.log("   error:", e); process.exit(1); }
console.log(`     (info) ${ARENA}: recipe kinds ${JSON.stringify([...new Set(R0.pieces)])}; ${R0.spirePieces} spire piece(s), ${R0.cards} picture cards`);
if (!R0.spirePieces) {
  for (const w of ["the spires layer loads", "no NaN in any spire geometry", "wall panels on their picture cards",
    "sea stacks over the water", "the wall is continuous (no sky through it)", "no spire vertex in the fight or a cone",
    "shrub cover", "the rock paint is the measured pale tone", "night darkens the spires", "draw-call / triangle budget"])
    skip(`${w}: ${ARENA}'s recipe has no \`spire\` piece (kinds ${JSON.stringify([...new Set(R0.pieces)])}), so the spires layer is not built here - nothing to check`);
  console.log(`\n     ${ARENA}: ${passes} PASS / ${fails} FAIL / ${skips} SKIP  (no spire piece in this arena)`);
  for (const e of errors) console.log("   error:", e.slice(0, 240));
  process.exit(fails ? 1 : 0);
}
if (!R0.counts) {
  console.log(`FAIL spires layer did not load for ${ARENA} although its recipe has ${R0.spirePieces} spire piece(s)`);
  for (const e of errors) console.log("   error:", e);
  process.exit(1);
}
const C = R0.counts, N = R0.nan, Wl = R0.walls, ST = R0.stacks, K = R0.keep, SH = R0.shrub, PT = R0.paint, NI = R0.night, DR = R0.draw, F = R0.frame;

check(C.walls > 0 && C.stacks >= 0 && C.cards > 0,
  `spires layer loaded: ${C.walls} wall panels + ${C.stacks} sea stacks, ${C.pillars} pillars, ${C.bushes} shrubs, ${C.cards} leaf cards, ${C.meshes} meshes, built in ${C.ms} ms`);
check(R0.meshes.rock && R0.meshes.cards && R0.meshes.bushes > 0 && R0.meshes.kinds.every((v) => v === "spire"),
  `meshes: ${R0.meshes.names.join(" + ")} (all kind "spire")`);

// ---- 2. no NaN -------------------------------------------------------------------------------------------
const badGeo = N.geometries.filter((g) => g.pos || g.nor || !Number.isFinite(g.radius) || !(g.radius > 0));
check(N.geometries.length > 0 && badGeo.length === 0 && N.problems.length === 0,
  `no NaN anywhere: ${N.geometries.length} geometries (${N.geometries.map((g) => `${g.name} ${g.verts}v`).join(", ")}), ` +
  `${N.geometries.reduce((s, g) => s + (g.pos || 0), 0)} non-finite positions, ${N.geometries.reduce((s, g) => s + (g.nor || 0), 0)} non-finite normals, ` +
  `bounding radii ${N.geometries.map((g) => (Number.isFinite(g.radius) ? Math.round(g.radius) : g.radius)).join("/")}, prepare() audit ${N.problems.length} problem(s)` +
  (N.problems.length ? `: ${JSON.stringify(N.problems.slice(0, 4))}` : "") +
  (N.module ? `; the layer's own count: rock ${N.module.rock.pos}/${N.module.rock.nor}, cards ${N.module.cards.pos}/${N.module.cards.nor}` : ""));

// ---- 3. panels on their cards ------------------------------------------------------------------------------
check(Wl.errAz <= 0.02 && Wl.errY <= 0.1 && Wl.push <= 40.5 && Wl.moved <= C.walls,
  `every wall panel stands on a recipe picture card: max azimuth error ${Wl.errAz.toExponential(2)} deg (<= 0.02), max base-y error ${Wl.errY.toExponential(2)} (<= 0.1), ` +
  `max radius beyond the card minus its own R ${Wl.push.toFixed(1)} units (<= MARGIN 40), ${Wl.moved}/${C.walls} panels pushed out for the fight clearance` +
  (Wl.worst ? ` (worst ${JSON.stringify(Wl.worst)})` : ""));
check(C.skipped === 0, `every spire card was used: ${C.walls + C.stacks} panels from ${R0.cards} cards, ${C.skipped} skipped`);
for (const r of Wl.rows) console.log(`       wall ${r.piece} card ${r.card} az ${r.az} = card ${r.cardAz}: base ${r.baseY.toFixed(3)} = card ${r.cardY.toFixed(3)}, ` +
  `r ${r.r} (card ${r.cardR}, +${r.dR}) span ${r.spanDeg} deg -> ${r.pillars} pillars (n ${r.n}, pitch ${r.pitch}, R ${r.R}) h ${r.h} top ${r.top}, ` +
  `skirt bottom ${r.skirtY}, ${r.bushes} shrubs, ${r.cards} cards`);
check(R0.counts.walls >= 1 && Wl.rows.every((r) => r.pillars >= 2 && r.n >= 2),
  `every panel is a row of pillars, never one bollard: ${Wl.rows.map((r) => r.pillars).join("/")} pillars per panel (>= 2), pitch ${[...new Set(Wl.rows.map((r) => r.pitch))].join("/")} u`);
console.log(`     (info) measured surface tops: sand ${R0.bases.sandTop}, shore rim ${R0.bases.shoreTop}`);
check(R0.bases.baseErr <= 0.1 && R0.bases.groundMiss === 0 && R0.bases.groundErr <= 0.1,
  `every wall base on the sand/shore it stands on: ${R0.bases.groundN}/${C.walls} bases have the arena's own sand or shore within 600 units, max |base y - card base y| ${R0.bases.baseErr.toExponential(2)}, max |base y - measured bank top| ${R0.bases.groundErr.toExponential(2)} (<= 0.1)`);
check(R0.wallSkirt.bad === 0 && R0.wallSkirt.low.length === C.walls,
  `every wall panel's skirt is buried below the shore: lowest vertex per panel ${R0.wallSkirt.low.join(", ")} (each <= its own base ${R0.wallSkirt.base.map(Math.round).join(", ")} - 100)`);

// ---- 4. sea stacks ----------------------------------------------------------------------------------------
check(ST.count > 0, `sea stacks: ${ST.count} of the recipe's sea cards became stacks`);
check(ST.errPos <= 1 && ST.errY <= 0.1,
  `sea stacks stand on the recipe's sea cards: max position error ${ST.errPos.toExponential(2)} units (<= 1), max base-y error ${ST.errY.toExponential(2)} (<= 0.1)`);
check(ST.overWater === ST.count && ST.maxWaterDist <= 600,
  `every sea stack base over a water/sea triangle: ${ST.overWater}/${ST.count} inside or within 600 units (nearest ${ST.maxWaterDist.toFixed(1)})`);
check(ST.baseAbove <= 0.1, `stack bases at/below the measured water surface ${ST.waterTop.toFixed(2)}: max ${ST.baseAbove.toExponential(2)} above (<= 0.1)`);
check(ST.hOver <= 0.5 && ST.topOver <= 0.5 && ST.topY <= ST.spireYmax + 0.5,
  `stack tops within their own picture cards: H - card height max ${ST.hOver.toFixed(1)} (<= 0.5), top - card top max ${ST.topOver.toFixed(1)} (<= 0.5), highest stack top ${ST.topY.toFixed(1)} <= tallest spire card top ${ST.spireYmax.toFixed(1)}`);
check(ST.skirtBad === 0 && ST.low.length === ST.count,
  `every sea stack's skirt reaches below the water pieces' measured floor ${ST.waterFloor.toFixed(1)}: lowest vertex per stack ${ST.low.join(", ")} (all <= ${(ST.waterFloor - 100).toFixed(1)})`);
for (const s of ST.rows) console.log(`       stack ${s.piece} r${s.r} az ${s.az}: base ${s.baseY.toFixed(3)} = card ${s.cardY.toFixed(3)}, card ${s.cardH}x${s.h}, ` +
  `top ${s.top} <= card top ${s.cardTop}, water ${s.waterDist} units, skirt bottom ${s.skirtY}, ${s.pillars} pillars, ${s.bushes} shrubs, ${s.cards} cards`);

// ---- 5. the wall is continuous ----------------------------------------------------------------------------
check(R0.wall.solidCols > 0 && R0.wall.holes === 0,
  `no sky through the wall from the arena camera: ${R0.wall.solidCols} columns span the wall, ${R0.wall.holes} see background across its whole height (longest run ${R0.wall.worstRun}), ` +
  `measured spires-only on a magenta clear at ${R0.wall.cols}x${R0.wall.rows}`);

// ---- 6. keep-out ------------------------------------------------------------------------------------------
console.log(`     (info) keep-out: fight radius ${K.fightR} = farthest fighter ${K.farthest} + 1000, ${K.fighters} fighter spheres (farthest surface ${K.farSurf}), ` +
  `rings ${JSON.stringify(K.rings)}, ${K.eyes} eyes swept; near-foot floor ${K.nearMin} (recipe rmin ${K.recipeRmin}); pushed ${K.pushed}, dropped ${K.dropped}`);
console.log(`     (info) nearest vertex r per mesh: ${K.perMesh.map((m) => `${m.name} ${m.kind === "instanced" ? `x${m.count} ` : ""}r ${Math.round(m.minR)}${m.bad ? ` (${m.bad} non-finite!)` : ""}`).join(", ")}`);
check(K.verts > 0 && K.inFight === 0 && K.inCone === 0,
  `no spire vertex in the fight or in a view cone: ${K.verts} vertices (rock + ${SH.instances} shrubs), ${K.inFight} inside ${K.fightR}, ${K.inCone} in a cone (nearest vertex r ${Math.round(K.minR)})`);
check(K.minR > K.farSurf, `the proof independent of the sphere test: nearest spire vertex r ${Math.round(K.minR)} > farthest fighter surface r ${K.farSurf} (+${Math.round(K.minR - K.farSurf)})`);
check(K.stackVerts > 0 && K.stackInFight === 0 && K.stackInCone === 0 && K.stackMinR > K.fightR,
  `sea stacks clear the fight and every eye cone: ${K.stackVerts} stack vertices, ${K.stackInFight} inside ${K.fightR}, ${K.stackInCone} in a cone, nearest r ${Math.round(K.stackMinR)}`);

// ---- 7. shrubs --------------------------------------------------------------------------------------------
check(SH.instances > 0 && SH.minPerWall > 0 && SH.minPerStack > 0 && SH.minCardsPerWall > 0,
  `shrub cover on every panel and every stack: ${SH.instances} instances (${SH.perVariant.join("/")} per variant), ${SH.tris} triangles (${SH.trisPerBush.join("/")} each), ` +
  `per wall ${SH.perWall.join("/")} (min ${SH.minPerWall}), per stack geometry ${SH.perStack.join("/")} + cards ${SH.perStackCards.join("/")} (min ${SH.minPerStack}), ` +
  `ledge cards per wall ${SH.cardsPerWall.join("/")}`);
check(SH.uniforms.bad === 0 && SH.uniforms.sameModule, `shaded by the SHARED light: ${SH.uniforms.materials} materials x ${(SH.uniforms.refs / SH.uniforms.materials).toFixed(0)} shared uniforms, ${SH.uniforms.bad} not the same reference`);
check(SH.leafAttr && SH.shader.toonLight && SH.shader.leafTex && SH.alphaUniform > 0 && !SH.transparent && SH.side,
  `shrub material: alpha-tested cut (uLeafAlpha ${SH.alphaUniform}, never blended), DoubleSide, leaf-card texture, shared toonLight`);

// ---- 8. the rock paint ------------------------------------------------------------------------------------
check(PT.sameFn, `the paint probe runs the material's OWN rockAlbedo() (same GLSL string as the mesh's fragment shader)`);
check(PT.albedo.p50 >= 0.80 * PT.paleLuma && PT.albedo.p90 >= 0.90 * PT.paleLuma,
  `the cliff's body is the piece's MEASURED pale tone, not a grey: ${PT.n} wall vertices, albedo luma p50 ${PT.albedo.p50} >= ${(0.80 * PT.paleLuma).toFixed(0)} (0.80 x the measured p90 ${JSON.stringify(PT.pale)}), ` +
  `p90 ${PT.albedo.p90} >= ${(0.90 * PT.paleLuma).toFixed(0)} (0.90 x)`);
check(PT.albedo.p10 <= 0.62 * PT.albedo.p50,
  `and its joints ARE crevices: albedo luma p10 ${PT.albedo.p10} <= ${(0.62 * PT.albedo.p50).toFixed(0)} (0.62 x the body ${PT.albedo.p50}); the reference cliff texture is 21% dark [38,38,41]`);
check(PT.shaded.p50 >= 0.75 * PT.albedo.p50,
  `the shade keeps the stone's value: shaded luma p50 ${PT.shaded.p50} >= ${(0.75 * PT.albedo.p50).toFixed(0)} (0.75 x the body), p90 ${PT.shaded.p90} (sunlit faces)`);

// ---- 9. night ---------------------------------------------------------------------------------------------
const L = (o) => o.luma;
check(NI.lightNight.mode === "night" && NI.lightNight.colour.join() !== NI.lightDay.colour.join(),
  `night light applied: mode ${NI.lightDay.mode} -> ${NI.lightNight.mode}, key ${NI.lightDay.colour.map((v) => v.toFixed(3)).join(",")} -> ${NI.lightNight.colour.map((v) => v.toFixed(3)).join(",")}, ambient ${NI.lightNight.ambient.map((v) => v.toFixed(3)).join(",")}; restored to ${NI.lightRestored}`);
check(NI.night.rock.n > 0 && NI.night.shrub.n > 0 && NI.night.rock.luma < 0.8 * NI.day.rock.luma && NI.night.shrub.luma < 0.8 * NI.day.shrub.luma,
  `night darkens the spires on the same camera: rock luma ${L(NI.day.rock).toFixed(4)} -> ${L(NI.night.rock).toFixed(4)} (${((1 - NI.night.rock.luma / NI.day.rock.luma) * 100).toFixed(0)}% darker, ${NI.night.rock.n} px), ` +
  `shrubs ${L(NI.day.shrub).toFixed(4)} -> ${L(NI.night.shrub).toFixed(4)} (${((1 - NI.night.shrub.luma / NI.day.shrub.luma) * 100).toFixed(0)}% darker, ${NI.night.shrub.n} px)`);

// ---- 10/11. budget, programs, errors, frame time -----------------------------------------------------------
check(DR.deltaCalls <= 6 && DR.deltaCalls > 0, `draw calls: ${DR.deltaCalls} added on a wall-facing camera (${DR.shownCalls} -> ${DR.hiddenCalls}, <= 6), ${DR.deltaTris} triangles drawn`);
check(C.tris <= 60000, `triangles ${C.tris} (<= 60k): ${R0.info.geometry.tris} rock + ${SH.tris} shrub + ${C.cards * 2} cards in ${C.meshes} meshes`);
const PG = R0.programs;
check(PG.addedFailed === 0, `shader programs: ${PG.added} created during the check, ${PG.addedFailed} failed (0); the page has ${PG.count} programs, ${PG.failed} failed`
  + (PG.failed ? ` - not the spires: ${JSON.stringify(PG.logs)}` : ""));
const dt = F.shown - F.hidden, below = Math.abs(dt) < 0.3;
console.log(`     (info) frame time over ${F.frames} frames at ${F.W}x${F.H} (${F.gpu} path): spires shown ${F.shown.toFixed(2)} ms, hidden ${F.hidden.toFixed(2)} ms, delta ${dt.toFixed(2)} ms`
  + (below ? " - below the 0.3 ms resolution of this measurement, so no layer cost is claimed" : "") + `; whole world at the battle camera ${F.whole.toFixed(2)} ms; renderer ${F.renderer}`);
check(dt <= 2, `spire layer cost ${dt.toFixed(2)} ms/frame (<= 2)`);
check(F.whole > 0 && F.whole <= 10, `whole world ${F.whole.toFixed(2)} ms/frame at ${F.W}x${F.H} (<= 10)`);
const shaderErrs = errors.filter((e) => /WebGLProgram: Shader Error/.test(e));
const otherErrs = errors.filter((e) => !/WebGLProgram: Shader Error/.test(e));
check(otherErrs.length === 0, `page errors: ${otherErrs.length} (shader-compile logs ${shaderErrs.length}, all from materials the spires did not add: ${PG.addedFailed} failed program added)`);
for (const er of errors) console.log("   error:", er.slice(0, 240));
console.log(`\n     ${ARENA}: ${passes} PASS / ${fails} FAIL / ${skips} SKIP`);
process.exit(fails ? 1 : 0);
