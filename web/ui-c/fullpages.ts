// web/ui-c/fullpages.js -- look C kit: the full-screen pages (T7, design C7). Pure: the draw-call parts (claims.js) and the text runs of a
// scope in, part descriptors in native units out. Every part comes from base.js; positions are the game's own draw calls and the clips'
// own sheet layers (read at run time), never stored here.
//   composeNameEntry   partner chooser + keyboard (also the deck folder rename): C7 title plate, portrait frame, name slots, key grid,
//                      DEL / SPC / arrows / OK buttons (their words stay the game's pixels), the focus = the game's cursor clips
//   composeMemcard     SAVE / LOAD and their confirm pages: panel, title tab, divider rules, slot box rows, slot info line art
//   composeNet         the Digimon Online registration message window
//   composeMapPage     the pause MAP page's place-name window (the map stays the game's picture)
//   composeEnd         the END card (a logo picture: nothing of its own)
import { applyRel, dx } from "./geometry.js";
import { N, ID, textPart, plate, rule, corners, cursor, stripes, typeWord, tokenLine, TAB, tabPlate, tabTitle, FAMILY_C, cWindow, keyCap, nameSlot, keyButton, moreArrow } from "./base.js";
import { restOfRuns } from "./generic.js";
import { composeHint, composeRows, runIn, takeIn } from "./pages.js";
import { isCursorToken } from "./icons.js";

/** The native rect of a part's pixels (draw position + the clip's bounds), before its matrix. */
const nat = (p) => ({ x: p.x + (p.bx ?? 0), y: p.y + (p.by ?? 0), w: p.w ?? 0, h: p.h ?? 0 });
const rel = (p) => p.rel ?? ID;
const R = (r, p) => applyRel(r, rel(p));
const of = (parts, n) => parts.filter((p) => p.part === n);

/** C7 sizes in native units: title plate 63 dp tall, title text 36 dp in; portrait frame 108 x 105; slot 45 x 51; key 38 x 50 inset 2 dp;
 *  key pitch 14 x 18 (the game's grid); button 2 native narrower than its clip, 17 tall; keyboard window 783 x 411. */
export const C7 = Object.freeze({
    hdrH: N(63), hdrTextIn: N(36), hdrDp: 30, hdrLineDp: 44,
    portraitW: N(108), portraitH: N(105), slotW: N(45), slotH: N(51),
    keyIn: N(2), keyW: N(38), keyH: N(50), pitchX: 14, pitchY: 18, gridW: 72,
    btnH: 17, kbW: N(783), kbH: N(411), wordAt: Object.freeze({ x: dx(1090), y: N(120) }), wordDp: 150,
});

/**
 * A run cut into its pieces at gaps of two or more spaces, each with its own pen x (from the run's glyph positions): "[cross] button: Save
 * [triangle] button: Back" is two pieces, each drawn at the game's own x.
 */
export function runSegments(r) {
    const g = r.glyphs ?? [];
    if (!g.length) return [{ text: String(r.text ?? "").trim(), x: r.x }].filter((s) => s.text);
    const segs = [];
    let cur = null, spaces = 0;
    for (const gl of g) {
        if (gl.ch === " ") { spaces++; if (cur) cur.pend += " "; continue; }
        if (!cur || spaces >= 2) { cur = { text: "", x: gl.x, pend: "" }; segs.push(cur); }
        else cur.text += cur.pend;
        cur.pend = ""; cur.text += gl.ch; spaces = 0;
    }
    return segs.map(({ text, x }) => ({ text, x }));
}

/** Glyph positions of a run (pen x per character), or an even 7 px guess when the run carries none. */
const glyphsOf = (r) => (r.glyphs?.length ? r.glyphs : [...String(r.text)].map((ch, k) => ({ ch, x: r.x + 7 * k })));

