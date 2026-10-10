// Compare the three missing detail-panel methods with the original overlay.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { bandLeaveReady, bandToggleExtra, bandRedrawMember } from "../engine/dw3/ui/band-highlight.ts";

const screens = "web/assets/native/screens/";
const resident = new Uint8Array(readFileSync(`${screens}resident.bin`));
const shop = new Uint8Array(readFileSync(`${screens}pro_stitshop.bin`));
const entry = { size: shop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
const A = 0x80180000, B = 0x80181000;
const ELIGIBLE = 0x0fd42000, SOUND = 0x0fd42010;

function setup() {
  const rt = new NativeStageRuntime(shop, entry, host, undefined, undefined, 0x80082cb0, {
    image: resident, base: 0x80010000,
  });
  rt.cpu.gp = 0x8005cb50;
  rt.mem.write32(0x80042ba0, ELIGIBLE);
  rt.mem.write32(0x80055c48, SOUND);
  const calls = [];
  let eligibleAt = -1;
  rt.cpu.setStub(ELIGIBLE, c => {
    const item = c.reg(4) | 0, slot = c.reg(5) | 0;
    calls.push(["eligible", item, slot]);
    return slot === eligibleAt ? 1 : 0;
  });
  rt.cpu.setStub(SOUND, c => { calls.push(["sound", c.reg(4) >>> 0]); return 0; });
  rt.cpu.setStub(0x80089e2c, c => {
    calls.push(["item", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]); return 0;
  });
  rt.cpu.setStub(0x80089274, c => {
    calls.push(["member", c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) | 0]); return 0;
  });
  const translated = {
    itemHasSlot: (item, slot) => {
      calls.push(["eligible", item | 0, slot | 0]); return slot === eligibleAt ? 1 : 0;
    },
    playSound: sound => calls.push(["sound", sound >>> 0]),
    refillItem: (band, children, visible) => calls.push(["item", band >>> 0, children >>> 0, visible | 0]),
    refillMember: (band, children, member) => calls.push(["member", band >>> 0, children >>> 0, member | 0]),
  };
  return { rt, calls, translated, setEligible(slot) { eligibleAt = slot; } };
}

function seed(rt, target, state = 3, cards = 0) {
  rt.mem.write32(target + 0x10, state);
  rt.mem.write32(target + 0x24, target + 0x300);
  rt.mem.write32(target + 0x5c, cards);
  rt.mem.write32(target + 0x1e4, 292);
  rt.mem.write32(target + 0x1f0, 1);
}

function fields(rt, target) {
  return [0x10, 0x5c, 0x1f0].map(off => rt.mem.read32(target + off) | 0);
}

test("shop detail-panel leave, extra-card and member redraw match the original", () => {
  const { rt, calls, translated, setEligible } = setup();
  for (const state of [2, 3, 10]) {
    seed(rt, A, state); seed(rt, B, state);
    rt.cpu.call(0x8008b324, [A]);
    bandLeaveReady(rt.mem, B);
    assert.deepEqual(fields(rt, B), fields(rt, A), `leave state ${state}`);
  }
  for (const slot of [-1, 3, 4, 5]) {
    for (const cards of [0, 1]) {
      seed(rt, A, 3, cards); seed(rt, B, 3, cards);
      setEligible(slot);
      calls.length = 0;
      rt.cpu.call(0x8008b378, [A]);
      const expected = calls.splice(0);
      bandToggleExtra(rt.mem, translated, B);
      assert.deepEqual(calls, expected, `toggle slot ${slot} cards ${cards}`);
      assert.deepEqual(fields(rt, B), fields(rt, A), `toggle fields slot ${slot} cards ${cards}`);
    }
  }
  seed(rt, A); seed(rt, B);
  calls.length = 0;
  rt.cpu.call(0x8008b430, [A, 2]);
  const expected = calls.splice(0).map(call => [call[0], call[1] === A ? B : call[1],
    call[2] === A + 0x300 ? B + 0x300 : call[2], call[3]]);
  bandRedrawMember(rt.mem, translated, B, 2);
  assert.deepEqual(calls, expected);
});
