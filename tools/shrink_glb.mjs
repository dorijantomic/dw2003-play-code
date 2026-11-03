// SHRINK GLB: reduces triangles of a project_paint GLB (one primitive: POSITION, TEXCOORD_0, COLOR_0, uint32 indices, one PNG) with meshoptimizer
// (attribute-aware simplifier: UV and COLOR_0 take part in the error, so UV seams and vertex colours stay; PNG bytes are copied unchanged, nothing is repainted).
// usage: node tools/shrink_glb.mjs <in.glb> --tris N --out <out.glb> [--uvw 8] [--colw 1] [--lock-border] [--no-measure]
// meshoptimizer is looked up in repo node_modules, else MESHOPT_DIR, else I:/arena-objects/shrink_modules/node_modules (npm install meshoptimizer there).
// prints one JSON line: tris, bytes, max/mean surface distance (% of object bbox diagonal, both directions, 30000 samples each), silhouette change (front/side/top 256px, % of union pixels),
// inside-out check (volume sign, % of reduced face normals agreeing with the nearest original face, % of original ones agreeing with the reduced).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const a = process.argv.slice(2), opt = {}, pos = [];
for (let i = 0; i < a.length; i++) { if (a[i].startsWith("--")) { const k = a[i].slice(2); if (["lock-border", "no-measure"].includes(k)) opt[k] = true; else opt[k] = a[++i]; } else pos.push(a[i]); }
if (!pos[0] || !opt.tris || !opt.out) { console.error("usage: node tools/shrink_glb.mjs <in.glb> --tris N --out <out.glb> [--uvw 8] [--colw 1] [--lock-border] [--no-measure]"); process.exit(1); }
const here = path.dirname(fileURLToPath(import.meta.url));
let MS; for (const d of [path.join(here, "../node_modules"), process.env.MESHOPT_DIR, "/mnt/i/arena-objects/shrink_modules/node_modules", "I:/arena-objects/shrink_modules/node_modules"].filter(Boolean)) { try { MS = createRequire(path.join(d, "x.js"))("meshoptimizer"); break; } catch {} }
if (!MS) throw new Error("meshoptimizer not found");
const { MeshoptSimplifier } = MS; await MeshoptSimplifier.ready;

// ---- read
function readGlb(file) { const b = fs.readFileSync(file), jl = b.readUInt32LE(12), json = JSON.parse(b.toString("utf8", 20, 20 + jl)), bo = 20 + jl + 8;
  const get = (acc, C, n) => { const A = json.accessors[acc], v = json.bufferViews[A.bufferView], s = b.byteOffset + bo + (v.byteOffset || 0); return new C(b.buffer.slice(s, s + A.count * n * 4)); };
  if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1) throw new Error("expects one mesh, one primitive");
  const pr = json.meshes[0].primitives[0], iv = json.bufferViews[json.images[0].bufferView];
  return { json, b, P: get(pr.attributes.POSITION, Float32Array, 3), UV: get(pr.attributes.TEXCOORD_0, Float32Array, 2), C: get(pr.attributes.COLOR_0, Float32Array, 3), I: get(pr.indices, Uint32Array, 1), png: b.subarray(bo + (iv.byteOffset || 0), bo + (iv.byteOffset || 0) + iv.byteLength) }; }
const src = readGlb(pos[0]); const nv = src.P.length / 3, nt = src.I.length / 3, target = +opt.tris;
const scale = MeshoptSimplifier.getScale(src.P, 3);

