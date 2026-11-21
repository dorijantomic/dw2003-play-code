// web/ui-c/pages.js -- look C kit: the screen composers. Pure: the draw-call parts (claims.js) and the text runs of a scope in, part
// descriptors in native units out. Three families:
//   composePausePage   the party sidebar pages (design C2 partner picker): backdrop + wall, party cards with the portrait plate and the
//                      selection corners, header plate, footer band, money plate, the item list or the folder window on the right
//   composeWindowPage  one window of rows with a header plate and hint plates (lab, shop root, inn, help, demo), plain plates by claim
//   composeCapsule     the lab / gym partner picker: info card, hint plates, capsule window (the capsules themselves are art)
// The text strings are the game's own runs; numbers on the cards are parsed back from the runs, never from game state.
import { applyRel, dx } from "./geometry.js";
import { textPart, at, inCard, num, ratio, readCardRuns, composePanel, composeMoney, partyCard, CARD_VARIANTS } from "./home.js";
import { isCursorToken } from "./icons.js";
import { N, ID, plate, rule, rowPlate, cursor, corners, stripes, typeWord, tokenLine, TAB, tabPlate, tabTitle, CONFIRM, SPINNER, spinnerPlate, spinArrows, cardBar } from "./base.js";
import { clipRect, platePart, restOfRuns } from "./generic.js";
import { composeListWin, composeTabHeader, composeLists } from "./lists.js";
import { composeBandWindow } from "./message.js";
import type { PausePageOpts, UiTextOpts } from "./types.js";


/** The run's text anchor (pen x, middle of the 9 native rows) lies inside the native rect. */
export const runIn = (r, rc, pad = 0) => r.x >= rc.x - pad && r.x < rc.x + rc.w + pad && r.y + 4 >= rc.y - pad && r.y + 4 < rc.y + rc.h + pad;
const lbl = (key, str, rect, sizeDp, lineDp, o: UiTextOpts = {}) => textPart(key, o.role ?? "label", str, rect, sizeDp, lineDp, { color: o.color ?? null, align: o.align ?? "left", maxDp: o.maxDp ?? 0, rel: o.rel, spacing: o.spacing });
export const takeIn = (runs, rc, used, pad = 0) => { const r = runs.filter((x) => runIn(x, rc, pad) && !used.has(x)); r.forEach((x) => used.add(x)); return r; };
const solid = rule;

// ------------------------------------------------------------------------------------------------ backdrop, footer, hints
/** The scrolling diamond field (stripes over the whole limit, the game's own scroll counter) and, when asked, the right-hand wall + big word. */
export function composeBackdropPart(back, cfg: PausePageOpts, out) {
    out.push(stripes(back.x));
    if (cfg.wall) out.push({ key: "backdrop.wall", kind: "wall", shape: "wallL", part: "wall", layer: "under", rect: { x: dx(660), y: 0, w: N(620), h: 240 }, color: "var(--c-wall)", sx: 1, sy: 1 });
    if (cfg.word) { const wx = cfg.wordAt?.x ?? dx(640); out.push(typeWord("backdrop.type", cfg.word, { x: wx, y: cfg.wordAt?.y ?? N(400), w: Math.max(40, 320 - wx), h: N(cfg.wordDp ?? 140) }, ID, cfg.wordDp ?? 140, null, false, true)); }
}

export { tokenLine };

/**
 * The footer band (C2): edge top and bottom, an orange tab top-left, two dividers; the game's one or two text lines. Runs on the same
 * game line stay one line; a line that starts in the right half (the technique cost "MP 16") keeps the game's own x, its number
 * right-anchored on the game's right edge.
 */
/** A footer line run's right edge (native): the next run's start, else the right divider (1060 dp) for the line's text, else x 318 for
 *  a word the game draws past the divider (the demo page's "BIT"). */
/** A footer number (digits with their separators); a right-anchored run with letters is a word. */
const FOOT_NUMBER = /^[0-9][0-9,./ ]*$/;
const footRight = (lineRuns, j) => (lineRuns[j + 1] ? lineRuns[j + 1].x - 1 : j ? 318 : dx(1060));

