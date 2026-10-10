import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeMemory } from "../engine/native/memory.ts";
import { TranslatedTaskTree } from "../engine/dw3/ui/translated-task-tree.ts";
import { constructShopTask } from "../engine/dw3/ui/shop-task-allocation.ts";
import { installShopCatalog, SHOP_NAMES_BASE } from "../engine/dw3/ui/shop-catalog.ts";
import { shopLoad, SHOP_STOCK_CELL } from "../engine/dw3/ui/shop-stock.ts";
import { itemRecord } from "../engine/dw3/item-record.ts";
import { shopRootCreate, SHOP_ROOT_HANDLER, SHOP_ROOT_SIZE, SHOP_ROOT_EXTRA } from "../engine/dw3/ui/shop-root.ts";
import { shopActorBuy, SHOP_ACTOR_BUY_HANDLER, SHOP_ACTOR_BUY_SIZE, SHOP_ACTOR_BUY_EXTRA } from "../engine/dw3/ui/shop-actor.ts";
import { shopListCreate, SHOP_LIST_TICK, SHOP_LIST_SIZE, SHOP_LIST_EXTRA_SIZE } from "../engine/dw3/ui/shop-list-create.ts";
import { bandCreate, BAND_HANDLER, BAND_SIZE, BAND_EXTRA } from "../engine/dw3/ui/band-highlight.ts";
import { installShopFont, SHOP_FONT_BASE, SHOP_FONT_SIZE } from "../engine/dw3/ui/shop-font.ts";
import { ShopTextBanks } from "../engine/dw3/ui/shop-text-banks.ts";
import { ShopWidgetServices } from "../engine/dw3/ui/shop-widget-services.ts";
import { ShopRootSession } from "../engine/dw3/ui/shop-root-session.ts";
import { UI_ICON_FIELDS } from "../engine/dw3/ui/spawn-ui-icon.ts";
import { ShopPadInput } from "../engine/dw3/ui/shop-pad-input.ts";
import { seedShopSaveState, readShopSaveState, SHOP_HELD_BASE } from "../engine/dw3/ui/shop-save-state.ts";

const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const descriptorFiles = (catalog) => catalog.itemDescriptors.map((row) =>
  new Uint8Array(readFileSync(new URL(`../web/assets/data/${row.file}`, import.meta.url))));

test("merchant buttons reach the translated confirm, card and back codes on press edges", () => {
  const pad = new ShopPadInput();
  for (const [button, code] of [["circle", 0xd], ["triangle", 0xc], ["cross", 0xe]]) {
    pad.update([]);
    pad.update([button]);
    assert.ok((pad.pressed() & (1 << pad.buttonBit(code))) !== 0, button);
    pad.update([button]);
    assert.equal(pad.pressed() & (1 << code), 0, `${button} held`);
  }
  pad.update(["up"]);
  assert.ok((pad.pressed() & (1 << 4)) !== 0);
});

test("merchant save adapter preserves wallet, bag and six worn slots after task writes", () => {
  const mem = new NativeMemory();
  seedShopSaveState(mem, {
    bits: 10000,
    inventory: [{ id: 1, qty: 99 }],
    party: [{ rosterSlot: 0, equipment: { head: 3, body: 4, right: 1, left: 2, acc0: 5, acc1: 6 } }],
  });
  mem.write32(0x80048da0, 9800);
  mem.write8(SHOP_HELD_BASE + 1, 100); // A displaced worn item can exceed 99 in RAM.
  mem.write16(0x80049494 + 0x3cc, 7);
  assert.deepEqual(readShopSaveState(mem), {
    bits: 9800,
    inventory: [{ id: 1, qty: 100 }],
    equipment: [{ head: 3, body: 4, right: 7, left: 2, acc0: 5, acc1: 6 }],
    // The hand swaps the screen performed, handed on with the result so the
    // walker can replay them through the store (tests/shop-hand-swap-close.test.js).
    swaps: [],
  });
});

