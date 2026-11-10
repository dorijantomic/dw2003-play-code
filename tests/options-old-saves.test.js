// Review focus: settings saved by older builds or edited by hand must not break the OPTIONS screen (web/options-model.js).
import test from "node:test";
import assert from "node:assert/strict";
import { PAGES, createOptionsModel } from "../web/options-model.js";

const store = (fx) => ({ get: (k) => fx[k], setMany: (o) => Object.assign(fx, o) });
const everyRow = (m) => {
    const out = {};
    for (let p = 0; p < PAGES.length; p++) { for (const r of m.view()) out[r.id] = r; m.switchPage(1); }
    return out;
};

test("an empty or nonsense settings object still gives every row a value text", () => {
    for (const fx of [{}, { weatherMode: "stormy", todMode: 7, spriteFilter: "nearest4", battleSpeed: "fast", battlespeed: true, musicVolume: "loud", soundVolume: null, quality: 12 }]) {
        const rows = everyRow(createOptionsModel(store(fx), [["off", "Off"]]));
        assert.equal(Object.keys(rows).length, 3 + 4 + 2 + 6);
        for (const r of Object.values(rows)) assert.equal(typeof r.value, "string", r.id);
    }
});

test("the old documented weather word 'stormy' is not a value; it reads the first choice and moving it writes a real one", () => {
    const fx = { weatherMode: "stormy" };
    const m = createOptionsModel(store(fx), [["off", "Off"]]);
    m.switchPage(1); for (let i = 0; i < 2; i++) m.moveRow(1);
    assert.equal(m.view()[2].value, "Random");
    m.change(1);
    assert.equal(fx.weatherMode, "always");
});

test("a volume saved outside 0..1 is shown inside 0..100", () => {
    const fx = { musicVolume: 7, soundVolume: -2 };
    const m = createOptionsModel(store(fx), [["off", "Off"]]);
    m.switchPage(1); m.switchPage(1);
    assert.deepEqual(m.view().slice(0, 2).map((r) => r.value), ["100", "0"]);
});

test("a battle speed saved above x3 shows x3 and one step left gives x2", () => {
    const fx = { battlespeed: true, battleSpeed: 99 };
    const m = createOptionsModel(store(fx), [["off", "Off"]]);
    assert.equal(m.view()[0].value, "x3");
    m.change(-1);
    assert.equal(fx.battleSpeed, 2);
});
