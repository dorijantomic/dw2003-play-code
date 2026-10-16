// Resident party/save-context accessors, ported from the original EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md). The
// interpreter is the oracle: tests/party-context-oracle.test.js runs the original
// addresses against this port and compares.
//
// DECODED: exe-decomp/c/F0x80016d94.c (partyPositionToRosterSlot) and
// F0x80017b4c.c (persistentRosterSlot); contract in
// docs/research/battle/digimon-cur-stats-helpers.md and the accepted
// saveblock-producer answer. Callers on screen paths: the gym, fight report and
// memory card (accessor cells ctx+0x2718 / +0x2750).

import {
    PAD_BLOCK as CHARACTER_RECORDS,
    PAD_PORT_STRIDE as CHARACTER_STRIDE,
    padRepeat,
} from "../systems/pad-block.ts";
import { ELEMENT_KEYS } from "./effective-stats.ts";

/** The resident party/save context (0x26C4 bytes). */
export const PARTY_CONTEXT = 0x80048d34;
/** Party position 0..2 -> roster slot map, u32[3] at ctx+0x70. */
export const PARTY_MAP = PARTY_CONTEXT + 0x70;
/** Roster record array: 0x3DC-byte records, index = starter species slot. */
export { ROSTER_RECORDS, ROSTER_STRIDE, EXTRA_ROSTER_RECORDS, rosterRecordAddress, rosterContextBase } from "./roster-records.ts";
import { ROSTER_RECORDS, ROSTER_STRIDE, rosterRecordAddress } from "./roster-records.ts";
/** The record's Unknown4 stats block (record + 0x08); F0x80017B4C returns it. */
export const CUR_STATS = ROSTER_RECORDS + 0x08;
/** Record-relative field offsets (u16 unless noted). */
export const RECORD_FIELDS = {
    exp: 0x20, // u32
    level: 0x24,
    tp: 0x26,
    hp: 0x28,
    maxHp: 0x2a,
    mp: 0x2c,
    maxMp: 0x2e,
    core: 0x30, // 6 x u16
    elements: 0x3c, // 7 x u16
} as const;

/**
 * The original's own offset of the six equip halfwords, off `CUR_STATS` — the
 * record base every original reader holds.
 *
 * `F0x80017B4C` (the resident `D0x80048d34 + 0x2750` cell every overlay calls to
 * resolve a deployed Digimon) returns `DIGIMON_CUR_STATS + slot * 0x3DC`, built in
 * the `jr $ra` delay slot out of `la_ $v1, DIGIMON_CUR_STATS`
 * (`~/ddw3/asm/dw2003/exe/fns.s:8403-8410`), and `DIGIMON_CUR_STATS` is
 * `0x8004949C` (`~/ddw3/rust/dw2003_exe_data/src/data.rs:3110`) — which is
 * `CUR_STATS` here, EIGHT BYTES ABOVE `ROSTER_RECORDS`. The stat builder then takes
 * the halfwords at `+0x3C0` off that base in one expression
 * (`~/ddw3/asm/dw2003/exe/fns.s:7821`, `addiu $s6, $v0, 0x3c0`), the merchant's
 * hand swap off it (`pro/stitshop.s:9969` slot head, `:10008` right, `:10012` left,
 * `:9851` acc0) and the pause EQUIP page off it (`pro/ststatus.s:9770`, `:9780`).
 *
 * So the same halfwords are at `CUR_STATS + 0x3C0` and at `ROSTER_RECORDS + 0x3C8`.
 * Both spellings are the original's; they differ by the base, never by the bytes.
 */
export const ORIGINAL_EQUIP_BASE = 0x3c0;
/** The six equip halfwords in the original's own order: head, body, right, left, acc0, acc1. */
export const ROSTER_EQUIP_SLOTS = ["head", "body", "right", "left", "acc0", "acc1"] as const;
export type RosterEquipSlot = (typeof ROSTER_EQUIP_SLOTS)[number];
/**
 * The same six halfwords, relative to `ROSTER_RECORDS` — `ORIGINAL_EQUIP_BASE` plus
 * the 8 bytes between `ROSTER_RECORDS` and `CUR_STATS`. Every reader in the engine
 * holds `ROSTER_RECORDS + slot * ROSTER_STRIDE`, so every reader must use these.
 */
export const ROSTER_EQUIP_OFFSETS = {
    head: ORIGINAL_EQUIP_BASE + 8, body: ORIGINAL_EQUIP_BASE + 10,
    right: ORIGINAL_EQUIP_BASE + 12, left: ORIGINAL_EQUIP_BASE + 14,
    acc0: ORIGINAL_EQUIP_BASE + 16, acc1: ORIGINAL_EQUIP_BASE + 18,
} as const;
export type RosterEquipment = Partial<Record<RosterEquipSlot, number>>;

