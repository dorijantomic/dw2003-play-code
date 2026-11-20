import { type DuelState, phase } from "./duel-state.ts";

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
