// web/ui-c/geometry.js -- look C kit: pure placement maths (no DOM, no window). The overlay keeps every part rect in NATIVE units (the
// game's 320x240 space); this file turns them into whole page pixels. Lines and edges land on whole screen pixels (user decision):
// the left and top edge use floor, the right and bottom edge use round, so two touching parts stay flush.

export const NATIVE_W = 320;
export const NATIVE_H = 240;
/** Page px a part may bleed past the native box (a window that touches a screen side runs on to the limit). */
export const BLEED_MARGIN = 1e5;

/**
 * Where the native 320x240 space lands on the page. `m0` = the 2D transform at the start of the scope ({a,d,e,f}, canvas px), `canvas` =
 * { w, h } the canvas pixel size, `box` = { left, top, width, height } the canvas content box in page px. Returns { s, ox, oy }:
 * s = page px per native px, (ox, oy) = the page px of native (0,0).
 */
export function placement(m0, canvas, box) {
    const kx = box.width / canvas.w, ky = box.height / canvas.h;
    return { s: m0.a * kx, sy: m0.d * ky, ox: box.left + m0.e * kx, oy: box.top + m0.f * ky };
}

/** The transform of a draw relative to the scope start: m = m0 * rel, so a native point p lands at rel.a * p + rel.e. Pure scale + translate. */
export function relative(m0, m) {
    const a = m.a / m0.a, d = m.d / m0.d;
    return { a, d, e: (m.e - m0.e) / m0.a, f: (m.f - m0.f) / m0.d };
}
export const IDENTITY = Object.freeze({ a: 1, d: 1, e: 0, f: 0 });

/** A native rect through a relative transform (the fold / slide / zoom the renderer applies about a pivot). */
export function applyRel(r, rel) {
    return { x: r.x * rel.a + rel.e, y: r.y * rel.d + rel.f, w: r.w * rel.a, h: r.h * rel.d };
}

/** Does the native rect touch the left / right edge of the 320 box (then it bleeds). */
export function bleedFlags(r) {
    return { left: r.x <= 0, right: r.x + r.w >= NATIVE_W };
}

/**
 * Native rect -> whole page px rect { left, top, right, bottom, width, height } relative to the overlay root.
 * `rootOrigin` = page px of the root's top-left, `limit` = { left, top, right, bottom } the bleed limit relative to the root.
 */
export function snapRect(r, pl, rootOrigin, limit, bleed = true) {
    const fl = bleed ? bleedFlags(r) : { left: false, right: false };
    const x0 = pl.ox - rootOrigin.x + r.x * pl.s, x1 = pl.ox - rootOrigin.x + (r.x + r.w) * pl.s;
    const y0 = pl.oy - rootOrigin.y + r.y * pl.sy, y1 = pl.oy - rootOrigin.y + (r.y + r.h) * pl.sy;
    const left = fl.left ? Math.floor(limit.left) : Math.floor(x0);
    const right = fl.right ? Math.round(limit.right) : Math.round(x1);
    const top = Math.floor(y0), bottom = Math.round(y1);
    return { left, top, right, bottom, width: right - left, height: Math.max(bottom - top, 0) };
}

/** The sizes every part shares, in page px for `s` page px per native px. e1 = edge, e2 = under-edge, sh = drop shadow, d = px per design px. */
export function edges(s) {
    return { u: s, d: s / 3, e1: Math.max(1, Math.round(s * 4 / 3)), e2: Math.max(1, Math.round(s * 2 / 3)), sh: Math.round(2 * s) };
}

/** The full-screen fade the pause pages submit as a semi-transparent flat quad: 0..1 darkening (the DOM layer takes brightness(1 - dim)). */
export function dimOf(quads = []) {
    let dim = 0;
    for (const q of quads) if (q.semiTransparent && q.w >= NATIVE_W && q.h >= NATIVE_H) dim = Math.max(dim, Math.min(1, q.r / 255));
    return dim;
}

/** The visible part of the page in native units { x0, y0, x1, y1 } for placement `pl` and the root's page box `limit`: on a wide stage x0 < 0 and
 *  x1 > 320 (the side area), on 4:3 it is 0..320 x 0..240, on a tall stage y0 < 0. */
export function visibleNative(pl, limit) {
    const sy = pl.sy ?? pl.s;
    return { x0: (limit.left - pl.ox) / pl.s, x1: (limit.left + limit.width - pl.ox) / pl.s, y0: (limit.top - pl.oy) / sy, y1: (limit.top + limit.height - pl.oy) / sy };
}

/** Design px (the C files, drawn at 3 px per native px on a 1280x720 page with the native box at x 160) -> native units. */
export const dx = (px) => (px - 160) / 3;
export const dy = (px) => px / 3;
