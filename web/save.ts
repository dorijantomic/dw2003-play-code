import { residentStorage } from "./vendor/engine.js";
import { checkSlot } from "./slot-check.js";
// web/save.js — the MEMORY CARD slot storage and record builder (STGMCARD overlay).
//
// The save/load screen itself is web/save-translated.js (engine MemcardSession);
// this module keeps what that file and the tests share: the three localStorage
// slots, writeSlot / readSlot / restoreSlotData and buildRecord.
//
// Identity (decoded 2026-08-05, docs/research/ui/stgmcard-decoded-2026-08-05.md):
// pro/stgmcard is the memory-card SAVE/LOAD screen, NOT the card battle game
// the master-plan census guessed. Its string bank is esmemcrd (bank base 0x78
// = LBA_MSMEMCRD 120) and its chrome pack is STMCRDCS/TM (handles
// 0x029D0000/0x029E0000 = LBA 669/670) whose art is literally three PS1
// memory cards, a console with its card slots, and eight per-starter save
// nameplates.
//
// EVERY coordinate, clip id, animation cadence and string on this screen comes
// from web/assets/data/stgmcard_ui.json, emitted by tools/extract_stgmcard_ui.py
// out of the overlay's own data section and decompiled draw functions. Nothing
// here is pixel-measured. The layout json is the single shared source of
// geometry for drawing, text and cursor hit positions.
//
// SCOPE / honesty: the walker has no PlayStation memory card. The original
// screen's three card columns are mapped onto three localStorage save slots,
// and the file record's fields (name / area / place / BIT / three party
// starters + levels / play time) are filled from the walker's own live state.
// The card-insert, format, block-count and read-error paths of the original
// flow have no walker equivalent and are not faked — their strings ship in the
// layout json but the screen never enters those states.
import { CHARID_TO_DIGID } from "./party.js";
import type { SaveEntry, SaveRecordOpts, SaveSlotWrite } from "./types/save.js";

let LAYOUT = null;
// Guarded so this module stays importable under `node --test` (no DOM there) —
// the same pattern as uifont.js / screenpack.js.
if (typeof Image !== "undefined") {
  fetch("assets/data/stgmcard_ui.json")
    .then((r) => r.json())
    .then((j) => { LAYOUT = j; })
    .catch(() => {});
}

/** Test seam: install the layout json without a browser fetch. */
export function __setLayout(json) { LAYOUT = json; }

/**
 * Test seams for the storage shim: seed and inspect raw slot bytes without a
 * browser. The save contract under test is byte preservation — every key the
 * snapshot is given, including keys no screen understands, must round-trip
 * unchanged — so the test needs raw string access, not parsed values.
 */
export function __setStoreItem(k: string, v) { store.setItem(k, String(v)); }
export function __getStoreItem(k: string) { return store.getItem(k); }
export function __clearStore() {
  for (let i = store.length - 1; i >= 0; i--) store.removeItem(store.key(i));
  memoryStore.clear();
}
export function __readSlotRaw(i: number) { return store.getItem(SLOT_KEY(i)); }

// Slot storage. Falls back to an in-memory map outside a browser so the
// save/load round trip is unit-testable.
const memoryStore = new Map();
const store = typeof localStorage !== "undefined" ? localStorage : {
  get length() { return memoryStore.size; },
  key: (i: string | number) => [...memoryStore.keys()][i] ?? null,
  getItem: (k) => (memoryStore.has(k) ? memoryStore.get(k) : null),
  setItem: (k, v) => { memoryStore.set(k, String(v)); },
  removeItem: (k) => { memoryStore.delete(k); },
};

export const SLOT_COUNT = 3;
const SLOT_KEY = (i: number) => `mcardSlot${i}`;
const LAST_SLOT_KEY = "mcardLastSlot";
const BLOCK_SLOT_KEY = "mcardBlockSlot";

// Keys the snapshot deliberately leaves alone: they describe the browser
// session (which renderer/asset mode the player picked, which slots exist),
// not the saved game.
const NON_GAME_KEYS = new Set([
  "assetMode", "mcardSlot0", "mcardSlot1", "mcardSlot2",
]);

function snapshotStorage() {
  const out = {};
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!NON_GAME_KEYS.has(k)) out[k] = store.getItem(k);
  }
  return out;
}

function restoreStorage(data) {
  for (let i = store.length - 1; i >= 0; i--) {
    const k = store.key(i);
    if (!NON_GAME_KEYS.has(k)) store.removeItem(k);
  }
  for (const [k, v] of Object.entries(data ?? {}) as [string, string][]) store.setItem(k, v);
}

