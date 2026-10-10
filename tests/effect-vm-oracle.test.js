// Phase 4 oracle: engine/dw3/ui/effect-vm.ts must reproduce pro/cardgame's
// F0x80084320, the Program-card effect interpreter.
//
// The original runs through engine/native on the shipped pro_cardgame.bin +
// resident.bin with all 92 helper calls stubbed; the port runs against a host
// whose methods log the same ordered events and return the same values. Every
// enter opcode (1..0xAE), every update opcode (0..0xAE), a spread of return
// values and two seeded duel states are compared on the whole duel object.
//
// The four arms the capture actually reached (0x80084AF8, 0x80084EBC,
// 0x80085B74, 0x80085DC8) are inside that enumeration; a third test walks both
// shipped jump tables and calls the port's arm switch for every word, so an
// unported arm can never hide behind an untested opcode.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    EFFECT_ENTER_TABLE,
    EFFECT_UPDATE_TABLE,
    RUN_EFFECT_OPCODE,
    enterEffectArm,
    runEffectOpcode,
    updateEffectArm,
} from "../engine/dw3/ui/effect-vm.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const overlay = new Uint8Array(readFileSync(join(dir, "pro_cardgame.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: overlay.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const DUEL = 0x80194000;
const VIEW = 0x80190000;
const CURSOR = 0x80198000;
const RECORD = 0x801a0000;
const METHOD = 0x0fd00010;

