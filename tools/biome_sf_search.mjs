import fs from "node:fs";
const H = process.env.HOME, tok = fs.readFileSync(H + "/.sketchfab_token", "utf8").trim();
const Q = ["weeping willow","willow","reeds","cattail","bulrush","rushes","seaweed","kelp","shells","seashell","driftwood","edelweiss","alpine flowers","gentian","heather","stylized mountain","snowy pine","stylized flowers","beach plants","hand painted reeds","stylized grass water plant","stylized wood log driftwood","hand painted shell"];
const PAGES = 5, out = {}, stat = {};
const sleep = (ms) => new Promise(s => setTimeout(s, ms));
async function run(q, extra = "") {
  let url = "https://api.sketchfab.com/v3/search?type=models&downloadable=true&count=24&q=" + encodeURIComponent(q) + extra, n = 0, pg = 0;
  while (url && pg < PAGES) {
    const r = await fetch(url, { headers: { Authorization: "Token " + tok } });
    if (r.status === 429) { await sleep(15000); continue; }
    if (!r.ok) { console.log(q, r.status); break; }
    const j = await r.json(); pg++;
    for (const m of j.results || []) { n++; const L = m.license?.label || "", lic = L === "CC Attribution" ? "by" : /CC0|Public Domain/i.test(L) ? "cc0" : null; if (!lic) continue; out[m.uid] ??= { name: m.name, user: m.user?.username, uid_user: m.user?.uid, lic, faces: m.faceCount, tags: (m.tags||[]).map(t=>t.name).slice(0,6), q: [] }; out[m.uid].q.push(q); }
    url = j.next; await sleep(500);
  }
  stat[q + extra] = { pages: pg, seen: n };
}
for (const q of Q) await run(q);
for (const u of ["toyamon", "marte3d", "marte 3d", "marte"]) {
  const r = await fetch("https://api.sketchfab.com/v3/search?type=users&q=" + u, { headers: { Authorization: "Token " + tok } }); const j = await r.json();
  console.log("users", u, (j.results||[]).slice(0,4).map(x => x.username + ":" + x.uid));
}
globalThis.UIDS = {};
fs.writeFileSync(H + "/biome-tmp/s6-search.json", JSON.stringify({ out, stat }, null, 1));
console.log(Object.keys(out).length, JSON.stringify(stat));
// authors: Toyamon-Studio fc41e502afd64c41bbd3d9f7b5a1f181 ; marte3d resolved above
const au = { toyamon: "fc41e502afd64c41bbd3d9f7b5a1f181" };
for (const [nm, uid] of Object.entries(au)) {
  let url = "https://api.sketchfab.com/v3/search?type=models&downloadable=true&count=24&user=" + uid, pg = 0, seen = 0;
  while (url && pg < 10) { const r = await fetch(url, { headers: { Authorization: "Token " + tok } }); if (!r.ok) break; const j = await r.json(); pg++;
    for (const m of j.results) { seen++; const L = m.license?.label || "", lic = L === "CC Attribution" ? "by" : /CC0|Public Domain/i.test(L) ? "cc0" : null; if (!lic) continue; out[m.uid] ??= { name: m.name, user: m.user?.username, lic, faces: m.faceCount, tags: (m.tags||[]).map(t=>t.name).slice(0,6), q: [] }; out[m.uid].q.push("author:" + nm); }
    url = j.next; await sleep(500); }
  stat["author:" + nm] = { pages: pg, seen };
}
fs.writeFileSync(H + "/biome-tmp/s6-search.json", JSON.stringify({ out, stat }, null, 1));
console.log("final", Object.keys(out).length, JSON.stringify(stat["author:toyamon"]));
