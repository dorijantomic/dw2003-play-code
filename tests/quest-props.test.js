// Props: our own art left on a map by a quest's state (web/quest-props.js). These tests drive the module with no browser:
// the sheets are defined by hand and the quest layer's own filtering (web/quests.js questPropsOn) is what the field passes
// in, so what is checked here is the layer itself -- which props hold, what they are named, where they sort, and the solid
// foot box.
import test from "node:test";
import assert from "node:assert/strict";

import { defineQuestFxSheet, questFxGet, questFxDrawables, questFxDrawOver, questFxClear } from "../web/quest-fx.js";
import {
    questPropsTick, questPropsState, questPropSolidAt, questPropBoxes, questPropCount,
    questPropsReset, normalize, propFootBox, boxHolds,
} from "../web/quest-props.js";

const SHEET = "unit_frame";
const OTHER = "unit_vase";

function defineSheets() {
    defineQuestFxSheet(SHEET, { frame: [24, 32], anchor: [0.5, 1], clips: { idle: { frames: [0], hold: 30 } }, default: "idle" }, { width: 24, height: 32 });
    defineQuestFxSheet(OTHER, { frame: [16, 16], anchor: [0.5, 1], clips: { idle: { frames: [0], hold: 30 } }, default: "idle" }, { width: 16, height: 16 });
}

const row = (over = {}) => ({ key: "demo#0", sheet: SHEET, x: 100, y: 200, ...over });

test("a prop holds while its quest state says so, and joins the field's one draw list at its feet", () => {
    defineSheets();
    questPropsReset();
    assert.equal(questPropsTick("s200", [row()]), 1);
    assert.equal(questPropCount(), 1);
    const state = questPropsState();
    assert.deepEqual(state.map((p) => [p.key, p.sheet, p.x, p.y, p.onScreen]), [["demo#0", SHEET, 100, 200, true]]);
    // it is an effect of web/quest-fx.js, so the "entity" layer sorts with the people by its feet
    const drawables = questFxDrawables(0, 0);
    assert.equal(drawables.length, 1);
    assert.equal(drawables[0].y, 200);
});

test("a quest state change drops the prop on the next frame, with no reload", () => {
    defineSheets();
    questPropsReset();
    questPropsTick("s200", [row()]);
    assert.ok(questFxGet("prop:demo#0"), "the prop is on the map");
    assert.equal(questPropsTick("s200", []), 0);
    assert.equal(questFxGet("prop:demo#0"), null, "the prop is gone");
    assert.equal(questPropsState().length, 0);
    assert.equal(questPropSolidAt("s200", 100, 195), false);
});

test("two props, one quest: separate keys, no stacking, and only the dropped one goes", () => {
    defineSheets();
    questPropsReset();
    questPropsTick("s200", [row(), row({ key: "demo#1", sheet: OTHER, x: 300, y: 400 })]);
    assert.equal(questPropsState().length, 2);
    questPropsTick("s200", [row()]);
    assert.deepEqual(questPropsState().map((p) => p.key), ["demo#0"]);
    assert.equal(questFxGet("prop:demo#1"), null);
});

test("a duplicate key can never stack two props in one place", () => {
    defineSheets();
    questPropsReset();
    questPropsTick("s200", [row(), row()]);
    assert.equal(questPropsState().length, 1);
});

test("unusable rows are dropped, not thrown: no sheet, no place, no list", () => {
    defineSheets();
    questPropsReset();
    assert.equal(questPropsTick("s200", null), 0);
    assert.equal(questPropsTick("s200", undefined), 0);
    assert.equal(questPropsTick("s200", [null, 7, {}, { sheet: "" }, { sheet: SHEET }, { sheet: SHEET, x: "left", y: 2 }]), 0);
    assert.deepEqual(normalize([{ sheet: SHEET, x: 1, y: 2 }, { sheet: SHEET, x: 1, y: 2 }]).length, 1);
});

test("a sheet that is not in yet places its prop on a later frame (never blocks)", () => {
    questPropsReset();
    assert.equal(questPropsTick("s200", [row({ sheet: "unit_not_yet" })]), 0);
    assert.equal(questPropsState().length, 0);
    defineQuestFxSheet("unit_not_yet", { frame: [24, 24], anchor: [0.5, 1], clips: { idle: { frames: [0], hold: 30 } }, default: "idle" }, { width: 24, height: 24 });
    assert.equal(questPropsTick("s200", [row({ sheet: "unit_not_yet" })]), 1);
});

