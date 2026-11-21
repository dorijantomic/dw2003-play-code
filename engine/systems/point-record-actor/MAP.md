# engine/systems/point-record-actor
The point-record actor machines ported from the stage overlays: one registry plus one module per "arm" (single, rise, grid, lanes, two-slot, triple, picture-steps, ride-walker, scroll-layer).
engine/systems/point-record-actor.ts is a re-export barrel; the browser wrapper that feeds it tables is web/effects/point-records.ts.

| file | lines | job | main exports |
|---|---|---|---|
| core.ts | 1351 | the registry and shared runtime: record writers, script/anim advance, fire/tick dispatch, child pools, pads | loadPointRecordActors, firePointRecordActor, advanceState, createPointActor, scriptOf |
| grid-lanes.ts | 359 | arms 4-7: single, rise, grid and lanes — shapes that light their own row/slot | tickSingle, tickRise, tickGrid, tickLanes |
| picture.ts | 228 | picture-steps: the only member claiming no record; draws stage picture ids near a character | firePictureSteps, tickPictureSteps, pictureStepDraws |
| ride-scroll.ts | 571 | the crevice ride walker (fall + bounce) and the s415 scroll-layer scenery | fireRideWalker, tickRideWalker, fireScrollLayer, scrollLayerDraws |
| sprites.ts | 180 | ambient point-sprite records: live/in-view gates and the whole-table tick | tickPointSpriteRecords, pointRecordLive, pointRecordInView, applyPointModeGates |
| stepper.ts | 141 | the claim walk that picks which record a member gets, plus the pad stepper | stepPointRecordCursor, claimRecord, padSlotEnded |
| triple.ts | 487 | the triple parent: state 0 builds a dozen child objects, state 2 pokes them; child machine | fireTriple, tickTriple |
| two-slot.ts | 214 | the only member that drives the live field character | fireTwoSlot, tickTwoSlot, charYOf, setCharY |
| types.ts | 874 | every point-actor interface plus the three shared constants | PointRecord, PointMember, POINT_RECORD_DELTA_CLAMP, POINT_RECORD_SCRIPT_END |

Where to look for:
- an effect that never fires / SETANIM never constructs it -> core.ts (firePointRecordActor, loadPointRecordActors)
- a member claims the wrong sprite -> stepper.ts (stepPointRecordCursor, claimRecord)
- field sprites not animating or not culling -> sprites.ts (tickPointSpriteRecords) then web/effects/draw.ts
- a shape's own per-frame machine (grid/lanes/single/rise) -> grid-lanes.ts
- ride/fall behaviour or the crevice scenery layer -> ride-scroll.ts
