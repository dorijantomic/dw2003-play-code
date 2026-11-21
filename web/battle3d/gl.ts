import { fetchAsset } from "../assets.js";
import { changeStageMeshMatrix } from "../vendor/engine.js";
import { mat4Identity } from "../fight/proj-layers.js";
import { TEXTURE_PAGE_TEXELS, normalize } from "./math.js";
import { S } from "./state.js";
import type { ArenaCullLog } from "./types.js";

// A fighter's colour is its own texture's colour, and that is a decoded fact rather than a
// default. The fight-scene draw that submits a fighter's triangles is
// FIGHTSTG_F0x80085110 (~/ddw3/asm/dw2003/pro/fightstg.s:2382); it is reached only through
// the model object's +0xA4 method, installed once by FIGHTSTG_F0x8008610c (:3468), whose
// only caller is the fighter-model builder FIGHTSTG_F0x80083e0c (:1209). Its two arguments
// are the model object and an 8-word world matrix (F0x80085f3c, :3289-3299, copies the
// matrix into model+0x84..0xa0) -- there is no colour, alpha or blend parameter anywhere on
// the way in. Inside it nothing stores to a primitive's colour bytes: its per-frame writes
// are positions and texture coordinates (:2783-2812 copies u/v bytes from the model's table
// at model+0x80, each plus a u or v page offset); the descriptor byte carrying the semi-transparency flag is a constant picked
// by "is this primitive textured" (0x0c textured, 0x09 flat -- F0x80084bc0 :2057 and
// F0x80084e0c :2180), never by a frame or a damage state. Nor does anything on the hit path
// write one: op1 (FIGHTSTG_F0x8008b69c, :8769) stores only the child action actor's +0x50
// and +0x54, and the damage-reaction machine FIGHTSTG_F0x8008d3b4 (:10676) stores only the
// attack object's motion fields and the child actor's clip and motion fields.
//
// So what a struck Digimon shows IS its reaction clip, its eyes shutting
// (FIGHTSTG_F0x8008b118), the knockback distance on the child actor's +0x64, and the
// reaction script's own op10[99] impact sprite. Nothing modulates the body colour, so this
// is one untinted colour and it is the only one the fighter path has.
export const FIGHTER_TINT = [1, 1, 1, 1];

// NEW content (F2 -> Extras -> "Fusion bosses", off by default): a per-side fighter tint.
// The original has ONE untinted colour for every fighter (FIGHTER_TINT above), so this is
// ours; web/fusion.js's boss record carries the rgba, and web/battle.js sets it when the
// two halves fuse (Kimeramon's body wearing Millenniummon's dark palette). With the
// switch off nothing calls setFighterTint and every side keeps FIGHTER_TINT.
const FIGHTER_TINTS = { player: FIGHTER_TINT, enemy: FIGHTER_TINT, extra: FIGHTER_TINT };

/** The tint a side draws with: the game's own FIGHTER_TINT unless a fusion set one. */
export function fighterTint(side) {
  return FIGHTER_TINTS[side] ?? FIGHTER_TINT;
}

/**
 * Set one side's fighter tint. `rgba` is four 0..1 numbers; `null` (or anything that is
 * not a colour) puts the game's own FIGHTER_TINT back. Returns the tint now in force.
 */
export function setFighterTint(side, rgba) {
  const key = side === "enemy" ? "enemy" : side === "extra" ? "extra" : "player";
  const colour = Array.isArray(rgba) && rgba.length >= 3
    ? [rgba[0], rgba[1], rgba[2], rgba[3] ?? 1].map(Number)
    : null;
  FIGHTER_TINTS[key] = colour && colour.every(Number.isFinite) ? colour : FIGHTER_TINT;
  return FIGHTER_TINTS[key];
}

// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
// Sign that turns cross(p1 - p0, p2 - p0) of a fighter triangle (render space) into its OUTWARD normal. MEASURED by
// tools/verify_built_light.mjs (getSceneLight(): signed volume of each bone piece; with +1 it was negative on 47 of 51
// pieces of m373rena + m051kuwa, so these triangles wind clockwise seen from outside).
export const SCENE_LIGHT_WINDING = -1;

// SCENE-LIGHT-END

