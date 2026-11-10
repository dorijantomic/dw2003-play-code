// GLOSSARY > DIGIMON page 2 for partner forms: own numbers when worn, else the game rule at Lv 1; how to get it from evolutions.json.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildSpecies, pageTwoLines, baseNumbers, partnerOf } from "../web/glossary-digimon.js";
import { scaledHp, scaledMp, scaledStat } from "../web/battle.js";

const A = new URL("../web/assets/", import.meta.url);
const have = existsSync(new URL("data/digimon.json", A)) && existsSync(new URL("data/evolutions.json", A));
const J = (p) => JSON.parse(readFileSync(new URL(p, A), "utf8"));
const real = () => buildSpecies({ digimon: J("data/digimon.json"), evolutions: J("data/evolutions.json"), enemies: J("data/enemies.json"), modelMap: J("battle/model_map.json"),
    encounters: { stages: J("data/stage_encounters.json"), screens: J("data/field_encounters.json"), maps: J("manifest.json") } });
const bar = (lines, label) => lines.find((l) => l.kind === "bar" && l.label === label);
const heads = (lines) => lines.filter((l) => l.kind === "head").map((l) => l.label);

test("base numbers are the game rule at Lv 1; a placeholder profile HP is never shown", { skip: !have }, () => {
    const { species, world, maxima } = real();
    const grizz = species.find((s) => s.name === "Grizzmon");
    const prof = J("data/digimon.json").digimon.find((p) => p.name === "Grizzmon");
    assert.equal(prof.hp, 1, "the profile HP is the placeholder");
    const lines = pageTwoLines(grizz, "known", null, world, maxima);
    assert.ok(heads(lines).includes("Adds when digivolved"), "a form's table numbers are add-ons");
    assert.equal(bar(lines, "HP"), undefined, "no HP, MP or CHR bar for a form: digivolving writes none (engine/dw3/battle-form-change.ts)");
    assert.equal(bar(lines, "MP"), undefined);
    assert.equal(bar(lines, "CHR"), undefined);
    assert.equal(bar(lines, "STR").value, scaledStat(prof, "str", 1));
    assert.equal(baseNumbers(prof, 1).mp, scaledMp(prof, 1));
    assert.equal(baseNumbers(prof, 1).hp, scaledHp(prof, 1));
    const kote = species.find((s) => s.name === "Kotemon");
    assert.equal(bar(pageTwoLines(kote, "known", null, world, maxima), "HP").value, 150, "a starter has a real HP");
});

test("a form the player wears now shows their own numbers, labelled Yours, Lv N; another form does not", { skip: !have }, () => {
    const { species, world, maxima } = real();
    const grizz = species.find((s) => s.name === "Grizzmon");
    const rec = { digimonId: grizz.profileId, level: 17, maxHp: 777, maxMp: 66, stats: { str: 70, def: 41, spt: 5, wis: 6, spd: 33, chr: 2 }, bonuses: { str: 4, hp: 9 } };
    const mine = { slot: 0, rookie: "Kotemon", form: "Grizzmon", formId: grizz.profileId, level: 17, live: { level: 17, formLevels: {}, stats: rec } };
    const lines = pageTwoLines(grizz, "known", mine, world, maxima);
    assert.ok(heads(lines).includes("Yours, Lv 17"));
    const gp = J("data/digimon.json").digimon.find((p) => p.name === "Grizzmon");
    assert.deepEqual(["HP", "MP", "STR", "DEF", "CHR"].map((l) => bar(lines, l).value), [777, 66, 74 + gp.str, 41 + gp.def, 2],
        "max HP / MP, stored stat + chip bonus, and the worn form's own STR..SPD added (HP, MP, CHR are not)");
    assert.deepEqual(["SPT", "WIS", "SPD"].map((l) => bar(lines, l).value), [5 + gp.spt, 6 + gp.wis, 33 + gp.spd]);
    assert.ok(bar(lines, "HP").max >= 777, "the scale covers what is shown");
    const wearing = { ...mine, form: "Dinohumon", formId: 99999 };
    assert.ok(heads(pageTwoLines(grizz, "known", wearing, world, maxima)).includes("Adds when digivolved"));
    // a member wearing the form is found before one who merely started as it
    const kote = species.find((s) => s.name === "Kotemon");
    const other = { slot: 1, rookie: "Agumon", form: "Kotemon", formId: kote.profileId, level: 3, live: { level: 3, formLevels: {}, stats: {} } };
    const started = { slot: 0, rookie: "Kotemon", form: "Grizzmon", formId: grizz.profileId, level: 9, live: { level: 9, formLevels: {}, stats: {} } };
    assert.equal(partnerOf(kote, [started, other]), other);
});

