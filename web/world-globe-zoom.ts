// web/world-globe-zoom.js -- pure maths of the World Globe zoom (the dev page web/world-globe.html and the pause MAP book
// web/world-globe-book.js): one zoom value z in [0, 1] takes the view from the whole globe down to the real top-down picture
// of one place's screen, seen in a round "map window" pinned on the globe at the place's icon, with a "you are here" dot.
// z sets everything: the camera's distance (log-linear, so every step zooms by the same factor), its tilt (oblique on the
// globe, straight down at z = 1), what it looks at (globe centre -> the look point), the swap of the place's icon for its window
// (ZOOM_BANDS.swap: the icon fades out while the window grows in from the icon's size, and back), the window's size on the
// globe and on the picture, the tint, the globe's fade and the digital grid transition (ZOOM_BANDS.transition).
// The player turns the look point at every z (drag on the dev page, arrows / stick in the menu); the zoom goes into the place
// whose icon is nearest the screen centre (your own place until you first turn), and that place is kept once its window shows.
// The three.js side is web/world-globe-zoom-view.js. No DOM, no three.js: tests/world-globe-zoom.test.js runs it in node.
//
// The window: a disc on the plane touching the globe at the icon (a little above the ground). Its centre stays on the icon;
// on the picture the centre slides from the "you are here" dot (or the picture centre) at z = 0 to the picture's centre at
// z = 1 while its radius grows from ZOOM.circle0 px to just past the picture's half diagonal, so at z = 1 the whole picture is
// inside the opaque part. The picture's scale on the plane (globe radii per px) = the window's globe radius / its px radius.
import { lonLatToPoint, pointToLonLat } from "./world-globe-map.js";
import type { FramePoint, LonLat, Point3 } from "./types/world-globe-map.js";
import type {
    TangentFrame, ZoomBand, ZoomCamera, ZoomInput, ZoomState, ZoomStepEnv, ZoomTarget, ZoomTileInfo, ZoomView,
} from "./types/world-globe-zoom.js";
import type { GlobeMoves } from "./world-globe-map.js";

/** The zoom's numbers (chosen, not from the disc). Heights / radii in globe radii. */
export const ZOOM = Object.freeze({
    /** camera distance from the look point at z = 0 (whole globe in view) and at z = 1 (picture fills the view) */
    height0: 2.2,
    height1: 0.35,
    /** camera tilt from straight down at z = 0 */
    tilt0: (35 * Math.PI) / 180,
    /** the window plane's distance from the globe centre (just above the ground, under nothing) */
    planeR: 1.003,
    /** radius of the place icons' centres (web/world-globe-view.ts PIN_R) */
    pinR: 1.004,
    /** share of the view the picture fills at z = 1 (the tighter of width / height) */
    fill: 0.96,
    /** the window circle's radius on the picture at z = 0 (native px) */
    circle0: 240,
    /** the soft edge: share of the radius it fades over, and how far the painted wobble moves it */
    feather: 0.1,
    wobble: 0.04,
    /** tint toward the globe palette: after the real map shows (fades out by ZOOM_BANDS.trueColour), and the painted look before */
    tint: 0.3,
    paint: 0.6,
    /** blur of the painted look (texture LOD bias, mip levels) */
    blur: 3.5,
    /** grid: the scan line's soft width as a share of the window's px radius */
    sweepSoft: 0.12,
    /** turning: radians per second per globe radius of camera height (43 deg a second at z = 0) */
    turnRate: 0.34,
    /** zooming with held buttons: z per second */
    zoomRate: 0.35,
    /** panning over a window (z past the swap): the look point stays within this many view half-heights of the place */
    panReach: 1,
    /** the globe camera's vertical field of view (degrees; web/world-globe-view.ts makes its camera with it) */
    fovDeg: 45,
});

/** The z bands. swap = the place icon fades out while its window grows in (the place is kept from swap[0] on); pull = the look
 *  point is drawn onto the place by the end of it; transition = the digital grid; trueColour = the tint fades out; globeFade =
 *  the globe fades to the background; ramp = how fast the grid comes and goes at the band's ends; sweep = the scan line's travel. */
