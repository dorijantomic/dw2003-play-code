// The card duel's effect-VM opcode helper bodies.
//
// The effect interpreter (F0x80084320, effect-vm.ts) reaches 96 helper routines,
// one pair per animated opcode. This module carries the ones that have been
// ported; engine/dw3/ui/duel-effect-host.ts keeps the rest as named gaps, so the
// whole-match verifier names the first helper that is still unported.
//
// Authority 2 (original assembly): exe-decomp/cardgame.norm.s, read arm by arm
// (never the m2c C, which merges the physically interleaved arms and folds
// lui/ori immediates into wrong constants).
//
// WHAT A PLAYER SEES. Opcode 0xA7 is the duels' coin toss: two face cards flash
// onto the board, the machine flips a bit to decide which face is shown first,
// and the result is stored on the duel so the following steps can branch on it.

/** The memory the effect-op helpers read and write. */
export interface DuelEffectOpMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/**
 * The sub-services a helper body needs. Each is an already-ported body or a
 * session option, never an interpreter edge:
 * - `randomBit`: `[0x8004DC0C](duel) & 1`, the resident random word's low bit.
 * - `positionSlot`: `view+0xF14` = F0x8009C510 placeCardResetVisual (duel-board-view.ts).
 * - `writeSlotValue`: `view+0xF3C` = F0x8009CFBC bindSlotToCard (duel-board-view.ts).
 */
export interface DuelEffectOpHost {
    randomBit(): number;
    positionSlot(view: number, index: number, x: number, y: number): void;
    writeSlotValue(view: number, index: number, value: number): void;
}

/** duel+0x434: the decided coin bit (0 or 1). */
export const DUEL_COIN_RESULT = 0x434;
/** view+0x14D and view+0x199: the two card-slot visible state bytes. */
export const VIEW_SLOT_STATE_A = 0x14d;
export const VIEW_SLOT_STATE_B = 0x199;

/** The two face card ids the coin toss alternates onto the two slots. */
export const COIN_FACE_A = 0x57;
export const COIN_FACE_B = 0x58;

/**
 * F0x8008985C(duel, view): start the coin toss (@.L0x00006bac).
 *
 * Flip the resident random word's low bit, store it at duel+0x434, clear the
 * four scratch words (0x424..0x430), place both face slots at rest
 * (view+0xF14 slot 0 at 0x7400,0x6100 and slot 1 at 0xA400,0x6100), then bind
 * face 0x57 to one slot and face 0x58 to the other — the flipped bit chooses
 * which slot shows face 0x57. Finally reset the two slots' visible state and
 * the duel's side/selection words and arm the tick state duel+0x422 = 1.
 */
export function effectOpA7StartCoinToss(
    mem: DuelEffectOpMemory, host: DuelEffectOpHost, duel: number, view: number,
): void {
    // jalr [0x8004DC0C](duel); andi bit = ret & 1
    const bit = host.randomBit() & 1;
    mem.write32(duel + DUEL_COIN_RESULT, bit);
    // sw $zero 0x430/0x42c/0x428/0x424
    mem.write32(duel + 0x430, 0);
    mem.write32(duel + 0x42c, 0);
    mem.write32(duel + 0x428, 0);
    mem.write32(duel + 0x424, 0);
    // view+0xF14(view, 0, 0x7400, 0x6100) then (view, 1, 0xA400, 0x6100)
    host.positionSlot(view, 0, 0x7400, 0x6100);
    host.positionSlot(view, 1, 0xa400, 0x6100);
    // face 0x57 goes on slot (bit ? 0 : 1); face 0x58 on the other.
    host.writeSlotValue(view, bit !== 0 ? 0 : 1, COIN_FACE_A);
    host.writeSlotValue(view, bit !== 0 ? 1 : 0, COIN_FACE_B);
    // the routine's own view stores
    mem.write8(view + VIEW_SLOT_STATE_A, 2);
    mem.write8(view + VIEW_SLOT_STATE_B, 2);
    mem.write16(view + 0x120, 0);
    mem.write8(view + 0x151, 0);
    mem.write8(view + 0x150, 0);
    mem.write16(view + 0x16c, 0);
    mem.write8(view + 0x19d, 0);
    mem.write8(view + 0x19c, 0);
    // and the duel stores
    mem.write32(duel + 0x43c, 0);
    mem.write32(duel + 0x440, 0);
    mem.write8(duel + 0x422, 1);
}

// ── F1 tick: the coin toss's six-state machine (F0x80089974) ──────────────────
//
// The enter arm above arms duel+0x422 = 1; every frame the tick reads that byte,
// indexes the jump table D0x80083364 (six arms, states 1..6) and runs one arm.
// Only state 6 (the compare) returns 1 — "the coin toss has settled", which the
// effect VM uses to advance its program counter. Read arm by arm from
// exe-decomp/cardgame.norm.s lines 7745-8099 (never the m2c C, which merges the
// interleaved arms).

/** duel+0x422: the coin toss's tick state (1..6; 0/7+ return 0). */
export const DUEL_COIN_TOSS_STATE = 0x422;
/** duel+0x424: the arm's frame timer. */
export const DUEL_COIN_TOSS_TIMER = 0x424;
/** duel+0x428: the state-3 checker's frame accumulator. */
export const DUEL_COIN_TOSS_ACC = 0x428;
/** duel+0x43c: the highlighted slot (0 or 1) — the slide helper flips it. */
export const DUEL_COIN_TOSS_SLOT = 0x43c;
/** duel+0x440: the picked slot the state-6 compare reads. */
export const DUEL_COIN_TOSS_PICK = 0x440;

