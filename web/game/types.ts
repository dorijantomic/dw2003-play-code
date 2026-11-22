// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

import type { BattleStartArgs } from "../battle/core/types.js";
import type { DigimonRecord } from "../types/battle.js";
import type { QuestBattleResult } from "../quests.js";
import type { ChatPacket } from "../types/chat.js";
import type { BlockEngagement } from "../../engine/systems/block-actor.js";
import type { CanvasBacking } from "../types/canvas-resolution.js";
import type { FlyPlace } from "../fly-points.js";
import type { createRetryLoader } from "../retry-loader.js";
import type { tiledMap } from "../map-tiles.js";
import type { FishExtrasData } from "../types/misc-game2.js";
import type { ItemsData } from "../types/screens.js";

import type { createQuestChase } from "../quest-chase.js";
import type { questFxGet } from "../quest-fx.js";
import type { createEngineBridge } from "../engine-bridge.js";
import type { GameEngine } from "../vendor/engine.js";
import type { createScreenRouter, createTriggerSystem } from "../vendor/engine.js";

/** The tri-state story-flag adapter the field code gates on (web/flag-store.ts createFlagStore). */
/** assets/data/chapter_progression.json: the story-flag ladder that decides the chapter */
export interface ChapterTable {
  _comment: string;
  default_chapter: number;
  ladder: { chapter: number; flag: number; flag_hex: string; milestone: string; evidence: string; }[];
  frontier: { chapter: number; flag: number | null; note: string; }[];
}

/** assets/data/progress_ordinal.json: the story ordinals each stage can hold, as a ladder and by stage */
export interface ProgressOrdinalTable {
  _comment: string;
  ladder: { stage: number; ordinals: number[]; }[];
  by_stage: Record<string, number[]>;
}

/** one row of assets/data/stage_cast_lists.json: an actor a stage places, its slot and spot, and the flag gates on it */
export interface StageCastRecord {
  id: number;
  slot: number;
  x: number;
  y: number;
  n: number;
  gate: { id: number; expected: number; }[];
  ptrB: number | null;
}

