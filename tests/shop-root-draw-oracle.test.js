import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { shopRootDraw } from "../engine/dw3/ui/shop-root-draw.ts";

const dir = resolve("web/assets/native/screens");
const overlay = new Uint8Array(readFileSync(resolve(dir, "pro_stitshop.bin")));
const resident = new Uint8Array(readFileSync(resolve(dir, "resident.bin")));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const A = 0x8018a000;
const B = 0x8018b000;
const PACK = 0x80190000;
const ARITY = { setLayer: 2, setOrigin: 2, setScale: 3, setPos: 2, drawSprite: 4 };
const normalize = calls => calls.map(c => [c.method, c.args.slice(0, ARITY[c.method] ?? 4).map(v => v >>> 0)]);

function runtime() {
  const rt = new NativeStageRuntime(overlay, entry, { setFlag() {}, getFlag: () => 0, rand16: () => 0 },
    undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
  rt.cpu.gp = 0x8005cb50;
  rt.mem.write32(0x80044f5c, 0x80190100);
  rt.cpu.setStub(0x80190100, () => PACK);
  return rt;
}

test("merchant root plates and wall match the shipped draw pass", () => {
  const rt = runtime();
  const cases = [
    {}, { header: 0x800 }, { header: 0x1000, money: 0x1000 },
    { header: 0x800, money: 0x1000, menu: 0x800, footer: 0x1000 },
    { money: 0x800, menu: 0x1000, footer: 0x800, scroll: 95, half: 1 },
    { scroll: 40, half: 0 }, { scroll: 40, half: 1 },
  ];
  for (const c of cases) {
    for (const root of [A, B]) {
      for (let i = 0; i < 0xac; i += 4) rt.mem.write32(root + i, 0);
      rt.mem.write32(root + 0x50, 0x1000);
      rt.mem.write32(root + 0x58, c.scroll ?? 0);
      rt.mem.write32(root + 0x5c, c.half ?? 0);
      rt.mem.write32(root + 0x70, c.header ?? 0);
      rt.mem.write32(root + 0x80, c.money ?? 0);
      rt.mem.write32(root + 0x90, c.menu ?? 0);
      rt.mem.write32(root + 0xa0, c.footer ?? 0);
    }
    rt.drawCalls.length = 0;
    rt.cpu.call(0x8008b60c, [A]);
    const oracle = normalize(rt.drawCalls);
    const calls = [];
    const push = (method, ...args) => calls.push({ method, args });
    shopRootDraw(rt.mem, B, {
      initDrawContext() {},
      setLayer: (...args) => push("setLayer", ...args),
      setOrigin: (...args) => push("setOrigin", ...args),
      setScale: (...args) => push("setScale", ...args),
      setPos: (...args) => push("setPos", ...args),
      drawSprite: (...args) => push("drawSprite", ...args),
      packResolve: () => PACK,
    });
    assert.deepEqual(normalize(calls), oracle, JSON.stringify(c));
    for (const offset of [0x58, 0x5c]) {
      assert.equal(rt.mem.read32(B + offset), rt.mem.read32(A + offset), `${JSON.stringify(c)} +${offset}`);
    }
  }
});
