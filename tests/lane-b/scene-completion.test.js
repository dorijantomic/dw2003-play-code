// Oracle: engine/systems/scene-completion.ts must make exactly the SAME writes as
// every one of the original per-event completion routines.
//
// The original side runs the disc's OWN routine — the word each event record holds
// as its `on_complete_fn` — out of that overlay's own image through engine/native,
// with the one door the routine reaches through a pointer replaced by a recording
// stub: set_flag, whose function-pointer CELL is at 0x80048AC8 (the routine does not
// CALL that address, it loads the pointer out of the cell and jalr's it, so the cell
// must hold the stub). The story step is not a call at all: the routine stores it
// straight into [0x8004B370], so the oracle reads that word back out of memory.
//
// Every routine is run from SEVERAL story states — the step already written, a fresh
// game (0), a step it never writes, and a cleared flag bank — because a completion
// routine must not read the story it advances. A routine whose writes changed with
// the starting state would be a converter-only fiction, and this is where that shows.
//
// The port side runs the same ordered write list from
// web/assets/data/scene/scene_completion.json through runSceneCompletion and must
// produce the same ordered list of (flag, value) writes and the same final story step.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import * as S from "../../engine/systems/scene-completion.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native");
const RESIDENT = new Uint8Array(readFileSync(join(dir, "screens/resident.bin")));
const ORDINAL = 0x8004b370;          // the master story ordinal
const SET_FLAG_CELL = 0x80048ac8;    // the set_flag function-pointer cell
const SELF = 0x80160000;
const OUTP = 0x80160800;
const SET_FLAG_STUB = 0x80163000;
const OVERLAY_BASE = 0x800a5de0;

const raw = JSON.parse(readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data/scene/scene_completion.json"), "utf8"));
S.setSceneCompletions(raw);

/** Build a runtime per overlay image, with set_flag recording into `calls`. */
function makeKit(image) {
  const ENTRY = { size: image.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
  const rt = new NativeStageRuntime(image, ENTRY, { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 },
    undefined, undefined, undefined, { image: RESIDENT, base: 0x80010000 });
  rt.cpu.gp = 0x8005cb50;
  const calls = [];
  rt.cpu.setStub(SET_FLAG_STUB, (c) => {
    calls.push([c.reg(4) >>> 0, c.reg(5) >>> 0]);
    return 0;
  });
  rt.mem.write32(SET_FLAG_CELL, SET_FLAG_STUB);
  return { rt, calls };
}

const stages = Object.entries(raw.stages).sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)));

test("every event's completion routine makes the writes the port makes", () => {
  let runs = 0, writes = 0, steps = 0;
  const diffs = [];
  const skipped = [];
  for (const [mapId, v] of stages) {
    let image;
    try {
      image = new Uint8Array(readFileSync(join(dir, `${mapId}.bin`)));
    } catch {
      skipped.push(`${mapId}: no overlay image`);
      continue;
    }
    const kit = makeKit(image);
    for (const [eventId, row] of Object.entries(v.events)) {
      const ev = Number(eventId);
      const addr = OVERLAY_BASE + parseInt(row.cite.label.slice(4), 16);
      // The starting states a completion routine must be indifferent to.
      const ordinalWrites = row.writes.filter((w) => w.op === "set_ordinal").map((w) => w.value);
      const starts = [...new Set([0, 1, ordinalWrites.length ? ordinalWrites[0] : 0, 0x63])];
      for (const start of starts) {
        runs++;
        kit.calls.length = 0;
        kit.rt.mem.write32(ORDINAL, start >>> 0);
        kit.rt.mem.write32(SELF + 0xc, 0);
        kit.rt.mem.write32(OUTP, 0);
        kit.rt.cpu.call(addr >>> 0, [SELF, OUTP, 0], 100000);

        // What the ORIGINAL wrote: the stub calls, then the story step in memory.
        const got = kit.calls.slice();
        const gotStep = kit.rt.mem.read32(ORDINAL) >>> 0;
        // What the PORT writes.
        const port = S.sceneCompletion(mapId, ev);
        const portFlags = [];
        let portStep = start >>> 0;
        S.runSceneCompletion(port, {
          setFlag: (id, value) => portFlags.push([id >>> 0, value]),
          setOrdinal: (s) => { portStep = s >>> 0; },
        });

        const wantFlags = row.writes.filter((w) => w.op === "set_flag").map((w) => [w.flag, w.value]);
        const wantStep = ordinalWrites.length ? ordinalWrites[ordinalWrites.length - 1] : start >>> 0;
        writes += got.length;
        if (ordinalWrites.length) steps++;
        if (JSON.stringify(got) !== JSON.stringify(wantFlags) || gotStep !== wantStep) {
          diffs.push(`${mapId}/${evId} start=${start}: original flags=${JSON.stringify(got)} step=${gotStep}` +
            ` port flags=${JSON.stringify(wantFlags)} step=${wantStep}`);
        }
      }
    }
  }
  assert.deepEqual(skipped, [], "an overlay image is missing for a stage with completion routines");
  assert.deepEqual(diffs.slice(0, 8), [], `${diffs.length} run(s) differ`);
  assert.ok(runs >= 700, `ladder too small: ${runs} runs`);
  assert.ok(writes > 900, `too few flag writes compared: ${writes}`);
  assert.ok(steps > 100, `too few story-step writes compared: ${steps}`);
});

