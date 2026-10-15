// The fight report's reward services, translated from the original pro/stfgtrep
// overlay. The row state machine reaches them only through the function-pointer
// slots at 0x8008913C..0x80089168 (installed as data in the overlay), never by
// direct call; report-row.ts names each slot on its host:
//
//   [0x80089154] F0x80086184 reportAddExperience  add EXP (cap 999,999), loop the level curve
//   (callee)     F0x80085E3C reportLevelUp         one level's stat gains (HP, MP, six core, seven element)
//   [0x80089158] F0x8008634C reportUnlockForm      first evolution row whose requirements are met
//   [0x8008915C] F0x800865C0 reportDvLadder        raise the form level from its DVEXP
//   [0x80089160] F0x8008670C reportLearnTechnique  fill the next empty technique slot
//   [0x80089164] F0x80086844 reportMakeLoadable    mark the next learned technique loadable
//   [0x80089168] F0x80086924 reportDvGain          one battle's DVEXP gain for a form
//
// Oracle: tests/lane-b/fight-report-rewards.test.js runs each original through
// engine/native (the resident record getters, form-ledger writers and profile
// lookup run too) over the same seeded save context and compares every byte the
// service can touch and the return value. The DECODING is in the asm: the m2c
// bodies in exe-decomp/stfgtrep_c mis-attribute two things (the `+1` in the
// F0x80086844 requirement index, and the four-argument calls), so the asm rules.
//
// Resident providers, each a registered port:
//   [0x8004B484]        F0x80017B4C persistentRosterSlot   record base of a slot (party-context.ts)
//   [0x8004B47C]/+0x2748 F0x80017A1C formEntryCopy          copy a ledger entry (pause-techniques.ts)
//   [0x8004B480]/+0x274C F0x80017AB4 writeFormEntry         write it back (form-ledger-edit.ts)
//   [0x8005CCA0]        F0x800134E8 profileRecord           species record for a form value (pause-status.ts)
//   +0x2738 validateEquippedForm, +0x273C setEquippedForms, +0x2744 addForm
// Platform provider: [0x8004DC04+8] = F0x8001933C RAND_U16, injected as `host.rand`.
import { persistentRosterSlot } from "../../party-context.ts";
import { validateEquippedForm } from "../../form-ledger.ts";
import { addForm, setEquippedForms, writeFormEntry } from "../../form-ledger-edit.ts";
import { formEntryCopy } from "./pause-techniques.ts";
import { gameFormId, profileRecord } from "./pause-status.ts";

export interface RewardMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface RewardHost {
    /** F0x8001933C RAND_U16: a 16-bit random value (platform RNG). */
    rand(): number;
    /** A 0x40-byte scratch block standing in for the original's stack buffers. */
    scratch: number;
}

/** The species record base and stride (also the profile table profileRecord searches). */
export const REWARD_SPECIES_BASE = 0x8003ef5c;
export const REWARD_SPECIES_STRIDE = 0x58;
/** Overlay data the services read (installed from the data build). */
export const REWARD_BONUS_TABLE = 0x8008916c;      // 4 words: level-bracket EXP bonus
export const REWARD_HPMP_ADJUST = 0x8008917c;      // 4 words: HP/MP growth bracket adjustment
export const REWARD_HPMP_RANDOM = 0x8008918c;      // 9 words indexed by rand % 9
export const REWARD_CORE_TABLE = 0x800891b0;       // 6 tiers x 9 words, indexed by growth + rand % 5
export const REWARD_ELEMENT_TABLE = 0x80089288;    // words indexed by growth + rand % 4
export const REWARD_EVOLUTION_GROUPS = 0x8008903c; // per-slot pointer to 0x2C0 bytes of 0x10-byte rows
export const REWARD_EXP_CAP = 0x0f423f;
export const REWARD_DVEXP_CAP = 0x98967f;

const s16 = (v: number): number => (v << 16) >> 16;
const s8 = (v: number): number => (v << 24) >> 24;
const species = (slot: number): number => (REWARD_SPECIES_BASE + Math.imul(slot | 0, REWARD_SPECIES_STRIDE)) >>> 0;

