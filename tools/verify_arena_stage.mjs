// Prove an ORDINARY battle paints its AREA's own arena: boot the real game at two
// different field screens, roll an ordinary walk-up encounter, and screenshot the
// battle. The arena id comes from the disc's own battle-trigger records (the trigger
// `param` -> 0x80042b28 -> SFSTDATA -> MEFT10<id>), resolved by the page through
// web/battle3d.js `setArenaStage(mapId, screenId)`.
//
//   python3 -m http.server 8743 --directory web
//   VERIFY_PORT=8743 tools/run-playwright.sh tools/verify_arena_stage.mjs [outdir]
//
// Before/after: each area is captured twice — the disc arena (after) and the
// pre-change generated grid (before, via the `setArenaStage(null)` debug clear).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "captures/playtest-2026-10-07-you";
mkdirSync(`${OUT}/before`, { recursive: true });
mkdirSync(`${OUT}/after`, { recursive: true });
const ROOT = baseUrl(Number(process.env.VERIFY_PORT || 8743));

const AREAS = [
  { map: "s330", name: "central-park", expect: 1,  what: "grassland (Central Park)" },
  { map: "s350", name: "wire-forest",  expect: 13, what: "forest (West Wire Forest)" },
];

const browser = await chromium.launch();
const steps = [];
const check = (n, ok, d = "") => { const l = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`; console.log(l); steps.push(l); return ok; };

/** Start an ordinary walk-up encounter on `map`. */
async function startBattle(page, map) {
  await page.addInitScript(() => localStorage.setItem("assetMode", "authentic"));
  await page.goto(`${ROOT}/index.html?skipTitle=1&map=${map}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__state?.started === true, null, { timeout: 40000 });
  await page.waitForTimeout(1200);
  // Dismiss the boot "Choose Visual Style" modal if it is up (it dims the whole scene).
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button, .opt, [role=button]")];
    const b = btns.find((x) => /authentic/i.test(x.textContent || ""));
    if (b) b.click();
  });
  await page.waitForTimeout(600);
  // skipTitle boots a new game, so the field has no downloaded party and the encounter
  // driver's `fieldPartySize > 0` gate (game.js:7469) stays shut. Inject the same starter
  // party the lab route uses (game.js:1473-1484) so an ordinary walk-up encounter can roll.
  await page.evaluate(() => {
    const s = window.__state;
    if (!s.party?.length) {
      s.party = ["p003pken", "p009rena", "p010pata"];
      s.packId = "A"; s.charId = "p003pken";
      // getPlayerProfile (battle.js:3061) needs state.charIdx > 0 as well as a digimonId.
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
    // Force the decoded step-counter beat: the driver runs when `_encTick % 8 == 0`, and a
    // zeroed counter expires on that run (game.js:7481-7498).
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
    check(`battle: an ordinary encounter starts on ${area.map} (${area.what})`, ok);
    if (!ok) { await page.close(); continue; }
    // Wait for the arena geometry to arrive (fetch) and the first arena frame to draw.
    await page.waitForFunction((id) => {
      const a = window.__battle3d?.arenaStage;
      return a && a.arenaId === id && a.loadedGroups > 0;
    }, area.expect, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const stage = await page.evaluate(() => window.__battle3d?.arenaStage ?? null);
    check(`arena: ${area.map} selects the disc arena id ${area.expect}`, stage?.arenaId === area.expect,
      JSON.stringify(stage));
    await page.screenshot({ path: `${OUT}/after/arena_${area.name}.png` });
    console.log(`shot ${OUT}/after/arena_${area.name}.png`);
    // BEFORE: the same battle with the disc arena cleared — the pre-change generated grid.
    await page.evaluate(() => window.__battle3d?.setArenaStage?.(null, null));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/before/arena_${area.name}.png` });
    console.log(`shot ${OUT}/before/arena_${area.name}.png`);
    await page.close();
  }

  check("production: no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("arena capture ran to completion", false, String(e));
} finally {
  await browser.close();
}

const fails = steps.filter((s) => s.startsWith("FAIL")).length;
writeFileSync(`${OUT}/arena-report.txt`, steps.join("\n") + `\n\n${fails} FAILURE(S)\n`);
console.log(`\n${fails === 0 ? "ALL STEPS PASSED" : `${fails} FAILURE(S)`}`);
process.exit(fails === 0 ? 0 : 1);
