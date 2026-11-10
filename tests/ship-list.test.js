// What players get for each F2 switch (web/ship-list.js), and its enforcement in web/ambience.js.
//   in   = on at the start, the player may switch it
//   auto = always on, no switch
//   out  = hidden from players, off
// The installed copy is told apart by a marker file the release workflow writes (web/installed-build.js);
// the owner PC (a checkout) never has it and keeps every switch changeable.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
    SHIP, SHIP_IN, SHIP_AUTO, SHIP_OUT, shipClass, shipForced, isInstalledBuild,
    applyShipDefaults, lockShipped, finishShipLoad, UPGRADE_MARK_KEY,
} from "../web/ship-list.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// ---- browser stand-ins so the real web/ambience.js can load in node
const store = Object.create(null);
globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
};
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
if (typeof globalThis.addEventListener !== "function") globalThis.addEventListener = () => {};
globalThis.location = { search: "" };
globalThis.document = {
    head: { appendChild() {} },
    createElement: () => ({ style: {}, textContent: "" }),
    getElementById: () => null,
    addEventListener() {},
};
globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
let n = 0;
async function loadAmbience({ installed, saved, mark, search = "" }) {
    for (const k of Object.keys(store)) delete store[k];
    delete globalThis.__dwInstalled;
    if (installed) globalThis.__dwInstalled = true;
    if (saved) store["dw.fx.v1"] = JSON.stringify(saved);
    if (mark) store[UPGRADE_MARK_KEY] = "1";
    store["dw.fx.p2vreset"] = "1";
    globalThis.location = { search };
    return import(`../web/ambience.js?ship=${++n}`);
}

// ---------------------------------------------------------------- the list
test("ship list: every FX_DEFS key has exactly one entry, no extras, counts 44 / 9 / 48", async () => {
    const { FX_DEFS } = await loadAmbience({});
    const keys = FX_DEFS.map(([k]) => k);
    assert.equal(keys.length, 101);
    assert.equal(new Set(keys).size, 101, "FX_DEFS has no duplicate key");
    assert.deepEqual(Object.keys(SHIP).sort(), [...keys].sort(), "same keys, none missing, none extra");
    assert.equal(SHIP_IN.length, 44);
    assert.equal(SHIP_AUTO.length, 9);
    assert.equal(SHIP_OUT.length, 48);
    assert.equal(new Set([...SHIP_IN, ...SHIP_AUTO, ...SHIP_OUT]).size, 101, "no key sits in two classes");
    for (const k of keys) assert.ok(["in", "auto", "out"].includes(SHIP[k]), k);
});

test("ship list: the named auto keys and a sample of in / out keys", () => {
    assert.deepEqual([...SHIP_AUTO].sort(), "widefield battlewide uisharp smartcam mpbubbles mpcredit glossary options dw2motion".split(" ").sort());
    for (const k of ["quests", "questtriggers", "questemotes", "questplacecard", "questsecondjob", "battlespeed", "encounterdial", "leaves", "fireflies", "steps", "sound", "footsteps", "rain", "tod"]) assert.equal(shipClass(k), "in", k);
    for (const k of ["mount", "hd2d", "ownclips", "smoothanim", "chatqueue", "devils", "villagers", "serverchamp", "anglermap"]) assert.equal(shipClass(k), "out", k);
    assert.equal(shipClass("quality"), null);
    assert.equal(shipForced("rain"), null);
    assert.equal(shipForced("mount"), false);
    assert.equal(shipForced("dw2motion"), true);
});

test("ship list: pure, no DOM", () => {
    const src = read("../web/ship-list.js");
    assert.doesNotMatch(src, /\b(document|localStorage|fetch)\b/);
});

// ---------------------------------------------------------------- the marker
test("installed marker: isInstalledBuild only says yes for window.__dwInstalled === true", () => {
    assert.equal(isInstalledBuild({}), false);
    assert.equal(isInstalledBuild({ __dwInstalled: "1" }), false);
    assert.equal(isInstalledBuild({ __dwInstalled: true }), true);
    assert.equal(isInstalledBuild(null), false);
});

