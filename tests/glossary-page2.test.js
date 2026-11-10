// Page 2 of GLOSSARY > DIGIMON: lines to drawable rows, scroll, and drawing (web/glossary-book.js).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { GLOSSARY_LAYOUT, PAGE2, createGlossaryBook, page2Rows } from "../web/glossary-book.js";
import { barFill, listRowY } from "../web/ui-kit.js";
import { buildSpecies, pageTwoLines } from "../web/glossary-digimon.js";

const wide = (s) => s.length * 7;
const A = new URL("../web/assets/", import.meta.url);
const haveFont = existsSync(new URL("ui/uifont.json", A));
const real = { skip: haveFont ? false : "web/assets/ui/uifont.json is not available" };
let FONT = null;
if (haveFont) FONT = JSON.parse(readFileSync(new URL("ui/uifont.json", A), "utf8"));
const alias = { "▲": "[arrow-up]", "▼": "[arrow-down]" };
function measure(text, kind = 1) {
    let w = 0;
    for (const ch0 of String(text)) {
        const c = FONT.chars[alias[ch0] ?? ch0];
        const tb = (k, t) => k[t === "b" ? "basic" : "ext"];
        const k = FONT.kinds[String(kind)] ?? FONT.kinds["1"];
        const g = c && (tb(k, c.t)[String(c.i)] ?? tb(FONT.kinds["1"], c.t)[String(c.i)]);
        w += g ? (g.dx || 0) + (g.adv || g.w + 1) : 6;
    }
    return w;
}

test("a bar stays one row; a head one row; a long text line becomes its label row plus every wrapped row (nothing is cut)", () => {
    const lines = [
        { kind: "bar", label: "HP", value: 300, max: 600 },
        { kind: "head", label: "Techniques" },
        { kind: "text", label: "Grows into", text: "ExVeemon, MetalGreymon, SkullGreymon, Growlmon, WarGrowlmon, Cannondramon, Paildramon, Gallantmon, Grizzmon" },
        { kind: "text", label: "", text: "Pepper Breath" },
    ];
    const rows = page2Rows(lines, wide);
    assert.deepEqual(rows.slice(0, 2).map((r) => r.kind), ["bar", "head"]);
    assert.ok(rows.length > 6, `${rows.length} rows: the long line took as many rows as it needs`);
    assert.equal(rows.at(-1).text, "Pepper Breath");
    assert.equal(rows.filter((r) => r.label === "Grows into").length, 1, "the label is on one row only");
    for (const r of rows.filter((x) => x.kind === "text" && x.text)) {
        assert.ok(r.textX + wide(r.text) <= PAGE2.right, `"${r.text}" from ${r.textX} fits`);
    }
});

test("a short labelled line stays on one row, label then text", () => {
    const [r, ...rest] = page2Rows([{ kind: "text", label: "Resists", text: "-" }], wide);
    assert.equal(rest.length, 0);
    assert.equal(r.label, "Resists");
    assert.equal(r.text, "-");
    assert.equal(r.textX, PAGE2.labelX + wide("Resists") + PAGE2.gap);
});

test("a species with a 179-form line wraps fully: every form is still in the rows, none cut, the pane scrolls", () => {
    const forms = Array.from({ length: 179 }, (_, i) => `Form${i}`);
    const rows = page2Rows([{ kind: "text", label: "Grows into", text: forms.join(", ") }], wide);
    assert.ok(rows.length > 3, `${rows.length} rows`);
    for (const r of rows.filter((x) => x.text)) assert.ok(r.textX + wide(r.text) <= PAGE2.right);
    const joined = rows.map((r) => r.text).join(" ");
    for (const f of forms) assert.ok(joined.includes(f), f);
    assert.ok(!joined.includes("..."), "no cut-off marker");
});

test("resist and weak lines of element names become icons when they fit beside the label, else plain words", () => {
    const [few] = page2Rows([{ kind: "text", label: "Resists", text: "Fire, Water" }], () => 5);
    assert.deepEqual(few.icons, ["fire", "water"]);
    const none = page2Rows([{ kind: "text", label: "Resists", text: "-" }], () => 5)[0];
    assert.equal(none.icons, undefined);
    const tooMany = page2Rows([{ kind: "text", label: "Weak to", text: "Fire, Water, Ice, Wind, Thunder, Machine, Dark" }], () => 90);
    assert.ok(tooMany.every((r) => !r.icons), "no room beside a wide label: words, wrapped");
    const other = page2Rows([{ kind: "text", label: "Grows from", text: "Fire" }], () => 5)[0];
    assert.equal(other.icons, undefined, "only Resists and Weak to use icons");
});

