import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";
import { backOutToTitle, loadFromCard, openContinueCard, saveToCard } from "./memcard-continue.mjs";

// Plan 6.4 gym leg: train the NON-LEAD partner at Leomon's gym through the real
// greeter and screens, then Continue. Asserts only the trainee's block and TP
// move, the other members are byte-identical, and the TP boundary refuses the
// session without touching state.
//
// The gym is the TRANSLATED screen (web/gym-translated.js). Its state words are
// read from the session's own diagnostics: `flow` is the screen's flow machine
// (5 the pod select, 0x0B the drill list, 0x1F the TP panel), `pod` is the pod
// under the cursor, the drill picker's page/column/row are the drill under the
// cursor, the confirm panel's +0x5C is the TP option and +0x68 the refusal flag,
// and `training.step` is the workout window's step (6 the result message). The
// screen holds its own copy of the trained blocks and commits them once, on
// close, so the trained numbers are read from `diagnostics().records` while it
// is open and from the walker's party blocks after it has closed.
//
// Server: python3 -m http.server 8741 --directory web
// Run:    tools/run-playwright.sh tools/verify_gym_training.mjs
const ROOT = process.env.GYM_ROOT || `${baseUrl(8741)}/`;
const BASE = ROOT + "?skipTitle=1&map=s330&noEncounters=1";
// The title boot. The country/language screen (code 0x1600) comes before it and ends
// in the opening movie, so the leg that comes back through the title skips it.
const TITLE = ROOT + "?skipLanguage=1&noEncounters=1";
const OUT = process.env.GYM_SHOT || "/tmp/gym-training";
mkdirSync(OUT, { recursive: true });

const mk = (digimonId, level, tp, str) => ({
  digimonId, level, xp: 123, tp, hp: 200, maxHp: 200, mp: 90, maxMp: 90,
  stats: { str, def: 40, spt: 30, wis: 30, spd: 35, chr: 20 },
  bonuses: {}, elemBonuses: {},
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
await page.addInitScript((seed) => {
  localStorage.setItem("assetMode", "authentic");
  localStorage.setItem("engineSchema", "2");
  if (sessionStorage.getItem("gymFixture")) return;
  sessionStorage.setItem("gymFixture", "1");
  localStorage.setItem("playerName", "Junior");
  localStorage.setItem("fieldLocation", JSON.stringify({ version: 1, mapId: "s330", x: 923, y: 404, dir: "up" }));
  localStorage.setItem("charId", "p003pken");
  localStorage.setItem("party", JSON.stringify(["p003pken", "p009rena", "p010pata"]));
  localStorage.setItem("partnerStats", JSON.stringify(seed.lead));
  localStorage.setItem("partyStats", JSON.stringify([seed.lead, seed.rena, seed.pata]));
  localStorage.setItem("equipment", JSON.stringify([{}, { right: 92 }, {}]));
}, { lead: mk(1, 20, 99, 80), rena: mk(7, 17, 5, 60), pata: mk(8, 15, 99, 50) });

const tap = (k) => press(k, 0);
const press = async (k, wait = 260) => {
  await page.evaluate((kk) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  }, k);
  await page.waitForTimeout(120);
  await page.evaluate((kk) => {
    window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
  }, k);
  await page.waitForTimeout(wait);
};
const hold = async (k, ms) => {
  await page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk })), k);
  await page.waitForTimeout(ms);
  await page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keyup", { key: kk })), k);
};
const blocks = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__state.partyStats ?? [])));
const shot = async (n) => writeFileSync(`${OUT}/${n}.png`,
  Buffer.from((await page.locator("canvas#game").evaluate((el) => el.toDataURL("image/png"))).split(",")[1], "base64"));
