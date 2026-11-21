// web/ui-c/message.js -- look C kit, task T6: the message windows (C6 balloon + system band, C6b place card, C9 9 message band).
// Pure: the scope's parts + runs (and, where the game draws no clip, a small scene the owner hands over) in, descriptors out. Every
// position is the game's own: the balloon from its left / right pieces, the tail from the tail clip the game picked for the quadrant,
// the band from its two halves (their wipe is the draw matrix), the text from the game's widgets with the game's own reveal (typewriter),
// the more arrow where the game draws its marker, the place card bars from the card's own quads. Only colours and shapes are ours.
import { applyRel } from "./geometry.js";
import { N, ID, MSG, textPart, plate, rule, tabPlate, moreArrow, messageBand, bandLine, balloonPart } from "./base.js";
import { clipRect, restOfRuns } from "./generic.js";
import { isCursorToken } from "./icons.js";
import type { PlaceCardScene, TalkOpts } from "./types.js";

/** The four tail clips (one per balloon quadrant): which edge of the body they hang from and on which side their tip lies. */
export const TAILS = Object.freeze({
    3: Object.freeze({ side: "bottom", tip: "left" }), 4: Object.freeze({ side: "bottom", tip: "right" }),
    5: Object.freeze({ side: "top", tip: "left" }), 6: Object.freeze({ side: "top", tip: "right" }),
});

/**
 * The C tail for tail clip `id` drawn at native rect `r`: the tip where the clip's tip is (3 px in from its tip side, on its far edge), the
 * base along the body edge over the clip's wide part, widened MSG.tailWiden each side (C6 draws a fuller tail than the 10 px pixel one).
 */
export function tailGeometry(id: string | number, r, body) {
    const d = TAILS[id];
    if (!d || !body || !r) return null;
    const left = d.tip === "left";
    const tip = [left ? r.x + 3 : r.x + r.w - 3, d.side === "bottom" ? r.y + r.h : r.y];
    const b0 = (left ? r.x + r.w * 0.3 : r.x) - MSG.tailWiden, b1 = (left ? r.x + r.w : r.x + r.w * 0.65) + MSG.tailWiden;
    return { side: d.side, b0, b1, tip };
}

/** The native box of a "more" marker: the claim's `box` inside the clip (the arrow head of cmfont 7), else the clip itself. */
export const moreBox = (p) => (p.box ? applyRel({ x: p.x + p.box[0], y: p.y + p.box[1], w: p.box[2], h: p.box[3] }, p.rel ?? ID) : clipRect(p));

/** The band halves (cmfont 8 / 9) through their wipe matrices; halves that touch or overlap become one band. */
export function bandRects(parts) {
    const list = parts.filter((p: { part: string; }) => p.part === "msgBand").map((p) => ({ r: clipRect(p), rel: p.rel ?? ID })).filter((b: { r: { w: number; h: number; }; }) => b.r.w > 0 && b.r.h > 0).sort((a: { r: { x: number; }; }, b: { r: { x: number; }; }) => a.r.x - b.r.x);
    const out = [];
    for (const b of list) {
        const last = out[out.length - 1];
        if (last && Math.abs(last.r.y - b.r.y) < 1 && b.r.x <= last.r.x + last.r.w + 0.5) {
            const x1 = Math.max(last.r.x + last.r.w, b.r.x + b.r.w);
            last.r = { ...last.r, w: x1 - last.r.x, h: Math.max(last.r.h, b.r.h) };
        } else out.push({ r: { ...b.r }, rel: { a: 1, d: b.rel.d ?? 1, e: 0, f: 0 } });
    }
    return out;
}

const centreIn = (r, rc) => r.y + 4.5 >= rc.y && r.y + 4.5 < rc.y + rc.h;

/** The balloon body from its two pieces (cmfont 0 / 2): their union less the 2 px drop line on the right and the bottom. */
export function balloonBody(parts) {
    const caps = parts.filter((p: { part: string; }) => p.part === "balloonCap").map(clipRect);
    if (!caps.length) return null;
    const x0 = Math.min(...caps.map((c) => c.x)), x1 = Math.max(...caps.map((c) => c.x + c.w));
    const y0 = Math.min(...caps.map((c) => c.y)), y1 = Math.max(...caps.map((c) => c.y + c.h));
    return { x: x0, y: y0, w: Math.max(8, x1 - x0 - 2), h: Math.max(8, y1 - y0 - 2) };
}

