// Exercise installed entries directly, including methods not reached by the
// screen-root pad sequence. Compare the real shipped bodies with substitution.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NativeStageRuntime } from '../engine/native/runtime.ts';
import { installTranslationBridge, BRIDGE_ENTRIES, setBridgeProbe } from '../engine/native/bridge.ts';
import { CURRENT_VIEW_CELL } from '../engine/dw3/globals.ts';
import { CARD_HELPER_CELL } from '../engine/dw3/ui/card-view.ts';
import { CACHE_SLOTS, CACHE_SLOT_COUNT, CACHE_ACTIVE, LBA_LEN_SECTORS } from '../engine/dw3/resource-service.ts';

const directory = new URL('../web/assets/native/screens/', import.meta.url);
const resident = new Uint8Array(readFileSync(new URL('resident.bin', directory)));
const object = 0x80180000;
const entries = [
    ['exe/fns', 0x80013a6c, true, 'cache'],
    ['exe/fns', 0x80013c30, false, 'cache'],
    ['exe/fns', 0x80013cdc, false, 'cache'],
    ['exe/fns', 0x80013efc, false, 'cache'],
    ['pro/stdwtitl', 0x80085f38, true],
    ['pro/stdwtitl', 0x80086fa0],
    ['pro/stdwtitl', 0x80087034, true],
    ['pro/stdgname', 0x80083378],
    ['pro/stdgname', 0x8008340c, true],
    ['pro/stcrddek', 0x800867e8],
    ['pro/stcrddek', 0x8008687c, true],
    ['pro/stcrdabm', 0x80083734, true],
    ['pro/cnty_sel', 0x80082fc4, true, 'curve'],
    ['pro/cnty_sel', 0x800835cc, true],
    ['pro/cnty_sel', 0x80083830, true],
    ['pro/cnty_sel', 0x80083a94, true],
    ['pro/stfgtrep', 0x80084a14, true],
    ['pro/stfgtrep', 0x80084a20, true],
    ['pro/stfgtrep', 0x80084ae0, true],
    ['pro/stgmcard', 0x80083bd8],
    ['pro/stgmcard', 0x80087edc],
    ['pro/stgmcard', 0x80087f70, true],
    ['pro/stplnmet', 0x80088438],
    ['pro/stplnmet', 0x80083d70],
    ['pro/stplnmet', 0x80083e04, true],
    ['pro/stplnmet', 0x800884cc, true],
    ['pro/stplnmet', 0x80085bb0],
    ['pro/stplnmet', 0x80085d50],
    ['pro/stplnmet', 0x80086eac],
    ['pro/stplnmet', 0x80087ac0, true],
    ['pro/stplnmet', 0x80086f60, true],
    ['pro/stgdglab', 0x8008f32c],
    ['pro/stgdglab', 0x8008f36c, true],
    ['exe/fns', 0x8001764c, true, 'ledger'],
    ['exe/fns', 0x800176ac, true, 'forms'],
    ['exe/fns', 0x8001a25c, true],
    ['exe/fns', 0x8001e98c],
    ['exe/fns', 0x8001e9a0],
    ['exe/fns', 0x8001e9b4],
    ['exe/fns', 0x8001fd28],
    ['exe/fns', 0x8001fd3c],
    ['exe/fns', 0x8001ff9c],
    ['pro/cardgame', 0x800a3548],
    ['pro/cardgame', 0x800a3558],
    ['pro/cardgame', 0x800a35a4, true],
    ['pro/cardgame', 0x800a35b0],
    ['pro/cardgame', 0x800a367c, true],
];

function runtime(module) {
    const image = module === 'exe/fns' ? new Uint8Array(8)
        : new Uint8Array(readFileSync(new URL(`${module.replace('/', '_')}.bin`, directory)));
    const rt = new NativeStageRuntime(image,
        { size: image.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] },
        { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 },
        undefined, undefined, 0x80082cb0, { image: resident, base: 0x80010000 });
    rt.cpu.gp = 0x8005cb50;
    return rt;
}

function seed(rt, phase) {
    for (let offset = 0; offset < 0x100; offset += 4) {
        rt.mem.write32(object + offset, (offset + phase) % 17);
    }
    rt.mem.write32(object, 10);
    rt.mem.write32(CURRENT_VIEW_CELL, object + 0x200);
    rt.mem.write32(CARD_HELPER_CELL, object + 0x300);
    rt.mem.write32(rt.cpu.sp + 0x10, 10);
    rt.mem.write32(rt.cpu.sp + 0x14, phase & 1);
    const base = 0x80048d34;
    for (let i = 0; i < 44; i++) rt.mem.write16(base + 0x7b8 + i * 0x14, i < phase ? i + 3 : 0);
    for (let i = 0; i < 3; i++) rt.mem.write16(base + 0x7b0 + i * 2, phase + i);
}

