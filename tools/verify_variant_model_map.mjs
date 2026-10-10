// Headless render check for the reported bug: a boss/variant species must load its
// OWN model, not the ordinary one it was aliased onto.
//
//   python3 -m http.server 8742 --directory web &
//   tools/run-playwright.sh tools/verify_variant_model_map.mjs [outDir]
//
// It drives the REAL renderer page (web/model-viewer.html -> web/battle3d.js) and the
// real name -> folder resolver, then compares the loaded geometry of two species that
// model_map.json once conflated.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.MODEL_VIEWER_URL || "http://127.0.0.1:8742/model-viewer.html";
const out = process.argv[2] || "/tmp/variant-model-map";
fs.mkdirSync(out, { recursive: true });

// Which folder each name resolves to (the shipped resolver), plus the asset bytes.
const CASES = [
  { name: "MasterTyrannomon", folder: "m124tirs" },
  { name: "MetalTyrannomon", folder: "m140mtrn" },
  { name: "Tyrannomon", folder: "m008tyra" },
];

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", (e) => console.error("PAGE", e));

  for (const c of CASES) {
    await page.goto(`${base}?model=${c.folder}`);
    await page.waitForFunction(
      () => window._model && window._model.num_bones > 0, null, { timeout: 20000 });
    const info = await page.evaluate(() => {
      const m = window._model;
      let verts = 0;
      for (const b of m.bones) verts += (b.verts || []).length;
      return { folder: m.folder, num_bones: m.num_bones, verts,
               firstVert: m.bones.flatMap((b) => b.verts || [])[0] || null };
    });
    // The shipped resolver (web/battle3d.js resolveModelFolder -> model_map.json).
    const resolved = await page.evaluate(async (name) => {
      const mod = await import("/battle3d.js");
      return mod.resolveModelFolder(name);
    }, c.name);
    await page.screenshot({ path: path.join(out, `${c.folder}.png`) });
    results.push({ ...c, ...info, resolved });
    console.log(`${c.name}: resolved ${resolved}; loaded ${info.folder} ` +
                `${info.num_bones} bones, ${info.verts} verts -> ${out}/${c.folder}.png`);
  }
} finally {
  await browser.close();
}

let fail = 0;
for (const r of results) {
  if (r.resolved !== r.folder) { console.error(`FAIL: ${r.name} resolved ${r.resolved}, want ${r.folder}`); fail++; }
  const texPath = path.resolve("web/assets/battle/textures", `${r.resolved}.png`);
  if (!fs.existsSync(texPath)) { console.error(`FAIL: no texture ${texPath}`); fail++; }
}
// Master Tyrannomon and Tyrannomon must be different geometry (different assets).
const [master, , tyra] = results;
if (master.verts === tyra.verts && JSON.stringify(master.firstVert) === JSON.stringify(tyra.firstVert)) {
  console.error("FAIL: Master Tyrannomon and Tyrannomon loaded identical geometry");
  fail++;
}
console.log(fail === 0 ? "OK: variant models resolve to their own packs" : `FAILED (${fail})`);
process.exit(fail === 0 ? 0 : 1);
