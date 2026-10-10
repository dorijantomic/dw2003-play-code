// Regression pin for the census-wide native-interpreter run: every stage in
// web/assets/native/ must boot through its real root ctor and tick 120 frames
// with ZERO fail-soft traps. A new trap = a stub/decode regression; fixing a
// stage that used to trap is always allowed (this only asserts cleanliness).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native");
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
const exeTables = JSON.parse(readFileSync(join(dir, "exe_tables.json"), "utf8"));
const fieldstg = new Uint8Array(readFileSync(join(dir, "fieldstg.bin")));

const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });

test("every native-ambience stage boots and ticks 120 frames with zero traps", () => {
  const dirty = [];
  let clean = 0;
  for (const [stage, entry] of Object.entries(manifest)) {
    if (entry.root_ctor < 0) continue;
    const overlay = new Uint8Array(readFileSync(join(dir, `${stage}.bin`)));
    const rt = new NativeStageRuntime(overlay, entry, host(), exeTables, fieldstg);
    const booted = rt.boot();
    if (booted) for (let f = 0; f < 120; f++) rt.tick(1);
    if (!booted || rt.disabled.length > 0) {
      dirty.push({ stage, boot: booted, traps: rt.disabled.map((d) => d.reason) });
    } else {
      clean++;
    }
  }
  assert.deepEqual(dirty, [], "stages with fail-soft traps");
  assert.ok(clean >= 75, `expected the full census to stay clean, got ${clean}`);
});

test("s780 broadcast: fireEffect(0x320) spawns street life (cars drawn every frame)", () => {
  const entry = manifest.s780;
  const overlay = new Uint8Array(readFileSync(join(dir, "s780.bin")));
  const rt = new NativeStageRuntime(overlay, entry, host(), exeTables, fieldstg);
  assert.ok(rt.boot());
  assert.ok(rt.fireEffect(0x320, 1), "broadcast-on effect consumed");
  let carFrames = 0;
  for (let f = 0; f < 300; f++) {
    rt.drawCalls.length = 0;
    rt.tick(1);
    if (rt.drawCalls.some((c) => c.method === "drawSprite")) carFrames++;
  }
  assert.equal(rt.disabled.length, 0, JSON.stringify(rt.disabled));
  assert.ok(carFrames > 250, `cars drawn most frames, got ${carFrames}/300`);
  assert.ok(rt.fireEffect(0x324, 0), "broadcast-off effect consumed");
});

test("s421 windmill actor: flag 0x1a0a gates the tagged point records' anim mode", () => {
  // Decoded 2026-07-10 (stage-coverage burndown): the overlay-base actor walks
  // the point table and sets mode = get_flag(0x1a0a) on every record whose
  // byte+1 tag is 1 (the 19 Seiryu windmills/fans) — city power on/off.
  for (const flagVal of [0, 1]) {
    const h = { setFlag() {}, getFlag: () => flagVal, rand16: () => 0x777 };
    const overlay = new Uint8Array(readFileSync(join(dir, "s421.bin")));
    const rt = new NativeStageRuntime(overlay, manifest.s421, h, exeTables, fieldstg);
    assert.ok(rt.boot(), "s421 boots");
    for (let f = 0; f < 5; f++) rt.tick(1);
    assert.equal(rt.disabled.length, 0, JSON.stringify(rt.disabled));
    const pt = rt.mem.read32(0x80099d90) >>> 0;
    assert.ok(pt >= 0x800a5de0, "init wrote the point-table pointer");
    const modes = new Set();
    let off = pt, n = 0;
    while (rt.mem.read8(off + 2) !== 0 && n < 64) {
      if (rt.mem.read8(off + 1) === 1) modes.add(rt.mem.read8(off + 5));
      off += 18; n++;
    }
    assert.ok(n >= 35, `walked the full table, got ${n} records`);
    assert.deepEqual([...modes], [flagVal], "tagged records follow the flag");
  }
});

