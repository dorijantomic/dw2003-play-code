// PROJECT PAINT: stick the sharp picture TripoSR was given back onto the FRONT of its mesh ("sticker"), the rest keeps TripoSR's vertex colours.
// usage: node tools/project_paint.mjs <mesh.obj> <input.png> --name "meft1009 floor_02 (sticker)" [--id ID --category C --kind K --source S --licence L]
//        [--stock] (use TripoSR's stock camera, no fit)  [--dist 1.9 --fov 40]  [--no-catalogue]  [--no-back]  [--out file.glb]
// input.png = TripoSR's processed input (run.py saves it next to mesh.obj): rembg + resize_foreground, grey 0.5 background, square.
//
// CAMERA (read from I:\triposr\src, TripoSR): tsr/system.py:126-128 render() defaults elevation 0, distance 1.9, fovy 40 deg;
//   tsr/utils.py:341-399 get_spherical_cameras: camera at (d cos el cos az, d cos el sin az, d sin el), az 0 = on +x looking at the origin,
//   up +z, right = lookat x up = +y; pixel ray = (x-cx)/f, -(y-cy)/f, -1 with f = 0.5*H/tan(fovy/2) (get_ray_directions, utils.py:257-296).
//   The mesh in mesh.obj is v_pos[..., [2,1,0]] (models/isosurface.py:50) of the PyMCubes shim at I:\triposr\venv\...\torchmcubes\__init__.py
//   which already returns x,y,z order, so the OBJ axes are the true render axes with x and z exchanged: true = (obj.z, obj.y, obj.x).
//   (Measured: with this swap the mesh aspect matches the picture; without it it does not.) The -level flip is isosurface.py:44.
// Measured on meft1009 floor_02: the stock fov 40 gives silhouette IoU 0.51; the mesh is ~1.2x too small. The tool fits fov (and a pixel offset)
//   to the picture's silhouette (--fit is the default) and prints both IoU numbers. If the fitted IoU < 0.9 it says so.
// BACK (default, --no-back turns it off): the arena pieces are flat cards, the back is the front mirrored. The same camera is put on the opposite side
//   (rotated 180 deg about the up axis = obj.x: (x,y,z) -> (x,-y,-z), camera at (0,0,-dist) looking +z) and uses the SAME picture, so the back gets the mirrored picture.
//   Its pixel offset is (-dx, dy) because mirroring the picture about its centre mirrors the offset too. Faces facing the back camera, not occluded, inside the object mask
//   get UVs from it. A face visible from both cameras uses the one it faces more directly (larger cos between outward normal and direction to the camera).
//   Faces seen by neither keep vertex colours. Prints % front / back / vertex-colour faces and the back silhouette IoU vs the mirrored picture mask.
// SIDEFILL (default, --no-sidefill turns it off): faces painted by neither camera (edge-on to both) would keep TripoSR's pale grey vertex colours. Instead each takes the colour of the
//   NEAREST PAINTED FACE measured along the mesh: multi-source breadth-first search over face adjacency (shared edges first; faces in a component with no painted face are reached through
//   shared vertices from already coloured faces). Painted face colour = its picture colour at 4 probes. Then 3 smoothing passes over the filled faces only, then COLOR_0 per vertex = mean of the
//   filled faces around it. Prints "SIDEFILL ... left raw N" (target 0). No straight-line distance is used, so colour never jumps through the object.
// OUTPUT GLB: one primitive, baseColorTexture = the picture cropped to the object (+ 4 white columns), TEXCOORD_0, COLOR_0.
//   Picture faces: UV into the picture, COLOR_0 white. Other faces: UV on the white columns, COLOR_0 = TripoSR vertex colour (linear).
//   Vertices are duplicated only where a vertex is used by both kinds. Winding is made outward like tools/obj2glb.mjs.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2), pos = [], opt = {};
for (let i = 0; i < argv.length; i++) { if (argv[i].startsWith("--")) { const k = argv[i].slice(2); if (["stock", "no-catalogue", "no-back", "no-sidefill"].includes(k)) opt[k] = true; else opt[k] = argv[++i]; } else pos.push(argv[i]); }
const [objPath, pngPath] = pos;
if (!objPath || !pngPath || !opt.name) { console.error('usage: node project_paint.mjs mesh.obj input.png --name "NAME" [--id --category --kind --source --licence --stock --dist --fov --no-catalogue --out]'); process.exit(1); }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), DIR = path.join(REPO, "web/assets-lab/objects");
const id = opt.id || String(opt.name).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// ---------------------------------------------------------------- PNG (8-bit, non-interlaced, colour type 0/2/6)
function readPng(file) {
  const b = fs.readFileSync(file); if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a png");
  let p = 8, W = 0, H = 0, ct = 0, idat = [];
  while (p < b.length) { const n = b.readUInt32BE(p), t = b.toString("latin1", p + 4, p + 8), d = b.subarray(p + 8, p + 8 + n);
    if (t === "IHDR") { W = d.readUInt32BE(0); H = d.readUInt32BE(4); if (d[8] !== 8 || d[12] !== 0) throw new Error("need 8-bit non-interlaced png"); ct = d[9]; }
    else if (t === "IDAT") idat.push(d); p += 12 + n; }
  const ch = { 0: 1, 2: 3, 6: 4 }[ct]; if (!ch) throw new Error("png colour type " + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat)), st = W * ch, out = Buffer.alloc(H * st);
  for (let y = 0; y < H; y++) { const f = raw[y * (st + 1)], s = y * (st + 1) + 1, o = y * st;
    for (let x = 0; x < st; x++) { const a = x >= ch ? out[o + x - ch] : 0, up = y ? out[o - st + x] : 0, c = x >= ch && y ? out[o - st + x - ch] : 0, v = raw[s + x];
      let r; if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + up; else if (f === 3) r = v + ((a + up) >> 1);
      else { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); }
      out[o + x] = r & 255; } }
  const rgb = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = out[i * ch + (ch === 1 ? 0 : k)];
  return { W, H, rgb };
}
const crcT = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc = (buf) => { let c = -1; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function writePng(W, H, rgb) {
  const raw = Buffer.alloc(H * (W * 3 + 1)); for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; rgb.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const chunk = (t, d) => { const h = Buffer.alloc(8); h.writeUInt32BE(d.length, 0); h.write(t, 4, "latin1"); const body = Buffer.concat([h.subarray(4), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body), 0); return Buffer.concat([h.subarray(0, 4), body, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- OBJ
const pv = [], col = [], idx = []; let hasCol = true;
for (const line of fs.readFileSync(objPath, "utf8").split("\n")) {
  if (line.startsWith("v ")) { const t = line.trim().split(/\s+/); pv.push(+t[1], +t[2], +t[3]); if (t.length >= 7) col.push(+t[4], +t[5], +t[6]); else hasCol = false; }
  else if (line.startsWith("f ")) { const t = line.trim().split(/\s+/).slice(1).map((s) => { const k = parseInt(s.split("/")[0], 10); return k < 0 ? pv.length / 3 + k : k - 1; }); for (let i = 1; i + 1 < t.length; i++) idx.push(t[0], t[i], t[i + 1]); }
}
const nv = pv.length / 3, nt = idx.length / 3; if (!nv || !nt) throw new Error("no geometry");
if (col.length !== pv.length) hasCol = false;
// outward winding exactly like obj2glb (signed volume)
{ let s = 0; for (let i = 0; i < idx.length; i += 3) { const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    s += (pv[a] * (pv[b + 1] * pv[c + 2] - pv[b + 2] * pv[c + 1]) - pv[a + 1] * (pv[b] * pv[c + 2] - pv[b + 2] * pv[c]) + pv[a + 2] * (pv[b] * pv[c + 1] - pv[b + 1] * pv[c])) / 6; }
  if (s < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  console.log(`signed volume ${s.toFixed(4)} -> ${s < 0 ? "flipped" : "kept"}`); }

// ---------------------------------------------------------------- picture, background mask
const img = readPng(pngPath), W = img.W, H = img.H;
const isGrey = (i) => Math.abs(img.rgb[i * 3] - 127.5) <= 2 && Math.abs(img.rgb[i * 3 + 1] - 127.5) <= 2 && Math.abs(img.rgb[i * 3 + 2] - 127.5) <= 2;
const bg = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) bg[i] = isGrey(i) ? 1 : 0;   // object = every pixel that is not the grey cutout background (holes in the picture stay holes)
const obj = new Uint8Array(W * H); let objN = 0, ox0 = W, ox1 = 0, oy0 = H, oy1 = 0;
for (let i = 0; i < W * H; i++) if (!bg[i]) { obj[i] = 1; objN++; const x = i % W, y = (i / W) | 0; ox0 = Math.min(ox0, x); ox1 = Math.max(ox1, x); oy0 = Math.min(oy0, y); oy1 = Math.max(oy1, y); }
console.log(`picture ${W}x${H}, object pixels ${objN} (${(100 * objN / (W * H)).toFixed(1)}%), bbox x ${ox0}-${ox1} y ${oy0}-${oy1}`);

// ---------------------------------------------------------------- camera + raster
// OBJ -> true TripoSR render space: (x,y,z)_true = (obj.z, obj.y, obj.x). Camera at (dist,0,0) looking -x, right +y, up +z.
function project(dist, fov, dx, dy, S, back) {
  const f = 0.5 * S / Math.tan(fov * Math.PI / 360), sx = new Float64Array(nv), sy = new Float64Array(nv), iz = new Float64Array(nv);
  for (let i = 0; i < nv; i++) { const ox = pv[i * 3], oy = back ? -pv[i * 3 + 1] : pv[i * 3 + 1], oz = back ? -pv[i * 3 + 2] : pv[i * 3 + 2], dep = dist - oz;
    sx[i] = S / 2 + f * oy / dep + dx; sy[i] = S / 2 - f * ox / dep + dy; iz[i] = 1 / dep; }
  return { sx, sy, iz, S };
}
// rasterise the faces with a mask; per pixel keeps nearest 1/depth and face id (-1 none). only(f) filters faces.
function raster(P, only) {
  const S = P.S, zb = new Float32Array(S * S), fb = new Int32Array(S * S).fill(-1);
  for (let f = 0; f < nt; f++) { if (only && !only[f]) continue;
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2], x0 = P.sx[a], y0 = P.sy[a], x1 = P.sx[b], y1 = P.sy[b], x2 = P.sx[c], y2 = P.sy[c];
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2); if (Math.abs(den) < 1e-12) continue;
    const xa = Math.max(0, Math.floor(Math.min(x0, x1, x2))), xb = Math.min(S - 1, Math.ceil(Math.max(x0, x1, x2))), ya = Math.max(0, Math.floor(Math.min(y0, y1, y2))), yb = Math.min(S - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { const px = x + 0.5, py = y + 0.5;
      const l0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / den, l1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / den, l2 = 1 - l0 - l1;
      if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
      const z = l0 * P.iz[a] + l1 * P.iz[b] + l2 * P.iz[c], k = y * S + x; if (z > zb[k]) { zb[k] = z; fb[k] = f; } }
  }
  return { zb, fb };
}
// silhouette IoU against the object mask (picture resolution, S = W)
function iou(P) {
  const { fb } = raster(P, null); let i = 0, u = 0;
  for (let k = 0; k < W * H; k++) { const m = fb[k] >= 0, o = obj[k] === 1; if (m && o) i++; if (m || o) u++; }
  return i / u;
}
const DIST = +(opt.dist || 1.9), FOV0 = +(opt.fov || 40);
const iouStock = iou(project(DIST, FOV0, 0, 0, W));
console.log(`camera dist ${DIST}, stock fov ${FOV0}: silhouette IoU ${iouStock.toFixed(4)}`);
let fov = FOV0, dx = 0, dy = 0, iouUsed = iouStock;
if (!opt.stock) {   // fit on a coarse copy of the problem: only fov and a pixel offset, scored by silhouette IoU (the picture itself, not the mesh colours)
  const SC = 4, scoreFast = (fv, ax, ay) => { const P = project(DIST, fv, ax, ay, W); const sub = { ...P, sx: P.sx.map((v) => v / SC), sy: P.sy.map((v) => v / SC), S: Math.ceil(W / SC) };
    const { fb } = raster(sub, null); let i = 0, u = 0, S2 = sub.S;
    for (let y = 0; y < S2; y++) for (let x = 0; x < S2; x++) { const m = fb[y * S2 + x] >= 0, o = obj[Math.min(H - 1, y * SC + 2) * W + Math.min(W - 1, x * SC + 2)] === 1; if (m && o) i++; if (m || o) u++; }
    return i / u; };
  let best = [-1, FOV0, 0, 0];
  for (let fv = 24; fv <= FOV0 + 0.01; fv += 0.5) { const s = scoreFast(fv, 0, 0); if (s > best[0]) best = [s, fv, 0, 0]; }
  for (const step of [16, 8, 4, 2]) for (let ax = -2; ax <= 2; ax++) for (let ay = -2; ay <= 2; ay++) { const cx = best[2] + ax * step, cy = best[3] + ay * step; const s = scoreFast(best[1], cx, cy); if (s > best[0]) best = [s, best[1], cx, cy]; }
  for (let fv = best[1] - 1; fv <= best[1] + 1.01; fv += 0.25) { const s = scoreFast(fv, best[2], best[3]); if (s > best[0]) best = [s, fv, best[2], best[3]]; }
  [, fov, dx, dy] = best; iouUsed = iou(project(DIST, fov, dx, dy, W));
  console.log(`FITTED camera: fov ${fov}, offset ${dx},${dy} px: silhouette IoU ${iouUsed.toFixed(4)} (this object only; stock camera is NOT matching the picture)`);
}
if (iouUsed < 0.9) console.log(`WARNING: IoU ${iouUsed.toFixed(4)} < 0.9, the camera does not match the picture well`);

// ---------------------------------------------------------------- visibility (front camera at (0,0,DIST), back camera at (0,0,-DIST), OBJ axes)
function facing(camZ) { const cs = new Float32Array(nt);   // cos(outward normal, direction to camera) per face
  for (let f = 0; f < nt; f++) { const a = idx[f * 3] * 3, b = idx[f * 3 + 1] * 3, c = idx[f * 3 + 2] * 3;
    const ux = pv[b] - pv[a], uy = pv[b + 1] - pv[a + 1], uz = pv[b + 2] - pv[a + 2], vx = pv[c] - pv[a], vy = pv[c + 1] - pv[a + 1], vz = pv[c + 2] - pv[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, cx = (pv[a] + pv[b] + pv[c]) / 3, cy = (pv[a + 1] + pv[b + 1] + pv[c + 1]) / 3, cz = (pv[a + 2] + pv[b + 2] + pv[c + 2]) / 3;
    const dx_ = 0 - cx, dy_ = 0 - cy, dz_ = camZ - cz, nl = Math.hypot(nx, ny, nz) * Math.hypot(dx_, dy_, dz_) || 1; cs[f] = (nx * dx_ + ny * dy_ + nz * dz_) / nl; }
  return cs; }
function visibility(P, cs) {
  const outw = new Uint8Array(nt); for (let f = 0; f < nt; f++) outw[f] = cs[f] > 0 ? 1 : 0;
  const { zb, fb } = raster(P, outw);          // z-buffer of the faces facing this camera
  const vis = new Uint8Array(nt); let nFront = 0, nVis = 0, nOcc = 0, nBg = 0;
  const probes = [[1 / 3, 1 / 3, 1 / 3], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7]];
  for (let f = 0; f < nt; f++) { if (!outw[f]) continue; nFront++;
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2]; let ok = true, occ = false, inBg = false;
    for (const [l0, l1, l2] of probes) { const x = l0 * P.sx[a] + l1 * P.sx[b] + l2 * P.sx[c], y = l0 * P.sy[a] + l1 * P.sy[b] + l2 * P.sy[c], z = l0 * P.iz[a] + l1 * P.iz[b] + l2 * P.iz[c];
      const xi = Math.floor(x), yi = Math.floor(y); if (xi < 0 || yi < 0 || xi >= W || yi >= H) { ok = false; inBg = true; break; }
      if (z < zb[yi * W + xi] * (1 - 0.004)) { ok = false; occ = true; break; }          // something nearer covers it
      if (!objM[yi * W + xi]) { ok = false; inBg = true; break; } }                    // the picture shows background there, not this surface
    if (ok) { vis[f] = 1; nVis++; } else if (occ) nOcc++; else if (inBg) nBg++; }
  return { zb, fb, vis, nFront, nVis, nOcc, nBg }; }
let objM = obj;   // mask used for the camera being tested (back camera: mirrored mask)
const P = project(DIST, fov, dx, dy, W, false);
const csF = facing(DIST), VF = visibility(P, csF), { zb, fb } = VF, visF = VF.vis;
console.log(`FRONT camera: faces ${nt}: facing ${VF.nFront}, visible+in mask ${VF.nVis} (${(100 * VF.nVis / nt).toFixed(2)}%), occluded ${VF.nOcc}, picture shows background ${VF.nBg}, facing away ${nt - VF.nFront}`);
let PB = null, visB = new Uint8Array(nt), cx0b = 0;
const vis = new Uint8Array(nt), side = new Uint8Array(nt);   // side: 0 vertex colour, 1 front picture, 2 back picture
if (!opt["no-back"]) {
  const objMir = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) objMir[y * W + x] = obj[y * W + (W - 1 - x)];
  PB = project(DIST, fov, -dx, dy, W, true);
  { const { fb: fbB } = raster(PB, null); let i = 0, u = 0; for (let k = 0; k < W * H; k++) { const m = fbB[k] >= 0, o = objMir[k] === 1; if (m && o) i++; if (m || o) u++; }
    var iouBack = i / u;
    const { fb: fbF } = raster(P, null); let i2 = 0, u2 = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const m = fbB[y * W + x] >= 0, o = fbF[y * W + (W - 1 - x)] >= 0; if (m && o) i2++; if (m || o) u2++; }
    console.log(`  (mesh only: back silhouette vs mirrored FRONT silhouette IoU ${(i2 / u2).toFixed(4)})`); }
  console.log(`BACK camera (180 deg about up, offset ${-dx},${dy}): silhouette IoU vs mirrored picture mask ${iouBack.toFixed(4)} (front ${iouUsed.toFixed(4)})`);
  objM = objMir; const csB = facing(-DIST), VB = visibility(PB, csB); objM = obj; visB = VB.vis;
  console.log(`BACK camera: faces facing ${VB.nFront}, visible+in mask ${VB.nVis} (${(100 * VB.nVis / nt).toFixed(2)}%), occluded ${VB.nOcc}, picture shows background ${VB.nBg}`);
  for (let f = 0; f < nt; f++) { if (visF[f] && visB[f]) side[f] = csF[f] >= csB[f] ? 1 : 2; else if (visF[f]) side[f] = 1; else if (visB[f]) side[f] = 2; }
} else for (let f = 0; f < nt; f++) if (visF[f]) side[f] = 1;
let n1 = 0, n2 = 0, n0 = 0, nBoth = 0; for (let f = 0; f < nt; f++) { if (side[f] === 1) n1++; else if (side[f] === 2) n2++; else n0++; if (visF[f] && visB[f]) nBoth++; vis[f] = visF[f]; }
const pc = (n) => (100 * n / nt).toFixed(2) + "%";
console.log(`FACES ${nt}: front picture ${n1} (${pc(n1)}), back picture ${n2} (${pc(n2)}), vertex colour ${n0} (${pc(n0)}); visible from both ${nBoth}`);

// ---------------------------------------------------------------- SIDEFILL: unpainted faces take the colour of the nearest painted face along the mesh
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
let fillV = null, sideLeft = n0;   // fillV: per source vertex linear rgb (NaN = none) for vertex-colour faces
if (!opt["no-sidefill"] && n0 > 0 && n0 < nt) {
  const fc3 = new Float32Array(nt * 3).fill(NaN), dist = new Int32Array(nt).fill(-1);
  const probesS = [[1 / 3, 1 / 3, 1 / 3], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7]];
  // depth of every picture pixel inside the object (city-block pixels to the nearest background pixel): seeds are painted faces well inside the picture, so the cut-out edge
  // (anti-aliased with the grey background, outline) does not tint the fill. Needs MIN_DEPTH px; if there is no such face the limit drops to 1.
  const dep = new Int32Array(W * H); { for (let k = 0; k < W * H; k++) dep[k] = obj[k] ? 1e6 : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = y * W + x; if (!dep[k]) continue; dep[k] = Math.min(dep[k], x ? dep[k - 1] + 1 : 1, y ? dep[k - W] + 1 : 1); }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) { const k = y * W + x; if (!dep[k]) continue; dep[k] = Math.min(dep[k], x < W - 1 ? dep[k + 1] + 1 : 1, y < H - 1 ? dep[k + W] + 1 : 1); } }
  const sampleFace = (f) => { const PP = side[f] === 2 ? PB : P, a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2]; let r = 0, g = 0, bl = 0, md = 1e9;
    for (const [l0, l1, l2] of probesS) { let x = l0 * PP.sx[a] + l1 * PP.sx[b] + l2 * PP.sx[c]; const y = l0 * PP.sy[a] + l1 * PP.sy[b] + l2 * PP.sy[c]; if (side[f] === 2) x = W - x;
      const xi = Math.min(W - 1, Math.max(0, Math.floor(x))), yi = Math.min(H - 1, Math.max(0, Math.floor(y))), k = (yi * W + xi) * 3; md = Math.min(md, dep[yi * W + xi]); r += lin(img.rgb[k] / 255); g += lin(img.rgb[k + 1] / 255); bl += lin(img.rgb[k + 2] / 255); }
    return [r / 4, g / 4, bl / 4, md]; };
  // edge adjacency (faces sharing an edge; non-manifold edges link all faces on it)
  const emap = new Map(), nb = Array.from({ length: nt }, () => []);
  for (let f = 0; f < nt; f++) for (let q = 0; q < 3; q++) { const u = idx[f * 3 + q], v = idx[f * 3 + (q + 1) % 3], key = Math.min(u, v) * nv + Math.max(u, v); const l = emap.get(key); if (l) { for (const g of l) { nb[f].push(g); nb[g].push(f); } l.push(f); } else emap.set(key, [f]); }
  emap.clear();
  let queue = [];
  const pcol = new Float32Array(nt * 3).fill(NaN), pdep = new Int32Array(nt); let nSeed = 0;   // pcol: picture colour of every painted face (for the numbers only)
  for (let f = 0; f < nt; f++) if (side[f]) { const c = sampleFace(f); pcol[f * 3] = c[0]; pcol[f * 3 + 1] = c[1]; pcol[f * 3 + 2] = c[2]; pdep[f] = c[3]; }
  let MIN_DEPTH = 5; for (let f = 0; f < nt; f++) if (side[f] && pdep[f] >= MIN_DEPTH) nSeed++; if (!nSeed) { MIN_DEPTH = 1; for (let f = 0; f < nt; f++) if (side[f]) nSeed++; }
  for (let f = 0; f < nt; f++) if (side[f] && pdep[f] >= MIN_DEPTH) { fc3[f * 3] = pcol[f * 3]; fc3[f * 3 + 1] = pcol[f * 3 + 1]; fc3[f * 3 + 2] = pcol[f * 3 + 2]; dist[f] = 0; queue.push(f); }
  const bfs = (neigh) => { let n = 0, maxd = 0, sumd = 0; for (let h = 0; h < queue.length; h++) { const f = queue[h]; for (const g of neigh(f)) if (dist[g] < 0) { dist[g] = dist[f] + 1; fc3[g * 3] = fc3[f * 3]; fc3[g * 3 + 1] = fc3[f * 3 + 1]; fc3[g * 3 + 2] = fc3[f * 3 + 2]; queue.push(g); n++; maxd = Math.max(maxd, dist[g]); sumd += dist[g]; } } return { n, maxd, mean: n ? sumd / n : 0 }; };
  const e1 = bfs((f) => nb[f]);
  // second pass: faces in components with no painted face, through shared vertices, from every coloured face
  const vf = Array.from({ length: nv }, () => []); for (let f = 0; f < nt; f++) for (let q = 0; q < 3; q++) vf[idx[f * 3 + q]].push(f);
  queue = []; for (let f = 0; f < nt; f++) if (dist[f] >= 0) queue.push(f);
  const e2 = bfs((f) => { const o = []; for (let q = 0; q < 3; q++) for (const g of vf[idx[f * 3 + q]]) o.push(g); return o; });
  // third pass: floating islands (components with no painted face and no shared vertex with anything coloured): nearest coloured face by straight line between centroids, whole island one colour.
  //   (there is no path along the mesh to follow here; this is the only place a straight-line distance is used)
  let e3 = 0, islands = 0; { const cen = (f) => [(pv[idx[f * 3] * 3] + pv[idx[f * 3 + 1] * 3] + pv[idx[f * 3 + 2] * 3]) / 3, (pv[idx[f * 3] * 3 + 1] + pv[idx[f * 3 + 1] * 3 + 1] + pv[idx[f * 3 + 2] * 3 + 1]) / 3, (pv[idx[f * 3] * 3 + 2] + pv[idx[f * 3 + 1] * 3 + 2] + pv[idx[f * 3 + 2] * 3 + 2]) / 3];
    for (let s0 = 0; s0 < nt; s0++) { if (dist[s0] >= 0) continue; const comp = [s0]; dist[s0] = -2;
      for (let h = 0; h < comp.length; h++) for (let q = 0; q < 3; q++) for (const g of vf[idx[comp[h] * 3 + q]]) if (dist[g] === -1) { dist[g] = -2; comp.push(g); }
      let cx = 0, cy = 0, cz = 0; for (const f of comp) { const c = cen(f); cx += c[0]; cy += c[1]; cz += c[2]; } cx /= comp.length; cy /= comp.length; cz /= comp.length;
      let best = -1, bd = 1e30; for (let f = 0; f < nt; f++) { if (dist[f] < 0) continue; const c = cen(f), d = (c[0] - cx) ** 2 + (c[1] - cy) ** 2 + (c[2] - cz) ** 2; if (d < bd) { bd = d; best = f; } }
      for (const f of comp) { if (best >= 0) { dist[f] = 1; fc3[f * 3] = fc3[best * 3]; fc3[f * 3 + 1] = fc3[best * 3 + 1]; fc3[f * 3 + 2] = fc3[best * 3 + 2]; e3++; } else dist[f] = -1; } islands++; } }
  // smoothing over filled faces only (painted faces keep their picture)
  for (let pass = 0; pass < 3; pass++) { const nxt = Float32Array.from(fc3);
    for (let f = 0; f < nt; f++) { if (side[f] || dist[f] < 0) continue; let r = fc3[f * 3], g = fc3[f * 3 + 1], b = fc3[f * 3 + 2], n = 1;
      for (const h of nb[f]) if (dist[h] >= 0) { r += fc3[h * 3]; g += fc3[h * 3 + 1]; b += fc3[h * 3 + 2]; n++; }
      nxt[f * 3] = r / n; nxt[f * 3 + 1] = g / n; nxt[f * 3 + 2] = b / n; }
    fc3.set(nxt); }
  // per source vertex: mean of the filled faces that use it
  fillV = new Float32Array(nv * 3).fill(NaN); const cnt = new Uint16Array(nv), acc3 = new Float64Array(nv * 3);
  for (let f = 0; f < nt; f++) { if (side[f] || dist[f] < 0) continue; for (let q = 0; q < 3; q++) { const v = idx[f * 3 + q]; cnt[v]++; for (let k = 0; k < 3; k++) acc3[v * 3 + k] += fc3[f * 3 + k]; } }
  for (let v = 0; v < nv; v++) if (cnt[v]) for (let k = 0; k < 3; k++) fillV[v * 3 + k] = acc3[v * 3 + k] / cnt[v];
  sideLeft = 0; for (let f = 0; f < nt; f++) if (!side[f] && dist[f] < 0) sideLeft++;
  { const srgbE = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055), st = (lo) => { const s = { painted: [0, 0, 0, 0, 0], filled: [0, 0, 0, 0, 0], raw: [0, 0, 0, 0, 0] };   // r,g,b sum (sRGB 0-255), saturation sum, n
      const add = (a, r, g, b) => { const R = srgbE(r) * 255, G = srgbE(g) * 255, B = srgbE(b) * 255, mx = Math.max(R, G, B), mn = Math.min(R, G, B); a[0] += R; a[1] += G; a[2] += B; a[3] += mx > 0 ? (mx - mn) / mx : 0; a[4]++; };
      for (let f = 0; f < nt; f++) { if (side[f]) add(s.painted, pcol[f * 3], pcol[f * 3 + 1], pcol[f * 3 + 2]); else add(s.filled, fc3[f * 3], fc3[f * 3 + 1], fc3[f * 3 + 2]);
        if (!side[f] && hasCol) { const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2]; add(s.raw, lin((col[a * 3] + col[b * 3] + col[c * 3]) / 3), lin((col[a * 3 + 1] + col[b * 3 + 1] + col[c * 3 + 1]) / 3), lin((col[a * 3 + 2] + col[b * 3 + 2] + col[c * 3 + 2]) / 3)); } }
      return Object.entries(s).map(([k, a]) => `${k} n ${a[4]} mean rgb ${[a[0], a[1], a[2]].map((x) => Math.round(x / (a[4] || 1)))} sat ${(a[3] / (a[4] || 1)).toFixed(3)}`).join("; "); };
    console.log("SIDEFILL colours (per-face, before smoothing of vertices): " + st()); }
  console.log(`SIDEFILL: seeds ${nSeed} painted faces at depth >= ${MIN_DEPTH} px; unpainted ${n0}, filled by edge-BFS ${e1.n} (max ${e1.maxd} faces from a painted face, mean ${e1.mean.toFixed(1)}), by vertex-BFS ${e2.n} (max ${e2.maxd}), floating islands ${islands} (${e3} faces, nearest by straight line), left raw ${sideLeft}`);
} else console.log(`SIDEFILL: ${opt["no-sidefill"] ? "off" : "nothing to fill"}; left raw ${n0}`);

