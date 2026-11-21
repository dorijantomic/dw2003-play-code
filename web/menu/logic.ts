import { formLedgerRecord } from "../dri-model.js";
import { profileTechSlots } from "../form-tech-slots.js";
import {
  wornCount,
  syncWornFromEquipment,
  EQUIP_SLOTS as EQUIP_ROW_SLOTS,
  rosterSlotOfCharId,
  ITEM_BY_ID,
  EQUIPMENT_BY_ID,
  pauseEquipListIds,
  heldCount,
  equipmentBonuses,
} from "../vendor/engine.js";
import { syncLeadEquipBonuses, elementValueWithGear } from "../party.js";
import { EQUIP_SLOT_KEYS, RES_ROWS, STAT_ROWS } from "./pure.js";

import type { GameState } from "../game/types.js";
export function clampIndex(i: number, n: number) {
  if (n <= 0) return 0;
  return Math.max(0, Math.min(n - 1, i));
}

// A press that cannot move the cursor makes NO sound. CONFIRMED twice in the
// original, on two different screens and two different overlays: the resident
// home list guards its SFX with `if (temp_s3 != arg0->unk58)`
// (F0x8001270c.c:168), and the ITEMS bag guards BOTH its page step and its
// row/column step the same way (F0x80092524.c:63,126). Every list in this file
// moves through here, so the guard cannot be forgotten on the next screen.
// `cue` is the list's own cursor word: the general lists play 0x8004513E
// (system02), the PARTY-CARD lists play 0x4001B (system06) — see
// pause-home-button-table-2026-10-04.md §2, "0x4001B = the cursor stepped, on
// a party-card list".
export function moveCursor(from: number, to: number, sfx: { play: (arg0: string) => void; } | null, cue = "system02") {
  if (to !== from) sfx?.play(cue);
  return to;
}

// The five pause ITEMS tabs ARE the original's five item-ID directories: the tab
// rows walk the pointer table at 0x80042BC8 (F0x800135E8), so Items is directory 1
// (consumables, disks/plugs, booster packs), Weapons 2, Armor 3, Accessories 4 and
// Important Items 0 (the key/story band). That is also why the rows come out in
// item-id order rather than in the order the bag happened to be filled, and why a
// category holds exactly what the original's held count says it holds. The old
// hand-written `itemCategory` classifier had the same five bands (its "effect ==
// none" test is precisely directory 0's 51 ids) but no order and no cap.
//
// The kinds are the original's own TAB WORDS (0x8009A890 = 1, 0x80000002,
// 0x80000003, 0x80000004, 0): the three gear tabs carry bit 31, "list worn items
// too" — a weapon the party wears but no longer carries is still listed there.
// F0x800135E8 masks the category and reads the SIGN as that flag, which is why
// the engine's listItemIds takes the tab word itself (the int32 is negative).
export const ITEM_CAT_KINDS = [1, 0x80000002, 0x80000003, 0x80000004, 0];

// Real per-effect result strings (esstatus.toml 82-99).
//
// The figure is the applier's own `used`: the original prints the ROLL beside a
// chip's line even when the table cap clipped the real rise (`$s3` is the roll and
// the clamp at ststatus :12960 never touches it), so `result.amount` wins over a
// before/after difference here. `before`/`after` are still the fallback for a
// result that carries no amount. The clipped HEAL arm is the exception: its
// constant 0x52 carries no figure at all (see below).
export function useMessage(item, before, after, result) {
  const eff = item?.effect ?? "";
  if (eff === "full_hp") return "HP healed to maximum.";
  if (eff === "hp") {
    // The clipped arm is the disc's own constant line and carries NO figure:
    // ststatus :12934 sets string 0x52 and :12935 jumps to the tail with flag 2,
    // never running the 0x118 amount call. A Power Charge that restores 5 of its
    // 500 says "HP healed to maximum.", not "500 HP healed.".
    if (result?.clipped) return "HP healed to maximum.";
    return `${result?.amount ?? (after?.hp ?? 0) - (before?.hp ?? 0)} HP healed.`;
  }
  if (eff === "mp") return `${result?.amount ?? (after?.mp ?? 0) - (before?.mp ?? 0)} MP healed.`;
  const STAT_MSG = {
    stat_hp: "Max HP increased by {1}.", stat_mp: "Max MP increased by {1}.",
    stat_str: "Strength increased by {1}.", stat_def: "Defense increased by {1}.",
    stat_spt: "Spirit increased by {1}.", stat_wis: "Wisdom increased by {1}.",
    stat_spd: "Speed increased by {1}.", stat_chr: "Charisma increased by {1}.",
    elem_fire: "Fire Tolerance increased by {1}.", elem_water: "Water Tolerance increased by {1}.",
    elem_ice: "Ice Tolerance increased by {1}.", elem_wind: "Wind Tolerance increased by {1}.",
    elem_thunder: "Thunder Tolerance increased by {1}.", elem_machine: "Machine Tolerance increased by {1}.",
    elem_dark: "Dark Tolerance increased by {1}.",
  };
  if (eff === "tp") return `TP increased by ${item.value}.`;
  if (STAT_MSG[eff]) {
    const key = eff.startsWith("stat_") ? eff.slice(5) : null;
    // Permanent boosts live in `bonuses` (the chip contribution), so compare
    // that key only; the old top-level fallback read a different number and
    // produced a nonsense delta once a new bonus key appeared.
    const delta = Number.isFinite(Number(result?.amount))
      ? Number(result.amount)
      : key
        ? (Number(after?.bonuses?.[key] ?? 0) - Number(before?.bonuses?.[key] ?? 0))
        : Number(item.value);
    return STAT_MSG[eff].replace("{1}", String(Number.isFinite(delta) ? delta : item.value));
  }
  return "No effect.";
}

