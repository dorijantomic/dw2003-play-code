import type { Condition, EventRow, Instruction, ScriptProgram, TaggedArg } from "../../engine/core/types.ts";
import type { CompletionData } from "../../engine/systems/scene-completion.ts";
import { DW3_BANK_SCHEME } from "../../engine/dw3/dw3-config.ts";
import { SCRIPTED_BATTLES, type ScriptedBattle } from "./scripted-battles.ts";
import { YESNO_LAUNCHERS } from "../../engine/dw3/ui/native/yesno-launcher.ts";

// ── Native-controller CHILD events ─────────────────────────────────────────────
// A native event-family controller (engine/systems/native-event-families.ts) can call
// start_event() on CHILD events of its own. The eight Yes/No launchers each start one of two
// children the moment a row is confirmed (yesId on Yes, noId on No) — see
// engine/dw3/ui/native/yesno-launcher.ts, which also proves the ids against the original
// overlays (tests/lane-b/yesno-launcher.test.js). Those children have exactly ONE start site:
// the controller. They are NOT started by talking to an NPC, so the 3-bucket classifier must
// not invent an npc-matched OnTalk row for them from their SAY speaker — the SAME defect the
// bank-0x90 talk-launch fix cured (see the `launched` set below and
// docs/research/scripting/talk-event-launcher-bank90-2026-07-28.md). On s220 the invented
// rows were s220.talk.{53,54,55,56,1513,1515,1517}: seven ungated once rows, so the first
// word to either Digimon Lab navi fired the info scene AND its "No" reply, and both navis'
// replies fired in sequence — the operator's "auto-advances into another NPC" and the doubled
// "I understand". Keyed by mapId, children only.
const CONTROLLER_CHILDREN: Map<string, Set<number>> = (() => {
  const m = new Map<string, Set<number>>();
  for (const l of YESNO_LAUNCHERS) {
    const digits = /wstag(\d+)/.exec(l.module)?.[1];
    if (!digits) continue;
    const mapId = `s${digits}`;
    const set = m.get(mapId) ?? new Set<number>();
    for (const id of [l.yesId, l.noId]) if (Number.isFinite(id)) set.add(id);
    m.set(mapId, set);
  }
  return m;
})();

export interface ConvertedStage {
  mapId: string;
  events: EventRow[];
  scripts: ScriptProgram[];
  /** Per event id, the ordered writes its COMPLETION routine makes — the shared system
   *  ported once in engine/systems/scene-completion.ts, this stage's constants as data
   *  (tools/extract_scene_completion.py → web/assets/data/scene/scene_completion.json).
   *  Data, not instructions: the engine runs the list through set_flag's own bank
   *  dispatch and the master story ordinal. */
  completions?: Record<string, CompletionData>;
  /** The events in this stage that a CONVERSATION starts — the bank-0x90 talk launcher's
   *  per-stage start sites (web/assets/data/talk_launch_bindings.json,
   *  tools/extract_talk_launch_bindings.py). Carried so the start is visible in the built
   *  content instead of being only the ABSENCE of a row: each id here is started by an NPC
   *  dialogue state's own `on_close`, behind that state's gate, through the shared launcher
   *  (engine/systems/talk-launch.ts). No event in this list has a hand row. */
  talkLaunched?: number[];
  /** The events in this stage a NATIVE CONTROLLER starts (the Yes/No launchers' two children,
   *  engine/dw3/ui/native/yesno-launcher.ts). Like `talkLaunched`, these get NO classifier row
   *  on purpose: the controller calls start_event on them, so a bare OnTalk row invented from
   *  their SAY speaker would fire them at the wrong time. Carried so the start is visible in
   *  the built content and so the ordinal-owner check still sees them as started. */
  controllerLaunched?: number[];
}

function condFromStep(step: any): Condition | undefined {
  const parts: Condition[] = [];
  if (step.cond_a !== 0xffff) parts.push({ kind: "leaf", leaf: "flag", args: [step.cond_a, step.arg_a] });
  if (step.cond_b !== 0xffff) parts.push({ kind: "leaf", leaf: "flag", args: [step.cond_b, step.arg_b] });
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : { kind: "all", children: parts };
}

// Build an event `if` from one conjunction of flag leaves. Each [flagId, expected] is a `flag`
// leaf (bank 0x60 = ordinal equality, 0x40 = stored bit, etc.); the conjunction reproduces one
// route through the stage-entry arrival chain.
//
// Bank 0x70 (roster predicate) party-field queries are dispatched by op (roster_predicate_table).
// The engine models only SOME ops: op-0x30 (ordinal range) plus the decoded `semantics` kinds in
// MODELED_SEMANTICS below (pack selector, collection AND, obtained-partner slot tests, bank-0x1c/
// 0x10 stored-bit tallies, the always-true op-0x50 action). Gating on an
// UN-modelled op returns false forever → the auto-cutscene dead-locks (empty room). So keep a 0x70
// leaf only when its predicate is engine-modelled; drop the rest. The full decode stays in
// arrival_candidates.json. `isModeled0x70(id)` is built from the roster predicate table.
function condFromGate(
  conds: [number, number][] | undefined,
  isModeled0x70: (id: number) => boolean,
): Condition | undefined {
  const usable = (conds ?? []).filter(([id]) => ((id >> 8) & 0xfe) !== 0x70 || isModeled0x70(id));
  if (!usable.length) return undefined;
  const parts: Condition[] = usable.map(([id, exp]) => ({ kind: "leaf", leaf: "flag", args: [id, exp] }));
  return parts.length === 1 ? parts[0] : { kind: "all", children: parts };
}

// ── The stage-entry arrival dispatcher: the SHARED system, each place's chain as DATA ──
// The decision procedure is ported once, in engine/systems/scene-arrival.ts; what each of the 76
// overlays supplies is its own chain, which tools/extract_arrival_candidates.py lifts into
// web/assets/data/scene/arrival_candidates.json and the oracle in tests/lane-b/scene-arrival.test.js
// proves against the original overlays. So this file never re-derives the chain: it reads the
// chain and emits one row per candidate.
//
// A stage's entry dispatcher starts AT MOST ONE event per arrival: it walks its branch chain and
// the FIRST candidate whose whole conjunction holds wins. That is reproduced by EMISSION ORDER, not
// by a hand-written exclusion per pair: the rows go out in chain order at one shared priority, and
// EventManager.raise sorts by priority descending with a stable sort and takes the first row whose
// `if` holds. So chain order alone picks the winner, and two candidates of one beat can never both
// fire — which is what the old hand row `DISPATCHER_CHAIN_CONDS` (s305: 893 needs 0x4057 == 1,
// because 890 needs it clear) existed to patch up by hand.
export interface ArrivalCandidateData {
  /** The id the original passes to start_event (0x800853f8). */
  event: number;
  /** One conjunction per route from the chain's entry to this candidate; ANY route reaching it
   *  selects it (s305's 893 arrives both with and without the 0x4057 test passed). */
  paths: readonly (readonly [number, number][])[];
}
export interface ArrivalChainData {
  tick?: string;
  /** Which phase band the gate object tests its chain on (`reset` / `phase1`). */
  phase_gate?: { band?: string };
  candidates: readonly ArrivalCandidateData[];
}

