// GLOSSARY > DIGIMON rows (web/glossary-digimon.js): one entry per species name, shadows, counts, pages.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSpecies, headerCounts, listRows, mapLabel, pageOne, pageTwoLines, partnerOf, speciesState } from "../web/glossary-digimon.js";
import { partnerRows, wildRows } from "../web/codex-data.js";

const EL = { fire: 100, water: 100, ice: 100, wind: 100, thunder: 100, machine: 100, dark: 100 };
const P = (id, name, extra = {}) => ({ id, name, hp: 100 + id, mp: 50 + id, str: 10 + id, def: 11, spt: 12, wis: 13, spd: 14, chr: 1, family: 3, resistances: { ...EL, fire: 150, water: 60 },
    resistance_growth: {}, status_resist: {}, tech_signature: 9, tech_slots: [1, 9, 0, 0, 0, 0], tech_learn_levels: [], tech_load_levels: [], blasts: [], is_starter: false, ...extra });
const DIGIMON = { digimon: [P(1, "Kotemon", { is_starter: true }), P(2, "Dinohumon"), P(3, "Greymon")],
    skills: [{ id: 1, name: "Fight", element: "normal", power: 60 }, { id: 9, name: "Pepper Breath", element: "fire", power: 90 }, { id: 5, name: "Bubble", element: "water", power: 30 }] };
const E = (name, extra = {}) => ({ enemy_id: name, digimon_id: name, attack: 1, move_1: 5, move_2: 0, str: 40, def: 30, spt: 20, wis: 10, spd: 50, resistances: { ...EL, ice: 175 }, status_resist: {},
    digimon_type: 4, drop_item: "Null", drop_rate: 0, ai_moves: [], ...extra });
const ENEMIES = { enemies: [E("Greymon", { drop_item: "Medicine", drop_rate: 127 }), E("Kunemon"), E("Null")] };   // the Null record is the disc's placeholder
const ENC = {
    stages: { 200: { zones: [{ slots: [1, 2, 0], rate_level: 3 }] }, 201: { zones: [{ slots: [1, 0, 0], rate_level: 3 }] } },
    screens: { 1: [{ name: "Kunemon", level: 5, hp: 90, mp: 9999, stat_scale: 16 }], 2: [{ name: "Greymon", level: 12, hp: 400, mp: 9999, stat_scale: 16 }, { name: "Greymon", level: 20, hp: 700, mp: 9999, stat_scale: 16 }] },
    maps: { maps: [{ id: "s200", name: "Central Sector — Asuka City" }, { id: "s201", name: "Forest Edge" }] },
};
const EVOLUTIONS = { lines: [{ slot: 0, digimonId: 1, records: [{ to: 2, req0: 0, req0Level: 1, req1: 0, req1Level: 1, kind: 0, threshold: 1 }, { to: 3, req0: 2, req0Level: 5, req1: 0, req1Level: 1, kind: 0, threshold: 1 }] }] };
const build = () => buildSpecies({ digimon: DIGIMON, evolutions: EVOLUTIONS, enemies: ENEMIES, modelMap: { Kunemon: "m001kune" }, encounters: ENC });
const fakeLog = (met = {}, beaten = {}) => ({ metCount: (n) => met[n] || 0, beatenCount: (n) => beaten[n] || 0, totals: () => ({ met: Object.keys(met).length, beaten: Object.keys(beaten).length }) });

test("one entry per species name: partners first in id order, then wild-only; the Null record is not a species", () => {
    const { species } = build();
    assert.deepEqual(species.map((s) => s.name), ["Kotemon", "Dinohumon", "Greymon", "Kunemon"]);
    assert.deepEqual(species.map((s) => s.number), [1, 2, 3, 4]);
    assert.ok(species[2].partner && species[2].wild, "Greymon is both a partner and a wild species and appears once");
    assert.equal(species[3].partner, null);
});

