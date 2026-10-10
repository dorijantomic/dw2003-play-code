// Lane B oracle: the shared task tree's close path, against the resident
// routines it ports. Nothing here is a re-derivation: F0x80018140 (the
// per-object step), F0x80018230 (the child walk), F0x80014308 (the object
// destroy), F0x800182c8 (close one object by hand), the registry cells and the
// game heap behind them (F0x80017C5C the arena, F0x80017F54 the task
// allocator, F0x80017B70 the free) all run as shipped from resident.bin.
//
// What this settles, because the shipped tree and one screen's report disagreed
// about it (dnaport-report.md, "One divergence from the original"): when a child
// closes, the parent's slot is EMPTIED on that same frame by F0x80018230's
// writeback of F0x80018140's return value, and the child's memory goes back to
// the game heap inside the same frame by F0x80014308. The child is not left
// reachable: a read through the slot on any later frame returns 0 and the walk
// skips the word. The dead object's own bytes still read back (the free clears
// only the block tag) until the next allocation zeroes the block, which the tree
// also does when it hands the block out again.
//
// The service cells the boot code fills, which resident.bin ships as zero, are
// seeded from the exe's own extracted data
// (~/ddw3/rust/dw2003_exe_data/src/data.rs L3289-L3291, L3293, L3408-L3414),
// the same extraction ledger evidence EV-ui-q002-tick-cell-2026-09-10 already
// rests on. Nothing else on the close path is stubbed: only the two object
// handlers (+0x48) are host bodies, because a screen's own tick is not what is
// under test. The screen runtime's own heap stub (it points the free cell at a
// no-op so screen buffers live for the screen) is dropped, so the real arena
// answers instead.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { TranslatedTaskTree } from "../../engine/dw3/ui/translated-task-tree.ts";

