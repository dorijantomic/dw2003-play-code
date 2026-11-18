// web/ui-c/layers.js -- look C kit: the DOM side. One root (#ui-c-root) in #stage, one layer per scope (key), four containers inside a
// layer, bottom to top: under (wall, plate bodies), the art canvas, over (highlights, bars, cursors), text. Parts are kept by key and
// rewritten only when their signature changes. A layer its owner has not refreshed for 3 display frames is removed.
import { buildPart, fillPart } from "./parts.js";
import { edges, snapRect } from "./geometry.js";

const EXPIRE_MS = 60, EXPIRE_FRAMES = 3;
let root = null, rafId = 0, frameNo = 0;
const scopes = new Map();     // key -> { el, c: { under, over, text }, art, artCtx, artUsed, maps, seen, seenFrame, dim, last }

const hasDom = () => typeof document !== "undefined";

export function ensureRoot(stage) {
    if (root && root.isConnected) return root;
    root = document.createElement("div");
    root.id = "ui-c-root";
    stage.appendChild(root);
    return root;
}

/** The page rects of the current frame: the canvas content box, the bleed limit (stage when it fills the window, else the canvas). */
export function frameGeometry(canvas, stage) {
    const cr = canvas.getBoundingClientRect();
    const box = { left: cr.left + canvas.clientLeft, top: cr.top + canvas.clientTop, width: canvas.clientWidth, height: canvas.clientHeight };
    const fills = document.documentElement.classList.contains("window-fill") || !!document.fullscreenElement;
    const sr = stage.getBoundingClientRect();
    const limit = fills ? { left: sr.left, top: sr.top, width: sr.width, height: sr.height } : box;
    return { box, limit, stageRect: sr };
}

function scopeFor(key) {
    let s = scopes.get(key);
    if (s) return s;
    const el = document.createElement("div");
    el.className = "uic-scope";
    el.dataset.uicScope = key;
    const under = document.createElement("div"), art = document.createElement("canvas"), over = document.createElement("div"), text = document.createElement("div");
    under.className = over.className = text.className = "uic-layer";
    under.dataset.uicLayer = "under"; over.dataset.uicLayer = "over"; text.dataset.uicLayer = "text";
    art.className = "uic-art";
    el.append(under, art, over, text);
    root.appendChild(el);
    s = { el, c: { under, over, text }, art, artCtx: null, artUsed: false, maps: { under: new Map(), over: new Map(), text: new Map() }, seen: 0, seenFrame: 0, dim: -1, last: null };
    scopes.set(key, s);
    return s;
}

/** Called at scope start: size the root and the art canvas for this frame; returns the art-context getter. */
export function prepare(key, stage, canvas) {
    ensureRoot(stage);
    const g = frameGeometry(canvas, stage);
    const rs = root.style;
    rs.left = `${g.limit.left - g.stageRect.left}px`; rs.top = `${g.limit.top - g.stageRect.top}px`;
    rs.width = `${g.limit.width}px`; rs.height = `${g.limit.height}px`;
    const s = scopeFor(key);
    const a = s.art, as = a.style;
    as.left = `${g.box.left - g.limit.left}px`; as.top = `${g.box.top - g.limit.top}px`; as.width = `${g.box.width}px`; as.height = `${g.box.height}px`;
    if (a.width !== canvas.width || a.height !== canvas.height) { a.width = canvas.width; a.height = canvas.height; s.artCtx = null; }
    if (s.artUsed) { (s.artCtx ??= a.getContext("2d")).setTransform(1, 0, 0, 1, 0, 0); s.artCtx.clearRect(0, 0, a.width, a.height); s.artUsed = false; }
    return { geo: g, scope: s, getArt: () => { s.artUsed = true; s.artCtx ??= a.getContext("2d"); s.artCtx.imageSmoothingEnabled = false; return s.artCtx; } };
}

const KIND_LAYER = { text: "text", type: "under" };
/** Kinds that never bleed to the stage edge (a balloon at the screen edge stays a balloon). index.js check() uses the same set. */
export const NO_BLEED = new Set(["text", "type", "chevron", "icon", "bar", "corners", "bracket", "balloon", "ring", "dock", "pop", "node", "svg-nb"]);

