import type { GameState } from "../game/types.js";
import type { NativeAdapterOwner } from "./native-screen-host.js";
import type { NativeScreenDebugState, NativeScreenHost } from "./native-screen-host.js";

/** The walker state the duel seeds the screen's RAM from and writes its result back to: the game state, plus the duel's own result fields. */
export type CardDuelState = GameState & {
  /** how many times each opponent has been beaten (opponent id as a string -> wins, capped at 99) */
  duelWinCounts?: Record<string, number> | undefined;
  /** the last duel's result */
  duelWon?: boolean | undefined;
};

/** The object createCardDuelNative() hands createNativeAdapter: the adapter's own fields plus the duel's. */
export interface CardDuelHost extends NativeAdapterOwner {
  /** the caller's live state reader (CardDuelOptions.getState) */
  _getState: (() => CardDuelState) | null;
  /** the booted native screen */
  _host: NativeScreenHost | null;
  _onClose: (() => void) | null;
  _open: boolean;
  _opponentId: number | null;
  _pending: boolean;
  _state: CardDuelState | null;
  _won?: boolean;
  diagnostics?: () => { open: boolean; pending: boolean; opponentId: number | null; host: NativeScreenDebugState | null; lastDiagnostic: unknown; };
  handleKey?: (_k: string, state?: CardDuelState | null) => void;
  isOpen?: () => boolean;
  open?: (onClose?: (() => void) | null, _opponentName?: string | null, _opponentDeck?: unknown, opponentId?: number | null, state?: CardDuelState | null) => void;
  resultWon?: () => boolean;
}

/** What the card duel screen is handed: the host's live state, read when it opens or takes a key. */
export interface CardDuelOptions {
  getState?: () => CardDuelState;
}
