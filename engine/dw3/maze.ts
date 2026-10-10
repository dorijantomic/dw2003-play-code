/**
 * The wrap-maze exit graph (Mobius Desert, Seabed, Circuit Board).
 *
 * A maze stage's `scene_struct+0x14` step program is its ARRIVAL-PAD list -- where
 * other stages drop you INTO it -- which is why it holds only "self-warps" to the
 * stage's own screen and why the mazes shipped dead in the walker. The real exit
 * graph is a separate static 16-byte record table in the same overlay, extracted by
 * `tools/extract_maze_exits.py` into `maze_sections.json` and attached to each scene
 * as `mazeSections`.
 *
 * One SECTION is one (key, companion) route pair -- the pair the field engine keeps
 * in [0x80048d78]/[0x80048d7a]. Its exits carry the DESTINATION's pair, so walking
 * an exit both moves you and re-stamps which section you are in, and bank 0x7E then
 * decides who is standing in the stage's single occupant slot. Inside the Circuit
 * Board every exit is dir 1 (south) or dir 5 (north); a hole out to the surface is
 * dir 0 and carries key = companion = 0, i.e. it clears the pair.
 *
 * Ledger: maze-exit-record-table.
 */

export interface MazeExit {
  screen: number;
  key: number;
  companion: number;
  x: number;
  y: number;
  dir: number;
}

export interface MazeSection {
  key: number;
  companion: number;
  exits: MazeExit[];
}

/** A hole leads out of the maze: dir 0, and both route coordinates cleared. */
export function isHole(exit: MazeExit): boolean {
  return exit.dir === 0 && exit.key === 0 && exit.companion === 0;
}

/** The section the player is currently in, or undefined if the pair matches none. */
export function currentSection(
  sections: MazeSection[] | undefined,
  key: number,
  companion: number,
): MazeSection | undefined {
  return sections?.find((s) => s.key === key && s.companion === companion);
}

/**
 * Resolve one wrap trigger: which exit does leaving section (key, companion) in
 * direction `dir` take?
 *
 * Returns undefined when the pair names no section (so the caller keeps whatever
 * the placeholder exit said) rather than guessing a section -- an unmatched pair
 * means the player got here by a route the table does not describe, and inventing
 * a destination there would fabricate map topology.
 *
 * When the section has exactly one exit, direction is not consulted: a
 * single-exit section is a corridor, and the original's trigger geometry is one
 * wedge. With several exits the direction selects; ties keep table order, which is
 * the order the records are chained in.
 */
export function resolveMazeExit(
  sections: MazeSection[] | undefined,
  key: number,
  companion: number,
  dir: number | null,
): MazeExit | undefined {
  const section = currentSection(sections, key, companion);
  if (!section || section.exits.length === 0) return undefined;
  if (section.exits.length === 1) return section.exits[0];
  if (dir === null) return undefined;
  return section.exits.find((e) => e.dir === dir);
}
