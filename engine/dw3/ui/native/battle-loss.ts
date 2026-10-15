// The loss sequence: what the original does from the moment the party is knocked
// out to the moment it asks for the title screen. Translated from three routines in
// two overlays, plus the one result byte the exit reads.
//
//   pro/wfightmn F0x800A8F88 (loss branch 0x800A9230)   the decision and the beat's start
//   pro/fightstg F0x8009C534                           the result byte
//   pro/fightstg FIGHTSTG_F0x8008CB44 -> F0x8008C93C   the defeat effect (its phase clock)
//   pro/fightstg FIGHTSTG_F0x8008AAAC -> F0x8008AA08  the fade object (F0x8008A83C arms it)
//   pro/wfightmn F0x800A7C00                           the exit: modes 0, 1 and 2
//   pro/fightstg F0x8009A298                           the message window the panel opens on
//   exe F0x80014288                                    the screen's own +0x2C (setState1)
//
// Decode: docs/research/battle/battle-loss-decoded-2026-10-02.md, re-read against
// the assembly for this port (see "What the exit really is" below).
// Oracle: tests/lane-b/battle-loss.test.js runs the originals through engine/native
// and compares the per-tick state of all three objects and the frame the title is
// requested.
//
// ── What the exit really is ──────────────────────────────────────────────────
// The decode calls F0x800A7C00 "the exit object". It is one entry of wfightmn's
// second dispatch table (the .word block at file 0x5010 = 0x800AB010, entry +0x10),
// and its `$s1` argument is not the screen: the loss branch stores the defeat
// effect at `s3+0x18` and the message window at `s3+0x1C`, and the exit reads
// `arg1+0x18` and writes `arg1+0x1C`. So `$s1` is the battle controller's own
// block of child pointers, and the exit's mode word is `arg0+0x14` — the screen's
// state2 word, which the loss branch clears through `[screen+0x2C](screen, 2)`
// (F0x80014288 stores its argument at +0x10 and zeroes +0x14 and +0x18, so the loss
// is what puts the exit back in mode 0).
//
// Mode 0 (0x800A7C68), the default arm, shared by mode 0 and every mode >= 3:
//   effect = block+0x18; if (effect != 0 && effect->0x0C != 2) return;   // wait for phase 2
//   if (result byte != 0) <the reward-selection block>;                   // see host.selectReward
//   <the three-group write loop>                                          // host.writeOutcomeRecords
//   fade = F0x8008AAAC(); block+0x1C = fade;   // this slot held the message window
//   fade->+0x64(fade, 0, 10);                  // F0x8008A83C: arm the ramp
//   mode++
// Mode 1 (0x800A7CDC):
//   if (fade->0x0C != 2) return;               // wait for the ramp to finish
//   [0x8004DF8C](0x1000)->+0x12C(0, 0, 0);     // the view's rectangle colour off
//   if (effect != 0) effect->+0x28(effect, 3); // the effect's phase 3
//   mode++
// Mode 2 (0x800A7F54):
//   F0x800A7328();                             // the write-back
//   result = [0x800A435C];
//   result == 1        -> [0x8004B440](0xE0B or 0x1400, 0)
//   result == 2        -> [0x8004B440](0xE00, 0)   -- the loss
//   anything else      -> [0x8004B440]([0x80048D68], 0), entering at 0x800A7FB4, which is
//                          the same launcher's `jalr` delay slot with the code read from RAM
//
// The mode-2 comparison is `beq $v1, $s0` against `$s0`, and `$s0` is loaded at the
// top of the routine from `arg0+0x14` — so it is the mode word itself, and the loss
// arm is exactly "result byte == 2 == the mode we are in".
//
// ── The two things this port does not do ─────────────────────────────────────
// 1. The camera preset 0xb, the yaw orbit, the motion 0x17 and the class-0x14
//    object live in the effect's entry arm and are the 3-D renderer's. The port
//    calls host.armDefeatEffect() there and nothing else: the counter, the phase
//    and the hand-off are translated, the picture is not built here.
// 2. F0x800A7328 (the write-back), the reward-selection block and the
//    three-group write loop that follows it write the battle workspace at
//    0x800A3868 / 0x800A42B1C / 0x800A44D0 / 0x8004B784, which the walker does not
//    keep. They are recorded as host calls on the exact frames the original makes
//    them and nothing is invented about what they mean.
//
// ── The frame order ──────────────────────────────────────────────────────────
// One battle step is: the controller's own mode step, then the two objects its
// block names, in slot order (+0x18 before +0x1C). That is the resident stepper's
// own order (F0x80018140 runs the parent's step, F0x80018230 then walks the child
// slots in ascending order, exe/fns.s:8850-8890, 8919-8931). The decode does not
// settle the order beyond that, and every order differs by at most one frame out
// of the 253 the loss takes; the oracle drives both sides the same way.