/** The keyboard's grid cells from the clip's own sheet layers: each 72-wide block of 18-tall rows = 5 columns x (h / 18) rows. */
export function keyCells(p) {
    const cells = [];
    const blocks = (p.layers ?? []).filter((l) => l.w === C7.gridW && l.h >= C7.pitchY && l.h % C7.pitchY === 0).sort((a, b) => a.x - b.x || a.y - b.y);
    for (const b of blocks) for (let r = 0; r < b.h / C7.pitchY; r++) for (let c = 0; c < 5; c++) {
        const nx = p.x + b.x + c * C7.pitchX, ny = p.y + b.y + r * C7.pitchY;
        cells.push({ nx, ny, rect: { x: nx + C7.keyIn, y: ny + C7.keyIn, w: C7.keyW, h: C7.keyH } });
    }
    return cells;
}

/** The name slots from the clip's sheet layers (one 20 x 20 piece per letter), left to right. */
export const slotRects = (p) => (p.layers ?? []).filter((l) => l.w <= 24 && l.h <= 24).sort((a, b) => a.x - b.x)
    .map((l) => ({ nx: p.x + l.x, ny: p.y + l.y, rect: { x: p.x + l.x, y: p.y + l.y, w: C7.slotW, h: C7.slotH } }));

/** The glyph the key shows (the game's katakana middle dot is the dot key). */
const keyGlyph = (ch) => (ch === "・" ? "·" : ch);

/** A left / right arrow in a 14 x 12 box (the C7 "<-" / "->" buttons). */
const ARROW = Object.freeze({ "[arrow-left]": "M0 6L6 0V4H14V8H6V12Z", "[arrow-right]": "M14 6L8 0V4H0V8H8V12Z" });

/** The C7 title plate (a family C window 63 dp tall) and its title run, 36 dp in, in the game's face colour (green when the game tints it). */
function composeTitle(p, i, runs, used, out) {
    const n = nat(p), r = { x: n.x, y: n.y, w: n.w, h: C7.hdrH };
    out.push(cWindow(`hdr${i}`, R(r, p), rel(p), { part: "header" }));
    for (const m of takeIn(runs, n, used)) {
        const x = Math.max(m.x, n.x + C7.hdrTextIn), h = N(C7.hdrLineDp);
        out.push(textPart(`hdr${i}.t`, "label", m.text, R({ x, y: m.y + 4.5 - h / 2, w: n.x + n.w - x - 4, h }, p), C7.hdrDp, C7.hdrLineDp,
            { rel: rel(p), color: m.clut ? "var(--c-c-title)" : null, maxDp: Math.round((n.x + n.w - x - 4) * 3) }));
    }
}

/**
 * Name entry (C7) and the partner chooser before it. `cfg.word` = the big faint word (NAME). The game's cursor clips say the focus: the key
 * cursor (39) its key, the slot cursor (40) its slot, a button drawn twice = the cursor's button, the chooser frame (32) its row.
 */
