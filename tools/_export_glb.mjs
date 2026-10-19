// Temporary: export battle models as textured .glb in their idle pose.
//   tools/run-playwright.sh tools/_export_glb.mjs <outDir> <model>...
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const [outDir, ...models] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();

for (const folder of models) {
  await page.goto(`${baseUrl(8770)}/model-viewer.html?model=${folder}`);
  await page.waitForFunction((f) => window._model && window._b3d && document.getElementById("ov-model")?.textContent === f, folder, { timeout: 60000 });
  const data = await page.evaluate(async (f) => {
    const m = window._model;
    const frame = m.clips?.[0]?.start_frame ?? 0;
    const { mats } = window._b3d.buildBoneWorldMatrices(m, frame, null);
    const pose = (bone, vi, b) => {
      const at = (mat, lx, ly, lz) => [-(mat[0]*lx + mat[4]*ly + mat[8]*lz) + mat[12],
        mat[1]*lx + mat[5]*ly + mat[9]*lz + mat[13], -(mat[2]*lx + mat[6]*ly + mat[10]*lz) + mat[14]];
      const inf = bone.skin?.[vi];
      if (!inf) { const [x, y, z] = bone.verts[vi] || [0, 0, 0]; return at(mats[b], x, y, z); }
      const o = [0, 0, 0];
      for (const [part, w, x, y, z] of inf) { const p = at(mats[part], x, y, z); o[0] += w*p[0]; o[1] += w*p[1]; o[2] += w*p[2]; }
      return o;
    };
    const pos = [], uv = [];
    m.bones.forEach((bone, b) => {
      for (const face of bone.faces || []) for (let c = 0; c < 3; c++) {
        const p = pose(bone, face[c], b);
        pos.push(-p[0], -p[1], p[2]);            // PS1 (+Y down) -> glTF (+Y up, facing +Z)
        uv.push(face[3 + c*2] / 256, face[4 + c*2] / 256);
      }
    });
    const png = new Uint8Array(await (await fetch(`assets/battle/textures/${f}.png`)).arrayBuffer());
    return { pos, uv, png: Array.from(png) };
  }, folder);

  // scale: PS1 units -> about 1 unit = 1 metre-ish (divide by 400, the viewer's own scale basis)
  const S = 1 / 1000;
  const pos = new Float32Array(data.pos.map((v) => v * S));
  const uv = new Float32Array(data.uv);
  const n = pos.length / 3;
  // flip winding of nothing: the material is double-sided
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i*3+k]); max[k] = Math.max(max[k], pos[i*3+k]); }
  // stand it on the ground, centred
  const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2, gy = min[1];
  for (let i = 0; i < n; i++) { pos[i*3] -= cx; pos[i*3+1] -= gy; pos[i*3+2] -= cz; }
  const mn = [min[0]-cx, 0, min[2]-cz], mx = [max[0]-cx, max[1]-gy, max[2]-cz];

  const png = Buffer.from(data.png);
  const pad = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const posB = Buffer.from(pos.buffer), uvB = Buffer.from(uv.buffer), pngB = pad(png);
  const bin = Buffer.concat([posB, uvB, pngB]);
  const gltf = {
    asset: { version: "2.0", generator: "dw2003 battle model export" },
    extensionsUsed: ["KHR_materials_unlit"],
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: folder }],
    meshes: [{ name: folder, primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ name: folder, doubleSided: true, alphaMode: "MASK", alphaCutoff: 0.5,
      pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 },
      extensions: { KHR_materials_unlit: {} } }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728 }],
    images: [{ bufferView: 2, mimeType: "image/png" }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posB.length, target: 34962 },
      { buffer: 0, byteOffset: posB.length, byteLength: uvB.length, target: 34962 },
      { buffer: 0, byteOffset: posB.length + uvB.length, byteLength: png.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: "VEC3", min: mn, max: mx },
      { bufferView: 1, componentType: 5126, count: n, type: "VEC2" },
    ],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const file = `${outDir}/${folder}.glb`;
  writeFileSync(file, Buffer.concat([header, jh, json, bh, bin]));
  console.log(folder, `${n / 3} triangles`, `height ${(mx[1]).toFixed(2)}`, file);
}
await browser.close();
