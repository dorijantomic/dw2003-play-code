// EXPERIMENT: multiplayer rejoin, the fight side (not original game content). Pure rules, no DOM, no imports: node tests them
// (tests/mpbattle-pause.test.js) and web/mpbattle.js wires them in.
//
// PAUSE (referee): while a guest is away (their link dropped, the relay kept their seat) the referee does not start the next
// action. `gate(name, fn)` is called at the top of nextTurn and foeTurn: when someone is away it remembers `fn` (once per name)
// and says "parked"; when the last one is back or gone, `release()` hands the remembered calls back to run. Each away guest has a
// timer; when it ends, onExpire(id) runs (the referee marks them fled, as it always did for a left player).
// LINK (any player): my own link dropped, or the referee's did. One timer at a time: 60 s waiting for the link, or 10 s
// waiting for the referee's snapshot after my link came back. When it ends, onEnd() closes the fight cleanly.
export const AWAY_MS = 60000;          // how long a fight waits for a dropped player
export const BACK_WAIT_MS = 10000;     // how long a returned guest waits for a snapshot before leaving the fight
export const SELF = "self";            // the referee's own dropped link, held in the pause with no timer
export const LINK_TEXT = { lost: "Connection lost. Reconnecting...", ref: "Waiting for the referee...", back: "Reconnected. Waiting for the fight..." };

const real = { now: () => Date.now(), setT: (fn, ms) => setTimeout(fn, ms), clearT: (h) => clearTimeout(h) };

export function createPause({ now = real.now, setT = real.setT, clearT = real.clearT, awayMs = AWAY_MS } = {}) {
    const away = new Map();            // id -> { at, timer }
    let parked = [];                   // [{ name, fn }]
    return {
        get size() { return away.size; },
        has: (id) => away.has(id),
        /** Mark `id` away. onExpire(id) runs after awayMs; onExpire null = held until remove() (the referee's own link). False if already away. */
        add(id, onExpire) {
            if (away.has(id)) return false;
            const e = { at: now(), timer: 0 };
            if (onExpire) e.timer = setT(() => { if (away.get(id) !== e) return; away.delete(id); onExpire(id); }, awayMs);
            away.set(id, e);
            return true;
        },
        remove(id) { const e = away.get(id); if (!e) return false; clearT(e.timer); away.delete(id); return true; },
        /** True = someone is away: `fn` is remembered (one per name) and the caller must return. False = go on. */
        gate(name, fn) {
            if (!away.size) return false;
            parked = parked.filter((p) => p.name !== name);
            parked.push({ name, fn });
            return true;
        },
        /** null while someone is still away; otherwise the remembered calls (minus `covered` names), and the memory is emptied. */
        release({ covered = [] } = {}) {
            if (away.size) return null;
            const out = parked.filter((p) => !covered.includes(p.name)).map((p) => p.fn);
            parked = [];
            return out;
        },
        /** For the snapshot: { ids, s } (the away guests and the least seconds left), or null. The referee's own SELF is not listed. */
        view() {
            const ids = [...away.keys()].filter((id) => id !== SELF);
            if (!ids.length) return null;
            const left = Math.min(...ids.map((id) => awayMs - (now() - away.get(id).at)));
            return { ids, s: Math.max(0, Math.ceil(left / 1000)) };
        },
        clear() { for (const e of away.values()) clearT(e.timer); away.clear(); parked = []; },
    };
}

/** "Waiting for Ana (45s)". players = the snapshot's S.P rows ({ id, pn }). */
export function pzText(pz, players = []) {
    const names = pz.ids.map((id) => players.find((p) => p.id === id)?.pn ?? "player");
    return `Waiting for ${names.join(", ")} (${pz.s}s)`;
}

export function createLink({ onEnd, setT = real.setT, clearT = real.clearT } = {}) {
    let cur = null;
    const stop = () => { if (cur) clearT(cur.timer); cur = null; };
    const start = (text, ms) => { stop(); const me = { text, timer: 0 }; me.timer = setT(() => { if (cur !== me) return; cur = null; onEnd(); }, ms); cur = me; };
    return {
        get text() { return cur ? cur.text : null; },
        get active() { return !!cur; },
        lost: () => start(LINK_TEXT.lost, AWAY_MS),            // my own link dropped
        refWait: () => start(LINK_TEXT.ref, AWAY_MS),          // the referee's link dropped
        reconnected: () => start(LINK_TEXT.back, BACK_WAIT_MS),// my link is back: the referee must answer with a snapshot soon
        clear: stop,
    };
}