test("the wild HP label that cannot fit its column is split into the bar label and a note row", () => {
    const rows = page2Rows([{ kind: "bar", label: "HP (highest seen)", icon: null, value: 10, max: 20 }], (s) => s.length * 6);
    assert.deepEqual(rows.map((r) => [r.kind, r.kind === "note" ? r.text : r.label]), [["bar", "HP"], ["note", "(highest seen)"]]);
});

test("the pane holds nine rows and a bar never passes its track", () => {
    assert.equal(PAGE2.visible, 9);
    assert.equal(barFill(9999, 100, PAGE2.barW), PAGE2.barW);
    assert.equal(barFill(50, 100, PAGE2.barW), PAGE2.barW / 2);
    assert.equal(barFill(0, 100, PAGE2.barW), 0);
    assert.equal(barFill(5, 0, PAGE2.barW), 0, "no maximum: an empty bar, not NaN");
});

test("columns of a bar row: label or icon, bar, number, scroll arrow, in order and inside the pane (real font)", real, () => {
    const L = GLOSSARY_LAYOUT, P = PAGE2;
    const pane = { x: L.pane.x, w: L.pane.w };
    const labelW = Math.max(measure("HP"), measure("MP"), P.iconW);
    assert.ok(P.labelX >= pane.x + 6);
    assert.ok(P.labelX + labelW + 4 <= P.barX, "label or icon, then the bar");
    const num = measure("9999", 3);
    assert.ok(P.barX + P.barW + 4 <= P.numberRight - num, `bar ends ${P.barX + P.barW}, a four-digit number starts ${P.numberRight - num}`);
    assert.ok(P.numberRight <= P.arrowX, "the scroll arrow column starts after the numbers");
    assert.ok(P.arrowX + measure("▲") <= pane.x + pane.w - 6, "the arrow stays inside the frame");
    assert.ok(P.right <= P.arrowX);
    assert.ok(listRowY(0) - 2 >= L.pane.y + 6, "the first row (icons start 2 px above) is inside the frame");
    assert.ok(listRowY(P.visible - 1) + 12 <= L.pane.y + L.pane.h - 6, "the last of the nine rows ends inside the frame");
});

test("every real species' page 2 rows fit the pane width and the label column (real tables and font)", { skip: !haveFont || !existsSync(new URL("data/digimon.json", A)) || !existsSync(new URL("data/extra_species.json", A)) }, () => {
    const J = (p) => JSON.parse(readFileSync(new URL(p, A), "utf8"));
    const d = J("data/digimon.json"), x = J("data/extra_species.json");
    const ids = new Set(d.digimon.map((p) => p.id));
    const digimon = { ...d, digimon: [...d.digimon, ...x.digimon.filter((e) => !ids.has(e.id))] };
    const { species, world, maxima } = buildSpecies({ digimon, evolutions: J("data/evolutions.json"), enemies: J("data/enemies.json"), modelMap: J("battle/model_map.json"),
        encounters: { stages: J("data/stage_encounters.json"), screens: J("data/field_encounters.json"), maps: J("manifest.json") } });
    const maxNum = Math.max(...species.flatMap((s) => [s.hp, s.mp, ...Object.values(s.stats ?? {})].filter(Number.isFinite)));
    assert.ok(measure(String(maxNum), 3) <= PAGE2.numberRight - (PAGE2.barX + PAGE2.barW + 4), `largest real value ${maxNum}`);
    for (const sp of species) {
        const rows = page2Rows(pageTwoLines(sp, "known", null, world, maxima), (s) => measure(s));
        for (const r of rows) {
            if (r.kind === "bar") {
                assert.ok(r.icon || PAGE2.labelX + measure(r.label) + 4 <= PAGE2.barX, `${sp.name} bar label "${r.label}"`);
            } else if (r.kind === "text" || r.kind === "note") {
                const x0 = r.kind === "note" ? PAGE2.labelX : r.textX ?? PAGE2.labelX;
                if (r.label) assert.ok(PAGE2.labelX + measure(r.label) <= PAGE2.right, `${sp.name} label "${r.label}"`);
                if (r.icons) assert.ok(x0 + PAGE2.iconPitch * r.icons.length - (PAGE2.iconPitch - PAGE2.iconW) <= PAGE2.right, `${sp.name} icons`);
                else if (r.text) assert.ok(x0 + measure(r.text) <= PAGE2.right, `${sp.name} "${r.text}" is ${x0 + measure(r.text)}`);
            }
        }
    }
});