/** a party member's stored stat block: the five numbers every save carries; the other fields (digimonId, stats, bonuses, formLedger...) are read where they are used */
export type PartnerStats = { hp: number; maxHp: number; mp: number; maxMp: number; level: number; } & Record<string, any>;

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
  _indicatorKey?: string | null | undefined;
  _questBucket?: number;
  _questChase?: boolean;
  /** what the last chase came to, kept after the step is cleaned up (web/game/quest-scenes.ts endQuestChase) */
  _questChaseLast?: { result: number | string | null; target: number | string | null; distance: number; seconds: number; };
  /** what the running chase is chasing: an npc id or a quest fx name */
  _questChaseTarget?: number | string | null | undefined;
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
  auction: AuctionTable | null;
  auctionPending?: boolean;
  bits?: number | undefined;
  /** the body the player is talking through, and the field lock its block interaction holds */
  blockEngage: { ix: BlockEngagement; npc: SceneNpc | null; } | null;
  chapter?: number | null | undefined;
  /** the chapter table (parsed JSON) */
  chapterTable: ChapterTable | null;
  /** the manifest char id of the leader ("p003pken"...) */
  charId: string | null;
  /** the leader's roster slot, 0..2 */
  charIdx: number;
  /** char id -> the loaded sprite image ("loading" while it is on its way) */
  charImgs: Record<string, HTMLImageElement>;
  climb?: any;
  /** sprite pack id -> the loaded clip sheet ("loading" while it is on its way) */
  clipImgs: Record<string, HTMLImageElement>;
  /** map id -> the parsed collision grid */
  collision: Record<string, any>;
  debugAnim?: boolean;
  dialogues: any;
  /** char id -> the partner's name */
  digimonNames: Record<string, string>;
  dir: string;
  diveDemo: any;
  diveForm: any;
  diveFormMarkers: Record<string, number> | null;
  diveNetwork: Map<string, any> | null;
  endScreen?: any;
  endScreenDone?: (() => void) | null;
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
  fishingExtras?: FishExtrasData | null | undefined;
  fishingSpots?: any;
  /** the string markers the field keeps in the save ("evt_<flag_key>", an npc's setFlag) */
  flags: Record<string, boolean>;
  gondolaAutoFired?: boolean;
  gunslingerLatch?: any;
  gymExtra?: any;
  handoffHold: { ticks: number; exit: StageExit; } | null;
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
  mapFgImgs: Record<string, HTMLImageElement | "loading" | "failed">;
  /** map id -> the loaded ground image */
  mapGroundImgs: Record<string, any>;
  mapGroundIndex: Record<string, boolean> | null;
  mapIdx: number;
  /** map id -> the loaded map image */
  mapImgs: Record<string, HTMLImageElement | "loading" | "failed">;
  mapLayer2: Record<string, [number, number, number][]> | null;
  /** map id -> the loaded layer-2 image */
  mapLayer2Imgs: Record<string, any>;
  /** map id -> part -> the loaded native-resolution image */
  mapNativeImgs: Record<string, any>;
  mapOverlays: Record<string, boolean> | null;
  mapTiles: Record<string, { base: ReturnType<typeof tiledMap>; fg: ReturnType<typeof tiledMap>; }>;
  menuOpen: boolean;
  moving: boolean;
  nameEntry?: any;
  nameEntryDone?: (() => void) | null;
  newMaps?: { records: any[]; scenes: any; exits: any; } | null;
  /** char id -> the loaded npc image */
  npcImgs: Record<string, HTMLImageElement>;
  npcSprites?: Record<string, any>;
  onExit?: boolean;
  ordinalByStage: Record<string, number>;
  packId: string;
  packSelect?: any;
  packSelectDone?: (() => void) | null;
  padLayoutLatch?: number;
  padSwitch?: any;
  partnerStats: any;
  /** the deployed party's char ids (null slots are empty) */
  party: (string | null)[];
  partyStats: any;
  /** the duel the field is about to start */
  pendingDuelId?: number | null | undefined;
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
  progressTable: ProgressOrdinalTable | null;
  replayLadder: { byStage: Record<string, any>; names: Record<string, any>; } | null;
  reserveEquipment: any;
  reserveStats: any;
  rosterOwned?: number;
  rosterPredTable: any;
  sbIndex?: Record<string, ScriptedBattleRow[]>;
  /** map id -> the loaded field scene (npcs, exits, zones) */
  scenes: Record<string, any>;
  shops?: Record<string, any>;
  slope: any;
  /** the sparkle cue the field is playing: its program and the tick it started at */
  sparkleActor?: { program: number; start: number; } | null;
  stageCastLists: Record<string, StageCastRecord[]> | null;
  stageDefaultSpawn: Record<string, { x: number; y: number; facing: number; }> | null;
  stageLayoutVariants?: Record<string, any>;
  started: boolean;
  stepEnableTable?: any;
  stopping: boolean;
  stopTime: number;
  storyGrids?: any;
  storySteps?: Record<string, StoryProgram>;
  storyZones?: any;
  submarimon: any;
  talkEventIds?: number[];
  titleScreen?: any;
  titleScreenDone?: (() => void) | null;
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
  wstag: Record<string, StoryEvent[]>;
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
  screenId?: number | null | undefined;
  challenge?: (number | undefined)[] | undefined;
  onWin?: ((result: QuestBattleResult | undefined) => void) | undefined;
  onFlee?: (() => void) | undefined;
  onLose?: (() => void) | undefined;
  mapId?: number | undefined;
  lead?: boolean | undefined;
}

// The options the dev toolset hands to battle.start / startScreen / startParty (window.__dev):
// the same arguments the field hands the engine, plus `lead` for the 1v1 startScreen path.
export interface DevBattleOptions extends BattleStartArgs {
  lead?: boolean;
}

