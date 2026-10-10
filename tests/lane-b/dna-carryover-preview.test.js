// Lane B oracle: the stat carry-over preview the in-battle DNA pane opens.
//
// engine/dw3/ui/native/battle-dna-menu.ts asks F0x800953E4 for a preview whenever
// the player turns the page with L1/R1 or moves the species cursor, and
// F0x800953E4 builds the same object the Digivolve form list shows: the panel
// F0x80014504(0x80094F08, 0xEC, 0x60) whose tick is 0x80094F08. This file runs
// the ORIGINAL constructor and the ORIGINAL panel tick through engine/native
// (the interpreter) as the oracle and the ported pair
// (formPanelConstruct + formPanelTick) beside them, so every draw call, every
// text call and every number the two produce are compared.
//
// The cases are what a player does on the DNA screen: two different species under
// the cursor, and two of the panel's three pages (page zero's two stat columns and
// page one's technique list), each with and without a cursor row.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import { dnaPaneTick } from "../../engine/dw3/ui/native/battle-dna-menu.ts";
import {
    formPanelConstruct, formPanelTick, FORM_LIST_CONFIG, FORM_PANEL_PAGE0_TABLE, FORM_SLOT_ROW,
} from "../../engine/dw3/ui/native/digivolve-form-menu.ts";
import {
    FORM_PARTY_BASE, FORM_PARTY_INDEX, FORM_PARTY_STRIDE, FORM_PROFILE_BLOCK, FORM_PROFILE_STRIDE,
} from "../../engine/dw3/ui/native/digivolve-form-menu.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

/** The DNA pane's own fields, so the tail asks for the preview the player asked for. */
const DNA_PAGE = 0x54;
const DNA_SELECTED = 0x58;
const DNA_COMBATANT = 0x60;
const DNA_STRIP_CURSOR = 0x64;
const DNA_SLOT_MODEL = 0x00;
const DNA_SLOT_PREVIEW_A = 0x08;
const DNA_SLOT_PREVIEW_B = 0x0c;

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


/**
 * One host carrying both screens' services: the DNA pane's own (pad, species
 * record, party reads, the two sounds) and the panel's (the roster helpers, the
 * page-zero block, the technique blocks). Every call goes on the same log, so the
 * two ticks are compared as one sequence.
 */
