// Lane B oracle: engine/dw3/ui/native/battle-message-line.ts must match the original
// pro/fightstg message panel — the two text elements, the 22-arm kind table, the reveal
// cadence, the blinking prompt and the close rule.
//
// FIGHTSTG_F0x80099588 runs here through engine/native on the shipped pro_fightstg.bin
// + resident.bin. Stubbed on both sides: the text-element constructor F0x8001AE38, the
// text-bank getter [0x80044F4C], the three helpers every arm ends with
// (F0x80098D14 / F0x80098DE0 / F0x80099140, which this port does not model) and the
// element method table. What is compared is the ordered element calls: which widget,
// which method offset, which arguments.
//
// Decode: .bunny-scratch/battlemsg-fix2-report.md (2026-10-02), which re-read
// pro/fightstg from the controller F0x8009a298 outward and supersedes
// .bunny-scratch/battlemsg-report.md on which routine is which: the step routine is
// F0x80098c9c, the draw F0x80098924 and the reveal machine F0x80098a84, not the
// seven-child controller F0x8009a898 the first decode read.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    BATTLE_MESSAGE_ARMS, BATTLE_MESSAGE_BANK, BATTLE_MESSAGE_BANK_FIELD,
    BATTLE_MESSAGE_BANK_ITEM, BATTLE_MESSAGE_BANK_PARTY,
    BATTLE_MESSAGE_CLOSE_BIT, BATTLE_MESSAGE_EL_SET_NUMBER, BATTLE_MESSAGE_EL_SET_SLOT,
    BATTLE_MESSAGE_EL_SET_STRING, BATTLE_MESSAGE_EL_VISIBLE, BATTLE_MESSAGE_FONT_KIND,
    BATTLE_MESSAGE_HOLD_TICKS, BATTLE_MESSAGE_KIND_MAX, BATTLE_MESSAGE_KIND_TABLE,
    BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_LINE1, BATTLE_MESSAGE_LINE2,
    BATTLE_MESSAGE_LINE_DELAY_TICKS, BATTLE_MESSAGE_LINE_MAX_WIDTH,
    BATTLE_MESSAGE_NAME, BATTLE_MESSAGE_PANEL_BOX, BATTLE_MESSAGE_PANEL_CEL,
    BATTLE_MESSAGE_PANEL_H, BATTLE_MESSAGE_PANEL_PACK, BATTLE_MESSAGE_PANEL_W,
    BATTLE_MESSAGE_PANEL_X, BATTLE_MESSAGE_PANEL_Y, BATTLE_MESSAGE_PROMPT_CEL,
    BATTLE_MESSAGE_PROMPT_CLIP, BATTLE_MESSAGE_PROMPT_FRAMES, BATTLE_MESSAGE_PROMPT_PACK,
    BATTLE_MESSAGE_PROMPT_SIZE, BATTLE_MESSAGE_PROMPT_TICKS, BATTLE_MESSAGE_PROMPT_X,
    BATTLE_MESSAGE_PROMPT_Y, BATTLE_MESSAGE_REVEAL, BATTLE_MESSAGE_SET_VISIBLE,
    BATTLE_MESSAGE_STATE_DONE, BATTLE_MESSAGE_STATE_FRESH, BATTLE_MESSAGE_STATE_OPEN,
    BATTLE_MESSAGE_TICK, BATTLE_MESSAGE_VM,
    BATTLE_MESSAGE_AUTO_CLOSE, BATTLE_MESSAGE_AUTO_CLOSE_TICKS, BATTLE_MESSAGE_OBJECT,
    BATTLE_MESSAGE_PHASE_AUTO, BATTLE_MESSAGE_PHASE_GAP, BATTLE_MESSAGE_PHASE_READY,
    BATTLE_MESSAGE_PHASE_SHOW, BATTLE_MESSAGE_PHASE_TABLE, BATTLE_MESSAGE_PHASE_WAIT,
    BATTLE_MESSAGE_PROMPT_GATE,
    BATTLE_MESSAGE_TEXT_SCALE, BATTLE_MESSAGE_DRAW, BattleMessageReveal, battleMessageArm,
    battleMessageBuildWidgets, battleMessageDraw, battleMessageKindFor,
    battleMessageLineIndex, battleMessagePromptClipId, battleMessagePromptFrame,
    battleMessageShow,
} from "../../engine/dw3/ui/native/battle-message-line.ts";
import { BattleMessageSession } from "../../engine/dw3/ui/battle-message-session.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const VM = BATTLE_MESSAGE_VM;
const SELF = 0x80200000;
const BLOCK = 0x80300000;
const PAYLOAD = 0x80400000;
const CREATE_FN = 0x8001ae38;
const BANK_SLOT = 0x80044f4c;
const BANK_STUB = 0x0fdd2100;
/** The three helpers every arm ends with; the port does not model them. */
const TAIL_HELPERS = [0x80098d14, 0x80098de0, 0x80099140];
const METHOD_ARITY = {
    [BATTLE_MESSAGE_EL_SET_STRING]: 2,
    [BATTLE_MESSAGE_EL_SET_NUMBER]: 2,
    [BATTLE_MESSAGE_EL_SET_SLOT]: 3,
    [BATTLE_MESSAGE_EL_VISIBLE]: 1,
};