/** The name tab over the balloon's top edge (left end; at the right end when a top tail would sit under it). */
export function nameTab(body, tail, nameW: number) {
    const w = Math.max(MSG.tabMinW, nameW * 1.15 + 18);
    let x = body.x + MSG.tabIn;
    if (tail?.side === "top" && Math.min(tail.b0, tail.tip[0]) < x + w + 4 && Math.max(tail.b1, tail.tip[0]) > x - 4) x = body.x + body.w - w - MSG.tabIn;
    return { x, y: body.y - MSG.tabUp, w, h: MSG.tabH14 };
}

function pushName(key: string, text: string, tab, rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }> | undefined, out) {
    out.push(tabPlate(`${key}.tab`, tab, rel, { edge: "var(--c-bln-tab)", part: "nameTab" }));
    const w = tab.w - MSG.nameIn - 8;
    out.push(textPart(`${key}.name`, "label", text, { x: tab.x + MSG.nameIn, y: tab.y + (tab.h - N(MSG.nameLineDp)) / 2, w, h: N(MSG.nameLineDp) },
        MSG.nameDp, MSG.nameLineDp, { rel, color: "var(--c-bln-name)", maxDp: Math.round(w * 3) }));
}

/**
 * The field conversation box (C6): `parts` / `runs` from the capture scope (web/dialogue-translated.js) or built by the owner (the legacy
 * web/textbox.js). `opt` = { lines: the opening animation's outline lines [{ points }], body: a balloon rect when there are no piece clips,
 * name: the speaker's name when it is not a kind 2 run (null = none) }.
 */
export function composeTalk({ parts, runs }, opt: TalkOpts = {}) {
    const out = [], used = new Set();
    // the opening: the game grows outline boxes from the speaker to the balloon (raw line primitives) -- drawn as 1 native C edge lines
    (opt.lines ?? []).forEach((l, i) => {
        const [x0, y0, x1, y1] = l.points;
        out.push(rule(`open${i}`, { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 }, "var(--c-bln-edge)", ID, "under", "openLine"));
    });
    const body = opt.body ?? balloonBody(parts);
    const capRel = parts.find((p: { part: string; }) => p.part === "balloonCap")?.rel ?? ID;
    if (body) {
        const tp = parts.find((p: { part: string; }) => p.part === "balloonTail");
        const tail = opt.tail ?? (tp ? tailGeometry(tp.base, clipRect(tp), body) : null);
        out.push(balloonPart("bln", body, tail, capRel));
        const nameRun = opt.name !== undefined ? (opt.name ? { text: opt.name, w: opt.name.length * 6 } : null) : runs.find((r: { kind: number; }) => r.kind === 2) ?? null;
        if (nameRun) used.add(nameRun);
        if (nameRun?.text) pushName("bln", nameRun.text, nameTab(body, tail, nameRun.w ?? nameRun.text.length * 6), capRel, out);
        runs.filter((r) => !used.has(r) && r.kind !== 2 && centreIn(r, body)).sort((a: { y: number; x: number; }, b: { y: number; x: number; }) => a.y - b.y || a.x - b.x).forEach((r, k) => {
            used.add(r);
            if (isCursorToken(r.text)) return;
            const x = r.x + MSG.textIn, w = Math.max(8, body.x + body.w - x - 4);
            out.push(textPart(`bln.l${k}`, "body", r.text, { x, y: r.y + 4.5 - N(MSG.textLineDp) / 2, w, h: N(MSG.textLineDp) }, MSG.textDp, MSG.textLineDp,
                { rel: capRel, color: "var(--c-bln-ink)", maxDp: Math.round(w * 3) }));
        });
    }
    const bands = body ? [] : bandRects(parts);
    bands.forEach((b, i) => {
        messageBand(`band${i}`, b.r, b.rel, out);
        const right = Math.min(320, b.r.x + b.r.w) - 4;
        runs.filter((r) => !used.has(r) && centreIn(r, b.r)).sort((a: { y: number; x: number; }, c: { y: number; x: number; }) => a.y - c.y || a.x - c.x).forEach((r, k) => {
            used.add(r);
            if (!isCursorToken(r.text)) out.push(bandLine(`band${i}.l${k}`, r, right, ID));
        });
    });
    if (!body && bands.length && opt.name) pushName("band", opt.name, { x: 6, y: bands[0].r.y - MSG.tabH14 + MSG.tabUp, w: Math.max(MSG.tabMinW, opt.name.length * 6 * 1.15 + 18), h: MSG.tabH14 }, ID, out);
    parts.forEach((p, i) => { if (p.part === "more") out.push(moreArrow(`more${i}`, moreBox(p), p.rel ?? ID, body ? "var(--c-bln-more)" : "var(--c-orange)")); });
    restOfRuns(runs, used, ID, out, "msg");
    return out;
}

