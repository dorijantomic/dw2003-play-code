// The duel's opponent AI — its choice gate, its scoring and its narrowing.
//
// On the opponent's turn the card duel does not ask "which move wins"; it asks
// a fixed sequence of small, deterministic questions and takes the first answer.
// The canon (§9 of docs/research/card/CARD-DUEL-VERIFIED.md) calls this layer
// `0x800A3934..0x800A4DFF`; it consults no random source and reads only public
// state. This module ports that layer, read from the overlay assembly
// `exe-decomp/cardgame.norm.s` (authority 2), not the m2c C — several of these
// routines open with a `jr $v0` jump table that m2c merges or loses.
//
// Player's view: the opponent's turn arrives, a short think pause runs
// (waitAiThinkWindow), then it asks the legality gate whether a card may be
// played (cardHasLegalTarget), scores each still-marked target slot and keeps
// the best (chooseBestTarget / evaluateBoard), and commits one. Nothing here is
// random: the same board always yields the same play.
//
// Source (assembly, cardgame.norm.s):
//   F0x8009DEC4 waitAiThinkWindow      @.L0x0001b214
//   F0x800A36E4 cardHasLegalTarget     @.L0x00020a34  (table D0x80083B04)
//   F0x800A3934 evaluateBoard          @.L0x00020c84
//   F0x800A3D90 chooseBestTarget       @.L0x000210e0
//   F0x800A3E9C commitFirstMarked      @.L0x000211ec
//   F0x800A3F48 narrowToGreen          @.L0x00021298
//   F0x800A4078 narrowToRed            @.L0x000213c8
//   F0x800A41A8 wouldFinish            @.L0x000214f8
//   F0x800A41F8 narrowToLethal         @.L0x00021548
//   F0x800A4328 cheapestHandCard       @.L0x00021678
//   F0x800A4440 programDamage          @.L0x00021790  (table D0x80083BA4)
//   F0x800A4494 programBuff            @.L0x000217e4  (table D0x80083C44)
//   F0x800A4924 findHandEntryByClass   @.L0x00021c74
//   F0x800A0CD4 scanComboRuns          @.L0x0001e024
//   F0x800A44F0 aiWorthPlaying         @.L0x00021840  (table D0x80083D2C)
//   F0x800A45F8 aiSimulateCounter      @.L0x00021948  (table D0x80083E14)
//   F0x800A4978 aiChooseCardToPlay     @.L0x00021cc8
//
// Host edges the AI calls but this module does not define:
//   F0x8001E7EC the card-record selector (resolveCardRecord: card id -> record)
//   F0x80085F38 isSummonableCard (a Digimon card affordable this phase)
//   F0x80083E34 cardField (one byte of the 0x2C-stride card table at 0x800A4DF4;
//               field 0 is the class the legality gate and the worth-it test read)
//   F0x8008EC44 / F0x8008EEC8 the two collection probes the legality gate uses
//   view slot +0xEC4 (the think animation) for waitAiThinkWindow
//
// Layout the family reads (duel = the duel object base):
//   +0x50        the side's card-id list (u16)
//   +0x446/+0x44C side 0 / side 1 field-slot marker bytes (one per slot)
//   +0x575       cards played this turn (s8)
//   +0x580       per-played-card ids, stride 8
//   +0x585       per-played-card class, stride 8
//   +0x586       per-played-card committed field, stride 8
//   +0x66E       the opponent hand count (s16)
//   +0x6C8       the opponent hand-order array, stride 2
//   +0x72C       per-side field row: count byte, then records of 0xE bytes
//   +0x72E       record +0x02 the slot's card id (u16)   [row-relative]
//   +0x734       record +0x08 summed AP (s16)
//   +0x736       record +0x0A summed HP (s16)
//   +0x73A       record +0x0E the card-record class byte cached on the slot
//   +0x7AC       side 1's field row +0x0E

export interface AiMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface AiHost {
    /** F0x8001E7EC(id): the address of a card's 0x62C-stride CARDPAK record. */
    resolveCardRecord(cardId: number): number;
    /** F0x80083E34(instance, field): one byte of the 0x2C-stride duel card table at 0x800A4DF4. */
    cardField(instance: number, field: number): number;
    /** F0x80085F38(duel, index): is the card at duel+0x50+index*2 summonable now? */
    isSummonableCard(duel: number, index: number): boolean;
    /** F0x8008EC44(duel, side, selector, extra, arg): a collection probe. */
    fieldProbe(duel: number, side: number, selector: number, extra: number, arg: number): number;
    /** F0x8008EEC8(duel, side, selector, extra): the second collection probe. */
    fieldProbeKind(duel: number, side: number, selector: number, extra: number): number;
    /** The think-window view method slot +0xEC4, called on read32(ctx+0x18). */
    armThinkWindow(target: number): void;
}

