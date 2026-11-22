// web/ui-c/lists.js -- look C kit: the paged lists and picture grids (design C3 item bag + C9 parts). Pure: the claimed draw-call parts
// and the text runs of a scope in, part descriptors in native units out. Pieces:
//   composeListWin     the list window: a full-width band (edges top + bottom, chamfer bottom-left) or a chamfered frame
//   composeTabHeader   the orange title tab over a list ("Items")
//   composeItemCells   two-column item rows from the game's row underlines: one plate per item (icon stays art), the cursor row orange
//                      and pushed out 12 native, empty plates for the slots of the page the game leaves empty (never a shift)
//   composePager       the page counter "n / m" (the game's own runs), L1 / R1 chips only where the game draws its page arrows
//   composeGridBits    frames under picture-grid art (card faces, drill pictures, form portraits), empty card slots, cursor boxes,
//                      the chart's connector lines
// Every string is the game's own run; every position is the game's own draw position (the `rel` matrix carries folds and slides).
import { applyRel } from "./geometry.js";
import { isCursorToken } from "./icons.js";
import { clipRect } from "./generic.js";
import { N, ID, textPart, plate, rule, rowPlate, cursor, corners, chip, typeWord, tabPlate, PAGE_KEY } from "./base.js";
import type { UiRect } from "./types.js";

/** List sizes (native, C3): row pitch 14, columns 131 apart, cell 120 x 12 (C3 360 x 36 dp) starting 14 dp left of the icon, cursor row pushed out 12. */
export const LIST = Object.freeze({ pitch: 14, colPitch: 131, cellW: 120, cellH: 12, lead: N(14), push: 12 });
const isNum = (t) => /^[0-9][0-9,]*$/.test(String(t).trim());

// ------------------------------------------------------------------------------------------------ window + tab
/** The list window. Full width (>= 300 native) = the C3 band; narrower = the chamfered frame. `cfg.word` = the faint word inside it. */
export function composeListWin(p, i, out, cfg: { word?: string | null | undefined; } = {}) {
    const rel = p.rel, r = clipRect(p);
    const band = (p.w ?? r.w) >= 300;
    out.push(plate(`lw${i}.plate`, "listWindow", r, rel, { shape: band ? "bandCh" : "ch" }));
    if (cfg.word) { const wx = p.x + p.bx + N(400); out.push(typeWord(`lw${i}.type`, cfg.word, applyRel({ x: wx, y: p.y + p.by + N(204), w: Math.max(40, 320 - wx), h: N(150) }, rel), rel, 150, "var(--c-type-deep)", false, true)); }
}

/** The orange title tab (C3 "Items"): the tab at the game's clip rect, the game's title run in Russo One 26, dark ink. */
export function composeTabHeader(p, i, runs, used: Set<unknown>, out) {
    const rel = p.rel, r = clipRect(p);
    out.push(tabPlate(`tab${i}.plate`, r, rel, { edge: "var(--c-orange)" }));
    for (const m of runs) {
        if (used.has(m) || isCursorToken(m.text)) continue;
        if (m.x < p.x - 2 || m.x >= p.x + (p.w || 0) || Math.abs(m.y + 4.5 - (p.y + (p.h || 16) / 2)) > (p.h || 16) / 2) continue;
        used.add(m);
        out.push(textPart(`tab${i}.text`, "label", m.text, applyRel({ x: m.x, y: p.y + p.by + ((p.h || 16) - N(34)) / 2, w: 150, h: N(34) }, rel), 26, 34, { color: "var(--c-orange-ink)", rel, maxDp: Math.max(60, (p.x + p.w - m.x) * 3) }));
    }
}

// ------------------------------------------------------------------------------------------------ item cells
/** The native rect of the cell whose icon sits at (x, y); `on` = the cursor row (pushed out to the left). */
export function cellRect(x: number, y: number, on = false) {
    const left = x - LIST.lead - (on ? LIST.push : 0);
    return { x: left, y, w: LIST.cellW + (on ? LIST.push : 0), h: LIST.cellH };
}

/** The cursor run that points at the row underline `u` (same row, just left of its icon). */
export const cursorFor = (runs, u: { y: number; x: number; }) => runs.find((r) => isCursorToken(r.text) && Math.abs(r.y - u.y) <= 2 && r.x < u.x && r.x >= u.x - 18) ?? null;

