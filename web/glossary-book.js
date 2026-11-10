// web/glossary-book.js -- the GLOSSARY book, DIGIMON section: numbered list on the left, the turning model and the card on the
// right. Rows: web/glossary-digimon.js. Cursor and pages: web/glossary-model.js. Model: web/glossary-stage.js (Task 4).
// Keys (web/ui-kit-input.js words): up / down one species, left / right ten (page 2: left / right one species, up / down scroll the
// page), L1 / R1 page 1 / page 2, Back leaves. SECTIONS (Q / E = L1 / R1): the pages flow into the sections. On DIGIMON R1 goes
// page 1 -> page 2 as before; where there is no page 2 to go to (a species not yet defeated) or on page 2, R1 goes on to ITEMS;
// on ITEMS L1 comes back to DIGIMON (on the page left). PLACES is not built: its tab stays dim and nothing switches to it.
// ITEMS (web/glossary-items.js): left / right = previous / next item, up / down scroll the "where" lines.
//
// Room (measured with the game font, web/assets/ui/uifont.json): the counts line "Met 240/240  Beaten 240" is 149 px, so the list
// panel is 4 columns (160 px) and the right pane 4 columns (164 to 324, bleeding past 320 like the pause list window); every text
// is fitted or wrapped by measured width inside its own window (web/text-fit.js), and tests/glossary-book.test.js checks that no
// drawn text leaves its window or touches another.
import { WORD } from "./ui-kit-input.js";
import { SFX_CLOSE, SFX_OPEN, drawBar, drawFooter, drawHeader, drawPanel, listRowY, panelPixelHeight, withFold } from "./ui-kit.js";
import { drawCursor, drawIconGlyph, drawText, textWidth } from "./uifont.js";
import { BAND_TEXT_W, fitByWidth, wrapByWidth, wrapToLines } from "./text-fit.js";
import { headerCounts, listRows, logSnapshot, pageOne, pageTwoLines, partnerOf, speciesState } from "./glossary-digimon.js";
import { VISIBLE, createGlossaryModel } from "./glossary-model.js";
import { MAX_DESC_LINES, createItemsModel, itemPage, whereVisible } from "./glossary-items.js";
import { drawItemIcon } from "./itemicons.js";

const rect = (x, y, cols, bands) => ({ x, y, w: cols * 40, h: panelPixelHeight(bands), cols, bands });
export const GLOSSARY_LAYOUT = Object.freeze({
    list: rect(0, 40, 4, 7),            // 160 x 140: the counts line, then 8 species rows
    model: rect(164, 40, 4, 3),         // 160 x 84 (to y 124)
    card: rect(164, 124, 4, 2),         // 160 x 70 (to y 194): four text rows
    pane: rect(164, 40, 4, 7),          // page 2: the strength pane takes the model panel and the card place, 160 x 140
    countsX: 6, countsRight: 154,
    cursorX: 8, numberRight: 40, nameX: 46, nameRight: 138, arrowX: 142,
    cardX: 172, cardRows: [133, 147, 161, 175], cardRight: 316,
    image: { x: 172, y: 46, w: 144, h: 72 },       // inside the model panel, away from its frame
    hintRight: 300,                                  // footer line 2: "R1 strength" ends here
});
// Page 2 (the strength pane in the model panel's place, 164 to 324, 140 px tall: nine rows at listRowY(0..8)). Measured with the game
// font: "HP" and "MP" are 14 px, an icon is 12 px, a four-digit orange number is 28 px (the largest real value is 5400), so the bar
// runs from 192 to 274 and the number ends at 306; the scroll arrow column is 309 to 318, so no row ever touches an arrow.
export const PAGE2 = Object.freeze({
    visible: 9, labelX: 172, barX: 192, barW: 82, numberRight: 306, right: 306, arrowX: 309, gap: 6,
    iconW: 12, iconPitch: 14, barH: 6, hint: "L1 Info", hintRight: 300,
});
const ELEMENT_LABELS = new Set(["Resists", "Weak to"]);
const ICON_ELEMENTS = new Set(["fire", "water", "ice", "wind", "thunder", "machine", "dark"]);
const iconsWidth = (n) => n * PAGE2.iconPitch - (PAGE2.iconPitch - PAGE2.iconW);

