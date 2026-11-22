import { assetMode } from "../../assets.js";
import {
  loadTexturePixels,
  createProgram,
  arenaCullIndices,
  drawSkeletalMesh,
  drawQuad,
  drawProjLayerIndexed,
  makeQuadBuffers,
} from "../gl.js";
import { MODEL_SCALE, mat4Perspective, mat4LookAt, ps1ToRenderMatrix } from "../math.js";
import { mat4Mul, mat4Translate, mat4Scale } from "../../fight/proj-layers.js";
import type { Battle3DContext, PanoProjectOptions, PanoState } from "../../types/battle3d.js";
type Vec3 = Float32Array | number[];


// moved by tools/rewrite/split-closure.mjs
export function makePano(B$: Battle3DContext) {
// ETS item 9: createBattle3D sets the GL context, the texture program and the tuning constants before any of this runs, so the `!` on those B$ fields below are safe.
function _panoTex(px: { data: ImageDataArray; width: number; height: number; scale: number; }, repeat: boolean) {
    const tex = B$.gl!.createTexture();
    B$.gl!.bindTexture(B$.gl!.TEXTURE_2D, tex);
    B$.gl!.texImage2D(B$.gl!.TEXTURE_2D, 0, B$.gl!.RGBA, px.width, px.height, 0, B$.gl!.RGBA, B$.gl!.UNSIGNED_BYTE, new Uint8Array(px.data.buffer, px.data.byteOffset, px.data.length));
    if (repeat) B$.gl!.generateMipmap(B$.gl!.TEXTURE_2D);   // 512 x 512: a power of two, so it may repeat and mipmap
    B$.gl!.texParameteri(B$.gl!.TEXTURE_2D, B$.gl!.TEXTURE_MIN_FILTER, repeat ? B$.gl!.LINEAR_MIPMAP_LINEAR : B$.gl!.LINEAR);
    B$.gl!.texParameteri(B$.gl!.TEXTURE_2D, B$.gl!.TEXTURE_MAG_FILTER, B$.gl!.LINEAR);
    B$.gl!.texParameteri(B$.gl!.TEXTURE_2D, B$.gl!.TEXTURE_WRAP_S, repeat ? B$.gl!.REPEAT : B$.gl!.CLAMP_TO_EDGE);
    B$.gl!.texParameteri(B$.gl!.TEXTURE_2D, B$.gl!.TEXTURE_WRAP_T, repeat ? B$.gl!.REPEAT : B$.gl!.CLAMP_TO_EDGE);
    return tex;
  }
function _panoActive() {
    if (!window.__fx?.battlepano || assetMode() !== "hd" || B$.arenaStageReq?.mapId == null) return null;
    // The map's own painting (s<map>.png) if there is one, else the painting of the arena it fights in (meft10xx.png),
    // shared by every map that uses that arena. key = map + arena; id = the file actually used.
    const mapId = "s" + String(B$.arenaStageReq.mapId).replace(/^s/, ""), key = mapId + "|" + (B$.activeArena?.name ?? "");
    if (B$.pano?.key !== key) {
      const me = B$.pano = { key, id: mapId, tex: null, px: null, ground: null, mesh: null, missing: false } as PanoState;
      const tries = [mapId, B$.activeArena?.name].filter(Boolean);
      const load = (id: string | undefined) => {
        loadTexturePixels(`assets-hd/battle/panoramas/${id}.png`).then((px) => {
          if (B$.pano !== me) return;
          if (!px || px.width > B$.gl!.getParameter(B$.gl!.MAX_TEXTURE_SIZE)) { if (tries.length) load(tries.shift()); else me.missing = true; return; }
          me.id = id; me.px = px; me.tex = _panoTex(px, false);
          fetch(`assets-hd/battle/panoramas/${id}_paint.json`).then((r) => (r.ok ? r.json() : null)).then((meta) => {
            if (B$.pano !== me || !meta) return;
            loadTexturePixels(`assets-hd/battle/panoramas/${id}_floor.png`).then((f) => {
              if (B$.pano === me && f && f.width <= B$.gl!.getParameter(B$.gl!.MAX_TEXTURE_SIZE)) { me.paint = { meta, floor: _panoTex(f, (f.width & (f.width - 1)) === 0 && f.width === f.height) }; me.mesh = null; }
            });
          }).catch(() => {});
          loadTexturePixels(`assets-hd/battle/panoramas/${id}_ground.png`).then((g) => {
            const pow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
            if (B$.pano === me && g && pow2(g.width) && pow2(g.height)) me.ground = _panoTex(g, true);
          });
          const base = `assets-hd/battle/panoramas/${id}_depth`;
          Promise.all([fetch(base + ".json").then((r) => (r.ok ? r.json() : null)), fetch(base + ".bin").then((r) => (r.ok ? r.arrayBuffer() : null))])
            .then(([meta, buf]) => { if (B$.pano === me && !me.paint && meta && buf && buf.byteLength === meta.cols * meta.rows * 4) me.mesh = _panoMeshBuild(meta, new Float32Array(buf)); })
            .catch(() => {});
        });
      };
      load(tries.shift());
    }
    return B$.pano.tex ? B$.pano : null;
  }
function _paintFloorMask(g) {
    if (g.paintFloor) return g.paintFloor;
    const P = g.pos, nt = (P.length / 9) | 0, m = new Uint8Array(nt), k = MODEL_SCALE, cap = B$.pano!.paint!.meta.floorCap, half = B$.pano!.paint!.meta.floorHalf;
    for (let t = 0; t < nt; t++) {
      const v = [0, 1, 2].map((i) => [P[t * 9 + i * 3] * k, -P[t * 9 + i * 3 + 1] * k, -P[t * 9 + i * 3 + 2] * k]);
      const e1 = [v[1]![0]! - v[0]![0]!, v[1]![1]! - v[0]![1]!, v[1]![2]! - v[0]![2]!], e2 = [v[2]![0]! - v[0]![0]!, v[2]![1]! - v[0]![1]!, v[2]![2]! - v[0]![2]!];
      const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!], nl = Math.hypot(...n) || 1;
      const cx = (v[0]![0]! + v[1]![0]! + v[2]![0]!) / 3, cz = (v[0]![2]! + v[1]![2]! + v[2]![2]!) / 3;
      m[t] = Math.abs(n[1]! / nl) > 0.9 && v.every((q) => q[1]! < cap) && Math.abs(cx) < half && Math.abs(cz) < half ? 1 : 0;
    }
    return (g.paintFloor = m);
  }
