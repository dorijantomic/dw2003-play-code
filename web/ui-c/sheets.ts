// web/ui-c/sheets.js -- look C kit T4: the info sheets (design C4 status sheet, C9 parts). Pure: the claimed draw-call parts and the text runs
// of a scope in, part descriptors in native units out. Every piece is built from base.js parts (plate, rowPlate, cursor, corners, chip,
// elementChip); nothing here draws its own HTML.
//   linedWindow     a window with row plates: rows at fixed tops (the game's empty lines) or one per text line; the cursor row orange
//   composeTabPanel the C4 "Digivolve" / "Equip" panel: a tab plate over a lined window that bleeds right
//   statChips       the stat and resistance columns: a chip per row (resistances get the C9 element colour cap), numbers right-anchored
//   expPlate        the solid orange EXP plate (status sheet EXP, fight report total)
//   tpPlate         the TP plate
//   composeFormSheet the See Digivolve sheet: name tab, skill tab, stat window, technique panel with the skill row
//   composeFormList  the See Digivolve forms list + the current-form choice plate
//   composeSheetParts every sheet part of a pause page (called by the sidebar composer after its backdrop)
//   composeReport   the fight report (cyan family): EXP badge, partner groups, form bars, message band
// Strings are the game's own runs; positions are the game's own draw positions (the `rel` matrix carries the folds and slides).
import { applyRel, dx } from "./geometry.js";
import { isCursorToken } from "./icons.js";
import { N, ID, textPart, plate, rule, rowPlate, cursor, corners, elementChip, ELEMENTS, stripes, TAB, tabPlate, tabTitle } from "./base.js";
import { restOfRuns } from "./generic.js";
import type { UiRect, UiSheetDef, UiTextOpts } from "./types.js";
import type { UiPart } from "./types.js";
interface RowRun extends SheetRun { face?: string; }

interface SheetRun {
  x: number;
  y: number;
  text?: string;
  right?: number;
  w?: number;
  h?: number;
}


/** C4 sizes in native units: the header window starts at 616 dp; tab 390 x 46 dp; the panel body 18 dp right / 9 below the tab; rows 40 dp right / 17 below. */
export const SHEET = Object.freeze({
    headerX: dx(616), tabW: TAB.w, tabH: TAB.h, bodyDx: N(18), bodyDy: 9, rowDx: N(40), rowDy: 17, pitch: 14, rowH: 12, push: 12, lead: 8,
});
const isNum = (t) => /^[0-9]+$/.test(String(t).trim());
const mid = (r: SheetRun) => r.y + 4.5;
/** The native rect of a claimed clip before its matrix (the game's draw position + the clip's pixel bounds). */
export const localRect = (p) => ({ x: p.x + (p.bx ?? 0), y: p.y + (p.by ?? 0), w: p.w ?? 0, h: p.h ?? 0 });
/** A rect that runs on to the right screen edge (the C panels bleed right). */
const toRight = (x: number, y, h: number, right = 320) => ({ x, y, w: Math.max(right, 320) - x, h });
const inside = (r: SheetRun, rc) => r.x >= rc.x - 1 && r.x < rc.x + rc.w && mid(r) >= rc.y && mid(r) < rc.y + rc.h;
const take = (runs: SheetRun[], used: Set<unknown>, rc: UiRect): SheetRun[] => runs.filter((r) => !used.has(r) && inside(r, rc));

// ------------------------------------------------------------------------------------------------ text helpers
const label = (key: string, m, rect, rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }>, o: UiTextOpts = {}) => textPart(key, "label", m.text, applyRel(rect, rel), o.sizeDp ?? 24, o.lineDp ?? 36, { color: o.color ?? m.face ?? null, rel, maxDp: o.maxDp ?? 0 });
const number = (key: string, m, right: number, y: number, h: number, rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }>, o: UiTextOpts = {}) => textPart(key, "number", m.text, applyRel({ x: right - N(o.wDp ?? 90), y, w: N(o.wDp ?? 90), h }, rel), o.sizeDp ?? 22, o.lineDp ?? Math.round(h * 3), { align: "right", color: o.color ?? m.face ?? "var(--c-ink)", rel, maxDp: o.wDp ?? 90 });

