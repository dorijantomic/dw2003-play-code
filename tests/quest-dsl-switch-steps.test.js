// The authoring helpers for the two newest quest steps (data/authored/quests/dsl.py): `bubble` (the story's own reaction
// bubble, web/quest-scenes.js `bubble` -> SETANIM 803 <805|807|806> <who>) and `placecard` (the field's own blue location
// card typed with two names the quest writes). A pack had to hand-roll both dicts and nothing checked their rules; these
// helpers write the step in the same voice as anim() and refuse a bad value through dsl.problem(), so
// tools/build_quests.py fails loudly with a named problem instead of shipping a step the game drops.
//
// Authoring only: no runtime file changes, and no F2 switch of its own (the steps' own Extras switches still gate them at
// compile time -- a scene that names a step is not a scene that plays it).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compileScene } from "../web/quest-scenes.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const PRELUDE = "import json,sys; sys.path.insert(0,'data/authored/quests'); import dsl; ";
const python = (code) => spawnSync("python3", ["-c", PRELUDE + code], { cwd: root, encoding: "utf8" });
const dsl = (code) => {
  const py = python(code);
  assert.equal(py.status, 0, py.stderr);
  return JSON.parse(py.stdout);
};

let cachedSteps;
const steps = () => (cachedSteps ??= dsl(
  "print(json.dumps([dsl.bubble(48), dsl.bubble(48,'puffs',120), dsl.placecard('Central Sector','Central Park')]))",
));

test("bubble writes the story's own step: exclaim by default, puffs with a hold, close with no wait", () => {
  const [bubble48, bubblePuffs, bubbleClose] = dsl(
    "print(json.dumps([dsl.bubble(48), dsl.bubble(48,'puffs',120), dsl.bubble(48,'close')]))",
  );
  assert.deepEqual(bubble48, { bubble: "exclaim", who: 48 }, "exclaim is the default, and a default hold is not written");
  assert.deepEqual(bubblePuffs, { bubble: "puffs", who: 48, hold: 120 }, "a named hold rides along");
  assert.deepEqual(bubbleClose, { bubble: "close", who: 48 }, "close just shuts the bubble");
});

test("placecard writes the two names the field's own card prints, as one step", () => {
  assert.deepEqual(
    dsl("print(json.dumps(dsl.placecard('Central Sector','Central Park')))"),
    { placecard: { area: "Central Sector", place: "Central Park" } },
  );
});

test("a good value never complains", () => {
  assert.deepEqual(dsl("print(json.dumps({'steps': [dsl.bubble(48), dsl.placecard('Central Sector','Central Park')], 'problems': dsl.PROBLEMS}))").problems, []);
});

test("each bad value adds exactly one named problem and does not raise", () => {
  // One python process, so the count really is dsl.PROBLEMS before and after each call, and a raise would be caught
  // (not crash the snippet) and reported as a failed assertion instead of a broken test.
  const rowsCode = `
rows = []
def run(label, fn):
    before = len(dsl.PROBLEMS)
    raised = None
    try:
        fn()
    except Exception as exc:
        raised = type(exc).__name__ + ': ' + str(exc)
    rows.append({'label': label, 'before': before, 'after': len(dsl.PROBLEMS), 'raised': raised,
                 'problems': dsl.PROBLEMS[before:]})
run('bubble kind', lambda: dsl.bubble(48, 'wink'))
run('bubble hold 0', lambda: dsl.bubble(48, 'exclaim', 0))
run('bubble hold 601', lambda: dsl.bubble(48, 'exclaim', 601))
run('bubble player', lambda: dsl.bubble('player'))
run('placecard 21 characters', lambda: dsl.placecard('__LONG__', 'Central Park'))
run('placecard tab', lambda: dsl.placecard('Central' + chr(9) + 'Sector', 'Central Park'))
run('placecard number', lambda: dsl.placecard(5, 'Central Park'))
run('placecard newline area', lambda: dsl.placecard('Central' + chr(10), 'Central Park'))
run('placecard newline place', lambda: dsl.placecard('Central Sector', 'Central Park' + chr(10)))
print(json.dumps(rows))
`.trim().replace("__LONG__", "x".repeat(21));
  const rows = dsl(rowsCode);
  const needles = ["wink", "hold 0", "601", "player", "x".repeat(21), "\\t", "placecard area 5", "Central\\n", "Central Park\\n"];
  assert.equal(rows.length, needles.length, "every bad case ran");
  rows.forEach((row, i) => {
    console.log(`${row.label}: dsl.PROBLEMS ${row.before} -> ${row.after}`);
    assert.equal(row.raised, null, `${row.label} must not raise (caller's build must reach the problem report)`);
    assert.equal(row.after - row.before, 1, `${row.label} adds exactly one problem`);
    assert.equal(row.problems.length, 1);
    assert.ok(row.problems[0].includes(needles[i]), `${JSON.stringify(row.problems[0])} names ${needles[i]}`);
  });
  assert.deepEqual(rows.map((r) => r.before), [0, 1, 2, 3, 4, 5, 6, 7, 8], "the problems are reported one per bad value");
});

