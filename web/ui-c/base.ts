// web/ui-c/base.js -- look C kit: the base components, defined ONCE. Every composer (home, pages, lists, generic) builds its parts
// with these; a screen that needs a variant passes an option, it never copies the descriptor. Pure: native rects in, descriptors out.
//   textPart     a DOM text run (label / number / body)
//   plate        a C frame or plate (chamfer shapes from parts.js), edge + body + drop shadow
//   rule         a flat bar (dividers, tabs on bands, connectors)
//   rowPlate     a list row: plain (navy under-edge) or focused (solid orange)
//   cursor       the C double chevron in the pose of the game's cursor glyph (hidden pose = nothing)
//   corners      the focus corners around a picture / card / grid cell
//   cardBar      a card / list bar (track + fill); triangle = the small orange scroll / value arrow (the game's ◀ ▶ ▲ ▼)
//   chip         a small slanted chip (L1 / R1, page plates)
//   elementChip  a stat / resistance chip, with the C9 element colour cap (ELEMENTS)
//   stripes      the scrolling diamond backdrop (the game's own scroll counter)
//   typeWord     the big faint word behind a page
//   tokenLine    one text line with its button badge (the game's [triangle] / [circle] ... tokens)
//   messageBand  the C9 9 system band (navy body, orange rule tab, left slab when it bleeds); bandLine = its text line
//   balloonPart  the C6 speech balloon (chamfered body + tail, parts.js balloonShape); moreArrow = the orange "more" double arrow
//   keyBox / rowChevron / ringFrame / hudBar   the C8 battle HUD pieces (command key box, row chevron, the close-up bezel, HP bar)
import { applyRel } from "./geometry.js";
import { CURSOR_POSES, splitTokens, hasBadge, badgeSvg } from "./icons.js";
import type { UiBalloonTail, UiDockHub, UiDockOpts, UiMatrix, UiPart, UiPlateOpts, UiPopOpts, UiRect, UiRingOpts, UiRingShape, UiRingValues, UiRingVariant, UiRun, UiTextOpts } from "./types.js";

export const N = (designPx: number | undefined) => designPx! / 3;             // design px (3 per native) -> native units
export const ID: UiMatrix = Object.freeze({ a: 1, d: 1, e: 0, f: 0 });

/** A text run. `o` = { color, align, spacing, maxDp, rel }. Labels get 2 dp letter spacing by default. */
export const textPart = (key: string, role: string, str: string, rect: UiRect, sizeDp: number, lineDp: number, o: UiTextOpts = {}): UiPart => ({
    key, kind: "text", layer: "text", role, text: str, rect, sizeDp, lineDp,
    color: o.color ?? null, align: o.align ?? "left", spacingDp: o.spacing ?? (role === "label" ? 2 : 0), maxDp: o.maxDp ?? 0,
    sx: o.rel?.a ?? 1, sy: o.rel?.d ?? 1, ...(o.cls ? { cls: o.cls } : {}),
});

/** A plate. o = { shape ("ch"), edge, body, shadow (6), layer ("under"), underEdge }. */
export const plate = (key: string, part: string, rect: UiRect, rel = ID, o: UiPlateOpts = {}): UiPart => ({
    key, kind: "plate", part, layer: o.layer ?? "under", rect, shape: o.shape ?? "ch",
    edge: o.edge ?? "var(--c-edge)", ...(o.body !== undefined ? { body: o.body } : { body: "var(--c-body)" }),
    shadow: o.shadow ?? 6, ...(o.underEdge ? { underEdge: o.underEdge } : {}), sx: rel.a, sy: rel.d,
});

/** The C4 title tab ("Digivolve", "Equip", a window title): 390 x 46 dp, slanted right end; the title 36 dp in, Russo 24 / 34. */
export const TAB = Object.freeze({ w: N(390), h: N(46), inset: N(36), sizeDp: 24, lineDp: 34 });

/** A title tab plate (C4 #2c2c8a by default; o.edge = another tab colour, o.part = another part name). */
export const tabPlate = (key: string, rect: UiRect, rel = ID, o: UiPlateOpts = {}) => plate(key, o.part ?? "tab", rect, rel, { shape: "tab", edge: o.edge ?? "var(--c-under)", layer: o.layer });

/** The title of a tab: the game's run `m`, never on the slant (at least TAB.inset in), centred in the tab (`tab` native, before `rel`). */
export function tabTitle(key: string, m: UiRun, tab: UiRect, rel = ID) {
    const x = Math.max(m.x, tab.x + TAB.inset), w = Math.max(8, tab.x + tab.w - x);
    return textPart(key, "label", m.text, applyRel({ x, y: tab.y + (tab.h - N(TAB.lineDp)) / 2, w, h: N(TAB.lineDp) }, rel), TAB.sizeDp, TAB.lineDp, { color: m.face ?? null, rel, maxDp: Math.max(40, Math.round(w * 3 - 40)) });
}

