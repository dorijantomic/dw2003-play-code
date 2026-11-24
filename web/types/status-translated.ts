import type { GameState } from "../game/types.js";
import type { WalkerState } from "./translated-screens.js";
import type { NativeScreenRenderStats } from "./native-screen-render.js";

/** What diagnostics() reports for the debug overlay: the screen's state and the last launched tasks. */
export interface StatusScreenDiagnostics {
  open: boolean;
  /** open but no session yet (the pack is still loading) */
  pending: boolean;
  error: string | null;
  entry: string | null;
  /** how often each page was opened */
  packed: Record<string, number>;
  tasks: number;
  page: number;
  /** the class ids of the running tasks */
  classes: number[];
  /** the pending screen change, when one is running */
  transition: string | null;
  renderer: NativeScreenRenderStats;
  lastDiagnostic: string | null;
}

export interface StatusScreen {
  /** the held buttons (pad words) the screen is waiting on; seeded from state.keys, which is Set<unknown> */
  _blocked?: Set<any>;
  /** vendor object: the ui.MenuDisplayClock the frames come from */
  _clock: any;
  _entry: string | null;
  /** the error that stopped the session, if loading failed */
  _error: Error | null;
  _finish?: (commit?: boolean) => void;
  _homeFlow: boolean;
  _homeOverlay: boolean;
  _homeRow: number;
  _lastDiagnostic: string | null;
  _onClose: (() => void) | null;
  _open: boolean;
  /** how often each page was opened */
  _packed: Record<string, number>;
  /** the buttons held last frame, so a newly opened page does not read them */
  _padLag?: unknown[];
  _request: number;
  /** the close handler to go back to when the home list returns */
  _returnClose: (() => void) | null;
  /** vendor object: the engine's PauseRootSession */
  _session: any;
  _state: GameState | null;
  _uiKey: string;
  blockUntilReleased?: (words?: unknown[]) => void;
  close?: () => void;
  diagnostics?: () => StatusScreenDiagnostics;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number) => void;
  /** the open page's id ("home", "map", ...) */
  entry?: () => string | null;
  handleKey?: (k: string, state: GameState) => void;
  isOpen?: () => boolean;
  /** `state` null = keep the state the screen already holds (a page re-opened in the same pause) */
  open?: (state: GameState | null, entry?: string, onClose?: (() => void) | null, homeFlow?: boolean) => void;
  openHome?: (state: GameState, onClose?: (() => void) | null, row?: number) => void;
  /** open `page` from a closed pause, over the home list on `row` (the World Globe's fallback to the disc's MAP page) */
  openPage?: (state: GameState, page: string, onClose?: (() => void) | null, row?: number) => boolean;
  reopenPage?: (page: string, row?: number) => boolean;
  update?: (dt: number) => void;
}

/** What the STATUS screen is handed by the game (web/game.ts): the party view, the map, and the extra pages' hooks. */
export interface StatusTranslatedOpts {
  /** true when the CARD FOLDERS page may be opened */
  cardFoldersUnlocked?: () => boolean;
  /** the extra rows under the pause home list (the extra quests, the GLOSSARY and OPTIONS books) */
  extraRows?: (state: WalkerState) => { label: string; opens: string }[];
  /** the map the party stands on (stage 0 and the seen-map reader come from it) */
  map?: (state: WalkerState) => any | null;
  /** true when OPTIONS > Map screen should open the World Globe instead of the disc's page */
  newMapScreen?: () => boolean;
  /** open a book (the GLOSSARY / OPTIONS browser) on a row */
  onBook?: (book: string, row: number) => void;
  /** hand off to the walker's own screen for a card folder / deck choice */
  onTransition?: (id: string, arg?: unknown) => void;
  /** the extra QUESTS page */
  questsPage?: (state: WalkerState) => any;
  /** the party view: one entry per pedestal (species stats, elements, worn gear) */
  roster?: (state: WalkerState) => any[] | null;
}
