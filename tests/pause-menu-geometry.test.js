// Positions the pause menu draws, taken from the original overlay (authority 2
// through the m2c decompilation of ststatus). Every number below is quoted with
// the routine that states it, so a change to web/assets/data/status_ui.json
// that drifts from the original fails here rather than on screen.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const ui = JSON.parse(await readFile(
  new URL("../web/assets/data/status_ui.json", import.meta.url), "utf8"));

test("the bag's bottom row is a page counter, not a quantity", () => {
  // F0x80091e94 builds three widgets on y 0x9c and F0x80092340 fills them with
  // the page number, esstatus 4 "/" and the page total.
  const pc = ui.screens.items.page_counter;
  assert.deepEqual(
    [pc.current_x, pc.sep_x, pc.total_x, pc.y],
    [0x9B, 0x9E, 0xB2, 0x9C]);
  assert.equal(pc.sep, "/");
});

test("the bag's shoulder hints sit beside the page arrows", () => {
  // F0x80092340: hidden on the first page (L1) and on the last (R1).
  const I = ui.screens.items;
  assert.deepEqual([I.page_hint_l1.x, I.page_hint_l1.y], [0x2D, 0x97]);
  assert.deepEqual([I.page_hint_r1.x, I.page_hint_r1.y], [0x102, 0x97]);
  assert.equal(I.page_hint_l1.str, "L1");
  assert.equal(I.page_hint_r1.str, "R1");
});

test("the status sheet's EXP and TP labels are widgets of their own", () => {
  // F0x8008b520 builds the value and the label separately; F0x8008d684 and
  // F0x8008c1c0 fill and hide each pair together.
  const D = ui.screens.detail;
  assert.deepEqual([D.exp_value.x, D.exp_value.y], [0x42, 0x45]);
  assert.deepEqual([D.exp_label.x, D.exp_label.y], [0x46, 0x45]);
  assert.equal(D.exp_label.str, "EXP");
  assert.deepEqual([D.tp_label.x, D.tp_label.y], [0x10, 0xCB]);
  assert.deepEqual([D.tp_value.x, D.tp_value.y], [0x2D, 0xCB]);
  assert.equal(D.tp_label.str, "TP");
});

test("the See Digivolve screen carries its own text layout", () => {
  // Was filed as "equip_pick" with only its pictures. The text widgets come
  // from ctor F0x8008833c, which the disassembler's entry list never named.
  const S = ui.screens.see_digivolve;
  assert.equal(ui.screens.equip_pick, undefined);
  assert.deepEqual(
    [S.list_rows.x, S.list_rows.y_base, S.list_rows.pitch, S.list_rows.n,
     S.list_rows.cursor_x],
    [0xBD, 0x31, 0xE, 3, 0xB0]);
  assert.deepEqual(
    [S.action_rows.x, S.action_rows.y_base, S.action_rows.n,
     S.action_rows.cursor_x],
    [0xBD, 0x3A, 2, 0xB4]);
  assert.deepEqual(S.action_rows.row0,
    ["Battle Digivolve On", "Battle Digivolve Off"]);
  assert.equal(S.action_rows.row1, "Techique Explanation");
  // The row at y 0x68 is the stat panel's OWN header — the name of whatever
  // the panel is showing, then "Skill LV", then the level. It was filed as a
  // technique row until capture 03-choose-digivolve.png showed the partner's
  // name in it; F0x80088a44 fills it from a species record, never a technique.
  assert.deepEqual(
    [S.panel_row.name_x, S.panel_row.label_x, S.panel_row.level_x, S.panel_row.y],
    [0x4F, 0xEB, 0x12F, 0x68]);
  assert.equal(S.panel_row.label, "Skill LV");
  assert.equal(S.skill_row, undefined);
  // the element icon column beside the technique slots, and the partner card's
  // own name plate this screen draws (F0x800895c8)
  assert.deepEqual([S.tech_icons.x, S.tech_icons.y_base, S.tech_icons.n],
    [0xB6, 0x88, 6]);
  assert.equal(S.rows, undefined);
  assert.deepEqual([S.name_plate.pack, S.name_plate.clip, S.name_plate.x, S.name_plate.y],
    ["cmfont", 0x18, 0x22, 0xD]);
  // the same six stats and seven resistances as the sheet, in its own columns
  assert.deepEqual([S.stat_values.x, S.stat_values.n], [0x71, 6]);
  assert.deepEqual([S.res_values.x, S.res_values.n], [0x9B, 7]);
  assert.equal(S.stat_values.y_base, 0x7C);
  assert.equal(S.res_values.y_base, 0x7C);
  assert.deepEqual([S.tech_rows.x, S.tech_rows.y_base, S.tech_rows.n], [0xC4, 0x88, 6]);
});

test("SORT's swap marker has two positions and cycles its palette", () => {
  // F0x80096988 tail: clip 0x28/0x29 at x 0x93, y 0x22 or 0x4f, k 0..7 every
  // 11 vsyncs.
  const S = ui.screens.sort.swap_marker;
  assert.deepEqual([S.x, S.y_high, S.y_low], [0x93, 0x22, 0x4F]);
  assert.deepEqual([S.clip_a, S.clip_b], [0x28, 0x29]);
  assert.equal(S.clut_cycle_vsync, 0xB);
});

test("the map's hover label is built at one place and drawn at another", () => {
  // F0x8009913c builds it at (0x14,0x16); F0x80098294 moves it to y 0x19 or
  // 0xb9 before it is ever shown.
  const h = ui.screens.map.hover;
  assert.deepEqual([h.text.ctor_x, h.text.ctor_y], [0x14, 0x16]);
  assert.deepEqual([h.text.x, h.text.y_top, h.text.y_bottom], [0x10, 0x19, 0xB9]);
  assert.equal(h.window.x, 0);
});

test("the CARD FOLDERS window folds about the hinge the original sets", () => {
  // F0x80083c94 .L0x00001518/.L0x00001528: transform_origin(0x140, 0x40) is
  // set immediately before clip 0x3A is drawn at (0xA8, 0x28).
  const w = ui.screens.cardfolder.window;
  assert.deepEqual([w.x, w.y], [0xA8, 0x28]);
  assert.deepEqual(w.pivot, [0x140, 0x40]);
});

test("SORT's swap bracket spans the picked pair, on the upper row", () => {
  // The six (pick, cursor) cases of F0x80096988 .L0x00014654..0x00014768,
  // reduced: upper row of the pair, clip 0x29 for neighbours, 0x28 two apart.
  const S = ui.screens.sort.swap_marker;
  const expect = {
    "1,0": [S.clip_b, S.y_high], "1,2": [S.clip_b, S.y_low],
    "2,0": [S.clip_a, S.y_high], "2,1": [S.clip_b, S.y_low],
    "0,1": [S.clip_b, S.y_high], "0,2": [S.clip_a, S.y_high],
  };
  for (const [key, want] of Object.entries(expect)) {
    const [pick, cursor] = key.split(",").map(Number);
    const top = Math.min(pick, cursor);
    const got = [Math.abs(pick - cursor) === 1 ? S.clip_b : S.clip_a,
      top === 0 ? S.y_high : S.y_low];
    assert.deepEqual(got, want, `pick ${pick}, cursor ${cursor}`);
  }
});
