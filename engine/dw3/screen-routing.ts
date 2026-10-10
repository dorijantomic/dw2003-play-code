// engine/dw3/screen-routing.ts
// Resolve a field HANDOFF screen id to a walker map id via the REAL screen table
// (data/screen_table.json — 239 entries mapping screen_id → {file,lbaIdx,stage}).
// Ported from web/screen-routing.js.
//
// Opening screens are NOT in the field table (separate screen objects in the original):
//   • 1280 (0x500) — the native registration / name-entry screen.
//   • 0xE01..0xE0C — movies; their return destinations are disc table data.

import {
  MOVIE_POST_GAME_DESTINATION,
  MOVIE_POST_GAME_INDEX,
  MOVIE_ROWS,
  type MovieRow,
} from "./movie-destinations.ts";

export interface FieldScreenRecord {
  stage?: number | null;
  alt?: { stage?: number | null };
}
export type FieldScreenTable = Record<string, FieldScreenRecord>;

/** The field's current screen id is shared by its primary and alternate overlay.
 *  Descriptor names and stage numbers are not screen ids. */
export function screenIdForStage(table: FieldScreenTable | undefined, mapId: string): number | null {
  for (const [id, row] of Object.entries(table ?? {})) {
    if ((row.stage != null && mapId === `s${row.stage}`) ||
        (row.alt?.stage != null && mapId === `s${row.alt.stage}`)) return Number(id);
  }
  return null;
}

/** Launch code 0x0e00 is this overlay's title screen, by the stage-select
 * tool's own developer label (STTITL). Both opening-movie rows carry it, so
 * the attract loop returns here. */
export const MOVIE_TITLE_SCREEN = 0x0e00;

/** STDWTITL's return destination, after the movie: launch low byte minus one
 *  selects the movie (pro/stdwtitl.s .L0x00000330-.L0x00000348). The dispatcher
 *  loads row+8, except movie 2 at ordinal 45, which stores screen 0x276 instead
 *  (.L0x00001144-.L0x00001198). This is independent of the requesting stage.
 *  Movie rendering/decoding is a separate presentation service. */
export function movieReturnScreen(launchCode: number, postGame: boolean): number | null {
  const row = movieRow(launchCode);
  if (!row) return null;
  return row.index === MOVIE_POST_GAME_INDEX && postGame ? MOVIE_POST_GAME_DESTINATION : row.destination;
}

/** The disc's movie row a launch code names, or null for any other overlay.
 *  Library 0x0E is the title overlay; its screen setup `F0x80082ec8`
 *  (exe-decomp/stdwtitl_c/F0x80082ec8.c) sends mode 13 to the END card and every
 *  other mode to `F0x80083f48(mode - 1)`, which allocates the movie object with
 *  that row index. */
export function movieRow(launchCode: number): MovieRow | null {
  if ((launchCode & 0xff00) !== 0xe00) return null;
  return MOVIE_ROWS[(launchCode & 0xff) - 1] ?? null;
}

// ── The field → battle handoff's transition selector ────────────────────────
//
// `F0x8008B798`, the field's battle setup (pro/fieldstg.s:8916-8919), reads the
// master story ordinal and writes the handoff's selector into the type-7 screen
// manager's +0x5C:
//
//   lw $v1, -0x4c90($v0)   # v1 = [0x8004b370]  (lui $v0, 0x8005 at :8912)
//   li $v0, 0x2b           # :8914  story ordinal 43
//   beq $v1, $v0, .L0x00008b44
//   li $a2, 0xe0a          # :8916  DELAY SLOT - runs on both arms
//   li $a2, 0x600          # :8917  the other arm only
//
// The selector's HIGH BYTE is the engine overlay library (the developers' own
// stage-select table names them: `data/stagslct_catalog.json`, 270 rows, library
// 2 = field stages, 6 = SFIGHT, 14 = STTITL) and the LOW BYTE is the mode inside
// it. So 0x600 is "battle" and 0xE0A is "title overlay, mode 10" = movie row 9,
// whose own destination is 0x600 - the same battle, one movie earlier. The mode
// and the destination are the disc's rows, not a special case.
export const BATTLE_HANDOFF_ORDINAL_43 = 0x2b;
export const BATTLE_HANDOFF_SELECTOR = 0x600;
/** The selector the handoff writes while the master ordinal is 43 - the window
 *  between the terminal fight (s820 writes 43) and the reunion (s780 writes 45). */
export const BATTLE_HANDOFF_SELECTOR_POST_FIGHT = 0xe0a;

export interface BattleHandoff {
  /** The selector the field writes into the screen manager's +0x5C. */
  selector: number;
  /** The movie the selector names, when it names one. */
  movie: MovieRow | null;
  /** Where the movie (or the bare selector) lands: 0x600, the battle. */
  destination: number | null;
}

export function battleHandoff(progressOrdinal: number): BattleHandoff {
  const selector = progressOrdinal === BATTLE_HANDOFF_ORDINAL_43
    ? BATTLE_HANDOFF_SELECTOR_POST_FIGHT
    : BATTLE_HANDOFF_SELECTOR;
  const movie = movieRow(selector);
  return { selector, movie, destination: movie ? movie.destination : null };
}

export type Route =
  | { kind: "nameentry" }
  | { kind: "warp"; to: string; spawn: null }
  | null;

export function createScreenRouter(
  table: FieldScreenTable | undefined,
  opts: { useAlt?: () => boolean } = {},
): { route(screenId: number, mapId?: string): Route } {
  function route(screenId: number, _mapId?: string): Route {
    if (screenId === 1280) return { kind: "nameentry" };
    const useAlt = opts.useAlt?.() ?? false;
    screenId = movieReturnScreen(screenId, useAlt) ?? screenId;
    const rec = table?.[String(screenId)];
    const selected = useAlt && rec?.alt?.stage != null ? rec.alt : rec;
    if (selected?.stage != null) return { kind: "warp", to: "s" + selected.stage, spawn: null };
    return null;
  }
  return { route };
}
