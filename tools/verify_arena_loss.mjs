// tools/verify_arena_loss.mjs — lose the World Champ finale and land on the title screen.
//
// The decoded loss exit is one rule for every battle kind, because wfightmn's mode-2
// tick is entered on the loss and not on a battle kind (pro/wfightmn.s, base 0x800a5de0):
//
//   .L0x00002174  jal 0x800a7328      the battle-hold release, before the result is read
//   .L0x00002198  beq $v1, $s0, .L0x000021cc    result byte 2 -> the launch tail
//   .L0x000021cc  lui $v0, 0x8005
//   .L0x000021d0  lw  $v0, -0x4bc0($v0)        [0x8004b440] = F0x80016b88
//   .L0x000021d8  jalr $v0                     launch(0xE00, 0) -> the TITLE SCREEN
//
// There is no field-restore branch on that arm: the arena floor is never rebuilt, no
// scene fires, the won flag stays clear and nothing is written to the card. So this
// script drives a real loss (the production LOSE state, reached by pressing Fight and
// letting the boss party KO the 1-HP party) and asserts the player is left looking at
// the title screen, with the page never restarted.
//
// This REPLACES the old version of this file, which asserted the opposite — that the
// arena floor survived the loss and the challenge was replayable. That was the
// walker's own invention; see .bunny-scratch/prior/arriveonce-report.md §1b, which
// re-read the assembly and settled it the other way, and §9.3 (this script was left red).
//
// Server: python3 -m http.server $PORT --directory web
// Run:    VERIFY_PORT=$PORT tools/run-playwright.sh tools/verify_arena_loss.mjs
// Shots:  ARENA_LOSS_SHOT=<dir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const PORT = process.env.VERIFY_PORT || 8742;
const ROOT = process.env.ARENA_LOSS_ROOT || `${baseUrl(Number(PORT))}/`;
const OUT = process.env.ARENA_LOSS_SHOT || ".bunny-scratch/shots/arena-loss";
mkdirSync(OUT, { recursive: true });

