// The gym's left HUD text block, and the plates the walker used to fake.
//
// Ledger: GYM-HUD-TEXT-BLOCK-001 (the two stat columns and the name/level/HP/MP
// rows), GYM-SCREEN-PLATES-001 (the fold-gated plates), and
// UI-TEXT-WIDGET-RIGHT-ALIGN-001 (why a number's recorded x is its right edge).
// Doc: docs/research/ui/stgtrain-decoded-2026-07-11.md, section 2026-09-04.
//
// The point of the test is the CORRECTION: before 2026-09-04 the first column
// was shipped as a six-row drill list at a pixel-measured x, its seven-row
// sibling was missing entirely, and every number was glued to its label.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const layout = JSON.parse(
  readFileSync(path.join(ROOT, "web/assets/data/stgtrain_ui.json"), "utf8"));
const gymSrc = readFileSync(path.join(ROOT, "web/gym.js"), "utf8");

test("the HUD's two stat columns are six core and seven resistances", () => {
  const { core, res } = layout.hud_text;
  // F0x80083aec, original assembly 0x80083c24-0x80083c8c: x=0x33 while the
  // counter is < 6, then x=0x5D while it is < 7; both start at 0x4F0000 and
  // add 0xE0000 per row.
  assert.deepEqual(
    { x: core.x, y0: core.y0, stepY: core.stepY, rows: core.rows },
    { x: 51, y0: 79, stepY: 14, rows: 6 });
  assert.deepEqual(
    { x: res.x, y0: res.y0, stepY: res.stepY, rows: res.rows },
    { x: 93, y0: 79, stepY: 14, rows: 7 });
  assert.equal(core.right, true);
  assert.equal(res.right, true);
});

test("the name, level, HP and MP rows sit on their own columns", () => {
  const t = layout.hud_text;
  assert.deepEqual([t.name.x, t.name.y], [51, 19]);
  assert.deepEqual([t.level.labelX, t.level.y, t.level.valueX], [51, 34, 80]);
  for (const [row, y] of [[t.hp, 44], [t.mp, 53]]) {
    assert.deepEqual(
      [row.labelX, row.y, row.curX, row.sepX, row.maxX], [51, y, 93, 95, 128]);
    assert.equal(row.curRight, true);
    assert.equal(row.maxRight, true);
  }
  assert.deepEqual([t.tp.labelX, t.tp.valueX, t.tp.y], [16, 44, 187]);
  assert.equal(t.tp.valueRight, true);
});