/**
 * The C5 confirm box (Buy / No, Yes / No, Sell / No ...): rows 40 dp tall on the game's own pitch; the focused row pushed out to 24 dp
 * from the box's left edge, plain rows from 60 dp; the chevron 10 dp into the focused row; labels Russo 26 / 40.
 */
export const CONFIRM = Object.freeze({ onIn: N(24), plainIn: N(60), rowH: N(40), chevIn: N(10), sizeDp: 26, lineDp: 40 });

/**
 * The C5 number spinner ("X 1" under "How many?"): a ch box with the orange edge while the count is live, "X" dim Russo 26, the count
 * Chakra Petch 700 40 / 52 right-anchored on the game's own right edge, the up / down triangles (24 x 56 dp, orange).
 */
export const SPINNER = Object.freeze({ xDp: 26, xLineDp: 40, countDp: 40, countLineDp: 52, arrowW: N(24), arrowH: N(56) });
export const spinnerPlate = (key: string, rect: UiRect, rel = ID, live = true): UiPart => plate(key, "spinner", rect, rel, { shape: "ch", edge: live ? "var(--c-orange)" : "var(--c-edge)" });
/** The spinner's up / down triangles centred on (cx, cy) native. */
export const spinArrows = (key: string, cx: number, cy: number, rel = ID): UiPart => ({
    key, kind: "svg", part: "spinArrows", layer: "over", vw: 24, vh: 56, d: "M2 20L12 6L22 20Z M2 36L12 50L22 36Z", fill: "var(--c-orange)",
    rect: applyRel({ x: cx - SPINNER.arrowW / 2, y: cy - SPINNER.arrowH / 2, w: SPINNER.arrowW, h: SPINNER.arrowH }, rel), sx: rel.a, sy: rel.d,
});

/** A flat bar in one colour. */
export const rule = (key: string, rect: UiRect, color: string, rel = ID, layer = "under", part = "rule"): UiPart => ({ key, kind: "plate", part, layer, rect, shape: "rect", edge: color, shadow: 0, sx: rel.a, sy: rel.d });

/** Colours of a focused vs plain row (the cursor row is solid orange with dark ink). */
export const ROW_INK = Object.freeze({ on: "var(--c-orange-ink)" });

/** A list row plate: plain = navy under-edge on the body, `on` = the focused row, solid orange. `under` = another under-edge colour for a plain
 *  row that stands out (the skill row of a Digivolve sheet: orange under-edge). */
export const rowPlate = (key: string, rect: UiRect, on: boolean, rel = ID, part = "row", under: string = "var(--c-under)"): UiPart =>
    plate(key, part, rect, rel, { shape: on ? "rowSolid" : "row", edge: on ? "var(--c-orange)" : under, body: on ? null : "var(--c-body)" });

/**
 * The C double chevron centred on (cx, cy) native, sized 10 x 20/3 native, in the pose of the game's cursor glyph `glyph` (the game swaps
 * four glyphs on its own timer; hidden pose = no part). Returns the descriptor or null.
 */
export function cursor(key: string, glyph: string, cx: number, cy: number, rel = ID, fill: string = ROW_INK.on): UiPart | null {
    const pose = CURSOR_POSES[glyph] ?? CURSOR_POSES["[enter]"];
    if (!pose || pose.hidden) return null;
    const w = 10 * pose.sx, h = N(20) * pose.sy;
    return { key, kind: "chevron", part: "cursor", layer: "over", rect: applyRel({ x: cx - w / 2, y: cy - h / 2, w, h }, rel), fill, sx: rel.a, sy: rel.d };
}

/** The C card bar (party cards, info cards, the GLOSSARY strength bars): dark track, fill at `ratio` (0..1). `rect` is already through `rel`. */
export const cardBar = (key: string, rect: UiRect, ratio: number, color = "var(--c-hp)", rel = ID): UiPart => ({
    key, kind: "bar", part: "cardBar", layer: "over", rect, ratio, track: "var(--c-track)", color, sx: rel.a, sy: rel.d,
});

/** The scroll / value arrows (the game's ◀ ▶ ▲ ▼ glyphs): a small solid orange triangle centred on (cx, cy) native, `dir` = its point. */
/** The game's page-key words (shoulder buttons) that look C turns into a page chip. One test for every screen. */
export const PAGE_KEY = /^(L1|R1|L2|R2)$/;

