// Lane B oracle: engine/dw3/ui/native/digivolve-form-menu.ts must match the
// original pro/fightstg Digivolve form list family.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// allocator, the text-widget constructor, the resource/pack services, the three
// resident profile helpers (0x8004B44C / 0x8004B46C / 0x8004B47C), the page-zero
// block helper (0x8004B468), the species-record lookup (0x8005CCA0), the pad, the
// frame counter, the sound and every object method are stubbed on both sides, so
// the ordered calls, the widget fields and the screen's own memory are compared.
//
// The cases drive what a player does: Down past the last row (the original
// clamps), Circle on the grey row the Digimon is already in (nothing happens),
// Circle on another row (the species id is answered and the list closes), both
// page keys at each end (they wrap over 0..2), and Cross.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    formListTick, formListUpdateRows, formPanelTick,
    FORM_LIST_CONFIG, FORM_PANEL_PAGE0_TABLE, FORM_PARTY_BASE, FORM_PARTY_INDEX, FORM_SLOT_ROW,
    FORM_PARTY_STRIDE, FORM_PROFILE_BLOCK, FORM_PROFILE_STRIDE,
} from "../../engine/dw3/ui/native/digivolve-form-menu.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
/** The overlay's own page-zero number table at 0x800A350C: thirteen (x, y, slot)
 *  triples, read out of the shipped overlay rather than written down, so a case
 *  cannot drift from the layout the screen really walks. The listing in
 *  ~/ddw3/asm/dw2003/pro/fightstg.s prints these words in the machine's own byte
 *  order, so no byte swap applies: the triples come out 60, 82, 6 / 126, 166, 18
 *  and the slot column is 6..18, the panel block's own six core and seven element
 *  sums. */
const FIGHT_BASE = 0x80082cb0;
const PAGE0_TABLE = Array.from(
    fight.subarray(FORM_PANEL_PAGE0_TABLE - FIGHT_BASE, FORM_PANEL_PAGE0_TABLE - FIGHT_BASE + 40));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SCREEN = 0x80150000;
const SLOT = 0x80161000;
const MODEL = 0x80162000;
const PANEL = 0x80163000;
const OUT = 0x80164000;
const WIDGET_BASE = 0x80180000;
const SPECIES = 0x80190000;
const CHILDREN = 0x80170000;

const CREATE_FN = 0x8001ae38;
const ALLOC_FN = 0x80014504;
const RESOURCE_PTR = 0x80044f4c;
const PACK_PTR_CELL = 0x80044f5c;
const PAD_PTR = 0x8004bbc4;
const COUNTER_PTR = 0x8004df98;

const ALLOC_STUB = 0x0fdd0000;
const PAD_STUB = 0x0fdd000c;
const RESOURCE_STUB = 0x0fdd0014;
const PACK_STUB = 0x0fdd0018;
const COUNTER_STUB = 0x0fdd001c;
const PROFILE_STUB = 0x0fdd0020;
const FORMS_STUB = 0x0fdd0024;
const TECHS_STUB = 0x0fdd0028;
const BLOCK_STUB = 0x0fdd002c;
const SPECIES_STUB = 0x0fdd0030;
const SLOT_BASE = 0x0fdd1000;

const SLOT_ARITY = { 0x28: 1, 0x38: 0, 0x3c: 0, 0x114: 2, 0x118: 2, 0x138: 1, 0x144: 1, 0x148: 1 };
const SLOTS = Object.keys(SLOT_ARITY).map(Number);