const LOG = [];

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound() {} };
    const rt = new NativeStageRuntime(fight, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    // The text-bank getter is reached through the language object at 0x80044b38 + 0x414,
    // so the stub address goes *into* that word rather than onto the function itself.
    rt.cpu.setStub(BANK_STUB, (c) => { LOG.push(["bank", c.reg(4) | 0]); return 0x81000000; });
    rt.mem.write32(BANK_SLOT, BANK_STUB);
    // Each element gets a stable handle per (x, y) so the two sides line up.
    rt.cpu.setStub(CREATE_FN, (c) => {
        const x = c.reg(6) | 0;
        const y = c.reg(7) | 0;
        LOG.push(["create", c.reg(4) | 0, c.reg(5) | 0, x, y]);
        return widgetFor(x, y);
    });
    for (const helper of TAIL_HELPERS) {
        rt.cpu.setStub(helper, () => { LOG.push(["helper"]); return 0; });
    }
    for (const [slot, arity] of Object.entries(METHOD_ARITY)) {
        const offset = Number(slot);
        const stub = 0x0fdd2000 + offset;
        rt.cpu.setStub(stub, (c) => {
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) >>> 0);
            LOG.push(["method", c.reg(4) >>> 0, offset, ...args]);
            return 0;
        });
        for (const x of [BATTLE_MESSAGE_LINE1.x, BATTLE_MESSAGE_LINE2.x]) {
            for (const y of [BATTLE_MESSAGE_LINE1.y, BATTLE_MESSAGE_LINE2.y]) {
                rt.mem.write32(widgetFor(x, y) + offset, stub);
            }
        }
    }
    rt.mem.write32(SELF + 0x24, BLOCK);
    return rt;
}

function widgetFor(x, y) {
    return 0x80200000 + (y << 4) + (x << 1);
}

/**
 * The element calls the original made, as `[line, method, ...args]`, with the element's
 * address replaced by which line it is. The three tail helpers are dropped: they are
 * the VM's own bookkeeping (F0x80098D14 and friends), not the line's presentation, and
 * this port does not model them.
 */
function originalCalls(rt) {
    const out = [];
    for (const entryRow of LOG) {
        if (entryRow[0] === "create") {
            const [, target, kind, x, y] = entryRow;
            out.push(["create", target, kind, x, y]);
            continue;
        }
        if (entryRow[0] === "bank") continue;
        if (entryRow[0] === "helper") continue;
        const [, element, offset, ...args] = entryRow;
        const line = element === widgetFor(BATTLE_MESSAGE_LINE1.x, BATTLE_MESSAGE_LINE1.y) ? 1
            : element === widgetFor(BATTLE_MESSAGE_LINE2.x, BATTLE_MESSAGE_LINE2.y) ? 2
            : 0;
        // The bank handle is the same word on both sides (the getter's return), so the
        // comparison is about the index and the slot.
        out.push(["method", line, offset, ...args]);
    }
    return out;
}

/** The same calls as the port's `host.callMethod` would record them. */
function portCalls(kind, payload) {
    const log = [];
    const host = {
        createTextElement(target, k, x, y) {
            log.push(["create", target | 0, k | 0, x | 0, y | 0]);
            return widgetFor(x, y);
        },
        // The original passes the getter's return as the element's string source,
        // so the port's host returns the same stand-in handle.
        bankGet(bank) { LOG.push(["bank", bank | 0]); return 0x81000000; },
        callMethod(element, slot, args) {
            const line = element === widgetFor(BATTLE_MESSAGE_LINE1.x, BATTLE_MESSAGE_LINE1.y) ? 1
                : element === widgetFor(BATTLE_MESSAGE_LINE2.x, BATTLE_MESSAGE_LINE2.y) ? 2 : 0;
            log.push(["method", line, slot, ...args.map((a) => a >>> 0)]);
        },
        packResolve(handle) { return handle >>> 0; },
        drawSprite() {},
    };
    const widgets = battleMessageBuildWidgets(host);
    battleMessageShow(host, widgets, kind, payload, () => "", String);
    return log;
}

