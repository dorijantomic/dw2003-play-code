// web/options-model.js -- the OPTIONS screen's rows, pages and cursor. Pure: no DOM, no window; the settings object is
// passed in as a store { get(key), setMany({key: value}) } (web/ambience.js: window.__fx, window.__setFxMany).
//
// Same store and same keys as the F2 panel (localStorage "dw.fx.v1", web/ambience.js). OPTIONS adds no key of its own except
// the two volumes (musicVolume, soundVolume; 1 = today's gain). Every one of the 98 FX_GROUPS keys has a home in OPTIONS,
// in the Detail preset, on the EFFECTS page, or on F2 only (OPTIONS_HOME below; pinned by tests/options-model.test.js).
// OPTIONS shows only what players get (web/ship-list.js): no row for a switch that is "auto" or "out"; F2 covers those.
import { SPEEDS } from "./battle-speed.js";
import { DETAIL_OFF_LOW, DETAIL_OFF_MEDIUM } from "./detail-presets.js";
import { shipClass } from "./ship-list.js";

// ---------------------------------------------------------------- key homes
/** The 35 effect keys the one Detail choice sets (web/ambience.js groups Terrain, Weather, Atmosphere, Life, Ground, Screen). */
export const DETAIL_KEYS = Object.freeze([
    "sway", "grass", "grasspush", "water", "reflect", "mirror", "wetlook", "seam",
    "rain", "rainwater", "snow", "sand", "lightning", "gusts", "breath", "frost", "screenfx",
    "tod", "nightlight", "clouds", "lamps", "lightpool", "lightreveal", "indoor", "fog", "shafts", "heat", "sparkle", "pollen",
    "leaves", "fireflies", "devils", "steps", "puddles", "uisharp",
]);
export const DETAIL_LEVELS = Object.freeze(["original", "low", "medium", "high"]);
export const DETAIL_LABELS = Object.freeze(["Original", "Low", "Medium", "High"]);
/** Keys each level switches OFF. Original = all 35 (the PS1 look); High = none. Low and Medium come from the measurement (tools/measure_fx_cost.mjs). */
export const DETAIL_OFF = Object.freeze({ original: DETAIL_KEYS, low: DETAIL_OFF_LOW, medium: DETAIL_OFF_MEDIUM, high: Object.freeze([]) });
/** fx.quality (weather-particle density, web/ambience.js QUALITY) that goes with each level. */
export const DETAIL_QUALITY = Object.freeze({ original: "low", low: "low", medium: "medium", high: "high" });

/** The groups of invented features. A row is ON when any of its keys is on; moving it sets all of them. Only SHOWN_EXTRAS get an OPTIONS row; the rest are "out" or "auto" for players and live on F2. */
export const EXTRA_GROUPS = Object.freeze([
    { id: "quests", label: "Quests", keys: ["quests", "questtriggers", "questemotes", "questplacecard", "questsecondjob"], help: "Extra quests. Scenes start when you step on certain spots." },
    { id: "mount", label: "Mount", keys: ["mount", "mountseat"], help: "Ride a Digimon that a quest gives you. You sit on its back." },
    { id: "boss", label: "Boss ideas", keys: ["fusionbosses", "bossphases", "bossmusic", "bossgrows"], help: "Bosses fuse, change tactics at low health, change music and grow." },
    { id: "giant", label: "Giant mode", keys: ["giantmode"], help: "Digimon in battle can be drawn bigger or smaller than usual." },
    { id: "battleideas", label: "Battle ideas", keys: ["fieldwar", "omen", "enemytells", "aishift"], help: "Enemy countdowns, fields that change element, a warning before wild fights." },
    { id: "battlemotion", label: "Battle motion", keys: ["ownclips", "dw2motion", "smoothanim"], help: "Digimon show their own attack moves, and battle animation looks smoother." },
    { id: "camera", label: "Camera and look", keys: ["smartcam", "battlepano", "softalpha", "battleatmos"], help: "Camera dodges rocks, painted backdrops, smooth edges, battle sky and weather." },
    { id: "villagers", label: "Villagers", keys: ["villagers"], help: "Extra villagers walk around in towns and cities." },
    { id: "online", label: "Online", keys: ["serverchamp", "mpbubbles", "mpcredit"], help: "League nights, reaction bubbles, and co-op wins that count for quests." },
]);
/** One-time reset: older builds let the Battle ideas row switch practice2v2 on, which made every wild fight 2 vs 2. Returns true when practice2v2 must be turned off once (done = the stored marker). */
export function needsPractice2v2Reset(fx, done) { return !done && !!fx?.practice2v2; }
export const SHOWN_EXTRAS = Object.freeze(["quests"]);
const WIDE_KEYS = Object.freeze(["widefield", "battlewide"]);
const TOON_KEYS = Object.freeze(["toonoutline", "toonshade"]);
/** Keys that stay on F2 only (developer pages and labs). */
export const F2_ONLY_KEYS = Object.freeze([
    "blastladder", "planner", "itemsource", "gymmap", "itemrulebook", "anglermap", "movetheatre", "cutcontent", "stageselect",
    "soundtest", "soundtrack", "cinema", "langdesk", "damagelab", "silence", "showfps", "cursorbook", "chatqueue", "weaponlab", "bitledger",
    "savexray", "saveverify", "replay", "redirectview", "arrivallab", "practice2v2",
]);
/**
 * The EFFECTS page: six categories (the F2 groups of the same name), each a list of on/off switches. Only the "in" keys of
 * web/ship-list.js are listed (tests/options-effects.test.js reads the F2 groups and checks this). `label` must fit one row
 * beside its On / Off value (tests/options-book.test.js measures it with the game font).
 */