export function composeFooter(foot, runs, used, out) {
    const rel = foot.rel, r = clipRect(foot);
    out.push({ key: "footer.plate", kind: "band", part: "footer", layer: "under", rect: r, edge: "var(--c-edge)", body: "var(--c-body)", shadow: 6, sx: rel.a, sy: rel.d });
    out.push(solid("footer.tab", applyRel({ x: dx(0), y: r.y, w: N(206), h: N(4) }, rel), "var(--c-orange)", rel));
    out.push(solid("footer.div1", applyRel({ x: dx(206), y: r.y + N(4), w: N(4), h: r.h - N(8) }, rel), "var(--c-under)", rel));
    out.push(solid("footer.div2", applyRel({ x: dx(1068), y: r.y + N(4), w: N(4), h: r.h - N(8) }, rel), "var(--c-under)", rel));
    const mine = takeIn(runs, { x: -9999, y: r.y, w: 99999, h: r.h }, used).sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const m of mine) { const l = lines.find((q) => Math.abs(q.y - m.y) <= 2); if (l) l.runs.push(m); else lines.push({ y: m.y, runs: [m] }); }
    // one or two lines: 12 dp from the top, 44 dp apart; more (the QUESTS description band has three): spread evenly inside the band
    const many = lines.length > 2, pitch = many ? (r.h - N(8) - N(36)) / (lines.length - 1) : N(44), top = many ? N(4) : N(12);
    lines.forEach((l, i) => {
        l.runs.sort((a, b) => a.x - b.x);
        const y = r.y + top + i * pitch;
        if (l.runs[0].x < 160) { l.runs.forEach((m, j) => tokenLine(j ? `footer.l${i}.${j}` : `footer.l${i}`, m.text, j ? m.x : dx(232), y, rel, out, { right: footRight(l.runs, j) })); return; }
        l.runs.forEach((m, j) => {
            // a number: right-anchored, 120 dp. A word the game ends at the right divider (the GLOSSARY hints, hintRight 300 = 1060 dp): right-
            // aligned there, growing left as far as the previous run. Any other word: the room up to the next run or the divider, >= 80 dp.
            // (the game right-anchors words too, e.g. that hint: a right-anchored run is a number only when its text is one)
            const isNum = m.right != null && FOOT_NUMBER.test(String(m.text).trim());
            const edge = isNum ? null : m.right ?? (!l.runs[j + 1] && m.x + (m.w ?? 0) >= dx(1060) - 2 ? dx(1060) : null);
            const left = j ? l.runs[j - 1].x + (l.runs[j - 1].w ?? 0) + 2 : dx(232);
            const x = isNum ? m.right - N(120) : edge != null ? Math.max(left, edge - N(320)) : m.x;
            const room = isNum ? N(120) : edge != null ? edge - x : Math.max(N(80), (l.runs[j + 1]?.x ?? dx(1060)) - m.x - 1);
            out.push(lbl(`footer.l${i}.${j}`, m.text, applyRel({ x, y, w: room, h: N(36) }, rel), 26, 36, { role: isNum ? "number" : "body", align: isNum || edge != null ? "right" : "left", rel, maxDp: Math.round(room * 3) }));
        });
    });
}

/**
 * The item detail line (C3): a full-width band 58 dp tall centred on the game's clip, dividers at 206 / 624 / 846 dp; the item name in
 * Russo 22, the cell labels ("Equip", "Items") dim 18, their numbers Chakra Petch 700 26 right-anchored. The item icon stays art.
 */
export function composeDetail(p, runs, used, out) {
    const rel = p.rel, r = clipRect(p), h = N(58), y = r.y + (r.h - h) / 2;
    out.push({ key: "detail.band", kind: "band", part: "detail", layer: "under", rect: applyRel({ x: 0, y, w: 320, h }, rel), edge: "var(--c-edge)", body: "var(--c-body)", shadow: 6, sx: rel.a, sy: rel.d });
    for (const [k, d] of [[1, 206], [2, 624], [3, 846]]) out.push(solid(`detail.div${k}`, applyRel({ x: dx(d), y: y + N(4), w: N(4), h: h - N(8) }, rel), "var(--c-under)", rel));
    const mine = takeIn(runs, { x: -9999, y: r.y, w: 99999, h: r.h }, used);
    detailTexts(mine, y + h / 2, rel, out, "detail", (m) => m.x > dx(624));
}

/**
 * The texts of an item detail line (C3), shared by the bag's band and the shop's item line: numbers Chakra Petch 700 26 right-anchored,
 * the cell labels ("Equip", "Items") dim Russo 18, the item name Russo 22; all centred on `mid` (native). `isCellLabel(run)` says which
 * plain runs are cell labels (the rest is the name).
 */
export function detailTexts(mine, mid, rel, out, k, isCellLabel) {
    for (const m of [...mine].sort((a, b) => a.x - b.x)) {
        const isNum = m.right != null || /^[0-9]+$/.test(m.text);
        if (isNum) {
            const right = m.right ?? m.x + (m.w ?? 8);
            out.push(lbl(`${k}.n${Math.round(right)}`, m.text, applyRel({ x: right - N(80), y: mid - N(20), w: N(80), h: N(40) }, rel), 26, 40, { role: "number", align: "right", color: "var(--c-ink)", rel, maxDp: 80 }));
        } else if (isCellLabel(m)) {
            out.push(lbl(`${k}.l${Math.round(m.x)}`, m.text, applyRel({ x: m.x, y: mid - N(14), w: N(100), h: N(28) }, rel), 18, 28, { color: "var(--c-dim-label)", rel, maxDp: 100 }));
        } else {
            out.push(lbl(`${k}.name`, m.text, applyRel({ x: m.x, y: mid - N(18), w: N(340), h: N(36) }, rel), 22, 36, { rel, maxDp: 340 }));
        }
    }
}

/**
 * The navy arrow tree of "Switch with who?" as a path in native units relative to the tree piece: an up arrow under each top cell, a
 * bar joining them, a down arrow to each bottom cell. `cxs` / `downs` = arrow centre x (native, relative to the tree), `h` = tree height.
 */
export function switchTreePath(cxs, downs, h) {
    if (!cxs.length) return "";
    const lo = Math.min(...cxs, ...downs), hi = Math.max(...cxs, ...downs), barTop = Math.round(h * 0.38), barBot = barTop + 6;
    let d = `M${lo - 3} ${barTop}H${hi + 3}V${barBot}H${lo - 3}Z`;
    for (const cx of cxs) d += `M${cx - 11} 8L${cx} 0L${cx + 11} 8H${cx + 3}V${barTop}H${cx - 3}V8Z`;
    for (const cx of downs) d += `M${cx - 3} ${barBot}H${cx + 3}V${h - 8}H${cx + 11}L${cx} ${h}L${cx - 11} ${h - 8}H${cx - 3}Z`;
    return d;
}

