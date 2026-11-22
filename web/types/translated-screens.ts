// Types the translated screens (web/*-translated.ts) share. Type-only: nothing here is emitted.
import type { GameState } from "../game/types.js";
import type { SfxPlayerContext } from "./audio.js";
import type { CursorGlyphTable } from "../../engine/dw3/ui/resident-text-host.js";
import type { EngineUi } from "./battle.js";

/** The sound player a screen is handed (web/audio.ts createSfxPlayer): the translated screens only call `playPacked` on it. */
export type PackedSfx = SfxPlayerContext;

/** The resident cursor glyph table. web/resident-data.ts types it `{}` (its `ui` import carries no types); it is the engine's table. */
export type ResidentGlyphs = CursorGlyphTable;

/** The data a battle menu's `start` hands its engine session: the extracted tables, the font, the text banks and the glyph table. */
export interface BattleMenuData {
  tables: Uint8Array;
  profiles: Uint8Array;
  font: Uint8Array;
  banks: ReadonlyMap<number, Uint8Array>;
  cursorGlyphs?: ResidentGlyphs;
}

/** One recorded move of a menu session (a copy of the session's own record, so only its keys matter here). */
export type BattleMenuMove = Record<string, unknown>;

/** The display clock every translated screen ticks its session on (engine/dw3/ui/pad-words.ts). */
export type MenuDisplayClock = InstanceType<EngineUi["MenuDisplayClock"]>;

/** What a screen keeps of a failure it caught: only the message is ever read. */
export type ThrownError = Error;

/** The walker's state as a screen reads it: every field optional, because a screen opened with no state runs on `{}`. */
export type WalkerState = Partial<GameState>;
