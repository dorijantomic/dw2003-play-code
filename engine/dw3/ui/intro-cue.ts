// The duel intro's voice/cue sequencer, translated from pro/cardgame:
//   F0x8009D6B4 createIntroVoice   — the thunk that builds the intro object
//   F0x8009D540 introVoiceCueTick  — its handler: walk the cue table
//
// Phase 4 translation (docs/plans/2026-09-14-native-screen-port-plan.md).
// Oracle: tests/intro-cue-oracle.test.js runs both originals through
// engine/native on the shipped pro_cardgame.bin + resident.bin.
//
// Source (assembly, authority 2): exe-decomp/cardgame.norm.s
//   F0x8009d6b4 @.L0x0001aa04, F0x8009d540 @.L0x0001a890.
// Existing contracts reused: `cardduel-pack-is-carddata-bin` (the cue table
// 0x800A5BF0 is the pack/voice sequence: 43, 15, CARDPAK0..4, -2, 29, 22, 106,
// -1) and the accepted cache-service-contract (0x80044F44 = the acquire
// F0x80013C30, 0x80044F3C = the poll F0x80013A6C, whose poll returns 0 only
// once the transfer finished).
//
// The handler's state machine (up to 0x58 bytes, the thunk's size):
//   state != 1 and (state < 2 or state >= 4) -> cursor 0, setState(1), +0x50 = 0
//   state 1: when the latch (+0x10) is 0 or differs from the state, read the
//     record at table + cursor*4: store its first halfword as the cue, add the
//     resident language index 0x8005CCA8 when the record's second halfword is
//     non-zero, hand the cue to the cache acquire and increment the latch.
//     Then poll the cue: while the poll reports busy, return. Once it is free,
//     step the cursor; a next record whose first halfword is -2 skips one more
//     record and sets +0x50 = 1; the same check on the current record being -1
//     moves the object to state 3. The latch clears either way.
// The scene handler's state 0 creates this object (its `createIntroVoice` host
// edge is exactly this module's createIntroVoice).

export interface IntroCueMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read32(addr: number): number;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

export interface IntroCueHost {
    /** F0x80014504(handler, size, extra) -> the new intro object. */
    allocate(handler: number, size: number, extra: number): number;
    /** F0x80013C30(cue) via [0x80044F44]: request the cue's archive. */
    acquire(cue: number): void;
    /** F0x80013A6C(cue) via [0x80044F3C]: non-zero while the cue is loading. */
    poll(cue: number): number;
    /** obj+0x28 (F0x80014274): the factory's set-state method. */
    setState(obj: number, state: number): void;
}

/** The intro object's handler and the thunk's factory arguments. */
export const INTRO_CUE_HANDLER = 0x8009d540;
export const INTRO_CUE_SIZE = 0x58;
export const INTRO_CUE_EXTRA = 0;
export const INTRO_CUE_CREATE = 0x8009d6b4;
export const INTRO_CUE_TICK = 0x8009d540;
export const INTRO_CUE_FIELDS = {
    /** The handler's dispatch state (s32). */
    state: 0x0c,
    /** The issue latch (s32). */
    latch: 0x10,
    setState: 0x28,
    /** The "skipped a control record" flag (s32). */
    skipped: 0x50,
    /** The record cursor (s16). */
    cursor: 0x54,
    /** The current cue id (s16). */
    cue: 0x56,
} as const;
/** The cue table: four-byte records, first halfword = cue, second = bias flag. */
export const INTRO_CUE_TABLE = 0x800a5bf0;
/** The resident language index added when a record's bias flag is set. */
export const LANGUAGE_INDEX = 0x8005cca8;
/** The control records' first halfwords. */
export const INTRO_CUE_SKIP = -2;
export const INTRO_CUE_END = -1;

const s16 = (v: number): number => (v << 16) >> 16;

/** F0x8009D6B4(): build the intro object (handler 0x8009D540, size 0x58). */
export function createIntroVoice(mem: IntroCueMemory, host: IntroCueHost): number {
    void mem;
    return host.allocate(INTRO_CUE_HANDLER, INTRO_CUE_SIZE, INTRO_CUE_EXTRA) >>> 0;
}

/**
 * F0x8009D540(obj): the intro object's handler. Its state word dispatches;
 * state 1 walks the cue table, acquiring one cue at a time and polling it.
 */
export function introVoiceCueTick(mem: IntroCueMemory, host: IntroCueHost, obj: number): void {
    const state = mem.read32(obj + INTRO_CUE_FIELDS.state) | 0;
    if (state !== 1) {
        if (state < 2 || state >= 4) {
            mem.write16(obj + INTRO_CUE_FIELDS.cursor, 0);
            host.setState(obj, 1);
            mem.write32(obj + INTRO_CUE_FIELDS.skipped, 0);
        }
        return;
    }
    const latch = mem.read32(obj + INTRO_CUE_FIELDS.latch) | 0;
    if (latch === 0 || latch !== state) {
        const cursor = s16(mem.read16(obj + INTRO_CUE_FIELDS.cursor));
        const record = (INTRO_CUE_TABLE + cursor * 4) >>> 0;
        let cue = mem.read16(record) & 0xffff;
        mem.write16(obj + INTRO_CUE_FIELDS.cue, cue);
        if (s16(mem.read16(record + 2)) !== 0) {
            cue = (cue + (mem.read16(LANGUAGE_INDEX) & 0xffff)) & 0xffff;
            mem.write16(obj + INTRO_CUE_FIELDS.cue, cue);
        }
        host.acquire(s16(mem.read16(obj + INTRO_CUE_FIELDS.cue)));
        mem.write32(obj + INTRO_CUE_FIELDS.latch, (mem.read32(obj + INTRO_CUE_FIELDS.latch) + 1) | 0);
    }
    if (host.poll(s16(mem.read16(obj + INTRO_CUE_FIELDS.cue))) !== 0) return;

    const cursor = mem.read16(obj + INTRO_CUE_FIELDS.cursor) & 0xffff;
    mem.write16(obj + INTRO_CUE_FIELDS.cursor, (cursor + 1) & 0xffff);
    // the original's `(cursor+1) << 16 >> 14` is (cursor+1)*4 in-domain
    const nextRecord = (INTRO_CUE_TABLE + ((((cursor + 1) << 16) >> 14))) >>> 0;
    if (s16(mem.read16(nextRecord)) === INTRO_CUE_SKIP) {
        mem.write16(obj + INTRO_CUE_FIELDS.cursor, (cursor + 2) & 0xffff);
        mem.write32(obj + INTRO_CUE_FIELDS.skipped, 1);
    }
    const current = s16(mem.read16(obj + INTRO_CUE_FIELDS.cursor));
    if (s16(mem.read16(INTRO_CUE_TABLE + current * 4)) === INTRO_CUE_END) {
        host.setState(obj, 3);
    }
    mem.write32(obj + INTRO_CUE_FIELDS.latch, 0);
}
