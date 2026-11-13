// EXPERIMENT: "Go to the other player" in online play (not original game content). Pure, no imports: where to stand when
// you are warped next to a friend. `free(x, y)` is the game's own walkable test for the player's feet (the 12x8 foot box on
// the map's collision grid), so the spot is never inside a wall. Rings of 16 spots around the friend, nearest ring first,
// starting below them (so you appear in front of them, as a follower would); the first walkable spot inside the map wins.
export const GOTO_TIMEOUT_MS = 14000;       // like a co-op invite
const RING_FIRST = 20, RING_STEP = 8, RING_LAST = 140, SPOTS = 16;

/** The spot next to (tx, ty) or null when none is free within RING_LAST pixels. `size` = { w, h } of the map. */
export function pickSpotNear(free, tx, ty, size) {
    const inside = (x, y) => !size || (x >= 0 && y >= 0 && x < size.w && y < size.h);
    for (let r = RING_FIRST; r <= RING_LAST; r += RING_STEP) {
        for (let i = 0; i < SPOTS; i++) {
            const a = Math.PI / 2 + (i * 2 * Math.PI) / SPOTS;       // y grows downward: pi/2 = straight below
            const x = Math.round(tx + r * Math.cos(a)), y = Math.round(ty + r * Math.sin(a));
            if (inside(x, y) && free(x, y)) return { x, y };
        }
    }
    return null;
}
