// Edge-case audit of EVERY quest scene step (walk..sfx, the fx family, pan, drop/rise, fade, battle, warp, shake,
// weather, time, lightning, chase, ghost, props). The full audit, with the file:line behind each verdict, is
// ~/scratch-research/quest-fx2/EDGES.md -- read it next to this file.
//
// How to read a failure here:
//   test("...")          pins the behaviour we WANT and the code already has. A red one is a regression.
//   knownBug("...")      pins the behaviour we want and the code does NOT have yet: a known BUG, filed against its
//                        owner (see EDGES.md). It is green while the bug exists and goes RED the moment somebody fixes
//                        it -- then turn it into a normal test() and update the verdict in EDGES.md.
// (This Node build has no test.failing, so knownBug() is that: the body must throw today, and the suite stays green
// while it does.)
// Nothing in this file needs a browser: compileScene and web/quest-fx.js are plain data and numbers. The edges that
// only exist in the running game (a lost mid-scene fight, a map change, F2 "Quests" switched off, HD assets) are in
// tools/verify_quest_edges.mjs, which plays them in Chromium and writes screenshots.
import test from "node:test";
import assert from "node:assert/strict";
import { compileScene, validateScene, castOf } from "../web/quest-scenes.js";
import {
  defineQuestFxSheet, questFxSheetInfo, questFxSpawn, questFxGet, questFxWait, questFxMove, questFxPlay,
  questFxRemove, questFxClear, questFxTick, questFxState, questFxDrawables,
  questFxShake, questFxShakeOffset, questFxShaking, questFxShakeState,
  questFxFade, questFxFadeAlpha, questFxDrivePlayer, questFxDriveState, installQuestFxPlayerDrive,
} from "../web/quest-fx.js";

// The player is id 2 in these scenes; 27 and 1005 stand on the map, 999 does not.
const POS = (id) => (id === 2 ? { x: 100, y: 200 } : id === 27 ? { x: 923, y: 374 } : id === 1005 ? { x: 300, y: 300 } : null);
const compile = (steps, extra = {}) => compileScene(steps, { playerId: 2, pos: POS, ...extra });
const frame = (n = 1) => { for (let i = 0; i < n; i++) questFxTick(1 / 60); };
const tick = () => new Promise((r) => setImmediate(r));
/** Run field blanks until `done()` is true (or the cap), letting promise callbacks run between them. */
async function until(done, blanks = 600) {
  for (let i = 0; i < blanks && !done(); i++) { frame(1); await tick(); }
  return done();
}

// A two-frame sheet, so every fx test starts from a clean, known sheet.
const SHEET = {
  frame: [8, 8], anchor: [0.5, 1],
  clips: { idle: { frames: [0, 1], hold: 4 }, fall: { frames: [0, 1], hold: 3 }, end: { frames: [1], hold: 8 } },
  default: "idle",
};
const useSheet = (name = "probe") => defineQuestFxSheet(name, SHEET, { naturalWidth: 16, naturalHeight: 8 });

/**
 * A known bug, encoded: the body must THROW today. Green while the bug exists; red once it is fixed, with the reason
 * printed, so the fixer turns it into an ordinary test and updates EDGES.md.
 */
function knownBug(name, fn) {
  return test(`KNOWN BUG ${name}`, async () => {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    assert.ok(err, `${name} -- FIXED? turn this into a normal test() and update EDGES.md`);
    console.log(`   still open: ${String(err?.message ?? err).split("\n")[0]}`);
  });
}

// =====================================================================================================================
// 1. The authoring surface: every documented step compiles, and nothing else does
// =====================================================================================================================
test("every step kind the scene language documents compiles on its own", () => {
  const cases = {
    walk: { walk: 27, to: [10, 20] },
    together: { together: 27, dist: 80 },
    apart: { apart: 27 },
    wait: { wait: 30 },
    arrive: { arrive: 27 },
    face: { face: 27, dir: "left" },
    put: { put: 27, at: [5, 6] },
    look: { look: "player" },
    say: { say: 27, name: "Leomon", text: "Hello." },
    ask: { ask: "Ready?", options: ["Yes", "No"] },
    sfx: { sfx: "door" },
    pan: { pan: [640, 320] },
    drop: { drop: 100 },
    rise: { rise: 100 },
    fade: { fade: "out", frames: 10 },
    battle: { battle: 12 },
    warp: { warp: { map: "s320", at: [576, 448] } },
    fx: { fx: "crate", at: [10, 20] },
    fxplay: { fxplay: "crate", clip: "end" },
    fxmove: { fxmove: "crate", slide: { to: [1, 2], frames: 10 } },
    fxwait: { fxwait: "crate" },
    fxremove: { fxremove: "crate", fade: 5 },
    shake: { shake: 6, frames: 20 },
    weather: { weather: "fog" },
    time: { time: "night" },
    lightning: { lightning: 1 },
    chase: { chase: 27, path: [[923, 300]] },
    ghost: { ghost: 27 },
  };
  for (const [kind, step] of Object.entries(cases)) assert.deepEqual(validateScene([step]), [], `${kind} compiles`);
});