test("translated shop widgets use extracted bank text and resident glyph widths", () => {
  const mem = new NativeMemory();
  const font = new Uint8Array(readFileSync(new URL("../web/assets/data/shop_font.bin", import.meta.url)));
  assert.equal(font.length, SHOP_FONT_SIZE);
  installShopFont(mem, font);
  assert.equal(mem.read32(0x8004de00) >>> 0, SHOP_FONT_BASE);
  const language = 2;
  const banks = new Map([0x63, 0x6a, 0x71, 0x94].map((offset) => {
    const id = offset + language;
    return [id, new Uint8Array(readFileSync(new URL(`../web/assets/data/shop-banks/${id}.bin`, import.meta.url)))];
  }));
  const widgets = new ShopWidgetServices(mem, new ShopTextBanks(mem, language, banks));
  const title = widgets.createTextElement(0, 1, 52, 24);
  const nameSource = widgets.banks.source(0x94 + language);
  widgets.textSet(title, nameSource, 1);
  const width = widgets.textMeasure(title, 1);
  assert.ok(width > 0 && width < 320, `merchant name width ${width}`);
  assert.equal(mem.read16(title + 0xbc), width);
  const money = widgets.createTextElement(0, 3, 156, 24);
  widgets.textNumber(money, 0, 12345);
  assert.ok(widgets.textMeasure(money, 1) > 0);
  assert.equal(mem.read32(money + 0x50) >>> 0, SHOP_FONT_BASE + 3 * 0x18);
});

test("the translated merchant root opens its name, BIT and BUY/SELL choices", () => {
  const catalog = json("../web/assets/data/shop_catalog.json");
  const font = new Uint8Array(readFileSync(new URL("../web/assets/data/shop_font.bin", import.meta.url)));
  const itemRecords = new Uint8Array(readFileSync(new URL("../web/assets/data/shop_item_records.bin", import.meta.url)));
  const language = 2;
  const banks = new Map([0x63, 0x6a, 0x71, 0x94].map((offset) => {
    const id = offset + language;
    return [id, new Uint8Array(readFileSync(new URL(`../web/assets/data/shop-banks/${id}.bin`, import.meta.url)))];
  }));
  const unused = () => { throw new Error("Selected child route before root test ended"); };
  const session = new ShopRootSession(0, language,
    { bits: 12345, inventory: [], party: [] },
    { catalog, font, itemRecords, descriptors: descriptorFiles(catalog), banks },
    { playSound() {}, closeSave: unused });
  const { mem, root } = session;
  for (let frame = 0; frame < 36 && mem.read32(root + 0x10) !== 3; frame++) session.tick();
  assert.equal(mem.read32(root + 0xc), 1);
  assert.equal(mem.read32(root + 0x10), 3);
  const labels = mem.read32(root + 0x24) >>> 0;
  for (const slot of [0, 4, 8, 12, 16, 20]) {
    const widget = mem.read32(labels + slot) >>> 0;
    assert.ok(widget > 0, `label slot ${slot}`);
    assert.ok(mem.read32(widget + 0x5c) !== 0, `label slot ${slot} has text`);
  }
  assert.ok(mem.read16(mem.read32(labels + 8) + 0xbc) > 0, "BIT digits measured");
  assert.equal(mem.read32(mem.read32(labels + 0x18) + UI_ICON_FIELDS.visible), 1);
  const clips = session.draw.calls.filter((call) => call.method === "drawSprite").map((call) => call.args[1]);
  assert.ok(clips.includes(1) && clips.includes(2) && clips.includes(5));
  const cursor = mem.read32(labels + 0x18) >>> 0;
  const cursorText = mem.read32(mem.read32(cursor + UI_ICON_FIELDS.secondaryPtr)) >>> 0;
  assert.ok(session.widgets.textWidgets().some((widget) => widget.addr === cursorText));
  const frames = new Set();
  for (let frame = 0; frame < 60; frame++) {
    session.tick();
    frames.add(mem.read32(cursor + 0x6c));
  }
  assert.equal(mem.read32(cursor + 0x0c), 1);
  assert.ok(frames.has(0) && frames.has(1) && frames.has(4), "cursor cycles extracted glyphs");
});