/**
 * The six-arm jump table D0x80083364, read word by word from pro_cardgame.bin
 * (`0x800899e0 0x80089a8c 0x80089c54 0x80089c94 0x80089dfc 0x80089e70` for
 * states 1..6). Exported so the oracle can re-read the shipped table and prove
 * these constants are the table, not a transcription.
 */
export const COIN_TOSS_JUMP_ARMS: readonly number[] = [
    0x800899e0, 0x80089a8c, 0x80089c54, 0x80089c94, 0x80089dfc, 0x80089e70,
];
/** The jump table's address. */
export const COIN_TOSS_JUMP_TABLE = 0x80083364;

/**
 * The slide table D0x800A58D4 (F0x800896F0 indexes it by duel+0x43c): two
 * 8-byte records, x at +0, y at +4. Read from pro_cardgame.bin: slot 0 at
 * (0x7400, 0x6100), slot 1 at (0xA400, 0x6100) — the same rest positions the
 * enter arm places the two faces at.
 */
export const COIN_TOSS_SLIDE_TABLE: readonly (readonly [number, number])[] = [
    [0x7400, 0x6100],
    [0xa400, 0x6100],
];
/** The slide table's adress. */
export const COIN_TOSS_SLIDE_TABLE_ADDR = 0x800a58d4;

/** view+0x150 bit 0 is the slot's "highlighted" flag the slide helper toggles. */
export const VIEW_SLOT_HIGHLIGHT = 0x150;

/**
 * The edges the coin toss's tick drives. Each is an already-ported body or a
 * session option — never an interpreter edge:
 * - `playPackedSound`: `[0x80055C48]`, the packed-sound dispatcher.
 * - `frameDelta`: `[0x8004DF9C]()` = resident F0x8001D704, one per frame.
 * - `padPressed` / `padRepeat` / `padKeyBit`: the shared controller block's
 *   pressed word, repeat word and logical-button map (pad-block.ts).
 * - `scaleSlot` = view+0xF24, `cardStartMoveSilent` = view+0xF0C,
 *   `cardStartFlip` = view+0xF28 (duel-board-view.ts).
 * - `openInfoBanner` = view+0xEAC, `writeBannerRecord` = view+0xEB0
 *   (view-openers.ts / duel-info-banner.ts).
 */
export interface CoinTossHost {
    playPackedSound(id: number): void;
    frameDelta(): number;
    padPressed(port: number): number;
    padRepeat(port: number): number;
    padKeyBit(port: number, code: number): number;
    scaleSlot(view: number, index: number, span: number, from: number, to: number): void;
    cardStartMoveSilent(view: number, index: number, span: number, destX: number, destY: number): void;
    cardStartFlip(view: number, index: number): void;
    openInfoBanner(view: number, index: number, arg2: number, arg3: number, arg4: number, arg5: number): void;
    writeBannerRecord(view: number, index: number): void;
}

/** `pressed | repeat` of logical button `code` on port 0 (states 2's slide keys). */
function padChord(mem: DuelEffectOpMemory, host: CoinTossHost, code: number): boolean {
    const word = ((host.padPressed(0) | host.padRepeat(0)) & 0xffff) >>> 0;
    const bit = host.padKeyBit(0, code) & 0xff;
    return (word & ((1 << bit) >>> 0)) !== 0;
}

/** The pressed word's bit for logical button `code` on port 0. */
function padPressedBit(mem: DuelEffectOpMemory, host: CoinTossHost, code: number): boolean {
    const word = host.padPressed(0) & 0xffff;
    const bit = host.padKeyBit(0, code) & 0xff;
    return (word & ((1 << bit) >>> 0)) !== 0;
}

/**
 * F0x800896F0(duel, view): the coin-toss slide step (@.L0x00006a40). Play
 * sfx 0x4001B, slide the highlighted slot (duel+0x43c) to its rest position from
 * D0x800A58D4 over 5 frames, clear its highlight bit (`view+slot*0x4C+0x150`
 * &= 0xFE) and its tick flag, flip duel+0x43c, then slide the newly highlighted
 * slot in from (x, y-0x500) over 1 frame and set its highlight bit and tick flag.
 * This is the cursor hopping between the two coin faces.
 */
export function coinTossSlide(
    mem: DuelEffectOpMemory, host: CoinTossHost, duel: number, view: number,
): void {
    host.playPackedSound(0x4001b | 0);
    let idx = mem.read32(duel + DUEL_COIN_TOSS_SLOT) | 0;
    let rec = COIN_TOSS_SLIDE_TABLE[idx] as readonly [number, number];
    host.cardStartMoveSilent(view, idx, 5, rec[0], rec[1]);
    let r = view + idx * 0x4c;
    mem.write8(r + VIEW_SLOT_HIGHLIGHT, (mem.read8(r + VIEW_SLOT_HIGHLIGHT) & 0xfe) & 0xff);
    mem.write16(r + 0x12e, 0);
    idx = (idx ^ 1) | 0;
    mem.write32(duel + DUEL_COIN_TOSS_SLOT, idx);
    rec = COIN_TOSS_SLIDE_TABLE[idx] as readonly [number, number];
    host.cardStartMoveSilent(view, idx, 1, rec[0], (rec[1] - 0x500) & 0xffff);
    r = view + idx * 0x4c;
    mem.write8(r + VIEW_SLOT_HIGHLIGHT, (mem.read8(r + VIEW_SLOT_HIGHLIGHT) | 1) & 0xff);
    mem.write16(r + 0x12e, 1);
}