export const ZOOM_BANDS = Object.freeze({
    swap: [0.1, 0.3] as const satisfies ZoomBand,
    pullEnd: 0.3,
    transition: [0.45, 0.7] as const satisfies ZoomBand,
    trueColour: [0.6, 0.92] as const satisfies ZoomBand,
    globeFade: [0.6, 0.9] as const satisfies ZoomBand,
    ramp: 0.05,
    sweep: [0.47, 0.68] as const satisfies ZoomBand,
});

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** cubic smoothstep of x over [e0, e1] */
export const smoothstep = (e0: number, e1: number, x: number): number => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
/** quintic ease of t in 0..1 (zero speed and acceleration at both ends) */
export const smootherstep = (t: number): number => { const c = clamp(t, 0, 1); return c * c * c * (c * (c * 6 - 15) + 10); };

const add = (a: Point3, b: Point3): Point3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: Point3, s: number): Point3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Point3, b: Point3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Point3, b: Point3): Point3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: Point3): Point3 => mul(a, 1 / Math.hypot(a.x, a.y, a.z));

/** The plane touching a sphere of radius r at a place: east = growing longitude, north = normal x east (so with the camera
 *  looking down the normal and its up = north, east is screen right and the picture's x / y run east / south). */
export function tangentFrame(ll: LonLat, r = 1): TangentFrame {
    const normal = lonLatToPoint(ll, 1);
    const east = unit({ x: -Math.sin(ll.lon), y: 0, z: -Math.cos(ll.lon) });
    return { origin: mul(normal, r), east, north: cross(normal, east), normal };
}

/** camera distance from the look point: log-linear in z (each equal z step = the same zoom factor) */
export const zoomHeight = (z: number): number => ZOOM.height0 * Math.pow(ZOOM.height1 / ZOOM.height0, clamp(z, 0, 1));
/** camera tilt from straight down: tilt0 at z = 0, 0 at z = 1, eased */
export const zoomTilt = (z: number): number => ZOOM.tilt0 * (1 - smoothstep(0, 1, z));

/** The place icon's opacity at z (1 before the swap, 0 after); the window's is 1 minus it, so the two never leave a gap. */
export const iconAlphaAt = (z: number): number => 1 - smoothstep(ZOOM_BANDS.swap[0], ZOOM_BANDS.swap[1], z);

/** the bump 0 -> 1 -> 0 over a band, ramping in / out over `ramp` at its ends */
const bandBump = (b: ZoomBand, ramp: number, z: number): number => smoothstep(b[0], b[0] + ramp, z) * (1 - smoothstep(b[1] - ramp, b[1], z));

/** The camera at z looking at `look`: from the south of it, tilted, aimed at the globe centre at z = 0; straight above it,
 *  aimed at it, at z = 1. */
export function zoomCamera(look: LonLat, zIn: number): ZoomCamera {
    const z = clamp(zIn, 0, 1);
    const { origin, north, normal } = tangentFrame(look, ZOOM.planeR);
    const height = zoomHeight(z), tilt = zoomTilt(z);
    return {
        camera: add(origin, mul(sub(mul(normal, Math.cos(tilt)), mul(north, Math.sin(tilt))), height)),
        target: mul(origin, smoothstep(0, 1, z)),
        up: north, height, tilt,
    };
}

/** The window circle's radius on the picture at z = 1: the half diagonal sits inside the opaque part even where the wobble
 *  pulls the edge in. */
export function finalCircle(mapW: number, mapH: number): number {
    return Math.hypot(mapW / 2, mapH / 2) / (1 - ZOOM.feather - ZOOM.wobble);
}

