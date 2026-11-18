// Look C battle "dock" look, step 3 (web/ui-c/base.js dockArc / dockPart, parts.js fillDock, battlehud.js composeBattle, dock.css, ring.css pulse):
// the six command words on a fixed curve (derived from the ring's radius) around the ring, the focused one in the dock beside it. Pure: numbers in, descriptors out. No browser.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { composeBattle, dockLayout } from "../web/ui-c/battlehud.js";
import { dockArc, dockPart, DOCK_WORD, ringPart, ID } from "../web/ui-c/base.js";
import { DOCK_SHAPE } from "../web/ui-c/parts.js";
import { NO_BLEED } from "../web/ui-c/layers.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const part = (name, x, y, w, h, o = {}) => ({ part: name, x, y, bx: 0, by: 0, w, h, rel: ID, ...o });
const run = (text, x, y) => ({ text, x, y, kind: 1, clut: 0, face: null, right: null, w: text.length * 6 });
const cmd = (i) => part("cmdRow", 16, 109 + 19 * i, 100, 19, { by: -3, base: 34 });
const data = { part: "battleData", x: 0, y: 0, w: 0, h: 0, rel: ID, name: "Kotemon", level: 12, hp: 640, maxHp: 999, mp: 420, maxMp: 999, gauge: 500, maxGauge: 1000, others: [] };
const stages = { wide: { x0: -53.3, x1: 373.3, y0: 0, y1: 240 }, fourThree: { x0: 0, x1: 320, y0: 0, y1: 240 }, tall: { x0: 0, x1: 320, y0: -164, y1: 405 } };
const LABELS = ["Fight", "Tech", "DV", "Tag", "Item", "Run"];
const hubOf = (S) => { const m = dockLayout(S).main; return { cx: m.cx, cy: m.cy, R: m.R }; };

test("dock maths: every slot, the dock point and the arc are derived from the ring's radius plus the spacing tokens (no hand-placed numbers)", () => {
    const hub = { cx: 14.6667, cy: 170, R: 36 }, a = dockArc(hub, stages.wide), D = DOCK_WORD;
    const dockA = D.dockAngle * Math.PI / 180, dockR = hub.R * 3 + D.dockGapDp;
    near(a.dock.x, hub.cx + dockR * Math.cos(dockA) / 3); near(a.dock.y, hub.cy + dockR * Math.sin(dockA) / 3);
    near(a.dockR, dockR); near(a.k * 330, a.arcR);
    a.words.forEach((w, i) => { assert.ok(w.x >= hub.cx + (hub.R * 3 + D.clearDp) / 3 - 1e-9, "right of the ring plus the clear gap"); if (i) near(a.words[i].y - a.words[i - 1].y > 0 ? 1 : 0, 1); });
    assert.equal(a.words.length, 6);
    assert.deepEqual([DOCK_SHAPE.size, DOCK_SHAPE.line, DOCK_SHAPE.scale, DOCK_SHAPE.listSize, DOCK_SHAPE.listLine], [D.sizeDp, D.lineDp, D.scale, D.listSizeDp, D.listLineDp], "parts.js mirrors base.js");
});

test("one-number change: the ring scaled by 0.8 and 1.2 (commands and lists of 1..6 rows) keeps every slot clear of the ring, of the docked word and of the other rows", () => {
    for (const f of [0.8, 1, 1.2]) for (const list of [false, true]) for (let n = 1; n <= 6; n++) {
        const hub = { cx: 50, cy: 160, R: 36 * f }, a = dockArc(hub, { x0: 0, x1: 400, y0: 0, y1: 400 }, n, list);
        const line = (list ? DOCK_WORD.listLineDp : DOCK_WORD.lineDp) / 3, sc = list ? DOCK_WORD.listScale : DOCK_WORD.scale, tag = `f${f} ${list ? "list" : "cmd"} n${n}`;
        a.words.forEach((w, i) => {
            const h = line / 2, nx = Math.max(w.x, Math.min(hub.cx, w.x + 1e6)), ny = Math.max(w.y - h, Math.min(hub.cy, w.y + h));
            assert.ok(Math.hypot(nx - hub.cx, ny - hub.cy) > hub.R * 0.98, `${tag} slot ${i} clears the ring`);
            assert.ok(Math.abs(w.y - a.dock.y) >= line * sc / 2 + line / 2 - 1e-9, `${tag} slot ${i} clears the docked word`);
            if (i) assert.ok(w.y - a.words[i - 1].y >= line - 1e-9, `${tag} rows ${i - 1}, ${i} do not overlap`);
        });
        assert.ok(a.arcR >= hub.R * 3 + DOCK_WORD.arcGapDp - 1e-9 && a.dockR > hub.R * 3, `${tag} arc and dock lie outside the ring`);
    }
    const small = dockArc({ cx: 50, cy: 160, R: 36 * 0.8 }, null, 6), big = dockArc({ cx: 50, cy: 160, R: 36 * 1.2 }, null, 6);
    assert.ok(big.dock.x > small.dock.x && big.arcR >= small.arcR, "a bigger ring pushes the dock and the arc out");
});

test("dock slots do not move with the focus: the slot numbers do not depend on `on`, only the class does (JSON differs in `on` alone)", () => {
    const hub = hubOf(stages.wide);
    const a = dockPart("d", stages.wide, hub, LABELS, 0), b = dockPart("d", stages.wide, hub, LABELS, 4);
    assert.deepEqual(a.words, b.words); assert.deepEqual(a.dock, b.dock); assert.deepEqual(a.hub, b.hub);
    const { on: _a, ...ra } = a, { on: _b, ...rb } = b;
    assert.deepEqual(ra, rb);
    assert.equal(a.on, 0); assert.equal(b.on, 4);
    assert.ok(NO_BLEED.has("dock"));
});

