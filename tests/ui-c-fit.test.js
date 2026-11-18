// Look C: stat numbers and watermark words must be FITTED into their boxes (999/999 HP/MP, LV 99). Pure: descriptors in, numbers out.
import test from "node:test";
import assert from "node:assert/strict";
import { composePauseHome } from "../web/ui-c/home.js";
import { IDENTITY } from "../web/ui-c/geometry.js";

const part = (name, x, y) => ({ part: name, x, y, rel: IDENTITY });
const run = (text, x, y, right = null) => ({ text, kind: 2, clut: 0, x, y, right, glyphs: [] });
const card = (y, name) => [
    run(name, 55, y + 2), run("LV", 16, y + 11), run("99", 37, y + 11, 44),
    run("HP", 16, y + 20), run("999", 45, y + 20, 59), run("/", 61, y + 20), run("999", 80, y + 20, 94),
    run("MP", 16, y + 29), run("999", 45, y + 29, 59), run("/", 61, y + 29), run("999", 80, y + 29, 94),
];
const parts = [part("card", 0, 17), part("cardName", 0, 17), part("card", 0, 63), part("cardName", 0, 63), part("card", 0, 109), part("cardName", 0, 109),
    part("header", 34, 13), part("panel", 168, 40), part("money", 0, 158)];
const runs = [...card(17, "Kotemon"), ...card(63, "Renamon"), ...card(109, "Patamon"),
    run("ITEMS", 188, 49), run("SORT", 188, 63), run("MAP", 188, 77), run("[enter]", 172, 49)];

test("party card numbers carry a fit and sit inside the card plate", () => {
    const d = composePauseHome({ parts, runs });
    const nums = d.filter((x) => /^card\d\.(hp|mp)num$/.test(x.key));
    assert.equal(nums.length, 6);
    for (let i = 0; i < 3; i++) {
        const plate = d.find((x) => x.key === `card${i}.plate`);
        for (const n of nums.filter((x) => x.key.startsWith(`card${i}.`))) {
            assert.equal(n.text, "999/999");
            assert.ok(n.maxDp >= 80, `${n.key} has maxDp ${n.maxDp}`);
            assert.ok(n.rect.x + n.rect.w <= plate.rect.x + plate.rect.w, `${n.key} right edge inside the plate`);
        }
    }
});

test("the MENU watermark is fitted and ends at the screen edge (the wall bleeds to it)", () => {
    const d = composePauseHome({ parts, runs });
    const t = d.find((x) => x.key === "panel.type");
    assert.equal(t.fit, true);
    assert.ok(t.rect.x + t.rect.w <= 320 + 1e-6, `watermark right edge ${t.rect.x + t.rect.w} <= 320`);
});
