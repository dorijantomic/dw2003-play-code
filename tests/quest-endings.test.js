// Every Ending (web/quest-endings.js + tools/quest_endings.mjs): one page per job, every way it can go.
// Accept or decline, every other question's answers, every hand-in choice with its pay and closing lines,
// a lost chase, a lost fight. Read from the data; nothing invented, nothing written.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endingsOf, endingsProblem, endingsTable, endingsBlock } from "../web/quest-endings.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TOOL = fileURLToPath(new URL("../tools/quest_endings.mjs", import.meta.url));
const readJSON = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
const readText = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const quests = readJSON("../web/quests.json").quests;

// ---- an independent walk over the data, so the module's totals are compared to a second reading, not to a literal
const sceneSlots = (q) => [
  ["offer", q.offer?.scene], ["accept", q.acceptScene], ["done", q.doneScene], ["turnin", q.turnIn?.scene],
  ...(q.objectives ?? []).map((o, i) => [`objective-${i}`, o?.scene]),
].filter(([, steps]) => Array.isArray(steps) && steps.length);
const stepsOf = (q) => sceneSlots(q).flatMap(([slot, steps]) => steps.map((s) => ({ slot, s })));
const isAsk = (s) => !!s && typeof s === "object" && "ask" in s && Array.isArray(s.options);
const hasStep = (q, key) => stepsOf(q).some(({ s }) => s && typeof s === "object" && key in s);
const closingless = (q) => !q.doneScene && !(q.turnIn?.doneLines?.length) && !(q.offer?.doneLines?.length);
function measuredTable(defs) {
  const t = { quests: defs.length, offers: 0, askSteps: 0, askRows: 0, verdicts: 0, verdictRows: 0, choicePoints: 0, optionRows: 0, chases: 0, battles: 0, closingless: 0 };
  for (const q of defs) {
    if (q.offer) t.offers++;
    for (const { s } of stepsOf(q)) {
      if (isAsk(s)) { t.askSteps++; t.askRows += s.options.length; }
      if (s && typeof s === "object" && "chase" in s) t.chases++;
      if (s && typeof s === "object" && "battle" in s) t.battles++;
    }
    if (q.verdict) { t.verdicts++; t.verdictRows += q.verdict.options.length; }
    if (closingless(q)) t.closingless++;
  }
  t.choicePoints = t.askSteps + t.verdicts;
  t.optionRows = t.askRows + t.verdictRows;
  return t;
}

// ---- fixtures (a quest with words at the hand-in, so a closing-less warning never joins a shape problem)
const base = () => ({
  id: "fixture", title: "Fixture", reward: { bits: 10 },
  objectives: [{ type: "visit", map: "s200" }],
  offer: { npc: 1, name: "Giver", maps: ["s200"], lines: ["A job for you."], doneLines: ["Done."] },
});
const withVerdict = (verdict) => { const q = base(); q.verdict = verdict; return q; };

test("g_bridge_golden reads 2 offer + 3 ask + 3 verdict rows, each verdict pays the base reward and its own pay", () => {
  const q = quests.find((x) => x.id === "g_bridge_golden");
  assert.ok(q, "the golden fixture is in the data");
  const rows = endingsOf(q);
  const of = (kind) => rows.filter((r) => r.kind === kind);
  assert.equal(rows.length, 8, "2 offer + 3 ask + 3 verdict");
  assert.equal(of("offer").length, 2);
  assert.equal(of("ask").length, 3);
  assert.equal(of("verdict").length, 3);

  // the offer rows name the scene's own ask, and speak the scene's own two answers
  assert.deepEqual(of("offer").map((r) => r.choice), ["I will ask", "Not now"]);
  for (const row of of("offer")) assert.match(row.lines[0], /Ask Cipher for the picture\?/);

  // the ask rows are the objective scene's one question, all three answers, spoken and changing nothing
  assert.deepEqual(of("ask").map((r) => r.choice), ["The bridge", "The light", "The man who asked"]);
  for (const row of of("ask")) assert.match(row.note, /spoken; changes nothing/);

  // the verdict rows: the option text, the after lines, and reward + verdict.pay[i]
  for (let i = 0; i < q.verdict.options.length; i++) {
    const row = of("verdict")[i];
    assert.equal(row.choice, q.verdict.options[i]);
    assert.deepEqual(row.lines, q.verdict.after[i]);
    const pay = q.verdict.pay[i];
    assert.deepEqual(row.pay, {
      bits: (q.reward.bits ?? 0) + (pay.bits ?? 0),
      items: [...(q.reward.items ?? []), ...(pay.items ?? [])],
    });
  }
  for (const row of rows) assert.ok(row.lines.length && row.lines[0].trim(), `every row has a first line (${row.kind})`);
});