/**
 * Lines (glossary-digimon pageTwoLines) to drawable rows. A bar is one row (a long label is split into the bar label and a note
 * row); a head is one row; a labelled text line stays on one row when it fits beside its label, else the label has its own row and
 * the text follows wrapped over as many rows as it needs (the pane scrolls; nothing is cut). Resists / Weak to show element icons when they fit beside the label.
 * VisualRow = { kind: "bar" | "head" | "text" | "note", label, icon, value, max, text, textX, icons? }.
 */
export function page2Rows(lines, widthOf) {
    const rows = [];
    const full = PAGE2.right - PAGE2.labelX;
    for (const l of lines) {
        const label = l.label ?? "";
        if (l.kind === "head") { rows.push({ kind: "head", label, icon: null, text: "" }); continue; }
        if (l.kind === "bar") {
            let shown = label, note = "";
            if (!l.icon && widthOf(label) > PAGE2.barX - PAGE2.labelX - 4) {
                const k = label.indexOf(" (");
                if (k > 0) { shown = label.slice(0, k); note = label.slice(k + 1); }
                else shown = fitByWidth(label, widthOf, PAGE2.barX - PAGE2.labelX - 4);
            }
            rows.push({ kind: "bar", label: shown, icon: l.icon ?? null, value: l.value, max: l.max, text: l.text ?? "" });
            if (note) rows.push({ kind: "note", label: "", icon: null, text: note, textX: PAGE2.labelX });
            continue;
        }
        const text = String(l.text ?? "");
        const textX = label ? PAGE2.labelX + widthOf(label) + PAGE2.gap : PAGE2.labelX;
        const names = ELEMENT_LABELS.has(label) && text !== "-" ? text.split(", ").map((n) => n.toLowerCase()) : null;
        if (names && names.every((n) => ICON_ELEMENTS.has(n)) && textX + iconsWidth(names.length) <= PAGE2.right) {
            rows.push({ kind: "text", label, icon: null, text, textX, icons: names });
        } else if (widthOf(text) <= PAGE2.right - textX) {
            rows.push({ kind: "text", label, icon: null, text, textX });
        } else {
            if (label) rows.push({ kind: "text", label, icon: null, text: "", textX: PAGE2.labelX });
            for (const t of wrapByWidth(text, widthOf, full)) rows.push({ kind: "text", label: "", icon: null, text: t, textX: PAGE2.labelX });
        }
    }
    return rows;
}

/** Bar length for one page: the usual width, shortened (the same for every bar) so the widest range text (orange digits, font kind 3) still fits beside it. */
export function pageBarWidth(rows, widthOf) {
    let widest = 0;
    for (const r of rows) if (r.kind === "bar" && r.text) widest = Math.max(widest, widthOf(r.text, 3));
    return widest ? Math.max(24, Math.min(PAGE2.barW, PAGE2.numberRight - widest - 6 - PAGE2.barX)) : PAGE2.barW;
}

const TABS = ["DIGIMON", "ITEMS", "PLACES"];
const HINT = "R1 Strength";

/** The counts line fitted to `maxW` px: the double space first gives way to one, and only then is the text cut. */
export function fitCounts(text, widthOf, maxW) {
    if (widthOf(text) <= maxW) return text;
    const tight = text.replace(/ {2,}/g, " ");
    return widthOf(tight) <= maxW ? tight : fitByWidth(tight, widthOf, maxW);
}

/** Card text lines for page 1: title, the level line (when there is one), then the record wrapped over the rows left. */
export function cardLines({ title, row1, record }, widthOf, maxW, rows) {
    const out = [fitByWidth(title, widthOf, maxW)];
    if (row1) out.push(fitByWidth(row1, widthOf, maxW));
    const left = rows - out.length;
    if (record && left > 0) out.push(...wrapToLines(record, widthOf, maxW, left));
    return out.slice(0, rows);
}

// ITEMS page: one panel, nine rows at listRowY(0..8): name row, "What it does", its lines, "Where to get it", the where lines.
export const ITEMS_LAYOUT = Object.freeze({
    panel: rect(0, 40, 8, 7),                       // 320 x 140
    iconX: 8, nameX: 28, nameRight: 250, countRight: 300, textX: 8, textRight: 300, rightEdge: 300, arrowX: 309,
    hint: "L1 Digimon", hintRight: 300,
});
const SECTION_DIGIMON = 0, SECTION_ITEMS = 1;

/**
 * getItems (optional): () => null while the tables load, else { data, info(id) -> {name, desc}, ids() -> known item ids, held(id) }.
 * Without it the book has no ITEMS section and R1 on page 2 does nothing, as before.
 */