// A candidate's engine `if`: the DISJUNCTION of its routes, each an AND of `flag` leaves with an
// un-modellable bank-0x70 predicate leaf dropped (see condFromGate). A candidate all of whose
// routes lost a leaf keeps the rest of its conjunction, for the same reason: a predicate the engine
// cannot evaluate is not evidence against the scene.
function condFromChain(
  c: ArrivalCandidateData,
  isModeled0x70: (id: number) => boolean,
): Condition | undefined {
  const routes = c.paths
    .map(p => condFromGate(p as [number, number][], isModeled0x70))
    .filter((x): x is Condition => x !== undefined);
  if (!routes.length) return undefined;
  return routes.length === 1 ? routes[0]! : { kind: "any", children: routes };
}

export function convertStoryStages(storySteps: any, sceneCompletion?: {
  stages?: Record<string, { events: Record<string, CompletionData> }>;
}): ConvertedStage[] {
  const out: ConvertedStage[] = [];
  for (const [n, st] of Object.entries<any>(storySteps.stages)) {
    const mapId = "s" + n; const events: EventRow[] = []; const scripts: ScriptProgram[] = [];
    for (const step of st.steps ?? []) {
      if (step.op === 8) {
        const evId = step.params[0];
        const ifc = condFromStep(step);
        const row: EventRow = { id: `${mapId}.step.evt${evId}`, on: "OnStep", do: `${mapId}.event.${evId}.script` };
        if (ifc) row.if = ifc;
        events.push(row);
        // the "script" the row runs = StartEvent(evId) then its oncomplete
        scripts.push({ id: `${mapId}.event.${evId}.script`, program: [{ op: "StartEvent", args: [{ t: "INT", v: evId }] }] });
      }
    }
    // An event's completion routine is NOT converted here. It is the shared system, ported
    // once in engine/systems/scene-completion.ts, and each event's ordered write list is data
    // (web/assets/data/scene/scene_completion.json, lifted by
    // tools/extract_scene_completion.py; proven against the original routines in
    // tests/lane-b/scene-completion.test.js). GameEngine.completeEvent runs that list through
    // set_flag's own bank dispatch — bank 0x74 to the scripted-battle launcher, bank 0x70 to
    // the roster action table (content.roster), 0x7c inert, the rest stored — so this file
    // neither emits SetFlag for the routine's writes nor needs a list of which banks it may
    // store. That allow-list and the one hard-coded bank-0x70 id are gone.
    const completions = sceneCompletion?.stages?.[mapId]?.events;
    out.push(completions ? { mapId, events, scripts, completions } : { mapId, events, scripts });
  }
  return out;
}

// ── Full stage conversion: OnStep (steps) + OnEnterMap/OnTalk (wstag) + scripted battles ──
// Produces the engine's per-stage event tables. Reads the already-extracted JSON only.
//   storySteps   = story_steps.json          (op-8 steps → OnStep; events[].sets → on_complete)
//   wstagEvents  = wstag_events.json         (mapId → [{id, flag_key, disasm}] — the cutscenes)
//   fieldEnc     = field_encounters.json     ({screens}) — validates scripted-battle screens
export interface ConvertStagesInput {
  storySteps: any;
  wstagEvents: Record<string, { id: number; flag_key: string; disasm?: string[] }[]>;
  fieldEnc: { screens: Record<string, unknown[]> };
  // mapId → scripted story battles to wire (PRE/battle/POST). Defaults to the static
  // hand-verified SCRIPTED_BATTLES (s200 only); real callers pass the full resolved
  // catalog via loadScriptedBattles(). A stage may host more than one battle (e.g. s490).
  scriptedBattles?: Record<string, ScriptedBattle[]>;
  // Each stage's event completion ROUTINE as data (web/assets/data/scene/scene_completion.json,
  // lifted by tools/extract_scene_completion.py). The engine runs these through
  // engine/systems/scene-completion.ts, so nothing here converts them into instructions.
  sceneCompletion?: { stages?: Record<string, { events: Record<string, any> }> };
  // The bank-0x90 TALK launcher's per-stage start sites
  // (web/assets/data/talk_launch_bindings.json, tools/extract_talk_launch_bindings.py):
  // mapId → one record per NPC dialogue state whose `on_close` writes bank 0x90, with the
  // event the resident table names for that bit. This is the DECODED start of those scenes,
  // and it replaces the disassembly guess the 3-bucket classifier used to make
  // (`eventActor`): an `OnTalk` row matched to a bare npc id fires the first time you speak
  // to ANY record carrying that id, at ANY story step — which for the seven scenes that
  // CLOSE A STORY BEAT meant the story jumped ahead from anywhere on the disc, and which
  // also SUPPRESSED the spoken line whose on_close is the very write that starts the scene
  // (the talk handler skips the box when the row presented a cutscene). An event the
  // launcher starts therefore gets NO row: the shared launcher starts it, on the dialogue's
  // own close, behind the dialogue's own gate.
  talkLaunch?: { stages?: Record<string, { event: number; in_stage?: boolean }[]> };
  // item-acquisition grants (tools/extract_item_grants.py, and the native overlay pass in
  // tools/extract_native_item_grants.py): the SAME disc fact the engine now gets from the
  // completion routine itself — `sceneCompletion` above carries each event's ordered
  // set_flag list, and the collection banks in it run through `applySetFlag`'s 0x80–0x8E
  // arm (F0x800161d8) into the bag. Nothing is converted from these rows any more, so they
  // are accepted and ignored rather than emitted as a second GiveItem for the same copy.
  itemGrants?: { stage: string; event_id: string | number; item_id: number }[];
  // talk-acquisition grants (tools/extract_talk_grants.py): an NPC grants an item by writing a
  // collection-bank flag in its dialogue-state `on_close` table (the same possession semantics as
  // itemGrants, but the give lives on the NPC talk, not a wstag event). Each emits a once OnTalk
  // give event matched to the npc, gated by the dialogue-state `gate`, that does GiveItem(item)
  // (+ SetFlag for any non-collection on_close sets). This is the general home for all ~220
  // talk-gives game-wide — incl. the Tricky-Guilmon Blue Cards (398/399) and DEKnowledge (17).
  talkGrants?: {
    stage: string; npc_id: number; item_id: number; flag_id: number;
    gate?: { id: number; expected: number }[];
    also_sets?: { id: number; val: number }[];
  }[];
  // Per-actor ptrB dialogue-state flag PRODUCERS (tools/extract_npc_flag_sets.py): an actor's
  // selected triple applies a stored-bank set_ptr table on stage entry (invisible trigger-actors,
  // e.g. the gondola reject npc63 → 0x1c46) or on talk-close (visible NPCs). This is the general
  // home for the flag class neither scan_flag_setters (callsite-only) nor talkGrants (collection
  // gives only) capture — the producers a prior session wrongly fabricated for the Blue-Card
  // second hunt (0x1c45/0x1c46/0x1c47) actually live here, decoded from the set_ptr tables.
  flagSets?: {
    stage: string; npc_id: number; slot: number; dialogue_id: number;
    trigger: "talk" | "enter";
    gate: [number, number][]; sets: [number, number][];
  }[];
  // Decode table (tools/engine-convert/decode-table.json): assigns a trigger to events the
  // 3-bucket classifier would otherwise DROP — exit-gated cutscenes (gondola etc.) and
  // native-handler events. This is the single home for everything decoded by hand. With
  // `strict`, any dropped event WITHOUT a row throws (no silent drops — the systemic guarantee).
  decodeTable?: DecodeTable;
  // The stage-entry ARRIVAL DISPATCHER's per-place chains (web/assets/data/scene/
  // arrival_candidates.json, tools/extract_arrival_candidates.py): mapId → the entry object's own
  // ordered candidate chain, one per place, each candidate carrying every route that reaches it.
  // This is the decode that says "the STAGE ENTRY OBJECT starts this event, and only when this
  // conjunction holds" — it replaces the two older gate tables (auto_event_gates.json and
  // beat_event_gates.json), which covered 62 of the 131 candidates between them because both read
  // a TAIL SLICE of the chain rather than the chain. One row per candidate is emitted, in chain
  // order, and nothing else may emit a second route to the same event.
  arrivalChains?: { stages?: Record<string, ArrivalChainData | ArrivalChainData[]> };
  // Bank-0x70 predicate dispatch records (roster_predicate_table.json). Used to decide which 0x70
  // gate conds the engine can evaluate (op-0x30 range, plus every decoded `semantics` kind the
  // dw3-config bank-0x70 handler resolves) vs must drop.
  rosterRecords?: { key: number; op: number; param2: number; semantics?: { kind: string } | null }[];
  // Bank-0x70 REWARD/ACTION table (tools/extract_bank70_rewards.py, bank70_rewards.json): the
  // SAME table as rosterRecords but read as a set_flag WRITE dispatch. Only opcode 0x20 arg0==1
  // (CURRENCY ADD) records are acted on: their flag_id -> BIT amount feeds both moneyGrants below
  // and any also_sets bank-0x70 write that resolves to an ADD (talkGrants/flagSets also_sets).
  bank70AddByFlagId?: Record<number, number>;
  // NPC/search-point money grants (tools/extract_bank70_money_grants.py): a dialogue-state
  // on_close write of a bank-0x70 CURRENCY-ADD flag = "you get N BIT", the money equivalent of
  // talkGrants' item GiveItem. Unlike talkGrants this does NOT require a co-occurring item write
  // (e.g. the s235 Asuka Inn shelf search point grants BIT only). Each emits a once OnTalk give
  // event gated by the dialogue-state `gate`, running AddMoney(amount) (+ any also_sets classified
  // the same way as talkGrants: collection-bank -> GiveItem, stored-bank -> SetFlag, other bank-0x70
  // ADD -> AddMoney; anything else is left unmodeled and dropped).
  moneyGrants?: {
    stage: string; npc_id: number; flag_id: number; amount: number;
    gate?: { id: number; expected: number }[];
    also_sets?: { id: number; val: number }[];
  }[];
  // NPC partner grants (tools/extract_bank70_partner_grants.py): a dialogue-state on_close write
  // of a bank-0x70 opcode-0x10 case-3 flag = `roster_owned[slot] = slot+3`, i.e. "you now have
  // this partner Digimon". Same event shape as moneyGrants, running GrantPartner(slot). These are
  // the ONLY emitter of GrantPartner — classifyAlsoSet deliberately drops bank-0x70 case-3 writes
  // so a state that grants an item AND a partner does not emit the partner twice.
  partnerGrants?: {
    stage: string; npc_id: number; flag_id: number; slot: number;
    gate?: { id: number; expected: number }[];
    also_sets?: { id: number; val: number }[];
  }[];
  strict?: boolean;
}

