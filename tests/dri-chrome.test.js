// Decoded DRI chrome that must not drift back to the measured stand-ins.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class { constructor() { this.onload = null; } set src(_v) {} };
}
globalThis.fetch = async () => ({ json: async () => ({ digimon: [], skills: [], starters: {} }) });

const src = readFileSync(new URL("../web/dri.js", import.meta.url), "utf8");

test("the chart picker uses esdglabo 'See whose chart?', not the digivolve banner", () => {
  assert.match(src, /chart_picker"\) drawPicker\(ctx, rows, "See whose chart\?"\)/);
  assert.doesNotMatch(src, /chart_picker"\) drawPicker\(ctx, rows, "See whose digivolve\?"\)/);
});

test("chart page counter is the F0x800842f4 pair, not a combined 'n/4' at 0xfa", () => {
  assert.match(src, /String\(d\.page \+ 1\), 0xff, 0x19, \{ alignRight: true \}/);
  assert.match(src, /drawText\(ctx, "\/4", 0x101, 0x19\)/);
  assert.doesNotMatch(src, /\$\{d\.page \+ 1\}\/4/);
});

test("chart L1/R1 labels sit at the F0x800842f4 widget anchors", () => {
  assert.match(src, /drawText\(ctx, "L1", 0x27, 0xc4\)/);
  assert.match(src, /drawText\(ctx, "R1", 0x115, 0xc4\)/);
});

test("Select Action back label sits at the F0x80088b5c widget", () => {
  assert.match(src, /drawText\(ctx, "\[triangle\] Button: Back", 0xd3, 0xcc\)/);
});

test("Select Action banner folds around the F0x80089aec pivot", () => {
  assert.match(src, /foldPane\(ctx, d\.folds\?\.banner, 0x140, 0x15/);
  assert.match(src, /foldPane\(ctx, d\.folds\?\.menu, 0x140, 0x45/);
  assert.match(src, /foldPane\(ctx, d\.folds\?\.footer, 0x140, 0xd2/);
});

test("digivolve tech icons still use the boxed cmfont category clips", () => {
  assert.match(src, /drawClip\(ctx, cmfont, 0x37 \+ category, 0xb4, y\)/);
});

test("lab/open can carry party state so the capsule row is not empty", () => {
  assert.match(src, /d\.open = \(onPick = null, onClose = null, state = null\)/);
  const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
  assert.match(game, /driMenu\.open\(null, null, state\)/);
});

test("Select Action dims out over 30 frames instead of closing at once", async () => {
  const { createDriMenu } = await import("../web/dri.js");
  const dri = createDriMenu();
  dri.open();
  dri.handleKey("cross");
  assert.equal(dri.isOpen(), true);
  dri.update(0.3); // 15 frames at 20ms
  assert.equal(dri.isOpen(), true);
  dri.update(0.3); // 30 frames
  assert.equal(dri.isOpen(), false);
});

test("confirming Select Action dims before the sub-screen opens", async () => {
  const { createDriMenu } = await import("../web/dri.js");
  const dri = createDriMenu();
  dri.open(null, null, { party: [] });
  dri.handleKey("circle");
  assert.equal(dri.screen, "root");
  dri.update(0.6);
  assert.equal(dri.screen, "switch_from");
  assert.equal(dri.isOpen(), true);
});

test("the digivolve list keeps a three-row window and pins its scrollbar", () => {
  // F0x8008e018 case 2 + F0x8008a6ac (call site F0x8008e018:51-57).
  assert.match(src, /const SCROLL_BAR_X = 0x122;/);
  assert.match(src, /const SCROLL_BAR_TOP = 0x35;/);
  assert.match(src, /const SCROLL_BAR_BOTTOM = 0x55;/);
  assert.match(src, /drawScrollBar\(ctx, entries\.length, top\)/);
  // The cursor-centred window it replaced must not come back on this list.
  assert.doesNotMatch(src, /Math\.min\(d\.cursor - 2, entries\.length - 3\)/);
});

test("the scroll arrows and the chart cursor use the decoded 8-vsync tick", () => {
  assert.match(src, /const ARROW_BLINK_PERIOD = 8 \* VSYNC_S;/);
  assert.match(src, /const CHART_CLUT_PERIOD = 8 \* VSYNC_S;/);
  assert.doesNotMatch(src, /Math\.floor\(d\.time \* 4\) % 2 === 0\)\s*\{\s*\n\s*if \(top > 0\) drawClip\(ctx, dglab, 0x34, 0x123, 0x2d\);\s*\n\s*if \(top \+ 3 < entries\.length\)/);
});

test("chart plate 0x49 is the empty-page art, not permanent furniture", () => {
  assert.match(src, /if \(builtRows === 0\) \{[\s\S]*drawClip\(ctx, dglab, 0x49, 0x4a, 0x32\);/);
});