const LOG = [];
const CONTROL = { alloc: SCREEN, panel: PANEL, pad: 0, counter: 0, forms: [], block: [], blocks: new Map(), blockOrder: [] };
let made = 0;

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound(id) { LOG.push(["sound", id | 0]); } };
    const rt = new NativeStageRuntime(fight, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(ALLOC_FN, (c) => {
        // The panel allocator is the same entry with a different tick; hand out
        // the screen object for the screen and the panel address for the panel.
        LOG.push(["alloc", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]);
        // Three callers share the factory: the name list, the panel and the shared
        // list model F0x8009B0C8 builds. Each gets its own object address.
        const tick = c.reg(4) >>> 0;
        if (tick === 0x80094478) return CONTROL.alloc;
        if (tick === 0x80094f08) return CONTROL.panel;
        return MODEL;
    });
    rt.cpu.setStub(CREATE_FN, (c) => {
        LOG.push(["create", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]);
        const widget = WIDGET_BASE + made * 0x100;
        made += 1;
        for (const slot of [0x114, 0x118, 0x138, 0x144, 0x148]) rt.mem.write32(widget + slot, SLOT_BASE + slot);
        return widget;
    });
    rt.cpu.setStub(PAD_STUB, () => { LOG.push(["pad"]); return CONTROL.pad; });
    rt.cpu.setStub(RESOURCE_STUB, (c) => { LOG.push(["resource", c.reg(4) | 0]); return RES_PTR; });
    rt.cpu.setStub(PACK_STUB, (c) => { LOG.push(["pack", c.reg(4) | 0]); return PACK_PTR; });
    rt.cpu.setStub(COUNTER_STUB, () => { LOG.push(["counter"]); return CONTROL.counter; });
    rt.cpu.setStub(PROFILE_STUB, (c) => { LOG.push(["profile", c.reg(4) | 0]); return (c.reg(4) | 0) === 2 ? 0x40 : 0x40; });
    rt.cpu.setStub(FORMS_STUB, (c) => {
        LOG.push(["forms", c.reg(4) | 0, c.reg(5) | 0]);
        // F0x800176AC: the equipped id must resolve to a block, and the block's
        // own species halfword decides again. The tail of the triple is -1.
        const species = CONTROL.forms.filter((id) => id > 2);
        let n = 0;
        for (const id of species) {
            if (!CONTROL.blocks.has(id)) continue;
            rt.mem.write16((c.reg(5) | 0) + n * 2, CONTROL.blocks.get(id).species);
            n += 1;
        }
        while (n < 3) { rt.mem.write16((c.reg(5) | 0) + n * 2, 0xffff); n += 1; }
        return species.length;
    });
    rt.cpu.setStub(TECHS_STUB, (c) => {
        LOG.push(["techs", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]);
        // F0x80017A1C: find the block index, then copy all 0x14 bytes. A miss
        // leaves the destination untouched and answers -1.
        const block = CONTROL.blocks.get(c.reg(5) | 0);
        if (!block) return -1;
        const dest = c.reg(6) | 0;
        rt.mem.write16(dest + 0x00, block.species);
        rt.mem.write8(dest + 0x02, block.level);
        rt.mem.write32(dest + 0x04, block.dvexp >>> 0);
        for (let i = 0; i < 6; i++) rt.mem.write16(dest + 0x08 + i * 2, block.techs[i] & 0xffff);
        return CONTROL.blockOrder.indexOf(block.species);
    });
    rt.cpu.setStub(BLOCK_STUB, (c) => {
        LOG.push(["block", c.reg(4) | 0, c.reg(5) | 0]);
        CONTROL.block.forEach((value, i) => rt.mem.write16((c.reg(5) | 0) + i * 2, value & 0xffff));
        return 0;
    });
    rt.cpu.setStub(SPECIES_STUB, (c) => {
        const species = c.reg(4) | 0;
        LOG.push(["species", species]);
        return species === 0 ? 0 : SPECIES;
    });
    for (const slot of SLOTS) {
        rt.cpu.setStub(SLOT_BASE + slot, (c) => {
            const args = [];
            for (let i = 0; i < SLOT_ARITY[slot]; i++) args.push(c.reg(5 + i) | 0);
            LOG.push(["method", c.reg(4) | 0, slot, ...args]);
            return 0;
        });
    }
    rt.cpu.setStub(0x8001ecbc, (c) => { LOG.push(["origin", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed34, (c) => { LOG.push(["layer", c.reg(4) | 0, c.reg(5) | 0]); return 0; });
    rt.cpu.setStub(0x8001ecec, (c) => { LOG.push(["palette", c.reg(4) | 0]); return 0; });
    rt.cpu.setStub(0x8001ed6c, (c) => { LOG.push(["sprite", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0, c.reg(7) | 0]); return 0; });

    rt.mem.write32(RESOURCE_PTR, RESOURCE_STUB);
    rt.mem.write32(PACK_PTR_CELL, PACK_STUB);
    rt.mem.write32(PAD_PTR, PAD_STUB);
    rt.mem.write32(COUNTER_PTR, COUNTER_STUB);
    rt.mem.write32(0x8004b44c, PROFILE_STUB);
    rt.mem.write32(0x8004b46c, FORMS_STUB);
    rt.mem.write32(0x8004b47c, TECHS_STUB);
    rt.mem.write32(0x8004b468, BLOCK_STUB);
    rt.mem.write32(0x8005cca0, SPECIES_STUB);
    rt.mem.write32(0x8005cca8, 2);
    return rt;
}
const RES_PTR = 0x801a0000;
const PACK_PTR = 0x801a1000;

/** The overlay's own data: the config block, the party record and the profile table. */
function seedData(rt, c) {
    const config = c.config ?? [0, 0xa8, 0x93, 0x13, 0x24, 0xa7, 0x92, 0x13];
    for (let i = 0; i < 8; i++) rt.mem.write32(FORM_LIST_CONFIG + i * 4, config[i] | 0);
    for (let i = 0; i < 40; i++) rt.mem.write8(FORM_PANEL_PAGE0_TABLE + i, c.table?.[i] ?? 0);
    rt.mem.write32(FORM_PARTY_INDEX, c.activeIndex ?? 0);
    const party = FORM_PARTY_BASE + (c.activeIndex ?? 0) * FORM_PARTY_STRIDE;
    rt.mem.write16(party + 0x00, c.live ?? 0x30);
    rt.mem.write16(party + 0x02, c.reserved ?? 0x40);
    rt.mem.write8(party + 0x1a, c.hasReserved ?? 0);
    const block = FORM_PROFILE_BLOCK + 0x40 * FORM_PROFILE_STRIDE;
    rt.mem.write16(block + 0x00, c.current ?? 0x30);
    rt.mem.write16(block + 0x28, c.preselected ?? 0x11);
    CONTROL.alloc = SCREEN;
    CONTROL.panel = PANEL;
    CONTROL.pad = c.pad ?? 0;
    CONTROL.counter = c.counter ?? 0;
    CONTROL.forms = c.forms ?? [0x30, 0x50, 0, 0];
    CONTROL.block = c.block ?? [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0x50];
    // One technique block per form: the species, its level and six entry words.
    CONTROL.blocks = new Map((c.blocks ?? []).map((row) => [row.species, {
        species: row.species, level: row.level ?? 0, dvexp: row.dvexp ?? 0,
        techs: Array.from({ length: 6 }, (_, i) => (row.techs?.[i] ?? 0) & 0xffff),
    }]));
    CONTROL.blockOrder = (c.blocks ?? []).map((row) => row.species);
    made = 0;
}

/** The name-list object: its fields, the row widgets, the model and the panel. */
function seedScreen(rt, c) {
    for (let i = 0; i < 0x80; i += 4) rt.mem.write32(SCREEN + i, 0);
    rt.mem.write32(SCREEN + 0x0c, c.state ?? 1);
    rt.mem.write32(SCREEN + 0x28, SLOT_BASE + 0x28);
    rt.mem.write32(SCREEN + 0x38, SLOT_BASE + 0x38);
    rt.mem.write32(SCREEN + 0x50, OUT);
    rt.mem.write32(SCREEN + 0x54, 0x40);
    rt.mem.write32(SCREEN + 0x58, c.page ?? 0);
    rt.mem.write32(SCREEN + 0x5c, c.lastCursor ?? 0);
    rt.mem.write32(SCREEN + 0x68, c.count ?? 3);
    for (let i = 0; i < 3; i++) rt.mem.write16(SCREEN + 0x6c + i * 2, 0);
    for (let i = 0; i < 4; i++) rt.mem.write16(SCREEN + 0x60 + i * 2, (c.rows?.[i] ?? 0) | 0);
    // The child array: self+0x24 is its base address (base class F0x800143DC).
    const children = 0x80170000;
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(children + i, 0);
    rt.mem.write32(SCREEN + 0x24, children);
    rt.mem.write32(SLOT, MODEL);
    rt.mem.write32(SLOT + 0x14, c.slot5 ?? 0);
    rt.mem.write32(SLOT + 0x18, c.panelInSlot ?? 0);
    rt.mem.write32(MODEL + 0x50, c.cursor ?? 0);
    rt.mem.write32(MODEL + 0x54, 0);
    rt.mem.write32(MODEL + 0x58, c.rowsShown ?? 3);
    rt.mem.write32(OUT, c.outWord ?? 0xffffffff);
    for (let i = 0; i < 0x100; i += 4) rt.mem.write32(PANEL + i, 0);
    rt.mem.write32(PANEL + 0x0c, c.panelState ?? 0);
    rt.mem.write32(PANEL + 0x28, SLOT_BASE + 0x28);
    rt.mem.write32(PANEL + 0x38, SLOT_BASE + 0x38);
    rt.mem.write32(PANEL + 0x54, 0x40);
    rt.mem.write32(PANEL + 0x58, c.panelPage ?? 0);
    rt.mem.write32(PANEL + 0x5c, c.panelCursor ?? 0);
    for (let i = 0; i < 0x2c; i += 2) rt.mem.write16(PANEL + 0x64 + i, (c.block?.[i / 2] ?? 0) & 0xffff);
    // Four pre-built row widgets in the child array, so the updater reuses them.
    for (let i = 0; i < 4; i++) {
        const widget = WIDGET_BASE + i * 0x100;
        for (const slot of [0x114, 0x118, 0x138, 0x144, 0x148]) rt.mem.write32(widget + slot, SLOT_BASE + slot);
        rt.mem.write32(children + FORM_SLOT_ROW + i * 4, widget);
    }
}

function portHost() {
    return {
        allocateActor() { LOG.push(["alloc", 0x80094478 | 0, 0x74, 0x1c]); return CONTROL.alloc; },
        allocatePanel() { LOG.push(["alloc", 0x80094f08 | 0, 0xec, 0x60]); return CONTROL.panel; },
        // F0x8009B0C8 is the shared factory: it allocates the same 0xA8 list model
        // the command menu builds and copies the config block into it.
        createModel(config) {
            LOG.push(["alloc", 0x8009af4c | 0, 0xa8, 0]);
            return MODEL;
        },
        createTextElement(target, kind, x, y) {
            LOG.push(["create", target | 0, kind | 0, x | 0, y | 0]);
            const widget = WIDGET_BASE + made * 0x100;
            made += 1;
            return widget;
        },
        mem: null,
        resourceBase(bank) { LOG.push(["resource", bank | 0]); return RES_PTR; },
        packResolve(handle) { LOG.push(["pack", handle | 0]); return PACK_PTR; },
        padRead(port) { LOG.push(["pad"]); return CONTROL.pad; },
        padReadA(port) { LOG.push(["padA", port | 0]); return CONTROL.pad; },
        padReadB(port) { LOG.push(["padB", port | 0]); return 0; },
        playSound(id) { LOG.push(["sound", id | 0]); },
        frameCounter() { LOG.push(["counter"]); return CONTROL.counter; },
        initDrawContext() {},
        setLayer(x, y) { LOG.push(["layer", x | 0, y | 0]); },
        setOrigin(x, y) { LOG.push(["origin", x | 0, y | 0]); },
        drawSprite(pack, id, x, y) { LOG.push(["sprite", pack | 0, id | 0, x | 0, y | 0]); },
        profileForms(profile, dest) {
            LOG.push(["forms", profile | 0, dest | 0]);
            const species = CONTROL.forms.filter((id) => id > 2);
            let n = 0;
            for (const id of species) {
                const block = CONTROL.blocks.get(id);
                if (!block) continue;
                this.mem.write16(dest + n * 2, block.species);
                n += 1;
            }
            while (n < 3) { this.mem.write16(dest + n * 2, 0xffff); n += 1; }
            return species.length;
        },
        memberProfile(slot) { LOG.push(["profile", slot | 0]); return 0x40; },
        speciesRecord(species) { LOG.push(["species", species | 0]); return species === 0 ? 0 : SPECIES; },
        panelBlock(profile, dest) {
            LOG.push(["block", profile | 0, dest | 0]);
            CONTROL.block.forEach((value, i) => this.mem.write16(dest + i * 2, value & 0xffff));
        },
        profileTechs(profile, species, dest) {
            LOG.push(["techs", profile | 0, species | 0, dest | 0]);
            const block = CONTROL.blocks.get(species | 0);
            if (!block) return -1;
            this.mem.write16(dest + 0x00, block.species);
            this.mem.write8(dest + 0x02, block.level);
            this.mem.write32(dest + 0x04, block.dvexp >>> 0);
            for (let i = 0; i < 6; i++) this.mem.write16(dest + 0x08 + i * 2, block.techs[i] & 0xffff);
            return CONTROL.blockOrder.indexOf(block.species);
        },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); },
    };
}

const SCREEN_FIELDS = [0x0c, 0x50, 0x54, 0x58, 0x5c, 0x60, 0x62, 0x64, 0x66, 0x68];
const MODEL_FIELDS = [0x50, 0x54];
const PANEL_FIELDS = [0x54, 0x58, 0x5c, 0x60, 0xd4, 0xd8];

function snapshot(rt) {
    const out = [];
    for (const off of SCREEN_FIELDS) out.push(`s+${off.toString(16)}=${rt.mem.read32(SCREEN + off) >>> 0}`);
    for (let i = 0; i < 8; i++) out.push(`cfg${i}=${rt.mem.read32(FORM_LIST_CONFIG + i * 4) >>> 0}`);
    for (const off of MODEL_FIELDS) out.push(`m+${off.toString(16)}=${rt.mem.read32(MODEL + off) >>> 0}`);
    for (const off of PANEL_FIELDS) out.push(`p+${off.toString(16)}=${rt.mem.read32(PANEL + off) >>> 0}`);
    for (let i = 0; i < 13; i++) {
        out.push(`sum${i}=${rt.mem.read16(PANEL + 0x70 + i * 2)}`);
    }
    // Pages one and two: the equipped triple, every member's 0x14-byte technique
    // block and the six row words the draw reads.
    for (let i = 0; i < 3; i++) out.push(`eq${i}=${rt.mem.read16(PANEL + 0x90 + i * 2)}`);
    for (let m = 0; m < 3; m++) {
        for (let i = 0; i < 0x14; i += 2) out.push(`tb${m}_${i}=${rt.mem.read16(PANEL + 0x98 + 0x14 * m + i)}`);
    }
    for (let i = 0; i < 7; i++) out.push(`rw${i}=${rt.mem.read32(PANEL + 0xd4 + i * 4) >>> 0}`);
    for (let i = 0; i < 4; i++) out.push(`slot${i}=${rt.mem.read32(SLOT + i * 4) >>> 0}`);
    out.push(`out=${rt.mem.read32(OUT) >>> 0}`);
    return out;
}

function runBoth(rt, addr, args, c, run) {
    seedScreen(rt, c);
    seedData(rt, c);
    LOG.length = 0;
    rt.cpu.call(addr, args, 40000);
    const olog = LOG.slice();
    const ofields = snapshot(rt);

    seedScreen(rt, c);
    seedData(rt, c);
    LOG.length = 0;
    const port = portHost();
    port.mem = rt.mem;
    run(rt.mem, port);
    if (process.env.FORMPORT_DEBUG && JSON.stringify(LOG) !== JSON.stringify(olog)) {
        console.log("CASE", c.name);
        console.log("ORIG", JSON.stringify(olog));
        console.log("PORT", JSON.stringify(LOG));
    }
    assert.deepEqual(LOG, olog, `${c.name}: calls`);
    assert.deepEqual(snapshot(rt), ofields, `${c.name}: fields`);
}

test("formListTick state 1 matches F0x80094478", () => {
    const rt = runtime();
    const base = {
        state: 1, rows: [0x30, 0x50, 0x60], count: 3, cursor: 0, rowsShown: 3,
        live: 0x30, current: 0x30, forms: [0x30, 0x50, 0x60],
    };
    const cases = [
        { name: "idle", ...base },
        // Circle on the grey row: the confirm blip and nothing else.
        { name: "confirm current row", ...base, pad: 0x2000 },
        { name: "confirm current row cursor 1", ...base, pad: 0x2000, cursor: 1, lastCursor: 1 },
        // Circle on a row the Digimon is not in: the species id is answered.
        { name: "confirm other row", ...base, pad: 0x2000, cursor: 1, lastCursor: 1 },
        { name: "confirm other row two", ...base, pad: 0x2000, cursor: 2, lastCursor: 2 },
        // The live record's reserved second form is the grey one instead.
        { name: "confirm with reserved", ...base, pad: 0x2000, hasReserved: 1, reserved: 0x50 },
        // L1 and R1 wrap over the three pages.
        { name: "page next", ...base, pad: 0x800 },
        { name: "page next at two", ...base, pad: 0x800, page: 2 },
        { name: "page next at one", ...base, pad: 0x800, page: 1 },
        { name: "page prev", ...base, pad: 0x400, page: 1 },
        { name: "page prev at zero", ...base, pad: 0x400, page: 0 },
        // Cross answers -2 and closes.
        { name: "cancel", ...base, pad: 0x4000 },
        { name: "cancel and page", ...base, pad: 0x4000, page: 2 },
        // A cursor move alone rebuilds the panel.
        { name: "cursor moved", ...base, cursor: 1, lastCursor: 0 },
        { name: "cursor moved with old panel", ...base, cursor: 2, lastCursor: 1, panelInSlot: PANEL },
        // Nothing changes: the panel is left alone.
        { name: "no change", ...base, panelInSlot: PANEL },
    ];
    for (const c of cases) {
        runBoth(rt, 0x80094478, [SCREEN, SLOT], c, (mem, host) => formListTick(mem, SCREEN, SLOT, host));
    }
});

test("formListTick state 0 matches F0x80094478", () => {
    const rt = runtime();
    for (const c of [
        { name: "build three rows", state: 0, forms: [0x30, 0x50, 0x60, 0], current: 0x30 },
        { name: "build two rows", state: 0, forms: [0x30, 0x50, 0, 0], current: 0x30 },
        { name: "build one row", state: 0, forms: [0x30, 0, 0, 0], current: 0x30 },
        { name: "build no candidates", state: 0, forms: [0, 0, 0, 0], current: 0x30 },
        // A candidate below 3 is not offered.
        { name: "build small candidate", state: 0, forms: [0x30, 2, 0x50, 0], current: 0x30 },
        { name: "build four slots", state: 0, forms: [0x30, 0x50, 0x60, 0x70], current: 0x30 },
        { name: "build state 2", state: 2, forms: [0x30, 0x50], current: 0x30 },
        { name: "build state 3", state: 3, forms: [0x30, 0x50], current: 0x30 },
    ]) {
        runBoth(rt, 0x80094478, [SCREEN, SLOT], c, (mem, host) => formListTick(mem, SCREEN, SLOT, host));
    }
});

test("formListUpdateRows matches F0x80094298", () => {
    const rt = runtime();
    for (const c of [
        { name: "rows three", state: 1, count: 3, rows: [0x30, 0x50, 0x60], live: 0x30, current: 0x30 },
        { name: "rows grey second", state: 1, count: 3, rows: [0x30, 0x50, 0x60], live: 0x50, current: 0x30 },
        { name: "rows reserved grey", state: 1, count: 3, rows: [0x30, 0x50, 0x60], live: 0x60, hasReserved: 1, reserved: 0x60 },
        { name: "rows one", state: 1, count: 1, rows: [0x30, 0, 0, 0], live: 0x30 },
        { name: "rows none", state: 1, count: 0, rows: [0x30, 0, 0, 0], live: 0x30 },
        { name: "rows unknown species", state: 1, count: 3, rows: [0x30, 0, 0x60], live: 0x30 },
    ]) {
        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        rt.cpu.call(0x80094298, [SCREEN], 40000);
        const olog = LOG.slice();
        seedScreen(rt, c);
        seedData(rt, c);
        LOG.length = 0;
        formListUpdateRows(rt.mem, SCREEN, portHost());
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
    }
});

test("formPanelTick matches F0x80094F08", () => {
    const rt = runtime();
    const page0 = {
        panelState: 0, panelPage: 0, panelCursor: 1, forms: [0x30, 0x50, 0x60, 0],
        block: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2],
    };
    const table = PAGE0_TABLE;
    for (const c of [
        { name: "page zero build", ...page0, table, state: 0 },
        { name: "page zero row zero", ...page0, table, state: 0, panelCursor: 0 },
        { name: "page zero row three", ...page0, table, state: 0, panelCursor: 3 },
        { name: "page zero clamped", ...page0, table, state: 0, panelCursor: 900 },
        { name: "page zero draw", ...page0, table, panelState: 1, counter: 0x10 },
        { name: "page zero draw no arrows", ...page0, table, panelState: 2, counter: 0 },
        { name: "page one build", ...page0, table, state: 0, panelPage: 1 },
        { name: "page one row zero", ...page0, table, state: 0, panelPage: 1, panelCursor: 0 },
        { name: "page two draw", ...page0, table, panelState: 2, panelPage: 2 },
        { name: "page three build", ...page0, table, state: 0, panelPage: 3 },
        { name: "panel state 3", ...page0, table, panelState: 3 },
    ]) {
        runBoth(rt, 0x80094f08, [PANEL, CHILDREN], c, (mem, host) => formPanelTick(mem, PANEL, CHILDREN, host));
    }
});

