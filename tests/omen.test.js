// tests/omen.test.js — "A feeling before a fight": the field's own warning that the
// decoded encounter counter is nearly out (web/omen.js). Node only: pure numbers, no browser.
//
// The counter is web/game.js's `state._encCounter` (engine [0x80048d64], reset to
// rand()%0x900 folded into 0..1279). Every ENCOUNTER_TICK_FRAMES movement ticks the fieldstg
// driver subtracts the standing zone's rate — engine/dw3/encounters.ts ENCOUNTER_RATE_TABLE,
// [2000, 3, 4, 6, 9, 18] — and rolls when the countdown reaches zero. The omen only READS
// that counter: it never writes it, never changes the rate and never says which Digimon.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encounterStepTick, ENCOUNTER_RATE_TABLE, ENCOUNTER_TICK_FRAMES, FIELD_TICK_RATE,
} from "../engine/index.ts";
import {
  runsLeft, omenLevel, omenCues, WINDOW_RUNS, OMEN_RATE_TABLE,
} from "../web/omen.js";

const game = readFileSync(new URL("../web/game.js", import.meta.url), "utf8");
const ambience = readFileSync(new URL("../web/ambience.js", import.meta.url), "utf8");
const omenSrc = readFileSync(new URL("../web/omen.js", import.meta.url), "utf8");

// The number of real driver runs until the counter expires: call the engine's own
// encounterStepTick until it reports `expired`. This is the number runsLeft must match.
function simulatedRuns(counter, level) {
  let c = counter;
  for (let n = 1; n < 10000; n++) {
    const r = encounterStepTick(c, level);
    if (r.expired) return n;
    c = r.counter;
  }
  throw new Error(`counter ${counter} at level ${level} never expires`);
}

test("the rate table is the engine's own decoded tiers, never a guess", () => {
  assert.deepEqual([...OMEN_RATE_TABLE], [...ENCOUNTER_RATE_TABLE]);
  assert.deepEqual([...ENCOUNTER_RATE_TABLE], [2000, 3, 4, 6, 9, 18]);
});

test("runsLeft is the number of real driver runs left, for every level 1..5", () => {
  for (let level = 1; level <= 5; level++) {
    for (let c = 1; c <= 0x900; c += 7) {
      assert.equal(runsLeft(c, level), simulatedRuns(c, level),
        `counter ${c}, level ${level}`);
    }
  }
});

test("level 0 means never roll here: endless runs, no feeling", () => {
  for (const c of [0, 1, 17, 0x100, 0x900]) {
    assert.equal(runsLeft(c, 0), Infinity);
    assert.equal(omenLevel(c, 0, { enabled: true }), 0);
  }
});

test("a counter already at zero is the next run: 0 runs left, level 1", () => {
  for (const level of [1, 2, 3, 4, 5]) {
    assert.equal(runsLeft(0, level), 0);
    assert.equal(omenLevel(0, level, { enabled: true }), 1);
  }
});

test("the ramp: 0 at 13 runs, 0 at 12, 0.545 at 6, exactly 1 at 1", () => {
  assert.equal(WINDOW_RUNS, 12);
  const level = 1;                       // rate 3: (runs - 1) * 3 + 1 gives exactly `runs` runs
  const at = (runs) => omenLevel((runs - 1) * 3 + 1, level, { enabled: true });
  assert.equal(runsLeft((13 - 1) * 3 + 1, level), 13);
  assert.equal(runsLeft((12 - 1) * 3 + 1, level), 12);
  assert.equal(at(13), 0);
  assert.equal(at(12), 0);
  assert.ok(Math.abs(at(6) - 0.545) < 0.001, `6 runs reads 0.545 (${at(6)})`);
  assert.ok(Math.abs(at(6) - 6 / 11) < 1e-12, "6 runs is 1 - 5/11");
  assert.equal(at(1), 1, "the last run is the full feeling");
  let prev = -1;
  for (let r = 20; r >= 0; r--) {
    const v = at(r);
    assert.ok(v >= 0 && v <= 1, `${r} runs -> ${v} stays inside 0..1`);
    assert.ok(v >= prev, `${r} runs -> ${v} never falls as the counter drains`);
    prev = v;
  }
});

test("the window is 12 runs = 96 movement ticks: about two seconds of walking, not a blink", () => {
  const ticks = WINDOW_RUNS * ENCOUNTER_TICK_FRAMES;
  assert.equal(ticks, 96);
  const seconds = ticks / FIELD_TICK_RATE;
  assert.ok(seconds >= 1.5 && seconds <= 2, `${seconds.toFixed(2)} s at ${FIELD_TICK_RATE} Hz`);
});