export function createGlossaryBook({ sfx = null, getSpecies, getLog, getPartners = () => [], stage = null, getItems = null }) {
    let model = null, loadedFor = null, first = true;
    let section = SECTION_DIGIMON;
    const itemsModel = createItemsModel();
    const data = () => {
        const d = getSpecies();
        if (d && loadedFor !== d) { loadedFor = d; model = createGlossaryModel({ count: d.species.length }); first = true; }
        return d;
    };
    const current = (d, log = getLog()) => {
        const sp = d.species[model.index()];
        const partner = partnerOf(sp, getPartners());
        return { sp, partner, lead: getPartners()[0] ?? null, state: speciesState(sp, log, partner) };
    };
    // the scroll cursor stops where the last ROW (not line: long lines wrap) sits on the last pane row
    const lineCount = (d) => {
        const c = current(d);
        const rows = page2Rows(pageTwoLines(c.sp, c.state, c.partner, d.world, d.maxima, d.wildMaxima, c.lead), (s) => textWidth(s)).length;
        return Math.max(1, rows - PAGE2.visible + 1);
    };
    const cue = (ok) => { if (ok) sfx?.play?.("system02"); return ok; };
    // ---- ITEMS section
    const plain = (s) => textWidth(s);
    const descOf = (text) => (text ? wrapToLines(text, plain, ITEMS_LAYOUT.textRight - ITEMS_LAYOUT.textX, MAX_DESC_LINES) : []);
    const itemIds = (it) => { try { return it.ids(); } catch { return []; } };
    function actItems(buttons) {
        if (buttons.has(WORD.prev)) { section = SECTION_DIGIMON; sfx?.playPacked?.(SFX_CLOSE); const d = data(); if (d && model) show(d); return; }
        const it = getItems?.();
        if (!it || !it.data) return;
        const ids = itemIds(it);
        if (buttons.has("left")) cue(itemsModel.move(ids, -1));
        else if (buttons.has("right")) cue(itemsModel.move(ids, 1));
        else if (buttons.has("up") || buttons.has("down")) {
            const id = itemsModel.current(ids);
            if (id == null) return;
            const page = itemPage(it.data, id, { info: it.info, held: 0, log: logSnapshot(getLog()) });
            cue(itemsModel.scroll(buttons.has("up") ? -1 : 1, page.where.length, whereVisible(descOf(page.does).length)));
        }
    }
    function drawItems(ctx, pl, pf, ticks) {
        const I = ITEMS_LAYOUT;
        withFold(ctx, pl, I.panel.x, I.panel.y + I.panel.h / 2, "x", () => drawPanel(ctx, I.panel.x, I.panel.y, I.panel.cols, I.panel.bands));
        const hint = () => { if (pf >= 1) drawText(ctx, I.hint, I.hintRight, 212, { kind: 3, clut: 2, alignRight: true }); };
        const it = getItems?.() ?? null;
        if (pl < 1) { drawFooter(ctx, pf, "", ""); return; }
        if (!it || !it.data) { drawText(ctx, "Loading...", I.textX, listRowY(0)); drawFooter(ctx, pf, "", ""); return; }
        const ids = itemIds(it), id = itemsModel.current(ids);
        if (id == null) { drawText(ctx, "No items found yet.", I.textX, listRowY(0)); drawFooter(ctx, pf, "", ""); hint(); return; }
        const page = itemPage(it.data, id, { info: it.info, held: it.held?.(id) ?? 0, log: logSnapshot(getLog()) });
        drawItemIcon(ctx, id, I.iconX, listRowY(0) - 1);
        const count = `x ${page.count}`;
        drawText(ctx, count, I.countRight, listRowY(0), { alignRight: true });
        drawText(ctx, fitByWidth(page.name, plain, Math.min(I.nameRight, I.countRight - textWidth(count) - 8) - I.nameX), I.nameX, listRowY(0));
        let row = 1;
        const desc = descOf(page.does);
        if (desc.length) {
            drawText(ctx, "What it does", I.textX, listRowY(row++), { clut: 7 });
            for (const t of desc) drawText(ctx, t, I.textX, listRowY(row++));
        }
        drawText(ctx, "Where to get it", I.textX, listRowY(row++), { clut: 7 });
        const room = whereVisible(desc.length);
        const top = Math.min(itemsModel.line(), Math.max(0, page.where.length - room));
        if (!page.where.length) drawText(ctx, "Nothing found out yet.", I.textX, listRowY(row));
        page.where.slice(top, top + room).forEach((l, i) => {
            const y = listRowY(row + i);
            const rightW = l.right ? textWidth(l.right, 3) + 8 : 0;
            drawText(ctx, fitByWidth(l.text, plain, I.textRight - I.textX - rightW), I.textX, y);
            if (l.right) drawText(ctx, l.right, I.rightEdge, y, { kind: 3, alignRight: true });
        });
        const blink = (ticks % 18) < 9;
        if (blink && top > 0) drawText(ctx, "▲", I.arrowX, listRowY(row));
        if (blink && top + room < page.where.length) drawText(ctx, "▼", I.arrowX, listRowY(row + room - 1));
        drawFooter(ctx, pf, `Item ${itemsModel.index(ids) + 1}/${ids.length}`, "");
        hint();
    }
    const show = (d) => { const c = current(d); stage?.show(c.sp.name, { shadow: c.state === "unknown", partnerId: c.sp.profileId ?? null }); };
    return {
        windows: ["title", "list", "model", "footer"],
        wall: true,
        get model() { data(); return model; },
        get section() { return section; },
        get itemsModel() { return itemsModel; },
        act(buttons) {
            if (buttons.has(WORD.back)) return "back";
            if (section === SECTION_ITEMS) { actItems(buttons); return null; }
            const d = data();
            if (!d || !model) return null;
            const before = model.index();
            const onPage2 = model.page() === 1;
            if (buttons.has(WORD.next)) {
                if (model.setPage(1, current(d).state === "known")) sfx?.playPacked?.(SFX_OPEN);
                else if (getItems) { section = SECTION_ITEMS; sfx?.playPacked?.(SFX_OPEN); }       // no page 2 to go to: on to ITEMS
            } else if (buttons.has(WORD.prev)) {
                if (model.setPage(0)) sfx?.playPacked?.(SFX_CLOSE);
            } else if (buttons.has("up")) cue(onPage2 ? model.scrollLine(-1, lineCount(d)) : model.move(-1));
            else if (buttons.has("down")) cue(onPage2 ? model.scrollLine(1, lineCount(d)) : model.move(1));
            else if (buttons.has("left")) cue(onPage2 ? model.move(-1) : model.jump(-10));
            else if (buttons.has("right")) cue(onPage2 ? model.move(1) : model.jump(10));
            if (model.index() !== before) show(d);
            return null;
        },
        tick() {
            const d = data();
            if (d && first) { first = false; show(d); }      // the first species' model is asked for as soon as the tables are in
            model?.tickReveal();
        },
        close() { stage?.close?.(); },
        draw(ctx, view) {
            const d = data();
            const L = GLOSSARY_LAYOUT;
            const pt = view.progress("title"), pl = view.progress("list"), pm = view.progress("model"), pf = view.progress("footer");
            const w = (s, k = 1) => textWidth(s, k);
            drawHeader(ctx, pt, "GLOSSARY", TABS, section);   // PLACES (the third tab) is not built: always dim
            if (section === SECTION_ITEMS) { drawItems(ctx, pl, pf, view.ticks); return; }
            withFold(ctx, pl, L.list.x, L.list.y + L.list.h / 2, "x", () => drawPanel(ctx, L.list.x, L.list.y, L.list.cols, L.list.bands));
            if (!d) {
                if (pl >= 1) drawText(ctx, "Loading...", L.countsX, listRowY(0));
                drawFooter(ctx, pf, "", "");
                return;
            }
            const log = logSnapshot(getLog()), rows = listRows(d.species, log, getPartners());      // the log is read once per frame
            if (pl >= 1) {
                drawText(ctx, fitCounts(headerCounts(d.species, log).text, (s) => w(s), L.countsRight - L.countsX), L.countsX, listRowY(0));
                for (let i = 0; i < VISIBLE; i++) {
                    const r = rows[model.top() + i];
                    if (!r) break;
                    const y = listRowY(i + 1);
                    drawText(ctx, String(r.number), L.numberRight, y, { kind: 3, alignRight: true });
                    drawText(ctx, fitByWidth(r.label, (s) => w(s), L.nameRight - L.nameX), L.nameX, y, r.state === "unknown" ? { clut: 7 } : undefined);
                }
                drawCursor(ctx, view.ticks * 2, L.cursorX, listRowY(model.index() - model.top() + 1));
                if (model.top() > 0 && (view.ticks % 18) < 9) drawText(ctx, "▲", L.arrowX, listRowY(1));
                if (model.top() + VISIBLE < rows.length && (view.ticks % 18) < 9) drawText(ctx, "▼", L.arrowX, listRowY(VISIBLE));
            }
            const c = current(d, log);
            if (model.page() === 0) drawPageOne(ctx, pm, pf, c, log, model, stage, view, w);
            else drawPageTwo(ctx, pm, pf, pageTwoLines(c.sp, c.state, c.partner, d.world, d.maxima, d.wildMaxima, c.lead), model, view, w);
        },
    };
}

