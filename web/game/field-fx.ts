import {
  fieldDirectionIndex,
  METER_BAND,
  RADAR_FRAME,
  RADAR_X,
  RADAR_Y,
  radarClutRow,
  diveDemoFrame,
  DEMO_START as DIVE_DEMO_START,
} from "../vendor/engine.js";
import { renderUnderwater, UW_H, UW_W } from "../fishing-underwater.js";
import { fieldcomReady, drawFieldcomIcon } from "../fieldcom.js";
import { drawDiveDemoCells, drawDiveParticles } from "../dive-demo.js";
import { paintScreenDim } from "../screendim.js";
import { S } from "./state.js";
import { currentMap } from "./session.js";
import {
  FISH_BAR_FRAME,
  FISH_BAR_MARKER,
  FISH_BAR_TRACK,
  FISH_BAR_X,
  FISH_BAR_Y,
  VIEW_H,
  VIEW_W,
  ZOOM,
  _DIR8_VEC,
  ctx,
  lastCam,
  state,
} from "./vars.js";

// "V" toggles this: a facing arrow + mode/clip/frame label over every rendered sprite, so
// orientation and animation-source bugs (idle vs. clip vs. walk; wrong facing) are visible
// in-game without needing a screenshot round-trip to diagnose.
// White oval bubble, black outline, pointed tail — pixel-sampled from a verified PS1
// savestate ("!" over an NPC's head near Genji's tower). World-space, anchored above
// the actor. See docs/research/ui/dialogue-chrome-decoded-2026-07-01.md.
// Shared clock for FIELDCOM icon animation (sparkle/glyph steps are counted in
// emulator frames, so tick at the PS1's 60fps regardless of rAF rate).
export function fieldcomTick() {
    return Math.floor(performance.now() / (1000 / 60));
}

// ── Authentic field-trigger indicator (story-step VM, decoded from disasm) ──

// The cone FIELDSTG.PRO's 8x8 byte table at RAM 0x80097624 is read as
// cone[byte >> 5][the player's facing]; tools/extract_step_enable_table.py verified all
// eight rows are the ±1 cone {g-1, g, g+1}. Only ops 0-4, 7 and >= 15 consult it
// (fieldstg.s:5650-5680); ops 5, 6 and 8-14 are live whatever the facing, which is why
// an op-8 cutscene still fires standing on the tile facing away from it.
// The step under the player, iff both flag gates pass AND the facing cone lets it, with
// the icon the disc would draw there.
//
// This is now the ENGINE's read, not a second copy of it: the trigger system
// (engine/systems/trigger-system.ts) owns the grid sample, the cone and the two flag
// gates, and engine/systems/scene-step-ops.ts owns the op -> kind table read out of
// FIELDSTG.PRO's dispatch tables (file 0x198 ops 5-13, file 0x1c0 ops 1-7). The engine
// answers "which icon" exactly as it answers "start the event", so the bubble and the
// op's behaviour cannot drift apart. The old local table was wrong in three ways: it
// read op 1's arrow from the record's param 3 instead of the grid byte's group,
// it drew a "!" for ops 5/6 (which table A intercepts before the bubble tail), and it
// drew nothing for ops 0/9/10/14+ (which all draw kind 0).
//
// Returned shape: {step, group, op, kind}. `kind` is null for ops that draw nothing.
export function activeTriggerStep() {
    const ts = S.engineTriggerSystem;
    if (!ts) return null;
    return ts.indicator(currentMap().id, state.x, state.y, fieldDirectionIndex(state.dir));
}

export function drawFishing(ctx: CanvasRenderingContext2D | null, camX: number, camY: number) {
    const f = state.fishing;
    if (!f) return;

    // The underwater inset (three.js, GPU). Read-only on `f`; null (no WebGL, page hidden) = nothing drawn.
    const uw = renderUnderwater(f, currentMap().id, state.fishingExtras, performance.now() / 1000);
    if (uw) {
        ctx!.drawImage(uw, 0, uw.height - UW_H, UW_W, UW_H, 6, 6, UW_W, UW_H);   // the inset lives in the shared canvas bottom-left corner
        ctx!.strokeStyle = "#0a2a3a";
        ctx!.lineWidth = 2;
        ctx!.strokeRect(5, 5, 130, 98);
    }

    // Nothing is drawn during the settle: the original's draw block sits after
    // the meter update, and the settle phase returns before it ever gets there.
    //
    // And nothing once the cast has resolved: the float object is gone by then,
    // so the bar, the marker and the float all clear BEFORE the angler's result
    // pose and its bubble — which is the order the 2026-07-29 capture saw
    // (presentation clearing around frames 520-625, bubble at 576).
    if (f.run.phase === "settle" || f.castOver || !fieldcomReady()) return;

    // The float, out on the water where the cast put it — one of four 16x16
    // FIELDCOM cells. It is NOT a flicker: the cell is `0x60 + ((tick % 48)/12)`
    // off the display tick (file 0xa95c), so the four run in order, twelve
    // units each — a ripple on the water.
    drawFieldcomIcon(
        ctx, 0, f.run.cell,
        Math.round(f.x - camX), Math.round(f.y - camY),
    );

    drawFieldcomIcon(ctx, 1, FISH_BAR_FRAME, FISH_BAR_X, FISH_BAR_Y);
    drawFieldcomIcon(ctx, 1, FISH_BAR_TRACK + f.run.pattern, FISH_BAR_X, FISH_BAR_Y);
    drawFieldcomIcon(
        ctx, 1, FISH_BAR_MARKER,
        FISH_BAR_X + Math.floor(f.run.meter / METER_BAND), FISH_BAR_Y,
    );
}