// Pages one and two read the roster's per-species technique block. The block's
// level byte at +0x02 becomes the headline number, and its six entry words at
// +0x08 become the rows: page one lists the cursor row's own six, page two the
// loadable words every OTHER equipped member shares (bit 0x4000, deduped by the
// 13-bit id).
const TECH_TABLE = PAGE0_TABLE;
const techPage = {
    table: TECH_TABLE, state: 0, forms: [0x30, 0x50, 0x60, 0],
    block: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2],
    blocks: [
        { species: 0x30, level: 7, techs: [0x8005, 0x4001, 0x4002, 0, 0, 0] },
        { species: 0x50, level: 3, techs: [0x4010, 0x4021, 0, 0, 0, 0] },
        { species: 0x60, level: 5, techs: [0x4032, 0x4001, 0x4043, 0, 0, 0] },
    ],
};

test("panel page one lists the cursor row's own techniques", () => {
    const rt = runtime();
    for (const c of [
        { name: "page one cursor one", ...techPage, panelPage: 1, panelCursor: 1 },
        { name: "page one cursor two", ...techPage, panelPage: 1, panelCursor: 2 },
        { name: "page one cursor three", ...techPage, panelPage: 1, panelCursor: 3 },
        // The cursor's form has no block: the original leaves the destination
        // stale and still prints the headline from wherever it was.
        { name: "page one no block", ...techPage, panelPage: 1, panelCursor: 1,
            forms: [0x30, 0x70, 0x60, 0] },
        // A block whose six words are all zero draws the frame and no names.
        { name: "page one empty block", ...techPage, panelPage: 1, panelCursor: 1,
            blocks: [{ species: 0x30, level: 7 }, { species: 0x50, level: 3 }] },
    ]) {
        runBoth(rt, 0x80094f08, [PANEL, CHILDREN], c, (mem, host) => formPanelTick(mem, PANEL, CHILDREN, host));
    }
});