/** One row of assets/data/screen_table.json: the stage a screen id names (and the one it names once the story has moved on). */
export interface ScreenTableRow {
  file: string;
  lbaIdx: number;
  stage?: number;
  alt?: { stage?: number; };
}

/** A sprite record of the manifest (a character or an npc) with the kind of table it came from. */
export interface ManifestSprite {
  record: SpriteRecord;
  kind: "character" | "npc";
}

/** A resident the extra quests stand on a map (web/extra_npcs.json residents). */
export interface ExtraResident {
  map: string;
  npc_id: number;
  x: number;
  y: number;
  dir?: string;
}

/** The running quest chase: the chase machine and what it moves (an npc of the scene, or one of our own effects). */
export interface QuestChaseRun {
  machine: ReturnType<typeof createQuestChase>;
  npc: SceneNpc | null;
  fx: ReturnType<typeof questFxGet>;
  resolve: () => void;
  settled: boolean;
}

/** The translated line the field's textbox facade reports as dialogue. */
export interface TranslatedDialogueText {
  name?: string;
  pages?: string[][];
}

/** A character of a stage's scene (assets/scenes/<id>.json npcs, plus the ones the quests and the scripts add). */
export interface SceneNpc {
  id: string;
  npc_id: number;
  sprite?: string;
  x: number;
  y: number;
  dir: string;
  _quest?: boolean;
  _ephemeral?: boolean;
  cutsceneOnly?: boolean;
  invisible?: boolean;
  spawn_flags?: FlagGate[];
  _questStandIn?: boolean;
  _animTime?: number;
  _origX?: number;
  _origY?: number;
  _inCutscene?: boolean;
  _chasing?: boolean;
  _chaseWarn?: boolean;
  activeClip?: string | number;
  _cutTarget?: unknown;
}

/** The loader the glossary's item list reads through (web/retry-loader.ts). */
export type ItemLoader = ReturnType<typeof createRetryLoader<ItemsData>>;

/** The engine's bag object, which the field replaces with an adapter over state.inventory. */
export type EngineInventory = InstanceType<typeof GameEngine>["state"]["inventory"];

/** The mutable module-level fields of the field game (web/game/state.ts S). */
export interface SharedState {
  glossaryItemLoader: ItemLoader | null;
  flyChosen: FlyPlace | null;
  chatShownAt: number;
  chatPages: number;
  chatPresses: number;
  footstepCount: number;
  billboardDraws: BillboardDraw[];
  fieldFrame: CanvasBacking | null;
  translatedDialogueText: TranslatedDialogueText | null;
  yesNoAwaitingChild: boolean;
  fieldMovieDone: (() => void) | null;
  knownStageIds: string[];
  manifestSprites: Map<string, ManifestSprite>;
  locationSaveTimer: ReturnType<typeof setTimeout> | null;
  fieldTickAccumulator: number;
  languageByte: number | undefined;
  lastBlockIx: BlockEngagement | null;
  cutsceneEsdmgRef: { file: string; entry: number; } | null;
  questPaths: Record<string, number[][]>;
  extraResidents: ExtraResident[];
  questSceneEvents: QuestSceneEvent[];
  questChase: QuestChaseRun | null;
  questSceneAnswerSet: ((v: number | null) => void) | null;
  questsWereOn: boolean | null;
  screenRouter: ReturnType<typeof createScreenRouter>;
  fieldScreenTable: Record<string, ScreenTableRow> | undefined;
  titleInput: ((k: string) => boolean) | null;
  launchTitleScreen: (() => void) | null;
  lastCollectionSnapshot: string | null;
  collectionSweepTick: number;
  engine: InstanceType<typeof GameEngine> | null;
  engineBridge: ReturnType<typeof createEngineBridge> | null;
  engineTriggerSystem: ReturnType<typeof createTriggerSystem> | null;
  stepSetupBucketMap: string | null;
  padLastT: number;
  lastT: number;
  fpsBox: HTMLDivElement | null;
  fpsLast: number;
  fpsShown: number;
  _grassScratch: HTMLCanvasElement | null;
}

