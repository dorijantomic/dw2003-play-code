// The card duel's two effect-step machines, translated from pro/cardgame:
//   F0x800A2180 fetchNextEffectOpcode  — the between-phase stepper (18 arms)
//   F0x800A2608 saveRestoreEffectStepBlock — the nested-effect / inspect machine
//     that saves the effect-step block, runs a nested one, and restores it.
//
// These are the two routines the tick's arm switch reaches after the effect-VM
// opcode runner (F0x80084320, engine/dw3/ui/effect-vm.ts). The tick
// (duel-tick.ts, F0x800A2DF8) dispatches on duel+0x2F4:
//     1 -> F0x80084320(duel, view)
//     2 -> F0x800A2180(duel, scene) & 0xFF -> clear duel+0x2F4 when non-zero
//     3 -> F0x800A2608(duel, scene): 1 re-arms +0x2F4, 2 reports finished
//
// Authority 2 (original assembly): exe-decomp/cardgame.norm.s
//   F0x800A2180 @ line 33958 (dispatch head 0x800A2180..0x800A21D4, 18 arms
//   spread across 0x800A21D8..0x800A25E4, shared tails at 0x800A1F934 and
//   0x800A1F8AC); jump table D0x80083A68 @ line 981 (18 words, bound
//   `sltiu $v0, $v1, 0x12`, indexed by u8[duel+0x4DC]).
//   F0x800A2608 @ line 34286; jump table D0x80083AB0 @ line 1001 (15 words,
//   bound `sltiu $v0, $v1, 0xF`, indexed by u8[duel+0x568] - 1); inner
//   five-row inspect table D0x80083AF0 (F0x800A2980, head @ line 34516).
//
// THE ARMS MERGE IN THE C AND MUST BE READ FROM THE ASSEMBLY. Several arms
// physically interleave: F0x800A2180's arm 0 falls THROUGH into arm 3's body
// when its probe reports nothing, arm 3 branches forward INTO arm 4's tail, and
// the two arms share the tail at 0x800A1F5C4. m2c merges those bodies; the port
// below follows the assembly's control flow, tail by tail.
//
// WHAT A PLAYER SEES. F0x800A2180 is the pause between phases: it looks at the
// byte duel+0x4DC (which stage of the resolving sequence the duel is in) and
// either advances it, plays the resolving card's presentation, clears the board
// rows after a play, or hands the effect VM a fresh opcode. F0x800A2608 is what
// opens when the player presses Triangle on a picker: it saves the effect-step
// block, draws the five-row inspect menu (Your Hand / Field / Trash / Cancel /
// Surrender), and restores the block when the menu closes.

export interface EffectStepMemory {
    read8(addr: number): number;
    read16(addr: number): number;
    read16s(addr: number): number;
    read32(addr: number): number;
    write8(addr: number, value: number): void;
    write16(addr: number, value: number): void;
    write32(addr: number, value: number): void;
}

/**
 * The far edges both machines reach. Each one names the original routine (or
 * the constructor-installed view / resident method) it stands for, so a host
 * that cannot run it raises a named gap rather than inventing behaviour.
 */
