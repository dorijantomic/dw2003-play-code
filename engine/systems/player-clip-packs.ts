// The PLAYER's clip → sprite-pack rule, decoded from FIELDSTG's per-frame clip
// resolver F0x8008F9C0 (file 0xcd10).
//
// This is the shared system behind three separate-looking behaviours: the
// fishing cast drawing from P002PLYF, the ladder drawing from P002PLYL, and the
// tree kick drawing from P002PLYK. None of them swaps a handle. Junior carries
// FIVE sprite packs, and the resolver picks one from the CLIP ID alone, every
// frame the clip changes, before the clip's frames are looked up. One table
// does all of them.
//
// ── The resolver's arm chain, line by line ───────────────────────────────────
// fieldstg.s:13131-13172 (file 0xcd10-0xcdb4, RAM 0x8008F9C0-0x8008FA64). The
// `j 0x8008fa64` target is file 0xcdb4, the one `sw $v0,0x9c($s1)`. Each arm's
// `lui` sits in the DELAY SLOT of the branch that reaches it, and that delay
// slot always runs, so the arm's `ori` finishes the pair:
//
//   cd2c  lw   $s0, 0xa0($s1)          ; s0 = the latched clip (a signed word)
//   cd3c  beq  $a0, $s0, ce70          ; previous clip (+0xa4) == clip -> no reload
//   cd44  lw   $v1, 0x4($s1)           ; the entity's character id
//   cd4c  bne  $v1, 2, cdc8            ; not the player -> skip the remap
//   cd54  slti $v0, $s0, 0x8
//   cd58  beqz $v0, cd80               ; clip >= 8 -> the chain below
//   cd5c  lui  $v0, 0x187              ;   delay slot
//   cd60  j    0x8008fa64
//   cd64  ori  $v0, 0x70               ;   clip < 8        -> 0x01870070 P002PLAY
//   cd80  li   $v0, 0x8
//   cd84  beq  $s0, $v0, cd68
//   cd88  lui  $v0, 0x3cb              ;   delay slot; cd6c ori 0x1e -> 0x03cb001e P002PLYK
//   cd8c  slti $v0, $s0, 0x16
//   cd90  bnez $v0, cdac               ;   9..0x15 -> cdac/cdb0 -> 0x03ca0064 P002PLYF
//   cd94  slti $v0, $s0, 0x1a          ;   delay slot
//   cd98  bnez $v0, cd70
//   cd9c  lui  $v0, 0x3c9              ;   delay slot; cd74 ori 0xb  -> 0x03c9000b P002PLYD
//   cda0  slti $v0, $s0, 0x25
//   cda4  bnez $v0, cd78
//   cda8  lui  $v0, 0x3cc              ;   delay slot; cd7c ori 0x17 -> 0x03cc0017 P002PLYL
//   cdac  lui  $v0, 0x3ca              ; clip >= 0x25 falls through here too
//   cdb0  ori  $v0, 0x64               ;                  -> 0x03ca0064 P002PLYF
//   cdb4  sw   $v0, 0x9c($s1)
//
// Every `slti` is SIGNED, and +0xa0 is read with `lw`, so a negative clip takes
// the clip < 8 arm. The first arm therefore starts at the lowest int32 and the
// last one ends at the highest; the clip is compared as a signed 32-bit value.
//
// ── The two paths this closes ───────────────────────────────────────────────
//   clip 0x11 for the player is not < 8 and not 8, and is < 0x16, so it takes
//     the cd90 branch to 0x03ca0064 = P002PLYF. P002PLYF's clip directory (its
//     bin 100) defines 0x11..0x15, so the clip resolves. No separate swap site
//     exists, and none is needed.
//   clip 26 (0x1a) is not < 0x1a and is < 0x25, so it takes the cda4 branch to
//     0x03cc0017 = P002PLYL, whose clip directory (bin 23) defines 0x1a..0x20,
//     the ladder set.
//
// ── Why `scene_struct+0x74` is NOT this ─────────────────────────────────────
// The constructor sets `entity+0x9c = scene_struct->+0x74(npc_id)` (file
// 0xe5f0), and that resolver is F0x800920DC (file 0xf42c), in full:
//
//   f42c  lui   $v0, 0x800a
//   f430  addiu $v0, -0x6200           ; v0 = 0x80099E00, the GLOBAL npc_id table
//   f434  sll   $a0, 0x2               ; a0 = npc_id * 4
//   f438  addu  $a0, $v0
//   f43c  lw    $v0, ($a0)             ; return TABLE[npc_id]
//   f440  jr    $ra
//   f444  nop
//
// One `TABLE[npc_id]` over a flat global word array (npc_id 0..405) — npc_id to
// sprite handle, with nothing about clips or packs. It supplies the CONSTRUCTOR
// value only; the resolver above overwrites +0x9c from the clip range before any
// frame is read. So the "species-pack table reached through scene_struct+0x74"
// lead is CLOSED: it cannot yield P002PLYF, because P002PLYF is not an npc_id
// and never appears in that table.

