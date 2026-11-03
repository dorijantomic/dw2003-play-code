import fs from "node:fs";
const H = process.env.HOME, tok = fs.readFileSync(H + "/.sketchfab_token", "utf8").trim();
const pool = { ...JSON.parse(fs.readFileSync(H + "/biome-tmp/s6-search.json")).out, ...JSON.parse(fs.readFileSync(H + "/biome-tmp/s6-search2.json")).out };
const P = "26f7364a 8d3d7134 77830fd4 c58f5332 162e2502 917d9126 7bd70b48 297f7d5f 5a6ffb88 de6e0cd3 6654bd55 6106c101 99b34bc5 a8923e7b c5063005 7a37d2da bc77ea52 514fd768 4bb2e3b7 30f72493 93840cff bb9161bc a390af1c 79d9def1 dec5b256 e460c393 94eb07ea 0948b5dc 410be9cd fab161ee e48238c1 cfc045f5 6f531fb4 708f83d6 9b27119f d5a1ef2b 65893092 729aff70 8da6e41e 80c42389 76230856 56a022e3 16477643 e5217f0c 90f90114 c2eaf5c8 9b0dd36e 857802ba 28cbfa4f f0c9db51 9e0dd47c b3ff9b88 dbd6cc41 363fe344 6c588ea4 54689d68".split(" ");
const mf = H + "/biome-tmp/sf-meta.json", out = JSON.parse(fs.readFileSync(mf)); let add = 0;
for (const p of P) {
  const hits = Object.keys(pool).filter(u => u.startsWith(p)); if (hits.length !== 1) { console.log("unresolved", p, hits.length); continue; }
  const u = hits[0]; if (out[u]) continue;
  const r = await fetch("https://api.sketchfab.com/v3/models/" + u, { headers: { Authorization: "Token " + tok } });
  if (!r.ok) { console.log(p, r.status); if (r.status === 429) await new Promise(s => setTimeout(s, 20000)); continue; }
  const j = await r.json();
  out[u] = { name: j.name, user: j.user?.username, disp: j.user?.displayName, lic: j.license?.slug, licLabel: j.license?.label, faces: j.faceCount, dl: j.isDownloadable, gltfSize: j.archives?.gltf?.size, url: j.viewerUrl || ("https://sketchfab.com/3d-models/" + u), tags: (j.tags||[]).map(t=>t.name).slice(0,8), s6: true };
  add++; await new Promise(s => setTimeout(s, 500));
}
fs.writeFileSync(mf, JSON.stringify(out, null, 1)); console.log("added", add);
