/**
 * Display-slot ensembles — the stage overlays' own writers of a RUN of slots.
 *
 * DECODE (original assembly, authority 2). The field's ambient decorations live
 * in one chain of 18-byte display slots whose head pointer is at RAM
 * `0x80099D90`; the layout is `{u8 active; u8 tag; u8 size; u8 layer; u8 clip;
 * u8 animMode; u8 min; u8 max; u8 period; u8 ctr; s16 x; s16 y; s16 ysort;
 * s16 timer}` with `size == 0` ending the chain, and
 * `docs/research/field/point-sprite-ambient-system.md` is its canonical
 * description. `tools/extract_point_sprites.py` extracts the chain per stage and
 * `web/effects.js` is its reader; `engine/systems/stage-slot-player.ts` is the
 * single-slot writer into it.
 *
 * A THIRD writer exists, and this module is it: one stage object claims SIX
 * CONSECUTIVE TAGS and drives all six itself, giving each slot its own phase of
 * a six-phase pass.
 *
 *   member            tick        ctor        draw        tags   stride
 *   s310 id 831/0x33f 0x800a61d0  0x800a65d4  0x800a6598  5..10  8
 *   s310 id 832/0x340 0x800a6758  0x800a6b58  0x800a6b1c  11..16 12
 *
 * Both are in A.o.A. Headquarters, and both are the same routine over different
 * data: `tools/extract_display_slot_ensembles.py` finds them by their own code
 * in all 294 overlays (the claim walk off `[0x80099D90]`, a six-entry claim
 * table at the overlay base, a six-entry phase table, and a constructor the
 * fieldstg effect registry names) and returns exactly these two, so the member
 * list cannot be a hand list.
 *
 * THE OBJECT is one of the resident allocator's state machines (EXE
 * F0x800143dc installs the method block at +0x28..+0x44 and the tick at +0x48),
 * so `+0x28` SET_STATE, `+0x38` ADV_STATE and `+0x0c` the state word are the
 * shared pieces. The state gate is the same as the rockfall's: state 0 claims,
 * state 1 runs, states 2 and 3 park, and anything higher returns.
 *
 * THE CLAIM (state 0, `wstag310.s` file 0x3f0-0x530). It walks the chain and
 * dispatches on the slot's TAG byte through a six-entry table at the overlay
 * base, one body per slot; the walk ends on `size == 0`, and a tag that matches
 * twice keeps the LAST one, because the body simply overwrites the pointer it
 * stored. Each body keeps the record pointer at its own `{rec, index, timer}`
 * triple (obj+0x54, +0x58, +0x5a for the first member; obj+0x54, +0x5c, +0x5e
 * for the second, which spaces the triple eight bytes apart rather than four),
 * zeroes the index, and seeds the timer from `lhu seed+2` — the first entry's
 * own hold. Slots 0 and 5 seed nothing and their timer stays zero. Then the mode
 * word at obj+0x50 is set to 2 and the object ADV_STATES.
 *
 * WHAT THE PLAYER SEES. Six pictures share one point on the A.o.A. Headquarters
 * wall. Two of them are dark, two run their own clip runs every frame, and two
 * are pinned to one picture each. In the first member the wall cycles through
 * fourteen 104x96 pictures at twelve blanks apiece with a smaller pair flickering
 * on top of it; in the second it is a second stack of six at the other end of the
 * same room, cycling eleven frames. That is what the two script steps (SETANIM
 * 831/832 with the sub-command 857) put on the wall.
 *
 * THE SIX-PHASE PASS. The phase counter and the slot cursor are THE SAME
 * register: both start at zero and both advance once per frame, so a slot's role
 * is fixed and a whole pass is six frames, one slot per frame — not six phases
 * sweeping one slot. `wstag310.s:560-578` is the loop head and `:73c-74c` is the
 * advance. When the pass closes, the original tests its "runs finished" counter
 * and moves the mode on: 1 becomes 2 and 3 becomes 0, and 2 -- the mode the
 * object is born in -- is left alone, so the steady pass never ends.
 *
 * THE MODES, obj+0x50, every store listed (`wstag310.s:0x554`, `:0x784`,
 * `:0x788`, and the configure handler `:0x7e4`; nothing else in the object
 * writes the word):
 *
 *   2 (STEADY)  born here, and the only mode the object stays in. Its six-entry
 *               phase table (`wstag310.s:0x18` for the first member, `:0x48` for
 *               the second) has one body per slot and three shapes:
 *                 off     -- `sb $zr, ($s0)`: the slot's live flag and nothing
 *                            else. Slots 0 and 1.
 *                 literal -- `sb $s4, ($s0)` then `sb $v0, 4($s0)`; the clip is
 *                            the last `li $v0, N` before that store, because the
 *                            literal reaches it through a `j`'s delay slot.
 *                            Slots 4 and 5 (3 then 4, and 18 then 19).
 *                 run     -- one call to the overlay's own clip stepper; its
 *                            return becomes the clip (byte + 4) AND the ctr
 *                            (byte + 9), and the live flag goes to 1. Slots 2
 *                            and 3. Stepper: `wstag310.s:0x2d0`, a port of which
 *                            is `stepFixedSpriteRun`.
 *   3 (FLASH)   set only by the configure handler, i.e. by a SECOND SETANIM on
 *               an id that is already live. Slots 0 and 1 then each run one
 *               one-shot table (`wstag310.s:0x6dc` and `:0x704`) whose runs play
 *               the steady pictures BACKWARDS, and a run's 255 marker clears the
 *               slot's clip instead of writing it; two finished runs take the
 *               mode to 0. s310's script fires each member once, so the shipped
 *               game only ever sees the steady pass — the flash is ported
 *               because the handler is real code and a second fire reaches it.
 *   0           the terminal state: every slot's live flag is cleared each pass
 *               and nothing ever sets it again.
 *   1           UNREACHABLE. Its arm (`wstag310.s:0x5bc`) runs two one-shot
 *               tables of its own, but no store in either object ever writes 1
 *               to the mode word, so this port does not model it and the walker
 *               never enters it. Stated rather than hidden: the original's arm
 *               exists, this one shape is not ported.
 *
 * THE CONFIGURE HANDLER (`wstag310.s:0x7b8`, the registry's draw word) answers
 * one sub-command, 857, and on it re-seeds two cursors — index to 0, timer from
 * a hold read out of a table — and sets the mode to 3. Its two cursors INTERLEAVE
 * in the code (`:0x7c8`/`:0x7cc`/`:0x7d0`/`:0x7d4` is "zero cursor 0, read a
 * hold, zero cursor 1, write cursor 0's timer"), so the extractor matches the
 * timer stores back to the zeroed indices instead of reading them in order.
 *
 * TIMEBASE. `delta` is the display service's per-blank delta, clamped to at most
 * 4 by the stepper exactly as on the console. The walker calls the tick once per
 * PAL blank through `paceStageObjects`, so the runs advance as they do on the
 * console at any monitor rate.
 */

