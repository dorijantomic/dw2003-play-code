// The State Shelf (web/quest-shelf.js + web/quest-lab.js): name a quest state, jump back to it, diff two in plain
// lines, undo. The quest layer's own store only -- no story flag, no memory card -- and the module stays pure.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSnapshot, diffSnapshots, shelfAdd, shelfRemove, shelfRename, shelfExport, shelfImport } from "../web/quest-shelf.js";

const readText = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SHELF_SRC = readText("../web/quest-shelf.js");
const LAB_SRC = readText("../web/quest-lab.js");

// web/quests.js:60 freshState(), written out literally so the module is checked against the real shape
const fresh = () => ({ v: 1, active: {}, done: {}, visited: [], met: [], duelWins: 0, announced: {}, seen: {}, triggers: {}, gen: { n: 0, def: null } });
const clone = (v) => JSON.parse(JSON.stringify(v));

// =====================================================================================================================
// 1. validateSnapshot: the quest layer's own shape, and the newer done/picks shapes it must accept
// =====================================================================================================================
test("validateSnapshot takes the quest layer's own fresh state and the newer done and picks shapes", () => {
  assert.deepEqual(validateSnapshot(fresh()), [], "a literal freshState() is a good snapshot");

  const doneObject = fresh();
  doneObject.done = { park_pest_control: { at: 1793000000000, pick: 1 } };
  assert.deepEqual(validateSnapshot(doneObject), [], "the Ledger's done shape {at, pick} is accepted");

  const picks = fresh();
  picks.picks = { g_bridge_golden: { pick: 2, at: 1793000000001 } };
  assert.deepEqual(validateSnapshot(picks), [], "picks {pick, at} is accepted");

  const blocks = fresh();
  blocks.triggers = { t1: 1 };
  blocks.gen = { n: 2, def: "bounty_3" };
  assert.deepEqual(validateSnapshot(blocks), [], "triggers and gen are accepted");

  const older = fresh();
  delete older.triggers; delete older.gen; delete older.announced; delete older.seen;
  assert.deepEqual(validateSnapshot(older), [], "the optional blocks may be missing (loadState fills them)");
});

test("validateSnapshot names each defect once", () => {
  const one = (s) => {
    const p = validateSnapshot(s);
    assert.equal(p.length, 1, `expected exactly 1 problem, got: ${p.join("; ")}`);
    return p[0];
  };

  const v2 = fresh(); v2.v = 2;
  assert.match(one(v2), /version/);

  const noActive = fresh(); delete noActive.active;
  assert.match(one(noActive), /active/);

  const doneString = fresh(); doneString.done = { some_job: "yes" };
  assert.match(one(doneString), /done/);

  const visitedNumber = fresh(); visitedNumber.visited = ["s330", 7];
  assert.match(one(visitedNumber), /visited/);

  const pickNoAt = fresh(); pickNoAt.picks = { some_job: { pick: 1 } };
  assert.match(one(pickNoAt), /picks/);

  assert.equal(validateSnapshot(null).length, 1, "no state at all is one problem");
});

// =====================================================================================================================
// 2. diffSnapshots: two states, in plain numbers and ids
// =====================================================================================================================
const A = () => ({
  v: 1,
  active: { q_a: { p: [0], seen: [[]], at: 1 }, q_gone: { p: [1], seen: [[]], at: 2 } },
  done: {},
  visited: ["s330", "s331"],
  met: ["1@s330"],
  duelWins: 0,
  announced: {}, seen: {}, triggers: {}, gen: { n: 0, def: null },
  picks: { q_pick: { pick: 0, at: 3 } },
});
const B = () => ({
  v: 1,
  active: { q_a: { p: [1], seen: [[]], at: 1 }, q_new: { p: [0], seen: [[]], at: 4 } },
  done: { q_finished: 1793000000000 },
  visited: ["s330", "s331", "s332", "s333"],
  met: ["1@s330", "2@s332"],
  duelWins: 0,
  announced: {}, seen: {}, triggers: {}, gen: { n: 0, def: null },
  picks: { q_pick: { pick: 1, at: 5 } },
});
const ZERO = { addedActive: [], removedActive: [], addedDone: [], removedDone: [], visitedAdded: [], visitedRemoved: [], metAdded: [], picksChanged: [], rows: [] };