export const TRIANGLE = Object.freeze({ "◀": "left", "▶": "right", "▲": "up", "▼": "down" });
const TRI_PATH: Readonly<Record<string, string> & { right: string; }> = Object.freeze({ left: "M12 0V12L0 6Z", right: "M0 0V12L12 6Z", up: "M0 12H12L6 0Z", down: "M0 0H12L6 12Z" });
export const triangle = (key: string, cx: number, cy: number, dir: string, rel = ID, fill = "var(--c-orange)"): UiPart => ({
    key, kind: "svg", part: "arrow", layer: "over", vw: 12, vh: 12, d: TRI_PATH[dir] ?? TRI_PATH.right, fill,
    rect: applyRel({ x: cx - 3, y: cy - 3, w: 6, h: 6 }, rel), sx: rel.a, sy: rel.d,
});

/** Focus corners around a rect (already in native units, through the matrix). */
export const corners = (key: string, rect: UiRect, color = "var(--c-orange)", rel = ID, part = "selection"): UiPart => ({ key, kind: "corners", part, layer: "over", rect, color, sx: rel.a, sy: rel.d });

/** A small slanted chip (L1 / R1 page keys, small plates). `on` = the game draws the key's arrow (bright). */
export const chip = (key: string, rect: UiRect, rel = ID, o: UiPlateOpts = {}) => plate(key, o.part ?? "pageChip", rect, rel, { shape: "chip", edge: o.edge ?? "var(--c-under)", body: o.body, shadow: 0, layer: o.layer ?? "over" });

/** The seven element colours of the C9 chips, in the order of the game's resistance rows (fire, water, ice, wind, thunder, machine, dark). */
export const ELEMENTS = Object.freeze(["fire", "water", "ice", "wind", "thunder", "machine", "dark"].map((k) => `var(--c-el-${k})`));

/**
 * A stat / element chip (C9 6): solid chip body with the 10 dp chamfer; with `cap` a colour strip 8 dp wide down its left side, below the
 * chamfer (element chips). Returns the descriptors (the strip over the body).
 */
export function elementChip(key: string, rect: UiRect, cap: string | null = null, rel = ID) {
    const out: UiPart[] = [plate(key, "statChip", rect, rel, { shape: "chip", edge: "var(--c-chip)", body: null, shadow: 0 })];
    if (cap) out.push(rule(`${key}.cap`, { x: rect.x, y: rect.y + N(10) * rel.d, w: N(8) * rel.a, h: rect.h - N(10) * rel.d }, cap, rel, "under", "chipCap"));
    return out;
}

/** The scrolling diamond field over the whole limit; `scroll` = the game's own counter (the call's x). */
export const stripes = (scroll: number, key = "backdrop.stripes", o: { light?: string; dark?: string } = {}): UiPart => ({ key, kind: "stripes", part: "backdrop", layer: "under", full: true, scroll, ...(o.light ? { light: o.light, dark: o.dark } : {}) });

/** The big faint word behind a page (Russo One, `sizeDp` tall). `color` = a C variant (C3 bag uses a darker ink). */
export const typeWord = (key: string, text: string, rect: UiRect, rel = ID, sizeDp = 140, color: string | null = null, vertical = false, fit = false): UiPart => ({ key, kind: "type", part: "typeWord", layer: "under", text, rect, sizeDp, spacingDp: 6, sx: rel.a, sy: rel.d, ...(color ? { color } : {}), ...(vertical ? { vertical: true } : {}), ...(fit ? { fit: true } : {}) });

// ------------------------------------------------------------------------------------------------ messages (C6, C6b, C9 9)
/**
 * The message parts (C6 / C9 9). Band: full width, 4 dp edges, orange tab on its top edge up to 206 dp (= native 46 dp right of x 0),
 * the slanted dark slab left of the text (14 dp below the band top, 152 dp tall, 40 dp slant), text Chakra Petch 600 32 / 42.
 * Balloon: body #E6F0FB, edge #2A5A9A, name tab #0C5A8A 16 dp in and 4 native above the body, text 30 / 42 #0A2A6A, name Russo 22 / 34.
 * More arrow: the down double chevron, 20 x 30 dp.
 */
export const MSG = Object.freeze({
    bandDp: 32, bandLineDp: 42, tabEnd: N(46), tabH: N(4), slabTop: N(14), slabH: N(152),
    textDp: 30, textLineDp: 42, textIn: 2, nameDp: 22, nameLineDp: 34, tabIn: N(16), tabUp: 4, tabMinW: 60, tabH14: 14, nameIn: 6,
    moreW: N(20), moreH: N(30), tailWiden: 4,
});
export const MORE_PATH = "M0 0L10 10L20 0V6L10 16L0 6Z M0 14L10 24L20 14V20L10 30L0 20Z";