test("the real data's totals follow the file itself, so a quest merged later cannot pin them stale", () => {
  const table = endingsTable(quests);
  assert.deepEqual(table, measuredTable(quests), "the module and a second, independent walk over quests.json agree");
  // every total follows from the file and from the rules, not from a count measured on one day
  assert.equal(table.quests, quests.length, "one quest per definition in the file");
  assert.equal(table.offers, quests.filter((q) => q.offer).length, "one offer per def that has one");
  assert.equal(table.choicePoints, table.askSteps + table.verdicts, "every ask step and every verdict is one choice point");
  assert.equal(table.optionRows, table.askRows + table.verdictRows, "every option of either is one spoken row");
  assert.ok(table.offers > 0 && table.askSteps > 0 && table.verdicts > 0, "the file still has offers, questions and hand-ins");
  // the frozen golden fixture keeps its exact numbers
  const one = endingsTable([quests.find((q) => q.id === "g_bridge_golden")]);
  assert.deepEqual(one, { quests: 1, offers: 1, askSteps: 2, askRows: 5, verdicts: 1, verdictRows: 3, choicePoints: 3, optionRows: 8, chases: 0, battles: 0, closingless: 0 });
});

test("every quest yields rows; a job with no giver says so, and each job's closing row follows its own words", () => {
  for (const q of quests) assert.ok(endingsOf(q).length >= 1, `${q.id} yields at least one row`);

  // no giver: a def with no offer gets exactly one note and no offer rows; a def with one gets its two offer rows
  const noOffer = quests.filter((q) => !q.offer);
  for (const q of noOffer) {
    const rows = endingsOf(q);
    assert.equal(rows.filter((r) => r.kind === "offer").length, 0, `${q.id} has no offer rows`);
    assert.equal(rows.filter((r) => /no giver/.test(r.note)).length, 1, `${q.id} has exactly one no-giver note`);
  }
  for (const q of quests.filter((q) => q.offer)) {
    const rows = endingsOf(q);
    assert.equal(rows.filter((r) => /no giver/.test(r.note)).length, 0, `${q.id} has a giver`);
    assert.equal(rows.filter((r) => r.kind === "offer").length, 2, `${q.id} has the accept and decline rows`);
  }
  const east = endingsOf(quests.find((q) => q.id === "east_station_greens")).find((r) => /no giver/.test(r.note));
  for (const map of ["s410", "s411", "s955"]) assert.match(east.note, new RegExp(map), "east_station_greens names its acceptAt place");

  // closing: the warning row is there for every def with neither doneScene nor doneLines, and only for those
  const noClosing = quests.filter(closingless);
  for (const q of noClosing) {
    const row = endingsOf(q).find((r) => r.kind === "closing");
    assert.ok(row, `${q.id} has the closing warning`);
    assert.match(row.note, /no closing words; the hand-in ends on the toast/);
  }
  for (const q of quests.filter((x) => !closingless(x))) {
    assert.equal(endingsOf(q).filter((r) => r.kind === "closing").length, 0, `${q.id} has its closing words, so no warning`);
  }
  assert.equal(endingsTable(quests).closingless, noClosing.length, "the table counts the same defs the walk finds");
});

