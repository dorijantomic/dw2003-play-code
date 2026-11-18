// Look C kit T6 (web/ui-c/message.js): the message windows -- the field conversation balloon (C6) with its tail, name tab, typed lines and
// more arrow, the system band (C9 9), the help counter's topic page as a band, the place card (C6b) and its slit, and the owners' wiring
// (the old web/ui-css.js overlay is gone). Pure: synthetic draw parts and text runs in, part descriptors out. No browser, no game data.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TAILS, tailGeometry, moreBox, bandRects, balloonBody, nameTab, composeTalk, composeShared, composePlaceCard, placeCardBars, pcColour, PLACE }
    from "../web/ui-c/message.js";
import { composeWindowPage } from "../web/ui-c/pages.js";
import { balloonShape } from "../web/ui-c/parts.js";
import { clipInset, NO_BLEED } from "../web/ui-c/layers.js";
import { ID, N, MSG, balloonPart, moreArrow } from "../web/ui-c/base.js";
import { claimFor } from "../web/ui-c/claims.js";

const run = (text, x, y, o = {}) => ({ text, x, y, kind: 0, face: null, w: text.length * 6, ...o });
const part = (name, x, y, w, h, o = {}) => ({ part: name, x, y, bx: 0, by: 0, w, h, rel: ID, row: 0, ...o });
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const byPart = (out, p) => out.filter((d) => d.part === p);
const texts = (out) => out.filter((d) => d.kind === "text").map((d) => d.text);
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

// ------------------------------------------------------------------------------------------------ claims
test("claims: cmfont balloon pieces + tails under, band halves under, both more markers over (clip 7 = its head box)", () => {
    for (const id of [0, 2]) assert.deepEqual([claimFor("cmfont", id).part, claimFor("cmfont", id).layer], ["balloonCap", "under"]);
    for (const id of [3, 4, 5, 6]) assert.equal(claimFor("cmfont", id).part, "balloonTail");
    for (const id of [8, 9]) assert.deepEqual([claimFor("cmfont", id).part, claimFor("cmfont", id).layer], ["msgBand", "under"]);
    assert.deepEqual([claimFor("cmfont", 7).part, claimFor("cmfont", 7).layer, claimFor("cmfont", 7).box], ["more", "over", [0, 10, 5, 10]]);
    assert.equal(claimFor("cmfont", 10).part, "more");
});

// ------------------------------------------------------------------------------------------------ balloon geometry
test("balloonShape: the C6 inner line runs one edge in, chamfers top-left / bottom-right (C6 inner points)", () => {
    const { outer, inner } = balloonShape({ l: 0, t: 0, w: 363, h: 183 }, null, 4, 24);
    assert.deepEqual(outer, [[24, 0], [363, 0], [363, 159], [339, 183], [0, 183], [0, 24]]);
    assert.deepEqual(inner, [[26, 4], [359, 4], [359, 157], [337, 179], [4, 179], [4, 26]]);
});

test("balloonShape: a bottom tail puts its tip in both lines, the inner tip e px inside the outer one", () => {
    const { outer, inner } = balloonShape({ l: 0, t: 0, w: 300, h: 150 }, { side: "bottom", b0: 200, b1: 250, tip: [205, 190] }, 4, 24);
    assert.ok(outer.some((p) => p[0] === 205 && p[1] === 190), "outer tip");
    const itip = inner.reduce((a, p) => (p[1] > a[1] ? p : a));
    assert.ok(itip[1] < 190 && itip[1] > 150, `inner tip ${itip}`);
    // a tail too short or pointing inside the body is dropped
    assert.equal(balloonShape({ l: 0, t: 0, w: 300, h: 150 }, { side: "bottom", b0: 200, b1: 202, tip: [205, 190] }, 4, 24).outer.length, 6);
    assert.equal(balloonShape({ l: 0, t: 0, w: 300, h: 150 }, { side: "top", b0: 100, b1: 140, tip: [120, 10] }, 4, 24).outer.length, 6);
});

