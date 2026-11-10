// Faster battles (F2 -> Extras -> "Faster battles", off by default).
//
// A speed slider for battle time only. One scaled dt at the top of web/battle.js
// update() makes the message clock, the HP plate, the blast cinematic, the
// translated native screens and the 3D renderer run faster together; the field,
// the cutscenes and the menus keep the frame dt they always got. This is the
// emulator speed-up the fans already use, as a player setting.
//
// dt is SECONDS (web/game.js: `dt = Math.min((t - lastT) / 1000, 0.1)`), so the
// cap is 0.05 s and the tests feed 1/60, not 16.7.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SPEEDS, battleDelta, battleSpeedOn } from "../web/battle-speed.js";

const BATTLE_SRC = readFileSync(new URL("../web/battle.js", import.meta.url), "utf8");
const AMBIENCE_SRC = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
const DEV_SRC = readFileSync(new URL("../web/dev-panel.js", import.meta.url), "utf8");   // the F2 page draws the slider row
const GAME_SRC = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
const SPEED_SRC = readFileSync(new URL("../web/battle-speed.js", import.meta.url), "utf8");

test("the four speeds are x1, x1.5, x2 and x3", () => {
    assert.deepEqual(SPEEDS, [1, 1.5, 2, 3]);
});

test("battleDelta at 60 Hz: x1 is untouched, x2 doubles, x3 hits the 0.05 s cap", () => {
    assert.equal(battleDelta(1 / 60, 1), 1 / 60, "x1 hands the frame through unchanged");
    assert.ok(Math.abs(battleDelta(1 / 60, 2) - 1 / 30) < 1e-12, "x2 is two 60 Hz frames in one");
    assert.ok(Math.abs(battleDelta(1 / 60, 3) - 0.05) < 1e-12, "x3 of one 60 Hz frame is the 0.05 s cap");
});

test("battleDelta caps a big frame delta, so one long stall cannot teleport the battle", () => {
    assert.equal(battleDelta(1, 2), 0.05);
});

test("battleDelta clamps the speed to 1..3, and a missing speed means x1", () => {
    assert.equal(battleDelta(1 / 60, 0.5), 1 / 60, "below x1 is x1");
    assert.equal(battleDelta(1 / 60, 10), 0.05, "above x3 is x3, then the cap");
    assert.equal(battleDelta(1 / 60, undefined), 1 / 60, "no stored speed yet = untouched");
});

test("battleSpeedOn is exactly the F2 switch: true only when the row is on", () => {
    assert.equal(battleSpeedOn({ battlespeed: false }), false);
    assert.equal(battleSpeedOn({ battlespeed: true }), true);
    assert.equal(battleSpeedOn({}), false, "a missing row is off");
    assert.equal(battleSpeedOn(undefined), false, "no settings object is off");
    assert.equal(battleSpeedOn(null), false);
});

test("battle.js scales dt once, at the top of update, behind the switch and nowhere else", () => {
    // The one assignment, inside the gate -- with the switch off the battle update
    // receives the untouched dt and the helper is never asked for a delta.
    assert.ok(
        BATTLE_SRC.includes("  function update(dt) {\n    if (battleSpeedOn(window.__fx)) dt = battleDelta(dt, window.__fx.battleSpeed);"),
        "update() opens with the gated dt scale",
    );
    const assignments = BATTLE_SRC.match(/\bdt = battleDelta\(/g) || [];
    assert.equal(assignments.length, 1, "battle.js reassigns dt from the helper exactly once");
    // No URL flag: the switch and the slider are the only way in.
    assert.doesNotMatch(SPEED_SRC, /location|URLSearchParams/, "the helper reads no URL");
    // Purity, checked in the CODE (comments are allowed to name the panel's home).
    const speedCode = SPEED_SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(speedCode, /\bwindow\b|\bdocument\b/, "the helper is pure: no browser globals");
});

test("the field and everything outside the battle keep the game's own dt", () => {
    // game.js's frame loop is the only place the field, cutscenes and menus are
    // stepped; it must never learn about the battle speed.
    assert.doesNotMatch(GAME_SRC, /battleSpeed|battle-speed/, "game.js never scales the field's dt");
    assert.match(GAME_SRC, /const dt = Math\.min\(\(t - lastT\) \/ 1000, 0\.1\);/,
        "the frame loop still hands out real elapsed seconds");
});

test("ambience.js offers the switch in Extras, off by default, with its slider", () => {
    assert.match(AMBIENCE_SRC, /\["battlespeed", "Faster battles"\]/,
        "the Extras row the F2 panel draws");
    assert.match(AMBIENCE_SRC, /const EXPERIMENTAL = \[[^\]]*"battlespeed"/,
        "battlespeed is experimental, so presets and All on never switch it on");
    assert.match(AMBIENCE_SRC, /fx\.battleSpeed = 2;/, "the slider's default is x2");
    assert.match(DEV_SRC, /<input type="range" min="1" max="3" step="0.5" data-slider="battleSpeed"/,
        "the 1..3, step 0.5 slider");
    assert.match(DEV_SRC, /\["lightGain", "hd2dStrength", "battleSpeed"\]/,
        "the panel's slider refresh loop knows the new slider");
    assert.match(DEV_SRC, /data-show-when="battlespeed"/,
        "the slider row is only shown while the switch is on");
    assert.match(DEV_SRC, /querySelectorAll\("\[data-show-when\]"\)/,
        "refreshPanel hides/shows the slider with the switch");
});