/** The six offsets as [name, offset] pairs, for a `for (const [name, off] of ...)` walk. */
export const ROSTER_EQUIP_ENTRIES = ROSTER_EQUIP_SLOTS.map(
    (name) => [name, ROSTER_EQUIP_OFFSETS[name]] as const,
);
/** The same six offsets as a bare ascending list, for an index-parallel seed walk. */
export const ROSTER_EQUIP_OFFSETS_LIST = ROSTER_EQUIP_SLOTS.map((name) => ROSTER_EQUIP_OFFSETS[name]);

/** One member's equip halfword address, in this port's record base. */
export function rosterEquipAddress(rosterSlot: number, name: RosterEquipSlot): number {
    return rosterRecordAddress(rosterSlot) + ROSTER_EQUIP_OFFSETS[name];
}

export interface MemoryReader {
    read32(addr: number): number;
}

/** F0x80016D94: party position (0..2) -> roster slot; -1 when position >= 3. */
export function partyPositionToRosterSlot(mem: MemoryReader, position: number): number {
    if ((position >>> 0) >= 3) return -1;
    return mem.read32(PARTY_MAP + position * 4) | 0;
}

/** F0x80017B4C: roster slot -> its Unknown4 stats-block address. */
export function persistentRosterSlot(slot: number): number {
    return (rosterRecordAddress(slot) + 0x08) >>> 0;
}

/** The shared character/roster record bank: 0x1C0-byte records. */
export { CHARACTER_RECORDS, CHARACTER_STRIDE };

export interface HalfwordReader {
    read16(addr: number): number;
}

/**
 * F0x8001889C(slot): the auto-repeat word at the port block's record + 0x4A
 * (one owner for the block: engine/systems/pad-block.ts; the original is
 * `sll/subu/sll` -> slot*0x1C0, `lhu 0x4A`).
 * Oracle: tests/zero-fill-oracle.test.js checks it against the interpreter.
 */
export function getPadButtons4A(mem: HalfwordReader, slot: number): number {
    return padRepeat(mem, slot | 0);
}

/** The shop id the resident global 0x8004B404 currently holds. */
export const CURRENT_SHOP_ID = 0x8004b404;

/**
 * The six core stat names in record +0x30..+0x3A order.
 *
 * Those six halfwords are what the original keeps on the roster record and what
 * the bank-0x72 Charisma predicate reads: F0x80015FBC builds each position's
 * buffer with F0x80017174 (a verbatim copy of record +0x1C..+0x48 plus the six
 * equipped items' leading u16) and accumulates buffer+0x16 == record +0x32, the
 * Charisma one (tests/charisma-bank72.test.js). Same order as GEAR_CORE_STATS
 * (engine/dw3/equipment.ts) and web/party.js CORE_STATS.
 */
export const RECORD_CORE_STATS = ["str", "def", "spt", "wis", "spd", "chr"] as const;

/** A walker's per-member stat block: `stats` is stored, `bonuses` the stat chips. */
export interface StatCarrier {
    stats?: Record<string, unknown> | null;
    bonuses?: Record<string, unknown> | null;
    /** The member's HP/MP totals. The walker stores the SUM; the chips live in `bonuses`. */
    maxHp?: number | null;
    maxMp?: number | null;
    /** Every trained elemental point plus the worn gear's resist, per element. */
    elemBonuses?: Record<string, unknown> | null;
}

/**
 * The five groups of record halfwords the field item applier (F0x8008F584) can
 * raise, and where the walker keeps the same quantity.
 *
 * Read from `~/ddw3/asm/dw2003/pro/ststatus.s` file 0xC8D4 (RAM F0x8008F584) and its
 * own stat table at file 0x17C2C (RAM 0x8009A8DC): the permanent-boost arm walks that
 * table and, for a matched selector, adds `rand() % recordValue + 1` to
 * `statsBlock + 0x1C + index*2`, so index 3 is the record's +0x2A (max HP), index 5 its
 * +0x2E (max MP), indices 6..11 its +0x30..+0x3A (the six core stats) and indices 12..18
 * its +0x3C..+0x48 (the seven element tolerances). Every walker consumer instead reads
 * `bonuses`/`elemBonuses` plus the summed `maxHp`/`maxMp`, so all fifteen raisable
 * halfwords have to be folded at the one seam on close. Documented in
 * docs/research/items/item-store-shared-system-2026-10-03.md section 8c.
 */
