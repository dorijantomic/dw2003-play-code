// tools/verify_wild_loss.mjs — lose a RANDOM encounter and land on the title screen.
//
// The journey harness left the "walking loss" corner unexercised: the arena check
// (tools/verify_arena_loss.mjs) loses a story fight, but nothing drove a wild battle
// to its loss. The decoded rule is the same for every battle kind — wfightmn's mode-2
// exit (pro/wfightmn.s .L0x00002174-.L0x000021DC) is entered on the loss and has no
// battle-kind test, so a random encounter, a story boss and the arena finale all leave
// through `F0x800A7328` -> result byte 2 -> `[0x8004B440](0xE00, 0)` = the title
// screen — but "same rule, same code" is what this check exists to prove for the
// walking path, on the field's own trigger.
//
// The encounter is started by the walker's real field->battle handoff
// (`window.__fieldToBattle()` = triggerRandomEncounter, the step counter's own
// function), so the wipe, the battle start and the onLose callback are the shipping
// ones. The party is seeded at 1 HP so the wild enemy KOs it.
//
// Server: python3 -m http.server $PORT --directory web
// Run:    VERIFY_PORT=$PORT tools/run-playwright.sh tools/verify_wild_loss.mjs
// Shots:  WILD_LOSS_SHOT=<dir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const PORT = process.env.VERIFY_PORT || 8742;
const ROOT = process.env.WILD_LOSS_ROOT || `${baseUrl(Number(PORT))}/`;
const OUT = process.env.WILD_LOSS_SHOT || ".bunny-scratch/shots/wild-loss";
mkdirSync(OUT, { recursive: true });

const MAP = "s320";   // a single zone at rate level 4, the encounter-rate check's own map

