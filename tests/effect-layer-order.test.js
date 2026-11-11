// Signature-attack screen effects must not cover the attacker: op3 sprites spawned at z == -1 (every
// effect except 1000-1002 and 1007) are drawn BEFORE the fighters in the original ordering table
// (sprite_anim.c:13-45, sprite_effect.c:432-438), z == 0x7FFF and the FRONT effects AFTER them.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { EffectPlayer, effectLayer, drawEffects, spriteGeometry, spriteCorners, effectClip } from "../web/fight/effect-player.js";
import { drawUnderEffects } from "../web/fight/effect-under-gl.js";

const rec = { mask: 0, stride: 0, duration: 80, defaults: [10, 0, 0, 0, 4096, 4096, 0, 0, 0], frames: [], clipA: 0, clipB: 0, clipId: 0 };
const manifestFor = (types) => ({ types: Object.fromEntries(types.map(t => [t, { arch: 3, records: [rec] }])), archives: {} });

test("effectLayer: z=-1 of a non-FRONT effect is under; z=32767 and FRONT effects are over", () => {
  const p = new EffectPlayer(manifestFor([1020, 1009, 1000, 1001, 1002, 1007]));
  const at = (type, z) => { p.clear(); p.spawn(type, { x: 0, y: 0, z }); p.step(1); return effectLayer(p.renderList()[0]); };
  assert.equal(at(1020, -1), "under");
  assert.equal(at(1009, -1), "under");
  assert.equal(at(1020, 32767), "over");
  assert.equal(at(1009, 32767), "over");
  for (const t of [1000, 1001, 1002, 1007]) { assert.equal(at(t, -1), "over", `FRONT ${t} z=-1`); assert.equal(at(t, 32767), "over"); }
  assert.equal(at(1020, 5), "over");                         // a world-space point is projected, not a sentinel
});

test("effectLayer: a descriptor without an effect type (synthetic presentation sprite) is never under", () => {
  assert.equal(effectLayer({ screen: true, pos: { x: 0, y: 0, z: -1 } }), "over");
});

test("frame draw order: stage/backdrop, then under-sprites, then fighters; getEffectDraw drops them from the 2D pass", () => {
  const src = fs.readFileSync(new URL("../web/battle3d.js", import.meta.url), "utf8");
  const at = (needle, from = 0) => { const i = src.indexOf(needle, from); assert.ok(i >= 0, needle); return i; };
  const sky = at("drawQuad(gl, texP, IDENT_MVP, skyBufs");
  const floor = at("drawQuad(gl, texP, pv, floorBufs", sky);
  const under = at("drawUnderEffects(gl,", floor);
  const player = at("drawSkeletalMesh(gl, texP, pv, playerSkelBufs", under);
  assert.ok(sky < floor && floor < under && under < player);
  assert.match(src, /renderList\(\)\.filter\(s => effectLayer\(s\) !== "under"\)/);
  assert.match(src, /renderList\(\)[^\n]*\.filter\(s => effectLayer\(s\) === "under"\)/);
});

// ── the GL pass ───────────────────────────────────────────────────────────────
function fakeGl() {
  const calls = [];
  const C = new Proxy({}, { get: (_, k) => k });
  const gl = new Proxy({ calls }, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === "string" && /^[A-Z_0-9]+$/.test(k)) return k;       // GL constants as their names
      return (...a) => {
        calls.push([k, ...a]);
        if (k === "getParameter") return a[0] === "COLOR_WRITEMASK" ? [true, true, true, true] : null;
        if (k === "getVertexAttrib" || k === "isEnabled") return false;
        if (k === "getShaderParameter" || k === "getProgramParameter") return true;
        if (k === "getAttribLocation") return a[1] === "aP" ? 0 : 1;
        return {};
      };
    },
  });
  return { gl, calls, C };
}

