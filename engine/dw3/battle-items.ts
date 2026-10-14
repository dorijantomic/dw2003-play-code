// engine/dw3/battle-items.ts — the in-battle ITEM effect dispatch, decoded from the
// FIGHTSTG 48-case jump table at 0x80082f1c (index = ItemId − 43, handler band
// 0x8008dc00–0x8008ecac; see docs/research/battle/battle-items-decoded-2026-07-10.md).
//
// Decoded semantics (fightstg.s, per handler):
//   66 AntidoteDisk  clear status bit 0x01, msg "Cured!"           (0x8008dcd8, rec 0x800a334c)
//   67 ReviveDisk    clear status bit 0x02, msg "Defrost!"         (rec 0x800a3354)
//   68 SoberDisk     clear status bit 0x04, msg "Conscious!"       (rec 0x800a335c)
//   69 EnergyDisk    clear status bits 0x3f, msg "All status cured!" (rec 0x800a3364)
//   70 LifeDisk      every fallen party member → FULL HP           (0x8008ddd8 state 1)
//   71 LifePlug      hp += maxHp/2, mp += maxMp/2 (clamped); "No effect!" if both full (0x8008ded0)
//   72 MachPlug      SPD buff += SPD·32/128 (+25%), cap +100% of base (0x8008dfc8, buff@+0x14)
//   73 PowerPlug     STR += STR·64/128 (+50%) cap +100%; DEF −= DEF·64/512 (−12.5%) floor −50% (0x8008e0d4)
//   74 GuardPlug     DEF += DEF·64/128 (+50%) cap +100%; STR −= STR·64/512 (−12.5%) floor −50% (0x8008e25c)
//   75 AuraPlug      set record+0x2b = 1 — the effectiveness flag that doubles
//                    secondary-effect/crit terms (eff+0x1b); msg "Special effect up!" (0x8008e3e4)
//   76 DVPlug        DV/blast gauge += pair value 200, clamp 999 (0x8008e438 → 0x80042b74[slot])
//   77–83 Fields     workspace+0xd0 = element (id−0x4b → 2..8), +0xd2 = power 64 (0x8008e4e0)
//   84 UnknownField  +0xd0 = pre-rolled random element (ctx+0x74), +0xd2 = 127 (0x8008e554)
//   85 CrimsonCable  transfer enemy maxHP/5 HP enemy→user (0x8008d758–0x8008d7e0)
//   86 ChaosWave     rand&1 gate; enemy status |= 0x04 (confuse); rand&3 follow-up can
//                    confuse own Digimon too (0x8008e6f8)
//   87 CharmGas      enemy STR += 3·STR/10 (+30%) cap +100%; enemy DEF −50% floor −50% (0x8008e8ac)
//   88 CursedPuppet  lower the larger of enemy STR/DEF by their difference, floor −50%
//                    of its clean base; equal stats have no effect (0x8008d550–0x8008d6a0)
//   89 SpiderWeb     enemy SPD −= SPD·32/128 (−25%), floor −50% (0x8008eb4c, buff@+0x14)
//   90 TNTBall       enemy HP −= the skill-137 (Flame Ball, fire power 100) damage result
//                    stored at ctx+0x78, KO at 0 (0x8008d7e8–0x8008d8ac, 0x8008ecac)
//
// Items 43–65 (charges/chips) run the generic HP/MP heal handler (0x8008dc00) and are
// already covered by the hp/mp item path in the battle UI.
//
// Corrected live bit map: 0x01 Poison, 0x02 Frozen, 0x04 Confusion, 0x08 Sleep.
// Poison owns recurring code 0x09; the other three use timed recovery codes 0x0a..0x0c.
//
// ---------------------------------------------------------------------------
// WHAT EACH HANDLER PRINTS. Every one of these handlers ends by making a battle
// message line (`jal FIGHTSTG_F0x8009a298`) and calling the shared panel's `+0xac`
// with a **kind** and a three-word payload. Nothing in the band types a sentence: the
// words are `esmfight` indices in message bank 0x7f
// (web/assets/data/battlecmd/esmfight.json). This module returns that call verbatim.
//
// The arms (engine/dw3/ui/native/battle-message-line.ts, `BATTLE_MESSAGE_ARMS`):
//
//   kind 1   `.L0x80099638` — line 1 is the caller's payload[0] and nothing else is
//            drawn, so these pages are ONE line with no name. `.L0x80099670
//            j .L0x8009a200` skips the shared tail, so no name reaches line one.
//   kind 2   `.L0x80099678` — line 1 `esmfight[0x16]` (the name), line 2 the caller's
//            payload[0]. Its tail reads **payload[1]** for the side test
//            (`.L0x800996ec lw $a2, 0x4($s2)` then `j .L0x8009a02c`, skipping the
//            `lw $a2, ($s2)` at `.L0x8009a028`): 0 names the current actor, 0x10 names
//            the enemy. `FIGHTSTG_F0x80098d14` `.L0x80098d28 bnez $a2, .L0x80098d68`.
//   kind 4   `.L0x80099794` — line 1 the name, line 2 `esmfight[0x0b]` `{1} damage!`
//            with payload[1] in slot 1. Its tail reads **payload[0]** for the side
//            test (`.L0x800997fc` then `j .L0x8009a010` -> `.L0x8009a028`).
//   kind 7   `.L0x80099908` — line 1 the name, line 2 the caller's payload[0]; the
//            tail takes payload[1] as the side test and payload[2] as the record
//            index (`.L0x8009997c`-`.L0x80099984`).
//   kind 8   `.L0x8009998c` — line 1 the name, line 2 `esmfight[0x22]` `{1}HP healed!`
//            with payload[1] in slot 1; side test from payload[0].
//   kind 9   `.L0x80099a04` — no text at all. It hands the payload to
//            `FIGHTSTG_F0x80098de0` and `FIGHTSTG_F0x80099140`, and the second
//            returns at once when payload[0] is 0 (`.L0x8009917c beqz $v0,
//            .L0x8009951c`), which is the only shape LifeDisk uses.
//
// Per handler, with the exact instruction that asks for the page:
//
//   43–65 heal      0x8008dc00  kind 1 / id 0x2f "No effect!"  at full HP
//                                          (fightstg.s:11234, `li $a1, 0x1`;
//                                          the id at :11231)
//                          kind 8 / id 0x22 "{n}HP healed!"    (:11258, `li $a1, 0x8`,
//                                          payload[1] = the amount restored at :11256)
//   66 AntidoteDisk 0x8008dcd8  kind 2 / id from record 0x800a334c (:11319, `li $a1, 0x2`)
//   67 ReviveDisk   0x8008dcd8  kind 2 / id from record 0x800a3354
//   68 SoberDisk    0x8008dcd8  kind 2 / id from record 0x800a335c
//   69 EnergyDisk   0x8008dcd8  kind 2 / id from record 0x800a3364
//                          kind 1 / id 0x2f "No effect!"  when the record's mask
//                          matches nothing (:11322, the `li $a1, 0x1`; the id is the
//                          0x2f left in the delay slot at :11300)
//   70 LifeDisk     0x8008ddd8  kind 9, no text (:11351, `li $a1, 0x9`)
//   71 LifePlug     0x8008ded0  kind 2 / id 0x3b "HP & MP restored!" (:11442, the id at :11437)
//                          kind 1 / id 0x2f when both pools are already full
//   72 MachPlug     0x8008dfc8  kind 7 / id 0x32 "Speed [arrow-up]!" (:11513, the id at :11506)
//   73 PowerPlug    0x8008e0d4  kind 2 / id 0x3c "Focus on attack!" (:11611, the id at :11607)
//   74 GuardPlug    0x8008e25c  kind 2 / id 0x3d "Focus on guard!" (:11709, the id at :11705)
//   75 AuraPlug     0x8008e3e4  kind 2 / id 0x3e "Special effect up!" (:11730, the id at :11726)
//   76 DVPlug       0x8008e438  kind 2 / id 0x3f "Blast gauge up!" (:11772, the id at :11768)
//   77–83 fields    0x8008e4e0  kind 1 / id = ItemId + 0x16 (:11801, `addiu $v0, 0x16`
//                          at :11798) — 0x63 "Fire field!" .. 0x69 "Dark field!"
//   84 unknown field 0x8008e554 kind 1 / id = element + 0x61 (:11829, `addiu $v0, 0x61`
//                          at :11826) — the same seven words
//   85 CrimsonCable 0x8008e5c4  kind 4 / id 0x10, payload[1] = the HP taken (:11861,
//                          `li $a1, 0x4`; the id at :11844), so the page reads
//                          "<enemy> / <n> damage!"
//   85 gated        0x8008e6c4  kind 1 / id 0x2f (:11906, the id at :11903)
//   86 ChaosWave    0x8008e6f8  kind 2 / id 0x20 "Confused!", payload[1] = 0x10 so the
//                          name is the enemy's (:11960); the rand&3 follow-up at
//                          0x8008e848 asks again with payload[1] = 0 (:12015), so the
//                          player's own Digimon names itself
//   86 failed       0x8008e814  kind 1 / id 0x2f (:11990, the id at :11987)
//   87 CharmGas     0x8008e8ac  kind 2 / id 0x40 "Excited!", payload[1] = 0x10 (:12110)
//   88 CursedPuppet 0x8008ea5c  kind 2 / id 0x33 "Strength [arrow-down]!" for the STR
//                          arm (:12157, the id at :12148) and 0x34 "Defense [arrow-down]!"
//                          for the DEF arm (:12176, the id at :12167), both payload[1] =
//                          0x10; ctx+0x7c picks the arm, and anything but 1 or 2 gives
//                          kind 1 / 0x2f (:12183, the id at :12180)
//   89 SpiderWeb    0x8008eb4c  kind 2 / id 0x35 "Speed [arrow-down]!", payload[1] =
//                          0x10 (:12258, the id at :12250)
//   89 gated        0x8008ec78  kind 1 / id 0x2f (:12271, the id at :12268)
//   90 TNTBall      0x8008ecac  kind 4 / id 0x10, payload[1] = the damage (:12290,
//                          the id at :12286); a stored result of 0 or less falls to
//                          0x8008ed4c, which asks for kind 2 / id 0x1d "Evade!" with
//                          payload[1] = 0x10 (:12326, the id at :12321)
//
// The item **announcement** is a page of the shared box of its own, put up before any
// handler runs: `FIGHTSTG_F0x8008dac0` outer step 0 (fightstg.s:11150 `beqz $v0,
// .L0x8008db1c`) allocates a line with `jal FIGHTSTG_F0x8009a298` (:11154), writes
// `payload[0] = 0` (:11158) and `payload[1] = self+0x70` — the ItemId (:11157 `lw $v0,
// 0x70($s2)` / :11159 `sw $v0, 0x54($s2)`) — then calls `+0xac` with **kind 14**
// (:11161 `li $a1, 0xe`, the payload pointer `addiu $a2, $s2, 0x50` in the `jalr`
// delay slot at :11165). The arm `.L0x80099ca0` (fightstg.s:23809-23847) is line 1
// `esmfight[0x16]` (:23822 `li $a2, 0x16`) — the bare name placeholder the shared tail
// fills — line 2 `esmfight[0x09]` `{1}!` (:23833 `li $a2, 0x9`), and
// `+0x120(line2, bank 0x6a, payload[1], 1)` (:23838 `addiu $a0, 0x6a` / :23841 `lw $a2,
// 0x4($s2)` / :23842 `lw $v0, 0x120($a0)` / :23845 `li $a3, 0x1`): the item name out of
// the item-name bank by ItemId. It runs the shared tail (:23846 `j .L0x8009a01c`) with
// **payload[0]** (:24035 `.L0x8009a028 lw $a2, ($s2)`), so the 0 the step wrote names the
// acting Digimon (`FIGHTSTG_F0x80098d14 .L0x80098d28 bnez $a2`, :22789).
//
// The player reads it as its own page: the step writes `self+0x10 = 1` (:11168 `addiu
// $v0, 0x1` / :11170 `sw $v0, 0x10($s2)`) and returns; the next pass waits for
// `*($s3)` to clear (:11171 `lw $v0, ($s3)` / :11173 `bnez $v0, .L0x8008ee2c`),
// consumes the item (:11175 `jal FIGHTSTG_F0x8008d3b4`), and only then calls
// `self+0x38` (:11179), which is the handler dispatch. So it is a Circle-gated page
// BEFORE the effect page, for every item id the dispatch table covers (43..90 — the
// `addiu $v1, $v0, -0x2b` / `sltiu $v0, $v1, 0x30` bounds test at :11200-:11202 over
// the 48-word jump table at 0x80082f1c).

