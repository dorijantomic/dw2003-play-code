// web/ui-c/books.js -- look C kit: our own screens, the ones that are not on the disc (T9): the books (OPTIONS, GLOSSARY, the map
// screen book, the FLY book; web/book-host.js) and the pause QUESTS page (engine/dw3/ui/native/pause-quests.ts). They are all built from
// the same disc pieces (web/ui-kit.js: header bar cmfont 24, the list window cmfont 36 or a panel of the pause list's tiles, the footer
// band ststat 32), so one composer serves them all. Pure: the claimed parts + text runs of a scope in, descriptors (native units) out.
//
//   composeBookHeader  the slanted header plate; the first run is the title (Russo One), then the section tabs: the active one on an
//                      orange tab, the others dim (the game draws them with the dim font row, clut 7); "L1" / "R1" become C page chips
//   composeBookPanel   a C window per panel. A panel with the list cursor in it is a list: the shared rows (pages.js composeRows: plain
//                      rows on the navy under-edge, the focused row solid orange and pushed out, the chevron in the cursor's pose). A line
//                      that starts left of the cursor column (the GLOSSARY counts line) is a head line, not a row. cfg.rows = false (the map
//                      book: the cursor points at an area box, not a row) = the chevron alone at the game's cursor.
//   bars               the GLOSSARY strength bars (web/ui-kit.js drawBar hands them over: { part: "bookBar", ratio })
//   map                the map book's links (one svg) and area boxes (web/map-screen-book.js hands them over)
//   arrows             the game's ◀ ▶ ▲ ▼ glyphs = the small orange C triangles
// Every string is the game's own run; every position the game's own draw position (the `rel` matrix carries the folds).
import { applyRel } from "./geometry.js";
import { isCursorToken } from "./icons.js";
import { N, ID, textPart, plate, cursor, chip, tabPlate, tokenLine, stripes, typeWord, cardBar, triangle, TRIANGLE, PAGE_KEY } from "./base.js";
import { clipRect, restOfRuns, runText } from "./generic.js";
import { composeRows, composeFooter, runIn } from "./pages.js";
import type { BookOpts } from "./types.js";

/** Sizes (design px unless named): title Russo 26 / 36, tabs 20 / 30, the L1 / R1 chip 52 x 32, a map link 0.8 native wide, a map box 8 native. */
export const BOOK = Object.freeze({ titleDp: 26, titleLineDp: 36, tabDp: 20, tabLineDp: 30, tabIn: N(16), tabOut: N(26), chipW: N(52), chipH: N(32), chipMaxX: 318, link: 0.8 });
const DIM = "var(--c-dim-label)";

/** The game font's dim row (clut 7): inactive tabs, unknown species, "No picture", headings of the GLOSSARY pages. */
export const isDimRun = (r) => (r.clut | 0) === 7;

/** The ◀ ▶ ▲ ▼ glyph runs as C triangles, centred on the glyph the game drew. */
export function composeGlyphArrows(runs, used, out, prefix = "arrow") {
    runs.forEach((r) => {
        const dir = TRIANGLE[String(r.text).trim()];
        if (!dir || used.has(r)) return;
        used.add(r);
        out.push(triangle(`${prefix}.${dir}@${Math.round(r.x)},${Math.round(r.y)}`, r.x + Math.max(6, r.w ?? 7) / 2, r.y + 4.5, dir));
    });
}

