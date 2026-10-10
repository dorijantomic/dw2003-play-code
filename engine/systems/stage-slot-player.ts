/**
 * Display-slot channel players — the stage overlays' own writers into the
 * field's 18-byte record chain.
 *
 * DECODE (original assembly, authority 2). The field's ambient decorations live
 * in one chain of 18-byte display slots whose head pointer is at RAM
 * `0x80099D90`; the layout is `{u8 active; u8 tag; u8 size; u8 layer; u8 clip;
 * u8 animMode; u8 min; u8 max; u8 period; u8 ctr; s16 x; s16 y; s16 ysort;
 * s16 timer}` with `size == 0` ending the chain, and
 * `docs/research/field/point-sprite-ambient-system.md` is its canonical
 * description. `tools/extract_point_sprites.py` already extracts the chain per
 * stage and `web/effects.js` is its reader.
 *
 * What was missing is a WRITER. A handful of stage-overlay routines claim one
 * slot by its tag byte and then write that slot's clip and live flag every
 * frame. Only the original machine code did that, behind `?nativeStages`, so
 * every decoration such a member owns stood switched off in ordinary play.
 *
 * THE SHARED SYSTEM, once. Two registry records resolve, each in its own stage
 * overlay, to the SAME routine — the two overlays differ only in the address of
 * their clip table, and even that table holds identical bytes:
 *
 *   member            builder      tick        table       tag
 *   s305 id 850/0x352 0x800a6084   0x800a5eb8  0x800a7ffc  1
 *   s306 id 851/0x353 0x800a6084   0x800a5eb8  0x800a6738  1
 *
 * so one port covers the pair, and `tools/extract_stage_slot_players.py` returns
 * exactly these two members over 294 overlays.
 *
 *   wstag305.s .L0x00000110  lw $a0, -0x6270($v0)   # $a0 = [0x80099D90]
 *   wstag305.s .L0x00000134  lbu $v0, -0x1($v1)     # the slot's tag byte, +1
 *   wstag305.s .L0x0000013c  bne $v0, $a2, .L00..154
 *   wstag305.s .L0x00000144  sh $zr, 0x58($s1)      # the clip cursor's index
 *   wstag305.s .L0x0000014c  sw $a0, 0x54($s1)      # the slot it claimed
 *   wstag305.s .L0x00000150  sh $v0, 0x5a($s1)      # the cursor's hold timer
 *   wstag305.s .L0x0000015c  lbu $v0, ($v1)         # the walk ends on size == 0
 *
 * THE CLAIM does not break: every slot whose tag matches overwrites the one
 * before, so the LAST match wins.
 *
 * THE STATE GATE, on the object state word at `obj+0x0c`: state 1 draws, state
 * 0 or 4 or more re-arms (claim the slot, clear the cursor, ADV_STATE), and
 * states 2 and 3 park — the original returns from them without touching
 * anything, so a finished object must not climb forever.
 *
 * THE DRAWING BAND is small and it contains TWO BRANCHES WHOSE DELAY SLOTS
 * OVERWRITE THE REGISTER THE BRANCH TESTS. A PS1 runs a branch's delay slot
 * before the branch resolves, so:
 *
 *   wstag305.s .L0x00000188  beq $a0, $v1, .L0x000001b0  # counter == state == 1
 *   wstag305.s .L0x0000018c  slti $v0, $a0, 0x2            # ... delay slot
 *   wstag305.s .L0x00000190  bnez $v0, .L0x000001a4        # $v0 = counter < 2
 *   wstag305.s .L0x00000194  li $v0, 0x5                   # ... delay slot: $v0 = 5
 *   wstag305.s .L0x000001a4  sb $v0, 4($s0)                # the clip is 5, ALWAYS
 *   wstag305.s .L0x000001ac  sb $v1, ($s0)                 # ... delay slot: live
 *
 * `bnez $v0` is therefore taken whatever the test said, which makes the
 * `counter == 2` block below it — `li $v0, 0xa` / `sb $v0, 4($s0)` at
 * `wstag305.s:0x218-0x220`, the clip 10 — DEAD CODE on the console. Reading the
 * band as ordinary flow invents a phase no player ever sees;
 * `tools/extract_stage_slot_players.py` refuses a band whose shape it does not
 * model rather than shipping that reading.
 *
 * So the timeline a player meets is: the object is configured (SETANIM's
 * sub-command 821), the voice COMCD115 plays, the counter is raised to 1, and
 * the drawing band runs the clip table 5,6,7,8,9 at four blanks each. On the
 * 255 marker the slot's clip becomes 255 — which no ids table resolves, so the
 * decoration blinks out — the counter advances, and the voice is STOPPED through
 * `[0x80055C50]` (the stop half of the same packed-sound pair whose play half is
 * `[0x80055C48]`). From then on the counter is 2 and every value pins clip 5, so
 * the decoration settles on sprite 5 and stays.
 *
 * TIMEBASE. `delta` is the display service's per-blank delta, i.e. the return of
 * the shared frame-delta getter `F0x8001D704` that the overlay's clip stepper
 * calls and clamps to at most 4 (see `stepFixedSpriteRun`).
 */

