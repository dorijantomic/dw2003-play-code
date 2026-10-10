// The field scene system's TALK LAUNCHER (bank 0x90) — the shared routine that turns a
// finished conversation into a scene, ported once.
//
// The original is one resident dispatcher with no per-place copy at all:
//
//   set_flag(bank 0x90, bit)            resident F0x800165ac splits id into
//                                       bank = (id >> 8) & 0xfe, bit = id & 0x1ff
//     -> F0x8008bfa4(bit)               fieldstg: [0x8004b7bc](7,-1,-1) fetches the
//                                       type-7 scene controller, then
//     -> a0 = u16[0x800978d8 + bit*2]   the EVENT ID, looked up by BIT
//     -> jal 0x800853f8                 start_event — the SAME routine the position
//                                       step's op-8 handler calls
//     -> [controller+0x24 + 0xc] = ret  latched exactly like an op-8 start
//
// Three facts this module exists to hold, because each was previously re-guessed:
//
//   1. THE BIT IS A TABLE INDEX, not an event id and not a per-stage slot. The same
//      bit names the same scene wherever it is written (tools/extract_talk_event_
//      launches.py emits the table straight out of fieldstg.bin).
//   2. THE START SITE IS THE CONVERSATION'S on_close, behind that dialogue state's
//      own gate — not "talking to somebody". The write lives in an NPC record's
//      dialogue-state table (web/assets/scenes/*.json); which states write bank 0x90
//      is read out of those tables, never guessed from a scene's disassembly.
//   3. THE EVENT IS RESOLVED BY ID AGAINST THE CURRENT STAGE'S TABLE. start_event
//      walks the current stage's 20-byte records and falls out at the 0xffffffff
//      terminator without filling the runner, so an id this stage does not own starts
//      nothing however loudly it is called (three shipped bindings are in exactly that
//      state and are carried as `in_stage: false`, never redirected to a guessed stage).
//      And flag_key is NOT unique inside a stage — the Master Room's event 965 and
//      event 1450 records share 012e000a (wstag305.s:3699-3708) — so id first,
//      flag_key only as a fallback for a stage whose wstag ids disagree with the
//      step table's.
//
// The per-stage sites are data (web/assets/data/talk_launch_bindings.json,
// tools/extract_talk_launch_bindings.py) and are installed through
// setTalkLaunchBindings(). Nothing here names a flag id, a bank or a place.

/** One conversation that starts a scene: the NPC dialogue state whose `on_close`
 *  writes bank 0x90, the bit it writes, and the event the resident table names. */
export interface TalkLaunchSite {
  /** `oc.id & 0x1ff` — the index into the resident event-id array. */
  bit: number;
  /** The id the table names, i.e. what start_event receives. */
  event: number;
  /** The record's npc_id. */
  npc: number;
  /** Index into that record's `dialogue_states` — which of its lines carries the write. */
  state: number;
  file: string;
  index: number;
  /** The full `oc.id` the dialogue state writes. */
  write: number;
  /** That dialogue state's own gate; the scene only starts behind it. */
  gate?: { id: number; expected: number }[];
  /** The record's activation predicate (the conversation only exists at all behind it). */
  spawn_flags?: { id: number; expected: number }[];
  /** False when this stage's own event table does not hold the id — start_event then
   *  finds nothing on the disc either, and this is not a start site for this stage. */
  in_stage?: boolean;
}

/** The shape of web/assets/data/talk_launch_bindings.json. */
export interface TalkLaunchBindings {
  bank?: number;
  table_ram?: string;
  table_len?: number;
  stages?: Record<string, TalkLaunchSite[]>;
  unresolved?: string[];
}

export interface TalkLaunchEventRecord {
  /** The event id. story_steps spells it `event_id`; the wstag overlays spell it `id`. */
  id?: number;
  event_id?: number;
  flag_key: string;
}

/** A stage's own event table, in the two forms the resolution needs. */
export interface TalkLaunchTables {
  /** story_steps' per-stage `events` — the event-id keyed view the engine holds. */
  byId?: readonly TalkLaunchEventRecord[];
  /** the wstag overlay's own records for this stage. */
  byWstag?: readonly TalkLaunchEventRecord[];
}

const SITES = new Map<string, TalkLaunchSite[]>();

/** Install the extracted per-stage start sites. */
export function setTalkLaunchBindings(raw: TalkLaunchBindings | null | undefined): void {
  SITES.clear();
  for (const [mapId, rows] of Object.entries(raw?.stages ?? {})) SITES.set(mapId, rows);
}

/** Every start site in a stage, in table order. */
export function talkLaunchSites(mapId: string): readonly TalkLaunchSite[] {
  return SITES.get(mapId) ?? [];
}

/** The event a bit names in this stage, or null when the bit resolves nowhere here.
 *  `in_stage: false` bindings return null: on the disc that call starts nothing. */
export function talkLaunchEventForBit(mapId: string, bit: number): number | null {
  for (const s of SITES.get(mapId) ?? []) if (s.bit === bit && s.in_stage !== false) return s.event;
  return null;
}

/** The start sites that begin one event, in table order. Empty when no conversation
 *  in this stage launches it. */
export function talkLaunchSitesForEvent(mapId: string, event: number): TalkLaunchSite[] {
  return (SITES.get(mapId) ?? []).filter((s) => s.event === event && s.in_stage !== false);
}

/** Every event a conversation in this stage launches. The converter uses this to
 *  decide that a scene already HAS a start and must not also get a hand row. */
export function talkLaunchedEvents(mapId: string): Set<number> {
  const out = new Set<number>();
  for (const s of SITES.get(mapId) ?? []) if (s.in_stage !== false) out.add(s.event);
  return out;
}

/** Resolve the id the launcher named to the record start_event will walk, BY ID.
 *  flag_key is only the fallback, for a stage whose wstag ids disagree with the step
 *  table's; it is never the primary key, because it is not unique inside a stage. */
export function resolveTalkLaunchRecord(
  tables: TalkLaunchTables | null | undefined,
  eventId: number,
): TalkLaunchEventRecord | null {
  if (!tables) return null;
  const idOf = (e: TalkLaunchEventRecord): number | undefined => e.id ?? e.event_id;
  const step = tables.byId?.find((e) => idOf(e) === eventId);
  if (!step) return null;
  const w = tables.byWstag ?? [];
  return w.find((e) => idOf(e) === eventId) ?? w.find((e) => e.flag_key === step.flag_key) ?? null;
}

/** Drop everything installed. Tests only. */
export function clearTalkLaunchBindings(): void {
  SITES.clear();
}