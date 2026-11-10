// GLOSSARY > DIGIMON page 2 for wild records: stats as fought (the battle rule), low-high ranges, separate bar scales.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { scaleEnemyStat } from "../web/enemy-stats.js";
import { buildSpecies, pageTwoLines, rangeText, SCALE_FLOOR } from "../web/glossary-digimon.js";
import { PAGE2, page2Rows, pageBarWidth } from "../web/glossary-book.js";

const EL = { fire: 100, water: 100, ice: 100, wind: 100, thunder: 100, machine: 100, dark: 100 };
const E = (name, extra = {}) => ({ enemy_id: name, digimon_id: name, attack: 1, move_1: 0, move_2: 0, str: 40, def: 30, spt: 20, wis: 10, spd: 50, resistances: EL, status_resist: {}, digimon_type: 4, drop_item: "Null", drop_rate: 0, ai_moves: [], ...extra });
const P = (id, name, extra = {}) => ({ id, name, hp: 500, mp: 50, str: 300, def: 11, spt: 12, wis: 13, spd: 14, chr: 1, family: 3, resistances: EL, resistance_growth: {}, status_resist: {}, tech_signature: 0, tech_slots: [], tech_learn_levels: [], tech_load_levels: [], blasts: [], is_starter: false, ...extra });
const ENC = {
    stages: { 200: { zones: [{ slots: [1, 2, 0], rate_level: 3 }] } },
    screens: { 1: [{ name: "Kunemon", level: 5, hp: 90, mp: 9, stat_scale: 16 }], 2: [{ name: "Kunemon", level: 9, hp: 150, mp: 9, stat_scale: 24 }] },
    maps: { maps: [{ id: "s200", name: "A — Place" }] },
};
const build = (enemies) => buildSpecies({ digimon: { digimon: [P(1, "Agumon")], skills: [] }, enemies: { enemies }, encounters: ENC });
const WORLD = { evolutions: { lines: [] }, profiles: [], skills: [] };

test("the helper is the battle's rule: integer truncation of stat * scale / 16, 16 is identity, battle.js calls it", () => {
    assert.equal(scaleEnemyStat(40, 16), 40);
    assert.equal(scaleEnemyStat(40, 24), 60);
    assert.equal(scaleEnemyStat(45, 17), 47, "47.8 truncates, never rounds up");
    assert.equal(scaleEnemyStat(1, 5), 0, "no lower clamp, exactly as battle.js has it");
    const src = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
    assert.ok(/import \{ scaleEnemyStat \} from "\.\/enemy-stats\.js"/.test(src));
    assert.ok(/scaleEnemyStat\(eStats\[name\], enemyStatScale\)/.test(src), "buildEnemyRecord uses the shared helper");
});

test("range text: low-high, one value when equal", () => {
    assert.equal(rangeText(48, 96), "48-96");
    assert.equal(rangeText(48, 48), "48");
});

test("a wild record: per-stat low/high over its encounters, HP from the same rows, bars use the high value", () => {
    const { species } = build([E("Kunemon")]);
    const k = species.find((s) => s.name === "Kunemon");
    assert.deepEqual(k.fought.str, { lo: 40, hi: 60 });
    assert.deepEqual(k.fought.spd, { lo: 50, hi: 75 });
    assert.deepEqual(k.fought.hp, { lo: 90, hi: 150 });
    assert.equal(k.stats.str, 60);
    assert.equal(k.hp, 150);
    assert.equal(k.wild.stats.str, 40, "the raw table value is untouched");
    const lines = pageTwoLines(k, "known", null, WORLD, {}, { hp: 150, str: 100 });
    assert.deepEqual(lines[0], { kind: "head", label: "In the wild" });
    const bar = (l) => lines.find((x) => x.kind === "bar" && x.label === l);
    assert.equal(bar("STR").text, "40-60");
    assert.equal(bar("HP").text, "90-150");
    assert.equal(bar("STR").value, 60);
    assert.equal(bar("MP"), undefined);
});

test("a wild record without encounter rows keeps its table values and says so", () => {
    const { species } = build([E("Lonely")]);
    const l = species.find((s) => s.name === "Lonely");
    assert.equal(l.fought, null);
    const lines = pageTwoLines(l, "known", null, WORLD, {}, { str: 100 });
    assert.deepEqual(lines[0], { kind: "head", label: "Table values" });
    assert.ok(lines.filter((x) => x.kind === "bar").every((x) => x.text === undefined));
    assert.equal(lines.find((x) => x.label === "STR").value, 40);
});