// One row per formerly-dropped event, keyed decodeTable[mapId][String(eventId)].
//   OnExit : exit-gated cutscene. `match` binds it to a scene exit (e.g. {warp:"gondola"});
//            `priority`/`if` disambiguate sibling branches (the engine picks the top passing one).
//   Native : a compiled-MIPS handler (script_offset==0). `handler` names the DW3 native-op
//            registry entry; `args` are passed through. The cutscene's warp (if any) lives in
//            the handler or the event bytecode, not here.
// `if` is a compact AND-list of leaves: [["flag", id, expected], ...] → expanded to a Condition.
export interface DecodeRow {
  // "None" = decoded-but-inert: the event is acknowledged (so --strict passes) but emits NO
  // engine event. Used for events whose effect is already provided elsewhere (maze trap-pads via
  // gen_trap_pads data; ambient scene-controllers that gate nothing) or that are currently
  // dropped and left so deliberately. `note` documents why.
  trigger: "OnExit" | "Native" | "None";
  match?: Record<string, number | string>;
  priority?: number;
  if?: (string | number)[][];
  once?: boolean;
  handler?: string;
  args?: number[];
  // On-complete flag-sets [[flagId, value], ...] — reconstructs a native on_complete callback
  // the extractor couldn't decode (the gondola controller's reject-branch flag-set, etc.).
  // Emitted as `${mapId}.event.${evId}.oncomplete`, which the engine runs when the event ends.
  sets?: [string | number, number][];
  // On-complete story-ordinal advance (bank 0x60 is virtual, not a SetFlag). Use when the event
  // warps to a stage whose beat differs from the source's ladder (e.g. gondola ride s410→s440
  // = beat 7), since completeEvent only advances along the SOURCE stage's ladder.
  advanceOrdinal?: number;
  note?: string;
}
export type DecodeTable = Record<string, Record<string, DecodeRow>>;

// Expand the compact AND-list of leaves into a Condition (single leaf stays a leaf).
function compileDecodeIf(rows: (string | number)[][]): Condition {
  const leaves: Condition[] = rows.map(r => ({ kind: "leaf", leaf: String(r[0]), args: r.slice(1) }));
  return leaves.length === 1 ? leaves[0]! : { kind: "all", children: leaves };
}

// Emit the decode-table-classified event + its run script. OnExit runs the event bytecode
// (StartEvent → host plays the cutscene incl. its HANDOFF warp). Native runs the named handler.
// An event the stage-entry ARRIVAL CHAIN owns never reaches here: its one row is the arrival row
// (see condFromChain), because in the original the entry object starts it and nothing else does.
function emitDecodedEvent(stage: ConvertedStage, mapId: string, evId: number, row: DecodeRow): void {
  if (row.trigger === "None") return;  // decoded-but-inert: acknowledged, no engine event emitted
  const on: string = row.trigger;
  let doId: string;
  if (row.trigger === "Native") {
    doId = `${mapId}.native.${evId}.script`;
    if (!stage.scripts.some(s => s.id === doId))
      stage.scripts.push({ id: doId, program: [{
        op: "Native",
        args: [{ t: "STR", v: row.handler ?? "" }, ...(row.args ?? []).map(v => ({ t: "INT", v }))] as TaggedArg[],
      }] });
  } else {
    doId = ensureEventScript(stage, mapId, evId);  // [StartEvent(evId)]
  }
  const kind = on === "OnExit" ? "exit" : on === "OnEnterMap" ? "auto" : "native";
  const ev: EventRow = { id: `${mapId}.${kind}.${evId}`, on, do: doId };
  if (row.match) ev.match = row.match;
  if (row.priority != null) ev.priority = row.priority;
  if (row.if && row.if.length) ev.if = compileDecodeIf(row.if);
  if (row.once) ev.once = true;
  stage.events.push(ev);
  // Reconstructed on_complete flag-sets (decoded native callback the extractor missed). The
  // engine runs `${mapId}.event.${evId}.oncomplete` when the event ends (completeEvent).
  if (row.sets && row.sets.length) {
    const ocId = `${mapId}.event.${evId}.oncomplete`;
    let oc = stage.scripts.find(s => s.id === ocId);
    if (!oc) { oc = { id: ocId, program: [] }; stage.scripts.push(oc); }
    for (const [id, val] of row.sets)
      oc.program.push({ op: "SetFlag", args: [{ t: "FLAGID", v: Number(id) }, { t: "INT", v: val }] as TaggedArg[] });
  }
  if (row.advanceOrdinal != null) {
    const ocId = `${mapId}.event.${evId}.oncomplete`;
    let oc = stage.scripts.find(s => s.id === ocId);
    if (!oc) { oc = { id: ocId, program: [] }; stage.scripts.push(oc); }
    oc.program.push({ op: "AdvanceOrdinal", args: [{ t: "INT", v: row.advanceOrdinal }] as TaggedArg[] });
  }
}

