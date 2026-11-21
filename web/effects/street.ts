import {
  streetVehicleDraws,
  streetScreenDraws,
  streetGlowDraws,
  streetPropDraws,
  stingerPopupDraws,
} from "../vendor/engine.js";
import { nativeStage } from "../native-stage.js";
import { IN_FRONT_OF_ENTITIES, pushComposite, BEHIND_ENTITIES } from "../draw-order.js";
import { ensureScreenAtlas, ensureSemiSheet, ensureSheet, screenAtlases } from "./point-records.js";
import { drawSprite } from "./draw.js";
import { S } from "./state.js";

// Street vehicles — the cars that drive across the street during a broadcast
// (engine/systems/street-vehicles.ts, translated from wstag780's broadcast
// object 0x800a6dc4 and car tick 0x800a5ec0). One frame of movement per
// rendered frame; the draw reuses the stage's own TMPK clips, which is what
// the original's draw callback resolves too (a car sprite id IS a TMPK clip
// id). Decode:
// docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md
/** Verification hook: the live cars on a stage (sprite id + map pixel). */
export function streetVehicleProbe(stageId) {
    return streetVehicleDraws(stageId);
}

// Street screens — the wall and column screens a stage overlay builds for
// itself (engine/systems/street-screens.ts, translated from wstag780's
// screen-content driver 0x800a72b0 and its 40-quad builder 0x800a6fbc). Each
// screen is two quads: a lit frame drawn semi-transparent and the animated
// content inside it. The quads carry page-relative texture coords, so the baked
// page sheet (tools/extract_screen_pages.py) supplies the pixels and each quad's
// palette supplies the blending mode — the same two steps drawNativeIntents takes
// for the interpreter's capture of the original driver.
// Decode: docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md
export function streetScreenProbe(stageId) {
    return streetScreenDraws(stageId);
}

export function drawStreetScreens(ctx: CanvasRenderingContext2D | null, stageId, camX: number, camY: number, drawables: { y: number; draw: () => void; }[], quads) {
    if (!quads?.length) return;
    ensureScreenAtlas(stageId);
    const screen = screenAtlases[stageId];
    if (!screen) return;
    for (const q of quads) {
        const combo = screen.data.combos[`${q.texpage}:${q.clut}`];
        if (!combo) continue;
        drawables.push({
            y: Math.max(q.y[0], q.y[1], q.y[2], q.y[3]),
            draw: () => drawScreenQuad(ctx, screen.img, combo, q, camX, camY),
        });
    }
}

// The traffic-light glows a street overlay builds for itself
// (engine/systems/street-lights.ts: the overlay's glow object 0x800a652c and its
// traffic-light writer 0x800a67a4) and the three lamp glows the broadcast object
// draws above the street (engine/systems/street-vehicles.ts, the overlay's
// street-prop drawer 0x800a6b4c). Both use the stage's own TMPK clips, which is
// what the original's draw resolves too — a clip id IS a TMPK clip id.
// Decode: docs/research/field/asuka-city-cars-and-news-screens-2026-10-04.md
export function streetGlowProbe(stageId) {
    return { glows: streetGlowDraws(stageId), props: streetPropDraws(stageId) };
}

/** One clip at one map pixel, on the shared point-sprite sheet. */
function drawClip(ctx, sheet: HTMLImageElement, semiSheet, layers, x: number, y: number) {
    drawSprite(ctx, sheet, layers, x, y, semiSheet);
}

