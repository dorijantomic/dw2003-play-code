// web/dev-panel-model.js — what the F2 page shows for each of the 100 FX switches. Pure: no DOM, no state.
//
// Every key of FX_DEFS (web/ambience.js) has exactly one row here: its tab, sub-heading, plain name and
// one plain line about what a player would see. web/dev-panel.js draws the rows; this file only decides
// WHICH rows show for a tab, a search and an In / Auto / Out filter, and how many switches are on.
// The In / Auto / Out badge itself comes from web/ship-list.js (shipClass).
import { shipClass } from "./ship-list.js";

export const DEV_TABS = Object.freeze([
    { id: "world", name: "World" },
    { id: "quests", name: "Quests" },
    { id: "battle", name: "Battle" },
    { id: "online", name: "Online" },
    { id: "info", name: "Info pages" },
    { id: "test", name: "Test tools" },
    { id: "controls", name: "Controls" },      // no switches: presets, weather, sliders, quality, saves, photo, All on / off
]);
export const DEV_FILTERS = Object.freeze([
    { id: "all", name: "All" }, { id: "in", name: "In" }, { id: "auto", name: "Auto" }, { id: "out", name: "Out" },
]);

const R = (tab, sub, key, name, why) => Object.freeze({ key, tab, sub, name, why });

