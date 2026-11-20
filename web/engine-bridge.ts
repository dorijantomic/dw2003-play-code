// web/engine-bridge.js
//
// The PRESENTATION DRIVER that connects the headless TS GameEngine (web/vendor/engine.js,
// constructed in `driven` mode) to the browser's renderers. The engine DECIDES which
// event/battle fires and owns flags + ordinal; this bridge RENDERS each decision by pumping
// a script RunHandle and dispatching every VM yield to an injected renderer:
//
//   • StartEvent(evId)  → playCutscene(flagKey, onDone) — play the wstag bytecode; on END
//                         run the event's on_complete (flags) + ordinal advance, then resume.
//                         The cutscene reports any HANDOFF it carries → doHandoff.
//   • StartBattle(...)  → startBattle(screenId, onWin, onLose) — on win set the won flag and
//                         re-raise OnTalk so the POST event fires; on FLEE return to the rebuilt
//                         field so the arrival chain runs again (won flag stays clear); a real
//                         loss is the host's own title route, not this hook.
//
// Pure (no DOM, no globals) so it unit-tests with a real driven engine + spy renderers
// (tests/engine-bridge.test.js). The browser injects the existing cutscene/battle/handoff systems.
//
// Known limitation (sweep follow-up, not on the s200 path): OnStep rows are gated by flags
// only, not by grid cell, so a map with multiple position cutscenes can't yet be disambiguated
// by the player's (x,y). story-vm.js still owns position routing until the sweep wires it.

