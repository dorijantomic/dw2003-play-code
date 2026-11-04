// EXPERIMENT: a Server Champ night among the friends in one room (not original game content).
//
// The game's own guide, in the Online Center's Digimon Online text: "Server Champs can battle with others to
// be the next World Champ", and the stated goal "to become the strongest of the over 200,000 players"
// (docs/research/reference/dw3-systems-reference.md, `Server Tournament / Server Champ / World Champ`). The
// disc gives you nobody to battle; this is that evening with the people in your room.
//
// The rules, all ours: 2..8 tamers, single elimination, best of three fights, byes only in the first round and
// only as many as the bracket needs. The host is the only one who opens a night, calls a fight or reports a
// result (the same authority model as the fight referee, docs/multiplayer-plan.md); a tamer may drop out, which
// counts as a loss and cannot be undone. The last tamer standing is the Server Champ until the next night.
//
// Pure and DOM-free, so `node --test tests/mp-league.test.js` decides the rules. The room keeps ONE of these
// objects (server/room-core.mjs, `lg`); the dock only reads the state it is sent (web/mpsocial.js).
//
//   newLeague({ ids, bestOf = 3 })   a night drawn: the first round with its byes, the numbers of the bracket
//   nextPairing(lg)                  the fight to call now; null between rounds (ask again for the next round)
//                                    and null when the night is won
//   report(lg, winner, games)        the host reports one fight's games so far, e.g. [a, b, a]: who won each
//   forfeit(lg, id)                  that tamer leaves the night; the opponent goes through, no re-entry
//   standings(lg)                    every tamer, best first (the champion at the top)
//   champ(lg)                        the winner's id, null until the final is won
//
// A league object is plain JSON (it travels in one relay message, so it stays small): short keys on a match
// are `a`/`b` the two tamers, `w` its winner, `g` the game winners in order, and the flags `bye` (a first-round
// bye), `wo` (a walkover) and `dead` (nobody left to play it).

export const MIN_TAMERS = 2;
export const MAX_TAMERS = 8;
export const DEFAULT_BEST_OF = 3;

const isTamer = (id) => Number.isInteger(id) && id > 0;
const has = (list, id) => Array.isArray(list) && list.includes(id);

/** A new night: the first round drawn (with the byes the bracket needs) and the folder closed until its first fight. */
export function newLeague({ ids, bestOf = DEFAULT_BEST_OF } = {}) {
    const list = Array.isArray(ids) ? ids.slice() : [];
    if (list.length < MIN_TAMERS || list.length > MAX_TAMERS) throw new Error(`a night needs ${MIN_TAMERS}..${MAX_TAMERS} tamers`);
    if (!list.every(isTamer) || new Set(list).size !== list.length) throw new Error("tamers are distinct positive ids");
    if (!Number.isInteger(bestOf) || bestOf < 1 || bestOf % 2 === 0) throw new Error("best of an odd number of fights");

    const size = 2 ** Math.ceil(Math.log2(list.length));      // the bracket the next power of two gives
    const byes = size - list.length;                          // slots with nobody opposite: first round only
    const first = [];
    let i = 0;
    for (let m = 0; m < size / 2; m++) {
        if (m < byes) first.push({ a: list[i++], b: null, w: list[i - 1], g: [], bye: true });
        else first.push({ a: list[i++], b: list[i++], w: null, g: [] });
    }
    return {
        bestOf,
        ids: list,
        size,
        byes,
        roundsPlanned: Math.ceil(Math.log2(list.length)),
        matches: list.length - 1,                             // single elimination: one fewer fight than tamers
        dropped: [],                                          // who left the night, in order
        r: 0,                                                 // the round being played
        phase: "play",                                        // "play" | "break" (between rounds) | "done"
        asked: false,                                         // the round is over and nextPairing has said so once
        champ: null,
        rounds: [first],
    };
}

const out = (lg, id) => id == null || has(lg.dropped, id);