test("rows equal the codex data module rows for the same data", () => {
    const { species } = build();
    const pr = partnerRows(DIGIMON), wr = wildRows(ENEMIES, DIGIMON.skills, { Kunemon: "m001kune" });
    assert.deepEqual(species[0].partner, pr[0]);
    assert.deepEqual(species[3].wild, wr.find((r) => r.name === "Kunemon"));
    assert.deepEqual([species[0].hp, species[0].mp, species[0].stats.str], [pr[0].hp, pr[0].mp, pr[0].stats.str]);
});

test("level range, map names and drop come from the tables; nothing is invented", () => {
    const { species } = build();
    const grey = species.find((s) => s.name === "Greymon");
    assert.deepEqual(grey.levels, { min: 12, max: 20 });
    assert.deepEqual(grey.lives, ["Asuka City"], "the part after the dash, once");
    assert.equal(grey.drop.item, "Medicine");
    assert.deepEqual([grey.drop.n, grey.drop.of], [128, 1024]);
    assert.equal(grey.drop.percent, 12.5);
    assert.equal("element" in grey || "family" in grey, false, "no element or family is shown: the tables have none");
    const kun = species.find((s) => s.name === "Kunemon");
    assert.deepEqual(kun.lives, ["Asuka City", "Forest Edge"]);
    assert.equal(kun.hp, 90, "wild HP = the largest encounter HP");
    assert.equal(kun.mp, null, "no wild MP is shown");
    assert.equal(kun.drop, null);
});

test("mapLabel keeps the part after the last dash", () => {
    assert.equal(mapLabel("Central Sector — Asuka City"), "Asuka City");
    assert.equal(mapLabel("Forest Edge"), "Forest Edge");
    assert.equal(mapLabel(null), "");
});

test("state: unknown, met, known (beaten or your partner)", () => {
    const { species } = build();
    const [kote, , , kune] = species;
    assert.equal(speciesState(kune, fakeLog(), null), "unknown");
    assert.equal(speciesState(kune, fakeLog({ Kunemon: 2 }), null), "met");
    assert.equal(speciesState(kune, fakeLog({ Kunemon: 2 }, { Kunemon: 1 }), null), "known");
    assert.equal(speciesState(kote, fakeLog(), { slot: 0 }), "known", "a species that is your partner is known");
});

test("partnerOf matches the rookie species or the current form of a party member", () => {
    const { species } = build();
    const partners = [{ slot: 0, rookie: "Kotemon", form: "Greymon", level: 9, live: {} }];
    assert.equal(partnerOf(species[0], partners), partners[0]);
    assert.equal(partnerOf(species[2], partners), partners[0]);
    assert.equal(partnerOf(species[1], partners), null);
    assert.equal(partnerOf(species[1], []), null);
});

test("the header counts and the list: numbers, names, ??? shadows", () => {
    const { species } = build();
    const log = fakeLog({ Kotemon: 1, Kunemon: 3 }, { Kunemon: 1 });
    assert.deepEqual(headerCounts(species, log), { met: 2, beaten: 1, total: 4, text: "Met 2/4  Beaten 1" });
    const rows = listRows(species, log, []);
    assert.deepEqual(rows.map((r) => [r.number, r.label, r.state]), [[1, "Kotemon", "met"], [2, "???", "unknown"], [3, "???", "unknown"], [4, "Kunemon", "known"]]);
});

test("page 1: unknown shows nothing but a shadow; met shows name and record; known shows everything", () => {
    const { species } = build();
    const kune = species[3];
    const unk = pageOne(kune, "unknown", fakeLog(), null);
    assert.deepEqual([unk.title, unk.shadow, unk.row1, unk.record, unk.lives, unk.drops], ["???", true, "", "", "", ""]);
    const met = pageOne(kune, "met", fakeLog({ Kunemon: 2 }), null);
    assert.equal(met.title, "Kunemon");
    assert.equal(met.record, "Met");
    assert.equal(met.row1, "");
    assert.equal(met.lives, "");
    const grey = species[2];
    const known = pageOne(grey, "known", fakeLog({ Greymon: 3 }, { Greymon: 2 }), { slot: 0, rookie: "Kotemon", form: "Greymon", level: 9, live: {} });
    assert.equal(known.row1, "Lv 9", "your partner shows its live level");
    assert.equal(known.record, "Your partner  Defeated x2");
    assert.equal(known.lives, "Lives in: Asuka City");
    assert.equal(known.drops, "Drops: Medicine 12.5%");
    const wild = pageOne(species[3], "known", fakeLog({ Kunemon: 1 }, { Kunemon: 1 }), null);
    assert.equal(wild.row1, "Found at level 5");
    const range = pageOne(species[2], "known", fakeLog({ Greymon: 1 }, { Greymon: 1 }), null);
    assert.equal(range.row1, "Found at level 12-20");
    assert.equal(wild.drops, "", "no drop: no Drops line");
});

