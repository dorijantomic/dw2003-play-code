import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopRootHandler } from "../engine/dw3/ui/shop-root-handler.ts";

const dir = resolve("web/assets/native/screens");
const overlay = new Uint8Array(readFileSync(resolve(dir, "pro_stitshop.bin")));
const resident = new Uint8Array(readFileSync(resolve(dir, "resident.bin")));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const ROOT = 0x8018a000;
const CONTEXT = 0x8018b000;

function fixture(lifecycle, state, busy) {
  const rt = new NativeStageRuntime(overlay, entry, { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
  rt.cpu.gp = 0x8005cb50;
  const mem = rt.mem;
  const events = [];
  const record = (name, ...args) => events.push([name, ...args.map(x => x >>> 0)]);
  const host = {
    loadRequest: id => record("loadRequest", id),
    loadBusy: id => { record("loadBusy", id); return busy; },
    buildLabels: (root, context) => record("buildLabels", root, context),
    advance0: root => {
      record("advance0", root);
      mem.write32(root + 0x0c, (mem.read32(root + 0x0c) + 1) >>> 0);
      for (const offset of [0x10, 0x14, 0x18]) mem.write32(root + offset, 0);
    },
    menuTick: (root, context) => record("menuTick", root, context),
    draw: (root, context) => record("draw", root, context),
    closeSave: (save, result) => record("closeSave", save, result),
  };
  mem.write32(ROOT + 0x0c, lifecycle);
  mem.write32(ROOT + 0x10, state);
  mem.write32(ROOT + 0x38, 0x80190030);
  mem.write32(0x8008d1b0, 0x80190000);
  mem.write32(0x8008d1b4, 0x80190010);
  mem.write32(0x80048d68, 0x8018f000);
  mem.write32(0x8004b440, 0x80190070);
  for (const [address, fn] of [
    [0x80190000, host.loadRequest], [0x80190010, host.loadBusy],
    [0x8008b524, host.buildLabels], [0x80190030, host.advance0],
    [0x8008b908, host.menuTick], [0x8008b60c, host.draw],
    [0x80190070, host.closeSave],
  ]) rt.cpu.setStub(address, c => fn(c.reg(4) >>> 0, c.reg(5) >>> 0));
  return { rt, mem, events, host };
}

test("merchant root lifecycle matches the shipped handler", () => {
  for (const [lifecycle, state, busy] of [
    [0, 0, 0], [0, 1, 1], [0, 1, 0], [0, 2, 0], [1, 3, 0], [2, 2, 0], [3, 0, 0],
  ]) {
    const original = fixture(lifecycle, state, busy);
    const translated = fixture(lifecycle, state, busy);
    original.rt.cpu.call(0x8008bfb0, [ROOT, CONTEXT]);
    shopRootHandler(translated.mem, ROOT, CONTEXT, translated.host);
    const label = `${lifecycle}/${state}/${busy}`;
    assert.deepEqual(translated.events, original.events, `${label} call order`);
    for (const offset of [0x0c, 0x10, 0x14, 0x18, 0x68, 0x78, 0x88, 0x98]) {
      assert.equal(translated.mem.read32(ROOT + offset) >>> 0,
        original.mem.read32(ROOT + offset) >>> 0, `${label} root +${offset.toString(16)}`);
    }
  }
});
