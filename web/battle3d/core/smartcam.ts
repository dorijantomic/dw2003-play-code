import { MODEL_SCALE } from "../math.js";

// moved by tools/rewrite/split-closure.mjs
export function makeSmartcam(B$) {
function _smartApply(base, p) {
    const v = [base.eye[0] - base.look[0], base.eye[1] - base.look[1], base.eye[2] - base.look[2]];
    const a = p.yaw * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return { eye: [base.look[0] + (v[0] * c - v[2] * s) * p.d, base.look[1] + v[1] * p.h * p.d, base.look[2] + (v[0] * s + v[2] * c) * p.d], look: base.look, fov: base.fov };
  }
// one camera spot's numbers (all 0..1)
  function _smartScore(groups, scale, cam, fs, aspect) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const fwd = nrm(sub(cam.look, cam.eye)), right = nrm([-fwd[2], 0, fwd[0]]);
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    const t = Math.tan(cam.fov / 2), GW = 100, GH = 36, k = MODEL_SCALE * scale;
    const scr = (p) => { const d = sub(p, cam.eye), z = dot(d, fwd); return z > 1 ? [(dot(d, right) / (z * t * aspect) * 0.5 + 0.5) * GW, (0.5 - dot(d, up) / (z * t) * 0.5) * GH, z] : null; };
    let near = Infinity, feet = Infinity, off = 0, corners = 0;
    const boxes = new Uint8Array(GW * GH);
    for (const f of fs) {
      const b = f.aabb;
      near = Math.min(near, dot(sub([(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2], cam.eye), fwd));
      feet = Math.min(feet, b.min[1]);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
        const q = scr([x, y, z]); corners++;
        if (!q) { off++; continue; }
        if (q[0] < 0.025 * GW || q[0] > 0.975 * GW || q[1] < 0.025 * GH || q[1] > 0.975 * GH) off++;
        x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
      }
      for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(GH - 1, Math.ceil(y1) - 1); y++)
        for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(GW - 1, Math.ceil(x1) - 1); x++) boxes[y * GW + x] = 1;
    }
    const hit = new Uint8Array(GW * GH), xs = [0, 0, 0], ys = [0, 0, 0];
    for (const g of groups) {
      const pos = g.pos, ref = g.cullRef; if (!pos) continue;
      const front = new Map();
      const proj3 = (tri) => { const out = []; for (let v = 0; v < 3; v++) { const q = scr([pos[tri * 9 + v * 3] * k, -pos[tri * 9 + v * 3 + 1] * k, -pos[tri * 9 + v * 3 + 2] * k]); if (!q) return null; out.push(q); } return out; };
      tri: for (let ti = 0, nt = (pos.length / 9) | 0; ti < nt; ti++) {
        const rt = ref ? ref[ti] : ti;
        let fr = front.get(rt);
        if (fr === undefined) {
          const q = proj3(rt);       // NCLIP in screen space, Y down: drawn when > 0 (arenaCullIndices)
          fr = !!q && (q[0][0] * (q[1][1] - q[2][1]) + q[1][0] * (q[2][1] - q[0][1]) + q[2][0] * (q[0][1] - q[1][1])) > 0;
          front.set(rt, fr);
        }
        if (!fr) continue;
        let top = -Infinity, anyNear = false;
        for (let v = 0; v < 3; v++) {
          const p = [pos[ti * 9 + v * 3] * k, -pos[ti * 9 + v * 3 + 1] * k, -pos[ti * 9 + v * 3 + 2] * k];
          top = Math.max(top, p[1]);
          const q = scr(p); if (!q) continue tri;
          if (q[2] < near * 0.9) anyNear = true;
          xs[v] = q[0]; ys[v] = q[1];
        }
        if (!anyNear || top < feet + 40) continue;
        const area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
        if (!area) continue;
        const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(GW - 1, Math.ceil(Math.max(...xs)));
        const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(GH - 1, Math.ceil(Math.max(...ys)));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const px = x + 0.5, py = y + 0.5;
          const a = ((xs[1] - px) * (ys[2] - py) - (xs[2] - px) * (ys[1] - py)) / area;
          const b = ((xs[2] - px) * (ys[0] - py) - (xs[0] - px) * (ys[2] - py)) / area;
          if (a >= 0 && b >= 0 && a + b <= 1) hit[y * GW + x] = 1;
        }
      }
    }
    let n = 0, nb = 0, nbh = 0;
    for (let i = 0; i < hit.length; i++) { n += hit[i]; if (boxes[i]) { nb++; nbh += hit[i]; } }
    return { cover: n / hit.length, onFighters: nb ? nbh / nb : 0, offscreen: off / Math.max(1, corners) };
  }
