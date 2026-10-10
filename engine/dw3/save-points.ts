// engine/dw3/save-points.ts — the 25 save points and the memory-card slot each
// one selects.
//
// DECODED 2026-09-22 (Phase 6). Before this, the walker's comment said "the
// original's own call site into the stgmcard overlay from a save point is still
// untraced". It is traced now; the whole producer path is:
//
//   * A save point is a stage EVENT. Every inn / tower / city map carries one
//     event whose text is "PREPARE TO SAVE." and whose last opcode is
//     `HANDOFF 0xC0n 0 0 0` (`web/assets/events/wstag_events.json`; e.g. s235
//     Asuka Inn event 1200 = `HANDOFF 3073` = 0xC01). The operand is NOT a stage
//     id — the type-7 record table only covers 512..750 — it is the resident
//     screen launcher's code: 0xC00 | slot.
//   * The interpreter's HANDOFF opcode calls `D0x8008b770(id, -1, x<<8, y<<8, p)`
//     (docs/research/scripting/field-script-engine-verified.md §opcode 3.4). The
//     worker `F0x8008b6d4` stores the id in the type-7 manager's `+0x5C` and the
//     fixed -1 in `+0x60`, then sets the manager's state to 2.
//   * The manager's state-2 arm calls `F0x80089f7c(manager, descriptor)` when
//     `+0x5C != 0` (exe-decomp/fieldstg_c/F0x8008aa10.c, `case 2`), and that
//     function, once its fade counter reaches 0x10, calls the resident launcher
//     `D0x8004b440(manager+0x5C, manager+0x60)` (exe-decomp/fieldstg_c/
//     F0x80089f7c.c L150).
//   * The launcher is `F0x80016b88` (`data.rs` 0x8004b440 = addr_of!(F0x80016b88)):
//     it stores `arg0` in `ctx+0x26C8` (= 0x8004b3fc, pending) and `arg1` in
//     `ctx+0x26D0` (= 0x8004b404, the value word). The main loop's `F0x80016b28`
//     promotes the pending word into `ctx+0x26C4` (= 0x8004b3f8, current).
//   * `f15` (`~/ddw3/asm/dw2003/exe/f15.s`) loads the overlay library indexed by
//     `code >> 8`; `0x0C0D >> 8 = 0x0C` = STMCRD = `pro/stgmcard`, and the low
//     byte is passed through to the screen.
//   * `pro/stgmcard`'s constructor `F0x80087b08` reads exactly that:
//     `slot = D0x8004b3f8 & 0xFF`, `mode = (D0x8004b404 >> 31) ^ 1` (0 = save,
//     1 = load), and looks the slot up in the per-save-point table
//     `D0x8008833C`.
//
// The save/load mode follows from the HANDOFF's fixed -1 value word: bit 31 is
// set, so `(value >> 31) ^ 1 == 0` — every save-point event opens the screen in
// SAVE mode. (The title's Continue opens the same overlay with value 0, i.e.
// load; see web/game.js.)
//
// The slot is visible to the player: the saved record's `+0x1C` place index is
// an `esshpnam` bank index and the 25 save points occupy the bank's tail.
// `place index = 42 + slot` for every one of them — verified against
// `web/assets/data/stgmcard_ui.json` `strings.placeBank` and cross-checked
// mechanically by `tests/save-points.test.js`, which re-reads the event table so
// the two can never drift.

export interface SavePointAlias {
  /** A side stage that reuses this save point. */
  stage: number;
  /** That stage's own "PREPARE TO SAVE." event id. */
  eventId: number;
}

export interface SavePoint {
  /** 1-based slot: the low byte of the launch code `0xC00 | slot`. */
  slot: number;
  /** The stage whose save-point event fires here. */
  stage: number;
  /** Side stages that reuse the same save point and slot. */
  aliasStages: readonly SavePointAlias[];
  /** `esshpnam` bank index the saved record shows for this place. */
  placeIndex: number;
  /** The `esshpnam` string at `placeIndex`. */
  place: string;
  /** The stage event carrying the `HANDOFF`. */
  eventId: number;
  /** The launch code the event's `HANDOFF` operand carries (`0xC00 | slot`). */
  launchCode: number;
}

/**
 * `esshpnam` index of the first save point. Entries 0..41 are shops, the
 * Digimon Caretaker and service strings; 43..67 are the 25 save points.
 */
export const SAVE_POINT_PLACE_BASE = 42;

