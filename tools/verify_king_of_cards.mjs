// tools/verify_king_of_cards.mjs — the King of Cards gauntlet (POST_GAME_WALKTHROUGH
// quest b), driven end to end from ordinary gameplay at story ordinal 45.
//
// WHAT THIS PROVES, AND AGAINST WHAT:
//   s951 is the ordinal-45 alias of s386 (East Sector — Duel Island). Six card
//   duelists stand along the island; each challenge dialogue state's on_close writes a
//   bank-0x78 launcher (F0x80016378: argument = index*2 + mode + 1), which the field's
//   own pendingDuelId path turns into a native pro/cardgame duel against the CARD_NPC
//   record it names. Winning the duel sets story flags 17/18/16 through the field's
//   screen-close housekeeping (F0x800169e0 — the fix this check was written for), which
//   is what unlocks the duelist's win line; closing the win line sets the duelist's own
//   clear bit (0x1011..0x1016), starts their farewell talk event (bank 0x90) and — for
//   Keith, the Card King — hands over the KoC Trophy (item 36).
//
//   Keith   npc 102 -> 0x7848 -> CARD_NPC 146 Bombard Folder
//   Alice   npc 399 -> 0x784F -> CARD_NPC 160 Dark Evil King
//   Bomujii npc 400 -> 0x784C -> CARD_NPC 154 Fire Guardian Folder
//   Pierre  npc 401 -> 0x7850 -> CARD_NPC 162 Fairies of the Sea
//   Poemy   npc 402 -> 0x784A -> CARD_NPC 150 Miserable Folder
//   Haruka  npc 403 -> 0x784E -> CARD_NPC 158 Shining Empress
//
// Run (the harness starts and stops its own server):
//   tools/run-playwright.sh tools/verify_king_of_cards.mjs [output-directory]
//   DUELISTS=keith,haruka tools/run-playwright.sh tools/verify_king_of_cards.mjs   (subset)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const ROOT_DIR = resolve(new URL("..", import.meta.url).pathname);
const PORT = Number(process.env.VERIFY_PORT) || 8791;
const ORIGIN = `http://localhost:${PORT}`;
const OUT = resolve(process.argv[2] ?? "/tmp/king-of-cards");
mkdirSync(OUT, { recursive: true });

const server = spawn("python3", ["-m", "http.server", String(PORT), "--directory", "web"],
  { cwd: ROOT_DIR, stdio: "ignore" });