test("solid: a small box at the feet, and only on the map the prop belongs to", () => {
    defineSheets();
    questPropsReset();
    questPropsTick("s200", [row({ solid: true })]);
    const boxes = questPropBoxes();
    assert.equal(boxes.length, 1);
    assert.deepEqual(boxes[0], { x: 100, y: 200, halfW: 8, depth: 10 });   // 24 px cell * 0.32, rounded
    assert.equal(questPropSolidAt("s200", 100, 200), true, "its feet");
    assert.equal(questPropSolidAt("s200", 107, 194), true, "inside the box");
    assert.equal(questPropSolidAt("s200", 120, 194), false, "beside it");
    assert.equal(questPropSolidAt("s200", 100, 240), false, "in front of it");
    assert.equal(questPropSolidAt("s200", 100, 180), false, "behind it");
    assert.equal(questPropSolidAt("s330", 100, 194), false, "another map");
    // a prop without "solid" never blocks, and a map change moves the boxes with the props
    questPropsTick("s330", [row({ key: "demo#2", solid: true })]);
    assert.equal(questPropSolidAt("s330", 100, 194), true);
    assert.equal(questPropsTick("s330", [row({ key: "demo#3" })]), 1);
    assert.equal(questPropSolidAt("s330", 100, 194), false);
});

test("the foot box scales with the sheet, within sane bounds", () => {
    assert.equal(propFootBox({ x: 0, y: 0 }, 16).halfW, 5);
    assert.equal(propFootBox({ x: 0, y: 0 }, 96).halfW, 12);      // a giant's prop is capped
    assert.equal(propFootBox({ x: 0, y: 0 }, 8).halfW, 4);        // never thinner than a step
    assert.equal(propFootBox({}, "x").halfW, 8);                  // a sheet with no frame yet
    const box = { x: 10, y: 20, halfW: 6, depth: 10 };
    assert.equal(boxHolds(box, 16, 20), true);
    assert.equal(boxHolds(box, 17, 20), false);
    assert.equal(boxHolds(box, 10, 11), true);
    assert.equal(boxHolds(box, 10, 9), false);
});

test("layer front draws over every person; entity sorts with them", () => {
    defineSheets();
    questPropsReset();
    questFxClear();                                   // no scene effects of an earlier test left in the list
    questPropsTick("s200", [row({ key: "demo#f", layer: "front" })]);
    assert.equal(questFxDrawables(0, 0).length, 0, "a front prop is not in the y-sorted list");
    const drawn = [];
    const ctx = { globalAlpha: 1, drawImage: (...args) => drawn.push(args.length), save() {}, restore() {} };
    questFxDrawOver(ctx, 0, 0);
    assert.equal(drawn.length, 1, "it was drawn in the over pass");
});

test("reset (the Quests switch going off) leaves nothing on the map", () => {
    defineSheets();
    questPropsReset();
    questPropsTick("s200", [row(), row({ key: "demo#1", sheet: OTHER, x: 300, y: 400, solid: true })]);
    questPropsReset();
    assert.equal(questPropCount(), 0);
    assert.equal(questPropStateLength(), 0);
    assert.equal(questFxGet("prop:demo#0"), null);
    assert.equal(questPropSolidAt("s200", 100, 195), false);
});

test("a scene's own fx cleanup cannot take a prop with it", () => {
    // questFxClear removes every scene effect (a warp, a fight, a scene ending). Props are re-placed by the next frame's
    // tick, which is what the field does; this checks the two never fight over the same name.
    defineSheets();
    questPropsReset();
    questPropsTick("s200", [row({ solid: true })]);
    questFxClear();
    assert.equal(questFxGet("prop:demo#0"), null, "the scene clear does empty the effect list");
    assert.equal(questPropsTick("s200", [row({ solid: true })]), 1, "and the next tick places it again");
    assert.equal(questFxGet("prop:demo#0") !== null, true);
});

function questPropStateLength() { return questPropsState().length; }
