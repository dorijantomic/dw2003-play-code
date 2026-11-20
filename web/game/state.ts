import { createScreenRouter } from "../vendor/engine.js";

// moved by hand from vars.ts: S.screenRouter's initializer needs it at load time.
// Built once the screen table loads (init). Resolves HANDOFF screen ids → maps.
export const screenRouterOptions = {
    useAlt: () => Number(S.engine?.state.vars.get("$story.ordinal") ?? 0) === 0x2d,
};

export const S = {
  glossaryItemLoader: null,
  flyChosen: null,
  chatShownAt: 0,
  chatPages: 1,
  chatPresses: 0,
  // Debug-only: how many footstep cues the player's move handler has fired, so a
  // verifier can assert that a scripted NPC walk is silent (window.__footstepCount).
  footstepCount: 0,
  // Every field billboard cell drawn in the current frame, with the row it was drawn at
  // and the registration that put it there. tools/verify_field_billboard_anchor.mjs reads
  // this; nothing else does, and it costs one object per drawn actor per frame.
  billboardDraws: [],
  fieldFrame: null,
  // `textbox` is a facade over both boxes: it reports open while EITHER is open (so every gate and the
  // verifier fleet that reads window.__textbox.isOpen() keeps working); everything else is the legacy box.
  // Readable copy of the line the translated box shows (from the same disc text), so checks that read
  // window.__textbox.dialogue see it. The box itself draws from the raw bytes, not from this copy.
  translatedDialogueText: null,
  yesNoAwaitingChild: false,
  // The ordinal-43 field movie (MOVIED08_STR), the pre-battle clip of
  // F0x8008B798's post-fight arm. The movie object is ported in
  // engine/systems/field-movie-player.ts; web/field-movie.js is the media/draw
  // adapter. The host resolves the handoff promise when the movie is over, and
  // `startParty` then runs the battle the movie's own return selector (0x600)
  // names. Every other ordinal leaves `battleHandoff().movie` null and the
  // handler resolves at once, so nothing changes on the ordinary path.
  fieldMovieDone: null,
  knownStageIds: [],
  manifestSprites: new Map(),
  locationSaveTimer: null,
  fieldTickAccumulator: 0,
  // The language index the original keeps at D0x8005CCA8, and the one the pad
  // poll reads to decide its face-button layout: with it non-zero a physical Cross
  // is the confirm button and a physical Triangle goes back
  // (engine/systems/input-map.ts `padWordButton`, claim
  // `pad-poll-swaps-face-buttons-when-language-is-not-zero-2026-10-03`). The boot
  // screen's choice arrives as a plain write to `state.languageByte` — from the
  // language screen, from `?language=N`, and from the lab and the verifiers — so
  // the write itself is what pushes the index into the pad map. Reading it still
  // yields `undefined` until something picks a language, exactly as before.
  languageByte: undefined,
  // Debug-only: the live special-block interaction (engine/systems/block-actor.ts)
  // and the last one that finished, so a headless verifier reads the decoded tick
  // sequence and its landmarks (action 20 / control 36 / gone 41) instead of
  // guessing them from pixels.
  lastBlockIx: null,
  // Wrap the textbox handed to the cutscene manager so every SAY it opens is
  // anchored per the decoded window rules: speakingActor + speakingMode (the
  // script's 4th SAY operand = balloon quadrant; 4/none = plain system window).
  // The esdmg bank + entry of the cutscene being played (set by playStoryEvent): SAY line p1 is raw line p1 of the entry
  // (raw line 0 is an empty placeholder; the walker string is p1 - 1), the text the original reads from the story bank [0x80099DC8]. The translated box draws
  // the disc bytes; a failed load keeps web/textbox.js with the parsed pages.
  cutsceneEsdmgRef: null,
  questPaths: {},
  extraResidents: [],
  /**
  * Play a quest's scripted scene (web/quest-scenes.js) on the game's own cutscene VM, so characters walk, turn and the camera
  * follows exactly as in a story scene; only the words come from the quest. Resolves { answer } when it ends (answer = the
  * index picked in an "ask" step, else null), or at once with null if the scene cannot run here: the characters it needs
  * are not on this map, or the game is busy).
  *
  * The scripted events a scene can carry (our own effect art, a screen fade, a mid-scene fight, the player's Y drive, a
  * warp) are not wstag opcodes: compileScene hands them over as data, the VM reports them through `opts.sceneEvent`, and
  * runQuestSceneEvent does them. Nothing an event places may outlive the scene -- the finish path clears it, and so does a
  * skip, a warp, a battle and every stage entry.
  */
  questSceneEvents: [],
  // The running chase (the `chase` step, web/quest-chase.js): { machine, npc, fx, resolve, settled }. The scene's answer is set
  // through the same channel an "ask" uses, so on 1 the quest branches exactly as it would on a "no" answer.
  questChase: null,
  questSceneAnswerSet: null,
  // Was the quest layer on last frame? The F2 -> Extras -> Quests switch going OFF mid-scene clears the layer's own art,
  // sky and chase at once (update(), below). Declared here so the very first frame has a value to compare against.
  questsWereOn: null,
  screenRouter: createScreenRouter(null, screenRouterOptions),
  fieldScreenTable: undefined,
  // Set while the title screen is up; the joystick reads it so the pad can start
  // the game. Null once the title is gone.
  titleInput: null,
  // Launch code 0xE00 (the title screen) from inside a running game — the decoded
  // loss route, web/game.js gameOverToTitle(). Installed by init(); null before boot
  // finishes, where there is no running game to leave.
  launchTitleScreen: null,
  // The card collection can be mutated through the engine directly by several
  // screens (folder editor, card shop, booster reveal). Comparing a cheap
  // serialization on a throttle catches every path without each caller having to
  // remember, and the story-grant path writes immediately.
  lastCollectionSnapshot: null,
  collectionSweepTick: 0,
  // ── Engine = SINGLE SOURCE OF TRUTH (no legacy story stack) ───────────────────────────
  // The headless TS engine (web/vendor/engine.js) owns the banked flag store + story ordinal
  // and DECIDES every story event/battle (talk, stage-enter, OnStep), driven through
  // web/engine-bridge.js + the TS trigger-system. cutscene.js / battle.js stay the renderers.
  // The old createStoryVM / createStoryEngine JS copies are deleted — this is the cutover.
  //
  // `engine` is constructed asynchronously in initEngine() (awaited inside init(), before the
  // first frame). Until then it's null; nothing reads the flag store before the game starts.
  engine: null,
  engineBridge: null,
  engineTriggerSystem: null,
  // The disc's SETUP arm ALSO writes the player actor's DRAW-LAYER word (+0x78)
  // from a step record's param 0 — setup opcode 5 (pro/fieldstg.s:5605-5615; the
  // op the port already carries as StepOpEffect.actor78, scene-step-ops.ts:174).
  // +0x78 is the field actor's ordering-table bucket: the renderer F0x8008F52C
  // takes it to the 0x1002 draw-context's slot +0x138 (fieldstg.s:12852-12856), so
  // the actor's billboard is spliced into OT[n] and its shadow into OT[n+1]. A
  // stage's own step program therefore decides which side of the ground its leader
  // draws on, and all five stages that author op 5 use exactly 8 (behind the
  // ground) and 4 (the entity bucket, fieldstg.s:14771).
  //
  // The word is NOT cleared when the player leaves the tile — only another op-5
  // record writes it — so one entrance cell holds the bucket for a whole corridor
  // and the matching exit cell restores it. That is the Protocol Ruins tunnel. The
  // resident driver is rebuilt per stage (fieldstg.s:5998) and the actor rebuilt
  // at 4, so a map change resets it here; the gates are the setup arm's own
  // (state→scene_struct+0x54/+0x58, fieldstg.s:5c54/:5c64), the same ones
  // stepSetupTick() honours.
  stepSetupBucketMap: null,
  // The pad gets its own loop rather than riding `frame()`, for two reasons: the
  // sim loop does not start until the title screen is dismissed (so the pad could
  // not start the game), and `frame()` sub-steps itself under `__gameSpeed`, which
  // would multiply the d-pad auto-repeat rate along with everything else. Polling
  // here also makes a pad press land as promptly as a key press, which is
  // event-driven.
  padLastT: 0,
  lastT: 0,
  // F2 -> Tools -> Show FPS (dev only). A DOM box inside #stage (so it stays visible in full screen and never touches the
  // canvas). Counts the frames that really ran render() (frame() above skips the ones the 61 fps cap drops) and shows the
  // count per second and the median gap, refreshed twice a second. Switched off: the box is removed and the buffer cleared.
  fpsBox: null,
  // F2 -> Tools -> Show FPS (dev only). A DOM box inside #stage (so it stays visible in full screen and never touches the
  // canvas). Counts the frames that really ran render() (frame() above skips the ones the 61 fps cap drops) and shows the
  // count per second and the median gap, refreshed twice a second. Switched off: the box is removed and the buffer cleared.
  fpsLast: 0,
  // F2 -> Tools -> Show FPS (dev only). A DOM box inside #stage (so it stays visible in full screen and never touches the
  // canvas). Counts the frames that really ran render() (frame() above skips the ones the 61 fps cap drops) and shows the
  // count per second and the median gap, refreshed twice a second. Switched off: the box is removed and the buffer cleared.
  fpsShown: 0,
  _grassScratch: null,
};
