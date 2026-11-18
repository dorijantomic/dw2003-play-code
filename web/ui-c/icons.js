// web/ui-c/icons.js -- look C kit: our own drawings, as SVG strings (no image files). Pure.

/** The double chevron cursor, 30 x 20 (two 6 px strokes, 14 px apart); the fill comes from the caller. */
export const CHEVRON_VIEW = Object.freeze({ w: 30, h: 20 });
export const CHEVRON_PATH = "M0 0L10 10L0 20H6L16 10L6 0Z M14 0L24 10L14 20H20L30 10L20 0Z";
export const chevronSvg = (fill) => `<svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 30 20" preserveAspectRatio="none"><path d="${CHEVRON_PATH}" fill="${fill}"/></svg>`;

/** The four states of the list cursor: the game swaps four glyphs on its own clock; each maps to one pose of the chevron
 *  (sx, sy = size about its centre, hidden). Timing stays the game's. */
export const CURSOR_POSES = Object.freeze({
    "[enter]": Object.freeze({ sx: 1, sy: 1, hidden: false }),
    "[enter2]": Object.freeze({ sx: 1.2, sy: 1.2, hidden: false }),
    "[select]": Object.freeze({ sx: 1, sy: 0.5, hidden: false }),
    "[space2]": Object.freeze({ sx: 1, sy: 1, hidden: true }),
});
export const isCursorToken = (t) => Object.prototype.hasOwnProperty.call(CURSOR_POSES, t);

/** Button badges (the game's [triangle] [circle] [cross] [square] tokens) as a 36 x 36 round badge with the shape inside. */
const BADGES = Object.freeze({
    "[triangle]": `<circle cx="18" cy="18" r="16" fill="#0e3a26" stroke="#3ee08a" stroke-width="2"/><path d="M18 9L27 25H9Z" fill="none" stroke="#3ee08a" stroke-width="3" stroke-linejoin="round"/>`,
    "[circle]": `<circle cx="18" cy="18" r="16" fill="#3a0e12" stroke="#f05a5a" stroke-width="2"/><circle cx="18" cy="18" r="8" fill="none" stroke="#f05a5a" stroke-width="3"/>`,
    "[cross]": `<circle cx="18" cy="18" r="16" fill="#0e1e3a" stroke="#5a8af0" stroke-width="2"/><path d="M11 11L25 25M25 11L11 25" fill="none" stroke="#5a8af0" stroke-width="3" stroke-linecap="round"/>`,
    "[square]": `<circle cx="18" cy="18" r="16" fill="#3a0e30" stroke="#f05ac8" stroke-width="2"/><rect x="11" y="11" width="14" height="14" fill="none" stroke="#f05ac8" stroke-width="3"/>`,
});
/** SVG for a button token, or null (unknown token: the caller falls back to the old canvas glyph). */
export const badgeSvg = (tok) => (BADGES[tok] ? `<svg aria-hidden="true" width="100%" height="100%" viewBox="0 0 36 36">${BADGES[tok]}</svg>` : null);
export const hasBadge = (tok) => Object.prototype.hasOwnProperty.call(BADGES, tok);

/** Split a run's text into [{ tok }] and [{ txt }] pieces at the game's bracket tokens ([triangle], [enter]...). */
export function splitTokens(text) {
    const out = [];
    const re = /\[[A-Za-z0-9-]+\]/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
        if (m.index > last) out.push({ txt: text.slice(last, m.index) });
        out.push({ tok: m[0] });
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ txt: text.slice(last) });
    return out;
}