test("diffSnapshots reports +1 active, -1 active, +1 done, +2 visited, +1 met and 1 pick changed, with the ids", () => {
  const d = diffSnapshots(A(), B());
  assert.deepEqual(d.addedActive, ["q_new"]);
  assert.deepEqual(d.removedActive, ["q_gone"]);
  assert.deepEqual(d.addedDone, ["q_finished"]);
  assert.deepEqual(d.removedDone, []);
  assert.deepEqual(d.visitedAdded, ["s332", "s333"]);
  assert.deepEqual(d.visitedRemoved, []);
  assert.deepEqual(d.metAdded, ["2@s332"]);
  assert.deepEqual(d.picksChanged, ["q_pick"]);
  assert.equal(d.rows.length, 7, "1 + 1 + 1 + 2 + 1 + 1 changes, one row each");

  const row = (kind, id) => d.rows.find((r) => r.kind === kind && r.id === id);
  assert.ok(row("active", "q_new"), "the new active job has a row");
  assert.equal(row("active", "q_new").from, null, "it was not there before");
  assert.ok(row("active", "q_gone"), "the dropped active job has a row");
  assert.equal(row("active", "q_gone").to, null, "it is gone now");
  assert.ok(row("done", "q_finished"), "the finished job has its done row");
  assert.ok(row("visited", "s332") && row("visited", "s333"), "both new places have rows");
  assert.ok(row("met", "2@s332"), "the new meeting has its row");
  assert.equal(row("picks", "q_pick").from, 0, "the old pick");
  assert.equal(row("picks", "q_pick").to, 1, "the new pick");
});

test("a diff of a state with itself is all zeros", () => {
  assert.deepEqual(diffSnapshots(A(), A()), ZERO);
  assert.deepEqual(diffSnapshots(fresh(), fresh()), ZERO);
});

test("save a state, finish a job, and the diff shows exactly the one done row", () => {
  // the state a tester saves right after taking a job
  const saved = fresh();
  saved.active = { park_messages: { p: [0, 0], seen: [[], []], at: 10 } };
  const shelf = shelfAdd([], "after the offer", saved).shelf;

  // "Goals" meets every objective; the hand-in claims it: active -> done (web/quests.js:159)
  const after = clone(saved);
  delete after.active.park_messages;
  after.done.park_messages = 1793000000000;

  const d = diffSnapshots(shelf[0].snap, after);
  assert.equal(d.rows.filter((r) => r.kind === "done").length, 1, "exactly the one done row");
  assert.deepEqual(d.addedDone, ["park_messages"]);
  assert.deepEqual(d.removedActive, ["park_messages"]);

  // Restore writes the snapshot back: the next diff is the all-zero one
  assert.deepEqual(diffSnapshots(shelf[0].snap, clone(saved)), ZERO);
});

// =====================================================================================================================
// 3. the shelf: add, rename, remove, export/import, and the refusals
// =====================================================================================================================
test("the shelf: add two, rename one, remove one, and export/import round-trips deep-equal", () => {
  const one = shelfAdd([], "after the offer", A());
  assert.deepEqual(one.problems, []);
  assert.equal(one.shelf.length, 1);
  assert.equal(one.shelf[0].name, "after the offer");
  assert.equal(typeof one.shelf[0].at, "number", "each item remembers when it was saved");
  assert.deepEqual(one.shelf[0].snap, A(), "and the state itself");

  const two = shelfAdd(one.shelf, "objectives done", B());
  assert.deepEqual(two.problems, []);
  assert.deepEqual(two.shelf.map((x) => x.name), ["after the offer", "objectives done"]);

  const renamed = shelfRename(two.shelf, "objectives done", "ready to hand in");
  assert.deepEqual(renamed.problems, []);
  assert.deepEqual(renamed.shelf.map((x) => x.name), ["after the offer", "ready to hand in"]);
  assert.deepEqual(renamed.shelf[1].snap, B(), "a rename keeps the snapshot");
  assert.equal(renamed.shelf[1].at, two.shelf[1].at, "and its time");

  const removed = shelfRemove(renamed.shelf, "after the offer");
  assert.deepEqual(removed.problems, []);
  assert.deepEqual(removed.shelf.map((x) => x.name), ["ready to hand in"]);

  const exported = shelfExport(removed.shelf);
  assert.equal(exported.v, 1, "the export is versioned");
  assert.deepEqual(exported.items.map((x) => x.name), ["ready to hand in"]);

  const round = shelfImport(JSON.stringify(exported));
  assert.deepEqual(round.problems, []);
  assert.deepEqual(round.shelf, removed.shelf, "export then import is the same shelf");
  assert.deepEqual(shelfImport(exported).shelf, removed.shelf, "an already-parsed object works too");
});

