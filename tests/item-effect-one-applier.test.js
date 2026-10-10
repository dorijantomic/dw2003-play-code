// ONE applier for the field item effect, proved by running the walker's own route
// and the ported pause ITEMS page side by side over every effect code the shipped
// item table uses.
//
// WHY THIS EXISTS. Two appliers for one system is the "converted copy with hand
// rows" the repository rules forbid. `engine/dw3/items.ts` used to be a SECOND,
// hand-written applier: it re-typed the original's rules in walker state and
// disagreed with them at the cap on all fifteen raisable codes - it spent the copy
// on a chip that could raise nothing, and it capped a chip's own share instead of
// the member's total. `engine/dw3/item-effect.ts` now holds the decision once
// (the port of F0x8008F584, `~/ddw3/asm/dw2003/pro/ststatus.s` file 0xC8D4) and
// both routes call it.
//
// The original is the oracle for the expected values, read out of its own bytes:
//   * `pro/ststatus.s:12982` `div` / `:12983` `mfhi` / `:12989` `addiu $s3, $a0, 0x1`
//     -> the rise is `rand() % value + 1`, and the MESSAGE reports that roll even
//     when the cap clipped the real rise;
//   * `:12960`/`:12963` -> the cap, from the routine's own table at file 0x17C2C;
//   * `:12894` `beqz`, `:12939` `slti $v0, $v0, 0x63`, `:12900` `beqz` -> the three
//     refusals (HP full, TP at 99, value at the cap);
//   * `:13039`-`:13042` -> the consume is on the applied path only, so a refusal
//     keeps the copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeMemory } from "../engine/native/memory.ts";
import { itemsApplyEffect } from "../engine/dw3/ui/native/pause-bag.ts";
import { useItem, itemUsableInField } from "../engine/dw3/items.ts";
import { ITEM_DATA } from "../engine/dw3/item-data.ts";
import { FIELD_ITEM_BOOST_TABLE, MESSAGE_NO_EFFECT } from "../engine/dw3/item-effect.ts";
import { RECORD_CORE_STATS } from "../engine/dw3/party-context.ts";
import { ELEMENT_KEYS } from "../engine/dw3/effective-stats.ts";

const RESIDENT_BASE = 0x80010000;
const resident = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url)));
const overlay = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/pro_ststatus.bin", import.meta.url)));
const OVERLAY_BASE = 0x80082cb0;
const CTX = 0x80048d34;
const OBJ = 0x80300000;
const UI = 0x80400000;

/** The record's own block index for a core stat / element tolerance. */
const CORE_BASE = 6;
const ELEM_BASE = 12;

/** One walker's member, seeded so `stats[k] + bonuses[k]` is the record's own total. */
function member(over = {}) {
    return {
        tp: 40, hp: 400, maxHp: 1000, mp: 200, maxMp: 500,
        stats: Object.fromEntries(RECORD_CORE_STATS.map((k) => [k, 50])),
        bonuses: {},
        elemBonuses: Object.fromEntries(ELEMENT_KEYS.map((k) => [k, 40])),
        ...over,
    };
}

/** The same member as the original's record: core = stats+bonuses, tolerances = elemBonuses. */
function recordOf(ps) {
    return {
        tp: ps.tp, hp: ps.hp, maxHp: ps.maxHp, maxMp: ps.maxMp,
        core: RECORD_CORE_STATS.map((k) => (ps.stats?.[k] ?? 0) + (ps.bonuses?.[k] ?? 0)),
        elements: ELEMENT_KEYS.map((k) => ps.elemBonuses?.[k] ?? 0),
    };
}

/** One run of the PORTED page: F0x8008F584 over the disc's own records. */
function runMemory(item, ps, rand) {
    const mem = new NativeMemory();
    mem.load(resident, RESIDENT_BASE);
    mem.load(overlay, OVERLAY_BASE);
    const lines = [];
    const host = {
        languageBank: (id) => id >>> 0,
        rand: () => rand,
        rowFill: () => {},
        playSound: () => {},
        callMethod: (target, slot, args) => {
            if (slot === 0x114) lines.push(["line", args[1] | 0]);
            else if (slot === 0x118) lines.push(["amount", args[1] | 0]);
        },
    };
    mem.write32(CTX + 0x70, 0); mem.write32(CTX + 0x74, 1); mem.write32(CTX + 0x78, 2);
    for (let id = 0; id <= 402; id++) { mem.write8(CTX + id + 0x7c, 0); mem.write8(CTX + id + 0x20f, 0); }
    mem.write8(CTX + item + 0x7c, 2);
    const rec = 0x80049494 + 0x08; // roster slot 0's stats block
    const before = recordOf(ps);
    const write = (index, value) => mem.write16(rec + 0x1c + index * 2, value);
    write(1, before.tp); write(2, before.hp); write(3, before.maxHp); write(5, before.maxMp);
    before.core.forEach((v, i) => write(CORE_BASE + i, v));
    before.elements.forEach((v, i) => write(ELEM_BASE + i, v));
    mem.write32(OBJ + 0x78, item);
    mem.write32(OBJ + 0x3b0, 0);
    mem.write32(UI + 0x88, UI);
    itemsApplyEffect(mem, OBJ, UI, host);
    const after = {
        tp: mem.read16(rec + 0x1e), hp: mem.read16(rec + 0x20), maxHp: mem.read16(rec + 0x22),
        maxMp: mem.read16(rec + 0x26),
        core: Array.from({ length: 6 }, (_, i) => mem.read16(rec + 0x28 + i * 2)),
        elements: Array.from({ length: 7 }, (_, i) => mem.read16(rec + 0x34 + i * 2)),
    };
    return { after, held: mem.read8(CTX + item + 0x7c), lines };
}