export const DEV_ROWS = Object.freeze([
    // ---- World
    R("world", "Terrain", "sway", "Swaying trees", "Trees on the map sway gently."),
    R("world", "Terrain", "grass", "Grass", "Grass on open maps is drawn as blades that move."),
    R("world", "Terrain", "grasspush", "Grass parts around feet", "Grass bends out of the way where the party walks."),
    R("world", "Terrain", "water", "Water", "Lakes, rivers and sea are drawn as moving water."),
    R("world", "Terrain", "reflect", "Water reflections", "Water shows a reflection."),
    R("world", "Terrain", "mirror", "Characters reflect in water", "Characters standing by water have a reflection in it."),
    R("world", "Terrain", "wetlook", "Wet / dusty look", "Characters look wet or dusty with the weather."),
    R("world", "Terrain", "seam", "Seam fixes", "Fixes where effects meet the map picture."),
    R("world", "Weather", "rain", "Rain", "Rain falls on rainy maps."),
    R("world", "Weather", "rainwater", "Rain on water", "Rain makes ripples on water."),
    R("world", "Weather", "snow", "Snow and blizzards", "Snow and blizzards fall on cold maps."),
    R("world", "Weather", "sand", "Sandstorm", "Sand blows across desert maps."),
    R("world", "Weather", "lightning", "Lightning", "Storms flash with lightning."),
    R("world", "Weather", "gusts", "Wind gusts", "Gusts of wind sweep across open maps."),
    R("world", "Weather", "breath", "Cold breath", "Your breath shows as puffs on snowy maps."),
    R("world", "Weather", "frost", "Frost edges", "Frost creeps in at the screen edges on snowy maps."),
    R("world", "Weather", "screenfx", "Screen rain and storm feel", "Rain and storms also affect the whole screen, not just the map."),
    R("world", "Atmosphere", "tod", "Time of day", "The light changes through the day: golden hour, dusk, night."),
    R("world", "Atmosphere", "nightlight", "Night lighting", "At night the map goes dark with lit circles of light."),
    R("world", "Atmosphere", "clouds", "Cloud shadows", "Shadows of clouds drift over the ground."),
    R("world", "Atmosphere", "lamps", "Lamp glow", "Lamps glow in the dark."),
    R("world", "Atmosphere", "lightpool", "Light pools around lamps", "Soft pools of light lie on the ground around lamps."),
    R("world", "Atmosphere", "lightreveal", "Lamps restore true colours", "Near a lamp the map shows its real colours instead of the night tint."),
    R("world", "Atmosphere", "indoor", "Indoor mood lighting", "Indoor rooms get warm, moody light."),
    R("world", "Atmosphere", "fog", "Fog and mist", "Fog and mist hang over some maps."),
    R("world", "Atmosphere", "shafts", "Light shafts", "Slanting bands of light fall through the treetops."),
    R("world", "Atmosphere", "heat", "Heat shimmer", "The air wobbles over hot ground."),
    R("world", "Atmosphere", "sparkle", "Ice sparkle", "Snow and ice glitter on cold maps."),
    R("world", "Atmosphere", "pollen", "Pollen", "Specks of pollen float in the air."),
    R("world", "Life", "leaves", "Falling leaves", "Leaves drift down on maps with trees."),
    R("world", "Life", "fireflies", "Fireflies", "Fireflies glow on dark nights outdoors."),
    R("world", "Life", "devils", "Dust devils and tumbleweeds", "A dust devil and a tumbleweed roll across the desert."),
    R("world", "Life", "villagers", "Ambient villagers", "A few extra characters stroll through cities and towns."),
    R("world", "Ground", "steps", "Footprints, dust and ripples", "Walking leaves footprints, dust puffs or water ripples."),
    R("world", "Ground", "puddles", "Puddles and ice", "Puddles form in rain and ice forms in snow."),
    R("world", "Sound", "sound", "Weather sounds", "Rain, thunder and wind can be heard."),
    R("world", "Sound", "ambience", "Place sounds", "Water and city places have their own background sound."),
    R("world", "Sound", "musicfx", "Music reacts to weather", "The music changes with the weather."),
    R("world", "Sound", "footsteps", "Footstep sounds", "Your steps make sounds."),
    R("world", "Screen", "widefield", "Wide overworld", "The map view widens to fill a wide window or fullscreen."),
    R("world", "Screen", "uisharp", "Sharp battle menus", "Battle menus are drawn with sharper edges."),
    R("world", "Menus", "glossary", "Glossary book", "The pause menu gets a Glossary book."),
    R("world", "Menus", "options", "Options screen", "The pause menu gets an Options screen."),
    // ---- Quests
    R("quests", "Quests", "quests", "Quests", "Characters offer jobs, listed on the Quests screen (F3 or the Quests button)."),
    R("quests", "Quests", "questtriggers", "Quest triggers", "Some quest scenes start when you step onto a spot on the map."),
    R("quests", "Quests", "questemotes", "Quest emotes", "A quest scene can show a reaction bubble above a character."),
    R("quests", "Quests", "questplacecard", "Quest place cards", "A quest scene can show the blue place-name card."),
    R("quests", "Quests", "questsecondjob", "Pick which job to take", "When a character has several jobs, they ask which one you want."),
    R("quests", "Quests", "mount", "Mount", "After a quest unlocks it, you can ride a Digimon on the map (needs your own Digimon World 2 disc)."),
    R("quests", "Quests", "mountseat", "Rider sits in the saddle", "The rider sits in the saddle instead of floating over the mount."),
    // ---- Battle
    R("battle", "Bosses", "fusionbosses", "Fusion bosses", "Kimeramon and Machinedramon fuse into Millenniummon."),
    R("battle", "Bosses", "bossphases", "Boss phases", "A boss changes how it fights as its health drops."),
    R("battle", "Bosses", "bossmusic", "Phase music", "The battle music changes when a boss enters a new phase."),
    R("battle", "Bosses", "bossgrows", "The boss grows", "The boss is drawn bigger in later phases."),
    R("battle", "Ideas", "giantmode", "Giant mode", "Any fighter in a battle can be drawn at another size."),
    R("battle", "Ideas", "fieldwar", "Elemental field war", "Field techniques set the battlefield element, and it shifts by itself every four turns."),
    R("battle", "Ideas", "omen", "A feeling before a fight", "Warns that a wild fight is close."),
    R("battle", "Ideas", "practice2v2", "Practice 2 vs 2", "Wild fights become 2 vs 2 with a computer partner."),
    R("battle", "Ideas", "enemytells", "Enemy tells", "A countdown under the enemy shows its next timed special."),
    R("battle", "Ideas", "aishift", "Pattern breaker", "Enemies’ timed specials come one turn early."),
    R("battle", "Pace", "battlespeed", "Faster battles", "Battles run faster, with a speed from x1 to x3."),
    R("battle", "Pace", "encounterdial", "Encounter dial", "Sets how often wild fights come: none, rare, normal or lure."),
    R("battle", "Motion", "ownclips", "Own clips for techniques", "Each Digimon uses its own attack when a technique has no clip."),
    R("battle", "Motion", "dw2motion", "Digimon World 2 motion", "A technique with no clip borrows the Digimon World 2 motion."),
    R("battle", "Motion", "smoothanim", "Smooth battle animation", "Battle animation has more in-between frames."),
    R("battle", "Look", "battlewide", "Camera further out", "The battle camera sits a little further back."),
    R("battle", "Look", "smartcam", "Smart 2 vs 2 camera", "The camera moves so rocks do not hide the Digimon."),
    R("battle", "Look", "battleatmos", "Battle sky and weather", "Night, fog, snow and rain in battle follow where you are."),
    R("battle", "Look", "battlepano", "Painted 360 backdrops", "Battles show a painted all-round backdrop (test: Shell Beach)."),
    R("battle", "Look", "toonoutline", "Toon outlines", "Black outlines around the Digimon in battle."),
    R("battle", "Look", "toonshade", "Toon shading", "Flat cartoon light on the Digimon in battle."),
    R("battle", "Look", "softalpha", "Smooth cut-out edges", "Crests and tails of the Digimon in battle have no blocky steps."),
    R("battle", "Look", "hd2d", "HD-2D look", "A tilt-shift blur, glow and colour grade over the picture."),
    // ---- Online
    R("online", "Online", "mpbubbles", "Game reaction bubbles", "Online “!” and “...” use the game’s own balloon."),
    R("online", "Online", "mpcredit", "Co-op wins count", "Online 2 vs 2 wins count for quests."),
    R("online", "Online", "serverchamp", "Server Champ league", "The host of a room can run a league night with called fights."),
    R("online", "Online", "chatqueue", "Keep every chat line", "Chat lines typed before joining a room are kept."),
    // ---- Info pages
    R("info", "Pages", "blastladder", "Blast ladder", "A page of each starter’s five Blast forms and the level that reaches each."),
    R("info", "Pages", "planner", "Next forms planner", "A page of the forms a partner can still learn and what each waits for."),
    R("info", "Pages", "movetheatre", "Move Theatre", "A page for watching Digimon moves play."),
    R("info", "Pages", "cutcontent", "Cut-content gallery", "Read-only pages on what the disc never lets you see."),
    R("info", "Pages", "soundtrack", "Soundtrack room", "A room to play the disc’s own music."),
    R("info", "Pages", "cinema", "Cinema", "A page to watch the disc’s five movies."),
    R("info", "Pages", "itemsource", "Item source book", "A page showing where every item comes from."),
    R("info", "Pages", "itemrulebook", "Item rulebook", "A page on what one use of an item really does, and what to sell."),
    R("info", "Pages", "gymmap", "Gym map", "A page of the nine gyms and the rank each one opens."),
    R("info", "Pages", "anglermap", "Angler’s almanac", "A page of every fishing stage, what bites and what it pays."),
    // ---- Test tools
    R("test", "Tools", "stageselect", "Stage select", "The developers’ stage list gets a longer layout and remembers where you were."),
    R("test", "Tools", "soundtest", "Sound test", "The developers’ own sound test screen."),
    R("test", "Tools", "langdesk", "Language desk", "A page on the seven language rows the pad cannot all reach."),
    R("test", "Tools", "damagelab", "Damage Lab", "Pick a fighter, enemy and technique and see each step of the damage."),
    R("test", "Tools", "silence", "Silence report", "Sounds this build cannot play."),
    R("test", "Tools", "showfps", "Show FPS", "A small box in the top-right corner: frames drawn per second and the median gap between them."),
    R("test", "Tools", "cursorbook", "Cursor almanac", "A page of the four cursors and how fast each one blinks."),
    R("test", "Tools", "weaponlab", "Weapon effects", "Adds a weapon’s hidden on-hit effect to the equipment screen."),
    R("test", "Tools", "bitledger", "BIT ledger", "The game’s money tables."),
    R("test", "Tools", "savexray", "Save X-ray", "The raw contents of a save."),
    R("test", "Tools", "saveverify", "Card verify", "Checks a save for damage."),
    R("test", "Tools", "replay", "Replay theatre", "Replays the story scenes of the current room."),
    R("test", "Tools", "redirectview", "Counter redirects", "Who a press at a counter really reaches."),
    R("test", "Tools", "arrivallab", "Arrival lab", "Which scene a place starts."),
]);