/** One named word of one live gym task (the translated route's own task tree). */
const taskWord = (name, offset) => page.evaluate((a) => {
  const g = window.__gym?._session;
  if (!g) return null;
  const t = [...g.tree.tasks.values()].find((x) => g.tree.classes.get(x.classId).name === a.name);
  return t ? (g.mem.read32(t.address + a.offset) | 0) : null;
}, { name, offset });
/** The named task's own machine word (+0x10), or null when it is not in the tree. */
const taskPhase = (name) => taskWord(name, 0x10);
const gymState = () => page.evaluate(() => {
  const d = window.__gym?.diagnostics?.() ?? {};
  const s = d.state;
  return {
    open: !!window.__gym?.isOpen?.(),
    execution: d.execution ?? null,
    group: d.group ?? null,
    flow: s?.flow ?? null,
    trainSlot: s?.pod ?? null,
    tpChoice: s?.tpChoice ?? null,
    resultPages: d.training?.step ?? null,
    training: d.training ?? null,
    records: d.records ?? [],
  };
});
/** The gym's own live screens, read from its task tree. */
const gymScreen = async () => {
  const [drillPage, column, row, tpSel, tpPhase, screen] = await Promise.all([
    taskWord("gym picker", 0x70), taskWord("gym picker", 0x68), taskWord("gym picker", 0x6c),
    taskWord("gym confirm", 0x5c), taskPhase("gym confirm"),
    page.evaluate(() => {
      const g = window.__gym?._session;
      if (!g) return null;
      return [...g.tree.tasks.values()].map((t) => g.tree.classes.get(t.classId).name);
    }),
  ]);
  return {
    drillSel: drillPage === null ? null : { page: drillPage, column, row },
    tpSel,
    // The confirm panel's own 0x0C state is the "not enough TP" line it holds.
    tpWarn: tpPhase === 0x0c,
    tpPhase,
    tasks: screen,
  };
};
const waitFlow = async (flow, what, timeout = 60_000) => {
  await page.waitForFunction((n) => window.__gym?.diagnostics?.().state?.flow === n,
    flow, { timeout, polling: 120 });
  return gymState();
};
/** Wait until the named live task reaches `phase` (its own machine word at +0x10). */
const waitTask = async (name, phase, what, timeout = 60_000) => {
  await page.waitForFunction((a) => {
    const g = window.__gym?._session;
    if (!g) return false;
    const t = [...g.tree.tasks.values()].find((x) => g.tree.classes.get(x.classId).name === a.name);
    return !!t && (g.mem.read32(t.address + 0x10) | 0) === a.phase;
  }, { name, phase }, { timeout, polling: 120 });
  return gymState();
};

function diff(a, b, prefix = "") {
  const out = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) {
    const va = a?.[k], vb = b?.[k];
    if (va && vb && typeof va === "object" && typeof vb === "object") out.push(...diff(va, vb, `${prefix}${k}.`));
    else if (JSON.stringify(va) !== JSON.stringify(vb)) out.push(`${prefix}${k}: ${JSON.stringify(va)} -> ${JSON.stringify(vb)}`);
  }
  return out;
}