import { RAND_U16, specialModeDamage } from "./battle-formulas.ts";
import { applyAilment, type Combatant } from "./battle-combat.ts";
import { cureStatusEvent, cureAllStatusEvents, type StatusEventPool } from "./battle-status-events.ts";

/**
 * One battle message box page as the original asks for it: the shared panel's
 * `unkAC(line, kind, payload)` call, with `payload` the three words at `self+0x50`.
 * `name` is the Digimon the shared tail puts on line one, which the browser supplies
 * because the original derives it from the workspace rather than from the payload.
 */
export interface BattleItemPage {
  kind: number;
  payload: number[];
  /** The Digimon named on line one; null for the one-line arms, which name nobody. */
  name: string | null;
  /** The numbered slot values the arm writes, when it writes any. */
  slots?: string[];
}

/** `esmfight` index "No effect!". Every refused item prints this through kind 1. */
export const ITEM_NO_EFFECT_ID = 0x2f;
/** `esmfight` index "Confused!" — what ChaosWave lands. */
export const ITEM_CONFUSED_ID = 0x20;
/** `esmfight` index "Evade!" — the shared tail when a stored damage result is empty. */
export const ITEM_EVADED_ID = 0x1d;
/** The side-test word that makes the shared tail name the enemy instead of the actor. */
export const ITEM_NAME_ENEMY = 0x10;
/** The word 0x10 stored in payload[0] by the two damage items; kind 4 reads it as the
 *  side test and never as a string. */