const EL = { fire: 100, water: 100, ice: 100, wind: 100, thunder: 100, machine: 100, dark: 100 };
const PROFILE = { id: 1, name: "Kotemon", hp: 100, mp: 50, str: 10, def: 11, spt: 12, wis: 13, spd: 14, chr: 1, family: 3, resistances: { ...EL, fire: 150 }, resistance_growth: {}, status_resist: {}, tech_signature: 9, tech_slots: [9], tech_learn_levels: [], tech_load_levels: [], blasts: [], is_starter: true };
const knownLog = { metCount: () => 1, beatenCount: () => 1, totals: () => ({ met: 1, beaten: 1 }) };
function fakeCtx() {
    const calls = [], texts = [];
    return new Proxy({}, {
        get: (_t, n) => (n === "calls" ? calls : n === "texts" ? texts
            : n === "measureText" ? (s) => ({ width: String(s).length * 7 })
            : n === "fillText" ? (s, x, y) => { texts.push({ s: String(s), x, y: y - 11, w: String(s).length * 7, h: 12 }); }
            : (...a) => { calls.push([n, ...a]); }),
        set: () => true,
    });
}

function page2Book() {
    const data = buildSpecies({ digimon: { digimon: [PROFILE], skills: [{ id: 9, name: "Pepper Breath", element: "fire" }] }, enemies: { enemies: [] }, evolutions: { lines: [] } });
    const book = createGlossaryBook({ sfx: null, getSpecies: () => data, getLog: () => knownLog, getPartners: () => [], stage: null });
    book.act(new Set(["r1"]));
    return book;
}

test("page 2 draws at every fold stage and scroll position without throwing", () => {
    const book = page2Book();
    for (const p of [0, 0.5, 1]) for (let s = 0; s < 3; s++) {
        assert.doesNotThrow(() => book.draw(fakeCtx(), { progress: () => p, ticks: s * 9, dt: 0.02 }));
        book.act(new Set(["down"]));
    }
});

test("page 2 draws the bars (a frame and a fill per bar), the orange numbers, and the footer hint", () => {
    const book = page2Book();
    const ctx = fakeCtx();
    book.draw(ctx, { progress: () => 1, ticks: 0, dt: 0.02 });
    const fills = ctx.calls.filter((c) => c[0] === "fillRect");
    assert.ok(fills.length >= 8, `${fills.length} bar rectangles`);
    assert.ok(ctx.texts.some((t) => t.s === "100"), "the HP number");
    assert.ok(ctx.texts.some((t) => t.s === "L1 Info"), "the footer hint");
});

test("the arrows blink only when rows are hidden: bottom arrow at the top of the scroll, top arrow at the end", () => {
    const book = page2Book();
    const at = (ticks) => { const c = fakeCtx(); book.draw(c, { progress: () => 1, ticks, dt: 0.02 }); return c.texts.map((t) => t.s); };
    assert.ok(at(0).includes("▼") && !at(0).includes("▲"));
    assert.ok(!at(9).includes("▼"), "blinks off");
    for (let i = 0; i < 4; i++) book.act(new Set(["down"]));
    assert.ok(at(0).includes("▲") && !at(0).includes("▼"));
});

test("the page scrolls until its last row sits on the last pane row, then stops", () => {
    const book = page2Book();
    // this Kotemon has no line: Base head, 8 bars, Resists, Weak to, Techniques head, 1 technique = 13 rows; 9 fit, so 4 scroll steps
    for (let i = 0; i < 4; i++) { book.act(new Set(["down"])); assert.equal(book.model.line(), i + 1); }
    book.act(new Set(["down"]));
    assert.equal(book.model.line(), 4, "the fifth press does nothing");
    for (let i = 0; i < 9; i++) book.act(new Set(["up"]));
    assert.equal(book.model.line(), 0);
});