const results = { errors };
try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__state?.started && window.__talkTarget, null, { timeout: 40_000 });
  await page.waitForTimeout(1000);
  for (let i = 0; i < 40; i++) {
    const busy = await page.evaluate(() => (window.__textbox?.isOpen?.() ?? false) || (window.__cutscene?.isActive?.() ?? false));
    if (!busy) break;
    await tap(" ");
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => window.__teleport(923, 404));
  await page.waitForTimeout(400);
  await hold("ArrowUp", 150);
  await page.waitForTimeout(300);
  results.target = await page.evaluate(() => window.__talkTarget());
  await tap(" ");                       // greeter line
  await page.waitForTimeout(400);
  // Close the greeter lines; the gym opens when the last one closes (no Yes/No).
  for (let i = 0; i < 12; i++) {
    const st = await page.evaluate(() => ({
      gym: !!window.__gym?.isOpen?.(),
      choice: !!window.__choice?.isOpen?.(),
      box: window.__textbox?.isOpen?.() ?? false,
    }));
    if (st.gym) break;
    await tap(" ");
    await page.waitForTimeout(350);
  }
  results.opened = await waitFlow(5, "the pod select").catch(async () => gymState());
  results.openedScreen = await gymScreen();
  await shot("gym-open");
  if (!results.opened.open) throw new Error(`gym did not open: ${JSON.stringify(results.opened)}`);

  // Pod select -> non-lead (index 1). Enter is the screen's confirm (pad bit 0x0D),
  // `c` is its Back (0x0E); the screen reads held keys, so both are held a frame.
  await press("ArrowRight");
  await page.waitForTimeout(300);
  results.selected = await gymState();
  await press("Enter");                  // pod -> drill list
  results.drill = await waitFlow(0x0b, "the drill list");
  results.drillScreen = await gymScreen();
  await shot("gym-drill");
  await waitTask("gym picker", 0x0a, "the drill grid");   // the grid is open and idle
  await press("Enter");                  // drill 0 -> the TP panel
  await waitTask("gym confirm", 6, "the TP option list");
  await waitFlow(0x1f, "the TP panel");
  await press("ArrowRight");             // TP 5 (index 1)
  await page.waitForTimeout(300);
  results.tp = await gymState();
  results.tpScreen = await gymScreen();
  results.before = await blocks();
  await press("Enter");                  // confirm the TP amount
  await page.waitForTimeout(400);
  results.confirm = await gymState();
  results.confirmScreen = await gymScreen();
  await press("Enter");                  // "Is this ok?" Yes
  // The training window opens, the reps run, and step 6 is the result message.
  for (let i = 0; i < 200; i++) {
    const st = (await gymState()).resultPages;
    if (st === 6) break;
    if (st === 5) await press("Enter", 400); else await page.waitForTimeout(500);
  }
  results.result = await gymState();
  await shot("gym-result");
  // The screen's own records already hold the trained numbers; the walker is
  // untouched until the screen closes.
  results.midRecords = (await gymState()).records;
  results.midBlocks = await blocks();

  // Leave the result back to the pod select.
  for (let i = 0; i < 14; i++) {
    if ((await gymState()).flow === 5) break;
    await press("Enter", 400);
  }
  results.backAtPods = await gymState();

  // TP boundary: no TP must refuse and stay on the amount picker.
  await page.evaluate(() => { window.__state.partyStats[1].tp = 0; });
  results.beforeRefusal = await blocks();
  await press("Enter");                  // pod -> drill list
  await waitFlow(0x0b, "the drill list (refusal run)");
  await waitTask("gym picker", 0x0a, "the drill grid (refusal run)");
  await press("Enter");                  // drill 0 -> the TP panel
  await waitTask("gym confirm", 6, "the TP option list (refusal run)");
  await press("ArrowRight");             // TP 5
  await page.waitForTimeout(250);
  await press("Enter");                  // refused
  await page.waitForTimeout(500);
  results.refusal = await gymState();
  results.refusalScreen = await gymScreen();
  results.refusalRecords = (await gymState()).records;
  results.afterRefusal = await blocks();

  // Leave the gym (Back at the pod select) and read the committed blocks.
  // Back is word bit 0x4000, which the original's gym flow reads as logical 0x0E
  // (exe-decomp/stgtrain_c/F0x8008517c.c:126) and which the keyboard reaches with
  // Escape or x (engine/systems/input-map.ts:234); `c` has been on the confirm
  // bit since 173ebcf0, so it can no longer leave the screen.
  for (let i = 0; i < 10; i++) {
    if (!(await page.evaluate(() => window.__gym?.isOpen?.()))) break;
    await press("Enter", 700);
    await press("Escape", 700);
  }
  await page.waitForFunction(() => !window.__gym?.isOpen?.(), null, { timeout: 20_000, polling: 120 });
  results.closed = await blocks();

  // The trained block survives a reload. It goes on the card first — the SAVE
  // card is `openMemoryCard("save")`, the call an inn or tower save point's
  // HANDOFF makes — because Continue only reaches the field by LOADING a file:
  // the card's own exit answers 0xE00, the title, when LOAD mode closes with
  // nothing loaded (pro/stgmcard.s 0x4dc4-0x4e2c).
  results.slot = await saveToCard(page, async () => { await page.evaluate(() => window.__labOpen("save")); });
  await page.goto(TITLE);
  await page.waitForFunction(() => {
    const t = document.querySelector("#title-screen");
    return t && !t.hidden;
  }, null, { timeout: 30_000 });
  await openContinueCard(page);
  results.backOut = await backOutToTitle(page);
  if (results.backOut.started || results.backOut.phase !== "prompt" || results.backOut.exitScreen !== 0xe00)
    throw new Error(`backing out of the card did not return to the title: ${JSON.stringify(results.backOut)}`);
  await openContinueCard(page);
  await loadFromCard(page);
  await page.waitForTimeout(500);
  results.afterReload = await blocks();
} finally {
  await browser.close();
}

const assert = (c, m) => { if (!c) { console.error(JSON.stringify(results, null, 2)); throw new Error(m); } };
assert(results.errors.length === 0, `page errors: ${results.errors.join("; ")}`);
assert(results.target?.npc === 27, `not facing Leomon: ${JSON.stringify(results.target)}`);
assert(results.opened.open, "gym did not open");
assert(results.opened.execution === "translated", `gym is not the translated screen: ${results.opened.execution}`);
// The pod select shows three pods and the cursor moved to the non-lead one.
assert(results.opened.flow === 5 && results.openedScreen.tasks.includes("gym screen"),
  `the pod select never opened: ${JSON.stringify(results.opened)}`);
