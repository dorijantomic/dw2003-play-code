// web/glossary-model.js -- cursor, list window, page and card reveal of GLOSSARY > DIGIMON. Pure.
// Rules: the cursor does not wrap (the pause list's rule, ddw3 pause-menu-screen-tree:108-117); a page change or a new species
// restarts the card reveal and resets page-2 scroll.
export const VISIBLE = 8;          // species rows in the list window (its first line is the counts)
export const REVEAL_EVERY = 2;     // frames per card line (the album's cell-by-cell flip, one every 2 frames)

export function createGlossaryModel({ count }) {
    const last = Math.max(0, (count | 0) - 1);
    let index = 0, top = 0, page = 0, line = 0, shown = 0;
    const settle = () => {
        if (index < top) top = index; else if (index >= top + VISIBLE) top = index - VISIBLE + 1;
        top = Math.max(0, Math.min(top, Math.max(0, last + 1 - VISIBLE)));
    };
    const changed = () => { line = 0; shown = 0; };
    const go = (to) => {
        const t = Math.max(0, Math.min(last, to));
        if (t === index || count <= 0) return false;
        index = t; settle(); changed();
        return true;
    };
    return {
        index: () => index, top: () => top, page: () => page, line: () => line,
        move: (d) => go(index + d),
        jump: (d) => go(index + d),
        setPage(p, allowed = true) { if (p === page || (p === 1 && !allowed)) return false; page = p; changed(); return true; },
        scrollLine(d, lineCount) {
            const t = Math.max(0, Math.min(Math.max(0, lineCount - 1), line + d));
            if (t === line) return false;
            line = t;
            return true;
        },
        resetCard: changed,
        reveal: (total) => Math.min(total, Math.floor(shown / REVEAL_EVERY)),
        tickReveal() { shown++; },
    };
}
