// Say It Back (web/quest-readback.js + tools/scene_readback.mjs): a quest scene read back as plain English,
// a diff between two readings, and a tool that prints it. No DOM, no fs in the module.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBack, diffReadback, KINDS } from "../web/quest-readback.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOOL = fileURLToPath(new URL("../tools/scene_readback.mjs", import.meta.url));
const readJSON = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

const quests = readJSON("../web/quests.json").quests;
const chars = readJSON("../data/authored/quests/characters.json");
const names = Object.fromEntries(Object.entries(chars.by_npc_id).map(([id, rec]) => [id, rec.name]));
const sheets = {};
for (const f of readdirSync(new URL("../web/extra_fx/", import.meta.url))) {
  if (f.endsWith(".json")) sheets[f.slice(0, -5)] = readJSON(`../web/extra_fx/${f}`);
}
const mapNames = Object.fromEntries(Object.values(readJSON("../web/assets/manifest.json").maps).map((m) => [m.id, m.name]));

const scenesOf = (q) => [q.offer?.scene, q.acceptScene, q.doneScene, q.turnIn?.scene, ...q.objectives.map((o) => o.scene)].filter(Boolean);
const STEP_KINDS = KINDS;
const kindOf = (s) => STEP_KINDS.find((k) => k in s) ?? Object.keys(s)[0];

const fixture = () => [
  { put: 1005, at: [896, 296] },
  { walk: 1005, to: { near: "player", gap: 34 } },
  { say: 1005, name: "Cipher", text: "The bridge looks better at this hour. Do you not think so?" },
  { ask: "Take the job?", options: ["I will do it", "Not now"] },
  { fade: "out", frames: 30 },
];
const fixtureOpts = () => ({ mapId: "s205", mapName: mapNames.s205, names, sheets, playerLabel: "you" });

test("every step kind the shipped quests use reads with no problem, and every known kind is the compiler's", () => {
  let scenes = 0;
  const met = new Set();
  for (const q of quests) {
    for (const scene of scenesOf(q)) {
      scenes++;
      const r = readBack(scene, fixtureOpts());
      assert.deepEqual(r.problems, [], `scene of ${q.id} reads clean`);
      for (const s of scene) met.add(kindOf(s));
    }
  }
  assert.ok(scenes >= 400, `expected the full scene registry, found ${scenes}`);
  for (const kind of met) assert.ok(KINDS.includes(kind), `the reader knows the step kind ${kind}`);
  const source = readFileSync(new URL("../web/quest-scenes.js", import.meta.url), "utf8");
  for (const kind of KINDS) assert.match(source, new RegExp(`\\b${kind}\\b`), `KINDS names no invented step: ${kind}`);
});

test("the five-step fixture reads back word for word", () => {
  const r = readBack(fixture(), fixtureOpts());
  assert.equal(r.title, "## Central Sector — Asuka Bridge");
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.blocks.map((b) => [b.step, b.kind]), [[1, "put"], [2, "walk"], [3, "say"], [4, "ask"], [5, "fade"]]);
  assert.deepEqual(r.blocks.map((b) => b.text), [
    "Cipher is placed at (896, 296).",
    "Cipher walks to 34 px in front of you.",
    "CIPHER: The bridge looks\nbetter at this hour.\nDo you not think so?",
    "The game asks: Take the job? (options: I will do it / Not now)",
    "The screen fades out over 30 frames.",
  ]);
  const said = r.blocks[2].text.replace(/^CIPHER: /, "").split("\n").map((s) => s.trim()).filter(Boolean).join(" ");
  assert.equal(said, fixture()[2].text, "the say text is inside the block after joining the wrapped lines");
});

test("the diff is exact: nothing for the same scene, one removed and one added for one changed line", () => {
  const a = readBack(fixture(), fixtureOpts());
  const same = diffReadback(a, a);
  assert.equal(same.added, 0);
  assert.equal(same.removed, 0);
  assert.equal(same.same, 5);

  const steps = fixture();
  steps[2] = { ...steps[2], text: "The bridge looks better at dusk. Do you not think so?" };
  const b = readBack(steps, fixtureOpts());
  const d = diffReadback(a, b);
  assert.equal(d.added, 1);
  assert.equal(d.removed, 1);
  assert.equal(d.same, 4);
  assert.deepEqual(d.lines.filter((l) => l.type === "same").map((l) => l.text),
    [a.blocks[0].text, a.blocks[1].text, a.blocks[3].text, a.blocks[4].text]);
  assert.equal(d.lines.filter((l) => l.type === "removed").length, 1);
  assert.equal(d.lines.filter((l) => l.type === "added").length, 1);
});

