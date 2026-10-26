// engine/systems/cutscene-manager.ts
// The wstag cutscene VM, ported from web/cutscene.js (the VM half — drawSprite rendering
// stays in the host). A blocking opcode interpreter with a wait state machine
// (frames/walks/ctx/idle/hook). Entities + textbox are injected by the host; the manager
// mutates entity positions and exposes camera/emote/handoff state for the renderer to read.
//
// The opcode mnemonics (SETPOS/SAY/HANDOFF…) are wstag content tokens, not engine API.
// parseEntry (DW3 lang markup) comes from engine/dw3.

import { parseEntry, type ParsedDialogue } from "../dw3/dialogue-parse.ts";
import { emoteSound } from "./emote-sounds.ts";

import {
  FIELD_TICK_SECONDS,
  FIELD_WALK_MAGNITUDE,
  consumeFieldTicks,
  fieldDirectionDelta,
  type FieldDirection,
} from "./field-movement.ts";
const DIR8 = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"];
const EFFECT_ID_THRESHOLD = 800;

// Speech-bubble effect objects. fieldstg handler 0x80084dd0 sends `SETANIM <E> <C> <T>` with
// E >= 0x320 to the effect registry (RAM 0x8009B3E8, {id, create, configure} x 0xC). E 803..806
// all map to the resident bubble actor (create 0x80088190 -> factory 0x80088144, tick
// 0x80087f84; configure 0x800881B8). The configure switch on C:
//   0x325 (805) open, glyph program row 0, FUKIDASH 0x40007 on the init tick
//   0x327 (807) open, glyph program row 1, silent
//   0x326 (806) vt+0x28(2): the close animation
//   anything else: no effect.
// T is the actor the bubble rides on (lookup (5, T, -1) stored at +0x50).
export const BUBBLE_EFFECT_IDS: readonly number[] = [803, 804, 805, 806];
export const BUBBLE_OPEN = 0x325, BUBBLE_CLOSE = 0x326, BUBBLE_OPEN_SILENT = 0x327;

// E 813 is the resident scene object (create 0x80083cd8, configure 0x800837ec). C 823 (0x337)
// makes its tick call 0x80090e70: the party followers (indices 2/4/8) run the rest of their
// trail into the leader and park (field-movement.ts followerGatherSample). T is not read.
export const SCENE_OBJECT_ID = 813, PARTY_GATHER = 0x337;

// The same `SETANIM 813 <C>` route also arms the resident FIELDCOM sparkle actor (object
// type 0x16, owner = field character 0 = the player). The type-0x32d object's notify handler
// F0x800837EC compares the opcode's SECOND operand and calls the sparkle object's setSub1
// (+0x2c): 0x338 -> 1, 0x339 -> 2, 0x34A -> 3. Read from the writer census in
// bank70-opcode-handlers-decoded-2026-07-27.md — "fieldstg 0x800837ec with 1, 2 or 3 for
// notify ids 0x338, 0x339, 0x34a, with no branch passing 0" — and the two call sites in
// fieldstg.fns.s (F0x800837EC, file 0xb54-0xbd8). 0x337 (the party gather, PARTY_GATHER) is
// NOT in this map: it takes the F0x800837EC branch that calls setSub1 on the type-0x32d
// object itself, not on the sparkle, so it does not select a sparkle program.
// Program 1/2 are the two scripts the actor was missing (web/fieldcom.js SPARKLE_PROGRAMS);
// program 3 is the acquisition flare the bank-0x70 PlaySparkle(3) op already drives.
export const SPARKLE_ARM_PROGRAMS: Readonly<Record<number, number>> = { 0x338: 1, 0x339: 2, 0x34A: 3 };

export interface CutsceneBubble {
  /** glyph program row in table 0x800975c0 (0 or 1). */
  row: number;
  actor: number;
  /** true when the open was 805 (the init tick plays FUKIDASH). */
  sound: boolean;
  /** cutscene clock (seconds) when this bubble began its pop-in. */
  openedAt: number;
  /** cutscene clock (seconds) when 806 began the close; null while open. */
  closedAt: number | null;
}

