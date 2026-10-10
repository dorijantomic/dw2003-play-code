// DW3 confusion = command-scramble gag (STATUS-C004, decoded 2026-07-16).
//
// Confusion (ailment bit 0x04) never redirects a target or deals flail damage.
// Two presentations exist in the original:
//   • Player: the Fight/Tech/DV/Tag menu is replaced by a Fisher-Yates-shuffled
//     set of joke commands (fightstg F0x8009a898 / draw F0x8009a2dc). Confirm
//     first rolls F0x800a1910: failure resolves as normal Attack; success reads
//     the selected joke, plays one flavor line, and forfeits the turn.
//   • Enemy/auto: the turn-gate F0x80088564@0x887ac emits one random gag
//     one-liner (msg 0x83 + rand()%8) and skips the turn.
//
// All strings below are the decoded esmfight.toml entries (ids noted). This is
// the single shared source; web/battle.js renders through it.

/** The 8 confused-menu joke commands — esmfight ids 0x6b–0x72, in table order. */
export const JOKE_COMMANDS: readonly string[] = Object.freeze([
  "Laugh", "Confess", "Dance", "Leaving", "Boast", "Seduct", "Mad", "Cry",
]);

/**
 * Per-joke paired flavor lines — esmfight ids 0x73–0x82. One of the pair is shown
 * when the joke is chosen (F0x8009a734: table 0x800a35e4, entry (joke<<1)|padbit).
 * The words are the disc bank's own, character for character (straight quotes, as
 * web/assets/data/battlecmd/esmfight.json holds them).
 */
export const JOKE_FLAVOR: readonly (readonly [string, string])[] = Object.freeze([
  ["Grinning!", "Shiny white teeth!"],               // Laugh   (115/116)
  ["Confessing!", '"I love sweet things"'],          // Confess (117/118)
  ["Dancing!", '"Whoa, dizzy!"'],                    // Dance   (119/120)
  ["Packing!", '"I\'m leaving this house!"'],       // Leaving (121/122)
  ["Boasting!", '"I\'m the best!"'],                // Boast   (123/124)
  ["Posing!", '"Hi, there"'],                        // Seduct  (125/126)
  ["Angry!", '"I\'m leaving you!"'],                // Mad     (127/128)
  ["Can't stop crying!", "Tears are salty!"],        // Cry     (129/130)
].map((p) => Object.freeze(p)) as (readonly [string, string])[]);

/**
 * The `esmfight` index of one of a joke's two paired lines.
 *
 * F0x8009a734 indexes the table at 0x800a35e4 with `id = 2*joke + (rand() & 1)`
 * (`.L0x8009aafc` doubles the shuffled entry and `.L0x8009ab04` ORs a fresh random bit into
 * it), and the second halfword of that entry — the one the second line element is given —
 * is `0x73 + id`. `bit` is the value of that random bit.
 */
export function jokeFlavorMessageId(jokeIndex: number, bit: number): number {
  const j = (jokeIndex | 0) % JOKE_FLAVOR.length;
  return JOKE_FLAVOR_FIRST_ID + 2 * j + ((bit | 0) & 1);
}

/** Auto/enemy gag one-liners — esmfight ids 0x83–0x8a (turn-gate picks rand()%8). */
export const ENEMY_GAG_LINES: readonly string[] = Object.freeze([
  "Laughing out loud!", "Looking this way!", "Dancing!", '"I\'m the main guy!"',
  "Wanting to go home!", "Tidying up!", "Singing!", "Serving dinner!",
]);

/**
 * The two lines a joke gag prints, in the original's own shapes (F0x8009a734,
 * fightstg.s:24505-24595).
 *
 * The gag does **not** say "<name> is confused!". It fills the battle message box's two
 * lines: `FIGHTSTG_F0x8001ae38(0x1005, 1, 0x14, 0xc2)` and the same with `0xd0` — native
 * (20,194) and (20,208) — with esmfight 0x16 on the first and the phrase off the table at
 * 0x800a35e4 on the second. `esmfight[0x16]` is the bare `{1}` whose slot 1 the shared tail
 * `FIGHTSTG_F0x80098d14` fills with the acting Digimon's name, so the first line IS the
 * name. "Confused!" (esmfight 32) is a different message: it is what the game prints when
 * the ailment is applied, not part of a gag.
 */
