// The override layer for the host's battle rules (web/host-rules.js) and how OPTIONS shows a locked row (web/options-model.js).
import test from "node:test";
import assert from "node:assert/strict";
import { HOST_RULE_KEYS, cleanRules, pickRules, createRuleOverride } from "../web/host-rules.js";
import { createOptionsModel, HOST_NOTE } from "../web/options-model.js";

const own = () => ({ battlespeed: true, battleSpeed: 3, encounterdial: false, encounterDialMode: "normal", fusionbosses: false, bossphases: false, aishift: false, practice2v2: false, rain: true });
const HOST = { battlespeed: false, battleSpeed: 1, encounterdial: true, encounterDialMode: "lure", fusionbosses: true, bossphases: true, aishift: true, practice2v2: false };

// A tiny copy of the saver in web/ambience.js: stored is the player's own save, written only for keys the layer lets through.
function world() {
    const fx = own(), stored = { ...fx }, layer = createRuleOverride(fx);
    const save = (keys) => { for (const k of keys || Object.keys(fx)) if (layer.canSave(k)) stored[k] = fx[k]; };
    const set = (k, v) => { fx[k] = v; layer.reimpose(); save([k]); };
    return { fx, stored, layer, save, set };
}

test("the key list is the eight fight-changing settings", () => {
    assert.deepEqual([...HOST_RULE_KEYS].sort(), ["aishift", "battleSpeed", "battlespeed", "bossphases", "encounterDialMode", "encounterdial", "fusionbosses", "practice2v2"]);
});

test("cleanRules keeps known keys with valid values only", () => {
    assert.deepEqual(cleanRules(null), {});
    assert.deepEqual(cleanRules([1]), {});
    assert.deepEqual(cleanRules({ rain: false, battlespeed: 1, aishift: true, encounterDialMode: "x", battleSpeed: 0.2 }), { aishift: true, battleSpeed: 1 });
    assert.deepEqual(pickRules(own()), { battlespeed: true, battleSpeed: 3, encounterdial: false, encounterDialMode: "normal", fusionbosses: false, bossphases: false, aishift: false, practice2v2: false });
});

test("override on: the game reads the host's values, the player's own save is untouched", () => {
    const w = world();
    w.layer.apply(HOST);
    for (const [k, v] of Object.entries(HOST)) { assert.equal(w.fx[k], v, k); assert.equal(w.layer.locked(k), true); }
    assert.equal(w.fx.rain, true);
    assert.equal(w.layer.locked("rain"), false);
    w.set("battleSpeed", 2);                                   // the player tries to change a locked key
    w.set("fusionbosses", false);
    w.save();                                                  // a preset / All on saves everything
    assert.equal(w.fx.battleSpeed, 1);
    assert.equal(w.fx.fusionbosses, true);
    assert.deepEqual(w.stored, own());                         // the save never saw a host value
    w.set("rain", false);                                      // an unlocked key still works and is saved
    assert.equal(w.stored.rain, false);
});

test("leave the room: the player's own values come back unchanged", () => {
    const w = world();
    w.layer.apply(HOST);
    w.set("rain", false);
    w.layer.clear();
    const mine = { ...own(), rain: false };
    assert.deepEqual(w.fx, mine);
    assert.deepEqual(w.stored, mine);
    for (const k of HOST_RULE_KEYS) assert.equal(w.layer.locked(k), false);
});

test("a new host: keys the new rules leave out go back to my own, the rest follow the new values", () => {
    const w = world();
    w.layer.apply(HOST);
    w.layer.apply({ battleSpeed: 2, fusionbosses: false });
    assert.equal(w.fx.battleSpeed, 2);
    assert.equal(w.fx.fusionbosses, false);
    assert.equal(w.fx.aishift, false);                         // not locked any more: my own value
    assert.equal(w.layer.locked("aishift"), false);
    assert.equal(w.layer.locked("battleSpeed"), true);
    w.layer.clear();
    assert.deepEqual(w.fx, own());
});

test("a write that bypasses the setter (a preset) is undone by reimpose", () => {
    const w = world();
    w.layer.apply(HOST);
    Object.assign(w.fx, { practice2v2: true, bossphases: false });
    w.layer.reimpose();
    assert.equal(w.fx.practice2v2, false);
    assert.equal(w.fx.bossphases, true);
});

test("OPTIONS: a locked row shows the host's value, says so, and cannot change", () => {
    const w = world();
    const writes = [];
    const store = { get: (k) => w.fx[k], setMany: (o) => { writes.push(o); Object.assign(w.fx, o); }, locked: (k) => w.layer.locked(k) };
    const m = createOptionsModel(store);
    w.layer.apply(HOST);
    const rows = m.view();
    const speed = rows.find((r) => r.id === "battleSpeed"), fights = rows.find((r) => r.id === "randomFights");
    assert.equal(speed.value, "x1");                           // the host's: switch off
    assert.equal(fights.value, "More");                        // the host's: lure
    assert.equal(speed.locked && fights.locked, true);
    assert.equal(speed.canLeft || speed.canRight || fights.canLeft || fights.canRight, false);
    assert.equal(m.help(), HOST_NOTE);
    assert.equal(m.change(1), null);
    assert.equal(m.change(-1), null);
    assert.equal(writes.length, 0);
    w.layer.clear();
    assert.equal(m.view().find((r) => r.id === "battleSpeed").value, "x3");   // my own again
    assert.equal(m.view().find((r) => r.id === "battleSpeed").locked, false);
});
