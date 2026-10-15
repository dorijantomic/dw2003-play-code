// The "Messages for the park" chain through the real talk path: the old woman and the man in the yellow coat each walk over
// and speak (talk steps with scenes), then Leomon's turn-in scene pays. Starts with the quest already taken.
//
// Run: VERIFY_PORT=8770 tools/run-playwright.sh tools/verify_quest_chain.mjs
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
    localStorage.setItem("dw.quests.v1", JSON.stringify({ v: 1, active: { park_messages: { p: [0, 0], seen: [[], []], at: 1 } }, done: { park_pest_control: 1 }, visited: ["s330", "s940", "s331"], met: [], duelWins: 0, announced: { park_messages: 1 }, seen: {}, gen: { n: 0, def: null } }));
  }
});
const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };
const shot = async (n) => { const c = await page.$("canvas#game"); writeFileSync(`${OUT}/${n}.png`, await c.screenshot()); };
const quest = () => page.evaluate(() => JSON.parse(localStorage.getItem("dw.quests.v1")));
const npcAt = (id) => page.evaluate((id) => { const n = window.__state.scenes.s330.npcs.find((c) => c.npc_id === id); return n ? { x: n.x, y: n.y } : null; }, id);

async function talkTo(tag, id) {
  const home = await npcAt(id);
  if (!home) return { missing: true };
  await page.evaluate((h) => { const s = window.__state; s.x = h.x; s.y = h.y + 36; s.dir = "up"; s.moving = false; }, home);
  await page.waitForTimeout(700);
  await page.keyboard.press("Enter");
  const t0 = Date.now(); let n = 0, maxDist = 0, quiet = 0;
  while (Date.now() - t0 < 300000) {   // generous: a busy machine renders a few frames a second
    await page.waitForTimeout(450);
    const s = await page.evaluate(() => ({ cs: window.__cutscene.isActive(), tb: window.__textbox?.isOpen?.() ?? false, ch: window.__choice?.isOpen?.() ?? false }));
    const l = await npcAt(id); maxDist = Math.max(maxDist, Math.hypot(l.x - home.x, l.y - home.y));
    if (n < 30) await shot(`${tag}-${String(++n).padStart(2, "0")}`);
    if (s.ch || s.tb) await page.keyboard.press("Enter");
    quiet = !s.cs && !s.tb && !s.ch ? quiet + 1 : 0;
    if (process.env.QS_DEBUG) console.log(`    [${tag}] ${JSON.stringify(s)} npc=${Math.round(l.x)},${Math.round(l.y)} quiet=${quiet}`);
    if (quiet >= 4) break;
  }
  return { home, maxDist, end: await npcAt(id) };
}

try {
  await page.goto(ROOT + "?skipTitle=1&map=s330&noEncounters=1");
  await page.waitForFunction(() => window.__state?.started && window.__quests, null, { timeout: 40000 });
  await page.waitForTimeout(2500);
  // The old woman and the man in the yellow coat only stand here at some points of the story (their spawn flags). This test is
  // about the quest mechanics, so it keeps one record of each with no spawn condition. Test only: the game's data is untouched.
  await page.evaluate(() => {
    const sc = window.__state.scenes.s330, seen = new Set();
    sc.npcs = sc.npcs.filter((n) => { if (n.npc_id !== 58 && n.npc_id !== 102) return true; if (seen.has(n.npc_id)) return false; seen.add(n.npc_id); n.spawn_flags = []; return true; });
    sc._cast = null;   // the stage's cast is built once on entry; rebuild it from the patched records
  });
  await page.waitForTimeout(500);
  const a = await talkTo("old", 58);
  console.log("  old woman", JSON.stringify(a));
  expect(!a.missing, "the old woman is on the map");
  if (!a.missing) {
    expect(a.maxDist > 15, "she walked over");
    expect(Math.hypot(a.end.x - a.home.x, a.end.y - a.home.y) < 3, "and went home");
  }
  expect((await quest()).active.park_messages?.p?.[0] === 1, "the first message is delivered");
  const b = await talkTo("coat", 102);
  console.log("  yellow coat", JSON.stringify(b));
  expect(!b.missing, "the man in the yellow coat is on the map");
  expect((await quest()).active.park_messages?.p?.[1] === 1, "the second message is delivered");
  const c = await talkTo("turnin", 27);
  console.log("  leomon", JSON.stringify(c));
  const q = await quest();
  expect(!!q.done.park_messages, "reporting to Leomon finishes the quest and pays");
  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
} catch (error) {
  console.error("ERROR", error.message); problems.push(error.message);
  try { await shot("failure"); } catch { /* page may be gone */ }
} finally { await browser.close(); }
console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exitCode = problems.length ? 1 : 0;
