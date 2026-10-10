// engine/systems/card-battle.ts — the card duel's shared rules model.
//
// Card data comes from web/assets/data/card_catalog.json (tools/
// extract_card_catalog.py, CARDPAK0..4.BIN at the 1580-byte stride the resident
// selector exe/fns.s F0x8001e7ec computes) and web/assets/data/card_effects.json
// (tools/extract_card_effects.py, the 60-record 0x2c-stride Program-card table
// at 0x800a4df4 in pro/cardgame.s).
//
// EVERY rule below is cited to where it was decoded. Original assembly is
// authority 2; anything the walker had to choose is marked WALKER RULE at its
// site. The citations are to ~/ddw3/asm/dw2003/pro/cardgame.s unless stated.
//
// ---------------------------------------------------------------------------
// Decoded 2026-08-06 (docs/research/card/cardduel-rules-2026-08-06.md)
// ---------------------------------------------------------------------------
//
// The duel object's per-player block is 0xc8 bytes starting at +0x59c, and its
// layout settles the three table sizes outright, because each array runs
// exactly up to the next field:
//
//     +0x59c u16   total AP on the field       (written by F0x800a0acc)
//     +0x59e u16   total HP on the field
//     +0x5a0 u16   deck read cursor
//     +0x5a2 u16   trash count                 (F0x8008ec44 zone 4)
//     +0x5a4 u16   deck count                  (F0x8008ec44 zone 3)
//     +0x5a6 u16   hand count                  (F0x8008ec44 zone 2)
//     +0x5a8..5ac  S-Energy, one byte per colour, capped at 99
//     +0x5ae u8    sets won this duel
//     +0x5b0       deck array, u16 card ids  -> 0x600, so 40 entries
//     +0x600       hand array                -> 0x614, so 10 entries
//     +0x614       trash array               -> 0x664, so 40 entries
//
// So a Folder holds 40 cards, a hand holds 10, and the trash holds 40. The
// energy block is FIVE bytes, not six: F0x8008f560 (Anti-Power) clears it with
// `while (var_s0 < 5)` over both players, and the draw path at L13937 grants
// energy only when the drawn card's colour byte is `sltiu ..., 0x6` — colour 6,
// brown, has no slot. Claim: cardduel-per-player-block-sizes.
//
// The field is six slots per side. F0x8008def8 and F0x8008e08c both walk twelve
// slots (`while (var_s0 < 0xc)`) and split them with `if (var_s0 < 6)`: below
// six they index side 0's array at +0x72e, at or above six they index side 1's
// at +0x7a0, the two 0x72 bytes apart. Each slot is 0xe bytes: +0x0 card-slot
// ref, +0x2 AP, +0x4 HP (both AUTHORITATIVE, not deltas), +0x6 displayed AP,
// +0x8 displayed HP. CORRECTED: the "pending delta" reading was superseded on
// 2026-08-07 and re-confirmed 2026-08-25 — F0x8008DEF8 is the only writer of
// +0x2/+0x4 and it ADDS into them, while the ticker F0x8008E08C touches only
// +0x6/+0x8. See CARD-DUEL-VERIFIED.md.
//
// Per-Digimon AP and HP are capped at 99 and floored at 0 — F0x8008e08c ticks
// them one point per frame with `if (... < 0x63)` on the way up and `if (... >
// 0)` on the way down — and a slot whose HP has reached 0 is flagged for
// removal in the same function's tail. S-Energy uses the same 99 cap.
//
// The six phases are modes 3..8 of the round driver F0x800a1b48. Mode 0xa, the
// inter-phase step, indexes the 4-byte-stride table at 0x800a5d5c by the
// PREVIOUS mode; reading it out gives banner id 0xa0 + (m - 3) and the order
// 3-4-5-6-7-8 looping back to 3. Modes 5 and 7 share one update routine
// (F0x8009fdd8) in both dispatch tables, matching Load Phase and Compile Phase
// being the only two phases whose escardgm.toml prompt line is identical.
// Confirmed against a controlled capture in
// docs/research/card/captures/cardduel-full-duel-s482-state5-2026-08-05.md.
//
// The set is decided on TOTAL HP REMAINING, and a tie goes to the opponent.
// F0x800a0f94 (mode 8) cases 9 and 10 both read
//
//     if (arg0->unk666 < arg0->unk59e) winner = 0; else winner = 1;
//
// where +0x59e is side 0's total HP and +0x666 is side 1's (+0x59e + 0xc8).
// Side 0 is the player. So the player takes the set only on a strict win, and
// escardgm.toml's "It's a draw so you, the challenger, lose." is that `else`.
//
// The duel is best of three: F0x800a0f94 case 0x11 ends it when the player's
// set counter +0x5ae reaches 2 (outcome byte +0x302 = 0, win jingle
// 0x6004001e) or the opponent's +0x676 reaches 2 (+0x302 = 1). The polarity of
// +0x302 was confirmed by runtime capture on 2026-08-05.
//
// Combos: F0x800a0cd4 copies a side's field into a scratch list of
// (slot, cardId) pairs, bubble-sorts it by card id, and walks it counting runs
// of identical ids. A card whose CARDPAK +0x0a field is zero ends a run; when a
// run reaches three the routine flags those slots at +0x446 and stores the
// +0x0a value — a card id, following the digivolution lines — into the duel's
// combo slot at +0x438. The AI's own board evaluator F0x800a3934, installed at
// duel+0x820, counts a qualifying run's AP and HP a SECOND time on top of the
// plain field sum and adds a further +0x14 AP and +0x14 HP once the run
// reaches four. See comboBonus() for what the walker does with that.
//
// Program-card targeting is decoded from F0x800a36e4, which switches on the
// effect record's +0x00 byte and asks F0x8008eec8 (field, bit 8 = the actor's
// own side, bit 9 = the opponent's, bits 2..7 = colours white..brown per the
// table at 0x800a58f4) or F0x8008ec44 (zone 2 hand / 3 deck / 4 trash, kind
// mask bit 0 = Digimon, bit 1 = Program) whether a legal target exists.
// tools/extract_card_effects.py bakes that decode into card_effects.json.
//
// ---------------------------------------------------------------------------
// NOT decoded
// ---------------------------------------------------------------------------
//   - (RESOLVED 2026-08-25, was listed here as untraced.) The summon gate and
//     the spend are BOTH traced. F0x80085FD0 gates on mode 6, refuses anything
//     whose record +0x03 is not 0x10, and returns
//     `(energy[colour-1] < rec->+0x05) ^ 1` — verified instruction by
//     instruction: `lbu ($a0)` colour, `lbu 0x5($a0)` cost, `lbu -0x1($v0)`
//     the energy byte, `sltu` then `xori 1`. F0x8008735C performs the spend and
//     the REFUND. The earlier "no `lbu ..., 0x5(...)` resolves to a card record"
//     was an artifact of an offset-keyed scan that cannot see accesses made
//     through a pointer argument. payEnergy() below is therefore the disc's own
//     rule, not a walker stand-in. toggleSummonMark also ports the refund half
//     when the player unmarks a paid card (CARD-DUEL-VERIFIED.md §25/§28).
//   - how the opponent's total AP is distributed over the individual Digimon
//     in the Battle Phase. The comparison is on the recomputed totals, so the
//     walker spreads the damage in field order; the sums match either way.
//   - the rest of the opponent AI. Its hand order (AI class, then deck index),
//     its class-5 hold and its strength-rank minimisation ARE decoded and
//     implemented in discAgent below; F0x800a4978 is its card-legality scan and
//     F0x800a3934 its board evaluator, but where in the sequence a Program is
//     played rather than a Digimon summoned is not traced.
//   - the effect record's +0x03 byte, carried through as playKind.
//   - (RESOLVED 2026-08-25.) The five dynamic-stat Megas ARE read out. All five
//     formulas were derived from the arms of D0x80083960 and are implemented in
//     applyDynamicStatMegas() below. The table is 5 entries plus a null word,
//     not the 8 an earlier note claimed. What is still only RECORDED is the five
//     card ids themselves, which live at 0x800A5C20 — past the end of the
//     disassembly — though they are corroborated as one Digimon per colour at a
//     regular stride of 43.

import { startProgram, stepVm, resolveVmChoice } from "./card-effect-vm.ts";
import type { EffectVm, VmChoice } from "./card-effect-vm.ts";
import {
  issueCeremony, latch, latchDynamic, PHASE_CEREMONY, BANNER_OPCODE, beatFrames,
  beatIsInputGated,
  beatWaitsForButton,
} from "./card-ceremony.ts";
import type { CeremonyBeat } from "./card-ceremony.ts";

export type CardColour = "white" | "blue" | "green" | "red" | "black" | "brown";
export type CardStage = "in-training" | "rookie" | "champion" | "ultimate" | "mega";

export interface CardRecord {
  id: number;
  name: string;
  colour: CardColour;
  kind: "digimon" | "program";
  ap: number;
  hp: number;
  stage?: CardStage;
  /** CARDPAK +0x05: S-Energy paid to summon. */
  summonCost?: number;
  summonTier?: number;
  /** CARDPAK +0x08: the card's strength rank, ascending FROM THE STRONGEST.
   *  Older catalog builds spell it unk8. */
  strengthRank?: number;
  unk8?: number;
  /** CARDPAK +0x0a: the card this one combos into, 0 when it cannot combo. */
  comboInto?: number;
  unkA?: number;
  programCategory?: number;
  cost?: number;
  effect?: string;
}

export interface CardCatalog {
  counts: { total: number; digimon: number; program: number };
  cards: CardRecord[];
}

// ---------------------------------------------------------------------------
// Constants, each from the struct or table cited in the module note
// ---------------------------------------------------------------------------

/** Folder size: the deck array at +0x5b0 runs to the hand array at +0x600.
 *  The folder editor agrees — every loop over a saved folder's slots runs 0x28
 *  times, and its grid clamps to four rows of nine plus a last row of four.
 *  — docs/research/ui/card-folder-editor-2026-08-14.md §1, §3 */
export const FOLDER_SIZE = 40;

/** How many folders the save holds: three records of 0x66 bytes at 0x8004935c,
 *  and the folder list's cursor clamps to 0..2. */
export const FOLDER_COUNT = 3;

/** How many characters a folder name holds: the name screen pads the record's
 *  name field to 0xa characters with the blank character 0x4081. */
export const FOLDER_NAME_LEN = 10;

/** **Four copies of one card per folder.** F0x80085210 refuses the placement
 *  when `owned - still-available >= 4` — that difference is how many copies are
 *  already in this folder — and puts up the card-shop bank's string 0x1e,
 *  "Only four of the same card\nin one folder."
 *  — docs/research/ui/card-folder-editor-2026-08-14.md §4 */
export const MAX_COPIES_PER_FOLDER = 4;

/** The six colour counters the folder list shows per folder, in the catalog's
 *  colour-byte order 1..6 (F0x8008924c indexes `counter[record byte 0 - 1]`). */
export const FOLDER_COLOURS = ["white", "blue", "green", "red", "black", "brown"] as const;
/** Hand limit: the hand array at +0x600 runs to the trash array at +0x614. */
export const HAND_LIMIT = 10;
/** Trash capacity: +0x614 runs to the next player block at +0x664. */
export const TRASH_LIMIT = 40;
/** Six field slots per side (F0x8008def8 / F0x8008e08c, twelve slots split at 6). */
export const FIELD_LIMIT = 6;
/** Cards drawn per set. escardgm.toml: "6 cards will be drawn." */
export const DRAW_COUNT = 6;
/** F0x800a0f94 case 0x11 ends the duel at two sets. */
export const SETS_TO_WIN = 2;
/** AP, HP and S-Energy all clamp at 99 (`slti/sltiu ..., 0x63`). */
export const STAT_CAP = 99;
/** F0x800a0cd4: a run must reach three identical cards. */
export const COMBO_MIN = 3;
/** F0x800a3934 adds 0x14 to both AP and HP once a run reaches four. */
export const COMBO_FOUR_BONUS = 0x14;

/** The five S-Energy colours, in the catalog's colour-byte order 1..5. Brown
 *  is colour 6 and has no energy slot. */
export const ENERGY_COLOURS = ["white", "blue", "green", "red", "black"] as const;
export type EnergyColour = (typeof ENERGY_COLOURS)[number];

/** Catalog ids 315 and 316 sit past the 314 the folder grid accepts
 *  (claim cardgame-catalog-valid-id-range-1-314) and are the Start Phase's two
 *  face-down cards: escardgm.toml "Draw Calumon to go first." */
export const CALUMON_CARD_ID = 315;
export const IMPMON_CARD_ID = 316;

/** F0x8009403c looks for an instance of the combo target in the duel to show
 *  its artwork; when there is none it overwrites duel+0x438 with card id
 *  0x13b and shows that instead.
 *  — cardgame-combo-target-is-resolved-to-a-real-card-and-displayed */
export const COMBO_SUBSTITUTE_CARD_ID = 0x13b;

/** The six phases, in the order the table at 0x800a5d5c produces. `banner` is
 *  the escardgm.toml string the mode-0xa step shows before the phase runs. */
export const DUEL_PHASES = [
  { mode: 3, key: "start", banner: "Start Phase", prompt: "Draw Calumon to go first." },
  { mode: 4, key: "draw", banner: "Draw Phase", prompt: "6 cards will be drawn." },
  { mode: 5, key: "load", banner: "Load Phase", prompt: "Select and use a Program Card." },
  { mode: 6, key: "summon", banner: "Summon Phase", prompt: "Select your Digimon" },
  { mode: 7, key: "compile", banner: "Compile Phase", prompt: "Select and use a Program Card." },
  { mode: 8, key: "battle", banner: "Battle Phase", prompt: "Start Battle!" },
] as const;

export type DuelPhaseKey = (typeof DUEL_PHASES)[number]["key"];

/** The resident table at `0x8004DFCC`, read by `F0x8001EBCC` and indexed by the
 *  card record's type byte `+0x03`. That byte is `0x10` on all 256 Digimon
 *  cards and 1..14 on the 60 Program cards, so entries 0 and 15 are unused by
 *  any shipped card and every shipped value is covered.
 *  — UI-CARDALBUM-CLASS-PLATE-IS-THE-RECORD-TYPE-2026-08-14 */
export const CARD_TYPE_PLAY_CLASS = [
  0, 1, 1, 1, 2, 1, 1, 2, 2, 1, 1, 2, 1, 1, 2, 0, 0,
] as const;
/** The type byte every Digimon card carries. */
export const DIGIMON_CARD_TYPE = 0x10;

export function cardPlayClass(card: CardRecord | undefined): number {
  if (!card) return 0;
  const type = card.kind === "digimon" ? DIGIMON_CARD_TYPE : (card.programCategory ?? 0);
  return CARD_TYPE_PLAY_CLASS[type] ?? 0;
}

/**
 * May this card be picked out of the hand in the phase the duel is in?
 *
 * This is the disc's own selectable-hand rule, `F0x80085FD0` calling
 * `F0x80085F38`, and it is a SEPARATE question from whether an effect has a
 * legal target (`canPlayProgram`). Both must hold.
 *
 *   - Summon Phase: Digimon cards only. (The disc also tests affordability
 *     here, which is `canSummon`.)
 *   - Compile Phase: any Program card.
 *   - Load Phase: only the Program cards whose play class is 2 — categories
 *     4, 7, 8, 11 and 14, which is 28 of the 60 Program cards.
 *   - Every other phase: nothing.
 *
 * — UI-CARDGAME-PROGRAM-PLAY-PHASE-IS-THE-TYPE-CLASS-2026-08-14
 */
export function handCardSelectable(duel: DuelState, card: CardRecord | undefined): boolean {
  if (!card) return false;
  const mode = phase(duel).mode;
  if (mode === 6) return card.kind === "digimon";
  if (card.kind === "digimon") return false;
  const cls = cardPlayClass(card);
  if (cls === 0) return false;
  if (mode === 7) return true;
  return mode === 5 && cls === 2;
}

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

export function indexCatalog(catalog: CardCatalog): Map<number, CardRecord> {
  const byId = new Map<number, CardRecord>();
  for (const c of catalog.cards) byId.set(c.id, c);
  return byId;
}

export function cardsOfColour(catalog: CardCatalog, colour: CardColour): CardRecord[] {
  return catalog.cards.filter((c) => c.colour === colour);
}

/** CARDPAK +0x05. Older catalog builds spell it summonTier. */
export function summonCost(rec: CardRecord | undefined): number {
  if (!rec || rec.kind !== "digimon") return 0;
  return rec.summonCost ?? rec.summonTier ?? 0;
}

/** CARDPAK +0x0a, 0 when the card cannot combo. Older builds spell it unkA. */
export function comboInto(rec: CardRecord | undefined): number {
  return rec?.comboInto ?? rec?.unkA ?? 0;
}

/** CARDPAK +0x08. 315 distinct values, ascending from the STRONGEST card, so
 *  the AI's minimum is its best play. Older builds spell it unk8; an unranked
 *  card sorts last.
 *  — cardgame-cardpak-0x08-is-a-card-strength-rank-and-the-ai-plays-its-best */
export function strengthRank(rec: CardRecord | undefined): number {
  return rec?.strengthRank ?? rec?.unk8 ?? Number.MAX_SAFE_INTEGER;
}

/** Whether a colour has an S-Energy slot at all. Brown does not. */
export function energyIndex(colour: CardColour): number {
  return (ENERGY_COLOURS as readonly string[]).indexOf(colour);
}

// ---------------------------------------------------------------------------
// Collection and folders
// ---------------------------------------------------------------------------

/** The deck editor imposes no per-card ceiling at all — it simply offers what
 *  you own. The ceiling lives upstream in the collection: the add routine
 *  clamps the owned count at nine (the shop refuses a tenth purchase with its
 *  own message 0x14), so a legal 40-card folder may hold up to nine of one
 *  card.
 *  — cardgame-collection-cap-is-nine-copies-per-card,
 *    cardgame-folder-copy-limit-is-the-owned-count-not-four */
export const COLLECTION_CAP = 9;

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

// ---------------------------------------------------------------------------
// Duel state
// ---------------------------------------------------------------------------

/** One of the six 0xe-byte field slots: the card, and its live AP/HP after
 *  every buff, debuff and point of battle damage.
 *
 *  Nothing is ever subtracted instantly. A stat change is QUEUED as a target
 *  (F0x8008def8) and the ticker F0x8008e08c moves the true value by exactly ±1
 *  per frame toward it; the on-screen figure runs a SECOND ramp trailing the
 *  true one, so a card dies on the frame its true health reaches zero while the
 *  displayed number is still catching up.
 *  — cardgame-damage-is-never-instant-it-ramps-and-death-fires-at-zero */
export interface FieldSlot {
  id: number;
  /** `+0x2` — the TRUE AP. F0x8008DEF8 adds the effect's delta straight into
   *  this; there is no ramp on it. The totals are summed from here. */
  ap: number;
  /** `+0x4` — the TRUE HP, written the same way. */
  hp: number;
  /** `+0x6` — the DISPLAYED AP, stepped one point per frame by F0x8008E08C. */
  shownAp: number;
  /** `+0x8` — the DISPLAYED HP. **This, not `hp`, is what kills the slot**:
   *  the tail of F0x8008E08C marks a slot for removal when `lh +0x8 <= 0`. */
  shownHp: number;
  /** `+0xC` — the card's INSTANCE, i.e. a serial unique to this placement.
   *
   *  `F0x80091858` (`placeCardOnField`) writes it: it reads a running counter
   *  at `duel+0x308`, increments it, and stores the old value at slot record
   *  `+0xC` (`lbu $v1, 0x308($s6)` / `addiu $v0, $v1, 1` / `sb $v0, 0x308($s6)`
   *  / `sb $v1, 0xe($s0)`, where `$s0 = duel + 0x72C + slot*0xE`, so `+0xE`
   *  from the count base is `+0xC` from the slot record at `+0x72E`/`+0x7A0`).
   *  `F0x8008E5BC` copies the whole 0xE-byte record with `lh 0x73a`/`sh 0x73a`,
   *  so the instance travels with the slot.
   *
   *  This, NOT `id`, is what the legality gate's arm 9 compares against the
   *  play's named target (`history+0x586`): `F0x800840F0` marks the one slot
   *  whose `+0xC` equals `+0x586`, and `F0x800A3E9C` writes `+0x586` from that
   *  same `+0xC` (`lbu 0x73a`). Two copies of one Digimon id in different slots
   *  get two different instances, which is the whole point.
   *  — CARD-DUEL-VERIFIED.md §33; F0x800954f8.c:159-187,288-306 */
  instance: number;
}

/** The disc's per-placement serial source is a duel counter at `duel+0x308`
 *  (see `FieldSlot.instance`). The port has no single duel here, and every
 *  `fieldSlot` is a placement, so one monotonic source gives what the disc's
 *  counter gives: a value no other live slot shares. Absolute values are not
 *  meaningful; only equality within a board is. */
let nextFieldInstance = 1;

/** A field slot at rest: both ramps already where the true values are. Use
 *  this rather than a bare object literal, so the targets are never undefined
 *  under the ticker. The placement instance is assigned here. */
export function fieldSlot(id: number, ap: number, hp: number): FieldSlot {
  return { id, ap, hp, shownAp: ap, shownHp: hp, instance: nextFieldInstance++ };
}

export type EnergyPool = Record<EnergyColour, number>;

export interface DuelSide {
  name: string;
  deck: number[];
  hand: number[];
  /** CARD_NPC deck-entry byte +0x03, the AI play class, indexed by the entry's
   *  slot in the authored 40-card deck. The class is authored PER SLOT, not per
   *  card — 175 card ids carry more than one class inside a single shipped deck
   *  — so it travels with the entry, not the id. Empty for a player folder,
   *  which has no classes at all.
   *  — cardnpc-deck-entry-byte-03-is-the-ai-play-class-with-5-never-summoned */
  deckClass: number[];
  /** CARD_NPC deck-entry availability group, indexed the same way. An entry is
   *  usable only once the set index reaches its group's window. */
  deckGroup: number[];
  /** Every authored card id by slot, including entries not yet available. */
  deckAuthored: number[];
  /** The set index this side's deck has been opened up to, so widening it is
   *  idempotent. */
  openedToSet: number;
  /** The authored deck-entry slot of each card in `deck`, parallel to it. */
  deckSlots: number[];
  /** CARD_NPC `+0xA0` — the AI response list, resolved to card ids. The play
   *  scan F0x800A4978 checks the card the other side just played against this
   *  list to decide whether to answer with a class-4 card. */
  aiResponses: number[];
  /** The same for `hand`. -1 for a card that reached the hand from the field or
   *  the trash rather than by being drawn, which has no authored entry. */
  handSlots: number[];
  field: FieldSlot[];
  trash: number[];
  /** +0x5a8..+0x5ac, one byte per energy colour, carried between sets. */
  energy: EnergyPool;
  /** +0x5ae, sets won this duel. */
  score: number;
  /** the side's total AP and HP on the field (+0x59c / +0x59e) */
  totalAp: number;
  totalHp: number;
}

export interface ComboRun {
  /** the card id that repeated */
  id: number;
  /** how many copies were on the field */
  count: number;
  /** the CARDPAK +0x0a Digimon the run combines into. A DISPLAY identity: the
   *  run keeps its own stats and is merely scored twice. */
  into: number;
  /** the card id whose artwork the duel screen shows for this run: `into` when
   *  an instance of it exists in the duel, else COMBO_SUBSTITUTE_CARD_ID. */
  displayId: number;
  /** true when `displayId` is the substitute rather than the real target */
  substituted: boolean;
  ap: number;
  hp: number;
}

