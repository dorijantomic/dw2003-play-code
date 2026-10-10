// Story robot — the data-driven autopilot SOLVER (planner-driven successor to
// tools/story_autopilot.ts).
//
// Where the autopilot blindly fires every trigger and REPORTS coverage, the robot
// DERIVES each step from the decoded requires→produces graph and drives the REAL
// GameEngine through the authentic story, master-ordinal by master-ordinal:
//
//   • requires  = each event's `if` gate, flattened to flag/item leaves
//                 (engine-content `stages[].events[].if`).
//   • produces  = each event's on_complete script ops: SetFlag (stored flags) and
//                 GiveItem (collection-bank possession), plus the disasm-mined
//                 flag producers in flag_setters.json.
//   • virtual   = banks with no producer BY DESIGN: 0x60 = progress-ordinal equality,
//                 0x70 = roster predicate, 0x80..0x92 = item/collection possession.
//
// For each spine beat it resolves the gate by MODELLING its producers (give the item /
// set the flag the producing event would, force roster, step the ordinal), then fires
// the trigger through the engine and confirms the ordinal advanced. When a required
// item/flag has NO producer of any kind it HALTS that link and NAMES it — that
// unwired-link punch-list is the whole point: it turns "is story progression authentic
// and complete?" into a precise, reproducible list of exactly what is missing.
//
// Run from repo root:   node tools/story_robot.ts            (human report)
//                       node tools/story_robot.ts --json     (machine: {holes, frontier})
//
// Exit code 0 iff the run is clean (reached the expected frontier, no NEW holes vs the
// pinned baseline in tools/story_robot.baseline.json). Non-zero on regression — so it is
// usable directly as a gate and is wrapped by tests/story-robot.test.js.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { convertStages, convertOrdinalLadder } from "./engine-convert/lib.ts";
import { buildScriptedBattles } from "./engine-convert/load-real.ts";
import { GameEngine, createScreenRouter } from "../engine/index.ts";
import { createEngineBridge } from "../web/engine-bridge.js";
import { isCollectionBank } from "../engine/systems/scene-completion.ts";
import { setTalkLaunchBindings, talkLaunchSites } from "../engine/systems/talk-launch.ts";
import type { Condition, EventRow } from "../engine/core/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../");
const assets = resolve(root, "web/assets/data");
const readJson = (p: string): any => JSON.parse(readFileSync(p, "utf8"));

const JSON_OUT = process.argv.includes("--json");

// ── Build content EXACTLY the way the real build does (convert.ts) so the robot reflects
//    the live converter + data — running it after a Part-B change needs no bundle rebuild. ──
// Each event's completion ROUTINE as data, which the engine runs through
// engine/systems/scene-completion.ts (GameEngine.completeEvent). Without it a stage has no
// completion writes at all and no beat can advance — the same file the converter reads, and the
// producer index below reads the collection writes out of it.
const sceneCompletion = readJson(resolve(assets, "scene/scene_completion.json"));
const screenTable = readJson(resolve(root, "data/screen_table.json"));
function buildContent() {
  const storySteps = readJson(resolve(assets, "story_steps.json"));
  const wstagEvents = readJson(resolve(root, "web/assets/events/wstag_events.json"));
  const fieldEnc = readJson(resolve(assets, "field_encounters.json"));
  const scriptedBattles = buildScriptedBattles(readJson(resolve(assets, "scripted_battles.json")));
  const itemGrantsBase = readJson(resolve(assets, "item_grants.json")).grants;
  // Native (raw-MIPS) item grants (tools/extract_native_item_grants.py) -- see convert.ts for
  // the full rationale. Only offset-attributed (real event_id) rows are wired.
  const nativeGrantsRaw = readJson(resolve(assets, "native_item_grants.json")).grants;
  const nativeGrants = nativeGrantsRaw
    .filter((g: any) => g.event_id != null)
    .map((g: any) => ({ stage: g.stage, event_id: g.event_id, item_id: g.item_id }));
  const itemGrants = [...itemGrantsBase, ...nativeGrants];
  const talkGrants = readJson(resolve(assets, "talk_item_grants.json")).grants;
  const decodeTable = readJson(resolve(__dirname, "engine-convert/decode-table.json"));
  // The stage-entry arrival dispatcher chains (web/assets/data/scene/arrival_candidates.json).
  const arrivalChains = readJson(resolve(assets, "scene/arrival_candidates.json"));
  // The bank-0x90 talk launcher's per-stage start sites: which NPC conversation starts which
  // scene. A scene it starts has NO row, so the converter needs this or the robot would measure
  // hand rows the build no longer emits (it builds its own content from the same inputs).
  const talkLaunch = readJson(resolve(assets, "talk_launch_bindings.json"));
  const flagSets = readJson(resolve(assets, "npc_flag_sets.json")).flag_sets;
  // sceneCompletion: the file read above, handed to the converter.
  const { stages, flagKeys } = convertStages({
    storySteps, wstagEvents, fieldEnc, scriptedBattles, itemGrants, talkGrants, flagSets, decodeTable, arrivalChains, talkLaunch, sceneCompletion, strict: true,
  });
  const ordinalRaw = readJson(resolve(assets, "progress_ordinal.json"));
  const allOrdinals = [...new Set<number>(ordinalRaw.ladder.flatMap((r: any) => r.ordinals))].sort((a, b) => a - b);
  const byStage: Record<string, number[]> = {};
  for (const r of ordinalRaw.ladder) byStage[`s${r.stage}`] = r.ordinals;
  // Which event's on_complete writes the master ordinal per stage (tools/extract_ordinal_owner.py).
  // Without this the robot would walk the OLD "any completed event advances" ladder and report
  // beats as advanced that the original only advances on the beat's closing event. Built through
  // the SAME convertOrdinalLadder the build uses, so a stage the interlock drops (no row starts
  // its owner event) is dropped here too — the robot must not measure a different rule than ships.
  const ownerRaw = readJson(resolve(assets, "ordinal_owner.json"));
  const ordinal = convertOrdinalLadder(ordinalRaw, ownerRaw, stages);
  const byStageOwner: Record<string, Record<string, number>> = ordinal.byStageOwner ?? {};
  const roster = readJson(resolve(root, "content/flags/roster.json"));
  return { stages, ordinal: { ...ordinal, byStage }, roster, flagKeys, ladder: ordinalRaw.ladder };
}