/**
 * F0x80087DC8(duel, view): state 3's readiness checker (@.L0x00005118). It runs
 * a four-step timer on duel+0x424 and accumulates `[0x8004DF9C]()` into
 * duel+0x428, scaling the highlighted slot (view+0xF24) at steps 0 and 2. It
 * returns 1 only when it has reached step 3 AND the accumulator has reached 5.
 */
export function coinTossPickCheck(
    mem: DuelEffectOpMemory, host: CoinTossHost, duel: number, view: number,
): number {
    const t = mem.read32(duel + DUEL_COIN_TOSS_TIMER) | 0;
    if (t === 1) {
        const acc = (mem.read32(duel + DUEL_COIN_TOSS_ACC) + host.frameDelta()) | 0;
        mem.write32(duel + DUEL_COIN_TOSS_ACC, acc);
        if (acc >= 5) {
            mem.write32(duel + DUEL_COIN_TOSS_TIMER, (mem.read32(duel + DUEL_COIN_TOSS_TIMER) + 1) | 0);
        }
        return 0;
    }
    if (t === 3) {
        const acc = (mem.read32(duel + DUEL_COIN_TOSS_ACC) + host.frameDelta()) | 0;
        mem.write32(duel + DUEL_COIN_TOSS_ACC, acc);
        return acc >= 5 ? 1 : 0;
    }
    // steps 0 and >=4 scale from 0x1400; step 2 scales from 0x1000.
    const from = t === 2 ? 0x1000 : 0x1400;
    host.scaleSlot(view, mem.read32(duel + DUEL_COIN_TOSS_SLOT) | 0, 5, from, from);
    mem.write32(duel + DUEL_COIN_TOSS_ACC, 0);
    mem.write32(duel + DUEL_COIN_TOSS_TIMER, (mem.read32(duel + DUEL_COIN_TOSS_TIMER) + 1) | 0);
    return 0;
}

/**
 * F0x80089974(duel, view): one tick of the coin toss's six-state machine.
 * Returns 1 only when state 6 runs (the compare — the toss has settled), 0 for
 * every other state and for a state outside 1..6. The state arms, in order:
 *
 * 1. timer 0/4 scales a slot, then at 15 frames arm state 2 and start slot 0's
 *    silent move toward (0x7400, 0x5C00), setting its tick flag and highlight.
 * 2. the player picks with the confirm button (choosing the slot at duel+0x43C,
 *    stored in duel+0x440 and marked at duel+slot+0x46F, plus sfx 0x4001C), or
 *    presses slide key 7/5 to hop the highlight via the slide helper.
 * 3. the readiness checker runs; when ready, arm state 4 and flip the slot.
 * 4. at timer 20, flip the OTHER slot, raise the coin banner (record 0x44 when
 *    the coin bit matches the pick, else 0x43), play sfx 0x40019, and after 91
 *    frames arm state 5 and retire banner record 5.
 * 5. timer 0/4 scales a slot, then at 15 frames arm state 6.
 * 6. store 1 at duel+0x440 when the coin bit equals the pick else 0; return 1.
 */
