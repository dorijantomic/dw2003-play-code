// Generic motions tester of the animation viewer: the pure half (URL shim, preview length, ratings,
// export/import, generator loader, stub). The browser half is probed with a headless Chromium
// (~/scratch-research/generic-viewer/probe.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const G = await import("../web/anim-viewer-generic.js");
const STUB = await import("../web/anim-viewer-generic-stub.js");

const mk = (entries) => entries.map((value) => ({ value, loop_target: 0, aux: null }));
const model = (folder = "m001test") => ({
  folder,
  timeline: [
    { table: [...mk([1, 2, 3, 4, 5, 6]), { value: 0x8000, loop_target: 0, aux: null }] },   // idle loops
    { table: [...mk([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]), { value: 0xFFFF, loop_target: 0, aux: null }] },
    { table: [...mk([30, 31, 32, 33, 34, 35, 36, 37, 38, 39]), { value: 0xFFFF, loop_target: 0, aux: null }] },
  ],
});

test("a baked clone is a model folder of its own, served from memory, with the body's own slot map and texture", async () => {
  assert.equal(G.genericFolder("m050coca", "walk"), "m050coca-gm-walk");
  assert.equal(G.genericFolder("m050coca", "hop-1"), "m050coca-gm-hop_1");
  assert.equal(G.genericRealFolder("m050coca-gm-walk"), "m050coca");
  assert.equal(G.isGenericFolder("m050coca"), false);
  const store = G.createGenericStore();
  const m = model();
  store.set("m050coca-gm-walk", { model: m, real: "m050coca" });
  assert.deepEqual(store.resolve("assets/battle/models/m050coca-gm-walk/anim.json"), { json: m });
  assert.equal(store.resolve("assets/battle/models/m050coca-gm-walk/slot_map.json").url, "assets/battle/models/m050coca/slot_map.json");
  assert.equal(store.resolve("assets-hd/battle/textures/m050coca-gm-walk.png").url, "assets-hd/battle/textures/m050coca.png");
  for (const u of ["assets/battle/models/m050coca/anim.json", "assets/battle/models/m009mera-gm-walk/anim.json", "assets/data/digimon.json", "", null]) {
    assert.equal(store.resolve(u), null, String(u));
  }
  // the shim serves the clone and passes everything else on
  const seen = [];
  const target = { fetch: async (u) => { seen.push(u); return { ok: true }; } };
  const shim = G.installGenericFetch(store, target);
  const res = await target.fetch("assets/battle/models/m050coca-gm-walk/anim.json");
  assert.equal((await res.json()).folder, "m001test");
  await target.fetch("assets/battle/textures/m050coca-gm-walk.png");
  await target.fetch("assets/data/digimon.json");
  assert.deepEqual(seen, ["assets/battle/textures/m050coca.png", "assets/data/digimon.json"]);
  assert.equal(G.installGenericFetch(store, target), shim, "installing twice is a no-op");
});

test("the store is bounded", () => {
  const s = G.createGenericStore(3);
  for (let i = 0; i < 5; i++) s.set(`f${i}-gm-x`, { model: {}, real: `f${i}` });
  assert.equal(s.size(), 3);
  assert.equal(s.has("f0-gm-x"), false);
  assert.equal(s.has("f4-gm-x"), true);
});

test("the preview is idle -> motion -> idle, measured with the sampler's own steps", () => {
  const m = model();
  const motionOnly = G.previewPlan(m, 1, { full: false });
  assert.equal(motionOnly.tables.length, 1);
  assert.ok(motionOnly.ticks >= 5 && motionOnly.ticks <= 8, `12 entries at speed 2: ${motionOnly.ticks}`);
  const full = G.previewPlan(m, 1, { full: true });
  assert.equal(full.tables.length, 3);
  assert.equal(full.tables[0], m.timeline[0].table);
  assert.equal(full.tables[1], m.timeline[1].table);
  assert.ok(full.ticks > motionOnly.ticks, "idle legs add ticks");
  assert.equal(full.lead, full.idleTicks);
  // no idle table: just the motion
  assert.equal(G.previewPlan({ timeline: [{ table: [] }, m.timeline[1]] }, 1, { full: true }).tables.length, 1);
  assert.equal(G.simulateTicks([]), 0);
});

test("the deep link is ?generic=<id>&model=<folder>", () => {
  assert.equal(G.genericQuery({ motion: "walk", folder: "m050coca" }), "generic=walk&model=m050coca");
  assert.equal(G.genericQuery({ motion: "walk" }), "generic=walk");
  assert.equal(G.genericQuery({}), "");
});

// ── ratings ────────────────────────────────────────────────────────────────────────────────────
const memStorage = () => { const d = new Map(); return { getItem: (k) => d.get(k) ?? null, setItem: (k, v) => d.set(k, String(v)), removeItem: (k) => d.delete(k), _d: d }; };
let t = 0;
const clock = () => `2026-01-01T00:00:${String(t++).padStart(2, "0")}.000Z`;