function flagLeaf(id: number, expected: number): Condition {
  return { kind: "leaf", leaf: "flag", args: [id, expected] };
}

// Ensure `${mapId}.event.${evId}.script` = [StartEvent(evId)] exists (idempotent).
function ensureEventScript(stage: ConvertedStage, mapId: string, evId: number): string {
  const id = `${mapId}.event.${evId}.script`;
  if (!stage.scripts.some(s => s.id === id))
    stage.scripts.push({ id, program: [{ op: "StartEvent", args: [{ t: "INT", v: evId }] }] });
  return id;
}

export function convertStages(input: ConvertStagesInput): {
  stages: ConvertedStage[];
  flagKeys: Record<string, Record<number, string>>;
} {
  // OnStep rows + the step scripts + each event's completion writes (data, not instructions).
  const stages = convertStoryStages(input.storySteps, input.sceneCompletion);
  const byMap = new Map(stages.map(s => [s.mapId, s]));
  const flagKeys: Record<string, Record<number, string>> = {};
  // A bank-0x70 gate flag is engine-evaluable iff its predicate record is a modelled op:
  // op-0x30 (ordinal range) or one of the decoded `semantics` kinds the engine resolves.
  // Kept in sync with the switch in dw3-config.ts registerDw3Flags — anything not listed
  // there evaluates to false for both polarities, so the gate must be dropped instead.
  const MODELED_SEMANTICS = new Set([
    "pack_selector_equals", "collection_all", "roster_owned", "roster_not_owned",
    "every_slot_owned", "stored_bits_all_set", "stored_bit_tally", "object_action",
  ]);
  const rosterByKey = new Map((input.rosterRecords ?? []).map(r => [r.key, r]));
  const isModeled0x70 = (id: number): boolean => {
    const rec = rosterByKey.get(id & 0x1ff);
    if (!rec) return false;
    if ((rec.op & 0xf0) === 0x30) return true;
    return MODELED_SEMANTICS.has((rec as any).semantics?.kind);
  };
  const stepStages = input.storySteps.stages ?? {};
  // Collected rather than thrown one-at-a-time, so a decode-table gap is reported
  // as the whole list to fill in instead of one event per rebuild.
  const unclassified: string[] = [];
  const scriptedBattles = input.scriptedBattles
    ?? Object.fromEntries(Object.entries(SCRIPTED_BATTLES).map(([k, v]) => [k, [v]]));

  for (const [mapId, wEvents] of Object.entries(input.wstagEvents)) {
    let stage = byMap.get(mapId);
    if (!stage) { stage = { mapId, events: [], scripts: [] }; byMap.set(mapId, stage); stages.push(stage); }
    flagKeys[mapId] ??= {};

    const ss = stepStages[mapId.replace(/^s/, "")] ?? {};
    const ssEvents: any[] = ss.events ?? [];
    // flag_key is NOT unique: a stage may give a whole family of events flag_key 0
    // and tell them apart only by id (s740/s741's 17 records, 16 of them fire traps).
    // Both maps below therefore key on the event id wherever story_steps knows it,
    // and fall back to flag_key only for a stage whose ids genuinely differ.
    const evIdByFlagKey = new Map<string, number>(ssEvents.map(e => [String(e.flag_key), e.event_id]));
    const ssEventIds = new Set<number>(ssEvents.map(e => e.event_id));
    const stepEvIds = new Set<number>((ss.steps ?? []).filter((s: any) => s.op === 8).map((s: any) => s.params[0]));
    const stepFlagKeys = new Set<string>(ssEvents.filter(e => stepEvIds.has(e.event_id)).map(e => String(e.flag_key)));

    const sbs = scriptedBattles[mapId] ?? [];
    const battleFlagKeys = new Set<string>(sbs.flatMap(b => [b.preFlagKey, b.postFlagKey]));
    // ── This place's GATE OBJECTS (the per-place start dispatchers, ported) ────────────────
    // One row per candidate, in chain order, emitted BEFORE the per-event loop below so the
    // rows land in `stage.events` in chain order: EventManager.raise sorts by priority
    // descending with a STABLE sort and takes the first row whose `if` holds, so chain order
    // alone decides the winner and no candidate needs a hand-written exclusion. Every route to a
    // candidate is the disjunction of its paths, so a scene the original can reach two ways
    // (s305's 893) is one row, not two.
    //
    // A place can install SEVERAL gate objects (s795 and s800 each have two: the stage's entry
    // object on the reset band, plus a second whose band is `phase1`). All of them are emitted,
    // entry object first, because that is the order the overlay allocates them in and so the
    // order the disc ticks them. `arrivalBand` carries the band so a later raise in the same
    // visit can skip the reset band's row (asked once per field load) while still letting the
    // phase1 object keep testing — which is what the disc does, it re-tests every frame until
    // its phase advances past 1.
    const chainRaw = (input.arrivalChains?.stages ?? {})[mapId];
    const chains: readonly ArrivalChainData[] = chainRaw
      ? (Array.isArray(chainRaw) ? chainRaw : [chainRaw]).filter(Boolean)
      : [];
    const chain = chains[0];
    const arrivalOf = (evId: number | string | undefined): ArrivalCandidateData | undefined => {
      if (evId == null) return undefined;
      for (const ch of chains) {
        const hit = ch.candidates.find(c => c.event === Number(evId));
        if (hit) return hit;
      }
      return undefined;
    };
    for (const ch of chains) {
    for (const c of ch.candidates ?? []) {
      // start_event (fieldstg F0x800853f8) walks the CURRENT stage's 20-byte event table and, on
      // reaching the 0xffffffff terminator, falls out WITHOUT filling the runner: an id this
      // stage's table does not own starts nothing, however loudly the overlay calls it. s756's
      // candidate 0 is that case — pro/wstag756.s:48 calls start_event(352) but s756's table holds
      // 910 and 911 only, so the branch is silent on the disc. One shared rule, not a per-stage
      // exception: no record in this stage's table → no row.
      if (!wEvents.some(e => e.id === c.event)) continue;
      ensureEventScript(stage, mapId, c.event);
      // `arrivalChain: true` marks the row as a gate object's OWN dispatcher row. The original
      // asks that chain once per field load — the gate object's phase counter only leaves its
      // band by advancing to the next phase, its gate then returns outside it, and nothing can
      // put it back (all 51 set_phase (+0x28) call sites in the 76 arrival-owning overlays pass
      // 1, 2 or 3, and a phase word cannot pass 3 by incrementing because the object driver
      // destroys the object when it reads 3 (exe/fns.s:8860-8864 → 0x80018204 calls the +0x4c
      // destructor and returns 0). A later raise in the same visit must skip these rows.
      // See web/engine-bridge.js `rechain`, which honours `arrivalBand`.
      const row: EventRow = { id: `${mapId}.auto.${c.event}`, on: "OnEnterMap", do: `${mapId}.event.${c.event}.script`, once: true, arrivalChain: true };
      if (ch.phase_gate?.band && ch.phase_gate.band !== "reset") row.arrivalBand = ch.phase_gate.band;
      const gate = condFromChain(c, isModeled0x70);
      if (gate) row.if = gate;
      stage.events.push(row);
    }
    }

    // ── This place's TALK-LAUNCH start sites (the bank-0x90 launcher, ported) ─────────────
    // The event ids a conversation in this stage starts. `in_stage: false` is excluded: on the
    // disc start_event walks this stage's own table and finds nothing, so the write starts no
    // scene here (three shipped bindings) and must not retire the classifier's row for whatever
    // else does start that id.
    const launched = new Set<number>(
      (input.talkLaunch?.stages?.[mapId] ?? [])
        .filter(r => r.in_stage !== false)
        .map(r => Number(r.event)),
    );
    // The child events a native controller in this stage starts (CONTROLLER_CHILDREN above).
    const controllerChildren = CONTROLLER_CHILDREN.get(mapId) ?? new Set<number>();

    for (const e of wEvents) {
      const fk = String(e.flag_key);
      const canonId = ssEventIds.has(e.id) ? e.id : (evIdByFlagKey.get(fk) ?? e.id);
      flagKeys[mapId]![canonId] = fk;
      // The stage-entry chain owns this event: its ONE row is the arrival row emitted above, so
      // nothing else may start it (no talk row, no decode-table row, no scripted-battle row).
      const arrival = arrivalOf(e.id);
      if (arrival) {
        flagKeys[mapId]![e.id] = fk;
        const dr = input.decodeTable?.[mapId]?.[String(canonId)];
        // A decode row for a chain candidate may not carry reconstructed on_complete effects:
        // the chain row already owns the scene, and silently dropping `sets`/`advanceOrdinal`
        // would lose decoded data. Fail the build instead.
        if (dr && (dr.sets?.length || dr.advanceOrdinal != null))
          throw new Error(`${mapId} id ${canonId}: the arrival chain owns this event but its decode-table row carries on_complete effects — port them onto the arrival row`);
        continue;
      }
      // A HAND-DECODED row wins over the generic classifier. A decoded event can also be an
      // op-8 step target while needing a non-OnStep trigger: s410 event 90 starts on position
      // from the step program, but the gondola gate must fire it on OnExit. A trigger:"None"
      // row is an explicit decoded-but-inert acknowledgement (emits nothing). Both used to
      // work only while the stage's event list was empty; the catalog fallback fills it, so
      // the decode row must be consulted before the stepFlagKeys skip below.
      const decodeRow = input.decodeTable?.[mapId]?.[String(canonId)];
      if (decodeRow) { emitDecodedEvent(stage, mapId, canonId, decodeRow); continue; }
      // OnStep — already emitted by convertStoryStages. Keyed on flag_key, NOT on stepEvIds.
      if (stepFlagKeys.has(fk)) continue;
      if (battleFlagKeys.has(fk)) continue;            // scripted battle — emitted below
      // A CONVERSATION starts this event: an NPC dialogue state's own `on_close` writes bank
      // 0x90 with a bit whose resident table entry names this id. The shared launcher
      // (engine/systems/talk-launch.ts) starts it the moment that box closes, behind that
      // dialogue state's own gate — the decoded start, from data
      // (web/assets/data/talk_launch_bindings.json). So the generic classifier must NOT also
      // place it on an npc-matched OnTalk row: that row fires at the first conversation with
      // ANY record carrying the same npc id, at ANY story step, and because it presents a
      // cutscene the talk handler never opens the spoken line whose on_close is the write.
      if (launched.has(canonId)) {
        (stage.talkLaunched ??= []).push(canonId);
        // The SCRIPT still has to exist: the launcher hands start_event an id, and the
        // engine runs that event's bytecode through the same `${mapId}.event.<id>.script`
        // program every other start site uses. Only the ROW is retired.
        ensureEventScript(stage, mapId, canonId);
        continue;
      }
      // A native CONTROLLER starts this event as one of its own children (the Yes/No
      // launchers' yesId/noId). Same rule as a conversation-launched scene: the controller is
      // the start site, so no classifier row. Without this the seven s220 navi events each got
      // an ungated `s220.talk.*` row and the first word to a navi ran the info scene plus its
      // "No" reply (and both navis' replies), which is the reported loop.
      if (controllerChildren.has(canonId)) {
        (stage.controllerLaunched ??= []).push(canonId);
        ensureEventScript(stage, mapId, canonId);
        continue;
      }
      const disasm = e.disasm ?? [];
      if (puppetsPlayer(disasm)) {
        ensureEventScript(stage, mapId, canonId);
        // Auto-cutscene: the scene moves the player, so it plays by itself. NOT dispatcher-started
        // (the chain above owns nothing for this id), so the original starts it from somewhere
        // else — a position step, an NPC — and the rows below decide which.
        const row: EventRow = { id: `${mapId}.auto.${canonId}`, on: "OnEnterMap", do: `${mapId}.event.${canonId}.script`, once: true };
        stage.events.push(row);
      } else {
        const actor = eventActor(disasm);
        if (actor != null) {
          ensureEventScript(stage, mapId, canonId);
          // Not dispatcher-started: the actor it names is who hands it over.
          const row: EventRow = { id: `${mapId}.talk.${canonId}`, on: "OnTalk", match: { npc: actor }, do: `${mapId}.event.${canonId}.script`, once: true };
          stage.events.push(row);
        } else if (input.strict) {
          // The 3-bucket classifier can't place this event (it puppets only player/partner, or is
          // a native handler) and the decode table has no row: strict mode forbids silent drops.
          unclassified.push(`${mapId} id ${canonId} (fk ${fk})`);
          // non-strict: omit (legacy behaviour) — convert.ts logs the count until the table is complete.
        }
      }
    }

    // A stage may host >1 scripted battle (e.g. s490); suffix rows per actor so ids stay unique.
    sbs.forEach((sb, idx) => {
      const party = input.fieldEnc.screens?.[String(sb.screenId)];
      if (!party || !party.length)
        throw new Error(`scripted battle ${mapId}: screen ${sb.screenId} has no field_encounters party`);
      const preId = evIdByFlagKey.get(sb.preFlagKey) ?? wEvents.find(e => String(e.flag_key) === sb.preFlagKey)?.id;
      const postId = evIdByFlagKey.get(sb.postFlagKey) ?? wEvents.find(e => String(e.flag_key) === sb.postFlagKey)?.id;
      if (preId == null || postId == null)
        throw new Error(`scripted battle ${mapId}: PRE/POST event not found (${sb.preFlagKey}/${sb.postFlagKey})`);
      flagKeys[mapId]![preId] = sb.preFlagKey; flagKeys[mapId]![postId] = sb.postFlagKey;
      ensureEventScript(stage, mapId, preId); ensureEventScript(stage, mapId, postId);
      // Trigger: the beat's OPENING event decides where the whole fight lives. Started by the
      // stage-entry arrival chain → OnEnterMap: the scene plays by itself on arrival, and the
      // bridge re-raises that same entry trigger after the PRE's cutscene (for the fight) and
      // again once the fight is won (the disc rebuilds the field, so the chain runs afresh —
      // see web/engine-bridge.js `arrive`). Otherwise the PRE's own trigger:
      // player/position-triggered (no actor) → OnEnterMap if it puppets the player, else OnStep;
      // NPC-started → OnTalk matched to the actor.
      const preDisasm = wEvents.find(e => String(e.flag_key) === sb.preFlagKey)?.disasm ?? [];
      const chainPre = arrivalOf(preId), chainPost = arrivalOf(postId);
      const on = chainPre
        ? "OnEnterMap"
        : sb.playerTriggered ? (puppetsPlayer(preDisasm) ? "OnEnterMap" : "OnStep") : "OnTalk";
      // A player-triggered descriptor may retain `actor` as cutscene metadata (for
      // example s200 keeps Genji=57), and an entry-triggered battle has no NPC to name, so
      // OnEnterMap/OnStep must not receive an NPC match or the row can never match its
      // trigger parameters.
      const match = on === "OnTalk" && !sb.playerTriggered && sb.actor != null ? { npc: sb.actor } : undefined;
      // Unique row suffix: actor when present, else the armFlag (player-triggered battles share no npc).
      const tagKey = sb.actor != null ? sb.actor : `x${sb.armFlag.toString(16)}`;
      const tag = sbs.length > 1 ? `.${tagKey}` : "";
      const battleScriptId = `${mapId}.sb.battle${tag}.script`;
      stage.scripts.push({ id: battleScriptId, program: [
        { op: "StartBattle", args: [{ t: "INT", v: sb.screenId }, { t: "FLAGID", v: sb.wonFlag }] },
      ] });
      const row = (suffix: string, priority: number, extra: Partial<EventRow>): EventRow => {
        const r: EventRow = { id: `${mapId}.sb.${suffix}${tag}`, on, priority, ...extra } as EventRow;
        if (match) r.match = match;
        return r;
      };
      // The three rows model ONE dispatcher-selected story beat spread over three entries, and each
      // of them is emitted ONLY when the arrival chain does not already own that scene: the chain
      // is the original's own route to the beat's opening and closing scenes, so emitting a second
      // row for either would be two routes to one scene (and the closing row on the NPC's talk is
      // what made 20 beats' aftermath unreachable for a player who never spoke to that character).
      //   PRE   — the beat's opening scene. When the chain owns it, the arrival row above is its
      //           one row; here it keeps only its once-guard (no gate is ever invented).
      //   fight — armed & not won. Always emitted: it is the walker's stand-in for the bank-0x74
      //           launcher the PRE's completion writes in the original (s756: 0x7400 at
      //           pro/wstag756.s:144, arm flag 0x405B at :79-92), so it must follow the PRE on the
      //           PRE's own trigger. `armed` can only be set by that PRE, which is why the arm
      //           flag is the whole guard.
      //   POST  — the beat's closing scene, only when the chain does not own it (it starts from
      //           the NPC/step/exit the original starts it from). armed & won, once.
      const armedUnwon: Condition = { kind: "all", children: [flagLeaf(sb.armFlag, 1), flagLeaf(sb.wonFlag, 0)] };
      const armedWon: Condition = { kind: "all", children: [flagLeaf(sb.armFlag, 1), flagLeaf(sb.wonFlag, 1)] };
      stage.events.push(row("battle", 2, { if: armedUnwon, do: battleScriptId }));
      if (!chainPre) stage.events.push(row("pre", 1, { once: true, do: `${mapId}.event.${preId}.script` }));
      if (!chainPost) stage.events.push(row("post", 3, { once: true, if: armedWon, do: `${mapId}.event.${postId}.script` }));
    });
  }

  // ── Item grants: NOT converted here. ──
  // A finished scene's collection write is `set_flag(0x80NN, 1)` inside its own completion
  // routine, and that routine already rides the stage as data (`sceneCompletion`), which
  // `GameEngine.completeEvent` runs through `runSceneCompletion` → `applySetFlag`'s
  // 0x80–0x8E arm → the bag. This used to be a second home: `input.itemGrants`
  // (item_grants.json + native_item_grants.json) appended `GiveItem(item_id)` to the same
  // event's `oncomplete` program, so the fact existed twice and the item landed after the
  // whole routine instead of at the write's own place in it.

  // Two dialogue states of the same actor can hand over the SAME thing under DIFFERENT
  // conditions — the endgame partner handovers on s970/s971 each carry three, and seven of
  // the item hand-overs carry two. Keying the emitted script on (stage, npc, thing) alone
  // dropped every condition after the first, so those hand-overs could only ever fire down
  // one of their paths. Dedup on the gate and the effects instead, normalised so that a gate
  // listing the same conditions in a different order (the s235 money pair) still collapses.
  // The first variant keeps the plain id, so existing event ids do not move.
  const variantIds = new Map<string, string>();
  const norm = (pairs: [number, number][]): string =>
    pairs.map(([a, b]) => `${a}:${b}`).sort().join(",");
  const variantScriptId = (base: string, gate: [number, number][], effects: [number, number][]):
      string | null => {
    const tag = `${norm(gate)}|${norm(effects)}`;
    const seen = variantIds.get(base);
    if (seen === undefined) { variantIds.set(base, tag); return base; }
    if (seen === tag) return null;                       // a true duplicate row
    let n = 2, id = `${base}.v${n}`;
    while (variantIds.has(id) && variantIds.get(id) !== tag) id = `${base}.v${++n}`;
    if (variantIds.get(id) === tag) return null;
    variantIds.set(id, tag);
    return id;
  };

  // Classify a talkGrants/moneyGrants `also_sets` entry into an engine instruction, or drop it
  // (unmodeled). Shared by both loops below so a co-occurring item-give AND money-give AND
  // story-flag-set on the same dialogue-state on_close all resolve consistently.
  const bank70Add = input.bank70AddByFlagId ?? {};
  const classifyAlsoSet = (s: { id: number; val: number }): Instruction | undefined => {
    const bank = (s.id >> 8) & 0xfe;
    // Storage banks are exactly 0x80..0x8E (set_flag dispatcher F0x800165ac:
    // `bank - 0x80 < 0xF` -> collection handler F0x800161d8). 0x90/0x92/0x94 are
    // UI launchers (save/shop, ?, STGTRAIN gym), never possession writes.
    if (bank >= 0x80 && bank <= 0x8e)
      return { op: "GiveItem", args: [{ t: "INT", v: s.id & 0x1ff }] as TaggedArg[] };
    if (bank === 0x70) {
      // 0x7013 = opcode 0x50 (F0x80015d4c), the ACQUISITION FLOURISH action: look up the one
      // resident FIELDSTG object of type 0x16 (owned by field character 0 = the player) and
      // call setSub1(3) on it, which runs sparkle program 3 and plays ITEM_GET. It carries no
      // game state, so it converts to the PlaySparkle(3) presentation command. It appears 123
      // times, always in a dialogue-state on_close beside the item/flag/BIT write this same
      // also_sets list carries — which is exactly why routing it through classifyAlsoSet picks
      // up all three grant loops at once. A state that is BOTH a talkGrant and a partnerGrant
      // emits it in each of the two split scripts; harmless, because setSub1 just restarts the
      // same program (the original's single on_close entry has the identical net effect).
      // See docs/research/scripting/bank70-opcode-handlers-decoded-2026-07-27.md § "op 0x50 resolved".
      if (s.id === 0x7013)
        return { op: "PlaySparkle", args: [{ t: "INT", v: 3 }] as TaggedArg[] };
      // rest of bank-0x70 = reward/action dispatch (bank70_rewards.json). Only opcode-0x20
      // arg0==1 (CURRENCY ADD) is decoded well enough to act on; anything else stays dropped.
      const amount = s.val === 1 ? bank70Add[s.id] : undefined;
      return amount != null ? { op: "AddMoney", args: [{ t: "INT", v: amount }] as TaggedArg[] } : undefined;
    }
    if (bank < 0x60)
      return { op: "SetFlag", args: [{ t: "FLAGID", v: s.id }, { t: "INT", v: s.val }] as TaggedArg[] };
    return undefined;  // bank 0x60 (virtual ordinal) and other un-modelled banks: no engine setter
  };

  // ── Talk grants: emit a once OnTalk give event per NPC item-give (tools/extract_talk_grants.py).
  // The NPC's dialogue-state on_close writes a collection-bank flag = "you now own item N"; the
  // engine models possession via the bag, so we translate it to GiveItem(N) gated by the same
  // dialogue-state `gate`. Non-collection on_close sets ride along, classified by classifyAlsoSet. ──
  for (const g of input.talkGrants ?? []) {
    let stage = byMap.get(g.stage);
    if (!stage) { stage = { mapId: g.stage, events: [], scripts: [] }; byMap.set(g.stage, stage); stages.push(stage); }
    const variant = variantScriptId(
      `${g.stage}.give.${g.npc_id}.${g.item_id}`,
      (g.gate ?? []).map(c => [c.id, c.expected] as [number, number]),
      (g.also_sets ?? []).map(x => [x.id, x.val] as [number, number]));
    if (variant === null) continue;                             // an identical row
    const scriptId = `${variant}.script`;
    const program: Instruction[] = [{ op: "GiveItem", args: [{ t: "INT", v: g.item_id }] as TaggedArg[] }];
    for (const s of g.also_sets ?? []) {
      const inst = classifyAlsoSet(s);
      if (inst) program.push(inst);
    }
    stage.scripts.push({ id: scriptId, program });
    const ev: EventRow = { id: variant, on: "OnTalk", match: { npc: g.npc_id }, do: scriptId, once: true };
    const gate = (g.gate ?? []).map(c => flagLeaf(c.id, c.expected));
    if (gate.length === 1) ev.if = gate[0]!;
    else if (gate.length > 1) ev.if = { kind: "all", children: gate };
    stage.events.push(ev);
  }

  // ── Money grants: emit a once OnTalk give event per NPC/search-point BIT-give
  // (tools/extract_bank70_money_grants.py). Same shape as talkGrants but the primary write is a
  // bank-0x70 CURRENCY ADD (AddMoney), not an item; unlike talkGrants this fires even when the
  // dialogue state grants no item at all (e.g. s235's search point). ──
  for (const g of input.moneyGrants ?? []) {
    let stage = byMap.get(g.stage);
    if (!stage) { stage = { mapId: g.stage, events: [], scripts: [] }; byMap.set(g.stage, stage); stages.push(stage); }
    const variant = variantScriptId(
      `${g.stage}.money.${g.npc_id}.${g.flag_id}`,
      (g.gate ?? []).map(c => [c.id, c.expected] as [number, number]),
      [[-1, g.amount], ...(g.also_sets ?? []).map(x => [x.id, x.val] as [number, number])]);
    if (variant === null) continue;                             // an identical row
    const scriptId = `${variant}.script`;
    const program: Instruction[] = [{ op: "AddMoney", args: [{ t: "INT", v: g.amount }] as TaggedArg[] }];
    for (const s of g.also_sets ?? []) {
      const inst = classifyAlsoSet(s);
      if (inst) program.push(inst);
    }
    stage.scripts.push({ id: scriptId, program });
    const ev: EventRow = { id: variant, on: "OnTalk", match: { npc: g.npc_id }, do: scriptId, once: true };
    const gate = (g.gate ?? []).map(c => flagLeaf(c.id, c.expected));
    if (gate.length === 1) ev.if = gate[0]!;
    else if (gate.length > 1) ev.if = { kind: "all", children: gate };
    stage.events.push(ev);
  }

  // ── Partner grants: emit a once OnTalk event per NPC partner handover
  // (tools/extract_bank70_partner_grants.py). The original's on_close writes bank-0x70 opcode
  // 0x10 case 3 (`roster_owned[slot] = slot+3`); the engine models the obtained set as the
  // $roster.owned bitmask, which is what the case-1/6/9 gates on the same NPCs read back. ──
  for (const g of input.partnerGrants ?? []) {
    let stage = byMap.get(g.stage);
    if (!stage) { stage = { mapId: g.stage, events: [], scripts: [] }; byMap.set(g.stage, stage); stages.push(stage); }
    const variant = variantScriptId(
      `${g.stage}.partner.${g.npc_id}.${g.flag_id}`,
      (g.gate ?? []).map(c => [c.id, c.expected] as [number, number]),
      [[-1, g.slot], ...(g.also_sets ?? []).map(x => [x.id, x.val] as [number, number])]);
    if (variant === null) continue;                             // an identical row
    const scriptId = `${variant}.script`;
    const program: Instruction[] = [{ op: "GrantPartner", args: [{ t: "INT", v: g.slot }] as TaggedArg[] }];
    for (const s of g.also_sets ?? []) {
      // Collection-bank writes in the SAME dialogue state are already emitted as GiveItem by
      // the talkGrants loop above (14 of the 33 partner handovers also hand over an item).
      // Riding them along here too would grant the item twice.
      if (((s.id >> 8) & 0xfe) >= 0x80 && ((s.id >> 8) & 0xfe) <= 0x8e) continue;
      const inst = classifyAlsoSet(s);
      if (inst) program.push(inst);
    }
    stage.scripts.push({ id: scriptId, program });
    const ev: EventRow = { id: variant, on: "OnTalk", match: { npc: g.npc_id }, do: scriptId, once: true };
    const gate = (g.gate ?? []).map(c => flagLeaf(c.id, c.expected));
    if (gate.length === 1) ev.if = gate[0]!;
    else if (gate.length > 1) ev.if = { kind: "all", children: gate };
    stage.events.push(ev);
  }

  // ── Flag-set producers: emit a once flag-set event per actor ptrB triple whose set_ptr writes
  // a stored-bank flag (tools/extract_npc_flag_sets.py). Visible NPC → OnTalk matched to its npc;
  // invisible trigger-actor → OnEnterMap auto. Gated by the actor spawn flags AND the triple gate
  // (both must hold for the engine's walker to select & apply the set). All sets are stored-bank
  // (extractor-filtered) → SetFlag. Dedup by (stage,npc,sets) so story-state variants emit once. ──
  for (const fs of input.flagSets ?? []) {
    let stage = byMap.get(fs.stage);
    if (!stage) { stage = { mapId: fs.stage, events: [], scripts: [] }; byMap.set(fs.stage, stage); stages.push(stage); }
    const tag = fs.sets.map(([id]) => id.toString(16)).join("_");
    const variant = variantScriptId(
      `${fs.stage}.flagset.${fs.npc_id}.${tag}`,
      fs.gate.map(([id, exp]) => [id, exp] as [number, number]),
      fs.sets.map(([id, val]) => [id, val] as [number, number]));
    if (variant === null) continue;                               // an identical row
    const scriptId = `${variant}.script`;
    const program: Instruction[] = fs.sets.map(([id, val]) =>
      ({ op: "SetFlag", args: [{ t: "FLAGID", v: id }, { t: "INT", v: val }] as TaggedArg[] }));
    stage.scripts.push({ id: scriptId, program });
    const ev: EventRow = fs.trigger === "talk"
      ? { id: variant, on: "OnTalk", match: { npc: fs.npc_id }, do: scriptId, once: true }
      : { id: variant, on: "OnEnterMap", do: scriptId, once: true };
    const gate = fs.gate.map(([id, exp]) => flagLeaf(id, exp));
    if (gate.length === 1) ev.if = gate[0]!;
    else if (gate.length > 1) ev.if = { kind: "all", children: gate };
    stage.events.push(ev);
  }

  if (unclassified.length)
    throw new Error(
      `${unclassified.length} unclassified event(s) — add decode-table rows:\n  ` +
      unclassified.join("\n  "));
  return { stages, flagKeys };
}