function runBoth(rt, kind, payload) {
    rt.mem.write32(BLOCK + 0, 0);
    rt.mem.write32(BLOCK + 4, 0);
    for (let i = 0; i < 8; i++) {
        rt.mem.write32(PAYLOAD + i * 4, (payload[i] ?? 0) >>> 0);
        // Kinds 7, 11, 18 and 21 read their payload out of the object's own ring at
        // `self + 0x54 + 4*self+0x88` (.L0x80099ae0-.L0x80099af0) rather than from $a2,
        // so the same words go in both places and the comparison stays uniform.
        rt.mem.write32(SELF + 0x54 + i * 4, (payload[i] ?? 0) >>> 0);
    }
    rt.mem.write32(SELF + 0x88, 0);
    LOG.length = 0;
    rt.cpu.call(VM, [SELF, kind, PAYLOAD], 400000);
    return originalCalls(rt);
}

const CASES = [
    { name: "kind 1, the panel alone", kind: 1, payload: [8] },
    { name: "kind 2, the name and the caller's word (the Evade! line)", kind: 2, payload: [0x1d, 0] },
    { name: "kind 3, {1}! plus a bank 0xa2 name", kind: 3, payload: [0, 5] },
    { name: "kind 4, {1} damage! with the damage in slot 1", kind: 4, payload: [8, 57] },
    { name: "kind 5, Counter! {1}!", kind: 5, payload: [0, 3] },
    { name: "kind 6, Counter!", kind: 6, payload: [0, 12] },
    { name: "kind 7, the curse line", kind: 7, payload: [0, 1, 2] },
    { name: "kind 8, {1}HP healed!", kind: 8, payload: [0, 240] },
    { name: "kind 9, no text at all", kind: 9, payload: [0] },
    { name: "kind 10, HP gradually recovers.", kind: 10, payload: [0] },
    { name: "kind 11, {1}HP healed!", kind: 11, payload: [0, 15] },
    { name: "kind 12, Digivolved! {1}!", kind: 12, payload: [0, 2] },
    { name: "kind 13, Next Digimon out! / {1}!", kind: 13, payload: [1] },
    { name: "kind 14, {1}! plus a bank 0x6a word", kind: 14, payload: [0, 4] },
    { name: "kind 15, Poisoned: {1}", kind: 15, payload: [0, 0x55, 9] },
    { name: "kind 16, {1} X {2} = {3}!", kind: 16, payload: [0, 3, 1, 4] },
    { name: "kind 17, Stole / {1}!", kind: 17, payload: [6] },
    { name: "kind 18, {1}HP healed!", kind: 18, payload: [0, 0, 33] },
    { name: "kind 18 with a nonzero second word", kind: 18, payload: [0, 1, 33] },
    { name: "kind 19, the curse line again", kind: 19, payload: [0, 2] },
    { name: "kind 20, which re-enters kind 4", kind: 20, payload: [0, 21] },
    { name: "kind 21, {1}HP healed!", kind: 21, payload: [0, 7] },
    { name: "kind 22, Galacticmon learned a technique!", kind: 22, payload: [0, 3] },
    { name: "kind 23 is past the table and does nothing", kind: 23, payload: [0] },
];

test("every VM arm matches the original's ordered element calls", () => {
    const rt = runtime();
    for (const c of CASES) {
        const original = runBoth(rt, c.kind, c.payload);
        const port = portCalls(c.kind, c.payload);
        assert.deepEqual(port, original, c.name);
    }
});

test("the VM builds both lines at the decoded places on layer 0x1005, font kind 1", () => {
    const rt = runtime();
    const calls = runBoth(rt, 4, [8, 57]);
    assert.deepEqual(calls.slice(0, 2), [
        ["create", BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_FONT_KIND, 20, 194],
        ["create", BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_FONT_KIND, 20, 208],
    ]);
    // F0x8001AE38 is called with (0x1005, 1, 0x14, 0xc2) then (0x1005, 1, 0x14, 0xd0).
    assert.equal(BATTLE_MESSAGE_LAYER, 0x1005);
    assert.equal(BATTLE_MESSAGE_FONT_KIND, 1);
    assert.deepEqual({ ...BATTLE_MESSAGE_LINE1 }, { x: 0x14, y: 0xc2 });
    assert.deepEqual({ ...BATTLE_MESSAGE_LINE2 }, { x: 0x14, y: 0xd0 });
    assert.deepEqual({ ...BATTLE_MESSAGE_PANEL_BOX }, { x: 11, y: 188, w: 296, h: 38 });
});

