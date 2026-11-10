// The Met / Defeated counter (web/species-log.js): read-through storage, damaged data, event wiring, and the battle payload.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPECIES_LOG_KEY, createSpeciesLog, installSpeciesLog } from "../web/species-log.js";

const memory = (seed = {}) => {
    const m = new Map(Object.entries(seed));
    return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};

test("a fresh store reads as empty; a name counts once per call entry", () => {
    const log = createSpeciesLog(memory());
    assert.deepEqual(log.read(), { v: 1, met: {}, beaten: {}, owned: {} });
    assert.equal(log.noteMet(["Kunemon", "Kunemon", "Betamon"]), true);
    assert.equal(log.metCount("Kunemon"), 2, "two Kunemon in one fight are two meetings");
    assert.equal(log.metCount("Betamon"), 1);
    assert.equal(log.beatenCount("Kunemon"), 0);
    assert.deepEqual(log.totals(), { met: 2, beaten: 0 });
});

test("a defeat is also a meeting", () => {
    const log = createSpeciesLog(memory());
    log.noteBeaten(["Gizamon"]);
    assert.equal(log.beatenCount("Gizamon"), 1);
    assert.equal(log.metCount("Gizamon"), 1, "beaten but never recorded as met: met is raised to 1");
    log.noteMet(["Gizamon"]);
    log.noteBeaten(["Gizamon"]);
    assert.deepEqual([log.metCount("Gizamon"), log.beatenCount("Gizamon")], [2, 2]);
});

test("a key changed under the log is read, not overwritten (a save slot was loaded)", () => {
    const store = memory();
    const log = createSpeciesLog(store);
    log.noteMet(["Kunemon"]);
    store.setItem(SPECIES_LOG_KEY, JSON.stringify({ v: 1, met: { Agumon: 7 }, beaten: { Agumon: 3 } }));   // the loaded slot's counts
    log.noteMet(["Betamon"]);
    assert.equal(log.metCount("Agumon"), 7);
    assert.equal(log.beatenCount("Agumon"), 3);
    assert.equal(log.metCount("Kunemon"), 0, "the slot that was loaded does not know Kunemon");
    assert.equal(log.metCount("Betamon"), 1);
});

test("damaged data reads as empty and never throws", () => {
    for (const bad of ["", "not json", "null", "[]", "7", JSON.stringify({ v: 2, met: { A: 1 } }), JSON.stringify({ v: 1, met: "x", beaten: [] }),
        JSON.stringify({ v: 1, met: { A: "3", B: -1, C: 1.5, D: null, E: 2 }, beaten: { __proto__: { X: 1 }, F: 4 } })]) {
        const log = createSpeciesLog(memory({ [SPECIES_LOG_KEY]: bad }));
        assert.doesNotThrow(() => log.read(), bad);
        assert.doesNotThrow(() => log.noteMet(["Z"]), bad);
    }
    const log = createSpeciesLog(memory({ [SPECIES_LOG_KEY]: JSON.stringify({ v: 1, met: { A: "3", B: -1, C: 1.5, D: null, E: 2 }, beaten: { F: 4 } }) }));
    assert.deepEqual(log.read().met, { E: 2 }, "only whole positive counts survive");
    assert.equal(log.beatenCount("F"), 4);
});

test("names that are not species are ignored: numbers, empty, __proto__, constructor, very long", () => {
    const log = createSpeciesLog(memory());
    assert.equal(log.noteMet([12, "", null, undefined, "__proto__", "constructor", "prototype", "x".repeat(200), {}]), false);
    assert.deepEqual(log.read(), { v: 1, met: {}, beaten: {}, owned: {} });
    assert.equal(({}).polluted, undefined);
});

test("a storage that throws loses the count but not the game", () => {
    const log = createSpeciesLog({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } });
    assert.doesNotThrow(() => log.noteMet(["Kunemon"]));
    assert.deepEqual(log.read(), { v: 1, met: {}, beaten: {}, owned: {} });
});

test("the events feed the log, always (no switch)", () => {
    const handlers = {};
    const on = (name, fn) => { handlers[name] = fn; return () => { delete handlers[name]; }; };
    const log = createSpeciesLog(memory());
    const off = installSpeciesLog({ on, log });
    handlers.battleStarted({ enemies: ["Kunemon", "Betamon"], mapId: "s200" });
    handlers.battleWon({ enemies: ["Kunemon"], mapId: "s200", screenId: 1 });
    handlers.battleWon({});
    handlers.battleStarted(undefined);
    assert.deepEqual([log.metCount("Kunemon"), log.metCount("Betamon"), log.beatenCount("Kunemon"), log.beatenCount("Betamon")], [1, 1, 1, 0]);
    off();
    assert.deepEqual(Object.keys(handlers), []);
});