import { stepFixedSpriteRun, type FixedSpriteCursor } from "./stage-fixed-sprite.ts";

/**
 * One 4-byte clip record `{s16 clip, u16 hold}`, as the overlay stores it. It is
 * the same shape `stepFixedSpriteRun` walks, named here so this table is not
 * mistaken for a different format.
 */
export type EnsembleClip = [number, number];

/** What one phase writes into its slot, as the extractor read it. */
export type EnsemblePhase =
    /** `sb $zr, ($s0)`: the live flag and nothing else. */
    | { kind: "off" }
    /** A pinned picture: the live flag goes to 1 and the clip to `clip`. */
    | { kind: "literal"; clip: number }
    /** One clip run: the live flag to 1, the clip and ctr to the run's value. */
    | {
        kind: "run";
        /** Overlay address of the run's entry table. */
        table: string;
        /** The stepper's one-shot flag: false = the run wraps, true = it ends. */
        oneShot: boolean;
        writesClip: boolean;
        writesCtr: boolean;
        /** True when the run's 255 marker CLEARS the clip instead of writing. */
        endClearsClip: boolean;
    };

/** One slot's `{rec, index, timer}` triple, by the offsets the code uses. */
export interface EnsembleCursor {
    rec: number;
    index: number;
    timer: number | null;
    /** Overlay address of the run that seeds this cursor, or null for none. */
    seed: string | null;
}

/** One cursor the configure handler re-seeds. */
export interface EnsembleReseed {
    index: number;
    timer: number;
    holdAddr: string;
    hold: number;
}

