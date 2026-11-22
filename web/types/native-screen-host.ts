import type { NativeStageRuntime } from "../../engine/native/runtime.js";
import type { NativeMemcardHost } from "../../engine/native/stubs.js";
import type { createNativeScreenRenderer } from "../native-screen-render.js";
import type { nativeScreenRead, nativeScreenWrite } from "../native-screen.js";
import type { NativeScreenIo, NativeScreenManifest } from "./native-screen.js";

/** What opening a screen takes: the root ctor override, the audio hook, the RAM seed, and the pre-boot writes. */
export interface NativeScreenOpenOpts {
  rootCtor?: number;
  playPackedSound?: (id: number) => void;
  seed?: (io: NativeScreenIo) => void;
  preBoot?: (io: NativeScreenIo) => void;
  memcard?: NativeMemcardHost;
  rootArgs?: number[];
  skipClip?: (name: string, id: number) => boolean;
}

/** The walker state an adapter reads its pad word from: the keys held right now. */
export interface NativeAdapterState {
  keys?: Iterable<string>;
}

/** The object an adapter module hands createNativeAdapter: it installs `_begin`, `_boot`, `update`, `draw`, `close`
 *  and `_finish` on it, and keeps the open/pending flags and the host on it. */
export interface NativeAdapterOwner {
  _open?: boolean;
  _pending?: boolean;
  _host?: NativeScreenHost | null;
  _state?: NativeAdapterState | null;
  /** each adapter keeps its own diagnostic (a string, or its own record) */
  _lastDiagnostic?: unknown;
  _onClose?: (() => void) | null;
  _boot?: () => boolean;
  _begin?: () => void;
  _finish?: (allowCommit?: boolean) => void;
  update?: (dt: number, state?: NativeAdapterState | null) => void;
  draw?: (ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number, state?: NativeAdapterState | null) => boolean;
  close?: () => void;
}

/** What createNativeAdapter() has installed on the owner when it returns. */
export type NativeAdapterInstalled = Required<Pick<NativeAdapterOwner, "_boot" | "_begin" | "_finish" | "update" | "draw" | "close">>;

/** What createNativeAdapter() is built from: the owner and the hooks of one screen. */
export interface NativeAdapterOptions<T extends NativeAdapterOwner = NativeAdapterOwner> {
  owner: T;
  moduleId: string;
  hostOptions?: NativeScreenOpenOpts | (() => NativeScreenOpenOpts);
  preload?: () => Promise<NativeScreenManifest | void>;
  ready?: () => boolean;
  pad?: (host: NativeScreenHost, state: NativeAdapterState | null | undefined) => number;
  frame?: (host: NativeScreenHost, dt: number) => boolean;
  afterBoot?: ((host: NativeScreenHost) => void) | null;
  commit?: ((host: NativeScreenHost, allowCommit: boolean) => void) | null;
  closed?: ((allowCommit: boolean, host: NativeScreenHost | null | undefined) => void) | null;
  label?: string;
  draw?: ((ctx: CanvasRenderingContext2D, viewW?: number, viewH?: number, state?: NativeAdapterState | null) => boolean) | null;
}

/** The pack renderer a booted screen draws through. */
export type NativeScreenRenderer = ReturnType<typeof createNativeScreenRenderer>;

/** The debug read and write of the running screen's RAM. */
export type NativeScreenRead = typeof nativeScreenRead;
export type NativeScreenWrite = typeof nativeScreenWrite;

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
  renderer: NativeScreenRenderer | null;
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
