import type { LabDisplayCall, LabMember, LabResources } from "../../engine/dw3/ui/lab-session.js";
import type { FormLedgerEntry, GameState, PartnerStats } from "../game/types.js";
import type { DigimonRecord, EngineUi } from "./battle.js";
import type { loadResidentResources } from "../resident-data.js";
import type { MenuDisplayClock, ThrownError, WalkerState } from "./translated-screens.js";

/** The engine's LabSession (engine/dw3/ui/lab-session.ts) */
export type LabSession = InstanceType<EngineUi["LabSession"]>;

/** lab/manifest.json: the parts of it the lab reads */
export interface LabManifest {
  /** the shared profile table: row count and bytes per row */
  sharedProfiles: { rows: number; stride: number; };
  /** the shared text banks: where each family starts and which folder it lives in */
  sharedBanks: { offset: number; dir: string; }[];
  resident: { ranges: LabResources["ranges"]; };
  textButtons: { bytes: number[]; };
}

/** everything loadShared() fetches once: the tables, the font, the catalog and the profile bridge */
export interface LabData {
  manifest: LabManifest;
  tables: Uint8Array;
  resident: Uint8Array;
  profiles: Uint8Array;
  font: Uint8Array;
  cursorGlyphs: Awaited<ReturnType<typeof loadResidentResources>>["cursorGlyphs"];
  catalog: LabResources["catalog"];
  itemRecords: Uint8Array;
  descriptors: LabResources["descriptors"];
  digimonById: Record<number, DigimonRecord>;
  /** each profile row's own form id (value0), by row */
  value0: number[];
}

/** one roster record the lab seeded, kept to compare against what the screen left */
export interface LabMemberRecord {
  slot: number;
  stats: PartnerStats;
  equipment: Record<string, number>;
  starterId: number;
  member: LabMember;
  /** the ledger entries the 44 cells show, in cell order */
  window: FormLedgerEntry[];
}

/** what the closing session handed back, read once before it is torn down */
export interface LabSummary {
  finished: boolean;
  ticks: number;
  transition: [number, number];
  party: number[];
  sounds: number[];
  displayCalls: LabDisplayCall[];
}

export interface LabScreen {
  /** the loaded shared banks, by bank id */
  _banks: Map<number, Uint8Array> | null;
  _clock: MenuDisplayClock | null;
  _committed: number;
  /** the loaded data bundle the session is seeded from */
  _data: LabData | null;
  _error: ThrownError | null;
  _failed: boolean;
  _finish?: () => boolean;
  _lastDiagnostic: string | null;
  _ledgerPages: number;
  /** the party records handed to the session */
  _members: LabMemberRecord[];
  _onClose: (() => void) | null;
  _open: boolean;
  /** packed-sound id -> times played */
  _packed: Record<number, number>;
  _pending: boolean;
  _request: number;
  _returnSelector?: number;
  /** the roster slot standing at each party position when the session was seeded */
  _seededParty: number[];
  _session: LabSession | null;
  _state: WalkerState | null;
  _summary: LabSummary | null;
  _ticks: number;
  close?: () => boolean;
  diagnostics?: () => Record<string, unknown>;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number) => void;
  /** `state` is typed loosely on purpose: web/game/input.ts hands it the sound player (see the report) */
  handleKey?: (_k: string, state: any) => void;
  isOpen?: () => boolean;
  open?: (state: GameState, onClose?: (() => void) | null, selector?: number) => Promise<void>;
  textWidgets?: () => ReturnType<LabSession["widgets"]["textWidgets"]>;
  update?: (dt: number, held?: Iterable<string>) => void;
  /** the walker-state write of the last close; the lab has none */
  writeMemory?: null;
}
