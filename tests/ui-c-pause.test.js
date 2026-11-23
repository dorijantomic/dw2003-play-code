// Look C pause home (design file C1): the composer turns the game's own draw-call parts and text runs into part descriptors. Pure.
// Fixtures hold ids, positions and strings only (taken from a live run of the home with the three starters).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { composePauseHome, readCardRuns } from "../web/ui-c/home.js";
import { IDENTITY, applyRel, dx, dy, snapRect } from "../web/ui-c/geometry.js";

const src = (f) => readFileSync(new URL(`../web/${f}`, import.meta.url), "utf8");
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

const part = (name, x, y, rel = IDENTITY) => ({ part: name, x, y, rel });
const parts = (rel = IDENTITY) => [
    part("card", 0, 17, rel), part("cardName", 0, 17, rel), part("card", 0, 63, rel), part("cardName", 0, 63, rel), part("card", 0, 109, rel), part("cardName", 0, 109, rel),
    part("header", 34, 13, rel), part("panel", 168, 40, rel), part("money", 0, 158, rel),
];
const run = (text, x, y, right = null) => ({ text, kind: 2, clut: 0, x, y, right, glyphs: [] });
const cardRuns = (y, name, lv, hp, hpm, mp, mpm) => [
    run(name, 55, y + 2), run("LV", 16, y + 11), run(String(lv), 37, y + 11, 44),
    run("HP", 16, y + 20), run(String(hp), 45, y + 20, 59), run("/", 61, y + 20), run(String(hpm), 80, y + 20, 94),
    run("MP", 16, y + 29), run(String(mp), 45, y + 29, 59), run("/", 61, y + 29), run(String(mpm), 80, y + 29, 94),
];
const LABELS = ["ITEMS", "SORT", "MAP", "TECHNIQUES", "STATUS", "CARD FOLDERS", "QUESTS", "GLOSSARY", "OPTIONS"];
const runs = (cursor = "[enter]", cursorRow = 0) => [
    ...cardRuns(17, "Kotemon", 1, 86, 86, 38, 38), ...cardRuns(63, "Renamon", 1, 80, 80, 40, 40), ...cardRuns(109, "Patamon", 1, 45, 90, 55, 55),
    run("[triangle]Button: Close Status", 152, 19),
    ...LABELS.map((l, i) => run(l, 189, 49 + 14 * i)), run(cursor, 176, 49 + 14 * cursorRow),
    run("500", 45, 166, 66), run("BIT", 70, 166),
];
const by = (list, key) => list.find((d) => d.key === key);

// ------------------------------------------------------------------------------------------------ the list
test("home: nine rows, 14 native apart, 12 high; the cursor row is pushed out 12 native and orange", () => {
    const d = composePauseHome({ parts: parts(), runs: runs("[enter]", 0) });
    const rows = d.filter((x) => /^row\d+\.plate$/.test(x.key));
    assert.equal(rows.length, 9);
    rows.forEach((r, i) => { near(r.rect.y, 48 + 14 * i); near(r.rect.h, 12); near(r.rect.x, i === 0 ? 168 : 180); });
    assert.equal(rows[0].shape, "rowSolid"); assert.equal(rows[0].edge, "var(--c-orange)");
    assert.equal(rows[1].shape, "row"); assert.equal(rows[1].edge, "var(--c-under)"); assert.equal(rows[1].body, "var(--c-body)");
    const labels = d.filter((x) => /^row\d+\.label$/.test(x.key));
    assert.deepEqual(labels.map((l) => l.text), LABELS);
    assert.equal(labels[0].color, "var(--c-orange-ink)"); assert.equal(labels[1].color, null);
    labels.forEach((l, i) => { near(l.rect.x, 188); near(l.rect.y, 48 + 14 * i); assert.equal(l.role, "label"); assert.equal(l.sizeDp, 24); });
});

test("home: the pushed-out row follows the game's cursor, on any row", () => {
    for (const row of [0, 4, 8]) {
        const d = composePauseHome({ parts: parts(), runs: runs("[enter]", row) });
        const rows = d.filter((x) => /^row\d+\.plate$/.test(x.key));
        rows.forEach((r, i) => assert.equal(r.shape, i === row ? "rowSolid" : "row", `cursor ${row} row ${i}`));
        near(by(d, "row.cursor").rect.y, 48 + 14 * row + 8 / 3, 1e-6);
    }
});

test("home: the four cursor glyphs are four chevron poses (normal, enlarged, flattened, hidden)", () => {
    const rect = (tok) => by(composePauseHome({ parts: parts(), runs: runs(tok, 0) }), "row.cursor")?.rect;
    const n = rect("[enter]"), big = rect("[enter2]"), flat = rect("[select]");
    near(n.w, 10); near(n.h, 20 / 3);
    assert.ok(big.w > n.w && big.h > n.h);
    near(flat.w, n.w); assert.ok(flat.h < n.h);
    assert.equal(rect("[space2]"), undefined, "no chevron in the hidden pose");
    const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];
    for (const r of [big, flat]) { near(centre(r)[0], centre(n)[0]); near(centre(r)[1], centre(n)[1]); }
});