/** One text run placed in a row of `top` / `h` (native): numbers right-anchored at the game's right edge, the rest a label at the pen x. */
function rowText(key: string, m: RowRun, top: number, h: number, right: number, rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }>, ink: string | null, out: UiPart[]) {
    if (m.right != null && isNum(m.text)) out.push(number(`${key}.n${Math.round(m.right)}`, m, m.right, top, h, rel, { color: ink ?? m.face ?? "var(--c-ink)" }));
    else out.push(label(`${key}.t${Math.round(m.x)}`, m, { x: m.x, y: top, w: Math.max(8, right - m.x), h }, rel, { color: ink ?? m.face ?? null, maxDp: Math.max(40, (right - m.x) * 3 - 8) }));
}

// ------------------------------------------------------------------------------------------------ lined window
/** Row tops for the text lines inside `win` (one row per pen line; cursor tokens do not make a row). */
export function rowsFromRuns(runs, used: Set<unknown>, win: UiRect) {
    const ys = [];
    for (const r of take(runs, used, win)) if (!isCursorToken(r.text) && !ys.some((y) => Math.abs(y - r.y) <= 2)) ys.push(r.y);
    return ys.sort((a, b) => a - b).map((y) => y - 1);
}

/**
 * A window with row plates. `win` = the window rect (native, before `rel`); `tops` = the row tops; o = { rowX (row left edge), shape ("ch"),
 * edge, under(k) (under-edge colour of plain row k), push (how far the cursor row is pushed out) }. The row holding the game's cursor glyph
 * is orange with the chevron in the glyph's pose. Takes the runs it draws.
 */
export function linedWindow(key: string, win: UiRect, tops, runs, used: Set<unknown>, out, rel = ID, o: { shape?: string; edge?: string; rowH?: number; push?: number; rowX?: number; under?: (k: number) => string; } = {}) {
    out.push(plate(`${key}.plate`, "window", applyRel(win, rel), rel, { shape: o.shape ?? "ch", edge: o.edge }));
    const mine = take(runs, used, win);
    const right = win.x + win.w, h = o.rowH ?? SHEET.rowH, push = o.push ?? SHEET.push;
    const rowX = o.rowX ?? win.x + SHEET.lead;
    tops.forEach((top: number, k: number) => {
        const inRow = mine.filter((m) => mid(m) >= top - 1 && mid(m) < top + h + 1);
        const cur = inRow.find((m) => isCursorToken(m.text)) ?? null, on = !!cur;
        const x = on ? rowX - push : rowX;
        out.push(rowPlate(`${key}.row${k}`, applyRel({ x, y: top, w: right - x, h }, rel), on, rel, "row", o.under?.(k) ?? "var(--c-under)"));
        // the chevron 9 in from the row's left end, but never on the text (a short push, the See Digivolve choice plate): 8 left of it
        const tx = inRow.filter((m) => !isCursorToken(m.text)).reduce((a: number, m: { x: number; }) => Math.min(a, m.x), Infinity);
        if (cur) { const ch = cursor(`${key}.cursor`, cur.text, Math.min(x + 9, tx - 8), top + h / 2, rel); if (ch) out.push(ch); }
        for (const m of inRow) {
            used.add(m);
            if (!isCursorToken(m.text)) rowText(`${key}.row${k}`, m, top, h, right, rel, on ? "var(--c-orange-ink)" : null, out);
        }
    });
}