test("bar scales are split: partners (300 STR) do not stretch the wild scale, wild do not stretch the partner scale", () => {
    const { species, maxima, wildMaxima } = build([E("Kunemon", { str: 700 })]);
    assert.equal(maxima.str, 300);
    assert.equal(wildMaxima.str, 1050);                 // 700 * 24 / 16
    assert.equal(wildMaxima.def, SCALE_FLOOR);
    const a = pageTwoLines(species[0], "known", null, WORLD, maxima, wildMaxima);
    assert.equal(a.find((x) => x.label === "STR").max, 300);
    const k = pageTwoLines(species[1], "known", null, WORLD, maxima, wildMaxima);
    assert.equal(k.find((x) => x.label === "STR").max, 1050);
});

test("layout: a range shortens every bar of the page equally and still fits beside the number column", () => {
    const wide = (s) => s.length * 7;
    const rows = page2Rows([{ kind: "bar", label: "HP", value: 5400, max: 5400, text: "1200-5400" }, { kind: "bar", label: "STR", value: 5, max: 100, text: "" }], wide);
    assert.equal(rows[0].text, "1200-5400");
    const bw = pageBarWidth(rows, wide);
    assert.ok(bw < PAGE2.barW && bw >= 24);
    assert.ok(PAGE2.barX + bw + 6 + wide("1200-5400") <= PAGE2.numberRight);
    assert.equal(pageBarWidth(page2Rows([{ kind: "bar", label: "HP", value: 3, max: 100 }], wide), wide), PAGE2.barW);
});

const A = new URL("../web/assets/", import.meta.url);
const have = ["data/enemies.json", "data/field_encounters.json", "data/stage_encounters.json", "manifest.json"].every((f) => existsSync(new URL(f, A)));
const J = (p) => JSON.parse(readFileSync(new URL(p, A), "utf8"));

test("real data: Goburimon vs Goburimon2 and every wild-only record, checked against an independent floor(raw*scale/16)", { skip: !have }, () => {
    const enemies = J("data/enemies.json"), screens = J("data/field_encounters.json"), stages = J("data/stage_encounters.json");
    const { species } = buildSpecies({ digimon: { digimon: [], skills: [] }, enemies, encounters: { stages, screens, maps: J("manifest.json") } });
    const raw = (n) => enemies.enemies.find((e) => e.enemy_id === n);
    const g1 = species.find((s) => s.name === "Goburimon"), g2 = species.find((s) => s.name === "Goburimon2");
    assert.ok(g1.fought && g2.fought);
    const r1 = raw("Goburimon"), r2 = raw("Goburimon2");
    assert.deepEqual(g1.fought.str, { lo: r1.str, hi: Math.floor(r1.str * 24 / 16) }, "Goburimon is met at scales 16 and 24");
    assert.deepEqual(g2.fought.str, { lo: r2.str, hi: r2.str }, "Goburimon2 only at scale 16");
    assert.deepEqual(g1.fought.hp, { lo: 192, hi: 288 });
    assert.deepEqual(g2.fought.hp, { lo: 648, hi: 648 });
    assert.notDeepEqual([g1.stats.str, g1.hp], [g2.stats.str, g2.hp]);
    // every record against a from-scratch computation over the raw encounter members
    const members = new Map();
    const stageScreens = new Set();
    for (const st of Object.values(stages.stages ?? stages)) for (const z of st.zones ?? []) for (const s of z.slots ?? []) if (s) stageScreens.add(String(s));
    for (const id of stageScreens) for (const m of (screens.screens ?? screens)[id] ?? []) { if (!members.has(m.name)) members.set(m.name, []); members.get(m.name).push(m); }
    let withRows = 0, without = [];
    for (const sp of species.filter((s) => !s.partner)) {
        const ms = members.get(sp.name);
        if (!ms) { assert.equal(sp.fought, null, sp.name); without.push(sp.name); continue; }
        withRows++;
        for (const k of ["str", "def", "spt", "wis", "spd"]) {
            const v = ms.map((m) => Math.floor(raw(sp.name)[k] * m.stat_scale / 16));
            assert.deepEqual(sp.fought[k], { lo: Math.min(...v), hi: Math.max(...v) }, sp.name + " " + k);
        }
    }
    assert.ok(withRows > 100);
    console.log("wild-only with rows", withRows, "without", without.length, without.join(","));
});