// Keys that have a page or screen to open. `extra` = an in-game screen (the open-extra hook in web/game.js);
// otherwise `href` opens in a new tab. Opening needs the key's own switch on.
const P = (href, noopener = true) => Object.freeze({ href, noopener });
const X = () => Object.freeze({ extra: true });
export const DEV_OPEN = Object.freeze({
    cutcontent: X(), blastladder: X(), planner: X(), damagelab: X(), replay: X(), soundtest: X(),
    movetheatre: P("move-theatre.html", false),
    soundtrack: P("soundtrack.html"), cinema: P("cinema.html"), cursorbook: P("cursor-almanac.html"),
    langdesk: P("language-desk.html"), itemsource: P("item-source.html"), gymmap: P("gym-map.html"),
    silence: P("silence-report.html"), itemrulebook: P("item-rulebook.html"), bitledger: P("bit-ledger.html"),
    savexray: P("save-xray.html"), redirectview: P("redirect-lab.html"), arrivallab: P("arrival-lab.html"),
    anglermap: P("fishing-almanac.html"),
});

const BY_KEY = new Map(DEV_ROWS.map((r) => [r.key, r]));
export const rowFor = (key) => BY_KEY.get(key) || null;
export const rowsOfTab = (tab) => DEV_ROWS.filter((r) => r.tab === tab);