// ---- simplify (attributes: uv*uvw, colour*colw)
const uvw = +(opt.uvw ?? 8), colw = +(opt.colw ?? 1), AS = 5, attr = new Float32Array(nv * AS);
for (let v = 0; v < nv; v++) { attr[v * AS] = src.UV[v * 2]; attr[v * AS + 1] = src.UV[v * 2 + 1]; attr[v * AS + 2] = src.C[v * 3]; attr[v * AS + 3] = src.C[v * 3 + 1]; attr[v * AS + 4] = src.C[v * 3 + 2]; }
const flags = ["ErrorAbsolute"]; if (opt["lock-border"]) flags.push("LockBorder");
const [idx2, err] = MeshoptSimplifier.simplifyWithAttributes(src.I, src.P, 3, attr, AS, [uvw, uvw, colw, colw, colw], null, target * 3, 1e9, flags);
// compact
const map = new Int32Array(nv).fill(-1); let n2 = 0; const outI = new Uint32Array(idx2.length);
for (let i = 0; i < idx2.length; i++) { const v = idx2[i]; if (map[v] < 0) map[v] = n2++; outI[i] = map[v]; }
const P2 = new Float32Array(n2 * 3), UV2 = new Float32Array(n2 * 2), C2 = new Float32Array(n2 * 3);
for (let v = 0; v < nv; v++) { const m = map[v]; if (m < 0) continue; P2.set(src.P.subarray(v * 3, v * 3 + 3), m * 3); UV2.set(src.UV.subarray(v * 2, v * 2 + 2), m * 2); C2.set(src.C.subarray(v * 3, v * 3 + 3), m * 3); }
const nt2 = outI.length / 3;

// ---- write (same layout as project_paint)
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < n2; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P2[i * 3 + k]); mx[k] = Math.max(mx[k], P2[i * 3 + k]); }
const pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4)]);
const bufs = [Buffer.from(outI.buffer), Buffer.from(P2.buffer), Buffer.from(UV2.buffer), Buffer.from(C2.buffer), src.png].map((b) => pad4(Buffer.from(b)));
const views = [], acc = []; let off = 0; bufs.forEach((b, i) => { views.push({ buffer: 0, byteOffset: off, byteLength: i === 4 ? src.png.length : b.length, ...(i < 4 ? { target: i === 0 ? 34963 : 34962 } : {}) }); off += b.length; });
acc.push({ bufferView: 0, componentType: 5125, count: nt2 * 3, type: "SCALAR" }, { bufferView: 1, componentType: 5126, count: n2, type: "VEC3", min: mn, max: mx }, { bufferView: 2, componentType: 5126, count: n2, type: "VEC2" }, { bufferView: 3, componentType: 5126, count: n2, type: "VEC3" });
const j = JSON.parse(JSON.stringify(src.json)); j.asset.generator = "tools/shrink_glb.mjs (meshoptimizer)"; j.accessors = acc; j.bufferViews = views; j.buffers = [{ byteLength: off }];
j.meshes[0].primitives[0].attributes = { POSITION: 1, TEXCOORD_0: 2, COLOR_0: 3 }; j.meshes[0].primitives[0].indices = 0; j.images[0].bufferView = 4;
let js = Buffer.from(JSON.stringify(j)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
const bin = Buffer.concat(bufs), hdr = Buffer.alloc(12); hdr.write("glTF", 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const ch = (n, t) => { const b = Buffer.alloc(8); b.writeUInt32LE(n, 0); b.writeUInt32LE(t, 4); return b; };
const glb = Buffer.concat([hdr, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]); fs.writeFileSync(opt.out, glb);
const res = { in: path.basename(pos[0]), out: opt.out, trisBefore: nt, tris: nt2, vertsBefore: nv, verts: n2, bytesBefore: fs.statSync(pos[0]).size, bytes: glb.length, simplifyError: +(err / scale).toFixed(5), uvw, colw, lockBorder: !!opt["lock-border"] };
if (opt["no-measure"]) { console.log(JSON.stringify(res)); process.exit(0); }

// ---- measure
const diag = Math.hypot(...[0, 1, 2].map((k) => { let lo = 1e9, hi = -1e9; for (let i = 0; i < nv; i++) { lo = Math.min(lo, src.P[i * 3 + k]); hi = Math.max(hi, src.P[i * 3 + k]); } return hi - lo; }));
res.diag = +diag.toFixed(4);
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]], dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2], cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
function ptTri(p, A, B, C) { // closest point on triangle (Ericson)
  const ab = sub(B, A), ac = sub(C, A), ap = sub(p, A), d1 = dot(ab, ap), d2 = dot(ac, ap); if (d1 <= 0 && d2 <= 0) return A;
  const bp = sub(p, B), d3 = dot(ab, bp), d4 = dot(ac, bp); if (d3 >= 0 && d4 <= d3) return B;
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [A[0] + v * ab[0], A[1] + v * ab[1], A[2] + v * ab[2]]; }
  const cp = sub(p, C), d5 = dot(ab, cp), d6 = dot(ac, cp); if (d6 >= 0 && d5 <= d6) return C;
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [A[0] + w * ac[0], A[1] + w * ac[1], A[2] + w * ac[2]]; }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [B[0] + w * (C[0] - B[0]), B[1] + w * (C[1] - B[1]), B[2] + w * (C[2] - B[2])]; }
  const dn = 1 / (va + vb + vc), v = vb * dn, w = vc * dn; return [A[0] + ab[0] * v + ac[0] * w, A[1] + ab[1] * v + ac[1] * w, A[2] + ab[2] * v + ac[2] * w]; }
