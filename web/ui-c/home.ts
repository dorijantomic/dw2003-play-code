// web/ui-c/home.js -- look C kit: the pause home (design file C1). Pure: draw-call parts + text runs in, part descriptors out.
// Positions of the plates come from the game's own draw calls (the clips it draws: cards at y 17 / 63 / 109, the list panel at
// (168,40), the money band at (0,158), the header bar), so every fold or slide the game applies carries over (the `rel` matrix of the
// call). The sizes are the C1 numbers (design px = 3 per native px; dx / dy in geometry.js turn them into native units). The text
// STRINGS are the game's own runs: names, levels, HP / MP numbers, row labels, BIT amount, header text. Nothing is read from game
// state; the bar ratios come from the two number runs on the card.
import { applyRel, dx, dy } from "./geometry.js";
import { isCursorToken, badgeSvg } from "./icons.js";
import { N, textPart, plate, rowPlate, cursor, typeWord, badgeText, stripes, cardBar } from "./base.js";
import type { UiCapturePart, UiPart, UiRun } from './types.js';
type HomeClip = UiCapturePart & { part: string; x: number; y: number };


const STD = { header: { x: 34, y: 13 }, panel: { x: 168, y: 40 }, money: { x: 0, y: 158 } };
const CARD_H = 42, CARD_W_RUNS = 116, ROW_PITCH = 14, FIRST_ROW_TEXT_DY = 9;     // list label pen sits 9 native below the panel top

/** A rect builder for design coordinates. Absolute design page x/y (px) become native, then move by the anchor offset and the call's matrix. */
const at = (rel, ox = 0, oy = 0) => (px: number | undefined, py: number, pw: number | undefined, ph: number | undefined) => applyRel({ x: dx(px!) + ox, y: dy(py) + oy, w: N(pw), h: N(ph) }, rel);
/** Card sub-elements: x absolute design px, y relative to the card top (design px). */
const inCard = (rel, ox: number, cardY: number) => (px: number | undefined, pyRel: number | undefined, pw: number | undefined, ph: number | undefined) => applyRel({ x: dx(px!) + ox, y: cardY + N(pyRel), w: N(pw), h: N(ph) }, rel);

const text = textPart;