const s8 = (v: number) => (v << 24) >> 24;
const s16 = (v: number) => (v << 16) >> 16;
const u8 = (v: number) => v & 0xff;
/** The MIPS `srav`: arithmetic shift right by the low five bits of n. */
const sra = (v: number, n: number) => v >> (n & 31);

/** Per-side field-row stride in the duel object. */
export const AI_SIDE_STRIDE = 0x72;
/** Slot stride inside a side's field row. */
export const AI_SLOT_STRIDE = 0xe;

// ── F0x8009DEC4 waitAiThinkWindow ───────────────────────────────────────────

/**
 * F0x8009DEC4(duel, ctx): the opponent's "thinking" pause. The first call arms
 * the pause (through the ctx slot +0xEC4) and starts the counter at +0x4E8;
 * every later call reports done once the view animation has finished and the
 * board is not busy. Returns 1 when the AI may act.
 */
export function waitAiThinkWindow(mem: AiMemory, host: AiHost, duel: number, ctx: number): number {
    let v0 = mem.read32(duel + 0x4e8);
    if (v0 === 0) {
        mem.write8(duel + 0x499, 2);
        const target = mem.read32(ctx + 0x18);
        host.armThinkWindow(target);
        v0 = mem.read32(duel + 0x4e8);
        mem.write32(duel + 0x4e8, (v0 + 1) | 0);
    }
    const anim = mem.read32(ctx + 0x18);
    if (mem.read16s(anim + 0x64) !== 0) return 0;
    if (u8(mem.read8(duel + 0x498)) !== 0) return 0;
    return 1;
}

// ── F0x800A4924 findHandEntryByClass ────────────────────────────────────────

/**
 * F0x800A4924(duel, class): the index into the opponent's hand-order array of
 * the first entry whose card class equals `class`, or the hand count when none.
 * The class byte is `duel + (entry-40)*4 + 0x35C`.
 */
export function findHandEntryByClass(mem: AiMemory, duel: number, cardClass: number): number {
    const count = mem.read16s(duel + 0x66e);
    if (count <= 0) return 0;
    let index = 0;
    let a2 = duel;
    do {
        const entry = mem.read16s(a2 + 0x6c8);
        const at = duel + (((entry - 0x28) << 2) | 0);
        if (u8(mem.read8(at + 0x35c)) === cardClass) return index;
        index += 1;
        a2 += 2;
    } while (index < count);
    return index;
}

// ── F0x800A4440 programDamage / F0x800A4494 programBuff ─────────────────────

/** Per-class Program damage constants (table D0x80083BA4, index class-0x12). */
const PROGRAM_DAMAGE: Record<number, number> = { 0x12: 0x3c, 0x14: 0xf, 0x15: 0x1e, 0x2e: 0x1e, 0x38: 0xa };

/** F0x800A4440(_, class): damage a Program's class deals, or 0. */
export function programDamage(_duel: number, cardClass: number): number {
    if (((cardClass - 0x12) >>> 0) >= 0x27) return 0;
    return PROGRAM_DAMAGE[cardClass] ?? 0;
}

/** Per-class Program buff constants (table D0x80083C44, index class-2). */
const PROGRAM_BUFF: Record<number, number> = { 0x02: 0xf, 0x03: 0x1e, 0x0c: 0x32, 0x0f: 0x14, 0x28: 0x1e, 0x3a: 0xa };

/** F0x800A4494(_, class): stat a Program's class raises, or 0. */
export function programBuff(_duel: number, cardClass: number): number {
    if (((cardClass - 0x02) >>> 0) >= 0x39) return 0;
    return PROGRAM_BUFF[cardClass] ?? 0;
}

// ── F0x800A41A8 wouldFinish ─────────────────────────────────────────────────

/**
 * F0x800A41A8(_, slot, amount): does `amount` reach the slot's summed HP? The
 * slot must still be marked in SIDE 0's marker array (duel+0x446), which is
 * fixed. Returns 1 when amount >= the slot's summed HP.
 */
export function wouldFinish(mem: AiMemory, duel: number, _side: number, slot: number, amount: number): number {
    if (s8(mem.read8(duel + 0x446 + slot)) === 0) return 0;
    const at = duel + _side * AI_SIDE_STRIDE + slot * AI_SLOT_STRIDE;
    return amount >= mem.read16s(at + 0x736) ? 1 : 0;
}

// ── F0x800A41F8 narrowToLethal ──────────────────────────────────────────────

/**
 * F0x800A41F8(duel, side, amount, flag): narrow the marked slots on `side` to
 * lethal ones. A slot whose summed HP exceeds `amount` is unmarked; the last
 * such slot is remembered. If any marked slot survives, return 0 (a lethal
 * target exists). Otherwise, if `flag` is zero, re-mark the remembered slot as
 * the fallback and return 1.
 */
