// web/menu.js — the pause/status menu, rendered with the REAL ststatus chrome.
//
// Layout/flow decoded from a full m2c decompile of the ststatus overlay
// (exe-decomp/ststatus_c/, RAM base 0x80082cb0) — the same treatment
// shop.js got from stitshop. Every clip id / coordinate below comes from
// tools/extract_status_ui.py → assets/data/status_ui.json (provenance in the
// tool header): party cards are CMFONTCS clips 0x15/0x16/0x17 (frames only;
// LV/HP/MP are kind-3 text from the label table), portraits animate through the
// sequence table at 0x8009a9c0 every 13 vsyncs, the orange selection corners
// (ststat clip 0x1e) animate by CLUT-row cycling every 9 vsyncs, the home
// menu window is ststat clip 45 @ (148,47) with rows at (177, 65+14i).
//
// Screens: home (draw F0x800946bc / ctor F0x80093e84), status detail
// (F0x8008c954 / F0x8008b520), items bag (F0x80092fac / F0x80091e94),
// techniques (F0x80083c94 / F0x80083680), full EQUIP screen (F0x80086dd4 /
// F0x80086498 — 2026-07-10c re-audit), sort (F0x80096988). Data side
// (stats/resistances/items/equipment) was already byte-exact — see
// docs/research/ui/status-menu-decoded-2026-07-03.md.
//
// Windows FOLD open/closed via the decoded tween F0x80099d5c ([0x8009b5d8]):
// 0..0x1000 over 10 vsyncs (close doubled), sp9C scale around the per-window
// spA4 pivot, SFX SYSTEM03/SYSTEM04. Pivots come from status_ui.json; only
// windows whose pivots were transcribed fold (the rest draw instantly).
import { paintScreenDim } from "./screendim.js";
import { asButton } from "./input.js";
import {
  ITEM_BY_ID, useItem, itemUsableInField, EQUIPMENT_BY_ID, EQUIP_SLOTS as EQUIP_ROW_SLOTS, equipItem, unequipItem, equipmentBonuses, ui,
  pauseEquipListIds, pauseEquipRowAdmits, rosterSlotOfCharId, elementValue,
  fieldTechniqueRows, isPartyWide, useFieldTechnique, HEAL_SCALE_STAT,
  listScrollbarThumb, padRepeatFires, screenIdForStage,
  listItemIds, heldCount, wornCount, commitEquipSlot, syncWornFromEquipment,
} from "./vendor/engine.js";
import { partyRosterView, baseStatsFor, CHARID_TO_DIGID, syncLeadEquipBonuses } from "./party.js";
import { profileTechSlots } from "./form-tech-slots.js";
import { formLedgerRecord } from "./dri-model.js";
import { dvLevelForExp } from "./battle.js";
import { drawText, textWidth, drawCursor, drawIconGlyph } from "./uifont.js";
import { loadPack, drawClip, drawClipAtPaletteRow } from "./screenpack.js";
import { digivolveDemoOn, setDigivolveDemo } from "./blast-presentation.js";
import { createStatusBackdrop } from "./status-backdrop.js";
import { drawItemIcon } from "./itemicons.js";

// Real top-menu strings (lang_file/dw2003/eng/esstatus.toml 6-11). CARD FOLDERS
// is string 11, the 6th entry, gated by the card-game unlock. UNKNOWN U-04:
// the original writer of that flag was not in the scanned C/asm.
const TOP_ITEMS_BASE = ["ITEMS", "SORT", "MAP", "TECHNIQUES", "STATUS"];
const CARD_FOLDERS = "CARD FOLDERS";               // esstatus string 11

// The Card Folders sub-entries, both real game strings:
//   "Card Album"  — escrdabm string 1
//   "Edit Folder" — escrdshp string 7
const CARD_FOLDER_ROWS = ["Card Album", "Edit Folder"];

// The Digivolve Demo setup screen. Its title, its two choices and its
// explanation are the game's own strings (esstatus 0x46/0x47/0x48/0x49); what
// the disc does NOT have is any way to open it — the pause menu's cursor stops
// one row short of it in both menu variants
// (ledger UI-DEMO-SETUP-SCREEN-HAS-NO-SELECTOR-WRITE-2026-08-14).
//
// So this row is OFF by default: the shipped menu stays exactly as authentic as
// it was. Turn it on with localStorage `demoSetupRow` = "1" or `?demoSetup=1`.
// It is also always reachable from the UI lab, which is a debug surface.
const DEMO_SETUP_TITLE = "Digivolve Demo";
const DEMO_SETUP_ROWS = ["ON", "OFF"];
const DEMO_SETUP_HINT = "Setup the Battle Digivolve demo";
const DEMO_SETUP_LABEL = "Demo Setup";   // esstatus 0x2F

function demoSetupRowEnabled() {
  try {
    if (localStorage.getItem("demoSetupRow") === "1") return true;
    return new URLSearchParams(location.search).get("demoSetup") === "1";
  } catch { return false; }
}



/** The visible top menu. CARD FOLDERS appears only once the player has cards. */
function topItems(m) {
  const rows = m?.cardFolderUnlocked?.() ? [...TOP_ITEMS_BASE, CARD_FOLDERS] : TOP_ITEMS_BASE;
  // Deliberately NOT authentic — see DEMO_SETUP_TITLE above. Off unless opted in.
  return demoSetupRowEnabled() ? [...rows, DEMO_SETUP_LABEL] : rows;
}
// esstatus strings 1-4, the party-card LV/HP/MP/"/" widgets at
// status_ui.json card_labels.static. The chrome clips are window frames; the
// letters are drawn as text, not baked into the art.
export const CARD_STAT_LABELS = Object.freeze({ 1: "LV", 2: "HP", 3: "MP", 4: "/" });
// esstatus 17/18 — SORT uses the shared header plate, not a right-hand window
// (pause-menu-screen-tree §3 / F0x80096590).
export const SORT_HEADERS = Object.freeze({ pick: "Switch who?", with: "Switch with who?" });

// F0x800986c0: 2 on a fresh press, 4 once the hold counter is >= 5, 0 on
// release. Two speeds, not a 2/3/4 ramp. JSON has speed_initial / speed_max;
// the 5 is the `>= 5` compare in that input fn (ststatus overlay write-up).
export const MAP_HOLD_FRAMES = 5;
export function mapHoldSpeed(framesHeld, C = { speed_initial: 2, speed_max: 4 }) {
  if (!(framesHeld > 0)) return 0;
  return framesHeld >= MAP_HOLD_FRAMES ? C.speed_max : C.speed_initial;
}

// Pad service repeat curve: edge, then 16, then 6, then every 4. Defined once
// in the engine (engine/systems/input-map.ts) and re-exported here because the
// pause menu and its tests import it from this module.
// docs/research/ui/pad-input-service-behaviour-2026-08-21.md
export { PAD_REPEAT, padRepeatFires } from "./vendor/engine.js";

/** A walker map id ("s205", 205) as the key the decoded walker_map table uses. */
const stageKey = (stage) => String(Number(String(stage ?? "").replace(/\D/g, "")) || 0);

export function mapPs1Id(state, ui = UI) {
  const walkerStage = stageKey(state?.manifest?.maps?.[state?.mapIdx]?.id);
  const wm = ui?.screens?.map?.walker_map?.[walkerStage];
  return wm?.ps1 ?? 0x200;
}

/** The one flag both MAP pages ask about: F0x8009A6B8 reads
 *  get_flag((stage & 0xff) | 0x2000, 1), and the field entry writes
 *  0x1E00 + screenId (pro/fieldstg.s .L0x00008008-.L0x00008028). Over every field
 *  screen id (0x200..0x2EE in data/screen_table.json) those two spellings are the
 *  same number, so one bank-0x20 bit per place answers both. The page's own scan
 *  only reaches 0x2D6 — MAP is refused from 0x2D7 up (mapUnavailable). */
export const mapSeenFlag = (ps1) => 0x2000 | (ps1 & 0xff);

/** The PS1 stage ids the flag store says you have walked into. `hasFlag` is the
 *  engine's banked store — the same store the field entry writes. Without one (the
 *  ui-lab and the unit tests, where no engine exists) the old saved list is read
 *  instead; nothing writes that list any more, so it only ever holds an old save. */
export function visitedPs1Stages(state, ui = UI, hasFlag = null) {
  const walker = ui?.screens?.map?.walker_map ?? {};
  const seen = new Set();
  if (hasFlag) {
    for (const row of Object.values(walker)) {
      if (Number.isInteger(row?.ps1) && hasFlag(mapSeenFlag(row.ps1))) seen.add(row.ps1);
    }
  } else {
    for (const stage of state?.visitedMaps ?? []) {
      const ps1 = walker[stageKey(stage)]?.ps1;
      if (Number.isInteger(ps1)) seen.add(ps1);
    }
  }
  const own = walker[stageKey(state?.manifest?.maps?.[state?.mapIdx]?.id)]?.ps1;
  if (Number.isInteger(own)) seen.add(own);
  return [...seen];
}
/** What the translated MAP page needs from the walker: the PS1 stage id it stands in and
 *  the PS1 ids of every map already visited (the page's own "seen" flag is
 *  0x2000|(id & 0xff), filled by F0x8009A6B8). */
export function pauseMapContext(state, ui = UI, hasFlag = null) {
  return { stage: mapPs1Id(state, ui), seen: visitedPs1Stages(state, ui, hasFlag) };
}

/** One-time migration for a save written before the page read the flag store: an old
 *  `visitedMaps` list becomes the bits the field would have written. The original has
 *  no such step — it only ever had the one store — so this runs once, writes only bits
 *  that are still clear, and is done. `table` is the decoded field screen table, and
 *  the screen id comes from the same resolver the field entry uses, never the stage
 *  number. `flags` is the engine's banked store. */
export function migrateVisitedMaps(visited, table, flags) {
  for (const stage of visited ?? []) {
    const screenId = screenIdForStage(table, `s${stageKey(stage)}`);
    if (screenId == null) continue;
    const id = 0x1e00 + screenId;
    if (!flags.get(id)) flags.set(id, true);
  }
}
export function mapUnavailable(state, ui = UI) {
  return mapPs1Id(state, ui) >= 0x2D7;
}

export function bagCursorStep(cursor, key, listLength, perPage) {
  const pageStart = Math.floor((listLength ? cursor : 0) / perPage) * perPage;
  const pageEnd = Math.min(Math.max(0, listLength - 1), pageStart + perPage - 1);
  if (key === "up") return Math.max(pageStart, cursor - 2);
  if (key === "down") return Math.min(pageEnd, cursor + 2);
  if (key === "left") return Math.max(pageStart, cursor - 1);
  if (key === "right") return Math.min(pageEnd, cursor + 1);
  if (key === "l1") return Math.max(0, cursor - perPage);
  if (key === "r1") return Math.min(Math.max(0, listLength - 1), cursor + perPage);
  return cursor;
}

// SCREEN-OBJECT-METHODS-001 fadeStart_ststatus: Card Album / Edit Folder
// darken over ten frames (0xFF00 / 0xA per vsync) before the next screen.
export const CARD_FOLDER_FADE_FRAMES = 0xA;
const CARD_FOLDER_FADE_MAX = 0xFF00;
const CARD_FOLDER_FADE_DELTA = Math.trunc(CARD_FOLDER_FADE_MAX / CARD_FOLDER_FADE_FRAMES);

// Same pair as the gym HUD (widget +0x138 palette 1 rose / 5 fell).
export const SHEET_CLUT_UP = 1;
export const SHEET_CLUT_DOWN = 5;
export function sheetDeltaClut(before, after) {
  const b = Math.min(999, Number(before) || 0);
  const a = Math.min(999, Number(after) || 0);
  if (b < a) return SHEET_CLUT_UP;
  if (b > a) return SHEET_CLUT_DOWN;
  return 0;
}

// F0x8008744c case 0xE / F0x8009946c. Only when the bag holds nine or more.
export const EQUIP_SCROLLBAR = Object.freeze({
  x: 0x125, width: 0xC, y0: 0x4E, y1: 0xB3, visible: 8, minRows: 9,
});
// The bag bar is the shared list bar (SCREEN-OBJECT-NAME-AUDIT-001): the same
// four setters as the lab desk's digivolve list and the folder editor's swap
// list. The arithmetic lives in the engine so all three screens share it.
export function equipScrollbarThumb(bagLength, index, geom = EQUIP_SCROLLBAR) {
  return listScrollbarThumb(bagLength, index, geom);
}

// Portrait table is 8 partner-rookie sequences (ids 1–8). Champion forms are
// not in the extracted table — use that partner's rookie clip rather than a
// blank pedestal.
export function portraitSequenceFor(p, sequences) {
  const seq = sequences?.[String(p?.digimonId)];
  if (seq?.length) return seq;
  return sequences?.[String(p?.rookieId)] ?? null;
}

const EQUIP_SLOTS = ["Head", "Body", "Right", "Left", "Accessory", "Accessory"];
// Real engine EquipSlot keys, index-aligned with EQUIP_SLOTS above.
const EQUIP_SLOT_KEYS = ["head", "body", "right", "left", "acc0", "acc1"];
const STAT_ROWS = ["str", "def", "spt", "wis", "spd", "chr"];
const RES_ROWS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];

// Real ITEMS-screen categories (esstatus.toml strings 22-26). The overlay
// opens on "Which one?" (string 0x1A) and only then the 2-column bag; L1/R1
// page that bag. Rig: docs/research/ui/captures/pause-items-which-one-2026-08-20.png.
const ITEM_CATS = ["Items", "Weapons", "Armor", "Accessories", "Important Items"];
const ITEM_CAT_EMPTY = ["No Items.", "No Weapons.", "No Armor.", "No Accessories.", "No Important Items."];
const ITEM_CAT_ACTIONS = ["Use Item", "All Weapons", "All Armors", "All Accessories", "All Important Items"];
export { ITEM_CATS, ITEM_CAT_EMPTY, ITEM_CAT_ACTIONS };

const NATIVE_W = 320, NATIVE_H = 240;
const VSYNC = 50; // PAL

const ststat = loadPack("ststat");
const cmfont = loadPack("cmfont");

// Decoded layout (tools/extract_status_ui.py). Small and menu-only.
let UI = null;
fetch("assets/data/status_ui.json").then((r) => r.json()).then((j) => { UI = j; }).catch(() => {});

