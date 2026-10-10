import { STORY_COMMAND_BANKS } from '../systems/story-command-banks.ts';
import type { BankScheme, EvalContext, VirtualBankHandler } from "../core/types.ts";
import type { FlagManager } from "../core/state/flag-manager.ts";
import type { GameState } from "../core/state/game-state.ts";
import type { ConditionEngine } from "../core/condition/condition-engine.ts";
import type { ScriptVM } from "../core/script/vm.ts";

export const DW3_BANK_SCHEME: BankScheme = {
  decompose: (id) => ({ bank: (id >> 8) & 0xfe, bit: id & 0x1ff }),
  storedBanks: new Map([
    [0x00,512],[0x02,512],[0x04,512],[0x06,512],[0x08,512],[0x0a,512],[0x0c,512],[0x0e,512],
    [0x10,512],[0x18,512],[0x1a,512],[0x1c,512],[0x20,512],[0x40,512],
    // 0x12 = synthetic engine-internal markers (e.g. scripted-battle wonFlag) — NOT a real
    // game bank; stands in for state the original tracks elsewhere (ordinal advance on win).
    [0x12,512],
  ]),
};

// One decoded bank-0x70 dispatch record's meaning, as emitted by
// tools/extract_roster_predicate_table.py (see
// docs/research/scripting/get-flag-banked-predicate-system.md). `null`/absent means
// the handler provably returns a constant 0 for that record's parameter.
export interface RosterSemantics {
  kind: string;
  effect: "read" | "write";
  slot?: number;
  value?: number;
  min_level?: number;
  threshold?: number;
  collection_indices?: number[];
  flag_ids?: number[];
  test?: string;
  n?: number;
}

export interface RosterPredTable {
  // `flag_id` is the id set_flag takes for this record (bank 0x70 = 0x7000 | key). Present on
  // every extracted record; a WRITE record is dispatched by it (see engine/systems/
  // scene-completion.ts), so a completion routine's bank-0x70 write needs no hard-coded id.
  records: { key: number; flag_id?: number; op: number; param2: number; semantics?: RosterSemantics | null }[];
  // param2 -> [lo,hi] for op 0x30. `hi` is `null` for the disc's open-ended ranges: the raw
  // byte is ORDINAL_RANGE_OPEN_HI, kept verbatim by the extractor.
  ranges?: Record<number, [number, number | null]>;
}

/**
 * The upper bound the disc stores for a story step range that has no end: the literal byte
 * `0x63` = 99, in 7 of the 33 op-0x30 records and nowhere else (the largest closed upper
 * bound in the table is 44). `F0x80015b9c` compares the story ordinal against the byte with
 * no special case, so 99 IS the original's end-of-story bound, not a sentinel to be dropped.
 * Read from D0x80048cb4 (EXE data, data.rs) — see
 * docs/research/scripting/get-flag-banked-predicate-system.md.
 */
export const ORDINAL_RANGE_OPEN_HI = 0x63;

/**
 * The op-0x30 range test, `F0x80015b9c` (.L0x80015bbc `.L0x80015bc8`):
 *   `slt $v0,$a2,$v0` = (lo < ordinal) -> `bnez` returns 0, else `slt $v0,$v1,$a2` = (hi <
 *   ordinal) and `xori $a0,$v0,1` inverts it — so the handler returns
 *   `(ordinal >= lo) && (ordinal <= hi)`, both bounds inclusive.
 * `hi === null` is the shipped extractor's spelling of the 0x63 bound.
 */
export function ordinalInRange(lo: number, hi: number | null, ordinal: number): boolean {
  if (ordinal < lo) return false;
  return ordinal <= (hi == null ? ORDINAL_RANGE_OPEN_HI : hi);
}

// The obtained-partner set. The original stores it as `roster_owned[slot]` — a u32
// per roster slot at 0x80049494 + slot*0x3dc (== DIGIMON_CUR_STATS[slot]-8), zero
// until the partner is obtained, then the partner's species id (slot+3). The engine
// has no roster struct, so the 8-slot OBTAINED bit is kept as a bitmask in the
// generic var store — the same choice AddMoney makes for `$party.bit`, which buys
// save/load and change-callbacks for free.
export const ROSTER_OWNED_VAR = "$roster.owned";

