/**
 * THE live field character: the one resident object the field overlay names 5,
 * and the single `+0x54` word three stage objects drive.
 *
 * ── what object 5 IS, read from its own allocator call ─────────────────────
 *
 * fieldstg file 0xe4bc builds it and nothing else does:
 *
 *     .L0x0000e4e0: lui $a0, 0x8009
 *     .L0x0000e4e4: addiu $a0, 0xfb0        # 0x80090FB0 -- the TICK
 *     .L0x0000e4e8: li $a1, 0x15c          # the object is 0x15C bytes
 *     .L0x0000e4ec: li $a2, 0x10
 *     .L0x0000e4f0: li $a3, 0x5            # and it is REGISTERED AS NAME 5
 *     .L0x0000e4fc: jal F0x800143dc        # EXE's resident-object allocator
 *
 * The first allocator argument is the tick, so the runner at `0x80090FB0`
 * (fieldstg file 0xe300..0xe4b8) is this object and no other.  It is the
 * FIELD CHARACTER -- the Digimon you are leading -- because two other routines
 * look name 5 up and immediately read its position words:
 *
 *   * fieldstg file 0xf8f8-0xf938 (F0x800925a8): `li $a0,5` /
 *     `lw $v0,-0x4844($v0)` = [0x8004b7bc] / `jalr`, then
 *     `lw $a3, 0x58($v0)` / `lw $t0, 0x5c($v0)` -- it hands the FOUND object's
 *     two pixel words straight to the zone checker as the player's x/y.
 *   * fieldstg file 0x93c8 (F0x8008c078): the same lookup, and the caller
 *     documents the pair as "the character's x/y at the moment of the
 *     transition".
 *
 * ── so what `+0x54` MEANS: the character's own world Y, in 16.8 ────────────
 *
 * The constructor copies the map origin into `+0x50`/`+0x54` and then splits
 * each into a whole-pixel and a fraction half:
 *
 *     .L0x0000e744: addiu $v0, -0x6280      # 0x80099D80, the field's own state
 *     .L0x0000e748: lw $t0, 0x64($v0)
 *     .L0x0000e74c: lw $t1, 0x68($v0)
 *     .L0x0000e750: sw $t0, 0x50($s2)       # +0x50 = the X origin
 *     .L0x0000e754: sw $t1, 0x54($s2)       # +0x54 = the Y origin
 *     ...
 *     .L0x0000e764: lw $v0, 0x50($s2)
 *     .L0x0000e768: lw $v1, 0x54($s2)
 *     .L0x0000e76c: sra $v0, 0x8            # X >> 8
 *     .L0x0000e770: sra $v1, 0x8            # Y >> 8
 *     .L0x0000e774: sw $v0, 0x58($s2)       # +0x58 = X in whole pixels
 *     .L0x0000e77c: sw $v1, 0x5c($s2)       # +0x5c = Y in whole pixels
 *
 * and the per-frame runner does the same split again, with the character's
 * jump height taken off Y first (its own lines, file 0xe3d8-0xe3fc):
 *
 *     .L0x0000e3d8: lw $v0, 0x50($s0)
 *     .L0x0000e3dc: lw $v1, 0x54($s0)
 *     .L0x0000e3e0: lw $a0, 0x90($s0)     # the jump height
 *     .L0x0000e3e4: sra $v0, 0x8
 *     .L0x0000e3e8: subu $v1, $a0        # Y - height
 *     .L0x0000e3ec: sw $v0, 0x58($s0)     # +0x58
 *     .L0x0000e3f4: sra $v1, 0x8
 *     .L0x0000e3fc: sw $v1, 0x5c($s0)     # +0x5c
 *
 * so `+0x50`/`+0x54` are the character's WORLD X and Y in 16.8 fixed point
 * (0x100 = one pixel) and `+0x58`/`+0x5c` are the pixels the camera and the
 * sprite actually use.  `+0x90` is the height the character is lifted by while
 * it jumps (the 0x100-a-blank rise in case 0x41), never a fourth coordinate.
 *
 * Two more confirmations that this word is a position and not a timer or a
 * counter, both from the object's own animate routine:
 *
 *   * the shadow it builds every frame.  The runner names the callback as the
 *     PAIR `lui $a1, 0x8009` / `addiu $a1, -0xad4` = 0x8008F52C (file
 *     0xe434-0xe438) and hands it the character with its `+0x5c` (file 0xe444),
 *     and that routine (file 0xc87c) reads BOTH halves and subtracts the camera
 *     origin it asks the 0x1002 service for: `file 0xc8d0 lw $t0, 0x58($s1)` /
 *     `0xc8d4 lw $t1, 0x5c($s1)` / `0xc8e0 lw $v0, 0x11c($s5)`.  Screen
 *     position, camera-relative.
 *   * every move adds a displacement to it: the animate routine the runner calls
 *     (`jal 0x8008fed0` at file 0xe3d0) reaches the direction helper through
 *     [0x8009b70c] and adds the pair it returns to +0x50 and +0x54 (file
 *     0xd310-0xd344 and 0xd3b4-0xd3e8), and case 0x44 jumps with
 *     `arg0->unk54 = arg0->unk54 + 0x1800 + arg0->unk94` -- 0x1800 is 24 pixels.
 *
 * ── why this module is a DISPLACEMENT and not the map position ────────────
 *
 * The walker's player position already IS this word's pixel part: `state.y` is
 * the character's map Y and the camera, the sprite and every proximity test
 * read it.  So the original's `+0x54` writes are ported as the whole-pixel
 * displacement the three drivers produce, applied to `state.y`, and the module
 * keeps the sub-pixel remainder the original keeps in the low eight bits.  A
 * drive of `+0x40` a blank (0.25 px, s680) therefore crosses into a real pixel
 * on the fourth blank, which is when the original's own `+0x5c` changes.
 *
 * That also fixes what a save does.  The whole-pixel part is folded into
 * `state.y`, which the save block already stores, so a save taken during a
 * drive loses at most the 0.75 px still in the remainder -- not the whole run.
 */

