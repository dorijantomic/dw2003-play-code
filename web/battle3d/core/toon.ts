import { SCENE_LIGHT_WINDING, compileShader } from "../gl.js";
import { TOON_HULL_VERT_SRC, TOON_HULL_FRAG_SRC } from "../shaders.js";
import type { Battle3DContext } from "../../types/battle3d.js";

// moved by tools/rewrite/split-closure.mjs
export function makeToon(B$: Battle3DContext) {
function _litNormals(model, bufs) {
    const pos = bufs?.lastPos; if (!model || !pos) return;
    const n = bufs.totalVerts;
    if (!bufs.weld || bufs.weldFor !== model) {      // corner -> one id per (bone, vertex), built once per model
      const weld = new Int32Array(n), ids = new Map();
      for (let b = 0; b < model.bones.length; b++) {
        const faces = model.bones[b].faces || [], off = bufs.boneOffsets[b];
        for (let f = 0; f < faces.length; f++) for (let c = 0; c < 3; c++) {
          const key = b * 65536 + faces[f][c];
          let id = ids.get(key); if (id === undefined) { id = ids.size; ids.set(key, id); }
          weld[off + f * 3 + c] = id;
        }
      }
      bufs.weld = weld; bufs.weldN = ids.size; bufs.weldFor = model; bufs.weldBuilds = (bufs.weldBuilds || 0) + 1;
      bufs.acc = new Float32Array(ids.size * 3); bufs.nrm = new Float32Array(n * 3);
    }
    const { weld, acc, nrm } = bufs; acc.fill(0);
    for (let t = 0; t + 2 < n; t += 3) {
      const a = t * 3, b = a + 3, c = a + 6;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = (uy * vz - uz * vy) * SCENE_LIGHT_WINDING, ny = (uz * vx - ux * vz) * SCENE_LIGHT_WINDING, nz = (ux * vy - uy * vx) * SCENE_LIGHT_WINDING;
      for (let k = 0; k < 3; k++) { const w = weld[t + k] * 3; acc[w] += nx; acc[w + 1] += ny; acc[w + 2] += nz; }
    }
    for (let i = 0; i < n; i++) {
      const w = weld[i] * 3, x = acc[w], y = acc[w + 1], z = acc[w + 2], l = Math.sqrt(x * x + y * y + z * z) || 1;
      nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
    }
    if (!bufs.nbo) bufs.nbo = B$.gl.createBuffer();
    B$.gl.bindBuffer(B$.gl.ARRAY_BUFFER, bufs.nbo);
    B$.gl.bufferData(B$.gl.ARRAY_BUFFER, nrm, B$.gl.DYNAMIC_DRAW);
  }
function _sceneLightDraw(on) {          // before the fighters (on) and right after them (off)
    B$.gl.useProgram(B$.texP.program);
    const L = on ? B$.sceneLight : null;
    B$.gl.uniform1f(B$.texP.uSLOn, L ? 1 : 0);
    for (const bufs of [B$.playerSkelBufs, B$.enemySkelBufs]) if (bufs) bufs.litOn = !!L;
    if (!L) return;
    B$.gl.uniform3fv(B$.texP.uSLDir, L.dir); B$.gl.uniform3fv(B$.texP.uSLCol, L.colour); B$.gl.uniform3fv(B$.texP.uSLAmb, L.ambient);
    _litNormals(B$.playerModel, B$.playerSkelBufs);
    _litNormals(B$.enemyModel, B$.enemySkelBufs);
  }
function _toonState() {
    const o = !!(window.__fx?.toonoutline || B$.toonSet.outline), s = !!(window.__fx?.toonshade || B$.toonSet.shade);
    return o || s ? { outline: o, shade: s } : null;
  }
// Built once per model from that frame's skinned corners: weld = one id per position (quantised to 0.5 render units),
  // so corners of different faces / bone pieces at one point share ONE averaged normal (no hull cracks at hard edges).
  // sign = per bone piece +1 / -1 from its signed volume, so a piece wound the other way still gets outward normals,
  // and the hull index buffer flips that piece's triangles so the culling below treats it like the rest.
  function _toonWeld(model, bufs) {
    const pos = bufs.lastPos, n = bufs.totalVerts;
    const sign = new Float32Array(n / 3), hull = new Uint16Array(n);
    for (let b = 0; b < model.bones.length; b++) {
      const t0 = bufs.boneOffsets[b], nt = (model.bones[b].faces || []).length;
      let qx = 0, qy = 0, qz = 0;
      for (let i = t0 * 3; i < (t0 + nt * 3) * 3; i += 3) { qx += pos[i]; qy += pos[i + 1]; qz += pos[i + 2]; }
      const nc = Math.max(1, nt * 3); qx /= nc; qy /= nc; qz /= nc;
      let v = 0;
      for (let f = 0; f < nt; f++) {
        const a = (t0 + f * 3) * 3;
        const x0 = pos[a] - qx, y0 = pos[a + 1] - qy, z0 = pos[a + 2] - qz, x1 = pos[a + 3] - qx, y1 = pos[a + 4] - qy, z1 = pos[a + 5] - qz, x2 = pos[a + 6] - qx, y2 = pos[a + 7] - qy, z2 = pos[a + 8] - qz;
        v += x0 * (y1 * z2 - z1 * y2) - y0 * (x1 * z2 - z1 * x2) + z0 * (x1 * y2 - y1 * x2);
      }
      const s = v * SCENE_LIGHT_WINDING < 0 ? -1 : 1;
      for (let f = 0; f < nt; f++) {
        const t = t0 + f * 3; sign[t / 3] = s;
        hull[t] = t; hull[t + 1] = s < 0 ? t + 2 : t + 1; hull[t + 2] = s < 0 ? t + 1 : t + 2;
      }
    }
    const weld = new Int32Array(n), ids = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.round(pos[i * 3] * 2) + "," + Math.round(pos[i * 3 + 1] * 2) + "," + Math.round(pos[i * 3 + 2] * 2);
      let id = ids.get(key); if (id === undefined) { id = ids.size; ids.set(key, id); }
      weld[i] = id;
    }
    if (!bufs.toonIbo) bufs.toonIbo = B$.gl.createBuffer();
    B$.gl.bindBuffer(B$.gl.ELEMENT_ARRAY_BUFFER, bufs.toonIbo);
    B$.gl.bufferData(B$.gl.ELEMENT_ARRAY_BUFFER, hull, B$.gl.STATIC_DRAW);
    Object.assign(bufs, { toonFor: model, toonN: n, toonSign: sign, toonWeldIds: weld, toonAcc: new Float32Array(ids.size * 3),
      toonNrm: new Float32Array(n * 3), toonWeldN: ids.size });
    B$.toonLog.welds++;
  }
