// web/portraits.js — which of the game's turning Digimon figures a starter shows.
//
// The one picture table now lives in the engine, in the overlay's own row order,
// next to the one loop that walks it (engine/dw3/ui/digimon-picture.ts, the port
// of the twelve instructions at pro/ststatus.s:10081-10089). This file is the
// walker's own id lookup into it: web/party.js's CHARID_TO_DIGID starter id (1
// Kotemon, 2 Kumamon, 3 Monmon, 4 Agumon, 5 Veemon, 6 Guilmon, 7 Renamon,
// 8 Patamon) to the row that row of the table holds.
//
// Before this, the map lived here and contradicted both the table it indexed and
// the pause screen: it named row 2 Kotemon and row 0 Monmon, so a Kotemon and a
// Monmon each drew the other's figure. The names come from
// tools/extract_status_ui.py's NATIVE_PORTRAIT_ORDER, which is what
// web/assets/data/status_ui.json already ships and what the pause screen draws, so
// every path now agrees. Evolutions (Dinohumon, …) have no row here and answer
// undefined, so callers fall back to their own tables.
//
// What a row index MEANS in the original — settled 2026-10-03, ledger claim
// `digimon-picture-row-is-the-roster-slot-2026-10-03`. The row IS the roster slot
// (0 Kotemon, 1 Kumamon, 2 Monmon, 3 Agumon, 4 Veemon, 5 Guilmon, 6 Renamon,
// 7 Patamon), which is this file's digimon id minus one, so the map below is the
// original's answer and not a guess:
//   * the pause screen and the fight report ask `[0x80048D34]+0x2718`
//     (F0x80016D94) for the roster slot at a party position and put the return
//     value straight into the row stride (pro/ststatus.s:10074-10077);
//   * the Digimon Lab asks `[0x80048D34]+0x2728` (F0x80016FD8), which re-derives
//     the same slot from the record's +0x760 word minus three
//     (pro/stgdglab.s:8318-8324);
//   * the memory card asks the save record's starter byte minus three
//     (pro/stgmcard.s:882-893) — the same 0..7 ordinal.
import { ui } from "./vendor/engine.js";

const { DIGIMON_PICTURE_TABLE, STARTER_PICTURE_ROW, digimonPictureClip } = ui;

export { STARTER_PICTURE_ROW, DIGIMON_PICTURE_TABLE };

/** Correct portrait animation row for a base starter, or undefined for
 *  non-starters (evolutions, enemies) so callers can fall back. */
export function starterPortraitRow(digimonId) {
  return STARTER_PICTURE_ROW[digimonId];
}

/** Correct picture for a base starter at `frame`, wrapping inside its row, or
 *  null for non-starters and for a row the table does not hold. */
export function starterPortraitClip(digimonId, frame = 0) {
  const rowIdx = STARTER_PICTURE_ROW[digimonId];
  if (rowIdx == null) return null;
  const clip = digimonPictureClip(rowIdx, frame);
  return clip >= 0 ? clip : null;
}