// The 92 plain helper boundaries: [port method name, original address, arity].
const BOUNDARIES = [
    ["branchIfActingSide", 0x80083f48, 4],
    ["branchIfHandAtMost", 0x80083f84, 4],
    ["branchIfHandOver", 0x80083fc8, 4],
    ["effectOp0eBranchIfFolderNonempty", 0x8008400c, 3],
    ["effectOp10BranchIfFieldUnderSix", 0x8008404c, 3],
    ["pollEffectTimer", 0x80084090, 2],
    ["effectOp4bPickSelectionBySide", 0x800840d0, 3],
    ["markSlotsMatchingEffectAttr", 0x800840f0, 2],
    ["aiPickBestOppFieldSlot", 0x80084188, 1],
    ["playSEnergyFlourish", 0x8008423c, 2],
    ["effectOp98OpenOwnFieldPicker", 0x80086330, 3],
    ["tickYesNoConfirm", 0x8008642c, 2],
    ["openLegalRowPicker", 0x80086d78, 3],
    ["openBrowsePicker", 0x80086eb0, 4],
    ["tickCardPicker", 0x80087edc, 3],
    ["effectOp9eOpenScoreScreen", 0x80088f0c, 2],
    ["tickScoreScreen", 0x80088f78, 2],
    ["showPhaseBanner", 0x800894e4, 3],
    ["tickPhaseBanner", 0x80089580, 2],
    ["effectOpA7StartCoinToss", 0x8008985c, 2],
    ["tickCoinToss", 0x80089974, 2],
    ["effectOpA8EnterTwoHandCompare", 0x80089ec8, 2],
    ["tickTwoHandCompare", 0x8008a068, 2],
    ["enterTwoHandCompareMode", 0x8008ad48, 3],
    ["tickTwoHandComparePick", 0x8008ad98, 2],
    ["openPilePicker", 0x8008baa4, 4],
    ["openPilePickerKind0", 0x8008bc6c, 3],
    ["tickPilePicker", 0x8008c044, 3],
    ["effectOp9dAutoPickLegalSummons", 0x8008c5f0, 2],
    ["aiHandPick", 0x8008c6e0, 3],
    ["aiPickFirstLegalPileCard", 0x8008c8d8, 2],
    ["aiPickLowestStatPileCard", 0x8008c988, 2],
    ["openChoosePilePrompt", 0x8008ca4c, 3],
    ["tickChoosePilePrompt", 0x8008cb5c, 2],
    ["openRespondPrompt", 0x8008ce0c, 3],
    ["tickRespondPrompt", 0x8008cfdc, 2],
    ["markFieldByFilter", 0x8008d274, 4],
    ["tickMultiSlotHighlight", 0x8008d594, 2],
    ["playMarkedSlotFx", 0x8008ddc0, 3],
    ["waitFrames", 0x8008deac, 3],
    ["queueStatChange", 0x8008def8, 4],
    ["statRampTick", 0x8008e08c, 2],
    ["markEffectFieldTargets", 0x8008e398, 2],
    ["effectOp4cEnterHandShuffle", 0x8008e5b0, 2],
    ["tickHandShuffle", 0x8008e5bc, 2],
    ["markZoneByMask", 0x8008ec44, 5],
    ["markFieldByMask", 0x8008eec8, 4],
    ["effectOp49EnterSweepBoardToDiscard", 0x8008f0b4, 3],
    ["tickSweepBoardToDiscard", 0x8008f0f4, 3],
    ["enterSEnergyDelta", 0x8008f2d8, 4],
    ["effectOp29EnterZeroAllEnergy", 0x8008f530, 2],
    ["tickZeroAllEnergy", 0x8008f560, 2],
    ["effectOp41EnterReturnResolvingCard", 0x8008f750, 2],
    ["tickReturnResolvingCard", 0x8008f790, 2],
    ["effectOp2aRequestCardCutIn", 0x8008f948, 2],
    ["openZoomedCard", 0x8008f978, 4],
    ["tickZoomedCardToDiscard", 0x8008fa9c, 4],
    ["drawPileCardToBoard", 0x8008ff08, 4],
    ["tickPlayCardSequence", 0x80090058, 4],
    ["effectOp44EnterShuffleDiscardToDeck", 0x8009076c, 3],
    ["tickShuffleDiscardToDeck", 0x800907ac, 3],
    ["clearMarksSetQuota", 0x80090a6c, 3],
    ["markTopNOfPile", 0x80090a90, 3],
    ["effectOp48MoveMarkedToBoard", 0x80090ba0, 3],
    ["tickMoveMarkedToBoard", 0x80090cd8, 3],
    ["enterDiscardMarked", 0x800915c4, 2],
    ["tickDiscardMarked", 0x800915d4, 3],
    ["placeCardOnField", 0x80091858, 4],
    ["effectOp56ReturnCardToHand", 0x800919fc, 3],
    ["tickCardLand3", 0x80091c6c, 3],
    ["effectOp57CopyMarkedCardToSlot", 0x80091eb0, 3],
    ["tickCardLand5", 0x80092198, 3],
    ["openResolveWindow", 0x80092438, 3],
    ["tickResolveSequence", 0x80092638, 2],
    ["effectOp14ClearBothBoards", 0x80092ba4, 2],
    ["tickDealTurnStart", 0x80092e60, 2],
    ["enterDamageTransfer", 0x80093624, 3],
    ["tickAttackDrain", 0x80093710, 3],
    ["enterClearPlayedRow", 0x80093adc, 3],
    ["tickClearPlayedRow", 0x80093b10, 3],
    ["effectOp1bOpenComboCard", 0x80093c18, 2],
    ["tickComboCard", 0x80093cac, 2],
    ["buildFusion", 0x8009403c, 3],
    ["tickFusion", 0x800942dc, 3],
    ["effectOp5aResetStatAccums", 0x80094828, 2],
    ["tickRecountTotals", 0x80094848, 2],
    ["resetRoundEndAccums", 0x80094b78, 2],
    ["tickRoundEnd", 0x80094b9c, 3],
    ["showBanner", 0x80094fdc, 3],
    ["tickBannerWait", 0x80095030, 2],
    ["popPlayedStack", 0x8009518c, 3],
    ["pushPlayedStack", 0x80095208, 2],
    ["popPlayedStackWithWindow", 0x80095274, 3],
    ["pushPlayedStackWaitWindow", 0x800952f4, 2],
    ["effectOp5dTickStatSettle", 0x8009535c, 2],
];

/** Four return-value climates: never-finished, finished, answered, and varied. */
const CLIMATES = [
    { name: "zero", value: () => 0 },
    { name: "one", value: () => 1 },
    { name: "two", value: () => 2 },
    { name: "minus-one", value: () => -1 },
    { name: "varied", value: (addr) => ((addr * 2654435761) >>> 24) % 4 },
];