/** A lined window whose rows are its own text lines (row x = 8 native left of the leftmost text). */
export function textWindow(key: string, win: UiRect, runs, used: Set<unknown>, out, rel = ID, o: { shape?: string; edge?: string; rowH?: number; push?: number; rowX?: number; under?: (k: number) => string; } = {}) {
    const tops = rowsFromRuns(runs, used, win);
    const texts = take(runs, used, win).filter((m) => !isCursorToken(m.text));
    const x0 = texts.length ? Math.min(...texts.map((m) => m.x)) : win.x + 16;
    linedWindow(key, win, tops, runs, used, out, rel, { rowX: Math.max(win.x + 2, x0 - SHEET.lead), ...o });
}

// ------------------------------------------------------------------------------------------------ tab panel
/** The number of rows a tab panel of native height `h` holds (C4: rows from 17 below the tab top, 14 apart, 4 native of frame below). */
export const panelRows = (h: number) => Math.max(0, Math.floor((h - 21) / SHEET.pitch));

/** The C4 tab panel ("Digivolve", "Equip"): tab plate (C4 #2c2c8a) with the game's title, the lined body window bleeding right. */
export function composeTabPanel(p, i, runs, used: Set<unknown>, out) {
    const rel = p.rel, b = localRect(p), k = `tp${i}`;
    const tab = { x: b.x, y: b.y, w: SHEET.tabW, h: SHEET.tabH };
    const titles = take(runs, used, tab).filter((m) => !isCursorToken(m.text) && mid(m) < b.y + SHEET.bodyDy + 6);
    titles.forEach((m) => used.add(m));
    const body = toRight(b.x + SHEET.bodyDx, b.y + SHEET.bodyDy, b.h - SHEET.bodyDy, b.x + b.w);
    const tops = Array.from({ length: panelRows(b.h) }, (_, j) => b.y + SHEET.rowDy + j * SHEET.pitch);
    linedWindow(k, body, tops, runs, used, out, rel, { rowX: b.x + SHEET.rowDx });
    out.push(tabPlate(`${k}.tab`, applyRel(tab, rel), rel));
    titles.forEach((m, j) => out.push(tabTitle(`${k}.title${j}`, m, tab, rel)));
}

// ------------------------------------------------------------------------------------------------ chips, EXP, TP
/**
 * The stat / resistance columns inside `win`: the number runs grouped by their right edge; one chip per number (the game's icon sits on
 * the chip as art), the second column of seven rows gets the element colour caps (fire .. dark, top to bottom).
 */
export function statChips(key: string, win: UiRect, runs, used: Set<unknown>, out, rel = ID) {
    const nums = take(runs, used, win).filter((m) => m.right != null && isNum(m.text));
    const cols = [];
    for (const m of nums) { const c = cols.find((c) => Math.abs(c.right - m.right) <= 2); if (c) c.runs.push(m); else cols.push({ right: m.right, runs: [m] }); }
    cols.sort((a, b) => a.right - b.right);
    cols.forEach((c, ci) => {
        c.runs.sort((a, b) => a.y - b.y);
        const elements = ci === 1 && c.runs.length === ELEMENTS.length;
        c.runs.forEach((m, j) => {
            used.add(m);
            const top = m.y - 2, rc = { x: c.right - 37, y: top, w: 40, h: 13 };
            for (const d of elementChip(`${key}.c${ci}.${j}`, applyRel(rc, rel), elements ? ELEMENTS[j] : null, rel)) out.push(d);
            out.push(number(`${key}.c${ci}.${j}.n`, m, c.right, top + 0.5, 12, rel, { sizeDp: 24, lineDp: 36, color: "var(--c-ink)", wDp: 70 }));
        });
    });
}