export const JOKE_GAG_NAME_ID = 0x16;
/** The message bank both lines come from: `addiu $a0, 0x7f` at the text getter. */
export const JOKE_GAG_BANK = 0x7f;
/**
 * The eight-bit table F0x8009a734 indexes at `0x800a35e4 + 4*id` (fightstg.s:33989-34004).
 * Entry `id` is the halfword pair `0x0073+id` / `0x0001+id`, and the id is
 * `2*joke + (rand() & 1)` (`.L0x8009aafc sll $a1,0x1` then `.L0x8009ab04 or $a1,$v0` with
 * `andi $v0, 0x1`), so the second line's bank index is `0x73 + 2*joke + bit`.
 */
export const JOKE_FLAVOR_FIRST_ID = 0x73;
/**
 * The shared battle-message VM arm with F0x8009a734's shape: line 1 the name, line 2 the
 * caller's own index. That is arm 7, `.L0x80099908` (fightstg.s:23587-23611): `li $a2, 0x16`
 * on the first element, `lw $a2, ($s2)` on the second, `sw $v0, 0x7c($a0)` counting two
 * lines, and the shared tail filling slot 1 of line 1. The joke gag is that same picture,
 * reached through its own builder instead of the arm table.
 */
export const JOKE_GAG_KIND = 7;

/** Initial joke-permutation table (fightstg 0x800a3624, before the shuffle). */
const INIT_PERM: readonly number[] = [7, 1, 0, 3, 2, 5, 4, 6];

/** The 6 icons drawn from the shuffled table (F0x8009a2dc loops i<6). */
const VISIBLE_JOKES = 6;

export interface JokeMenuEntry { label: string; jokeIndex: number; }

/**
 * Player joke-confirm outcome (F0x800a1910).
 *
 * `magnitude` is combatant byte +0x1f, `effectiveWind` is effective-stat
 * halfword +0x12, and `confuseResistance` is effective-stat halfword +0x1e.
 * There is no explicit clamp: thresholds <=0 always Attack and >=128 always
 * gag because the random operand is limited to 0..127.
 */
export function confusionGagRoll(
  magnitude: number,
  effectiveWind: number,
  confuseResistance: number,
  rng: () => number,
): boolean {
  const threshold = magnitude - Math.trunc((effectiveWind + confuseResistance) / 8);
  return (rng() & 0x7f) < threshold;
}

/**
 * Build the confused-player command menu: Fisher-Yates shuffle of the 8-entry
 * joke table (F0x8009a898 state 0 — 8 iterations, j = rand()%8, swap
 * tbl[i]↔tbl[j]), then the first 6 entries are drawn (F0x8009a2dc). Returns the
 * visible rows as {label, jokeIndex}. `rng` is the shared RAND_U16.
 */
export function shuffleJokeMenu(rng: () => number): JokeMenuEntry[] {
  const t = INIT_PERM.slice();
  for (let i = 0; i < 8; i++) {
    const j = (rng() >>> 0) % 8;
    const tmp = t[i]!; t[i] = t[j]!; t[j] = tmp;
  }
  return t.slice(0, VISIBLE_JOKES).map((jokeIndex) => ({
    label: JOKE_COMMANDS[jokeIndex] ?? "?", jokeIndex,
  }));
}

/**
 * The flavor line shown when a confused player picks a joke (F0x8009a734: a
 * pad/timing bit selects one of the joke's two paired lines).
 */
export function jokeFlavorLine(jokeIndex: number, rng: () => number): string {
  const pair = JOKE_FLAVOR[jokeIndex] ?? ["", ""];
  return pair[rng() & 1] ?? pair[0]!;
}

/**
 * The one draw the original makes for a gag: which of the joke's two lines, and the bank
 * index the battle message box's second line element is given.
 *
 * `rng` is the shared RAND_U16 and supplies the single bit `.L0x8009ab04` ORs into the
 * doubled joke entry — the same bit `jokeFlavorLine` picks with, so the words and the index
 * can never disagree.
 */
export function jokeFlavorPick(jokeIndex: number, rng: () => number): { msgId: number; bit: number; text: string } {
  const j = (jokeIndex | 0) % JOKE_FLAVOR.length;
  const bit = rng() & 1;
  return { msgId: jokeFlavorMessageId(j, bit), bit, text: JOKE_FLAVOR[j]![bit] ?? "" };
}

/** A random enemy/auto gag one-liner (turn-gate F0x80088564: msg 0x83 + rand()%8). */
export function enemyGagLine(rng: () => number): string {
  return ENEMY_GAG_LINES[(rng() >>> 0) % ENEMY_GAG_LINES.length] ?? ENEMY_GAG_LINES[0]!;
}