function _drawArenaPaint(p, mvp: Float32List, world: Iterable<number>, atm: { gradeSub: Iterable<number>; }) {
    if (!B$.panoPaintProg) {
      const pr = createProgram(B$.gl!, `
attribute vec3 aPos;
uniform mat4 uMVP;
uniform mat4 uWorld;
varying vec3 vW;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); vW = (uWorld * vec4(aPos, 1.0)).xyz; }`, `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uPano;
uniform sampler2D uFloor;
uniform vec3 uEye;
uniform float uHalf;
uniform float uMode;
uniform vec3 uGradeSub;
varying vec3 vW;
void main() {
  vec4 c;
  if (uMode > 0.5) c = texture2D(uFloor, (vW.xz / uHalf + 1.0) * 0.5);
  else {
    vec3 d = normalize(vW - uEye);
    c = texture2D(uPano, vec2(0.5 + atan(d.x, -d.z) / 6.2831853, 0.5 - asin(clamp(d.y, -1.0, 1.0)) / 3.1415927));
  }
  c.rgb *= vec3(1.0) - uGradeSub;
  gl_FragColor = vec4(c.rgb, 1.0);
}`);
      B$.panoPaintProg = { program: pr, aPos: B$.gl!.getAttribLocation(pr, "aPos"), uMVP: B$.gl!.getUniformLocation(pr, "uMVP"), uWorld: B$.gl!.getUniformLocation(pr, "uWorld"),
        uPano: B$.gl!.getUniformLocation(pr, "uPano"), uFloor: B$.gl!.getUniformLocation(pr, "uFloor"), uEye: B$.gl!.getUniformLocation(pr, "uEye"),
        uHalf: B$.gl!.getUniformLocation(pr, "uHalf"), uMode: B$.gl!.getUniformLocation(pr, "uMode"), uGradeSub: B$.gl!.getUniformLocation(pr, "uGradeSub") };
    }
    const g0 = B$.panoPaintProg, meta = p.paint.meta;
    B$.gl!.useProgram(g0.program);
    B$.gl!.uniformMatrix4fv(g0.uMVP, false, mvp); B$.gl!.uniformMatrix4fv(g0.uWorld, false, world);
    B$.gl!.uniform3fv(g0.uEye, meta.eye); B$.gl!.uniform1f(g0.uHalf, meta.floorHalf);
    B$.gl!.uniform3fv(g0.uGradeSub, atm ? atm.gradeSub : [0, 0, 0]);
    B$.gl!.activeTexture(B$.gl!.TEXTURE0); B$.gl!.bindTexture(B$.gl!.TEXTURE_2D, p.tex); B$.gl!.uniform1i(g0.uPano, 0);
    B$.gl!.activeTexture(B$.gl!.TEXTURE1); B$.gl!.bindTexture(B$.gl!.TEXTURE_2D, p.paint.floor); B$.gl!.uniform1i(g0.uFloor, 1);
    B$.gl!.disable(B$.gl!.BLEND); B$.gl!.enable(B$.gl!.DEPTH_TEST); B$.gl!.depthMask(true);
    let floorTris = 0, otherTris = 0;
    for (const g of B$.activeArena!.groups!) {
      if (!g.count) continue;
      const idx = arenaCullIndices(mvp, g); if (!idx) continue;
      const fm = _paintFloorMask(g), fl: number[] = [], ot: number[] = [];
      // ETS item 9: the cull pass hands back whole triangles, so idx holds a multiple of three entries.
      for (let i = 0; i < idx.length; i += 3) (fm[idx[i]! / 3] ? fl : ot).push(idx[i]!, idx[i + 1]!, idx[i + 2]!);
      B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, g.vbo); B$.gl!.enableVertexAttribArray(g0.aPos); B$.gl!.vertexAttribPointer(g0.aPos, 3, B$.gl!.FLOAT, false, 0, 0);
      if (!g.paintIbo) g.paintIbo = B$.gl!.createBuffer();
      B$.gl!.bindBuffer(B$.gl!.ELEMENT_ARRAY_BUFFER, g.paintIbo);
      for (const [list, mode] of [[fl, 1], [ot, 0]] as [number[], number][]) {
        if (!list.length) continue;
        B$.gl!.uniform1f(g0.uMode, mode);
        B$.gl!.bufferData(B$.gl!.ELEMENT_ARRAY_BUFFER, new Uint16Array(list), B$.gl!.DYNAMIC_DRAW);
        B$.gl!.drawElements(B$.gl!.TRIANGLES, list.length, B$.gl!.UNSIGNED_SHORT, 0);
      }
      floorTris += fl.length / 3; otherTris += ot.length / 3;
    }
    B$.gl!.activeTexture(B$.gl!.TEXTURE0);
    B$.gl!.enable(B$.gl!.BLEND); B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
    B$.panoLog!.paint = { floorTris, otherTris };
  }
