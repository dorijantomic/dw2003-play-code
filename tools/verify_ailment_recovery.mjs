// tools/verify_ailment_recovery.mjs — the POISON TICK and an AILMENT RECOVERY both run
// out of the one status-event pool, in the real battle, and the HUD pip follows.
//
// Authority: engine/dw3/battle-status-events.ts. Every timed effect is an entry in the
// 99-slot pool at 0x800a3868; FIGHTSTG_F0x8009ba4c fires the entry whose +0x02 has run
// out, and FIGHTSTG_F0x8009bda4 gives each one its duration. Poison is code 0x09, which
// 0x800a3800 KEEPS queued (its word is -1), so its consumer re-arms +0x02 with 1000
// (pro/wfightmn.s:2607-:2609) and the flag stays until a cure frees the entry. A frozen
// recovery is code 0x0a, whose word is 1, so the entry is freed on the fire and the
// record's +0x1c bit 0x02 goes with it (FIGHTSTG_F0x8009c330, pro/fightstg.s:26421-26443).
// The pip is FIGHTSTG_F0x800934f0: state 3 while +0x1c is set.
//
// The pool entry is a seeded prerequisite with a one-unit time, standing in for the long
// decoded duration so the branch is reachable inside one turn; the code under test is the
// production one (web/battle.js battleStatusEventAdvance).
//
// Run: VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_ailment_recovery.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { waitForCommandMenu } from "./verify-battle-wait.mjs";

const ROOT = process.env.REC_ROOT || `${baseUrl(8742)}/`;
const OUT = process.env.REC_SHOT || ".dw3-research/autonomous-plan/shots/ailment-recovery";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level, xp) => ({
  digimonId, level, xp, tp: 10, hp: 400, maxHp: 400, mp: 120, maxMp: 120,
  stats: { str: 200, def: 80, spt: 60, wis: 50, spd: 90, chr: 30 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("bits", "1000");
  localStorage.setItem("inventory", "[]");
}, { lead: member(1, 10, 0), rena: member(7, 10, 0), pata: member(8, 10, 0) });

let failed = null;
const fail = (m) => { failed = m; console.error("FAIL:", m); };
const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
    "base64"));
const read = () => page.evaluate(() => {
  const b = window.__battleB();
  const r = b.playerRecords[0];
  return {
    pips: window.__battle.debugPips(),
    hp: r.hp, maxHp: r.maxHp, ailments: Object.keys(r.ailments || {}),
    message: b.message, timeline: b._timelineMessage,
    pool: b.statusEvents.filter((e) => e.code).map((e) => [e.code.toString(16), e.time, e.side, e.slot]),
  };
});