const inRegion = (r: { x: number; y: number; }, x0: number, x1: number, y0: number, y1: number) => r.x >= x0 && r.x < x1 && r.y >= y0 && r.y < y1;
const num = (s) => { const n = parseInt(String(s).replace(/[^0-9-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const ratio = (cur: number | null, max: number | null) => (cur !== null && max !== null && max > 0 ? Math.max(0, Math.min(1, cur / max)) : null);

/** Read one party card's runs: { name, lvLabel, lv, hpLabel, hp:[cur,max], mpLabel, mp:[cur,max] } (strings, null where the game draws none). */
export function readCardRuns(runs, cardY: number) {
    const mine = runs.filter((r: { x: number; y: number; }) => inRegion(r, 0, CARD_W_RUNS, cardY, cardY + CARD_H + 4));
    const row = (dyRun: number): UiRun[] => mine.filter((r: { y: number; }) => Math.abs(r.y - (cardY + dyRun)) <= 1);
    const label = (list) => list.filter((r: { right: null; x: number; }) => r.right == null && r.x < 30)[0]?.text ?? null;
    const aligned = (list) => list.filter((r: { right: null; }) => r.right != null).sort((a: { right: number; }, b: { right: number; }) => a.right - b.right).map((r) => r.text);
    const lvRow = row(11), hpRow = row(20), mpRow = row(29);
    const name = mine.filter((r: { y: number; x: number; }) => Math.abs(r.y - (cardY + 2)) <= 1 && r.x >= 40)[0]?.text ?? null;
    const lvVals = aligned(lvRow);
    const hp = aligned(hpRow), mp = aligned(mpRow);
    return { name, lvLabel: label(lvRow), lv: lvVals[0] ?? null, hpLabel: label(hpRow), hp: [hp[0] ?? null, hp[1] ?? null], mpLabel: label(mpRow), mp: [mp[0] ?? null, mp[1] ?? null] };
}

/**
 * The party card, ONE component for every screen that shows it. `v` = the variant's C numbers (design px): C1 home and C2 picker differ
 * only in these. `c` = the state colours { edge, tabBody, tabInk } (plain / focused / held). `card` = the card's runs (readCardRuns).
 */
export const CARD_VARIANTS = Object.freeze({
    home: Object.freeze({ plate: [0, 500], slotX: 24, barW: 120, numX: 370, numW: [96, 88], abs: true }),
    picker: Object.freeze({ plate: [-24, 493], slotX: 40, barW: 104, numX: 352, numW: [92, 86], abs: false }),
});
export const CARD_PLAIN = Object.freeze({ edge: "var(--c-edge)", tabBody: "var(--c-name-body)", tabInk: null });

export function partyCard(i: number, part, namePart, card, out, v = CARD_VARIANTS.home, c = CARD_PLAIN) {
    const Y = part.y, rel = part.rel, ox = part.x, f = inCard(rel, ox, Y), k = `card${i}`;
    const plateRect = v.abs ? applyRel({ x: dx(v.plate[0]!) + ox, y: Y, w: N(v.plate[1]), h: N(126) }, rel) : f(v.plate[0], 0, v.plate[1], 126);
    out.push(plate(`${k}.plate`, "card", plateRect, rel, { shape: "sr", edge: c.edge }));
    out.push(text(`${k}.slot`, "label", `0${i + 1}`, f(v.slotX, 30, 80, 64), 64, 64, { color: "var(--c-slot)", rel }));
    if (namePart || card.name) {
        out.push(plate(`${k}.nameplate`, "cardName", f(296, -6, 196, 44), rel, { shape: "row", underEdge: "e1", edge: c.edge, body: c.tabBody, shadow: 4 }));
        if (card.name) out.push(text(`${k}.name`, "label", card.name, f(314, -2, 170, 34), 24, 34, { color: c.tabInk, rel, maxDp: 170 }));
    }
    out.push({ key: `${k}.lvtab`, kind: "plate", part: "cardLv", layer: "over", rect: f(200, 10, 80, 30), shape: "tab", edge: "var(--c-orange)", sx: rel.a, sy: rel.d });
    out.push(text(`${k}.lv`, "label", `${card.lvLabel ?? ""} ${card.lv ?? ""}`.trim(), f(212, 12, 52, 26), 18, 26, { color: "var(--c-orange-ink)", rel, maxDp: 52 }));
    for (const [id, labelText, vals, top, barTop, numTop, color, numColor, numW] of [
        ["hp", card.hpLabel, card.hp, 52, 56, 48, "var(--c-hp)", null, v.numW[0]],
        ["mp", card.mpLabel, card.mp, 84, 88, 80, "var(--c-mpbar)", "var(--c-mp)", v.numW[1]],
    ]) {
        if (labelText) out.push(text(`${k}.${id}label`, "label", labelText, f(200, top, 40, 24), 16, 24, { color: "var(--c-dim-label)", rel }));
        const r = ratio(num(vals[0]), num(vals[1]));
        if (r !== null) out.push(cardBar(`${k}.${id}bar`, f(244, barTop, v.barW, 14), r, color, rel));
        if (vals[0] !== null && vals[1] !== null) out.push(text(`${k}.${id}num`, "number", `${vals[0]}/${vals[1]}`, f(v.numX, numTop, numW, 30), 22, 30, { align: "right", color: numColor, rel, maxDp: numW }));
    }
}

const composeCard = (i: number, part: { y: number; }, namePart: HomeClip | null, runs: UiRun[], out: UiPart[]) => partyCard(i, part, namePart, readCardRuns(runs, part.y), out);

function composeHeader(part: HomeClip, runs: UiRun[], out) {
    const rel = part.rel, ox = part.x - STD.header.x, oy = part.y - STD.header.y, f = at(rel, ox, oy);
    out.push({ key: "header.plate", kind: "plate", part: "header", layer: "under", rect: f(520, 42, 760, 64), shape: "sl", edge: "var(--c-edge)", body: "var(--c-body)", shadow: 6, sx: rel.a, sy: rel.d });
    const run = runs.find((r: { x: number; y: number; }) => inRegion(r, 120, 400, part.y, part.y + 22));
    if (!run) return;
    const { badge, txt: label } = badgeText(run.text);
    if (badge) out.push({ key: "header.badge", kind: "icon", part: "headerIcon", layer: "over", rect: f(584, 56, 36, 36), svg: badgeSvg(badge), sx: rel.a, sy: rel.d });
    out.push(text("header.text", "label", label.trim(), f(634, 56, 600, 36), 26, 36, { rel }));
}

function composeMoney(part, runs, out) {
    const rel = part.rel, ox = part.x - STD.money.x, oy = part.y - STD.money.y, f = at(rel, ox, oy);
    out.push({ key: "money.plate", kind: "plate", part: "money", layer: "under", rect: f(0, 474, 484, 64), shape: "sr", edge: "var(--c-edge)", body: "var(--c-body)", shadow: 6, sx: rel.a, sy: rel.d });
    const mine = runs.filter((r: { x: number; y: number; }) => inRegion(r, 0, 110, part.y, part.y + 22));
    const amount = mine.find((r: { right: null; }) => r.right != null), unit = mine.find((r: { right: null; }) => r.right == null);
    if (amount) out.push(text("money.amount", "number", amount.text, f(236, 484, 144, 42), 32, 42, { align: "right", rel, maxDp: 144 }));
    if (unit) out.push(text("money.unit", "label", unit.text, f(392, 492, 80, 28), 22, 28, { color: "var(--c-orange)", rel }));
}

function composePanel(part, runs, out, word = "MENU") {
    const rel = part.rel, ox = part.x - STD.panel.x, oy = part.y - STD.panel.y, f = at(rel, ox, oy);
    const labels = runs.filter((r) => r.right == null && !isCursorToken(r.text) && r.x >= part.x + 12 && r.y >= part.y + 4)
        .sort((a: { y: number; }, b: { y: number; }) => a.y - b.y);
    const cur = runs.find((r) => isCursorToken(r.text) && r.x >= part.x);
    if (!labels.length) return;
    const row = (r: { y: number; }) => Math.round((r.y - (part.y + FIRST_ROW_TEXT_DY)) / ROW_PITCH);
    const firstTop = part.y + FIRST_ROW_TEXT_DY - 1;                        // the first row's top edge (native)
    const lastRow = Math.max(...labels.map(row));
    const wallTop = firstTop - 8, wallH = (lastRow * ROW_PITCH + 12) + 8 + 44 / 3;
    out.push({ key: "panel.wall", kind: "wall", part: "panel", layer: "under", rect: applyRel({ x: dx(624) + ox, y: wallTop, w: 400, h: wallH }, rel), sx: rel.a, sy: rel.d });
    out.push(typeWord("panel.type", word, applyRel({ x: dx(700) + ox, y: wallTop + wallH + 2, w: Math.max(40, 320 - (dx(700) + ox)), h: 140 / 3 }, rel), rel, 140, null, false, true));
    const selected = cur ? labels.find((r: { y: number; }) => Math.abs(r.y - cur.y) <= 1) : null;
    for (const r of labels) {
        const i = row(r), top = part.y + FIRST_ROW_TEXT_DY - 1 + i * ROW_PITCH, on = r === selected;
        const rowRect = applyRel({ x: on ? part.x : part.x + 12, y: top, w: 400, h: 12 }, rel);
        out.push(rowPlate(`row${i}.plate`, rowRect, on, rel));
        out.push(text(`row${i}.label`, "label", r.text, applyRel({ x: part.x + 20, y: top, w: 150, h: 12 }, rel), 24, 36, { color: on ? "var(--c-orange-ink)" : null, rel, maxDp: 440 }));
        if (on && cur) {
            const ch = cursor("row.cursor", cur.text, part.x + 14 / 3 + 5, top + 8 / 3 + 10 / 3, rel);
            if (ch) out.push(ch);
        }
    }
}

/**
 * parts = the claimed clips in draw order [{ part, pack, id, x, y, rel }], runs = the text runs captured in the scope.
 * Returns the descriptors (native space) in paint order; `full: true` = the whole bleed limit.
 */
export function composePauseHome({ parts, runs }: { parts: HomeClip[]; runs: UiRun[] }): UiPart[] {
    const of = (name: string) => parts.filter((p: { part: string; }) => p.part === name);
    const panel = of("panel")[0], header = of("header")[0], money = of("money")[0], back = of("backdrop")[0];
    const cards = of("card").sort((a: { y: number; }, b: { y: number; }) => a.y - b.y);
    // back from a sidebar page the game keeps its diamond backdrop under the home: shown as the C stripes (never old pixels), no wash
    const out = [back ? stripes(back.x) : { key: "wash", kind: "wash", part: "wash", layer: "under", full: true }];
    if (panel) composePanel(panel, runs, out);
    if (header) composeHeader(header, runs, out);
    cards.forEach((c: { y: number; }, i: number) => composeCard(i, c, of("cardName").find((n: { y: number; }) => Math.abs(n.y - c.y) < 1) ?? null, runs, out));
    if (money) composeMoney(money, runs, out);
    return out;
}

// shared with the other composers (picker.js, generic.js)
export { textPart, at, inCard, inRegion, num, ratio, CARD_H, composePanel, composeMoney };
