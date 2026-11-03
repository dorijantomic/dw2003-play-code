#!/usr/bin/env node
// Swap what stands in a slot of a built arena, by data. The agent path of web/built/slots.js (the viewer has the "Slots" panel).
//   node tools/swap_asset.mjs set   <meft> <slotId> <assetId>   bind an asset to a slot (writes web/assets-hd/battle/built/<meft>.slots.json)
//   node tools/swap_asset.mjs reset <meft> [slotId]             back to the module's own mesh (one slot, or the whole file)
//   node tools/swap_asset.mjs show  <meft>                      what the file binds now
//   [VERIFY_PORT=8090] tools/verify-lock.sh tools/run-playwright.sh tools/swap_asset.mjs list <meft>     print the slots and write <meft>.placements.json
//   node tools/swap_asset.mjs assets [text]                     print the asset registry (from the index `list` wrote), filtered by text
// The file is git-ignored (web/assets-hd/). The viewer's own choices (Slots panel) win over the file; "reset" in the panel = explicit default.
// Examples:  trees -> rocks on meft1013:  node tools/swap_asset.mjs set meft1013 trees.broadleaf built.cobble
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web/assets-hd/battle/built");
const [cmd, a1, a2, a3] = process.argv.slice(2);
const file = (m, ext) => path.join(DIR, `${m}.${ext}`);
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null);
const die = (m) => { console.error(m); process.exit(1); };
const pack = (m) => (/^meft\d+$/.test(m || "") ? m : die("arena must look like meft1013"));

if (cmd === "list") {
  const m = pack(a1);
  const { launch } = await import("./verify-launch.mjs");
  const { openViewer, grab } = await import("./verify_slots_frame.mjs");
  const browser = await launch();
  const { page } = await openViewer(browser, m);
  await page.waitForTimeout(1500); await grab(page, 1);
  const out = await page.evaluate(async () => {
    const R = await import("./built/registry.js");
    return { placements: window.__built.slots.exportPlacements(), slots: window.__built.slots.list(), assets: await R.listAllAssets() };
  });
  await browser.close();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file(m, "placements.json"), JSON.stringify(out.placements));
  fs.writeFileSync(path.join(DIR, "_assets.index.json"), JSON.stringify(out.assets));
  console.log(`${m}: ${out.slots.length} slots, ${out.assets.length} assets (placements -> ${path.relative(process.cwd(), file(m, "placements.json"))})`);
  for (const s of out.slots) console.log(`  ${s.id.padEnd(18)} ${s.kind.padEnd(14)} n=${String(s.count).padEnd(7)} ${s.bound ? "bound " + s.bound : ""}`);
} else if (cmd === "assets") {
  const idx = readJson(path.join(DIR, "_assets.index.json")) || die("no asset index yet: run `list <meft>` first");
  const q = (a1 || "").toLowerCase();
  const hit = idx.filter((a) => !q || `${a.id} ${a.name} ${a.source} ${a.kinds.join(" ")}`.toLowerCase().includes(q));
  for (const a of hit) console.log(`${a.id}\t${a.kinds.join(",")}\t${a.sourceGroup || a.source}\t${a.licence}\t${a.name}`);
  console.log(`${hit.length} of ${idx.length}`);
} else if (cmd === "set") {
  const m = pack(a1);
  const pl = readJson(file(m, "placements.json")) || die(`no ${m}.placements.json: run \`list ${m}\` first`);
  const idx = readJson(path.join(DIR, "_assets.index.json")) || die("no asset index: run `list` first");
  if (!pl.slots[a2]) die(`unknown slot ${a2}; slots: ${Object.keys(pl.slots).join(", ")}`);
  if (a3 !== "default" && !idx.some((a) => a.id === a3)) die(`unknown asset ${a3} (node tools/swap_asset.mjs assets <text>)`);
  const f = readJson(file(m, "slots.json")) || { arena: m, bind: {} };
  f.at ||= {};   // when each binding was written: the viewer's Reset hides file bindings older than its reset
  if (a3 === "default") { delete f.bind[a2]; delete f.at[a2]; } else { f.bind[a2] = a3; f.at[a2] = Date.now(); }
  fs.writeFileSync(file(m, "slots.json"), JSON.stringify(f, null, 1));
  console.log(`${m}: ${a2} -> ${a3}  (${Object.keys(f.bind).length} bound)`);
} else if (cmd === "reset") {
  const m = pack(a1), f = readJson(file(m, "slots.json"));
  if (!f) { console.log(`${m}: nothing bound`); process.exit(0); }
  if (a2) { delete f.bind[a2]; if (f.at) delete f.at[a2]; fs.writeFileSync(file(m, "slots.json"), JSON.stringify(f, null, 1)); } else fs.rmSync(file(m, "slots.json"));
  console.log(`${m}: reset ${a2 || "all"}`);
} else if (cmd === "show") {
  console.log(JSON.stringify(readJson(file(pack(a1), "slots.json")) || { bind: {} }));
} else die("usage: swap_asset.mjs list|assets|set|reset|show ... (see the file header)");