function portHost() {
    return {
        mem: null,
        // The DNA pane's factory (F0x80014504) and the panel's, both real.
        allocateActor() { LOG.push(["alloc", 0x800980e4 | 0, 0x84, 0x44]); return SCREEN; },
        allocatePanel() { LOG.push(["alloc", 0x80094f08 | 0, 0xec, 0x60]); return PANEL; },
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
        resourceBase(bank) { LOG.push(["resource", bank | 0]); return RES_PTR; },
        packResolve(handle) { LOG.push(["pack", handle | 0]); return PACK_PTR; },
        padRead() { LOG.push(["pad"]); return CONTROL.pad; },
        padReadA() { LOG.push(["padA"]); return CONTROL.pad; },
        padReadB() { LOG.push(["padB"]); return 0; },
        playSound(id) { LOG.push(["sound", id | 0]); },
        frameCounter() { LOG.push(["counter"]); return CONTROL.counter; },
        frameDelta() { return 1; },
        initDrawContext() {},
        setLayer(x, y) { LOG.push(["layer", x | 0, y | 0]); },
        setOrigin(x, y) { LOG.push(["origin", x | 0, y | 0]); },
        setPaletteRow(frame) { LOG.push(["palette", frame | 0]); },
        drawSprite(pack, id, x, y) { LOG.push(["sprite", pack | 0, id | 0, x | 0, y | 0]); },
        // The DNA pane's own two services.
        preselectRecord(species) { LOG.push(["species", species | 0]); return species === 0 ? 0 : SPECIES; },
        combatantOf() { return 0x40; },
        dnaCandidates(combatant, dest) {
            LOG.push(["candidates", combatant | 0]);
            (CONTROL.forms ?? []).slice(0, 3).forEach((id, i) =>
                this.mem.write16((dest >>> 0) + i * 2, id & 0xffff));
        },
        // The panel's roster helpers, the same three the form list's host uses.
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
        // The DNA pane's tail asks F0x800953E4 for the carry-over panel; the
        // original's call is not a stub, so neither is this one.
        spawnHandoff(profile, page, row) {
            return formPanelConstruct(this.mem, profile, page, row, this);
        },
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


// F0x800953E4 is a real call in the original, not a stub: it allocates the panel
// through F0x80014504, which the stub answers with CONTROL.panel.
function seedDna(rt, c) {
    seedScreen(rt, c);
    seedData(rt, c);
    rt.mem.write32(SCREEN + 0x10, c.subState ?? 1);
    rt.mem.write32(SCREEN + 0x14, c.build ?? 1);
    rt.mem.write32(SCREEN + DNA_PAGE, c.page ?? 0);
    rt.mem.write32(SCREEN + DNA_SELECTED, c.selected ?? -1);
    rt.mem.write32(SCREEN + DNA_COMBATANT, 0x40);
    rt.mem.write32(SCREEN + DNA_STRIP_CURSOR, c.stripCursor ?? 1);
    rt.mem.write32(SLOT + DNA_SLOT_MODEL, c.speciesModel ? MODEL : 0);
    rt.mem.write32(SLOT + DNA_SLOT_PREVIEW_A, 0);
    rt.mem.write32(SLOT + DNA_SLOT_PREVIEW_B, 0);
    // The pane's own text widgets, already built: the seed writes handles into the
    // child block, and both sides then fill the same ones.
    for (let i = 0; i < 16; i++) {
        const widget = WIDGET_BASE + 0x2000 + i * 0x100;
        for (const slot of [0x114, 0x118, 0x138, 0x144, 0x148]) rt.mem.write32(widget + slot, SLOT_BASE + slot);
        rt.mem.write32(SLOT + 0x10 + i * 4, widget);
    }
    for (let i = 0; i < 0x2c; i += 2) rt.mem.write16(PANEL + 0x64 + i, (c.panelBlock?.[i / 2] ?? 0) & 0xffff);
    // The panel the pane opens: F0x800953E4 stores the three numbers the tail
    // passes, and the page-zero numbers come from the roster block it copies.
    rt.mem.write32(PANEL + 0x54, 0x40);
    rt.mem.write32(PANEL + 0x58, c.page ?? 0);
    rt.mem.write32(PANEL + 0x5c, c.panelCursor ?? 1);
}

/** The pane's tick on both sides, then the panel's own tick on both sides. */
function runBoth(rt, c) {
    // Original: the pane's tail, then F0x800953E4, then the panel's tick.
    seedDna(rt, c);
    LOG.length = 0;
    rt.cpu.call(0x800980e4, [SCREEN, SLOT, 1], 40000);
    if (!LOG.some((e) => e[0] === "alloc" && (e[1] >>> 0) === 0x80094f08)) {
        assert.fail(`${c.name}: the original did not open the carry-over panel`);
    }
    rt.mem.write32(PANEL + 0x0c, 0);
    rt.cpu.call(0x80094f08, [PANEL, CHILDREN], 40000);
    const olog = LOG.slice();
    const ofields = snapshot(rt);

    // Port: the same tail, then the same panel through formPanelConstruct.
    seedDna(rt, c);
    LOG.length = 0;
    const host = portHost();
    host.mem = rt.mem;
    dnaPaneTick(rt.mem, SCREEN, SLOT, host);
    const opened = rt.mem.read32(SLOT + (rt.mem.read32(SLOT + DNA_SLOT_PREVIEW_A) !== 0
        ? DNA_SLOT_PREVIEW_A : DNA_SLOT_PREVIEW_B)) >>> 0;
    assert.notEqual(opened, 0, `${c.name}: the port did not open the carry-over panel`);
    rt.mem.write32(PANEL + 0x0c, 0);
    formPanelTick(rt.mem, PANEL, CHILDREN, host);
    if (process.env.DNAPREVIEW_DEBUG && JSON.stringify(LOG) !== JSON.stringify(olog)) {
        let k = 0;
        while (k < olog.length && k < LOG.length && JSON.stringify(olog[k]) === JSON.stringify(LOG[k])) k += 1;
        console.log(c.name, "first diff at", k, "of", olog.length, LOG.length);
        for (let i = Math.max(0, k - 3); i < Math.min(Math.max(olog.length, LOG.length), k + 10); i++) {
            console.log("  O", JSON.stringify(olog[i]), "P", JSON.stringify(LOG[i]));
        }
    }
    assert.deepEqual(LOG, olog, `${c.name}: calls`);
    assert.deepEqual(snapshot(rt), ofields, `${c.name}: fields`);
}

/** The overlay's own page-zero number table at 0x800A350C, thirteen (x, y, slot)
 *  triples read out of the shipped overlay — the same block the Digivolve form
 *  list walks, and the one this pane's panel reads. */
const TECH_TABLE = Array.from(
    fight.subarray(0x800a350c - 0x80082cb0, 0x800a350c - 0x80082cb0 + 40));

// Two species with different base stats, so page zero's six core and seven
// element sums differ between the rows the cursor can sit on.
const SPECIES_A = 0x30;
const SPECIES_B = 0x50;
const BLOCK_A = Array.from({ length: 22 }, (_, i) => (i === 19 ? 0x11 : (i === 20 ? 0x22 : 0x30 + i)));
const BLOCK_B = Array.from({ length: 22 }, (_, i) => (i === 19 ? 0 : (i === 20 ? 0x44 : 0x70 + i)));
const ROWS = [
    {
        state: 1, subState: 1, build: 1, optionModel: true, optionRows: 2,
        rowCount: 3, dnaId: 3, stripCursor: 1, speciesModel: false,
        forms: [SPECIES_A, SPECIES_B, 0x60, 0], blocks: [], panelCursor: 1,
        block: BLOCK_A, page: 0, selected: -1, counter: 0x10,
    },
    {
        state: 1, subState: 1, build: 1, optionModel: true, optionRows: 2,
        rowCount: 3, dnaId: 3, stripCursor: 1, speciesModel: false,
        forms: [SPECIES_A, SPECIES_B, 0x60, 0], blocks: [], panelCursor: 1,
        block: BLOCK_B, page: 0, selected: -1, counter: 0x10,
    },
    {
        state: 1, subState: 1, build: 1, optionModel: true, optionRows: 2,
        rowCount: 3, dnaId: 3, stripCursor: 2, speciesModel: false,
        forms: [SPECIES_A, SPECIES_B, 0x60, 0], blocks: [], panelCursor: 2,
        block: BLOCK_A, page: 0, selected: -1, counter: 0x10,
    },
    // Page one: the technique names and icons of the row under the cursor.
    {
        state: 1, subState: 1, build: 1, optionModel: true, optionRows: 2,
        rowCount: 3, dnaId: 3, stripCursor: 1, speciesModel: false,
        forms: [SPECIES_A, SPECIES_B, 0x60, 0], panelCursor: 1,
        block: BLOCK_A, page: 1, selected: -1, counter: 0x10,
        blocks: [
            { species: SPECIES_A, level: 7, techs: [0x8005, 0x4001, 0x4002, 0, 0, 0] },
            { species: SPECIES_B, level: 3, techs: [0x4010, 0x4021, 0, 0, 0, 0] },
            { species: 0x60, level: 5, techs: [0x4032, 0x4001, 0x4043, 0, 0, 0] },
        ],
    },
    {
        state: 1, subState: 1, build: 1, optionModel: true, optionRows: 2,
        rowCount: 3, dnaId: 3, stripCursor: 2, speciesModel: false,
        forms: [SPECIES_A, SPECIES_B, 0x60, 0], panelCursor: 2,
        block: BLOCK_B, page: 1, selected: -1, counter: 0x10,
        blocks: [
            { species: SPECIES_A, level: 7, techs: [0x8005, 0x4001, 0x4002, 0, 0, 0] },
            { species: SPECIES_B, level: 3, techs: [0x4010, 0x4021, 0, 0, 0, 0] },
            { species: 0x60, level: 5, techs: [0x4032, 0x4001, 0x4043, 0, 0, 0] },
        ],
    },
    // Page two: what the other equipped members share.
    {
        state: 1, subState: 1, build: 1, optionModel: true, optionRows: 2,
        rowCount: 3, dnaId: 3, stripCursor: 1, speciesModel: false,
        forms: [SPECIES_A, SPECIES_B, 0x60, 0], panelCursor: 1,
        block: BLOCK_A, page: 2, selected: -1, counter: 0x10,
        blocks: [
            { species: SPECIES_A, level: 7, techs: [0x8005, 0x4001, 0x4002, 0, 0, 0] },
            { species: SPECIES_B, level: 3, techs: [0x4010, 0x4021, 0, 0, 0, 0] },
            { species: 0x60, level: 5, techs: [0x4032, 0x4001, 0x4043, 0, 0, 0] },
        ],
    },
    // The page the player reaches by turning L1 twice from the first, and the
    // cursor row the species strip can hold: page zero with no row at all.
    {
        state: 1, subState: 1, build: 1, optionModel: true, optionRows: 2,
        rowCount: 3, dnaId: 3, stripCursor: 0, speciesModel: false,
        forms: [SPECIES_A, SPECIES_B, 0x60, 0], panelCursor: 0,
        block: BLOCK_A, page: 0, selected: -1, counter: 0x10,
    },
    // And the strip sub-state, where the species list is still alive and moving
    // the cursor is what re-asks for the preview.
    {
        state: 1, subState: 0, build: 1, optionModel: false,
        rowCount: 3, dnaId: 3, stripCursor: 0, speciesModel: true, cursor: 1,
        forms: [SPECIES_A, SPECIES_B, 0x60, 0], panelCursor: 1,
        block: BLOCK_A, page: 0, selected: -1, counter: 0x10,
        blocks: [
            { species: SPECIES_A, level: 7, techs: [0x8005, 0x4001, 0x4002, 0, 0, 0] },
            { species: SPECIES_B, level: 3, techs: [0x4010, 0x4021, 0, 0, 0, 0] },
        ],
    },
];

test("the DNA pane's carry-over preview matches F0x800953E4 and F0x80094F08", () => {
    const rt = runtime();
    for (const [i, row] of ROWS.entries()) {
        runBoth(rt, { name: `page ${row.page} cursor ${row.panelCursor} case ${i}`, table: TECH_TABLE, ...row });
    }
});

test("F0x800953E4 is the panel allocator the Digivolve form list also calls", () => {
    const rt = runtime();
    for (const c of [
        { name: "page zero row one", page: 0, panelCursor: 1, profile: 0x40 },
        { name: "page one row two", page: 1, panelCursor: 2, profile: 0x40 },
        { name: "page two row three", page: 2, panelCursor: 3, profile: 0x41 },
    ]) {
        seedData(rt, { ...c, table: TECH_TABLE, forms: [SPECIES_A, SPECIES_B, 0x60, 0],
            blocks: [{ species: SPECIES_A, level: 7, techs: [0x8005, 0x4001, 0, 0, 0, 0] }] });
        rt.mem.write32(PANEL, 0);
        LOG.length = 0;
        rt.cpu.call(0x800953e4, [c.profile, c.page, c.panelCursor], 40000);
        const olog = LOG.slice();
        const ofields = [0x54, 0x58, 0x5c].map((o) => rt.mem.read32(PANEL + o) >>> 0);

        rt.mem.write32(PANEL, 0);
        LOG.length = 0;
        const host = portHost();
        host.mem = rt.mem;
        const panel = formPanelConstruct(rt.mem, c.profile, c.page, c.panelCursor, host);
        assert.equal(panel >>> 0, PANEL, `${c.name}: object`);
        if (process.env.DNAPREVIEW_DEBUG && JSON.stringify(LOG) !== JSON.stringify(olog)) {
        let k = 0;
        while (k < olog.length && k < LOG.length && JSON.stringify(olog[k]) === JSON.stringify(LOG[k])) k += 1;
        console.log(c.name, "first diff at", k, "of", olog.length, LOG.length);
        for (let i = Math.max(0, k - 3); i < Math.min(Math.max(olog.length, LOG.length), k + 10); i++) {
            console.log("  O", JSON.stringify(olog[i]), "P", JSON.stringify(LOG[i]));
        }
    }
    assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.deepEqual([0x54, 0x58, 0x5c].map((o) => rt.mem.read32(PANEL + o) >>> 0), ofields,
            `${c.name}: fields`);
    }
});

test("the panel's page-zero number table is the extracted 0x800A350C block", () => {
    // The port reads the table the same way the original does, three bytes a row,
    // so a wrong stride or a wrong base would move every number on screen.
    const rt = runtime();
    const table = Array.from({ length: 40 }, (_, i) => i & 0xff);
    seedData(rt, { table, state: 1 });
    const first = [];
    for (let i = 0; i < 40; i++) first.push(rt.mem.read8(FORM_PANEL_PAGE0_TABLE + i));
    assert.deepEqual(first, table);
});
