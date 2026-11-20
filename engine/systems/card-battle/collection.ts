import { COLLECTION_CAP, FOLDER_COLOURS, FOLDER_SIZE, MAX_COPIES_PER_FOLDER } from "./types.ts";

export interface CardCollection {
  /** card id -> copies owned */
  owned: Map<number, number>;
  /** Ids ever obtained. A SECOND per-card byte on the disc (save + 0x4DF + id),
   *  parallel to the owned count at +0x3A2 and completely independent of it —
   *  see `seeCard`. */
  seen: Set<number>;
  /** named folders, each a list of card ids (duplicates allowed) */
  folders: { name: string; cards: number[] }[];
  activeFolder: number;
  /** booster-pack set id -> packs held, the byte at save + setId + 0x7c. */
  packs: Map<number, number>;
}

export function createCollection(): CardCollection {
  return { owned: new Map(), seen: new Set(), folders: [], activeFolder: 0, packs: new Map() };
}

/** Plain JSON form of a collection for the browser's save. Maps and Sets are
 *  stored as entry arrays so the shape survives JSON. */
export interface CardCollectionSave {
  owned: [number, number][];
  seen: number[];
  folders: { name: string; cards: number[] }[];
  activeFolder: number;
  packs: [number, number][];
}

export function serializeCollection(col: CardCollection): CardCollectionSave {
  return {
    owned: [...col.owned.entries()],
    seen: [...col.seen.values()],
    folders: col.folders.map((f) => ({ name: f.name, cards: f.cards.slice() })),
    activeFolder: col.activeFolder,
    packs: [...col.packs.entries()],
  };
}

export function deserializeCollection(data: CardCollectionSave | null | undefined): CardCollection {
  const col = createCollection();
  if (!data) return col;
  for (const [id, n] of data.owned ?? []) col.owned.set(Number(id), Number(n));
  for (const id of data.seen ?? []) col.seen.add(Number(id));
  for (const f of data.folders ?? []) {
    col.folders.push({ name: String(f?.name ?? ""), cards: (f?.cards ?? []).map(Number) });
  }
  col.activeFolder = Number(data.activeFolder ?? 0);
  for (const [id, n] of data.packs ?? []) col.packs.set(Number(id), Number(n));
  return col;
}

// ---------------------------------------------------------------------------
// Booster packs
// ---------------------------------------------------------------------------

/** Cards drawn when a pack is opened — one per pool, not six from one pool. */
export const CARDS_PER_PACK = 6;

/** Entries in each per-slot pool; the draw index is the RNG reduced mod 16. */
export const PACK_POOL_ENTRIES = 16;

/** The per-set pack counter saturates rather than wrapping. */
export const PACK_STOCK_CAP = 99;

export function packCount(col: CardCollection, setId: number): number {
  return col.packs.get(setId) ?? 0;
}

/** Winning a duel increments the pack counter for the opponent's set, capped
 *  at 99.
 *  — cardgame-duel-win-reward-is-a-capped-byte-at-0x80048d34-plus-0x2ec-plus-0x7c */
export function grantPack(col: CardCollection, setId: number, count = 1): void {
  col.packs.set(setId, Math.min(packCount(col, setId) + count, PACK_STOCK_CAP));
}

/** Open one pack of `setId`. Draw *i* reads pool *i* — the six pointers are
 *  per-slot, not alternatives — at `rng % 16`, and a card's repetition inside
 *  its pool IS its rarity weighting; there is no weight field. Each card is
 *  granted through the nine-copy-clamping add, so a card already at nine
 *  silently wastes its slot, exactly as the disc's add routine does.
 *
 *  Returns the six ids drawn, or null when no pack of that set is held — a set
 *  whose counter is <= 0 is not even offered in the shop list.
 *  — cardgame-booster-pools-are-35-sets-of-six-per-slot-pools-of-sixteen,
 *    cardgame-booster-pack-exists-in-the-shop-and-0x7c-is-the-pack-stock */
export function openPack(
  col: CardCollection,
  setId: number,
  pools: number[][],
  rng: () => number = Math.random,
): number[] | null {
  if (packCount(col, setId) <= 0) return null;
  if (pools.length < CARDS_PER_PACK) return null;
  const drawn: number[] = [];
  for (let i = 0; i < CARDS_PER_PACK; i++) {
    const pool = pools[i]!;
    const id = pool[Math.floor(rng() * PACK_POOL_ENTRIES) % pool.length]!;
    grantCard(col, id, 1);
    drawn.push(id);
  }
  col.packs.set(setId, packCount(col, setId) - 1);
  return drawn;
}

