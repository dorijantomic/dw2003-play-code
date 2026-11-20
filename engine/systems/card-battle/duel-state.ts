import type { EffectVm } from "../card-effect-vm.ts";
import type { CeremonyBeat } from "../card-ceremony.ts";
import {
  type CardCatalog,
  type CardRecord,
  DUEL_PHASES,
  type DuelPhaseKey,
  ENERGY_COLOURS,
  type EnergyColour,
  FIELD_LIMIT,
  HAND_LIMIT,
  STAT_CAP,
  energyIndex,
  handCardSelectable,
  indexCatalog,
  summonCost,
} from "./types.ts";
import type { ProgramTurns } from "./program-turns.ts";
import type { SummonTurns } from "./summon-turns.ts";
import type { BattleWalk } from "./combo-damage.ts";

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

export const clampStat = (v: number) => Math.max(0, Math.min(STAT_CAP, Math.round(v)));

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
export function reapDead(s: DuelSide): void {
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
export function payEnergy(duel: DuelState, s: DuelSide, id: number): void {
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
 *  being their printed stats — the five Digimon cards that PRINT a stat rule.
 *  One per energy colour, in `ENERGY_COLOURS` order:
 *
 *    white 69 RosemonII       AP & HP become 20x your Digimon on the field
 *    blue 112 MarineAngemon   +10 and 10x the cards in your hand
 *    green 155 SaberLeomon    +10 and 20x the cards in your trash
 *    red 198 Gryphonmon       10x the Digimon across both fields
 *    black 241 Creepymon      +10 and 10x the cards across both trashes
 *
 *  THE CATALOGUE TEXT IS THE AUTHORITY. These are the only Digimon cards with
 *  text in the card-text bank, and the album's detail line checks exactly these
 *  five ids, `0x45 / 0x70 / 0x9B / 0xC6 / 0xF1`
 *  (docs/research/ui/card-album-screen-2026-08-14.md §3). Two of them print
 *  AP 0 / HP 0 because their real numbers are only computed when they are
 *  played. The decoded formula arms (`D0x80083960`, one arm per colour in this
 *  same order) match those five printed rules, which is what ties each arm to
 *  its card (CARD-DUEL-VERIFIED.md §19.3).
 *
 *  NOT THE RAW TABLE. The halfwords at `0x800A5C20` read 68/111/154/197/240 —
 *  one lower than these ids — and that table sits past the disassembled range;
 *  §14.5 still records its values as UNVERIFIED, so it is not proof of which
 *  cards the rules name. Using its values as ids would recompute five cards
 *  that print neither a rule nor 0/0. The ordinary duel runs the native overlay
 *  and keeps the disc's own table; this list is the engine path's correction. */
export const DYNAMIC_STAT_MEGAS: readonly number[] = Object.freeze([69, 112, 155, 198, 241]);

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