test("kind 4 is the {1} damage! line and kind 2 carries Evade!", () => {
    // Read out of the original above, not out of the port: the indices are what the
    // assembly's `li $a2, 0x16` and `li $a2, 0xb` load.
    const rt = runtime();
    const damage = runBoth(rt, 4, [8, 57]);
    assert.deepEqual(damage.filter((c) => c[0] === "method"
        && c[2] === BATTLE_MESSAGE_EL_SET_STRING), [
        ["method", 1, BATTLE_MESSAGE_EL_SET_STRING, 0x81000000, BATTLE_MESSAGE_NAME],
        ["method", 2, BATTLE_MESSAGE_EL_SET_STRING, 0x81000000, 0x0b],
    ]);
    assert.deepEqual(damage.filter((c) => c[0] === "method" && c[2] === BATTLE_MESSAGE_EL_SET_NUMBER),
        [["method", 2, BATTLE_MESSAGE_EL_SET_NUMBER, 1, 57]]);
    assert.equal(BATTLE_MESSAGE_NAME, 0x16);
    const evade = runBoth(rt, 2, [0x1d, 0]);
    assert.deepEqual(evade.filter((c) => c[0] === "method"
        && c[2] === BATTLE_MESSAGE_EL_SET_STRING), [
        ["method", 1, BATTLE_MESSAGE_EL_SET_STRING, 0x81000000, BATTLE_MESSAGE_NAME],
        ["method", 2, BATTLE_MESSAGE_EL_SET_STRING, 0x81000000, 0x1d],
    ]);
    assert.equal(BATTLE_MESSAGE_BANK, 0x7f);
});

test("the window picture is PGFGTC00 cel 49 at native (11, 188)", () => {
    // FIGHTSTG_F0x80098924 `.L0x80098a38` `lui $a0, 0x455`, `.L0x80098a58` `li $a1, 0x31`,
    // `.L0x80098a5c` `li $a2, 0xb`, `.L0x80098a6c` `li $a3, 0xbc`. The 0x455 is the
    // resolver's argument and is overwritten on the next instruction; the pack drawn comes
    // from the resource the builder chose for layer 0x1005 entry 1.
    assert.equal(BATTLE_MESSAGE_PANEL_PACK, 0x04550000);
    assert.equal(BATTLE_MESSAGE_PANEL_CEL, 0x31);
    assert.equal(BATTLE_MESSAGE_PANEL_X, 11);
    assert.equal(BATTLE_MESSAGE_PANEL_Y, 188);
    // Measured out of web/assets/ui/pgfgc00_sheet.json cel 49.
    assert.equal(BATTLE_MESSAGE_PANEL_W, 296);
    assert.equal(BATTLE_MESSAGE_PANEL_H, 38);
    // Both lines and the prompt fall inside it.
    assert.ok(BATTLE_MESSAGE_LINE1.y > BATTLE_MESSAGE_PANEL_Y);
    assert.ok(BATTLE_MESSAGE_LINE2.y + 12 <= BATTLE_MESSAGE_PANEL_Y + BATTLE_MESSAGE_PANEL_H);
    assert.ok(BATTLE_MESSAGE_PROMPT_X + BATTLE_MESSAGE_PROMPT_SIZE
        <= BATTLE_MESSAGE_PANEL_X + BATTLE_MESSAGE_PANEL_W);
});

test("the advance prompt is CMFONT cel 10 at (291, 208), five frames, four ticks each", () => {
    assert.equal(BATTLE_MESSAGE_PROMPT_PACK, 0x02860000);
    assert.equal(BATTLE_MESSAGE_PROMPT_CEL, 0x0a);
    assert.equal(BATTLE_MESSAGE_PROMPT_CLIP, "10");
    assert.equal(BATTLE_MESSAGE_PROMPT_X, 291);
    assert.equal(BATTLE_MESSAGE_PROMPT_Y, 208);
    assert.equal(BATTLE_MESSAGE_PROMPT_SIZE, 12);
    assert.equal(BATTLE_MESSAGE_PROMPT_FRAMES, 5);
    assert.equal(BATTLE_MESSAGE_PROMPT_TICKS, 4);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => battleMessagePromptFrame(n * 4)),
        [0, 1, 2, 3, 4, 0]);
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((n) => battleMessagePromptClipId(n * 4)),
        ["10", "10#1", "10#2", "10#3", "10#4", "10"]);
});

