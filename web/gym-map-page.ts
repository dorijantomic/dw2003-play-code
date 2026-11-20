// web/gym-map-page.js — the gym map page: nine gyms, each with its greeter and the
// whole rank ladder that greeter opens.
//
// The ladder and the drills come from web/gym-map.js (pure joins of the shipped tables).
// This file only turns those rows into words and elements: it names the ID cards from
// item_effects.json, the place and the greeter from manifest.json, and every drill's
// stat through web/battle.js's gymStatForId — the one stat-id table the gym screen
// itself uses, so the page cannot drift from the game.
//
// The top level is DOM-free, so node can import the wording helpers and test them:
// greeterText, placeName, gateText, drillText, mapSummary. loadAndRender() touches the
// document only when the page calls it.
import { groupSizes, gymRows } from "./gym-map.js";
import { gymStatForId } from "./battle.js";

// gymStatForId returns the engine's own short keys; the page writes them out.
const STAT_WORDS = {
    str: "strength", def: "defence", spt: "spirit", wis: "wisdom", spd: "speed", chr: "charisma",
    maxHp: "max HP", maxMp: "max MP",
};
const statWord = (id) => {
    const key = gymStatForId(id);
    return key ? STAT_WORDS[key] ?? key : null;
};

const itemName = (id, names) => names?.get?.(id) ?? `item ${id}`;

/** The place the gym's stage is, from manifest.json's maps; the stage id if unnamed. */
export function placeName(stage, maps) {
    return maps?.get?.(stage)?.name ?? stage;
}

/** One greeter line: the sprite's own name from the manifest, then its npc and sprite ids. */
export function greeterText(row, characters) {
    const name = characters?.get?.(row.sprite)?.name;
    return name ? `${name} · npc ${row.npc} · ${row.sprite}` : `npc ${row.npc} · ${row.sprite}`;
}

/**
 * One rung's card gate in plain words. `mustOwn` is the required value of the possession
 * flag (gym_ranks.json's `owned`), so a false gate is a card you must NOT have.
 */
export function gateText(gates = [], names = new Map()) {
    const wanted = [];
    const refused = [];
    for (const gate of gates) (gate.mustOwn ? wanted : refused).push(itemName(gate.item, names));
    if (!wanted.length && !refused.length) return "always open";
    if (!refused.length) return wanted.join(" + ");
    if (!wanted.length) return `must not have ${refused.join(" or ")}`;
    return `needs ${wanted.join(" + ")}; must not have ${refused.join(" or ")}`;
}

/**
 * One drill's words: the stat it trains, then its second stat. A second CORE stat is a
 * 50% loss roll (battle.js gymTrainingResult's secondary branch); a second element or
 * max HP/MP row is another gain, so the two read differently.
 */
export function drillText(drill = {}) {
    const primary = statWord(drill.primary) ?? `stat ${drill.primary}`;
    const secondary = drill.secondary ? statWord(drill.secondary) : null;
    if (!secondary) return primary;
    const loss = Number(drill.secondary) >= 1 && Number(drill.secondary) <= 5;
    return `${primary}, ${loss ? "risks" : "plus"} ${secondary}`;
}

/** The page's headline totals: gyms, rank menus, drill rows and the TP amounts offered. */
export function mapSummary(rows, menus) {
    const sizes = groupSizes(menus);
    return {
        gyms: rows.length,
        ranks: sizes.length,
        drills: sizes.reduce((sum, size) => sum + size, 0),
        tp: Array.isArray(menus?.tp_costs) ? menus.tp_costs.slice() : [],
    };
}

const tag = (doc, text, className) => {
    const span = doc.createElement("span");
    if (className) span.className = className;
    span.textContent = text;
    return span;
};

/** Draw the map into the page: one section per gym, one block per ladder rung. */
export function renderGymMap(doc, { rows, menus, names, characters, maps }) {
    const summaryEl = doc.getElementById("summary");
    if (summaryEl) {
        const summary = mapSummary(rows, menus);
        summaryEl.textContent = `${summary.gyms} gyms · ${summary.ranks} rank menus · ` +
            `${summary.drills} drill rows · TP ${summary.tp.join(" / ")} per drill`;
    }
    const list = doc.getElementById("gyms");
    if (!list) return;
    list.textContent = "";
    for (const row of rows) {
        const section = doc.createElement("section");
        section.className = "gym";
        section.dataset.stage = row.stage;
        const heading = doc.createElement("h2");
        heading.append(tag(doc, placeName(row.stage, maps), "place"), tag(doc, row.stage, "code"));
        const greeter = doc.createElement("p");
        greeter.className = "greeter";
        greeter.textContent = greeterText(row, characters);
        const order = doc.createElement("p");
        order.className = "order";
        order.textContent = "Checked in this order — the first rung your ID cards satisfy is the menu this greeter opens.";
        section.append(heading, greeter, order);
        row.options.forEach((option, index) => {
            const rung = doc.createElement("div");
            rung.className = "rung";
            rung.dataset.group = String(option.group);
            const head = doc.createElement("div");
            head.className = "runghead";
            head.append(
                tag(doc, `rung ${index + 1}`, "rungnum"),
                tag(doc, gateText(option.gates, names), "gates"),
                tag(doc, `rank ${option.group + 1}`, "rank"),
                tag(doc, `${option.rowCount} drills`, "count"),
                tag(doc, `TP ${option.tpCost.join(" / ")}`, "tp"),
            );
            const drills = doc.createElement("ul");
            drills.className = "drills";
            for (const drill of option.drills) {
                const item = doc.createElement("li");
                item.dataset.drill = String(drill.drill);
                item.textContent = `${drill.drill}. ${drillText(drill)}`;
                drills.append(item);
            }
            rung.append(head, drills);
            section.append(rung);
        });
        list.append(section);
    }
}

const getJson = (url) => fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return response.json();
});

/** Load the shipped tables and draw the page. Called once, by gym-map.html. */
export async function loadAndRender(doc) {
    const target = doc ?? document;
    const [ranks, progression, items, manifest] = await Promise.all([
        getJson("assets/data/gym_ranks.json"),
        getJson("assets/data/progression.json"),
        getJson("assets/data/item_effects.json"),
        // The place and greeter names are a nicety; without the manifest the page still
        // prints every gym and its ladder, by stage and sprite id.
        getJson("assets/manifest.json").catch(() => ({})),
    ]);
    const rows = gymRows(ranks, progression.gym);
    // Greeter sprites live in the manifest's npcs; the player's own sprites are in
    // characters. Both tables have the same shape.
    const sprites = [...(manifest.npcs ?? []), ...(manifest.characters ?? [])];
    renderGymMap(target, {
        rows,
        menus: progression.gym,
        names: new Map((items.items ?? []).map((item) => [item.id, item.name])),
        characters: new Map(sprites.map((entry) => [entry.id, entry])),
        maps: new Map((manifest.maps ?? []).map((entry) => [entry.id, entry])),
    });
    return rows;
}
