// Journey 7 producer: the s820 Spy Satellite terminal fight is reachable, and
// the stage's own aftermath advances the story to the post-game ordinal 43.
//
// The stage's cast list (descriptor +0x4C = 0x800A7640) carries npc 213 at
// (336,232) with spawn gate flag 0x6029 = ordinal 41. The run-scan NPC extractor
// dropped it (nid cap 200; ptrB=0), so the walker's scene had no actor and the
// talk battle could never fire. The extractor now also decodes the cast list for
// the npc ids the stage's own OnTalk events address
// (wstag_extract.extract_cast + the gen_scenes wiring).
//
// Two legs, each a fresh page load, ordinary input, only prerequisites seeded
// (story ordinal 41 = the boss's own cast gate, and a party):
//
//   leg 1 — ARRIVING at s820 at step 41 is the trigger: the stage's entry object
//   starts the PRE (event 1060, flag 0151000f) on its own — auto_event_gates.json
//   gates it `ordinal==41 AND 0x4074==0`, read from wstag820.s .L0x2d0-.L0x35c,
//   the overlay's single start_event call, and no talk handler calls it — and the
//   bridge re-raises the entry to launch its battle row StartBattle(33, flag 4662).
//   The battle is left running (winning it headless takes ~45 s of real-time
//   animation, over this check's budget; the launch is the producer under test).
//
//   leg 2 — with that beat already seen (its once bit seeded, exactly what a save
//   carries), step into the act-2 cell at (384,256): the OnStep row
//   s820.step.evt1080 fires event 1080 (flag 01510011), whose raw on-complete
//   hook sets the post-game ordinal 43 + flag 0x7401 (29697); the walker's
//   stage ladder byStage.s820=[43] applies the ordinal. Its script walks the
//   boss off (SETPOS 213 0 0).
//
// Server: python3 -m http.server 8741 --directory web
// Run:    .opencode/autonomy/check-browser tools/verify_postgame_terminal_fight.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const BASE = process.env.FIGHT_ROOT || `${baseUrl(Number(process.env.VERIFY_PORT) || 8741)}/`;
const OUT = process.env.FIGHT_SHOT || ".bunny-scratch/postgame-terminal-fight";
mkdirSync(OUT, { recursive: true });

