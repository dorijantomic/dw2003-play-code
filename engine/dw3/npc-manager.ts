import { isStoryCommandBank } from '../systems/story-command-banks.ts';
import { confirmRedirectId } from './npc-confirm-redirects.ts';
// engine/dw3/npc-manager.ts
// DW3 NPC variant selection: spawn-flag AND-list gate + chapter/ordinal fallback +
// slot/position dedup (the decoded spawn-gate model, §WS4.9), and the decoded
// confirm press's target rules (the box probe F0x8008E210 and the interact
// handler F0x8008E2CC's refuse ids + id-redirect table). Canonical home of these
// helpers (formerly duplicated in web/scene.js).

import { ACTION_POINT_OFFSETS } from "../systems/tree-kick.ts";

// `dialogue` is whatever the scene authors carry per NPC — in the live game a
// { file, index } reference, but kept generic so the helper is agnostic to its shape.
export function pickDialogue<D>(
  npc: { ifFlag?: { flag: string; dialogue: D }; dialogue: D },
  flags: Record<string, unknown>,
): D {
  if (npc.ifFlag && flags[npc.ifFlag.flag]) return npc.ifFlag.dialogue;
  return npc.dialogue;
}

export interface FlagCond { id: number; expected: number }
export interface DialogueRef { file: string; index: number }
export interface DialogueState { gate?: FlagCond[]; dialogue: DialogueRef; on_close?: FlagCond[] }

/**
 * The NPC dialogue state machine (talk handler F0x80090afc, §WS5): return the FIRST
 * `dialogue_state` whose flag `gate` passes against the live flag store, else null.
 * `getCond(id) => 0|1|null` is the same tri-state predicate as spawn gating
 * (null = unmodelled → permissive). The caller applies the returned state's `on_close`
 * flags when the textbox closes (advancing the NPC's state).
 */
export function pickDialogueState(
  npc: { dialogue_states?: DialogueState[] },
  getCond: ((id: number) => 0 | 1 | null) | null,
): DialogueState | null {
  const states = npc.dialogue_states;
  if (!states || !states.length) return null;
  for (const st of states) {
    let ok = true;
    for (const c of st.gate ?? []) {
      const v = getCond ? getCond(c.id) : null;
      if (!isStoryCommandBank((c.id >>> 8) & 0xfe) && v !== null && v !== c.expected) { ok = false; break; }
    }
    if (ok) return st;
  }
  return null;
}

/**
 * Derive the current story chapter from the banked story-flag store: the highest ladder
 * rung whose decoded milestone flag is set, else the table default (1).
 */
export function deriveChapter(
  getFlag: (id: number) => 0 | 1 | boolean,
  table: { default_chapter?: number; ladder?: { chapter: number; flag: number | null }[] },
): number {
  let ch = table?.default_chapter ?? 1;
  for (const rung of table?.ladder ?? []) {
    if (rung.flag != null && getFlag(rung.flag) && rung.chapter > ch) ch = rung.chapter;
  }
  return ch;
}

export interface NpcPlacement {
  x: number;
  y: number;
  slot?: number;
  n?: number;
  cutsceneOnly?: boolean;
  spawn_flags?: { id: number; expected: number }[];
  [k: string]: unknown;
}

/**
 * Select the live NPC placements. When `getCond` is supplied the selection is the
 * FAITHFUL spawn model (npc-decode.md, disasm-proven 2026-06-27): the only spawn gate
 * is the per-record flag-condition AND-list — a record WITHOUT a flag list spawns
 * unconditionally (`n` is record+0x10 → entity+0x60, NOT a chapter comparison; the old
 * "max n ≤ chapter" reading hid ungated NPCs like the s245 merchants until chapter 7).
 * A definitively-failing condition hides the record; an UNMODELLED condition reads
 * null and is treated permissively. Omit getCond → legacy n/chapter behavior.
 *
 * The disc's spawn loop (fieldstg.s file 0x83dc-0x8498) walks the stage's cast array
 * and CONSTRUCTS AN ACTOR FOR EACH record whose list passes — there is no per-slot
 * "one live placement wins" selection and no position de-dup. Per-slot variants are
 * mutually-exclusive flag lists (§WS4.9/§WS4.10), so the old max-`n` pick and the
 * (x,y) de-dup were both remnants of the superseded model and hid actors the original
 * builds (e.g. s580 npc 105's five Numemon spots, each gated on its own stored bit;
 * s270's stacked dialogue variants). Keep every eligible record, in record order —
 * the order the original's registry walk and its first-match talk probe use.
 */