export interface CutEntity {
  x: number;
  y: number;
  dir?: string;
  playerName?: string;
  /** A scripted walk latched by WALKTO. `facing` is the opcode's 4th operand: the
   *  walk driver stores it to char+0x60 on arrival (fieldstg file 0xc2f0-0xc30c). */
  _cutTarget?: { x: number; y: number; facing?: number | undefined };
  _inCutscene?: boolean;
  _animTime?: number;
  /** Last SETANIM clip id targeting this actor (see field-actor-anim-engine.md); the
   * renderer resolves it via `clipFrame`, falling back to idle/walk when unset or unmapped. */
  activeClip?: number | undefined;
  [k: string]: unknown;
}

export interface Textbox {
  isOpen(): boolean;
  open(parsed: ParsedDialogue, cb: () => void): void;
}

export interface CutsceneOpts {
  spawnActor?: (actorId: number) => CutEntity | null;
  /** Whether the stage's cast rebuild built the player as charId 1 (P001PLAY): a charId-1
   *  record of the cast list (descriptor +0x4C) passed its flag list. null = unknown (data
   *  missing); the scene's own use of actor 1 then decides. */
  playerCastOne?: () => boolean | null;
  animDurations?: Record<number, number>;
  emoteKinds?: Record<number, string>;
  /** SETANIM >= 0x320 native-effect route (the wstag interpreter): return true
   *  when the current stage's registered native handler consumed the id --
   *  then the generic emote-bubble path is skipped (faithful: the console's
   *  effect registry dispatches these to per-stage native code). */
  fireNativeEffect?: (id: number, anim: number, facing: number) => boolean;
  /** `SETANIM 813 <C>` emote-sound route (fieldstg F0x800837EC tail). The host plays
   *  the packed word the C resolves to (engine/systems/emote-sounds.ts); `stop` marks
   *  the `C >= 0x384` branch ids that key a voice off by handle instead of starting one. */
  emoteSound?: (id: number, stop: boolean) => void;
  /** Quest scenes' own event opcode (`SCENEEVENT <index>`): the step list in web/quest-scenes.js is data, so any
   *  event it needs that the wstag vocabulary has no opcode for (our own effect art, a screen fade, a mid-scene
   *  battle, the player's own Y drive, a warp) arrives here. The host performs it and calls `resume` when it is
   *  done; the scene waits meanwhile. A host that is finished at once may call `resume` immediately, and a host
   *  with no handler lets the opcode fall through — a scene never blocks on an event the host cannot run. */
  sceneEvent?: (index: number, resume: () => void) => void;
  movementTerrainCode?: (entity: CutEntity) => number;
}

export type AfterSayHook = (resume: () => void) => void;
export interface CutsceneHooks {
  afterSay?: Record<number, AfterSayHook>;
}

