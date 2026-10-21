// K21f — the "DW3 body + DW2 motion" bake source of the animation viewer.
//
// The interesting half is arithmetic, so it is tested without a browser: the asset-URL rewrite that
// lets battle3d's ordinary model loader read a bake, the manifest normalisation, the op2 script that
// plays one baked timeline table, and the Info-tab rows built from K21d's measurements.
//
// The other half is data: when the local dev mount exists (~/dw2-models/converted/bakes) every bake
// the manifest lists is opened and checked against its own report row — the baked table must be the
// one the row names, with the row's frame count and window.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";

const ROOT = resolve(import.meta.dirname, "..");
const BAKES = process.env.BAKES_DIR || join(homedir(), "dw2-models", "converted", "bakes");
const exists = (p) => access(p).then(() => true, () => false);

const {
  mapBakeAssetUrl, isBakeFolder, bakeRealFolder, bakeLetter, bakeUrl, bakeIndexUrl,
  bakeRows, bakeStubRow, bakeScript, bakeActions, bakeInfoRows, bakeQuery, bakeActions: actions,
  K21D_BAKES, BAKE_ROOT, installBakeFetch,
} = await import("../web/anim-viewer-bake.js");

// ── the URL rewrite ─────────────────────────────────────────────────────────────────────────────
test("a bake folder is <body>-dw2<letter> and nothing else", () => {
  assert.equal(isBakeFolder("m050coca-dw2F"), true);
  assert.equal(isBakeFolder("m009mera-dw2K"), true);
  assert.equal(isBakeFolder("m050coca"), false);
  assert.equal(isBakeFolder("dw2bake:m050coca"), false, "the renderer's folder is the bake id itself");
  assert.equal(isBakeFolder("m050coca-dw2FF"), false);
  assert.equal(isBakeFolder("m050coca-dw2"), false);
  assert.equal(bakeRealFolder("m050coca-dw2F"), "m050coca");
  assert.equal(bakeLetter("m050coca-dw2F"), "F");
  assert.equal(bakeRealFolder("nope"), null);
});

test("the three model assets of a bake map to the bake file and the body's own files", () => {
  assert.equal(mapBakeAssetUrl("assets/battle/models/m050coca-dw2F/anim.json"), `${BAKE_ROOT}/m050coca-dw2F.json`);
  assert.equal(mapBakeAssetUrl("assets/battle/models/m050coca-dw2F/slot_map.json"), "assets/battle/models/m050coca/slot_map.json");
  assert.equal(mapBakeAssetUrl("assets/battle/textures/m050coca-dw2F.png"), "assets/battle/textures/m050coca.png");
  // HD-pack mode keeps its prefix, an absolute request keeps its origin
  assert.equal(mapBakeAssetUrl("assets-hd/battle/textures/m009mera-dw2I.png"), "assets-hd/battle/textures/m009mera.png");
  assert.equal(mapBakeAssetUrl("http://127.0.0.1:8110/assets/battle/models/m050coca-dw2G/anim.json"),
    `http://127.0.0.1:8110/${BAKE_ROOT}/m050coca-dw2G.json`);
});

test("every other URL is left alone (null = pass the request through)", () => {
  for (const url of [
    "assets/battle/models/m050coca/anim.json",          // the disc's own model
    "assets/battle/textures/m050coca.png",
    "assets/data/digimon.json",
    `${BAKE_ROOT}/m050coca-dw2F.json`,                  // the bake file itself must not be rewritten
    "assets/battle/models/m050coca/slot_map.json",
    "",
    null,
  ]) assert.equal(mapBakeAssetUrl(url), null, String(url));
});

test("the fetch shim rewrites bake requests and passes everything else to the original", async () => {
  const seen = [];
  const fake = async (url) => { seen.push(url); return { ok: true, url }; };
  const target = { fetch: fake };
  const shim = installBakeFetch(target);
  assert.equal(shim.__bakeShim, true);
  await target.fetch("assets/battle/models/m050coca-dw2F/anim.json");
  await target.fetch("assets/data/digimon.json");
  assert.deepEqual(seen, [`${BAKE_ROOT}/m050coca-dw2F.json`, "assets/data/digimon.json"]);
  assert.equal(shim.hits.length, 1, "the shim counts what it rewrote");
  assert.equal(installBakeFetch(target), shim, "installing twice is a no-op");
});

// ── the manifest ───────────────────────────────────────────────────────────────────────────────
const MANIFEST = {
  bakes: [
    { id: "m050coca-dw2F", folder: "m050coca", letter: "F", clip: 9, table: 5, frames: 61,
      gate: { used: false, reasons: ["speed", "ankle"], covered: 0.611, hand: 1, energy: 1.56, folds: 0, speed: 3.62, ankle: 0.128, returnGap: 1.5, motion: 1.86 },
      feet: [{ side: "left", dyShare: 0.075, dxzShare: 0.309 }], ground: { belowRestH: 0.097, aboveRestH: 0.022 },
      penetration: { worstClearanceH: -0.148, toleranceH: -0.367, framesOverOwnH: 35, ofFrames: 61, worstPair: "root/extra" },
      jump: { clip: 0.62, atFrame: 6333, bone: 12, targetOwn: 0.494 }, donor: { step: 0.749, ankle: [] } },
    { folder: "m009mera-dw2I", letter: "I", clip: 5, table: 9 },
    { id: "not-a-bake", folder: "x" },
  ],
};