/** The "more" arrow (C9 9) centred in the native box the game's own marker occupies. */
export const moreArrow = (key: string, box: UiRect, rel = ID, fill = "var(--c-orange)"): UiPart => ({
    key, kind: "svg", part: "more", layer: "over", vw: 20, vh: 30, d: MORE_PATH, fill,
    rect: { x: box.x + box.w / 2 - MSG.moreW * rel.a / 2, y: box.y + box.h / 2 - MSG.moreH * rel.d / 2, w: MSG.moreW * rel.a, h: MSG.moreH * rel.d }, sx: rel.a, sy: rel.d,
});

/**
 * The message band (C9 9) on native `rect` (already through its matrix): edge top and bottom, navy body, drop shadow down. A band that
 * starts at the left screen edge also gets the orange tab on its top edge and the slanted slab left of the text (both bleed left).
 */
export function messageBand(key: string, rect: UiRect, rel: UiMatrix | undefined, out: UiPart[]) {
    out.push({ key, kind: "band", part: "msgBand", layer: "under", rect, edge: "var(--c-edge)", body: "var(--c-body)", shadow: 6, sx: rel!.a, sy: rel!.d });
    if (rect.x > 0.5 || rect.w < 1) return;
    out.push(plate(`${key}.slab`, "msgSlab", { x: 0, y: rect.y + MSG.slabTop * rel!.d, w: 0, h: Math.max(0, Math.min(MSG.slabH * rel!.d, rect.h - 2 * MSG.slabTop * rel!.d)) }, rel, { shape: "sr", edge: "var(--c-wall)", body: null, shadow: 0 }));
    out.push(rule(`${key}.tab`, { x: 0, y: rect.y, w: Math.min(MSG.tabEnd, rect.w), h: MSG.tabH * rel!.d }, "var(--c-orange)", rel, "under", "msgTab"));
}

/** A band text line: the game's run at its own pen, Chakra Petch 600 32 / 42, never wider than the band (`right` native). */
export const bandLine = (key: string, r: { text: string; x: number; y: number; }, right: number, rel = ID, o: UiTextOpts = {}) => textPart(key, "body", r.text,
    { x: r.x, y: r.y + 4.5 - N(o.lineDp ?? MSG.bandLineDp) / 2, w: Math.max(8, right - r.x), h: N(o.lineDp ?? MSG.bandLineDp) },
    o.sizeDp ?? MSG.bandDp, o.lineDp ?? MSG.bandLineDp, { rel, color: o.color ?? null, maxDp: Math.round(Math.max(8, right - r.x) * 3) });

/**
 * The C balloon (C6): one silhouette of body + tail. `body` = native rect, `tail` = { side: "top" | "bottom", b0, b1, tip: [x, y] }
 * (native, or null). The descriptor keeps both relative to its own rect (the bounding box), so the DOM side scales them with the rect.
 */
export function balloonPart(key: string, body: UiRect, tail: UiBalloonTail | null, rel = ID): UiPart {
    let x0 = body.x, y0 = body.y, x1 = body.x + body.w, y1 = body.y + body.h;
    if (tail) { x0 = Math.min(x0, tail.tip[0]); x1 = Math.max(x1, tail.tip[0]); y0 = Math.min(y0, tail.tip[1]); y1 = Math.max(y1, tail.tip[1]); }
    const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    return {
        key, kind: "balloon", part: "balloon", layer: "under", rect, edge: "var(--c-bln-edge)", body: "var(--c-bln-body)", shadow: 6,
        inner: { x: body.x - x0, y: body.y - y0, w: body.w, h: body.h },
        tail: tail ? { side: tail.side, b0: tail.b0 - x0, b1: tail.b1 - x0, tip: [tail.tip[0] - x0, tail.tip[1] - y0] } : null,
        sx: rel.a, sy: rel.d,
    };
}

/** Split a run into its first button badge token and the plain text. */
export function badgeText(str: string) {
    let txt = "", badge: string | null = null;
    for (const piece of splitTokens(str)) {
        if (piece.tok && hasBadge(piece.tok) && !badge) badge = piece.tok;
        else if (piece.txt) txt += piece.txt;
    }
    return { badge, txt: txt.trim() };
}

/** One text line that may start with a button token: round badge + text. (x, y) = top-left of the line, native. */
export function tokenLine(key: string, str: string, x: number, y: number, rel: UiMatrix, out: UiPart[], o: UiTextOpts = {}) {
    const sizeDp = o.sizeDp ?? 26, lineDp = o.lineDp ?? 36, role = o.role ?? "body";
    const { badge, txt } = badgeText(str);
    const lineN = N(lineDp);
    let tx = x;
    if (badge) { out.push({ key: `${key}.badge`, kind: "icon", part: "hintIcon", layer: "over", rect: applyRel({ x, y: y + (lineN - N(32)) / 2, w: N(32), h: N(32) }, rel), svg: badgeSvg(badge), sx: rel.a, sy: rel.d }); tx = x + N(44); }
    const w = o.right != null ? Math.max(8, o.right - tx) : (o.w ?? 150);     // o.right = the line's right edge (native); else o.w wide
    out.push(textPart(`${key}.text`, role, txt, applyRel({ x: tx, y, w, h: lineN }, rel), sizeDp, lineDp, { rel, maxDp: w * 3, color: o.color ?? null }));
}