function mesh(P, I) { const T = I.length / 3, tv = (f, k) => [P[I[f * 3 + k] * 3], P[I[f * 3 + k] * 3 + 1], P[I[f * 3 + k] * 3 + 2]]; const tri = [], nrm = [], area = []; let vol = 0;
  for (let f = 0; f < T; f++) { const A = tv(f, 0), B = tv(f, 1), C = tv(f, 2), n = cross(sub(B, A), sub(C, A)), ar = Math.hypot(...n) / 2; tri.push([A, B, C]); nrm.push(ar > 0 ? n.map((x) => x / (2 * ar)) : [0, 0, 0]); area.push(ar); vol += dot(A, cross(B, C)) / 6; }
  let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const t of tri) for (const p of t) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const G = 32, cs = [0, 1, 2].map((k) => Math.max((hi[k] - lo[k]) / G, 1e-9)), cell = new Map(), key = (x, y, z) => (x * 64 + y) * 64 + z, ci = (v, k) => Math.min(G - 1, Math.max(0, Math.floor((v - lo[k]) / cs[k])));
  tri.forEach((t, f) => { const a0 = [0, 1, 2].map((k) => ci(Math.min(t[0][k], t[1][k], t[2][k]), k)), a1 = [0, 1, 2].map((k) => ci(Math.max(t[0][k], t[1][k], t[2][k]), k)); for (let x = a0[0]; x <= a1[0]; x++) for (let y = a0[1]; y <= a1[1]; y++) for (let z = a0[2]; z <= a1[2]; z++) { const kk = key(x, y, z); (cell.get(kk) || cell.set(kk, []).get(kk)).push(f); } });
  const nearest = (p) => { let best = 1e18, bf = -1; const c = [0, 1, 2].map((k) => ci(p[k], k)); for (let r = 0; r <= G; r++) { for (let x = Math.max(0, c[0] - r); x <= Math.min(G - 1, c[0] + r); x++) for (let y = Math.max(0, c[1] - r); y <= Math.min(G - 1, c[1] + r); y++) for (let z = Math.max(0, c[2] - r); z <= Math.min(G - 1, c[2] + r); z++) { if (Math.max(Math.abs(x - c[0]), Math.abs(y - c[1]), Math.abs(z - c[2])) !== r) continue; const l = cell.get(key(x, y, z)); if (!l) continue; for (const f of l) { const q = ptTri(p, ...tri[f]), d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d < best) { best = d; bf = f; } } }
      if (bf >= 0 && best <= r * Math.min(...cs)) break; } return [best, bf]; };
  return { T, tri, nrm, area, vol, nearest }; }