// The ROUTE PAIR — the original's two adjacent u16 globals [0x80048d78] / [0x80048d7a],
// written together by both fieldstg map-transition sites from the step record's
// params[5] / params[6] (record offsets +0x14 / +0x16). The write is UNCONDITIONAL, so a
// warp carrying no key clears the pair to (0,0); that is why a maze self-warp drops you
// out of whichever keyed section you were in. Kept in the generic var store for the same
// reason ROSTER_OWNED_VAR is: it buys save/load and change-callbacks for free.
export const ROUTE_KEY_VAR = "$route.key";
export const ROUTE_COMPANION_VAR = "$route.companion";

/**
 * Equipment-buffed total Charisma of the three deployed party positions, as
 * summed by F0x80015fbc. Host-supplied; unset means the bank-0x72 gates stay
 * dormant rather than silently passing.
 */
export const PARTY_CHARISMA_VAR = "$party.charisma";

/**
 * The bank-0x72 threshold ladder, D0x80048cf8 — 15 words, read from dri_s1.bin.
 * Never written: only two references in 590072 lines of original assembly, both
 * reads. Index n is the low byte of flag id 0x7200+n.
 *
 * Known consumers: index 0 (>=60) gates whether a roaming tamer will accept a
 * card-battle challenge at all (Yellow Cruiser s270 tamers 47/50/52/55, s200);
 * index 2 (>=210) gates the ElDoradoID boarding pass granted by s280 NPC 267;
 * index 1 (>=150) moves the El Dorado doorman aside; s271 uses indices 11/13.
 */
export const CHARISMA_THRESHOLDS = [
  60, 150, 210, 285, 378, 492, 630, 795, 990, 1218, 1482, 1785, 2049, 2277, 2472,
] as const;

/** `sum >= D0x80048cf8[index]`, the bank-0x72 comparison. Off-ladder = never satisfied. */
export function partyCharismaMeets(totalCharisma: number, index: number): boolean {
  const threshold = CHARISMA_THRESHOLDS[index];
  if (threshold === undefined) return false;
  return totalCharisma >= threshold;
}

function ownedMask(ctx: { vars: { get(name: string): unknown } }): number {
  return Number(ctx.vars.get(ROSTER_OWNED_VAR) ?? 0);
}

