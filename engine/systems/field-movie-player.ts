// The field-reachable movie player: the title overlay's movie object, ported once.
//
// The original plays EVERY full-motion video with one object in `pro/stdwtitl`
// (docs/research/overlays/stdwtitl.md). A launch code's low byte minus one is the
// movie row (`F0x80083f48`, exe-decomp/stdwtitl_c/F0x80083f48.c; the screen setup
// `F0x80082ec8` sends mode 13 to the END card and every other mode m to the movie
// object with index m-1). The field reaches it through its battle handoff:
// `F0x8008B798` (fieldstg file 0x8ae8) writes selector 0xE0A instead of 0x600
// while the master story ordinal reads 0x2b = 43 (pro/fieldstg.s .L0x00008b30-
// .L0x00008b54), and 0xE0A is title-overlay mode 10 = movie row 9 = the disc's
// MOVIED08_STR, whose own return selector is 0x600 — the battle the field was
// already starting (engine/dw3/screen-routing.ts `battleHandoff`).
//
// This is the movie object's own state machine, with the presentation left to the
// host:
//
//   * The row carries {disc file index, frame count, return selector}
//     (pro/stdwtitl.s .L0x00004fe8, twelve 12-byte rows; engine/dw3/
//     movie-destinations.ts). `F0x80083cc0` resolves it and stores the return
//     selector on the movie screen (+0x54); when the movie is over that screen
//     calls the resident launcher `[0x8004B440](destination, 0)`
//     (exe-decomp/stdwtitl_c/F0x80083cc0.c).
//   * `F0x80083c70` stores the row's file index and frame count for the movie
//     object (`[0x80089268]`, `[0x8008926C]`, exe-decomp/stdwtitl_c/F0x80083c70.c).
//   * The movie object (`F0x80083944`) is stepped once per console vertical blank:
//     state 1 runs one decode step + the guarded wait, then ends on the end flag
//     `[0x80089264]` or on the raw pad's START bit 0x8 (stdwtitl.s .L0x00000e74-
//     .L0x00000e9c; exe-decomp/stdwtitl_c/F0x80083944.c). State 3 frees the stream.
//   * The end flag is raised by the frame fetch when the STR header's frame number
//     (+0x08) is no longer below the row's count (stdwtitl.s .L0x00000960-
//     .L0x00000988; exe-decomp/stdwtitl_c/F0x800835d4.c). The fetch gives up after
//     its budget rather than blocking, so a struggling disc drops pictures instead
//     of freezing the console.
//
// The stream is a PSX STR stream (Mode 2 raw sectors, MDEC video + XA ADPCM
// audio). Measured from the disc: MOVIED08 is 320x416 video at 15 fps — 450
// stream pictures, of which the row's 434 are played, so the movie stops 16
// pictures early, exactly as both opening rows do (1776 of 1792). The player
// counts pictures on the console's blank cadence: 15 pictures per second on the
// 50 Hz PAL blank the field already runs on (FIELD_TICK_RATE, engine/systems/
// field-movement.ts) = 3 pictures per 10 blanks. Picture k is complete once
// k * 10/3 blanks have passed; the movie ends when the row's count is reached —
// 434 pictures = 1447 blanks = 28.94 s (434/15 = 28.93 s).
//
// The display geometry is the movie object's own, shared by every movie it plays:
// a 320x480 interlaced display whose 320x416 picture is uploaded from Y=0x24 (36)
// (stdwtitl.s L0x00000b38/L0x00000be8; tools/extract_stdwtitl_ui.py). Half the
// interlaced height is the 320x240 logical picture, so the host draws it at
// [0, 18, 320, 208] — the same rect the shipped title player uses
// (web/assets/data/stdwtitl_ui.json `movie_display.logical`).

import { movieRow } from "../dw3/screen-routing.ts";
import { type MovieRow } from "../dw3/movie-destinations.ts";
import { FIELD_TICK_RATE } from "./field-movement.ts";

/** The STR streams' own picture rate, measured from the disc (ffprobe of the raw
 *  stream: `mdec, 320x416, 15 fps`); the movie rows' frame counts agree
 *  (MOVIED08 434 pictures ≈ 29 s, both openings 1776 ≈ 118.4 s). */
export const MOVIE_STREAM_FPS = 15;

