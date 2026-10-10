// One writer for the bag: nothing in web/ may edit state.inventory directly.
//
// The original's inventory is two byte arrays that only F0x800161D8, F0x80015F04
// and F0x800135E8 touch (docs/research/items/item-store-shared-system-2026-10-03.md).
// The walker now has one owner for them, engine/dw3/item-store.ts, and this file
// keeps it that way: it scans every browser module for the shapes a direct edit
// takes, and then checks that each writer the gap list named actually calls the
// store. A screen that reaches past the store is how the 99 cap went missing on four
// writers in the first place.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const WEB = new URL("web/", ROOT);
const modules = readdirSync(WEB).filter((name) => name.endsWith(".js"));
const read = (name) => readFileSync(new URL(name, ROOT), "utf8");

// The shapes a direct edit of the bag takes. Each is one a store call cannot produce:
// a mutating array method called ON the array, an assignment of a whole new array,
// an indexed write, or a count written through a slot the array handed out.
const FORBIDDEN = [
  [/\.inventory\s*\.\s*(push|pop|splice|sort|reverse|shift|unshift|fill|copyWithin)\s*\(/,
    "a mutating array method called on state.inventory"],
  // `engine.state.inventory` is the ENGINE's own adapter object, not the bag array,
  // so the assignment family looks at the walker's field only.
  [/(?<!engine\.)\bstate\.inventory\s*=(?!=)/, "state.inventory replaced by assignment"],
  [/\.inventory\s*\[[^\]]+\]\s*=[^=]/, "an indexed write into state.inventory"],
  [/\binventory\s*\.\s*push\(\s*\{\s*id\s*:/, "a bag slot constructed by hand"],
];

test("no browser module edits state.inventory outside the shared store", () => {
  const offenders = [];
  for (const name of modules) {
    const src = read(`web/${name}`);
    src.split("\n").forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, "");
      for (const [pattern, why] of FORBIDDEN) {
        if (pattern.test(code)) offenders.push(`${name}:${index + 1} — ${why}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `the bag must only change through engine/dw3/item-store.ts:\n${offenders.join("\n")}`);
});

test("no browser module writes a bag slot's count through a slot it looked up", () => {
  // `state.inventory.find(...)` handing a slot to a line that then changes `.qty` is
  // the other way the array gets edited, and a line-based check is enough for it: the
  // lookup ends its line, the write is on the next.
  const offenders = [];
  for (const name of modules) {
    const lines = read(`web/${name}`).split("\n");
    lines.forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, "");
      if (!/\.inventory[\s\S]*\.find\(/.test(code)) return;
      if (code.trimEnd().endsWith(";")) {
        const next = (lines[index + 1] ?? "").replace(/\/\/.*$/, "");
        if (/\.qty\s*(\+\+|--|[+\-*/]?=)/.test(next)) {
          offenders.push(`${name}:${index + 2} — a looked-up slot's count is written: ${next.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

// The WORNED count is the original's second byte array (`base + 0x20F + id`) and
// the number both "Equip n" figures read, so the same rule holds for it: only the
// store's four wear paths may write it.
const FORBIDDEN_WORN = [
  [/\bstate\.worn\s*=(?!=)/, "state.worn replaced by assignment"],
  [/\bstate\.worn\s*\[[^\]]+\]\s*=[^=]/, "an indexed write into state.worn"],
  [/delete\s+state\.worn\b/, "a worn entry deleted outside the store"],
];

test("no browser module edits the worn count array outside the shared store", () => {
  const offenders = [];
  for (const name of modules) {
    read(`web/${name}`).split("\n").forEach((line, index) => {
      const code = line.replace(/\/\/.*$/, "");
      for (const [pattern, why] of FORBIDDEN_WORN) {
        if (pattern.test(code)) offenders.push(`${name}:${index + 1} — ${why}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    `the worn count must only change through engine/dw3/item-store.ts:\n${offenders.join("\n")}`);
});

test("every screen that shows \"Equip n\" reads the stored worn byte", () => {
  // The two figures the original draws: the merchant's info band (stitshop
  // 0x80089ECC) and the pause ITEMS page's detail band (ststatus 0x8008F16C).
  const shop = read("web/shop.js");
  assert.match(shop, /sh\._counts = \(state, id\) => \(\{ equip: wornCount\(state, id\)/,
    "the merchant band reads the stored worn byte");
  const menu = read("web/menu.js");
  assert.match(menu, /valueText\(ctx, equippedCountOf\(state, held\.id\)/,
    "the pause ITEMS band draws a count");
  assert.match(menu, /function equippedCountOf\(state, itemId\) \{\s*\n\s*ensureEquipment\(state\);\s*\n\s*return wornCount\(state, Number\(itemId\)\);/,
    "and that count IS the stored worn byte, not a scan of the wearer record");
  // Both native pages seed the byte into the save block they hand the original's
  // own code, so the ported `0x20F` loads read it.
  for (const file of ["web/status-native.js", "web/shop-native.js"]) {
    assert.match(read(file), /WORN_COUNTS \+ id, Math\.max\(0, Math\.min\(WORN_MAX, wornCount\(state, id\)\)\), 1\)/,
      `${file} seeds the worn array into the save block`);
  }
  assert.match(read("web/status-translated.js"),
    /const worn = wornItemIds\(state\)\.map\(\(id\) => \(\{ id, qty: wornCount\(state, id\) \}\)\);/,
    "the translated pause page seeds it too");
});

const CALLERS = [
  ["web/game.js", /if \(expected\) storeAddItem\(state, itemId, 1\);\s*\n\s*else \{\s*\n\s*storeRemoveItem\(state, itemId, 1\);/,
    "the story set_flag grant/take on the item banks"],
  ["web/game.js", /\(count <= 1 \? ownsItem\(state, id\) : heldCount\(state, id\) >= count\)/,
    "the engine's inventory adapter"],
  ["web/game.js", /clearBag\(state\); \/\/ the new-game path/,
    "the new-game reset"],
  // STEAL still commits through the shared store; what changed on 2026-10-04 is the
  // return shape -- it now answers `{ text, page }` so the box can put up the
  // original's kind-17 steal page instead of a walker-typed suffix.
  ["web/battle.js", /storeAddItem\(state, item\.id, 1\);\s*\n\s*localStorage\.setItem\("inventory", JSON\.stringify\(state\.inventory\)\);\s*\n\s*const name = battleMsgText\(0x6a, item\.id\)[\s\S]*?return \{\s*\n\s*text: ` Stole \$\{item\.name\}!`,\s*\n\s*page: battleMessagePage\(17,/,
    "STEAL"],
  ["web/battle.js", /storeAddItem\(state, item\.id, 1\);\s*\n\s*applied = true;/,
    "the enemy's drop"],
  ["web/battle.js", /storeRemoveItem\(state, item\.id, 1\);/, "the battle item consume"],
  ["web/battle.js", /return listItemIds\(state, 1\)/, "the in-battle ITEM list"],
  ["web/menu.js", /commitEquipSlot\(state, m\.detailIdx, slotKey, slots\);/,
    "the pause menu's equip swap and its unequip"],
  ["web/menu.js", /unequipItem\(slots, slotKey\);/,
    "the pause menu's Unequip row"],
  ["web/menu.js", /m\.itemList = \(state\) => listItemIds\(state, ITEM_CAT_DIRECTORIES\[m\.itemCat\] \?\? 1\)/,
    "the pause ITEMS tabs"],
  ["web/shop.js", /addItem: \(id, n\) => storeAddItem\(state, id, n\),/, "the merchant's buy commit"],
  ["web/shop.js", /removeItem: \(id, n\) => storeRemoveItem\(state, id, n\),/, "the merchant's sell commit"],
  ["web/shop.js", /commitEquipEvent\(state, mi, swap\.equipment\);/,
    "the merchant's equip swap"],
  ["web/shop.js", /const sellQty = Math\.min\(sh\.qty, heldCount\(state, slot\.id\)\);/,
    "the merchant's SELL commit, carried copies only"],
  ["web/shop.js", /\{ equip: wornCount\(state, id\), bag: heldCount\(state, id\) \}/,
    "the merchant's Equip/Items columns, reading the stored worn byte"],

  // Both pause routes commit through ONE routine (2026-10-04): they used to carry a
  // copy each, and the order that copy has to obey had already drifted once.
  ["engine/dw3/ui/pause-close-commit.ts", /reconcileHeldCounts\(state, input\.inventory \?\? \[\]\);/,
    "the pause page's commit, both routes"],
  ["engine/dw3/ui/pause-close-commit.ts", /setEquippedItem\(state, slot, name, id\);/,
    "the pause page's worn-slot diff, both routes"],
  ["web/status-translated.js", /commitPauseClose\(\{/, "the translated pause page calls it"],
  ["web/status-native.js", /commitPauseClose\(\{/, "the reference pause page calls it"],
  ["engine/dw3/ui/shop-close-commit.ts", /commitEquipEvent\(state, swap\.party, swap\.equipment\);/,
    "the translated merchant's equip swap"],
  ["engine/dw3/ui/shop-close-commit.ts", /reconcileHeldCounts\(state, result\.inventory\);/, "the translated merchant's commit"],
  ["web/shop-native.js", /reconcileHeldCounts\(state, inventory\);/, "the reference merchant's commit"],
  ["web/fightreport-translated.js", /setHeldCount\(state, itemId, session\.heldCount\(itemId\), heldCount\(state, itemId\)\);/,
    "the post-battle report's commit"],
  ["web/fightreport-native.js", /setHeldCount\(state, itemId, readHostHeld\(itemId\), heldCount\(state, itemId\)\);/,
    "the reference report's commit"],
  // The save image and the report's seed both carry the block's TWO count arrays
  // for all 402 ids (item store gap 7): these pin the seed to the shared writer,
  // because a per-route `id < 256` filter there loses every accessory in the band.
  ["web/save-native.js", /writeItemArrays\(\{ write8:[\s\S]*?\},\s*itemCountEntries\(state\), SAVE\);/,
    "the reference card screen's bag seed"],
  ["web/save-translated.js", /bag: itemCountEntries\(state\),/, "the card screen's bag seed"],
  ["web/fightreport-native.js", /writeItemArrays\(\{ write8:[\s\S]*?\},\s*itemCountEntries\(state\), SAVE\);/,
    "the reference report's bag seed"],
  ["web/fightreport-translated.js", /bag: itemCountEntries\(state\),/, "the report's bag seed"],
  ["web/debugPanel.js", /storeAddItem\(state, item\.id, 1\);/, "the debug panel's grant"],
];

test("every writer the gap list named calls the shared store", () => {
  const missing = [];
  for (const [file, pattern, what] of CALLERS) {
    if (!pattern.test(read(file))) missing.push(`${file}: ${what}`);
  }
  assert.deepEqual(missing, [], `these writers must go through engine/dw3/item-store.ts:\n${missing.join("\n")}`);
});

test("the scan is not vacuous: every forbidden shape is caught", () => {
  // A scanner that matches nothing proves nothing, so each shape is fed to the same
  // patterns the scan above uses.
  const offenders = (src) => {
    const hits = [];
    src.split("\n").forEach((line) => {
      const code = line.replace(/\/\/.*$/, "");
      for (const [pattern, why] of FORBIDDEN) if (pattern.test(code)) hits.push(why);
    });
    return hits;
  };
  // A push of a slot trips two patterns (the mutator and the hand-built slot); the
  // point is that each shape trips at least one.
  assert.ok(offenders("state.inventory.push({ id: 43, qty: 1 });").length >= 1);
  assert.ok(offenders("state.inventory.splice(1, 1);").length >= 1);
  assert.ok(offenders("state.inventory = [];").length >= 1);
  assert.ok(offenders("state.inventory[0] = { id: 1, qty: 1 };").length >= 1);
  assert.ok(offenders("inventory.push({ id: 43, qty: 1 });").length >= 1);
  // Another module's own arrays are none of this test's business.
  assert.deepEqual(offenders("ps.formLedger.push({ id: prof.id, formLevel: 1 });"), []);
  // Reads, and a comment that mentions the array, must not trip it.
  assert.deepEqual(offenders("const rows = state.inventory.filter((s) => s.qty > 0);"), []);
  assert.deepEqual(offenders("localStorage.setItem('inventory', JSON.stringify(state.inventory));"), []);
  assert.deepEqual(offenders("// state.inventory.push({ id: 1, qty: 1 }) used to live here"), []);
});