test("tails: clips 3/4 hang below, 5/6 above; the tip on the clip's tip side, the base widened over the clip's wide part", () => {
    assert.deepEqual([TAILS[3].side, TAILS[3].tip, TAILS[6].side, TAILS[6].tip], ["bottom", "left", "top", "right"]);
    const body = { x: 138, y: 17, w: 121, h: 61 };
    const t3 = tailGeometry(3, { x: 232, y: 75, w: 20, h: 16 }, body);
    assert.deepEqual(t3.tip, [235, 91]);
    near(t3.b0, 232 + 6 - MSG.tailWiden); near(t3.b1, 252 + MSG.tailWiden);
    const t6 = tailGeometry(6, { x: 100, y: 120, w: 20, h: 16 }, body);
    assert.deepEqual([t6.side, t6.tip], ["top", [117, 120]]);
    assert.equal(tailGeometry(9, { x: 0, y: 0, w: 1, h: 1 }, body), null);
});

test("balloon body = the two pieces' union less the 2 px drop line; the name tab dodges a top tail", () => {
    const body = balloonBody([part("balloonCap", 137, 17, 111, 63), part("balloonCap", 248, 17, 13, 63), part("balloonTail", 0, 0, 5, 5)]);
    assert.deepEqual(body, { x: 137, y: 17, w: 122, h: 61 });
    const left = nameTab(body, null, 36);
    near(left.x, 137 + MSG.tabIn); near(left.y, 17 - MSG.tabUp); assert.equal(left.w, MSG.tabMinW);
    const dodge = nameTab(body, { side: "top", b0: 140, b1: 160, tip: [145, 5] }, 36);
    assert.ok(dodge.x > 180, `moved right: ${dodge.x}`);
});

// ------------------------------------------------------------------------------------------------ composeTalk
test("composeTalk balloon: one balloon part, name tab + name, typed body lines in balloon ink, the more arrow in balloon orange", () => {
    const parts = [part("balloonCap", 137, 17, 111, 63), part("balloonCap", 248, 17, 13, 63), part("balloonTail", 232, 75, 20, 16, { base: 3 }),
        part("more", 248, 50, 5, 20, { box: [0, 10, 5, 10] })];
    const runs = [run("Junior", 143, 20, { kind: 2 }), run("Hello there,", 150, 33), run("Kid.", 150, 47)];
    const out = composeTalk({ parts, runs });
    const [b] = byPart(out, "balloon");
    assert.ok(b && b.tail && b.tail.side === "bottom", "balloon with its bottom tail");
    assert.equal(byPart(out, "nameTab").length, 1);
    assert.deepEqual(texts(out), ["Junior", "Hello there,", "Kid."]);
    const body = out.filter((d) => d.kind === "text" && d.text !== "Junior");
    assert.ok(body.every((d) => d.color === "var(--c-bln-ink)"), "body ink");
    near(body[0].rect.x, 150 + MSG.textIn);
    const [m] = byPart(out, "more");
    assert.equal(m.fill, "var(--c-bln-more)");
    near(m.rect.x + m.rect.w / 2, 248 + 2.5); near(m.rect.y + m.rect.h / 2, 50 + 15);
    // typed: half a line is just that half (the run is the game's own revealed text)
    assert.deepEqual(texts(composeTalk({ parts, runs: [run("Hel", 150, 33)] })), ["Hel"]);
});

test("composeTalk opening: the growing outline lines are 1 native edge lines, no balloon yet", () => {
    const out = composeTalk({ parts: [], runs: [] }, { lines: [{ points: [100, 50, 140, 50] }, { points: [140, 50, 140, 70] }] });
    assert.equal(byPart(out, "openLine").length, 2);
    assert.deepEqual(byPart(out, "openLine")[1].rect, { x: 140, y: 50, w: 1, h: 21 });
    assert.equal(byPart(out, "balloon").length, 0);
});