// ------------------------------------------------------------------------------------------------ full-screen pages (C7)
/**
 * The C7 family C colours (name entry keyboard): window edge / body, key edge / body / ink, the empty key, the focused name slot, the
 * button body. One table; every key, slot and button takes its colours from here.
 */
export const FAMILY_C = Object.freeze({
    edge: "var(--c-c-edge)", body: "var(--c-c-body)", keyEdge: "var(--c-key-edge)", keyBody: "var(--c-key-body)", keyInk: "var(--c-key-ink)",
    emptyEdge: "var(--c-key-empty-edge)", emptyBody: "var(--c-key-empty-body)", slotOn: "var(--c-slot-on)", slotInk: "var(--c-slot-ink)",
    stripe: "var(--c-c-stripe)", stripeDark: "var(--c-c-stripe-dark)", word: "var(--c-c-word)",
});

/** A family C window (C7: 4 dp edge #2AA8FF, body #000818, chamfer 24 / 22, drop shadow 6). */
export const cWindow = (key: string, rect: UiRect, rel = ID, o: UiPlateOpts = {}): UiPart => plate(key, o.part ?? "window", rect, rel, { shape: o.shape ?? "ch", edge: o.edge ?? FAMILY_C.edge, body: FAMILY_C.body, layer: o.layer });

/**
 * One C7 key (38 x 50 dp, chamfer 8, 2 dp under-edge) with its letter (Russo 26 / 48, centred). state = "on" (the cursor's key: solid
 * orange, dark ink), "key" (a letter) or "empty" (no letter: dim). `ch` = the game's glyph on that key ("" = none).
 */
export function keyCap(key: string, rect: UiRect, ch: string | undefined, state: string, rel: UiMatrix | undefined, out: UiPart[]) {
    const on = state === "on", empty = state === "empty";
    out.push(plate(`${key}.plate`, "key", rect, rel, { shape: "key", edge: on ? "var(--c-orange)" : empty ? FAMILY_C.emptyEdge : FAMILY_C.keyEdge, body: on ? "var(--c-orange)" : empty ? FAMILY_C.emptyBody : FAMILY_C.keyBody, shadow: 0 }));
    if (ch) out.push(textPart(`${key}.ch`, "label", ch, rect, 26, 48, { align: "center", spacing: 0, color: on ? "var(--c-orange-ink)" : FAMILY_C.keyInk, rel }));
}

/** One C7 name slot (45 x 51 dp, chamfer 8, edge all round, drop shadow 4); `on` = the slot the game's cursor is on (orange edge, amber body). */
export function nameSlot(key: string, rect: UiRect, ch: string, on: boolean, rel: UiMatrix | undefined, out: UiPart[]) {
    out.push(plate(`${key}.plate`, "slot", rect, rel, { shape: "key", underEdge: "all", edge: on ? "var(--c-orange)" : FAMILY_C.edge, body: on ? FAMILY_C.slotOn : FAMILY_C.body, shadow: 4 }));
    if (ch) out.push(textPart(`${key}.ch`, "label", ch, rect, 28, 51, { align: "center", spacing: 0, color: on ? FAMILY_C.slotInk : null, rel }));
}

/** A C7 button (DEL / SPC / arrows / OK): kb frame, body #001030; `on` = the cursor's button (orange edge, amber body). */
export const keyButton = (key: string, rect: UiRect, on: boolean, rel = ID): UiPart => plate(key, "keyButton", rect, rel, { shape: "kb", edge: on ? "var(--c-orange)" : FAMILY_C.edge, body: on ? FAMILY_C.slotOn : FAMILY_C.keyBody, shadow: 4 });

// ------------------------------------------------------------------------------------------------ the battle HUD (C8)
/** C8 colours: cyan edge, navy body, the dark name slab / key box body, the bar track, the gauge well. */
export const HUD = Object.freeze({ edge: "var(--c-cyan)", body: "var(--c-hud-body)", slab: "var(--c-hud-slab)", track: "var(--c-hud-track)", well: "var(--c-hud-well)" });