export function drawStreetGlows(ctx: CanvasRenderingContext2D | null, stageId, camX: number, camY: number, drawables: { y: number; draw: () => void; }[]) {
    if (nativeStage(stageId)) return;
    const s = S.data?.[stageId];
    if (!s) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    // The six corner glows ARE y-sorted: the overlay queues each through the
    // draw-context's own ordering list at the glow's y (wstag780 file 0x864,
    // slot +0x14c, a3 = obj+0x58), exactly as a point record with an `ysort`
    // baseline does -> key = the glow's own y.
    const glows = streetGlowDraws(stageId).map((g) => ({
        clip: g.clip, x: g.x, y: g.y, key: g.y, tag: "corner-glow",
    }));
    // The broadcast's street-prop drawer (0x800a6b4c) is a FIXED-bucket draw:
    // `sp94(0x1002, 2, …)` at file 0xd94, ordering bucket 2 = IN FRONT of every
    // entity. The walker used to y-sort these at their own y (179..268), which
    // put the lamp glows behind their own pole housing (ysort 231/303) -- a lamp
    // re-ordering against its own housing -- and let a glow sort around the
    // entering actors.
    const props = streetPropDraws(stageId).map((p) => ({
        ...p, key: IN_FRONT_OF_ENTITIES, tag: "street-prop",
    }));
    for (const e of [...glows, ...props]) {
        const layers = s.sprites[String(e.clip)];
        if (!layers) continue;
        pushComposite(drawables, e.key, [
            () => drawClip(ctx, sheet, semiSheet, layers, e.x - camX, e.y - camY),
        ], e.tag);
    }
}

// The corner stinger (engine/systems/stinger-popup.ts, the overlay's popup
// object 0x800a61c8 and its draw 0x800a6130): one TMPK clip at a fixed map
// pixel, on ordering-table bucket 7 — over the map, behind the entities.
export function stingerPopupProbe(stageId) {
    return stingerPopupDraws(stageId);
}

export function drawStingerPopup(ctx: CanvasRenderingContext2D | null, stageId, camX: number, camY: number, drawables: { y: number; draw: () => void; }[]) {
    if (nativeStage(stageId)) return;
    const entries = stingerPopupDraws(stageId);
    if (!entries?.length) return;
    const s = S.data?.[stageId];
    if (!s) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    for (const e of entries) {
        const layers = s.sprites[String(e.clip)];
        if (!layers) continue;
        // The corner stinger submits on ordering bucket 7 -- over the map,
        // behind every entity (wstag780 file 0x3d4). The walker used to y-sort
        // it at its own y among the entities.
        pushComposite(drawables, BEHIND_ENTITIES, [
            () => drawClip(ctx, sheet, semiSheet, layers, e.x - camX, e.y - camY),
        ], "stinger");
    }
}

// ── the resident 2D draw-context service's markers ──────────────────────────
//
// s805's ring of twenty-seven markers and s820's four are the two stage users of
// the 0x1002 draw-context service the walker can drive (engine/systems/
// draw-context.ts, engine/systems/shape-annotator.ts). The service hands each one
// a shape request -- a shape id, a CLUT row, a position and a draw order -- and
// the shape is a rectangle out of the stage's own sprite directory, the TMPK
// member 0 every ambient point sprite and launch pad also reads
// (docs/research/field/point-sprite-ambient-system.md). `annotatorShapeQuads`
// resolves the id to its rectangles and their palettes; the texels of every id
// the two members ask for are already cut into `assets/effects/sNNN.png` by
// `tools/extract_point_sprites.py`, with the `sid@ctr` palette variants the disc
// pass's CLUT row selects. So this is the same sheet, the same drawSprite and
// the same semi sheet the pads and the scenery use -- one atlas, one draw path.
//
// Nothing here invents a primitive: GP0(64h)/GP0(66h) is a rectangle whose size
// and texels are the frame's own words, which is why the first pass of this work
// drew a flat tinted box and had to be removed. A shape whose id is not in the
// directory draws nothing at all, exactly as the emitter's id search failing
// leaves the packet list untouched.
//
// Decode: docs/research/field/draw-context-service-2026-10-04.md
export function drawAnnotatorShapes(ctx: CanvasRenderingContext2D | null, stageId, camX: number, camY: number, drawables: { y: number; draw: () => void; }[], requests) {
    if (!requests?.length) return;
    const s = S.data?.[stageId];
    if (!s) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    for (const r of requests) {
        // The disc pass's CLUT row picks a palette variant when the extractor cut
        // one; a row with no variant draws on the shape's own palette, which is
        // what the pads do for the same reason.
        const base = String(r.shape);
        const sprite = (r.clutRow ? s.sprites[`${base}@${r.clutRow}`] : null) ?? s.sprites[base];
        if (!sprite) continue;
        pushComposite(drawables, r.y, [
            () => drawSprite(ctx, sheet, sprite, r.x - camX, r.y - camY, semiSheet),
        ], "annotator");
    }
}