export interface Cutscene {
  isActive(): boolean;
  start(opcodes: string[], esdmgStrings: (string | null)[] | null, onDone?: (() => void) | null, hooks?: CutsceneHooks | null): void;
  /** End the scene now, without running the rest of its opcodes: a host event that cannot finish (a lost battle,
   *  whose own route leaves the field) calls this. The done callback runs as for END, so the host still cleans up. */
  abort(): void;
  step(dt: number): boolean;
  handoff: { screenId: number; x: number; y: number; dir: number } | null;
  speakingActor: number | null;
  /** SAY mode operand (balloon quadrant 0-3; 4 = plain system window). Decoded:
   *  fieldstg SAY handler F0x80085128 -> window controller 0x80088ca0 -> the
   *  D0x8004dcf4 per-mode layout table. null while no one is speaking. */
  speakingMode: number | null;
  /** raw pack line index of the SAY being shown = the operand p1 (raw line 0 of an ESDMG entry is an empty placeholder, so the walker string is p1 - 1); null when none. */
  speakingLine: number | null;
  /** Verified FN6 camera target. Mode 1 snaps/follows exactly; mode 0 pans. */
  camera: { x: number; y: number; mode: "snap" | "pan" } | null;
  /** Non-bubble effect commands (E >= 800 other than 803..806) not taken by the native
   *  registry. Kept for hosts that key cues on them; nothing draws a glyph for these. */
  emotes: Map<number, { anim: number; actor: number }>;
  /** Live bubble actors by effect id 803..806 (see BUBBLE_EFFECT_IDS). A closed bubble stays
   *  here with closedAt set; the host stops drawing it when the close animation ends. */
  bubbles: Map<number, CutsceneBubble>;
  /** Cutscene clock (seconds) when `SETANIM 813 823` gathered the party; null if not this scene. */
  partyGatherAt: number | null;
  /** Monotonic count of sparkle arms this VM has fired (`SETANIM 813 <C>` with C in
   *  SPARKLE_ARM_PROGRAMS) and the program the latest one selected. Never reset by `start`,
   *  so a host can arm the player's sparkle actor exactly once per notify by comparing to the
   *  count it last consumed. */
  sparkleSeq: number;
  sparkleProgram: number;
  /** Script actor id that resolves to the player in this scene (1 or 2). Script ids are
   *  charIds (resolver 0x80084d8c matches slot +0x64 = entity +0x4). The player is built with
   *  charId 2 (Junior, P002PLAY) unless the stage cast list has a charId-1 record
   *  (F0x8008aa10, fieldstg.s 8368-8379); party followers carry species + 3, so ids 1/2
   *  are never a partner. The other of 1/2 resolves to nothing (a no-op, as in 0x80084dd0). */
  playerActorId: number;
  /** The entity a script actor id names, or null: the same lookup the opcodes use, minus
   *  spawning. SAY anchors its balloon to `speaker = lookup(actor)` (0x80088ca0's caller,
   *  field-script-engine-verified.md), and the opening's own line has the PLAYER as its
   *  speaker, so a host that resolves speakers from the scene NPC list alone misses it. */
  entity(actorId: number): CutEntity | null;
  /** Seconds of cutscene time since start (the bubble timestamps use this clock). */
  clock(): number;
  /** Native field ticks in which at least one WALKTO actor moved during the last step.
   *  The original fires footsteps from this shared walk-mode handler every 8 ticks. */
  walking(): number;
  /** Native field ticks the PLAYER alone moved during the last step. The footstep cue
   *  is the player's own (fieldstg F0x8008FED0's only step-sound caller), so the walk
   *  sound's tick count is this, not `walking()`'s max over every scripted actor. */
  playerWalking(): number;
  /** Debug: the blocking wait the interpreter is parked in and its opcode index.
   *  `mode` is "frames" | "idle" | "ctx" | "say" | null. */
  debugWait(): { mode: string | null; frames: number; actor: number; pc: number };
  /** Debug: the opcodes from the current pc forward, for a stalled cutscene. */
  debugOpcodes(): string[];
}

