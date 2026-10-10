/**
 * The controller-input service block: the one record bank every screen reads.
 *
 * In the original this is the resident object at `D0x8004B7D0`. It is filled
 * once per vertical blank by `F0x8001851C` (the poll) and every screen reads
 * it through the function-pointer cells at `0x8004BBB0..0x8004BBF0` — twenty-four
 * overlays read the pressed word alone. This module is the single owner of its
 * base, its strides and its field names, so a screen cannot answer a different
 * row than the original.
 *
 * Authority 2 (original assembly), `~/ddw3/asm/dw2003/exe/fns.s`:
 *
 *   F0x80018854  fns.s:9335-9345   lhu  0x48($v0)   -> pressed this frame
 *   F0x80018878  fns.s:9347-9357   lhu  0x4e($v0)   -> held this frame
 *   F0x8001889C  fns.s:9359-9369   lhu  0x4a($v0)   -> auto-repeat this frame
 *   F0x80018980  fns.s:9429-9437   lbu  0xa4($a1)   -> logical button's bit
 *
 * All four address the same way, and the arithmetic is `slot*0x1C0` from the
 * block base:
 *
 *   .L0x80018854 la_ $v1, D0x8004b7d0     fns.s:9338
 *   .L0x8001885c sll $v0, $a0, 0x3        fns.s:9339   a0 * 8
 *   .L0x80018860 subu $v0, $a0            fns.s:9340   a0 * 7
 *   .L0x80018864 sll $v0, 0x6             fns.s:9341   a0 * 0x1C0
 *   .L0x80018868 addu $v0, $v1            fns.s:9342
 *   .L0x8001886c lhu $v0, 0x48($v0)       fns.s:9343
 *
 * `F0x80018980` takes TWO arguments, `(port, logicalId)`, and the listing
 * renders it as if it took one. fns.s:9433 prints `addu $a1, $v1`; the word is
 * `0x00a32821`, whose `rs` field is `$a1` and whose `rd` is also `$a1`, so the
 * renderer dropped a source register it thought it could elide. It is
 * `addu $a1, $a1, $v1`, so `$a1` survives and the routine returns
 * `mem[block + $a1 + port*0x1C0 + 0xA4]` — the record's map indexed by the
 * logical id the caller asked for. Every overlay's hot idiom depends on this:
 * `la_ block` / `lw f, 0x3f4(block)` / `jalr f` (the pressed word) / `li $a1, id`
 * / `lw f, 0x408(block)` / `jalr f` / `move_ $s0, $v0` **in the delay slot** /
 * `srav $s0, $s0, $v0` / `andi $s0, 1`. The delay slot is what makes it work: it
 * runs BEFORE the jump, so it captures the pressed word into `$s0` before the
 * map call overwrites `$v0` with the bit index. The merchant's own arm is the
 * reference (`pro/stitshop.s:9148`-`:9160` for Up, `:9205`-`:9212` for confirm).
 *
 * The three callers I read in the overlays pass `a0 = 0`
 * (`pro/soundtst.s` `lw $v0, -0x443c($v0)` / `move_ $a0, $zr`, fns cell
 * 0x8004BBC4; `pro/fightstg.s` `move_ $a0, $s3` with `s3 = 0`), so port 0 is
 * what a player sees.
 *
 * ## What one record holds
 *
 * The poll writes a `0x70`-byte record per controller. The record base is
 * `D0x8004B818` = block + 0x48, and the address is
 * `D0x8004B818 + (id>>4&1)*0x1C0 + (id&3)*0x70` — the original builds it in
 * `F0x80018BCC` at fns.s:9645-9652:
 *
 *   .L0x80018c30 sll $a0, 0x6       fns.s:9645   ((id>>4)&1) * 0x1C0
 *   .L0x80018c40 sll $v0, 0x4       fns.s:9649   (id&3) * 0x70
 *   .L0x80018c44 la_ $v1, D0x8004b818 fns.s:9650
 *   .L0x80018c50 addu $s4, $a0, $v0 fns.s:9652
 *
 * `0x1C0` is therefore a per-port block of four multitap slots, not one pad;
 * `0x70` is the per-slot record. The getters above address slot 0 only, which
 * is why `padRecordAddress` is separate from them.
 *
 * The fields, as `F0x80018BCC` writes them at the end of its body
 * (fns.s:9820-9828) and as `F0x80018F44` zeroes them for an absent pad
 * (fns.s:9875-9878):
 *
 *   .L0x80018efc lhu $v0, 0x6($s4)      fns.s:9823   the word from last poll
 *   .L0x80018f00 sh  $s3, 0x6($s4)      fns.s:9824   held, this frame
 *   .L0x80018f04 sh  $v0, 0x4($s4)      fns.s:9825   held, previous frame
 *   .L0x80018f08 xor $v0, $s3           fns.s:9826
 *   .L0x80018f0c and $v0, $s3, $v0      fns.s:9827   held AND (held XOR prev)
 *   .L0x80018f10 sh  $v0, ($s4)         fns.s:9828   pressed, this frame
 *
 * so a bit appears in the pressed word only on the frame the button goes down,
 * and `+0x02` is zeroed at fns.s:9753 and re-ored with the one bit whose hold
 * timer expired (fns.s:9809).
 *
 * Claims: `CORE-PAD-SERVICE-OBJECT-0x8004B7D0-001`,
 * `CORE-PAD-RECORD-BUTTON-WORDS-001`, `CORE-PAD-KEYMAP-REMAP-001`,
 * `UI-PAD-REPEATCURVE-2026-08-21`. Read
 * docs/research/ui/pad-input-service-behaviour-2026-08-21.md before changing a
 * field name; the per-button repeat timer and its 16/6/4 cadence are there.
 */

