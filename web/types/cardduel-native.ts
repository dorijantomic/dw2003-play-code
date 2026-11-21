export interface CardDuelHost {
  _begin?: () => void;
  /** the caller's live state reader (CardDuelOptions.getState) */
  _getState: (() => unknown) | null;
  /** vendor object: the card duel engine's host */
  _host: any;
  _lastDiagnostic: unknown;
  _onClose: (() => void) | null;
  _open: boolean;
  _opponentId: number | null;
  _pending: boolean;
  _state: any;
  _won?: boolean;
  diagnostics?: () => { open: boolean; pending: boolean; opponentId: number | null; host: unknown; lastDiagnostic: unknown; };
  handleKey?: (_k: string, state: unknown) => void;
  isOpen?: () => boolean;
  open?: (onClose?: (() => void) | null, _opponentName?: string | null, _opponentDeck?: unknown, opponentId?: number | null, state?: unknown) => void;
  resultWon?: () => boolean;
}

/** What the card duel screen is handed: the host's live state, read when it opens or takes a key. */
export interface CardDuelOptions {
  getState?: () => any;
}
