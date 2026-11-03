// FBX -> GLB via three FBXLoader + GLTFExporter (node, no DOM). usage: node fbx2glb.mjs in.fbx out.glb
import fs from "node:fs";
import * as THREE from "three";
globalThis.self = globalThis;
globalThis.FileReader = class { readAsArrayBuffer(b) { b.arrayBuffer().then(r => { this.result = r; this.onloadend?.({}); this.onload?.({}); }); } readAsDataURL(b) { b.arrayBuffer().then(r => { this.result = "data:" + (b.type||"application/octet-stream") + ";base64," + Buffer.from(r).toString("base64"); this.onloadend?.({}); this.onload?.({}); }); } };
THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
const [inp, out] = process.argv.slice(2);
const buf = fs.readFileSync(inp); const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const g = new FBXLoader().parse(ab, "");
let tri = 0; const mats = new Set();
g.traverse(o => { if (o.isMesh) { tri += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; [].concat(o.material).forEach(m => mats.add(m.name)); if (!o.geometry.attributes.uv) console.log("no uv", o.name); } });
g.traverse(o => { if (o.isMesh) o.material = [].concat(o.material).map(m => new THREE.MeshStandardMaterial({ name: m.name, color: m.color, roughness: 1, metalness: 0, side: THREE.DoubleSide })).reduce((a, b, i, arr) => arr.length === 1 ? b : arr); });
const bb = new THREE.Box3().setFromObject(g), s = new THREE.Vector3(); bb.getSize(s);
console.log(inp.split("/").pop(), "tris", tri, "size", s.toArray().map(v => +v.toFixed(2)), "mats", [...mats]);
const glb = await new GLTFExporter().parseAsync(g, { binary: true });
fs.writeFileSync(out, Buffer.from(glb));
