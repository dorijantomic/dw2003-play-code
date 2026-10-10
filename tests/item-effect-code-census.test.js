// CENSUS: every item effect code the disc ships, tied to the branch of the ORIGINAL that
// consumes it, in each context where the original consumes it.
//
// The two contexts are two different dispatchers and they key on different things:
//
//   FIELD  `pro/ststatus.s` file 0xC8D4 (the pause ITEMS applier) dispatches on the
//          effect record's byte +1 — the "effect code". Codes 0x01 and 0x11 have their
//          own compares; 0x02..0x10 walk the six-byte table at RAM 0x8009A8DC; 0x00 and
//          anything with no table entry stop on the refusal.
//   BATTLE `pro/fightstg.s` .L0x80082F1C is a 48-word jump table on **ItemId − 43**, not
//          on the code. So a code's battle arm is the handler its items happen to land
//          in, and an effect code with no battle arm is not a gap: its items' class
//          byte (record byte +0) has bit 1 clear, so they never enter the ITEM list.
//
// Every number below is read out of the disc's own bytes, never typed in: the master
// item table and each effect record out of `resident.bin`, the battle jump table out of
// `pro_fightstg.bin`, the field boost table out of `pro_ststatus.bin`. A re-extraction
// that moved a record fails here instead of silently changing what an item does.
//
// Ledger: ITEM-Q001 (catalog frontier). Claim: item-effect-code-dispatch-census-2026-10-05.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ITEM_BY_ID, itemUsableInField, itemUsableInBattle, useItem } from "../engine/dw3/items.ts";
import {
  applyFieldItemEffect, fieldItemMessageId, FIELD_ITEM_BOOST_TABLE,
  EFFECT_HP_CHARGE, EFFECT_TP_CHIP, MESSAGE_NO_EFFECT, IDX_HP, IDX_MAX_HP, IDX_MAX_MP,
  IDX_TP, IDX_CORE_BASE, IDX_ELEMENT_BASE,
} from "../engine/dw3/item-effect.ts";
import { isBattleEffectItem, useBattleItem } from "../engine/dw3/battle-items.ts";
import { ELEMENT_KEYS } from "../engine/dw3/effective-stats.ts";
import { ITEM_BOOST_TABLE } from "../engine/dw3/ui/native/pause-bag.ts";

const RESIDENT_BASE = 0x80010000;
const FIGHT_BASE = 0x80082cb0;
const STATUS_BASE = 0x80082cb0;
const ITEM_RECORD_TABLE = 0x80041838;
const RESOLVER_TABLE = 0x80042b98;
const FIGHT_JUMP_TABLE = 0x80082f1c;

const resident = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url)));
const fight = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/pro_fightstg.bin", import.meta.url)));
const status = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/pro_ststatus.bin", import.meta.url)));
const shipped = JSON.parse(readFileSync(new URL("../web/assets/data/item_effects.json", import.meta.url))).items;

const res32 = (addr) => new DataView(resident.buffer, resident.byteOffset).getUint32(addr - RESIDENT_BASE, true);
const fight32 = (addr) => new DataView(fight.buffer, fight.byteOffset).getUint32(addr - FIGHT_BASE, true);

/** The disc's own master item table: id -> { class byte, effect code, value }. */
function discRecords() {
  const rows = new Map();
  for (const row of shipped) {
    const pointer = res32(ITEM_RECORD_TABLE + 12 * row.id);
    if (!pointer) { rows.set(row.id, null); continue; }
    rows.set(row.id, {
      klass: resident[pointer - RESIDENT_BASE],
      code: resident[pointer - RESIDENT_BASE + 1],
      value: resident[pointer - RESIDENT_BASE + 2] | (resident[pointer - RESIDENT_BASE + 3] << 8),
    });
  }
  return rows;
}
const disc = discRecords();