export const ITEM_DAMAGE_SIDE = 0x10;

export interface BattleItemTarget {
  hp: number; maxHp: number;
  mp?: number; maxMp?: number;
  str: number; def: number; spd: number;
  ailments: Record<string, unknown>;
  /** Applied plug/debuff deltas (absolute points), so re-use replaces instead of stacking. */
  buffs?: { str: number; def: number; spd: number };
  aura?: boolean;
  gauge?: number;
  [k: string]: unknown;
}

/** Kind 1 — line 1 is the caller's payload[0] and no name reaches either line. */
export const ITEM_PAGE_KIND_ONE_LINE = 1;
/** Kind 2 — line 1 the name, line 2 the caller's payload[0]. */
export const ITEM_PAGE_KIND_OUTCOME = 2;
/** Kind 4 — line 1 the name, line 2 `{1} damage!` with payload[1]. */
export const ITEM_PAGE_KIND_DAMAGE = 4;
/** Kind 7 — line 1 the name, line 2 the caller's payload[0]; payload[2] is the index. */
export const ITEM_PAGE_KIND_NAME_LINE = 7;
/** Kind 8 — line 1 the name, line 2 `{1}HP healed!` with payload[1]. */
export const ITEM_PAGE_KIND_HEALED = 8;
/** Kind 9 — no text; the silent beat LifeDisk shows while it revives the party. */
export const ITEM_PAGE_KIND_SILENT = 9;
/**
 * Kind 14 — the announcement page: the acting Digimon's name on line one and the
 * item's own name on line two out of the item-name bank (`FIGHTSTG_F0x8008dac0`
 * outer step 0, `fightstg.s:11161`).
 */
