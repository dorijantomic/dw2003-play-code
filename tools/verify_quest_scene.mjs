// A quest handed out by a scripted scene, played through the real talk path: Leomon walks over, speaks, asks, walks back;
// the quest is taken, its goal (learn the Kunemon form) is met, and the turn-in plays its own scene and pays.
//
// Server: python3 -m http.server 8770 --directory web
// Run:    VERIFY_PORT=8770 tools/run-playwright.sh tools/verify_quest_scene.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const ROOT = process.env.QS_ROOT || `${baseUrl(8770)}/`;
const OUT = process.env.QS_SHOT || "/tmp/qs";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
page.on("console", (m) => { if (/quest scene|\[quests\]/i.test(m.text())) console.log("console:", m.text()); });
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3"); localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet"); localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B"); localStorage.setItem("bits", "1000"); localStorage.setItem("inventory", "[]");
  if (!localStorage.getItem("dw.quests.v1")) {
    localStorage.setItem("dw.quests.v1", JSON.stringify({ v: 1, active: {}, done: { park_pest_control: 1, forest_gate_survey: 1, double_trouble_park: 1 }, visited: ["s330", "s940", "s331"], met: [], duelWins: 0, announced: {}, seen: {}, gen: { n: 0, def: null } }));
  }
});
const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };
const shot = async (n) => { const c = await page.$("canvas#game"); writeFileSync(`${OUT}/${n}.png`, await c.screenshot()); };
const quest = () => page.evaluate(() => JSON.parse(localStorage.getItem("dw.quests.v1")));
const leo = () => page.evaluate(() => { const n = window.__state.scenes.s330.npcs.find((c) => c.npc_id === 27); return { x: n.x, y: n.y }; });

async function talkToLeomon(tag) {
  await page.evaluate(() => { const s = window.__state; s.x = 923; s.y = 410; s.dir = "up"; s.moving = false; });
  await page.waitForTimeout(600);
  const home = await leo();
  const p0 = await page.evaluate(() => ({ x: window.__state.x, y: window.__state.y }));
  await page.keyboard.press("Enter");
  const t0 = Date.now(); let n = 0, sawWalk = false, maxDist = 0, playerMax = 0;
  while (Date.now() - t0 < 90000) {
    await page.waitForTimeout(450);
    const s = await page.evaluate(() => ({ cs: window.__cutscene.isActive(), tb: window.__textbox?.isOpen?.() ?? false, ch: window.__choice?.isOpen?.() ?? false }));
    const l = await leo();
    const pp = await page.evaluate(() => ({ x: window.__state.x, y: window.__state.y }));
    playerMax = Math.max(playerMax, Math.hypot(pp.x - p0.x, pp.y - p0.y));
    const d = Math.hypot(l.x - home.x, l.y - home.y); maxDist = Math.max(maxDist, d); if (d > 20) sawWalk = true;
    if (n < 60) await shot(`${tag}-${String(++n).padStart(2, "0")}`);
    if (s.ch || s.tb) await page.keyboard.press("Enter");
    if (!s.cs && !s.tb && !s.ch && n > 2) { await page.waitForTimeout(700); const s2 = await page.evaluate(() => window.__cutscene.isActive() || (window.__textbox?.isOpen?.() ?? false)); if (!s2) break; }
  }
  const p1 = await page.evaluate(() => ({ x: window.__state.x, y: window.__state.y }));
  return { sawWalk, maxDist, playerMax: Math.round(playerMax), playerBack: Math.round(Math.hypot(p1.x - p0.x, p1.y - p0.y)), home, end: await leo() };
}

try {
  await page.goto(ROOT + "?skipTitle=1&map=s330&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started && window.__playQuestScene, null, { timeout: 40000 });
  await page.waitForTimeout(2500);
  // the quest is offered once its unlock rules hold (the party level is high enough in this setup)
  await page.evaluate(() => { for (const p of [window.__state.partnerStats, ...(window.__state.partyStats ?? [])]) if (p) p.level = Math.max(p.level ?? 1, 8); });
  const a = await talkToLeomon("offer");
  console.log("  offer scene", JSON.stringify(a));
  expect(a.sawWalk && a.maxDist > 30, "Leomon walked away from his post during the offer");
  expect(Math.hypot(a.end.x - a.home.x, a.end.y - a.home.y) < 3, "and is back at his post afterwards");
  expect(a.playerMax > 40, `the player walked along with him (${a.playerMax}px)`);
  expect(a.playerBack < 4, `and is back where they started (${a.playerBack}px off)`);
  const q1 = await quest();
  console.log("  quest state", JSON.stringify(q1.active));
  expect(!!q1.active.leomon_kunemon_form, "the Kunemon-form quest was taken through the scene's own question");

  // meet the goal: the lead learns the form (what the victory screen does), then the scan notices it
  await page.evaluate(() => window.__extraRoster.learnAll([56]));
  await page.waitForTimeout(3500);
  const q2 = await quest();
  console.log("  after learning", JSON.stringify(q2.active));
  expect(q2.active.leomon_kunemon_form?.p?.[0] === 1, "learning the Kunemon form completed the objective");
  const b = await talkToLeomon("done");
  console.log("  done scene", JSON.stringify(b));
  const q3 = await quest();
  console.log("  done list", Object.keys(q3.done).join(","));
  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
} catch (error) {
  console.error("ERROR", error.message); problems.push(error.message);
  try { await shot("failure"); } catch { /* page may be gone */ }
} finally { await browser.close(); }
console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exitCode = problems.length ? 1 : 0;
