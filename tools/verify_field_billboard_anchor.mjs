// tools/verify_field_billboard_anchor.mjs
//
// What the player sees, asserted: a field actor's sprite hangs off the vertical row
// the DISC registers for that frame, not off the walker's own idea of where its feet
// are. The original's field-actor renderer (F0x8008f52c) puts the billboard quad's TOP
// row at the actor's screen row plus the frame's registered Y offset (entity+0xE0), so
// its BOTTOM sits `yOffset + textureHeight` rows below that row
// (fieldstg.s:12919-12940; docs/research/field/field-actor-sprite-anchor-decoded-2026-08-17.md).
// Its drop shadow is drawn on the GROUND row instead, because the renderer adds the
// height term back after the shadow's own primitive (fieldstg.s:13032-13036).
//
// Asserted here:
//  1. Every field billboard drawn at a deterministic open-ground spot sits exactly the
//     number of rows below the actor's ground row that the pack's own manifest entry
//     registers — the value build_assets.py baked from frame-list word 4 plus the
//     frame's own height. A renderer that anchored the cell's bottom on the feet row
//     reads 0 and fails here.
//  2. That number is never zero for the sampled party, so the check can tell a
//     registered draw from a feet-anchored one.
//  3. Every mirrored (right-facing) row carries the SAME vertical number as its
//     left-side source: the original's Y math has no mirror branch
//     (fieldstg.s:12941-12984, where the second facing test reaches only X and U).
//
// tests/field-billboard-anchor.test.js proves each manifest number equals the pack's own
// decodable frame list (word 4 + the frame's texture height) over all 179 packs;
// tools/verify_field_shadow.mjs measures the shadow pixels themselves.
//
// Run: VERIFY_PORT=<port> tools/run-playwright.sh tools/verify_field_billboard_anchor.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { baseUrl } from "./verify-base-url.mjs";

const manifest = JSON.parse(readFileSync(new URL("../web/assets/manifest.json", import.meta.url), "utf8"));
const sprites = [...manifest.characters, ...manifest.npcs];
const byId = new Map(sprites.map((s) => [s.id, s]));

// Every vertical number a sprite's own pack registers, across every row and every frame.
const registeredShifts = new Map();
for (const s of sprites) {
  const vals = [];
  for (const list of Object.values(s.frameBottomShift ?? {})) vals.push(...list);
  for (const per of Object.values(s.clips ?? {})) {
    for (const info of Object.values(per)) vals.push(...(info.bottoms ?? []));
  }
  registeredShifts.set(s.id, [...new Set(vals)].sort((a, b) => a - b));
}

const outDir = resolve(process.argv[2] ?? "/tmp/field-billboard-anchor");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${baseUrl(8742)}/ui-lab.html`, { waitUntil: "load" });
await page.waitForFunction(() => {
  const f = document.getElementById("game");
  return f?.contentWindow?.__labOpen && f.contentWindow.__state?.started;
}, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const frame = page.frames().find((f) => f.url().includes("index.html"));

const actors = await frame.evaluate(() => (window.__lastAnimDebug ?? []).map((d) => ({
  label: d.label, sprite: d.sprite, x: d.x, y: d.y,
})));
await frame.evaluate(() => window.__lastCam);

// One frame's worth of draws, paired with the frame's own debug entries. render() pushes
// each billboard into __billboardDraws and the actor's debug record immediately after, in
// the same pass, so the two lists are in the same order and can be zipped.
const paired = await frame.evaluate(async () => {
  const st = window.__state;
  st.x = 968; st.y = 232;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return window.__billboardDraws().map((d, i) => ({
    draw: { ...d },
    actor: (() => {
      const a = (window.__lastAnimDebug ?? [])[i];
      return a ? { label: a.label, sprite: a.sprite } : null;
    })(),
  }));
});
assert.equal(paired.length, actors.length,
  `the frame drew ${paired.length} billboards but reported ${actors.length} actors`);
const draws = paired.map((p) => p.draw);

await page.locator("#game").screenshot({ path: resolve(outDir, "field.png") });
console.log(`camera ${JSON.stringify(await frame.evaluate(() => window.__lastCam))}`);

// 1. The drawn cell's bottom row is the ground row plus the pack's registered number.
const observed = new Map();
const rows = [];
for (const { actor, draw } of paired) {
  if (!actor) continue;
  const { row, shift, groundRow, cellH, path } = draw;
  const bottomRow = row + cellH;
  assert.equal(bottomRow - groundRow, shift,
    `${actor.label}: the recorded row, cell height and ground row disagree with each other`);
  const registered = registeredShifts.get(actor.sprite);
  assert.ok(registered && registered.length,
    `${actor.label} (${actor.sprite}): the manifest registers no vertical number for this sprite`);
  assert.ok(registered.includes(shift),
    `${actor.label} (${actor.sprite}): its billboard is drawn ${shift} rows below its ground row, ` +
    `but its own pack registers only ${JSON.stringify(registered)} — the draw is not using ` +
    "the disc's number");
  rows.push({ actor, draw });
  console.log(
    `  ${actor.label.padEnd(9)} ${actor.sprite} (${path}): cell rows ${row}..${bottomRow}, ` +
    `ground row ${groundRow}, registered ${shift} (pack registers ${JSON.stringify(registered)})`,
  );
  if (!observed.has(actor.sprite)) observed.set(actor.sprite, new Set());
  observed.get(actor.sprite).add(shift);
}
const samples = rows.map((r) => ({ ...r.actor, draw: r.draw }));


// 2. The check must be able to fail: at least three sampled actors register a non-zero
//    number, so 0 (the feet-anchored placement) is not what the draw produced.
assert.ok(samples.length >= 3, `only ${samples.length} field billboards were sampled`);
const nonZero = samples.filter((s) => s.draw.shift !== 0);
assert.ok(nonZero.length >= 3,
  `only ${nonZero.length} sampled billboards sit off the ground row; every registration in ` +
  "this scene is 0, so this check cannot tell a registered draw from a feet-anchored one");

// 3. Y is never mirrored: a right-facing row carries its left-side source's number.
for (const s of sprites) {
  if (!s.frameBottomShift) continue;
  for (const [left, mirrored] of [["left", "right"], ["down-left", "down-right"], ["up-left", "up-right"]]) {
    if (!s.frameBottomShift[mirrored] || !s.frameBottomShift[left]) continue;
    assert.deepEqual(s.frameBottomShift[mirrored], s.frameBottomShift[left],
      `${s.id}: ${mirrored} registers a different vertical number than ${left}, but the ` +
      "original's Y math has no mirror branch");
  }
}

assert.deepEqual(errors, [], "page errors");
console.log(
  `OK — ${samples.length} field billboards drawn, each sitting exactly its own pack's registered ` +
  `number of rows below its ground row (${[...observed].map(([id, v]) => `${id} ${[...v].join("/")}`).join(", ")}), ` +
  `and every mirrored row carries its left-side source's number.`,
);
console.log(`Screenshot: ${resolve(outDir, "field.png")}`);
await browser.close();