const itemNames: string[] = (() => {
  const p = resolve(process.env.HOME ?? "", "ddw3/rust/types/src/item_id.rs");
  if (!existsSync(p)) return [];
  return [...readFileSync(p, "utf8").matchAll(/^\t(\w+),/gm)].map(m => m[1]!);
})();
const itemName = (id: number) => itemNames[id] ?? `item#${id}`;

// The bank-0x90 launcher's per-stage start sites (web/assets/data/talk_launch_bindings.json),
// ported once in engine/systems/talk-launch.ts. Installed into the shared module so the robot
// asks the SAME question the game and the converter ask, from the same data.
setTalkLaunchBindings(readJson(resolve(assets, "talk_launch_bindings.json")));

/** A launch site's own gate, as a Condition: the record's spawn predicate AND the dialogue
 *  state's own gate. Both are what the original tests before the on_close write can happen. */
function siteCondition(site: { gate?: { id: number; expected: number }[];
                               spawn_flags?: { id: number; expected: number }[] }): Condition | undefined {
  const leaves = [
    ...(site.spawn_flags ?? []).map((f): Condition => ({ kind: "leaf", leaf: "flag", args: [f.id, f.expected] })),
    ...(site.gate ?? []).map((g): Condition => ({ kind: "leaf", leaf: "flag", args: [g.id, g.expected] })),
  ];
  if (!leaves.length) return undefined;
  return leaves.length === 1 ? leaves[0]! : { kind: "all", children: leaves };
}

const content = buildContent();
const stageNames: Record<string, string> = existsSync(resolve(root, "data/stage_names.json"))
  ? readJson(resolve(root, "data/stage_names.json")) : {};

const flagId = (v: number | string) => typeof v === "string" ? parseInt(v, 16) : v;

// ── Producer index ────────────────────────────────────────────────────────────────────
// A flag is PRODUCED if some content on_complete script does SetFlag(id), OR the disasm
// miner (flag_setters.json) found a set_flag immediate for it anywhere (overlay/EXE).
// An item is PRODUCED if some on_complete script does GiveItem(item) — or by a finished
// scene's OWN completion routine, whose collection-bank write (set_flag(0x80NN,1), the disc's
// F0x800161d8) now runs through the engine's port instead of a converted instruction
// (engine/systems/scene-completion.ts). Both are the same disc fact; the second is read
// from the same data the engine runs, so this index cannot drift from the game.
const producesFlag = new Set<number>();
const producesItem = new Set<number>();
for (const st of content.stages)
  for (const sc of st.scripts)
    for (const ins of sc.program) {
      if (ins.op === "SetFlag") producesFlag.add(Number((ins.args[0] as any).v));
      if (ins.op === "GiveItem") producesItem.add(Number((ins.args[0] as any).v));
    }
