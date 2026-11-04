// web/soundtrack.js — the disc's whole soundtrack, grouped the way a fan thinks
// of it: every map theme with the places whose stage entry plays it, every
// battle theme with the stages whose encounter screens trigger it, and the
// jingles / one-shots that are neither.
//
// Pure: no DOM, no fetch. The page (web/soundtrack.html) and the node test hand
// it the four lists the repo already ships — music/index.json (the rendered
// stems), data/map_sound_archives.json (each stage's sound archive and music
// play id), data/battle_music.json (each stage's battle-trigger records) and
// manifest.json's maps (stage id -> place name). Nothing here is a new data
// file and nothing is guessed: a track the shipped lists do not name never
// becomes a row.
//
// The naming rule is the disc's own (docs/research/ui/music.md): a play id
// addresses one sound archive (bits 18-24, docs/research/audio/sound-system.md)
// and that archive is one bank whose SEP holds up to 16 sequences; the play
// id's low 16 bits pick the sequence, and the stage plays sequence 0 unless the
// id says otherwise — so sequence 0 is `<bank>.ogg` and sequence N is
// `<bank>_N.ogg` (env205_3 is the shipped example).
import { packedArchive } from "./packed-sound.js";

// "Central Sector — Asuka City" reads as just "Asuka City" to a player.
const SECTOR_PREFIX = /^(Central|East|South|West|North) Sector\s*—\s*/;
// A row can cover 18 places (bgm004 plays in every inn and tower); the label
// names the first few and counts the rest rather than becoming a paragraph.
const MAX_PLACES = 6;

/** The rendered stem a play id names: `bank` for sequence 0, `bank_<seq>` otherwise. */
export function stemOfPlayId(playId, archiveToBank) {
    const word = typeof playId === "string" ? parseInt(playId, 16) : playId;
    if (!Number.isFinite(word)) return null;
    const bank = archiveToBank ? archiveToBank[packedArchive(word)] : null;
    if (!bank) return null;
    const seq = word & 0xffff;
    return seq === 0 ? bank : bank + "_" + seq;
}

/** Field and battle themes are held by the game; a jingle rings out once. */
export function playMode(kind) {
    return kind === "field" || kind === "battle" ? "loop" : "jingle";
}

function placeName(name) {
    return name ? String(name).replace(SECTOR_PREFIX, "") : "";
}

function fieldLabel(stages, nameOf) {
    const places = [];
    for (const stage of stages) {
        const place = placeName(nameOf.get(stage)) || stage;
        if (!places.includes(place)) places.push(place);
    }
    const shown = places.slice(0, MAX_PLACES);
    const more = places.length - shown.length;
    return shown.join(" · ") + (more > 0 ? ` +${more} more` : "");
}

const count = (n, thing) => `${n} ${thing}${n === 1 ? "" : "s"}`;

/**
 * Every track of the disc as one row: `{ track, kind, label, stages, screens }`.
 * kind is "field" (map themes, stages = the stage ids that play it),
 * "battle" (battle themes, screens = `{stage, screen}` for every trigger
 * record) or "jingle" (everything else, both lists empty). The three kinds
 * partition the stems exactly: one row per built stem, no invented track.
 */
export function soundtrackRows({ stems, mapArchives, maps, battleMusic }) {
    const index = new Set(stems || []);
    const nameOf = new Map((maps || []).map((m) => [m.id, m.name]));

    // Which bank each archive number names, straight from the stage table.
    const archiveToBank = {};
    for (const entry of Object.values(mapArchives || {})) {
        if (entry && entry.archive != null && entry.bank) archiveToBank[entry.archive] = entry.bank;
    }

    // Field themes: one row per stem, stages in the order the stage table lists them.
    const field = new Map();
    for (const [stage, entry] of Object.entries(mapArchives || {})) {
        if (!entry) continue;
        const track = stemOfPlayId(entry.play_id, archiveToBank);
        if (!track || !index.has(track)) continue;
        if (!field.has(track)) field.set(track, []);
        field.get(track).push(stage);
    }

    // Battle themes: one row per bank, every trigger screen kept with its stage.
    const battle = new Map();
    for (const [stage, records] of Object.entries(battleMusic || {})) {
        for (const rec of records || []) {
            if (!rec || !index.has(rec.bank)) continue;
            let row = battle.get(rec.bank);
            if (!row) battle.set(rec.bank, (row = { stages: [], screens: [] }));
            if (!row.stages.includes(stage)) row.stages.push(stage);
            row.screens.push({ stage, screen: rec.screen_id });
        }
    }

    const rows = [];
    const used = new Set();
    for (const [track, stages] of field) {
        used.add(track);
        rows.push({ track, kind: "field", label: fieldLabel(stages, nameOf), stages, screens: [] });
    }
    for (const [track, row] of battle) {
        used.add(track);
        const label = `${count(row.stages.length, "stage")} · ${count(row.screens.length, "encounter screen")}`;
        rows.push({ track, kind: "battle", label, stages: row.stages, screens: row.screens });
    }
    for (const track of stems || []) {
        if (used.has(track)) continue;
        rows.push({ track, kind: "jingle", label: "one-shot — rings once", stages: [], screens: [] });
    }
    return rows;
}
