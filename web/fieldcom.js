// FIELDCOM field-UI icons — the real extracted textures (talk balloon, "!",
// ladder/door glyphs, sparkles, rings). Extracted byte-exact from FIELDCOM.BIN
// by tools/extract_fieldcom.py; format + draw math decoded in
// docs/research/ui/fieldcom-sprite-directory-decoded-2026-07-02.md.
//
// Each id is a clip of 1+ layers composited back-to-front at an anchor point
// (the actor's ground position); layer dx/dy place the sprite (balloon rides
// dy=-32 above the anchor, glyphs center inside it, etc.) — same numbers the
// PS1 draw fn (EXE F0x8001ed6c) uses, so composition matches the original.

import {
    fieldShadowRect,
    balloonFace, balloonAnchorY as engineBalloonAnchorY,
    BALLOON_ANCHOR_LIFT, BALLOON_SET_0,
} from "./vendor/engine.js";

let sheets = [null, null];
let semiSheets = [null, null];
let manifest = null;
let shadowImg = null;

export async function loadFieldcom(loadImage) {
    // The character drop shadow is cut from the same FIELDCOM atlas (sub-entry 2,
    // u=112 v=166) but is addressed through the FIELDSTG texture-slot descriptor,
    // not the sprite directory, so it ships as its own 32x16 image. Non-fatal.
    loadImage("assets/ui/field_shadow.png").then((img) => { shadowImg = img; }, () => {});
    manifest = await (await fetch("assets/ui/fieldcom.json")).json();
    sheets = await Promise.all([
        loadImage("assets/ui/fieldcom0.png"),
        loadImage("assets/ui/fieldcom1.png"),
    ]);
    // The blended (STP-bit) texels of the same frames, in the same layout.
    semiSheets = await Promise.all([
        loadImage("assets/ui/fieldcom0_semi.png"),
        loadImage("assets/ui/fieldcom1_semi.png"),
    ]);
}

export function fieldcomReady() {
    return manifest !== null && sheets[0] !== null;
}

// Draw one directory id (all its layers) at world-anchor screen position (x,y).
//
// `clutRow` is the draw context's CLUT-cycle row add (the `sp98` slot): the
// extractor ships those rows as separate "id@row" clips for the ids that use it
// (tools/extract_fieldcom.py CLUT_CYCLE — currently the tree-kick radar rings).
// Row 0 is the plain id, and an id with no variants ignores it.
// A clip's `semi` field is the primitive's blend state: -1 = ABE off (every
// texel written straight), else the tpage ABR mode applied to the texels whose
// CLUT entry has the STP bit set. The extractor already split each frame into
// its plain and its blended texels (same rect on `fieldcomN.png` and
// `fieldcomN_semi.png`), so the two halves just need the two draw states.
//
// ABR modes (GPU): 0 = B/2 + F/2, 1 = B + F, 2 = B - F, 3 = B + F/4. Canvas
// gives exact matches for 0/1/3; mode 2 (subtractive) has no canvas composite
// op and no FIELDCOM clip uses it, so it falls back to the plain draw rather
// than to a look-alike blend.
function applyAbr(ctx, mode) {
    if (mode === 1) { ctx.globalCompositeOperation = "lighter"; return true; }
    if (mode === 3) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.25; return true; }
    if (mode === 0) { ctx.globalAlpha = 0.5; return true; }
    return false;
}

// Dest is not rounded: point-sprite records that draw FIELDCOM clips fill map
// cut-outs and must share the map's camera phase (same as web/effects.js).
export function drawFieldcomIcon(ctx, dir, id, x, y, clutRow = 0) {
    if (!manifest) return;
    const d = manifest[`dir${dir}`];
    const entry = (clutRow ? d?.[`${id}@${clutRow}`] : null) ?? d?.[String(id)];
    const sheet = sheets[dir];
    if (!entry || !sheet) return;
    for (const l of entry.layers) {
        ctx.drawImage(
            sheet, l.x, l.y, l.w, l.h,
            x + l.dx, y + l.dy, l.w, l.h,
        );
    }
    const semiSheet = semiSheets[dir];
    if (!semiSheet || !(entry.semi >= 0)) return;
    const prevOp = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    if (!applyAbr(ctx, entry.semi & 3)) return;
    for (const l of entry.layers) {
        ctx.drawImage(
            semiSheet, l.x, l.y, l.w, l.h,
            x + l.dx, y + l.dy, l.w, l.h,
        );
    }
    ctx.globalCompositeOperation = prevOp;
    ctx.globalAlpha = prevAlpha;
}