test("page 2: locked until known; bars use the shared maxima; strong, weak, techniques, from, into", () => {
    const { species, world, maxima } = build();
    const locked = pageTwoLines(species[3], "met", null, world, maxima);
    assert.equal(locked.length, 1);
    assert.equal(locked[0].kind, "text");
    const lines = pageTwoLines(species[2], "known", null, world, maxima);
    const bar = (label) => lines.find((l) => l.kind === "bar" && l.label === label);
    assert.deepEqual(lines.filter((l) => l.kind === "bar").map((l) => l.label), ["STR", "DEF", "SPT", "WIS", "SPD"], "a non-starter form: only the five stats it adds, no HP, MP or CHR");
    assert.equal(lines.find((l) => l.kind === "head").label, "Adds when digivolved");
    assert.equal(bar("STR").icon, "str");
    const text = (label) => lines.find((l) => l.kind === "text" && l.label === label)?.text;
    assert.equal(text("Resists"), "Fire, Water, Ice, Wind, Thunder, Machine, Dark", "no current partner: the first starter whose line reaches it (Kotemon 150 / 60 / others 100, each plus the same)");
    assert.equal(text("Weak to"), "-");
    const kHp = pageTwoLines(species[0], "known", null, world, maxima).find((l) => l.kind === "bar" && l.label === "HP");
    assert.deepEqual([kHp.value, kHp.max], [101, maxima.hp], "a starter keeps its HP bar and its Base head");
    assert.ok(lines.some((l) => l.kind === "head" && l.label === "Techniques"));
    assert.ok(lines.some((l) => l.kind === "text" && l.text === "Pepper Breath"));
    assert.equal(text("Grows from"), "Kotemon", "a line's records reach it: the line's starter");
    assert.equal(text("Grows into"), undefined, "only a starter has a line of forms: no line, no invented one");
    const kote = pageTwoLines(species[0], "known", null, world, maxima);
    assert.equal(kote.find((l) => l.label === "Grows from"), undefined, "a starter is not reached from a line");
    assert.equal(kote.find((l) => l.label === "Grows into").text, "Dinohumon, Greymon", "a starter: its whole line (lineTargets)");
    const kune = pageTwoLines(species[3], "known", null, world, maxima);
    assert.equal(kune.some((l) => l.label === "Grows from" || l.label === "Grows into"), false, "a species with no real line shows nothing there");
});

test("page 2 for your partner adds the current level and what the next form still needs", () => {
    const { species, world, maxima } = build();
    const partner = { slot: 0, rookie: "Kotemon", form: "Kotemon", level: 9, live: { level: 9, formLevels: { 1: 1 }, stats: {} } };
    const lines = pageTwoLines(species[0], "known", partner, world, maxima);
    assert.equal(lines.find((l) => l.label === "Your level").text, "9");
    const next = lines.find((l) => l.label === "Next form");
    assert.ok(next && /Dinohumon/.test(next.text), next?.text);
});

test("page 2: a wild-only species shows an In the wild section (bar = high value); a partner shows plain HP", () => {
    const { species, world, maxima } = build();
    const wl = pageTwoLines(species[3], "known", null, world, maxima);
    assert.equal(wl[0].label, "In the wild");
    assert.equal(wl.find((l) => l.label === "HP").value, 90, "the bar uses the high value");
    const partner = pageTwoLines(species[0], "known", null, world, maxima).filter((l) => l.kind === "bar").map((l) => l.label);
    assert.ok(partner.includes("HP") && !partner.includes("HP (highest seen)"));
});