/**
 * "Switch with who?" (lab): the window plate (bleeds right with the clip), the capsule cells as thin C frames and the inactive arrow tree in
 * navy. Cells and tree come from the clip's own sheet layers: cells = the pieces about 44 x 71, tree = the wide flat piece. The white
 * active arrows and the capsules are other clips (art) and draw over this.
 */
export function composeSwitchWindow(p, i, out) {
    const rel = p.rel, r = clipRect(p), L = p.layers ?? [];
    out.push({ key: `sw${i}.plate`, kind: "plate", part: "window", layer: "under", rect: r, shape: "ch", edge: "var(--c-edge)", body: "var(--c-body)", shadow: 6, sx: rel.a, sy: rel.d });
    const cells = L.filter((l) => l.w >= 30 && l.w <= 60 && l.h >= 50 && l.h < p.h - 4);
    const tree = L.find((l) => l.w >= 80 && l.h <= 40);
    cells.forEach((c, k) => out.push({ key: `sw${i}.cell${k}`, kind: "plate", part: "cell", layer: "under", rect: applyRel({ x: p.x + c.x, y: p.y + c.y, w: c.w, h: c.h }, rel), shape: "frame", edge: "var(--c-under)", body: "var(--c-body)", shadow: 0, sx: rel.a, sy: rel.d }));
    if (tree) {
        const mid = (c) => c.x + c.w / 2 - tree.x;
        const ups = cells.filter((c) => c.y < tree.y).map(mid), downs = cells.filter((c) => c.y > tree.y).map(mid);
        out.push({ key: `sw${i}.tree`, kind: "svg", part: "tree", layer: "under", rect: applyRel({ x: p.x + tree.x, y: p.y + tree.y, w: tree.w, h: tree.h }, rel), vw: tree.w, vh: tree.h, d: switchTreePath(ups, downs, tree.h), fill: "var(--c-under)", sx: rel.a, sy: rel.d });
    }
}

const isNumText = (t) => /^[0-9]+$/.test(t);

/**
 * Read the info card's runs (lab / gym partner pickers): rows grouped by pen y; a row whose first word is LV / HP / MP is a stat row,
 * its number runs (sorted by x) are its values. The name is the top run that is not a stat label. Strings only, as the game drew them.
 */
export function readInfoRuns(runs) {
    const rows = [];
    for (const r of [...runs].sort((a, b) => a.y - b.y || a.x - b.x)) {
        const row = rows.find((g) => Math.abs(g.y - r.y) <= 2);
        if (row) row.runs.push(r); else rows.push({ y: r.y, runs: [r] });
    }
    const out = { name: null, stats: [] };
    for (const g of rows) {
        g.runs.sort((a, b) => a.x - b.x);
        const label = g.runs.find((r) => !isNumText(r.text) && r.text !== "/");
        const head = label ? /^(LV|HP|MP)/i.exec(label.text.trim()) : null;
        if (head) {
            const nums = g.runs.filter((r) => isNumText(r.text));
            const right = nums.length ? Math.max(...nums.map((n) => n.right ?? n.x + (n.w ?? 8))) : null;
            out.stats.push({ id: head[1].toUpperCase(), label, y: g.y, values: nums.map((n) => n.text), right, raw: g.runs });
        } else if (!out.name && label) out.name = label;
    }
    return out;
}

/**
 * The info card of the lab / gym pickers in the C2 card language: the plate by claim, the name in Russo 24, LV in an orange tab, HP / MP
 * dim labels with a bar (ratio from the two numbers the game drew) and "cur/max" right-anchored in amber (MP light blue). A row the game
 * draws with placeholders ("----") is shown as its own text, no bar.
 */
export function composeInfoCard(p, i, runs, used, out) {
    const rel = p.rel, r = clipRect(p);
    out.push(platePart(p, i));
    const mine = takeIn(runs, r, used);
    const info = readInfoRuns(mine);
    const k = `info${i}`;
    if (info.name) out.push(lbl(`${k}.name`, info.name.text, applyRel({ x: info.name.x, y: info.name.y + 4.5 - N(17), w: N(330), h: N(34) }, rel), 24, 34, { rel, maxDp: 330 }));
    for (const s of info.stats) {
        const mid = s.y + 4.5, x0 = s.label.x;
        if (s.id === "LV" && s.values.length) {
            out.push({ key: `${k}.lvtab`, kind: "plate", part: "cardLv", layer: "over", rect: applyRel({ x: x0 - 1, y: mid - N(15), w: N(80), h: N(30) }, rel), shape: "tab", edge: "var(--c-orange)", sx: rel.a, sy: rel.d });
            out.push(lbl(`${k}.lv`, `${s.label.text.trim()} ${s.values[0]}`, applyRel({ x: x0 - 1 + N(12), y: mid - N(13), w: N(52), h: N(26) }, rel), 18, 26, { color: "var(--c-orange-ink)", rel, maxDp: 52 }));
            continue;
        }
        if ((s.id === "HP" || s.id === "MP") && s.values.length >= 2 && s.right != null) {
            const mp = s.id === "MP", numW = N(96), barX = x0 + N(44), barW = Math.max(4, s.right - numW - N(8) - barX);
            out.push(lbl(`${k}.${s.id}label`, s.label.text.trim(), applyRel({ x: x0, y: mid - N(12), w: N(40), h: N(24) }, rel), 16, 24, { color: "var(--c-dim-label)", rel }));
            const rt = ratio(num(s.values[0]), num(s.values[1]));
            if (rt !== null) out.push(cardBar(`${k}.${s.id}bar`, applyRel({ x: barX, y: mid - N(7), w: barW, h: N(14) }, rel), rt, mp ? "var(--c-mpbar)" : "var(--c-hp)", rel));
            out.push(lbl(`${k}.${s.id}num`, `${s.values[0]}/${s.values[1]}`, applyRel({ x: s.right - numW, y: mid - N(15), w: numW, h: N(30) }, rel), 22, 30, { role: "number", align: "right", color: mp ? "var(--c-mp)" : null, rel, maxDp: 96 }));
            continue;
        }
        // placeholders or an unknown row: the game's own strings, left to right
        s.raw.forEach((m, j) => out.push(lbl(`${k}.${s.id}.${j}`, m.text, applyRel({ x: m.x, y: mid - N(12), w: N(Math.max(40, (m.w ?? 8) * 3.5)), h: N(24) }, rel), 18, 24, { color: j === 0 ? "var(--c-dim-label)" : "var(--c-num)", rel })));
    }
}