export const EFFECT_CATEGORIES = Object.freeze([
    { id: "weather", label: "Weather", help: "Rain, snow, storms and the cold.", items: [
        { key: "rain", label: "Rain", help: "Rain on the map." },
        { key: "rainwater", label: "Rain on water", help: "Rain makes ripples on water." },
        { key: "snow", label: "Snow", help: "Snow and blizzards." },
        { key: "sand", label: "Sandstorm", help: "Blowing sand in the desert." },
        { key: "lightning", label: "Lightning", help: "Flashes of lightning in storms." },
        { key: "gusts", label: "Wind gusts", help: "Gusts of wind." },
        { key: "breath", label: "Cold breath", help: "Cold breath." },
        { key: "frost", label: "Frost edges", help: "Frost at the edges of the screen." },
        { key: "screenfx", label: "Storm feel", help: "Rain and storm effects over the whole screen." },
    ] },
    { id: "terrain", label: "Terrain", help: "Trees, grass, water and how things look in them.", items: [
        { key: "sway", label: "Swaying trees", help: "Trees sway." },
        { key: "grass", label: "Grass", help: "Grass effects on the map." },
        { key: "grasspush", label: "Grass parts", help: "Grass parts around your feet as you walk." },
        { key: "water", label: "Water", help: "Water effects on the map." },
        { key: "reflect", label: "Reflections", help: "Water shows reflections." },
        { key: "mirror", label: "Mirror people", help: "Characters are reflected in water." },
        { key: "wetlook", label: "Wet and dusty", help: "Characters look wet or dusty." },
        { key: "seam", label: "Map gap filler", help: "Fills tiny gaps and hairline cracks in the map picture." },
    ] },
    { id: "atmosphere", label: "Atmosphere", help: "Light, time of day, fog and mood.", items: [
        { key: "tod", label: "Day and night", help: "Time of day: the light changes." },
        { key: "nightlight", label: "Night lights", help: "Lit circles of light at night." },
        { key: "clouds", label: "Cloud shadows", help: "Cloud shadows on the map." },
        { key: "lamps", label: "Lamp glow", help: "Lamps glow." },
        { key: "lightpool", label: "Lamp pools", help: "Pools of light around lamps." },
        { key: "lightreveal", label: "Lamp colours", help: "Lamps show the true colours around them." },
        { key: "indoor", label: "Indoor mood", help: "Mood lighting indoors." },
        { key: "fog", label: "Fog and mist", help: "Fog and mist." },
        { key: "shafts", label: "Light shafts", help: "Shafts of light." },
        { key: "heat", label: "Heat shimmer", help: "Heat shimmer." },
        { key: "sparkle", label: "Ice sparkle", help: "Ice sparkle." },
        { key: "pollen", label: "Pollen", help: "Pollen." },
    ] },
    { id: "life", label: "Life", help: "Small living things on the map.", items: [
        { key: "leaves", label: "Falling leaves", help: "Falling leaves." },
        { key: "fireflies", label: "Fireflies", help: "Fireflies." },
    ] },
    { id: "ground", label: "Ground", help: "What you leave behind and what lies on the ground.", items: [
        { key: "steps", label: "Footprints", help: "Footprints, dust and ripples as you walk." },
        { key: "puddles", label: "Puddles and ice", help: "Puddles and ice on the ground." },
    ] },
    { id: "sound", label: "Sound", help: "Weather, place and footstep sounds.", items: [
        { key: "sound", label: "Weather sounds", help: "Rain, wind and storm sounds." },
        { key: "ambience", label: "Place sounds", help: "Place sounds such as water and city sounds." },
        { key: "musicfx", label: "Music and weather", help: "The music reacts to the weather." },
        { key: "footsteps", label: "Footstep sounds", help: "The sound of footsteps." },
    ] },
]);
/** The most rows the OPTIONS list window shows at once (a longer EFFECTS category scrolls). */
export const LIST_ROWS = 9;

