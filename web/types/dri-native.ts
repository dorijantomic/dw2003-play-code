export interface DriHost {
  /** the native screen host the DRI screen runs on (read/write/renderer/state) */
  _host: any;
  _lastDiagnostic: string | null;
  _onClose: (() => void) | null;
  _open: boolean;
  /** packed sound id -> how many times it was played this open */
  _packed: Record<number, number>;
  _pending: boolean;
  /** the live game state, handed in by whoever opens the screen */
  _state: any;
  /** the dev overlay's dump of this screen's state */
  diagnostics?: any;
  handleKey?: (_k: string, state: any) => void;
  isOpen?: () => boolean;
  open?: (state: any, onClose?: (() => void) | null) => void;
  /** poke the emulated memory through the host; null when the host has no writer */
  writeMemory?: (addr: number, value: number, size?: number) => number | null;
}