/**
 * The slots of one list page: `lines` = the row underline parts (one per item the game shows), `pagerY` = the page counter's pen y (the
 * rows of a page end above it). Returns { cols, rows, y0, empty: [{ x, y }] } -- the positions of the page with no item.
 */
export function pageSlots(lines: { x: number; y: number; }[], pagerY: number | null = null, twoCols: boolean = true) {
    if (!lines.length) return { cols: [], rows: 0, y0: 0, empty: [] };
    const x0 = Math.min(...lines.map((u) => u.x)), y0 = Math.min(...lines.map((u) => u.y));
    const cols = twoCols ? [x0, x0 + LIST.colPitch] : [...new Set(lines.map((u) => u.x))].sort((a, b) => a - b);
    const rowOf = (y: number) => Math.round((y - y0) / LIST.pitch);
    const have = new Set(lines.map((u) => `${Math.round(u.x)},${rowOf(u.y)}`));
    const rows = pagerY != null && pagerY > y0 ? Math.max(1, Math.floor((pagerY - y0) / LIST.pitch)) : Math.max(...lines.map((u) => rowOf(u.y))) + 1;
    const empty = [];
    for (let r = 0; r < rows; r++) for (const cx of cols) if (!have.has(`${Math.round(cx)},${r}`)) empty.push({ x: cx, y: y0 + r * LIST.pitch });
    return { cols, rows, y0, empty };
}

/**
 * The item cells (C3). `lines` = row underline parts; the runs on a row become its name (Russo One 22) and right-anchored numbers.
 * Returns the set of `on` cell rects (native) so the icon highlight can take the dark ink on orange.
 */
export function composeItemCells(lines, runs, used, out, o: { pagerY?: number | null; twoCols?: boolean; } = {}) {
    if (!lines.length) return [];
    const rel = lines[0].rel, ons: { x: number; y: number; w: number; h: 12; }[] = [];
    const slots = pageSlots(lines, o.pagerY ?? null, o.twoCols !== false);
    slots.empty.forEach((s, k) => out.push(emptyPlate(`cell.empty${k}`, applyRel(cellRect(s.x, s.y), rel), rel, "row")));
    const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
    sorted.forEach((u, k) => {
        const cur = cursorFor(runs, u), on = !!cur, rc = cellRect(u.x, u.y, on), key = `cell${Math.round(u.x)}.${Math.round(u.y)}`;
        if (cur) used.add(cur);
        out.push(rowPlate(`${key}.plate`, applyRel(rc, rel), on, rel, "cell"));
        if (on) {
            ons.push(rc);
            const ch = cursor(`${key}.cursor`, cur.text, rc.x + N(10) + 5, rc.y + N(8) + N(10), rel);
            if (ch) out.push(ch);
        }
        const right = u.x - LIST.lead + LIST.cellW;
        for (const m of runs) {
            if (used.has(m) || isCursorToken(m.text) || Math.abs(m.y - u.y) > 3 || m.x < u.x || m.x >= right) continue;
            used.add(m);
            if (m.right != null && isNum(m.text)) {
                out.push(textPart(`${key}.n${Math.round(m.right)}`, "number", m.text, applyRel({ x: m.right - N(80), y: u.y, w: N(80), h: LIST.cellH }, rel), 22, 36, { align: "right", color: on ? "var(--c-orange-ink)" : "var(--c-ink)", rel, maxDp: 80 }));
            } else {
                out.push(textPart(`${key}.name`, "label", m.text, applyRel({ x: m.x, y: u.y, w: Math.max(8, right - m.x), h: LIST.cellH }, rel), 22, 36, { color: on ? "var(--c-orange-ink)" : (m.face ?? null), rel, maxDp: Math.max(40, (right - m.x) * 3 - 8) }));
            }
        }
    });
    return ons;
}

/** The icon highlight the game draws around the cursor row's icon: thin corner brackets, dark on the orange row, orange elsewhere. */
export function composeIconHl(p, i, ons: { x: number; y: number; w: number; h: 12; }[], out) {
    const r = clipRect(p), inOn = ons.some((c) => r.x + r.w / 2 >= c.x && r.x + r.w / 2 < c.x + c.w && r.y + r.h / 2 >= c.y - 2 && r.y + r.h / 2 < c.y + c.h + 2);
    out.push(corners(`ihl${i}`, r, inOn ? "var(--c-orange-ink)" : "var(--c-orange)", p.rel, "iconHl"));
}

