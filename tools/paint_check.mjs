// PAINT CHECK: samples the WRITTEN project_paint GLB texture at face UVs, grouped by face normal axis (OBJ axes of the glb; front camera = +Z, back camera = -Z).
// usage: node tools/paint_check.mjs file.glb   -> prints one JSON line: {front:{...},back:{...},side:{...}}
// per group: faces, area share, background share (probe is neutral grey 127.5 +-4 = TripoSR cutout grey, or white >= 250 = padding/white column), mean HSV saturation of the non-background probes.
// colour of a probe = texture (sRGB) x COLOR_0 (linear) like the viewer; 4 probes per face (centroid + 3 inner), area weighted.
import fs from "node:fs";
import zlib from "node:zlib";
const b = fs.readFileSync(process.argv[2]);
const jl = b.readUInt32LE(12), json = JSON.parse(b.toString("utf8", 20, 20 + jl)), bo = 20 + jl + 8;
const view = (i) => json.bufferViews[i], accData = (a, Ctor) => { const A = json.accessors[a], v = view(A.bufferView); const n = A.count * ({ SCALAR: 1, VEC2: 2, VEC3: 3 }[A.type]); return new Ctor(b.buffer.slice(b.byteOffset + bo + (v.byteOffset || 0), b.byteOffset + bo + (v.byteOffset || 0) + n * 4)); };
const pr = json.meshes[0].primitives[0], P = accData(pr.attributes.POSITION, Float32Array), UV = accData(pr.attributes.TEXCOORD_0, Float32Array), C = accData(pr.attributes.COLOR_0, Float32Array), I = accData(pr.indices, Uint32Array);
const iv = view(json.images[0].bufferView), pb = b.subarray(bo + (iv.byteOffset || 0), bo + (iv.byteOffset || 0) + iv.byteLength);
let p = 8, W = 0, H = 0, ct = 0; const idat = [];
while (p < pb.length) { const n = pb.readUInt32BE(p), t = pb.toString("latin1", p + 4, p + 8), d = pb.subarray(p + 8, p + 8 + n); if (t === "IHDR") { W = d.readUInt32BE(0); H = d.readUInt32BE(4); ct = d[9]; } else if (t === "IDAT") idat.push(d); p += 12 + n; }
if (ct !== 2) throw new Error("png colour type " + ct);
const raw = zlib.inflateSync(Buffer.concat(idat)), st = W * 3, tex = Buffer.alloc(H * st);
for (let y = 0; y < H; y++) { const f = raw[y * (st + 1)], s = y * (st + 1) + 1, o = y * st; for (let x = 0; x < st; x++) { const a = x >= 3 ? tex[o + x - 3] : 0, up = y ? tex[o - st + x] : 0, c = x >= 3 && y ? tex[o - st + x - 3] : 0, v = raw[s + x]; let r; if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + up; else if (f === 3) r = v + ((a + up) >> 1); else { const pp = a + up - c, pa = Math.abs(pp - a), pbb = Math.abs(pp - up), pc = Math.abs(pp - c); r = v + (pa <= pbb && pa <= pc ? a : pbb <= pc ? up : c); } tex[o + x] = r & 255; } }
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)), srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const G = { front: { n: 0, area: 0, bg: 0, sat: 0, satW: 0, m: [0, 0, 0] }, back: { n: 0, area: 0, bg: 0, sat: 0, satW: 0, m: [0, 0, 0] }, side: { n: 0, area: 0, bg: 0, sat: 0, satW: 0, m: [0, 0, 0] } };
const probes = [[1 / 3, 1 / 3, 1 / 3], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7]];
let tot = 0; const nt = I.length / 3;
for (let f = 0; f < nt; f++) { const a = I[f * 3], bb = I[f * 3 + 1], c = I[f * 3 + 2];
  const ux = P[bb * 3] - P[a * 3], uy = P[bb * 3 + 1] - P[a * 3 + 1], uz = P[bb * 3 + 2] - P[a * 3 + 2], vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, ar = Math.hypot(nx, ny, nz) / 2; tot += ar;
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz), g = G[az >= ax && az >= ay ? (nz > 0 ? "front" : "back") : "side"]; g.n++; g.area += ar;
  for (const [l0, l1, l2] of probes) { const u = l0 * UV[a * 2] + l1 * UV[bb * 2] + l2 * UV[c * 2], v = l0 * UV[a * 2 + 1] + l1 * UV[bb * 2 + 1] + l2 * UV[c * 2 + 1];
    const xi = Math.min(W - 1, Math.max(0, Math.floor(u * W))), yi = Math.min(H - 1, Math.max(0, Math.floor(v * H))), k = (yi * W + xi) * 3, w = ar / 4;
    const tr = tex[k], tg = tex[k + 1], tb = tex[k + 2], grey = Math.abs(tr - 127.5) <= 4 && Math.abs(tg - 127.5) <= 4 && Math.abs(tb - 127.5) <= 4, white = tr >= 250 && tg >= 250 && tb >= 250;
    // white column (vertex-colour faces) is not a background: its colour comes from COLOR_0. Detect by u in the last 4 columns.
    const col = u * W >= W - 4;
    const cl = [l0 * C[a * 3] + l1 * C[bb * 3] + l2 * C[c * 3], l0 * C[a * 3 + 1] + l1 * C[bb * 3 + 1] + l2 * C[c * 3 + 1], l0 * C[a * 3 + 2] + l1 * C[bb * 3 + 2] + l2 * C[c * 3 + 2]];
    if (!col && (grey || white)) { g.bg += w; continue; }
    const rgb = [tr, tg, tb].map((x, q) => srgb(lin(x / 255) * cl[q])), mx = Math.max(...rgb), mn = Math.min(...rgb);
    g.sat += w * (mx > 0 ? (mx - mn) / mx : 0); g.satW += w; for (let q = 0; q < 3; q++) g.m[q] += w * rgb[q] * 255; } }
const out = {}; for (const [k, g] of Object.entries(G)) out[k] = { faces: g.n, facesPct: +(100 * g.n / nt).toFixed(1), areaPct: +(100 * g.area / tot).toFixed(1), bgPct: g.area ? +(100 * g.bg / g.area).toFixed(1) : null, sat: g.satW ? +(g.sat / g.satW).toFixed(3) : null, mean: g.satW ? g.m.map((x) => Math.round(x / g.satW)) : null };
console.log(JSON.stringify(out));