export function narrowToLethal(mem: AiMemory, duel: number, side: number, amount: number, flag: number): number {
    const marks = duel + (side === 1 ? 0x44c : 0x446);
    const count = u8(mem.read8(duel + side * AI_SIDE_STRIDE + 0x72c));
    let last = 0;
    for (let i = 0; i < count; i++) {
        if (s8(mem.read8(marks + i)) === 0) continue;
        if (amount < mem.read16s(duel + side * AI_SIDE_STRIDE + i * AI_SLOT_STRIDE + 0x736)) {
            last = i;
            mem.write8(marks + i, 0);
        }
    }
    let anyMarked = 0;
    for (let i = 0; i < count; i++) if (s8(mem.read8(marks + i)) !== 0) { anyMarked = 1; break; }
    if (anyMarked !== 0) return 0;
    // The flag arm returns 1 through the delay slot of its branch: it does not
    // re-mark. Only a zero flag re-marks the remembered slot.
    if (flag !== 0) return 1;
    mem.write8(marks + last, 1);
    return 1;
}

// ── F0x800A4328 cheapestHandCard ────────────────────────────────────────────

/**
 * F0x800A4328(duel): among the marked slots of side 0, find the hand card with
 * the smallest record +0x08 (strength rank — lower is stronger), then commit
 * that card's hand-order byte into the played entry at duel + played*8 + 0x586.
 * Returns 1 when committed, 0 when none was marked.
 */
export function cheapestHandCard(mem: AiMemory, host: AiHost, duel: number): number {
    let bestRank = 0x1f4;
    let bestSlot = 0x1f4;
    let found = 0;
    const count = mem.read16s(duel + 0x66e);
    for (let i = 0; i < count; i++) {
        if (s8(mem.read8(duel + 0x446 + i)) === 0) continue;
        const entry = mem.read16s(duel + 0x6c8 + i * 2);
        const cardId = mem.read16(duel + 0x50 + entry * 2);
        const rank = mem.read16s(host.resolveCardRecord((cardId + 1) | 0) + 0x8);
        if (rank < bestRank) { found = 1; bestRank = rank; bestSlot = i; }
    }
    if (found !== 1) return 0;
    const entry = u8(mem.read8(duel + 0x6c8 + bestSlot * 2));
    mem.write8(duel + s8(mem.read8(duel + 0x575)) * 8 + 0x586, entry);
    return 1;
}

// ── F0x800A3E9C commitFirstMarked ───────────────────────────────────────────

/**
 * F0x800A3E9C(duel, side): commit the first still-marked slot on `side` (side
 * 0's markers at +0x446, side 1's at +0x44C). The chosen slot's cached class
 * byte (at duel+side*0x72+slot*0xE+0x73A) is copied into the played entry's
 * field at duel + played*8 + 0x586. Returns 1 when committed, 0 when none.
 */
export function commitFirstMarked(mem: AiMemory, duel: number, side: number): number {
    const marks = duel + (side === 1 ? 0x44c : 0x446);
    const count = u8(mem.read8(duel + side * AI_SIDE_STRIDE + 0x72c));
    for (let i = 0; i < count; i++) {
        if (s8(mem.read8(marks + i)) === 0) continue;
        const field = u8(mem.read8(duel + side * AI_SIDE_STRIDE + i * AI_SLOT_STRIDE + 0x73a));
        mem.write8(duel + s8(mem.read8(duel + 0x575)) * 8 + 0x586, field);
        return 1;
    }
    return 0;
}

// ── F0x800A3F48 narrowToGreen / F0x800A4078 narrowToRed ─────────────────────

function narrowToColour(mem: AiMemory, host: AiHost, duel: number, side: number, colour: number): number {
    const marks = duel + (side === 1 ? 0x44c : 0x446);
    const count = u8(mem.read8(duel + side * AI_SIDE_STRIDE + 0x72c));
    for (let i = 0; i < count; i++) {
        if (s8(mem.read8(marks + i)) === 0) continue;
        const id = mem.read16s(duel + side * AI_SIDE_STRIDE + i * AI_SLOT_STRIDE + 0x72e);
        const cardId = mem.read16(duel + 0x50 + id * 2);
        const record = host.resolveCardRecord((cardId + 1) | 0);
        if (u8(mem.read8(record)) !== colour) mem.write8(marks + i, 0);
    }
    // F0x800A3F48/F0x800A4078 fall through to commitFirstMarked and return ITS
    // value: the simulator's colour arms (F0x800A487C/F0x800A48B8) read it.
    return commitFirstMarked(mem, duel, side);
}

/** F0x800A3F48(duel, side): keep only green (colour 3) targets, then commit. */
export function narrowToGreen(mem: AiMemory, host: AiHost, duel: number, side: number): number {
    return narrowToColour(mem, host, duel, side, 3);
}

/** F0x800A4078(duel, side): keep only red (colour 4) targets, then commit. */
export function narrowToRed(mem: AiMemory, host: AiHost, duel: number, side: number): number {
    return narrowToColour(mem, host, duel, side, 4);
}

// ── F0x800A3934 evaluateBoard ───────────────────────────────────────────────

