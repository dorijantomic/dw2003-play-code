// Phase 4 oracle: engine/dw3/ui/wizard-sequence.ts must match pro/stplnmet
// F0x80087C9C. The original runs through engine/native with every collaborator
// stubbed (the four overlay creates, the three panel creates, the fold cells,
// the installed panel slots and the starter-pack commit); the port uses an
// equivalent host and both must produce the same ordered call log, child-slot
// writes and object fields.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { wizardSequenceTick } from "../engine/dw3/ui/wizard-sequence.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stplnmet = new Uint8Array(readFileSync(join(dir, "pro_stplnmet.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stplnmet.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ROOT = 0x80180000;
const ARG1 = 0x80181000;
const INTRO = 0x80182000;
const FRAME = 0x80183000;
const TABLE = 0x80184000;
const CHROME = 0x80185000;
const NAME = 0x80186000;
const PACK = 0x80187000;
const CONFIRM = 0x80188000;

const SAVE_CONTEXT = 0x80048d88;
const ADV_SUB1 = 0x800142c8;

const STUBS = {
    introCreate: 0x0fe60000, frameCreate: 0x0fe60010, tableCreate: 0x0fe60020,
    chromeCreate: 0x0fe60030, nameCreate: 0x0fe60040, packCreate: 0x0fe60050,
    confirmCreate: 0x0fe60060, foldStart: 0x0fe60070, foldTick: 0x0fe60080,
    selectHeader: 0x0fe60090, nameShow: 0x0fe600a0, packShow: 0x0fe600b0,
    confirmAccept: 0x0fe600c0, confirmShow: 0x0fe600d0, nameLoad: 0x0fe600e0,
    commit: 0x0fe600f0, introBox: 0x0fe60100, introBind: 0x0fe60110,
};

let EVENTS = [];
let FOLDTICK = 0;

