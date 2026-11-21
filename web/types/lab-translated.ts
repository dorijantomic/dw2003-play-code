export interface LabScreen {
  /** the loaded shared banks, by bank id */
  _banks: Map<number, Uint8Array> | null;
  /** vendor object: the ui.MenuDisplayClock the desk ticks on */
  _clock: any;
  _committed: number;
  /** the loaded data bundle the session is seeded from */
  _data: any;
  _error: any;
  _failed: boolean;
  _finish?: () => boolean;
  _lastDiagnostic: string;
  _ledgerPages: number;
  /** the party records handed to the session */
  _members: any[];
  _onClose: (() => void) | null;
  _open: boolean;
  /** packed-sound id -> times played */
  _packed: Record<number, number>;
  _pending: boolean;
  _request: number;
  _returnSelector?: number;
  _seededParty: any[] | number[];
  /** vendor object: the engine's LabSession */
  _session: any;
  _state: any;
  _summary: { finished: any; ticks: number; transition: any; party: any; sounds: any; displayCalls: any; };
  _ticks: number;
  close?: () => boolean;
  diagnostics?: any;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number) => void;
  handleKey?: (_k: string, state: any) => void;
  isOpen?: () => boolean;
  open?: (state: any, onClose?: (() => void) | null, selector?: number) => Promise<void>;
  textWidgets?: () => any;
  update?: (dt: number, held?: any) => void;
  writeMemory?: any;
}
