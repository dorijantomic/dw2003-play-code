// The shop's own decisions must run as our translated code, never through the
// PlayStation interpreter. Two things are asserted here, and both must hold for
// the merchant (web/shop-translated.js) and the card shop
// (web/cardshop-translated.js):
//
//   1. The controllers reach data memory and nothing else. Bundling them pulls
//      in engine/native/memory.ts (the flat RAM buffer) and no interpreter,
//      decoder, bridge or executable loader. A route that linked the
//      interpreter would add engine/native/runtime.ts and fail here; the
//      negative control below proves the check detects an interpreter when a
//      graph does link one.
//   2. The adapters declare `execution: "translated"`, the same mark every other
//      converted screen carries (web/lab-translated.js, web/gym-translated.js,
//      the battle lists). The browser verifier
//      (tools/verify_translated_shop.mjs) refuses a screen that reports anything
//      else, and it also aborts every assets/native/** request.
//
// The translated BUY machine's own numbers are driven against the decoded
// tables too: the "How many?" ceiling it seeds is recomputed here from the
// decoded item record's +4 buy price, and the spinner is checked to clamp to it
// rather than pass it. tests/shop-task-composition.test.js drives the buy and
// sell commits (wallet pays +4, receives +6, held moves) on the same tables.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { ShopRootSession } from "../engine/dw3/ui/shop-root-session.ts";
import { itemRecord } from "../engine/dw3/item-record.ts";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const descriptorFiles = (catalog) => catalog.itemDescriptors.map((row) =>
  new Uint8Array(readFileSync(new URL(`../web/assets/data/${row.file}`, import.meta.url))));

function merchantResources() {
  const catalog = json("../web/assets/data/shop_catalog.json");
  return {
    catalog,
    font: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_font.bin", import.meta.url))),
    itemRecords: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_item_records.bin", import.meta.url))),
    descriptors: descriptorFiles(catalog),
    banks: new Map([0x63, 0x6a, 0x71, 0x94].map((offset) => {
      const id = offset + 2;
      return [id, new Uint8Array(readFileSync(new URL(`../web/assets/data/shop-banks/${id}.bin`, import.meta.url)))];
    })),
  };
}

/** The engine/native modules a bundle of these entry points can reach. */
async function nativeInputs(entryPoints) {
  const result = await build({ entryPoints, outdir: "/tmp/shop-execution-forbidden",
    bundle: true, write: false, metafile: true, format: "esm" });
  return Object.keys(result.metafile.inputs).filter((path) => path.startsWith("engine/native/"));
}

test("the merchant and card-shop controllers link data memory, never an interpreter", async () => {
  const native = await nativeInputs([
    "engine/dw3/ui/shop-root-session.ts",
    "engine/dw3/ui/card-shop-session.ts",
  ]);
  assert.deepEqual(native, ["engine/native/memory.ts"],
    "the shop controllers must reach only the data buffer, no runtime, bridge or loader");
});

test("the interpreter check detects the interpreter when a graph links one", async () => {
  // Negative control: the research entry engine/native-entry.ts owns the
  // interpreter (the production barrel engine/index.ts no longer reaches one
  // after the 2026-10-06 bundle split). If the check above could not see
  // engine/native/runtime.ts, this assertion would not either.
  const flagged = await nativeInputs(["engine/native-entry.ts"]);
  assert.ok(flagged.includes("engine/native/runtime.ts"),
    `expected the interpreter in the research-entry graph, saw ${JSON.stringify(flagged)}`);
});

test("the merchant and card-shop adapters declare translated execution and link no interpreter host", () => {
  for (const file of ["web/shop-translated.js", "web/cardshop-translated.js"]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /execution:\s*"translated"/, `${file} declares translated execution`);
    assert.doesNotMatch(source, /native-screen-host|native\/runtime|native\/bridge|native\/cpu/,
      `${file} must not link an interpreter host`);
  }
});

test("the translated BUY quantity ceiling is the decoded min(money/price, 99-held)", () => {
  const session = new ShopRootSession(0, 2, { bits: 0, inventory: [], party: [] },
    merchantResources(), { playSound() {}, closeSave() {} });
  const { mem, root } = session;
  const reach = (address, value, limit = 120) => {
    for (let frame = 0; frame < limit && mem.read32(address) !== value; frame++) session.tick([]);
    assert.equal(mem.read32(address), value, `word ${address.toString(16)} reached ${value}`);
  };
  reach(root + 0x10, 3);
  session.tick(["circle"]);
  session.tick([]);
  const rootContext = mem.read32(root + 0x24) >>> 0;
  let actor = 0;
  for (let frame = 0; frame < 120; frame++) {
    actor = mem.read32(rootContext + 0x1c) >>> 0;
    if (actor && mem.read32(actor + 0x10) === 3) break;
    session.tick([]);
  }
  assert.ok(actor, "the BUY actor opened");
  // The first stock row's item id, and its decoded record's +4 buy price.
  const actorContext = mem.read32(actor + 0x24) >>> 0;
  const list = mem.read32(actorContext) >>> 0;
  const item = mem.read16(mem.read32(list + 0x6b4));
  const price = mem.read16(itemRecord(item) + 4);
  assert.ok(price > 0, `decoded buy price for stock item ${item}`);
  const money = price * 3 + 5; // affordable for exactly three copies
  mem.write32(0x80048da0, money); // BUY_MONEY (0x80048d34 + 0x6C)
  session.tick(["circle"]);
  session.tick([]);
  reach(actor + 0x10, 8); // the "How many?" spinner
  assert.equal(mem.read32(actor + 0x68), 3, "ceiling is min(money/price, 99-held)");
  assert.equal(mem.read32(actor + 0x64), 1, "quantity starts at one");
  for (let step = 0; step < 8; step++) {
    session.tick(["up"]);
    session.tick([]);
  }
  assert.equal(mem.read32(actor + 0x10), 8, "the spinner stays open");
  assert.equal(mem.read32(actor + 0x64), 3, "quantity clamps to the ceiling rather than passing it");
});