/** The movie picture as the stream carries it (the STR header's own size). */
export const MOVIE_PICTURE_WIDTH = 320;
export const MOVIE_PICTURE_HEIGHT = 416;

/** The display the movie screen sets up: 320x480 interlaced (F0x80083cc0's
 *  `unk174(0x140, 0x1E0, 1, 1)`). */
export const MOVIE_INTERLACED_DISPLAY = { width: 320, height: 480 } as const;

/** Where the picture sits in the 320x240 logical screen: the upload rect's
 *  Y=0x24 in the 480-line space is 18 in the 240-line one, and 416 interlaced
 *  lines are 208 logical. Read out, not chosen. */
export const MOVIE_DISPLAY_RECT = { x: 0, y: 18, width: 320, height: 208 } as const;

/** The two ways the original ends a movie (F0x80083944 state 1): its own frame
 *  count, or the pad's START bit. `error` is the host's browser-safety end for a
 *  stream that cannot be loaded; it is not an original behaviour. */
export type MovieEndReason = "last-picture" | "start" | "error";

export interface FieldMovieDiagnostics {
  open: boolean;
  /** The launch code the field wrote (e.g. 0xe0a). */
  code: number;
  /** The movie row the code names. */
  row: MovieRow | null;
  /** Pictures complete so far (capped at the row's count). */
  pictures: number;
  /** The row's own count. */
  frames: number;
  /** Console vertical blanks consumed. */
  blanks: number;
  endReason: MovieEndReason | null;
  /** The row's return selector, when a movie is loaded. */
  destination: number | null;
}

/**
 * The port of the movie object's play-through. One instance plays one movie at a
 * time; `open` a launch code, `advanceBlanks` it on the console's cadence,
 * `skip` for the pad's START. The host owns pixels and sound; this owns the
 * count, the end and the return selector.
 */
export class FieldMoviePlayer {
    private code = 0;
    private row: MovieRow | null = null;
    private blanks = 0;
    private ended: MovieEndReason | null = null;

    /** `F0x80083f48` + `F0x80083cc0`: the launch code names the movie row. Returns
     *  the row, or null for a code that names no movie (the player stays closed). */
    open(launchCode: number): MovieRow | null {
        const row = movieRow(launchCode);
        this.code = launchCode;
        this.row = row;
        this.blanks = 0;
        this.ended = null;
        return row;
    }

    /** One or more console vertical blanks (F0x80083944 case 1 runs once per
     *  blank). Pictures advance at the stream's rate on the blank cadence. */
    advanceBlanks(blanks: number): void {
        if (!this.isOpen() || !(blanks > 0)) return;
        this.blanks += Math.floor(blanks);
        if (this.pictures() >= this.frames()) this.ended = "last-picture";
    }

    /** The pad's START bit ends the movie early (stdwtitl.s .L0x00000e88-
     *  .L0x00000e9c). Both end arms launch the row's destination. */
    skip(): void {
        if (!this.isOpen()) return;
        this.ended = "start";
    }

    /** The host's browser-safety end for a stream that cannot load or play. Not a
     *  ported arm: it exists so a broken asset cannot strand the field. */
    abort(): void {
        if (!this.isOpen()) return;
        this.ended = "error";
    }

    /** The movie is over the moment it ends; the host then hands back. */
    isOpen(): boolean {
        return this.row !== null && this.ended === null;
    }

    /** Pictures complete so far, on the 15/50 cadence (capped at the row count). */
    pictures(): number {
        if (this.row === null) return 0;
        const shown = Math.floor((this.blanks * MOVIE_STREAM_FPS) / FIELD_TICK_RATE);
        return Math.min(shown, this.row.frames);
    }

    /** The row's own picture count (the disc stops the movie on it). */
    frames(): number {
        return this.row?.frames ?? 0;
    }

    blanksElapsed(): number {
        return this.blanks;
    }

    endReason(): MovieEndReason | null {
        return this.ended;
    }

    /** The row's return selector: what the movie screen launches when it ends
     *  (F0x80083cc0 state 1). For row 9 that is 0x600, the battle. */
    destination(): number | null {
        return this.row?.destination ?? null;
    }

    diagnostics(): FieldMovieDiagnostics {
        return {
            open: this.isOpen(),
            code: this.code,
            row: this.row,
            pictures: this.pictures(),
            frames: this.frames(),
            blanks: this.blanks,
            endReason: this.ended,
            destination: this.destination(),
        };
    }
}