test("the draw issues the panel and, only while the line is up, the prompt", () => {
    const calls = [];
    const host = {
        createTextElement: () => 0,
        bankGet: (b) => b,
        callMethod() {},
        packResolve(handle) { calls.push(["pack", handle >>> 0]); return handle >>> 0; },
        drawSprite(...args) { calls.push(["sprite", ...args.map((a) => a >>> 0)]); return 0; },
    };
    battleMessageDraw(host, 0, false);
    assert.deepEqual(calls, [
        ["pack", BATTLE_MESSAGE_PANEL_PACK],
        ["sprite", BATTLE_MESSAGE_PANEL_PACK, BATTLE_MESSAGE_PANEL_CEL, 0, 11, 188],
    ]);
    calls.length = 0;
    battleMessageDraw(host, 8, true);
    assert.deepEqual(calls, [
        ["pack", BATTLE_MESSAGE_PANEL_PACK],
        ["sprite", BATTLE_MESSAGE_PANEL_PACK, BATTLE_MESSAGE_PANEL_CEL, 0, 11, 188],
        ["pack", BATTLE_MESSAGE_PROMPT_PACK],
        ["sprite", BATTLE_MESSAGE_PROMPT_PACK, BATTLE_MESSAGE_PROMPT_CEL, 2, 291, 208],
    ]);
});

test("the second line appears four ticks after the first, whole", () => {
    // FIGHTSTG_F0x80098a84 `.L0x80098b00` stores 3 at self+0x80 and `.L0x80098b5c` tests
    // `slt $v1, $v0` over `tick() - self+0x84`: the next line opens once the elapsed tick
    // count is OVER 3, i.e. on the fourth. And FIGHTSTG_F0x80098c9c `.L0x80098cd4` spends
    // the first pass stepping the fresh controller from state 0 to state 1, so line 1 lands
    // on the second pass and line 2 four ticks after it.
    assert.equal(BATTLE_MESSAGE_LINE_DELAY_TICKS, 3);
    const reveal = new BattleMessageReveal(["Kuwagamon", "57 damage!"]);
    assert.equal(reveal.visibleLines, 0, "nothing is on screen before the first step");
    assert.equal(reveal.tick(0, 0), false);
    assert.equal(reveal.state, BATTLE_MESSAGE_STATE_OPEN,
        ".L0x80098cd4 `self+0x38()` -> `next_state()`: state 0 -> 1, nothing drawn");
    assert.equal(reveal.phase, BATTLE_MESSAGE_PHASE_READY);
    assert.equal(reveal.visibleLines, 0, "the panel and the prompt are drawn, no line yet");
    reveal.tick(1, 0);
    assert.equal(reveal.phase, BATTLE_MESSAGE_PHASE_SHOW, ".L0x80098acc: phase 0 -> 1");
    assert.equal(reveal.visibleLines, 0, "phase 1 shows on the next pass");
    reveal.tick(2, 0);
    assert.equal(reveal.visibleLines, 1, "the first line appears whole on its own pass");
    assert.equal(reveal.complete, false);
    assert.equal(reveal.phase, BATTLE_MESSAGE_PHASE_GAP);
    assert.equal(reveal.tick(3, 0), false);
    assert.equal(reveal.tick(4, 0), false);
    assert.equal(reveal.tick(5, 0), false);
    assert.equal(reveal.visibleLines, 1, "three ticks is not yet more than three");
    assert.equal(reveal.tick(6, 0), false);
    assert.equal(reveal.visibleLines, 2, "the second line appears whole, four ticks in");
    assert.equal(reveal.complete, true);
    assert.equal(reveal.phase, BATTLE_MESSAGE_PHASE_WAIT,
        ".L0x80098b88: nothing left, so wait for Circle with the glyph on");
});