test("merchant confirmation opens the translated BUY stock list and item panel", () => {
  const catalog = json("../web/assets/data/shop_catalog.json");
  const resources = {
    catalog,
    font: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_font.bin", import.meta.url))),
    itemRecords: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_item_records.bin", import.meta.url))),
    descriptors: descriptorFiles(catalog),
    banks: new Map([0x63, 0x6a, 0x71, 0x94].map((offset) => {
      const id = offset + 2;
      return [id, new Uint8Array(readFileSync(new URL(`../web/assets/data/shop-banks/${id}.bin`, import.meta.url)))];
    })),
  };
  const unused = () => { throw new Error("Merchant return path was reached"); };
  const session = new ShopRootSession(0, 2,
    { bits: 12345, inventory: [], party: [] }, resources,
    { playSound() {}, closeSave() {} });
  const { mem, root } = session;
  for (let frame = 0; frame < 40 && mem.read32(root + 0x10) !== 3; frame++) session.tick();
  assert.equal(mem.read32(root + 0x10), 3);
  session.tick(["circle"]);
  session.tick([]);
  const rootContext = mem.read32(root + 0x24) >>> 0;
  let actor = 0;
  for (let frame = 0; frame < 120; frame++) {
    actor = mem.read32(rootContext + 0x1c) >>> 0;
    if (actor && mem.read32(actor + 0x10) === 3) break;
    session.tick([]);
  }
  assert.ok(actor, "BUY actor created");
  assert.equal(mem.read32(actor + 0x10), 3, "BUY list ready for input");
  const actorContext = mem.read32(actor + 0x24) >>> 0;
  const list = mem.read32(actorContext) >>> 0;
  const band = mem.read32(actorContext + 4) >>> 0;
  assert.ok(list && band, "stock list and item panel are live tasks");
  assert.equal(mem.read32(list + 0x6c0), catalog.records[0].count);
  assert.equal(mem.read32(band + 0x10), 3);
  assert.ok(session.widgets.textWidgets().length > 6, "BUY labels use native widgets");
  mem.write32(0x80048da0, 0);
  session.tick(["circle"]);
  assert.equal(mem.read32(actor + 0x10), 0x2d, "empty wallet shows refusal");
  session.tick([]);
  for (let frame = 0; frame < 30 && mem.read32(actor + 0x10) !== 47; frame++) session.tick([]);
  session.tick(["circle"]);
  for (let frame = 0; frame < 40 && mem.read32(actor + 0x10) !== 3; frame++) session.tick([]);
  assert.equal(mem.read32(actor + 0x10), 3, "refusal returns to the stock list");
  session.tick([]);
  mem.write32(0x80048da0, 12345);
  const item = mem.read16(mem.read32(list + 0x6b4));
  const price = mem.read16(itemRecord(item) + 4);
  session.tick(["circle"]);
  session.tick([]);
  for (let frame = 0; frame < 60 && mem.read32(actor + 0x10) !== 8; frame++) session.tick([]);
  assert.equal(mem.read32(actor + 0x10), 8, "quantity choice opens");
  session.tick(["circle"]);
  session.tick([]);
  for (let frame = 0; frame < 60 && mem.read32(actor + 0x10) !== 17; frame++) session.tick([]);
  assert.equal(mem.read32(actor + 0x10), 17, "Buy/No choice opens");
  session.tick(["circle"]);
  assert.equal(mem.read8(0x80048db0 + item), 1, "bag receives one item");
  assert.equal(mem.read32(0x80048da0), 12345 - price, "wallet pays item price");
  session.tick([]);
  for (let frame = 0; frame < 80 && mem.read32(actor + 0x10) !== 3; frame++) session.tick([]);
  assert.equal(mem.read32(actor + 0x10), 3, "purchase returns to stock list");
  session.tick(["cross"]);
  session.tick([]);
  for (let frame = 0; frame < 100 && mem.read32(rootContext + 0x1c); frame++) session.tick([]);
  assert.equal(mem.read32(rootContext + 0x1c), 0, "BUY tasks close");
  for (let frame = 0; frame < 80 && mem.read32(root + 0x10) !== 3; frame++) session.tick([]);
  assert.equal(mem.read32(root + 0x10), 3, "merchant choices reopen");
  assert.equal(session.widgets.textWidgets().length, 7, "closed BUY widgets leave the painter");
  session.tick(["cross"]);
  session.tick([]);
  for (let frame = 0; frame < 100 && !session.finished(); frame++) session.tick([]);
  assert.ok(session.finished(), "merchant closes after the fade");
});