export function registerDw3Flags(flags: FlagManager, roster: RosterPredTable): void {
  for (const bank of STORY_COMMAND_BANKS) flags.registerVirtualBank(bank, () => true);
  // bank 0x60 = progress-ordinal equality
  flags.registerVirtualBank(0x60, (bit, expected, ctx) => {
    const ord = ctx.vars.get("$story.ordinal");
    const eq = ord === bit;
    return expected === 0 ? !eq : eq;
  });
  // bank 0x70 = roster predicate table dispatch
  const byKey = new Map(roster.records.map(r => [r.key, r]));
  flags.registerVirtualBank(0x70, (bit, expected, ctx) => {
    const rec = byKey.get(bit);
    let res = false;
    if (rec && (rec.op & 0xf0) === 0x30) {
      const range = roster.ranges?.[rec.param2];
      const ord = Number(ctx.vars.get("$story.ordinal") ?? -1);
      if (range) { const [lo, hi] = range; res = ordinalInRange(lo, hi, ord); }
    } else if (rec?.semantics) {
      const s = rec.semantics;
      switch (s.kind) {
        // op-0x10 case-0 (F0x80015754 case 0): get_flag(0x700N) = (DIGIMON_CUR_STATS[+0x1ED8] ==
        // param2). That global holds the chosen starter-pack selector (0/1/2); flags 0x7000/1/2 are
        // the s212 download gate that picks the pack's variant. The host stores the selector in the
        // $party.pack var at registration; unset (null) => conservatively false (gate dormant).
        case "pack_selector_equals": {
          const sel = ctx.vars.get("$party.pack");
          res = sel != null && Number(sel) === s.value;
          break;
        }
        // op-0x00: AND over bank-0x80 collection entries — the SAME parallel arrays the
        // possession banks read, so this reuses the inventory model rather than a new one.
        case "collection_all":
          res = (s.collection_indices ?? []).every(i => ctx.inventory.has(i));
          break;
        // op-0x10 cases 1/6/9 read only `roster_owned[slot] != 0`, which the obtained-partner
        // bitmask models exactly. Cases 2/4/5/7 additionally need the 3-slot ACTIVE party or
        // per-partner levels, neither of which the walker simulates — those stay false (dormant).
        case "roster_owned":
          res = (ownedMask(ctx) & (1 << (s.slot ?? 0))) !== 0;
          break;
        case "roster_not_owned":
          res = (ownedMask(ctx) & (1 << (s.slot ?? 0))) === 0;
          break;
        case "every_slot_owned":
          res = ownedMask(ctx) === 0xff;
          break;
        // op-0x40: both subops are plain stored-bit reads (F0x80015590) on banks 0x1c/0x10,
        // which the FlagManager already stores — so these resolve exactly.
        case "stored_bits_all_set":
          res = (s.flag_ids ?? []).every(id => ctx.flags.get(id, 1));
          break;
        case "stored_bit_tally": {
          const ids = s.flag_ids ?? [];
          const set = ids.filter(id => ctx.flags.get(id, 1)).length;
          const clear = ids.length - set;
          const n = s.n ?? 0;
          if (s.test === "set_count_at_least") res = set >= n;
          else if (s.test === "clear_count_at_least") res = clear >= n;
          else if (s.test === "clear_count_equals") res = clear === n;
          break;
        }
        // op-0x50 is an ACTION whose handler unconditionally returns 1; as a READ the gate
        // is therefore always true. The action itself is decoded (2026-07-27): the resident
        // type-0x16 object is the player's FIELDCOM sparkle actor and `+0x2c` is the shared
        // allocator's setSub1, so `[obj+0x2c](obj,3)` = "run acquisition flourish program 3
        // + ITEM_GET". It is emitted as the PlaySparkle(3) presentation command by the
        // converter (tools/engine-convert/lib.ts classifyAlsoSet), not by this read path.
        // See docs/research/scripting/bank70-opcode-handlers-decoded-2026-07-27.md.
        case "object_action":
          res = true;
          break;
        // grant_partner / heal_active_party are writes, not predicates; reading them would
        // perform the write in the original. Left false — the walker never reads them.
      }
    }
    // remaining un-modelled roster ops (active party, partner levels, currency compares):
    // conservatively false, so a gate on them stays dormant for both polarities
    return expected === 0 ? !res : res;
  });
  // bank 0x7E = the ROUTE PAIR predicate. F0x800160a8 reads ONE predicate space across the
  // two scalars the fieldstg map-transition sites write from step params[5]/[6]:
  //   index < 0x1e -> [0x80048d78] == index + 1     (route key, domain 1..30)
  //   index >= 0x1e -> [0x80048d7a] == index - 0x1d  (companion,  domain 1..8)
  // The shipped ids are exactly 0x7E00-0x7E25 (indices 0..37 = 30 + 8, no gap at the
  // boundary) and occur only as family-B maze NPC spawn gates.
  // Ledger: encounter-companion-scalar-is-second-route-coordinate.
  flags.registerVirtualBank(0x7e, (bit, expected, ctx) => {
    const key = Number(ctx.vars.get(ROUTE_KEY_VAR) ?? 0);
    const companion = Number(ctx.vars.get(ROUTE_COMPANION_VAR) ?? 0);
    const res = bit < 0x1e ? key === bit + 1 : companion === bit - 0x1d;
    return expected === 0 ? !res : res;
  });
  // bank 0x72 = the DERIVED PARTY-CHARISMA threshold predicate. F0x800163b0 routes 0x72 to
  // F0x80015fbc (exe/fns.s L6941), which loops the three deployed party positions, builds each
  // one's battle-effective stat buffer via F0x80017174, accumulates buffer+0x16 (== roster
  // record +0x32 == cur_chr, with each of the six equipped items' leading u16 added in, clamp
  // 999), and returns sum >= D0x80048cf8[index]. So get_flag(0x7200+n) asks "is equipment-buffed
  // party total Charisma at least ladder[n]?".
  //
  // The bank is READ-ONLY: `li $v0, 0x72` occurs exactly once in the whole main-exe assembly,
  // in the read dispatcher, and 0x72 is absent from the write dispatcher — so any extracted
  // "set" of a 0x72xx id is inert and must not be honoured as a stored bit.
  //
  // The walker does not simulate the 3-slot deployed party's per-partner stats or equipment, so
  // the sum comes from the $party.charisma var the host supplies. Unset => conservatively false
  // (gate dormant), matching how pack_selector_equals and the party-dependent roster cases are
  // handled above. Ledger: charisma-flag-bank-72-is-derived-party-charisma-threshold-predicate.
  flags.registerVirtualBank(0x72, (bit, expected, ctx) => {
    const raw = ctx.vars.get(PARTY_CHARISMA_VAR);
    const res = raw == null ? false : partyCharismaMeets(Number(raw), bit);
    return expected === 0 ? !res : res;
  });
  // banks 0x80–0x8e and 0x92 = per-id COLLECTION arrays (get-flag-banked-predicate-system.md).
  // These are item/collection possession reads: get_flag(0x8NN)/(0x92NN) tests whether item NN
  // is in the bag. Faithful model: possession IS the flag (no setter — items enter via GiveItem),
  // validated by the grant side (s420→SeiryuBadge(9), s421→BlueIDPass(22), s490→GuilmonDDNA(34)).
  const possession: VirtualBankHandler = (bit, expected, ctx) => {
    const owned = ctx.inventory.has(bit);
    return expected === 0 ? !owned : owned;
  };
  for (const bank of [0x80, 0x82, 0x84, 0x86, 0x88, 0x8a, 0x8c, 0x8e, 0x92])
    flags.registerVirtualBank(bank, possession);
}

