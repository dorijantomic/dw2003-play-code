import { nearestPad, startLaunch, fieldDirectionFromIndex, diveFormForStepOp } from "../vendor/engine.js";
import { launchPads } from "../effects.js";
import { ENTITY_BUCKET } from "../draw-order.js";
import { diveDemoReady } from "../dive-demo.js";
import {
  checkerboardQuads,
  openFrame,
  closeFrame,
  closeWindow,
  coverLevel,
  seamRgb,
  WIPE_TILE,
} from "../stage-wipe.js";
import { subtractLayer, dimFillStyle } from "../screendim.js";
import { VIEW_H, VIEW_W, ZOOM, fade, sfx, state, wideField } from "./vars.js";
import { currentMap } from "./session.js";
import { stepSetup } from "./field-steps.js";
import { S } from "./state.js";
import { prepareStageAssets } from "./map-load.js";
interface StageHandoff {
  to: string;
  spawnX: number;
  spawnY: number;
  dir: string;
  scripted?: boolean;
  stepOp?: number;
}


// Hand the leader to the op-13 launch controller (engine/systems/launch-pad.ts):
// no fade, no screen change — the pad walk, the pad's state-2 animation and the
// quarter-sine flight all happen on the live map.
//
// `pad` is the setup executor's own reading of the record — the destination cell
// and the arrival facing word out of `params[1..3]`, the three words the disc's
// pad controller reads out of the record it was handed (`&record[0xa]`,
// fieldstg.s:0xc7e4 stores that pointer at controller+0x54). Nothing here is
// per-place: a stage supplies its step program and its type-0x17 pad objects.
function beginLaunch(pad) {
    if (state.launch) return;
    // The controller picks the nearest registered type-0x17 pad by the native
    // |dx| + 2*|dy| metric, not the trigger rectangle — so the leader walks to
    // the real pad and the flight starts from its centre.
    const found = nearestPad(launchPads(currentMap()?.id), { x: state.x, y: state.y });
    state.launch = startLaunch({
        // Only the stand point, and only if this stage registered no pad object
        // to stand on: the cell the player is standing on IS the pad cell, which
        // is the whole trigger (fieldstg.s:55f8, the type-7 lookup at the
        // player's own x/y).
        x: state.x, y: state.y, w: 0, h: 0,
        spawnX: pad.spawnX, spawnY: pad.spawnY,
        dir: fieldDirectionFromIndex(pad.dirIndex),
        stepOp: 13, transition: "launch", launchPad: true,
    }, { x: state.x, y: state.y }, found);
    state.iceSlide = null;
    state.moving = false;
    state.stopping = false;
    // Native: the actor method sets facing 0 before installing the handler.
    state.dir = "down";
}

// The disc runs the setup arm EVERY FRAME while the player stands on a live
// step tile, with no button read in it (fieldstg.s:5c94-:5cb8 — see
// engine/systems/trigger-system.ts), so a launch pad fires on contact: walk onto
// one and Junior starts walking to it, exactly as the Spy Satellite pads and the
// ice pads do. The op-13 handler is the disc's only setup opcode that walks the
// leader somewhere by itself (actor->vt[0x158], fieldstg.s:5820); every other
// setup opcode either raises the indicator bubble or hands the tile to the
// button (`playback()`).
//
// Two guards the disc keeps elsewhere: the scene lock its own op 14 raises
// (`[0x80099DD8] = 1` at :0xc7dc, which the driver itself reads at :5c58) and the
// fade, which is the walker's name for a screen handoff in flight.
export function stepSetupTick() {
    if (state.launch || state.handoffHold || fade.dir !== 0) return false;
    const pad = stepSetup()?.effect?.pad;
    if (!pad) return false;
    beginLaunch(pad);
    return true;
}

export function stepSetupBucketTick() {
    if (state.launch || state.handoffHold || fade.dir !== 0) return;
    const id = currentMap().id;
    if (S.stepSetupBucketMap !== id) {
        S.stepSetupBucketMap = id;
        state.playerDrawBucket = ENTITY_BUCKET;
    }
    // A quest scene's own `bucket` step pins the word for the rest of the scene (web/quest-scenes.js). It wins over the
    // tile under the player's feet: on a live op-5 cell the setup arm would write 4 again and pull the player back out
    // from behind the map band. Only the scene's exit clears it (questSceneFxReset restores ENTITY_BUCKET).
    if (state._questBucket != null) {
        state.playerDrawBucket = state._questBucket;
        return state.playerDrawBucket;
    }
    const eff = stepSetup()?.effect;
    if (eff && eff.actor78 != null) state.playerDrawBucket = eff.actor78 & 0xff;
    return state.playerDrawBucket;
}

