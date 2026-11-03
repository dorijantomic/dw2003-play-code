// Step 5 (anime set). Resolve + read Sketchfab metadata of the research picks -> ~/biome-tmp/sf-meta.json. Token: ~/.sketchfab_token (never printed). Run from ~/biome-tmp (needs node_modules there).
import fs from "node:fs";
const H = process.env.HOME, D = H + "/dw3-knowledge/research/biomes/";
const tok = fs.readFileSync(H + "/.sketchfab_token", "utf8").trim();
const r1 = fs.readFileSync(D + "SKETCHFAB.md", "utf8"), r2 = fs.readFileSync(D + "SKETCHFAB-R2.md", "utf8");
const all = new Set([...(r1 + r2).matchAll(/\b[0-9a-f]{32}\b/g)].map(m => m[0]));
// wanted: all uids in R2, prefixes in R2 resolved via all, plus R1 anime/hand-painted/top sections
const want = new Set([...r2.matchAll(/\b[0-9a-f]{32}\b/g)].map(m => m[0]));
for (const m of r2.matchAll(/\b([0-9a-f]{8})\.\.\./g)) { const hit = [...all].filter(u => u.startsWith(m[1])); if (hit.length === 1) want.add(hit[0]); else console.log("unresolved prefix", m[1], hit.length); }
const r1lines = r1.split("\n"); const idx = r1lines.findIndex(l => l.startsWith("## ANIME PACKS"));
for (const l of r1lines.slice(idx, idx + 60)) for (const m of l.matchAll(/\b[0-9a-f]{32}\b/g)) want.add(m[0]);
for (const l of r1lines.slice(255, 285)) for (const m of l.matchAll(/\b[0-9a-f]{32}\b/g)) want.add(m[0]);
console.log("want", want.size);
const out = {}; const mf = H + "/biome-tmp/sf-meta.json"; if (fs.existsSync(mf)) Object.assign(out, JSON.parse(fs.readFileSync(mf)));
for (const u of want) {
  if (out[u]) continue;
  const r = await fetch("https://api.sketchfab.com/v3/models/" + u, { headers: { Authorization: "Token " + tok } });
  if (!r.ok) { out[u] = { err: r.status }; console.log(u, r.status); if (r.status === 429) { await new Promise(s => setTimeout(s, 20000)); } await new Promise(s => setTimeout(s, 600)); continue; }
  const j = await r.json();
  out[u] = { name: j.name, user: j.user?.username, disp: j.user?.displayName, lic: j.license?.slug, licLabel: j.license?.label, faces: j.faceCount, dl: j.isDownloadable, gltfSize: j.archives?.gltf?.size, url: j.viewerUrl || ("https://sketchfab.com/3d-models/" + u), tags: (j.tags||[]).map(t=>t.name).slice(0,8) };
  await new Promise(s => setTimeout(s, 500));
}
fs.writeFileSync(mf, JSON.stringify(out, null, 1));
const c = {}; for (const v of Object.values(out)) { const k = v.err ? "err" + v.err : v.lic + (v.dl ? "" : "-nodl"); c[k] = (c[k] || 0) + 1; }
console.log(c);
