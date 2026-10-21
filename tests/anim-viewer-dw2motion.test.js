// K25 — the DW2 motion panel's data side: which slots a body fills from DW2, the clone that carries
// those motions into the renderer, the model-folder shim, and the ratings that share the generic
// store. The DOM panel itself is exercised by the headless probe (tools/run-playwright.sh).
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../web/anim-viewer-dw2motion.js";
import * as GEN from "../web/anim-viewer-generic.js";

const playlist = (lo, n) => Array.from({ length: n }, (_, i) => ({ value: lo + i, loop_target: lo, aux: null }));
const motion = (letter, { table = 7, used = true, frames = 4, gaps = [9] } = {}) => ({
  letter, kind: "cast", table, lo: 7000, hi: 7000 + frames, frames, used, gaps,
  keys: used ? { 0: [[10, 0, 0, 7000], [20, 0, 0, 7001]], 3: [[0, 10, 0, 7000], [0, 20, 0, 7001]] } : {},
  ch1: used ? { 0: [[0, 100, 0, 7000], [0, 120, 0, 7001]] } : {},
  playlist: used ? playlist(7000, frames) : [],
  gate: { frames, covered: used ? 1 : 0.2, step: used ? 0.5 : 3.1, ankle: 0.02, pen: 0.01, groundBelow: 0.05, groundAbove: 0, return: 0.1, hand: 0.6, motion: 0.5, speed: 1.1 },
});

const file = (over = {}) => ({
  v: 2, folder: "m050coca", name: "Kokatorimon",
  ownedSlots: [0, 1, 2, 3, 4, 5], gapSlots: [6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17],
  motions: { F: motion("F"), G: motion("G", { table: 8, used: false }), H: motion("H", { table: 9, used: false }), I: motion("I", { table: 10, gaps: [6, 7, 8, 11, 14] }) },
  ...over,
});

const model = (timeline) => ({
  folder: "m050coca", num_bones: 4,
  bones: [
    { anim: { ch1: [[0, 0, 0, 0], [0, 0, 0, 30000]], ch2: [[0, 0, 0, 0], [0, 0, 0, 30000]] } },
    { anim: { ch2: [[0, 0, 0, 0], [0, 0, 0, 30000]] } },
    { anim: { ch2: [[0, 0, 0, 0], [0, 0, 0, 30000]] } },
    { anim: { ch2: [[0, 0, 0, 0], [0, 0, 0, 30000]] } },
  ],
  timeline: timeline ?? [{ table: playlist(0, 5) }, { table: playlist(20, 3) }, { table: [] }, { table: playlist(40, 3) }],
});

test("slot rows: filled / refused / owned / none, with the gate's failing keys", () => {
  const rows = D.dw2Rows(file());
  const by = new Map(rows.map((r) => [r.slot, r]));
  assert.equal(by.get(0).status, "owned", "slot 0 is the body's own idle");
  assert.equal(by.get(5).status, "owned");
  const nine = by.get(9);
  assert.equal(nine.status, "filled");
  assert.deepEqual(nine.letters.map((x) => x.letter), ["F"], "only F passed the gate; G/H were refused");
  const six = by.get(6);
  assert.equal(six.status, "filled");
  assert.deepEqual(six.letters.map((x) => x.letter), ["I"]);
  assert.equal(by.get(12).status, "none", "clip 12 is the presentation actor's");
  assert.equal(by.get(13).status, "refused");
  assert.ok(by.get(13).refused[0].keys.includes("step"), "the refused step bar is named");
});

test("a slot the file does not list as a gap is never filled, even if a motion claims it", () => {
  const f = file({ ownedSlots: [0, 9], gapSlots: [6] });
  assert.equal(D.fillersFor(f, 9).length, 0, "owned beats a motion's gaps list");
  assert.equal(D.fillersFor(f, 6).length, 1);
});

test("counts: filled / gaps / refused / owned", () => {
  const c = D.dw2Counts(file());
  assert.equal(c.owned, 6);
  assert.equal(c.filled, 6, "I fills 6,7,8,11,14 and F fills 9");
  assert.equal(c.refused, 5, "the remaining gap slots (10, 13, 15, 16, 17) were refused");
  assert.deepEqual(c.slots, [6, 7, 8, 9, 11, 14]);
});

test("the clone: a free table, the keys appended before the sentinel, the playlist registered", () => {
  const m = model();
  const { model: clone, tables, filled } = D.buildClone(m, file());
  assert.deepEqual(filled.sort(), ["F", "I"]);
  for (const [letter, table] of Object.entries(tables)) {
    assert.ok(table >= 4, `${letter} gets a table past the model's own (got ${table})`);
    assert.ok(clone.timeline[table].table.length > 0);
  }
  const rows = clone.bones[0].anim.ch2;
  assert.deepEqual(rows.find((r) => r[3] === 7000), [10, 0, 0, 7000], "the DW2 key travelled");
  assert.equal(rows[rows.length - 1][3], 30000, "still terminated");
  const ch1 = clone.bones[0].anim.ch1;
  assert.deepEqual(ch1.find((r) => r[3] === 7000), [0, 100, 0, 7000], "the root translation travelled too");
  assert.deepEqual(m.bones[0].anim.ch2.map((r) => r[3]), [0, 30000], "the source model is untouched");
});