test("composeTalk band: the two halves are one band, its wipe scale is the rect; lines are band text; a legacy name sits in a tab above", () => {
    const halves = [part("msgBand", 160, 166, 160, 60), part("msgBand", 0, 166, 160, 60)];
    assert.deepEqual(bandRects(halves).map((b) => b.r), [{ x: 0, y: 166, w: 320, h: 60 }]);
    // the wipe at 50 %: one half scaled about x 320, the other about x 0 (web/textbox.js BAND_ANCHORS) -- two bands until they meet
    const wiping = bandRects([part("msgBand", 160, 166, 160, 60, { rel: { a: 0.5, d: 1, e: 160, f: 0 } }), part("msgBand", 0, 166, 160, 60, { rel: { a: 0.5, d: 1, e: 0, f: 0 } })]);
    assert.deepEqual(wiping.map((b) => b.r), [{ x: 0, y: 166, w: 80, h: 60 }, { x: 240, y: 166, w: 80, h: 60 }]);
    const out = composeTalk({ parts: halves, runs: [run("You got a Meat.", 18, 176), run("Wow.", 18, 190)] }, { name: "Sign" });
    assert.equal(byPart(out, "msgBand").length, 1);
    assert.equal(byPart(out, "msgTab").length, 1, "the orange tab of a band from the left edge");
    assert.deepEqual(texts(out), ["You got a Meat.", "Wow.", "Sign"]);
    assert.equal(byPart(out, "balloon").length, 0);
});

test("composeShared: the more marker and a band half become C on any screen that did not draw them; never twice", () => {
    const parts = [part("more", 285, 208, 12, 12)];
    const out = composeShared(parts, []);
    assert.equal(byPart(out, "more").length, 1);
    assert.equal(byPart(composeShared(parts, [moreArrow("x", { x: 0, y: 0, w: 1, h: 1 })]), "more").length, 1);
    assert.equal(byPart(composeShared([part("msgBand", 0, 166, 320, 60, { pack: "cmfont" })], []), "msgBand").length, 1);
    assert.equal(byPart(composeShared([part("msgBand", 0, 166, 320, 60, { pack: "stfrpt" })], []), "msgBand").length, 0, "the report band is the report's own");
    near(moreBox(part("more", 291, 214, 12, 12)).x, 291);
    assert.deepEqual(moreBox(part("more", 248, 50, 5, 20, { box: [0, 10, 5, 10] })), { x: 248, y: 60, w: 5, h: 10 });
});

test("helpPage: the question window with no cursor is a message band; with a cursor it is still the Yes / No box", () => {
    const win = part("question", 0, 172, 320, 50, { layer: "over" });
    const band = composeWindowPage({ parts: [win], runs: [run("Press the button", 18, 176), run("to use it.", 18, 190)] }, { messageWindow: true });
    assert.equal(byPart(band, "msgBand").length, 1);
    assert.equal(byPart(band, "row").length, 0);
    assert.deepEqual(texts(band), ["Press the button", "to use it."]);
    const yn = composeWindowPage({ parts: [win], runs: [run("Save?", 18, 176), run("Yes", 30, 190), run("No", 30, 204), run("[space2]", 18, 190)] }, { messageWindow: true });
    assert.equal(byPart(yn, "msgBand").length, 0, "the cursor's hidden pose is still a cursor: no flicker to a band");
    // the field Yes / No opens with an empty window (no runs yet): without the owner's word it stays the question box, never a band flash
    assert.equal(byPart(composeWindowPage({ parts: [win], runs: [] }), "msgBand").length, 0);
    assert.equal(byPart(composeWindowPage({ parts: [win], runs: [] }, { messageWindow: true }), "msgBand").length, 1);
    assert.match(read("web/help-menu-translated.js"), /compose: composeHelp/);
});

// ------------------------------------------------------------------------------------------------ place card
const CARD = [
    { x: 0, y: 66, w: 320, h: 31, colour: [0, 0, 128] }, { x: 125, y: 16, w: 116, h: 31, colour: [0, 0, 128] },
    { x: 27, y: 0, w: 9, h: 240, colour: [62, 62, 200] }, { x: 0, y: 81, w: 320, h: 12, colour: [62, 62, 200] }, { x: 124, y: 40, w: 196, h: 3, colour: [62, 62, 200] },
    { x: 227, y: 0, w: 1, h: 240, colour: [0, 228, 255] }, { x: 31, y: 0, w: 1, h: 240, colour: [0, 228, 255] }, { x: 0, y: 86, w: 320, h: 2, colour: [0, 228, 255] },
];