/** A hint plate ("Button: Back"): chamfered frame, bleeding to the screen edge, the game's text with its button badge. */
export function composeHint(p, i, runs, used, out) {
    const rel = p.rel, r = clipRect(p);
    out.push(platePart(p, i));
    const mine = takeIn(runs, r, used).sort((a, b) => a.y - b.y || a.x - b.x);
    // one line per pen line: runs on the same line (the gym's "TP 1  TP 5  TP10" choices) stay side by side at the game's own x
    const lines = [];
    for (const m of mine) { const l = lines.find((q) => Math.abs(q[0].y - m.y) <= 2); if (l) l.push(m); else lines.push([m]); }
    lines.forEach((line, k) => {
        const y = r.y + (r.h - N(36) * lines.length) / 2 + k * N(36);
        line.forEach((m, j) => {
            // the first run: inset 36 dp, or the game's own x when the plate has a lead in front of the text (the drill plate's stripes)
            const x = j ? m.x : Math.max(r.x + N(36), m.x), end = line[j + 1]?.x ?? r.x + r.w;
            tokenLine(j ? `hint${i}.l${k}.${j}` : `hint${i}.l${k}`, m.text, x, y, rel, out, { w: end - x - (line[j + 1] ? 2 : 8), color: m.face ?? null });   // the game's face colour (the drill gain is light blue)
        });
    });
}

/**
 * A header plate (slanted left end): the game's title run in Russo One, 30 dp. `cover` = the plate lies over a list window (the shop's
 * "Not enough BIT." over the buy list): the plate goes over the list (layer "over", above the item icons), its text is the leftmost run
 * column only, and the list texts under it are taken (covered) -- the disc overprints them, unreadable.
 */
export function composeHeaderPlate(p, i, runs, used, out, cover = false) {
    const rel = p.rel, r = clipRect(p);
    out.push(cover ? { ...platePart(p, i), layer: "over" } : platePart(p, i));
    let mine = takeIn(runs, r, used);
    if (cover && mine.length) { const x0 = Math.min(...mine.map((m) => m.x)); mine = mine.filter((m) => Math.abs(m.x - x0) <= 2); }
    for (const m of mine) {
        if (isCursorToken(m.text)) continue;
        const price = /^([0-9]+) (BIT)$/.exec(m.text);
        if (price) {
            // the price on Buy / No (C5): the number Chakra Petch 700 34 white, the unit Russo 24 after it
            const nw = N(21 * price[1].length + 4), mid = r.y + r.h / 2;
            out.push(lbl(`hdr${i}.${m.y}.n`, price[1], applyRel({ x: m.x, y: mid - N(23), w: nw, h: N(46) }, rel), 34, 46, { role: "number", color: "var(--c-ink)", rel, maxDp: Math.round(nw * 3) }));
            out.push(lbl(`hdr${i}.${m.y}.u`, price[2], applyRel({ x: m.x + nw + N(8), y: mid - N(16) + N(3), w: N(60), h: N(32) }, rel), 24, 32, { rel, maxDp: 60 }));
            continue;
        }
        tokenLine(`hdr${i}.${m.y}`, m.text, m.x, r.y + (r.h - N(40)) / 2, rel, out, { role: "label", sizeDp: 30, lineDp: 40, w: Math.max(40, r.x + r.w - m.x) });
    }
}

// ------------------------------------------------------------------------------------------------ rows in a window
/** A titled window as a C4 tab panel: the window plate starts 9 native under the title strip's top, the tab sits 18 dp left of it. */
export const WIN_TITLE = Object.freeze({ bodyDy: 9, tabDx: N(18) });

/**
 * The window of rows: the window plate, one plate per label (pitch read from the labels), the cursor row orange and pushed out, the
 * chevron in the pose the game's cursor glyph says. `win` is the claimed window part; labels = the runs inside it below `titleH`.
 */