test("the step list is append-only in behaviour: a seam of five different steps compiles in one scene", () => {
  const { opcodes, events, errors } = compile([
    { wait: 6 }, { pan: [500, 300] }, { fx: "crate", at: [500, 320], fall: { floor: 360 } },
    { shake: 4, frames: 8 }, { weather: "fog", frames: 4 }, { time: "dusk", frames: 4 },
    { lightning: 1 }, { fxwait: "crate" }, { fxremove: "crate" }, { fade: "out" }, { fade: "in" }, { pan: "player" },
  ]);
  assert.deepEqual(errors, []);
  assert.equal(events.length, 9);            // fx, shake, weather, time, lightning, fxwait, fxremove, fade out, fade in
  assert.ok(opcodes.at(-1) === "END");
});

test("an unknown step is refused by name and by position, never run", () => {
  assert.deepEqual(validateScene([{ wait: 1 }, { dance: 1 }, { wait: 1 }]), ['step 2: unknown step ["dance"]']);
});

test("defaults are the documented ones, so a short step still behaves", () => {
  assert.deepEqual(compile([{ weather: "fog" }]).events[0], { kind: "weather", weather: "fog", strength: 0.75, frames: 30 });
  assert.deepEqual(compile([{ time: "night" }]).events[0], { kind: "time", time: "night", frames: 60 });
  assert.deepEqual(compile([{ lightning: true }]).events[0], { kind: "lightning", count: 1 });
  assert.deepEqual(compile([{ chase: 27, path: [[0, 0]] }]).events[0], { kind: "chase", target: 27, path: [[0, 0]], speed: 130, lose: 90 });
  assert.deepEqual(compile([{ ghost: 27 }]).events[0], { kind: "ghost", npc: 27, alpha: 0.5 });
  assert.deepEqual(compile([{ fade: true }]).events[0], { kind: "fade", to: "out", frames: 30 });
  assert.deepEqual(compile([{ warp: "s330", at: [1, 2] }]).events[0], { kind: "warp", to: "s330", at: [1, 2] });
});

// =====================================================================================================================
// 2. "The step's target is not on the map / sheet missing / bad data -> skip the step, scene goes on, never blocks"
// =====================================================================================================================
test("a character a step needs but the map does not have fails the WHOLE scene, so the quest speaks its plain lines", () => {
  // compile-time: the scene is refused (not half-run), and the error names the step. validateScene() cannot see this --
  // it answers a position for every id -- so the real pos() game.js passes in is what decides.
  for (const step of [{ fx: "crate", at: { near: 999, dx: 4 } }, { walk: 999, to: "origin" }, { face: 999, dir: 3 }]) {
    const { errors } = compile([step]);
    assert.equal(errors.length, 1, JSON.stringify(step));
    assert.match(errors[0], /^step 1: /);
  }
  // runtime: playQuestScene returns null on any compile error, and quests.js then speaks the plain lines
  assert.ok(compile([{ fx: "crate", at: { near: 999 } }]).errors.length);
});

test("a sheet that is not on disk is not placed, and the step after it still runs", () => {
  // no sheet registered under this name (the loader remembers a failed fetch as missing)
  assert.equal(questFxSpawn({ name: "never-loaded", sheet: "never-loaded", x: 1, y: 2 }), null);
  assert.deepEqual(questFxState(), []);
  assert.deepEqual(questFxDrawables(0, 0), []);
  // a wait on it resolves at once: a scene never hangs on art it does not have
  return questFxWait("never-loaded").then((r) => assert.equal(r, false));
});

