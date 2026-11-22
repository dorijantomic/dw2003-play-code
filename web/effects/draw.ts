import {
  tickPointSpriteRecords,
  pointModeGatesFor,
  applyPointModeGates,
  streetLightWrites,
  pointRecordLive,
  pointRecordInView,
} from "../vendor/engine.js";
import { UNDER_MAP_BUCKET, pushComposite } from "../draw-order.js";
import { nativeStage } from "../native-stage.js";
import { fieldcomReady, drawFieldcomIcon } from "../fieldcom.js";
import { S } from "./state.js";
import {
  actorPositions,
  applySceneVariantSlot,
  constructPointRecordStageObjects,
  ensureScreenAtlas,
  ensureSemiSheet,
  ensureSheet,
  screenAtlases,
  slotWrites,
  stageRuntime,
} from "./point-records.js";
import { drawScreenQuad } from "./street.js";

// One animation step per rendered frame (call once per frame for the current
// stage).  The step itself is the engine's `tickPointSpriteRecords` --
// F0x80089038's per-record body including its two gates (the live active byte
// and the camera cull), so the browser wrapper owns only the freeze hook.
function tick(records, rt, f: {} | undefined) {
    // Verification hook, same family as window.__hideProps: freeze every record
    // on the frame it is showing. A capture of an animated scene is otherwise
    // dominated by animation phase, which makes a before/after pixel diff
    // meaningless (tools/verify_under_map_props.mjs relies on this).
    if (typeof window !== "undefined" && window.__freezeProps) return;
    tickPointSpriteRecords(records, rt, f);
}

// Dest must share the map's camera phase. These sprites fill transparent
// cut-outs in the stitched map (chain posts, railings); rounding here while
// the map drew at (-camX, -camY) left a visible join that crawled on move.
//
// `semiSheet` is the same stage's STP-only sheet (ensureSemiSheet). PS1 ABR is
// per TEXEL, not per sprite: the plain pass writes every non-STP texel opaque
// (that is what stops the cars looking like glass), and only the STP texels
// are re-drawn under the clip's blend mode. semi == -1 means no blend at all.
export function drawSprite(ctx: CanvasRenderingContext2D | null, sheet: HTMLImageElement, layers, x: number, y: number, semiSheet: string | HTMLImageElement | null) {
    for (const l of layers) {
        ctx.drawImage(sheet, l.x, l.y, l.w, l.h,
            x + l.dx, y + l.dy, l.w, l.h);
    }
    if (!(semiSheet instanceof Image)) return;
    const mode = layers[0]?.semi;
    if (!(mode >= 0)) return;
    // Blend modes: 0 = B/2+F/2, 1 = B+F (the lit lamps/screens), 2 = B-F
    // ('difference' is the closest canvas op; no s780 clip uses it),
    // 3 = B+F/4.
    ctx.save();
    if (mode === 1) {
        ctx.globalCompositeOperation = "lighter";
    } else if (mode === 2) {
        ctx.globalCompositeOperation = "difference";
    } else if (mode === 3) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.25;
    } else {
        ctx.globalAlpha = 0.5;
    }
    for (const l of layers) {
        if (l.semi < 0) continue;
        ctx.drawImage(semiSheet, l.x, l.y, l.w, l.h,
            x + l.dx, y + l.dy, l.w, l.h);
    }
    ctx.restore();
}

/**
 * Which of our four render passes a record's ordering-table bucket belongs to.
 * One place, so the two passes cannot disagree about where a record goes.
 *
 *   "under-map"      behind the ground map-tile layer (bucket 7): painted
 *                    before the base map, which then covers it
 *   "over-map"       over the map but behind every entity
 *   "sorted"         the entity bucket, y-sorted among the player and NPCs
 *   "over-entities"  in front of every entity
 */
export function bucketPass(layer: number) {
    if (layer >= UNDER_MAP_BUCKET) return "under-map";
    if (layer < 4) return "over-entities";
    if (layer === 4) return "sorted";
    return "over-map";
}

// One frame's resolved record state, handed from the under-map pass to the
// over-map pass so the animation is ticked exactly once per frame. Consumed
// (and cleared) by drawEffects; a caller that skips the under-map pass, like
// the UI lab, still gets a correct frame because drawEffects prepares its own.
let preparedFrame = null;

