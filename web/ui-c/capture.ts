// web/ui-c/capture.js -- look C kit: the capture scope. Inside a scope the five clip-drawing functions of web/screenpack.js and the text
// widget painter of web/native-screen-text.js hand their work here instead of drawing on the game canvas:
//  - a claimed clip (claims.js) is recorded as a part with its native position and its matrix relative to the scope start (that one
//    rule carries every fold, slide and zoom the renderer already applies);
//  - an unclaimed clip is ART: it is drawn, in its own pixels, on the art canvas the scope owns (never dropped);
//  - text widgets become runs (data), not pixels.
// Nothing here reads or writes game state; it only sees what the draw functions are asked to draw.
import { claimFor } from "./claims.js";
import { relative } from "./geometry.js";
import type { UiCapturePart, UiCaptureScope, UiClaim, UiHookPart } from "./types.js";
import type { UiMatrix } from "./types.js";
import type { UiRun } from './types.js';


interface UiCaptureLayer { x: number; y: number; dx: number; dy: number; w: number; h: number; }
interface UiCaptureSpriteIds { layers?: UiCaptureLayer[]; }
interface UiCapturePackDef { name: string; ids?: Record<string, UiCaptureSpriteIds>; }


let cur: UiCaptureScope | null = null;

export const capturing = () => cur !== null && !cur.inArt;