// Composed indicator bubble — fully data-driven from the decoded engine:
//   balloon id 0x35 at the anchor,
//   the content glyph from the FIELDSTG glyph-PROGRAM table (manifest
//   "programs": {id, delay} steps, 0xff-terminated rows, extracted from
//   FIELDSTG.PRO 0x800975c0), selected by KIND = the table row,
// Delays are in the engine's tick units (~10 per 60fps frame: ladder 22u ≈ 2
// frames matches the live breakpoint capture).
//
// The 0x23..0x26 cycle measured at (anchor.x, anchor.y + 27) in that same
// capture is NOT part of this composite — corrected 2026-07-27. It is the
// separate, permanently-running party-indicator actor (see below), which draws
// at the owner's ground anchor; the balloon's own −27 offset is what made it
// look like a bubble component.
//
// KIND selection, from FIELDSTG.PRO's own dispatch tables (file 0x198 = ops 5-13,
// file 0x1c0 = ops 1-7), ported in engine/systems/scene-step-ops.ts and checked
// natively in tests/lane-b/scene-step.test.js:
//   op 2/3 (ladder)  -> 2     op 4 (door)  -> 4     op 7 (tool)  -> 5
//   op 1 (door/warp) -> (group>>1) + 6, i.e. kinds 6/7/8/9 = the four plain arrows
//                       (group 1 down, 3 left, 5 up, 7 right); group 4 -> kind 10,
//                       the red lift arrow. `group` is the GRID BYTE's top three bits
//                       (step-load's runner+0x60), NOT the record's own param 3.
//   op 0/9/10/14+    -> 0 ("!")
//   op 5/6/8/11/12/13 -> none. Table A claims 5-13 before table B is consulted, and
//                       8/11/12/13 have their own handlers, so those six ops never
//                       reach the bubble tail at all — an earlier reading that took
//                       table B's dead entries for 5/6 and drew a "!" there was wrong.
export const KIND = {
    exclaim: 0, smoke: 1, ladder: 2, dots: 3, doorGlyph: 4, tool: 5,
    arrowDown: 6, arrowLeft: 7, arrowUp: 8, arrowRight: 9, arrowLift: 10,
};
export const DIR_TO_ARROW_KIND = {
    down: KIND.arrowDown, left: KIND.arrowLeft, up: KIND.arrowUp, right: KIND.arrowRight,
};

const BALLOON = 0x35;
const TICKS_PER_FRAME = 10; // program delay units per 60fps frame

// ── The balloon's vertical anchor ───────────────────────────────────────────
// The anchor, the geometry-set checkpoints and the glyph-row rule are the
// SHARED balloon-actor model in engine/systems/field-balloon.ts (ported from
// fieldstg F0x80088144 / F0x80087F84 / F0x80087E7C). This module only blits it.
// Re-exported so every existing caller and test keeps one import site.
//
// One actor class hangs every balloon in the overworld — the proximity
// indicator, the story bubble and the fishing end-of-cast bubble — all off the
// same ground point and the same 0x1b lift (the owner's own 8.8 hover is the
// only height term; pass null for anyone but a swimming Submarimon).
// Ledger: fishing-q008-balloon-draw-cel-and-owner-anchor-2026-09-13.
export { BALLOON_ANCHOR_LIFT };

/** The balloon's screen row: `groundScreenY - (owner.height >> 8) - 0x1b`. */
export const balloonAnchorY = engineBalloonAnchorY;

// The type-0x16 actor's four-frame resting loop (fieldstg program 0 at RAM
// 0x80097690 = `23 08 24 08 25 08 26 08 ff 00`) — the permanent party-indicator
// orb. Duration 8 units ≈ ORB_FRAMES 60fps frames, the cadence measured in the
// 120-draw breakpoint capture.
const ORB_CYCLE = [0x23, 0x24, 0x25, 0x26];
const ORB_FRAMES = 6;

export function partyIndicatorFrame(tick) {
    return ORB_CYCLE[Math.floor(tick / ORB_FRAMES) % ORB_CYCLE.length];
}

function programStep(program, tick) {
    const total = program.reduce((s, p) => s + Math.max(1, Math.round(p.delay / TICKS_PER_FRAME)), 0);
    let t = tick % total;
    for (const p of program) {
        t -= Math.max(1, Math.round(p.delay / TICKS_PER_FRAME));
        if (t < 0) return p.id;
    }
    return program[0].id;
}