// Advance one frame of the stage's records and resolve where each one is and
// which sprite it shows. Ticks animation, so call it once per frame. `view` is
// the camera rect ({x, y, w, h}, map pixels) the disc's cull tests against;
// a caller with no camera passes nothing and no record is culled.
function prepareEffects(stageId: string, view = null) {
    const s = S.data?.[stageId];
    if (!s) return null;
    const rt = stageRuntime(stageId, s.records);
    // The stage builds its own actors at stage entry when the registry's
    // construct pointer is null, so nothing waits for a SETANIM.  The two
    // `triple` parents wait for their ORDINAL instead, which is why the number
    // is read here and not cached at load.
    constructPointRecordStageObjects(stageId, S.readOrdinal());

    // Rebase onto interpreter memory: 18-byte records at the table the stage
    // init registered (active=+0, mode=+5, spriteId=+4, ctr=+9 — the exact
    // bytes the native writers poke).  Built BEFORE the tick, because
    // F0x80089038 dispatches on these live bytes: on a native stage the
    // overlay's own actor can switch a record off or re-mode it (the s421
    // windmill actor writes record+5).
    const native = nativeStage(stageId);
    // The map setup's own display-slot write (fieldstg F0x80084B40): the walker
    // applies it off the native research route, which runs the original's setup
    // itself and whose rebase below reads the byte straight out of memory.
    if (!native) applySceneVariantSlot(stageId, s.records, rt);
    // The stage-entry MODE writer (wstag421's actor, mined into
    // point_record_actors.json `modeGates`): mode = get_flag(flag) on every
    // tagged record.  The disc runs it in the actor's state 0, i.e. once at
    // stage entry; the walker applies it on every prepared frame instead, which
    // is the same thing within a visit (the flag's only producer runs in
    // another stage) and still honours a flag set while away when the stage's
    // runtime is retained.  Native stages skip it: the interpreter's own actor
    // writes the live byte, which the tick reads through `liveMode`.
    if (!native) {
        const gates = pointModeGatesFor(stageId);
        if (gates.length) applyPointModeGates(s.records, rt, gates, S.readFlag);
    }
    const activeOverride = new Array(s.records.length).fill(null);
    const nativePos = new Array(s.records.length).fill(null);
    const actorPos = new Array(s.records.length).fill(null);
    const liveMode = new Array(s.records.length).fill(null);
    if (native?.pointTable) {
        const m = native.rt.mem;
        for (let i = 0; i < s.records.length; i++) {
            const rec = native.pointTable + i * 18;
            // The live bytes the tick and the draw both read: `active` and the
            // animation `mode` for every record, then the mode-0 records'
            // sprite/ctr/position.
            activeOverride[i] = m.read8(rec);
            liveMode[i] = m.read8(rec + 5);
            if (s.records[i].mode !== 0) continue; // modes 1-3: JS tick owns them
            rt[i].sprite = m.read8(rec + 4);
            rt[i].ctr = m.read8(rec + 9);
            nativePos[i] = {
                x: m.read16s(rec + 10),
                y: m.read16s(rec + 12),
                ysort: m.read16s(rec + 14),
            };
            // s415 object 811 is constructed/prewarmed by SETANIM 816 at the
            // start of the ride, but the Bulbmon record is not presented until
            // the later 817 roll-in command. The native record itself is active
            // while parked off-stage; its renderer has this choreography gate.
            if (
                stageId === "s415" && s.records[i].atlasFlag === 1 &&
                (native.effects.get(811) ?? 816) === 816
            ) activeOverride[i] = 0;
        }
    }

    // The traffic-light corner's own writer (engine/systems/street-lights.ts,
    // the overlay's 0x800a67a4): it publishes active / sprite id / ctr into the
    // two pole records exactly as it pokes the interpreter's memory, so the
    // translated route takes the same rebase. Absent unless the corner is
    // running, which needs the master story ordinal 0x1B.
    const lampWrites = nativeStage(stageId) ? [] : streetLightWrites(stageId);
    for (const w of lampWrites) {
        if (s.records[w.index]?.mode !== 0) continue;
        activeOverride[w.index] = w.active;
        rt[w.index].sprite = w.sprite;
        rt[w.index].ctr = w.ctr;
    }

    // Translated display-slot writers (engine/systems/stage-slot-player.ts): a
    // ported stage object that owns a point record writes its live flag and
    // sprite here. Applied after the interpreter rebasing, and only for records
    // that rebasing left alone, so a native stage still stands down in favour of
    // the original's own writes.
    const sw = slotWrites[stageId];
    if (sw) {
        for (const [i, w] of sw) {
            if (i >= s.records.length) continue;
            if (nativePos && nativePos[i]) continue;
            if (w.active !== undefined) activeOverride[i] = w.active;
            if (w.sprite !== undefined) rt[i].sprite = w.sprite;
            if (w.ctr !== undefined) rt[i].ctr = w.ctr;
        }
    }

    // The point-record actor arm that MOVES its claimed records (the pad flash
    // onto the pad the command names, the rising copy up the screen) writes the
    // record's position itself, so the draw position comes from the actor's own
    // write and not from the table. Every other arm leaves the record where the
    // disc put it, which is why the position patch is optional.
    for (const [key, patch] of Object.entries(actorPositions[stageId] ?? {}) as [string, ActorPositionPatch][]) {
        const idx = Number(key);
        if (!s.records[idx]) continue;
        rt[idx].x = patch.x;
        actorPos[idx] = patch;
    }

    const f = {
        stageId, s, rt, activeOverride, nativePos, actorPos, liveMode,
        view: view ?? null,
        sheet: Object.keys(s.sprites).length ? ensureSheet(stageId) : null,
        semiSheet: Object.keys(s.sprites).length ? ensureSemiSheet(stageId) : null,
    };
    tick(s.records, rt, f);
    return f;
}

