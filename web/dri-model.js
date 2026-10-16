// Pure DRI menu model. Rendering stays in dri.js; these mutations are shared
// by browser flow and node tests.
import { CHARID_TO_DIGID, baseStatsFor } from "./party.js";
import { applyFormTechGates } from "./form-tech-slots.js";
import {
  ROSTER_SLOT_CHARIDS, reserveRosterSlots, rosterSlotDigimonId, rosterSlotOfCharId,
  DEPLOYED_PARTY_CAP, syncWornFromEquipment, isFormDigimonId,
} from "./vendor/engine.js";

export function ensureDriPartyStats(state, digimonById) {
  const party = state.party ?? [];
  if (!Array.isArray(state.partyStats) || state.partyStats.length !== party.length)
    state.partyStats = party.map(() => null);
  for (let i = 1; i < party.length; i++) {
    if (!state.partyStats[i]) state.partyStats[i] = baseStatsFor(digimonById[CHARID_TO_DIGID[party[i]]]);
  }
  return state.partyStats;
}

export function driStatsAt(state, index, digimonById) {
  ensureDriPartyStats(state, digimonById);
  if (index === 0) return state.partnerStats;
  return state.partyStats[index] ?? baseStatsFor(digimonById[CHARID_TO_DIGID[state.party[index]]]);
}

export function driDigimonAt(state, index, digimonById) {
  const stats = driStatsAt(state, index, digimonById);
  return digimonById[stats?.digimonId ?? CHARID_TO_DIGID[state.party[index]]];
}

export function driStarterAt(state, index, digimonById) {
  return digimonById[CHARID_TO_DIGID[state.party[index]]];
}

// Runtime form-ledger shape mirrors the decoded 0x14-byte record:
// { id, formLevel, dvexp, techSlots[6] }.  Older walker saves only had a
// dvexpByForm map; migrate those banks lazily and derive the already-learned
// slots from the profile's decoded learn thresholds.
export function ensureFormLedger(stats, digimonById) {
  if (!stats) return [];
  if (!Array.isArray(stats.formLedger)) stats.formLedger = [];
  const byId = new Map(stats.formLedger.map((r) => [Number(r.id), r]));
  for (const [rawId, rawExp] of Object.entries(stats.dvexpByForm ?? {})) {
    const id = Number(rawId);
    if (byId.has(id) || !digimonById[id]) continue;
    const profile = digimonById[id];
    const exp = Number(rawExp) || 0;
    const cap = profile.dv_cap ?? 100;
    let level = 1;
    while (level < 99 && exp >= (level < cap ? 10 * level : 10 * (cap - 1) + 50 * (level + 1 - cap))) level++;
    // The disc's learn/load pass: the signature is ledger slot 5 with its own
    // gate, never the slot after the last ordinary technique (web/form-tech-slots.js).
    const record = { id, formLevel: level, dvexp: exp, techSlots: [0, 0, 0, 0, 0, 0] };
    applyFormTechGates(record, profile, level);
    stats.formLedger.push(record); byId.set(id, record);
  }
  for (const record of stats.formLedger) {
    record.id = Number(record.id);
    record.formLevel = Math.max(1, Number(record.formLevel) || 1);
    record.dvexp = Math.max(0, Number(record.dvexp) || 0);
    record.techSlots = Array.isArray(record.techSlots) ? record.techSlots.slice(0, 6) : [];
    while (record.techSlots.length < 6) record.techSlots.push(0);
  }
  if (stats.digimonId && isFormDigimonId(stats.digimonId) && !stats.formLedger.some((r) => r.id === stats.digimonId)) {
    const profile = digimonById[stats.digimonId];
    if (profile) stats.formLedger.push({ id: profile.id, formLevel: 1, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] });
  }
  return stats.formLedger;
}

export function formLedgerRecord(stats, formId, digimonById) {
  return ensureFormLedger(stats, digimonById).find((r) => Number(r.id) === Number(formId)) ?? null;
}

function ensureEquippedForms(stats, digimonById) {
  ensureFormLedger(stats, digimonById);
  if (!Array.isArray(stats.equippedForms)) stats.equippedForms = [];
  return stats.equippedForms;
}