export function composeNameEntry({ parts, runs }, cfg = {}) {
    const out = [], used = new Set();
    const back = of(parts, "backdrop")[0];
    if (back) {
        out.push(stripes(back.x, "backdrop.stripes", { light: FAMILY_C.stripe, dark: FAMILY_C.stripeDark }));
        out.push(typeWord("backdrop.type", cfg.word ?? "NAME", { x: C7.wordAt.x, y: C7.wordAt.y, w: N(C7.wordDp), h: 200 }, ID, C7.wordDp, FAMILY_C.word, true));
    }
    // the wizard's step digits first: they sit inside the title plate's rect and must not become its title text
    const chips = of(parts, "wizSteps").flatMap((p, i) => composeSteps(p, i, parts, runs, used, out));
    of(parts, "nameHdr").forEach((p, i) => composeTitle(p, i, runs, used, out));
    out.push(...chips);
    of(parts, "hint").forEach((p, i) => composeHint(p, `n${i}`, runs, used, out));
    // the portrait frame (the portrait itself is art over its body)
    of(parts, "portraitFrame").forEach((p, i) => out.push(cWindow(`portrait${i}`, R({ x: p.x, y: p.y, w: C7.portraitW, h: C7.portraitH }, p), rel(p), { part: "portrait" })));
    composeChooser(parts, runs, used, out);
    // name slots: letters from the slot row's run, by glyph x; the slot cursor (40) marks one
    const slotCur = of(parts, "slotCursor")[0];
    of(parts, "nameSlots").forEach((p, i) => {
        const slots = slotRects(p);
        const mine = runs.filter((r) => !used.has(r) && Math.abs(r.y - p.y) <= 3 && r.x >= p.x - 2 && r.x < p.x + p.w);
        mine.forEach((r) => used.add(r));
        const letters = slots.map(() => "");
        for (const r of mine) for (const g of glyphsOf(r)) {
            if (!g.ch.trim()) continue;
            let best = -1, bd = 10;
            slots.forEach((s, k) => { const d = Math.abs(s.nx - g.x); if (d < bd) { bd = d; best = k; } });
            if (best >= 0) letters[best] += g.ch;
        }
        slots.forEach((s, k) => nameSlot(`slot${i}.${k}`, R(s.rect, p), letters[k], !!slotCur && Math.abs(slotCur.x - s.nx) < 3 && Math.abs(slotCur.y - s.ny) < 3, rel(p), out));
    });
    // the keyboard: window, key grid (cells from the clip's layers), letters from the runs by glyph x, the key cursor (39) = focus
    const keyCur = of(parts, "keyCursor")[0];
    of(parts, "keyboard").forEach((p, i) => {
        out.push(cWindow(`kb${i}`, R({ x: p.x + 1, y: p.y, w: C7.kbW, h: C7.kbH }, p), rel(p), { part: "keyboard" }));
        const cells = keyCells(p), chars = cells.map(() => "");
        for (const r of runs) {
            if (used.has(r) || isCursorToken(r.text) || /^\[[a-z-]+\]$/.test(r.text)) continue;
            let hit = false;
            for (const g of glyphsOf(r)) {
                const k = cells.findIndex((c) => Math.abs(c.nx - g.x) <= 6 && Math.abs(c.ny - (r.y - 1)) <= 3);
                if (k >= 0 && g.ch.trim()) { chars[k] = keyGlyph(g.ch); hit = true; }
            }
            if (hit) used.add(r);
        }
        cells.forEach((c, k) => {
            const on = !!keyCur && Math.abs(keyCur.x - c.nx) < 3 && Math.abs(keyCur.y - c.ny) < 3;
            keyCap(`kb${i}.key${k}`, R(c.rect, p), chars[k], on ? "on" : chars[k] ? "key" : "empty", rel(p), out);
        });
    });
    // the buttons: one plate per position; the game draws the cursor's button twice, once in another palette row ("44#4" + "44"): that is its focus
    const seen = new Map();
    for (const p of of(parts, "keyButton")) { const k = `${p.base ?? p.id}@${p.x},${p.y}`; seen.set(k, { p, n: (seen.get(k)?.n ?? 0) + 1 }); }
    for (const { p, n } of seen.values()) {
        const r = { x: p.x + (p.bx ?? 0), y: p.y + (p.by ?? 0), w: Math.max(4, (p.w ?? 0) - 2), h: C7.btnH }, on = n > 1;
        out.push(keyButton(`btn@${p.x},${p.y}`, R(r, p), on, rel(p)));
        for (const m of takeIn(runs, r, used, 1)) {
            const d = ARROW[m.text];
            if (!d) { used.delete(m); continue; }
            const w = 7, h = 6;
            out.push({ key: `btn@${p.x},${p.y}.arrow`, kind: "svg", part: "keyArrow", layer: "over", vw: 14, vh: 12, d, fill: on ? FAMILY_C.slotInk : FAMILY_C.keyInk,
                rect: R({ x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }, p), sx: rel(p).a, sy: rel(p).d });
        }
    }
    restOfRuns(runs, used, ID, out, "n");
    return out;
}

/**
 * The partner chooser rows (stdgnm 30): a family C row plate, the portrait frame inside it, the name (Russo) with the game's underline;
 * the row under the game's cursor frame (32) gets the orange edge, corners and the chevron left of it.
 */
