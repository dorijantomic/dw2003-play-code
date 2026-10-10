// engine/dw3/roster.ts
//
// The eight-slot PARTNER ROSTER, and the rule the Digimon Lab uses to decide which
// partners it will offer you.
//
// A partner handover is a dialogue-state write through bank-0x70 op-0x10 case 3
// (F0x80015820): `roster_owned[slot] = slot + 3`, one u32 per roster slot at
// 0x80048d34 + 0x760 + slot*0x3dc. Zero means "never obtained"
// (docs/research/scripting/bank70-opcode-handlers-decoded-2026-07-27.md § op 0x10).
// The engine keeps the obtained SET as a bitmask in `$roster.owned` rather than a
// struct — see ROSTER_OWNED_VAR in dw3-config.ts.
//
// The Lab's Switch screen builds its candidate list by walking all eight slots and
// keeping the obtained ones that are NOT among the three deployed party members
// (claim PARTY-C004, from stgdglab.s L9505-L9542):
//
//     addiu $a3, $v0, -0x72cc     # roster base 0x80048d34 (negative addiu borrows)
//     lw    $v0, 0x760($a3)       # roster_owned[slot]
//     addiu $a2, $v0, -0x3        # -> slot ordinal
//     bltz  $a2, skip             # 0 = never obtained
//     ...   slti $v0, $a0, 0x3    # compare against the THREE deployed
//     sw    $a2, 0xe4($v0)        # append survivor to the candidate array
//     slti  $v0, $s0, 0x8         # eight slots
//     addiu $a3, 0x3dc            # roster record stride
//
// So obtaining a partner and deploying one are two separate steps, and the deployed
// party is capped at three.
//
// Pure and DW3-data-only: no DOM, no engine state object. The browser's DRI screen
// and the walker's party code both read the same table from here.

/** Roster slots in the original's order. Slot `s` holds `s + 3` once obtained. */
export const ROSTER_SLOT_COUNT = 8;

/** The deployed party is three (the Switch builder's inner comparison loop). */
export const DEPLOYED_PARTY_CAP = 3;

// Slot -> the walker's manifest character id. The follower actor's kind is
// `roster_slot + 3` (claim field-shadow-ctor-default-and-denylist, 2026-08-04) and the
// npc/sprite table resolves kind k to the sprite whose number is k, which is why the
// eight starters are p003..p010 in exactly this order. digimon.json id is slot + 1.
export const ROSTER_SLOT_CHARIDS: readonly string[] = [
  "p003pken", // slot 0 — Kotemon
  "p004kogu", // slot 1 — Kumamon
  "p005koet", // slot 2 — Monmon
  "p006agum", // slot 3 — Agumon
  "p007vmon", // slot 4 — Veemon (in no starter pack: handover only)
  "p008giru", // slot 5 — Guilmon
  "p009rena", // slot 6 — Renamon
  "p010pata", // slot 7 — Patamon
];

/** digimon.json id for a roster slot (the table is 1-based, the roster 0-based). */
export function rosterSlotDigimonId(slot: number): number {
  return slot + 1;
}

/** Which roster slot a manifest character id occupies, or null if it is not a partner. */
export function rosterSlotOfCharId(charId: string): number | null {
  const i = ROSTER_SLOT_CHARIDS.indexOf(charId);
  return i < 0 ? null : i;
}

/**
 * THE shared helper: `F0x80016D94` (the resident context method at `ctx+0x2718`,
 * the pointer cell `0x8004B44C`) on the walker's side — the roster slot a party
 * POSITION holds. The original reads `ctx+0x70[position]`, a `u32[3]` map written
 * once by `F0x80016DC0` from the disc's own starter-pack table at `0x8004B490`
 * (pack 0 = `[0, 6, 7]` Kotemon/Renamon/Patamon), and returns -1 for a position
 * of 3 or more; it was read live out of RAM as `[6, 4, 0]`
 * (docs/research/battle/digivolution-tech-system-decoded-2026-07-11.md §2 and §5).
 *
 * This number, and not a profile row of the member's live form, is what every
 * in-battle partner screen keys itself by:
 *
 *  - the DNA pane stores it at `self+0x60` (FIGHTSTG_F0x80098884,
 *    pro/fightstg.s 0x800988c8-0x800988d8) and reads
 *    `*(u16 *)(0x8003EF5C + 0x58*it)` for the strip's FIRST row
 *    (0x80098130-0x80098178);
 *  - the Digivolve form list stores it at `self+0x54` (F0x8009482C,
 *    0x80094854, handed the roster slot in the delay slot at 0x80092950) and
 *    reads the same first row the same way (0x800944c4-0x8009450c);
 *  - `F0x800176AC` (`[0x8004B46C]`, the equipped triple) and the roster record
 *    at `0x80049494 + slot*0x3DC` are addressed by it.
 *
 * So the strip always leads with the partner's STARTER species (profile rows
 * 0..7 are the eight starters) and lists the equipped forms after it, even when
 * the partner has already digivolved. A party member that is not one of the
 * eight starters has no roster slot in the original either; the walker answers
 * the position itself, which is what these screens did before.
 */
export function partyPositionRosterSlot(
  party: readonly ({ charId?: string | null } | null | undefined)[] | null | undefined,
  position: number,
): number {
  if (!Number.isInteger(position) || position < 0 || position >= DEPLOYED_PARTY_CAP) return -1;
  const slot = rosterSlotOfCharId(String(party?.[position]?.charId ?? ""));
  return slot === null ? position : slot;
}

/** The mask with `slot` marked obtained. */
export function withRosterSlot(mask: number, slot: number): number {
  if (!Number.isInteger(slot) || slot < 0 || slot >= ROSTER_SLOT_COUNT) return mask;
  return (Number(mask) || 0) | (1 << slot);
}

/** Is this slot obtained? */
export function rosterSlotOwned(mask: number, slot: number): boolean {
  return ((Number(mask) || 0) >> slot & 1) === 1;
}

/** Every obtained slot, in slot order — the walk order of the original's builder. */
export function ownedRosterSlots(mask: number): number[] {
  const out: number[] = [];
  for (let slot = 0; slot < ROSTER_SLOT_COUNT; slot++)
    if (rosterSlotOwned(mask, slot)) out.push(slot);
  return out;
}

/**
 * The Digimon Lab's Switch candidates: obtained, minus the deployed party, in slot order.
 * `deployed` is the party as manifest character ids (a non-partner id simply matches
 * nothing, exactly as an ordinal that is not in the roster would not).
 */
export function reserveRosterSlots(mask: number, deployed: readonly string[]): number[] {
  const active = new Set(
    (deployed ?? []).slice(0, DEPLOYED_PARTY_CAP)
      .map(id => rosterSlotOfCharId(id))
      .filter((s): s is number => s !== null));
  return ownedRosterSlots(mask).filter(slot => !active.has(slot));
}

/**
 * The mask implied by a party that is already deployed. A save made before the roster
 * was modelled has three partners and an empty mask; whoever is deployed is by
 * definition obtained, so the mask is repaired from the party rather than left wrong.
 */
export function rosterMaskForParty(mask: number, deployed: readonly string[]): number {
  let out = Number(mask) || 0;
  for (const charId of deployed ?? []) {
    const slot = rosterSlotOfCharId(charId);
    if (slot !== null) out = withRosterSlot(out, slot);
  }
  return out;
}