import { findRegisteredHandleByKey, type DisplayServiceMemory } from "../../display-service.ts";
import { setRectColour, type DisplayViewMemory } from "../../display-view.ts";

export interface BattleLossMemory extends DisplayServiceMemory, DisplayViewMemory {
    /** The result byte and the sound id are read a byte at a time (`lbu`). */
    read8(addr: number): number;
    write8(addr: number, value: number): void;
}

// ── addresses ────────────────────────────────────────────────────────────────
/** F0x800A8F88: the battle step whose loss branch is 0x800A9230. */
export const LOSS_TICK = 0x800a8f88;
/** `.L0x00003450` — the loss branch, reached when no record is left standing. */
export const LOSS_BRANCH = 0x800a9230;
/** F0x8009C534: the only writer of the result byte. */
export const LOSS_SET_RESULT = 0x8009c534;
/** `[0x800A435C]`: 0 none/flee, 1 win, 2 loss. */
export const LOSS_RESULT_BYTE = 0x800a435c;
/** `[0x800A4780]`: the three-word record F0x8009C534 writes beside the byte. */
export const LOSS_RESULT_RECORD = 0x800a4780;
/** `[0x80055C48]`: the packed-sound player the loss branch reaches through. */
export const LOSS_SOUND_CELL = 0x80055c48;
/**
 * The GAMEOVER jingle. `lui $a0, 0x6004` with `ori $a0, 0x8` in the `jalr` delay
 * slot is the whole constant: 0x60040008, COMMON SEP sequence 8 (the music builder
 * renders it as gameover). Not 0x401C.
 */
export const LOSS_GAMEOVER_SOUND = 0x60040008;

/** F0x8008CB44 -> F0x8008C93C: the defeat effect and its step. */
export const LOSS_EFFECT_CREATE = 0x8008cb44;
export const LOSS_EFFECT_TICK = 0x8008c93c;
/** `li $a1, 0x54` and `move_ $a2, 0x4` in F0x8008CB44's `jal` delay slot. */
export const LOSS_EFFECT_SIZE = 0x54;
export const LOSS_EFFECT_EXTRA = 4;
/** F0x8008C910 -> 0x8008C590: the child effect the entry arm builds. */
export const LOSS_EFFECT_CHILD_TICK = 0x8008c590;
export const LOSS_EFFECT_CHILD_SIZE = 0xb4;
export const LOSS_EFFECT_CHILD_EXTRA = 0x40;
/** `[0x8004B7BC]` (`0x8004B610` + `0x1AC`): the class allocator the entry arm builds its objects with. */
export const LOSS_CLASS_ALLOCATOR = 0x8004b7bc;
/** `.L0x8008CAB0 slti $v1, 0xF0`: the units phase 2 waits for. */
export const LOSS_EFFECT_PHASE2_UNITS = 0xf0;
/** `[0x800A4548]`: F0x8009E510, the slow-motion level the entry arm sets to 2. */
export const LOSS_SLOW_MOTION_CELL = 0x800a4548;
export const LOSS_SLOW_MOTION_LEVEL = 2;
/** `.L0x8008CAF4 sll $v0, 0x1` over `[0x8004DF9C]()`: the yaw step per delta. */
export const LOSS_YAW_STEP = 2;
/** `0x800A46D8+0x26`: the halfword the orbit accumulates into. */
export const LOSS_YAW_WORD = 0x800a46d8 + 0x26;