export function convertOrdinalLadder(p: any, ownerJson?: any, stages?: ConvertedStage[]): {
  allOrdinals: number[];
  byStage: Record<string, number[]>;
  byStageOwner?: Record<string, Record<string, number>>;
  ownerDropped?: { stage: string; events: string[]; reason: string }[];
} {
  const set = new Set<number>();
  for (const e of p.ladder ?? []) for (const o of e.ordinals) set.add(o);
  const byStage: Record<string, number[]> = {};
  for (const [n, ords] of Object.entries<number[]>(p.by_stage ?? {})) {
    byStage["s" + n] = ords;
    for (const o of ords) set.add(o);
  }
  // ordinal_owner.json (tools/extract_ordinal_owner.py): which event's on_complete routine
  // actually stores the master ordinal per stage, and the value it stores. Only the stages the
  // extractor resolved are carried, so an unresolved stage keeps the ladder behaviour above.
  //
  // SECOND INTERLOCK, here in the converter because only it knows what a player can actually
  // trigger: a stage keeps the owner rule only if every one of its owner events is STARTED by
  // some row this conversion emitted. If an owner event has no row at all, the beat it closes
  // can never be reached (s810: event 1035's on_complete routine writes 0x29, but nothing in
  // the overlay ever calls start_event(1035), so no row can complete it) and the owner rule would
  // stall the story forever. That stage falls back to the ladder behaviour above and is listed
  // in `ownerDropped` so the loss is visible instead of silent.
  //
  // "STARTED BY SOME ROW" is not the same as "STARTED AT ALL". A scene a CONVERSATION starts
  // (bank 0x90, `stage.talkLaunched`) has no row on purpose — its start is the dialogue state's
  // own `on_close`, which the shared launcher runs the moment that box closes
  // (engine/systems/talk-launch.ts). Counting only rows there would drop the owner rule for
  // exactly the beats whose start was finally decoded, and put them back on the coarse ladder.
  const startedBy = new Map<string, Set<number>>();
  for (const st of stages ?? []) {
    const evs = startedBy.get(st.mapId) ?? new Set<number>();
    for (const ev of st.events) {
      const m = /^(?:s\d+)\.(?:event|native)\.(\d+)\.script$/.exec(ev.do ?? "");
      if (m) evs.add(Number(m[1]));
    }
    for (const ev of st.talkLaunched ?? []) evs.add(Number(ev));
    for (const ev of st.controllerLaunched ?? []) evs.add(Number(ev));
    startedBy.set(st.mapId, evs);
  }
  const byStageOwner: Record<string, Record<string, number>> = {};
  const ownerDropped: { stage: string; events: string[]; reason: string }[] = [];
  for (const r of ownerJson?.ladder ?? []) {
    if (!r?.owner || !Object.keys(r.owner).length) continue;
    const owner: Record<string, number> = {};
    for (const [ev, ord] of Object.entries<number>(r.owner)) owner[String(ev)] = Number(ord);
    const mapId = "s" + r.stage;
    if (stages) {
      const evs = startedBy.get(mapId);
      const orphan = Object.keys(owner).filter(e => !evs?.has(Number(e)));
      if (orphan.length) {
        ownerDropped.push({
          stage: mapId, events: orphan,
          reason: "no converted row starts this owner event — stage keeps the ladder behaviour",
        });
        continue;
      }
    }
    byStageOwner[mapId] = owner;
  }
  const out = Object.keys(byStageOwner).length
    ? { allOrdinals: [...set].sort((a, b) => a - b), byStage, byStageOwner }
    : { allOrdinals: [...set].sort((a, b) => a - b), byStage };
  return ownerDropped.length ? { ...out, ownerDropped } : out;
}