export function chapterNpcs(
  npcs: NpcPlacement[],
  chapter: number,
  getCond: ((id: number) => 0 | 1 | null) | null = null,
): NpcPlacement[] {
  if (getCond) {
    const eligible: NpcPlacement[] = [];
    for (const npc of npcs) {
      let ok = true;
      for (const c of npc.spawn_flags ?? []) {
        const v = getCond(c.id);
        if (!isStoryCommandBank((c.id >>> 8) & 0xfe) && v !== null && v !== c.expected) { ok = false; break; } // definitively fails → hide
      }
      if (ok) eligible.push(npc); // empty/absent flag list = unconditional spawn
    }
    return eligible;
  }
  const eligible = (npc: NpcPlacement): boolean => npc.n === undefined || npc.n <= chapter; // legacy fallback
  const slotMap = new Map<number, NpcPlacement>();
  const noSlot: NpcPlacement[] = [];
  const cutsceneOnly: NpcPlacement[] = [];
  for (const npc of npcs) {
    if (!eligible(npc)) continue;
    if (npc.slot === undefined) { noSlot.push(npc); continue; }
    if (npc.cutsceneOnly) { cutsceneOnly.push(npc); continue; }
    const prev = slotMap.get(npc.slot);
    if (!prev || (npc.n ?? 0) > (prev.n ?? 0)) slotMap.set(npc.slot, npc);
  }
  const posMap = new Map<string, NpcPlacement>();
  for (const npc of slotMap.values()) {
    const key = `${npc.x},${npc.y}`;
    const prev = posMap.get(key);
    if (!prev || npc.slot! < prev.slot!) posMap.set(key, npc);
  }
  return [...noSlot, ...posMap.values(), ...cutsceneOnly];
}

/**
 * The stage's BUILT cast: `chapterNpcs` evaluated ONCE per stage entry and reused.
 *
 * The disc's spawn loop (fieldstg.s file 0x83dc-0x8498) runs at STAGE BUILD, and the
 * actors it constructs are the live cast until the stage is left. A flag write during
 * the stage does not add or remove an actor: the disc removes an actor only through the
 * scene's own action — `SETPOS <actor> 0 0` parks it off-map — or the actor's own remove
 * call. Re-reading the gate every frame removed actors the moment they wrote their own
 * spawn flag (the Wind Prairie hide-and-seek talk: Veemon's dialogue state sets 6693=0,
 * his own variant-A gate, so he vanished as the textbox closed, before the scene it
 * started had named him). Snapshot here; `holder` is the scene object, and the caller
 * clears `holder._cast` when it re-enters the stage so the next arrival re-runs the gate.
 */
export function stageCast<T extends NpcPlacement>(
  holder: { _cast?: T[] | null },
  npcs: T[],
  chapter: number,
  getCond: ((id: number) => 0 | 1 | null) | null = null,
): T[] {
  if (holder._cast == null) holder._cast = chapterNpcs(npcs, chapter, getCond) as T[];
  return holder._cast;
}

/**
 * An actor's own remove: it leaves the field for good, it is not merely gated off.
 *
 * The disc's field characters carry a remove method; the block actors call their own
 * `+0x28(3)` when their break-apart clip ends (engine/systems/block-actor.ts, the
 * `gone` event). Off the built cast, a gate flip no longer removes an actor, so an
 * actor that really leaves must be dropped from the scene list and the built cast
 * here. (A scene that only moves an actor out of sight uses `SETPOS <actor> 0 0`
 * instead, which this does not touch.)
 */
export function removeSceneActor<T extends NpcPlacement>(
  holder: { _cast?: T[] | null },
  npcs: T[],
  npc: T,
): void {
  const i = npcs.indexOf(npc);
  if (i >= 0) npcs.splice(i, 1);
  if (holder._cast) {
    const j = holder._cast.indexOf(npc);
    if (j >= 0) holder._cast.splice(j, 1);
  }
}

/**
 * The actors the walker's talk cone may pick. A spriteless actor with no ptrB
 * and no confirm-press REDIRECT (see {@link resolveConfirmTarget}) is a pure
 * position marker: it has no dialogue record, so the native talk handler has
 * nothing to run for it. The native box probe reaches the markers at the
 * counters only THROUGH the interact handler's redirect table (npc 112/113 ->
 * the clerks 32/36), so a marker that carries a redirect stays a candidate and
 * resolves to the character behind it; a marker without one would swallow the
 * press, so it is skipped. Spriteless actors WITH a ptrB (npc 63 search points)
 * stay talkable.
 */
export function talkCandidates<T extends object>(npcs: readonly T[]): T[] {
  return npcs.filter((n) => {
    const r = n as { invisible?: unknown; ptrB?: unknown; npc_id?: unknown };
    if (!(r.invisible && r.ptrB == null)) return true;
    return confirmRedirectId(typeof r.npc_id === "number" ? r.npc_id : null) != null;
  });
}

