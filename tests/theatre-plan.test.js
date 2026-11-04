// Move Theatre — every signature move, on demand.
//
// The page is the Battle Lab's recipe without the lab's switches: pick a Digimon, pick one
// of ITS OWN techniques, watch it play in the real battle view. The planning is a pure
// function here so the tech list can be proven from the game's own tables without a browser:
// a species' basics and signature are the two non-zero tech columns of digimon.json, the
// model comes from model_map.json only when models/index.json carries that folder, and the
// page adds nothing of its own (no story flag, no new data file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { theatrePlan, theatreCameraModes } from "../web/theatre-plan.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const source = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const digimon = read("../web/assets/data/digimon.json");
const modelMap = read("../web/assets/battle/model_map.json");
const models = read("../web/assets/battle/models/index.json");
const techTable = read("../web/assets/data/fight_tech_table.json");
const data = { digimon, modelMap, models, techTable };

test("a species resolves to its own basics and signature and to its model folder", () => {
    assert.deepEqual(theatrePlan(data, "Agumon"),
        { name: "Agumon", model: "m003agum", techs: [4, 56], missing: [] });
    assert.deepEqual(theatrePlan(data, "Kotemon"),
        { name: "Kotemon", model: "m383pken", techs: [1, 53], missing: [] });
    assert.equal(theatrePlan(data, "Renamon").model, "m373rena");
    // The species array on its own works too (digimon.json is the other accepted shape).
    assert.deepEqual(theatrePlan({ ...data, digimon: digimon.digimon }, "Agumon").techs, [4, 56]);
});

test("every species' own technique is a record the fight table can play", () => {
    // The list is sorted and deduped, and a zero column contributes nothing.
    let zeroTechSpecies = 0;
    for (const d of digimon.digimon) {
        const plan = theatrePlan(data, d.name);
        const wanted = [d.tech_basic | 0, d.tech_signature | 0].filter((id) => id !== 0);
        assert.deepEqual(plan.techs, [...new Set(wanted)].sort((a, b) => a - b),
            `${d.name}'s own techniques`);
        if (!wanted.length) { zeroTechSpecies++; continue; }
        for (const id of wanted) {
            assert.ok(techTable[String(id)], `${d.name} tech ${id} is in fight_tech_table.json`);
            assert.ok(plan.techs.includes(id), `${d.name} tech ${id} reaches the page`);
        }
    }
    assert.ok(zeroTechSpecies > 0, "some species (the extra forms) have no basic/signature column");
});

test("species without a model are reported, not guessed, and the count is measured", () => {
    // Compute the expectation from the two shipped lists; never pin a number here.
    const expected = digimon.digimon
        .filter((d) => !modelMap[d.name] || !models.includes(modelMap[d.name]))
        .map((d) => d.name);
    const got = digimon.digimon
        .filter((d) => theatrePlan(data, d.name).model === null)
        .map((d) => d.name);
    assert.deepEqual(got, expected);
    for (const name of expected) {
        const plan = theatrePlan(data, name);
        assert.deepEqual(plan.missing, [name], `${name} is named as missing`);
        assert.ok(plan.techs.length > 0 || (digimon.digimon.find((d) => d.name === name).tech_basic | 0) === 0);
    }
    console.log(`Move Theatre: ${digimon.digimon.length} species, ${expected.length} without a model` +
        (expected.length ? ` (${expected.join(", ")})` : ""));
});

test("an unknown name is a miss, not a throw", () => {
    assert.deepEqual(theatrePlan(data, "NoSuchmon"),
        { name: "NoSuchmon", model: null, techs: [], missing: ["NoSuchmon"] });
});

