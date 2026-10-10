// Story-progression autopilot — headless integration harness.
//
// Walks the decoded master-ordinal spine ([0x8004b370], progress_ordinal.json `ladder`)
// beat by beat through the REAL GameEngine: for each beat it sets the gate state, loads
// the stage, fires that stage's actual triggers (OnEnterMap / OnTalk / OnStep), auto-wins
// any battle the trigger launches, and checks whether the system reacted the way the data
// says it should — i.e. the story ordinal advanced, flags were set, a battle fired.
//
// It is NOT a pass/fail test (the engine is ~50%); it is a COVERAGE REPORT. Each beat is
// classified ✅ activated / ⚔️ battle fired / ❌ inert (trigger raised nothing or ordinal
// stuck) / ⏭ no-headless-trigger (advances via position/zone we can't drive without a
// renderer). Run from repo root:  node tools/story_autopilot.ts  [--chain]
//
// --chain : don't reset the gate before each beat — run true end-to-end (one early gap
//           stops the train). Default is per-beat isolation (every beat gets a fair test
//           from its correct predecessor ordinal) so the report is a full coverage map.

import { readFileSync } from "node:fs";
import { convertStages } from "./engine-convert/lib.ts";
import { loadRealContent, loadWstagEvents, loadFieldEncounters, loadScriptedBattles } from "./engine-convert/load-real.ts";
import { GameEngine } from "../engine/index.ts";

const CHAIN = process.argv.includes("--chain");

const real = loadRealContent();
const ladder: { stage: number; ordinals: number[] }[] =
  JSON.parse(readFileSync("web/assets/data/progress_ordinal.json", "utf8")).ladder;
const stageNames: Record<string, string> =
  JSON.parse(readFileSync("data/stage_names.json", "utf8"));

const { stages, flagKeys } = convertStages({
  storySteps: real.storySteps,
  wstagEvents: loadWstagEvents(),
  fieldEnc: loadFieldEncounters(),
  scriptedBattles: loadScriptedBattles(),
});
const stageById = new Map(stages.map((s) => [s.mapId, s]));
const eng = new GameEngine({ stages, ordinal: real.ordinal, roster: real.roster, flagKeys });

const ord = () => Number(eng.state.vars.get("$story.ordinal") ?? 0);

// Flatten the ladder into one (target-ordinal, stage) beat per ordinal write, in play order.
const beats: { target: number; stage: string }[] = [];
for (const rung of ladder)
  for (const o of rung.ordinals) beats.push({ target: o, stage: `s${rung.stage}` });
beats.sort((a, b) => a.target - b.target);

interface Result {
  target: number; stage: string; name: string;
  status: "activated" | "battle" | "inert" | "no-trigger";
  detail: string;
}
const results: Result[] = [];

// Fire one trigger row, pumping to completion; auto-win any battle it launches and re-raise
// so the POST row can run. Returns true if anything ran.
function fireTrigger(row: { on: string; match?: { npc?: number } }): boolean {
  const params = row.match?.npc != null ? { npc: row.match.npc } : undefined;
  let ranSomething = false;
  // Re-raise the SAME trigger until nothing more fires: this walks a scripted-battle
  // chain PRE → battle → POST (three once/armed rows on the same npc). On a battle we set
  // the won flag so the POST row arms. Bounded so a self-re-arming event can't spin.
  for (let attempt = 0; attempt < 6; attempt++) {
    const before = eng.battleLog.length;
    const h = eng.raise(row.on, params as Record<string, number> | undefined);
    if (!h) break; // no (more) matching, un-fired, gate-passing row → done
    ranSomething = true;
    eng.pump(h);
    if (eng.battleLog.length > before) {
      const { wonFlag } = eng.battleLog.at(-1)!; // host wins → arm POST
      eng.state.flags.set(wonFlag, true);
    }
  }
  return ranSomething;
}

for (const beat of beats) {
  if (!CHAIN) eng.state.vars.set("$story.ordinal", beat.target - 1); // isolate from correct gate
  const before = ord();
  const stage = stageById.get(beat.stage);
  eng.loadStage(beat.stage);
  const name = stageNames[beat.stage] ?? beat.stage;

  if (!stage) { results.push({ ...beat, name, status: "no-trigger", detail: "stage not in content" }); continue; }

  // The triggers that can advance this beat, in firing order: enter → talk(per npc) → step.
  const rows = stage.events;
  const enter = rows.filter((r) => r.on === "OnEnterMap");
  const talkNpcs = [...new Set(rows.filter((r) => r.on === "OnTalk").map((r) => r.match?.npc))];
  const steps = rows.filter((r) => r.on === "OnStep");

  const battlesBefore = eng.battleLog.length;
  let anyRan = false;
  for (const r of enter) anyRan = fireTrigger(r) || anyRan;
  for (const npc of talkNpcs) {
    anyRan = fireTrigger({ on: "OnTalk", match: { npc: npc as number } }) || anyRan;
    if (ord() >= beat.target) break;
  }
  if (ord() < beat.target) for (const r of steps) { anyRan = fireTrigger(r) || anyRan; if (ord() >= beat.target) break; }

  const after = ord();
  const firedBattle = eng.battleLog.length > battlesBefore;
  if (after >= beat.target)
    results.push({ ...beat, name, status: "activated",
      detail: `ordinal ${before}→${after}` + (firedBattle ? ` (battle screen ${eng.battleLog.at(-1)!.screenId})` : "") });
  else if (firedBattle)
    results.push({ ...beat, name, status: "battle", detail: `battle screen ${eng.battleLog.at(-1)!.screenId} fired but ordinal stuck at ${after}` });
  else if (anyRan)
    results.push({ ...beat, name, status: "inert", detail: `trigger ran but ordinal stayed ${after} (no on_complete advance)` });
  else
    results.push({ ...beat, name, status: "no-trigger", detail: steps.length ? "only OnStep/zone triggers (need position; not driven headlessly)" : "no trigger row in stage" });
}

// ── Report ──
const icon = { activated: "✅", battle: "⚔️ ", inert: "❌", "no-trigger": "⏭ " } as const;
console.log(`\nStory-progression autopilot  (${CHAIN ? "CHAIN / end-to-end" : "per-beat isolated"})  — ${beats.length} beats\n`);
for (const r of results)
  console.log(`  ${icon[r.status]} 0x${r.target.toString(16).padStart(2, "0")} ${r.stage.padEnd(5)} ${r.name.padEnd(34)} ${r.detail}`);
const by = (s: Result["status"]) => results.filter((r) => r.status === s).length;
console.log(`\n  ✅ activated ${by("activated")}   ⚔️ battle-only ${by("battle")}   ❌ inert ${by("inert")}   ⏭ no-headless-trigger ${by("no-trigger")}   / ${results.length}\n`);