test("drawUnderEffects: PS1 blends, no depth test/write, colour-only writes for semi modes", () => {
  const manifest = { archives: { 3: { clips: {
    1: { x: 0, y: 0, w: 32, h: 32, ox: -16, oy: -16 },               // opaque
    2: { x: 0, y: 0, w: 32, h: 32, ox: -16, oy: -16, semi: 0 },
    3: { x: 0, y: 0, w: 32, h: 32, ox: -16, oy: -16, semi: 1 },
    4: { x: 0, y: 0, w: 32, h: 32, ox: -16, oy: -16, semi: 2 },
    5: { x: 0, y: 0, w: 32, h: 32, ox: -16, oy: -16, semi: 3 },
  } } } };
  const images = { 3: { width: 64, height: 64 } };
  const view = { centerX: 160, centerY: 120, pxScale: 1, worldToScreen: () => null };
  const sprite = (frame) => ({ arch: 3, frame, clutShift: 0, screen: true, pos: { x: 0, y: 0, z: -1 }, dx: 0, dy: 0, sx: 1, sy: 1, rotX: 0, rotY: 0, rotZ: 0, type: 1020 });
  const { gl, calls } = fakeGl();
  const n = drawUnderEffects(gl, [1, 2, 3, 4, 5].map(sprite), manifest, images, view, 320, 240);
  assert.equal(n, 5);
  const names = calls.map(c => c[0]);
  assert.ok(names.includes("disable") && calls.some(c => c[0] === "disable" && c[1] === "DEPTH_TEST"));
  assert.ok(calls.some(c => c[0] === "depthMask" && c[1] === false));
  const draws = [];
  let blend = null, k = 1;
  for (const c of calls) {
    if (c[0] === "enable" && c[1] === "BLEND") blend = [];
    if (c[0] === "blendEquation") blend?.push(c[1]);
    if (c[0] === "blendFunc") blend?.push(`${c[1]}/${c[2]}`);
    if (c[0] === "blendFuncSeparate") blend?.push(`${c[1]}/${c[2]}|${c[3]}/${c[4]}`);
    if (c[0] === "uniform1f") k = c[2];
    if (c[0] === "drawArrays") draws.push([...blend, `K=${k}`]);
  }
  // fragment alpha = texel alpha * K, blended with SRC_ALPHA: the canvas result per texel
  assert.deepEqual(draws[0], ["FUNC_ADD", "SRC_ALPHA/ONE_MINUS_SRC_ALPHA|ONE/ONE_MINUS_SRC_ALPHA", "K=1"]);   // opaque = source-over
  assert.deepEqual(draws[1], ["FUNC_ADD", "SRC_ALPHA/ONE_MINUS_SRC_ALPHA", "K=0.5"]);        // 0.5B + 0.5F
  assert.deepEqual(draws[2], ["FUNC_ADD", "SRC_ALPHA/ONE", "K=1"]);                          // B + F
  assert.deepEqual(draws[3], ["FUNC_ADD", "FUNC_REVERSE_SUBTRACT", "SRC_ALPHA/ONE", "K=1"]); // B - F
  assert.deepEqual(draws[4], ["FUNC_ADD", "SRC_ALPHA/ONE", "K=0.25"]);                       // B + 0.25F
  // depth and blend state are given back as found (isEnabled said false)
  const last = (n, a) => calls.filter(c => c[0] === n && (a === undefined || c[1] === a)).pop();
  assert.equal(last("disable", "DEPTH_TEST") !== undefined, true);
  assert.equal(calls.filter(c => c[0] === "enable" && c[1] === "DEPTH_TEST").length, 0);
});

test("one placement: the GL corners equal where drawEffects puts the image (rotation, tip, mirror)", () => {
  const clip = { x: 4, y: 8, w: 40, h: 20, ox: -10, oy: -6 };
  const manifest = { archives: { 3: { clips: { 1: clip } } } };
  const view = { centerX: 320, centerY: 240, pxScale: 2, worldToScreen: () => null };
  const cases = [
    { sx: 1.5, sy: 0.75, rotX: 0, rotY: 0, rotZ: 0 },
    { sx: 1, sy: 1, rotX: 0, rotY: 0, rotZ: 1024 },
    { sx: -1, sy: 1, rotX: 300, rotY: 500, rotZ: 700 },
    { sx: 1, sy: -2, rotX: 0, rotY: 0, rotZ: 2000 },
  ];
  for (const c of cases) {
    const s = { arch: 3, frame: 1, clutShift: 0, screen: true, pos: { x: 5, y: -7, z: -1 }, dx: 3, dy: 4, ...c };
    const rec2 = [];
    let m = [1, 0, 0, 1, 0, 0];
    const ctx = {
      save() {}, restore() {},
      transform(a, b, cc, d, e, f) {
        const [A, B, C, D, E, F] = m;
        m = [A * a + C * b, B * a + D * b, A * cc + C * d, B * cc + D * d, A * e + C * f + E, B * e + D * f + F];
      },
      drawImage(_i, _sx, _sy, _sw, _sh, dx, dy, w, h) {
        rec2.push([[dx, dy], [dx + w, dy], [dx + w, dy + h], [dx, dy + h]].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]));
      },
    };
    drawEffects(ctx, [s], manifest, { 3: {} }, view);
    const g = spriteGeometry(s, clip, view);
    const gl = spriteCorners(g);
    assert.equal(rec2.length, 1);
    for (let i = 0; i < 4; i++) { assert.ok(Math.abs(rec2[0][i][0] - gl[i][0]) < 1e-9 && Math.abs(rec2[0][i][1] - gl[i][1]) < 1e-9, JSON.stringify(c)); }
  }
});