/** F0x8008AAAC -> F0x8008AA08, and F0x8008A83C which the exit calls on it. */
export const LOSS_FADE_CREATE = 0x8008aaac;
export const LOSS_FADE_TICK = 0x8008aa08;
export const LOSS_FADE_ARM = 0x8008a83c;
/** `li $a1, 0x68` and `move_ $a2, $zr` in F0x8008AAAC's `jal` delay slot. */
export const LOSS_FADE_SIZE = 0x68;
export const LOSS_FADE_EXTRA = 0;
/** `li $v1, 0x1006` / `sw $zr, 0x54`: the sheet the fade's draw resolves. */
export const LOSS_FADE_SHEET = 0x1006;
/** `li $v0, 0xFF00`: the level the ramp ends at going in, and starts at going out. */
export const LOSS_FADE_LEVEL_MAX = 0xff00;
/** `F0x8008A83C(fade, 0, 10)`: the ramp's own numbers, from the exit's call site. */
export const LOSS_FADE_TICKS = 10;
/** `F0x8008A83C`'s first argument on this path: 0 fades in, anything else fades out. */
export const LOSS_FADE_IN = 0;

/** F0x800A7C00: the exit. `.L0x00002174` = 0x800A7F54 is its mode-2 arm. */
export const LOSS_EXIT = 0x800a7c00;
export const LOSS_EXIT_MODE2 = 0x800a7f54;
/** F0x800A7328: the write-back the mode-2 arm calls before it reads the result. */
export const LOSS_WRITE_BACK = 0x800a7328;
/** `[0x8004B440]`: the screen launcher the mode-2 arm reaches for the title. */
export const LOSS_LAUNCHER = 0x8004b440;
/** 0xE00 is the Title Screen; the win arm's two codes are beside it. */
export const LOSS_LAUNCH_TITLE = 0xe00;
export const LOSS_LAUNCH_WIN_GYM = 0xe0b;
export const LOSS_LAUNCH_WIN_FIELD = 0x1400;
/** `[0x800A4536]`: the mode that sends the win arm to 0xE0B instead of 0x1400. */
export const LOSS_WIN_MODE_WORD = 0x800a4536;
export const LOSS_WIN_MODE_GYM = 6;
/**
 * `[0x8004DF8C](0x1000)->+0x12C(0, 0, 0)`. D0x8004DF8C's first pointer is
 * F0x8001DA84, the display service's own "the registered view whose handle is this
 * key" walk (dw2003_exe_data/src/data.rs:4198-4207; engine/dw3/display-service.ts
 * `findRegisteredHandleByKey`). A view's +0x12C is F0x8001E028, `setRectColour`
 * (VIEW_METHODS, engine/dw3/display-service.ts:154), which writes the channels at
 * +0x19/+0x1B/+0x1A and the flag at +0x18 from their OR — so all three zeros turn
 * that view's rectangle colour OFF. The decode listed this call as unidentified;
 * this is what it is.
 */
export const LOSS_VIEW_KEY = 0x1000;

/** The message the loss branch shows: `li $v0, 0x53` -> `esmfight[0x53]`. */
export const LOSS_MESSAGE_ID = 0x53;
/**
 * The window VM's arm for it. The screen's own +0x2C method (F0x80014288) only
 * stores its argument, so the id reaches the panel through the battle's message
 * slot; the panel then shows one line whose index is the caller's payload word,
 * which is arm 1 (engine/dw3/ui/native/battle-message-line.ts, `.L0x80099638`:
 * line 1 is `payload[0]`, line 2 untouched, no name in slot 1).
 */
export const LOSS_MESSAGE_KIND = 1;