export function startTransition(exit) {
    if (fade.dir !== 0 || state.diveDemo) return;
    // A launch pad never arrives here: op 13 is a SETUP opcode, so `activeExitAt`
    // does not arm a pad row and the disc's playback op 13 is its own epilogue.
    // Contact is `stepSetupTick()`.
    // Give the engine first refusal on PLAYER-initiated exits: raise OnExit{to}. A gated exit-event
    // (e.g. the gondola's Blue Card check) plays its cutscene and performs its OWN HANDOFF warp — or
    // refuses and keeps us here. Only when no exit-event matches do we run the plain transition.
    // SCRIPTED handoff warps (doStoryHandoff, exit.scripted) bypass this — they are already executing
    // a warp mid-cutscene (engineBridge is busy, so onExit would otherwise suppress the fade).
    if (!exit?.scripted && S.engineBridge && exit?.to && S.engineBridge.onExit({ to: exit.to })) return;
    if (exit?.to) prepareStageAssets(exit.to);
    // A DIVE (step op 9 hole / op 10 water) is not a plain warp. The native
    // launcher F0x8008f3e4 first freezes the field character -- [char+0x2c](char,1),
    // then clears char+0x108 and char+0x60 -- and only then hands the transition
    // to the type-7 cast-rebuild controller. Reproduce the freeze so the player
    // visibly stops on the dock/hole instead of walking into the fade.
    //
    // The Digi-Egg activation cue is packed sound 0x00040004 = DIGIMENT
    // ("Digimental" — the Japanese name for a Digi-Egg). The cast-rebuild body
    // plays it at fieldstg file 0x8774 (RAM 0x8008b424) through the ordinary
    // sound pointer [0x80045c48], immediately after handing the fields the dive
    // launcher seeded — a0 = [obj+0x74] player x, a1 = [obj+0x78] player y,
    // a2 = [obj+0x70] hole/water mode — to the effect spawner F0x80085e0c.
    // Runtime-confirmed: ledger EV-seabed9entry captured
    // `F0x8002006c a0=0x00040004 ra=0x8008b42c` at frame 10 of a Seabed entry,
    // with no other packed sound through frame 360.
    //
    // The presentation those anchors describe is now modelled: the dive hands
    // the screen to the demo controller instead of to the plain fade. The demo
    // owns its own blackout, so the fade is NOT started here — it is started at
    // the far end, because the cyan tile wipe and the location-title card the
    // capture sees at f270-360 belong to the ordinary stage change, not to the
    // demo (decode § 4, "the demo does not own the ~360 frames").
    //
    // (Input is suppressed for the whole presentation by the `state.diveDemo`
    // gate in the movement step; what the freeze adds is the visible stop clip
    // on the dock instead of a mid-stride pose.)
    const diveForm = diveFormForStepOp(exit?.stepOp);
    if (diveForm) {
        state.moving = false;
        state.stopping = true;
        state.stopTime = 0;
        sfx.play!("digiment");
        if (diveDemoReady()) {
            state.diveDemo = {
                // op 9 = hole (Digmon), op 10 = water (Submarimon).
                mode: exit.stepOp === 9 ? "hole" : "water",
                frame: 0,
                accumulator: 0,
                cued: false,
                exit,
                // The particle burst is spawned at the player's own position and
                // keeps drawing after the field cast is gone, so its anchor is
                // captured here and held for the whole run.
                anchorX: state.x,
                anchorY: state.y,
            };
            return;
        }
    }
    fade.dir = 1;
    fade.pending = exit;
}

// The ordinary stage change: load the destination's assets and start the decoded
// wipe. This is what 0x8008B6D4's phase-2 handler reaches once its `+0x68`
// countdown is spent (fieldstg.s:8994/:899c) — the shared tail every field stage
// change goes through, whether the handoff came from an op-1 door (which passes 0
// and loads at once) or from an op-14 pad handoff (which passes 0x3c and waits).
export function runStageHandoff(exit: StageHandoff | undefined) {
    if (exit?.to) prepareStageAssets(exit.to);
    fade.dir = 1;
    fade.pending = exit;
}

