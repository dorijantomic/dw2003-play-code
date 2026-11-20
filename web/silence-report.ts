// web/silence-report.js — what this build cannot sound, worked out from the shipped
// tables rather than from a list of names.
//
// The Sound Test (web/soundtest.js) can only mark a whole category "no sample in
// this build". This module answers the same honesty per row, in game terms, for
// the page and the printer (web/silence-report.html, tools/check_sound_coverage.mjs):
//
//   * sample    — the row's own bank holds the extracted sample for its packed id
//                 (the common manifest for COMMON, area_manifest.json otherwise).
//   * stem      — the row is a music START (bits 30+29 set, bit 31 clear, see
//                 web/packed-sound.js) and build_music.py rendered that bank and
//                 SEQUENCE: seq 0 keeps the plain bank name, any other sequence is
//                 "<bank>_<seq>" (env205_3, cbtl00_4, ...).
//   * bankTheme — no stem of its own, but the bank's rendered theme IS this
//                 sequence, so the piece plays approximately (TRAINING).
//   * silent    — no sample, no stem: the row has no audio in this build at all.
//
// The catalogue, manifest.json, area_manifest.json and music/index.json are the
// whole input; nothing here re-lists a row. The two small tables below are
// authoring facts, not disc data:
//   * START_WORDS: the music-start words whose stem is named after the record, not
//     the bank. build_music.py renders them by hand (COMMON_JINGLES, SEQ_OVERRIDES)
//     and web/game.js names the two it plays (PACKED_MUSIC); the pack id is the
//     record's own, so it cannot be derived from the catalogue.
//   * BANK_THEME_SEQ: which sequence of a bank was rendered under the plain bank
//     name. build_music.py SEQ_OVERRIDES pins bgm031 to seq 2 (stgtrain file 0x30b8,
//     docs/research/audio/sound-system.md §SEP: "the train theme = seq 2").
//
// KNOWN_FIRES and the movie rows are the game-side facts a shipped table does not
// carry: two of the silent cues are really fired by the original, and the title
// overlay's 12-row movie table lives only in the walker docs
// (docs/research/overlays/stdwtitl.md rows 0-11). The page carries the seven row
// names it needs and never reads that folder at run time.
import { packedIsMusicStart, packedKey } from "./packed-sound.js";

/** Music-start words whose stem is named after the record (build_music.py's jingles). */
export const START_WORDS = Object.freeze({
    "0x60040002": "demo_bgm",   // common SEP seq 2, DEMO_BGM
    "0x60040008": "gameover",   // common SEP seq 8, GAMEOVER
    "0x6004001e": "w_jingle",   // common SEP seq 30, W_JINGLE (a sample too, so it never gets here)
    "0x611c0000": "ttlbgm",     // archive 71, TITLEBGM
});

/** bank -> the sequence build_music.py rendered as the plain bank stem (SEQ_OVERRIDES). */
export const BANK_THEME_SEQ = Object.freeze({ bgm031: 2 });

/** The movie table rows with no shipped stream (stdwtitl.md rows 2-8: MOVIED01-07). */
export const MOVIE_GAP_ROWS = Object.freeze([
    "MOVIED01", "MOVIED02", "MOVIED03", "MOVIED04", "MOVIED05", "MOVIED06", "MOVIED07",
]);

/** MOVIEE03/04 are language variants of MOVIEE02's row, not rows of their own. */
export const MOVIE_VARIANTS = Object.freeze(["MOVIEE03", "MOVIEE04"]);

/**
 * The silent rows the original really fires: COM_CNFS is the battle confusion swap
 * (a live capture caught the track change on 2026-10-06; docs/research/audio/
 * sound-system.md §SEP and the rejected "Confusion has a tune" idea), and EAUCTION
 * is s261's auction cue — engine/systems/auction.ts plays that scene but asks for
 * no sound. The other three silent rows have no sited caller.
 */