/** Pixel bounds of clip `id` in pack `p` (from the loaded sheet record), or null. */
export function clipBounds(p: UiCapturePackDef, id: string | number) {
    const clip = p?.ids?.[String(id)];
    if (!clip || !Array.isArray(clip.layers) || !clip.layers.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of clip.layers) {
        x0 = Math.min(x0, l.dx | 0); y0 = Math.min(y0, l.dy | 0);
        x1 = Math.max(x1, (l.dx | 0) + (l.w | 0)); y1 = Math.max(y1, (l.dy | 0) + (l.h | 0));
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Open a scope. `m0` = the transform at the start ({a,d,e,f}), `getArt()` = the art canvas context (made on first use). `o.texts` = the
 * scope also takes the plain drawText() calls (web/uifont.js) as runs -- the battle HUD writes its names and numbers that way, not as
 * text widgets.
 */
export function begin(key: string, ctx: CanvasRenderingContext2D, m0: Required<UiMatrix>, getArt: () => CanvasRenderingContext2D, o: { texts?: boolean; } = {}) {
    cur = { key, ctx, m0, getArt, parts: [], runs: [], unclaimed: [], claimed: [], arts: 0, inArt: false, domText: 0, texts: !!o.texts };
}

/** Close the scope and return what it saw. */
export function end(): UiCaptureScope | null {
    const s = cur;
    cur = null;
    return s;
}

/**
 * The clip hook (web/screenpack.js): returns true when the scope took the draw. `draw(artCtx)` re-runs the real drawing on another context.
 */
/** The battle's list rows (technique / item) carry the game's own little row icons (cmfont 57, 95, 97): the arc rows replace them (the element chip, the quantity), so they are taken and not drawn. */
const battleIconClaim = (pack: string, id: string | number): UiClaim | null => (pack === "cmfont" && [57, 95, 97].includes(Number(String(id).split("#")[0])) ? { part: "rowIcon", layer: "under" } : null);
export function clipHook(ctx: CanvasRenderingContext2D, p: UiCapturePackDef, id: string | number, x: number, y: number, draw: (c: CanvasRenderingContext2D) => void, drawW = null) {
    const s = cur;
    if (!s || s.inArt || ctx !== s.ctx) return false;
    const m = ctx.getTransform();
    const rel = relative(s.m0, m);
    const claim = claimFor(p?.name, id) ?? (s.key === "ui-battle" ? battleIconClaim(p?.name, id) : null);
    const b = clipBounds(p, id);
    const listedArt = claim?.part === "art";      // named as art in claims.js: drawn in its own pixels on purpose
    if (claim && !listedArt) {
        const [base, row = "0"] = String(id).split("#");
        // x, y = the game's draw position; bx, by, w, h = where the clip's pixels sit relative to it (read from the loaded sheet, never stored)
        // ETS item 9: the claim spread carries its `layers` flag, which the line below replaces with the clip's rects
        const part: UiCapturePart & Omit<UiClaim, "layers"> = { ...(claim as Omit<UiClaim, "layers">), rows: claim.rows ?? 0, pack: p.name, id: String(id), base: Number(base), row: Number(row) || 0, x, y, bx: b?.x ?? 0, by: b?.y ?? 0, w: b?.w ?? 0, h: b?.h ?? 0, rel };
        if (drawW != null) part.drawW = drawW;     // drawClipWidth: the width the game reveals (a gauge fill)
        // a claim that asks for them gets the clip's sheet layers (piece rects relative to the draw position), read at run time
        if (claim.layers) part.layers = (p.ids?.[String(id)]?.layers ?? []).map((l) => ({ x: l.dx | 0, y: l.dy | 0, w: l.w | 0, h: l.h | 0 }));
        s.parts.push(part);
        s.claimed.push({ pack: p.name, id: String(id), part: claim.part });
        if (claim.artSizes) { drawPieces(s, m, p, id, x, y, claim.artSizes); return true; }
        if (claim.artInset && b) { drawInset(s, m, x + b.x, y + b.y, b.w, b.h, claim.artInset, draw); return true; }
        if (!claim.keepArt) return true;
        // keepArt: a picture of a grid (card face, drill picture) -- the part is a frame under it, the picture stays the game's pixels
        const art = s.getArt();
        if (!art) return false;
        art.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
        s.inArt = true;
        try { draw(art); } finally { s.inArt = false; }
        s.arts++;
        return true;
    }
    s.unclaimed.push({ pack: p?.name ?? null, id: String(id), x, y, w: b?.w ?? 0, h: b?.h ?? 0, listed: listedArt, flat: !listedArt && !!b && b.w >= 24 && b.h >= 12 && (b.w > 48 || b.h > 48) });   // a sprite up to 48 x 48 is art by size, not a plate
    const art = s.getArt();
    if (!art) return false;
    art.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    s.inArt = true;
    try { draw(art); } finally { s.inArt = false; }
    return true;
}

/** The sheet pieces of clip `id` whose size is one of `sizes` ([[w, h]]): the pictures inside a claimed frame. */
export const artPieces = (layers: UiCaptureLayer[] = [], sizes: readonly (readonly [number, number])[] = []) => layers.filter((l) => sizes.some(([w, h]) => (l.w | 0) === w && (l.h | 0) === h));

/** Draw only those pieces, in their own pixels, on the art canvas (the frame around them is the C plate). */
function drawPieces(s: { getArt: () => CanvasRenderingContext2D | null; arts: number }, m: DOMMatrix, p: UiCapturePackDef & { img?: CanvasImageSource }, id: string | number, x: number, y: number, sizes: readonly (readonly [number, number])[]) {
    const pieces = artPieces(p.ids?.[String(id)]?.layers, sizes);
    if (!pieces.length || !p.img) return;
    const art = s.getArt();
    if (!art) return;
    art.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    art.imageSmoothingEnabled = false;
    for (const l of pieces) art.drawImage(p.img, l.x, l.y, l.w, l.h, x + l.dx, y + l.dy, l.w, l.h);
    s.arts++;
}

/** The rect inside a clip's frame that keeps the game's pixels: `inset` = [left, top, right, bottom] native px off the clip's bounds. */
export const insetRect = (x: number, y: number, w: number, h: number, [l, t, r, b]: readonly [number, number, number, number]) => ({ x: x + l, y: y + t, w: Math.max(0, w - l - r), h: Math.max(0, h - t - b) });

/** Draw a clip on the art canvas cut to its inner rect (a button's word): the frame around it is the C plate, the word stays pixels. */
function drawInset(s: { getArt: () => CanvasRenderingContext2D | null; inArt: boolean; arts: number }, m: DOMMatrix, x: number, y: number, w: number, h: number, inset: readonly [number, number, number, number], draw: (c: CanvasRenderingContext2D) => void) {
    const art = s.getArt();
    if (!art) return;
    const r = insetRect(x, y, w, h, inset);
    art.save();
    art.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    art.beginPath(); art.rect(r.x, r.y, r.w, r.h); art.clip();
    s.inArt = true;
    try { draw(art); } finally { s.inArt = false; art.restore(); }
    s.arts++;
}

/** Art that is not a clip (a partner picture): drawn in its own pixels on the art canvas, never dropped. */
export function artHook(ctx: CanvasRenderingContext2D | undefined, draw: (ctx: CanvasRenderingContext2D) => void) {
    const s = cur;
    if (!s || s.inArt || ctx !== s.ctx) return false;
    const art = s.getArt();
    if (!art) return false;
    const m = ctx!.getTransform();
    art.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    s.inArt = true;
    try { draw(art); } finally { s.inArt = false; }
    s.arts++;
    return true;
}

/** The text hook (web/native-screen-text.js): the runs the widgets would have drawn. */
export function runsHook(runs: UiRun[]) {
    if (!cur) return false;
    for (const r of runs) cur.runs.push(r);
    return true;
}

/** True inside a scope that takes plain drawText() calls on `ctx` (web/uifont.js asks before it paints). */
export const capturingText = (ctx: CanvasRenderingContext2D | null | undefined) => !!cur && !cur.inArt && cur.texts && ctx === cur.ctx;

/** A drawText() run (web/uifont.js builds it with the same pens it would paint). Returns true when the scope took it. */
export function textRunHook(ctx: CanvasRenderingContext2D | null | undefined, run: UiRun) {
    if (!capturingText(ctx)) return false;
    cur!.runs.push(run);     // ETS item 9: capturingText just proved `cur` is set
    return true;
}

/**
 * A part the game paints with plain canvas calls, not a clip (the battle's HP bar fill, the "No techs!" panel): the owner hands its
 * native rect and data; the part gets the matrix of the draw relative to the scope start like a clip. Returns true when taken.
 */
export function partHook(ctx: CanvasRenderingContext2D | undefined, part: UiHookPart) {
    const s = cur;
    if (!s || s.inArt || ctx !== s.ctx) return false;
    const rel = relative(s.m0, ctx!.getTransform());
    s.parts.push({ layer: "under", bx: 0, by: 0, ...part, rel });
    s.claimed.push({ pack: null, id: String(part.part), part: part.part });
    return true;
}