for (const [module, address, returnsValue, profile] of entries) {
    test(`installed ${module}:0x${address.toString(16)} matches its original effects`, () => {
        assert.ok(BRIDGE_ENTRIES.some(e => e.module === module && e.address === address));
        for (const phase of [0, 1, 2, 3, 7, 15, 30, 31]) {
            const off = runtime(module), on = runtime(module);
            seed(off, phase); seed(on, phase);
            let invoked = 0;
            installTranslationBridge(on.cpu, on.mem, [module], new Set([address]), on.services);
            setBridgeProbe(() => invoked++);
            if (profile === 'cache') {
                for (const rt of [off, on]) {
                    for (let i = 0; i < CACHE_SLOT_COUNT * 0x10; i += 4) rt.mem.write32(CACHE_SLOTS + i, 0);
                    rt.mem.write16(LBA_LEN_SECTORS + 0x7f6 * 2, 1);
                    rt.mem.write32(CACHE_ACTIVE, 1);
                    if (phase !== 0) {
                        rt.mem.write32(CACHE_SLOTS, phase % 4);
                        rt.mem.write32(CACHE_SLOTS + 4, 0x7f6);
                        rt.mem.write32(CACHE_SLOTS + 0xc, object + 0x1000);
                    }
                }
            }
            const args = profile === 'cache' ? [0x7f6]
                : profile === 'curve' ? [phase]
                : profile === 'ledger' ? [0, phase + 2]
                : profile === 'forms' ? [0, object + 0x400]
                : [object, phase & 1, phase + 2, 10];
            const expected = off.cpu.call(address, args);
            const actual = on.cpu.call(address, args);
            setBridgeProbe(null);
            assert.equal(invoked, 1, 'the installed replacement was invoked');
            if (returnsValue) assert.equal(actual, expected, `return at phase ${phase}`);
            if ([0x80083734, 0x800835cc, 0x80083830, 0x80083a94].includes(address)) {
                for (const register of [3, 4, 5, 6, 8]) {
                    assert.equal(on.cpu.reg(register), off.cpu.reg(register),
                        `caller-visible register ${register} at phase ${phase}`);
                }
            }
            assert.deepEqual(on.sfx, off.sfx, `sounds at phase ${phase}`);
            // Native call frames are scratch; persistent memory below them is
            // caller-visible and must match, including globals outside objects.
            let mismatch = -1;
            for (let i = 0; i < 0x1f0000; i++) {
                if (on.mem.bytes[i] !== off.mem.bytes[i]) { mismatch = i; break; }
            }
            assert.equal(mismatch, -1, `memory at phase ${phase}, first difference 0x${(0x80000000 + mismatch).toString(16)}`);
        }
    });
}

test('text width retains the real caller stack pointer for nonempty labels', () => {
    const font = object + 0x500, glyphs = object + 0x600, buffer = object + 0x900;
    for (const stack of [0x801ffcf0, 0x801ffad0]) {
        for (const fixed of [0, 8, -3]) {
            for (const enable of [0, 1, 0x100, 0x101]) {
                const off = runtime('exe/fns'), on = runtime('exe/fns');
                for (const rt of [off, on]) {
                    rt.cpu.sp = stack;
                    rt.mem.write32(object + 0x50, font);
                    rt.mem.write32(object + 0x5c, buffer);
                    rt.mem.write16(object + 0x62, 4);
                    rt.mem.write16(object + 0x66, 0);
                    rt.mem.write16(object + 0xb4, fixed);
                    rt.mem.write32(font + 4, glyphs);
                    rt.mem.write16(font + 0x14, 32);
                    for (const [i, value] of [4, 5, 6, 0].entries()) rt.mem.write8(buffer + i, value);
                    for (let code = 4; code <= 6; code++) {
                        rt.mem.write8(glyphs + 11 * code - 0x2c + 7, code - 5);
                        rt.mem.write8(glyphs + 11 * code - 0x2c + 9, 5);
                    }
                }
                installTranslationBridge(on.cpu, on.mem, [], new Set([0x8001a25c]), on.services);
                assert.equal(on.cpu.call(0x8001a25c, [object, enable]), off.cpu.call(0x8001a25c, [object, enable]));
                assert.equal(on.mem.read16(object + 0xbc), off.mem.read16(object + 0xbc));
                assert.equal(on.mem.read32(0x8005cd18), off.mem.read32(0x8005cd18));
                if (enable & 0xff) assert.equal(on.mem.read32(0x8005cd18) >>> 0, stack - 0x18);
            }
        }
    }
});