/**
 * Text in a window that is a message, not a question (the help counter's topic page draws its text in the Yes / No window's frame, no
 * cursor): the C message band on the window's rect, its lines in band text.
 */
export function composeBandWindow(p, i, runs, used, out) {
    const r = clipRect(p), rel = p.rel ?? ID;
    messageBand(`mw${i}`, r, rel, out);
    const right = Math.min(320, r.x + r.w) - 4;
    runs.filter((m) => !used.has(m) && centreIn(m, r) && m.x >= r.x - 1).sort((a: { y: number; x: number; }, b: { y: number; x: number; }) => a.y - b.y || a.x - b.x).forEach((m, k) => {
        used.add(m);
        if (!isCursorToken(m.text)) out.push(bandLine(`mw${i}.l${k}`, m, right, rel));
    });
}

/**
 * Parts every screen shares, added after the screen's own composer when it did not draw them: the "more" marker (cmfont 7 / 10) as the C
 * arrow, a message band half (cmfont 8 / 9) as the C band. A screen that has its own variant (the balloon) already emitted them.
 */
export function composeShared(parts, descs: { key: string; kind: string; part: string; layer: string; vw: number; vh: number; d: string; fill: string; rect: { x: number; y: number; w: number; h: number; }; sx: 1; sy: 1; }[]) {
    if (!descs.some((d: { part: string; }) => d.part === "more")) parts.forEach((p, i) => { if (p.part === "more") descs.push(moreArrow(`more${i}`, moreBox(p), p.rel ?? ID)); });
    // only the field window's halves (cmfont 8 / 9): the fight report claims its own cyan band (stfrpt 29) under the same part name
    if (!descs.some((d: { part: string; }) => d.part === "msgBand")) bandRects(parts.filter((p: { pack: string; }) => p.pack === "cmfont")).forEach((b, i) => messageBand(`band${i}`, b.r, b.rel, descs));
    return descs;
}

// ------------------------------------------------------------------------------------------------ the place card (C6b)
const PC_COLOURS = Object.freeze({ "0,0,128": "var(--c-pc-navy)", "62,62,200": "var(--c-pc-blue)", "0,228,255": "var(--c-pc-cyan)" });
/** The card's three bar colours -> the C6b navy / blue / cyan; any other colour is kept as the game paints it. */
export const pcColour = (c) => PC_COLOURS[`${c[0]},${c[1]},${c[2]}`] ?? `rgb(${c[0]},${c[1]},${c[2]})`;
export const PLACE = Object.freeze({ thin: 2, line: N(8), lineIn: N(4), narrow: 10, tabW: N(24), tabH: N(54), areaDp: 32, areaLineDp: 44, placeDp: 44, placeLineDp: 58, areaMaxY: 48 });
const isNavy = (q) => pcColour(q.c) === "var(--c-pc-navy)", isBlue = (q) => pcColour(q.c) === "var(--c-pc-blue)";
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The card's bar quads (the game's own rects and paint order, every frame of the slide) as C parts: the full-width navy band with the
 * drop shadow, a navy plate (the area plate) chamfered, the 1-2 px lines thickened to 8 dp about their centre (4 dp inside a bar
 * narrower than 10 native, as C6b draws the line in the left blue bar; always kept inside the bar they sit in), the orange tab where the left blue bar crosses the band (C6b).
 */
