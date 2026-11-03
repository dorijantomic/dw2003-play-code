// MOUNTAIN terrain law (pure JS, no imports, so node can test it). 1 unit = 1 metre, +z = towards the viewer (south), massif to -z.
// mtH(x,z): alpine meadow valley around the origin (gentle fall to +z), a stream from the tarn, then a ridged-multifractal massif with
// domain warp, erosion-like weighting (valleys stay smooth), radial gullies and partial terracing (strata ledges).
// The GLSL of the stream shore law is generated from the same constants (streamGlsl()).
export const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function vnoise(x, z, f, s = 0) {
  const X = x * f + s * 17.3, Z = z * f + s * 9.1, xi = Math.floor(X), zi = Math.floor(Z), fx = X - xi, fz = Z - zi;
  const h = (i, j) => { const n = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  return (h(xi, zi) * (1 - sx) + h(xi + 1, zi) * sx) * (1 - sz) + (h(xi, zi + 1) * (1 - sx) + h(xi + 1, zi + 1) * sx) * sz;
}
export const SNOWLINE = 92, TREELINE = 40;
// ---- tarn (alpine lake) and waterfall site
export const TARN = { x: -24, z: -58, R: 13.5, y: 0.9 };
export const tarnR = (t) => TARN.R * (1 + 0.16 * Math.sin(3 * t + 1.0) + 0.08 * Math.sin(5 * t + 0.4));
export const tarnD = (x, z) => tarnR(Math.atan2(z - TARN.z, x - TARN.x)) - Math.hypot(x - TARN.x, z - TARN.z);   // > 0 inside the tarn
export const tarnDepth = (d) => Math.min(0.17 * d + 0.03 * d * d, 3.2);
export const FALL = { x: TARN.x - 2, z: TARN.z - tarnR(-Math.PI / 2 - 0.15) - 0.3, h: 8.5, w: 4.2 };       // lip z (north shore of the tarn)
// ---- stream
export const STREAM = { z0: -49, z1: 62, W: 1.7 };
export const streamX = (z) => -9.5 + 14 * sstep(-54, -5, z) + 3.5 * Math.sin(z * 0.07 + 1) * sstep(-54, -30, z) + 2 * Math.sin(z * 0.19) * sstep(-40, -10, z) + 6 * Math.sin(z * 0.035) * sstep(20, 60, z);
export const streamY = (z) => -0.026 * z - 0.5;                             // water surface level along the stream
export const streamW = (z) => STREAM.W * (0.85 + 0.3 * vnoise(0, z, 0.08, 3));
export const streamD = (x, z) => streamW(z) - Math.abs(x - streamX(z));      // > 0 inside the water
export function streamGlsl() {
  return `float sX(float z){ return -9.5 + 14.0 * smoothstep(-54.0, -5.0, z) + 3.5 * sin(z * 0.07 + 1.0) * smoothstep(-54.0, -30.0, z) + 2.0 * sin(z * 0.19) * smoothstep(-40.0, -10.0, z) + 6.0 * sin(z * 0.035) * smoothstep(20.0, 60.0, z); }
float sW(float z){ return ${STREAM.W.toFixed(3)} * 1.0; }
float sD(vec2 P){ return sW(P.y) - abs(P.x - sX(P.y)); }
float tR(float t){ return ${TARN.R.toFixed(3)} * (1.0 + 0.16 * sin(3.0 * t + 1.0) + 0.08 * sin(5.0 * t + 0.4)); }
float tD(vec2 P){ vec2 q = P - vec2(${TARN.x.toFixed(2)}, ${TARN.z.toFixed(2)}); return tR(atan(q.y, q.x)) - length(q); }
float tDepth(float d){ return min(0.17 * d + 0.03 * d * d, 3.2); }`;
}
// ---- the heightfield
function meadow(x, z) { return -0.026 * z + 0.9 * (vnoise(x, z, 0.03, 1) - 0.5) + 0.22 * (vnoise(x, z, 0.13, 2) - 0.5); }
export function mtH(x, z) {
  let h = meadow(x, z);
  const rho = Math.hypot(x * 0.8, z > 0 ? z * 0.7 : z * 0.64);
  const env = sstep(24, 175, rho);
  if (env > 0) {
    const wx = x + 34 * (vnoise(x, z, 0.007, 11) - 0.5), wz = z + 34 * (vnoise(x, z, 0.007, 12) - 0.5);
    let amp = 1, f = 0.0030, sum = 0, w = 1, norm = 0;
    for (let o = 0; o < 5; o++) {
      let n = 1 - Math.abs(2 * vnoise(wx, wz, f, 20 + o) - 1); n = n * n * w;
      w = Math.min(1, Math.max(0, n * 2.2));                                  // erosion-like: the next octave only where this one is high
      sum += n * amp; norm += amp; amp *= 0.46; f *= 2.1;
    }
    const hd = Math.hypot(x - 8, z + 215), hero = 80 * Math.pow(Math.max(0, 1 - hd / 150), 1.7);   // the main peak
    let m = (0.10 + sum / norm * 1.25) * 175 * env + hero * (0.55 + 0.9 * sum / norm);
    const ang = Math.atan2(z, x), g1 = 1 - Math.abs(2 * vnoise(ang * 5.0, rho * 0.018, 1, 33) - 1), g2 = 1 - Math.abs(2 * vnoise(ang * 11.0, rho * 0.03, 1, 34) - 1);
    m -= Math.min(m * 0.45, 14) * env * (sstep(0.84, 0.98, g1) + 0.6 * sstep(0.86, 0.99, g2));                                // gullies running downhill
    const st = m / 13, fl = Math.floor(st);                                    // partial terracing = rock ledges
    const k = sstep(25, 90, m); m = m * (1 - 0.38 * k) + (fl + sstep(0.3, 0.7, st - fl)) * 13 * 0.38 * k;
    h += m;
  }
  // tarn bowl and bank
  const d = tarnD(x, z);
  if (d > -9) {
    if (d > 0) h = Math.min(h, TARN.y - tarnDepth(d)); else h = Math.max(h, TARN.y + 0.07 * (-d) + 0.03);
  }
  // waterfall scarp: a rock step north of the tarn
  { const up = 1 - sstep(FALL.z - 1.6, FALL.z, z), lat = 1 - sstep(FALL.w * 1.3, FALL.w * 3.4, Math.abs(x - FALL.x)); h += FALL.h * up * lat; }
  // stream channel
  const zt = sstep(STREAM.z0 - 3, STREAM.z0 + 3, z) * (1 - sstep(STREAM.z1 - 10, STREAM.z1 + 4, z));
  if (zt > 0) {
    const sd = Math.abs(x - streamX(z)), W = streamW(z), c = zt * (1 - sstep(W, W * 3.4, sd)), SY = streamY(z);
    const hc = sd < W ? SY - 0.46 * (1 - (sd / W) * (sd / W)) : SY + 0.34 * sstep(W, W * 2.6, sd);
    h = h + (hc - h) * c;
  }
  return h;
}
/** slope / altitude lookup grid so scatter does not pay 3 mtH calls per candidate */
const CELL = 3, HALF = 330, N = Math.round(HALF * 2 / CELL) + 1;
let _grid = null;
function grid() {
  if (_grid) return _grid;
  _grid = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) _grid[j * N + i] = mtH(-HALF + i * CELL, -HALF + j * CELL);
  return _grid;
}
export function mtInfo(x, z) {
  const G = grid(), fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
  if (fx < 1 || fz < 1 || fx > N - 2 || fz > N - 2) { const h = mtH(x, z); return { h, ny: 1 }; }
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const a = G[j * N + i], b = G[j * N + i + 1], c = G[(j + 1) * N + i], d = G[(j + 1) * N + i + 1];
  const h = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v, gx = ((b - a) * (1 - v) + (d - c) * v) / CELL, gz = ((c - a) * (1 - u) + (d - b) * u) / CELL;
  return { h, ny: 1 / Math.hypot(gx, 1, gz) };
}
/** distance (metres) from (x,z) to the nearest water of the stream or the tarn: > 0 outside; used to keep plants and trees out of the water */
export function waterDist(x, z) {
  const s = Math.abs(x - streamX(z)) - streamW(z), zt = (z > STREAM.z0 - 4 && z < STREAM.z1) ? 1 : 0;
  const t = -tarnD(x, z);
  return Math.min(zt ? s : 99, t);
}