test("the glyph only blinks once the last line has landed", () => {
    // FIGHTSTG_F0x80098924 `.L0x80098954` / `.L0x8009895c` — `lw $v0, 0x98($s0)` /
    // `beqz $v0, .L0x80098a28` skips the prompt and goes straight to the panel. The only
    // writer of 1 is .L0x80098b8c, the moment the machine enters phase 3.
    assert.equal(BATTLE_MESSAGE_PROMPT_GATE, 0x98);
    const reveal = new BattleMessageReveal(["Kuwagamon", "57 damage!"]);
    reveal.tick(0, 0);
    for (let tick = 1; tick <= 5; tick++) {
        reveal.tick(tick, 0);
        assert.equal(reveal.promptVisible, false,
            `no glyph while a line is still arriving (tick ${tick}, phase ${reveal.phase})`);
    }
    assert.equal(reveal.promptVisible, false, "tick 5: the second line is not up yet");
    reveal.tick(6, 0);
    assert.equal(reveal.complete, true);
    assert.equal(reveal.promptVisible, true, "the glyph is on while phase 3 waits");
    reveal.tick(7, BATTLE_MESSAGE_CLOSE_BIT);
    assert.equal(reveal.promptVisible, false, ".L0x80098c34 cleared the gate on the close");
});

test("a line is never typed in letter by letter: it appears whole", () => {
    // F0x8001A23C is `sb $a1, 0xc1($a0)` and nothing else -- there is no character
    // counter to advance, so a line is either off or on.
    const reveal = new BattleMessageReveal(["Kuwagamon", "57 damage!"]);
    reveal.tick(0, 0);
    reveal.tick(1, 0);
    reveal.tick(2, 0);
    assert.deepEqual([reveal.visibleLines, reveal.complete], [1, false]);
});

test("there is no timeout: only the close bit takes the line down", () => {
    assert.equal(BATTLE_MESSAGE_HOLD_TICKS, Infinity);
    const reveal = new BattleMessageReveal(["Kuwagamon", "57 damage!"]);
    for (let tick = 0; tick <= 6; tick++) reveal.tick(tick, 0);
    assert.equal(reveal.complete, true, "both lines are up by tick 6");
    for (let n = 0; n < 3600; n++) {
        assert.equal(reveal.tick(6 + n, 0), false, `still up at tick ${6 + n}`);
    }
    // 0x2000 is Circle: docs/research/ui/exclamation-indicator-decoded-2026-07-02.md:131.
    assert.equal(BATTLE_MESSAGE_CLOSE_BIT, 0x2000);
    assert.equal(reveal.tick(4000, 0x2000), true);
    assert.equal(reveal.state, BATTLE_MESSAGE_STATE_DONE);
    assert.equal(reveal.tick(4001, 0x2000), true, "a finished line stays finished");
});

test("a single-line message still waits for the close bit", () => {
    const reveal = new BattleMessageReveal(["Battle won!"]);
    assert.equal(reveal.total, 1, "kind 1 builds one line: .L0x8009a200 stores 1");
    for (let tick = 0; tick <= 6; tick++) reveal.tick(tick, 0);
    assert.equal(reveal.complete, true);
    assert.equal(reveal.visibleLines, 1, "self+0x78 is incremented past the count, so the line count caps it");
    assert.equal(reveal.tick(7, 0), false);
    assert.equal(reveal.tick(7, 1), false, "any other button leaves it up");
    assert.equal(reveal.tick(7, 0x2000), true);
});

test("the timed close is 21 ticks and only `+0xb0` reaches it", () => {
    // FIGHTSTG_F0x80098c38 `.L0x80098c58` — `slti $v0, 0x15` over `tick() - self+0x14`:
    // phase 4 ends the line after 21 ticks (about 0.35 s at the decoded 60.4 Hz display
    // tick), or on Circle. FIGHTSTG_F0x8009a254 sets `self+0x10 = 4`, `self+0x98 = 0` and
    // `self+0x14 = tick()`; it is installed at `+0xb0` and nothing in the decoded corpus
    // calls through it, so the battle never gets here.
    assert.equal(BATTLE_MESSAGE_AUTO_CLOSE, 0x8009a254);
    assert.equal(BATTLE_MESSAGE_AUTO_CLOSE_TICKS, 0x15);
    const reveal = new BattleMessageReveal(["Kuwagamon", "57 damage!"]);
    // The switch only means anything on a started line: `next_state()` (`.L0x800142ac`)
    // rewinds the phase, so calling it before the object reaches state 1 does nothing.
    reveal.tick(0, 0);
    reveal.autoClose(100);
    assert.equal(reveal.phase, BATTLE_MESSAGE_PHASE_AUTO);
    assert.equal(reveal.promptVisible, false, ".L0x8009a270 clears the glyph's gate");
    for (let n = 1; n < BATTLE_MESSAGE_AUTO_CLOSE_TICKS; n++) {
        assert.equal(reveal.tick(100 + n, 0), false, `still up at ${n} ticks`);
    }
    assert.equal(reveal.tick(100 + BATTLE_MESSAGE_AUTO_CLOSE_TICKS, 0), true);
    assert.equal(reveal.state, BATTLE_MESSAGE_STATE_DONE);
    // And the ordinary path never drifts into it.
    const plain = new BattleMessageReveal(["Kuwagamon", "57 damage!"]);
    for (let n = 0; n < 5000; n++) plain.tick(n, 0);
    assert.equal(plain.state, BATTLE_MESSAGE_STATE_OPEN,
        "phase 3 holds forever; nothing falls through to phase 4");
    assert.equal(plain.phase, BATTLE_MESSAGE_PHASE_WAIT);
});

