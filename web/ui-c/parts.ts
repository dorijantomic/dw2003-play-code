// web/ui-c/parts.js -- look C kit: part descriptor -> DOM. The shape maths is pure (tested in node); the element builders use `document`.
// Every polygon is written in design px (the C files at 3 px per native px) times `d` = page px per design px, so one set of numbers
// serves every window size. Edges (e1 / e2) and the drop shadow are whole page px.
import { chevronSvg } from "./icons.js";
import { ROLES, FACE, fitRun, measureText } from "./text.js";
import { fillVic } from "./vic.js";
import type { UiPart } from './types.js';
interface BalloonTail { side: string; b0: number; b1: number; tip: number[]; }

interface PartRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
interface PartEdges {
  u: number;
  d: number;
  l?: number;
  r?: number;
}
interface PartGeom {
  rect: PartRect;
  ed: PartEdges;
  sx: number;
  sy: number;
}


const pt = (list: number[][]) => `polygon(${list.map(([x, y]) => `${+x.toFixed(3)}px ${+y.toFixed(3)}px`).join(",")})`;

/**
 * The silhouette of a plate of W x H page px. Returns { outer, inner, box } : outer = polygon of the edge layer, box = { l, t, r, b }
 * the body inset (page px), inner = polygon of the body (relative to the body box). Solid shapes have no inner.
 * Shapes (C files): sr = slanted right end (cards, money plate), sl = slanted left end (header), row = chamfer top-left (list rows, name
 * plate), rowSolid = the same, one colour (active row), tab = chamfer top-left + slanted right (LV tab), wall = big chamfer top-left,
 * ch = chamfer top-left + bottom-right (frame).
 */
export function plateShape(shape, W, H, d, e1, e2, underEdge = "e2") {
    const k = d;
    switch (shape) {
        case "sr": {
            const bw = W - e1, bh = H - 2 * e1;
            return { outer: pt([[0, 0], [W, 0], [W - 40 * k, H], [0, H]]), box: { l: 0, t: e1, r: e1, b: e1 }, inner: pt([[0, 0], [bw - 2 * k, 0], [bw - 39 * k, bh], [0, bh]]) };
        }
        case "sl": {
            const bw = W - e1, bh = H - 2 * e1;
            return { outer: pt([[40 * k, 0], [W, 0], [W, H], [0, H]]), box: { l: e1, t: e1, r: 0, b: e1 }, inner: pt([[41 * k, 0], [bw, 0], [bw, bh], [2 * k, bh]]) };
        }
        case "row": {
            const b = underEdge === "e1" ? e1 : e2, bh = H - b;
            return { outer: pt([[14 * k, 0], [W, 0], [W, H], [0, H], [0, 14 * k]]), box: { l: 0, t: 0, r: 0, b }, inner: pt([[13 * k, 0], [W, 0], [W, bh], [0, bh], [0, 13 * k]]) };
        }
        case "key": {
            // C7 keyboard key / name slot: chamfer 8 px top-left; the body sits on a 2 px under-edge (keys) or inside an e1 edge all round (slots)
            const all = underEdge === "all", b = all ? e1 : e2, bw = all ? W - 2 * e1 : W, bh = H - (all ? 2 * e1 : b);
            return { outer: pt([[8 * k, 0], [W, 0], [W, H], [0, H], [0, 8 * k]]), box: all ? { l: e1, t: e1, r: e1, b: e1 } : { l: 0, t: 0, r: 0, b }, inner: pt([[7 * k, 0], [bw, 0], [bw, bh], [0, bh], [0, 7 * k]]) };
        }
        case "kb": {
            // C7 keyboard button (DEL / SPC / arrows / OK): chamfer 14 px top-left + bottom-right, edge all round
            const bw = W - 2 * e1, bh = H - 2 * e1;
            return { outer: pt([[14 * k, 0], [W, 0], [W, H - 14 * k], [W - 14 * k, H], [0, H], [0, 14 * k]]), box: { l: e1, t: e1, r: e1, b: e1 }, inner: pt([[13 * k, 0], [bw, 0], [bw, bh - 13 * k], [bw - 13 * k, bh], [0, bh], [0, 13 * k]]) };
        }
        case "rowSr": {
            // C8 battle command row: chamfer 14 px top-left, the right end slanted 20 px; the body sits on an under-edge (e2) only
            const bh = H - e2;
            return { outer: pt([[14 * k, 0], [W, 0], [W - 20 * k, H], [0, H], [0, 14 * k]]), box: { l: 0, t: 0, r: 0, b: e2 }, inner: pt([[13 * k, 0], [W - 1 * k, 0], [W - 1 * k - 20 * k * bh / H, bh], [0, bh], [0, 13 * k]]) };
        }
        case "rowSrSolid":
            return { outer: pt([[14 * k, 0], [W, 0], [W - 20 * k, H], [0, H], [0, 14 * k]]), box: null, inner: null };
        case "srs": {
            // C8 HP plate name slab: the right end slanted 24 px (solid)
            return { outer: pt([[0, 0], [W, 0], [W - 24 * k, H], [0, H]]), box: null, inner: null };
        }
        case "rowSolid":
            return { outer: pt([[14 * k, 0], [W, 0], [W, H], [0, H], [0, 14 * k]]), box: null, inner: null };
        case "tab":
            return { outer: pt([[16 * k, 0], [W, 0], [W - 20 * k, H], [0, H], [0, 16 * k]]), box: null, inner: null };
        case "wall":
            return { outer: pt([[60 * k, 0], [W, 0], [W, H], [0, H], [0, 60 * k]]), box: null, inner: null };
        case "wallL":
            return { outer: pt([[120 * k, 0], [W, 0], [W, H], [0, H]]), box: null, inner: null };
        case "frame": {
            const bw = W - 2 * e1, bh = H - 2 * e1;
            return { outer: pt([[0, 0], [W, 0], [W, H], [0, H]]), box: { l: e1, t: e1, r: e1, b: e1 }, inner: pt([[0, 0], [bw, 0], [bw, bh], [0, bh]]) };
        }
        case "rb": {
            // C4 stat window: open on the left (it bleeds off the screen), chamfer 24 px bottom-right only (inner 22 px)
            const bw = W - e1, bh = H - 2 * e1;
            return { outer: pt([[0, 0], [W, 0], [W, H - 24 * k], [W - 24 * k, H], [0, H]]), box: { l: 0, t: e1, r: e1, b: e1 }, inner: pt([[0, 0], [bw, 0], [bw, bh - 22 * k], [bw - 22 * k, bh], [0, bh]]) };
        }
        case "bandCh": {
            // the C3 list window: full-width band, edge top and bottom only, chamfer bottom-left (24 px, inner 22 px)
            const bh = H - 2 * e1;
            return { outer: pt([[0, 0], [W, 0], [W, H], [24 * k, H], [0, H - 24 * k]]), box: { l: 0, t: e1, r: 0, b: e1 }, inner: pt([[0, 0], [W, 0], [W, bh], [22 * k, bh], [0, bh - 22 * k]]) };
        }
        case "chip": {
            // the C9 chip / cell: chamfer 10 px top-left; with a body, an e1 edge all round
            const bw = W - 2 * e1, bh = H - 2 * e1;
            return { outer: pt([[10 * k, 0], [W, 0], [W, H], [0, H], [0, 10 * k]]), box: { l: e1, t: e1, r: e1, b: e1 }, inner: pt([[9 * k, 0], [bw, 0], [bw, bh], [0, bh], [0, 9 * k]]) };
        }
        case "ch": {
            const c = 24 * k, ci = 22 * k, bw = W - 2 * e1, bh = H - 2 * e1;
            return { outer: pt([[c, 0], [W, 0], [W, H - c], [W - c, H], [0, H], [0, c]]), box: { l: e1, t: e1, r: e1, b: e1 }, inner: pt([[ci, 0], [bw, 0], [bw, bh - ci], [bw - ci, bh], [0, bh], [0, ci]]) };
        }
        default:
            return { outer: pt([[0, 0], [W, 0], [W, H], [0, H]]), box: null, inner: null };
    }
}

