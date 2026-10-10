// Digi-Egg traversal forms — the player field character the game rebuilds when
// you dive through a hole (Digmon) or a dock/water surface (Submarimon).
//
// DECODE (fieldstg.s, PAL SLES-03936; overlay base 0x80082cb0)
//
// 1. Entrance. The field step-program VM reaches a dive through two opcodes.
//    The jump-table entries 0x8008885c (op 9) and 0x80088854 (op 10) are
//    two-instruction stubs converging at 0x80088860; they differ only in a2
//    (op 10: `move $a2,$zero`; op 9: `addiu $a2,$zero,1`). The convergence then
//    loads a0 = [s0+0x58] (the field character) and a1 = [s0+0x64] + 0xa (the
//    step record's params) and dispatches indirectly through [a0+0x124].
//    So op 9 = HOLE = a2 1, op 10 = WATER = a2 0.
//
// 2. Launcher. The field-character constructor at 0x800911fc fills +0x124 with
//    F0x8008f3e4. That function: calls [char+0x2c](char, 1) (freeze), clears
//    char+0x108 and char+0x60, sets the global 0x80099dd8 (scene_struct+0x58)
//    to 1, and calls F0x8008c078(mode, &char+0x58, stepRecord).
//
// 3. F0x8008c078 does NOT allocate. [0x8004b7bc] is F0x8001810c, the 100-slot
//    object-registry LOOKUP (see docs/research/scripting/
//    bank70-opcode-handlers-decoded-2026-07-27.md § "The registry and the
//    vtable that is not a vtable"): F(7,-1,-1) returns the resident type-7
//    object. The launcher seeds it — +0x70 = hole/water mode, +0x74/+0x78 =
//    the player's x/y, +0x7c = the destination step record — then calls
//    [obj+0x2c](obj, 3). Slot +0x2c is always the allocator's copied
//    F0x80014288, i.e. setSub1(n): obj+0x10 = n, +0x14 = 0, +0x18 = 0.
//
// 4. The type-7 object is allocated at fieldstg file 0x89f8 with
//    a0 = 0x8008aa10 (callback), a1 = 0x80 (size), a2 = 0x7c, a3 = 7 (type).
//    Its callback F0x8008aa10 switches on sub1 (+0x10) through the 5-entry
//    jump table at 0x80082ef0; entry 3 is 0x8008ae50. So a dive is
//    "rebuild the field cast", and the FORM SWAP IS THE TRANSITION, not a
//    separate actor.
//
// 5. The cast rebuild at 0x8008ae50 walks the destination stage's actor list
//    at scene_struct+0x4c (0x80099dcc). Each record's id is the s16 at +0x8.
//    A record whose id is 0x6a, or in [0x146, 0x148), becomes the PLAYER:
//    `makeFieldChar(id, 0, 0, 0)` -> [ctrl+0x18]. With no such record the
//    player is built as id 2 (Junior, p002play). The follower loop at
//    0x83fc-0x8408 repeats the same window test and SKIPS those ids, which is
//    why a dive section has no party trail.
//      0x146 = 326 -> p123digm (Digmon)
//      0x147 = 327 -> p122sbmm (Submarimon)
//
// 6. Per-form deltas in the character constructor F0x8009116c (s3 = sprite id):
//      326 (Digmon):     +0x68 (the move magnitude) = base >> 1, and +0xc8 = -1
//                        (0x8009116c file 0xe67c-0x0e6a0)
//      327 (Submarimon): +0x108 = 0x8008e45c instead of the default 0x8008e8ac,
//                        +0x64 = 0x3000 (global default), +0x84 = 1
//                        (file 0xe6b4-0x0e6f8)
//    The footstep routine at 0x8008d0c4 also branches 326 / 327 / default
//    (default plays packed 0x8004583c = the `player00` step sound).
//
// NOT DECODED, deliberately absent here: no activation jingle is played on this
// path. The sub1==3 body contains no call through the sound pointer [0x80045c48]
// (checked across 0x81a0-0x8460). The TELEPORT/0x0004001d cue that
// docs/research/audio/sfx-triggers.json attributes to 0x8008c130+0x96ac belongs
// to that function's state-1 CHEST branch, which a dive never enters. Adding a
// cue here would be invention, so none is added.

/** Native sprite-table id of each traversal form, keyed by step opcode. */
export const DIVE_FORMS = {
  9: {
    stepOp: 9 as const,
    kind: "hole" as const,
    /** a2 at the 0x80088860 convergence. */
    mode: 1,
    spriteId: 0x146,
    sprite: "p123digm",
    name: "Digmon",
    egg: "Digi-Egg of Knowledge",
    /** Gate on every shipped op-9 exit; bank-0x70 ordinal range, not possession. */
    gateFlag: 0x7094,
  },
  10: {
    stepOp: 10 as const,
    kind: "water" as const,
    mode: 0,
    spriteId: 0x147,
    sprite: "p122sbmm",
    name: "Submarimon",
    egg: "Digi-Egg of Sincerity",
    gateFlag: 0x7093,
  },
} as const;

export type DiveStepOp = keyof typeof DIVE_FORMS;
export type DiveForm = (typeof DIVE_FORMS)[DiveStepOp];