/** The cull rect for a draw call's camera: the visible map-pixel window, the
 *  walker's stand-in for the 0x1002 layer's screen rect (ctx+0x128).  No view
 *  dimensions (a caller without a camera) -> null, and nothing is culled. */
function viewRect(camX: number, camY: number, viewW: number, viewH: number, pad = 0) {
    // `pad`: the HD Remaster wide overworld's extra map pixels on each side (web/field-view.js).
    return viewW > 0 && viewH > 0
        ? { x: camX - pad, y: camY, w: viewW + 2 * pad, h: viewH }
        : null;
}

// Paint the records that draw BEHIND the ground map-tile layer -- ordering-table
// buckets 8 and above. Call this immediately BEFORE the base map is drawn; the
// map art then covers them, which is what the console does. It also ticks the
// frame, so drawEffects must follow it on the same frame.
export function drawEffectsUnderMap(ctx: CanvasRenderingContext2D | null, stageId: string, camX: number, camY: number, viewW: number, viewH: number, pad = 0) {
    const f = prepareEffects(stageId, viewRect(camX, camY, viewW, viewH, pad)!);
    preparedFrame = f;
    if (!f) return;
    eachRecord(f, ctx, camX, camY, (r: { layer: number; }, draw: () => void) => {
        if (bucketPass(r.layer) === "under-map") draw();
    });
}

// Draw the current stage's effects. Fixed-layer records (ysort==0) paint
// immediately (call this right after the map background); records with a
// y-sort baseline are pushed into `drawables` so the player/NPCs sort around
// them. Coordinates are map-space; ctx is already camera-translated by the
// caller passing camX/camY. Records at UNDER_MAP_BUCKET and above were already
// painted by drawEffectsUnderMap and are skipped here.
export function drawEffects(ctx: CanvasRenderingContext2D | null, stageId: string, camX: number, camY: number, drawables: { y: number; draw: () => void; }[], viewW: number, viewH: number, pad = 0) {
    const f = preparedFrame?.stageId === stageId
        ? preparedFrame
        : prepareEffects(stageId, viewRect(camX, camY, viewW, viewH, pad)!);
    preparedFrame = null; // one frame's preparation is good for one frame
    if (!f) return;
    eachRecord(f, ctx, camX, camY, (r: { layer: number; }, draw: () => void, py, pysort) => {
        // The record's `layer` byte (record byte+3) is the GPU ordering-table
        // BUCKET the draw is submitted to, and LOWER means NEARER the camera.
        //
        // The bucket ladder, from fieldstg call sites that all reach vtable
        // slot +0x7C (F0x8001ed34 -> F0x8001ecf8): 0 = the HUD digits and
        // gauges drawn at fixed screen coords (F0x8008c6b8, and F0x8008d27c
        // which draws its world sprite at 4 and its own gauge at 0), 1 = the
        // icon above an actor's head (F0x80087e7c, actorY-0x1B), 2 = the
        // message strip at screen y 0xAC (F0x80084200), 4 = world entities
        // (literal `li $a1, 0x4` in the y-sorted world-object callback,
        // fieldstg file 0xa374), 7 = the fullscreen backdrop (F0x80085590).
        //
        // The map's three tile layers ride the same ladder -- ground 7,
        // foreground 3, layer 2 at 11 (the three words at 0x8009702c, each
        // handed to the same slot 0x138 these records reach; see
        // docs/research/field/map-tile-draw-semitransparency-2026-08-20.md
        // section 8). So bucket 2 draws over entities, 4 sorts among them, 6
        // draws under them but still over the ground, and 8 and 10 draw behind
        // the ground -- those were painted before the map by drawEffectsUnderMap.
        //
        // The shipped records agree that 4 is the entity bucket: a y-sort key
        // is only meaningful there, and that is where it appears -- 2541/2545
        // bucket-4 records carry one, while 1692/1693 bucket-2, 4651/4655
        // bucket-6 and 647/647 bucket-10 records do not.
        //
        // This is the reverse of the 2026-07-04 census reading (2 background,
        // 6/10 foreground), which cut the Asuka-plaza tree canopy in half:
        // the canopy is authored partly as tile foreground (`sNNN_fg.png`,
        // over entities) and partly as bucket-2 point records filling cut-outs
        // in the stitched base map, so demoting bucket 2 opened a rectangular
        // window in the leaves that the player showed through.
        switch (bucketPass(r.layer)) {
            case "under-map":
                return; // already painted, before the base map
            case "over-entities":
                drawables.push({ y: Infinity, draw });
                return;
            case "sorted":
                drawables.push({ y: pysort || py, draw });
                return;
            default:
                draw(); // over the map, behind every entity
        }
    });
}