/** One billboard cell drawn in a frame (web/game/draw-sprites.ts), recorded for tools/verify_field_billboard_anchor.mjs. */
export interface BillboardDraw {
  row: number;
  shift: number;
  groundRow: number;
  screenX: number;
  cellH: number;
  path: "sheet" | "clip";
  frameIdx?: number | undefined;
  dir?: string;
  col?: number;
}

export interface QuestChaseEvent {
    kind: "chase";
    target?: string | number;
    speed?: number;
    lose?: number;
}

export interface QuestSceneWarpEvent {
    kind: "warp";
    to?: string | number | null;
    at?: [number, number] | null;
    dir?: number;
}

export type QuestSceneEvent =
    | { kind: "fx"; sheet: string }
    | { kind: "fxplay" }
    | { kind: "fxmove" }
    | { kind: "fxremove" }
    | { kind: "fxwait"; name: string }
    | { kind: "drop"; pixels: number; step: number }
    | { kind: "rise"; pixels: number; step: number }
    | { kind: "ghost" }
    | { kind: "bucket"; value: number }
    | { kind: "fade"; to: number; frames: number }
    | { kind: "shake" }
    | { kind: "weather"; weather: string; strength: number; frames: number; force?: boolean }
    | { kind: "time"; time: string; frames: number; force?: boolean }
    | { kind: "lightning"; count: number; force?: boolean }
    | { kind: "sfx"; name: string }
    | { kind: "placecard"; area: string; place: string }
    | { kind: "chase" }
    | { kind: "battle"; screen: number }
    | QuestSceneWarpEvent;

/** One bytecode scene of a stage (assets/events/wstag_events.json): the script the cutscene VM runs and where it leads. */
export interface StoryEvent {
  id: number;
  flag?: number;
  flag_key: string;
  script_offset?: number;
  native_fn?: number;
  native_fn_ram?: number;
  on_complete_fn?: number;
  on_complete_fn_ram?: number;
  disasm?: string[] | undefined;
  esdmg_stage?: string | undefined;
  esdmg_entry?: number | null | undefined;
  esdmg_approx?: boolean;
  handoff_to?: string | null | undefined;
  handoff_x?: number;
  handoff_y?: number;
  handoff_dir?: number;
  /** the room a replay was asked for (web/game/auction-replay.ts playReplayRow) */
  replayMap?: string;
}

/** The screen change a finished scene asks for (engine/systems/cutscene-manager.ts), plus the yes/no child that ended it. */
export interface StoryHandoff {
  screenId: number;
  x: number;
  y: number;
  dir: number;
  yesNoChild?: StoryEvent;
}

/** One lot of the s260 auction (assets/data/auction_lots.json). */
export interface AuctionLot {
  n: number;
  progress: number;
  flag: number;
  condition: number;
  money_index: number;
  bid: number;
  item: number;
  item_code: string;
  item_name: string;
  events: { open: number; question: number; accepted: number; pass: number; };
  entries: { open: number; accepted: number; choice: number; pass: number; };
  handlers: Record<string, string>;
}

/** One scripted event of the auction: its esdmg260 entry and the bytecode. */
export interface AuctionEvent {
  entry: number;
  disasm: string[];
}

/** assets/data/auction_lots.json: the lots, their scripts and the force-exit the answers carry. */
export interface AuctionTable {
  _comment: string;
  source: Record<string, string>;
  lots: AuctionLot[];
  openers: { event: number; entry: number; }[];
  events: Record<string, AuctionEvent>;
  force_exit: { screen: number; x: number; y: number; stage: number; };
  questions: { text_bank: string; region: number; answers: number; };
}

/** What a finished story event reports back: the screen change it asks for, or nothing. */
export type StoryEventDone = (handoff?: StoryHandoff | null) => void;

