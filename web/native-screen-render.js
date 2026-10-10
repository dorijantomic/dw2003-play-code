// Replay a native screen's recorded picture-service intents through the
// existing extracted-screen-pack renderer (web/screenpack.js).
//
// Phase 2 of docs/plans/2026-09-14-native-screen-port-plan.md. The overlay's
// ORIGINAL picture-service calls are recorded by engine/native as drawCalls:
//   setOrigin(x,y) 0x8001ecbc, setScale(x,y,z) 0x8001f5d0, setPos(x,y)
//   0x8001f608, m_0x88(paletteShift) 0x8001ecec, setLayer(target,bucket)
//   0x8001ed34, drawSprite(dir,id,x,y) 0x8001ed6c.
// Contract: docs/research/ui/screen-rendering-model.md sections 2-3.
//
// Depth: within one bucket a later draw call lands BEHIND an earlier one (each
// primitive is pushed on the front of the depth list and the list is drawn
// front-to-back), so the recorded sequence is painted in reverse. Picture ids
// resolve through the extracted pack the screen draws from (manifest `pack`),
// which tools/extract_screen_packs.py cut from the same *cs directory the
// original reads, so the ids are the original's own.
//
// This module does NOT render the text service: F0x800197a4 writes its glyph
// primitives inline (exe-decomp/c/F0x800197a4.c), so they are not in the draw
// intent stream yet. That is the named Phase 4 text-element item.

import { drawClip, drawClipAtPaletteRow, loadPack, packReady } from "./screenpack.js";

// VRAM-backed sprites. The card class's +0x34 emit publishes a 32x32 textured
// sprite whose texpage/clut words name a rectangle LoadImage wrote into the
// emulated VRAM (engine/native/vram.ts). Sampling follows the accepted
// vram-sample-contract answer section 3: pageX = (tpage & 0xF) * 64,
// pageY = ((tpage >> 4) & 1) * 256, 8-bit texels (two per VRAM halfword),
// clutX = (clut & 0x3F) * 16, clutY = (clut >> 6) & 0x1FF, colour 0 = clear.
const CARD_SPRITE = 32;
let vramScratch = null;

function drawVramSprite(ctx, vram, prim) {
    if (!vram || !vram.loads || vram.loads.length === 0) return false;
    const pageX = (prim.tpage & 0xf) * 64;
    const pageY = ((prim.tpage >> 4) & 1) * 256;
    const clutX = (prim.clut & 0x3f) * 16;
    const clutY = (prim.clut >> 6) & 0x1ff;
    if (!vramScratch) {
        vramScratch = document.createElement("canvas");
        vramScratch.width = CARD_SPRITE;
        vramScratch.height = CARD_SPRITE;
    }
    const sctx = vramScratch.getContext("2d");
    const img = sctx.createImageData(CARD_SPRITE, CARD_SPRITE);
    let pixels = 0;
    for (let dy = 0; dy < CARD_SPRITE; dy++) {
        for (let dx = 0; dx < CARD_SPRITE; dx++) {
            const tu = prim.u + dx;
            const vx = pageX + (tu >> 1);
            const vy = pageY + prim.v + dy;
            const image = vram.find(vx, vy);
            if (!image) continue;
            const texel = image.pixels[((vy - image.y) * image.w + (vx - image.x)) * 2 + (tu & 1)];
            const cx = clutX + texel;
            const palette = vram.find(cx, clutY);
            if (!palette) continue;
            const off = ((clutY - palette.y) * palette.w + (cx - palette.x)) * 2;
            const colour = ((palette.pixels[off] ?? 0) | ((palette.pixels[off + 1] ?? 0) << 8)) >>> 0;
            if (colour === 0) continue; // palette entry 0 is the card's clear colour
            const o = (dy * CARD_SPRITE + dx) * 4;
            const r5 = colour & 0x1f;
            const g5 = (colour >> 5) & 0x1f;
            const b5 = (colour >> 10) & 0x1f;
            img.data[o] = (r5 << 3) | (r5 >> 2);
            img.data[o + 1] = (g5 << 3) | (g5 >> 2);
            img.data[o + 2] = (b5 << 3) | (b5 >> 2);
            img.data[o + 3] = prim.cmd === 0x66 ? 0x80 : 0xff;
            pixels++;
        }
    }
    if (pixels === 0) return false;
    sctx.putImageData(img, 0, 0);
    ctx.drawImage(vramScratch, prim.x, prim.y);
    return true;
}

/** Paint a Gouraud quad whose colour runs from corner 0 to corner 1 (corners 2 and
 *  3 repeat them), which is how the registering progress bar is built. A general
 *  four-colour quad needs a triangle rasteriser this renderer does not have. */
