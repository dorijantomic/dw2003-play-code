/** The driver's serializable debug state (web/native-screen.ts nativeScreenState): the module that
 *  is booted, its frame count, the traps it hit and the bridge calls it made. */
export interface NativeScreenDebugState {
  module: string;
  booted: boolean;
  /** live objects in the screen's world */
  objects: number;
  frames: number;
  traps: number;
  [field: string]: unknown;
}

/** One booted native screen, as web/native-screen-host.ts opens it: the runtime, the pack renderer,
 *  the pad word and one-tick-per-browser-frame stepping. */
export interface NativeScreenHost {
  /** the overlay module the screen booted ("pro/stitshop") */
  module: string;
  /** vendor object: the interpreter runtime bootNativeScreen() returned */
  rt: any;
  /** vendor object: the clip/sheet renderer createNativeScreenRenderer() returned */
  renderer: any;
  /** the pad word, in the pad service's bit order */
  _pad: number;
  /** did the last tick() run a vertical blank */
  _stepped?: boolean;
  draw: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number) => void;
  /** true once the booted root object has left the live set */
  finished: () => boolean;
  /** frames spent held back waiting for the screen's sheets */
  packWait: () => number;
  /** a debug read of the running screen's RAM; one value at `size` bytes, null when nothing is booted */
  read: (addr: number, size?: number) => number | null;
  /** every pack the screen draws from has its sheet and its clip table */
  ready: () => boolean;
  setPad: (held: number) => void;
  /** the driver's debug state, null when nothing is booted */
  state: () => NativeScreenDebugState | null;
  stepped: () => boolean;
  teardown: () => void;
  /** one browser frame of elapsed seconds; true when the screen finished during it */
  tick: (seconds?: number) => boolean;
  write: (addr: number, value: number, size?: number) => boolean;
}