/** The service object every screen reads (`D0x8004B7D0`). */
export const PAD_BLOCK = 0x8004b7d0;
/** Its whole size: `memset(D0x8004B7D0, .., 0x3E0)` in F0x80018310 (fns.s:8990-8991). */
export const PAD_BLOCK_SIZE = 0x3e0;
/** Where the first input record sits inside the block (fns.s:9650). */
export const PAD_RECORD_OFFSET = 0x48;
/** The first record's address: `D0x8004B818`. */
export const PAD_RECORD_BASE = PAD_BLOCK + PAD_RECORD_OFFSET;
/** One controller port's block of four multitap slots. */
export const PAD_PORT_STRIDE = 0x1c0;
/** One slot's record inside a port block. */
export const PAD_SLOT_STRIDE = 0x70;
/** Ports the block holds: `memset 0x3E0` fits two `0x1C0` blocks past the header. */
export const PAD_PORTS = 2;
/** Multitap slots inside a port block. */
export const PAD_SLOTS_PER_PORT = 4;
/** Buttons in a logical-button map. */
export const PAD_BUTTONS = 16;

/* ── the fields of one record, relative to the record base ─────────────────── */

/** Buttons that went down this frame. Read by F0x80018854. */
export const PAD_PRESSED = 0x00;
/** Buttons whose hold timer fired this frame. Read by F0x8001889C. */
export const PAD_REPEAT = 0x02;
/** The buttons held on the previous poll. */
export const PAD_HELD_PREVIOUS = 0x04;
/** The buttons held on this poll. Read by F0x80018878. */
export const PAD_HELD = 0x06;
/** The four raw pad bytes copied out of the poll buffer, `+ n` (fns.s:9684). */
export const PAD_RAW_BYTE = 0x08;
/** Left/right stick reading folded into bits 0x80 / 0x20 (fns.s:9732). */
export const PAD_STICK_X = 0x0a;
/** Up/down stick reading folded into bits 0x40 / 0x10 (fns.s:9742). */
export const PAD_STICK_Y = 0x0b;
/** The tick each button last repeated on, `+ 4*b`, 16 entries (fns.s:9767). */
export const PAD_REPEAT_TICK = 0x0c;
/** The accelerating-repeat credit per button, `+ b`, 16 entries (fns.s:9772). */
export const PAD_REPEAT_CREDIT = 0x4c;
/** Logical button `n` -> physical bit `b`, `+ n`, 16 entries (fns.s:9394). */
export const PAD_BUTTON_MAP = 0x5c;
/** The analog axis word read by F0x80019224 (fns.s:10066). */
export const PAD_ANALOG = 0x6c;

/* ── the same fields as the getters address them: block + port*0x1C0 + off ─── */

/** The pressed word inside a port block (fns.s:9343). */
export const PAD_PRESSED_IN_PORT = PAD_RECORD_OFFSET + PAD_PRESSED;
/** The repeat word inside a port block (fns.s:9367). */
export const PAD_REPEAT_IN_PORT = PAD_RECORD_OFFSET + PAD_REPEAT;
/** The held word inside a port block (fns.s:9355). */
export const PAD_HELD_IN_PORT = PAD_RECORD_OFFSET + PAD_HELD;
/** The logical-button map inside a port block (fns.s:9435). */
export const PAD_BUTTON_MAP_IN_PORT = PAD_RECORD_OFFSET + PAD_BUTTON_MAP;

/* ── the service cells, as offsets from the block base ────────────────────── */
/* The screens that call the original's function pointers name the cell, not
 * the record: cell 0x8004BBC4 is the pressed word's getter, and the walker has
 * always written that as `0x8004B7D0 + 0x3F4`. Both names are kept here so a
 * screen cannot invent a fourth spelling. */