test("a scene that writes nothing writes nothing (no implicit beat flag)", () => {
  // pro/wstag200.s .L0x000000f8 is the whole of event 50's completion: two flags.
  const row = S.sceneCompletion("s200", 50);
  assert.deepEqual(row.writes, [
    { op: "set_flag", flag: 0x400d, value: 1, cite: row.writes[0].cite },
    { op: "set_flag", flag: 0x7401, value: 1, cite: row.writes[1].cite },
  ]);
  assert.equal(row.shape, "A");
});

test("the story step moves only from the CLOSING event, and only by its own value", () => {
  // s200: event 50 writes two flags and NO step; event 52 writes step 4 and nothing
  // else (pro/wstag200.s .L0x00000144). The store sits in the `jr $ra` delay slot.
  const fifty = S.sceneCompletion("s200", 50);
  const fiftyTwo = S.sceneCompletion("s200", 52);
  assert.equal(fifty.writes.filter((w) => w.op === "set_ordinal").length, 0);
  assert.deepEqual(fiftyTwo.writes.map((w) => w.op), ["set_ordinal"]);
  assert.equal(fiftyTwo.writes[0].value, 4);
  assert.equal(fiftyTwo.shape, "C");

  const step = [];
  S.runSceneCompletion(fifty, { setFlag() {}, setOrdinal: (s) => step.push(s) });
  assert.deepEqual(step, [], "event 50 must not move the story");
  S.runSceneCompletion(fiftyTwo, { setFlag() {}, setOrdinal: (s) => step.push(s) });
  assert.deepEqual(step, [4]);
});

test("the five disc shapes are what the data says, and two routines sit outside them", () => {
  const counts = {};
  const outside = [];
  for (const c of S.sceneCompletions()) {
    counts[c.shape] = (counts[c.shape] ?? 0) + 1;
    assert.equal(S.shapeOf(c.writes), c.shape, `${c.mapId}/${c.event}: shape letter disagrees with its writes`);
    if (!c.shape) outside.push(`${c.mapId}/${c.event}`);
  }
  assert.deepEqual(Object.keys(counts).filter((k) => k !== "null").sort(), ["A", "B", "C", "D", "E"],
    "all five shapes must be represented");
  // three events share the one s400 routine, so four EVENTS sit outside the five shapes
  assert.deepEqual(outside.sort(), ["s400/1507", "s400/1508", "s400/1509", "s420/71"]);
  // s420 writes two flags and THEN the story step; s400 clears five flags at once.
  const s420 = S.sceneCompletion("s420", 71);
  assert.deepEqual(s420.writes.map((w) => w.op), ["set_flag", "set_flag", "set_ordinal"]);
  const s400 = S.sceneCompletion("s400", 1507);
  assert.equal(s400.writes.length, 5);
  assert.ok(s400.writes.every((w) => w.value === 0), "s400's five writes are clears");
});

test("set_flag's bank dispatch: the launcher runs, the roster action runs, 0x7c is inert", () => {
  // Bank 0x74 is the scripted-battle launcher: set_flag's arm starts this stage's
  // rate-0 encounter record and DISCARDS the value (exe/fns.s F0x800165ac, claim
  // ARENA-C011) — the engine keeps pending encounter state separately. Bank 0x70 is the roster action
  // table, so 0x7053 heals and stores nothing. 0x7c0a is outside the desk command indices 0/1.
  const stored = [0x40, 0x1c, 0x80, 0x74];
  const policy = {
    stored: (bank) => stored.includes(bank),
    launchBattle: (i) => { policy.launched = i; },
    rosterAction: (id) => id === 0x7053 ? (policy.healed = true, true) : false,
  };
  const calls = [];
  const sink = { setFlag: (id, value) => calls.push([id, value]) };
  S.applySetFlag(0x400d, 1, sink, policy);
  S.applySetFlag(0x7401, 1, sink, policy);
  S.applySetFlag(0x7053, 1, sink, policy);
  S.applySetFlag(0x7c0a, 1, sink, policy);
  S.applySetFlag(0x1c4b, 0, sink, policy);
  assert.deepEqual(calls, [[0x400d, 1], [0x1c4b, 0]]);
  assert.equal(policy.launched, 1, "0x7401 is launcher index 1");
  assert.equal(policy.healed, true);
});