export interface DuelEffectStepHost {
    /** F0x800A09FC(duel): does either side's row still hold a dynamic-stat card? */
    resolvingCardProbe(duel: number): number;
    /** F0x800A1DB8(duel, scene): ask the board view to open; 1 when ready. */
    waitViewWindowOpen(duel: number, scene: number): number;
    /** F0x800A1E60(duel, scene): the resolving card's presentation; 1 when over. */
    presentResolvingCard(duel: number, scene: number): number;
    /** F0x80083E34(id, kind, arg): the card-record predicate (see duel-ai.ts). */
    cardPredicate(id: number, kind: number, arg: number): number;
    /** F0x800954F8(duel, view, pred): apply the resolving card's stat change; 1 if it did. */
    applyResolvingStatChange(duel: number, view: number, pred: number): number;
    /** `view+0xEE4(view, a1, a2, a3, a4)`: the board view's prompt opener. */
    viewOpenPrompt(view: number, a1: number, a2: number, a3: number, a4: number): void;
    /** `view+0xEE8(view)`: the board view's field-redraw method. */
    viewRedrawField(view: number): void;
    /** F0x8009EDCC(duel, scene): repaint both HUD strips (duel-counter-service.ts). */
    repaintHudStrips(duel: number, scene: number): void;
    /** `[0x8004B7D0+0x3F4](a0)`: select/reset the shared input port; returns the port word. */
    inputPortReset(a0: number): number;
    /** `[0x8004B7D0+0x408](a0, bit)`: read the input port's button word for `bit`. */
    inputPortWord(a0: number, bit: number): number;
    /** `[0x8004B7D0+0x3FC](a0)`: read the port's held-button word (the third reader). */
    inputPortState(a0: number): number;
    /** F0x80055C48(addr): play the packed sound the address names. */
    playSound(addr: number): void;
    /** `view+0xEEC(view)`: the board view's menu-close / restore method. */
    viewOpEec(view: number): void;
    /** `view+0xEF4(view, row)`: the board view's row-cursor method. */
    viewOpEf4(view: number, row: number): void;
    /** `view+0xEF8(view)`: the board view's confirm method. */
    viewOpEf8(view: number): void;
    /** `view+0xEFC(view)`: the board view's cancel method. */
    viewOpEfc(view: number): void;
    /** `view+0xF00(view, row)`: the board view's row-highlight method. */
    viewOpF00(view: number, row: number): void;
}

/** The dispatch byte both machines share conventions around. */
export const EFFECT_STEP_STATE = 0x4dc;
/** The nested machine's own state byte (the inspect menu's stage). */
export const EFFECT_NESTED_STATE = 0x568;
/** The inspect menu's five-row cursor. */
export const EFFECT_NESTED_ROW = 0x569;
/** The effect-VM's pending-opcode latch and the tick's arm byte. */
export const EFFECT_STEP_PENDING = 0x421;
export const EFFECT_STEP_TICK_ARM = 0x2f4;

export const FETCH_NEXT_EFFECT_OPCODE = 0x800a2180;
export const SAVE_RESTORE_EFFECT_STEP = 0x800a2608;
/** The 18-word table F0x800A2180 dispatches through. */
export const EFFECT_STEP_TABLE = 0x80083a68;
/** The 15-word table F0x800A2608 dispatches through. */
export const EFFECT_NESTED_TABLE = 0x80083ab0;
/** The shared input-port service base (engine/systems/pad-block.ts). */
export { PAD_BLOCK as INPUT_PORT_BASE } from "../../systems/pad-block.ts";
/** The view's saved-block bank F0x800A2608 stores view+0xDE4.. into. */
export const EFFECT_SAVE_BANK = 0x800a5dc8;

const u8 = (m: EffectStepMemory, a: number): number => m.read8(a) & 0xff;
const s8 = (m: EffectStepMemory, a: number): number => (m.read8(a) << 24) >> 24;
const u16 = (m: EffectStepMemory, a: number): number => m.read16(a) & 0xffff;
const s16 = (m: EffectStepMemory, a: number): number => m.read16s(a) | 0;

/** The one shared tail both the "5" arms end through (0x800A1F5C4). */
function advanceState5(m: EffectStepMemory, duel: number): number {
    m.write8(duel + EFFECT_STEP_STATE, 5);
    m.write32(duel + 0x4ec, 0);
    m.write32(duel + 0x4e8, 0);
    m.write8(duel + 0x4dd, 0);
    return 0;
}

/** The shared tail arms 5 uses (0x800A1F8AC): state 6, clear two block words. */
function advanceState6(m: EffectStepMemory, duel: number): number {
    m.write8(duel + EFFECT_STEP_STATE, 6);
    m.write32(duel + 0x4ec, 0);
    m.write32(duel + 0x4e8, 0);
    return 0;
}

