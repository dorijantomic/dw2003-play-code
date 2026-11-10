// web/pause-extra-rows.js -- which extra rows the pause home list gets after the disc's own, in order.
// Pure. The list itself is engine/dw3/ui/pause-root-session.ts (seed.extraRows); web/game.js hands this to
// web/status-translated.js as opts.extraRows.
//
// Pause strings use letters, digits and spaces only (engine/dw3/ui/pause-root-session.ts, PauseSeed.extraRows), and a row
// label is six to eight letters so it fits the panel. The book's name is still open (GLOSSARY, DIGIDEX or BOOK): it is
// written once, here.

/** The row labels of the two books. */
export const BOOK_LABELS = Object.freeze({ glossary: "GLOSSARY", options: "OPTIONS" });

/** True when `label` is something the pause list's text codec can draw. */
export const pauseLabelOk = (label) => /^[A-Za-z0-9 ]{1,12}$/.test(String(label));

/**
 * `quests` is what web/quests.js questsPauseRow() returns ({ label } or null); `fx` is the F2 switch object. A book row is
 * there only while its dev switch is exactly true (default off: web/ambience.js EXPERIMENTAL).
 */
export function pauseExtraRows({ quests = null, fx = null } = {}) {
    const rows = [];
    if (quests && pauseLabelOk(quests.label)) rows.push({ label: quests.label, opens: "quests" });
    if (fx?.glossary === true) rows.push({ label: BOOK_LABELS.glossary, opens: "glossary" });
    if (fx?.options === true) rows.push({ label: BOOK_LABELS.options, opens: "options" });
    return rows;
}