/** The solid orange EXP plate (C4): slanted right end, the game's number right-anchored and its label in dark ink. */
export function expPlate(p, i, runs, used: Set<unknown>, out, o: { edge?: string; } = {}) {
    const rel = p.rel, r = localRect(p), k = `exp${i}`;
    out.push(plate(`${k}.plate`, "expPlate", applyRel(r, rel), rel, { shape: "sr", edge: o.edge ?? "var(--c-orange)", body: null }));
    const lineN = N(40), top = r.y + (r.h - lineN) / 2;
    for (const m of take(runs, used, r)) {
        used.add(m);
        if (m.right != null && isNum(m.text)) out.push(number(`${k}.n`, m, m.right, top, lineN, rel, { sizeDp: 30, lineDp: 40, color: "var(--c-orange-ink)", wDp: 200 }));
        else out.push(label(`${k}.l${Math.round(m.x)}`, m, { x: m.x, y: top + N(4), w: N(80), h: N(32) }, rel, { sizeDp: 22, lineDp: 32, color: "var(--c-orange-ink)" }));
    }
}

/** The TP plate's own runs: its number and the label on the same pen line left of it (not the footer lines drawn over the same strip). */
export function tpRuns(runs, used: Set<unknown>, r: UiRect) {
    const mine = take(runs, used, r), nums = mine.filter((m) => m.right != null && isNum(m.text));
    return mine.filter((m: { y: number; x: number; }) => nums.includes(m) || nums.some((n: { y: number; x: number; }) => Math.abs(m.y - n.y) <= 1 && m.x < n.x));
}

/** The TP plate (C4): slanted right end, "TP" dim, the number amber and big, right-anchored where the game ends it. */
export function tpPlate(p, i, runs, used: Set<unknown>, out) {
    const rel = p.rel, r = localRect(p), k = `tp${i}p`;
    out.push(plate(`${k}.plate`, "tpPlate", applyRel(r, rel), rel, { shape: "sr" }));
    const lineN = N(44), top = r.y + (r.h - lineN) / 2;
    for (const m of take(runs, used, r)) {
        used.add(m);
        if (m.right != null && isNum(m.text)) out.push(number(`${k}.n`, m, m.right, top, lineN, rel, { sizeDp: 34, lineDp: 44, color: "var(--c-num)", wDp: 120 }));
        else out.push(label(`${k}.l`, m, { x: m.x, y: top + N(3), w: N(60), h: N(38) }, rel, { sizeDp: 26, lineDp: 38, color: "var(--c-dim-label)" }));
    }
}

// ------------------------------------------------------------------------------------------------ status sheet windows
/** The C4 header window ("See Digivolve" / "See Equipment"): starts at 616 dp (the card covers the clip's left part), rows from its text. */
export function composeHeaderWin(p: { rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }> | undefined; }, i, runs, used: Set<unknown>, out) {
    const b = localRect(p), x = Math.max(b.x, SHEET.headerX);
    textWindow(`hw${i}`, toRight(x, b.y, b.h - 2, b.x + b.w), runs, used, out, p.rel);
}

/** The stat window (C4): plate open to the left with the bottom-right chamfer, the stat and resistance chips. */
export function composeStatWin(p, i, runs, used: Set<unknown>, out) {
    const rel = p.rel, b = localRect(p);
    out.push(plate(`sw${i}.plate`, "statWin", applyRel(b, rel), rel, { shape: "rb" }));
    statChips(`sw${i}`, b, runs, used, out, rel);
}

/**
 * See Digivolve, the form sheet (one clip): name tab (0..124 x 0..21), skill tab (154.. x 0..21), stat window (0..88 x 22..130),
 * technique panel (88.. x 22..130) with five technique rows 14 apart from 37 and the skill row at 107 (orange under-edge).
 */