export function drawIndicatorBubble(ctx, x, y, kind, tick) {
    const program = manifest?.programs?.[kind];
    if (!program?.length) return;
    drawFieldcomIcon(ctx, 0, BALLOON, x, y);
    drawFieldcomIcon(ctx, 0, programStep(program, tick), x, y);
}

// ── Story bubble (SETANIM 803..806, the same balloon actor class) ─────────
// The face (checkpoints 0xc8/0xd4/0xdc, cel = counter >> 2, glyph only in phase
// 2) lives in the shared model engine/systems/field-balloon.ts; this is geometry
// set 0, which every bubble the game draws uses. The close's last frame is a
// single 0x37 because the tick that snaps the counter to the third checkpoint
// calls setStage(3) before the draw, and stage 3 returns before it — hence
// `c > gone`, not `>=`. The open arm (0x53f4-0x5414) and the close arm
// (0x543c-0x545c) add the same frame delta, so both share BALLOON_UNIT_FRAMES.
// Ledger: fieldcom-balloon-draws-last-cel-before-state-3-2026-10-02.
export function storyBubbleFrame(openFrames, closeFrames) {
    return balloonFace(BALLOON_SET_0, openFrames, closeFrames);
}

// Draw a story bubble; returns false when there is nothing left to draw.
export function drawStoryBubble(ctx, x, y, row, openFrames, closeFrames, tick) {
    const f = storyBubbleFrame(openFrames, closeFrames);
    if (!f) return false;
    drawFieldcomIcon(ctx, 0, f.cel, x, y);
    const program = manifest?.programs?.[row];
    if (f.glyph && program?.length) drawFieldcomIcon(ctx, 0, programStep(program, tick), x, y);
    return true;
}

// ── Party-indicator actor (FIELDSTG object type 0x16) ───────────────────────
// Bank-0x70 record 0x7013 (opcode 0x50, handler F0x80015d4c) is an ACTION: it
// looks up the single resident type-0x16 object — created in fieldstg's ctor at
// RAM 0x80089f24 and owned by field character 0, i.e. the PLAYER — and calls
// setSub1(3) on it, selecting animation program 3. The object's callback
// (fieldstg 0x80089bdc) then plays packed sound 0x00040009 = ITEM_GET (program
// index 1 or 3 only) and walks the program, drawing each sprite id at the owner
// entity's own world position. Decode:
// docs/research/scripting/bank70-opcode-handlers-decoded-2026-07-27.md
// § "op 0x50 resolved".
//
// Program 3 lives at RAM 0x800976e0 (fieldstg file 0x14a30, blob
// FIELDSTG_D0x00010158) as {u8 spriteId, u8 duration} pairs, 0xff = jump to the
// index in the following byte. These 24 pairs are its one-shot FLARE head,
// transcribed byte-for-byte; the program then falls into the four-step orb loop
// (0x23..0x26 at duration 8 = ORB_CYCLE) and loops there forever via `ff 18`.
const SPARKLE_FLOURISH = [
    [0x23, 3], [0x27, 4], [0x28, 4], [0x2d, 4], [0x2e, 4], [0x2f, 3],
    [0x30, 2], [0x2e, 2], [0x2d, 2], [0x2e, 2],
    [0x30, 2], [0x2e, 2], [0x2d, 2], [0x2e, 2],
    [0x30, 2], [0x2e, 2], [0x2d, 2], [0x2e, 2],
    [0x30, 2], [0x2f, 2], [0x2e, 2], [0x2d, 2],
    [0x28, 3], [0x23, 3],
];
// Duration units → 60fps frames. The original advances the script cursor by the
// engine frame delta at [0x8004df9c], whose scale is NOT decoded; the anchor we
// do have is the live capture of the orb steps (duration 8) running at
// ORB_FRAMES frames each, so one unit = ORB_FRAMES/8 frames. Derived from that
// single measured pair — not an invented cadence.
const SPARKLE_UNIT_FRAMES = ORB_FRAMES / 8;

// Sprite id for `frames` elapsed 60fps frames of program 3's flare head, or null
// once it has finished — at which point the actor rests on the orb loop.
//
// NOTHING stops this actor, and that is correct: ids 0x23..0x26 are the
// PERMANENT party-indicator orb that hovers above the player once a partner is
// downloaded — confirmed against original play, 2026-07-27. Program 3 is a
// starburst flare (0x27..0x30) played over that orb, ending by falling back into
// its loop; `0xff` is only a jump, so no program can terminate, and no code in
// the EXE or any pro overlay ever sets the actor's state +0xc to 2/3 or suspends
// it.
export function sparkleActorFrame(frames) {
    let t = frames;
    for (const [id, dur] of SPARKLE_FLOURISH) {
        const n = Math.max(1, Math.round(dur * SPARKLE_UNIT_FRAMES));
        if (t < n) return id;
        t -= n;
    }
    return null;
}