/** Everything zoom value z sets (see the head of this file). */
export function zoomState(zIn: number, inp: ZoomInput): ZoomState {
    const z = clamp(zIn, 0, 1);
    const frame = tangentFrame(inp.place, ZOOM.planeR);
    const t = Math.tan((inp.fovDeg * Math.PI) / 360);
    const cam = zoomCamera(inp.look, z);
    // window: circle on the picture (centre at the dot or the picture centre -> picture centre, radius circle0 -> finalCircle)
    const s = smootherstep(z);
    const r0 = Math.min(ZOOM.circle0, inp.mapW / 2, inp.mapH / 2), r1 = finalCircle(inp.mapW, inp.mapH);
    const from = inp.spot ?? { x: inp.mapW / 2, y: inp.mapH / 2 };
    const c0 = { x: clamp(from.x, r0, inp.mapW - r0), y: clamp(from.y, r0, inp.mapH - r0) };
    const centre = { x: lerp(c0.x, inp.mapW / 2, s), y: lerp(c0.y, inp.mapH / 2, s) };
    const radius = lerp(r0, r1, s);
    // its radius on the globe: the icon's until the swap starts; at z = 1 the picture fits the view (fill share of the tighter side)
    const halfW1 = ZOOM.fill * ZOOM.height1 * t * Math.min(inp.aspect, inp.mapW / inp.mapH);
    const world1 = r1 * (halfW1 / (inp.mapW / 2));
    const u = clamp((z - ZOOM_BANDS.swap[0]) / (1 - ZOOM_BANDS.swap[0]), 0, 1);
    const worldRadius = inp.iconRadius * Math.pow(world1 / inp.iconRadius, u);
    // scan line: from above the circle's top to below its bottom over the sweep band
    const sweepSoft = ZOOM.sweepSoft * radius;
    const v = smoothstep(ZOOM_BANDS.sweep[0], ZOOM_BANDS.sweep[1], z);
    const top = centre.y - radius * 1.1 - sweepSoft, bottom = centre.y + radius * 1.1 + sweepSoft;
    const iconAlpha = iconAlphaAt(z);
    return {
        z, frame, ...cam,
        near: clamp(cam.height * 0.05, 0.002, 0.05), far: cam.height + 6,
        scale: worldRadius / radius, centre, radius, worldRadius,
        iconAlpha, windowAlpha: 1 - iconAlpha,
        tint: ZOOM.tint * (1 - smoothstep(ZOOM_BANDS.trueColour[0], ZOOM_BANDS.trueColour[1], z)),
        paint: ZOOM.paint, blur: ZOOM.blur,
        globeFade: smoothstep(ZOOM_BANDS.globeFade[0], ZOOM_BANDS.globeFade[1], z),
        gridAmount: bandBump(ZOOM_BANDS.transition, ZOOM_BANDS.ramp, z),
        sweepY: lerp(top, bottom, v), sweepSoft,
    };
}

/** picture px -> point on the window plane (globe space) */
export function mapPxToWorld(st: ZoomState, p: FramePoint): Point3 {
    const { origin, east, north } = st.frame;
    return add(origin, add(mul(east, (p.x - st.centre.x) * st.scale), mul(north, -(p.y - st.centre.y) * st.scale)));
}

/** point (on or above the window plane) -> picture px under it */
export function worldToMapPx(st: ZoomState, w: Point3): FramePoint {
    const d = sub(w, st.frame.origin);
    return { x: st.centre.x + dot(d, st.frame.east) / st.scale, y: st.centre.y - dot(d, st.frame.north) / st.scale };
}

/** The 4x4 matrix (column-major, three.js Matrix4.elements order) that takes picture px (x, y, 0) to globe space; z = the
 *  plane's normal in globe radii. */
export function mapPxMatrix(st: ZoomState): number[] {
    const { east: e, north: n, normal: k } = st.frame, s = st.scale;
    const o = mapPxToWorld(st, { x: 0, y: 0 });
    return [e.x * s, e.y * s, e.z * s, 0, -n.x * s, -n.y * s, -n.z * s, 0, k.x, k.y, k.z, 0, o.x, o.y, o.z, 1];
}

/** The shown z eases toward the wanted one (time constant `tau` seconds): smooth whatever the wheel / keys do. */
export function stepZoom(shown: number, wanted: number, dtSec: number, tau = 0.15): number {
    const k = 1 - Math.exp(-Math.max(0, dtSec) / tau);
    const next = shown + (clamp(wanted, 0, 1) - shown) * k;
    return Math.abs(next - wanted) < 1e-5 ? clamp(wanted, 0, 1) : next;
}