export function composeRows(win, i, runs, used, out, opt: { titleH?: number; confirm?: boolean; question?: boolean; } = {}) {
    const rel = win.rel, wr = clipRect(win), titleH = opt.titleH ?? 0;
    const body = { x: wr.x, y: wr.y + titleH, w: wr.w, h: wr.h - titleH };
    // a titled window (CARD FOLDERS, the techniques list, the equipment item grid) = the C4 tab panel: the window from WIN_TITLE.bodyDy below
    // the title strip's top, the shared title tab 18 dp left of it over its top edge (drawn last, over the window)
    const frame = titleH ? { x: wr.x, y: wr.y + WIN_TITLE.bodyDy, w: wr.w, h: wr.h - WIN_TITLE.bodyDy } : body;
    const titles = titleH ? takeIn(runs, { x: wr.x, y: wr.y, w: wr.w, h: titleH }, used) : [];
    // a confirm box keeps its claim's layer (over the pictures); its rows follow it
    const winLayer = opt.confirm ? win.layer ?? "under" : "under";
    out.push({ key: `win${i}.plate`, kind: "plate", part: "window", layer: winLayer, rect: applyRel(frame, rel), shape: "ch", edge: "var(--c-edge)", body: "var(--c-body)", shadow: 6, sx: rel.a, sy: rel.d });
    if (titleH) {
        const tab = { x: wr.x - WIN_TITLE.tabDx, y: wr.y, w: Math.min(TAB.w, wr.w + WIN_TITLE.tabDx), h: TAB.h };
        out.push(tabPlate(`win${i}.title`, applyRel(tab, rel), rel, { part: "windowTitle" }));
        titles.forEach((t, j) => out.push(tabTitle(`win${i}.titletext${j || ""}`, t, tab, rel)));
    }
    const inside = takeIn(runs, body, used);
    const cur = inside.find((r) => isCursorToken(r.text));
    const plain = inside.filter((r) => !isCursorToken(r.text) && r.right == null).sort((a, b) => a.y - b.y || a.x - b.x);
    // one row per pen line: the leftmost run is its label, any other run on the same line (the "X 1" count of an item row) is drawn in it
    const rows = [], extras = [];
    for (const r of plain) (rows.some((q) => Math.abs(q.y - r.y) <= 2) ? extras : rows).push(r);
    const onRowY = (r) => rows.some((q) => Math.abs(q.y - r.y) <= 2);
    inside.filter((r) => !isCursorToken(r.text) && r.right != null).forEach((r) => { if (onRowY(r)) extras.push(r); else used.delete(r); });   // other numbers stay generic text
    // a question box (C9: the field Yes / No, the choice box): the top line without the cursor is the prompt, Russo 26 / 36 at the game's x
    if (opt.question && rows.length > 1 && !(cur && Math.abs(rows[0].y - cur.y) <= 2)) {
        const q = rows.shift();
        tokenLine(`win${i}.prompt`, q.text, q.x, q.y + 4.5 - N(36) / 2, rel, out, { w: body.x + body.w - q.x - 4 });
    }
    if (!rows.length) return;
    const gaps = rows.slice(1).map((r, k) => r.y - rows[k].y).filter((d) => d > 3);
    const pitch = gaps.length ? Math.min(...gaps) : 14;
    // the confirm box (C5): 40 dp rows centred on the game's pen line (9 native glyph rows), Russo 26 / 40, the focused row pushed out
    const c = opt.confirm ? CONFIRM : null, h = c ? Math.min(c.rowH, pitch - 2) : pitch - 2;
    const selected = cur ? rows.reduce((b, r) => (Math.abs(r.y - cur.y) < Math.abs(b.y - cur.y) ? r : b), rows[0]) : null;
    rows.forEach((r, k) => {
        const on = r === selected, top = c ? r.y + 4.5 - h / 2 : r.y - 1, px = body.x + 10;
        const left = c ? body.x + (on ? c.onIn : c.plainIn) : on ? px - 6 : px;
        const rect = applyRel({ x: left, y: top, w: body.x + body.w - left + 1, h }, rel);
        out.push({ ...rowPlate(`win${i}.row${k}.plate`, rect, on, rel), layer: winLayer });
        out.push(lbl(`win${i}.row${k}.label`, r.text, applyRel({ x: r.x, y: top, w: 150, h }, rel), c ? c.sizeDp : 24, c ? c.lineDp : h * 3, { color: on ? "var(--c-orange-ink)" : (r.face ?? null), rel, maxDp: 440 }));
        if (on && cur) {
            const ch = cursor(`win${i}.cursor`, cur.text, c ? Math.min(left + c.chevIn + 5, r.x - 8) : left + 4 + 5, top + h / 2, rel);
            if (ch) out.push(ch);
        }
        for (const m of extras.filter((e) => Math.abs(e.y - r.y) <= 2)) {
            const ink = on ? "var(--c-orange-ink)" : null;
            if (m.right != null) out.push(lbl(`win${i}.row${k}.n${Math.round(m.right)}`, m.text, applyRel({ x: m.right - N(80), y: top, w: N(80), h }, rel), 22, h * 3, { role: "number", align: "right", color: ink ?? "var(--c-ink)", rel, maxDp: 80 }));
            else out.push(lbl(`win${i}.row${k}.x${Math.round(m.x)}`, m.text, applyRel({ x: m.x, y: top, w: 30, h }, rel), 20, h * 3, { color: ink ?? "var(--c-dim-label)", rel, maxDp: 90 }));
        }
    });
}

// ------------------------------------------------------------------------------------------------ the number spinner (C5)
/**
 * The number spinner ("X 1" under "How many?"): the C ch box with the orange live edge, "X" dim Russo 26 at the game's x, the count
 * Chakra Petch 700 40 right-anchored on the game's right edge; both centred on the box. The count is the game's run, never state.
 */