/** F0x80085E3C(slot, level): apply one level-up's stat gains to the slot's record. */
export function reportLevelUp(mem: RewardMemory, slot: number, level: number, host: RewardHost): void {
    const record = persistentRosterSlot(slot);
    const prof = species(slot);
    level = s16(level);
    const bracket = level < 5 ? 0 : level < 0x14 ? 1 : level < 0x28 ? 2 : 3;
    const adjust = mem.read32(REWARD_HPMP_ADJUST + bracket * 4) | 0;
    const rollHpMp = (growthOffset: number, statOffset: number): void => {
        const roll = host.rand() >>> 0;
        const gain = ((mem.read8(prof + growthOffset) - adjust) + (mem.read32(REWARD_HPMP_RANDOM + (roll % 9) * 4) | 0)) | 0;
        const value = (mem.read16(record + statOffset) + gain) & 0xffff;
        mem.write16(record + statOffset, s16(value) >= 0x2710 ? 0x270f : value);
    };
    rollHpMp(0x41, 0x22);
    rollHpMp(0x42, 0x26);

    const tier = level < 5 ? 0 : level < 0x14 ? 1 : level < 0x28 ? 2 : level < 0x3c ? 3 : level < 0x50 ? 4 : 5;
    const block = record + 0x1c;
    for (let i = 0; i < 6; i++) {
        const growth = mem.read8(prof + 0x43 + i);
        const roll = host.rand() >>> 0;
        const gain = mem.read32(REWARD_CORE_TABLE + tier * 0x24 + (growth + (roll % 5)) * 4) | 0;
        const value = (mem.read16(block + 0xc + i * 2) + gain) & 0xffff;
        mem.write16(block + 0xc + i * 2, s16(value) >= 0x3e8 ? 0x3e7 : value);
    }
    if (level < 0x29) {
        for (let i = 0; i < 7; i++) {
            const growth = mem.read8(prof + 0x49 + i);
            const roll = host.rand() >>> 0;
            const gain = mem.read32(REWARD_ELEMENT_TABLE + (growth + (roll % 4)) * 4) | 0;
            const value = (mem.read16(block + 0x18 + i * 2) + gain) & 0xffff;
            mem.write16(block + 0x18 + i * 2, s16(value) >= 0x3e8 ? 0x3e7 : value);
        }
    }
}

/** F0x80086184(slot, gain): add EXP and run the level curve; 1 when a level was gained. */
export function reportAddExperience(mem: RewardMemory, slot: number, gain: number, host: RewardHost): number {
    const record = persistentRosterSlot(slot);
    const prof = species(slot);
    let exp = ((mem.read32(record + 0x18) | 0) + (gain | 0)) | 0;
    mem.write32(record + 0x18, exp >>> 0);
    if (REWARD_EXP_CAP < exp) { exp = REWARD_EXP_CAP; mem.write32(record + 0x18, exp); }
    let result = 0;
    let level = s16(mem.read16(record + 0x1c)) + 1;
    for (;;) {
        let bracket: number;
        if (level < 5) bracket = 0;
        else if (level < 0x14) bracket = 1;
        else if (level < 0x28) bracket = 2;
        else if (level < 0x64) bracket = 3;
        else return result;
        const cubic = (Math.imul(Math.imul(level, level), level) + level * 5 - 6) | 0;
        const threshold = (Math.trunc(Math.imul(cubic, mem.read8(prof + 0x3e)) / 10) + (mem.read32(REWARD_BONUS_TABLE + bracket * 4) | 0)) | 0;
        if (!(threshold < ((mem.read32(record + 0x18) | 0)))) return result;
        const next = (mem.read16(record + 0x1c) + 1) & 0xffff;
        mem.write16(record + 0x1c, next);
        if (s16(next) < 0x64) reportLevelUp(mem, slot, s16(next), host);
        else mem.write16(record + 0x1c, 0x63);
        const tp = (mem.read16(record + 0x1e) + 5) & 0xffff;
        mem.write16(record + 0x1e, tp);
        result = 1;
        if (s16(tp) >= 0x64) mem.write16(record + 0x1e, 0x63);
        level += 1;
    }
}

/**
 * The extra species' unlock records (web/extra-roster.js registers them), per roster slot: the same {to, prerequisites,
 * kind, threshold} shape as the disc's 0x10-byte rows, but in walker ids, because the disc's own table of 44 rows
 * per line has no room for them. They are tried after the disc's 44, in order, so the routine still grants the FIRST
 * passing record and nothing else.
 */
export interface ExtraEvolutionRow {
    to: number; req0: number; req0Level: number; req1: number; req1Level: number; kind: number; threshold: number;
}
let extraEvolutionRows: ExtraEvolutionRow[][] = [];
/** Register the extra unlock records per roster slot (index = slot), or clear them with null. */
export function registerExtraEvolutionRows(rows: ExtraEvolutionRow[][] | null): void {
    extraEvolutionRows = rows ?? [];
}
/** The forms (walker id -> form level) a slot owns beyond what the record's 44 ledger cells show. */
let ownedOutsideCells: Map<number, number>[] = [];
/** A slot that has been granted a form in this report: the game learns one form per fight, so no extra follows it. */
let grantedThisReport: boolean[] = [];
export function setReportOwnedForms(slot: number, owned: ReadonlyMap<number, number> | null): void {
    ownedOutsideCells[slot | 0] = new Map(owned ?? []);
    grantedThisReport[slot | 0] = false;
}