export function convertRosterTable(roster: any, amounts?: any): { records: { key: number; flag_id?: number; op: number; param2: number; semantics?: any }[]; ranges: Record<number, [number, number]>; amounts?: { compare?: number[]; add?: number[]; subtract?: number[] } } {
  // `semantics` is the extractor's decoded meaning per record (collection_all,
  // roster_owned, stored_bit_tally, …). Carried through verbatim so the engine's
  // bank-0x70 handler dispatches on the decode instead of re-deriving it.
  // `flag_id` is the id set_flag takes for this record (bank 0x70 = 0x7000 | key), so
  // a WRITE record can be dispatched by the id the original passes rather than by its
  // key — which is what engine/systems/scene-completion.ts's bank dispatch needs.
  const records = (roster.records ?? []).map((r: any) =>
    r.semantics == null
      ? { key: r.key, ...(r.flag_id != null ? { flag_id: r.flag_id } : {}), op: r.op, param2: r.param2 }
      : { key: r.key, ...(r.flag_id != null ? { flag_id: r.flag_id } : {}), op: r.op, param2: r.param2, semantics: r.semantics });
  const ranges: Record<number, [number, number]> = {};
  for (const r of roster.records ?? []) {
    if ((r.op & 0xf0) === 0x30 && r.ordinal_lo !== undefined && r.ordinal_hi !== undefined) {
      ranges[r.param2] = [r.ordinal_lo, r.ordinal_hi];
    }
  }
  // The op-0x20 amount tables (MONEY_REQUIRED / MONEY_GAINS / MONEY_LOSSES,
  // D0x80048c44 / 0x48c6c / 0x48c8c) from bank70_rewards.json — the same static
  // EXE data, so the engine can answer F0x80015aac's compare/add/subtract arms
  // without a second data file. See engine/dw3/dw3-config.ts and the rosterAction
  // policy in engine/index.ts.
  const tables = amounts
    ? {
        ...(amounts.compare?.values ? { compare: amounts.compare.values } : {}),
        ...(amounts.add?.values ? { add: amounts.add.values } : {}),
        ...(amounts.subtract?.values ? { subtract: amounts.subtract.values } : {}),
      }
    : undefined;
  return { records, ranges, ...(tables && Object.keys(tables).length ? { amounts: tables } : {}) };
}

