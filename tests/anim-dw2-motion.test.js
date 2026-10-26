// K22c — the generated DW2-motion swap: the clip map, the merge, and the hook.
//
// What is asserted here is the part that must never drift: the clip-slot table covers every slot the
// technique/item machines can name, the merge appends keys WITHOUT touching the model's own motion,
// and the hook is invisible when it is off and changes ONLY the body table when it is on (same hit
// count, same reactions, same projectile records, same camera).
import test from "node:test";
import assert from "node:assert/strict";

const CLIPMAP = await import("../web/fight/dw2-clip-map.js");
const DW2 = await import("../web/fight/dw2-motion.js");
const CF = await import("../web/fight/clip-fallback.js");
const FT = await import("../web/fight/fight-tables.js");

const { DW2_CLIP_MAP, DW2_CAST_LETTERS, dw2LetterForSlot, DW2_MOTION_LETTERS } = CLIPMAP;

// ── a synthetic model: two bones, its own 2-frame motion and one authored clip 5 ────────────────
function model() {
  return {
    folder: "mTEST",
    num_bones: 2,
    total_frames: 120,
    bones: [
      { parent_slot: 0, anim: { ch1: [[0, 0, 0, 0], [0, 0, 0, 30000]], ch2: [[0, 0, 0, 0], [0, 0, 0, 30000]] } },
      { parent_slot: 1, anim: { ch1: [[10, 0, 0, 0], [10, 0, 0, 30000]], ch2: [[100, 0, 0, 0], [200, 0, 0, 60], [200, 0, 0, 30000]] } },
    ],
    timeline: [
      { table: [{ value: 0 }, { value: 60 }] },
      { table: [{ value: 0 }] },
      { table: [{ value: 0 }, { value: 60 }] },
    ],
    actions: {
      5: { ops: [{ op: 3, words: [1, 9999] }, { op: 2, words: [0, 0, 2] }, { op: 11, words: [30] },
                 { op: 10, words: [99, 0] }, { op: 3, words: [0, 2, 0, -896, 5120] }, { op: 1, words: [0] },
                 { op: 2, words: [0, 0, 1] }, { op: 255, words: [] }] },
    },
  };
}

function generated(letter = "A", table = 128, kind = "idle") {
  return {
    v: 1, folder: "mTEST", dw2: "dw2_TEST", motions: {
      [letter]: {
        letter, kind, table, offset: 6000, rootBone: 0, lo: 6000, hi: 6005, frames: 6, used: true,
        gateSource: "test", gate: { covered: 0.9, ankle: 0.01 },
        keys: {
          0: [[0, 0, 0, 6000], [0, 0, 0, 6005]],
          1: [[300, 0, 0, 6000], [700, 0, 0, 6005]],
        },
        ch1: [[0, 0, 0, 6000], [0, 5, 0, 6005]],
        playlist: [{ value: 6000 }, { value: 6003 }, { value: 6005 }],
      },
    },
  };
}

// ── the clip map ───────────────────────────────────────────────────────────────────────────────
test("every clip slot the technique/item machines name has a mapping row", () => {
  // the slots the disc's own tables name: techs (5,6,8,9,10,11,13,15,16) + reactions 1..4 +
  // items (10,14,15,17) + the idle
  for (const slot of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17]) {
    const row = DW2_CLIP_MAP[slot];
    assert.ok(row, `slot ${slot} has no row`);
    assert.ok(Array.isArray(row.letters), `slot ${slot} has no letters`);
    assert.ok(row.letters.length > 0, `slot ${slot} maps to no DW2 motion`);
    if (slot === 0) continue;   // the idle is never a gap: every model owns slot 0, so A is not exported
    for (const L of row.letters) assert.ok(DW2_MOTION_LETTERS.includes(L), `${L} is not baked`);
  }
  assert.equal(DW2_CLIP_MAP[12].letters.length, 0, "clip 12 is the presentation actor's, not the model's");
});

test("the cast family is chosen by the technique's cast type; the signature by its category", () => {
  assert.deepEqual(DW2_CAST_LETTERS, ["F", "G", "H"]);
  assert.equal(dw2LetterForSlot(9, { castType: 0 }), "F");
  assert.equal(dw2LetterForSlot(9, { castType: 1 }), "G");
  assert.equal(dw2LetterForSlot(9, { castType: 2 }), "H");
  assert.equal(dw2LetterForSlot(13, { castType: 2 }), "H");
  // DW2 plays EVERY technique as F/G/H by cast type; I is its victory pose (~/dw3-knowledge/dw2-clips.md)
  assert.equal(dw2LetterForSlot(5), "F");
  assert.equal(dw2LetterForSlot(5, { castType: 2 }), "H");
  assert.equal(dw2LetterForSlot(11, { magical: false, castType: 1 }), "G");
  assert.equal(dw2LetterForSlot(11, { magical: true, castType: 1 }), "G");
  assert.equal(dw2LetterForSlot(2), "C2J", "hit and survive = C0,C1,C2,J");
  assert.equal(dw2LetterForSlot(3), "C2K", "hit and die = C0,C1,C2,K");
  assert.equal(dw2LetterForSlot(4), "B", "the guard");
  assert.equal(dw2LetterForSlot(10), "I", "item use = the victory gesture");
  assert.equal(dw2LetterForSlot(12), null);
});

