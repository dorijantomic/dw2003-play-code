import { MODEL_SCALE } from "../math.js";
import { loadTexturePixels, createProgram } from "../gl.js";
import { VERT_COL_SRC, FRAG_COL_SRC } from "../shaders.js";
import type { Battle3DContext } from "../../types/battle3d.js";
interface AtmosSky { rain: number; snow: number; sand: number; night: number }


// moved by tools/rewrite/split-closure.mjs
export function makeAtmos(B$: Battle3DContext) {
function _atmosFrame(eye, look) {
    if (!window.__fx?.battleatmos) return null;
    const a = window.__battleAtmos?.();
    if (!a) return null;
    const L = a.L || {};
    const rain = Math.min(1, L.rain || 0), snow = Math.min(1, (L.snow || 0) + (L.blizzard || 0)), sand = Math.min(1, L.sand || 0);
    const tint = a.tod && a.rgb ? a.rgb.map((v) => v / 255) : a.nightMap ? [0.55, 0.55, 0.8] : [1, 1, 1];
    const mult = tint.map((v) => v * (1 - 0.2 * rain));
    const night = Math.max(0, Math.min(1, (1 - (mult[0] + mult[1] + mult[2]) / 3) * 2.2));
    const haze = B$.ATM_HAZE_DAY!.map((v, i) => v + (B$.ATM_HAZE_NIGHT![i]! - v) * night);
    const wsum = snow + rain + sand, dim = 1 - night * 0.75;
    const fogCol = wsum > 0
      ? haze.map((v, i) => { const w = (B$.ATM_SNOW![i]! * snow + B$.ATM_RAIN![i]! * rain + B$.ATM_SAND![i]! * sand) / wsum * dim; const k = Math.min(1, wsum); return v + (w - v) * k; })
      : haze;
    const fogMax = Math.min(0.85, 0.18 + 0.45 * snow + 0.35 * rain + 0.55 * sand + (a.foggy ? 0.35 : 0));
    const camDist = Math.hypot(eye[0] - look[0], eye[1] - look[1], eye[2] - look[2]) || 1;
    const start = camDist * 1.15 / 1000, end = camDist * 5 / 1000;
    // a storm's lightning: a short white flash, the thunder a moment later
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, B$.atmLastT ? now - B$.atmLastT : 0); B$.atmLastT = now;
    if (rain > 0.5) {
      if (!B$.atmNextBolt) B$.atmNextBolt = now + 4 + Math.random() * 8;
      if (now > B$.atmNextBolt) { B$.atmFlash = 1; B$.atmThunderAt = now + 0.4 + Math.random() * 0.8; B$.atmNextBolt = now + 6 + Math.random() * 10; }
    }
    if (B$.atmThunderAt && now > B$.atmThunderAt) { B$.atmThunderAt = 0; try { a.thunder?.(); } catch { } }
    B$.atmFlash = Math.max(0, B$.atmFlash! - dt * 5);
    const flash = B$.atmFlash > 0 ? 0.9 * B$.atmFlash * (0.6 + 0.4 * Math.sin(now * 90)) : 0;
    return { rain, snow, sand, night, dt, camDist,
      gradeSub: mult.map((v) => 1 - v - flash), fogCol, fogP: [start, 1 / Math.max(1e-3, end - start), fogMax] };
  }
function _atmosArena(atm: AtmosSky | null, world: Float32Array, eye: number[], look: number[], fov: number, aspect: number, scale: number) {
    B$.gl!.useProgram(B$.texP!.program);
    if (!atm) {
      B$.gl!.uniformMatrix4fv(B$.texP!.uSkyM, false, new Float32Array(16));
      B$.gl!.uniform4fv(B$.texP!.uSky, [0, 0, 0, 0]); B$.gl!.uniform2fv(B$.texP!.uWater, [0, 0]);
      return;
    }
    // the moon: a direction picked once per arena, from the arena itself (_atmosMoonPick), after the shot has settled
    const panP = B$._panoActive(), arenaName = B$.activeArena?.name + (panP ? "|" + panP.id : "");   // a panorama changes where sky is
    if (B$.atmMoon?.arena !== arenaName) { B$.atmMoon = { arena: arenaName, dir: null, since: performance.now(), pending: false }; }
    if (!B$.atmMoon!.dir && !B$.atmMoon!.pending && atm.night > 0.3 && performance.now() - B$.atmMoon!.since > 1500) {
      B$.atmMoon!.pending = true;
      const want = B$.atmMoon;
      _atmosMoonPick(B$.activeArena, eye.slice(), look.slice(), fov, aspect, scale, panP!).then((r) => { if (B$.atmMoon === want) { want!.dir = r?.dir || null; want!.pick = r; } });
    }
    const k = MODEL_SCALE * scale / 1000, nightK = Math.max(0, Math.min(1, (atm.night - 0.35) / 0.4));
    B$.gl!.uniformMatrix4fv(B$.texP!.uSkyM, false, world);
    B$.gl!.uniform3fv(B$.texP!.uEye, eye.map((v) => v / 1000));
    B$.gl!.uniform3fv(B$.texP!.uMoonDir, B$.atmMoon!.dir || [0, 1, 0]);
    const clear = 1 - Math.min(1, atm.rain + atm.snow + atm.sand);   // nothing shows through a storm
    B$.gl!.uniform4fv(B$.texP!.uSky, [B$.ATM_HORIZON! * k, nightK * clear, B$.atmMoon!.dir ? nightK * clear : 0, performance.now() / 1000 % 3600]);
    B$.gl!.uniform2fv(B$.texP!.uWater, _atmosWaterU(atm, scale));
  }