/** The header plate with its title, tabs and L1 / R1 chips (see the file header). */
export function composeBookHeader(p, runs, used, out) {
    const rel = p.rel, r = clipRect(p), mid = r.y + r.h / 2;
    out.push(plate("book.header", "header", r, rel, { shape: "sl" }));
    const mine = runs.filter((m) => !used.has(m) && !isCursorToken(m.text) && m.y + 4.5 >= r.y && m.y + 4.5 < r.y + r.h).sort((a, b) => a.x - b.x);
    const isPage = (m) => PAGE_KEY.test(String(m.text).trim());
    // an L1 / R1 chip, centred on the game's word but kept inside x 318: a plate that reaches the screen edge bleeds to it
    const chipX = (m) => Math.min(m.x + Math.max(6, m.w ?? 8) / 2 - BOOK.chipW / 2, BOOK.chipMaxX - BOOK.chipW);
    const startOf = (m) => (isPage(m) ? Math.min(m.x, chipX(m)) : m.x);
    mine.forEach((m, k) => {
        used.add(m);
        const key = `book.hdr${k}`, next = mine[k + 1] ? startOf(mine[k + 1]) : r.x + r.w, room = Math.max(8, next - m.x - 2), w = Math.max(6, m.w ?? 8);
        if (isPage(m)) {
            const rc = { x: chipX(m), y: mid - BOOK.chipH / 2, w: BOOK.chipW, h: BOOK.chipH };
            out.push(chip(`${key}.chip`, applyRel(rc, rel), rel));
            out.push(textPart(`${key}.text`, "label", m.text.trim(), applyRel({ x: rc.x, y: mid - N(14), w: rc.w, h: N(28) }, rel), 16, 28, { align: "center", color: "var(--c-ink)", rel }));
            return;
        }
        if (k === 0) {          // the title (or the QUESTS prompt with its button badge)
            tokenLine(key, m.text, m.x, mid - N(BOOK.titleLineDp) / 2, rel, out, { role: "label", sizeDp: BOOK.titleDp, lineDp: BOOK.titleLineDp, w: room });
            return;
        }
        const lineN = N(BOOK.tabLineDp), top = mid - lineN / 2;
        if (isDimRun(m)) {
            out.push(textPart(key, "label", m.text, applyRel({ x: m.x, y: top, w: room, h: lineN }, rel), BOOK.tabDp, BOOK.tabLineDp, { color: DIM, rel, maxDp: Math.round(room * 3) }));
            return;
        }
        // the active section: an orange C tab behind the game's word, never over the next word
        const tx = m.x - BOOK.tabIn, tw = Math.min(w * 1.15 + BOOK.tabIn + BOOK.tabOut, next - 1 - tx), th = N(BOOK.tabLineDp + 6);
        out.push(tabPlate(`${key}.tab`, applyRel({ x: tx, y: mid - th / 2, w: tw, h: th }, rel), rel, { edge: "var(--c-orange)", part: "bookTab" }));
        out.push(textPart(key, "label", m.text, applyRel({ x: m.x, y: top, w: Math.max(8, tx + tw - m.x - BOOK.tabOut / 2), h: lineN }, rel), BOOK.tabDp, BOOK.tabLineDp,
            { color: "var(--c-orange-ink)", rel, maxDp: Math.round(Math.max(8, tx + tw - m.x - BOOK.tabOut / 2) * 3) }));
    });
}

/** One panel: a C window; a list when the cursor is in it (see the file header). `i` = the part's index (keys). */
export function composeBookPanel(p, i, runs, used, out, cfg: BookOpts = {}) {
    const r = clipRect(p);
    const inside = runs.filter((m) => !used.has(m) && runIn(m, r));
    const cur = inside.find((m) => isCursorToken(m.text));
    if (cur && cfg.rows !== false) {
        inside.filter((m) => !isCursorToken(m.text) && m.x < cur.x - 0.5).forEach((m, k) => { used.add(m); out.push(runText(m, `win${i}.head${k}`, ID, { color: DIM })); });
        composeRows(p, i, runs, used, out);
        return;
    }
    out.push(plate(`win${i}.plate`, "window", r, p.rel, { shape: "ch" }));
    if (cur) {
        used.add(cur);
        const ch = cursor(`win${i}.cursor`, cur.text, cur.x + 5, cur.y + 4.5, ID, "var(--c-orange)");
        if (ch) out.push(ch);
    }
}