/** One family member, as `tools/extract_display_slot_ensembles.py` reads it. */
export interface EnsembleMember {
    id: number;
    idHex: string;
    stage: string;
    tick: string;
    ctor: string;
    size: number | null;
    draw: string | null;
    /** The first tag of the run of six the object claims. */
    tagBase: number;
    slots: number;
    cursorBase: number;
    cursorStride: number;
    claimTable: string;
    phaseTable: string;
    stateOffset: number;
    modeOffset: number;
    cursors: EnsembleCursor[];
    /** The mode-2 phase table: one entry per slot. */
    steady: EnsemblePhase[];
    /** The mode-3 band: the one-shot runs over the slots it drives. */
    flash?: EnsemblePhase[];
    configure?: string;
    /** The sub-command the configure handler answers, 857 for both members. */
    configureSub?: number | null;
    reseeds?: EnsembleReseed[];
    /** Overlay address -> the run's entries, through the 255 marker. */
    tables: Record<string, EnsembleClip[]>;
}

/** The walker's patch for one display slot: the bytes the object wrote. */
export interface EnsembleWrite {
    active?: number;
    sprite?: number;
    ctr?: number;
}

/** One live ensemble. Every field is named for the register or offset it came from. */
export interface Ensemble {
    id: number;
    /** obj+0x0c: 0 claims, 1 runs, 2/3 park. */
    state: number;
    /** obj+0x50: the mode word. 2 steady, 3 flash, 0 dark. */
    mode: number;
    /** The slot cursor, which is also the phase counter ($s1 in the overlay). */
    phase: number;
    /** How many one-shot runs have reached their end marker ($s3). */
    done: number;
    /** The chain index each slot claimed, or -1 where the tag matched nothing. */
    recs: number[];
    cursors: FixedSpriteCursor[];
    /** What each slot was last left holding, so a host can read it back. */
    last: EnsembleWrite[];
    /** Each extracted run opened into the stepper's object form. */
    runs: Record<string, { clip: number; hold: number }[]>;
}

/** The steady pass's mode word. */
export const ENSEMBLE_STEADY_MODE = 2;
/** The one-shot flash pass's mode word; the configure handler is what sets it. */
export const ENSEMBLE_FLASH_MODE = 3;
/** The terminal mode: every slot cleared, and nothing sets it again. */
export const ENSEMBLE_DARK_MODE = 0;
/** The stepper's end marker, a halfword of 255 (not -1). */
export const ENSEMBLE_END_CLIP = 255;
/** Both members' configure sub-command, read from `li $v0, 0x359`. */
export const ENSEMBLE_CONFIGURE_SUB = 0x359;

/** The registry id -> member pairing, as the extractor wrote it. */
export function ensembleFor(
    table: Record<string, EnsembleMember> | undefined,
    id: number,
): EnsembleMember | null {
    for (const m of Object.values(table ?? {})) if (m.id === id) return m;
    return null;
}

/**
 * The claim walk (state 0). Returns the chain index of each slot's record, or -1
 * where the tag matched nothing. The walk stops on the chain's terminator
 * (`size == 0`) and a tag that matches twice keeps the LAST match, because the
 * claim body only overwrites the pointer it stored.
 */
export function claimEnsembleSlots(
    records: readonly { atlasFlag: number; size: number }[],
    member: EnsembleMember,
    cursors: FixedSpriteCursor[],
): number[] {
    const recs: number[] = [];
    for (let slot = 0; slot < member.slots; slot++) {
        const tag = member.tagBase + slot;
        const spec = member.cursors[slot];
        const cursor = cursors[slot] ?? (cursors[slot] = { index: 0, timer: 0 });
        cursor.index = 0;
        // The seed is `lhu SEED+2`: the first entry's own hold, read out of the
        // overlay, so it is read from the extracted table and never invented.
        cursor.timer = spec?.seed
            ? (member.tables[spec.seed]?.[0]?.[1] ?? 0)
            : 0;
        let found = -1;
        for (let i = 0; i < records.length; i++) {
            const r = records[i]!;
            if (!r.size) break;
            if (r.atlasFlag === tag) found = i;
        }
        recs.push(found);
    }
    return recs;
}

/**
 * Build one ensemble: the constructor, then the state-0 band on its first tick.
 *
 * The original claims in state 0 and ADV_STATES out of it, so the object a
 * SETANIM builds is already claiming and already in the steady mode by the time
 * the walker holds it; folding the two here keeps the chain walk off the tick
 * path, which is where the records live.
 */
export function createEnsemble(
    member: EnsembleMember,
    records: readonly { atlasFlag: number; size: number }[],
): Ensemble {
    const cursors: FixedSpriteCursor[] = member.cursors.map(() => ({
        index: 0, timer: 0,
    }));
    const recs = claimEnsembleSlots(records, member, cursors);
    return {
        id: member.id,
        state: 1,
        mode: ENSEMBLE_STEADY_MODE,
        phase: 0,
        done: 0,
        recs,
        cursors,
        last: member.cursors.map(() => ({})),
        runs: openRuns(member),
    };
}