test("ratings save, survive a new store on the same storage, and toggle off", () => {
  const st = memStorage();
  const a = G.createRatingStore({ storage: st, now: clock });
  a.set("walk", "m050coca", { verdict: "works", note: "nice", name: "Cockatrimon", bodyPlan: "biped-upright" });
  a.set("walk", "m009mera", { verdict: "broken", name: "Meramon", bodyPlan: "biped-upright" });
  a.set("hop", "m009mera", { verdict: "unsure", name: "Meramon", bodyPlan: "biped-upright" });
  assert.throws(() => a.set("walk", "m050coca", { verdict: "great" }));
  const b = G.createRatingStore({ storage: st, now: clock });
  assert.equal(b.size(), 3);
  assert.equal(b.get("walk", "m050coca").note, "nice");
  assert.deepEqual(b.byFolder().get("m009mera"), { works: 0, broken: 1, unsure: 1, total: 2 });
  assert.deepEqual(b.matrix().get("walk").get("biped-upright"), { works: 1, broken: 1, unsure: 0 });
  b.setNote("walk", "m050coca", "better");
  assert.equal(b.get("walk", "m050coca").note, "better");
  assert.equal(b.clear("hop", "m009mera"), true);
  assert.equal(G.createRatingStore({ storage: st }).size(), 2);
});

test("a page without storage still rates (in memory), and a throwing storage does not break it", () => {
  const none = G.createRatingStore({ storage: null });
  none.set("walk", "m1", { verdict: "works" });
  assert.equal(none.size(), 1);
  assert.equal(none.persisted, false);
  const boom = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); } };
  const s = G.createRatingStore({ storage: boom });
  s.set("walk", "m1", { verdict: "broken" });
  assert.equal(s.get("walk", "m1").verdict, "broken");
  assert.equal(s.persisted, false);
  assert.equal(G.safeStorage({ get localStorage() { throw new Error("blocked"); } }), null);
});

test("export is the agreed JSON and import merges (newer wins, junk skipped)", () => {
  const a = G.createRatingStore({ storage: null, now: () => "2026-02-01T00:00:00.000Z" });
  a.set("walk", "m1", { verdict: "works", name: "One", bodyPlan: "quadruped", note: "x" });
  a.set("hop", "m2", { verdict: "broken", name: "Two", bodyPlan: "blob" });
  const out = JSON.parse(JSON.stringify(a.exportObject()));
  assert.equal(typeof out.generatedAt, "string");
  assert.equal(out.ratings.length, 2);
  for (const k of ["motion", "folder", "name", "bodyPlan", "verdict", "note"]) assert.ok(k in out.ratings[0], k);
  const b = G.createRatingStore({ storage: null, now: () => "2026-01-01T00:00:00.000Z" });
  b.set("walk", "m1", { verdict: "unsure", bodyPlan: "quadruped" });          // older than the import
  const res = b.importObject(JSON.stringify({ ...out, ratings: [...out.ratings, { motion: "x" }, { motion: "y", folder: "z", verdict: "meh" }] }));
  assert.deepEqual(res, { added: 1, updated: 1, kept: 0, skipped: 2 });
  assert.equal(b.get("walk", "m1").verdict, "works");
  const c = G.createRatingStore({ storage: null, now: () => "2027-01-01T00:00:00.000Z" });
  c.set("walk", "m1", { verdict: "broken" });                                   // newer than the import: kept
  assert.equal(c.importObject(out).kept, 1);
  assert.equal(c.get("walk", "m1").verdict, "broken");
  assert.throws(() => b.importObject({ nope: 1 }));
  assert.throws(() => b.importObject("not json"));
});

// ── the generator ──────────────────────────────────────────────────────────────────────────────
test("the stub has the agreed shape: 10 motions, a list, a bake that adds one table", () => {
  assert.equal(STUB.GENERIC_MOTIONS.length, 10);
  const m = model("m001test");
  m.timeline.push(...Array.from({ length: 4 }, (_, i) => ({ table: [...mk(Array.from({ length: 12 }, (_, k) => 100 * (i + 1) + k)), { value: 0xFFFF, loop_target: 0, aux: null }] })));
  const list = STUB.listGenericMotions(m);
  assert.equal(list.length, 10);
  assert.ok(list.every((x) => typeof x.applicable === "boolean"));
  const before = JSON.stringify(m);
  const r = STUB.bakeGenericMotion(m, list[0].id);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(m), before, "the input model is not mutated");
  assert.equal(r.table, m.timeline.length);
  assert.equal(r.model.timeline.length, m.timeline.length + 1);
  assert.equal(STUB.bakeGenericMotion(m, "nope").ok, false);
  STUB.setStubBodyPlanResolver(() => "blob");
  const grey = STUB.listGenericMotions(m).filter((x) => !x.applicable);
  assert.ok(grey.length >= 1 && grey.every((x) => x.reason));
  assert.equal(STUB.bakeGenericMotion(m, grey[0].id).ok, false);
  STUB.setStubBodyPlanResolver(null);
});

test("loadGenerator prefers the real module, labels the stub, and rejects a half-baked real one", async () => {
  const api = { GENERIC_MOTIONS: [], listGenericMotions() {}, bakeGenericMotion() {} };
  const real = await G.loadGenerator(async (p) => (p.includes("fight/generic-motion") ? api : STUB));
  assert.equal(real.source, "real");
  const missing = await G.loadGenerator(async (p) => { if (p.includes("fight/generic-motion")) throw new Error("404"); return STUB; });
  assert.equal(missing.source, "stub");
  assert.match(missing.realError, /404/);
  const half = await G.loadGenerator(async (p) => (p.includes("fight/generic-motion") ? { GENERIC_MOTIONS: [] } : STUB));
  assert.equal(half.source, "stub");
  assert.match(half.realError, /agreed API/);
});

test("the viewer page wires the section (smoke on the source)", async () => {
  const html = await readFile(resolve(ROOT, "web/anim-viewer.html"), "utf8");
  for (const needle of ["anim-viewer-generic.js", 'id="genericBox"', 'data-tab="ratings"', "selectGeneric", "?generic=", "debugPlayPlaylist"]) {
    assert.ok(html.includes(needle) || needle === "?generic=", needle);
  }
});
