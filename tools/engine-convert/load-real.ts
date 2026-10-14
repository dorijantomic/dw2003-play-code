// Load the REAL extracted DW3 content (web/assets/data/*.json + scenes) and run
// the converters over it. Used by the authenticity-oracle integration tests so
// they exercise the engine against real decoded data, not fixtures.
// Reads only web/assets/** (never ~/ddw3) per the engine-port constraint.
import { readFileSync } from "node:fs";
import { convertStoryStages, convertOrdinalLadder, convertRosterTable, type ConvertedStage } from "./lib.ts";
import { SCRIPTED_BATTLES, SCREEN_OVERRIDES, type ScriptedBattle } from "./scripted-battles.ts";

const D = "web/assets/data/";

export interface RealContent {
  storySteps: any;
  ordinalJson: any;
  rosterJson: any;
  /** Each event's scene-completion routine as data (engine/systems/scene-completion.ts). */
  sceneCompletion: any;
  stages: ConvertedStage[];
  ordinal: { allOrdinals: number[]; byStage: Record<string, number[]> };
  roster: { records: { key: number; op: number; param2: number }[]; ranges: Record<number, [number, number]>; amounts?: { compare?: number[]; add?: number[]; subtract?: number[] } };
}

export function loadRealContent(): RealContent {
  const storySteps = JSON.parse(readFileSync(D + "story_steps.json", "utf8"));
  const ordinalJson = JSON.parse(readFileSync(D + "progress_ordinal.json", "utf8"));
  const rosterJson = JSON.parse(readFileSync(D + "roster_predicate_table.json", "utf8"));
  const bank70 = JSON.parse(readFileSync(D + "bank70_rewards.json", "utf8"));
  const sceneCompletion = JSON.parse(readFileSync(D + "scene/scene_completion.json", "utf8"));
  return {
    storySteps,
    ordinalJson,
    rosterJson,
    sceneCompletion,
    stages: convertStoryStages(storySteps, sceneCompletion),
    ordinal: convertOrdinalLadder(ordinalJson),
    roster: convertRosterTable(rosterJson, bank70.amount_tables),
  };
}

export function loadScene(mapId: string): any {
  return JSON.parse(readFileSync(`web/assets/scenes/${mapId}.json`, "utf8"));
}

export function loadWstagEvents(): Record<string, { id: number; flag_key: string; disasm?: string[] }[]> {
  return JSON.parse(readFileSync("web/assets/events/wstag_events.json", "utf8"));
}

export function loadFieldEncounters(): { screens: Record<string, unknown[]> } {
  return JSON.parse(readFileSync(D + "field_encounters.json", "utf8"));
}

// Build the wireable scripted-battle map from the extracted catalog (screenId resolved by
// name-match, PRE/POST paired) → mapId → ScriptedBattle[]. Only NPC-triggered, resolved,
// paired candidates are wired (player/position-triggered fights need Layer-B zone triggers).
// `wonFlag` is a synthetic bank-0x12 marker, allocated as a deterministic series so rebuilds
// are stable; the hand-verified SCRIPTED_BATTLES overrides win (pins s200 = 0x1200).
export function buildScriptedBattles(
  cat: Record<string, { battle_candidates?: any[] }>,
): Record<string, ScriptedBattle[]> {
  const wired: { stage: string; c: any }[] = [];
  for (const [stage, entry] of Object.entries(cat))
    for (const c of entry.battle_candidates ?? []) {
      // Resolve screenId from (1) the catalog value — which the extractor now fills from the
      // bank-0x74 scripted-battle launcher the pre-fight hook fires (ARENA-C011), the fight's
      // own invocation and therefore authoritative — else (2) a documented boss-party
      // disambiguation in SCREEN_OVERRIDES (keyed by "<stage>:0x<armFlag>"), else (3) a
      // single-entry pool (which is unambiguous). Pools with >1 entry and no override stay
      // null — never invented.
      const pool = c.screenId_pool ?? [];
      const overrideKey = c.armFlag != null ? `${stage}:0x${c.armFlag.toString(16)}` : "";
      const screenId = c.screenId
        ?? SCREEN_OVERRIDES[overrideKey]
        ?? (pool.length === 1 ? pool[0] : null);
      // Wire any battle with a resolvable screenId + POST: NPC-triggered (actor set) OR
      // player/position-triggered (actor null, trigger "player" — e.g. the s415 gondola Bulbmon).
      if (screenId != null && c.postFlagKey != null && (c.actor != null || c.trigger === "player"))
        wired.push({ stage, c: { ...c, screenId } });
    }
  wired.sort((a, b) =>
    (Number(a.stage.slice(1)) - Number(b.stage.slice(1))) || ((a.c.actor ?? -1) - (b.c.actor ?? -1)));
  const out: Record<string, ScriptedBattle[]> = {};
  wired.forEach(({ stage, c }, i) => {
    (out[stage] ??= []).push({
      actor: c.actor ?? null, playerTriggered: c.trigger === "player",
      screenId: c.screenId, armFlag: c.armFlag, wonFlag: 0x1201 + i,
      preFlagKey: c.preFlagKey, postFlagKey: c.postFlagKey,
    });
  });
  for (const [stage, sb] of Object.entries(SCRIPTED_BATTLES)) out[stage] = [sb];
  return out;
}

export function loadScriptedBattles(): Record<string, ScriptedBattle[]> {
  return buildScriptedBattles(JSON.parse(readFileSync(D + "scripted_battles.json", "utf8")));
}
