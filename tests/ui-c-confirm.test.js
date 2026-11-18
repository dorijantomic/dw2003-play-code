// Look C kit T5 (web/ui-c): the confirm + quantity parts -- the two-row confirm box (Buy / No, Equip? Yes / No, Sell / No, the card shop's
// BUY / NO, the gym's Yes / No), the field Yes / No question box and the walker's choice list (web/choice.js), the number spinner, the
// header plate over a list ("Not enough BIT.") and the price, the footer's lines and the hint's same-line choices.
// Pure: synthetic draw parts and text runs in, part descriptors out. No browser, no DOM, no game data.
import test from "node:test";
import assert from "node:assert/strict";
import { composeWindowPage } from "../web/ui-c/pages.js";
import { composeWindow } from "../web/ui-c/screens.js";
import { ID, CONFIRM, SPINNER } from "../web/ui-c/base.js";
import { claimFor } from "../web/ui-c/claims.js";
import { choiceScene, CHOICE_BOX, createChoice } from "../web/choice.js";

const run = (text, x, y, o = {}) => ({ text, x, y, kind: 1, face: null, w: text.length * 6, ...o });
const part = (name, x, y, w, h, o = {}) => ({ part: name, x, y, bx: 0, by: 0, w, h, rel: ID, row: 0, ...o });
const byKey = (out, re) => out.filter((d) => re.test(d.key));
const texts = (out) => out.filter((d) => d.kind === "text").map((d) => d.text);
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// ------------------------------------------------------------------------------------------------ claims
test("claims: the confirm boxes, the spinner and its arrows, the question box; the confirm boxes sit over the pictures", () => {
    for (const [pack, id] of [["stshop", 12], ["stcdsp", 45], ["sttrng3", 29]]) {
        assert.deepEqual([claimFor(pack, id).part, claimFor(pack, id).layer], ["confirm", "over"], `${pack} ${id}`);
    }
    assert.deepEqual([claimFor("cmfont", 69).part, claimFor("cmfont", 69).layer], ["question", "over"], "the field Yes / No window 0x45");
    assert.equal(claimFor("stshop", 11).part, "spinner");
    assert.deepEqual([claimFor("stshop", 18).part, claimFor("stshop", 18).layer], ["spinArrows", "over"]);
    assert.equal(claimFor("stshop", 10).part, "header");
    assert.deepEqual([claimFor("stcdsp", 44).part, claimFor("stcdsp", 44).layer], ["header", "over"], "the card price plate over the cards");
});

// ------------------------------------------------------------------------------------------------ the confirm box
const confirmScene = (cursor, cursorY) => ({
    parts: [part("confirm", 100, 60, 120, 40, { layer: "over" })],
    runs: [run("Buy", 130, 68), run("No", 130, 82), run(cursor, 120, cursorY)],
});

test("confirm box: the focused row is the cursor's row, pushed out to 24 dp; plain rows 60 dp in; 40 dp rows, Russo 26 / 40", () => {
    for (const [cy, on] of [[68, 0], [82, 1]]) {
        const out = composeWindowPage(confirmScene("[enter]", cy));
        const plates = byKey(out, /^win0\.row\d\.plate$/);
        assert.equal(plates.length, 2);
        plates.forEach((p, k) => {
            assert.equal(p.shape, k === on ? "rowSolid" : "row", `row ${k}, cursor on ${on}`);
            near(p.rect.x, 100 + (k === on ? CONFIRM.onIn : CONFIRM.plainIn));
            near(p.rect.h, Math.min(CONFIRM.rowH, 14 - 2));
            assert.equal(p.layer, "over", "the rows follow the box's layer");
        });
        const labels = byKey(out, /^win0\.row\d\.label$/);
        assert.deepEqual(labels.map((l) => [l.text, l.sizeDp, l.lineDp]), [["Buy", 26, 40], ["No", 26, 40]]);
        assert.equal(labels[on].color, "var(--c-orange-ink)");
        assert.equal(labels[1 - on].color, null);
        const chev = out.find((d) => d.key === "win0.cursor");
        assert.ok(chev, "the chevron");
        assert.ok(chev.rect.x + chev.rect.w <= 130 - 2, "the chevron stays clear of the label");
        assert.equal(byKey(out, /^win0\.plate$/)[0].layer, "over");
    }
});

