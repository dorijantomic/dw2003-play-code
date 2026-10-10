// Original interior tail executed from shipped resident.bin, using the real
// runtime draw recorder. Synthetic entry supplies only its owner's prerequisites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NativeStageRuntime } from "../engine/native/runtime.ts";
import { drawHomeMenuPanel } from "../engine/dw3/ui/home-menu-draw.ts";

const resident = new Uint8Array(readFileSync(new URL("../web/assets/native/screens/resident.bin", import.meta.url)));
const OBJ = 0x801a0000, ADAPTER = 0x0fd30002, PACK_STUB = 0x0fd30000, PACK = 0x80190000;
const arity = { setOrigin: 2, setLayer: 2, m_0x98: 1, m_0x88: 1, drawSprite: 4 };
const norm = calls => calls.map(({ method, args }) => [method, args.slice(0, arity[method] ?? 4).map(v => v >>> 0)]);

function runCase(limit, mutate = false) {
    function runtime() {
        const rt = new NativeStageRuntime(new Uint8Array(8),
            { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
            { setFlag() {}, getFlag: () => 0, rand16: () => 0 }, undefined, undefined, 0x80082cb0,
            { image: resident, base: 0x80010000 });
        rt.mem.write32(OBJ + 0x10, limit);
        rt.mem.write32(OBJ + 0x50, 0x1002);
        rt.mem.write32(OBJ + 0x54, 0xfffffffe);
        rt.mem.write32(OBJ + 0x68, 0x12345678);
        return rt;
    }
    const rt = runtime(), port = runtime();
    const resolved = [], portResolved = [];
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.cpu.setStub(PACK_STUB, c => {
        resolved.push(c.reg(4) >>> 0);
        if (mutate) rt.mem.write32(OBJ + 0x10, 0);
        return PACK;
    });
    rt.cpu.setStub(ADAPTER, c => {
        const frame = (c.reg(29) - 0x170) >>> 0;
        rt.mem.write32(frame + 0x168, c.reg(31));
        for (let i = 0; i < 6; i++) rt.mem.write32(frame + 0x150 + i * 4, 0xabc0 + i);
        c.setReg(29, frame);
        c.setReg(17, OBJ);
        c.setReg(31, 0x80013350);
        return 0;
    });
    rt.cpu.call(ADAPTER, [], 10000);
    const calls = [];
    const emit = (method, ...args) => calls.push({ method, args });
    drawHomeMenuPanel(port.mem, OBJ, {
        initDrawContext() {},
        setOrigin: (...args) => emit("setOrigin", ...args),
        setLayer: (...args) => emit("setLayer", ...args),
        context98: v => emit("m_0x98", v),
        paletteShift: v => emit("m_0x88", v),
        packResolve(handle) {
            portResolved.push(handle);
            if (mutate) port.mem.write32(OBJ + 0x10, 0);
            return PACK;
        },
        drawSprite: (...args) => emit("drawSprite", ...args),
    });
    assert.deepEqual(norm(calls), norm(rt.drawCalls), `limit=${limit}, mutate=${mutate}: ordered intents`);
    assert.deepEqual(portResolved, resolved, "ordered pack requests");
    assert.deepEqual(port.mem.bytes.slice(OBJ & 0x1fffff, (OBJ & 0x1fffff) + 0x70),
        rt.mem.bytes.slice(OBJ & 0x1fffff, (OBJ & 0x1fffff) + 0x70), "screen memory");
    assert.equal(rt.cpu.reg(29) >>> 0, rt.cpu.sp, "owner frame unwound");
    for (let i = 0; i < 6; i++) assert.equal(rt.cpu.reg(16 + i), 0xabc0 + i, "saved register restored");
    assert.equal(resolved.length, limit < 0 ? 0 : mutate ? 1 : Math.min(limit + 1, 6));
}

test("home menu draw tail matches original: signed limits, selected row and six-row cap", () => {
    for (const limit of [-2147483648, -1, 0, 1, 2, 3, 4, 5, 6, 7, 2147483647]) runCase(limit);
});
test("home menu draw tail reloads limit after draw boundaries", () => runCase(5, true));
