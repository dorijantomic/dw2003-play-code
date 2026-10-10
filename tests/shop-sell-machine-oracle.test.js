import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopSellMachine } from "../engine/dw3/ui/shop-sell-machine.ts";

const dir = resolve("web/assets/native/screens");
const overlay = new Uint8Array(readFileSync(resolve(dir, "pro_stitshop.bin")));
const resident = new Uint8Array(readFileSync(resolve(dir, "resident.bin")));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const SELF = 0x80170000;
const CTX = 0x80171000;
const LIST = 0x80172000;
const BAND = 0x80173000;
const CURSOR = 0x80174000;
const ROOT = 0x80175000;
const RECORD = 0x80176000;
const TEXT = 0x80178000;
const STUB = 0x80190000;
const HELD = 0x80048d34 + 0x7c + 92;
const MONEY = 0x80048d34 + 0x6c;

function fixture(state, o = {}) {
  const rt = new NativeStageRuntime(overlay, entry, { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
  rt.cpu.gp = 0x8005cb50;
  const mem = rt.mem;
  const events = [];
  const emit = (name, ...args) => events.push([name, ...args.map(x => x >>> 0)]);
  const stub = (address, fn) => rt.cpu.setStub(address, c => fn(...[4, 5, 6, 7].map(r => c.reg(r) >>> 0)));
  const textPtr = offset => TEXT + offset * 0x100;
  const list = o.noList ? 0 : LIST;
  const band = o.noBand ? 0 : BAND;
  const pressed = o.pressed ?? 0;
  const repeated = o.repeated ?? 0;
  const ready = o.ready ?? 1;
  mem.write32(SELF + 0x0c, 1);
  mem.write32(SELF + 0x10, state);
  mem.write32(SELF + 0x14, o.flag ?? 0);
  mem.write32(SELF + 0x2c, STUB + 0xc0);
  mem.write32(SELF + 0x54, ROOT);
  mem.write32(SELF + 0x60, o.category ?? 1);
  mem.write32(SELF + 0x64, 92);
  mem.write32(SELF + 0x68, o.qty ?? 2);
  mem.write32(SELF + 0x6c, o.heldField ?? 3);
  mem.write32(SELF + 0x78, o.choice ?? 0);
  mem.write32(CTX, list);
  mem.write32(CTX + 4, band);
  mem.write32(CTX + 8, CURSOR);
  for (let offset = 0x0c; offset <= 0x34; offset += 4) mem.write32(CTX + offset, textPtr(offset));
  mem.write32(LIST + 0x0c, o.listLifecycle ?? 2);
  mem.write32(LIST + 0x10, o.listState ?? 0x64);
  mem.write32(LIST + 0x6bc, o.page ?? 0);
  mem.write32(LIST + 0x6c0, o.listCount ?? 2);
  mem.write32(LIST + 0x6c4, o.row ?? 0);
  mem.write32(LIST + 0x6c8, o.rowCount ?? 2);
  mem.write32(BAND + 0x10, o.bandState ?? 3);
  mem.write8(HELD, o.held ?? 3);
  mem.write32(MONEY, o.money ?? 10000);
  mem.write16(RECORD + 6, 100);
  mem.write32(0x8005cca8, 0);
  mem.write32(0x8008d1b8, STUB);
  mem.write32(0x8008d1bc, STUB + 0x10);
  mem.write32(0x80044f4c, STUB + 0x20);
  mem.write32(0x8004bbc4, STUB + 0x90);
  mem.write32(0x8004bbcc, STUB + 0xa0);
  mem.write32(0x8004bbd8, STUB + 0xb0);
  mem.write32(0x80055c48, STUB + 0xd0);
  mem.write32(0x80042b98, STUB + 0xe0);
  mem.write32(ROOT + 0xa8, STUB + 0xf0);
  const slots = [
    [CURSOR, 0x80, STUB + 0x70], [CURSOR, 0x84, STUB + 0x80],
    [LIST, 0x6f0, STUB + 0x120], [LIST, 0x6f4, STUB + 0x130],
    [LIST, 0x6ec, STUB + 0x140], [LIST, 0x6e8, STUB + 0x150],
    [LIST, 0x700, STUB + 0x160],
    [BAND, 0x234, STUB + 0x170], [BAND, 0x238, STUB + 0x180],
  ];
  for (const [p, offset, target] of slots) mem.write32(p + offset, target);
  for (let offset = 0x0c; offset <= 0x34; offset += 4) {
    for (const [slot, target] of [
      [0x114, STUB + 0x30], [0x118, STUB + 0x40], [0x120, STUB + 0x50],
      [0x148, STUB + 0x60], [0x144, STUB + 0x190],
    ]) mem.write32(textPtr(offset) + slot, target);
  }
  const host = {
    foldStart: (w, on) => emit("foldStart", w, on),
    foldTick: w => { emit("foldTick", w); return ready; },
    bankGet: id => { emit("bankGet", id); return 0x80160000 + id; },
    textSet: (w, bank, id) => emit("textSet", w, bank, id),
    textNumber: (w, line, value) => emit("textNumber", w, line, value),
    textFormat: (w, bank, id, count) => emit("textFormat", w, bank, id, count),
    textMeasure: (w, on) => emit("textMeasure", w, on),
    textShow: (w, on) => emit("textShow", w, on),
    cursorPlace: (w, x, y) => emit("cursorPlace", w, x, y),
    cursorShow: (w, on) => emit("cursorShow", w, on),
    padPressed: () => pressed,
    padRepeat: () => repeated,
    padKey: code => code,
    playSound: id => emit("sound", id),
    transition: (self, next) => {
      emit("transition", self, next);
      mem.write32(self + 0x10, next);
      mem.write32(self + 0x14, 0);
      mem.write32(self + 0x18, 0);
    },
    createList: (self, category, mode) => { emit("createList", self, category, mode); return LIST; },
    createBand: (mode, id) => { emit("createBand", mode, id); return BAND; },
    listSelected: l => { emit("listSelected", l); return 92; },
    listCursor: (l, on) => emit("listCursor", l, on),
    listStop: l => emit("listStop", l),
    listHide: l => emit("listHide", l),
    listRebuild: l => emit("listRebuild", l),
    bandQuantity: (b, id, qty) => emit("bandQuantity", b, id, qty),
    bandLeave: b => emit("bandLeave", b),
    itemRecord: id => { emit("itemRecord", id); return RECORD; },
    rootRefresh: (root, save) => emit("rootRefresh", root, save),
  };
  stub(STUB, host.foldStart);
  stub(STUB + 0x10, host.foldTick);
  stub(STUB + 0x20, host.bankGet);
  stub(STUB + 0x30, host.textSet);
  stub(STUB + 0x40, host.textNumber);
  stub(STUB + 0x50, host.textFormat);
  stub(STUB + 0x60, host.textMeasure);
  stub(STUB + 0x70, host.cursorShow);
  stub(STUB + 0x80, host.cursorPlace);
  stub(STUB + 0x90, host.padPressed);
  stub(STUB + 0xa0, host.padRepeat);
  stub(STUB + 0xb0, (_, code) => host.padKey(code));
  stub(STUB + 0xc0, host.transition);
  stub(STUB + 0xd0, host.playSound);
  stub(STUB + 0xe0, host.itemRecord);
  stub(STUB + 0xf0, host.rootRefresh);
  stub(STUB + 0x120, host.listSelected);
  stub(STUB + 0x130, host.listCursor);
  stub(STUB + 0x140, host.listStop);
  stub(STUB + 0x150, host.listHide);
  stub(STUB + 0x160, host.listRebuild);
  stub(STUB + 0x170, host.bandQuantity);
  stub(STUB + 0x180, host.bandLeave);
  stub(STUB + 0x190, host.textShow);
  stub(0x800889a8, host.createList);
  stub(0x8008b484, host.createBand);
  return { rt, mem, events, host };
}

test("SELL controller matches the shipped routine across menu, quantity, sale and return states", () => {
  const cases = [
    [0, {}], [1, { ready: 0 }], [1, {}],
    [2, { pressed: 1 << 4 }], [2, { repeated: 1 << 6 }],
    [2, { pressed: 1 << 13 }], [2, { pressed: 1 << 14 }],
    [2, { category: 0, pressed: 1 << 4 }], [2, { category: 3, repeated: 1 << 6 }],
    [3, { noList: true }], [3, {}], [4, {}], [4, { listCount: 0 }],
    [0x64, {}], [0x65, { noBand: true }], [5, {}],
    [6, { pressed: 1 << 13 }], [6, { pressed: 1 << 14 }],
    [0x14, {}], [0x15, {}], [0x16, {}],
    [0x17, { pressed: 1 << 4 }], [0x17, { repeated: 1 << 5 }],
    [0x17, { pressed: 1 << 6 }], [0x17, { pressed: 1 << 7 }],
    [0x17, { qty: 1, pressed: 1 << 6 }],
    [0x17, { qty: 11, heldField: 99, pressed: 1 << 7 }],
    [0x17, { qty: 98, heldField: 99, repeated: 1 << 5 }],
    [0x17, { pressed: 1 << 13 }], [0x17, { pressed: 1 << 14 }],
    [0x18, {}], [0x18, { flag: 1 }], [0x19, {}], [0x1a, {}],
    [0x1e, { ready: 0 }], [0x1e, {}], [0x1f, {}], [0x20, { pressed: 1 << 6 }],
    [0x20, { pressed: 1 << 13 }], [0x20, { pressed: 1 << 13, choice: 1 }],
    [0x20, { pressed: 1 << 14 }],
    [0x20, { pressed: 1 << 13, money: 9999990, held: 1, qty: 2 }],
    [0x20, { pressed: (1 << 6) | (1 << 13), choice: 0 }],
    [0x21, {}], [0x21, { listCount: 0, held: 0 }],
    [0x22, { noList: true }], [0x22, { page: 2, listCount: 2, row: 2, rowCount: 2 }],
    [0x27, {}], [0x28, { noBand: true }], [0x29, {}],
    [0xc8, {}], [0xc9, {}], [0xca, { pressed: 1 << 13 }],
    [0xca, { pressed: 1 << 14 }], [0xcb, {}], [0xcb, { ready: 0 }],
    [0x32, {}], [0x33, {}], [0x33, { flag: 1 }], [0x33, { ready: 0 }],
  ];
  for (const [state, options] of cases) {
    const original = fixture(state, options);
    const translated = fixture(state, options);
    original.rt.cpu.call(0x80085f48, [SELF, CTX]);
    shopSellMachine(translated.mem, SELF, CTX, translated.host);
    const label = `${state.toString(16)} ${JSON.stringify(options)}`;
    assert.deepEqual(translated.events, original.events, `${label} calls`);
    for (const address of [
      SELF + 0x0c, SELF + 0x10, SELF + 0x14, SELF + 0x18, SELF + 0x60,
      SELF + 0x64, SELF + 0x68, SELF + 0x6c, SELF + 0x78,
      CTX, CTX + 4, LIST + 0x0c, LIST + 0x10, LIST + 0x6bc, LIST + 0x6c4,
      MONEY,
    ]) assert.equal(translated.mem.read32(address) >>> 0, original.mem.read32(address) >>> 0,
      `${label} write ${address.toString(16)}`);
    assert.equal(translated.mem.read8(HELD), original.mem.read8(HELD), `${label} held count`);
  }
});
