import type { NativeHost, NativeMemcardHost } from "../../engine/native/stubs.js";
import type { NativeStageRuntime } from "../../engine/native/runtime.js";
import type { RosterFormState } from "../../engine/dw3/ui/roster-form-state.js";

/** The host object web/native-screen.ts hands the native screens' interpreter stubs. */
export type NativeScreenFlags = NativeHost;

/** One screen of the natives build: its overlay file, its root constructor, and the banks it uploads. */
export interface NativeScreenEntry {
  file: string;
  /** overlay-relative */
  root_ctor?: number;
  bank_ids?: number[];
  load_base: number;
  size: number;
  /** the extracted pack the screen draws from, when it draws from one */
  pack?: string;
  /** the extracted pack of each requested LBA index ("idx" or "idx:sub") */
  packs?: Record<string, string>;
}

/** The natives manifest (tools/build_native_screens.py): one entry per screen module, and the resident image. */
export interface NativeScreenManifest {
  screens: Record<string, NativeScreenEntry>;
  resident: { base: number };
}

/** The six worn-slot item ids of a record (0 / absent = empty). */
export interface SeedEquipment {
  head?: number;
  body?: number;
  right?: number;
  left?: number;
  acc0?: number;
  acc1?: number;
}

/** One party record to seed: the roster slot it lands in, and the numbers its status sheet reads. */
export interface SeedRosterRow {
  slot?: number;
  starterSlot?: number;
  exp?: number;
  level?: number; tp?: number; hp?: number; maxHp?: number; mp?: number; maxMp?: number;
  name?: string;
  core?: number[]; elements?: number[];
  forms?: RosterFormState;
  equipment?: SeedEquipment;
}

/** The host save-context seed: the party map (roster slot per position, 0xffffffff = empty), and the records. */
export interface NativePartySeed {
  positions?: number[];
  stats?: SeedRosterRow[];
}

/** What a seed or pre-boot callback is handed: the runtime and its memory, read and written by address. */
export interface NativeScreenIo {
  rt: NativeRuntimeView;
  read: (addr: number, size?: number) => number | null;
  write: (addr: number, value: number, size?: number) => boolean | void;
}

/** What a boot may override on top of the manifest: the root constructor, the object lifecycle rule, the SFX hook,
 *  the browser's card, the mixed-mode bridge, real root arguments, and the writes the constructor reads. */
export interface NativeBootOpts {
  rootCtor?: number | undefined;
  objectLifecycle?: boolean | undefined;
  playPackedSound?: ((id: number) => void) | undefined;
  memcard?: NativeMemcardHost | undefined;
  bridge?: boolean | undefined;
  rootArgs?: number[] | undefined;
  skipClip?: ((name: string, id: number) => boolean) | undefined;
  preBoot?: ((io: NativeScreenIo) => void) | undefined;
}

/** The runtime as the driver uses it: the class's public members, and `deadCbs` (private in the class, read here to see an object die). */
export type NativeRuntimeView = Pick<NativeStageRuntime, keyof NativeStageRuntime> & { deadCbs: Set<number> };

/** The booted screen the driver is running. */
export interface NativeScreenCurrent {
  module: string;
  entry: NativeScreenEntry;
  rt: NativeRuntimeView;
  booted: boolean;
  /** the first object the boot constructor allocates: its death means the screen is over */
  rootAddr: number;
  frames: number;
  drawIntents: number;
  methods: Record<string, number>;
  traps: number;
  lastDraw: { method: string; args: number[] } | null;
  lastTrap: { pc: number; cb: number; reason: string } | null;
  bridgeEnabled: boolean;
  bridgeBaseline: Map<string, number>;
}

/** The driver's state: what was preloaded and the screen now running. */
export interface NativeScreenDriverState {
  manifest: NativeScreenManifest | null;
  resident: Uint8Array | null;
  /** module -> overlay image */
  overlays: Record<string, Uint8Array>;
  /** bank id -> bank bytes */
  banks: Map<number, Uint8Array>;
  current: NativeScreenCurrent | null;
}

/** One line record of a live text widget: the string pointer, its sizes and the bytes read from it. */
export interface NativeTextLine {
  ptr: number;
  capacity: number;
  len: number;
  index: number;
  flag: number;
  bytes: number[] | null;
}

/** A live class-A text widget with the fields a renderer needs, and its memory readers. */
export interface NativeTextWidget {
  addr: number;
  font: number;
  penX: number;
  penY: number;
  fixedPitch: boolean;
  cellWidth: number;
  lineHeight: number;
  total: number;
  revealFirst: number;
  revealEnd: number;
  colour: number;
  alignWidth: number;
  paletteAdd: number;
  visible: number;
  read8: (addr: number) => number;
  read16: (addr: number) => number;
  read16s: (addr: number) => number;
  read32: (addr: number) => number;
  lines: NativeTextLine[];
}

/** A live object of the runtime's schedule. */
export interface NativeScreenObject {
  addr: number;
  cb: number;
  alive: boolean;
}

/** What the text drawing returns: counters and the decoded strings. */
export interface NativeTextStats {
  ready: boolean;
  widgets: number;
  lines: number;
  drawn: number;
  unknown: number;
  texts: string[];
}