//   • presentation op → onPresentation(op, args) — fire-and-forget host visuals/audio that
//                         carry no game state (PlaySparkle = the bank-0x70 op-0x50 acquisition
//                         flourish). The script is resumed immediately, exactly as before;
//                         an unhandled op is still just skipped.
export function createEngineBridge({ engine, playCutscene, startBattle, doHandoff, nativeHandlers = {}, onPresentation = null, log = () => {} }) {
  let busy = false;
  // Did the last raise actually PRESENT something (cutscene / battle / native host routine), as
  // opposed to only running side-effect ops (SetFlag / GiveItem)? A pure flag-set event — e.g. an
  // NPC dialogue-state on_close producer (`*.flagset.*`) — must NOT suppress that NPC's own spoken
  // line: its script completes with no playCutscene/startBattle, so `presented` stays false and the
  // caller still shows the dialogue (whose on_close sets the same flag). Without this, the first
  // talk fired the flag silently and skipped straight to the NPC's next line.
  let presented = false;

  // Drive `h` to completion, dispatching each yield. `trigger` = {type, params} of the event
  // that started this pump (or null = no chaining). After each event/battle completes we
  // RE-RAISE that same trigger to fire the next now-eligible row — this is how PRE→battle→POST
  // sequences in one interaction, uniformly for talk (npc), map-enter, and position (step)
  // triggers. PRE/POST rows are `once`-guarded and the battle row is gated armed&!won, so the
  // chain terminates. (OnExit is NOT chained — its branches aren't once-guarded; gondola etc.
  // are self-contained, each with its own handoff.) A stage-entry re-raise skips the arrival
  // dispatcher's own rows: that chain is asked once per field load, at `onStageEnter` and at the
  // post-fight `arrive` below — see `rechain`.
  function pump(h, trigger) {
    const rechain = () => {
      if (busy || !trigger) return;
      // Re-raising the STAGE-ENTRY trigger is "later in the same visit", so it must skip the rows
      // the entry object's own arrival dispatcher owns. The original asks that chain ONCE per field
      // load: the dispatcher ends every pass by advancing its own phase counter
      // (`lw $v0, 0x38($s4); jalr $v0` — pro/wstag305.s:598-5a4, exe/fns.s:8955-8963
      // F0x800142ac `phase = phase + 1`), its gate returns while the phase reads 1..3
      // (pro/wstag305.s:2f4-30c), and nothing can put it back in the reset band — all 51
      // set_phase (+0x28) call sites in the 76 arrival-owning overlays pass 1, 2 or 3, and a phase
      // word cannot pass 3 by incrementing because the object driver destroys the object when it
      // reads 3 (exe/fns.s:8860-8864 → 0x80018204 calls the +0x4c destructor and returns 0).
      // Every other OnEnterMap row keeps its chance: those are the walker's stand-ins for the
      // original's own frame-polled ticks (the bank-0x74 battle launcher the PRE's completion
      // writes, pro/wstag756.s:144), which really do keep polling for the rest of the visit.
      const arrivalOnly = trigger.type === "OnEnterMap";
      const next = engine.raise(trigger.type, trigger.params, arrivalOnly ? { skipArrivalChain: true } : undefined);
      if (next) { busy = true; pump(next, trigger); }
    };
    // Winning a story fight puts the player BACK IN THE FIELD, and in the original that is a
    // fresh field load: the stage is torn down and its entry object rebuilt, so the stage-entry
    // arrival dispatcher runs again from the top of its chain (engine/systems/scene-arrival.ts).
    // That fresh pass is what starts a beat's SECOND half — the scene where the boss is beaten
    // and you walk out. Its only start site in the disc is the entry chain: pro/wstag756.s:47-48
    // is the whole overlay's only `start_event(911)` call, and the fight that separates the two
    // halves is launched from a different tick (pro/wstag756.s:144 writes 0x7400 once the PRE has
    // set 0x405B, :79-92). Without the rebuild the closing scene could never start at all, so
    // this is the original's route, not a walker convenience.
    //
    // It is raised BEFORE the original trigger's own re-raise, because in the disc the rebuilt
    // stage's entry object ticks before anything else on that frame; `rechain` then still runs
    // for the rows that live on the PRE's own trigger (a closing scene the chain does not own).
    const arrive = () => {
      if (busy || !trigger) return false;
      const a = engine.raise("OnEnterMap");
      if (!a) return false;
      busy = true; pump(a, { type: "OnEnterMap" });
      return true;
    };
    function step() {
      engine.vm.tick(h);
      if (h.done) { busy = false; return; }
      const y = engine.lastYield;
      if (y && y.kind === "event") {
        presented = true;
        const flagKey = engine.eventFlagKey(engine.currentStage, y.evId);
        playCutscene(flagKey, (handoff) => {
          engine.completeEvent(y.evId);              // flags set on event END (faithful order)
          if (handoff != null) doHandoff(handoff);
          engine.vm.resume(h); step();
          // The PRE just ended and its on_complete ARMED the battle. Fire the next now-eligible
          // row on the SAME trigger (PRE → battle in ONE interaction; the battle's win-callback
          // then chains POST). Skip on handoff (we're leaving).
          if (handoff == null) rechain();
        });
      } else if (y && y.kind === "battle") {
        presented = true;
        startBattle(y.screenId,
          () => {                                    // win
            engine.state.flags.set(y.wonFlag, true);
            engine.vm.resume(h); step();             // finish the (one-op) battle script
            // The field comes back rebuilt, so the arrival chain runs again; that is where a
            // chain-owned closing scene starts. Only if it starts nothing do the rows on the
            // PRE's own trigger chain as before.
            if (!arrive()) rechain();
          },
          // FLEE. A flee is a NON-LOSS return to the field, so the stage comes back rebuilt
          // exactly as on a win (see `arrive` above) and the arrival chain runs again. This is
          // the arm the s480 Zanbamon fight needs: it is a scripted, UNWINNABLE battle (WFIGHTMN
          // mode 2 floors the player's damage at maxHP/11) whose own next scene has the player
          // RUN AWAY (web/assets/events/esdmg400.json entry 9), and the scene that carries them
          // to Bulk Bridge is the arrival chain's own event 171. The won flag stays clear (it is
          // win-only) and we do NOT rechain: the PRE's own trigger still holds the battle row
          // (armed & !won), so re-raising it would relaunch the fight.
          () => { engine.vm.resume(h); step(); arrive(); });
        return;                                      // wait for the player; stop here
      } else if (y && y.kind === "native") {
        // Native-handler event (compiled MIPS, no bytecode): dispatch to the host's faithfully
        // reimplemented routine by name, then resume. Unknown handler → warn + continue (so a
        // not-yet-decoded handler can't hard-lock the game; the converter --strict gate is where
        // missing handlers are caught at build time).
        //
        // Completion contract (settled 2026-09-13): a synchronous handler is called and the
        // script resumes immediately, exactly as before; a handler whose work must finish later
        // returns a thenable and the pump stays busy until it settles. No shipped script uses a
        // Native op today (pinned by tests/engine-bridge.test.js), so the branch is dormant; the
        // returned-promise form is how a future host routine signals deferred completion instead
        // of the script running on before the effect lands.
        presented = true;
        const fn = nativeHandlers[y.handler];
        if (fn) {
          const ret = fn(...y.args);
          if (ret && typeof ret.then === "function") {
            Promise.resolve(ret).then(() => { engine.vm.resume(h); step(); },
                                      () => { engine.vm.resume(h); step(); });
            return;
          }
        } else {
          log("[engine] no native handler:", y.handler);
        }
        engine.vm.resume(h); step();
      } else {
        // Other presentation op. Hand it to the host renderer (if any) and continue — these
        // are non-blocking effects, so they must NOT set `presented`: a talk-give still shows
        // the NPC's own spoken line while its flourish plays.
        if (y && y.kind === "other" && onPresentation) onPresentation(y.op, y.args ?? []);
        engine.vm.resume(h); step();
      }
    }
    step();
  }

  return {
    flags: engine.state.flags,
    isBusy: () => busy,

    // Stage entry: load the event table, fire any auto (OnEnterMap) cutscene.
    onStageEnter(mapId) {
      engine.loadStage(mapId);
      const h = engine.raise("OnEnterMap");
      if (h) { busy = true; pump(h, { type: "OnEnterMap" }); } // chains enter-path PRE→battle→POST
    },

    // Talk to `npcId`. Returns true only if a story event PRESENTED something (cutscene / battle /
    // native) — the caller then suppresses ambient dialogue. Returns false when nothing matched OR
    // the matched event was pure side-effects (SetFlag / GiveItem): those run, but the caller still
    // shows the NPC's spoken line (the flag/give and the line both belong to the same talk). The
    // caller must read the NPC's dialogue state BEFORE calling this so a flag-set doesn't pre-advance
    // it. Side effects (flags/items) still apply regardless of the return value.
    onTalk(npcId) {
      if (busy) return true;
      const h = engine.raise("OnTalk", { npc: npcId });
      if (!h) return false;
      presented = false;
      busy = true; pump(h, { type: "OnTalk", params: { npc: npcId } });
      return presented;
    },

    // Per-frame position trigger. Returns true if a step cutscene fired.
    onStep() {
      if (busy) return false;
      const h = engine.raise("OnStep");
      if (!h) return false;
      busy = true; pump(h, { type: "OnStep" }); // chains position-path PRE→battle→POST
      return true;
    },

    // Attempt a map exit. Raise OnExit with the exit's params (e.g. { to: "s440" }). If a gated
    // exit-event fires (e.g. the gondola's Blue Card check), play it — the event's bytecode
    // HANDOFF performs the actual warp via doHandoff (or it refuses and stays put). Returns true
    // if an event fired, so the caller SKIPS the plain transition; false → caller warps normally.
    onExit(params) {
      if (busy) return true;
      const h = engine.raise("OnExit", params);
      if (!h) return false;
      busy = true; pump(h, null);
      return true;
    },
  };
}