function _smartTotal(m, p) {
    return 8 * m.onFighters + 4 * m.cover + 6 * m.offscreen
      + 0.004 * Math.abs(p.yaw) + 0.5 * Math.abs(Math.log(p.h)) + 0.6 * Math.abs(Math.log(p.d));
  }
// scores `n` more candidates of a job; returns true when the job is finished
  function _smartStep(job, n) {
    const t0 = performance.now();
    for (; n > 0 && job.i < B$.SMART_CANDS.length; n--, job.i++) {
      const p = B$.SMART_CANDS[job.i], m = _smartScore(job.groups, job.scale, _smartApply(job.base, p), job.fs, job.aspect), s = _smartTotal(m, p);
      if (!job.def) job.def = { p, m, s };
      if (!job.best || s < job.best.s) job.best = { p, m, s };
    }
    job.ms += performance.now() - t0;
    return job.i >= B$.SMART_CANDS.length;
  }
function _smartJob(base, fs, pk = B$.activeArena, scale = B$.arenaScale) {
    const groups = pk?.groups; if (!groups?.length) return null;
    return { base, fs, groups, scale, aspect: B$.canvas.width / Math.max(1, B$.canvas.height), name: pk.name, i: 0, ms: 0, def: null, best: null };
  }
function _smartCameraShot() {
    const base = _multiCameraShot(); if (!base) return null;
    const fs = [...B$.extras.values()].filter((f) => f.model && f.visible && f.aabb);
    const key = `${B$.activeArena?.name}|${B$.arenaScale.toFixed(2)}|` + fs.map((f) => `${Math.round(f.pos[0] / 150)},${Math.round(f.pos[2] / 150)}`).join(";");
    // a new pick is worked out over several frames (12 spots a frame, a few ms), only while nobody is acting
    if (!B$.smartJob && !B$.coordinator.active && B$.activeArena?.groups && (B$.orbitClock - B$.smartAt > 1 || !B$.smartPick) && key !== B$.smartKey) {
      B$.smartJob = _smartJob(base, fs); B$.smartKey = key;
    }
    if (B$.smartJob && _smartStep(B$.smartJob, 12)) {
      B$.smartInfo = B$._smartResult(B$.smartJob); B$.smartPick = B$.smartJob.best.p; B$.smartAt = B$.orbitClock; B$.smartJob = null;
    }
    const dt = Math.min(0.25, Math.max(0, B$.orbitClock - B$.smartLastClock)); B$.smartLastClock = B$.orbitClock;
    const p = B$.smartPick || { yaw: 0, h: 1, d: 1 }, k = 1 - Math.exp(-dt * 2.5);
    B$.smartCur.yaw += (p.yaw - B$.smartCur.yaw) * k; B$.smartCur.h += (p.h - B$.smartCur.h) * k; B$.smartCur.d += (p.d - B$.smartCur.d) * k;
    return _smartApply(base, B$.smartCur);
  }
/** (checks) the smart camera's numbers: the last pick in the live fight, or a fresh pick for arena pack `name`
   *  at `scale` (default: the scale that pack would get) with the current fighters; null while the pack loads. */
  function probeSmartCam(name, want = B$.arenaScale, scale = null) {
    if (!name) return B$.smartInfo;
    const pk = B$.loadArenaPack(name); if (!pk?.groups) return null;
    const base = _multiCameraShot(), fs = [...B$.extras.values()].filter((f) => f.model && f.visible && f.aabb);
    if (!base || !fs.length) return null;
    const job = _smartJob(base, fs, pk, scale ?? B$._arenaScaleClear(want, pk));
    _smartStep(job, B$.SMART_CANDS.length);
    return B$._smartResult(job);
  }
