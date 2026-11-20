import type { PointActor, PointHost, PointPictureSteps } from "./types.ts";
import { runtime } from "./core.ts";

// ── arm 9: picture-steps (s785 0x327) ───────────────────────────────────────
//
// THE one stage-object member that claims NO point record.  It draws picture
// ids straight out of the stage's own sprite directory, wherever a character
// is, from a small counter-stepped state machine.  Read end to end out of
// `wstag785.s` on 2026-10-05; every offset below is a file offset in that
// overlay (RAM = 0x800A5DE0 + offset):
//
//   THE TICK (file 0x4d4, the 0x58-byte object the registry ctor at file 0x730
//   allocates through F0x800143dc).  State `obj+0x0c` dispatches at file 0x4e8:
//
//     state 0 (0x510) calls `obj+0x38` = advanceState (EXE F0x800142ac) and
//       stops -- so an object the script has only just built walks itself to
//       state 1 on its second blank.
//
//     state 1 (0x528) dispatches the sub-slot `obj+0x10`:
//       sub 0 (0x554) draws picture 0x32; sub 1 (0x590) draws 0x33; sub 2
//       (0x5d0) draws 0x34.  Each of the three, every blank:
//           `lw $v0, -0x2064($v0)`  the frame delta [0x8004df9c],
//           `lw $v1, 0x14($s1)` / `addu` / `sw`   obj+0x14 += delta,
//           `slti $v1, 0x4` / `bnez $v1, 0x714`   below 4 -> draw and stop,
//           else `lw $v0, 0x3c($s1)` / `jalr`      advanceClip (+0x10 = +1,
//                                                   counter and timer cleared)
//       and then FALL THROUGH into the next sub's body, so the frame that
//       completes one sub already draws the next one's picture (at 0x564-0x58c
//       for sub 0, the same run repeated).
//
//       sub 3 (0x610) has no counter at all except in one arm: it dispatches
//       the ARM WORD `obj+0x50` --
//           0 -> 0x35 (file 0x638),   1 -> 0x38 + ((obj+0x14 >> 3) & 1), the
//           56/57 alternation whose counter DOES keep counting (0x640-0x66c),
//           2 -> 0x3c (0x670),       3 -> 0x3d (in the branch's delay slot,
//                                       0x630-0x634), anything else -> 0x35.
//
//     state 2 (0x678) is the same shape with two subs: sub 0 draws 0x36 and
//       advances the CLIP when its counter reaches 4 (0x690-0x6c8); sub 1
//       draws 0x37 and advances the STATE (0x6d4-0x708) -- and still draws
//       that blank, because the advance is followed by the same `0x714` tail.
//
//     state 3 (0x71c) is the epilogue: nothing.
//
//   THE DRAW (every arm tail-calls the helper at file 0x428 with `a1` = the
//   picture and `a0` = the object):
//     file 0x434-0x448  x = [obj+0x54]+0x50 >> 8  (the anchor's world X, 16.8)
//     file 0x44c-0x468  y = ([obj+0x54]+0x54 >> 8) - 0x18
//     file 0x464        builds the transient 2-D context F0x8001F648 on the
//                       stack, then block+0x7c(0x1002, 2), block+0x74(0x140,
//                       0x100), resolve(0x1c70001) and block+0x84 =
//                       F0x8001ED6C(shapeSet, picture, x, y) -- the same
//                       sprite emitter the field's 2-D shapes go through, and
//                       the same per-stage sprite directory the point-sprite
//                       sheet is cut from.  The layer rectangles add their own
//                       `dx`/`dy`, so `drawSprite` at (x, y) is exact.
//
//   THE CONFIGURE HANDLER (file 0x760, SETANIM's third routine slot; it is
//   called with the object and the script's two operands):
//     808 (0x328) -> `li $v0, 0x2 ; sw $v0, 0x50($s0)`        arm word = 2
//     809 (0x329) -> `li $v0, 0x3 ; sw $v0, 0x50($s0)`        arm word = 3
//     810 (0x32a) -> `obj+0x28(2)` = setState(2)               state 2
//     and the shared tail (file 0x7e4-0x814) runs `find(5, operand, -1)` --
//     [0x8004b7bc] = EXE F0x8001810c, the hundred-slot resident-object walk --
//     for `0x328 <= s1 < 0x32a` only, storing the found object at `obj+0x54`.
//     That object is the FIELD CHARACTER whose `+0x4` is the operand: the
//     cast rebuild (fieldstg file 0x8460-0x8490) allocates each one through
//     F0x8009116c, which stores its ID argument at `+0x4` and reads the record
//     id off `+0x8` -- so `808/809` with operand 12 anchor the pictures on the
//     character whose id is 12.  The operand is per-stage script data, and the
//     extractor refuses a member whose recovered scripts disagree.
//
// THE PORT.  One `picture-steps` machine, data-driven by the member JSON:
// states/subs/arms/configure/anchor come out of `wstag785` (mined by
// tools/extract_point_record_actors.py), the drawn pictures are the stage's
// own sheet ids, and the anchor is resolved against the live cast the host
// keeps (web/game.js wires `setPointRecordAnchor`).  Two port decisions,
// stated rather than hidden:
//
//   * the original re-reads obj+0x54's position every blank and draws at the
//     world coordinates the field's own layer scrolls; the walker's field
//     draws camera-relative (web/game.js draws the native intents the same
//     way), so the draw passes (anchor.x, anchor.y + yOff) and the existing
//     `drawStageObjectSprites` path subtracts the camera;
//   * when the find matches nothing the original stores 0 and reads position
//     words off it; the port draws nothing instead of reproducing an
//     out-of-range read.