// ---------------------------------------------------------------- numbers: picture vs TripoSR vertex colours on the visible front
{ let sum = [0, 0, 0], sg = [0, 0, 0], pm = [0, 0, 0], n = 0;
  if (hasCol) for (let k = 0; k < W * H; k++) { const f = fb[k]; if (f < 0 || !vis[f] || !obj[k]) continue;
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2], x = (k % W) + 0.5, y = ((k / W) | 0) + 0.5, x0 = P.sx[a], y0 = P.sy[a], x1 = P.sx[b], y1 = P.sy[b], x2 = P.sx[c], y2 = P.sy[c];
    const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2), l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den, l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den, l2 = 1 - l0 - l1;
    for (let q = 0; q < 3; q++) { const v = 255 * (l0 * col[a * 3 + q] + l1 * col[b * 3 + q] + l2 * col[c * 3 + q]); sum[q] += Math.abs(v - img.rgb[k * 3 + q]); sg[q] += v - img.rgb[k * 3 + q]; pm[q] += img.rgb[k * 3 + q]; } n++; }
  if (n) console.log(`OLD look (vertex colours) vs picture over the ${n} visible-front pixels: mean abs error per channel R ${(sum[0] / n).toFixed(2)} G ${(sum[1] / n).toFixed(2)} B ${(sum[2] / n).toFixed(2)} (0-255); mean signed (vertex - picture) ${sg.map((v) => (v / n).toFixed(1))}, picture mean ${pm.map((v) => (v / n).toFixed(1))}. The sticker samples the picture at those pixels, so its error there is 0 by construction.`); }