for (const stage of Object.keys(sceneCompletion.stages ?? {}))
  for (const row of Object.values<any>(sceneCompletion.stages[stage].events))
    for (const w of row.writes ?? [])
      if (w.op === "set_flag" && isCollectionBank((w.flag >> 8) & 0xfe)) producesItem.add(w.flag & 0x1ff);
if (existsSync(resolve(assets, "flag_setters.json")))
  for (const k of Object.keys(readJson(resolve(assets, "flag_setters.json"))))
    producesFlag.add(Number(k));
// Scripted-battle synchronization flags are produced by the PRE→battle→POST chain itself, not
// by a static SetFlag: the `armFlag` is set by the (host-run) PRE on_complete, the `wonFlag` is
// the synthetic victory marker the engine sets on win. The dynamic pass below proves the chain
// fires; so these are runtime-produced, NOT unwired links. Mine them from every `.sb.battle` row
// (its `if` = arm==1 AND won==0) so the punch-list isn't polluted by battle plumbing.
for (const st of content.stages)
  for (const ev of st.events)
    if (ev.id.includes(".sb.battle"))
      for (const lf of (ev.if && ev.if.kind === "all" ? ev.if.children : ev.if ? [ev.if] : []))
        if (lf.kind === "leaf" && lf.leaf === "flag") producesFlag.add(flagId(lf.args[0] as any));

// ── Leaf classification ─────────────────────────────────────────────────────────────────
// Every gate leaf resolves to one of: satisfiable-by-default, virtual (ordinal/roster),
// has-producer (we model it), or a HOLE (a required item/stored-flag with no producer).
type LeafKind = "ordinal" | "roster" | "item" | "item-absent" | "flag" | "flag-clear" | "other";
interface LeafInfo { kind: LeafKind; satisfiable: boolean; fid: number; expected: number; item?: number; need: string; }

function classifyLeaf(c: Extract<Condition, { kind: "leaf" }>): LeafInfo | null {
  if (c.leaf !== "flag" && c.leaf !== "hasFlag") return { kind: "other", satisfiable: true, fid: -1, expected: 1, need: c.leaf };
  const fid = flagId(c.args[0] as any);
  const expected = c.leaf === "hasFlag" ? 1 : (c.args.length > 1 ? Number(c.args[1]) : 1);
  const bank = (fid >> 8) & 0xfe;
  if (bank === 0x60) return { kind: "ordinal", satisfiable: true, fid, expected, need: `ordinal==0x${(fid & 0xff).toString(16)}` };
  if (bank === 0x70) return { kind: "roster", satisfiable: true, fid, expected, need: `roster 0x${fid.toString(16)}` };
  if (bank >= 0x80 && bank <= 0x92) {
    const item = fid & 0x1ff;
    if (expected === 0) return { kind: "item-absent", satisfiable: true, fid, expected, item, need: `NOT have ${itemName(item)}(${item})` };
    return { kind: "item", satisfiable: producesItem.has(item), fid, expected, item, need: `item ${itemName(item)}(${item})` };
  }
  if (expected === 0) return { kind: "flag-clear", satisfiable: true, fid, expected, need: `flag 0x${fid.toString(16)}==0` };
  return { kind: "flag", satisfiable: producesFlag.has(fid), fid, expected, need: `flag 0x${fid.toString(16)}` };
}

function leavesOf(c: Condition | undefined): Extract<Condition, { kind: "leaf" }>[] {
  if (!c) return [];
  if (c.kind === "leaf") return [c];
  if (c.kind === "not") return leavesOf(c.child);
  if (c.kind === "all" || c.kind === "any" || c.kind === "none") return c.children.flatMap(leavesOf);
  return [];
}

