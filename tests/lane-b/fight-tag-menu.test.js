// Lane B oracle: engine/dw3/ui/native/battle-tag-menu.ts must match the
// original pro/fightstg TAG (partner switch) list family.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// allocator, the text-widget constructor, the resource/pack services, the four
// Digimon data services, the pad, the display counter, the sound and every
// object method are stubbed on both sides, so the ordered calls, the widget
// fields and the screen's own memory are compared.
//
// The cases drive what a player does: a three-member party with one partner
// knocked out, Down past the last row, Circle on the knocked-out row, Circle on
// a live row, Cross on the interactive screen and Cross on the forced one.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    tagCompatible, tagMenuActorConstruct, tagMenuCreateWidgets, tagMenuFillRows,
    tagMenuInput, tagMenuPanels, tagMenuTick,
    TAG_CANDIDATE, TAG_COUNT, TAG_INTERACTIVE, TAG_LIST_CONFIG, TAG_MAX_ROWS,
    TAG_MESSAGE_SLOT, TAG_OUT_ROW, TAG_OUT_SLOT, TAG_PANEL_OK, TAG_PARTY_BASE, TAG_PARTY_INDEX,
    TAG_PARTY_STRIDE, TAG_PROFILE_STRIDE, TAG_PROFILES,
    TAG_RESULT_CANCEL, TAG_RESULT_RUNNING, TAG_STATE,
} from "../../engine/dw3/ui/native/battle-tag-menu.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SCREEN = 0x80150000;
const SLOT = 0x80161000;
const MODEL = 0x80162000;
const OUT_SLOT = 0x80163000;
const OUT_ROW = 0x80163004;
const WIDGET_BASE = 0x80180000;
const RES_PTR = 0x801a0000;
const PACK_PTR = 0x801a1000;
const RECORD = 0x801a2000;
const COMPAT = 0x801a3000;

const TIME_OBJECT = 0x8004de10;
const CREATE_FN = 0x8001ae38;
const ALLOC_FN = 0x80014504;
const RESOURCE_PTR = 0x80044f4c;
const PACK_PTR_CELL = 0x80044f5c;
const PAD_PTR = 0x8004bbc4;
const COUNTER_PTR = 0x8004df98;
const SERVICE_BASE = 0x80048d34;

const ALLOC_STUB = 0x0fdd0000;
const PAD_STUB = 0x0fdd000c;
const RESOURCE_STUB = 0x0fdd0014;
const PACK_STUB = 0x0fdd0018;
const COUNTER_STUB = 0x0fdd001c;
const SPECIES_STUB = 0x0fdd0020;
const LIST_STUB = 0x0fdd0024;
const NAME_STUB = 0x0fdd0028;
const RECORD_STUB = 0x0fdd002c;
const SLOT_BASE = 0x0fdd1000;

const SLOT_ARITY = {
    0x28: 1, 0x38: 0, 0x3c: 0, 0x114: 2, 0x118: 2, 0x138: 1, 0x144: 1, 0x148: 1, 0x16c: 0,
};
const SLOTS = Object.keys(SLOT_ARITY).map(Number);

