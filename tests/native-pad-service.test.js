// The host pad-input service: the resident controller-input record the original
// screens read through F0x80018854 (pressed), F0x8001889C (repeat) and
// F0x80018878 (held). Contract and offsets:
// docs/research/ui/pad-input-service-behaviour-2026-08-21.md — service object
// 0x8004B7D0, records at +0x48 stride 0x1C0 per port; +0x00 pressed,
// +0x02 repeat, +0x04 previous held, +0x06 held; repeat rate 16 with the
// +10 / cap-12 credit ladder (16/6/4 ticks per pulse).

import { test } from "node:test";
import assert from "node:assert/strict";
import { NativeStageRuntime } from "../engine/native/runtime.ts";

const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

/** A screen runtime (resident image loaded) with a stub overlay; tick() writes
 *  the pad record and the cache-tick trap is swallowed by the fail-soft path. */
function screenRuntime() {
  const overlay = new Uint8Array(8);
  const resident = { image: new Uint8Array(0x100), base: 0x80010000 };
  const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, resident);
  return { rt, mem: rt.mem };
}

const PRESSED = 0x8004b818;
const REPEAT = 0x8004b81a;
const PREV = 0x8004b81c;
const HELD = 0x8004b81e;
const DOWN = 0x0040;

test("pad record: pressed is the edge, held persists until released", () => {
  const { rt, mem } = screenRuntime();
  rt.setPadHeld(0, DOWN);
  rt.tick(1);
  assert.equal(mem.read16(PRESSED), DOWN, "pressed on the frame the button goes down");
  assert.equal(mem.read16(HELD), DOWN, "held this frame");
  assert.equal(mem.read16(PREV), 0, "previous held before the press");
  rt.tick(1);
  assert.equal(mem.read16(PRESSED), 0, "no edge while the button stays down");
  assert.equal(mem.read16(HELD), DOWN);
  rt.setPadHeld(0, 0);
  rt.tick(1);
  assert.equal(mem.read16(PRESSED), 0);
  assert.equal(mem.read16(HELD), 0, "release clears held");
});

test("pad record: auto-repeat follows the 16/6/4 credit ladder", () => {
  const { rt, mem } = screenRuntime();
  rt.setPadHeld(0, DOWN);
  const pulses = [];
  for (let f = 1; f <= 30; f++) {
    rt.tick(1);
    if (mem.read16(REPEAT) & DOWN) pulses.push(f);
  }
  assert.deepEqual(pulses, [16, 22, 26, 30], "first repeat at 16 ticks, then 6, then every 4");
});

test("pad record: release resets the repeat state", () => {
  const { rt, mem } = screenRuntime();
  rt.setPadHeld(0, DOWN);
  for (let f = 0; f < 16; f++) rt.tick(1);
  assert.ok(mem.read16(REPEAT) & DOWN, "pulsed at tick 16");
  rt.setPadHeld(0, 0);
  rt.tick(1);
  rt.setPadHeld(0, DOWN);
  let first = 0;
  for (let f = 0; f < 20; f++) {
    rt.tick(1);
    if (mem.read16(REPEAT) & DOWN) { first = f + 1; break; }
  }
  assert.equal(first, 16, "a release restarts the 16-tick first delay");
});