// ── object fields ────────────────────────────────────────────────────────────
/** The task state word every one of these objects switches on (+0x0C). */
export const LOSS_STATE = 0x0c;
/** The defeat effect's delta counter (`.L0x8008CAA8 addu $v1, $v0`). */
export const LOSS_EFFECT_COUNTER = 0x10;
/** The camera object the entry arm built and kept (`.L0x8008C9B4 sw $s2, 0x50($s1)`). */
export const LOSS_EFFECT_CAMERA = 0x50;
/** The fade's "ramp armed" flag (`li $v0, 1; sw $v0, 0x10($s1)`). */
export const LOSS_FADE_RAMP = 0x10;
/** The fade's direction: 0 fades in from nothing, non-zero fades out. */
export const LOSS_FADE_DIRECTION = 0x58;
/** The fade's level, 0 .. 0xFF00, and the step the tick adds to it. */
export const LOSS_FADE_LEVEL = 0x5c;
export const LOSS_FADE_STEP = 0x60;
/** The fade's sheet handle (+0x50) and its second word (+0x54). */
export const LOSS_FADE_SHEET_WORD = 0x50;
/**
 * The class's own arming method, F0x8008A83C, at the fade's +0x64 — the slot the exit
 * calls through (`.L0x000020E4 lw $v0, 0x64($a0)`).
 */
export const LOSS_FADE_ARM_METHOD = 0x64;
/** F0x8008A83C, the routine that slot names. */
export const LOSS_FADE_ARM_ROUTINE = 0x8008a83c;
/** The screen's message id word, the loss branch's `sw $v0, 0x50($s2)`. */
export const LOSS_MESSAGE_WORD = 0x50;
/** The controller block's child slots the exit reads and writes. */
export const LOSS_SLOT_EFFECT = 0x18;
export const LOSS_SLOT_FADE = 0x1c;
/** The exit's mode word, the screen's state2 at +0x14. */
export const LOSS_MODE = 0x14;
/** `lossExitTick` returns this when the arm asked for no screen. */
export const LOSS_NO_LAUNCH = 0;
/** ... and this when the flee/none arm sent the battle back to the field. */
export const LOSS_FIELD_RETURN = -1;

// ── hosts ────────────────────────────────────────────────────────────────────
export interface BattleLossHost {
    /** F0x80014504(handler, size, extra, key): the shared task allocator. */
    createTask(classId: number, size: number, extra: number, key: number): number;
    /** obj->+0x28(obj, state): the base method F0x80014274, setState0. */
    baseMethod28(obj: number, state: number): void;
    /**
     * obj->+0x2C(obj, state): the base method F0x80014288, setState1. The loss branch
     * reaches the SCREEN's own table here (pro/wfightmn.s `.L0x00003478`), and the
     * receiver is the battle controller rather than a tree task, so this is its own
     * host edge and not the tree's `callMethod`.
     */
    baseMethod2C(obj: number, state: number): void;
    /** obj->+0x38(obj): the base method F0x800142AC, advance0. */
    baseMethod38(obj: number): void;
    /**
     * window->+0xAC(window, kind, payload): the message window's own show method,
     * `FIGHTSTG_F0x80099588`. The loss branch jumps into the shared tail at
     * `pro/wfightmn.s .L0x00003538`, which calls it with kind 1 and the address of
     * the screen's message word — so the "Annihilated..." line is opened by the same
     * call the win branch's "Battle won!" uses.
     */
    openMessageWindow(window: number, kind: number, payload: number): void;
    /** [0x8004DF9C](): the frame delta. */
    frameDelta(): number;
    /** [0x80055C48](id): play a packed sound. */
    playSound(id: number): void;
    /**
     * The effect's entry arm, everything the 3-D renderer owns: the type-0x12
     * camera and its preset 0xb (`camMgr->[0x104](0, 0xB)`), the class-0x15
     * animation manager and its `+0xE8(0x17, 0x1E, 0x1E)` motion, and the class-0x14
     * object's `+0x188(0x10)`. Ported as the hand-off it is: the effect's own
     * counter and phase are translated, this picture is not built here. It answers
     * the camera object, which the original keeps at the effect's +0x50 and reads
     * back every frame of the orbit.
     */
    armDefeatEffect(): number;
    /** The orbit: `[0x8004DF9C]()` doubled into the yaw halfword, then the camera's
     *  +0xF8. The renderer's, like the preset above. */
    turnDefeatCamera(delta: number): void;
    /** [0x800A4548](level): F0x8009E510, the slow-motion level. */
    slowMotion(level: number): void;
    /** The defeat effect's child object (F0x8008C910) takes its own turn. */
    defeatChildTick(obj: number, children: number): void;
    /**
     * The exit's reward-selection block, which runs only when the result byte is
     * non-zero: it picks a group out of the three records at 0x800A44D0 and writes
     * 0x80042B84, 0x80042B86 and one word per group in the 0x80048D34 table. What
     * those words mean is not decoded and nothing here is invented about them.
     */
    selectReward(): void;
    /**
     * The three-group write loop the exit runs UNCONDITIONALLY after that selection
     * (pro/wfightmn.s `.L0x0000200c`-`.L0x000020d0`): three turns of
     * `[0x8004B44C](group)` with 0x8004B784+group zeroed, then `0x80048D34+0x788+group*0x14`
     * and `+0x78C+group*0x14` written from the record at 0x800A4470+group*0x20. A loss
     * runs it (the result byte is 2), so it is a host call on its own frame.
     */
    writeOutcomeRecords(): void;
    /**
     * `[0x8004DF8C](0x1000)->+0x12C(0, 0, 0)`: the display service's registered view
     * 0x1000 has its rectangle colour turned off. The original reads +0x12C out of
     * whatever the lookup returns without a null test; `lossClearViewColour` below
     * is this edge wired to the two existing translations, and it skips the store
     * when no view carries the key — the only case the original cannot reach
     * without faulting.
     */
    clearViewColour(mem: BattleLossMemory): void;
    /** F0x800A7328: the write-back. Undecoded; see the header. */
    writeBack(): void;
    /** [0x8004B440](code, 0): ask the resident launcher for a screen. */
    launchScreen(code: number, arg: number): void;
    /**
     * The flee/none tail: `j 0x800A7FB4` into the launcher's own `jalr` delay slot
     * (`.L0x000021D4`), with the code read from `[0x80048D68]` rather than a constant.
     */
    returnToField(): void;
}