export function tickCoinToss(
    mem: DuelEffectOpMemory, host: CoinTossHost, duel: number, view: number,
): number {
    const state = mem.read8(duel + DUEL_COIN_TOSS_STATE) & 0xff;
    if (state < 1 || state > 6) return 0;
    let t: number;
    switch (state) {
    case 1: {
        t = mem.read32(duel + DUEL_COIN_TOSS_TIMER) | 0;
        if (t === 0 || t === 4) {
            host.scaleSlot(view, t === 4 ? 1 : 0, 0xa, 0x1000, 0x1000);
        }
        t = (t + 1) | 0;
        mem.write32(duel + DUEL_COIN_TOSS_TIMER, t);
        if (t >= 0xf) {
            mem.write8(duel + DUEL_COIN_TOSS_STATE, 2);
            host.cardStartMoveSilent(view, 0, 5, 0x7400, 0x5c00);
            const flags = mem.read8(view + VIEW_SLOT_HIGHLIGHT) & 0xff;
            mem.write16(view + 0x12e, 1);
            mem.write8(view + VIEW_SLOT_HIGHLIGHT, (flags | 1) & 0xff);
        }
        return 0;
    }
    case 2: {
        // the arm's prologue: mark the current slot highlighted (view+0x150 |= 1)
        // and arm its tick flag (view+slot*0x4C+0x12E = 1), before any pad read.
        const cur = mem.read32(duel + DUEL_COIN_TOSS_SLOT) | 0;
        const curRec = view + cur * 0x4c;
        mem.write8(curRec + VIEW_SLOT_HIGHLIGHT, (mem.read8(curRec + VIEW_SLOT_HIGHLIGHT) | 1) & 0xff);
        mem.write16(curRec + 0x12e, 1);
        if (padChord(mem, host, 7) || padChord(mem, host, 5)) {
            coinTossSlide(mem, host, duel, view);
            return 0;
        }
        if (padPressedBit(mem, host, 0xd)) {
            const slot = mem.read32(duel + DUEL_COIN_TOSS_SLOT) | 0;
            mem.write8(duel + DUEL_COIN_TOSS_STATE, 3);
            mem.write32(duel + DUEL_COIN_TOSS_PICK, slot);
            mem.write8(duel + slot + 0x46f, 1);
            mem.write32(duel + 0x42c, 0);
            mem.write32(duel + DUEL_COIN_TOSS_ACC, 0);
            mem.write32(duel + DUEL_COIN_TOSS_TIMER, 0);
            host.playPackedSound(0x4001c | 0);
        }
        return 0;
    }
    case 3: {
        if (coinTossPickCheck(mem, host, duel, view) === 0) return 0;
        const slot = mem.read32(duel + DUEL_COIN_TOSS_SLOT) | 0;
        mem.write8(duel + DUEL_COIN_TOSS_STATE, 4);
        mem.write32(duel + 0x42c, 0);
        mem.write32(duel + DUEL_COIN_TOSS_ACC, 0);
        mem.write32(duel + DUEL_COIN_TOSS_TIMER, 0);
        host.cardStartFlip(view, slot);
        return 0;
    }
    case 4: {
        t = mem.read32(duel + DUEL_COIN_TOSS_TIMER) | 0;
        if (t === 0x14) {
            host.cardStartFlip(view, (mem.read32(duel + DUEL_COIN_TOSS_SLOT) | 0) ^ 1);
            const rec = (mem.read32(duel + DUEL_COIN_RESULT) | 0) === (mem.read32(duel + DUEL_COIN_TOSS_PICK) | 0)
                ? 0x44 : 0x43;
            host.openInfoBanner(view, 5, 5, rec, 0, 0x42);
            host.playPackedSound(0x40019 | 0);
        }
        t = mem.read32(duel + DUEL_COIN_TOSS_TIMER) | 0;
        if (t >= 0x1f && (padPressedBit(mem, host, 0xd) || padPressedBit(mem, host, 0xe))) {
            mem.write32(duel + DUEL_COIN_TOSS_TIMER, 0x5a);
        }
        t = mem.read32(duel + DUEL_COIN_TOSS_TIMER) | 0;
        t = (t + host.frameDelta()) | 0;
        mem.write32(duel + DUEL_COIN_TOSS_TIMER, t);
        if (t >= 0x5b) {
            mem.write8(duel + DUEL_COIN_TOSS_STATE, 5);
            mem.write32(duel + 0x42c, 0);
            mem.write32(duel + DUEL_COIN_TOSS_ACC, 0);
            mem.write32(duel + DUEL_COIN_TOSS_TIMER, 0);
            host.writeBannerRecord(view, 5);
        }
        return 0;
    }
    case 5: {
        t = mem.read32(duel + DUEL_COIN_TOSS_TIMER) | 0;
        if (t === 0 || t === 4) {
            host.scaleSlot(view, t === 4 ? 1 : 0, 5, 0, 0x1000);
        }
        t = (mem.read32(duel + DUEL_COIN_TOSS_TIMER) + 1) | 0;
        mem.write32(duel + DUEL_COIN_TOSS_TIMER, t);
        if (t >= 0xf) mem.write8(duel + DUEL_COIN_TOSS_STATE, 6);
        return 0;
    }
    default: { // state 6
        const bit = mem.read32(duel + DUEL_COIN_RESULT) | 0;
        const pick = mem.read32(duel + DUEL_COIN_TOSS_PICK) | 0;
        mem.write32(duel + DUEL_COIN_TOSS_PICK, bit === pick ? 1 : 0);
        return 1;
    }
    }
}

// ── F10: the deal-turn-start ceremony (opcode 0x14, F0x80092BA4 + F0x80092E60) ─
//
// Opcode 0x14 is the duel's "clear both boards and deal a fresh turn" ceremony.
// Its enter arm (F0x80092BA4) zeroes the two played-row counters and repaints
// the four HUD readouts, then arms the tick state duel+0x423 = 1. Its tick
// (F0x80092E60, reached every frame) is a two-level state machine:
//
//   * duel+0x423 selects a 12-arm table (D0x800835DC) — the ACTIONS: slide the
//     HUD panels in (arm 1), lay the fresh board out (arm 2), reset the timers
//     (arms 3/4/5/9), raise the compile prompt (arms 6/7/11), slide the panels
//     out (arms 5/9), and the shared tail (arms 8/10/12). Every arm falls into
//     the tail, which copies duel+0x423 into duel+0x422 and clears duel+0x423.
//   * duel+0x422 then selects a second 12-arm table (D0x8008360C) — the WAITS:
//     arm 1 waits for the panels to finish sliding in, arms 2-5 animate the
//     cards onto the board and settle them, arms 6/7/9/11 wait on the panel
//     flag view+0xDFA, arm 8/12 read the confirm button, and arm 10 returns 1
//     (the turn has started) once the compile prompt's result word is not 2.
//
// Read arm by arm from the ASSEMBLY (exe-decomp/cardgame.norm.s lines
// 17485-18202), never the m2c C: the two jump tables are physically
// interleaved with their arms there. The view's own method slots the tick
// reaches are HOST EDGES here, exactly as the board view's three browse passes
// treat them: the ones already ported run for real; the rest are named gaps.
//
// WHAT A PLAYER SEES. When an effect clears both fields, the two HUD panels
// slide apart, a fresh hand is dealt onto the two rows of the board, each card
// flips and settles face-up, the compile prompt rises asking which card to
// play, and the turn begins.

