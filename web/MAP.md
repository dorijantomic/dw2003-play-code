# web/

The browser game: one module per feature, loaded as ES modules; `web/index.html` boots `game.js` (built from `game.ts`).
Large files were split into folders (rows ending in "/ (folder)", each with its own MAP.md); each entry file (`battle.ts`, `battle3d.ts`, `game.ts`, `effects.ts`, `audio.ts`, `menu.ts`, `mpbattle.ts`) stays and re-exports its folder.

| file | lines | job | main exports |
|---|---|---|---|
| ambience.ts | 1185 | weather overlays: rain, snow, leaves, fireflies; effects toggles | isOpenAirMapName, fx, ambienceSilence |
| anim-viewer-bake.ts | 207 | DW3 body plus DW2 motion bake file paths | MODEL_ANIM, MODEL_TEXTURE, BAKE_ROOT |
| anim-viewer-camera.ts | 454 | free camera for the animation viewer: orbit, fly | createFreeCamera, DEG, PITCH_LIMIT |
| anim-viewer-compare.ts | 239 | DW2 clip beside DW3 retarget, displacement table | ROLE_ORDER, ROLE_LABELS, toCharacter |
| anim-viewer-data.ts | 265 | pure model/clip pickers, search, canonical names | canonicalName, buildModelIndex, matchesQuery |
| anim-viewer-dw2.ts | 637 | DW2 glTF models: load, skin, animate in viewer | composeTRS, mat4Mul, parseGltf |
| anim-viewer-dw2motion.ts | 565 | per-species DW2 motion file table and urls | tableFor, DW2_ROOT, dw2FileUrl |
| anim-viewer-generic-stub.ts | 52 | placeholder generic-motion generator so the viewer builds | GENERIC_MOTIONS, listGenericMotions, bakeGenericMotion |
| anim-viewer-generic.ts | 330 | generic motion tester: ratings, verdicts, deep links | VERDICTS, VERDICT_MARK, RATING_KEY |
| anime4k-lab.ts | 115 | Anime4K WebGPU upscale, sprite-filter-lab only | anime4kReady, anime4k |
| arena-add-picker.ts | 149 | Add object popup: a card per registry asset | buildAssetGroup, createAddPicker |
| arena-built.ts | 185 | built-look arena: three.js pieces placed from recipe | leafClumpTexture, foliageMaterial, buildGeometry |
| arena-placer.ts | 449 | place and save objects anywhere in a built arena | pathOf, findByPath, createPlacer |
| arena-slots-ui.ts | 94 | Slots panel and asset-gallery replace popup | createSlotsUI |
| arena-viewer-tools.ts | 365 | arena viewer free camera, shore tuner, tools | createFreeCam, createTuner, shoreUniformNames |
| arrival-lab.ts | 121 | arrival dialogue lab: beats, ordinal lines, candidates | isOrdinalLeaf, beatOf, candidateLines |
| audio/ (folder) | 4 | folder — bgm playback, exclusive register, play/stop, volume | — |
| audio.ts | 233 | entry: sfx and bgm players, re-exports audio/ | createExclusiveRegister, createSfxPlayer, createBgmPlayer |
| battle/ (folder) | 12 | folder — battle split: layout, hud, messages, hits, plans, status | — |
| battle-layer.ts | 91 | battle 3D on its own canvas under the game | noteBackdropBlend, releaseBattleLayer, setFlatReader |
| battle-menu-adapter.ts | 260 | shared scaffold running the six translated battle menus | createBattleMenuAdapter, battleMenuLanguage, BATTLE_QUEUE_LIMIT |
| battle-speed.ts | 49 | battle speed x1..x3 and the one scaled delta | battleDelta, battleSpeedOn, SPEEDS |
| battle-voice-gate.ts | 18 | one-voice-per-side gate for battle op10 sounds | battleVoiceGate |
| battle.ts | 846 | entry: turn-based battle engine, re-exports battle/ | createBattle, MSG, MSG_KIND |
| battle3d/ (folder) | 9 | folder — renderer split: gl, shaders, skeleton, rotation, cameras | — |
| battle3d.ts | 1503 | entry: WebGL skeletal fight renderer, re-exports battle3d/ | createBattle3D, resolveModelFolder, MODEL_SCALE |
| battlecmd-translated.ts | 130 | browser adapter: battle command list (Fight/Tech/DV) | battleAilmentByte, createBattleCommandTranslated |
| battledna-translated.ts | 226 | browser adapter: in-battle DNA screen | createBattleDnaTranslated |
| battlefields.ts | 270 | battlefields table: stage, field, changing technique | ORDINARY_ARENA_LABEL, stageRows, noFightRows |
| battleform-translated.ts | 141 | browser adapter: in-battle Digivolve form list | createBattleFormTranslated |
| battlehud-translated.ts | 469 | browser adapter: HP plate, party pips, names | battleHudPartyPips, battleHudEnemyRecords, battleHudPlayerRecords |
| battleitem-translated.ts | 100 | browser adapter: in-battle ITEM list | createBattleItemTranslated |
| battlemsg-translated.ts | 239 | browser adapter: battle message line | battleMsgText, battleMsgBank, battleMsgPaint |
| battletag-translated.ts | 125 | browser adapter: in-battle TAG partner list | createBattleTagTranslated |
| battletech-translated.ts | 87 | browser adapter: in-battle TECH list | createBattleTechTranslated |
| biome/ (folder) | 16 | folder — arena biome sets: forest, beach, lake, mountain, gallery | — |
| bit-ledger-page.ts | 92 | page half of BIT Ledger, draws shipped tables | — (page only) |
| bit-ledger.ts | 160 | economy in disc numbers: wallet cap, payouts | MONEY_CAP, payoutStats, grants |
| blast-ladder.ts | 390 | one card per starter: five Blast forms | blastOpen, openBlastLadder, tickBlastLadder |
| blast-presentation.ts | 120 | form-change curtain and flash, no sprites | digivolveDemoOn, drawBlastCurtain, drawBlastFlash |
| book-blank.ts | 19 | empty book screen: wall, header plate, window | createBlankBook |
| book-host.ts | 106 | runs one book screen over the pause menu | WORD, createBookHost, RELEASE_WAIT_FRAMES |
| boss-phase.ts | 111 | fusion boss second wind: phase, AI rows | phaseFor, phaseRows, phaseEffects |
| built/ (folder) | 21 | folder — built-arena pieces and the asset registry | — |
| canvas-bench.ts | 329 | dev Canvas2D benchmark posting to perf receiver | — (page only) |
| canvas-resolution.ts | 185 | high-density canvas backing, logical coordinates unchanged | canvasEventToLogical, createCanvasResolutionController, fitNativeScreen |
| cardalbum-translated.ts | 136 | browser adapter: Card Album screen | createCardAlbumTranslated |
| carddeck-translated.ts | 174 | browser adapter: Card Folder editor | createCardDeckTranslated |
| cardduel-lab.ts | 521 | complete card duel written for the UI lab | — (page only) |
| cardduel-native.ts | 186 | card duel as a production native screen | createCardDuelNative |
| cardduel-net.ts | 511 | host-authoritative two-human card duel rules | DUEL_RULES, snapshot, createDuelHost |
| cardshop-translated.ts | 115 | browser adapter: card shop inventory | bindCardShopInventory, createCardShopTranslated |
| cardstate.ts | 363 | shared card-battle state, collection persistence | cards, persistCollection, FOLDER_SIZE |
| charisma.ts | 97 | party Charisma total, flag bank 0x72 | CHARID_TO_DIGID, partyCharisma, loadCharismaDb |
| chat-queue.ts | 53 | queue for type-to-chat lines | createChatQueue |
| chat.ts | 97 | type-to-chat through the game's own balloon | installChat, buildChatPack, chatOpen |
| choice.ts | 122 | canvas choice-menu widget in screen space | createChoice, CHOICE_BOX, choiceScene |
| cinema.ts | 80 | the disc's five movie streams as rows | rowFor, cinemaRows, MOVIE_LAUNCH_FAMILY |
| cntysel-native.ts | 169 | language select screen composed from native ports | createCntyselNative, CNTYSEL_ROOT_CB, LANGUAGE_GLOBAL |
| codex-data.ts | 424 | pure row builders of the retired Codex screen | dropOdds, partnerRows, wildRows |
| crowd.ts | 103 | ambient villagers strolling the city and towns | removeVillagers, syncVillagers, villagersActive |
| cursor-almanac.ts | 124 | every menu cursor at the disc's own rate | GLYPH_TABLE, pauseCycle, CURSORS |
| cut-content.ts | 267 | read-only gallery of what the disc never shows | cutContentOpen, openCutContent, tickCutContent |
| cutscene-actors.ts | 17 | record for cutscene-spawned ephemeral actors | ephemeralActorRecord |
| damage-lab.ts | 732 | the disc's damage pipeline, stage by stage | resolveDamage, magicalBase, physicalBase |
| debugPanel.ts | 237 | in-game partner debug editor behind the backquote key | createDebugPanel, grantFishingPole, grantTreeBoots |
| detail-presets.ts | 4 | generated Detail keys that Low and Medium switch off | DETAIL_OFF_LOW, DETAIL_OFF_MEDIUM |
| dev-panel-model.ts | 190 | what F2 shows for each of the 100 FX switches | DEV_OPEN, DEV_TABS, DEV_FILTERS |
| dev-panel.ts | 195 | the F2 page: seven tabs, rows, search, filter | DEV_PANEL_CSS, createDevView |
| devtools-bosslist.ts | 144 | Bosses and tamers list, devtools Battles pane | esdmgStagesNeeded, buildBossList, filterBossList |
| devtools.ts | 635 | dev toolset page driving the real game in an iframe | — (page only) |
| dialogue-pack.ts | 117 | one-line text pack in the disc's dialogue format | paginate, buildPack, encodeChar |
| dialogue-translated.ts | 193 | browser adapter: field conversation box and balloon | createDialogueTranslated |
| dive-demo.ts | 90 | Digi-Egg dive transition renderer | loadDiveDemo, diveDemoReady, drawDiveDemoCells |
| draw-order.ts | 147 | one y-sorted ordering rule for field drawables | pushComposite, ENTITY_BUCKET, UNDER_MAP_BUCKET |
| dri-model.ts | 360 | pure DRI menu model: slots, stats, mutations | ensureFormLedger, formLedgerRecord, driStatsAt |
| dri-native.ts | 362 | Digimon Lab as a production native screen | slotStats, ownedSlots, createDriNative |
| dri.ts | 15 | the DRI desk's save write | persistDriState |
| drop-item.ts | 23 | map enemy drop names to engine item names | itemForDropName |
| editor.ts | 63 | map editor: grid, painting, blocked cells | createEditor |
| effects/ (folder) | 5 | folder — effect drawing, launch pads, point records, street | — |
| effects.ts | 73 | entry: battle effect drawing, re-exports effects/ | drawEffects, launchPads, pictureStepDraws |
| encounter-dial.ts | 42 | encounter dial modes: which allow a fight | dialModeFromFx, DIAL_MODES, dialAllowsFight |
| endscreen-translated.ts | 223 | browser adapter: translated END card | loadEndCardTranslated, createEndCardTranslated |
| enemy-stats.ts | 7 | the one rule for a wild enemy's five stats | scaleEnemyStat |
| enemy-switch.ts | 89 | the enemy's own tag: pure enemy-turn rules | enemyTeamSlots, ENTRANCE_TASK_END_FRAME, enemySwitchTarget |
| enemy-tells.ts | 76 | every-Nth countdown and the pattern breaker | nearestTell, tellText, everyNthRows |
| engine-bridge.ts | 205 | presentation driver: renders the headless engine's decisions | createEngineBridge |
| evolution-planner.ts | 562 | forms a partner can still learn, and their blockers | plannerOpen, tickPlanner, plannerPress |
| extra_fx/ (folder) | 24 | folder — art: extra effect sprite sheets and data | — |
| extra_partners/ (folder) | 3 | folder — art: extra partner sprites | — |
| extra_sprites/ (folder) | 7 | folder — art: extra character sprite sets | — |
| extra-roster.ts | 172 | enemy-only Digimon made obtainable as player forms | mergeDigimon, mergeEvolutions, NEW_PARTNERS_ENABLED |
| field-movie.ts | 161 | field-reachable movie, story ordinal 43 | createFieldMoviePlayer, movieRecordFor |
| field-view.ts | 109 | HD Remaster wide overworld view sizing | FIELD_VIEW_W, FIELD_VIEW_PAD, setFieldViewPad |
| field-war.ts | 74 | elemental field war: which element follows which | FIELD_POWER, FIELD_CYCLE, fieldName |
| fieldcom.ts | 341 | FIELDCOM field-UI icons from the disc's textures | drawFieldcomIcon, fieldcomReady, drawIndicatorBubble |
| fight/ (folder) | 37 | folder — action VM, anim retarget, cameras, effects, motion | — |
| fightreport-translated.ts | 288 | browser adapter: post-fight results screen | createFightReportTranslated |
| fishing-almanac.ts | 144 | the 46 fishing stages as one read-only table | castsLeft, almanac, cardmonStages |
| fishing-extras.ts | 138 | rare extra rewards on top of a fishing win | rollExtra, messageFor, createFishFinds |
| fishing-underwater-state.ts | 122 | pure half of the underwater fishing view | phaseFor, progressFor, sizeFor |
| fishing-underwater.ts | 491 | 3D underwater view while the line is in | UW_W, UW_H, renderUnderwater |
| flag-store.test.ts | 169 | node:test for the banked-flag gating adapter | — (tests) |
| flag-store.ts | 207 | banked-flag gating adapter: tri-state get_flag | createFlagStore |
| fly-book.ts | 33 | FLY book screen: visited fly points list | createFlyBook |
| fly-points.ts | 181 | places the partner can fly you to | FLY_QUEST, FLY_ROW_LABEL, flyCopyFor |
| form-tech-slots.ts | 137 | a form's technique slots and learn/load gates | applyFormTechGates, learnOneTechnique, markOneLoadable |
| fullscreen.ts | 50 | browser-fullscreen toggle for title and F key | toggleGameFullscreen, restoreWindowFill, cycleGameScreen |
| fusion-forms.ts | 120 | the ten DNA bodies: records and playability | fusionForms, fusionFaults, CLIP_NAMES |
| fusion-lab.ts | 368 | dev Fusion Lab page talking to the local fuse server | — (page only) |
| fusion-loot.ts | 112 | a fusion carries the loot of both halves | rollFusionDrops, fusionDrops, dropChanceText |
| fusion.ts | 284 | fusion-boss rules: two species blended into one | fusionEnabled, fusedRecord, partyEntriesFor |
| fxaudio.ts | 203 | synthesised weather and ambience sound, no files | setWeatherVolume, setSound, thunder |
| game/ (folder) | 21 | folder — field loop split: update, render, map-load, story, vars | — |
| game.ts | 1340 | entry: the field game loop and wiring, loads game/ | — (side-effect entry) |
| gameEvents.ts | 17 | tiny event bus optional layers listen on | emit, on |
| gate-text.ts | 197 | plain-words renderer for a banked flag predicate | CHARISMA_THRESHOLDS, gateWords, stageCensus |
| gl-shared.ts | 47 | the one three.js WebGL context of the field | getSharedRenderer, sharedLost, sharedContextCount |
| glossary-book.ts | 317 | GLOSSARY book: DIGIMON section list and card | createGlossaryBook, GLOSSARY_LAYOUT, PAGE2 |
| glossary-digimon.ts | 400 | rows behind GLOSSARY > DIGIMON, pure | buildSpecies, pageTwoLines, partnerOf |
| glossary-fallback.ts | 26 | picture drawn when a species has no 3D model | createPartnerFallback |
| glossary-items.ts | 138 | rows behind GLOSSARY > ITEMS, one item a screen | whereVisible, itemPage, createItemsModel |
| glossary-model.ts | 36 | GLOSSARY cursor, list window, page, card reveal | VISIBLE, createGlossaryModel, REVEAL_EVERY |
| glossary-stage.ts | 140 | the model turning on the right of GLOSSARY | createStage, TURN_SECONDS, TURN_DEG_PER_S |
| gpu-pixel-filter.ts | 365 | EPX, MMPX and xBR as one whole-frame shader | GPU_FILTER_NAMES, registerPixelScreen, pixelFilteredFrame |
| grass3d.ts | 330 | real 3D grass on the 2D overworld maps | renderGrass, GRASS_VIEW |
| gunslinger-switch.ts | 89 | Undersea Base room-phase switch events | gunslingerSwitchCommand, applyGunslingerSwitch, GUNSLINGER_SWITCHES |
| gym-extra.ts | 24 | extra training halls and their town greeters | gymExtraHallAt, gymExtraPlan, gymExtraTier |
| gym-map-page.ts | 164 | gym map page: nine gyms, greeter, rank ladder | placeName, greeterText, gateText |
| gym-map.ts | 91 | the nine training gyms and their rank ladders | groupSizes, gymRows, groupDrills |
| gym-translated.ts | 283 | browser adapter: training gym screen | createGymTranslated, gymGroupForStage |
| gym-vram-paint.ts | 144 | software painter for gym sprite-actor primitives | createGymPrimPainter |
| gym.ts | 127 | training gym scene drawing from TRANIN packs | traninEntry, TR_INTRO, TRANIN_ANCHORS |
| help-menu-translated.ts | 139 | browser adapter: eight-topic help menu | createHelpMenuTranslated |
| host-rules.ts | 77 | host battle settings every player in the room obeys | pickRules, createRuleOverride, HOST_RULE_KEYS |
| inn-translated.ts | 232 | browser adapter: inn rest screen | createInnTranslated |
| inn.ts | 33 | the inn rest service's state write | applyInnRest |
| input.ts | 156 | browser side of the PlayStation pad abstraction | asButton, isPadButton, attachGamepad |
| item-log.ts | 93 | which items the player has ever owned or seen | createItemLog, watchBag, ITEM_LOG_KEY |
| item-rulebook-page.ts | 107 | page half of Item Rulebook, draws shipped table | — (page only) |
| item-rulebook.ts | 112 | what one use of every field consumable does | CAPS, ruleRows, capWords |
| item-source-page.ts | 122 | page half of Item Source Book, four shipped tables | — (page only) |
| item-source.ts | 236 | where each of the disc's 402 items comes from | indexRows, priceWord, nothingLine |
| itemicons-data.ts | 19 | item icon family to CMFONTCS clip id | FAMILY_TO_CLIP, formatBits |
| itemicons.ts | 47 | real per-item icons for shop and bag lists | drawItemIcon, itemIconClip, itemFamily |
| lab-filter.ts | 124 | type-to-filter for long selects in dev harnesses | makeFilterable, autoFilterable, injectFilterStyles |
| lab-translated.ts | 395 | browser adapter: Digimon lab desk | createLabTranslated |
| language-desk.ts | 148 | boot language screen: seven rows, five reachable | ROW_TABLE, ROWS, TITLE_CLIPS |
| leave-fade.ts | 42 | the one leave fade the hand-authored screens share | leaveFadeStep, leaveFadeFrames, leaveFadeLevel |
| lib3d/ (folder) | 4 | folder — vendored three.js r186 and addons (js only) | — |
| map-open-air.ts | 21 | open-air vs indoor split, by map name | isOpenAirMapName, OPEN_AIR |
| map-screen-book.ts | 84 | map-screen book page: area boxes and links | createMapScreenBook, MAP_PANEL |
| map-screen-model.ts | 187 | map screen data: regions, links, layout, cursor | regionOf, buildGraph, openRegions |
| map-tiles.ts | 190 | field maps drawn from HD tiles, cached | tiledMap, loadTileIndex, tickTiles |
| mapclass.ts | 52 | which map picture variant grass or water reads | classSource, variantBase |
| memcard.ts | 149 | virtual PS1 memory card image: dir blocks, slots | MCARD_FORMAT, DIR_BLOCK_SIZE, SAVE_IMAGE_SIZE |
| menu/ (folder) | 8 | folder — pause menu: create, draw screens, logic, state | — |
| menu.ts | 43 | split stub: re-exports menu/ folder | CARD_STAT_LABELS, MAP_HOLD_FRAMES |
| mount.ts | 539 | riding a Digimon: speed, followers, mount state | installMount, mountState, MOUNT_SPEED |
| mount3d.ts | 979 | three.js DW2 mount models and palette | parseDw2Gltf, bindPose, MOUNT_VIEW |
| mp-credit.ts | 31 | co-op win credits both tamers' quests | winEvent, sameEvent |
| mp-emotes.ts | 37 | reaction bubble over a friend's head | bubbleTick, bubbleFor, EMOTE_BUBBLE |
| mp-goto.ts | 19 | where to stand when warping to a friend | pickSpotNear, GOTO_TIMEOUT_MS |
| mp-league.ts | 262 | Server Champ night: room tournament, pairings | newLeague, nextPairing, MIN_TAMERS |
| mpbattle/ (folder) | 5 | folder — multiplayer battle: command, host, net, state, ui | — |
| mpbattle-menus.ts | 131 | many-vs-many fight menus and message box | createMenus |
| mpbattle-pause.ts | 75 | multiplayer rejoin rules while paused | createPause, pzText, AWAY_MS |
| mpbattle-rules.ts | 546 | many-vs-many fight rules: turns, spread damage, scoring | isSpread, plainLine, SPREAD_MP |
| mpbattle.ts | 33 | split stub: re-exports mpbattle/ folder | installMpBattle, mpbActive, mpbVisible |
| mpsocial.ts | 791 | social dock: chat, players, inspect, co-op rolls | installSocial, coopTry, coopReady |
| multiplayer.ts | 554 | optional online play: rooms, connect, host | connect, isOnline, myId |
| name-bytes.ts | 27 | screen text codec for the partner-naming screen | encodeNativeScreenText |
| nameentry-translated.ts | 181 | adapter for translated partner-naming screen | createNameEntryTranslated, encodeGameName, decodeGameName |
| native-runtime.ts | 45 | door to the research-only MIPS interpreter bundle | loadNativeRuntime, nativeRuntime |
| native-screen-host.ts | 314 | production native-screen host: preload, open, adapt | openNativeScreen, preloadNativeScreens, createNativeAdapter |
| native-screen-lab.ts | 219 | lab page booting native screen overlays from assets | — (page script) |
| native-screen-pad.ts | 221 | pad-input service for a booted native screen | createNativeScreenPadInput |
| native-screen-render.ts | 412 | replays recorded picture intents through the screen pack | createNativeScreenRenderer |
| native-screen-roots.ts | 19 | root constructors for screens the manifest misnames | nativeRootCtorFor, NATIVE_ROOT_CTORS |
| native-screen-text.ts | 324 | draws a native screen's live text through uifont | drawNativeTextWidgets, decodeNativeText, revealedRun |
| native-screen.ts | 529 | browser driver for native SCREEN overlays (load, pad, draws) | loadNativeScreens, setNativeScreenPad, nativeScreenObjects |
| native-session.ts | 60 | shared paint and update loop for translated sessions | paintNativeSession, updateNativeSession |
| native-stage.ts | 148 | driver for the native wstag stage machine code | tickNativeStage, enterNativeStage, nativeStage |
| newmaps.ts | 62 | maps made after the disc: load, merge, exits | loadNewMaps, mergeNewMaps, newMapScene |
| omen.ts | 74 | "a feeling before a fight" encounter-closeness readout | omenLevel, omenCues, runsLeft |
| options-book.ts | 102 | OPTIONS screen as a four-page book | createOptionsBook, OPTIONS_WINDOW |
| options-model.ts | 289 | OPTIONS rows, pages, detail levels, cursor | DETAIL_LABELS, EXTRA_GROUPS |
| ordinal-scene-variant.ts | 74 | browser mirror of engine ordinal scene-variant and BGM | SCENE_VARIANT_ORDINALS, SCENE_BGM_VARIANT_PLAY_ID |
| packed-sound.ts | 97 | browser packed-sound lookup and archive resolve | packedSampleResolver, packedIsMusicStart, packedKey |
| packs.ts | 27 | starter packs the Account Clerk offers | PACKS, packOptions, leadOptions |
| packselect-translated.ts | 144 | adapter for translated pack pick in registration | createPackSelectTranslated |
| panel-kit.ts | 71 | free-height panels built from pause-list tiles | buildPanelClip, panelHeight, tileFrames |
| partner-pictures.ts | 101 | picture of a new partner in slots 8 and up | drawPartnerPicture, isPartnerPicture, preloadPartnerPictures |
| party.ts | 178 | party roster view, char-id mapping, baseline stats | CHARID_TO_DIGID, partyRosterView, baseStatsFor |
| pause-extra-rows.ts | 28 | extra pause-home rows after the disc's own | pauseExtraRows, pauseLabelOk, BOOK_LABELS |
| pause-home.ts | 70 | the one pause-home open path and return | openPauseHome, returnToPauseCardFolders |
| perf-test.ts | 771 | dev page measuring scene frame cost | — (page script) |
| placecard-translated.ts | 207 | adapter for translated stage-entry title card | createPlaceCardTranslated, loadPlaceCardTranslated, placeCardScene |
| placecard.ts | 157 | title card: area and place names typed out | createPlaceCard, loadPlaceCard, placeCardNames |
| placer-format.ts | 38 | placement file format and ground-drag maths | groundPoint, isAssetEntry, normaliseData |
| post2d.ts | 115 | HD-2D post-process over the field canvas | installPost2d |
| quartermaster.ts | 351 | best legal equipment loadout per Digimon, scored | itemRecord, legalCombo, slotOptions |
| quest-chase.ts | 115 | chase scene step: target path and leash | createQuestChase, chaseFacing |
| quest-editor-lib.ts | 83 | quest editor rules: walkable cells, snapped spots | walkable, cellSpot, snapPoint |
| quest-editor.ts | 366 | quest editor page: place characters and paths | — (page script) |
| quest-endings.ts | 290 | "Every Ending" page listing each job's outcomes | endingsBlock, endingsOf, endingsTable |
| quest-fx.ts | 561 | quest scene effects drawn inside field y-sort | questFxSpawn, installQuestFxPlayerDrive, defineQuestFxSheet |
| quest-ghost.ts | 188 | ghost scene step: faded replay figure | questGhostActor, questGhostSet, questGhostActive |
| quest-lab.ts | 230 | test panel listing quests with start buttons | — (page script) |
| quest-offers.ts | 36 | which job offers show, filters and pages | offersAt, offerLabels, pageCount |
| quest-props.ts | 196 | quest props left on a map by quest state | questPropSolidAt, questPropsTick, boxHolds |
| quest-readback.ts | 431 | scene steps read back as plain English | readBack, diffReadback, KINDS |
| quest-scenes.ts | 611 | quest scene script compiled to cutscene commands | compileScene, castOf, validateScene |
| quest-shelf.ts | 159 | state shelf: name, diff, undo quest state | shelfAdd, shelfExport, diffSnapshots |
| quest-triggers.ts | 193 | walk-in quest triggers on ground patches | installTriggers, enterTrigger, arrivalTrigger |
| quest-walk.ts | 336 | walkable ground for scripted quest walks | questGrid, questStandFree, questWalkLegs |
| questmarks.ts | 51 | ? and ! marks over quest givers' heads | drawQuestMark |
| quests.ts | 829 | extra quests: unlock, offers, progress, log | installQuests, questDone, questTalk |
| redirect-view.ts | 118 | which object a confirm press really reaches | redirectFor, redirectReport, pairsOnMap |
| replay-theatre.ts | 302 | replays a room's story scenes with no writes | replayLadder, replayRows, replayRefused |
| resident-data.ts | 99 | loaders for shared resident font and text tables | loadResidentResources, fetchJson, fetchBytes |
| retry-loader.ts | 17 | lazy loader that retries failures after a delay | createRetryLoader |
| save-translated.ts | 317 | adapter for translated memory-card save/load screen | createSaveTranslated |
| save-xray-page.ts | 156 | Save X-ray page: read slots, draw model sections | — (page script) |
| save-xray.ts | 453 | memory-card image decoded byte by byte | xray, diffSlots, SECTION_TABLE |
| save.ts | 287 | memory-card slot storage and record builder | buildRecord, readSlot, restoreSlotData |
| scene-dryrun.ts | 398 | play a quest scene in node through the cutscene VM | dryRun, questScenes |
| sceneEditor.ts | 110 | collision-editor tool to place NPCs and scenes | createSceneEditor |
| scenery.ts | 501 | time-of-day colours, fog, sky, bolts | drawScenery, todColor, cueBolt |
| scenery2.ts | 548 | breath fog, wind gusts, glows, critters | drawScenery2, gustLevel, hasLights |
| scenery3.ts | 258 | night lighting, rain, biome wildlife | drawScenery3, resetScenery3 |
| sceneSkip.ts | 108 | dev overlay jumping to any story ordinal | createSceneSkip |
| screendim.ts | 171 | shared screen dim and title vignette painting | paintScreenDim, dimFillStyle, paintTitleVignette |
| screenpack.ts | 257 | shared renderer for decoded screen packs | loadPack, drawClip, clipSize |
| seamfix.ts | 107 | patches pinholes in stitched HD maps | seamPatchFor |
| ship-list.ts | 94 | what each F2 switch ships as, decided once | shipClass, isInstalledBuild, shipForced |
| shop-translated.ts | 156 | adapter for translated merchant task tree | createShopTranslated |
| shop.ts | 975 | the item shop rebuilt to the real stitshop flow | createShop |
| showcase.ts | 49 | showcase menu: hand-picked maps and a tour | installShowcase, SCENES |
| silence-report.ts | 246 | what this build cannot sound, from shipped tables | MOVIE_GAP_ROWS, stemForWord, KNOWN_FIRES |
| slot-check.ts | 137 | Card Verify: checks a save slot before trusting it | checkRecord, checkImage, CODE_CARD_ERROR |
| sound-audit.ts | 213 | resolves every battle sound per Digimon | clipRows, buildRoster, contactTypeForTech |
| soundtest.ts | 342 | the developers' own SOUND TEST screen | createSoundTest, soundTestPlayable, SOUNDTEST_ROWS |
| soundtrack.ts | 115 | whole soundtrack grouped by map and battle theme | soundtrackRows, playMode, stemOfPlayId |
| species-log.ts | 84 | species met and defeated, feeding the glossary | installSpeciesLog, createSpeciesLog, SPECIES_LOG_KEY |
| sprite-filters.ts | 160 | pixel-art upscaler test for field sprites | SPRITE_FILTERS, xbr, nearest4 |
| stage-locality.ts | 75 | valid stages directly reachable from one scene | directStageNeighbors, stageWorkingSet, encodeFieldLocation |
| stage-objects.ts | 670 | translated stage actors built from record tables | fireStageObject, paceStageObjects, setStageObjectPoleRecords |
| stage-wipe.ts | 357 | ordinary stage-change wipe, translated | WIPE_W, WIPE_H, WIPE_CLOSE_STEP_W |
| stagslct.ts | 365 | the developers' own STAGSLCT launcher screen | createStagslctMenu, v2Rows, cursorStep |
| status-backdrop.ts | 28 | animated diamond backdrop for status screens | createStatusBackdrop |
| status-translated.ts | 353 | adapter for translated pause screens | createStatusTranslated, mapSeenReader, encodePauseName |
| story-explorer.ts | 575 | NPC dialogue-state explorer: stage, person, records | makeReader, groupRecords, decodeSave |
| systems.ts | 209 | System Status page reading generated status json | — (page script) |
| tech-record.ts | 59 | technique-record bytes the browser battle reads | rollBattleDrop, mergeTechRecord, dropPasses |
| test-tech-pose.mts | 99 | harness driving battle-test through one tech attack | — (test script) |
| text-fit.ts | 46 | fit or wrap text to a pixel width | fitByWidth, wrapByWidth, wrapToLines |
| textbox.ts | 343 | dialogue textbox: typewriter, balloons, choices | createTextbox, autoBalloonMode, balloonAnchor |
| theatre-plan.ts | 44 | what Move Theatre offers for one Digimon | theatrePlan, theatreCameraModes |
| title-movie.ts | 115 | launches the title screen's two opening movies | createTitleMoviePlayer |
| titlescreen.ts | 296 | extracted-art adapter for translated title screen | createTitleScreen, titleClipsFor, titleViewTransform |
| translated-screen-host.ts | 129 | one open/close host for all translated screens | createTranslatedScreenHost, CLOSE_NOTIFY, DISPOSE_ALWAYS |
| treesway.ts | 166 | swaying painted trees over the field | drawSwayingForeground, drawTreePatch |
| types/ (folder) | 95 types | folder — TypeScript declarations only, one file per module, imported with `import type` (see types/MAP.md) | — |
| ui-c/ (folder) | 20 | folder — look C kit: base parts, pages, lists, screens | — |
| ui-flow-data.ts | 282 | data table of player-facing navigation edges | UI_FLOWS, classifyFlowNode |
| ui-flow.ts | 220 | page drawing the recorded navigation flow | — (page script) |
| ui-kit-input.ts | 43 | pad reading for the new book screens | createKitInput, REPEATING, WORD |
| ui-kit.ts | 204 | window kit for book screens, reusing existing art | createFold, BOX_W, OPEN_STEPS |
| ui-lab-screens.ts | 153 | screen table for remaster-vs-pixel ui-lab view | LAB_SCREENS, stepsFor, needsFor |
| uifont.ts | 307 | the game's real bitmap UI font and text drawing | textWidth, fontReady, glyphPaint |
| uiRects.ts | 129 | PS1-style window chrome from canvas primitives | drawWindow, drawTalkWindow, drawAdvanceCursor |
| vendor/ (folder) | 2 | folder — vendored headless engine.js disc tables and VMs (js only) | — |
| volume-levels.ts | 16 | OPTIONS volumes as multipliers of fixed gains | scaleGain, clampLevel, BASE_GAIN |
| walk-blend.ts | 68 | cross-fade between the walk cycle's eight frames | walkBlendNext, blendWeight, WALK_BLEND_FRACTION |
| water3d.ts | 271 | 3D-lit animated water over 2D maps | renderWater, isWaterAt, WATER_VIEW |
| weapon-lab.ts | 54 | signature weapon's hidden on-hit effect text | weaponEffectLine |
| wfight-translated.ts | 142 | adapter for translated battle boot loader | createWfightTranslated, wfightLoaderRegion |
| wire.ts | 217 | door wiring tool over extracted entities | — (page script) |
| world-globe-layout.ts | 376 | stitches open-air maps into one flat world | adjacent, overlaps, overlapDepth |
| world-globe.ts | 171 | page drawing the stitched world on a sphere | — (page script) |
| yesno-translated.ts | 137 | adapter for translated field Yes/No box | createYesNoTranslated |

Where to look for:
- change battle flow, turns, HP/MP bookkeeping -> battle.ts (then battle/plans.ts, battle/status.ts)
- battle drawing, fight models, animation -> battle3d.ts (then battle3d/gl.ts, battle3d/skeleton.ts)
- field tick, map load, story events, transitions -> game.ts (then game/update.ts, game/map-load.ts)
- any translated screen's data/input/paint adapter -> *-translated.ts, all run by battle-menu-adapter.ts
- disc data turned into rows or numbers (items, economy, gyms) -> codex-data.ts, bit-ledger.ts, item-source.ts
- party members, char-id mapping, base stats -> party.ts
- save slot records, memory-card bytes -> save.ts (layout: save-xray.ts)
- riding a Digimon, mount speed and followers -> mount.ts (drawing: mount3d.ts)
- dialogue textbox typing, balloons, choices -> textbox.ts
- co-op rooms, chat dock, trade, warping to a friend -> multiplayer.ts, mpsocial.ts, mp-goto.ts