test("offers with no scene say asked at runtime; chase and battle rows are kept up / lost and win-or-flee / loss", () => {
  const noScene = quests.filter((q) => q.offer && !q.offer.scene);
  for (const q of noScene) for (const r of endingsOf(q).filter((x) => x.kind === "offer")) assert.match(r.note, /asked at runtime/);
  for (const q of quests.filter((x) => x.offer?.scene)) {
    for (const r of endingsOf(q).filter((x) => x.kind === "offer")) assert.doesNotMatch(r.note, /asked at runtime/, `${q.id} asks in its own offer scene`);
  }

  const chase = endingsOf(quests.find((q) => q.id === "zz_chase_demo")).filter((r) => r.kind === "chase");
  assert.equal(chase.length, 2);
  assert.deepEqual(chase.map((r) => r.choice), ["kept up", "lost"]);
  assert.match(chase[1].note, /the rest of the scene does not play/);

  const battle = endingsOf(quests.find((q) => q.id === "zz_fx_all")).filter((r) => r.kind === "battle");
  assert.equal(battle.length, 2);
  assert.deepEqual(battle.map((r) => r.choice), ["win or flee", "loss"]);
  assert.match(battle[1].note, /title/);
});

test("an ask inside a scene that also has a chase marks its second answer as the lost chase", () => {
  const q = base();
  q.objectives[0].scene = [
    { say: 1, name: "G", text: "Keep up." },
    { ask: "Ready?", options: ["Yes", "No"] },
    { chase: 1, path: [[0, 0]], speed: 120, lose: 90, frames: 60 },
  ];
  const asks = endingsOf(q).filter((r) => r.kind === "ask");
  assert.equal(asks.length, 2);
  assert.match(asks[0].note, /spoken; changes nothing/);
  assert.equal(asks[1].note, "the chase is lost; the rest of the scene does not play");
});

test("endingsProblem finds the shapes the checker misses: no after lines, a one-option ask, a long option, an empty pay", () => {
  const noAfter = withVerdict({ ask: "?", options: ["a", "b"], pay: [{ bits: 1 }, { bits: 2 }], after: [[], ["x"]] });
  assert.equal(endingsProblem(noAfter).length, 1, "empty after list");

  const noAfterList = withVerdict({ ask: "?", options: ["a", "b"], pay: [{ bits: 1 }, { bits: 2 }] });
  assert.equal(endingsProblem(noAfterList).length, 1, "missing after list");

  const oneAsk = base();
  oneAsk.objectives[0].scene = [{ ask: "Only one?", options: ["yes"] }];
  assert.equal(endingsProblem(oneAsk).length, 1, "a one-option ask is one problem");

  const longOption = withVerdict({ ask: "?", options: ["x".repeat(29), "b"], pay: [{ bits: 1 }, { bits: 2 }], after: [["a"], ["b"]] });
  assert.equal(endingsProblem(longOption).length, 1, "a 29-character verdict option is one problem");

  const emptyPay = withVerdict({ ask: "?", options: ["a", "b"], pay: [{}, { bits: 1 }], after: [["a"], ["b"]] });
  assert.equal(endingsProblem(emptyPay).length, 1, "a pay with no bits and no items is one problem");

  // the closing-less warning is one informational problem, and the real data has no shape problems
  const bare = base();
  delete bare.offer.doneLines;
  assert.equal(endingsProblem(bare).length, 1);
  assert.match(endingsProblem(bare)[0], /no closing words/);
  const shapeProblems = quests.flatMap((q) => endingsProblem(q)).filter((p) => !/no closing words/.test(p));
  assert.deepEqual(shapeProblems, [], "the shipped data has no shape problems");
});

