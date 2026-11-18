// Look C battle "dock" look, step 2 (web/ui-c/base.js ring, parts.js fillRing, battlehud.js dockLayout + the "battleData" part): the player's
// living HP / MP / DV ring and the small rings of the other partners. Pure: numbers in, descriptors out. No browser, no game data.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { composeBattle, dockLayout, DOCK } from "../web/ui-c/battlehud.js";
import { frac, ringPart, ringTexts, RING, ID } from "../web/ui-c/base.js";
import { arcDash, RING_SHAPE } from "../web/ui-c/parts.js";
import { visibleNative, placement } from "../web/ui-c/geometry.js";
import { NO_BLEED } from "../web/ui-c/layers.js";

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const byPart = (out, p) => out.filter((d) => d.part === p);
const data = (o = {}) => ({ part: "battleData", x: 0, y: 0, w: 0, h: 0, rel: ID, name: "Kotemon", level: 12, hp: 640, maxHp: 999, mp: 420, maxMp: 999, gauge: 500, maxGauge: 1000,
    others: [{ name: "Renamon", hp: 140, maxHp: 140, mp: 200, maxMp: 200 }, { name: "Patamon", hp: 0, maxHp: 130, mp: 10, maxMp: 170 }], ...o });

test("ring maths: an arc is value over maximum (0..1), a bad maximum is empty, the dash is that fraction of a 100 long path", () => {
    near(frac(999, 999), 1); near(frac(1, 999), 0.001, 5e-5); near(frac(500, 1000), 0.5);
    assert.equal(frac(5, 0), 0); assert.equal(frac(-4, 10), 0); assert.equal(frac(50, 10), 1);
    assert.equal(arcDash(1), "100 100"); assert.equal(arcDash(0), "0 100"); assert.equal(arcDash(0.5), "50 100"); assert.equal(arcDash(2), "100 100");
    for (const [v, max] of [[999, 999], [700, 999], [333, 999], [100, 999], [1, 999]]) {
        const want = v / max, got = parseFloat(arcDash(frac(v, max))) / 100;
        assert.ok(Math.abs(got - want) <= 0.005, `${v}/${max}: ${got} vs ${want}`);
    }
});

test("ring part: HP, MP, DV fractions; full DV only at the maximum (not the layer's own 'full' flag); down at 0 HP; a mini ring has no DV", () => {
    const p = ringPart("r", { x: 0, y: 0, w: 120, h: 120 }, "main", data());
    assert.deepEqual([p.kind, p.part, p.variant, p.layer], ["ring", "ring", "main", "over"]);
    near(p.hp, 0.6406, 1e-4); near(p.mp, 0.4204, 1e-4); near(p.dv, 0.5);
    assert.equal(p.dvFull, false); assert.equal(p.down, false);
    assert.equal(p.full, undefined, "layers.js reads d.full as a full-screen part: the ring must not set it");
    const f = ringPart("r", { x: 0, y: 0, w: 120, h: 120 }, "main", data({ gauge: 1000 }));
    assert.equal(f.dvFull, true); near(f.dv, 1);
    assert.equal(ringPart("r", { x: 0, y: 0, w: 120, h: 120 }, "main", data({ hp: 0 })).down, true);
    const m = ringPart("m", { x: 0, y: 0, w: 50, h: 50 }, "mini", data({ gauge: 1000 }));
    assert.equal(m.dv, 0); assert.equal(m.dvFull, false);
    assert.equal(JSON.stringify(p), JSON.stringify(ringPart("r", { x: 0, y: 0, w: 120, h: 120 }, "main", data())), "same data = same signature");
    assert.ok(NO_BLEED.has("ring"), "a ring at the screen edge stays a ring");
});

test("ring shape: the design's radii and widths (C file, design px); the mini ring has no DV arc and no counter-spin layer", () => {
    assert.deepEqual([RING_SHAPE.main.hp, RING_SHAPE.main.mp, RING_SHAPE.main.dv], [[150, 16], [124, 9], [174, 3]]);
    assert.deepEqual([RING_SHAPE.mini.hp, RING_SHAPE.mini.mp, RING_SHAPE.mini.dv], [[60, 9], [47, 5], null]);
    assert.equal(RING_SHAPE.main.vb, RING.main.vb); assert.equal(RING_SHAPE.mini.vb, RING.mini.vb);
    assert.deepEqual([RING_SHAPE.main.hp[0], RING_SHAPE.main.mp[0], RING_SHAPE.main.core], [RING.main.hp[0], RING.main.mp[0], RING.main.core]);
    assert.ok(RING_SHAPE.main.hp[0] + RING_SHAPE.main.hp[1] / 2 < RING_SHAPE.main.dv[0] && RING_SHAPE.main.dv[0] + 2 <= RING_SHAPE.main.vb / 2, "arcs nest inside the box");
    assert.equal(RING_SHAPE.mini.back.length, 0);
});

