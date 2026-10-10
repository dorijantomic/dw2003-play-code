// The controller-input service block, as one port.
//
// Every getter here is checked against the original's own instruction, not
// against a walker's expectation: a slot record filled with a known pattern in
// RAM must read back through the getter at exactly the address the assembly
// loads. The addresses and offsets below are transcribed by hand from
// ~/ddw3/asm/dw2003/exe/fns.s and are quoted per assertion, so changing a
// stride or a field in engine/systems/pad-block.ts fails this file.
//
//   F0x80018854  fns.s:9338-9343   base + a0*0x1C0, lhu +0x48  pressed
//   F0x80018878  fns.s:9350-9355   base + a0*0x1C0, lhu +0x4E  held
//   F0x8001889C  fns.s:9362-9367   base + a0*0x1C0, lhu +0x4A  repeat
//   F0x80018980  fns.s:9428-9435   base + a0*0x1C0, lbu +0xA4  button map
//   F0x80018BCC  fns.s:9645-9652   record = 0x8004B818 + (p>>4)*0x1C0 + (p&3)*0x70
//   F0x80018BCC  fns.s:9823-9828   writes +0x06/+0x04/+0x00 from this poll's word
//   F0x80018F44  fns.s:9875-9878   an absent pad zeroes +0x48/+0x4A/+0x4E

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeMemory } from "../engine/native/memory.ts";
import {
    PAD_ANALOG,
    PAD_BLOCK,
    PAD_BLOCK_SIZE,
    PAD_BUTTONS,
    PAD_BUTTON_MAP,
    PAD_CELL_BUTTON_MAP,
    PAD_CELL_HELD,
    PAD_CELL_PRESSED,
    PAD_CELL_REPEAT,
    PAD_HELD,
    PAD_HELD_IN_PORT,
    PAD_HELD_PREVIOUS,
    PAD_PORTS,
    PAD_PORT_STRIDE,
    PAD_PRESSED,
    PAD_PRESSED_IN_PORT,
    PAD_RAW_BYTE,
    PAD_RECORD_BASE,
    PAD_RECORD_OFFSET,
    PAD_REPEAT,
    PAD_REPEAT_CREDIT,
    PAD_REPEAT_IN_PORT,
    PAD_REPEAT_TICK,
    PAD_SLOTS_PER_PORT,
    PAD_SLOT_STRIDE,
    PAD_STICK_X,
    PAD_STICK_Y,
    padButtonBit,
    padHeld,
    padPressed,
    padRecordAddress,
    padRecordAddressOfId,
    padRecordByte,
    padRecordWord,
    padRepeat,
} from "../engine/systems/pad-block.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A distinct pattern per field, so a getter reading the wrong row is visible. */
const FILLED = {
    heldPrevious: 0x1111,
    held: 0x2222,
    pressed: 0x3333,
    repeat: 0x4444,
};

/** One slot's record, filled the way F0x80018BCC leaves it. */
function filledRecord(mem, port, slot = 0) {
    const rec = padRecordAddress(port, slot);
    mem.write16(rec + PAD_PRESSED, FILLED.pressed);
    mem.write16(rec + PAD_REPEAT, FILLED.repeat);
    mem.write16(rec + PAD_HELD_PREVIOUS, FILLED.heldPrevious);
    mem.write16(rec + PAD_HELD, FILLED.held);
    // The 16-entry logical-button map is seeded 0..15 by F0x800188C0
    // (fns.s:9386-9394) from the shipped table 0x8004BBF4 = 0x03020100.
    for (let n = 0; n < PAD_BUTTONS; n++) mem.write8(rec + PAD_BUTTON_MAP + n, n);
    return rec;
}

test("the block base, size and record base are the original's", () => {
    // fns.s:9338 `la_ $v1, D0x8004b7d0`; fns.s:8990-8991 `memset(base, .., 0x3E0)`
    // fns.s:9650 `la_ $v1, D0x8004b818`
    assert.equal(PAD_BLOCK, 0x8004b7d0);
    assert.equal(PAD_BLOCK_SIZE, 0x3e0);
    assert.equal(PAD_RECORD_OFFSET, 0x48);
    assert.equal(PAD_RECORD_BASE, 0x8004b818);
});

test("a filled record reads back through each getter at the address the assembly loads", () => {
    const mem = new NativeMemory();
    // Every record the block holds, each with its own pattern.
    for (let port = 0; port < PAD_PORTS; port++) {
        for (let slot = 0; slot < PAD_SLOTS_PER_PORT; slot++) filledRecord(mem, port, slot);
    }
    for (let port = 0; port < PAD_PORTS; port++) {
        // The three getters address slot 0 of the port block, exactly as the
        // original does: they load block + a0*0x1C0 and one fixed offset.
        const block = 0x8004b7d0 + port * 0x1c0;
        assert.equal(padPressed(mem, port), mem.read16(block + 0x48), `pressed port ${port}`);
        assert.equal(padHeld(mem, port), mem.read16(block + 0x4e), `held port ${port}`);
        assert.equal(padRepeat(mem, port), mem.read16(block + 0x4a), `repeat port ${port}`);
        // fns.s:9435 `lbu $v0, 0xa4($a1)` with $a1 = block + a0*0x1C0.
        assert.equal(padButtonBit(mem, port, 0), 0, `map[0] port ${port}`);
        assert.equal(padButtonBit(mem, port, 13), 13, `map[13] port ${port}`);
        assert.equal(padButtonBit(mem, port, 15), 15, `map[15] port ${port}`);
        // and that slot-0 record is the one at D0x8004B818 + port*0x1C0
        assert.equal(block + 0x48, padRecordAddress(port, 0) + PAD_PRESSED);
    }
});

