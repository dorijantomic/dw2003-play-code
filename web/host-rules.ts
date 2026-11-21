// web/host-rules.js -- the host's battle settings that every player in the room plays by (multiplayer). Pure: no DOM, no
// window, no network. Used by the relay (server/room-core.mjs: cleanRules) and by the game (web/ambience.js: the override layer).
//
// Rule for the key list: a setting is here when it changes how a fight PLAYS or how often fights come. Looks (boss size,
// giant mode, battle camera/backdrops), sound (boss music), field warnings (omen, enemy tells: they show information, they
// decide nothing) and info pages (blast ladder) are not.
import { DIAL_MODES } from "./encounter-dial.js";
import type { AmbienceSettings } from "./types/ambience.js";

/** Key -> kind of value. "bool" = a switch, "dial" = one of DIAL_MODES, "speed" = a number 1..3 (the Faster battles slider). */
export const HOST_RULES = Object.freeze({
    battlespeed: "bool",         // OPTIONS Battle speed (x1 = off): how fast a fight runs
    battleSpeed: "speed",        //   ... and its value
    encounterdial: "bool",       // OPTIONS Random fights: how often wild fights come
    encounterDialMode: "dial",   //   ... and its value
    fusionbosses: "bool",        // Kimeramon + Machinedramon fuse into Millenniummon: a different boss fight
    bossphases: "bool",          // a boss changes its moves as its health drops
    aishift: "bool",             // enemy every-Nth specials come one turn early
    practice2v2: "bool",         // wild fights become 2 vs 2 with a computer partner
});
export const HOST_RULE_KEYS = Object.freeze(Object.keys(HOST_RULES));

function cleanValue(kind, v) {
    if (kind === "bool") return typeof v === "boolean" ? v : undefined;
    if (kind === "dial") return DIAL_MODES.includes(v) ? v : undefined;
    if (kind === "speed") return typeof v === "number" && Number.isFinite(v) ? Math.min(3, Math.max(1, Math.round(v * 4) / 4)) : undefined;
    return undefined;
}

/** Anything -> a plain object with only the known keys that hold a valid small value. Never throws. */
export function cleanRules(o) {
    const out = {};
    if (!o || typeof o !== "object" || Array.isArray(o)) return out;
    for (const k of HOST_RULE_KEYS) {
        const v = cleanValue(HOST_RULES[k], o[k]);
        if (v !== undefined) out[k] = v;
    }
    return out;
}

/** My current values for the rule keys (what a host sends). */
export function pickRules(fx) {
    const raw = {};
    for (const k of HOST_RULE_KEYS) raw[k] = HOST_RULES[k] === "bool" ? fx?.[k] === true : fx?.[k];
    return cleanRules(raw);
}

/**
 * The override layer. `fx` is the live settings object the game reads (window.__fx). While rules are applied, the rule
 * keys in `fx` hold the host's values; the saver must skip them (canSave), so the player's own saved values are never
 * written over and come back unchanged on clear().
 *   apply(rules)  lock the keys in rules (cleaned) to the host's values; keys of an earlier apply no longer there go back
 *   reimpose()    put the host's values back after anything wrote to fx (a preset, a profile, All on)
 *   clear()       leave the room: every locked key returns to the player's own value
 *   locked(key)   true while the host decides this key
 *   canSave(key)  false for a locked key
 */
export function createRuleOverride(fx: AmbienceSettings) {
    const own = new Map();       // key -> the player's own value, taken the moment the key was locked
    const host = new Map();      // key -> the host's value
    const unlock = (k) => { fx[k] = own.get(k); own.delete(k); host.delete(k); };
    return {
        apply(rules) {
            const next = cleanRules(rules);
            for (const k of [...host.keys()]) if (!(k in next)) unlock(k);
            for (const [k, v] of Object.entries(next)) {
                if (!own.has(k)) own.set(k, fx[k]);
                host.set(k, v);
                fx[k] = v;
            }
        },
        reimpose() { for (const [k, v] of host) fx[k] = v; },
        clear() { for (const k of [...host.keys()]) unlock(k); },
        locked: (k) => host.has(k),
        canSave: (k) => !host.has(k),
        keys: () => [...host.keys()],
    };
}