function drawPageOne(ctx, pm, pf, c, log, model, stage, view, w) {
    const L = GLOSSARY_LAYOUT;
    const p1 = pageOne(c.sp, c.state, log, c.partner);
    withFold(ctx, pm, L.model.x, L.model.y + L.model.h / 2, "x", () => {
        drawPanel(ctx, L.model.x, L.model.y, L.model.cols, L.model.bands);
        drawPanel(ctx, L.card.x, L.card.y, L.card.cols, L.card.bands);
    });
    const lines = cardLines(p1, (s) => w(s), L.cardRight - L.cardX, L.cardRows.length);
    const shown = model.reveal(lines.length);             // the title is always there; one more line every 2 frames, the footer last
    if (pm >= 1) {
        const drawn = stage?.draw(ctx, L.image.x, L.image.y, L.image.w, L.image.h, view.dt) ?? false;
        if (!drawn) {
            const label = "No picture";
            drawText(ctx, label, L.image.x + (L.image.w - w(label)) / 2, L.image.y + (L.image.h - 12) / 2, { clut: 7 });
        }
        lines.forEach((t, i) => { if (i === 0 || i <= shown) drawText(ctx, t, L.cardX, L.cardRows[i]); });
    }
    const hint = c.state === "known";
    const footerShown = shown >= lines.length;
    const dropsRoom = hint ? BAND_TEXT_W - w(HINT, 3) - 8 : BAND_TEXT_W;
    drawFooter(ctx, pf, footerShown ? fitByWidth(p1.lives, (s) => w(s), BAND_TEXT_W) : "", footerShown ? fitByWidth(p1.drops, (s) => w(s), dropsRoom) : "");
    if (pf >= 1 && hint) drawText(ctx, HINT, L.hintRight, 212, { kind: 3, clut: 2, alignRight: true });
}

