import { isStoryCommandBank, storyCommand, type StoryCommand } from './story-command-banks.ts';
// The field scene system's SCENE-COMPLETION routine — the one shared leaf every
// finished scene runs to move the story on, ported once.
//
// The original is 246 per-place copies of the same leaf (one per event record's
// `on_complete_fn`, across 100 overlays), each with its own writes as DATA. What
// the copies share is the whole procedure; what each place supplies is the list:
//
//   * every write goes through ONE of two doors, and there is no third:
//       - `set_flag(id, value)` — the banked flag API, reached through the
//         function-pointer cell at 0x80048AC8 (flagAPI+0xc). The id is UNSIGNED:
//         0x400d, 0x7400, 0x82dc all appear (pro/wstag200.s .L0x000000f8,
//         pro/wstag211.s .L0x000000a8).
//       - one 32-bit store of the MASTER STORY ORDINAL at [0x8004B370], the same
//         word the arrival dispatcher compares against (pro/wstag200.s
//         .L0x00000144: `lui $v1,0x8005 / li $v0,4 / jr $ra / sw $v0,-0x4c90($v1)`).
//   * the writes happen IN ORDER, and the value is either 1 (`li $a1,1`) or 0
//     (`move_ $a1,$zr`) — 322 sets and 21 clears over the 246.
//   * a scene that writes nothing writes nothing: there is no implicit "the beat
//     finished" flag. The story only moves because a CLOSING event's routine says so.
//
// The disc ships this leaf in five shapes, and they are five points in one space —
// an ordered list of writes — not five code paths:
//
//     A  two flags                      B  one flag
//     C  the story step alone           D  the story step, then one flag
//     E  three flags
//
// `shapeOf` keeps that census so a change in either direction is visible; the port
// itself is the list. Two of the 246 sit outside all five (s420: two flags and THEN
// the story step; s400: five flag clears), which is why the port is a list and not a
// five-case switch. See web/assets/data/scene/scene_completion.json, written by
// tools/extract_scene_completion.py, and tests/lane-b/scene-completion.test.js for
// the oracle that runs every original against this.
//
// What set_flag DOES with a bank is the FLAG API's business, not this module's: the
// disc's `set_flag` dispatcher (F0x800165ac) sends bank 0x74 to the scripted-battle
// launcher, bank 0x70 to the roster action table, other command banks to their
// shared screen/scene queue, and collection banks to their item/card services. So this module asks, through `applySetFlag`, and the
// caller supplies the doors; it never guesses which banks the engine can store.

/** One write a completion routine makes. `value`/`flag` are the numbers the
 *  original passes, not engine-invented ones. */
export type SceneWrite =
  | { op: "set_flag"; flag: number; value: number }
  | { op: "set_ordinal"; value: number };

/** One event's completion routine, as data. */
export interface SceneCompletion {
  mapId: string;
  event: number;
  writes: readonly SceneWrite[];
  /** The disc's five-shape census letter, or null for a routine outside all five. */
  shape: string | null;
  /** pro/wstagNNN.s + .L0x........ of the routine's own entry. */
  cite?: { file?: string; label?: string; line?: number } | undefined;
}

export interface CompletionData {
  stage: string;
  tick: string;
  shape?: string | null;
  cite?: { file?: string; label?: string; line?: number };
  writes: SceneWrite[];
}

export interface CompletionFile {
  stages?: Record<string, { events: Record<string, CompletionData> }>;
}

/** The two doors a completion routine has. */
export interface CompletionSink {
  /** set_flag(id, value) — the banked flag API. */
  setFlag(id: number, value: number): void;
  /** the master story ordinal [0x8004B370]. */
  setOrdinal(step: number): void;
}

/** The disc's five shapes, by (number of flag writes, whether the story step is
 *  written). Null outside all five — see the module header. */
export function shapeOf(writes: readonly SceneWrite[]): string | null {
  const n = writes.filter((w) => w.op === "set_flag").length;
  const o = writes.filter((w) => w.op === "set_ordinal").length;
  if (o === 0) return n === 1 ? "B" : n === 2 ? "A" : n === 3 ? "E" : null;
  if (o === 1 && n === 0) return "C";
  if (o === 1 && n === 1) return "D";
  return null;
}

/**
 * What `set_flag` does with a bank, in the order the disc's dispatcher tries its
 * arms (F0x800165ac). Each hook is optional; a caller supplies only the doors the
 * engine has. Returning true means "handled" — the write is consumed and NOT stored.
 */