/** The disc's collection add routine clamps at nine regardless of caller, so a
 *  booster that would push a card past nine silently wastes the slot.
 *
 *  It also raises the album's "ever obtained" byte, unconditionally and before
 *  the add — so a grant of zero still reveals the card.
 *  — UI-CARDALBUM-SEEN-FLAG-IS-A-SECOND-ARRAY-2026-08-14 */
export function grantCard(col: CardCollection, id: number, count = 1): void {
  seeCard(col, id);
  const next = (col.owned.get(id) ?? 0) + count;
  col.owned.set(id, Math.min(next, COLLECTION_CAP));
}

/** Raise the album's "ever obtained" flag without changing the copy count.
 *  The disc has one store to this array in the whole corpus and it writes the
 *  constant 1, so the flag is set-only: nothing clears it.
 *  — UI-CARDALBUM-SEEN-FLAG-IS-SET-ONLY-2026-08-14 */
export function seeCard(col: CardCollection, id: number): void {
  col.seen.add(id);
}

/** Has this card ever been obtained? This, NOT the copy count, is what the
 *  Card Album shows: the disc's cell and detail draws both test the +0x4DF
 *  byte and never read the count to decide whether a card is revealed.
 *  — UI-CARDALBUM-CELLS-KEY-ON-THE-SEEN-FLAG-2026-08-14 */
export function hasSeenCard(col: CardCollection, id: number): boolean {
  return col.seen.has(id);
}

/** Remove copies of a card. The disc's remove routine decrements by one and
 *  floors at zero (it re-reads the byte signed and zeroes it when it goes
 *  negative), and it does NOT touch the album flag — losing your last copy
 *  leaves the card in the album with a count of zero.
 *  — UI-CARDALBUM-SEEN-FLAG-IS-SET-ONLY-2026-08-14 */
export function loseCard(col: CardCollection, id: number, count = 1): void {
  const next = (col.owned.get(id) ?? 0) - count;
  col.owned.set(id, Math.max(next, 0));
}

/** The new-game starter grant. F0x80016e6c adds one copy of each of the 40
 *  entries in the table at 0x8004b49c to the collection — a card listed three
 *  times is owned three times — then writes the SAME 40 ids into the folder
 *  entry array `folders` times at the 0x66 folder stride, so every folder
 *  starts identical and full rather than empty. The folders start UNNAMED:
 *  the new game zero-fills the save block first (F0x80016a94 -> F0x80017cb0)
 *  and only the naming screen ever writes a folder's name, so its ten-character
 *  field stays blank until the player names it. Does nothing if the collection
 *  already has folders.
 *  — cardgame-starter-deck-grant-and-the-collection-api,
 *    cardgame-starter-folder-forty-ids-extracted */
export function grantStarterDeck(col: CardCollection, ids: number[], folders = 3): boolean {
  if (col.folders.length || ids.length !== FOLDER_SIZE) return false;
  for (const id of ids) grantCard(col, id, 1);
  for (let i = 0; i < folders; i++) {
    col.folders.push({ name: "", cards: ids.slice() });
  }
  col.activeFolder = 0;
  return true;
}

/**
 * Rename a folder.
 *
 * There is one way in, and it is decoded: the folder list's second row,
 * "Change name" (card-shop bank string 0x1b), hands the folder's own name field
 * to the shared NAMEDT keyboard, and the screen frame writes the typed name
 * back into the record when it finishes. The 87 preset names in escrddek.toml
 * are NOT offered here — this overlay never loads that bank.
 * — docs/research/ui/card-folder-editor-2026-08-14.md §2, §7
 *
 * An empty or blank name is refused, so a folder always has something to show.
 */
export function renameFolder(col: CardCollection, index: number, name: string): boolean {
  const folder = col.folders[index];
  if (!folder) return false;
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return false;
  folder.name = trimmed;
  return true;
}

export function ownedCount(col: CardCollection, id: number): number {
  return col.owned.get(id) ?? 0;
}