export const RECORD_BOOST_GROUPS = [
    { field: "maxHp", bonus: "hp", cap: 9999, effect: 2 },
    { field: "maxMp", bonus: "mp", cap: 9999, effect: 3 },
] as const;

/** The per-group amounts one fold moved, keyed by the walker's own field names. */
export interface RecordStatFold {
    maxHp: number;
    maxMp: number;
    core: Record<string, number>;
    elements: Record<string, number>;
}

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
};

/** Add `delta` to a numeric field of `rec`, keeping it a plain number. */
function raise(rec: Record<string, unknown>, field: string, delta: number): void {
    rec[field] = num(rec[field]) + delta;
}

/**
 * Fold what a translated pause page wrote into a roster record's core block back
 * into the walker's own two stored-stat fields.
 *
 * WHY. The pause pages hold the roster in the original's record layout and hand it
 * back on close: the ITEMS page's applier (F0x8008F584) raises the record's
 * +0x30..+0x3A halfword when a stat chip is eaten, which is the same word the
 * bank-0x72 predicate reads. Every OTHER walker consumer however reads the walker's
 * own pair `stats[k] + bonuses[k]` — web/party.js partyRosterView's `core`,
 * web/charisma.js's member total, battle.js — so a chip eaten on the real ITEMS
 * screen left the record's number raised and the walker's number untouched, and the
 * roaming card tamer still brushed the player off.
 *
 * The two describe the same quantity: the page seeds that block from
 * `stats[k] + bonuses[k]` when it opens (web/status-translated.js partySeed), so the
 * difference the page made IS the bonus it applied and nothing else. Folding the
 * difference here is the one seam every ported pause page hands back through, so
 * every screen sees one number rather than each keeping its own.
 *
 * Two guards keep this from inventing a bonus:
 *  - a key with no stored stat is skipped. partyRosterView falls back to the
 *    species profile for those, so the page's block opens at the profile value and
 *    the difference would read as a bonus the player never bought.
 *  - only a rise is folded. No pause page lowers a core stat.
 *
 * Returns the per-stat amounts it folded, so a caller can report them.
 */
export function foldRecordCoreIntoBonuses(
    rec: StatCarrier | null | undefined,
    written: ArrayLike<unknown> | null | undefined,
): Record<string, number> {
    const folded: Record<string, number> = {};
    if (!rec || !written) return folded;
    for (const [i, key] of RECORD_CORE_STATS.entries()) {
        const stored = rec.stats?.[key];
        if (typeof stored !== "number" || !Number.isFinite(stored)) continue;
        const after = Number(written[i]);
        if (!Number.isFinite(after)) continue;
        const delta = after - (stored + (Number(rec.bonuses?.[key] ?? 0) || 0));
        if (!(delta > 0)) continue;
        rec.bonuses = rec.bonuses ?? {};
        rec.bonuses[key] = (Number(rec.bonuses[key] ?? 0) || 0) + delta;
        folded[key] = delta;
    }
    return folded;
}

/**
 * Fold what a translated pause page wrote into a roster record's SEVEN ELEMENT
 * halfwords back into the walker's `elemBonuses`.
 *
 * Same seam and same reasoning as {@link foldRecordCoreIntoBonuses}, one group over:
 * the applier's selectors 0x0A..0x10 (the Fire..Devil chips) raise the record's
 * +0x3C..+0x48, and `web/party.js partyRosterView` computes every element the battle
 * and the STATUS sheet read as `speciesBase + elemBonuses[element]` — so a chip eaten
 * on the real ITEMS screen used to raise the record's number and nothing else, and
 * the tolerance never moved. `web/gym-translated.js` already folds its own page's
 * element block this way; this is the pause page's half of the one shared rule.
 *
 * `opened` is the seven element values the page was handed when it opened
 * (`elementValues(profile, elemBonuses)`, the same call partySeed makes). It is
 * needed because the record's block carries the species base, which the record does
 * not store separately. Without it a member that has never carried an
 * `elemBonuses` entry cannot be measured, and the fold would rather skip than invent.
 */
export function foldRecordElementsIntoBonuses(
    rec: StatCarrier | null | undefined,
    written: ArrayLike<unknown> | null | undefined,
    opened?: ArrayLike<unknown> | null,
): Record<string, number> {
    const folded: Record<string, number> = {};
    if (!rec || !written) return folded;
    for (const [i, key] of ELEMENT_KEYS.entries()) {
        const after = num(written[i]);
        const before = opened !== undefined && opened !== null
            ? num(opened[i])
            : num(rec.elemBonuses?.[key]);
        if (!Number.isFinite(after) || !Number.isFinite(before)) continue;
        const delta = after - before;
        if (!(delta > 0)) continue;
        rec.elemBonuses = rec.elemBonuses ?? {};
        rec.elemBonuses[key] = (num(rec.elemBonuses[key]) || 0) + delta;
        folded[key] = delta;
    }
    return folded;
}

