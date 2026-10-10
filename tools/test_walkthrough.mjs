// tools/test_walkthrough.mjs
// AUTONOMOUS walkthrough test — drives the REAL headless GameEngine through every beat of
// the master story-progress spine (the same debug_spine.json the in-game scene-skipper uses)
// and reports, per beat, whether its stage loads and its scene dispatches. Mirrors how the
// browser's engine-bridge drives play (tests/engine-bridge.test.js) but with spy renderers,
// so it exercises the genuine event/flag/ordinal decisions from Genji (s200) to the finale.
//
// Run:  node tools/test_walkthrough.mjs            (full report; exits 1 on any hard error)
//       node tools/test_walkthrough.mjs s200       (one stage)
//
// Hard error  = stage failed to load, or a dispatch threw  → fails the run.
// Soft note   = beat fired no scene via entry+talk (often expected: position/branch gated).

import { readFileSync } from "node:fs";
import { GameEngine } from "../engine/index.ts";
import { createEngineBridge } from "../web/engine-bridge.js";

const content = JSON.parse(readFileSync("web/assets/engine-content.json", "utf8"));
const spine = JSON.parse(readFileSync("web/assets/data/debug_spine.json", "utf8")).spine;
const only = process.argv[2];

// Drive one beat with spy renderers; return its dispatch trace or an error.
function runBeat(beat) {
  const calls = [];
  let engine;
  try {
    engine = new GameEngine(content, { driven: true });
    engine.state.vars.set("$story.ordinal", beat.ordinal);
    for (const f of beat.clearFlags) { try { engine.state.flags.set(f, false); } catch { /* virtual bank */ } }

    const bridge = createEngineBridge({
      engine,
      // Play cutscenes synchronously, no handoff (we want to stay on the beat under test).
      playCutscene: (flagKey, onDone) => { calls.push(["cutscene", flagKey]); onDone(null); },
      // Auto-win battles so PRE→battle→POST chains resolve.
      startBattle: (screenId, onWin) => { calls.push(["battle", screenId]); onWin(); },
      doHandoff: (screenId) => { calls.push(["handoff", screenId]); },
    });

    bridge.onStageEnter(beat.stage);          // fires any auto (OnEnterMap) cutscene
    for (const a of beat.sayActors) {          // surface talk-gated scenes
      if (!bridge.isBusy()) bridge.onTalk(a);
    }
    return { calls };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

let hard = 0, fired = 0, quiet = 0;
const beats = only ? spine.filter((b) => b.stage === only) : spine;
if (!beats.length) { console.error("no such stage:", only); process.exit(2); }

console.log("ord   stage  events  dispatched");
console.log("----  -----  ------  ----------");
for (const b of beats) {
  const r = runBeat(b);
  if (r.error) {
    hard++;
    console.log(`${b.ordHex}  ${b.stage}  ERROR   ${r.error}`);
    continue;
  }
  const summary = r.calls.map((c) => c.join(":")).join(" ");
  if (r.calls.length) fired++; else if (b.eventCount) quiet++;
  const flag = r.calls.length ? "✓" : (b.eventCount ? "·" : " ");
  console.log(`${b.ordHex}  ${b.stage}  ${String(b.eventCount).padStart(2)}ev    ${flag} ${summary}`);
}

console.log("----");
console.log(`beats=${beats.length}  dispatched=${fired}  quiet(events-but-no-entry/talk)=${quiet}  HARD_ERRORS=${hard}`);
process.exit(hard ? 1 : 0);
