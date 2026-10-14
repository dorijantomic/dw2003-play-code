/**
 * THE item boxes (p126itmb) and what a talk does to one: the box leaves the
 * field the moment its textbox closes.
 *
 * ── the family, from the talk body's own id test ────────────────────────────
 *
 * The shared field-character mode dispatcher F0x8008FED0 (fieldstg.s file
 * 0xd220-0xd274; the 0x51-entry table at RAM 0x80083590 = file 0x8e0) sends
 * mode 0x4A to the talk body at file 0xde4c-0xe19c (RAM 0x80090afc). Its very
 * first block is an npc-id test (file 0xde4c-0xde84):
 *
 *     .L0x0000de4c: lw    $v1, 0x4($s0)            # npc_id
 *     .L0x0000de54: beq   $v1, 0x21, .L0x0000de80  # 33
 *     .L0x0000de5c: addiu $v0, $v1, -0x4d
 *     .L0x0000de60: sltiu $v0, 0xb                # 77..87
 *     .L0x0000de68: addiu $v0, $v1, -0x154
 *     .L0x0000de6c: sltiu $v0, 0x5                # 340..344
 *     .L0x0000de74: li    $v0, 0x15b
 *     .L0x0000de78: bne   $v1, $v0, .L0x0000de84   # 347
 *     .L0x0000de80: li    $s2, 0x1                 # the family flag (s2)
 *
 * Those ids are exactly the p126itmb records of the shipped scenes -- 124
 * instances over 18 ids, and no other sprite carries one of them (the census
 * in tests/engine/systems/box-actor.test.ts reads web/assets/scenes).
 *
 * ── the talk's start arm (file 0xde9c-0xdf90) ───────────────────────────────
 *
 * The first ptrB triple whose gate passes supplies the line and the on-close
 * flag table. `entity+0xFC = t->ptr2` is stored at file 0xdeec -- the DELAY
 * SLOT of the family branch at 0xdee8 -- so the on-close table is remembered
 * for every id, family or not. For the family only (s2 != 0):
 *
 *   - the turn-to-face (0xdf00-0xdf18) is skipped; and
 *   - the textbox speaker handed to the dialogue opener F0x80088d38 is the
 *     ENGAGER (the player, 0xdf40-0xdf44), not the box itself, so the line
 *     anchors at the player; and
 *   - the box plays clip 0x41 and requests cue 0x80045DC7 (0xdf58-0xdf78),
 *     which docs/research/audio/soundtst-all-categories.json names TRESUREB.
 *     Wired at the talk-start arm in web/game.js: the clip latches onto the
 *     actor (activeClip) and ticks while the textbox is open, holding its open
 *     frame at the clip's -1 sentinel (file 0xce8c-0xce9c: timer 0xffff,
 *     +0xe8 = 1); the cue goes through sfx.playPacked, which resolves it to the
 *     extracted common-bank sample `tresureb` (web/assets/sfx/manifest.json,
 *     id 0x80045dc7).
 *
 * The dialogue handle goes into the shared slot at 0xdf54 -- again a delay
 * slot, of the `beqz $s2` at 0xdf50 -- and the sub-step advances through
 * `[entity+0x40]` (F0x800142e0, file 0xdf7c-0xdf88).
 *
 * ── the talk's close arm: the removal (file 0xdf94-0xdfc0) ─────────────────
 *
 * The body polls the dialogue handle; on the first tick it reads closed:
 *
 *     .L0x0000dfa4: bnez $s2, .L0x0000dfb8     # family -> the remove arm
 *     .L0x0000dfa8: move $a0, $s0              # (delay slot)
 *     .L0x0000dfac: lw   $v0, 0x2c($s0)        # else: setMode(1) ...
 *     .L0x0000dfb0: j    0x80090c70
 *     .L0x0000dfb4: li   $a1, 0x1
 *     .L0x0000dfb8: lw   $v0, 0x28($s0)        # ... family: the remove slot
 *     .L0x0000dfbc: li   $a1, 0x3
 *     .L0x0000dfc0: jalr $v0                  # [entity+0x28](entity, 3)
 *
 * `[+0x28]` is the allocator-installed band method F0x80014274 (exe fns.s,
 * installed by F0x800143dc alongside `+0x2c` = F0x80014288, the mode setter):
 * it writes 3 into entity+0xC and clears mode/sub-step/counter. That is the
 * field's "gone" state -- the confirm probe only ever accepts a target whose
 * +0xC reads 1 (fieldstg.s file 0xb648-0xb650). The same arm then applies
 * entity+0xFC as the on-close set table (`[0x80048AD0]` = F0x80016988,
 * 0xdff8-0xe010) -- the write that flips the box's own spawn flag and its item
 * banks -- and clears the field lock `[0x80099DE0]` (0xe09c-0xe0a0).
 *
 * So, read end to end: a box is removed ON THE FIRST TICK the dialogue reads
 * closed -- no clip wait (unlike the block actors, which wait out their
 * break-apart clip), no re-read of the spawn gate, and not conditional on what
 * the on-close table writes. Ordinary NPCs take the setMode(1) arm and keep
 * their actor; that is why a talk whose on-close writes its own spawn flag
 * (Veemon, s395) must not vanish (engine/dw3/npc-manager.ts `stageCast`).
 *
 * The walker's port of this arm lives at the talk's onClose in web/game.js
 * (the `isBoxActorId` branch), using removeSceneActor -- the same shape the
 * block actors' own `+0x28(3)` takes there.
 */

/** The family's ids, exactly as the talk body's test spells them. */
export const BOX_ACTOR_IDS = [
  33,
  77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87,
  340, 341, 342, 343, 344,
  347,
] as const;

/** The talk-start clip the family plays while the box is open (file 0xdf5c). */
export const BOX_TALK_CLIP = 0x41;
/** The cue requested at the same moment (file 0xdf64-0xdf74): TRESUREB. */
export const BOX_TALK_CUE = 0x80045dc7;
/** The remove state the close arm calls `+0x28` with (file 0xdfbc). */
export const BOX_GONE_STATE = 3;

/** True for an npc id in the family the talk body's s2 test names. */
export function isBoxActorId(id: number | null | undefined): boolean {
  if (id == null || !Number.isFinite(id)) return false;
  return (
    id === 33 ||
    (id >= 77 && id <= 87) ||
    (id >= 340 && id <= 344) ||
    id === 347
  );
}
