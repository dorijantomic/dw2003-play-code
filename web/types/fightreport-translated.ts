import type { FightReportSession } from "../../engine/dw3/ui/fight-report-session.js";
import type { MenuDisplayClock } from "../../engine/dw3/ui/pad-words.js";

/** What the report screen reads back out of its session before that session is disposed:
 *  the totals it paid, the transition it ended on and the rows each partner's page shows. */
export interface FightReportSummary {
  finished: boolean;
  ticks: number;
  /** the wallet total the screen paid */
  bits: number;
  /** the held count of the item this fight dropped, null when it dropped none */
  heldDrop: number | null;
  /** the page-to-page transition it stopped on (the dev overlay reads [0]) */
  transition: [number, number];
  /** one entry per participant position: { pos, ...session.record(pos) }, or null when the record threw */
  records: (Record<string, unknown> | null)[];
  sounds: unknown[];
  loadedBanks: number[];
  displayCalls: { call: string; args: number[] }[];
}

/** diagnostics(): the dev overlay's dump of this screen's state. */
export interface FightReportDiagnostics {
  execution: string;
  open: boolean;
  pending: boolean;
  failed: boolean;
  error: string | null;
  ticks: number;
  summary: FightReportSummary | null;
  lastDiagnostic: string | null;
  [extra: string]: unknown;
}

/** The post-fight results screen (web/fightreport-translated.ts). */
export interface FightReportScreen {
  /** MenuDisplayClock the session is ticked on */
  _clock: MenuDisplayClock | null;
  /** the bundles loadData() fetched for this language (manifest, tables, banks, font) */
  _data: any;
  /** the load/run failure, printed by diagnostics() as `error.message` */
  _error: Error | null;
  _failed: boolean;
  _finish?: () => boolean;
  _lastDiagnostic: string | null;
  /** the hook the closing screen calls once */
  _onClose: (() => void) | null;
  _open: boolean;
  /** the module's own FightReportOpts; not exported, so it stays loose here */
  _opts: any;
  _pending: boolean;
  _request: number;
  /** the wallet total / drop count the session was seeded with, polled each frame */
  _seedBits: number | null;
  _seedHeld: number | null;
  _session: FightReportSession | null;
  /** the walker's game state, handed in by the caller */
  _state: any;
  _summary: FightReportSummary | null;
  _ticks: number;
  close?: () => boolean;
  diagnostics?: () => FightReportDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, _viewW?: number, viewH?: number) => void;
  /** `_k` is the key name ("ok", "cancel", ...) */
  handleKey?: (_k: string, state?: unknown) => void;
  isOpen?: () => boolean;
  open?: (opts?: unknown) => void;
  textWidgets?: () => unknown[];
  update?: (dt: number) => void;
}

/** One partner row on the results overlay: the fighter at that position, what it earned and the
 *  forms the win opened (buildFightReportRows, web/battle/report.ts). */
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