/**
 * The swap bracket path in page px for a W x H box, `u` page px per native px, `arrows` = arrow centre y (page px). Stroke 2 native,
 * arrow heads 7 native long and 8 native tall with the tip at x 0; the bar runs between the two arrows on the right side.
 */
export function bracketPath(W, H, u, arrows) {
    const t = Math.max(2, Math.round(2 * u)), head = Math.round(7 * u), half = Math.round(4 * u);
    const barX = Math.round(W - t - 2 * u), ys = arrows.map((a) => Math.round(a));
    if (!ys.length) return "";
    const top = Math.min(...ys), bot = Math.max(...ys), half2 = Math.floor(t / 2);
    let d = `M${barX} ${top - half2}H${barX + t}V${bot + t - half2}H${barX}Z`;
    for (const y of ys) d += `M0 ${y}L${head} ${y - half}V${y - half2}H${barX}V${y - half2 + t}H${head}V${y + half}Z`;
    return d;
}

/**
 * The 135 degree stripe field (C2: 24 dp light, 48 dp dark, period 72 dp) scrolled by the game's counter `scroll` (native px moved along
 * x and y at once). The move is a phase shift of the colour stops along the gradient axis (a diagonal move of (o, o) is o * sqrt 2 along
 * it), so the field never restarts a tile: no seam, whatever the offset.
 */
export function stripesGradient(scroll, d, light = "var(--c-stripe)", dark = "var(--c-stripe-dark)") {
    const P = 72 * d, L = 24 * d, o = scroll * 3 * d * Math.SQRT2;
    const ph = ((o % P) + P) % P;                     // where the light stripe starts, 0..P
    const f = (n: number) => `${+n.toFixed(2)}px`;
    // one period from 0 to P: light from ph to ph + L (wrapping past P), dark elsewhere
    if (ph + L <= P) return `repeating-linear-gradient(135deg, ${dark} 0 ${f(ph)}, ${light} ${f(ph)} ${f(ph + L)}, ${dark} ${f(ph + L)} ${f(P)})`;
    return `repeating-linear-gradient(135deg, ${light} 0 ${f(ph + L - P)}, ${dark} ${f(ph + L - P)} ${f(ph)}, ${light} ${f(ph)} ${f(P)})`;
}

// ------------------------------------------------------------------------------------------------ the C balloon (C6)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
/** The line p + t * d moved by `e` along its normal towards `inside`: returns [point, dir]. */
function offsetLine(p: number[], q: number[], inside: number[], e: number): [number[], number[]] {
    const d = sub(q, p), len = Math.hypot(d[0]!, d[1]!) || 1;
    let n = [-d[1]! / len, d[0]! / len];
    const m = sub(inside, p);
    if (n[0]! * m[0]! + n[1]! * m[1]! < 0) n = [-n[0]!, -n[1]!];
    return [[p[0] + n[0]! * e, p[1] + n[1]! * e], d];
}
function cross(a: [number[], number[]], b: [number[], number[]]) {
    const [p, r] = a, [q, s] = b, den = r[0]! * s[1]! - r[1]! * s[0]!;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((q[0]! - p[0]!) * s[1]! - (q[1]! - p[1]!) * s[0]!) / den;
    return [p[0]! + t * r[0]!, p[1]! + t * r[1]!];
}
const atY = ([p, d], y) => (Math.abs(d[1]) < 1e-9 ? null : [p[0] + (y - p[1]) * d[0] / d[1], y]);

