// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

import type { BattleStartArgs, BattleWinResult } from "../battle/core/types.js";
import type { ChatPacket } from "../types/chat.js";

/** The tri-state story-flag adapter the field code gates on (web/flag-store.ts createFlagStore). */
export interface FlagStore {
  /** 1 = set, 0 = clear, null = a bank the walker does not model (stays dormant) */
  get(id: number, current?: number): number | null;
  matches(id: number, expected: number): boolean;
  /** the stored-bit backend the adapter reads through */
  raw: unknown;
  set(id: number, value: number | boolean): void;
}

/** One held stack of the bag: an item id and how many of it (web/quartermaster.ts poolFrom). */
export interface InventoryRow {
  id: number;
  qty: number;
}

export interface GameState {
  _animTime?: number;
  _bits: number;
  _chapterOverride: number;
  _cutTarget?: any;
  _encCounter: number;
  _encLevel: number;
  _encTick: number;
  _footstepT?: number;
  _idleTime?: number;
  _inCutscene?: boolean;
  _indicatorKey?: string;
  _questBucket?: number;
  _questChase?: boolean;
  /** what the last chase came to, kept after the step is cleaned up (web/game/quest-scenes.ts endQuestChase) */
  _questChaseLast?: { result: number | string | null; target: number | string | null; distance: number; seconds: number; };
  /** what the running chase is chasing: an npc id or a quest fx name */
  _questChaseTarget?: number | string | null;
  _questGhosts?: Map<string, unknown>;
  _questScene?: boolean;
  _questSceneFailed?: boolean;
  _rosterOwned: number;
  _seenEmotes?: Set<string>;
  _sparkleSeq?: number;
  _subEntering?: boolean;
  _subThrustHeld?: boolean;
  /** the sound handle the thrust loop was started with (web/sound.ts) */
  _subThrustSound?: any;
  _subTurn?: number;
  activeClip?: string;
  allOrdinals: number[];
  /** per tile, the ambush the stage script armed (parsed JSON) */
  ambushTiles?: Record<string, unknown>;
  animTime: number;
  /** the running auction's state (engine/systems/auction.ts) */
  auction: any;
  auctionPending?: boolean;
  bits?: number;
  /** the body the player is talking through, and the field lock its block interaction holds */
  blockEngage: { ix: any; npc: any; } | null;
  chapter?: number;
  /** the chapter table (parsed JSON) */
  chapterTable: any;
  /** the manifest char id of the leader ("p003pken"...) */
  charId: string | null;
  /** the leader's roster slot, 0..2 */
  charIdx: number;
  /** char id -> the loaded sprite image ("loading" while it is on its way) */
  charImgs: Record<string, any>;
  climb?: any;
  /** sprite pack id -> the loaded clip sheet ("loading" while it is on its way) */
  clipImgs: Record<string, any>;
  /** map id -> the parsed collision grid */
  collision: Record<string, any>;
  debugAnim?: boolean;
  dialogues: any;
  /** char id -> the partner's name */
  digimonNames: Record<string, string>;
  dir: string;
  diveDemo: any;
  diveForm: any;
  diveFormMarkers: any;
  diveNetwork: Map<string, any>;
  endScreen?: any;
  endScreenDone?: () => void;
  entryCompanion?: number;
  entryKey?: number;
  /** one entry per party slot: what that member wears, by part */
  equipment: Record<string, number>[];
  events: any;
  findings?: any;
  fireTrap?: any;
  fireTraps?: any;
  fishing?: any;
  fishingBudget?: number;
  fishingExtras?: any;
  fishingSpots?: any;
  flags: FlagStore;
  gondolaAutoFired?: boolean;
  gunslingerLatch?: any;
  gymExtra?: any;
  handoffHold: { ticks: number; exit: { to: string; spawnX: number; spawnY: number; dir: string; stepOp: any; }; } | null;
  iceSlide?: any;
  /** the bag: one row per held item */
  inventory: InventoryRow[];
  /** the pad buttons held this frame */
  keys: Set<string>;
  languageByte?: number;
  launch: any;
  /** assets/manifest.json as fetched */
  manifest: any;
  /** map id -> the loaded foreground image */
  mapFgImgs: Record<string, any>;
  /** map id -> the loaded ground image */
  mapGroundImgs: Record<string, any>;
  mapGroundIndex: any;
  mapIdx: number;
  /** map id -> the loaded map image */
  mapImgs: Record<string, any>;
  mapLayer2: any;
  /** map id -> the loaded layer-2 image */
  mapLayer2Imgs: Record<string, any>;
  /** map id -> part -> the loaded native-resolution image */
  mapNativeImgs: Record<string, any>;
  mapOverlays: any;
  mapTiles: any;
  menuOpen: boolean;
  moving: boolean;
  nameEntry?: any;
  nameEntryDone?: () => void;
  newMaps?: { records: any[]; scenes: any; exits: any; } | null;
  /** char id -> the loaded npc image */
  npcImgs: Record<string, any>;
  npcSprites?: Record<string, any>;
  onExit?: boolean;
  ordinalByStage: Record<string, number>;
  packId: string;
  packSelect?: any;
  packSelectDone?: () => void;
  padLayoutLatch?: number;
  padSwitch?: any;
  partnerStats: any;
  /** the deployed party's char ids (null slots are empty) */
  party: (string | null)[];
  partyStats: any;
  /** the duel the field is about to start */
  pendingDuelId?: number | null;
  /** the gym group the field is about to hand the player to */
  pendingGymGroup?: number | null;
  pendingInn?: boolean;
  pendingParty: (string | null)[] | null;
  pendingStoryBattleIndex?: number | null;
  pendingStoryBattleNpc?: number | null;
  playerCastOne?: any;
  playerCharOne?: any;
  playerDrawBucket?: any;
  playerName: string;
  playSeconds: number;
  /** the story ordinal the walker has reached */
  progressOrdinal?: number;
  progressTable: any;
  replayLadder: { byStage: Record<string, any>; names: Record<string, any>; };
  reserveEquipment: any;
  reserveStats: any;
  rosterOwned?: number;
  rosterPredTable: any;
  sbIndex?: any;
  /** map id -> the loaded field scene (npcs, exits, zones) */
  scenes: Record<string, any>;
  shops?: Record<string, any>;
  slope: any;
  /** the sparkle cue the field is playing: its program and the tick it started at */
  sparkleActor?: { program: number; start: number; } | null;
  stageCastLists: Record<string, any>;
  stageDefaultSpawn: any;
  stageLayoutVariants?: Record<string, any>;
  started: boolean;
  stepEnableTable?: any;
  stopping: boolean;
  stopTime: number;
  storyGrids?: any;
  storySteps?: any;
  storyZones?: any;
  submarimon: any;
  talkEventIds?: number[];
  titleScreen?: any;
  titleScreenDone?: () => void;
  treeKick?: any;
  treeLive?: { stage: string; index: number; } | null;
  treeRadar?: any;
  treeStages?: any;
  visitedMaps?: Set<string>;
  wipe: { phase: number; t: number; frame: number; };
  wipe28?: { pending: { run: () => void; }; grid: any[]; index: number; calls: number; done: boolean; } | null;
  /** the parts each party member wears, by part name */
  worn: Record<string, number>;
  /** map id -> the stage script's talk events */
  wstag: Record<string, any[]>;
  x: number;
  y: number;
}

