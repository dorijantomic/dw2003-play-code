// EXPERIMENT: a tiny event bus so optional layers (quests, later co-op) can hear what the game does
// without the game depending on them. Emitting with no listener costs nothing and changes nothing.
const listeners = new Map();

// Each event name has its own payload shape, so a listener is typed where it subscribes.
export function on<P>(name: string, fn: (payload: P) => void) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name).delete(fn);
}

export function emit(name: string, payload?: unknown) {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
        try { fn(payload); } catch (e) { console.warn(`[events] ${name} listener failed:`, e); }   // a broken layer never breaks the game
    }
}