function composeChooser(parts, runs, used, out) {
    const pick = of(parts, "pickCursor")[0];
    of(parts, "pickRow").forEach((p, i) => {
        const row = { x: p.x - 4, y: p.y - 4, w: 160, h: 40 }, on = !!pick && Math.abs(pick.y - row.y) < 3 && Math.abs(pick.x - row.x) < 3, rl = rel(p);
        out.push(cWindow(`pick${i}`, R(row, p), rl, { part: "pickRow", edge: on ? "var(--c-orange)" : FAMILY_C.edge }));
        out.push(plate(`pick${i}.portrait`, "portrait", R({ x: p.x + 2, y: p.y + 2, w: 36, h: 36 }, p), rl, { shape: "key", underEdge: "all", edge: on ? "var(--c-orange)" : FAMILY_C.keyEdge, body: FAMILY_C.body, shadow: 0 }));
        out.push(rule(`pick${i}.line`, R({ x: p.x + 44, y: p.y + 34, w: 104, h: N(4) }, p), on ? "var(--c-orange)" : FAMILY_C.keyEdge, rl));
        if (on) {
            out.push(corners(`pick${i}.corners`, R(row, p), "var(--c-orange)", rl));
            const ch = cursor(`pick${i}.cursor`, "[enter]", row.x - 8, row.y + row.h / 2, rl, "var(--c-orange)");
            if (ch) out.push(ch);
        }
        for (const m of takeIn(runs, row, used)) {
            const h = N(40);
            out.push(textPart(`pick${i}.name`, "label", m.text, R({ x: m.x, y: m.y + 4.5 - h / 2, w: row.x + row.w - m.x - 4, h }, p), 28, 40, { rel: rl, color: on ? "var(--c-slot-ink)" : null, maxDp: Math.round((row.x + row.w - m.x - 4) * 3) }));
        }
    });
}

// ------------------------------------------------------------------------------------------------ SAVE / LOAD (memory card)
/** The thin pieces of a clip's line art (dividers, outlines: one side 8 native or less), merged along a row; the other pieces = boxes. */
export function lineArt(p, skipSizes = []) {
    const L = (p.layers ?? []).filter((l) => !skipSizes.some(([w, h]) => l.w === w && l.h === h));
    const thin = L.filter((l) => Math.min(l.w, l.h) <= 8 && Math.max(l.w, l.h) >= 12);
    const boxes = L.filter((l) => Math.min(l.w, l.h) > 8 && Math.min(l.w, l.h) < 30);
    const rows = [];
    for (const l of thin.filter((t) => t.w > t.h).sort((a, b) => a.y - b.y || a.x - b.x)) {
        const q = rows.find((r) => r.y === l.y && r.h === l.h && l.x <= r.x + r.w + 1 && l.x + l.w >= r.x - 1);
        if (q) { const x1 = Math.max(q.x + q.w, l.x + l.w); q.x = Math.min(q.x, l.x); q.w = x1 - q.x; } else rows.push({ ...l });
    }
    const cols = thin.filter((t) => t.w <= t.h).map((l) => ({ ...l }));
    return { rows, cols, boxes };
}

/** The panel body: the union of the clip's tall pieces (its frame columns), relative to the draw position. */
const panelBody = (p) => {
    const tall = (p.layers ?? []).filter((l) => l.h >= 100);
    if (!tall.length) return { x: p.bx ?? 0, y: p.by ?? 0, w: p.w ?? 0, h: p.h ?? 0 };
    const x0 = Math.min(...tall.map((l) => l.x)), y0 = Math.min(...tall.map((l) => l.y));
    return { x: x0, y: y0, w: Math.max(...tall.map((l) => l.x + l.w)) - x0, h: Math.max(...tall.map((l) => l.y + l.h)) - y0 };
};