export interface DuelState {
  byId: Map<number, CardRecord>;
  player: DuelSide;
  opponent: DuelSide;
  phaseIndex: number;
  /** which set of the best-of-three is being played (1-based) */
  set: number;
  /** 0 = the player acts first this set (Calumon), 1 = the opponent does */
  firstPlayer: 0 | 1;
  /** The most recent coin-toss result, `duel+0x440` — Calumon or Impmon. Null
   *  until the first draw.
   *
   *  The ceremony is mode 3, which the mode table re-enters after both the
   *  Battle Phase and the set change, so it is drawn again at the start of
   *  EVERY set. Within a set it is stable: mode 3 derives the seed
   *  `duel+0x2F5` once, and the play machine's reset copies that seed into BOTH
   *  turn-order registers (+0x578 and +0x579) at the start of Load and again at
   *  the start of Compile, so the same side leads both phases of that set and
   *  state 0xE's turn flipping never carries between them.
   *  `cardduel-turn-order-is-seeded-by-the-coin-toss-2026-08-21` and
   *  `cardgame-the-coin-toss-is-mode-3-and-re-runs-every-set-2026-08-24`. */
  coinToss: 0 | 1 | null;
  /** the last set's combo runs, per side, for the UI to announce */
  combos: { player: ComboRun[]; opponent: ComboRun[] };
  /** The numbers the attack drain needs, published when beat 0x15 or 0x16 is
   *  issued and left standing afterwards. The screen cannot derive these once
   *  the damage has landed, because the subtraction clamps at zero and the
   *  pre-drain HP is then unrecoverable. `side` is the ATTACKER, matching the
   *  argument F0x80084320 passes the enter: 0 on 0x15, 1 on 0x16. */
  drain: null | { side: 0 | 1; ap: number; hpBefore: number; cards: number };
  /** null until the whole duel is decided */
  outcome: null | "win" | "loss" | "draw";
  log: string[];
  /** cards played this phase, newest last — F0x800a36e4's kinds 0x83/0x84 */
  playedThisPhase: number[];
  /** Set while an effect is waiting for a hand card to be chosen.
   *
   *  Trade Charge's program runs the own-deck picker (`0x32`) and THEN the
   *  own-hand picker (`0x37`), in that order, so the card is taken out of the
   *  deck first and the player then chooses which hand card to throw away —
   *  over a hand that already contains the new card. Nothing may resolve that
   *  choice automatically; the effect parks here until a slot is supplied.
   *  `duel+0x46F` is the original's own selection-flag array for exactly this. */
  pendingHandDiscard: null | { side: DuelSide };
  /** Battle-Phase card reveals queued by effect opcode 0x2A. The Battle Phase
   *  issues opcode 0x1B once per queued beat, and that beat's update phase
   *  exchanges the two sides' totals — which is how Fortune Gate works, since
   *  nothing in its own two-opcode program touches a stat. */
  revealBeats: number;
  /** `duel+0x301` — which side took the set, once Battle-Phase state 0xA has
   *  decided it, and null before that. The counter itself moves one step later,
   *  in state 0xB's counter roll, so the two are separate fields here too. */
  setAward: 0 | 1 | null;
  /** True when the set ended on an EQUAL total, which the disc reads as a draw
   *  and states in words: state 0xB compares the two totals again with `beq`
   *  and opens window 0x12 — escardgm "It's a draw so you, the challenger,
   *  lose." — instead of 0x11 (`cardgame.s:31245-31261`). It still awards the
   *  set to side 1, because state 0xA's `slt` is false on a tie. */
  setDraw: boolean;
  /** True once state 0xB has written the winner's counter, so a second call
   *  cannot move it twice. The disc cannot reach state 0xB twice for one set;
   *  this model can be asked to settle the same set from two places. */
  setCounted: boolean;
  /** The Program Phase run a turn at a time, so a human can be one of the
   *  sides. Null when nothing is driving it that way and the phase runs whole. */
  programTurns: ProgramTurns | null;
  /** null unless someone is playing the Summon Phase a turn at a time */
  summonTurns: SummonTurns | null;
  /** The Program-card interpreter, while a card's program is running. It stays
   *  here between calls because a program stops to let the player choose a
   *  card — see `card-effect-vm.ts`. */
  effectVm: EffectVm | null;
  /** `duel+0x4dd` — the cancel flag. The effect driver clears it before each
   *  card's program and, when the program has set it, drops TWO plays off the
   *  turn's resolve queue instead of one: the card that cancelled and the card
   *  it cancelled, whose own program never runs. Its only writer in the overlay
   *  is the update phase of effect opcode 0x41. */
  cancelPrevious: boolean;
  /** The ceremony opcodes this duel has issued, in order — the disc's own
   *  `duel+0x421` stream. See `card-ceremony.ts` for what is driven and what is
   *  recorded but performed inline. */
  ceremony: CeremonyBeat[];
  /** Which (set, phase) the ceremony was last issued for, so a phase driven a
   *  turn at a time announces itself once rather than on every re-entry. */
  ceremonyToken: number;
  /** Which phase a dynamically-latched beat (`0x70`) belongs to. */
  ceremonyPhaseKey: DuelPhaseKey;
  /** The frame-granular beat queue used by `tickDuel`. Untouched by
   *  `stepPhase`, which drains a whole phase at once. */
  beat: DuelBeatQueue;
  /** Which side, if any, a SCREEN is driving rather than an agent.
   *
   *  The disc has no equivalent field: its play machine simply polls the pad on
   *  side 0's turns and reads CARD_NPC on side 1's. The walker needs the
   *  distinction stated because the same ceremony opcodes serve both a headless
   *  duel — where every choice is an agent call and the phase runs to
   *  completion inside one beat — and a played one, where the beat has to stop
   *  and wait for a button. `null` is headless, which is what every existing
   *  caller gets.
   *
   *  WALKER FIELD. It changes which of two behaviours a beat takes, not what
   *  either behaviour is. */
  human: 0 | 1 | null;
}

/** One beat owns the frame at a time. See `tickDuel`. */
export interface DuelBeatQueue {
  /** beats queued for this phase, not yet started */
  pending: number[];
  /** Beats a CARD PROGRAM performed, queued for the screen alone.
   *
   *  On the disc a card program is not run inline: each of its opcodes is
   *  latched into `duel+0x421` in turn and owns the frame while it plays out,
   *  which is why the captured duel issues 38 distinct opcodes where ours
   *  issued 19. Our interpreter still runs a whole program in one go — the
   *  rules are already right — so replaying its opcodes here would apply every
   *  effect a second time. These beats therefore hold the frame and reach the
   *  screen, and `applyCeremonyOp` is deliberately NOT called for them.
   *
   *  `replay` drains ahead of `pending`, so a program's own steps play out
   *  before the phase moves on. */
  replay: number[];
  /** the beat that owns the frame, or null between beats */
  current: number | null;
  /** frames left on `current` */
  hold: number;
  /** `current` is waiting on the player rather than on its timer */
  gated: boolean;
  /** How many beats have taken the frame, ever.
   *
   *  THE OPCODE IS NOT AN IDENTITY. Since the Battle Phase started issuing one
   *  beat per combo run and one per card reveal, two beats with the SAME opcode
   *  run back to back -- and a screen that reacts to `current` changing sees one
   *  where there are two. This counts them, so a consumer can tell them apart.
   *  Found by tools/verify_cardduel_reveal.mjs on 2026-08-28, where the second
   *  reveal never reached the screen and the duel stopped dead. */
  serial: number;
  /** which phase the queue was filled for */
  phaseKey: DuelPhaseKey | null;
  battle: BattleWalk | null;
  summonOrder: DuelSide[] | null;
  began: boolean;
  resumed: boolean;
}

function emptyEnergy(): EnergyPool {
  return { white: 0, blue: 0, green: 0, red: 0, black: 0 };
}

/** Entries usable in set `setIndex`: F0x8009d9e4 recomputes the availability
 *  count duel+0x41b from 2 * duel+0x300 + 2, so each set widens the window by
 *  two groups. The shipped data is authored to it — the smallest set-0 pool of
 *  any of the 170 opponents is exactly six cards, one hand.
 *  — cardgame-mode-9-is-the-set-transition-reset */
export const setWindowThreshold = (setIndex: number): number => 2 * setIndex + 2;

function side(name: string, deck: number[], deckClass: number[] = [], deckGroup: number[] = [],
              aiResponses: number[] = []): DuelSide {
  const inWindow = (i: number) =>
    deckGroup.length === 0 || (deckGroup[i] ?? 0) <= setWindowThreshold(0);
  const open = deck.map((_, i) => i).filter(inWindow);
  return {
    name,
    deck: open.map((i) => deck[i]!),
    hand: [],
    deckClass: deckClass.slice(),
    deckGroup: deckGroup.slice(),
    aiResponses: aiResponses.slice(),
    deckAuthored: deck.slice(),
    openedToSet: 0,
    deckSlots: open,
    handSlots: [],
    field: [],
    trash: [],
    energy: emptyEnergy(),
    score: 0,
    totalAp: 0,
    totalHp: 0,
  };
}

export interface DuelDeckMeta {
  /** AI play class per deck entry, parallel to the deck passed in. */
  player?: number[];
  opponent?: number[];
  /** Availability group per deck entry, same indexing. */
  playerGroup?: number[];
  opponentGroup?: number[];
  /** CARD_NPC +0xA0, the AI response list resolved to card ids. */
  opponentResponses?: number[];
}
/** @deprecated the old name for DuelDeckMeta. */
export type DuelDeckClasses = DuelDeckMeta;

export function createDuel(
  catalog: CardCatalog,
  playerDeck: number[],
  opponentDeck: number[],
  playerName = "You",
  opponentName = "Opponent",
  meta: DuelDeckMeta = {},
): DuelState {
  return {
    byId: indexCatalog(catalog),
    player: side(playerName, playerDeck, meta.player, meta.playerGroup),
    opponent: side(opponentName, opponentDeck, meta.opponent, meta.opponentGroup,
                   meta.opponentResponses),
    phaseIndex: 0,
    set: 1,
    firstPlayer: 0,
    coinToss: null,
    combos: { player: [], opponent: [] },
    drain: null,
    outcome: null,
    log: [],
    playedThisPhase: [],
    pendingHandDiscard: null,
    revealBeats: 0,
    setAward: null,
    setDraw: false,
    setCounted: false,
    cancelPrevious: false,
    programTurns: null,
    summonTurns: null,
    effectVm: null,
    ceremony: [],
    ceremonyToken: -1,
    ceremonyPhaseKey: "start",
    human: null,
    beat: {
      pending: [], replay: [], current: null, hold: 0, gated: false, serial: 0, phaseKey: null,
      battle: null, summonOrder: null, began: false, resumed: false,
    },
  };
}

/** Fisher-Yates against a caller-supplied RNG so tests are deterministic. */
/** Passes the disc's shuffle makes, from `slti $v0, $s1, 0x28` in F0x8009F04C.
 *  FORTY, fixed — it does not depend on how many cards are in the pile. */
export const SHUFFLE_PASSES = 40;

/** 0x8009F04C, the duel object's `+0x810` method (installed by F0x800A3240).
 *
 *  THIS IS NOT FISHER-YATES, and it is deliberately not being "fixed".
 *  `docs/research/ui/symbols/cardgame.md:30` names it `shufflePileFisherYates`;
 *  that name is wrong. The original makes forty blind two-index swaps:
 *
 *      if (count < 2) return;                    // before drawing any rng
 *      for (i = 0; i < 40; i++) {
 *          r1 = rng() % count;
 *          r2 = rng() % count;
 *          swap(pile[r1], pile[r2]);             // r1 == r2 is legal, and wasted
 *      }
 *
 *  Eighty RNG calls per shuffle, whatever the pile size. The consequence is a
 *  markedly non-uniform result on a large pile — measured over 20,000 trials, a
 *  40-card pile leaves ~6.0 cards in their original position against 1.0 for
 *  Fisher-Yates, and which card ends up on top is far from uniform. That is the
 *  disc's behaviour and the walker reproduces it, because a player who knows
 *  the game should meet the game's own deck order.
 *
 *  ONE DEVIATION, forced by the interface: the original takes a raw integer from
 *  the resident RNG at 0x8004DC0C and reduces it with `%`, while `rng` here
 *  yields a unit float, so the index is `floor(rng() * count)`. The two agree
 *  when the underlying generator is uniform. The original's `div` is also
 *  SIGNED, so a negative draw would index before the pile — not reproduced,
 *  because `rng` cannot return a negative, and it was never established that
 *  the resident RNG can either.
 *
 *  Decoded 2026-08-26; see docs/research/card/cardduel-animation-atlas-2026-08-26.md. */
export function shuffle<T>(items: T[], rng: () => number): T[] {
  const a = items.slice();
  const count = a.length;
  if (count < 2) return a;
  for (let pass = 0; pass < SHUFFLE_PASSES; pass++) {
    const r1 = Math.floor(rng() * count);
    const r2 = Math.floor(rng() * count);
    const t = a[r1]!;
    a[r1] = a[r2]!;
    a[r2] = t;
  }
  return a;
}

export function phase(duel: DuelState): (typeof DUEL_PHASES)[number] {
  return DUEL_PHASES[duel.phaseIndex % DUEL_PHASES.length]!;
}

export function opposing(duel: DuelState, s: DuelSide): DuelSide {
  return s === duel.player ? duel.opponent : duel.player;
}

const clampStat = (v: number) => Math.max(0, Math.min(STAT_CAP, Math.round(v)));

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

// Zone moves go through these so `deck`/`deckSlots` and `hand`/`handSlots`
// cannot drift apart. A card with no authored deck entry carries slot -1.

/** Put a card in hand if there is room, else straight to the trash. */
export function toHand(s: DuelSide, id: number, slot = -1): void {
  if (s.hand.length < HAND_LIMIT) {
    s.hand.push(id);
    s.handSlots.push(slot);
  } else {
    s.trash.push(id);
  }
}

/** Take a card out of the hand, returning its id and its deck-entry slot. */
export function takeFromHand(s: DuelSide, i: number): { id: number; slot: number } | null {
  if (i < 0 || i >= s.hand.length) return null;
  const id = s.hand.splice(i, 1)[0]!;
  const slot = s.handSlots.splice(i, 1)[0] ?? -1;
  return { id, slot };
}

/** Take the top card off the deck. */
export function takeFromDeck(s: DuelSide, i = 0): { id: number; slot: number } | null {
  if (i < 0 || i >= s.deck.length) return null;
  const id = s.deck.splice(i, 1)[0]!;
  const slot = s.deckSlots.splice(i, 1)[0] ?? -1;
  return { id, slot };
}

export function toDeck(s: DuelSide, id: number, slot = -1): void {
  s.deck.push(id);
  s.deckSlots.push(slot);
}

/** Shuffle the deck and its slot table with one permutation. */
export function shuffleDeck(s: DuelSide, rng: () => number): void {
  const order = shuffle(s.deck.map((_, i) => i), rng);
  s.deck = order.map((i) => s.deck[i]!);
  s.deckSlots = order.map((i) => s.deckSlots[i] ?? -1);
}

/** Which piles the disc ever shuffles: **the player's, and only the player's.**
 *
 *  The shared system here is one routine — duel method `+0x810`, `F0x8009F04C` —
 *  and it is reached four times: the duel initialiser
 *  (`cardgame.s:29435`, base 0 count 40), the turn loop
 *  (`cardgame.s:9780`), the round-end set reset (`cardgame.s:31616`) and a pile
 *  rebuild (`cardgame.s:14129`). `F0x8009F04C` builds its own array base as
 *  `addiu $s3, $a0, 0x59c` (`cardgame.s:28916`) with no argument to steer it, so
 *  whichever range a caller hands it, the forty blind two-index swaps always land
 *  on the SIDE-0 block — the player's — at `duel+0x5B0`.
 *
 *  The opponent's forty-card array at `duel+0x678` therefore has no shuffle at
 *  all. It is filled with 40..79 in slot order and left that way; the opponent's
 *  order comes from the tier retirement in `F0x8009DA68`, not from the random
 *  source. This agrees with the verified claim that the set change shuffles only
 *  the player's pile (`cardduel-set-change-shuffles-only-the-player-pile-2026-08-21`)
 *  and extends it to the whole duel, because the routine that does the shuffling
 *  cannot address the other pile.
 *
 *  Decoded 2026-10-05 from `~/ddw3/asm/dw2003/pro/cardgame.s`
 *  `:28910-28958`; see CARD-DUEL-VERIFIED.md §33. */
export const SHUFFLED_PILES = ["player"] as const;

/** Shuffle exactly the piles `SHUFFLED_PILES` names. This is the ONE place a
 *  duel shuffles: the Start phase and the set reset both call it, so neither can
 *  grow its own idea of which piles the disc mixes. */
export function shuffleDuelPiles(duel: DuelState, rng: () => number): void {
  for (const which of SHUFFLED_PILES) {
    shuffleDeck(which === "player" ? duel.player : duel.opponent, rng);
  }
}

/** The AI play class of the card in hand slot `i`, or 0 when this side's deck
 *  carried no class table. */
export function handClass(s: DuelSide, i: number): number {
  const slot = s.handSlots[i] ?? -1;
  return slot < 0 ? 0 : (s.deckClass[slot] ?? 0);
}

/** Draw one card. Drawing a card of an energy colour grants one point of that
 *  colour, capped at 99 — cardgame.s L13937 and L14520 both read the drawn
 *  card's colour byte, bound it with `sltiu ..., 0x6`, and bump
 *  `+0x5a8 + colour - 1` when it is below 0x63. Returns false when the deck is
 *  empty, which is the set-losing condition. */
export function drawOne(duel: DuelState, s: DuelSide): boolean {
  const drawn = takeFromDeck(s);
  if (!drawn) return false;
  const { id } = drawn;
  toHand(s, id, drawn.slot);
  const rec = duel.byId.get(id);
  const ei = rec ? energyIndex(rec.colour) : -1;
  if (ei >= 0) {
    const c = ENERGY_COLOURS[ei]!;
    s.energy[c] = Math.min(STAT_CAP, s.energy[c] + 1);
  }
  return true;
}

export function trashFromHand(s: DuelSide, slot: number): number | null {
  const taken = takeFromHand(s, slot);
  if (!taken) return null;
  s.trash.push(taken.id);
  return taken.id;
}

/** Sum a side's live field into +0x59c / +0x59e (F0x800a0acc).
 *
 *  It sums the **DISPLAYED** pair, not the true one: the body is
 *  `+0x59C += slot->unk734` and `+0x59E += slot->unk736`, and with the field
 *  array at `+0x72E` those are `+0x6` and `+0x8` — `shownAp` and `shownHp`.
 *  The true pair is `+0x2`/`+0x4` and this function never touches it.
 *
 *  Same rule the reap already follows one function below, and the same rule
 *  `evaluateBoard` already followed: while a stat change is ramping, the side
 *  total lags with the display rather than jumping to the final value. A fresh
 *  slot is created settled (`fieldSlot` sets shown = true), so nothing that
 *  builds a board and totals it immediately is affected. */
export function recomputeTotals(s: DuelSide): void {
  s.totalAp = s.field.reduce((t, f) => t + f.shownAp, 0);
  s.totalHp = s.field.reduce((t, f) => t + f.shownHp, 0);
}

/** Drop every slot the removal pass marks. The tail of F0x8008E08C clears every
 *  slot's `+0x46F` flag and then re-sets it for each slot whose **DISPLAYED** HP
 *  is at or below zero — `lh 0x736`/`lh 0x7a8`, which is `+0x8`, NOT the true
 *  `+0x4`. A slot therefore outlives its true HP hitting zero until the display
 *  has caught up. */
function reapDead(s: DuelSide): void {
  const dead = s.field.filter((f) => f.shownHp <= 0);
  s.field = s.field.filter((f) => f.shownHp > 0);
  for (const f of dead) s.trash.push(f.id);
  recomputeTotals(s);
}

// ---------------------------------------------------------------------------
// Summoning
// ---------------------------------------------------------------------------

/** `F0x80085FD0` — whether one hand row opens LEGAL in the card browser.
 *
 *  `F0x80086D78` calls this per row as it opens: a legal row gets `+0x446 = 1`
 *  and `+0x49E = 0`, an illegal one `+0x49E = 1` — the grey-out flag. So this
 *  is the rule behind "illegal rows show greyed before you move", and it runs
 *  over all forty folder entries before a cursor exists (`+0x440 = -1`).
 *
 *  Two branches, on `duel+0x2F8`:
 *    * Summon Phase (mode 6) — the record's `+0x03` must be `0x10`, a Digimon,
 *      and then `energy[record+0x00 - 1] >= record+0x05`: the cost in the
 *      card's own colour. A non-Digimon is illegal outright.
 *    * any other mode — `F0x80085F38`, which is `handCardSelectable`.
 *
 *  It does NOT gate on the field being full. `canSummon` does, and the two are
 *  therefore different questions: a full field greys nothing, it changes the
 *  browser's title (escardgm 59) and refuses at the commit. Do not substitute
 *  one for the other. */
export function browserRowLegal(duel: DuelState, s: DuelSide, id: number): boolean {
  const rec = duel.byId.get(id);
  if (!rec) return false;
  if (phase(duel).mode !== 6) return handCardSelectable(duel, rec);
  if (rec.kind !== "digimon") return false;
  const ei = energyIndex(rec.colour);
  const cost = summonCost(rec);
  // Same brown-Digimon carve-out canSummon documents: no energy colour to pay
  // with, and every brown Digimon in the catalog carries cost 0.
  if (cost === 0 || ei < 0) return true;
  return s.energy[ENERGY_COLOURS[ei]!] >= cost;
}

export function canSummon(duel: DuelState, s: DuelSide, id: number): boolean {
  const rec = duel.byId.get(id);
  if (!rec || rec.kind !== "digimon") return false;
  if (s.field.length >= FIELD_LIMIT) return false;
  const ei = energyIndex(rec.colour);
  const cost = summonCost(rec);
  if (cost === 0) return true;
  // A brown Digimon has no energy colour to pay with; every brown Digimon in
  // the catalog carries cost 0, so a non-zero cost on a brown card would be a
  // data error rather than an unplayable card.
  if (ei < 0) return true;
  return s.energy[ENERGY_COLOURS[ei]!] >= cost;
}

/** Spend the summon cost — CARDPAK +0x05, of the card's own colour. Both the
 *  gate (F0x80085FD0) and the spend (F0x8008735C) are traced; see the module
 *  note. toggleSummonMark implements the paired refund when a mark is removed. */
function payEnergy(duel: DuelState, s: DuelSide, id: number): void {
  const rec = duel.byId.get(id);
  if (!rec) return;
  const ei = energyIndex(rec.colour);
  if (ei < 0) return;
  const c = ENERGY_COLOURS[ei]!;
  s.energy[c] = Math.max(0, s.energy[c] - summonCost(rec));
}

/** Put a card from the hand onto the field. Returns false when it is illegal. */
export function summonFromHand(duel: DuelState, s: DuelSide, slot: number): boolean {
  const id = s.hand[slot];
  if (id === undefined || !canSummon(duel, s, id)) return false;
  takeFromHand(s, slot);
  payEnergy(duel, s, id);
  putOnField(duel, s, id);
  return true;
}

/** Place a card on the field at its printed stats, ignoring cost — this is what
 *  a Program card's "bring X to the field" does. */
