// tools/verify_cardduel_summon_end.mjs - which button ends a Summon-Phase turn.
//
// Decoded 2026-09-14 from the original overlay (authority 2, cardgame.s; load
// base 0x80082CB0, so RAM = file offset + 0x82CB0):
//
//   * F0x800878B4 (`pickerPadPickSeveral`) sets picker state 6 on SQUARE
//     (logical 0xF) UNCONDITIONALLY - with or without marks (0x4c90-0x4cc8) -
//     and state 0xB on Triangle (0xC).
//   * F0x80087EDC state 6 runs a 0x13-frame animation into state 7, the
//     "Put in Field? Yes/No" prompt. There (0x5bd8-0x5d74):
//       - the answer word +0x440 starts at 0 (Yes; the opener F0x80086D78
//         zeroes it) and Up/Down (4/6) toggle it;
//       - CIRCLE (0xD) finishes: answer Yes -> state 8, which after 0x2E frames
//         returns 1 (the picker's done value); answer No -> state 9, back to
//         the picker after 0x1F frames;
//       - CROSS (0xE) writes answer = No and also returns to the picker;
//       - Triangle is not read at this prompt at all.
//   * The picker never commits. The Summon Phase driver F0x800A0B80 calls the
//     per-side commit method +0x818 (F0x800A0754) after the picker returns.
//
// So the turn ends on Circle-Yes, AFTER Square raises the prompt. This drives
// the real shell (web/game.js -> web/cardduel.js) on the real canvas.
//
// Serve the lab first:  python3 -m http.server 8742 --directory web
// Run:  .opencode/autonomy/check-browser tools/verify_cardduel_summon_end.mjs
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const OUT = process.env.DUEL_SUMMON_END_SHOT || ".dw3-research/autonomous-plan/shots/cardduel-summon-end";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (e) => { errors.push(e.message); console.error("PAGEERROR", e.message); });
// The legacy duel: this check reads the old shell's own surface (labDuel.busyNow, labDuel.duel, labDuel.handCursor, labDuel.handleKey), which the native duel (the default since web/game.js:545) does not expose. Census: CARD-DUEL-VERIFIED.md 34.
await page.goto(`${baseUrl(8742)}/ui-lab.html?legacyDuel=1`, { waitUntil: "load" });
await page.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 10000 });

const inGame = (fn, arg) => page.evaluate(({ src, a }) => {
  const w = document.getElementById("game").contentWindow;
  // eslint-disable-next-line no-new-func
  return new Function("w", "a", src)(w, a);
}, { src: fn, a: arg ?? null });

const snap = () => inGame(`const c = w.__labDuel, d = c.duel; return {
  phase: c.phaseKey(),
  mine: c.summonIsMine(),
  confirm: c.summonConfirm ? c.summonConfirm.answer : null,
  marks: [...(c.summonMarks ?? [])],
  field: d ? d.player.field.length : 0,
  hand: d ? d.player.hand.length : 0,
  turn: d && d.summonTurns ? d.summonTurns.turn : null,
  done: d && d.summonTurns ? d.summonTurns.done : null,
};`);
const shot = async (name) => {
  const url = await inGame(`const cv = w.document.querySelector("canvas#game") || w.document.querySelector("canvas"); return cv.toDataURL("image/png");`);
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
};

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); else console.log("  ok:", msg); };
const fail = (msg) => failures.push(msg);
const pressUntil = async (k, want, tries = 50) => {
  for (let i = 0; i < tries; i++) {
    await inGame(`w.__labDuel.handleKey(${JSON.stringify(k)});`);
    await page.waitForTimeout(70);
    const s = await snap();
    if (want(s)) return s;
  }
  return await snap();
};
const press = async (k, n = 1) => {
  for (let i = 0; i < n; i++) { await inGame(`w.__labDuel.handleKey(${JSON.stringify(k)});`); await page.waitForTimeout(70); }
};