// One trailing party member: the sprite the field loop moves, plus the states the gather/park
// behaviour gives it (`parked` = waiting out of sight, `gathering` = walking to its lag point).
export interface Follower {
  x: number;
  y: number;
  dir: string;
  animTime: number;
  stopping: boolean;
  stopTime: number;
  parked?: boolean;
  gathering?: boolean;
  _idleTime?: number;
}

// One body in view for the ambience layer (window.__feet): breath, footprints, footsteps.
export interface FootPoint {
  id: string;
  x: number;
  y: number;
  moving: boolean;
  dir: string;
  leader?: boolean;
}

// One named line of a quest scene's speech map (web/game/quest-scenes.ts).
export interface SpeechBeat {
  /** the speaker: an npc id, or "player" for the party leader */
  who?: string | number | null;
  /** the name shown instead of the speaker's own */
  name?: string;
  text?: string;
  /** the question this line asks, when it asks one */
  ask?: string | null;
  /** the answers of the question, in the disc's order */
  options?: string[];
}

// openNameEntry(): the name the screen opens with, when a caller has one.
export interface NameEntryOptions {
  initial?: string;
}

// How far into a field tick the walk blend is: false = off, else the seconds already elapsed.
export type WalkBlend = number | false;

// A wrapped chat message as web/chat.ts builds it: the packet bytes the box steps through.
export type ChatPack = ChatPacket;

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