test("installed marker: the release workflow writes web/installed-build.js into the bundle; git does not track it", () => {
    const wf = read("../.github/workflows/release.yml");
    assert.match(wf, /installed-build\.js/, "the workflow mentions the marker");
    assert.match(wf, /window\.__dwInstalled\s*=\s*true/, "and sets the flag");
    assert.match(wf, /dist\/DW2003\/app\/web\/installed-build\.js/, "inside the bundled game code");
    const assemble = wf.indexOf("Assemble bundle"), mark = wf.indexOf("installed-build.js"), pack = wf.indexOf("Package (Windows installer)");
    assert.ok(assemble > 0 && mark > assemble && mark < pack, "written after the bundle is assembled, before it is packaged");
    assert.equal(existsSync(new URL("../web/installed-build.js", import.meta.url)), false, "the checkout has no marker");
    const tracked = execFileSync("git", ["ls-files", "web/installed-build.js"], { cwd: new URL("..", import.meta.url) }).toString().trim();
    assert.equal(tracked, "", "not in git");
});

test("installed marker: index.html loads it before game.js; the launcher never writes it, so 8090 and --port 8770 from the checkout stay the owner PC", () => {
    const html = read("../web/index.html");
    const a = html.indexOf("installed-build.js"), b = html.indexOf("game.js");
    assert.ok(a > 0 && a < b, "marker script before the game module");
    assert.doesNotMatch(read("../launcher/dw2003.py"), /installed-build/);
});

// ---------------------------------------------------------------- rule 2: defaults, both builds
for (const installed of [false, true]) {
    test(`defaults (${installed ? "installed" : "owner PC"}): in and auto start on, out starts off`, async () => {
        const { fx } = await loadAmbience({ installed });
        for (const k of SHIP_IN) assert.equal(fx[k], true, `in ${k}`);
        for (const k of SHIP_AUTO) assert.equal(fx[k], true, `auto ${k}`);
        for (const k of SHIP_OUT) assert.equal(fx[k], false, `out ${k}`);
    });
}

test("owner PC: every switch stays changeable and a saved dw.fx.v1 is respected", async () => {
    const { fx, setFx, setFxMany } = await loadAmbience({ saved: { rain: false, mount: true, dw2motion: false, widefield: false, quests: false } });
    assert.equal(fx.rain, false);
    assert.equal(fx.mount, true, "an out key saved on stays on for the owner");
    assert.equal(fx.dw2motion, false);
    assert.equal(fx.widefield, false);
    assert.equal(fx.quests, false, "no upgrade pass on the owner PC");
    assert.equal(store[UPGRADE_MARK_KEY], undefined, "no marker written");
    setFx("hd2d", true); assert.equal(fx.hd2d, true);
    setFx("mpcredit", false); assert.equal(fx.mpcredit, false);
    setFxMany({ ownclips: true, grass: false }); assert.equal(fx.ownclips, true); assert.equal(fx.grass, false);
    window.__fx.devils = true; assert.equal(fx.devils, true);
});

// ---------------------------------------------------------------- rule 3: installed
test("installed: out forced off and auto forced on, whatever the save says", async () => {
    const saved = { mount: true, hd2d: true, ownclips: true, smoothanim: true, chatqueue: true, dw2motion: false, widefield: false, glossary: false, options: false };
    const { fx } = await loadAmbience({ installed: true, saved });
    for (const k of SHIP_OUT) assert.equal(fx[k], false, k);
    for (const k of SHIP_AUTO) assert.equal(fx[k], true, k);
});

test("installed: URL flags, window setters, presets, scenes and direct writes can not change out / auto", async () => {
    const { fx, setFx, setFxMany, applyScene } = await loadAmbience({ installed: true, search: "?noambience=1&weather=always&mount=1&hd2d=1&ownclips=1" });
    setFx("mount", true); setFx("dw2motion", false);
    setFxMany({ hd2d: true, widefield: false, practice2v2: true });
    window.__setFx("villagers", true); window.__setFxMany({ ownclips: true, options: false });
    window.__applyPreset("cinematic");
    applyScene({ tod: "day", mode: "clear" });
    fx.cinema = true; fx.glossary = false;
    Object.assign(window.__fx, { toonoutline: true, battlewide: false });
    assert.doesNotThrow(() => { window.__fx.mount = true; });
    for (const k of SHIP_OUT) assert.equal(fx[k], false, k);
    for (const k of SHIP_AUTO) assert.equal(fx[k], true, k);
    assert.equal(window.__fx, fx);
    const saved = JSON.parse(store["dw.fx.v1"] || "{}");
    for (const k of SHIP_OUT) assert.ok(saved[k] !== true, `never saved on: ${k}`);
    for (const k of SHIP_AUTO) assert.ok(saved[k] !== false, `never saved off: ${k}`);
});

test("installed: an in key can still be switched by the player and is remembered", async () => {
    const first = await loadAmbience({ installed: true });
    first.setFx("leaves", false);
    assert.equal(first.fx.leaves, false);
    const kept = JSON.parse(store["dw.fx.v1"]);
    const again = await loadAmbience({ installed: true, saved: kept, mark: true });
    assert.equal(again.fx.leaves, false);
});