// SORT = real formation change: swap two party slots everywhere index-aligned
// state lives (party, partyStats incl. the lead's live partnerStats, equipment).
export function swapFormation(state: GameState, a: number, b: number) {
  const swap = (arr) => { if (Array.isArray(arr)) { const t = arr[a]; arr[a] = arr[b]; arr[b] = t; } };
  // materialize the lead's live stats into the array view before swapping
  if (state.partyStats) state.partyStats[0] = state.partnerStats ?? state.partyStats[0];
  swap(state.party); swap(state.partyStats); swap(state.equipment);
  if (a === 0 || b === 0) {
    state.partnerStats = state.partyStats?.[0] ?? state.partnerStats;
    state.charId = state.party?.[0] ?? state.charId;
    const nextIndex = state.manifest?.characters?.findIndex((c: { id: string | null; }) => c.id === state.charId) ?? -1;
    if (nextIndex >= 0) state.charIdx = nextIndex;
    const select = typeof document !== "undefined" ? document.getElementById("charSelect") as HTMLSelectElement | null : null;
    if (select && nextIndex >= 0) select.selectedIndex = nextIndex;
    localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
    if (state.charId) localStorage.setItem("charId", state.charId);
  }
  localStorage.setItem("party", JSON.stringify(state.party));
  localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
  localStorage.setItem("equipment", JSON.stringify(state.equipment ?? []));
}

// The six technique slots of one digivolution, as F0x80089bf0 state 0x2B reads
// them: exactly six, low 13 bits are the technique id, zero means empty. The
// cursor may only rest on a non-empty slot.
export function formTechSlots(stats, formId, digimonDB) {
  const record = formLedgerRecord(stats, formId, digimonDB ?? {});
  const words = record?.techSlots ?? [];
  return Array.from({ length: 6 }, (_, i) => (Number(words[i] ?? 0) & 0x1fff) || 0);
}

// The badge beside a technique slot is NOT the element. F0x800895c8.c:60 draws
// cmfont clip `((tech_id - 1) * 0x12 + 0x80042BDC)->unk4 + 0x37` — the +4 byte
// of the technique record, which `tools/build_battle_data.py` already parses as
// `attack_cat`. That byte takes exactly five values across all 443 records
// (2..6 -> clips 0x39..0x3D), and every one of those clips is in the extracted
// cmfont pack.
//
// Reading it as the ELEMENT was the bug behind "machine and dark cannot be
// drawn": elements run 1..8, so machine and dark asked for clips 0x3E and 0x3F,
// and the disc's cmfont sprite directory has 94 clips whose id list skips both
// (verified in ~/ddw3/pack/dw2003/country/cmfontcs/0/1.bin). The original never
// asks for them. It also never asks for 0x37 or 0x38, which an element-driven
// badge would have needed for "normal" — 270 of our skills carry that element,
// so an element badge could not have been what the original draws.
//
// Fire happens to be element 2 AND most fire moves are attack_cat 2, which is
// why Kotemon's "Hot Head" landed on the right clip (0x39) under the old
// reading and hid the mistake.
export function techBadgeClip(tech) {
  const cat = Number(tech?.attack_cat);
  return Number.isFinite(cat) && cat > 0 ? 0x37 + cat : null;
}

// The partner's OWN six technique slots, for the state where no candidate is
// highlighted. The signature technique sits in the LAST slot: capture
// 03-choose-digivolve.png shows Kotemon's only technique, "Hot Head", on row 5,
// and the decoded form-ledger record marks slot 5 with 0x8000.
export function ownTechSlots(profile) {
  return profileTechSlots(profile);
}