/**
 * Arm 3 (F0x800A2204). Arm 0 falls into this body when its probe reports
 * nothing (after setting duel+0x4DC = 3), and its result is what arm 0 returns.
 */
function effectStepArm3(m: EffectStepMemory, host: DuelEffectStepHost, duel: number, scene: number): number {
    const view = m.read32(scene + 0x18) | 0;
    if (s16(m, view + 0x64) !== 0) return advanceState5(m, duel);
    m.write8(duel + EFFECT_STEP_STATE, 4);
    return 0;
}

/**
 * F0x800A2180(duel, scene): the between-phase stepper. Returns 0 normally, 1
 * from arm 14 (state 0xE) when the resolving-card probe reports nothing and
 * from arm 17 (state 0x11); the tick reads bit 0.
 */
export function fetchNextEffectOpcode(
    m: EffectStepMemory, host: DuelEffectStepHost, duel: number, scene: number,
): number {
    const state = u8(m, duel + EFFECT_STEP_STATE);
    // bound: `sltiu $v0, $v1, 0x12` — state 0 and state >= 0x12 both run arm 0's body
    if (state === 0 || state >= 0x12) return effectStepArm0(m, host, duel, scene);
    const view = m.read32(scene + 0x18) | 0;
    switch (state) {
        case 0x01: // F0x800A2228
            m.write8(duel + EFFECT_STEP_PENDING, 0x4c);
            m.write8(duel + EFFECT_STEP_TICK_ARM, 1);
            m.write8(duel + EFFECT_STEP_STATE, 2);
            return 0;
        case 0x02: // F0x800A2244
            m.write8(duel + EFFECT_STEP_PENDING, 0x5a);
            m.write8(duel + EFFECT_STEP_TICK_ARM, 1);
            m.write8(duel + EFFECT_STEP_STATE, 3);
            return 0;
        case 0x03: // F0x800A2204 (also arm 0's fall-through target)
            return effectStepArm3(m, host, duel, scene);
        case 0x04: { // F0x800A2260: ask the board view to open; tail shared with arm 3
            if (host.waitViewWindowOpen(duel, scene) === 0) return 0;
            return advanceState5(m, duel);
        }
        case 0x05: { // F0x800A2288: the resolving card's presentation; tail 0x800A1F8AC
            if (host.presentResolvingCard(duel, scene) === 0) return 0;
            return advanceState6(m, duel);
        }
        case 0x06: { // F0x800A22A4: the resolving card's stat change and prompt
            const pc = s8(m, duel + 0x575);
            const word580 = s16(m, duel + (pc - 1) * 8 + 0x580);
            const id = s16(m, duel + (word580 << 1) + 0x50);
            const pred1 = host.cardPredicate(id, 1, 0);
            if (host.applyResolvingStatChange(duel, view, pred1) !== 0) {
                const pred2 = host.cardPredicate(id, 2, 0);
                host.viewOpenPrompt(view, pred2, 0, 1, 1);
                m.write8(duel + EFFECT_STEP_STATE, 8);
                return 0;
            }
            m.write8(duel + EFFECT_STEP_STATE, 7);
            m.write16(duel + 0x4e0, 0);
            return 0;
        }
        case 0x07: { // F0x800A2340: hand the effect VM the card's opcode, or clear the row
            const pc = s8(m, duel + 0x575);
            const word580 = s16(m, duel + (pc - 1) * 8 + 0x580);
            const id = s16(m, duel + (word580 << 1) + 0x50);
            const pred = host.cardPredicate(id, 4, s16(m, duel + 0x4e0));
            if (pred !== 0) {
                m.write8(duel + EFFECT_STEP_PENDING, pred & 0xff);
                m.write16(duel + 0x4e0, (u16(m, duel + 0x4e0) + 1) & 0xffff);
                m.write8(duel + EFFECT_STEP_TICK_ARM, 1);
                return 0;
            }
            if (pc >= 2) m.write16(duel + (pc - 2) * 8 + 0x582, 0);
            let off = pc - 1;
            for (let k = 0; k < 12; k++) { m.write8(view + off + 0x146, 0); off += 0x4c; }
            m.write8(duel + EFFECT_STEP_STATE, 0x0a);
            return 0;
        }
        case 0x08: { // F0x800A23E8: the shared input port's D/E buttons; redraw field
            // The shift operand is the FIRST call's return: `move $s0,$v0` sits in
            // the delay slot of the second `jalr`, so $s0 is the port-reset word,
            // not the button word (0x800A1F764/0x800A1F768).
            const resetD = host.inputPortReset(0);
            const maskD = host.inputPortWord(0, 0xd);
            const testD = (resetD >> (maskD & 31)) & 1;
            if (testD === 0) {
                const resetE = host.inputPortReset(0);
                const maskE = host.inputPortWord(0, 0xe);
                const testE = (resetE >> (maskE & 31)) & 1;
                if (testE === 0) return 0;
            }
            host.viewRedrawField(view);
            m.write8(duel + EFFECT_STEP_STATE, 9);
            return 0;
        }
        case 0x09: // F0x800A2484
            if (u8(m, view + 0xdfa) !== 0) return 0;
            m.write8(duel + EFFECT_STEP_STATE, 0x0c);
            return 0;
        case 0x0a: // F0x800A24A4
            m.write8(duel + EFFECT_STEP_PENDING, 0x5a);
            m.write8(duel + EFFECT_STEP_TICK_ARM, 1);
            m.write8(duel + EFFECT_STEP_STATE, 0x0b);
            return 0;
        case 0x0b: // F0x800A24C0
            m.write8(duel + EFFECT_STEP_STATE, 0x0c);
            return 0;
        case 0x0c: { // F0x800A24CC: append to the side's played list; step playCount back
            const pc = s8(m, duel + 0x575);
            const word580 = s16(m, duel + (pc - 1) * 8 + 0x580);
            const looked = s16(m, duel + (word580 << 1) + 0x50);
            const side = u8(m, duel + (pc - 1) * 8 + 0x584);
            if (looked !== 0xd) {
                const count = s16(m, duel + side * 0xc8 + 0x5a2);
                m.write16(duel + side * 0xc8 + count * 2 + 0x614, word580 & 0xffff);
                m.write16(duel + side * 0xc8 + 0x5a2, (count + 1) & 0xffff);
            }
            const flag = u8(m, duel + 0x4dd);
            const pc0 = u8(m, duel + 0x575);
            if (flag !== 0) {
                m.write8(duel + 0x575, (pc0 - 1) & 0xff);
                m.write8(duel + 0x575, (pc0 - 2) & 0xff);
            }
            m.write8(duel + EFFECT_STEP_STATE, 0x0d);
            m.write32(duel + 0x4ec, 0);
            m.write32(duel + 0x4e8, 0);
            return 0;
        }
        case 0x0d: // F0x800A2568
            host.repaintHudStrips(duel, scene);
            m.write8(duel + EFFECT_STEP_STATE, 0x0e);
            return 0;
        case 0x0e: // F0x800A2580
            if (host.resolvingCardProbe(duel) === 0) return 1;
            m.write8(duel + EFFECT_STEP_PENDING, 0x5d);
            m.write8(duel + EFFECT_STEP_TICK_ARM, 1);
            m.write8(duel + EFFECT_STEP_STATE, 0x0f);
            return 0;
        case 0x0f: // F0x800A25A8
            m.write8(duel + EFFECT_STEP_PENDING, 0x4c);
            m.write8(duel + EFFECT_STEP_TICK_ARM, 1);
            m.write8(duel + EFFECT_STEP_STATE, 0x10);
            return 0;
        case 0x10: // F0x800A25C4
            m.write8(duel + EFFECT_STEP_PENDING, 0x5a);
            m.write8(duel + EFFECT_STEP_TICK_ARM, 1);
            m.write8(duel + EFFECT_STEP_STATE, 0x11);
            return 0;
        case 0x11: // F0x800A25E0: `li $s4, 1`
            return 1;
        default:
            throw new Error(`fetchNextEffectOpcode: no arm for state 0x${state.toString(16)}`);
    }
}