test("the four camera modes are the disc's, and battle3d accepts each one", () => {
    const modes = theatreCameraModes();
    assert.deepEqual(modes, ["director", "game", "behind", "orbit"]);
    const battle3d = source("../web/battle3d.js");
    const valid = battle3d.match(/const valid = \(([^;]*?)\);/s);
    assert.ok(valid, "setCameraMode still answers from one valid-modes expression");
    for (const m of modes) {
        assert.match(valid[1], new RegExp(`m === "${m}"`), `battle3d accepts "${m}"`);
    }
});

test("the page is the Battle Lab's recipe: real renderer, real sfx, real attack call", () => {
    const page = source("../web/move-theatre.html");
    assert.match(page, /import\s*\{[^}]*\bcreateBattle3D\b[^}]*\}\s*from\s*["']\.\/battle3d\.js["']/);
    assert.match(page, /import\s*\{[^}]*\bcreateSfxPlayer\b[^}]*\}\s*from\s*["']\.\/audio\.js["']/);
    assert.match(page, /import\s*\{[^}]*\btheatrePlan\b[^}]*\}\s*from\s*["']\.\/theatre-plan\.js["']/);
    assert.match(page, /import\s*\{[^}]*\btheatreCameraModes\b[^}]*\}\s*from\s*["']\.\/theatre-plan\.js["']/);
    assert.match(page, /playerAttack\s*\(/, "the Play button runs the battle's own attack");
    assert.match(page, /setPlayerDigimon\s*\(/, "the picked species is the attacker");
    assert.match(page, /setEnemyDigimon\s*\(\s*["']m051kuwa["']/, "the move gets a target");
    assert.match(page, /setCameraMode\s*\(/, "the camera select drives the real camera");
    for (const field of ["mp", "power", "category", "clip", "motion", "effect"]) {
        assert.match(page, new RegExp(`\\b${field}\\b`), `the record line shows ${field}`);
    }
    assert.match(page, /theatreCameraModes\(\)/, "the camera select is built from the four modes");
    assert.match(page, /drawEffects\s*\(/, "the op3 sprite bursts are drawn over the GL frame");
    assert.match(page, /getContext\(\s*["']2d["']\s*\)/, "a visible 2D canvas the GL frame lands on");
    assert.match(page, /id=["']loop["']/, "a loop control");
});

test("the page adds no story flag and reads no new data file", () => {
    const page = source("../web/move-theatre.html");
    const plan = source("../web/theatre-plan.js");
    for (const src of [page, plan]) {
        assert.doesNotMatch(src, /story[_ ]?flag|setFlag|getFlag|storyFlag/i);
        assert.doesNotMatch(src, /localStorage|save\.json|memcard/i, "no save or memory card touch");
    }
    const fetched = [...new Set([...page.matchAll(/assets\/[^"'`\s]+\.json/g)].map((m) => m[0]))].sort();
    assert.deepEqual(fetched, [
        "assets/battle/model_map.json",
        "assets/battle/models/index.json",
        "assets/data/digimon.json",
        "assets/data/fight_tech_table.json",
    ]);
});

test("the F2 switch is in ambience.js's Extras row and EXPERIMENTAL, and gates the page link", () => {
    const ambience = source("../web/ambience.js");
    assert.match(ambience, /\["movetheatre", "Move theatre"\]/, "the Extras row has the pair");
    const experimental = ambience.match(/const EXPERIMENTAL = \[([^\]]*)\];/);
    assert.ok(experimental, "EXPERIMENTAL is still one array literal");
    assert.match(experimental[1], /"movetheatre"/, "Move theatre starts off");
    assert.match(ambience, /data-act="movetheatre"/, "the gated row carries its button");
    assert.match(ambience, /move-theatre\.html/, "the button opens the page");
    const row = ambience.match(/id="fx-movetheatre"[\s\S]*?<\/div>/);
    assert.ok(row, "the button row exists in the panel");
    assert.match(row[0], /data-act="movetheatre"/, "the button is inside that row");
    assert.match(ambience, /hidden\s*=\s*!fx\.movetheatre/,
        "the row is shown only while the toggle is on");
});