import { stepFixedSpriteRun, type FixedSpriteCursor } from "./stage-fixed-sprite.ts";

/** One 4-byte clip record `{s16 clip, u16 hold}`, as the overlay stores it. */
export type SlotClip = { clip: number; hold: number };

/** What the drawing band leaves one counter value holding, as read off the code. */
export interface SlotBand {
    /** The counter value that takes the clip-table path. */
    runs?: boolean;
    /** The slot's live flag (record + 0). */
    active?: number;
    /** The slot's sprite (record + 4). */
    clip?: number;
}

/** One family member, as `tools/extract_stage_slot_players.py` reads it. */
export interface SlotPlayerMember {
    /** The registry id the overlay's builder registers. */
    id: number;
    /** The slot tag byte this member claims, record + 1. */
    tag: number;
    /** The overlay-local clip table the stepper walks. */
    table: string;
    /** The clip run: 5,6,7,8,9 at four blanks each, then the 255 marker. */
    clips: SlotClip[];
    /** The counter value that runs `clips` instead of pinning a literal. */
    runAt: number;
    /** Every counter value's outcome, keyed by the counter. */
    phases: Record<string, SlotBand>;
    /** The packed sound the configure handler plays (COMCD115). */
    sound: string;
    /** The SETANIM sub-command the configure handler answers to. */
    subCommand: number;
    /** The object offsets of `{slot, index, timer}`: 0x54 / 0x58 / 0x5a. */
    cursor: { rec: number; index: number; timer: number };
    /** The object offset of the counter the band tests: 0x10. */
    counterOffset: number;
    /** The state word that draws: 1. */
    drawState: number;
}

/** One live player. Every field is named for the offset it came from. */
export interface SlotPlayer {
    id: number;
    /** obj+0x0c. 0 re-arms, 1 draws, 2/3 park. */
    state: number;
    /** obj+0x10, the counter the drawing band tests. */
    counter: number;
    /** The chain index of the claimed slot, or -1 when none was claimed. */
    rec: number;
    cursor: FixedSpriteCursor;
    /** The sound handle the configure handler stored at obj+0x50. */
    soundHandle: number;
    /** What the slot was last left holding, for the host to apply. */
    active: number;
    clip: number;
    /** True on the tick the clip run hit its 255 marker. */
    ended: boolean;
    /** True on the tick the player was configured (voice + counter raise). */
    configured: boolean;
}

/** The record field offsets, from the canonical layout. */
export const SLOT_ACTIVE = 0x00;
export const SLOT_TAG = 0x01;
export const SLOT_SIZE = 0x02;
export const SLOT_CLIP = 0x04;
/** The chain's stride, `addiu $a1, 0x12` in every overlay that walks it. */
export const SLOT_STRIDE = 0x12;
/** The clip that ends a run, and the one no ids table resolves. */
export const SLOT_END_CLIP = 0xFF;

/**
 * Claim the slot this member owns, a port of the overlay's chain walk.
 *
 * The walk stops on `size == 0` (or the end of the list) and does NOT break on a
 * tag match, so the LAST slot carrying the tag is the one claimed. `cursor` is
 * seeded the way the overlay seeds it: index 0 and entry 0's hold.
 */