/** duel+0x423: the ceremony's level-1 (action) state byte, 1..12. */
export const DUEL_DEAL_L1 = 0x423;
/** duel+0x422: the ceremony's level-2 (wait) state byte, 1..12. */
export const DUEL_DEAL_L2 = 0x422;
/** duel+0x424: the current arm's frame timer. */
export const DUEL_DEAL_TIMER = 0x424;
/** duel+0x428: the card cursor / accumulator the animation arms step. */
export const DUEL_DEAL_ACC = 0x428;
/** duel+0x42c: row 0's remaining span the HUD readout 5 shows. */
export const DUEL_DEAL_ROW0 = 0x42c;
/** duel+0x430: row 1's remaining span. */
export const DUEL_DEAL_ROW1 = 0x430;
/** duel+0x434: the card spans left to animate (steps of 7 / 3 per frame). */
export const DUEL_DEAL_SPAN = 0x434;
/** duel+0x440: the compile prompt's result word (0 none, 1 auto, 2 chosen). */
export const DUEL_DEAL_RESULT = 0x440;
/** view+0x64: the HUD panel-slide state the first wait blocks on (== 2 done). */
export const VIEW_PANEL_STATE = 0x64;
/** view+0xDFA: the board's own per-side settle flag the later waits read. */
export const VIEW_SETTLE_FLAG = 0xdfa;
/** `[0x8005CCB0]`: the deal layout's record selector cell. */
export const DEAL_SLOT_RECORD_CELL = 0x8005ccb0;
/** The deal-tile pitch: `index * 0x2900` between the two rows' cards. */
export const DEAL_CARD_PITCH = 0x2900;

/** F0x80092E60's level-1 (action) jump table D0x800835DC, read word by word
 *  from pro_cardgame.bin (states 1..12). Exported so the oracle re-reads the
 *  shipped table and cannot pass on a transcription. */
export const DEAL_L1_ARMS: readonly number[] = [
    0x80092ec0, 0x80092ecc, 0x80092ee0, 0x80092ee0, 0x80092ef0, 0x80092f08,
    0x80092f48, 0x80092ffc, 0x80092fa4, 0x80092ffc, 0x80092fd8, 0x80092ffc,
];
export const DEAL_L1_TABLE = 0x800835dc;

/** F0x80092E60's level-2 (wait) jump table D0x8008360C, read word by word
 *  (states 1..12). */
export const DEAL_L2_ARMS: readonly number[] = [
    0x8009303c, 0x8009308c, 0x8009324c, 0x800932c0, 0x80093394, 0x80093488,
    0x80093488, 0x800934a4, 0x80093524, 0x80093550, 0x80093568, 0x80093584,
];
export const DEAL_L2_TABLE = 0x8008360c;

/**
 * The deal layout table D0x800A5958, four 32-bit words per 16-byte record: the
 * two card positions of each row (x0, y0, x1, y1). F0x80092C54 and the tick's
 * arm 2 read the record at `DEAL_SLOT_RECORD_CELL * 16`. Read from
 * pro_cardgame.bin.
 */
export const DEAL_SLOT_RECORDS: readonly (readonly [number, number, number, number])[] = [
    [0x1800, 0x9000, 0x1800, 0x3200],
    [0x1800, 0x9c00, 0x1800, 0x2600],
    [0x610049, 0x61007b, 0x6100ad, 0xa0000],
    [0xbe0202, 0x203000a, 0x1800be, 0x430204],
];
export const DEAL_SLOT_TABLE_ADDR = 0x800a5958;

/** A signed halfword, the way `lh` reads these duel fields. */
function s16(v: number): number {
    return (v << 16) >> 16;
}

/**
 * The edges the deal ceremony's tick drives. Each is either an already-ported
 * body or a named gap in the session — never an interpreter edge:
 * - `setHudCounter` = view+0xEA0 (duel-board-view.ts).
 * - `scaleSlot` = view+0xF24, `cardStartFlip` = view+0xF28 (duel-board-view.ts).
 * - `openPrompt` = view+0xEE4, `closePrompt` = view+0xEE8 (view-openers.ts).
 * - `placeSlot` = view+0xF14 (placeCardResetVisual), `bindSlot` = view+0xF3C
 *   (bindSlotToCard) — the board view's own placement pair.
 * - `playPackedSound` = `[0x80055C48]`; `frameDelta` = `[0x8005DF9C]`.
 * - `slidePanelsIn` = view+0xEC8 F0x8009C2D0, `slidePanelsOut` = view+0xEC4
 *   F0x8009C350, `setHudHighlights` = view+0xEB8 F0x8009CC4C,
 *   `cardStartMoveWithSfx` = view+0xF08 F0x8009C9A0, `setCardScaleEndpoints` =
 *   view+0xF20 F0x8009C904, `cardStartSettle` = view+0xF1C F0x8009CE28 — the
 *   view's panel/highlight/card-motion methods (named gaps in the session).
 * - `settleRowCard` = F0x8008D854, the per-row counter step (a named gap).
 * - `inputPortReset` = pad block +0x3F4, `inputPortWord` = pad block +0x408
 *   (the shared input port, a named gap).
 */