export function putOnField(duel: DuelState, s: DuelSide, id: number): boolean {
  if (s.field.length >= FIELD_LIMIT) return false;
  const rec = duel.byId.get(id);
  if (!rec || rec.kind !== "digimon") return false;
  s.field.push(fieldSlot(id, clampStat(rec.ap), clampStat(rec.hp)));
  recomputeTotals(s);
  return true;
}

// ---------------------------------------------------------------------------
// The five dynamic-stat Megas — F0x800A0844
// ---------------------------------------------------------------------------

/** The five cards whose AP and HP are RECOMPUTED every Summon Phase instead of
 *  being their printed stats. One per energy colour, in `ENERGY_COLOURS` order.
 *
 *  READ FROM THE TABLE 2026-08-25. `0x800A5C20` holds them as sequential u16 —
 *  68, 111, 154, 197, 240, then a zero terminator — and that is an exact match
 *  for the recorded list. An earlier note here called them "recorded rather
 *  than read" because the address looked to be past the end of the
 *  disassembly; it is not. `cardgame.s` runs to `0x800A5DDC`, and the data
 *  region simply renders as `.word 0xVALUE # nop`, which the reader that
 *  reported the gap was not matching.
 *
 *  Independently corroborated as well: all five are Digimon, exactly one per
 *  energy colour, at a regular stride of 43 in a colour-ordered catalog.
 *
 *  — white PrinceMamemon, blue Babamon, green MetalEtemon,
 *    red SkullMammothmon, black Piedmon. */
export const DYNAMIC_STAT_MEGAS: readonly number[] = Object.freeze([68, 111, 154, 197, 240]);

/**
 * Recompute the dynamic Megas' stats. `F0x800A09FC` runs `F0x800A0844` for
 * k = 0..4 over every field slot, and `F0x800A0844` returns immediately unless
 * the slot's card id equals entry k of the id table — so each of the five cards
 * has its OWN formula and no other card is touched.
 *
 * The five formulas were DERIVED FROM ASSEMBLY (the arms of `D0x80083960` at
 * `cardgame.fns.s` `.L0x0001DC48`, `.L0x0001DC64`, `.L0x0001DC7C`,
 * `.L0x0001DCA0`, `.L0x0001DCC4`), not taken on trust:
 *
 *   k=0  `lbu ($t3)` own field count; x5, <<2  -> base + 20 * ownField
 *   k=1  `lh 0xA($t2)` = +0x5A6 hand;  x5, <<1 -> base + 10 + 10 * ownHand
 *   k=2  `lh 0x6($t2)` = +0x5A2 trash; x5, <<2 -> base + 10 + 20 * ownTrash
 *   k=3  `lbu 0x72C` + `lbu 0x79E` both fields; x5, <<1 -> base + 10 * (f0+f1)
 *   k=4  `lh 0x5A2` + `lh 0x66A` both trashes; x5, <<1 -> base + 10 + 10 * (t0+t1)
 *
 * with `$t2 = duel + side*0xC8 + 0x59C` and `$t3 = duel + side*0x72 + 0x72C`.
 * The tail clamps both results with `slti 0x63` and `bgtz`, i.e. to [0, 99].
 *
 * `base` is the card's PRINTED stat, re-read from the catalog every pass, so
 * running this twice is the same as running it once — the disc recomputes from
 * the record rather than accumulating, and a phase loop must not compound.
 *
 * WALKER CHOICE, marked because the original differs in where it writes: the
 * disc reads `+0x2`/`+0x4` and writes `+0x6`/`+0x8`, snapping the display
 * rather than rolling it. The walker's stat tiers do not map cleanly onto that
 * pair (see CARD-DUEL-VERIFIED.md), so this SNAPS all of them together, which
 * keeps `recomputeTotals` and the display in agreement and preserves the one
 * behaviour that is certain: the recompute does not animate.
 */
export function applyDynamicStatMegas(duel: DuelState): void {
  const sides = [duel.player, duel.opponent];
  const fieldCount = sides.map((s) => s.field.length);
  const trashCount = sides.map((s) => s.trash.length);
  const bothFields = fieldCount[0]! + fieldCount[1]!;
  const bothTrashes = trashCount[0]! + trashCount[1]!;

  sides.forEach((side, i) => {
    let changed = false;
    for (const slot of side.field) {
      const k = DYNAMIC_STAT_MEGAS.indexOf(slot.id);
      if (k < 0) continue;
      const rec = duel.byId.get(slot.id);
      if (!rec) continue;
      const bump =
        k === 0 ? 20 * fieldCount[i]!
        : k === 1 ? 10 + 10 * side.hand.length
        : k === 2 ? 10 + 20 * trashCount[i]!
        : k === 3 ? 10 * bothFields
        : 10 + 10 * bothTrashes;
      const ap = clampStat(rec.ap + bump);
      const hp = clampStat(rec.hp + bump);
      slot.ap = ap;
      slot.hp = hp;
      // the disc SNAPS the display for this recompute rather than rolling it
      slot.shownAp = ap;
      slot.shownHp = hp;
      changed = true;
    }
    if (changed) recomputeTotals(side);
  });
}

// ---------------------------------------------------------------------------
// Combos
// ---------------------------------------------------------------------------

/** Whether any instance of a card id is anywhere in the duel — the scan
 *  F0x8009403c makes over the card-instance table before it puts the combo
 *  target's artwork on screen. */
export function cardIsInDuel(duel: DuelState, id: number): boolean {
  for (const s of [duel.player, duel.opponent]) {
    if (s.field.some((f) => f.id === id)) return true;
    if (s.hand.includes(id) || s.deck.includes(id) || s.trash.includes(id)) return true;
  }
  return false;
}

/** The runs F0x800a0cd4 finds: sort the field by card id, then take every run
 *  of three or more identical ids whose CARDPAK +0x0a combo target is non-zero. */
export function comboRuns(duel: DuelState, s: DuelSide): ComboRun[] {
  const sorted = s.field.slice().sort((a, b) => a.id - b.id);
  const runs: ComboRun[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j]!.id === sorted[i]!.id) j++;
    const count = j - i;
    const into = comboInto(duel.byId.get(sorted[i]!.id));
    if (count >= COMBO_MIN && into !== 0) {
      let ap = 0;
      let hp = 0;
      for (let k = i; k < j; k++) {
        // F0x8009403C sums `slot->unk734` / `unk736` — the DISPLAYED pair, as
        // the side totals and evaluateBoard do. A run scored mid-ramp is worth
        // what the screen shows, not what the stat is settling towards.
        ap += sorted[k]!.shownAp;
        hp += sorted[k]!.shownHp;
      }
      const present = cardIsInDuel(duel, into);
      runs.push({
        id: sorted[i]!.id,
        count,
        into,
        displayId: present ? into : COMBO_SUBSTITUTE_CARD_ID,
        substituted: !present,
        ap,
        hp,
      });
    }
    i = j;
  }
  return runs;
}

// ---- the combo-target picker (F0x8008AD98 / F0x8008C8D8) --------------------

/** Which of a side's field slots belong to a qualifying combo run.
 *
 *  This is the walker's `+0x446`: the detector F0x800A0CD4 clears the flag
 *  across the side's live slot count and then sets it on each slot index it
 *  collected for the run, so the array is per side and indexed by field slot.
 *  — cardgame-combo-target-is-resolved-to-a-real-card-and-displayed */
export function comboSlotFlags(duel: DuelState, s: DuelSide): boolean[] {
  const flags = s.field.map(() => false);
  for (const run of comboRuns(duel, s)) {
    s.field.forEach((slot, i) => { if (slot.id === run.id) flags[i] = true; });
  }
  return flags;
}

/** The picker dims every slot that is not part of a run.
 *
 *  F0x8008AD98 case 1 walks twelve view sprites and writes the dim byte as the
 *  inverse of the slot's `+0x446`: flagged slots are lit, everything else is
 *  dimmed. It does this through one of two fields — `+0x49E` when a combo
 *  target id is already resolved into `+0x438`, `+0x151` on the view record
 *  otherwise — but the rule written is identical in both branches, so the
 *  walker keeps one. */
export function comboPickerDimmed(duel: DuelState, s: DuelSide): boolean[] {
  return comboSlotFlags(duel, s).map((lit) => !lit);
}

/** Where the picker's cursor opens, per F0x8008C8D8.
 *
 *  Two passes. First scan FORWARD from `start` up to `available` (the per-set
 *  availability count at duel+0x41B) and stop on the first flagged entry. Only
 *  if that finds nothing scan BACKWARD from 0x27, and — reading the branch at
 *  .L0x00009ca8, which is `bnez` — skip entries that are NOT flagged, stopping
 *  on the first flagged one, or on `start` if the scan runs out. Either way the
 *  landing entry gets the legal-target flag +0x46F.
 *
 *  NOTE the recorded claim describes the backward pass as looking for an entry
 *  WITHOUT the flag. The assembly is the other way round; see
 *  cardgame-8008c8d8-backward-pass-seeks-a-flagged-entry.
 *
 *  The forward pass reads the flag at `+0x446 + (i - start)` while writing the
 *  cursor as the absolute `i` — the index is relative to where the scan began,
 *  not to the array. That is reproduced here rather than silently corrected; it
 *  is invisible whenever the scan starts at 0, which is the normal case. */
export const COMBO_CURSOR_LAST = 0x27;

export function defaultComboCursor(
  flags: readonly boolean[], start = 0, available = flags.length,
): number {
  for (let i = start; i < available; i++) {
    if (flags[i - start]) return i;
  }
  let j = COMBO_CURSOR_LAST;
  if (start < COMBO_CURSOR_LAST) {
    while (j > start && !flags[j - start]) j--;
  }
  return j;
}

/** What a side's combos are worth.
 *
 *  A combo does NOT replace the run with the CARDPAK +0x0a Digimon: all three
 *  writers of the per-slot stat fields were enumerated and none consults the
 *  combo-run flag +0x446, so no code path rewrites a slot from the target
 *  card. The +0x0a card is a display identity (see ComboRun.displayId).
 *
 *  What the combo does is score the run twice. Opcodes 0x19/0x1a
 *  (F0x8009403c) sum the true AP and HP of every flagged slot into
 *  duel+0x42c/+0x430, each capped at 99, and add a further 0x14 to both once
 *  four or more slots are flagged — capped again.
 *
 *  IT IS PER RUN, NOT PER SIDE — corrected 2026-08-25, and it changes numbers.
 *  This function used to pool every run of a side, cap the pool once and test
 *  the pooled count against four, on the strength of a note calling the flag
 *  array "per side". The flag array IS per side, but the SCAN clears it on
 *  every call: F0x800A0CD4 walks the sorted field from the index it was given,
 *  stops at the first qualifying run, clears +0x446 across the side's whole
 *  slot count, sets it on that run's slots alone and returns the next scan
 *  index. The Battle Phase re-enters it until it returns -1, and the
 *  announcement opcode is issued once per run, so each run is summed, capped
 *  and tested on its own. Two runs of three used to be worth the four-card
 *  bonus between them, which no run had earned; and a side whose runs summed
 *  past 99 used to lose the excess that the disc keeps, because each run
 *  saturates separately before being added to the side's total.
 *  — cardgame-combo-adds-the-run-again-and-does-not-digivolve-2026-08-24
 *    ("adds a further 0x14 to each when the run holds four or more"),
 *    cardduel-combo-is-three-of-a-kind-gated-on-card-record-0x0a,
 *    cardgame-combo-does-not-replace-the-run-with-the-target-digimon */
export function comboRunScore(run: ComboRun): { ap: number; hp: number } {
  // The disc saturates after every slot it adds; with no negative stats that is
  // the same ceiling as capping the run's sum once.
  let ap = Math.min(run.ap, STAT_CAP);
  let hp = Math.min(run.hp, STAT_CAP);
  if (run.count >= COMBO_MIN + 1) {
    ap = Math.min(ap + COMBO_FOUR_BONUS, STAT_CAP);
    hp = Math.min(hp + COMBO_FOUR_BONUS, STAT_CAP);
  }
  return { ap, hp };
}

export function comboBonus(runs: ComboRun[]): { ap: number; hp: number } {
  let ap = 0;
  let hp = 0;
  for (const r of runs) {
    const score = comboRunScore(r);
    ap += score.ap;
    hp += score.hp;
  }
  return { ap, hp };
}

// ---------------------------------------------------------------------------
// Battle resolution
// ---------------------------------------------------------------------------

export interface BattleResult {
  playerAp: number;
  playerHp: number;
  opponentAp: number;
  opponentHp: number;
  playerLeft: number;
  opponentLeft: number;
  /** 0 = the player took the set, 1 = the opponent did. A tie is 1. */
  winner: 0 | 1;
  combos: { player: ComboRun[]; opponent: ComboRun[] };
}

/** Queue `damage` against a side's field as per-slot TARGETS. Nothing moves
 *  here; tickStats does the moving, one point per frame.
 *
 *  Battle damage lands on the SIDE TOTAL, never on a slot. Runtime capture
 *  2026-08-08 (`cardgame_s5_run2_modes6plus.txt`, GUI slot 5 duel, Battle Phase
 *  frames 3189-3902): across the whole phase not one field slot's AP or HP word
 *  changed, while the two block totals each took a single write —
 *  frame 3249 opponent total HP 10 -> 0 against a player field AP of 29
 *  (floored), frame 3389 player total HP 19 -> 15 against an opponent field AP
 *  of 4. Positive control in the same log: the slot words DO move at frames
 *  2049/2052 (summons) and 2680 (a Program card setting a slot's true AP to 10
 *  with the displayed value rolling behind it), so the null result is real and
 *  not an artifact of the logged range.
 *
 *  This agrees with the static side: `F0x8008DEF8`, the only routine that adds
 *  to a slot's `+0x2`/`+0x4`, is reached from three call sites and all three are
 *  inside the Program-card effect interpreter `F0x80084320`. No Battle-Phase
 *  code path writes a slot stat. The earlier "spread the total across the slots
 *  in order" WALKER RULE is therefore not merely unproven — it is wrong, and it
 *  is removed.
 *
 *  LIMIT: one sampled duel, one board, and the sampled path was a win. The
 *  arithmetic matched exactly on both sides, but a lopsided board and a losing
 *  path have not been captured. */
export function applyBattleDamage(s: DuelSide, incomingAp: number): void {
  s.totalHp = Math.max(0, s.totalHp - incomingAp);
}

/** Write a slot's TRUE stats. This is F0x8008DEF8: it loads `+0x2`/`+0x4`,
 *  adds the effect's packed delta, and stores straight back. There is no ramp
 *  and no queue — the true pair moves at once, and only the DISPLAYED pair
 *  (`shownAp`/`shownHp`) animates afterwards.
 *
 *  The name is historical; it used to write a separate target tier that the
 *  disc does not have. */
export function queueSlotStats(f: FieldSlot, ap: number, hp: number): void {
  // NOT clamped. F0x8008DEF8 is `lhu` / `addu` / `sh` with no `slti` anywhere:
  // the true pair is plain halfword arithmetic and may sit outside [0, 99].
  // Only the DISPLAY ramp clamps (`slti ..., 0x63` up, `blez` down), so a slot
  // pushed to 150 shows 99 but still has 150 to spend on the next subtraction.
  f.ap = ap;
  f.hp = hp;
}

const stepToward = (v: number, target: number) =>
  v < target ? v + 1 : v > target ? v - 1 : v;

/** One frame of F0x8008E08C.
 *
 *  The TRUE stats do not move here — F0x8008DEF8 already wrote them. This
 *  function only walks the DISPLAYED pair one point per frame toward the true
 *  pair, capping the rise with `slti ..., 0x63` and flooring the fall with
 *  `blez`, exactly as the two ramp blocks do.
 *
 *  THE REMOVAL PASS RUNS ONLY WHEN BOTH RAMPS ARE DONE. In the original that is
 *  the `$t1` guard: `$t1` is set to 1 only on the branches that SKIP a ramp, and
 *  is zeroed by either ramp actually running, so the tail's
 *  `beqz $t1, <return>` lets the removal pass execute on the first frame where
 *  neither the AP nor the HP ramp had anything left to do. A slot whose display
 *  is still falling is therefore not reaped mid-fall.
 *
 *  Returns true while anything is still moving — the original's own return
 *  value is `$t1`, i.e. the inverse: 1 once settled. */
export function tickStats(s: DuelSide): boolean {
  let moving = false;
  for (const f of s.field) {
    const ap = clampStat(f.ap);
    const hp = clampStat(f.hp);
    if (f.shownAp !== ap) { f.shownAp = stepToward(f.shownAp, ap); moving = true; }
    if (f.shownHp !== hp) { f.shownHp = stepToward(f.shownHp, hp); moving = true; }
  }
  // The tail: only once neither ramp moved this frame.
  if (!moving) reapDead(s);
  return moving;
}

/** Whether the displayed pair has caught up with the true pair everywhere. */
export function statsSettled(s: DuelSide): boolean {
  return s.field.every((f) => f.shownAp === clampStat(f.ap) && f.shownHp === clampStat(f.hp));
}

/** Run the ticker until both ramps are done. Callers that do not animate — the
 *  model-only phase driver, the tests — use this; the duel screen instead ticks
 *  one frame at a time so the ramp IS the animation. The bound is the stat cap
 *  plus one, since no single ramp can be longer than that. */
export function settleStats(s: DuelSide): void {
  for (let i = 0; i <= STAT_CAP * 2 + 2 && tickStats(s); i++) { /* one point per frame */ }
}

/** Battle-Phase state 8, the reveal beat — model §D.5 and effect opcode 0x2A.
 *
 *  0x2A (F0x8008F948) only counts: it raises the reveal counter `duel+0x305`
 *  and puts the played card's face index in `duel+0x304`. State 8 then latches
 *  opcode 0x1B once per count, and 0x1B's update phase (F0x80093CAC) exchanges
 *  the STORED totals at the head of each per-player block — `+0x59C <-> +0x664`
 *  (AP) and `+0x59E <-> +0x666` (HP), §E.3.
 *
 *  Read that assignment block closely, because the printed card text invites the
 *  wrong reading: it swaps AP between the two SIDES and HP between the two
 *  SIDES. It does NOT swap a side's own AP with its own HP. Fortune Gate is
 *  printed "The Fortune Gate exchanges the AP and HP" and the English is
 *  ambiguous; the code is not.
 *
 *  State order puts this before the comparison that uses it — 2 -> 8 -> 9 ->
 *  0xA, and state 0xA decides the set on `+0x666 < +0x59E`, the stored totals.
 *  Two reveals in one Battle Phase therefore swap back to where they started.
 *
 *  BOUNDARY RESOLVED 2026-08-25 — it DOES overwrite the cache. F0x80094848's
 *  step 2, at the end of its fifteen-frame tween:
 *
 *      arg0->unk59C = arg0->unk428;   // player AP  <- summed from +0x734
 *      arg0->unk59E = arg0->unk42C;   // player HP  <- summed from +0x736
 *      arg0->unk664 = arg0->unk430;   // opponent AP
 *      arg0->unk666 = arg0->unk434;   // opponent HP
 *
 *  So THE EXCHANGE IS TRANSIENT: the next recount restores both sides' totals
 *  to their fields' own displayed sums and the swap is gone. What makes Fortune
 *  Gate work at all is ORDER — no recount sits between state 8 and state 0xA,
 *  so the set is decided on the swapped values, and only afterwards does a
 *  recount put them back.
 *
 *  resolveBattle reproduces that order exactly: recomputeTotals both sides,
 *  THEN this, THEN read the totals for the winner. A recomputeTotals inserted
 *  between the exchange and the decision would silently disable the card, which
 *  is why tests/card-battle.test.js pins the ordering. */
export function exchangeTotals(duel: DuelState): void {
  const ap = duel.player.totalAp;
  const hp = duel.player.totalHp;
  duel.player.totalAp = duel.opponent.totalAp;
  duel.player.totalHp = duel.opponent.totalHp;
  duel.opponent.totalAp = ap;
  duel.opponent.totalHp = hp;
}

/** The Battle Phase. Both sides' totals are taken at once, both attacks land at
 *  once, and the side with more HP left takes the set — with a tie going to
 *  side 1, per F0x800a0f94 cases 9 and 10. */
/** The Battle Phase's working state, carried from one ceremony opcode to the
 *  next exactly as the disc carries it in the duel object's accumulators. */
export interface BattleWalk {
  combos: BattleResult["combos"];
  playerAp: number; playerHp: number;
  opponentAp: number; opponentHp: number;
  playerLeft: number; opponentLeft: number;
  winner: 0 | 1;
  /** State 0xA and state 0xB have already been settled for this walk. The walk
   *  is the Battle Phase's own, so the flag is per set: it is what stops a
   *  driver from settling the same set twice while it waits for state 0x12's
   *  sweep beat. */
  settled: boolean;
}

/** The Battle Phase's beat stream, built when the phase opens — straight out of
 *  the decoded state table in `card-ceremony.ts`, state by state.
 *
 *    state 1  scans YOUR board and latches `0x19` for each combo run it finds,
 *             coming back for the next until the scan returns -1
 *             (`cardgame.s:30946-30956`);
 *    state 2  does the same for the opponent with `0x1A`, which is the same
 *             routine aimed at side 1 (`cardgame.s:30957-30964`);
 *    state 8  latches `0x1B` once per queued card reveal, counting the queue
 *             down and leaving only at zero (`cardgame.s:30969-30988`);
 *    states 6 and 7 latch `0x15` and `0x16` (`cardgame.s:31097` and `:31104`)
 *             — and ONLY when BOTH fields hold a card, because state 9 reaches
 *             them through a banner it opens only in that case
 *             (`cardgame.s:30989-30995`: state 9 tests `duel+0x72C` and then
 *             `duel+0x79E`, and takes the banner arm only when both are
 *             non-zero; otherwise it decides the set itself at `:30997`).
 *
 *  A scan that finds nothing issues nothing, so no rule may hang on these; the
 *  board is taken on the phase banner instead.
 *
 *  NOTHING IS LATCHED FOR STATE 0x12 — the set-change sweep, the boards
 *  emptying and both hands walking back into their decks. That state only runs
 *  when the duel SURVIVES the set (state 0x11's duel-over test,
 *  `cardgame.s:31418-31443`), which cannot be known when the phase opens, and it
 *  runs after both result windows. `battleSweepWinner` is what performs it and a
 *  screen latches 0x1C/0x1D for it through the same pending lane once the
 *  windows are down, so the walker used to empty the board and deal the next hand
 *  BEFORE the player had even read "You win!".  `cardgame.s:31422-31443` is
 *  state 0x11's duel-over test: it reads the two set counters, and when NEITHER
 *  has reached two it falls into state 0x12 — through the delay slot
 *  `li $v0, 0x12` at `cardgame.s:31426`, which runs whether or not the branch
 *  above it is taken, so the number stored at `cardgame.s:31443` is 0x12 and not
 *  the `sltiu` result above it. */
export function battleCeremony(duel: DuelState): number[] {
  const out: number[] = [];
  for (let i = comboRuns(duel, duel.player).length; i > 0; i--) out.push(0x19);
  for (let i = comboRuns(duel, duel.opponent).length; i > 0; i--) out.push(0x1a);
  for (let i = duel.revealBeats ?? 0; i > 0; i--) out.push(0x1b);
  // States 6 and 7 are behind the Battle banner, and the banner is behind
  // "both fields hold a card". An empty side never drains.
  if (duel.player.field.length && duel.opponent.field.length) out.push(0x15, 0x16);
  return out;
}

/** `0x19` — open the phase and take the board: score the combo runs, refresh
 *  both sides' totals and settle any queued exchange. */