test('shop BIT refresh replacement matches the original with a real text widget', () => {
    for (const bits of [0, 50, 9700, 9999999]) {
        const off = runtime('pro/stitshop'), on = runtime('pro/stitshop');
        const owner = object, context = object + 0x200;
        for (const rt of [off, on]) {
            const widget = rt.cpu.call(0x8001ae38, [0x1000, 1, 0x37, 0x24]) >>> 0;
            rt.mem.write32(owner + 0x24, context);
            rt.mem.write32(context + 8, widget);
            rt.mem.write32(0x80048da0, bits);
        }
        installTranslationBridge(on.cpu, on.mem, ['pro/stitshop'], new Set([0x8008c0c4]), on.services);
        let invoked = 0;
        setBridgeProbe(() => invoked++);
        const expected = off.cpu.call(0x8008c0c4, [owner]);
        const actual = on.cpu.call(0x8008c0c4, [owner]);
        setBridgeProbe(null);
        assert.equal(invoked, 1);
        assert.equal(actual, expected, `return at ${bits} BIT`);
        for (const register of [3, 4, 5, 6]) {
            assert.equal(on.cpu.reg(register), off.cpu.reg(register), `register ${register} at ${bits} BIT`);
        }
        assert.deepEqual(on.sfx, off.sfx, `sounds at ${bits} BIT`);
        let mismatch = -1;
        for (let i = 0; i < 0x1f0000; i++) {
            if (on.mem.bytes[i] !== off.mem.bytes[i]) { mismatch = i; break; }
        }
        assert.equal(mismatch, -1, `memory at ${bits} BIT, first difference 0x${(0x80000000 + mismatch).toString(16)}`);
    }
});

test('shop labels replacement matches the original widgets and caller registers', () => {
    const off = runtime('pro/stitshop'), on = runtime('pro/stitshop');
    const owner = object, labels = object + 0x300;
    for (const rt of [off, on]) rt.mem.write16(owner + 0x50, 0x1000);
    installTranslationBridge(on.cpu, on.mem, ['pro/stitshop'], new Set([0x8008b524]), on.services);
    let invoked = 0;
    setBridgeProbe(() => invoked++);
    const expected = off.cpu.call(0x8008b524, [owner, labels]);
    const actual = on.cpu.call(0x8008b524, [owner, labels]);
    setBridgeProbe(null);
    assert.equal(invoked, 1);
    assert.equal(actual, expected);
    for (const register of [3, 4, 5, 6, 7]) {
        assert.equal(on.cpu.reg(register), off.cpu.reg(register), `register ${register}`);
    }
    assert.deepEqual(on.sfx, off.sfx);
    let mismatch = -1;
    for (let i = 0; i < 0x1f0000; i++) {
        if (on.mem.bytes[i] !== off.mem.bytes[i]) { mismatch = i; break; }
    }
    assert.equal(mismatch, -1, `first memory difference 0x${(0x80000000 + mismatch).toString(16)}`);
});

for (const [name, address, values] of [
    ['duel banner', 0x8009beac, [2, 0x260, 0x10002, 0xf1, 0xbd]],
    ['duel prompt', 0x8009c054, [0x8000abcd, 0x11, 0x1234, 2]],
]) {
    test(`${name} replacement matches the original view and sound`, () => {
        const off = runtime('pro/cardgame'), on = runtime('pro/cardgame');
        const view = object;
        for (const rt of [off, on]) {
            for (let i = 0; i < 0x3000; i++) rt.mem.write8(view + i, 0x5a);
            rt.mem.write32(rt.cpu.sp + 0x10, values[3]);
            rt.mem.write32(rt.cpu.sp + 0x14, values[4] ?? 0);
        }
        installTranslationBridge(on.cpu, on.mem, ['pro/cardgame'], new Set([address]), on.services);
        let invoked = 0;
        setBridgeProbe(() => invoked++);
        const args = [view, ...values.slice(0, 3)];
        const expected = off.cpu.call(address, args);
        const actual = on.cpu.call(address, args);
        setBridgeProbe(null);
        assert.equal(invoked, 1);
        assert.equal(actual, expected);
        for (const register of [3, 4, 5, 6, 7]) {
            assert.equal(on.cpu.reg(register), off.cpu.reg(register), `register ${register}`);
        }
        assert.deepEqual(on.sfx, off.sfx);
        let mismatch = -1;
        for (let i = 0; i < 0x1f0000; i++) {
            if (on.mem.bytes[i] !== off.mem.bytes[i]) { mismatch = i; break; }
        }
        assert.equal(mismatch, -1, `first memory difference 0x${(0x80000000 + mismatch).toString(16)}`);
    });
}
