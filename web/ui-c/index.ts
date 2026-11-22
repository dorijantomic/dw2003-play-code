// web/ui-c/index.js -- look C kit: the public API the screens call, and window.__uiC (the live checks).
//
//   uiC.scope(key, ctx, { enable, compose, dim, clip }, fn)   run fn (the screen's own painting) inside a capture scope; clip = a
//                                                        native rect the whole layer is cut to (the place card slit)
//   uiC.capturing()                                      true inside a scope (owners skip pixels the scope rebuilds)
//   uiC.hide(key)                                        a screen drew pixels again: take its layer away
//   uiC.cover(on)                                        the battle paints over the whole field this frame (web/game.js): every
//                                                        scope without opts.top draws its old pixels (the battle covers them, as
//                                                        in the pixel game) and its layer goes; opts.top = the battle's own scope
//   opts.texts                                           the scope also takes plain drawText() calls as runs (the battle HUD)
//
// The overlay is the default look; there is no option, no toggle and no URL flag. setEnabled() exists only as a development hook
// (the ui-lab side-by-side view turns it off in the Pixel pane); it is not saved, a reload is "on" again.
import * as cap from "./capture.js";
import * as layers from "./layers.js";
import { placement, snapRect, edges, visibleNative } from "./geometry.js";
import { composeShared } from "./message.js";
import type { FrameGeometry } from "./layers.js";
import type { UiCaptureScope, UiMatrix, UiPart, UiScopeClaimed, UiScopeOpts, UiScopeUnclaimed } from "./types.js";

/** The page placement of the native box (geometry.placement). */
type Placement = ReturnType<typeof placement>;
/** What the one `[ui-c] off:` console line reports: the failing check's own values. */
interface OffValues {
    display?: string;
    visibility?: string;
    opacity?: string;
    position?: string;
    zIndex?: string;
    sentinel?: string;
    rect?: { w: number; h: number; };
    styleSheets?: number;
    cover?: { id: string; tag: string; z: number; bg: string; };
}
/** The failing health check: why look C is not on screen, and the values it saw. */
interface HealthFault { reason: string; values: OffValues; }
/** One scope's coverage report (window.__uiC.coverage). */
interface ScopeReport {
    claimed: UiScopeClaimed[];
    unclaimed: UiScopeUnclaimed[];
    flatUnclaimed: number;
    canvasText: number;
    runs: number;
    parts: number;
}
/** One overlay part that sits off its snapped native rect (window.__uiC.check). */
interface CheckPart {
    key: string | undefined;
    kind: string | undefined;
    want: { left: number; top: number; width: number; height: number; };
    got: { left: number; top: number; width: number; height: number; };
    err: number;
}

export { capturing } from "./capture.js";

let enabled = true;
let covered = false;
let fontsOk = false;
let fontFailed = false, fontsAt = 0, fontsTry = 0;
const fontStatus: Record<string, string> = {};         // face -> "pending" | "ok" | "empty" | "error: ..."
let broken: { until: number; } | null = null;            // { until } while the fail-safe is on: pixels drawn, no overlay (re-tested after BROKEN_MS)
let offLogged = false, lastReason = "";
const ROOT_Z = 12;            // frame.css: must stay in step
const BROKEN_MS = 3000, HEALTH_MS = 500, FONT_GIVE_UP_MS = 5000;
const healthAt = new Map<string, number>();   // key -> performance.now() of its last health check
const reports = new Map<string, ScopeReport>();    // key -> last scope report (coverage)
const costs: number[] = [];             // ms of compose + commit per scope, last 240
let lastPl: Placement | null = null, lastGeo: FrameGeometry | null = null;

const hasDom = () => typeof document !== "undefined";

const FACES = ['400 16px "Russo One"', '500 16px "Chakra Petch"', '600 16px "Chakra Petch"', '700 16px "Chakra Petch"'];

/** Fonts are local files (web/ui-c/fonts); until all four faces are loaded the screens stay pixel. A failed load is tried again later
 *  (see available()); the status of every face is kept for the `[ui-c] off:` line. */
function loadFonts() {
    if (!hasDom() || !document.fonts?.load) return;
    fontsAt = performance.now(); fontsTry++;
    for (const f of FACES) fontStatus[f] = "pending";
    Promise.all(FACES.map((f) => document.fonts.load(f).then(
        (l) => { fontStatus[f] = l.length > 0 ? "ok" : "empty"; return l.length > 0; },
        (e) => { fontStatus[f] = `error: ${e?.message ?? e}`; return false; },
    ))).then((r) => { fontsOk = r.every(Boolean); fontFailed = !fontsOk; });
}
loadFonts();

const chromeVersion = () => (typeof navigator !== "undefined" ? navigator.userAgent : "no navigator");

/** The ONE console line when look C does not show (once per page): the exact failing check with its values. */
function noteOff(reason: string, values: OffValues) {
    lastReason = reason;
    if (offLogged) return;
    offLogged = true;
    const v = JSON.stringify({ ...values, fonts: { ...fontStatus }, fontsTries: fontsTry, ua: chromeVersion() });
    console.warn(`[ui-c] off: ${reason} ${v}`);
}

