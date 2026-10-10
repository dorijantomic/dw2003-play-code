// engine/persistence/save-manager.ts
// Delta save + schema-versioned migrations over GameState (architecture.md §14). GameState
// already serializes only state deltas (flags/vars/inventory/party); this layer stamps the
// schema version and upgrades older blobs through an ordered migration chain on load.

import type { GameState, SaveBlob } from "../core/state/game-state.ts";

export type { SaveBlob };

/** Current on-disk schema version. Bump when SaveBlob's shape changes + add a migration. */
export const SAVE_VERSION = 1;

export type Migration = (b: SaveBlob) => SaveBlob;

const migrations = new Map<number, Migration>();

/** Register an upgrade from schema `from` → `from + 1` (idempotent re-registration). */
export function registerMigration(from: number, fn: Migration): void {
  migrations.set(from, fn);
}

/** Upgrade a blob to SAVE_VERSION by applying registered migrations in order. */
export function migrate(blob: SaveBlob): SaveBlob {
  let b = blob;
  let guard = 0;
  while (b.version < SAVE_VERSION && guard++ < 1000) {
    const fn = migrations.get(b.version);
    if (!fn) break; // no path forward — load what we have (forward-compatible best effort)
    b = fn(b);
  }
  return b;
}

/** Serialize the current state to a save blob stamped with the current schema version. */
export function save(gs: GameState): SaveBlob {
  return { ...gs.toSave(), version: SAVE_VERSION };
}

/** Apply migrations, then restore the blob into `gs` (rebuilds the world from state). */
export function load(gs: GameState, blob: SaveBlob): void {
  gs.fromSave(migrate(blob));
}
