import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { NativeMemory } from "../engine/native/memory.ts";
import { CountryScreen, COUNTRY_SCREEN_DATA_BASE, COUNTRY_SCREEN_DATA_SIZE } from "../engine/dw3/ui/country-screen.ts";
import { stepOneShotAnimation } from "../engine/dw3/ui/animation-script.ts";
import { MenuPadWords, MenuDisplayClock } from "../engine/dw3/ui/pad-words.ts";
import { advanceFrameClock, frameDelta, resetFrameClock } from "../engine/systems/frame-clock.ts";
import { countryScreenStartupTick } from "../engine/dw3/ui/country-startup.ts";
import { observeUploadContext } from "./helpers/upload-context-observers.js";
import { build } from "esbuild";

const base = 0x80082cb0;
const overlay = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/pro_cnty_sel.bin", import.meta.url)));
const resident = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url)));
const data = overlay.slice(COUNTRY_SCREEN_DATA_BASE - base, COUNTRY_SCREEN_DATA_BASE - base + COUNTRY_SCREEN_DATA_SIZE);
const arity = { setLayer: 2, setOrigin: 2, setDepth: 2, setPos: 2, setScale: 3, m_0x88: 1, drawSprite: 4 };

function reference() {
  return new NativeStageRuntime(overlay,
    { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
    { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 }, undefined, undefined, base,
    { image: resident, base: 0x80010000 });
}

test("one-shot script matches original across expiration, recursion, signed fields and delta cap", () => {
  const rt = reference();
  const mem = new NativeMemory();
  const cursor = 0x80180000, table = 0x80180100;
  const sequences = [
    [[0, 4], [1, 4], [2, 4], [255, 0]],
    [[7, 1], [8, 1], [9, 1], [255, 0]],
    [[-7, 0], [-8, 0], [-9, 1], [255, 0]],
  ];
  for (const entries of sequences) for (const delta of [0, 1, 2, 4, 5, 100, -1]) {
    for (const remaining of [0, 1, 4, -4, 32767, -32768]) for (const nesting of [0, 1]) {
      for (const memory of [rt.mem, mem]) {
        entries.forEach(([frame, duration], i) => {
          memory.write16(table + i * 4, frame);
          memory.write16(table + i * 4 + 2, duration);
        });
        memory.write16(cursor, 0);
        memory.write16(cursor + 2, remaining);
      }
      rt.mem.write32(0x8004de28, delta);
      const expected = rt.cpu.call(0x80083304, [cursor, table, nesting], 20000) << 16 >> 16;
      const actual = stepOneShotAnimation(mem, cursor, table, nesting, () => delta);
      assert.deepEqual([actual, mem.read16(cursor), mem.read16(cursor + 2)],
        [expected, rt.mem.read16(cursor), rt.mem.read16(cursor + 2)],
        JSON.stringify({ entries, delta, remaining, nesting }));
    }
  }
});

function snapshot(mem, objects) {
  return objects.map(({ address, classId, size }) => ({
    classId,
    state: [0xc, 0x10, 0x14, 0x18].map(off => mem.read32(address + off)),
    fields: Array.from({ length: size - 0x50 }, (_, i) => mem.read8(address + 0x50 + i)),
    children: Array.from({ length: mem.read32(address + 0x20) }, (_, i) => {
      const child = mem.read32(mem.read32(address + 0x24) + i * 4) >>> 0;
      return child ? mem.read32(child + 0x48) >>> 0 : 0;
    }),
  })).sort((a, b) => a.classId - b.classId);
}

function composedPair() {
  const rt = reference();
  rt.objectLifecycle = true;
  const referenceEvents = [], actualEvents = [], actualDraws = [];
  rt.cpu.setStub(0x0fe00000, c => c.reg(4));
  rt.mem.write32(0x80044f5c, 0x0fe00000);
  rt.cpu.setStub(0x80083000, c => { referenceEvents.push(["fade", c.reg(4)]); return 0; });
  rt.cpu.setStub(0x0fe00004, c => { referenceEvents.push(["sound", c.reg(4)]); return 0; });
  rt.mem.write32(0x80055c48, 0x0fe00004);
  rt.cpu.setStub(0x0fe00008, c => { referenceEvents.push(["transition", c.reg(4), c.reg(5)]); return 0; });
  rt.mem.write32(0x8004b440, 0x0fe00008);
  rt.cpu.call(0x80084394, [], 20000);
  const draw = { initDrawContext() {}, packResolve: handle => handle,
    emitFadePrim: alpha => actualEvents.push(["fade", alpha]),
    playSound: id => actualEvents.push(["sound", id]),
    requestTransition: (id, arg) => actualEvents.push(["transition", id, arg]),
  };
  for (const name of Object.keys(arity)) draw[name === "m_0x88" ? "setFrame" : name] = (...args) => actualDraws.push([name, args.map(v => v >>> 0)]);
  const screen = new CountryScreen(data, draw, rt.mem.read32(0x8005cca8));
  const pad = new MenuPadWords();
  const sizes = new Map([[0x80083d18, 0x54], [0x80083184, 0x54], [0x800836dc, 0x58], [0x80083940, 0x58], [0x80083bc0, 0x58], [0x8008347c, 0x60]]);
  let frame = 0;
  // One displayed frame of the shared clock, which is what the translated screen
  // reads: [0x8004DF9C] holds F0x8001D704 over [0x8004DE28], published by the
  // original's own publisher F0x8001D504. Passing `delta` means the caller drove
  // the clock itself (the PAL script-clock run below) and this step only replays
  // that published word into the reference runtime's cell; otherwise this step
  // IS the displayed frame, so the two sides are fed the same word by
  // construction instead of by a copy pushed into the screen.
  function step(held = 0, delta = null) {
    const published = delta === null ? advanceFrameClock() : delta;
    assert.equal(frameDelta(), published, "the reference cell and the screen read one clock");
    referenceEvents.length = actualEvents.length = actualDraws.length = rt.drawCalls.length = 0;
    rt.setPadHeld(0, held);
    rt.tick(published);
    const { pressed, repeated } = pad.update(held);
    assert.deepEqual([pressed, repeated], [rt.mem.read16(0x8004b818), rt.mem.read16(0x8004b81a)]);
    screen.tick(pressed, repeated);
    const label = `frame ${++frame}, held ${held.toString(16)}`;
    assert.equal(rt.disabled.length, 0, `${label}: reference traps`);
    const expected = rt.world.objects.filter(o => o.alive).map(o => ({ address: o.addr, classId: o.cb, size: sizes.get(o.cb) }));
    assert.deepEqual(snapshot(screen.memory, [...screen.tree.tasks.values()]), snapshot(rt.mem, expected), `${label}: complete task tree`);
    assert.deepEqual(actualEvents, referenceEvents, `${label}: sound/fade/transition`);
    assert.deepEqual(actualDraws, rt.drawCalls.map(c => [c.method, c.args.slice(0, arity[c.method] ?? 4).map(v => v >>> 0)]), `${label}: ordered drawing`);
    assert.equal(screen.language, rt.mem.read8(0x8005cca8), `${label}: language`);
  }
  return { screen, step, seedSide(row) {
    const originalRoot = rt.world.objects.find(o => o.cb === 0x80083d18).addr;
    for (const [memory, root] of [[rt.mem, originalRoot], [screen.memory, screen.root]]) {
      memory.write32(root + 0x14, 1);
      memory.write16(root + 0x50, row);
    }
  } };
}

for (const row of [0, 1, 2, 3, 4]) test(`complete translated language screen matches opening, row ${row}, confirmation and destruction`, () => {
  const { screen, step } = composedPair();
  for (let i = 0; i < 60; i++) step();
  for (let i = 0; i < row; i++) { step(0x40); step(); }
  assert.equal(screen.row, row);
  step(8);
  for (let i = 0; i < 100; i++) step();
  assert.equal(screen.complete, true);
  assert.equal(screen.tree.tasks.size, 0);
});

test("complete translated language screen matches held directions, bounds, opposite inputs and ignored face buttons", () => {
  const { screen, step } = composedPair();
  for (let i = 0; i < 60; i++) step();
  for (let i = 0; i < 60; i++) step(0x40);
  assert.equal(screen.row, 4);
  for (let i = 0; i < 60; i++) step(0x10);
  assert.equal(screen.row, 0);
  for (const held of [0x80, 0x20, 0x4000, 0x2000, 0x50, 0, 0x48]) step(held);
  for (let i = 0; i < 100; i++) step();
  assert.equal(screen.complete, true);
});

test("translated screen rejects executable images and unknown methods", () => {
  assert.throws(() => new CountryScreen(overlay, {}), /107-byte/);
  const { screen } = composedPair();
  assert.throws(() => screen.tree.callMethod(screen.root, 0x5c, [1]), /untranslated method/);
  assert.throws(() => screen.tree.allocate(0xdeadbeef, 0x54, 0), /Untranslated task class/);
  screen.tick();
  screen.dispose();
  assert.equal(screen.tree.tasks.size, 0);
});

test("language task animations compare with the PAL sequence of script-clock deltas", () => {
  const { screen, step } = composedPair();
  // The script clock IS the shared clock, so it is advanced one displayed frame
  // at a time, the way the browser's frame loop advances it: the screen reads
  // the word on the frame the publisher wrote it, not 200 frames later.
  const clock = new MenuDisplayClock();
  let frame = 0;
  while (frame < 200) {
    for (const { delta } of clock.advance(1 / 50)) {
      step(frame === 60 ? 8 : 0, delta);
      frame += 1;
    }
  }
  assert.equal(screen.complete, true);
  assert.equal(screen.tree.tasks.size, 0);
});

test("menu clock preserves PAL update and input timing across browser refresh rates", () => {
  let baseline;
  for (const refresh of [30, 50, 60, 144, 240]) {
    // The delta comes from the game's one shared clock, so it is a global that
    // runs on across refresh rates. Put it back where the original's display
    // table sits before its first blank, so each rate plays the same second of
    // the same clock and only the browser's frame boundaries differ.
    resetFrameClock();
    const clock = new MenuDisplayClock(), pad = new MenuPadWords();
    const result = [];
    for (let frame = 0; frame < refresh; frame++) {
      for (const { tick, delta } of clock.advance(1 / refresh)) {
        result.push([tick, delta, pad.update(0x40, tick)]);
      }
    }
    assert.equal(result.length, 50);
    assert.equal(result.at(-1)[0], 59);
    if (baseline) assert.deepEqual(result, baseline, `refresh ${refresh}`);
    baseline = result;
  }
});

for (const row of [5, 6]) test(`seeded side-position ${row} compares alternate navigation and return branch (not an ordinary-entry reachability claim)`, () => {
  const { screen, step, seedSide } = composedPair();
  for (let i = 0; i < 60; i++) step();
  seedSide(row);
  step(0x80); step();
  assert.equal(screen.row, 6);
  step(0x20); step();
  assert.equal(screen.row, 5);
  if (row === 6) { step(0x80); step(); }
  step(8);
  for (let i = 0; i < 100; i++) step();
  assert.equal(screen.language, row === 6 ? 0 : 1);
  assert.equal(screen.transition.id, row === 6 ? 0xe01 : 0xe02);
});

test("language startup matches original readiness gate, display setup, creation and music lifetime", () => {
  const rt = reference(), obj = 0x80180000, extra = obj + 0x100, surface = obj + 0x200;
  let events, setup, pending;
  let stub = 0x0fe10000;
  function bind(cell, fn) { rt.cpu.setStub(stub, fn); rt.mem.write32(cell, stub); stub += 4; }
  bind(0x80055c60, () => { events.push(["pending"]); return pending; });
  bind(0x80055c48, c => { events.push(["play", c.reg(4)]); return 0; });
  bind(0x80055c68, c => { events.push(["stop", c.reg(4)]); return 0; });
  bind(0x8004de10 + 0x150, () => { setup = {}; return 0; });
  bind(0x8004de10 + 0x154, c => { setup.packetBytes = c.reg(4); return 0; });
  bind(0x8004de10 + 0x174, c => {
    setup.width = c.reg(4); setup.height = c.reg(5);
    assert.equal(c.reg(6), 0); assert.equal(c.reg(7), 0); return 0;
  });
  observeUploadContext(rt, {
    0x24: c => { setup.textureOrigin = [c.reg(4), c.reg(5)]; return 0; },
    0x28: c => { setup.paletteOrigin = [c.reg(4), c.reg(5)]; return 0; },
    0x2c: c => { assert.equal(c.reg(4) >>> 0, 0x80190000); return 0; },
  });
  bind(0x80044f5c, c => { setup.texture = c.reg(4); return 0x80190000; });
  bind(0x8004de10 + 0x16c, c => {
    setup.rectangles = c.reg(4) >>> 0; setup.rectangleCount = c.reg(5); setup.target = c.reg(6); return surface;
  });
  bind(surface + 0x12c, c => {
    assert.equal(c.reg(4) >>> 0, surface);
    setup.clear = [c.reg(5), c.reg(6), c.reg(7)];
    events.push(["prepare", setup]); return 0;
  });
  rt.cpu.setStub(0x80084394, () => { events.push(["create"]); return 0x801a0000; });
  rt.mem.write32(obj + 0x38, 0x800142ac);
  for (const state0 of [-1, 0, 1, 2, 3, 4]) for (const busy of [0, 1]) {
    pending = busy; events = [];
    [state0, 11, 22, 33].forEach((value, i) => rt.mem.write32(obj + 0xc + i * 4, value));
    rt.mem.write32(extra, 0);
    rt.cpu.call(0x80082ce8, [obj, extra], 30000);
    const expected = events;
    events = [];
    const state = { state0, state1: 11, state2: 22, state3: 33 };
    countryScreenStartupTick(state, {
      audioPending() { events.push(["pending"]); return busy; },
      prepareDisplay(config) { events.push(["prepare", config]); },
      createScreen() { events.push(["create"]); },
      playSound(id) { events.push(["play", id]); }, stopSound(id) { events.push(["stop", id]); },
    });
    assert.deepEqual(events, expected, `state ${state0}, busy ${busy}`);
    assert.deepEqual(Object.values(state), [0xc, 0x10, 0x14, 0x18].map(off => rt.mem.read32(obj + off)));
  }
});

test("production table extraction matches reference bytes and default; fade uses the original quad rectangle and subtract mode", () => {
  const asset = JSON.parse(readFileSync(new URL("../web/assets/data/country_screen.json", import.meta.url)));
  assert.deepEqual(asset.bytes, [...data]);
  const rt = reference(), surface = 0x80180000, bucket = surface + 0x200, packet = bucket + 0x100;
  assert.equal(asset.initialLanguage, rt.mem.read32(0x8005cca8));
  let stub = 0x0fe20000;
  function bind(cell, fn) { rt.cpu.setStub(stub, fn); rt.mem.write32(cell, stub); stub += 4; }
  bind(0x8004de10 + 0x17c, c => { assert.equal(c.reg(4), 0x100); return surface; });
  bind(surface + 0x138, c => { assert.equal(c.reg(5), 0); return bucket; });
  bind(0x8004de10 + 0x158, () => packet);
  bind(0x8004de10 + 0x15c, c => { assert.equal(c.reg(4) >>> 0, packet + 0x20); return 0; });
  rt.cpu.call(0x80083000, [119], 30000);
  const { screen } = composedPair();
  const r = screen.rectangle(2);
  assert.deepEqual([8, 10, 12, 14, 16, 18, 20, 22].map(off => rt.mem.read16s(packet + off)),
    [r.x, r.y, r.x + r.width, r.y, r.x, r.y + r.height, r.x + r.width, r.y + r.height]);
  assert.deepEqual([4, 5, 6, 7].map(off => rt.mem.read8(packet + off)), [119, 119, 119, 0x2a]);
  assert.equal((rt.mem.read32(packet + 0x1c) >>> 5) & 3, 2);
});

test("language controller dependency graph contains data memory but no interpreter, bridge or executable loader", async () => {
  const result = await build({ entryPoints: ["engine/dw3/ui/country-screen.ts", "engine/dw3/ui/country-startup.ts"],
    outdir: "/tmp/country-screen-dependency-check", bundle: true, write: false, metafile: true, format: "esm" });
  const native = Object.keys(result.metafile.inputs).filter(path => path.startsWith("engine/native/"));
  assert.deepEqual(native, ["engine/native/memory.ts"]);
});
