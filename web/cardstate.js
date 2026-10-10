// web/cardstate.js — shared card-battle state for the browser screens.
//
// The catalog itself is decoded data (tools/extract_card_catalog.py, from
// CARDPAK0..4.BIN).
//
// UPDATED 2026-08-07 — two of the three WALKER RULES here are now decoded and
// extracted, and the paragraph that used to live here was wrong:
//
//   * Starter deck — DECODED. web/assets/data/card_starter.json, the 40 u32
//     card ids at 0x8004B49C granted by F0x80016E6C, which also pre-fills all
//     THREE folders with them. A new game does not start with empty folders.
//   * Booster pools — DECODED. web/assets/data/card_boosters.json. The old note
//     claimed the pool's "group boundaries are not referenced by any absolute
//     address in the overlay". That was FALSE: the 0x1C-stride set table at
//     0x8008C708 points straight at them. 35 sets x 6 pools x 16 entries = 3360
//     words, i.e. the whole region. Draw i of a pack uses pool i — the six
//     pools are ordered slots, not alternatives — and repetition within a pool
//     is the rarity weighting.
//   * Shop price table — DECODED 2026-08-08. web/assets/data/card_prices.json,
//     44 (cardId, price) pairs at 0x8008CD20 reached through the pointer at
//     0x8008CB9C; a card the list omits costs 1. cardPrice is a lookup now, not
//     a rule.
//   * Shop STOCK — DECODED 2026-08-08. web/assets/data/card_shops.json, 24
//     stock sets of six cards at the 0xC-stride table 0x8008CDD4. The 44 cards
//     those sets sell are exactly the 44 the price list prices.
//
// B2 (the starter grant) is wired below; B1 (packs) is tracked in
// docs/todo/2026-08-07-card-battle-implementation-wiring.md.
import {
  ui, createCollection, serializeCollection, deserializeCollection,
  grantCard, grantStarterDeck, ownedCount, spareCount,
  seeCard, hasSeenCard, loseCard,
  addToFolder, removeFromFolder, folderIsLegal, FOLDER_SIZE, COLLECTION_CAP,
  packCount, grantPack, openPack, CARDS_PER_PACK, PACK_STOCK_CAP,
  bindBoosterStock, BOOSTER_ITEM_IDS,
} from "./vendor/engine.js";

let CATALOG = null;
let catalogPromise = null;

export function loadCatalog() {
  if (catalogPromise) return catalogPromise;
  catalogPromise = fetch("assets/data/card_catalog.json")
    .then((r) => r.json())
    .then((j) => { CATALOG = j; return j; })
    .catch(() => null);
  return catalogPromise;
}

export function catalog() { return CATALOG; }
export function catalogReady() { return !!CATALOG; }

// The card icons are each record's own 8bpp TIM at +0x0C, decoded to a 32x32
// atlas by tools/extract_card_catalog.py. Cell index = card id - 1.
let ICONS = null;
let iconsReady = false;
export function loadCardIcons() {
  if (ICONS) return ICONS;
  ICONS = new Image();
  ICONS.onload = () => { iconsReady = true; };
  ICONS.src = "assets/cards/card_icons.png";
  return ICONS;
}

/** Draw a card's icon at its native 32x32, or scaled to `size` if given. */
export function drawCardIcon(ctx, id, x, y, size = null) {
  if (!iconsReady || !CATALOG?.icons || !id) return false;
  const ic = CATALOG.icons;
  const idx = id - 1;
  if (idx < 0) return false;
  const sx = (idx % ic.cols) * ic.cellW;
  const sy = Math.floor(idx / ic.cols) * ic.cellH;
  const w = size ?? ic.cellW;
  const h = size ?? ic.cellH;
  ctx.drawImage(ICONS, sx, sy, ic.cellW, ic.cellH, x, y, w, h);
  return true;
}

export function cardById(id) {
  return CATALOG?.cards?.find((c) => c.id === id) ?? null;
}

// The disc keeps the whole collection in the save context; the walker's other
// progress keys are localStorage entries, so the collection is one too. Hydrate
// at module load, BEFORE the boot starter grant, so grantStarterDeck sees the
// saved folders and is a no-op for an existing player (it returns false when
// folders already exist). Without this a reload lost every card gained from a
// grant, booster, shop or duel.
const CARD_COLLECTION_KEY = "cardCollection";
function loadPersistedCollection() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CARD_COLLECTION_KEY);
    return raw ? deserializeCollection(JSON.parse(raw)) : null;
  } catch {
    return null; // corrupt blob: start clean rather than crash the boot
  }
}
const collection = loadPersistedCollection() ?? createCollection();

/** Write the collection to the save slot. Any mutation path that bypasses the
 *  wrappers here (the story-flag grant, the folder editor) is covered by the
 *  shell's throttled sweep, which compares serialized state and writes on change. */
export function persistCollection(storage = (typeof localStorage !== "undefined" ? localStorage : null)) {
  if (!storage) return;
  try {
    storage.setItem(CARD_COLLECTION_KEY, JSON.stringify(serializeCollection(collection)));
    const inventory=ui.cardPackInventory(collection);
    if(inventory)storage.setItem('inventory',JSON.stringify(inventory));
  }
  catch { /* storage full/denied: the next sweep retries */ }
}

