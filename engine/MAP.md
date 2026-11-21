# engine/
Host-agnostic gameplay engine: core state/script/event primitives, converted DW3 data systems, PS1 hardware emulation. The browser loads it as one bundle (web/vendor/engine.js) built from engine/index.ts, which owns GameEngine and re-exports the systems.
Rows: folders under engine/, then every file directly in engine/systems/ (card-battle/ and point-record-actor/ have their own MAP.md).

| file | lines | job | main exports |
|---|---|---|---|
| core/ (folder) | 1 file + 6 dirs | host-agnostic primitives: state, flags, conditions, script VM, events, content, byte utils | GameState, ScriptVM, EventManager, FlagManager, Party |
| dw3/ (folder) | 103 files | DW3 gameplay data and logic: battle formulas, items, roster, encounters, scripted screens, dw3/ui | resolveDamage, ITEMS, rosterSlotOfCharId, scriptedScreenId |
| native/ (folder) | 10 files | PS1 hardware emulation: MIPS R3000, GTE, VRAM, GPU opcodes, originals | NativeStageRuntime, R3000, NativeMemory, installTranslationBridge |
| persistence/ (folder) | 2 files | save blob save/load/migrate and virtual memory-card resident storage | migrate, save, load, residentStorage |
| systems/ (folder) | 69 files | ported field/battle/card systems shared by browser and node tools (listed below) | BattleManager, createSpuVoicePool, startFishing |

## engine/ (direct files)

| file | lines | job | main exports |
|---|---|---|---|
| index.ts | 1912 | the production barrel: owns GameEngine and re-exports the systems, built into web/vendor/engine.js | GameEngine |
| native-entry.ts | 35 | research-only: PS1 interpreter and translation bridge, bundled separately to web/vendor/engine-native.js and loaded only by dynamic import | native runtime bootstrap |

## engine/systems/ (direct files)

