// The Second Job (F2 -> Extras -> "Quests: pick which job to take"): the offer loop's filters, written once.
//
// web/quests.js walks every quest in file order and hands out the first def whose status is "available", whose
// offer is this character on this map, and which the player has not already declined. Every other job the same
// person is carrying stays hidden until the first one is taken. These helpers are pure (no DOM, no fs): the host
// reads the whole list from them, and asks "Which job?" only when more than one really waits and the F2 switch
// is on. One job means exactly the old behaviour, with no extra question.
//
//   offersAt(defs, npcId, mapId, { statusOf, declined, labFocus, canon }) -> defs in file order, filtered
//   offerLabels(defs, n)  -> the titles clipped the way the game's own clip() does: n-1 characters + "."
//   pageCount(n)          -> pages of four labels, the size pagedPick() shows
const clipTitle = (s, n) => (s.length > n ? s.slice(0, n - 1) + "." : s);

/** The jobs this person could hand out in this place right now, in file order (the offer loop's exact filters). */
export function offersAt(defs, npcId, mapId, { statusOf = () => "available", declined, labFocus = null, canon = (m) => m } = {}) {
    const out = [];
    for (const d of defs ?? []) {
        if (labFocus && d.id !== labFocus) continue;                       // the lab asked for one quest in particular
        if (statusOf(d) !== "available" || !d.offer) continue;
        if (d.offer.npc !== npcId) continue;
        if (!d.offer.maps.some((m) => canon(m) === canon(mapId))) continue; // night/story variants count as the same place
        if (declined && typeof declined.has === "function" && declined.has(d.id)) continue;   // "not now" this session
        out.push(d);
    }
    return out;
}

/** The choice rows: each title clipped to `n` characters the way quests.js clip() writes it. */
export function offerLabels(defs, n = 28) {
    return (defs ?? []).map((d) => clipTitle(String(d.title ?? ""), n));
}

/** Pages of four labels (the game's own choice widget holds four rows plus its More/Back rows). */
export function pageCount(n) {
    return Math.ceil(n / 4);
}