// ---------------------------------------------------------------- atlas: picture crop + 4 white columns
const M = 8, cx0 = Math.max(0, ox0 - M), cx1 = Math.min(W - 1, ox1 + M), cy0 = Math.max(0, oy0 - M), cy1 = Math.min(H - 1, oy1 + M);
const AW = cx1 - cx0 + 1 + 4, AH = cy1 - cy0 + 1, atlas = Buffer.alloc(AW * AH * 3, 255);
for (let y = 0; y < AH; y++) for (let x = 0; x < AW - 4; x++) { const s = ((cy0 + y) * W + cx0 + x) * 3, d = (y * AW + x) * 3; atlas[d] = img.rgb[s]; atlas[d + 1] = img.rgb[s + 1]; atlas[d + 2] = img.rgb[s + 2]; }
const whiteU = (AW - 2) / AW;
const png = writePng(AW, AH, atlas);

// ---------------------------------------------------------------- build vertices (picture copy / colour copy), indices
const outP = [], outUV = [], outC = [], outI = new Uint32Array(nt * 3), mapA = new Map(), mapB = new Map(), mapC = new Map();
const vtx = (v, pic) => { const m = pic === 1 ? mapA : pic === 2 ? mapC : mapB; const PP = pic === 2 ? PB : P; let k = m.get(v); if (k !== undefined) return k; k = outP.length / 3; m.set(v, k);
  outP.push(pv[v * 3], pv[v * 3 + 1], pv[v * 3 + 2]);
  if (pic) { const pxu = pic === 2 ? W - PP.sx[v] : PP.sx[v];   // back camera screen x is in the MIRRORED picture; the texture is the unmirrored picture, so look it up at W - x
    outUV.push((Math.min(Math.max(pxu, cx0), cx1 + 1) - cx0) / AW, (Math.min(Math.max(PP.sy[v], cy0), cy1 + 1) - cy0) / AH); outC.push(1, 1, 1); }
  else { outUV.push(whiteU, 0.5); if (fillV && !Number.isNaN(fillV[v * 3])) outC.push(fillV[v * 3], fillV[v * 3 + 1], fillV[v * 3 + 2]); else if (hasCol) outC.push(lin(col[v * 3]), lin(col[v * 3 + 1]), lin(col[v * 3 + 2])); else outC.push(0.5, 0.5, 0.5); }
  return k; };
