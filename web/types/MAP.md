# web/types/
TypeScript declarations only: nothing here is emitted, node's strip mode erases the whole file,
so a broken import in this folder can never change the game. One file per module, named after the
module the declarations came from (tools/rewrite/type-names.json), split out of web/types.ts by
tools/rewrite/split-types.mjs.

| file | types | job |
|---|---|---|
| ambience.ts | 4 | types of web/ambience.ts |
| anim-viewer-camera.ts | 1 | types of web/anim-viewer-camera.ts |
| anim-viewer-dw2.ts | 1 | types of web/anim-viewer-dw2.ts |
| anim-viewer-dw2motion.ts | 2 | types of web/anim-viewer-dw2motion.ts |
| arena-built.ts | 1 | types of web/arena-built.ts |
| arena-viewer-tools.ts | 2 | types of web/arena-viewer-tools.ts |
| audio.ts | 2 | types of web/audio.ts |
| battle-menu-adapter.ts | 1 | types of web/battle-menu-adapter.ts |
| battle.ts | 1 | types of web/battle.ts |
| battle3d.ts | 1 | types of web/battle3d.ts |
| canvas-bench.ts | 3 | types of web/canvas-bench.ts |
| cardalbum-translated.ts | 1 | types of web/cardalbum-translated.ts |
| carddeck-translated.ts | 1 | types of web/carddeck-translated.ts |
| cardduel-native.ts | 1 | types of web/cardduel-native.ts |
| cardshop-translated.ts | 1 | types of web/cardshop-translated.ts |
| choice.ts | 1 | types of web/choice.ts |
| codex-data.ts | 1 | types of web/codex-data.ts |
| damage-lab.ts | 1 | types of web/damage-lab.ts |
| debugPanel.ts | 1 | types of web/debugPanel.ts |
| devtools-bosslist.ts | 1 | types of web/devtools-bosslist.ts |
| devtools.ts | 1 | types of web/devtools.ts |
| dialogue-translated.ts | 1 | types of web/dialogue-translated.ts |
| dri-native.ts | 1 | types of web/dri-native.ts |
| editor.ts | 1 | types of web/editor.ts |
| endscreen-translated.ts | 1 | types of web/endscreen-translated.ts |
| fightreport-translated.ts | 1 | types of web/fightreport-translated.ts |
| fusion-lab.ts | 3 | types of web/fusion-lab.ts |
| glossary-digimon.ts | 1 | types of web/glossary-digimon.ts |
| gym-translated.ts | 1 | types of web/gym-translated.ts |
| help-menu-translated.ts | 1 | types of web/help-menu-translated.ts |
| inn-translated.ts | 1 | types of web/inn-translated.ts |
| lab-translated.ts | 1 | types of web/lab-translated.ts |
| mp-league.ts | 1 | types of web/mp-league.ts |
| mpbattle-rules.ts | 4 | types of web/mpbattle-rules.ts |
| multiplayer.ts | 1 | types of web/multiplayer.ts |
| nameentry-translated.ts | 1 | types of web/nameentry-translated.ts |
| native-screen-host.ts | 1 | types of web/native-screen-host.ts |
| native-screen-render.ts | 1 | types of web/native-screen-render.ts |
| native-screen.ts | 1 | types of web/native-screen.ts |
| options-model.ts | 1 | types of web/options-model.ts |
| packselect-translated.ts | 1 | types of web/packselect-translated.ts |
| perf-test.ts | 7 | types of web/perf-test.ts |
| placecard-translated.ts | 1 | types of web/placecard-translated.ts |
| placecard.ts | 1 | types of web/placecard.ts |
| quartermaster.ts | 1 | types of web/quartermaster.ts |
| quest-props.ts | 1 | types of web/quest-props.ts |
| quest-scenes.ts | 11 | types of web/quest-scenes.ts |
| redirect-view.ts | 1 | types of web/redirect-view.ts |
| save-translated.ts | 2 | types of web/save-translated.ts |
| screens.ts | 43 | shared shapes of the book and screen modules: web/glossary-items.ts, web/glossary-stage.ts, web/glossary-book.ts, web/glossary-fallback.ts, web/book-host.ts, web/cntysel-native.ts |
| save.ts | 1 | types of web/save.ts |
| scene-dryrun.ts | 1 | types of web/scene-dryrun.ts |
| sceneEditor.ts | 1 | types of web/sceneEditor.ts |
| sceneSkip.ts | 1 | types of web/sceneSkip.ts |
| shop-translated.ts | 1 | types of web/shop-translated.ts |
| shop.ts | 1 | types of web/shop.ts |
| soundtest.ts | 1 | types of web/soundtest.ts |
| stage-locality.ts | 2 | types of web/stage-locality.ts |
| stagslct.ts | 1 | types of web/stagslct.ts |
| status-translated.ts | 1 | types of web/status-translated.ts |
| story-explorer.ts | 1 | types of web/story-explorer.ts |
| tech-record.ts | 1 | types of web/tech-record.ts |
| textbox.ts | 1 | types of web/textbox.ts |
| wfight-translated.ts | 1 | types of web/wfight-translated.ts |
| yesno-translated.ts | 1 | types of web/yesno-translated.ts |
| anim-viewer-bake.ts | 2 | types added after the split — see the file's own header |
| anim-viewer-compare.ts | 2 | types added after the split — see the file's own header |
| anim-viewer-data.ts | 2 | types added after the split — see the file's own header |
| anim-viewer-generic.ts | 2 | types added after the split — see the file's own header |
| anime4k-lab.ts | 1 | types added after the split — see the file's own header |
| arena-placer.ts | 4 | types added after the split — see the file's own header |
| battlecmd-translated.ts | 1 | types added after the split — see the file's own header |
| battledna-translated.ts | 2 | types added after the split — see the file's own header |
| battlefields.ts | 10 | types added after the split — see the file's own header |
| battleform-translated.ts | 2 | types added after the split — see the file's own header |
| battlehud-translated.ts | 2 | types added after the split — see the file's own header |
| battleitem-translated.ts | 1 | types added after the split — see the file's own header |
| battlemsg-translated.ts | 1 | types added after the split — see the file's own header |
| battletag-translated.ts | 3 | types added after the split — see the file's own header |
| battletech-translated.ts | 2 | types added after the split — see the file's own header |
| blast-ladder.ts | 2 | types added after the split — see the file's own header |
| canvas-resolution.ts | 1 | types added after the split — see the file's own header |
| chat-queue.ts | 2 | types added after the split — see the file's own header |
| chat.ts | 1 | types added after the split — see the file's own header |
| cinema.ts | 1 | types added after the split — see the file's own header |
| mpsocial.ts | 4 | types added after the split — see the file's own header |
| quest-editor.ts | 9 | types added after the split — see the file's own header |
| quest-endings.ts | 1 | types added after the split — see the file's own header |
| quest-offers.ts | 1 | types added after the split — see the file's own header |
| quest-readback.ts | 1 | types added after the split — see the file's own header |
| quest-shelf.ts | 1 | types added after the split — see the file's own header |
| quest-triggers.ts | 2 | types added after the split — see the file's own header |
| replay-theatre.ts | 1 | types added after the split — see the file's own header |
| silence-report.ts | 1 | types added after the split — see the file's own header |
| systems.ts | 1 | types added after the split — see the file's own header |
| translated-screen-host.ts | 1 | types added after the split — see the file's own header |
| u-scene.ts | 0 | types added after the split — see the file's own header |
| ui-kit.ts | 1 | types added after the split — see the file's own header |
| uifont.ts | 2 | types added after the split — see the file's own header |
| battle-core.ts | 2 | shapes of the battle core files (web/battle/core/*.ts, web/party.ts): DigimonTable, WalkerSentencePlan |
| fishing-underwater.ts | 9 | the three.js objects web/fishing-underwater.ts builds: UwPlaced, UwMesh, UwGroup, UwCamera, UwSun, UwRenderer |
| fx3d.ts | 34 | the field effects (web/effects/*) and the 3D battle renderer (web/battle3d/*): PointSpriteLayer, PointStageData, ActorPositionPatch |
| game-shared.ts | 1 | shared by web/game/*, web/menu/*: ReadyScreenPack |
| game-shared2.ts | 1 | shared by web/game/*: WithAnyKey (the textbox Proxy in web/game/vars.ts) |
| map-tiles.ts | 6 | web/map-tiles.ts: TiledMapInfo, TileIndex, TileIndexState, MapTileEntry, MapTileJob, MapTileEnv |
| misc-game.ts | 42 | web/evolution-planner.ts, web/dri-model.ts, web/fxaudio.ts, web/dev-panel.ts: EvolutionRecord, EvoPlannerTable, EvoProfile |
| misc-game2.ts | 37 | web/fieldcom.ts, web/gpu-pixel-filter.ts, web/screenpack.ts, web/water3d.ts, web/grass3d.ts, web/fishing-extras.ts, web/treesway.ts, web/extra-roster.ts, web/quest-ghost.ts, web/species-log.ts: FieldcomManifest, ScreenPack |
| mount.ts | 16 | web/mount.ts: MountSpot, MountDef, MountHost, the rider's place |
| mp-match.ts | 33 | the many-vs-many fight (web/mpbattle-rules.ts, web/mpbattle/*.ts): MpCommand, MpSeat, MpField, MpKit |
| quest-fx.ts | 18 | web/quest-fx.ts: QuestFxLayer, QuestFxClip, QuestFxSheetDef, QuestFxSheet |
| quest-lab.ts | 6 | web/quest-lab.ts: QuestLabRecord, QuestLabGiver, QuestLabObjective, QuestLabDef |
| quest-walk.ts | 4 | web/quest-walk.ts: QuestWalkPoint, QuestGridSource, QuestRouteResult, QuestStandInPost |
| rest-a.ts | 40 | the "rest A" group, the small leaf modules of web/*.ts: PauseBookSwitches, PanelFrame, PanelFrames |
| rest-b.ts | 11 | the "rest-b" group (web/map-screen-model.ts, web/newmaps.ts, ...): NewMapExit, NewMapFile, AmbienceBag, ExtraPartnerRecord |
| rest-c.ts | 11 | the "rest-c" group (web/native-stage.ts, web/scenery3.ts, web/gpu-pixel-filter.ts, ...): NativeExeTables, NativeStageCurrent, Scenery3Scene |
| scenery.ts | 28 | web/scenery.ts and web/scenery2.ts read the scene object web/ambience.ts hands them: SceneryScene, SceneryProfile, SceneryFx |
| scenery2.ts | 20 | the particles, lamps and state web/scenery2.ts keeps: LampLayer, StageLightRecord, GameLamp |
| translated-screens.ts | 7 | shared by the translated screens (the web files named -translated): PackedSfx, ResidentGlyphs, BattleMenuData |

Where to look for:
- the shape of an object a module builds and fills in -> that module's file here
- who imports a type -> `grep -rn "types/<module>.js" web/`