/** Where each of the 98 keys lives: "detail", an OPTIONS row id, "effects:<category>", or "f2". (The two new dev switches `glossary` and `options` are F2 only too.) */
export const OPTIONS_HOME = (() => {
    const home = {};
    for (const k of DETAIL_KEYS) home[k] = "detail";
    home.battlespeed = "battleSpeed"; home.encounterdial = "randomFights";
    for (const k of [...WIDE_KEYS, "hd2d", ...TOON_KEYS]) home[k] = "f2";       // "auto" or "out" for players: no OPTIONS row
    for (const c of EFFECT_CATEGORIES) for (const i of c.items) if (!(i.key in home)) home[i.key] = `effects:${c.id}`;
    for (const g of EXTRA_GROUPS) for (const k of g.keys) home[k] = SHOWN_EXTRAS.includes(g.id) ? `extra:${g.id}` : "f2";
    for (const k of F2_ONLY_KEYS) home[k] = "f2";
    home.glossary = "f2"; home.options = "f2";
    return Object.freeze(home);
})();

// ---------------------------------------------------------------- reading and writing the store
const on = (store, keys) => keys.some((k) => store.get(k) === true);
const setAll = (store, keys, value) => store.setMany(Object.fromEntries(keys.map((k) => [k, value])));

/** The Detail keys a player can change. The "auto" and "out" ones (uisharp, devils) have no switch in the installed copy, so they never decide what Detail reads. */
const DETAIL_PLAYER_KEYS = Object.freeze(DETAIL_KEYS.filter((k) => shipClass(k) === "in"));
/** "original" | "low" | "medium" | "high", or "custom" when F2 or the EFFECTS page has put the player's Detail keys somewhere between. */
export function detailOf(store) {
    for (const level of [...DETAIL_LEVELS].reverse()) {
        const off = new Set(DETAIL_OFF[level]);
        if (DETAIL_PLAYER_KEYS.every((k) => (store.get(k) === true) === !off.has(k)) && store.get("quality") === DETAIL_QUALITY[level]) return level;
    }
    return "custom";
}
export function applyDetail(store, level) {
    const off = new Set(DETAIL_OFF[level]);
    store.setMany({ ...Object.fromEntries(DETAIL_KEYS.map((k) => [k, !off.has(k)])), quality: DETAIL_QUALITY[level] });
}

const DIAL = Object.freeze(["rare", "normal", "lure"]);        // fewer / normal / more (web/encounter-dial.js DIAL_MODES)
const TODS = Object.freeze(["auto", "day", "golden", "dusk", "night"]);
const WEATHERS = Object.freeze(["auto", "always", "storm", "clear"]);   // web/ambience.js: the F2 select's values
const VOLUMES = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);   // tenths; 10 = today's gain

const toggleRow = (id, label, help, keys) => ({
    id, label, help, choices: ["Off", "On"],
    read: (s) => (on(s, keys) ? 1 : 0), write: (s, i) => setAll(s, keys, i === 1),
});
const valueRow = (id, label, help, key, values, labels) => ({
    id, label, help, choices: labels,
    read: (s) => Math.max(0, values.indexOf(s.get(key))), write: (s, i) => s.setMany({ [key]: values[i] }),
});
const volumeRow = (id, label, help, key) => ({
    id, label, help, numeric: true, choices: VOLUMES.map((v) => String(v * 10)),
    read: (s) => { const v = Number(s.get(key)); return Number.isFinite(v) ? Math.min(10, Math.max(0, Math.round(v * 10))) : 10; },
    write: (s, i) => s.setMany({ [key]: VOLUMES[i] / 10 }),
});

