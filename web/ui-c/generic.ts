// web/ui-c/generic.js -- look C kit: the data-driven composer. Claimed clips (claims.js) become plates at their own native rect (the
// rect is the game's draw position plus the clip's pixel bounds, read from the loaded sheet at run time), every text run becomes DOM
// text, and an unclaimed clip is art (drawn by the capture scope on the art canvas, never dropped). Pure: parts + runs in, descriptors out.
import { applyRel } from "./geometry.js";
import { N, ID, textPart, plate, stripes, typeWord, badgeText, tokenLine } from "./base.js";
import type { GenericOpts, UiTextOpts } from "./types.js";

/** The native rect of a claimed clip through the matrix of its draw call. */
export const clipRect = (p) => applyRel({ x: p.x + (p.bx ?? 0), y: p.y + (p.by ?? 0), w: p.w ?? 0, h: p.h ?? 0 }, p.rel);

const KIND_ROLE = (r: { kind: number; right: null; }) => (r.kind === 3 ? (r.right != null ? "number" : "label") : "label");

/**
 * One run -> a text descriptor. `o` may carry { role, sizeDp, color, rect } to override the defaults (kind 1 = label 24 dp, kind 3 =
 * small label 16 dp / right-anchored number 22 dp). Native text rows are 9 high; the DOM line is centred on them.
 */
export function runText(r, key: string, rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }>, o: UiTextOpts = {}) {
    const role = o.role ?? KIND_ROLE(r);
    const small = r.kind === 3 && o.sizeDp === undefined;
    const sizeDp = o.sizeDp ?? (role === "number" ? 22 : small ? 16 : role === "body" ? 26 : 24);
    const lineDp = role === "body" ? sizeDp + 10 : sizeDp + (role === "number" ? 8 : small ? 8 : 12);
    const lineN = lineDp / 3, w = Math.max(r.w ?? 0, 8) * 1.15 + 2;
    const top = r.y + 4.5 - lineN / 2;
    const right = r.right != null;
    const rect = o.rect ?? (right ? applyRel({ x: r.right - w, y: top, w, h: lineN }, rel) : applyRel({ x: r.x, y: top, w, h: lineN }, rel));
    return textPart(key, role, r.text, rect, sizeDp, lineDp, { align: right ? "right" : "left", color: o.color ?? r.face ?? (role === "label" && small ? "var(--c-dim-label)" : null), rel, maxDp: o.maxDp ?? (right ? 0 : Math.round(w * 3)) });
}

/** Every run not in `used` as a text part. */
export function restOfRuns(runs, used: Set<unknown> | null, rel: Readonly<{ a: 1; d: 1; e: 0; f: 0; }>, out, prefix = "t", pick: (r: any) => any = () => ({})) {
    const seen = new Map();
    runs.forEach((r) => {
        if (used?.has(r)) return;
        if (r.text === "" || /^\[(enter|enter2|select|space2)\]$/.test(r.text)) return;
        const base = `${prefix}.${r.text}@${Math.round(r.x)},${Math.round(r.y)}`;
        const n = seen.get(base) ?? 0; seen.set(base, n + 1);
        const key = n ? `${base}#${n}` : base;
        // a line that starts with a button token ("[triangle] Button:Back") is the C badge + its text, never the raw token
        if (badgeText(r.text).badge) { tokenLine(key, r.text, r.x, r.y + 4.5 - N(36) / 2, rel, out, { role: "label", sizeDp: 24, lineDp: 36, w: Math.max(60, (r.w ?? 60) * 1.15) }); return; }
        out.push(runText(r, key, rel, pick(r) ?? {}));
    });
}

/** The plate for a claimed clip. */
export function platePart(p, i) {
    return plate(`p${i}.${p.pack}.${p.id}`, p.part, clipRect(p), p.rel, { layer: p.layer ?? "under", shape: p.shape ?? "frame", edge: p.edge, body: p.body ?? "var(--c-body)", shadow: p.shadow, underEdge: p.underEdge });
}

/**
 * The generic screen: claimed plates, the backdrop when the game draws one, all text. `cfg` = { wash, word, roles(run) }.
 */
export function composeGeneric({ parts, runs }, cfg: GenericOpts = {}) {
    const out = [];
    if (cfg.wash) out.push({ key: "wash", kind: "wash", part: "wash", layer: "under", full: true });
    let i = 0;
    for (const p of parts) {
        if (p.part === "backdrop") { composeBackdrop(p, cfg, out); continue; }
        if (p.part === "plate") out.push(platePart(p, i));
        i++;
    }
    restOfRuns(runs, null, { a: 1, d: 1, e: 0, f: 0 }, out, "t", cfg.roles);
    return out;
}

/** The scrolling diamond field of the status-style pages: stripes over the whole limit, the game's own scroll offset (the call's x = y). */
export function composeBackdrop(p, cfg: GenericOpts, out) {
    out.push(stripes(p.x));
    if (cfg.word) { const wx = cfg.wordX ?? 80; out.push(typeWord("backdrop.type", cfg.word, { x: wx, y: cfg.wordY ?? 133, w: Math.max(40, 320 - wx), h: 140 / 3 }, ID, 140, null, false, true)); }
}
