// Suzaku Hall (s520): the conversation that closes the beat, driven through the REAL
// web/game.js in the browser (ui-lab harness, no mock).
//
// THE THING BEING PROVEN. Story step 25 is closed by a CONVERSATION, not by walking in and not
// by a position trigger: Patamon's line (estalk01 #163) has `on_close: [0x9040]`, and writing
// bank 0x90 is not storage — the resident dispatcher F0x800165ac routes it to fieldstg
// F0x8008bfa4, which reads the u16 event-id table at RAM 0x800978d8 and calls the same
// start_event (0x800853f8) the position step's op-8 calls. Bit 64 names event 695, whose
// completion routine (wstag520.s .L0x17c `li $v0,0x1a` / `sw $v0,-0x4c90($v1)`) stores story
// step 26.
//
//   Decode:  tools/extract_talk_event_launches.py (the table),
//            tools/extract_talk_launch_bindings.py (where the write is),
//            engine/systems/talk-launch.ts (the shared system, ported once).
//   Pins:    tests/engine/integration/talk-launch-starts.test.ts
//
// BEFORE (measured through this harness on the old content): talking to that character played
// event 695 IMMEDIATELY, at every one of the 46 story steps, because the scene sat on an
// ungated `s520.talk.695` row matched to a bare npc id. The row presented a cutscene, so the
// talk handler returned before opening Patamon's line — the player never heard it, and the
// on_close write that starts the scene never happened.
//
// WHAT YOU SEE, in order, in one browser session:
//   1. story step 24, same place, same character: their ordinary line (estalk01 #160), and the
//      story step does NOT move. Nothing about talking to that person advances the game.
//   2. story step 25: the SAME character now offers estalk01 #163. The line is shown — no scene
//      replaces it — and closing it starts event 695.
//   3. that scene's completion routine stores story step 26.
//   4. story step 26: the character says #163 again, but that record's on_close carries no
//      write, so nothing starts. The gate is the record, not the sentence.
//
// Run with a web server on this worktree's own port:
//   python3 -m http.server 8912 --directory web
//   VERIFY_PORT=8912 tools/run-playwright.sh tools/verify_talk_scene_story_step.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.env.TALKSCENE_SHOT || ".bunny-scratch/talk-scene";
mkdirSync(out, { recursive: true });
const ROOT = baseUrl(8912);
const STAGE = "s520";
const NPC_X = 321, NPC_Y = 193;          // Patamon; the record that launches 695 sits here
const LINE_160 = "Game Master was";              // estalk01 #160 — step 24's line (no write)
const LINE_163 = "Oh? You're looking";           // estalk01 #163 — step 25's line, carries 0x9040
const FIRED_KEY = "013c0020";            // event 695's flag_key (wstag_events s520)

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [], fired = [], trace = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.text().includes("[STORY]")) trace.push(m.text());
  const hit = m.text().match(/EVENT FIRED (\S+)/);
  if (hit) fired.push(hit[1]);
});

const state = () => page.evaluate(() => ({
  map: window.__state.manifest.maps[window.__state.mapIdx].id,
  ordinal: Number(window.__engine.state.vars.get("$story.ordinal")),
  open: window.__textbox.isOpen(),
  text: window.__textbox.dialogue?.pages?.flat().join(" ") ?? "",
  cut: window.__cutscene.isActive(),
}));

async function bootAt(ordinal) {
  await page.addInitScript((o) => {
    localStorage.clear();
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("party", JSON.stringify(["p003pken", "p005koet", "p004kogu"]));
    localStorage.setItem("charId", "p003pken");
    localStorage.setItem("progressOrdinal", String(o));
  }, ordinal);
  await page.goto(`${ROOT}/index.html?skipTitle=1&map=${STAGE}&noEncounters=1`);
  await page.waitForFunction(() => window.__engine && window.__state?.started, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  // Nothing may be left on screen: the beat's scene must not fire by itself.
  await page.evaluate(() => { if (window.__cutscene.isActive()) window.__cutscene.start([], null, () => {}); });
  await page.waitForFunction(() => !window.__cutscene.isActive() && !window.__textbox.isOpen(),
    null, { timeout: 15000 });
  await page.evaluate(() => {
    window.__eventsFired = [];
    const orig = window.__cutscene.start.bind(window.__cutscene);
    window.__cutscene.start = (...a) => { window.__eventsFired.push(1); return orig(...a); };
  });
}

/** Stand next to Patamon and press confirm. */
async function talk() {
  return page.evaluate(async ([x, y]) => {
    const st = window.__state;
    st.x = x; st.y = y + 24; st.dir = "up";
    for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" }));
    for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
    return { open: window.__textbox.isOpen(), cut: window.__cutscene.isActive() };
  }, [NPC_X, NPC_Y]);
}

/** Page the box through to its close, which is where `on_close` runs. Space, like the box. */
async function closeBox(max = 40) {
  for (let i = 0; i < max; i++) {
    const done = await page.evaluate(async () => {
      for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(r));
      return !window.__textbox.isOpen();
    });
    if (done) return true;
    await page.keyboard.press("Space", { delay: 90 });
    await page.waitForTimeout(140);
  }
  return false;
}