export function claimSlot(
    records: readonly { atlasFlag: number; size: number }[],
    member: SlotPlayerMember,
    cursor: FixedSpriteCursor,
): number {
    cursor.index = 0;
    cursor.timer = member.clips[0]?.hold ?? 0;
    let found = -1;
    for (let i = 0; i < records.length; i++) {
        const r = records[i]!;
        if (!r.size) break;                       // the chain's terminator
        if (r.atlasFlag === member.tag) found = i;
    }
    return found;
}

/** The registry id -> member pairing, read out of the overlays' own code. */
export function slotPlayerFor(
    members: SlotPlayerMember[] | undefined, id: number,
): SlotPlayerMember | null {
    for (const m of members ?? []) if (m.id === id) return m;
    return null;
}

/** Build one player in the state the overlay's configure handler leaves it in. */
export function createSlotPlayer(member: SlotPlayerMember): SlotPlayer {
    return {
        id: member.id,
        state: 0,
        counter: 0,
        rec: -1,
        cursor: { index: 0, timer: 0 },
        soundHandle: -1,
        active: 0,
        clip: 0,
        ended: false,
        configured: false,
    };
}

/**
 * The configure handler, a port of `F0x800a6018`: it fires only for the
 * sub-command the registry record carries, plays the packed voice, remembers the
 * handle, clears the clip cursor and raises the counter to 1. Returns the packed
 * sound word to play, or null when the sub-command is not this member's.
 */
export function configureSlotPlayer(
    obj: SlotPlayer, member: SlotPlayerMember, subCommand: number,
): number | null {
    if (subCommand !== member.subCommand) return null;
    // The handler raises the COUNTER (`obj->0x2c(obj, 1)`), not the state word:
    // the state still starts at 0 and climbs to 1 through the tick's own
    // ADV_STATE on its first frame, which is the frame that claims the slot.
    obj.counter = member.runAt;
    obj.cursor.index = 0;
    obj.cursor.timer = member.clips[0]?.hold ?? 0;
    obj.soundHandle = -1;
    obj.configured = true;
    return Number.parseInt(member.sound, 16) >>> 0;
}

/** The state band, `obj+0x0c`: which of the three paths this tick takes. */
export function slotPlayerBand(state: number, drawState: number): "draw" | "rearm" | "park" {
    if (state === drawState) return "draw";
    if (state < 2 || state >= 4) return "rearm";
    return "park";
}

/**
 * One frame of the tick (`F0x800a5eb8`).
 *
 * Returns `{ sound, stopSound }` — the packed words the host should play or stop
 * this frame, `null` for "nothing" — so the engine stays free of audio.
 */
export function tickSlotPlayer(
    obj: SlotPlayer,
    member: SlotPlayerMember,
    records: readonly { atlasFlag: number; size: number }[],
    delta: number,
): { sound: number | null; stopSound: number | null } {
    const none = { sound: null, stopSound: null };
    obj.ended = false;
    const band = slotPlayerBand(obj.state, member.drawState);
    if (band === "park") return none;
    if (band === "rearm") {
        obj.rec = claimSlot(records, member, obj.cursor);
        obj.state += 1;
        return none;
    }
    // The drawing band. The counter is looked up in the decoded table, so a
    // counter value the code never reaches cannot invent a clip here.
    const phase = member.phases[String(obj.counter)];
    if (!phase) return none;
    if (!phase.runs) {
        obj.active = phase.active ?? 0;
        obj.clip = phase.clip ?? 0;
        return none;
    }
    // The run path: the slot goes live first, then the stepper writes the clip,
    // and the 255 marker is what ends the run.
    const cur = { index: obj.cursor.index, timer: obj.cursor.timer };
    const t = stepFixedSpriteRun(cur, member.clips, true, delta);
    obj.cursor.index = cur.index;
    obj.cursor.timer = cur.timer;
    obj.active = 1;
    obj.clip = t;
    if (t === SLOT_END_CLIP) {
        obj.ended = true;
        obj.counter += 1;                       // the overlay's own counter advance
        return { sound: null, stopSound: Number.parseInt(member.sound, 16) >>> 0 };
    }
    return none;
}
