// Lossless resident save-image adapter. The card driver copies +0..+0x26C4;
// unexplained bytes are data, not disposable padding. See SAVELOAD-Q001-BLOCK-2026-10-04.
import { isFormDigimonId, rosterSlotDigimonId } from "./roster.ts";
import { NativeMemory } from "../native/memory.ts";
import { PARTY_CONTEXT, ROSTER_RECORDS, ROSTER_STRIDE, ROSTER_EQUIP_ENTRIES, rosterRecordAddress } from "./party-context.ts";
import { nativeFormIds } from "./ui/roster-form-state.ts";
export const RESIDENT_SAVE_SIZE = 0x26c4;
export const RESIDENT_ROSTER_COUNT = 8;
export const RESIDENT_FORM_COUNT = 44;
export const RESIDENT_FORM_SIZE = 0x14;
export interface SaveBytes { read8(a: number): number; write8(a: number, v: number): void }
/** Save/load both copy this exact interval; no discarded tail or reconstructed unknown cells. */
export function readSaveBlock(mem: Pick<SaveBytes, "read8">): Uint8Array {
  return Uint8Array.from({ length: RESIDENT_SAVE_SIZE }, (_, i) => mem.read8(PARTY_CONTEXT + i));
}
export function writeSaveBlock(mem: Pick<SaveBytes, "write8">, image: ArrayLike<number>): void {
  if (image.length !== RESIDENT_SAVE_SIZE) throw new Error("Invalid resident save image length");
  for (let i = 0; i < image.length; i++) mem.write8(PARTY_CONTEXT + i, image[i]!);
}
/** Read the entire eight-member roster, including empty ledger slots and opaque bytes. */
export function decodeSaveRoster(image: ArrayLike<number>, profiles: Uint8Array) {
  const mem = new NativeMemory();
  writeSaveBlock(mem, image);
  mem.load(profiles, 0x8003ef5c);
  const ids = nativeFormIds(mem);
  return Array.from({ length: RESIDENT_ROSTER_COUNT }, (_, slot) => {
    const r = rosterRecordAddress(slot);
    const current = mem.read32(r + 4);
    const ledger = Array.from({ length: RESIDENT_FORM_COUNT }, (_, index) => {
      const at = r + 0x58 + index * RESIDENT_FORM_SIZE;
      return { index, nativeId: mem.read16(at), id: ids.walkerIdOf(mem.read16(at)),
        formLevel: mem.read8(at + 2), preservedByte: mem.read8(at + 3), dvexp: mem.read32(at + 4),
        techSlots: Array.from({ length: 6 }, (_, j) => mem.read16(at + 8 + j * 2)) };
    });
    return { slot, owned: mem.read32(r), currentForm: current,
      digimonId: current ? ids.walkerIdOf(current) : rosterSlotDigimonId(slot),
      nameBytes: Array.from({ length: 24 }, (_, i) => mem.read8(r + 8 + i)),
      xp: mem.read32(r + 0x20), level: mem.read16(r + 0x24), tp: mem.read16(r + 0x26),
      hp: mem.read16(r + 0x28), maxHp: mem.read16(r + 0x2a), mp: mem.read16(r + 0x2c), maxMp: mem.read16(r + 0x2e),
      core: Array.from({ length: 6 }, (_, i) => mem.read16(r + 0x30 + i * 2)),
      elements: Array.from({ length: 7 }, (_, i) => mem.read16(r + 0x3c + i * 2)),
      equippedForms: Array.from({ length: 3 }, (_, i) => ids.walkerIdOf(mem.read16(r + 0x50 + i * 2))).filter(id => isFormDigimonId(id)),
      formLedger: ledger.filter(e => e.nativeId >= 3 && isFormDigimonId(e.id)), ledger,
      equipment: Object.fromEntries(ROSTER_EQUIP_ENTRIES.map(([key, off]) => [key, mem.read16(r + off)])),
      lastUltraDrill: mem.read8(r + 0x3d4),
      rawRecord: Array.from({ length: ROSTER_STRIDE }, (_, i) => mem.read8(r + i)),
    };
  });
}