/** Mark the round complete, or the whole night when it was the last one. Called after every decided fight. */
function settle(lg) {
    const round = lg.rounds[lg.r] ?? [];
    if (!round.length || round.some((m) => m.w == null && !m.dead)) return;
    if (lg.r >= lg.roundsPlanned - 1) {
        lg.phase = "done";
        lg.champ = round[0]?.w ?? null;
    } else { lg.phase = "break"; lg.asked = false; }
}

/** Pair the winners of the round just played; a tamer who left hands the fight over (a walkover). */
function drawNextRound(lg) {
    const winners = (lg.rounds[lg.r] ?? []).map((m) => m.w ?? null);
    const next = [];
    for (let i = 0; i < winners.length; i += 2) {
        const a = winners[i] ?? null, b = winners[i + 1] ?? null;
        if (a == null && b == null) next.push({ a, b, w: null, g: [], dead: true });
        else if (a == null || b == null) next.push({ a, b, w: a ?? b, g: [], wo: true });
        else if (out(lg, a) || out(lg, b)) next.push({ a, b, w: out(lg, a) ? b : a, g: [], wo: true });
        else next.push({ a, b, w: null, g: [] });
    }
    lg.rounds.push(next);
    lg.r += 1;
    lg.phase = "play";
    settle(lg);
}

/**
 * The fight to call now, or null. Null means "no fight on the table": either the round is over (the next call
 * draws the next round) or the whole night is won.
 */
export function nextPairing(lg) {
    if (!lg || lg.phase === "done") return null;
    if (lg.phase === "break") {
        if (!lg.asked) { lg.asked = true; return null; }      // between rounds: null once ...
        lg.asked = false;
        drawNextRound(lg);                               // ... then the next round is drawn
    }
    // resolve the walkovers the bracket picked up (a tamer left the night), then offer the first real fight
    const round = lg.rounds[lg.r] ?? [];
    for (let i = 0; i < round.length; i++) {
        const m = round[i];
        if (m.w != null || m.dead) continue;
        const aOut = out(lg, m.a), bOut = out(lg, m.b);
        if (aOut || bOut) {
            if (aOut && bOut) m.dead = true;
            else { m.w = aOut ? m.b : m.a; m.wo = true; }
            settle(lg);
            return nextPairing(lg);                          // keep looking (the round may be over now)
        }
        return { r: lg.r, m: i, a: m.a, b: m.b, game: m.g.length + 1, bestOf: lg.bestOf };
    }
    settle(lg);
    if (lg.phase === "done") return null;
    lg.phase = "break";                                      // between rounds: null once, then the next round
    return null;
}

/**
 * The host says how a fight has gone: `games` is one entry per fight played so far, each the id of who won it
 * (e.g. [a, b, a] = a lost, won, won: 2-1). A best-of-three fight ends when a side has two games. Reports are
 * refused when they cannot be true (a fourth game, a game after the fight was over, a winner who did not win).
 */
export function report(lg, winner, games) {
    if (!lg || lg.phase !== "play") return { refused: lg?.phase === "done" ? "done" : "no_fight" };
    const round = lg.rounds[lg.r] ?? [];
    const index = round.findIndex((m) => m.w == null && !m.dead && !out(lg, m.a) && !out(lg, m.b));
    if (index < 0) return { refused: "no_fight" };
    const m = round[index];
    if (winner !== m.a && winner !== m.b) return { refused: "not_in_match" };
    if (out(lg, winner)) return { refused: "dropped" };
    const list = Array.isArray(games) ? games.slice(0, lg.bestOf + 1) : [];
    if (!list.length) return { refused: "no_games" };
    if (list.length > lg.bestOf) return { refused: "too_many_games" };
    if (!list.every((g) => g === m.a || g === m.b)) return { refused: "not_in_match" };
    if (winner !== list[list.length - 1]) return { refused: "wrong_winner" };
    const need = Math.floor(lg.bestOf / 2) + 1;
    let wa = 0, wb = 0;
    for (const g of list) {
        if (wa >= need || wb >= need) return { refused: "already_over" };   // a game after the fight was decided
        if (g === m.a) wa++; else wb++;
    }
    const ended = wa >= need || wb >= need;
    if (ended && (wa > wb ? m.a : m.b) !== winner) return { refused: "wrong_winner" };
    m.g = list;
    if (ended) m.w = winner;
    settle(lg);
    return { ok: true, ended, a: m.a, b: m.b, winner: ended ? m.w : null, games: m.g.slice(), r: lg.r, m: index };
}