/**
 * Write one walker save slot. Both screens use this so a file written by the
 * pro/stgmcard route (web/save-translated.js) is the same record the
 * former hand-authored screen read back, and vice versa:
 *   record — the 0x44 summary fields from buildRecord
 *   image  — the screen's own 0x26C4 save image, when it produced one (the
 *            native route's load path hands it back through the card host)
 *   data   — the localStorage snapshot the slot restores on load
 */
export function writeSlot(i: number, { record, image = null, data = null, playSeconds = null, residentImageVersion = 0, state = null }: SaveSlotWrite = {}) {
  if (!(i >= 0 && i < SLOT_COUNT)) return false;
  // The name on a save is the tamer's registered name — the account name the
  // player typed at the Online Center clerk (web/game.js takes it from the
  // registration wizard or the naming keyboard and reads it back here) — so a
  // new save persists it. Written BEFORE the snapshot is taken, so the slot the
  // player loads later restores the same name and the live session keeps
  // showing the name on its file card. The title's Continue does NOT read it:
  // Continue always opens this screen in LOAD mode, saved or not.
  if (record?.name) store.setItem("playerName", String(record.name));
  const entry = {
    record: record ?? null,
    data: data ?? snapshotStorage(),
    savedAt: Date.now(),
  } as SaveEntry;
  if (state) {
    for (const key of ["playerName", "bits", "playSeconds", "rosterOwned", "progressOrdinal", "packId", "charId", "party", "partyStats", "partnerStats", "equipment", "reserveStats", "reserveEquipment", "digimonNames", "inventory", "worn"]) {
      const value = state[key];
      if (value !== undefined) entry.data[key] = typeof value === "object" ? JSON.stringify(value) : String(value);
    }
  }
  if (image) { entry.image = Array.from(image); if (residentImageVersion) entry.residentImageVersion = residentImageVersion; }
  if (playSeconds !== null) store.setItem("playSeconds", String(Math.floor(playSeconds)));
  store.setItem(SLOT_KEY(i), JSON.stringify(entry));
  store.setItem(LAST_SLOT_KEY, String(i));
  // The card's directory block describes the last-SAVED slot: the original
  // stamps its +1 byte at save time (stgmcard.s .L0x00003840-.L0x00003848) and
  // reads it back on every card open, selecting that slot; a load never rewrites
  // it. LAST_SLOT_KEY stays the "last used" slot the rollback screen opens on.
  store.setItem(BLOCK_SLOT_KEY, String(i));
  return true;
}

/** Restore a slot's localStorage snapshot into the live store. */
export function restoreSlotData(i: number, profiles = null) {
  const slot = readSlot(i);
  if (!slot) return false;
  // With the switch on, the entry is checked once more before restoreStorage
  // clears a single live key: a damaged file must never reach the store.
  if (saveVerifyOn()) {
    const check = checkSlot(slot);
    if (!check.ok) { refuseSlot(i, check, store.getItem(SLOT_KEY(i))); return false; }
  }
  restoreStorage(slot.residentImageVersion === 1 && profiles
    ? residentStorage(slot.image, profiles, slot.data) : slot.data);
  return true;
}

// ── Card verify (F2 -> Extras -> "Card verify", off by default) ─────────────
// A slot is checked for shape and honest numbers before it is trusted
// (web/slot-check.js). A damaged entry reads as no file — the card's own dash
// row — and its raw text is kept under the Save Doctor's quarantine key so a
// later look can still see what the browser held.
const QUARANTINE_KEY = "dw.quarantine.v1";

function saveVerifyOn() {
  return typeof window !== "undefined" && window.__fx?.saveverify === true;
}

// The last refused check, so a load's caller can record the disc's code.
let lastRefusal: { ok: boolean; code: number; empty: boolean; why: string; slot: number; } | null = null;
/** {slot, ok, code, empty, why} of the last refused entry, or null. */
export function lastSlotRefusal() { return lastRefusal; }

// The last parsed+checked entry per slot. The slot chooser reads all three
// slots on every drawn frame; with the switch on, a 0x26C4 image is a 9,924-value
// scan, so a hit on the same raw text skips both the parse and the check.
const checkedRaw = new Map();    // slot -> {raw, entry, check}  (entry null = refused)

function refuseSlot(i: number, check: { ok: boolean; code: number; empty: boolean; why: string; }, raw: string) {
  lastRefusal = { slot: i, ...check };
  if (typeof raw !== "string") return;
  try {
    let kept = {};
    try { kept = JSON.parse(store.getItem(QUARANTINE_KEY) ?? "{}"); } catch { kept = {}; }
    if (kept === null || typeof kept !== "object" || Array.isArray(kept)) kept = {};
    if (kept[SLOT_KEY(i)] === raw) return;      // this raw text is already kept
    kept[SLOT_KEY(i)] = raw;
    store.setItem(QUARANTINE_KEY, JSON.stringify(kept));
  } catch { /* storage blocked or full: the refusal itself still stands */ }
}