function runtime() {
    const rt = new NativeStageRuntime(overlay, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function stubOriginal(rt, events, rets) {
    for (const [name, addr, arity] of BOUNDARIES) {
        rt.cpu.setStub(addr, (c) => {
            const args = [c.reg(4) >>> 0, c.reg(5) >>> 0, c.reg(6) >>> 0, c.reg(7) >>> 0];
            if (arity === 5) args.push(rt.mem.read32((c.reg(29) >>> 0) + 0x10) >>> 0);
            events.push([name, ...args.slice(0, arity)]);
            return rets.get(addr) | 0;
        });
    }
    // opcode 0x0F's own card-record cursor: F0x8001EBF8 builds it on the frame
    // and its +0x2C method selects the record the arm then reads.
    let frame = 0;
    rt.cpu.setStub(0x8001ebf8, (c) => {
        frame = c.reg(4) >>> 0;
        events.push(["cardRecordCursorCreate"]);
        rt.mem.write32(frame + 0x00, RECORD);
        rt.mem.write32(frame + 0x2c, METHOD);
        return 0;
    });
    rt.cpu.setStub(METHOD, (c) => {
        const n = c.reg(4) | 0;
        events.push(["cardRecordSelect", n]);
        rt.mem.write32(frame + 0x00, RECORD + n * 0x62c);
        return 0;
    });
}

function portHost(mem, events, rets) {
    const port = {
        cardRecordCursorCreate: () => {
            events.push(["cardRecordCursorCreate"]);
            return CURSOR;
        },
        cardRecordSelect: (cursor, n) => {
            events.push(["cardRecordSelect", n | 0]);
            mem.write32(cursor + 0x00, RECORD + (n | 0) * 0x62c);
        },
        cardRecordPointer: (cursor) => mem.read32(cursor + 0x00) >>> 0,
    };
    for (const [name, addr, arity] of BOUNDARIES) {
        port[name] = (...args) => {
            events.push([name, ...args.slice(0, arity).map((a) => a >>> 0)]);
            return rets.get(addr) | 0;
        };
    }
    return port;
}

/** Three seeded duel states: small indices, a word-select 1, and a slot >= 6. */
const SEEDS = [
    { playCount: 1, hand: [0, 1, 2, 1], select: 2, ids: [0, 1, 2], counts: [2, 3], repeat: 2 },
    { playCount: 3, hand: [1, 0, 1, 0], select: 1, ids: [3, 4, 5], counts: [3, 1], repeat: 1 },
    { playCount: 1, hand: [1, 1, 0, 0], select: 7, ids: [4, 5, 6], counts: [1, 2], repeat: 3 },
];

function seed(rt, seedValues, pending, latched) {
    for (let i = 0; i < 0x900; i++) rt.mem.write8(DUEL + i, 0);
    rt.mem.write8(DUEL + 0x421, pending & 0xff);
    rt.mem.write8(DUEL + 0x420, latched & 0xff);
    rt.mem.write8(DUEL + 0x2f4, 0xee); // sentinel: "no arm wrote the step byte"
    rt.mem.write16(DUEL + 0x4e0, 0x0010);
    rt.mem.write16(DUEL + 0x4e2, seedValues.repeat);
    rt.mem.write16(DUEL + 0x4e4, 0x0004);
    rt.mem.write32(DUEL + 0x440, seedValues.select);
    for (let i = 0; i < 12; i++) rt.mem.write8(DUEL + 0x446 + i, 0);
    rt.mem.write8(DUEL + 0x575, seedValues.playCount);
    rt.mem.write8(DUEL + 0x579, seedValues.playCount % 2);
    rt.mem.write8(DUEL + 0x57a, 0x7f);
    rt.mem.write8(DUEL + 0x4dd, 0x7f);
    rt.mem.write8(DUEL + 0x306, 0);
    rt.mem.write8(DUEL + 0x424, 0);
    rt.mem.write8(DUEL + 0x422, 0);
    rt.mem.write16(DUEL + 0x5a2, seedValues.counts[1]);
    // Both sides' hand counts and id arrays: the arms read the side the play
    // history selects (stride 0xC8), so side 1 lives at 0x5A6+0xC8 / 0x600+0xC8.
    for (const side of [0, 1, 2]) {
        rt.mem.write16(DUEL + 0x5a6 + side * 0xc8, seedValues.counts[side % 2]);
    }
    for (let i = 0; i < 4; i++) rt.mem.write8(DUEL + 0x584 + i * 8, seedValues.hand[i]);
    for (let i = 0; i < 7; i++) {
        rt.mem.write16(DUEL + 0x600 + i * 2, seedValues.ids[i % 3]);
        rt.mem.write16(DUEL + 0x600 + 0xc8 + i * 2, seedValues.ids[i % 3]);
        rt.mem.write16(DUEL + 0x6c8 + i * 2, 0x50 + i);
    }
    for (let i = 0; i < 3; i++) rt.mem.write16(DUEL + 0x50 + i * 2, seedValues.ids[i]);
    for (let i = 0; i < 3; i++) rt.mem.write8(DUEL + 0x446 + i, i === seedValues.ids[0] % 3 ? 1 : 0);
    rt.mem.write8(DUEL + 0x586, 0x11);
    for (let slot = 0; slot < 8; slot++) {
        const base = slot < 6 ? 0x73a + slot * 0x0e : 0x7ac + (slot - 6) * 0x0e;
        rt.mem.write8(DUEL + base, 0x20 + slot);
    }
    for (let i = 0; i < 6; i++) rt.mem.write8(RECORD + i * 0x62c, i === 2 ? 3 : 5);
    // adjacent sentinels: a wrong-width store shows up as a clobber
    rt.mem.write8(DUEL + 0x57b, 0x5a);
    rt.mem.write8(DUEL + 0x2f5, 0x5b);
    rt.mem.write8(DUEL + 0x445, 0x5c);
}

function duelBytes(rt) {
    const out = [];
    for (let i = 0; i < 0x900; i++) out.push(rt.mem.read8(DUEL + i));
    return out;
}

function compare(seedValues, pending, latched, climate) {
    const rets = new Map(BOUNDARIES.map(([, addr]) => [addr, climate.value(addr)]));

    const evA = [];
    const a = runtime();
    stubOriginal(a, evA, rets);
    seed(a, seedValues, pending, latched);
    a.cpu.call(RUN_EFFECT_OPCODE, [DUEL, VIEW]);

    const evB = [];
    const b = runtime();
    seed(b, seedValues, pending, latched);
    runEffectOpcode(b.mem, portHost(b.mem, evB, rets), DUEL, VIEW);

    const where = `enter 0x${pending.toString(16)} update 0x${latched.toString(16)} ${climate.name} seed ${seedValues.playCount}`;
    assert.deepEqual(evB, evA, `calls differ: ${where}`);
    const ba = duelBytes(a);
    const bb = duelBytes(b);
    let diff = -1;
    for (let i = 0; i < ba.length; i++) {
        if (ba[i] !== bb[i]) {
            diff = i;
            break;
        }
    }
    assert.equal(
        diff,
        -1,
        `duel object differs at +0x${diff.toString(16)}: port ${bb[diff]} original ${ba[diff]} (${where})`,
    );
}

test("F0x80084320 matches the port for every enter opcode", () => {
    for (const climate of CLIMATES) {
        for (const s of SEEDS) {
            for (let op = 1; op <= 0xae; op++) compare(s, op, 0, climate);
            // out-of-range pendings: no enter arm at all, straight to the latch
            for (const op of [0xaf, 0xb0, 0xff]) compare(s, op, 0, climate);
        }
    }
});

test("F0x80084320 matches the port for every update opcode", () => {
    for (const climate of CLIMATES) {
        for (const s of SEEDS) {
            for (let op = 0; op <= 0xae; op++) compare(s, 0, op, climate);
        }
    }
});

test("both phases together match for a spread of paired opcodes", () => {
    const pairs = [
        [0x01, 0x01], [0x0f, 0x06], [0x11, 0x11], [0x31, 0x2f], [0x46, 0x45],
        [0x5d, 0x5d], [0x69, 0x6e], [0x70, 0x7e], [0x96, 0x96], [0x97, 0x97],
        [0x99, 0x9a], [0xa6, 0xa6], [0xa9, 0xac], [0xae, 0xae],
    ];
    for (const climate of CLIMATES) {
        for (const s of SEEDS) for (const [enter, update] of pairs) compare(s, enter, update, climate);
    }
});

test("every word of both shipped jump tables has a ported arm", () => {
    const rt = runtime();
    const mem = rt.mem;
    const dummyHost = new Proxy({}, { get: () => () => 0 });
    const seenEnter = new Set();
    const seenUpdate = new Set();
    for (let i = 0; i < 174; i++) {
        const arm = mem.read32(EFFECT_ENTER_TABLE + i * 4) >>> 0;
        if (seenEnter.has(arm)) continue;
        seenEnter.add(arm);
        enterEffectArm(arm, { mem, host: dummyHost, duel: DUEL, view: VIEW, s2: 0, s3: 0, s4: 1 });
    }
    for (let i = 0; i < 175; i++) {
        const arm = mem.read32(EFFECT_UPDATE_TABLE + i * 4) >>> 0;
        if (seenUpdate.has(arm)) continue;
        seenUpdate.add(arm);
        updateEffectArm(arm, { mem, host: dummyHost, duel: DUEL, view: VIEW, s2: 0, s3: 0, s4: 1 });
    }
    assert.equal(seenEnter.size, 122, "enter arms reached by the table");
    assert.equal(seenUpdate.size, 105, "update arms reached by the table");
});