export interface DealTurnStartHost {
    playPackedSound(id: number): void;
    frameDelta(): number;
    setHudCounter(view: number, side: number, index: number, value: number): void;
    scaleSlot(view: number, index: number, span: number, from: number, to: number): void;
    cardStartFlip(view: number, index: number): void;
    openPrompt(view: number, a1: number, a2: number, a3: number, a4: number): void;
    closePrompt(view: number): void;
    placeSlot(view: number, index: number, x: number, y: number): void;
    bindSlot(view: number, index: number, value: number): void;
    slidePanelsIn(view: number): void;
    slidePanelsOut(view: number): void;
    setHudHighlights(view: number, mask: number): void;
    cardStartMoveWithSfx(view: number, index: number, span: number, x: number, y: number): void;
    setCardScaleEndpoints(view: number, index: number, a2: number, a3: number): void;
    cardStartSettle(view: number, index: number): void;
    settleRowCard(duel: number, view: number, side: number, value: number): number;
    inputPortReset(): number;
    inputPortWord(port: number, code: number): number;
}

/**
 * F0x80092BA4(duel, view): the opcode 0x14 enter arm (@.L0x0000fef4). Zero the
 * two played-row counters (duel+0x5A6 and duel+0x66E), repaint the four HUD
 * readouts (index 6 for both sides from the zeroed counters, index 5 from each
 * row's remaining span), clear the result word duel+0x440 and arm the tick
 * state duel+0x423 = 1.
 */
export function effectOp14ClearBothBoards(
    mem: DuelEffectOpMemory, host: DealTurnStartHost, duel: number, view: number,
): void {
    mem.write16(duel + 0x5a6, 0);
    mem.write16(duel + 0x66e, 0);
    host.setHudCounter(view, 0, 6, s16(mem.read16(duel + 0x5a6)));
    host.setHudCounter(view, 1, 6, s16(mem.read16(duel + 0x66e)));
    host.setHudCounter(view, 0, 5, s16(mem.read16(duel + 0x5a4)));
    host.setHudCounter(view, 1, 5, s16(mem.read16(duel + 0x66c)));
    mem.write32(duel + DUEL_DEAL_RESULT, 0);
    mem.write8(duel + DUEL_DEAL_L1, 1);
}

/**
 * F0x80092C54(duel, view): lay the fresh board out (@.L0x0000ffa4). Clear the
 * ceremony's three timers, copy each row's remaining span into duel+0x42C /
 * duel+0x430, then for each of the two rows copy six card ids out of the row's
 * source table into its duel+0x600 table (stepping the row's head/tail cursors),
 * and finally place and bind the twelve board slots (six per row, slots 0..5 and
 * 6..B) from the layout record the `DEAL_SLOT_RECORD_CELL` names.
 */
export function dealTurnStartLayout(
    mem: DuelEffectOpMemory, host: DealTurnStartHost, duel: number, view: number,
): void {
    mem.write32(duel + DUEL_DEAL_TIMER, 0);
    mem.write32(duel + DUEL_DEAL_ACC, 0);
    mem.write32(duel + DUEL_DEAL_SPAN, 0);
    mem.write32(duel + DUEL_DEAL_ROW0, s16(mem.read16(duel + 0x5a4)));
    mem.write32(duel + DUEL_DEAL_ROW1, s16(mem.read16(duel + 0x66c)));
    for (let row = 0; row < 2; row++) {
        const base = duel + row * 0xc8;
        for (let i = 0; i < 6; i++) {
            const start = s16(mem.read16(base + 0x5a0));
            const src = mem.read16(duel + row * 0xc8 + start * 2 + 0x5b0) & 0xffff;
            mem.write16(duel + row * 0xc8 + i * 2 + 0x600, src);
            mem.write16(base + 0x5a6, (mem.read16(base + 0x5a6) + 1) & 0xffff);
            mem.write16(base + 0x5a4, (mem.read16(base + 0x5a4) - 1) & 0xffff);
            mem.write16(base + 0x5a0, (mem.read16(base + 0x5a0) + 1) & 0xffff);
        }
    }
    const idx = mem.read32(DEAL_SLOT_RECORD_CELL) | 0;
    const rec = (DEAL_SLOT_RECORDS[idx] ?? DEAL_SLOT_RECORDS[0]) as readonly [number, number, number, number];
    for (let i = 0; i < 6; i++) {
        host.placeSlot(view, i, (rec[0] + 0x14800) | 0, rec[1] | 0);
        host.bindSlot(view, i, s16(mem.read16(duel + i * 2 + 0x600)));
        mem.write8(view + i * 0x4c + 0x14d, 2);
        mem.write16(view + i * 0x4c + 0x122, 0);
        mem.write16(view + i * 0x4c + 0x120, 0);
    }
    for (let i = 0; i < 6; i++) {
        host.placeSlot(view, i + 6, (rec[2] + 0x14800) | 0, rec[3] | 0);
        host.bindSlot(view, i + 6, s16(mem.read16(duel + i * 2 + 0x6c8)));
        mem.write8(view + (i + 6) * 0x4c + 0x14d, 2);
        mem.write16(view + (i + 6) * 0x4c + 0x122, 0);
        mem.write16(view + (i + 6) * 0x4c + 0x120, 0);
    }
}