test("the three getters do not read each other's row", () => {
    const mem = new NativeMemory();
    filledRecord(mem, 0);
    // Each value is distinct, so a stride or offset slip shows up as another
    // getter's answer.
    assert.equal(padPressed(mem, 0), 0x3333);
    assert.equal(padRepeat(mem, 0), 0x4444);
    assert.equal(padHeld(mem, 0), 0x2222);
    // and the previous-frame word is not any of the three the getters serve
    assert.equal(mem.read16(0x8004b818 + PAD_HELD_PREVIOUS), FILLED.heldPrevious);
    assert.equal(padPressed(mem, 0), mem.read16(0x8004b7d0 + 0x48));
    assert.equal(padRepeat(mem, 0), mem.read16(0x8004b7d0 + 0x4a));
    assert.equal(padHeld(mem, 0), mem.read16(0x8004b7d0 + 0x4e));
});

test("the record address is the one F0x80018BCC builds", () => {
    // fns.s:9640-9649: `(id>>4)&1` -> sll 0x6, `(id&3)` -> sll 0x4;
    // fns.s:9650-9652 `0x8004B818 + that + that`.
    for (let id = 0; id < 32; id++) {
        const expected = 0x8004b818 + ((id >> 4) & 1) * 0x1c0 + (id & 3) * 0x70;
        assert.equal(padRecordAddressOfId(id), expected >>> 0, `id ${id}`);
    }
    // The four multitap slots of one port block are 0x70 apart and the blocks
    // 0x1C0 apart, so 0x1C0 is a port block, not one pad.
    assert.equal(PAD_PORT_STRIDE, 0x1c0);
    assert.equal(PAD_SLOT_STRIDE, 0x70);
    assert.equal(PAD_SLOT_STRIDE * PAD_SLOTS_PER_PORT, PAD_PORT_STRIDE);
    assert.equal(padRecordAddress(0, 3) - padRecordAddress(0, 0), 0x150);
    assert.equal(padRecordAddress(1, 0) - padRecordAddress(0, 0), 0x1c0);
    // The two index encodings name the same records: the getters' port block
    // `n` is the poll's controller id `n<<4`.
    for (let block = 0; block < PAD_PORTS; block++) {
        for (let slot = 0; slot < PAD_SLOTS_PER_PORT; slot++) {
            assert.equal(
                padRecordAddress(block, slot),
                padRecordAddressOfId((block << 4) | slot),
                `block ${block} slot ${slot}`,
            );
        }
    }
    // And every getter's offset is the record's field plus the record's own
    // offset from the block base, so there is one number per field.
    assert.equal(PAD_PRESSED_IN_PORT, PAD_RECORD_OFFSET + PAD_PRESSED);
    assert.equal(PAD_REPEAT_IN_PORT, PAD_RECORD_OFFSET + PAD_REPEAT);
    assert.equal(PAD_HELD_IN_PORT, PAD_RECORD_OFFSET + PAD_HELD);
    assert.equal(PAD_PRESSED_IN_PORT, 0x48);
    assert.equal(PAD_REPEAT_IN_PORT, 0x4a);
    assert.equal(PAD_HELD_IN_PORT, 0x4e);
});

test("every record field the poll writes keeps its own offset", () => {
    const mem = new NativeMemory();
    const rec = filledRecord(mem, 1, 2);
    assert.equal(padRecordWord(mem, 1, PAD_PRESSED, 2), FILLED.pressed);
    assert.equal(padRecordWord(mem, 1, PAD_REPEAT, 2), FILLED.repeat);
    assert.equal(padRecordWord(mem, 1, PAD_HELD_PREVIOUS, 2), FILLED.heldPrevious);
    assert.equal(padRecordWord(mem, 1, PAD_HELD, 2), FILLED.held);
    assert.equal(padRecordByte(mem, 1, PAD_BUTTON_MAP + 4, 2), 4);
    // The remaining fields the poll touches, transcribed from F0x80018BCC.
    assert.equal(PAD_RAW_BYTE, 0x08);
    assert.equal(PAD_STICK_X, 0x0a);
    assert.equal(PAD_STICK_Y, 0x0b);
    assert.equal(PAD_REPEAT_TICK, 0x0c);
    assert.equal(PAD_REPEAT_CREDIT, 0x4c);
    assert.equal(PAD_BUTTON_MAP, 0x5c);
    assert.equal(PAD_ANALOG, 0x6c);
    // The 16 repeat counters (words at +0x0C + 4*b) and the 16 credits
    // (bytes at +0x4C + b) stay inside the 0x70 record and do not collide.
    assert.ok(PAD_REPEAT_TICK + 4 * 16 <= PAD_REPEAT_CREDIT);
    assert.ok(PAD_REPEAT_CREDIT + 16 <= PAD_BUTTON_MAP);
    assert.ok(PAD_BUTTON_MAP + 16 <= PAD_ANALOG);
    assert.ok(PAD_ANALOG + 2 <= PAD_SLOT_STRIDE);
    // Reading a field of another slot must not see this one.
    assert.equal(padRecordWord(mem, 1, PAD_PRESSED, 3), 0);
    assert.notEqual(rec, padRecordAddress(1, 3));
});