function runtime() {
    const rt = new NativeStageRuntime(stplnmet, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(0x800833a4, (c) => { EVENTS.push(["createIntro"]); return INTRO; });
    rt.cpu.setStub(0x800835c4, (c) => { EVENTS.push(["createFrameStep"]); return FRAME; });
    rt.cpu.setStub(0x80083748, (c) => { EVENTS.push(["createTableDwell"]); return TABLE; });
    rt.cpu.setStub(0x80083d38, (c) => { EVENTS.push(["createChrome", c.reg(4)]); return CHROME; });
    rt.cpu.setStub(0x80085e10, (c) => { EVENTS.push(["createNameEntry", c.reg(4)]); return NAME; });
    rt.cpu.setStub(0x80087ac0, (c) => { EVENTS.push(["createPackList", c.reg(4)]); return PACK; });
    rt.cpu.setStub(0x80086f60, (c) => { EVENTS.push(["createConfirm", c.reg(4)]); return CONFIRM; });
    rt.cpu.setStub(0x80087bf4, (c) => { EVENTS.push(["selectHeader", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(STUBS.foldStart, (c) => { EVENTS.push(["foldStart", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(STUBS.foldTick, (c) => { EVENTS.push(["foldTick", c.reg(4)]); return FOLDTICK; });
    rt.cpu.setStub(STUBS.introBox, (c) => { EVENTS.push(["introSetBox", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(STUBS.introBind, (c) => { EVENTS.push(["introBind", c.reg(4), c.reg(5), c.reg(6)]); return 0; });
    rt.cpu.setStub(STUBS.nameShow, (c) => { EVENTS.push(["nameEntryShow", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(STUBS.packShow, (c) => { EVENTS.push(["packListShow", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(STUBS.confirmAccept, (c) => { EVENTS.push(["confirmAccept", c.reg(4)]); return 0; });
    rt.cpu.setStub(STUBS.confirmShow, (c) => { EVENTS.push(["confirmShow", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(STUBS.nameLoad, (c) => { EVENTS.push(["nameEntryLoad", c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(STUBS.commit, (c) => { EVENTS.push(["commitStarterName", c.reg(4)]); return 0; });
    return rt;
}

const rt = runtime();

const FIELDS = [];
for (let off = 0x0c; off <= 0x68; off += 4) FIELDS.push([ROOT, off]);
for (let off = 0; off <= 0x18; off += 4) FIELDS.push([ARG1, off]);
FIELDS.push([NAME, 0x10], [PACK, 0x10], [CONFIRM, 0x10], [CONFIRM, 0x5c], [CONFIRM, 0x6c]);

function seed(o) {
    EVENTS = [];
    FOLDTICK = o.foldTick ?? 0;
    for (let i = 0; i <= 0x68; i += 4) rt.mem.write32(ROOT + i, 0);
    for (let i = 0; i <= 0x20; i += 4) rt.mem.write32(ARG1 + i, 0);
    for (let i = 0; i <= 0x100; i += 4) rt.mem.write32(NAME + i, 0);
    for (let i = 0; i <= 0x80; i += 4) rt.mem.write32(PACK + i, 0);
    for (let i = 0; i <= 0x70; i += 4) rt.mem.write32(CONFIRM + i, 0);
    for (let i = 0; i <= 0x90; i += 4) rt.mem.write32(INTRO + i, 0);

    rt.mem.write32(ROOT + 0x0c, o.phase ?? 0);
    rt.mem.write32(ROOT + 0x10, o.substate ?? 0);
    rt.mem.write32(ROOT + 0x14, o.selector ?? 0);
    rt.mem.write32(ROOT + 0x50, 0x1234);
    rt.mem.write32(ROOT + 0x3c, ADV_SUB1);
    rt.mem.write32(ROOT + 0x5c, o.duration ?? 0x0a);

    rt.mem.write32(ARG1 + 0x00, o.chrome ?? 0);
    rt.mem.write32(ARG1 + 0x04, o.nameEntry ?? NAME);
    rt.mem.write32(ARG1 + 0x08, o.packList ?? PACK);
    rt.mem.write32(ARG1 + 0x0c, o.confirm ?? CONFIRM);

    rt.mem.write32(NAME + 0x10, o.neState ?? 0);
    rt.mem.write32(PACK + 0x10, o.plState ?? 0);
    rt.mem.write32(CONFIRM + 0x10, o.cfState ?? 0);
    rt.mem.write32(PACK + 0x6c, 0x12345678);

    rt.mem.write32(NAME + 0xf0, STUBS.nameShow);
    rt.mem.write32(NAME + 0xec, STUBS.nameLoad);
    rt.mem.write32(PACK + 0x88, STUBS.packShow);
    rt.mem.write32(CONFIRM + 0xe0, STUBS.confirmAccept);
    rt.mem.write32(CONFIRM + 0xdc, STUBS.confirmShow);
    rt.mem.write32(INTRO + 0x7c, STUBS.introBox);
    rt.mem.write32(INTRO + 0x80, STUBS.introBind);

    // The overlay's fold cells, normally F0x80088438 / F0x800884CC.
    rt.mem.write32(0x80089ba0, STUBS.foldStart);
    rt.mem.write32(0x80089ba4, STUBS.foldTick);
    // The starter-pack commit cell [0x80048D88 + 0x26C8] = [0x8004B450].
    rt.mem.write32(0x8004b450, STUBS.commit);
}

function fields() {
    return FIELDS.map(([base, off]) => rt.mem.read32(base + off) >>> 0);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function portHost() {
    return {
        foldStart(ctx, open) { EVENTS.push(["foldStart", ctx >>> 0, open]); },
        foldTick(ctx) { EVENTS.push(["foldTick", ctx >>> 0]); return FOLDTICK; },
        createIntro() { EVENTS.push(["createIntro"]); return INTRO; },
        introSetBox(intro, w, h) { EVENTS.push(["introSetBox", intro >>> 0, w, h]); },
        introBind(intro, value, n) { EVENTS.push(["introBind", intro >>> 0, value >>> 0, n]); },
        createFrameStep() { EVENTS.push(["createFrameStep"]); return FRAME; },
        createTableDwell() { EVENTS.push(["createTableDwell"]); return TABLE; },
        createChrome(root) { EVENTS.push(["createChrome", root >>> 0]); return CHROME; },
        createNameEntry(saveCtx) { EVENTS.push(["createNameEntry", saveCtx >>> 0]); return NAME; },
        createPackList(root) { EVENTS.push(["createPackList", root >>> 0]); return PACK; },
        createConfirm(root) { EVENTS.push(["createConfirm", root >>> 0]); return CONFIRM; },
        selectHeader(root, arg1, mode) { EVENTS.push(["selectHeader", root >>> 0, arg1 >>> 0, mode]); },
        nameEntryShow(ne, on) { EVENTS.push(["nameEntryShow", ne >>> 0, on]); },
        packListShow(pl, on) { EVENTS.push(["packListShow", pl >>> 0, on]); },
        confirmAccept(cf) { EVENTS.push(["confirmAccept", cf >>> 0]); },
        confirmShow(cf, on) { EVENTS.push(["confirmShow", cf >>> 0, on]); },
        nameEntryLoad(ne, saveCtx) { EVENTS.push(["nameEntryLoad", ne >>> 0, saveCtx >>> 0]); },
        commitStarterName(namePtr) { EVENTS.push(["commitStarterName", namePtr >>> 0]); },
        advanceSubstate(obj) {
            const o = obj >>> 0;
            const v = (rt.mem.read32(o + 0x10) + 1) | 0;
            rt.mem.write32(o + 0x14, 0);
            rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0x10, v);
        },
    };
}

function runScenario(label, o) {
    seed(o);
    rt.cpu.call(0x80087c9c, [ROOT, ARG1]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleFields = fields();

    seed(o);
    wizardSequenceTick(rt.mem, ROOT, ARG1, portHost());
    const portEvents = norm(EVENTS.slice());
    const portFields = fields();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("wizardSequenceTick matches F0x80087C9C", () => {
    runScenario("substate 0", { substate: 0 });
    runScenario("substate 1 chrome alive", { substate: 1, chrome: CHROME });
    runScenario("substate 1 chrome gone", { substate: 1, chrome: 0 });
    runScenario("substate 2 open name", { substate: 2, selector: 0, neState: 0x64 });
    runScenario("substate 2 open name fold moving", { substate: 2, selector: 0, neState: 0x64, foldTick: 1 });
    runScenario("substate 2 open name not ready", { substate: 2, selector: 0, neState: 0x32 });
    runScenario("substate 2 name entry", { substate: 2, selector: 1, plState: 0x64 });
    runScenario("substate 2 name entry back", { substate: 2, selector: 1, plState: 0xc8 });
    runScenario("substate 2 confirm", { substate: 2, selector: 2, cfState: 0x64 });
    runScenario("substate 2 confirm back", { substate: 2, selector: 2, cfState: 0xc8 });
    runScenario("substate 2 hand-off", { substate: 2, selector: 3, confirm: 0, foldTick: 1 });
    runScenario("substate 2 hand-off waiting", { substate: 2, selector: 3, confirm: 0, foldTick: 0 });
    runScenario("substate 2 hand-off confirm alive", { substate: 2, selector: 3, confirm: CONFIRM, foldTick: 1 });
    runScenario("substate 2 selector 4 waits", { substate: 2, selector: 4, neState: 0x64 });
    runScenario("substate 3 ignored", { substate: 3 });
});