export function battleOpen(duel: DuelState): BattleWalk {
  const combos = {
    player: comboRuns(duel, duel.player),
    opponent: comboRuns(duel, duel.opponent),
  };
  recomputeTotals(duel.player);
  recomputeTotals(duel.opponent);
  // The exchange is NOT done here. Each 0x1B beat performs its own, which is
  // what the disc does -- two reveals in one Battle Phase swap back to where
  // they started because the machine ran the swap twice, not because anything
  // counted the parity. Moved off this function 2026-08-28, when the reveal
  // became a beat with a screen instead of a number the rules folded in.
  return {
    combos,
    playerAp: 0, playerHp: 0, opponentAp: 0, opponentHp: 0,
    playerLeft: 0, opponentLeft: 0, winner: 1, settled: false,
  };
}

/** `0x15` — apply the damage to the block totals: fold each side's combo bonus
 *  into the total that takes the hit, so the stored total and the reported
 *  remainder cannot disagree. */
export function battleTotals(duel: DuelState, w: BattleWalk): void {
  const pBonus = comboBonus(w.combos.player);
  const oBonus = comboBonus(w.combos.opponent);
  w.playerAp = duel.player.totalAp + pBonus.ap;
  w.playerHp = duel.player.totalHp + pBonus.hp;
  w.opponentAp = duel.opponent.totalAp + oBonus.ap;
  w.opponentHp = duel.opponent.totalHp + oBonus.hp;
  duel.player.totalHp = w.playerHp;
  duel.opponent.totalHp = w.opponentHp;
}

/** `0x16` — drain the attack across the row. Both attacks land on the block
 *  totals, one write per side, and the field slots are left exactly as they
 *  stand: see `applyBattleDamage` for the capture and the static call-graph
 *  closure behind that. */
/** ONE side's attack landing — the disc's 0x15 (side 0) and 0x16 (side 1).
 *
 *  DECODED 2026-08-27. F0x80084320 dispatches BOTH opcodes to the same enter,
 *  `F0x80093624(duel, view, 0)` for 0x15 and `(..., 1)` for 0x16, and that enter
 *  reads side `arg2`'s AP total (+0x59C) against the OTHER side's HP (+0x59E).
 *  So they are two drains, one per side, not two different steps — which is how
 *  this used to be modelled, with 0x15 folding the combo bonuses and 0x16
 *  landing both attacks at once. Both sides' damage arriving on one beat is why
 *  the totals used to jump in a single frame partway through the phase.
 *
 *  Side 0 is the player: `UI.players[0]` is the "you" strip.
 *
 *  Order does not matter between the two. Each reads its damage off the WALK,
 *  which holds the pre-drain totals, so draining side 0 first cannot change what
 *  side 1 deals — and `battleTransfer` derives its remainders from the same walk
 *  for the same reason. */
export function battleDrainSide(duel: DuelState, w: BattleWalk, side: 0 | 1): void {
  const attacker = side === 0 ? duel.player : duel.opponent;
  const defender = side === 0 ? duel.opponent : duel.player;
  const ap = side === 0 ? w.playerAp : w.opponentAp;
  const hpBefore = defender.totalHp;
  // Published BEFORE the subtraction: afterwards the clamp has eaten it.
  duel.drain = {
    side, ap, hpBefore,
    // `field` holds only live slots -- reapDead removes a slot the frame its
    // DISPLAYED hp reaches zero -- so its length is the attacking card count
    // the disc reads out of +0x72C.
    cards: attacker.field.length,
  };
  applyBattleDamage(defender, ap);
}

export function battleDrain(duel: DuelState, w: BattleWalk): void {
  applyBattleDamage(duel.player, w.opponentAp);
  applyBattleDamage(duel.opponent, w.playerAp);
}

/** `0x17` — transfer the damage: what each side has left. Derived from the
 *  pre-drain totals held in the walk, so it does not matter that `0x16` has
 *  already run. */
export function battleTransfer(_duel: DuelState, w: BattleWalk): void {
  w.playerLeft = Math.max(0, w.playerHp - w.opponentAp);
  w.opponentLeft = Math.max(0, w.opponentHp - w.playerAp);
}

/** Battle-Phase state 0xA — WHO TOOK THE SET.
 *
 *  Strict comparison on what each side has left, and a tie goes to the
 *  opponent. `cardgame.s:31110-31126`, read in full:
 *
 *    31110  lh $v1, 0x59e($s1)     side 0's total — the player's
 *    31111  lh $v0, 0x666($s1)     side 1's total — the opponent's
 *    31113  slt $v0, $v1          the short form: $v0 < $v1
 *    31114  beqz $v0, .L0x0001e620
 *    31115  li $v0, 0x18          THE DELAY SLOT, so it runs either way
 *    31116  sb $v0, 0x421($s1)    only when $v0 != 0: latch 0x18
 *    31118  sb $zr, 0x301($s1)    award = 0
 *    31119  li $v0, 0x17          the branch-taken arm
 *    31120  sb $v0, 0x421($s1)    latch 0x17
 *    31122  sb $v0, 0x301($s1)    award = 1
 *
 *  So the branch is taken when the two totals are NOT strictly ordered, and the
 *  delay slot's `0x18` is thrown away there: an equal total awards the set to
 *  side 1, the opponent. `duel+0x301` is what every later state reads — the
 *  counter roll (0xB), which side's board empties (0x12), and the duel-over
 *  test's branch at `cardgame.s:31494`.
 *
 *  0x17 and 0x18 are the same routine aimed at each side (the effect table's
 *  update arms at `cardgame.s:221` and `:222` both call F0x80093B10), so the
 *  opcode names the side whose Digimon leave the field: 0x18 when you took the
 *  set, 0x17 when the opponent did. State 0xA latches it once and moves to 0xB
 *  (`cardgame.s:31125-31126`), with `duel+0x2FC` — the roll accumulator —
 *  cleared in the delay slot at `:31128`.
 *
 *  SIDE 0 IS THE PLAYER. The per-side set counters sit at `duel+0x5AE` and
 *  `duel+0x676` (`cardgame.s:31398` and `:31422`, stride 0xC8), and it is the
 *  FIRST of them whose reaching two plays the win sound 0x6004001E
 *  (`cardgame.s:31402-31407`). */
export function battleAward(duel: DuelState, w: BattleWalk): void {
  w.winner = w.opponentLeft < w.playerLeft ? 0 : 1;
  duel.setAward = w.winner;
  // State 0xB reads the two totals a second time and compares them with `beq`
  // (`cardgame.s:31245-31261`), and on an equal pair it opens window 0x12 — the
  // draw line — instead of 0x11. The draw is therefore reachable exactly when
  // the award is the opponent's, which an equal total always is.
  duel.setDraw = w.playerLeft === w.opponentLeft;
}

/** Battle-Phase state 0xB — the counter roll's own commit.
 *
 *  After fifty-one ticks of the resident frame delta the winner's set counter
 *  moves by one and only then. `cardgame.s:31202-31228`:
 *
 *    31202  lw $v1, 0x2fc($s1)     the roll accumulator
 *    31205  sw $v1, 0x2fc($s1)     += the frame delta returned at :31197
 *    31206  slti $v1, 0x33         wait while it is under 0x33 = 51
 *    31228  sb $v0, 0x5ae($v1)     the winner's counter, +1, at duel+0xC8*side
 *
 *  `slti $v1, 0x33` is the short form, so it is the accumulator just stored, not
 *  the frame delta.
 *
 *  BEFORE the roll is over the plate already flickers: the same state writes
 *  the winner's counter into the view twice a tick, once with one added and once
 *  without, on the low bit of the accumulator (`andi $v0, 0x1` at
 *  `cardgame.s:31131`, the two arms at `:31133-31149` and `:31150-31164`). The
 *  counter the player reads is the view's, so it alternates between the old and
 *  the new value for all fifty-one ticks. `setEnd`'s roll step draws that.
 *
 *  This is deliberately NOT the same moment as `battleAward`: the disc fixes the
 *  winner in state 0xA and moves the counter in state 0xB, one state later, and
 *  the result window only opens after that (`cardgame.s:31229-31265`). */
export function commitSetCounter(duel: DuelState): void {
  const who = duel.setAward;
  if (who === null || duel.setCounted) return;
  duel.setCounted = true;
  if (who === 0) duel.player.score += 1;
  else duel.opponent.score += 1;
  duel.log.push(who === 0 ? "You win!" : "You lose!");
}

/** Battle-Phase state 0xA plus 0xB, in the order the disc runs them.
 *
 *  Neither latches an effect opcode, so neither can be a beat: the original
 *  reaches them through state 9's tail and state 0xA, and on a board where
 *  neither field holds a card, where no combo ran and no card was queued for
 *  reveal, the Battle Phase issues no beat at all between its banner and the
 *  counter roll. The beat lane therefore settles both when the phase's own
 *  beats run out, which is the same place the disc's state 9 falls through to
 *  state 0xA. */
export function battleSettleSet(duel: DuelState, w: BattleWalk | null): void {
  if (!w || w.settled) return;
  w.settled = true;
  if (duel.setAward === null) battleAward(duel, w);
  commitSetCounter(duel);
}

/** Battle-Phase state 0x12 — the last thing the Battle Phase does.
 *
 *  `cardgame.s:31444-31454`: it reads the award, latches 0x1C when YOU took the
 *  set and 0x1D when the opponent did — the delay slot's `li $v0, 0x1d` at
 *  `:31447` is overridden by the fall-through `li $v0, 0x1c` at `:31448` when
 *  the award is 0 — writes the run count 1, and goes straight to state 0x1A,
 *  which is the machine's return to the mode handler. There is no wait here at
 *  all: the sweep is the last effect the phase issues, and the next set's
 *  dealing follows it.
 *
 *  In this model that sweep is `endSet`: the boards empty and both hands walk
 *  back into their decks, which is the decoded set-change behaviour it has
 *  always been given. The beat is issued only when the duel SURVIVES the set —
 *  state 0x12 is reached only through state 0x11's fall-through
 *  (`cardgame.s:31422-31443`) — and only after both result windows, because a
 *  screen holds the beat lane while they are up.
 *
 *  Returns true when the duel goes on; when a side has taken its second set the
 *  duel is over instead, which is the branch at `cardgame.s:31398-31407` and
 *  `:31422-31436` — and the mode machine reads this routine's return value to
 *  know the duel ended (`cardgame.s:31563-31566` writes 0x19 and
 *  `:31565-31567` returns 2). */
export function battleSweepWinner(duel: DuelState, rng: () => number): boolean {
  if (duel.setAward === null || duel.setCounted === false) return false;
  endSet(duel, rng);
  // The next set starts with nothing awarded and nothing counted.
  duel.setAward = null;
  duel.setDraw = false;
  duel.setCounted = false;
  if (duel.player.score >= SETS_TO_WIN || duel.opponent.score >= SETS_TO_WIN) {
    finishDuel(duel);
    return false;
  }
  duel.set += 1;
  duel.log.push("Next set.");
  return true;
}

/** The whole Battle Phase in one call, for every caller that does not want to
 *  drive it opcode by opcode. It IS the ceremony steps, in the order the disc
 *  issues them — there is no second implementation. */
export function resolveBattle(duel: DuelState): BattleResult {
  const w = battleOpen(duel);
  // State 8 in one go. The beat-driven screen issues one 0x1B per queued
  // reveal and each performs its own exchange; this shortcut runs the whole
  // phase in a single call, so it has to do the same here -- before the
  // comparison, which is the order that makes Fortune Gate work at all.
  for (let i = duel.revealBeats ?? 0; i > 0; i--) exchangeTotals(duel);
  duel.revealBeats = 0;
  battleTotals(duel, w);
  battleDrain(duel, w);
  battleTransfer(duel, w);
  battleSettleSet(duel, w);
  return {
    playerAp: w.playerAp, playerHp: w.playerHp,
    opponentAp: w.opponentAp, opponentHp: w.opponentHp,
    playerLeft: w.playerLeft, opponentLeft: w.opponentLeft,
    winner: w.winner, combos: w.combos,
  };
}

/** Between sets: everything on the field goes to the trash, everything still in
 *  hand goes back into the deck, the trash stays where it is, the deck is
 *  reshuffled and unspent S-Energy carries over. */
/** The set transition widens a side's usable deck: F0x800a1a5c increments the
 *  set counter and then recomputes the availability count from the new
 *  2 * set + 2 threshold. Entries whose group has just come inside the window
 *  join the deck; entries already drawn, played or trashed are left alone.
 *
 *  OPEN: group 7 is past the widest window (2 * 2 + 2 = 6), so under this rule
 *  a group-7 entry is never available. Nearly half the shipped entries are
 *  group 7, and whether they are ever drawn is NOT established.
 *
 *  BOUNDARY — the opponent's pile is not widened the way this models it.
 *  `cardduel-opponent-pile-is-retired-tier-by-tier-2026-08-21`
 *  (partially_verified): F0x8009DA68 stamps each restored slot with group
 *  2*set+1 and then ROTATES every slot whose group is inside the current window
 *  out to the back of the pile, marking it out of play, so the next set opens on
 *  the next tier. This function only ADMITS a tier and leaves order alone, which
 *  for side 1 — never shuffled since 2026-08-24 — means the opponent draws the
 *  new tier at the bottom rather than the top. Implementing the rotation needs
 *  what that claim itself lists as unread: what the opponent's draw code does
 *  with duel+0x41B and duel+0x41C. NOT closed, and it changes draw ORDER, not
 *  which cards are available. */
export function openDeckForSet(s: DuelSide, setIndex: number): number[] {
  if (!s.deckGroup.length || setIndex <= s.openedToSet) return [];
  const limit = setWindowThreshold(setIndex);
  const was = setWindowThreshold(s.openedToSet);
  s.openedToSet = setIndex;
  const added: number[] = [];
  // Admitted cards go in AHEAD of the retired tail, never behind it. On the
  // disc every slot is present from the start and the rotation parks retired
  // cards at the very back (`duel+0x41C` downward), so a newly available tier
  // is always in front of them. Appending would put the new tier behind the
  // cards that were just taken out of play, which is the "opponent draws the
  // new tier at the bottom" defect.
  const tail = firstRetiredSlot(s);
  s.deckAuthored.forEach((id, i) => {
    const g = s.deckGroup[i] ?? 0;
    if (g > was && g <= limit) {
      s.deck.splice(tail + added.length, 0, id);
      s.deckSlots.splice(tail + added.length, 0, i);
      added.push(id);
    }
  });
  return added;
}

/** The availability group that means OUT OF PLAY. `F0x8009D9E4` scans down from
 *  slot 39 while the group byte is 7 to find `duel+0x41C`, so 7 is the retired
 *  marker rather than a tier that ever comes inside a window. */
export const GROUP_RETIRED = 7;

/** `duel+0x41B` — the first slot index whose group is OUTSIDE the current
 *  window. `F0x8009D9E4` walks up from the deck read cursor while
 *  `2 * set + 2 >= group` and stops on the first entry that fails, so it is a
 *  SLOT INDEX, not a count. */
export function firstUnavailableSlot(s: DuelSide, setIndex: number): number {
  const limit = setWindowThreshold(setIndex);
  let i = 0;
  while (i < s.deck.length && (s.deckGroup[s.deckSlots[i] ?? -1] ?? 0) <= limit) i++;
  return i;
}

/** `duel+0x41C` — the lowest RETIRED slot index, i.e. where the group-7 tail
 *  begins. `F0x8009D9E4` scans down from 39 while the group is 7. */
export function firstRetiredSlot(s: DuelSide): number {
  let i = s.deck.length;
  while (i > 0 && (s.deckGroup[s.deckSlots[i - 1] ?? -1] ?? 0) === GROUP_RETIRED) i--;
  return i;
}

/**
 * The opponent's pile is retired a tier at a time — `F0x8009DA68`, side 1's
 * set-change handler, and ONLY side 1's. `F0x800A19F8` handles side 0 and its
 * whole body is the hand-return loop: no stamp, no rotation.
 *
 * Two things happen after the hand goes back:
 *
 *   1. **The returned cards are stamped** with group `2 * set + 1`. The handler
 *      walks the slots between the new read cursor and the old one and writes
 *      that value into each `+0x30B`.
 *   2. **Every in-window card at the FRONT of the pile is rotated to the back
 *      and marked group 7.** The loop tests only the slot AT the cursor: while
 *      `2 * set + 2 >= group` it shifts every slot from the cursor up to
 *      `duel+0x41C - 1` down by one, drops the cursor's card in at
 *      `+0x41C - 1`, and sets that slot's group to 7. It stops on the first
 *      card whose group is outside the window — which is exactly the next tier.
 *
 * So the tier that was playable this set is pushed to the back and taken out of
 * play, and the next set opens on the next tier. The stamp is what makes cards
 * that came back from the hand retire with the tier they were played in rather
 * than surviving into the next one.
 *
 * DECODED 2026-08-25 from `exe-decomp/cardgame_c/F0x8009da68.c` and
 * `F0x8009d9e4.c`. Both were previously recorded as blocked on `duel+0x41B` and
 * `+0x41C` being "unread"; they are read at twenty sites.
 */
export function retireOpenedTier(s: DuelSide, setIndex: number, returned: number[] = []): number[] {
  if (!s.deckGroup.length) return [];
  // 1. the stamp
  for (const slot of returned) {
    if (slot >= 0) s.deckGroup[slot] = 2 * setIndex + 1;
  }
  // 2. the rotation, from the front, stopping on the first out-of-window card
  const limit = setWindowThreshold(setIndex);
  const retired: number[] = [];
  for (let guard = 0; guard < FOLDER_SIZE && s.deck.length; guard++) {
    const slot = s.deckSlots[0] ?? -1;
    const g = s.deckGroup[slot] ?? 0;
    if (g > limit) break;
    const id = s.deck.shift()!;
    s.deckSlots.shift();
    s.deck.push(id);
    s.deckSlots.push(slot);
    if (slot >= 0) s.deckGroup[slot] = GROUP_RETIRED;
    retired.push(id);
  }
  return retired;
}

export function endSet(duel: DuelState, rng: () => number): void {
  for (const s of [duel.player, duel.opponent]) {
    const isPlayer = s === duel.player;
    for (const f of s.field) s.trash.push(f.id);
    s.field = [];

    // The hand goes back ON TOP of the draw pile, both sides —
    // `cardduel-set-change-returns-both-hands-to-the-draw-pile-2026-08-21`,
    // VERIFIED. Mode 9 walks the hand down while decrementing the deck read
    // cursor and writing each entry at `block+0x14 + (cursor-1)*2`, so the
    // cards land in front of the cursor, not behind the pile. Index 0 is the
    // top here (takeFromDeck defaults to it), so this unshifts. It made no
    // visible difference while both piles were reshuffled straight afterwards;
    // it does now, because the opponent's is not.
    const returnedSlots = s.handSlots.slice();
    s.deck.unshift(...s.hand);
    s.deckSlots.unshift(...s.handSlots);
    s.hand = [];
    s.handSlots = [];

    // ONLY THE OPPONENT'S PILE IS ROTATED. F0x8009DA68 is side 1's handler and
    // stamps the returned cards then retires the played tier; F0x800A19F8 is
    // side 0's and is nothing but the hand-return loop above.
    if (!isPlayer) retireOpenedTier(s, duel.set, returnedSlots);

    // The coming set is duel.set + 1. Widening admits the next tier.
    openDeckForSet(s, duel.set);

    recomputeTotals(s);
  }
  // Only the player's pile is shuffled —
  // `cardduel-set-change-shuffles-only-the-player-pile-2026-08-21`, VERIFIED.
  // Mode 9's one indirect call is the duel's +0x810 shuffle method and both its
  // arguments come from the SIDE-0 block ($s1 = duel+0x59C, fields +0x04 and
  // +0x08), and F0x8009DA68, the routine that handles side 1, contains no call
  // instruction at all. Reshuffling both gave the opponent a materially different
  // deck from the disc's, and that is what the walker used to do. The call is made
  // ONCE for the duel, after the loop, so this site and the Start phase share one
  // decoded member list (`SHUFFLED_PILES`) instead of each naming a side itself.
  shuffleDuelPiles(duel, rng);
  duel.playedThisPhase = [];
}

// ---------------------------------------------------------------------------
// Program cards
// ---------------------------------------------------------------------------

/** A Program card's decoded targeting, as tools/extract_card_effects.py emits
 *  it from F0x800a36e4 / F0x8008eec8 / F0x8008ec44. */
export interface EffectTargeting {
  zone: "none" | "field" | "hand" | "deck" | "trash" | "played-this-phase";
  sides?: ("own" | "opponent")[];
  colours?: CardColour[];
  kinds?: ("digimon" | "program")[];
  requiresCategory?: number;
}

export interface EffectRecord {
  id: number;
  name: string;
  targetKind: number;
  effectVisual: number;
  effectAsset: number;
  playKind: number;
  messages: number[];
  fieldMask?: number;
  targeting: EffectTargeting;
}

export interface EffectTable {
  count: number;
  effects: EffectRecord[];
}

export function indexEffects(table: EffectTable): Map<number, EffectRecord> {
  const m = new Map<number, EffectRecord>();
  for (const e of table.effects) m.set(e.id, e);
  return m;
}

/** What a Program card does, once a target has been picked.
 *
 *  PROVENANCE CORRECTED 2026-08-08. The previous note here said the byte list at
 *  effect record +0x04 was "a message list, not a VM", and that the amounts
 *  "genuinely live in the card text and nowhere else". Both are false — the
 *  ledger claim `cardduel-effect-record-message-list-is-not-a-bytecode` is
 *  recorded as CONTRADICTED. The byte list IS an opcode program, run by the
 *  two-phase interpreter F0x80084320, and the amounts are opcode immediates.
 *
 *  Every entry below has now been checked against that code, and the
 *  correspondence is locked by `tests/card-battle.test.js`
 *  ("Program-card effects match the opcodes the game runs"), which re-derives it
 *  from the extracted programs in web/assets/data/card_effects.json rather than
 *  trusting this comment:
 *
 *  - STAT CHANGES, opcodes 0x5E..0x69 — the twelve packed immediates handed to
 *    F0x8008DEF8 (high halfword to AP, low to HP): +10/+10, 0/+30, +50/+50,
 *    +20/+20, +30/+30, 0/+10, +10/0, 0/-60, 0/-15, 0/-30, +10/-10, -99/0.
 *    All twelve match the amounts here. Damage is HP-only; buffs raise both.
 *  - S-ENERGY, opcodes 0x1E..0x28 — the interpreter passes the amount directly
 *    (+1 for 0x1E/0x1F/0x20/0x22/0x23, +2 for 0x21, -2 for 0x24..0x28), and
 *    F0x8008423c maps opcode to colour index: 0x1E/0x24 -> 0 white, 0x1F/0x25
 *    -> 1 blue, 0x20/0x21/0x26 -> 2 green, 0x22/0x27 -> 3 red, 0x23/0x28 -> 4
 *    black. The same routine picks the side: gains hit the acting side, drains
 *    hit `side ^ 1`, i.e. the opponent. All eleven match.
 *  - ONE TARGET vs ALL — opcode 0x5B selects a single target and 0x5C selects
 *    every match. Checked across all 60 records with zero mismatches. NOTE this
 *    corrects card-battle-complete-model §G.0, which lists 0x5B/0x5C as
 *    "combo-highlight flags" on the strength of the functions they call.
 *
 *  STILL TEXT-DERIVED, not yet read from code:
 *  - The summon-target card ids. Traced 2026-08-08 and it does NOT resolve
 *    statically: opcodes 0x4F..0x55 call F0x80091858 with `opcode + 1`, and that
 *    routine uses the value to index the duel's own instance table at
 *    `duel+0x50` (`(duel + arg3*2)->unk50`) before writing the slot. Per §E.3
 *    those tables hold INSTANCE indices, not card ids, so the summoned Digimon
 *    depends on runtime duel state and cannot be read off the opcode. Taking
 *    `opcode + 1` as a card id gives Dinohumon for "Summon Angemon", which is
 *    plainly wrong — do not "fix" the table that way. Needs a runtime read of
 *    the instance table while one of these cards resolves.
 *  Now ALSO read from code (2026-08-08):
 *  - DRAW counts. F0x80090A6C is the draw routine and the interpreter hands it
 *    the count: opcode 0x45 -> 2, 0x47 -> 6, 0x46 -> `3 - handCount` floored at
 *    0, i.e. a fill-to-three. Chrono Balance runs 0x46 twice, once per side,
 *    which is exactly its "both players' Hands" text. All match.
 *  - SEARCH kinds, from the zone selector each program runs: 0x32 own deck mask
 *    0xFF (any), 0x34 mask 0xFD (Digimon only), 0x35 mask 0xFE (Program only).
 *    All three match.
 *  - Trade Charge was WRONG and is corrected — see entry 45.
 *
 *  STILL unverified: the bounce / trash amounts. */