/**
 * The balloon silhouette in page px (C6): body box `b` = { l, t, w, h } with the 24 dp chamfer top-left and bottom-right (`c`), an edge of
 * `e` px, and an optional tail { side, b0, b1, tip } on the top or bottom edge. Returns { outer, inner } as point lists. The inner line runs
 * `e` px inside the outer one everywhere, the tail too (its sides are offset along their normals, so a slanted tail keeps the same edge).
 */
export function balloonShape(b: { l: number; t: number; w: number; h: number; }, tail: BalloonTail | null, e: number, c: number): { outer: number[][]; inner: (number[] | undefined)[] } {
    const { l, t, w, h } = b, r = l + w, bo = t + h;
    const ci = c - e / 2;   // the inner chamfer (C6: 24 outer, the inner diagonal 22 + 4 down / right)
    const outer = [], inner = [];
    let tl = null;
    if (tail) {
        const top = tail.side === "top";
        const lo = top ? l + c + 1 : l + 2, hi = top ? r - 2 : r - c - 1;
        const b0 = Math.max(lo, Math.min(tail.b0, tail.b1)), b1 = Math.min(hi, Math.max(tail.b0, tail.b1));
        const by = top ? t : bo, tip = tail.tip;
        if (b1 - b0 >= 4 && (top ? tip[1] < t - e : tip[1] > bo + e)) {
            const iy = top ? t + e : bo - e, mid = [(b0 + b1) / 2, by];
            const A = offsetLine([b0, by], tip, [b1, by], e), B = offsetLine(tip, [b1, by], [b0, by], e);
            const itip = cross(A, B), i0 = atY(A, iy), i1 = atY(B, iy);
            const ok = itip && i0 && i1 && i0[0] < i1[0] && (top ? itip[1]! < iy : itip[1]! > iy);
            tl = { top, b0, b1, by, tip, inner: ok ? [i0, itip, i1] : null, mid };
        }
    }
    // outer: clockwise from the top-left chamfer
    outer.push([l + c, t]);
    if (tl?.top) outer.push([tl.b0, t], tl.tip, [tl.b1, t]);
    outer.push([r, t], [r, bo - c], [r - c, bo]);
    if (tl && !tl.top) outer.push([tl.b1, bo], tl.tip, [tl.b0, bo]);
    outer.push([l, bo], [l, t + c]);
    // inner: the same path e px in
    inner.push([l + e + ci, t + e]);
    if (tl?.top && tl.inner) inner.push(tl.inner[0], tl.inner[1], tl.inner[2]);
    inner.push([r - e, t + e], [r - e, bo - e - ci], [r - e - ci, bo - e]);
    if (tl && !tl.top && tl.inner) inner.push(tl.inner[2], tl.inner[1], tl.inner[0]);
    inner.push([l + e, bo - e], [l + e, t + e + ci]);
    return { outer, inner };
}

/** Bar fill width in whole page px for ratio 0..1 over a track of `w` px. */
export const barFill = (ratio, w) => Math.max(0, Math.min(w, Math.round(w * Math.max(0, Math.min(1, ratio)))));

// ------------------------------------------------------------------------------------------------ DOM
const el = (cls: string, parent?: Element, tag = "div"): HTMLElement => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
};
const px = (n) => `${Math.round(n)}px`;
const setBox = (e, r) => { e.style.left = px(r.left); e.style.top = px(r.top); e.style.width = px(r.width); e.style.height = px(r.height); };

/** Build the element for `desc` and fill it for the current geometry `g` = { rect (snapped page px), ed (edges), sx, sy (scale vs native) }. */
export function buildPart(desc: UiPart, g: PartGeom) {
    const root = el(`uic-part uic-${desc.kind}`);
    root.dataset.uicKey = desc.key;
    fillPart(root, desc, g);
    return root;
}

// ---------------------------------------------------------------------------------------------------------- the living ring
const SVGNS = 'xmlns="http://www.w3.org/2000/svg"';
/** Ring sizes (design px, the C file): [radius, stroke] of every arc, by variant. Mirrors base.RING (parts.js imports no composer). */
export const RING_SHAPE = Object.freeze({
    main: { vb: 360, ticks: [[167, 6, ".9 5.1", "tk"], [167, 10, "1.4 58.6", "tk"], [167, 5, "55 305", "scan"]], back: [[137, 5, ".6 4.4", "tk2"]], dv: [174, 3], dvt: [174, 2], hp: [150, 16], mp: [124, 9], core: 110 },
    mini: { vb: 150, ticks: [[72, 5, ".9 5.1", "tk"]], back: [], dv: null, dvt: null, hp: [60, 9], mp: [47, 5], core: 50 },
});
/** The stroke-dasharray of an arc whose path is 100 long, for a fraction 0..1. */
export const arcDash = (f) => `${+(Math.min(1, Math.max(0, f)) * 100).toFixed(3)} 100`;

