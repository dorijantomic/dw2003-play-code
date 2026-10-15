// tools/verify_epic_forge.mjs — the post-game Epic Weapon forge, driven end to end.
//
// WHAT THIS PROVES, AND AGAINST WHAT:
//   The walkthrough's forging board (quest a's gate) lives on the circuit boards. On
//   s974, Nohemon's Zodiac state (dialogue estalk09 index 160) gates on item 113
//   (Kaiser Fist) and its close grants item 117 (Zodiac) while consuming 113 and 116
//   (Rusty Glove) — the collection-bank on_close semantics. The NPC itself only exists
//   behind the walkthrough's "all 8 partners at level 45+" condition: spawn flags
//   0x7055 (all eight roster slots obtained) and 0x7095 (every obtained slot at level
//   >= 45, the walker's new every_owned_at_level predicate) plus the route pair
//   key==2 / companion==8.
//
//   The check boots with all eight partners at level 99 and the two inputs in the bag,
//   re-enters s974 through the route pair that places Nohemon, talks the forge, and
//   asserts the product is in the bag and both inputs are gone. Then it boots the same
//   fixture with one partner below 45 and proves the forger does NOT appear — the
//   negative leg that pins 0x7095.
//
// Run (the harness starts and stops its own server):
//   tools/run-playwright.sh tools/verify_epic_forge.mjs [output-directory]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const PORT = Number(process.env.VERIFY_PORT) || 8792;
const ORIGIN = `http://localhost:${PORT}`;
const OUT = resolve(process.argv[2] ?? "/tmp/epic-forge");
mkdirSync(OUT, { recursive: true });

const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", "web"],
  { cwd: ROOT_DIR, stdio: "ignore" });
const stopServer = () => { try { server.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", stopServer);
async function waitForServer(url, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const r = await fetch(url, { method: "HEAD" }); if (r.ok || r.status === 404) return; } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not come up on ${url}`);
}
await waitForServer(`${ORIGIN}/index.html`);

// ROSTER_SLOT_CHARIDS: the eight partners, slot order.
const SLOTS = ["p003pken", "p004kogu", "p005koet", "p006agum", "p007vmon", "p008giru", "p009rena", "p010pata"];
const PARTY = [SLOTS[0], SLOTS[2], SLOTS[1]];
const RESERVES = SLOTS.slice(3);
const NOHEMON = { x: 624, y: 304, npc: 173 };

const result = { legs: {}, errors: [], failures: [] };
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) result.failures.push(name);
};

const browser = await chromium.launch({ headless: true });

const member = (level) => ({
  digimonId: 39, level, xp: 0, tp: 10, hp: 9999, maxHp: 9999, mp: 9999, maxMp: 9999,
  stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 },
  bonuses: {}, elemBonuses: {},
});

/** Boot at ordinal 45 on s974 with the eight-partner fixture; `slowSlot` puts one
 *  partner below the level floor (the negative leg). */
async function boot({ slowSlot = null, inventory }) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on("pageerror", (e) => { result.errors.push(`pageerror: ${e.message}`); console.error("PAGEERROR", e.message); });
  await page.addInitScript((seed) => {
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", seed.party[0]);
    localStorage.setItem("party", JSON.stringify(seed.party));
    localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
    localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.lead, seed.lead]));
    localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
    localStorage.setItem("reserveStats", JSON.stringify(seed.reserves));
    localStorage.setItem("rosterOwned", "255");
    localStorage.setItem("bits", "1000");
    localStorage.setItem("progressOrdinal", "45");
    localStorage.setItem("inventory", JSON.stringify(seed.inventory));
  }, {
    party: PARTY,
    lead: member(slowSlot === 0 ? 44 : 99),
    reserves: Object.fromEntries(RESERVES.map((id, i) => [id, member(slowSlot === i + 3 ? 44 : 99)])),
    inventory,
  });
  await page.goto(`${ORIGIN}/?skipTitle=1&map=s974&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__storyFlags, null, { timeout: 40_000 });
  await page.waitForTimeout(500);
  return page;
}