test("ring text: name, LV, HP and MP numbers, every box inside the ring's box; 999/999 and LV 99 fit by width", () => {
    const rect = { x: 10, y: 20, w: 120, h: 120 };
    const t = ringTexts("ring.main", rect, "main", data({ hp: 999, maxHp: 999, mp: 999, maxMp: 999, level: 99, name: "Imperialdramon-F" }));
    assert.deepEqual(t.map((d) => d.key), ["ring.main.nm", "ring.main.lv", "ring.main.lvn", "ring.main.hn", "ring.main.mn"]);
    assert.deepEqual(t.map((d) => d.text), ["Imperialdramon-F", "LV", "99", "999/999", "999/999"]);
    for (const d of t) {
        assert.ok(d.rect.x >= rect.x && d.rect.y >= rect.y && d.rect.x + d.rect.w <= rect.x + rect.w + 1e-9 && d.rect.y + d.rect.h <= rect.y + rect.h + 1e-9, `${d.key} inside`);
        assert.ok(d.maxDp > 0, `${d.key} has a width to fit (maxDp)`);
    }
    const hn = t[3], mn = t[4];
    assert.deepEqual([hn.role, hn.sizeDp, hn.align, hn.color], ["number", 40, "center", "#fff"]);
    assert.equal(mn.color, "var(--c-mp)");
    assert.equal(t[2].color, "var(--c-num)");
    const mini = ringTexts("ring.o1", { x: 0, y: 0, w: 50, h: 50 }, "mini", data().others[0]);
    assert.deepEqual(mini.map((d) => d.text), ["Renamon", "140/140", "200/200"]);
    const small = ringTexts("ring.o2", { x: 0, y: 0, w: 40, h: 40 }, "mini", data().others[0]);
    near(small[1].sx, 0.8); near(small[1].rect.w, 92 / 3 * 0.8);
});

test("the data part: composeBattle puts the player's ring on the real left / bottom stage edge (8 native in) and the other partners above it", () => {
    const out = composeBattle({ parts: [data()], runs: [], stage: { x0: -53.3, x1: 373.3, y0: 0, y1: 240 } });
    const rings = byPart(out, "ring");
    assert.deepEqual(rings.map((r) => [r.key, r.variant]), [["ring.main", "main"], ["ring.o1", "mini"], ["ring.o2", "mini"]]);
    const m = rings[0].rect;
    near(m.x, -53.3 + 8); near(m.y + m.h, 240 - 8); near(m.w, 240 * DOCK.main.frac);
    near(rings[1].rect.x, -53.3 + 8); assert.ok(rings[1].rect.y + rings[1].rect.h <= m.y, "the partners stand above the main ring");
    assert.equal(rings[2].down, true, "a partner at 0 HP is a dimmed ring");
    assert.equal(out.filter((d) => d.kind === "text").length, 5 + 3 + 3, "ring texts (no enemy given = no enemy block)");
    assert.equal(composeBattle({ parts: [], runs: [] }).filter((d) => d.part === "ring").length, 0, "no data part = no ring");
    assert.equal(byPart(composeBattle({ parts: [data({ others: [] })], runs: [] }), "ring").length, 1, "a lone partner: one ring");
});