function _panoBufs(pos: number[], uv: number[], idx: number[]) {
    const vbo = B$.gl!.createBuffer(); B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, vbo); B$.gl!.bufferData(B$.gl!.ARRAY_BUFFER, new Float32Array(pos), B$.gl!.STATIC_DRAW);
    const ubo = B$.gl!.createBuffer(); B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, ubo); B$.gl!.bufferData(B$.gl!.ARRAY_BUFFER, new Float32Array(uv), B$.gl!.STATIC_DRAW);
    const ibo = B$.gl!.createBuffer(); B$.gl!.bindBuffer(B$.gl!.ELEMENT_ARRAY_BUFFER, ibo); B$.gl!.bufferData(B$.gl!.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), B$.gl!.STATIC_DRAW);
    return { vbo, ubo, ibo, indexCount: idx.length };
  }
// unit sphere, 64 x 32
  function _panoDomeBufs() {
    if (B$.panoDome) return B$.panoDome;
    const SA = 64, SL = 32, pos = [], uv = [], idx = [];
    for (let j = 0; j <= SL; j++) {
      const lat = Math.PI / 2 - j * Math.PI / SL;
      for (let i = 0; i <= SA; i++) {
        const az = -Math.PI + i * 2 * Math.PI / SA;
        pos.push(Math.sin(az) * Math.cos(lat), Math.sin(lat), -Math.cos(az) * Math.cos(lat));
        uv.push(0.5 + az / (2 * Math.PI), 0.5 - lat / Math.PI);
      }
    }
    for (let j = 0; j < SL; j++) for (let i = 0; i < SA; i++) { const a = j * (SA + 1) + i, b = a + SA + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    return (B$.panoDome = _panoBufs(pos, uv, idx));
  }
// flat disk at y = 0 around the arena centre, 24 rings x 64 (uv unused: the ground shader tiles by world x, z)
  function _panoDiskBufs() {
    if (B$.panoDisk) return B$.panoDisk;
    const SA = 64, SR = 24, pos = [], uv = [], idx = [];
    for (let j = 0; j <= SR; j++) {
      const r = B$.PANO_GR! * (j / SR);
      for (let i = 0; i <= SA; i++) { const a = i * 2 * Math.PI / SA; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); uv.push(0, 0); }
    }
    for (let j = 0; j < SR; j++) for (let i = 0; i < SA; i++) { const a = j * (SA + 1) + i, b = a + SA + 1; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    return (B$.panoDisk = _panoBufs(pos, uv, idx));
  }
function _panoGround(bdPV: Iterable<number>, tex: WebGLTexture | null, atm: { gradeSub: Iterable<number>; fogCol: Iterable<number>; fogP: Iterable<number>; }) {
    if (!B$.panoGroundProg) {
      const p = createProgram(B$.gl!, `
attribute vec3 aPos;
uniform mat4 uMVP;
varying vec2 vXZ;
varying float vDepth;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); vXZ = aPos.xz; vDepth = gl_Position.w * 0.001; }`, `
precision mediump float;
uniform sampler2D uTex;
uniform vec3 uP;          // tile size, fade start, fade end
uniform vec3 uGradeSub;
uniform vec3 uFogCol;
uniform vec3 uFogP;
varying vec2 vXZ;
varying float vDepth;
void main() {
  vec4 c = texture2D(uTex, vXZ / uP.x);
  c.a = 1.0 - smoothstep(uP.y, uP.z, length(vXZ));
  c.rgb *= vec3(1.0) - uGradeSub;
  c.rgb = mix(c.rgb, uFogCol, clamp((vDepth - uFogP.x) * uFogP.y, 0.0, 1.0) * uFogP.z);
  gl_FragColor = c;
}`);
      B$.panoGroundProg = { program: p, aPos: B$.gl!.getAttribLocation(p, "aPos"), uMVP: B$.gl!.getUniformLocation(p, "uMVP"), uTex: B$.gl!.getUniformLocation(p, "uTex"),
        uP: B$.gl!.getUniformLocation(p, "uP"), uGradeSub: B$.gl!.getUniformLocation(p, "uGradeSub"), uFogCol: B$.gl!.getUniformLocation(p, "uFogCol"), uFogP: B$.gl!.getUniformLocation(p, "uFogP") };
    }
    const g = B$.panoGroundProg, b = _panoDiskBufs();
    B$.gl!.useProgram(g.program);
    B$.gl!.uniformMatrix4fv(g.uMVP, false, bdPV);
    B$.gl!.uniform3fv(g.uP, [B$.PANO_TILE!, B$.PANO_FADE![0]!, B$.PANO_FADE![1]!]);
    B$.gl!.uniform3fv(g.uGradeSub, atm ? atm.gradeSub : [0, 0, 0]);
    B$.gl!.uniform3fv(g.uFogCol, atm ? atm.fogCol : [0, 0, 0]);
    B$.gl!.uniform3fv(g.uFogP, atm ? atm.fogP : [0, 0, 0]);
    B$.gl!.activeTexture(B$.gl!.TEXTURE0); B$.gl!.bindTexture(B$.gl!.TEXTURE_2D, tex); B$.gl!.uniform1i(g.uTex, 0);
    B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, b.vbo); B$.gl!.enableVertexAttribArray(g.aPos); B$.gl!.vertexAttribPointer(g.aPos, 3, B$.gl!.FLOAT, false, 0, 0);
    B$.gl!.bindBuffer(B$.gl!.ELEMENT_ARRAY_BUFFER, b.ibo);
    B$.gl!.enable(B$.gl!.BLEND); B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
    B$.gl!.drawElements(B$.gl!.TRIANGLES, b.indexCount, B$.gl!.UNSIGNED_SHORT, 0);
  }