export const ITEM_PAGE_KIND_ANNOUNCE = 14;
/**
 * Bank `0x6a` + language, the item-name bank: string index == ItemId. Extracted to
 * `web/assets/data/battlecmd/esitmnam.json` by `tools/extract_battle_text.py`, whose
 * `verify_bank_layout()` names it against the disc's file-index table
 * (`LBA_ESITMNAM_BIN_IDX = 108 = 0x6a + 2`) and checks the exe's own bank directory's
 * sector count for it. Its strings are the same table the walker's own item names come
 * from (`tools/build_item_names.py`), entry for entry, so the announcement reads the
 * bank and not a second list.
 */
export const ITEM_NAME_BANK = 0x6a;

/**
 * The announcement page, `FIGHTSTG_F0x8008dac0` outer step 0's whole `+0xac` call.
 *
 * `name` is the acting Digimon the shared tail puts on line one (payload[0] = 0, so it
 * is the current actor, not a party record), and `itemName` is the bank 0x6a string for
 * `itemId` — the second line's slot 1, which fills `esmfight[0x09]` `{1}!`. The bank
 * lookup is the caller's, so the browser can answer it from the loaded bank and a test
 * from a table it holds.
 */
export function itemAnnouncementPage(
  name: string,
  itemId: number,
  itemName: string,
): BattleItemPage {
  return {
    kind: ITEM_PAGE_KIND_ANNOUNCE,
    payload: [0, Math.trunc(itemId) | 0],
    name,
    slots: [String(itemName)],
  };
}

