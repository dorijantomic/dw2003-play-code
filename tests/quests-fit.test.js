// The QUESTS page cuts and wraps by measured width (web/text-fit.js), and the empty page's one line is fitted by the caller.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("web/quests.js measures instead of counting characters, and sends one fitted line for the empty page", () => {
    const quests = read("../web/quests.js");
    assert.doesNotMatch(quests, /cut\(forGameText/, "no character-count cut left");
    assert.doesNotMatch(quests, /wrap\(forGameText\(t\), 36\)/);
    assert.match(quests, /fitByWidth\(forGameText\(t\), W, BAND_TEXT_W\)/);
    assert.match(quests, /wrapByWidth\(forGameText\(t\), W, BAND_TEXT_W\)/);
    assert.match(quests, /emptyLines: wrapToLines\(/);
});

test("the pause session takes that line and no longer carries the 58-character sentence that ran off the band", () => {
    const session = read("../engine/dw3/ui/pause-root-session.ts");
    assert.match(session, /quests\.emptyLines\?\.\[0\] \?\? /);
    assert.doesNotMatch(session, /Talk to people and explore\. New quests unlock as you play\./);
});

test("the empty sentence wraps into 2 lines at 280 px with no word lost", async () => {
    const { wrapToLines } = await import("../web/text-fit.js");
    const EMPTY_SENTENCE = "Explore and talk to people. Quests appear as you play.";
    const px = (s) => s.length * 7;            // the font's load-time fallback width
    const lines = wrapToLines(EMPTY_SENTENCE, px, 280);
    assert.equal(lines.length, 2);
    for (const l of lines) assert.ok(px(l) <= 280, l);
    assert.equal(lines.join(" "), EMPTY_SENTENCE);
});
