// web/ui-c/vic.js -- look C kit: the "Data Burst" victory (design C "Arc + Dock", tab "vic"). One part (kind "vic") builds the whole page as DOM: the
// backdrop, the EXP rings that fill from the old to the new value, LEVEL UP, the learned tech / digivolve lines, the BIT and item pages. The composer
// (sheets.js composeVictory) hands it read-only data (the battle's progress records, the session's text lines); nothing here feeds back into the game.
// CSS animations only (vic.css, reduced motion honoured); the part is built once per signature, so animations run once per page.
import { fitRun, measureText, FACE } from "./text.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const el = (cls, parent, tag = "div") => { const e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };
const F_LABEL = FACE.label;

/** A text element with its fit rule (the same fitRun the other parts use); `max` = widest allowed px. */
function txt(parent, cls, text, sizePx, max, family = F_LABEL, weight = 400, spacing = 0) {
    const e = el(cls, parent, "span");
    const fit = fitRun((s, sp) => measureText(String(text), family, weight, s, sp), sizePx, spacing, max);
    e.textContent = String(text);
    e.dataset.uicText = String(text); e.dataset.uicFits = fit.fits ? "1" : "0";
    e.style.fontSize = `${+fit.size.toFixed(2)}px`; e.style.letterSpacing = `${+fit.spacing.toFixed(2)}px`;
    e.style.maxWidth = `${Math.round(max)}px`;
    return e;
}
/** A counting number: its final value is the text (data), the CSS counter animates 0 -> value once. */
function count(parent, cls, value, sizePx, max, prefix = "") {
    const e = el(`cnt ${cls}`, parent, "b");
    e.style.setProperty("--n", String(Math.round(value)));
    e.dataset.uicText = `${prefix}${Math.round(value)}`; e.dataset.uicFits = "1";
    e.dataset.prefix = prefix;
    const fit = fitRun((s, sp) => measureText(`${prefix}${Math.round(value)}`.replace(/\d/g, "0"), F_LABEL, 400, s, sp), sizePx, 0, max);
    e.style.fontSize = `${+fit.size.toFixed(2)}px`; e.style.setProperty("--pre", `"${prefix}"`);
    e.style.maxWidth = `${Math.round(max)}px`;
    return e;
}
const ringSvg = (a, b) => {
    const circ = (cls, r, w, ex = "") => `<circle class="${cls}" cx="150" cy="150" r="${r}" stroke-width="${w}" fill="none" ${ex}/>`;
    const arc = (cls, d0, d1) => `<circle class="${cls}" cx="150" cy="150" r="120" stroke-width="16" fill="none" pathLength="100" transform="rotate(-90 150 150)" style="--a:${d0};--d:${d1};stroke-dasharray:${cls === "old" ? `${d0} 100` : `0 ${d0} ${d1} 100`}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" aria-hidden="true"><g class="rot">${circ("tk", 142, 6, 'pathLength="360" stroke-dasharray=".9 5.1"')}</g>${circ("trk", 120, 16)}${circ("thin", 98, 1.5)}${arc("old", a, 0)}${arc("new", a, Math.max(0, b - a))}</svg>`;
};
const line = (parent, text, sizePx, max, right = false) => {
    const w = el(`vl-wrap${right ? " r" : ""}`, parent);
    el("vl", w, "i"); txt(w, "vl-t", text, sizePx, max, F_LABEL, 400, sizePx * 0.4); el("vl r", w, "i");
    return w;
};

/** A learned line under a ring: a tech in bright cyan-white, a digivolve as a highlighted gold pill with a NEW tag (never dark ink on the blue). */
function learnLine(root, text, digi, D, x, y) {
    const c = el(`lrn${digi ? " d" : ""}`, root);
    c.style.cssText = `left:${Math.round(x)}px;top:${Math.round(y)}px;width:${Math.round(D * 1.2)}px`;
    if (digi) { const nw = el("nw", c, "i"); nw.textContent = "NEW"; nw.style.fontSize = `${Math.round(D * 0.045)}px`; }
    txt(c, "ln", text, D * 0.07, D * (digi ? 1.0 : 1.2));
    return c;
}