// ---- the view: turning, zooming, which place the zoom goes into ----

/** the angle between two places on the globe (radians) */
export function arcBetween(a: LonLat, b: LonLat): number {
    return Math.acos(clamp(dot(lonLatToPoint(a), lonLatToPoint(b)), -1, 1));
}

/** the point a share t of the way from a to b along the globe */
export function slerpLonLat(a: LonLat, b: LonLat, t: number): LonLat {
    const pa = lonLatToPoint(a), pb = lonLatToPoint(b);
    const w = Math.acos(clamp(dot(pa, pb), -1, 1));
    if (w < 1e-9 || t <= 0) return t >= 1 ? { ...b } : { ...a };
    if (t >= 1) return { ...b };
    const sw = Math.sin(w), ka = Math.sin((1 - t) * w) / sw, kb = Math.sin(t * w) / sw;
    return pointToLonLat(add(mul(pa, ka), mul(pb, kb)));
}

/** How far from the screen centre each place icon is seen from a camera (in units of the focal length: the tangent of the angle
 *  off the view axis), or Infinity when it is behind the camera or past the globe's horizon. */
export function iconOffCentre(cam: ZoomCamera, ll: LonLat): number {
    const p = lonLatToPoint(ll, ZOOM.pinR), c = cam.camera;
    if (dot(lonLatToPoint(ll, 1), c) <= 1) return Infinity;           // past the horizon (web/world-globe-view.ts faceIcons)
    const f = unit(sub(cam.target, c)), right = unit(cross(f, cam.up)), up = cross(right, f);
    const d = sub(p, c), depth = dot(d, f);
    if (!(depth > 0)) return Infinity;
    return Math.hypot(dot(d, right) / depth, dot(d, up) / depth);
}

/** The place whose icon is nearest the screen centre (index into targets, -1 when none is in sight); `shown` leaves out the
 *  places whose icon is hidden (not visited: web/world-globe-reveal.ts iconShown). */
export function nearestTarget(cam: ZoomCamera, targets: readonly ZoomTarget[], shown?: (target: number) => boolean): number {
    let best = -1, bestD = Infinity;
    targets.forEach((t, i) => {
        if (shown && !shown(i)) return;
        const d = iconOffCentre(cam, t.lonLat);
        if (d < bestD) { bestD = d; best = i; }
    });
    return best;
}

/** where the view opens: looking at your place (or nothing turned yet), whole globe in view */
export function startZoomView(look: LonLat, home: number): ZoomView {
    return { look: { ...look }, z: 0, target: home, turned: false };
}

/** the target is kept from the swap on (its window shows); before it, the shown place nearest the centre (your own until you turn) */
function retarget(v: ZoomView, env: ZoomStepEnv): ZoomView {
    if (v.z >= ZOOM_BANDS.swap[0] && v.target >= 0) return v;
    const target = !v.turned && env.home >= 0 ? env.home : nearestTarget(zoomCamera(v.look, v.z), env.targets, env.shown);
    return target === v.target ? v : { ...v, target };
}

/** Turn the view: the look point moves `east` / `north` radians along the ground. Over a window (target kept) it pans, as far
 *  as ZOOM.panReach view half-heights from the place; it never goes past a pole's limit (GLOBE_VIEW.latMax). */
export function turnView(v: ZoomView, east: number, north: number, env: ZoomStepEnv, latMax: number): ZoomView {
    if (!east && !north) return v;
    let look: LonLat = { lon: v.look.lon + east / Math.max(0.2, Math.cos(v.look.lat)), lat: clamp(v.look.lat + north, -latMax, latMax) };
    look = { lon: Math.atan2(Math.sin(look.lon), Math.cos(look.lon)), lat: look.lat };
    const t = env.targets[v.target];
    if (t && v.z >= ZOOM_BANDS.swap[0]) {
        const reach = ZOOM.panReach * zoomHeight(v.z) * Math.tan((env.fovDeg * Math.PI) / 360);
        const before = arcBetween(v.look, t.lonLat), after = arcBetween(look, t.lonLat);
        const lim = Math.max(reach, before);
        if (after > lim) look = slerpLonLat(t.lonLat, look, lim / after);
    }
    return retarget({ ...v, look, turned: true }, env);
}