// ── Static pass: the unwired-link punch-list ──────────────────────────────────────────────
interface Hole { stage: string; event: string; on: string; need: string; kind: LeafKind; }
const holes: Hole[] = [];
const seen = new Set<string>();
for (const st of content.stages)
  for (const ev of st.events) {
    // `.give.` rows are talk-give PRODUCERS, not spine gates: their `if` is the NPC dialogue-state
    // condition (e.g. "don't already have the card", or an area/progress orphan flag the gameplay
    // subsystem sets — the same category as the s580/s685 orphans). Those conditions are evaluated
    // by the NPC dialogue-state subsystem, not the progression graph, so they are not unwired
    // links. We still count the item the row PRODUCES (the producer index above already scanned it).
    // `.flagset.` rows are the same: per-actor ptrB on_close flag PRODUCERS (the gondola reject
    // npc63 → 0x1c46, etc.), gated by the actor's dialogue-state/spawn conditions, not spine gates.
    if (ev.id.includes(".give.") || ev.id.includes(".flagset.")) continue;
    for (const lf of leavesOf(ev.if)) {
      const info = classifyLeaf(lf);
      if (!info || info.satisfiable) continue;
      const key = `${st.mapId}|${ev.id}|${info.need}`;
      if (seen.has(key)) continue;
      seen.add(key);
      holes.push({ stage: st.mapId, event: ev.id, on: ev.on, need: info.need, kind: info.kind });
    }
  }
holes.sort((a, b) => a.stage.localeCompare(b.stage) || a.need.localeCompare(b.need));

// ── Dynamic pass: drive the spine through the REAL engine ─────────────────────────────────
// Build the engine; override the roster bank (0x70) with a permissive handler — the robot
// MODELS "the player has the required party" (a virtual gate, satisfiable by design). Item
// possession (0x80+) keeps the REAL handler so an unwired card gate genuinely fails.
const eng = new GameEngine({ stages: content.stages, ordinal: content.ordinal, roster: content.roster, flagKeys: content.flagKeys }, { screenTable });
eng.state.flags.registerVirtualBank(0x70, (_bit, expected) => expected !== 0);

const ord = () => Number(eng.state.vars.get("$story.ordinal") ?? 0);

// ── Producer census: which event actually stored each story step ─────────────────────────
// `completeEvent` is the ONE place the shared scene-completion port writes the master
// ordinal ([0x8004b370], `sw $vX,-0x4c90`), so wrapping it names the producer the robot drove
// and the start site that drove it. Without this the report could only say a beat advanced, and
// a beat advanced by the WRONG event would read exactly like a beat advanced by the disc's own
// closing scene. `via` is the trigger row or shared system that started it, so a hand row or a
// per-stage override would be visible here rather than indistinguishable from the real route.
interface OrdinalWrite { event: number; ordinal: number; via: string; }
const ordinalWrites: OrdinalWrite[] = [];
let currentVia = "none";
// Which start site drove which event. `raise` chains every row of a trigger type, so the row
// being iterated is not necessarily the row whose scene ran; this map is filled per beat from
// each row's own `do` (the event id it starts) so the label names the row that really ran.
const viaByEvent = new Map<number, string>();
{
  const complete = eng.completeEvent.bind(eng);
  eng.completeEvent = (evId: number): void => {
    const before = ord();
    complete(evId);
    const after = ord();
    if (after !== before) ordinalWrites.push({ event: evId, ordinal: after, via: viaByEvent.get(evId) ?? currentVia });
  };
}

// Resolve a gate by modelling its producers. Returns the holes that block it (empty = passable).
function resolveGate(cond: Condition | undefined): Hole[] {
  const blocking: Hole[] = [];
  for (const lf of leavesOf(cond)) {
    const info = classifyLeaf(lf);
    if (!info) continue;
    if (!info.satisfiable) { blocking.push({ stage: eng.currentStage, event: "(gate)", on: "", need: info.need, kind: info.kind }); continue; }
    // model the producer's effect so the engine's own get_flag will then pass
    if (info.kind === "item" && info.item != null) eng.state.inventory.add(info.item);
    else if (info.kind === "flag") eng.state.flags.set(info.fid, true);
    // ordinal/roster/clear/absent need no mutation (handled by ordinal var / permissive roster / default)
  }
  return blocking;
}