export function driRoster(state, digimonById) {
  return (state.party ?? []).map((charId, index) => {
    const stats = driStatsAt(state, index, digimonById) ?? {};
    const profile = driDigimonAt(state, index, digimonById);
    return {
      index, charId, profile, stats,
      name: state.digimonNames?.[charId] ?? profile?.name ?? charId,
      level: stats.level ?? 1,
      hp: stats.hp ?? profile?.hp ?? 0,
      maxHp: stats.maxHp ?? profile?.hp ?? 0,
      mp: stats.mp ?? profile?.mp ?? 0,
      maxMp: stats.maxMp ?? profile?.mp ?? 0,
    };
  });
}

// The Switch screen's FIRST list is the three PEDESTALS, not only the standing
// partners. The original draws one tube per party slot, looping i < ctx+0x5C
// (=3) and skipping the ones whose word is negative (F0x80089aec), and for the
// Switch row the picker wraps the selection over those three slots
// (F0x80088b5c case 5 takes ctx+0x5C for Select Action row 0; case 15 wraps by
// that count). The packed party puts the standing partners at the front
// (claim party-lab-count-and-pack-2026-09-14), so the walker's dense party plus
// one empty entry per free pedestal is that list.
export function driSwitchSlots(state, digimonById) {
  const slots = driRoster(state, digimonById).slice(0, DEPLOYED_PARTY_CAP);
  for (let i = slots.length; i < DEPLOYED_PARTY_CAP; i++) {
    slots.push({ index: i, charId: null, profile: null, stats: null, empty: true });
  }
  return slots;
}

export function swapDriFormation(state, a, b) {
  if (a === b) return false;
  if (!state.partyStats) state.partyStats = (state.party ?? []).map(() => null);
  state.partyStats[0] = state.partnerStats;
  const swap = (array) => {
    if (!Array.isArray(array)) return;
    [array[a], array[b]] = [array[b], array[a]];
  };
  swap(state.party);
  swap(state.partyStats);
  swap(state.equipment);
  state.partnerStats = state.partyStats[0];
  state.charId = state.party[0];
  const charIndex = state.manifest?.characters?.findIndex((c) => c.id === state.charId) ?? -1;
  if (charIndex >= 0) state.charIdx = charIndex;
  const char = state.manifest?.characters?.[state.charIdx];
  if (char && state.partnerStats?.digimonId) char.digimonId = state.partnerStats.digimonId;
  return true;
}

// The partners you own but have not deployed — what the Lab's Switch screen offers.
// The original walks all eight roster slots, keeps the obtained ones (roster_owned != 0)
// and drops any that is one of the three deployed party members; the survivors, in slot
// order, are the candidate list (claim PARTY-C004, stgdglab.s L9505-L9542). A reserve
// member that has never been deployed has no stat block yet, so it gets the level-1 one.
export function driReserve(state, digimonById) {
  return reserveRosterSlots(state?.rosterOwned ?? 0, state?.party ?? []).map((slot) => {
    const charId = ROSTER_SLOT_CHARIDS[slot];
    const stats = state.reserveStats?.[charId]
      ?? baseStatsFor(digimonById[rosterSlotDigimonId(slot)]);
    const profile = digimonById[stats?.digimonId ?? rosterSlotDigimonId(slot)];
    // The base species, for the detail panel's "Do nothing." row.
    const starter = digimonById[rosterSlotDigimonId(slot)];
    return {
      slot, charId, profile, starter, stats,
      name: state.digimonNames?.[charId] ?? profile?.name ?? charId,
      level: stats?.level ?? 1,
      hp: stats?.hp ?? profile?.hp ?? 0,
      maxHp: stats?.maxHp ?? profile?.hp ?? 0,
      mp: stats?.mp ?? profile?.mp ?? 0,
      maxMp: stats?.maxMp ?? profile?.mp ?? 0,
    };
  });
}

