# web/effects
Per-frame stage objects and overlay effects: point-sprite records, street traffic and news screens, launch pads, overlay shapes.
web/effects.ts re-exports all of it and owns the pole-record hook.

| file | lines | job | main exports |
|---|---|---|---|
| draw.ts | 463 | one frame's stage-object pass: tick records, under-map then over-map sprite draws | drawEffects, drawSprite, bucketPass, drawEffectsUnderMap |
| launch-pads.ts | 136 | type-0x17 launch pads: idle script, per-frame tick, idle-disc + strobe draw | launchPads, drawLaunchPads, setLaunchPadsEnabled |
| point-records.ts | 549 | loads point sprites / stage objects / scroll layers, fires records, owns the sheet atlases | ensureSheet, ensureSemiSheet, screenAtlases, setPointRecordActorSound, loadPointSprites |
| state.ts | 12 | the module's shared object: loaded data, overlay+pad tables, ordinal and flag readers | S |
| street.ts | 257 | street traffic, broadcast/news screens and glows, stinger popups, overlay shapes | drawStreetScreens, drawStreetVehicles, drawStingerPopup, drawStageOverlayShapes, drawStreetGlows |

Where to look for:
- a stage sprite that animates on its own -> point-records.ts (record tables, fire*/set* helpers)
- cars, news/broadcast screens, stinger popups -> street.ts
- launch pads (bounce pads) -> launch-pads.ts
- whether a sprite draws behind or over the map -> draw.ts (bucketPass, UNDER_MAP_BUCKET)
- sprite drawn with the wrong colours / invisible -> point-records.ts (ensureSheet, ensureSemiSheet)