const u32 = (v: number): number => v >>> 0;
const s32 = (v: number): number => v | 0;
/** MIPS signed `div`/`mflo`, truncating toward zero. */
function divLo(a: number, b: number): number {
    if (b === 0) return a >= 0 ? -1 : 1;
    if (a === -0x80000000 && b === -1) return -0x80000000;
    return (a / b) | 0;
}

// ── the loss branch (0x800A9230) ─────────────────────────────────────────────

/**
 * F0x8009C534(result): the three words at 0x800A4780, then the result byte. The
 * original finishes by calling F0x8009B9D0 on that record, which walks the
 * 99-entry table at 0x800A3868 and adds the record's word to every live entry's
 * halfword at +2; that walk is the battle workspace, which the walker does not
 * keep, so only the byte and the record are here.
 */
export function lossSetResult(mem: BattleLossMemory, result: number): void {
    mem.write32(LOSS_RESULT_RECORD, 1);
    mem.write32(LOSS_RESULT_RECORD + 4, 1);
    mem.write32(LOSS_RESULT_RECORD + 8, -1);
    mem.write8(LOSS_RESULT_BYTE, result & 0xff);
}

/**
 * `.L0x00003450`-`.L0x00003494` and the shared tail at `.L0x00003538`: the loss branch
 * itself. It sets the result byte, plays the GAMEOVER jingle, stores the message id at
 * the screen's +0x50, clears the exit's mode through the screen's own +0x2C method,
 * builds the defeat effect and puts it in the block's +0x18 slot; the `j` in its last
 * delay slot lands on the tail every outcome shares, which opens the message window on
 * the arm and the payload word the branch has just written.
 *
 * The effect is built with host.createTask because that is all F0x8008CB44 is:
 * `F0x80014504(F0x8008C93C, 0x54, 4)` (`.L0x8008cb48`-`.L0x8008cb5c`). The message window
 * itself was built before the branch chose an outcome (`.L0x00003434`) and stored at
 * block+0x1C, so it arrives as an argument; the branch only calls its +0xAC.
 */