export function registerDw3Conditions(ce: ConditionEngine): void {
  const getFlag = (ctx: EvalContext, id: number, expected: number) => ctx.flags.get(id, expected);
  ce.registerLeaf("battleLauncher", (a, ctx) => Boolean(ctx.vars.get(`$battle.launch.${Number(a[0]) & 0x1ff}`)) === (Number(a[1] ?? 1) !== 0));
  ce.registerLeaf("hasFlag", (a, ctx) => getFlag(ctx, Number(a[0]), 1));
  ce.registerLeaf("flag", (a, ctx) => getFlag(ctx, Number(a[0]), Number(a[1] ?? 1)));
  ce.registerLeaf("variableEquals", (a, ctx) => ctx.vars.get(String(a[0])) === a[1]);
  ce.registerLeaf("partyContains", (a, ctx) => ctx.party.contains(Number(a[0])));
  ce.registerLeaf("partySizeEquals", (a, ctx) => ctx.party.size() === Number(a[0]));
  // spawnGate: args are "id:expected" strings (AND-list); all must hold
  ce.registerLeaf("spawnGate", (a, ctx) => a.every(s => {
    const [id, exp] = String(s).split(":"); return ctx.flags.get(Number(id), Number(exp ?? "1"));
  }));
}

export interface Dw3CommandHooks {
  startEvent: (eventId: number) => void;
  presentation: (op: string, args: number[]) => void;
  // Scripted-battle invocation: fire the battle for `screenId`; on victory the host sets
  // `wonFlag` and re-raises the talk so the POST event row passes (battle-invocation.md).
  startBattle: (screenId: number, wonFlag: number) => void;
  // Native-handler invocation: the event's behaviour is compiled MIPS (script_offset==0) with
  // no bytecode. `handler` names a faithfully-reimplemented routine in the host's native
  // registry; `args` are the decoded parameters. The host runs it then resumes the script.
  native: (handler: string, args: number[]) => void;
  // Active-party full heal: bank-0x70 op-0x18 case 8. HP/MP live in the host (the engine's
  // Party holds only roster ids), so the host applies cur_hp=max_hp, cur_mp=max_mp.
  healParty?: () => void;
  setFlag?: (id: number, value: number) => void;
}