interface SlotValue { slot: number; value: number }

function buildSortedRow(mem: AiMemory, duel: number, side: number, count: number): SlotValue[] {
    const rowOff = side * AI_SIDE_STRIDE;
    const table: SlotValue[] = [];
    for (let i = 0; i < count; i++) {
        const id = mem.read16s(duel + rowOff + 0x72e + i * AI_SLOT_STRIDE);
        table.push({ slot: i, value: s16(mem.read16(duel + 0x50 + id * 2)) });
    }
    for (let i = 0; i <= count - 2; i++) {
        for (let j = i + 1; j < count; j++) {
            if (table[j]!.value < table[i]!.value) {
                const t = table[i]!; table[i] = table[j]!; table[j] = t;
            }
        }
    }
    return table;
}

/**
 * F0x800A3934(duel, side, mask): score a board. The side's field row is read,
 * each slot's cached card value placed in a table, the table sorted descending
 * by value, and the marked slots scored: consecutive marked slots whose card
 * continues a combo (record +0x0A set) group together and add 0x14 per group
 * past the second; the unmarked slots' summed AP+HP are added in full. This is
 * the number chooseBestTarget maximises.
 */
export function evaluateBoard(mem: AiMemory, host: AiHost, duel: number, side: number, mask: number): number {
    const rowOff = side * AI_SIDE_STRIDE;
    const count = u8(mem.read8(duel + rowOff + 0x72c));
    const table = buildSortedRow(mem, duel, side, count);
    const a1 = side * AI_SIDE_STRIDE;
    const slotAt = (slot: number) => duel + a1 + slot * AI_SLOT_STRIDE;

    let comboRun = 0;
    let s3 = 0;
    let s2 = 0;
    if (count > 0) {
        s3 = mem.read16s(slotAt(table[0]!.slot) + 0x734);
        s2 = mem.read16s(slotAt(table[0]!.slot) + 0x736);
    }
    let a3 = 0;
    let s8acc = 0;
    let s6 = 0;

    const tail = () => {
        if (comboRun >= 2) {
            a3 += s3;
            s8acc += s2;
            if (comboRun >= 3) { a3 += 0x14; s8acc += 0x14; }
        }
        let ap = 0;
        let hp = 0;
        for (let i = 0; i < count; i++) {
            if (((mask >> (i & 31)) & 1) !== 0) continue;
            ap += mem.read16s(slotAt(i) + 0x734);
            hp += mem.read16s(slotAt(i) + 0x736);
        }
        return (ap + hp + a3 + s8acc) | 0;
    };

    let idx = count > 0 ? ((sra(mask, table[0]!.slot)) & 1) : 0;
    if (idx < count - 1) {
        s6 = comboRun;
        for (;;) {
            const value = s16(table[idx]!.value);
            const nextSet = idx + 1 < count ? ((sra(mask, table[idx + 1]!.slot)) & 1) : 0;
            if (nextSet !== 0) {
                if (idx === count - 2) return tail();
                s6 = 1;
            }
            const comboInto = s16(mem.read16s(host.resolveCardRecord((value + 1) | 0) + 0xa));
            if (comboInto !== 0) {
                const nv = table[idx + 1 + s6];
                if (nv !== undefined && value === nv.value) {
                    comboRun += 1;
                    const at = slotAt(table[idx + s6]!.slot);
                    s3 += mem.read16s(at + 0x734);
                    s2 += mem.read16s(at + 0x736);
                    if (s6 !== 0) idx += 1;
                    idx += 1;
                    if (idx < count - 1) { s6 = 0; continue; }
                    return tail();
                }
            }
            if (comboRun < 2) {
                const ni = idx + s6 + 1;
                if (ni < count) {
                    comboRun = 0;
                    const at = slotAt(table[ni]!.slot);
                    s3 = mem.read16s(at + 0x734);
                    s2 = mem.read16s(at + 0x736);
                } else { s3 = 0; s2 = 0; }
                if (!(comboRun < 3)) { a3 += 0x14; s8acc += 0x14; return tail(); }
            } else {
                a3 = s3;
                const ni = idx + s6 + 1;
                if (ni < count) {
                    s8acc += s2;
                    const at = slotAt(table[ni]!.slot);
                    s3 = mem.read16s(at + 0x734);
                    s2 = mem.read16s(at + 0x736);
                } else { s3 = 0; s2 = 0; }
                if (comboRun >= 3) { a3 += 0x14; s8acc += 0x14; return tail(); }
            }
            if (s6 !== 0) idx += 1;
            idx += 1;
            if (idx < count - 1) { s6 = 0; continue; }
            return tail();
        }
    }
    return tail();
}

// ── F0x800A3D90 chooseBestTarget ────────────────────────────────────────────