// The wide camera: behind the near line, a little to the side, looking at the middle of everybody.
  function _multiCameraShot() {
    const fs = [...B$.extras.values()].filter((f) => f.model && f.visible && f.aabb);
    if (!fs.length) return null;
    const near = fs.filter((f) => f.side === "player"), far = fs.filter((f) => f.side === "enemy");
    const avg = (list) => list.length ? [list.reduce((s, f) => s + f.pos[0], 0) / list.length, list.reduce((s, f) => s + f.pos[2], 0) / list.length] : null;
    const nc = avg(near) ?? avg(far), fc = avg(far) ?? avg(near);
    let minX = Infinity, maxX = -Infinity, tall = 60;
    // framed by each fighter's RESTING size (restW / restH, measured while it idles), not this frame's pose box: the box
    // breathes with the idle animation and the whole shot (ground, sky, moon) bobbed with it (2v2 idle: eye height
    // wobbled 16 units in 10 s). A fighter not measured yet uses its live box.
    for (const f of fs) {
      const hw = f.restW ? f.restW * MODEL_SCALE / 2 : null;   // restW is stored / ARENA (= MODEL_SCALE)
      minX = Math.min(minX, hw != null ? f.pos[0] - hw : f.aabb.min[0]); maxX = Math.max(maxX, hw != null ? f.pos[0] + hw : f.aabb.max[0]);
      tall = Math.max(tall, f.restH || f.aabb.max[1] - f.aabb.min[1]);
    }
    let dir = [fc[0] - nc[0], fc[1] - nc[1]];
    const dl = Math.hypot(dir[0], dir[1]);
    dir = dl > 1 ? [dir[0] / dl, dir[1] / dl] : [0, 1];
    const side = [-dir[1], dir[0]];
    const W = Math.max(260, maxX - minX), depth = dl;
    // a three-quarter view from beside the near line: both lines read side by side, and an attacker running at the far line stays in shot
    const sway = Math.sin(B$.orbitClock * 0.4) * W * 0.06;
    const back = Math.max(520, W * 0.55 + depth * 0.30) + tall * 0.9;
    const lateral = W * 0.55 + tall * 0.5 + sway;
    const eye = [nc[0] - dir[0] * back + side[0] * lateral, tall * 1.5 + W * 0.14, nc[1] - dir[1] * back + side[1] * lateral];
    const look = [(nc[0] + fc[0]) / 2, tall * 0.3, (nc[1] + fc[1]) / 2];
    return { eye, look, fov: Math.PI / 3.6 };
  }
function _projectExtras(pv, W, H) {
    const proj = (x, y, z) => {
      const cx = pv[0] * x + pv[4] * y + pv[8] * z + pv[12], cy = pv[1] * x + pv[5] * y + pv[9] * z + pv[13], cw = pv[3] * x + pv[7] * y + pv[11] * z + pv[15];
      return cw > 0 ? { x: cx / cw * 0.5 + 0.5, y: 1 - (cy / cw * 0.5 + 0.5) } : null;
    };
    for (const f of B$.extras.values()) {
      if (!f.aabb) continue;
      const cx = (f.aabb.min[0] + f.aabb.max[0]) / 2, cz = (f.aabb.min[2] + f.aabb.max[2]) / 2;
      const top = proj(cx, f.aabb.max[1], cz), foot = proj(cx, f.aabb.min[1], cz);
      if (top && foot) B$.fighterScreen.set(f.id, { x: top.x, topY: top.y, footY: foot.y });
    }
  }
  return { _smartApply, _smartScore, _smartTotal, _smartStep, _smartJob, _smartCameraShot, probeSmartCam, _multiCameraShot, _projectExtras };
}
