// HD Remaster wide overworld (F2 -> Screen -> "Wide overworld", off by default; Authentic never uses it).
//
// The disc's field screen is 320x240 and the game draws it at 2x (640x480, ledger UI-DISPLAY-EXTENT-001).
// With the setting on, in window-fill or fullscreen, the field takes the screen's shape instead: the same
// 240 lines and the same zoom, with extra map shown at the two sides. Everything that is not the field
// world -- menus, text boxes, wipes' geometry, the camera's own rule -- keeps the original 320x240 box,
// which sits in the middle of the wider view. So the box coordinates every screen already uses do not
// change; the field world simply goes on past the box's left and right edges.
//
// Where the wider view could show something the original never showed, the view goes back to the
// original framing (FIELD_FALLBACK): the sides are covered and the camera eases back to the disc's own
// clamp. See fieldFrameRule below for when.
//
// FIELD_VIEW_W / FIELD_VIEW_PAD are live bindings: the view-sized field layers (grass3d, water3d,
// ambience, scenery*, treesway) import FIELD_VIEW_W as their view width, and the caller hands them the
// camera of the WIDE view's left edge (box camera - FIELD_VIEW_PAD).

export const NATIVE_VIEW_W = 320;   // 0x140, the field camera's view width (engine/systems/field-camera.ts)
export const NATIVE_VIEW_H = 240;   // 0xF0
export const NATIVE_CENTRE_X = 0xa0;
export const MAX_WIDE_ASPECT = 21 / 9;

/** Native map pixels of extra view on EACH side of the 320 box (0 = the original view). */
export let FIELD_VIEW_PAD = 0;
/** Native width of the whole field view: 320 + 2 * pad. */
export let FIELD_VIEW_W = NATIVE_VIEW_W;

export function setFieldViewPad(pad) {
    const p = Math.max(0, Math.floor(Number(pad) || 0));
    FIELD_VIEW_PAD = p;
    FIELD_VIEW_W = NATIVE_VIEW_W + 2 * p;
    return p;
}

/** The pad for a stage of this CSS size: the view is 240 lines tall and as wide as the stage's shape,
 *  never narrower than 4:3 and never wider than MAX_WIDE_ASPECT. */
export function widePadFor(stageW, stageH, maxAspect = MAX_WIDE_ASPECT) {
    if (!(stageW > 0) || !(stageH > 0)) return 0;
    const aspect = Math.min(Math.max(stageW / stageH, NATIVE_VIEW_W / NATIVE_VIEW_H), maxAspect);
    const w = Math.round(NATIVE_VIEW_H * aspect);
    return Math.max(0, Math.floor((w - NATIVE_VIEW_W) / 2));
}

/** True when the map is at least as wide as the whole wide view, so the wider camera can clamp
 *  inside it. A narrower map keeps the original framing (its own edges would show). */
export function mapFitsWide(mapW, pad) {
    return pad > 0 && mapW >= NATIVE_VIEW_W + 2 * pad;
}

/** The BOX camera x (top-left of the 320 box, in map pixels) for the wide view: the wide view is
 *  centred on the target exactly as the original centres its 320 view (target - 160), then clamped
 *  inside the map, and the box is the wide view's middle. Same low-then-ceiling clamp as F0x8008D788.
 *  Returns null when the map is narrower than the wide view. */
export function wideBoxCameraX(targetX, mapW, pad) {
    if (!mapFitsWide(mapW, pad)) return null;
    const left = Math.min(Math.max(targetX - NATIVE_CENTRE_X - pad, 0), mapW - NATIVE_VIEW_W - 2 * pad);
    return left + pad;
}

// A field event that moves an actor or the camera is staged against the original 320x240 screen: an
// actor placed or walking just outside it, or a camera aimed so a thing is out of frame. Measured over
// web/assets/events/wstag_events.json (2026-10-27): of 384 events, WALKTO is in 266, SETPOS in 265,
// FN6A (camera on an actor) in 147, FN6B (camera on a point) in 63. A plain talk (SAY / WAIT / SETANIM
// only) moves nothing, so it keeps the wide view.
const STAGED_OPS = new Set(["WALKTO", "SETPOS", "FN6A", "FN6B"]);
export function scriptIsStaged(opcodes) {
    if (!Array.isArray(opcodes)) return false;
    for (const line of opcodes) {
        if (typeof line !== "string") continue;
        const op = line.trim().split(/\s+/, 1)[0];
        if (STAGED_OPS.has(op)) return true;
    }
    return false;
}

/**
 * What this frame's wide field may do.
 *   wideCamera: the camera uses the wide clamp (false = the disc's own clamp).
 *   showSides:  the extra map at the sides is visible (false = the sides are covered).
 * A full-screen screen (menu, shop, status ...) keeps the camera where it is and covers the sides, so the
 * field does not jump under it. A staged scene, a fixed-viewport stage and a map too narrow go back to the
 * original framing completely.
 */
export function fieldFrameRule({ pad, mapW, fixedViewport = false, stagedScene = false, nativeCentre = false, labCamera = false, fullScreenUi = false }) {
    if (!(pad > 0)) return { wideCamera: false, showSides: false };
    const original = fixedViewport || stagedScene || nativeCentre || labCamera || !mapFitsWide(mapW, pad);
    if (original) return { wideCamera: false, showSides: false };
    return { wideCamera: true, showSides: !fullScreenUi };
}

/** How dark the world beside a full-screen menu gets (HD Remaster + Wide overworld): the level a book uses behind its box. */
export const MENU_SIDE_DIM = 0.5;

/**
 * The sides behind a full-screen screen. A screen that owns the whole picture: covered black.
 * A screen that only draws over the field (`dimmableUi`: every open screen is such): the sides stay showing the field, dimmed.
 */
export function wideMenuSides({ fullScreenUi = false, dimmableUi = false }) {
    const keep = !!fullScreenUi && !!dimmableUi;
    return { coverSides: !!fullScreenUi && !keep, dim: keep ? MENU_SIDE_DIM : 0 };
}

/** Ease a 0..1 level toward a target at `rate` per second (the side covers and the camera blend). */
export function easeLevel(level, target, dt, rate = 6) {
    const step = Math.max(0, dt) * rate;
    if (level < target) return Math.min(target, level + step);
    if (level > target) return Math.max(target, level - step);
    return level;
}