function clampIndex(i, n) {
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
function moveCursor(from, to, sfx, cue = "system02") {
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
const ITEM_CAT_KINDS = [1, 0x80000002, 0x80000003, 0x80000004, 0];

// Real per-effect result strings (esstatus.toml 82-99).
//
// The figure is the applier's own `used`: the original prints the ROLL beside a
// chip's line even when the table cap clipped the real rise (`$s3` is the roll and
// the clamp at ststatus :12960 never touches it), so `result.amount` wins over a
// before/after difference here. `before`/`after` are still the fallback for a
// result that carries no amount. The clipped HEAL arm is the exception: its
// constant 0x52 carries no figure at all (see below).
function useMessage(item, before, after, result) {
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
function swapFormation(state, a, b) {
  const swap = (arr) => { if (Array.isArray(arr)) { const t = arr[a]; arr[a] = arr[b]; arr[b] = t; } };
  // materialize the lead's live stats into the array view before swapping
  if (state.partyStats) state.partyStats[0] = state.partnerStats ?? state.partyStats[0];
  swap(state.party); swap(state.partyStats); swap(state.equipment);
  if (a === 0 || b === 0) {
    state.partnerStats = state.partyStats?.[0] ?? state.partnerStats;
    state.charId = state.party?.[0] ?? state.charId;
    const nextIndex = state.manifest?.characters?.findIndex((c) => c.id === state.charId) ?? -1;
    if (nextIndex >= 0) state.charIdx = nextIndex;
    const select = typeof document !== "undefined" ? document.getElementById("charSelect") : null;
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
function formTechSlots(stats, formId, digimonDB) {
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
function techBadgeClip(tech) {
  const cat = Number(tech?.attack_cat);
  return Number.isFinite(cat) && cat > 0 ? 0x37 + cat : null;
}

// The partner's OWN six technique slots, for the state where no candidate is
// highlighted. The signature technique sits in the LAST slot: capture
// 03-choose-digivolve.png shows Kotemon's only technique, "Hot Head", on row 5,
// and the decoded form-ledger record marks slot 5 with 0x8000.
function ownTechSlots(profile) {
  return profileTechSlots(profile);
}

// Is this digivolve row the partner's CURRENT form? The original compares the
// roster record's current-form field (+0x04) against the highlighted form id
// (F0x8008886c); the walker persists that same field as stats.digimonId, which
// partyRosterView surfaces as the entry's digimonId.
function isCurrentForm(rosterEntry, evo) {
  const cur = Number(rosterEntry?.digimonId ?? 0);
  const target = Number(evo?.formId ?? 0);
  return cur !== 0 && target !== 0 && cur === target;
}

// The action label the original draws for the highlighted digivolve row.
function battleDigivolveLabel(rosterEntry, evo) {
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

function equippedCountOf(state, itemId) {
  ensureEquipment(state);
  return wornCount(state, Number(itemId));
}

function ensureEquipment(state) {
  if (!Array.isArray(state.equipment) || state.equipment.length !== (state.party?.length ?? 0)) {
    state.equipment = (state.party ?? []).map((_, i) => state.equipment?.[i] ?? {});
    // The wearer record was replaced wholesale, so the stored worn byte array is
    // rebuilt from it (the invariant the original's four writers keep).
    syncWornFromEquipment(state);
  }
}

// Only the lead (index 0) has battle-tracked stats in this engine (state.partnerStats),
// so only the lead's equip bonuses actually affect combat maths (battle.js reads
// ps.equipBonuses alongside the permanent chip ps.bonuses).
function syncEquipBonuses(state, idx) {
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
export function equipPickOptions(state, partyIdx, slotKey) {
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

function previewEquipment(state, m) {
  const equipped = { ...(state.equipment[m.detailIdx] ?? {}) };
  const slotKey = EQUIP_SLOT_KEYS[m.equipCursor];
  const snapshot = { ...equipped };
  const preview = { ...equipped };
  if (m.equipFocus === "list") delete preview[slotKey];
  return { snapshot, preview };
}

function sheetStatValue(p, slots, stat, rosterSlot = null) {
  // The total the original's roster record would hold: stored + the permanent
  // chip rise (the walker keeps chips in `bonuses` — engine/dw3/items.ts writes
  // the rise there — and the record itself already carries them on the disc),
  // with the worn gear folded on top (F0x80017174). Reading `stats` alone
  // under-reported every chipped member by the chip's amount.
  const base = Number(p?.stats?.[stat] ?? p?.profile?.[stat] ?? 0) + Number(p?.bonuses?.[stat] ?? 0);
  const b = equipmentBonuses(slots, rosterSlot);
  return Math.min(999, base + (b[stat] ?? 0));
}

/**
 * The STATUS sheet's element number: the one value the original's F0x80017174
 * scratch holds at +0x18..+0x24 — the species base plus every trained point
 * plus the worn gear's coded resist, capped at 999. Read through the shared
 * helper (engine/dw3/effective-stats.ts) so the sheet, the shop, the gym and
 * the battle divisor cannot drift apart. The sheet never floors, because
 * F0x8008C1C0 only caps.
 */
function sheetResValue(p, slots, res) {
  const b = equipmentBonuses(slots);
  const worn = Number(b.elemResists?.[res] ?? 0) || 0;
  const points = worn ? { ...(p?.elemBonuses ?? {}), [res]: (p?.elemBonuses?.[res] ?? 0) + worn } : p?.elemBonuses;
  return elementValue(p?.profile, points, res);
}

// The See Digivolve panel's numbers (F0x80088A44). Both of its branches read the
// PARTNER's own live block — the same F0x80017174 copy the status sheet shows,
// so the same stored-plus-chips-plus-worn-gear rule — and with a candidate
// highlighted they ADD the candidate species record's per-stat field (+2
// onward) and per-resistance field (+0xe onward), clamping the sum at 999. With
// no candidate the species part is simply absent. These two helpers exist so the
// fold cannot drift from the sheet's: they call the sheet's own readers.
export function seeDigivolvePanelStat(p, slots, stat, rosterSlot, formProfile = null) {
  return Math.min(999, sheetStatValue(p, slots, stat, rosterSlot) + Number(formProfile?.[stat] ?? 0));
}

export function seeDigivolvePanelRes(p, slots, res, formProfile = null) {
  return Math.min(999, sheetResValue(p, slots, res) + Number(formProfile?.resistances?.[res] ?? 0));
}

export function createMenu(sfx = null) {
  const backdrop = createStatusBackdrop();
  const m = {
    // top-level list cursor / drilled-in screen
    mainCursor: 0,
    cardFolderCursor: 0,
    screen: "home", // "home" | "items" | "sort" | "map" | "techniques-pick" |
                     // "techniques-list" | "status-list" | "status-detail"
    // First START draws the resident list over the live field. Entering any
    // overlay screen (ITEMS/SORT/…) keeps the diamond room when you come back.
    // Rig: docs/research/ui/captures/pause-field-home-2026-08-20.png vs
    // pause-overlay-home-2026-08-20.png.
    fieldHome: true,
    itemCursor: 0,
    itemMode: "cats", // "cats" | "list" | "sort" | "use_target"
    itemCat: 0,     // category row on "Which one?", then the bag filter
    itemTarget: 0,  // "Use it on who?" party index
    sortPick: null, // formation change: first picked slot ("Switch who?")
    statusCursor: 0,   // party index while choosing a Digimon (status-list / techniques-pick)
    detailIdx: 0,      // party index being viewed (status-detail)
    detailFocus: 0,    // 0 = digivolve, 1 = equipment (the two-row detail prompt)
    // "prompt" = the See Digivolve / See Equipment rows; "digivolve" = inside
    // the digivolve list. Equipment leaves for the full equip screen.
    detailStep: "prompt",
    demoCursor: 0,    // Digivolve Demo screen: 0 = ON, 1 = OFF
    dvAction: 0,      // 0 = Battle Digivolve On/Off, 1 = Techique Explanation
    // See Digivolve: the cursor's HOME is beside the partner's name, not on a
    // candidate (F0x80089bf0 state 4 gates on unk6C).
    dvHome: true,
    dvMessage: null,  // "Turned on/off Battle Digivolve", shown on the footer
    dvBackStep: "dvaction",  // where "Choose a technique" came from
    techInfoSel: 0,   // slot 0..5 inside "Choose a technique"
    detailSel: 0,
    techCursor: 0,
    // full EQUIP screen (F0x80086dd4): slot cursor / bag-list cursor+scroll
    equipFocus: "slots", // "slots" | "list"
    equipCursor: 0,
    equipListCursor: 0,
    equipScroll: 0,
    fadeLeaving: false,
    fadeT0: 0,
    fadePending: null,
    // The MAP page's "have I been here" reader, supplied by the host: (flagId) => set?
    // over the engine's banked store, which is where the field entry writes.
    mapSeen: null,
    // Where the Digivolve Demo screen's Back goes. No such screen is reachable
    // from the original's pause list (ledger
    // UI-DEMO-SETUP-SCREEN-HAS-NO-SELECTOR-WRITE-2026-08-14), so the host owns
    // the answer: web/game.js points this at the one pause home.
    backToHome: () => { m.screen = "home"; },
    // TECHNIQUES: null, or "use_target" while the "Use it on who?" prompt is up
    techMode: null,
    techTarget: 0,
    feedbackMsg: null,
    feedbackTimer: 0,
    digimonDB: null,
    skillDB: null,
  };

  // ── window fold animation (decoded tween F0x80099d5c / F0x80099df0) ────
  // Opening ramps the window's scale 0 -> 0x1000 over the slot's `steps` and
  // plays SYSTEM03; CLOSING ramps 0x1000 -> 0 at DOUBLE the step and plays
  // SYSTEM04. Every window in the pause menu is installed with steps = 0xA,
  // so a window takes 10 frames to open and 5 to shut. A screen never jumps:
  // each state waits for the fold it started before starting the next, which
  // is what `_after` below reproduces.
  const ANIM_T = 10 / VSYNC;
  m._anim = {};       // key -> {t0, dir}; missing = never animated, i.e. open
  m._sfxPlayed = {};
  m._foldOpen = (...keys) => {
    for (const k of keys) { m._anim[k] = { t0: m.time ?? 0, dir: 1 }; delete m._sfxPlayed[k]; }
  };
  m._foldClose = (...keys) => {
    for (const k of keys) { m._anim[k] = { t0: m.time ?? 0, dir: 0 }; delete m._sfxPlayed[k]; }
  };
  // Forget a window entirely: the next draw shows it fully open with no sound.
  m._foldForget = (...keys) => {
    for (const k of keys) { delete m._anim[k]; delete m._sfxPlayed[k]; }
  };
  // Put a window in the SHUT state without animating or sounding it — the
  // state a screen's windows are in before its constructor has opened them.
  m._foldShut = (...keys) => {
    for (const k of keys) { m._anim[k] = { t0: -1e9, dir: 0 }; m._sfxPlayed[k] = 1; }
  };
  // Start an open at a fixed delay. Kept for the screens whose original
  // sequence is a plain chain of equal-length folds, where a delay and a
  // wait-for-previous are the same thing.
  m._animStart = (delay, ...keys) => {
    for (const k of keys) { m._anim[k] = { t0: (m.time ?? 0) + delay, dir: 1 }; delete m._sfxPlayed[k]; }
  };
  // The transform, from the shared fold class (engine/dw3/ui/fold-tween.ts)
  // rather than a formula local to this screen.
  m._foldTr = (key, px, py, axis) => {
    const a = m._anim[key];
    if (!a) return ui.foldTransformAtTime(0, null, px, py, axis, ANIM_T);
    return a.dir
      ? ui.foldTransformAtTime(m.time ?? 0, a.t0, px, py, axis, ANIM_T)
      : ui.foldCloseTransformAtTime(m.time ?? 0, a.t0, px, py, axis, ANIM_T);
  };
  m._animP = (key) => m._foldTr(key, 0, 0, "x").progress;
  // The boolean the original's states branch on: window_fold_tick() != 0,
  // true once the fold has LANDED, in whichever direction it was going.
  m._foldReady = (key) => m._foldTr(key, 0, 0, "x").ready;

  // ── the screens' own choreography ──────────────────────────────────────
  // Each pause-menu screen is a small state machine that starts a fold, waits
  // for it, then starts the next. `_after(keys, fn)` queues one such step.
  m._seq = [];
  m._after = (keys, run) => { m._seq.push({ wait: keys, run }); };
  m._seqClear = () => { m._seq.length = 0; };
  m._runSeq = () => {
    let guard = 0;
    while (m._seq.length && guard++ < 32) {
      const step = m._seq[0];
      if (!step.wait.every((k) => (k === "slide" ? m._slideReady() : m._foldReady(k)))) break;
      m._seq.shift();
      step.run();
    }
  };

  // ── the panel slide (decoded tween F0x80099e5c: linear, N vsyncs) ───────
  // See Digivolve slides its whole lower panel 34 px up over 4 frames to make
  // room for the technique explanation, and back down on the way out.
  const SLIDE_STEPS = 4;
  m._slide = null;    // {t0, from, to}
  m._slideY = 0;
  m._slideStart = (from, to) => { m._slideY = from; m._slide = { t0: m.time ?? 0, from, to }; };
  m._slideSet = (v) => { m._slide = null; m._slideY = v; };
  m._slideTick = () => {
    if (!m._slide) return;
    const p = Math.min(1, Math.max(0, ((m.time ?? 0) - m._slide.t0) / (SLIDE_STEPS / VSYNC)));
    m._slideY = Math.round(m._slide.from + (m._slide.to - m._slide.from) * p);
    if (p >= 1) m._slide = null;
  };
  m._slideReady = () => m._slide == null;

  // A window counts as OPEN unless a close is running or has finished on it.
  m._isOpen = (k) => { const a = m._anim[k]; return !(a && a.dir === 0); };

  // ── the STATUS SHEET's own windows (F0x8008d684 states 0..3) ───────────
  // card + name tab, then the EXP plate + the Digivolve panel, then the stat
  // window + the Equip panel — each pair waiting on the pair before it. The
  // EXP plate and the stat window are opened only if they are not already up,
  // which is what makes coming back from See Equipment cheaper than a fresh
  // entry.
  m._openSheet = (fresh) => {
    if (fresh) m._foldOpen("shCard");
    m._foldOpen("shName");
    m._after(fresh ? ["shCard", "shName"] : ["shName"], () => {
      if (!m._isOpen("shExp")) m._foldOpen("shExp");
      m._foldOpen("shDv");
    });
    m._after(["shExp", "shDv"], () => {
      if (!m._isOpen("shStat")) m._foldOpen("shStat");
      m._foldOpen("shEq");
    });
    m._after(["shStat", "shEq"], () => { m.detailStep = "prompt"; });
  };
  // Leaving the sheet for a sub-screen (state 10). The card always stays; the
  // EXP plate and the stat window come down only for See Digivolve (row 0) —
  // See Equipment draws over a sheet that still has them, which is why the
  // partner's numbers are still on its left.
  m._closeSheet = (row, alsoCard) => {
    const keys = ["shName", "shDv", "shEq"];
    if (row === 0) keys.push("shExp", "shStat");
    if (alsoCard) keys.push("shCard");
    m._foldClose(...keys);
    return keys;
  };

  // digimon.json is small and menu-only (battle.js keeps its own copy for battle
  // maths); fetch once, lazily, so party/status/techniques screens have real profiles.
  let dataPromise = null;
  m.ensureData = () => {
    if (!dataPromise) {
      dataPromise = fetch("assets/data/digimon.json").then((r) => r.json()).then((dj) => {
        m.digimonDB = Object.fromEntries(dj.digimon.map((d) => [d.id, d]));
        m.skillDB = Object.fromEntries(dj.skills.map((s) => [s.id, s]));
      });
    }
    return dataPromise;
  };

  m.reset = () => {
    m.mainCursor = 0; m.screen = "home"; m.fieldHome = true;
    m.itemCursor = 0; m.itemMode = "cats"; m.itemCat = 0; m.itemTarget = 0; m.itemSortCursor = 0;
    m.sortPick = null;
    m.sortSwapping = false;
    m.statusCursor = 0; m.detailIdx = 0; m.detailFocus = 0; m.detailSel = 0; m.detailStep = "prompt";
    m.techCursor = 0; m.techMode = null; m.techTarget = 0;
    m.dvAction = 0; m.techInfoSel = 0; m.demoCursor = digivolveDemoOn() ? 0 : 1;
    m.dvHome = true; m.dvMessage = null; m.dvBackStep = "dvaction";
    m.equipFocus = "slots"; m.equipCursor = 0; m.equipListCursor = 0; m.equipScroll = 0;
    m.fadeLeaving = false; m.fadeT0 = 0; m.fadePending = null;
    m.feedbackMsg = null;
    m._anim = {}; m._sfxPlayed = {}; m._screenSeen = null; // re-fold on open
    m._seq.length = 0; m._slide = null; m._slideY = 0;
    m.ensureData();
  };

  // Open the menu directly on one screen. Used by the DRI-desk launcher (set_flag
  // bank 0x7c index 0 = the original SWITCH-DIGIMON screen 0xd00); the walker's
  // equivalent of that screen is the SORT formation view.
  m.openAt = (screen) => {
    m.reset();
    m.screen = screen;
    if (screen !== "home") m.fieldHome = false;
  };

  // The active tab's rows, walked in the original's directory order. The gear
  // tabs pass their negative kind so worn-only items are listed too (the tab
  // words' bit 31 — see ITEM_CAT_KINDS).
  m.itemList = (state) => listItemIds(state, ITEM_CAT_KINDS[m.itemCat] ?? 1)
    .map((id) => ({ id, qty: heldCount(state, id) }));

  m.ensureData(); // fire immediately at creation — don't wait for the first reset()

  // Seed real base stats for non-lead party members the first time we need them
  // (lazy — game.js only allocates null placeholders at grant time).
  function ensurePartyStats(state) {
    if (!Array.isArray(state.party)) return;
    if (!Array.isArray(state.partyStats) || state.partyStats.length !== state.party.length) {
      state.partyStats = state.party.map(() => null);
    }
    let changed = false;
    state.party.forEach((charId, i) => {
      if (i === 0) return; // lead uses live partnerStats
      if (!state.partyStats[i]) {
        const prof = m.digimonDB?.[CHARID_TO_DIGID[charId]];
        state.partyStats[i] = baseStatsFor(prof);
        changed = true;
      }
    });
    if (changed) localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
  }

  function roster(state) {
    ensurePartyStats(state);
    return partyRosterView(state.party, state.partnerStats, state.partyStats, m.digimonDB ?? {}, state.digimonNames);
  }

  // The LIVE stat block behind roster index i (the roster view is a copy).
  // Index 0 is the battle-tracked lead; the rest have their own persisted slot.
  function statBlock(state, i) {
    ensurePartyStats(state);
    return i === 0 ? state.partnerStats : state.partyStats?.[i];
  }

  function persistStats(state, i) {
    if (i === 0) localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
    localStorage.setItem("partyStats", JSON.stringify(state.partyStats ?? []));
  }

  // TECHNIQUES rows for one party member: the healing techniques in the six
  // ledger slots of its three EQUIPPED forms, de-duplicated, capped at five.
  // F0x800937a4 walks the equipped-form triple (record +0x50, validated by the
  // +0x2738 getter), copies each form's ledger entry and reads its six slots —
  // it does NOT read the current species' own technique list, so a partner whose
  // evolved form learned Small Heal lists it, and a rookie with no equipped form
  // lists nothing. formTechSlots is the one form-slot reader (see its header);
  // engine fieldTechniqueRows keeps the (id - 0xB8) < 5 filter, first-seen order,
  // de-dup and the five-row cap.
  m.techRows = (state, idx) => {
    const stats = statBlock(state, idx);
    const slots = [];
    for (const formId of stats?.equippedForms ?? []) {
      slots.push(...formTechSlots(stats, formId, m.digimonDB ?? {}));
    }
    return fieldTechniqueRows(slots);
  };

  // Apply one field technique. target === null means the whole party.
  //
  // The cues are the disc's own (F0x80093A58, pro/ststatus.s): a heal that
  // landed plays 0x00040014 RECOVERY (`host.playSound(0x40014)` in the port,
  // engine/dw3/ui/native/pause-techniques.ts:149/184); a refusal replays the
  // confirm cue the caller had just played (`sound` there — 0x4001C from
  // "Use it on who?" at :19550, 0x8004503C from the party-wide list at
  // :19292). The copy used to play "savedemo" (0x00040015, a different
  // sample) on success and "system01" (0x800450BD, the back cue) on refusal —
  // divergence row `pause-home-button-table-2026-10-04.md` §13.
  m.applyTechnique = (state, techId, target, failSound = "system07") => {
    const view = roster(state);
    const casterIdx = m.statusCursor;
    const caster = statBlock(state, casterIdx);
    const skill = m.skillDB?.[techId];
    if (!caster || !skill) { m.showFeedback("No technique."); return; }

    const idxs = target === null ? view.map((_, i) => i) : [target];
    const blocks = idxs.map((i) => statBlock(state, i)).filter(Boolean);
    // The scaling stat is read off the caster; HEAL_SCALE_STAT names which one
    // so a correction is a single edit in engine/dw3/field-techniques.ts.
    const scale = view[casterIdx]?.stats?.[HEAL_SCALE_STAT]
      ?? view[casterIdx]?.profile?.[HEAL_SCALE_STAT] ?? 0;

    const r = useFieldTechnique(caster, blocks, skill.mp_cost ?? 0, skill.power ?? 0, scale);
    m.showFeedback(r.msg);
    if (!r.ok) { sfx?.play(failSound); return; }
    sfx?.play("recovery"); // 0x40014 — the applied-heal cue
    idxs.forEach((i) => persistStats(state, i));
    persistStats(state, casterIdx);
  };

  m.handleKey = (rawKey, state, onSave) => {
    if (m.nativeOpen?.()) return; // the native pause page owns the pad while open
    // Accept either a pad button name from the dispatcher or the raw key it
    // stands for, so a caller (and a test) may use whichever it has.
    const key = asButton(rawKey);
    if (m.fadeLeaving) return;
    if (m.feedbackMsg) { m.feedbackMsg = null; return; }

    // CONFIRMED U-07/U-08: Square is not read on this bag and no comparator
    // runs. The Sort Items strings exist in the bank and are not bound here.

    // "Choose Digimon" after a usable Items-row Circle. Cursor clamps
    // (same shape as Status U-32 / Techniques U-15).
    if (m.itemMode === "use_target") {
      const n = roster(state).length;
      if (key === "up") m.itemTarget = moveCursor(m.itemTarget, clampIndex(m.itemTarget - 1, n), sfx, "system06");
      else if (key === "down") m.itemTarget = moveCursor(m.itemTarget, clampIndex(m.itemTarget + 1, n), sfx, "system06");
      else if (key === "cross") { sfx?.play("system01"); m.itemMode = "list"; }
      else if (key === "circle") {
        // §4.3: this confirm has NO click of its own — it goes straight into
        // the apply (ststatus.s:14643 calls F0x8008F584), and the applier is
        // what you hear: 0x40014 on the applied arm, 0x4001c SYSTEM07 with
        // "No effect." on the refusal arm (file 0xcbc8 / 0xcc10).
        const list = m.itemList(state);
        const slot = list[m.itemCursor];
        if (slot) {
          const item = ITEM_BY_ID[slot.id];
          const tgt = m.itemTarget;
          const view = tgt === 0 ? state
            // The worn gear comes along so the store's auto-unequip can see who has
            // what, exactly as the original's remove arm searches the party.
            : { inventory: state.inventory, equipment: state.equipment, partnerStats: state.partyStats[tgt] };
          // Snapshot the numbers the message compares. A shallow spread would
          // alias the nested bonuses/elemBonuses objects, so every delta would
          // read as 0 and the message would fall back to the item's nominal value.
          const ps0 = view.partnerStats ?? {};
          const before = {
            hp: ps0.hp, mp: ps0.mp, maxHp: ps0.maxHp, maxMp: ps0.maxMp, tp: ps0.tp,
            bonuses: { ...(ps0.bonuses ?? {}) },
            elemBonuses: { ...(ps0.elemBonuses ?? {}) },
          };
          const r = useItem(view, slot.id, undefined, roster(state)[tgt]?.profile);
          if (r.ok) {
            // F0x8008F584's applied arm plays 0x00040014 RECOVERY for EVERY
            // effect that landed (file 0xcbcc, `ori $a0,0x14`), not only HP
            // charges — the old "savedemo" here was 0x00040015, a different
            // sample (the save screen's demo jingle).
            sfx?.play("recovery");
            m.showFeedback(useMessage(item, before, view.partnerStats, r));
            if (tgt === 0) localStorage.setItem("partnerStats", JSON.stringify(state.partnerStats));
            else localStorage.setItem("partyStats", JSON.stringify(state.partyStats));
            localStorage.setItem("inventory", JSON.stringify(state.inventory));
          } else {
            // The refusal arm ("No effect."): file 0xcc10, `ori $a0,0x1c`.
            sfx?.play("system07");
            m.showFeedback(r.msg);
          }
        }
        m.itemMode = "list";
      }
      return;
    }

    const back = () => { sfx?.play("system01"); m.screen = "home"; };

    if (m.screen === "home") {
      // The top menu CLAMPS at both ends — it does not wrap. F0x8001270c state 3
      // takes `unk58 - 1` and floors it at 0, `unk58 + 1` and ceilings it at
      // rowCount - 1. (SORT's own cursor does wrap; the two differ deliberately.)
      // Until 2026-08-14 the up branch referenced an undefined TOP_ITEMS and
      // threw on every press.
      if ((key === "up" || key === "down") && state.keys?.has?.(key)) return;
      if (key === "up") {
        const next = Math.max(0, m.mainCursor - 1);
        if (next !== m.mainCursor) { m.mainCursor = next; sfx?.play("system02"); }
      } else if (key === "down") {
        const next = Math.min(topItems(m).length - 1, m.mainCursor + 1);
        if (next !== m.mainCursor) { m.mainCursor = next; sfx?.play("system02"); }
      } else if (key === "circle") {
        // The confirm bit is word bit 0x2000, which is the name "circle" here:
        // F0x8001270c asks the pad service for logical button 0x0D and only that
        // arm records the chosen row (fns.s:3370-3406). The back bit 0x4000
        // ("cross") folds the list shut without recording a row, and the host
        // owns that fold (web/game.js), so this list acts on neither.
        const chosen = topItems(m)[m.mainCursor];
        // The confirm SOUND is unconditional and comes FIRST; only then does the
        // MAP gate swallow the press. F0x8001270c.c:177 plays the packed confirm
        // SFX and then tests `(unk64 != 0) || (unk58 != 2)` before acting, so a
        // refused MAP still clicks like every other row — it just does nothing.
        sfx?.play("system00");
        if (chosen === "MAP" && mapUnavailable(state)) return;
        m.fieldHome = false;
        if (m.onNativePage?.(chosen)) { /* the native pause page owns the pad */ }
        else if (chosen === "ITEMS") { m.screen = "items"; m.itemMode = "cats"; m.itemCursor = 0; }
        else if (chosen === "SORT") { m.screen = "sort"; m.statusCursor = 0; m.sortPick = null; m.sortSwapping = false; }
        else if (chosen === "MAP") { m.screen = "map"; m.mapInit = false; }
        else if (chosen === "TECHNIQUES") { m.screen = "techniques-pick"; m.statusCursor = 0; }
        else if (chosen === "STATUS") { if (m.onStatus?.()) m.screen = "home"; else { m.screen = "status-list"; m.statusCursor = 0; } }
        else if (chosen === CARD_FOLDERS) { m.screen = "cardfolder"; m.cardFolderCursor = 0; }
        else if (chosen === DEMO_SETUP_LABEL) { m.screen = "demosetup"; m.demoCursor = digivolveDemoOn() ? 0 : 1; }
      }
      return;
    }

    // ── CARD FOLDERS: the parent of the Album and the folder editor ──
    // Guides and the shipped strings agree on the shape: the Card Folders
    // window offers the Album (every card you own) and Edit Folder. Both are
    // real screens the walker already ships; before this they were reachable
    // only from the debug lab.
    if (m.screen === "cardfolder") {
      if (key === "cross") { back(); return; }
      if (key === "up") m.cardFolderCursor = moveCursor(m.cardFolderCursor, 0, sfx);
      else if (key === "down") m.cardFolderCursor = moveCursor(m.cardFolderCursor, 1, sfx);
      else if (key === "circle") {
        sfx?.play("system00");
        m.fadeLeaving = true;
        m.fadeT0 = m.time ?? 0;
        m.fadePending = m.cardFolderCursor === 0 ? "album" : "deck";
      }
      return;
    }

    if (m.screen === "items") {
      const list = m.itemList(state);
      const perPage = (UI?.screens?.items?.grid?.cols ?? 2) * (UI?.screens?.items?.grid?.rows ?? 8);
      if (m.itemMode === "cats" || m.itemMode == null) {
        if ((key === "up" || key === "down") && state.keys?.has?.(key)) return;
        if (key === "cross") { back(); return; }
        if (key === "up") {
          m.itemCat = moveCursor(m.itemCat, Math.max(0, m.itemCat - 1), sfx); m.itemCursor = 0;
        } else if (key === "down") {
          m.itemCat = moveCursor(m.itemCat, Math.min(ITEM_CATS.length - 1, m.itemCat + 1), sfx);
          m.itemCursor = 0;
        } else if (key === "circle") {
          // §4.1: the confirm word plays FIRST and unconditionally — the
          // original plays 0x8004503C (ststatus.s:14238) BEFORE it counts the
          // tab. A stocked tab then opens the bag; an empty one shows
          // esstatus 0x64+cat ("No Items." … "No Important Items.", :14286)
          // and STAYS, with no second sound.
          sfx?.play("system00");
          if (m.itemList(state).length > 0) { m.itemMode = "list"; m.itemCursor = 0; }
          else m.showFeedback(ITEM_CAT_EMPTY[m.itemCat]);
        }
        return;
      }
      if (key === "cross") { sfx?.play("system01"); m.itemMode = "cats"; return; }
      // L1/R1 page the bag (rig: Weapons "1 / 8" + R1). Categories are the picker.
      // The original's own guards (F0x80092524): the two shoulders are mutually
      // exclusive (`heldOther` on the other one), Left is read only when Down is
      // NOT held and Right only when Up is not (the `padHeld` tests at :63/:126).
      if ((key === "l1" && state.keys?.has?.("r1")) || (key === "r1" && state.keys?.has?.("l1"))) return;
      if ((key === "left" && state.keys?.has?.("down")) || (key === "right" && state.keys?.has?.("up"))) return;
      if (key === "l1" || key === "r1" || key === "up" || key === "down" || key === "left" || key === "right") {
        m.itemCursor = moveCursor(m.itemCursor,
          bagCursorStep(m.itemCursor, key, list.length, perPage), sfx);
      }
      else if (key === "circle") {
        // U-10: Circle is a no-op off the Items category. U-28: bit 0 / pair
        // lo-byte 1 and 3 only.
        const slot = list[m.itemCursor];
        if (m.itemCat === 0 && slot && itemUsableInField(slot.id)) {
          sfx?.play("system00");
          m.itemMode = "use_target"; m.itemTarget = 0;
        }
      }
      return;
    }

    if (m.screen === "sort") {
      // Real SORT = change Digimon FORMATION (esstatus strings 15-18:
      // "Change Digimon formation", "Switch who?", "Switch with who?") —
      // not item sorting (that's the square button inside ITEMS).
      const n = roster(state).length;
      if (m.sortSwapping) return; // states 8/9 own the pad while the cards fold
      if (key === "cross") {
        // §5: BOTH real SORT states play the back word 0x800450BD on Back
        // (ststatus.s:21306 "Switch who?", :21480 "Switch with who?"), but the
        // party-of-one refusal screen leaves with NO click at all
        // (:21577-21590 reads 0xE and stores the state, with no playSound).
        if (n >= 2) sfx?.play("system01");
        if (m.sortPick != null) m.sortPick = null; else m.screen = "home";
        return;
      }
      // A party of one cannot be reordered: the real screen shows string 16 and
      // accepts nothing but cancel (F0x8009744c states 15/16).
      if ((key === "up" || key === "down") && state.keys?.has?.(key)) return;
      if (n < 2) return;
      // Both cursors WRAP here (unlike the top menu, which clamps), and on the
      // second pick the cursor SKIPS the slot already chosen — the original's
      // `do { ... } while (arg0->unk84 == temp)` loops in states 6 and 7.
      // The cues are the party-card pair: cursor 0x4001B (:21228, :21408),
      // confirm 0x4001C (:21249, :21429).
      const step = (from, d) => {
        let i = from;
        do { i = (i + d + n) % n; } while (m.sortPick != null && i === m.sortPick);
        return i;
      };
      if (key === "up") m.statusCursor = moveCursor(m.statusCursor, step(m.statusCursor, -1), sfx, "system06");
      else if (key === "down") m.statusCursor = moveCursor(m.statusCursor, step(m.statusCursor, 1), sfx, "system06");
      else if (key === "circle") {
        sfx?.play("system07");
        if (m.sortPick == null) {
          m.sortPick = m.statusCursor;
          // The second cursor may never rest on the first pick.
          if (m.statusCursor === m.sortPick) m.statusCursor = step(m.statusCursor, 1);
          return;
        }
        // States 8 and 9 (screen-tree S3): the two chosen cards fold SHUT, the
        // swap happens behind them, and only then do they fold back open with
        // their new occupants — after which the header returns to "Switch
        // who?". The walker used to swap in one frame, so the two portraits
        // teleported. `sortSwapping` holds the header on "Switch with who?"
        // and swallows the pad for the length of the two folds, which is what
        // the original's two extra states do.
        const a = m.sortPick, b = m.statusCursor;
        m.sortSwapping = true;
        m._foldClose(`card${a}`, `card${b}`);
        m._after([`card${a}`, `card${b}`], () => {
          swapFormation(state, a, b);
          m._foldOpen(`card${a}`, `card${b}`);
          m._after([`card${a}`, `card${b}`], () => {
            m.sortSwapping = false;
            m.sortPick = null;
          });
        });
      }
      return;
    }

    // Digivolve Demo ON/OFF. Two rows, assigned rather than stepped, like every
    // other two-row list in this menu (Card Folders, the detail prompt).
    if (m.screen === "demosetup") {
      // The disc has no selector for this screen, so its Back has no original
      // answer. The host decides where Back goes (web/game.js sets `backToHome`
      // to the one pause home); standing alone this module returns to its own
      // hand-written list, which is the ?legacyStatus=1 rollback route.
      if (key === "cross") { sfx?.play("system01"); m.backToHome?.(); return; }
      if (key === "up") m.demoCursor = moveCursor(m.demoCursor, 0, sfx);
      else if (key === "down") m.demoCursor = moveCursor(m.demoCursor, 1, sfx);
      else if (key === "circle") {
        sfx?.play("system00");
        const on = m.demoCursor === 0;
        setDigivolveDemo(on);
        m.showFeedback(on ? "Turned on Battle Digivolve" : "Turned off Battle Digivolve");
      }
      return;
    }

    if (m.screen === "map") {
      if (key === "cross") {
        m.mapHoldX = 0; m.mapHoldY = 0;
        back(); return;
      }
      const MC = UI?.screens?.map?.cursor;
      if (!MC || !m.mapInit) return;
      const axis = key === "left" ? [-1, 0]
        : key === "right" ? [1, 0]
        : key === "up" ? [0, -1]
        : key === "down" ? [0, 1]
        : null;
      if (!axis) return;
      // Held pad/keyboard is ticked from the map draw (F0x800986c0 runs every
      // vsync). Event-only callers (tests) get one step here.
      if (state.keys?.has?.(key)) return;
      const horiz = axis[0] !== 0;
      if (horiz) m.mapHoldX = (m.mapHoldX ?? 0) + 1;
      else m.mapHoldY = (m.mapHoldY ?? 0) + 1;
      m.mapSpd = mapHoldSpeed(horiz ? m.mapHoldX : m.mapHoldY, MC);
      _mapMove(m, MC, axis[0], axis[1]);
      return;
    }

    if (m.screen === "techniques-pick") {
      const n = roster(state).length;
      if (key === "cross") { back(); return; }
      if (key === "up") m.statusCursor = moveCursor(m.statusCursor, clampIndex(m.statusCursor - 1, n), sfx, "system06");
      else if (key === "down") m.statusCursor = moveCursor(m.statusCursor, clampIndex(m.statusCursor + 1, n), sfx, "system06");
      // §7.1: the party list's confirm is the party-card word 0x4001C
      // (ststatus.s:18971) — it opens "Choose a technique".
      else if (key === "circle") { sfx?.play("system07"); m.screen = "techniques-list"; m.techCursor = 0; }
      return;
    }

    if (m.screen === "techniques-list") {
      const rows = m.techRows(state, m.statusCursor);
      // "Use it on who?" (esstatus 43) — only the single-target heals ask.
      if (m.techMode === "use_target") {
        const n = roster(state).length;
        if (key === "up") m.techTarget = moveCursor(m.techTarget, clampIndex(m.techTarget - 1, n), sfx, "system06");
        else if (key === "down") m.techTarget = moveCursor(m.techTarget, clampIndex(m.techTarget + 1, n), sfx, "system06");
        else if (key === "cross") { sfx?.play("system01"); m.techMode = null; }
        else if (key === "circle") {
          // §7.3: the apply path plays NO click of its own before the applier —
          // F0x80093A58 is called with 0x4001C and plays 0x40014 on a heal,
          // its caller's 0x4001C on a refusal (state 0x20,
          // engine/dw3/ui/native/pause-techniques.ts:616-632).
          m.applyTechnique(state, rows[m.techCursor], m.techTarget);
          m.techMode = null;
        }
        return;
      }
      if (key === "cross") { sfx?.play("system01"); m.screen = "techniques-pick"; return; }
      if (key === "up") m.techCursor = moveCursor(m.techCursor, Math.max(0, m.techCursor - 1), sfx);
      else if (key === "down") {
        m.techCursor = moveCursor(m.techCursor,
          Math.min(Math.max(0, rows.length - 1), m.techCursor + 1), sfx);
      }
      else if (key === "circle") {
        const techId = rows[m.techCursor];
        if (techId == null) return;
        sfx?.play("system00");
        // Party-wide heals (Giga/Final Heal, scope byte 4) skip the target
        // prompt entirely and apply to everyone at once — F0x80093a58. Its
        // refusal replays this list's own confirm cue (0x8004503C), which the
        // copy has just played as "system00" (pause-home-button-table §7.2).
        if (isPartyWide(techId)) m.applyTechnique(state, techId, null, "system00");
        else { m.techMode = "use_target"; m.techTarget = m.statusCursor; }
      }
      return;
    }

    if (m.screen === "status-list") {
      const n = roster(state).length;
      if (key === "cross") { back(); return; }
      if (key === "up") m.statusCursor = moveCursor(m.statusCursor, clampIndex(m.statusCursor - 1, n), sfx, "system06");
      else if (key === "down") m.statusCursor = moveCursor(m.statusCursor, clampIndex(m.statusCursor + 1, n), sfx, "system06");
      else if (key === "circle") {
        // §8.1: party-card cursor 0x4001B, confirm 0x4001C (ststatus.s:11664,
        // :11687) — it opens that partner's sheet.
        sfx?.play("system07");
        m.detailIdx = m.statusCursor; m.detailFocus = 0; m.detailSel = 0;
        m.detailStep = "opening";
        m.screen = "status-detail";
        m._foldShut("shCard", "shName", "shExp", "shStat", "shDv", "shEq");
        m._seqClear();
        m._openSheet(true);
      }
      return;
    }

    if (m.screen === "status-detail") {
      // While a fold is running the original is in a state that reads no pad
      // at all. Swallow the key rather than letting a screen change land
      // halfway through a window opening.
      if (m._seq.length) return;
      const r = roster(state)[m.detailIdx];
      const evos = window.__battle?.availableEvolutions?.(state, m.detailIdx) ?? [];

      // ── the sheet's two-row prompt (F0x8008d684 state 5) ────────────────
      // Up assigns row 0, Down assigns row 1 — no wrap, no third row.
      if (m.detailStep === "prompt") {
        if (key === "cross") {
          // Cross leaves the sheet: every panel shuts, the card with them.
          sfx?.play("system01");
          const keys = m._closeSheet(1, true);
          m.detailStep = "closing";
          m._after(keys, () => { m.screen = "status-list"; m.detailStep = "prompt"; });
          return;
        }
        if (key === "up") m.detailFocus = moveCursor(m.detailFocus, 0, sfx);
        else if (key === "down") m.detailFocus = moveCursor(m.detailFocus, 1, sfx);
        else if (key === "circle") {
          sfx?.play("system00");
          m.detailSel = 0; m.dvHome = true; m.dvAction = 0;
          const keys = m._closeSheet(m.detailFocus, false);
          if (m.detailFocus === 0) {
            // See Digivolve: its own screen. Name plate, then the candidate
            // list, then the lower panel (F0x80089bf0 states 0..3).
            m.detailStep = "closing";
            m._after(keys, () => {
              m._foldShut("dvName", "dvList", "dvAct", "dvPanel", "dvFoot");
              m._slideSet(0);
              m._foldOpen("dvName");
            });
            m._after(["dvName"], () => m._foldOpen("dvList"));
            m._after(["dvList"], () => m._foldOpen("dvPanel"));
            m._after(["dvPanel"], () => { m.detailStep = "digivolve"; });
          } else {
            // See Equipment: header plate, then the slots window.
            m._after(keys, () => {
              m.equipFocus = "slots"; m.equipCursor = 0;
              m.screen = "equip"; m.detailStep = "prompt";
              m._foldShut("eqHeader", "eqSlots", "eqList", "eqDetail");
              m._foldOpen("eqHeader");
            });
            m._after(["eqHeader"], () => m._foldOpen("eqSlots"));
          }
        }
        return;
      }

      // ── See Digivolve ───────────────────────────────────────────────────
      // Leaving the screen (F0x80089bf0 state 0x32): its three windows shut,
      // then the sheet builds itself back up.
      const leaveDigivolve = () => {
        sfx?.play("system01");
        m._foldClose("dvName", "dvList", "dvPanel");
        m.detailStep = "closing";
        m._after(["dvName", "dvList", "dvPanel"], () => {
          m.detailFocus = 0;
          m._openSheet(false);
        });
      };
      // The technique explanation: the panel slides 34px up, the footer plate
      // opens under it, and the highlighted slot's text and MP cost appear.
      const openExplanation = (closeKey, backStep) => {
        m._foldClose(closeKey);
        m.detailStep = "closing";
        m._after([closeKey], () => m._slideStart(0, UI.screens.see_digivolve.panel_slide?.to ?? -34));
        m._after(["slide"], () => m._foldOpen("dvFoot"));
        m._after(["dvFoot"], () => { m.detailStep = "techinfo"; m.dvBackStep = backStep; });
      };
      const closeExplanation = () => {
        sfx?.play(m.dvBackStep === "dvaction" ? "system00" : "system01");
        m._foldClose("dvFoot");
        m.detailStep = "closing";
        m._after(["dvFoot"], () => m._slideStart(m._slideY, 0));
        m._after(["slide"], () => m._foldOpen(m.dvBackStep === "dvaction" ? "dvAct" : "dvList"));
        m._after([m.dvBackStep === "dvaction" ? "dvAct" : "dvList"],
          () => { m.detailStep = m.dvBackStep === "dvaction" ? "dvaction" : "digivolve"; });
      };

      if (m.detailStep === "digivolve") {
        // The cursor starts BESIDE THE PARTNER'S NAME, not on a candidate.
        // Right (pad bit 5) walks it into the list, Left (bit 7) brings it
        // back — F0x80089bf0 state 4 branches on unk6C for exactly that.
        if (key === "cross") { leaveDigivolve(); return; }
        if (m.dvHome) {
          if (key === "right" && evos.length) { m.dvHome = false; sfx?.play("system02"); }
          else if (key === "circle") {
            // Circle at the home cursor explains the partner's OWN signature
            // technique (state 0x3c: slot 5, text from the partner record).
            sfx?.play("system00");
            m.techInfoSel = 5;
            openExplanation("dvList", "digivolve");
          }
          return;
        }
        if (key === "left") { m.dvHome = true; sfx?.play("system02"); return; }
        if (key === "up") {
          const next = Math.max(0, m.detailSel - 1);
          if (next !== m.detailSel) { m.detailSel = next; sfx?.play("system02"); }
        } else if (key === "down") {
          const next = Math.min(Math.max(0, evos.length - 1), m.detailSel + 1);
          if (next !== m.detailSel) { m.detailSel = next; sfx?.play("system02"); }
        } else if (key === "circle" && evos[m.detailSel]) {
          // A candidate opens its ACTION PAIR: the list window shuts and the
          // shorter action window takes its place (states 0xA..0xC).
          sfx?.play("system00");
          m.dvAction = 0;
          m._foldClose("dvList");
          m.detailStep = "closing";
          m._after(["dvList"], () => m._foldOpen("dvAct"));
          m._after(["dvAct"], () => { m.detailStep = "dvaction"; });
        }
        return;
      }

      // The two action rows (state 0xD). Up assigns 0, Down assigns 1.
      if (m.detailStep === "dvaction") {
        const target = evos[m.detailSel];
        if (key === "up" || key === "down") {
          const next = key === "up" ? 0 : 1;
          if (next !== m.dvAction) { m.dvAction = next; sfx?.play("system02"); }
          return;
        }
        if (key === "cross") {
          // Back to the candidate list (states 0x14..0x16).
          sfx?.play("system01");
          m._foldClose("dvAct");
          m.detailStep = "closing";
          m._after(["dvAct"], () => m._foldOpen("dvList"));
          m._after(["dvList"], () => { m.detailStep = "digivolve"; });
          return;
        }
        if (key !== "circle" || !target) return;
        sfx?.play("system00");
        if (m.dvAction === 1) {
          const slots = formTechSlots(statBlock(state, m.detailIdx), target.formId, m.digimonDB);
          const first = slots.findIndex((id) => id > 0);
          m.techInfoSel = first < 0 ? 0 : first;
          openExplanation("dvAct", "dvaction");
          return;
        }
        // Row 0 writes the roster current-form field in place: the highlighted
        // form, or 0 when it already equals it (state 0xD, confirm branch).
        const off = isCurrentForm(r, target);
        const rookie = m.digimonDB?.[r?.rookieId];
        const toName = off ? rookie?.name : target.to;
        const result = toName
          ? window.__battle?.applyEvolution?.(toName, state, m.detailIdx)
          : null;
        // The original reports only which way the field went, not the name.
        m.dvMessage = result?.ok
          ? (off ? "Turned off Battle Digivolve" : "Turned on Battle Digivolve")
          : "Cannot digivolve.";
        // The message takes the whole screen down to the footer: the name plate
        // and the action window shut, the panel slides up, the footer opens
        // (states 0x19..0x1C).
        m._foldClose("dvName", "dvAct");
        m.detailStep = "closing";
        m._after(["dvName", "dvAct"],
          () => m._slideStart(0, UI.screens.see_digivolve.panel_slide?.to ?? -34));
        m._after(["slide"], () => m._foldOpen("dvFoot"));
        m._after(["dvFoot"], () => { m.detailStep = "dvmessage"; });
        return;
      }

      // The message sits until Circle (state 0x1D), which plays the stepper
      // confirm rather than the ordinary one, then the screen rebuilds itself
      // from the top (states 0x1E/0x1F -> state 0).
      if (m.detailStep === "dvmessage") {
        if (key !== "circle") return;
        sfx?.play("system07");
        m._foldClose("dvFoot", "dvPanel");
        m.detailStep = "closing";
        m._after(["dvFoot", "dvPanel"], () => {
          m._slideSet(0);
          m.dvHome = true; m.dvMessage = null;
          m._foldShut("dvAct");
          m._foldOpen("dvName");
        });
        m._after(["dvName"], () => m._foldOpen("dvList"));
        m._after(["dvList"], () => m._foldOpen("dvPanel"));
        m._after(["dvPanel"], () => { m.detailStep = "digivolve"; });
        return;
      }

      // "Choose a technique" (state 0x2C): the cursor SKIPS empty slots and
      // stays put when there is no other filled one. Circle and Cross both
      // leave.
      if (m.detailStep === "techinfo") {
        const target = evos[m.detailSel];
        const slots = m.dvBackStep === "dvaction" && target
          ? formTechSlots(statBlock(state, m.detailIdx), target.formId, m.digimonDB)
          : ownTechSlots(r?.profile);
        const step = (from, d) => {
          for (let i = from + d; i >= 0 && i < 6; i += d) if (slots[i] > 0) return i;
          return from;
        };
        if (key === "up" || key === "down") {
          const next = step(m.techInfoSel, key === "up" ? -1 : 1);
          if (next !== m.techInfoSel) { m.techInfoSel = next; sfx?.play("system02"); }
        } else if (key === "circle" || key === "cross") {
          closeExplanation();
        }
        return;
      }
      return;
    }

    if (m.screen === "equip") {
      if (m._seq.length) return;   // a fold is running: the original reads no pad
      const apply = (choice, slotKey) => {
        ensureEquipment(state);
        // Build the new slot map on a COPY, then hand both to the store's one
        // record writer: it moves the worn byte by the difference the record gained
        // and lost, once per item (ststatus 0x8009A3E8 — the displace arm at
        // 0x8009A45C and the equip arm at 0x8009A5FC, one store each). Counting
        // the difference rather than the pieces displaced is what makes a
        // two-handed weapon ONE worn copy: it sits in both hand halfwords, and one
        // writer call moved the byte once in the original.
        const slots = { ...(state.equipment[m.detailIdx] ?? {}) };
        if (choice.unequip) {
          unequipItem(slots, slotKey);
        } else {
          const res = equipItem(slots, slotKey, choice.id);
          if (!res.ok) { m.showFeedback(res.msg ?? "Can't equip that."); return; }
        }
        commitEquipSlot(state, m.detailIdx, slotKey, slots);
        syncEquipBonuses(state, m.detailIdx);
        localStorage.setItem("equipment", JSON.stringify(state.equipment));
        localStorage.setItem("worn", JSON.stringify(state.worn ?? {}));
        localStorage.setItem("inventory", JSON.stringify(state.inventory));
      };
      if (m.equipFocus === "slots") {
        if (key === "cross") {
          // Leaving the screen: the slots window shuts, then the header plate
          // (states 0x32..0x34). Only then does the sheet build itself back up,
          // with "See Equipment" still highlighted.
          sfx?.play("system01");
          m._foldClose("eqSlots");
          m._after(["eqSlots"], () => m._foldClose("eqHeader"));
          m._after(["eqHeader"], () => {
            m.screen = "status-detail"; m.detailStep = "opening"; m.detailFocus = 1;
            m._openSheet(false);
          });
          return;
        }
        // The slot cursor CLAMPS at both ends; it does not wrap
        // (F0x8008744c state 3: `< 0 -> 0`, `>= 6 -> 5`).
        if (key === "up") {
          const n = Math.max(0, m.equipCursor - 1);
          if (n !== m.equipCursor) { m.equipCursor = n; sfx?.play("system02"); }
        } else if (key === "down") {
          const n = Math.min(5, m.equipCursor + 1);
          if (n !== m.equipCursor) { m.equipCursor = n; sfx?.play("system02"); }
        } else if (key === "circle") {
          sfx?.play("system00");
          m.equipListCursor = 0; m.equipScroll = 0;
          // The slots window shuts, then the header plate, then the
          // current-piece panel opens and the bag list after it — states
          // 0xA/0xB/0xC/0xD/0xE, four folds in a row, never two at once.
          m._foldClose("eqSlots");
          m._after(["eqSlots"], () => m._foldClose("eqHeader"));
          m._after(["eqHeader"], () => { m.equipFocus = "list"; m._foldOpen("eqDetail"); });
          m._after(["eqDetail"], () => m._foldOpen("eqList"));
        }
        return;
      }
      // list focus
      const slotKey = EQUIP_SLOT_KEYS[m.equipCursor];
      const options = equipPickOptions(state, m.detailIdx, slotKey);
      // Leaving the bag (states 0x14..0x16 then back to 0): the list shuts,
      // then the current-piece panel, then the header plate and the slots
      // window open again in that order.
      const backToSlots = () => {
        m._foldClose("eqList");
        m._after(["eqList"], () => m._foldClose("eqDetail"));
        m._after(["eqDetail"], () => { m.equipFocus = "slots"; m._foldOpen("eqHeader"); });
        m._after(["eqHeader"], () => m._foldOpen("eqSlots"));
      };
      if (key === "cross") {
        sfx?.play("system01"); backToSlots();
        return;
      }
      const lastOpt = Math.max(0, options.length - 1);
      if (key === "up") m.equipListCursor = moveCursor(m.equipListCursor, Math.max(0, m.equipListCursor - 1), sfx);
      else if (key === "down") m.equipListCursor = moveCursor(m.equipListCursor, Math.min(lastOpt, m.equipListCursor + 1), sfx);
      else if (key === "l1") m.equipListCursor = moveCursor(m.equipListCursor, Math.max(0, m.equipListCursor - 8), sfx);
      else if (key === "r1") m.equipListCursor = moveCursor(m.equipListCursor, Math.min(lastOpt, m.equipListCursor + 8), sfx);
      else if (key === "circle") {
        sfx?.play("system00");
        const choice = options[m.equipListCursor];
        if (choice) apply(choice, slotKey);
        backToSlots();
      }
      // keep the 8-row window over the cursor (scroll offset obj+0x6c)
      if (m.equipListCursor < m.equipScroll) m.equipScroll = m.equipListCursor;
      if (m.equipListCursor >= m.equipScroll + 8) m.equipScroll = m.equipListCursor - 7;
      return;
    }
  };

  m.update = (dt) => {
    m.time = (m.time ?? 0) + dt;
    backdrop.update(dt);
    // The screens' choreography advances on the clock, not on the draw: each
    // queued step fires the frame its folds land, exactly as the original's
    // state machine advances when window_fold_tick returns non-zero.
    m._slideTick();
    m._runSeq();
    if (m.feedbackMsg) {
      m.feedbackTimer -= dt;
      if (m.feedbackTimer <= 0) m.feedbackMsg = null;
    }
    if (m.fadeLeaving) {
      const frames = Math.max(0, Math.floor((m.time - m.fadeT0) * VSYNC));
      if (frames * CARD_FOLDER_FADE_DELTA >= CARD_FOLDER_FADE_MAX) {
        const which = m.fadePending;
        m.fadeLeaving = false;
        m.fadePending = null;
        if (which === "album") m.onCardAlbum?.();
        else if (which === "deck") m.onCardDeck?.();
      }
    }
  };

  m.showFeedback = (msg, duration = 1.5) => { m.feedbackMsg = msg; m.feedbackTimer = duration; };

  // ── drawing (all coordinates native 320x240, from status_ui.json) ──

  m.draw = (ctx, viewW, viewH, state) => {
    // Resident pause home leaves the field visible. Overlay screens — and
    // home after you have been into one — use the diamond room.
    if (!(m.screen === "home" && m.fieldHome)) backdrop.draw(ctx, viewW, viewH);

    const s = viewW / NATIVE_W;
    ctx.save();
    ctx.scale(s, s);

    if (!m.digimonDB || !UI) {
      drawText(ctx, "Loading...", 20, 20);
      ctx.restore();
      return;
    }

    const r = roster(state);
    const t = m.time ?? 0;
    m.mapUnavailable = mapUnavailable(state);
    _stepHeldLists(m, state, sfx);

    // Start fold anims when a screen appears. Windows open SEQUENTIALLY
    // (each state handler waits window-ready before the next → 0.2s steps).
    const SIDEBAR = new Set(["home", "sort", "techniques-pick", "techniques-list", "status-list", "cardfolder", "demosetup"]);
    if (m._screenSeen !== m.screen) {
      const prev = m._screenSeen;
      m._screenSeen = m.screen;
      const chrome = SIDEBAR.has(m.screen) && (prev == null || !SIDEBAR.has(prev));
      if (chrome) {
        const n = Math.max(1, Math.min(3, roster(state).length || 1));
        if (m.screen === "home") {
          // The list you get on the FIRST START is the resident one, and it
          // opens all three cards TOGETHER (F0x8001270c's first state starts
          // +0x70, +0x80 and +0x90 in one breath). It has no header or footer
          // plate of its own.
          m._animStart(0, "header", "footer", "card0", "card1", "card2");
        } else {
          // The overlay screens do it one card at a time, and open the footer
          // plate beside the LAST of them, not the first: F0x8008ddb0 /
          // F0x80084238 / F0x80085b6c all branch on the party size and open
          // card0 + header, then card1, then card2 + footer (a party of one
          // opens the footer with card0).
          m._animStart(0, "header", "card0");
          if (n >= 2) m._animStart(ANIM_T, "card1");
          if (n >= 3) m._animStart(ANIM_T * 2, "card2");
          m._animStart(ANIM_T * (n - 1), "footer");
        }
      }
      const base = chrome ? ANIM_T : 0;
      if (m.screen === "home") m._animStart(base, "homeWin");
      else if (m.screen === "items") { m._animStart(0, "itemsTitle"); m._animStart(ANIM_T, "itemsList"); m._animStart(ANIM_T * 2, "itemsCat"); }
      // "equip" is not listed here: the sheet's own state machine opens its
      // header plate and then its slots window as it hands over, so a
      // screen-change trigger would restart a fold already running.
    }
    // Decoded window fold: sp9C scale ramp 0..0x1000 around the spA4 pivot.
    // F0x80099d5c plays SYSTEM03 as a window starts opening and SYSTEM04 as it
    // starts shutting. Ramp and pivot transform come from the shared fold
    // class; the SFX gate stays here because the sound belongs to the screen's
    // own behaviour, not to the tween's arithmetic.
    const fold = (key, px, py, axis, fn) => {
      const a = m._anim[key];
      const tr = m._foldTr(key, px, py, axis);
      // A window that has finished SHUTTING is gone; one that has finished
      // opening draws at unity. Both come back as progress 0 / 1 here.
      if (!m._sfxPlayed[key] && a != null) {
        m._sfxPlayed[key] = 1;
        sfx?.play(a.dir ? "system03" : "system04");
      }
      if (tr.progress <= 0) return 0;
      if (tr.ready) { fn(); return 1; }
      ctx.save();
      ctx.translate(tr.pivotX, tr.pivotY);
      ctx.scale(tr.scaleX, tr.scaleY);
      ctx.translate(-tr.pivotX, -tr.pivotY);
      fn();
      ctx.restore();
      return tr.progress;
    };

    if (m.screen === "home") {
      _drawSidebar(ctx, r, m, t, -1, null, fold, { skipPortrait: m.fieldHome });
      _drawHomeBit(ctx, state);
      _drawHome(ctx, m, t, fold);
      const ht = UI.screens.shared.header_text ?? { x: 0x98, y: 0x13 };
      drawText(ctx, "[triangle] Button: Close Status", ht.x, ht.y);
    } else if (m.screen === "cardfolder") {
      _drawSidebar(ctx, r, m, t, -1, null, fold);
      _drawFooter(ctx, state, t, "[triangle] Button: Back to Menu", null, fold);
      _drawCardFolder(ctx, m, t, fold);
    } else if (m.screen === "demosetup") {
      _drawSidebar(ctx, r, m, t, -1, null, fold);
      _drawFooter(ctx, state, t, "[triangle] Button: Back to Menu", DEMO_SETUP_HINT, fold);
      _drawDemoSetup(ctx, m, t, fold);
    } else if (m.screen === "items") {
      _drawItems(ctx, state, m, r, t, fold);
      // footer is part of the items layout (sort hint)
    } else if (m.screen === "sort") {
      // SORT builds no right-hand list (F0x80096590). A party of one gets
      // the refusal footer and no header (F0x8009744c states 15/16); otherwise
      // the shared header plate carries "Switch who?" / "Switch with who?".
      const canSort = r.length >= 2;
      if (canSort) {
        _drawHeader(ctx, m.sortPick == null ? SORT_HEADERS.pick : SORT_HEADERS.with, fold);
      }
      _drawSidebar(ctx, r, m, t, canSort ? m.statusCursor : -1, m.sortPick, fold);
      _drawFooter(ctx, state, t,
        canSort ? "Change Digimon formation" : "Can't change Digimon formation",
        "[triangle] Button: Back to Menu", fold, { hideBit: true });
      // The bracket only exists once the first Digimon is picked: the original
      // sets its gate (+0x70) as it advances into "Switch with who?" and clears
      // it on the way out (.L0x00014bf4 / .L0x00014f94).
      if (canSort) _drawSwapBracket(ctx, m, t);
    } else if (m.screen === "map") {
      _drawMapPane(ctx, state, m, t, sfx);
    } else if (m.screen === "techniques-pick" || m.screen === "status-list") {
      _drawHeader(ctx, "Choose Digimon", fold);
      _drawSidebar(ctx, r, m, t, m.statusCursor, null, fold);
      const f2 = m.screen === "status-list" ? "Digimon's digivolve and equipment" : "Use Digimon's technique.";
      _drawFooter(ctx, state, t, f2, "[triangle] Button: Back to Menu", fold, { hideBit: true });
    } else if (m.screen === "techniques-list") {
      // While "Use it on who?" is up the sidebar cursor follows the TARGET and
      // the caster's own card stays locked, the same two-card idiom SORT uses.
      const picking = m.techMode === "use_target";
      _drawHeader(ctx, picking ? "Use it on who?" : "Choose Digimon", fold);
      _drawSidebar(ctx, r, m, t, picking ? m.techTarget : m.statusCursor,
        picking ? m.statusCursor : null, fold);
      _drawFooter(ctx, state, t, "[triangle] Button: Back to Menu", null, fold, { hideBit: true });
      // The same rows the input machine picks from — one reader, so the list on
      // screen and the list the cursor walks cannot disagree (F0x800937a4).
      _drawTechniques(ctx, m.techRows(state, m.statusCursor), m, t);
    } else if (m.screen === "status-detail") {
      // "See Digivolve" is a SCREEN OF ITS OWN, and it is a CHILD of the sheet:
      // the sheet object keeps running underneath, which is why the partner's
      // card is still there while the sub-screen's own windows are up. So the
      // sheet layer always draws — its panels are simply folded shut by then.
      // Layout claim SEE-DIGIVOLVE-SCREEN-LAYOUT-001, reference capture
      // docs/research/ui/captures/original-status-2026-09-03/03-choose-digivolve.png.
      // The sub-screen draws FIRST and the sheet over it: capture
      // 03-choose-digivolve.png has the partner's card plate sitting on top of
      // the "Choose digivolve" band, which runs the full width behind it.
      if (m.detailStep !== "prompt" && m.detailStep !== "opening" && !m._isOpen("shDv")) {
        _drawSeeDigivolve(ctx, r[m.detailIdx], m, state, t, fold);
      }
      _drawDetail(ctx, r[m.detailIdx], m, state, t, fold);
    } else if (m.screen === "equip") {
      _drawEquip(ctx, state, m, r[m.detailIdx], t, fold);
    }

    if (m.feedbackMsg) {
      const w = textWidth(m.feedbackMsg, 3);
      drawText(ctx, m.feedbackMsg, (NATIVE_W - w) / 2, 0xA8, { kind: 3 });
    }
    if (m.fadeLeaving) {
      const frames = Math.max(0, Math.floor((m.time - m.fadeT0) * VSYNC));
      const a = Math.min(255, (frames * CARD_FOLDER_FADE_DELTA) >> 8) / 255;
      paintScreenDim(ctx, a * 255, NATIVE_W, 240);
    }
    ctx.restore();
  };

  return m;
}

// ── native drawing helpers (coordinates from status_ui.json / the decompile) ──

const gold = { kind: 3 };

// Right-anchored value text (the ーー placeholder fields end AT their x —
// "150/ 150" lines up cur flush against the baked "/" at x=61).
function valueText(ctx, str, xEnd, y, opts = gold) {
  const kind = opts.kind ?? 3;
  drawText(ctx, String(str), xEnd - textWidth(String(str), kind), y, opts);
}

// The status sheet's stat and resistance numbers, and its TP pair, are built in
// the WHITE face, not the gold one: F0x8008b520 passes kind 1 to F0x8001ae38 for
// the widgets at x=0x32 (stats), x=0x5B (resistances) and (0x10,0xCB)/(0x2D,0xCB)
// (TP). Only the EXP pair at 0x42/0x46 is kind 3. Capture
// docs/research/ui/captures/original-status-2026-09-03/02-status-sheet.png shows
// exactly that: white numbers, gold "4 EXP".
export const SHEET_VALUE_KIND = 1;
const white = { kind: SHEET_VALUE_KIND };
// F0x8008c1c0 sets every one of the thirteen stat/resistance widgets to palette
// 0, then raises three of them to palette 6. WHAT RAISES THEM IS NOT DECODED —
// the flags come out of the stat snapshot struct at +0x26/+0x28/+0x2A.
export const SHEET_CLUT_MARKED = 6;

// The palette a See Equipment preview number takes: F0x8008C460's own pair —
// palette 1 when the preview raised the value, 5 when it lowered it, and the
// face's own row when it did not move (the original then raises the unchanged
// STR/DEF/SPD widgets to the grey 6 only when the stat snapshot's flag is set,
// which the walker's data never sets). The grey SHEET_CLUT_MARKED is the sheet
// filler's mark, NOT the preview's colour: the preview passes 1 and 5 to the
// same thirteen widgets (ststatus F0x8008C460's six `li $a1, 0x1` / five
// `li $a1, 0x5` marks), so painting 6 for every change showed grey where the
// original shows the gym's rose/blue pair.
export function sheetPreviewFace(before, after) {
  const clut = sheetDeltaClut(before, after);
  return clut ? { kind: SHEET_VALUE_KIND, clut } : white;
}

// One party card: CMFONTCS chrome (LV/HP/MP letters baked in), animated
// pedestal portrait, name + values at the decoded label-table positions.
// Cards fold open around (0x7c, card center) — F0x800946bc sp9C(v,v)/spA4.
function _drawCard(ctx, p, y0, t, fold = null, key = null, opts = null) {
  const sh = UI.screens.shared;
  // The card is NOT one folding sprite. F0x8008c954 draws it under two
  // different scale/pivot pairs: the frame pieces (clips 0x15/0x17) unroll
  // SIDEWAYS from x=0 about (0, y+37), while the portrait plate (clip 0x16)
  // and the picture on it grow on BOTH axes about (124, y+39). See
  // screens.shared.card_fold.
  const CF = sh.card_fold ?? {
    side: { pivot_x: 0, dy: 0x25, axis: "x" },
    plate: { pivot_x: sh.card_pivot_x ?? 0x7C, dy: 0x27, axis: "xy" },
  };
  const piece = (i) => () => {
    const c = sh.card_chrome[i];
    // First START has no glass pedestal (cmfont 22/23). Overlay home keeps them.
    if (!c || (opts?.skipPortrait && (c.clip === 22 || c.clip === 23))) return;
    drawClip(ctx, c.pack === "cmfont" ? cmfont : ststat, c.clip, c.x, c.y + y0);
  };
  const picture = () => {
    // portrait: real animation sequence (13-vsync step, table 0x8009a9c0).
    // Champion ids are not in the extracted 8-rookie table — fall back to
    // that partner's rookie sequence rather than leaving the pedestal blank.
    if (opts?.skipPortrait) return;
    const seq = portraitSequenceFor(p, UI.portrait_sequences);
    if (seq?.length) {
      const fi = Math.floor(t * VSYNC / UI.timings_vsync.portrait_step) % seq.length;
      drawClip(ctx, ststat, seq[fi], sh.portrait.x, sh.portrait.y + y0);
    }
  };
  let done = 1;
  if (fold && key) {
    const side = (fn) => fold(key, CF.side.pivot_x, y0 + CF.side.dy, CF.side.axis, fn);
    const plate = (fn) => fold(key, CF.plate.pivot_x, y0 + CF.plate.dy, CF.plate.axis, fn);
    done = side(piece(0));
    plate(piece(1));
    side(piece(2));
    plate(picture);
  } else { piece(0)(); piece(1)(); piece(2)(); picture(); }
  if (done < 1) return;
  const L = UI.card_labels;
  drawText(ctx, p?.name ?? "", L.name.x, L.name.y + y0);
  // F0x80093e84: names kind 1, LV/HP/MP/"/" kind 3 (9px pitch).
  for (const lab of L.static ?? []) {
    const text = CARD_STAT_LABELS[lab.str];
    if (text) drawText(ctx, text, lab.x, lab.y + y0, gold);
  }
  const vals = [p?.level ?? 1, p?.hp ?? 0, p?.maxHp ?? 0, p?.mp ?? 0, p?.maxMp ?? 0];
  L.values.forEach((v, i) => valueText(ctx, vals[i], v.x, v.y + y0));
}

// The orange selection corners: CLUT-row-cycled ststat clip 0x1e ("30#k").
function _drawSelection(ctx, idx, t, locked = false) {
  const sel = UI.screens.shared.selection;
  const k = locked ? 8 : Math.floor(t * VSYNC / UI.timings_vsync.selection_clut_cycle) % 8;
  drawClipAtPaletteRow(ctx, ststat, sel.clip, k, sel.x, sel.y_base + idx * sel.pitch);
}

// SORT's swap bracket (F0x80096988 .L0x000145c0..0x00014768). While the second
// pick is open the screen draws one ststat clip beside the party column at
// x=147, CLUT-cycled 0..7 every 11 vsync. The original states it as six
// (pick, cursor) cases; all six reduce to one bracket spanning the pair:
// it is drawn on the UPPER of the two rows, clip 41 when the rows are
// neighbours and the taller clip 40 when they are two apart.
export function sortSwapBracket(pick, cursor) {
  const S = UI.screens.sort.swap_marker;
  if (pick == null || cursor == null || pick === cursor) return null;
  const top = Math.min(pick, cursor);
  const clip = Math.abs(pick - cursor) === 1 ? S.clip_b : S.clip_a;
  return { clip, x: S.x, y: top === 0 ? S.y_high : S.y_low };
}

function _drawSwapBracket(ctx, m, t) {
  const b = sortSwapBracket(m.sortPick, m.statusCursor);
  if (!b) return;
  const S = UI.screens.sort.swap_marker;
  const k = Math.floor(t * VSYNC / S.clut_cycle_vsync) % 8;
  drawClipAtPaletteRow(ctx, ststat, b.clip, k, b.x, b.y);
}

function _drawSidebar(ctx, roster, m, t, selIdx = -1, lockedIdx = null, fold = null, opts = null) {
  const pitch = UI.screens.shared.card_pitch;
  roster.forEach((p, i) => _drawCard(ctx, p, i * pitch, t, fold, `card${i}`, opts));
  const cardReady = (i) => (m._animP?.(`card${i}`) ?? 1) >= 1;
  if (lockedIdx != null && cardReady(lockedIdx)) _drawSelection(ctx, lockedIdx, t, true);
  if (selIdx >= 0 && selIdx < roster.length && cardReady(selIdx)) _drawSelection(ctx, selIdx, t);
}

function _drawHeader(ctx, text, fold = null) {
  const h = UI.screens.shared.header;
  const [px, py] = h.pivot ?? [0x140, 0x19];
  const plate = () => drawClip(ctx, cmfont, h.clip, h.x, h.y);
  const p = fold
    ? fold("header", px, py, "x", plate)
    : (plate(), 1);
  if (p < 1) return;
  // Label-table +0x84 widget at (152, 19), kind 1.
  if (text) {
    const t = UI.screens.shared.header_text ?? { x: 0x98, y: 0x13 };
    drawText(ctx, text, t.x, t.y);
  }
}

// Footer plate (ststat 0x20 @ (0,194)): two text lines at (20,198)/(20,212),
// BIT count right-anchored before the "BIT" label at (300,212), and the
// CLUT-blinking page arrow (cmfont 0x0a) at (291,214). Overlay SORT /
// TECHNIQUES / STATUS-pick have no footer BIT (pause-sort-who-2026-08-20).
function _drawFooter(ctx, state, t, line1, line2, fold = null, opts = null) {
  const sh = UI.screens.shared;
  const [fpx, fpy] = sh.footer.pivot ?? [0, 0xD3];
  const p = fold
    ? fold("footer", fpx, fpy, "x", () => drawClip(ctx, ststat, sh.footer.clip, sh.footer.x, sh.footer.y))
    : (drawClip(ctx, ststat, sh.footer.clip, sh.footer.x, sh.footer.y), 1);
  if (p < 1) return;
  const F = UI.footer_labels;
  if (line1) drawText(ctx, line1, F.line1.x, F.line1.y);
  if (line2) drawText(ctx, line2, F.line1.x, F.line1.y + 0xE);
  if (!opts?.hideBit) {
    valueText(ctx, state.bits ?? 0, F.bit_label.x - 4, F.bit_value.y);
    drawText(ctx, "BIT", F.bit_label.x, F.bit_label.y, gold);
  }
  const k = Math.floor(t * VSYNC / UI.timings_vsync.footer_arrow_blink) % 5;
  drawClip(ctx, cmfont, k === 0 ? "10" : `10#${k}`, sh.footer_arrow.x, sh.footer_arrow.y);
}

// Resident/overlay home BIT sits at the foot of the card stack
// (status_ui.json topmenu.bit_*; rig d2_home.png / s6_home.png).
function _drawHomeBit(ctx, state) {
  const TM = UI.screens.topmenu;
  if (!TM?.bit_value) return;
  valueText(ctx, state.bits ?? 0, TM.bit_value.x, TM.bit_value.y);
  drawText(ctx, "BIT", TM.bit_label.x, TM.bit_label.y, gold);
}

// The TOP-LEVEL menu. Its rows and cursor are the decoded RESIDENT geometry
// (F0x800121b4: rows x=189 from y=49 at pitch 14, cursor x=176) — the list is
// not in the ststatus overlay at all. The window sprite behind them is not
// decoded, so it reuses the overlay's right-pane window and its clip table.
function _drawHome(ctx, m, t, fold = null, labels = null) {
  const H = UI.screens.techniques;
  const TM = UI.screens.topmenu;
  const rows = labels ?? topItems(m);
  // The 0x8009a950 clip table holds exactly FIVE entries and then a zero
  // terminator (verified with overlay_scan), so a six-row menu has no window
  // clip of its own in the decoded data. Which entry the original drops to stay
  // within five is NOT established — the row count is read per-menu from a
  // record field, not hardcoded — so the six-row case reuses the widest clip
  // rather than inventing one. This is the single unresolved presentation
  // detail of the CARD FOLDERS entry.
  const winClip = UI.menu_window_clips[Math.min(rows.length, UI.menu_window_clips.length) - 1];
  const [px, py] = H.menu_window.pivot ?? [0x140, 0x63];
  const win = () => drawClip(ctx, ststat, winClip, H.menu_window.x, H.menu_window.y);
  const p = fold ? fold("homeWin", px, py, "x", win) : (win(), 1);
  if (p < 1) return;
  rows.forEach((label, i) => {
    const y = TM.rows.y_base + i * TM.rows.pitch;
    const dim = labels == null && label === "MAP" && m.mapUnavailable;
    if (i === m.mainCursor) drawCursor(ctx, t * VSYNC, TM.cursor_x, y, dim ? GREY : gold);
    drawText(ctx, label, TM.rows.x, y, dim ? GREY : {});
  });
}

// CARD FOLDERS panel — its own decoded geometry (ststat clip 0x3a @ (168,40),
// header (178,42), rows (197, 58+14i), cursor x=184: F0x80083c94 / F0x80083680,
// cursor placement confirmed by F0x80084238 state 0xA).
function _drawCardFolder(ctx, m, t, fold = null) {
  const C = UI.screens.cardfolder;
  const win = () => drawClip(ctx, ststat, C.window.clip, C.window.x, C.window.y);
  const [cpx, cpy] = C.window.pivot ?? [0x140, 0x40];
  const p = fold ? fold("cardFolderWin", cpx, cpy, "x", win) : (win(), 1);
  if (p < 1) return;
  drawText(ctx, "CARD FOLDERS", C.header.x, C.header.y);
  CARD_FOLDER_ROWS.forEach((label, i) => {
    const y = C.rows.y_base + i * C.rows.pitch;
    if (i === m.cardFolderCursor) drawCursor(ctx, t * VSYNC, C.cursor_x, y, gold);
    drawText(ctx, label, C.rows.x, y);
  });
}

// Digivolve Demo setup. Two rows in the small right-hand panel, like Card
// Folders. The original's own geometry for this screen is NOT decoded — nothing
// reaches it, so no capture of it exists — so it borrows that panel's.
function _drawDemoSetup(ctx, m, t, fold = null) {
  const C = UI.screens.cardfolder;
  const win = () => drawClip(ctx, ststat, C.window.clip, C.window.x, C.window.y);
  const [dpx, dpy] = C.window.pivot ?? [0x140, 0x40];
  const p = fold ? fold("demoSetupWin", dpx, dpy, "x", win) : (win(), 1);
  if (p < 1) return;
  drawText(ctx, DEMO_SETUP_TITLE, C.header.x, C.header.y);
  DEMO_SETUP_ROWS.forEach((label, i) => {
    const y = C.rows.y_base + i * C.rows.pitch;
    if (i === m.demoCursor) drawCursor(ctx, t * VSYNC, C.cursor_x, y, gold);
    // The setting in force is marked, so the screen reads as a state, not a menu.
    const inForce = (i === 0) === digivolveDemoOn();
    drawText(ctx, label, C.rows.x, y, inForce ? gold : {});
  });
}

// ── the world MAP screen (draw F0x80098b84, decoded + rig-verified 2026-07-11) ──
// Full-screen: dark base map (stwmp sub 0) + revealed-terrain patches per area
// in the ordinal-tier list (sub 1, clip = area-1 at map.area_positions[area]) +
// visited location markers (sub 2, flag 0x2000|(stage&0xff)) + current-location
// arrow, free/locked cursor and the hover name window. All geometry/timings
// from status_ui.json screens.map (tools/extract_status_ui.py header).

// Cursor/pan movement — transcription of F0x80098450: the cursor free-moves
// until it crosses the screen-centre pan pivot; ON the pivot the map scrolls
// instead, and hitting the scroll limit nudges the cursor past the pivot so
// it resumes free movement.
function _mapMove(m, C, dx, dy) {
  const s = m.mapSpd;
  if (dx < 0) {
    if (m.mapCX > C.pan_x) m.mapCX = Math.max(C.pan_x, m.mapCX - s);
    else if (m.mapCX < C.pan_x) m.mapCX = Math.max(C.x_min, m.mapCX - s);
    else { m.mapSX = Math.min(0, m.mapSX + s); if (m.mapSX === 0) m.mapCX = C.pan_x - 1; }
  } else if (dx > 0) {
    if (m.mapCX < C.pan_x) m.mapCX = Math.min(C.pan_x, m.mapCX + s);
    else if (m.mapCX > C.pan_x) m.mapCX = Math.min(C.x_max, m.mapCX + s);
    else { m.mapSX = Math.max(C.scroll_x_min, m.mapSX - s); if (m.mapSX === C.scroll_x_min) m.mapCX = C.pan_x + 1; }
  }
  if (dy < 0) {
    if (m.mapCY > C.pan_y) m.mapCY = Math.max(C.pan_y, m.mapCY - s);
    else if (m.mapCY < C.pan_y) m.mapCY = Math.max(C.y_min, m.mapCY - s);
    else { m.mapSY = Math.min(0, m.mapSY + s); if (m.mapSY === 0) m.mapCY = C.pan_y - 1; }
  } else if (dy > 0) {
    if (m.mapCY < C.pan_y) m.mapCY = Math.min(C.pan_y, m.mapCY + s);
    else if (m.mapCY > C.pan_y) m.mapCY = Math.min(C.y_max, m.mapCY + s);
    else { m.mapSY = Math.max(C.scroll_y_min, m.mapSY - s); if (m.mapSY === C.scroll_y_min) m.mapCY = C.pan_y + 1; }
  }
}

function _stepHeldLists(m, state, sfx) {
  const keys = state.keys;
  if (!keys) return;
  const vsync = 1 / VSYNC;
  const now = m.time ?? 0;
  const last = m.listStepT ?? now;
  let frames = Math.floor(now / vsync) - Math.floor(last / vsync);
  m.listStepT = now;
  if (frames <= 0) return;
  frames = Math.min(frames, 4);
  const up = keys.has("up") ? -1 : keys.has("down") ? 1 : 0;
  if (up === 0) { m.listHold = 0; return; }
  for (let i = 0; i < frames; i++) {
    m.listHold = (m.listHold ?? 0) + 1;
    if (!padRepeatFires(m.listHold)) continue;
    if (m.screen === "home") {
      const n = topItems(m).length;
      const next = Math.max(0, Math.min(n - 1, m.mainCursor + up));
      if (next !== m.mainCursor) { m.mainCursor = next; sfx?.play("system02"); }
    } else if (m.screen === "items" && (m.itemMode === "cats" || m.itemMode == null)) {
      const next = Math.max(0, Math.min(ITEM_CATS.length - 1, m.itemCat + up));
      if (next !== m.itemCat) { m.itemCat = next; m.itemCursor = 0; sfx?.play("system02"); }
    } else if (m.screen === "sort") {
      // Both picks repeat. The second one skips the slot already chosen, the
      // same wrap-and-skip the press path uses, so holding a direction on
      // "Switch with who?" moves the arrow instead of sticking. The repeat
      // carries the same party-card cursor word as the press path (0x4001B).
      const n = (state.party ?? []).length;
      if (n >= 2) {
        let i = m.statusCursor;
        do { i = (i + up + n) % n; } while (m.sortPick != null && i === m.sortPick);
        if (i !== m.statusCursor) { m.statusCursor = i; sfx?.play("system06"); }
      }
    } else if (m.screen === "status-list" || m.screen === "techniques-pick") {
      // The two partner-choosers repeat as well; they CLAMP rather than wrap,
      // matching their own press path, and play that path's party-card word.
      const n = (state.party ?? []).length;
      const next = Math.max(0, Math.min(n - 1, m.statusCursor + up));
      if (next !== m.statusCursor) { m.statusCursor = next; sfx?.play("system06"); }
    }
  }
}

// F0x800986c0, called every vsync from the map root: poll held left/right
// and up/down separately, 2 then 4 after MAP_HOLD_FRAMES, 0 on release.
function _stepMapHeld(m, C, state) {
  const keys = state.keys;
  if (!keys) return;
  const vsync = 1 / VSYNC;
  const now = m.time ?? 0;
  const last = m.mapStepT ?? now;
  let frames = Math.floor(now / vsync) - Math.floor(last / vsync);
  m.mapStepT = now;
  if (frames <= 0) return;
  frames = Math.min(frames, 4);
  const heldX = keys.has("left") ? -1 : keys.has("right") ? 1 : 0;
  const heldY = keys.has("up") ? -1 : keys.has("down") ? 1 : 0;
  for (let i = 0; i < frames; i++) {
    if (heldX === 0) m.mapHoldX = 0;
    else {
      m.mapHoldX = (m.mapHoldX ?? 0) + 1;
      m.mapSpd = mapHoldSpeed(m.mapHoldX, C);
      _mapMove(m, C, heldX, 0);
    }
    if (heldY === 0) m.mapHoldY = 0;
    else {
      m.mapHoldY = (m.mapHoldY ?? 0) + 1;
      m.mapSpd = mapHoldSpeed(m.mapHoldY, C);
      _mapMove(m, C, 0, heldY);
    }
  }
}

function _drawMapPane(ctx, state, m, t, sfx = null) {
  const M = UI.screens.map;
  const C = M.cursor;
  // walker map id -> {ps1, server, loc} (composed through screen_table).
  const walkerStage = String(Number(String(state.manifest?.maps?.[state.mapIdx]?.id ?? "").replace(/\D/g, "")) || 0);
  const wm = M.walker_map[walkerStage] ?? { ps1: 0x200, server: 0, loc: 0 };
  const server = wm.server; // F0x8009a670: PS1 stage < 0x270 = Asuka
  const pk = server ? "stwmp1" : "stwmp0";
  const mapPack = loadPack(`${pk}map`), areaPack = loadPack(`${pk}area`), iconPack = loadPack(`${pk}icon`);
  // reveal tier from the story ordinal (F0x80098b84 thresholds 7/0xF/0x1B/0x1E)
  const ord = state.progressOrdinal ?? 0;
  let tier = 0;
  for (const th of M.tier_thresholds) if (ord >= th) tier++;
  const areas = M.tier_area_lists[server * 5 + tier] ?? [];
  const cur = M.markers[wm.loc - 1];

  if (!m.mapInit) {
    // The native init loop pans until the cursor reaches the current-location
    // arrow (step fn 0x8009913c) — start at that end state.
    m.mapInit = true;
    const tx = (cur?.x ?? 0xA0) + C.lock_offset, ty = (cur?.y ?? 0x78) + C.lock_offset;
    m.mapSX = Math.max(C.scroll_x_min, Math.min(0, C.pan_x - tx));
    m.mapSY = Math.max(C.scroll_y_min, Math.min(0, C.pan_y - ty));
    m.mapCX = Math.max(C.x_min, Math.min(C.x_max, tx + m.mapSX));
    m.mapCY = Math.max(C.y_min, Math.min(C.y_max, ty + m.mapSY));
    m.mapSpd = C.speed_initial; m.mapHover = 0; m.mapHoverY = m.mapCY;
    m.mapHoldX = 0; m.mapHoldY = 0; m.mapStepT = m.time ?? 0;
  }
  _stepMapHeld(m, C, state);
  const ox = m.mapSX, oy = m.mapSY + M.origin_y;

  // visited location markers on THIS server: every place the flag store says you have
  // been composes to a {server, loc} via walker_map (native: flag 0x2000|(ps1&0xff)
  // per stage, filler F0x8009a6b8). The current map's own marker always shows.
  const seenPs1 = new Set(visitedPs1Stages(state, UI, m.mapSeen));
  const vis = new Set();
  for (const row of Object.values(M.walker_map)) {
    if (seenPs1.has(row.ps1) && row.server === server && row.loc) vis.add(row.loc);
  }

  drawClip(ctx, mapPack, 0, ox, oy); // base map (16px banner strip above origin)
  for (const a of areas) {
    const p = M.area_positions[a];
    if (p) drawClip(ctx, areaPack, a - 1, p[0] + ox, p[1] + oy);
  }
  for (const r of M.markers) if (vis.has(r.loc)) drawClip(ctx, iconPack, r.clip, r.x + ox, r.y + oy);

  // hover test: 12px square at marker+(7..18) (F0x80098294), visited only
  const cmx = m.mapCX - m.mapSX, cmy = m.mapCY - m.mapSY;
  let hov = null;
  for (const r of M.markers) {
    if (!vis.has(r.loc)) continue;
    if (cmx > r.x + M.hover.box_min && cmx <= r.x + M.hover.box_max &&
        cmy > r.y + M.hover.box_min && cmy <= r.y + M.hover.box_max) { hov = r; break; }
  }
  if (hov && hov.loc !== m.mapHover) { sfx?.play("system07"); m.mapHoverY = m.mapCY; }
  m.mapHover = hov ? hov.loc : 0;

  // current-location arrow at marker+(12,12); flips when the cursor is left of it
  if (cur) {
    const A = M.current_arrow;
    const a3 = Math.floor(t * VSYNC / A.anim_vsync) % A.anim_frames;
    const ax = cur.x + A.offset[0], ay = cur.y + A.offset[1];
    const base = m.mapCX < ax + m.mapSX ? A.clip_right : A.clip_left;
    drawClip(ctx, iconPack, base + a3, ax + ox, ay + oy);
  }

  // cursor: locked on a marker (clip 0x38+anim at marker+12) or free (0x32+anim)
  const anim = C.anim[Math.floor(t * VSYNC / C.anim_vsync) % C.anim.length];
  if (hov) drawClip(ctx, iconPack, C.lock_clip + anim, hov.x + C.lock_offset + ox, hov.y + C.lock_offset + oy);
  else drawClip(ctx, iconPack, C.free_clip + anim, m.mapCX, m.mapCY + M.origin_y);

  // hover name window (ststat clip 0x3b): bottom when the cursor is in the
  // top half of the screen, else top; string bank esaskmap/esamtmap[record #]
  if (hov) {
    const HV = M.hover;
    const bottom = m.mapHoverY < 0x78;
    drawClip(ctx, ststat, HV.window.clip, 0, bottom ? HV.window.y_bottom : HV.window.y_top);
    const name = M.location_names[server ? "amaterasu" : "asuka"][hov.loc] ?? "";
    name.split("\\n").forEach((line, i) =>
      drawText(ctx, line, HV.text.x, (bottom ? HV.text.y_bottom : HV.text.y_top) + i * 11));
  }
}

// TECHNIQUES list: ststat window 0x3a @ (168,40), header @ (178,42),
// rows @ (197, 58+14i), cursor x=184 (ctor F0x80083680).
// The rows are the Digimon's field-usable HEALING techniques only — ids
// 0xB8..0xBC, de-duplicated, at most five (F0x800937a4) — drawn from the same
// reader the input machine walks (m.techRows: the three EQUIPPED forms' ledger
// slots; the species' own list is NOT what the original reads). A Digimon that
// knows none gets the real "Hasn't learned a technique." line, not a blank
// window.
function _drawTechniques(ctx, rows, m, t) {
  const T = UI.screens.techniques;
  // The window RESIZES with the row count: F0x800946bc picks its clip from the
  // 0x8009a950 table indexed by (rows - 1), so one to five heals get five
  // different window heights. An empty list keeps the smallest.
  const clips = UI.menu_window_clips;
  const winClip = clips[Math.max(0, Math.min(rows.length, clips.length) - 1)];
  drawClip(ctx, ststat, winClip, T.menu_window.x, T.menu_window.y);
  drawText(ctx, m.techMode === "use_target" ? "Use it on who?" : "Choose a technique",
    T.menu_header.x, T.menu_header.y);
  if (!rows.length) {
    drawText(ctx, "Hasn't learned", T.menu_rows.x, T.menu_rows.y_base);
    drawText(ctx, "a technique.", T.menu_rows.x, T.menu_rows.y_base + T.menu_rows.pitch);
    return;
  }
  rows.forEach((techId, i) => {
    const skill = m.skillDB?.[techId];
    const y = T.menu_rows.y_base + i * T.menu_rows.pitch;
    if (i === m.techCursor) drawCursor(ctx, t * VSYNC, T.cursor_x, y, gold);
    drawText(ctx, skill?.name ?? `Tech ${techId}`, T.menu_rows.x, y);
  });
  const sel = m.skillDB?.[rows[m.techCursor]];
  if (sel) {
    const scope = isPartyWide(rows[m.techCursor]) ? "All" : "One";
    drawText(ctx, `MP ${sel.mp_cost ?? 0}  ${scope}`,
      T.menu_rows.x, T.menu_rows.y_base + rows.length * T.menu_rows.pitch + 6, gold);
  }
}

// ITEMS: "Which one?" category picker, then the 8x2 bag (F0x80092fac).
function _drawItems(ctx, state, m, roster, t, fold = null) {
  const I = UI.screens.items;
  if (m.itemMode === "use_target") {
    _drawHeader(ctx, "Use it on who?", fold);
    _drawSidebar(ctx, roster, m, t, m.itemTarget, null, fold);
    _drawFooter(ctx, state, t, "[triangle] Button: Back to Menu", null, fold, { hideBit: true });
    return;
  }
  if (m.itemMode === "cats" || m.itemMode == null) {
    _drawHeader(ctx, "Which one?", fold);
    _drawSidebar(ctx, roster, m, t, -1, null, fold);
    _drawHomeBit(ctx, state);
    _drawHome(ctx, { ...m, mainCursor: m.itemCat, cardFolderUnlocked: () => false }, t, fold,
      ITEM_CATS);
    // §4.1: the label beside the highlighted category is esstatus 0x1B+cat
    // ("Use Item" … "All Important Items") whatever the tab holds — the empty
    // line ("No Items." …) is esstatus 0x64+cat and appears only on the confirm
    // press (see the cats arm in handleKey). It used to stand in here.
    const line1 = ITEM_CAT_ACTIONS[m.itemCat];
    _drawFooter(ctx, state, t, line1, "[triangle] Button: Back to Menu", fold, { hideBit: true });
    return;
  }

  const clipAt = (c) => () => drawClip(ctx, ststat, c.clip, c.x, c.y);
  const winP = fold ? fold("itemsList", ...(I.list_window.pivot ?? [0xA0, 0x60]), "xy", clipAt(I.list_window)) : (clipAt(I.list_window)(), 1);
  if ((fold ? fold("itemsTitle", ...(I.title_plate.pivot ?? [0xC, 0x17]), "x", clipAt(I.title_plate)) : (clipAt(I.title_plate)(), 1)) >= 1) {
    drawText(ctx, ITEM_CATS[m.itemCat], I.title_text.x, I.title_text.y);
  }
  const list = m.itemList(state);
  const G = I.grid;
  const perPage = G.cols * G.rows;
  const page = Math.floor((list.length ? m.itemCursor : 0) / perPage);
  const pageCount = Math.max(1, Math.ceil(list.length / perPage));
  if (fold) fold("itemsCat", ...(I.cat_plate.pivot ?? [0x140, 0x26]), "x", clipAt(I.cat_plate));
  else clipAt(I.cat_plate)();
  if (winP < 1) return;

  if (!list.length) {
    drawText(ctx, ITEM_CAT_EMPTY[m.itemCat], G.label_x, G.y_base);
  }
  const start = page * perPage;
  list.slice(start, start + perPage).forEach((slot, vi) => {
    const col = vi % G.cols, row = (vi / G.cols) | 0;
    const x = col * G.col_pitch, y = G.y_base + row * G.row_pitch;
    drawClip(ctx, ststat, G.cell_band_clip, G.icon_x + x, y);
    drawItemIcon(ctx, slot.id, G.icon_x + x, y - 1);
    if (start + vi === m.itemCursor) drawCursor(ctx, t * VSYNC, G.cursor_x + x, y, gold);
    const item = ITEM_BY_ID[slot.id];
    drawText(ctx, item?.name ?? `Item ${slot.id}`, G.label_x + x, y);
  });
  const k = Math.floor(t * VSYNC / UI.timings_vsync.items_arrow_cycle) % 4;
  const suffix = k === 0 ? "" : `#${k}`;
  if (page > 0) drawClip(ctx, ststat, `${I.page_arrows[0].clip}${suffix}`, I.page_arrows[0].x, I.page_arrows[0].y);
  if (start + perPage < list.length) drawClip(ctx, ststat, `${I.page_arrows[1].clip}${suffix}`, I.page_arrows[1].x, I.page_arrows[1].y);

  // The bottom of the bag is a PAGE COUNTER ("3 / 7"), with the shoulder
  // hints beside the two page arrows: L1 only when a page is behind you, R1
  // only when one is ahead. (F0x80091e94 builds the five widgets;
  // F0x80092340 fills them and hides the two hints at the ends.)
  const PC = I.page_counter;
  valueText(ctx, page + 1, PC.current_x, PC.y);
  drawText(ctx, PC.sep, PC.sep_x, PC.y, gold);
  valueText(ctx, pageCount, PC.total_x, PC.y);
  if (page > 0) drawText(ctx, I.page_hint_l1.str, I.page_hint_l1.x, I.page_hint_l1.y, gold);
  if (start + perPage < list.length) {
    drawText(ctx, I.page_hint_r1.str, I.page_hint_r1.x, I.page_hint_r1.y, gold);
  }

  // The band under the bag. All three things on it belong to the HIGHLIGHTED
  // row: its name, how many of it the party is wearing, and how many are in
  // the bag. F0x8008f0dc fills the five widgets built by F0x8008e94c:89-93 --
  // name from bank +0x6A by item id, then esstatus 0x20 "Equip" with the
  // +0x20F count, then esstatus 0x16 "Items" with the +0x7C count, both
  // numbers right-anchored. Every coordinate is from status_ui.json.
  const DB = I.detail_band;
  const held = list[m.itemCursor];
  if (DB && held) {
    const item = ITEM_BY_ID[held.id];
    drawText(ctx, item?.name ?? `Item ${held.id}`, DB.name.x, DB.name.y);
    drawText(ctx, DB.equip_label.str, DB.equip_label.x, DB.equip_label.y);
    // The two numbers are the same white face as the labels beside them:
    // F0x8008e94c builds all five widgets with kind 1 and F0x8008f0dc never
    // sets a CLUT on them, and the rig capture has the whole line in white.
    valueText(ctx, equippedCountOf(state, held.id), DB.equip_value_x, DB.equip_label.y, white);
    drawText(ctx, DB.held_label.str, DB.held_label.x, DB.held_label.y);
    valueText(ctx, held.qty ?? 1, DB.held_value_x, DB.held_label.y, white);
  }
}

// SEE DIGIVOLVE — a screen of its own, not a panel on the status sheet. Every
// number here is read from UI.screens.see_digivolve (claim
// SEE-DIGIVOLVE-SCREEN-LAYOUT-001: pictures F0x800895c8, text F0x8008833c,
// states F0x80089bf0, panel filler F0x80088a44, list filler F0x8008865c,
// action filler F0x8008886c). Reference capture
// docs/research/ui/captures/original-status-2026-09-03/03-choose-digivolve.png.
//
// The panel below the list belongs to the PARTNER, not to the highlighted
// candidate. F0x80088a44 has two branches: with no candidate it fills the
// panel from the partner's own block and titles it with the partner's name;
// with one highlighted it adds that species record's per-stat and per-
// resistance fields on top of the partner's live numbers, clamps each to 999,
// and titles the panel with the candidate's name. The capture is the first
// branch — Kotemon's sheet numbers appear unchanged one screen later.
//
// The candidate's name at form_name is NOT on screen while the list is up:
// F0x8008886c fills and hides it in the same call as the two action rows.
function _drawSeeDigivolve(ctx, p, m, state, t, fold = null) {
  const S = UI.screens.see_digivolve;
  const evos = window.__battle?.availableEvolutions?.(state, m.detailIdx) ?? [];
  const step = m.detailStep;
  // Which of the two right-hand windows is up. The candidate list and the
  // action pair are DIFFERENT windows over the same corner (clips 0x24 and
  // 0x26); the screen shuts one before it opens the other.
  const win = (key, node, axis, fn) => (fold
    ? fold(key, node.pivot?.[0] ?? 0, node.pivot?.[1] ?? 0, axis ?? "x", fn)
    : (fn(), 1));
  // The whole lower panel — its band, its icon column and every widget on it —
  // rides a Y offset the screen tweens between 0 and -34 (F0x800891a4 re-lays
  // all of them at obj+0x8c each frame).
  const dy = m._slideY ?? 0;
  const sel = evos.length && !m.dvHome ? (evos[m.detailSel] ?? null) : null;
  const stats = m.detailIdx === 0 ? state.partnerStats : state.partyStats?.[m.detailIdx];

  // The footer plate belongs to the STATUS screen underneath and is up the
  // whole time; the digivolve screen's own footer window carries the technique
  // explanation and the "Turned on/off" message.
  drawClip(ctx, ststat, S.footer_bar.clip, S.footer_bar.x, S.footer_bar.y);
  // No footer STRING here. The two footer text widgets belong to the status
  // screen underneath and are hidden while a sub-screen is up — capture
  // 03-choose-digivolve.png has bare plate under the panel.

  // The partner card is the SHEET's, still open behind this screen; this
  // screen draws only its own name plate over the sheet's closed name tab.
  win("dvName", S.name_plate, "x",
    () => drawClip(ctx, cmfont, S.name_plate.clip, S.name_plate.x, S.name_plate.y));
  if (m._foldReady("dvName") && m._isOpen("dvName")) {
    drawText(ctx, "Choose digivolve", S.header.x, S.header.y);
  }

  // The lower panel: its band, its baked stat-icon column, then its header row
  // — the name of whatever it is showing, "Skill LV", and the level.
  const panelOpen = win("dvPanel", S.band, "x", () => {
    drawClip(ctx, ststat, S.band.clip, S.band.x, S.band.dy + dy);
    drawClip(ctx, cmfont, S.label.clip, S.label.x, S.label.dy + dy);
  }) >= 1;
  const formProf = sel ? m.digimonDB?.[sel.formId] : null;
  if (panelOpen) {
    drawText(ctx, (sel ? (sel.to ?? "") : (p?.name ?? "")),
      S.panel_row.name_x, S.panel_row.y + dy);
    drawText(ctx, S.panel_row.label, S.panel_row.label_x, S.panel_row.y + dy);
    // With a candidate highlighted the original always has a number here (the
    // digivolution record's field +2); a form the partner has never taken is a
    // fresh record, which the walker's own ledger defines as level 1.
    const formLevel = sel
      ? (formLedgerRecord(stats, sel.formId, m.digimonDB ?? {})?.formLevel ?? 1)
      : null;
    if (formLevel != null) valueText(ctx, String(formLevel), S.panel_row.level_x, S.panel_row.y + dy);
    else drawText(ctx, S.panel_row.level_none, S.panel_row.level_x, S.panel_row.y + dy);

    // The panel's numbers are WHITE, as they are on the status sheet — capture
    // 03-choose-digivolve.png. Only the card's LV/HP/MP and the technique names
    // are gold. The partner's part is its own LIVE block — the sheet's reader,
    // stored + chips + worn gear — not the raw stored stats: F0x80088A44 reads
    // the same F0x80017174 copy the sheet does, and folds the worn gear in.
    ensureEquipment(state);
    const wornSlots = state.equipment?.[m.detailIdx ?? 0] ?? {};
    const wornSlot = rosterSlotOfCharId(String(state.party?.[m.detailIdx ?? 0] ?? ""));
    STAT_ROWS.forEach((stat, i) => {
      const y = S.stat_values.y_base + i * S.stat_values.pitch + dy;
      valueText(ctx, String(seeDigivolvePanelStat(p, wornSlots, stat, wornSlot, formProf)),
        S.stat_values.x, y, white);
    });
    RES_ROWS.forEach((res, i) => {
      const y = S.res_values.y_base + i * S.res_values.pitch + dy;
      valueText(ctx, String(seeDigivolvePanelRes(p, wornSlots, res, formProf)),
        S.res_values.x, y, white);
    });

    // The six technique slots are on screen in EVERY state, with the element
    // icon of each beside it — the capture shows one filled slot while the
    // candidate list is up. They are the candidate's when one is highlighted and
    // the partner's own when none is.
    const slots = sel
      ? formTechSlots(stats, sel.formId, m.digimonDB)
      : ownTechSlots(p?.profile);
    slots.slice(0, S.tech_rows.n).forEach((id, i) => {
      if (!id) return;
      const tech = m.skillDB?.[id];
      const y = S.tech_rows.y_base + i * S.tech_rows.pitch + dy;
      const iy = S.tech_icons.y_base + i * S.tech_icons.pitch + dy;
      // The badge beside the slot is the technique record's +4 byte, not its
      // element — see techBadgeClip. Kotemon's "Hot Head" is clip 57, the red
      // triangle in capture 03-choose-digivolve.png.
      const badgeClip = techBadgeClip(tech);
      if (badgeClip != null) drawClip(ctx, cmfont, badgeClip, S.tech_icons.x, iy);
      if (step === "techinfo" && i === (m.techInfoSel ?? 0)) {
        drawCursor(ctx, t * VSYNC, S.tech_rows.cursor_x, y, gold);
      }
      drawText(ctx, tech?.name ?? "", S.tech_rows.x, y, gold);
    });
  }

  // The candidate list window (clip 0x24).
  if (win("dvList", S.window, "x",
      () => drawClip(ctx, ststat, S.window.clip, S.window.x, S.window.y)) >= 1
      && m._isOpen("dvList")) {
    evos.slice(0, S.list_rows.n).forEach((e, i) => {
      const y = S.list_rows.y_base + i * S.list_rows.pitch;
      if (!m.dvHome && i === m.detailSel) drawCursor(ctx, t * VSYNC, S.list_rows.cursor_x, y, gold);
      // NOT gold for being the current form. Capture 03-choose-digivolve.png
      // shows Kotemon's only row -- which IS its current form -- in the white
      // face, beside "Hot Head" in the gold one. The walker coloured it gold
      // until 2026-09-04 on no evidence. Whether the original ever colours a
      // row, and on what test, is NOT established.
      drawText(ctx, e.to ?? "", S.list_rows.x, y);
    });
  }
  // The partner's own name, in the panel above the list. F0x8008865c fills it
  // from the partner record every time it fills the list, never a candidate.
  if (panelOpen) drawText(ctx, p?.name ?? "", S.partner_name.x, S.partner_name.y);
  // The cursor's HOME is here, beside that name — the solid triangle in the
  // capture that nothing used to draw.
  if (m.dvHome && step === "digivolve" && S.cursor_home) {
    drawCursor(ctx, t * VSYNC, S.cursor_home.x, S.cursor_home.y, gold);
  }

  // The action pair window (clip 0x26) — a different, shorter window in the
  // same corner, with the highlighted candidate's name over it.
  if (win("dvAct", S.window_alt, "x",
      () => drawClip(ctx, ststat, S.window_alt.clip, S.window_alt.x, S.window_alt.y)) >= 1
      && m._isOpen("dvAct")) {
    const target = evos[m.detailSel];
    if (target) {
      drawText(ctx, target.to ?? "", S.form_name.x, S.form_name.y);
      [battleDigivolveLabel(p, target), S.action_rows.row1].forEach((label, i) => {
        const y = S.action_rows.y_base + i * S.action_rows.pitch;
        if (i === (m.dvAction ?? 0)) drawCursor(ctx, t * VSYNC, S.action_rows.cursor_x, y, gold);
        drawText(ctx, label, S.action_rows.x, y);
      });
    }
  }

  // This screen's OWN footer window: the technique explanation with its MP
  // cost, or the "Turned on/off Battle Digivolve" message (F0x8008933c and
  // states 0x1c/0x3f, both filling the widgets at the shared label-table
  // records +0x90, +0x9c and +0xa8).
  if (win("dvFoot", S.footer_bar, "x",
      () => drawClip(ctx, ststat, S.footer_bar.clip, S.footer_bar.x, S.footer_bar.y)) >= 1
      && m._isOpen("dvFoot")) {
    if (step === "dvmessage" && m.dvMessage) {
      drawText(ctx, m.dvMessage, S.explanation.x, S.explanation.y);
    } else if (step === "techinfo") {
      const target = evos[m.detailSel];
      const slots = m.dvBackStep === "dvaction" && target
        ? formTechSlots(stats, target.formId, m.digimonDB)
        : ownTechSlots(p?.profile);
      const tech = m.skillDB?.[slots[m.techInfoSel ?? 0]];
      if (tech) {
        drawText(ctx, tech.desc || "", S.explanation.x, S.explanation.y);
        drawText(ctx, S.mp_label.str, S.mp_label.x, S.mp_label.y, gold);
        valueText(ctx, tech.mp_cost ?? 0, S.mp_value.x, S.mp_value.y);
      }
    }
  }
}

// STATUS DETAIL (state3): single card + name tab 0x1f @ (20,13), EXP plate
// (cmfont 0x1a @ (0,61), value right-anchored at x=66), stat window 0x21 @
// (0,84) with the baked icon column (cmfont 0x0f @ (0,87)) and values at
// x=50/x=91 (y=91+14i), TP plate 0x3c @ (0,196) value @ (45,203), Digivolve
// window 0x22 @ (160,53) rows @ (178,71+14i), Equip window 0x23 @ (160,119)
// rows @ (192,137+14i). (F0x8008c954 / F0x8008b520.)
function _drawDetail(ctx, p, m, state, t, fold = null) {
  const D = UI.screens.detail;
  const sh = UI.screens.shared;
  // Every panel on this sheet is its own folding window, opened in pairs by
  // F0x8008d684: card + name tab, then EXP plate + Digivolve panel, then stat
  // window + Equip panel. `win` draws one of them through its decoded pivot.
  const win = (key, node, fn) => (fold
    ? fold(key, node.pivot?.[0] ?? 0, node.pivot?.[1] ?? 0, "x", fn)
    : (fn(), 1));

  win("shName", D.name_tab, () => drawClip(ctx, ststat, D.name_tab.clip, D.name_tab.x, D.name_tab.y));
  _drawCard(ctx, p, 0, t, fold, fold ? "shCard" : null);
  // No selection ring here. The sheet shows ONE card and nothing to choose
  // between, and the original draws it in plain card chrome — capture
  // docs/research/ui/captures/original-status-2026-09-03/02-status-sheet.png.

  const expOpen = win("shExp", D.exp_plate,
    () => drawClip(ctx, cmfont, D.exp_plate.clip, D.exp_plate.x, D.exp_plate.y)) >= 1;
  if (expOpen) {
    valueText(ctx, p?.xp ?? 0, D.exp_value.x, D.exp_value.y);
    drawText(ctx, D.exp_label.str, D.exp_label.x, D.exp_label.y, gold);
  }

  const statOpen = win("shStat", D.stat_window, () => {
    drawClip(ctx, ststat, D.stat_window.clip, D.stat_window.x, D.stat_window.y);
    drawClip(ctx, cmfont, D.stat_icons.clip, D.stat_icons.x, D.stat_icons.y);
  }) >= 1;
  // What the sheet shows is the member's stats WITH what they are wearing. The
  // original reads them off the same display block the shop card fills: for a
  // Kotemon holding nothing the sheet said 48 / 1, and with the Asuka Armory
  // Short Sword worn it said POW 62 and CHR 16 -- base + that item's 14 attack
  // and 15 charisma (claims EQUIP-C018-pause-status-sheet-gear-inclusive and
  // EQUIP-C020-status-sheet-folds-gear-at-display, capture
  // docs/research/ui/captures/shop-gear-pause-menu-2026-09-09.md sections 3 and 7).
  // The resist column follows the same rule and is proven the same way: a Flame
  // Ring worn in the first accessory slot showed fire 105 there while the member
  // record still held 85, so the record stores no effective resist and adding the
  // worn item's value here cannot double-count.
  ensureEquipment(state);
  const wornSlots = state.equipment?.[m.detailIdx ?? 0] ?? {};
  // The signature-set bonus is keyed by the member's ROSTER slot (F0x80017174 indexes
  // 0x8004B53C by it), so the sheet resolves it from the party position it is showing.
  const wornSlot = rosterSlotOfCharId(String(state.party?.[m.detailIdx ?? 0] ?? ""));
  if (statOpen) {
  STAT_ROWS.forEach((stat, i) => {
    const y = D.stat_values.y_base + i * D.stat_values.pitch;
    // gear-inclusive, clamped at 999 like F0x80088a64, with the profile value as
    // fallback before any battle stats exist.
    // Right-anchored in the number font, as the original draws them: each value
    // ENDS at the decoded x so it never runs into the next baked icon column.
    valueText(ctx, String(sheetStatValue(p, wornSlots, stat, wornSlot)), D.stat_values.x, y, white);
  });
  RES_ROWS.forEach((res, i) => {
    const y = D.res_values.y_base + i * D.res_values.pitch;
    valueText(ctx, String(sheetResValue(p, wornSlots, res)), D.res_values.x, y, white);
  });
  }

  // The bottom band holds ONE of two things, never both: the shared footer
  // plate sits at (0,194) and the TP plate at (0,196), so they cannot coexist.
  // The sheet shows TP — capture
  // docs/research/ui/captures/original-status-2026-09-03/02-status-sheet.png —
  // and its Equip rows run down through the same band, so the sheet's own
  // widgets go down last. The TP plate belongs to the STAT WINDOW's fold slot
  // and has its own hinge (F0x8008c954, guard unk100, pivot (0,0xd0)).
  const evos = window.__battle?.availableEvolutions?.(state, m.detailIdx) ?? [];
  if (win("shStat", D.tp_plate,
      () => drawClip(ctx, ststat, D.tp_plate.clip, D.tp_plate.x, D.tp_plate.y)) >= 1) {
    // Both TP widgets are kind 1 in F0x8008b520 — the capture shows "TP 0" white.
    drawText(ctx, D.tp_label.str, D.tp_label.x, D.tp_label.y, white);
    valueText(ctx, p?.tp ?? 0, D.tp_value.x, D.tp_value.y, white);
  }

  // Digivolve panel
  if (win("shDv", D.digivolve_window,
      () => drawClip(ctx, ststat, D.digivolve_window.clip, D.digivolve_window.x, D.digivolve_window.y)) >= 1) {
    drawText(ctx, "Digivolve", D.digivolve_header.x, D.digivolve_header.y);
    evos.slice(0, D.digivolve_rows.n).forEach((e, i) => {
      const y = D.digivolve_rows.y_base + i * D.digivolve_rows.pitch;
      drawText(ctx, e.to ?? "", D.digivolve_rows.x, y);   // see _drawSeeDigivolve: not gold
    });
  }

  // Equip panel
  if (win("shEq", D.equip_window,
      () => drawClip(ctx, ststat, D.equip_window.clip, D.equip_window.x, D.equip_window.y)) >= 1) {
    drawText(ctx, "Equip", D.equip_header.x, D.equip_header.y);
    ensureEquipment(state);
    const equipped = state.equipment[m.detailIdx] ?? {};
    EQUIP_SLOTS.forEach((slot, i) => {
      const y = D.equip_rows.y_base + i * D.equip_rows.pitch;
      const itemId = equipped[EQUIP_SLOT_KEYS[i]];
      const item = itemId != null ? (ITEM_BY_ID[itemId] ?? EQUIPMENT_BY_ID[itemId]) : null;
      // An empty slot shows its own name in the ordinary white face, exactly as a
      // filled one shows the item's name (capture 02-status-sheet.png).
      drawText(ctx, item ? item.name : slot, D.equip_rows.x, y);
    });
  }

  // The sheet's own two-row prompt (F0x8008bd70 / F0x8008d684 state 5): rows at
  // (172, 19+14i), cursor at (152, 19+14i). It is filled once the Digivolve
  // panel is up and hidden the moment the sheet starts to shut.
  if (m.detailStep === "prompt" && D.prompt && m._foldReady("shDv")) {
    D.prompt.rows.forEach((label, i) => {
      const y = D.prompt.y_base + i * D.prompt.pitch;
      if (i === m.detailFocus) drawCursor(ctx, t * VSYNC, D.prompt.cursor_x, y, gold);
      drawText(ctx, label, D.prompt.x, y);
    });
  }
}

// The FULL equip screen (draw F0x80086dd4 + ctor F0x80086498 + fillers
// F0x80086680/F0x80086900/F0x800867b8/F0x80086c78, all values decoded):
// header plate + "Change which one?" (esstatus 0x3f); slots window ststat
// 0x2a @ (157,40) with 6 slot rows (icon x=178, name x=192, y=49+14i, empty
// slot = grey name from 0x8009a7ac); bag-list window 0x2b @ (119,57) with 8
// visible rows (plate 0x31 + icon x=145, name x=160, grey "X" right-aligned
// at 269, bag count right-aligned at 288, y=75+14i), blinking scroll arrows
// 0x32/0x33 at x=294 when >8 rows; current-equipment panel 0x2c @ (160,17);
// footer plate with item desc + wield-slot line. Grey = native palette+0xb0.
const GREY = { color: "rgb(136,136,152)" };
function _drawEquip(ctx, state, m, p, t, fold) {
  const E = UI.screens.equip;
  const sh = UI.screens.shared;
  const D = UI.screens.detail;
  ensureEquipment(state);
  const equipped = state.equipment[m.detailIdx] ?? {};
  const slotKey = EQUIP_SLOT_KEYS[m.equipCursor];
  const options = m.equipFocus === "list" ? equipPickOptions(state, m.detailIdx, slotKey) : null;
  const { snapshot, preview } = previewEquipment(state, m);
  // Same rule as the sheet behind it: the four-piece set bonus is keyed by the
  // roster slot, so the equip screen's live numbers use the same one.
  const wornSlot = rosterSlotOfCharId(String(state.party?.[m.detailIdx ?? 0] ?? ""));

  if (D?.stat_window) {
    drawClip(ctx, ststat, D.stat_window.clip, D.stat_window.x, D.stat_window.y);
    if (D.stat_icons) drawClip(ctx, cmfont, D.stat_icons.clip, D.stat_icons.x, D.stat_icons.y);
    STAT_ROWS.forEach((stat, i) => {
      const y = D.stat_values.y_base + i * D.stat_values.pitch;
      const after = sheetStatValue(p, preview, stat, wornSlot);
      const before = sheetStatValue(p, snapshot, stat, wornSlot);
      // These are the STATUS SHEET's own widgets, still on screen: the equip
      // screen's ctor F0x80086498 builds no stat widget and its draw F0x80086dd4
      // never lays down the stat window, so it draws over a sheet that is still
      // there. Same face, same right-hand anchor, same palette pair: the preview
      // paints palette 1 rose / 5 fell (F0x8008C460), not the sheet's grey mark.
      valueText(ctx, String(after), D.stat_values.x, y, sheetPreviewFace(before, after));
    });
    RES_ROWS.forEach((res, i) => {
      const y = D.res_values.y_base + i * D.res_values.pitch;
      const after = sheetResValue(p, preview, res);
      const before = sheetResValue(p, snapshot, res);
      valueText(ctx, String(after), D.res_values.x, y, sheetPreviewFace(before, after));
    });
  }

  // header plate + prompt (prompt shows while choosing a slot)
  const H = E.header_plate;
  const headerShown =
    fold("eqHeader", ...H.pivot, "x", () => drawClip(ctx, cmfont, H.clip, H.x, H.y)) >= 1;

  // The sheet is STILL THERE. This screen's own ctor F0x80086498 builds no card,
  // no EXP plate and no TP plate, and its draw F0x80086dd4 lays none of them
  // down -- the same reason the stat window above is the sheet's, not this
  // screen's. So the partner's card, its picture, the EXP plate and the TP plate
  // stay on screen where the sheet puts them. The archived proof is the sibling
  // sub-screen: captures/original-status-2026-09-03/03-choose-digivolve.png
  // keeps the card, LV/HP/MP, the picture and the stat window while its own
  // panels are up. The operator also showed a capture of THIS screen on
  // 2026-09-04 with Kotemon's plate, LV/HP/MP, the pedestal picture, "4 EXP" and
  // "TP 0" all behind "Change which one?"; that image was pasted in conversation
  // and is NOT archived here. Claim EQUIP-SHEET-WIDGETS-001. Until 2026-09-04
  // this screen drew none of them, and a comment here asserted there was no
  // card.
  //
  // The sheet's name tab is NOT among them. That clip is a full-width band
  // (x=20..320), and this screen lays its own header plate over the same rows,
  // so drawing both would bury the prompt. The card chrome carries the rounded
  // plate the partner's name sits in, and it goes down AFTER the header plate,
  // which is why the name reads over the band in the capture.
  _drawCard(ctx, p, 0, t);
  drawClip(ctx, cmfont, D.exp_plate.clip, D.exp_plate.x, D.exp_plate.y);
  valueText(ctx, p?.xp ?? 0, D.exp_value.x, D.exp_value.y);
  drawText(ctx, D.exp_label.str, D.exp_label.x, D.exp_label.y, gold);
  drawClip(ctx, ststat, D.tp_plate.clip, D.tp_plate.x, D.tp_plate.y);
  drawText(ctx, D.tp_label.str, D.tp_label.x, D.tp_label.y, white);
  valueText(ctx, p?.tp ?? 0, D.tp_value.x, D.tp_value.y, white);

  // The prompt goes down last: the card chrome ends at x=147 and the prompt
  // starts at x=152, so the two do not meet, but the text must survive the card.
  if (headerShown && m.equipFocus === "slots") {
    drawText(ctx, E.header_text.str, E.header_text.x, E.header_text.y, GREY);
  }

  // slots window (profile +0x3c0 order: Head/Body/Right/Left/Acc/Acc);
  // native closes it while the bag list is up (F0x80087890)
  const SW = E.slots_window;
  if (m.equipFocus === "slots" &&
      fold("eqSlots", ...SW.pivot, "x", () => drawClip(ctx, ststat, SW.clip, SW.x, SW.y)) >= 1) {
    for (let i = 0; i < E.slots.n; i++) {
      const y = E.slots.y_base + i * E.slots.pitch;
      const itemId = equipped[EQUIP_SLOT_KEYS[i]];
      if (m.equipFocus === "slots" && i === m.equipCursor) drawCursor(ctx, t * VSYNC, E.slots.cursor_x, y, gold);
      if (itemId != null) {
        drawItemIcon(ctx, itemId, E.slots.icon_x, y - 1);
        drawText(ctx, ITEM_BY_ID[itemId]?.name ?? EQUIPMENT_BY_ID[itemId]?.name ?? "?", E.slots.label_x, y);
      } else {
        drawText(ctx, E.slot_names[i], E.slots.label_x, y, GREY);
      }
    }
  }

  // bag-list window (only while picking an item for the chosen slot)
  if (m.equipFocus === "list") {
    const LW = E.list_window;
    // F0x80086900 .L0x00003d14-.L0x00003d50: for every row item the original
    // calls [0x8009b5f0] (= F0x8009A344, the row admission test the walker
    // ports as pauseEquipRowAdmits) and paints the row's NAME widget with
    // palette 0 when it admits the piece, palette 7 when it refuses. The
    // take-off row (id -1) is skipped by the `blez` at :3d04, so it keeps its
    // own grey. The refusal colour had been open since 2026-07-10.
    const listRow = EQUIP_ROW_SLOTS.indexOf(slotKey);
    const listLine = rosterSlotOfCharId(String(state.party?.[m.detailIdx ?? 0] ?? ""));
    if (fold("eqList", ...LW.pivot, "x", () => drawClip(ctx, ststat, LW.clip, LW.x, LW.y)) >= 1) {
      const L = E.list;
      drawText(ctx, E.slot_names[m.equipCursor], L.header.x, L.header.y, GREY);
      options.slice(m.equipScroll, m.equipScroll + L.rows).forEach((opt, vi) => {
        const y = L.y_base + vi * L.pitch;
        const idx = m.equipScroll + vi;
        drawClip(ctx, ststat, L.plate_clip, L.icon_x, y);
        if (idx === m.equipListCursor) drawCursor(ctx, t * VSYNC, L.cursor_x, y, gold);
        if (opt.unequip) {
          drawText(ctx, E.unequip_label, L.label_x, y, GREY);
        } else {
          drawItemIcon(ctx, opt.id, L.icon_x, y - 1);
          const refused = !pauseEquipRowAdmits(listLine, listRow, opt.id);
          drawText(ctx, opt.name, L.label_x, y, refused ? { clut: 7 } : undefined);
          const qty = heldCount(state, opt.id);
          drawText(ctx, E.x_label, L.x_label_x - textWidth(E.x_label), y, GREY);
          valueText(ctx, qty, L.qty_x, y);
        }
      });
      // blinking scroll arrows (toggle every 9 vsyncs) when >8 rows
      if (options.length > L.rows) {
        const on = Math.floor(t * VSYNC / E.scroll_arrows.blink_vsync) % 2 === 0;
        if (on) {
          const A = E.scroll_arrows;
          if (m.equipScroll > 0) drawClip(ctx, ststat, A.up.clip, A.up.x, A.up.y);
          if (m.equipScroll < options.length - L.rows) drawClip(ctx, ststat, A.down.clip, A.down.x, A.down.y);
        }
      }
      const bar = equipScrollbarThumb(options.length, m.equipListCursor, E.scrollbar ?? EQUIP_SCROLLBAR);
      if (bar) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
      }
    }
  }

  // current-equipment panel (top right, list mode only): "Equip" +
  // selected slot's current item (F0x80086c78)
  const DW = E.detail_window;
  if (m.equipFocus === "list" &&
      fold("eqDetail", ...DW.pivot, "x", () => drawClip(ctx, ststat, DW.clip, DW.x, DW.y)) >= 1) {
    drawText(ctx, E.detail.label.str, E.detail.label.x, E.detail.label.y, GREY);
    const curId = equipped[slotKey];
    if (curId != null) {
      drawItemIcon(ctx, curId, E.detail.icon_x, E.detail.value_y - 1);
      drawText(ctx, ITEM_BY_ID[curId]?.name ?? EQUIPMENT_BY_ID[curId]?.name ?? "?", E.detail.value_x, E.detail.value_y);
    } else {
      drawText(ctx, E.slot_names[m.equipCursor], E.detail.value_x, E.detail.value_y, GREY);
    }
  }

  // footer plate + desc lines (list mode only — drawn inside the list
  // window's branch in F0x80086dd4)
  if (m.equipFocus === "list" &&
      fold("eqList", ...(sh.footer.pivot ?? [0, 0xD3]), "x",
        () => drawClip(ctx, ststat, sh.footer.clip, sh.footer.x, sh.footer.y)) >= 1) {
    const sel = options[m.equipListCursor];
    const [d1, d2] = E.desc_lines;
    if (sel?.unequip) {
      drawText(ctx, E.unequip_desc, d1.x, d1.y);
    } else if (sel) {
      const item = ITEM_BY_ID[sel.id];
      if (item?.desc) drawText(ctx, item.desc, d1.x, d1.y);
      // native line 2 = 0x8009a7c4[stat-record byte +0x2 - 1], the esstatus
      // wield string. Decoded from ststatus F0x800867b8 at 0x3bb4-0x3bc8 (the
      // 8-word table at file 0x17b14 = string ids 67,77,79,65,66,68,80,68 =
      // Right/Left/Left or Right/Head/Body/Accessory/Two-handed/Accessory).
      const eq = EQUIPMENT_BY_ID[sel.id];
      const wieldName = wieldNameFor(eq, E.wield_names);
      if (wieldName) drawText(ctx, wieldName, d2.x, d2.y, GREY);
    }
  }
}