function paintGouraudQuad(ctx, a) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = a;
    const rgb = (o) => `rgb(${a[o]},${a[o + 1]},${a[o + 2]})`;
    const gradient = ctx.createLinearGradient(x0, y0, x1 === x0 ? x0 + 1 : x1, y1);
    gradient.addColorStop(0, rgb(8));
    gradient.addColorStop(1, rgb(11));
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x3, y3);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

/** Paint a captured POLY_G4 (raw-prims.ts kind "polyG4"): the memory-card
 *  screen's transition bar. The original's emit site writes vertices 0/2 from
 *  one colour triple and 1/3 from another (UI-STGMCARD-TRANSITION-QUAD-2026-08-14),
 *  so the shade runs linearly along the v0->v1 edge and a two-stop linear
 *  gradient between those corners reproduces it exactly. */
function paintPolyG4(ctx, intent) {
    const { x, y, rgb } = intent;
    const degenerate = x[1] === x[0] && y[1] === y[0];
    const gradient = ctx.createLinearGradient(x[0], y[0], degenerate ? x[0] + 1 : x[1], y[1]);
    gradient.addColorStop(0, `rgb(${rgb[0][0]},${rgb[0][1]},${rgb[0][2]})`);
    gradient.addColorStop(1, `rgb(${rgb[1][0]},${rgb[1][1]},${rgb[1][2]})`);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x[0], y[0]);
    ctx.lineTo(x[1], y[1]);
    ctx.lineTo(x[3], y[3]);
    ctx.lineTo(x[2], y[2]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return true;
}

/** Paint a captured 0x2A dim quad (raw-prims.ts kind "dimQuad"). The original
 *  blends it with ABR mode 2, which is the screen behind MINUS the quad
 *  (docs/research/ui/screen-rendering-model.md §4): each channel becomes
 *  max(0, c - k), NOT an alpha blend toward black. Applied per device pixel over
 *  the quad's area, with the corners mapped through the live transform so the
 *  320x240 picture scales into whatever canvas the caller draws on. */
function paintDimQuad(ctx, intent) {
    const k = Math.round((intent.rgb[0] + intent.rgb[1] + intent.rgb[2]) / 3);
    if (k <= 0) return true; // level 0 at the ramp's start: a no-op, but still drawn
    const m = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
    const pts = [
        [intent.x[0], intent.y[0]], [intent.x[1], intent.y[1]],
        [intent.x[2], intent.y[2]], [intent.x[3], intent.y[3]],
    ].map(([px, py]) => (m ? [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f] : [px, py]));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const left = Math.max(0, Math.floor(Math.min(...xs)));
    const top = Math.max(0, Math.floor(Math.min(...ys)));
    const w = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs))) - left;
    const h = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys))) - top;
    if (w <= 0 || h <= 0) return true;
    const img = ctx.getImageData(left, top, w, h);
    const data = img.data;
    // The quad is a convex polygon (the emit sites draw the full-screen
    // rectangle); per row, subtract across the polygon's span at that row's
    // pixel centres, so a rotated quad would darken its own shape only.
    const edges = [0, 1, 2, 3].map((i) => [pts[i], pts[(i + 1) % 4]]);
    for (let j = 0; j < h; j++) {
        const yc = top + j + 0.5;
        const crossings = [];
        for (const [[ax, ay], [bx, by]] of edges) {
            if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) {
                crossings.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
            }
        }
        if (crossings.length < 2) continue;
        crossings.sort((p, q) => p - q);
        const rowOff = j * w * 4;
        for (let i = 0; i < w; i++) {
            const xc = left + i + 0.5;
            if (xc < crossings[0] || xc >= crossings[crossings.length - 1]) continue;
            const o = rowOff + i * 4;
            data[o] = Math.max(0, data[o] - k);
            data[o + 1] = Math.max(0, data[o + 1] - k);
            data[o + 2] = Math.max(0, data[o + 2] - k);
        }
    }
    ctx.putImageData(img, left, top);
    return true;
}

/** Built-in painting for raw primitives captured by engine/native/raw-prims.ts.
 *  A screen-specific `options.paintRaw` runs first and may claim a kind. */
function paintRawPrimitive(ctx, raw) {
    if (raw.kind === "polyG4") return paintPolyG4(ctx, raw.intent);
    if (raw.kind === "dimQuad") return paintDimQuad(ctx, raw.intent);
    return false;
}