/** Set z (clamped to 0..1, and below the swap while the target's picture is not in); zooming in draws the look point onto the
 *  target so it is on the place by ZOOM_BANDS.pullEnd. */
export function zoomView(v: ZoomView, zWanted: number, env: ZoomStepEnv): ZoomView {
    // the target as it stands at the lower z (a place first picked here is the one zoomed into)
    const want = clamp(zWanted, 0, 1);
    const at = retarget({ ...v, z: Math.min(want, v.z) }, env);
    // only a zoom in asks for the picture (a turn at a held z loads nothing)
    const zMax = want > v.z && at.target >= 0 && env.ready(at.target) ? 1 : ZOOM_BANDS.swap[0];
    const z = Math.min(want, Math.max(zMax, Math.min(v.z, want)));
    if (z === v.z) return retarget(v, env);
    let look = v.look;
    const t = env.targets[at.target];
    if (t && z > v.z && v.z < ZOOM_BANDS.pullEnd) look = slerpLonLat(v.look, t.lonLat, Math.min(1, (z - v.z) / (ZOOM_BANDS.pullEnd - v.z)));
    return retarget({ ...at, look, z }, env);
}

/** One step of held buttons (the menu): directions turn at ZOOM.turnRate x the camera height, L1 / R1 zoom at ZOOM.zoomRate. */
export function stepZoomView(v: ZoomView, m: GlobeMoves, env: ZoomStepEnv, dtSec: number, latMax: number): ZoomView {
    const dt = Math.max(0, dtSec);
    const turn = ZOOM.turnRate * zoomHeight(v.z) * dt;
    const dx = (m.right ? 1 : 0) - (m.left ? 1 : 0), dy = (m.up ? 1 : 0) - (m.down ? 1 : 0);
    const dz = (m.zoomIn ? 1 : 0) - (m.zoomOut ? 1 : 0);
    let next = turnView(v, dx * turn, dy * turn, env, latMax);
    next = zoomView(next, next.z + dz * ZOOM.zoomRate * dt, env);
    return next;
}

/** A drag of (dx, dy) screen px on a view `viewH` px tall: the ground under the pointer moves with it (the look point the
 *  other way), so a drag turns the globe at every zoom. Returns the east / north radians for turnView. */
export function dragTurn(z: number, dxPx: number, dyPx: number, viewH: number, fovDeg: number): { east: number; north: number } {
    const perPx = (2 * zoomHeight(z) * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewH);
    return { east: -dxPx * perPx, north: dyPx * perPx };
}

// ETS item 42: assets-hd/map-tiles/index.json comes from outside, so it enters as unknown and is checked here.
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, what: string): number => { if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`map-tiles index: ${what} is not a number`); return v; };

/** One map's entry of the HD tile index, or null when the index has no such map. */
export function parseTileInfo(raw: unknown, name: string): ZoomTileInfo | null {
    if (!isRec(raw)) throw new Error("map-tiles index: not an object");
    const maps = raw["maps"];
    if (!isRec(maps)) throw new Error("map-tiles index: maps is not an object");
    const m = maps[name];
    if (m === undefined) return null;
    if (!isRec(m)) throw new Error(`map-tiles index: ${name} is not an object`);
    const skipRaw = m["skip"];
    const skip = Array.isArray(skipRaw) ? skipRaw.map((p: unknown, i: number) => {
        if (!Array.isArray(p) || p.length !== 2) throw new Error(`map-tiles index: ${name}.skip[${i}] is not a pair`);
        return `${num(p[0], `${name}.skip[${i}]`)}_${num(p[1], `${name}.skip[${i}]`)}`;
    }) : [];
    return {
        name, w: num(m["w"], `${name}.w`), h: num(m["h"], `${name}.h`), cols: num(m["cols"], `${name}.cols`), rows: num(m["rows"], `${name}.rows`),
        skip, tile: num(raw["tile"], "tile"), gutter: num(raw["gutter"], "gutter"), scale: num(raw["scale"], "scale"),
    };
}
