// Browser/native adapter for the decoded roster record: current form +4,
// equipped value0 triple +50, acquired ledger +58 (44 * 14h).
// Contract: digivolution-tech-system-decoded-2026-07-11.md sections 1–3.
import { gameFormId, PROFILE_ROWS, walkerIdOf } from "./native/pause-status.ts";
export interface RosterFormMemory {
    read16(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}
export interface RosterFormState {
    digimonId?: number;
    rawLedger?: number[];
    equippedForms?: number[];
    formLedger?: { id: number; formLevel?: number; dvexp?: number; techSlots?: number[]; preservedByte?: number; index?: number }[];
}
/**
 * Both directions of the one id mapping, over the profile table the species getter
 * itself scans. This used to walk 52 hand-counted rows here and again in
 * fight-tag-session.ts; it is now native/pause-status.ts's `gameFormId` and
 * `walkerIdOf` over its decoded 55, so every caller that hands a Digimon id to a
 * translated screen gets the same answer.
 */
export function nativeFormIds(mem: Pick<RosterFormMemory, "read16">) {
    const valueById = new Map<number, number>();
    const idByValue = new Map<number, number>();
    for (let id = 1; id <= PROFILE_ROWS; id++) {
        const value = gameFormId(mem, id);
        valueById.set(id, value); idByValue.set(value, id);
    }
    return { valueById, idByValue, walkerIdOf: (form: number) => walkerIdOf(mem, form) };
}
export function seedRosterForms(mem: RosterFormMemory, record: number, state: RosterFormState) {
    const { valueById } = nativeFormIds(mem);
    const value = (id: number) => id > 8 ? valueById.get(id) : undefined;
    mem.write32(record + 4, value(Number(state.digimonId)) ?? 0);
    for (let i = 0; i < 3; i++) mem.write16(record + 0x50 + i * 2,
        value(Number(state.equippedForms?.[i])) ?? 0xffff);
    const ledger = (state.formLedger ?? []).filter(e => value(Number(e.id)) !== undefined);
    const indexed = new Map(ledger.filter(e => e.index !== undefined).map(e => [e.index!, e]));
    const added = ledger.filter(e => e.index === undefined);
    let nextAdded = 0;
    for (let i = 0; i < 44; i++) {
        const base = record + 0x58 + i * 0x14;
        for (let off = 0; off < 0x14; off++) mem.write8(base + off, state.rawLedger?.[i * 0x14 + off] ?? 0);
        // Loaded entries keep their cells. A newly learned form takes the next
        // empty cell rather than disappearing behind the indexed entries.
        const cellId = mem.read16(base);
        const entry = indexed.get(i) ?? ((cellId === 0 || cellId === 0xffff) ? added[nextAdded++] : undefined);
        if (!entry) continue;
        mem.write16(base, value(Number(entry.id))!);
        mem.write8(base + 2, entry.formLevel ?? 1);
        mem.write8(base + 3, entry.preservedByte ?? 0);
        mem.write32(base + 4, Number(entry.dvexp) || 0);
        for (let j = 0; j < 6; j++) mem.write16(base + 8 + j * 2, entry.techSlots?.[j] ?? 0);
    }
}