test("bad data in a step is refused at compile time, one error per step, the rest of the scene still checked", () => {
  const errors = validateScene([
    { wait: 1 },
    { shake: 0 },                       // amplitude out of range
    { weather: "hail" },                // not a weather we draw
    { ghost: 27, tint: "blue" },        // not #rrggbb
    { chase: 27, path: [] },            // a chase needs somewhere to go
    { fade: "sideways" },
    { battle: "twelve" },
    { warp: { map: "s330" } },          // a warp needs a spot
  ]);
  assert.equal(errors.length, 7, errors.join(" | "));
  assert.deepEqual(errors.map((e) => e.split(":")[0]), ["step 2", "step 3", "step 4", "step 5", "step 6", "step 7", "step 8"]);
});

test("a character a scene has just `put` on the map can be `face`d and sent to `origin` (fixed 15:34, was BUG-6)", () => {
  // `put` exists to bring an off-map visitor in (castOf already allows them: game.js `here()` accepts any actor with a
  // sprite). But pos() cannot answer for a visitor, so these two steps fail the whole scene even though `put` gave the
  // position. Fix: compileScene keeps the position each `put` sets and `face`/`to:"origin"` fall back to it.
  const visitor = (id) => (id === 27 ? null : POS(id));
  const { errors } = compileScene([{ put: 27, at: [500, 600] }, { face: 27, dir: "up" }, { walk: 27, to: "origin" }],
    { playerId: 2, pos: visitor });
  assert.deepEqual(errors, []);
});

// =====================================================================================================================
// 3. "The same step twice in a row" / "two scenes in a row"
// =====================================================================================================================
test("every step may appear twice: the compiled scene keeps both, in order", () => {
  const twice = [[{ wait: 2 }, { wait: 2 }], [{ fade: "out" }, { fade: "in" }], [{ shake: 3, frames: 4 }, { shake: 3, frames: 4 }],
    [{ drop: 8 }, { drop: 8 }], [{ ghost: 27 }, { ghost: 27, off: true }], [{ weather: "rain" }, { weather: "clear" }]];
  for (const steps of twice) assert.deepEqual(validateScene(steps), [], JSON.stringify(steps));
});

test("an effect name reused twice keeps one live effect, and the newest one wins", () => {
  questFxClear(); useSheet();
  questFxSpawn({ name: "a", sheet: "probe", x: 0, y: 0 });
  questFxSpawn({ name: "a", sheet: "probe", x: 50, y: 60 });
  assert.equal(questFxState().length, 1);
  assert.equal(questFxGet("a").x, 50);
});

test("re-using an effect name settles whoever was waiting on the old one (fixed 15:34, was BUG-4)", () => {
  // A scene cannot currently reach this (fxwait blocks the opcode stream), but the module is public API and a prop or a
  // second scene reusing a name would leave the first waiter pending forever. Fix: in questFxSpawn, `const old =
  // live.get(name); if (old && old !== fx) removeFx(old);` -- the same resolve-every-waiter removal questFxRemove does.
  questFxClear(); useSheet();
  const first = questFxSpawn({ name: "b", sheet: "probe", x: 0, y: 0, slide: { to: [900, 0], frames: 900 } });
  let settled = false;
  questFxWait("b").then(() => { settled = true; });
  questFxSpawn({ name: "b", sheet: "probe", x: 5, y: 5 });
  return tick().then(() => assert.ok(settled, "the old effect's waiter never resolved"));
});

test("two scenes in a row leave nothing behind for the second one to inherit", () => {
  questFxClear(); useSheet();
  questFxSpawn({ name: "c", sheet: "probe", x: 0, y: 0, fall: { floor: 100 } });
  questFxShake({ amp: 5, frames: 10 });
  questFxFade("out", 4);
  frame(2);
  questFxClear();                                    // exactly what a scene ending does
  assert.deepEqual(questFxState(), []);
  assert.equal(questFxFadeAlpha(), 0);
  assert.equal(questFxShaking(), false);
  assert.equal(questFxDriveState(), null);
  // and the next scene starts clean
  questFxSpawn({ name: "d", sheet: "probe", x: 1, y: 1 });
  assert.equal(questFxState().length, 1);
  questFxClear();
});

