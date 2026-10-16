// Browser/native adapter for the decoded roster record: current form +4,
// equipped value0 triple +50, acquired ledger +58 (44 * 14h).
// Contract: digivolution-tech-system-decoded-2026-07-11.md sections 1–3.
import { isFormDigimonId } from "../roster.ts";
import { EXTRA_FIRST_ID, extraProfileCount, gameFormId, PROFILE_ROWS, walkerIdOf } from "./native/pause-status.ts";
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
    // the enemy-only species made player forms (native/pause-status.ts registerExtraProfiles)
    for (let i = 0; i < extraProfileCount(); i++) {
        const id = EXTRA_FIRST_ID + i, value = gameFormId(mem, id);
        valueById.set(id, value); idByValue.set(value, id);
    }
    return { valueById, idByValue, walkerIdOf: (form: number) => walkerIdOf(mem, form) };
}
/**
 * The roster record's acquired-form ledger has 44 cells and the native screens read only those. With the extra
 * species a Digimon can know more forms than that, so the cells show a WINDOW of the ledger: the forms the
 * screens must accept (the current form and the three equipped ones) always, then one page of the rest in
 * species order. Flip the page with setLedgerPage; the full ledger is untouched in the walker's own data.
 */
export const LEDGER_CELLS = 44;
let ledgerPage = 0;
export function setLedgerPage(page: number): void { ledgerPage = Math.max(0, page | 0); }
export function getLedgerPage(): number { return ledgerPage; }
/** How many pages a ledger of this many forms spans (at least 1). */
export function ledgerPageCount(forms: number, pinned = 4): number {
    return Math.max(1, Math.ceil(Math.max(0, forms - pinned) / (LEDGER_CELLS - pinned)));
}

/**
 * Which ledger entries the native cells show: `pinned` ones (the current form and the equipped three) first,
 * then one page of the rest in species order, at most `cells` in all. Entries are returned as they were given.
 * `pages` is how many pages the whole ledger spans.
 */
export function windowLedger<T extends { id: number }>(
    entries: readonly T[], pinnedIds: ReadonlySet<number>, page = ledgerPage, cells = LEDGER_CELLS,
): { shown: T[]; pages: number; page: number } {
    const pinned = entries.filter((e) => pinnedIds.has(Number(e.id)));
    const others = entries.filter((e) => !pinnedIds.has(Number(e.id))).sort((a, b) => Number(a.id) - Number(b.id));
    const room = Math.max(1, cells - pinned.length);
    const pages = Math.max(1, Math.ceil(others.length / room));
    const at = Math.min(Math.max(0, page | 0), pages - 1);
    return { shown: [...pinned, ...others.slice(at * room, at * room + room)], pages, page: at };
}

export function seedRosterForms(mem: RosterFormMemory, record: number, state: RosterFormState) {
    const { valueById } = nativeFormIds(mem);
    const value = (id: number) => isFormDigimonId(id) ? valueById.get(id) : undefined;
    mem.write32(record + 4, value(Number(state.digimonId)) ?? 0);
    for (let i = 0; i < 3; i++) mem.write16(record + 0x50 + i * 2,
        value(Number(state.equippedForms?.[i])) ?? 0xffff);
    const ledger = (state.formLedger ?? []).filter(e => value(Number(e.id)) !== undefined);
    const indexed = new Map(ledger.filter(e => e.index !== undefined).map(e => [e.index!, e]));
    const pinnedIds = new Set([state.digimonId, ...(state.equippedForms ?? [])].map(Number));
    const unindexed = ledger.filter(e => e.index === undefined);
    const added = windowLedger(unindexed, pinnedIds, ledgerPage, Math.max(1, LEDGER_CELLS - indexed.size)).shown;
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