export type EffectOp =
  | { op: "energyGain"; colour: EnergyColour; amount: number }
  | { op: "energyDrain"; colour: EnergyColour; amount: number }
  | { op: "energyZeroAll" }
  | { op: "buff"; ap: number; hp: number; all: boolean }
  | { op: "damage"; amount: number; all: boolean }
  | { op: "trashField"; all: boolean }
  | { op: "bounceToHand"; all: boolean }
  | { op: "stealDigimon" }
  | { op: "summonCard"; card: number; count: number }
  | { op: "summonFromHand" }
  | { op: "drawCards"; count: number }
  | { op: "searchDeck"; kind: "any" | "digimon" | "program" }
  | { op: "recoverFromTrash" }
  | { op: "trashToDeck" }
  | { op: "discardHandThenDraw"; count: number }
  | { op: "handSizeTo"; count: number }
  | { op: "deckPickThenDiscard" }
  | { op: "deckToTrash"; count: number }
  | { op: "handToTrash"; all: boolean }
  | { op: "swapTotals" }
  | { op: "zeroOpponentAp" }
  | { op: "cancelDrawnProgram" };

/** The seven summon opcodes and the Digimon each brings out — DECODED
 *  2026-08-08, statically, from the game's own data. No runtime read needed;
 *  the earlier "this cannot be resolved without the rig" note was wrong.
 *
 *  `F0x80091858` (cardgame.s file `0x0EBA8`) reads a halfword at
 *  `duel + 0x50 + a3*2` and adds 1 before the catalog getter:
 *      sll $v0, $s7, 0x1  /  addu $v0, $s6, $v0  /  lh $a0, 0x50($v0)
 *      lw $v0, 0x44($sp)  /  jalr $v0  /  addiu $a0, 0x1     (delay slot)
 *  `a3` is `opcode + 1`, so opcodes 0x4F..0x55 read instance slots 80..86 —
 *  past the 80 instances the two 40-card decks occupy, i.e. seven reserved
 *  slots. Those slots' contents are authored: the halfwords at `0x800A5BDC`
 *  (file `0x22F2C`) are exactly `80, 99, 140, 184, 229, 251, 313`, which the
 *  `+1` turns into the card ids below. The order matches `a3` 80..86 one to one.
 *
 *  A literal search for the table address returns nothing across 590074 lines
 *  because MIPS builds it with lui/addiu, so it was found by scanning the
 *  overlay's data words for the id run instead. */
export const SUMMON_OPCODE_CARDS: Readonly<Record<number, number>> = Object.freeze({
  0x4f: 81,    // Angemon
  0x50: 100,   // Patamon
  0x51: 141,   // Gomamon
  0x52: 185,   // Palmon
  0x53: 230,   // Goburimon
  0x54: 252,   // Devimon
  0x55: 314,   // Hagurumon
});

/** The raw halfwords behind it, so a test can re-derive the ids rather than
 *  trust the table above: card id = entry + 1. */
export const SUMMON_TABLE_HALFWORDS: readonly number[] =
  Object.freeze([80, 99, 140, 184, 229, 251, 313]);

/** card id -> what it does, one line per card, each quoting the card's own
 *  effect string. RETIRED AS THE RUNTIME PATH on 2026-08-22: the duel runs each
 *  card's own opcode program through `card-effect-vm.ts` instead. This table is
 *  kept as a readable summary and as the tests' cross-check; 56 of its 60 rows
 *  reproduce exactly what the program does, and the four that do not are the
 *  picks a table cannot express (see the module note in card-effect-vm.ts). */
export const PROGRAM_EFFECTS: Record<number, EffectOp> = {
  1: { op: "trashField", all: true },                                  // "Put all non-white Digimon into trash can."
  2: { op: "summonCard", card: 81, count: 2 },                          // "Bring 2 Angemon to the field in the Compile Phase."
  3: { op: "buff", ap: 10, hp: 10, all: true },                         // "Add +10 to all own Digimon's AP & HP."
  4: { op: "buff", ap: 0, hp: 30, all: false },                         // "Increase one Digimon's HP by +30."
  5: { op: "energyGain", colour: "white", amount: 1 },                  // "Get 1 point of White S-Energy."
  6: { op: "summonCard", card: 100, count: 1 },                         // "Bring Patamon to the field in Compile Phase."
  7: { op: "bounceToHand", all: true },                                 // "Return all non-blue Digimon back to each Hand."
  8: { op: "stealDigimon" },                                            // "Get 1 of your opponent's Digimon from the field."
  9: { op: "cancelDrawnProgram" },                                      // "Put a just drawn PG Card into trash can."
  10: { op: "bounceToHand", all: false },                               // "Return 1 Digimon back to its Hand."
  11: { op: "energyGain", colour: "blue", amount: 1 },                  // "Get 1 point of Blue S-Energy."
  12: { op: "summonCard", card: 141, count: 1 },                        // "Bring Gomamon to the field in Compile Phase."
  13: { op: "buff", ap: 50, hp: 50, all: true },                        // " +50 to all own Green Digimon Card's AP & HP."
  14: { op: "recoverFromTrash" },                                       // "Pick 1 Card from trash can to Hand. One time use."
  15: { op: "energyGain", colour: "green", amount: 2 },                 // "Get 2 points of Green S-Energy."
  16: { op: "buff", ap: 20, hp: 20, all: false },                       // " +20 to one Digimon's AP & HP."
  17: { op: "energyGain", colour: "green", amount: 1 },                 // "Get 1 point of Green S-Energy."
  18: { op: "summonCard", card: 185, count: 1 },                        // "Bring Palmon to the field in Compile Phase."
  19: { op: "damage", amount: 60, all: true },                          // "60 damage points to all non-red Digimon."
  20: { op: "trashField", all: true },                                  // "Put all brown Digimon into trash can."
  21: { op: "damage", amount: 15, all: true },                          // "15 damage points to all Digimon."
  22: { op: "damage", amount: 30, all: false },                         // "30 damage points to an opponent's Digimon."
  23: { op: "energyGain", colour: "red", amount: 1 },                   // "Get 1 point of Red S-Energy."
  24: { op: "summonCard", card: 230, count: 1 },                        // "Bring Goburimon to the field in Compile Phase."
  25: { op: "handToTrash", all: true },                                 // "Put all non-black Cards in opponent's Hand to trash."
  26: { op: "searchDeck", kind: "any" },                                // "Pick 1 Card from Deck, add it to Hand."
  27: { op: "trashField", all: false },                                 // "Put one non-black Digimon into trash can."
  28: { op: "handToTrash", all: false },                                // "Put one Card from opponent's Hand into trash can."
  29: { op: "energyGain", colour: "black", amount: 1 },                 // "Get 1 point of Black S-Energy."
  30: { op: "summonCard", card: 252, count: 1 },                        // "Bring out Devimon to the field in Compile Phase."
  31: { op: "trashField", all: true },                                  // "Put all Digimon into trash can."
  32: { op: "swapTotals" },                                             // "Exchange the total AP and HP of both players."
  33: { op: "deckToTrash", count: 3 },                                  // "Pick 3 Cards from opponent's Deck to trash can."
  34: { op: "discardHandThenDraw", count: 6 },                          // "Put whole Hand in trash and draw 6 from the Deck."
  35: { op: "energyZeroAll" },                                          // "Reduce all S-Energy to zero."
  36: { op: "trashToDeck" },                                            // "Return all Cards in trash back to the Deck."
  37: { op: "handSizeTo", count: 3 },                                   // "Make both players' Hands have 3 Cards."
  38: { op: "deckToTrash", count: 5 },                                  // "Put 5 Cards from opponent's Deck into trash can."
  39: { op: "zeroOpponentAp" },                                         // "Reduce opponent's AP to zero."
  40: { op: "summonFromHand" },                                         // "Bring a Digimon from Hand to the field in Compile Phase."
  41: { op: "buff", ap: 30, hp: 30, all: false },                       // " +30 to one of Brown Digimon's AP & HP."
  42: { op: "drawCards", count: 2 },                                    // "Draw 2 Cards from Deck and add to Hand."
  43: { op: "searchDeck", kind: "digimon" },                            // "Choose a Digimon from Deck and add to Hand."
  44: { op: "searchDeck", kind: "program" },                            // "Choose a PG Card from Deck and add to Hand."
  // CORRECTED 2026-08-08 from the opcode program. This card runs the SAME
  // deck-picker opcode as the three "Charge" search cards (zone selector 0x32 =
  // own deck, mask 0xFF), not a blind draw — so it must not generate S-Energy
  // the way a real draw does. It was implemented with drawOne, which does.
  45: { op: "deckPickThenDiscard" },                                    // "Draw a Card from Deck and put 1 from Hand in trash."
  46: { op: "deckToTrash", count: 2 },                                  // "Put 2 Cards from opponent's Deck into trash can."
  47: { op: "damage", amount: 30, all: false },                         // "30 damage points to 1 Brown Digimon of opponent."
  48: { op: "cancelDrawnProgram" },                                     // "Put a just drawn Brown PG Card into trash can."
  49: { op: "handToTrash", all: false },                                // "Put 1 Brown Digimon from opponent's Hand into trash."
  50: { op: "summonCard", card: 314, count: 2 },                        // "Bring 2 Hagurumon to the field in Compile Phase."
  51: { op: "energyDrain", colour: "white", amount: 2 },                // "Subtract 2 points from opponent's White S-Energy."
  52: { op: "energyDrain", colour: "blue", amount: 2 },                 // "Subtract 2 points from opponent's Blue S-Energy."
  53: { op: "energyDrain", colour: "green", amount: 2 },                // "Subtract 2 points from opponent's Green S-Energy."
  54: { op: "energyDrain", colour: "red", amount: 2 },                  // "Subtract 2 points from opponent's Red S-Energy."
  55: { op: "energyDrain", colour: "black", amount: 2 },                // "Subtract 2 points from opponent's Black S-Energy."
  56: { op: "bounceToHand", all: false },                               // "Return a Brown Digimon to Hand."
  57: { op: "buff", ap: 10, hp: -10, all: false },                      // "AP +10 and HP -10 to 1 Digimon."
  58: { op: "trashField", all: false },                                 // "Put a Brown Digimon from field into trash can."
  59: { op: "buff", ap: 0, hp: 10, all: false },                        // "HP +10 to Digimon."
  60: { op: "buff", ap: 10, hp: 0, all: false },                        // "AP +10 to Digimon."
};

export interface FieldTarget {
  side: DuelSide;
  slot: number;
}

/** Every field slot a card may point at, per its decoded side and colour mask. */
export function fieldTargets(
  duel: DuelState,
  actor: DuelSide,
  targeting: EffectTargeting,
): FieldTarget[] {
  if (targeting.zone !== "field") return [];
  const out: FieldTarget[] = [];
  const foe = opposing(duel, actor);
  const sides: [DuelSide, "own" | "opponent"][] = [[actor, "own"], [foe, "opponent"]];
  for (const [s, key] of sides) {
    if (!targeting.sides?.includes(key)) continue;
    s.field.forEach((f, i) => {
      const rec = duel.byId.get(f.id);
      if (rec && targeting.colours?.includes(rec.colour)) out.push({ side: s, slot: i });
    });
  }
  return out;
}

/** The AI's card choice over a flagged selection — `F0x8008C6E0`, DECODED
 *  2026-08-08 from `cardgame.s` file `0x09A30`. This is the routine the update
 *  phase of opcodes `0xA9`/`0xAA` calls when the acting side is the AI, exactly
 *  where the player gets the interactive picker (`F0x8008C044`). It ends
 *  `sw $s4, 0x440($s5)` — the same committed-selection field the human picker
 *  writes, which is what makes the two paths interchangeable.
 *
 *  It is invisible to every C-level search because m2c cannot lift it: it opens
 *  with a `jr $v0` jump table on `duel+0x438` picking which zone/side to scan.
 *  That is why earlier passes kept concluding the choice was "absent".
 *
 *  The comparison is on card record `+0x08` = `strengthRank`, where LOWER is
 *  STRONGER, and the direction flips on the mode argument:
 *
 *  - mode 0 (`0xAA`, the acting side's OWN hand) — `slt` then `bnez` skips a
 *    candidate that ranks below the incumbent, so the survivor is the MAXIMUM
 *    rank, i.e. the AI throws away its WEAKEST card. Equal ranks fall through
 *    to the take, so a later slot wins a tie.
 *  - mode 1 (`0xA9`, the OPPONENT's hand) — the same compare with `beqz`
 *    inverts it, keeping the MINIMUM rank, i.e. it takes the opponent's
 *    STRONGEST card. Equal ranks are skipped, so an earlier slot wins a tie.
 *
 *  The first eligible slot is always taken (`$s4` starts at -1). */
export function aiPickBySelectionRank(
  duel: DuelState, side: DuelSide, slots: number[], mode: 0 | 1,
): number {
  let bestSlot = -1;
  let bestRank = 0;
  for (const slot of slots) {
    const id = side.hand[slot];
    if (id === undefined) continue;
    const rank = strengthRank(duel.byId.get(id));
    if (bestSlot < 0) { bestSlot = slot; bestRank = rank; continue; }
    if (mode === 0) {
      if (rank < bestRank) continue;          // bnez -> skip the weaker rank
    } else if (!(rank < bestRank)) continue;  // beqz -> keep the minimum
    bestSlot = slot;
    bestRank = rank;
  }
  return bestSlot;
}

/** The hand slots the own-hand selector `0x37` offers.
 *
 *  `F0x8008EC44(duel, view, side, zone, kindMask)` with zone 2 = hand and mask
 *  `0xFF`, i.e. EVERY card in the side's own hand is a legal choice — the mask
 *  narrows nothing, unlike the deck selectors `0x34`/`0x35`. Returned as slot
 *  indices so the caller can drive a cursor over the real hand row. */
export function handTargets(_duel: DuelState, side: DuelSide): number[] {
  return side.hand.map((_, i) => i);
}

/** Resolve a parked hand-discard choice. Returns false if there is nothing
 *  pending or the slot is not one the selector offers — it never falls back to
 *  a slot of its own. */
export function resolveHandDiscard(duel: DuelState, slot: number): boolean {
  const pending = duel.pendingHandDiscard;
  if (!pending) return false;
  if (!handTargets(duel, pending.side).includes(slot)) return false;
  trashFromHand(pending.side, slot);
  duel.pendingHandDiscard = null;
  return true;
}

/** True while an effect is waiting on a hand choice. Callers must not advance
 *  the phase until this clears. */
export function awaitingHandDiscard(duel: DuelState): boolean {
  return duel.pendingHandDiscard !== null;
}

/** Whether a Program card in hand can legally be played at all — the question
 *  F0x800a36e4 answers before offering the card. */
export function canPlayProgram(
  duel: DuelState,
  actor: DuelSide,
  eff: EffectRecord | undefined,
): boolean {
  if (!eff) return false;
  const t = eff.targeting;
  const foe = opposing(duel, actor);
  switch (t.zone) {
    case "none":
      return true;
    case "field":
      return fieldTargets(duel, actor, t).length > 0;
    case "played-this-phase":
      return duel.playedThisPhase.length > 0;
    case "hand":
    case "deck":
    case "trash": {
      const owner = t.sides?.includes("own") ? actor : foe;
      const pile = t.zone === "hand" ? owner.hand : t.zone === "deck" ? owner.deck : owner.trash;
      return pile.some((id) => {
        const rec = duel.byId.get(id);
        if (!rec) return false;
        return t.kinds ? t.kinds.includes(rec.kind) : true;
      });
    }
    default:
      return false;
  }
}

/** The play's settled target instance — the port's `duel+0x586` (`history
 *  +0x586`), which `F0x800A3E9C` writes from a field slot's `+0xC` and
 *  `F0x800A4328`/`F0x80084320` from a hand entry. `checkEffectLegality` arms 9
 *  and 11 re-check it. `zone` names which identity space `instance` is in: the
 *  field's placement serial, or a hand entry. */
export interface NamedTarget {
  zone: "field" | "hand";
  instance: number;
}

/** The instance of the Digimon in `s.field[slot]`, or null when the slot is
 *  empty. This is `F0x800A3E9C`'s read (`lbu 0x73a`), the value it stores at
 *  `history+0x586`. */
export function fieldInstanceAt(s: DuelSide, slot: number): number | null {
  const f = s.field[slot];
  return f ? f.instance : null;
}

/** The identity of the card in `s`'s hand slot, or null when it carries none.
 *  The disc's hand entry is its card-table index; the port's is the per-entry
 *  pile slot `handSlots` (see `checkEffectLegality` arm 11). */
export function handInstanceAt(s: DuelSide, slot: number): number | null {
  const v = s.handSlots[slot];
  return v === undefined || v < 0 ? null : v;
}

/** The eleven board/hand/deck conditions the disc asks before a committed
 *  Program card either fires or shows its own authored no-effect line.
 *  `F0x800954f8 checkEffectLegality`, read whole at
 *  `exe-decomp/cardgame_c/F0x800954f8.c` (307 lines, asm `_asm/F0x800954f8.s`).
 *  Its only caller is `F0x800a2180` case 6 (`:71-80`): a non-zero return shows
 *  the record's `+0x02` line (`openPrompt`, view `+0xEE4`) and waits for a
 *  button; a zero runs the effect program.
 *
 *  THIS IS A DIFFERENT QUESTION FROM `canPlayProgram`, AT A DIFFERENT POINT.
 *  `canPlayProgram` ports `F0x800a36e4` (the record's `+0x00` targeting kind)
 *  and is the SELECTION gate: whether the hand browser offers the card at all
 *  (`F0x80085FD0`'s grey-out) and which card the AI picks (`F0x800A4978`).
 *  This ports `F0x800954f8` (the record's `+0x01`, the extractor's
 *  `effectVisual`) and is asked only at RESOLUTION, after the card is committed
 *  and its target settled. The disc does not consult them together and they are
 *  not meant to agree; for every shipped card that authors a no-effect line
 *  (`+0x02 != 0`, i.e. effectVisual 1..11) the selection gate's refusal is a
 *  subset of this one's, so this gate only ever refuses in MORE states.
 *
 *  Returns `true` when the disc returns 0 (the effect fires) and `false` when
 *  it returns 1 (the disc refuses and shows the record's own line). Arms 9 and
 *  11 are the two target RE-CHECKS: each compares the play's settled target
 *  instance (`history+0x586` — a field slot's serial, or a hand entry) against
 *  the board or the acting hand, so they take that instance as the optional
 *  `named` argument. A caller with no settled target — the hand browser, which
 *  draws the reason line while the card is still only browsed — gets `true`
 *  from those two arms: the disc settles a target BEFORE it asks
 *  (`F0x800a2180` case 6 runs after the targeting step), so it never refuses
 *  without one.
 *
 *  The arms, each beside its own citation in `F0x800954f8.c` (the acting side
 *  is `history[+0x575-1].+0x584`; the other side its XOR 1):
 *
 *  - 1 `.c:54-64` — refuse when the OPPONENT's hand is empty.
 *  - 2 `.c:65-87` — refuse unless the opponent's hand holds a brown (colour 6)
 *    Digimon (kind `0x10`).
 *  - 3 `.c:88-107` — refuse when the opponent's hand is non-empty and every
 *    card in it is black (colour 5).
 *  - 4 `.c:108-110` — refuse when the ACTING side's trash is empty.
 *  - 5 `.c:111-115` — refuse when the acting side's deck is empty.
 *  - 6 `.c:116-118` — refuse when the OPPONENT's deck is empty.
 *  - 7 `.c:119-138` — refuse unless the acting side's deck holds a Digimon.
 *  - 8 `.c:139-158` — refuse unless the acting side's deck holds a Program
 *    card.
 *  - 9 `.c:159-187` — refuse unless a field slot holds the play's named card.
 *    The named card is the settled target: the arm reads each slot's record
 *    `+0xC` (the placement serial) and compares it to `history+0x586`, which
 *    `F0x800A3E9C` wrote from that same `+0xC` (`lbu 0x73a`). So it asks "is
 *    the Digimon I targeted still on the board". `F0x800840F0` is its marking
 *    twin. The port's `named.instance` is `FieldSlot.instance`; with no settled
 *    target the arm cannot refuse and returns `true`.
 *  - 10 `.c:188-287` — the field-filter class (`playKind`, record `+0x03`,
 *    stored at history `+0x585`): refuse unless some slot satisfies the class.
 *    Classes 1..8 are `fieldFilterLegal` below. Class 0 (a `+0x586` instance
 *    match) and 9+ never reach this arm in shipped data — every effectVisual-10
 *    record carries playKind 1..8 — so no instance data is needed here.
 *  - 11 `.c:288-306` — refuse unless the acting side's hand holds the play's
 *    named card. The named card is the settled target's hand entry; the arm
 *    compares `history+0x586` (written from a hand entry by `F0x800A4328`,
 *    `lbu 0x6c8`) against every entry of `+0x600`. So it asks "is the card I
 *    targeted still in my hand". The port's hand-entry identity is the existing
 *    per-entry pile slot `handSlots` (assigned when the side's pile is built,
 *    carried draw→hand); an entry that carries no authored slot has no
 *    instance. With no settled target the arm returns `true`.
 *
 *  Any other value (notably 0 — 46 of the 60 records author no condition) falls
 *  outside the disc's `1..0xB` switch (`sltiu …, 0xb` at `_asm:45`) and is
 *  legal: the effect always fires.
 *
 *  Durable record: `.dw3-research/card-legality-gate-2026-10-07/worker-r.md`.
 */