/** Build the ring's inside once (rotating tick layers as their own elements so the compositor spins them), then only move the arcs. */
function fillRing(root, desc, g) {
    const r = g.rect, sh = RING_SHAPE[desc.variant] ?? RING_SHAPE.main, c = sh.vb / 2, id = `r${String(desc.key).replace(/[^a-z0-9]/gi, "")}`;
    root.className = `uic-part uic-ring uic-ring-${desc.variant}`;
    root.dataset.uicPart = desc.part;
    root.dataset.uicRect = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    root.style.position = "absolute"; setBox(root, r);
    if (root.dataset.uicRingV !== desc.variant) {
        const circ = (cls, rad, w, extra = "") => `<circle class="${cls}" cx="${c}" cy="${c}" r="${rad}" stroke-width="${w}" fill="none" ${extra}/>`;
        const arc = (cls: string, rad, w, grad?: string) => circ(cls, rad, w, `pathLength="100" transform="rotate(-90 ${c} ${c})" style="stroke-dasharray:0 100"${grad ? ` stroke="url(#${id}${grad})"` : ""}`);
        const ticks = (list) => list.map(([rad, w, da, cls]) => circ(cls, rad, w, `pathLength="360" stroke-dasharray="${da}"${cls === "scan" ? ` stroke="url(#${id}s)"` : ""}`)).join("");
        const svg = (inner, cls = "") => `<svg ${SVGNS} class="${cls}" viewBox="0 0 ${sh.vb} ${sh.vb}" aria-hidden="true">${inner}</svg>`;
        const stop = (o: number, v: string) => `<stop offset="${o}" style="stop-color:${v}"/>`;
        const defs = `<defs><linearGradient id="${id}h" x1="0" y1="0" x2="1" y2="1">${stop(0, "var(--c-hp-a)")}${stop(1, "var(--c-hp-b)")}</linearGradient>`
            + `<linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1">${stop(0, "var(--c-mp-a)")}${stop(1, "var(--c-mp-b)")}</linearGradient>`
            + `<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style="stop-color:var(--c-cyan);stop-opacity:0"/>${stop(1, "#bff0ff")}</linearGradient>`
            + `<radialGradient id="${id}c" cx=".5" cy=".38" r=".76"><stop offset="0" style="stop-color:#0c2264;stop-opacity:.9"/><stop offset="1" style="stop-color:#00061c;stop-opacity:.95"/></radialGradient></defs>`;
        const base = defs + (sh.dvt ? circ("dvt", sh.dvt[0], sh.dvt[1]) : "") + circ("trk", sh.hp[0], sh.hp[1]) + arc("sf hp", sh.hp[0], sh.hp[1], "h")
            + circ("trk", sh.mp[0], sh.mp[1]) + arc("sf mpx", sh.mp[0], sh.mp[1]) + arc("sf mp", sh.mp[0], sh.mp[1], "m")
            + `<circle class="disc" cx="${c}" cy="${c}" r="${sh.core}" fill="url(#${id}c)"/>`;
        root.innerHTML = `<div class="uic-ring-spin">${svg(ticks(sh.ticks))}</div>`
            + (sh.back.length ? `<div class="uic-ring-spin rev">${svg(ticks(sh.back))}</div>` : "")
            + svg(base, "uic-ring-base")
            + (sh.dv ? `<div class="uic-ring-dv">${svg(arc("sf dv", sh.dv[0], sh.dv[1]))}</div>` : "");
        if (desc.variant === "main") root.insertAdjacentHTML("beforeend", `<div class="uic-ring-pulse"></div>`);
        root.addEventListener("animationend", (e) => { const n = String(e.animationName); if (n.startsWith("uic-ring-pulse-")) delete root.dataset.pulse; else if (n.startsWith("uic-ring-hurt-")) delete root.dataset.hurt; });
        root.dataset.uicRingV = desc.variant;
        root.dataset.uicMenu = desc.menu ? "1" : "0";
    }
    // the command menu closing (a command was confirmed) = one pulse out of the ring; the menu opening does nothing
    if (desc.variant === "main" && root.dataset.uicMenu === "1" && !desc.menu) root.dataset.pulse = root.dataset.pulse === "a" ? "b" : "a";
    root.dataset.uicMenu = desc.menu ? "1" : "0";
    const set = (cls: string, f) => { const e = root.querySelector(`.${cls}`); if (e) e.style.strokeDasharray = arcDash(f); };
    // the real HP the game holds (read-only): a drop is remembered for the damage number that pops when the game's line appears
    if (desc.variant === "main" && desc.real != null) {
        const now = performance.now(), pr = root.dataset.uicReal === undefined ? null : Number(root.dataset.uicReal), pe = root.dataset.uicEReal === undefined ? null : Number(root.dataset.uicEReal);
        if (pr !== null && desc.real < pr) { root.dataset.dropP = String(pr - desc.real); root.dataset.dropPT = String(now); }
        if (pe !== null && desc.eReal < pe) { root.dataset.dropE = String(pe - desc.eReal); root.dataset.dropET = String(now); }
        root.dataset.uicReal = String(desc.real); root.dataset.uicEReal = String(desc.eReal);
    }
    // a drop of the shown HP = one short hurt shake of the whole ring (CSS, restarts only when the last one ended)
    const hpPrev = root.dataset.uicHp === undefined ? null : Number(root.dataset.uicHp);
    if (desc.variant === "main" && hpPrev !== null && desc.hp < hpPrev - 0.0005 && !root.dataset.hurt) root.dataset.hurt = "a";
    const prev = desc.mpPrev != null;       // the MP a technique would spend: the arc shows what is left, the lost part glows
    set("mpx", prev ? desc.mp : 0); set("hp", desc.hp); set("mp", prev ? desc.mpPrev : desc.mp); set("dv", desc.dv);
    root.classList.toggle("act", !!desc.act); root.classList.toggle("prev", prev);
    root.dataset.uicHp = String(desc.hp); root.dataset.uicMp = String(desc.mp); root.dataset.uicDv = String(desc.dv);
    root.classList.toggle("full", !!desc.dvFull);
    root.dataset.hpState = desc.hp < 0.25 ? "low" : desc.hp < 0.5 ? "mid" : "ok";      // the enemy bar's thresholds (battlehud foeState); ring.css recolours the HP arc
    root.classList.toggle("down", !!desc.down);
}

// ---------------------------------------------------------------------------------------------------------- the command dock
/** Design numbers of the dock (size / line / spacing / scale mirror base.DOCK_WORD; parts.js imports no composer). `arc` = the guide circle's radius in its own
 *  viewBox units (the part's k = arcR / arc scales it to the real arc); the dock's radius, the pointer length and the list row's parts come from the descriptor. */
