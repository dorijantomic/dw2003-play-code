// Poly Pizza model pages (public, no key, 10 s crawl-delay): read licence, tris, creator, public GLB url (static.poly.pizza). usage: node biome_pp_pages.mjs id1 id2 ... -> ~/biome-tmp/pp-pages.json
import fs from "node:fs";
const H = process.env.HOME, UA = "Mozilla/5.0 (biome-gallery asset research; polite 10s delay)", out = {};
for (const id of process.argv.slice(2)) {
  const r = await fetch("https://poly.pizza/m/" + id, { headers: { "User-Agent": UA } }); if (!r.ok) { console.log(id, r.status); await new Promise(s => setTimeout(s, 10000)); continue; }
  const h = await r.text(), g = (re) => (h.match(re) || [])[1];
  const glb = g(/(https:\/\/static\.poly\.pizza\/[0-9a-f-]+\.glb)(?!\.)/), cats = [...h.matchAll(/MuiChip-labelSmall">([^<#][^<]*)</g)].map(m => m[1]).slice(0, 4);
  out[id] = { title: g(/"Title":"([^"]*)"/), lic: g(/"Licence":"([^"]*)"/), tris: +g(/"Tris":(\d+)/), creator: g(/"Creator":\{"Username":"([^"]*)"/), glb, cats };
  console.log(id, JSON.stringify(out[id])); await new Promise(s => setTimeout(s, 10000));
}
fs.writeFileSync(H + "/biome-tmp/pp-pages.json", JSON.stringify(out, null, 1));