// ── the merge ──────────────────────────────────────────────────────────────────────────────────
test("merging a generated motion appends keys and never disturbs the model's own track", () => {
  const m = model();
  const ownCh2 = JSON.parse(JSON.stringify(m.bones[1].anim.ch2));
  const ownCh1 = JSON.parse(JSON.stringify(m.bones[0].anim.ch1));
  DW2.applyDw2Motion(m, generated("C0", 128, "flinch"));
  // the model's own keys are still there, in order, followed by the appended ones and ONE terminator
  assert.deepEqual(m.bones[1].anim.ch2.slice(0, ownCh2.length - 1), ownCh2.slice(0, -1));
  const tail = m.bones[1].anim.ch2.slice(ownCh2.length - 1);
  assert.deepEqual(tail.slice(-1), [[700, 0, 0, 30000]]);
  assert.deepEqual(tail[0], [300, 0, 0, 6000]);
  assert.deepEqual(m.bones[0].anim.ch1.slice(0, ownCh1.length - 1), ownCh1.slice(0, -1));
  assert.equal(m.bones[0].anim.ch1.at(-1)[3], 30000);
  // the playlist table is registered at the motion's table index and points into the appended range
  assert.deepEqual(m.timeline[128].table.map((e) => e.value), [6000, 6003, 6005]);
  assert.deepEqual(m.dw2Motion.C0, { table: 128, kind: "flinch", lo: 6000, hi: 6005, letter: "C0", hit: null });
  // a refused motion carries no keys and must not be merged
  const m2 = model();
  DW2.applyDw2Motion(m2, { motions: { C0: { ...generated("C0").motions.C0, used: false } } });
  assert.equal(m2.dw2Motion, undefined);
});

test("a table index the model already owns is never overwritten", () => {
  const m = model();
  m.timeline[128] = { table: [{ value: 1 }, { value: 2 }] };
  const r = DW2.applyMotion(m, "A", generated().motions.A);
  assert.equal(r, null);
  assert.deepEqual(m.timeline[128].table, [{ value: 1 }, { value: 2 }]);
});

// ── the hook ──────────────────────────────────────────────────────────────────────────────────
test("the swap is OFF by default: a registered file changes nothing", () => {
  const m = model();
  DW2.registerDw2Motion("mTEST", generated("A", 128, "idle"));
  DW2.applyDw2Motion(m, generated("A", 128, "idle"));          // merged in, but the scope is off
  assert.equal(DW2.dw2MotionEnabled(), false);
  assert.equal(DW2.dw2MotionFor(m, 5), null);
  const script = CF.resolveClipScript(m, 5, { tech: 1 });
  assert.deepEqual(script, m.actions[5], "with the scope off the model's own clip is returned as-is");
});

test("a clip the model OWNS is never replaced, even with the swap on", () => {
  // the operator's rule: DW2 motion fills a gap, it does not restyle an authored clip
  const m = model();
  DW2.applyDw2Motion(m, generated("F", 129, "cast"));
  DW2.setDw2MotionEnabled(true);
  try {
    const base = { ops: [{ op: 2, words: [0, 0, 2] }, { op: 11, words: [20] }, { op: 255, words: [] }] };
    assert.equal(CF.withDw2Body(m, base, 5), base, "slot 5 is owned, so the body is untouched");
    // and through the public entry point
    assert.deepEqual(CF.resolveClipScript(m, 5, { tech: 1 }), m.actions[5]);
    // a gap slot (6 has no own script on this model) takes it
    const gap = CF.withDw2Body(m, base, 6);
    assert.equal(gap.dw2Motion?.letter, "F");
    assert.equal(gap.ops.find((o) => o.op === 2).words[2], 129);
  } finally {
    DW2.setDw2MotionEnabled(false);
  }
});

test("the swap is a URL scope: ?dw2motion=1 turns it on, and only for the slots the file covers", () => {
  assert.equal(DW2.dw2MotionFlagFromUrl("?dw2motion=1"), true);
  assert.equal(DW2.dw2MotionFlagFromUrl("?foo=1"), false);
  const m = model();
  DW2.applyDw2Motion(m, generated("F", 129, "cast"));
  DW2.setDw2MotionEnabled(true);
  try {
    assert.equal(DW2.dw2MotionFor(m, 5)?.letter, "F");
    assert.equal(DW2.dw2MotionFor(m, 3), null, "a slot the file has no motion for stays as it was");
    assert.equal(DW2.dw2SlotCount(m), 10, "the slots whose letters include F: 5,6,7,8,9,11,13,14,15,16");
  } finally {
    DW2.setDw2MotionEnabled(false);
  }
});

