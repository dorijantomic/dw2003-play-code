// engine/systems/list-scrollbar.ts
// The one scroll bar every long list in this game uses.
//
// SCREEN-OBJECT-NAME-AUDIT-001 established that the lab desk's digivolve list,
// the folder editor's swap list and the pause menu's bag all install the SAME
// four setters, byte for byte: (x, width), (track top, track bottom),
// (rows that fit, entries in the list) and (the entry at the top). Two screens
// had those setters named as something local — an "evolution capsule" at the lab
// desk and a "scroll tween" in the folder editor — and neither thing exists.
//
// The thumb arithmetic is DRI-LIST-SCROLLBAR-001: the per-entry step is
// ((bottom - top) << 8) / entries, the thumb is that step times the rows that
// fit, and the last entry parks the thumb flush with the bottom of the track.
// Each screen supplies its own geometry from its own call site; nothing here is
// invented.

export interface ListScrollbarGeom {
  /** left edge of the bar */
  x: number;
  /** bar width */
  width: number;
  /** track top */
  y0: number;
  /** track bottom */
  y1: number;
  /** how many rows the window shows at once */
  visible: number;
  /** the screen only creates the bar from this many entries up */
  minRows: number;
}

export interface ListScrollbarThumb { x: number; y: number; w: number; h: number; }

/**
 * The thumb rectangle for a list of `entries` scrolled to `topEntry`, or null
 * when the screen would not have created the bar at all.
 */
export function listScrollbarThumb(
  entries: number, topEntry: number, geom: ListScrollbarGeom,
): ListScrollbarThumb | null {
  if (entries < geom.minRows) return null;
  const span = geom.y1 - geom.y0;
  const step = Math.trunc((span << 8) / entries);
  const thumbH = (step * geom.visible) >> 8;
  let y: number;
  if (topEntry >= entries - 1) y = geom.y1 - thumbH;
  else {
    y = geom.y0 + ((topEntry * step) >> 8);
    if (y > geom.y1 - thumbH) y = geom.y1 - thumbH;
  }
  return { x: geom.x, y, w: geom.width, h: Math.max(1, thumbH) };
}