test("panel page two lists what the other members share", () => {
    const rt = runtime();
    for (const c of [
        // Cursor row 1: member 2's three loadable words, deduped against nothing.
        { name: "page two cursor one", ...techPage, panelPage: 2, panelCursor: 1 },
        // Cursor row 2: member 1's two words; 0x4001 repeats and is not listed twice.
        { name: "page two cursor two", ...techPage, panelPage: 2, panelCursor: 2 },
        // Cursor row 3: both other members, 0x4001 shared by all three.
        { name: "page two cursor three", ...techPage, panelPage: 2, panelCursor: 3 },
        // No cursor: page two's gather does not run at all.
        { name: "page two cursor zero", ...techPage, panelPage: 2, panelCursor: 0 },
        // A member whose block is missing contributes nothing.
        { name: "page two missing block", ...techPage, panelPage: 2, panelCursor: 1,
            forms: [0x30, 0x50, 0x70, 0] },
    ]) {
        runBoth(rt, 0x80094f08, [PANEL, CHILDREN], c, (mem, host) => formPanelTick(mem, PANEL, CHILDREN, host));
    }
});
// The captions. Page zero's two column words and the technique pages' "Skill"
// headline come from the in-battle message bank 0x7F, whose ids resolve through
// ~/ddw3/lang_file/dw2003/eng/esmfight.toml (word 0x11 = "L1", 0x12 = "R1",
// 0x19 = "Skill", 0x1A = the two-dash word the panel prints instead of a
// negative level). The routines below are run natively beside the port so the
// widget kind, the position and the palette are the original's, and the word
// table is checked against the extracted English strings.
test("page zero's captions are bank 0x7F words 0x11 and 0x12 at (34,171) and (56,171)", () => {
    const rt = runtime();
    const c = { ...techPage, table: TECH_TABLE, panelState: 0, panelPage: 0, panelCursor: 1 };
    seedScreen(rt, c);
    seedData(rt, c);
    LOG.length = 0;
    rt.cpu.call(0x8009492c, [PANEL, SLOT], 40000);
    const rows = LOG.filter((row) => row[0] === "create" || row[0] === "method");
    // Two kind-3 widgets at (0x22, 0xAB) and (0x38, 0xAB), each given its word
    // and palette 2, in that order.
    const first = WIDGET_BASE | 0, second = (WIDGET_BASE + 0x100) | 0;
    assert.deepEqual(rows, [
        ["create", 0x1005, 3, 0x22, 0xab],
        ["method", first, 0x114, RES_PTR | 0, 0x11],
        ["method", first, 0x138, 2],
        ["create", 0x1005, 3, 0x38, 0xab],
        ["method", second, 0x114, RES_PTR | 0, 0x12],
        ["method", second, 0x138, 2],
    ]);
});