/** The disc's own 48-case battle dispatch, read as ItemId -> handler address. */
const battleArm = (id) => fight32(FIGHT_JUMP_TABLE + (id - 43) * 4);
/** The disc's own six-byte field boost table, `{selector, index, cap}` per entry. */
const discBoostTable = (() => {
  const view = new DataView(status.buffer, status.byteOffset);
  const out = [];
  for (let at = ITEM_BOOST_TABLE; ; at += 6) {
    const off = at - STATUS_BASE;
    const selector = view.getInt16(off, true);
    if (selector === -1) break;
    out.push({ selector, index: view.getInt16(off + 2, true), cap: view.getInt16(off + 4, true) });
  }
  return out;
})();

// ── 1. the code census, straight out of the disc ───────────────────────────────

test("every shipped item record's effect code is read from the disc, and the set is 0x00..0x11", () => {
  assert.equal(shipped.length, 402, "the master item table has 402 rows and no gap");
  const byCode = new Map();
  for (const [id, rec] of disc) {
    if (!rec) continue;
    if (!byCode.has(rec.code)) byCode.set(rec.code, []);
    byCode.get(rec.code).push(id);
  }
  assert.deepEqual([...byCode.keys()].sort((a, b) => a - b), [...Array(18).keys()],
    "the shipped records use exactly the codes 0x00..0x11 — eighteen, no more");
  // 402 rows: 51 key items carry NO record at all, 328 records read 0x00, and the
  // remaining 23 are the consumables. Every code has to be NAMED, so each one's
  // member list is pinned here.
  assert.equal([...disc.values()].filter((r) => r === null).length, 51,
    "51 key/story items have no effect record, so the field applier never sees them");
  assert.equal(byCode.get(0).length, 328,
    "0x00: the 25 battle disks/plugs, 35 booster packs, 200 equipment and 68 accessory records");
  assert.deepEqual(byCode.get(0).slice(0, 26), [66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76,
    77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91],
    "0x00 starts at the battle band; the boosters and gear follow it");
  assert.deepEqual(byCode.get(EFFECT_HP_CHARGE), [43, 44, 45, 46], "0x01: the four HP charges");
  assert.deepEqual(byCode.get(2), [47], "0x02: the HP Chip");
  assert.deepEqual(byCode.get(3), [48], "0x03: the MP Chip");
  assert.deepEqual(byCode.get(4), [49], "0x04: the Strength chip");
  assert.deepEqual(byCode.get(11), [56], "0x0b: the Water chip");
  assert.deepEqual(byCode.get(16), [61], "0x10: the Dark chip");
  assert.deepEqual(byCode.get(EFFECT_TP_CHIP), [62, 63, 64, 65], "0x11: the four TP chips");
  // The walker's own table must carry the same code for the same item. Gear's own
  // record byte +0 is a WEAR mask (slot 15 = both hands), not a use class, so only the
  // consumable/booster rows are comparable here.
  for (const row of shipped) {
    const rec = disc.get(row.id);
    if (!rec || (row.category !== "consumable" && row.category !== "booster")) continue;
    assert.equal(ITEM_BY_ID[row.id].itemClass, rec.klass, `item ${row.id} class byte`);
    assert.equal(ITEM_BY_ID[row.id].selector, rec.code, `item ${row.id} effect code`);
  }
});

// ── 2. the field context: one decided arm per code ─────────────────────────────

/** A stat block the ported applier can write, with every field far from its cap. */
function probeTarget() {
  const cells = new Map();
  for (let i = 1; i <= 18; i++) cells.set(i, 100);
  // The two scalars the 0x01 and 0x11 arms REFUSE on when they are not below their own
  // limit: HP must be under max HP, TP under 99. Everything else sits far under 999.
  cells.set(IDX_MAX_HP, 1000);
  cells.set(IDX_TP, 40);
  return {
    cells,
    read: (i) => cells.get(i) ?? 0,
    write: (i, v) => cells.set(i, v),
  };
}