export function createNativeScreenRenderer(entry, packNameForDir, options = {}) {
    // A screen may draw from several packs (the item shop: STSHOPCS chrome +
    // CMFONTCS icons). entry.packs maps the requested LBA index to the extracted
    // pack; entry.pack is the single-pack fallback.
    const packs = {};
    const names = new Set(Object.values((entry && entry.packs) || {}));
    if (entry && entry.pack) names.add(entry.pack);
    const loader = typeof options.loadPack === "function" ? options.loadPack : loadPack;
    const getPack = (name) => {
        if (!name) return null;
        if (!packs[name]) packs[name] = loader(name);
        return packs[name];
    };
    /** EVERY pack the screen draws from, not the first one that lands. The item
     *  shop's root names two (STSHOPCS chrome, CMFONTCS icons) and cmfont's
     *  sheet is the larger of the pair, so "some" reported ready while the
     *  shop's own plates were still in flight and the frame painted short. */
    const allPacksReady = () => [...names].every((n) => packReady(getPack(n)));
    const stats = { pack: entry ? entry.pack : null, packs: [...names], frames: 0, clips: 0, cards: 0, skipped: 0, seen: [], byPack: {}, last: null, paintOrder: [], skippedList: [], awaiting: 0, paintedFrames: 0, raw: 0, rawKinds: {} };
    /** Name a clip the renderer could not paint. A drop is either an id the
     *  extracted pack does not hold or a pack whose image never arrived, and
     *  the two need different answers, so record which one it was. */
    const noteSkip = (frame, reason, d, name) => {
        if (stats.skippedList.length < 64) {
            stats.skippedList.push({
                frame, reason, id: d?.id ?? null, dir: d?.dir ?? null, pack: name ?? null,
                bucket: d?.bucket ?? null, x: d?.x ?? null, y: d?.y ?? null, palette: d?.palette ?? 0,
            });
        }
    };
    // Screen adapters may veto individual clips they draw themselves (the gym
    // suppresses the overlay's end-of-session rep row because the host draws the
    // same row progressively, per rep, during the workout).
    const skipClip = typeof options.skipClip === "function" ? options.skipClip : null;
    const st = { scaleX: 0x1000, scaleY: 0x1000, posX: 0, posY: 0, palette: 0 };
    return {
        stats,
        ready() {
            return allPacksReady();
        },
        /** Paint one frame's recorded picture intents and VRAM sprites; (0,0) is
         *  screen top-left. The clip path and the VRAM path are independent: a
         *  picture-empty root still paints its card faces if it has any. */
        draw(ctx, drawCalls, vram, cardPrims, ctxMarkers, rawIntents) {
            stats.frames += 1;
            for (const prim of cardPrims ?? []) {
                if (drawVramSprite(ctx, vram, prim)) stats.cards += 1;
                else stats.skipped += 1;
            }
            if (!allPacksReady()) {
                // A sheet is still in flight. Nothing is drawn and nothing is
                // LOST: `awaiting` is the count of clips deferred, which is not
                // the same fault as a clip the pack does not hold. The host holds
                // the screen's first frame until every pack is here
                // (web/native-screen-host.js), so this is only reachable from a
                // caller that paints early.
                stats.awaiting += drawCalls.length;
                noteSkip(stats.frames, "pack-in-flight", { id: null }, null);
                return;
            }
            stats.paintedFrames += 1;
            const draws = [];
            const resets = new Set(ctxMarkers ?? []);
            let bucket = 0;
            stats.paintOrder.length = 0;
            // Typed raw GPU primitives (the dialogue box's POLY_FT4 fill and LINE_F2 wipe) carry
            // `at` = the call index they were queued at; they join the draw list in that order.
            const raws = rawIntents ?? [];
            let ri = 0;
            const flushRaw = (upTo) => {
                while (ri < raws.length && raws[ri].at <= upTo) {
                    const raw = raws[ri];
                    // The original selected the block's depth bucket through the
                    // layer's +0x138 (raw-prims.ts); without that selection the
                    // block takes the bucket of the last recorded setLayer.
                    draws.push({ kind: "raw", raw, bucket: Number.isFinite(raw.bucket) ? raw.bucket : bucket });
                    ri++;
                }
            };
            for (let ci = 0; ci < drawCalls.length; ci++) {
                flushRaw(ci);
                const c = drawCalls[ci];
                if (resets.has(ci)) {
                    // A new picture service was just built on the screen's stack
                    // (F0x8001f648; runtime ctxMarkers). Each picture starts from
                    // the service defaults: scale 1, no pivot, no palette shift.
                    // Without this, a fold animation's scale/pivot leaks into
                    // whatever is drawn next.
                    st.scaleX = 0x1000;
                    st.scaleY = 0x1000;
                    st.posX = 0;
                    st.posY = 0;
                    st.palette = 0;
                }
                switch (c.method) {
                    case "setScale":
                        st.scaleX = c.args[0];
                        st.scaleY = c.args[1];
                        break;
                    case "setPos":
                        st.posX = c.args[0];
                        st.posY = c.args[1];
                        break;
                    case "m_0x88":
                        st.palette = c.args[0];
                        break;
                    case "setLayer":
                        // F0x8001ed34(target, bucket): the depth bucket every
                        // following draw lands in. Within one bucket a later
                        // draw goes BEHIND an earlier one; between buckets a
                        // higher number is farther back (screen-rendering-model
                        // section 3). Recorded bucket 7 is the shop's scrolling
                        // backdrop, bucket 1 the header: painting the buckets in
                        // descending order is what keeps the plates and icons
                        // over the backdrop.
                        bucket = c.args[1] | 0;
                        break;
                    case "drawSprite":
                        draws.push({
                            dir: c.args[0] >>> 0,
                            id: c.args[1], x: c.args[2], y: c.args[3],
                            sx: st.scaleX / 0x1000, sy: st.scaleY / 0x1000,
                            px: st.posX, py: st.posY, palette: st.palette,
                            bucket,
                        });
                        break;
                    case "cardSprite":
                    case "gymMode":
                    case "gymSprite":
                    case "gymQuad":
                        // The gym's sprite actors' GPU primitives (engine/dw3/ui/native/gym-actor.ts):
                        // a draw-mode packet, a textured rectangle or quad. The screen adapter
                        // supplies `options.paintPrim` (web/gym-vram-paint.js) to rasterise them
                        // from VRAM; the depth bucket is the last setLayer's.
                        draws.push({ kind: "vram", call: c, bucket });
                        break;
                    case "gouraudQuad":
                        // A four-corner Gouraud primitive (the wizard's registering
                        // progress bar). Args: four x,y corners, then four r,g,b
                        // colours; the depth bucket is the last setLayer's.
                        draws.push({ kind: "quad", args: c.args.slice(), bucket });
                        break;
                    default:
                        break; // setOrigin/...: no effect on this replay yet
                }
            }
            flushRaw(Infinity);
            const buckets = [...new Set(draws.map((d) => d.bucket))].sort((a, b) => b - a);
            for (const b of buckets) {
            for (let i = draws.length - 1; i >= 0; i--) {
                const d = draws[i];
                if (d.bucket !== b) continue;
                if (d.kind === "vram") {
                    if (typeof options.paintPrim === "function") options.paintPrim(ctx, d.call);
                    else stats.skipped += 1;
                    continue;
                }
                if (d.kind === "raw") {
                    let painted = false;
                    if (typeof options.paintRaw === "function" && options.paintRaw(ctx, d.raw, getPack)) painted = true;
                    if (!painted) painted = paintRawPrimitive(ctx, d.raw);
                    if (painted) {
                        stats.raw += 1;
                        stats.rawKinds[d.raw.kind] = (stats.rawKinds[d.raw.kind] ?? 0) + 1;
                    } else stats.skipped += 1;
                    continue;
                }
                if (d.kind === "quad") {
                    paintGouraudQuad(ctx, d.args);
                    stats.quads = (stats.quads ?? 0) + 1;
                    continue;
                }
                stats.paintOrder.push({ id: d.id, bucket: d.bucket });
                const name = packNameForDir ? packNameForDir(d.dir) : entry && entry.pack;
                const pack = getPack(name);
                if (!name) {
                    stats.skipped += 1;
                    noteSkip(stats.frames, "no-pack-for-dir", d, name);
                    continue;
                }
                if (!packReady(pack)) {
                    stats.awaiting += 1;
                    noteSkip(stats.frames, "pack-in-flight", d, name);
                    continue;
                }
                if (skipClip && skipClip(name, d.id)) continue;
                const scaled = d.sx !== 1 || d.sy !== 1;
                ctx.save();
                if (scaled) {
                    ctx.translate(d.px, d.py);
                    ctx.scale(d.sx, d.sy);
                    ctx.translate(-d.px, -d.py);
                }
                // `opaqueClips`: the sheet records STP per clip, not per texel, so a clip whose
                // body texels are opaque but whose bevel texels carry STP would blend whole.
                // The dialogue box asks for plain copies (its capture shows opaque chrome).
                const ok = options.opaqueClips && !d.palette
                    ? drawClip(ctx, { ...pack, ids: { [String(d.id)]: { ...pack.ids[String(d.id)], stp: false } } }, d.id, d.x, d.y)
                    : d.palette
                        ? drawClipAtPaletteRow(ctx, pack, d.id, d.palette, d.x, d.y)
                        : drawClip(ctx, pack, d.id, d.x, d.y);
                ctx.restore();
                if (ok) {
                    stats.clips += 1;
                    stats.byPack[name] = (stats.byPack[name] ?? 0) + 1;
                    stats.last = { id: d.id, x: d.x, y: d.y, pack: name };
                    if (stats.seen.length < 64 && !stats.seen.includes(d.id)) stats.seen.push(d.id);
                } else {
                    stats.skipped += 1;
                    noteSkip(stats.frames, "clip-not-in-pack", d, name);
                }
            }
            }
        },
    };
}