/** Every row, by id. `pixelFilters` = [[id, label], ...] (web/sprite-filters.js SPRITE_FILTERS limited to the GPU ones). */
export function buildRows(pixelFilters = [["off", "Off"]]) {
    const rows = {
        battleSpeed: {
            id: "battleSpeed", label: "Battle speed", numeric: true, choices: SPEEDS.map((v) => `x${v}`),
            help: "How fast battles play. x1 is the speed of the original game.",
            read: (s) => {
                if (s.get("battlespeed") !== true) return 0;                       // the switch is off: the game really runs x1
                const v = Number(s.get("battleSpeed"));
                const want = Number.isFinite(v) ? v : 2;
                return SPEEDS.reduce((best, sp, k) => (Math.abs(sp - want) < Math.abs(SPEEDS[best] - want) ? k : best), 0);
            },
            write: (s, i) => (SPEEDS[i] === 1 ? s.setMany({ battlespeed: false, battleSpeed: 1 }) : s.setMany({ battlespeed: true, battleSpeed: SPEEDS[i] })),
        },
        randomFights: {
            id: "randomFights", label: "Random fights", choices: ["Fewer", "Normal", "More"],
            help: "How often wild Digimon attack you while you walk.",
            read: (s) => (s.get("encounterdial") === true ? DIAL.indexOf(s.get("encounterDialMode")) : 1),   // -1 = "none" set in F2
            customLabel: () => "Never",
            write: (s, i) => (DIAL[i] === "normal" ? s.setMany({ encounterdial: false, encounterDialMode: "normal" }) : s.setMany({ encounterdial: true, encounterDialMode: DIAL[i] })),
        },
        detail: {
            id: "detail", label: "Detail", choices: DETAIL_LABELS,
            help: "Small map effects. Original = exactly like the PlayStation game.",
            read: (s) => DETAIL_LEVELS.indexOf(detailOf(s)), customLabel: () => "Custom",
            write: (s, i) => applyDetail(s, DETAIL_LEVELS[i]),
        },
        timeOfDay: valueRow("timeOfDay", "Time of day", "Keep the map at one time of day, or let it change by itself.", "todMode", TODS, ["Auto", "Day", "Golden", "Dusk", "Night"]),
        weather: valueRow("weather", "Weather", "Random weather, weather all the time, storms only, or clear skies.", "weatherMode", WEATHERS, ["Random", "Always", "Storms", "Clear"]),
        pixelFilter: valueRow("pixelFilter", "Pixel filter", "Smooths the blocky pixels of the whole picture.", "spriteFilter", pixelFilters.map((f) => f[0]), pixelFilters.map((f) => f[1])),
        musicVolume: volumeRow("musicVolume", "Music volume", "How loud the music is. 100 is the normal level.", "musicVolume"),
        soundVolume: volumeRow("soundVolume", "Sound volume", "How loud sound effects and place sounds are. 100 is the normal level.", "soundVolume"),
    };
    for (const c of EFFECT_CATEGORIES) {
        const keys = c.items.map((i) => i.key);
        rows[`cat:${c.id}`] = {
            id: `cat:${c.id}`, label: c.label, help: c.help, menu: true, choices: ["All", "Some", "None"],
            read: (s) => (keys.every((k) => s.get(k) === true) ? 0 : on(s, keys) ? 1 : 2), write: () => { },
        };
    }
    for (const g of EXTRA_GROUPS.filter((x) => SHOWN_EXTRAS.includes(x.id))) rows[`extra:${g.id}`] = toggleRow(`extra:${g.id}`, g.label, g.help, g.keys);
    return rows;
}