/**
 * F0x800A3D90(duel, side): score every marked slot on `side` with the mask set
 * to just that slot, keep the LOWEST score, and leave only that slot marked.
 * The original's comparison is `!(bestScore < score)` — it ACCEPTS when
 * score <= bestScore (`slt $v0,$s4,$v1; bnez $v0, reject` at
 * cardgame.norm.s F0x800a3d90: accept when the new score is <= the incumbent,
 * starting from 0xFFF), so a tie keeps the LATER slot. This is
 * `aiPickBestFieldTarget`; its sibling `aiPickBestOppFieldSlot` (F0x80084188)
 * is the one that keeps the HIGHEST, over the far row — do not copy this
 * direction there. (claim cardgame-ai-field-target-narrowing-2026-10-10)
 */
export function chooseBestTarget(mem: AiMemory, host: AiHost, duel: number, side: number): void {
    const marks = duel + (side === 1 ? 0x44c : 0x446);
    const count = u8(mem.read8(duel + side * AI_SIDE_STRIDE + 0x72c));
    let bestScore = 0xfff;
    let bestSlot = 0;
    for (let i = 0; i < count; i++) {
        if (s8(mem.read8(marks + i)) === 0) continue;
        const score = evaluateBoard(mem, host, duel, side, (1 << i) | 0);
        if (score <= bestScore) {
            mem.write8(marks + bestSlot, 0);
            bestScore = score;
            bestSlot = i;
            mem.write8(marks + i, 1);
        } else {
            mem.write8(marks + i, 0);
        }
    }
}

// ── F0x800A36E4 cardHasLegalTarget ──────────────────────────────────────────

/**
 * F0x800A36E4(duel, side, cardClass): the legality gate the AI hand pick and the
 * human cursor share. A 0x27-arm switch on `cardClass - 0x70`; most arms are a
 * collection probe (F0x8008EC44/F0x8008EEC8) asking whether either hand, deck or
 * trash holds a card matching a filter, a few compare the last played card's own
 * record, and three are unconditionally legal.
 */
export function cardHasLegalTarget(mem: AiMemory, host: AiHost, duel: number, side: number, cardClass: number): boolean {
    const idx = (cardClass - 0x70) >>> 0;
    if (idx >= 0x27) return false;
    const probe = (selector: number, extra: number, arg = 0xff): boolean =>
        host.fieldProbe(duel, side, selector, extra, arg) !== 0;
    const probeKind = (extra: number): boolean => host.fieldProbeKind(duel, side, 1, extra) !== 0;
    switch (idx) {
        case 0: case 3: case 4: case 5: case 6: case 7: case 8: case 9:
        case 10: case 11: case 12: case 13: case 14:
            return true;                                   // F0x800a3914
        case 1: return probe(1, 2);                        // F0x800a37f8
        case 2: return probe(0, 3);                        // F0x800a37b8
        case 15: return probe(0, 2);                       // F0x800a3818
        case 16: case 17: return probe(1, 4);              // F0x800a372c
        case 18: return probe(1, 3);                       // F0x800a37d8
        case 19:                                           // F0x800a374c
            return s8(mem.read8(duel + 0x575)) !== 0;
        case 20: {                                         // F0x800a3758
            const played = s8(mem.read8(duel + 0x575));
            if (played === 0) return false;
            const id = mem.read16s(duel + (played - 1) * 8 + 0x580);
            const cardId = mem.read16(duel + 0x50 + id * 2);
            return u8(mem.read8(host.resolveCardRecord((cardId + 1) | 0))) === 6;
        }
        case 21: case 30: return probeKind(0x1fc);          // F0x800a3858
        case 22: case 29: return false;                     // F0x800a3918
        case 23: return probeKind(0x180);                   // F0x800a3868
        case 24: case 31: return probeKind(0x2fc);          // F0x800a3878
        case 25: return probeKind(0x2bc);                   // F0x800a3888
        case 26: return probeKind(0x280);                   // F0x800a3898
        case 27: case 32: return probeKind(0x3fc);          // F0x800a38a8
        case 28: case 37: return probeKind(0x380);          // F0x800a38b8
        case 33: return probeKind(0x3f8);                   // F0x800a38c8
        case 34: return probeKind(0x3f4);                   // F0x800a38d8
        case 35: return probeKind(0x310);                   // F0x800a38e8
        case 36: return probeKind(0x3dc);                   // F0x800a38f8
        case 38: return probe(1, 2, 0xfd);                  // F0x800a3838
        default: return false;
    }
}

// ── F0x800A0CD4 scanComboRuns ───────────────────────────────────────────────

/**
 * F0x800A0CD4(duel, side, start): scan a side's field row for a run of three or
 * more cards of one value whose record +0x0A (comboInto) is set. The row is
 * copied into a {slot, value} table and sorted descending by value; from `start`
 * each equal adjacent pair whose card continues a combo extends a run. When a
 * run of three or more is found, its slots are stamped into the side's marker
 * array (duel+0x446) and the run's combo value is written to duel+0x438.
 * Returns the run's last table index + 1, or -1 when none is found.
 */