// Wide overworld (web/field-view.js): black over the two side strips, as much as the frame rule says
// they are covered (1 - wideField.sides). Box coordinates; the strips are padL wide outside the box.
export function drawWideSideCovers(ctx: CanvasRenderingContext2D | null) {
    const padL = wideField.padL;
    // Covered = black; shown with a menu open (wide overworld) = dimmed by wideField.dim.
    const a = (1 - wideField.sides) + wideField.sides * wideField.dim;
    if (!(padL > 0) || a <= 0) return;
    ctx!.save();
    ctx!.globalAlpha = Math.min(1, a);
    ctx!.fillStyle = "#000";
    ctx!.fillRect(-padL, 0, padL, VIEW_H);
    ctx!.fillRect(VIEW_W, 0, padL, VIEW_H);
    ctx!.restore();
}

// The A28 checkerboard loading wipe's draw arm (fieldstg asm 0x76D4-0x78EC):
// one 64x40 quad per cell the schedule has not yet consumed, at the cell's
// current (slid) position. The grid positions are SCREEN pixels (0..320 x
// 0..240, asm 0x73D4-0x742C), so this is a screen overlay, not a world draw.
//
// The quads the original emits are flat grey 0x80 (asm 0x7828-0x7830) with a
// per-row ramp and a texture/blend the capture could NOT resolve -- the captured
// screen is a sparse lattice of pale marks, not a wall of grey tiles
// (docs/research/field/captures/battle-wipe-2026-09-13/README.md, "the visible
// pattern"). So this draws the DECODED mechanism -- the tiles slide inward and
// vanish -- and leaves the exact colour/blend named as open. Do not read the
// grey here as the original's look.
export function drawCheckerboardWipe(ctx) {
    const cb = state.wipe28;
    if (!cb) return;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "rgb(128,128,128)"; // the draw arm's 0x80
    for (const q of checkerboardQuads(cb))
        ctx.fillRect(q.x * ZOOM, q.y * ZOOM, q.w * ZOOM, q.h * ZOOM);
    ctx.restore();
}

// The ordinary stage-change wipe, translated from fieldstg F0x8008A5E4
// (~/ddw3/asm/dw2003/pro/fieldstg.s file 0x7934) with the frame numbers in
// web/stage-wipe.js and the evidence in .bunny-scratch/wipe-report.md.
//
// Closing: the field stays visible through a window centred on the player, the
// window falls 10 px wide and 7 px tall every frame, and everything outside it
// is covered by the tile lattice at a level that rides 0x400 up to 0x8000 — so
// the outside is black after 8 frames while the window keeps closing for 24
// more. Opening: the cover is a full-height band that pulls in 8 px at each
// edge per frame for 21 frames, so the new field comes back at the two sides
// while ONE black band narrows toward the middle.
//
// Native coordinates: the state, the geometry and the tile size are all 320x240
// (VIEW_W/VIEW_H are the device buffer), so everything is scaled by ZOOM here.
export function drawTransitionWipe(ctx: CanvasRenderingContext2D | null, camX: number, camY: number) {
    const clock = state.wipe;
    if (clock.phase !== 1 && clock.phase !== -1) return;

    // The original centres the window on the player entity's screen position
    // (entity +0x58/+0x5C) and falls back to the screen centre when there is
    // none. state.x/state.y are the player's map position; the camera has
    // already been snapped to the device grid, so the difference is the pixel
    // the player is drawn on.
    const px = Math.round(state.x - camX);
    const py = Math.round(state.y - camY);
    const centred = px >= -VIEW_W && px <= VIEW_W && py >= -VIEW_H && py <= VIEW_H
        ? { x: px, y: py }
        : null;

    if (clock.phase === -1) {
        const f = openFrame(clock.frame);
        if (f.bandW <= 0) return; // the band is gone: the field is fully back
        paintWipeCoverBand(ctx, f.level, f);
        return;
    }

    const f = closeFrame(clock.frame);
    const win = closeWindow(clock.frame, centred?.x, centred?.y);
    if (f.level <= 0) return; // the first frame paints the cover at level 0
    paintWipeCoverAround(ctx, f.level, win);
}