test("the dicts the helpers write are exactly what the scene compiler takes", () => {
  const [bubble48, , placecard] = steps();
  const b = compileScene([bubble48], { fx: { questemotes: true } });
  assert.deepEqual(b.errors, []);
  assert.ok(b.opcodes.includes("SETANIM 803 805 48"), `the story's own bubble opcode, got ${JSON.stringify(b.opcodes)}`);
  const pc = compileScene([placecard], { fx: { questplacecard: true } });
  assert.deepEqual(pc.errors, []);
  assert.equal(pc.opcodes.filter((op) => op.startsWith("SCENEEVENT")).length, 1, `one host event, got ${JSON.stringify(pc.opcodes)}`);
  assert.deepEqual(pc.events, [{ kind: "placecard", area: "Central Sector", place: "Central Park" }]);
});

test("a trailing newline is refused, exactly the name the game's own compiler refuses", () => {
  // Python's `$` also matches just before a trailing newline; the compiler's JS `/^[\x20-\x7e]+$/` does not. A pack
  // must not sail past the helper and then have its scene step refused at runtime, so both sides agree on this name.
  const [areaNewline, placeNewline] = dsl(
    "print(json.dumps([dsl.placecard('Central'+chr(10),'Central Park'), dsl.placecard('Central Sector','Central Park'+chr(10))]))",
  );
  for (const step of [areaNewline, placeNewline]) {
    const compiled = compileScene([step], { fx: { questplacecard: true } });
    assert.equal(compiled.errors.length, 1, `the compiler refuses ${JSON.stringify(step)}: ${JSON.stringify(compiled.errors)}`);
  }
  const problems = dsl(
    "dsl.placecard('Central'+chr(10),'Central Park'); dsl.placecard('Central Sector','Central Park'+chr(10)); print(json.dumps(dsl.PROBLEMS))",
  );
  assert.equal(problems.length, 2, "the helper names both bad names, so the build fails before the game drops the step");
  assert.ok(problems[0].includes("Central\\n"), problems[0]);
  assert.ok(problems[1].includes("Central Park\\n"), problems[1]);
});

test("20 characters is the longest name the card takes, and it still compiles", () => {
  const [step, accepted, after21] = dsl(
    "print(json.dumps([dsl.placecard('x'*20, 'y'*20), len(dsl.PROBLEMS), (dsl.placecard('x'*21, 'y'), len(dsl.PROBLEMS))[1]]))",
  );
  assert.equal(accepted, 0, "a name of exactly 20 characters is taken");
  assert.equal(after21, 1, "21 characters is one too many");
  const compiled = compileScene([step], { fx: { questplacecard: true } });
  assert.deepEqual(compiled.errors, []);
});

test("the helpers are in dsl.py, and the older helpers are only added to, never moved", () => {
  const src = readFileSync(new URL("../data/authored/quests/dsl.py", import.meta.url), "utf8");
  assert.match(src, /^def bubble\(/m);
  assert.match(src, /^def placecard\(/m);
  for (const name of ["anim", "quest", "scene"]) {
    assert.match(src, new RegExp(`^def ${name}\\(`, "m"), `def ${name}( is still there`);
  }
  assert.ok(src.indexOf("def bubble(") > src.indexOf("def anim("), "bubble is appended after anim, next to the other steps");
  assert.ok(src.indexOf("def placecard(") > src.indexOf("def bubble("), "placecard follows it");
});