// Fire one trigger row to completion; auto-win any battle and re-raise so a PRE→battle→POST
// chain runs (mirrors story_autopilot.fireTrigger). Returns true if anything ran.
//
// `params` must carry the row's own `match` keys: EventManager.raise drops every row whose
// match key is missing from the raised params, so firing OnExit without {to} (or OnStep
// without its position/zone key) silently matched nothing. That made wired content look
// like "no trigger row" in the hole list (s440's ordinal-7 exit event was the first case).
// The beat currently being driven; fireTrigger stops re-raising once it is reached, for the same
// reason the outer loops do: an event belonging to a LATER beat must not be consumed on this
// visit. Without it the retry loop kept chaining after the beat's own event had already stored
// its ordinal, so the story sat at the beat it had just finished and the NEXT raise saw a
// satisfied gate for that beat's closing scene (s750: talk.820 stored 0x20, then the same
// raise's second pass fired talk.886, which stores 0x21, and beat 0x21 had nothing left).
let beatGoal: number | null = null;
function fireTrigger(on: string, params?: Record<string, number | string>): boolean {
  let ran = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (beatGoal != null && ord() >= beatGoal) break;
    const before = eng.battleLog.length;
    const h = eng.raise(on, params);
    if (!h) break;
    ran = true;
    eng.pump(h);
    if (eng.battleLog.length > before) eng.state.flags.set(eng.battleLog.at(-1)!.wonFlag, true);
  }
  return ran;
}

// Flatten ladder into ordered (target, stage) beats.
const beats: { target: number; stage: string }[] = [];
for (const r of content.ladder) for (const o of r.ordinals) beats.push({ target: o, stage: `s${r.stage}` });
beats.sort((a, b) => a.target - b.target);

type Status = "advanced" | "blocked" | "inert" | "crash" | "no-trigger";
interface Beat { target: number; stage: string; name: string; status: Status; detail: string;
                /** the event whose completion routine stored this beat's ordinal */
                producer?: number; /** the trigger row / shared system that started it */
                via?: string; }
const results: Beat[] = [];
let frontier = 0;          // highest contiguous ordinal reached with no blocking hole
let frontierBroken = false;