test("place card: bar colours -> C6b tokens, band shadowed, area plate chamfered, thin lines 8 dp kept inside their bar, orange tab", () => {
    assert.equal(pcColour([0, 0, 128]), "var(--c-pc-navy)");
    assert.equal(pcColour([1, 2, 3]), "rgb(1,2,3)");
    const out = placeCardBars(CARD);
    assert.equal(out.length, CARD.length + 1, "one part per quad + the tab, in the game's paint order");
    assert.equal(out[0].part, "pcBand"); assert.equal(out[0].shadow, 6);
    assert.deepEqual([out[1].part, out[1].shape], ["pcPlate", "ch"]);
    const cyanIn = out[6];   // x 31 w 1 inside the narrow blue bar 27..36 -> 4 dp wide (C6b), inside it
    near(cyanIn.rect.w, PLACE.lineIn); assert.ok(cyanIn.rect.x >= 27 && cyanIn.rect.x + cyanIn.rect.w <= 36 + 1e-9, `${cyanIn.rect.x}`);
    const free = out[5];     // x 227 w 1 not inside any bar -> centred
    near(free.rect.x + free.rect.w / 2, 227.5);
    const stripe = out[7];   // y 86 h 2 inside the blue stripe 81..93
    near(stripe.rect.h, PLACE.line); assert.ok(stripe.rect.y >= 81 && stripe.rect.y + stripe.rect.h <= 93 + 1e-9);
    const [tab] = byPart(out, "pcTab");
    near(tab.rect.x + tab.rect.w / 2, 31.5); near(tab.rect.y, 66); near(tab.rect.h, 81 - 66);
});

test("place card names: upper = area 32 / 44 kept inside its plate, lower = place 44 / 58; typed text as the game reveals it", () => {
    const out = composePlaceCard({ runs: [run("Kusanagi", 128, 26), run("Street Corner", 40, 68)] }, { quads: CARD });
    const t = out.filter((d) => d.kind === "text");
    assert.deepEqual(t.map((d) => [d.text, d.sizeDp ?? d.size]), [["Kusanagi", PLACE.areaDp], ["Street Corner", PLACE.placeDp]]);
    assert.ok(t[0].rect.x + t[0].rect.w <= 125 + 116, "area name inside its plate");
    // the quest card hands its names over (no runs)
    assert.deepEqual(composePlaceCard({ runs: [] }, { quads: [], names: [{ text: "Park", x: 128, y: 26 }] }).map((d) => d.text), ["Park"]);
});

test("the slit is the layer's clip: inset() of the snapped rect, a closed slit clips all", () => {
    const limit = { width: 1280, height: 960 };
    assert.equal(clipInset({ left: 0, top: 160, width: 1280, height: 640 }, limit), "inset(160px 0px 160px 0px)");
    assert.equal(clipInset({ left: 0, top: 480, width: 1280, height: 0 }, limit), "inset(480px 0px 480px 0px)");
    assert.ok(NO_BLEED.has("balloon"));
});

// ------------------------------------------------------------------------------------------------ wiring
test("wiring: the four message owners draw inside uiC.scope; the ui-css overlay is gone", () => {
    for (const f of ["web/dialogue-translated.js", "web/textbox.js", "web/placecard-translated.js", "web/placecard.js"]) {
        const s = read(f);
        assert.match(s, /uiC\.scope\(/, f);
        assert.doesNotMatch(s, /ui-css/, f);
    }
    assert.match(read("web/placecard-translated.js"), /clip: slit/);
    assert.match(read("web/dialogue-translated.js"), /uiC\.capturing\(\) && \(kind === "tailLine" \|\| kind === "frameFill"\)/);
    for (const f of ["web/ui-css.js", "web/ui-css-model.js"]) assert.equal(fs.existsSync(new URL(`../${f}`, import.meta.url)), false, f);
    assert.match(read("web/ui-c/index.js"), /composeShared\(seen\.parts/);
});

test("balloonPart keeps body and tail relative to its own box (the DOM scales them with it)", () => {
    const d = balloonPart("b", { x: 138, y: 17, w: 121, h: 61 }, { side: "bottom", b0: 230, b1: 256, tip: [235, 91] });
    assert.deepEqual(d.rect, { x: 138, y: 17, w: 121, h: 74 });
    assert.deepEqual(d.inner, { x: 0, y: 0, w: 121, h: 61 });
    assert.deepEqual(d.tail.tip, [97, 74]);
    near(N(MSG.moreH), 10 / 3);
});