test("merchant SELL opens a held-item list from the translated category task", () => {
  const catalog = json("../web/assets/data/shop_catalog.json");
  const banks = new Map([0x63, 0x6a, 0x71, 0x94].map((offset) => {
    const id = offset + 2;
    return [id, new Uint8Array(readFileSync(new URL(`../web/assets/data/shop-banks/${id}.bin`, import.meta.url)))];
  }));
  const unused = () => { throw new Error("Merchant return path was reached"); };
  const session = new ShopRootSession(0, 2,
    { bits: 12345, inventory: [{ id: 92, qty: 2 }], party: [] },
    { catalog, banks, descriptors: descriptorFiles(catalog),
      font: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_font.bin", import.meta.url))),
      itemRecords: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_item_records.bin", import.meta.url))) },
    { playSound() {}, closeSave: unused });
  const { mem, root } = session;
  for (let frame = 0; frame < 40 && mem.read32(root + 0x10) !== 3; frame++) session.tick([]);
  session.tick(["down"]);
  session.tick([]);
  session.tick(["circle"]);
  const rootContext = mem.read32(root + 0x24) >>> 0;
  let actor = 0;
  for (let frame = 0; frame < 100; frame++) {
    actor = mem.read32(rootContext + 0x1c) >>> 0;
    if (actor && mem.read32(actor + 0x10) === 2) break;
    session.tick([]);
  }
  assert.ok(actor, "SELL actor created");
  assert.equal(mem.read32(actor + 0x10), 2, "category choices open");
  session.tick(["down"]);
  session.tick([]);
  session.tick(["circle"]);
  session.tick([]);
  const actorContext = mem.read32(actor + 0x24) >>> 0;
  let list = 0;
  for (let frame = 0; frame < 80; frame++) {
    list = mem.read32(actorContext) >>> 0;
    if (list && mem.read32(list + 0x6c0) > 0) break;
    session.tick([]);
  }
  assert.ok(list, "SELL list task created");
  assert.ok(mem.read32(list + 0x6c0) > 0, "held weapon appears in category");
  assert.equal(mem.read16(list + 0x64), 92);
  for (let frame = 0; frame < 100 && mem.read32(actor + 0x10) !== 6; frame++) session.tick([]);
  assert.equal(mem.read32(actor + 0x10), 6, "held-item choice opens");
  session.tick(["circle"]);
  session.tick([]);
  for (let frame = 0; frame < 50 && mem.read32(actor + 0x10) !== 0x17; frame++) session.tick([]);
  assert.equal(mem.read32(actor + 0x10), 0x17, "sell quantity opens");
  session.tick(["circle"]);
  session.tick([]);
  for (let frame = 0; frame < 60 && mem.read32(actor + 0x10) !== 0x20; frame++) session.tick([]);
  assert.equal(mem.read32(actor + 0x10), 0x20, "Sell/No choice opens");
  session.tick(["circle"]);
  assert.equal(mem.read8(0x80048db0 + 92), 1, "one weapon remains in the bag");
  assert.equal(mem.read32(0x80048da0), 12445, "wallet receives sell price");
  session.tick([]);
  for (let frame = 0; frame < 100 && mem.read32(actor + 0x10) !== 6; frame++) session.tick([]);
  assert.equal(mem.read32(actor + 0x10), 6, "remaining held item stays available");
  session.tick(["cross"]);
  session.tick([]);
  for (let frame = 0; frame < 100 && mem.read32(actor + 0x10) !== 2; frame++) session.tick([]);
  assert.equal(mem.read32(actor + 0x10), 2, "category choices reopen");
  session.tick(["cross"]);
  session.tick([]);
  for (let frame = 0; frame < 100 && mem.read32(rootContext + 0x1c); frame++) session.tick([]);
  assert.equal(mem.read32(rootContext + 0x1c), 0, "SELL task closes");
});

test("translated BUY can offer equipment to an eligible partner and commit it", () => {
  const catalog = json("../web/assets/data/shop_catalog.json");
  const banks = new Map([0x63, 0x6a, 0x71, 0x94].map((offset) => {
    const id = offset + 2;
    return [id, new Uint8Array(readFileSync(new URL(`../web/assets/data/shop-banks/${id}.bin`, import.meta.url)))];
  }));
  const unused = () => { throw new Error("Merchant return path was reached"); };
  const session = new ShopRootSession(0, 2,
    { bits: 12345, inventory: [], party: [{ rosterSlot: 0, starterSlot: 0 }] },
    { catalog, banks, descriptors: descriptorFiles(catalog),
      font: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_font.bin", import.meta.url))),
      itemRecords: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_item_records.bin", import.meta.url))) },
    { playSound() {}, closeSave: unused });
  const { mem, root } = session;
  const reach = (address, value, limit = 100) => {
    for (let frame = 0; frame < limit && mem.read32(address) !== value; frame++) session.tick([]);
    assert.equal(mem.read32(address), value);
  };
  reach(root + 0x10, 3);
  session.tick(["circle"]);
  session.tick([]);
  const rootContext = mem.read32(root + 0x24) >>> 0;
  let actor = 0;
  for (let frame = 0; frame < 50; frame++) {
    actor = mem.read32(rootContext + 0x1c) >>> 0;
    if (actor) break;
    session.tick([]);
  }
  assert.ok(actor);
  reach(actor + 0x10, 3);
  session.tick(["circle"]);
  session.tick([]);
  reach(actor + 0x10, 8);
  session.tick(["circle"]);
  session.tick([]);
  reach(actor + 0x10, 17);
  session.tick(["circle"]);
  session.tick([]);
  reach(actor + 0x10, 27);
  session.tick(["circle"]);
  session.tick([]);
  reach(actor + 0x10, 32);
  session.tick(["circle"]);
  assert.equal(mem.read16(0x80049494 + 0x3cc), 92, "partner wears the bought weapon");
  assert.equal(mem.read8(0x80048db0 + 92), 0, "worn copy leaves the bag");
});

test("reopening the BUY list reuses task and widget storage", () => {
  const catalog = json("../web/assets/data/shop_catalog.json");
  const banks = new Map([0x63, 0x6a, 0x71, 0x94].map((offset) => {
    const id = offset + 2;
    return [id, new Uint8Array(readFileSync(new URL(`../web/assets/data/shop-banks/${id}.bin`, import.meta.url)))];
  }));
  const session = new ShopRootSession(0, 2,
    { bits: 500, inventory: [], party: [] },
    { catalog, banks, descriptors: descriptorFiles(catalog),
      font: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_font.bin", import.meta.url))),
      itemRecords: new Uint8Array(readFileSync(new URL("../web/assets/data/shop_item_records.bin", import.meta.url))) },
    { playSound() {}, closeSave() {} });
  const { mem, root } = session;
  const rootContext = mem.read32(root + 0x24) >>> 0;
  const until = (ready) => {
    for (let frame = 0; frame < 120 && !ready(); frame++) session.tick([]);
    assert.ok(ready(), "merchant task reached its expected state");
  };
  until(() => mem.read32(root + 0x10) === 3);
  for (let visit = 0; visit < 400; visit++) {
    try {
      session.tick(["circle"]);
      session.tick([]);
      until(() => {
        const actor = mem.read32(rootContext + 0x1c) >>> 0;
        return actor !== 0 && mem.read32(actor + 0x10) === 3;
      });
      session.tick(["cross"]);
      session.tick([]);
      until(() => mem.read32(rootContext + 0x1c) === 0 && mem.read32(root + 0x10) === 3);
      assert.equal(session.widgets.textWidgets().length, 7);
    } catch (error) { throw new Error(`BUY visit ${visit}: ${error.message}`, { cause: error }); }
  }
});

test("the translated stock loader reads every extracted merchant row", () => {
  const mem = new NativeMemory();
  const catalog = json("../web/assets/data/shop_catalog.json");
  const independent = json("../web/assets/data/shops.json").shops;
  assert.equal(catalog.records.length, independent.length);
  const itemRecords = new Uint8Array(readFileSync(new URL("../web/assets/data/shop_item_records.bin", import.meta.url)));
  installShopCatalog(mem, catalog, itemRecords, descriptorFiles(catalog));
  for (const shop of independent) {
    const stock = shopLoad(mem, shop.shop_id);
    assert.equal(mem.read32(SHOP_STOCK_CELL), shop.count, `merchant ${shop.shop_id} count`);
    assert.deepEqual(shop.items.map((item) => item.id),
      Array.from({ length: shop.count }, (_, index) => mem.read16(stock + index * 2)),
      `merchant ${shop.shop_id} items`);
    if (shop.shop_id < 30) {
      assert.equal(mem.read32(SHOP_NAMES_BASE + shop.shop_id * 4), shop.name_id,
        `merchant ${shop.shop_id} name`);
    }
  }
  assert.equal(shopLoad(mem, -1), 0);
});

test("shop constructors register only task children, leaving text widgets to their owners", () => {
  const mem = new NativeMemory();
  const visits = [];
  const classes = new Map([
    [SHOP_ROOT_HANDLER, { name: "merchant", childSlots: [0x1c], tick: () => visits.push("root") }],
    [SHOP_ACTOR_BUY_HANDLER, { name: "buy", childSlots: [0, 4], tick: () => visits.push("buy") }],
    [SHOP_LIST_TICK, { name: "list", childSlots: [], tick: () => visits.push("list") }],
    [BAND_HANDLER, { name: "band", childSlots: [], tick: () => visits.push("band") }],
  ]);
  const tree = new TranslatedTaskTree(mem, classes);
  const make = (klass, size, extra, ctor) => constructShopTask(tree, klass, size, extra, ctor);
  const root = make(SHOP_ROOT_HANDLER, SHOP_ROOT_SIZE, SHOP_ROOT_EXTRA,
    (host) => shopRootCreate(mem, host));
  const actor = make(SHOP_ACTOR_BUY_HANDLER, SHOP_ACTOR_BUY_SIZE, SHOP_ACTOR_BUY_EXTRA,
    (host) => shopActorBuy(mem, host, root));
  const list = make(SHOP_LIST_TICK, SHOP_LIST_SIZE, SHOP_LIST_EXTRA_SIZE,
    (host) => shopListCreate(mem, host, actor, 0, 0));
  const band = make(BAND_HANDLER, BAND_SIZE, BAND_EXTRA,
    (host) => bandCreate(mem, host, 0, 92));
  const rootCtx = mem.read32(root + 0x24);
  const actorCtx = mem.read32(actor + 0x24);
  const listCtx = mem.read32(list + 0x24);
  const bandCtx = mem.read32(band + 0x24);
  mem.write32(rootCtx, 0xdeadbeef); // text widget, not a task
  mem.write32(rootCtx + 0x1c, actor);
  mem.write32(actorCtx, list);
  mem.write32(actorCtx + 4, band);
  mem.write32(actorCtx + 8, 0xcafebabe); // another text widget
  mem.write32(listCtx, 0xabad1dea);
  mem.write32(bandCtx, 0xfacefeed);
  tree.tick(root);
  assert.deepEqual(visits, ["root", "buy", "list", "band"]);
  tree.dispose(root);
  assert.equal(tree.tasks.size, 0);
});

test("a shop root receives its final close callback before the task is removed", () => {
  const mem = new NativeMemory();
  const calls = [];
  const classes = new Map([[SHOP_ROOT_HANDLER, {
    name: "merchant", childSlots: [], terminalTick: true,
    tick: () => calls.push("close save context"),
  }]]);
  const tree = new TranslatedTaskTree(mem, classes);
  const root = constructShopTask(tree, SHOP_ROOT_HANDLER, SHOP_ROOT_SIZE, SHOP_ROOT_EXTRA,
    (host) => shopRootCreate(mem, host));
  mem.write32(root + 0xc, 3);
  tree.tick(root);
  assert.deepEqual(calls, ["close save context"]);
  assert.equal(tree.tasks.size, 0);
});
