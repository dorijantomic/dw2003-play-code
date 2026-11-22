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
| screens.ts | 43 | shared shapes of the book and screen modules: web/glossary-items.ts, glossary-stage.ts, glossary-book.ts, glossary-fallback.ts, book-host.ts, cntysel-native.ts |
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

Where to look for:
- the shape of an object a module builds and fills in -> that module's file here
- who imports a type -> `grep -rn "types/<module>.js" web/`