/** A later or higher positioned sibling in #stage that is shown, nearly opaque and covers the root (the overlay would sit under it). */
function coveredBy(root: HTMLElement, rr: DOMRect) {
    const sibs = root.parentNode?.children ?? [];
    const rz = parseInt(getComputedStyle(root).zIndex, 10) || 0;
    const at = [...sibs].indexOf(root);
    for (let i = 0; i < sibs.length; i++) {
        // ETS item 9: i is below sibs.length
        const s = sibs[i]!;
        if (s === root) continue;
        const c = getComputedStyle(s);
        if (c.display === "none" || c.visibility === "hidden" || c.position === "static" || !(parseFloat(c.opacity) > 0.5)) continue;
        const z = parseInt(c.zIndex, 10);
        if (Number.isNaN(z) || z < rz || (z === rz && i < at)) continue;
        const a = /^rgba\(.*,\s*([\d.]+)\)$/.exec(c.backgroundColor);
        if (c.backgroundColor === "transparent" || (a && parseFloat(a[1]!) < 0.99) || !c.backgroundColor.startsWith("rgb")) continue;
        const b = s.getBoundingClientRect();
        if (b.width >= rr.width * 0.9 && b.height >= rr.height * 0.9) return { id: s.id, tag: (s as Element & { tag?: string; }).tag ?? s.tagName, z, bg: c.backgroundColor };
    }
    return null;
}

/**
 * Is look C really on screen? Cached (HEALTH_MS per scope key), run right after a scope commit. Returns null when all is well, else
 * { reason, values }. Checks: root attached, its CSS applied (position, z-index, the --uic-ok sentinel of tokens.css), computed
 * display / visibility / opacity, a nonzero rect, the scope's own layer inside the root.
 */
function health(key: string, now: number): HealthFault | null {
    const last = healthAt.get(key);
    if (last !== undefined && now - last < HEALTH_MS) return null;
    healthAt.set(key, now);
    const root = layers.rootEl();
    if (!root || !root.isConnected) return { reason: "root not attached", values: {} };
    const cs = getComputedStyle(root);
    const r = root.getBoundingClientRect();
    const values = {
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity, position: cs.position, zIndex: cs.zIndex,
        sentinel: cs.getPropertyValue("--uic-ok").trim(), rect: { w: r.width, h: r.height },
    };
    const sheets = typeof document.styleSheets !== "undefined" ? document.styleSheets.length : -1;
    if (values.sentinel !== "1") return { reason: "css not applied (--uic-ok sentinel missing)", values: { ...values, styleSheets: sheets } };
    if (values.position !== "absolute" || values.zIndex !== String(ROOT_Z)) return { reason: "css not applied (root position/z-index)", values };
    if (values.display === "none") return { reason: "root display none", values };
    if (values.visibility !== "visible") return { reason: "root not visible", values };
    if (!(parseFloat(values.opacity) > 0)) return { reason: "root opacity 0", values };
    if (!(r.width > 0 && r.height > 0)) return { reason: "root rect empty", values };
    const el = layers.scopeEl(key);
    if (!el || el.parentNode !== root) return { reason: "scope layer missing", values };
    const over = coveredBy(root, r);
    if (over) return { reason: `root covered by #${over.id || over.tag}`, values: { ...values, cover: over } };
    return null;
}

/** True when the overlay can draw right now. */
export function available() {
    if (!enabled || !hasDom()) return false;
    const now = performance.now();
    if (!fontsOk) {
        if (fontFailed && now - fontsAt > BROKEN_MS) loadFonts();   // a failed load is tried again
        else if (!fontFailed && now - fontsAt > FONT_GIVE_UP_MS) noteOff("fonts not loaded after 5 s", {});
        if (fontFailed) noteOff("fonts failed to load", {});
        return false;
    }
    if (broken && now < broken.until) return false;
    return !!document.getElementById("stage");
}

const toM = (t: DOMMatrix): Required<UiMatrix> => ({ a: t.a, d: t.d, e: t.e, f: t.f });

/**
 * Run `fn` (a screen's own painting) and show it as look C. Returns true when the overlay drew it. When `opts.enable` is false or the kit
 * is not ready, `fn` runs unchanged and the old pixels are drawn.
 */
