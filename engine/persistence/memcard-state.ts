// Browser storage adapter for the decoded resident image. Unknown browser-only
// state stays in the companion snapshot; mapped game data is read from the card.
import { ELEMENT_KEYS } from "../dw3/effective-stats.ts";
import { NativeMemory } from "../native/memory.ts";
import { decodeSaveRoster, writeSaveBlock, readSaveCards, readSaveFlags } from "../dw3/save-block.ts";
import { PARTY_CONTEXT } from "../dw3/party-context.ts";
import { ROSTER_SLOT_CHARIDS, isFormDigimonId, isDiscRosterSlot } from "../dw3/roster.ts";
import { bagFromItemArrays, readItemArrays } from "../dw3/item-store.ts";
import { extraProfileRow } from "../dw3/ui/native/pause-status.ts";

/** Forms the snapshot knew that the card's 44 cells could not hold. */
function overflowForms(cells: { id: number }[], previous: unknown): unknown[] {
  if (!Array.isArray(previous)) return [];
  const held = new Set(cells.map((e) => Number(e.id)));
  return previous.filter((e) => e && isFormDigimonId(Number(e.id)) && !held.has(Number(e.id)));
}

export function residentStorage(image: ArrayLike<number>, profiles: Uint8Array, snapshot: Record<string, string>) {
  const data = { ...snapshot };
  const mem = new NativeMemory();
  writeSaveBlock(mem, image);
  const roster = decodeSaveRoster(image, profiles);
  // A new partner (roster slot 8.., engine/dw3/roster.ts) can stand in the card's party map, but the card holds
  // the disc's eight records only: its own record comes back from the companion snapshot the card was saved with.
  const isNewPartner = (s: number) => !isDiscRosterSlot(s) && s > 0 && !!ROSTER_SLOT_CHARIDS[s];
  const partySlots = Array.from({ length: 3 }, (_, i) => mem.read32(PARTY_CONTEXT + 0x70 + i * 4))
    .filter(s => s >= 0 && (s < 8 || isNewPartner(s)));
  const party = partySlots.map(s => ROSTER_SLOT_CHARIDS[s]!);
  const oldParty = JSON.parse(data.partyStats ?? "[]");
  const oldReserve = JSON.parse(data.reserveStats ?? "{}");
  const oldEquipment = JSON.parse(data.equipment ?? "[]");
  const oldReserveEquipment = JSON.parse(data.reserveEquipment ?? "{}");
  const previousParty = JSON.parse(data.party ?? "[]");
  const snapshotFor = (slot: number, party: unknown[], reserve: Record<string, unknown>) => {
    const id = ROSTER_SLOT_CHARIDS[slot]!;
    const pos = previousParty.indexOf(id);
    return (pos >= 0 ? party[pos] : reserve[id]) ?? null;
  };
  const statsFor = (slot: number) => {
    if (isNewPartner(slot)) return snapshotFor(slot, oldParty, oldReserve);
    const r = roster[slot]!;
    const oldPos = previousParty.indexOf(ROSTER_SLOT_CHARIDS[slot]);
    const previous = (oldPos >= 0 ? oldParty[oldPos] : oldReserve[ROSTER_SLOT_CHARIDS[slot]!]) ?? {};
    const coreKeys = ["str", "def", "spt", "wis", "spd", "chr"];
    const stats = Object.fromEntries(coreKeys.map((k, i) => [k, r.core[i]! - (Number(previous.bonuses?.[k]) || 0)]));
    // the form's own profile record: the disc's 55 rows, or the enemy-only species' (walker ids 56..)
    const row = extraProfileRow(r.digimonId);
    const profileView = row
      ? new DataView(row.buffer, row.byteOffset, row.byteLength)
      : new DataView(profiles.buffer, profiles.byteOffset, profiles.byteLength);
    const profile = row ? 0 : (r.digimonId > 0 ? r.digimonId - 1 : slot) * 0x58;
    const elemBonuses = Object.fromEntries(ELEMENT_KEYS.map((k, i) => [k, r.elements[i]! - profileView.getUint16(profile + 0xe + i * 2, true)]));
    return { ...previous, stats, elemBonuses, lastUltraDrill: r.lastUltraDrill || null, xp: r.xp, level: r.level, tp: r.tp, hp: r.hp, maxHp: r.maxHp, mp: r.mp, maxMp: r.maxMp,
      core: r.core, elements: r.elements, digimonId: r.digimonId, equippedForms: r.equippedForms,
      // The card's ledger has 44 cells; a Digimon that knows more forms (the enemy-only species are forms too)
      // keeps the rest in the companion snapshot the card was saved with, and they come back from there.
      formLedger: [...r.formLedger, ...overflowForms(r.formLedger, previous.formLedger)],
      rawLedger: r.rawRecord.slice(0x58, 0x3c8) };
  };
  const storedEquipment = (slot: number) => isNewPartner(slot)
    ? (snapshotFor(slot, oldEquipment, oldReserveEquipment) ?? {})
    : Object.fromEntries(Object.entries(roster[slot]!.equipment).filter(([, id]) => id !== 0));
  const reserveStats: Record<string, unknown> = {};
  const reserveEquipment: Record<string, unknown> = {};
  for (const r of roster) if (r.owned >= 3 && !partySlots.includes(r.slot)) {
    reserveStats[ROSTER_SLOT_CHARIDS[r.slot]!] = statsFor(r.slot);
    reserveEquipment[ROSTER_SLOT_CHARIDS[r.slot]!] = storedEquipment(r.slot);
  }
  const oldOwned = Number(snapshot.rosterOwned) || 0;
  for (let slot = 8; slot < ROSTER_SLOT_CHARIDS.length; slot++) {
    if (partySlots.includes(slot) || !(oldOwned & (1 << slot))) continue;
    const stats = statsFor(slot);
    if (stats) reserveStats[ROSTER_SLOT_CHARIDS[slot]!] = stats;
    reserveEquipment[ROSTER_SLOT_CHARIDS[slot]!] = storedEquipment(slot);
  }
  data.party = JSON.stringify(party);
  data.charId = party[0] ?? "";
  data.partyStats = JSON.stringify(partySlots.map(statsFor));
  data.partnerStats = JSON.stringify(partySlots.length ? statsFor(partySlots[0]!) : null);
  data.equipment = JSON.stringify(partySlots.map(storedEquipment));
  data.reserveStats = JSON.stringify(reserveStats);
  data.reserveEquipment = JSON.stringify(reserveEquipment);
  // the disc's eight from the card; the new partners' bits (8..) from the snapshot
  data.rosterOwned = String(roster.reduce((mask, r) => r.owned >= 3 ? mask | (1 << r.slot) : mask, 0) | (oldOwned & ~0xff));
  data.bits = String(mem.read32(PARTY_CONTEXT + 0x6c));
  data.inventory = JSON.stringify(bagFromItemArrays(readItemArrays(mem)));
  data.worn = JSON.stringify(Object.fromEntries(readItemArrays(mem).filter(e => e.worn).map(e => [e.id, e.worn])));
  data.playSeconds = String(mem.read16(PARTY_CONTEXT + 0x4c) * 3600 + mem.read16(PARTY_CONTEXT + 0x4e) * 60 + mem.read16(PARTY_CONTEXT + 0x50));
  data.engineFlags = JSON.stringify(readSaveFlags(mem, JSON.parse(data.engineFlags ?? "{}")));
  data.progressOrdinal = String(mem.read32(PARTY_CONTEXT + 0x263c));
  data.packId = ["A", "B", "C"][mem.read32(PARTY_CONTEXT + 0x2640)] ?? snapshot.packId ?? "A";
  const cardData = readSaveCards(mem);
  const previousCards = JSON.parse(data.cardCollection ?? "{}");
  data.cardCollection = JSON.stringify({ ...previousCards, owned: cardData.owned, seen: cardData.seen,
    folders: cardData.folders.map((f, i) => ({name: previousCards.folders?.[i]?.name ?? "", cards:f.cards})) });
  data.residentSaveImage = JSON.stringify(Array.from(image));
  return data;
}