test("dock fit: 16:9, 4:3 and tall stages keep every word (at the slot and, scaled, in the dock) inside the stage and off the ring; slots never touch each other or the dock", () => {
    for (const [name, S] of Object.entries(stages)) {
        const hub = hubOf(S), a = dockArc(hub, S), ringR = hub.R * 0.98;
        a.words.forEach((w, i) => {
            assert.ok(w.maxDp > 60, `${name} slot ${i} has width to fit (${w.maxDp})`);
            assert.ok(w.x + w.maxDp / 3 <= S.x1, `${name} slot ${i} stays inside the stage at full width`);
            assert.ok(a.dock.x + w.maxDp * DOCK_WORD.scale / 3 <= S.x1 + 1e-9, `${name} the dock keeps word ${i} inside`);
            const h = DOCK_WORD.lineDp / 3 / 2, nx = Math.max(w.x, Math.min(hub.cx, w.x + 1e6)), ny = Math.max(w.y - h, Math.min(hub.cy, w.y + h));
            assert.ok(Math.hypot(nx - hub.cx, ny - hub.cy) > ringR, `${name} slot ${i} is off the ring`);
            assert.ok(w.y - h >= S.y0 && w.y + h <= S.y1, `${name} slot ${i} inside in y`);
        });
        const dh = DOCK_WORD.lineDp * DOCK_WORD.scale / 3 / 2;
        assert.ok(Math.hypot(a.dock.x - hub.cx, Math.max(0, Math.abs(a.dock.y - hub.cy) - dh)) > ringR, `${name} dock is off the ring`);
        for (const w of a.words) assert.ok(Math.abs(w.y - a.dock.y) > dh + DOCK_WORD.lineDp / 6 - 1e-9, `${name} slot rows clear the docked word`);
        for (let i = 1; i < a.words.length; i++) assert.ok(a.words[i].y - a.words[i - 1].y >= DOCK_WORD.lineDp / 3 - 1e-9, `${name} rows ${i - 1}, ${i} do not overlap`);
    }
});

test("composeBattle: with the ring the six commands are ONE dock part in row order (any draw order), focus = the marker's row; the old plates stay without a ring", () => {
    const runs = LABELS.map((t, i) => run(t, 36, 109 + 19 * i));
    const parts = [5, 4, 3, 2, 1, 0].map(cmd);                       // drawn bottom to top: slot i is still the i-th row from the top
    const out = composeBattle({ parts: [...parts, part("focus", 17, 129, 12, 12), data], runs, stage: stages.wide });
    const d = out.filter((x) => x.part === "dock");
    assert.equal(d.length, 1);
    assert.deepEqual(d[0].words.map((w) => w.t), LABELS); assert.equal(d[0].on, 1);
    assert.equal(out.filter((x) => x.part === "cmdRow").length, 0, "no plate rows");
    assert.equal(out.filter((x) => x.kind === "text" && LABELS.includes(x.text)).length, 0, "the words are the dock's, not text runs");
    const ring = out.find((x) => x.part === "ring" && x.variant === "main");
    assert.equal(ring.menu, true, "the ring knows the menu is up (the confirm pulse fires when it goes away)");
    const none = composeBattle({ parts: [...parts, data], runs, stage: stages.wide }).find((x) => x.part === "dock");
    assert.equal(none.on, -1, "no marker = no focus");
    const plain = composeBattle({ parts: [0, 1, 2, 3, 4, 5].map(cmd), runs });
    assert.equal(plain.filter((x) => x.part === "cmdRow").length, 6); assert.equal(plain.filter((x) => x.part === "dock").length, 0);
    assert.equal(ringPart("r", { x: 0, y: 0, w: 120, h: 120 }, "main", data).menu, false);
});

test("dock css + wiring: focus move = transition + a 160 ms kick (a/b alternate, removed on animationend); the arc turns and breathes on the compositor; confirm = ring pulse when the menu closes; animations always run, the OS reduced-motion setting is ignored", () => {
    const css = read("web/ui-c/dock.css"), ring = read("web/ui-c/ring.css"), parts = read("web/ui-c/parts.js"), hud = read("web/ui-c/battlehud.js");
    assert.match(css, /\.dk-spin \{[^}]*animation: uic-dk-turn/); assert.match(css, /\.dk-gd \{ animation: uic-dk-breath/);
    for (const n of ["uic-dk-flash-a", "uic-dk-flash-b", "uic-dk-pop-a", "uic-dk-pop-b"]) assert.match(css, new RegExp(`@keyframes ${n}`));
    assert.match(css, /\.dk-w \{[^}]*transition: transform/); assert.match(css, /\.dk-w\.on \{ transform: translate\(var\(--tx\), var\(--ty\)\) scale\(var\(--sc\)\)/);
    assert.doesNotMatch(css + ring, /prefers-reduced-motion/); assert.doesNotMatch(parts, /prefers-reduced-motion|calmMotion/);
    assert.match(ring, /uic-ring-pulse-a/); assert.match(ring, /data-pulse="a"\] \.uic-ring-pulse \{ animation: uic-ring-pulse-a/);
    assert.match(parts, /function fillDock/); assert.match(parts, /animationend/); assert.match(parts, /uicMenu === "1" && !desc\.menu/);
    assert.match(read("web/ui-c/ui-c.css"), /dock\.css/);
    assert.ok(!/requestAnimationFrame|setInterval/.test(css + hud), "no per-frame JS in the look");
});