export interface SetFlagPolicy {
  /** banks the engine keeps as bit arrays (DW3_BANK_SCHEME.storedBanks). */
  stored(bank: number): boolean;
  /** Shared command door, including commands that launch screens or scenes. */
  command?(command: StoryCommand): void;
  /** Compatibility hook for hosts that only support scripted battles. Command
   *  writes are consumed; the host owns its pending encounter state. */
  launchBattle?(index: number): void;
  /** bank 0x70 — the roster ACTION table (roster_predicate_table.json), e.g.
   *  0x7053 = op-0x18 case 8, a full heal of the active party. Return true when
   *  the action ran, so the bit is not also stored. */
  rosterAction?(id: number): boolean;
  /** banks 0x80–0x8E — the COLLECTION arrays. `index` is the id's low nine bits
   *  (`andi $s0,$a0,0x1ff`), `value` the disc's own argument. Return true when the
   *  write was consumed, so it is not also stored. */
  collection?(index: number, value: number): boolean;
}

/**
 * `set_flag`'s collection range test, exactly as the dispatcher makes it
 * (`F0x800165ac` .L0x800167ec/.L0x80016800: `addiu $v0,$s3,-0x80` in the `bne`
 * delay slot, then `sltiu $v0,0xf` — the short form of `sltiu $v0,$v0,0xf`, so it
 * compares the difference, not a register the .s text implies). Unsigned, so it
 * covers banks 0x80, 0x82, … 0x8E and nothing else.
 */
export const isCollectionBank = (bank: number): boolean => ((bank - 0x80) >>> 0) < 0xf;

/** The bag `collectionWrite` counts into — the walker's single per-id store, the
 *  same one `get_flag(0x80NN)` reads (dw3-config.ts's possession handler). */
export interface CollectionStore {
  add(id: number, n?: number): void;
  remove(id: number, n?: number): void;
}

/**
 * `F0x800161d8(index, value)` — one id's collection byte, the routine behind every
 * `set_flag(0x80NN, value)` on the disc (exe/fns.s .L0x800161d8–.L0x80016310). Read
 * straight out of the interpreter by tests/lane-b/collection-bank-write.test.js:
 *
 *   value != 0 — `lbu A`, `+1`, `sb`, then sign-extend and `slti 0x64`: keep the byte
 *     when it is below 100, else store 99 (.L0x80016200–.L0x80016228). So 0→1 … 98→99,
 *     99→99 (the cap is silent, no message), and 255+1 wraps to 0.
 *   value == 0 — `lb A`, `beqz` (0 stays 0), else `sb` A−1 and sign-extend: a result
 *     above 127 is a NEGATIVE byte and is floored to 0 by `sb $zr` (.L0x80016238–
 *     .L0x8001625c). Then, only if the second array `B[index]` at `+0x20f` is non-zero,
 *     the disc also pulls that id out of the party's item slots (`f10`, called through
 *     the method at `+0x2718` for each of the three deployed members and then over eight
 *     stored ones, .L0x80016274–.L0x800162b8) and takes one off `B[index]`.
 *
 * The walker keeps ONE count per id — its bag — which is the disc's `A[id] + B[id]`:
 * its status menu already moves a copy between the bag and an equipped slot on equip
 * (web/menu.js `removeInventoryOne`/`addInventory`), the disc's own A−1/B+1 pair
 * (pro/stitshop.s .L0x80009d70–.L0x80009d84 and its mirror .L0x80009bc0–.L0x80009bd4).
 * So the +1/−1 pair is the whole write here, and the slot pull-through has no second
 * counter left to move. The 99 cap is the store's own, and it is the same routine's:
 * `Inventory.add` clamps to 99, `remove` floors at 0 (claim
 * items-stack-quantity-cap-99-floor-0-2026-08-04).
 */
export function collectionWrite(
  index: number,
  value: number,
  store: CollectionStore,
): void {
  if (value !== 0) store.add(index, 1);
  else store.remove(index, 1);
}

const bankOf = (id: number): number => (id >> 8) & 0xfe;

/** One flag write, through the disc's own bank dispatch. A bank the engine cannot
 *  store and has no action for is inert; desk indices 2..511 have no command. */