export function registerDw3Commands(vm: ScriptVM, gs: GameState, hooks: Dw3CommandHooks): void {
  const setFlag = (id: number, value: number) => {
    if (hooks.setFlag) hooks.setFlag(id, value);
    else gs.flags.set(id, value !== 0);
  };
  vm.registerCommand("SetFlag", (a) => { setFlag(Number((a[0] as any).v), Number((a[1] as any).v)); return { yield: false }; });
  vm.registerCommand("ClearFlag", (a) => { setFlag(Number((a[0] as any).v), 0); return { yield: false }; });
  vm.registerCommand("AdvanceOrdinal", (a) => { gs.vars.set("$story.ordinal", Number((a[0] as any).v)); return { yield: false }; });
  // GiveItem(itemId) — add an item to the bag; flips the collection-bank possession predicate.
  vm.registerCommand("GiveItem", (a) => { gs.inventory.add(Number((a[0] as any).v)); return { yield: false }; });
  // AddMoney(amount) — bank-0x70 CURRENCY ADD reward (opcode 0x20 arg0==1, F0x80015aac):
  // BIT (money) total += amount, capped at 0x98967F (9,999,999), matching the original's
  // `D0x80048d34.unk6C` clamp. Stored in the generic var store (same pattern as
  // AdvanceOrdinal's $story.ordinal) since the engine has no dedicated currency field.
  // See tools/extract_bank70_rewards.py / docs/research/field/bank70-reward-dispatch-2026-07-26.md.
  vm.registerCommand("AddMoney", (a) => {
    const amount = Number((a[0] as any).v);
    const cur = Number(gs.vars.get("$party.bit") ?? 0);
    gs.vars.set("$party.bit", Math.min(cur + amount, 0x98967f));
    return { yield: false };
  });
  // GrantPartner(slot) — bank-0x70 op-0x10 case 3 (F0x80015820): the original writes
  // `roster_owned[slot] = slot + 3`, i.e. records the partner for that roster slot as
  // obtained. Modelled as a bit in the $roster.owned mask (see ROSTER_OWNED_VAR); that
  // is exactly what the case-1/6/9 predicates read back, so an NPC that hands over a
  // partner now flips its own "already given" dialogue gate.
  vm.registerCommand("GrantPartner", (a) => {
    const slot = Number((a[0] as any).v);
    const cur = Number(gs.vars.get(ROSTER_OWNED_VAR) ?? 0);
    gs.vars.set(ROSTER_OWNED_VAR, cur | (1 << slot));
    return { yield: false };
  });
  // HealParty() — bank-0x70 op-0x18 case 8 (F0x80015754, roster_predicate_table.json record
  // 0x53 key 83). A bank-0x70 "set" is a DISPATCH to the predicate handler, not a store, and
  // case 8 writes `cur_hp=max_hp, cur_mp=max_mp` for the <=3 active party members. HP/MP live
  // in the host, so the command forwards to the host hook. 0x7053 is the only bank-0x70 write
  // in any extracted event program (s925 event 1600, the pre-fight full heal), emitted by the
  // converter. See docs/research/scripting/bank70-opcode-handlers-decoded-2026-07-27.md.
  vm.registerCommand("HealParty", () => { hooks.healParty?.(); return { yield: false }; });
  vm.registerCommand("StartEvent", (a) => { hooks.startEvent(Number((a[0] as any).v)); return { yield: true }; });
  vm.registerCommand("StartBattle", (a) => { hooks.startBattle(Number((a[0] as any).v), Number((a[1] as any).v)); return { yield: true }; });
  // Native(handler, ...args) — dispatch a compiled-MIPS handler; args after the name are ints.
  vm.registerCommand("Native", (a) => { hooks.native(String((a[0] as any).v), a.slice(1).map(x => Number((x as any).v) || 0)); return { yield: true }; });
  // PlaySparkle(program) — bank-0x70 op-0x50 (F0x80015d4c), the acquisition flourish.
  // The original resolves the single resident FIELDSTG object of type 0x16 (owned by field
  // character 0 = the player) and calls setSub1(program) on it; the object's callback plays
  // packed sound 0x00040009 (ITEM_GET) for programs 1 and 3 and animates FIELDCOM sprite ids.
  // Pure PRESENTATION — it mutates no game state — so it goes to the host through the same
  // presentation hook as SetPos/Say/Wait, and the browser bridge renders it.
  // See docs/research/scripting/bank70-opcode-handlers-decoded-2026-07-27.md § "op 0x50 resolved".
  for (const op of ["SetPos", "WalkTo", "Say", "Handoff", "Wait", "PlaySparkle"]) {
    vm.registerCommand(op, (a) => { hooks.presentation(op, a.map(x => Number((x as any).v) || 0)); return { yield: true }; });
  }
}