function _atmosWaterU(atm, scale) { return [B$.ARENA_WATER!.has(B$.activeArena?.name!) ? 1 - 0.6 * atm.night : 0, B$.ATM_GROUND! * MODEL_SCALE * scale / 1000]; }
// Where the moon can be seen: directions over the upper part of this shot (9 x 7 screen points); a ray from the eye
  // along each one (and 4 more at the moon's own edge) must first hit an arena triangle above the horizon whose texel is
  // sky-blue by the shader's own rule. Of those, the one nearest a little right of centre, two thirds up. None: no moon.
  async function _atmosMoonPick(pk, eye, look, fov, aspect, scale, pan = null) {
    const groups = pk?.groups; if (!groups?.length) return null;
    const pages = new Map();
    for (const g of groups) {
      const col = g.clut ? g.clut[0] : 0, row = g.clut ? g.clut[1] : 255, key = `${g.page || "wall"}_c${col}_r${row}`;
      if (!pages.has(key)) pages.set(key, await loadTexturePixels(`assets/battle/arenas/${pk.name}/${key}.png`));
      g._px = pages.get(key);
    }
    const k = MODEL_SCALE * scale, horizon = B$.ATM_HORIZON! * k;
    const hitSky = (d) => {
      let best = null;
      for (const g of pan ? [] : groups) {      // a panorama replaces the arena: only the painted sky counts
        const pos = g.pos, uv = g.uv; if (!pos || !uv || !g._px) continue;
        for (let t = 0, nt = (pos.length / 9) | 0; t < nt; t++) {
          const b = t * 9;
          const p0 = [pos[b] * k, -pos[b + 1] * k, -pos[b + 2] * k], p1 = [pos[b + 3] * k, -pos[b + 4] * k, -pos[b + 5] * k], p2 = [pos[b + 6] * k, -pos[b + 7] * k, -pos[b + 8] * k];
          const e1 = [p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!], e2 = [p2[0]! - p0[0]!, p2[1]! - p0[1]!, p2[2]! - p0[2]!];
          const q = [d[1] * e2[2]! - d[2] * e2[1]!, d[2] * e2[0]! - d[0] * e2[2]!, d[0] * e2[1]! - d[1] * e2[0]!];
          const det = e1[0]! * q[0]! + e1[1]! * q[1]! + e1[2]! * q[2]!; if (Math.abs(det) < 1e-9) continue;
          const tv = [eye[0] - p0[0]!, eye[1] - p0[1]!, eye[2] - p0[2]!], u = (tv[0]! * q[0]! + tv[1]! * q[1]! + tv[2]! * q[2]!) / det; if (u < 0 || u > 1) continue;
          const r = [tv[1]! * e1[2]! - tv[2]! * e1[1]!, tv[2]! * e1[0]! - tv[0]! * e1[2]!, tv[0]! * e1[1]! - tv[1]! * e1[0]!];
          const v = (d[0] * r[0]! + d[1] * r[1]! + d[2] * r[2]!) / det; if (v < 0 || u + v > 1) continue;
          const dist = (e2[0]! * r[0]! + e2[1]! * r[1]! + e2[2]! * r[2]!) / det; if (dist <= 0 || (best && dist >= best.dist)) continue;
          const w = 1 - u - v, ub = (t * 6);
          best = { dist, g, y: eye[1] + d[1] * dist, u: w * uv[ub] + u * uv[ub + 2] + v * uv[ub + 4], v: w * uv[ub + 1] + u * uv[ub + 3] + v * uv[ub + 5] };
        }
      }
      let tx;
      if (best) { if (best.y <= horizon) return false; tx = { px: best.g._px, u: best.u, v: best.v }; }
      else if (pan) tx = B$._panoTexel(pan, eye, d);
      if (!tx) return false;
      const px = tx.px, x = Math.min(px.width - 1, Math.max(0, Math.floor(tx.u * px.width))), y = Math.min(px.height - 1, Math.max(0, Math.floor(tx.v * px.height)));
      const i = (y * px.width + x) * 4, R = px.data[i] / 255, G = px.data[i + 1] / 255, B = px.data[i + 2] / 255;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      return px.data[i + 3] >= 13 && mx > 0.3 && (mx - mn) / mx > 0.15 && B > R + 0.06 && B >= G;
    };
    const f = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]], fl = Math.hypot(...f), fw = f.map((v) => v / fl);
    const rt = [-fw[2]!, 0, fw[0]], rl = Math.hypot(rt[0]!, rt[2]!) || 1; rt[0]! /= rl; rt[2]! /= rl;
    const up = [rt[1]! * fw[2]! - rt[2]! * fw[1]!, rt[2]! * fw[0]! - rt[0]! * fw[2]!, rt[0]! * fw[1]! - rt[1]! * fw[0]!];
    const tv = Math.tan(fov / 2), th = tv * aspect;
    const dirAt = (sx, sy) => { const d = fw.map((v, i) => v + rt[i]! * sx * th + up[i]! * sy * tv), l = Math.hypot(...d); return d.map((v) => v / l); };
    const cands = [];
    for (let ix = -4; ix <= 4; ix++) for (let iy = 1; iy <= 7; iy++) cands.push([ix * 0.2, iy * 0.12]);
    cands.sort((a, b) => (Math.abs(a[0]! - 0.35) + Math.abs(a[1]! - 0.6)) - (Math.abs(b[0]! - 0.35) + Math.abs(b[1]! - 0.6)));
    const edge = 0.03;                                   // the halo's reach (rad), so the whole moon sits on sky
    for (const [sx, sy] of cands) {
      const d = dirAt(sx, sy);
      const ok = hitSky(d) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => {
        const e = d.map((v, i) => v + (rt[i]! * a! + up[i]! * b!) * edge), l = Math.hypot(...e); return hitSky(e.map((v) => v / l));
      });
      if (ok) return { dir: d, screen: [sx, sy] };
    }
    return { dir: null, tried: cands.length };
  }