export interface BattleItemResult {
  ok: boolean;
  /**
   * The pages the original's handler puts up, in order, each one the shared battle
   * message box's own `unkAC(line, kind, payload)` call. A refused item always yields
   * exactly one page — the one-line "No effect!" through kind 1 — because every
   * handler in the band shares that refusal tail.
   */
  pages: BattleItemPage[];
  /** True when the handler dealt direct damage (caller re-checks enemy KO). */
  dealtDamage?: boolean;
}

const ALL_AILMENTS = ["poison", "frozen", "confuse", "sleep"];

/** Element for the field items, id−0x4b → 2..8 (fire..dark). */
export const FIELD_ELEMENTS = ["fire", "water", "ice", "wind", "thunder", "machine", "dark"] as const;

/**
 * The seven `esmfight` words an elemental field prints, in `FIELD_ELEMENTS` order:
 * 0x63 "Fire field!" .. 0x69 "Dark field!". Both field handlers store the element as
 * 2..8 (`ItemId − 0x4b` at fightstg.s:11792 for 77..83, the pre-rolled halfword at :11818
 * for item 84) and both print `element + 0x61` / `ItemId + 0x16`, which is this
 * sequence read from code 2.
 */
export const FIELD_MESSAGE_IDS: readonly number[] =
  Object.freeze([0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69]);

/** The word a field of element code `code` (2..8) prints. */
export function fieldMessageId(code: number): number {
  const index = Math.trunc(code) - 2;
  return FIELD_MESSAGE_IDS[index] ?? FIELD_MESSAGE_IDS[0]!;
}

/**
 * The refusal page every handler shares: `esmfight[0x2f]` through **kind 1**, whose arm
 * (`.L0x80099638`) puts the caller's payload[0] on line one and nothing else, so this is
 * a single line with no name.
 */
function noEffect(): BattleItemPage {
  return { kind: ITEM_PAGE_KIND_ONE_LINE, payload: [ITEM_NO_EFFECT_ID], name: null };
}

/**
 * A kind-2 page: the name on line one, the caller's own `esmfight` index on line two.
 * `payload[1]` is the shared tail's side test — 0 names the acting Digimon, 0x10 the
 * enemy (`.L0x800996ec` reads payload[1], not payload[0]).
 */
function actorPage(messageId: number, name: string): BattleItemPage {
  return { kind: ITEM_PAGE_KIND_OUTCOME, payload: [messageId, 0], name };
}

/** The same page naming the enemy: payload[1] = 0x10. */
function enemyPage(messageId: number, enemyName: string): BattleItemPage {
  return { kind: ITEM_PAGE_KIND_OUTCOME, payload: [messageId, ITEM_NAME_ENEMY], name: enemyName };
}

/** A one-line page: `esmfight[index]` through kind 1, naming nobody. */
function oneLinePage(messageId: number): BattleItemPage {
  return { kind: ITEM_PAGE_KIND_ONE_LINE, payload: [messageId], name: null };
}

/** A damage page: kind 4, `esmfight[0x0b]` `{1} damage!` with the amount in slot 1. */
function damagePage(amount: number, enemyName: string): BattleItemPage {
  const n = Math.max(0, Math.trunc(amount) || 0);
  return {
    kind: ITEM_PAGE_KIND_DAMAGE,
    payload: [ITEM_DAMAGE_SIDE, n],
    name: enemyName,
    slots: [String(n)],
  };
}

/**
 * The heal page of the generic charge handler `0x8008dc00` (items 43-65): kind 8,
 * `esmfight[0x22]` `{1}HP healed!`, with the amount the item actually restored in
 * slot 1 (payload[1], `fightstg.s:11256`). Exported because that band is run by the
 * battle UI's own hp/mp path rather than by `useBattleItem`.
 */
export function chargeHealPage(name: string, restored: number): BattleItemPage {
  const n = Math.max(0, Math.trunc(restored) || 0);
  return {
    kind: ITEM_PAGE_KIND_HEALED,
    payload: [0, n],
    name,
    slots: [String(n)],
  };
}

/** The refusal page of the generic charge handler: kind 1, `esmfight[0x2f]`. */
export function chargeNoEffectPage(): BattleItemPage {
  return noEffect();
}