import { FIELD_TICK_RATE } from "./field-movement.ts";

/** One character pixel in the original's fixed point (`0x100`). */
export const FIELD_CHAR_ONE_PIXEL = 0x100;

/** The fixed-point scale: the original's `sra $v0, 0x8`. */
export const FIELD_CHAR_SHIFT = 8;

/**
 * The whole-pixel displacement the stage objects have produced, and the
 * sub-pixel remainder of the same quantity.  `y` is the displacement in 16.8,
 * so `y >> 8` is exactly what the original's `+0x5c` reads.
 */
let y = 0;
/** The pixel part already folded into the walker's player position. */
let applied = 0;

function pixelPart(fixed: number): number {
    // `sra`, not a truncating shift: a negative displacement floors, as the
    // original's arithmetic right shift does.
    return Math.floor(fixed / (1 << FIELD_CHAR_SHIFT));
}

/** The character's world-Y displacement in 16.8 fixed point (`+0x54`). */
export function fieldCharY(): number {
    return y;
}

/**
 * Add a 16.8 displacement to `+0x54`, exactly as `addu $a0, $v1` /
 * `sw $a0, 0x54($v0)` does in the three drivers.
 */
export function fieldCharAddY(delta: number): number {
    return fieldCharSetY(y + delta);
}

/**
 * Assign `+0x54` outright -- s261's clip machine saves the word and writes
 * `saved + delta` back into it.  Both return the new whole-pixel part (`+0x5c`),
 * which is NOT the same as the step a caller owes: take the step through
 * `fieldCharPendingPixels`, or a caller that writes and then reads would take it
 * twice.
 */
export function fieldCharSetY(fixed: number): number {
    y = fixed | 0;
    return pixelPart(y);
}

/**
 * Take the WHOLE pixels the drives have produced since the last call, and mark
 * them taken.  The field draw asks once per frame BEFORE it reads the camera, so
 * a driver's write lands in the same frame the original showed it in, and asks
 * again on the next frame to get nothing.
 */
export function fieldCharPendingPixels(): number {
    const now = pixelPart(y);
    const step = now - applied;
    if (step !== 0) applied = now;
    return step;
}

/**
 * Drop the accumulated displacement -- on a stage change, which is where the
 * original destroys the object and the next stage's constructor re-reads the
 * map origin into `+0x50`/`+0x54` (file 0xe744-0xe760).
 */
export function resetFieldChar(): void {
    y = 0;
    applied = 0;
}

/** What a verifier and `window.__fieldChar` read. */
export function fieldCharState(): {
    /** `+0x54`, the displacement in 16.8. */
    y: number;
    /** `+0x54 >> 8`, the pixel the camera and the sprite use. */
    pixels: number;
    /** whole pixels not yet folded into the player position. */
    pending: number;
    /** one PAL blank in seconds, the clock these drives count. */
    tickSeconds: number;
} {
    return {
        y,
        pixels: pixelPart(y),
        pending: pixelPart(y) - applied,
        tickSeconds: 1 / FIELD_TICK_RATE,
    };
}