/**
 * Arm 0 (F0x800A21D8). Shared by state 0, state >= 0x12, and — on its else
 * path — the fall-through into arm 3's body.
 */
function effectStepArm0(m: EffectStepMemory, host: DuelEffectStepHost, duel: number, scene: number): number {
    if (host.resolvingCardProbe(duel) !== 0) {
        m.write8(duel + EFFECT_STEP_PENDING, 0x5d);
        m.write8(duel + EFFECT_STEP_TICK_ARM, 1);
        m.write8(duel + EFFECT_STEP_STATE, 1);
        return 0;
    }
    m.write8(duel + EFFECT_STEP_STATE, 3);
    return effectStepArm3(m, host, duel, scene);
}

// ── F0x800A2608 saveRestoreEffectStepBlock ────────────────────────────────────

/** The two view bank addresses the nested machine saves and restores. */
const NESTED_VIEW_BANK = 0xde4; // six words: view+0xDE4..view+0xDF8
/** The board view's own state bytes the nested machine tests. */
const NESTED_VIEW_MENU = 0xdfa;
const NESTED_VIEW_ROW = 0xdf4;
const NESTED_VIEW_READY = 0xe0a;

function copyWords(m: EffectStepMemory, dst: number, src: number, words: number): void {
    for (let i = 0; i < words; i++) m.write32(dst + i * 4, m.read32(src + i * 4));
}