/** The C8 key box left of a command row (k shape, 4 dp edge all round, drop shadow 4); `on` = solid orange with the dark bullet. */
export function keyBox(key: string, rect: UiRect, on: boolean, rel: UiMatrix | undefined, out: UiPart[]) {
    out.push(plate(key, "keyBox", rect, rel, { shape: "key", underEdge: "all", edge: on ? "var(--c-orange)" : HUD.edge, body: on ? "var(--c-orange)" : HUD.slab, shadow: 4 }));
    if (on) out.push({ key: `${key}.dot`, kind: "svg", part: "keyDot", layer: "over", vw: 16, vh: 16, d: "M8 1A7 7 0 1 1 7.99 1Z", fill: "var(--c-orange-ink)",
        rect: { x: rect.x + N(12) * rel!.a, y: rect.y + rect.h / 2 - N(8) * rel!.d, w: N(16) * rel!.a, h: N(16) * rel!.d }, sx: rel!.a, sy: rel!.d });
}

/** The C8 row chevron (30 x 20 dp, two right-pointing chevrons) with its top-left at (x, y) native. */
export const rowChevron = (key: string, x: number, y: number, rel = ID, fill = "var(--c-orange-ink)"): UiPart => ({
    key, kind: "svg", part: "rowChevron", layer: "over", vw: 30, vh: 20, d: "M0 0L10 10L0 20H6L16 10L6 0Z M14 0L24 10L14 20H20L30 10L20 0Z", fill,
    rect: applyRel({ x, y, w: 10, h: N(20) }, rel), sx: rel.a, sy: rel.d,
});

/**
 * A C8 frame with a window cut out of it (the partner close-up bezel): the ch outline (24 dp chamfers, 4 dp cyan edge, navy body) around
 * `hole` (native, inside `rect`), which stays open so whatever is under the overlay (the live 3D face) shows through. Two svg rings with
 * the even-odd rule; the hole gets chamfers just big enough to sit inside the body's inner chamfers.
 */
