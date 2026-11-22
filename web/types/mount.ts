// How web/mount.ts names a mount row, its host hooks, its state and the rider's place.
import type { GameState } from "../game/types.js";
import type { MountAsset } from "../mount3d.js";

/** A point in the field. */
export interface MountSpot { x: number; y: number; }

/** How a mount's legs move: a measured clip, or the procedural gait. */
export interface MountWalkDef {
  /** seconds of one walk cycle */
  cycle?: number | undefined;
  idle: string;
  kind: string;
  name: string;
}

/** The saddle: a bone and a point local to it, plus the px the rider's feet drop below it. */
export interface MountSeatDef {
  at: [number, number, number];
  drop?: number;
  node: number;
}

/** The hurt pose of a mount's quest character. */
export interface MountHurtDef { at?: number | undefined; clip: string; model: string; }

/** One row of the mount table. */
export interface MountDef {
  actor?: { npc: number; hurt: MountHurtDef } | undefined;
  back: number;
  forward: [number, number, number];
  id: string;
  model: string;
  name: string;
  seat?: MountSeatDef | undefined;
  shadow?: { length: number; width: number } | undefined;
  sit?: number | undefined;
  size?: number | undefined;
  speed: number;
  unlock: string;
  walk: MountWalkDef;
}

/** The game-side hooks (web/game.ts installMount). A test host may leave any of them out. */
export interface MountHost {
  canStand?: ((x: number, y: number) => boolean) | undefined;
  enabled?: (() => boolean) | undefined;
  fieldReady?: (() => boolean) | undefined;
  groundShadow?: ((c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number) => void) | undefined;
  hasModel?: ((url: string) => boolean | Promise<boolean>) | undefined;
  indoor?: (() => boolean) | undefined;
  mustDismount?: (() => boolean) | undefined;
  placeFollowers?: ((spots: MountSpot[]) => void) | undefined;
  questDone?: ((id: string) => boolean) | undefined;
  resetFollowers?: (() => void) | undefined;
  say?: ((text: string) => void) | undefined;
  sfx?: ((id: string) => void) | undefined;
  state?: (() => GameState) | undefined;
}

/** What the layer is doing. */
export type MountMode = "idle" | "summoning" | "mounting" | "riding" | "dismounting";

/** Where the rider goes in the mount's cell this frame, from the saddle split. */
export interface MountRider {
  cutY: number | null;
  dx: number;
  feetY: number;
  layer: string;
  lift: number;
  riderX: number;
  seatX: number;
  seatY: number;
}

/** What seatLayout() works out: the rider's place without the saddle point itself. */
export type MountRiderLayout = Omit<MountRider, "seatX" | "seatY">;

/** One facing's saved rider settings. */
export interface MountSeatCfg { cut: number | null; dx: number; dy: number; layer: string; }

/** The saved rider settings: per mount id, per facing. */
export type MountSeatTable = Record<string, Record<string, Partial<MountSeatCfg>>>;

/** The mount layer's one state object. */
export interface MountState {
  animT: number;
  asset: MountAsset | null;
  def: MountDef | null;
  dir: string;
  granted: Set<string>;
  lastRender: number;
  loading: boolean;
  mode: MountMode;
  models: Map<string, boolean>;
  moving: boolean;
  phase: number;
  rendererFailed: boolean;
  renders: number;
  rider: MountRider | null;
  x: number;
  y: number;
}

/** Verifier-only switches. */
export interface MountProbe {
  hideMount: boolean;
  hideNodes: number[] | null;
  hideRider: boolean;
  timeSec: number | null;
}

/** One entry the mount pushes into the field's y-sorted draw list. */
export interface MountDrawable {
  draw: () => void;
  mount?: boolean | undefined;
  mountBack?: boolean | undefined;
  mountFront?: boolean | undefined;
  mountShadow?: boolean | undefined;
  y: number;
}

/** The quest character of a mount, as the scene's npc record. */
export interface MountNpc {
  dir?: string | undefined;
  npc_id?: number | undefined;
  x: number;
  y: number;
}

/** A move function: from a place and a step to where it ends. */
export type MountMover = (x: number, y: number, dx: number, dy: number) => MountSpot;
