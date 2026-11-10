// WHAT PLAYERS GET FOR EACH F2 SWITCH (web/ambience.js FX_GROUPS), decided in this one place. Pure: no DOM.
//
//   "in"   in the game; on at the start; the player may switch it (OPTIONS).
//   "auto" in the game; always on; there is no switch.
//   "out"  not for players: hidden, always off in the installed copy.
//
// The installed copy (the packaged release) is told apart from the owner's own PC by a marker file
// the release workflow writes: web/installed-build.js sets window.__dwInstalled = true. The file is
// not in git, so a checkout (port 8090, or launcher/dw2003.py --port N from the checkout) never has it.
//
// Both builds start with "in" and "auto" on and "out" off. On the owner's PC every switch stays
// changeable. In the installed copy "out" is forced off and "auto" forced on, whatever the saved
// settings, URL flags or window setters say (lockShipped).

const IN = [
    "sway", "grass", "grasspush", "water", "reflect", "mirror", "wetlook", "seam",
    "rain", "rainwater", "snow", "sand", "lightning", "gusts", "breath", "frost", "screenfx",
    "tod", "nightlight", "clouds", "lamps", "lightpool", "lightreveal", "indoor", "fog", "shafts", "heat", "sparkle", "pollen",
    "leaves", "fireflies",
    "quests", "questtriggers", "questemotes", "questplacecard", "encounterdial", "battlespeed", "questsecondjob",
    "steps", "puddles",
    "sound", "ambience", "musicfx", "footsteps",
];
const AUTO = ["widefield", "battlewide", "uisharp", "smartcam", "mpbubbles", "mpcredit", "glossary", "options", "dw2motion"];
const OUT = [
    "devils", "villagers", "hd2d", "battleatmos", "mount", "mountseat", "fusionbosses", "bossphases", "bossmusic", "bossgrows",
    "giantmode", "fieldwar", "omen", "practice2v2", "enemytells", "aishift", "ownclips", "smoothanim", "battlepano",
    "toonoutline", "toonshade", "softalpha", "blastladder", "planner", "movetheatre", "cutcontent", "stageselect", "soundtest",
    "soundtrack", "cinema", "langdesk", "damagelab", "itemsource", "gymmap", "silence", "showfps", "itemrulebook", "cursorbook", "weaponlab",
    "bitledger", "savexray", "saveverify", "replay", "redirectview", "arrivallab", "anglermap", "serverchamp", "chatqueue",
];

export const SHIP = Object.freeze(Object.fromEntries([
    ...IN.map((k) => [k, "in"]), ...AUTO.map((k) => [k, "auto"]), ...OUT.map((k) => [k, "out"]),
]));
export const SHIP_IN = Object.freeze([...IN]);
export const SHIP_AUTO = Object.freeze([...AUTO]);
export const SHIP_OUT = Object.freeze([...OUT]);

/** "in" | "auto" | "out" for a switch key, or null for anything else (sliders, modes...). */
export function shipClass(key) {
    return Object.prototype.hasOwnProperty.call(SHIP, key) ? SHIP[key] : null;
}
/** What the installed copy forces for a key: true (auto), false (out), or null (in / not a switch: the player decides). */
export function shipForced(key) {
    const c = shipClass(key);
    return c === "auto" ? true : c === "out" ? false : null;
}

/** Is this the installed (packaged) copy? Only the workflow-written marker says yes. */
export function isInstalledBuild(win = typeof window !== "undefined" ? window : null) {
    return !!win && win.__dwInstalled === true;
}

/** Defaults for both builds: "in" and "auto" on, "out" off. Writes into `fx`. */
export function applyShipDefaults(fx) {
    for (const [k, c] of Object.entries(SHIP)) fx[k] = c !== "out";
    return fx;
}

/** The one-time upgrade: an old save may have an "in" key off; put every "in" key back to its default (on). */
export function applyUpgradeDefaults(fx) {
    for (const k of IN) fx[k] = true;
    return fx;
}
export const UPGRADE_MARK_KEY = "dw.fx.shiplist";
export function needsUpgrade(markValue) { return !markValue; }

/**
 * Installed copy: make every "out" key read false and every "auto" key read true, for good. The key stays
 * on the object (so spreads and saves see the forced value) but a write is silently ignored, so
 * `fx.k = ...`, Object.assign, window.__setFx / __setFxMany / presets / "All on" can not change it.
 */
export function lockShipped(fx) {
    for (const [k, c] of Object.entries(SHIP)) {
        if (c === "in") continue;
        const v = c === "auto";
        Object.defineProperty(fx, k, { get: () => v, set() { }, enumerable: true, configurable: false });
    }
    return fx;
}

/**
 * After the saved settings are merged into `fx`: in the installed copy, apply the one-time upgrade (when
 * `markValue`, the stored marker, is empty) and then lock. Returns { upgraded } so the caller can store the
 * marker and the new settings. On the owner PC nothing changes (saved settings are respected).
 */
export function finishShipLoad(fx, { installed = false, markValue = null } = {}) {
    if (!installed) return { upgraded: false, installed: false };
    const upgraded = needsUpgrade(markValue);
    if (upgraded) applyUpgradeDefaults(fx);
    lockShipped(fx);
    return { upgraded, installed: true };
}
