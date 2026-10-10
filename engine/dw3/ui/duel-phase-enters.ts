// The card duel's phase-enter arms, translated from pro/cardgame. These are the
// jumps the mode machine's rotate table (0x80083A00) makes when a pending phase
// is entered:
//   F0x800A0548 enterPendingFiveSeven  — pending 5/7
//   F0x800A0F4C enterPendingEight      — pending 8
//   F0x800A1A5C enterPendingNine       — pending 9
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s
//   F0x800a0548 @.L0x0001d898, F0x800a0f4c @.L0x0001e29c, F0x800a1a5c
//   @.L0x0001edac. Read from the assembly, not the m2c C, which merges physically
//   interleaved bodies.
//
// Player-visible result: entering a battle phase re-sorts the hand and re-scans
// the deck (5/7); entering the Set-End phase asks the board view to open then
// flips the phase latch (8); entering the closing phase returns the hand to the
// deck, recycles the opponent's hand and shuffles the piles, then repaints the
// HUD (9). Each arm is a thin caller of services the duel already ships, so the
// services are host edges here and the shared bodies are wired by the session
// (duel-session.ts) — the same arrangement the mode machine uses.
//
// As of this writing only pending-9 is a real body (every callee it reaches is
// already ported). Pending 5/7 needs the duel object's +0x814 selection sort and
// pending 8 needs the board view's +0xEC8 window opener, neither of which is
// ported yet; those two throw a TranslatedGapError naming the callee.

export interface PhaseEnterMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
}

export interface PhaseEnterHost {
    /** F0x800A19F8(block) = returnHandToDeck (duel-pile-service.ts). */
    returnHandToDeck(block: number): void;
    /** F0x8009DA68(duel, scene) = recycleOpponentHandIntoDeck (duel-pile-service.ts). */
    recycleOpponentHandIntoDeck(duel: number, scene: number): void;
    /** `duel+0x810`(duel, offset, count) = F0x8009F04C: shuffle a pile. */
    shufflePile(duel: number, offset: number, count: number): void;
    /** F0x8009EDCC(duel, scene): repaint both HUD strips (duel-counter-service.ts). */
    refreshCounters(duel: number, scene: number): void;
    /** F0x8009D9E4(duel, scene): scan the deck for availability (duel-pile-service.ts). */
    scanDeck(duel: number, scene: number): void;
    /** `duel+0x814`(A, B, packed, flags) = F0x8009EEFC: the hand selection sort. */
    sortHand(a: number, b: number, packed: number, flags: number): void;
    /** `view+0xEC8`(view) = F0x8009C2D0: slide both HUD panels in. */
    slidePanelsIn(view: number): void;
}

/** The duel object's hand-block base the pending-9 arm works on. */
export const DUEL_HAND_BLOCK = 0x59c;
/** The duel fields the pending-9 arm clears. */
export const DUEL_FLAG_304 = 0x304;
export const DUEL_FLAG_305 = 0x305;
export const DUEL_COUNT_300 = 0x300;
export const DUEL_CLEAR_664 = 0x664;
export const DUEL_CLEAR_666 = 0x666;
/** duel+0x574: the pending-5/7 arm clears it. */
export const DUEL_CLEAR_574 = 0x574;
/** The pending-5/7 hand store and its count. */
export const DUEL_HAND_STORE = 0x600;
export const DUEL_HAND_COUNT = 0x5a6;

/**
 * F0x8009EEFC(A, B, packed, flags) — the hand selection sort the duel installs
 * at `duel+0x814`. `packed`'s low halfword is the first index and its signed
 * high halfword the end; the sort orders `B[start..end)` by the key
 * `s16(A + B[i]*2 + 0x50)`, bringing the smaller key forward. When `flags & 1`
 * the two indices' `B` entries swap (otherwise the inner entry is only copied
 * forward) together with their `+0x30A`/`+0x30B` meta bytes; when `flags & 2`
 * their `+0x446` byte swaps too. Read from exe-decomp/cardgame.norm.s
 * .L0x0001c24c.
 */