export function lossBranch(
    mem: BattleLossMemory,
    host: BattleLossHost,
    screen: number,
    block: number,
    messageWindow: number,
): void {
    lossSetResult(mem, 2);
    host.playSound(LOSS_GAMEOVER_SOUND);
    mem.write32(screen + LOSS_MESSAGE_WORD, LOSS_MESSAGE_ID);
    // `[screen+0x2C](screen, 2)`: F0x80014288 stores 2 at +0x10 and zeroes +0x14
    // and +0x18, which is what puts the exit back in mode 0 for this battle.
    host.baseMethod2C(screen, 2);
    mem.write32(block + LOSS_SLOT_EFFECT,
        u32(host.createTask(LOSS_EFFECT_TICK, LOSS_EFFECT_SIZE, LOSS_EFFECT_EXTRA, 0)));
    host.openMessageWindow(messageWindow, LOSS_MESSAGE_KIND, screen + LOSS_MESSAGE_WORD);
}

// ── the defeat effect (F0x8008C93C) ──────────────────────────────────────────

/**
 * F0x8008C93C(self, extra). The dispatch is `beq state,1` to the counter arm, `slti
 * state,2` to the entry arm, `beq state,2` to the ORBIT ARM ALONE (`.L0x8008CAD0`,
 * the second instruction of the orbit arm — phase 2 stops counting but keeps turning),
 * `beq state,3` to the slow-motion reset, and anything from 4 up falls into the entry
 * arm again.
 *
 * The counter adds the frame delta on every tick it runs, the entry frame alike, and
 * raises phase 2 once it reaches 0xF0 (`.L0x8008CAB0 slti $v1, $v1, 0xF0` — the counter
 * on both sides — so the test is `counter >= 0xF0`). The camera turn runs in every arm
 * that reaches it and is handed to the renderer.
 */
export function lossEffectTick(
    mem: BattleLossMemory,
    host: BattleLossHost,
    self: number,
    extra: number,
): void {
    const state = s32(mem.read32(self + LOSS_STATE));
    if (state === 3) { host.slowMotion(0); return; }
    if (state !== 1 && state !== 2) {
        mem.write32(self + LOSS_EFFECT_CAMERA, u32(host.armDefeatEffect()));
        host.slowMotion(LOSS_SLOW_MOTION_LEVEL);
        const child = u32(host.createTask(
            LOSS_EFFECT_CHILD_TICK, LOSS_EFFECT_CHILD_SIZE, LOSS_EFFECT_CHILD_EXTRA, 0));
        mem.write32(extra, child);
        mem.write32(child + 0x54, 3);
        mem.write32(child + 0x50, 0);
        host.baseMethod38(self);
    }
    if (state !== 2) {
        const delta = host.frameDelta();
        const counter = s32(mem.read32(self + LOSS_EFFECT_COUNTER)) + delta;
        mem.write32(self + LOSS_EFFECT_COUNTER, counter);
        if (counter >= LOSS_EFFECT_PHASE2_UNITS) host.baseMethod28(self, 2);
        // The original reads the delta a second time for the orbit; it is the same
        // published word, so the port reuses the value it already has.
        mem.write16(LOSS_YAW_WORD, u32(mem.read16(LOSS_YAW_WORD) + ((delta << 1) & 0xffff)) & 0xffff);
        host.turnDefeatCamera(delta);
        return;
    }
    // Phase 2: `.L0x8008CAD0` jumps past the counter and lands on the delta read, so the
    // shot keeps turning for as long as the effect lives — the exit's mode-1 arm puts it
    // in phase 3 only after the fade has finished.
    const delta = host.frameDelta();
    mem.write16(LOSS_YAW_WORD, u32(mem.read16(LOSS_YAW_WORD) + ((delta << 1) & 0xffff)) & 0xffff);
    host.turnDefeatCamera(delta);
}

// ── the fade (F0x8008AAAC / F0x8008A83C / F0x8008AA08) ──────────────────────

/**
 * F0x8008AAAC(): F0x80014504(F0x8008AA08, 0x68, 0), the arming method at +0x64, the
 * sheet at +0x50 and zero at +0x54. F0x80014504 loads `$a3` with zero in its own
 * `jal` delay slot, so the scheduler key is 0 however the caller passes it.
 *
 * The arming method goes in at +0x64 as the original stores it, as DATA: the exit
 * calls the routine itself rather than dispatching through the word, so nothing in the
 * walker ever fetches an address out of it.
 */