/**
 * SAVE / LOAD: the stripes, the panel (family A window on the clip's frame), the title in a C tab ("SAVE" / "LOAD"), the big word
 * ("SAVING"), the dividers from the panel's line art (the prompt divider with the orange lead), the prompt lines (badges + text, pieces at
 * the game's x), the slot box rows (C5 confirm rows), the slot info line art with its pictures, the info texts (units orange).
 */
export function composeMemcard({ parts, runs }) {
    const out = [], used = new Set();
    const back = of(parts, "backdrop")[0];
    if (back) out.push(stripes(back.x));
    // the pipe behind the panel: a C column (edge + body), composed before the panel so the panel covers it
    of(parts, "mcPipe").forEach((p, i) => out.push(plate(`mc${i}.pipe`, "pipe", R(nat(p), p), rel(p), { shape: "frame", shadow: 0 })));
    of(parts, "mcPanel").forEach((p, i) => {
        const b = panelBody(p), body = { x: p.x + b.x, y: p.y + b.y, w: b.w, h: b.h }, rl = rel(p);
        out.push(plate(`mc${i}.panel`, "window", R(body, p), rl, { shape: "ch" }));
        // the title tab: the run in the top strip, right half
        const title = runs.find((m) => !used.has(m) && m.y < body.y + 16 && m.x > body.x + body.w / 2);
        let tab = null;
        if (title) {
            used.add(title);
            const x = title.x - TAB.inset;
            tab = { x, y: title.y + 4.5 - TAB.h / 2, w: Math.min(TAB.w, body.x + body.w - 6 - x), h: TAB.h };
            out.push(tabPlate(`mc${i}.tab`, R(tab, p), rl, { part: "windowTitle", edge: "var(--c-orange)" }));
            out.push(tabTitle(`mc${i}.tabtext`, { ...title, face: "var(--c-orange-ink)" }, tab, rl));
        }
        const art = lineArt(p);
        const inside = (l) => l.y >= b.y + 4 && l.y + l.h <= b.y + b.h - 4 && l.x >= b.x + 4;
        const rows = art.rows.filter(inside).filter((l) => !tab || !(p.y + l.y >= tab.y - 2 && p.y + l.y <= tab.y + tab.h + 3));
        // the prompt divider = the widest rule in the lower half; it gets the orange lead (C9 band language)
        const lower = rows.filter((l) => l.y > b.y + b.h / 2).sort((a, c) => a.y - c.y)[0];
        rows.forEach((l, k) => {
            out.push(rule(`mc${i}.rule${k}`, R({ x: p.x + l.x, y: p.y + l.y, w: l.w, h: N(4) }, p), "var(--c-under)", rl));
            if (l === lower) out.push(rule(`mc${i}.lead`, R({ x: p.x + l.x, y: p.y + l.y, w: Math.min(l.w, N(206)), h: N(4) }, p), "var(--c-orange)", rl));
        });
        const promptTop = lower ? p.y + lower.y : body.y + body.h;
        // the big word ("SAVING" / "LOADING"): a run in the upper half, left
        for (const m of runs) {
            if (used.has(m) || m.y >= promptTop || m.y > body.y + 30 || m.x > body.x + body.w / 2 || m.kind !== 1 || /^-+$/.test(m.text)) continue;
            used.add(m);
            const h = N(44);
            out.push(textPart(`mc${i}.word`, "label", m.text, R({ x: m.x, y: m.y + 4.5 - h / 2, w: 150, h }, p), 32, 44, { rel: rl, maxDp: 450 }));
        }
        // the prompt lines under the divider: each run cut at its wide gaps, each piece at the game's x (badge + text)
        const slots = of(parts, "mcSlots").map(nat);
        for (const m of runs) {
            if (used.has(m) || m.y < promptTop || m.y > body.y + body.h || slots.some((s) => runIn(m, s))) continue;
            used.add(m);
            const segs = runSegments(m);
            segs.forEach((s, k) => {
                const end = segs[k + 1]?.x ?? (slots.find((q) => q.y <= m.y + 9 && q.y + q.h >= m.y)?.x ?? body.x + body.w);
                tokenLine(`mc${i}.p${Math.round(m.y)}.${k}`, s.text, s.x, m.y + 4.5 - N(36) / 2, rl, out, { w: Math.max(20, end - s.x - 4) });
            });
        }
    });
    of(parts, "mcSlots").forEach((p, i) => composeRows(p, `s${i}`, runs, used, out, { confirm: true }));
    of(parts, "mcInfo").forEach((p, i) => {
        const art = lineArt(p, [[48, 32]]), rl = rel(p);
        art.rows.forEach((l, k) => out.push(rule(`info${i}.r${k}`, R({ x: p.x + l.x, y: p.y + l.y, w: l.w, h: N(4) }, p), "var(--c-under)", rl)));
        art.cols.forEach((l, k) => out.push(rule(`info${i}.c${k}`, R({ x: p.x + l.x, y: p.y + l.y, w: N(4), h: l.h }, p), "var(--c-under)", rl)));
        art.boxes.forEach((l, k) => out.push(plate(`info${i}.b${k}`, "infoBox", R({ x: p.x + l.x, y: p.y + l.y, w: l.w, h: l.h }, p), rl, { shape: "frame", edge: "var(--c-under)", shadow: 0 })));
    });
    // the info texts: the units the game draws small (BIT, LV) in orange, the rest by the generic roles
    restOfRuns(runs, used, ID, out, "mc", (r) => (r.kind === 3 && r.right == null && /^[A-Z]+$/.test(r.text) ? { color: "var(--c-orange)" } : {}));
    return out;
}

