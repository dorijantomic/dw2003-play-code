// web/ui-c/text.js -- look C kit: how a text run becomes one DOM line. Pure helpers (the fit rule) + one browser helper (measure).

/** The two faces of the look, named once (quoted for CSS / canvas font strings): label = Russo One, text = Chakra Petch. */
export const FACE = Object.freeze({ label: '"Russo One"', text: '"Chakra Petch"' });

/** The three text roles (C9): label = Russo One caps, number = Chakra Petch 700 amber, body = Chakra Petch 600. */
export const ROLES = Object.freeze({ label: "uic-L", number: "uic-N", body: "uic-B" });

/**
 * The fit rule: the DOM run may not be wider than `maxW`. Wider runs shrink the font down to 85 %, then drop the letter-spacing to 0.
 * `measure(sizePx, spacingPx)` = the run's width. Returns { size, spacing, fits }.
 */
export function fitRun(measure, size: number, spacing: number, maxW: number) {
    if (!(maxW > 0) || measure(size, spacing) <= maxW) return { size, spacing, fits: true };
    let s = size;
    for (let f = 0.95; f >= 0.85 - 1e-9; f -= 0.05) {
        s = size * f;
        if (measure(s, spacing) <= maxW) return { size: s, spacing, fits: true };
    }
    s = size * 0.85;
    if (measure(s, 0) <= maxW) return { size: s, spacing: 0, fits: true };
    return { size: s, spacing: 0, fits: false };
}

let measureCtx = null;
/** Width of `text` in page px for a CSS font (browser only; falls back to 0.6 em per letter when there is no canvas). */
export function measureText(text, family: string, weight: number, sizePx: number, spacingPx: number) {
    if (typeof document === "undefined") return text.length * sizePx * 0.6;
    measureCtx ??= document.createElement("canvas").getContext("2d");
    measureCtx.font = `${weight} ${sizePx}px ${family}`;
    return measureCtx.measureText(text).width + spacingPx * text.length;
}
