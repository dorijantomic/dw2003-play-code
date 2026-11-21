// Types only: the placement file web/arena-placer.ts edits and saves. Nothing here is emitted
// (node's strip mode erases declarations), so this file must never hold runtime code.
//
// Format (same as the header note in arena-placer.ts): edits map a scene path ("<name>|<inst>",
// "#n" = sibling n, inst -1 = a plain node) to what the placer did, and added holds the copies.

/** One moved thing: hidden, and its new local matrix (an instance: its instance matrix). */
export interface ArenaPlacementEdit {
  hidden?: boolean;
  /** the 16-element matrix, row-major */
  m?: number[];
}

/** One thing copied into the arena: from a scene path + instance, or from a registry asset id. */
export interface ArenaAddedCopy {
  id: string;
  src?: { path: string; inst: number };
  asset?: string;
  m?: unknown[];   // the 16-element matrix: Array.from(number[]) on the way in, a plain number[] from the file
}

/** `built/placements/<pack>.json` as the placer loads, edits and saves it. */
export interface ArenaPlacements {
  version?: number;
  pack?: string | null;
  savedAt?: number;
  draftAt?: number;
  unsaved?: boolean;
  edits: Record<string, ArenaPlacementEdit>;
  added: ArenaAddedCopy[];
}

/** Chrome's picked directory handle: it also asks for permission, which lib.dom has no member for. */
export interface PickedDirectory extends FileSystemDirectoryHandle {
  queryPermission?(descriptor: { mode: string }): Promise<string>;
  requestPermission?(descriptor: { mode: string }): Promise<string>;
}
