// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

/** The command menu under one fighter: which stage it is in, and the rows to pick from. */
export interface MpFighterCommand {
  stage: string;
  /** the rows the kit built ({ label, k, ... }, one per choice) */
  options?: any[];
  /** called with the picked row's key */
  done?: (k: string) => void;
  label?: string;
  cur?: number;
}

/** What a fight reports back to whoever started it (done({ won, fled, reward })). */
export interface MpFightResult {
  won: boolean;
  fled: boolean;
  reward?: unknown;
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

/** One player in the host's table (host.ts). */
export interface MpNetPlayer {
  id: number;
  /** the player's network name */
  pn: string;
  /** the digimon's name */
  n: string;
  lv: number;
  rec: any;
  party: any[];
}

export interface MpNetFighter {
  act: number;
  /** ids of the computer-played practice partners in this fight */
  bots: Set<number>;
  /** the challenge row the fight was started from (setup.ch) */
  challenge: any;
  cheered: boolean;
  cmd: MpFighterCommand;
  cmdRow?: number;
  /** the fight's finish hook, run once when it is over */
  done: (result: MpFightResult) => void;
  /** the enemies' digimon records, one per foe */
  erec: any[];
  /** this fight's net id */
  fid: number;
  /** true when both sides are fought (a wave fight), false for a single side */
  foes: boolean;
  H: MpNetHost;
  hostId: number;
  /** every fighter in it, me first */
  ids: number[];
  iFled: boolean;
  isHost: boolean;
  items: any[];
  /** the battle kit this fight runs on (MB.F.kit) */
  kit: any;
  label: string;
  /** the net question id of the last event the fighter saw */
  lastEv: number | null;
  lastLq?: number;
  lastStealQ?: number;
  link: any;
  mapId: number | null;
  /** my player record */
  me: any;
  mineKey?: string;
  /** fighter id -> model name */
  modelName: Map<number, string>;
  names: Record<number, string>;
  nat: any;
  party: any[];
  placed: Set<number>;
  /** the BGM track that was playing before the battle, restored on the way out */
  prevTrack?: string | null;
  r3d: any;
  S: any;
  screenId: number | null;
  snap: any;
  techs: any[];
  timers: Set<unknown>;
  took?: Set<number>;
  ui: any;
  waveKey: string | null;
  waves: number;
}

export interface MpNetHost {
  arena: any;
  ln?: string[];
  log: string[];
  lq?: number;
  /** id -> name, or the per-foe name list the local host builds */
  names: Record<number, string> | string[];
  P: Map<number, MpNetPlayer>;
  pause: any;
  readyTimer?: ReturnType<typeof setTimeout>;
  res: Map<number, any>;
  round: number;
  started: boolean;
  /** the key whose command menu is open, null between turns */
  turn: string | null;
}
