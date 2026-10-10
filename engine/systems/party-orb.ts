// engine/systems/party-orb.ts
//
// The player's resident FIELDCOM type-0x16 party orb — the red/orange orb ringed
// with blue dots that floats over the player's head in the field once they are
// in the Digital World (the permanent "you have a party" marker the bank-0x70
// scripts flare with ITEM_GET on an acquisition). This module carries the ONE
// rule that decides whether the actor exists: its SCREEN gate.
//
// THE SCREEN GATE. F0x80089f24 (fieldstg.s:7332-7353; fieldstg loads at
// 0x80082cb0, so file 0x7274) builds the actor and returns NULL outside the
// gate:
//
//     lui $v0, 0x8005
//     lw  $v0, -0x4bc8($v0)   # [0x8004b438] = the current-screen-id getter fn
//     jalr $v0
//     move $s0, $a0           # s0 = the owner entity passed in
//     slti $v0, $v0, 0x2d7    # screen id < 0x2d7 ?
//     bnez $v0, .L0x000072a4  # yes -> allocate the object
//     move $v0, $zr
//     j 0x80089f6c            # no  -> return NULL, no object
//
// THE OWNER. Its only caller is the type-5 field-character tick callback
// (fieldstg.s:14561-14567), and the call is entered for one character only —
// the one whose registry-index field +0x8 is 0, i.e. the player:
//
//     lw $v0, 0x8($s0)        # character index
//     bnez $v0, .L0x0000e384  # index != 0 -> skip the ctor entirely
//     jal 0x80089f24
//     sw $v0, ($s1)           # store it into charObj->extra[0]
//
// So exactly one orb exists, owned by the player, per field-stage load.
//
// NOT A ROSTER TEST. The ctor reads nothing about the party, the roster or a
// downloaded partner. The screens numbered at/above 0x2d7 are the real-world
// prologue (s780..s895 = screen ids 0x2d7..0x2ee in data/screen_table.json);
// the Digital World, where a partner is downloaded, is below the cut. That is
// why the orb is first seen "once a partner is downloaded" — it is the same
// event as leaving the prologue screens, not a party test. The walker's former
// `fieldPartySize(party) > 0` condition was an unverified assumption and is
// contradicted here.
//
// Claim: world-q001-confirm-probe-box-rule-2026-09-13 is NOT this rule; this rule
// is recorded separately (see the field-gap row G15 / the ledger note for the
// type-0x16 actor lifetime in
// docs/research/scripting/bank70-opcode-handlers-decoded-2026-07-27.md).

/** The screen-id cut below which the player's party orb is built: 0x2d7 (727). */
export const PARTY_ORB_SCREEN_CUT = 0x2d7;

/**
 * True when the player's resident party orb exists on the field screen whose id
 * is `screenId`. The original allocates it per stage load iff `screenId < 0x2d7`;
 * an unknown screen id (null/undefined) is a screen the original's getter cannot
 * name, so no orb is claimed for it.
 */
export function partyOrbVisible(screenId: number | null | undefined): boolean {
  return screenId != null && Number.isFinite(screenId) && screenId < PARTY_ORB_SCREEN_CUT;
}