const KURT = 104;
const SCREEN = 262;
const WON_FLAG = 4663;

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
  localStorage.setItem("progressOrdinal", "45");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.weak));
  localStorage.setItem("partyStats", JSON.stringify([seed.weak]));
  localStorage.setItem("equipment", JSON.stringify([{}]));
  localStorage.setItem("rosterOwned", "1");
  localStorage.setItem("bits", "1000");
}, { weak });

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`, await page.screenshot());

const state = () => page.evaluate(({ won, armed }) => ({
  // `navigate` throughout: the loss must not restart the page (that is what put the
  // walker's own loading panel between the fade and the title).
  nav: performance.getEntriesByType("navigation")[0]?.type ?? null,
  battle: !!window.__battle?.isActive?.(),
  lossState: window.__battleB?.()?.state ?? null,
  fade: window.__battleB?.()?._loseFade ?? null,
  started: !!window.__state?.started,
  titleUp: (() => { const t = document.getElementById("title-screen"); return t ? !t.hidden : null; })(),
  titlePhase: window.__titleState?.()?.phase?.() ?? null,
  cutscene: !!window.__cutscene?.isActive?.(),
  textbox: !!window.__textbox?.isOpen?.(),
  won: !!window.__engine?.state?.flags?.get(won, 1),
  armed: !!window.__engine?.state?.flags?.get(armed, 1),
  bits: localStorage.getItem("bits"),
  partyHp: JSON.parse(localStorage.getItem("partyStats") || "null")?.map((m) => m.hp) ?? null,
}), { won: WON_FLAG, armed: 0x100c }).catch((e) => ({ evalError: e.message }));

let failed = null;
const fail = (msg) => {
  if (failed) return;
  failed = msg;
  console.error("FAIL:", msg);
  shot("failure").catch(() => {});
};
const result = { errors };

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s927&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started && window.__engineBridge, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    window.__battlesStarted = [];
    const b = window.__battle;
    const orig = b.startParty.bind(b);
    b.startParty = (party, onWin, onLose, onFlee, meta) => {
      window.__battlesStarted.push({ screenId: meta?.screenId, size: party?.length ?? 0 });
      return orig(party, onWin, onLose, onFlee, meta);
    };
  });

  // Walking into the arena floor IS the trigger: the stage-entry arrival chain plays the
  // challenge (event 1608 on 0x100c clear) and its completion arms the fight.
  await page.evaluate(() => { window.__gameSpeed = 8; });
  await page.evaluate(() => window.__engineBridge.onStageEnter("s927"));
  let deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await state()).battle) break;
    await tap("Enter");
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  result.started = await page.evaluate(() => ({
    screenId: window.__battleB()?.screenId ?? null,
    hp: window.__battleB()?.player?.hp ?? null,
  }));
  await shot("01-arena-battle-start");
  if (!(await page.evaluate(() => !!window.__battle?.isActive?.()))) fail("the s927 PRE never launched the fight");
  if (result.started.screenId !== SCREEN) fail(`battle screen ${result.started.screenId}, expected ${SCREEN}`);

  // Let the fight resolve as a player would: press the ordinary Fight command; the
  // 1-HP party is KO'd by the boss party, which drives the production LOSE state.
  // The defeat beat and its fade run INSIDE this loop, so watch for the beat here.
  let guard = 0;
  let sawLossBeat = false;
  let sawAnnihilated = false;
  while (guard++ < 60) {
    const s = await state();
    if (s.battle) {
      if (s.lossState === 9) {
        sawLossBeat = true;
        if (!sawAnnihilated) {
          await shot("02-annihilated");
          sawAnnihilated = true;
          // The fade is only ~10 ticks wide, so sample it per frame from inside the
          // page rather than over the wire: this poll cannot catch it.
          await page.evaluate(() => {
            const log = [];
            const tick = () => {
              const b = window.__battleB?.();
              if (b && b.state === 9) {
                log.push([Number(b.timer.toFixed(4)), b._loseFade ?? null]);
                try { sessionStorage.setItem("arenaLossFade", JSON.stringify(log)); } catch { /* full */ }
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

  // The fade to black: esmfight 0x53 holds for 0xF0 delta units, then the subtractive
  // quad rises to full black over 10 ticks. Read the per-frame record the page kept.
  const fadeLog = await page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem("arenaLossFade") || "[]"); } catch { return []; }
  });
  result.fade = {
    frames: fadeLog.length,
    first: fadeLog[0] ?? null,
    atEffectEnd: fadeLog.find(([, f]) => f > 0) ?? null,
    max: fadeLog.reduce((m, [, f]) => Math.max(m, f ?? 0), 0),
    last: fadeLog.at(-1) ?? null,
  };
  const sawFade = result.fade.max;
  // The screen is black for a few ticks and then the title opens. Sample the way
  // through so a "black" capture exists as proof, not just a number.
  for (let i = 0; i < 20; i++) {
    if ((await state()).titleUp) break;
    if (i % 4 === 0) await shot(`03-beat-${String(i).padStart(2, "0")}`);
    await page.waitForTimeout(300);
  }

  // The title screen, on the same page.
  await page.waitForFunction(
    () => (() => { const t = document.getElementById("title-screen"); return t && !t.hidden; })(),
    null, { timeout: 20_000 },
  ).catch(() => fail("the title screen never opened"));
  await page.waitForTimeout(900);
  result.after = await state();
  await shot("04-title");

  // ── What the player is left looking at, and what the disc leaves behind ──
  if (result.after.nav !== "navigate")
    fail(`the loss restarted the page (navigation=${result.after.nav}); the launch is a screen change`);
  if (result.after.titleUp !== true) fail("the title screen is not up after the loss");
  if (result.after.started !== false)
    fail("the game is still marked started, so the title cannot own the input");
  if (result.after.battle) fail("the battle is still active after the loss");
  if (result.after.cutscene) fail("a scene started after the loss (the field is never rebuilt)");
  if (result.after.textbox) fail("a text box is open after the loss");
  if (result.after.won) fail("a lost fight set the won flag 4663");
  // F0x800a7328 writes no card, so the money and the party on storage are untouched.
  if (result.after.bits !== "1000") fail(`bits on the card changed: ${result.after.bits}`);
  if (JSON.stringify(result.after.partyHp) !== JSON.stringify([1]))
    fail(`the party's card record changed: ${JSON.stringify(result.after.partyHp)}`);
  // And the fade really ran toward black before the title, not after it. The top
  // sample is 0.9 rather than 1.0 only because a headless frame is ~6 delta units
  // long, so the beat jumps from 0.9 straight to the exit; at 60fps it draws full
  // black for the three ticks the original holds it.
  if (!(sawFade > 0)) fail("no fade was drawn on the way to the title");
  if (result.fade.max < 0.9) fail(`the fade stopped at ${result.fade.max}, far short of black`);

  // The title answers: START opens the Start/Continue menu, so the player is really
  // standing on the title screen and not looking at a frozen canvas.
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