test("a duplicate name is refused with 1 problem, and the shelf is left alone", () => {
  const first = shelfAdd([], "same name", fresh());
  const dup = shelfAdd(first.shelf, "same name", fresh());
  assert.equal(dup.problems.length, 1);
  assert.match(dup.problems[0], /already/);
  assert.deepEqual(dup.shelf, first.shelf, "nothing was added");
});

test("shelfImport refuses what it cannot prove: a version it does not know, bad JSON, a bad snapshot", () => {
  const version = shelfImport('{"v":2}');
  assert.equal(version.problems.length, 1);
  assert.equal(version.shelf, null, "no shelf from an unknown version");

  const notJson = shelfImport("not json at all");
  assert.equal(notJson.problems.length, 1);
  assert.equal(notJson.shelf, null);

  const badSnap = shelfImport(JSON.stringify({ v: 1, items: [{ name: "x", at: 1, snap: { v: 2 } }] }));
  assert.equal(badSnap.problems.length, 1, "the snapshot's own problem, named once");
  assert.equal(badSnap.shelf, null, "one bad item refuses the whole import");
});

// =====================================================================================================================
// 4. Source gates: the module is pure, the lab writes only the quest layer's three keys, restore order
// =====================================================================================================================
test("web/quest-shelf.js is pure: no DOM, no storage, no fs, no fetch", () => {
  for (const bad of [/\bdocument\b/, /\bwindow\b/, /\blocalStorage\b/, /\bsessionStorage\b/, /node:fs/, /\brequire\s*\(/, /\bfetch\s*\(/]) {
    assert.doesNotMatch(SHELF_SRC, bad, `web/quest-shelf.js must not use ${bad}`);
  }
});

test("the lab writes only the quest layer's own three keys, never a story flag or a memory card", () => {
  const keys = [...LAB_SRC.matchAll(/localStorage\.setItem\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const writes = (LAB_SRC.match(/localStorage\.setItem\(/g) ?? []).length;
  assert.equal(keys.length, writes, "every write names its key as a literal string");
  assert.deepEqual([...new Set(keys)].sort(), ["dw.quests.shelf.v1", "dw.quests.v1", "dw.quests.v1.bak"]);
  assert.doesNotMatch(LAB_SRC, /mcard/i, "never a memory-card key");
  assert.doesNotMatch(LAB_SRC, /setFlag\s*\(|storyFlag/, "never a story flag");
});

test("the lab's restore backs up first, writes the snapshot second, then reloads the current URL", () => {
  const bak = LAB_SRC.indexOf('localStorage.setItem("dw.quests.v1.bak"');
  const live = LAB_SRC.indexOf('localStorage.setItem("dw.quests.v1"');
  const reload = LAB_SRC.indexOf("location.reload()");
  assert.ok(bak > -1, "the backup write is there");
  assert.ok(live > bak, "the snapshot is written after the backup");
  assert.ok(reload > live, "the page reloads after both writes");
  assert.ok(LAB_SRC.includes('from "./quest-shelf.js"'), "the lab uses the pure shelf module");
});