test("quiet (standing still) or off is exactly zero", () => {
  for (const c of [1, 10, 30, 300, 0x900]) {
    assert.equal(omenLevel(c, 2, { enabled: false }), 0, "the switch off");
    assert.equal(omenLevel(c, 2), 0, "off by default");
    assert.equal(omenLevel(c, 2, { enabled: true, quiet: true }), 0, "standing still");
  }
});

test("cues are 0..1, deterministic per seed, and nothing when there is no feeling", () => {
  for (const seed of [0, 1, 7, 123456, 0xdeadbeef]) {
    for (let i = 0; i <= 20; i++) {
      const level = i / 20;
      const cue = omenCues(level, seed);
      for (const k of ["rustle", "shadow", "pulse"]) {
        assert.ok(Number.isFinite(cue[k]) && cue[k] >= 0 && cue[k] <= 1,
          `${k} at level ${level}, seed ${seed}: ${cue[k]}`);
      }
      assert.deepEqual(omenCues(level, seed), cue, "the same seed draws the same cue");
    }
  }
  assert.deepEqual(omenCues(0, 9), { rustle: 0, shadow: 0, pulse: 0 });
  assert.notDeepEqual(omenCues(1, 1), omenCues(1, 2), "the seed does move the cue");
});

test("a frozen { _encCounter, _encLevel } fixture comes out of the module unchanged", () => {
  const fixture = Object.freeze({ _encCounter: 30, _encLevel: 3 });
  const before = JSON.stringify(fixture);
  const runs = runsLeft(fixture._encCounter, fixture._encLevel);
  const level = omenLevel(fixture._encCounter, fixture._encLevel, { enabled: true, quiet: false });
  const cue = omenCues(level, runs);
  assert.equal(runs, Math.ceil(30 / 6), "level 3 subtracts 6 a run");
  assert.ok(level > 0 && level <= 1);
  assert.deepEqual(cue, omenCues(level, runs));
  assert.deepEqual(fixture, { _encCounter: 30, _encLevel: 3 }, "the counter is only read");
  assert.equal(JSON.stringify(fixture), before);
});

test("omen.js is pure: no DOM, no imports, never writes", () => {
  assert.ok(!/^\s*import\s/m.test(omenSrc), "no imports");
  assert.ok(!/document\.|window\.|localStorage|requestAnimationFrame/.test(omenSrc), "no browser");
  assert.ok(!/\._encCounter\s*=/.test(omenSrc), "never writes the counter");
});

test("game.js writes state._encCounter only in the driver's own two lines", () => {
  const writes = [...game.matchAll(/^[ \t]*state\._encCounter[ \t]*=[ \t]*(.*)$/gm)].map((m) => m[1]);
  assert.equal(writes.length, 2, `two driver writes, found: ${writes.join(" | ")}`);
  assert.equal(writes[0].trim(), "r.counter;");
  assert.match(writes[1], /^resetEncounterCounter\(/);
});

test("the level mirror sits in the driver block and is initialised to 0", () => {
  assert.match(game, /_encLevel: 0,/, "state starts at level 0");
  assert.match(game, /state\._encLevel = level;/, "the driver's own level is mirrored");
});

test("the cue is computed only inside the F2 gate and put on window.__omen", () => {
  assert.match(game, /omenLevel[^;]*from "\.\/omen\.js"/s, "the module is imported");
  const block = game.match(/if \(window\.__fx\?\.omen === true\) \{([\s\S]*?)\n    \}/);
  assert.ok(block, "the omen block is behind the switch");
  assert.match(block[1], /window\.__omen = \{/, "the cue goes on window.__omen");
  assert.match(block[1], /omenLevel\(state\._encCounter, state\._encLevel/,
    "the counter is read, not written");
  assert.match(block[1], /omenCues\(level, seed\)/);
  assert.match(block[1], /!(\(?state\.moving \|\| state\.submarimon\)?)/,
    "standing still is quiet");
  assert.ok(!/state\._encCounter\s*=/.test(block[1]), "the omen never writes the counter");
  assert.equal((game.match(/omenLevel\(/g) || []).length, 1, "one call site only");
  assert.equal((game.match(/omenCues\(/g) || []).length, 1, "one call site only");
});

test("ambience.js offers the switch in Extras, keeps it OFF by default, and draws the cue", () => {
  assert.match(ambience, /\["omen", "A feeling before a fight \(new\)"\]/, "the Extras row");
  assert.match(ambience, /const EXPERIMENTAL = \[[^\]]*"omen"/, "omen is EXPERIMENTAL");
  assert.match(ambience, /fx\.omen === true/, "the draw is gated on the switch");
  assert.match(ambience, /window\.__omen/, "the cue reaches the draw layer");
  assert.match(ambience, /wantOmen/, "the layer keeps drawing while the cue fades");
});