/** One piece of a debug log line (web/game/story-events.ts storyDbg). */
export type DebugPart = string | number | boolean | null | undefined;

/** One value an engine-content script op carries (assets/engine-content.json). */
export interface EngineContentArg {
  t: string;
  v: number;
}

/** One op of an engine-content script. */
export interface EngineContentOp {
  op: string;
  args: EngineContentArg[];
}

/** One trigger row of an engine-content stage. */
export interface EngineContentEvent {
  id: string;
  on: string;
  priority: number;
  do: string;
  match?: { npc?: number; };
}

/** One stage of assets/engine-content.json: its trigger rows and the scripts they run. */
export interface EngineContentStage {
  mapId: string;
  events?: EngineContentEvent[];
  scripts?: { id: string; program?: EngineContentOp[]; }[];
}

/** assets/engine-content.json as far as the field reads it. */
export interface EngineContent {
  stages?: EngineContentStage[];
  flagKeys?: Record<string, Record<number, string>>;
}

/** A stage's scripted battle: the PRE scene's flag key, the POST scene's, the fight's screen and the flag that marks it won. */
export interface ScriptedBattleRow {
  preKey: string;
  postKey: string | null;
  screenId: number;
  wonFlag: number;
  actor: number | undefined;
}

/** A body that stops with a stop clip: the field leader or a trailing party member. */
export interface StoppingActor {
  stopping: boolean;
  stopTime: number;
  dir: string;
  _idleTime?: number | undefined;
}

/** One trailing party member to draw this frame: its slot, its follower state, its character record and its sheet. */
export interface FollowerDraw {
  i: number;
  f: Follower;
  pc: SpriteRecord;
  ps: HTMLImageElement;
}

/** A stage's scene as the cast builder reads it: the npcs it holds, and the cast and stand-in copies it caches. */
export interface CastScene {
  npcs: SceneNpc[];
  _standIns?: Map<number, SceneNpc> | null;
  _cast?: SceneNpc[] | null;
}

/** A line of an estalkNN / esdmgNNN text bank: the file and the entry in it. */
export interface DialogueRef {
  file: string;
  index: number | string;
}

/** The callbacks a quest scene hands the cutscene VM: what runs after each SAY, and each scripted event. */
export interface QuestSceneHooks {
  afterSay: Record<string, (resume: () => void) => void>;
  sceneEvent: (index: number, resume: () => void) => void;
}

/** One end of a ladder rail. */
export interface LadderEnd {
  x: number;
  y: number;
}

/** One ladder of a scene (assets/scenes/<id>.json ladders). */
export interface SceneLadder {
  id: number;
  bottom: LadderEnd;
  top: LadderEnd;
}

/** The bug-maze trap pads of a scene: a cell grid mask and where a stepped-on pad resets the leader. */
export interface TrapPads {
  cell: number;
  rows: number;
  cols: number;
  mask: string[];
  reset: { x: number; y: number; dir: string; };
}

/** The slippery floor of a scene: the cells a glide starts on (with the direction index) and the cells it stops on. */
export interface IceSlide {
  cell: number;
  start: [number, number, number][];
  stop: [number, number][];
}

/** A flag test a record carries: the flag id and the value it must hold. */
export interface FlagGate {
  id: number;
  expected: number;
}

/** One form of a partner's ledger (the stored stat block's formLedger). */
export interface FormLedgerEntry {
  id: number;
  formLevel?: number;
  dvexp?: number;
  techSlots?: number[];
}

/** One row of web/party.ts partyRosterView: a party member as the menus and the field read it. */
export interface PartyRosterRow {
  charId: string | null;
  rookieId: number;
  digimonId: number;
  name: string;
  formName: string;
  level: number;
  xp: number;
  tp: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  stats: Record<string, number> | null;
  bonuses: Record<string, number> | null;
  dvexpByForm: Record<string, number> | null;
  formLedger: FormLedgerEntry[] | null;
  equippedForms: number[] | null;
}