try {
  await page.goto(`${ROOT}?skipTitle=1&map=s245&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await window.__battle.start({
      enemyId: 1, enemyLevel: 1, onWin: () => {}, onFlee: () => {}, onLose: () => {},
    });
  });
  await waitForCommandMenu(page);
  await page.evaluate(() => { const b = window.__battleB(); b.enemy.hp = 99999; b.enemy.maxHp = 99999; });

  // Both records reach the SAME pool, as they do at battle setup, so the seeded entry is
  // the array the production advance reads.
  await page.evaluate(() => {
    const b = window.__battleB();
    b.player.statusEvents = b.statusEvents;
    b.player.sideByte = 0;
    b.player.slot = 0;
  });
  const before = await read();
  if (JSON.stringify(before.pips.player) !== JSON.stringify([12, 60, 60]))
    fail(`healthy active pip before: ${JSON.stringify(before.pips.player)}`);

  // One whole action, page by page. The poison tick and the cure are each their OWN line
  // object, so the reader presses through the action's pages before the menu comes back.
  // The disc's poison word lives in the page SPEC (kind 15 / esmfight[0x55]); `b.message`
  // and `b._timelineMessage` are the walker's own flat text.
  const seen = new Set();
  let sawCure = false;
  const actOnce = async () => {
    await tap("Enter");
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(300);
      const probe = await page.evaluate(() => {
        const b = window.__battleB();
        const pages = b._timelinePages || [];
        return {
          text: `${b.message ?? ""}\n${b._timelineMessage ?? ""}`,
          poison: pages.some((p) => p.spec && p.spec.kind === 15),
          cure: pages.some((p) => `${p.text ?? ""}`.includes("recovered from")),
        };
      });
      for (const line of probe.text.split("\n")) if (line) seen.add(line);
      if (probe.poison) return true;
      if (probe.cure) sawCure = true;
      await tap("Enter");
    }
    return false;
  };

  // The CURE path, first, while no status page is still pending: FROZEN is code 0x0a,
  // whose pool word at 0x800a3800 is 1, so the entry is freed on the fire and the record
  // loses the ailment with it (FIGHTSTG_F0x8009c330, pro/fightstg.s:26421-:26443).
  await page.evaluate(() => {
    const b = window.__battleB();
    b.player.ailments.frozen = { power: 4 };
    b.statusEvents[1] = { code: 0x0a, time: 1, side: 0, slot: 0, payload: 0x1f, payload2: 0 };
  });
  const frozenSeeded = await read();
  if (!frozenSeeded.ailments.includes("frozen")) fail("the frozen prerequisite did not stick");
  seen.clear();
  sawCure = false;
  let sawRecovery = false;
  for (let i = 0; i < 8 && !sawRecovery; i++) {
    await actOnce();
    sawRecovery = sawCure
      && [...seen].some((line) => line.includes("recovered from frozen"));
  }
  const after = await read();
  if (!sawRecovery) fail(`no "recovered from frozen" line: ${JSON.stringify([...seen])}`);
  if (after.ailments.includes("frozen"))
    fail(`the record still carries frozen: ${JSON.stringify(after.ailments)}`);
  const frozenLeft = await page.evaluate(() => window.__battleB().statusEvents
    .filter((e) => e.code === 0x0a).length);
  if (frozenLeft !== 0) fail(`code 0x0a's slot must be freed on the fire: ${frozenLeft} left`);
  if (after.pips.player[0] !== 12)
    fail(`with frozen gone the active pip must be the healthy one, 12: ${after.pips.player[0]}`);
  await shot("recovery-cleared");

  // Now the poison tick, staged the way `applyAilment` stages it: code 0x09 at 1000.
  await page.evaluate(() => {
    const b = window.__battleB();
    b.player.ailments.poison = { power: 4 };
    b.statusEvents[2] = { code: 0x09, time: 1000, side: 0, slot: 0, payload: 0x1e, payload2: 0 };
  });
  const hpBefore = (await read()).hp;
  if (hpBefore !== 400) fail(`the cure half must not have cost HP: ${hpBefore}`);
  seen.clear();
  let poisonTicked = false;
  for (let i = 0; i < 8 && !poisonTicked; i++) poisonTicked = await actOnce();
  const ticked = await read();
  if (!poisonTicked) fail(`no kind-15 poison page: ${JSON.stringify(ticked)}`);
  if (!(ticked.hp < hpBefore)) fail(`the poison tick did no damage: ${hpBefore} -> ${ticked.hp}`);
  if (!ticked.ailments.includes("poison")) fail("code 9 keeps its slot, so the flag must stay");
  if (ticked.pips.player[0] !== 15)
    fail(`the poisoned plate must be back on the active pip: ${ticked.pips.player[0]}`);
  const rearmed = await page.evaluate(() => window.__battleB().statusEvents
    .filter((e) => e.code === 0x09).map((e) => e.time));
  if (rearmed.length !== 1)
    fail(`the poison entry must survive its own fire: ${JSON.stringify(rearmed)}`);
  await shot("poison-ticked");

  if (errors.length) await fail(`${errors.length} page error(s)`);
  console.log("RESULT", JSON.stringify({
    ok: !failed, before: before.pips.player, after: after.pips.player,
    hp: [hpBefore, ticked.hp, after.hp], ailments: after.ailments, message: after.message,
    rearmed,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