try {
  await inGame(`w.__labOpen("cardduel");`);
  await page.waitForTimeout(800);
  // The challenge screen and the folder chooser run before there is a duel.
  for (let i = 0; i < 60; i++) {
    if (await inGame(`return !!w.__labDuel.duel;`)) break;
    await inGame(`w.__labDuel.handleKey(${JSON.stringify(i % 2 ? "circle" : "enter")});`);
    await page.waitForTimeout(80);
  }
  check(await inGame(`return !!w.__labDuel.duel;`), "the duel started after the challenge screen");
  // A fixture, not gameplay: grant S-Energy, put Digimon in hand, jump to the
  // Summon Phase (DUEL_PHASES[3]) with the player owning the first turn.
  await inGame(`
    const c = w.__labDuel, d = c.duel;
    for (const k of Object.keys(d.player.energy)) d.player.energy[k] = 20;
    const digs = [...d.byId.values()].filter((r) => r.kind === "digimon").slice(0, 3).map((r) => r.id);
    d.player.hand = digs.slice();
    d.player.field = [];
    d.player.trash = [];
    d.phaseIndex = 3;
    d.summonTurns = { order: [d.player, d.opponent], turn: 0, done: false };
    d.beat.current = null; d.beat.gated = false; d.beat.pending.length = 0;
    c.summonMarks = new Set(); c.summonConfirm = null; c.handCursor = 0;
    c.resyncSprites();
  `);
  // The phase's opening announcement owns the pad until it is cleared: Circle
  // dismisses it, and only once it is gone does Circle mark a card. Loop until
  // a mark lands, then clear it, so the fixture does not depend on the
  // announcement's own timer.
  for (let i = 0; i < 20; i++) {
    await inGame(`w.__labDuel.handleKey("circle");`);
    await page.waitForTimeout(70);
    if ((await snap()).marks.length > 0) break;
  }
  // Undo through the real picker, including the engine's energy refund.
  if ((await snap()).marks.length) await press("circle");
  let s = await snap();
  check(s.phase === "summon", `the duel is in the Summon Phase (${s.phase})`);
  check(s.mine === true, "it is the player's summon turn (fixture)");
  check(s.confirm === null, "the picker is showing, not a stale prompt");
  await shot("summon-picker");

  // ---- Square raises the Prompt; Cross answers No; Circle answers Yes ------
  const slot = await inGame(`
    const c = w.__labDuel;
    for (let i = 0; i < c.duel.player.hand.length; i++) if (c.summonableSlot(i)) return i;
    return -1;
  `);
  check(slot >= 0, `a summonable card is in hand (fixture: slot ${slot})`);
  const fieldBefore = s.field, handBefore = s.hand;
  await inGame(`w.__labDuel.handCursor = ${slot};`);

  s = await pressUntil("circle", (x) => x.marks.length > 0, 20);
  check(s.marks.includes(slot), `Circle marks the cursor card (marks ${JSON.stringify(s.marks)})`);
  await shot("summon-marked");

  s = await pressUntil("square", (x) => x.confirm !== null, 30);
  check(s.confirm !== null, `Square raises "Put in Field?" with the answer on Yes (${s.confirm})`);
  check(s.mine === true, "raising the prompt did not end the turn");
  await shot("summon-confirm");

  // Triangle is not read at this prompt; pressing it must change nothing.
  const beforeTriangle = await snap();
  await press("triangle", 3);
  s = await snap();
  check(s.confirm === beforeTriangle.confirm && s.mine === true,
    "Triangle at the prompt changes nothing (the routine never reads it)");

  // Cross is No: the prompt closes and the picker comes back with the marks kept.
  s = await pressUntil("cross", (x) => x.confirm === null, 20);
  check(s.confirm === null, "Cross closes the prompt (answer No)");
  check(s.mine === true, "Cross does NOT end the turn");
  check(s.marks.includes(slot), "the marks survive the No answer, so the picker is back");
  check(s.field === fieldBefore, "and nothing was committed");
  await shot("summon-cross-no");

  // Square again, then Circle-Yes: the marked set commits and the turn ends.
  s = await pressUntil("square", (x) => x.confirm !== null, 30);
  check(s.confirm !== null, "Square raises the prompt again");
  s = await pressUntil("circle", (x) => x.field > fieldBefore || x.mine !== true, 60);
  check(s.field === fieldBefore + 1, `Circle-Yes commits exactly the marked set (${fieldBefore} -> ${s.field})`);
  check(s.hand === handBefore - 1, `the committed card left the hand (${handBefore} -> ${s.hand})`);
  check(s.mine !== true || s.done === true, "and the turn moved on");
  await shot("summon-committed");

  // ---- With NO marks, Square still raises the prompt; Circle-Yes passes ----
  await inGame(`
    const c = w.__labDuel, d = c.duel;
    d.phaseIndex = 3;
    d.summonTurns = { order: [d.player, d.opponent], turn: 0, done: false };
    d.player.field = [];        // a fresh turn starts from an empty field
    d.beat.current = null; d.beat.gated = false; d.beat.pending.length = 0;
    c.summonMarks = new Set(); c.summonConfirm = null;
    c.resyncSprites();
  `);
  // The previous commit's sprites are still running; the picker refuses input
  // while the board is busy, so wait that out before the second case.
  for (let i = 0; i < 60; i++) {
    if (!(await inGame(`return w.__labDuel.busyNow();`))) break;
    await page.waitForTimeout(80);
  }
  const noMarkField = (await snap()).field;
  s = await pressUntil("square", (x) => x.confirm !== null, 60);
  check(s.confirm !== null, "Square raises the prompt even with nothing marked");
  check((await snap()).mine === true, "and the turn is not ended by Square");
  s = await pressUntil("circle", (x) => x.mine !== true || x.done === true, 60);
  check(s.mine !== true || s.done === true, "Circle-Yes then ends the empty turn");
  check(s.field === 0, "an empty commit places nothing (the field stays empty)");
  await shot("summon-empty-pass");

  if (errors.length) fail(`${errors.length} page error(s)`);
} catch (e) {
  fail(`check threw: ${e.message}`);
} finally {
  await browser.close();
}

if (failures.length) {
  console.error("\nFAILED:");
  for (const m of failures) console.error(" -", m);
  process.exit(1);
}
console.log("\nOK: the Summon Phase's end button is Circle on the Square-raised prompt");
