import test from "node:test";
import assert from "node:assert/strict";
import { BAND_TEXT_W, fitByWidth, wrapByWidth } from "../web/text-fit.js";

// A proportional stand-in: narrow letters (i l t . ,) 3 px, capitals and w m 8 px, everything else 6 px, space 4 px.
const px = (s) => [...s].reduce((n, c) => n + (" ".includes(c) ? 4 : "ilt.,'".includes(c) ? 3 : "WMwm".includes(c) || (c >= "A" && c <= "Z") ? 8 : 6), 0);

test("text that fits is returned whole (trimmed)", () => {
    assert.equal(fitByWidth("  hello  ", px, 100), "hello");
});

test("fitByWidth cuts at the last word that fits, by pixels not by letter count", () => {
    const text = "Talk to people and explore. New quests unlock as you play.";
    const out = fitByWidth(text, px, BAND_TEXT_W - 100);
    assert.ok(px(out) <= BAND_TEXT_W - 100);
    assert.ok(text.startsWith(out) && out.length < text.length);
    assert.ok(!/\s$/.test(out));
    assert.notEqual(fitByWidth("iiiiiiiiiiiiiiiiiiii end", px, 70), fitByWidth("WWWWWWWWWWWWWWWWWWWW end", px, 70));
});

test("a single word wider than the box is cut letter by letter", () => {
    const out = fitByWidth("WWWWWWWWWWWW", px, 30);
    assert.equal(out, "WWW");
});

test("wrapByWidth: every line fits, no word is lost or reordered", () => {
    const text = "Talk to people and explore. New quests unlock as you play.";
    const lines = wrapByWidth(text, px, 140);
    assert.ok(lines.length >= 2);
    for (const l of lines) assert.ok(px(l) <= 140, l);
    assert.equal(lines.join(" "), text);
});

test("wrapByWidth handles empty text and an over-wide word", () => {
    assert.deepEqual(wrapByWidth("", px, 100), []);
    assert.deepEqual(wrapByWidth(undefined, px, 100), []);
    const lines = wrapByWidth("ok WWWWWWWWWWWW ok", px, 30);
    for (const l of lines) assert.ok(px(l) <= 30, l);
    assert.equal(lines[0], "ok");
});