test("the technique pages' caption is bank 0x7F word 0x19 and its number 0x1A when negative", () => {
    const rt = runtime();
    for (const c of [
        { name: "headline positive", ...techPage, table: TECH_TABLE, panelPage: 1, panelCursor: 1 },
        { name: "headline negative", ...techPage, table: TECH_TABLE, panelPage: 1, panelCursor: 0 },
    ]) {
        // The panel's +0x60 is what the draw branches on, so seed it the way the
        // gather would: the cursor row's own block level, or -1 for row zero.
        seedScreen(rt, c);
        seedData(rt, c);
        rt.mem.write32(PANEL + 0x60, c.panelCursor === 0 ? -1 : 3);
        LOG.length = 0;
        rt.cpu.call(0x80094d50, [PANEL, SLOT], 40000);
        const rows = LOG.filter((row) => row[0] === "create" || row[0] === "method");
        const head = rows.slice(0, 3);
        const cap = WIDGET_BASE | 0, num = (WIDGET_BASE + 0x100) | 0;
        assert.deepEqual(head, [
            ["create", 0x1005, 1, 0x5a, 0xa9],
            ["method", cap, 0x114, RES_PTR | 0, 0x19],
            ["create", 0x1005, 1, 0x93, 0xa9],
        ], `${c.name}: the caption and its number`);
        const tail = rows.slice(3, 4);
        if (c.panelCursor === 0) {
            assert.deepEqual(tail, [["method", num, 0x114, RES_PTR | 0, 0x1a]], `${c.name}: the dash word`);
        } else {
            assert.deepEqual(tail, [["method", num, 0x118, 0, 3]], `${c.name}: the level numeral`);
        }
        // Both numbers carry the right-to-left flag, and the caption carries
        // none: the caption is left in the palette the widget starts with.
        assert.deepEqual(rows[4], ["method", num, 0x148, 1], `${c.name}: the number's flag`);
    }
});

