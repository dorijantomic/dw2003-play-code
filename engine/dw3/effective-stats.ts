// The effective-stat aggregation the status sheet and the bank-0x72 charisma
// check read, translated from the EXE.
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/effective-stats-oracle.test.js runs both original addresses
// through engine/native over the same seeded roster slot and compares the whole
// 0x2C-byte buffer.
//
// DECODED: the accepted `stats-save-loaders-contract` answer (researcher A) and
// `~/ddw3/asm/dw2003/exe/fns.s` L7742-L8054. F0x80017174(slot, buf) copies the
// slot's 0x2C-byte stat block, then folds in the six equipped definitions'
// contributions (keyed by the six halfwords at +0x3C0, fetched through the
// definition getter at D0x80042B98), clamps charisma and three derived fields,
// and finally adds the per-slot signature-set bonus when the first four keys
// match the set table exactly. F0x80017578(dest, code, amount) is the single-stat
// adder: code 7 adds to all six stats, codes 1..6 to one of +0x0C..+0x16, codes
// 8..14 to one of +0x18..+0x24, anything else is ignored.

import { rosterContextBase, rosterRecordAddress } from "./roster-records.ts";
import { ROSTER_SLOT_STRIDE, SAVE_CONTEXT, s16 as sign16 } from "./form-ledger.ts";

export interface EffectiveStatsMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
}

export interface EffectiveStatsHost {
    /** `[D0x80042B98](key)`: the definition record for one equipped key. */
    definitionRecord(key: number): number;
}

/**
 * `DIGIMON_CUR_STATS` (0x8004949C): the roster's stat array inside the save
 * block (0x80048D34 + 0x768). The copied block starts at that array's slot
 * record +0x1C (`D0x80048D34 + 0x784 == DIGIMON_CUR_STATS + 0x1C`).
 */
export const DIGIMON_CUR_STATS = 0x8004949c;
/** The stat block copied out of the roster slot. */
export const EFFECTIVE_SRC_OFFSET = 0x784;
export const EFFECTIVE_BUFFER_SIZE = 0x2c;
/** The six equipped lookup keys. */
export const EQUIPPED_KEY_OFFSET = 0x3c0;
export const EQUIPPED_KEY_COUNT = 6;
/** The per-slot signature-set table (four ids) and bonus table (six words). */
export const SIGNATURE_SET_TABLE = 0x8004b53c;
export const SIGNATURE_BONUS_TABLE = 0x8004b57c;
/** The clamp every stat contribution shares. */
export const STAT_CLAMP = 999;

const s16 = sign16;

/** The seven element keys, in the original's own order (codes 8..14). */
export const ELEMENT_KEYS =
    ["fire", "water", "ice", "wind", "thunder", "machine", "dark"] as const;

/** A species record's seven element values. */
export interface ElementSources {
    resistances?: Record<string, number> | undefined;
}

/**
 * F0x8009EC94's floor on one element value, `.L0x8009eee8-.L0x8009ef14`: the
 * seven-element copy loop stores 1 for anything the sum left at 0 or below, so
 * no damage divisor is ever zero. Only the battle block floors; the STATUS
 * sheet prints the value as it stands (F0x8008C1C0 only caps).
 */
export const ELEMENT_FLOOR = 1;

/**
 * The one element value every screen and every battle leaf must read: the
 * F0x80017174 scratch's +0x18..+0x24 halfword. The original never subtracts a
 * trained point — it *adds* every level-up gain (F0x80085E3C writes them
 * straight into the roster halfwords, seven times, 999-capped) and every worn
 * item's coded resist (F0x80017578 codes 8..14 land on +0x18..+0x24, 999-capped)
 * on top of the species base the copy already carried. `points` is therefore
 * "every trained point plus the worn gear's resist for this element", and the
 * cap is the same `>= 1000 -> 999` the two originals share. A record's own
 * `elemBonuses` is exactly that table, so every caller passes it straight in.
 *
 * Oracle: tests/lane-b/effective-stats-element.test.js runs F0x80017174 for real
 * over seeded roster records and compares this against the scratch bytes.
 */