test("home: the wall and the faint MENU word follow the row count", () => {
    const d = composePauseHome({ parts: parts(), runs: runs() });
    const w = by(d, "panel.wall");
    near(w.rect.x, dx(624)); near(w.rect.y, 40); near(w.rect.h, 440 / 3);
    const t = by(d, "panel.type");
    assert.equal(t.text, "MENU"); near(t.rect.x, 180); near(t.rect.y, 566 / 3); assert.equal(t.sizeDp, 140);
    const six = composePauseHome({ parts: parts(), runs: runs().filter((r) => !["GLOSSARY", "OPTIONS", "QUESTS"].includes(r.text)) });
    near(by(six, "panel.wall").rect.h, 440 / 3 - 3 * 14);
});

// ------------------------------------------------------------------------------------------------ cards, money, header
test("home: three party cards from the draw calls and the game's own text", () => {
    const d = composePauseHome({ parts: parts(), runs: runs() });
    for (let i = 0; i < 3; i++) {
        const p = by(d, `card${i}.plate`);
        near(p.rect.x, dx(0)); near(p.rect.y, 17 + 46 * i); near(p.rect.w, 500 / 3); near(p.rect.h, 42);
        assert.equal(p.shape, "sr");
        assert.equal(by(d, `card${i}.slot`).text, `0${i + 1}`);
    }
    assert.deepEqual([0, 1, 2].map((i) => by(d, `card${i}.name`).text), ["Kotemon", "Renamon", "Patamon"]);
    assert.equal(by(d, "card0.lv").text, "LV 1");
    assert.equal(by(d, "card0.hpnum").text, "86/86"); assert.equal(by(d, "card2.hpnum").text, "45/90");
    assert.equal(by(d, "card1.mpnum").text, "40/40");
    assert.equal(by(d, "card0.hplabel").text, "HP"); assert.equal(by(d, "card0.mplabel").text, "MP");
    near(by(d, "card1.name").rect.x, dx(314)); near(by(d, "card1.name").rect.y, 63 + -2 / 3);
    assert.equal(by(d, "card0.hpnum").align, "right"); near(by(d, "card0.hpnum").rect.x + by(d, "card0.hpnum").rect.w, dx(466));
    assert.equal(by(d, "card0.mpnum").color, "var(--c-mp)");
});

test("home: the bar ratios are parsed from the two number runs, hidden when the card shows none", () => {
    const d = composePauseHome({ parts: parts(), runs: runs() });
    near(by(d, "card0.hpbar").ratio, 1); near(by(d, "card2.hpbar").ratio, 0.5); near(by(d, "card2.mpbar").ratio, 1);
    assert.equal(by(d, "card0.hpbar").color, "var(--c-hp)"); assert.equal(by(d, "card0.mpbar").color, "var(--c-mpbar)");
    near(by(d, "card0.hpbar").rect.w, 120 / 3); near(by(d, "card0.hpbar").rect.h, 14 / 3);
    const noNumbers = composePauseHome({ parts: parts(), runs: runs().filter((r) => !(r.y >= 17 && r.y < 63 && r.right != null && r.y >= 37 && r.y <= 46)) });
    assert.equal(by(noNumbers, "card0.hpbar"), undefined, "no guess: the bar is hidden");
    assert.equal(by(noNumbers, "card0.hpnum"), undefined);
    const zero = composePauseHome({ parts: parts(), runs: [...cardRuns(17, "X", 1, 5, 0, 1, 1)] });
    assert.equal(by(zero, "card0.hpbar"), undefined, "max 0 shows no bar");
});

test("readCardRuns: one card's strings by row, ignoring the other cards and the panel", () => {
    const c = readCardRuns(runs(), 63);
    assert.deepEqual([c.name, c.lvLabel, c.lv, c.hpLabel, c.hp, c.mpLabel, c.mp], ["Renamon", "LV", "1", "HP", ["80", "80"], "MP", ["40", "40"]]);
});

test("home: money plate number is the game's BIT text, right-anchored; header splits the button token", () => {
    const d = composePauseHome({ parts: parts(), runs: runs() });
    assert.equal(by(d, "money.amount").text, "500"); assert.equal(by(d, "money.amount").align, "right");
    near(by(d, "money.amount").rect.x + by(d, "money.amount").rect.w, dx(380));
    assert.equal(by(d, "money.unit").text, "BIT");
    near(by(d, "money.plate").rect.y, 158); near(by(d, "money.plate").rect.x, dx(0)); near(by(d, "money.plate").rect.h, 64 / 3);
    assert.equal(by(d, "header.text").text, "Button: Close Status");
    assert.match(by(d, "header.badge").svg, /^<svg/);
    near(by(d, "header.plate").rect.x, 120); near(by(d, "header.plate").rect.y, 14); near(by(d, "header.plate").rect.h, 64 / 3);
    assert.equal(by(d, "header.plate").shape, "sl");
});

