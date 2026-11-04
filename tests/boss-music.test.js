// The music turns — a boss phase can change the battle track (NEW content,
// F2 -> Extras -> "A phase changes the battle music (new)", off by default).
//
// A phase may name one of the game's own battle banks. At its HP line the battle writes
// `_battleTrack` and plays it — the same two lines the Galacticmon finale runs on its
// third landed blow (`noteFinalBossPhaseDamage`, fightstg .L0x80086ea0: 0x60980000 =
// archive 38 = boss04, the only battle-side boss-track play in the game). No new asset,
// no new page, no timing change.
//
// The legal bank set is COMPUTED from web/assets/data/battle_music.json (every `bank`
// in every record) and never hardcoded, so the builder refuses a name the game's own
// table does not carry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { phaseEffects } = await import("../web/boss-phase.js");

// ── the game's own bank table ───────────────────────────────────────────────────────

const music = JSON.parse(readFileSync(join(here, "web/assets/data/battle_music.json"), "utf8"));

test("the game's own battle banks: seven names over 310 records", () => {
  const census = {};
  let records = 0;
  for (const list of Object.values(music)) {
    for (const row of list) {
      census[row.bank] = (census[row.bank] ?? 0) + 1;
      records += 1;
    }
  }
  assert.equal(Object.keys(music).length, 128, "128 screen keys");
  assert.equal(records, 310, "310 trigger records");
  assert.deepEqual(Object.keys(census).sort(),
    ["batl00", "batl10", "boss00", "boss01", "boss02", "boss03", "boss04"],
    "exactly the seven banks the disc's own table names");
  assert.deepEqual(census,
    { batl00: 187, batl10: 38, boss00: 49, boss01: 32, boss02: 1, boss03: 1, boss04: 2 },
    "the census the legal set is computed from");
});

// ── the pure phase effect ───────────────────────────────────────────────────────────

test("phaseEffects names the phase's bank, and null when it names none", () => {
  assert.equal(phaseEffects({ music: "boss04" }).music, "boss04");
  assert.equal(phaseEffects({ field: "dark", page: "x" }).music, null,
    "a phase with no music reads no bank");
  assert.equal(phaseEffects({}).music, null);
  assert.equal(phaseEffects(null).music, null);
});

// ── the authored demo and its generated record ─────────────────────────────────────

const authored = JSON.parse(readFileSync(join(here, "data/authored/fusion_bosses.json"), "utf8"));
const built = JSON.parse(readFileSync(join(here, "web/fusion_bosses.json"), "utf8"));

test("the demo: Millenniummon's 25% phase names boss04, the 60% phase does not", () => {
  const row = authored.bosses.find((boss) => boss.id === "millenniummon");
  assert.ok(row, "the authored fixture holds millenniummon");
  assert.equal(row.phases[1].at, 0.25);
  assert.equal(row.phases[1].music, "boss04",
    "the phase where the armour splits to the dark field is the harder track");
  assert.equal(row.phases[0].music, undefined, "the first phase keeps the screen's own bank");
  const generated = built.bosses.millenniummon.phases;
  assert.deepEqual(generated, row.phases, "the built phases are the authored phases");
  assert.equal(generated[1].music, "boss04");
});

// ── the builder's computed legal set ───────────────────────────────────────────────

test("the builder refuses a bank the game's own table lacks, and --check passes", () => {
  for (const bank of ["boss09", "batl20"]) {
    const r = builderPhases([{ at: 0.5, moves: [166], music: bank, page: "x" }]);
    const errors = (r.stdout || "").split("\n").filter((line) => line.startsWith("ERROR:"));
    assert.equal(errors.length, 1,
      `music ${bank} must be exactly one builder error (got ${r.stdout}${r.stderr})`);
  }
  const real = builderPhases([{ at: 0.5, moves: [166], music: "boss04", page: "x" }]);
  assert.match(real.stdout, /NO ERROR/, `a real bank resolves (got ${real.stdout}${real.stderr})`);
  const check = spawnSync("python3", ["tools/build_fusion_bosses.py", "--check"],
    { cwd: here, encoding: "utf8" });
  assert.equal(check.status, 0, `--check must pass with the demo: ${check.stdout}${check.stderr}`);
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

test("battle.js: the bank write lives in the phase machine, behind its own switch", () => {
  const src = readFileSync(join(here, "web/battle.js"), "utf8");
  assert.equal((src.match(/b\._battleTrack = effects\.music/g) || []).length, 1,
    "one write of the phase's bank");
  assert.equal((src.match(/window\.__fx\?\.bossmusic === true/g) || []).length, 1,
    "the switch is read in one place");
  const def = src.indexOf("function advanceBossPhase(");
  assert.ok(def > 0, "the phase machine exists");
  const helper = src.slice(def, src.indexOf("\n  }", def));
  // The phase cursor guard comes first: a fired phase never fires twice, so the bank
  // changes once at its HP line.
  const guard = helper.indexOf("if (!(index > (en.bossPhase ?? -1))) return [];");
  const gate = helper.indexOf("if (effects.music && window.__fx?.bossmusic === true) {");
  const write = helper.indexOf("b._battleTrack = effects.music;");
  const play = helper.indexOf("bgm?.play(b._battleTrack);");
  assert.ok(guard > 0, "the once-per-phase guard is in the helper");
  assert.ok(gate > guard, "the bank branch sits after the guard");
  assert.ok(write > gate && play > write, "the write and its play sit inside the switch");
});

test("battle.js: the finale's own boss04 handover is untouched", () => {
  const src = readFileSync(join(here, "web/battle.js"), "utf8");
  const def = src.indexOf("function noteFinalBossPhaseDamage(");
  assert.ok(def > 0, "the finale's phase function exists");
  const fn = src.slice(def, src.indexOf("\n  }", def));
  const write = fn.indexOf('b._battleTrack = "boss04";');
  const play = fn.indexOf("bgm?.play(b._battleTrack);");
  assert.ok(write > 0, "the finale still writes boss04");
  assert.ok(play > write, "and still plays it right after");
  assert.equal(fn.includes("effects.music"), false,
    "the authored phase path never rewrites the finale's own handover");
  assert.equal((src.match(/b\._battleTrack = "boss04"/g) || []).length, 1,
    "exactly one boss04 write in the whole battle");
});

test("the toggle pair is in ambience.js, off by default", () => {
  const amb = readFileSync(join(here, "web/ambience.js"), "utf8");
  assert.match(amb, /\["bossmusic", "A phase changes the battle music \(new\)"\]/);
  assert.match(amb, /const EXPERIMENTAL = \[[^\]]*"bossmusic"/);
});