export function composeSpinner(p, i, runs, used, out) {
    const rel = p.rel, r = clipRect(p), mid = r.y + r.h / 2;
    out.push(spinnerPlate(`spin${i}.plate`, applyRel(r, rel), rel, true));
    for (const m of takeIn(runs, r, used)) {
        if (m.right != null || /^[0-9]+$/.test(m.text)) {
            const right = m.right ?? m.x + 8, h = N(SPINNER.countLineDp);
            out.push(lbl(`spin${i}.count`, m.text, applyRel({ x: right - N(90), y: mid - h / 2, w: N(90), h }, rel), SPINNER.countDp, SPINNER.countLineDp, { role: "number", align: "right", color: "var(--c-ink)", rel, maxDp: 90 }));
        } else {
            const h = N(SPINNER.xLineDp);
            out.push(lbl(`spin${i}.x`, m.text, applyRel({ x: m.x, y: mid - h / 2, w: 12, h }, rel), SPINNER.xDp, SPINNER.xLineDp, { color: "var(--c-dim-label)", rel, maxDp: 40 }));
        }
    }
}

/** The spinner's up / down arrows: the game draws them while the count can change; the C triangles on its x, centred on the spinner box. */
export function composeSpinArrows(p, i, parts, out) {
    const r = clipRect(p), box = parts.filter((q) => q.part === "spinner").map(clipRect).find((b) => r.x >= b.x - 4 && r.x < b.x + b.w + 4 && r.y >= b.y - 4 && r.y < b.y + b.h + 4);
    out.push(spinArrows(`spin${i}.arrows`, r.x + r.w / 2, box ? box.y + box.h / 2 : r.y + r.h / 2, p.rel));
}

// ------------------------------------------------------------------------------------------------ the party sidebar pages
const COLORS = {
    normal: { edge: "var(--c-edge)", tabBody: "var(--c-name-body)", tabInk: null },
    on: { edge: "var(--c-orange)", tabBody: "var(--c-orange)", tabInk: "var(--c-orange-ink)" },
    locked: { edge: "var(--c-cyan)", tabBody: "var(--c-locked)", tabInk: null },
};

/** The palette row the game draws the highlight with: 8 = the held partner (SORT, blue-cyan), 0..7 = the cursor's colour cycle. */
export const LOCKED_ROW = 8;

/**
 * The state of every card from the highlight parts: "on" (the cursor), "locked" (SORT holds this partner) or "normal". The palette
 * row of the draw call decides (row 8 = locked); a highlight without a row is the cursor.
 */
export function cardStates(cards, highlights) {
    const st = cards.map(() => "normal");
    for (const h of highlights) {
        const i = cards.findIndex((c) => Math.abs(c.y - h.y) < 3);
        if (i < 0) continue;
        st[i] = (h.row | 0) === LOCKED_ROW ? "locked" : "on";
    }
    return st;
}

/** The cursor highlight's colour for palette row 0..7: orange, brightening to amber and back (the game's 8-step cycle, about 4 frames a step). */
export function cyclePulse(row) {
    const r = ((row | 0) % 8 + 8) % 8, t = r <= 4 ? r / 4 : (8 - r) / 4;      // 0 -> 1 -> 0
    const mix = (a, b) => Math.round(a + (b - a) * t);
    const hex = (n) => n.toString(16).padStart(2, "0");
    return `#${hex(mix(0xf8, 0xff))}${hex(mix(0x98, 0xd2))}${hex(mix(0x00, 0x6a))}`;
}

/**
 * The SORT swap bracket (C style): an orange bar right of the portraits with two arrow heads pointing at the two portraits. `p` = the
 * claimed bracket clip; the arrows sit 7 native below its top and 8 above its bottom (the portrait centres of the two cards).
 */
export function composeBracket(p, out) {
    const r = clipRect(p);
    out.push({ key: "swap.bracket", kind: "bracket", part: "swapBracket", layer: "over", rect: r, arrows: [7 * p.rel.d, r.h - 8 * p.rel.d], color: "var(--c-orange)", sx: p.rel.a, sy: p.rel.d });
}

function composePickerCard(i, card, namePart, portrait, state, runs, used, out, hl = null) {
    const Y = card.y, rel = card.rel, f = inCard(rel, card.x, Y), c = COLORS[state], k = `card${i}`;
    runs.filter((m) => m.x < 116 && m.y >= Y - 1 && m.y < Y + 45).forEach((m) => used.add(m));
    partyCard(i, card, namePart, readCardRuns(runs, Y), out, CARD_VARIANTS.picker as unknown as typeof CARD_VARIANTS.home, c);
    if (portrait) {
        out.push(plate(`${k}.portrait`, "portrait", f(469, 3, 128, 128), rel, { edge: c.edge }));
        if (state !== "normal") out.push(corners(`${k}.corners`, f(469 + 4, 3 + 4, 120, 120), state === "on" && hl ? cyclePulse(hl.row) : c.edge, rel));
    }
    if (state === "on") out.push({ key: `${k}.cursor`, kind: "chevron", part: "cursor", layer: "over", rect: f(0, 54, 30, 20), fill: "var(--c-orange)", sx: rel.a, sy: rel.d });
}

/** The header of the sidebar pages (C2): plate 664 x 69 slanted left, the game's title in Russo One 30. */
function composePageHeader(part, runs, used, out) {
    const rel = part.rel, f = at(rel, part.x - 34, part.y - 13);
    out.push({ key: "header.plate", kind: "plate", part: "header", layer: "under", rect: f(616, 39, 664, 69), shape: "sl", edge: "var(--c-edge)", body: "var(--c-body)", shadow: 6, sx: rel.a, sy: rel.d });
    for (const m of takeIn(runs, { x: 100, y: part.y, w: 300, h: 22 }, used)) tokenLine("header.t", m.text, dx(676), N(53) + (part.y - 13), rel, out, { role: "label", sizeDp: 30, lineDp: 40, w: 150 });
}