export function handSelectionSort(
    mem: PhaseEnterMemory, a: number, b: number, packed: number, flags: number,
): void {
    const start = packed & 0xffff;
    const n = packed >> 16;
    const flagA = (flags & 1) !== 0;
    const flagB = (flags & 2) !== 0;
    const key = (t: number): number => {
        const idx = mem.read16s(t);
        return mem.read16s(a + idx * 2 + 0x50);
    };
    for (let t4 = start; t4 < n - 1; t4++) {
        const t9 = a + t4 * 2;
        const t8 = b + t4 * 2;
        if (!(t4 + 1 < n)) continue;
        const t5 = t9;
        const t3 = a + (t4 - start);
        for (let t0 = t4 + 1; t0 < n; t0++) {
            const t2 = a + t0 * 2;
            const t1 = b + t0 * 2;
            const outerKey = key(t8);
            const innerKey = key(t1);
            const bOuter = mem.read16(t8) & 0xffff;
            const bInner = mem.read16(t1) & 0xffff;
            if (!(innerKey < outerKey)) continue;
            mem.write16(t8, bInner);
            // `sh $a0, ($t1)` sits in the flagA branch's DELAY slot, so the two B
            // entries always swap; flagA only gates the +0x30A/+0x30B meta swap.
            mem.write16(t1, bOuter);
            if (flagA) {
                const m1 = mem.read8(t5 + 0x30a), m2 = mem.read8(t5 + 0x30b);
                const n1 = mem.read8(t2 + 0x30a), n2 = mem.read8(t2 + 0x30b);
                mem.write8(t5 + 0x30a, n1); mem.write8(t5 + 0x30b, n2);
                mem.write8(t2 + 0x30a, m1); mem.write8(t2 + 0x30b, m2);
            }
            if (flagB) {
                const innerByte = a + (t0 - start);
                const x = mem.read8(innerByte + 0x446), y = mem.read8(t3 + 0x446);
                mem.write8(t3 + 0x446, x); mem.write8(innerByte + 0x446, y);
            }
        }
    }
}

/**
 * F0x800A0548(duel, scene): entering a battle phase (pending 5/7). Repaint the
 * HUD strips, clear duel+0x574, then selection-sort the hand store (duel+0x600)
 * up to the count at duel+0x5A6. Read from exe-decomp/cardgame.norm.s
 * .L0x0001d898.
 */
export function enterPendingFiveSeven(
    mem: PhaseEnterMemory, host: PhaseEnterHost, duel: number, scene: number,
): void {
    host.refreshCounters(duel, scene);
    mem.write8(duel + DUEL_CLEAR_574, 0);
    host.sortHand(duel, duel + DUEL_HAND_STORE, (mem.read16s(duel + DUEL_HAND_COUNT) << 16) | 0, 0);
}

/**
 * F0x800A0F4C(duel, scene): entering the Set-End phase (pending 8). Ask the
 * board view to slide both panels in, then set the two entering flags and clear
 * the ending flag. Read from exe-decomp/cardgame.norm.s .L0x0001e29c.
 */
export function enterPendingEight(
    mem: PhaseEnterMemory, host: PhaseEnterHost, duel: number, scene: number,
): void {
    const view = mem.read32(scene + 0x18) | 0;
    host.slidePanelsIn(view);
    mem.write8(duel + 0x49d, 1);
    mem.write8(duel + 0x499, 1);
    mem.write8(duel + 0x2f9, 0);
}

/**
 * F0x800A1A5C(duel, scene): entering the closing phase. Return the hand to the
 * deck, recycle the opponent's hand into theirs, shuffle both piles from the
 * block's own offset/count pair, clear the five hand/flag words, repaint the HUD
 * and rescan the deck, then bump the round counter. The counter store sits in
 * the original's `jr`/`jal` delay slot, so it lands before the callee body runs.
 */
export function enterPendingNine(
    mem: PhaseEnterMemory, host: PhaseEnterHost, duel: number, scene: number,
): void {
    const block = (duel + DUEL_HAND_BLOCK) | 0;
    host.returnHandToDeck(block);
    host.recycleOpponentHandIntoDeck(duel, scene);
    host.shufflePile(duel, mem.read16s(block + 4), mem.read16s(block + 8));
    mem.write8(duel + DUEL_FLAG_304, 0);
    mem.write8(duel + DUEL_FLAG_305, 0);
    mem.write16(block + 0, 0);
    mem.write16(block + 2, 0);
    mem.write16(duel + DUEL_CLEAR_664, 0);
    mem.write16(duel + DUEL_CLEAR_666, 0);
    host.refreshCounters(duel, scene);
    mem.write8(duel + DUEL_COUNT_300, (mem.read8(duel + DUEL_COUNT_300) + 1) & 0xff);
    host.scanDeck(duel, scene);
}