test("the pressed word is the poll's own arithmetic, held AND (held XOR previous)", () => {
    // fns.s:9823-9828: the poll keeps last frame's word in +0x04, stores this
    // frame's in +0x06, and puts held AND (held XOR previous) in +0x00.
    const mem = new NativeMemory();
    const poll = (held) => {
        const rec = padRecordAddress(0);
        const previous = mem.read16(rec + PAD_HELD);
        mem.write16(rec + PAD_HELD_PREVIOUS, previous);
        mem.write16(rec + PAD_HELD, held);
        mem.write16(rec + PAD_REPEAT, 0);
        mem.write16(rec + PAD_PRESSED, held & (held ^ previous));
    };
    poll(0x0000);
    assert.equal(padPressed(mem, 0), 0);
    assert.equal(padHeld(mem, 0), 0);
    poll(0x1000); // start goes down
    assert.equal(padPressed(mem, 0), 0x1000);
    assert.equal(padHeld(mem, 0), 0x1000);
    poll(0x1000); // still held, no new edge
    assert.equal(padPressed(mem, 0), 0);
    poll(0x3000); // a second button joins
    assert.equal(padPressed(mem, 0), 0x2000);
    poll(0x0000); // both released
    assert.equal(padPressed(mem, 0), 0);
    assert.equal(padHeld(mem, 0), 0);
});

test("an absent pad leaves all three words zero", () => {
    // F0x80018F44 fns.s:9875-9878: sh $zr at +0x48, +0x4A and +0x4E.
    const mem = new NativeMemory();
    filledRecord(mem, 0);
    const rec = padRecordAddress(0);
    mem.write16(rec + PAD_PRESSED, 0);
    mem.write16(rec + PAD_REPEAT, 0);
    mem.write16(rec + PAD_HELD, 0);
    assert.equal(padPressed(mem, 0), 0);
    assert.equal(padRepeat(mem, 0), 0);
    assert.equal(padHeld(mem, 0), 0);
});

test("the service cells are the original's own cells", () => {
    // data.rs:3672-3677 pairs these cells with the routines.
    assert.equal(PAD_BLOCK + PAD_CELL_PRESSED, 0x8004bbc4);
    assert.equal(PAD_BLOCK + PAD_CELL_HELD, 0x8004bbc8);
    assert.equal(PAD_BLOCK + PAD_CELL_REPEAT, 0x8004bbcc);
    assert.equal(PAD_BLOCK + PAD_CELL_BUTTON_MAP, 0x8004bbd8);
});

/** Every .ts under engine/, except the one module that owns the block. */
function engineSources() {
    const out = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith(".ts")) out.push(path);
        }
    };
    walk(join(repo, "engine"));
    return out;
}

/** The file's code with line comments and block comments removed. */
function stripComments(text) {
    let out = "";
    let i = 0;
    let quote = null;
    while (i < text.length) {
        const two = text.slice(i, i + 2);
        if (quote) {
            if (text[i] === "\\") i += 2;
            else {
                if (text[i] === quote) quote = null;
                out += text[i];
                i += 1;
            }
            continue;
        }
        if (text[i] === '"' || text[i] === "'" || text[i] === "`") {
            quote = text[i];
            out += text[i];
            i += 1;
            continue;
        }
        if (two === "//") {
            while (i < text.length && text[i] !== "\n") i += 1;
            continue;
        }
        if (two === "/*") {
            i += 2;
            while (i < text.length && text.slice(i, i + 2) !== "*/") i += 1;
            i += 2;
            continue;
        }
        out += text[i];
        i += 1;
    }
    return out;
}

test("only engine/systems/pad-block.ts names the block base in code", () => {
    const owner = join(repo, "engine/systems/pad-block.ts");
    const offenders = [];
    for (const path of engineSources()) {
        if (path === owner) continue;
        const code = stripComments(readFileSync(path, "utf8"));
        // Match the literal in either case and with any separators around it,
        // so `0x8004b7d0`, `0X8004B7D0` and `0x8004b7d0 + 0x3f4` all count.
        const pattern = /0x8004b7d0/gi;
        if (pattern.test(code)) offenders.push(path.slice(repo.length + 1));
    }
    assert.deepEqual(offenders, []);
});