/** The serialized form, for the shell's change-detecting sweep. */
export function collectionSnapshot() {
  return JSON.stringify(serializeCollection(collection));
}

/** Empty the collection in place (New Game). The starter deck is re-seeded by
 *  the caller through ensureStarterFolder, matching F0x80016E6C. */
export function resetCollection() {
  collection.owned.clear();
  collection.seen.clear();
  collection.folders.length = 0;
  collection.activeFolder = 0;
  collection.packs.clear();
}

export function cards() { return collection; }

let inventoryState = null;
function persistInventory() {
  if (inventoryState && typeof localStorage !== "undefined")
    localStorage.setItem("inventory", JSON.stringify(inventoryState.inventory));
}
export function bindCardInventory(state) {
  inventoryState = state;
  bindBoosterStock(collection, state, BOOSTER_ITEM_IDS);
  persistInventory();
}

// The starter grant: the 40 u32 card ids at 0x8004B49C, extracted to
// card_starter.json by tools/extract_card_starter.py.
// — cardgame-starter-deck-grant-and-the-collection-api,
//   cardgame-starter-folder-forty-ids-extracted
let STARTER = null;
let starterPromise = null;

export function loadStarter() {
  if (starterPromise) return starterPromise;
  starterPromise = fetch("assets/data/card_starter.json")
    .then((r) => r.json())
    .then((j) => { STARTER = j; return j; })
    .catch(() => null);
  return starterPromise;
}

export function starter() { return STARTER; }

/** Grant the starter deck. F0x80016E6C adds one copy of each of the 40 table
 *  entries to the collection — so a card listed three times is owned three
 *  times — then writes the SAME 40 ids into the folder entry array three times
 *  at the 0x66 folder stride. All three folders therefore start identical and
 *  full, not empty.
 *
 *  WALKER RULE: *when* the grant fires is not decoded — F0x80016E6C has no
 *  located caller — so the walker keeps the lazy first-open trigger. */
export function ensureStarterFolder() {
  if (!CATALOG || !STARTER) return;
  if (grantStarterDeck(collection, STARTER.cardIds ?? [], STARTER.folders ?? 3)) persistCollection();
}

// Booster packs are EARNED, not bought: winning a duel bumps the per-set byte
// at save + setId + 0x7c (capped at 99), opening a pack spends one, and a set
// with no stock is not offered in the shop list at all. The pools are the
// 0x8008C708 table — 35 sets of six ordered per-slot pools of sixteen ids.
// — cardgame-booster-pack-exists-in-the-shop-and-0x7c-is-the-pack-stock,
//   cardgame-booster-pools-are-35-sets-of-six-per-slot-pools-of-sixteen
let BOOSTERS = null;
let boostersPromise = null;

export function loadBoosters() {
  if (boostersPromise) return boostersPromise;
  boostersPromise = fetch("assets/data/card_boosters.json")
    .then((r) => r.json())
    .then((j) => { BOOSTERS = j; return j; })
    .catch(() => null);
  return boostersPromise;
}

export function boosters() { return BOOSTERS; }

/** Cards per pack: six, one drawn from each of the set's six ordered pools. */
export const BOOSTER_SIZE = CARDS_PER_PACK;

function poolsOf(setId) {
  const set = BOOSTERS?.sets?.find((s) => s.setId === setId);
  return set ? set.pools.map((p) => p.cards) : null;
}

/** The set ids the player actually holds packs for, in table order. */
export function heldPackSets() {
  if (!BOOSTERS) return [];
  return BOOSTERS.sets
    .map((s) => s.setId)
    .filter((id) => packCount(collection, id) > 0);
}

/** The opponent table selects an item id, read and incremented in the bag.
 * cardgame.s:33088-33096; stcrdshp.s:2129 reads that same byte. */
export function grantPackForOpponent(opponent) {
  const setId = opponent?.packSetId;
  if (typeof setId !== "number") return false;
  grantPack(collection, setId, 1);
  persistCollection();
  persistInventory();
  return true;
}

/** Open one held pack. Returns the six catalog records drawn, or null when the
 *  set has no stock. */
export function openBooster(setId, rng = Math.random) {
  const pools = poolsOf(setId);
  if (!CATALOG || !pools) return null;
  const ids = openPack(collection, setId, pools, rng);
  if (!ids) return null;
  persistCollection();
  persistInventory();
  return ids.map((id) => cardById(id)).filter(Boolean);
}

// CARD_NPC.BIN: 170 records of 0xD0 stride, each a 40-entry deck plus a
// response list, with a per-entry availability group and AI play class.
// — cardgame-opponent-table-is-card-npc-bin-170-records,
//   cardnpc-record-layout-40-entries-plus-response-list
let OPPONENTS = null;
let opponentsPromise = null;