// the picture's texel along unit direction d (the dome is centred on the eye); sky only
  function _panoTexel(p: PanoState, eye: number[], d: number[]) {
    if (d[1]! <= 0) return null;
    return { px: p.px, u: 0.5 + Math.atan2(d[0]!, -d[2]!) / (2 * Math.PI), v: 0.5 - Math.asin(Math.min(1, d[1]!)) / Math.PI };
  }
function _panoMeshBuild(meta: { cols: number; rows: number; cameraHeightM: number }, vals: number[] | Float32Array<ArrayBuffer>) {
    const C = meta.cols, R = meta.rows, k = B$.PANO_UNIT_M!, EYE = meta.cameraHeightM * k!, FLAT_Y = B$.PANO_FLAT_M! * k!;
    const pos = new Float32Array(C * R * 3), uv = new Float32Array(C * R * 2), dist = new Float32Array(C * R), skyF = new Uint8Array(C * R);
    for (let j = 0; j < R; j++) {
      const lat = Math.PI / 2 - j * Math.PI / (R - 1), cl = Math.cos(lat), sl = Math.sin(lat);
      for (let i = 0; i < C; i++) {
        const n = j * C + i, az = -Math.PI + i * 2 * Math.PI / (C - 1), sky = !(vals[n]! > 0), v = Math.min(sky ? Infinity : vals[n]!, B$.PANO_FAR_M!) * k!;
        dist[n] = v; skyF[n] = sky ? 1 : 0;
        uv[n * 2] = i / (C - 1); uv[n * 2 + 1] = j / (R - 1);
        if (!(v > 0)) { pos[n * 3] = pos[n * 3 + 1] = pos[n * 3 + 2] = NaN; continue; }
        let x = Math.sin(az) * cl * v, y = EYE + sl * v, z = -Math.cos(az) * cl * v;
        const rh = Math.hypot(x, z);
        if (!sky && y < FLAT_Y && rh < B$.PANO_FLAT_R![1]!) y *= rh <= B$.PANO_FLAT_R![0]! ? 0 : 1 - (B$.PANO_FLAT_R![1]! - rh) / (B$.PANO_FLAT_R![1]! - B$.PANO_FLAT_R![0]!);
        pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
      }
    }
    const idx: number[] = []; let torn = 0;
    const P = (n: number | undefined) => [pos[n! * 3], pos[n! * 3 + 1], pos[n! * 3 + 2]];
    for (let j = 0; j < R - 1; j++) for (let i = 0; i < C - 1; i++) {
      const q: [number, number, number, number] = [j * C + i, j * C + i + 1, (j + 1) * C + i, (j + 1) * C + i + 1];
      if (q.some((n) => !(dist[n]! > 0))) continue;
      const ds = q.map((n) => dist[n]!);
      if (!q.some((n) => skyF[n]) && Math.max(...ds) / Math.min(...ds) > 1.3) {   // the sky's edge is never torn: nothing is behind it
        const a = P(q[0]), b = P(q[3]), c = P(q[1]), d = P(q[2]);
        const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], e2 = [d[0]! - c[0]!, d[1]! - c[1]!, d[2]! - c[2]!];
        const nn = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!], nl = Math.hypot(...nn) || 1;
        const m = [(a[0]! + b[0]!) / 2, (a[1]! + b[1]!) / 2 - EYE, (a[2]! + b[2]!) / 2], ml = Math.hypot(...m) || 1;
        const cosv = Math.abs(nn[0]! * m[0]! + nn[1]! * m[1]! + nn[2]! * m[2]!) / (nl * ml);
        if (Math.abs(nn[1]! / nl) < 0.8 && cosv < 0.15) { torn++; continue; }
      }
      idx.push(q[0], q[2], q[1], q[1], q[2], q[3]);
    }
    for (let n = 0; n < pos.length; n++) if (Number.isNaN(pos[n])) pos[n] = 0;   // unused corners (sky)
    const vbo = B$.gl!.createBuffer(); B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, vbo); B$.gl!.bufferData(B$.gl!.ARRAY_BUFFER, pos, B$.gl!.STATIC_DRAW);
    const ubo = B$.gl!.createBuffer(); B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, ubo); B$.gl!.bufferData(B$.gl!.ARRAY_BUFFER, uv, B$.gl!.STATIC_DRAW);
    const ibo = B$.gl!.createBuffer(); B$.gl!.bindBuffer(B$.gl!.ELEMENT_ARRAY_BUFFER, ibo); B$.gl!.bufferData(B$.gl!.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), B$.gl!.STATIC_DRAW);
    return { vbo, ubo, ibo, indexCount: idx.length, pos, idx, torn, scale: k };
  }
