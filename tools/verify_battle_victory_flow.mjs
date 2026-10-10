import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

// End-to-end regression for the lethal battle presentation. Start the repository's battle server:
//   python3 -m http.server 8742 --directory web
// Then run:
//   tools/run-playwright.sh tools/verify_battle_victory_flow.mjs
// It pins HP mutation to the authored impact and verifies the native automatic
// Battle Won -> full-screen STFGTREP handoff.
const url = process.env.BATTLE_TEST_URL || `${baseUrl(8742)}/battle-test.html`;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("PAGE", error));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#formSel")?.options.length > 0);
  await page.selectOption("#playerSel", "4");
  await page.fill("#playerLevel", "99");
  await page.selectOption("#enemySel", "1");
  await page.fill("#enemyLevel", "1");
  await page.click("#startBtn");
  // The shared press (tools/verify-battle-wait.mjs) reads the line the battle is holding and
  // waits for the list to be built and reading the pad, which is what the three hand-rolled
  // waits did by hand -- and it also covers the loader retirement the middle one waited for.
  await waitForCommandMenu(page);
  // The six-row command list is the translated pro/fightstg screen. It opens a few
  // frames after the battle reaches the command state and only reads the pad once
  // its own session is built; a confirm sent before that is discarded. Wait for it.
  await page.waitForFunction(() => window.__battleCmdNative?.diagnostics?.().ready === true,
    null, { timeout: 30_000 });

  await page.evaluate(() => { window.__battleB().enemy.hp = 1; });
  const before = await page.evaluate(() => window.__battleB().enemy.hp);
  for (let i = 0; i < 8; i++) {
    if (await page.evaluate(() => window.__battleB?.()?.state === 7)) break;
    await page.evaluate(() => window.__battleTest.handleKey("enter"));
    await page.waitForTimeout(300);
  }
  await page.waitForFunction(() => window.__battleB?.()?.state === 7, { timeout: 30_000 });
  const duringWindup = await page.evaluate(() => ({
    hp: window.__battleB().enemy.hp,
    message: window.__battleB().message,
  }));

  await page.waitForFunction(() => window.__battleB?.().enemy.hp === 0, { timeout: 15_000 });
  const impact = await page.evaluate(() => ({
    hp: window.__battleB().enemy.hp,
    message: window.__battleB().message,
    active: window.__battle3d.coordinator.active,
  }));
  await page.waitForFunction(() => window.__battleB?.()?._resultReady === true, { timeout: 15_000 });
  const damage = await page.evaluate(() => window.__battleB().message);

  await page.evaluate(() => window.__battleTest.handleKey("enter"));
  const defeated = await page.evaluate(() => window.__battleB().message);
  await page.evaluate(() => window.__battleTest.handleKey("enter"));
  const won = await page.evaluate(() => ({
    state: window.__battleB().state,
    message: window.__battleB().message,
    phase: window.__battleB()._victoryPhase,
  }));

  await page.waitForFunction(() => window.__battleB?.()?._victoryReady === true, { timeout: 15_000 });
  await page.waitForFunction(() => window.__battleB?.()?._victoryPhase === "report", { timeout: 15_000 });
  await page.waitForTimeout(1600);
  const report = await page.evaluate(() => ({
    phase: window.__battleB()._victoryPhase,
    page: window.__battleB()._winPages?.[0]?.label,
    rows: window.__battleB()._winReportRows?.map((row) => row.name),
    canvas: (() => { const c = document.querySelector("#c"); const r = c.getBoundingClientRect(); return { width: c.width, height: c.height, cssWidth: r.width, cssHeight: r.height }; })(),
  }));
  if (process.env.VICTORY_SHOT) {
    const png = await page.locator("#c").evaluate((canvas) => canvas.toDataURL("image/png"));
    writeFileSync(process.env.VICTORY_SHOT, Buffer.from(png.split(",")[1], "base64"));
  }

  // The battle-specific lab also exposes the same real renderer directly for
  // visual iteration, without replaying a lethal attack on every adjustment.
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#formSel")?.options.length > 0);
  await page.click("#victoryBtn");
  await page.waitForFunction(() => window.__battleB?.()?._victoryPhase === "report", { timeout: 30_000 });
  const direct = await page.evaluate(() => ({
    rows: window.__battleB()._winReportRows?.length,
    slots: window.__battleB()._winReportRows?.map((row) => row.forms.length),
  }));

  const result = { before, duringWindup, impact, damage, defeated, won, report, direct };
  if (before !== 1 || duringWindup.hp !== 1 || impact.hp !== 0)
    throw new Error(`HP did not change at impact: ${JSON.stringify(result)}`);
  if (!/took \d+ damage!$/.test(damage) || !/has been defeated!$/.test(defeated))
    throw new Error(`Result messages are out of order: ${JSON.stringify(result)}`);
  if (won.message !== "Battle Won!" || won.phase !== "pose" || report.phase !== "report" || report.rows?.length !== 3)
    throw new Error(`Victory/report phases are out of order: ${JSON.stringify(result)}`);
  if (direct.rows !== 3 || direct.slots.some((count) => count !== 3))
    throw new Error(`Direct victory-report lab state is incomplete: ${JSON.stringify(result)}`);
  console.log(`battle victory flow OK: ${JSON.stringify(result)}`);
} finally {
  await browser.close();
}