/** The extra records' pass of F0x8008634C: same rules as the disc's loop, over walker ids. */
function reportUnlockExtraForm(mem: RewardMemory, slot: number, host: RewardHost): number {
    const rows = extraEvolutionRows[slot | 0];
    if (!rows?.length || grantedThisReport[slot | 0]) return 0;
    const buf = host.scratch;
    const equipped = host.scratch + 0x20;
    const valueOf = (id: number): number => gameFormId(mem as never, id);
    // a form's level: from its ledger cell, else from the owned list; -1 when the slot does not have it
    const levelOf = (id: number): number => {
        const value = valueOf(id);
        if (value > 0 && formEntryCopy(mem, slot, value, buf) !== -1) return s8(mem.read8(buf + 2));
        return ownedOutsideCells[slot | 0]?.get(id) ?? -1;
    };
    for (const row of rows) {
        let form = valueOf(row.to);
        if (form <= 0 || levelOf(row.to) !== -1) continue; // not a species here, or already acquired
        for (const [req, need] of [[row.req0, row.req0Level], [row.req1, row.req1Level]] as const) {
            if (req === 0) continue;
            const have = levelOf(req);
            if (have === -1 || have < need) form = -1;
        }
        if (form <= 0) continue;
        if (row.kind !== 0) {
            const record = persistentRosterSlot(slot);
            let value: number;
            if (row.kind < 7) value = s16(mem.read16(record + row.kind * 2 + 0x26));
            else if (row.kind === 7) value = s16(mem.read16(record + 0x1c));
            else value = s16(mem.read16(record + row.kind * 2 + 0x24));
            if (value < row.threshold) continue;
        }
        addForm(mem, slot, form);
        // a form the 44 cells had no room for still counts as owned for the rest of this report
        (ownedOutsideCells[slot | 0] ??= new Map()).set(row.to, 1);
        grantedThisReport[slot | 0] = true;
        validateEquippedForm(mem, slot, equipped);
        for (let i = 0; i < 3; i++) {
            if (s16(mem.read16(equipped + i * 2)) < 3) {
                mem.write16(equipped + i * 2, form & 0xffff);
                setEquippedForms(mem, slot, equipped);
                return form;
            }
        }
        return form;
    }
    return 0;
}

/** F0x8008634C(slot): grant the first evolution row whose requirements are met; the form value, else 0. */
export function reportUnlockForm(mem: RewardMemory, slot: number, host: RewardHost): number {
    const buf = host.scratch;
    const equipped = host.scratch + 0x20;
    const group = mem.read32(REWARD_EVOLUTION_GROUPS + slot * 4) >>> 0;
    const formOf = (row: number): number => mem.read16(REWARD_SPECIES_BASE + Math.imul(mem.read32(row) - 1, REWARD_SPECIES_STRIDE));
    for (let row = group; row < group + 0x2c0; row += 0x10) {
        let form = formOf(row);
        if (formEntryCopy(mem, slot, form, buf) >= 0) continue; // already acquired
        if (form <= 0) continue;
        for (let k = 0; k < 2; k++) {
            const prerequisite = s16(mem.read16(row + 4 + k * 4));
            if (prerequisite === 0) continue;
            const prerequisiteForm = mem.read16(REWARD_SPECIES_BASE + Math.imul(prerequisite - 1, REWARD_SPECIES_STRIDE));
            const index = formEntryCopy(mem, slot, prerequisiteForm, buf);
            if (index === -1 || s8(mem.read8(buf + 2)) < s16(mem.read16(row + 6 + k * 4))) form = -1;
        }
        if (form <= 0) continue;
        const kind = s16(mem.read16(row + 0xc));
        if (kind !== 0) {
            const record = persistentRosterSlot(slot);
            let value: number;
            if (kind < 7) value = s16(mem.read16(record + kind * 2 + 0x26));
            else if (kind === 7) value = s16(mem.read16(record + 0x1c));
            else value = s16(mem.read16(record + kind * 2 + 0x24));
            if (value < s16(mem.read16(row + 0xe))) form = -1;
        }
        if (form <= 0) continue;
        addForm(mem, slot, form);
        validateEquippedForm(mem, slot, equipped);
        for (let i = 0; i < 3; i++) {
            if (s16(mem.read16(equipped + i * 2)) < 3) {
                mem.write16(equipped + i * 2, form & 0xffff);
                setEquippedForms(mem, slot, equipped);
                grantedThisReport[slot | 0] = true;
                return form;
            }
        }
        grantedThisReport[slot | 0] = true;
        return form;
    }
    return reportUnlockExtraForm(mem, slot, host);
}