// ------------------------------------------------------------------------------------------------ registration, map, END
/**
 * The wizard's step header (stnmet 12 / 13 / 14 = step 1 / 2 / 3): three C7 keys with the game's own digits, the current step in the
 * focus colour, a short rule between them. Positions are the clip's own pieces (its 96 x 28 piece holds the three: pitch 28, 16 wide).
 * Returns the chips: the caller adds them AFTER the title plate (plates stack in the order they are pushed).
 */
function composeSteps(p, i, parts, runs, used, out) {
    const step = (p.base ?? Number(p.id)) - 12, big = (p.layers ?? []).find((l) => l.w === 96 && l.h === 28), chips = [];
    if (!big) return chips;
    const ox = p.x + big.x, oy = p.y + big.y, rl = rel(p);
    for (let k = 0; k < 3; k++) {
        const r = { x: ox + 24 + 28 * k, y: oy + 7.5, w: 16, h: 16 };
        const ch = takeIn(runs, r, used)[0]?.text ?? "";
        nameSlot(`steps${i}.${k}`, R(r, p), ch, k === step, rl, chips);
        if (k < 2) chips.push(rule(`steps${i}.link${k}`, R({ x: r.x + r.w, y: r.y + r.h / 2 - N(2), w: 12, h: N(4) }, p), FAMILY_C.keyEdge, rl));
    }
    // the pack list and the confirm page have no title clip of their own: the step clip's left pieces ARE the title band (x 0..176, then
    // under the chips), so the C title plate sits on them (the name keyboard has its own, namedt 29)
    if (!parts.some((q) => q.part === "nameHdr")) composeTitle({ ...p, bx: 0, by: 0, w: 272, h: 21 }, `w${i}`, runs, used, out);
    return chips;
}

/** The starter pack list (stnmet 7): the C window on the clip's frame columns, its rules from the clip's thin pieces, the A / B / C tabs
 *  (the chosen one = the game's marker clip 50, orange). The partner pedestals and the partners stay pictures. */