export const FORM_SHEET = Object.freeze({ nameW: 124, tabH: 21, skillX: 154, statW: 88, top: 22, techRowX: 110, techRow0: 37, rows: 5, skillRow: 107 });
export function composeFormSheet(p, i, runs, used: Set<unknown>, out) {
    const rel = p.rel, b = localRect(p), F = FORM_SHEET, k = `fs${i}`, bottom = b.y + b.h - 2;
    // the two windows first (their tabs sit over their top edge)
    const statWin = { x: b.x, y: b.y + F.top, w: F.statW, h: bottom - (b.y + F.top) };
    out.push(plate(`${k}.stats`, "statWin", applyRel(statWin, rel), rel, { shape: "rb" }));
    statChips(`${k}.st`, statWin, runs, used, out, rel);
    const tech = toRight(b.x + F.statW, b.y + F.top, bottom - (b.y + F.top), b.x + b.w);
    const tops = [...Array.from({ length: F.rows }, (_, j) => b.y + F.techRow0 + j * SHEET.pitch), b.y + F.skillRow];
    linedWindow(`${k}.tech`, tech, tops, runs, used, out, rel, { rowX: b.x + F.techRowX, under: (j) => (j === F.rows ? "var(--c-orange)" : "var(--c-under)") });
    // name tab and skill tab
    const nameTab = { x: b.x, y: b.y, w: F.nameW, h: F.tabH }, skillTab = toRight(b.x + F.skillX, b.y, F.tabH, b.x + b.w);
    out.push(plate(`${k}.name`, "nameTab", applyRel(nameTab, rel), rel, { shape: "sr" }));
    out.push(plate(`${k}.skill`, "skillTab", applyRel(skillTab, rel), rel, { shape: "sl" }));
    for (const [rc, tag] of [[nameTab, "name"], [skillTab, "skill"]] as [UiRect, string][]) {
        for (const m of take(runs, used, rc)) {
            used.add(m);
            if (isCursorToken(m.text)) continue;
            const top = rc.y + (rc.h - N(36)) / 2;
            if (tag === "skill" && m.right != null) out.push(number(`${k}.${tag}.n`, m, m.right, top, N(36), rel, { sizeDp: 24, lineDp: 36, color: "var(--c-num)" }));
            else out.push(label(`${k}.${tag}.t${Math.round(m.x)}`, m, { x: m.x, y: top, w: rc.x + rc.w - m.x, h: N(36) }, rel, { sizeDp: tag === "name" ? 26 : 22, color: tag === "skill" ? "var(--c-dim-label)" : null, maxDp: Math.round((rc.x + rc.w - m.x) * 3 - 30) }));
        }
    }
}

/** See Digivolve, the forms list (bleeds right, three rows from 8 below its top) and the current-form choice plate left of it (-94..2 x 28..56). */
export const FORM_LIST = Object.freeze({ rows: 3, row0: 8, rowX: 20, choiceX: -94, choiceY: 28, choiceW: 96, choiceH: 28 });
export function composeFormList(p, i, runs, used: Set<unknown>, out) {
    const rel = p.rel, F = FORM_LIST, k = `fl${i}`;
    const list = toRight(p.x, p.y, 54);
    linedWindow(`${k}.list`, list, Array.from({ length: F.rows }, (_, j) => p.y + F.row0 + j * SHEET.pitch), runs, used, out, rel, { rowX: p.x + F.rowX });
    const choice = { x: p.x + F.choiceX, y: p.y + F.choiceY, w: F.choiceW, h: F.choiceH };
    textWindow(`${k}.choice`, choice, runs, used, out, rel, { push: 6 });
}

// ------------------------------------------------------------------------------------------------ the pause sheet pages
/** Parts this file composes on a pause page. */
export const SHEET_PARTS = Object.freeze(["expPlate", "tpPlate", "statWin", "tabPanel", "headerWin", "slotWin", "formList", "formSheet"]);

/**
 * Every sheet part of a pause page, in draw order. The TP plate is left out (and its text with it) when the footer band overlaps it
 * (the equipment item list draws both in the same place; the band's own text owns that strip).
 */
