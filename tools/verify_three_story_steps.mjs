// The three story steps the progression solver once reported as SKIPPED rather than wired:
// 0x07 (South Station), 0x0e (Asuka City Main Lobby) and 0x19 (Byakko City Underground Cave).
// Driven through the REAL web/game.js in the browser — no mock, no engine call.
//
// THE THING BEING PROVEN, in the order a player meets it:
//
//   1. STEP 0x07 — walk into the South Sector's South Station with the story one step short
//      (step 6) and the station's own scene plays by itself; when it finishes the story is at
//      step 7. Come in one step earlier (step 5) and NOTHING plays: the station tests the story
//      step, and at 5 the test fails. (producer: wstag440.s:58-61, event 152's completion
//      routine; start site: pro/wstag440.s:24-29 → start_event 0x800853f8 with $a0=0x98.)
//
//   2. STEP 0x0e — with the story at step 13, Asuka City's Main Lobby plays nothing, because
//      that scene also needs the flag the Master Room's scene sets. Go to the Master Room: its
//      scene plays and sets that flag. Come back to the Main Lobby and the scene plays, and
//      when it finishes the story is at step 14. (producer: wstag212.s:447-450, event 352;
//      start site: pro/wstag212.s:363-374 → get_flag(0x1c0d) then start_event with $a0=0x160.)
//
//   3. STEP 0x19 — in the Underground Cave at step 24 nothing starts on its own. Speak to the
//      General: his line at that step is estalk01 #369, "…Hmm?! Who are you?", and the SCENE
//      starts when you finish reading it — not instead of it. When that scene finishes the story
//      is at step 25. (producer: wstag685.s:75-78, event 690; there is no trigger row anywhere:
//      the line's closing write 0x9043 goes through the bank-0x90 talk launcher.)
//
// Decode:  docs/research/story-progression/README.md "Who writes each story step, and who reads it"
// Shared systems under test: engine/systems/scene-arrival.ts, engine/systems/scene-completion.ts,
//          engine/systems/talk-launch.ts
// Pins:    tests/story-robot.test.js (the census), tools/story_robot.ts (skipped list empty)
//
// Server: python3 -m http.server <port> --directory web
// Run:    VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_three_story_steps.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.env.THREESTEPS_SHOT || ".bunny-scratch/three-story-steps";
mkdirSync(out, { recursive: true });
const ROOT = `${baseUrl(8991)}/`;

// event flag_keys, straight out of web/assets/events/wstag_events.json
const KEY_S440 = "01350006";   // s440 event 152 — writes step 0x07
const KEY_S305 = "012e0000";   // s305 event 350 — sets the gate flag 0x1c0d
const KEY_S212 = "01120020";   // s212 event 352 — writes step 0x0e
const KEY_S685 = "0143001b";   // s685 event 690 — writes step 0x19
const GENERAL_LINE = "Who are you";         // estalk01 #369, the step-24 line
const GENERAL_X = 560, GENERAL_Y = 449;    // npc 152 in web/assets/scenes/s685.json

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [], fired = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  const hit = m.text().match(/EVENT FIRED (\S+)/);
  if (hit) fired.push(hit[1]);
});

const state = () => page.evaluate(() => ({
  map: window.__state.manifest.maps[window.__state.mapIdx].id,
  ordinal: Number(window.__engine.state.vars.get("$story.ordinal")),
  open: window.__textbox.isOpen(),
  text: window.__textbox.dialogue?.pages?.flat().join(" ") ?? "",
  cut: window.__cutscene.isActive(),
  flag1c0d: window.__engine.state.flags.get(0x1c0d, 1),
}));

/** Boot the real game at a given story step in a given place, with nothing left on screen. */
async function bootAt(stage, ordinal) {
  await page.addInitScript(([map, ord]) => {
    localStorage.clear();
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("progressOrdinal", String(ord));
    localStorage.setItem("playerName", "Junior");
    localStorage.setItem("charId", "p005koet");
    localStorage.setItem("party", JSON.stringify(["p005koet", "p006agum", "p009rena"]));
    localStorage.setItem("packId", "B");
    localStorage.setItem("bits", "1000");
    localStorage.setItem("inventory", "[]");
  }, [stage, ordinal]);
  await page.goto(`${ROOT}index.html?skipTitle=1&map=${stage}&noEncounters=1`);
  await page.waitForFunction(() => window.__engine && window.__state?.started, null, { timeout: 30000 });
  await page.waitForTimeout(2000);
}