/**
 * One button pair: `M3F4(0) & (1 << M408(0, bit))` OR'd with
 * `M3FC(0) & (1 << M408(0, bit))` — both readers use the same bit. Replays the
 * exact call order the arms use (each M408 logged separately).
 */
function portButtonPressed(host: DuelEffectStepHost, bit: number): number {
    const r1 = host.inputPortReset(0);
    const r2 = host.inputPortWord(0, bit);
    const r3 = host.inputPortState(0);
    const r4 = host.inputPortWord(0, bit);
    const a = (r1 & (1 << (r2 & 31))) | 0;
    const b = (r3 & (1 << (r4 & 31))) | 0;
    return (a | b) | 0;
}

/** One single-reader bit: `(M3F4(0) >> M408(0, bit)) & 1` (the delay-slot read). */
function portBitPressed(host: DuelEffectStepHost, bit: number): number {
    const r1 = host.inputPortReset(0);
    const r2 = host.inputPortWord(0, bit);
    return (r1 >> (r2 & 31)) & 1;
}

/** The row-cursor + confirm tail shared by state 3's D/E pads (0x800A1FCB0). */
function nestedRowTail(
    m: EffectStepMemory, host: DuelEffectStepHost, duel: number, view: number, playMoveSound: boolean,
): number {
    if (playMoveSound) host.playSound(0x8004513e);
    if (portBitPressed(host, 0xd) !== 0) {
        host.viewOpEfc(view); // f C18..C30: cancel
        m.write8(duel + EFFECT_NESTED_STATE, 4);
        host.viewOpF00(view, m.read8(duel + EFFECT_NESTED_ROW) & 0xff);
        return 0;
    }
    if (portBitPressed(host, 0xe) !== 0) {
        host.playSound(0x800450bd); // f C70..C84: confirm
        host.viewOpEf8(view);
        m.write8(duel + EFFECT_NESTED_STATE, 4);
        m.write8(duel + EFFECT_NESTED_ROW, 3);
        host.viewOpF00(view, 3);
        return 0;
    }
    host.viewOpF00(view, m.read8(duel + EFFECT_NESTED_ROW) & 0xff);
    return 0;
}

/**
 * F0x800A2608(duel, scene): the nested effect-step machine — the inspect menu.
 * Saves the effect-step block (duel+0x420..0x494 into duel+0x4F0..0x564 and the
 * view's six menu words into a resident bank), drives the five-row menu, and
 * restores both when the menu closes. Returns 0 while it runs, 2 from state 10
 * when the menu should end the duel, and 1 from state 15 when it is done.
 */