export function composeSheetParts(parts, runs, used: Set<unknown>, out) {
    const foot = parts.find((p: { part: string; }) => p.part === "footer");
    parts.forEach((p, i) => {
        switch (p.part) {
            case "expPlate": expPlate(p, i, runs, used, out); break;
            case "tpPlate": {
                const r = localRect(p);
                if (foot && foot.y + (foot.by ?? 0) < r.y + r.h && foot.y + (foot.by ?? 0) + (foot.h ?? 0) > r.y) { tpRuns(runs, used, r).forEach((m) => used.add(m)); break; }
                tpPlate(p, i, runs, used, out); break;
            }
            case "statWin": composeStatWin(p, i, runs, used, out); break;
            case "tabPanel": composeTabPanel(p, i, runs, used, out); break;
            case "headerWin": composeHeaderWin(p, i, runs, used, out); break;
            case "slotWin": textWindow(`sl${i}`, localRect(p), runs, used, out, p.rel); break;
            case "formList": composeFormList(p, i, runs, used, out); break;
            case "formSheet": composeFormSheet(p, i, runs, used, out); break;
            default: break;
        }
    });
}

// ------------------------------------------------------------------------------------------------ fight report
/** Report sizes (native, relative to the group plate): portrait frame 44 x 43, name tab 38..106 x 0..15, LV tab 41..80 x 16..27. */
export const REPORT = Object.freeze({ portraitW: 39, nameX: 38, nameW: 68, nameH: 15, lvX: 41, lvY: 16, lvW: 40, lvH: 12, barH: 14, barLv: 120 });
const CYAN = "var(--c-cyan)";

/** One partner group: card plate, portrait frame, name tab, LV tab (orange), EXP in amber. */
export function composeReportCard(p, i, runs, used: Set<unknown>, out) {
    const rel = p.rel, b = localRect(p), R = REPORT, k = `rc${i}`;
    out.push(plate(`${k}.plate`, "card", applyRel(b, rel), rel, { shape: "sr", edge: CYAN }));
    out.push(plate(`${k}.portrait`, "portrait", applyRel({ x: b.x, y: b.y, w: R.portraitW, h: b.h }, rel), rel, { shape: "ch", edge: CYAN, shadow: 0 }));
    const name = { x: b.x + R.nameX, y: b.y, w: R.nameW, h: R.nameH }, lv = { x: b.x + R.lvX, y: b.y + R.lvY, w: R.lvW, h: R.lvH };
    out.push(plate(`${k}.name`, "cardName", applyRel(name, rel), rel, { shape: "row", underEdge: "e1", edge: CYAN, body: "var(--c-name-body)", shadow: 4 }));
    out.push(plate(`${k}.lvtab`, "cardLv", applyRel(lv, rel), rel, { shape: "tab", edge: "var(--c-orange)", layer: "under", shadow: 0 }));
    for (const m of take(runs, used, b)) {
        used.add(m);
        if (isCursorToken(m.text)) continue;
        if (inside(m, name)) out.push(label(`${k}.nm`, m, { x: m.x, y: name.y + (name.h - N(36)) / 2, w: name.x + name.w - m.x, h: N(36) }, rel, { sizeDp: 24, maxDp: Math.round((name.x + name.w - m.x) * 3) }));
        else if (inside(m, lv)) {
            if (m.right != null) out.push(number(`${k}.lv.n`, m, m.right, lv.y, lv.h, rel, { sizeDp: 22, lineDp: 36, color: "var(--c-orange-ink)", wDp: 60 }));
            else out.push(label(`${k}.lv.t`, m, { x: m.x, y: lv.y, w: N(40), h: lv.h }, rel, { sizeDp: 18, lineDp: 36, color: "var(--c-orange-ink)" }));
        } else if (m.right != null && isNum(m.text)) out.push(number(`${k}.n${Math.round(m.right)}`, m, m.right, m.y - 1.5, 12, rel, { sizeDp: 26, lineDp: 36, color: "var(--c-num)" }));
        else out.push(label(`${k}.t${Math.round(m.x)}.${Math.round(m.y)}`, m, { x: m.x, y: m.y - 1.5, w: N(80), h: 12 }, rel, { sizeDp: 20, lineDp: 36, color: "var(--c-orange)" }));
    }
}