for (const [beatIdx, beat] of beats.entries()) {
  const name = stageNames[beat.stage] ?? beat.stage;
  // isolate: enter each beat from its correct predecessor ordinal so one early gap doesn't
  // mask later beats (we still track the contiguous frontier separately).
  // The predecessor is the PREVIOUS LADDER ORDINAL, not target-1: the master's ordinals are not
  // all contiguous (41 -> 43 -> 45, gap at 42/44 -- no stage writes those), and a stage's entry
  // dispatcher tests the literal its own beat is gated on (s780 starts event 1500 only at
  // ordinal 43, wstag780). Entering at target-1 = 44 reads a step the original never has.
  // The FIRST beat is entered at step 0, not at its own target: on the disc the opening scene
  // is gated on the master ordinal being 0 (s785's arrival row is get_flag(0x6000)==1,
  // web/assets/engine-content.json `s785.auto.1`), so 0 is the state before the first beat and
  // step 1 has a producer like every other step (wstag785.s .L0x92c `li $v0,1 / jr $ra /
  // sw $v0,-0x4c90($v1)`). Seeding the first beat with its own target made it look advanced
  // while nothing had run.
  eng.state.vars.set("$story.ordinal", beatIdx > 0 ? beats[beatIdx - 1].target : 0);
  beatGoal = beat.target;
  const stage = content.stages.find(s => s.mapId === beat.stage);
  let res: Beat = { target: beat.target, stage: beat.stage, name, status: "no-trigger", detail: "" };
  try {
    if (!stage) { res.detail = "stage not in content"; results.push(res); continue; }
    eng.loadStage(beat.stage);

    // The gates on this stage's events that we must satisfy to progress. `.give.` rows are
    // optional talk-give producers (their gate is an NPC dialogue-state condition), not beat
    // gates — skip them so an orphan NPC-state flag never falsely blocks a spine beat. The item
    // they grant is still satisfiable elsewhere because it now has a producer in the index.
    const blocking: Hole[] = [];
    for (const ev of stage.events) if (!ev.id.includes(".give.") && !ev.id.includes(".flagset.")) blocking.push(...resolveGate(ev.if));

    const battlesBefore = eng.battleLog.length;
    let anyRan = false;
    // Do not spend a LATER beat's closing scene while chasing this one. Every stage on
    // the ladder now carries its decoded owner map (ordinal.byStageOwner, from
    // tools/extract_ordinal_owner.py), so the harness knows exactly which scene writes
    // which story step. s520's talk row for event 695 — the scene that writes step 0x1a
    // — used to be fired while chasing step 0xb, burning its once-bit and leaving the
    // next beat with no trigger ("trigger ran, ordinal stuck at 0x19").
    const laterOwner = new Set<number>();
    for (const [evId, o] of Object.entries((content.ordinal as any).byStageOwner?.[beat.stage] ?? {}))
      if (Number(o) > beat.target) laterOwner.add(Number(evId));
    const rowEventId = (e: EventRow): number | null => {
      const m = /\.(?:event|native)\.(\d+)\.script$/.exec(e.do ?? "");
      return m != null ? Number(m[1]) : null;
    };
    const rowIsLaterBeat = (e: EventRow) => {
      const id = rowEventId(e);
      return id != null && laterOwner.has(id);
    };
    // Which row starts which event, for the WHOLE stage up front: `raise` chains every row of a
    // trigger type whose gate passes, so the row being iterated is often not the row that ran.
    viaByEvent.clear();
    for (const e of stage.events) { const id = rowEventId(e); if (id != null) viaByEvent.set(id, `${e.on}:${e.id}`); }
    // Stop as soon as the beat is reached: a once-event that belongs to a LATER
    // beat must not be consumed on this visit. Firing every OnEnterMap row
    // unconditionally consumed s212's ordinal-14 talk event while chasing
    // ordinal 3, which is what made a wired beat read as "no trigger row".
    for (const r of stage.events.filter((e: EventRow) => e.on === "OnEnterMap" && !rowIsLaterBeat(e))) {
      if (ord() >= beat.target) break;
      currentVia = `${r.on}:${r.id}`;
      anyRan = fireTrigger(r.on, r.match) || anyRan;
    }
    const talkRows = stage.events.filter((e: EventRow) => e.on === "OnTalk" && !rowIsLaterBeat(e));
    for (const r of talkRows) { if (ord() >= beat.target) break; currentVia = `${r.on}:${r.id}`; anyRan = fireTrigger(r.on, r.match) || anyRan; }
    // The bank-0x90 TALK LAUNCHER — the scenes a CONVERSATION starts. These have no trigger row
    // at all: an NPC dialogue state's own `on_close` writes bank 0x90 with a bit whose resident
    // table entry names the event, and the shared launcher (engine/systems/talk-launch.ts) starts
    // it the moment that box closes, behind that state's gate. Driving the rows above instead was
    // measuring hand rows the build no longer emits — worse, those rows fired at the FIRST
    // conversation with the right npc id at ANY story step, which is how five beats looked wired.
    // Order: right after the talk rows, because in the game this IS a talk.
    for (const site of talkLaunchSites(beat.stage)) {
      if (ord() >= beat.target) break;
      if (site.in_stage === false || laterOwner.has(site.event)) continue;
      // The conversation must exist (its record's spawn predicate) and this must be its
      // active line (the dialogue state's own gate) before its on_close can write the bank.
      resolveGate(siteCondition(site));
      currentVia = `talk-launch:bank 0x90 bit ${site.bit} (npc ${site.npc} state ${site.state} closes)`;
      viaByEvent.set(site.event, currentVia);
      anyRan = (eng.playEventById(site.event) && (eng.completeEvent(site.event), true)) || anyRan;
    }
    if (ord() < beat.target) for (const r of stage.events.filter((e: EventRow) => e.on === "OnStep" && !rowIsLaterBeat(e))) { currentVia = `${r.on}:${r.id}`; anyRan = fireTrigger(r.on, r.match) || anyRan; if (ord() >= beat.target) break; }
    if (ord() < beat.target) for (const r of stage.events.filter((e: EventRow) => e.on === "OnExit" && !rowIsLaterBeat(e))) { currentVia = `${r.on}:${r.id}`; anyRan = fireTrigger(r.on, r.match) || anyRan; if (ord() >= beat.target) break; }

    const firedBattle = eng.battleLog.length > battlesBefore;
    if (ord() >= beat.target) res = { ...res, status: "advanced", detail: `→0x${beat.target.toString(16)}` + (firedBattle ? ` (battle ${eng.battleLog.at(-1)!.screenId})` : "") };
    else if (blocking.length) res = { ...res, status: "blocked", detail: `UNWIRED: ${blocking.map(b => b.need).join(", ")}` };
    else if (anyRan) res = { ...res, status: "inert", detail: `trigger ran, ordinal stuck at 0x${ord().toString(16)}` };
    else res = { ...res, status: "no-trigger", detail: stage.events.some((e: EventRow) => e.on === "OnStep") ? "only OnStep/zone triggers" : "no trigger row" };
    // Name the event that stored this step, and the start site that drove it. A beat that
    // advanced with no recorded write would mean something other than the completion port
    // moved the story, which is exactly what this census exists to make visible.
    const write = ordinalWrites.filter((w) => w.ordinal === beat.target).at(-1);
    if (write) res = { ...res, producer: write.event, via: write.via };

    if (!frontierBroken) {
      if (res.status === "advanced") frontier = beat.target;
      else if (res.status === "blocked") frontierBroken = true;   // a real data hole stops the train
    }
  } catch (e: any) {
    res = { ...res, status: "crash", detail: String(e?.message ?? e).split("\n")[0] };
    if (!frontierBroken) frontierBroken = true;
  }
  results.push(res);
}