// Is this digivolve row the partner's CURRENT form? The original compares the
// roster record's current-form field (+0x04) against the highlighted form id
// (F0x8008886c); the walker persists that same field as stats.digimonId, which
// partyRosterView surfaces as the entry's digimonId.
export function isCurrentForm(rosterEntry, evo) {
  const cur = Number(rosterEntry?.digimonId ?? 0);
  const target = Number(evo?.formId ?? 0);
  return cur !== 0 && target !== 0 && cur === target;
}

// The action label the original draws for the highlighted digivolve row.
export function battleDigivolveLabel(rosterEntry, evo) {
  return isCurrentForm(rosterEntry, evo) ? "Battle Digivolve Off" : "Battle Digivolve On";
}

// ── equipment helpers (module-level: shared by handleKey and draw) ──

// How many of one item the party is WEARING right now. This is the bag band's
// left number: F0x8008f0dc fills it from `(item_id + 0x80048D34)->unk20F`, a
// per-item count, and the rig capture shows "Equip 0" beside Power Charge, a
// consumable nobody can wear. That count is the shared store's stored worn byte
// (engine/dw3/item-store.ts), the second of the original's two count arrays, so
// this is the stored number and not a count of the wearer record.
/**
 * The equip sheet's second description line: the item's own wield descriptor.
 * The equip-stat record's byte +0x2 indexes the 8-word string table at
 * 0x8009a7c4 (ststatus F0x800867b8 at 0x3bb4-0x3bc8); the table's string ids
 * are 67,77,79,65,66,68,80,68 -- Right, Left, Left or Right, Head, Body,
 * Accessory, Two-handed, Accessory. `names` is `status_ui.json`'s
 * `wield_names`, in that order. Returns null when there is no such item.
 */
export function wieldNameFor(eq, names) {
  const idx = eq?.statBytes?.[2];
  if (!Array.isArray(names) || !Number.isInteger(idx) || idx < 1 || idx > names.length) return null;
  return names[idx - 1] ?? null;
}

export function equippedCountOf(state: GameState, itemId: number) {
  ensureEquipment(state);
  return wornCount(state, Number(itemId));
}

export function ensureEquipment(state: GameState) {
  if (!Array.isArray(state.equipment) || state.equipment.length !== (state.party?.length ?? 0)) {
    state.equipment = (state.party ?? []).map((_, i: string | number) => state.equipment?.[i] ?? {});
    // The wearer record was replaced wholesale, so the stored worn byte array is
    // rebuilt from it (the invariant the original's four writers keep).
    syncWornFromEquipment(state);
  }
}

// Only the lead (index 0) has battle-tracked stats in this engine (state.partnerStats),
// so only the lead's equip bonuses actually affect combat maths (battle.js reads
// ps.equipBonuses alongside the permanent chip ps.bonuses).
export function syncEquipBonuses(state: GameState, idx: number) {
  if (idx !== 0) return;
  syncLeadEquipBonuses(state);
}

// The pause menu's own bag and worn writes go through the shared store: the
// equip/unequip moves (F0x8009A5E4 / 0x8009A504) put one worn byte up or down in
// the same step as the carried copy, and every count they touch keeps the 99 cap
// and the 0 floor because those live in the store too.

// The pause EQUIP page's item list, in the order the original shows it.
//
// The whole list — which ids a row may even offer, which of those the member may
// wear, and where the take-off row sits — is ONE port of the original
// (`pauseEquipListIds` in engine/dw3/equipment.ts, from pro/ststatus
// F0x80099F84 / F0x80099FF8 / F0x8009A1BC / F0x8009A344 / F0x8008744C), shared
// with the translated pause page's own `wieldCompatible`. Three things that port
// fixes here, all visible on this panel:
//
//   * a TWO-HANDED weapon is offered in BOTH hand lists (the left row included),
//     not the right one only;
//   * a piece the member's starter line may not wear is REFUSED, and refused
//     rows come after the accepted ones rather than being dropped;
//   * the take-off row is the FIRST row of every list, and it is there even when
//     the slot is empty (`sh $v0, 0x78($s3)` with `li $v0, -1`, unconditional).
export function equipPickOptions(state: GameState, partyIdx: number, slotKey: string | undefined) {
  ensureEquipment(state);
  const row = EQUIP_ROW_SLOTS.indexOf(slotKey);
  const line = rosterSlotOfCharId(state.party?.[partyIdx] ?? "");
  const equippedId = state.equipment[partyIdx]?.[slotKey];
  const eqName = equippedId != null
    ? ITEM_BY_ID[equippedId]?.name ?? EQUIPMENT_BY_ID[equippedId]?.name ?? "?"
    : null;
  return pauseEquipListIds(line, row, (id) => heldCount(state, id) !== 0).map((id) => (
    id === -1
      ? { unequip: true, name: eqName != null ? `Unequip (${eqName})` : "Unequip" }
      : { id, name: ITEM_BY_ID[id]?.name ?? EQUIPMENT_BY_ID[id]?.name }
  ));
}