export function applySetFlag(
  id: number,
  value: number,
  sink: Pick<CompletionSink, "setFlag">,
  policy: SetFlagPolicy,
): void {
  const bank = bankOf(id);
  if (isStoryCommandBank(bank)) {
    const command = storyCommand(id);
    if (command) {
      if (policy.command) policy.command(command);
      else if (command.kind === 'battle') policy.launchBattle?.(command.index);
    }
    return;
  }
  if (policy.rosterAction?.(id)) return;
  if (isCollectionBank(bank)) {
    // `F0x800161d8` — one copy of that id joins the collection, and this is the door a
    // finished scene's own routine comes through (all 45 shipped scene writes). The NPC
    // dialogue tables reach the SAME routine by their own route and still have a
    // converted GiveItem row per hand-over; that second home is a named open gap, not a
    // second version of the numbers — see .bunny-scratch/collection-report.md.
    if (policy.collection?.(id & 0x1ff, value)) return;
  }
  if (policy.stored(bank)) sink.setFlag(id, value);
}

/** The screen-pack kind of a card duel (`D0x8008b770(0x700, …)`). */
export const CARD_DUEL_SCREEN_CODE = 0x700;

/** The field's screen-close housekeeping for a card duel — `F0x800169e0`, the
 *  resident export slot `D0x80048ad4` (`fns.s` `.L0x800169e0-.L0x80016a90`). The
 *  field calls it on (re)entry (`pro/fieldstg.s` `.L0x00007ff4-.L0x00008000`
 *  loads slot `+0x18` of the export base `D0x80048abc`, right before the entry
 *  writes the screen's own visited marker at `0x1e00 + screen`), and it asks the
 *  previous-screen-code getter (`D0x8004b448` = `F0x80016b58` → `D0x8004b400`):
 *
 *    previous screen == 0x700 (the card duel):
 *      set_flag(0x11, 1)          — flag 17: a duel was played
 *      set_flag(0x12, 1)          — flag 18: set together with 17
 *      set_flag(0x10, latch != 0) — flag 16: the duel's own result (1 = won)
 *      D0x80048ac0 = 0            — clear the latch (bank-0 word 1)
 *
 *  The latch is what `pro/cardgame` writes on a player win (1) or loss (0)
 *  (claim `cardgame-writes-the-flag-bank-latch-base-relative`); every tamer's
 *  post-duel dialogue states gate on flags 17/16, and their own close lists
 *  clear the pair again, which is what makes a challenge one-shot. */
export function cardDuelCloseWrites(won: boolean): readonly { id: number; value: number }[] {
  return [
    { id: 0x11, value: 1 },
    { id: 0x12, value: 1 },
    { id: 0x10, value: won ? 1 : 0 },
  ];
}

/** Run one event's completion routine: every write, in the original's order.
 *  `policy` is optional; without one, only stored banks are written. */
export function runSceneCompletion(
  completion: SceneCompletion | null | undefined,
  sink: CompletionSink,
  policy?: SetFlagPolicy,
): void {
  if (!completion) return;
  for (const w of completion.writes) {
    if (w.op === "set_ordinal") sink.setOrdinal(w.value);
    else if (policy) applySetFlag(w.flag, w.value, sink, policy);
    else sink.setFlag(w.flag, w.value);
  }
}

const BY_STAGE = new Map<string, Map<number, SceneCompletion>>();

function installStage(stage: string, events: Record<string, CompletionData>): void {
  const m = new Map<number, SceneCompletion>();
  for (const [eventId, row] of Object.entries(events ?? {})) {
    m.set(Number(eventId), {
      mapId: stage,
      event: Number(eventId),
      writes: row.writes,
      shape: row.shape ?? null,
      cite: row.cite,
    });
  }
  BY_STAGE.set(stage, m);
}

/** Install the extracted routines (`scene_completion.json`). */
export function setSceneCompletions(raw: CompletionFile): void {
  BY_STAGE.clear();
  for (const [stage, v] of Object.entries(raw.stages ?? {})) installStage(stage, v.events ?? {});
}

/** Install ONE stage's routines, as the converter emits them (`ConvertedStage
 *  .completions`). GameEngine.loadStage calls this, so a host cannot forget to: the
 *  data travels with the stage it belongs to. */
export function setStageCompletions(
  mapId: string,
  events: Record<string, CompletionData>,
): void {
  installStage(mapId, events);
}

export function sceneCompletion(mapId: string, event: number): SceneCompletion | null {
  return BY_STAGE.get(mapId)?.get(event) ?? null;
}

/** Every installed routine, for tests and for the converter's audit. */
export function sceneCompletions(): SceneCompletion[] {
  const out: SceneCompletion[] = [];
  for (const m of BY_STAGE.values()) out.push(...m.values());
  return out;
}
