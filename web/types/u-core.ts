// Type-only helpers for the battle / field modules (web/game, web/battle, web/battle3d).
// Nothing here runs: interfaces and type aliases only.

import type { BattleStartArgs, BattleWinResult } from "../battle/core/types.js";

// A screen object that may expose the optional quad wipe (save screen, book screens).
export interface TransitionQuadScreen {
  showTransitionQuad?: (on: boolean) => void;
}

// Anything that may be closed when it is still open (textbox, dialogue box).
export interface Closeable {
  close?: () => void;
}

// The field state objects that hold the ordinal-43 movie's resolve callback (state S, web/game/state.ts).
export interface FieldMovieHost {
  fieldMovieDone?: (() => void) | null;
}

/** One partner row on the results overlay: the fighter at that position, what it earned and the
 *  forms the win opened (buildFightReportRows, web/fight-report-rows.ts). */
export interface FightReportRow {
  index: number;
  /** the digimon.json id the fighter's body is */
  rookieId?: number;
  name?: string;
  level?: number;
  /** the EXP this fight paid it */
  xp?: number;
  /** the forms it can now turn into */
  forms?: unknown[];
}

// The options the results overlay is opened with (openFightReport, web/game/ui-openers.ts).
export interface FightReportOptions {
  rows?: FightReportRow[];
  /** the pages the report screen shows, already built for it */
  pages?: unknown[] | null;
  /** the menu adapter each participant position drew through */
  adapterByIndex?: unknown;
  rewardXp?: number;
  /** the item def id the fight dropped; droppedItem is its name */
  dropItemId?: number | null;
  droppedItem?: string | null;
  battleId?: number;
  onClose?: (() => void) | null;
}

// The options the quest layer hands to startQuestBattle (web/game/battle-launch.ts). A loss is
// handed back with the party restored, so onLose never has to undo anything itself.
export interface QuestBattleOptions {
  /** the battle id that keys battle_rewards; the caller nulls it when the roll had one */
  screenId?: number | null;
  onWin?: (result: BattleWinResult) => void;
  onFlee?: () => void;
  onLose?: () => void;
  mapId?: number;
  lead?: boolean;
}

// The options the dev toolset hands to battle.start / startScreen / startParty (window.__dev):
// the same arguments the field hands the engine, plus `lead` for the 1v1 startScreen path.
export interface DevBattleOptions extends BattleStartArgs {
  lead?: boolean;
}

/** What a many-vs-many fight hands its callbacks: the won / fled bits off the host's own record. */
export interface MpFightResult {
  won?: boolean;
  fled?: boolean;
  [field: string]: unknown;
}

/** The callbacks a many-vs-many fight reports back to the field with. */
export interface MpFightHandlers {
  onWin?: (result: MpFightResult) => void;
  onFlee?: () => void;
  onLose?: () => void;
}

// The many-vs-many launch: the foes, the partner's id, the label the window shows and the
// callbacks the field battle reports back to (web/game/battle-launch.ts).
export interface MpLaunchOptions {
  /** one encounter entry per foe (the party entries the field fights) */
  foes?: unknown[];
  /** the telegraphed partner's id (myId's peer) */
  withId?: number;
  label?: string;
  /** the battle id that keys the music and the rewards, null when the roll found none */
  screenId?: number | null;
  /** the challenge record a serialized bout carries (null for a wild fight) */
  challenge?: unknown;
  opts?: MpFightHandlers;
}

// The practice bout against a bot partner: same shape, no partner id.
export interface MpPracticeOptions {
  foes?: unknown[];
  label?: string;
  screenId?: number | null;
  opts?: MpFightHandlers;
}