export function elementValue(
    profile: ElementSources | null | undefined,
    points: Record<string, number> | null | undefined,
    element: string,
): number {
    const base = Number(profile?.resistances?.[element] ?? 0) || 0;
    const trained = Number(points?.[element] ?? 0) || 0;
    const sum = base + trained;
    return sum >= STAT_CLAMP + 1 ? STAT_CLAMP : sum;
}

/** The seven element values in the original's own order. */
export function elementValues(
    profile: ElementSources | null | undefined,
    points: Record<string, number> | null | undefined,
): number[] {
    return ELEMENT_KEYS.map((k) => elementValue(profile, points, k));
}

/** {@link elementValue} with F0x8009EC94's floor of 1, for the battle block. */
export function battleElementValue(
    profile: ElementSources | null | undefined,
    points: Record<string, number> | null | undefined,
    element: string,
): number {
    const v = elementValue(profile, points, element);
    return v < ELEMENT_FLOOR ? ELEMENT_FLOOR : v;
}

/**
 * ONE core statistic of a fighter, as the original's own two steps leave it, for a
 * host that keeps the stored halfword and the worn gear's fold as two numbers.
 *
 * Both steps are in `F0x80017174` + `FIGHTSTG_F0x8009ec94`, and both run on the
 * RUNNING total — the halfword the producer's copy already carries the member's own
 * stored value in:
 *
 * 1. `exe/fns.s:7837-7847` (and the three sibling arms) folds a piece's amount in and
 *    re-tests the sum as a signed halfword, storing 999 when it reaches 1000:
 *
 *    ```
 *    .L0x800172f8  lhu $v0, 0xc($s3)   # the running STR, seeded by the 0x2c-byte copy
 *    .L0x800172fc  lhu $v1, 0xa($s2)   # the piece's own amount
 *    .L0x80017304  addu $v0, $v1
 *    .L0x80017308  sh   $v0, 0xc($s3)
 *    .L0x80017314  slti $v0, 0x3e8     # signed compare against 1000
 *    .L0x80017320  sh   $s8, 0xc($s3)  # $s8 = 0x3e7
 *    ```
 *
 *    So the cap is on `stored + gear`, not on the gear alone; a piece can carry +260
 *    STR (GulfSword 182) and a member's stored value reaches 999, so the sum really
 *    does cross the wall in ordinary play.
 * 2. `pro/fightstg.s:29320-29326` copies the scratch's six core halfwords into the
 *    block and floors anything at or below zero to 1:
 *
 *    ```
 *    .L0x8009eea8  lh  $v0, ($a1)
 *    .L0x8009eeb0  blez $v0, .L0x8009eec0
 *    .L0x8009eebc  sh  $v1, 0x2($a0)
 *    .L0x8009eec0  sh  $a2, 0x2($a0)   # $a2 = 1
 *    ```
 *
 * A gear amount of zero performs no add at all in the original — the copy loop
 * (`:7766-7811`) is a plain copy and the cap belongs to the add — so an uncapped
 * stored value passes through untouched. The ENEMY branch has neither step: it
 * stores `species * encounter / 16` straight into the block
 * (`pro/fightstg.s:29725-29738`), with no cap and no floor, and takes no gear at all.
 *
 * The elemental halfwords get the same treatment through {@link elementValue} /
 * {@link battleElementValue}, which is why they already read this way.
 */
export function addFoldedStat(stored: number, gearAmount: number): number {
  const amount = Math.trunc(Number(gearAmount) || 0);
  if (!amount) return Math.trunc(Number(stored) || 0);
  const wrapped = ((Math.trunc(Number(stored) || 0) + amount) & 0xffff) << 16 >> 16;
  return wrapped >= STAT_CLAMP + 1 ? STAT_CLAMP : wrapped;
}

/** {@link addFoldedStat} plus `F0x8009ec94`'s floor of 1 — the number the battle reads. */
export function battleCoreStat(stored: number, gearAmount: number): number {
  const folded = addFoldedStat(stored, gearAmount);
  return folded < ELEMENT_FLOOR ? ELEMENT_FLOOR : folded;
}

/** Add `amount` to a u16 field, clamping at the shared cap. */
function addClamped(mem: EffectiveStatsMemory, addr: number, amount: number): void {
    const value = (mem.read16(addr) + (amount | 0)) & 0xffff;
    mem.write16(addr, value);
    if (s16(value) >= STAT_CLAMP + 1) mem.write16(addr, STAT_CLAMP);
}