export function saveRestoreEffectStepBlock(
    m: EffectStepMemory, host: DuelEffectStepHost, duel: number, scene: number,
): number {
    const state = m.read8(duel + EFFECT_NESTED_STATE) & 0xff;
    const view = () => m.read32(scene + 0x18) | 0;
    // bound: `sltiu $v0, $v1, 0xF` on (state - 1) — state 1, state 0 and
    // state >= 0x10 all run arm 0's body (F0x800A2670).
    if (state === 0 || state === 1 || state >= 0x10) return nestedArm0(m, host, duel, scene);
    switch (state) {
        case 0x02: // F0x800A270C: wait for the board view to report ready
            if (s16(m, view() + NESTED_VIEW_READY) !== 2) return 0;
            m.write8(duel + EFFECT_NESTED_STATE, 3);
            return 0;
        case 0x03: return nestedArmPad(m, host, duel, view()); // F0x800A2730
        case 0x04: { // F0x800A2980: dispatch on the five-row cursor
            const v = view();
            if (s16(m, v + NESTED_VIEW_READY) !== 0) return 0;
            const row = m.read8(duel + EFFECT_NESTED_ROW) & 0xff;
            if (row >= 5) return 0;
            if (row === 0) { m.write8(duel + EFFECT_NESTED_STATE, 5); return 0; }
            if (row === 1) { m.write8(duel + EFFECT_NESTED_STATE, 6); return 0; }
            if (row === 2) { m.write8(duel + EFFECT_NESTED_STATE, 7); return 0; }
            if (row === 3) { m.write8(duel + EFFECT_NESTED_STATE, 0x0f); return 0; }
            host.viewOpenPrompt(v, 0x2c, 1, 0, 1);
            m.write8(duel + EFFECT_NESTED_STATE, 8);
            return 0;
        }
        case 0x05: // F0x800A2A2C: row 0 -> inspect Your Hand (opcode 0x9B)
            m.write8(duel + EFFECT_STEP_PENDING, 0x9b);
            m.write8(duel + EFFECT_STEP_TICK_ARM, 1);
            m.write8(duel + EFFECT_NESTED_STATE, 0x0b);
            return 0;
        case 0x06: // F0x800A2A48: row 1 -> inspect the field (opcode 0xA8)
            m.write8(duel + EFFECT_STEP_PENDING, 0xa8);
            m.write8(duel + EFFECT_STEP_TICK_ARM, 1);
            m.write8(duel + EFFECT_NESTED_STATE, 0x0c);
            return 0;
        case 0x07: // F0x800A2A64: row 2 -> inspect Your Trash (opcode 0x9C)
            m.write8(duel + EFFECT_STEP_PENDING, 0x9c);
            m.write8(duel + EFFECT_STEP_TICK_ARM, 1);
            m.write8(duel + EFFECT_NESTED_STATE, 0x0d);
            return 0;
        case 0x08: // F0x800A2A80
            if ((m.read8(view() + NESTED_VIEW_MENU) & 0xff) !== 2) return 0;
            m.write8(duel + EFFECT_NESTED_STATE, 9);
            return 0;
        case 0x09: return nestedArmConfirm(m, host, duel, view()); // F0x800A2AA4
        case 0x0a: { // F0x800A2CE0: end-of-duel report when the menu closes
            if ((m.read8(view() + NESTED_VIEW_MENU) & 0xff) !== 0) return 0;
            if (s16(m, view() + NESTED_VIEW_ROW) !== 0) {
                m.write8(duel + EFFECT_NESTED_STATE, 0x0e);
                return 0;
            }
            return 2;
        }
        case 0x0b: case 0x0c: case 0x0d: case 0x0e: // F0x800A2D18
            host.viewOpEf4(view(), m.read8(duel + EFFECT_NESTED_ROW) & 0xff);
            m.write8(duel + EFFECT_NESTED_STATE, 2);
            return 0;
        case 0x0f: return nestedArmRestore(m, host, duel, scene); // F0x800A2D3C
        default:
            throw new Error(`saveRestoreEffectStepBlock: no arm for state 0x${state.toString(16)}`);
    }
}

