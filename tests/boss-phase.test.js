// Boss phases — the second wind (NEW content, F2 -> Extras -> "Boss phases", off by default).
//
// An authored fusion boss can breathe twice: at thresholds of its own HP it swaps its four
// AI rows for the phase's own moves, sets the battlefield element once, takes a phase tint
// and puts up one authored page. The original's own multi-phase machine is the Galacticmon
// finale (`engine/dw3/battle-finale.ts`, kind 4 -> 5 -> 6); this is the data-driven
// generalisation for authored bosses, driven by data/authored/fusion_bosses.json.
//
// The walker's enemy rows are the disc's own record shape: rows 0..2 are condition-tested
// and row 3 is the unconditional fallback (`pickEnemyAiMove`, fightstg.s:6038-6061).
// Comparator 1 is the random gate `rand()%128 < value` (enemy-ai-move-conditions.md), and
// action 1/2/3 are attack/move_1/move_2 — never 4 (flee) or 5..8 (slot switch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { phaseFor, phaseRows, phaseEffects } = await import("../web/boss-phase.js");

// The authored boss's own numbers: HP 2424 (web/fusion_bosses.json), moves [325, 166, 9001].
const PHASES = [
  { at: 0.6, moves: [166], page: "first" },
  { at: 0.25, moves: [325, 166], field: "dark", tint: [0.35, 0.1, 0.5, 1], page: "second" },
];
const BOSS_MOVES = [325, 166, 9001];

test("phaseFor: the last threshold the boss has fallen to, else -1", () => {
  // floor(2424 * 0.6) = 1454 and floor(2424 * 0.25) = 606 are the two lines.
  assert.equal(phaseFor(2424, 2424, PHASES), -1, "full HP is before the first phase");
  assert.equal(phaseFor(2424, 1455, PHASES), -1, "one HP above the 60% line");
  assert.equal(phaseFor(2424, 1454, PHASES), 0, "the 60% line itself fires the first phase");
  assert.equal(phaseFor(2424, 607, PHASES), 0);
  assert.equal(phaseFor(2424, 606, PHASES), 1, "the 25% line fires the last phase");
  assert.equal(phaseFor(2424, 0, PHASES), 1, "0 HP has passed every threshold");
  assert.equal(phaseFor(0, 0, PHASES), -1, "a record with no max HP has no phases");
  assert.equal(phaseFor(-5, 0, PHASES), -1);
  assert.equal(phaseFor(2424, -1, PHASES), -1, "a missing HP is not a phase");
  assert.equal(phaseFor(2424, 100, []), -1);
  assert.equal(phaseFor(2424, 100, null), -1);
});

test("phaseRows: three random-gated rows and the disc's unconditional fourth row", () => {
  const rows = phaseRows({ moves: [166] }, BOSS_MOVES);
  assert.equal(rows.length, 4);
  for (const row of rows) assert.equal(row.action, 2, "166 is move_1, action 2");
  for (const row of rows.slice(0, 3)) {
    assert.equal(row.comparator, 1, "rows 0..2 are condition-tested");
    assert.equal(row.value, 64, "rand()%128 < 64 is the disc's half-the-rolls gate");
  }
  assert.equal(rows[3].comparator, 0, "row 3 is never condition-tested");
});

test("phaseRows cycles a two-move phase and refuses an unknown id", () => {
  const rows = phaseRows({ moves: [166, 325] }, BOSS_MOVES);
  assert.deepEqual(rows.map((row) => row.action), [2, 1, 2, 1],
    "rows 0..2 carry the phase's moves in order (wrapping), row 3 repeats the last");
  for (const row of rows) {
    assert.ok(row.action >= 1 && row.action <= 3, "never flee (4) or a slot switch (5..8)");
  }
  assert.deepEqual(phaseRows({ moves: [9999] }, BOSS_MOVES), [], "an unknown move refuses the phase");
  assert.deepEqual(phaseRows({ moves: [166, 9999] }, BOSS_MOVES), []);
  assert.deepEqual(phaseRows({ moves: [] }, BOSS_MOVES), []);
  assert.deepEqual(phaseRows(null, BOSS_MOVES), []);
});

test("phaseEffects names the field, its power, the tint and the page", () => {
  assert.deepEqual(phaseEffects({ field: "dark", tint: [0, 0, 0, 1], page: "x" }),
    { element: "dark", power: 64, tint: [0, 0, 0, 1], page: "x" },
    "a field phase writes the same element + power 64 the field items write");
  assert.deepEqual(phaseEffects({ moves: [166], page: "y" }),
    { element: null, power: 64, tint: null, page: "y" }, "no field means no field write");
  assert.deepEqual(phaseEffects(null),
    { element: null, power: 64, tint: null, page: null });
});

// ── the authored data and its builder ────────────────────────────────────────────────

const authored = JSON.parse(readFileSync(join(here, "data/authored/fusion_bosses.json"), "utf8"));
const built = JSON.parse(readFileSync(join(here, "web/fusion_bosses.json"), "utf8"));