/** The level-1 (action) arm. Falls into the shared tail afterwards. */
function dealTurnStartAction(
    mem: DuelEffectOpMemory, host: DealTurnStartHost, duel: number, view: number, l1: number,
): void {
    switch (l1) {
    case 1: host.slidePanelsIn(view); break;
    case 2: dealTurnStartLayout(mem, host, duel, view); break;
    case 3:
    case 4:
        mem.write32(duel + DUEL_DEAL_TIMER, 0);
        mem.write32(duel + DUEL_DEAL_ACC, 0);
        mem.write32(duel + DUEL_DEAL_SPAN, 0);
        break;
    case 5:
        mem.write32(duel + DUEL_DEAL_TIMER, 0);
        mem.write32(duel + DUEL_DEAL_ACC, 0);
        mem.write32(duel + DUEL_DEAL_SPAN, 0);
        host.slidePanelsOut(view);
        break;
    case 6:
        host.setHudHighlights(view, 0x1000);
        host.openPrompt(view, 0x21, 0, 1, 1);
        mem.write32(duel + DUEL_DEAL_RESULT, 1);
        break;
    case 7:
        host.playPackedSound(0x6004001e | 0);
        host.setHudHighlights(view, 0x2000);
        host.openPrompt(view, 0x22, 0, 1, 1);
        mem.write32(duel + DUEL_DEAL_RESULT, 2);
        break;
    case 8:
    case 10:
    case 12:
        break;
    case 9:
        mem.write32(duel + DUEL_DEAL_TIMER, 0);
        mem.write32(duel + DUEL_DEAL_ACC, 0);
        mem.write32(duel + DUEL_DEAL_SPAN, 0);
        host.slidePanelsOut(view);
        host.closePrompt(view);
        break;
    case 11:
        host.openPrompt(view, mem.read32(duel + 0x2ec) | 0, 0, 0, 3);
        break;
    default:
        break;
    }
}

/** The two shared animation tails (arms 2-5) step the timer/span and, once the
 *  timer crosses its threshold, arm the next level-1 state. */
function dealTurnStartFrameTail(
    mem: DuelEffectOpMemory, host: DealTurnStartHost, duel: number, threshold: number, next: number,
): void {
    if ((mem.read32(duel + DUEL_DEAL_TIMER) | 0) >= threshold) mem.write8(duel + DUEL_DEAL_L1, next);
    mem.write32(duel + DUEL_DEAL_TIMER, (mem.read32(duel + DUEL_DEAL_TIMER) + host.frameDelta()) | 0);
    mem.write32(duel + DUEL_DEAL_SPAN, (mem.read32(duel + DUEL_DEAL_SPAN) + host.frameDelta()) | 0);
}

/**
 * F0x80092E60(duel, view): one tick of the ceremony. Level 1 (duel+0x423)
 * selects the action, then the shared tail copies it into duel+0x422 and clears
 * it; level 2 (duel+0x422) runs the matching wait. Returns 1 only when level 2's
 * arm 10 settles the turn, 0 otherwise (and for any state outside 1..12).
 */
export function tickDealTurnStart(
    mem: DuelEffectOpMemory, host: DealTurnStartHost, duel: number, view: number,
): number {
    const l1 = mem.read8(duel + DUEL_DEAL_L1) & 0xff;
    if (l1 !== 0) {
        if ((l1 - 1) >>> 0 < 12) dealTurnStartAction(mem, host, duel, view, l1);
        // the shared tail F0x80092FFC: 0x422 = 0x423, 0x423 = 0
        const carried = mem.read8(duel + DUEL_DEAL_L1) & 0xff;
        mem.write8(duel + DUEL_DEAL_L1, 0);
        mem.write8(duel + DUEL_DEAL_L2, carried);
    }
    return dealTurnStartWait(mem, host, duel, view) | 0;
}