function drawPageTwo(ctx, pm, pf, lines, model, view, w) {
    const L = GLOSSARY_LAYOUT, P = PAGE2;
    withFold(ctx, pm, L.pane.x, L.pane.y + L.pane.h / 2, "x", () => drawPanel(ctx, L.pane.x, L.pane.y, L.pane.cols, L.pane.bands));
    if (pm >= 1) {
        const rows = page2Rows(lines, (s) => w(s));
        const barW = pageBarWidth(rows, (s, k) => w(s, k));
        const first = Math.min(model.line(), Math.max(0, rows.length - P.visible));
        rows.slice(first, first + P.visible).forEach((r, i) => {
            const y = listRowY(i);
            if (r.kind === "head") drawText(ctx, r.label, P.labelX, y, { clut: 7 });
            else if (r.kind === "note") drawText(ctx, r.text, r.textX, y, { clut: 7 });
            else if (r.kind === "bar") {
                if (!r.icon || !drawIconGlyph(ctx, r.icon, P.labelX, y - 2)) drawText(ctx, r.label, P.labelX, y);
                drawBar(ctx, P.barX, y + 1, barW, P.barH, r.value, r.max);
                drawText(ctx, r.text || String(r.value), P.numberRight, y, { kind: 3, alignRight: true });
            } else {
                if (r.label) drawText(ctx, r.label, P.labelX, y);
                if (r.icons) r.icons.forEach((n, k) => { if (!drawIconGlyph(ctx, n, r.textX + k * P.iconPitch, y - 2)) drawText(ctx, n, r.textX + k * P.iconPitch, y); });
                else if (r.text) drawText(ctx, r.text, r.textX, y);
            }
        });
        const blink = (view.ticks % 18) < 9;           // toggles every 9 ticks, as web/menu.js:2648-2650
        if (blink && first > 0) drawText(ctx, "▲", P.arrowX, listRowY(0));
        if (blink && first + P.visible < rows.length) drawText(ctx, "▼", P.arrowX, listRowY(P.visible - 1));
    }
    drawFooter(ctx, pf, "", "");
    if (pf >= 1) drawText(ctx, P.hint, P.hintRight, 212, { kind: 3, clut: 2, alignRight: true });
}
