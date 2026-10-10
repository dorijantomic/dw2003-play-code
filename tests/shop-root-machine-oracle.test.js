import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopRootMachine } from "../engine/dw3/ui/shop-root-machine.ts";

const ROOT = 0x8018a000;
const CONTEXT = 0x8018b000;
const FADE = 0x8018c000;
const WIDGET = 0x8018d000;
const images = resolve("web/assets/native/screens");
const overlay = new Uint8Array(readFileSync(resolve(images, "pro_stitshop.bin")));
const resident = new Uint8Array(readFileSync(resolve(images, "resident.bin")));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const FOLD_START = 0x80190000;
const FOLD_TICK = 0x80190010;
const BANK_GET = 0x80190020;
const TEXT_SET = 0x80190030;
const TEXT_NUMBER = 0x80190040;
const TEXT_MEASURE = 0x80190050;
const TEXT_SHOW = 0x80190060;
const CURSOR_SHOW = 0x80190070;
const CURSOR_PLACE = 0x80190080;
const PAD_PRESSED = 0x80190090;
const PAD_KEY = 0x801900a0;
const SOUND = 0x801900b0;
const TRANSITION = 0x801900c0;
const BUY = 0x8008596c;
const SELL = 0x800873d4;
const FADE_CREATE = 0x800835c4;
const FADE_START = 0x80190100;

function fixture(state, options = {}) {
  const rt = new NativeStageRuntime(overlay, entry, { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
  rt.cpu.gp = 0x8005cb50;
  const mem = rt.mem;
  const events = [];
  const log = (name, ...args) => events.push([name, ...args.map(x => x >>> 0)]);
  const stub = (address, fn) => rt.cpu.setStub(address, c => fn(...[4, 5, 6, 7].map(r => c.reg(r) >>> 0)));
  const widget = offset => WIDGET + offset * 0x100;
  const foldReady = options.foldReady ?? 1;
  const pressed = options.pressed ?? 0;
  mem.write32(ROOT + 0x0c, 1);
  mem.write32(ROOT + 0x10, state);
  mem.write32(ROOT + 0x14, options.returnToMenu ?? 0);
  mem.write32(ROOT + 0x60, 1);
  mem.write32(ROOT + 0x64, options.cursor ?? 0);
  mem.write32(CONTEXT + 0x1c, options.activeChild ?? 0);
  mem.write32(CONTEXT + 0x20, FADE);
  mem.write32(FADE + 0x0c, options.fadeState ?? 0);
  mem.write32(ROOT + 0x2c, TRANSITION);
  mem.write32(0x8008d1b8, FOLD_START);
  mem.write32(0x8008d1bc, FOLD_TICK);
  mem.write32(0x80044f4c, BANK_GET);
  mem.write32(0x8004bbc4, PAD_PRESSED);
  mem.write32(0x8004bbd8, PAD_KEY);
  mem.write32(0x80055c48, SOUND);
  mem.write32(0x8005cca8, 0);
  mem.write32(0x80048da0, 1234);
  for (let i = 0; i <= 0x20; i += 4) {
    mem.write32(CONTEXT + i, widget(i));
    for (const [slot, target] of [
      [0x114, TEXT_SET], [0x118, TEXT_NUMBER], [0x148, TEXT_MEASURE],
      [0x144, TEXT_SHOW], [0x80, CURSOR_SHOW], [0x84, CURSOR_PLACE], [0x64, FADE_START],
    ]) mem.write32(widget(i) + slot, target);
  }
  mem.write32(CONTEXT + 0x1c, options.activeChild ?? 0);
  mem.write32(CONTEXT + 0x20, FADE);
  mem.write32(FADE + 0x64, FADE_START);
  const host = {
    foldStart: (w, on) => log("foldStart", w, on),
    foldTick: w => { log("foldTick", w); return foldReady; },
    bankGet: bank => { log("bankGet", bank); return 0x80170000 + bank; },
    textSet: (w, bank, id) => log("textSet", w, bank, id),
    textNumber: (w, line, value) => log("textNumber", w, line, value),
    textMeasure: (w, on) => log("textMeasure", w, on),
    textShow: (w, on) => log("textShow", w, on),
    cursorShow: (w, on) => log("cursorShow", w, on),
    cursorPlace: (w, x, y) => log("cursorPlace", w, x, y),
    padPressed: () => pressed,
    padKey: code => code,
    playSound: id => log("sound", id),
    transition: (root, next) => {
      log("transition", root, next);
      mem.write32(root + 0x10, next);
      mem.write32(root + 0x14, 0);
      mem.write32(root + 0x18, 0);
    },
    createBuy: root => { log("buy", root); return 0x80162000; },
    createSell: root => { log("sell", root); return 0x80163000; },
    createFade: w => { log("fadeCreate", w); return FADE; },
    fadeStart: (fade, direction, frames) => log("fadeStart", fade, direction, frames),
  };
  stub(FOLD_START, host.foldStart);
  stub(FOLD_TICK, host.foldTick);
  stub(BANK_GET, host.bankGet);
  stub(TEXT_SET, host.textSet);
  stub(TEXT_NUMBER, host.textNumber);
  stub(TEXT_MEASURE, host.textMeasure);
  stub(TEXT_SHOW, host.textShow);
  stub(CURSOR_SHOW, host.cursorShow);
  stub(CURSOR_PLACE, host.cursorPlace);
  stub(PAD_PRESSED, host.padPressed);
  stub(PAD_KEY, (_, code) => host.padKey(code));
  stub(SOUND, host.playSound);
  stub(TRANSITION, host.transition);
  stub(BUY, host.createBuy);
  stub(SELL, host.createSell);
  stub(FADE_CREATE, host.createFade);
  stub(FADE_START, host.fadeStart);
  return { rt, mem, events, host };
}

test("merchant root menu matches the shipped controller across entry, input, child and exit states", () => {
  const cases = [
    [0, {}], [1, { foldReady: 0 }], [1, {}], [2, { foldReady: 0 }], [2, {}],
    [3, { pressed: 1 << 4, cursor: 1 }], [3, { pressed: 1 << 6 }],
    [3, { pressed: 1 << 13 }], [3, { pressed: 1 << 14 }],
    [10, {}], [10, { cursor: 1 }], [11, { activeChild: 1 }], [11, {}],
    [20, {}], [20, { returnToMenu: 1 }], [21, { foldReady: 0 }],
    [21, { returnToMenu: 1 }], [21, {}], [22, { foldReady: 0 }], [22, {}],
    [23, { fadeState: 1 }], [23, { fadeState: 2 }],
  ];
  for (const [state, options] of cases) {
    const original = fixture(state, options);
    const translated = fixture(state, options);
    original.rt.cpu.call(0x8008b908, [ROOT, CONTEXT]);
    shopRootMachine(translated.mem, ROOT, CONTEXT, translated.host);
    assert.deepEqual(translated.events, original.events, `state ${state} ${JSON.stringify(options)} call order`);
    for (const address of [ROOT + 0x0c, ROOT + 0x10, ROOT + 0x14, ROOT + 0x64, CONTEXT + 0x1c, CONTEXT + 0x20]) {
      assert.equal(translated.mem.read32(address) >>> 0, original.mem.read32(address) >>> 0,
        `state ${state} ${JSON.stringify(options)} write ${address.toString(16)}`);
    }
  }
});