// ── Compare to the pinned baseline (regression gate) ──────────────────────────────────────
// The ordinal spine ends at its last writer; that does not mean the player stays
// there. Audit the terminal writer's arrival/handoff chain using the SAME bridge,
// completion routine, screen router and arrival gates as the browser. Presentation
// is omitted: this reads authored HANDOFF tokens, so it is a static route audit,
// not proof that animations/textboxes can finish (the browser verifier supplies that).
function auditContinuation() {
  const terminal = beats.findLast(b => b.target === frontier);
  if (!terminal) return null;
  const index = beats.indexOf(terminal);
  const audit = new GameEngine(content, { driven: true, screenTable });
  audit.state.vars.set("$story.ordinal", beats[index - 1]?.target ?? terminal.target);
  const router = createScreenRouter(screenTable, {
    useAlt: () => Number(audit.state.vars.get("$story.ordinal")) === 45,
  });
  const scripts = readJson(resolve(root, "web/assets/events/wstag_events.json"));
  const events: { stage: string; event: number; requestedScreen: number | null }[] = [];
  const moves: { from: string; to: string; screen: number }[] = [];
  const pending = [terminal.stage];
  const blocked: string[] = [];
  const bridge = createEngineBridge({
    engine: audit,
    playCutscene: (key: string, onDone: (screen: number | null) => void) => {
      const row = scripts[audit.currentStage]?.find((r: any) => r.flag_key === key);
      if (!row) { blocked.push(`missing script ${audit.currentStage}/${key}`); onDone(null); return; }
      const handoff = row.disasm?.find((line: string) => line.startsWith("HANDOFF "));
      const screen = handoff ? Number(handoff.split(" ")[1]) : null;
      events.push({ stage: audit.currentStage, event: row.id, requestedScreen: screen });
      onDone(screen);
    },
    startBattle: (screen: number) => { blocked.push(`battle ${screen} needs gameplay`); },
    doHandoff: (screen: number) => {
      const route = router.route(screen);
      if (route?.kind !== "warp") { blocked.push(`non-field screen ${screen}`); return; }
      moves.push({ from: audit.currentStage, to: route.to, screen });
      pending.push(route.to);
    },
  });
  // Queue a field entry after the outgoing handle completes, as the browser's
  // fade does. Loading it inside doHandoff would replace the outgoing event table.
  for (let visits = 0; pending.length && visits < 24; visits++) {
    bridge.onStageEnter(pending.shift()!);
    if (blocked.length) break;
  }
  if (pending.length && !blocked.length) blocked.push("arrival chain exceeds 24 visits");
  return { kind: "static-handoff-audit", events, moves, stage: audit.currentStage,
    ordinal: Number(audit.state.vars.get("$story.ordinal")), blocked };
}
const continuation = auditContinuation();

// ── The skipped list, and the producer census against the decoded owner map ────────────────
// `skipped` is every ladder story step the solver could NOT wire, with the reason. It used to
// name three (0x07 s440, 0x0e s212, 0x19 s685) before the stage-entry arrival chain and the
// bank-0x90 talk launcher were ported; it is the list tests/story-robot.test.js pins, so a
// step that stops being wired is a test failure rather than a line in a report nobody diffs.
//
// `ownerMismatch` is the same idea one level down: each beat must have been advanced by an
// event the DECODED owner map names for that step (web/assets/data/ordinal_owner.json, from
// the overlay's own `sw $vX,-0x4c90`), so "advanced" cannot be satisfied by some other scene.
const skipped = results.filter((r) => r.status !== "advanced")
  .map((r) => ({ ordinal: r.target, stage: r.stage, status: r.status, detail: r.detail }));