// =====================================================================================================================
// 4. The effect family (fx, fxplay, fxmove, fxwait, fxremove): motion, waits and removal
// =====================================================================================================================
test("a fall lands on its floor and settles, even when it starts below the floor", () => {
  questFxClear(); useSheet();
  const fx = questFxSpawn({ name: "f", sheet: "probe", x: 0, y: 200, fall: { floor: 100, step: 1 } });
  frame(1);
  assert.equal(fx.y, 100, "a fall that starts under its floor snaps up to it, it does not sink");
  assert.equal(fx.motion, null);
});

test("a fall bounces as -v/3 and stops, and fxwait resolves when it does", async () => {
  questFxClear(); useSheet();
  questFxSpawn({ name: "g", sheet: "probe", x: 0, y: 0, fall: { floor: 60, step: 1 } });
  let settled = false;
  questFxWait("g").then(() => { settled = true; });
  assert.ok(await until(() => settled), "the fall settled");
  assert.equal(questFxGet("g").y, 60);
  assert.equal(questFxGet("g").motion, null);
});

test("a slide arrives exactly on its last frame and a rise lifts by exactly its pixels", () => {
  questFxClear(); useSheet();
  const s = questFxSpawn({ name: "s", sheet: "probe", x: 0, y: 0, slide: { to: [120, 60], frames: 10 } });
  frame(10);
  assert.deepEqual([s.x, s.y], [120, 60]);
  assert.equal(s.motion, null);
  const r = questFxSpawn({ name: "r", sheet: "probe", x: 0, y: 500, rise: { pixels: 60, frames: 12 } });
  frame(12);
  assert.equal(r.y, 440);
});

test("a rise with negative pixels goes down (documented, not refused: the sign is the direction)", () => {
  questFxClear(); useSheet();
  assert.deepEqual(compile([{ fx: "x", at: [0, 0], rise: { pixels: -40, frames: 4 } }]).events[0].rise, { pixels: -40, frames: 4 });
  const fx = questFxSpawn({ name: "neg", sheet: "probe", x: 0, y: 100, rise: { pixels: -40, frames: 4 } });
  frame(4);
  assert.equal(fx.y, 140);
});

test("a hidden tab cannot teleport an effect: one tick advances at most 240 field blanks", () => {
  questFxClear(); useSheet();
  const fx = questFxSpawn({ name: "long", sheet: "probe", x: 0, y: 0, slide: { to: [10000, 0], frames: 10000 } });
  questFxTick(10);                                   // ten seconds in one go
  assert.ok(fx.x <= 241, `a 10 s tick moved ${fx.x} px`);
  assert.ok(fx.motion, "the slide is still running");
});

test("fxremove fades out and then goes, and fxwait on it resolves either way", async () => {
  questFxClear(); useSheet();
  questFxSpawn({ name: "h", sheet: "probe", x: 0, y: 0 });
  questFxRemove({ name: "h", fade: 5 });
  assert.equal(questFxState()[0].alpha, 1);
  let settled = false;
  questFxWait("h").then(() => { settled = true; });
  frame(3);
  assert.ok(questFxState()[0].alpha < 1);
  assert.ok(await until(() => settled), "the fade-out ended and the wait resolved");
  assert.equal(questFxGet("h"), null);
});

test("fxplay/fxmove on an effect or a clip that is not there answer false and change nothing", () => {
  questFxClear(); useSheet();
  assert.equal(questFxPlay({ name: "nobody", clip: "idle" }), false);
  assert.equal(questFxMove({ name: "nobody", slide: { to: [1, 1] } }), false);
  const fx = questFxSpawn({ name: "i", sheet: "probe", x: 0, y: 0 });
  assert.equal(questFxPlay({ name: "i", clip: "no-such-clip" }), false);
  assert.equal(fx.clip, "idle");
  assert.equal(questFxMove({ name: "i" }), false);
  assert.equal(fx.motion, null);
});

test("a sheet definition without a frame size or clips is refused, not half-registered", () => {
  assert.equal(defineQuestFxSheet("bad", { frame: [0, 0], clips: {} }), null);
  assert.equal(questFxSheetInfo("bad"), null);
  assert.equal(questFxSpawn({ name: "bad", sheet: "bad", x: 0, y: 0 }), null);
});

