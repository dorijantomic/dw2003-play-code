// Verifier: the level curve and level-up rolls read the STARTER species' profile
// row (0x8003EF5C + slot*0x58), never the active form's row.
//
// The original, from the assembly (authority 2):
//   F0x80086184 reads growth_xp at `0x8003EF5C + slot*0x58 + 0x3E`
//     (recovered/ddw3/decomp/pro/stfgtrep/F0x80086184.c line 25; asm
//     pro/stfgtrep.s .L0x00003548 builds s4 = 0x8003EF5C + slot*0x58,
//     .L0x000035BC `lbu 0x3e($s4)`).
//   F0x80085E3C reads the growth bytes +0x41/+0x42/+0x43+i/+0x49+i from the same
//     row (.L0x000031EC builds s5, .L0x00003228/.L0x000032AC/.L0x0000338C/
//     .L0x00003434 read them).
//   Runtime cross-check: slot1_ram.bin slot0 stands in Dinohumon (record +0x04
//     = 0x182) with exp 2985 and level 15 — only the starter's growth_xp 8
//     gives level 15 (the form's 1 would give level 27).
//
// This verifier wins a real battle screen 200 (+4 EXP) twice through the real
// web/game.js and web/battle.js, on the same seed that caught the walker bug
// (level 10, xp 500):
//   1. lead standing in Dinohumon (id 9, growth_xp 1) with rookie Kotemon (id 1,
//      growth_xp 8). Pre-fix the walker applied the form's curve: level 16.
//      Post-fix: thr(11) = 1154 > 504 -> stays level 10, no level-up page, and
//      the native stfgtrep screen (which replays the disc's rules on its own
//      private record) agrees: level 10, exp 504.
//   2. control, lead standing as its own rookie (id 1): level 10 both ways.
// Every scenario also asserts report==applied agreement across four sources:
// the walker state (window.__state), the applied values (b._winNewLevel /
// b._winReportRows / b._winPages), and the native screen's private record.
//
// Server: python3 -m http.server 8793 --directory web   (VERIFY_PORT overrides)
// Run:    tools/run-playwright.sh tools/verify_levelup_growth_source.mjs
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = baseUrl(8793);
const SCREEN = 200;              // s200/Genji: reward record [1, 4, 50]
const REWARD_XP = 4;
const START_LEVEL = 10;
const START_XP = 500;

let failures = 0;
const check = (name, ok, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
  if (!ok) failures++;
};

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

async function runScenario(browser, label, leadId) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 480 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((seed) => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s245", x: 332, y: 390, dir: "left" }));
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
    localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
    localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
    localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
    localStorage.setItem("bits", "1000");
    localStorage.setItem("inventory", "[]");
  }, { lead: member(leadId, START_LEVEL, START_XP), rena: member(7, 10, 0), pata: member(8, 10, 0) });

  const tap = (k) => page.evaluate((kk) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
  }, k);
  const field = () => page.evaluate(() => {
    const s = window.__state;
    return {
      digimonId: s.partnerStats?.digimonId,
      leadLevel: s.partnerStats?.level,
      leadXp: s.partnerStats?.xp,
    };
  });

  const out = { label, errors };
  try {
    await page.goto(`${ROOT}/?skipTitle=1&map=s245&noEncounters=1`);
    await page.waitForFunction(() => window.__state?.started, null, { timeout: 40000 });
    await page.waitForTimeout(400);
    out.before = await field();

    await page.evaluate(async (screenId) => {
      window.__rewardResult = null;
      await window.__battle.start({
        enemyId: 1, enemyLevel: 1, screenId,
        onWin: (res) => { window.__rewardResult = res; },
        onFlee: () => { window.__rewardResult = { fled: true }; },
        onLose: () => { window.__rewardResult = { lost: true }; },
      });
    }, SCREEN);
    await waitForCommandMenu(page);
    await page.evaluate(() => { window.__battleB().enemy.hp = 1; });
    await tap("Enter"); // Fight
    let guardA = 0;
    while (await page.evaluate(() => window.__battleB?.()?.state) !== 8 && guardA++ < 40) {
      await tap("Enter");
      await page.waitForTimeout(400);
    }
    await page.waitForFunction(() => window.__battleB?.()?.state === 8, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__battleB?.()?._victoryPhase === "report", null, { timeout: 30000 });
    out.report = await page.evaluate(() => {
      const b = window.__battleB();
      return {
        applied: b._winApplied,
        reward: b._winReward,
        newLevel: b._winNewLevel,
        reportRows: (b._winReportRows ?? []).map((r) => ({ index: r.index, level: r.level, xp: r.xp })),
        partnerLevelPages: (b._winPages ?? []).filter((p) => p.kind === "partner-level").map((p) => p.value),
      };
    });
    // The native results screen (stfgtrep) replays the disc's rules on a private
    // record seeded from the PRE-battle snapshot; its diagnostics expose that
    // record — what the screen shows the player.
    await page.waitForFunction(() => {
      const d = window.__reportNative?.diagnostics?.();
      return !!(d && d.records && d.records[0]);
    }, null, { timeout: 20000 }).catch(() => {});
    out.nativeOpen = await page.evaluate(() => ({
      open: window.__reportNative?.isOpen?.() ?? null,
      reportNativeFlag: window.__battleB()._reportNative ?? null,
    }));
    // Skip through the report pages.
    let guard = 0;
    while (await page.evaluate(() => !!window.__battle?.isActive?.()) && guard++ < 25) {
      await page.keyboard.down("Enter");
      await page.waitForTimeout(600);
      await page.keyboard.up("Enter");
      await page.waitForTimeout(150);
    }
    await page.waitForFunction(() => !window.__battle?.isActive?.(), null, { timeout: 20000 });
    await page.waitForTimeout(400);
    out.after = await field();
    out.nativeRecord = await page.evaluate(() => {
      const d = window.__reportNative?.diagnostics?.();
      const r = (d?.records ?? [])[0];
      return r ? { level: r.level, exp: r.exp } : null;
    });
    out.onWin = await page.evaluate(() => window.__rewardResult);
  } catch (e) {
    out.fail = String(e);
  }
  await ctx.close();
  return out;
}