// `wire` draws the SAME index buffer as connected lines instead of filled
// triangles, which is how the Blast transformation shows the incoming form
// before it resolves (BLAST-C010 phase 4, "green wireframe of the new form").
// It reuses the model's own geometry, so the wireframe is the real silhouette
// of the Digimon being blasted into, not a stand-in shape.
export function drawSkeletalMesh(gl, prog, mvp, buffers, tex, tint, alpha = 1.0, wire = false) {
  if (!buffers || buffers.indexCount === 0 || !buffers.vbo) return;

  gl.useProgram(prog.program);
  gl.uniformMatrix4fv(prog.uMVP, false, mvp);
  gl.uniform1f(prog.uAlpha, alpha);
  gl.uniform4fv(prog.uTint, tint || [1,1,1,1]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(prog.uTex, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vbo);
  gl.enableVertexAttribArray(prog.aPos);
  gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.ubo);
  gl.enableVertexAttribArray(prog.aUV);
  gl.vertexAttribPointer(prog.aUV, 2, gl.FLOAT, false, 0, 0);

// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
  const nAt = prog.aNormal ?? -1;
  if (nAt >= 0 && buffers.nbo && buffers.litOn) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.nbo);
    gl.enableVertexAttribArray(nAt);
    gl.vertexAttribPointer(nAt, 3, gl.FLOAT, false, 0, 0);
  } else if (nAt >= 0) gl.disableVertexAttribArray(nAt);
// SCENE-LIGHT-END
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.ibo);
  gl.drawElements(wire ? gl.LINE_STRIP : gl.TRIANGLES,
    buffers.indexCount, gl.UNSIGNED_SHORT, 0);
// SCENE-LIGHT-BEGIN (Arena Viewer built look only: setSceneLight; strip these blocks = the game's own code)
  if (nAt >= 0) gl.disableVertexAttribArray(nAt);
// SCENE-LIGHT-END
}

// ─── GL helpers ───────────────────────────────────────────────────────────────

export function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error("Shader: " + gl.getShaderInfoLog(s));
  return s;
}

export function createProgram(gl, vsrc, fsrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsrc));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error("Link: " + gl.getProgramInfoLog(p));
  return p;
}

// The disc gives each Digimon spare rectangles on its own texture page holding the
// eye open, half closed and shut, and copies one over the eye whenever the state
// changes (GP0 0x80, a VRAM-to-VRAM blit — FIGHTSTG_F0x8008b160). texSubImage2D is
// the same operation, but it needs a source, so keep the page CPU-side as well.
// `scale` is 4 in HD asset mode, where every patch coordinate is 4x too.
export function loadTexturePixels(url) {
  return fetchAsset(url)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
    .then((blob) => createImageBitmap(blob))
    .then((bitmap) => {
      const { width, height } = bitmap;
      const canvas = (typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(width, height)
        : Object.assign(document.createElement("canvas"), { width, height })) as HTMLCanvasElement;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close?.();
      const { data } = ctx.getImageData(0, 0, width, height);
      return { data, width, height, scale: width / TEXTURE_PAGE_TEXELS };
    })
    .catch(() => null);
}

