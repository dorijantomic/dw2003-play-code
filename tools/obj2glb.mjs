// OBJ (v x y z [r g b], f a b c) -> GLB with COLOR_0, and one row in the objects catalogue (git-ignored: web/assets-lab/).
// usage: node tools/obj2glb.mjs in.obj --name "Jungle grave (TripoSR test)" [--id grave1] [--category objects] [--kind other] [--source TripoSR] [--licence own]
// Writes web/assets-lab/objects/glb/<id>.glb and upserts web/assets-lab/objects/objects.json (read by web/biome/objects.js, gallery tab "Objects").
// No dependencies: the GLB is written by hand. Vertex colours in the OBJ are sRGB; COLOR_0 is linear by the glTF spec, so they are converted.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const argv = process.argv.slice(2), inp = argv.shift(), opt = {};
for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, "")] = argv[i + 1];
if (!inp || !opt.name) { console.error("usage: node obj2glb.mjs in.obj --name NAME [--id ID --category C --kind K --source S --licence L]"); process.exit(1); }
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), DIR = path.join(REPO, "web/assets-lab/objects");
const id = opt.id || path.basename(inp, path.extname(inp)).toLowerCase().replace(/[^a-z0-9_]+/g, "_");
const txt = fs.readFileSync(inp, "utf8"), pos = [], col = [], idx = []; let hasCol = true;
for (const line of txt.split("\n")) {
  if (line.startsWith("v ")) { const t = line.trim().split(/\s+/); pos.push(+t[1], +t[2], +t[3]); if (t.length >= 7) col.push(+t[4], +t[5], +t[6]); else hasCol = false; }
  else if (line.startsWith("f ")) { const t = line.trim().split(/\s+/).slice(1).map((s) => { const k = parseInt(s.split("/")[0], 10); return k < 0 ? pos.length / 3 + k : k - 1; }); for (let i = 1; i + 1 < t.length; i++) idx.push(t[0], t[i], t[i + 1]); }
}
const nv = pos.length / 3, nt = idx.length / 3;
if (!nv || !nt) throw new Error("no geometry in " + inp);
if (hasCol && col.length !== pos.length) hasCol = false;
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const sVol = (ix) => { let s = 0; for (let i = 0; i < ix.length; i += 3) { const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
  s += (pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1]) - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c]) + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c])) / 6; } return s; };
const volBefore = sVol(idx), flipped = volBefore < 0;
if (flipped) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
console.log(`signed volume before ${volBefore.toFixed(4)} / after ${sVol(idx).toFixed(4)}, flipped ${flipped ? "yes" : "no"}`);
const P = new Float32Array(pos), I = new Uint32Array(idx), C = hasCol ? new Float32Array(col.map(lin)) : null;
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i * 3 + k]); mx[k] = Math.max(mx[k], P[i * 3 + k]); }
const bufs = [Buffer.from(I.buffer), Buffer.from(P.buffer)]; if (C) bufs.push(Buffer.from(C.buffer));
const views = [], acc = []; let off = 0;
const add = (b, target, a) => { views.push({ buffer: 0, byteOffset: off, byteLength: b.length, target }); acc.push({ bufferView: views.length - 1, byteOffset: 0, ...a }); off += b.length; };
add(bufs[0], 34963, { componentType: 5125, count: nt * 3, type: "SCALAR" });
add(bufs[1], 34962, { componentType: 5126, count: nv, type: "VEC3", min: mn, max: mx });
if (C) add(bufs[2], 34962, { componentType: 5126, count: nv, type: "VEC3" });
const attributes = { POSITION: 1 }; if (C) attributes.COLOR_0 = 2;
const json = { asset: { version: "2.0", generator: "tools/obj2glb.mjs" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: id }],
  meshes: [{ name: id, primitives: [{ attributes, indices: 0, material: 0, mode: 4 }] }],
  materials: [{ name: "vertex_colour", pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }],
  accessors: acc, bufferViews: views, buffers: [{ byteLength: off }] };
let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
const bin = Buffer.concat(bufs), binP = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
const hdr = Buffer.alloc(12); hdr.write("glTF", 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(12 + 8 + js.length + 8 + binP.length, 8);
const ch = (n, t) => { const b = Buffer.alloc(8); b.writeUInt32LE(n, 0); b.writeUInt32LE(t, 4); return b; };
const glb = Buffer.concat([hdr, ch(js.length, 0x4e4f534a), js, ch(binP.length, 0x004e4942), binP]);
fs.mkdirSync(path.join(DIR, "glb"), { recursive: true });
const rel = `glb/${id}.glb`; fs.writeFileSync(path.join(DIR, rel), glb);
let cmin = [1, 1, 1], cmax = [0, 0, 0]; if (hasCol) for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { cmin[k] = Math.min(cmin[k], col[i * 3 + k]); cmax[k] = Math.max(cmax[k], col[i * 3 + k]); }
console.log(`${id}: verts ${nv} tris ${nt} bytes ${glb.length} bbox min ${mn.map((v) => +v.toFixed(3))} max ${mx.map((v) => +v.toFixed(3))}`);
console.log(hasCol ? `colour (sRGB in OBJ) min ${cmin.map((v) => +v.toFixed(3))} max ${cmax.map((v) => +v.toFixed(3))}` : "no vertex colours in OBJ");
const catf = path.join(DIR, "objects.json"); let cat = []; try { cat = JSON.parse(fs.readFileSync(catf, "utf8")); } catch {}
const row = { id, name: opt.name, category: opt.category || "objects", kind: opt.kind || "other", rel, source: opt.source || "TripoSR", licence: opt.licence || "own", tris: nt, bytes: glb.length, date: new Date().toISOString().slice(0, 10) };
const at = cat.findIndex((r) => r.id === id); if (at >= 0) cat[at] = row; else cat.push(row);
fs.writeFileSync(catf, JSON.stringify(cat, null, 1) + "\n"); console.log("catalogue", catf, "rows", cat.length);
