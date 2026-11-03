// Step 5 (anime set). Download the CC0/CC-BY picks (licence re-checked per model), unzip into ~/biome-tmp/sf/<uid>/, decimate to <=30k tris, textures 1K webp -> web/biome/assets/sketchfab/. Run from ~/biome-tmp: node biome_fetch_anime.mjs <repo>
// Sketchfab downloader -> toon-ready GLB (CC0/CC-BY only, licence re-checked from API at download time). Token read from ~/.sketchfab_token, never printed.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core"; import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { prune, weld, simplify, textureCompress, dedup, flatten, join as joinMeshes } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
const H = process.env.HOME, tok = fs.readFileSync(H + "/.sketchfab_token", "utf8").trim();
const REPO = process.argv[2], meta = JSON.parse(fs.readFileSync(H + "/biome-tmp/sf-meta.json"));
const OUT = REPO + "/web/biome/assets/sketchfab", SF = H + "/biome-tmp/sf", RES = H + "/biome-tmp/sf-results.json";
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SF, { recursive: true });
await MeshoptSimplifier.ready; const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const res = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES)) : {};
const sleep = (ms) => new Promise(s => setTimeout(s, ms));
const tris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute("POSITION").getCount()) / 3; } return Math.round(t); };
const slugify = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
const api = (u, o = {}) => fetch(u, { ...o, headers: { ...(o.headers || {}), Authorization: "Token " + tok } });
for (const [uid, m] of Object.entries(meta)) {
  if (res[uid]?.ok || res[uid]?.skip === "perm") continue;
  const why = (r) => { res[uid] = { name: m.name, author: m.user, skip: r }; console.log("SKIP", uid.slice(0, 8), m.name, r); fs.writeFileSync(RES, JSON.stringify(res, null, 1)); };
  if (m.err) { why("meta error " + m.err); continue; }
  if (m.faces > 120000) { why("too heavy " + m.faces + " faces"); continue; }
  try {
    // licence re-check at download time
    const mr = await api("https://api.sketchfab.com/v3/models/" + uid); await sleep(800);
    if (!mr.ok) { why("model api " + mr.status); continue; }
    const mj = await mr.json(); const lic = mj.license?.slug;
    if (lic !== "by" && lic !== "cc0") { why("licence " + lic); continue; }
    if (!mj.isDownloadable) { why("not downloadable"); continue; }
    let dr = await api("https://api.sketchfab.com/v3/models/" + uid + "/download");
    if (dr.status === 429) { await sleep(30000); dr = await api("https://api.sketchfab.com/v3/models/" + uid + "/download"); }
    if (!dr.ok) { why("download api " + dr.status); await sleep(2000); continue; }
    const dj = await dr.json(); const g = dj.gltf; if (!g?.url) { why("no gltf archive"); continue; }
    const dir = SF + "/" + uid; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const zr = await fetch(g.url); const zbuf = Buffer.from(await zr.arrayBuffer()); fs.writeFileSync(dir + ".zip", zbuf);
    execFileSync("python3", ["-I", "-c", "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);[z.extract(i,sys.argv[2]) for i in z.infolist() if '..' not in i.filename and not i.filename.startswith('/')]", dir + ".zip", dir]);
    fs.rmSync(dir + ".zip");
    const gf = fs.readdirSync(dir).find(f => f.endsWith(".gltf")); if (!gf) { why("no gltf in zip"); continue; }
    const doc = await io.read(dir + "/" + gf);
    for (const a of doc.getRoot().listAnimations()) a.dispose();
    for (const s of doc.getRoot().listSkins()) s.dispose();
    for (const mat of doc.getRoot().listMaterials()) { mat.setNormalTexture(null); mat.setOcclusionTexture(null); mat.setMetallicRoughnessTexture(null); mat.setEmissiveTexture(null); }
    await doc.transform(flatten(), prune());
    const t0 = tris(doc); const target = 30000;
    if (t0 > target) await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: target / t0, error: 0.05, lockBorder: false }));
    await doc.transform(dedup(), textureCompress({ encoder: sharp, targetFormat: "webp", resize: [1024, 1024], quality: 84 }), prune());
    const slug = slugify(m.user + "_" + m.name) + "_" + uid.slice(0, 6);
    await io.write(OUT + "/" + slug + ".glb", doc);
    res[uid] = { ok: true, mtn: !!m.mtn, slug, name: mj.name, author: mj.user.username, disp: mj.user.displayName, lic, url: mj.viewerUrl, tris: tris(doc), trisBefore: t0, bytes: fs.statSync(OUT + "/" + slug + ".glb").size };
    console.log("OK", slug, t0, "->", res[uid].tris, Math.round(res[uid].bytes / 1024) + "KB");
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) { why("error " + String(e.message).slice(0, 80)); }
  fs.writeFileSync(RES, JSON.stringify(res, null, 1)); await sleep(2500);
}
fs.writeFileSync(RES, JSON.stringify(res, null, 1));