function composePackWin(p, i, parts, runs, used, out) {
    const b = panelBody(p), body = { x: p.x + b.x, y: p.y + b.y, w: b.w, h: b.h }, rl = rel(p);
    out.push(cWindow(`pk${i}.win`, R(body, p), rl, { part: "window" }));
    for (const l of lineArt(p, [[48, 32]]).rows.filter((q) => q.x >= b.x + 4 && q.y >= b.y + 4 && q.y + q.h <= b.y + b.h - 2))
        out.push(rule(`pk${i}.rule${l.y}`, R({ x: p.x + l.x, y: p.y + l.y + l.h - N(4), w: l.w, h: N(4) }, p), "var(--c-under)", rl));
    const sel = of(parts, "packSel")[0];
    (p.layers ?? []).filter((l) => l.x === 0 && l.w === 28 && l.h === 20).sort((a, c) => a.y - c.y).forEach((l, k) => {
        const r = { x: p.x + l.x, y: p.y + l.y, w: l.w, h: l.h };
        const on = !!sel && Math.abs(sel.x - r.x) < 3 && Math.abs(sel.y - r.y) < 3;
        nameSlot(`pk${i}.tab${k}`, R(r, p), takeIn(runs, r, used)[0]?.text ?? "", on, rl, out);
    });
}

/** The confirm page's name window (stnmet 2 + its portrait frame 6) and pack window (9). */
function composeConfirmBoxes(parts, out) {
    of(parts, "cfPortrait").forEach((p, i) => out.push(plate(`cf${i}.portrait`, "portrait", R({ x: p.x, y: p.y, w: 36, h: 36 }, p), rel(p), { shape: "key", underEdge: "all", edge: FAMILY_C.edge, body: FAMILY_C.body, shadow: 0 })));
    of(parts, "cfName").forEach((p, i) => out.push(cWindow(`cfn${i}`, R({ x: p.x + 36, y: p.y + 15, w: 176, h: 21 }, p), rel(p), { shape: "frame" })));
    of(parts, "cfPack").forEach((p, i) => {
        const r = { x: p.x, y: p.y, w: 212, h: 62 };
        out.push(cWindow(`cfp${i}`, R(r, p), rel(p), { shape: "frame" }));
        out.push(rule(`cfp${i}.rule`, R({ x: p.x + 7, y: p.y + 21, w: 198, h: N(4) }, p), "var(--c-under)", rel(p)));
    });
}

/** The Digimon Online message window: a family C window on the clip's body pieces (the circuit wires stay pictures), the text Chakra 30.
 *  Also the wizard's other pages (step header, pack list, confirm boxes), which are all drawn inside this one scope. */
export function composeNet({ parts, runs }) {
    const out = [], used = new Set();
    const back = of(parts, "backdrop")[0];
    if (back) out.push(stripes(back.x, "backdrop.stripes", { light: FAMILY_C.stripe, dark: FAMILY_C.stripeDark }));
    const chips = of(parts, "wizSteps").flatMap((p, i) => composeSteps(p, i, parts, runs, used, out));
    of(parts, "nameHdr").forEach((p, i) => composeTitle(p, i, runs, used, out));
    out.push(...chips);
    of(parts, "packWin").forEach((p, i) => composePackWin(p, i, parts, runs, used, out));
    composeConfirmBoxes(parts, out);
    of(parts, "netWin").forEach((p, i) => {
        // stnmet 15 (the message window): every piece but the 56 wide wires; stnmet 1 (the wire band holding the Register box): the 54 tall
        // box pieces only (its 16 wide pieces join the wires to the box, outside it)
        const body = (p.layers ?? []).filter((l) => (p.base === 1 ? l.h === 54 : l.w < 56 || l.x >= 0 && l.x + l.w <= 208 && l.w !== 56));
        if (!body.length) return;
        const x0 = Math.min(...body.map((l) => l.x)), y0 = Math.min(...body.map((l) => l.y));
        const r = { x: p.x + x0, y: p.y + y0, w: Math.max(...body.map((l) => l.x + l.w)) - x0, h: Math.max(...body.map((l) => l.y + l.h)) - y0 };
        // over the art: the wires and the logo are pictures, and art sits above the under layer
        out.push(cWindow(`net${i}`, R(r, p), rel(p), { layer: "over" }));
        const mine = takeIn(runs, r, used);
        for (const m of mine) {
            // the wizard's own glyph (a lone "_"): the "wait for a key" blink at the end of a page = the C "more" arrow. Never a text line
            // (its key used to equal the message line's: same y, so the glyph replaced the message in the DOM)
            // the game's list cursor glyph beside a choice (YES / NO): the C chevron in the pose the game is showing
            if (isCursorToken(m.text)) { const c = cursor(`net${i}.cursor`, m.text, m.x + 5, m.y + 4.5, rel(p), "var(--c-orange)"); if (c) out.push(c); continue; }
            if (m.text === "_") {
                out.push(moreArrow(`net${i}.more`, { x: m.x - 1, y: m.y - 2, w: 8, h: 12 }, rel(p), "var(--c-orange)"));
                continue;
            }
            const h = N(42);
            out.push(textPart(`net${i}.t${Math.round(m.y)}.${Math.round(m.x)}`, "body", m.text, R({ x: m.x, y: m.y + 4.5 - h / 2, w: r.x + r.w - m.x - 4, h }, p), 30, 42, { rel: rel(p), color: FAMILY_C.keyInk, maxDp: Math.round((r.x + r.w - m.x - 4) * 3) }));
        }
    });
    restOfRuns(runs, used, ID, out, "net");
    return out;
}