test("DNA fusion burst 1003 carries its real type: under at z=-1; 1000/1001 (FRONT) stay over; orbs not proven", () => {
  const src = fs.readFileSync(new URL("../web/battle3d.js", import.meta.url), "utf8");
  // _sampleEffectRecord returns the effect type
  assert.match(src, /type: Number\(type\),[^\n]*\n\s*arch: typeRec\.arch/);
  assert.match(src, /function _dnaSampleSprites\(\)/);
  // the GL under pass includes the samples; the 2D pass drops the under ones
  assert.match(src, /\[\.\.\.effectPlayer\.renderList\(\), \.\.\._dnaSampleSprites\(\)\]\.filter\(s => effectLayer\(s\) === "under"\)/);
  assert.match(src, /_dnaSampleSprites\(\)\.filter\(x => effectLayer\(x\) !== "under"\)/);
  const burst = { type: 1003, screen: true, pos: { x: -160, y: -120, z: -1 } };
  assert.equal(effectLayer(burst), "under");
  for (const t of [1000, 1001]) assert.equal(effectLayer({ type: t, screen: true, pos: { x: 0, y: 0, z: 32767 } }), "over");
});

// ── FRONT-layer placement (DIAG-stage-fire.md BUG 1) ─────────────────────────────
// The original counts an effect's screen point against the DRAW OFFSET OF ITS LAYER:
// sprite_effect.c:457-461 sends ids 1000-1002 and 1007 to BATTLE_LAYER_FRONT and every other
// id to BATTLE_LAYER_MODELS; types.h:59-61 gives FRONT setOffset(0,0) and MODELS
// setOffset(0xA0,0x78) = (160,120), applied as the GPU draw-env origin in layer.c:136-137.
// So the 4 FRONT ids are authored top-left and spriteGeometry() must subtract (160,120)
// before scaling, or 1002/1007 land half a screen down-right.
test("FRONT ids subtract (160,120): 1000-1002/1007 top-left origin; 1003/1008 stay centre-relative", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../web/assets/battle/effects/manifest.json", import.meta.url), "utf8"));
  const view = { centerX: 160, centerY: 120, pxScale: 1, worldToScreen: () => null };
  const centres = (type, pos, tick) => {
    const ep = new EffectPlayer(manifest);
    ep.spawn(type, pos, "player");
    for (let i = 0; i < tick; i++) ep.step(1);
    const out = [];
    for (const s of ep.renderList()) {
      const clip = effectClip(manifest.archives[String(s.arch)], s);
      if (!clip || !clip.w || !clip.h) continue;
      const g = spriteGeometry(s, clip, view);
      if (!g) continue;
      const c = spriteCorners(g);
      out.push([c.reduce((a, p) => a + p[0], 0) / 4, c.reduce((a, p) => a + p[1], 0) / 4].map((v) => Math.round(v)));
    }
    return out;
  };
  // The sprite centre (corner centroid) in PSX px, from DIAG-stage-fire.md BUG 1 numbers.
  assert.deepEqual(centres(1002, { x: 160, y: 120, z: 32767 }, 40), [[160, 125]]);
  assert.deepEqual(centres(1000, { x: 0, y: 0, z: 32767 }, 40), [[170, 145]]);
  assert.deepEqual(centres(1001, { x: 0, y: 0, z: 32767 }, 40), [[164, 137]]);
  assert.deepEqual(centres(1007, { x: 0, y: 0, z: 32767 }, 40), [[80, 176], [240, 176]]);
  // MODELS-layer effects are centre-relative and must not move.
  assert.deepEqual(centres(1003, { x: -160, y: -120, z: -1 }, 40), [[160, 120], [160, 120]]);
  assert.deepEqual(centres(1008, { x: -160, y: -120, z: -1 }, 40), [[72, 160], [248, 160]]);
});