test("on, only the BODY changes: hit count, reactions, spark and camera are today's", () => {
  const m = model();
  DW2.applyDw2Motion(m, generated("F", 129, "cast"));
  const base = {
    ops: [
      { op: 3, words: [1, 9999] }, { op: 2, words: [0, 0, 2] }, { op: 11, words: [30] },
      { op: 6, words: [0, 220, 0, 0, 0, 0, 2048, 0] },
      { op: 10, words: [98, 0] }, { op: 1, words: [5] },
      { op: 10, words: [99, 0] }, { op: 3, words: [0, 9999, 0, -896, 5120] }, { op: 1, words: [0] },
      { op: 2, words: [0, 0, 1] }, { op: 255, words: [] },
    ],
    synthesized: true,
  };
  DW2.setDw2MotionEnabled(true);
  try {
    const sw = CF.withDw2Body(m, base, 6);              // slot 6 is a gap on this model
    const binds = (ops) => ops.filter((o) => o.op === 2 && (o.words[2] | 0) > 1);
    assert.equal(binds(sw.ops).length, 1, "one body bind");
    assert.equal(binds(sw.ops)[0].words[2], 129, "and it is the baked DW2 table");
    const count = (ops, op) => ops.filter((o) => o.op === op).length;
    for (const op of [10, 1, 3, 11, 6]) assert.equal(count(sw.ops, op), count(base.ops, op), `op${op} records kept`);
    assert.equal(sw.dw2Motion.letter, "F");
    // the return-to-base and the terminator survive
    assert.ok(sw.ops.some((o) => o.op === 2 && (o.words[2] | 0) === 1));
    assert.equal(sw.ops.at(-1).op, 255);
  } finally {
    DW2.setDw2MotionEnabled(false);
  }
});

test("a reaction body gets the whole motion; an attack body keeps the disc's timing", () => {
  const m = model();
  const g = generated("C2K", 130, "death");
  g.motions.C2K.frames = 46;
  g.motions.C2K.hi = 6045;
  g.motions.C2K.playlist = Array.from({ length: 46 }, (_, i) => ({ value: 6000 + i }));   // the pad counts table ENTRIES (playback is per entry)
  DW2.applyDw2Motion(m, g);
  const base = { ops: [{ op: 2, words: [0, 0, 2] }, { op: 11, words: [10] }, { op: 2, words: [0, 0, 1] }, { op: 255, words: [] }] };
  DW2.setDw2MotionEnabled(true);
  try {
    const death = CF.withDw2Body(m, base, 3);
    assert.equal(death.ops.filter((o) => o.op === 11).length, 2, "one wait of the base, one padded tail");
    assert.ok(death.ops.some((o) => o.op === 11 && o.words[0] >= 30), "the tail covers the 46-frame motion");
    const atk = CF.withDw2Body(m, base, 3, {});
    assert.equal(atk.ops.filter((o) => o.op === 11).length, 2);
  } finally {
    DW2.setDw2MotionEnabled(false);
  }
});

test("cast slots take the letter the technique's cast type names", () => {
  const m = model();
  const g = generated("A", 131, "idle");
  g.motions.G = { ...g.motions.A, letter: "G", table: 132, kind: "cast" };
  DW2.applyDw2Motion(m, g);
  DW2.setCastTypes({ bySkill: { 7: 1 } });
  DW2.setDw2MotionEnabled(true);
  try {
    assert.equal(DW2.castTypeFor(7), 1);
    assert.equal(DW2.dw2MotionFor(m, 9, { tech: 7 })?.letter, "G");
    // an unknown technique is cast type 0 -> the F family; this file carries none, so no swap (the
    // slot falls back to today's build rather than to a wrong body)
    assert.equal(DW2.dw2MotionFor(m, 9, { tech: 999 }), null);
  } finally {
    DW2.setDw2MotionEnabled(false);
    DW2.setCastTypes(null);
  }
});

test("the technique table's own clip really names the slot the map keys on", () => {
  // a guard against a mapping that drifts from the engine: the basic/signature partition the repo
  // ships must land on slots 5 and 11, which the map covers with a body the batch build bakes
  assert.equal(FT.techToClip(1), 5);
  assert.equal(FT.techToClip(60), 11);
  for (const slot of [FT.techToClip(1), FT.techToClip(60), FT.REACTION_HIT_CLIP, FT.REACTION_DEATH_CLIP, FT.ITEM_USE_CLIP]) {
    assert.ok(DW2_CLIP_MAP[slot], `the engine plays slot ${slot}, which the map must cover`);
  }
});