export const SPARKLE_ACTOR_FRAMES = SPARKLE_FLOURISH.reduce(
    (s, [, dur]) => s + Math.max(1, Math.round(dur * SPARKLE_UNIT_FRAMES)), 0);

// The type-0x16 actor's other two scripts, decoded 2026-09-13 from the program
// table at RAM 0x8009771c (fieldstg image file 0x14a6c):
//   P1 0x8009769c  a 23-step starburst head then a HELD pose (31/2b/29/2a),
//                  `ff 13` jumps back to pair index 19;
//   P2 0x800976cc  a 5-step intro (29/2e/30/28/2c) then the orb loop,
//                  `ff 05` jumps back to pair index 5.
// A step is [spriteId, duration]; 0xff means "jump to pair index = duration".
// Both hold forever, so unlike program 3 they never finish. Their arming notify
// (0x800837ec, manager type 0x32d) is not modelled by the walker yet.
export const SPARKLE_PROGRAMS = {
    1: [
        [0x23, 3], [0x27, 4], [0x28, 4], [0x2d, 4], [0x2e, 4], [0x2f, 3],
        [0x30, 2], [0x2e, 2], [0x2d, 2], [0x2e, 2],
        [0x30, 2], [0x2e, 2], [0x2d, 2], [0x2e, 2],
        [0x30, 2], [0x2e, 2], [0x2d, 2], [0x2e, 2],
        [0x30, 2], [0x31, 2], [0x2b, 2], [0x29, 2], [0x2a, 2],
        [0xff, 19],
    ],
    2: [
        [0x29, 6], [0x2e, 3], [0x30, 3], [0x28, 6], [0x2c, 8],
        [0x23, 8], [0x24, 8], [0x25, 8], [0x26, 8],
        [0xff, 5],
    ],
};

/** The sprite id of a jump-resolved sparkle script at `frames`, or null. */
export function sparkleProgramFrame(program, frames) {
    let cursor = 0, t = Math.max(0, frames);
    for (let guard = 0; guard < 10000; guard++) {
        const step = program[cursor];
        if (!step) return null;
        const [id, dur] = step;
        if (id === 0xff) { cursor = dur; continue; }
        const n = Math.max(1, Math.round(dur * SPARKLE_UNIT_FRAMES));
        if (t < n) return id;
        t -= n;
        cursor += 1;
    }
    return null;
}

// Draw the actor at its owner entity's screen position (the entity's +0x58/+0x5c
// world position — the same ground anchor every other actor draw uses, no extra
// offset table). ONE draw call, so the flare and the resting orb share an anchor
// exactly as they do in the original, where both are just the current step of the
// same script.
//
// `tick` is the shared FIELDCOM clock (drives the orb loop); `flareFrames` is the
// elapsed frames since the program was armed, or null when none is running;
// `program` selects the script (3 = the acquisition flare, 1/2 the other two).
// Returns true while an actor is still playing.
export function drawSparkleActor(ctx, x, y, tick, flareFrames, program = 3) {
    const script = SPARKLE_PROGRAMS[program];
    if (script) {
        const id = sparkleProgramFrame(script, flareFrames ?? 0);
        drawFieldcomIcon(ctx, 0, id ?? partyIndicatorFrame(tick), x, y);
        return true; // programs 1 and 2 hold forever
    }
    const flare = program === 3 && flareFrames != null
        ? sparkleActorFrame(flareFrames) : null;
    drawFieldcomIcon(ctx, 0, flare ?? partyIndicatorFrame(tick), x, y);
    return flare != null;
}

// ── Field character drop shadow ──
//
// Decode: docs/research/field/character-drop-shadow-decoded-2026-07-27.md.
// The native primitive is a 32x16 textured SPRT with ABE = 0 and colour
// 0x808080, i.e. fully opaque with no tint — so this is a plain drawImage at
// the texture's natural size, with no globalAlpha and no composite mode.
// Geometry comes from the engine (engine/systems/field-shadow.ts); this module
// owns nothing but the texture and the blit.
export function drawFieldShadow(ctx, input) {
    if (!shadowImg) return false;
    const r = fieldShadowRect(input);
    ctx.drawImage(shadowImg, r.x, r.y, r.w, r.h);
    return true;
}