assert(results.selected.trainSlot === 1, `trainee slot is not the non-lead: ${results.selected.trainSlot}`);
// The drill list opened with the first drill (page 0, column 0, row 0) under the cursor.
assert(results.drill.flow === 0x0b && results.drillScreen.tasks.includes("gym picker"),
  `drill list did not open: ${JSON.stringify(results.drillScreen)}`);
assert(results.drillScreen.drillSel?.page === 0 && results.drillScreen.drillSel?.column === 0 &&
  results.drillScreen.drillSel?.row === 0,
  `wrong drill under the cursor: ${JSON.stringify(results.drillScreen.drillSel)}`);
// The TP panel is up with the second option (TP 5) under the cursor.
assert(results.tp.flow === 0x1f && results.tpScreen.tasks.includes("gym confirm"),
  `TP panel wrong: ${JSON.stringify(results.tpScreen)}`);
assert(results.tpScreen.tpSel === 1, `TP picker wrong: ${JSON.stringify(results.tpScreen)}`);
assert(results.confirm.tpChoice === 1, `the chosen TP amount did not reach the screen: ${results.confirm.tpChoice}`);
// The workout ran and its result message opened.
assert(results.result.resultPages === 6, "session never reached its result");
// The screen's own records hold the trained numbers; the walker is untouched
// until the screen closes.
const traineeRecord = results.midRecords[1];
assert(traineeRecord && traineeRecord.tp === 0, `the trainee's TP was not charged: ${JSON.stringify(traineeRecord)}`);
assert(results.midRecords[0]?.tp === 99 && results.midRecords[2]?.tp === 99,
  `the other pods were charged: ${JSON.stringify(results.midRecords.map((r) => r?.tp))}`);
assert(JSON.stringify(results.midBlocks) === JSON.stringify(results.before),
  `the walker's blocks moved while the screen was open`);
// Leaving commits: only the trainee block moved, and its TP paid the session cost.
// The gym writes every seeded pod's element bonuses back on close, so a block that
// carried no `elemBonuses` object at all comes back with seven zero entries. Those
// are the same numbers the roster record held, so they are compared as numbers.
const norm = (block) => {
  const out = JSON.parse(JSON.stringify(block ?? {}));
  if (out.elemBonuses) {
    for (const [k, v] of Object.entries(out.elemBonuses)) if (!v) delete out.elemBonuses[k];
    if (!Object.keys(out.elemBonuses).length) delete out.elemBonuses;
  }
  return out;
};
const traineeDiff = diff(results.before[1], results.closed[1]);
const leadDiff = diff(norm(results.before[0]), norm(results.closed[0]));
const thirdDiff = diff(norm(results.before[2]), norm(results.closed[2]));
assert(traineeDiff.some((d) => d.startsWith("stats.")), `trainee did not gain a stat: ${JSON.stringify(traineeDiff)}`);
assert(traineeDiff.some((d) => d.startsWith("tp: 5 -> 0")), `TP not spent: ${JSON.stringify(traineeDiff)}`);
assert(leadDiff.length === 0, `lead changed: ${JSON.stringify(leadDiff)}`);
assert(thirdDiff.length === 0, `third member changed: ${JSON.stringify(thirdDiff)}`);
// The TP boundary refused in place and wrote nothing: the confirm panel holds its
// own "not enough TP" line (its machine word 0x0C) and no training window opened.
assert(results.refusalScreen.tpWarn === true && results.refusalScreen.tpPhase === 0x0c &&
  results.refusal.flow === 0x1f && results.refusal.resultPages === null,
  `TP boundary not refused: ${JSON.stringify({ r: results.refusal, s: results.refusalScreen })}`);
assert(results.refusalRecords[1]?.tp === 0 && results.refusalRecords[0]?.tp === 99,
  `the refusal charged someone: ${JSON.stringify(results.refusalRecords.map((r) => r?.tp))}`);
// Continue keeps the trained non-lead block.
assert(JSON.stringify(results.afterReload[1]) === JSON.stringify(results.closed[1]),
  `Continue lost the training: ${JSON.stringify({ after: results.closed[1], reload: results.afterReload[1] })}`);
console.log(JSON.stringify({
  ok: true,
  summary: "gym: trained the non-lead partner for 5 TP, the lead and the third pod kept every number, and a 0-TP partner was refused at the TP list",
  results,
}, null, 2));
