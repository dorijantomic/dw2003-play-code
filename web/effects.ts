import { UNDER_MAP_BUCKET } from "./draw-order.js";
import { setStageObjectPoleRecords } from "./stage-objects.js";
import { S } from "./effects/state.js";
// moved by tools/rewrite/split.mjs: still exported from here
export {
  clearPointRecordStageObjects,
  clearPointSlots,
  constructPointRecordStageObjects,
  drawScrollLayers,
  firePointRecordStageObject,
  loadPointSprites,
  padRunSound,
  pictureStepDraws,
  pointRecordActors,
  pointRecordProbe,
  pointSpriteProbe,
  pointSpriteRecords,
  preloadPointSpriteStage,
  retainPointSpriteStages,
  scrollLayerEntries,
  setPointRecordActorMusic,
  setPointRecordActorSound,
  setPointRecordAnchor,
  setPointRecordFlag,
  setPointRecordOrdinal,
  setPointSlot,
  setPointSprite,
  tickPointRecordStageObjects,
} from "./effects/point-records.js";
export {
  bucketPass,
  drawEffects,
  drawEffectsUnderMap,
  drawFireTrapBursts,
  drawNativeIntents,
  drawStageObjectSprites,
} from "./effects/draw.js";
export {
  drawAnnotatorShapes,
  drawStageOverlayShapes,
  drawStingerPopup,
  drawStreetGlows,
  drawStreetScreens,
  drawStreetVehicles,
  stageOverlayShapeProbe,
  stingerPopupProbe,
  streetGlowProbe,
  streetScreenProbe,
  streetVehicleProbe,
} from "./effects/street.js";
export {
  PAD_STROBE_DY,
  drawLaunchPads,
  launchPadDebug,
  launchPads,
  setLaunchPadsEnabled,
} from "./effects/launch-pads.js";
// The traffic-light writer reads two bytes of each record: byte+1 is the pole
// type and byte+2 ends its walk when it is zero. The extractor carries byte+1 as
// `atlasFlag` and byte+2 as the record's texture `size`, so those are the names
// the engine gets. Registered once, here, because this module owns the table.
setStageObjectPoleRecords((stageId: string | number) => {
    const s = S.data?.[stageId];
    if (!s) return null;
    return s.records.map((r) => ({ type: r.atlasFlag, size: r.size }));
});
// The ordering-table bucket at or above which a record draws BEHIND the ground
// map-tile layer, which the field submits at bucket 7. Records at or above this
// belong in the under-map pass; everything below it draws over the map. Defined
// once, in the ordering-rule module, and re-exported here for the callers that
// import it from this file.
export { UNDER_MAP_BUCKET };