test("bakeRows keeps only real bake ids and fills folder/letter from the id", () => {
  const rows = bakeRows(MANIFEST);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "m050coca-dw2F");
  assert.equal(rows[1].id, "m009mera-dw2I");
  assert.equal(rows[1].folder, "m009mera");
  assert.equal(rows[1].letter, "I");
  assert.deepEqual(bakeRows(null), []);
  assert.deepEqual(bakeRows({}), []);
});

test("bakeStubRow gives a deep link the folder and letter without any numbers", () => {
  const s = bakeStubRow("m050coca-dw2H");
  assert.equal(s.folder, "m050coca");
  assert.equal(s.letter, "H");
  assert.equal(s.table, null);
  assert.equal(s.stub, true);
  assert.equal(bakeStubRow("m050coca"), null);
});

test("the A/B pair is one baked table plus the body's own clip", () => {
  const [row] = bakeRows(MANIFEST);
  const acts = bakeActions(row);
  assert.equal(acts.length, 2);
  assert.deepEqual(acts.map((a) => a.kind), ["bake", "own"]);
  assert.equal(acts[0].table, 5);
  assert.equal(acts[0].clip, 9);
  assert.equal(acts[1].clip, 9);
  assert.match(acts[0].name, /DW2-F/);
  assert.match(acts[0].name, /table 5/);
  assert.equal(actions(bakeStubRow("m050coca-dw2F")).length, 0, "a stub has no numbers, so no pair");
});

test("the baked table is played by the actor's own ActionVM (op2 [0,0,table] then the terminator)", () => {
  const s = bakeScript(5);
  assert.deepEqual(s.ops, [{ op: 2, words: [0, 0, 5] }, { op: 255, words: [] }]);
  assert.equal(s.buildKind, "bake");
  assert.deepEqual(bakeScript(null).ops, []);
});

test("the Info rows carry K21d's gate verdict and feet drift, and drop what the manifest lacks", () => {
  const [row] = bakeRows(MANIFEST);
  const rows = bakeInfoRows(row);
  const byKey = new Map(rows.map(([k, v, cls]) => [k, { v, cls }]));
  assert.match(byKey.get("bake").v, /m050coca-dw2F/);
  assert.match(byKey.get("baked motion").v, /clip 9 · table 5 · 61 frames/);
  assert.equal(byKey.get("castGate").cls, "bad");
  assert.match(byKey.get("castGate").v, /REFUSE: speed, ankle/);
  assert.match(byKey.get("feet drift").v, /left y 0\.075 \/ lateral 0\.309 H/);
  assert.match(byKey.get("penetration").v, /35\/61/);
  assert.match(byKey.get("worst pose jump").v, /bone 12/);
  assert.ok(byKey.get("donor's own motion"));
  assert.deepEqual(bakeInfoRows(bakeStubRow("m050coca-dw2F")).map((r) => r[0]), ["bake", "DW3 body"]);
});

test("the deep link is ?bake=<id>&table=<n>", () => {
  assert.equal(bakeQuery({ id: "m050coca-dw2F", table: 5 }), "bake=m050coca-dw2F&table=5");
  assert.equal(bakeQuery({ id: "m050coca-dw2F" }), "bake=m050coca-dw2F");
  assert.equal(bakeQuery({}), "");
  assert.equal(bakeUrl("m050coca-dw2F"), `${BAKE_ROOT}/m050coca-dw2F.json`);
  assert.equal(bakeIndexUrl(BAKE_ROOT), `${BAKE_ROOT}/index.json`);
  assert.equal(K21D_BAKES.length, 5);
});

// ── the real dev-only data, when it is mounted ─────────────────────────────────────────────────
const haveBakes = await exists(join(BAKES, "index.json"));
test("the served manifest matches the bake files (dev mount)", { skip: !haveBakes && "no ~/dw2-models/converted/bakes/index.json" }, async () => {
  const manifest = JSON.parse(await readFile(join(BAKES, "index.json"), "utf8"));
  const rows = bakeRows(manifest).filter((r) => /-dw2[A-Z]$/.test(r.id)); // newly authored motions (-gen*) are listed too
  assert.equal(rows.length, 5, "K21d wrote five bakes");
  for (const row of rows) {
    assert.equal(await exists(join(BAKES, `${row.id}.json`)), true, row.id);
    const bake = JSON.parse(await readFile(join(BAKES, `${row.id}.json`), "utf8"));
    assert.equal(bake.folder, row.folder, `${row.id} carries its body's folder`);
    assert.ok(Array.isArray(bake.bones) && bake.bones.length, `${row.id} has a DW3 skeleton`);
    assert.ok(Array.isArray(bake.bones[0].verts) && bake.bones[0].verts.length, `${row.id} carries the disc geometry`);
    assert.ok(Array.isArray(bake.bones[0].anim.ch1), `${row.id} carries DW3 channels`);
    // the one table the retarget wrote must be the row's table, with the row's window
    const table = (bake.timeline[row.table] || {}).table || [];
    const frames = table.map((e) => e.value).filter((v) => v !== 0xFFFF);
    assert.equal(frames.length, row.frames, `${row.id} table ${row.table} frame count`);
    assert.equal(frames[0], row.bakeTableWindow[0]);
    assert.equal(frames[frames.length - 1], row.bakeTableWindow[1]);
    // and it must be the ONLY table that differs from the disc model — that is what makes the A/B honest
    const target = JSON.parse(await readFile(join(ROOT, "web/assets/battle/models", row.folder, "anim.json"), "utf8"));
    const differing = bake.timeline.map((t, i) => (JSON.stringify(t) === JSON.stringify(target.timeline[i]) ? null : i)).filter((i) => i != null);
    assert.deepEqual(differing, [row.table], `${row.id} adds exactly one table`);
  }
});
