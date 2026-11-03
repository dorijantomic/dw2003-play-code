// Poly Pizza public-page crawl (NO API key, robots.txt: Crawl-delay 10, /api and /v1 not touched). Lists search pages, keeps CC0 / CC-BY items, writes ~/biome-tmp/pp-list.json.
// The search page embeds the first ~32 hits as JSON (further pages are loaded via /api, which robots.txt disallows, so not used).
// GLB links are the public static.poly.pizza URLs on each /m/<id> page. usage: node biome_pp_crawl.mjs
import fs from "node:fs";
const H = process.env.HOME, UA = "Mozilla/5.0 (biome-gallery asset research; polite 10s delay)";
const Q = ["willow","reed","cattail","bulrush","flower","wildflower","palm tree","palm","rock","boulder","cliff","mountain","mountain range","shell","seashell","driftwood","seaweed","kelp","pine tree","birch","oak tree","bush","grass","fern","lily","lotus","mushroom","stump","log","cherry blossom","edelweiss","snow pine","coral","cactus"];
const sleep = (ms) => new Promise(s => setTimeout(s, ms));
const out = {};
for (const q of Q) {
  const r = await fetch("https://poly.pizza/search/" + encodeURIComponent(q), { headers: { "User-Agent": UA } });
  if (!r.ok) { console.log(q, r.status); await sleep(10000); continue; }
  const h = await r.text(); let n = 0, k = 0;
  for (const m of h.matchAll(/"title":"([^"]*)","alt":"[^"]*","creator":\{"username":"([^"]*)"[^}]*\},"url":"[^"]*","previewUrl":"[^"]*","publicID":"([^"]*)","licence":"([^"]*)"/g)) {
    n++; const lic = /^CC0/.test(m[4]) ? "cc0" : /^CC-BY/.test(m[4]) ? "by" : null; if (!lic) continue; k++;
    out[m[3]] ??= { title: m[1], user: m[2], lic, licLabel: m[4], q: [] }; out[m[3]].q.push(q);
  }
  console.log(q, "seen", n, "kept", k); await sleep(10000);
}
fs.writeFileSync(H + "/biome-tmp/pp-list.json", JSON.stringify(out, null, 1)); console.log("unique", Object.keys(out).length);