/** { tabId: { on, total } }: switches on per tab (a missing or false value is off). */
export function tabCounts(fx) {
    const out = {};
    for (const t of DEV_TABS) out[t.id] = { on: 0, total: 0 };
    for (const r of DEV_ROWS) { out[r.tab].total++; if (fx && fx[r.key]) out[r.tab].on++; }
    return out;
}

/** Does this row match the typed words? Every word must appear in the name or the explanation (any case). */
export function matchesQuery(row, query) {
    const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = (row.name + " " + row.why).toLowerCase();
    return words.every((w) => hay.includes(w));
}

/** Does this row pass the In / Auto / Out filter? ("all" passes everything.) */
export function matchesFilter(row, filter, shipOf = shipClass) {
    return !filter || filter === "all" || shipOf(row.key) === filter;
}

/**
 * The rows to show. With words typed, the search covers ALL tabs; with none, only `tab`.
 * The filter applies either way. Rows keep the file order.
 */
export function selectRows({ tab = "world", query = "", filter = "all" } = {}, shipOf = shipClass) {
    const searching = String(query || "").trim() !== "";
    return DEV_ROWS.filter((r) => (searching || r.tab === tab) && matchesQuery(r, query) && matchesFilter(r, filter, shipOf));
}

/** Group consecutive rows under their sub-heading: [{ tab, sub, rows }]. */
export function groupRows(rows) {
    const groups = [];
    for (const r of rows) {
        const g = groups[groups.length - 1];
        if (g && g.tab === r.tab && g.sub === r.sub) g.rows.push(r);
        else groups.push({ tab: r.tab, sub: r.sub, rows: [r] });
    }
    return groups;
}