export function checkEffectLegality(
  duel: DuelState,
  actor: DuelSide,
  eff: EffectRecord | undefined,
  named?: NamedTarget,
): boolean {
  const foe = opposing(duel, actor);
  const kindOf = (id: number) => duel.byId.get(id)?.kind;
  const isBrownDigimon = (id: number) =>
    duel.byId.get(id)?.colour === "brown" && duel.byId.get(id)?.kind === "digimon";
  const isNotBlack = (id: number) => duel.byId.get(id)?.colour !== "black";
  const isProgram = (id: number) => { const k = kindOf(id); return k !== undefined && k !== "digimon"; };
  switch (eff?.effectVisual ?? 0) {
    case 1:
      return foe.hand.length > 0;
    case 2:
      return foe.hand.some(isBrownDigimon);
    case 3:
      return foe.hand.length > 0 && foe.hand.some(isNotBlack);
    case 4:
      return actor.trash.length > 0;
    case 5:
      return actor.deck.length > 0;
    case 6:
      return foe.deck.length > 0;
    case 7:
      return actor.deck.some((id) => kindOf(id) === "digimon");
    case 8:
      return actor.deck.some(isProgram);
    case 9: {
      // Refuse unless a field slot still holds the play's named instance.
      // With no settled target the disc has not asked yet (its only caller is
      // F0x800a2180 case 6, after the target is settled); the browse-time
      // preview has no target, so there is nothing here to refuse.
      if (named?.zone !== "field") return true;
      return [...actor.field, ...foe.field].some((f) => f.instance === named.instance);
    }
    case 10:
      return fieldFilterLegal(duel, actor, eff?.playKind ?? -1);
    case 11: {
      // Refuse unless the acting side's hand still holds the play's named
      // entry. `handSlots` is the port's per-entry hand identity; an entry
      // carrying no authored pile slot has none, so it cannot match.
      if (named?.zone !== "hand") return true;
      return actor.handSlots
        .slice(0, actor.hand.length)
        .some((v) => v >= 0 && v === named.instance);
    }
    default:
      return true;   // outside the disc's 1..0xB switch: the effect always fires
  }
}

/** `F0x800954f8` case 10's inner switch — the field-filter class carried at
 *  record `+0x03` (written to the play history at `+0x585` by `F0x8009F998`).
 *  The same eight rules `F0x8009FB18 markLegalFieldTargets` marks eligible slots
 *  with (`card-battle-complete-model-2026-08-06.md:900-921`), class → rule:
 *
 *  1 a Digimon on the acting side · 2 one on the opponent's side · 3 either ·
 *  4 a slot that is not white · 5 not blue · 6 green only · 7 not red ·
 *  8 brown only.
 *
 *  The two side classes are relative to the ACTING side — `F0x800954f8` case 10
 *  tests `history[+0x575-1].+0x584` — which the shipped data pins: Gold Aura
 *  (#3, class 1) buffs its own field and Absolute Barrier (#39, class 2) acts on
 *  the opponent's. The five colour classes are the same cards' `.targeting`
 *  colours read the other way. Classes 0 and 9+ have no arm: class 0 would need
 *  the `+0x586` instance, and in shipped data it never pairs with effectVisual
 *  10 (playKind 0 ships only on the effectVisual-9 records), so it refuses. */
function fieldFilterLegal(duel: DuelState, actor: DuelSide, playKind: number): boolean {
  const foe = opposing(duel, actor);
  const slots = [...actor.field, ...foe.field];
  const colour = (f: FieldSlot) => duel.byId.get(f.id)?.colour;
  switch (playKind) {
    case 1:
      return actor.field.length > 0;
    case 2:
      return foe.field.length > 0;
    case 3:
      return slots.length > 0;
    case 4:
      return slots.some((f) => colour(f) !== undefined && colour(f) !== "white");
    case 5:
      return slots.some((f) => colour(f) !== undefined && colour(f) !== "blue");
    case 6:
      return slots.some((f) => colour(f) === "green");
    case 7:
      return slots.some((f) => colour(f) !== undefined && colour(f) !== "red");
    case 8:
      return slots.some((f) => colour(f) === "brown");
    default:
      return false;
  }
}

/** Run a Program card's effect by executing the card's own program.
 *
 *  Until 2026-08-22 this was a hand-written table of per-card outcomes
 *  (`PROGRAM_EFFECTS`, kept below only as a per-card summary that the tests
 *  read; nothing in the duel runs off it any more).
 *  The card's real behaviour is the opcode program in its effect record, and
 *  `card-effect-vm.ts` runs it. Checked card by card: with every pick made
 *  automatically, 56 of the 60 programs land on exactly the state the old table
 *  produced. The four that differ are the four the table could not express —
 *  which card a search takes out of a pile (Ecoly Cycle, Program Charge,
 *  Misery Gate) and Trade Charge throwing away the hand's weakest card, which
 *  its program does with opcode 0xAA rather than by asking.
 *
 *  `target` pre-picks a board slot, as the older callers pass it. With
 *  `interactive` the machine stops instead, and the duel asks the player.
 */
export function applyProgramEffect(
  duel: DuelState,
  actor: DuelSide,
  cardId: number,
  eff: EffectRecord | undefined,
  target?: FieldTarget,
  rng: () => number = Math.random,
  opts: { interactive?: boolean } = {},
): boolean {
  if (!eff) return false;
  const vm = startProgram(duel, actor, eff, {
    interactive: opts.interactive ?? false,
    ...(target ? { target } : {}),
  });
  stepVm(duel, vm, rng);
  duel.effectVm = vm.done ? null : vm;
  // "The card has no effect" — every opcode the program ran was presentation.
  return vm.steps > vm.inert.length;
}

/** What the running program is waiting for, or null. */
export function duelChoice(duel: DuelState): VmChoice | null {
  return duel.effectVm?.choice ?? null;
}

/** True while a card's program is parked on a choice. Callers must not advance
 *  the phase until this clears. */
export function awaitingCardChoice(duel: DuelState): boolean {
  return duelChoice(duel) !== null;
}

/** Answer the running program's question and let it carry on. `index` is a
 *  position in the offered list. Returns false for a pick that was not offered. */
export function resolveCardChoice(
  duel: DuelState,
  index: number,
  rng: () => number = Math.random,
): boolean {
  const vm = duel.effectVm;
  if (!vm || !resolveVmChoice(duel, vm, index)) return false;
  stepVm(duel, vm, rng);
  if (vm.done) duel.effectVm = null;
  return true;
}