export const KNOWN_FIRES = Object.freeze({
    COM_CNFS: "the battle confusion swap — a live capture caught the track change (2026-10-06)",
    EAUCTION: "the auction — engine/systems/auction.ts plays the scene but asks for no sound",
});

const lower = (v) => String(v ?? "").toLowerCase();

function wordOf(id) {
    const n = parseInt(String(id), 16);
    return Number.isFinite(n) ? n >>> 0 : null;
}

/** The packed ids a built manifest holds, lowercased, so a catalogue row can ask it. */
function idsOf(rows) {
    const out = new Set();
    for (const meta of Object.values(rows ?? {})) if (meta?.id) out.add(lower(meta.id));
    return out;
}

/**
 * The stem build_music.py would have written for one music start: the hand-named
 * jingle if the word has one, else the bank name for seq 0 and "<bank>_<seq>" for
 * every other sequence.
 */
export function stemForWord(word, bank, startWords = START_WORDS) {
    const named = startWords?.[packedKey(word >>> 0)];
    if (named) return named;
    const seq = (word >>> 0) & 0xffff;
    return seq === 0 ? bank : `${bank}_${seq}`;
}

/**
 * Every catalogue row, marked with how this build can sound it.
 *
 * `{catalogue, common, area, stems, startWords}` are the shipped tables: the
 * 71-category Sound-Test catalogue, web/assets/sfx/manifest.json and
 * area_manifest.json, and web/assets/music/index.json. Returns the four counts
 * (`sample`, `stem`, `bankTheme`, `silent`), the `silent` rows themselves (with
 * `fires` / `how` for the two the original really plays), the `themes` rows served
 * by a bank theme, and the full `marks` list.
 */
export function coverage({ catalogue, common, area, stems, startWords = START_WORDS } = {}) {
    const haveStem = new Set((stems ?? []).map(lower));
    const commonIds = idsOf(common);
    const areaIds = new Map();
    for (const [bank, rows] of Object.entries(area ?? {})) areaIds.set(lower(bank), idsOf(rows));

    const marks = [];
    for (const cat of catalogue?.categories ?? []) {
        const bank = lower(cat.name);
        // The common bank is always resident and is its own manifest; every other
        // category is one of the swappable area banks.
        const own = bank === "common" ? commonIds : areaIds.get(bank) ?? null;
        for (const sound of cat.sounds ?? []) {
            const id = lower(sound.id);
            const word = wordOf(sound.id);
            const base = { category: cat.name, name: sound.name, id: sound.id };
            if (own?.has(id)) {
                marks.push({ ...base, kind: "sample", stem: null, why: "the bank holds the extracted sample" });
                continue;
            }
            if (word === null || !packedIsMusicStart(word)) {
                const fires = !!KNOWN_FIRES[sound.name];
                marks.push({
                    ...base, kind: "silent", stem: null, fires,
                    why: "not a music start, and its bank has no sample for the id",
                    how: fires ? KNOWN_FIRES[sound.name] : "",
                });
                continue;
            }
            const stem = stemForWord(word, bank, startWords);
            if (haveStem.has(stem)) {
                marks.push({ ...base, kind: "stem", stem, why: `music start, rendered as ${stem}` });
                continue;
            }
            const themeSeq = BANK_THEME_SEQ[bank];
            if (themeSeq != null && (word & 0xffff) === themeSeq && haveStem.has(bank)) {
                marks.push({
                    ...base, kind: "bankTheme", stem: bank,
                    why: `music start; the bank's theme ${bank} is the rendered piece, so it is approximate`,
                });
                continue;
            }
            const fires = !!KNOWN_FIRES[sound.name];
            marks.push({
                ...base, kind: "silent", stem: null, fires,
                why: `music start with no rendered stem (${stem})`,
                how: fires ? KNOWN_FIRES[sound.name] : "",
            });
        }
    }
    const silent = marks.filter((m) => m.kind === "silent");
    const themes = marks.filter((m) => m.kind === "bankTheme");
    return {
        rows: marks.length,
        sample: marks.filter((m) => m.kind === "sample").length,
        stem: marks.filter((m) => m.kind === "stem").length,
        bankTheme: themes.length,
        silent,
        themes,
        marks,
    };
}