export function ringFrame(key: string, rect: UiRect, hole: UiRect, rel: UiMatrix, out: UiPart[]) {
    const W = rect.w, H = rect.h, c = N(24), e = N(4), ci = N(22);
    const hx = hole.x - rect.x, hy = hole.y - rect.y, hw = hole.w, hh = hole.h;
    const need = 2 * e + ci + 1.5;
    const hc = Math.max(0, need - hx - hy, need - (W - hx - hw) - (H - hy - hh));
    const f = (n: number) => +n.toFixed(3);
    const poly = (pts: readonly (readonly [number, number])[]) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join("L")}Z`;
    const outer = poly([[c, 0], [W, 0], [W, H - c], [W - c, H], [0, H], [0, c]]);
    const inner = poly([[e + ci, e], [W - e, e], [W - e, H - e - ci], [W - e - ci, H - e], [e, H - e], [e, e + ci]]);
    const win = poly([[hx + hc, hy], [hx + hw, hy], [hx + hw, hy + hh - hc], [hx + hw - hc, hy + hh], [hx, hy + hh], [hx, hy + hc]]);
    const r = applyRel(rect, rel);
    out.push({ key: `${key}.body`, kind: "svg", part: "ringBody", layer: "under", vw: W, vh: H, d: `${inner} ${win}`, rule: "evenodd", fill: HUD.body, rect: r, sx: rel.a, sy: rel.d });
    out.push({ key: `${key}.edge`, kind: "svg", part: "ringEdge", layer: "under", vw: W, vh: H, d: `${outer} ${inner}`, rule: "evenodd", fill: HUD.edge, rect: r, sx: rel.a, sy: rel.d });
}

/** A C8 HP bar: the track (12 dp slant on the right end) with the fill at `ratio`; dir "rtl" keeps the right end (the enemy's bar). */
export const hudBar = (key: string, rect: UiRect, ratio: number, color: string, rel = ID, dir = "ltr"): UiPart => ({
    key, kind: "bar", part: "hpBar", layer: "over", rect: applyRel(rect, rel), track: HUD.track, color, ratio, slant: 12, dir, sx: rel.a, sy: rel.d,
});

// ------------------------------------------------------------------------------------------------ the living ring (battle "dock" look)
/** A fraction 0..1 of `v` over `max` (a bad or empty max is 0), rounded to 4 places so the part signature only moves with the data. */
export const frac = (v: number | undefined, max: number) => (max > 0 ? Math.round(Math.min(1, Math.max(0, Number(v) / max)) * 1e4) / 1e4 : 0);

/** Ring sizes in design px (the C file, 3 per native unit): box side `vb`, the arcs' [radius, width], the core disc radius, the core text rows
 *  [x, y, w, lineHeight, size] inside the ring's own box. */
export const RING: Readonly<Record<UiRingVariant, UiRingShape>> = Object.freeze({
    main: Object.freeze<UiRingShape>({ vb: 360, dvR: 174, hp: [150, 16], mp: [124, 9], core: 110, ticks: 167,
        text: { nm: [86, 122.5, 188, 24, 18], lv: [149, 147.5, 26, 18, 15], lvn: [177, 147.5, 34, 20, 20], hn: [85, 166.5, 190, 46, 40], mn: [120, 213.5, 120, 24, 19] } }),
    mini: Object.freeze<UiRingShape>({ vb: 150, dvR: 0, hp: [60, 9], mp: [47, 5], core: 50, ticks: 72,
        text: { nm: [30, 47, 90, 16, 14], hn: [29, 64, 92, 22, 19], mn: [40, 87, 70, 16, 14] } }),
});

/** The ring as one part (parts.js builds it once and only moves the arcs afterwards). rect = native square. */
export const ringPart = (key: string, rect: { x: number; y: number; w: number; h: number; cx: number; cy: number; R: number; } | undefined, variant: UiRingVariant, v: UiRingValues, menu = false, o: UiRingOpts = {}): UiPart => ({
    key, kind: "ring", part: "ring", layer: "over", rect, variant, menu: !!menu,
    ...(o.act ? { act: true } : {}), ...(o.real != null ? { real: o.real, eReal: o.eReal } : {}), ...(o.mpPrev != null ? { mpPrev: frac(Math.max(0, v.mp - o.mpPrev), v.maxMp) } : {}),
    hp: frac(v.hp, v.maxHp), mp: frac(v.mp, v.maxMp), dv: variant === "main" ? frac(v.gauge, v.maxGauge ?? 1000) : 0,
    dvFull: variant === "main" && Number(v.gauge) >= (v.maxGauge ?? 1000), down: !(Number(v.hp) > 0), sx: 1, sy: 1,
});

/** The core text of a ring (name, LV, HP and MP numbers), native rects inside `rect`; the text shrinks with the ring (rel). */
export function ringTexts(key: string, rect: { w: number; x: number; y: number; }, variant: UiRingVariant, v: UiRingValues, o: UiRingOpts = {}) {
    const g = RING[variant], u = rect.w / (g.vb / 3), rel = { a: u, d: u };
    const row = (id: string, role: string, str: string, o: UiTextOpts = {}) => {
        // ETS item 9: the ids are the five rows the main ring carries; the mini ring is only asked for nm, hn, mn
        const [x, y, w, h, size] = g.text[id]!;
        return textPart(`${key}.${id}`, role, str, { x: rect.x + x / 3 * u, y: rect.y + y / 3 * u, w: w / 3 * u, h: h / 3 * u }, size, h, { maxDp: w, rel, ...o });
    };
    const hp = `${Math.round(v.hp)}/${Math.round(v.maxHp)}`, mp = `${Math.round(v.mp)}/${Math.round(v.maxMp)}`;
    const out = [row("nm", "label", String(v.name ?? ""), { align: "center", color: "#fff", spacing: 0 })];
    if (variant === "main") {
        out.push(row("lv", "label", "LV", { color: "var(--c-dim-label)", spacing: 0 }), row("lvn", "number", String(v.level ?? ""), { color: "var(--c-num)" }));
    }
    const mpShown = o.mpPrev != null ? `${Math.max(0, Math.round(v.mp - o.mpPrev))}/${Math.round(v.maxMp)}` : mp;
    out.push(row("hn", "number", hp, { align: "center", color: "#fff" }), row("mn", "number", mpShown, { align: "center", color: o.mpPrev != null ? "var(--c-hot-ink)" : "var(--c-mp)" }));
    return out;
}

// ------------------------------------------------------------------------------------------------ the command dock (battle "Arc + Dock")
/**
 * The dock's tokens (design px, 3 per native). Nothing here is a hand-picked position: every slot, the dock point and the arc radius are derived by
 * `dockArc` from the RING's radius plus these few spacing numbers, so changing the ring's size (battlehud.js RING_FRAC) moves everything with it.
 *   sizeDp / lineDp / spacingDp  the command word's font size, line height and letter spacing      scale  how much the docked word grows
 *   listScale / listSizeDp / listLineDp  the same for a list row (technique / item / Tag)           gapDp  the clear gap between two rows
 *   dockAngle  the dock's angle off the ring's right side      dockGapDp  the dock's distance beyond the ring's edge
 *   arcGapDp  the least distance of the arc beyond the ring's edge      clearDp  the least gap between the ring's edge and any word
 */
export const DOCK_WORD = Object.freeze({ sizeDp: 40, lineDp: 46, spacingDp: 2, scale: 1.7, listScale: 1.3, listSizeDp: 30, listLineDp: 36, gapDp: 10, dockAngle: -10, dockGapDp: 22, arcGapDp: 110, clearDp: 36 });
/**
 * Where the words and the dock sit, native units, around the ring `hub` = { cx, cy, R } (R = the ring box's radius in native). The rows are one
 * column around the dock point: the docked word's own height above and below it, then one pitch per row; most rows above, `floor(n / 3)` (from 4 rows
 * on) below. The arc passes through the farthest row; every row keeps `clearDp` off the ring. Fixed for the whole menu: the slots never move with the focus.
 * `stage` = the visible native rect; each word's `maxDp` is the widest it may be at the base size so that both its slot and (times the scale) the dock
 * keep it inside the stage. Pure.
 */
export function dockArc(hub: UiDockHub, stage: { x0: number; y0: number; x1: number; y1: number; }, count = 6, list = false) {
    const D = DOCK_WORD, S = stage ?? { x0: 0, y0: 0, x1: 320, y1: 240 }, pad = 1;
    const R = hub.R ?? 60 * (hub.k ?? 1), Rdp = R * 3;
    const line = list ? D.listLineDp : D.lineDp, sc = list ? D.listScale : D.scale, pitch = line + D.gapDp;
    const dockA = D.dockAngle * Math.PI / 180, dockR = Rdp + D.dockGapDp;
    const dock = { x: hub.cx + dockR * Math.cos(dockA) / 3, y: hub.cy + dockR * Math.sin(dockA) / 3 };
    const dockMax = Math.max(0, (S.x1 - pad - dock.x) * 3 / sc);
    const below = count >= 4 ? Math.floor(count / 3) : 0, above = count - below;
    const near = line * sc / 2 + line / 2 + D.gapDp / 2, dockDy = dockR * Math.sin(dockA);
    const dys = Array.from({ length: count }, (_, j) => j < above ? dockDy - near - (above - 1 - j) * pitch : dockDy + near + (j - above) * pitch);
    const arcR = Math.max(Rdp + D.arcGapDp, 1.12 * Math.max(0, ...dys.map(Math.abs)));
    const words = dys.map((dy) => {
        const x = hub.cx + Math.max(Math.sqrt(Math.max(0, arcR * arcR - dy * dy)), Rdp + D.clearDp) / 3;
        return { x, y: hub.cy + dy / 3, maxDp: Math.floor(Math.max(0, Math.min((S.x1 - pad - x) * 3, dockMax))) };
    });
    return { hub: { x: hub.cx, y: hub.cy }, R, k: arcR / 330, arcR, dockR, dock, words, scale: sc, pitch, line };
}
/** The command dock as one part: `labels` = the words in row order, `on` = the focused index or -1, geometry from dockArc. */
export const dockPart = (key: string, stage: { x0: number; y0: number; x1: number; y1: number; }, hub: { cx: number; cy: number; R: number; }, labels: readonly string[], on: number, o: UiDockOpts = {}): UiPart => {
    const S = stage ?? { x0: 0, y0: 0, x1: 320, y1: 240 }, a = dockArc(hub, S, labels.length, !!o.rows);
    const rows = o.rows;
    return { key, kind: "dock", part: "dock", layer: "over", rect: { x: S.x0, y: S.y0, w: S.x1 - S.x0, h: S.y1 - S.y0 }, hub: a.hub, k: a.k, R: a.R, dockR: a.dockR, dock: a.dock,
        words: a.words.map((w, i) => ({ t: String(labels[i]), x: w.x, y: w.y, maxDp: w.maxDp, ...(rows ? { chip: rows[i]!.chip ?? "", el: rows[i]!.el ?? "", r: rows[i]!.r ?? "", dis: !!rows[i]!.dis } : {}) })),
        on, ...(rows ? { list: true, scale: a.scale, title: o.title ?? "", pager: !!o.pager } : {}), sx: 1, sy: 1 };
};
/** The damage number that pops at a hit: shown while the game's own "N damage!" line is up; `side` = who was hit. The DOM plays the CSS pop once per element. */
export const popPart = (key: string, rect: UiRect, n: number | string, side: string, o: UiPopOpts = {}): UiPart => ({ key, kind: "pop", part: "pop", layer: "over", rect, n, side, o, evt: o.evt ?? "", sx: 1, sy: 1 });
/** One node of the turn arc (top right): `turn` = "now" | "next" | "later", `side` = "player" | "enemy", `letter` = the name's initial. */
export const turnNode = (key: string, rect: { x: number; y: number; w: number; h: number; }, o: { side: string; turn: string | undefined; letter: string; rect: { x: number; y: number; w: number; h: number; }; }): UiPart => ({ key, kind: "node", part: "turnNode", layer: "over", rect, turn: o.turn, side: o.side, letter: o.letter, nb: false, sx: 1, sy: 1 });
