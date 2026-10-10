// The game's ordinary NPC talk route draws the translated conversation box.
// Stands in front of the Swamp Inn keeper (s470, NPC 20, an estalkNN line), talks, and asserts:
//   1. window.__dialogueBox (translated) opened, window.__textbox (hand-made) did not hold the dialogue;
//   2. window.__textbox.isOpen() reports open while the translated box is open;
//   3. the session got the talk mode (facing code, no failure), and pressing confirm closes it;
//   4. the on-close effect ran once (the bank-0x7A write opens the inn screen).
// Optional: pass an output dir; --legacy checks the ?legacyTextbox=1 rollback instead.
// Run with: python3 -m http.server 8742 --directory web ; tools/run-playwright.sh tools/verify_dialogue_talk.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const origin = `${baseUrl(8742)}`;
const args = process.argv.slice(2);
const legacy = args.includes("--legacy");
const outDir = resolve(args.find((a) => !a.startsWith("--")) ?? "captures/step-g-dialogue-talk-2026-10-01");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 900, height: 700 },
  storageState: { cookies: [], origins: [{ origin, localStorage: [
    { name: "engineSchema", value: "2" }, { name: "assetMode", value: "authentic" },
    { name: "progressOrdinal", value: "45" }, { name: "charId", value: "p003pken" },
    { name: "party", value: JSON.stringify(["p003pken", "p005koet", "p004kogu"]) },
  ] }] },
});
const page = await context.newPage();
// The translated box must not need the native overlay assets.
await page.route("**/assets/native/**", (r) => r.abort());
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const tap = (k) => page.evaluate((kk) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: kk }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: kk }));
}, k);

await page.goto(`${origin}/?skipTitle=1&map=s470&noEncounters=1${legacy ? "&legacyTextbox=1" : ""}`, { waitUntil: "load" });
await page.waitForFunction(() => window.__state?.started && window.__talkTarget, null, { timeout: 40000 });
await page.waitForTimeout(1000);
for (let i = 0; i < 40; i++) {
  if (!(await page.evaluate(() => window.__textbox.isOpen() || window.__cutscene.isActive()))) break;
  await tap(" "); await page.waitForTimeout(150);
}
await page.evaluate(([x, y]) => window.__teleport(x, y), [357, 278 + 30]);
await page.waitForTimeout(500);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" })));
await page.waitForTimeout(150);
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" })));
await page.waitForTimeout(300);
const target = await page.evaluate(() => window.__talkTarget());
assert.equal(target?.npc, 20, `expected the innkeeper, got ${JSON.stringify(target)}`);

await tap(" ");
let page1 = "", page2 = "";
if (!legacy) {
  // Typewriter + paging check: sample the painted text every ~50 ms.
  const paintedNow = () => page.evaluate(() => {
    const p = window.__dialogueBox?.diagnostics?.().painted;
    return Array.isArray(p) ? p.map((t) => (typeof t === "string" ? t : (t?.text ?? JSON.stringify(t)))).join("\n") : String(p ?? "");
  });
  const samples = [];
  let last = "", stableSince = 0;
  for (let t0 = Date.now(); Date.now() - t0 < 8000;) {
    const cur = await paintedNow();
    if (cur) samples.push(cur);
    if (cur !== last) { last = cur; stableSince = Date.now(); }
    else if (cur && Date.now() - stableSince > 700) break;
    await page.waitForTimeout(50);
  }
  page1 = last;
  assert.ok(page1, "nothing painted on page 1");
  const grew = samples.some((a, i) => a !== page1 && page1.startsWith(a) && a.length < page1.length
    && samples.slice(i + 1).some((b) => b.length > a.length && b.startsWith(a)));
  assert.ok(grew, `painted text did not grow as a typewriter: ${samples.length} samples, first=${JSON.stringify(samples[0])}`);
  await tap(" ");
  for (let t0 = Date.now(); Date.now() - t0 < 8000;) {
    const cur = await paintedNow();
    if (cur && cur !== page1 && !page1.startsWith(cur)) { page2 = cur; break; }
    await page.waitForTimeout(50);
  }
  assert.ok(page2, `page 2 never painted a different text; page 1 was ${JSON.stringify(page1)}`);
  console.log(`page1=${JSON.stringify(page1)}\npage2=${JSON.stringify(page2)}`);
}
await page.waitForTimeout(1200);
const during = await page.evaluate(() => ({
  facade: window.__textbox.isOpen(),
  translated: window.__dialogueBox.isOpen(),
  legacyDialogue: (window.__legacyTextbox ?? window.__textbox).dialogue !== null,
  diag: window.__dialogueBox.diagnostics(),
}));
await page.screenshot({ path: resolve(outDir, legacy ? "talk-legacy.png" : "talk-translated.png") });
assert.ok(during.facade, "window.__textbox must report open");
if (legacy) {
  assert.ok(!during.translated && during.legacyDialogue, "rollback flag must use textbox.js");
} else {
  assert.ok(during.translated, "translated box must be open");
  assert.ok(!during.legacyDialogue, "textbox.js must not hold the dialogue");
  assert.ok(!during.diag.failed, `session failed: ${during.diag.error}`);
  assert.ok(during.diag.ticks > 0 && during.diag.renderer, "session must tick and paint");
}
// Confirm presses close the box; the keeper's second line carries the on_close (bank-0x7A write) that opens
// the rest screen, so a press with the box closed talks again. Count openings to check onClose fires once each.
let sawClosed = false, talks = 1;
for (let i = 0; i < 24; i++) {
  if (await page.evaluate(() => !!window.__inn?.isOpen?.())) break;
  const wasOpen = await page.evaluate(() => window.__textbox.isOpen());
  if (!wasOpen) { sawClosed = true; talks++; }
  await tap(" "); await page.waitForTimeout(450);
}
await page.waitForFunction(() => !!window.__inn?.isOpen?.(), null, { timeout: 6000 }).catch(() => {});
const after = await page.evaluate(() => ({ open: window.__textbox.isOpen(), inn: !!window.__inn?.isOpen?.(),
  closes: window.__dialogueBox.diagnostics().closes }));
assert.ok(sawClosed, "the box must close");
assert.ok(after.inn, "on-close effect (inn screen) must have run");
if (!legacy) assert.ok(after.closes === talks, `onClose fired ${after.closes}x for ${talks} openings`);
assert.deepEqual(errors, [], `page errors: ${errors.join("; ")}`);
console.log(`OK ${legacy ? "legacy" : "translated"} talk: ticks=${during.diag.ticks} state=${JSON.stringify(during.diag.state)} closes=${after.closes} inn=${after.inn}`);
await browser.close();
