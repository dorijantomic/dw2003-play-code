// The original BUY quantity/confirm helpers and their translated call streams.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopBuyQuantityLine, shopBuyConfirmLine } from "../engine/dw3/ui/shop-buy-lines.ts";

const screens = "web/assets/native/screens/";
const resident = new Uint8Array(readFileSync(`${screens}resident.bin`));
const shop = new Uint8Array(readFileSync(`${screens}pro_stitshop.bin`));
const entry = { size: shop.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
const ACTOR = 0x80180000;
const CTX = 0x80181000;
const RECORD = 0x80182000;
const SOURCE = 0x80183000;
const BANK_STUB = 0x0fd41000;
const ITEM_STUB = 0x0fd41010;
const TEXT_STUB = 0x0fd41020;
const NUMBER_STUB = 0x0fd41030;
const SHOW_STUB = 0x0fd41040;
const MEASURE_STUB = 0x0fd41050;

function setup() {
  const rt = new NativeStageRuntime(shop, entry, host, undefined, undefined, 0x80082cb0, {
    image: resident, base: 0x80010000,
  });
  rt.cpu.gp = 0x8005cb50;
  const calls = [];
  rt.mem.write32(0x8005cca8, 0x1234);
  rt.mem.write32(0x80044f4c, BANK_STUB);
  rt.mem.write32(0x80042b98, ITEM_STUB);
  rt.mem.write32(ACTOR + 0x60, 92);
  rt.mem.write32(ACTOR + 0x64, 3);
  rt.mem.write16(RECORD + 4, 200);
  rt.cpu.setStub(BANK_STUB, c => { calls.push(["bank", c.reg(4) >>> 0]); return SOURCE; });
  rt.cpu.setStub(ITEM_STUB, c => { calls.push(["item", c.reg(4) | 0]); return RECORD; });
  for (const [stub, name, count] of [
    [TEXT_STUB, "text", 3], [NUMBER_STUB, "number", 3],
    [SHOW_STUB, "show", 2], [MEASURE_STUB, "measure", 2],
  ]) rt.cpu.setStub(stub, c => { calls.push([name, ...[4, 5, 6].slice(0, count).map(r => c.reg(r) >>> 0)]); return 0; });
  for (const [i, off] of [0x08, 0x0c, 0x10, 0x14, 0x18, 0x1c].entries()) {
    const widget = 0x80184000 + i * 0x200;
    rt.mem.write32(CTX + off, widget);
    rt.mem.write32(widget + 0x114, TEXT_STUB);
    rt.mem.write32(widget + 0x118, NUMBER_STUB);
    rt.mem.write32(widget + 0x144, SHOW_STUB);
    rt.mem.write32(widget + 0x148, MEASURE_STUB);
  }
  const translated = {
    bankGet: bank => { calls.push(["bank", bank >>> 0]); return SOURCE; },
    itemRecord: id => { calls.push(["item", id | 0]); return RECORD; },
    textSet: (widget, source, id) => calls.push(["text", widget >>> 0, source >>> 0, id >>> 0]),
    textNumber: (widget, line, value) => calls.push(["number", widget >>> 0, line >>> 0, value >>> 0]),
    textShow: (widget, visible) => calls.push(["show", widget >>> 0, visible >>> 0]),
    textMeasure: (widget, enabled) => calls.push(["measure", widget >>> 0, enabled >>> 0]),
  };
  return { rt, calls, translated };
}

test("BUY quantity and confirm widget calls match the original", () => {
  const { rt, calls, translated } = setup();
  for (const [original, port] of [
    [0x800836f8, shopBuyQuantityLine],
    [0x80083810, shopBuyConfirmLine],
  ]) {
    for (const show of [1, 0]) {
      calls.length = 0;
      rt.cpu.call(original, [ACTOR, CTX, show]);
      const expected = calls.splice(0);
      port(rt.mem, translated, ACTOR, CTX, show);
      assert.deepEqual(calls, expected, `${original.toString(16)} show=${show}`);
    }
  }
});
