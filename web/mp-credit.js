// EXPERIMENT: the shared kill — a co-op win counts for both tamers' quests.
//
// The game's one-on-one battle tells the quest layer about a win with the `battleWon` event (web/gameEvents.js).
// A many-vs-many co-op fight (web/mpbattle.js) has its own ending, so this little pure module builds the same
// event for it: the fight's enemy names (a quest's "defeat" step matches its species by name) and the fight's
// own map and screen. Both machines build it from the same values — the host's foes and the host's map ride the
// fight's `setup` packet — so both tamers' quests tick for the one fight.
//
// Nothing here touches the DOM, storage or the network; the toggle and the emit live in mpbattle.js.

/**
 * The `battleWon` event of a co-op fight, or null when no foe carries a name (there is then no species to credit).
 * @param {Array<{name?: string}|string>} foes  the fight's foes, as the setup packet carries them
 * @param {{mapId?: string|null, screenId?: number|null}} [at]  the fight's map and screen
 */
export function winEvent(foes, { mapId = null, screenId = null } = {}) {
    const enemies = (Array.isArray(foes) ? foes : [])
        .map((f) => (typeof f === "string" ? f : f?.name))
        .filter((n) => typeof n === "string" && n.length > 0);
    if (!enemies.length) return null;
    return { enemies, mapId: mapId ?? null, screenId: screenId ?? null };
}

/** Are these the same fight's event? (What the host built and what the guest built from the packet must agree.) */
export function sameEvent(a, b) {
    if (!a || !b) return !a && !b;
    const ae = a.enemies ?? [], be = b.enemies ?? [];
    if (ae.length !== be.length) return false;
    for (let i = 0; i < ae.length; i++) if (ae[i] !== be[i]) return false;
    return (a.mapId ?? null) === (b.mapId ?? null) && (a.screenId ?? null) === (b.screenId ?? null);
}