/** (checks) height of the painted place's mesh straight under (x, z), render space; null = no mesh or nothing under. */
  function probePanoGround(x: number, z: number) {
    const m = B$.pano?.mesh; if (!m) return null;
    let best = null; const p = m.pos, I = m.idx;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]! * 3, b = I[t + 1]! * 3, c = I[t + 2]! * 3;
      const d = (p[b + 2]! - p[c + 2]!) * (p[a]! - p[c]!) + (p[c]! - p[b]!) * (p[a + 2]! - p[c + 2]!); if (Math.abs(d) < 1e-9) continue;
      const w0 = ((p[b + 2]! - p[c + 2]!) * (x - p[c]!) + (p[c]! - p[b]!) * (z - p[c + 2]!)) / d;
      const w1 = ((p[c + 2]! - p[a + 2]!) * (x - p[c]!) + (p[a]! - p[c]!) * (z - p[c + 2]!)) / d, w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const y = w0 * p[a + 1]! + w1 * p[b + 1]! + w2 * p[c + 1]!;
      if (best == null || y < best) best = y;          // the lowest surface under the point is the ground
    }
    return best;
  }
function _drawPano(p: PanoState, bdPV: number[] | Float32Array<ArrayBuffer>, eye: number[], atm: { gradeSub: Iterable<number>; fogCol: Iterable<number>; fogP: Iterable<number>; }) {
    const M = new Float32Array([B$.PANO_R!, 0, 0, 0, 0, B$.PANO_R!, 0, 0, 0, 0, B$.PANO_R!, 0, eye[0]!, eye[1]!, eye[2]!, 1]);
    const depth = B$.gl!.isEnabled(B$.gl!.DEPTH_TEST);
    B$.gl!.disable(B$.gl!.DEPTH_TEST); B$.gl!.depthMask(false); B$.gl!.disable(B$.gl!.BLEND);
    if (atm) { B$.gl!.useProgram(B$.texP!.program); B$.gl!.uniformMatrix4fv(B$.texP!.uSkyM, false, M); B$.gl!.uniform2fv(B$.texP!.uWater, [0, 0]); }
    if (!p.mesh) drawSkeletalMesh(B$.gl!, B$.texP!, mat4Mul(bdPV, M), _panoDomeBufs(), p.tex, [1, 1, 1, 1]);
    if (p.mesh) {               // the place in 3D: it sorts itself by depth (cleared after the arena branch, like the arena)
      B$.gl!.enable(B$.gl!.DEPTH_TEST); B$.gl!.depthMask(true);
      if (atm) B$.gl!.uniformMatrix4fv(B$.texP!.uSkyM, false, B$.PANO_IDENT!);
      drawSkeletalMesh(B$.gl!, B$.texP!, bdPV, p.mesh, p.tex, [1, 1, 1, 1]);
      B$.gl!.disable(B$.gl!.DEPTH_TEST);
    } else if (p.ground) _panoGround(bdPV, p.ground, atm);
    if (depth) B$.gl!.enable(B$.gl!.DEPTH_TEST);
    B$.gl!.enable(B$.gl!.BLEND); B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
    B$.panoLog!.ground = !!p.ground; B$.panoLog!.mesh = p.mesh ? { tris: p.mesh.indexCount / 3, torn: p.mesh.torn, scale: +p.mesh.scale.toFixed(2) } : null;
    B$.panoLog!.drawn++;
  }