const M1 = mesh(src.P, src.I), M2 = mesh(P2, outI);
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function sample(M, N) { const cum = []; let s = 0; for (const x of M.area) cum.push(s += x); const pts = []; for (let i = 0; i < N; i++) { const r = rnd() * s; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; } const [A, B, C] = M.tri[lo]; let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; } pts.push({ f: lo, p: [A[0] + u * (B[0] - A[0]) + v * (C[0] - A[0]), A[1] + u * (B[1] - A[1]) + v * (C[1] - A[1]), A[2] + u * (B[2] - A[2]) + v * (C[2] - A[2])] }); } return pts; }
function dist(from, to, N) { let mx = 0, sm = 0, agree = 0; for (const { f, p } of sample(from, N)) { const [d, g] = to.nearest(p); mx = Math.max(mx, d); sm += d; if (dot(from.nrm[f], to.nrm[g]) > 0) agree++; } return { max: mx, mean: sm / N, agree: agree / N }; }
const N = 30000, d12 = dist(M2, M1, N), d21 = dist(M1, M2, N), pc = (x) => +(100 * x / diag).toFixed(3);
res.distMaxPct = pc(Math.max(d12.max, d21.max)); res.distMeanPct = pc((d12.mean + d21.mean) / 2); res.distNewToOldMaxPct = pc(d12.max); res.distOldToNewMaxPct = pc(d21.max);
res.insideOut = { volumeBefore: +M1.vol.toFixed(5), volumeAfter: +M2.vol.toFixed(5), sameVolumeSign: Math.sign(M1.vol) === Math.sign(M2.vol), newNormalsAgreePct: +(100 * d12.agree).toFixed(2), oldNormalsAgreePct: +(100 * d21.agree).toFixed(2) };
// silhouettes: orthographic masks on 3 axes (frame fixed by the original)
function mask(M, ax) { const R = 256, [u, v] = [[0, 1], [2, 1], [0, 2]][ax]; let lo = [1e9, 1e9], hi = [-1e9, -1e9]; for (const t of M1.tri) for (const p of t) { lo[0] = Math.min(lo[0], p[u]); hi[0] = Math.max(hi[0], p[u]); lo[1] = Math.min(lo[1], p[v]); hi[1] = Math.max(hi[1], p[v]); }
  const s = (R - 2) / Math.max(hi[0] - lo[0], hi[1] - lo[1]), m = new Uint8Array(R * R);
  for (const t of M.tri) { const q = t.map((p) => [(p[u] - lo[0]) * s + 1, (p[v] - lo[1]) * s + 1]); const x0 = Math.max(0, Math.floor(Math.min(q[0][0], q[1][0], q[2][0]))), x1 = Math.min(R - 1, Math.ceil(Math.max(q[0][0], q[1][0], q[2][0]))), y0 = Math.max(0, Math.floor(Math.min(q[0][1], q[1][1], q[2][1]))), y1 = Math.min(R - 1, Math.ceil(Math.max(q[0][1], q[1][1], q[2][1])));
    const den = (q[1][1] - q[2][1]) * (q[0][0] - q[2][0]) + (q[2][0] - q[1][0]) * (q[0][1] - q[2][1]); if (Math.abs(den) < 1e-12) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const px = x + 0.5, py = y + 0.5, l0 = ((q[1][1] - q[2][1]) * (px - q[2][0]) + (q[2][0] - q[1][0]) * (py - q[2][1])) / den, l1 = ((q[2][1] - q[0][1]) * (px - q[2][0]) + (q[0][0] - q[2][0]) * (py - q[2][1])) / den, l2 = 1 - l0 - l1; if (l0 >= 0 && l1 >= 0 && l2 >= 0) m[y * R + x] = 1; } }
  return m; }
res.silhouetteDiffPct = {}; ["front", "side", "top"].forEach((nm, ax) => { const m1 = mask(M1, ax), m2 = mask(M2, ax); let un = 0, df = 0, a1 = 0, a2 = 0; for (let i = 0; i < m1.length; i++) { if (m1[i] || m2[i]) un++; if (m1[i] !== m2[i]) df++; a1 += m1[i]; a2 += m2[i]; } res.silhouetteDiffPct[nm] = { diffOfUnion: +(100 * df / un).toFixed(3), areaBefore: a1, areaAfter: a2 }; });
console.log(JSON.stringify(res));