const stopServer = () => { try { server.kill("SIGTERM"); } catch { /* gone */ } };
process.on("exit", stopServer);
async function waitForServer(url, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { method: "HEAD" });
      if (r.ok || r.status === 404) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not come up on ${url}`);
}
await waitForServer(`${ORIGIN}/index.html`);

// The six duelists, in the walkthrough's order (the path order on the island).
const DUELISTS = [
  { key: "haruka", name: "Haruka", npc: 403, x: 480, y: 521, launcher: 0x784E, record: 158, bit: 0x1016, farewell: 1620 },
  { key: "poemy", name: "Poemy", npc: 402, x: 375, y: 493, launcher: 0x784A, record: 150, bit: 0x1015, farewell: 1622 },
  { key: "pierre", name: "Pierre", npc: 401, x: 272, y: 497, launcher: 0x7850, record: 162, bit: 0x1014, farewell: 1624 },
  { key: "bomujii", name: "Bomujii", npc: 400, x: 297, y: 373, launcher: 0x784C, record: 154, bit: 0x1013, farewell: 1626 },
  { key: "alice", name: "Alice", npc: 399, x: 216, y: 269, launcher: 0x784F, record: 160, bit: 0x1012, farewell: 1628 },
  { key: "keith", name: "Keith", npc: 102, x: 159, y: 177, launcher: 0x7848, record: 146, bit: 0x1011, farewell: null },
];
const selected = (process.env.DUELISTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const RUN = selected.length ? DUELISTS.filter((d) => selected.includes(d.key)) : DUELISTS;

const member = () => ({
  digimonId: 39, level: 99, xp: 0, tp: 10, hp: 9999, maxHp: 9999, mp: 9999, maxMp: 9999,
  stats: { str: 999, def: 999, spt: 999, wis: 999, spd: 999, chr: 999 },
  bonuses: {}, elemBonuses: {},
});

const result = { legs: {}, errors: [], failures: [] };
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) result.failures.push(name);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on("pageerror", (e) => { result.errors.push(`pageerror: ${e.message}`); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("engineSchema", "2");
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("charId", seed.party[0]);
  localStorage.setItem("party", JSON.stringify(seed.party));
  localStorage.setItem("partnerStats", JSON.stringify(seed.member));
  localStorage.setItem("partyStats", JSON.stringify([seed.member, seed.member, seed.member]));
  localStorage.setItem("equipment", JSON.stringify([{}, {}, {}]));
  localStorage.setItem("rosterOwned", "1");
  localStorage.setItem("bits", "1000");
  localStorage.setItem("progressOrdinal", "45");
  localStorage.setItem("inventory", JSON.stringify([]));
}, { party: ["p003pken", "p005koet", "p004kogu"], member: member() });

await page.goto(`${ORIGIN}/?skipTitle=1&map=s951&noEncounters=1`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started && window.__storyFlags, null, { timeout: 40_000 });
await page.waitForTimeout(500);
const mapId = await page.evaluate(() => window.__state.manifest.maps[window.__state.mapIdx].id);
check("booted onto the Duel Island alias stage", mapId === "s951", `map=${mapId}`);

const tapKey = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);

const dismiss = async () => {
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(150);
    const busy = await page.evaluate(() =>
      (window.__textbox?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false));
    if (!busy) break;
    await tapKey(" ");
  }
  await page.waitForTimeout(200);
};

const face = async (x, y) => {
  await page.evaluate((p) => window.__teleport(p.x, p.y + 24), { x, y });
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" })));
  await page.waitForTimeout(140);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" })));
  await page.waitForTimeout(220);
};
const talkTarget = () => page.evaluate(() => {
  const t = window.__talkTarget();
  return { npc: t?.npc ?? null, dialogue: t?.state?.dialogue ?? null, onClose: t?.state?.on_close ?? null };
});
const flags = () => page.evaluate(() => ({
  f16: window.__storyFlags.get(16), f17: window.__storyFlags.get(17), f18: window.__storyFlags.get(18),
}));

const waitDuelOpen = async () => {
  for (let i = 0; i < 30; i++) {
    if (await page.evaluate(() => window.__cardDuelNative?.isOpen?.() === true)) return true;
    await page.keyboard.down("Enter");
    await page.waitForTimeout(200);
    await page.keyboard.up("Enter");
    await page.waitForTimeout(120);
  }
  return false;
};

const snap = (record) => page.evaluate((f) => {
  const rd = (a, s) => window.__nativeScreenRead(a, s) >>> 0;
  const duel = window.__nativeScreenObjects().find((o) => o.cb === 0x800a2f00);
  if (!duel) return { closed: true, open: window.__cardDuelNative?.isOpen?.() === true };
  return { closed: false, mode: rd(duel.addr + 0x2f8, 1), won: rd(0x80048ac0, 4) };
}, record);

/** Drive one duel to a win the way the native-duel checks do: seed a five-card
 *  opponent deck the moment the coin-toss mode (3) appears, then walk the chain. */
const winDuel = async (record) => {
  let board = await snap(record);
  let seeded = false;
  for (let i = 0; i < 40 && board.mode !== 4; i++) {
    await page.keyboard.down("Enter");
    await page.waitForTimeout(200);
    await page.keyboard.up("Enter");
    await page.waitForTimeout(100);
    board = await snap(record);
    if (!seeded && board.mode === 3) {
      await page.evaluate(() => {
        const duel = window.__nativeScreenObjects().find((o) => o.cb === 0x800a2f00);
        window.__nativeScreenWrite(duel.addr + 0x66c, 5, 2);
      });
      seeded = true;
    }
  }
  let after = board;
  for (let i = 0; i < 12 && !after.closed; i++) {
    await page.keyboard.down("Enter");
    await page.waitForTimeout(200);
    await page.keyboard.up("Enter");
    await page.waitForTimeout(140);
    after = await snap(record);
  }
  await page.waitForTimeout(1200);
  after = await snap(record);
  return { board, after, seeded };
};

for (const d of RUN) {
  const leg = { name: d.name };
  console.log(`\n── ${d.name} (s951 npc ${d.npc}) ──`);

  // 1. First meeting: the greet line, whose close arms the challenge.
  await face(d.x, d.y);
  let t = await talkTarget();
  check(`${d.name}: the talk target is the duelist`, t.npc === d.npc, `npc=${t.npc}`);
  await tapKey(" ");
  await dismiss();

  // 2. The challenge line carries the launcher.
  await face(d.x, d.y);
  t = await talkTarget();
  const launch = (t.onClose ?? []).find((c) => ((c.id >> 8) & 0xfe) === 0x78);
  check(`${d.name}: the challenge writes the bank-0x78 launcher`,
    launch != null && launch.id === d.launcher,
    `flag=${launch ? `0x${launch.id.toString(16)}` : null}`);
  leg.challenge = t.dialogue?.index;
  await tapKey(" ");

  // 3. The launcher opens the native duel against the named record.
  const opened = await waitDuelOpen();
  check(`${d.name}: the challenge opened the native duel`, opened);
  const opponent = await page.evaluate(() => window.__cardDuelNative?.diagnostics?.()?.opponentId ?? null);
  check(`${d.name}: the duel plays CARD_NPC record ${d.record}`, opponent === d.record, `opponent=${opponent}`);
  await page.screenshot({ path: `${OUT}/${d.key}-01-duel.png` });

  // 4. Win it.
  const { after } = await winDuel(d.record);
  check(`${d.name}: the duel closed back to the field`, after.closed === true);
  await page.waitForTimeout(600);

  // 5. The housekeeping wrote the result flags (F0x800169e0).
  const f = await flags();
  leg.afterDuel = f;
  check(`${d.name}: the duel wrote flag 17 (a duel was played)`, f.f17 === 1, `17=${f.f17}`);
  check(`${d.name}: the duel wrote flag 18`, f.f18 === 1, `18=${f.f18}`);
  check(`${d.name}: the duel wrote flag 16 = won`, f.f16 === 1, `16=${f.f16}`);

  // 6. The win line is now the live state; closing it retires the duelist and —
  //    for the five gatekeepers — starts the farewell cutscene (bank 0x90), which
  //    is watched WHILE the box is dismissed (the dismiss loop consumes it too).
  await face(d.x, d.y);
  t = await talkTarget();
  leg.winLine = t.dialogue?.index;
  check(`${d.name}: the win line is live after the duel`, t.dialogue?.index != null && t.dialogue.index !== leg.challenge,
    `line=${t.dialogue?.index}`);
  await tapKey(" ");
  let cutsceneSeen = false;
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => ({
      cutscene: window.__cutscene?.isActive?.() ?? false,
      box: window.__textbox?.isOpen?.() ?? false,
    }));
    if (state.cutscene) cutsceneSeen = true;
    if (!state.box && !state.cutscene && i > 2) break;
    await tapKey(" ");
  }
  if (d.farewell != null) {
    check(`${d.name}: the win starts the farewell cutscene (event ${d.farewell})`, cutsceneSeen);
  }
  const bit = await page.evaluate((b) => window.__storyFlags.get(b), d.bit);
  check(`${d.name}: the win line set the clear bit 0x${d.bit.toString(16)}`, bit === 1, `bit=${bit}`);
  const f2 = await flags();
  check(`${d.name}: the win line reset the result pair`, f2.f17 === 0 && f2.f16 === 0,
    `17=${f2.f17} 16=${f2.f16}`);

  // 7. The duelist has stepped aside on the NEXT arrival (the disc rebuilds a
  //    stage's cast on entry, which is also how the walker snapshots it) —
  //    checked in full for Haruka: a fresh boot must show her after-position.
  if (d.key === "haruka") {
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__state?.started && window.__storyFlags, null, { timeout: 40_000 });
    await page.waitForTimeout(500);
    const persisted = await page.evaluate((b) => window.__storyFlags.get(b), d.bit);
    check("Haruka: the clear bit survived the reload", persisted === 1, `bit=${persisted}`);
    await face(504, 496); // Haruka's after-position
    const afterTalk = await talkTarget();
    check("Haruka: the after-position is the live NPC now", afterTalk.npc === 50, `npc=${afterTalk.npc}`);
    check("Haruka: and speaks the after line", afterTalk.dialogue?.index === 110, `line=${afterTalk.dialogue?.index}`);
    await dismiss();
  }

  // 8. Keith pays the quest's reward.
  if (d.key === "keith") {
    const qty = await page.evaluate(() =>
      (window.__state.inventory ?? []).find((it) => Number(it.id) === 36)?.qty ?? 0);
    leg.trophyQty = qty;
    check("Keith: the KoC Trophy (item 36) is in the bag", qty === 1, `qty=${qty}`);
    // Round-19 reconciliation: before the talk-grant fix this read 2 — the
    // converted engine give row fired on the talk AND the scene on_close granted
    // again on close (the named double-grant defect). fix/talk-grant-double-count
    // removed the engine row: the walker's talk-close arm is now the single home,
    // so the trophy lands exactly once; the check is tightened from >= 1 to === 1.
  }

  result.legs[d.key] = leg;
  await page.screenshot({ path: `${OUT}/${d.key}-02-after.png` });
}

// The quest's own end state: all six clear bits, for a full run.
if (RUN.length === 6) {
  const bits = await page.evaluate((ids) => ids.map((id) => window.__storyFlags.get(id)), [0x1011, 0x1012, 0x1013, 0x1014, 0x1015, 0x1016]);
  check("all six duelists are retired (0x1011..0x1016 set)", bits.every((b) => b === 1), JSON.stringify(bits));
}

check("no page errors", result.errors.length === 0, result.errors.join(" | "));
writeFileSync(`${OUT}/result.json`, JSON.stringify({ ok: result.failures.length === 0 && result.errors.length === 0, ...result }, null, 1));
await browser.close();
stopServer();
console.log(`\n${result.failures.length === 0 && result.errors.length === 0 ? "OK" : "FAILED"} -> ${OUT}`);
process.exit(result.failures.length === 0 && result.errors.length === 0 ? 0 : 1);
