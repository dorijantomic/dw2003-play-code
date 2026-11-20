import {
  type DuelSide,
  type DuelState,
  recomputeTotals,
  setWindowThreshold,
  shuffleDuelPiles,
} from "./duel-state.ts";
import { FOLDER_SIZE } from "./types.ts";

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