const here = dirname(fileURLToPath(import.meta.url));
const screens = resolve(here, "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(screens, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(screens, "pro_cnty_sel.bin")));
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

// ── the resident routines, by the label they carry ──────────────────────────
const FACTORY = 0x800143dc;         // F0x800143DC  object(cb, size, extraSize, id)
const FACTORY_WRAPPER = 0x80014504; // F0x80014504  object(cb, size, extraSize)
const STATE_METHODS = [0x80014274, 0x80014288, 0x80014298, 0x800142a4,
    0x800142ac, 0x800142c8, 0x800142e0, 0x800142f4];
const DESTROY = 0x80014308;         // F0x80014308  +0x4C, the object teardown
const STEP = 0x80018140;            // F0x80018140  one object: handler, then teardown at state0 3
const WALK = 0x80018230;            // F0x80018230  walk a counted child array
const STEP_ONCE = 0x8001829c;       // F0x8001829C  step one object if it exists
const CLOSE_ONE = 0x800182c8;       // F0x800182C8  close one object by hand
const HEAP_INIT = 0x80017c5c;       // F0x80017C5C  carve the arena between break and 0x801FF000
const BLOCK_ALLOC = 0x80017d2c;     // F0x80017D2C  the arena's forward first fit
const HEAP_RETRY = 0x80017e84;      // F0x80017E84  alloc, retrying through the evictor
const ZERO_FILL = 0x80017cb0;       // F0x80017CB0  memset
const HEAP_TOP_RETRY = 0x80017eec;  // F0x80017EEC  alloc from the far end
const ZERO_ALLOC = 0x80017f54;      // F0x80017F54  the task allocator: alloc then zero fill
const BLOCK_FREE = 0x80017b70;      // F0x80017B70  free: clear the tag, coalesce both ways
const TAG_FREE = 0x80017f94;        // F0x80017F94  free a block by tagging it
const REGISTER = 0x80017fdc;        // F0x80017FDC  registry add
const UNREGISTER = 0x80018014;      // F0x80018014  registry remove by pointer
const REGISTRY_FIND = 0x8001810c;   // F0x8001810C  registry keys

// ── the boot-filled service cells, from the exe's extracted data ─────────────
const HEAP_TABLE = 0x8004b5dc;
const CELL_HEAP_INIT = 0x8004b5e8;
const CELL_FREE = 0x8004b5ec;
const CELL_FREE_TAG = 0x8004b5f0;
const CELL_ALLOC_BOTTOM = 0x8004b5f4;
const CELL_ALLOC_TOP = 0x8004b5f8;
const CELL_ALLOC_ZERO = 0x8004b5fc;
const CELL_MEMSET = 0x8004b600;
const CELL_MEMCPY = 0x8004b604;
const CELL_FREE_BLOCK = 0x8004b608;
const CELL_REGISTER = 0x8004b7b4;
const CELL_UNREGISTER = 0x8004b7b8;
const CELL_FIND = 0x8004b7bc;
const CELL_LIVE_TICK = 0x8004b7c4;  // D0x8004B7C4 = F0x80018230, the child walk
const CELL_STEP_ONCE = 0x8004b7c8;  // D0x8004B7C8 = F0x8001829C
const CELL_CLOSE_ONE = 0x8004b7cc;  // D0x8004B610+0x1BC, what F0x80014308 calls per child
const HEAP_BREAK = 0x8005cb50;      // the kernel's break, which F0x80017C5C reads
const HEAP_END = 0x801ff000;        // F0x80017C5C's hard end (fns.s:8486)
const BLOCK_HEADER = 0xc;           // a payload sits 0xC above its block header

// ── one scenario, both sides ────────────────────────────────────────────────
const ARENA_BREAK = 0x80190000;     // where the original's heap starts
const CHILD_SIZE = 0x60;
const PARENT_SIZE = 0x50;
const PARENT_EXTRA = 4;
const PORT_CLASS_PARENT = 1;
const PORT_CLASS_CHILD = 2;
const MARK = 0x5eed1234;            // written into the child before it closes
const SCRATCH = 0x58;               // past the factory's +0x28..+0x4C method table

function harness() {
    const rt = new NativeStageRuntime(overlay, entry,
        { setFlag() {}, getFlag: () => 0, rand16: () => 1 },
        undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
    rt.cpu.gp = HEAP_BREAK;
    const mem = rt.mem;
    // The whole task path runs as shipped: the factory, the destroy, the walk,
    // the eight state methods and the game's own heap must not be intercepted.
    for (const a of [FACTORY, FACTORY_WRAPPER, ...STATE_METHODS, DESTROY,
        BLOCK_ALLOC, HEAP_RETRY, HEAP_TOP_RETRY, ZERO_ALLOC, BLOCK_FREE, TAG_FREE,
        ZERO_FILL, HEAP_INIT]) rt.cpu.clearStub(a);
    for (const [cell, target] of [
        [CELL_HEAP_INIT, HEAP_INIT], [CELL_FREE, BLOCK_FREE], [CELL_FREE_TAG, TAG_FREE],
        [CELL_ALLOC_BOTTOM, HEAP_RETRY], [CELL_ALLOC_TOP, HEAP_TOP_RETRY],
        [CELL_ALLOC_ZERO, ZERO_ALLOC], [CELL_MEMSET, ZERO_FILL], [CELL_MEMCPY, 0x80017d08],
        [CELL_FREE_BLOCK, TAG_FREE], [CELL_REGISTER, REGISTER], [CELL_UNREGISTER, UNREGISTER],
        [CELL_FIND, REGISTRY_FIND], [CELL_LIVE_TICK, WALK], [CELL_STEP_ONCE, STEP_ONCE],
        [CELL_CLOSE_ONE, CLOSE_ONE],
    ]) mem.write32(cell, target);
    // F0x80017C5C carves the arena the original's own allocator walks.
    mem.write32(HEAP_BREAK, ARENA_BREAK);
    rt.cpu.call(HEAP_INIT, []);
    assert.equal(mem.read32(HEAP_TABLE + 0x4) >>> 0, ARENA_BREAK, "the arena starts at the break");
    assert.equal(mem.read32(HEAP_TABLE + 0x8) >>> 0, HEAP_END, "and ends where F0x80017C5C says");
    return { rt, mem };
}

/** The block header word 0xC below a payload: the tag alloc writes and free clears. */
function tagOf(mem, payload) {
    return mem.read32(payload - BLOCK_HEADER + 8) >>> 0;
}

/** A parent with one child in its array, the way a screen builds one. */
function originalTree(rt, mem, tickParent, tickChild) {
    const parent = rt.cpu.call(FACTORY, [tickParent, PARENT_SIZE, PARENT_EXTRA, 0]) >>> 0;
    const child = rt.cpu.call(FACTORY, [tickChild, CHILD_SIZE, 0, 0]) >>> 0;
    const block = mem.read32(parent + 0x24) >>> 0;
    mem.write32(block, child);
    mem.write32(parent + 0xc, 1);
    mem.write32(child + 0xc, 1);
    return { parent, child, block };
}

// ── case 1: the child closes itself, frame by frame ─────────────────────────
test("a child that reaches state 3 is ticked once more, freed, and its parent's slot is emptied that frame", () => {
    const { rt, mem } = harness();
    const ticks = [];
    let closed = false;
    const close = (self) => {
        if (closed) return;
        closed = true;
        // A screen closes itself through its own +0x28 slot, which is what
        // F0x800182C8 does with the argument 3; F0x80014274 writes +0xC and
        // zeroes the three sub-state words, so this write stands for it.
        mem.write32(self + 0xc, 3);
        mem.write32(self + SCRATCH, MARK);
    };
    const TICK_CHILD = 0x0fdd0200;
    rt.cpu.setStub(TICK_CHILD, (c) => {
        const self = c.reg(4) >>> 0;
        ticks.push(mem.read32(self + 0xc));
        close(self);
        return 0;
    });
    const TICK_PARENT = 0x0fdd0204;
    rt.cpu.setStub(TICK_PARENT, () => 0);
    const { parent, child, block } = originalTree(rt, mem, TICK_PARENT, TICK_CHILD);

    // One frame on the original: F0x80018140 runs the object's handler and then,
    // on the live branch, the child walk it reaches through D0x8004B7C4.
    const orig = [];
    for (let frame = 0; frame < 4; frame++) {
        const ret = rt.cpu.call(STEP, [parent]) >>> 0;
        orig.push({
            slot: mem.read32(block) >>> 0,
            childState: mem.read32(child + 0xc) >>> 0,
            childTag: tagOf(mem, child),
            ret,
        });
    }
    assert.deepEqual(ticks, [1, 3], "the child is ticked on the frame it closes on and on the one it dies on");

    // Frame 1: the child's handler set state0 = 3. F0x80018140 read state0 at the
    // top of that turn, so it keeps the pointer and nothing is freed yet.
    assert.equal(orig[0].slot, child, "original: frame 1 keeps the child in the slot");
    assert.equal(orig[0].childTag, 2, "original: and the block is still the allocator's");

    // Frame 2: the handler runs once more with state0 = 3 in view, then
    // F0x80014308 frees the object and the stepper returns 0, which
    // F0x80018230 stores back over the slot.
    assert.equal(orig[1].childState, 3);
    assert.equal(orig[1].childTag, 0, "original: the block tag is cleared (freed) that frame");
    assert.equal(orig[1].slot, 0, "original: the slot is emptied on the closing frame");
    assert.equal(orig[1].ret, parent, "original: the stepper still returns the live parent");

    // Frames 3 and 4: the slot reads 0 and the walk skips it.
    assert.equal(orig[2].slot, 0);
    assert.equal(orig[3].slot, 0);

    // The port's side: the same scenario through TranslatedTaskTree.
    let portClosed = false;
    const classes = new Map([
        [PORT_CLASS_PARENT, { name: "parent", childSlots: [0], tick() {} }],
        [PORT_CLASS_CHILD, {
            name: "child",
            childSlots: [],
            // terminalTick is the tree's name for "the handler runs once more
            // with state0 = 3 in view", which the original does for EVERY
            // object (F0x80018140 calls +0x48 before it branches on the state
            // it read at the top). It is opt-in per class, so a class that
            // leaves it off is ticked only on its closing frame — see
            // .bunny-scratch/taskslot-report.md, "the one difference this
            // oracle did find".
            terminalTick: true,
            tick(self) {
                ticks.push(mem.read32(self + 0xc));
                if (!portClosed) {
                    portClosed = true;
                    mem.write32(self + 0xc, 3);
                    mem.write32(self + SCRATCH, MARK);
                }
            },
        }],
    ]);
    const port = new TranslatedTaskTree(mem, classes);
    const portParent = port.allocate(PORT_CLASS_PARENT, PARENT_SIZE, PARENT_EXTRA);
    const portChild = port.allocate(PORT_CLASS_CHILD, CHILD_SIZE, 0);
    const portBlock = portParent + 0x50;
    mem.write32(portBlock, portChild);
    mem.write32(portParent + 0xc, 1);
    mem.write32(portChild + 0xc, 1);

    const tree = [];
    for (let frame = 0; frame < 4; frame++) {
        port.tick(portParent);
        tree.push({ slot: mem.read32(portBlock) >>> 0, childState: mem.read32(portChild + 0xc) >>> 0 });
    }
    assert.deepEqual(ticks.slice(2), [1, 3], "the tree ticks the child on the same two frames");
    assert.deepEqual(ticks, [1, 3, 1, 3], "both sides tick the child at state0 1 then at state0 3");
    assert.deepEqual(tree.map((f) => f.slot === 0), orig.map((f) => f.slot === 0),
        "both sides empty the slot on the same frame and keep it empty");
    assert.equal(tree[0].slot, portChild, "tree: frame 1 keeps the child in the slot");
    assert.equal(tree[1].childState, 3, "tree: the closed child keeps its state0 = 3 word");
});

// ── case 2: the dead child's own bytes, and the reuse that wipes them ────────
test("a freed child stays readable until the next allocation zeroes the block, on both sides", () => {
    const { rt, mem } = harness();
    const TICK_CHILD = 0x0fdd0210;
    rt.cpu.setStub(TICK_CHILD, (c) => {
        const self = c.reg(4) >>> 0;
        if (mem.read32(self + 0xc) === 1) mem.write32(self + 0xc, 3);
        return 0;
    });
    const QUIET = 0x0fdd0214;
    rt.cpu.setStub(QUIET, () => 0);
    const { parent, child, block } = originalTree(rt, mem, QUIET, TICK_CHILD);
    mem.write32(child + SCRATCH, MARK);

    rt.cpu.call(STEP, [parent]);        // the child closes
    rt.cpu.call(STEP, [parent]);        // and dies
    assert.equal(mem.read32(block) >>> 0, 0, "original: the slot is emptied");
    assert.equal(tagOf(mem, child), 0, "original: the block is on the game's free list");
    assert.equal(mem.read32(child + SCRATCH) >>> 0, MARK,
        "original: the free clears the block tag only, so the dead bytes still read back");

    const again = rt.cpu.call(FACTORY, [TICK_CHILD, CHILD_SIZE, 0, 0]) >>> 0;
    assert.equal(again, child, "original: the next task allocation takes the same block back");
    assert.equal(mem.read32(again + SCRATCH) >>> 0, 0,
        "original: F0x80017F54 zero-fills the allocation, so the reused block starts clear");

    // The port's side: TranslatedTaskTree over the same memory.
    const classes = new Map([
        [PORT_CLASS_PARENT, { name: "parent", childSlots: [0], tick() {} }],
        [PORT_CLASS_CHILD, {
            name: "child",
            childSlots: [],
            tick(self) { if (mem.read32(self + 0xc) === 1) mem.write32(self + 0xc, 3); },
        }],
    ]);
    const port = new TranslatedTaskTree(mem, classes);
    const portParent = port.allocate(PORT_CLASS_PARENT, PARENT_SIZE, PARENT_EXTRA);
    const portChild = port.allocate(PORT_CLASS_CHILD, CHILD_SIZE, 0);
    mem.write32(portParent + 0x50, portChild);
    mem.write32(portParent + 0xc, 1);
    mem.write32(portChild + 0xc, 1);
    mem.write32(portChild + SCRATCH, MARK);

    port.tick(portParent);
    assert.equal(mem.read32(portParent + 0x50) >>> 0, portChild, "tree: the closing frame keeps the pointer");
    port.tick(portParent);
    assert.equal(mem.read32(portParent + 0x50) >>> 0, 0, "tree: the dying frame empties the slot");
    assert.equal(port.tasks.has(portChild), false);
    assert.equal(mem.read32(portChild + SCRATCH) >>> 0, MARK,
        "tree: destroy leaves the dead bytes readable, as the original's free does");

    const portAgain = port.allocate(PORT_CLASS_CHILD, CHILD_SIZE, 0);
    assert.equal(portAgain, portChild, "tree: the block it just freed is the block it hands out again");
    assert.equal(mem.read32(portAgain + SCRATCH) >>> 0, 0,
        "tree: and it zero-fills it, as F0x80017F54 does");
});

// ── case 3: the parent goes first, and takes its child with it ──────────────
test("a parent that closes hands every live child to F0x800182C8 before its own children block is freed", () => {
    const { rt, mem } = harness();
    let childStepsAtState3 = 0;
    const TICK_CHILD = 0x0fdd0220;
    rt.cpu.setStub(TICK_CHILD, (c) => {
        const self = c.reg(4) >>> 0;
        if (mem.read32(self + 0xc) === 3) childStepsAtState3 += 1;
        return 0;
    });
    const TICK_PARENT = 0x0fdd0224;
    rt.cpu.setStub(TICK_PARENT, (c) => {
        const self = c.reg(4) >>> 0;
        if (mem.read32(self + 0xc) === 1) mem.write32(self + 0xc, 3);
        return 0;
    });
    const { parent, child, block } = originalTree(rt, mem, TICK_PARENT, TICK_CHILD);

    rt.cpu.call(STEP, [parent]);
    // The parent only reaches its teardown on the next frame: F0x80018140 reads
    // state0 at the top of the turn, and the handler set it during this one.
    assert.equal(mem.read32(parent + 0xc) >>> 0, 3);
    assert.equal(tagOf(mem, parent), 2, "the parent is still allocated after the frame it closes on");

    rt.cpu.call(STEP, [parent]);
    assert.equal(childStepsAtState3, 1, "the released child is stepped once, at state0 = 3");
    assert.equal(tagOf(mem, child), 0, "the child was freed inside the parent's teardown");
    assert.equal(tagOf(mem, parent), 0, "and so was the parent");
    assert.equal(tagOf(mem, block), 0, "and so was the parent's children block");
    assert.equal(mem.read32(block) >>> 0, child,
        "the original does not clear the children array it has just freed, so the word still reads");

    // The port's side: the tree's own parent-destroy path (closeTick) with the
    // same "the child is stepped once at state 3" rule.
    let portStepsAtState3 = 0;
    const classes = new Map([
        [PORT_CLASS_PARENT, {
            name: "parent",
            childSlots: [0],
            tick(self) { if (mem.read32(self + 0xc) === 1) mem.write32(self + 0xc, 3); },
        }],
        [PORT_CLASS_CHILD, {
            name: "child",
            childSlots: [],
            closeTick: true,
            tick(self) { if (mem.read32(self + 0xc) === 3) portStepsAtState3 += 1; },
        }],
    ]);
    const port = new TranslatedTaskTree(mem, classes);
    const portParent = port.allocate(PORT_CLASS_PARENT, PARENT_SIZE, PARENT_EXTRA);
    const portChild = port.allocate(PORT_CLASS_CHILD, CHILD_SIZE, 0);
    mem.write32(portParent + 0x50, portChild);
    mem.write32(portParent + 0xc, 1);
    mem.write32(portChild + 0xc, 1);

    port.tick(portParent);
    assert.equal(port.tasks.has(portParent), true, "tree: the frame the parent closes on leaves it, as the original does");
    port.tick(portParent);
    assert.equal(port.tasks.has(portParent), false, "tree: the parent is gone");
    assert.equal(port.tasks.has(portChild), false, "tree: and so is the child");
    assert.equal(portStepsAtState3, 1, "tree: closeTick runs the child once at state 3, as F0x800182C8 does");
    assert.equal(mem.read32(portParent + 0x50) >>> 0, 0, "tree: the slot is emptied inside the destroy");
    assert.equal(mem.read32(portParent + 0xc) >>> 0, 3, "tree: the parent's state0 = 3 word survives");
});

// ── case 4: the close a screen asks for by hand ─────────────────────────────
test("F0x800182C8 closes one child by hand; the parent slot waits for the walk", () => {
    const { rt, mem } = harness();
    const TICK_CHILD = 0x0fdd0230;
    rt.cpu.setStub(TICK_CHILD, () => 0);
    const { parent, child, block } = originalTree(rt, mem, TICK_CHILD, TICK_CHILD);

    // F0x800182C8: +0x28(3), then one step through D0x8004B7C8 — which runs the
    // teardown and hands back 0, a value the routine throws away.
    const stepped = rt.cpu.call(CLOSE_ONE, [child]) >>> 0;
    assert.equal(stepped, 0, "original: F0x8001829C returns the stepper's 0");
    assert.equal(mem.read32(child + 0xc) >>> 0, 3, "original: the child is at state0 = 3");
    assert.equal(tagOf(mem, child), 0, "original: and freed inside that one step");
    assert.equal(mem.read32(block) >>> 0, child,
        "original: the hand-closed child leaves the slot pointing at it until the walk");

    rt.cpu.call(WALK, [parent]);
    assert.equal(mem.read32(block) >>> 0, 0, "original: the walk's writeback empties the slot");

    const classes = new Map([
        [PORT_CLASS_PARENT, { name: "parent", childSlots: [0], tick() {} }],
        [PORT_CLASS_CHILD, { name: "child", childSlots: [], tick() {} }],
    ]);
    const port = new TranslatedTaskTree(mem, classes);
    const portParent = port.allocate(PORT_CLASS_PARENT, PARENT_SIZE, PARENT_EXTRA);
    const portChild = port.allocate(PORT_CLASS_CHILD, CHILD_SIZE, 0);
    mem.write32(portParent + 0x50, portChild);
    mem.write32(portChild + 0xc, 1);

    port.callMethod(portChild, 0x28, [3]);
    assert.equal(mem.read32(portChild + 0xc) >>> 0, 3, "tree: the +0x28 setter is the same one");
    assert.equal(port.tasks.has(portChild), true, "tree: and, as in the original, nothing is freed until the walk");
    assert.equal(mem.read32(portParent + 0x50) >>> 0, portChild);
    port.tick(portParent);
    assert.equal(mem.read32(portParent + 0x50) >>> 0, 0, "tree: the walk empties the slot on that frame");
    assert.equal(port.tasks.has(portChild), false);
});

// ── case 5: what a read through the slot returns on later frames ────────────
test("after the close, every later frame reads 0 through the slot and walks nothing", () => {
    const { rt, mem } = harness();
    let childTicks = 0;
    const TICK_CHILD = 0x0fdd0240;
    rt.cpu.setStub(TICK_CHILD, (c) => {
        const self = c.reg(4) >>> 0;
        childTicks += 1;
        if (mem.read32(self + 0xc) === 1) mem.write32(self + 0xc, 3);
        return 0;
    });
    const QUIET = 0x0fdd0244;
    rt.cpu.setStub(QUIET, () => 0);
    const { parent, child, block } = originalTree(rt, mem, QUIET, TICK_CHILD);

    rt.cpu.call(STEP, [parent]);
    rt.cpu.call(STEP, [parent]);
    const ticksAtClose = childTicks;
    assert.equal(mem.read32(block) >>> 0, 0, "the slot is empty once the child has died");
    for (let frame = 0; frame < 5; frame++) {
        rt.cpu.call(STEP, [parent]);
        assert.equal(mem.read32(block) >>> 0, 0, `frame ${frame}: the slot still reads 0`);
    }
    assert.equal(childTicks, ticksAtClose, "a 0 in the slot is never stepped again");
});