/** The registration wizard (one session, scope "ui-pack"): the message window, then the name keyboard, then the pack list and the confirm. */
export function composeWizard(c) {
    if (c.parts.some((p) => p.part === "keyboard")) return composeNameEntry(c, { word: null });
    return composeNet(c);
}

/** The pause MAP page: the place-name window (family A, the chamfered C frame) and its name in Russo 30. The map is the game's picture. */
export function composeMapPage({ parts, runs }) {
    const out = [], used = new Set();
    of(parts, "mapName").forEach((p, i) => {
        // the frame without the clip's own drop shadow (measured on the game's pixels: frame 10..246 x 20..56 of the 9..253 x 20..60 clip)
        const n = nat(p), r = { x: n.x + 1, y: n.y, w: n.w - 8, h: n.h - 4 };
        // over the art: the map under it is a picture, and art sits above the under layer
        out.push(plate(`map${i}.win`, "window", R(r, p), rel(p), { shape: "ch", layer: "over" }));
        for (const m of takeIn(runs, r, used)) {
            const h = N(44);
            out.push(textPart(`map${i}.name`, "label", m.text, R({ x: m.x, y: m.y + 4.5 - h / 2, w: r.x + r.w - m.x - 6, h }, p), 32, 44, { rel: rel(p), maxDp: Math.round((r.x + r.w - m.x - 6) * 3) }));
        }
    });
    restOfRuns(runs, used, ID, out, "map");
    return out;
}

/**
 * The language page: C7 stripes, the header band, the right column and the logo band as family C plates (square: they run off the
 * screen), the cursor's row as the C7 focus plate (orange edge, amber body) under the flag and word pictures, orange corners round it.
 */
export function composeLanguage({ parts, runs }) {
    const out = [];
    const back = of(parts, "backdrop")[0];
    if (back) out.push(stripes(back.x, "backdrop.stripes", { light: FAMILY_C.stripe, dark: FAMILY_C.stripeDark }));
    // the game's order: the logo band under the column, the header band over both
    for (const n of ["langBand", "langColumn", "langHeader"]) of(parts, n).forEach((p, i) => out.push(cWindow(`${n}${i}`, R(nat(p), p), rel(p), { part: n, shape: "frame" })));
    of(parts, "langCursor").forEach((p, i) => {
        const r = R(nat(p), p);
        out.push(plate(`lang${i}.on`, "langCursor", r, rel(p), { shape: "ch", edge: "var(--c-orange)", body: FAMILY_C.slotOn, shadow: 0 }));
        out.push(corners(`lang${i}.corners`, r, "var(--c-orange)", rel(p)));
    });
    restOfRuns(runs, null, ID, out, "lang");
    return out;
}

/** The END card: its only clip is the END logo, a picture (kept in its own pixels by the scope). */
export const composeEnd = ({ runs }) => { const out = []; restOfRuns(runs, null, ID, out, "end"); return out; };
