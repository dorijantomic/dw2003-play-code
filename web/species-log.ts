// web/species-log.js -- which species the player has MET and DEFEATED, and how often. Feeds GLOSSARY > DIGIMON.
//
// Why a new store: nothing recorded it. `battleStarted` carried no names (web/battle.js), `battleWon` carries them but the only
// listener (web/quests.js:247-249) just advances an active quest step. Where it lives: its own localStorage key, like the quest
// layer's `dw.quests.v1` (web/quests.js:27), NOT `dw.fx.v1`. Save slots copy every key but assetMode and the three slots
// (web/save.js:90-110), so the counts travel with each save and a load brings back that slot's counts.
//
// The log keeps NOTHING in memory: every call reads the key, changes it and writes it back. A slot load rewrites localStorage
// under a running game (restoreStorage), and a cached copy would overwrite the loaded counts on the next write.
export const SPECIES_LOG_KEY = "dw.glossary.v1";
const MAX_NAME = 64;
const BAD_NAMES = new Set(["__proto__", "constructor", "prototype"]);

const validName = (n) => typeof n === "string" && n.length > 0 && n.length <= MAX_NAME && !BAD_NAMES.has(n);
const cleanCounts = (o) => {
    const out = {};
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    for (const k of Object.keys(o)) {
        if (!validName(k)) continue;
        const v = o[k];
        if (Number.isInteger(v) && v > 0) out[k] = v;
    }
    return out;
};

function defaultStorage() {
    return typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} };
}

export function createSpeciesLog(storage = defaultStorage()) {
    const read = () => {
        try {
            const j = JSON.parse(storage.getItem(SPECIES_LOG_KEY) || "null");
            if (j && typeof j === "object" && j.v === 1) return { v: 1, met: cleanCounts(j.met), beaten: cleanCounts(j.beaten), owned: cleanCounts(j.owned) };
        } catch { /* damaged: read as empty */ }
        return { v: 1, met: {}, beaten: {}, owned: {} };
    };
    // the `items` part belongs to web/item-log.js: read() leaves it out, write() carries it through untouched
    const keptItems = () => { try { const j = JSON.parse(storage.getItem(SPECIES_LOG_KEY) || "null"); return j && j.v === 1 && j.items && typeof j.items === "object" ? j.items : null; } catch { return null; } };
    const write = (s) => { try { const items = keptItems(); storage.setItem(SPECIES_LOG_KEY, JSON.stringify(items ? { ...s, items } : s)); } catch { /* blocked or full: the count is lost, the game goes on */ } };
    const note = (names, field) => {
        const list = (Array.isArray(names) ? names : []).filter(validName);
        if (!list.length) return false;
        const s = read();
        for (const n of list) {
            s[field][n] = (s[field][n] || 0) + 1;
            if (field === "beaten" && !s.met[n]) s.met[n] = 1;     // a defeat is also a meeting
        }
        write(s);
        return true;
    };
    // owned = species the player has had (party now, each form worn since): a set, so a name is 1 once it is in
    const noteOwned = (names) => {
        const list = (Array.isArray(names) ? names : []).filter(validName);
        const s = read();
        let added = false;
        for (const n of list) if (!s.owned[n]) { s.owned[n] = 1; added = true; }
        if (added) write(s);
        return added;
    };
    return {
        read,
        noteOwned,
        ownedCount: (name) => read().owned[name] || 0,
        noteMet: (names) => note(names, "met"),
        noteBeaten: (names) => note(names, "beaten"),
        metCount: (name) => read().met[name] || 0,
        beatenCount: (name) => read().beaten[name] || 0,
        totals() { const s = read(); return { met: Object.keys(s.met).length, beaten: Object.keys(s.beaten).length }; },
    };
}

/** Wire the log to the game's event bus (web/gameEvents.js `on`). Returns a function that unhooks both. */
export function installSpeciesLog({ on, log }) {
    const offs = [
        on("battleStarted", (e) => { log.noteMet(e?.enemies); }),
        on("battleWon", (e) => { log.noteBeaten(e?.enemies); }),
        // 2 vs 2 fights (web/mpbattle.js) send their own events: its battleWon is gated for quests and must stay so
        on("fightSeen", (e) => { log.noteMet(e?.enemies); }),
        on("fightBeaten", (e) => { log.noteBeaten(e?.enemies); }),
        on("formWorn", (e) => { log.noteOwned([e?.name]); }),
    ];
    return () => { for (const off of offs) off?.(); };
}