// ------------------------------------------------------------------------------------------------ pager
/**
 * The page counter in the runs: a "/" run with a number run just left of it and a number just right (or one "/m" run). Runs already
 * used (card HP / MP pairs) are never taken. Returns { a, slash, b, total, y, cx } or null.
 */
export function findPager(runs, used = new Set()) {
    const free = runs.filter((r) => !used.has(r));
    for (const s of free) {
        const m = /^\/\s*([0-9]+)?$/.exec(String(s.text).trim());
        if (!m) continue;
        const endOf = (r) => r.right ?? r.x + (r.w ?? 0);
        const a = free.find((r) => r !== s && isNum(r.text) && Math.abs(r.y - s.y) <= 1 && endOf(r) <= s.x + 1 && s.x - endOf(r) < 12);
        const b = m[1] ? null : free.find((r) => r !== s && isNum(r.text) && Math.abs(r.y - s.y) <= 1 && r.x >= s.x && r.x - (s.x + (s.w ?? 0)) < 16);
        if (!a || (!m[1] && !b)) continue;
        return { a, slash: s, b, total: m[1] ?? b.text.trim(), y: s.y, cx: s.x + (s.w ?? 0) / 2 };
    }
    return null;
}

/**
 * "n / m" centred on the game's slash, Chakra Petch 700 28, white (C3). When the game draws the counter on a page plate (`plates` = native
 * rects, e.g. the album's), it is centred in that plate. Returns the pager or null.
 */
export function composePager(runs, used: Set<unknown> | undefined, out, rel = ID, plates = []) {
    const pg = findPager(runs, used);
    if (!pg) return null;
    for (const r of [pg.a, pg.slash, pg.b]) if (r) used!.add(r);
    const w = 40, h = N(40);
    const box = plates.find((b) => pg.cx >= b.x && pg.cx < b.x + b.w && pg.y + 4.5 >= b.y && pg.y + 4.5 < b.y + b.h);
    const rect = box ? { x: box.x, y: box.y + (box.h - h) / 2, w: box.w, h } : applyRel({ x: pg.cx - w / 2, y: pg.y + 4.5 - h / 2, w, h }, rel);
    out.push(textPart("pager.text", "number", `${pg.a.text.trim()} / ${pg.total}`, rect, 28, 40, { align: "center", color: "var(--c-ink)", rel }));
    return pg;
}

/** An L1 / R1 page chip, only where the game draws its page arrow: the chip sits on the game's "L1" / "R1" run near the clip. */
export function composePageChip(p, i, runs, used, out) {
    const rel = p.rel, r = clipRect(p), mx = r.x + r.w / 2, my = r.y + r.h / 2;
    const run = runs.filter((m) => !used.has(m) && PAGE_KEY.test(String(m.text).trim()))
        .map((m) => ({ m, d: Math.hypot(m.x + (m.w ?? 14) / 2 - mx, m.y + 4.5 - my) })).filter((o: { d: number; }) => o.d < 26).sort((a: { d: number; }, b: { d: number; }) => a.d - b.d)[0]?.m ?? null;
    const w = N(52), h = N(32);
    const cx = run ? run.x + (run.w ?? 14) / 2 : mx, cy = run ? run.y + 4.5 : my;
    const rc = { x: cx - w / 2, y: cy - h / 2, w, h };
    out.push(chip(`chip${i}.plate`, applyRel(rc, rel), rel));
    if (run) {
        used.add(run);
        out.push(textPart(`chip${i}.text`, "label", run.text.trim(), applyRel({ x: rc.x, y: cy - N(14), w, h: N(28) }, rel), 16, 28, { align: "center", color: "var(--c-ink)", rel }));
    }
}

// ------------------------------------------------------------------------------------------------ grids
/** A frame under a picture of a grid (card face, drill picture, form portrait): the art itself stays the game's pixels on the art canvas. */
export function composeArtFrame(p: { rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }> | undefined; }, i, out) {
    const r = clipRect(p), g = 2;
    out.push(plate(`gf${i}`, "gridFrame", { x: r.x - g * p.rel!.a, y: r.y - g * p.rel!.d, w: r.w + 2 * g * p.rel!.a, h: r.h + 2 * g * p.rel!.d }, p.rel, { shape: "chip", edge: "var(--c-under)", shadow: 4 }));
}

