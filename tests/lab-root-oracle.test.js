// Phase 4 oracle: engine/dw3/ui/lab-root.ts must match pro/stgdglab
// F0x8008EFD0 (create), F0x8008ED0C (tick), F0x8008EB30 (action tick),
// F0x8008EC50 (count+pack), F0x8008F040 (pages bind) and F0x8008F16C
// (banks loading). The original runs through engine/native with the child
// factories, the standard-context slots, the pack/bank services and the
// draw-context methods stubbed; the port uses an equivalent host.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import {
    labRootConstruct,
    labRootCountAndPackParty,
    labRootTextBanksLoading,
    labRootTimPagesBind,
    labRootTick,
} from "../engine/dw3/ui/lab-root.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const stgdglab = new Uint8Array(readFileSync(join(dir, "pro_stgdglab.bin")));
const host = () => ({ setFlag() {}, getFlag: () => 0, rand16: () => 0x777 });
const entry = { size: stgdglab.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const ROOT = 0x80180000;
const AUX = 0x80181000;
const SELECT = 0x80182000;
const CHILD_BASE = 0x80183000;
const FADE = 0x80184000;
const STUBS = {
    alloc: 0x0fe30000, advance: 0x0fe30010, setState: 0x0fe30020, transition: 0x0fe30030,
    select: 0x0fe30040, choice0: 0x8008c230, choice1: 0x80088694, choice2: 0x80085408,
    pair24: 0x0fe30050, pair28: 0x0fe30060, bind2c: 0x0fe30070, set30: 0x0fe30080,
    packResolve: 0x0fe30090, requestBank: 0x0fe300a0, bankPending: 0x0fe300b0,
};
const ADV_STATE = 0x800142ac;
const SET_STATE = 0x80014274;
const ARITY = { setOrigin: 2, setLayer: 2, setScale: 3, setPos: 2, m_0x88: 1, drawSprite: 4 };
const ROOT_OFFSETS = [0x0c, 0x10, 0x50, 0x54, 0x58, 0x5c, 0x60];

let EVENTS = [];
let DRAW = [];
let BANKS = 0;
let SAVE_SELECTOR = 0x99;

function runtime() {
    const rt = new NativeStageRuntime(stgdglab, entry, host(), undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.gp = 0x8005cb50;
    rt.cpu.setStub(STUBS.alloc, (c) => {
        EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]);
        return ROOT;
    });
    rt.cpu.setStub(0x80014504, (c) => { EVENTS.push(["alloc", c.reg(4), c.reg(5), c.reg(6)]); return ROOT; });
    rt.cpu.setStub(ADV_STATE, (c) => {
        const o = c.reg(4);
        const v = (rt.mem.read32(o + 0xc) + 1) | 0;
        rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        rt.mem.write32(o + 0xc, v);
        EVENTS.push(["advance", o]);
        return v;
    });
    rt.cpu.setStub(SET_STATE, (c) => {
        const o = c.reg(4);
        rt.mem.write32(o + 0xc, c.reg(5)); rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
        EVENTS.push(["setState", o, c.reg(5)]);
        return 0;
    });
    rt.cpu.setStub(STUBS.transition, (c) => { EVENTS.push(["transition", c.reg(4), c.reg(5)]); return 0; });
    rt.mem.write32(0x80048d34 + 0x270c, STUBS.transition);
    rt.cpu.setStub(0x8008a610, (c) => { EVENTS.push(["spawnSelect", c.reg(4)]); return SELECT; });
    rt.cpu.setStub(STUBS.choice0, (c) => { EVENTS.push(["choice", 0, c.reg(4), c.reg(5)]); return CHILD_BASE; });
    rt.cpu.setStub(STUBS.choice1, (c) => { EVENTS.push(["choice", 1, c.reg(4), c.reg(5)]); return CHILD_BASE + 0x100; });
    rt.cpu.setStub(STUBS.choice2, (c) => { EVENTS.push(["choice", 2, c.reg(4), c.reg(5)]); return CHILD_BASE + 0x200; });
    rt.cpu.setStub(0x8001ffa8, (c) => {
        const ctx = c.reg(4) >>> 0;
        rt.mem.write32(ctx + 0x24, STUBS.pair24);
        rt.mem.write32(ctx + 0x28, STUBS.pair28);
        rt.mem.write32(ctx + 0x2c, STUBS.bind2c);
        rt.mem.write32(ctx + 0x30, STUBS.set30);
        EVENTS.push(["ctxInstall"]);
        return 0;
    });
    rt.cpu.setStub(STUBS.pair24, (c) => { EVENTS.push(["ctx", 0x24, c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(STUBS.pair28, (c) => { EVENTS.push(["ctx", 0x28, c.reg(4), c.reg(5)]); return 0; });
    rt.cpu.setStub(STUBS.bind2c, (c) => { EVENTS.push(["ctx", 0x2c, c.reg(4)]); return 0; });
    rt.cpu.setStub(STUBS.set30, (c) => { EVENTS.push(["ctx", 0x30, c.reg(4)]); return 0; });
    rt.cpu.setStub(STUBS.packResolve, (c) => { EVENTS.push(["packResolve", c.reg(4)]); return 0x80190000; });
    rt.mem.write32(0x80044f5c, STUBS.packResolve);
    rt.cpu.setStub(STUBS.requestBank, (c) => { EVENTS.push(["requestBank", c.reg(4)]); return 0; });
    rt.mem.write32(0x80044f44, STUBS.requestBank);
    rt.cpu.setStub(STUBS.bankPending, (c) => { EVENTS.push(["bankPending", c.reg(4)]); return BANKS; });
    rt.mem.write32(0x80044f3c, STUBS.bankPending);
    return rt;
}

const rt = runtime();

function seed(o) {
    EVENTS = [];
    DRAW = [];
    BANKS = o.banks ?? 0;
    SAVE_SELECTOR = o.saveSelector ?? 0x99;
    rt.mem.write32(0x80048d68, SAVE_SELECTOR);
    rt.mem.write32(0x8005cca8, o.lang ?? 0x40);
    for (let i = 0; i < 0x7c; i += 4) rt.mem.write32(ROOT + i, 0);
    rt.mem.write32(ROOT + 0x38, ADV_STATE);
    rt.mem.write32(ROOT + 0x28, SET_STATE);
    rt.mem.write32(ROOT + 0x0c, o.phase ?? 0);
    rt.mem.write32(ROOT + 0x10, o.substate ?? 0);
    rt.mem.write32(ROOT + 0x50, o.target ?? 0x1000);
    rt.mem.write32(ROOT + 0x54, o.ambient ?? 0);
    rt.mem.write32(ROOT + 0x58, o.ambientToggle ?? 0);
    rt.mem.write32(ROOT + 0x5c, o.result ?? 0xdead);
    for (let i = 0; i < 0x0c; i += 4) rt.mem.write32(AUX + i, 0);
    rt.mem.write32(AUX + 0x00, o.aux0 ?? 0);
    rt.mem.write32(AUX + 0x04, o.aux1 ?? 0);
    rt.mem.write32(AUX + 0x08, o.aux2 ?? 0);
    rt.mem.write32(SELECT + 0x54, o.confirm ?? 0);
    rt.mem.write32(SELECT + 0x60, o.cursor ?? 0);
    for (let i = 0; i < 3; i++) rt.mem.write32(CHILD_BASE + i * 0x100 + 0x54, 0);
    rt.mem.write32(FADE + 0x0c, o.fadeState ?? 0);
}

function rootFields() {
    return ROOT_OFFSETS.map((off) => rt.mem.read32(ROOT + off) >>> 0);
}

function norm(list) {
    return list.map(([name, ...args]) => [name, ...args.map((v) => v >>> 0)]);
}

function normDraw(list) {
    return list.map(([m, a]) => [m, a.slice(0, ARITY[m] ?? 4).map((v) => v >>> 0)]);
}

function portHost() {
    return {
        allocLabRoot(handler, size, extra) { EVENTS.push(["alloc", handler, size, extra]); return ROOT; },
        advancePhase(o) {
            const v = (rt.mem.read32(o + 0xc) + 1) | 0;
            rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            rt.mem.write32(o + 0xc, v);
            EVENTS.push(["advance", o]);
        },
        setState(o, phase) {
            rt.mem.write32(o + 0xc, phase >>> 0); rt.mem.write32(o + 0x10, 0); rt.mem.write32(o + 0x14, 0); rt.mem.write32(o + 0x18, 0);
            EVENTS.push(["setState", o, phase >>> 0]);
        },
        requestTransition(selector, arg) { EVENTS.push(["transition", selector >>> 0, arg]); },
        saveSelector() { return SAVE_SELECTOR; },
        spawnSelectAction(root) { EVENTS.push(["spawnSelect", root >>> 0]); return SELECT; },
        choiceChild(root, cursor) {
            EVENTS.push(["choice", cursor, root >>> 0, 1]);
            return (CHILD_BASE + cursor * 0x100) >>> 0;
        },
        installStandardContext() { EVENTS.push(["ctxInstall"]); return 0; },
        contextCall(slot, a, b) {
            if (slot === 0x2c || slot === 0x30) EVENTS.push(["ctx", slot, a >>> 0]);
            else EVENTS.push(["ctx", slot, a >>> 0, b]);
        },
        packResolve(handle) { EVENTS.push(["packResolve", handle >>> 0]); return 0x80190000; },
        requestBank(id) { EVENTS.push(["requestBank", id >>> 0]); },
        bankPending(id) { EVENTS.push(["bankPending", id >>> 0]); return BANKS; },
        initDrawContext() {},
        setLayer(t, b) { DRAW.push(["setLayer", [t, b, 0, 0]]); },
        setOrigin(x, y) { DRAW.push(["setOrigin", [x, y, 0, 0]]); },
        drawSprite(p, c, x, y) { DRAW.push(["drawSprite", [p, c, x, y]]); },
    };
}

function runTick(label, o) {
    seed(o);
    const before = rt.drawCalls.length;
    rt.cpu.call(0x8008ed0c, [ROOT, AUX]);
    const oracleEvents = norm(EVENTS.slice());
    const oracleDraw = normDraw(rt.drawCalls.slice(before).map((c) => [c.method, c.args]));
    rt.drawCalls.length = before;
    const oracleFields = rootFields();

    seed(o);
    labRootTick(rt.mem, ROOT, AUX, portHost());
    const portEvents = norm(EVENTS.slice());
    const portDraw = normDraw(DRAW);
    const portFields = rootFields();

    assert.deepEqual(portEvents, oracleEvents, `${label}: calls`);
    assert.deepEqual(portDraw, oracleDraw, `${label}: draw`);
    assert.deepEqual(portFields, oracleFields, `${label}: fields`);
}

test("labRootConstruct matches F0x8008EFD0", () => {
    seed({});
    EVENTS = [];
    rt.cpu.call(0x8008efd0, []);
    const oracleAlloc = norm(EVENTS.filter((e) => e[0] === "alloc"));
    const oracleFields = [0x50, 0x68, 0x6c, 0x70, 0x74, 0x78].map((off) => rt.mem.read32(ROOT + off) >>> 0);

    seed({});
    EVENTS = [];
    const obj = labRootConstruct(rt.mem, { allocLabRoot(h, s, e) { EVENTS.push(["alloc", h, s, e]); return ROOT; } });
    assert.equal(obj, ROOT);
    const portAlloc = norm(EVENTS.filter((e) => e[0] === "alloc"));
    const portFields = [0x50, 0x68, 0x6c, 0x70, 0x74, 0x78].map((off) => rt.mem.read32(ROOT + off) >>> 0);
    assert.deepEqual(portAlloc, oracleAlloc, "alloc");
    assert.deepEqual(portFields, oracleFields, "fields");
});

test("labRootCountAndPackParty matches F0x8008EC50", () => {
    const party = 0x80048d34 + 0x70;
    const cases = [[1, 2, 3], [-1, 5, 7], [4, -1, 6], [-1, -1, 9], [-1, -1, -1], [0, 1, 2]];
    for (const words of cases) {
        for (let i = 0; i < 3; i++) rt.mem.write32(party + i * 4, words[i] >>> 0);
        rt.cpu.call(0x8008ec50, [ROOT]);
        const oracle = [rt.mem.read32(ROOT + 0x60) >>> 0, ...[0, 1, 2].map((i) => rt.mem.read32(party + i * 4) >>> 0)];

        for (let i = 0; i < 3; i++) rt.mem.write32(party + i * 4, words[i] >>> 0);
        rt.mem.write32(ROOT + 0x60, 0xdead);
        labRootCountAndPackParty(rt.mem, ROOT);
        const port = [rt.mem.read32(ROOT + 0x60) >>> 0, ...[0, 1, 2].map((i) => rt.mem.read32(party + i * 4) >>> 0)];
        assert.deepEqual(port, oracle, `party ${words.join(",")}`);
    }
});

test("labRootTextBanksLoading matches F0x8008F16C", () => {
    seed({ banks: 0 });
    const oracleLoaded = rt.cpu.call(0x8008f16c, []) | 0;
    const oracleEvents = norm(EVENTS.slice());
    seed({ banks: 0 });
    const portLoaded = labRootTextBanksLoading(rt.mem, portHost()) | 0;
    assert.equal(portLoaded, oracleLoaded, "loaded return");
    assert.deepEqual(norm(EVENTS.slice()), oracleEvents, "loaded calls");

    EVENTS = [];
    BANKS = 3;
    rt.cpu.call(0x8008f16c, []);
    const busyEvents = norm(EVENTS.slice());
    const busyRet = 1;
    EVENTS = [];
    BANKS = 3;
    const portBusy = labRootTextBanksLoading(rt.mem, portHost()) | 0;
    assert.equal(portBusy, busyRet, "busy return");
    assert.deepEqual(norm(EVENTS.slice()), busyEvents, "busy calls");
});

test("labRootTimPagesBind matches F0x8008F040", () => {
    seed({});
    rt.cpu.call(0x8008f040, []);
    const oracleEvents = norm(EVENTS.slice());

    seed({});
    labRootTimPagesBind(rt.mem, portHost());
    const portEvents = norm(EVENTS.slice());
    assert.deepEqual(portEvents, oracleEvents, "calls");
});

test("labRootTick matches F0x8008ED0C", () => {
    runTick("phase 0 bind pages", { phase: 0, substate: 0 });
    runTick("phase 0 banks pending", { phase: 0, substate: 1, banks: 1 });
    runTick("phase 0 ready", { phase: 0, substate: 1, aux0: SELECT });
    runTick("phase 4 bind pages", { phase: 4, substate: 0 });
    runTick("phase 2 idle", { phase: 2 });
    runTick("phase 3 restore", { phase: 3, saveSelector: 0x2d7 });
    runTick("phase 1 draw", { phase: 1, ambientToggle: 1, ambient: 0x10 });
    runTick("ambient wrap", { phase: 1, ambientToggle: 1, ambient: 0x5f });
    runTick("ambient off", { phase: 1, ambientToggle: 0, ambient: 0x10 });
    runTick("action state 0", { phase: 1, substate: 0 });
    runTick("action state 0 existing", { phase: 1, substate: 0, aux0: SELECT });
    runTick("action state 1 missing child", { phase: 1, substate: 1, aux0: 0 });
    runTick("action state 1 waiting", { phase: 1, substate: 1, aux0: SELECT, confirm: 0 });
    runTick("action state 1 confirm", { phase: 1, substate: 1, aux0: SELECT, confirm: 1, cursor: 1 });
    runTick("action state 2 waiting", { phase: 1, substate: 2, aux0: SELECT, aux1: CHILD_BASE });
    runTick("action state 2 returned", { phase: 1, substate: 2, aux0: SELECT });
    runTick("action state 3 done", { phase: 1, substate: 3, aux2: FADE, fadeState: 2 });
    runTick("action state 3 waiting", { phase: 1, substate: 3, aux2: FADE, fadeState: 1 });
    runTick("action state 5", { phase: 1, substate: 5 });
});