test("the field dispatch's own table is the one the applier walks, and covers 0x02..0x10", () => {
  assert.deepEqual(discBoostTable, FIELD_ITEM_BOOST_TABLE.map((e) => ({ ...e })),
    "engine/dw3/item-effect.ts FIELD_ITEM_BOOST_TABLE is the disc's table at 0x8009A8DC");
  assert.deepEqual(discBoostTable.map((e) => e.selector), [...Array(15).keys()].map((i) => i + 2),
    "the table walks exactly the codes 0x02..0x10; 0x00, 0x01 and 0x11 are elsewhere");
  // The two codes with their own compares, and the two caps the table carries.
  assert.deepEqual(
    discBoostTable.filter((e) => e.cap === 9999).map((e) => e.index), [IDX_MAX_HP, IDX_MAX_MP]);
  assert.equal(discBoostTable.filter((e) => e.cap === 999).length, 13);
});

test("every effect code in the shipped table lands on exactly one decided field arm", () => {
  const arms = new Map();
  for (let code = 0; code <= 0x11; code++) {
    const target = probeTarget();
    const before = new Map(target.cells);
    // rand() returns 0, so a chip's roll is 1 for every code (`rand() % value + 1`).
    const outcome = applyFieldItemEffect(target, code, 30, () => 0);
    const moved = [...target.cells].filter(([i, v]) => v !== before.get(i)).map(([i]) => i);
    arms.set(code, { flag: outcome.flag, index: outcome.index, moved, used: outcome.used });
    assert.ok(moved.length <= 1, `code 0x${code.toString(16)} moved ${moved.length} fields`);
    assert.equal(moved.length === 1, outcome.flag !== 0,
      `code 0x${code.toString(16)} either moves one field or refuses outright`);
  }
  // 0x00 and anything outside the table refuse; nothing is spent, nothing is written.
  assert.deepEqual([arms.get(0).flag, arms.get(0).index], [0, -1]);
  const outside = probeTarget();
  const refused = applyFieldItemEffect(outside, 0x12, 30, () => 0);
  assert.deepEqual([refused.flag, refused.index], [0, -1],
    "a code with no own arm and no table entry refuses exactly like 0x00");
  // 0x01 HP, 0x11 TP, and one entry per code 0x02..0x10 — fifteen distinct fields.
  assert.equal(arms.get(EFFECT_HP_CHARGE).index, IDX_HP);
  assert.equal(arms.get(EFFECT_TP_CHIP).index, IDX_TP);
  const raised = [...arms.values()].filter((a) => a.flag !== 0).map((a) => a.index);
  assert.equal(raised.length, 17, "0x01, 0x11 and the fifteen table codes each raise one field");
  assert.deepEqual([...new Set(raised)].sort((a, b) => a - b),
    [IDX_TP, IDX_HP, IDX_MAX_HP, IDX_MAX_MP, ...Array.from({ length: 13 }, (_, i) => IDX_CORE_BASE + i)],
    "and the fields are TP, HP, max HP, max MP, the six core stats and the seven element tolerances");
  // The roll is reported even when the cap clipped the real rise (`$s3` is the roll and
  // the clamp at :12960/:12963 never touches it). rand() = 29 over a divisor of 30 gives
  // the largest roll the code can produce, so 990 + 30 clips at both caps.
  for (const [code, index, cap] of [[2, IDX_MAX_HP, 9999], [4, IDX_CORE_BASE, 999], [16, IDX_ELEMENT_BASE + 6, 999]]) {
    const clipped = probeTarget();
    clipped.write(index, cap - 9);
    const r = applyFieldItemEffect(clipped, code, 30, () => 29);
    assert.equal(r.flag, 1);
    assert.equal(r.used, 30, `code 0x${code.toString(16)} reports its roll, not the clipped rise`);
    assert.equal(clipped.read(index), cap, "and the cap still holds");
    assert.equal(r.delta, 9, "so the real rise is the nine points that were left");
    // At the cap itself the applier refuses instead: no field moves at all.
    const atCap = probeTarget();
    atCap.write(index, cap);
    assert.equal(applyFieldItemEffect(atCap, code, 30, () => 29).flag, 0,
      `code 0x${code.toString(16)} refuses at its cap`);
    assert.equal(atCap.read(index), cap);
  }
  // The message id the applied path asks the message box for: code + 0x52.
  assert.equal(fieldItemMessageId(EFFECT_HP_CHARGE), 0x52 + EFFECT_HP_CHARGE);
  assert.equal(MESSAGE_NO_EFFECT, 0x6a, "the one refusal the original has");
});