/** The four pages, in order, and the row ids on each (Q / E switch the page). EFFECTS rows open a category (see createOptionsModel). */
export const PAGES = Object.freeze([
    { id: "game", label: "GAME", rows: ["battleSpeed", "randomFights", ...SHOWN_EXTRAS.map((id) => `extra:${id}`)] },
    { id: "screen", label: "SCREEN", rows: ["detail", "timeOfDay", "weather", "pixelFilter"] },
    { id: "sound", label: "SOUND", rows: ["musicVolume", "soundVolume"] },
    { id: "effects", label: "EFFECTS", rows: EFFECT_CATEGORIES.map((c) => `cat:${c.id}`) },
]);

// ---------------------------------------------------------------- the cursor
/**
 * Pages, cursor and value changes. No wrap anywhere (the pause list does not wrap: pause-menu-screen-tree-2026-08-14.md).
 * Every method returns what the screen should do: "move" (play the cursor sound), "change" (a value moved), or null.
 */
export function createOptionsModel(store, pixelFilters) {
    const rows = buildRows(pixelFilters);
    const backRow = { id: "back", label: "Back", help: "Back to the list of effects.", choices: [""], read: () => 0, write: () => { }, back: true };
    let page = 0, row = 0, top = 0, open = null;          // open = the EFFECTS category that is showing its switches, or null
    const switchRows = (c) => [...c.items.map((i) => toggleRow(`fx:${i.key}`, i.label, i.help, [i.key])), backRow];
    const pageRows = () => (open ? switchRows(EFFECT_CATEGORIES[open.index]) : PAGES[page].rows.map((id) => rows[id]));
    const here = () => pageRows()[row];
    const clampTop = () => { const n = pageRows().length; if (row < top) top = row; if (row >= top + LIST_ROWS) top = row - LIST_ROWS + 1; top = Math.max(0, Math.min(top, Math.max(0, n - LIST_ROWS))); };
    const close = () => { const c = open; open = null; row = c.cat; top = 0; };
    const toggleHere = () => { const r = here(); const i = r.read(store); r.write(store, i === 1 ? 0 : 1); return "change"; };
    return {
        page: () => page,
        row: () => row - top,
        pageLabels: () => PAGES.map((p) => p.label),
        inCategory: () => open !== null,
        /** Which way the list continues past the rows shown ({ above, below }). */
        scroll: () => ({ above: top > 0, below: top + LIST_ROWS < pageRows().length }),
        /** What the list shows now: label, current value text, and flags, for each row on screen (at most LIST_ROWS). */
        view() {
            return pageRows().slice(top, top + LIST_ROWS).map((r) => {
                const i = r.read(store);
                const fixed = r.menu || r.back;
                return {
                    id: r.id, label: r.label, numeric: !!r.numeric, help: r.help, menu: !!r.menu,
                    value: i < 0 ? (r.customLabel?.() ?? "Custom") : r.choices[i],
                    custom: i < 0, canLeft: !fixed && i > 0, canRight: r.menu ? true : !fixed && i < r.choices.length - 1,
                };
            });
        },
        help: () => here().help,
        switchPage(d) {
            const next = Math.min(PAGES.length - 1, Math.max(0, page + d));
            if (next === page) return null;
            open = null; page = next; row = 0; top = 0; return "move";
        },
        moveRow(d) {
            const next = Math.min(pageRows().length - 1, Math.max(0, row + d));
            if (next === row) return null;
            row = next; clampTop(); return "move";
        },
        /** d = -1 / +1. From a custom value, right picks the first choice and left the last. On a category row, right opens it. */
        change(d) {
            const r = here();
            if (r.menu) return d > 0 ? this.select() : null;
            if (r.back) return null;
            const i = r.read(store);
            const next = i < 0 ? (d > 0 ? 0 : r.choices.length - 1) : Math.min(r.choices.length - 1, Math.max(0, i + d));
            if (next === i) return null;
            r.write(store, next); return "change";
        },
        /** Confirm: opens a category, flips a switch, or leaves the open category on its Back row. */
        select() {
            const r = here();
            if (r.menu) { open = { index: EFFECT_CATEGORIES.findIndex((c) => `cat:${c.id}` === r.id), cat: row }; row = 0; top = 0; return "move"; }
            if (r.back) { close(); return "move"; }
            if (r.choices.length === 2) return toggleHere();
            return null;
        },
        /** The cancel button: leaves an open category and returns true; false = nothing was open, the screen may close. */
        back() {
            if (!open) return false;
            close(); return true;
        },
    };
}