export function lossFadeCreate(mem: BattleLossMemory, host: BattleLossHost): number {
    const fade = u32(host.createTask(LOSS_FADE_TICK, LOSS_FADE_SIZE, LOSS_FADE_EXTRA, 0));
    mem.write32(fade + LOSS_FADE_ARM_METHOD, LOSS_FADE_ARM_ROUTINE);
    mem.write32(fade + LOSS_FADE_SHEET_WORD, LOSS_FADE_SHEET);
    mem.write32(fade + 0x54, 0);
    return fade;
}

/**
 * F0x8008A83C(self, direction, ticks): raise the state to 1, arm the ramp, start the
 * level at nothing (direction 0) or at 0xFF00 (any other value), and set the step to
 * 0xFF00/ticks or its negation.
 */
export function lossFadeArm(
    mem: BattleLossMemory,
    host: BattleLossHost,
    fade: number,
    direction: number,
    ticks: number,
): void {
    host.baseMethod28(fade, 1);
    mem.write32(fade + LOSS_FADE_RAMP, 1);
    mem.write32(fade + LOSS_FADE_DIRECTION, direction | 0);
    if ((direction | 0) !== 0) {
        mem.write32(fade + LOSS_FADE_LEVEL, LOSS_FADE_LEVEL_MAX);
        mem.write32(fade + LOSS_FADE_STEP, -divLo(LOSS_FADE_LEVEL_MAX, ticks | 0));
    } else {
        mem.write32(fade + LOSS_FADE_LEVEL, 0);
        mem.write32(fade + LOSS_FADE_STEP, divLo(LOSS_FADE_LEVEL_MAX, ticks | 0));
    }
}

/**
 * F0x8008AA08(self). A state under 1 raises itself to 1 and draws nothing; state 1
 * adds the step to the level and stores it — `.L0x8008AA68 sw $v0, 0x5c($a1)` is the
 * DIRECTION TEST's own delay slot, so the store happens on both arms, and the
 * fade-out arm (`.L0x8008AA84`) is the one that ends the ramp: `bgez $v0, .L0x8008AA94`
 * draws while the level is still >= 0, and the first tick the sum would go under zero
 * stores 0 and raises state 2. State 1 bounds pass -> state 2; state 2 draws and stops
 * moving; state 3 draws nothing, and any state past the table (or under 2) is written
 * back to 1 and left there. The draw itself is F0x8008A8C4's GPU primitive, which is
 * the painter's; what the port owns is the level it reads.
 */
export function lossFadeTick(mem: BattleLossMemory, fade: number): void {
    const state = s32(mem.read32(fade + LOSS_STATE));
    if (state === 2 || state === 3) return;
    if (state !== 1) { mem.write32(fade + LOSS_STATE, 1); return; }
    if (s32(mem.read32(fade + LOSS_FADE_RAMP)) === 0) return;
    const level = s32(mem.read32(fade + LOSS_FADE_LEVEL)) + s32(mem.read32(fade + LOSS_FADE_STEP));
    // The delay-slot store: the level the tick computed lands in the word on BOTH arms,
    // so a level read during a fade-out is the ramping value, never the arming one.
    mem.write32(fade + LOSS_FADE_LEVEL, level);
    if (s32(mem.read32(fade + LOSS_FADE_DIRECTION)) === 0) {
        if (level > LOSS_FADE_LEVEL_MAX) {
            mem.write32(fade + LOSS_FADE_LEVEL, LOSS_FADE_LEVEL_MAX);
            mem.write32(fade + LOSS_STATE, 2);
        }
    } else if (level < 0) {
        mem.write32(fade + LOSS_FADE_LEVEL, 0);
        mem.write32(fade + LOSS_STATE, 2);
    }
}

/** The fade's level, 0 .. 0xFF00. */
export function lossFadeLevel(mem: BattleLossMemory, fade: number): number {
    return s32(mem.read32(fade + LOSS_FADE_LEVEL));
}