// This frame's smooth outward normals (area-weighted face normals summed per weld id) into bufs.nbo.
  function _toonNormals(model, bufs) {
    if (!model || !bufs?.lastPos || !bufs.totalVerts) return false;
    if (bufs.toonFor !== model || bufs.toonN !== bufs.totalVerts) _toonWeld(model, bufs);
    const pos = bufs.lastPos, n = bufs.totalVerts, { toonSign: sign, toonWeldIds: weld, toonAcc: acc, toonNrm: nrm } = bufs;
    acc.fill(0);
    for (let t = 0; t + 2 < n; t += 3) {
      const a = t * 3, b = a + 3, c = a + 6, s = sign[t / 3] * SCENE_LIGHT_WINDING;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = (uy * vz - uz * vy) * s, ny = (uz * vx - ux * vz) * s, nz = (ux * vy - uy * vx) * s;
      for (let k = 0; k < 3; k++) { const w = weld[t + k] * 3; acc[w] += nx; acc[w + 1] += ny; acc[w + 2] += nz; }
    }
    for (let i = 0; i < n; i++) {
      const w = weld[i] * 3, x = acc[w], y = acc[w + 1], z = acc[w + 2], l = Math.sqrt(x * x + y * y + z * z) || 1;
      nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
    }
    if (!bufs.nbo) bufs.nbo = B$.gl.createBuffer();
    B$.gl.bindBuffer(B$.gl.ARRAY_BUFFER, bufs.nbo);
    B$.gl.bufferData(B$.gl.ARRAY_BUFFER, nrm, B$.gl.DYNAMIC_DRAW);
    return true;
  }
function _toonBodies() {
    const out = [];
    if (!(B$.blastState && B$.blastState.wipeRow !== undefined && B$.blastState.showNewModel) && B$.playerVisible && B$.playerModel && B$.playerSkelBufs) out.push([B$.playerModel, B$.playerSkelBufs, B$.playerTex]);
    if (B$.enemyVisible && B$.enemyModel && B$.enemySkelBufs) out.push([B$.enemyModel, B$.enemySkelBufs, B$.enemyTex]);
    for (const f of B$.extras.values()) if (f.visible && f.model && f.bufs) out.push([f.model, f.bufs, f.tex]);
    return out;
  }
// Before the fighters: normals for every body; Toon shading binds them (litOn) and sets the band uniforms.
  function _toonBegin(st, eye, look) {
    const bodies = _toonBodies();
    for (const [m, b] of bodies) { b.toonOk = _toonNormals(m, b); if (st.shade && b.toonOk) b.litOn = true; }
    if (!st.shade) return;
    let d;
    if (B$.sceneLight) d = B$.sceneLight.dir;
    else {     // key light from above the camera: toward the camera plus up
      let vx = eye[0] - look[0], vy = eye[1] - look[1], vz = eye[2] - look[2];
      const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
      d = [vx, vy + 1, vz];
    }
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    B$.gl.useProgram(B$.texP.program);
    B$.gl.uniform1f(B$.texP.uToon, 1);
    B$.gl.uniform3fv(B$.texP.uToonDir, [d[0] / dl, d[1] / dl, d[2] / dl]);
    B$.gl.uniform1f(B$.texP.uSLOn, 0);           // no tinted scene light on the Digimon while toon shading is on
  }