/** The drawn picture for one arm value, exactly as the 0x610 dispatch reads it. */
function pictureStepArm(m: PointPictureSteps, arm: number, counter: number): number {
    const arms = m.states["1"]?.arms ?? {};
    const a = arms[String(arm)] ?? arms["0"];
    if (!a) return 0x35;
    if ("pic" in a) return a.pic;
    return a.alternate[0] + ((counter >> a.shift) & 1);
}

/** The `picture-steps` configure handler (wstag785 file 0x760-0x828). */
export function firePictureSteps(a: PointActor, subId: number): boolean {
    const m = a.member.pictureSteps;
    const conf = m?.configure?.[String(subId)];
    // The original's return arm: every other operand is consumed and dropped.
    if (!m || !conf) return true;
    if (conf.arm !== undefined) a.arm = conf.arm;
    if (conf.anchor) a.anchor = m.anchor.p1;
    if (conf.state !== undefined) {
        // setState: state <- n, clip/counter/timer cleared (EXE F0x80014274).
        a.state = conf.state;
        a.clip = 0;
        a.counter = 0;
        a.timer = 0;
    }
    return true;
}

/**
 * One blank of the `picture-steps` machine, in the original's own order: the
 * state dispatch, then the sub-slot walk with its fall-through, then the arm
 * dispatch, then the draw.  The counter is a word (`lw`/`sw` of obj+0x14) and
 * every comparison is against a literal 4 the extractor read out of the code.
 */
export function tickPictureSteps(a: PointActor, host: PointHost, delta: number): void {
    const m = a.member.pictureSteps;
    if (!m) return;
    if (a.state === 3) {
        // The epilogue draws nothing.  The LAST picture of a finished run is
        // cleared, which is the visible difference between "state 3" and "the
        // frame that entered it".
        a.pic = null;
        return;
    }
    if (a.state !== 1 && a.state !== 2) {
        // state 0, and any state above 3 the dispatch lets fall into it: one
        // advanceState and nothing else (wstag785 file 0x510-0x524).
        a.state += 1;
        a.clip = 0;
        a.counter = 0;
        a.timer = 0;
        a.pic = null;
        return;
    }
    const st = m.states[String(a.state)];
    const subs = st?.subs ?? [];
    // The fall-through is a loop: a completed sub advances and the SAME blank
    // continues in the next body (file 0x588 -> 0x590, 0x5c8 -> 0x5d0, ...).
    // An ordinary blank is delta 1 -- one blank, one draw -- and the loop
    // makes a catch-up blank with a larger delta carry on from the body it
    // lands in rather than dropping a step.
    for (let guard = 0; guard < 8; guard += 1) {
        if (a.clip >= subs.length) {
            a.pic = null;
            return;
        }
        const sub = subs[a.clip];
        if (!sub) {
            a.pic = null;
            return;
        }
        if ("arm" in sub) {
            // sub 3 / sub 2+: dispatch the arm word.  The alternation's
            // counter keeps counting (file 0x640-0x66c); every other arm
            // leaves it where it was.
            a.pic = pictureStepArm(m, a.arm, a.counter);
            if (a.arm === 1) a.counter += delta;
            break;
        }
        a.counter += delta;
        if (a.counter < m.hold) {
            a.pic = sub.pic;
            break;
        }
        // Counter complete: advance, then continue in the next body.
        if (sub.advance === "clip") {
            a.clip += 1;
            a.counter = 0;
            a.timer = 0;
        } else {
            a.state += 1;
            a.clip = 0;
            a.counter = 0;
            a.timer = 0;
            // advanceState is followed by the same draw tail (file 0x700-0x714),
            // so the completing blank still shows this sub's picture, and the
            // run ends there.
            a.pic = sub.pic;
            break;
        }
    }
    // The anchor is a live object: the original stored its pointer and reads
    // `+0x50`/`+0x54` at draw time, so the port re-resolves the position every
    // blank the machine draws.  `+0x50` is the character's world X in 16.8 and
    // its top byte the pixel (engine/systems/field-character.ts documents the
    // same words for name 5; every makeFieldChar object keeps them the same
    // way -- fieldstg file 0xe5e4-0xe5e8 seeds the pair).
    if (a.pic !== null) {
        a.anchorPos = null;
        if (a.anchor !== null) {
            const an = m.anchor;
            const handle = host.anchor?.(an.type, a.anchor, an.p2);
            if (handle !== null && handle !== undefined) {
                const pos = host.anchorPos?.(handle);
                if (pos) a.anchorPos = { x: pos.x, y: pos.y };
            }
        }
        if (!a.anchorPos) a.pic = null;
    } else {
        a.anchorPos = null;
    }
}

/**
 * The pictures every live `picture-steps` actor drew this blank, as the
 * browser's draw pass reads them: `{pic, x, y}` with `y` already carrying the
 * helper's `-0x18` (`obj+0x54 >> 8` -> screen row): web/effects.js resolves
 * `pic` against the stage's own sheet and y-sorts the entry at `y`.
 */
export function pictureStepDraws(
    stageId: string,
): { pic: number; x: number; y: number }[] {
    const out: { pic: number; x: number; y: number }[] = [];
    for (const a of runtime[stageId] ?? []) {
        if (a.member.machine !== "picture-steps") continue;
        if (a.pic === null || !a.anchorPos) continue;
        const yOff = a.member.pictureSteps?.anchor.yOff ?? 0;
        out.push({ pic: a.pic, x: a.anchorPos.x, y: a.anchorPos.y + yOff });
    }
    return out;
}
