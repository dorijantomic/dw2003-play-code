import type { GameState } from "../game/types.js";
import type { DigimonRecord } from "./battle.js";
import type { NativeScreenDebugState, NativeScreenHost } from "./native-screen-host.js";

/** The walker state as the lab reads it: the owned mask and the deployed party. */
export interface OwnedSlotsSource {
  rosterOwned?: number | undefined;
  party?: (string | null)[] | undefined;
}

/** digimon.json, keyed by species id (the base-stat fallback and the species names). */
export interface DriTables {
  digimonById: Record<number, DigimonRecord>;
}

/** The screen's world, as the diagnostics dump it: one live object. */
export interface DriWorldObject {
  addr: number;
  cb: number;
  alive: boolean;
}

/** The booted screen's root object and its children, read off RAM. */
export interface DriScreenDiagnostic {
  root: number;
  aux: number;
  objects: DriWorldObject[];
  rootState: number | null;
  rootUnk10: number | null;
  auxChild: number | null;
  party: (number | null)[];
}

/** The pack renderer's counters. */
export interface DriRendererDiagnostic {
  frames: number;
  clips: number;
  skipped: number;
  byPack: Record<string, number>;
  seen: number[];
  last: { id: number; x: number; y: number; pack: string } | null;
}

/** The dev overlay's dump of this screen's state. */
export interface DriDiagnostics {
  open: boolean;
  pending: boolean;
  packed: Record<number, number>;
  host: NativeScreenDebugState | null;
  screen: DriScreenDiagnostic | null;
  renderer: DriRendererDiagnostic | null;
  lastDiagnostic: string | null;
}

export interface DriHost {
  /** the native screen host the DRI screen runs on (read/write/renderer/state) */
  _host: NativeScreenHost | null;
  _lastDiagnostic: string | null;
  _onClose: (() => void) | null;
  _open: boolean;
  /** packed sound id -> how many times it was played this open */
  _packed: Record<number, number>;
  _pending: boolean;
  /** the live game state, handed in by whoever opens the screen */
  _state: Partial<GameState> | null;
  /** the dev overlay's dump of this screen's state */
  diagnostics?: () => DriDiagnostics;
  handleKey?: (_k: string, state: Partial<GameState>) => void;
  isOpen?: () => boolean;
  open?: (state: Partial<GameState> | null | undefined, onClose?: (() => void) | null) => void;
  /** poke the emulated memory through the host; null when the host has no writer */
  writeMemory?: (addr: number, value: number, size?: number) => boolean | null;
}