/**
 * THE seam: fold every group of record stat the pause ITEMS page's applier can raise
 * back into the walker's own stored bonuses, in one call.
 *
 * The applier (F0x8008F584) writes fifteen record halfwords and the walker keeps all
 * fifteen somewhere else, so a chip eaten on the ported page used to survive only in
 * the session's memory image:
 *
 * | effect code | record halfword | the walker's copy |
 * |---|---|---|
 * | 2 (HPChip) | +0x2A max HP | `maxHp`, and `bonuses.hp` which `evolvedMaxStats` adds back on a digivolution |
 * | 3 (MPChip) | +0x2E max MP | `maxMp`, and `bonuses.mp` |
 * | 4..9 (stat chips) | +0x30..+0x3A | `stats[k] + bonuses[k]` |
 * | 10..16 (element chips) | +0x3C..+0x48 | species base + `elemBonuses[element]` |
 *
 * The HP/TP groups are absent on purpose: the walker stores `hp`/`tp` directly, which
 * is the same halfword, so the page's copy-back already lands in the right place.
 *
 * Every group is guarded the same way {@link foldRecordCoreIntoBonuses} is: the member
 * must already carry the field, and only a RISE is folded. The walker state is
 * untouched while the page is open, so the difference the page made IS the chip it
 * applied and nothing else.
 *
 * `seed.elements` is the seven element values the page opened with; see
 * {@link foldRecordElementsIntoBonuses} for why that group cannot be measured
 * without them.
 */
export function foldRecordStatsIntoBonuses(
    rec: StatCarrier | null | undefined,
    record: {
        maxHp?: number | null;
        maxMp?: number | null;
        core?: ArrayLike<unknown> | null;
        elements?: ArrayLike<unknown> | null;
    } | null | undefined,
    seed?: { elements?: ArrayLike<unknown> | null } | null,
): RecordStatFold {
    const folded: RecordStatFold = { maxHp: 0, maxMp: 0, core: {}, elements: {} };
    if (!rec || !record) return folded;
    const carrier = rec as Record<string, unknown>;
    // Max HP / max MP: the walker stores the sum in the member field and the chip
    // contribution in `bonuses`, because evolvedMaxStats rebuilds the sum as
    // scaledHp(profile, level) + bonuses.hp on every digivolution. A chip that only
    // reached the member field would be wiped by the next evolution.
    for (const [field, key] of [["maxHp", "hp"], ["maxMp", "mp"]] as const) {
        const before = num(rec[field]);
        const after = num(record[field]);
        if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
        const delta = after - before;
        if (!(delta > 0)) continue;
        raise(carrier, field, delta);
        rec.bonuses = rec.bonuses ?? {};
        rec.bonuses[key] = (Number(rec.bonuses[key] ?? 0) || 0) + delta;
        folded[field] = delta;
    }
    folded.core = foldRecordCoreIntoBonuses(rec, record.core);
    folded.elements = foldRecordElementsIntoBonuses(rec, record.elements, seed?.elements);
    return folded;
}

/** F0x80016B78(): lw [0x8004b404]. */
export function getCurrentShopId(mem: MemoryReader): number {
    return mem.read32(CURRENT_SHOP_ID) | 0;
}

/** F0x80016B88(a0, a1): the pending screen-transition request words. */
export const SCREEN_TRANSITION_A = PARTY_CONTEXT + 0x26c8;
export const SCREEN_TRANSITION_B = PARTY_CONTEXT + 0x26d0;

export function requestScreenTransition(
    mem: { write32(addr: number, value: number): void },
    a: number,
    b: number,
): void {
    mem.write32(SCREEN_TRANSITION_A, a | 0);
    mem.write32(SCREEN_TRANSITION_B, b | 0);
}

/**
 * F0x80016FD8(position): the follower's roster slot: the record's +0x760 word
 * minus 3, for positions 0..2; -1 otherwise. Reads PARTY_MAP[position] then the
 * 0x3DC-byte record; the slot*stride product wraps 32-bit like the original's
 * shift/add chain.
 */
export function getFollowerRosterSlot(mem: MemoryReader, position: number): number {
    if ((position >>> 0) >= 3) return -1;
    const slot = mem.read32(PARTY_MAP + position * 4) | 0;
    const addr = rosterRecordAddress(slot);
    return ((mem.read32(addr) | 0) - 3) | 0;
}