export function createCutscene(
  textbox: Textbox,
  getPlayer: () => CutEntity | null,
  getNpc: (id: number) => CutEntity | null,
  opts: CutsceneOpts = {},
): Cutscene {
  let _active = false;
  let _opcodes: string[] = [];
  let _strings: (string | null)[] | null = null;
  let _pc = 0;
  let _waitMode: string | null = null;
  let _waitFrames = 0;
  let _waitActorId = 0;
  let _onDone: (() => void) | null = null;
  let _camActorId: number | null = null;
  let _camMode: "snap" | "pan" = "pan";
  let _hooks: CutsceneHooks | null = null;
  let _pendingHook: AfterSayHook | null = null;
  let _fieldTickAccumulator = 0;
  const _lastAnim = new Map<number, number>();
  const _sayQueue: { parsed: ParsedDialogue; line: number; actorId: number | null; mode: number | null; hookP1: number | null }[] = [];

  const cs: Cutscene = {
    handoff: null,
    speakingActor: null,
    speakingMode: null,
    speakingLine: null,
    camera: null,
    emotes: new Map(),
    bubbles: new Map(),
    partyGatherAt: null,
    sparkleSeq: 0,
    sparkleProgram: 0,
    playerActorId: 1,
    clock: () => _clock,
    isActive: () => _active,
    abort: () => { if (_active) _finish(); },
    entity: (actorId: number) => _lookup(actorId, false),
    walking: () => _walkedTicksThisStep,
    playerWalking: () => _playerWalkedTicksThisStep,
    debugWait: () => ({ mode: _waitMode, frames: _waitFrames, actor: _waitActorId, pc: _pc }),
    debugOpcodes: () => _opcodes.slice(Math.max(0, _pc - 2), _pc + 6),
    start: (opcodes, esdmgStrings, onDone, hooks) => {
      _active = true;
      _opcodes = opcodes;
      _strings = esdmgStrings;
      _pc = 0;
      _waitMode = null;
      _waitFrames = 0;
      _waitActorId = 0;
      _onDone = onDone ?? null;
      _camActorId = null;
      _camMode = "pan";
      cs.camera = null;
      _lastAnim.clear();
      cs.handoff = null;
      cs.speakingActor = null;
      cs.speakingMode = null;
      cs.speakingLine = null;
      cs.emotes.clear();
      cs.bubbles.clear();
      cs.partyGatherAt = null;
      const castOne = opts.playerCastOne ? opts.playerCastOne() : null;
      cs.playerActorId = castOne === null ? (opcodes.some((o) => _namesActorOne(o)) ? 1 : 2) : castOne ? 1 : 2;
      _clock = 0;
      _walkActors.clear();
      _spawned.clear();
      _hooks = hooks ?? null;
      _pendingHook = null;
      _fieldTickAccumulator = 0;
      _sayQueue.length = 0;
    },
    step: (dt) => step(dt),
  };

  let _clock = 0;
  const _spawned = new Map<number, CutEntity>();
  function _namesActorOne(op: string): boolean {
    const p = op.split(" ");
    return (p[0] === "SETPOS" || p[0] === "WALKTO" || p[0] === "SETANIM" || p[0] === "WAITIDLE") && p[1] === "1";
  }

  function _entity(actorId: number): CutEntity | null {
    return _lookup(actorId, true);
  }

  /** The decoded actor lookup (`actor_lookup` 0x80084d8c): the player for this scene's own
   *  player id, then the scene's NPC record, then an actor this cutscene already spawned.
   *  `allowSpawn` is false for a host asking "who is this actor" — a SAY speaker must be an
   *  actor that exists, never one the lookup conjures. */
  function _lookup(actorId: number, allowSpawn: boolean): CutEntity | null {
    if (actorId === cs.playerActorId) return getPlayer();
    if (actorId === 1 || actorId === 2) return null;
    const e = getNpc(actorId);
    if (e) return e;
    if (_spawned.has(actorId)) return _spawned.get(actorId)!;
    if (!allowSpawn) return null;
    const s = opts.spawnActor ? opts.spawnActor(actorId) : null;
    if (s) _spawned.set(actorId, s);
    return s;
  }

  function _finish(): void {
    _active = false;
    _camActorId = null;
    _camMode = "pan";
    cs.camera = null;
    const cb = _onDone;
    _onDone = null;
    if (cb) cb();
  }

  function _parseOp(opStr: string): { name: string; args: number[] } {
    const parts = opStr.split(" ");
    return { name: parts[0]!, args: parts.slice(1).map(Number) };
  }

  function _run(dt: number): void {
    while (_pc < _opcodes.length) {
      const { name, args } = _parseOp(_opcodes[_pc]!);
      const a0 = args[0], a1 = args[1], a2 = args[2];

      if (name === "END") { _finish(); return; }
      if (name === "FN6B") {
        _camMode = (a0 ?? 0) !== 0 ? "snap" : "pan";
        cs.camera = { x: a1 ?? 0, y: a2 ?? 0, mode: _camMode };
        _camActorId = null;
        _pc++; continue;
      }
      if (name === "FN6A") {
        _camMode = (a0 ?? 0) !== 0 ? "snap" : "pan";
        _camActorId = a1 ?? null;
        const t = _camActorId != null ? _entity(_camActorId) : null;
        if (t) cs.camera = { x: t.x, y: t.y, mode: _camMode };
        _pc++; continue;
      }
      if (name === "WAITFLAG") {
        const dur = (opts.animDurations ?? {})[_lastAnim.get(a0 ?? -1) ?? -1] ?? 48;
        _waitMode = "frames";
        _waitFrames = dur;
        _pc++;
        return;
      }

      if (name === "SETPOS") {
        if (a0 !== undefined && a0 < EFFECT_ID_THRESHOLD) {
          const e = _entity(a0);
          if (e) { e.x = a1 ?? 0; e.y = a2 ?? 0; e._inCutscene = true; }
        }
        _pc++; continue;
      }

      if (name === "SETANIM") {
        if (a0 !== undefined && a0 < EFFECT_ID_THRESHOLD) {
          const e = _entity(a0);
          if (e) { e.dir = DIR8[(a2 ?? 0) & 7]!; e._inCutscene = true; e.activeClip = a1; }
          if (a1 !== undefined) _lastAnim.set(a0, a1);
          // The actor's own SETANIM method (fieldstg F0x8008F4C8, installed at actor
          // +0x148) STOPS ANY WALK IN PROGRESS before it plays the clip:
          //   `arg0->unkEC = 0; arg0->unk2C(arg0, 0); arg0->unk60 = facing; F0x8008f4b4(anim)`
          // (+0xEC is the walking flag WAITIDLE tests, +0x2C requests action mode 0).
          // Without this the manager keeps the stale walk target, so a scene that does
          // `WALKTO <actor> … / WAIT / SETPOS <actor> 0 0 / SETANIM <actor> 1 1` (the
          // Kusanagi street's crossing girl, s780 event 0, is exactly this) teleports the
          // actor and then walks it across the whole map to the old target again.
          // This is an actor ID (< 0x320), so it drives a field entity, not an effect.
          if (e) {
            delete e._cutTarget;
            if (a0 === cs.playerActorId) _walkActors.delete(cs.playerActorId);
            else _walkActors.delete(a0);
          }
        } else if (a0 === SCENE_OBJECT_ID) {
          // The resident scene object's own notify route (fieldstg F0x800837EC). T (a2) is
          // not read. `SETANIM 813 823` = the party gather; `SETANIM 813 <0x338|0x339|0x34A>`
          // arms the player's FIELDCOM sparkle actor with program 1/2/3.
          if (a1 === PARTY_GATHER && cs.partyGatherAt === null) cs.partyGatherAt = _clock;
          const program = a1 !== undefined ? SPARKLE_ARM_PROGRAMS[a1] : undefined;
          if (program !== undefined) { cs.sparkleSeq += 1; cs.sparkleProgram = program; }
          // The same notify tail dispatches the emote-sound range (C 0x365..0x383,
          // plus the >0x383 branch) through fieldstg's jump table to the play cell.
          // The host decides how to sound it; the manager only reports the cue.
          if (a1 !== undefined) {
            const cue = emoteSound(a1);
            if (cue) opts.emoteSound?.(cue.id, cue.stop);
          }
        } else if (a0 !== undefined && BUBBLE_EFFECT_IDS.includes(a0)) {
          _configureBubble(a0, a1 ?? 0, a2 ?? 0);
        } else if (a0 !== undefined) {
          if (!opts.fireNativeEffect?.(a0, a1 ?? 0, a2 ?? 0)) {
            const anim = a1 ?? 0, target = a2 ?? 0;
            if ((opts.emoteKinds ?? {})[anim] === "clear") cs.emotes.delete(a0);
            else cs.emotes.set(a0, { anim, actor: target });
          }
        }
        _pc++; continue;
      }

      if (name === "WALKTO") {
        // Non-blocking (disasm-verified: field-script-engine-verified.md — "the engine runs
        // all non-blocking ops in a single frame, only yielding on WAIT/WAITCTX/WAITIDLE/
        // WAITFLAG/HANDOFF/END"; WALKTO is not in that list). So back-to-back WALKTO opcodes
        // for different actors (e.g. the opening scene's "WALKTO 1.../WALKTO 11.../WALKTO
        // 12.../WAITIDLE 1") all kick off THE SAME TICK and walk in parallel — only an
        // explicit WAITIDLE <actor> actually blocks, and only for that one named actor.
        // Previously this set a shared "walks" wait-mode that blocked ALL further opcode
        // execution until every currently-walking actor arrived, so the next WALKTO in the
        // script never even started until the previous one finished — sequential instead
        // of parallel, the reported "one NPC at a time" bug.
        if (a0 !== undefined && a0 < EFFECT_ID_THRESHOLD) {
          const e = _entity(a0);
          // The 4th operand is the ARRIVAL FACING, not a speed: walk_to (fieldstg
          // F0x8008efd0, file 0xc320-0xc334) latches x into +0xf0, y into +0xf4 and
          // the operand into +0xf8; the walk driver only reads +0xf8 on the arrival
          // arm, storing it to the facing +0x60 (file 0xc2f0-0xc30c). It is a 0-7
          // direction index (the shipped 823 WALKTOs carry 0-7).
          if (e) { e._cutTarget = { x: a1 ?? 0, y: a2 ?? 0, facing: args[3] }; e._inCutscene = true; }
          _walkActors.add(a0);
        }
        _pc++;
        continue;
      }

      if (name === "WAIT") {
        _waitMode = "frames";
        _waitFrames = a0 ?? 0;
        _pc++;
        return;
      }

      if (name === "WAITCTX") {
        _waitMode = "ctx";
        _pc++;
        return;
      }

      if (name === "WAITIDLE") {
        _waitMode = "idle";
        _waitActorId = a0 ?? 0;
        _pc++;
        return;
      }

      if (name === "SAY") {
        const p1 = a1 ?? 0;
        const actorId = a2;
        // 4th operand = window mode: 0-3 anchored-balloon quadrant, 4 = plain
        // unanchored system window (wstag-script-decode.md SAY op).
        const mode = args[3] ?? 0;
        const spkId = (actorId != null && actorId < EFFECT_ID_THRESHOLD && mode !== 4) ? actorId : null;
        // The original's own two-way rule (F0x80084ECC, exe-decomp/fieldstg_c/F0x80084ecc.c
        // :118-131): mode 4 is the unanchored bottom window, and any other mode needs the
        // speaker to resolve — `F0x80084D8C(scene, actor)` returning 0 makes the interpreter
        // step past the SAY (`goto block_31`) with NO window at all. The walker used to fall
        // back to the plain window instead, which cannot finish a line carrying the
        // `02 07 02 09` speaker-name prefix: that token's handler returns 0, which ends the
        // draw run, so widget+0xC3 never becomes 1 and the window's confirm never closes it
        // (all 70 mode-4 lines in the shipped events carry no name prefix).
        const absent = spkId != null && _lookup(spkId, false) == null;
        const raw = _strings?.[p1 - 1] ?? null;
        if (raw && !absent) {
          const parsed = parseEntry(raw, getPlayer()?.playerName || "Junior");
          if (parsed && parsed.pages.length > 0) {
            if (textbox.isOpen()) {
              _sayQueue.push({ parsed, line: p1, actorId: spkId, mode: spkId != null ? mode : null, hookP1: _hooks?.afterSay?.[p1] ? p1 : null });
            } else {
              cs.speakingActor = spkId;
              cs.speakingMode = spkId != null ? mode : null;
              cs.speakingLine = p1;
              textbox.open(parsed, () => {});
              if (_hooks?.afterSay?.[p1]) _pendingHook = _hooks.afterSay[p1]!;
            }
          }
        } else if (_hooks?.afterSay?.[p1]) {
          _pendingHook = _hooks.afterSay[p1]!;
        }
        _pc++; continue;
      }

      if (name === "HANDOFF") {
        cs.handoff = { screenId: a0 ?? 0, x: a1 ?? 0, y: a2 ?? 0, dir: args[3] ?? 0 };
        _finish();
        return;
      }

      // A quest scene's own event (web/quest-scenes.js): the host does it and calls resume. The wait is the same
      // "hook" state a SAY's after-say hook uses, so a host that resumes synchronously (an event that is already
      // done, or one it cannot run at all) just lets the next opcode go on the following frame.
      if (name === "SCENEEVENT") {
        const fn = opts.sceneEvent;
        if (!fn) { _pc++; continue; }
        _waitMode = "hook";
        _pc++;
        fn(a0 ?? 0, () => { if (_waitMode === "hook") _waitMode = null; });
        return;
      }

      _pc++;
    }
    _finish();
  }

  let _walkedTicksThisStep = 0;
  let _playerWalkedTicksThisStep = 0;

  /** The walk driver's direction nibble: SIGN-based, both axes independently
   *  (fieldstg F0x8008eef0, file 0xc28c-0xc2d4: `slt` curX<targetX -> 0x20 right,
   *  `slt` targetX<curX -> 0x80 left, the same pair for Y -> 0x40 down / 0x10 up).
   *  It is NOT an angle octant: any target with a non-zero delta on both axes walks
   *  a diagonal, however lopsided. The comparisons are on the integer pixels
   *  (`curX>>8`), which is what `Math.floor` reproduces for the float positions. */
  function _walkNibble(px: number, py: number, target: { x: number; y: number }): string {
    const dx = px < target.x ? 1 : target.x < px ? -1 : 0;
    const dy = py < target.y ? 1 : target.y < py ? -1 : 0;
    if (dy > 0) return dx < 0 ? "down-left" : dx > 0 ? "down-right" : "down";
    if (dy < 0) return dx < 0 ? "up-left" : dx > 0 ? "up-right" : "up";
    return dx < 0 ? "left" : "right";
  }

  function _moveToward(e: CutEntity, target: { x: number; y: number; facing?: number | undefined }, ticks: number): number {
    let movedTicks = 0;
    for (let tick = 0; tick < ticks; tick++) {
      // The driver tests ARRIVAL FIRST, every tick (fieldstg file 0xc258-0xc284):
      // `(curX>>8)>>1 == targetX>>1 && (curY>>8)>>1 == targetY>>1`. On arrival it
      // snaps +0x50/+0x54 to the target's exact px<<8, clears the walking flag
      // +0xec, writes the WALKTO mode operand (+0xf8) into the facing +0x60, and
      // requests action mode 1 (idle). The walker's old `dist < 2` test arrived up
      // to two ticks early and never applied the operand facing.
      const px = Math.floor(e.x), py = Math.floor(e.y);
      if ((px >> 1) === (target.x >> 1) && (py >> 1) === (target.y >> 1)) {
        e.x = target.x;
        e.y = target.y;
        if (target.facing != null) e.dir = DIR8[target.facing & 7]!;
        delete e._cutTarget;
        break;
      }
      // No overshoot clamp: the driver adds the vector and lets the next tick's
      // arrival test catch the target, exactly as the assembly does.
      e.dir = _walkNibble(px, py, target);
      const delta = fieldDirectionDelta(
        e.dir as FieldDirection,
        FIELD_WALK_MAGNITUDE,
        opts.movementTerrainCode?.(e) ?? 0,
      );
      e.x += delta.x;
      e.y += delta.y;
      movedTicks++;
    }
    _walkedTicksThisStep = Math.max(_walkedTicksThisStep, movedTicks);
    e._animTime = (e._animTime ?? 0) + movedTicks * FIELD_TICK_SECONDS;
    return movedTicks;
  }

  const _walkActors = new Set<number>();

  function _advanceWalks(ticks: number): void {
    _walkedTicksThisStep = 0;
    _playerWalkedTicksThisStep = 0;
    const p = getPlayer();
    if (p?._cutTarget) {
      // The player's own moved-ticks, kept apart from the any-actor max: the
      // walk sound is the player's, so a scripted NPC that moved further in the
      // same step must not inflate the player's footstep cadence.
      _playerWalkedTicksThisStep = _moveToward(p, p._cutTarget, ticks);
      if (!p._cutTarget) _walkActors.delete(cs.playerActorId);
    } else {
      _walkActors.delete(cs.playerActorId);
    }
    for (const actorId of [..._walkActors]) {
      if (actorId === cs.playerActorId) continue;
      const e = _entity(actorId);
      if (e?._cutTarget) _moveToward(e, e._cutTarget, ticks);
      else _walkActors.delete(actorId);
    }
  }

  // configure 0x800881B8. Open on a live bubble only changes its row and anchor (the
  // dispatcher does not reset state +0xc, so no new pop-in and no new sound). Open on a closed
  // bubble starts a new one: HYPOTHESIS, the code that recycles a state-3 actor is not read.
  function _configureBubble(id: number, cmd: number, target: number): void {
    const b = cs.bubbles.get(id);
    if (cmd === BUBBLE_OPEN || cmd === BUBBLE_OPEN_SILENT) {
      const row = cmd === BUBBLE_OPEN ? 0 : 1;
      if (b && b.closedAt === null) { b.row = row; b.actor = target; return; }
      cs.bubbles.set(id, { row, actor: target, sound: row === 0, openedAt: _clock, closedAt: null });
    } else if (cmd === BUBBLE_CLOSE) {
      if (b && b.closedAt === null) b.closedAt = _clock;
    }
  }

  function step(dt: number): boolean {
    if (!_active) return false;
    _clock += dt;

    if (_camActorId != null) {
      const t = _entity(_camActorId);
      if (t) cs.camera = { x: t.x, y: t.y, mode: _camMode };
    }

    const fieldTicks = consumeFieldTicks(_fieldTickAccumulator, dt);
    _fieldTickAccumulator = fieldTicks.accumulator;
    _advanceWalks(fieldTicks.ticks);

    if (_waitMode === "frames") {
      _waitFrames--;
      if (_waitFrames > 0) return true;
      _waitMode = null;
    } else if (_waitMode === "ctx") {
      if (textbox.isOpen()) return true;
      if (_sayQueue.length > 0) {
        const next = _sayQueue.shift()!;
        cs.speakingActor = next.actorId;
        cs.speakingMode = next.mode;
        cs.speakingLine = next.line;
        textbox.open(next.parsed, () => {});
        if (next.hookP1 != null && _hooks?.afterSay?.[next.hookP1]) {
          _pendingHook = _hooks.afterSay[next.hookP1]!;
        }
        return true;
      }
      cs.speakingActor = null;
      cs.speakingMode = null;
      cs.speakingLine = null;
      if (_pendingHook) {
        const h = _pendingHook;
        _pendingHook = null;
        _waitMode = "hook";
        h(() => { if (_waitMode === "hook") _waitMode = null; });
        return true;
      }
      _waitMode = null;
    } else if (_waitMode === "hook") {
      return true;
    } else if (_waitMode === "idle") {
      const e = _entity(_waitActorId);
      if (e?._cutTarget) return true;
      _waitMode = null;
    }

    _run(dt);
    return _active;
  }

  return cs;
}