// opts.ortho = half-size of a square straight view (no perspective) for the top-down floor; opts.far = how deep it
  // reaches from the eye (with ortho, everything above the eye is left out: walls cut at that height).
  function captureArenaFace(eye: Float32Array | number[], look: Float32Array | number[], up: Float32Array | number[], size = 1024, opts: PanoProjectOptions = {}) {
    if (!B$.activeArena?.groups?.length) return null;
    if (!B$._capFbo || B$._capFbo.size !== size) {
      const fb = B$.gl!.createFramebuffer(), tx = B$.gl!.createTexture(), rb = B$.gl!.createRenderbuffer();
      B$.gl!.bindTexture(B$.gl!.TEXTURE_2D, tx);
      B$.gl!.texImage2D(B$.gl!.TEXTURE_2D, 0, B$.gl!.RGBA, size, size, 0, B$.gl!.RGBA, B$.gl!.UNSIGNED_BYTE, null);
      B$.gl!.texParameteri(B$.gl!.TEXTURE_2D, B$.gl!.TEXTURE_MIN_FILTER, B$.gl!.LINEAR);
      B$.gl!.bindRenderbuffer(B$.gl!.RENDERBUFFER, rb);
      B$.gl!.renderbufferStorage(B$.gl!.RENDERBUFFER, B$.gl!.DEPTH_COMPONENT16, size, size);
      B$.gl!.bindFramebuffer(B$.gl!.FRAMEBUFFER, fb);
      B$.gl!.framebufferTexture2D(B$.gl!.FRAMEBUFFER, B$.gl!.COLOR_ATTACHMENT0, B$.gl!.TEXTURE_2D, tx, 0);
      B$.gl!.framebufferRenderbuffer(B$.gl!.FRAMEBUFFER, B$.gl!.DEPTH_ATTACHMENT, B$.gl!.RENDERBUFFER, rb);
      B$._capFbo = { fb, size };
    }
    B$.gl!.bindFramebuffer(B$.gl!.FRAMEBUFFER, B$._capFbo.fb);
    B$.gl!.viewport(0, 0, size, size);
    B$.gl!.clearColor(0, 0, 0, 1); B$.gl!.clear(B$.gl!.COLOR_BUFFER_BIT | B$.gl!.DEPTH_BUFFER_BIT);
    B$.gl!.enable(B$.gl!.DEPTH_TEST); B$.gl!.depthFunc(B$.gl!.LEQUAL);
    B$.gl!.depthMask(false); B$.gl!.enable(B$.gl!.BLEND); B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
    drawQuad(B$.gl!, B$.texP!, B$.IDENT_MVP!, B$.skyBufs!, B$.whiteTex!, 1, B$.arenaBg || [0, 0, 0, 1]);
    let proj = mat4Perspective(Math.PI / 2, 1, 1, 60000);
    if (opts.ortho) { const L = opts.ortho, n = 0, f = opts.far || 60000; proj = new Float32Array(16);
      proj[0] = 1 / L; proj[5] = 1 / L; proj[10] = -2 / (f - n); proj[14] = -(f + n) / (f - n); proj[15] = 1; }
    const mvp = mat4Mul(mat4Mul(proj, mat4LookAt(eye, look, up)), ps1ToRenderMatrix(MODEL_SCALE));
    B$.gl!.depthMask(true); B$.gl!.disable(B$.gl!.BLEND);
    for (const g of B$.activeArena.groups) { if (g.count) drawProjLayerIndexed(B$.gl!, B$.texP!, mvp, g, B$.arenaTextureFor(B$.activeArena, g), arenaCullIndices(mvp, g)); }
    const px = new Uint8Array(size * size * 4);
    B$.gl!.readPixels(0, 0, size, size, B$.gl!.RGBA, B$.gl!.UNSIGNED_BYTE, px);
    B$.gl!.bindFramebuffer(B$.gl!.FRAMEBUFFER, null); B$.gl!.enable(B$.gl!.BLEND); B$.gl!.viewport(0, 0, B$.canvas!.width, B$.canvas!.height);
    let b = ""; for (let i = 0; i < px.length; i += 0x8000) b += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
    return { size, arena: B$.activeArena.name, rgba: btoa(b) };
  }
