// The measured reunion route, not a walking simulation: see
// docs/research/scripting/captures/scene-completion-rig-2026-10-03.md.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { baseUrl } from "./verify-base-url.mjs";

const out = process.env.STORY45_SHOT || ".bunny-scratch/story45-after";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
const errors = [], fired = [], trace = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => {
  if (m.text().includes("[STORY]")) trace.push(m.text());
  const hit = m.text().match(/EVENT FIRED (\S+)/);
  if (hit) fired.push(hit[1]);
});
const state = () => page.evaluate(() => ({
  map: window.__state.manifest.maps[window.__state.mapIdx].id,
  ordinal: window.__engine.state.vars.get("$story.ordinal"),
  line: window.__cutscene.speakingLine,
  text: window.__textbox.dialogue?.pages?.flat().join(" ") ?? "",
  open: window.__textbox.isOpen(),
  visitedKusanagi: window.__engine.state.flags.get(0x20d7),
  visitedNext: window.__engine.state.flags.get(0x2076),
}));
let result;
try {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("assetMode", "authentic");
    localStorage.setItem("engineSchema", "2");
    localStorage.setItem("progressOrdinal", "43");
    localStorage.setItem("engineEvents", '["s780.auto.0"]');
  });
  await page.goto(`${baseUrl(8901)}/index.html?skipTitle=1&map=s780&noEncounters=1`);
  await page.waitForFunction(() => window.__engine && window.__state?.started);
  await page.evaluate(() => { window.__gameSpeed = 8; });
  await page.waitForFunction(() => window.__textbox.isOpen(), null, { timeout: 20000 });
  const entry = await state();
  assert.equal(entry.ordinal, 43);
  assert.ok(fired.includes("014a0024"), "arrival must start event 1500");
  assert.ok(!fired.includes("014a0000"), "opening must not replay");
  await page.screenshot({ path: `${out}/entry.png` });
  const deadline = Date.now() + 90000;
  let presses = 0;
  while (Date.now() < deadline) {
    const s = await state();
    if (s.map !== "s780") break;
    // Confirm advances the running arrival event; it does not start a talk event.
    await page.keyboard.press("Enter", { delay: 90 });
    await page.waitForTimeout(80);
    presses++;
  }
  await page.waitForTimeout(500);
  let after = await state();
  if (after.map === "s925") {
    await page.waitForFunction(() => window.__cutscene.speakingLine === 1 &&
      window.__textbox.isOpen(), null, { timeout: 20000 });
    // Let the translated textbox finish revealing its first line, without confirming it.
    await page.waitForTimeout(5000);
    after = await state();
  }
  await page.screenshot({ path: `${out}/destination.png` });
  result = { entry, after, presses, fired, errors, trace };
  assert.equal(after.ordinal, 45, "completion must write ordinal 45");
  assert.equal(after.map, "s925", "movie return must select the post-game field");
  assert.ok(fired.includes("01580000"), "arrival must start event 1600");
  // SAY 0 1 1 0 opens strings[0], not the later Tour Leader speech.
  // esdmg900.json entry 0 strings[1] contains the rig note's "Digimon data...".
  assert.match(after.text, /Huh\?! Ivy and Teddy aren't here\./);
  assert.ok(after.visitedKusanagi && after.visitedNext, "both field entries must mark their screens visited");
  for (let i = 0; i < 30; i++) {
    if ((await state()).line === 2) break;
    await page.keyboard.press("Enter", { delay: 90 });
    await page.waitForTimeout(100);
  }
  await page.waitForFunction(() => window.__cutscene.speakingLine === 2 &&
    window.__textbox.isOpen(), null, { timeout: 20000 });
  const tourLeader = await state();
  assert.match(tourLeader.text, /Digimon data is being used as it was before\./);
  result.tourLeader = tourLeader;
  await page.screenshot({ path: `${out}/tour-leader.png` });
  assert.deepEqual(errors, []);
  console.log("PASS", JSON.stringify(result));
} catch (e) {
  result ??= { after: await state().catch(() => null), fired, errors, trace };
  result.failure = e.message;
  console.error("FAIL", JSON.stringify(result));
  process.exitCode = 1;
} finally {
  writeFileSync(`${out}/proof.json`, JSON.stringify(result, null, 2) + "\n");
  await browser.close();
}