/** Junior. The `else` arm of the cast rebuild's player scan (0x829c: `li $a0, 2`). */
export const SURFACE_PLAYER_SPRITE_ID = 2;

export function isDiveStepOp(op: unknown): op is DiveStepOp {
  return op === 9 || op === 10;
}

/** The traversal form a step opcode dives into, or null for an ordinary warp. */
export function diveFormForStepOp(op: unknown): DiveForm | null {
  return isDiveStepOp(op) ? DIVE_FORMS[op] : null;
}

/**
 * Move magnitude for a form, in the same 24.8 fixed-point the field character
 * keeps at +0x68. Digmon halves it; every other form walks at the base rate.
 * The native halve is an arithmetic shift of the stored magnitude
 * (`srl $v1,$v0,0x1f` / `addu` / `sra $v0,1` — round-toward-zero), so a Math
 * .trunc of base/2 reproduces it for the positive magnitudes actually stored.
 */
export function diveMoveMagnitude(form: DiveForm | null, baseMagnitude: number): number {
  if (form?.spriteId !== DIVE_FORMS[9].spriteId) return baseMagnitude;
  return Math.trunc(baseMagnitude / 2);
}

/**
 * The screens a dive form is worn on: every dive destination, plus everything
 * reachable from it WITHOUT taking another dive. The native rule is per-screen
 * (each stage's actor list carries its own 326/327 marker at descriptor+0x4c),
 * and this exit-graph derivation is KNOWN to under-cover it: the native marker
 * set is 30 screens while this walks only the ordinary exits and so never sees
 * maze-resolved entries, missing 14 maze-entered screens (s860; s875/s880/s885/
 * s890/s895; s964/s966/s967; s970-s974), where the player currently reverts to
 * the walking Digimon instead of holding the traversal form. Claim
 * `world-q001-dive-form-is-a-per-screen-cast-marker-2026-09-13`; the fix is to
 * extract the cast-list marker per screen (the descriptor's +0x4c array).
 *
 * The walk STOPS at any screen that is itself a dive source. A source is where
 * you stand to dive, so it is a surface screen by construction; in the shipped
 * data the source and destination sets are provably disjoint. Without this the
 * seabed's static exits back to its docks drag the whole surface world into the
 * section (143 screens instead of 12).
 *
 * `scenes` is {screenId: {exits: [{to, stepOp?}]}}. Returns a Map of
 * screenId -> step opcode. A screen claimed by both opcodes is left to the
 * FIRST claim and reported, rather than silently resolved.
 */
export function computeDiveNetwork(
  scenes: Record<string, { exits?: Array<{ to?: string; stepOp?: number }> } | null | undefined>,
): { network: Map<string, DiveStepOp>; conflicts: string[] } {
  const network = new Map<string, DiveStepOp>();
  const conflicts: string[] = [];
  const queue: Array<[string, DiveStepOp]> = [];

  const claim = (screen: string, op: DiveStepOp) => {
    const held = network.get(screen);
    if (held === undefined) {
      network.set(screen, op);
      queue.push([screen, op]);
    } else if (held !== op) {
      conflicts.push(screen);
    }
  };

  const diveSources = new Set<string>();
  for (const [screen, scene] of Object.entries(scenes))
    for (const exit of scene?.exits ?? [])
      if (isDiveStepOp(exit.stepOp)) diveSources.add(screen);

  for (const scene of Object.values(scenes)) {
    for (const exit of scene?.exits ?? []) {
      if (isDiveStepOp(exit.stepOp) && exit.to) claim(exit.to, exit.stepOp);
    }
  }

  while (queue.length > 0) {
    const [screen, op] = queue.shift()!;
    for (const exit of scenes[screen]?.exits ?? []) {
      // A dive exit starts a DIFFERENT section; never walk through one. A dive
      // SOURCE is a surface screen; stopping there keeps the section closed.
      if (isDiveStepOp(exit.stepOp) || !exit.to || diveSources.has(exit.to)) continue;
      claim(exit.to, op);
    }
  }
  return { network, conflicts };
}

/** The traversal form a native sprite id selects, or null (Junior/other). */
export function diveFormFromSpriteId(id: number | null | undefined): DiveForm | null {
  if (id === DIVE_FORMS[9].spriteId) return DIVE_FORMS[9];
  if (id === DIVE_FORMS[10].spriteId) return DIVE_FORMS[10];
  return null;
}

/**
 * The form to wear on `screen`. `markers` is the extracted per-screen cast-list
 * map (screen -> native sprite id 0x146/0x147), which is the authoritative
 * native rule; it is preferred when it names the screen. The exit-graph
 * `network` is only a fallback for when the marker asset is absent, because it
 * is known to miss the maze-entered screens the markers cover.
 */
export function diveFormOnScreen(
  network: ReadonlyMap<string, DiveStepOp>, screen: string,
  markers?: Record<string, number> | null,
): DiveForm | null {
  const markerId = markers?.[screen];
  if (markerId !== undefined) return diveFormFromSpriteId(markerId);
  const op = network.get(screen);
  return op === undefined ? null : DIVE_FORMS[op];
}
