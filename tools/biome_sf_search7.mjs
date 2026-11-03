// Step 7 search: mountain backdrops (6 pages) + deeper pages (8) for willow/reed/cattail/edelweiss/alpine plant. CC0/CC-BY downloadable only. Writes ~/biome-tmp/s7-search.json (new = not in sf-meta.json).
import fs from "node:fs";
const H = process.env.HOME, tok = fs.readFileSync(H + "/.sketchfab_token", "utf8").trim();
const known = JSON.parse(fs.readFileSync(H + "/biome-tmp/sf-meta.json"));
const MQ = ["stylized mountain","anime mountain","mountain range","stylized terrain","hand painted mountain","cliff mountain","mountain landscape","snowy mountain"];
const PQ = ["willow","weeping willow","reed","cattail","edelweiss","alpine plant"];
const out = {}, stat = {}, sleep = (ms) => new Promise(s => setTimeout(s, ms));
async function run(q, PAGES) {
  let url = "https://api.sketchfab.com/v3/search?type=models&downloadable=true&count=24&q=" + encodeURIComponent(q), n = 0, pg = 0;
  while (url && pg < PAGES) {
    const r = await fetch(url, { headers: { Authorization: "Token " + tok } });
    if (r.status === 429) { await sleep(15000); continue; }
    if (!r.ok) { console.log(q, r.status); break; }
    const j = await r.json(); pg++;
    for (const m of j.results || []) { n++; const L = m.license?.label || "", lic = L === "CC Attribution" ? "by" : /CC0|Public Domain/i.test(L) ? "cc0" : null; if (!lic) continue;
      out[m.uid] ??= { name: m.name, user: m.user?.username, lic, faces: m.faceCount, tags: (m.tags||[]).map(t=>t.name).slice(0,6), known: !!known[m.uid], q: [] }; out[m.uid].q.push(q + "#" + pg); }
    url = j.next; await sleep(500);
  }
  stat[q] = { pages: pg, seen: n };
}
for (const q of MQ) await run(q, 6);
for (const q of PQ) await run(q, 8);
fs.writeFileSync(H + "/biome-tmp/s7-search.json", JSON.stringify({ out, stat }, null, 1));
console.log(Object.keys(out).length, "new", Object.values(out).filter(o=>!o.known).length, JSON.stringify(stat));
