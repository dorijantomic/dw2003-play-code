// Headless battle check: does each reported species actually appear in a fight?
//
// Drives the REAL battle renderer (web/battle3d.js, web/battle-lab.html) in
// headless Chromium. For each species it:
//   1. resolves the species NAME through the loader's own path
//      (resolveModelFolder -> model_map.json) and records the folder;
//   2. hands that folder to the renderer as the enemy fighter;
//   3. reads the renderer's own report (getAnimationReadout().enemy) — null
//      means the model never loaded, i.e. the fighter is invisible;
//   4. counts non-background canvas pixels with the enemy present vs cleared,
//      a frame diff showing the model is on screen.
//
//   python3 -m http.server 8791 --directory web &
//   VERIFY_PORT=8791 tools/run-playwright.sh tools/verify_battle_model_presence.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = baseUrl(Number(process.env.VERIFY_PORT || 8791));
const OUT = process.argv[2] ?? ".dw3-research/missing-battle-models-2026-10-08";
const SPECIES = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ["Tapirmon", "Triceramon", "Triceramon2", "Crabmon", "Apemon", "Whamon", "Machinedramon", "Piedmon"];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = [];
const check = (n, ok, d = "") => {
  const l = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  console.log(l);
  results.push({ name: n, ok, detail: d });
  return ok;
};

const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
page.on("pageerror", (e) => console.log("JS ERR", e.message));
await page.goto(`${ROOT}/battle-lab.html`, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!window.__r, null, { timeout: 40000 });
// Frame both fighters: the director's opening shot is our own Digimon's, which
// leaves the enemy a sliver at the edge; the debug orbit camera shows the pair.
await page.evaluate(() => { const c = document.getElementById("cam"); if (c) c.value = "orbit"; });

// Raw canvas pixels, for a present-vs-cleared frame diff.
async function canvasPixels() {
  return page.evaluate(() => {
    const cv = document.getElementById("cv");
    return Array.from(cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data);
  });
}
// How many pixels differ between two frames — the model changes the picture.
function diffPixels(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

for (const name of SPECIES) {
  // 1. loader's own name -> folder resolution, through the shipped module.
  const folder = await page.evaluate(async (nm) => {
    const m = await import("./battle3d.js");
    return m.resolveModelFolder(nm);
  }, name);
  if (!folder) { check(`${name} resolves to a model`, false, "resolveModelFolder -> null (invisible)"); continue; }
  check(`${name} resolves to a model`, true, folder);

  // Clear OUR side so the enemy model is the only fighter drawn — an unambiguous
  // receipt, and a frame diff that isolates the enemy.
  await page.evaluate(() => { window.__r.setPlayerDigimon(""); window.__r.setEnemyDigimon(""); });
  await page.waitForTimeout(400);
  const clearedPixels = await canvasPixels();
  await page.screenshot({ path: resolve(OUT, `${name}-enemy-cleared.png`) });

  // 2. hand the resolved folder to the real renderer as the enemy fighter.
  await page.evaluate((f) => window.__r.setEnemyDigimon(f), folder);
  await page.waitForTimeout(900);

  // 3b. the renderer's own report: a loaded fighter has a non-null enemy readout.
  const report = await page.evaluate(() => {
    const a = window.__r.getAnimationReadout?.();
    return a ? { enemy: a.enemy, player: a.player } : null;
  });
  const enemy = report?.enemy ?? null;
  check(`${name}: renderer loaded the enemy fighter`, !!enemy,
        enemy ? `clip ${enemy.clip} frame ${enemy.frame}` : "getAnimationReadout().enemy = null");

  // 4. frame diff: the enemy model changes the picture vs the cleared frame.
  const presentPixels = await canvasPixels();
  const changed = diffPixels(presentPixels, clearedPixels);
  await page.screenshot({ path: resolve(OUT, `${name}-enemy-present.png`) });
  console.log(`      [frame diff] ${changed} pixels changed present-vs-cleared`);
}

writeFileSync(resolve(OUT, "headless-battle-report.json"),
  JSON.stringify(results, null, 2) + "\n");
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