test("the table has exactly the 22 arms the jump table holds", () => {
    // `.L0x8008318c` .. `.L0x800831e4` is 22 words and `.L0x8009960c` bounds the kind
    // with `sltiu $v0, $v1, 0x16` over `kind - 1`.
    assert.equal(BATTLE_MESSAGE_KIND_MAX, 0x16);
    assert.equal(BATTLE_MESSAGE_KIND_TABLE, 0x8008318c);
    assert.equal(BATTLE_MESSAGE_ARMS.length, 22);
    assert.deepEqual(BATTLE_MESSAGE_ARMS.map((a) => a.at), [
        0x80099638, 0x80099678, 0x800996f8, 0x80099794, 0x8009980c, 0x800998a8,
        0x80099908, 0x8009998c, 0x80099a04, 0x80099a28, 0x80099ad4, 0x80099b90,
        0x80099c2c, 0x80099ca0, 0x80099d3c, 0x80099dd4, 0x80099e8c, 0x80099f00,
        0x80099fb0, 0x8009a050, 0x8009a088, 0x8009a168,
    ]);
    assert.equal(battleMessageArm(0), null);
    assert.equal(battleMessageArm(23), null);
    assert.equal(battleMessageArm(4).line2, 0x0b);
});

test("the three worked examples name the bank they come from", () => {
    // {1} damage! -- bank 0x7f, index 0x0b. Evade! -- bank 0x7f, index 0x1d.
    // Poisoned: {1} -- bank 0x7f, index 0x55. All three read out of the shipped
    // English file ~/ddw3/lang_file/dw2003/eng/esmfight.toml.
    assert.equal(battleMessageLineIndex(4, 1, [8, 57]), 0x0b);
    assert.equal(battleMessageLineIndex(2, 1, [0x1d, 0]), 0x1d);
    assert.equal(battleMessageLineIndex(15, 1, [0, 0x55, 9]), 0x55);
    assert.equal(battleMessageLineIndex(4, 0, [8, 57]), BATTLE_MESSAGE_NAME);
    assert.equal(battleMessageArm(4).slots.length, 1);
    assert.equal(battleMessageArm(15).slots[0].payload, 2);
    assert.equal(battleMessageArm(12).slots[0].bank, BATTLE_MESSAGE_BANK_PARTY);
    assert.equal(battleMessageArm(3).slots[0].bank, BATTLE_MESSAGE_BANK_ITEM);
    assert.equal(battleMessageArm(14).slots[0].bank, BATTLE_MESSAGE_BANK_FIELD);
});

test("the element defaults are the original's: width 320 and scale 1.0", () => {
    // F0x8001AE38 `.L0x8001afe4 sh $v1, 0xac($v0)` with $v1 = 0x140, and
    // `.L0x8001b01c`-`.L0x8001b020` three words set to 0x1000.
    assert.equal(BATTLE_MESSAGE_LINE_MAX_WIDTH, 0x140);
    assert.equal(BATTLE_MESSAGE_TEXT_SCALE, 0x1000);
    assert.equal(BATTLE_MESSAGE_SET_VISIBLE, 0x8001a23c);
});

test("the routines this port names are the ones the assembly labels", () => {
    // F0x8009a298 `.L0x8009a29c`-`.L0x8009a2a0` builds 0x800a0000 - 0x7364 = 0x80098c9c
    // and hands it to F0x80014504, which stores it as the object's `+0x48` step routine
    // (exe/fns.s:4914). That routine calls the draw and the reveal machine.
    assert.equal(BATTLE_MESSAGE_OBJECT, 0x8009a298);
    assert.equal(BATTLE_MESSAGE_TICK, 0x80098c9c);
    assert.equal(BATTLE_MESSAGE_DRAW, 0x80098924);
    assert.equal(BATTLE_MESSAGE_REVEAL, 0x80098a84);
    assert.equal(BATTLE_MESSAGE_VM, 0x80099588);
    assert.equal(BATTLE_MESSAGE_PHASE_TABLE, 0x80083124);
    assert.equal(BATTLE_MESSAGE_STATE_FRESH, 0);
});