export const DOCK_SHAPE = Object.freeze({ size: 40, line: 46, spacing: 2, scale: 1.7, arc: 330, guide: [-90, 36], dockArc: [-34, 14], listSize: 30, listLine: 36, chip: 76, cost: 60, gap: 16 });

/**
 * The command dock: the six words each at a fixed slot on the arc around the ring, the focused one slid into the dock beside the ring. Built
 * once per geometry; a focus change only toggles `.on` (CSS transition for the slide, the kick for the feedback), so elements and animations live on.
 */
function fillDock(root, desc, g) {
    const r = g.rect, d = g.ed.d, s = d * 3, D = DOCK_SHAPE, o = desc.rect;
    const rel = (x, y) => [(x - o.x) * s, (y - o.y) * s];
    root.className = "uic-part uic-dock";
    root.dataset.uicPart = desc.part;
    root.dataset.uicRect = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    root.style.position = "absolute"; setBox(root, r);
    const struct = `${desc.list ? "L" + desc.title + (desc.pager ? "p" : "") : "C"}${desc.words.map((w) => `${w.t}@${w.x.toFixed(2)},${w.y.toFixed(2)},${w.maxDp},${w.chip ?? ""},${w.r ?? ""},${w.dis ? 1 : 0}`).join("|")}|${desc.hub.x},${desc.hub.y},${desc.k},${desc.R},${desc.dockR}|${desc.dock.x},${desc.dock.y}|${r.width}x${r.height}|${d}`;
    if (root.dataset.dkStruct !== struct) {
        root.replaceChildren();
        root.style.setProperty("--dk", `${d}px`);
        const [hx, hy] = rel(desc.hub.x, desc.hub.y), k = desc.k ?? 1, V = (D.arc + 10) * 2;
        const gd = el("dk-gd", root);
        gd.style.cssText = `left:${hx! - V / 2 * d * k}px;top:${hy! - V / 2 * d * k}px;width:${V * d * k}px;height:${V * d * k}px`;
        const ring = (cls: string, rad: number, w: number, extra = "") => `<svg class="${cls}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V} ${V}" aria-hidden="true"><circle cx="${V / 2}" cy="${V / 2}" r="${rad}" fill="none" stroke-width="${w}" ${extra}/></svg>`;
        gd.innerHTML = ring("dk-line", D.arc, 1.2) + `<div class="dk-spin">${ring("dk-ticks", D.arc, 5, 'pathLength="360" stroke-dasharray=".35 4.65"')}${ring("dk-ticks dk-major", D.arc, 9, 'pathLength="360" stroke-dasharray=".8 29.2"')}</div>` + ring("dk-flash", D.arc, 3);
        const pt = (a: number | undefined, rad: number) => `${V / 2 + rad * Math.cos(a! * Math.PI / 180)} ${V / 2 + rad * Math.sin(a! * Math.PI / 180)}`;
        const dk = el("dk-dkarc", root);
        dk.style.cssText = gd.style.cssText;
        const dR = (desc.dockR ?? 205) / k, arc = `M${pt(D.dockArc[0], dR)} A${dR} ${dR} 0 0 1 ${pt(D.dockArc[1], dR)}`;
        dk.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${V} ${V}" aria-hidden="true"><path class="dk-dkline" d="${arc}" fill="none" stroke-width="1.4"/><path class="dk-flash" d="${arc}" fill="none" stroke-width="3.2"/></svg>`;
        const ptr = el("dk-ptr", root);
        ptr.style.cssText = `left:${hx}px;top:${hy}px;width:${((desc.R ?? 60) * 3 + 11) * d}px`;
        const family = FACE.label, size = D.size * d, sp = D.spacing * d, line = D.line * d;
        const [dxp, dyp] = rel(desc.dock.x, desc.dock.y);
        const LS = desc.list ? { x: 300, chip: D.chip, r: D.cost, gap: D.gap, size: D.listSize, line: D.listLine } : null;
        if (desc.list && desc.title) {
            const [tx, ty] = rel(desc.words[0].x, desc.words[0].y - 18);          // above the first row, flush with it
            const t = el("dk-ttl", root); t.style.cssText = `left:${tx}px;top:${ty! - 12 * d}px;font-size:${16 * d}px;height:${24 * d}px;line-height:${24 * d}px`;
            t.dataset.uicText = desc.title; t.textContent = desc.title;
            if (desc.pager) for (const k2 of ["L1", "R1"]) { const c = el("cap", t, "i"); c.textContent = k2; }
        }
        desc.words.forEach((w, i) => {
            const [x, y] = rel(w.x, w.y);
            if (LS) {                                  // a list row: name, element chip, cost (the same slot / dock mechanics as a command)
                const nameW = Math.max(60, Math.min(LS.x, w.maxDp - (LS.chip + LS.r + 2 * LS.gap))), lh = LS.line * d, fs = LS.size * d;
                const fit = fitRun((sz, spc) => measureText(w.t, FACE.text, 700, sz, spc), fs, 0, nameW * d);
                const rowCss = `left:${x}px;top:${y! - lh / 2}px;height:${lh}px;line-height:${lh}px;font-size:${fs}px;`;
                const ghost = el("dk-g", root, "div"); ghost.style.cssText = rowCss; ghost.dataset.dkI = String(i); ghost.style.display = "none";
                const word = el("dk-w rw", root, "div");
                word.style.cssText = `${rowCss}--tx:${rel(desc.dock.x, desc.dock.y)[0]! - x!}px;--ty:${rel(desc.dock.x, desc.dock.y)[1]! - y!}px;--sc:${desc.scale};gap:${LS.gap * d}px`;
                word.dataset.dkI = String(i); word.dataset.uicText = w.t; word.dataset.uicFits = fit.fits ? "1" : "0"; if (w.dis) word.classList.add("dis");
                const tn = el("tn", word, "span"); tn.textContent = w.t; tn.style.cssText = `max-width:${nameW * d}px;font-size:${+fit.size.toFixed(2)}px`;
                const ch = el("chip", word, "i"); ch.style.cssText = `width:${LS.chip * d}px;font-size:${12 * d}px;line-height:${16 * d}px;padding:${2 * d}px 0;border-width:${Math.max(1, 1.5 * d)}px`;
                if (w.chip) { ch.textContent = w.chip; if (w.el) ch.style.color = `var(--c-el-${w.el}, var(--c-cyan))`; } else ch.style.display = "none";
                const tm = el("tm", word, "b"); tm.textContent = w.r; tm.style.cssText = `width:${LS.r * d}px`;
                return;
            }
            const fit = fitRun((sz, spc) => measureText(w.t, family, 400, sz, spc), size, sp, w.maxDp * d);
            const common = `left:${x}px;top:${y! - line / 2}px;font-size:${+fit.size.toFixed(2)}px;line-height:${+line.toFixed(2)}px;letter-spacing:${+fit.spacing.toFixed(2)}px;height:${+line.toFixed(2)}px`;
            const ghost = el("dk-g", root, "div");
            ghost.style.cssText = common; ghost.textContent = w.t; ghost.dataset.dkI = String(i);
            const word = el("dk-w", root, "div");
            word.style.cssText = `${common};--tx:${dxp! - x!}px;--ty:${dyp! - y!}px;--sc:${D.scale}`;
            word.dataset.dkI = String(i); word.dataset.uicText = w.t; word.dataset.uicFits = fit.fits ? "1" : "0";
            const wd = el("wd", word, "span");
            el("ol", wd, "span").textContent = w.t;
            el("fl", wd, "span").textContent = w.t;
        });
        root.addEventListener("animationend", (e) => { if (String(e.animationName).startsWith("uic-dk-")) delete root.dataset.kick; });
        root.dataset.dkStruct = struct;
        delete root.dataset.dkOn;
    }
    const prev = root.dataset.dkOn === undefined ? null : Number(root.dataset.dkOn);
    if (prev !== null && prev >= 0 && desc.on >= 0 && prev !== desc.on) root.dataset.kick = root.dataset.kick === "a" ? "b" : "a";
    root.dataset.dkOn = String(desc.on);
    root.classList.toggle("has", desc.on >= 0);
    for (const e of root.querySelectorAll(".dk-w, .dk-g")) e.classList.toggle("on", Number(e.dataset.dkI) === desc.on);
}

