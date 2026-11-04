// web/item-rulebook.js — the disc's own item rulebook: what one use of every field
// consumable really does, the cap each effect runs into, the 25 items that only work
// inside a fight, and what a shop pays for the pieces no shop ever sells.
//
// Every number comes out of the shipped effect table (web/assets/data/item_effects.json,
// 402 rows). The effect words are the applier's own arms (engine/dw3/item-effect.ts),
// which engine/dw3/items.ts `useItem` runs for the pause ITEMS bag:
//   0x01 HP charge   restores the record's amount, clipped at max HP
//   0x11 TP chip     grants the amount, clipped at TP 99 (refused when already 99)
//   0x02..0x10       a stat/element chip: the rise is `rand() % value + 1`, clipped at cap
// The fight-only band is the decoded FIGHTSTG 48-word jump table at 0x80082f1c,
// index = ItemId - 43, ids 66..90 (engine/dw3/battle-items.ts).
//
// Pure: no page, no storage, no network, no flag write. The page
// (web/item-rulebook.html) hands it the shipped table; the node test pins every
// number here to the engine's own constants.
//
// The three caps live here once because this module also runs in the browser, where
// engine/*.ts does not exist. They are the disc's values, kept in the disc's own
// hex: FIELD_BOOST_CAP_HP_MP (0x270f), FIELD_BOOST_CAP_STAT (0x3e7) and TP_CAP
// (0x63); tests/item-rulebook.test.js holds all three equal to the engine's.
export const CAPS = { hpMp: 0x270f, stat: 0x3e7, tp: 0x63 };

const STAT_WORD = {
    stat_str: "Strength", stat_def: "Defense", stat_spt: "Spirit",
    stat_wis: "Wisdom", stat_spd: "Speed", stat_chr: "Charisma",
};

/** The {items: [...]} array inside the shipped table, or a bare array. */
function itemRows(effects) {
    if (Array.isArray(effects)) return effects;
    return effects && Array.isArray(effects.items) ? effects.items : [];
}

/** One row as the page and the test read it: identity, effect, the disc's numbers. */
function row(r) {
    return {
        id: Number(r.id),
        name: String(r.name ?? ""),
        effect: String(r.effect ?? ""),
        value: Number(r.value ?? 0),
        buy: Number(r.buy ?? 0),
        sell: Number(r.sell ?? 0),
        category: String(r.category ?? ""),
    };
}

/**
 * The rulebook's rows, grouped by effect family and sorted by item id:
 *   hp     the four HP charges (500 / 2000 / 5000 / and the 0x270f one)
 *   tp     the four TP chips (the TrainChips, +1 / +2 / +3 / +5)
 *   stat   the eight stat chips (max HP, max MP and the six core stats)
 *   elem   the seven elemental disks
 *   battle the 25 items that only work in a fight
 * A row whose effect is none of those (a card booster, an equipment piece) is
 * never invented into a group.
 */
export function ruleRows(effects) {
    const rows = itemRows(effects).map(row);
    const byId = (a, b) => a.id - b.id;
    return {
        hp: rows.filter((r) => r.effect === "hp").sort(byId),
        tp: rows.filter((r) => r.effect === "tp").sort(byId),
        stat: rows.filter((r) => r.effect.startsWith("stat_")).sort(byId),
        elem: rows.filter((r) => r.effect.startsWith("elem_")).sort(byId),
        battle: rows.filter((r) => r.effect === "battle").sort(byId),
    };
}

/**
 * The cap one kind of effect runs into, in words. `value` is the effect record's
 * own amount: the flat restore/grant for HP and TP, the roll divisor for a chip.
 */
export function capWords(effect, value) {
    const e = String(effect ?? "");
    const v = Number(value) || 0;
    if (e === "hp") return `restores ${v} HP; HP stops at max HP (max HP ${CAPS.hpMp})`;
    if (e === "tp") return `grants ${v} TP (TP ${CAPS.tp})`;
    if (e === "stat_hp") return `raises max HP by 1 to ${v} a use (max HP ${CAPS.hpMp})`;
    if (e === "stat_mp") return `raises max MP by 1 to ${v} a use (max MP ${CAPS.hpMp})`;
    if (e.startsWith("stat_")) {
        const word = STAT_WORD[e] || "the stat";
        return `raises ${word} by 1 to ${v} a use (a stat stops at ${CAPS.stat})`;
    }
    if (e.startsWith("elem_")) {
        return `raises the ${e.slice(5)} tolerance by 1 to ${v} a use (a tolerance stops at ${CAPS.stat})`;
    }
    if (e === "battle") return "works only in a fight";
    return "no field effect the rulebook knows";
}

/**
 * The two sell flags, computed from the shipped prices, never hardcoded:
 *   neverSold  every piece with a 0 BIT buy price and a real sell price — a shop
 *              never sells it, but a shop pays for it.
 *   notHalf    every piece whose sell price is not exactly half its buy price
 *              (so a 0 BIT buy price is in, and PowerCharge 12/6 is out).
 * Both lists carry the whole row, sorted by item id.
 */
export function sellSheet(effects) {
    const rows = itemRows(effects).map(row).filter((r) => r.sell > 0);
    const byId = (a, b) => a.id - b.id;
    return {
        neverSold: rows.filter((r) => r.buy === 0).sort(byId),
        notHalf: rows.filter((r) => r.buy !== 2 * r.sell).sort(byId),
    };
}

/** The 25 items the decoded FIGHTSTG jump table dispatches: ids 66..90. */
export function battleOnly(effects) {
    return itemRows(effects).map(row).filter((r) => r.effect === "battle").sort((a, b) => a.id - b.id);
}