/** A form bar: slanted plate, the form name, the form level right-anchored behind a divider. */
export function composeFormBar(p, i, runs, used: Set<unknown>, out) {
    const rel = p.rel, b = localRect(p), R = REPORT, k = `fb${i}`, bar = { x: b.x, y: b.y, w: b.w, h: R.barH };
    out.push(plate(`${k}.plate`, "formBar", applyRel(bar, rel), rel, { shape: "sr", edge: CYAN, shadow: 4 }));
    out.push(rule(`${k}.div`, applyRel({ x: b.x + R.barLv, y: b.y + 1, w: 1, h: R.barH - 2 }, rel), CYAN, rel));
    for (const m of take(runs, used, { x: b.x, y: b.y - 1, w: b.w, h: R.barH + 1 })) {
        used.add(m);
        rowText(k, m, b.y + 1, R.barH - 2, b.x + R.barLv, rel, m.right != null ? "var(--c-num)" : null, out);
    }
}

/** The report highlight (the partner the page is about): focus corners round the portrait piece, an orange line under the name tab. */
export function composeReportHl(p, i, out, pulse = null) {
    const rel = p.rel, L = p.layers ?? [];
    const big = L.length ? L.reduce((a: { w: number; h: number; }, c: { w: number; h: number; }) => (c.w * c.h > a.w * a.h ? c : a), L[0]) : { x: 0, y: 0, w: p.w, h: p.h };
    out.push(corners(`hl${i}`, applyRel({ x: p.x + big.x, y: p.y + big.y, w: big.w, h: big.h }, rel), pulse ? pulse(p.row) : "var(--c-orange)", rel));
    out.push(rule(`hl${i}.name`, applyRel({ x: p.x + REPORT.nameX, y: p.y + REPORT.nameH - 1, w: REPORT.nameW, h: 1 }, rel), "var(--c-orange)", rel, "over"));
}

/** The message band: a chamfered window, the game's lines in body text. */
export function composeMsgBand(p, i, runs, used: Set<unknown>, out) {
    const rel = p.rel, b = localRect(p), k = `mb${i}`;
    out.push(plate(`${k}.plate`, "msgBand", applyRel(b, rel), rel, { shape: "ch", edge: CYAN }));
    for (const m of take(runs, used, b).sort((a: { y: number; }, c: { y: number; }) => a.y - c.y)) {
        used.add(m);
        if (isCursorToken(m.text)) continue;
        out.push(textPart(`${k}.t${Math.round(m.y)}`, "body", m.text, applyRel({ x: m.x, y: m.y + 4.5 - N(36) / 2, w: b.x + b.w - m.x - 4, h: N(36) }, rel), 26, 36, { rel, maxDp: Math.round((b.x + b.w - m.x - 4) * 3) }));
    }
}

/**
 * The "Data Burst" victory: the native report's whole screen restyled as one `vic` part. The page is told by the game's own message band text
 * ("EXP gained:", "BIT gained:", "Item gained:", ...); the rings read the battle's own progress records (cfg.view, read-only, from
 * fightreport-translated.js): old / new fraction of the level, the EXP gained, LEVEL UP, the learned techs and digivolves. Pages, keys and timing stay the game's.
 */