export function loadTexture(gl, url, onLoad?: any) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // 1×1 transparent placeholder
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([0,0,0,0]));
  // Use fetch + createImageBitmap so this works on both regular and OffscreenCanvas GL contexts.
  fetchAsset(url)
    .then(r => {
      if (!r.ok) throw new Error(r.status as any);
      const hd = new URL(r.url, location.href).pathname.includes("/assets-hd/");
      return r.blob().then(blob => ({ blob, hd }));
    })
    // HD sheets are filtered (LINEAR + mipmaps), so a see-through texel's colour reaches the opaque texels beside it.
    // The default bitmap is premultiplied and the upload wipes that colour to black: measured on meft1001's sky sheet,
    // 968080 alpha-0 texels 0,0,0 instead of the file's 78,126,195, and HD clouds got a black outline (user 2026-10-29;
    // tools/probe_texture_premultiply.mjs). Original sheets are NEAREST-sampled and keep the default decode.
    .then(({ blob, hd }) => createImageBitmap(blob, hd ? { premultiplyAlpha: "none" } : undefined).then(bitmap => ({ bitmap, hd })))
    .then(({ bitmap, hd }) => {
      const bw = bitmap.width, bh = bitmap.height;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      // HD arena sheets (1024 px) are seen far smaller than that on the walls: without mipmaps every screen pixel picks
      // one texel of many and the wall shimmers and looks pixelated as the camera moves (user 2026-10-28, Dark Dungeon).
      const pow2 = (n) => (n & (n - 1)) === 0, mip = hd && /\/battle\/arenas\//.test(url) && pow2(bw) && pow2(bh);
      if (mip) {
        gl.generateMipmap(gl.TEXTURE_2D);
        const af = gl.getExtension("EXT_texture_filter_anisotropic");
        if (af) gl.texParameterf(gl.TEXTURE_2D, af.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(af.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, hd ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      // WRAP_T = REPEAT: seam-unwrapped V coords (export_fight_anim.py) go
      // slightly <0 / >255 for primitives that straddle the 256-tall page seam;
      // REPEAT tiles them back into the texture instead of clamping to an edge.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      bitmap.close();
      if (onLoad) onLoad(tex, bw, bh);
    })
    .catch(() => {
      if (onLoad) onLoad(tex, 1, 1);
    });
  return tex;
}

export function makeQuadBuffers(gl, verts, uvs) {
  // verts: 4×[x,y,z], uvs: 4×[u,v], two triangles (0,1,2, 0,2,3)
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts.flat()), gl.STATIC_DRAW);
  const ubo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, ubo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs.flat()), gl.STATIC_DRAW);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2, 0,2,3]), gl.STATIC_DRAW);
  return { vbo, ubo, ibo, count: 6 };
}

// ─── Billboard rendering ──────────────────────────────────────────────────────

// PS1 fight texture is 64×256. In battle the Digimon model looks roughly
// human-sized viewed at a slight upward angle. We display the texture on a
// quad scaled to the natural proportions of the model's bounding box.
// Without UV decode, we show the full texture page as a flat sprite.
// The 64×256 page is rendered at 1:4 aspect ratio — models that were taller
// look correct, while wider characters will appear stretched. This is improved
// when UV decoding is completed.

function drawBillboard(gl, prog, mvp, viewEye, worldPos,
                       widthUnits, heightUnits, tex, alpha, tint) {
  // Compute billboard right/up vectors (always face camera)
  const camRight = normalize([mvp[0], mvp[4], mvp[8]]);
  const worldUp = [0, 1, 0];
  const rx = camRight, ry = worldUp;

  const hw = widthUnits * 0.5;
  const hh = heightUnits * 0.5;
  const cx = worldPos[0], cy = worldPos[1] + hh, cz = worldPos[2];

  const tl = [cx - rx[0]*hw + ry[0]*hh, cy - rx[1]*hw + ry[1]*hh, cz - rx[2]*hw + ry[2]*hh];
  const tr = [cx + rx[0]*hw + ry[0]*hh, cy + rx[1]*hw + ry[1]*hh, cz + rx[2]*hw + ry[2]*hh];
  const br = [cx + rx[0]*hw - ry[0]*hh, cy + rx[1]*hw - ry[1]*hh, cz + rx[2]*hw - ry[2]*hh];
  const bl = [cx - rx[0]*hw - ry[0]*hh, cy - rx[1]*hw - ry[1]*hh, cz - rx[2]*hw - ry[2]*hh];

  const bufs = makeQuadBuffers(gl, [tl, tr, br, bl], [[0,0],[1,0],[1,1],[0,1]]);
  drawQuad(gl, prog, mvp, bufs, tex, alpha, tint);
  gl.deleteBuffer(bufs.vbo); gl.deleteBuffer(bufs.ubo); gl.deleteBuffer(bufs.ibo);
}

export function drawQuad(gl, prog, mvp, bufs, tex, alpha, tint) {
  gl.useProgram(prog.program);
  gl.uniformMatrix4fv(prog.uMVP, false, mvp);
  gl.uniform1f(prog.uAlpha, alpha);
  gl.uniform4fv(prog.uTint, tint || [1,1,1,1]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(prog.uTex, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, bufs.vbo);
  gl.enableVertexAttribArray(prog.aPos);
  gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, bufs.ubo);
  gl.enableVertexAttribArray(prog.aUV);
  gl.vertexAttribPointer(prog.aUV, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.ibo);
  gl.drawElements(gl.TRIANGLES, bufs.count, gl.UNSIGNED_SHORT, 0);
}

