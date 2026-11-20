// Free, game-independent camera for the animation viewer (web/anim-viewer.html).
//
// The battle's camera is a PS1 camera RECORD: an action's op5 opcodes and the idle director
// overwrite one live record, and the renderer draws through whatever wrote it last
// (web/battle3d.js "THE camera record, and who owns it"). A model viewer cannot be built on that
// — the script would yank the user's view on every attack — so the viewer owns its own camera:
// this module is pure math (no DOM, no renderer), and battle3d draws through it only while the
// "free camera" mode is on (setFreeCameraView). Everything here is in the renderer's RENDER space
// (the same numbers getFighterBounds returns), so no PS1 mapping is involved.
//
// Conventions
//   yaw   radians about +Y; yaw 0 puts the eye at +Z of the pivot looking toward -Z ("front").
//   pitch radians above the horizon (positive = eye above the pivot); ±90° is straight above below.
//   dist  eye-to-pivot distance in render units.
//   pivot the point orbited, framed and panned around.
// The eye is pivot + dist * (sin(yaw)cos(pitch), sin(pitch), cos(yaw)cos(pitch)). The basis is
// derived from yaw, NOT from a cross product with world up, so it stays finite at the poles
// (straight above/below) where a lookAt(up=+Y) is degenerate — that is the "no gimbal flip" rule.

export const DEG = Math.PI / 180;
const EPS = 1e-9;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential damping: fraction of the remaining distance per second.
const damp = (cur, target, rate, dt) => (rate <= 0 || dt <= 0 ? target : lerp(cur, target, 1 - Math.exp(-rate * dt)));

export const PITCH_LIMIT = 89 * DEG;        // default clamp: never exactly vertical (avoids a degenerate up)
export const PITCH_LIMIT_FULL = 89.95 * DEG; // "allow full pitch" toggle

/** The preset views, as {yaw,pitch} in degrees. `battle` is handled by the page (the game camera). */
export const PRESETS = {
  front: { yaw: 0, pitch: 8 },
  back: { yaw: 180, pitch: 8 },
  left: { yaw: 90, pitch: 8 },
  right: { yaw: -90, pitch: 8 },
  top: { yaw: 0, pitch: 89 },
  bottom: { yaw: 0, pitch: -89 },
  threeQuarter: { yaw: 35, pitch: 22 },
};

export const VIEW_KEYS = ["yaw", "pitch", "dist", "px", "py", "pz", "fov", "ortho", "lock"];