export function scanComboRuns(mem: AiMemory, host: AiHost, duel: number, side: number, start: number): number {
    const stride = side * AI_SIDE_STRIDE;
    const count = u8(mem.read8(duel + stride + 0x72c));
    const table = buildSortedRow(mem, duel, side, count);
    const run = { count: 0, value: 0x51 };
    let i = start;
    let result = -1;
    let finalized = false;

    const finalize = (index: number) => {
        for (let k = 0; k < count; k++) mem.write8(duel + 0x446 + k, 0);
        for (let k = run.count; k >= 0; k--) {
            const slot = table[index - k]!.slot;
            mem.write8(duel + 0x446 + slot, 1);
        }
        mem.write32(duel + 0x438, run.value);
        result = index + 1;
        finalized = true;
    };

    for (; i < count - 1; i++) {
        const cardId = mem.read16(duel + 0x50 + table[i]!.value * 2);
        const comboInto = s16(mem.read16s(host.resolveCardRecord((cardId + 1) | 0) + 0xa));
        if (comboInto !== 0 && table[i + 1]!.value === table[i]!.value) {
            run.value = comboInto;
            run.count += 1;
            continue;
        }
        if (run.count >= 2) { finalize(i); break; }
        run.count = 0;
    }
    if (!finalized && run.count >= 2) finalize(i);
    return result;
}

// ── F0x800A44F0 aiWorthPlaying / F0x800A45F8 aiSimulateCounter ──────────────
//
// The AI's own "worth it" test (F0x800A44F0) decides whether playing a card is
// worth it and, as a side effect, LOCKS IN its target by writing the played
// entry's committed field (duel + played*8 + 0x586). It dispatches on
// `value - 3` through table D0x80083D2C (0x39 arms): most arms are the default
// "yes, play it" (F0x800A45DC, return 1). The response-path simulator
// F0x800A45F8 then scores an answering play: it looks up the played class's
// Program damage and buff, and picks a board target, dispatching on the LAST
// PLAYED entry's class byte (duel + (played-1)*8 + 0x585) through table
// D0x80083E14 (8 arms).
//
// Both tables were read from the overlay assembly (cardgame.norm.s), not the
// m2c C, which merged several arms. The arms are shared tails (a jump into the
// middle of another arm's body), which is why m2c lost them.

/**
 * F0x800A44F0(duel, value): is playing the card whose duel+0x50 entry is
 * `value` worth it? Dispatches on `value - 3` (table D0x80083D2C). Returns 1
 * (worth playing) by default; a handful of cards can be declined. Several arms
 * write the chosen target into the played entry as a side effect.
 */
export function aiWorthPlaying(mem: AiMemory, host: AiHost, duel: number, value: number): number {
    const idx = (value - 3) >>> 0;
    if (idx >= 0x39) return 1;                                    // F0x800A45DC default
    // F0x800A454C / F0x800A4578 / F0x800A4594 all fall through to the same tail:
    // chooseBestTarget(side 0), then commit, and return the commit result.
    const bestAndCommit = () => {
        chooseBestTarget(mem, host, duel, 0);
        return commitFirstMarked(mem, duel, 0);
    };
    switch (idx) {
        case 36: return cheapestHandCard(mem, host, duel);         // class 0x27 -> F0x800A4534
        case 4: case 6: case 23: case 52: case 54:                 // F0x800A454C (classes 7,9,26,55,57)
            return bestAndCommit();
        case 18: case 43:                                          // F0x800A4578 (classes 21,46): lethal at 30
            narrowToLethal(mem, duel, 0, 0x1e, 0);
            return bestAndCommit();
        case 53:                                                   // F0x800A4594 (class 56): lethal at 10
            narrowToLethal(mem, duel, 0, 0x0a, 0);
            return bestAndCommit();
        case 37: return commitFirstMarked(mem, duel, 1);           // class 0x28 -> F0x800A45A4
        case 0: case 12: case 55: case 56:                         // F0x800A45B0 (classes 3,15,58,59)
            if (u8(mem.read8(duel + 0x79e)) !== 0) {
                mem.write8(duel + s8(mem.read8(duel + 0x575)) * 8 + 0x586, u8(mem.read8(duel + 0x7ac)));
                return 1;
            }
            return 0;
        default: return 1;
    }
}

/**
 * The last-played entry's class byte — the F0x800A45F8 dispatch key.
 */
function lastPlayedClass(mem: AiMemory, duel: number): number {
    const played = s8(mem.read8(duel + 0x575));
    return u8(mem.read8(duel + (played - 1) * 8 + 0x585));
}

/**
 * F0x800A45F8(duel, cardA, cardB, swapped): score a counter-play. `swapped`
 * decides which argument is the damage class and which the buff class
 * (exactly as the assembly's two `F0x800A4440`/`F0x800A4494` call orders do).
 * The switch key is the last-played entry's class byte, table D0x80083E14.
 * Returns 1 when a target was committed, 0 otherwise.
 */