// After the fighters (and the 2 vs 2 extras): the hulls, then everything back to the game's own state.
  function _toonEnd(st, pv, proj, H) {
    const bodies = _toonBodies();
    if (st.outline) {
      try {
        if (!B$.toonProg) {
          const p = B$.gl.createProgram();
          B$.gl.attachShader(p, compileShader(B$.gl, B$.gl.VERTEX_SHADER, TOON_HULL_VERT_SRC));
          B$.gl.attachShader(p, compileShader(B$.gl, B$.gl.FRAGMENT_SHADER, TOON_HULL_FRAG_SRC));
          // the same attribute slots as the main program, so its enabled arrays stay as it left them
          if (B$.texP.aPos >= 0) B$.gl.bindAttribLocation(p, B$.texP.aPos, "aPos");
          if (B$.texP.aUV >= 0) B$.gl.bindAttribLocation(p, B$.texP.aUV, "aUV");
          if (B$.texP.aNormal >= 0) B$.gl.bindAttribLocation(p, B$.texP.aNormal, "aNormal");
          B$.gl.linkProgram(p);
          if (!B$.gl.getProgramParameter(p, B$.gl.LINK_STATUS)) throw new Error("Link: " + B$.gl.getProgramInfoLog(p));
          B$.toonProg = { program: p, aPos: B$.gl.getAttribLocation(p, "aPos"), aUV: B$.gl.getAttribLocation(p, "aUV"), aNormal: B$.gl.getAttribLocation(p, "aNormal"),
            uMVP: B$.gl.getUniformLocation(p, "uMVP"), uPush: B$.gl.getUniformLocation(p, "uPush"), uTex: B$.gl.getUniformLocation(p, "uTex"), uCol: B$.gl.getUniformLocation(p, "uCol") };
        }
        const px = Math.max(1, B$.TOON_PX_1080 * H / 1080);
        B$.gl.useProgram(B$.toonProg.program);
        B$.gl.uniformMatrix4fv(B$.toonProg.uMVP, false, pv);
        B$.gl.uniform1f(B$.toonProg.uPush, px * 2 / (H * proj[5]));
        B$.gl.uniform3fv(B$.toonProg.uCol, B$.TOON_COL);
        B$.gl.uniform1i(B$.toonProg.uTex, 0);
        B$.gl.activeTexture(B$.gl.TEXTURE0);
        B$.gl.enable(B$.gl.CULL_FACE); B$.gl.frontFace(B$.gl.CCW); B$.gl.cullFace(B$.gl.BACK);   // outward faces wind clockwise (SCENE_LIGHT_WINDING): cull the ones toward the camera
        B$.gl.depthMask(false);
        for (const [, b, tex] of bodies) {
          if (!b.toonOk || !b.vbo || !b.nbo || !b.toonIbo) continue;
          B$.gl.bindTexture(B$.gl.TEXTURE_2D, tex || B$.whiteTex);
          B$.gl.bindBuffer(B$.gl.ARRAY_BUFFER, b.vbo); B$.gl.enableVertexAttribArray(B$.toonProg.aPos); B$.gl.vertexAttribPointer(B$.toonProg.aPos, 3, B$.gl.FLOAT, false, 0, 0);
          B$.gl.bindBuffer(B$.gl.ARRAY_BUFFER, b.ubo); B$.gl.enableVertexAttribArray(B$.toonProg.aUV); B$.gl.vertexAttribPointer(B$.toonProg.aUV, 2, B$.gl.FLOAT, false, 0, 0);
          B$.gl.bindBuffer(B$.gl.ARRAY_BUFFER, b.nbo); B$.gl.enableVertexAttribArray(B$.toonProg.aNormal); B$.gl.vertexAttribPointer(B$.toonProg.aNormal, 3, B$.gl.FLOAT, false, 0, 0);
          B$.gl.bindBuffer(B$.gl.ELEMENT_ARRAY_BUFFER, b.toonIbo);
          B$.gl.drawElements(B$.gl.TRIANGLES, b.totalVerts, B$.gl.UNSIGNED_SHORT, 0);
          B$.gl.disableVertexAttribArray(B$.toonProg.aNormal);
          B$.toonLog.hulls++;
        }
      } catch (e) { B$.toonLog.err = String(e?.message || e); B$.toonSet.outline = false; }
      B$.gl.depthMask(true);
      B$.gl.disable(B$.gl.CULL_FACE);
    }
    for (const [, b] of bodies) b.litOn = false;
    B$.gl.useProgram(B$.texP.program);
    B$.gl.uniform1f(B$.texP.uToon, 0);
    B$.toonLog.frames++;
  }
  return { _litNormals, _sceneLightDraw, _toonState, _toonWeld, _toonNormals, _toonBodies, _toonBegin, _toonEnd };
}
