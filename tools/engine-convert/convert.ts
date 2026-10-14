/**
 * convert.ts — thin CLI: reads web/assets/ JSON, writes content/ output.
 * Run: node tools/engine-convert/convert.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { convertStages, convertOrdinalLadder, convertRosterTable } from "./lib.ts";
import { buildScriptedBattles } from "./load-real.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../");
const assets = resolve(root, "web/assets/data");
const contentDir = resolve(root, "content");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

// Convert story stages -> events + scripts (OnStep + OnEnterMap + OnTalk + scripted battles)
const storySteps = readJson(resolve(assets, "story_steps.json"));
const wstagEvents = readJson(resolve(root, "web/assets/events/wstag_events.json")) as any;
const fieldEnc = readJson(resolve(assets, "field_encounters.json")) as any;
const scriptedBattles = buildScriptedBattles(readJson(resolve(assets, "scripted_battles.json")) as any);
const itemGrants = (readJson(resolve(assets, "item_grants.json")) as any).grants;
// Native (raw-MIPS) item grants (tools/extract_native_item_grants.py): a wstag overlay's
// on_complete NATIVE handler calls the resident set_flag trampoline directly instead of going
// through the bytecode event-VM's on_complete_setflags. Each site is grounded by matching its
// enclosing function's file offset to wstag_events.json's `on_complete_fn` (the exact same
// native handler wstag_extract already decoded per event) -- so these slot into the SAME
// `${stage}.event.${event_id}.oncomplete` script as the bytecode-mined item_grants.json rows.
// Sites the offset match couldn't attribute to a known event_id are left out on purpose (see
// the tool's `ambiguous`/`unattributed` output) rather than fired unconditionally.
const nativeGrantsRaw = (readJson(resolve(assets, "native_item_grants.json")) as any).grants;
const nativeGrants = nativeGrantsRaw
  .filter((g: any) => g.event_id != null)
  .map((g: any) => ({ stage: g.stage, event_id: g.event_id, item_id: g.item_id }));
const talkGrants = (readJson(resolve(assets, "talk_item_grants.json")) as any).grants;
const decodeTable = readJson(resolve(__dirname, "decode-table.json")) as any;
// The stage-entry ARRIVAL DISPATCHER's per-place chains (tools/extract_arrival_candidates.py,
// ported once in engine/systems/scene-arrival.ts, proven against the original overlays by
// tests/lane-b/scene-arrival.test.js). This is what the OnEnterMap rows are built from; it
// replaces auto_event_gates.json + beat_event_gates.json, which read a TAIL SLICE of each chain
// and so covered 62 of the 131 candidates between them.
const arrivalChains = readJson(resolve(assets, "scene/arrival_candidates.json")) as any;
// The bank-0x90 TALK launcher's per-stage START SITES (tools/extract_talk_launch_bindings.py,
// ported once in engine/systems/talk-launch.ts): which NPC conversation starts which scene,
// read out of the shipped scenes' dialogue-state on_close tables. A scene it starts gets NO
// hand row — the launcher is its start — which retires the npc-matched OnTalk rows the generic
// classifier used to guess from a scene's disassembly (see ConvertStagesInput.talkLaunch).
const talkLaunch = readJson(resolve(assets, "talk_launch_bindings.json")) as any;
const flagSets = (readJson(resolve(assets, "npc_flag_sets.json")) as any).flag_sets;
// strict ON: the decode-table covers every otherwise-dropped event, so any NEW unclassified
// event must fail the build (no silent drops — the systemic guarantee). Escape hatch
// CONVERT_STRICT=0 exists only for debugging a half-decoded table mid-change.
const STRICT = process.env.CONVERT_STRICT !== "0";
// Roster predicate records — loaded before convertStages so the 0x70 gate filter knows which
// predicates the engine can evaluate (op-0x30 range / op-0x10 case-0 pack selector).
const rosterRaw = readJson(resolve(assets, "roster_predicate_table.json")) as any;
// Bank-0x70 REWARD/ACTION table (tools/extract_bank70_rewards.py) — the same table read as a
// set_flag WRITE dispatch; only opcode-0x20 arg0==1 (CURRENCY ADD) records feed the engine.
const bank70Raw = readJson(resolve(assets, "bank70_rewards.json")) as any;
const bank70AddByFlagId: Record<number, number> = Object.fromEntries(
  bank70Raw.records.filter((r: any) => r.wireable).map((r: any) => [r.flag_id, r.resolved_action.amount]),
);
const moneyGrants = (readJson(resolve(assets, "bank70_money_grants.json")) as any).grants;
// Partner grants (tools/extract_bank70_partner_grants.py) — bank-0x70 opcode-0x10 case-3
// on_close writes = "you now have this partner Digimon" (roster_owned[slot] = slot+3).
const partnerGrants = (readJson(resolve(assets, "bank70_partner_grants.json")) as any).grants;
// Each event's scene-completion ROUTINE, as data for engine/systems/scene-completion.ts
// (tools/extract_scene_completion.py). The engine runs the list through set_flag's own bank
// dispatch and the master story ordinal; nothing is converted into instructions here.
const sceneCompletion = readJson(resolve(assets, "scene/scene_completion.json")) as any;
const { stages, flagKeys } = convertStages({ storySteps, wstagEvents, fieldEnc, scriptedBattles, itemGrants: [...itemGrants, ...nativeGrants], talkGrants, moneyGrants, partnerGrants, bank70AddByFlagId, flagSets, decodeTable, arrivalChains, talkLaunch, sceneCompletion, rosterRecords: rosterRaw.records, strict: STRICT });

for (const stage of stages) {
  writeJson(resolve(contentDir, "events", `${stage.mapId}.json`), stage.events);
  writeJson(resolve(contentDir, "scripts", `${stage.mapId}.json`), stage.scripts);
}

// Convert ordinal ladder -> flags/ordinals.json. ordinal_owner.json is the per-stage decode of
// WHICH event's on_complete routine writes the master ordinal (tools/extract_ordinal_owner.py);
// it rides along as ordinal.byStageOwner so GameEngine.completeEvent advances the story on that
// event instead of on any completed event of the stage.
const progressOrdinal = readJson(resolve(assets, "progress_ordinal.json"));
const ordinalOwner = readJson(resolve(assets, "ordinal_owner.json"));
const ordinals = convertOrdinalLadder(progressOrdinal, ordinalOwner, stages);
writeJson(resolve(contentDir, "flags", "ordinals.json"), ordinals);

// Convert roster predicate table -> flags/roster.json (rosterRaw loaded above)
const roster = convertRosterTable(rosterRaw, bank70Raw.amount_tables);
writeJson(resolve(contentDir, "flags", "roster.json"), roster);

// The single committed artifact the browser fetches: the full EngineContent blob.
writeJson(resolve(root, "web/assets/engine-content.json"), { stages, ordinal: ordinals, roster, flagKeys });

console.log(`Converted ${stages.length} stages -> content/ + web/assets/engine-content.json`);
console.log(`Ordinals: ${ordinals.allOrdinals.length} unique, ${Object.keys(ordinals.byStage).length} stages, ` +
  `${Object.keys(ordinals.byStageOwner ?? {}).length} with a decoded owner event`);
console.log(`Roster records: ${roster.records.length}`);