/** Build / rebuild the page for `desc` (descriptor from sheets.js composeVictory). */
export function fillVic(root, desc, g) {
    const r = g.rect, W = r.width, H = r.height, k = Math.min(W / 1280, H / 720);
    root.className = "uic-part uic-vic";
    root.dataset.uicPart = desc.part;
    root.dataset.uicRect = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
    root.style.cssText = `position:absolute;left:${Math.round(r.left)}px;top:${Math.round(r.top)}px;width:${Math.round(r.width)}px;height:${Math.round(r.height)}px`;
    root.replaceChildren();
    el("vic-bg", root);
    const px = (n) => n * k;
    if (desc.page === "exp") {
        const n = Math.max(1, desc.rings.length), D = Math.min(H * 0.4, W / (n * 1.3), 340 * k * 1.15), gap = Math.min(D * 0.45, (W - n * D) / (n + 1));
        const x0 = (W - (n * D + (n - 1) * gap)) / 2, y0 = H * 0.2;
        const title = el("vic-ttl", root); line(title, desc.up ? "LEVEL UP" : "EXPERIENCE", px(desc.up ? 70 : 26), W * 0.5);
        title.style.top = `${Math.round(H * (desc.up ? 0.045 : 0.06))}px`;
        desc.rings.forEach((p, i) => {
            const rg = el(`vr${p.up ? " k" : ""}${p.gain > 0 || p.up ? "" : " z"}`, root);       // z = nothing gained: calmer ring, the name stays bright
            rg.style.cssText = `left:${Math.round(x0 + i * (D + gap))}px;top:${Math.round(y0)}px;width:${Math.round(D)}px;height:${Math.round(D)}px;--i:${i}`;
            rg.innerHTML = ringSvg(Math.round(p.a * 100), Math.round(p.b * 100));
            const inn = el("in", rg);
            txt(inn, "lv-s", "LV", D * 0.055, D * 0.3, F_LABEL, 400, D * 0.012);
            txt(inn, "lv-n", p.up ? p.lvTo : p.lv, D * 0.28, D * 0.5);
            const nm = txt(root, "vn", p.name, D * 0.085, D * 1.15);
            nm.style.cssText += `;left:${Math.round(x0 + i * (D + gap) - D * 0.075)}px;top:${Math.round(y0 + D + D * 0.05)}px;width:${Math.round(D * 1.15)}px`;
            const xl = txt(root, "xl", "EXP", D * 0.045, D, F_LABEL, 700, D * 0.02);
            xl.style.cssText += `;left:${Math.round(x0 + i * (D + gap))}px;top:${Math.round(y0 + D + D * 0.18)}px;width:${Math.round(D)}px`;
            const xg = count(root, p.gain > 0 || p.up ? "xg" : "xg z", p.gain, D * 0.16, D * 1.15, "+");
            xg.style.cssText += `;left:${Math.round(x0 + i * (D + gap) - D * 0.075)}px;top:${Math.round(y0 + D + D * 0.23)}px;width:${Math.round(D * 1.15)}px`;
            let ly = y0 + D + D * 0.45;
            for (const t of p.learned) { learnLine(root, `LEARNED ${t}`, false, D, x0 + i * (D + gap) - D * 0.1, ly); ly += D * 0.12; }
            for (const t of p.digi) { learnLine(root, `DIGIVOLVE ${t}`, true, D, x0 + i * (D + gap) - D * 0.1, ly); ly += D * 0.12; }
        });
    } else if (desc.page === "bit") {
        const bx = el("vbit", root); bx.style.top = `${Math.round(H * 0.12)}px`;
        txt(bx, "vt", "BIT GAINED", px(24), W * 0.8, F_LABEL, 400, px(10));
        count(bx, "bn", desc.num, px(200), W * 0.9);
        txt(bx, "bl", "BIT", px(34), W * 0.4, F_LABEL, 400, px(8));
        if (desc.item) {
            const it = el("vitem", root); it.style.top = `${Math.round(H * 0.66)}px`;
            el("ul", it); txt(it, "sm", "ITEM GAINED", px(14), W * 0.6, F_LABEL, 700, px(7));
            const row = el("row", it); txt(row, "in", desc.item.name, px(60), W * 0.6);
            if (desc.item.qty) txt(row, "ic", desc.item.qty, px(34), W * 0.2);
        }
    } else if (desc.page === "item") {
        const D = Math.min(H * 0.3, W * 0.34), x0 = (W - D) / 2, y0 = H * 0.08, rg = el("vr z", root);      // the item's emblem: a calm ring with its initial
        rg.style.cssText = `left:${Math.round(x0)}px;top:${Math.round(y0)}px;width:${Math.round(D)}px;height:${Math.round(D)}px;--i:0`;
        rg.innerHTML = ringSvg(100, 100);
        txt(el("in", rg), "lv-n", String(desc.big).trim().charAt(0).toUpperCase(), D * 0.3, D * 0.5);
        const it = el("vitem lone", root); it.style.top = `${Math.round(H * 0.5)}px`;
        el("ul", it); txt(it, "sm", "ITEM GAINED", px(14), W * 0.6, F_LABEL, 700, px(7));
        const row = el("row", it); txt(row, "in", desc.big, px(60), W * 0.7);
        if (desc.small) txt(row, "ic", desc.small, px(34), W * 0.2);
    } else if (desc.learn) {
        // a learned tech / digivolve: the partner's ring (its level) over its name, then the learned name on a highlighted line
        const L = desc.learn, D = Math.min(H * 0.36, W * 0.4), x0 = (W - D) / 2, y0 = H * 0.08;
        const rg = el("vr k", root);
        rg.style.cssText = `left:${Math.round(x0)}px;top:${Math.round(y0)}px;width:${Math.round(D)}px;height:${Math.round(D)}px;--i:0`;
        rg.innerHTML = ringSvg(100, 100);
        const inn = el("in", rg);
        if (L.lv) { txt(inn, "lv-s", "LV", D * 0.055, D * 0.3, F_LABEL, 400, D * 0.012); txt(inn, "lv-n", L.lv, D * 0.28, D * 0.5); }
        else txt(inn, "lv-n", String(desc.big).charAt(0).toUpperCase(), D * 0.3, D * 0.5);
        if (L.partner) { const nm = txt(root, "vn", L.partner, D * 0.1, D * 1.4); nm.style.cssText += `;left:${Math.round(x0 - D * 0.2)}px;top:${Math.round(y0 + D + D * 0.06)}px;width:${Math.round(D * 1.4)}px`; }
        const hl = el(`vhl${L.kind === "digi" ? " d" : ""}`, root); hl.style.top = `${Math.round(H * 0.66)}px`;
        const tag = el("tg", hl, "i"); tag.textContent = L.kind === "digi" ? "NEW DIGIVOLVE" : "NEW TECHNIQUE"; tag.style.fontSize = `${Math.round(px(18))}px`; tag.style.letterSpacing = `${Math.round(px(5))}px`;
        if (desc.small) txt(hl, "sm", desc.small, px(18), W * 0.8, F_LABEL, 400, px(7));
        txt(hl, "big", desc.big, px(72), W * 0.86);
    } else {
        const vt = el("vtext", root); vt.style.top = `${Math.round(H * 0.34)}px`;
        if (desc.small) txt(vt, "sm", desc.small, px(18), W * 0.8, F_LABEL, 400, px(7));
        txt(vt, "big", desc.big, px(72), W * 0.86);
    }
}