test("s415 special objects: Bulbmon point writes and boulder draw jobs are visible", () => {
  const rt = new NativeStageRuntime(
    new Uint8Array(readFileSync(join(dir, "s415.bin"))),
    manifest.s415,
    host(),
    exeTables,
    fieldstg,
  );
  assert.ok(rt.boot(), "s415 boots");
  const pt = rt.mem.read32(0x80099d90) >>> 0;

  // 811 is the shared point-record actor. The later 817 command starts the
  // Bulbmon roll-in and must move its tagged record away from the inert ROM
  // position (0,-50), where it cannot appear in the viewport.
  assert.ok(rt.fireEffect(811, 816, 1));
  rt.tick(1);
  assert.ok(rt.fireEffect(811, 817, 811));
  for (let i = 0; i < 8; i++) rt.tick(1);
  const bulb = pt + 18;
  assert.deepEqual(
    [rt.mem.read8(bulb), rt.mem.read8(bulb + 4), rt.mem.read16s(bulb + 10), rt.mem.read16s(bulb + 12)],
    [1, 50, 150, 236],
    "Bulbmon record is active and repositioned by native code",
  );
  assert.equal(rt.liveObjects.filter((o) => o.id === 811).length, 1, "effect id lookup reuses the live actor");

  // 816..825 are ten independently placed falling/rolling objects. Their
  // update callbacks enqueue layer jobs; the layer phase must execute the
  // jobs so the sprite draw calls reach the browser renderer.
  for (let id = 816; id <= 825; id++) assert.ok(rt.fireEffect(id, 821, id), `effect ${id}`);
  rt.tick(1); // state-0 initialization
  rt.drawCalls.length = 0;
  rt.tick(1);
  const rocks = rt.drawCalls.filter((c) => c.method === "drawSprite");
  assert.equal(rocks.length, 10, "all ten special objects submit a sprite");
  assert.ok(rocks.every((c) => c.args[1] >= 70 && c.args[1] <= 77), "boulder frames use the extracted stage atlas");
  assert.deepEqual(rt.disabled, [], "s415 special-object path has no traps");
});

test("s212 download SETANIMs claim and animate the native point records", () => {
  const cases = [
    [815, 217, 292, 0x010c0000],
    [826, 257, 272, 0x010c0001],
    [827, 297, 252, 0x010c0002],
  ];
  for (const [anim, x, y, sound] of cases) {
    const played = [];
    const rt = new NativeStageRuntime(
      new Uint8Array(readFileSync(join(dir, "s212.bin"))),
      manifest.s212,
      { ...host(), playPackedSound: (id) => played.push(id) },
      exeTables,
      fieldstg,
    );
    assert.ok(rt.boot(), `s212 boots for ${anim}`);
    const pt = rt.mem.read32(0x80099d90) >>> 0;
    // The shipped download scenes create/prewarm actor 810 with animation 828
    // well before the pad-specific command, so its state-0 tick has completed.
    assert.ok(rt.fireEffect(810, 828, 1));
    rt.tick(1);
    assert.ok(rt.fireEffect(810, anim, 1), `SETANIM 810 ${anim} 1 consumed`);
    for (let i = 0; i < 3; i++) rt.tick(1);

    const tagged = [];
    for (let p = pt; rt.mem.read8(p + 2) !== 0; p += 18) {
      const tag = rt.mem.read8(p + 1);
      if (tag >= 1 && tag <= 3) tagged.push(p);
    }
    assert.equal(tagged.length, 3, "three download layers claimed");
    assert.deepEqual(tagged.map((p) => [rt.mem.read16s(p + 10), rt.mem.read16s(p + 12)]), [[x, y], [x, y], [x, y]]);
    assert.deepEqual(
      [rt.mem.read8(tagged[0]), rt.mem.read8(tagged[0] + 4)],
      [1, 92],
      "beam-open layer is visible",
    );
    assert.equal(rt.sfx.at(-1), sound, "native handler fires the matching DIGI_EN cue");
    assert.equal(played.at(-1), sound, "packed sound reaches the browser host bridge");
    assert.deepEqual(rt.disabled, [], `s212 ${anim} has no traps`);
  }
});

test("soak: high-draw stages survive 3000 frames (scratch-ring wrap regression)", () => {
  // The browser hit a trap only after ~15s: the OT-bucket scratch ring wrapped
  // into the layer objects and a prim writer corrupted a method pointer. A
  // 3000-frame soak cycles the ring many times over.
  for (const stage of ["s780", "s810", "s805"]) {
    const entry = manifest[stage];
    const overlay = new Uint8Array(readFileSync(join(dir, `${stage}.bin`)));
    const rt = new NativeStageRuntime(overlay, entry, host(), exeTables, fieldstg);
    assert.ok(rt.boot(), `${stage} boots`);
    for (let f = 0; f < 3000; f++) {
      rt.drawCalls.length = 0; // per-frame clear, like the browser driver
      rt.tick(1);
    }
    assert.deepEqual(rt.disabled.map((d) => d.reason), [], `${stage} soak traps`);
  }
});