test("the authored millenniummon carries two phases: 60% then 25%", () => {
  const row = authored.bosses.find((boss) => boss.id === "millenniummon");
  assert.ok(row, "the authored fixture holds millenniummon");
  assert.equal(row.phases.length, 2, "exactly two phases");
  assert.equal(row.phases[0].at, 0.6);
  assert.deepEqual(row.phases[0].moves, [166]);
  assert.equal(row.phases[1].at, 0.25);
  assert.deepEqual(row.phases[1].moves, [325, 166]);
  assert.equal(row.phases[1].field, "dark");
  assert.deepEqual(row.phases[1].tint, [0.35, 0.1, 0.5, 1]);
  for (const phase of row.phases) {
    assert.equal(typeof phase.page, "string");
    assert.ok(phase.page.trim().length > 0, "every phase puts up a line");
  }
  const generated = built.bosses.millenniummon.phases;
  assert.ok(Array.isArray(generated), "the built file carries the phases");
  assert.deepEqual(generated, row.phases, "generated phases are the authored phases");
});

test("the builder validates every phase and --check passes", () => {
  const four = [
    { at: 0.9, moves: [166], page: "a" },
    { at: 0.7, moves: [166], page: "b" },
    { at: 0.5, moves: [166], page: "c" },
    { at: 0.3, moves: [166], page: "d" },
  ];
  const cases = [
    [[{ at: 0.5, moves: [9999], page: "x" }], "a move that is not the boss's own"],
    [[{ at: 0.96, moves: [166], page: "x" }], "at above 0.95"],
    [[{ at: 0.04, moves: [166], page: "x" }], "at below 0.05"],
    [[{ at: 0.25, moves: [166], page: "x" }, { at: 0.6, moves: [166], page: "y" }],
      "phases out of order"],
    [four, "four phases"],
    [[{ at: 0.5, moves: [166], field: "holy", page: "x" }], "field holy"],
  ];
  for (const [phases, why] of cases) {
    const r = builderPhases(phases);
    const errors = (r.stdout || "").split("\n").filter((line) => line.startsWith("ERROR:"));
    assert.equal(errors.length, 1, `${why} must be exactly one builder error (got ${r.stdout}${r.stderr})`);
  }
  const ok = spawnSync("python3", ["tools/build_fusion_bosses.py", "--check"],
    { cwd: here, encoding: "utf8" });
  assert.equal(ok.status, 0, `--check must pass: ${ok.stdout}${ok.stderr}`);
});

function builderPhases(phases) {
  const code = [
    "import json, sys",
    "sys.path.insert(0, 'tools')",
    "import build_fusion_bosses as b",
    "try:",
    "    b.resolve_phases('fixture', json.loads(sys.argv[1]), [325, 166, 9001])",
    "except b.BuildError as e:",
    "    print('ERROR: %s' % e)",
    "    raise SystemExit(0)",
    "print('NO ERROR')",
    "raise SystemExit(1)",
  ].join("\n");
  return spawnSync("python3", ["-c", code, JSON.stringify(phases)],
    { cwd: here, encoding: "utf8" });
}

// ── the battle wiring (source gates; the block is a battle closure, not a pure module) ─

test("battle.js: the phase block sits in queueAfterAction behind the toggle", () => {
  const src = readFileSync(join(here, "web/battle.js"), "utf8");
  assert.equal((src.match(/function advanceBossPhase\(/g) || []).length, 1,
    "one definition");
  assert.equal((src.match(/(?<!function )advanceBossPhase\(b\)/g) || []).length, 1,
    "one call site");
  assert.equal((src.match(/window\.__fx\?\.bossphases === true/g) || []).length, 1,
    "the switch is read in one place");
  const start = src.indexOf("function queueAfterAction(b, acted)");
  assert.ok(start > 0, "queueAfterAction exists");
  const pagesAt = src.indexOf("b._timelinePages = pages;", start);
  assert.ok(pagesAt > start, "the block sits before the timeline pages are published");
  const block = src.slice(start, pagesAt);
  assert.match(block, /acted === "player"/, "only the player's action advances a phase");
  assert.match(block, /window\.__fx\?\.bossphases === true/, "the block is behind the toggle");
  assert.match(block, /b\.enemy\?\.bossId/, "only an authored fusion boss has phases");
  assert.match(block, /advanceBossPhase\(b\)/, "the block calls the phase machine");
  const def = src.indexOf("function advanceBossPhase(");
  assert.ok(def > pagesAt, "the helper is defined beside, not inside, the block");
  const helper = src.slice(def, src.indexOf("\n  }", def));
  assert.match(helper, /eStats\.ai_moves = phaseRows\(/, "the phase swaps the AI rows");
  assert.match(helper, /setFighterTint\("enemy", [^)]*\.tint\)/, "the phase sets the enemy tint");
  assert.match(helper, /b\.field = \{ element: [^}]*, power: [^}]*\}/, "the phase writes the field");
});

test("battle.js: only the fuseIntoBoss arm stamps a boss id and phase cursor", () => {
  const src = readFileSync(join(here, "web/battle.js"), "utf8");
  assert.equal((src.match(/en\.bossId = boss\.id/g) || []).length, 1);
  assert.equal((src.match(/en\.bossPhase = -1/g) || []).length, 1);
});

test("the toggle pair is in ambience.js and battle3d.js is untouched by the feature", () => {
  const amb = readFileSync(join(here, "web/ambience.js"), "utf8");
  assert.match(amb, /\["bossphases", "Boss phases \(new\)"\]/);
  assert.match(amb, /const EXPERIMENTAL = \[[^\]]*"bossphases"/);
  const renderer = readFileSync(join(here, "web/battle3d.js"), "utf8");
  assert.equal(/bossPhase|bossphases/.test(renderer), false,
    "no renderer change: the phase layer lives in battle.js");
});