/** An empty grid slot (no card there): the dim C empty plate at the game's slot rect; nothing moves into it. */
export function composeEmptyCell(p: { rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }> | undefined; }, i, out) {
    out.push(emptyPlate(`ge${i}`, clipRect(p), p.rel, "chip"));
}

/** The dim C3 plate of a slot with nothing in it (list cell or grid slot). */
export function emptyPlate(key: string, rect: UiRect, rel = ID, shape = "row") {
    return plate(key, "cellEmpty", rect, rel, { shape, edge: "var(--c-empty-edge)", body: "var(--c-empty-body)", shadow: 0 });
}

/**
 * A grid cell frame (the chart's portrait cells). With sheet layers, the biggest piece is the cell and the thin pieces left of it are its
 * connector stub; without, the clip rect is the cell.
 */
export function composeCellFrame(p, i, out) {
    const rel = p.rel, L = p.layers ?? [];
    const big = L.length ? L.reduce((a: { w: number; h: number; }, b: { w: number; h: number; }) => (b.w * b.h > a.w * a.h ? b : a), L[0]) : null;
    const cell = big ? applyRel({ x: p.x + big.x, y: p.y + big.y, w: big.w, h: big.h }, rel) : clipRect(p);
    out.push(plate(`gc${i}`, "gridFrame", cell, rel, { shape: "chip", shadow: 4 }));
    for (const [k, l] of L.entries()) if (l !== big) out.push(connector(`gc${i}.c${k}`, applyRel({ x: p.x + l.x, y: p.y + l.y, w: l.w, h: l.h }, rel), rel));
}

/** A connector line: a 2 native bar centred in the game's piece. */
export const connector = (key: string, r: UiRect, rel = ID) => rule(key, { x: r.x, y: r.y + r.h / 2 - rel.d, w: r.w, h: 2 * rel.d }, "var(--c-under)", rel, "under", "connector");

/** The cursor box of a grid: orange corner brackets (the palette row's colour cycle when the call carries one). */
export function composeCursorBox(p, i, out: { key: string; kind: string; part: string; layer: string; rect: UiRect; color: string; sx: 1; sy: 1; }[], pulse = null) {
    out.push(corners(`cb${i}`, clipRect(p), p.row && pulse ? pulse(p.row) : "var(--c-orange)", p.rel));
}

/** The parts lists.js composes; `composeLists` handles every one of them after the screen's own plates. */
export const LIST_PARTS = Object.freeze(["rowLine", "iconHl", "pageChip", "gridArt", "gridCell", "cellFrame", "connector", "cursorBox"]);

/**
 * Everything list-like on a screen, after its plates: item cells (rows not inside `skip` windows), icon highlights, the pager, page chips,
 * grid frames, empty slots, cursor boxes, connectors. `o.pulse` = the colour cycle for palette rows.
 */
export function composeLists(parts, runs, used, out, o: { skip?: UiRect[]; twoCols?: boolean; pulse?: (row: number) => string; } = {}) {
    const skip = o.skip ?? [];
    const inSkip = (p) => skip.some((s) => p.x >= s.x && p.x < s.x + s.w && p.y >= s.y && p.y < s.y + s.h);
    let pagerRuns = null;
    const pg = findPager(runs, used);
    if (pg) pagerRuns = pg;
    const lines = parts.filter((p) => p.part === "rowLine" && !inSkip(p));
    const ons = composeItemCells(lines, runs, used, out, { pagerY: pagerRuns?.y ?? null, twoCols: o.twoCols !== false });
    parts.forEach((p: { part: string; rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }> | undefined; }, i) => {
        if (p.part === "gridArt") composeArtFrame(p, i, out);
        else if (p.part === "gridCell") composeEmptyCell(p, i, out);
        else if (p.part === "cellFrame") composeCellFrame(p, i, out);
        else if (p.part === "connector") out.push(connector(`cn${i}`, clipRect(p), p.rel));
    });
    parts.forEach((p, i) => {
        if (p.part === "iconHl") composeIconHl(p, i, ons, out);
        else if (p.part === "cursorBox") composeCursorBox(p, i, out, o.pulse!);
        else if (p.part === "pageChip") composePageChip(p, i, runs, used, out);
    });
    composePager(runs, used, out, ID, parts.filter((p: { part: string; }) => p.part === "pagePlate").map(clipRect));
}