test("the clone refuses to land a motion on a table the body already uses", () => {
  const m = model([{ table: playlist(0, 5) }, { table: [] }, { table: [] }, { table: [] }, { table: [] }, { table: [] }, { table: [] }, { table: playlist(70, 4) }]);
  const { tables } = D.buildClone(m, file());
  assert.notEqual(tables.F, 7, "table 7 is the body's own — the clone picks another");
  assert.equal(m.timeline[7].table.length, 4, "and never overwrites it");
});

test("the model-folder shim: the clone in memory, the body's slot map and texture from disc", () => {
  const store = D.createDw2Store();
  const clone = model();
  const vf = D.dw2Folder("m050coca");
  assert.equal(vf, "m050coca-dw2m");
  assert.equal(D.isDw2Folder(vf), true);
  assert.equal(D.dw2RealFolder(vf), "m050coca");
  store.set(vf, { model: clone, real: "m050coca" });
  assert.deepEqual(store.resolve(`assets/battle/models/${vf}/anim.json`), { json: clone });
  assert.equal(store.resolve(`assets/battle/models/${vf}/slot_map.json`).url, "assets/battle/models/m050coca/slot_map.json");
  assert.equal(store.resolve(`assets-hd/battle/textures/${vf}.png`).url, "assets-hd/battle/textures/m050coca.png");
  assert.equal(store.resolve("assets/battle/models/m009mera/anim.json"), null);
});

test("the A/B pair: the DW2 motion and what that slot plays today", () => {
  const f = file();
  const pair = D.dw2Actions(f, { folder: "m050coca", slot: 9, tables: { F: 30 } });
  assert.equal(pair.length, 2);
  assert.equal(pair[0].kind, "dw2");
  assert.equal(pair[0].table, 30, "the clone's table, not the file's");
  assert.equal(pair[1].kind, "own");
  assert.equal(pair[1].clip, 9);
  assert.deepEqual(D.dw2Actions(f, { slot: 0 }), [], "an owned slot has no DW2 pair");
});

test("deep link and rating id", () => {
  assert.equal(D.dw2Query({ slot: 9, folder: "m050coca" }), "dw2fill=9&model=m050coca");
  assert.equal(D.dw2Query({ slot: 9, folder: "m050coca", letter: "G", ab: "own" }), "dw2fill=9&model=m050coca&letter=G&ab=own");
  assert.equal(D.dw2Query({}), "");
  assert.equal(D.ratingId(9), "dw2:9");
});

test("the probe finds only the bodies whose file exists", async () => {
  const have = new Set(["m050coca", "m009mera"]);
  const calls = [];
  const fakeFetch = async (url) => { calls.push(url); return { ok: have.has(url.split("/").pop().replace(".json", "")), status: have.has(url.split("/").pop().replace(".json", "")) ? 200 : 404 }; };
  const found = [];
  const n = await D.probeFolders(["m050coca", "m009mera", "m003agum"], (f) => found.push(f), { fetchImpl: fakeFetch, concurrency: 1 });
  assert.equal(n, 2);
  assert.deepEqual(found.sort(), ["m009mera", "m050coca"]);
  assert.equal(calls.length, 3);
});

test("DW2 ratings share the generic store and stay separable by kind", () => {
  const storage = { data: {}, getItem(k) { return this.data[k] ?? null; }, setItem(k, v) { this.data[k] = v; } };
  const store = GEN.createRatingStore({ storage, now: () => "2026-01-01T00:00:00.000Z" });
  store.set("walk", "m050coca", { verdict: "works", bodyPlan: "bird" });
  store.set(D.ratingId(9), "m050coca", { verdict: "broken", note: "arm folds", bodyPlan: "bird", kind: "dw2", name: "DW2 spell" });
  assert.equal(store.size(), 2);
  assert.equal(store.size("dw2"), 1);
  assert.equal(store.all("generic")[0].motion, "walk");
  const out = store.exportObject();
  assert.deepEqual(out.ratings.map((r) => r.kind).sort(), ["dw2", "generic"]);
  // a second instance reads the same key back with the kinds intact
  const again = GEN.createRatingStore({ storage });
  assert.equal(again.get(D.ratingId(9), "m050coca").kind, "dw2");
  assert.equal(again.get("walk", "m050coca").kind, "generic");
});
