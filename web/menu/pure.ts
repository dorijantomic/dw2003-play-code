import { screenIdForStage, listScrollbarThumb } from "../vendor/engine.js";
import { loadPack } from "../screenpack.js";
import { MS } from "./state.js";

// Real top-menu strings (lang_file/dw2003/eng/esstatus.toml 6-11). CARD FOLDERS
// is string 11, the 6th entry, gated by the card-game unlock. UNKNOWN U-04:
// the original writer of that flag was not in the scanned C/asm.
const TOP_ITEMS_BASE = ["ITEMS", "SORT", "MAP", "TECHNIQUES", "STATUS"];

export const CARD_FOLDERS = "CARD FOLDERS";               // esstatus string 11

// The Card Folders sub-entries, both real game strings:
//   "Card Album"  — escrdabm string 1
//   "Edit Folder" — escrdshp string 7
export const CARD_FOLDER_ROWS = ["Card Album", "Edit Folder"];

// The Digivolve Demo setup screen. Its title, its two choices and its
// explanation are the game's own strings (esstatus 0x46/0x47/0x48/0x49); what
// the disc does NOT have is any way to open it — the pause menu's cursor stops
// one row short of it in both menu variants
// (ledger UI-DEMO-SETUP-SCREEN-HAS-NO-SELECTOR-WRITE-2026-08-14).
//
// So this row is OFF by default: the shipped menu stays exactly as authentic as
// it was. Turn it on with localStorage `demoSetupRow` = "1" or `?demoSetup=1`.
// It is also always reachable from the UI lab, which is a debug surface.
export const DEMO_SETUP_TITLE = "Digivolve Demo";

export const DEMO_SETUP_ROWS = ["ON", "OFF"];

export const DEMO_SETUP_HINT = "Setup the Battle Digivolve demo";

export const DEMO_SETUP_LABEL = "Demo Setup";   // esstatus 0x2F

function demoSetupRowEnabled() {
  try {
    if (localStorage.getItem("demoSetupRow") === "1") return true;
    return new URLSearchParams(location.search).get("demoSetup") === "1";
  } catch { return false; }
}

/** The visible top menu. CARD FOLDERS appears only once the player has cards. */
export function topItems(m) {
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

/** A walker map id ("s205", 205) as the key the decoded walker_map table uses. */
const stageKey = (stage) => String(Number(String(stage ?? "").replace(/\D/g, "")) || 0);

export function mapPs1Id(state, ui = MS.UI) {
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
export function visitedPs1Stages(state, ui = MS.UI, hasFlag = null) {
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
export function pauseMapContext(state, ui = MS.UI, hasFlag = null) {
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

export function mapUnavailable(state, ui = MS.UI) {
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

export const CARD_FOLDER_FADE_MAX = 0xFF00;

export const CARD_FOLDER_FADE_DELTA = Math.trunc(CARD_FOLDER_FADE_MAX / CARD_FOLDER_FADE_FRAMES);

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

export const EQUIP_SLOTS = ["Head", "Body", "Right", "Left", "Accessory", "Accessory"];

// Real engine EquipSlot keys, index-aligned with EQUIP_SLOTS above.
export const EQUIP_SLOT_KEYS = ["head", "body", "right", "left", "acc0", "acc1"];

export const STAT_ROWS = ["str", "def", "spt", "wis", "spd", "chr"];

export const RES_ROWS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"];

// Real ITEMS-screen categories (esstatus.toml strings 22-26). The overlay
// opens on "Which one?" (string 0x1A) and only then the 2-column bag; L1/R1
// page that bag. Rig: docs/research/ui/captures/pause-items-which-one-2026-08-20.png.
export const ITEM_CATS = ["Items", "Weapons", "Armor", "Accessories", "Important Items"];

export const ITEM_CAT_EMPTY = ["No Items.", "No Weapons.", "No Armor.", "No Accessories.", "No Important Items."];

export const ITEM_CAT_ACTIONS = ["Use Item", "All Weapons", "All Armors", "All Accessories", "All Important Items"];

export const NATIVE_W = 320, NATIVE_H = 240;

export const VSYNC = 50; // PAL

export const ststat = loadPack("ststat");

export const cmfont = loadPack("cmfont");