const LOG = [];
/** The compatibility list F0x80096EC8 reads back at self+0x7C. */
const COMPAT_LIST = [];
const CONTROL = {
    alloc: SCREEN, pad: 0, counter: 0, species: 1, record: RECORD, compatCount: 2,
    compatList: [], profileId: 7, name: 0x801a4000,
};
let made = 0;

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound(id) { LOG.push(["sound", id | 0]); } };
    const rt = new NativeStageRuntime(fight, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(ALLOC_FN, (c) => {
        LOG.push(["alloc", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]);
        return CONTROL.alloc;
    });
    rt.cpu.setStub(CREATE_FN, (c) => {
        LOG.push(["create", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const widget = WIDGET_BASE + made * 0x400;
        made += 1;
        for (const slot of SLOTS) rt.mem.write32(widget + slot, SLOT_BASE + slot);
        return widget;
    });
    rt.cpu.setStub(PAD_STUB, () => { LOG.push(["pad"]); return CONTROL.pad; });
    rt.cpu.setStub(RESOURCE_STUB, (c) => { LOG.push(["resource", c.reg(4) | 0]); return RES_PTR; });
    rt.cpu.setStub(PACK_STUB, (c) => { LOG.push(["pack", c.reg(4) | 0]); return PACK_PTR; });
    rt.cpu.setStub(COUNTER_STUB, () => { LOG.push(["counter"]); return CONTROL.counter; });
    rt.cpu.setStub(SPECIES_STUB, (c) => { LOG.push(["species", c.reg(4) | 0]); return CONTROL.species; });
    rt.cpu.setStub(LIST_STUB, (c) => {
        LOG.push(["list", c.reg(4) | 0, c.reg(5) | 0]);
        COMPAT_LIST.forEach((id, i) => rt.mem.write16((c.reg(5) >>> 0) + i * 2, id & 0xffff));
        return COMPAT_LIST.length;
    });
    rt.cpu.setStub(NAME_STUB, (c) => { LOG.push(["name", c.reg(4) | 0]); return CONTROL.name; });
    rt.cpu.setStub(RECORD_STUB, (c) => { LOG.push(["record", c.reg(4) | 0]); return CONTROL.record; });
    for (const slot of SLOTS) {
        rt.cpu.setStub(SLOT_BASE + slot, (c) => {
            const args = [];
            for (let i = 0; i < SLOT_ARITY[slot]; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, slot, ...args]);
            return slot === 0x16c ? 0 : 0;
        });
    }
    rt.cpu.setStub(0x8001ecbc, (c) => { LOG.push(["origin", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed34, (c) => { LOG.push(["layer", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    // ctx+0x88 is F0x8001ECE(C), the palette the shared row draw selects with.
    rt.cpu.setStub(0x8001ecec, (c) => { LOG.push(["palette", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed6c, (c) => { LOG.push(["sprite", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });

    rt.mem.write32(RESOURCE_PTR, RESOURCE_STUB);
    rt.mem.write32(PACK_PTR_CELL, PACK_STUB);
    rt.mem.write32(PAD_PTR, PAD_STUB);
    rt.mem.write32(COUNTER_PTR, COUNTER_STUB);
    rt.mem.write32(SERVICE_BASE + 0x2718, SPECIES_STUB);
    rt.mem.write32(SERVICE_BASE + 0x2738, LIST_STUB);
    rt.mem.write32(SERVICE_BASE + 0x2750, NAME_STUB);
    rt.mem.write32(0x8005cca0, RECORD_STUB);
    return rt;
}

/** The overlay's own data: the config block, the party records and the profile. */
function seedData(rt, c) {
    const index = c.partyIndex ?? 0;
    rt.mem.write32(TAG_PARTY_INDEX, index);
    for (let i = 0; i < 3; i++) {
        const record = TAG_PARTY_BASE + i * TAG_PARTY_STRIDE;
        const info = c.party?.[i];
        rt.mem.write16(record + 0x00, (info?.species ?? 0) & 0xffff);
        rt.mem.write16(record + 0x06, (info?.maxHp ?? 0) & 0xffff);
        rt.mem.write16(record + 0x08, (info?.hp ?? 0) & 0xffff);
        rt.mem.write16(record + 0x0a, (info?.maxMp ?? 0) & 0xffff);
        rt.mem.write16(record + 0x0c, (info?.mp ?? 0) & 0xffff);
        rt.mem.write8(record + 0x1a, (info?.blast ?? 0) & 0xff);
    }
    rt.mem.write8(RECORD + 0x3d, (c.matchByte ?? 5) & 0xff);
    // The id the byte indexes: 0x8003EF5C + 0x58 * (byte - 1), read unsigned.
    COMPAT_LIST.length = 0;
    for (const id of c.compatList ?? [7, 9]) COMPAT_LIST.push(id);
    CONTROL.alloc = c.alloc ?? MODEL;
    CONTROL.pad = c.pad ?? 0;
    CONTROL.counter = c.counter ?? 0;
    CONTROL.species = c.species ?? 5;
    CONTROL.profileId = c.profileId ?? 7;
    CONTROL.record = c.record ?? RECORD;
    CONTROL.name = c.tagName ?? 0x801a4000;
    for (let i = 0; i < 8; i++) {
        const at = TAG_PROFILES + TAG_PROFILE_STRIDE * i;
        rt.mem.write16(at, (c.profileTable?.[i] ?? 0) & 0xffff);
    }
    rt.mem.write16(TAG_PROFILES + TAG_PROFILE_STRIDE * ((c.matchByte ?? 5) - 1), CONTROL.profileId & 0xffff);
    made = 0;
}

/** The screen object, its widget block, the model and the two out words. */
function seedScreen(rt, c) {
    for (let i = 0; i < 0x90; i += 4) rt.mem.write32(SCREEN + i, 0);
    rt.mem.write32(SCREEN + TAG_STATE, c.state ?? 1);
    rt.mem.write32(SCREEN + 0x28, SLOT_BASE + 0x28);
    rt.mem.write32(SCREEN + 0x38, SLOT_BASE + 0x38);
    rt.mem.write32(SCREEN + TAG_OUT_SLOT, OUT_SLOT);
    rt.mem.write32(SCREEN + TAG_OUT_ROW, OUT_ROW);
    rt.mem.write32(SCREEN + TAG_INTERACTIVE, c.interactive ?? 1);
    rt.mem.write32(SCREEN + TAG_COUNT, c.count ?? 0);
    for (let i = 0; i < TAG_MAX_ROWS; i++) {
        rt.mem.write32(SCREEN + TAG_CANDIDATE + i * 4, (c.candidates?.[i] ?? i) | 0);
        rt.mem.write32(SCREEN + TAG_PANEL_OK + i * 4, (c.panelOk?.[i] ?? 5) | 0);
    }
    for (let i = 0; i < 4; i += 4) rt.mem.write32(SCREEN + 0x80 + i, c.blinkAcc ?? 0);
    rt.mem.write32(SCREEN + 0x6c, c.blinkAcc ?? 0);
    rt.mem.write32(SCREEN + 0x70, c.blinkPhase ?? 0);
    rt.mem.write32(SCREEN + 0x68, c.firstFrame ?? 0);
    rt.mem.write32(SLOT, c.modelInSlot ?? (MODEL | 0));
    rt.mem.write32(SLOT + TAG_MESSAGE_SLOT, c.messageWidget ?? 0);
    rt.mem.write32(MODEL + 0x50, c.cursor ?? 0);
    rt.mem.write32(MODEL + 0x54, 0);
    rt.mem.write32(MODEL + 0x58, c.count ?? 2);
    for (let i = 0; i < 8; i++) rt.mem.write32(TAG_LIST_CONFIG + i * 4, 0);
    rt.mem.write32(OUT_SLOT, c.outSlot ?? TAG_RESULT_RUNNING);
    rt.mem.write32(OUT_ROW, c.outRow ?? 0);
    // Pre-built widgets: the widget builder is stubbed out of the state-1 path,
    // so the whole row block is seeded and every handle carries a method table.
    for (let i = 0; i < 0x18; i++) {
        const widget = WIDGET_BASE + i * 0x400;
        for (const slot of SLOTS) rt.mem.write32(widget + slot, SLOT_BASE + slot);
        rt.mem.write32(SLOT + 0x04 + i * 4, widget);
    }
}

function portHost(rt) {
    return {
        allocateActor() { LOG.push(["alloc", 0x80097498 | 0, 0x88, 0x50]); return CONTROL.alloc; },
        allocateModel() { LOG.push(["alloc", 0x8009af4c | 0, 0xa8, 0]); return CONTROL.alloc; },
        createModel(config) {
            void config;
            const model = this.allocateModel();
            for (let i = 0; i < 8; i++) rt.mem.write32(model + 0x58 + i * 4, rt.mem.read32(config + i * 4) | 0);
            return model;
        },
        speciesOfSlot(slot) { LOG.push(["species", slot | 0]); return CONTROL.species; },
        preselectRecord(species) { LOG.push(["record", species | 0]); return CONTROL.record; },
        compatibilityList(record, dest) {
            LOG.push(["list", record | 0, dest | 0]);
            COMPAT_LIST.forEach((id, i) => rt.mem.write16(dest + i * 2, id & 0xffff));
            return COMPAT_LIST.length;
        },
        profileId(profile) { LOG.push(["profile", profile | 0]); return CONTROL.profileId; },
        nameOfSlot(slot) { LOG.push(["name", slot | 0]); return CONTROL.name; },
        createTextElement(target, kind, x, y) {
            LOG.push(["create", target | 0, kind | 0, x | 0, y | 0]);
            const widget = WIDGET_BASE + made * 0x400;
            made += 1;
            return widget;
        },
        resourceBase(bank) { LOG.push(["resource", bank | 0]); return RES_PTR; },
        packResolve(handle) { LOG.push(["pack", handle | 0]); return PACK_PTR; },
        padRead(port) { LOG.push(["pad"]); return CONTROL.pad; },
        padReadA(port) { LOG.push(["padA", port | 0]); return CONTROL.pad; },
        padReadB(port) { LOG.push(["padB", port | 0]); return 0; },
        playSound(id) { LOG.push(["sound", id | 0]); return 0; },
        frameCounter() { LOG.push(["counter"]); return CONTROL.counter; },
        initDrawContext() {},
        setLayer(x, y) { LOG.push(["layer", x | 0, y | 0]); },
        setOrigin(x, y) { LOG.push(["origin", x | 0, y | 0]); },
        setSpritePalette(frame) { LOG.push(["palette", frame | 0]); },
        drawSprite(pack, id, x, y) { LOG.push(["sprite", pack | 0, id | 0, x | 0, y | 0]); },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); return 0; },
    };
}

const SCREEN_FIELDS = [
    TAG_STATE, TAG_OUT_SLOT, TAG_OUT_ROW, TAG_INTERACTIVE, TAG_COUNT,
    TAG_CANDIDATE, TAG_CANDIDATE + 4, TAG_PANEL_OK, TAG_PANEL_OK + 4,
    0x68, 0x6c, 0x70, 0x7c, 0x7e,
];
const MODEL_FIELDS = [0x50, 0x54, 0x58, 0x5c, 0x60, 0x64, 0x68, 0x6c, 0x70, 0x74, 0x78, 0x7c];

function snapshot(rt) {
    const out = [];
    for (const off of SCREEN_FIELDS) out.push(`s+${off.toString(16)}=${rt.mem.read32(SCREEN + off) >>> 0}`);
    for (let i = 0; i < 8; i++) out.push(`cfg${i}=${rt.mem.read32(TAG_LIST_CONFIG + i * 4) >>> 0}`);
    for (const off of MODEL_FIELDS) out.push(`m+${off.toString(16)}=${rt.mem.read32(MODEL + off) >>> 0}`);
    for (let i = 0; i < 0x18; i++) out.push(`w${i}=${rt.mem.read32(SLOT + 0x04 + i * 4) >>> 0}`);
    out.push(`out=${rt.mem.read32(OUT_SLOT) >>> 0}`);
    out.push(`row=${rt.mem.read32(OUT_ROW) >>> 0}`);
    return out;
}

function runBoth(rt, addr, c, run) {
    seedScreen(rt, c);
    seedData(rt, c);
    LOG.length = 0;
    rt.cpu.call(addr, [SCREEN, SLOT], 40000);
    const olog = LOG.slice();
    const ofields = snapshot(rt);

    seedScreen(rt, c);
    seedData(rt, c);
    LOG.length = 0;
    run(rt.mem, portHost(rt));
    if (process.env.TAG_DEBUG) {
        const fmt = (e) => JSON.stringify(e.map((v) => typeof v === "number" && v < 0 ? v >>> 0 : v));
        let i = 0;
        while (i < olog.length && i < LOG.length && fmt(olog[i]) === fmt(LOG[i])) i += 1;
        console.log(`${c.name} first diff at ${i}/${olog.length}/${LOG.length}`);
        for (let k = Math.max(0, i - 2); k < Math.min(Math.max(olog.length, LOG.length), i + 6); k++) {
            console.log(`  ${k} O ${fmt(olog[k] ?? null)}`);
            console.log(`  ${k} P ${fmt(LOG[k] ?? null)}`);
        }
        if (process.env.TAG_DEBUG === "2") {
            for (let k = 0; k < olog.length; k++) console.log(`  O${k} ${fmt(olog[k])}`);
            for (let k = 0; k < LOG.length; k++) console.log(`  P${k} ${fmt(LOG[k])}`);
        }
    }
    assert.deepEqual(LOG, olog, `${c.name}: calls`);
    assert.deepEqual(snapshot(rt), ofields, `${c.name}: fields`);
}

/** Three members: the actor at slot 0, one live partner, one knocked out. */
const PARTY = [
    { species: 3, maxHp: 100, hp: 100, maxMp: 80, mp: 80 },
    { species: 7, maxHp: 200, hp: 150, maxMp: 60, mp: 40 },
    { species: 8, maxHp: 120, hp: 0, maxMp: 30, mp: 0 },
];

test("the shipped config block is the two-row TAG list", () => {
    const rt = runtime();
    const words = [];
    for (let i = 0; i < 8; i++) words.push(rt.mem.read32(TAG_LIST_CONFIG + i * 4) | 0);
    assert.deepEqual(words, [2, 0x11, 0x4e, 0x20, 0x2f, 0x10, 0x4d, 0x20]);
});

test("tagMenuActorConstruct matches F0x80097984", () => {
    const rt = runtime();
    for (const c of [{ name: "interactive" }, { name: "forced", interactive: 0 }]) {
        c.alloc = SCREEN;
        seedData(rt, c);
        LOG.length = 0;
        const oscreen = rt.cpu.call(0x80097984, [OUT_SLOT, OUT_ROW, c.interactive ?? 1], 40000) | 0;
        const olog = LOG.slice();

        seedData(rt, c);
        rt.mem.write32(SCREEN, 0);
        LOG.length = 0;
        const screen = tagMenuActorConstruct(rt.mem, OUT_SLOT, OUT_ROW, c.interactive ?? 1, portHost(rt));
        if (process.env.TAG_DEBUG) { console.log("O", JSON.stringify(olog)); console.log("P", JSON.stringify(LOG)); }
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.equal(screen >>> 0, oscreen >>> 0, `${c.name}: object`);
        assert.equal(rt.mem.read32(OUT_SLOT) | 0, TAG_RESULT_RUNNING, `${c.name}: running`);
        assert.equal(rt.mem.read32(SCREEN + TAG_INTERACTIVE) | 0, c.interactive ?? 1, `${c.name}: flag`);
    }
});

test("tagMenuTick state 0 matches F0x80097498", () => {
    const rt = runtime();
    for (const c of [
        { name: "build two rows", state: 0, party: PARTY },
        { name: "build one row", state: 0, party: [PARTY[0], PARTY[2], { species: 0 }] },
        { name: "build with no partner", state: 0, party: [{ species: 3 }, { species: 0 }, { species: 0 }] },
        { name: "build while blast", state: 0, party: [{ ...PARTY[0], blast: 1 }, PARTY[1], PARTY[2]] },
        { name: "build forced", state: 0, interactive: 0, party: PARTY },
        { name: "build no list match", state: 0, party: PARTY, compatList: [1, 2], profileId: 7 },
        { name: "build list match", state: 0, party: PARTY, compatList: [7], profileId: 7, matchByte: 5 },
        { name: "build with no record", state: 0, party: PARTY, record: 0, matchByte: 0 },
        { name: "build actor slot 2", state: 0, partyIndex: 2, party: PARTY },
        { name: "build remembers the row", state: 0, party: PARTY, outRow: 1 },
    ]) {
        runBoth(rt, 0x80097498, c, (mem, host) => tagMenuTick(mem, SCREEN, SLOT, host));
    }
});

test("tagMenuTick state 1 matches F0x80097498", () => {
    const rt = runtime();
    const base = {
        state: 1, party: PARTY, count: 2, candidates: [1, 2], panelOk: [5, 5],
        cursor: 0, interactive: 1,
    };
    for (const c of [
        { name: "idle", ...base },
        { name: "confirm live row", ...base, pad: 0x2000 },
        { name: "confirm knocked out row", ...base, pad: 0x2000, cursor: 1 },
        { name: "confirm second row", ...base, pad: 0x2000, cursor: 1, candidates: [2, 1], panelOk: [5, 0] },
        { name: "cancel", ...base, pad: 0x4000 },
        { name: "cancel while forced", ...base, pad: 0x4000, interactive: 0 },
        { name: "confirm while forced", ...base, pad: 0x2000, interactive: 0 },
        { name: "up", ...base, pad: 0x10 },
        { name: "down", ...base, pad: 0x40 },
        { name: "down past the end", ...base, pad: 0x40, cursor: 1 },
        { name: "no panel", ...base, panelOk: [0, 0] },
        { name: "one row only", ...base, count: 1, candidates: [1, 2], panelOk: [5, 0] },
    ]) {
        runBoth(rt, 0x80097498, c, (mem, host) => tagMenuTick(mem, SCREEN, SLOT, host));
    }
});

test("tagMenuTick state 2 matches F0x80097498", () => {
    const rt = runtime();
    const base = { state: 2, count: 0, party: [{ species: 3 }], messageWidget: WIDGET_BASE };
    for (const c of [
        { name: "first frame", ...base },
        { name: "hand frame", ...base, firstFrame: 1, blinkAcc: 8, counter: 12 },
        { name: "hand frozen", ...base, firstFrame: 1, blinkAcc: 1, counter: 12 },
        { name: "hand phase wrap", ...base, firstFrame: 1, blinkAcc: 8, blinkPhase: 4, counter: 12 },
        { name: "hand needs four ticks", ...base, firstFrame: 1, blinkAcc: 9, counter: 12 },
        { name: "hand young counter", ...base, firstFrame: 1, blinkAcc: 0, counter: 3 },
        { name: "confirm", ...base, firstFrame: 1, blinkAcc: 8, pad: 0x2000 },
        { name: "cancel does nothing", ...base, firstFrame: 1, blinkAcc: 8, pad: 0x4000 },
    ]) {
        runBoth(rt, 0x80097498, c, (mem, host) => tagMenuTick(mem, SCREEN, SLOT, host));
    }
});

test("tagMenuCreateWidgets matches F0x800970C0", () => {
    const rt = runtime();
    for (const c of [
        { name: "two rows", count: 2, party: PARTY },
        { name: "one row", count: 1, party: PARTY },
        { name: "no row", count: 0, party: PARTY },
    ]) {
        runBoth(rt, 0x800970c0, c, (mem, host) => tagMenuCreateWidgets(mem, SCREEN, SLOT, host));
    }
});

test("tagMenuFillRows matches F0x800972C8", () => {
    const rt = runtime();
    const base = { state: 1, party: PARTY, count: 2, candidates: [1, 2] };
    for (const c of [
        { name: "rows", ...base },
        { name: "rows with a dead partner", ...base, candidates: [2, 1] },
        { name: "one row", ...base, count: 1, candidates: [1, 2] },
        { name: "no row", ...base, count: 0 },
    ]) {
        runBoth(rt, 0x800972c8, c, (mem, host) => tagMenuFillRows(mem, SCREEN, SLOT, host));
    }
});

test("tagMenuPanels matches F0x80096FE4", () => {
    const rt = runtime();
    for (const c of [
        { name: "both panels", count: 2, panelOk: [5, 6] },
        { name: "one panel", count: 2, panelOk: [0, 6] },
        { name: "no panels", count: 2, panelOk: [0, 0] },
        { name: "no rows", count: 0 },
    ]) {
        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x80096fe4, [SCREEN], 40000);
        const olog = LOG.slice();
        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        tagMenuPanels(rt.mem, SCREEN, portHost(rt));
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
    }
});

test("tagCompatible matches F0x80096EC8", () => {
    const rt = runtime();
    for (const c of [
        { name: "in the list", compatList: [7, 9], profileId: 7, matchByte: 5 },
        { name: "not in the list", compatList: [1, 2], profileId: 7, matchByte: 5 },
        { name: "empty list", compatList: [], profileId: 7, matchByte: 5 },
        { name: "no match byte", compatList: [7], profileId: 7, matchByte: 0 },
        { name: "second entry", compatList: [7, 9, 11], profileId: 11, matchByte: 3 },
    ]) {
        seedScreen(rt, { state: 0, count: 0 });
        seedData(rt, c);
        LOG.length = 0;
        const oret = rt.cpu.call(0x80096ec8, [SCREEN, 0, 1], 40000) | 0;
        const olog = LOG.slice();

        seedScreen(rt, { state: 0, count: 0 });
        seedData(rt, c);
        LOG.length = 0;
        const pret = tagCompatible(rt.mem, SCREEN, 0, 1, portHost(rt));
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.equal(pret, oret, `${c.name}: result`);
    }
});