/** Arm 0 (F0x800A2670): save the block, open the menu's row cursor. */
function nestedArm0(m: EffectStepMemory, host: DuelEffectStepHost, duel: number, scene: number): number {
    copyWords(m, duel + 0x4f0, duel + 0x420, 0x1e); // 0x78 bytes (loop 0x70 + tail 8)
    m.write8(duel + EFFECT_NESTED_ROW, 0);
    const view = m.read32(scene + 0x18) | 0;
    for (let i = 0; i < 6; i++) m.write32(EFFECT_SAVE_BANK + i * 4, m.read32(view + NESTED_VIEW_BANK + i * 4));
    host.viewOpEf4(view, 0);
    m.write8(duel + EFFECT_NESTED_STATE, 2);
    return 0;
}

/** Arm 2 (F0x800A2730): the inspect menu's row/confirm pad handler. */
function nestedArmPad(m: EffectStepMemory, host: DuelEffectStepHost, duel: number, view: number): number {
    if (portButtonPressed(host, 4) !== 0) {
        const row = m.read8(duel + EFFECT_NESTED_ROW) & 0xff;
        const next = (row - 1) < 0 ? 4 : (row - 1);
        m.write8(duel + EFFECT_NESTED_ROW, next & 0xff);
        nestedRowTail(m, host, duel, view, true);
        return 0;
    }
    if (portButtonPressed(host, 6) !== 0) {
        const row = m.read8(duel + EFFECT_NESTED_ROW) & 0xff;
        m.write8(duel + EFFECT_NESTED_ROW, ((row + 1) % 5) & 0xff);
        nestedRowTail(m, host, duel, view, true);
        return 0;
    }
    nestedRowTail(m, host, duel, view, false);
    return 0;
}

/** Arm 9 (F0x800A2AA4): the confirm / cancel pads on the active menu row. */
function nestedArmConfirm(m: EffectStepMemory, host: DuelEffectStepHost, duel: number, view: number): number {
    if (portBitPressed(host, 0xd) !== 0) {
        host.viewOpEec(view);
        m.write8(duel + EFFECT_NESTED_STATE, 0x0a);
        return 0;
    }
    if (portButtonPressed(host, 4) !== 0) {
        if (s16(m, view + NESTED_VIEW_ROW) !== 0) host.playSound(0x8004513e);
        m.write16(view + NESTED_VIEW_ROW, 0);
        return 0;
    }
    if (portButtonPressed(host, 6) !== 0) {
        if (s16(m, view + NESTED_VIEW_ROW) !== 1) host.playSound(0x8004513e);
        m.write16(view + NESTED_VIEW_ROW, 1);
        return 0;
    }
    if (portBitPressed(host, 0xe) !== 0) {
        host.playSound(0x800450bd);
        m.write16(view + NESTED_VIEW_ROW, 1);
        host.viewOpEec(view);
        m.write16(view + NESTED_VIEW_ROW, 1);
        m.write8(duel + EFFECT_NESTED_STATE, 0x0a);
        return 0;
    }
    return 0;
}

/** Arm 15 (F0x800A2D3C): restore the block and the view's six words. */
function nestedArmRestore(m: EffectStepMemory, host: DuelEffectStepHost, duel: number, scene: number): number {
    void host;
    copyWords(m, duel + 0x420, duel + 0x4f0, 0x1e); // 0x78 bytes
    const view = m.read32(scene + 0x18) | 0;
    for (let i = 0; i < 6; i++) m.write32(view + NESTED_VIEW_BANK + i * 4, m.read32(EFFECT_SAVE_BANK + i * 4));
    m.write8(duel + EFFECT_NESTED_STATE, 0);
    return 1;
}
