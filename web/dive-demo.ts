// Renderer for the Digi-Egg dive transition — the full-screen presentation that
// plays when Junior drops into a hole (Digmon) or enters water (Submarimon).
//
// All timing, cell selection and sequencing lives in engine/systems/dive-demo.ts.
// This file owns nothing but the extracted artwork and the blit, in the same
// split every other surface uses.
//
// Art: tools/extract_dive_demo.py cuts SSUBDEMO.BIN / SDIGDEMO.BIN into
// web/assets/effects/dive/. Decode:
// docs/research/field/dive-demo-transition-decoded-2026-07-29.md.

import { drawFieldcomIcon } from "./fieldcom.js";
import { DEMO_PACK } from "./vendor/engine.js";

// The demo cells are authored in the PS1's 320x240 screen space — the extracted
// layer dx/dy ARE screen coordinates, which is why the native code draws every
// cell at (0,0) with no anchor. The walker's view is 320x240 too since
// 2026-09-04 (ledger UI-DISPLAY-EXTENT-001), so this scales by exactly 1 and
// centres to (0,0): the art lands as drawn. Until then the view was 320x224 and
// this cropped 8 lines off the top and bottom to cover it. Keep the cover-fit
// rather than a stretch, so a future non-4:3 view cannot distort the pool or
// the ground. This draws the dig scene as well as the dive -- one pack each.
const AUTHORED_W = 320;
const AUTHORED_H = 240;

let packs = null;
let sheets = {};      // packName -> { opaque, semi }

export async function loadDiveDemo(loadImage) {
    const base = "assets/effects/dive/";
    packs = await (await fetch(base + "dive_demo.json")).json();
    const entries = await Promise.all(Object.entries(packs).map(async ([name, p]) => {
        const [opaque, semi] = await Promise.all([
            loadImage(base + p.sheet),
            loadImage(base + p.semiSheet),
        ]);
        return [name, { opaque, semi }];
    }));
    sheets = Object.fromEntries(entries);
}

export function diveDemoReady() {
    return packs !== null;
}

/**
 * Paint one demo frame's cells, back to front, over the whole view.
 *
 * `cells` comes straight from the engine and already has the backdrop first.
 * Every clip in both packs is flagged opaque in the source data, so there is no
 * blended pass here — unlike the particles, which are additive.
 */
export function drawDiveDemoCells(ctx, mode, cells, viewW, viewH) {
    if (!packs || !cells?.length) return;
    const pack = packs[DEMO_PACK[mode]];
    const sheet = sheets[DEMO_PACK[mode]];
    if (!pack || !sheet) return;

    const scale = Math.max(viewW / AUTHORED_W, viewH / AUTHORED_H);
    const offX = (viewW - AUTHORED_W * scale) / 2;
    const offY = (viewH - AUTHORED_H * scale) / 2;

    for (const cell of cells) {
        const clip = pack.clips[String(cell)];
        if (!clip) continue;
        for (const l of clip.layers) {
            ctx.drawImage(
                sheet.opaque, l.x, l.y, l.w, l.h,
                Math.round(offX + l.dx * scale), Math.round(offY + l.dy * scale),
                Math.ceil(l.w * scale), Math.ceil(l.h * scale),
            );
        }
    }
}

/**
 * The four particle channels, drawn at the player's ground anchor.
 *
 * These are ordinary FIELDCOM directory-1 clips, so they go through the shared
 * icon renderer and pick up its per-texel additive blending — which is what
 * makes the glow read as light rather than as flat blobs.
 *
 * The anchor is the player's own position while the field is still alive. Once
 * the cast is torn down there is no field left to anchor to, so the caller
 * freezes the last on-screen position and keeps passing it; whether the native
 * fields are screen- or world-space is recorded unresolved as DIVE-Q006.
 */
export function drawDiveParticles(ctx, cells, x, y) {
    for (const cell of cells) drawFieldcomIcon(ctx, 1, cell, x, y);
}