export function aiSimulateCounter(mem: AiMemory, host: AiHost, duel: number, cardA: number, cardB: number, swapped: number): number {
    let damage: number;
    let buff: number;
    if (swapped === 0) { damage = programDamage(duel, cardB); buff = programBuff(duel, cardA); }
    else { damage = programDamage(duel, cardA); buff = programBuff(duel, cardB); }
    const cls = lastPlayedClass(mem, duel);
    if (cls >= 8) return 0;
    switch (cls) {
        case 0: return simArm46c0(mem, duel, damage, buff, swapped);
        case 1:                                                    // F0x800A47E0
            if (swapped !== 0) return 0;
            narrowToLethal(mem, duel, 0, damage, 0);
            chooseBestTarget(mem, host, duel, 0);
            return commitFirstMarked(mem, duel, 0);
        case 3:                                                    // F0x800A481C
            if (swapped === 0) {
                narrowToLethal(mem, duel, 0, damage, 0);
                chooseBestTarget(mem, host, duel, 0);
                return commitFirstMarked(mem, duel, 0);
            }
            if (narrowToLethal(mem, duel, 1, damage, 0) === 0) return 0;
            return commitFirstMarked(mem, duel, 1);
        case 6:                                                    // F0x800A487C
            if (swapped !== 0) return 0;
            narrowToLethal(mem, duel, 0, damage, 0);
            chooseBestTarget(mem, host, duel, 0);
            return narrowToGreen(mem, host, duel, 0) !== 0 ? 1 : 0;
        case 7:                                                    // F0x800A48B8
            if (swapped === 0) return 0;
            chooseBestTarget(mem, host, duel, 1);
            if (narrowToLethal(mem, duel, 1, damage, 0) === 0) return 0;
            return narrowToRed(mem, host, duel, 1) !== 0 ? 1 : 0;
        default: return 0;                                         // arms 2,4,5 -> F0x800A48F8 (s3 = 0)
    }
}

/**
 * F0x800A46C0 (the class-0 arm of F0x800A45F8): find the board slot holding the
 * card just played — side 0 slots 0..5 first (duel + i*0xE + 0x73A), then side
 * 1's (duel + i*0xE + 0x7AC) — and, when the damage finishes it, commit that
 * slot's class into the played entry. With `swapped` set the target is side 1
 * and the kill must survive subtracting the buff.
 */
function simArm46c0(mem: AiMemory, duel: number, damage: number, buff: number, swapped: number): number {
    const lastField = u8(mem.read8(duel + (s8(mem.read8(duel + 0x575)) - 1) * 8 + 0x586));
    let slot = 0;                                   // the matched board slot (never found -> 0)
    let found = false;
    for (let i = 0; i < 6 && !found; i++) {
        if (lastField === u8(mem.read8(duel + i * AI_SLOT_STRIDE + 0x73a))) { slot = i; found = true; }
    }
    if (!found) {
        for (let i = 0; i < 6; i++) {
            if (lastField === u8(mem.read8(duel + i * AI_SLOT_STRIDE + 0x7ac))) { slot = i; found = true; break; }
        }
    }
    if (swapped === 0) {
        if (wouldFinish(mem, duel, 0, slot, damage) === 0) return 0;
        mem.write8(duel + s8(mem.read8(duel + 0x575)) * 8 + 0x586, u8(mem.read8(duel + slot * AI_SLOT_STRIDE + 0x73a)));
        return 1;
    }
    if (wouldFinish(mem, duel, 1, slot, damage) === 0) return 0;
    if (wouldFinish(mem, duel, 1, slot, damage - buff) !== 0) return 0;
    mem.write8(duel + s8(mem.read8(duel + 0x575)) * 8 + 0x586, u8(mem.read8(duel + slot * AI_SLOT_STRIDE + 0x7ac)));
    return 1;
}

// ── F0x800A4978 aiChooseCardToPlay ──────────────────────────────────────────

/**
 * F0x800A4978(duel, arg1): the opponent's card choice — the per-entry hand walk
 * that actually PICKS the card it plays. On the opponent's turn:
 *
 *  1. Clear the hand-entry mark array (duel+i+0x46F).
 *  2. If nothing has been played this turn (duel+0x575 == 0): on the Load phase
 *     (duel+0x2F8 == 5) look for a hand entry of AI class 1; otherwise look for
 *     class 3, but only while side 0's board score is not below side 1's (a tie
 *     plays, being ahead skips) and the +0x305 bit is clear.
 *  3. If a card was played and the response list at duel+0x400 holds it, look
 *     for a class-4 answer.
 *  4. If the just-played card's record kind (+3) is 3 or 9, look for a class-3
 *     or class-4 counter whose record kind is the complement.
 *
 * Every candidate passes the same three gates: `isSummonableCard`
 * (F0x80085F38), the legality gate `cardHasLegalTarget` (F0x800A36E4) and the
 * worth-it test (`aiWorthPlaying` F0x800A44F0, or the response simulator
 * `aiSimulateCounter` F0x800A45F8 for the counter path). The first one to pass
 * is marked at duel+index+0x46F and 1 is returned; 0 when none does.
 */
