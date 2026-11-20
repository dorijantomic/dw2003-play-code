import { dvLevelForExp } from "./battle.js";
import { drawIconGlyph } from "./uifont.js";
import { ITEM_CATS, ITEM_CAT_ACTIONS, ITEM_CAT_EMPTY } from "./menu/pure.js";
import { MS } from "./menu/state.js";
// moved by tools/rewrite/split.mjs: still exported from here
export {
  CARD_FOLDER_FADE_FRAMES,
  CARD_STAT_LABELS,
  EQUIP_SCROLLBAR,
  MAP_HOLD_FRAMES,
  SHEET_CLUT_DOWN,
  SHEET_CLUT_UP,
  SORT_HEADERS,
  bagCursorStep,
  equipScrollbarThumb,
  mapHoldSpeed,
  mapPs1Id,
  mapSeenFlag,
  mapUnavailable,
  migrateVisitedMaps,
  pauseMapContext,
  portraitSequenceFor,
  sheetDeltaClut,
  visitedPs1Stages,
} from "./menu/pure.js";
export { equipPickOptions, seeDigivolvePanelRes, seeDigivolvePanelStat, wieldNameFor } from "./menu/logic.js";
export { createMenu } from "./menu/create.js";
export {
  SHEET_CLUT_MARKED,
  SHEET_VALUE_KIND,
  sheetPreviewFace,
  sortSwapBracket,
} from "./menu/draw-common.js";
// Pad service repeat curve: edge, then 16, then 6, then every 4. Defined once
// in the engine (engine/systems/input-map.ts) and re-exported here because the
// pause menu and its tests import it from this module.
// docs/research/ui/pad-input-service-behaviour-2026-08-21.md
export { PAD_REPEAT, padRepeatFires } from "./vendor/engine.js";

export { ITEM_CATS, ITEM_CAT_EMPTY, ITEM_CAT_ACTIONS };

fetch("assets/data/status_ui.json").then((r) => r.json()).then((j) => { MS.UI = j; }).catch(() => {});