// Deploy a reserve partner in place of the party member at `index`. The two trade
// places: the outgoing member keeps its stats and gear in the reserve store, so
// switching it back in later returns the Digimon you had, not a fresh one. Deploying
// does not change ownership — both partners stay in `rosterOwned`.
export function switchInReservePartner(state, index, charId, digimonById) {
  const party = state.party ?? [];
  // The original's Switch confirm writes party[chosen pedestal] = candidate and
  // then re-packs (F0x8008b798 case 8 -> lab_count_and_pack_party), and the
  // pedestal list is the three slots, including the empty ones. So a chosen
  // pedestal at the end of a party that is under the cap FILLS a free slot
  // instead of swapping: no outgoing member is reserved and the party grows by
  // one. Anything else keeps the swap semantics.
  const append = index === party.length && party.length < DEPLOYED_PARTY_CAP;
  if (index == null || index < 0 || index > party.length) return false;
  if (!append && index >= party.length) return false;
  const incoming = driReserve(state, digimonById).find((r) => r.charId === charId);
  if (!incoming) return false;

  ensureDriPartyStats(state, digimonById);
  state.partyStats[0] = state.partnerStats;
  if (!state.reserveStats) state.reserveStats = {};
  if (!state.reserveEquipment) state.reserveEquipment = {};
  if (!Array.isArray(state.equipment)) state.equipment = [];

  if (append) {
    party.push(charId);
    state.partyStats.push(incoming.stats);
    state.equipment.push(state.reserveEquipment[charId] ?? {});
  } else {
    const outgoingId = party[index];
    state.reserveStats[outgoingId] = state.partyStats[index] ?? null;
    state.reserveEquipment[outgoingId] = state.equipment[index] ?? {};

    party[index] = charId;
    state.partyStats[index] = incoming.stats;
    state.equipment[index] = state.reserveEquipment[charId] ?? {};
  }
  delete state.reserveStats[charId];
  delete state.reserveEquipment[charId];
  // The same gear, a different wearer: the worn byte counts every roster record's
  // gear (deployed and switched out), so it does not move — recomputed here so a
  // partner swap can never leave the stored array describing different hands.
  syncWornFromEquipment(state);

  state.partnerStats = state.partyStats[0];
  state.charId = party[0];
  const charIndex = state.manifest?.characters?.findIndex((c) => c.id === state.charId) ?? -1;
  if (charIndex >= 0) state.charIdx = charIndex;
  const char = state.manifest?.characters?.[state.charIdx];
  if (char && state.partnerStats?.digimonId) char.digimonId = state.partnerStats.digimonId;
  return true;
}

// The lab's "{name} digivolve" list writes current form only — equipped[cursor]
// or 0 (rookie / "Do nothing."). It does not unlock a form and does not reroll
// HP/MP; those happen on the fight report (DIGI decoded §7, PLAIN §8).
export function setStandingForm(state, index, formId, digimonById) {
  const stats = driStatsAt(state, index, digimonById);
  const starter = driStarterAt(state, index, digimonById);
  if (!stats || !starter) return false;
  const id = !formId || !isFormDigimonId(formId) ? starter.id : formId;
  if (id !== starter.id) {
    const equipped = ensureEquippedForms(stats, digimonById);
    if (!equipped.some((held) => Number(held) === id)) return false;
  }
  stats.digimonId = id;
  if (index === 0) {
    state.partnerStats = stats;
    const char = state.manifest?.characters?.[state.charIdx];
    if (char) char.digimonId = id;
  } else {
    state.partyStats[index] = stats;
  }
  return true;
}

export function acquiredDriForms(state, index, digimonById) {
  const stats = driStatsAt(state, index, digimonById);
  if (!stats) return [];
  const seen = new Set();
  return ensureFormLedger(stats, digimonById).flatMap((record) => {
    const id = Number(record.id);
    const profile = digimonById[id];
    if (!profile || !isFormDigimonId(id) || seen.has(id)) return [];
    seen.add(id);
    return [{ record, profile }];
  });
}

// The partner-detail list shared by the "{name} digivolve" screen and the
// Switch/picker Details view: the equipped triple (deduped) then the rookie row.
// F0x8008d7cc/F0x8008d9bc draw this list in the shared panel (F0x8008e4cc); the
// F0x8008e8d0 object that the Switch Circle opens builds it from get_equipped
// (0x8004B46C) and enumerate_acquired (0x8004B474).
export function standingChoicesFromStats(stats, starter, digimonById) {
  if (!stats) return [];
  const equipped = ensureEquippedForms(stats, digimonById);
  const rows = [];
  const seen = new Set();
  for (const id of equipped) {
    const profile = digimonById[Number(id)];
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    rows.push({ profile, formId: profile.id });
  }
  if (starter) rows.push({ profile: starter, formId: 0, doNothing: true });
  return rows;
}