test("a sheet with no default clip falls back to its first one, and a sheet with no clips still draws a cell", () => {
  defineQuestFxSheet("firstonly", { frame: [8, 8], clips: { z: { frames: [0], hold: 4 } } }, { naturalWidth: 8 });
  assert.equal(questFxSpawn({ name: "fo", sheet: "firstonly", x: 0, y: 0 }).clip, "z");
  defineQuestFxSheet("empty", { frame: [8, 8], clips: {} }, { naturalWidth: 8 });
  const fx = questFxSpawn({ name: "e", sheet: "empty", x: 0, y: 0 });
  assert.ok(fx && fx.clipDef.frames.length === 1, "an effect with no clip still has one still cell");
  questFxClear();
});

// =====================================================================================================================
// 5. The screen: fade, shake, and the player's drop
// =====================================================================================================================
test("fade: out holds black until told otherwise, in returns, black/clear are instant", async () => {
  questFxClear();
  await questFxFade("black");
  assert.equal(questFxFadeAlpha(), 1);
  let back = false;
  questFxFade("in", 10).then(() => { back = true; });
  assert.ok(await until(() => back), "the fade-in finished");
  assert.equal(questFxFadeAlpha(), 0);
  let out = false;
  questFxFade("out", 10).then(() => { out = true; });
  assert.ok(await until(() => out), "the fade-out finished");
  assert.equal(questFxFadeAlpha(), 1);
  await questFxFade("clear");
  assert.equal(questFxFadeAlpha(), 0);
});

test("fade already at its target resolves at once (the same step twice is safe)", async () => {
  questFxClear();
  let first = false;
  questFxFade("out", 5).then(() => { first = true; });
  assert.ok(await until(() => first));
  const again = questFxFade("out", 5);              // already black: nothing to run
  let second = false;
  again.then(() => { second = true; });
  await tick();
  assert.ok(second);
  assert.equal(questFxFadeAlpha(), 1);
  questFxClear();
});

test("questFxClear releases a fade and a shake that were still running (a scene must never hang on exit)", async () => {
  questFxClear();
  let faded = false, shaken = false;
  questFxFade("out", 600).then(() => { faded = true; });
  questFxShake({ amp: 6, frames: 600 }).then(() => { shaken = true; });
  frame(2);
  questFxClear();
  await tick();
  assert.ok(faded && shaken);
  assert.equal(questFxFadeAlpha(), 0);
  assert.deepEqual(questFxShakeOffset(), { x: 0, y: 0 });
});

test("a shake batch ends on its own, and a new batch releases the old one's wait at once", async () => {
  questFxClear();
  let first = false;
  questFxShake({ amp: 8, frames: 100 }).then(() => { first = true; });
  let second = false;
  questFxShake({ amp: 4, frames: 8, every: 4, times: 2 }).then(() => { second = true; });
  await tick();
  assert.ok(first, "the superseded batch resolves at once");
  assert.ok(questFxShaking());
  assert.ok(questFxShakeState().total > 0);
  assert.ok(await until(() => second), "the batch died out");
  assert.equal(questFxShaking(), false);
  assert.deepEqual(questFxShakeOffset(), { x: 0, y: 0 });
});

test("a shake offset never exceeds its amplitude and a zero amplitude is refused at compile time", () => {
  questFxClear();
  questFxShake({ amp: 6, frames: 40 });
  for (let i = 0; i < 40; i++) {
    const o = questFxShakeOffset();
    assert.ok(Math.abs(o.x) <= 6 && Math.abs(o.y) <= 6, `offset ${JSON.stringify(o)} within 6`);
    frame(1);
  }
  assert.ok(validateScene([{ shake: 0 }]).length);
  assert.ok(validateScene([{ shake: 41 }]).length);
  assert.ok(validateScene([{ shake: 6, times: 13 }]).length);
});

test("drop/rise: no field character to drive means the step is skipped at once, not waited on", async () => {
  questFxClear();
  const r = await questFxDrivePlayer(120, 0.25);
  assert.equal(r, 0);
  assert.equal(questFxDriveState(), null);
});

test("drop/rise: with the field character installed it travels exactly the distance asked", async () => {
  questFxClear();
  let fixed = 0;
  installQuestFxPlayerDrive((d) => { fixed += d; });
  try {
    const p = questFxDrivePlayer(40, 0.25);       // 16.8 fixed point: 256 per pixel
    for (let i = 0; i < 200 && questFxDriveState(); i++) frame(1);
    await p;
    assert.ok(Math.abs(fixed - 40 * 256) < 2, `moved ${fixed / 256} px, wanted 40`);
    assert.equal(questFxDriveState(), null);
  } finally {
    installQuestFxPlayerDrive(null);
  }
});