/**
 * The four status disks, one record each: the mask the handler tests and clears
 * (`lh $v0, 0x2($s0)` / `nor`+`and`+`sb`, fightstg.s:11291-11313) and the `esmfight`
 * index it puts in payload[0] for the kind-2 page (`lh $v0, ($s0)` at :11335). The
 * records are the four eight-byte rows at 0x800a334c, :3354, :335c and :3364, picked by
 * the handler's ItemId test at :11330-11344; their message ids are 0x28 "Cured!",
 * 0x29 "Defrost!", 0x2a "Conscious!" and 0x2c "All status cured!", which is the order
 * the bank itself keeps them in (web/assets/data/battlecmd/esmfight.json indices
 * 40, 41, 42 and 44).
 *
 * `all` marks the record whose row (0x800a3364: mask `0x3f`, cure code `0xc4`) reaches
 * `FIGHTSTG_F0x8009c330`'s `which` 3 arm — the SIX-code cancel, not the four ailments.
 */
const STATUS_DISKS: Readonly<Record<number, { ailments: string[]; messageId: number; all?: boolean }>> =
  Object.freeze({
    66: { ailments: ["poison"], messageId: 0x28 },
    67: { ailments: ["frozen"], messageId: 0x29 },
    68: { ailments: ["confuse"], messageId: 0x2a },
    69: { ailments: ALL_AILMENTS, messageId: 0x2c, all: true },
  });

function ensureBuffs(c: BattleItemTarget): { str: number; def: number; spd: number } {
  if (!c.buffs) c.buffs = { str: 0, def: 0, spd: 0 };
  return c.buffs;
}

// The decoded buff shape: remove the previous buff from the effective stat, recompute
// truncate the ratio, accumulate, and clamp against the clean base. CharmGas
// supplies its pre-strip source and its exact denominator instead of 128.
function applyBuff(c: BattleItemTarget, stat: "str" | "def" | "spd", num: number, denominator = 128, source?: number): number {
  const buffs = ensureBuffs(c);
  const base = (c[stat] as number) - buffs[stat]; // strip previous buff (game: rec−=buff)
  let next = buffs[stat] + Math.trunc(((source ?? base) * num) / denominator);
  if (next > base) next = base;                    // cap: buff ≤ +100% of base
  if (next < -(base >> 1)) next = -(base >> 1);    // floor: −50% of base
  buffs[stat] = next === 0 ? 0 : next;
  c[stat] = base + next;
  return next;
}

function reduceStatBy(c: BattleItemTarget, stat: "str" | "def", amount: number): number {
  const buffs = ensureBuffs(c);
  const base = (c[stat] as number) - buffs[stat];
  const next = Math.max(-(base >> 1), buffs[stat] - amount);
  buffs[stat] = next;
  c[stat] = base + next;
  return next;
}

function cureAilments(c: BattleItemTarget, names: string[], all = false): boolean {
  let any = false;
  for (const n of names) {
    if (!c.ailments[n]) continue;
    delete c.ailments[n];
    // The disc's one "an ailment ends now" routine frees the ailment's recovery entry as
    // well as clearing its bit: `FIGHTSTG_F0x8009c330` looks the code up in the table at
    // `0x800a43d4` (`0x0c0b0a09` — which 0 → `0x09` poison, 1 → `0x0a` frozen, 2 → `0x0b`
    // confused) and zeroes the slot with `sh $zr, ($v0)` (`pro/fightstg.s:26408`-`:26443`).
    // Without this the walker's pool would keep ticking a poison the item already cured.
    cureStatusEvent(
      (c as { statusEvents?: StatusEventPool }).statusEvents,
      n,
      ((c as { sideByte?: number }).sideByte ?? 0) | 0,
      ((c as { slot?: number }).slot ?? 0) | 0,
    );
    any = true;
  }
  if (all) {
    // `which` 3 is the ALL arm: the mask the row tests is `0x3f` and the cancel walks SIX
    // codes, so the two tech-abort locks (`0x10` cannot-flee, `0x11` cannot-digivolve) are
    // lifted with the four recoveries (see `STATUS_EVENT_ALL_CURE_CODES`). The walker's
    // records are one fighter per side, and a lock is staged on the side's ACTIVE slot, so
    // every slot of that side is swept rather than the single slot the disc's caller
    // passes.
    const pool = (c as { statusEvents?: StatusEventPool }).statusEvents;
    const side = ((c as { sideByte?: number }).sideByte ?? 0) | 0;
    for (let slot = 0; slot < 3; slot++) {
      if (cureAllStatusEvents(pool, side, slot) > 0) any = true;
    }
  }
  return any;
}

/**
 * True for the item ids the decoded FIGHTSTG 48-case jump table at 0x80082f1c
 * dispatches directly (index = ItemId - 43): 66 (AntidoteDisk) through 90
 * (TNTBall). Items 43-65 fall through that same table to the generic HP/MP heal
 * handler, which the battle UI already runs, so the battle Item menu must offer
 * this band by ID rather than by the field-use `effect` label -- the disks are
 * labelled `status_cure` for field use but only work in battle through this
 * dispatch.
 */