function getPanorama() { return { ...B$.panoLog, on: !!window.__fx?.battlepano, hd: assetMode() === "hd", dome: { r: B$.PANO_R, groundR: B$.PANO_GR, fade: B$.PANO_FADE, tile: B$.PANO_TILE } }; }
// ── viewer ground grid (isolated mode) ────────────────────────────────────────────────────────
  // A world-space grid under the focused fighter, drawn through the SAME camera as the model. One
  // unit quad (xz) scaled per frame by the fighter's own height, so a tiny model and a giant get
  // the same cell count at a sensible size. The axis lines are painted into the texture (world X
  // amber, world Z blue); the page also draws a corner gizmo from the same camera basis.
  function ensureViewerGrid() {
    if (B$.viewerGridTex && B$.viewerGridBufs) return;
    const N = 1024, cells = 16, px = N / cells;
    const cv = document.createElement("canvas");
    cv.width = cv.height = N;
    const c = cv.getContext("2d");
    c!.fillStyle = "#22252d"; c!.fillRect(0, 0, N, N);
    c!.strokeStyle = "#3b4150"; c!.lineWidth = 2;
    for (let i = 0; i <= cells; i++) {
      const p = Math.round(i * px) + 0.5;
      c!.beginPath(); c!.moveTo(p, 0); c!.lineTo(p, N); c!.stroke();
      c!.beginPath(); c!.moveTo(0, p); c!.lineTo(N, p); c!.stroke();
    }
    c!.lineWidth = 5;
    c!.strokeStyle = "#8a6a3a";                     // the grid's X axis line
    c!.beginPath(); c!.moveTo(N / 2, 0); c!.lineTo(N / 2, N); c!.stroke();
    c!.strokeStyle = "#3a6a8a";                     // the grid's Z axis line
    c!.beginPath(); c!.moveTo(0, N / 2); c!.lineTo(N, N / 2); c!.stroke();
    const tex = B$.gl!.createTexture();
    B$.gl!.bindTexture(B$.gl!.TEXTURE_2D, tex);
    B$.gl!.texImage2D(B$.gl!.TEXTURE_2D, 0, B$.gl!.RGBA, B$.gl!.RGBA, B$.gl!.UNSIGNED_BYTE, cv);
    B$.gl!.texParameteri(B$.gl!.TEXTURE_2D, B$.gl!.TEXTURE_MIN_FILTER, B$.gl!.LINEAR);
    B$.gl!.texParameteri(B$.gl!.TEXTURE_2D, B$.gl!.TEXTURE_MAG_FILTER, B$.gl!.LINEAR);
    B$.gl!.texParameteri(B$.gl!.TEXTURE_2D, B$.gl!.TEXTURE_WRAP_S, B$.gl!.CLAMP_TO_EDGE);
    B$.gl!.texParameteri(B$.gl!.TEXTURE_2D, B$.gl!.TEXTURE_WRAP_T, B$.gl!.CLAMP_TO_EDGE);
    B$.viewerGridTex = tex;
    B$.viewerGridBufs = makeQuadBuffers(B$.gl!, [
      [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5],
    ], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
function drawViewerGrid(pv: number[] | Float32Array<ArrayBuffer>) {
    const box = B$.isolatedSide === "enemy" ? B$.eAABBLast : B$.pAABB;
    if (!box) return;
    ensureViewerGrid();
    const cx = (box.min[0]! + box.max[0]!) / 2;
    const cz = (box.min[2]! + box.max[2]!) / 2;
    const h = Math.max(200, box.max[1]! - box.min[1]!);
    const size = Math.max(1200, h * 14);
    const mvp = mat4Mul(pv, mat4Mul(mat4Translate(cx, box.min[1]!, cz), mat4Scale(size, 1, size)));
    B$.gl!.enable(B$.gl!.BLEND);
    B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
    drawQuad(B$.gl!, B$.texP!, mvp, B$.viewerGridBufs!, B$.viewerGridTex!, 1, [1, 1, 1, 0.95]);
  }
  return { _panoTex, _panoActive, _paintFloorMask, _drawArenaPaint, _panoBufs, _panoDomeBufs, _panoDiskBufs, _panoGround, _panoTexel, _panoMeshBuild, probePanoGround, _drawPano, captureArenaFace, getPanorama, ensureViewerGrid, drawViewerGrid };
}
