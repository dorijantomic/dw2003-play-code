# web/game

The field (overworld) half of the game: boot, input, map loading, the update/render loop,
story and quest cutscenes, fishing/tree, followers, multiplayer chat and screen openers.
Entry: web/game.ts (the page entry — index.html loads game.js) imports these modules; nothing
else outside this folder imports them.

| file | lines | job | main exports |
|---|---|---|---|
| auction-replay.ts | 143 | s260 Cargo Tower auction arrival script and the replay-theatre row feed | runAuctionArrival, replayRowsNow, replayFieldFree, auctionScriptRow |
| battle-launch.ts | 166 | field→battle handoff: shared wipe, random encounters, quest/MP battles, game over | startFieldBattle, gameOverToTitle, triggerRandomEncounter, presentVictory |
| draw-sprites.ts | 241 | field billboards: actor sprite draw with its anchor shift, drop shadow | drawEntitySprite, drawActorShadow, devSnapshot |
| engine-init.ts | 299 | builds the headless engine, its browser bridge and the OnStep trigger system | initEngine |
| field-fx.ts | 197 | field overlays: fieldcom tick, trigger bubble, fishing/radar/dive draws, anim debug | fieldcomTick, activeTriggerStep, drawFishing, drawTreeRadar |
| field-steps.ts | 439 | step-tile executors: playback, doors, ladders, slopes, launch pads, fire traps, ambush | flushStoryBattle, startPadHandoff, stepPlayback, startLadderClimb |
| fishing-tree.ts | 364 | fishing spots, cast and catch, tree kick, obstacle pushback, stuck-box checks | fishingSpotHere, boxStuck, startFishingCatch, startFishingCast, playerPackMeta |
| followers.ts | 152 | the trailing party: count and records, snap/gather, glossary and planner views | resetFollowers, activeFollowerCount, plannerPartyMembers, glossaryItems |
| init.ts | 1134 | boot: load data and assets, reset saves, wire screens and title, start game | init |
| input.ts | 855 | one press from keyboard or pad, routed to the open screen or the field | dispatchInput |
| map-load.ts | 857 | stage entry: map images, collision, sprites, exits, place points, story flags | setMap, applyStoryFlag, activeExitAt, loadAndSetMap |
| mp-chat.ts | 134 | multiplayer chat box, speech balloons, and the ordinary warp-to-spot helper | warpToMap, chatTick, mpCard, mpBalloonSay |
| quest-scenes.ts | 495 | hosts quest scene steps: cast, speak, chase ticks, fx reset, ui-open gates | sceneCast, playQuestScene, questSceneFxReset, questSpeak |
| render.ts | 1237 | one field frame: camera, map band, y-sorted actors, overlays, wipes | render |
| session.ts | 94 | session glue: field-location save, startGame, current map and character | currentMap, startGame, manifestIndexOf, saveFieldLocation |
| state.ts | 149 | per-frame/dev scratch state S plus the screen-router options used at init | S, screenRouterOptions |
| story-events.ts | 719 | story bytecode: apply a command, play talk/yes-no/handoff scenes, cutscene check | checkStageCutscene, doStoryHandoff, playStoryEvent, storyDbg |
| transitions.ts | 325 | stage change: step-setup ticks, checkerboard/wide wipes, handoff to new map | startTransition, stepSetupBucketTick, stepSetupTick, runStageHandoff |
| ui-openers.ts | 230 | opens shared screens: pack select, card folder, FLY, report, memory card, movies | openMemoryCard, openPackSelect, flyTo, openCardShopFolder |
| update.ts | 1451 | the frame loop: 60fps cap, ordered field sim, game-speed substep, then render | frame, padLoop, syncSubThrustSound |
| vars.ts | 1215 | shared field singletons: state, battle, canvas/ctx, boxes, books, audio, cams | state, battle, ctx, menu, sfx |
| types.ts | 155 | types only: the interfaces this folder's own code builds and fills in | — |

Where to look for:
- the field frame and draw order -> render.ts (render), sprites in draw-sprites.ts
- entering a map, exits, collision and story flags -> map-load.ts (setMap, activeExitAt)
- starting a battle or an encounter -> battle-launch.ts (triggerRandomEncounter, startFieldBattle)
- a cutscene/story event or a HANDOFF -> story-events.ts (playStoryEvent, doStoryHandoff)
- a press doing nothing / input routing -> input.ts (dispatchInput), then the open screen