/**
 * The configure handler. Returns true when the sub-command was the one it
 * answers, which is the original's "this id was consumed" answer.
 */
export function configureEnsemble(obj: Ensemble, member: EnsembleMember, sub: number): boolean {
    if (member.configureSub == null || sub !== member.configureSub) return false;
    for (const r of member.reseeds ?? []) {
        const slot = member.cursors.findIndex((c) => c.index === r.index);
        const cursor = obj.cursors[slot];
        if (!cursor) continue;
        cursor.index = 0;
        cursor.timer = r.hold;
    }
    obj.mode = ENSEMBLE_FLASH_MODE;
    obj.done = 0;
    return true;
}

/**
 * The run a phase names, in the object form `stepFixedSpriteRun` walks.
 *
 * The extracted tables are `{clip, hold}` TUPLES because that is how the overlay
 * stores them, so they are opened out once when the object is built rather than
 * on every frame.
 */
function openRuns(member: EnsembleMember): Record<string, { clip: number; hold: number }[]> {
    const out: Record<string, { clip: number; hold: number }[]> = {};
    for (const [addr, entries] of Object.entries(member.tables ?? {})) {
        out[addr] = entries.map(([clip, hold]) => ({ clip, hold }));
    }
    return out;
}

/**
 * One frame of the tick (`wstag310.s:0x3f0` for the first member, `:0x978` for
 * the second). One slot is touched per frame — the phase counter and the slot
 * cursor are the same register — and the writes are handed to `write` in the
 * order the original makes them. Returns the number of slots written.
 */
export function tickEnsemble(
    obj: Ensemble,
    member: EnsembleMember,
    delta: number,
    write: (slot: number, patch: EnsembleWrite) => void,
): number {
    if (obj.state !== 1) return 0;

    const slot = obj.phase;
    const rec = obj.recs[slot] ?? -1;
    const cursor = obj.cursors[slot] ?? (obj.cursors[slot] = { index: 0, timer: 0 });
    let wrote = 0;
    const put = (patch: EnsembleWrite) => {
        obj.last[slot] = { ...obj.last[slot], ...patch };
        if (rec >= 0) write(slot, patch);
        wrote += 1;
    };

    if (obj.mode === ENSEMBLE_DARK_MODE) {
        // `wstag310.s:0x738`: the live flag only.
        put({ active: 0 });
    } else if (obj.mode === ENSEMBLE_STEADY_MODE) {
        const phase = member.steady[slot];
        if (phase?.kind === "off") {
            put({ active: 0 });
        } else if (phase?.kind === "literal") {
            put({ active: 1, sprite: phase.clip });
        } else if (phase?.kind === "run") {
            const entries = obj.runs[phase.table] ?? [];
            const t = stepFixedSpriteRun(cursor, entries, phase.oneShot, delta);
            const patch: EnsembleWrite = { active: 1 };
            if (phase.writesClip) patch.sprite = t;
            if (phase.writesCtr) patch.ctr = t;
            put(patch);
        }
    } else if (obj.mode === ENSEMBLE_FLASH_MODE) {
        const phase = (member.flash ?? []).find(
            (f) => f.kind === "run" && (f as { slot?: number }).slot === slot,
        ) as (EnsemblePhase & { slot?: number }) | undefined;
        if (phase?.kind === "run") {
            const entries = obj.runs[phase.table] ?? [];
            const t = stepFixedSpriteRun(cursor, entries, phase.oneShot, delta);
            if (t === ENSEMBLE_END_CLIP && phase.endClearsClip) {
                // The END marker clears the clip and counts the run off; the
                // live flag is not touched on this branch.
                obj.done += 1;
                put({ sprite: 0 });
            } else {
                const patch: EnsembleWrite = { active: 1 };
                if (phase.writesClip) patch.sprite = t;
                if (phase.writesCtr) patch.ctr = t;
                put(patch);
            }
        }
    }

    obj.phase += 1;
    if (obj.phase < member.slots) return wrote;
    obj.phase = 0;
    // The pass has closed. `wstag310.s:0x750` tests the finished-run counter and
    // only then moves the mode: 1 becomes 2, 3 becomes 0, and the steady mode is
    // left alone, which is why the wall keeps cycling.
    if (obj.done < 2) return wrote;
    if (obj.mode === 1) obj.mode = ENSEMBLE_STEADY_MODE;
    else if (obj.mode === ENSEMBLE_FLASH_MODE) obj.mode = ENSEMBLE_DARK_MODE;
    return wrote;
}