// Walk one prepared frame's live records, handing each one a painter bound to
// this context and camera. Both passes share it so they cannot disagree about
// which records are live or where they are.
function eachRecord(f, ctx: CanvasRenderingContext2D | null, camX: number, camY: number, visit) {
    const { s, rt, sheet, semiSheet } = f;
    for (let i = 0; i < s.records.length; i++) {
        const r = s.records[i];
        // The disc's two draw gates, resolved exactly as the tick resolves
        // them: the live active byte (`lbu $v0, ($s1)` / `beqz`, file 0x64bc)
        // and the camera cull (file 0x64f4-0x6550) -- a culled record is not
        // drawn, so a tall sprite does not pop in from an off-screen anchor.
        const live = pointRecordLive(r, rt[i], f, i);
        if (!live.active) continue;
        if (!pointRecordInView(r, live.x, live.y, f.view)) continue;
        const px = live.x;
        const py = live.y;
        const pysort = live.ysort;
        const draw = () => {
            if (r.atlas === "fieldcom") {
                if (fieldcomReady()) {
                    drawFieldcomIcon(ctx, 0, rt[i].sprite, px - camX, py - camY);
                }
                return;
            }
            const st = rt[i];
            const layers =
                (st.ctr ? s.sprites[`${st.sprite}@${st.ctr}`] : null) ??
                s.sprites[String(st.sprite)];
            if (layers && sheet instanceof Image) {
                drawSprite(ctx, sheet, layers, px - camX, py - camY, semiSheet);
            }
        };
        // Both consumers pass the bucket to the same context setter: the fixed
        // pass in fieldstg F0x80089038 (`sp94(0x1002, byte+3, …)`) and the
        // y-sorted callback F0x80088eec (`lbu $a1, 0x3($s0)`, fieldstg file
        // 0x6294) — so the bucket applies whether or not the record has a
        // baseline. What each bucket means is documented at the call in
        // drawEffects.
        visit(r, draw, py, pysort);
    }
}

// Fire Dungeon trap explosions. Each live burst draws its two components from
// the SAME stage atlas the point sprites use (the explosion runs 50..67 are cut
// into every s740/s741 sheet already, unused by any point record). The layers
// are y-sorted, not painted flat: the controller gives each component its own
// baseline offset — one 240px ABOVE the Digimon, so it sorts behind everything,
// and one +20 below, so it sorts in front. See engine/systems/fire-trap.ts.
export function drawFireTrapBursts(ctx: CanvasRenderingContext2D | null, stageId: string, camX: number, camY: number, drawables: { y: number; draw: () => void; }[], trap) {
    const s = S.data?.[stageId];
    if (!s || !trap) return;
    const sheet = ensureSheet(stageId);
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    for (const burst of trap.run.bursts) {
        // Each component carries its OWN decoded y-sort baseline (one 240px
        // above the Digimon, one +20 below), so the two are separate ordering
        // keys -- submit each through the one push at its own key.
        burst.sprites.forEach((sprite, i: string | number) => {
            if (sprite == null) return;
            const layers = s.sprites[String(sprite)];
            if (!layers) return;
            pushComposite(drawables, burst.y + (trap.cfg.layers[i]?.ysortDy ?? 0), [
                () => drawSprite(ctx, sheet, layers, burst.x - camX, burst.y - camY, semiSheet),
            ], "fire-trap");
        });
    }
}