const weak = {
  digimonId: 1, level: 1, xp: 0, tp: 0, hp: 1, maxHp: 1, mp: 0, maxMp: 0,
  stats: { str: 1, def: 0, spt: 0, wis: 0, spd: 1, chr: 0 },
  bonuses: {}, elemBonuses: {},
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("progressOrdinal", "3");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.weak));
  localStorage.setItem("partyStats", JSON.stringify([seed.weak]));
  localStorage.setItem("equipment", JSON.stringify([{}]));
  localStorage.setItem("rosterOwned", "1");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, { weak });

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`, await page.screenshot());

const state = () => page.evaluate(() => ({
  nav: performance.getEntriesByType("navigation")[0]?.type ?? null,
  battle: !!window.__battle?.isActive?.(),
  lossState: window.__battleB?.()?.state ?? null,
  fade: window.__battleB?.()?._loseFade ?? null,
  started: !!window.__state?.started,
  titleUp: (() => { const t = document.getElementById("title-screen"); return t ? !t.hidden : null; })(),
  titlePhase: window.__titleState?.()?.phase?.() ?? null,
  cutscene: !!window.__cutscene?.isActive?.(),
  textbox: !!window.__textbox?.isOpen?.(),
  bits: localStorage.getItem("bits"),
  partyHp: JSON.parse(localStorage.getItem("partyStats") || "null")?.map((m) => m.hp) ?? null,
})).catch((e) => ({ evalError: e.message }));

let failed = null;
const fail = (msg) => {
  if (failed) return;
  failed = msg;
  console.error("FAIL:", msg);
  shot("failure").catch(() => {});
};
const result = { errors };

try {
  await page.goto(`${ROOT}?skipTitle=1&map=${MAP}`);
  await page.waitForFunction(() => window.__state?.started && window.__engineBridge, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  // Record which start the field makes, so this check proves the RANDOM path
  // (battle.startRandom), not a story screen.
  await page.evaluate(() => {
    window.__wildStarts = [];
    const b = window.__battle;
    const orig = b.startRandom.bind(b);
    b.startRandom = (mapId, x, y, onWin, onFlee, onLose) => {
      window.__wildStarts.push({ mapId, x, y });
      return orig(mapId, x, y, onWin, onFlee, onLose);
    };
  });

  // The field's own encounter trigger: the function the step counter calls.
  await page.evaluate(() => window.__fieldToBattle());
  let deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await state()).battle) break;
    await page.waitForTimeout(80);
  }
  result.started = await page.evaluate(() => ({
    wild: window.__wildStarts ?? [],
    screenId: window.__battleB()?.screenId ?? null,
    enemy: window.__battleB()?.enemy?.profile?.name ?? null,
    hp: window.__battleB()?.player?.hp ?? null,
  }));
  await shot("01-wild-battle-start");
  if (!(await page.evaluate(() => !!window.__battle?.isActive?.()))) fail("the field trigger never launched a wild fight");
  if (!(result.started.wild.length >= 1)) fail("the battle did not start through battle.startRandom");

  // Let the fight resolve as a player would: press the ordinary Fight command; the
  // 1-HP party is KO'd by the wild enemy, which drives the production LOSE state.
  let guard = 0;
  let sawLossBeat = false;
  let sawAnnihilated = false;
  while (guard++ < 90) {
    const s = await state();
    if (s.battle) {
      if (s.lossState === 9) {
        sawLossBeat = true;
        if (!sawAnnihilated) {
          await shot("02-annihilated");
          sawAnnihilated = true;
          // Sample the fade per frame from inside the page: it is only ~10 ticks wide.
          await page.evaluate(() => {
            const log = [];
            const tick = () => {
              const b = window.__battleB?.();
              if (b && b.state === 9) {
                log.push([Number(b.timer.toFixed(4)), b._loseFade ?? null]);
                try { sessionStorage.setItem("wildLossFade", JSON.stringify(log)); } catch { /* full */ }
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
        }
      }
      await tap("Enter");
      await page.waitForTimeout(400);
      continue;
    }
    break;
  }
  result.sawLossBeat = sawLossBeat;
  if (!sawLossBeat) fail(`the party never reached the loss beat (state ${(await state()).lossState})`);

  const fadeLog = await page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem("wildLossFade") || "[]"); } catch { return []; }
  });
  result.fade = {
    frames: fadeLog.length,
    atEffectEnd: fadeLog.find(([, f]) => f > 0) ?? null,
    max: fadeLog.reduce((m, [, f]) => Math.max(m, f ?? 0), 0),
    last: fadeLog.at(-1) ?? null,
  };

  for (let i = 0; i < 20; i++) {
    if ((await state()).titleUp) break;
    if (i % 4 === 0) await shot(`03-beat-${String(i).padStart(2, "0")}`);
    await page.waitForTimeout(300);
  }

  await page.waitForFunction(
    () => (() => { const t = document.getElementById("title-screen"); return t && !t.hidden; })(),
    null, { timeout: 20_000 },
  ).catch(() => fail("the title screen never opened"));
  await page.waitForTimeout(900);
  result.after = await state();
  await shot("04-title");

  if (result.after.nav !== "navigate")
    fail(`the loss restarted the page (navigation=${result.after.nav}); the launch is a screen change`);
  if (result.after.titleUp !== true) fail("the title screen is not up after the loss");
  if (result.after.started !== false) fail("the game is still marked started, so the title cannot own the input");
  if (result.after.battle) fail("the battle is still active after the loss");
  if (result.after.cutscene) fail("a scene started after the loss (the field is never rebuilt)");
  if (result.after.textbox) fail("a text box is open after the loss");
  if (result.after.bits !== "1000") fail(`bits on the card changed: ${result.after.bits}`);
  if (JSON.stringify(result.after.partyHp) !== JSON.stringify([1]))
    fail(`the party's card record changed: ${JSON.stringify(result.after.partyHp)}`);
  if (!(result.fade.max > 0)) fail("no fade was drawn on the way to the title");
  if (result.fade.max < 0.9) fail(`the fade stopped at ${result.fade.max}, far short of black`);

  // The title answers: START opens the Start/Continue menu.
  await tap("i");
  await page.waitForTimeout(800);
  const menu = await page.evaluate(() => window.__titleState?.()?.phase?.() ?? null);
  await shot("05-title-menu");
  if (!menu) fail("the title screen published no phase");
  else if (menu !== "menu") fail(`START did not open the title menu (phase=${menu})`);

  if (errors.length) fail(`${errors.length} page error(s): ${errors.join(" | ")}`);
  console.log("RESULT", JSON.stringify({ ok: !failed, ...result }));
} catch (e) {
  await shot("failure").catch(() => {});
  fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