test("the page block shows the exact question, the pays and the closing warning, in plain text and markdown", () => {
  const q = quests.find((x) => x.id === "g_bridge_golden");
  const text = endingsBlock(q);
  assert.match(text, /^## g_bridge_golden/);
  assert.match(text, /Ask Cipher for the picture\?/);
  assert.match(text, /What is the picture really of\?/);
  assert.match(text, /300 BIT/);
  assert.match(text, /1 x Booster 12a/);
  assert.match(text, /It is yours, Traveler/);
  assert.match(text, /Good\. Then it goes on the first page/);

  const md = endingsBlock(q, { markdown: true });
  assert.match(md, /^## /);
  assert.match(md, /\|/);
  assert.match(md, /- Ask Cipher for the picture\?/, "the exact question is on the markdown page too");
  assert.match(md, /- Good\. Then it goes on the first page/, "and the exact after lines");

  const noGiver = endingsBlock(quests.find((x) => x.id === "east_station_greens"));
  assert.match(noGiver, /no giver/);
  assert.match(noGiver, /s410/);
});

test("the CLI prints every job and exits 0 on the current data; --quest, --shipped, --json and --markdown work", () => {
  const all = spawnSync(process.execPath, [TOOL, "--all"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(all.status, 0, all.stderr);
  assert.equal((all.stdout.match(/^## /gm) ?? []).length, quests.length, "one block per quest in the file");
  assert.match(all.stdout, /no giver: east_station_greens/);

  const one = spawnSync(process.execPath, [TOOL, "--quest", "g_bridge_golden"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /Ask Cipher for the picture\?/);
  assert.match(one.stdout, /Booster 12a/);

  const shippedIds = readText("../data/authored/quests/shipped.txt").split("\n").map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
  const shipped = spawnSync(process.execPath, [TOOL, "--shipped"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(shipped.status, 0, shipped.stderr);
  assert.equal((shipped.stdout.match(/^## /gm) ?? []).length, shippedIds.length, "--shipped prints exactly the shipped list");

  const json = spawnSync(process.execPath, [TOOL, "--all", "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(json.status, 0, json.stderr);
  const data = JSON.parse(json.stdout);
  assert.deepEqual(data.totals, endingsTable(quests));
  assert.equal(data.quests.length, quests.length, "one JSON entry per quest in the file");
  assert.ok(Array.isArray(data.quests[0].rows));

  const md = spawnSync(process.execPath, [TOOL, "--quest", "g_bridge_golden", "--markdown"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(md.status, 0, md.stderr);
  assert.match(md.stdout, /^# /m);
  assert.match(md.stdout, /\|/);
});

test("the CLI exits 1 on a bad def, with its block still printed, and writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "quest-endings-"));
  try {
    mkdirSync(join(dir, "web"), { recursive: true });
    mkdirSync(join(dir, "data/authored/quests"), { recursive: true });
    const bad = withVerdict({ ask: "?", options: ["a", "b"], pay: [{ bits: 1 }, { bits: 2 }], after: [[], ["x"]] });
    bad.id = "bad_fixture";
    writeFileSync(join(dir, "web/quests.json"), JSON.stringify({ quests: [bad] }));
    const run = spawnSync(process.execPath, [TOOL, "--all", "--root", dir], { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /bad_fixture/, "the block is still printed");
    assert.match(run.stdout, /after/, "the problem is named");

    const tool = readText("../tools/quest_endings.mjs");
    assert.doesNotMatch(tool, /writeFileSync|appendFileSync|writeFile\(/, "the tool writes nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the module stays pure (no fs, no DOM) and the lab gains one Ways button with one call", () => {
  const mod = readText("../web/quest-endings.js");
  assert.doesNotMatch(mod, /from\s+["'](node:)?fs["']/);
  assert.doesNotMatch(mod, /\brequire\s*\(/);
  assert.doesNotMatch(mod, /\bdocument\b/);
  assert.doesNotMatch(mod, /\bwindow\b/);
  const tool = readText("../tools/quest_endings.mjs");
  assert.doesNotMatch(tool, /\bdocument\b/);
  assert.doesNotMatch(tool, /\bwindow\b/);
  const lab = readText("../web/quest-lab.js");
  assert.equal((lab.match(/textContent: "Ways"/g) ?? []).length, 1, "one button");
  assert.equal((lab.match(/endingsBlock\(/g) ?? []).length, 1, "one call");
});