// ── 3. the battle context: one decided arm per admitted item ───────────────────

test("the whole census in one table: every code, its items, and its arm in each context", () => {
  // One row per effect code, exactly as the canonical document tabulates it. Built from
  // the disc, then pinned: a code that loses an item, gains an item, or is routed to a
  // different handler fails here.
  const fieldArmOf = (code) => code === EFFECT_HP_CHARGE ? "0xc94c HP"
    : code === EFFECT_TP_CHIP ? "0xc970 TP"
      : FIELD_ITEM_BOOST_TABLE.some((e) => e.selector === code) ? "0xca50 table" : "0xcb30 refuse";
  const rows = [];
  for (let code = 0; code <= 0x11; code++) {
    const ids = shipped.filter((r) => disc.get(r.id)?.code === code).map((r) => r.id);
    const battle = new Map();
    for (const id of ids) if (itemUsableInBattle(id)) battle.set(battleArm(id), (battle.get(battleArm(id)) ?? 0) + 1);
    rows.push({
      code,
      items: ids.length,
      firstItem: ids[0],
      lastItem: ids[ids.length - 1],
      field: fieldArmOf(code),
      battle: [...battle].map(([addr, n]) => `0x${addr.toString(16)}x${n}`).join("+") || "none",
    });
  }
  assert.deepEqual(rows, [
    { code: 0x00, items: 328, firstItem: 66, lastItem: 394, field: "0xcb30 refuse", battle: "0x8008dcd8x4+0x8008ddd8x1+0x8008ded0x1+0x8008dfc8x1+0x8008e0d4x1+0x8008e25cx1+0x8008e3e4x1+0x8008e438x1+0x8008e4e0x7+0x8008e554x1+0x8008e5c4x1+0x8008e6f8x1+0x8008e8acx1+0x8008ea5cx1+0x8008eb4cx1+0x8008ecacx1" },
    { code: 0x01, items: 4, firstItem: 43, lastItem: 46, field: "0xc94c HP", battle: "0x8008dc00x4" },
    { code: 0x02, items: 1, firstItem: 47, lastItem: 47, field: "0xca50 table", battle: "none" },
    { code: 0x03, items: 1, firstItem: 48, lastItem: 48, field: "0xca50 table", battle: "none" },
    { code: 0x04, items: 1, firstItem: 49, lastItem: 49, field: "0xca50 table", battle: "none" },
    { code: 0x05, items: 1, firstItem: 50, lastItem: 50, field: "0xca50 table", battle: "none" },
    { code: 0x06, items: 1, firstItem: 51, lastItem: 51, field: "0xca50 table", battle: "none" },
    { code: 0x07, items: 1, firstItem: 52, lastItem: 52, field: "0xca50 table", battle: "none" },
    { code: 0x08, items: 1, firstItem: 53, lastItem: 53, field: "0xca50 table", battle: "none" },
    { code: 0x09, items: 1, firstItem: 54, lastItem: 54, field: "0xca50 table", battle: "none" },
    { code: 0x0a, items: 1, firstItem: 55, lastItem: 55, field: "0xca50 table", battle: "none" },
    { code: 0x0b, items: 1, firstItem: 56, lastItem: 56, field: "0xca50 table", battle: "none" },
    { code: 0x0c, items: 1, firstItem: 57, lastItem: 57, field: "0xca50 table", battle: "none" },
    { code: 0x0d, items: 1, firstItem: 58, lastItem: 58, field: "0xca50 table", battle: "none" },
    { code: 0x0e, items: 1, firstItem: 59, lastItem: 59, field: "0xca50 table", battle: "none" },
    { code: 0x0f, items: 1, firstItem: 60, lastItem: 60, field: "0xca50 table", battle: "none" },
    { code: 0x10, items: 1, firstItem: 61, lastItem: 61, field: "0xca50 table", battle: "none" },
    { code: 0x11, items: 4, firstItem: 62, lastItem: 65, field: "0xc970 TP", battle: "none" },
  ]);
});