for (let f = 0; f < nt; f++) for (let q = 0; q < 3; q++) outI[f * 3 + q] = vtx(idx[f * 3 + q], side[f]);
const NV = outP.length / 3;
console.log(`output verts ${NV} (source ${nv}), tris ${nt}, atlas ${AW}x${AH}, png ${png.length} bytes`);

// ---------------------------------------------------------------- GLB
const Pf = new Float32Array(outP), Uf = new Float32Array(outUV), Cf = new Float32Array(outC);
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < NV; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], Pf[i * 3 + k]); mx[k] = Math.max(mx[k], Pf[i * 3 + k]); }
const pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - b.length % 4) % 4)]);
const bufs = [Buffer.from(outI.buffer), Buffer.from(Pf.buffer), Buffer.from(Uf.buffer), Buffer.from(Cf.buffer), png].map(pad4);
const views = [], acc = []; let off = 0;
bufs.forEach((b, i) => { const real = i === 4 ? png.length : bufs[i].length; views.push({ buffer: 0, byteOffset: off, byteLength: real, ...(i < 4 ? { target: i === 0 ? 34963 : 34962 } : {}) }); off += b.length; });
acc.push({ bufferView: 0, componentType: 5125, count: nt * 3, type: "SCALAR" }, { bufferView: 1, componentType: 5126, count: NV, type: "VEC3", min: mn, max: mx },
  { bufferView: 2, componentType: 5126, count: NV, type: "VEC2" }, { bufferView: 3, componentType: 5126, count: NV, type: "VEC3" });