// The two objects this decides between. The field screen builds one 0x1001, four
// 0x1002, a 0x1003 and a 0x1004 bound to the screen rect
// (`exe-decomp/fieldstg_c/F0x8008aa10.c:83-99`), and the tile cover is written
// on the 0x1001 one: `F0x80086CE4(0x1001, unk50)` at fieldstg file 0x7BA8
// (close) and `F0x80086CE4(0x1001, 0x8000)` at 0x7CD8 (open).
//
// Which object the WIPE's own rect goes on is the polarity:
//
//   state 1 (close)  unk110(x, y) and unk114(w, h) on the 0x1002 object
//                   (0x7B44/0x7B4C) -- a DIFFERENT object from the one the cover
//                   is drawn through, so that rect is the window the field is
//                   still visible through and the cover fills everything
//                   AROUND it.
//   state 2 (open)   unk110(w, 0) and unk114((0xA0 - w) * 2, (0x78 - 0) * 2) on
//                   the 0x1001 object (0x7C18-0x7C20, 0x7C48-0x7C50) -- the SAME
//                   object the cover is drawn through, so that rect bounds the
//                   drawn cover: ONE full-height black band that narrows toward
//                   the middle, with the new field back at the two sides.

// One frame of the close: the 64x64 lattice, darkened by the level, clipped to
// the screen AROUND the window the field still shows through.
function paintWipeCoverAround(ctx, level: number, clear: { x: number; y: number; w: number; h: number; }) {
    const cx = clear.x * ZOOM, cy = clear.y * ZOOM;
    const cw = clear.w * ZOOM, ch = clear.h * ZOOM;
    // Four bands around the window, which is what the original's frame draws:
    // the cover is everywhere the field does not show through.
    // With the wide overworld the field goes on padL past both box edges; the cover does too.
    const L = -wideField.padL, R = VIEW_W + wideField.padL;
    const outside = [
        [L, 0, R - L, cy],
        [L, cy + ch, R - L, VIEW_H - (cy + ch)],
        [L, cy, cx - L, ch],
        [cx + cw, cy, R - (cx + cw), ch],
    ];
    subtractLayer(ctx, L, 0, R - L, VIEW_H, (layer) => {
        layer.fillStyle = dimFillStyle(coverLevel(level));
        for (const [x, y, w, h] of outside)
            if (w! > 0 && h! > 0) layer.fillRect(x, y, w, h);
    });
    paintWipeSeams(ctx, level, outside);
}

// One frame of the open: the same lattice and level, clipped to the INSIDE of
// the band, so the two screen edges show the field that just arrived.
function paintWipeCoverBand(ctx, level: number, f: { w: number; bandX: number; bandW: number; bandH: number; level: number; done: boolean; }) {
    const bx = f.bandX * ZOOM, bw = f.bandW * ZOOM, bh = f.bandH * ZOOM;
    // The subtraction is scoped to the band itself: `subtractLayer` subtracts
    // everything the painter leaves non-black, so filling the whole screen and
    // then drawing the band would cover the two edges as well -- the opposite
    // wipe. The painter works in the caller's own coordinates (the region is
    // shifted onto the layer's origin for it), so the rect is stated in screen
    // pixels here, not at the layer's origin.
    subtractLayer(ctx, bx, 0, bw, bh, (layer) => {
        layer.fillStyle = dimFillStyle(coverLevel(level));
        layer.fillRect(bx, 0, bw, bh);
    });
    paintWipeSeams(ctx, level, [[f.bandX, 0, f.bandW, f.bandH]]);
}

// The lattice's 1-px seams: a line on every 64-px cell edge, drawn additively on
// top of the cover at the RGB the rig capture measured for them once the cover is
// at its cap, clipped to the regions the cover owns on this frame.
function paintWipeSeams(ctx, level, regions) {
    const [r, g, b] = seamRgb(level);
    if (r! + g! + b! <= 0) return;
    ctx.save();
    ctx.beginPath();
    for (const [x, y, w, h] of regions)
        if (w > 0 && h > 0) ctx.rect(x * ZOOM, y * ZOOM, w * ZOOM, h * ZOOM);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    const t = ZOOM * WIPE_TILE;
    const L = -Math.ceil(wideField.padL / t) * t, R = VIEW_W + wideField.padL;
    for (let x = L; x <= R; x += t) ctx.fillRect(x, 0, 1, VIEW_H);
    for (let y = 0; y <= VIEW_H; y += t) ctx.fillRect(L, y, R - L, 1);
    ctx.restore();
}