test("page zero's number table is the overlay's own thirteen (x, y, slot) triples", () => {
    // F0x80094AD0 walks the table three bytes a row (`lbu $a2,($s0)` / `lbu
    // $a3,0x1($s0)` / `lbu $v0,0x2($s0)`, `addiu $s0,0x3`, `slti $v0,$s2,0xd`),
    // so the layout is a fact about the disc and not something to type. Read out
    // of the shipped overlay it is a clean two-column grid: six numbers at x 60
    // and seven at x 126, rows 14 apart from y 82, and the slot column 6..18 —
    // which are the panel block's own six core and seven element sums
    // (panel+0x70 and +0x7C, read at panel+0x64+2*slot).
    const triples = Array.from({ length: 13 }, (_, i) => PAGE0_TABLE.slice(i * 3, i * 3 + 3));
    assert.deepEqual(triples.slice(0, 6), [
        [0x3c, 0x52, 6], [0x3c, 0x60, 7], [0x3c, 0x6e, 8],
        [0x3c, 0x7c, 9], [0x3c, 0x8a, 10], [0x3c, 0x98, 11]]);
    assert.deepEqual(triples.slice(6), [
        [0x7e, 0x52, 12], [0x7e, 0x60, 13], [0x7e, 0x6e, 14], [0x7e, 0x7c, 15],
        [0x7e, 0x8a, 16], [0x7e, 0x98, 17], [0x7e, 0xa6, 18]]);
    // The slot column has to be 6..18 in order or the numbers would read the wrong
    // halfwords; and the fortieth byte is never read (13 rows of three).
    assert.equal(PAGE0_TABLE.length, 40);
    assert.deepEqual(triples.map((t) => t[2]), Array.from({ length: 13 }, (_, i) => i + 6));
});