test("bars: within every stat a bigger value is never a shorter bar; a value of 1 is under 5% of the bar", async () => {
    const { barFill } = await import("../web/ui-kit.js");
    const { SCALE_FLOOR } = await import("../web/glossary-digimon.js");
    const { species, maxima } = build();
    for (const key of Object.keys(maxima)) {
        assert.ok(maxima[key] >= SCALE_FLOOR, `${key} scale is at least ${SCALE_FLOOR}`);
        const W = 82;
        let last = -1;
        for (const v of [0, 1, 2, 5, 10, 50, 100, 150, 500, maxima[key]]) {
            const fill = barFill(v, maxima[key], W);
            assert.ok(fill >= last, `${key}: ${v} gives ${fill} px, not less than ${last}`);
            last = fill;
        }
        assert.ok(barFill(1, maxima[key], W) / W < 0.05, `${key}: value 1 is under 5%`);
        assert.equal(barFill(maxima[key], maxima[key], W), W, `${key}: the real maximum fills the bar`);
    }
    assert.ok(species.length > 0);
});

test("a trailing variant digit is not shown: list row and card title drop it, the species keeps its own name", async () => {
    const { displayName } = await import("../web/glossary-digimon.js");
    assert.equal(displayName("Guardromon2"), "Guardromon");
    assert.equal(displayName("Numemon6"), "Numemon");
    assert.equal(displayName("Kotemon"), "Kotemon");
});

test("a partner on page 1 says just Your partner; no Lives in / Drops lines when there is no data", () => {
    const { species } = build();
    const p = pageOne(species[0], "known", fakeLog({}, {}), { slot: 0, rookie: species[0].name, form: species[0].name, level: 9, live: {} });
    assert.equal(p.record, "Your partner");
    const none = { ...species[0], lives: [], drop: null };
    const q = pageOne(none, "known", fakeLog({}, {}), null);
    assert.equal(q.lives, ""); assert.equal(q.drops, "");
});

test("a frame of the list and counts for 240 logged species reads the storage at most once and is fast", async () => {
    const { createSpeciesLog } = await import("../web/species-log.js");
    const { logSnapshot } = await import("../web/glossary-digimon.js");
    let reads = 0;
    const mem = new Map();
    const storage = { getItem: (k) => { reads++; return mem.get(k) ?? null; }, setItem: (k, v) => mem.set(k, v) };
    const log = createSpeciesLog(storage);
    const names = Array.from({ length: 240 }, (_, i) => `Mon${i}`);
    log.noteMet(names); log.noteBeaten(names.slice(0, 100));
    const species = names.map((name, index) => ({ index, number: index + 1, name }));
    for (let w = 0; w < 5; w++) { const s = logSnapshot(log); headerCounts(species, s); listRows(species, s, []); }   // warm up
    reads = 0;
    const t0 = performance.now();
    const snap = logSnapshot(log);
    const counts = headerCounts(species, snap);
    const rows = listRows(species, snap, []);
    const ms = performance.now() - t0;
    assert.ok(reads <= 1, `${reads} storage reads`);
    assert.ok(ms < 2, `${ms.toFixed(2)} ms`);
    assert.deepEqual([counts.met, counts.beaten, rows.filter((r) => r.state === "known").length], [240, 100, 100]);
});