test("the battle admission is the effect record's class byte bit 1, over the whole catalog", () => {
  for (const row of shipped) {
    const rec = disc.get(row.id);
    const consumable = row.category === "consumable" || row.category === "booster";
    if (!rec) { assert.equal(itemUsableInBattle(row.id), false, `key item ${row.id}`); continue; }
    assert.equal(itemUsableInField(row.id), consumable && (rec.klass & 1) !== 0, `field ${row.id}`);
    assert.equal(itemUsableInBattle(row.id), consumable && (rec.klass & 2) !== 0, `battle ${row.id}`);
  }
});

test("every battle-admitted item reaches a dispatch arm, and no other item does", () => {
  const admitted = shipped.map((r) => r.id).filter((id) => itemUsableInBattle(id));
  // The disc's own list is directory 1 filtered by class bit 1; the admitted set is
  // exactly the four HP charges plus the 25 battle discs/plugs.
  assert.deepEqual(admitted, [43, 44, 45, 46, ...Array.from({ length: 25 }, (_, i) => 66 + i)]);
  for (const id of admitted) assert.ok(battleArm(id) >= 0x8008dc00 && battleArm(id) <= 0x8008ecac,
    `item ${id} has a handler in the band`);
  // The 48 entries the table actually holds, grouped by handler.
  const byHandler = new Map();
  for (let id = 43; id <= 90; id++) {
    if (!byHandler.has(battleArm(id))) byHandler.set(battleArm(id), []);
    byHandler.get(battleArm(id)).push(id);
  }
  assert.equal(byHandler.size, 17,
    "the 48 cases share 17 handlers: the generic heal arm (23 ids), the four cure disks, the seven fields, and thirteen single-item arms");
  const shared = [...byHandler.entries()].find(([, ids]) => ids.length === 23);
  assert.deepEqual(shared[1], Array.from({ length: 23 }, (_, i) => 43 + i));
  assert.equal(battleArm(43), shared[0], "the generic arm is ids 43..65, the four charges and the chips");
  // Codes 0x02..0x11 live only on ids 47..65, whose class byte is 1: bit 1 clear, so the
  // original never offers them in battle. That is the arm census answering "no battle arm",
  // not an unread branch.
  for (let code = 2; code <= 0x11; code++) {
    const ids = shipped.filter((r) => disc.get(r.id)?.code === code).map((r) => r.id);
    for (const id of ids) assert.equal(itemUsableInBattle(id), false, `code 0x${code.toString(16)} item ${id}`);
  }
  // The walker's own band for the shared, per-id arms.
  const perId = admitted.filter((id) => id >= 66);
  assert.deepEqual(perId.filter((id) => isBattleEffectItem(id)), perId);
  for (const id of [43, 44, 45, 46, ...Array.from({ length: 19 }, (_, i) => 66 + i)]) {
    if (id >= 66) continue;
    assert.equal(isBattleEffectItem(id), false, "the charges run the shared heal arm, not useBattleItem");
  }
  assert.equal(battleArm(66), 0x8008dcd8);
  assert.equal(battleArm(90), 0x8008ecac);
});