test("dock layout: the main ring hugs the real left / bottom edge on every stage (8 native in); all rings stay on screen; nothing overlaps; tiny stage shrinks", () => {
    const stages = { wide: { x0: -53.3, x1: 373.3, y0: 0, y1: 240 }, wide2: { x0: -35, x1: 355, y0: 0, y1: 240 }, fourThree: { x0: 0, x1: 320, y0: 0, y1: 240 }, tall: { x0: 0, x1: 320, y0: -164, y1: 405 }, tiny: { x0: 0, x1: 90, y0: 0, y1: 90 } };
    for (const [name, S] of Object.entries(stages)) {
        const L = dockLayout(S);
        for (const r of [L.main, ...L.others]) {
            assert.ok(r.x >= S.x0 - 1e-9 && r.y >= S.y0 - 1e-9 && r.x + r.w <= S.x1 + 1e-9 && r.y + r.h <= S.y1 + 1e-9, `${name}: ${JSON.stringify(r)} is on screen`);
            near(r.w, r.h);
        }
        const c = [L.main, ...L.others];
        for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) {
            const d = Math.hypot(c[i].cx - c[j].cx, c[i].cy - c[j].cy);
            assert.ok(d >= (c[i].R + c[j].R) * 0.9 || name === "tiny", `${name}: rings ${i} and ${j} do not sit on each other (${d})`);
        }
    }
    const w = dockLayout(stages.wide);
    near(w.main.x, stages.wide.x0 + 8); near(w.main.y + w.main.h, 232); near(w.main.w, 240 * DOCK.main.frac); assert.ok(w.main.x < 0, "side area on a wide stage");
    const f = dockLayout(stages.fourThree);
    near(f.main.x, 8); near(f.main.w, 240 * DOCK.main.frac); // 4:3: the same share of the height, 8 native in
    const t = dockLayout(stages.tall);
    near(t.main.y + t.main.h, 405 - 8); assert.ok(t.others[0].w > 0.55 * t.main.w, "a tall stage keeps the small rings readable");
    near(dockLayout(stages.tiny).main.w, 0.3 * 90);
    assert.deepEqual(dockLayout(null).main, dockLayout({ x0: 0, y0: 0, x1: 320, y1: 240 }).main, "no stage = the 4:3 box");
});

test("visible native rect: 16:9 shows the side area, 4:3 exactly 0..320 x 0..240, a tall stage extends in y", () => {
    const at = (w, h) => { const s = Math.min(w / 320, h / 240); return { pl: { s, sy: s, ox: (w - 320 * s) / 2, oy: (h - 240 * s) / 2 }, limit: { left: 0, top: 0, width: w, height: h } }; };
    let { pl, limit } = at(1280, 720); let v = visibleNative(pl, limit);
    near(v.x0, -160 / 3); near(v.x1, 320 + 160 / 3); near(v.y0, 0); near(v.y1, 240);
    ({ pl, limit } = at(960, 720)); v = visibleNative(pl, limit);
    near(v.x0, 0); near(v.x1, 320); near(v.y1, 240);
    ({ pl, limit } = at(720, 1280)); v = visibleNative(pl, limit);
    near(v.x0, 0); near(v.x1, 320); assert.ok(v.y0 < -100 && v.y1 > 340);
    assert.equal(placement({ a: 2, d: 2, e: 0, f: 0 }, { w: 640, h: 480 }, { left: 0, top: 0, width: 640, height: 480 }).sy, 2);
});

test("css: the tick layers spin and the full DV arc pulses by CSS keyframes alone (own elements, compositor), they run whatever the OS reduced-motion setting, no per-frame JS", () => {
    const css = read("web/ui-c/ring.css");
    assert.match(css, /@keyframes uic-ring-spin \{ to \{ transform: rotate\(360deg\); \} \}/);
    assert.match(css, /\.uic-ring-spin \{ will-change: transform; animation: uic-ring-spin 90s linear infinite; \}/);
    assert.match(css, /\.uic-ring\.full \.uic-ring-dv \{[^}]*animation: uic-ring-pulse/);
    assert.match(css, /@keyframes uic-ring-pulse \{ 50% \{ opacity: \.55; \} \}/);
    assert.doesNotMatch(css, /prefers-reduced-motion/);
    assert.match(read("web/ui-c/ui-c.css"), /@import url\("ring\.css"\);/);
    const parts = read("web/ui-c/parts.js");
    assert.doesNotMatch(parts.slice(parts.indexOf("function fillRing"), parts.indexOf("export function fillPart")), /requestAnimationFrame|setInterval|setTimeout|\.animate\(/);
    assert.match(parts, /if \(desc\.kind === "ring"\) \{ fillRing\(root, desc, g\); return; \}/, "the arcs move in place, the spin is never restarted");
});

test("wiring: battle.js hands the ring numbers over as one read-only part, only inside a capture, the HP being the game's eased plate value", () => {
    const b = read("web/battle.js");
    const i = b.indexOf('part: "battleData"'), blk = b.slice(b.lastIndexOf("if (uiC.capturing())", i), i + 600);
    assert.ok(i > 0);
    assert.match(blk, /hp: pDisp, maxHp: b\.player\.maxHp, mp: b\.player\.mp, maxMp: b\.player\.maxMp/);
    assert.match(blk, /gauge: normalizeDvGauge\(b\.player\.gauge\), maxGauge: DV_GAUGE_MAX, others/);
    assert.match(b, /const pDisp = pDispShown\(b\);/);
    assert.match(b, /function pDispShown\(cur\) \{\s*return cur\._hpPlate \? hpPlateShown\(cur\._hpPlate, 0\)/);
    assert.equal((b.match(/part: "battleData"/g) ?? []).length, 1);
});