export function createFreeCamera(opts = {}) {
  const cam = {
    // current (what is drawn) and target (what damping moves toward)
    pivot: [0, 0, 0],
    targetPivot: [0, 0, 0],
    yaw: (opts.yaw != null ? opts.yaw : 0),
    pitch: (opts.pitch != null ? opts.pitch : 8 * DEG),
    dist: opts.dist != null ? opts.dist : 4000,
    targetYaw: 0,
    targetPitch: 0,
    targetDist: 0,
    fovDeg: opts.fovDeg != null ? +opts.fovDeg : 45,
    ortho: !!opts.ortho,
    damping: opts.damping != null ? +opts.damping : 14,
    autoOrbitSpeed: 0,          // degrees per second; 0 = off
    padding: opts.padding != null ? +opts.padding : 1.35,
    minDist: 1,
    maxDist: 400000,
    allowFullPitch: !!opts.allowFullPitch,
    flyMode: false,
    flySpeed: 1,
    // The point a "lock to the Digimon" pivot follows (set by the page each frame from the model's
    // own bounds). Null = the pivot never moves on its own (lock to world).
    lockPoint: null,
    // Largest bounds seen this frame, for F "frame all" / "frame attack".
    lastBounds: null,
    _lastAzimuthDelta: 0,
  };
  cam.targetYaw = cam.yaw;
  cam.targetPitch = cam.pitch;
  cam.targetDist = cam.dist;

  const maxPitch = () => (cam.allowFullPitch ? PITCH_LIMIT_FULL : PITCH_LIMIT);

  function clampPitch(p) {
    const m = maxPitch();
    return clamp(p, -m, m);
  }

  /** Camera basis. right/up are finite at the poles because right comes from yaw alone. */
  function basis() {
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    const sp = Math.sin(cam.pitch), cp = Math.cos(cam.pitch);
    const forward = [-sy * cp, -sp, -cy * cp];      // pivot - eye, normalised
    const right = [cy, 0, -sy];                     // forward x worldUp, yaw-only
    const up = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];
    return { forward, right, up };
  }

  function eye(out) {
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const p = out || [0, 0, 0];
    p[0] = cam.pivot[0] + cam.dist * Math.sin(cam.yaw) * cp;
    p[1] = cam.pivot[1] + cam.dist * sp;
    p[2] = cam.pivot[2] + cam.dist * Math.cos(cam.yaw) * cp;
    return p;
  }

  function look() { return [cam.pivot[0], cam.pivot[1], cam.pivot[2]]; }

  /** Orbit the target by degrees (sign: positive = camera moves counter-clockwise seen from above). */
  function orbitBy(dYawDeg, dPitchDeg = 0, { immediate = false } = {}) {
    cam.targetYaw += dYawDeg * DEG;
    cam._lastAzimuthDelta = dYawDeg;
    cam.targetPitch = clampPitch(cam.targetPitch + dPitchDeg * DEG);
    if (immediate) {
      cam.yaw = cam.targetYaw;
      cam.pitch = cam.targetPitch;
    }
    return { yaw: cam.targetYaw, pitch: cam.targetPitch };
  }

  /** Mouse orbit: dx pixels right, dy pixels down. 0.4°/px, the usual model-viewer feel. */
  function orbitPixels(dx, dy, degPerPixel = 0.4) {
    return orbitBy(-dx * degPerPixel, -dy * degPerPixel);
  }

  /** Pan the pivot in the camera's own screen plane; (dx,dy) in pixels. */
  function panPixels(dx, dy, viewportH = 900) {
    const { right, up } = basis();
    // world units per pixel at the pivot plane for the CURRENT vertical fov
    const unitsPerPx = (2 * cam.dist * Math.tan(cam.fovDeg * DEG / 2)) / Math.max(1, viewportH);
    const sx = -dx * unitsPerPx, sy = dy * unitsPerPx;
    cam.targetPivot = [
      cam.targetPivot[0] + right[0] * sx + up[0] * sy,
      cam.targetPivot[1] + right[1] * sx + up[1] * sy,
      cam.targetPivot[2] + right[2] * sx + up[2] * sy,
    ];
    return cam.targetPivot.slice();
  }

  /**
   * Dolly by `factor` (<1 = closer). With `cursorNdc` [x,y] in -1..1 the world point under the
   * cursor stays under the cursor: the pivot slides toward that point by the same fraction the
   * distance shrinks by (the standard zoom-to-cursor construction).
   */
  function zoomBy(factor, cursorNdc = null, aspect = 1) {
    const f = clamp(+factor || 1, 0.1, 10);
    const newDist = clamp(cam.dist * f, cam.minDist, cam.maxDist);
    const applied = newDist / cam.dist;
    if (cursorNdc && (cursorNdc[0] || cursorNdc[1])) {
      const { forward, right, up } = basis();
      const th = Math.tan(cam.fovDeg * DEG / 2);
      // ray through the cursor in world space
      const dx = right[0] * cursorNdc[0] * th * aspect + up[0] * cursorNdc[1] * th + forward[0];
      const dy = right[1] * cursorNdc[0] * th * aspect + up[1] * cursorNdc[1] * th + forward[1];
      const dz = right[2] * cursorNdc[0] * th * aspect + up[2] * cursorNdc[1] * th + forward[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const dir = [dx / len, dy / len, dz / len];
      const denom = dir[0] * forward[0] + dir[1] * forward[1] + dir[2] * forward[2];
      if (denom > 0.05) {
        const t = cam.dist / denom;               // distance along the ray to the pivot plane
        const o = eye();
        const hit = [o[0] + dir[0] * t, o[1] + dir[1] * t, o[2] + dir[2] * t];
        const k = 1 - applied;                     // how much closer we got
        cam.targetPivot = [
          cam.targetPivot[0] + (hit[0] - cam.targetPivot[0]) * k,
          cam.targetPivot[1] + (hit[1] - cam.targetPivot[1]) * k,
          cam.targetPivot[2] + (hit[2] - cam.targetPivot[2]) * k,
        ];
      }
    }
    cam.targetDist = clamp(newDist, cam.minDist, cam.maxDist);
    cam.dist = cam.targetDist;   // zoom is immediate: wheel steps must feel 1:1, not eased
    return cam.dist;
  }

  /** Half-extents of a {min,max} box; also accepts a centre + size. */
  function boxOf(bounds) {
    if (!bounds) return null;
    if (bounds.min && bounds.max) {
      const min = bounds.min, max = bounds.max;
      return { center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
               half: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2] };
    }
    if (bounds.center && bounds.half) return { center: bounds.center, half: bounds.half };
    return null;
  }

  /** The distance that fits a box in the frustum with `padding`, for the current yaw/pitch/fov. */
  function fitDistance(box, aspect = 4 / 3, padding = cam.padding) {
    const { right, up, forward } = basis();
    const c = box.center, h = box.half;
    // extent of the box along the screen axes: sum |axis·half| is the exact projected half-size
    const ex = Math.abs(right[0]) * h[0] + Math.abs(right[1]) * h[1] + Math.abs(right[2]) * h[2];
    const ey = Math.abs(up[0]) * h[0] + Math.abs(up[1]) * h[1] + Math.abs(up[2]) * h[2];
    const ez = Math.abs(forward[0]) * h[0] + Math.abs(forward[1]) * h[1] + Math.abs(forward[2]) * h[2];
    const th = Math.tan(cam.fovDeg * DEG / 2);
    // for ortho the projection is a box: the same half-extents, no perspective divide
    if (cam.ortho) return Math.max(1, 2 * Math.max(ey, ex / Math.max(0.1, aspect)) * padding + ez);
    const dV = ey / th;
    const dH = ex / (th * Math.max(0.1, aspect));
    return Math.max(0.01, Math.max(dV, dH) * padding + ez);
  }

  /** Frame an AABB: pivot to its centre, distance to fit it. Animated unless immediate. */
  function frameBounds(bounds, aspect = 4 / 3, { immediate = false, padding = cam.padding } = {}) {
    const box = boxOf(bounds);
    if (!box) return false;
    cam.targetPivot = box.center.slice();
    // framing is sacred: the fit distance is NOT clamped by the interaction limits (a stale min/max
    // from the previous model must never crop the current one)
    cam.targetDist = fitDistance(box, aspect, padding);
    cam.lastBounds = { min: [box.center[0] - box.half[0], box.center[1] - box.half[1], box.center[2] - box.half[2]],
                       max: [box.center[0] + box.half[0], box.center[1] + box.half[1], box.center[2] + box.half[2]] };
    if (immediate) {
      cam.pivot = cam.targetPivot.slice();
      cam.dist = cam.targetDist;
    }
    return true;
  }

  /** Frame a list of bounds (e.g. the model over the whole clip + its projectiles). */
  function frameUnion(list, aspect = 4 / 3, opts = {}) {
    const boxes = (list || []).map(boxOf).filter(Boolean);
    if (!boxes.length) return false;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const b of boxes) for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.center[i] - b.half[i]);
      max[i] = Math.max(max[i], b.center[i] + b.half[i]);
    }
    if (!min.every(Number.isFinite)) return false;
    return frameBounds({ min, max }, aspect, opts);
  }

  function setPreset(name, { immediate = false } = {}) {
    const p = PRESETS[name];
    if (!p) return false;
    cam.targetYaw = p.yaw * DEG;
    // shortest way round keeps a preset from spinning the long way when the yaw has wrapped
    const twoPi = Math.PI * 2;
    let d = cam.targetYaw - cam.yaw;
    d = ((d + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
    cam.targetYaw = cam.yaw + d;
    cam.targetPitch = clampPitch(p.pitch * DEG);
    if (immediate) { cam.yaw = cam.targetYaw; cam.pitch = cam.targetPitch; }
    return true;
  }

  /** Home: pivot on the Digimon, 3/4 view, framed. */
  function reset(bounds, aspect = 4 / 3) {
    cam.autoOrbitSpeed = 0;
    cam.lockPoint = null;
    setPreset("threeQuarter");
    if (bounds) frameBounds(bounds, aspect, { immediate: true });
    else { cam.targetPivot = [0, 0, 0]; cam.targetDist = 4000; }
    cam.yaw = cam.targetYaw; cam.pitch = cam.targetPitch;
    cam.pivot = cam.targetPivot.slice();
    cam.dist = cam.targetDist;
    return true;
  }

  /** Fly mode translation: WASD in the camera plane, Q/E world-down/up. dt seconds. */
  function fly(keys, dt) {
    const active = keys && (keys.w || keys.a || keys.s || keys.d || keys.q || keys.e);
    if (!active || dt <= 0) return false;
    const { forward, right, up } = basis();
    const flatF = [forward[0], 0, forward[2]];
    const fl = Math.hypot(flatF[0], flatF[2]) || 1;
    flatF[0] /= fl; flatF[2] /= fl;
    const speed = cam.dist * 0.9 * cam.flySpeed * dt;   // relative speed: consistent at any zoom
    const move = [0, 0, 0];
    const add = (v, k) => { move[0] += v[0] * k; move[1] += v[1] * k; move[2] += v[2] * k; };
    if (keys.w) add(flatF, speed);
    if (keys.s) add(flatF, -speed);
    if (keys.d) add(right, speed);
    if (keys.a) add(right, -speed);
    if (keys.e) add([0, 1, 0], speed);
    if (keys.q) add([0, 1, 0], -speed);
    cam.targetPivot = [cam.targetPivot[0] + move[0], cam.targetPivot[1] + move[1], cam.targetPivot[2] + move[2]];
    cam.pivot = [cam.pivot[0] + move[0], cam.pivot[1] + move[1], cam.pivot[2] + move[2]];
    return true;
  }

  /** Advance damping / auto-orbit / lock. `dt` seconds. */
  function update(dt) {
    if (!(dt > 0)) dt = 0;
    if (cam.autoOrbitSpeed) cam.targetYaw += cam.autoOrbitSpeed * DEG * dt;
    if (cam.lockPoint && !cam.flyMode) {
      cam.targetPivot = [cam.lockPoint[0], cam.lockPoint[1], cam.lockPoint[2]];
    }
    cam.yaw = damp(cam.yaw, cam.targetYaw, cam.damping, dt);
    cam.pitch = damp(cam.pitch, cam.targetPitch, cam.damping, dt);
    cam.dist = damp(cam.dist, cam.targetDist, cam.damping, dt);
    cam.pivot = [
      damp(cam.pivot[0], cam.targetPivot[0], cam.damping, dt),
      damp(cam.pivot[1], cam.targetPivot[1], cam.damping, dt),
      damp(cam.pivot[2], cam.targetPivot[2], cam.damping, dt),
    ];
    // A full-turn target is folded back to -pi..pi so the numbers in the URL stay readable and
    // the shortest-way preset logic keeps working after many orbits.
    if (Math.abs(cam.targetYaw) > Math.PI * 4) {
      const wrap = Math.round(cam.targetYaw / (Math.PI * 2)) * Math.PI * 2;
      cam.targetYaw -= wrap; cam.yaw -= wrap;
    }
    return cam;
  }

  function view() {
    return { eye: eye(), look: look(), up: basis().up, fovDeg: cam.fovDeg, ortho: cam.ortho };
  }

  // ── matrices (column-major, same layout as battle3d's mat4 helpers) ─────────────────────────
  function mat4LookAt(eyeP, targetP, upP) {
    let zx = eyeP[0] - targetP[0], zy = eyeP[1] - targetP[1], zz = eyeP[2] - targetP[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = upP[1] * zz - upP[2] * zy, xy = upP[2] * zx - upP[0] * zz, xz = upP[0] * zy - upP[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eyeP[0] + xy * eyeP[1] + xz * eyeP[2]),
      -(yx * eyeP[0] + yy * eyeP[1] + yz * eyeP[2]),
      -(zx * eyeP[0] + zy * eyeP[1] + zz * eyeP[2]), 1,
    ]);
  }
  function mat4Perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    return new Float32Array([
      f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0,
    ]);
  }
  function mat4Ortho(halfH, aspect, near, far) {
    const halfW = halfH * aspect;
    return new Float32Array([
      1 / halfW, 0, 0, 0, 0, 1 / halfH, 0, 0, 0, 0, -2 / (far - near), 0,
      0, 0, -(far + near) / (far - near), 1,
    ]);
  }
  function projection(aspect, nearFar = null) {
    const near = nearFar ? nearFar[0] : Math.max(0.5, cam.dist * 0.02);
    const far = nearFar ? nearFar[1] : Math.max(8000, cam.dist * 8 + 60000);
    if (cam.ortho) {
      // the ortho box is the perspective frame at the pivot: same apparent size
      return mat4Ortho(cam.dist * Math.tan(cam.fovDeg * DEG / 2), Math.max(0.1, aspect), near, far);
    }
    return mat4Perspective(cam.fovDeg * DEG, Math.max(0.1, aspect), near, far);
  }
  function viewMatrix() { return mat4LookAt(eye(), look(), basis().up); }
  function viewProjection(aspect) { return mat4Mul(projection(aspect), viewMatrix()); }

  function mat4Mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function transform(m, p) {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
            (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
            (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
  }

  /** Project a world point to NDC [-1,1]. Returns null when behind the camera or non-finite. */
  function project(point, aspect) {
    const ndc = transform(viewProjection(aspect), point);
    if (!ndc.every(Number.isFinite) || ndc[2] < -1 || ndc[2] > 1) return null;
    return ndc;
  }

  /** The camera ray through an NDC point (unit). */
  function rayAt(ndc, aspect) {
    const { forward, right, up } = basis();
    const th = Math.tan(cam.fovDeg * DEG / 2);
    const d = [
      forward[0] + right[0] * ndc[0] * th * aspect + up[0] * ndc[1] * th,
      forward[1] + right[1] * ndc[0] * th * aspect + up[1] * ndc[1] * th,
      forward[2] + right[2] * ndc[0] * th * aspect + up[2] * ndc[1] * th,
    ];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  }

  /** Re-pivot on the nearest point under the cursor: the model box, else the ground plane y=groundY. */
  function pivotAt(ndc, aspect, bounds = null, groundY = null) {
    const o = eye(), d = rayAt(ndc, aspect);
    const box = boxOf(bounds || cam.lastBounds);
    if (box) {
      // slab test against the box; the ENTRY point is the visible surface
      let tmin = 0, tmax = Infinity, hit = true;
      for (let i = 0; i < 3; i++) {
        const lo = box.center[i] - box.half[i], hi = box.center[i] + box.half[i];
        if (Math.abs(d[i]) < EPS) { if (o[i] < lo || o[i] > hi) { hit = false; break; } continue; }
        let t1 = (lo - o[i]) / d[i], t2 = (hi - o[i]) / d[i];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) { hit = false; break; }
      }
      if (hit && tmax > 0) {
        const t = tmin > 0 ? tmin : tmax;
        cam.targetPivot = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
        return cam.targetPivot.slice();
      }
    }
    const gy = groundY != null ? groundY : (box ? box.center[1] - box.half[1] : 0);
    if (Math.abs(d[1]) > 1e-4) {
      const t = (gy - o[1]) / d[1];
      if (t > 0) {
        cam.targetPivot = [o[0] + d[0] * t, gy, o[2] + d[2] * t];
        return cam.targetPivot.slice();
      }
    }
    return null;
  }

  /** URL state: everything needed to reproduce this exact view. */
  function state() {
    const r = (v, n = 4) => +v.toFixed(n);
    return {
      yaw: r(cam.yaw / DEG, 2), pitch: r(cam.pitch / DEG, 2), dist: r(cam.dist, 1),
      px: r(cam.pivot[0], 1), py: r(cam.pivot[1], 1), pz: r(cam.pivot[2], 1),
      fov: r(cam.fovDeg, 1), ortho: cam.ortho ? 1 : 0, lock: cam.lockPoint ? 1 : 0,
    };
  }
  function setState(s) {
    if (!s) return false;
    const num = (v) => (v == null || v === "" ? null : +v);
    if (num(s.yaw) != null) cam.yaw = cam.targetYaw = num(s.yaw) * DEG;
    if (num(s.pitch) != null) cam.pitch = cam.targetPitch = clampPitch(num(s.pitch) * DEG);
    if (num(s.dist) != null) cam.dist = cam.targetDist = clamp(num(s.dist), cam.minDist, cam.maxDist);
    if (num(s.px) != null && num(s.py) != null && num(s.pz) != null) {
      cam.pivot = [num(s.px), num(s.py), num(s.pz)];
      cam.targetPivot = cam.pivot.slice();
    }
    if (num(s.fov) != null) cam.fovDeg = clamp(num(s.fov), 10, 120);
    cam.ortho = !!+s.ortho;
    cam.lockPoint = +s.lock ? (cam.lockPoint || cam.pivot.slice()) : null;
    return true;
  }

  Object.assign(cam, {
    basis, eye, target: look, orbitBy, orbitPixels, panPixels, zoomBy, frameBounds, frameUnion,
    setPreset, reset, fly, update, view, viewMatrix, projection, viewProjection, project, rayAt,
    pivotAt, state, setState, fitDistance, boxOf,
  });
  cam.target = look;
  cam.azimuthDeg = () => ((cam.yaw / DEG) % 360 + 360) % 360;
  cam.pitchDeg = () => cam.pitch / DEG;
  cam.isFinite = () => [cam.yaw, cam.pitch, cam.dist, ...cam.pivot, cam.fovDeg].every(Number.isFinite);
  return cam;
}