test("every one of the 25 per-item battle arms is decided, not falling through to the refusal", () => {
  // One scenario that nothing in the band refuses in: the user is hurt in both pools and
  // carries all four ailments, a benched member is down, the two sides' stats differ, and
  // `rand()` is pinned. Any arm the walker had not ported would fall through to the
  // shared refusal (`none` = kind 1, `esmfight[0x2f]`), so this is the "exactly one
  // decided arm per member" check over the whole band.
  const scenario = () => {
    const user = {
      hp: 300, maxHp: 400, mp: 20, maxMp: 60, str: 120, def: 80, spd: 64, gauge: 0,
      ailments: { poison: { power: 8 }, frozen: { power: 8 }, confuse: { power: 8 }, sleep: { power: 8 } },
    };
    const enemy = { hp: 300, maxHp: 500, mp: 0, maxMp: 0, str: 80, def: 120, spd: 64, ailments: {} };
    const fallen = { hp: 0, maxHp: 350, mp: 0, maxMp: 40, str: 90, def: 90, spd: 90, ailments: {} };
    return { user, enemy, fallen };
  };
  const decided = [];
  for (let id = 66; id <= 90; id++) {
    const { user, enemy, fallen } = scenario();
    const fields = [];
    const r = useBattleItem(id, user, enemy, {
      party: [user, fallen], rng: () => 1, magicalHit: () => 60,
      userName: "Kotemon", enemyName: "Numemon",
      setField: (element, power) => fields.push([element, power]),
    });
    assert.ok(r.pages.length >= 1, `item ${id} put up no page`);
    assert.notEqual(r.pages[0].payload[0], 0x2f,
      `item ${id} fell through to the shared "No effect!" arm`);
    assert.ok([1, 2, 4, 7, 8, 9].includes(r.pages[0].kind), `item ${id} page kind ${r.pages[0].kind}`);
    decided.push(id);
  }
  assert.equal(decided.length, 25, "the band is 25 items wide, ids 66..90");
});

test("over the whole catalogue the field applier raises exactly the items whose code names an arm", () => {
  // One pass over all 402 shipped records through the walker's own `useItem`, which is
  // the single field consumer: the pause ITEMS page and the route census both reach it.
  const hasArm = (code) => code === EFFECT_HP_CHARGE || code === EFFECT_TP_CHIP
    || FIELD_ITEM_BOOST_TABLE.some((e) => e.selector === code);
  const profile = { resistances: Object.fromEntries(ELEMENT_KEYS.map((k) => [k, 5])) };
  const raised = [];
  const refused = [];
  for (const row of shipped) {
    const rec = disc.get(row.id);
    const code = rec ? rec.code : 0;
    const ps = {
      hp: 400, maxHp: 1000, mp: 200, maxMp: 500, tp: 40,
      stats: { str: 50, def: 50, spt: 50, wis: 50, spd: 50, chr: 50 },
      bonuses: {}, elemBonuses: Object.fromEntries(ELEMENT_KEYS.map((k) => [k, 0])),
    };
    const state = { inventory: [{ id: row.id, qty: 2 }], partnerStats: ps };
    const result = useItem(state, row.id, () => 0, profile);
    const bag = state.inventory[0].qty;
    if (hasArm(code)) {
      raised.push(row.id);
      assert.equal(result.ok, true, `item ${row.id} (code 0x${code.toString(16)}) must apply`);
      assert.equal(bag, 1, `item ${row.id} spends exactly one copy when it applies`);
    } else {
      refused.push(row.id);
      assert.equal(result.ok, false, `item ${row.id} (code 0x${code.toString(16)}) must refuse`);
      assert.equal(bag, 2, "and a refused item keeps its copies");
      assert.equal(result.messageId, MESSAGE_NO_EFFECT, "through the original's own refusal line");
    }
  }
  assert.deepEqual(raised, [43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65],
    "exactly the consumables 43..65 are field-usable: the four charges and the nineteen chips");
  assert.equal(refused.length, 379, "the 35 booster packs, 268 gear rows and 76 key items all refuse");
});

test("the heal handler's amount is the record's own value halfword, for every charge", () => {
  // `lhu $a1, 2($v0)` (fightstg.s:11241, raw 0x94450002) is the pair's value, so the
  // shared arm's amount is data, not a constant. Both dispatchers reach the record
  // through the one shared routine at [0x80042b98] = F0x8001355C.
  assert.equal(res32(RESOLVER_TABLE), 0x8001355c);
  for (const id of [43, 44, 45, 46]) {
    assert.equal(disc.get(id).code, EFFECT_HP_CHARGE);
    assert.equal(ITEM_BY_ID[id].value, disc.get(id).value, `charge ${id} carries its own amount`);
    assert.ok(disc.get(id).value > 0, "and it is the heal the arm prints");
  }
  // The plugs read the same halfword: their magnitudes are data too.
  assert.deepEqual([72, 73, 74, 76, 86, 89].map((id) => disc.get(id).value), [32, 64, 64, 200, 96, 32]);
});