/** The 25 save points, in slot order. */
export const SAVE_POINTS: readonly SavePoint[] = [
  { slot: 1, stage: 235, aliasStages: [], placeIndex: 43, place: "Asuka Inn", eventId: 1200, launchCode: 0xc01 },
  { slot: 2, stage: 430, aliasStages: [], placeIndex: 44, place: "Seiryu Tower", eventId: 1210, launchCode: 0xc02 },
  { slot: 3, stage: 470, aliasStages: [], placeIndex: 45, place: "Asuka Swamp Inn", eventId: 1215, launchCode: 0xc03 },
  { slot: 4, stage: 505, aliasStages: [], placeIndex: 46, place: "Suzaku Inn", eventId: 1220, launchCode: 0xc04 },
  { slot: 5, stage: 550, aliasStages: [], placeIndex: 47, place: "AS South Badland", eventId: 1225, launchCode: 0xc05 },
  { slot: 6, stage: 660, aliasStages: [], placeIndex: 48, place: "Byakko City", eventId: 1231, launchCode: 0xc06 },
  { slot: 7, stage: 730, aliasStages: [], placeIndex: 49, place: "AS Kulon Smith Shop", eventId: 1235, launchCode: 0xc07 },
  { slot: 8, stage: 750, aliasStages: [], placeIndex: 50, place: "Chamber Room", eventId: 1245, launchCode: 0xc08 },
  { slot: 9, stage: 760, aliasStages: [], placeIndex: 51, place: "Genbu City", eventId: 1240, launchCode: 0xc09 },
  { slot: 10, stage: 236, aliasStages: [{ stage: 928, eventId: 1612 }], placeIndex: 52, place: "Amaterasu Inn", eventId: 1201, launchCode: 0xc0a },
  { slot: 11, stage: 361, aliasStages: [{ stage: 946, eventId: 1648 }], placeIndex: 53, place: "Amaterasu Forest Inn", eventId: 1205, launchCode: 0xc0b },
  { slot: 12, stage: 431, aliasStages: [{ stage: 958, eventId: 1646 }], placeIndex: 54, place: "Qing Long Tower", eventId: 1211, launchCode: 0xc0c },
  { slot: 13, stage: 506, aliasStages: [], placeIndex: 55, place: "Zhu Que Inn", eventId: 1221, launchCode: 0xc0d },
  { slot: 14, stage: 551, aliasStages: [], placeIndex: 56, place: "AM South Badland", eventId: 1226, launchCode: 0xc0e },
  { slot: 15, stage: 661, aliasStages: [], placeIndex: 57, place: "Bai Hu City", eventId: 1230, launchCode: 0xc0f },
  { slot: 16, stage: 731, aliasStages: [], placeIndex: 58, place: "AM Kulon Smith Shop", eventId: 1236, launchCode: 0xc10 },
  { slot: 17, stage: 761, aliasStages: [], placeIndex: 59, place: "Xuan Wu City", eventId: 1241, launchCode: 0xc11 },
  { slot: 18, stage: 360, aliasStages: [], placeIndex: 60, place: "Asuka Forest Inn", eventId: 1457, launchCode: 0xc12 },
  { slot: 19, stage: 650, aliasStages: [], placeIndex: 61, place: "Asuka Mirage Hall", eventId: 1458, launchCode: 0xc13 },
  { slot: 20, stage: 560, aliasStages: [], placeIndex: 62, place: "Asuka Pelche Oasis", eventId: 1459, launchCode: 0xc14 },
  { slot: 21, stage: 700, aliasStages: [], placeIndex: 63, place: "Asuka Mountain Inn", eventId: 1460, launchCode: 0xc15 },
  { slot: 22, stage: 471, aliasStages: [], placeIndex: 64, place: "AM Swamp Inn", eventId: 1461, launchCode: 0xc16 },
  { slot: 23, stage: 651, aliasStages: [], placeIndex: 65, place: "AM Mirage Hall", eventId: 1462, launchCode: 0xc17 },
  { slot: 24, stage: 561, aliasStages: [], placeIndex: 66, place: "AM Pelche Oasis", eventId: 1463, launchCode: 0xc18 },
  { slot: 25, stage: 701, aliasStages: [], placeIndex: 67, place: "AM Mountain Inn", eventId: 1464, launchCode: 0xc19 },
];

const BY_STAGE = new Map<number, SavePoint>();
for (const p of SAVE_POINTS) {
  BY_STAGE.set(p.stage, p);
  for (const a of p.aliasStages) BY_STAGE.set(a.stage, p);
}

/** Parse `"s235"`, `235` or `"235"` to a stage number, or null. */
function stageNumber(map: number | string | null | undefined): number | null {
  if (typeof map === "number") return Number.isFinite(map) ? map : null;
  if (typeof map !== "string") return null;
  const m = /^s?(\d+)$/.exec(map.trim());
  return m ? Number(m[1]) : null;
}

/** The save point on a stage, or null when the map has none. */
export function savePointForStage(map: number | string | null | undefined): SavePoint | null {
  const n = stageNumber(map);
  return n == null ? null : BY_STAGE.get(n) ?? null;
}

const BY_SLOT = new Map<number, SavePoint>(SAVE_POINTS.map((p) => [p.slot, p]));

/** The save point with a given 1..25 slot, or null. */
export function savePointBySlot(slot: number): SavePoint | null {
  const s = Math.trunc(slot);
  return Number.isFinite(s) ? BY_SLOT.get(s) ?? null : null;
}

/** The launcher code (`0xC00 | slot`) a save point hands to the overlay host. */
export function savePointLaunchCode(slot: number): number {
  return 0xc00 | (Math.trunc(slot) & 0xff);
}

/** The `esshpnam` place index a slot's saved record shows, or null if out of range. */
export function savePointPlaceIndex(slot: number): number | null {
  const s = Math.trunc(slot);
  return s >= 1 && s <= SAVE_POINTS.length ? SAVE_POINT_PLACE_BASE + s : null;
}
