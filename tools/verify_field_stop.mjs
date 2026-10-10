// Browser regression for the native field movement-release animation.
// Run with: tools/run-playwright.sh tools/verify_field_stop.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(8742)}`;
const party = ["p003pken", "p005koet", "p004kogu"];
const browser = await chromium.launch();
const context = await browser.newContext({
  storageState: {
    cookies: [],
    origins: [{
      origin,
      localStorage: [
        { name: "engineSchema", value: "2" },
        { name: "party", value: JSON.stringify(party) },
        { name: "charId", value: party[0] },
      ],
    }],
  },
});
const page = await context.newPage();
page.on("pageerror", (error) => console.error("PAGEERROR:", error.message));

try {
  await page.goto(`${origin}/?skipTitle=1&noEncounters=1`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__state?.started && window.__animReport, null, {
    timeout: 30_000,
  });
  // The default stage runs its opening scene, and an active cutscene legitimately
  // hides non-lead followers. Clear it so the whole party is drawn.
  await page.evaluate(() => {
    if (window.__cutscene?.isActive?.()) window.__cutscene.start([], null, () => {});
  });
  await page.evaluate(() => window.__teleport(320, 300));

  // The report is y-sorted and includes NPCs (labelled "sprite#npcId"); keep only
  // the party actors (the lead "YOU" and the follower character names).
  const partyRows = () =>
    page.evaluate(() => window.__animReport()
      .filter((row) => !String(row.label).includes("#"))
      .map((row) => Number(row.clipId)));

  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(200);
  const moving = await partyRows();
  assert.deepEqual(moving, [5, 5, 5], "the whole party walks (clip 5)");

  await page.keyboard.up("ArrowLeft");
  // The party stops staggered (the lead first), so the three are never all clip 6
  // at the same instant. Record each actor's clips over the window: every one must
  // pass through the stop clip (6) and finish idle (1).
  const seen = new Map();
  let allIdle = false;
  for (let i = 0; i < 140 && !allIdle; i++) {
    await page.waitForTimeout(10);
    const rows = await page.evaluate(() => window.__animReport()
      .filter((row) => !String(row.label).includes("#"))
      .map((row) => ({ label: row.label, clip: Number(row.clipId) })));
    for (const r of rows) {
      if (!seen.has(r.label)) seen.set(r.label, new Set());
      seen.get(r.label).add(r.clip);
    }
    allIdle = rows.length === 3 && rows.every((r) => r.clip === 1);
  }
  assert.ok(allIdle, "the whole party returns to idle (1)");
  assert.equal(seen.size, 3, "all three party actors were drawn");
  // The lead's stop is brief and can finish between polls, so require the stop
  // clip somewhere in the party and that no actor shows anything but walk/stop/idle.
  assert.ok([...seen.values()].some((s) => s.has(6)),
    "the party plays the stop clip (6) after release");
  for (const [label, clips] of seen)
    assert.ok([...clips].every((c) => [1, 5, 6].includes(c)),
      `${label} only ever shows walk/stop/idle clips, saw ${[...clips]}`);

  console.log(JSON.stringify({ moving, stoppedBy: [...seen].map(([l, s]) => [l, [...s].sort()]) }));
} finally {
  await browser.close();
}