// ── GL pass == drawEffects, texel by texel ─────────────────────────────────────────
// A synthetic sprite with a transparent texel (alpha 0), a solid half-alpha texel and a full texel, per
// semi mode: the colour the recorded GL state gives (SRC_ALPHA weighting, K, equation) equals what the
// canvas state drawEffects sets gives. Semi 2: the canvas has no subtract (multiply + invert approximation),
// so GL is compared with the true B - F of the original.
test("GL under pass writes what drawEffects blends: transparent skipped, semi weighted by texel alpha", () => {
  const texels = [[0, 0, 0, 0], [0.8, 0.6, 0.4, 0.5], [0.8, 0.6, 0.4, 1]];   // rgb straight, alpha
  const B = [0.3, 0.5, 0.7];
  const clamp = (v) => Math.min(1, Math.max(0, v));
  for (const semi of [undefined, 0, 1, 2, 3]) {
    const manifest = { archives: { 3: { clips: { 1: { x: 0, y: 0, w: 8, h: 8, ox: 0, oy: 0, ...(semi === undefined ? {} : { semi }) } } } } };
    const view = { centerX: 160, centerY: 120, pxScale: 1, worldToScreen: () => null };
    const s = { arch: 3, frame: 1, clutShift: 0, screen: true, pos: { x: 0, y: 0, z: -1 }, dx: 0, dy: 0, sx: 1, sy: 1, rotX: 0, rotY: 0, rotZ: 0, type: 1020 };
    // 2D: the state drawEffects sets before drawImage
    let st = null;
    const ctx = { globalCompositeOperation: "source-over", globalAlpha: 1, filter: "none", save() {}, restore() {}, transform() {}, drawImage() { st ??= { op: this.globalCompositeOperation, ga: this.globalAlpha }; } };
    drawEffects(ctx, [s], manifest, { 3: { width: 8, height: 8 } }, view);
    // GL: the recorded state
    const { gl, calls } = fakeGl();
    drawUnderEffects(gl, [s], manifest, { 3: { width: 8, height: 8 } }, view, 320, 240);
    const pre = calls.slice(0, calls.findIndex(c => c[0] === "drawArrays"));   // state at the draw, not the restore after it
    const eq = pre.filter(c => c[0] === "blendEquation").pop()?.[1];
    const kk = pre.filter(c => c[0] === "uniform1f").pop()[2];
    const sepAlpha = pre.some(c => c[0] === "blendFuncSeparate");
    const fn = pre.filter(c => c[0] === "blendFunc").pop();
    for (const [r, g, b, a] of texels) {
      const F = [r, g, b];
      let canvas;
      if (a === 0) canvas = B;                                                    // canvas draws nothing
      else if (semi === 2) canvas = B.map((v, i) => clamp(v - F[i] * a));          // original B - F (weighted)
      else if (st.op === "lighter") canvas = B.map((v, i) => clamp(v + F[i] * a * st.ga));
      else canvas = B.map((v, i) => v * (1 - a * st.ga) + F[i] * a * st.ga);
      let out;
      if (a === 0) out = B;                                                       // discard
      else {
        const sa = a * kk;
        const dstF = (sepAlpha || fn[2] === "ONE_MINUS_SRC_ALPHA") ? (1 - sa) : 1;
        out = B.map((v, i) => clamp(eq === "FUNC_REVERSE_SUBTRACT" ? v * dstF - F[i] * sa : v * dstF + F[i] * sa));
      }
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(canvas[i] - out[i]) < 1e-9, `semi ${semi} texel a=${a} ch${i}: canvas ${canvas[i]} gl ${out[i]}`);
    }
  }
});

test("GL under pass: UV is clamped half a texel inside the clip rect (no neighbouring sheet cell)", () => {
  const manifest = { archives: { 3: { clips: { 1: { x: 16, y: 32, w: 8, h: 8, ox: 0, oy: 0, semi: 1 } } } } };
  const view = { centerX: 160, centerY: 120, pxScale: 1, worldToScreen: () => null };
  const s = { arch: 3, frame: 1, clutShift: 0, screen: true, pos: { x: 0, y: 0, z: -1 }, dx: 0, dy: 0, sx: 1, sy: 1, rotX: 0, rotY: 0, rotZ: 0, type: 1008 };
  const { gl, calls } = fakeGl();
  drawUnderEffects(gl, [s], manifest, { 3: { width: 64, height: 128 } }, view, 320, 240);
  const u = calls.find(c => c[0] === "uniform4f");
  assert.deepEqual(u.slice(2), [(16 + 0.5) / 64, (32 + 0.5) / 128, (24 - 0.5) / 64, (40 - 0.5) / 128]);
});
