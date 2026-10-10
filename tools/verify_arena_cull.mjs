// Prove the arena back-face cull lets the decoded OPAQUE blend be applied without
// blackening the scene, by capturing the SAME battle under each arena draw mode:
//
//   alpha-unculled  : per-prim palette, composited with alpha, no cull   (pre-decode look)
//   opaque-unculled : per-prim palette, OPAQUE, no cull                  (the 14%-black regression)
//   opaque-culled   : per-prim palette, OPAQUE, the ported back-face cull (the shipped decode)
//   legacy          : one palette per atlas page, alpha                  (oldest look)
//
// The black-pixel fraction of each shot (game area) is measured against the rig frame
// for the same arena. The cull is the original's own NCLIP MAC0<=0 test on the display
// list, run at arena-draw time (web/battle3d.js arenaCullIndices).
//
//   python3 -m http.server 8743 --directory web
//   VERIFY_PORT=8743 tools/run-playwright.sh tools/verify_arena_cull.mjs [outdir]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "captures/playtest-2026-10-07-you/arena-cull";
const ROOT = baseUrl(Number(process.env.VERIFY_PORT || 8743));
const AREAS = [
  { map: "s330", name: "central-park", expect: 1,  what: "grassland (Central Park)" },
  { map: "s350", name: "wire-forest",  expect: 13, what: "forest (West Wire Forest)" },
  { map: "s555", name: "arena5",       expect: 5,  what: "arena 5" },
  { map: "s232", name: "arena20",      expect: 20, what: "arena 20" },
];
const MODES = [
  { name: "before-void",     dbg: { voidRaw: true, cull: false } },  // raw opaque colour key (predecessor regression)
  { name: "before-void-cull", dbg: { voidRaw: true, cull: true } },  // key black but back faces culled
  { name: "after",           dbg: {} },                              // shipped: key→bg, culled, opaque
  { name: "legacy",          dbg: { legacy: true } },
];
for (const m of MODES) mkdirSync(`${OUT}/${m.name}`, { recursive: true });

const browser = await chromium.launch();
const steps = [];
const check = (n, ok, d = "") => { const l = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`; console.log(l); steps.push(l); return ok; };

async function startBattle(page, map) {
  await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
  await page.goto(`${ROOT}/index.html?skipTitle=1&map=${map}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 40000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button, .opt, [role=button]")];
    const b = btns.find((x) => /authentic/i.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const s = window.__state;
    if (!s.party?.length) {
      s.party = ["p003pken", "p009rena", "p010pata"];
      s.packId = "A"; s.charId = "p003pken";
      const ci = s.manifest?.characters?.findIndex((c) => c.id === "p003pken") ?? -1;
      if (ci > 0) s.charIdx = ci;
      const block = (digimonId, hp, mp) => ({ digimonId, level: 5, xp: 0, tp: 0, hp, maxHp: hp, mp, maxMp: mp, bonuses: {}, elemBonuses: {} });
      s.partnerStats = block(1, 86, 38);
      s.partyStats = [s.partnerStats, block(7, 80, 40), block(8, 90, 55)];
    }
  });
  let active = await page.evaluate(() => !!window.__battle?.isActive?.());
  const dirs = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  for (let i = 0; i < 80 && !active; i++) {
    await page.evaluate(() => { if (window.__state) { window.__state._encTick = 0; window.__state._encCounter = 0; } });
    const k = dirs[i % dirs.length];
    await page.keyboard.down(k); await page.waitForTimeout(400); await page.keyboard.up(k);
    active = await page.evaluate(() => !!window.__battle?.isActive?.());
    await page.waitForTimeout(120);
  }
  return active;
}

try {
  const errors = [];
  for (const area of AREAS) {
    const page = await browser.newPage({ viewport: { width: 1140, height: 720 } });
    page.on("pageerror", (e) => errors.push(String(e.message)));
    const ok = await startBattle(page, area.map);
    check(`battle: an ordinary encounter starts on ${area.map}`, ok);
    if (!ok) { await page.close(); continue; }
    await page.waitForFunction((id) => {
      const a = window.__battle3d?.arenaStage;
      return a && a.arenaId === id && a.loadedGroups > 0;
    }, area.expect, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const stage = await page.evaluate(() => window.__battle3d?.arenaStage ?? null);
    check(`arena: ${area.map} selects the disc arena id ${area.expect}`, stage?.arenaId === area.expect,
      JSON.stringify(stage));
    for (const mode of MODES) {
      await page.evaluate((d) => window.__battle3d?.setArenaDebug?.(d), mode.dbg);
      await page.waitForTimeout(450);
      const p = `${OUT}/${mode.name}/arena_${area.name}.png`;
      await page.screenshot({ path: p });
      console.log(`shot ${p}`);
    }
    await page.close();
  }
  check("production: no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("arena cull capture ran to completion", false, String(e));
} finally {
  await browser.close();
}

const fails = steps.filter((s) => s.startsWith("FAIL")).length;
writeFileSync(`${OUT}/arena-cull-report.txt`, steps.join("\n") + `\n\n${fails} FAILURE(S)\n`);
console.log(`\n${fails === 0 ? "ALL STEPS PASSED" : `${fails} FAILURE(S)`}`);
process.exit(fails === 0 ? 0 : 1);