test("confirm box: a hidden cursor pose ([space2], the game's blink) keeps the focused row and drops only the chevron", () => {
    const out = composeWindowPage(confirmScene("[enter]", 82));
    const blink = composeWindowPage(confirmScene("[space2]", 82));
    assert.deepEqual(byKey(blink, /row\d\.plate$/).map((p) => p.shape), byKey(out, /row\d\.plate$/).map((p) => p.shape));
    assert.equal(blink.find((d) => d.key === "win0.cursor"), undefined);
});

// ------------------------------------------------------------------------------------------------ the question box + the choice list
test("question box (field Yes / No, cmfont 69 320 x 50): the top line is the prompt, the other lines are confirm rows", () => {
    const scene = (cy) => ({
        parts: [part("question", 0, 172, 320, 50, { layer: "over" })],
        runs: [run("Download your partner Digimon now?", 18, 176), run("Yes, please!", 28, 190), run("Not yet.", 28, 204), run("[select]", 18, cy)],
    });
    for (const [cy, on] of [[190, 0], [204, 1]]) {
        const out = composeWindowPage(scene(cy));
        assert.deepEqual(texts(out), ["Download your partner Digimon now?", "Yes, please!", "Not yet."]);
        assert.ok(out.find((d) => d.key === "win0.prompt.text"), "the prompt is a text line, not a row");
        const plates = byKey(out, /^win0\.row\d\.plate$/);
        assert.deepEqual(plates.map((p) => p.shape), on ? ["row", "rowSolid"] : ["rowSolid", "row"]);
        assert.deepEqual(plates.map((p) => p.layer), ["over", "over"]);
    }
});

test("choiceScene: web/choice.js on the Yes / No box's own frame; bottom at 222, the box grows up with the options", () => {
    const two = choiceScene({ prompt: "Q?", options: ["Yes", "No"], cursorIdx: 0 });
    const b = two.parts[0];
    assert.deepEqual([b.part, b.x, b.y, b.w, b.h], ["question", 0, 172, 320, 50], "two options = the field box exactly");
    assert.deepEqual(two.runs.map((r) => [r.text, r.x, r.y]), [["Q?", 18, 176], ["Yes", 28, 190], ["No", 28, 204], ["[enter]", 18, 190]]);
    const three = choiceScene({ prompt: "Take on this quest?", options: ["Yes", "No", "Maybe later"], cursorIdx: 2 });
    assert.equal(three.parts[0].y + three.parts[0].h, CHOICE_BOX.bottom);
    assert.equal(three.parts[0].h, 64);
    assert.deepEqual(three.runs.at(-1), { text: "[enter]", x: 18, y: three.runs[3].y, kind: 1 }, "the cursor on option 2's line");
});

test("choice list: the focused row index in the descriptors = the session's cursorIdx, after every move", () => {
    const ch = createChoice(null);
    ch.open("Take on this quest?", ["Yes", "No", "Maybe later"], () => {});
    const focused = () => byKey(composeWindow(choiceScene(ch)), /^win0\.row\d\.plate$/).findIndex((p) => p.shape === "rowSolid");
    assert.equal(focused(), 0);
    ch.moveDown(); assert.equal(ch.cursorIdx, 1); assert.equal(focused(), 1);
    ch.moveDown(); ch.moveDown(); assert.equal(focused(), 2, "clamped at the last option");
    ch.moveUp(); assert.equal(focused(), ch.cursorIdx);
    assert.deepEqual(texts(composeWindow(choiceScene(ch))), ["Take on this quest?", "Yes", "No", "Maybe later"]);
});