/** A page rect (relative to the root) as a CSS inset() over the root's `limit` box. */
export const clipInset = (c, limit) => {
    const r = Math.max(0, limit.width - c.left - c.width), b = Math.max(0, limit.height - c.top - c.height);
    return `inset(${Math.max(0, c.top)}px ${r}px ${b}px ${Math.max(0, c.left)}px)`;
};

/** Write the descriptors of one scope. `pl` = placement, `geo` = frameGeometry, `dim` = 0..1, `clip` = a native rect the whole layer is
 *  cut to (the place card's slit), null = none. */
export function commit(key, descs, pl, geo, dim, clip = null) {
    const s = scopeFor(key);
    s.seen = performance.now();
    s.seenFrame = frameNo;
    const ed = edges(pl.s);
    root.style.setProperty("--u", `${pl.s}px`);
    root.style.setProperty("--e1", `${ed.e1}px`);
    root.style.setProperty("--e2", `${ed.e2}px`);
    root.style.setProperty("--sh", `${ed.sh}px`);
    root.style.setProperty("--d", `${ed.d}px`);
    const origin = { x: geo.limit.left, y: geo.limit.top };
    const limitRel = { left: 0, top: 0, right: geo.limit.width, bottom: geo.limit.height };
    const order = { under: [], over: [], text: [] };
    for (const d of descs) {
        const layer = d.layer ?? KIND_LAYER[d.kind] ?? "over";
        const r = d.full
            ? { left: 0, top: 0, right: geo.limit.width, bottom: geo.limit.height, width: geo.limit.width, height: geo.limit.height }
            : snapRect(d.rect, pl, origin, limitRel, !NO_BLEED.has(d.nb ? "svg-nb" : d.kind));
        const g = { rect: r, ed, sx: d.sx ?? 1, sy: d.sy ?? 1 };
        const sig = `${JSON.stringify(d)}|${r.left},${r.top},${r.width},${r.height}|${pl.s}`;
        const map = s.maps[layer];
        let rec = map.get(d.key);
        if (!rec) { rec = { el: buildPart(d, g), sig }; map.set(d.key, rec); }
        else if (rec.sig !== sig) { fillPart(rec.el, d, g); rec.sig = sig; }
        rec.el.dataset.uicKind = d.nb ? "svg-nb" : d.kind;
        rec.el.dataset.uicNative = JSON.stringify(d.full ? { full: true } : d.rect);
        order[layer].push({ key: d.key, el: rec.el });
    }
    for (const layer of ["under", "over", "text"]) {
        const cont = s.c[layer], keep = new Set(order[layer].map((o) => o.key));
        for (const [k, rec] of s.maps[layer]) if (!keep.has(k)) { rec.el.remove(); s.maps[layer].delete(k); }
        order[layer].forEach((o, i) => { if (cont.children[i] !== o.el) cont.insertBefore(o.el, cont.children[i] ?? null); });
    }
    const cp = clip ? clipInset(snapRect(clip, pl, origin, limitRel, true), geo.limit) : "";
    if (s.el.style.clipPath !== cp) s.el.style.clipPath = cp;
    if (dim !== s.dim) { s.dim = dim; s.el.style.filter = dim > 0 ? `brightness(${+(1 - dim).toFixed(4)})` : ""; }
    s.last = { descs: descs.length };
    if (!rafId) rafId = requestAnimationFrame(tick);
}

function tick() {
    rafId = 0;
    frameNo++;
    const now = performance.now();
    for (const [key, s] of scopes) {
        if (now - s.seen > EXPIRE_MS && frameNo - s.seenFrame >= EXPIRE_FRAMES) { s.el.remove(); scopes.delete(key); }
    }
    if (scopes.size) rafId = requestAnimationFrame(tick);
}

/** Remove a scope now (its owner is drawing pixels again). */
export function hide(key) {
    const s = scopes.get(key);
    if (!s) return;
    s.el.remove();
    scopes.delete(key);
}

export const scopeKeys = () => [...scopes.keys()];
export const rootEl = () => root;
export const scopeEl = (key) => scopes.get(key)?.el ?? null;
export { hasDom };