/** One run of the WALKER's route: useItem over the same member. */
function runWalker(item, ps, rand) {
    const state = { inventory: [{ id: item, qty: 2 }], partnerStats: ps };
    const result = useItem(state, item, () => rand);
    return { result, state, held: state.inventory.find((s) => s.id === item)?.qty ?? 0 };
}

/** The one place both routes are compared; returns the agreement for the report. */
function bothRoutes(item, ps, rand) {
    const m = runMemory(item, structuredClone(ps), rand);
    const w = runWalker(item, structuredClone(ps), rand);
    return { m, w };
}

// ── one test per effect code the shipped table uses ────────────────────────────
//
// `raise` is how far the code can lift its field from a start below the cap; the
// roll is chosen so the rise is exact (rand % value + 1 = raise).

const CODES = [
    { code: 0x00, item: 66, label: "no effect (a battle disk)", field: null },
    { code: 0x01, item: 43, label: "HP charge", field: "hp", raise: 500 },
    { code: 0x02, item: 47, label: "HP chip", field: "maxHp", raise: 30 },
    { code: 0x03, item: 48, label: "MP chip", field: "maxMp", raise: 30 },
    { code: 0x04, item: 49, label: "STR chip", field: "core.str", raise: 10 },
    { code: 0x05, item: 50, label: "DEF chip", field: "core.def", raise: 10 },
    { code: 0x06, item: 51, label: "SPT chip", field: "core.spt", raise: 10 },
    { code: 0x07, item: 52, label: "WIS chip", field: "core.wis", raise: 10 },
    { code: 0x08, item: 53, label: "SPD chip", field: "core.spd", raise: 10 },
    { code: 0x09, item: 54, label: "CHR chip", field: "core.chr", raise: 10 },
    { code: 0x0a, item: 55, label: "fire chip", field: "elements.fire", raise: 10 },
    { code: 0x0b, item: 56, label: "water chip", field: "elements.water", raise: 10 },
    { code: 0x0c, item: 57, label: "ice chip", field: "elements.ice", raise: 10 },
    { code: 0x0d, item: 58, label: "wind chip", field: "elements.wind", raise: 10 },
    { code: 0x0e, item: 59, label: "thunder chip", field: "elements.thunder", raise: 10 },
    { code: 0x0f, item: 60, label: "machine chip", field: "elements.machine", raise: 10 },
    { code: 0x10, item: 61, label: "dark chip", field: "elements.dark", raise: 10 },
    { code: 0x11, item: 62, label: "TP chip", field: "tp", raise: 1 },
];

/** The record value at `field`, read the way the ORIGINAL's block addresses it. */
function valueAt(record, field) {
    if (field === null) return undefined;
    if (field === "hp") return record.hp;
    if (field === "maxHp") return record.maxHp;
    if (field === "maxMp") return record.maxMp;
    if (field === "tp") return record.tp;
    if (field.startsWith("core.")) return record.core[RECORD_CORE_STATS.indexOf(field.slice(5))];
    return record.elements[ELEMENT_KEYS.indexOf(field.slice("elements.".length))];
}