/**
 * The interact handler F0x8008E2CC's own target rules, applied to whatever the
 * confirm probe returned (pro/fieldstg.s file 0xb61c-0xb7a8):
 *
 *   - npc ids 0x180..0x182 are refused outright: `lw $v1,0x4($s0)` + three
 *     `beq` arms at file 0xb658-0xb670 return 0 without an interaction. The
 *     three s810 actors (384/385/386, p197blxe) are exactly these ids, so a
 *     press in front of them does nothing on the disc.
 *   - an npc_id in the redirect table at RAM 0x80097C68 is replaced by the
 *     class-5 entity carrying the redirect id — `find_entity(5, pair+2, -1)`,
 *     file 0xb674-0xb73c — and the interact arms then run on THAT entity. The
 *     fifteen source ids are the spriteless position markers (npc 112/113 at
 *     the s210/211/220/221/923/924 counters and friends); the walker's wider
 *     talk cone is what reaches them, so the redirect is what keeps the press
 *     faithful there. When the redirect's entity is not in the cast the press
 *     interacts with nothing (the disc would call through a null pointer), so
 *     this returns null rather than falling back to the marker.
 *   - anything else is its own target.
 *
 * Claim `field-confirm-engage-dispatcher` (the walker's own read of the same
 * body); the arm-by-arm assembly citations are file 0xb61c-0xb7a8.
 */
export function resolveConfirmTarget<T extends object>(
  cast: readonly T[],
  picked: T,
): T | null {
  const id = (picked as { npc_id?: unknown }).npc_id;
  if (typeof id !== "number") return picked;
  if (confirmRefusesTarget(id)) return null;
  const to = confirmRedirectId(id);
  if (to == null) return picked;
  return cast.find((n) => (n as { npc_id?: unknown }).npc_id === to) ?? null;
}

/** The ids the interact handler refuses outright (file 0xb658-0xb670). */
export const CONFIRM_REFUSED_IDS: readonly number[] = [0x180, 0x181, 0x182];

/** True when F0x8008E2CC returns 0 for this npc id — the press does nothing. */
export function confirmRefusesTarget(npcId: number | null | undefined): boolean {
  return npcId != null && CONFIRM_REFUSED_IDS.includes(npcId);
}

/**
 * The confirm probe F0x8008E210, as the talk/examine path uses it.
 *
 * F0x80090F70 (installed on every character) returns the character's own
 * position `+0x58/+0x5C` plus the facing offset from table 0x80097CCC — 16 px
 * cardinal, 11 px on a diagonal, the same table the tree kick already uses.
 * F0x8008E210 then walks the class-5 field-character pool **in registry order**
 * and returns the FIRST whose box contains that point:
 *   |px - actor.x| <= actor+0x80  &&  |py - actor.y| <= (actor+0x80 >> 1)
 * where actor+0x80 is the constructor's half sprite size, `size(kind) >> 1`,
 * with `kind = npc_id` for an NPC (F0x8009116C file 0xe604-0xe618 calls the
 * size method at table 0x800A9DF8 and stores `sra 1` into +0x80).
 *
 * `halfWidthOf` returns that half-width, or null for a kind outside the
 * extracted size table (the native would read past it); such an actor is
 * skipped rather than guessed. Claim
 * `world-q001-confirm-probe-box-rule-2026-09-13`.
 */
export function confirmProbeContains<T extends { x: number; y: number }>(
  npc: T, x: number, y: number, facing: number, halfWidth: number,
): boolean {
  const [dx, dy] = ACTION_POINT_OFFSETS[((facing % 8) + 8) % 8]!;
  const px = x + dx, py = y + dy;
  return Math.abs(px - npc.x) <= halfWidth && Math.abs(py - npc.y) <= (halfWidth >> 1);
}

export function confirmProbeTarget<T extends { x: number; y: number }>(
  npcs: readonly T[],
  x: number, y: number, facing: number,
  halfWidthOf: (npc: T) => number | null,
): T | null {
  for (const npc of npcs) {
    const hw = halfWidthOf(npc);
    if (hw == null) continue;
    if (confirmProbeContains(npc, x, y, facing, hw)) return npc;
  }
  return null;
}

/** Preserve the ordered ptrB program: a failed gate cannot fall back to its first line.
 * Manual dialogue references have no ptrB states and retain their explicit fallback.
 */
export function selectNpcDialogue(
  npc: { dialogue_states?: DialogueState[]; dialogue?: DialogueRef; ifFlag?: { flag: string; dialogue: DialogueRef } },
  getCond: ((id: number) => 0 | 1 | null) | null,
  flags: Record<string, unknown>,
): DialogueState | null {
  if (npc.dialogue_states !== undefined) return pickDialogueState(npc, getCond);
  const ref = npc.ifFlag && flags[npc.ifFlag.flag] ? npc.ifFlag.dialogue : npc.dialogue;
  return ref ? { dialogue: ref } : null;
}

/** Install decoded programs without throwing away scene-specific interaction metadata.
 * Identity includes the complete spawn gate: two variants can share slot and position.
 */
export function applyNpcPrograms<T extends NpcPlacement>(existing: T[], decoded: T[]): T[] {
  const key = (npc: T) => JSON.stringify([npc.slot, npc.npc_id, npc.x, npc.y, npc.n,
    npc.spawn_flags ?? [], npc.ptrB ?? null]);
  const byKey = new Map(existing.map(npc => [key(npc), npc]));
  const replaced = new Set<string>();
  const result = decoded.map(npc => {
    const id = key(npc);replaced.add(id);
    return { ...byKey.get(id), ...npc, dialogue: npc.dialogue } as T;
  });
  return [...result, ...existing.filter(npc => !replaced.has(key(npc)))];
}