function _atmosUniforms(atm) {
    B$.gl!.useProgram(B$.texP!.program);
    B$.gl!.uniform3fv(B$.texP!.uGradeSub, atm ? atm.gradeSub : [0, 0, 0]);
    B$.gl!.uniform3fv(B$.texP!.uFogCol, atm ? atm.fogCol : [0, 0, 0]);
    B$.gl!.uniform3fv(B$.texP!.uFogP, atm ? atm.fogP : [0, 0, 0]);
  }
// snow / rain / sand: particles in a box in front of the camera, wrapped so the box is always full
  function _drawWeather(pv, atm, eye, look) {
    const want = Math.round(900 * atm.snow + 800 * atm.rain + 700 * atm.sand);
    if (!want) return;
    if (!B$.atmColProg) {
      const p = createProgram(B$.gl, VERT_COL_SRC, FRAG_COL_SRC);
      B$.atmColProg = { program: p, aPos: B$.gl!.getAttribLocation(p, "aPos"), aColor: B$.gl!.getAttribLocation(p, "aColor"), uMVP: B$.gl!.getUniformLocation(p, "uMVP") };
      B$.atmColBuf = B$.gl!.createBuffer();
    }
    const D = atm.camDist, box = [D * 1.6, D * 0.9, D * 1.6];
    const fwd = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]].map((v) => v / D);
    const c = [eye[0] + fwd[0]! * D * 0.75, look[1] + D * 0.2, eye[2] + fwd[2]! * D * 0.75];
    if (!B$.atmParts || B$.atmParts.length !== want) {
      B$.atmParts = [];
      for (let i = 0; i < want; i++) {
        const kind = i < 900 * atm.snow ? 0 : i < 900 * atm.snow + 800 * atm.rain ? 1 : 2;
        B$.atmParts.push({ kind, p: [Math.random(), Math.random(), Math.random()], ph: Math.random() * 6.28, s: 0.6 + Math.random() * 0.8 });
      }
    }
    const t = performance.now() / 1000, dt = atm.dt;
    const right = [-fwd[2]!, 0, fwd[0]], rl = Math.hypot(right[0]!, right[2]!) || 1; right[0]! /= rl; right[2]! /= rl;
    const v = new Float32Array(B$.atmParts.length * 6 * 7);
    let o = 0;
    const put = (x, y, z, col) => { v[o++] = x; v[o++] = y; v[o++] = z; v[o++] = col[0]; v[o++] = col[1]; v[o++] = col[2]; v[o++] = col[3]; };
    const dark = 1 - atm.night * 0.6;
    for (const q of B$.atmParts) {
      // fall speed / wind as a share of the box per second
      const fall = q.kind === 0 ? 0.12 * q.s : q.kind === 1 ? 1.6 * q.s : 0.05;
      const side = q.kind === 0 ? 0.03 * Math.sin(t * 0.8 + q.ph) : q.kind === 1 ? 0.08 : 0.9 * q.s;
      q.p[1] = (q.p[1]! - fall * dt + 1) % 1; q.p[0] = (q.p[0]! + side * dt + 1) % 1;
      if (q.kind === 2) q.p[1] = (q.p[1] + 0.02 * Math.sin(t * 2 + q.ph) * dt + 1) % 1;
      const x = c[0] + (q.p[0] - 0.5) * box[0]!, y = c[1] + (q.p[1] - 0.5) * box[1]!, z = c[2] + (q.p[2]! - 0.5) * box[2]!;
      let w, h, col;
      if (q.kind === 0) { w = h = D * 0.0045 * q.s; col = [dark, dark, dark * 1.02, 0.85]; }
      else if (q.kind === 1) { w = D * 0.0012; h = D * 0.05 * q.s; col = [0.75 * dark, 0.8 * dark, 0.9 * dark, 0.35]; }
      else { w = D * 0.012 * q.s; h = D * 0.0015; col = [0.85 * dark, 0.7 * dark, 0.5 * dark, 0.4]; }
      // a quad facing the camera: `right` across, world up along (rain slants a little with the wind)
      const rx = right[0]! * w, rz = right[2]! * w, ux = q.kind === 1 ? right[0]! * h * 0.08 : 0, uz = q.kind === 1 ? right[2]! * h * 0.08 : 0;
      put(x - rx, y, z - rz, col); put(x + rx, y, z + rz, col); put(x + rx + ux, y + h, z + rz + uz, col);
      put(x - rx, y, z - rz, col); put(x + rx + ux, y + h, z + rz + uz, col); put(x - rx + ux, y + h, z - rz + uz, col);
    }
    B$.gl!.useProgram(B$.atmColProg.program);
    B$.gl!.uniformMatrix4fv(B$.atmColProg.uMVP, false, pv);
    B$.gl!.bindBuffer(B$.gl!.ARRAY_BUFFER, B$.atmColBuf!);
    B$.gl!.bufferData(B$.gl!.ARRAY_BUFFER, v, B$.gl!.DYNAMIC_DRAW);
    B$.gl!.enableVertexAttribArray(B$.atmColProg.aPos);
    B$.gl!.vertexAttribPointer(B$.atmColProg.aPos, 3, B$.gl!.FLOAT, false, 28, 0);
    B$.gl!.enableVertexAttribArray(B$.atmColProg.aColor);
    B$.gl!.vertexAttribPointer(B$.atmColProg.aColor, 4, B$.gl!.FLOAT, false, 28, 12);
    B$.gl!.enable(B$.gl!.BLEND); B$.gl!.blendFunc(B$.gl!.SRC_ALPHA, B$.gl!.ONE_MINUS_SRC_ALPHA);
    B$.gl!.depthMask(false);
    B$.gl!.drawArrays(B$.gl!.TRIANGLES, 0, o / 7);
    B$.gl!.depthMask(true);
    B$.gl!.disableVertexAttribArray(B$.atmColProg.aColor);
  }
/** (checks) this frame's battle atmosphere numbers, or null when off / not available. */
  function getAtmosphere() { return B$.lastAtm && { ...B$.lastAtm, particles: B$.atmParts ? B$.atmParts.length : 0, moonDir: B$.atmMoon?.dir, moonPick: B$.atmMoon?.pick, water: B$.ARENA_WATER!.has(B$.activeArena?.name!), arena: B$.activeArena?.name }; }
  return { _atmosFrame, _atmosArena, _atmosWaterU, _atmosMoonPick, _atmosUniforms, _drawWeather, getAtmosphere };
}
