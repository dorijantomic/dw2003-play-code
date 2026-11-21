/** A bone's DW2 channel-2 keys: one [time, x, y, term] row per key. */
export interface Dw2MotionCh2 {
  ch2?: number[][];
}

/** A bone's DW2 channel-1 keys: one [time, x, y, term] row per key. */
export interface Dw2MotionCh1 {
  ch1?: number[][];
}

/** One DW2 motion as the swap gate judged it: the per-bone keys, the playlist, and the table it wants. */
export interface Dw2Motion {
  keys?: Record<string, number[][]>;
  playlist?: number[][];
  used?: boolean;
  table?: number;
  /** either one bone's keys, or a per-bone map of them */
  ch1?: number[][] | Record<number, number[][]>;
  rootBone?: number;
}

/** What the gate measured on one model: the motions it judged (by letter) and the slots it already owns. */
export interface Dw2SwapData {
  motions?: Record<string, Dw2Motion>;
  ownedSlots?: number[];
}

/** The two rows the hand-pick menu offers for a slot: the DW2 fill and what that slot plays today. */
export interface Dw2ActionsOptions {
  folder?: string | null;
  slot?: number;
  letter?: string | null;
  tables?: Record<string, number> | null;
  any?: boolean;
}

/** The deep link that opens the viewer on one filled slot (`?dw2fill=<slot>&letter=<A>...`). */
export interface Dw2Query {
  slot?: number;
  folder?: string;
  letter?: string | null;
  ab?: string | null;
}

/** A fetch that already has the DW2 rewrite in front of it (installDw2Fetch marks its shim). */
export type Dw2Fetch = typeof fetch & { __dw2mShim?: boolean };