/** The damage pop: its own element, ONE `.pp` child per hit event (`desc.evt`). A re-fill with the same event only moves the box (the enemy walks on screen),
 *  it never builds a second number; a new event builds a new one, the CSS plays once and fades. `desc.o` = { kind: dmg | heal | miss | counter | status, tone: crit | weak | resist | "",
 *  tag: the small word, status: poison | frozen | confuse | sleep, text: the shown figure when it is not the HP drop }. */
const POP_FONT = { player: 84, enemy: 100 };
function fillPop(root, desc, g) {
    const r = g.rect, d = g.ed.d, o = desc.o ?? {}, kind = o.kind ?? "dmg", tone = o.tone ?? "";
    root.className = `uic-part uic-pop uic-pop-${desc.side} uic-pop-${kind}${tone ? ` uic-pop-${tone}` : ""}${o.status ? ` uic-pop-st-${o.status}` : ""}`;
    root.dataset.popKind = kind; root.dataset.popTone = tone;
    root.dataset.uicPart = desc.part; root.dataset.uicFits = "1";
    root.dataset.uicRect = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    root.style.position = "absolute"; setBox(root, r);
    const base = POP_FONT[desc.side] ?? 100, mul = { crit: 1.2, weak: 1.1, resist: 0.8 }[tone] ?? 1, small = kind === "miss" || kind === "status";
    root.style.fontSize = `${(base * mul * (small ? 0.5 : 1)) * d}px`; root.style.lineHeight = "1";
    root.style.setProperty("--tg", `${Math.max(26, base * 0.3) * d}px`);
    const old = root.querySelector(".pp");
    if (old && old.dataset.evt === (desc.evt ?? "")) { root.dataset.uicText = old.dataset.shown; return; }
    // the number is the HP the game really took (remembered by the main ring); the game's own figure only when no drop was seen
    let shown;
    if (kind === "miss") shown = "EVADE";
    else if (kind === "status") shown = "";
    else if (kind === "heal") shown = `+${desc.n}`;
    else {
        const ring = typeof document !== "undefined" ? document.querySelector(".uic-ring-main") as HTMLElement : null, tag = desc.side === "player" ? "P" : "E";
        const seen = kind === "dmg" && ring && ring.dataset[`drop${tag}`] !== undefined && performance.now() - Number(ring.dataset[`drop${tag}T`]) < 20000 ? Number(ring.dataset[`drop${tag}`]) : null;
        shown = String(seen !== null && seen > 0 ? seen : desc.n);
    }
    root.dataset.uicText = shown;
    root.replaceChildren();
    const pp = document.createElement("span"); pp.className = "pp"; pp.dataset.evt = desc.evt ?? ""; pp.dataset.shown = shown;
    if (o.tag) { const t = document.createElement("i"); t.className = "tg"; t.textContent = o.tag; pp.appendChild(t); }
    if (shown) { const n = document.createElement("b"); n.className = "nm"; n.textContent = shown; pp.appendChild(n); }
    root.appendChild(pp);       // the animation lives on the child: the part's own box stays put
}