/** F0x800865C0(slot, form, gain): add DVEXP and raise the form level; 1 when a level was gained. */
export function reportDvLadder(mem: RewardMemory, slot: number, form: number, gain: number, host: RewardHost): number {
    const buf = host.scratch;
    const prof = profileRecord(mem, form);
    formEntryCopy(mem, slot, form, buf);
    let dvexp = ((mem.read32(buf + 4) | 0) + (gain | 0)) | 0;
    mem.write32(buf + 4, dvexp >>> 0);
    if (REWARD_DVEXP_CAP < dvexp) { dvexp = REWARD_DVEXP_CAP; mem.write32(buf + 4, dvexp); }
    if (s8(mem.read8(buf + 2)) >= 0x63) return 0;
    let gained = 0;
    for (;;) {
        const level = s8(mem.read8(buf + 2));
        const cap = mem.read8(prof + 0x3c);
        const threshold = cap < level + 1
            ? 2 * (5 * (cap - 1) + 25 * (level - (cap - 1)))
            : level * 10;
        if (dvexp < threshold) break;
        gained = 1;
        const next = (mem.read8(buf + 2) + 1) & 0xff;
        mem.write8(buf + 2, next);
        if (!(s8(next) < 0x63)) break;
    }
    writeFormEntry(mem, slot, form, buf);
    return gained;
}

/** F0x8008670C(slot, form): learn the form's next technique; its id, else 0. */
export function reportLearnTechnique(mem: RewardMemory, slot: number, form: number, host: RewardHost): number {
    const buf = host.scratch;
    formEntryCopy(mem, slot, form, buf);
    for (let i = 0; i < 6; i++) {
        if (s16(mem.read16(buf + 8 + i * 2)) !== 0) continue;
        const prof = profileRecord(mem, form);
        const tech = mem.read16(prof + 0x1e + i * 2);
        if (tech === 0) continue;
        if (s8(mem.read8(buf + 2)) < mem.read8(prof + 0x31 + i)) continue;
        mem.write16(buf + 8 + i * 2, tech);
        if (i === 5) mem.write16(buf + 0x12, mem.read16(buf + 0x12) | 0x8000);
        writeFormEntry(mem, slot, form, buf);
        return tech;
    }
    return 0;
}

/** F0x80086844(slot, form): mark the next learned technique loadable; its id, else 0. */
export function reportMakeLoadable(mem: RewardMemory, slot: number, form: number, host: RewardHost): number {
    const buf = host.scratch;
    formEntryCopy(mem, slot, form, buf);
    const prof = profileRecord(mem, form);
    for (let i = 0; i < 5; i++) {
        const value = s16(mem.read16(buf + 8 + i * 2));
        if (value <= 0 || (value & 0x2000) !== 0) continue;
        if (s8(mem.read8(buf + 2)) < mem.read8(prof + 0x37 + i)) continue;
        mem.write16(buf + 8 + i * 2, (value | 0x2000) & 0xffff);
        writeFormEntry(mem, slot, form, buf);
        return mem.read16(buf + 8 + i * 2) & 0x1fff;
    }
    return 0;
}

/** F0x80086924(slot, form, score, count): one battle's DVEXP gain for the form (1..10 or 1..50). */
export function reportDvGain(mem: RewardMemory, slot: number, form: number, score: number, count: number, host: RewardHost): number {
    const record = persistentRosterSlot(slot);
    const level = s16(mem.read16(record + 0x1c));
    let base: number;
    if (level < 0x33) {
        const numerator = Math.imul(score | 0, 10);
        base = level === 0 ? (numerator >= 0 ? -1 : 1) : Math.trunc(numerator / level);
    }
    else base = Math.trunc((score | 0) / 5); // the level divisor caps at 50: score * 10 / 50
    count |= 0;
    let share: number;
    if (count < 0) share = Math.trunc(base / count);
    else if (count < 2) share = base;
    else if (count === 2) share = Math.trunc(Math.imul(base, 6) / 10);
    else share = Math.trunc(base / count);
    const prof = profileRecord(mem, form);
    formEntryCopy(mem, slot, form, host.scratch);
    if (!(share > 0)) return 1;
    if (s8(mem.read8(host.scratch + 2)) < mem.read8(prof + 0x3c)) return share < 0xb ? share : 0xa;
    return share < 0x33 ? share : 0x32;
}