export function aiChooseCardToPlay(mem: AiMemory, host: AiHost, duel: number, arg1: number): number {
    let result = 0;
    const handCount = mem.read16s(duel + 0x66e);
    if (handCount > 0) {
        for (let i = 0; i < handCount; i++) mem.write8(duel + i + 0x46f, 0);
    }
    const played = s8(mem.read8(duel + 0x575));
    const markAndReturn = (index: number) => {
        mem.write8(duel + index + 0x46f, 1);
        return 1;
    };

    if (played === 0) {
        let start: number;
        let cls: number;
        if (u8(mem.read8(duel + 0x2f8)) === 5) {
            start = findHandEntryByClass(mem, duel, 1);
            cls = 1;
        } else {
            start = findHandEntryByClass(mem, duel, 3);
            const playerScore = evaluateBoard(mem, host, duel, 0, 0);
            const aiScore = evaluateBoard(mem, host, duel, 1, 0);
            cls = 3;
            if ((u8(mem.read8(duel + 0x305)) & 1) !== 0 || playerScore < aiScore) return 0;
        }
        for (let i = start; i < handCount; i++) {
            const entry = mem.read16s(duel + 0x6c8 + i * 2);
            if (u8(mem.read8(duel + ((entry - 0x28) << 2) + 0x35c)) !== cls) continue;
            if (!host.isSummonableCard(duel, entry)) continue;
            const cardId = mem.read16(duel + 0x50 + entry * 2);
            const cardCls = host.cardField(cardId, 0);
            if (!cardHasLegalTarget(mem, host, duel, arg1, cardCls)) continue;
            if (aiWorthPlaying(mem, host, duel, cardId) === 0) continue;
            return markAndReturn(i);
        }
        return result;
    }

    // The response list at duel+0x400 holds the card just played?
    let inResponseList = 0;
    if (u8(mem.read8(duel + 0x400)) !== 0xff) {
        const lastId = mem.read16s(duel + (played - 1) * 8 + 0x580);
        const target = mem.read16(duel + 0x50 + lastId * 2);
        let at = duel;
        for (;;) {
            if (u8(mem.read8(at + 0x400)) === target) { inResponseList = 1; break; }
            at += 1;
            if (u8(mem.read8(at + 0x400)) === 0xff) break;
        }
    }
    if (inResponseList !== 0) {
        for (let i = findHandEntryByClass(mem, duel, 4); i < handCount; i++) {
            const entry = mem.read16s(duel + 0x6c8 + i * 2);
            if (!host.isSummonableCard(duel, entry)) continue;
            const cardId = mem.read16(duel + 0x50 + entry * 2);
            const cardCls = host.cardField(cardId, 0);
            if (!cardHasLegalTarget(mem, host, duel, arg1, cardCls)) continue;
            if (aiWorthPlaying(mem, host, duel, cardId) === 0) continue;
            result = markAndReturn(i);
            break;
        }
    }
    if (result !== 0) return result;

    // The just-played card's record kind is 3 or 9: look for a class-3/4 counter.
    const lastId = mem.read16s(duel + (played - 1) * 8 + 0x580);
    const playedCardId = mem.read16(duel + 0x50 + lastId * 2);
    const oldKind = u8(mem.read8(host.resolveCardRecord((playedCardId + 1) | 0) + 0x3));
    if (oldKind !== 3 && oldKind !== 9) return result;
    for (let i = findHandEntryByClass(mem, duel, 3); i < handCount; i++) {
        const entry = mem.read16s(duel + 0x6c8 + i * 2);
        const at = duel + ((entry - 0x28) << 2);
        const entryCls = u8(mem.read8(at + 0x35c));
        if (entryCls !== 3 && entryCls !== 4) continue;
        if (u8(mem.read8(at + 0x35d)) === 0) continue;
        const cardId = mem.read16(duel + 0x50 + entry * 2);
        const newKind = u8(mem.read8(host.resolveCardRecord((cardId + 1) | 0) + 0x3));
        // s3 (the simulator's `swapped`): 1 only when the played card is kind 9
        // and this card is kind 3; 0 when the played card is kind 3 and this is
        // kind 9; otherwise this entry is skipped.
        let swapped: number;
        if (oldKind !== 3) { if (newKind !== 3) continue; swapped = 1; }
        else { if (newKind !== 9) continue; swapped = 0; }
        if (!host.isSummonableCard(duel, entry)) continue;
        const cardCls = host.cardField(cardId, 0);
        if (!cardHasLegalTarget(mem, host, duel, arg1, cardCls)) continue;
        if (aiSimulateCounter(mem, host, duel, lastId, entry, swapped) === 0) continue;
        return markAndReturn(i);
    }
    return result;
}