/** The level-2 (wait) state machine on duel+0x422. */
function dealTurnStartWait(
    mem: DuelEffectOpMemory, host: DealTurnStartHost, duel: number, view: number,
): number {
    const l2 = mem.read8(duel + DUEL_DEAL_L2) & 0xff;
    if ((l2 - 1) >>> 0 >= 12) return 0;
    switch (l2) {
    case 1: {
        if (s16(mem.read16(view + VIEW_PANEL_STATE)) !== 2) return 0;
        if (s16(mem.read16(duel + 0x5a4)) < 6) { mem.write8(duel + DUEL_DEAL_L1, 6); return 0; }
        if (s16(mem.read16(duel + 0x66c)) < 6) { mem.write8(duel + DUEL_DEAL_L1, 7); return 0; }
        mem.write8(duel + DUEL_DEAL_L1, 2);
        return 0;
    }
    case 2: {
        const span = mem.read32(duel + DUEL_DEAL_SPAN) | 0;
        if (span >= 7) {
            const acc = mem.read32(duel + DUEL_DEAL_ACC) | 0;
            if (acc < 6) {
                const idx = mem.read32(DEAL_SLOT_RECORD_CELL) | 0;
                const rec = (DEAL_SLOT_RECORDS[idx] ?? DEAL_SLOT_RECORDS[0]) as readonly [number, number, number, number];
                const off = (acc * DEAL_CARD_PITCH) | 0;
                host.cardStartMoveWithSfx(view, acc, 0x14, (rec[0] + off) | 0, rec[1] | 0);
                host.setCardScaleEndpoints(view, acc, 0x1000, 0x1000);
                host.cardStartMoveWithSfx(view, acc + 6, 0x14, (rec[2] + off) | 0, rec[3] | 0);
                host.setCardScaleEndpoints(view, acc + 6, 0x1000, 0x1000);
                mem.write32(duel + DUEL_DEAL_ACC, acc + 1);
                mem.write32(duel + DUEL_DEAL_ROW1, (mem.read32(duel + DUEL_DEAL_ROW1) - 1) | 0);
                mem.write32(duel + DUEL_DEAL_ROW0, (mem.read32(duel + DUEL_DEAL_ROW0) - 1) | 0);
                host.setHudCounter(view, 0, 6, mem.read32(duel + DUEL_DEAL_ACC) | 0);
                host.setHudCounter(view, 1, 6, mem.read32(duel + DUEL_DEAL_ACC) | 0);
                host.setHudCounter(view, 0, 5, mem.read32(duel + DUEL_DEAL_ROW0) | 0);
                host.setHudCounter(view, 1, 5, mem.read32(duel + DUEL_DEAL_ROW1) | 0);
            }
            mem.write32(duel + DUEL_DEAL_SPAN, (span - 7) | 0);
        }
        dealTurnStartFrameTail(mem, host, duel, 0x3d, 3);
        return 0;
    }
    case 3: {
        const span = mem.read32(duel + DUEL_DEAL_SPAN) | 0;
        if (span >= 7) {
            const acc = mem.read32(duel + DUEL_DEAL_ACC) | 0;
            if (acc < 6) {
                host.cardStartFlip(view, acc);
                mem.write32(duel + DUEL_DEAL_ACC, acc + 1);
            }
            mem.write32(duel + DUEL_DEAL_SPAN, (span - 7) | 0);
        }
        dealTurnStartFrameTail(mem, host, duel, 0x42, 4);
        return 0;
    }
    case 4: {
        const span = mem.read32(duel + DUEL_DEAL_SPAN) | 0;
        if (span >= 7) {
            const acc = mem.read32(duel + DUEL_DEAL_ACC) | 0;
            if (acc < 6) {
                if (host.settleRowCard(duel, view, 0, s16(mem.read16(duel + acc * 2 + 0x600))) !== 0) {
                    host.cardStartSettle(view, acc);
                }
                if (host.settleRowCard(duel, view, 1, s16(mem.read16(duel + acc * 2 + 0x6c8))) !== 0) {
                    host.cardStartSettle(view, acc + 6);
                }
                mem.write32(duel + DUEL_DEAL_ACC, acc + 1);
            }
            mem.write32(duel + DUEL_DEAL_SPAN, (span - 7) | 0);
        }
        dealTurnStartFrameTail(mem, host, duel, 0x51, 5);
        return 0;
    }
    case 5: {
        const span = mem.read32(duel + DUEL_DEAL_SPAN) | 0;
        if (span >= 3) {
            const acc = mem.read32(duel + DUEL_DEAL_ACC) | 0;
            if (acc < 6) {
                host.scaleSlot(view, acc, 5, 0, 0x1000);
                host.scaleSlot(view, acc + 6, 5, 0, 0x1000);
                mem.write32(duel + DUEL_DEAL_ACC, acc + 1);
            }
            mem.write32(duel + DUEL_DEAL_SPAN, (span - 3) | 0);
        }
        dealTurnStartFrameTail(mem, host, duel, 0x29, 0xa);
        return 0;
    }
    case 6:
    case 7: {
        if ((mem.read8(view + VIEW_SETTLE_FLAG) & 0xff) !== 2) return 0;
        mem.write8(duel + DUEL_DEAL_L1, 8);
        return 0;
    }
    case 8: {
        let reset = host.inputPortReset() | 0;
        let word = host.inputPortWord(0, 0xd) | 0;
        if (((reset >>> (word & 0x1f)) & 1) !== 0) { mem.write8(duel + DUEL_DEAL_L1, 9); return 0; }
        reset = host.inputPortReset() | 0;
        word = host.inputPortWord(0, 0xe) | 0;
        if (((reset >>> (word & 0x1f)) & 1) !== 0) mem.write8(duel + DUEL_DEAL_L1, 9);
        return 0;
    }
    case 9: {
        if ((mem.read8(view + VIEW_SETTLE_FLAG) & 0xff) !== 0) return 0;
        if (s16(mem.read16(view + VIEW_PANEL_STATE)) !== 0) return 0;
        mem.write8(duel + DUEL_DEAL_L1, 0xa);
        return 0;
    }
    case 10: {
        if ((mem.read32(duel + DUEL_DEAL_RESULT) | 0) === 2) { mem.write8(duel + DUEL_DEAL_L1, 0xb); return 0; }
        return 1;
    }
    case 11: {
        if ((mem.read8(view + VIEW_SETTLE_FLAG) & 0xff) !== 2) return 0;
        mem.write8(duel + DUEL_DEAL_L1, 0xc);
        return 0;
    }
    default: { // case 12
        let reset = host.inputPortReset() | 0;
        let word = host.inputPortWord(0, 0xd) | 0;
        if (((reset >>> (word & 0x1f)) & 1) !== 0) return 1;
        reset = host.inputPortReset() | 0;
        word = host.inputPortWord(0, 0xe) | 0;
        return ((reset >>> (word & 0x1f)) & 1) !== 0 ? 1 : 0;
    }
    }
}
