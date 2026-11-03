// Step 7: add picked uids (8-char prefixes from ~/biome-tmp/s7-search.json) to ~/biome-tmp/sf-meta.json. Prefixes after "mtn:" are mountain backdrops (flag mtn:true).
import fs from "node:fs";
const H = process.env.HOME, tok = fs.readFileSync(H + "/.sketchfab_token", "utf8").trim();
const pool = JSON.parse(fs.readFileSync(H + "/biome-tmp/s7-search.json")).out;
const [pl, mt] = [process.argv[2].split(" ").filter(Boolean), process.argv[3].split(" ").filter(Boolean)];
const mf = H + "/biome-tmp/sf-meta.json", out = JSON.parse(fs.readFileSync(mf)); let add = 0;
for (const [p, mtn] of [...pl.map(x => [x, false]), ...mt.map(x => [x, true])]) {
  const hits = Object.keys(pool).filter(u => u.startsWith(p)); if (hits.length !== 1) { console.log("unresolved", p, hits.length); continue; }
  const u = hits[0]; if (out[u]) continue;
  const r = await fetch("https://api.sketchfab.com/v3/models/" + u, { headers: { Authorization: "Token " + tok } });
  if (!r.ok) { console.log(p, r.status); if (r.status === 429) await new Promise(s => setTimeout(s, 20000)); continue; }
  const j = await r.json();
  out[u] = { name: j.name, user: j.user?.username, disp: j.user?.displayName, lic: j.license?.slug, licLabel: j.license?.label, faces: j.faceCount, dl: j.isDownloadable, gltfSize: j.archives?.gltf?.size, url: j.viewerUrl || ("https://sketchfab.com/3d-models/" + u), tags: (j.tags||[]).map(t=>t.name).slice(0,8), s7: true, mtn };
  add++; await new Promise(s => setTimeout(s, 500));
}
fs.writeFileSync(mf, JSON.stringify(out, null, 1)); console.log("added", add);
