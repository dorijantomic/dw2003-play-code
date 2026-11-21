// Types only: one interface per object the converted code creates empty and fills in later
// (see tools/rewrite/add-types.mjs). Nothing here is emitted — node's strip mode erases the
// declarations — so this file must never hold runtime code.

/** One culled texture page of the arena, as the cull pass left it. */
export interface ArenaCullGroup {
  /** the texture page's name (or its index, on the older layers) */
  page: string | number;
  /** the palette the page is drawn with */
  clut: number[];
  kept: number;
  total: number;
}

/** The arena cull pass's running counters (gl.ts), reported by the debug overlay. */
export interface ArenaCullLog {
  groups?: ArenaCullGroup[];
  kept: number;
  total: number;
}
