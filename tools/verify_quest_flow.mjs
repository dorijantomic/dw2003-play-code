// Play whole quests through the real talk path, using the quest lab's hooks so nothing needs a normal playthrough:
// take the quest from its giver (the scene plays, the question is answered "yes"), talk to every character its objectives name,
// meet the rest of its goals, hand it in, and check it is done.
//
// Server: python3 -m http.server 8770 --directory web
// Run:    QUESTS=p_school_three_questions,a_gent_hat_mystery VERIFY_PORT=8770 tools/run-playwright.sh tools/verify_quest_flow.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baseUrl } from "./verify-base-url.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.QS_ROOT || `${baseUrl(8770)}/`;
const OUT = process.env.QS_SHOT || "/tmp/qs";
mkdirSync(OUT, { recursive: true });
const ids = (process.env.QUESTS || "p_school_three_questions").split(",").map((s) => s.trim()).filter(Boolean);
const defs = Object.fromEntries(JSON.parse(readFileSync(resolve(HERE, "../web/quests.json"), "utf8")).quests.map((d) => [d.id, d]));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
page.on("console", (m) => { if (/quest scene|\[quests\]/i.test(m.text())) console.log("console:", m.text()); });
await page.addInitScript(() => {
  localStorage.setItem("assetMode", "authentic"); localStorage.setItem("engineSchema", "2");
  localStorage.setItem("progressOrdinal", "3"); localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", "p005koet"); localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
  localStorage.setItem("packId", "B"); localStorage.setItem("bits", "5000"); localStorage.setItem("inventory", "[]");
});
const problems = [];
const expect = (ok, msg) => { console.log(ok ? "ok  " : "FAIL", msg); if (!ok) problems.push(msg); };
const shot = async (n) => { try { const c = await page.$("canvas#game"); writeFileSync(`${OUT}/${n}.png`, await c.screenshot()); } catch { /* page busy */ } };
const state = (id) => page.evaluate((id) => window.__quests.state.active[id] ?? null, id);
const done = (id) => page.evaluate((id) => !!window.__quests.state.done[id], id);

/** Stand in front of a character, press Enter, and click through whatever follows until the game is idle again. */
async function talkTo(tag, mapId, npcId) {
  const at = await page.evaluate(({ mapId, npcId }) => {
    const sc = window.__state.scenes[mapId];
    // the characters of a story-gated stage may not be standing here yet: keep one record of each, as the lab does
    const seen = new Set();
    sc.npcs = sc.npcs.filter((n) => { if (n.npc_id !== npcId) return true; if (seen.has(n.npc_id)) return false; seen.add(n.npc_id); n.spawn_flags = []; return true; });
    sc._cast = null;
    const n = sc.npcs.find((c) => c.npc_id === npcId);
    if (!n) return null;
    const s = window.__state; s.x = n.x; s.y = n.y + 36; s.dir = "up"; s.moving = false;
    return { x: n.x, y: n.y };
  }, { mapId, npcId });
  if (!at) return { missing: true };
  await page.waitForTimeout(900);
  await page.keyboard.press("Enter");
  const t0 = Date.now(); let n = 0, quiet = 0, maxMove = 0;
  while (Date.now() - t0 < 360000) {
    await page.waitForTimeout(500);
    const s = await page.evaluate(({ mapId, npcId }) => {
      const npc = window.__state.scenes[mapId]?.npcs?.find?.((c) => c.npc_id === npcId);
      return { cs: window.__cutscene.isActive(), tb: window.__textbox?.isOpen?.() ?? false, ch: window.__choice?.isOpen?.() ?? false, x: npc?.x, y: npc?.y };
    }, { mapId, npcId });
    if (s.x != null) maxMove = Math.max(maxMove, Math.hypot(s.x - at.x, s.y - at.y));
    if (n < 40) await shot(`${tag}-${String(++n).padStart(2, "0")}`);
    if (s.ch || s.tb) await page.keyboard.press("Enter");
    quiet = !s.cs && !s.tb && !s.ch ? quiet + 1 : 0;
    if (quiet >= 4) break;
  }
  return { at, maxMove: Math.round(maxMove) };
}

try {
  for (const id of ids) {
    const d = defs[id];
    if (!d) { expect(false, `${id} is in quests.json`); continue; }
    console.log(`\n== ${id}: ${d.title}`);
    const map = d.offer.maps[0];
    await page.goto(`${ROOT}?skipTitle=1&map=${map}&noEncounters=1&questlab=1`);
    await page.waitForFunction(() => window.__state?.started && window.__quests?.lab, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.evaluate(({ id, level }) => {
      window.__quests.lab.prepare(id);
      for (const p of [window.__state.partnerStats, ...(window.__state.partyStats ?? [])]) if (p && (p.level ?? 1) < level) p.level = level;
    }, { id, level: Math.max(d.unlock?.level ?? 1, 20) });
    const offer = await talkTo(`${id}-offer`, map, d.offer.npc);
    if (offer.missing) { expect(false, `${d.offer.name} is on ${map}`); continue; }
    expect(!!(await state(id)), `${id}: taken from ${d.offer.name} through the offer`);
    if (d.offer.scene?.some((s) => s.walk != null)) expect(offer.maxMove > 20, `${d.offer.name} walked during the offer (${offer.maxMove}px)`);
    // talk objectives
    for (const [i, o] of d.objectives.entries()) {
      if (o.type !== "talk") continue;
      const r = await talkTo(`${id}-talk${i}`, o.maps[0], o.npc);
      if (r.missing) { expect(false, `${o.name} is on ${o.maps[0]}`); continue; }
      const a = await state(id);
      expect(a?.p?.[i] === 1, `${id}: spoke to ${o.name}`);
    }
    // everything else is met through the lab
    await page.evaluate((id) => window.__quests.lab.finishGoals(id), id);
    await page.waitForTimeout(500);
    await page.goto(`${ROOT}?skipTitle=1&map=${map}&noEncounters=1&questlab=1`);
    await page.waitForFunction(() => window.__state?.started && window.__quests?.lab, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    await talkTo(`${id}-turnin`, map, d.offer.npc);
    expect(await done(id), `${id}: handed in and paid`);
  }
  expect(errors.length === 0, `no page errors (${errors.join("; ")})`);
} catch (error) {
  console.error("ERROR", error.message); problems.push(error.message);
  await shot("failure");
} finally { await browser.close(); }
console.log(problems.length ? `FAILED ${problems.length}` : "PASS");
process.exitCode = problems.length ? 1 : 0;
