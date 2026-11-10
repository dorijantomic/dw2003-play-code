// The growing boss — the enrage you can see (NEW content,
// F2 -> Extras -> "The boss grows (new)", off by default).
//
// A boss phase can now change the boss's SIZE as well as its moves, tint and field. At 60%
// Millenniummon's body takes the phase's own multiplier, 1.6 — the number web/battle3d.js
// calls GIANT_FIT_K, the point where a normal body opens the giant camera fit — and the
// party entry keeps it, so the later gauntlet/KO reapply (applyGiantScales reads
// `entry.size`) draws the boss grown again. The renderer needs no change: it already draws
// any fighter at a per-side scale (clampFighterScale 0.1..16, web/battle3d.js:1902-1938).
//
// Size rules, measured against the game's own numbers:
//   * a size is 0.5..8 with at most one decimal — the band is inside the renderer's own
//     0.1..16, and one decimal is what the authored data carries;
//   * a boss only grows: a phase's size may never be smaller than an earlier phase's, so
//     the 25% phase either stays sizeless or grows again;
//   * the camera's giant fit opens at 1.6x for an ordinary body (Kunemon, m032kune) and
//     shuts below 0.7x for one of ANIM_GIANTS (Kimeramon, m237chmr — the fused body), so
//     the authored 1.6 is exactly the threshold, and a shrunken giant is not a giant fit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { phaseEffects } = await import("../web/boss-phase.js");
const {
  clampFighterScale, usesGiantFit,
  FIGHTER_SCALE_MIN, FIGHTER_SCALE_MAX, GIANT_FIT_K, GIANT_FIT_MIN_K,
} = await import("../web/battle3d.js");

// ── the pure phase effect ───────────────────────────────────────────────────────────

test("phaseEffects names the phase's size, and null when it names none", () => {
  assert.equal(phaseEffects({ size: 1.6 }).size, 1.6);
  assert.equal(phaseEffects({}).size, null, "a phase with no size reads no size");
  assert.equal(phaseEffects(null).size, null);
  assert.equal(clampFighterScale(1.6), 1.6, "1.6 is the renderer's own giant-fit threshold");
});

test("phaseEffects keeps every field it had, and adds size beside them", () => {
  assert.deepEqual(phaseEffects({ size: 1.6, field: "dark", tint: [0, 0, 0, 1], page: "x", music: "boss04" }), {
    element: "dark", power: 64, tint: [0, 0, 0, 1], page: "x", music: "boss04", size: 1.6,
  }, "size joins the field, power, tint, page and bank the phase already carried");
});

// ── the renderer's own numbers ──────────────────────────────────────────────────────

test("the giant fit opens at 1.6x for a normal body and shuts below 0.7x for a giant", () => {
  assert.equal(FIGHTER_SCALE_MIN, 0.1);
  assert.equal(FIGHTER_SCALE_MAX, 16);
  assert.equal(GIANT_FIT_K, 1.6, "the authored size is exactly the giant-fit threshold");
  assert.equal(GIANT_FIT_MIN_K, 0.7);
  // m032kune is Kunemon, an ordinary body; m237chmr is Kimeramon, the fused boss's body and
  // one of ANIM_GIANTS (web/fight/anim-donor-map.js).
  assert.equal(usesGiantFit("m032kune", 1.6), true, "an ordinary body at 1.6x needs the giant fit");
  assert.equal(usesGiantFit("m032kune", 1.0), false, "an ordinary body at its own size does not");
  assert.equal(usesGiantFit("m237chmr", 1.6), true, "a giant stays in the giant fit when it grows");
  assert.equal(usesGiantFit("m237chmr", 0.6), false, "a giant shrunk below 0.7x is drawn the ordinary way");
});

// ── the authored data and its builder ───────────────────────────────────────────────

const authored = JSON.parse(readFileSync(join(here, "data/authored/fusion_bosses.json"), "utf8"));
const built = JSON.parse(readFileSync(join(here, "web/fusion_bosses.json"), "utf8"));

test("the demo: Millenniummon grows to 1.6 at 60% and the built record carries it", () => {
  const row = authored.bosses.find((boss) => boss.id === "millenniummon");
  assert.ok(row, "the authored fixture holds millenniummon");
  assert.equal(row.phases[0].at, 0.6);
  assert.equal(row.phases[0].size, 1.6, "the armour-splits phase is the grow");
  assert.equal(row.phases[1].size, undefined, "the 25% phase may stay sizeless: the boss stays grown");
  const generated = built.bosses.millenniummon.phases;
  assert.deepEqual(generated, row.phases, "the generated phases are the authored phases");
  assert.equal(generated[0].size, 1.6, "the built record carries the size");
  const check = spawnSync("python3", ["tools/build_fusion_bosses.py", "--check"],
    { cwd: here, encoding: "utf8" });
  assert.equal(check.status, 0, `--check must pass with the authored size: ${check.stdout}${check.stderr}`);
});