export function loadOpponents() {
  if (opponentsPromise) return opponentsPromise;
  opponentsPromise = fetch("assets/data/card_opponents.json")
    .then((r) => r.json())
    .then((j) => { OPPONENTS = j; return j; })
    .catch(() => null);
  return opponentsPromise;
}

export function opponents() { return OPPONENTS; }

export function opponentById(id) {
  return OPPONENTS?.opponents?.find((o) => o.id === id) ?? null;
}

/** An opponent record's deck as the duel wants it: the 40 card ids in authored
 *  slot order, and the AI play class of each slot alongside. The class is
 *  authored PER SLOT, so the two arrays must stay parallel. */
export function opponentDeck(record) {
  const deck = record?.deck ?? [];
  return {
    cards: deck.map((e) => e.cardId),
    aiClass: deck.map((e) => e.aiClass),
    setGroup: deck.map((e) => e.setGroup),
  };
}

// ---- the card-shop price list ----------------------------------------------
// DECODED 2026-08-08. The shop does not compute a price: it calls the routine
// held at 0x8008CB9C (= F0x8008923C), which linear-searches 44 (cardId, price)
// halfword pairs at 0x8008CD20 and returns the price of the first id that
// matches. The list is zero-terminated on the card id.
//
// A card that is NOT in the list costs 1 — the `li $v0, 0x1` in that function's
// `jr $ra` delay slot. That is the original's behaviour, not a stand-in for
// data we are missing: most of the 316-card catalog is genuinely absent, and
// the shop only ever offers cards that are listed.
//
// The old rule here derived a price from stage and Program cost. That model is
// disproved, not merely imprecise: the real prices are not monotonic in stage
// (Soulmon, a champion, costs 500 while the champion Devidramon costs 1000) nor
// in stats (Puppetmon 36/30 costs 9000, KingEtemon 38/35 costs 8000).
// — tools/extract_card_prices.py
let PRICES = null;
let pricesPromise = null;
/** the original's not-listed price, overwritten by the loaded table */
let DEFAULT_PRICE = 1;

export function loadCardPrices() {
  if (pricesPromise) return pricesPromise;
  pricesPromise = fetch("assets/data/card_prices.json")
    .then((r) => r.json())
    .then((j) => {
      PRICES = new Map(j.prices.map((p) => [p.id, p.price]));
      if (typeof j.defaultPrice === "number") DEFAULT_PRICE = j.defaultPrice;
      return PRICES;
    })
    .catch(() => PRICES);
  return pricesPromise;
}

/** What the shop charges for a card. Accepts a card record or a bare id. */
export function cardPrice(card) {
  if (card == null) return 0;
  const id = typeof card === "number" ? card : card.id;
  if (id == null) return DEFAULT_PRICE;
  // Before the table has loaded there is nothing to look up; the shop screen
  // awaits loadCardPrices() before drawing, so this only guards early callers.
  return PRICES?.get(id) ?? DEFAULT_PRICE;
}

/** debug/tests: the decoded not-listed price. */
export function cardDefaultPrice() {
  return DEFAULT_PRICE;
}

// ---- the per-shop stock list ----------------------------------------------
// DECODED 2026-08-08. A shop does not offer the catalog: the routine at
// 0x8008CB98 (= F0x80089160) looks the shop id up in a 0xC-stride record table
// at 0x8008CDD4 and hands back a record whose +0x08 points at a zero-terminated
// list of card ids. Every shipped record holds exactly six.
//
// A record is one STOCK SET, not one location — a shop's stock changes with
// story progress and each variant is its own record, which is why there are 24
// records for far fewer shops. An unknown shop id falls back to record 0, the
// way the lookup does at .L0x00006504.
//
// The 44 distinct cards these records sell are exactly the 44 the price list
// prices — the two tables agree with no leftovers on either side.
// — tools/extract_card_shops.py
let SHOPS = null;
let shopsPromise = null;

export function loadCardShops() {
  if (shopsPromise) return shopsPromise;
  shopsPromise = fetch("assets/data/card_shops.json")
    .then((r) => r.json())
    .then((j) => { SHOPS = j; return j; })
    .catch(() => SHOPS);
  return shopsPromise;
}

/** Card ids a shop stocks. Unknown id falls back to record 0, as the disc does.
 *  Returns [] before the table has loaded. */
export function shopStock(shopId) {
  const list = SHOPS?.shops;
  if (!list?.length) return [];
  const rec = list.find((s) => s.shopId === shopId) ?? list[0];
  return rec.cardIds.slice();
}

/** Every stock set, for the lab and for tests. */
export function cardShopIds() {
  return (SHOPS?.shops ?? []).map((s) => s.shopId);
}

/** Has the player ever obtained this card? The Card Album keys on this, not on
 *  the copy count — see `hasSeenCard` in the engine. */
export function seenCard(id) { return hasSeenCard(collection, id); }

export {
  grantCard, ownedCount, spareCount, addToFolder, removeFromFolder, folderIsLegal,
  packCount, grantPack, FOLDER_SIZE, COLLECTION_CAP, PACK_STOCK_CAP,
  seeCard, hasSeenCard, loseCard,
};