/** A turn-arc node: a round chip with the actor's initial; the one acting now is the biggest, enemies carry a red rim. */
function fillNode(root, desc, g) {
    const r = g.rect;
    root.className = `uic-part uic-node uic-node-${desc.side} uic-node-${desc.turn}`;
    root.dataset.uicPart = desc.part; root.dataset.turn = desc.turn; root.dataset.side = desc.side;
    root.dataset.uicRect = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    root.style.position = "absolute"; setBox(root, r);
    root.replaceChildren();
    const l = el("nl", root, "span");
    l.textContent = desc.letter; l.dataset.uicText = desc.letter; l.dataset.uicFits = "1";
    l.style.fontSize = `${Math.round(Math.min(r.width, r.height) * 0.52)}px`;
}

/** (Re)write an element for `desc`. Called only when the signature changed. */
export function fillPart(root, desc, g) {
    const { rect: r, ed } = g;
    if (desc.kind === "ring") { fillRing(root, desc, g); return; }
    if (desc.kind === "dock") { fillDock(root, desc, g); return; }
    if (desc.kind === "pop") { fillPop(root, desc, g); return; }
    if (desc.kind === "node") { fillNode(root, desc, g); return; }
    if (desc.kind === "vic") { fillVic(root, desc, g); return; }          // words keep their elements: the slide is a CSS transition          // moves the arcs in place: the tick spin keeps running
    root.replaceChildren();
    root.style.cssText = "";
    root.dataset.uicPart = desc.part ?? desc.kind;
    root.dataset.uicRect = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    root.style.position = "absolute";
    switch (desc.kind) {
        case "wash":
            root.className = "uic-part uic-dim"; setBox(root, r); break;
        case "plate": {
            root.className = "uic-part uic-box uic-plate";
            setBox(root, r);
            if (desc.shadow) { root.classList.add("uic-shadowed"); root.style.setProperty("--sx", px(desc.shadow * ed.d)); root.style.setProperty("--sy", px(desc.shadow * ed.d)); }
            const sh = plateShape(desc.shape, r.width, r.height, ed.d, ed.e1, ed.e2, desc.underEdge);
            const edge = el("uic-fill", root);
            edge.style.cssText = `left:0;top:0;width:${px(r.width)};height:${px(r.height)};background:${desc.edge};clip-path:${sh.outer}`;
            if (sh.box && desc.body) {
                const b = sh.box, body = el("uic-fill", root);
                body.style.cssText = `left:${px(b.l)};top:${px(b.t)};width:${px(r.width - b.l - b.r)};height:${px(r.height - b.t - b.b)};background:${desc.body};clip-path:${sh.inner}`;
            }
            break;
        }
        case "balloon": {
            // C6: body + tail in one silhouette (edge colour), the body colour e1 px inside it; the native inner rect and tail scale with the rect
            root.className = "uic-part uic-box uic-balloon";
            setBox(root, r);
            if (desc.shadow) { root.classList.add("uic-shadowed"); root.style.setProperty("--sx", px(desc.shadow * ed.d)); root.style.setProperty("--sy", px(desc.shadow * ed.d)); }
            const kx = desc.rect.w ? r.width / desc.rect.w : 0, ky = desc.rect.h ? r.height / desc.rect.h : 0;
            const b = { l: desc.inner.x * kx, t: desc.inner.y * ky, w: desc.inner.w * kx, h: desc.inner.h * ky };
            const tl = desc.tail ? { side: desc.tail.side, b0: desc.tail.b0 * kx, b1: desc.tail.b1 * kx, tip: [desc.tail.tip[0] * kx, desc.tail.tip[1] * ky] } : null;
            const sh = balloonShape(b, tl, ed.e1, 24 * ed.d);
            const edge = el("uic-fill", root), body = el("uic-fill", root);
            edge.style.cssText = `left:0;top:0;width:${px(r.width)};height:${px(r.height)};background:${desc.edge};clip-path:${pt(sh.outer)}`;
            body.style.cssText = `left:0;top:0;width:${px(r.width)};height:${px(r.height)};background:${desc.body};clip-path:${pt(sh.inner)}`;
            break;
        }
        case "wall": {
            root.className = "uic-part uic-wall"; setBox(root, r);
            root.style.clipPath = plateShape(desc.shape ?? "wall", r.width, r.height, ed.d, ed.e1, ed.e2).outer;
            if (desc.color) root.style.background = desc.color;
            break;
        }
        case "stripes": {
            // the diamond field of the status-style pages: 135 degree stripes (C2), moved by the game's own scroll counter
            root.className = "uic-part uic-stripes"; setBox(root, r);
            root.style.backgroundImage = stripesGradient(desc.scroll ?? 0, ed.d, desc.light, desc.dark);
            break;
        }
        case "band": {
            // the footer band: edge top and bottom, orange tab top-left, two dividers (C2)
            root.className = "uic-part uic-box uic-band"; setBox(root, r);
            if (desc.shadow) { root.classList.add("uic-shadowed"); root.style.setProperty("--sx", "0px"); root.style.setProperty("--sy", px(desc.shadow * ed.d)); }
            const e = ed.e1, h = r.height;
            const add = (css: string) => { const d = el("uic-fill", root); d.style.cssText = css; return d; };
            add(`left:0;top:0;width:${px(r.width)};height:${px(h)};background:${desc.edge}`);
            add(`left:0;top:${px(e)};width:${px(r.width)};height:${px(h - 2 * e)};background:${desc.body}`);
            if (desc.tabW) add(`left:0;top:0;width:${px(desc.tabW * ed.u)};height:${px(e)};background:var(--c-orange)`);
            for (const dxn of desc.dividers ?? []) add(`left:${px(dxn * ed.u)};top:${px(e)};width:${px(e)};height:${px(h - 2 * e)};background:var(--c-under)`);
            break;
        }
        case "corners": {
            // four corner brackets around a plate (the selected / locked portrait): bracket length 5 native, edge thick
            root.className = "uic-part uic-corners"; setBox(root, r);
            const t = ed.e1, len = Math.round(5 * ed.u), w = r.width, h = r.height;
            const add = (css: string) => { const d = el("uic-fill", root); d.style.cssText = `background:${desc.color};${css}`; };
            for (const [l, tp] of [[0, 0], [w - len, 0], [0, h - t], [w - len, h - t]]) add(`left:${px(l)};top:${px(tp)};width:${px(len)};height:${px(t)}`);
            for (const [l, tp] of [[0, 0], [w - t, 0], [0, h - len], [w - t, h - len]]) add(`left:${px(l)};top:${px(tp)};width:${px(t)};height:${px(len)}`);
            break;
        }
        case "bar": {
            root.className = "uic-part uic-box"; setBox(root, r);
            const slant = desc.slant ? `clip-path:polygon(0 0,100% 0,calc(100% - ${px(desc.slant * ed.d)}) 100%,0 100%);` : "";
            const track = el("uic-bar-track", root);
            track.style.cssText = `left:0;top:0;width:${px(r.width)};height:${px(r.height)};background:${desc.track};${slant}`;
            const fillW = barFill(desc.ratio, r.width);
            const fill = el("uic-bar-fill", track);
            // dir "rtl": the fill keeps the bar's right end (the battle's enemy HP bar shrinks towards its right anchor)
            fill.style.cssText = `${desc.dir === "rtl" ? `left:${px(r.width - fillW)};` : ""}width:${px(fillW)};background:${desc.color};`;
            root.dataset.uicFill = String(fillW);
            if (desc.state) root.dataset.hpState = desc.state;
            break;
        }
        case "bracket": {
            // SORT swap bracket: a bar down the right side, an arm to each arrow, arrow heads pointing left (at the two portraits)
            root.className = "uic-part uic-bracket uic-shadowed"; setBox(root, r);
            root.style.setProperty("--sx", px(4 * ed.d)); root.style.setProperty("--sy", px(4 * ed.d));
            const path = bracketPath(r.width, r.height, ed.u, (desc.arrows ?? []).map((a) => a * ed.u));
            root.innerHTML = `<svg aria-hidden="true" width="${Math.round(r.width)}" height="${Math.round(r.height)}" viewBox="0 0 ${Math.round(r.width)} ${Math.round(r.height)}" style="display:block"><path d="${path}" style="fill:${desc.color}"/></svg>`;
            break;
        }
        case "svg": {
            // a path in native units (desc.vw x desc.vh) stretched onto the snapped rect
            root.className = "uic-part uic-svg"; setBox(root, r);
            root.innerHTML = `<svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 ${desc.vw} ${desc.vh}" preserveAspectRatio="none" style="display:block"><path d="${desc.d}" style="fill:${desc.fill}${desc.rule ? `;fill-rule:${desc.rule}` : ""}"/></svg>`;
            break;
        }
        case "chevron": {
            root.className = "uic-part uic-chevron"; setBox(root, r);
            root.innerHTML = chevronSvg(desc.fill);
            break;
        }
        case "icon": {
            root.className = "uic-part uic-icon"; setBox(root, r);
            root.innerHTML = desc.svg;
            break;
        }
        case "text": {
            const family = desc.role === "label" ? FACE.label : FACE.text;
            const weight = desc.role === "label" ? 400 : desc.role === "number" ? 700 : 600;
            root.className = `uic-part ${ROLES[desc.role] ?? ROLES.body}${desc.cls ? " " + desc.cls : ""}`;
            const size = desc.sizeDp * ed.d * Math.abs(g.sy), line = desc.lineDp * ed.d * Math.abs(g.sy), sp0 = (desc.spacingDp ?? 0) * ed.d;
            const maxW = desc.maxDp ? desc.maxDp * ed.d * Math.abs(g.sx) : 0;
            const fit = fitRun((s, sp) => measureText(desc.text, family, weight, s, sp), size, sp0, maxW);
            root.textContent = desc.text;
            root.dataset.uicText = desc.text;
            root.dataset.uicFits = fit.fits ? "1" : "0";
            const s = root.style;
            s.position = "absolute";
            s.fontSize = `${+fit.size.toFixed(2)}px`; s.lineHeight = px(line); s.height = px(line); s.letterSpacing = `${+fit.spacing.toFixed(2)}px`;
            if (desc.color) s.color = desc.color;
            s.top = px(r.top);
            s.left = px(r.left);
            if (desc.align === "right" || desc.align === "center") { s.width = px(r.width); s.textAlign = desc.align; }
            break;
        }
        case "type": {
            root.className = "uic-part uic-type";
            let size = desc.sizeDp * ed.d * Math.abs(g.sy), sp = (desc.spacingDp ?? 0) * ed.d;
            if (desc.fit && !desc.vertical) {
                // a watermark that must stay inside its box (the home wall): shrink size and spacing (down to half) until it fits the rect width
                const wide = (sz: number, sg: number) => measureText(desc.text, FACE.label, 400, sz, sg);
                let k = 1;
                while (k > 0.5 && wide(size * k, sp * k) > r.width) k -= 0.02;
                size *= k; sp *= k;
                root.dataset.uicFits = wide(size, sp) <= r.width + 0.5 ? "1" : "0";
            }
            root.textContent = desc.text;
            root.dataset.uicText = desc.text;
            root.style.cssText = `position:absolute;left:${px(r.left)};top:${px(r.top)};font-size:${+size.toFixed(2)}px;line-height:${+size.toFixed(2)}px;letter-spacing:${+sp.toFixed(2)}px;${desc.color ? `color:${desc.color};` : ""}${desc.vertical ? "writing-mode:vertical-rl;" : ""}`;
            break;
        }
        default:
            break;
    }
}