export function standingChoices(state, index, digimonById) {
  const stats = driStatsAt(state, index, digimonById);
  const starter = driStarterAt(state, index, digimonById);
  if (!stats || !starter) return [];
  return standingChoicesFromStats(stats, starter, digimonById);
}

// Change-type: write one of the three equipped slots. Duplicate ids are
// refused. A form that is the one they are standing as is refused ("can't").
export function setEquippedForm(stats, slot, formId, currentFormId) {
  if (!stats || slot < 0 || slot > 2) return "invalid";
  const equipped = ensureEquippedForms(stats, {});
  while (equipped.length < 3) equipped.push(0);
  const id = Number(formId) || 0;
  if (id && equipped.some((held, i) => i !== slot && Number(held) === id)) return "duplicate";
  if (id && currentFormId && id === Number(currentFormId) && Number(equipped[slot]) !== id)
    return "current";
  equipped[slot] = id;
  return "ok";
}

export function firstOpenEquipSlot(stats) {
  const equipped = ensureEquippedForms(stats, {});
  while (equipped.length < 3) equipped.push(0);
  const empty = equipped.findIndex((id) => !Number(id));
  return empty < 0 ? 0 : empty;
}

// Kept for callers that still pass a species name. The lab no longer restats
// or unlocks here — it only changes who they are standing as.
export function applyDriEvolution(state, index, target, digimonById) {
  const profile = Object.values(digimonById).find((d) => d.name === target);
  if (!profile) return false;
  return setStandingForm(state, index, profile.id, digimonById);
}

// The DRI chooser is the selected form's six ledger slots, including flags.
export function loadableDriTechs(state, index, digimonById) {
  const stats = driStatsAt(state, index, digimonById);
  const current = driDigimonAt(state, index, digimonById);
  const record = formLedgerRecord(stats, current?.id, digimonById);
  return (record?.techSlots ?? []).map((flagged) => Number(flagged) & 0x1fff).filter(Boolean);
}

// Toggle a loaded-tech slot (3 max — esdglabo "Load up to 3.").
export function toggleDriLoadedTech(stats, techId) {
  if (!stats) return "invalid";
  if (!Array.isArray(stats.loadedTechs)) stats.loadedTechs = [];
  const at = stats.loadedTechs.indexOf(techId);
  if (at >= 0) {
    stats.loadedTechs.splice(at, 1);
    return "unloaded";
  }
  if (stats.loadedTechs.length >= 3) return "full";
  stats.loadedTechs.push(techId);
  return "loaded";
}

export function toggleLedgerTech(record, slot, load) {
  if (!record || slot < 0 || slot >= 6) return "invalid";
  const word = Number(record.techSlots?.[slot] ?? 0);
  if (!word) return "unavailable";
  // The decoded classification order (technique-loading-decoded.md): a loaded
  // word (0x4000) always unloads first, whatever its other bits; the signature,
  // the not-yet-learned and the three-loaded cap only gate LOADING.
  if (word & 0x4000) {
    if (load) return "loaded";
    record.techSlots[slot] = word & ~0x4000;
    return "unloaded";
  }
  if (!load) return "unloaded";
  if (word & 0x8000) return "unavailable";
  if (!(word & 0x2000)) return "not-ready";
  const loaded = record.techSlots.filter((v) => v & 0x4000).length;
  if (loaded >= 3) return "full";
  record.techSlots[slot] = word | 0x4000;
  return "loaded";
}

// The Lab chart's four pages for one line: the forms that line's own tree names,
// grouped by the species id the original bands them into (F0x800842f4:117-134).
export function chartPages(starter, records, digimonById) {
  const tiers = [[], [], [], []];
  const seen = new Set();
  for (const record of records ?? []) {
    if (seen.has(record.to)) continue;
    const profile = digimonById[record.to];
    if (!profile || profile.id > 52) continue;
    seen.add(record.to);
    const page = profile.id <= 20 ? 0 : profile.id <= 33 ? 1 : profile.id <= 43 ? 2 : 3;
    tiers[page].push({ ...record, profile, to: profile.name });
  }
  return tiers.map((entries, page) => ({ page, starter, entries }));
}