test("home: a header with no known badge draws just the text", () => {
    const r = runs().map((x) => (x.text.startsWith("[triangle]") ? run("[weird]Close", 152, 19) : x));
    const d = composePauseHome({ parts: parts(), runs: r });
    assert.equal(by(d, "header.badge"), undefined);
    assert.equal(by(d, "header.text").text, "Close");
});

// ------------------------------------------------------------------------------------------------ geometry at three sizes, folds
test("home: every plate lands on whole pixels at 640x480, 1280x720 and 1920x1080, bleeding to the stage edge", () => {
    const d = composePauseHome({ parts: parts(), runs: runs() });
    for (const [W, H, s] of [[640, 480, 2], [1280, 720, 3], [1920, 1080, 4.5]]) {
        const pl = { s, sy: s, ox: (W - 320 * s) / 2, oy: (H - 240 * s) / 2 };
        const limit = { left: 0, top: 0, right: W, bottom: H };
        for (const x of d.filter((q) => q.kind === "plate" || q.kind === "wall")) {
            const r = snapRect(x.rect, pl, { x: 0, y: 0 }, limit);
            for (const k of ["left", "top", "right", "bottom"]) assert.ok(Number.isInteger(r[k]), `${x.key} ${k} at ${W}`);
            if (x.key.endsWith(".plate") && /^(card|money|header)/.test(x.key) === false) assert.equal(r.right, W, `${x.key} bleeds right at ${W}`);
            if (/^card\d\.plate$/.test(x.key) || x.key === "money.plate") assert.equal(r.left, 0, `${x.key} bleeds left at ${W}`);
            if (x.key === "header.plate") assert.equal(r.right, W);
        }
    }
});

test("home: a fold carries onto every part (the card's own matrix), text size included", () => {
    const rel = { a: 1, d: 0.5, e: 0, f: 17 * 0.5 };    // y squashed to half about y = 0
    const d = composePauseHome({ parts: parts(rel), runs: runs() });
    const plate = by(d, "card0.plate");
    near(plate.rect.h, 21); near(plate.rect.y, 17 * 0.5 + 17 * 0.5);
    assert.equal(plate.sy, 0.5);
    assert.equal(by(d, "card0.name").sy, 0.5);
});

test("home: no parts and no text give only the wash; a page without the panel shows no list", () => {
    assert.deepEqual(composePauseHome({ parts: [], runs: [] }).map((x) => x.key), ["wash"]);
    const d = composePauseHome({ parts: parts().filter((p) => p.part !== "panel"), runs: runs() });
    assert.equal(d.some((x) => x.key.startsWith("row")), false);
    assert.equal(by(d, "wash").full, true);
});

// ------------------------------------------------------------------------------------------------ wiring
test("wiring: the pause draws through the capture scope; the capture hooks are in the draw functions; no option, no flag", () => {
    const st = src("status-translated.js");
    assert.match(st, /const screen = pickPauseScreen\(session\.draw\.calls, st\._entry\);/);
    assert.match(st, /uiC\.scope\(st\._uiKey, ctx, \{ enable: !!screen, compose: screen\?\.compose, dim: dimOf\(session\.quads\) \}/);
    assert.doesNotMatch(st, /skipClip|skipWidget|uiCssShow|uiLook/, "the pause no longer skips things by hand");
    assert.match(st, /uiC\.hide\(st\._uiKey\)/);
    const sp = src("screenpack.js");
    for (const fn of ["drawClip", "drawClipOpaque", "drawClipWidth"]) assert.match(sp, new RegExp(`export function ${fn}\\([^)]*\\) \\{\\n  if \\(clipHook\\(ctx, p, id, x, y, \\(c\\) => ${fn}\\(c,`), fn);
    // the built .js erases `p: ScreenPack` as blanks, so match across them
    assert.match(sp, /const p\s*=\s*\{ name, img: null/, "the pack name is stored for the claim lookup");
    const nt = src("native-screen-text.js");
    assert.match(nt, /if \(capturing\(\)\) \{[\s\S]*runsHook\(runs\);/);
    assert.match(nt, /right: w\.alignWidth \? w\.penX : null/, "number runs know their right edge");
    for (const f of ["ui-c/index.js", "ui-c/capture.js", "ui-c/home.js"]) assert.doesNotMatch(src(f), /location\.search|URLSearchParams|localStorage/, `${f} reads no flag and keeps no setting`);
    assert.match(src("ui-c/index.js"), /setEnabled: \(on\s*\) =>/);
});

test("the C1 numbers: native units from the design file (3 px per native px)", () => {
    near(dx(724), 188); near(dy(144), 48); near(dy(42), 14); near(dx(520), 120); near(dy(51), 17);
    assert.deepEqual(applyRel({ x: 1, y: 1, w: 1, h: 1 }, IDENTITY), { x: 1, y: 1, w: 1, h: 1 });
});