for (const { code, item, label, field, raise } of CODES) {
    test(`effect code 0x${code.toString(16).padStart(2, "0")} (${label}): one applier, one answer, one copy spent`, () => {
        const start = member();
        const before = valueAt(recordOf(start), field);
        // The roll is exact: a divisor of `value` and a rand one under it.
        const rand = raise - 1;
        const { m, w } = bothRoutes(item, start, rand);
        // 1. The record value after use, from the ported page.
        const after = valueAt(m.after, field);
        const applied = before === undefined ? undefined : after - before;
        // 2. The bag count, from the ported page and from the walker's own store.
        assert.equal(m.held, field === null ? 2 : 1,
            `${label}: the original spends the copy only when the effect applied`);
        assert.equal(w.held, m.held, `${label}: both routes leave the same bag`);
        // 3. The record and the walker's own view agree, halfword for halfword.
        assert.deepEqual(RECORD_CORE_STATS.map((k) => (w.state.partnerStats.stats?.[k] ?? 0) + (w.state.partnerStats.bonuses?.[k] ?? 0)),
            m.after.core, `${label}: both routes raised the same core stat`);
        assert.deepEqual(ELEMENT_KEYS.map((k) => w.state.partnerStats.elemBonuses?.[k] ?? 0),
            m.after.elements, `${label}: both routes raised the same tolerance`);
        assert.equal(w.state.partnerStats.maxHp, m.after.maxHp, `${label}: max HP agrees`);
        assert.equal(w.state.partnerStats.maxMp, m.after.maxMp, `${label}: max MP agrees`);
        assert.equal(w.state.partnerStats.hp, m.after.hp, `${label}: HP agrees`);
        assert.equal(w.state.partnerStats.tp, m.after.tp, `${label}: TP agrees`);
        if (field === null) {
            assert.equal(w.result.ok, false, `${label}: the walker's route refuses it too`);
        } else {
            assert.equal(w.result.ok, true, `${label}: the walker's route applies it`);
            assert.equal(applied, raise, `${label}: the record rose by the amount printed`);
        }
        // 4. The message id and the figure beside it - what the player reads.
        assert.deepEqual(m.lines.filter((c) => c[0] === "line").map((c) => c[1]),
            field === null ? [MESSAGE_NO_EFFECT] : [0x52 + code],
            `${label}: the original's own message id`);
        assert.equal(w.result.messageId, field === null ? MESSAGE_NO_EFFECT : 0x52 + code,
            `${label}: the walker's route prints the same id`);
        assert.equal(w.result.amount, field === null ? 0 : raise,
            `${label}: the figure the original prints is the grant/roll`);
    });
}

// ── the fifteen codes at their cap: refused, and the copy stays ────────────────

for (const { code, item, label } of CODES.filter((c) => c.code >= 2 && c.code !== 0x11)) {
    test(`effect code 0x${code.toString(16).padStart(2, "0")} (${label}) at the cap: refused, and NOT spent`, () => {
        // The table's own cap for this code (file 0x17C2C), set on every field it
        // could reach so the applier's cap test is the one that refuses.
        const entry = FIELD_ITEM_BOOST_TABLE.find((e) => e.selector === code);
        assert.ok(entry, `${label} has a table entry`);
        const start = member({
            maxHp: 9999, maxMp: 9999,
            bonuses: Object.fromEntries(RECORD_CORE_STATS.map((k) => [k, entry.cap - 50])),
            elemBonuses: Object.fromEntries(ELEMENT_KEYS.map((k) => [k, entry.cap])),
        });
        const { m, w } = bothRoutes(item, start, 9);
        assert.equal(m.held, 2, `${label}: the ported page keeps the copy at the cap`);
        assert.equal(w.held, 2, `${label}: the walker's route keeps it too`);
        assert.equal(w.result.ok, false, `${label}: refused`);
        assert.equal(w.result.messageId, MESSAGE_NO_EFFECT, `${label}: the one refusal line`);
        assert.deepEqual(m.lines.map((c) => c[1]), [MESSAGE_NO_EFFECT]);
    });
}

// ── one clip, and the figure the original prints with it ────────────────────────

test("a chip clipped by the cap reports the ROLL while the record rises by less", () => {
    // 9985 + a roll of 30 clips to 9999: the record rises 14, the line says 30
    // (`$s3` is the roll; the clamp at :12960 never touches it).
    const start = member({ maxHp: 9985 });
    const { m, w } = bothRoutes(47, start, 29);
    assert.equal(m.after.maxHp, 9999);
    assert.equal(w.state.partnerStats.maxHp, 9999);
    assert.equal(w.state.partnerStats.bonuses.hp, 14, "only the applied part is recorded");
    assert.deepEqual(m.lines.filter((c) => c[0] === "amount").map((c) => c[1]), [30]);
    assert.equal(w.result.amount, 30, "and the walker's route prints the roll");
    assert.equal(w.held, 1, "a clipped chip is still spent");
});

test("the walker's route offers exactly the items the original's offer gate does", () => {
    // `pro/ststatus.s`, the ITEMS page's choose branch, tests bit 0 of the effect
    // record's byte +0 - and the ported page reads that same byte. Compare the two
    // over every consumable and booster.
    for (const row of ITEM_DATA) {
        assert.equal(itemUsableInField(row.id), (row.itemClass & 1) !== 0,
            `item ${row.id} offered on the walker's offer gate`);
    }
});

test("the shared table is the overlay's own bytes", () => {
    const view = new DataView(overlay.buffer, overlay.byteOffset);
    const fromDisc = [];
    for (let off = 0x8009a8dc - OVERLAY_BASE; ; off += 6) {
        const selector = view.getInt16(off, true);
        if (selector === -1) break;
        fromDisc.push({
            selector,
            index: view.getInt16(off + 2, true),
            cap: view.getInt16(off + 4, true),
        });
    }
    assert.deepEqual([...FIELD_ITEM_BOOST_TABLE], fromDisc,
        "engine/dw3/item-effect.ts must carry the disc's own cap table, not a copy of it");
});