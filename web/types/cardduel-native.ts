export interface CardDuelHost {
  _begin?: () => void;
  /** the caller's live state reader (CardDuelOptions.getState) */
  _getState: (() => any) | null;
  /** vendor object: the card duel engine's host */
  _host: any;
  _lastDiagnostic: any;
  _onClose: (() => void) | null;
  _open: boolean;
  _opponentId: number | null;
  _pending: boolean;
  _state: any;
  _won?: boolean;
  diagnostics?: () => { open: boolean; pending: boolean; opponentId: number | null; host: any; lastDiagnostic: any; };
  handleKey?: (_k: string, state: any) => void;
  isOpen?: () => boolean;
  open?: (onClose?: (() => void) | null, _opponentName?: string | null, _opponentDeck?: any, opponentId?: number | null, state?: any) => void;
  resultWon?: () => boolean;
}

/** What the card duel screen is handed: the host's live state, read when it opens or takes a key. */
export interface CardDuelOptions {
  getState?: () => any;
}