test("questFxClear releases a player drive that is still running (fixed 15:38, was BUG-3)", () => {
  // Every waiter in the module must be resolved by questFxClear: the drive's used to be dropped on the floor, so a clear
  // that happened while the scene lived on (a map change) left the SCENEEVENT hook waiting forever.
  questFxClear();
  installQuestFxPlayerDrive(() => {});
  let done = false;
  try {
    questFxDrivePlayer(1000, 0.25).then(() => { done = true; });
    frame(1);
    questFxClear();
    return tick().then(() => assert.ok(done, "the drive's promise was released"));
  } finally {
    installQuestFxPlayerDrive(null);
  }
});

// =====================================================================================================================
// 6. New steps: weather, time, lightning, chase, ghost, sfx (compile-side edges; the live ones are in the browser)
// =====================================================================================================================
test("weather accepts every panel effect a scene may ask for and refuses anything else", () => {
  for (const w of ["fog", "rain", "storm", "snow", "blizzard", "sand", "leaves", "fireflies", "clear"]) {
    assert.deepEqual(validateScene([{ weather: w }]), [], w);
  }
  assert.ok(validateScene([{ weather: "hail" }]).length);
  assert.ok(validateScene([{ weather: "rain", strength: "hard" }]).length);
  assert.equal(compile([{ weather: "rain", strength: 4 }]).events[0].strength, 1, "strength is clamped, not refused");
  assert.equal(compile([{ weather: "rain", force: true }]).events[0].force, true);
});

test("time pins one of the four phases and carries force through", () => {
  for (const t of ["day", "golden", "dusk", "night"]) assert.deepEqual(validateScene([{ time: t }]), [], t);
  assert.ok(validateScene([{ time: "midnight" }]).length);
  assert.equal(compile([{ time: "night", force: true }]).events[0].force, true);
});

test("lightning takes 1 to 6 flashes", () => {
  for (const n of [1, 3, 6]) assert.deepEqual(validateScene([{ lightning: n }]), [], String(n));
  assert.ok(validateScene([{ lightning: 0 }]).length);
  assert.ok(validateScene([{ lightning: 7 }]).length);
});

test("`lightning` with force: true carries the force into the event (fixed 15:38, was BUG-2)", () => {
  // game.js calls ambienceLightning(ev.count, ev.force); the flag used to be dropped, so a bolt a scene forces never
  // showed for a player who switched lightning off in F2.
  assert.equal(compile([{ lightning: 1, force: true }]).events[0].force, true);
  assert.equal(compile([{ lightning: 1 }]).events[0].force, undefined);
});

test("an `sfx` step emits the cue it names (fixed 15:34, was BUG-1)", () => {
  // `sfx` is in the documented people steps and every scene accepts it, but compileScene drops it on the floor: no
  // opcode, no event, no warning. An author hears nothing and has no way to know. Fix: `event({ kind: "sfx", name: s.sfx })`
  // (plus one case in runQuestSceneEvent that calls the host's sfx player), or refuse the step loudly until it exists.
  const { opcodes, events } = compile([{ say: null, text: "..." }, { sfx: "door" }]);
  assert.equal(events.length, 1, "the cue is performed by the host");
  assert.ok(opcodes.length > 2);
});

test("chase: a numeric id is an NPC, any other string is one of our effects; the path is bounded", () => {
  assert.equal(compile([{ chase: 27, path: [[1, 2]] }]).events[0].target, 27);
  assert.equal(compile([{ chase: "crate", path: [[1, 2]] }]).events[0].target, "crate");
  assert.equal(compile([{ chase: "27", path: [[1, 2]] }]).events[0].target, "27", "a quoted number is an effect name");
  assert.ok(validateScene([{ chase: 27, path: new Array(65).fill([0, 0]) }]).length);
  assert.ok(validateScene([{ chase: 27, path: [[1]] }]).length);
  assert.ok(validateScene([{ chase: 27, path: [[1, 2]], frames: 0 }]).length);
  // the camera is put back on the player before the run, whatever an earlier pan was doing
  assert.ok(compile([{ chase: 27, path: [[1, 2]] }]).opcodes.includes("FN6A 1 2"));
});