/** Page whatever dialogue is up until the field is idle again (a scene runs on its own timeline). */
async function settle(timeout = 120000) {
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

/** Move to another place the way the game's own screen change does, keeping every flag:
 *  load the place, then run the stage-entry dispatch — the same two steps the fade-out at
 *  web/game.js:6277 performs (`checkStageCutscene` → `engineBridge.onStageEnter`). Nothing
 *  here sets a story flag: the flag the Master Room's scene writes must arrive from the scene. */
async function travelTo(stage) {
  await page.evaluate(async (id) => {
    const idx = window.__state.manifest.maps.findIndex((m) => m.id === id);
    await window.__setMap(idx);
    window.__engineBridge.onStageEnter(id);
  }, stage);
  await page.waitForTimeout(1500);
}

/** Stand next to somebody and press confirm, exactly as a player would. */
async function talk(x, y) {
  return page.evaluate(async ([nx, ny]) => {
    const target = window.__talkTarget?.();
    const st = window.__state;
    st.x = nx; st.y = ny + 24; st.dir = "up";
    for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter" }));
    for (let i = 0; i < 14; i++) await new Promise((r) => requestAnimationFrame(r));
    return { target, open: window.__textbox.isOpen(), cut: window.__cutscene.isActive() };
  }, [x, y]);
}

/** Page the textbox to its close — that is where a conversation's on_close write happens. */
async function closeBox(max = 60) {
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

const result = { steps: [] };
try {
  // ── 1. Step 0x07, South Station ────────────────────────────────────────────────────────────
  // 1a. One step early: the station tests the story step, so nothing may play.
  await bootAt("s440", 5);
  let s = await state();
  result.steps.push({ step: "0x07 early", ordinal: s.ordinal, cut: s.cut });
  assert.equal(s.map, "s440", "booted in the South Station");
  assert.equal(s.ordinal, 5, "booted at story step 5");
  assert.ok(!s.cut, "story step 5: the station's scene must not play");
  assert.ok(!fired.includes(KEY_S440), `story step 5: event 152 must not fire (fired ${fired.join(",")})`);
  await page.screenshot({ path: `${out}/1-step05-nothing.png` });

  // 1b. The step the station's scene belongs to: it plays by itself and stores step 7.
  await bootAt("s440", 6);
  await page.waitForFunction(() => window.__cutscene.isActive(), null, { timeout: 25000 })
    .catch(() => { throw new Error("story step 6: the South Station's scene did not start on arrival"); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/2-step06-scene.png` });
  assert.ok(fired.includes(KEY_S440), `the scene that plays must be event 152 (${KEY_S440}); fired ${fired.join(",")}`);
  assert.equal(fired.filter((k) => k === KEY_S440).length, 1, "and it plays once");
  assert.ok(await settle(), "the scene must finish on its own");
  await page.waitForTimeout(600);
  s = await state();
  result.steps.push({ step: "0x07", ordinal: s.ordinal });
  assert.equal(s.ordinal, 7, "event 152's completion routine stores story step 7");
  await page.screenshot({ path: `${out}/3-step07-after.png` });

  // ── 2. Step 0x0e, Asuka City Main Lobby (needs the Master Room first) ─────────────────────
  await bootAt("s212", 13);
  s = await state();
  result.steps.push({ step: "0x0e before", ordinal: s.ordinal, flag1c0d: s.flag1c0d, cut: s.cut });
  assert.equal(s.ordinal, 13, "booted at story step 13");
  assert.equal(s.flag1c0d, false, "and the Master Room's flag is not set yet");
  assert.ok(!s.cut, "story step 13 with that flag clear: the Main Lobby's scene must not play");
  assert.ok(!fired.includes(KEY_S212), `event 352 must not fire (fired ${fired.join(",")})`);
  await page.screenshot({ path: `${out}/4-step13-waits.png` });

  await travelTo("s305");
  await page.waitForFunction(() => window.__cutscene.isActive(), null, { timeout: 25000 })
    .catch(() => { throw new Error("story step 13: the Master Room's scene did not start on arrival"); });
  await page.screenshot({ path: `${out}/5-master-room-scene.png` });
  assert.ok(fired.includes(KEY_S305), `the Master Room's scene must be event 350 (${KEY_S305}); fired ${fired.join(",")}`);
  assert.ok(await settle(), "the Master Room's scene must finish on its own");
  await page.waitForTimeout(600);
  s = await state();
  result.steps.push({ step: "master room", map: s.map, flag1c0d: s.flag1c0d });
  assert.equal(s.flag1c0d, true, "event 350's completion routine sets the flag the Main Lobby's scene needs");

  await travelTo("s212");
  await page.waitForFunction(() => window.__cutscene.isActive(), null, { timeout: 25000 })
    .catch(() => { throw new Error("coming back to the Main Lobby, its scene must start"); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/6-main-lobby-scene.png` });
  assert.ok(fired.includes(KEY_S212), `that scene must be event 352 (${KEY_S212}); fired ${fired.join(",")}`);
  assert.ok(await settle(), "the Main Lobby's scene must finish on its own");
  await page.waitForTimeout(600);
  s = await state();
  result.steps.push({ step: "0x0e", ordinal: s.ordinal });
  assert.equal(s.ordinal, 14, "event 352's completion routine stores story step 14");
  await page.screenshot({ path: `${out}/7-step14-after.png` });

  // ── 3. Step 0x19, Byakko City Underground Cave (a conversation starts it) ──────────────────
  await bootAt("s685", 24);
  s = await state();
  result.steps.push({ step: "0x19 before", ordinal: s.ordinal, cut: s.cut });
  assert.equal(s.map, "s685", "booted in the Underground Cave");
  assert.equal(s.ordinal, 24, "booted at story step 24");
  assert.ok(!s.cut, "story step 24: nothing may start by itself");
  assert.ok(!fired.includes(KEY_S685), `event 690 must not fire on arrival (fired ${fired.join(",")})`);
  await page.screenshot({ path: `${out}/8-step24-cave.png` });

  const t = await talk(GENERAL_X, GENERAL_Y);
  await page.waitForTimeout(500);
  s = await state();
  result.steps.push({ step: "0x19 talk", target: t.target, open: t.open, text: s.text, ordinal: s.ordinal });
  assert.ok(t.open, "the General must answer — his line is shown, not replaced by a scene");
  assert.ok(s.text.includes(GENERAL_LINE), `it must be estalk01 #369 (saw ${JSON.stringify(s.text)})`);
  assert.ok(!t.cut, "and no scene may replace the line: on the disc the scene comes after it");
  assert.equal(s.ordinal, 24, "the story has not moved yet");
  await page.screenshot({ path: `${out}/9-step24-line.png` });

  assert.ok(await closeBox(), "the textbox must close");
  await page.waitForFunction(() => window.__cutscene.isActive(), null, { timeout: 25000 })
    .catch(() => { throw new Error("finishing the General's line must start the scene"); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/10-step24-scene.png` });
  assert.ok(fired.includes(KEY_S685), `closing estalk01 #369 must start event 690 (${KEY_S685}); fired ${fired.join(",")}`);
  assert.equal(fired.filter((k) => k === KEY_S685).length, 1, "and one conversation starts it once");
  assert.ok(await settle(), "the scene must finish on its own");
  await page.waitForTimeout(600);
  s = await state();
  result.steps.push({ step: "0x19", ordinal: s.ordinal });
  assert.equal(s.ordinal, 25, "event 690's completion routine stores story step 25");
  await page.screenshot({ path: `${out}/11-step25-after.png` });

  result.ok = true;
  result.fired = fired;
  result.errors = errors;
} catch (e) {
  result.ok = false;
  result.error = String(e && e.message ? e.message : e);
  result.fired = fired;
  result.states = await page.evaluate(() => ({
    map: window.__state?.manifest?.maps?.[window.__state.mapIdx]?.id,
    ordinal: Number(window.__engine?.state?.vars?.get("$story.ordinal")),
  })).catch(() => null);
  result.errors = errors;
  console.error("FAILED:", result.error);
} finally {
  await browser.close();
}
console.log("RESULT " + JSON.stringify(result));
assert.equal(result.ok, true, result.error ?? "");
assert.deepEqual(errors, [], "no page errors");
console.log(`OK — story steps 0x07, 0x0e and 0x19 each arrive through the place's own scripts: the ` +
  `South Station's scene on arrival at step 6, the Main Lobby's scene after the Master Room's, and ` +
  `the Underground Cave's scene after the General's line at step 24. Shots in ${out}/`);