/** Card data shares the resident save context with the party (album/folder decodes). */
export const SAVE_CARD_MAX = 0x13b;
export const SAVE_FOLDER_COUNT = 3;
export const SAVE_FOLDER_SIZE = 0x66;
export const SAVE_FOLDER_CARDS = 40;
export interface ResidentCards {
  owned: [number, number][];
  seen: number[];
  folders: { nameBytes?: number[]; cards: number[] }[];
}
export function seedSaveCards(mem: NativeMemory, cards: ResidentCards): void {
  const held = new Map(cards.owned);
  const seen = new Set(cards.seen);
  for (let id = 1; id <= SAVE_CARD_MAX; id++) {
    mem.write8(PARTY_CONTEXT + 0x3a2 + id, held.get(id) ?? 0);
    mem.write8(PARTY_CONTEXT + 0x4df + id, seen.has(id) ? 1 : 0);
  }
  for (let f = 0; f < SAVE_FOLDER_COUNT; f++) {
    const record = PARTY_CONTEXT + 0x628 + f * SAVE_FOLDER_SIZE;
    const folder = cards.folders[f];
    if (!folder) continue;
    if (folder.nameBytes) for (let i = 0; i < 0x16; i++) mem.write8(record + i, folder.nameBytes[i] ?? 0);
    for (let i = 0; i < SAVE_FOLDER_CARDS; i++) mem.write16(record + 0x16 + i * 2, folder.cards[i] ?? 0);
  }
}
export function readSaveCards(mem: NativeMemory): ResidentCards {
  const owned: [number, number][] = [];
  const seen: number[] = [];
  for (let id = 1; id <= SAVE_CARD_MAX; id++) {
    const n = mem.read8(PARTY_CONTEXT + 0x3a2 + id);
    if (n) owned.push([id, n]);
    if (mem.read8(PARTY_CONTEXT + 0x4df + id)) seen.push(id);
  }
  const folders = Array.from({ length: SAVE_FOLDER_COUNT }, (_, f) => {
    const at = PARTY_CONTEXT + 0x628 + f * SAVE_FOLDER_SIZE;
    return { nameBytes: Array.from({ length: 0x16 }, (_, i) => mem.read8(at + i)),
      cards: Array.from({ length: SAVE_FOLDER_CARDS }, (_, i) => mem.read16(at + 0x16 + i * 2)) };
  });
  return { owned, seen, folders };
}

// Stored-bank bases from the get_flag ladder (fns.s:6854-6932). The slice length
// is the interval until the next bank base, not a bound on get_flag's argument.
// Bits outside these slices overlap other banks in the original; the independent
// browser banks retain those extra bits in their companion snapshot.
export const SAVE_STORED_BANKS = [
  [0x02,0x2644], [0x04,0x2656], [0x06,0x2658], [0x08,0x2659],
  [0x0a,0x265a], [0x0c,0x265e], [0x0e,0x2666], [0x10,0x2672],
  [0x18,0x2676], [0x1a,0x2678], [0x1c,0x2681], [0x20,0x268c], [0x40,0x26aa],
] as const;
export function seedSaveFlags(mem: NativeMemory, flags: Record<string, string>): void {
  for (let row = 0; row < SAVE_STORED_BANKS.length; row++) {
    const [bank, start] = SAVE_STORED_BANKS[row]!;
    const value = flags[String(bank)];
    if (value === undefined) continue;
    const bytes = atob(value);
    const end = SAVE_STORED_BANKS[row + 1]?.[1] ?? RESIDENT_SAVE_SIZE;
    for (let i = 0; start + i < end; i++) mem.write8(PARTY_CONTEXT + start + i, bytes.charCodeAt(i) || 0);
  }
}
export function readSaveFlags(mem: NativeMemory, previous: Record<string, string>): Record<string, string> {
  const flags = { ...previous };
  for (let row = 0; row < SAVE_STORED_BANKS.length; row++) {
    const [bank, start] = SAVE_STORED_BANKS[row]!;
    const end = SAVE_STORED_BANKS[row + 1]?.[1] ?? RESIDENT_SAVE_SIZE;
    const bytes = Array.from(atob(previous[String(bank)] ?? btoa('\0'.repeat(64))), c => c.charCodeAt(0));
    for (let i = 0; start + i < end; i++) bytes[i] = mem.read8(PARTY_CONTEXT + start + i);
    flags[String(bank)] = btoa(String.fromCharCode(...bytes));
  }
  return flags;
}