export function spawnGateArg(spawnFlags: { id: number; expected: number }[]): string[] {
  return (spawnFlags ?? []).map(f => "0x" + f.id.toString(16) + ":" + f.expected);
}

// ── Event classification parsers (ported from web/story-engine.js, disasm-derived) ──
// An event's "primary actor" = the most-frequent talkable entity target across its disasm.
// SAY's actor is token[3] (slot p1 actor mode); SETPOS/WALKTO/SETANIM's is token[1].
// Real actors are 2 < id < 800 (player=1, partner=2 excluded; id>=800 = effect, not actor).
export function eventActor(disasm: readonly string[]): number | null {
  const counts = new Map<number, number>();
  for (const line of disasm ?? []) {
    const t = line.split(/\s+/);
    let actor: number | null = null;
    if (t[0] === "SAY") actor = +t[3]!;
    else if (t[0] === "SETPOS" || t[0] === "WALKTO" || t[0] === "SETANIM") actor = +t[1]!;
    if (actor != null && actor > 2 && actor < 800) counts.set(actor, (counts.get(actor) || 0) + 1);
  }
  let best: number | null = null, bestN = 0;
  for (const [a, n] of counts) if (n > bestN) { best = a; bestN = n; }
  return best;
}

// An auto/on-entry cutscene PUPPETS the player (actor 1): it issues SETPOS/WALKTO/SETANIM
// on actor 1 because the player is not in control while it plays. An event that never moves
// the player is talk-triggered. This is the faithful auto-vs-talk divide (story-engine.js).
export function puppetsPlayer(disasm: readonly string[]): boolean {
  for (const line of disasm ?? []) {
    const t = line.split(/\s+/);
    if ((t[0] === "SETPOS" || t[0] === "WALKTO" || t[0] === "SETANIM") && t[1] === "1") return true;
  }
  return false;
}