/**
 * The tree-kick radar card — the REAL FIELDCOM art, composed the way the
 * original does.
 *
 * F0x8008c6b8 (fieldstg file 0x9b1c-0x9ba8) resolves FIELDCOM sub-entry 1 and
 * makes two draw calls at the SAME anchor (0xf8, 0xa8):
 *
 *   id 0x50/0x51/0x52   the rings, picked by how far off the live tree is
 *   id 0x4f             the card behind them
 *
 * The rings go in FIRST and the card SECOND, and within one OT layer a later
 * draw renders BEHIND an earlier one — so the card is the backdrop and the rings
 * sit on it. Before both it pushes `(timer / rate) % 10` into the draw context's
 * CLUT-cycle row: the rings are concentric bands of one palette, so rotating the
 * palette makes them ripple outward, three frames per row when the tree is very
 * close and twelve when it is far. Those ten rows ship as "id@row" clips
 * (tools/extract_fieldcom.py CLUT_CYCLE).
 */
export function drawTreeRadar(ctx: CanvasRenderingContext2D | null) {
    const r = state.treeRadar;
    if (!r || !fieldcomReady()) return;
    drawFieldcomIcon(ctx, 1, RADAR_FRAME, RADAR_X, RADAR_Y);
    drawFieldcomIcon(ctx, 1, r.icon, RADAR_X, RADAR_Y, radarClutRow(r));
}

// The Digi-Egg dive transition. Drawn inside the camera transform, so the
// coordinates here are logical screen pixels (VIEW_W/VIEW_H at ZOOM 1).
//
// Order matters and follows the original's own staging:
//   1. Once the demo begins, the native controller has DESTROYED the whole
//      field cast — so the field behind is blacked out rather than left
//      showing around the edges of the demo artwork.
//   2. The demo cells (backdrop first, animated layers over it).
//   3. The particle burst, which is a separate object with its own clock: it
//      starts while the field is still fully visible and keeps drawing on top
//      of the demo afterwards.
//   4. The blackout, which covers the fade out, the load gap and the fade in.
export function drawDiveTransition(ctx: CanvasRenderingContext2D | null, camX: number, camY: number) {
    const d = state.diveDemo;
    if (!d) return;
    const f = diveDemoFrame(d.mode, d.frame);
    const viewW = VIEW_W / ZOOM, viewH = VIEW_H / ZOOM;

    if (d.frame >= DIVE_DEMO_START) {
        ctx!.fillStyle = "#000";
        ctx!.fillRect(0, 0, viewW, viewH);
    }
    if (f.demoCells) drawDiveDemoCells(ctx, d.mode, f.demoCells, viewW, viewH);
    if (f.particleCells.length && fieldcomReady()) {
        drawDiveParticles(
            ctx, f.particleCells,
            Math.round(d.anchorX - camX), Math.round(d.anchorY - camY),
        );
    }
    if (f.blackout > 0) {
        // The field's blackout is the same subtractive wash every menu uses
        // (fieldstg F0x80089f7c is a copy of the shared dim quad), so it goes
        // through the shared painter rather than an alpha fill.
        paintScreenDim(ctx!, Math.min(f.blackout, 1) * 255, viewW, viewH);
    }
}

export function drawAnimDebug(entries) {
    ctx!.save();
    ctx!.font = "9px monospace";
    ctx!.textAlign = "center";
    for (const { x, y, label, info } of entries) {
        const sx = Math.round(x - lastCam.x);
        const sy = Math.round(y - lastCam.y);
        const [vx, vy] = _DIR8_VEC[info.dir] ?? [0, 1];
        ctx!.strokeStyle = "#0f0";
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(sx, sy - 6);
        ctx!.lineTo(sx + vx * 16, sy - 6 + vy * 16);
        ctx!.stroke();
        const modeTxt =
            info.mode === "clip" ? `clip:${info.clipId}`
            : info.mode === "idle" ? `idle:${info.clipId}`
            : info.mode;
        const text = `${label} ${info.dir} ${modeTxt} f${info.frame}`;
        ctx!.fillStyle = "#000";
        ctx!.fillText(text, sx + 1, sy - 33);
        ctx!.fillStyle = "#0f0";
        ctx!.fillText(text, sx, sy - 34);
    }
    ctx!.restore();
}