test("gym.js no longer carries the pixel-measured stat columns", () => {
  // The old code drew the two columns at x=56 and x=100 and glued each label
  // to its padded number. Both are gone; the file reads the layout instead.
  assert.ok(!/String\(st\?\.stats\?\.\[stat\][^)]*\), 56,/.test(gymSrc));
  assert.ok(!/drawText\(ctx, `HP\$\{pad\(/.test(gymSrc));
  assert.ok(gymSrc.includes("HUD_TEXT"));
});

test("the confirm, session and grid plates are all in the layout", () => {
  const roles = layout.confirm_chrome.plates.map((p) => [p.role, p.clip, p.x, p.y]);
  assert.deepEqual(roles, [
    ["title", 0x25, 143, 15],
    ["banner", 0x26, 133, 67],
    ["icon_frame", 0x2A, 188, 38],
    ["question", 0x27, 130, 94],
    ["result", 0x1D, 130, 94],
    ["prompt", 0x27, 130, 127],
  ]);
  const s = layout.session_chrome;
  assert.deepEqual([s.bar.clip, s.bar.x, s.bar.y], [0x26, 133, 112]);
  assert.deepEqual([s.panel.clip, s.panel.x, s.panel.y], [0x1D, 130, 139]);
  assert.deepEqual(
    [s.description_plate.clip, s.description_plate.x, s.description_plate.y],
    [0x23, 70, 186]);
  // The page arrow and its label swap sides with the page (F0x8008a524 for the
  // clip, F0x8008aad4 for the label).
  const pa = layout.grid_chrome.page_arrow;
  assert.deepEqual([pa.first.clip, pa.first.x, pa.first.labelX, pa.first.y],
    [0x2C, 228, 228, 160]);
  assert.deepEqual([pa.later.clip, pa.later.x, pa.later.labelX, pa.later.y],
    [0x2B, 148, 163, 160]);
});

test("the three places at y=102 are the TP amounts, inside their boxes", () => {
  // CORRECTION 2026-09-04: these were shipped from 2026-07-11 as a
  // before / arrow / after row for the training result. F0x800888bc case 5
  // fills them with the three TP amount labels, and F0x80088348 draws a box
  // behind each one, so each label sits 4 right and 3 down from its box.
  const t = layout.tp_amount_menu;
  assert.deepEqual([t.labelY, ...t.labelsX], [102, 152, 192, 230]);
  assert.deepEqual([t.boxClip, t.boxX0, t.boxStepX, t.boxY], [0x2A, 148, 40, 99]);
  assert.equal(t.cursorClip, 0x29);
  // Each label starts just inside its own box. The third is nudged two pixels
  // further left than the other two, which is the original's own inset, not a
  // rounding of ours: 152-148, 192-188 and 230-228.
  assert.deepEqual(
    t.labelsX.map((x, i) => x - (t.boxX0 + i * t.boxStepX)), [4, 4, 2]);
  assert.equal(t.labelY - t.boxY, 3);
  assert.ok(!("confirm_result" in layout), "the old columns block is gone");
});

test("the Ultra offer, not the TP amounts, owns the rows down the right", () => {
  // F0x80086b24 is built by the SESSION lifecycle, and F0x8008706c fills its
  // three widgets with the Ultra banner and a two-way choice.
  const u = layout.ultra_menu;
  assert.deepEqual([u.bannerX, u.bannerY], [162, 117]);
  assert.deepEqual([u.rowsX, ...u.rowsY], [162, 145, 161]);
  assert.deepEqual([u.cursorX, u.cursorY0, u.cursorStepY], [148, 145, 16]);
  assert.ok(!("tp_menu" in layout), "the mislabelled block is gone");
});

test("the confirm prompt keeps its own rows and cursor", () => {
  const c = layout.confirm_prompt;
  assert.deepEqual([c.headerX, c.headerY], [162, 73]);
  assert.deepEqual([c.amountX, c.amountY], [192, 41]);
  assert.deepEqual([c.rowsX, ...c.rowsY], [162, 100, 116]);
  assert.deepEqual([c.cursorX, c.cursorY0, c.cursorStepY], [148, 100, 16]);
});

test("a finished session says one line on the bottom plate", () => {
  const r = layout.session_result;
  assert.deepEqual([r.lineX, r.lineY], [116, 192]);
  // F0x8008706c case 5 sets the plate's palette byte to 0 (+0x138(0) -> the
  // widget's +0xC0, the row drawText reads as `clut`) and its text reveal
  // rate to 6 (+0x130(6) -> +0xAA, the ticks the widget counts between
  // characters). The old `clut: 6` folded the reveal rate into the palette;
  // corrected 2026-10-06 (stgtrain.s file 0x4a68-0x4aac; fns.s L11134
  // sb $a1,0xc0 / L11119 sh $a1,0xaa).
  assert.equal(r.clut, 0, "the block sets palette 0");
  assert.equal(r.revealRate, 6, "the 6 is the text reveal rate");
});

test("gym.js draws the result line from the layout and keeps no palette-6 reading", () => {
  // The screen consumes the corrected data: the draw call passes the layout's
  // own clut, and the pre-load fallback carries palette 0 and the rate, not
  // the old palette-6 reading.
  assert.ok(gymSrc.includes("{ clut: sr.clut }"));
  assert.ok(!/clut: 6\b/.test(gymSrc), "no palette-6 literal is left");
  const fb = gymSrc.match(/session_result \?\? \{([^}]*)\}/);
  assert.ok(fb, "gym.js has a session_result fallback");
  assert.ok(/clut: 0\b/.test(fb[1]), "the fallback palette is 0");
  assert.ok(/revealRate: 6\b/.test(fb[1]), "the fallback carries the reveal rate");
});

test("the pod row and its beam are in the layout, not only in gym.js", () => {
  const sc = layout.select_chrome;
  assert.deepEqual([sc.pods.x0, sc.pods.stepX, sc.pods.y], [164, 48, 129]);
  assert.deepEqual(
    [sc.pod_cursor.x0, sc.pod_cursor.stepX, sc.pod_cursor.y], [164, 48, 101]);
  // F0x80083aec widget +0x68 is at (0xA1,0x17); the shipped (165,22) was
  // measured off a screenshot.
  assert.deepEqual([sc.top_plate.textX, sc.top_plate.textY], [161, 23]);
});

// ── The TP-amount and confirm screens, from the fold state machine ──────────
// F0x800888bc (gym_confirm_tick) walks one fold at a time, and the ctor
// F0x80088214 supplies the nine text widgets. Reading it settles WHICH plate
// each of the two screens shows, which is what the walker had wrong: the TP
// picker drew the drill icon and the prompt line BEFORE the plates that sit
// over them, so the header came up blank; it drew the amount box that only
// the confirm screen opens; and it sat the Yes/No pair on the short plate.
// Ledger: GYM-CONFIRM-FOLD-STATES-001.

test("the TP picker's plates are the header, the banner and the box row", () => {
  const byRole = Object.fromEntries(
    layout.confirm_chrome.plates.map((p) => [p.role, p]));
  // States 0-5: +0x88 header plate, +0x98 large icon, +0x78 banner,
  // +0xC8 question plate, +0xD8 row cursor. No +0xA8.
  assert.deepEqual([byRole.title.clip, byRole.title.x, byRole.title.y],
    [0x25, 143, 15]);
  assert.deepEqual([byRole.banner.clip, byRole.banner.x, byRole.banner.y],
    [0x26, 133, 67]);
  assert.deepEqual([byRole.question.clip, byRole.question.x, byRole.question.y],
    [0x27, 130, 94]);
  // The boxes sit ON the question plate: it opens at y=94 and they draw at 99.
  assert.equal(layout.tp_amount_menu.boxY - byRole.question.y, 5);
  // The drill name goes on the header plate beside the icon (ctor widget +0x4,
  // filled in state 1 from the drill's own message entry).
  assert.deepEqual(
    [layout.tp_amount_menu.titleX, layout.tp_amount_menu.titleY], [188, 20]);
});

test("the Yes/No pair sits on the tall plate, not the box row's plate", () => {
  const byRole = Object.fromEntries(
    layout.confirm_chrome.plates.map((p) => [p.role, p]));
  // Case 0x10 shuts +0xC8 (the 30-deep question plate) and opens +0xB8
  // instead before case 0x11 writes "Yes" and "No" at y=100 and y=116.
  const tall = byRole.result;
  assert.deepEqual([tall.clip, tall.x, tall.y], [0x1D, 130, 94]);
  // sttrng3 clip 0x1D is 42 rows deep and clip 0x27 is 30 (web/assets/ui/
  // sttrng3_sheet.json), so only the tall one leaves a row's worth of plate
  // under the second option at y=116.
  const rows = layout.confirm_prompt.rowsY;
  const step = layout.confirm_prompt.cursorStepY;
  assert.ok(byRole.question.y + 30 - rows[1] < step, "the short plate cuts it");
  assert.ok(tall.y + 42 - rows[1] >= step, "the tall plate holds it");
});

test("not enough TP opens the prompt plate and writes on it", () => {
  // Cases 0xA-0xD: open +0xE8 (0x27 at (130,127)) and fill the ctor's +0x18
  // widget, which sits at (148,135) -- the anchor recorded as `spare`.
  const prompt = layout.confirm_chrome.plates.find((p) => p.role === "prompt");
  assert.deepEqual([prompt.clip, prompt.x, prompt.y], [0x27, 130, 127]);
  const [wx, wy] = layout.confirm_prompt.spare[0];
  assert.deepEqual([wx, wy], [148, 135]);
  assert.ok(wy > prompt.y && wy < prompt.y + 30, "the line is on that plate");
});

test("gym.js draws the TP screen's plates before what sits on them", () => {
  // lastIndexOf: the same guard opens the key handler earlier in the file.
  const block = gymSrc.slice(gymSrc.lastIndexOf('if (g.screen === "tp") {'));
  const plates = block.indexOf("confirmPlates(ctx, [");
  const icon = block.indexOf("drawLargeDrillIcon(ctx)");
  const prompt = block.indexOf('ROLE("pick_tp_amount")');
  assert.ok(plates >= 0 && icon > plates, "the icon draws after the plates");
  assert.ok(prompt > plates, "the prompt line draws after the plates");
  const roles = block.slice(plates, block.indexOf("]", plates));
  assert.ok(roles.includes('"title"') && roles.includes('"banner"'));
  assert.ok(roles.includes('"question"'));
  assert.ok(!roles.includes('"icon_frame"'), "the amount box is not open yet");
  // The confirm screen keeps the box, and takes the tall plate.
  const cblock = gymSrc.slice(gymSrc.lastIndexOf('if (g.screen === "confirm") {'));
  const croles = cblock.slice(cblock.indexOf("confirmPlates(ctx, ["),
    cblock.indexOf("]", cblock.indexOf("confirmPlates(ctx, [")));
  assert.ok(croles.includes('"icon_frame"') && croles.includes('"result"'));
  assert.ok(!croles.includes('"question"'), "the short plate is shut by 0x10");
});

// ── The words, from the game's own message bank ─────────────────────────────
// Every fill site on this screen passes bank 0x10B, and that bank is the
// language file lang_file/dw2003/eng/estraini.toml. Two passes on 2026-09-04
// said "the wording is not established, the message file is not extracted".
// It was extracted all along. Ledger: GYM-SCREEN-WORDS-001.

test("the screen's words are the game's own, at the indices it asks for", () => {
  const st = layout.strings;
  assert.equal(st.bank, 0x10B);
  assert.equal(st.all.length, 118);
  const r = st.roles;
  assert.equal(st.all[r.pick_tp_amount], "Pick TP amount to use.");
  assert.equal(st.all[r.is_this_ok], "Is this ok?");
  assert.equal(st.all[r.yes], "Yes");
  assert.equal(st.all[r.no], "No");
  assert.equal(st.all[r.which_training], "Which training?");
  assert.equal(st.all[r.train_which_digimon], "Train which Digimon?");
  assert.equal(st.all[r.not_enough_tp], "Not enough TP.");
  assert.equal(st.all[r.ultra_chance], "Ultra Training Chance!");
  assert.deepEqual(r.tp_amounts.map((i) => st.all[i]), ["TP 1", "TP 5", "TP10"]);
  assert.deepEqual([st.all[r.challenge], st.all[r.as_is]], ["Challenge", "As is"]);
  assert.equal(st.all[r.page_labels.next], "R1");
  assert.equal(st.all[r.page_labels.prev], "L1");
  assert.equal(st.all[r.hud_labels.separator], "/");
});

test("a drill's name and its line under it are one index apart, by 24", () => {
  const st = layout.strings, r = st.roles;
  assert.equal(r.drill_name_base, 0x13);
  assert.equal(r.drill_desc_offset, 24);
  assert.equal(st.all[0x13], "Punch");
  assert.equal(st.all[0x13 + 24], "Train Digimon's strength.");
  assert.equal(st.all[0x17], "Jump Rope");
  assert.equal(st.all[0x17 + 24], "Train Digimon's speed.");
  assert.equal(st.all[0x2A], "Super Haunting");
  assert.equal(st.all[0x2A + 24], "Become stronger against dark!");
});

test("what a finished session says is the bank's own template", () => {
  const st = layout.strings, r = st.roles;
  // F0x8008706c case 5: nothing gained, one number, or two.
  assert.equal(st.all[r.result_none], "Results:\\nNothing increased...[pause]");
  // A core drill: base + the drill's own stat id (1..5).
  assert.equal(st.all[r.result_core_base + 1],
    "Results:\\nPower is up by {1}![pause]");
  assert.equal(st.all[r.result_core_base + 5],
    "Results:\\nSpeed is up by {1}![pause]");
  // A resistance drill on its own: elem base + its id (8..14).
  assert.equal(st.all[r.result_elem_base + 8],
    "Results:\\nFire Defense is up by {1}![pause]");
  assert.equal(st.all[r.result_elem_base + 14],
    "Results:\\nDark Defense is up by {1}![pause]");
  // A resistance drill that moves a second stat too: two base + its id.
  assert.equal(st.all[r.result_two_base + 8],
    "Results:[pause][clear]Fire Defense is up by {1}!\\nMaximum MP is up by {2}![pause]");
  assert.equal(st.all[r.result_two_base + 14],
    "Results:[pause][clear]Dark Defense is up by {1}!\\nSpirit is down by {2}...[pause]");
});

test("gym.js carries no English of its own for this screen", () => {
  // The three tables it used to keep -- names, descriptions, amounts -- are
  // gone, and no drawText call is handed a hand-typed line any more. The one
  // literal left is the shared cursor glyph token, which is not a word.
  for (const gone of ["DRILL_NAMES", "DRILL_DESCS", "TP_LABELS"])
    assert.ok(!gymSrc.includes(gone), `${gone} is still in web/gym.js`);
  const literals = [...gymSrc.matchAll(/drawText\(ctx, "([^"]*)"/g)]
    .map((m) => m[1]);
  assert.deepEqual([...new Set(literals)], ["[arrow-right]"]);
  assert.ok(gymSrc.includes("LAYOUT?.strings?.all"), "it reads the bank");
});