const json = { asset: { version: "2.0", generator: "tools/project_paint.mjs" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: id }],
  meshes: [{ name: id, primitives: [{ attributes: { POSITION: 1, TEXCOORD_0: 2, COLOR_0: 3 }, indices: 0, material: 0, mode: 4 }] }],
  materials: [{ name: "sticker", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }],
  textures: [{ sampler: 0, source: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }], images: [{ bufferView: 4, mimeType: "image/png" }],
  accessors: acc, bufferViews: views, buffers: [{ byteLength: off }] };
let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
const bin = Buffer.concat(bufs), hdr = Buffer.alloc(12); hdr.write("glTF", 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
const ch = (n, t) => { const b = Buffer.alloc(8); b.writeUInt32LE(n, 0); b.writeUInt32LE(t, 4); return b; };
const glb = Buffer.concat([hdr, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]);
fs.mkdirSync(path.join(DIR, "glb"), { recursive: true });
const rel = `glb/${id}.glb`, outFile = opt.out || path.join(DIR, rel); fs.writeFileSync(outFile, glb);
console.log(`wrote ${outFile} (${glb.length} bytes)`);
if (!opt["no-catalogue"] && !opt.out) {
  const catf = path.join(DIR, "objects.json"); let cat = []; try { cat = JSON.parse(fs.readFileSync(catf, "utf8")); } catch {}
  const row = { id, name: opt.name, category: opt.category || "objects", kind: opt.kind || "other", rel, source: opt.source || "TripoSR + project_paint", licence: opt.licence || "own", tris: nt, bytes: glb.length, date: new Date().toISOString().slice(0, 10) };
  const at = cat.findIndex((r) => r.id === id); if (at >= 0) cat[at] = row; else cat.push(row);
  fs.writeFileSync(catf, JSON.stringify(cat, null, 1) + "\n"); console.log("catalogue", catf, "rows", cat.length);
}