export function readSlot(i: number) {
  let raw = null;
  try {
    raw = store.getItem(SLOT_KEY(i));
    if (raw === null || raw === undefined || raw === "") return null;
    // Switch off: exactly today's read.
    if (!saveVerifyOn()) return JSON.parse(raw);
    const prior = checkedRaw.get(i);
    if (prior && prior.raw === raw) {
      if (!prior.entry) lastRefusal = { slot: i, ...prior.check };
      return prior.entry;
    }
    const entry = JSON.parse(raw);
    const check = checkSlot(entry);
    if (!check.ok) {
      refuseSlot(i, check, raw);
      checkedRaw.set(i, { raw, entry: null, check });
      return null;
    }
    checkedRaw.set(i, { raw, entry, check });   // an empty file (check.empty) is today's read
    return entry;
  } catch {
    if (saveVerifyOn()) {
      const check = { ok: false, code: 8, empty: false, why: "entry is not JSON" };
      if (typeof raw === "string") refuseSlot(i, check, raw);
      else lastRefusal = { slot: i, ...check };
      checkedRaw.set(i, { raw, entry: null, check });
    }
    return null;
  }
}

/**
 * Build the save record the original screen displays. Field names mirror the
 * decoded per-slot record (stride 0x44) so the mapping stays legible:
 *   +0x00 name, +0x18 area string idx, +0x1C place string idx, +0x20 BIT,
 *   +0x28/+0x2A/+0x2C play h/m/s, +0x30.. party starter types,
 *   +0x3C.. party levels.
 */
export function buildRecord(state, opts: SaveRecordOpts = {}) {
  const L = LAYOUT;
  const byType = L?.file_card?.party?.digimonIdByType ?? {};
  const typeOf = (digimonId) => {
    for (const [t, id] of Object.entries(byType)) {
      if (id === digimonId) return Number(t);
    }
    return -1;
  };
  const party = (state?.party ?? []).slice(0, 3);
  const stats = state?.partyStats ?? [];
  const seconds = Math.max(0, Math.floor(opts.playSeconds ?? 0));
  // The record stores bank INDICES, not text. Resolve the caller's names
  // against the two banks the original indexes (esstarea for the city, and
  // esshpnam -- whose tail is every inn/save point -- for the place). An
  // unmatched name keeps index 0, whose string is "" and therefore leaves the
  // descriptor's dash placeholder standing rather than inventing an entry.
  // Walker map names combine two things the area bank lists separately
  // ("Central Sector  Asuka City" -- both "Central Sector" and "Asuka City"
  // are esstarea entries). An exact hit wins; otherwise the LAST contained
  // entry wins, which picks the trailing, more specific component.
  const bankIndex = (bank, name: string | undefined) => {
    if (!name) return 0;
    const entries = bank ?? [];
    const exact = entries.indexOf(name);
    if (exact > 0) return exact;
    let best = 0, bestAt = -1;
    for (let i = 1; i < entries.length; i++) {
      if (!entries[i]) continue;
      const at = name.lastIndexOf(entries[i]);
      if (at < 0) continue;
      if (at > bestAt || (at === bestAt && entries[i].length > entries[best].length)) {
        best = i;
        bestAt = at;
      }
    }
    return best;
  };
  return {
    name: state?.playerName || "",
    areaIndex: opts.areaIndex
      ?? bankIndex(L?.strings?.areaBank?.all, opts.areaName),
    placeIndex: opts.placeIndex
      ?? bankIndex(L?.strings?.placeBank?.all, opts.placeName),
    // Kept for the CITY row only, so an unmatched walker map still names where
    // the file was saved. The place row has no fallback: its bank is the
    // specific save-point list, and inventing an entry for it would be a
    // guess, so an unmatched map leaves the descriptor's dash placeholder.
    areaText: opts.areaName ?? "",
    bits: Math.max(0, Number(state?.bits) || 0),
    hours: Math.min(99, Math.floor(seconds / 3600)),
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
    // state.party holds manifest character ids ("p003pken"); CHARID_TO_DIGID
    // is the single source of truth for the digimon.json id behind each.
    partyTypes: [0, 1, 2].map((i) => typeOf(CHARID_TO_DIGID[party[i]] ?? -1)),
    partyLevels: [0, 1, 2].map((i) => Number(stats[i]?.level) || 0),
  };
}