/** A line of `w` native from (x0, y0) to (x1, y1) as a filled quad, in native units relative to (ox, oy). */
export function linkQuad([x0, y0, x1, y1], ox, oy, w = BOOK.link) {
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = (-dy / len) * (w / 2), ny = (dx / len) * (w / 2);
    const f = (n) => +n.toFixed(3);
    return `M${f(x0 - ox + nx)} ${f(y0 - oy + ny)}L${f(x1 - ox + nx)} ${f(y1 - oy + ny)}L${f(x1 - ox - nx)} ${f(y1 - oy - ny)}L${f(x0 - ox - nx)} ${f(y0 - oy - ny)}Z`;
}

/** The map book's links: one svg for the links between two seen areas (C edge), one for the rest (navy under-edge). */
export function composeMapLinks(p, out) {
    const rel = p.rel, rect = { x: p.x, y: p.y, w: p.w, h: p.h };
    for (const [k, seen, fill] of [["seen", true, "var(--c-edge)"], ["dim", false, "var(--c-under)"]]) {
        const d = (p.segs ?? []).filter((s) => !!s[4] === seen).map((s) => linkQuad(s, p.x, p.y)).join(" ");
        if (d) out.push({ key: `map.links.${k}`, kind: "svg", part: "mapLinks", layer: "under", vw: p.w, vh: p.h, d, fill, rect: applyRel(rect, rel), sx: rel.a, sy: rel.d });
    }
}

/** One area box of the map book: "here" = solid orange, seen = the C chip, not seen yet = the dim empty plate. */
export const MAP_NODE = Object.freeze({
    here: Object.freeze({ edge: "var(--c-orange)", body: "var(--c-orange)" }),
    seen: Object.freeze({ edge: "var(--c-edge)", body: "var(--c-body)" }),
    unseen: Object.freeze({ edge: "var(--c-empty-edge)", body: "var(--c-empty-body)" }),
});
export function composeMapNode(p, i, out) {
    const c = MAP_NODE[p.state] ?? MAP_NODE.seen;
    out.push(plate(`map.node${i}`, "mapNode", applyRel({ x: p.x, y: p.y, w: p.w, h: p.h }, p.rel), p.rel, { shape: "chip", edge: c.edge, body: c.body, shadow: 0 }));
}

/**
 * A book screen or the QUESTS page. cfg = { rows (false = a free cursor, the map book), word (the big faint word on the backdrop),
 * dimClut (true = the runs come from web/uifont.js drawText, where clut 7 is the dim face) }.
 */
export function composeBook({ parts, runs }, cfg: BookOpts = {}) {
    const out = [], used = new Set();
    if (cfg.dimClut) for (const r of runs) if (isDimRun(r) && !r.face) r.face = DIM;
    const of = (n) => parts.filter((p) => p.part === n);
    const back = of("backdrop")[0];
    if (back) {
        out.push(stripes(back.x));
        if (cfg.word) out.push(typeWord("backdrop.type", cfg.word, { x: 12, y: N(390), w: 308, h: N(140) }, ID, 140, null, false, true));
    }
    composeGlyphArrows(runs, used, out);
    const header = of("header")[0];
    if (header) composeBookHeader(header, runs, used, out);
    parts.forEach((p, i) => { if (p.part === "window") composeBookPanel(p, i, runs, used, out, cfg); });
    of("mapLinks").forEach((p) => composeMapLinks(p, out));
    of("mapNode").forEach((p, i) => composeMapNode(p, i, out));
    of("bookBar").forEach((p, i) => out.push(cardBar(`bar${i}@${Math.round(p.x)},${Math.round(p.y)}`, applyRel({ x: p.x, y: p.y, w: p.w, h: p.h }, p.rel), p.ratio ?? 0, "var(--c-hp)", p.rel)));
    const foot = of("footer")[0];
    if (foot) composeFooter(foot, runs, used, out);
    restOfRuns(runs, used, ID, out, "book");
    return out;
}

/** The pause QUESTS page: the diamond backdrop with the faint word, the header bar, the quest list, the description band. */
export const composeQuests = (c) => composeBook(c, { word: "QUESTS" });