test("the battle sends the enemy names when a fight starts, the same expression the win uses", () => {
    const src = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
    const line = src.split("\n").find((l) => l.includes('emitGameEvent("battleStarted"'));
    assert.ok(line, "the battleStarted event is still sent");
    assert.match(line, /enemies: \(battle\?\.party \?\? \[\]\)\.map\(\(e\) => e\?\.enemyId\)\.filter\(\(n\) => typeof n === "string"\)/);
    assert.match(line, /mapId: battle\?\.mapId \?\? null, screenId: battle\?\.screenId \?\? null/);
});

test("game.js installs the counter exactly once, on the game event bus", () => {
    const src = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
    assert.equal(src.match(/installSpeciesLog\(/g).length, 1);
    assert.match(src, /installSpeciesLog\(\{ on: onGameEvent, log: speciesLog \}\)/);
    assert.match(src, /import \{ on as onGameEvent \} from "\.\/gameEvents\.js"/);
});

test("owned: a species you have worn is recorded once, counts as known, and survives a damaged key", () => {
    const store = memory();
    const log = createSpeciesLog(store);
    assert.equal(log.noteOwned(["Greymon", "Greymon", "Agumon"]), true);
    assert.equal(log.ownedCount("Greymon"), 1, "owned is a set: a second time changes nothing");
    assert.equal(log.noteOwned(["Greymon"]), false, "nothing new, nothing written");
    assert.equal(log.noteOwned(["__proto__", 3, ""]), false);
    assert.deepEqual(Object.keys(log.read().owned).sort(), ["Agumon", "Greymon"]);
    store.setItem(SPECIES_LOG_KEY, JSON.stringify({ v: 1, met: { A: 1 }, beaten: {}, owned: "bad" }));
    assert.deepEqual(log.read().owned, {});
    store.setItem(SPECIES_LOG_KEY, JSON.stringify({ v: 1, met: { A: 1 }, beaten: {} }));
    assert.deepEqual(log.read().owned, {}, "a log saved before owned existed still reads");
});

test("fightSeen / fightBeaten (2 vs 2) and formWorn feed the log", () => {
    const handlers = {};
    const on = (name, fn) => { handlers[name] = fn; return () => { delete handlers[name]; }; };
    const log = createSpeciesLog(memory());
    installSpeciesLog({ on, log });
    handlers.fightSeen({ enemies: ["Kunemon2", "Betamon"] });
    handlers.fightBeaten({ enemies: ["Kunemon2"] });
    handlers.formWorn({ name: "Greymon" });
    handlers.formWorn({});
    assert.deepEqual([log.metCount("Kunemon2"), log.beatenCount("Kunemon2"), log.metCount("Betamon"), log.beatenCount("Betamon")], [1, 1, 1, 0]);
    assert.equal(log.ownedCount("Greymon"), 1);
});

test("mpbattle sends fightSeen at the start and fightBeaten at every win, outside the quest gate; quests still hear only battleWon", () => {
    const src = readFileSync(new URL("../web/mpbattle.js", import.meta.url), "utf8");
    assert.match(src, /emit\("fightSeen", winEvent\(F\.foes/, "seen at the start, same foe names as the quest event");
    const win = src.slice(src.indexOf("if (won && !fled) {"));
    const gate = win.indexOf("window.__fx?.mpcredit");
    const beaten = win.indexOf("fightBeaten");
    assert.ok(beaten > 0 && beaten < gate, "beaten is sent before, not inside, the mpcredit gate");
    assert.equal(src.match(/emit\("battleWon"/g).length, 1, "battleWon stays the single gated emit");
    const q = readFileSync(new URL("../web/quests.js", import.meta.url), "utf8");
    assert.doesNotMatch(q, /fightSeen|fightBeaten/);
});

test("a form is announced when the partner digivolves in battle and when the win makes it permanent", () => {
    const src = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
    assert.equal(src.match(/emitGameEvent\("formWorn"/g).length, 2);
});

test("game.js records the party species as owned on load and on a timer", () => {
    const src = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
    assert.match(src, /function noteOwnedSpecies\(\)/);
    assert.match(src, /setInterval\(noteOwnedSpecies/);
});