test("the walker's own lines map onto the original's shapes", () => {
    assert.equal(battleMessageKindFor([]), 1);
    assert.equal(battleMessageKindFor(["Battle won!"]), 1);
    assert.equal(battleMessageKindFor(["Kuwagamon", "57 damage!"]), 4);
    assert.equal(battleMessageKindFor(["Kuwagamon", "evaded!"]), 2);
    assert.equal(battleMessageKindFor(["Kuwagamon", "braces to counter!"]), 6);
    assert.equal(battleMessageKindFor(["Koromon", "Digivolved! Agumon!"]), 12);
    assert.equal(battleMessageKindFor(["Koromon", "Poisoned: Poison"]), 15);
    assert.equal(battleMessageKindFor(["Koromon", "30HP healed!"]), 8);
});
// The session: engine/dw3/ui/battle-message-session.ts is the L2 layer web/battle.js
// drives. These are the rules the battle timeline depends on, each read out of
// pro/fightstg rather than out of the walker.

const BANK = { 0x16: "Kuwagamon", 0x0b: "{1} damage!", 0x08: "Attack!", 0x1d: "Evade!" };
const session = () => new BattleMessageSession({ textOf: (_b, i) => BANK[i] ?? "", paint: () => {} });

test("Circle finishes the line; no press, no close", () => {
    // No press, no close (`.L0x80098bbc`). The press sets state 3; F0x80098c9c then draws
    // nothing (`.L0x80098ccc` -> `.L0x80098d00`), so the caller must stop painting a
    // `finished` line (web/battle.js checks `finished`).
    const s = session();
    s.open(["Kuwagamon", "Evade!"], [0x1d]);
    for (let tick = 0; tick < 20; tick++) assert.equal(s.tick(tick, 0), false, `tick ${tick}`);
    assert.equal(s.promptVisible, true);
    assert.equal(s.active, true);
    assert.equal(s.finished, false);
    assert.deepEqual(s.lines(), ["Kuwagamon", "Evade!"]);
    assert.equal(s.tick(20, BATTLE_MESSAGE_CLOSE_BIT), true);
    assert.equal(s.finished, true);
    assert.equal(s.finished, true, "state 3: the step routine draws nothing from now on");
    assert.equal(s.promptVisible, false, "`.L0x80098c34` cleared the prompt's gate");
    assert.equal(s.frame().prompt, null);
    assert.equal(s.frame().panel.cel, BATTLE_MESSAGE_PANEL_CEL);
    assert.deepEqual(s.frame().lines, ["Kuwagamon", "Evade!"]);
    // A later tick with no press changes nothing: there is no timeout, and a closed line
    // does not re-open itself.
    assert.equal(s.tick(40, 0), true);
    assert.equal(s.active, true);
    assert.deepEqual(s.frame().lines, ["Kuwagamon", "Evade!"]);
});

test("a re-opened line is a new object: the glyph comes back and the clock restarts", () => {
    const s = session();
    s.open(["Kuwagamon", "Evade!"], [0x1d]);
    for (let tick = 0; tick < 20; tick++) s.tick(tick, 0);
    s.tick(20, BATTLE_MESSAGE_CLOSE_BIT);
    s.tick(21, BATTLE_MESSAGE_CLOSE_BIT);
    assert.equal(s.finished, true);
    s.open(["Kuwagamon", "Attack!"], [0x08]);
    assert.equal(s.finished, false);
    assert.equal(s.clock, 0);
    assert.equal(s.active, true);
    assert.equal(s.lines()[0], "Kuwagamon");
});

test("no message means no object, so no panel", () => {
    // F0x8009a298 is only called by a caller that has something to say, and the controller
    // only draws through F0x80098924 while it is in state 1.
    const s = session();
    s.open([]);
    assert.equal(s.active, false);
    s.open([""]);
    assert.equal(s.active, false);
    s.open(["Kuwagamon", "Evade!"], [0x1d]);
    assert.equal(s.active, true);
    s.open([]);
    assert.equal(s.active, false, "clearing the line takes the panel down too");
});