/** Subtract a u16 field from another, flooring at zero. */
function subtractFloor(mem: EffectiveStatsMemory, addr: number, amountAddr: number): void {
    const value = (mem.read16(addr) - mem.read16(amountAddr)) & 0xffff;
    mem.write16(addr, value);
    if (s16(value) < 0) mem.write16(addr, 0);
}

/**
 * F0x80017578(dest, code, amount): add a signed amount to one stat, clamped.
 * Codes 1..6 address +0x0C..+0x16 (the primary six), 8..14 address
 * +0x18..+0x24 (the elements), 7 adds to all six primary stats; every other
 * code changes nothing.
 */
export function addEffectiveStat(
    mem: EffectiveStatsMemory,
    dest: number,
    code: number,
    amount: number,
): void {
    const c = code | 0;
    if (c === 7) {
        for (let i = 0; i < EQUIPPED_KEY_COUNT; i++) addClamped(mem, dest + 0xc + i * 2, amount);
        return;
    }
    if (c >= 1 && c <= 6) {
        addClamped(mem, dest + 0xa + c * 2, amount);
        return;
    }
    if (c >= 8 && c <= 14) {
        addClamped(mem, dest + 0x8 + c * 2, amount);
    }
}

/**
 * F0x80017174(slot, buf): fill `buf` with the slot's effective stats. The
 * caller's buffer receives the 0x2C-byte block and the contributions; nothing
 * past the copy is touched.
 */
export function buildEffectiveStats(
    mem: EffectiveStatsMemory,
    host: EffectiveStatsHost,
    slot: number,
    buf: number,
): void {
    const base = rosterContextBase(slot);
    const src = (base + EFFECTIVE_SRC_OFFSET) >>> 0;
    for (let i = 0; i < EFFECTIVE_BUFFER_SIZE; i++) mem.write8(buf + i, mem.read8(src + i) & 0xff);

    const keys = (rosterRecordAddress(slot) + 8 + EQUIPPED_KEY_OFFSET) >>> 0;
    for (let k = 0; k < EQUIPPED_KEY_COUNT; k++) {
        const id = s16(mem.read16(keys + k * 2));
        if (id <= 0) continue;
        const rec = host.definitionRecord(id) | 0;
        const family = mem.read8(rec + 9) & 0xff;
        const def = mem.read32(rec) | 0;
        if (family >= 2 && family <= 14) {
            addClamped(mem, buf + 0xc, mem.read16(def + 0xa));
            for (let i = 0; i < 2; i++) {
                const code = mem.read8(def + 0xc + i);
                if (code !== 0) addEffectiveStat(mem, buf, code, s16(mem.read16(def + 6 + i * 2)));
            }
        } else if (family >= 15 && family <= 20) {
            addClamped(mem, buf + 0xe, mem.read16(def + 0xc));
            for (let i = 0; i < 2; i++) {
                const code = mem.read8(def + 0xa + i);
                if (code !== 0) addEffectiveStat(mem, buf, code, s16(mem.read16(def + 6 + i * 2)));
            }
        } else if (family >= 21 && family <= 24) {
            const code = mem.read8(def + 8);
            if (code !== 0) addEffectiveStat(mem, buf, code, s16(mem.read16(def + 6)));
        } else {
            continue; // families outside 2..24 fold nothing in at all
        }
        addClamped(mem, buf + 0x16, mem.read16(def));
    }

    subtractFloor(mem, buf + 0xc, buf + 0x26);
    subtractFloor(mem, buf + 0xe, buf + 0x28);
    subtractFloor(mem, buf + 0x14, buf + 0x2a);

    const set = (SIGNATURE_SET_TABLE + (slot | 0) * 8) >>> 0;
    let complete = true;
    for (let i = 0; i < 4; i++) {
        if (s16(mem.read16(keys + i * 2)) !== s16(mem.read16(set + i * 2))) {
            complete = false;
            break;
        }
    }
    if (!complete) return;
    const bonus = (SIGNATURE_BONUS_TABLE + (slot | 0) * 12) >>> 0;
    for (let i = 0; i < 6; i++) {
        mem.write16(
            buf + 0xc + i * 2,
            (mem.read16(buf + 0xc + i * 2) + mem.read16(bonus + i * 2)) & 0xffff,
        );
    }
}