export function composeVictory({ parts, runs, stage }, cfg) {
    const used = new Set(), v = cfg.view ?? {}, S = stage ?? { x0: 0, y0: 0, x1: 320, y1: 240 };
    const band = parts.find((p: { part: string; }) => p.part === "msgBand");
    const lines = (band ? take(runs, used, localRect(band)) : []).filter((m) => !isCursorToken(m.text)).sort((a: { y: number; x: number; }, b: { y: number; x: number; }) => a.y - b.y || a.x - b.x).map((m) => String(m.text).trim()).filter(Boolean);
    runs.forEach((m) => used.add(m));                 // everything else of the native page is replaced by the part
    const head = lines[0] ?? "", rest = lines.slice(1).join(" ").trim();
    const num = (t: string) => Number(String(t).replace(/[^0-9]/g, "")) || 0;
    const d = { key: "vic", kind: "vic", part: "vic", layer: "over", rect: { x: S.x0, y: S.y0, w: S.x1 - S.x0, h: S.y1 - S.y0 }, sx: 1, sy: 1, page: "text", big: lines.join(" "), small: "" } as UiSheetDef;
    if (/exp/i.test(head) && (v.partners ?? []).length) {
        const rows = v.rows ?? [];
        d.page = "exp";
        d.rings = (v.partners ?? []).map((p, i: string | number) => {
            const pr = (v.progress ?? []).find((q) => q.index === p.pos) ?? null, up = !!(pr?.levelUp || rows[i]?.levelUp);
            const names = (xs) => (Array.isArray(xs) ? xs : []).map((t) => (typeof t === "string" ? t : (t?.name ?? ""))).filter(Boolean);
            return { name: String(p.name ?? ""), lv: pr?.oldLevel ?? p.level ?? 1, lvTo: pr?.newLevel ?? p.level ?? 1, a: pr?.ringA ?? 0, b: pr?.ringB ?? 0, gain: rows[i]?.target > 0 ? Math.max(0, rows[i].target - (p.preExp ?? 0)) : (pr?.xp ?? 0), up,
                learned: names(pr?.learnedTechs), digi: names(pr?.unlocked) };
        });
        d.up = d.rings!.some((r) => r.up);
    } else if (/bit/i.test(head)) {
        d.page = "bit"; d.num = num(rest || head);
        const dr = v.reward?.droppedItem;
        if (dr?.name) d.item = { name: String(dr.name), qty: "" };
    } else if (/item/i.test(head)) {
        d.page = "item"; d.big = rest || head; d.small = "";
    } else {
        d.small = lines.length > 1 ? head : ""; d.big = lines.length > 1 ? rest : head;
        // a learned tech / digivolve page: which partner learned it (the progress records), so the page can show that partner's ring
        const key = String(d.big).trim().toLowerCase(), nm = (xs) => (Array.isArray(xs) ? xs : []).map((t) => String(typeof t === "string" ? t : (t?.name ?? "")).trim().toLowerCase());
        const found = (v.partners ?? []).map((p) => { const pr = (v.progress ?? []).find((q) => q.index === p.pos) ?? null; return { p, pr, tech: nm(pr?.learnedTechs).includes(key), digi: nm(pr?.unlocked).includes(key) }; }).find((h) => h.tech || h.digi);
        if (found) d.learn = { kind: found.digi ? "digi" : "tech", partner: String(found.p.name ?? ""), lv: found.pr?.newLevel ?? found.p.level ?? 1 };
        else if (d.small && /digivolv/i.test(d.small)) d.learn = { kind: "digi", partner: "", lv: 0 };
        else if (d.small && /learn|tech/i.test(d.small)) d.learn = { kind: "tech", partner: "", lv: 0 };
    }
    return [d];
}

/** The fight report (STFRPT, cyan family). `pulse(row)` = the highlight colour cycle. */
export function composeReport({ parts, runs, stage }, cfg: { view?: UiRect; pulse?: (row: number) => string; } = {}) {
    if (cfg.view) return composeVictory({ parts, runs, stage }, cfg);
    const out = [], used = new Set();
    parts.forEach((p, i) => {
        switch (p.part) {
            case "backdrop": out.push(stripes(p.x)); break;
            case "expPlate": expPlate(p, i, runs, used, out); break;
            case "reportCard": composeReportCard(p, i, runs, used, out); break;
            case "formBar": composeFormBar(p, i, runs, used, out); break;
            case "msgBand": composeMsgBand(p, i, runs, used, out); break;
            default: break;
        }
    });
    parts.forEach((p: { part: string; }, i) => { if (p.part === "reportHl") composeReportHl(p, i, out, cfg.pulse!); });
    restOfRuns(runs, used, ID, out, "rp");
    return out;
}