// Draw a translated stage actor's clip (web/stage-objects.js) out of the same
// stage atlas the point records use, so a rock is blitted with the same blend
// handling and y-sorts at its own y exactly as the native drawSprite path did.
// `entries` are {clip, x, y} in map coordinates.
export function drawStageObjectSprites(ctx: CanvasRenderingContext2D | null, stageId: string, camX: number, camY: number, drawables: { y: number; draw: () => void; }[], entries) {
    const s = S.data?.[stageId];
    if (!s || !entries?.length) return;
    const sheet = Object.keys(s.sprites).length ? ensureSheet(stageId) : null;
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    for (const e of entries) {
        // `ctr` is the palette byte the original's draw callback submits beside
        // the sprite (fixed still sprites, engine/systems/stage-fixed-sprite.ts);
        // entries without one — the rockfall — keep the plain lookup.
        const layers =
            (e.ctr ? s.sprites[`${e.clip}@${e.ctr}`] : null) ?? s.sprites[String(e.clip)];
        if (!layers) continue;
        const sx = e.x - camX;
        const sy = e.y - camY;
        drawables.push({
            y: e.y,
            draw: () => drawSprite(ctx, sheet, layers, sx, sy, semiSheet),
        });
    }
}

// Replay this frame's native draw intents (web/native-stage.js tick). The
// overlay's per-object draw fns fill a draw context (EXE F0x8001f648) and call
// its methods; the interpreter records them. We honor the sprite path:
//   setScale(-0x1000, ...)  → x-flip until the next drawSprite
//   drawSprite(sub, spriteId, x, y) → stage-atlas sprite at map coords (x,y)
// (the s780 cars). Sprites y-sort at their own y so entities walk around them.
export function drawNativeIntents(ctx: CanvasRenderingContext2D | null, stageId: string, camX: number, camY: number, drawables: { y: number; draw: () => void; }[]) {
    const native = nativeStage(stageId);
    const s = S.data?.[stageId];
    if (!native || !s) return;
    const sheet = Object.keys(s.sprites).length ? ensureSheet(stageId) : null;
    if (!(sheet instanceof Image)) return;
    const semiSheet = ensureSemiSheet(stageId);
    let flip = false;
    for (const call of native.rt.drawCalls) {
        if (call.method === "setScale") {
            flip = call.args[1] < 0;
        } else if (call.method === "drawSprite") {
            const [, spriteId, x, y] = call.args;
            // s415 sprite 0 is already the live gondola point record. The
            // stage controller also submits its internal tiled copies through
            // the layer runner; replaying those as independent world sprites
            // creates duplicate gondolas. Its visible falling-rock jobs are
            // the decoded 70..77 family.
            if (stageId === "s415" && spriteId < 70) continue;
            const layers = s.sprites[String(spriteId)];
            if (!layers) continue;
            const flipNow = flip;
            drawables.push({
                y,
                draw: () => {
                    if (flipNow) {
                        ctx!.save();
                        ctx!.translate(x - camX, 0);
                        ctx!.scale(-1, 1);
                        ctx!.translate(-(x - camX), 0);
                        drawSprite(ctx, sheet, layers, x - camX, y - camY, semiSheet);
                        ctx!.restore();
                    } else {
                        drawSprite(ctx, sheet, layers, x - camX, y - camY, semiSheet);
                    }
                },
            });
            flip = false;
        }
    }
    // Wall-screen quads (the decoded 40-quad builder). One quad batch per
    // driver; the walker can boot the driver twice, so identical quads are
    // deduped. The quad carries page-relative texture coords; the sheet combo
    // supplies the page image and the palette's ABR mode.
    ensureScreenAtlas(stageId);
    const screen = screenAtlases[stageId];
    if (screen && native.rt.screenQuads?.length) {
        const seen = new Set();
        for (const q of native.rt.screenQuads) {
            const combo = screen.data.combos[`${q.texpage}:${q.clut}`];
            if (!combo) continue;
            const key = `${q.texpage}:${q.clut}:${q.x.join()}:${q.y.join()}:${q.u.join()}:${q.v.join()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            drawables.push({
                y: Math.max(q.y[0], q.y[1], q.y[2], q.y[3]),
                draw: () => drawScreenQuad(ctx, screen.img, combo, q, camX, camY),
            });
        }
    }
}

// One actor position the record-table patch writes: the point-record index it moves to.
interface ActorPositionPatch {
  x?: any;
  y?: any;
}