/** Cell 0x8004BBC4 -> F0x80018854, the pressed word. */
export const PAD_CELL_PRESSED = 0x3f4;
/** Cell 0x8004BBC8 -> F0x80018878, the held word. */
export const PAD_CELL_HELD = 0x3f8;
/** Cell 0x8004BBCC -> F0x8001889C, the repeat word. */
export const PAD_CELL_REPEAT = 0x3fc;
/** Cell 0x8004BBD8 -> F0x80018980, the logical-button map. */
export const PAD_CELL_BUTTON_MAP = 0x408;

export interface PadBlockWordReader {
    read16(addr: number): number;
}

export interface PadBlockByteReader {
    read8(addr: number): number;
}

export interface PadBlockMemory extends PadBlockWordReader, PadBlockByteReader {}

/**
 * The address of one slot's record, as F0x80018BCC builds it (fns.s:9645-9652).
 *
 * `block` is the port block (the index the getters take) and `slot` the
 * multitap slot inside it. `padRecordAddressOfId` is the same address in the
 * controller-id encoding the poll itself loops over.
 */
export function padRecordAddress(block: number, slot = 0): number {
    return (PAD_RECORD_BASE
        + (block >>> 0) * PAD_PORT_STRIDE
        + (slot >>> 0) * PAD_SLOT_STRIDE) >>> 0;
}

/**
 * The address of one record in the controller-id encoding: bit 4 picks the
 * port block, bits 0-1 the multitap slot (`srl $s0, 0x4` / `andi $s0, 0x1` /
 * `andi $s1, 0x3`, fns.s:9640-9649). `F0x8001851C` feeds it 0..3 and 0x10..0x13
 * (fns.s:9174-9202).
 */
export function padRecordAddressOfId(id: number): number {
    const n = id >>> 0;
    return (PAD_RECORD_BASE + ((n >> 4) & 1) * PAD_PORT_STRIDE + (n & 3) * PAD_SLOT_STRIDE) >>> 0;
}

/** The halfword at one field of one slot's record. */
export function padRecordWord(
    mem: PadBlockWordReader,
    block: number,
    field: number,
    slot = 0,
): number {
    return mem.read16(padRecordAddress(block, slot) + field) & 0xffff;
}

/** The byte at one field of one slot's record. */
export function padRecordByte(
    mem: PadBlockByteReader,
    block: number,
    field: number,
    slot = 0,
): number {
    return mem.read8(padRecordAddress(block, slot) + field) & 0xff;
}

/**
 * F0x80018854(port): the buttons that went down this frame, at
 * `block + port*0x1C0 + 0x48`.
 */
export function padPressed(mem: PadBlockWordReader, block = 0): number {
    return mem.read16(PAD_BLOCK + block * PAD_PORT_STRIDE + PAD_PRESSED_IN_PORT) & 0xffff;
}

/** F0x80018878(port): the buttons held this frame, at `+ 0x4E`. */
export function padHeld(mem: PadBlockWordReader, block = 0): number {
    return mem.read16(PAD_BLOCK + block * PAD_PORT_STRIDE + PAD_HELD_IN_PORT) & 0xffff;
}

/** F0x8001889C(port): the buttons repeating this frame, at `+ 0x4A`. */
export function padRepeat(mem: PadBlockWordReader, block = 0): number {
    return mem.read16(PAD_BLOCK + block * PAD_PORT_STRIDE + PAD_REPEAT_IN_PORT) & 0xffff;
}

/**
 * F0x80018980(port, logicalId): which physical bit a logical button sits on, at
 * `block + port*0x1C0 + logicalId + 0xA4`.
 *
 * Two arguments, and the second is the record's own sixteen-entry map rather
 * than a name the routine knows: the listing at `~/ddw3/asm/dw2003/exe/fns.s:9433`
 * prints `addu $a1, $v1`, which reads as if `$a1` were clobbered and only the
 * port survived, but the word `0x00a32821` has `rs = $a1` and `rd = $a1`, so the
 * renderer elided a source register equal to the destination and the instruction
 * is `addu $a1, $a1, $v1`. Every overlay asks it with two arguments
 * (`pro/stitshop.s:9153` `li $a1, 0x4`, `:9169` `0x6`, `:9205` `0xd`, `:9229`
 * `0xe`; `pro/cardgame.s:1223`/`:1230` the same shape), and without the second
 * one every one of those tests would read entry 0 and never fire.
 *
 * The shipped table is the identity 0x00..0x0f, so logical `n` is bit `n`, and
 * the caller turns it into a test by shifting the PRESSED word by the returned
 * index (`srav`/`andi 1`) — which is why the map must answer with an INDEX and
 * not a mask.
 */
export function padButtonBit(mem: PadBlockByteReader, block: number, code: number): number {
    return mem.read8(PAD_BLOCK + block * PAD_PORT_STRIDE + PAD_BUTTON_MAP_IN_PORT + (code | 0)) & 0xff;
}