// ── the stage overlay's own per-frame shape table ────────────────────────────
//
// A stage whose base tick builds the transient draw-context block
// (`F0x8001f648`) and then loops the SHARED shape emitter `F0x8001ED6C` -- the
// block's `+0x84` slot -- over an authored 8-byte {x, y} position table paints
// those shapes every frame. The emitter resolves each shape's pixels from the
// stage's own TMPK sprite directory, member 0 (the same directory the point
// sprites, launch pads and annotators read), and the block's `+0x7C` publish
// (`F0x8001ed34` -> the context's `+0x138` ordering-table accessor) links them
// into an ordering-table bucket. The table and the bucket are AUTHORED DATA,
// not per-stage code, so ONE shared draw runs them all:
// `tools/extract_stage_overlay_shapes.py` -> assets/data/stage_overlay_shapes.json.
//
// Protocol Ruins (`s375`, alias `s949`) is the first stage: 36 stamps of
// directory clip 0 on ordering bucket 12, i.e. behind the ground map-tile layer
// (bucket 7) and behind every entity, so this is the under-map pass (painted
// before the base map). The parallax term is the base tick's own:
// `(context scroll - base) >> shift`, scroll in whole pixels.
export function stageOverlayShapeProbe(stageId: string | number) {
    return S.overlayShapeData?.[stageId] ?? null;
}

export function drawStageOverlayShapes(ctx: CanvasRenderingContext2D | null, stageId, camX: number, camY: number) {
    const info = S.overlayShapeData?.[stageId];
    if (!info) return;
    const s = S.data?.[stageId];
    if (!s) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    // `sra` (arithmetic shift) in JS `>>`, so a negative scroll reads the same.
    const dx = (camX - info.baseX) >> info.shift;
    const dy = (camY - info.baseY) >> info.shift;
    for (const sh of info.shapes) {
        const layers = s.sprites[String(sh.id)];
        if (!layers) continue;
        drawSprite(ctx, sheet, layers, sh.x + dx - camX, sh.y + dy - camY, semiSheet);
    }
}

export function drawStreetVehicles(ctx: CanvasRenderingContext2D | null, stageId, camX: number, camY: number, drawables: { y: number; draw: () => void; }[]) {
    const draws = streetVehicleDraws(stageId);
    if (!draws.length) return;
    const s = S.data?.[stageId];
    if (!s) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    for (const car of draws) {
        const layers = s.sprites[String(car.spriteId)];
        if (!layers) continue;
        pushComposite(drawables, car.y, [
            () => drawSprite(ctx, sheet, layers, car.x - camX, car.y - camY, semiSheet),
        ], "car");
    }
}

/** One captured GPU quad: map texture (u,v) to the quad's screen parallelogram
 *  and blit the baked page under the primitive's ABR mode (cmd 0x2E = ABR on;
 *  the texpage word's bits 5-6 select the mode, 0 = B/2+F/2). */
export function drawScreenQuad(ctx, sheet, combo, q, camX: number, camY: number) {
    const du = q.u[1] - q.u[0];
    const dv = q.v[2] - q.v[0];
    if (!du || !dv) return;
    const a = (q.x[1] - q.x[0]) / du;
    const b = (q.y[1] - q.y[0]) / du;
    const c = (q.x[2] - q.x[0]) / dv;
    const d = (q.y[2] - q.y[0]) / dv;
    const e = (q.x[0] - camX) - a * q.u[0] - c * q.v[0];
    const f = (q.y[0] - camY) - b * q.u[0] - d * q.v[0];
    ctx.save();
    if (q.cmd === 0x2e) {
        const abr = combo.abr & 3;
        if (abr === 1) ctx.globalCompositeOperation = "lighter";
        else if (abr === 2) ctx.globalCompositeOperation = "difference";
        else if (abr === 3) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.25; }
        else ctx.globalAlpha = 0.5;
    }
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(
        sheet,
        combo.x + q.u[0], combo.y + q.v[0], du, dv,
        q.u[0], q.v[0], du, dv,
    );
    ctx.restore();
}