const decodedOwners = (content.ordinal as any).byStageOwner as Record<string, Record<string, number>>;
const ownerMismatch = results.filter((r) => r.status === "advanced").flatMap((r) => {
  const owners = Object.entries(decodedOwners[r.stage] ?? {})
    .filter(([, o]) => Number(o) === r.target).map(([id]) => Number(id));
  if (owners.length === 0) return [{ ordinal: r.target, stage: r.stage, producer: r.producer ?? null, reason: "no decoded owner for this step" }];
  if (r.producer == null || !owners.includes(r.producer))
    return [{ ordinal: r.target, stage: r.stage, producer: r.producer ?? null, owners, reason: "advanced by an event the decoded owner map does not name" }];
  return [];
});
const producerCensus = results.filter((r) => r.status === "advanced")
  .map((r) => ({ ordinal: r.target, stage: r.stage, producer: r.producer ?? null, via: r.via ?? null }));

const baselinePath = resolve(__dirname, "story_robot.baseline.json");
const baseline = existsSync(baselinePath) ? readJson(baselinePath) : null;
const holeKeys = holes.map(h => `${h.stage}:${h.need}`).sort();
const baseKeys: string[] = baseline?.holes ?? [];
const newHoles = holeKeys.filter(k => !baseKeys.includes(k));
const fixedHoles = baseKeys.filter(k => !holeKeys.includes(k));

if (JSON_OUT) {
  console.log(JSON.stringify({ frontier, holes: holeKeys, skipped, ownerMismatch, producerCensus, beats: results, continuation }, null, 2));
} else {
  console.log(`\nStory robot — data-driven spine solver  (${beats.length} beats, goal 0x${content.ordinal.allOrdinals.at(-1)!.toString(16)})\n`);
  const icon: Record<Status, string> = { advanced: "✅", blocked: "🚧", inert: "❌", crash: "💥", "no-trigger": "⏭ " };
  for (const r of results)
    console.log(`  ${icon[r.status]} 0x${r.target.toString(16).padStart(2, "0")} ${r.stage.padEnd(5)} ${r.name.slice(0, 30).padEnd(31)} ${r.detail}` +
      (r.producer != null ? `   [event ${r.producer} via ${r.via}]` : ""));
  console.log(`\n  ── SKIPPED STORY STEPS (a ladder step the solver could not wire) ──`);
  if (!skipped.length) console.log(`  (none — all ${results.length} ladder steps advanced)`);
  for (const s of skipped) console.log(`  ⏭ 0x${s.ordinal.toString(16).padStart(2, "0")} ${s.stage.padEnd(5)} ${s.status}: ${s.detail}`);
  console.log(`\n  ── UNWIRED LINKS (the punch-list: required item/flag with no producer of any kind) ──`);
  if (!holes.length) console.log("  (none — every gate is producible)");
  for (const h of holes) console.log(`  🚧 ${h.stage.padEnd(5)} ${h.event.padEnd(22)} [${h.on}] need ${h.need}`);
  if (ownerMismatch.length) { console.log(`\n  ⚠️  PRODUCER CENSUS MISMATCH:`); for (const m of ownerMismatch) console.log(`      ${m.reason}: 0x${m.ordinal.toString(16)} ${m.stage} producer ${m.producer} owners ${JSON.stringify(m.owners ?? [])}`); }
  const by = (s: Status) => results.filter(r => r.status === s).length;
  console.log(`\n  contiguous frontier: ordinal 0x${frontier.toString(16)}   ✅${by("advanced")} 🚧${by("blocked")} ❌${by("inert")} 💥${by("crash")} ⏭${by("no-trigger")} / ${results.length}`);
  console.log(`  skipped: ${skipped.length}   producer census mismatches: ${ownerMismatch.length}`);
  console.log(`  holes: ${holes.length}` + (baseline ? `   (baseline ${baseKeys.length}: +${newHoles.length} new, -${fixedHoles.length} fixed)` : "   (no baseline pinned)"));
  if (continuation) console.log(`  static continuation: ${continuation.events.map(e => `${e.stage} event ${e.event}`).join(" → ")} → ${continuation.stage}; ordinal ${continuation.ordinal}`);
  if (newHoles.length) console.log(`  ⚠️  NEW holes vs baseline:\n${newHoles.map(h => "      + " + h).join("\n")}`);
  if (fixedHoles.length) console.log(`  ✓  fixed vs baseline:\n${fixedHoles.map(h => "      - " + h).join("\n")}`);
  console.log();
}

// Clean iff no NEW holes vs baseline (fixing holes is always allowed), frontier ≥ baseline,
// every ladder step wired, and every step advanced by the event the decoded owner map names.
const frontierOk = !baseline || frontier >= (baseline.frontier ?? 0);
process.exit(newHoles.length === 0 && frontierOk && skipped.length === 0 && ownerMismatch.length === 0 ? 0 : 1);