/** Let a scene play itself out: page its dialogue, never touch the field again. */
async function settle(timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const idle = await page.evaluate(async () => {
      for (let i = 0; i < 12; i++) {
        if (window.__textbox.isOpen()) {
          window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
          window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
        }
        for (let j = 0; j < 2; j++) await new Promise((r) => requestAnimationFrame(r));
      }
      return !window.__cutscene.isActive() && !window.__textbox.isOpen();
    });
    if (idle) return true;
  }
  return false;
}

const result = {};
try {
  // ── 1. Story step 24: the beat BEFORE this one. The line shows and the story does not move ──
  await bootAt(24);
  let before = await talk();
  await page.waitForTimeout(400);
  let s = await state();
  result.step24 = { opened: before.open, text: s.text, ordinal: s.ordinal };
  assert.ok(before.open, "story step 24: Patamon is there and their line must be shown");
  assert.ok(s.text.includes(LINE_160), `it is estalk01 #160, which carries no bank-0x90 write (saw ${JSON.stringify(s.text)})`);
  assert.equal(s.ordinal, 24, "and must NOT move the story — this is the regression");
  assert.ok(!fired.includes(FIRED_KEY), "event 695 must not fire at story step 24");
  await page.screenshot({ path: `${out}/1-step24-line.png` });
  await closeBox();

  // ── 2. Story step 25: the line is shown FIRST, and closing it starts the scene ─────────────
  await bootAt(25);
  const t25 = await talk();
  await page.waitForTimeout(400);
  s = await state();
  result.step25 = { opened: t25.open, text: s.text, ordinalBefore: s.ordinal };
  assert.ok(t25.open, "story step 25: Patamon's own line must be shown");
  assert.ok(s.text.includes(LINE_163), `it is estalk01 #163, the line whose on_close writes bank 0x90 (saw ${JSON.stringify(s.text)})`);
  assert.ok(!t25.cut, "and no scene may replace it — in the original the scene comes AFTER the line");
  assert.equal(s.ordinal, 25, "the story has not moved yet");
  await page.screenshot({ path: `${out}/2-step25-line.png` });
  assert.ok(await closeBox(), "the box must close");
  await page.waitForFunction(() => window.__cutscene.isActive(), null, { timeout: 20000 });
  result.step25SceneStarted = true;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/3-step25-scene.png` });

  // ── 3. The scene's completion routine is what writes the story step ───────────────────────
  assert.ok(await settle(), "the scene must finish on its own");
  await page.waitForTimeout(600);
  s = await state();
  result.step25OrdinalAfter = s.ordinal;
  assert.ok(fired.includes(FIRED_KEY),
    `closing estalk01 #163 must start event 695 (flag_key ${FIRED_KEY}); fired ${JSON.stringify(fired)}`);
  assert.equal(fired.filter((k) => k === FIRED_KEY).length, 1,
    "and it starts once — one conversation, one scene");
  assert.equal(s.ordinal, 26, "event 695's completion routine stores story step 26");
  await page.screenshot({ path: `${out}/4-step25-after.png` });

  // ── 4. Step 26: the same sentence, a record whose on_close carries no write ───────────────
  await bootAt(26);
  const t26 = await talk();
  await page.waitForTimeout(400);
  s = await state();
  result.step26 = { opened: t26.open, text: s.text, ordinal: s.ordinal };
  assert.ok(t26.open, "story step 26: Patamon is still there and still talks");
  assert.equal(s.ordinal, 26, "and the story does not move again");
  await page.screenshot({ path: `${out}/5-step26-line.png` });
  assert.ok(await closeBox(), "the box must close");
  await page.waitForTimeout(1200);
  assert.ok(!fired.includes(FIRED_KEY) || fired.filter((k) => k === FIRED_KEY).length === 1,
    "event 695 still fires only for the step-25 conversation");

  result.ok = true;
  result.fired = fired;
  result.errors = errors;
} catch (e) {
  result.ok = false;
  result.error = String(e && e.message ? e.message : e);
  result.fired = fired;
  result.errors = errors;
  result.trace = trace.slice(-20);
  console.error("FAILED:", result.error);
} finally {
  await browser.close();
}
console.log("RESULT " + JSON.stringify(result));
assert.equal(result.ok, true, result.error ?? "");
assert.deepEqual(errors, [], "no page errors");
console.log(`OK — Suzaku Hall: at step 24 the line plays and the story stays at 24; at step 25 Patamon's line ` +
  `starts event 695 and the story moves to step 26; at step 26 the same line starts nothing. Shots in ${out}/`);