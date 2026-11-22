interface ExtrasStageRecord {
    tier?: number;
    area?: string;
}


interface ExtrasAreaRecord {
    id: string;
    name: string;
    tier?: number;
}


interface ExtrasAreaSource {
    stages?: Record<string, ExtrasStageRecord>;
    areas?: ExtrasAreaRecord[];
}
interface ExtrasStageData {
    tier: number;
}

interface ExtrasSource {
    stages: Record<string, ExtrasStageData>;
}

interface ExtrasEntry {
    key: string;
    found: boolean;
    label: string;
    percent: number | null;
}

interface ExtrasRow {
    stage: string;
    area: string;
    tier: number;
    total: number;
    entries: ExtrasEntry[];
}
// web/fishing-extras.js — rare extra rewards that can come on top of a fishing win.
//
// NEW CONTENT of this project, on for everyone (no option row, no URL flag).
// The data is data/authored/web/assets/data/fishing_extras.json (our own table,
// installed into web/assets/data by tools/install_authored_data.py).
//
// What fishing is on the disc (docs/research/field/fishing-system-decoded-2026-07-11.md):
// a strike starts a BATTLE, never an item drop — band 1 the stage's slot-4
// Cardmon party, band 2 the slot-7 water Digimon. That is left exactly as it is
// (web/game.js startFishingCatch). This module only adds, on a WON fight, one
// separate roll against the stage's small extras table. The roll uses its own
// random draw and runs after the strike is resolved, so the disc catch (which
// screen, which odds) is the same bytes as before.
//
// BALANCE RULE (also written in the data file's "balance" block, and enforced by
// tests/fishing-extras.test.js):
//   * the total extra chance per catch is 3 to 8 percent;
//   * a stage's tier is its slot-4 Cardmon's level (12, 27, 42, 47 -> 1..4),
//     i.e. how far the story is when that water is fished;
//   * an item is worth its shop buy price (twice its sell price when no shop
//     sells it). A normal entry is worth at most the tier ceiling (about what
//     the shops already sell at that point); a very rare entry (1 percent or
//     less) may be worth up to double;
//   * bits never exceed the smallest bits one win of that tier's big water
//     Digimon pays; card packs are the item class the disc's own Cardmon catch
//     pays on the same cast;
//   * nothing is paid when the Digimon flees.
//
// Pure: no DOM, no fetch, no game state. The roll takes a random function.

/** localStorage key of the "found once" flags (every save slot copies all keys). */
export const FISH_FINDS_KEY = "dw.fishfinds.v1";

/** The entries of one stage's table: the stage's area entries valid for its tier. */
export function tableFor(data, stage) {
    const rec = data?.stages?.[stage];
    if (!rec) return [];
    const area = (data.areas ?? []).find((a) => a.id === rec.area);
    if (!area) return [];
    return area.entries.filter((e) => e.tiers.includes(rec.tier));
}

/** Total chance in percent of a table. */
export function totalPercent(table) {
    return (table ?? []).reduce((n, e) => n + e.chance, 0);
}

/**
 * One roll for a won fishing fight: `{ area, entry }` or null.
 * `rand` returns a number in [0, 1). The entries sit one after the other on a
 * 0..100 line, each as wide as its percent; anything past the last is no extra.
 */
export function rollExtra(data, stage, rand: () => number) {
    const table = tableFor(data, stage);
    if (!table.length) return null;
    const point = rand() * 100;
    let at = 0;
    for (const entry of table) {
        at += entry.chance;
        if (point < at) return { area: data.stages[stage].area, entry };
    }
    return null;
}

/** The area record of a stage, or null. */
export function areaOf(data: ExtrasAreaSource, stage: string): ExtrasAreaRecord | null {
    const rec = data?.stages?.[stage];
    return rec ? (data.areas ?? []).find((a) => a.id === rec.area) ?? null : null;
}

/** The flag name an entry is remembered under. */
export const findKey = (area, entry) => `${area}:${entry.key}`;

/**
 * The words in the game's message box, built from the disc's text charset
 * (letters, digits and . , ' - : " ! ? only). `itemName` is the game's own item
 * name for an item entry.
 */
export function messageFor(data, area, entry, itemName) {
    if (entry.kind === "hint") {
        return `An old bottle! There is a note inside.\n\n${data.hints[entry.hint]}`;
    }
    const lead = area.flavour;
    if (entry.kind === "bits") return `${lead}\n\nYou got ${entry.bits} bits!`;
    return `${lead}\n\nYou got ${itemName ?? entry.name}!`;
}

/** Found flags, kept in localStorage like the other found-flags: { "area:key": 1 }. */
export function createFishFinds(storage = typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => {} }) {
    const read = () => {
        try {
            const j = JSON.parse(storage.getItem(FISH_FINDS_KEY) || "null");
            if (j && typeof j === "object" && !Array.isArray(j)) {
                const out: Record<string, number> = {};
                for (const k of Object.keys(j)) if (j[k]) out[k] = 1;
                return out;
            }
        } catch { /* damaged: read as empty */ }
        return {};
    };
    return {
        read,
        isFound: (area: string, entry: string) => !!read()[findKey(area, entry)],
        note(area, entry) {
            const all = read();
            const key = findKey(area, entry);
            if (all[key]) return false;
            all[key] = 1;
            try { storage.setItem(FISH_FINDS_KEY, JSON.stringify(all)); } catch { /* blocked or full: the game goes on */ }
            return true;
        },
    };
}

/**
 * The almanac's extras block, one row per stage in stage order:
 * `{ stage, area, tier, total, entries: [{ key, found, label, percent }] }`.
 * An entry not found yet has label "???" and no percent; a found one is named
 * (item name, "N bits", or "Old bottle") with its percent.
 */
export function extrasRows(data: ExtrasSource, found: Record<string, boolean> | undefined, itemNameOf: (item: any) => string | null = () => null): ExtrasRow[] {
    const flags = found ?? {};
    return Object.keys(data?.stages ?? {}).sort().map((stage) => {
        const area = areaOf(data, stage);
        const table = tableFor(data, stage);
        return {
            stage,
            area: area?.name ?? stage,
            tier: data.stages[stage].tier,
            total: totalPercent(table),
            entries: table.map((e) => {
                const isFound = !!flags[findKey(area.id, e)];
                const label = e.kind === "bits" ? `${e.bits} bits` : e.kind === "hint" ? "Old bottle" : (itemNameOf(e.item) ?? e.name);
                return { key: e.key, found: isFound, label: isFound ? label : "???", percent: isFound ? e.chance : null };
            }),
        };
    });
}