/** A tamer leaves the night: their open fight goes to the opponent, and no later pairing calls them again. */
export function forfeit(lg, id) {
    if (!lg || !has(lg.ids, id)) return { refused: "unknown" };
    if (has(lg.dropped, id)) return { refused: "dropped" };
    lg.dropped.push(id);
    let to = null;
    for (const m of lg.rounds[lg.r] ?? []) {
        if (m.w != null || m.dead || (m.a !== id && m.b !== id)) continue;
        const other = m.a === id ? m.b : m.a;
        if (out(lg, other)) m.dead = true;
        else { m.w = other; m.wo = true; to = other; }
    }
    settle(lg);
    return { ok: true, id, to };
}

/** Everyone in the night, best first: the champion, then those still standing, then by the round they left in. */
export function standings(lg) {
    if (!lg) return [];
    const rows = lg.ids.map((id) => {
        let wins = 0, losses = 0, games = 0, round = -1;
        lg.rounds.forEach((matches, r) => {
            for (const m of matches) {
                if (m.bye || (m.a !== id && m.b !== id)) continue;
                round = Math.max(round, r);
                games += m.g.filter((g) => g === id).length;
                if (m.w === id) wins++;
                else if (m.w != null || m.dead) losses++;
            }
        });
        const dropped = has(lg.dropped, id);
        const champion = lg.champ === id;
        return { id, wins, losses, games, round, dropped, champ: champion, out: !champion && (dropped || losses > 0 || lg.phase === "done") };
    });
    rows.sort((x, y) => (y.champ - x.champ) || ((x.out ? 1 : 0) - (y.out ? 1 : 0)) || (y.round - x.round) || (y.wins - x.wins) || (x.id - y.id));
    return rows;
}

/** The Server Champ, or null until the final is won. */
export function champ(lg) {
    return lg?.champ ?? null;
}

// ------------------------------------------------------------ the wire form
// The room sends the bracket to every peer on every change, so it must stay under the relay's 600-byte message
// cap even with three- or four-digit tamer ids. A night travels packed: short keys on the league, and each match
// as [a, b, winner, ...gameWinners] (a null b is a bye or an empty slot; a match with no tamer left is
// [null, null]). The flags come back on unpack, so the dock and the room work with the same readable object.
export function packLeague(lg) {
    if (!lg) return null;
    return {
        b: lg.bestOf,
        i: lg.ids,
        d: lg.dropped,
        r: lg.r,
        f: lg.phase,
        k: lg.asked ? 1 : 0,
        c: lg.champ,
        R: lg.rounds.map((round) => round.map((m) => [m.a ?? null, m.b ?? null, m.w ?? null, ...(m.g ?? [])])),
    };
}

export function unpackLeague(wire) {
    if (!wire || !Array.isArray(wire.i)) return null;
    const n = wire.i.length;
    const size = 2 ** Math.ceil(Math.log2(n));
    const lg = {
        bestOf: wire.b ?? DEFAULT_BEST_OF,
        ids: wire.i.slice(),
        size,
        byes: size - n,
        roundsPlanned: Math.ceil(Math.log2(n)),
        matches: n - 1,
        dropped: Array.isArray(wire.d) ? wire.d.slice() : [],
        r: wire.r ?? 0,
        phase: wire.f ?? "play",
        asked: !!wire.k,
        champ: wire.c ?? null,
        rounds: [],
    };
    for (const round of Array.isArray(wire.R) ? wire.R : []) {
        lg.rounds.push(round.map((row) => {
            const [a = null, b = null, w = null, ...g] = Array.isArray(row) ? row : [];
            const m = { a, b, w, g };
            if (b == null && a != null) m.bye = true;                       // a first-round bye
            else if (a == null && b == null) m.dead = true;                 // nobody left to play it
            else if (w != null && g.length === 0) m.wo = true;              // the opponent left: a walkover
            return m;
        }));
    }
    return lg;
}