export function previewEquipment(state: GameState, m: { detailIdx: string | number; equipCursor: string | number; equipFocus: string; }) {
  const equipped = { ...(state.equipment[m.detailIdx] ?? {}) };
  const slotKey = EQUIP_SLOT_KEYS[m.equipCursor];
  const snapshot = { ...equipped };
  const preview = { ...equipped };
  if (m.equipFocus === "list") delete preview[slotKey];
  return { snapshot, preview };
}

export function sheetStatValue(p, slots: Record<string, number>, stat: string, rosterSlot = null) {
  // The total the original's roster record would hold: stored + the permanent
  // chip rise (the walker keeps chips in `bonuses` — engine/dw3/items.ts writes
  // the rise there — and the record itself already carries them on the disc),
  // with the worn gear folded on top (F0x80017174). Reading `stats` alone
  // under-reported every chipped member by the chip's amount.
  // The base is the record's own halfword — partyRosterView's `core`, i.e.
  // storedNumbers() (web/party.js), which rebuilds stored + chips off the
  // STARTER's row. Rebuilding it here from p.stats/p.profile fell back to the
  // WORN form's row (partyRosterView's `profile`) for a member with no stored
  // stats, so the sheet printed a digivolution's base as if it were stored.
  const i = STAT_ROWS.indexOf(stat);
  const stored = Array.isArray(p?.core) ? p.core[i] : null;
  const base = stored != null
    ? Number(stored) || 0
    : Number(p?.stats?.[stat] ?? p?.profile?.[stat] ?? 0) + Number(p?.bonuses?.[stat] ?? 0);
  const b = equipmentBonuses(slots, rosterSlot);
  return Math.min(999, base + (b[stat] ?? 0));
}

/**
 * The STATUS sheet's element number: the one value the original's F0x80017174
 * scratch holds at +0x18..+0x24 — the species base plus every trained point
 * plus the worn gear's coded resist, capped at 999. Read through the shared
 * helper (web/party.js elementValueWithGear, over engine/dw3/effective-stats.ts's
 * elementValue) so the sheet, the shop, the gym and the battle divisor cannot
 * drift apart. The sheet never floors, because F0x8008C1C0 only caps.
 */
export function sheetResValue(p, slots: Record<string, number>, res: string) {
  const b = equipmentBonuses(slots);
  const i = RES_ROWS.indexOf(res);
  // The base is the record's own halfword — partyRosterView's `elements`, i.e.
  // storedNumbers() (web/party.js): the STARTER's species base plus every trained
  // point, 999-capped. The worn piece's coded resist is ADDED to it by F0x80017578,
  // never in place of it, so it can only go in as the point table. Passing
  // p.profile here put the WORN form's resistance row underneath the trained
  // points — and dropped them, because a roster entry carries no `elemBonuses`.
  const stored = Array.isArray(p?.elements) ? p.elements[i] : null;
  if (stored != null) {
    return elementValueWithGear({ resistances: { [res]: stored } }, null, b.elemResists, res);
  }
  // A hand-built block with no record halfword: nothing else to stand on.
  return elementValueWithGear(p?.profile, p?.elemBonuses, b.elemResists, res);
}

// The See Digivolve panel's numbers (F0x80088A44). Both of its branches read the
// PARTNER's own live block — the same F0x80017174 copy the status sheet shows,
// so the same stored-plus-chips-plus-worn-gear rule — and with a candidate
// highlighted they ADD the candidate species record's per-stat field (+2
// onward) and per-resistance field (+0xe onward), clamping the sum at 999. With
// no candidate the species part is simply absent. These two helpers exist so the
// fold cannot drift from the sheet's: they call the sheet's own readers.
export function seeDigivolvePanelStat(p, slots: Record<string, number>, stat: string, rosterSlot: number | null | undefined, formProfile = null) {
  return Math.min(999, sheetStatValue(p, slots, stat, rosterSlot) + Number(formProfile?.[stat] ?? 0));
}

export function seeDigivolvePanelRes(p, slots: Record<string, number>, res: string, formProfile = null) {
  return Math.min(999, sheetResValue(p, slots, res) + Number(formProfile?.resistances?.[res] ?? 0));
}