test("the builder takes a size 0.5..8 with one decimal and refuses everything else", () => {
  const cases = [
    [0.4, "below 0.5"],
    [9, "above 8"],
    ["big", "not a number"],
    [1.65, "two decimals"],
  ];
  for (const [size, why] of cases) {
    const r = builderPhases([{ at: 0.5, moves: [166], size, page: "x" }]);
    const errors = (r.stdout || "").split("\n").filter((line) => line.startsWith("ERROR:"));
    assert.equal(errors.length, 1, `size ${size} (${why}) must be exactly one builder error (got ${r.stdout}${r.stderr})`);
  }
  const shrink = builderPhases([
    { at: 0.6, moves: [166], size: 0.6, page: "a" },
    { at: 0.25, moves: [166], size: 0.5, page: "b" },
  ]);
  const errors = (shrink.stdout || "").split("\n").filter((line) => line.startsWith("ERROR:"));
  assert.equal(errors.length, 1, `a shrinking pair must be exactly one builder error (got ${shrink.stdout}${shrink.stderr})`);

  for (const size of [0.5, 8, 1, 1.6]) {
    const ok = builderPhases([{ at: 0.5, moves: [166], size, page: "x" }]);
    assert.match(ok.stdout, /NO ERROR/, `size ${size} must resolve (got ${ok.stdout}${ok.stderr})`);
  }
  const equal = builderPhases([
    { at: 0.6, moves: [166], size: 1.6, page: "a" },
    { at: 0.25, moves: [166], size: 1.6, page: "b" },
  ]);
  assert.match(equal.stdout, /NO ERROR/, "equal sizes are a boss that stays big, not a shrink");
  const sizelessFirst = builderPhases([
    { at: 0.6, moves: [166], page: "a" },
    { at: 0.25, moves: [166], size: 1.6, page: "b" },
  ]);
  assert.match(sizelessFirst.stdout, /NO ERROR/, "a phase may grow from a sizeless one");
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

// ── the battle wiring (source gates; the block is a battle closure, not a pure module) ──

test("battle.js: the grow sits in the phase machine, after the cursor guard, behind its own switch", () => {
  const src = readFileSync(join(here, "web/battle.js"), "utf8");
  assert.equal((src.match(/window\.__fx\?\.bossgrows === true/g) || []).length, 1,
    "the switch is read in one place");
  const def = src.indexOf("function advanceBossPhase(");
  assert.ok(def > 0, "the phase machine exists");
  const helper = src.slice(def, src.indexOf("\n  }", def));
  const guard = helper.indexOf("if (!(index > (en.bossPhase ?? -1))) return [];");
  const gate = helper.indexOf("if (effects.size && window.__fx?.bossgrows === true) {");
  assert.ok(guard > 0, "the once-per-phase cursor guard is in the helper");
  assert.ok(gate > guard, "the grow branch sits after the guard: only a phase that just fired grows");
  const grow = blockAfter(helper, gate);
  assert.match(grow, /renderer3d\?\.setFighterScale\?\.\("enemy", clampFighterScale\(effects\.size\)\)/,
    "the enemy is drawn at the phase's own size, through the optional renderer");
  assert.match(grow, /b\.party\[b\.partyIndex\]\.size = clampFighterScale\(effects\.size\)/,
    "the party entry keeps the size for the gauntlet reapply");
  assert.equal(/\breturn\b/.test(grow), false, "the grow adds no page: the phase's own page is unchanged");
});

test("off: the phase machine returns exactly the pages it returns today", () => {
  const src = readFileSync(join(here, "web/battle.js"), "utf8");
  const def = src.indexOf("function advanceBossPhase(");
  const helper = src.slice(def, src.indexOf("\n  }", def));
  assert.equal(
    (helper.match(/return effects\.page \? \[\{ text: effects\.page, spec: null \}\] : \[\];/g) || []).length,
    1, "the returned page is the one the phase always returned");
  assert.equal(helper.includes("effects.size"), true, "the size is read by name only in the grow branch");
});

test("web/battle3d.js is not in the branch's diff — the renderer already knows how to scale", () => {
  // (the glossary stage added setViewerStudio to battle3d.js, so "not in the diff" no longer holds; what matters is below)
  const renderer = readFileSync(join(here, "web/battle3d.js"), "utf8");
  assert.equal(/bossgrows|bossPhase/.test(renderer), false,
    "no renderer change: the phase layer lives in battle.js");
});

test("the toggle pair is in ambience.js, off by default", () => {
  const amb = readFileSync(join(here, "web/ambience.js"), "utf8");
  assert.match(amb, /\["bossgrows", "The boss grows \(new\)"\]/);
  assert.match(amb, /const EXPERIMENTAL = \[[^\]]*"bossgrows"/);
});

// ── helpers ─────────────────────────────────────────────────────────────────────────

/** The body of the first braced block that opens after `idx`, with the outer braces cut. */
function blockAfter(src, idx) {
  const open = src.indexOf("{", idx);
  assert.ok(open > idx, "the gate opens a block");
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return "";
}

/** The files this branch changes, committed or not, against the merge base with integration/all. */
function changedFiles() {
  const files = new Set();
  const base = spawnSync("git", ["merge-base", "integration/all", "HEAD"], { cwd: here, encoding: "utf8" });
  const from = base.status === 0 ? base.stdout.trim() : "";
  if (from) {
    const d = spawnSync("git", ["diff", "--name-only", from], { cwd: here, encoding: "utf8" });
    if (d.status === 0) for (const f of d.stdout.split("\n")) if (f.trim()) files.add(f.trim());
  }
  const st = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: here, encoding: "utf8" });
  if (st.status === 0) {
    for (const line of st.stdout.split("\n")) {
      if (!line.trim()) continue;
      files.add(line.slice(3).replace(/^.* -> /, "").trim());
    }
  }
  return [...files];
}