test("a partner on its starter form shows its stored numbers only", { skip: !have }, () => {
    const { species, world, maxima } = real();
    const kote = species.find((s) => s.name === "Kotemon");
    const rec = { digimonId: kote.profileId, level: 3, maxHp: 150, maxMp: 40, stats: { str: 70, def: 41, spt: 5, wis: 6, spd: 33, chr: 2 }, bonuses: { str: 4 } };
    const mine = { slot: 0, rookie: "Kotemon", form: "Kotemon", formId: kote.profileId, level: 3, live: { level: 3, formLevels: {}, stats: rec } };
    const lines = pageTwoLines(kote, "known", mine, world, maxima);
    assert.deepEqual(["STR", "DEF", "SPT", "WIS", "SPD", "CHR"].map((l) => bar(lines, l).value), [74, 41, 5, 6, 33, 2]);
});

test("how to get it: a standard path and a DNA path read from evolutions.json", { skip: !have }, () => {
    const { species, world, maxima } = real();
    const evo = J("data/evolutions.json"), names = new Map(J("data/digimon.json").digimon.map((p) => [p.id, p.name]));
    const text = (name) => {
        const l = pageTwoLines(species.find((s) => s.name === name), "known", null, world, maxima);
        const i = l.findIndex((x) => x.label === "How to get it");
        return i < 0 ? [] : l.slice(i + 1).filter((x) => x.kind === "text").map((x) => x.text);
    };
    // standard: Kotemon's line record to Grizzmon (from the data, whatever its gate)
    const rec = evo.lines.find((l) => names.get(l.digimonId) === "Kotemon").records.find((r) => names.get(r.to) === "Grizzmon");
    assert.ok(rec.req0 && !rec.req1);
    assert.ok(text("Grizzmon").some((t) => t.startsWith(`Kotemon: From ${names.get(rec.req0)} Lv ${rec.req0Level}`)), JSON.stringify(text("Grizzmon")));
    // DNA: Omnimon needs two parents, the same in all eight lines, so one line with no starter prefix
    const om = evo.lines[0].records.find((r) => names.get(r.to) === "Omnimon");
    assert.ok(om.req0 && om.req1);
    assert.deepEqual(text("Omnimon"), [`DNA: ${names.get(om.req0)} Lv ${om.req0Level} + ${names.get(om.req1)} Lv ${om.req1Level}`]);
    assert.deepEqual(text("Kotemon"), [], "a starter has no way in");
});

test("how to get it with a stat gate and a partner-level gate (small table)", () => {
    const P = (id, name, x = {}) => ({ id, name, hp: 1, mp: 0, str: 5, def: 5, spt: 5, wis: 5, spd: 5, chr: 1, family: 1, resistances: {}, tech_slots: [], blasts: [], is_starter: false, ...x });
    const digimon = { digimon: [P(1, "A", { is_starter: true, hp: 100, mp: 50 }), P(2, "B"), P(3, "C")], skills: [] };
    const evolutions = { lines: [{ slot: 0, digimonId: 1, records: [
        { to: 2, req0: 0, req0Level: 1, req1: 0, req1Level: 1, kind: 7, threshold: 5 },
        { to: 3, req0: 2, req0Level: 15, req1: 0, req1Level: 1, kind: 1, threshold: 40 }] }] };
    const { species, world, maxima } = buildSpecies({ digimon, evolutions, enemies: { enemies: [] } });
    assert.deepEqual(species[1].getting, ["Partner Lv 5"]);
    assert.deepEqual(species[2].getting, ["From B Lv 15, STR 40"]);
    const lines = pageTwoLines(species[2], "known", null, world, maxima);
    assert.deepEqual(lines.slice(lines.findIndex((l) => l.label === "How to get it")).map((l) => l.text ?? l.label), ["How to get it", "From B Lv 15, STR 40"]);
    assert.equal(pageTwoLines(species[2], "met", null, world, maxima).some((l) => l.label === "How to get it"), false, "locked until known");
});