| file | lines | job | main exports |
|---|---|---|---|
| ambush-tile.ts | 61 | forced-encounter tiles fourteen stages start from | ambushTileAt, AmbushTile |
| animation-controller.ts | 142 | shared field-sprite frame timing: dirs, walk, clips | clipFrame, clipDurationSeconds, timingForDir |
| auction.ts | 202 | Cargo Tower auction lot cycle and its answers | runAuctionLot, selectAuctionLot, auctionAnswerWrites |
| battle-manager.ts | 74 | generic turn loop: speed order, start tick, dispatch | createBattleManager, AttackResult, BattleManager |
| blast-presentation.ts | 905 | Blast digivolution transformation sequence, presentation manager | FormChangeProgram, entranceCameraSchedule, DV_TASK_START_FRAME |
| block-actor.ts | 257 | special block actors 328/351/352 and their interaction | BLOCK_CUE, BLOCK_ENGAGER_CLIP, BLOCK_TARGET_CLIP |
| box-actor.ts | 108 | item boxes (p126itmb): talk removes the box | BOX_TALK_CLIP, BOX_TALK_CUE, isBoxActorId |
| card-animation.ts | 870 | card duel sprite animation system | rsin, cardFanOut, DEAL_DURATION |
| card-battle.ts | 221 | split stub: re-exports card-battle/ folder | shuffle, summonCost, opposing |
| card-ceremony.ts | 814 | the duel's own ceremony opcode stream | FOLDER_CHOOSER_OPEN_TICKS, FOLDER_CHOOSER_CLOSE_TICKS, FOLDER_CHOOSER_STATES |
| card-effect-vm.ts | 1333 | Program card effect interpreter | actingSide, resolveVmChoice, startProgram |
| card-inspect.ts | 173 | in-duel inspect menu: Hand, Field, Trash, Surrender | ARE_YOU_SURE, FIELD_SECTIONS, FIELD_SECTION_SLOTS |
| card-opcode-families.ts | 178 | generated table mapping opcodes to handler families | OPCODE_FAMILY |
| card-view.ts | 1352 | card duel HUD panels, name plates, banners, markers | closePlate, openPrompt, slideBothPanelsIn |
| cast-list.ts | 159 | stage cast-list system: descriptor +0x4C actor list | castActorRecords, castPlayerId, castPlayerRecord |
| cutscene-manager.ts | 618 | wstag cutscene VM, run blocking opcodes | createCutscene, Cutscene, SPARKLE_ARM_PROGRAMS |
| dive-demo.ts | 312 | Digi-Egg dive transition demo presentation | diveDemoFrame, DEMO_CUE_FRAME, DEMO_PACK |
| dive-form.ts | 198 | Digi-Egg traversal forms Digmon/Submarimon rebuild | computeDiveNetwork, diveFormForStepOp, diveFormOnScreen |
| draw-context.ts | 361 | resident 2D draw-context service, registry 0x1002 | DrawQueue, effectiveRect, visibleInLayer |
| dungeon-switch.ts | 141 | Bug-Maze switch commands for North Sector dungeon | dungeonSwitchCommand, applyDungeonSwitchCommand, newPadSwitchObject |
| emote-sounds.ts | 110 | emote-sound dispatch for SETANIM 813 | emoteSound, EMOTE_SOUND_MAX, EMOTE_SOUND_MIN |
| equip-preview.ts | 106 | shop's per-Digimon effect cards view | computeEquipPreview, EquipPreview, EquipPreviewRow |
| falling-object.ts | 271 | stage overlay's rockfall actor | createFallingObject, fallingObjectDraws, fallingObjectSlot |
| field-balloon.ts | 134 | FIELDCOM balloon actor behind every little popup | balloonAnchorY, BALLOON_ANCHOR_LIFT, BALLOON_SET_0 |
| field-billboard-anchor.ts | 123 | where a field actor's sprite quad lands on screen | BILLBOARD_MIRROR_FACING_FROM, billboardBottomShift, fieldBillboardQuad |
| field-camera.ts | 94 | the one field camera rule over 320x240 | fieldCameraFollow, CAMERA_CENTRE_X, CAMERA_CENTRE_Y |
| field-character.ts | 183 | the live field character object the overlay names 5 | fieldCharAddY, fieldCharPendingPixels, fieldCharSetY |
| field-movement.ts | 330 | native field locomotion constants and follower history | FIELD_TICK_RATE, fieldDirectionFromIndex, fieldDirectionIndex |
| field-movie-player.ts | 187 | the field-reachable movie player object | FieldMoviePlayer, MOVIE_DISPLAY_RECT, MOVIE_INTERLACED_DISPLAY |
| field-shadow.ts | 121 | field character drop shadow geometry and gate | fieldShadowRect, fieldShadowVisible, FIELD_SHADOW_HEIGHT |
| fire-trap.ts | 206 | Fire Dungeon floor trap controller | fireTrapRegionAt, startFireTrap, fireTrapDurationTicks |
| fishing.ts | 571 | fishing bobber minigame once you own FishingPole | FISHING_BUDGET, CAST_SETTLE_TICKS, METER_MAX |
| frame-clock.ts | 216 | the frame clock every screen reads | DELTA_CELL, advanceFrameClock, FrameClock |
| ice-slide.ts | 178 | Ice Dungeon forced slide floors | beginIceSlide, stopIceSlide, tickIceSlide |
| input-map.ts | 392 | PlayStation pad abstraction for keyboard and joystick | PadButton, PAD_REPEAT, maskFromButtons |
| launch-pad.ts | 496 | Ice Dungeon teleport pads and s800's pair | startLaunch, nearestPad, advancePadScript |
| list-scrollbar.ts | 52 | the scroll bar every long list uses | listScrollbarThumb, ListScrollbarGeom, ListScrollbarThumb |
| location-card.ts | 337 | stage-entry location title card | createLocationCard, locationCardActive, locationCardFrame |
| map-manager.ts | 80 | map placement geometry: nearest actor, hit-test, facing | Facing, nearestFacingNpc, hitRect |
| native-event-families.ts | 154 | the one shared rule per native-event family | NATIVE_EVENT_FAMILIES, nativeEventDispositions, nativeEventFamily |
| native-vblank-clock.ts | 126 | vertical blanks stepping a shipped overlay, and delta | NativeVblankClock, MAX_CATCH_UP_BLANKS, PAL_BLANK_SECONDS |
| ordinal-scene-variant.ts | 158 | the hard-coded story-ordinal scene variant set | sceneBgmTrack, sceneVariantSlotActive, sceneVariantSlotIndex |
| packed-sound.ts | 183 | packed-sound call every screen plays through | PackedSoundCursor, PackedSoundService, packedSounds |
| pad-block.ts | 248 | controller-input service record bank every screen reads | PAD_BLOCK, PAD_REPEAT, PAD_PRESSED |
| party-orb.ts | 58 | the resident FIELDCOM type-0x16 party orb | partyOrbVisible, PARTY_ORB_SCREEN_CUT |
| phrase-notes.ts | 150 | one SPU voice per note-on for 2D phrases | SAMPLE_RATE, renderPhraseNote, PHRASE_NOTE_EXP_TAU |
| place-points.ts | 174 | the places system: stage exits re-aim by entry place | copyPlacePoints, aimPlacePoints, placePointPair |
| player-clip-packs.ts | 161 | player's clip to sprite-pack rule | playerPackForClip, PLAYER_CLIP_PACKS, PLAYER_CLIP_PACK_ARMS |
| point-record-actor.ts | 90 | split stub: re-exports point-record-actor/ folder | setPointRecordActorMusic, pictureStepDraws, setPointRecordActorSound |
| route-pair.ts | 210 | the two "which way did you come in" scalars | routePairCommit, routePairPredicate, publishesRoutePair |
| scene-arrival.ts | 188 | per-place gate objects deciding the starting scene | arrivalChain, arrivalChains, chooseArrivalEvent |
| scene-completion.ts | 277 | shared leaf every finished scene runs | applySetFlag, sceneCompletion, cardDuelCloseWrites |
| scene-step-ops.ts | 689 | the position step's other opcodes | handoffHold, execPlaybackOp, isStageChangePlayback |
| shape-annotator.ts | 661 | stage users of the draw-context two-pass annotators | ANNOTATOR_PORTED_MEMBERS, ANNOTATOR_SHAPE_SETS, annotatorDraws |
| shop-manager.ts | 59 | generic shop buy/sell logic, DW3-free | MONEY_CAP, createShopManager, ShopDeps |
| spu-voice-pool.ts | 360 | the original's one SPU voice allocator | SPU_NO_VOICE, SPU_VOICE_COUNT, createSpuVoicePool |
| stage-fixed-sprite.ts | 358 | stage overlays' two-layer still decoration player | createFixedSprite, fixedSpriteFor, playFixedSpriteBuildSound |
| stage-slot-ensemble.ts | 399 | display-slot ensembles writing a run of slots | configureEnsemble, createEnsemble, ensembleFor |
| stage-slot-player.ts | 269 | display-slot channel players into the 18-byte chain | SLOT_STRIDE, configureSlotPlayer, createSlotPlayer |
| step-actor-actions.ts | 396 | player actor movement-action slots for step tiles | SLOPE_STEP_CELLS, SLOPE_SLIDE_CELLS, actorActionPlan |
| stinger-popup.ts | 201 | corner stinger sprite for the Kusanagi announcement | clearStingerPopup, stingerPopupDraws, fireStingerPopup |
| story-command-banks.ts | 45 | command arms of get_flag/set_flag | storyCommand, flagConditionPasses, isStoryCommandBank |
| street-lights.ts | 333 | Kusanagi street traffic-light corner | streetGlowDraws, streetLightWrites, POLE_RECORD_TYPES |
| street-screens.ts | 305 | street wall/column screens and news tiles | streetScreenDraws, clearStreetScreens, fireStreetScreens |
| street-vehicles.ts | 405 | cars crossing the street during a broadcast | streetPropDraws, clearStreetVehicles, streetVehicleDraws |
| submarimon-motion.ts | 468 | Submarimon swimming on both axes, one throttle | submarimonLiftPixels, submarimonRollsEncounter, createSubmarimonMotion |
| talk-launch.ts | 138 | talk launcher (bank 0x90): conversation to scene | setTalkLaunchBindings, resolveTalkLaunchRecord, talkLaunchEventForBit |
| tree-kick.ts | 456 | TreeBoots tree-kicking hunt | treeKickHoldsInput, KICK_POSE_CLIP, KICK_POSE_SPRITE |
| trigger-system.ts | 590 | WS4 story-step OnStep position trigger engine | createTriggerSystem, StepEnableTable, StepGrid |

Where to look for:
- story flags, variables, conditions -> core/state/, core/condition/
- script VM and story commands -> core/script/, systems/story-command-banks.ts
- position triggers / story steps on the field -> systems/trigger-system.ts
- card duel rules and card effects -> systems/card-battle/ (see its own MAP.md)
- PS1 hardware emulation and stage machine -> native/ (runtime.ts, mips.ts)
