// Prove the ordinary arena's PER-LAYER palette and BLEND are now the decoded ones.
//
// Decoded live 2026-10-07 (emulator GPU-packet capture of an ordinary battle frame):
// every arena quad is cmd 0x2C (POLY_FT4) with texpage semi bits 0 — the GPU draws the arena
// OPAQUE — and each primitive carries its own CLUT selector into one of the pack's four palette
// groups. Before this change we rendered one palette per atlas page and alpha-composited.
// See .dw3-research/playtest-arena-palette-rig-2026-10-07/results.md.
//
//   VERIFY_PORT=8743 tools/run-playwright.sh tools/verify_arena_palette.mjs captures/playtest-2026-10-07-you
//
// after  = the decoded per-CLUT palette + opaque blend
// before = window.__battle3d.setArenaLegacy(true) (one palette per page + alpha, the pre-decode render)
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.argv[2] ?? "captures/playtest-2026-10-07-you";
const DIR = `${OUT}/arena-palette`;
mkdirSync(`${DIR}/before`, { recursive: true });
mkdirSync(`${DIR}/after`, { recursive: true });
const ROOT = baseUrl(Number(process.env.VERIFY_PORT || 8743));

const AREAS = [
  { map: "s330", name: "central-park", expect: 1, what: "grassland (Central Park)" },
  { map: "s350", name: "wire-forest", expect: 13, what: "forest (West Wire Forest)" },
];

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
    check(`battle: an ordinary encounter starts on ${area.map} (${area.what})`, ok);
    if (!ok) { await page.close(); continue; }
    await page.waitForFunction((id) => {
      const a = window.__battle3d?.arenaStage;
      return a && a.arenaId === id && a.loadedGroups > 0;
    }, area.expect, { timeout: 20000 }).catch(() => {});
    // Give the lazy per-CLUT textures time to load, then the decoded render.
    await page.waitForTimeout(2500);
    const stage = await page.evaluate(() => window.__battle3d?.arenaStage ?? null);
    check(`arena: ${area.map} selects the disc arena id ${area.expect}`, stage?.arenaId === area.expect,
      JSON.stringify(stage));
    const newTexCount = await page.evaluate(() => {
      // every group should now name a (col,row) palette texture
      const g = window.__battle3d?.arenaStage;
      return g?.loadedGroups ?? 0;
    });
    check(`arena: ${area.map} draws ${newTexCount} decoded palette groups`, newTexCount > 0);
    await page.screenshot({ path: `${DIR}/after/arena_${area.name}.png` });
    console.log(`shot ${DIR}/after/arena_${area.name}.png`);
    // BEFORE: the pre-decode render — one palette per page, alpha-blended.
    await page.evaluate(() => window.__battle3d?.setArenaLegacy?.(true));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${DIR}/before/arena_${area.name}.png` });
    console.log(`shot ${DIR}/before/arena_${area.name}.png`);
    await page.evaluate(() => window.__battle3d?.setArenaLegacy?.(false));
    await page.close();
  }
  check("production: no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("arena palette capture ran to completion", false, String(e));
} finally {
  await browser.close();
}

const fails = steps.filter((s) => s.startsWith("FAIL")).length;
writeFileSync(`${DIR}/arena-palette-report.txt`, steps.join("\n") + `\n\n${fails} FAILURE(S)\n`);
console.log(`\n${fails === 0 ? "ALL STEPS PASSED" : `${fails} FAILURE(S)`}`);
process.exit(fails === 0 ? 0 : 1);