test("installed: an old save with an in key off gets the in defaults once (one stored marker), then choices are respected", async () => {
    const old = { rain: false, quests: false, leaves: false, sound: false, grass: false };
    const up = await loadAmbience({ installed: true, saved: old });
    for (const k of SHIP_IN) assert.equal(up.fx[k], true, `upgraded ${k}`);
    assert.equal(store[UPGRADE_MARK_KEY], "1", "one marker stored");
    const kept = JSON.parse(store["dw.fx.v1"]);
    for (const k of SHIP_IN) assert.equal(kept[k], true, `stored ${k}`);
    up.setFx("rain", false);
    const saved2 = JSON.parse(store["dw.fx.v1"]);
    assert.equal(saved2.rain, false);
    const next = await loadAmbience({ installed: true, saved: saved2, mark: true });
    assert.equal(next.fx.rain, false, "respected after the one-time pass");
    assert.equal(next.fx.grass, true);
});

test("finishShipLoad: owner PC changes nothing; installed upgrades once then locks", () => {
    const own = { rain: false, mount: true };
    assert.deepEqual(finishShipLoad(own, { installed: false }), { upgraded: false, installed: false });
    assert.deepEqual(own, { rain: false, mount: true });
    const inst = { rain: false, mount: true, dw2motion: false };
    assert.equal(finishShipLoad(inst, { installed: true, markValue: null }).upgraded, true);
    assert.equal(inst.rain, true); assert.equal(inst.mount, false); assert.equal(inst.dw2motion, true);
    const inst2 = { rain: false };
    assert.equal(finishShipLoad(inst2, { installed: true, markValue: "1" }).upgraded, false);
    assert.equal(inst2.rain, false);
});

test("lockShipped keeps keys visible to spread and JSON, and ignores writes", () => {
    const o = applyShipDefaults({});
    lockShipped(o);
    o.mount = true; o.dw2motion = false;
    assert.equal({ ...o }.mount, false);
    assert.equal(JSON.parse(JSON.stringify(o)).dw2motion, true);
});

// ---------------------------------------------------------------- F2 does nothing when installed
test("installed: F2 builds no panel, no gear and no key handler (source)", () => {
    const src = read("../web/ambience.js");
    assert.match(src, /const SHIPPED = isInstalledBuild\(\)/);
    assert.match(src, /export function installFxPanel\(stageEl\) \{\s*\n\s*if \(panel \|\| !stageEl \|\| SHIPPED\) return;/);
});

// ---------------------------------------------------------------- battle bridge (reads the store directly)
test("battle-settings: installed ignores a saved ownclips / smoothanim and reports dw2motion on; owner PC follows the save, dw2motion defaults on", async () => {
    const { battleSetting } = await import("../web/fight/battle-settings.js");
    for (const k of Object.keys(store)) delete store[k];
    delete globalThis.__dwInstalled; delete globalThis.__fx;
    assert.equal(battleSetting("dw2motion"), false, "headless (no live fx object): the Node tools keep the disc motion");
    globalThis.__fx = { dw2motion: true, ownclips: false };
    assert.equal(battleSetting("dw2motion"), true, "owner PC in the browser: the live fx default (on)");
    assert.equal(battleSetting("ownclips"), false);
    store["dw.fx.v1"] = JSON.stringify({ ownclips: true, dw2motion: false, smoothanim: true });
    assert.equal(battleSetting("ownclips"), true, "owner PC respects the save");
    assert.equal(battleSetting("dw2motion"), false);
    globalThis.__dwInstalled = true;
    assert.equal(battleSetting("ownclips"), false, "installed: out forced off");
    assert.equal(battleSetting("smoothanim"), false);
    assert.equal(battleSetting("dw2motion"), true, "installed: auto forced on");
    delete globalThis.__dwInstalled;
});

test("own-clips and dw2-motion: installed ignores the URL / override flags", async () => {
    globalThis.__dwInstalled = true;
    const oc = await import("../web/fight/own-clips.js");
    oc.setOwnClipsEnabled(true);
    assert.equal(oc.ownClipsEnabled(), false, "installed: ?ownclips=1 or a setter can not turn it on");
    oc.setOwnClipsEnabled(null);
    const dm = await import("../web/fight/dw2-motion.js");
    dm.setDw2MotionEnabled(false);
    assert.equal(dm.dw2MotionEnabled(), true, "installed: DW2 motion is always on");
    dm.setDw2MotionEnabled(null);
    delete globalThis.__dwInstalled;
});