/**
 * The sidebar pages. cfg = { word, wall (override), wordAt / wordDp (where and how big the faint word is), extra(parts, runs, used, out)
 * (the screen's own parts, composed right after the backdrop: the status sheets, sheets.js) }. The right part follows the clips the game draws: the 5-row list (cmfont panel) gets the home list,
 * the folders page its title + rows window, the partner pickers the big wall and the faint word.
 */
export function composePausePage({ parts, runs }, cfg: PausePageOpts = {}) {
    const out = [], used = cfg.used ?? new Set();
    const of = (n) => parts.filter((p) => p.part === n);
    const back = of("backdrop")[0], panel = of("panel")[0], folder = of("folderWin")[0], header = of("header")[0], money = of("money")[0], foot = of("footer")[0];
    const cards = of("card").sort((a, b) => a.y - b.y), names = of("cardName"), portraits = of("portrait");
    if (back) composeBackdropPart(back, { wall: cfg.wall ?? (!panel && !folder), word: panel || folder ? null : cfg.word, wordAt: cfg.wordAt, wordDp: cfg.wordDp }, out);
    if (cfg.extra) cfg.extra(parts, runs, used, out);
    if (panel) {
        const mine = runs.filter((r) => r.x >= panel.x && r.y >= panel.y && r.y < 160);
        composePanel(panel, mine, out, cfg.word ?? "MENU");
        mine.forEach((r) => used.add(r));
    }
    if (folder) composeRows(folder, 0, runs, used, out, { titleH: 17 });
    if (header) composePageHeader(header, runs, used, out);
    const highlights = of("highlight"), states = cardStates(cards, highlights);
    cards.forEach((c, i) => composePickerCard(i, c, names.find((n) => Math.abs(n.y - c.y) < 1) ?? null, portraits.find((p) => Math.abs(p.y - c.y - 2) < 3) ?? null, states[i], runs, used, out,
        highlights.find((h) => Math.abs(h.y - c.y) < 3) ?? null));
    for (const b of of("bracket")) composeBracket(b, out);
    for (const d of of("detail")) composeDetail(d, runs, used, out);
    if (money) { composeMoney(money, runs, out); runs.filter((r) => r.x < 110 && r.y >= money.y && r.y < money.y + 22).forEach((r) => used.add(r)); }
    if (foot) composeFooter(foot, runs, used, out);
    composeLists(parts, runs, used, out, { skip: folder ? [clipRect(folder)] : [], pulse: cyclePulse });
    restOfRuns(runs, used, ID, out, "page");
    return out;
}

// ------------------------------------------------------------------------------------------------ one window + plates (lab, shop, inn, help, demo)
/** Parts by claim: header / hint / name / money plates with their text, the window of rows, any other claimed plate plain. */
export function composeWindowPage({ parts, runs }, cfg: { wash?: boolean; messageWindow?: boolean; word?: string | null; } = {}) {
    const out = [], used = new Set();
    if (cfg.wash) out.push({ key: "wash", kind: "wash", part: "wash", layer: "under", full: true });
    const lists = parts.filter((p) => p.part === "listWin").map(clipRect);
    const overList = (p) => { const r = clipRect(p); return lists.some((l) => r.x < l.x + l.w && l.x < r.x + r.w && r.y < l.y + l.h && l.y < r.y + r.h); };
    parts.forEach((p, i) => {
        if (p.part === "backdrop") composeBackdropPart(p, {}, out);
        else if (p.part === "window") composeRows(p, i, runs, used, out);
        else if (p.part === "confirm") composeRows(p, i, runs, used, out, { confirm: true });
        else if (p.part === "question") {
            // the help counter's topic page draws its text in this same window with no cursor: there it is a message (C9 9 band). Only
            // the owner can tell (the Yes / No opens with an empty window too), so it says so: cfg.messageWindow (screens.js composeHelp)
            const r = clipRect(p);
            const cursorIn = runs.some((m) => isCursorToken(m.text) && m.x >= r.x - 1 && m.x < r.x + r.w && m.y + 4.5 >= r.y && m.y + 4.5 < r.y + r.h);
            if (cursorIn || !cfg.messageWindow) composeRows(p, i, runs, used, out, { confirm: true, question: true });
            else composeBandWindow(p, i, runs, used, out);
        }
        else if (p.part === "spinner") composeSpinner(p, i, runs, used, out);
        else if (p.part === "spinArrows") composeSpinArrows(p, i, parts, out);
        else if (p.part === "header") composeHeaderPlate(p, i, runs, used, out, overList(p));
        else if (p.part === "hint") composeHint(p, i, runs, used, out);
        else if (p.part === "info") composeInfoCard(p, i, runs, used, out);
        else if (p.part === "switchWin") composeSwitchWindow(p, i, out);
        else if (p.part === "name") {
            out.push(platePart(p, i));
            for (const m of takeIn(runs, clipRect(p), used)) out.push(lbl(`name${i}.t`, m.text, applyRel({ x: m.x, y: clipRect(p).y + 0.5, w: 150, h: N(40) }, p.rel), 26, 40, { rel: p.rel, maxDp: 440 }));
        } else if (p.part === "money") composeMoneyPlate(p, i, runs, used, out);
        else if (p.part === "shopDetail") composeShopDetail(p, i, runs, used, out);
        else if (p.part === "pickHl") composePickHighlight(p, i, out);
        else if (p.part === "listWin") composeListWin(p, i, out, { word: cfg.word });
        else if (p.part === "tabHdr") composeTabHeader(p, i, runs, used, out);
        else if (p.part === "detail") composeDetail(p, runs, used, out);
        else if (p.part === "footer") composeFooter(p, runs, used, out);
        else if (p.part === "folder") composeFolderPlate(p, i, out);
        else if (p.shape) out.push(platePart(p, i));
    });
    composeLists(parts, runs, used, out, { skip: parts.filter((p) => p.part === "window").map(clipRect), pulse: cyclePulse });
    composeArrows(runs, used, out);
    restOfRuns(runs, used, ID, out, "w");
    return out;
}