export function placeCardBars(quads, out = []) {
    const qs = quads.filter((q: { w: number; h: number; }) => q.w > 0 && q.h > 0).map((q) => ({ x: q.x, y: q.y, w: q.w, h: q.h, c: q.colour ?? q.color ?? [0, 0, 0] }));
    qs.forEach((q, i) => {
        let r = { x: q.x, y: q.y, w: q.w, h: q.h };
        if (Math.min(q.w, q.h) <= PLACE.thin) {
            const vertical = q.h > q.w;
            const box = qs.find((o: { x: number; y: number; w: number; h: number; }) => o !== q && o.x <= q.x && o.y <= q.y && o.x + o.w >= q.x + q.w && o.y + o.h >= q.y + q.h && (vertical ? o.w > q.w : o.h > q.h));
            if (vertical) {
                const w = box ? (box.w < PLACE.narrow ? PLACE.lineIn : PLACE.line) : PLACE.line;
                const x = box ? clamp(q.x + q.w / 2 - w / 2, box.x, box.x + box.w - w) : q.x + q.w / 2 - w / 2;
                r = { x, y: q.y, w, h: q.h };
            } else {
                const h = box ? (box.h < PLACE.narrow ? PLACE.lineIn : PLACE.line) : PLACE.line;
                const y = box ? clamp(q.y + q.h / 2 - h / 2, box.y, box.y + box.h - h) : q.y + q.h / 2 - h / 2;
                r = { x: q.x, y, w: q.w, h };
            }
        }
        const col = pcColour(q.c);
        if (isNavy(q) && q.h >= 10 && q.w >= 300) out.push(plate(`pc.q${i}`, "pcBand", r, ID, { shape: "rect", edge: col, body: null, shadow: 6 }));
        else if (isNavy(q) && q.h >= 10 && q.w >= 10) out.push(plate(`pc.q${i}`, "pcPlate", r, ID, { shape: "ch", edge: col, body: null, shadow: 0 }));
        else out.push(rule(`pc.q${i}`, r, col, ID, "under", "pcBar"));
    });
    const band = qs.find((q: { h: number; w: number; }) => isNavy(q) && q.h >= 10 && q.w >= 300);
    const bar = band && qs.find((q: { h: number; w: number; y: number; }) => isBlue(q) && q.h >= 100 && q.w >= 4 && q.y <= band.y && q.y + q.h >= band.y + band.h);
    if (band && bar) {
        const stripe = qs.filter((q: { w: number; y: number; }) => isBlue(q) && q.w >= 300 && q.y > band.y && q.y < band.y + band.h).sort((a: { y: number; }, b: { y: number; }) => a.y - b.y)[0];
        const h = Math.min(PLACE.tabH, (stripe ? stripe.y : band.y + band.h) - band.y);
        if (h > 0) out.push(rule("pc.tab", { x: bar.x + bar.w / 2 - PLACE.tabW / 2, y: band.y, w: PLACE.tabW, h }, "var(--c-orange)", ID, "under", "pcTab"));
    }
    return out;
}

/**
 * The place card (C6b): `scene` = { quads: [{ x, y, w, h, colour }], names?: [{ text, x, y }] }. The two names are the game's typed runs
 * (the translated card's widgets) or the names the plain-string card hands over; the upper one is the area (Russo 32 / 44), the lower
 * the place (Russo 44 / 58). The slit is the scope's clip (index.js), not a part.
 */
export function composePlaceCard({ runs }, scene: PlaceCardScene = {}) {
    const out = placeCardBars(scene.quads ?? []);
    const plates = (scene.quads ?? []).filter((q) => q.w > 0 && q.h >= 10 && q.w < 300);
    const names = (scene.names ?? runs ?? []).filter((n) => n.text && !isCursorToken(n.text));
    names.forEach((n: { y: number; x: number; text: string; }, k) => {
        const area = n.y < PLACE.areaMaxY;
        const size = area ? PLACE.areaDp : PLACE.placeDp, line = area ? PLACE.areaLineDp : PLACE.placeLineDp;
        const host = area ? plates.find((q) => n.x >= q.x && n.x < q.x + q.w && n.y + 4.5 >= q.y && n.y + 4.5 < q.y + q.h) : null;
        const w = Math.max(8, (host ? host.x + host.w : 320) - n.x - 3);
        out.push(textPart(`pc.${area ? "area" : "place"}${k}`, "label", n.text, { x: n.x, y: n.y + 4.5 - N(line) / 2, w, h: N(line) }, size, line,
            { color: "var(--c-ink)", maxDp: Math.round(w * 3) }));
    });
    return out;
}