/** Re-enter s974 through the route pair that places Nohemon (key 2, companion 8). */
async function enterNohemonsRoute(page) {
  await page.evaluate(() => {
    window.__state.entryKey = 2;
    window.__state.entryCompanion = 8;
    window.__setMap(window.__state.mapIdx);
  });
  await page.waitForTimeout(900);
}

const tapKey = (page, k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);
const face = async (page, x, y) => {
  await page.evaluate((p) => window.__teleport(p.x, p.y + 24), { x, y });
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" })));
  await page.waitForTimeout(140);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" })));
  await page.waitForTimeout(220);
};
const talkTarget = (page) => page.evaluate(() => {
  const t = window.__talkTarget();
  return { npc: t?.npc ?? null, dialogue: t?.state?.dialogue ?? null };
});
const dismiss = async (page) => {
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150);
    if (!(await page.evaluate(() => window.__textbox?.isOpen?.() ?? false))) break;
    await tapKey(page, " ");
  }
  await page.waitForTimeout(200);
};
const bag = (page) => page.evaluate(() => {
  const q = (id) => (window.__state.inventory ?? []).find((it) => Number(it.id) === id)?.qty ?? 0;
  return { rustyGlove: q(116), kaiserFist: q(113), zodiac: q(117) };
});

// ── Leg 1: the positive — all eight at 99, both inputs held, the forge runs ──
{
  const page = await boot({ inventory: [{ id: 116, qty: 1 }, { id: 113, qty: 1 }] });
  await enterNohemonsRoute(page);
  await face(page, NOHEMON.x, NOHEMON.y);
  let t = await talkTarget(page);
  check("Nohemon spawns on his route with all 8 partners at level 99", t.npc === NOHEMON.npc, `npc=${t.npc}`);
  await tapKey(page, " ");
  await dismiss(page);
  // Second line: the forge (gate = Kaiser Fist held, Zodiac not owned).
  await face(page, NOHEMON.x, NOHEMON.y);
  t = await talkTarget(page);
  check("the forge line is live once both inputs are held", t.dialogue?.index === 160, `line=${t.dialogue?.index}`);
  await tapKey(page, " ");
  await dismiss(page);
  const after = await bag(page);
  result.legs.forge = after;
  // Round-19 reconciliation: before the talk-grant fix this read 2 (the converted
  // engine give row fired on the talk AND the scene on_close granted again on
  // close — the measured double-count). fix/talk-grant-double-count removed the
  // engine row: the walker's talk-close arm is the single home, so the forge
  // grants exactly once; tightened from >= 1 to === 1.
  check("the forge granted Zodiac (item 117)", after.zodiac === 1, JSON.stringify(after));
  check("the forge consumed Rusty Glove (item 116)", after.rustyGlove === 0, JSON.stringify(after));
  check("the forge consumed Kaiser Fist (item 113)", after.kaiserFist === 0, JSON.stringify(after));
  await page.screenshot({ path: `${OUT}/forge.png` });
  await page.close();
}

// ── Leg 2: the negative — one partner below 45, the forger is not there ──
{
  const page = await boot({ slowSlot: 5, inventory: [{ id: 116, qty: 1 }, { id: 113, qty: 1 }] });
  await enterNohemonsRoute(page);
  await face(page, NOHEMON.x, NOHEMON.y);
  const t = await talkTarget(page);
  check("one partner below 45 keeps the forger off the board (0x7095)", t.npc !== NOHEMON.npc, `npc=${t.npc}`);
  await page.screenshot({ path: `${OUT}/no-forger.png` });
  await page.close();
}

check("no page errors", result.errors.length === 0, result.errors.join(" | "));
writeFileSync(`${OUT}/result.json`, JSON.stringify({ ok: result.failures.length === 0 && result.errors.length === 0, ...result }, null, 1));
await browser.close();
stopServer();
console.log(`\n${result.failures.length === 0 && result.errors.length === 0 ? "OK" : "FAILED"} -> ${OUT}`);
process.exit(result.failures.length === 0 && result.errors.length === 0 ? 0 : 1);