/** A deck folder row (card shop / deck editor): the C frame, orange edge on the cursor's folder, cyan while it is held for the actions. */
function composeFolderPlate(p, i, out) {
    const edge = p.state === "on" ? "var(--c-orange)" : p.state === "held" ? "var(--c-cyan)" : "var(--c-edge)";
    out.push({ ...platePart(p, i), edge });
}

/** The ITEMS bag (C3): stripes, the full-width list window with the faint word, the tab, item cells, pager, detail line, footer. */
export const composeListPage = (c, cfg: { word?: string | null; } = {}) => composeWindowPage(c, { word: cfg.word ?? "ITEMS" });

/**
 * The shop item line on "Equip who?" (one clip): name plate | Equip / Items plate, and the price plate under the right end. The split
 * points are the clip's own sheet layers: the first tall layer starts the stats block, the second one starts the price plate.
 */
export function shopDetailRects(layers) {
    if (!layers.length) return [];
    const tall = layers.filter((l) => l.h > 30).sort((a, b) => a.x - b.x);
    const right = Math.max(...layers.map((l) => l.x + l.w)), top = Math.min(...layers.map((l) => l.h));
    const full = Math.max(...layers.map((l) => l.h));
    if (tall.length < 2) return [{ x: 0, y: 0, w: right, h: full, shape: "ch" }];
    const s = tall[0].x, p = tall[1].x;
    return [
        { x: 0, y: 0, w: s, h: top, shape: "ch" },
        { x: s, y: 0, w: right - s, h: top, shape: "ch" },
        { x: p, y: top, w: right - p, h: full - top, shape: "sl" },
    ];
}

function composeShopDetail(p, i, runs, used, out) {
    const rel = p.rel, rects = shopDetailRects(p.layers ?? []);
    rects.forEach((r, k) => out.push(plate(`p${i}.detail${k}`, "detail", applyRel({ x: p.x + r.x, y: p.y + r.y, w: r.w, h: r.h }, rel), rel, { shape: r.shape })));
    // the name block and the Equip / Items block (the top row): C3 detail texts; the price plate under them keeps the generic money text
    if (rects.length < 2) return;
    const top = rects[0], native = { x: p.x, y: p.y + top.y, w: rects[1].x + rects[1].w, h: top.h };
    const mine = takeIn(runs, native, used);
    detailTexts(mine, p.y + top.y + top.h / 2, rel, out, `p${i}.detail`, (m) => m.x >= p.x + rects[1].x);
}

/** The shop partner-card cursor frame: C corner brackets in the cursor's colour cycle (the game's palette row). */
function composePickHighlight(p, i, out) {
    out.push(corners(`p${i}.pick`, clipRect(p), cyclePulse(p.row), p.rel));
}

/** The game's stat-change arrow token ("48 [arrow-right] 62") as a small orange chevron at the token's pen position. */
export function composeArrows(runs, used, out) {
    runs.forEach((r, k) => {
        if (used.has(r) || r.text !== "[arrow-right]") return;
        used.add(r);
        const w = N(24), h = N(18);
        out.push({ key: `arrow${k}@${Math.round(r.x)},${Math.round(r.y)}`, kind: "chevron", part: "arrow", layer: "over", rect: { x: r.x + 1, y: r.y + 4.5 - h / 2, w, h }, fill: "var(--c-orange)", sx: 1, sy: 1 });
    });
}

/** The money plate of the shop screens: the game's amount (right-anchored, Chakra Petch 700) and its unit in orange. */
function composeMoneyPlate(p, i, runs, used, out) {
    const rel = p.rel, r = clipRect(p);
    out.push(platePart(p, i));
    const mine = takeIn(runs, r, used);
    const amount = mine.find((m) => m.right != null || /^[0-9,.]+$/.test(m.text)), unit = mine.find((m) => m !== amount);
    const top = r.y + (r.h - N(42)) / 2;
    const edge = amount ? (amount.right ?? amount.x + (amount.w ?? 20)) : 0;
    if (amount) out.push(lbl(`money${i}.amount`, amount.text, applyRel({ x: edge - N(140) - 2, y: top, w: N(140), h: N(42) }, rel), 32, 42, { role: "number", align: "right", rel, maxDp: 140 }));
    if (unit) out.push(lbl(`money${i}.unit`, unit.text, applyRel({ x: unit.x, y: top + N(8), w: N(80), h: N(28) }, rel), 22, 28, { color: "var(--c-orange)", rel }));
}

/** The lab / gym partner pickers: plates by claim (info card, hints, header, window, stat window, TP plate) and all their text; capsules are art. */
export function composeCapsule({ parts, runs }) {
    return composeWindowPage({ parts, runs }, {});
}
