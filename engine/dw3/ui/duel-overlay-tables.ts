// Overlay data tables the composed duel reads by address, extracted from
// pro_cardgame.bin (base 0x80082CB0) and materialized into the session's memory
// because the composed DuelSession has no executable image to read them from.
//
//   INTER_PHASE_TABLE 0x800A5D5C — four-byte inter-phase records, [0] = the
//     effect opcode to queue, [2] = the next mode. queueInterPhaseBanner
//     (phase-banner.ts, F0x800A1AF8) reads the row duel+0x2F6 names. Row 1 is
//     { 0xA6, -, 0x02 } — the phase-banner opcode.
//   PHASE_BANNER_TABLE 0x800A58C4 — two-byte banner records, [0] = the widget
//     record, [1] = the id. showPhaseBanner (F0x800894E4) reads record index*2.
//
// Same approach as effect-vm-tables.ts: the bytes are data, extracted once and
// pinned; each port's own oracle re-reads the shipped image and would fail if
// these disagreed.

/** 64 bytes from 0x800A5D5C (sixteen inter-phase rows). */
export const INTER_PHASE_BYTES: readonly number[] = [
    0x00, 0x00, 0x00, 0x00, 0xa6, 0x00, 0x02, 0x00, 0xa0, 0x00, 0x03, 0x00, 0xa1, 0x00, 0x04, 0x00,
    0xa2, 0x00, 0x05, 0x00, 0xa3, 0x00, 0x06, 0x00, 0xa4, 0x00, 0x07, 0x00, 0xa5, 0x00, 0x08, 0x00,
    0xa0, 0x00, 0x03, 0x00, 0xa0, 0x00, 0x03, 0x00, 0x82, 0x00, 0xbf, 0x00, 0x82, 0x00, 0x1d, 0x00,
    0x82, 0x00, 0xcb, 0x00, 0x82, 0x00, 0x11, 0x00, 0x00, 0x00, 0xf1, 0xff, 0x40, 0x01, 0x04, 0x01,
];

/** 32 bytes from 0x800A58C4 (sixteen banner records). */
export const PHASE_BANNER_BYTES: readonly number[] = [
    0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x1f, 0x3e, 0x0b, 0x0c,
    0x00, 0x74, 0x00, 0x00, 0x00, 0x61, 0x00, 0x00, 0x00, 0xa4, 0x00, 0x00, 0x00, 0x61, 0x00, 0x00,
];

export const INTER_PHASE_TABLE = 0x800a5d5c;
export const PHASE_BANNER_TABLE = 0x800a58c4;

/**
 * 48 bytes from 0x800A5BF0 — the twelve intro-voice cue records, four bytes
 * each: [0] the cue id (s16, -2 = a skip control record and -1 = the end),
 * [2] the bias flag. The mode-2 Draw Phase's first arm waits for the intro
 * object (scene+0x0, handler F0x8009D540 intro-cue.ts) to walk this table to its
 * skip record; the composed session has no image to read it from, so it is
 * materialized here the same way the other two tables are.
 */
export const INTRO_CUE_BYTES: readonly number[] = [
    0x2b, 0x00, 0x01, 0x00, 0x0f, 0x00, 0x01, 0x00, 0xf6, 0x07, 0x00, 0x00, 0xf7, 0x07, 0x00, 0x00,
    0xf8, 0x07, 0x00, 0x00, 0xf9, 0x07, 0x00, 0x00, 0xfa, 0x07, 0x00, 0x00, 0xfe, 0xff, 0x00, 0x00,
    0x1d, 0x00, 0x01, 0x00, 0x16, 0x00, 0x01, 0x00, 0x6a, 0x00, 0x01, 0x00, 0xff, 0xff, 0x00, 0x00,
];

/**
 * The resident disc sector counts the intro cue loader's cache sizes its
 * buffers from — `LBA_LEN_SECTORS` (0x800474A4) at the cue ids the twelve
 * records name, per language (each language's voice archive has its own
 * length). Read out of the resident image `web/assets/native/screens/
 * resident.bin`; in the composed session (which has no image) they are
 * materialized into the session's memory the same way the three overlay tables
 * above are. A record whose bias flag is set adds the language index
 * (0x8005CCA8) to the cue, so the loader reads the entry at `baseId + language`.
 *
 * The table is the platform's disc geometry, and the cache's transfer latency
 * is derived from it (see `duel-session.ts` `DUEL_CD_SECTORS_PER_FRAME`).
 */
export const INTRO_CUE_SECTORS: readonly (readonly [number, readonly number[]])[] = [
    [43, [1, 2, 2, 2, 2, 2, 2]],
    [15, [1, 1, 1, 2, 1, 1, 2]],
    [2038, [50, 50, 50, 50, 47, 3, 3]],
    [2039, [50, 50, 50, 47, 3, 3, 3]],
    [2040, [50, 50, 47, 3, 3, 3, 3]],
    [2041, [50, 47, 3, 3, 3, 3, 7]],
    [2042, [47, 3, 3, 3, 3, 7, 6]],
    [29, [2, 3, 3, 3, 3, 3, 3]],
    [22, [3, 3, 3, 3, 3, 3, 3]],
    [106, [3, 4, 4, 4, 4, 4, 4]],
];
/** The resident sector table's cell (F0x80014200 reads it). */
export const LBA_LEN_SECTORS = 0x800474a4;