test("the caption words are the ones the English bank carries", () => {
    // tools/extract_battle_text.py writes the decoded English strings of bank
    // 0x7F (language 2) from ~/ddw3/lang_file/dw2003/eng/esmfight.toml and
    // refuses to write unless the entry count matches the shipped disc image.
    const bank = new Uint8Array(readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data/battlecmd/129.bin")));
    const esm = JSON.parse(readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/data/battlecmd/esmfight.json"),
        "utf8"));
    const view = new DataView(bank.buffer, bank.byteOffset, bank.byteLength);
    const count = view.getUint32(0, true);
    assert.equal(esm.strings.length, count, "the extracted table covers the bank");
    const words = esm.strings;
    assert.equal(words[0x11], "L1", "page zero's left caption is the L1 button");
    assert.equal(words[0x12], "R1", "page zero's right caption is the R1 button");
    assert.equal(words[0x19], "Skill", "the technique pages' caption is Skill");
    // Word 0x1A is what the panel prints where a level would be negative. On the disc
    // it is two of the same glyph byte: the index is `4 + 4*count` bytes of u32 offsets
    // (the first of which is the header's own end, so word 0 is the empty string), and
    // entry 0x1A's bytes are `e8 e8 00`. The extractor decodes each entry the way a TOML
    // basic string decodes -- a `\\uXXXX` becomes its character, raw UTF-8 is left alone,
    // the same reader tools/build_item_names.py uses -- so the JSON carries that glyph
    // pair as itself. It used to run a `unicode_escape` round trip instead, which turned
    // every `ー` and `・` in the bank (indices 0x0F, 0x17, 0x18, 0x1A, 0x24) into mojibake
    // that web/assets/ui/uifont.json holds no glyph for.
    const offsetOf = (index) => view.getUint32(4 + index * 4, true);
    const entry = (index) => {
        const start = offsetOf(index);
        let end = bank.length;
        for (let i = index + 1; i < count; i++) {
            const next = offsetOf(i);
            if (next > start) { end = next; break; }
        }
        return [...bank.subarray(start, end)];
    };
    assert.deepEqual(entry(0x1a).slice(0, 3), [0xe8, 0xe8, 0x00],
        "the disc's negative-level word is two of the same glyph");
    assert.equal(words[0x1a], "ーー",
        "the negative-level word is the pair of dashes the disc's glyph byte spells");
});
