// The real tables: 240 entries (one per record name; the 49 numbered records are their own entries), every one has a model folder, partners first.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildSpecies } from "../web/glossary-digimon.js";
import { canonicalModelName } from "../web/battle3d.js";

const A = new URL("../web/assets/", import.meta.url);
const have = existsSync(new URL("data/digimon.json", A)) && existsSync(new URL("data/extra_species.json", A));
const J = (p) => JSON.parse(readFileSync(new URL(p, A), "utf8"));

const LOAD = () => {
    const d = J("data/digimon.json"), x = J("data/extra_species.json");
    const ids = new Set(d.digimon.map((p) => p.id));
    const digimon = { ...d, digimon: [...d.digimon, ...x.digimon.filter((e) => !ids.has(e.id))] };
    const modelMap = J("battle/model_map.json"), enemies = J("data/enemies.json");
    const { species } = buildSpecies({ digimon, evolutions: J("data/evolutions.json"), enemies, modelMap,
        encounters: { stages: J("data/stage_encounters.json"), screens: J("data/field_encounters.json"), maps: J("manifest.json") } });
    return { species, modelMap, enemies };
};

test("the real tables give 240 entries (190 partners, 50 wild-only; the 49 numbered records stand alone), every name has a model folder", { skip: !have }, () => {
    const { species, modelMap } = LOAD();
    assert.equal(species.length, 240);
    assert.ok(species.every((s) => s.names.length === 1 && s.names[0] === s.name), "one record name per entry");
    assert.equal(new Set(species.map((s) => s.name)).size, 240);
    assert.equal(species.filter((s) => s.partner).length, 190);
    assert.ok(species.every((s) => s.partner || s.wild));
    assert.deepEqual(species.filter((s) => !modelMap[canonicalModelName(s.name)]).map((s) => s.name), [], "every species has a model folder");
    assert.ok(species.every((s) => s.lives.length > 0 || !s.wild), "every wild species lives somewhere");
});

test("real Goburimon2: its own entry, own model folder, own stats; the base is unchanged; no partner link", { skip: !have }, () => {
    const { species, modelMap, enemies } = LOAD();
    const i = species.findIndex((s) => s.name === "Goburimon");
    assert.ok(i >= 0 && species[i + 1].name === "Goburimon2", "listed right after its base");
    const base = species[i], red = species[i + 1];
    assert.equal(modelMap[canonicalModelName(base.name)], "m080gobr");
    assert.equal(modelMap[canonicalModelName(red.name)], "m398gob2");
    const rec = (n) => enemies.enemies.find((e) => e.enemy_id === n);
    assert.equal(red.wild.stats.str, rec("Goburimon2").str);
    assert.equal(base.wild.stats.str, rec("Goburimon").str);
    assert.equal(red.profileId, null);
    assert.equal(red.partner, null);
    assert.deepEqual(red.names, ["Goburimon2"]);
    assert.deepEqual(base.names, ["Goburimon"]);
    assert.ok(red.lives.length > 0 && red.levels, "own encounters");
    const numbered = enemies.enemies.filter((e) => /\d$/.test(e.enemy_id)).map((e) => e.enemy_id);
    assert.equal(numbered.length, 49);
    const plain = (n) => n.replace(/\d+$/, "");
    for (const n of numbered) {
        const at = species.findIndex((s) => s.name === n), b = species.findIndex((s) => s.name === plain(n));
        assert.ok(at >= 0 && species[at].partner === null, n + " has its own entry, no partner");
        assert.ok(b >= 0 && at > b && species.slice(b + 1, at).every((s) => /\d$/.test(s.name) && plain(s.name) === species[b].name), n + " sits after its base");
    }
});