/** Copies of `id` not already committed to the given folder (default: host activeFolder). */
export function spareCount(col: CardCollection, id: number, index = col.activeFolder): number {
  const folder = col.folders[index];
  const used = folder ? folder.cards.filter((c) => c === id).length : 0;
  return ownedCount(col, id) - used;
}

export function copiesInFolder(col: CardCollection, id: number, index = col.activeFolder): number {
  const folder = col.folders[index];
  return folder ? folder.cards.filter((c) => c === id).length : 0;
}

export function addToFolder(col: CardCollection, id: number): boolean {
  const folder = col.folders[col.activeFolder];
  if (!folder) return false;
  if (folder.cards.length >= FOLDER_SIZE) return false;
  if (spareCount(col, id) <= 0) return false;
  if (copiesInFolder(col, id) >= MAX_COPIES_PER_FOLDER) return false;
  folder.cards.push(id);
  return true;
}

export function removeFromFolder(col: CardCollection, slot: number): boolean {
  const folder = col.folders[col.activeFolder];
  if (!folder || slot < 0 || slot >= folder.cards.length) return false;
  folder.cards.splice(slot, 1);
  return true;
}

/** The result of trying to put a card into a folder slot, matching the three
 *  ways F0x80085210's confirm branch can end. */
export type FolderSwap = "ok" | "unchanged" | "limit" | "invalid";

/**
 * Put `id` into slot `slot` of the active folder, the disc's only way to change
 * a folder's contents.
 *
 * The editor does not add or remove — a folder always holds exactly 40 cards
 * and confirming on the swap list **overwrites the highlighted slot**. The card
 * that was there becomes available again at once, because availability is
 * recomputed as owned-minus-placed rather than tracked (F0x800847c0).
 *
 * Choosing the card that is already in the slot is allowed and changes nothing;
 * the disc special-cases it so re-picking cannot trip the four-copy gate.
 * — docs/research/ui/card-folder-editor-2026-08-14.md §4
 */
export function swapIntoFolder(col: CardCollection, slot: number, id: number, index = col.activeFolder): FolderSwap {
  const folder = col.folders[index];
  if (!folder || slot < 0 || slot >= folder.cards.length) return "invalid";
  if (folder.cards[slot] === id) return "unchanged";
  if (spareCount(col, id, index) <= 0) return "invalid";
  if (copiesInFolder(col, id, index) >= MAX_COPIES_PER_FOLDER) return "limit";
  folder.cards[slot] = id;
  return "ok";
}

/** Sort a folder ascending by card id — the folder editor's Circle button, a
 *  bubble sort over the 40 slots (F0x80085210 state 0x20). */
export function sortFolder(col: CardCollection, index = col.activeFolder): boolean {
  const folder = col.folders[index];
  if (!folder) return false;
  folder.cards.sort((a, b) => a - b);
  return true;
}

/**
 * The six numbers the folder list shows beside each folder's name: how many of
 * its cards fall in each colour, in FOLDER_COLOURS order.
 *
 * F0x8008924c zeroes six counters per folder, walks the 40 slots, looks each
 * card up in the resident catalog and increments `counter[colour byte - 1]`.
 * The editor refreshes them after every successful swap by calling the folder
 * list's method at +0x11c, which is this same routine.
 */
export function folderColourCounts(ids: number[], colourOf: (id: number) => string | number): number[] {
  const counts = new Array(FOLDER_COLOURS.length).fill(0);
  for (const id of ids) {
    const c = colourOf(id);
    const i = typeof c === "number" ? c - 1 : FOLDER_COLOURS.indexOf(c as typeof FOLDER_COLOURS[number]);
    if (i >= 0 && i < counts.length) counts[i] += 1;
  }
  return counts;
}

/** A folder is legal at exactly 40 cards with no more than four copies of any
 *  one card — the two rules the editor itself enforces. */
export function folderIsLegal(col: CardCollection): boolean {
  const folder = col.folders[col.activeFolder];
  if (!folder || folder.cards.length !== FOLDER_SIZE) return false;
  const seen = new Map<number, number>();
  for (const id of folder.cards) {
    const n = (seen.get(id) ?? 0) + 1;
    if (n > MAX_COPIES_PER_FOLDER) return false;
    seen.set(id, n);
  }
  return true;
}