test("an unknown step is one problem naming the key and the step, and the rest still reads", () => {
  const r = readBack([{ put: 1005, at: [896, 296] }, { teleport: 1 }, { say: 1005, name: "Cipher", text: "Still here." }], fixtureOpts());
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /teleport/);
  assert.match(r.problems[0], /step 2/);
  assert.equal(r.blocks.length, 3);
  assert.equal(r.blocks[1].kind, "unknown");
  assert.equal(r.blocks[0].text, "Cipher is placed at (896, 296).");
  assert.equal(r.blocks[2].text, "CIPHER: Still here.");
});

test("a registered scene is named, never expanded; a warp with then names the follow-up", () => {
  const one = readBack([{ scene: "demo" }], fixtureOpts());
  assert.equal(one.blocks.length, 1, "one block, not the registry's steps");
  assert.equal(one.blocks[0].kind, "scene");
  assert.match(one.blocks[0].text, /registered scene 'demo'/);
  assert.match(one.blocks[0].text, /not expanded/);
  assert.deepEqual(one.problems, []);

  const two = readBack([{ warp: { map: "s320", at: [576, 448] }, then: "after_door" }], fixtureOpts());
  assert.equal(two.blocks.length, 1, "the follow-up is named, not inlined");
  assert.match(two.blocks[0].text, /s320/);
  assert.match(two.blocks[0].text, /\(576, 448\)/);
  assert.match(two.blocks[0].text, /registered scene 'after_door'/);
});

test("a missing sheet still reads, in a line that says it is not in web/extra_fx", () => {
  const r = readBack([{ fx: "crat", sheet: "crat", at: [10, 20] }, { say: 1005, name: "Cipher", text: "Still here." }], fixtureOpts());
  assert.deepEqual(r.problems, []);
  assert.equal(r.blocks.length, 2);
  assert.match(r.blocks[0].text, /sheet 'crat' is not in web\/extra_fx/);
  assert.equal(r.blocks[1].text, "CIPHER: Still here.");
  // a real sheet is named with its own clip
  const crate = readBack([{ fx: "crate", at: [10, 20] }], fixtureOpts());
  assert.match(crate.blocks[0].text, new RegExp(sheets.crate.default));
});

test("the CLI prints a heading and a speaker line for a real quest, and one line for an unknown id", () => {
  const ok = spawnSync(process.execPath, [TOOL, "--quest", "park_pest_control", "--slot", "offer"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^## /);
  assert.match(ok.stdout, /^\d+\. [A-Z][^:]*: /m, "at least one speaker line");
  assert.match(ok.stdout, /LEOMON: /);

  const bad = spawnSync(process.execPath, [TOOL, "--quest", "no_such_quest", "--slot", "offer"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(bad.status, 1);
  const lines = `${bad.stdout}${bad.stderr}`.trim().split("\n");
  assert.equal(lines.length, 1, `one line, got: ${JSON.stringify(lines)}`);
  assert.match(lines[0], /no_such_quest/);
});

test("the CLI reads a scene file, diffs two readings and prints JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "quest-readback-"));
  try {
    const a = join(dir, "a.json"), b = join(dir, "b.json");
    writeFileSync(a, JSON.stringify(fixture()));
    const changed = fixture();
    changed[2] = { ...changed[2], text: "The bridge looks better at dusk. Do you not think so?" };
    writeFileSync(b, JSON.stringify(changed));

    const run = spawnSync(process.execPath, [TOOL, "--scene", a, "--map", "s205", "--diff", b], { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^## Central Sector — Asuka Bridge/);
    assert.match(run.stdout, /^[- ] \d+\. /m);
    assert.match(run.stdout, /added 1, removed 1, same 4/);

    const json = spawnSync(process.execPath, [TOOL, "--scene", a, "--map", "s205", "--json"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(json.status, 0, json.stderr);
    const reading = JSON.parse(json.stdout);
    assert.equal(reading.blocks.length, 5);
    assert.deepEqual(reading.problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the module stays pure: no DOM, no fs; the tool writes nothing", () => {
  const mod = readFileSync(new URL("../web/quest-readback.js", import.meta.url), "utf8");
  assert.doesNotMatch(mod, /from\s+["'](node:)?fs["']/);
  assert.doesNotMatch(mod, /\brequire\s*\(/);
  assert.doesNotMatch(mod, /\bdocument\b/);
  assert.doesNotMatch(mod, /\bwindow\b/);
  const tool = readFileSync(TOOL, "utf8");
  assert.doesNotMatch(tool, /writeFileSync|appendFileSync|writeFile\(/);
});