export function scope(key: string, ctx: CanvasRenderingContext2D, opts: UiScopeOpts, fn: () => void) {
    const canvas = ctx?.canvas;
    if (!opts?.enable || !available() || !canvas || !canvas.isConnected || (covered && !opts.top)) { layers.hide(key); reports.delete(key); fn(); return false; }
    if (opts.top) topKeys.add(key);
    const stage = document.getElementById("stage");
    const prep = layers.prepare(key, stage, canvas);
    cap.begin(key, ctx, toM(ctx.getTransform()), prep.getArt, { texts: !!opts.texts });
    let seen: UiCaptureScope = null as unknown as UiCaptureScope;     // ETS item 9: cap.end() ran for this scope, so it is set after the try
    try { fn(); } finally { seen = cap.end()!; }
    const t0 = performance.now();
    const pl = placement(seen.m0, { w: canvas.width, h: canvas.height }, prep.geo.box);
    const descs = composeShared(seen.parts, opts.compose!({ parts: seen.parts, runs: seen.runs, stage: visibleNative(pl, prep.geo.limit) }));
    layers.commit(key, descs, pl, prep.geo, opts.dim ?? 0, opts.clip ?? null);
    const bad = health(key, performance.now());
    if (bad) {
        // Look C is not really on screen: take it all away and draw this frame's plain pixels (as with setEnabled(false)).
        noteOff(bad.reason, bad.values);
        broken = { until: performance.now() + BROKEN_MS };
        for (const k of layers.scopeKeys()) layers.hide(k);
        reports.clear();
        fn();
        return false;
    }
    broken = null;
    lastPl = pl; lastGeo = prep.geo;
    costs.push(performance.now() - t0); if (costs.length > 240) costs.shift();
    reports.set(key, {
        claimed: seen.claimed, unclaimed: seen.unclaimed,
        flatUnclaimed: seen.unclaimed.filter((u) => u.flat).length,
        canvasText: 0, runs: seen.runs.length, parts: descs.length,
    });
    return true;
}

export const hide = (key: string) => { layers.hide(key); reports.delete(key); };

/** The battle covers the whole field this frame (on) or not (off): see the header. Takes the field-level layers away at once. */
export function cover(on: boolean) {
    const was = covered;
    covered = !!on;
    if (!covered || was) return;
    for (const k of [...reports.keys()]) if (!topKeys.has(k)) reports.delete(k);
    if (hasDom()) for (const k of layers.scopeKeys()) if (!topKeys.has(k)) layers.hide(k);
}
const topKeys = new Set<string>();     // scopes that sit over the battle (its own HUD): never covered

// ------------------------------------------------------------------------------------------------ live checks
function check() {
    const root = layers.rootEl();
    if (!root || !lastPl) return { count: 0, worst: 0, note: "overlay not showing", parts: [] };
    const parts: CheckPart[] = [];
    let worst = 0, count = 0;
    const origin = { x: lastGeo!.limit.left, y: lastGeo!.limit.top };
    const limitRel = { left: 0, top: 0, right: lastGeo!.limit.width, bottom: lastGeo!.limit.height };
    const rr = root.getBoundingClientRect();
    for (const e of root.querySelectorAll<HTMLElement>("[data-uic-native]")) {
        const nat = JSON.parse(e.dataset.uicNative!);
        const bleed = !layers.NO_BLEED.has(e.dataset.uicKind!);
        const want = nat.full ? { left: 0, top: 0, width: limitRel.right, height: limitRel.bottom } : snapRect(nat, lastPl, origin, limitRel, bleed);
        const got = e.getBoundingClientRect();
        const gx = got.left - rr.left, gy = got.top - rr.top;
        const textLike = e.dataset.uicKind === "text" || e.dataset.uicKind === "type";
        const exact = !textLike || e.style.textAlign === "right";
        const err = Math.max(Math.abs(gx - want.left), Math.abs(gy - want.top), exact ? Math.abs(got.width - want.width) : 0, exact && !textLike ? Math.abs(got.height - want.height) : 0);
        worst = Math.max(worst, err); count++;
        if (err > 0.5) parts.push({ key: e.dataset.uicKey, kind: e.dataset.uicKind, want, got: { left: gx, top: gy, width: got.width, height: got.height }, err });
    }
    return { count, worst, s: lastPl.s, edges: edges(lastPl.s), parts };
}

function coverage() {
    const out: Record<string, ScopeReport & { domText: number; }> = {};
    for (const [k, v] of reports) {
        const el = layers.scopeEl(k);
        out[k] = { ...v, domText: el ? el.querySelectorAll("[data-uic-text]").length : 0 };
    }
    return out;
}

const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);

if (hasDom()) {
    window.__uiC = {
        check, coverage,
        setEnabled: (on: boolean) => { enabled = !!on; if (!enabled) for (const k of layers.scopeKeys()) layers.hide(k); },
        enabled: () => enabled,
        ready: () => fontsOk,
        off: () => ({ broken: !!broken, logged: offLogged, reason: lastReason, fonts: { ...fontStatus } }),
        texts: () => [...(layers.rootEl()?.querySelectorAll<HTMLElement>("[data-uic-text]") ?? [])].map((e) => e.dataset.uicText),
        overflow: () => [...(layers.rootEl()?.querySelectorAll<HTMLElement>("[data-uic-fits='0']") ?? [])].map((e) => e.dataset.uicText),
        layers: () => layers.scopeKeys(),
        cost: () => ({ n: costs.length, median: median(costs), max: Math.max(0, ...costs) }),
    };
}