/**
 * The grey the fade's quad is drawn with: F0x8008A8C4 `.L0x8008A96C sra $a0, 0x8`,
 * so each channel is the level's high byte, truncated — not the level scaled to 255.
 * The first tenth of the fade is therefore 15, not 26.
 */
export function lossFadeGrey(mem: BattleLossMemory, fade: number): number {
    return (lossFadeLevel(mem, fade) >> 8) & 0xff;
}

// ── the exit (F0x800A7C00) ───────────────────────────────────────────────────

export interface BattleLossExit {
    /** The controller block: +0x18 the defeat effect, +0x1C the fade. */
    block: number;
    /** The mode word, the screen's state2 at +0x14. */
    mode: number;
    /** F0x8008AAAC: build the fade object. */
    createFade: () => number;
}

/**
 * F0x800A7C00(arg0, arg1): one turn of the exit. Returns LOSS_NO_LAUNCH, or the
 * launch code the mode-2 arm asked for, or LOSS_FIELD_RETURN for the flee arm.
 *
 * The dispatch is the original's: mode 1 and mode 2 have arms of their own, mode 0
 * and every mode from 3 up share the arm that builds the fade.
 */
export function lossExitTick(
    mem: BattleLossMemory,
    host: BattleLossHost,
    exit: BattleLossExit,
): number {
    const mode = s32(mem.read32(exit.mode));
    const effect = u32(mem.read32(exit.block + LOSS_SLOT_EFFECT));
    if (mode === 1) {
        const fade = u32(mem.read32(exit.block + LOSS_SLOT_FADE));
        if (fade === 0 || s32(mem.read32(fade + LOSS_STATE)) !== 2) return LOSS_NO_LAUNCH;
        host.clearViewColour(mem);
        if (effect !== 0) host.baseMethod28(effect, 3);
        mem.write32(exit.mode, mode + 1);
        return LOSS_NO_LAUNCH;
    }
    if (mode === 2) {
        host.writeBack();
        const result = s32(mem.read8(LOSS_RESULT_BYTE));
        // `beq $v1, $s1` with $s1 = 1 is the win arm; `$s0` is the mode word, which
        // is 2 in this arm, so `beq $v1, $s0` is the loss arm and every other byte
        // takes the flee/none tail at 0x800A7FB4.
        if (result === 1) {
            const gym = s32(mem.read16(LOSS_WIN_MODE_WORD)) === LOSS_WIN_MODE_GYM;
            const code = gym ? LOSS_LAUNCH_WIN_GYM : LOSS_LAUNCH_WIN_FIELD;
            host.launchScreen(code, 0);
            return code;
        }
        if (result !== 2) {
            host.returnToField();
            return LOSS_FIELD_RETURN;
        }
        host.launchScreen(LOSS_LAUNCH_TITLE, 0);
        return LOSS_LAUNCH_TITLE;
    }
    if (effect !== 0 && s32(mem.read32(effect + LOSS_STATE)) !== 2) return LOSS_NO_LAUNCH;
    if (s32(mem.read8(LOSS_RESULT_BYTE)) !== 0) host.selectReward();
    host.writeOutcomeRecords();
    const fade = u32(exit.createFade());
    mem.write32(exit.block + LOSS_SLOT_FADE, fade);
    lossFadeArm(mem, host, fade, LOSS_FADE_IN, LOSS_FADE_TICKS);
    mem.write32(exit.mode, mode + 1);
    return LOSS_NO_LAUNCH;
}

/**
 * The display-service edge the mode-1 arm makes, wired to the two existing
 * translations: F0x8001DA84's key walk and F0x8001E028's `setRectColour`. It is a
 * free function rather than a host callback because both halves are already
 * translated (engine/dw3/display-service.ts, engine/dw3/display-view.ts) and take
 * nothing but the memory they share.
 */
export function lossClearViewColour(mem: BattleLossMemory): void {
    const view = u32(findRegisteredHandleByKey(mem, LOSS_VIEW_KEY));
    if (view === 0) return;
    setRectColour(mem, view, 0, 0, 0);
}