/** Play a Program card out of a side's hand. */
export function playProgram(
  duel: DuelState,
  actor: DuelSide,
  slot: number,
  effects: Map<number, EffectRecord>,
  target?: FieldTarget,
  rng: () => number = Math.random,
  opts: { interactive?: boolean } = {},
): boolean {
  const id = actor.hand[slot];
  if (id === undefined) return false;
  const rec = duel.byId.get(id);
  if (!rec || rec.kind !== "program") return false;
  const eff = effects.get(id);
  if (!canPlayProgram(duel, actor, eff)) return false;
  takeFromHand(actor, slot);
  const ran = applyProgramEffect(duel, actor, id, eff, target, rng, opts);
  actor.trash.push(id);
  // escardgm.toml has a line for this: "The card has no effect".
  duel.log.push(ran ? `${actor.name}: ${rec.name}` : `${actor.name}: ${rec.name} — the card has no effect`);
  duel.playedThisPhase.push(id);
  return true;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface DuelAgent {
  /** 0 picks Calumon and acts first, 1 picks Impmon and lets the other side. */
  chooseStart?(duel: DuelState, s: DuelSide): 0 | 1;
  /** hand slot of a Program card to play, or -1 to pass. `effects` lets the
   *  policy apply F0x800A36E4's targeting gate; omitted by older callers. */
  chooseProgram?(duel: DuelState, s: DuelSide, effects?: Map<number, EffectRecord>): number;
  /** hand slot of a Digimon to summon, or -1 to stop summoning. */
  chooseSummon?(duel: DuelState, s: DuelSide): number;
  /** which of the legal field targets an effect should use. */
  chooseTarget?(duel: DuelState, s: DuelSide, targets: FieldTarget[]): number;
  /** Which hand slot to throw away when an effect parks on that choice.
   *  Return -1 to leave it outstanding for someone else to resolve. */
  chooseHandDiscard?(duel: DuelState, s: DuelSide, slots: number[]): number;
}

export interface DuelAgents {
  player: DuelAgent;
  opponent: DuelAgent;
}

/** The AI play class the summon pass skips outright: class-5 Digimon are held,
 *  never played (F0x8008c5f0). */
export const AI_CLASS_NEVER_SUMMON = 5;

/** Which sides' HAND arrays the disc physically sorts — **the opponent's only.**
 *
 *  The shared system is one routine, `F0x8009D8FC` (`cardgame.s:27418-27475`),
 *  and it takes no side argument: `move_ $t4, $a0` at `:27418` keeps the duel
 *  pointer and the outer loop's `addiu $t6, $t3, 0x2` at `:27473` walks
 *  halfwords at `+0x6C8` from it, so the array it reorders is side 1's hand
 *  (`duel+0x6C8`, the +0x64 field of the block at `duel+0x664`) and there is no
 *  path by which it can reach `duel+0x600`. Both of its call sites are inside
 *  the OPPONENT's own turn: `:29949` after the board-view hand-count push and
 *  before `F0x800A4978`, the AI's legality scan, and `:30688` at the Summon
 *  phase kickoff.
 *
 *  The sort is in place — it swaps two halfwords of the array, not a list of
 *  positions — so every later reader of `duel+0x6C8` sees class order: the draw
 *  that reads the head of the array at `:14502`-`:14504`, the AI's scans, and the
 *  hand row on screen. This is the member list the census test reads.
 *  — CARD-DUEL-VERIFIED.md §34 */
export const SORTED_HAND_ARRAYS = ["opponent"] as const;

/** The one ordering rule: ascending by the AI class byte, then by deck entry.
 *
 *  `F0x8009D8FC` compares the byte at `duel+0x35C + 4 * (index - 0x28)` — the
 *  raw AI class — and only on a tie the halfword at `+0x35E` of the same 4-byte
 *  record (`slt $a0, $a1, $a2` at `:27446`, then `bne $a2, $a1` at `:27449`).
 *  `index - 0x28` is `cardIndex - 40`, i.e. the opponent's own folder entry, and
 *  the +0x35E weight is a per-tier constant plus that entry number, so a tie
 *  reduces to deck order. Strictly less swaps (`:27454` `beqz $t2` skips the
 *  swap when neither test fires). The exchange sort is not stable, but no two
 *  entries share a key, so the order is fully determined.
 *
 *  `handClass` is that same +0x35C byte; the sort is written through it so the
 *  one table has one reader.
 *  — cardnpc-deck-entry-byte-03-is-the-ai-play-class-with-5-never-summoned,
 *    cardgame-ai-play-classes-split-program-cards-from-digimon */
/** The AI class of one authored deck entry. `handClass` is this through the
 *  hand's own slot table, which is what the +0x35C record is indexed by. */
function slotClass(s: DuelSide, slot: number): number {
  return slot < 0 ? 0 : (s.deckClass[slot] ?? 0);
}

/** True when authored deck entry `aSlot` sorts before `bSlot` on the disc's
 *  key: ascending AI class (`duel+0x35C + 4i`), then the `+0x35E` halfword,
 *  which is `weight(class) + i`, so on a class tie the lower entry number wins.
 *  `F0x8009D8FC` is an exchange sort that swaps on a STRICTLY smaller key
 *  (`slt $a0, $a1, $a2` at `cardgame.s:27446`; on a class tie, the `slt` in the
 *  delay slot at `:27449`). It is not stable, but no two entries share a key,
 *  so any correct sort on this key gives its order. */
function handOrderLess(s: DuelSide, aSlot: number, bSlot: number): boolean {
  const ca = slotClass(s, aSlot);
  const cb = slotClass(s, bSlot);
  if (ca !== cb) return ca < cb;
  return aSlot < bSlot;
}

/** `F0x8009D8FC` — sort one side's hand array in place, ascending.
 *
 *  An insertion sort; the disc uses an exchange sort, and the two agree because
 *  every key is unique (see `handOrderLess`). `handSlots` moves
 *  with `hand` because every positional reader resolves a card's AI class and
 *  folder entry through it. */
export function sortHandArray(s: DuelSide): void {
  for (let i = 1; i < s.hand.length; i++) {
    const id = s.hand[i]!;
    const slot = s.handSlots[i] ?? -1;
    let j = i;
    while (j > 0 && handOrderLess(s, slot, s.handSlots[j - 1] ?? -1)) {
      s.hand[j] = s.hand[j - 1]!;
      s.handSlots[j] = s.handSlots[j - 1] ?? -1;
      j--;
    }
    s.hand[j] = id;
    s.handSlots[j] = slot;
  }
}

/** Sort every hand array the decoded member list names. The one place a hand
 *  array gets reordered, so neither phase can grow its own idea of which sides
 *  the disc sorts. */
export function sortDuelHands(duel: DuelState): void {
  for (const which of SORTED_HAND_ARRAYS) {
    sortHandArray(which === "opponent" ? duel.opponent : duel.player);
  }
}

/** Hand slots in the order the AI considers them.
 *
 *  On the disc there is no list: `F0x8009D8FC` reorders the array and the AI
 *  then walks it front to back, so this now sorts in place and hands back the
 *  straight order. Every caller is on the opponent's side, and every key is
 *  unique, so a hand the disc has already sorted comes back unchanged.
 *  — CARD-DUEL-VERIFIED.md §34 */
export function aiHandOrder(s: DuelSide): number[] {
  sortHandArray(s);
  return s.hand.map((_, i) => i);
}

/** `F0x800A3934`, the AI's board scorer, installed at `duel+0x820`.
 *
 *  Its return is `sp88 + sp8C + var_a3 + var_s8`: the plain field sum of slot
 *  `+0x734` and `+0x736` — the **DISPLAYED** pair, not the true one — plus the
 *  combo runs counted a second time, with a further `0x14` on each once a run
 *  reaches four. That is exactly `comboBonus`.
 *
 *  Read 2026-08-25 from `exe-decomp/cardgame_c/F0x800a3934.c`. */
export function evaluateBoard(duel: DuelState, s: DuelSide): number {
  const bonus = comboBonus(comboRuns(duel, s));
  const plain = s.field.reduce((t, f) => t + f.shownAp + f.shownHp, 0);
  return plain + bonus.ap + bonus.hp;
}

/** The AI play classes `F0x800A4978` searches for, by phase and play count. */
export const AI_CLASS_LOAD = 1;
export const AI_CLASS_COMPILE = 3;
export const AI_CLASS_RESPONSE = 4;
/** The record `+0x03` kinds that invite a second class-3 answer. */
export const AI_ANSWERABLE_KINDS = [3, 9] as const;

/** The lowest `strengthRank` the AI will call a hand card worth playing:
 *  `F0x800A4328` starts its incumbent at 0x1F4 (500) and only accepts a card
 *  whose record `+0x08` is strictly below it. */
export const AI_WORTH_HAND_RANK = 500;

/** `F0x800A44F0` — the AI's own "is this card worth playing?" simulation.
 *
 *  Read 2026-09-14 from `exe-decomp/cardgame_c/_asm/F0x800a44f0.s` (authority
 *  2), correcting the card numbering used in the 2026-08-06 model doc: the
 *  switch is on `duel+0x50[instance]`, the **0-based** instance value the
 *  record reader adds 1 to, so a switch arm `n` is about the catalog card
 *  `n + 1`.
 *
 *  The function returns 1 by default, so most cards are always worth playing.
 *  Only these arms can decline:
 *
 *  | 0-based arm | catalog card | requires |
 *  |---|---|---|
 *  | 0x07,0x09,0x1A,0x37,0x39 | Control Parts, Eclipse Undo, Chaos Virus, Summon Cancel, Disturb Gear | a legal **foe** field target survives the pick/commit |
 *  | 0x15,0x2E | Fire Cannon, Break Launcher | a legal foe field target with **displayed HP <= 30** |
 *  | 0x38 | Berserk Energy | a legal foe field target with **displayed HP <= 10** |
 *  | 0x27 | Scramble Up | a legal **hand** target with `strengthRank < 500` |
 *  | 0x28 | Power Super Metal | a legal **own** field target survives the commit |
 *  | 0x03,0x0F,0x3A,0x3B | Protect Aura, Beast Energy, Protect Armor, Assault Armor | the AI's **own field is non-empty** (`duel+0x79E != 0`) |
 *  | anything else | — | nothing; always worth it |
 *
 *  `F0x800A3D90`/`F0x800A3E9C` are the pick/commit pair over the mark array the
 *  target gate set, so "survives the pick/commit" is exactly "has a legal
 *  target under the card's own targeting mask" here. */
export function aiWorthPlaying(
  duel: DuelState, s: DuelSide, id: number, eff: EffectRecord | undefined,
): boolean {
  const arm = id - 1;                       // duel+0x50 stores a 0-based value
  const foe = opposing(duel, s);
  const fieldOn = (side: DuelSide): FieldTarget[] =>
    eff
      ? fieldTargets(duel, s, eff.targeting).filter((t) => t.side === side)
      : side.field.map((_, slot) => ({ side, slot }));
  switch (arm) {
    // Own-field buffs: legal only while the AI has a Digimon out.
    case 0x03: case 0x0F: case 0x3A: case 0x3B:
      return s.field.length > 0;
    // Field control: a foe target must survive the best-target pick and commit.
    case 0x07: case 0x09: case 0x1A: case 0x37: case 0x39:
      return fieldOn(foe).length > 0;
    // Finish-off cards: 30 first, then the 10 the HP-10 card can take.
    case 0x15: case 0x2E:
      return fieldOn(foe).some((t) => (foe.field[t.slot]?.shownHp ?? Infinity) <= 30);
    case 0x38:
      return fieldOn(foe).some((t) => (foe.field[t.slot]?.shownHp ?? Infinity) <= 10);
    // A hand target the AI is willing to spend (rank below the 500 incumbent).
    case 0x27: {
      const owner = eff?.targeting.sides?.includes("own") ? s : foe;
      return handTargets(duel, owner).some((slot) => {
        const rec = duel.byId.get(owner.hand[slot] ?? -1);
        if (!rec) return false;
        if (eff?.targeting.kinds && !eff.targeting.kinds.includes(rec.kind)) return false;
        return strengthRank(rec) < AI_WORTH_HAND_RANK;
      });
    }
    // An own-field card that must land on something.
    case 0x28:
      return fieldOn(s).length > 0;
    default:
      return true;
  }
}

/** The opponent's policy, as far as it is decoded.
 *
 *  The hand is walked in AI-class order, and both of the overlay's choosers
 *  (F0x800a4328, misleadingly named aiPickCheapestHandCard in older research,
 *  and F0x8008c988) MINIMISE the CARDPAK +0x08 strength rank — which is
 *  ordered from the strongest card down, so the opponent reaches for its best
 *  card and never economises. That is why it needs a separate affordability
 *  gate at all: the chooser itself does not look at cost, so canSummon is a
 *  filter applied around the choice rather than a term inside it.
 *  — cardgame-cardpak-0x08-is-a-card-strength-rank-and-the-ai-plays-its-best
 *
 *  The per-class weights 400/300/500/200/600/100/700 at 0x800837a0 are
 *  functionally dead — same-class cards share a weight, so the tie-break always
 *  reduces to deck index — and are deliberately not implemented. */
export const discAgent: DuelAgent = {
  chooseStart: () => 0,
  /**
   * `F0x800A4978`, the AI's card-play scan. DECODED 2026-08-25; the walker used
   * to take the first merely-selectable slot.
   *
   * It switches on the turn's play count `+0x575` and the phase `+0x2F8`:
   *
   *   - **Load, first play** — look for a deck entry of AI class 1.
   *   - **Compile, first play** — class 3, but only after comparing board
   *     scores. `if (temp_s1 < temp_v0) return 0`, with `temp_s1` =
   *     `evaluateBoard(side 0)` and `temp_v0` = `evaluateBoard(side 1)`. Side 1
   *     is the AI, so **it declines to play when it is already ahead**.
   *   - **Answering, and the response list holds the card just played** —
   *     class 4. The list is CARD_NPC `+0xA0`.
   *   - **Answering a card whose record `+0x03` is 3 or 9** — class 3 again.
   *
   * Every candidate then passes the same three gates the scan uses:
   * `F0x80085F38` (usable in this phase), `F0x800A36E4` (has a legal target)
   * and `F0x800A44F0`, the AI's own worth-it simulation.
   *
   * `F0x800A44F0` IS MODELLED since 2026-09-14 (`aiWorthPlaying`), read from
   * its own assembly. It is a per-card verdict, not a damage comparison: most
   * cards pass with no test at all, and only fourteen can be declined (a
   * finish-off card that cannot kill, a self-buff with no own Digimon out, a
   * hand or own-field card with nothing to land on). The earlier note here
   * claimed its inputs were `F0x800A4440`/`F0x800A4494`; the assembly shows
   * those two are called only by the response-path simulator `F0x800A45F8`,
   * not by `F0x800A44F0`.
   */
  chooseProgram(duel, s, effects) {
    const mode = phase(duel).mode;
    const plays = duel.programTurns?.plays ?? 0;
    const legal = (i: number) => {
      const id = s.hand[i];
      if (id === undefined) return false;
      if (!handCardSelectable(duel, duel.byId.get(id))) return false;
      const eff = effects?.get(id);
      // the targeting gate, when the caller supplied the effect table
      if (eff && !canPlayProgram(duel, s, eff)) return false;
      // F0x800A44F0, the AI's own worth-it simulation
      return aiWorthPlaying(duel, s, id, eff);
    };
    const firstOfClass = (want: number) => {
      for (const i of aiHandOrder(s)) if (handClass(s, i) === want && legal(i)) return i;
      return -1;
    };

    if (plays === 0) {
      if (mode === 5) return firstOfClass(AI_CLASS_LOAD);
      // Compile: hold when already ahead on board score.
      if (evaluateBoard(duel, duel.player) < evaluateBoard(duel, duel.opponent)) return -1;
      return firstOfClass(AI_CLASS_COMPILE);
    }

    // Answering. What did the other side just play?
    const last = duel.playedThisPhase[duel.playedThisPhase.length - 1];
    if (last !== undefined && s.aiResponses.includes(last)) {
      const i = firstOfClass(AI_CLASS_RESPONSE);
      if (i >= 0) return i;
    }
    const kind = last === undefined ? undefined : duel.byId.get(last)?.programCategory;
    if (kind !== undefined && (AI_ANSWERABLE_KINDS as readonly number[]).includes(kind)) {
      return firstOfClass(AI_CLASS_COMPILE);
    }
    return -1;
  },
  chooseSummon(duel, s) {
    // Effect opcode 0x9D — the opponent's summon choice, and it does NOT
    // choose. F0x8008C5F0 is a single greedy pass: it walks the hand in
    // priority-sorted order and takes every entry that is still affordable
    // once the earlier ones have been paid for, until the field holds six.
    // Class 5 is held back and never summoned.
    //   — cardgame-ai-summons-greedily-until-field-full (partially_verified)
    //   — cardnpc-deck-entry-byte-03-is-the-ai-play-class-with-5-never-summoned
    //
    // CORRECTED 2026-08-24. This used to score the eligible set by
    // `strengthRank` and take the minimum — reaching for the best card first.
    // That is opcode 0xAA's rule (F0x8008C6E0, the HAND pick), not 0x9D's, and
    // it had been imported into the wrong job. The claim is explicit that the
    // summon pass has "no evaluation, no comparison against the player's board,
    // and no randomness".
    //
    // It matters whenever S-Energy is short. Both rules summon the same set
    // when everything is affordable; with a tight pool the disc pays for
    // whatever comes first in class-then-deck order, while ranking pays for the
    // strongest and can then afford a different, smaller set.
    //
    // The caller summons in a loop until this returns -1, and `summonFromHand`
    // spends the energy, so returning the FIRST eligible slot each time
    // reproduces the disc's single pass — affordability is re-tested against
    // what is left, exactly as the handler re-tests it per entry.
    for (const i of aiHandOrder(s)) {
      const id = s.hand[i]!;
      const rec = duel.byId.get(id);
      if (rec?.kind !== "digimon") continue;
      if (handClass(s, i) === AI_CLASS_NEVER_SUMMON) continue;
      if (!canSummon(duel, s, id)) continue;
      return i;
    }
    return -1;
  },
  chooseTarget: () => 0,
  /** DECODED 2026-08-08 — this is the disc's own rule, not a walker policy.
   *  The AI branch of opcode 0xAA calls F0x8008C6E0 in mode 0, which keeps the
   *  MAXIMUM strengthRank over the flagged slots. Low rank means strong, so the
   *  AI throws away its WEAKEST card. A tie goes to the later slot. See
   *  aiPickBySelectionRank for the assembly this mirrors.
   *
   *  The earlier note here guessed "the last card in its own play order" and
   *  warned the strongest-card routine must not be copied. Both halves are now
   *  superseded: the real routine IS rank-based, and the direction is simply
   *  the opposite one for a discard. */
  chooseHandDiscard(duel, s, slots) {
    return aiPickBySelectionRank(duel, s, slots, 0);
  },
};

/** Alias for callers that still name the old highest-AP stand-in. That policy
 *  is gone: it now resolves to discAgent. */
export const simpleAgent: DuelAgent = discAgent;

/** Kept for callers that only want a summon policy. */
export function greedyChoice(duel: DuelState, s: DuelSide): number {
  return discAgent.chooseSummon!(duel, s);
}

function normaliseAgents(
  a: DuelAgents | DuelAgent | ((duel: DuelState, s: DuelSide) => number) | undefined,
): DuelAgents {
  if (!a) return { player: discAgent, opponent: discAgent };
  if (typeof a === "function") {
    const wrapped: DuelAgent = { ...discAgent, chooseSummon: a };
    return { player: wrapped, opponent: wrapped };
  }
  if ("player" in a && "opponent" in a) return a as DuelAgents;
  return { player: a as DuelAgent, opponent: a as DuelAgent };
}

// ---------------------------------------------------------------------------
// The round driver
// ---------------------------------------------------------------------------

/** Order of play within a phase: the side that drew Calumon acts first. */
function turnOrder(duel: DuelState): DuelSide[] {
  return duel.firstPlayer === 0
    ? [duel.player, duel.opponent]
    : [duel.opponent, duel.player];
}

function agentFor(duel: DuelState, agents: DuelAgents, s: DuelSide): DuelAgent {
  return s === duel.player ? agents.player : agents.opponent;
}

/** Load and Compile share one routine in the original (both dispatch tables
 *  point modes 5 and 7 at F0x8009fdd8), so they share one here.
 *
 *  A TURN IS AN EXCHANGE, NOT A SINGLE ACTION.
 *  — `cardduel-load-compile-turn-rules-2026-08-21` (**verified**), §D.4 states
 *    1, 2/3, 0xA, 0xB, 0xC and 0xE.
 *
 *  State 1 dispatches on the turn's play count `duel+0x575`:
 *
 *      count 0 → the side selected by `duel+0x578` (the turn's lead)
 *      count 1 → the other side (the answer)
 *      count 2 → the lead again
 *      count > 2 → state 0xC, the resolve — three plays cap a turn
 *
 *  so one turn is up to three plays that ping-pong between the sides. State 0xA
 *  raises the count after each play; state 0xE then flips `+0x578`, raises the
 *  turn counter `+0x576` and ends the phase only when `+0x577` has reached 2.
 *
 *  ONLY AN EMPTY TURN IS A PASS. The pass branches of states 2 and 3 test the
 *  play count first: a side that declines with nothing played this turn loads
 *  the delay counter `+0x57C` with twenty ticks, plays packed sound 0x00040019
 *  (SYSTEM03, the shared window-open sound) and raises `+0x577`; a side that
 *  declines after a play has been made goes straight to the resolve and never
 *  touches `+0x577`. A phase in which both sides keep playing cannot end by
 *  passing at all — it ends when both stop having something to play.
 *
 *  THE TURN'S EFFECTS RESOLVE AT ITS END, NEWEST FIRST.
 *  — `cardduel-effects-resolve-after-the-turn-2026-08-21` for the batch. For
 *    the ORDER, which that claim leaves open, read 2026-08-25 out of
 *    ~/ddw3/asm/dw2003/pro/cardgame.s: the effect driver F0x800A2180 fetches
 *    the program of `history[+0x575 - 1]` (L32163-32172: `lb $v0, 0x575($s1)`,
 *    `addiu $v0, -0x1`, `lh $v0, 0x580($v0)`) — always the LAST play — and when
 *    that program ends it drops the count by one, or **by two when `+0x4dd` is
 *    set** (L32299-32304). `+0x4dd` has exactly one writer in the overlay: the
 *    update phase of effect opcode 0x41, the cancel (registry target
 *    0x800855a8), and the driver clears it before each program (L32124). So a
 *    card printed as a cancel resolves BEFORE the card it cancels and takes
 *    that card's program off the queue unrun.
 *
 *  `duel.programTurns` is null unless someone is driving the phase this way. */
export interface TurnPlay {
  /** who played it */
  side: DuelSide;
  /** the card, waiting in the played row until the turn resolves it */
  cardId: number;
}

export interface ProgramTurns {
  /** the two sides, the coin toss's side first */
  order: DuelSide[];
  /** `duel+0x578`: 0 while `order[0]` leads the turn, 1 after a flip */
  lead: number;
  /** `duel+0x575`: plays made this turn, 0..3 */
  plays: number;
  /** `duel+0x577`: consecutive turns in which nothing was played */
  passes: number;
  /** `duel+0x576`: turns taken this phase */
  turn: number;
  /** `duel+0x57C`: ticks left of a pass delay */
  passDelay: number;
  /** the turn's plays in the order they were made; resolved last-first */
  history: TurnPlay[];
  /** the play whose program is running, while it runs */
  resolving: TurnPlay | null;
  /** which beat the turn is on: taking plays, sitting out a pass, resolving */
  state: "play" | "pass" | "resolve";
  /** true once the phase is over (state 0xF) */
  done: boolean;
  /** a play whose program has not finished asking */
  pending: boolean;
}

/** State 0xB's counter: `+0x57C` is loaded with 0x14 and counted down one a
 *  frame before the turn moves on. */
export const PASS_DELAY_TICKS = 0x14;

export function beginProgramTurns(duel: DuelState): ProgramTurns {
  duel.playedThisPhase = [];
  // F0x8009D8FC, called at cardgame.s:29949 in the opponent's Program Phase
  // immediately before the AI's legality scan F0x800A4978. The array it sorts
  // is the opponent's hand, so the screen shows class order from here on.
  sortDuelHands(duel);
  const t: ProgramTurns = {
    order: turnOrder(duel),
    lead: 0,
    plays: 0,
    passes: 0,
    turn: 0,
    passDelay: 0,
    history: [],
    resolving: null,
    state: "play",
    done: false,
    pending: false,
  };
  duel.programTurns = t;
  return t;
}

/** Whose turn it is, or null when the phase is over, is resolving, is sitting
 *  out a pass delay, or is not being driven a turn at a time. */
export function programTurnSide(duel: DuelState): DuelSide | null {
  const t = duel.programTurns;
  if (!t || t.done || t.state !== "play") return null;
  // State 1: counts 0 and 2 go to the lead, count 1 to the other side.
  const answering = t.plays === 1 ? 1 : 0;
  return t.order[(t.lead + answering) % t.order.length] ?? null;
}

/** True while the turn's plays are resolving, so nothing may ask for a card. */
export function programTurnResolving(duel: DuelState): boolean {
  return duel.programTurns?.state === "resolve";
}

/** State 0xE. The turn is over: clear the play count and the history, flip the
 *  lead, raise the turn counter, and end the phase on the second empty turn. */
function nextProgramTurn(duel: DuelState): void {
  const t = duel.programTurns;
  if (!t) return;
  t.plays = 0;
  t.history = [];
  t.resolving = null;
  t.lead = (t.lead + 1) % t.order.length;
  t.turn += 1;
  t.state = "play";
  if (t.passes >= 2) t.done = true;
}

/** Give up the turn.
 *
 *  With nothing played this turn that is a pass: twenty ticks, the sound and
 *  the pass counter. With a play already made it is only the end of the turn —
 *  the plays resolve and `+0x577` is not touched. */
export function passProgramTurn(duel: DuelState, side: DuelSide): boolean {
  const t = duel.programTurns;
  if (!t || programTurnSide(duel) !== side) return false;
  if (t.plays === 0) {
    t.passes += 1;
    t.passDelay = PASS_DELAY_TICKS;
    t.state = "pass";
    return true;
  }
  t.state = "resolve";
  return true;
}

/** Count a pass delay down. A screen calls this once a frame; a driver without
 *  one passes the whole delay at once. */
export function tickProgramTurns(duel: DuelState, ticks = 1): void {
  const t = duel.programTurns;
  if (!t || t.state !== "pass") return;
  t.passDelay = Math.max(0, t.passDelay - ticks);
  if (t.passDelay === 0) nextProgramTurn(duel);
}

/** Play a card on this side's turn.
 *
 *  The card leaves the hand for the played row here — state 6 is what commits
 *  it — and its program does NOT run yet. State 1 then either hands the turn to
 *  the other side or, at the third play, sends the turn to the resolve. */
export function playProgramTurn(
  duel: DuelState,
  side: DuelSide,
  slot: number,
  effects: Map<number, EffectRecord>,
  _rng: () => number = Math.random,
  _opts: { interactive?: boolean } = {},
): boolean {
  const t = duel.programTurns;
  if (!t || programTurnSide(duel) !== side) return false;
  const id = side.hand[slot];
  if (id === undefined) return false;
  const rec = duel.byId.get(id);
  if (!rec || rec.kind !== "program") return false;
  const eff = effects.get(id);
  if (!canPlayProgram(duel, side, eff)) return false;
  takeFromHand(side, slot);
  duel.playedThisPhase.push(id);
  t.history.push({ side, cardId: id });
  duel.log.push(`${side.name}: ${rec.name}`);
  // State 1 clears the pass counter as soon as a play has been made.
  t.passes = 0;
  t.plays += 1;
  // State 1 again: a count above two is the three-play cap.
  t.state = t.plays > 2 ? "resolve" : "play";
  return true;
}

/** Send a played card to its owner's discard, which is where the turn leaves
 *  it. The disc's own mover for the cancelled case is F0x8008F790 — "the card
 *  flies out, lands in its owner's discard". */
function retirePlayedCard(duel: DuelState, play: TurnPlay): void {
  const at = duel.playedThisPhase.lastIndexOf(play.cardId);
  if (at >= 0) duel.playedThisPhase.splice(at, 1);
  play.side.trash.push(play.cardId);
}

/** Drive the turn's resolve, and its turn changes, as far as they will go
 *  without a question only the player can answer. */
export function pumpProgramTurns(
  duel: DuelState,
  effects: Map<number, EffectRecord>,
  rng: () => number = Math.random,
  human?: DuelSide | null,
): void {
  const t = duel.programTurns;
  if (!t) return;
  let guard = 0;
  while (guard++ < 8 * HAND_LIMIT) {
    if (awaitingCardChoice(duel)) return;
    if (t.state !== "resolve") return;
    if (t.resolving) {
      // The program that was running has finished.
      const done = t.resolving;
      t.resolving = null;
      if (duel.cancelPrevious) {
        // `+0x4dd`: the driver drops TWO history entries, so the play before
        // this one never runs its program at all.
        duel.cancelPrevious = false;
        const cancelled = t.history.pop();
        if (cancelled) {
          const rec = duel.byId.get(cancelled.cardId);
          duel.log.push(`${cancelled.side.name}: ${rec?.name ?? "card"} — cancelled`);
          retirePlayedCard(duel, cancelled);
        }
      }
      retirePlayedCard(duel, done);
      continue;
    }
    const play = t.history[t.history.length - 1];
    if (!play) { nextProgramTurn(duel); return; }
    t.resolving = play;
    t.history.pop();
    duel.cancelPrevious = false;                 // the driver's own clear
    const eff = effects.get(play.cardId);
    const interactive = !!human && play.side === human;
    const ran = applyProgramEffect(
      duel, play.side, play.cardId, eff, undefined, rng, { interactive },
    );
    if (!ran && !awaitingCardChoice(duel)) {
      // escardgm.toml has a line for this: "The card has no effect".
      const rec = duel.byId.get(play.cardId);
      if (rec) duel.log.push(`${play.side.name}: ${rec.name} — the card has no effect`);
    }
  }
}

/** Hand the turn on once the card that was played has finished asking. */
export function settleProgramTurn(
  duel: DuelState,
  effects?: Map<number, EffectRecord>,
  rng: () => number = Math.random,
  human?: DuelSide | null,
): void {
  const t = duel.programTurns;
  if (!t) return;
  if (awaitingCardChoice(duel)) return;
  t.pending = false;
  if (effects) pumpProgramTurns(duel, effects, rng, human);
}

/** Run every turn that belongs to a side playing for itself, stopping when the
 *  phase ends or `human`'s turn comes round.
 *
 *  `hold` keeps the twenty-tick pass delay for a caller that has a screen and a
 *  frame clock; a caller without one flushes it so the phase still advances. */
export function runProgramTurns(
  duel: DuelState,
  agents: DuelAgents,
  effects: Map<number, EffectRecord>,
  human: DuelSide | null,
  rng: () => number = Math.random,
  opts: { hold?: boolean } = {},
): void {
  let guard = 0;
  while (guard++ < 16 * HAND_LIMIT) {
    const t = duel.programTurns;
    if (!t || t.done) return;
    if (awaitingCardChoice(duel)) return;
    if (t.state === "resolve") {
      pumpProgramTurns(duel, effects, rng, human);
      if (awaitingCardChoice(duel)) return;
      continue;
    }
    if (t.state === "pass") {
      if (opts.hold) return;
      tickProgramTurns(duel, t.passDelay);
      continue;
    }
    const side = programTurnSide(duel);
    if (!side || side === human) return;
    const agent = agentFor(duel, agents, side);
    const slot = agent.chooseProgram ? agent.chooseProgram(duel, side, effects) : -1;
    if (slot < 0 || slot >= side.hand.length) { passProgramTurn(duel, side); continue; }
    if (!playProgramTurn(duel, side, slot, effects, rng)) passProgramTurn(duel, side);
  }
}

/** The phase with nobody watching: the same machine, both sides played by their
 *  agents. `stepPhase` takes this path when no screen is driving the turns. */
function programPhase(
  duel: DuelState,
  agents: DuelAgents,
  effects: Map<number, EffectRecord>,
  rng: () => number,
): void {
  beginProgramTurns(duel);
  runProgramTurns(duel, agents, effects, null, rng);
  duel.programTurns = null;
}

/** The Summon Phase: each side puts Digimon out until it stops, runs out of
 *  field slots or cannot pay. */
/**
 * The Summon Phase, played a turn at a time.
 *
 * WHY THIS EXISTS. `summonPhase` below resolves the whole phase in one call:
 * each side's agent is asked for slot after slot until it declines. For the
 * opponent that is right, but for the player it means the Summon Phase is not a
 * phase at all — the field just fills. Measured 2026-08-24: eight confirms took
 * the walker from the coin toss to the Compile Phase with five Digimon already
 * placed, and no Summon Phase was ever played.
 *
 * On the disc it is played. Mode 6 latches effect opcode 0x9A, whose enter
 * F0x80086D78 marks every hand entry usable or not and opens the card browser
 * over your hand, and the phase's own on-screen legend is escardgm 0x24:
 *
 *        "[cross] Select [square] Summon"
 *
 * so cross moves the selection and SQUARE is what places a Digimon. You summon
 * as many as you can afford and the field will hold, then the turn passes.
 *
 * Unlike the Load and Compile phases this is NOT a two-pass negotiation: the
 * side keeps the turn until it says it is done, which is the shape `summonPhase`
 * already had and which this preserves.
 */
export interface SummonTurns {
  /** the two sides, in this set's turn order */
  order: DuelSide[];
  /** whose turn it is, an index into `order` */
  turn: number;
  /** true once both sides have finished */
  done: boolean;
  /** F0x80087458: hand-slot marks and their already-paid energy, for this turn. */
  marks?: Set<number>;
  /** The per-side commit runs once, after the picker returns. */
  committed?: boolean;
}

export function beginSummonTurns(duel: DuelState): SummonTurns {
  // The second of the two F0x8009D8FC call sites, cardgame.s:30688, at the
  // Summon Phase kickoff. Same array, same order, run once per phase.
  sortDuelHands(duel);
  const t: SummonTurns = { order: turnOrder(duel), turn: 0, done: false };
  duel.summonTurns = t;
  return t;
}

/** Whose turn it is, or null when the phase is over or is not being driven. */
export function summonTurnSide(duel: DuelState): DuelSide | null {
  const t = duel.summonTurns;
  if (!t || t.done) return null;
  return t.order[t.turn] ?? null;
}

/** Place one Digimon. The turn does NOT pass — you may summon again. */
export function takeSummonTurn(duel: DuelState, side: DuelSide, slot: number): boolean {
  const t = duel.summonTurns;
  if (!t || summonTurnSide(duel) !== side) return false;
  if (!summonFromHand(duel, side, slot)) return false;
  recomputeTotals(side);
  return true;
}

/** F0x80087458 / F0x8008735C: toggle a hand mark, paying or refunding now.
 * Returns 0 for refusal, 1 for a new mark, and 2 for an unmark. The refund
 * precedes affordability checks: an already-paid card can always be unmarked.
 * CARD-DUEL-VERIFIED.md §25; selection capacity is six marks, independent of
 * the old field that F0x800A0754 will replace. */
export function toggleSummonMark(duel: DuelState, side: DuelSide, slot: number): 0 | 1 | 2 {
  const t = duel.summonTurns;
  if (!t || t.committed || summonTurnSide(duel) !== side || !Number.isInteger(slot)) return 0;
  const id = side.hand[slot];
  const rec = id === undefined ? undefined : duel.byId.get(id);
  if (!rec || rec.kind !== "digimon") return 0;
  const marks = t.marks ??= new Set<number>();
  const ei = energyIndex(rec.colour);
  if (marks.has(slot)) {
    if (ei >= 0) side.energy[ENERGY_COLOURS[ei]!] += summonCost(rec);
    marks.delete(slot);
    return 2;
  }
  if (marks.size >= FIELD_LIMIT) return 0;
  if (ei >= 0 && side.energy[ENERGY_COLOURS[ei]!] < summonCost(rec)) return 0;
  payEnergy(duel, side, id!);
  marks.add(slot);
  return 1;
}

/** Place every MARKED hand entry at once — the disc's commit.
 *
 * The Summon Phase is a mark-set, not a single cursor: F0x80086D78 opens the
 * browser, F0x800878B4 (`pickerPadPickSeveral`) toggles marks, Square raises
 * "Put in Field?", and the commit (F0x800A0754, duel method +0x818) walks the
 * marked entries.
 *
 * F0x800A0754 is a REBUILD, not an append. Read from the decompiled C: it
 * stores `*fieldCount = 0` at `+0x72C`, then walks the hand's marked `+0x46F`
 * entries in ascending slot order, calling F0x800A0708 to place each while the
 * count is under the running mark count `+0x444` (capped at six — §17 item 7 of
 * CARD-DUEL-VERIFIED.md), and finally compacts the hand with F0x800A0590. A
 * card on the field that is not among the marks is therefore dropped; the
 * Summon Phase resolver (F0x800A0B80) calls it once per side (F0x800A0BE8 for
 * side 0, F0x800A0C38 for side 1), so the rebuild begins from the fresh round
 * field. The old code appended and never zeroed — C9 of the fix list.
 *
 * Placement walks the original hand order. Only afterwards does F0x800A0590
 * compact the hand; removing from the end here preserves that same result.
 * Costs were paid by the mark toggle, and must not be charged again.
 *
 * Observed live, agent-driven, PAL, 2026-09-12: two marked Rookies committed
 * with Square put both on the field (capture
 * docs/research/card/captures/cardduel-entry-2026-09-12.md). */
export function commitMarkedSummons(duel: DuelState, side: DuelSide): number {
  const t = duel.summonTurns;
  if (!t || t.committed || summonTurnSide(duel) !== side) return 0;
  // F0x800A0754: `*fieldCount = 0` before the placement loop.
  side.field = [];
  const slots = [...(t.marks ?? [])].sort((a, b) => a - b);
  let placed = 0;
  for (const slot of slots) {
    const id = side.hand[slot];
    if (id !== undefined && putOnField(duel, side, id)) placed += 1;
  }
  for (let i = slots.length - 1; i >= 0; i--) takeFromHand(side, slots[i]!);
  t.marks?.clear();
  t.committed = true;
  recomputeTotals(side);
  return placed;
}

/** Batch adapter for callers that already chose hand slots. Uses the same
 * reserve/refund/commit path as the interactive picker, in hand order. */
export function commitSummons(duel: DuelState, side: DuelSide, slots: readonly number[]): number {
  const t = duel.summonTurns;
  if (!t || t.committed || summonTurnSide(duel) !== side) return 0;
  const wanted = new Set(slots.filter((slot) => Number.isInteger(slot) && slot >= 0 && slot < side.hand.length));
  for (const slot of [...(t.marks ?? [])]) {
    if (!wanted.has(slot)) toggleSummonMark(duel, side, slot);
  }
  for (const slot of [...wanted].sort((a, b) => a - b)) {
    if (!t.marks?.has(slot)) toggleSummonMark(duel, side, slot);
  }
  return commitMarkedSummons(duel, side);
}

/** Done summoning. The turn moves on; after the last side the phase is over. */
export function endSummonTurn(duel: DuelState, side: DuelSide): boolean {
  const t = duel.summonTurns;
  if (!t || summonTurnSide(duel) !== side) return false;
  recomputeTotals(side);
  // A caller ending an uncommitted picker releases its reservations. Normal
  // confirmation has already consumed the marks in commitMarkedSummons.
  for (const slot of [...(t.marks ?? [])]) toggleSummonMark(duel, side, slot);
  delete t.marks;
  t.committed = false;
  t.turn += 1;
  if (t.turn >= t.order.length) t.done = true;
  return true;
}

/** True when this side has a Digimon it could still place. */
export function canSummonAny(duel: DuelState, side: DuelSide): boolean {
  if (side.field.length >= FIELD_LIMIT) return false;
  return side.hand.some((id) => id != null && canSummon(duel, side, id));
}

/** Run every turn that belongs to a side playing for itself, stopping when the
 *  phase ends or `human`'s turn comes round. */
export function runSummonTurns(
  duel: DuelState,
  agents: DuelAgents,
  human: DuelSide,
): void {
  let guard = 0;
  while (guard++ < 4 * HAND_LIMIT) {
    const side = summonTurnSide(duel);
    if (!side || side === human) return;
    const agent = agentFor(duel, agents, side);
    const slot = agent.chooseSummon ? agent.chooseSummon(duel, side) : -1;
    if (slot < 0 || slot >= side.hand.length || !takeSummonTurn(duel, side, slot)) {
      endSummonTurn(duel, side);
    }
  }
}

/** `0x9A` — the summon browser opens over each side's hand, in turn order. */
export function summonOpen(duel: DuelState): DuelSide[] {
  return turnOrder(duel);
}

/** `0x9D` — auto-pick the affordable summons: each side places until it
 *  declines, runs out of field slots or cannot pay. */
export function summonAutoPick(duel: DuelState, agents: DuelAgents, order: DuelSide[]): void {
  for (const s of order) {
    const agent = agentFor(duel, agents, s);
    let guard = 0;
    while (s.field.length < FIELD_LIMIT && guard++ < HAND_LIMIT) {
      const slot = agent.chooseSummon ? agent.chooseSummon(duel, s) : -1;
      if (slot < 0 || slot >= s.hand.length) break;
      if (!summonFromHand(duel, s, slot)) break;
    }
    recomputeTotals(s);
  }
}

/** `0x9E` — the board sweep that settles the phase: the five dynamic Megas
 *  recompute. It runs after BOTH sides have placed, because two of the five
 *  formulas count the other side's board and trash. */
export function summonSweep(duel: DuelState): void {
  applyDynamicStatMegas(duel);
}

function summonPhase(duel: DuelState, agents: DuelAgents): void {
  summonAutoPick(duel, agents, summonOpen(duel));
  summonSweep(duel);
}

/**
 * Advance one phase.
 *
 * `agents` may be a {player, opponent} pair, a single agent used for both, or —
 * for older callers — a bare summon chooser function.
 */
export function stepPhase(
  duel: DuelState,
  agents?: DuelAgents | DuelAgent | ((duel: DuelState, s: DuelSide) => number),
  rng: () => number = Math.random,
  effects: Map<number, EffectRecord> = new Map(),
): void {
  if (duel.outcome) return;
  const a = normaliseAgents(agents);
  const p = phase(duel);

  // The disc announces the phase and then latches its ceremony opcodes before
  // the phase does any work — the banner is queued by the phase and put up by
  // the interpreter. Issue it once per phase entry: `load`, `compile` and
  // `summon` re-enter this function on every turn when something is driving
  // them a turn at a time, and the ceremony belongs to the phase, not the turn.
  duel.ceremonyPhaseKey = p.key;
  const stream = p.key === "battle" ? battleCeremony(duel) : PHASE_CEREMONY[p.key];
  const token = duel.set * DUEL_PHASES.length + duel.phaseIndex;
  if (duel.ceremonyToken !== token) {
    duel.ceremonyToken = token;
    issueCeremony(duel, p.key, stream);
  }

  // The phase is now DRIVEN by the opcodes it issues, in the captured order.
  // Every phase body below lives in `applyCeremonyOp`; nothing does the work
  // twice, because there is no other implementation left to do it.
  const run: CeremonyRun = {
    agents: a, rng, effects, phase: p,
    battle: null, summonOrder: null,
    began: false, resumed: false, parked: false, ended: false,
  };
  // The BANNER is applied too, not just listed. The Battle Phase's banner is
  // where the board is taken (see case 0xA5), so a drain that skipped it would
  // reach the attack with no combos scored -- which is exactly what it did
  // until 2026-08-28.
  for (const op of [BANNER_OPCODE[p.key], ...stream]) {
    applyCeremonyOp(duel, op, run);
    if (run.parked || run.ended) break;
  }
  if (run.parked || run.ended) return;

  // Battle-Phase states 0xA and 0xB latch no opcode, so they are settled here.
  // State 0x12's sweep IS one, and it goes on the same beat path this function
  // runs every other opcode through, so both drivers latch the same stream —
  // `cardgame.s:31444-31454` writes 0x1C or 0x1D into duel+0x421 whatever is
  // driving. State 0x11 gets there first and decides the duel, so no sweep is
  // latched for a duel that has ended.
  if (p.key === "battle") {
    battleSettleSet(duel, run.battle);
    if (duel.player.score >= SETS_TO_WIN || duel.opponent.score >= SETS_TO_WIN) {
      finishDuel(duel);
      run.ended = true;
    } else if (duel.setAward !== null) {
      const sweep = duel.setAward === 0 ? 0x1c : 0x1d;
      latch(duel, p.key, sweep);
      applyCeremonyOp(duel, sweep, run);
    }
  }

  duel.phaseIndex = (duel.phaseIndex + 1) % DUEL_PHASES.length;
}

/**
 * Advance the duel by ONE FRAME.
 *
 * WHY THIS EXISTS. `stepPhase` runs a whole phase per call, which is the one
 * thing about our duel that could never look like the disc's: on the disc a
 * single beat OWNS the frame while it plays out — the banner holds, the coin
 * toss turns over, the board sweep runs — and the duel advances only when that
 * beat's own timer expires. Nothing in our duel owned a frame, so the pacing
 * was structurally unreproducible however correct the logic was.
 *
 * This is the same implementation, drained differently. `applyCeremonyOp` is
 * still the only place a phase's work happens; `stepPhase` drains the phase's
 * beats immediately and this drains them one beat at a time, each holding the
 * screen for the frames measured off the disc (`BEAT_FRAMES`). There is no
 * second duel in here.
 *
 * A beat that waits on the player (`beatIsInputGated`) holds the frame until
 * whoever is driving answers it, exactly as a prompt does on the disc.
 */
export function tickDuel(
  duel: DuelState,
  agents?: DuelAgents | DuelAgent | ((duel: DuelState, s: DuelSide) => number),
  rng: () => number = Math.random,
  effects: Map<number, EffectRecord> = new Map(),
): void {
  if (duel.outcome) return;
  const b = duel.beat;

  // A beat that already owns the frame keeps it until its timer runs out.
  if (b.current !== null) {
    if (b.hold > 0) { b.hold -= 1; return; }
    if (b.gated) return;
    b.current = null;
  }

  // A card program's own steps play out before the phase moves on, and they
  // only animate: the interpreter already applied them. See `replay`.
  if (b.replay.length) {
    const shown = b.replay.shift()!;
    b.current = shown;
    b.hold = beatFrames(shown);
    b.gated = false;
    return;
  }

  const p = phase(duel);
  duel.ceremonyPhaseKey = p.key;

  // Out of beats: announce the phase and queue its ceremony. The lane is filled
  // ONCE per phase — the token is the phase's own — and the phase moves on at
  // the bottom of this function when its last beat has been issued. A lane that
  // is empty with the token already spent is a phase whose beats are all issued
  // and whose index has not moved yet, which happens only while the Battle
  // Phase's banner is still up: that wait is states 0x03 to 0x05
  // (`cardgame.s:31045-31096`) and nothing is issued again until the player
  // takes the banner down. Re-filling the lane here instead would put the
  // banner up a second time and wait for the player twice.
  if (!b.pending.length) {
    const token = duel.set * DUEL_PHASES.length + duel.phaseIndex;
    if (duel.ceremonyToken === token) {
      // Every beat this phase issues is issued, and the lane is empty. The
      // phase settles and moves on — unless the beat it ended on is still
      // waiting for a button, which is states 0x03 to 0x05 waiting for the
      // Battle banner (`cardgame.s:31045-31096`). The banner has to come down
      // first: the attack that decides the set runs after it, and if the award
      // landed on the banner's own frame the award's windows would take the
      // presses meant for the banner and each would wait for the other.
      if (b.gated) return;
      endDuelPhase(duel, b, p);
      return;
    }
    const stream = p.key === "battle" ? battleCeremony(duel) : PHASE_CEREMONY[p.key];
    duel.ceremonyToken = token;
    issueCeremony(duel, p.key, stream);
    b.pending = [BANNER_OPCODE[p.key], ...stream];
    b.phaseKey = p.key;
  }

  const op = b.pending.shift()!;
  const run: CeremonyRun = {
    agents: normaliseAgents(agents), rng, effects, phase: p,
    battle: b.battle, summonOrder: b.summonOrder,
    began: b.began, resumed: b.resumed, parked: false, ended: false,
  };
  applyCeremonyOp(duel, op, run);
  // The walk and the turn flags outlive the beat that set them.
  b.battle = run.battle;
  b.summonOrder = run.summonOrder;
  b.began = run.began;
  b.resumed = run.resumed;

  if (run.ended) { b.pending = []; b.current = null; b.gated = false; return; }
  if (run.parked) {
    // Whoever is driving this phase a turn at a time has not finished. Put the
    // beat back and retry it next frame — the same thing `stepPhase` does by
    // returning without advancing. `beatIsInputGated` describes the DISC; on
    // our side a beat waits only when a real driver has not answered, which is
    // what parking means. Under agents nothing waits, so the prompts pass
    // straight through.
    b.pending.unshift(op);
    b.current = null;
    b.gated = false;
    return;
  }

  b.current = op;
  b.serial = (b.serial ?? 0) + 1;
  b.hold = beatFrames(op);
  b.gated = false;

  // A banner does not run a timer: its update polls the pad and advances on
  // Circle or Cross with no timeout, so it holds the frame until whoever is
  // playing presses. See `BEAT_WAITS_FOR_BUTTON`. A headless duel has nobody to
  // press, so it keeps the measured hold instead of stopping forever.
  if (duel.human !== null && beatWaitsForButton(op)) {
    b.hold = 0;
    b.gated = true;
  }

  // The phase is over once its last beat has been issued — and not before that
  // beat has been taken down, which is the same wait as above.
  if (!b.pending.length) {
    if (b.gated) return;
    endDuelPhase(duel, b, p);
  }
}

/**
 * `tickDuel`'s phase hand-over, and — for the Battle Phase — the two states
 * that latch no opcode at all.
 *
 *  States 0xA and 0xB are settled as the phase's own beats run out, which is
 *  the same place the disc's state 9 falls through to state 0xA.
 */
function endDuelPhase(duel: DuelState, b: DuelBeatQueue, p: { readonly key: DuelPhaseKey }): void {
    // Battle-Phase states 0xA and 0xB latch no opcode, so they are settled as
    // the phase's own beats run out — the same place the disc's state 9 falls
    // through to state 0xA. State 0x12 is then queued, and only when the duel
    // survives the set, because only state 0x11's fall-through reaches it. It
    // goes on the ordinary pending lane, so the screen plays the winner's board
    // emptying through the same `beatStarted` case it always used — and because
    // a screen holds the lane while the result windows are up, it cannot land
    // before the player has read them.
    if (p.key === "battle") {
      battleSettleSet(duel, b.battle);
      if (duel.player.score >= SETS_TO_WIN || duel.opponent.score >= SETS_TO_WIN) {
        // State 0x11 is the duel-over test, and it writes the outcome byte
        // `duel+0x302` as it goes: 0 on the >= 2 arm at `cardgame.s:31418-31421`
        // (which also plays the win sound) and 1 on the mirrored arm at
        // `:31437-31441`. Its fall-through — the delay slot's `li $v0, 0x12` at
        // `:31426` — is the ONLY path that reaches state 0x12, so a duel that
        // survives the set never latches 0x1C / 0x1D. Here that is
        // `finishDuel` instead, and no sweep is queued.
        finishDuel(duel);
      } else if (duel.setAward !== null) {
        // State 0x12, aimed at one side: 0x1C at side 0 when you took the set,
        // 0x1D at side 1 when the opponent did (`cardgame.s:31444-31451`, where
        // the delay slot's 0x1D is overridden by the fall-through's 0x1C).
        const sweep = duel.setAward === 0 ? 0x1c : 0x1d;
        latch(duel, p.key, sweep);
        b.pending.push(sweep);
      }
    }
    // State 0x12's sweep is the LAST thing the Battle Phase does — it goes
    // straight to state 0x1A, the machine's return (`cardgame.s:31452-31454`) —
    // so the next set's phases must not begin until that beat has been issued.
    // The pending lane now holds it, so the phase is held here and moves on once
    // the beat has run, which is the order `stepPhase` settles it in too.
    if (b.pending.length) return;
    duel.phaseIndex = (duel.phaseIndex + 1) % DUEL_PHASES.length;
    b.began = false;
    b.resumed = false;
    b.battle = null;
    b.summonOrder = null;
}


/** Frames remaining before the duel will accept the next beat — what a screen
 *  would use to know the board is busy. */
export const duelBeatBusy = (duel: DuelState): boolean =>
  duel.beat.current !== null && (duel.beat.hold > 0 || duel.beat.gated);

/** True while a beat is waiting for the player to press Circle or Cross. */
export const duelBeatAwaitsButton = (duel: DuelState): boolean =>
  duel.beat.current !== null && duel.beat.gated && beatWaitsForButton(duel.beat.current);

/** The press. Releases a beat that is waiting on the pad — the disc's step 2.
 *
 *  Returns true when a beat was actually released, so a screen can tell a press
 *  that dismissed a banner from one that has to fall through to the phase. */
export function dismissBeat(duel: DuelState): boolean {
  if (!duelBeatAwaitsButton(duel)) return false;
  duel.beat.gated = false;
  duel.beat.hold = 0;
  return true;
}

/** State carried from one ceremony opcode to the next inside a single phase —
 *  the disc keeps the equivalent in the duel object's own accumulators. */
interface CeremonyRun {
  agents: DuelAgents;
  rng: () => number;
  effects: Map<number, EffectRecord>;
  phase: (typeof DUEL_PHASES)[number];
  battle: BattleWalk | null;
  summonOrder: DuelSide[] | null;
  /** this call opened the phase's turns */
  began: boolean;
  /** this call found a turn-driven phase already finished */
  resumed: boolean;
  /** the phase is waiting on whoever is driving it; do not advance */
  parked: boolean;
  /** the duel ended inside this phase */
  ended: boolean;
}

/** Carry out one ceremony opcode. This is the duel's phase implementation:
 *  `stepPhase` issues the stream and this performs it, exactly as the disc
 *  latches `duel+0x421` and lets the interpreter carry it out. */
function applyCeremonyOp(duel: DuelState, op: number, run: CeremonyRun): void {
  const { agents: a, rng, effects, phase: p } = run;
  switch (op) {
    // ---- the six phase announcements, 0xA0..0xA5 -------------------------
    case 0xa0:
      // Only the set banner reaches the log today; the other five announce
      // without a log line, which is what the walker already did.
      duel.log.push(`Set ${duel.set}: ${p.banner}`);
      return;
    case 0xa1: case 0xa2: case 0xa3: case 0xa4:
      return;
    case 0xa5:
      // The reveal queue was read when this phase's stream was built, so clear
      // it here: the beats now carry it and a second Battle Phase must not
      // re-issue them.
      duel.revealBeats = 0;
      // THE BATTLE PHASE'S BOARD IS TAKEN HERE, not on 0x19.
      //
      // On the disc the combo announcements are pure presentation: the machine
      // scans a side, and for EACH run it finds it latches a beat and comes
      // back for the next (`cardgame.s:30960-30968` for side 0's 0x19,
      // `:30974-30978` for side 1's 0x1A). The scan can find none, in which
      // case no beat is issued at all — so a rule hung on 0x19 would simply not
      // run. The board is taken once, when the phase opens.
      run.battle = battleOpen(duel);
      duel.combos = run.battle.combos;
      for (const [who, runs] of
           [["You", run.battle.combos.player], [duel.opponent.name, run.battle.combos.opponent]] as const) {
        for (const r of runs) {
          const into = duel.byId.get(r.into)?.name ?? `#${r.into}`;
          duel.log.push(`${who}: combo x${r.count} -> ${into}`);
        }
      }
      return;

    // ---- Start ----------------------------------------------------------
    case 0xa7: {
      // ONE shuffle, of the player's pile only. `SHUFFLED_PILES` is the decoded
      // member list: duel method +0x810 hardcodes the side-0 block as its array
      // base (`cardgame.s:28916`), so nothing the disc does can mix the
      // opponent's forty cards. Before 2026-10-05 this line also shuffled the
      // opponent, which gave the opponent a deck order the disc never produces.
      shuffleDuelPiles(duel, rng);
      // Two face-down cards, Calumon and Impmon; drawing Calumon means acting
      // first. The walker lets the player pick a side of the coin and settles
      // it with the RNG when the agent expresses no preference.
      //
      // CORRECTED 2026-08-24, reversing a change made earlier the SAME DAY that
      // was wrong. The toss is re-run at the start of EVERY set.
      //
      // Mode 3 is the coin toss, not mode 2. The mode dispatcher F0x800A1B48
      // sends mode 2 to the folder chooser F0x8009F110 and mode 3 to
      // F0x8009F8C0, and F0x8009F8C0 is the ceremony: on its first pass it
      // latches effect opcode 0xA7 and on its second it derives the turn seed
      // duel+0x2F5 from the result. The mode-transition table at 0x800A5D5C,
      // four bytes per entry indexed by the PREVIOUS mode, sends BOTH mode 8
      // (the Battle Phase) and mode 9 (the set change) to next mode 3. So the
      // loop is 1 2 3 4 5 6 7 8 3 4 ... and the ceremony re-runs each set —
      // the dispatcher clears the sub-state on entry, so nothing suppresses it.
      //
      // A previous revision made this once-per-duel on the strength of a
      // divergence-queue note that placed the Calumon draw in mode 2. That note
      // was wrong about the mode, and the conclusion drawn from it inverted the
      // truth: re-rolling every set is what the disc does.
      const want = a.player.chooseStart ? a.player.chooseStart(duel, duel.player) : 0;
      const gotCalumon = rng() < 0.5;
      // Drawing Calumon means you act first. Traced end to end: the ceremony
      // sets duel+0x440 to 1 only when your pick matches the random bit, and
      // that bit indexes the card holding the OTHER face, so a Calumon pick
      // leaves +0x440 at 0; mode 3 then writes seed 0; the play machine's reset
      // copies the seed into the turn registers; and seed 0 is side 0, which is
      // the player.
      duel.coinToss = (want === 0 ? (gotCalumon ? 0 : 1) : (gotCalumon ? 1 : 0)) as 0 | 1;
      duel.firstPlayer = duel.coinToss;
      duel.combos = { player: [], opponent: [] };
      duel.log.push(duel.firstPlayer === 0 ? "You go first." : "Opponent goes first.");
      return;
    }

    // ---- Draw -----------------------------------------------------------
    case 0x14: {
      let okP = true;
      let okO = true;
      for (let i = 0; i < DRAW_COUNT; i++) {
        if (!drawOne(duel, duel.player)) { okP = false; break; }
      }
      for (let i = 0; i < DRAW_COUNT; i++) {
        if (!drawOne(duel, duel.opponent)) { okO = false; break; }
      }
      if (!okP || !okO) {
        // escardgm.toml: "You cannot draw 6 cards, so you lose this set." and
        // its mirror. F0x8009f910 turns the result code +0x440 into 2 (the
        // player loses) or 3 (the player wins) and the mode-4 handler reports
        // the duel finished in both cases, so this ends the whole duel.
        duel.log.push(okP
          ? "Your opponent can't draw 6 cards, so you win this set."
          : "You cannot draw 6 cards, so you lose this set.");
        if (!okP) duel.opponent.score = SETS_TO_WIN;
        else duel.player.score = SETS_TO_WIN;
        finishDuel(duel);
        run.ended = true;
      }
      return;
    }

    // ---- Load and Compile: the play negotiation -------------------------
    case 0x98: {
      // The two-answer box. When something is driving the phase a turn at a
      // time, this is where the phase waits for it.
      const t = duel.programTurns;
      if (t) {
        if (!t.done) { run.parked = true; return; }
        run.resumed = true;
        return;
      }
      beginProgramTurns(duel);
      run.began = true;
      return;
    }
    case 0x99:
      // The hand selector, and the plays it produces. When a screen is driving
      // a side, the turns it opened above are its to take: the beat waits here
      // instead of letting the agent play them out.
      if (duel.human !== null) {
        if (duel.programTurns && !duel.programTurns.done) { run.parked = true; return; }
        return;
      }
      if (run.began) runProgramTurns(duel, a, effects, null, rng);
      return;
    case 0x12:
      // Clear the played row at the end of the turn.
      if (run.began || run.resumed) duel.programTurns = null;
      return;

    // ---- Summon ---------------------------------------------------------
    case 0x9a: {
      const t = duel.summonTurns;
      if (t) {
        if (!t.done) { run.parked = true; return; }
        duel.summonTurns = null;
        run.resumed = true;
        return;
      }
      if (duel.human !== null) {
        // Played, the phase is a sequence of turns rather than an auto-fill:
        // 0x9A's enter (F0x80086D78) marks every hand entry usable or not and
        // opens the browser over the hand, and the phase does not move on until
        // both sides have finished placing. So it opens the turns and waits;
        // 0x9D, the auto-pick, is skipped and 0x9E still sweeps.
        beginSummonTurns(duel);
        run.parked = true;
        return;
      }
      run.summonOrder = summonOpen(duel);
      run.began = true;
      return;
    }
    case 0x9d:
      if (run.began && run.summonOrder) summonAutoPick(duel, a, run.summonOrder);
      return;
    case 0x9e:
      // The board sweep settles the phase for BOTH entry paths — the turn-driven
      // one reaches the end of the phase here too.
      if (run.began || run.resumed) summonSweep(duel);
      return;

    // ---- Battle ---------------------------------------------------------
    // 0x19, 0x1A and 0x1B are SCREEN BEATS. The board was taken on the phase
    // banner; these only put what happened on screen, one beat per thing.
    case 0x19: case 0x1a:
      return;
    case 0x1b:
      // THE CARD REVEAL. Its update ramps both sides' shown AP and HP toward
      // each other over fifteen frames and then exchanges the stored totals --
      // AP between the two SIDES and HP between the two SIDES, never a side's
      // own AP with its own HP. The screen drives the ramp; the exchange is
      // the rule, and it belongs to each beat rather than to the phase.
      exchangeTotals(duel);
      return;
    case 0x15:
      // The combo fold still happens here, ahead of the first drain. WHERE the
      // disc folds a combo bonus into the totals is NOT established — 0x15 is a
      // drain there, so it is somewhere earlier, most likely the battle open or
      // the reveal beat. Running it on the first drain beat is equivalent for
      // the result and is the smallest assumption; it is not a decoded claim.
      if (run.battle) { battleTotals(duel, run.battle); battleDrainSide(duel, run.battle, 0); }
      return;
    case 0x16: {
      const w = run.battle;
      if (!w) return;
      battleDrainSide(duel, w, 1);

// Both drains are done, so the exchange is settled and the disc's battle
      // machine now compares the two sides' field HP. State 0x0A fixes
      // `duel+0x301` and latches 0x18 or 0x17 — the same routine aimed at each
      // side, one card at a time from the last slot back — for the LOSER's
      // board. It only reaches state 0x0A when the loser still has something
      // standing: state 9 tests the per-side byte at `duel+0x72C` for the side
      // that won and the same byte for the other, and goes to 0x0A only when the
      // first is zero and the second is not (`cardgame.s:31015-31031`). The
      // walker is already here, so it makes that test where it has the board.
      battleTransfer(duel, w);
      duel.log.push(
        `${p.banner}: ${w.playerAp}/${w.playerHp} vs ${w.opponentAp}/${w.opponentHp}` +
        ` -> ${w.playerLeft} vs ${w.opponentLeft}`,
      );
      battleAward(duel, w);
      const loser = w.winner === 0 ? duel.opponent : duel.player;
      // Which of the pair is shown cannot be known when the phase is announced,
      // so it is latched here rather than listed in PHASE_CEREMONY.
      if (!loser.field.length) return;
      latchDynamic(duel, w.winner === 0 ? 0x18 : 0x17);
      for (const f of loser.field) loser.trash.push(f.id);
      loser.field = [];
      recomputeTotals(loser);
      return;
    }
    // 0x1C / 0x1D — state 0x12. Latched by the beat lane only when the duel
    // survives the set, so a screen plays it after the result windows are down;
    // `stepPhase` latches the same opcode here at the same point, and
    // `resolveBattle` calls `battleSweepWinner` directly.
    case 0x1c: case 0x1d:
      battleSweepWinner(duel, rng);
      return;
  }
}

function finishDuel(duel: DuelState): void {
  duel.outcome = duel.player.score > duel.opponent.score ? "win" : "loss";
  duel.log.push(duel.outcome === "win" ? "You won this battle!" : "You lost this battle!");
}
