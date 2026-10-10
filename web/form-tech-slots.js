// web/form-tech-slots.js — the ONE port of a digivolution's technique-slot
// layout and its per-form-level learn/load gates. Read the canonical decode
// before changing anything here:
//   docs/research/battle/digivolution-tech-system-decoded-2026-07-11.md §4
//
// A form's profile row lists SIX technique halfwords: five ordinary techniques
// at +0x1e..+0x26 (an unused slot is written as zero) and the SIGNATURE at
// +0x28. Its six LEARN gates are the bytes at +0x31..+0x36 — the sixth, the
// signature's own gate, is the byte the extraction's label files call
// tech_level_load[0]. Its five non-signature LOAD gates are the bytes at
// +0x37..+0x3b. The ledger halfword is `id | 0x2000 (loadable) | 0x4000
// (loaded) | 0x8000 (signature)`, and slot 5 is the signature.
//
// THE TRAP this file exists to close: the signature is slot 5, NOT the slot
// after the last ordinary technique. Most forms carry fewer than five ordinary
// techniques, so the profile has empty slots; COMPACTING the list (dropping the
// empties) slides the signature down onto an empty slot, whose learn byte is
// zero — so the ultimate move is learned at form level 1–2 instead of at its
// real gate. Dinohumon's Lizard Dance was exactly this: taught at level 1 with
// a real gate of 60. Compacting a full-five form also drops its fifth ordinary
// technique entirely.
//
// tools/build_battle_data.py emits the aligned arrays on each digimon.json
// entry — tech_slots[6], tech_learn_levels[6], tech_load_levels[5] — so no
// consumer re-derives the label-file shift or re-compacts the slots. The
// fallbacks below rebuild the same shape from the older display fields for a
// profile that predates that change.

/** The six technique ids in ledger-slot order (0..4 ordinary, 5 signature). */
export function profileTechSlots(profile) {
  if (Array.isArray(profile?.tech_slots)) return profile.tech_slots.slice(0, 6).map(Number);
  const slots = [0, 0, 0, 0, 0, 0];
  (profile?.techs ?? []).slice(2, 7).forEach((id, i) => { if (i < 5) slots[i] = Number(id) || 0; });
  slots[5] = Number(profile?.tech_signature ?? 0) || 0;
  return slots;
}

/** The six LEARN gates (profile +0x31..+0x36), aligned to the six slots. */
export function profileLearnLevels(profile) {
  if (Array.isArray(profile?.tech_learn_levels)) return profile.tech_learn_levels.slice(0, 6).map(Number);
  return [...(profile?.tech_level_learn ?? []), (profile?.tech_level_load ?? [])[0] ?? 0]
    .slice(0, 6).map(Number);
}

/** The five non-signature LOAD gates (profile +0x37..+0x3b). */
export function profileLoadLevels(profile) {
  if (Array.isArray(profile?.tech_load_levels)) return profile.tech_load_levels.slice(0, 5).map(Number);
  // Legacy display order: [signature learn, load0, load1, load2, load3].
  const shifted = (profile?.tech_level_load ?? []).map(Number);
  return [shifted[1] ?? 0, shifted[2] ?? 0, shifted[3] ?? 0, shifted[4] ?? 0, 0];
}

/**
 * Apply the disc's learn/load pass to one form-ledger record in place — the
 * F0x8008670C (fill the next empty slot at its learn gate) + F0x80086844 (mark
 * the next learned ordinary technique loadable at its load gate) pair, run once
 * per form-level step. Returns the technique ids learned and the ids that
 * became loadable this pass.
 */
export function applyFormTechGates(record, profile, formLevel) {
  const slots = profileTechSlots(profile);
  const learn = profileLearnLevels(profile);
  const load = profileLoadLevels(profile);
  if (!Array.isArray(record.techSlots)) record.techSlots = [0, 0, 0, 0, 0, 0];
  const learned = [];
  const loadable = [];
  for (let i = 0; i < 6; i++) {
    if (record.techSlots[i]) continue;
    if (!slots[i]) continue;
    if (formLevel < (learn[i] ?? 0)) continue;
    record.techSlots[i] = (Number(slots[i]) | (i === 5 ? 0x8000 : 0)) & 0xffff;
    learned.push(record.techSlots[i] & 0x1fff);
  }
  for (let i = 0; i < 5; i++) {
    const word = Number(record.techSlots[i] ?? 0);
    if (word <= 0 || (word & 0x2000)) continue;
    if (formLevel < (load[i] ?? 0)) continue;
    record.techSlots[i] = (word | 0x2000) & 0xffff;
    loadable.push(word & 0x1fff);
  }
  return { learned, loadable };
}
