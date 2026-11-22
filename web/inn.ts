// web/inn.js — the inn (hotel) rest service's state write.
//
// The inn screen itself is web/inn-translated.js (engine InnSession); this
// module keeps the one rule that file shares: how a rest's result is written
// back onto the deployed partner blocks.
//
// The screen prices and rests the DEPLOYED partner blocks, not the character
// ids. `state.party` is the charId list, so a read of it handed restAtInn an
// array of strings and applyInnRest wrote hp/mp onto them -- committing a stay
// threw "Cannot create property 'hp' on string". Index 0 is the live
// partnerStats block, the rest are the partyStats slots.

import type { InnMember } from "../engine/dw3/inn.js";
import type { WalkerState } from "./types/translated-screens.js";

export function applyInnRest(state: WalkerState, before: readonly InnMember[], after: readonly InnMember[]) {
  const chars = state?.party;
  if (!Array.isArray(chars) || !chars.length) return;
  const stats = Array.isArray(state.partyStats) ? state.partyStats : [];
  after.forEach((m, i: number) => {
    let target = i === 0 ? state.partnerStats : stats[i];
    if (!target) { target = {}; stats[i] = target; }
    if (Array.isArray(state.partyStats)) state.partyStats[i] = target;
    target.hp = m.hp;
    target.mp = m.mp;
    // F0x8001104c also zeroes three roster halfwords; the walker reads that as
    // clearing the status list. What those fields mean is NOT decoded — see
    // `open_gaps` in inn_ui.json.
    if (Array.isArray(m.status)) target.status = m.status;
    // The three halfwords ARE decoded now (EQUIP-C026): the persistent post-hit stat
    // penalty at roster +0x42/+0x44/+0x46, which `F0x8001104c` sets 0 on every present
    // slot and this rest is the disc's only clearing point for
    // (engine/dw3/battle-damage-terms.ts, engine/dw3/inn.ts `restAtInn`).
    target.statPenalty = { ...(m.statPenalty ?? { str: 0, def: 0, spd: 0 }) };
  });
}