// ------------------------------------------------------------------------------------------------ the number spinner
test("spinner: orange-edged box, the count Chakra 40 right-anchored on the game's right edge, X dim; arrows on the box's centre line", () => {
    const out = composeWindowPage({
        parts: [part("spinner", 200, 100, 60, 20), part("spinArrows", 256, 97, 8, 20)],
        runs: [run("X", 210, 105), run("12", 238, 105, { right: 250 })],
    });
    assert.equal(out.find((d) => d.part === "spinner").edge, "var(--c-orange)");
    const count = out.find((d) => d.key === "spin0.count");
    assert.deepEqual([count.text, count.role, count.align, count.sizeDp, count.lineDp], ["12", "number", "right", SPINNER.countDp, SPINNER.countLineDp]);
    near(count.rect.x + count.rect.w, 250);
    near(count.rect.y + count.rect.h / 2, 110);
    assert.equal(out.find((d) => d.key === "spin0.x").color, "var(--c-dim-label)");
    const arrows = out.find((d) => d.part === "spinArrows");
    near(arrows.rect.y + arrows.rect.h / 2, 110, 1e-6);   // the box centre, not the arrow clip own centre (107)
    near(arrows.rect.x + arrows.rect.w / 2, 260);
});

// ------------------------------------------------------------------------------------------------ header plates
test("header over a list ('Not enough BIT.' on the buy list): plate over the icons, its own column only, the list text under it covered", () => {
    const out = composeWindowPage({
        parts: [part("listWin", 60, 30, 200, 80), part("header", 150, 35, 200, 22, { shape: "sl" })],
        runs: [run("Not enough BIT.", 170, 42), run("Bandanna", 230, 44)],
    });
    const hdr = out.find((d) => d.part === "header" && d.kind === "plate");
    assert.equal(hdr.layer, "over");
    assert.ok(texts(out).includes("Not enough BIT."));
    assert.ok(!texts(out).includes("Bandanna"), "the overprinted list run is covered, as on the disc");
});

test("header price ('200 BIT'): the number Chakra 34 white, the unit Russo 24 after it", () => {
    const out = composeWindowPage({ parts: [part("header", 150, 35, 120, 22, { shape: "sl" })], runs: [run("200 BIT", 180, 42)] });
    const n = out.find((d) => d.text === "200"), u = out.find((d) => d.text === "BIT");
    assert.deepEqual([n.role, n.sizeDp, n.color], ["number", 34, "var(--c-ink)"]);
    assert.equal(u.sizeDp, 24);
    assert.ok(u.rect.x > n.rect.x + n.rect.w, "the unit after the number");
});

// ------------------------------------------------------------------------------------------------ footer + hint lines
test("footer: a label and its number on one pen line stay one line ('MP 16'), the number right-anchored", () => {
    const out = composeWindowPage({ parts: [part("footer", 0, 200, 320, 40)], runs: [run("MP", 200, 212), run("16", 250, 212, { right: 262 })] });
    const mp = out.find((d) => d.text === "MP"), v = out.find((d) => d.text === "16");
    assert.equal(mp.rect.y, v.rect.y, "same line");
    assert.deepEqual([v.role, v.align], ["number", "right"]);
    near(v.rect.x + v.rect.w, 262);
});

test("hint: runs on one pen line stay side by side at the game's own x (the gym's TP 1 / TP 5 / TP10)", () => {
    const out = composeWindowPage({ parts: [part("hint", 20, 100, 200, 20, { shape: "ch" })], runs: [run("TP 1", 40, 106), run("TP 5", 90, 106), run("TP10", 140, 106)] });
    const t = ["TP 1", "TP 5", "TP10"].map((s) => out.find((d) => d.text === s));
    assert.ok(t.every(Boolean));
    assert.equal(new Set(t.map((d) => d.rect.y)).size, 1, "one line");
    assert.deepEqual(t.slice(1).map((d) => d.rect.x), [90, 140]);
    assert.ok(t[0].rect.x + t[0].rect.w <= 90 && t[1].rect.x + t[1].rect.w <= 140, "no run runs into the next");
});