/** Assert one scenario's applied state, display data and native record agree. */
function checkScenario(out, { expectLevel, expectXp, expectLevelUp }) {
  const label = out.label;
  check(`${label}: no page errors`, out.errors.length === 0, out.errors.join("; "));
  check(`${label}: scenario completed`, !out.fail, out.fail ?? "");
  if (out.fail) return;
  check(`${label}: battle applied its rewards`, out.report?.applied === true);
  check(`${label}: reward is screen ${SCREEN}'s +${REWARD_XP} EXP`,
    out.report?.reward?.xp === REWARD_XP, JSON.stringify(out.report?.reward));
  check(`${label}: applied level is ${expectLevel} (was ${START_LEVEL})`,
    out.report?.newLevel === expectLevel, `got ${out.report?.newLevel}`);
  check(`${label}: levelUp flag is ${expectLevelUp}`,
    out.report?.reward?.levelUp === expectLevelUp);
  check(`${label}: partner-level pages == ${expectLevelUp ? "present" : "none"}`,
    expectLevelUp ? out.report?.partnerLevelPages?.length > 0
                  : out.report?.partnerLevelPages?.length === 0,
    JSON.stringify(out.report?.partnerLevelPages));
  check(`${label}: field state after the fight is level ${expectLevel}, xp ${expectXp}`,
    out.after?.leadLevel === expectLevel && out.after?.leadXp === expectXp,
    JSON.stringify(out.after));
  // Report == applied: the walker's report rows (what the native screen is
  // seeded from) carry the applied state.
  const row0 = out.report?.reportRows?.[0];
  check(`${label}: report row level/xp == applied state`,
    row0?.level === out.after?.leadLevel && row0?.xp === out.after?.leadXp,
    JSON.stringify(row0));
  // The native screen opened and its private record agrees with the walker —
  // display and state, compared to each other.
  check(`${label}: native stfgtrep screen opened`,
    out.nativeOpen?.open === true && out.nativeOpen?.reportNativeFlag === true,
    JSON.stringify(out.nativeOpen));
  check(`${label}: native record == walker applied state`,
    out.nativeRecord?.level === out.after?.leadLevel && out.nativeRecord?.exp === out.after?.leadXp,
    `native ${JSON.stringify(out.nativeRecord)} vs walker ${JSON.stringify(out.after)}`);
  check(`${label}: native record == disc expectation (level ${expectLevel}, exp ${expectXp})`,
    out.nativeRecord?.level === expectLevel && out.nativeRecord?.exp === expectXp,
    JSON.stringify(out.nativeRecord));
}

const browser = await chromium.launch({ headless: true });
// 1. The regression case: standing in Dinohumon (growth_xp 1), rookie Kotemon
//    (growth_xp 8). The starter's curve keeps the level at 10; the form's curve
//    (the pre-fix walker) jumped to 16.
const dino = await runScenario(browser, "Dinohumon-active (id 9, starter id 1)", 9);
checkScenario(dino, { expectLevel: 10, expectXp: START_XP + REWARD_XP, expectLevelUp: false });
// 2. Control: the same seed standing as its own rookie.
const kotemon = await runScenario(browser, "Kotemon-rookie (id 1)", 1);
checkScenario(kotemon, { expectLevel: 10, expectXp: START_XP + REWARD_XP, expectLevelUp: false });
await browser.close();

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