// ── The five packs, and the cross-check that the arms are read right ────────
// Each arm's low half is that pack's own highest `.bin`, which is its clip
// directory (field-actor-anim-engine.md §"Clip directory format DECODED"). Every
// arm range and the pack's own directory agree on every clip either defines:
//
// | arm        | clips  | pack     | dir bin | that pack's directory defines |
// | ---------- | ------ | -------- | ------- | ----------------------------- |
// | clip < 8   | ..7    | P002PLAY | 112     | 1, 4, 5, 6, 7                 |
// | clip == 8  | 8      | P002PLYK | 30      | 8                             |
// | 0x09..0x15 | 9..21  | P002PLYF | 100     | 0x11..0x15, 0x3c              |
// | 0x16..0x19 | 22..25 | P002PLYD | 11      | 0x16..0x19                    |
// | 0x1a..0x24 | 26..36 | P002PLYL | 23      | 0x1a..0x20                    |
// | >= 0x25    | 37+    | P002PLYF | 100     | (the same fall-through arm)    |
//
// The last arm is the chain's fall-through: there is no test past 37, so those
// clips land on the P002PLYF pair. No player mode latches a clip in 37..0xffff
// today, but the arm is part of the rule and is carried here.

/** The player's ordinary pack — also the constructor's own `+0x9c` value for npc 2. */
export const PLAYER_PACK_PLAY = "p002play";
/** The tree kick: booting a tree, leader mode 0x49, one clip. */
export const PLAYER_PACK_KICK = "p002plyk";
/** The fishing cast: leader mode 0x48, clips 0x11..0x15. */
export const PLAYER_PACK_FISHING = "p002plyf";
/** The slope step: leader mode 0x47, clips 0x16..0x19. */
export const PLAYER_PACK_SLOPE = "p002plyd";
/** The ladder: leader modes 0x40..0x46, clips 0x1a..0x20. */
export const PLAYER_PACK_LADDER = "p002plyl";

/** One arm of the resolver's range chain, with the constant it stores. */
export interface PlayerClipPackArm {
    /** Inclusive lower clip bound. */
    readonly lo: number;
    /** Inclusive upper clip bound; `lo === hi` for the single-clip arm. */
    readonly hi: number;
    /** The whole `(pack LBA << 16) | clip-directory bin` constant stored. */
    readonly handle: number;
    /** The disc LBA index of the pack, from `lba.rs`. */
    readonly lba: number;
    /** That pack's highest `.bin`, which the constant's low half equals. */
    readonly dirBin: number;
    /** The walker's name for the pack. */
    readonly pack: string;
}

/**
 * The resolver's arm chain in test order. `playerPackForClip` and
 * `playerPackArmForClip` both read only this, so the rule cannot drift from the
 * census of it.
 */
export const PLAYER_CLIP_PACK_ARMS: readonly PlayerClipPackArm[] = [
    { lo: -0x80000000, hi: 7, handle: 0x01870070, lba: 391, dirBin: 112, pack: PLAYER_PACK_PLAY },
    { lo: 8, hi: 8, handle: 0x03cb001e, lba: 971, dirBin: 30, pack: PLAYER_PACK_KICK },
    { lo: 9, hi: 0x15, handle: 0x03ca0064, lba: 970, dirBin: 100, pack: PLAYER_PACK_FISHING },
    { lo: 0x16, hi: 0x19, handle: 0x03c9000b, lba: 969, dirBin: 11, pack: PLAYER_PACK_SLOPE },
    { lo: 0x1a, hi: 0x24, handle: 0x03cc0017, lba: 972, dirBin: 23, pack: PLAYER_PACK_LADDER },
    { lo: 0x25, hi: 0x7fffffff, handle: 0x03ca0064, lba: 970, dirBin: 100, pack: PLAYER_PACK_FISHING },
];

/** Every pack the rule can name, in arm order. */
export const PLAYER_CLIP_PACKS: readonly string[] = PLAYER_CLIP_PACK_ARMS.map((a) => a.pack);

/** The one rule: the arm a latched clip id falls in. */
export function playerPackArmForClip(clip: number): PlayerClipPackArm {
    const c = clip | 0; // `lw` +0xa0, then signed `slti` compares
    for (const arm of PLAYER_CLIP_PACK_ARMS) {
        if (c >= arm.lo && c <= arm.hi) return arm;
    }
    /* c8 unreachable: the arms cover every int32. */
    return PLAYER_CLIP_PACK_ARMS[PLAYER_CLIP_PACK_ARMS.length - 1]!;
}

/**
 * The pack a latched clip id resolves through. Every mode that latches a clip
 * gets its pack from here, which is what the original does.
 *
 * The original applies the rule only to the player — the resolver gates it on
 * the entity's character id being 2 (fieldstg.s:13149-13152) — and only re-runs
 * when the clip CHANGES (`beq $a0,$s0` at :13143 skips an unchanged clip), which
 * is why the walker only asks when it is about to draw a different clip.
 */
export function playerPackForClip(clip: number): string {
    return playerPackArmForClip(clip).pack;
}

/** The `(LBA, dirBin)` constant the resolver stores for `clip`, as one whole number. */
export function playerPackHandleForClip(clip: number): number {
    return playerPackArmForClip(clip).handle;
}