// ---- one entry per record (numbered records stand alone, same shown name), owned species
const MERGE_ENEMIES = { enemies: [E("Greymon", { drop_item: "Medicine", drop_rate: 127 }), E("Greymon2", { drop_item: "Bandage", drop_rate: 255 }), E("Kunemon"), E("Kunemon2", { drop_item: "Medicine", drop_rate: 63 })] };
const MERGE_ENC = {
    stages: { 200: { zones: [{ slots: [1, 2, 3], rate_level: 3 }] } },
    screens: { 1: [{ name: "Kunemon", level: 5, hp: 90, mp: 9999, stat_scale: 16 }], 2: [{ name: "Greymon", level: 12, hp: 400, mp: 9999, stat_scale: 16 }], 3: [{ name: "Greymon2", level: 30, hp: 900, mp: 9999, stat_scale: 16 }, { name: "Kunemon2", level: 9, hp: 150, mp: 9999, stat_scale: 16 }] },
    maps: { maps: [{ id: "s200", name: "Central Sector — Asuka City" }] },
};
const merged = () => buildSpecies({ digimon: DIGIMON, evolutions: EVOLUTIONS, enemies: MERGE_ENEMIES, modelMap: {}, encounters: MERGE_ENC });

test("numbered records are their own entries, shown with the plain name, listed right after their base", () => {
    const { species } = merged();
    assert.deepEqual(species.map((s) => s.name), ["Kotemon", "Dinohumon", "Greymon", "Greymon2", "Kunemon", "Kunemon2"]);
    assert.deepEqual(species.map((s) => s.number), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(species.map((s) => s.names), [["Kotemon"], ["Dinohumon"], ["Greymon"], ["Greymon2"], ["Kunemon"], ["Kunemon2"]]);
    assert.ok(species[2].partner, "partner data stays on the base");
    assert.equal(species[3].partner, null);
    assert.equal(species[3].profileId, null);
    assert.equal(species[3].wild.name, "Greymon2");
    const log = fakeLog({ Greymon2: 1, Kunemon2: 1 }, { Kunemon2: 1 });
    assert.deepEqual(listRows(species, log, []).map((r) => r.label), ["???", "???", "???", "Greymon", "???", "Kunemon"], "the shown name is the plain one");
    assert.equal(pageOne(species[3], "met", log, null).title, "Greymon");
});

test("each entry has its own levels, hp, drops and model", () => {
    const { species } = buildSpecies({ digimon: DIGIMON, evolutions: EVOLUTIONS, enemies: MERGE_ENEMIES, modelMap: { Greymon: "mA", Greymon2: "mB" }, encounters: MERGE_ENC });
    const [g, g2, k, k2] = [2, 3, 4, 5].map((i) => species[i]);
    assert.deepEqual(g.levels, { min: 12, max: 12 });
    assert.deepEqual(g2.levels, { min: 30, max: 30 });
    assert.deepEqual(g.drops.map((d) => d.item), ["Medicine"]);
    assert.deepEqual(g2.drops.map((d) => d.item), ["Bandage"]);
    assert.equal(g2.drop.item, "Bandage");
    assert.equal([g.wild.model, g2.wild.model].join(), "mA,mB");
    assert.equal(k.hp, 90);
    assert.equal(k2.hp, 150);
    assert.deepEqual(k2.levels, { min: 9, max: 9 });
});

test("met / beaten are counted per record; header counts every entry", () => {
    const { species } = merged();
    const log = fakeLog({ Kunemon: 2, Kunemon2: 1 }, { Kunemon2: 3 });
    const [kun, kun2] = [species[4], species[5]];
    assert.equal(speciesState(kun, log, null), "met");
    assert.equal(speciesState(kun2, log, null), "known");
    assert.equal(speciesState(species[3], log, null), "unknown");
    assert.match(pageOne(kun2, "known", log, null).record, /Defeated x3/);
    assert.doesNotMatch(pageOne(kun, "met", log, null).record, /Defeated/);
    assert.equal(headerCounts(species, log).text, "Met 2/6  Beaten 1");
    assert.match(pageOne(kun2, "known", log, null).drops, /Medicine 6\.3%/);
});

test("owned: a species you have worn is known, counts as met, and is called yours", () => {
    const { species } = merged();
    const log = fakeLog(); log.ownedCount = (n) => (n === "Kunemon" ? 1 : 0);
    assert.equal(speciesState(species[4], log, null), "known");
    assert.equal(speciesState(species[5], log, null), "unknown", "the numbered record is not the one you wore");
    assert.equal(headerCounts(species, log).met, 1);
    assert.match(pageOne(species[4], "known", log, null).record, /Your Digimon/);
});

test("partnerOf links the base record only, never the numbered one", () => {
    const { species } = merged();
    const partners = [{ slot: 0, rookie: "Kotemon", form: "Kunemon", level: 4, live: {} }];
    assert.equal(partnerOf(species[4], partners), partners[0]);
    assert.equal(partnerOf(species[5], partners), null);
    const g = [{ slot: 0, rookie: "Kotemon", form: "Greymon", level: 4, live: {} }];
    assert.equal(partnerOf(species[2], g), g[0]);
    assert.equal(partnerOf(species[3], g), null);
});

test("page 2 for a digivolution form: its numbers are add-ons on the partner's own row (Greymon on Agumon)", () => {
    const R = (a, b, c, d, e, f, g) => ({ fire: a, water: b, ice: c, wind: d, thunder: e, machine: f, dark: g });
    const digimon = { digimon: [P(4, "Agumon", { is_starter: true, resistances: R(130, 100, 60, 100, 95, 95, 100) }), P(5, "Gabumon", { is_starter: true, resistances: R(100, 100, 100, 100, 100, 100, 100) }),
        P(12, "Greymon", { resistances: R(60, 30, 0, 30, 30, 30, 30) }), P(13, "Orphan", { resistances: R(60, 30, 0, 30, 30, 30, 30) })], skills: [] };
    const rec = (to) => ({ to, req0: 0, req0Level: 1, req1: 0, req1Level: 1, kind: 0, threshold: 1 });
    const evolutions = { lines: [{ slot: 0, digimonId: 4, records: [rec(12)] }, { slot: 1, digimonId: 5, records: [rec(12)] }] };
    const { species, world, maxima } = buildSpecies({ digimon, evolutions, enemies: { enemies: [] } });
    const grey = species.find((s) => s.name === "Greymon");
    const lead = (slot, elemBonuses) => ({ slot, rookie: "Agumon", form: "Agumon", level: 5, live: { level: 5, formLevels: {}, stats: { elemBonuses } } });
    const text = (lines, label) => lines.find((l) => l.kind === "text" && l.label === label)?.text;
    const heads = (lines) => lines.filter((l) => l.kind === "head").map((l) => l.label);
    // Agumon 130/100/60/100/95/95/100 + Greymon 60/30/0/30/30/30/30 = 190/130/60/130/125/125/130
    const onAgumon = pageTwoLines(grey, "known", null, world, maxima, maxima, lead(0));
    assert.ok(heads(onAgumon).includes("On Agumon"));
    assert.equal(text(onAgumon, "Resists"), "Fire, Water, Wind, Thunder, Machine, Dark");
    assert.equal(text(onAgumon, "Weak to"), "Ice");
    // the live partner's trained points count: Ice 60 + 0 + 50 = 110
    assert.equal(text(pageTwoLines(grey, "known", null, world, maxima, maxima, lead(0, { ice: 50 })), "Weak to"), "-");
    // the current partner's line cannot reach the form: the first starter whose line can (no trained points)
    const orphan = species.find((s) => s.name === "Orphan");
    assert.equal(heads(pageTwoLines(orphan, "known", null, world, maxima, maxima, lead(0))).includes("On Agumon"), false, "no line reaches it: nothing is invented");
    assert.equal(text(pageTwoLines(orphan, "known", null, world, maxima, maxima, lead(0)), "Resists"), undefined);
    const gabLead = { ...lead(1, { ice: 500 }), rookie: "Gabumon" };
    const noPoints = pageTwoLines(grey, "known", null, world, maxima, maxima, { ...gabLead, slot: 9 });
    assert.ok(heads(noPoints).includes("On Agumon"), "a lead whose line is not found falls back to the first starter");
    assert.equal(text(noPoints, "Weak to"), "Ice", "the fallback starter's table row only, no trained points");
    assert.deepEqual(onAgumon.filter((l) => l.kind === "bar").map((l) => l.label), ["STR", "DEF", "SPT", "WIS", "SPD"]);
    assert.ok(heads(onAgumon).includes("Adds when digivolved"));
});
