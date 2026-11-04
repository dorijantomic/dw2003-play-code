// web/gym-map.js — the nine training gyms, each with its greeter and the whole rank
// ladder that greeter opens.
//
// A gym greeter does not offer a fixed drill list. Its dialogue's on_close writes flag
// bank 0x94 with a 0-based rank group, and the greeter checks the player's ID cards in
// the order the table lists: the first FULLY SATISFIED option wins, and that option's
// group is the STGTRAIN rank menu it launches (docs/research/battle/
// gym-entry-and-rank-chain-2026-07-08.md, GYM-Q001). The ladder is the same story at
// every gym — no licence, the SilverID, SilverID + GoldID, the PlatinumID — but each
// gym spells it with its own group numbers, because each group is a different rank of
// the one 14-group drill table.
//
// Three shipped tables are handed in; nothing here reads a file, draws or stores:
//   ranks  web/assets/data/gym_ranks.json   {gyms: [{stage, npc_id, sprite, options}]}
//   menus  progression.json's `gym`         {tp_costs, rank_menus: [14 x [{drill, primary, secondary}]]}
//
// `requires[].owned` is the REQUIRED value of that possession flag — true means "you
// must own this card for this rung", false means "you must not" — not a recorded sample.
// The page prints the ladder from those patterns; it evaluates nothing against your bag.
//
// A drill's `primary`/`secondary` are the game's own stat ids (1..5 core stats, 8..14
// elements, 15/16 max HP/MP); naming them is the page's job (web/battle.js's
// gymStatForId is the one table). The module only joins the tables.

/** rank_menus, accepting either progression.json's `gym` object or its menu array. */
const rankMenus = (menus) => {
    if (Array.isArray(menus)) return menus;
    return Array.isArray(menus?.rank_menus) ? menus.rank_menus : [];
};

/** The TP amounts the screen offers for a drill, straight from the table. */
const tpCosts = (menus) => (Array.isArray(menus?.tp_costs) ? menus.tp_costs.slice() : []);

/** One option's gate pattern: the required value of each card's possession flag. */
function gatesOf(option) {
    const requires = Array.isArray(option?.requires)
        ? option.requires.map((required) => ({ item: required.item, owned: required.owned }))
        : Array.isArray(option?.gates)
            ? option.gates.map((gate) => ({ item: gate.item, owned: gate.mustOwn }))
            : [];
    return requires.map((required) => ({ item: required.item, mustOwn: required.owned === true }));
}

/** The row counts of the 14 rank menus, in rank order (group 0 is the first rung). */
export function groupSizes(menus) {
    return rankMenus(menus).map((group) => group.length);
}

/** One rank menu's drill rows, or [] when the group is not one of the 14. */
export function groupDrills(menus, group) {
    const tables = rankMenus(menus);
    if (!Number.isInteger(group) || group < 0 || group >= tables.length) return [];
    return tables[group].map((drill) => ({ ...drill }));
}

/**
 * The ladder a gym's greeter checks, in the file's own order (the first fully satisfied
 * rung is the one that launches). Accepts a gym_ranks entry or a row gymRows built:
 * `[{group, gates: [{item, mustOwn}]}]`.
 */
export function rankLadder(gym) {
    const options = Array.isArray(gym?.options) ? gym.options : [];
    return options.map((option) => ({ group: option.group, gates: gatesOf(option) }));
}

/**
 * Every gym as one row: `{stage, npc, sprite, options: [{group, gates, drills, rowCount, tpCost}]}`.
 *
 * `menus` is progression.json's `gym`. `stage` (optional) keeps one gym. An unknown
 * stage has no row, and so does a stage asked of a map that was handed no tables.
 * Call shape `gymRows(stage, ranks, menus)` is accepted too.
 */
export function gymRows(ranks, menus, stage = null) {
    if (typeof ranks === "string") {
        const wanted = ranks;
        if (menus == null) return [];
        return gymRows(menus, stage, wanted);
    }
    const gyms = Array.isArray(ranks?.gyms) ? ranks.gyms : [];
    const costs = tpCosts(menus);
    const rows = gyms.map((gym) => ({
        stage: gym.stage,
        npc: gym.npc_id,
        sprite: gym.sprite,
        options: rankLadder(gym).map((rung) => {
            const drills = groupDrills(menus, rung.group);
            return { group: rung.group, gates: rung.gates, drills, rowCount: drills.length, tpCost: costs.slice() };
        }),
    }));
    return stage == null ? rows : rows.filter((row) => row.stage === stage);
}