export function isBattleEffectItem(itemId: number): boolean {
  return Number.isInteger(itemId) && itemId >= 66 && itemId <= 90;
}

export function useBattleItem(
  itemId: number,
  user: BattleItemTarget,
  enemy: BattleItemTarget,
  opts: {
    party?: BattleItemTarget[];
    setField?: (element: string, power: number) => void;
    /** Battle magical-damage resolver used by TNTBall's virtual Flame Ball technique. */
    magicalHit?: (power: number, element: string) => number;
    rng?: () => number;
    /** The acting Digimon's name, for the arms that name the actor. */
    userName?: string;
    enemyName?: string;
    /** The acting Digimon's own record index, payload[2] of the kind-7 arm. */
    userIndex?: number;
    /** The enemy record index, payload[2] where an arm carries it. */
    enemyIndex?: number;
    /** Nonzero per-encounter bytes copied to 0x80042b5a..64 block the named effect. */
    effectGates?: Partial<Record<
      "poison" | "frozen" | "confuse" | "sleep" | "ko" | "direct_hp" |
      "cursed_puppet" | "charm_gas" | "spider_web", number | boolean
    >>;
    /** WFIGHTMN action mode selected by the exact field-screen/battle-id pair. */
    specialMode?: number;
  } = {},
): BattleItemResult {
  const rng = opts.rng ?? RAND_U16;
  const userName = opts.userName ?? "Your Digimon";
  const enemyName = opts.enemyName ?? "Enemy";
  const userIndex = Math.max(0, Math.trunc(opts.userIndex ?? 0) || 0);
  const enemyIndex = Math.max(0, Math.trunc(opts.enemyIndex ?? 0) || 0);
  const none: BattleItemResult = { ok: false, pages: [noEffect()] };

  switch (itemId) {
    // The four status disks share one handler, 0x8008dcd8, and one page shape.
    case 66: case 67: case 68: case 69: {
      const disk = STATUS_DISKS[itemId]!;
      if (!cureAilments(user, disk.ailments, disk.all === true)) return none;
      return { ok: true, pages: [actorPage(disk.messageId, userName)] };
    }

    case 70: { // LifeDisk — all fallen party members to full HP. Kind 9 prints nothing.
      const targets = opts.party?.length ? opts.party : [user];
      let revived = 0;
      for (const t of targets) if (t.hp === 0) { t.hp = t.maxHp; revived++; }
      return {
        ok: true,
        pages: [{ kind: ITEM_PAGE_KIND_SILENT, payload: [0, 5], name: null }],
      };
    }

    case 71: { // LifePlug — +maxHp/2 HP, +maxMp/2 MP
      const maxMp = user.maxMp ?? 0;
      if (user.hp === user.maxHp && (user.mp ?? 0) === maxMp) return none;
      user.hp = Math.min(user.maxHp, user.hp + (user.maxHp >> 1));
      if (user.mp !== undefined) user.mp = Math.min(maxMp, user.mp + (maxMp >> 1));
      return { ok: true, pages: [actorPage(0x3b, userName)] };
    }

    case 72: // MachPlug — the one arm in the band that reaches kind 7, not kind 2.
      applyBuff(user, "spd", 32);
      return {
        ok: true,
        pages: [{
          kind: ITEM_PAGE_KIND_NAME_LINE, payload: [0x32, 0, userIndex], name: userName,
        }],
      };
    case 73:
      applyBuff(user, "str", 64); applyBuff(user, "def", -16); // 64/512 = 16/128
      return { ok: true, pages: [actorPage(0x3c, userName)] };
    case 74:
      applyBuff(user, "def", 64); applyBuff(user, "str", -16);
      return { ok: true, pages: [actorPage(0x3d, userName)] };

    case 75: user.aura = true; return { ok: true, pages: [actorPage(0x3e, userName)] };

    case 76: // DVPlug — +200 gauge, saturates at 999; hit gain owns the 1000 Blast trigger
      user.gauge = Math.min(999, (user.gauge ?? 0) + 200);
      return { ok: true, pages: [actorPage(0x3f, userName)] };

    case 84: { // UnknownField — random element, power 127; the id is element + 0x61
      const el = FIELD_ELEMENTS[rng() % FIELD_ELEMENTS.length]!;
      opts.setField?.(el, 127);
      return { ok: true, pages: [oneLinePage(fieldMessageId(FIELD_ELEMENTS.indexOf(el) + 2))] };
    }

    case 85: { // CrimsonCable — exactly maxHP/5; a KO hands the user NOTHING
      if (opts.effectGates?.direct_hp) return none;
      const dmg = Math.trunc(enemy.maxHp / 5);
      if (enemy.hp - dmg <= 0) {
        // `lh $v0,0x8($s0)` / `subu $v0,$v1` / `bgtz $v0, .L0x8008e650`
        // (fightstg.s:11854/:11858/:11859, raw 0x86020008 / 0x00431023 / 0x1c40000c):
        // the drain below one fifth of the enemy's max HP takes the OTHER arm, which
        // shows the same `maxHP/5` figure, stores 0 into the enemy's HP in the delay
        // slot of the KO call (:11844 `sh $zr,0x8($s0)`) and returns. The transfer to
        // the user lives only in the arm that did NOT KO (:11877-:11899).
        enemy.hp = 0;
        return { ok: true, pages: [damagePage(dmg, enemyName)], dealtDamage: true };
      }
      enemy.hp -= dmg;
      user.hp = Math.min(user.maxHp, user.hp + dmg);
      return { ok: true, pages: [damagePage(dmg, enemyName)], dealtDamage: true };
    }

    case 86: { // ChaosWave — coin-flip gate; enemy confuse; rand&3 → ally confuse too
      if (opts.effectGates?.confuse) return none;
      if ((rng() & 1) === 0) return none;
      applyAilment(enemy as Combatant, "confuse", {
        effect_p2: 96, confusion_recovery_mode: 0,
      }, undefined, rng);
      const pages = [enemyPage(ITEM_CONFUSED_ID, enemyName)];
      if ((rng() & 3) === 0) {
        applyAilment(user as Combatant, "confuse", {
          effect_p2: 96, confusion_recovery_mode: 0,
        }, undefined, rng);
        pages.push(actorPage(ITEM_CONFUSED_ID, userName));
      }
      return { ok: true, pages };
    }

    case 87: // CharmGas reads the current stats before stripping previous buffs.
      if (opts.effectGates?.charm_gas) return none;
      {
        const str = enemy.str, def = enemy.def;
        applyBuff(enemy, "str", 3, 10, str); applyBuff(enemy, "def", -1, 2, def);
      }
      return { ok: true, pages: [enemyPage(0x40, enemyName)] };

    case 88: { // CursedPuppet — pull the larger stat down toward the smaller one
      if (opts.effectGates?.cursed_puppet) return none;
      if (enemy.str === enemy.def) return none;
      const stat = enemy.str > enemy.def ? "str" : "def";
      reduceStatBy(enemy, stat, Math.abs(enemy.str - enemy.def));
      return { ok: true, pages: [enemyPage(stat === "str" ? 0x33 : 0x34, enemyName)] };
    }

    case 89:
      if (opts.effectGates?.spider_web) return none;
      applyBuff(enemy, "spd", -32);
      return {
        ok: true,
        pages: [{
          kind: ITEM_PAGE_KIND_OUTCOME, payload: [0x35, ITEM_NAME_ENEMY, enemyIndex],
          name: enemyName,
        }],
      };

    case 90: { // TNTBall — virtual skill 137 / Flame Ball (fire, power 100)
      const raw = opts.magicalHit?.(100, "fire") ?? 0;
      const dmg = specialModeDamage(opts.specialMode ?? 0, true, enemy.hp, enemy.maxHp, raw, 1);
      // `blez $v0, .L0x8008ed4c` (fightstg.s:12281): a stored result of 0 or less does not
      // damage at all and falls to the shared "missed" tail, which is "Evade!".
      if (dmg <= 0) return { ok: false, pages: [enemyPage(ITEM_EVADED_ID, enemyName)] };
      enemy.hp = Math.max(0, enemy.hp - dmg);
      return { ok: true, pages: [damagePage(dmg, enemyName)], dealtDamage: true };
    }
  }

  if (itemId >= 77 && itemId <= 83) { // elemental fields, power 64; the id is ItemId + 0x16
    const el = FIELD_ELEMENTS[itemId - 77]!;
    opts.setField?.(el, 64);
    return { ok: true, pages: [oneLinePage(itemId + 0x16)] };
  }

  return none;
}