/**
 * The catalogue categories with no built bank, split by whether a stage really
 * loads that bank (`archives` = web/assets/data/map_sound_archives.json).
 * `missing` is every category name absent from area_manifest.json, `stageBanks`
 * the ones a stage archive uses, `other` the rest (ttlbgm, a music stem).
 */
export function bankGaps(archives, area, catalogue) {
    const built = new Set(Object.keys(area ?? {}).map(lower));
    const stageBanks = new Set(Object.values(archives ?? {}).map((rec) => lower(rec?.bank)).filter(Boolean));
    const categories = (catalogue?.categories ?? []).map((c) => lower(c.name));
    const missing = categories.filter((name) => !built.has(name));
    const stage = missing.filter((name) => stageBanks.has(name));
    return {
        missing,
        stageBanks: stage,
        other: missing.filter((name) => !stageBanks.has(name)),
        count: missing.length,
        stageCount: stage.length,
        banked: categories.length - missing.length,
    };
}

/**
 * The maps with no theme: a map whose manifest row carries no music, or that has
 * no record in map_sound_archives.json at all. Exactly s260 today.
 */
export function themeGaps(archives, maps) {
    const rows = Array.isArray(maps) ? maps : maps?.maps ?? [];
    return rows
        .filter((map) => !map?.music || !(archives ?? {})[map.id])
        .map((map) => String(map.id))
        .sort();
}

/**
 * The title overlay's 12-row movie table against the streams that ship.
 * `rows` are the table rows with no stream (MOVIED01-07); `shipped` is
 * web/assets/movie/manifest.json's `movies` object (or its keys). MOVIEE03/04 are
 * reported as language variants of E02's row, never counted as rows.
 */
export function movieGaps(rows, shipped) {
    const keys = Array.isArray(shipped) ? shipped.slice() : Object.keys(shipped ?? {});
    const have = new Set(keys.map(lower));
    const missing = (rows ?? []).map(String).filter((name) => !have.has(lower(name)));
    // The manifest keys are the disc's own names lowercased; the table's names are
    // upper case, so the shipped rows are named the way the table names them.
    const shippedRows = keys.map((key) => String(key).toUpperCase());
    return {
        rows: shippedRows.length + missing.length,
        shipped: shippedRows.length,
        shippedRows,
        missing,
        variants: MOVIE_VARIANTS.filter((name) => !have.has(lower(name))),
    };
}

/**
 * The alternate play ids (`alt_play_ids`) nothing plays: every one named with the
 * stem it would start. Needs the catalogue for the archive -> bank join (an
 * alternate may target a different bank than the stage's own) and the stem list to
 * say whether the build really has it.
 */
export function altGaps(archives, catalogue = [], stems = []) {
    const have = new Set((stems ?? []).map(lower));
    const cats = Array.isArray(catalogue) ? catalogue : catalogue?.categories ?? [];
    const bankOf = {};
    for (const c of cats) bankOf[c.archive_id] = lower(c.name);
    const rows = [];
    for (const [stage, rec] of Object.entries(archives ?? {})) {
        for (const word of rec?.alt_play_ids ?? []) {
            const packed = wordOf(word);
            const bank = packed === null ? null : bankOf[(packed >>> 18) & 0x7f] ?? null;
            const stem = bank === null ? null : stemForWord(packed, bank);
            rows.push({ stage, word, bank, stem, present: !!stem && have.has(stem) });
        }
    }
    const byStem = {};
    for (const row of rows) if (row.stem) byStem[row.stem] = (byStem[row.stem] ?? 0) + 1;
    const missing = rows.filter((r) => !r.present).map((r) => ({ stage: r.stage, word: r.word, stem: r.stem }));
    return { count: rows.length, rows, byStem, missing };
}