// A change-stage mesh's matrix (model_mesh.c FIGHTSTG_updateModel: RotMatrixZYX_gte, R = Rz * Ry * Rx, F0x8002b45c;
// the bone rotation from FIGHTSTG_poseBone's integer key blend): ONE function in the engine, changeStageMeshMatrix,
// builds it from the mesh's rotation keys and the motion frame; this only lays its row-major 3x3 (1.0 = 0x1000) out
// as a column-major mat4 for the mesh, applied before the fight-model -> world mapping.
export function changeStageMat4(keys, frame) {
  const r = changeStageMeshMatrix(keys, frame);
  const m = mat4Identity();
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[col * 4 + row] = r[row * 3 + col] / 4096;
  return m;
}

// Draw one projectile mesh layer (interleaved static pos+uv buffers, non-indexed tris).
export function drawProjLayer(gl, prog, mvp, layer, tex, alpha = 1.0, tint = null) {
  gl.useProgram(prog.program);
  gl.uniformMatrix4fv(prog.uMVP, false, mvp);
  gl.uniform1f(prog.uAlpha, alpha);
  gl.uniform4fv(prog.uTint, tint || [1, 1, 1, 1]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(prog.uTex, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
  gl.enableVertexAttribArray(prog.aPos);
  gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, layer.ubo);
  gl.enableVertexAttribArray(prog.aUV);
  gl.vertexAttribPointer(prog.aUV, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, layer.count);
}

export const arenaCullLog = { kept: 0, total: 0 } as ArenaCullLog;

export function setArenaCullSign(s) { S.arenaCullSign = s < 0 ? -1 : 1; return S.arenaCullSign; }

export function arenaCullIndices(mvp, layer) {
  const pos = layer.pos, ref = layer.cullRef;
  if (!pos) return null;
  const nt = (pos.length / 9) | 0;
  const out = [];
  arenaCullLog.total = nt;
  const cache = new Map();
  const projTri = (t) => {
    const b = t * 9;
    const xy = [];
    for (let k = 0; k < 3; k++) {
      const x = pos[b + k * 3], y = pos[b + k * 3 + 1], z = pos[b + k * 3 + 2];
      const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
      if (!(cw > 1e-6)) return null;             // at/behind the eye: the original clips it away
      const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
      const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
      xy.push(cx / cw, cy / cw);
    }
    return xy;
  };
  for (let t = 0; t < nt; t++) {
    const rt = ref ? ref[t] : t;
    let s = cache.get(rt);
    if (s === undefined) { s = projTri(rt); cache.set(rt, s); }
    if (!s) continue;
    const [x0, y0, x1, y1, x2, y2] = s;
    // NCLIP in PS1 screen space (Y down): sy = -ndcY.
    const mac0 = x0 * (-y1 + y2) + x1 * (-y2 + y0) + x2 * (-y0 + y1);
    if (mac0 * S.arenaCullSign > 0) { out.push(t * 3, t * 3 + 1, t * 3 + 2); arenaCullLog.kept++; }
  }
  return out;
}

// Draw one arena layer through the ported cull: only the front-facing primitives
// are drawn (the original's own post-cull set). Uses a dynamic index buffer.
export function drawProjLayerIndexed(gl, prog, mvp, layer, tex, idx, tint = null) {
  if (!idx) { drawProjLayer(gl, prog, mvp, layer, tex, 1, tint); return; }
  if (!layer.ibo) layer.ibo = gl.createBuffer();
  gl.useProgram(prog.program);
  gl.uniformMatrix4fv(prog.uMVP, false, mvp);
  gl.uniform1f(prog.uAlpha, 1.0);
  gl.uniform4fv(prog.uTint, tint || [1, 1, 1, 1]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(prog.uTex, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, layer.vbo);
  gl.enableVertexAttribArray(prog.aPos);
  gl.vertexAttribPointer(prog.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, layer.ubo);
  gl.enableVertexAttribArray(prog.aUV);
  gl.vertexAttribPointer(prog.aUV, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.DYNAMIC_DRAW);
  gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_SHORT, 0);
}