test("ghost: on with alpha/tint, or off; a bad value is refused rather than guessed", () => {
  assert.deepEqual(compile([{ ghost: 27, alpha: 0.3, tint: "#9fc8ff" }]).events[0], { kind: "ghost", npc: 27, alpha: 0.3, tint: "#9fc8ff" });
  assert.deepEqual(compile([{ ghost: 27, off: true }]).events[0], { kind: "ghost", npc: 27, off: true });
  assert.deepEqual(compile([{ ghost: "player" }]).events[0], { kind: "ghost", npc: "player", alpha: 0.5 });
  assert.ok(validateScene([{ ghost: 27, alpha: 2 }]).length);
  assert.ok(validateScene([{ ghost: 27, tint: "#fff" }]).length);
  assert.ok(validateScene([{ ghost: "Leomon" }]).length);
});

test("a ghosted or chased character is part of the cast, so the scene is refused on a map without them", () => {
  assert.deepEqual(castOf([{ chase: 1005, path: [[0, 0]] }, { ghost: 27 }]).sort((a, b) => a - b), [27, 1005]);
});

// =====================================================================================================================
// 7. Props (web/quest-props.js) -- the art a finished quest leaves in the world
// (BUG-5 in EDGES.md was found here: quest-props.js imported a setQuestProps that quest-fx.js no longer exported. Its
// owner rewrote the module to reuse questFxSpawn/questFxRemove mid-audit, so this is now a normal test.)
// =====================================================================================================================
test("props: unusable rows are dropped, a duplicate key never stacks, and the name is prefixed", async () => {
  const { normalize } = await import("../web/quest-props.js");
  const rows = normalize([
    { sheet: "frame", x: 10, y: 20 },                 // unnamed key: sheet@x,y
    { sheet: "frame", x: 10, y: 20 },                 // the same place again: one prop
    { sheet: "", x: 1, y: 2 },                        // no sheet
    { sheet: "frame", x: "left", y: 2 },              // not a place
    { key: "lamp", sheet: "lamp", x: 3, y: 4, solid: true, layer: "front", clip: "lit" },
    null, "nope",
  ]);
  assert.deepEqual(rows.map((r) => r.key), ["frame@10,20", "lamp"]);
  assert.equal(rows[1].name, "prop:lamp");
  assert.equal(rows[1].solid, true);
  assert.equal(rows[1].layer, "front");
  assert.equal(rows[1].clip, "lit");
});

test("props: a solid prop blocks its own feet box and nothing else, and only on its own map", async () => {
  const { questPropsTick, questPropSolidAt, boxHolds, propFootBox, questPropsReset, questPropsState } = await import("../web/quest-props.js");
  useSheet("probe");
  questPropsReset(); questFxClear();
  const n = questPropsTick("s205", [{ key: "sign", sheet: "probe", x: 100, y: 200, solid: true }]);
  assert.equal(n, 1);
  assert.equal(questPropsState()[0].onScreen, true);
  assert.ok(questFxGet("prop:sign"), "the prop is a normal live effect under a prefixed name");
  assert.equal(questPropSolidAt("s205", 100, 195), true);
  assert.equal(questPropSolidAt("s205", 100, 120), false, "10 px deep, not a column");
  assert.equal(questPropSolidAt("s320", 100, 195), false, "another map's frame cannot use these boxes");
  assert.equal(boxHolds(propFootBox({ x: 0, y: 0 }, 1000), 13, 0), false, "the box width is capped at 12 px a side");
  // a prop that no longer holds goes away on the next tick
  questPropsTick("s205", []);
  assert.equal(questFxGet("prop:sign"), null);
  questPropsReset();
});

test("props live in the same list as a scene's effects, so a scene ending removes them until the next tick", async () => {
  // Not a bug (the tick puts them straight back), but it is why a "nothing left on screen" check after a scene must
  // ignore names that start with "prop:" -- and why a prop can never be lost: the quest state, not the clear, owns it.
  const { questPropsTick, questPropsReset } = await import("../web/quest-props.js");
  useSheet("probe");
  questPropsReset(); questFxClear();
  questPropsTick("s205", [{ key: "k", sheet: "probe", x: 1, y: 2 }]);
  assert.equal(questFxState().length, 1);
  questFxClear();                                     // what a scene end does
  assert.equal(questFxState().length, 0, "the clear is blind to what a name means");
  questPropsTick("s205", [{ key: "k", sheet: "probe", x: 1, y: 2 }]);
  assert.equal(questFxState().length, 1, "the next tick puts it back");
  questPropsReset();
});