const member = (digimonId, level) => ({
  digimonId, level, xp: 0, tp: 5,
  hp: 300, maxHp: 300, mp: 60, maxMp: 60,
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
let failed = null;
const fail = (msg) => { failed = msg; console.error("FAIL:", msg); };

async function newGamePage(seed, ordinal, firedRows = []) {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  page.on("pageerror", (e) => { console.error("PAGEERROR", e.message); fail(`page error: ${e.message}`); });
  const fired = [];
  page.on("console", (m) => {
    const hit = m.text().match(/EVENT FIRED (\S+)/);
    if (hit) fired.push(hit[1]);
  });
  await page.addInitScript((s) => {
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p005koet");
    localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
    localStorage.setItem("packId", "B");
    localStorage.setItem("bits", "1000");
    localStorage.setItem("inventory", "[]");
    localStorage.setItem("progressOrdinal", String(s.ordinal));
    localStorage.setItem("engineEvents", JSON.stringify(s.firedRows));
    localStorage.setItem("partnerStats", JSON.stringify(s.lead));
    localStorage.setItem("partyStats", JSON.stringify([s.lead, s.rena, s.pata]));
    localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  }, { lead: member(3, 30), rena: member(7, 30), pata: member(8, 30), ordinal, firedRows });
  const shot = async (name) => writeFileSync(
    `${OUT}/${name}.png`,
    Buffer.from(
      (await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1],
      "base64",
    ),
  );
  await page.goto(`${BASE}?skipTitle=1&map=s820&noEncounters=1`);
  await page.waitForFunction(() => window.__state?.started && window.__engine, null, { timeout: 15_000 });
  await page.waitForTimeout(600);
  return { page, fired, shot };
}

try {
  // ── leg 1: the boss actor + talking to it launches the battle ──────────────
  const l1 = await newGamePage(null, 41);
  const npcs = await l1.page.evaluate(() => window.__npcsHere());
  const boss = (npcs || []).find((n) => n.npc_id === 213);
  if (!boss) throw new Error(`npc 213 is not in the s820 scene: ${JSON.stringify(npcs)}`);
  if (boss.x !== 336 || boss.y !== 232)
    await fail(`boss at ${boss.x},${boss.y}, expected the cast record's 336,232`);
  await l1.shot("terminal-boss-present");

  // No walk and no talk: the beat starts on arrival (see the header).
  await l1.page.evaluate(() => { window.__gameSpeed = 8; });
  let launched = false;
  const launchDeadline = Date.now() + 15_000;
  while (Date.now() < launchDeadline) {
    const st = await l1.page.evaluate(() => ({
      battle: !!window.__battle?.isActive?.(),
      tb: window.__textbox?.isOpen?.() ?? false,
    }));
    if (st.battle) { launched = true; break; }
    if (st.tb) await l1.page.keyboard.press("Enter");
    await l1.page.waitForTimeout(40);
  }
  if (!l1.fired.includes("0151000f"))
    await fail(`the PRE row (event 1060) did not fire (fired=${JSON.stringify(l1.fired)})`);
  if (!launched) await fail(`arriving at step 41 never launched the battle (fired=${JSON.stringify(l1.fired)})`);
  const opened = await l1.page.evaluate(() => {
    const b = window.__battleB?.();
    return {
      screenId: b?.screenId ?? null,
      enemy: b?.enemy?.profile?.name ?? null,
      player: b?.player?.profile?.name ?? null,
      wonFlag: !!window.__engine.state.flags.get(4662, 1),
      ord: window.__engine.state.vars.get("$story.ordinal"),
    };
  });
  await l1.shot("terminal-battle-start");
  if (opened.screenId !== 33) await fail(`battle screen ${opened.screenId}, expected 33`);
  if (opened.wonFlag) await fail("the s820 won flag was already set before the fight");
  // Only s820's decoded owner event moves the story on: ordinal_owner.json gives s820
  // event 1080 -> 43 (wstag820.s .L0x372 store). The boss conversation 1060 and its
  // aftermath 1070 write no ordinal, so the beat leaves the walker on step 41.
  if (opened.ord !== 41)
    await fail(`ordinal after the PRE ${opened.ord}, expected 41 (event 1080 writes 43)`);
  await l1.page.close();

  // ── leg 2: the stage's aftermath advances the ordinal to 43 ───────────────
  // The boss beat starts on arrival, and its cutscene owns the player until it ends — so
  // leg 2 starts from the state that beat has already been seen: the once bit a save
  // carries (web/game.js:3599 seeds engineEventDone from localStorage). The beat's opening
  // scene is the arrival chain's own row (arrival_candidates.json s820 candidate 0 = event 1060),
  // so THAT is the once bit to mark as seen.
  const l2 = await newGamePage(null, 41, ["s820.auto.1060"]);
  await l2.page.evaluate(() => window.__tp(384, 256));
  await l2.page.waitForFunction(
    () => window.__cutscene?.isActive?.() ?? false, null, { timeout: 8_000 },
  ).catch(() => {});
  if (!l2.fired.includes("01510011"))
    await fail(`the OnStep event 1080 did not fire (fired=${JSON.stringify(l2.fired)})`);
  await l2.page.evaluate(() => { window.__gameSpeed = 8; });
  const t0 = Date.now();
  for (let i = 0; i < 700 && Date.now() - t0 < 20_000; i++) {
    await l2.page.keyboard.press("Enter");
    await l2.page.waitForTimeout(20);
    if (i % 25 === 0) {
      const s = await l2.page.evaluate(() => ({
        ord: window.__engine.state.vars.get("$story.ordinal"),
        cut: window.__cutscene?.isActive?.() ?? false,
        busy: window.__engineBridge?.isBusy?.() ?? null,
      }));
      if (s.ord === 43 || (!s.cut && !s.busy)) break;
    }
  }
  await l2.page.evaluate(() => { window.__gameSpeed = 1; });
  const after = await l2.page.evaluate(() => ({
    ord: window.__engine.state.vars.get("$story.ordinal"),
    flag29697: window.__engine.state.flags.get(29697, 1) === true,
    bossGone: !(window.__npcsHere() || []).some((n) => n.npc_id === 213),
    map: window.__state.manifest.maps[window.__state.mapIdx].id,
  }));
  await l2.page.waitForTimeout(300);
  await l2.shot("terminal-after-1080");
  if (after.ord !== 43) await fail(`event 1080 did not advance the ordinal to 43: ${JSON.stringify(after)}`);
  if (!after.flag29697) await fail("event 1080 did not set flag 0x7401 (29697)");
  await l2.page.close();

  console.log("RESULT", JSON.stringify({
    ok: !failed, boss, opened, ahead1080: after, fired1: l1.fired, fired2: l2.fired,
  }));
} catch (e) {
  await fail(e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
