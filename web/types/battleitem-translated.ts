// Types only: the shapes web/battleitem-translated.ts takes from its caller. Nothing here is
// emitted (node's strip mode erases it), so this file must never hold runtime code.

/** The carried items the ITEM page opens on: the original's own filter, as id / count / family. */
export interface BattleItemSeed {
  items?: { id?: number; qty?: number; family?: number }[];
}
