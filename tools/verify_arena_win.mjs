// tools/verify_arena_win.mjs — the World Champ finale's WIN path, end to end.
//
// The finale chain (ARENA-C010/011/012): the desk hands the player to the arena
// floor (screen 632 -> s927 at master ordinal 0x2d), Kurt's PRE event arms 0x100c
// and fires the bank-0x74 launcher (record 0 = screen 262), and the WIN must set
// the battle's won flag so the POST row (event 1610, "I did it! I beat Kurt!")
// becomes eligible and its HANDOFF 631 carries the player back to the front desk
// (screen 631 -> s926 at 0x2d). tools/verify_arena_finale.mjs proves the reach and
// the fight start; this check proves the result consumer — the transition that
// closes the registration-to-return loop.
//
// The enemy HP is dropped to 1 only to shorten the fight; the won flag and the
// handoff under test come from the production battle callback and cutscene, not
// from an injected value.
//
// Server: python3 -m http.server 8742 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_arena_win.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.ARENA_WIN_ROOT || `${baseUrl(Number(process.env.VERIFY_PORT) || 8742)}/`;
const OUT = process.env.ARENA_WIN_SHOT || ".dw3-research/autonomous-plan/shots/arena-win";
mkdirSync(OUT, { recursive: true });

const KURT = 104;
const SCREEN = 262;
const WON_FLAG = 4663;

const lead = {
  digimonId: 39, level: 99, xp: 0, tp: 10, hp: 9999, maxHp: 9999, mp: 9999, maxMp: 9999,
  stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 },
  bonuses: {}, elemBonuses: {},
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  // The finale room and the return desk are the ordinal-0x2d alias of screens
  // 632/631, so the router needs the master ordinal at the post-game value.
  localStorage.setItem("progressOrdinal", "45");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead]));
  localStorage.setItem("equipment", JSON.stringify([{}]));
  localStorage.setItem("rosterOwned", "1");
}, { lead });

const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`, await page.screenshot());
const mapId = () => page.evaluate(() => window.__state.manifest.maps[window.__state.mapIdx].id);
const status = () => page.evaluate(() => ({
  battle: !!window.__battle?.isActive?.(),
  textbox: window.__textbox?.isOpen?.() ?? false,
  cutscene: window.__cutscene?.isActive?.() ?? false,
  won: !!window.__engine.state.flags.get(4663, 1),
  map: window.__state.manifest.maps[window.__state.mapIdx].id,
}));

let failed = null;
const fail = async (msg) => {
  failed = msg;
  console.error("FAIL:", msg);
  try { writeFileSync(`${OUT}/failure-state.json`, JSON.stringify(await status(), null, 2)); } catch { /* gone */ }
  await shot("failure").catch(() => {});
};

const result = { errors };
try {
  await page.goto(`${ROOT}?skipTitle=1&map=s927&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started && window.__engineBridge, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  result.start = await status();
  if (result.start.map !== "s927") await fail(`booted on ${result.start.map}, expected the finale room s927`);

  // Record what the bridge asks the host to fight, so the screen id is an observation.
  await page.evaluate(() => {
    window.__battlesStarted = [];
    const b = window.__battle;
    const orig = b.startParty.bind(b);
    b.startParty = (party, onWin, onLose, onFlee, meta) => {
      window.__battlesStarted.push({ screenId: meta?.screenId, size: party?.length ?? 0 });
      return orig(party, onWin, onLose, onFlee, meta);
    };
  });

  // WALK IN: s927's stage-entry arrival chain starts the challenge by itself
  // (arrival_candidates.json s927 candidate 0 = event 1608 on 0x100c clear) and its completion
  // arms the fight, which the bridge chains off the same arrival. No NPC is involved.
  await page.evaluate(() => { window.__gameSpeed = 8; });
  // onStageEnter returns nothing (it hands the row to the bridge's pump), so the proof
  // that the chain started is the fight launching on the loop below.
  await page.evaluate(() => window.__engineBridge.onStageEnter("s927"));
  const launchDeadline = Date.now() + 20_000;
  while (Date.now() < launchDeadline) {
    const st = await status();
    if (st.battle) break;
    if (st.textbox) await page.keyboard.press("Enter");
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  result.opened = await page.evaluate(() => {
    const b = window.__battleB();
    return { screenId: b?.screenId ?? null, state: b?.state ?? null, wonFlagBefore: window.__engine.state.flags.get(4663, 1) };
  });
  await shot("arena-battle-start");
  if (!(await page.evaluate(() => !!window.__battle?.isActive?.()))) await fail("the s927 PRE never launched the fight");
  if (result.opened.screenId !== SCREEN) await fail(`battle screen ${result.opened.screenId}, expected ${SCREEN}`);
  if (result.opened.wonFlagBefore) await fail("the won flag was already set before the fight");

  // Win with the ordinary FIGHT command. Each boss-party member is shortened to
  // 1 HP when the command menu returns, so a sequential gauntlet still ends.
  // The victory report is the native pro/stfgtrep screen (Phase 6.3): it reads
  // the pad's held word once per frame, so its pages need a held press rather
  // than the instant tap the menu states use.
  const hold = async (k, ms = 260) => {
    await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    await page.keyboard.up(k);
    await page.waitForTimeout(150);
  };
  let guard = 0;
  while (await page.evaluate(() => !!window.__battle?.isActive?.()) && guard++ < 90) {
    const st = await page.evaluate(() => {
      const b = window.__battleB?.();
      return {
        state: b?.state ?? null,
        active: !!window.__battle?.isActive?.(),
        nativeReport: window.__reportNative?.isOpen?.() === true,
      };
    });
    if (st.nativeReport) {
      await hold("Enter");
      continue;
    }
    if (st.state === 2) {
      await page.evaluate(() => { const b = window.__battleB(); if (b.enemy) b.enemy.hp = 1; });
      await tap("Enter");
    } else {
      await tap("Enter");
    }
    await page.waitForTimeout(320);
  }
  await page.waitForTimeout(400);
  result.afterFight = await status();
  await shot("arena-victory");
  if (result.afterFight.map !== "s927") await fail(`the fight left the arena floor early: ${result.afterFight.map}`);
  if (!result.afterFight.won) await fail("the finale win did not set the won flag 4663");

  // The win re-chains the POST row: event 1610, whose HANDOFF 631 returns the
  // player to the front desk (s926 at ordinal 0x2d).
  await page.evaluate(() => { window.__gameSpeed = 8; });
  const arriveDeadline = Date.now() + 30_000;
  let landed = null;
  while (Date.now() < arriveDeadline) {
    const st = await status();
    if (st.map === "s926") { landed = st; break; }
    if (st.textbox) await page.keyboard.press("Enter");
    await page.waitForTimeout(60);
  }
  await page.evaluate(() => { window.__gameSpeed = 1; });
  await page.waitForTimeout(300);
  result.landed = landed;
  await shot("arena-post-desk");
  if (!landed) await fail(`the POST victory event never handed off to the front desk; still on ${await mapId()}`);

  result.battles = await page.evaluate(() => window.__battlesStarted);
  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({ ok: !failed, ...result }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
