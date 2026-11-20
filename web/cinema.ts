// web/cinema.js — the disc's five movie streams as one list of rows.
//
// Pure: no DOM, no fetch. The five rows themselves are authored here — the
// launch code, the player each code goes through and the label a fan reads —
// and everything else is looked up from the two tables the repo already ships:
//
//   * the disc's movie rows: engine/dw3/movie-destinations.ts (the twelve
//     12-byte rows pro/stdwtitl.s .L0x00004fe8-.L0x00005074 read through
//     F0x80083CC0), handed in as `movieRows`;
//   * the shipped streams: web/assets/movie/manifest.json, one record per disc
//     file with that file's own picture count and the mp4 the extractor built.
//
// A launch code's high byte names the STTITL overlay (0xE00) and its low byte
// minus one is the movie row (pro/stdwtitl.s:212-218), so a row can never name
// a stream the disc does not ship: it resolves through the row's disc file
// index into the manifest.

/** The launch code family every movie launch word carries. */
export const MOVIE_LAUNCH_FAMILY = 0xe00;

/**
 * The five streams, authored. `key` is the manifest's own movie name, the one
 * identifier the shipped record and the disc row share is the disc file index.
 * The two openings go through the title movie player (they are what the title's
 * attract loop hands it); the field movie and the two ending streams go through
 * the field movie player.
 */
const ROWS = [
    { key: "movieop2", label: "Opening — the first", code: 0xe01, adapter: "title" },
    { key: "movieopn", label: "Opening — the second", code: 0xe02, adapter: "title" },
    { key: "movied08", label: "The field movie (ordinal 43)", code: 0xe0a, adapter: "field" },
    { key: "moviee01", label: "Ending — part one", code: 0xe0b, adapter: "field" },
    { key: "moviee02", label: "Ending — part two", code: 0xe0c, adapter: "field" },
];

/** The table row a launch code names (low byte minus one). */
const rowIndexOf = (code) => (code & 0xff) - 1;

/** The manifest record for a disc movie row, by the disc file index the two share. */
function shippedRecord(manifest, row) {
    const movies = manifest?.movies ?? manifest ?? {};
    if (!row) return null;
    for (const [key, record] of Object.entries(movies)) {
        if (record && record.index === row.fileIndex) return { key, record };
    }
    return null;
}

/**
 * The room's five rows: `{ key, label, code, adapter, rowFrames, streamFrames, file }`.
 * `rowFrames` is the count the movie row carries — the count the player ends
 * the movie on — and `streamFrames` the count the shipped stream itself
 * carries; they differ (the stream runs a few pictures past the row's stop).
 * `movieRows` is the disc's table (engine/dw3/movie-destinations.ts), any
 * shape that carries `index`, `fileIndex` and `frames`.
 */
export function cinemaRows(manifest, movieRows) {
    const table = Array.isArray(movieRows) ? movieRows : [];
    return ROWS.map((authored) => {
        const row = table.find((candidate) => candidate && candidate.index === rowIndexOf(authored.code)) ?? null;
        const shipped = shippedRecord(manifest, row);
        return {
            key: shipped?.key ?? authored.key,
            label: authored.label,
            code: authored.code,
            adapter: authored.adapter,
            rowFrames: row ? row.frames : 0,
            streamFrames: shipped ? shipped.record.frames : 0,
            file: shipped ? shipped.record.file : "",
        };
    });
}

/**
 * The row a launch code names. Without a list this is the authored row (key,
 * label, code, adapter); pass the list `cinemaRows` returned for the full row.
 */
export function rowFor(code, rows = ROWS) {
    return rows.find((row) => row.code === code) ?? null;
}