/** One point of the party's walking trail the followers read (web/vendor/engine.js seedFollowerHistory). */
export interface TrailPoint {
  x: number;
  y: number;
  dir: string;
  parked?: boolean;
}

/** One position-trigger step of a stage program (assets/data/story_steps.json). */
export interface StoryStep {
  cond_a: number;
  arg_a: number;
  cond_b: number;
  arg_b: number;
  op: number;
  params: number[];
}

/** The story event a stage's position trigger starts, with the flag writes it makes. */
export interface StoryStepEvent {
  event_id: number;
  flag_key: string;
  sets: [number, number][];
}

/** One stage of assets/data/story_steps.json. */
export interface StoryProgram {
  steps: StoryStep[];
  events: StoryStepEvent[];
}

/** One facing's clip of a sprite record: the sheet columns it plays, how long each stays and its vertical registration. */
export interface SpriteClipRow {
  cols: number[];
  durations: number[];
  bottoms: number[];
}

/** A character or npc record of assets/manifest.json: the sheet and how its cells are laid out. */
export interface SpriteRecord {
  id: string;
  name: string;
  sheet: string;
  frameW: number;
  frameH: number;
  rows: string[];
  frameCounts: Record<string, number>;
  frameDurations: Record<string, number[]>;
  frameBottomShift: Record<string, number[]>;
  clipSheet: string;
  clipFrameW: number;
  clipFrameH: number;
  clips: Record<string, Record<string, SpriteClipRow>>;
  starter?: boolean;
}

/** One map of assets/manifest.json. */
export interface ManifestMap {
  id: string;
  name: string;
  image: string;
  width: number;
  height: number;
  music?: string | null;
  fixedViewportBackground?: boolean;
  cutsceneCameraCenter?: [number, number];
  assetSource?: string;
  /** a map made after the disc names its own collision file */
  collision?: string;
}

/** One fighter of the many-vs-many kit's party list: the record the referee is handed. */
export interface MpKitMember {
  rec: DigimonRecord;
}

/** A door, hole or scripted warp from one stage to the next (a scene exit of assets/scenes/<id>.json, or one a script builds). */
export interface StageExit {
  to: string;
  spawnX?: number | null | undefined;
  spawnY?: number | null | undefined;
  dir?: string | undefined;
  scripted?: boolean;
  stepOp?: number | undefined;
  warp?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  grid?: boolean;
  transition?: string;
  entryKey?: number;
  entryCompanion?: number;
  gate?: { flag: number; eq: number; };
  selfWarp?: boolean;
  nativeDir?: number;
  launchPad?: boolean;
  /** the way back a save made on an entrance stands on (web/game/session.ts) */
  _entranceReturn?: boolean;
}

/** The stage-change fade: how far it has closed, which way it runs, and the exit it will take when it is closed. */
export interface FadeState {
  alpha: number;
  dir: number;
  pending: StageExit | null | undefined;
}

/** A key press as the field's input dispatcher reads it: a KeyboardEvent, or the stub a joystick press makes. */
export interface FieldKeyEvent {
  preventDefault: () => void;
  repeat: boolean;
  code: string;
  key: string;
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** The launch pad a setup step names: where it lands the leader and the facing index it leaves them on. */
export interface StepPad {
  spawnX: number;
  spawnY: number;
  dirIndex: number;
}

/** Where the leader lands on a stage that is entered at a chosen spot. */
export interface SpawnPoint {
  x: number;
  y: number;
  dir?: string | undefined;
}

/** One stage's collision grid (web/vendor/engine.js fromJSON / createGrid): the blocked cells, and the six terrain-code layers when the file carries them. */
export interface CollisionGrid {
  cell: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
  terrain?: Uint8Array[];
}

/** One row of a places stage's table: where a pad aims, by screen id or by stage (assets/scenes placePoints). */
export interface PlacePoint {
  to?: string | null;
  screen: number;
  dirName?: string;
}
