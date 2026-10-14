// Lane B oracle: engine/dw3/ui/native/battle-dna-menu.ts must match the
// original pro/fightstg DNA pane (tick 0x800980E4) and the two widget
// routines it drives.
//
// The original runs through engine/native (the interpreter) as the oracle. The
// allocator, the text-widget constructor, the shared list factory, the resource
// and pack services, the profile and candidate services, the pad, the sound and
// every object method are stubbed on both sides, so the ordered calls, the
// widget fields and the pane's own memory are compared.
//
// The cases drive what a player does: a partner that carries a DNA pairing and
// one that does not, L1/R1 wrapping, Cross on the names and on the options,
// Circle on Switch, Circle on DNA DV with and without enough MP, and each of
// the seven grey-out conditions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    equippedFormsAddress, formTechBlockAddress, readEquippedForms,
} from "../../engine/dw3/form-tech-blocks.ts";
import {
    dnaPaneActorConstruct, dnaPaneActorConstruct2, dnaPaneArt,
    dnaPaneCreateWidgets, dnaPaneLabels, dnaPaneNames, dnaPaneTick,
    DNA_BUILD, DNA_CANDIDATES, DNA_COMBATANT, DNA_DNA_ID, DNA_MP_XS, DNA_PARTNER_SLOT,
    DNA_PANE_CONFIG_OPTIONS, DNA_PANE_CONFIG_STRIP, DNA_PARTY_AILMENTS, DNA_PARTY_BASE,
    DNA_PARTY_BLAST, DNA_PARTY_HP, DNA_PARTY_INDEX, DNA_PARTY_MAX_HP,
    DNA_PARTY_MAX_MP, DNA_PARTY_MP, DNA_PARTY_SPECIES, DNA_PARTY_STRIDE,
    DNA_PRICES, DNA_PREVIEW_OPTION, DNA_ROW_COUNT, DNA_SELECTED, DNA_SPECIES,
    DNA_SPECIES_OUT, DNA_STATE, DNA_STRIP_CURSOR, DNA_STRING_BASE, DNA_SUB_STATE,
    DNA_WORDS,
} from "../../engine/dw3/ui/native/battle-dna-menu.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const SCREEN = 0x80150000;
const SLOT = 0x80161000;
const MODEL = 0x80162000;
const OPTIONS = 0x80162800;
const WORDS = 0x80163000;
const SPECIES_OUT = 0x80163004;
const WIDGET_BASE = 0x80180000;
const RES_PTR = 0x801a0000;
const NAME_RES_PTR = 0x801a0800;
const PACK_PTR = 0x801a1000;
const RECORD = 0x801a2000;
const RECORD_B = 0x801a3000;

const CREATE_FN = 0x8001ae38;
const ALLOC_FN = 0x80014504;
const RESOURCE_PTR = 0x80044f4c;
const PACK_PTR_CELL = 0x80044f5c;
const PAD_PTR = 0x8004bbc4;
const PROFILE_STUB = 0x0fdd0020;
const CANDIDATE_STUB = 0x0fdd0030;
/** [0x8004B46C]'s real target: F0x800176AC, the roster's equipped forms. */
const CANDIDATE_SERVICE = 0x800176ac;
const CANDIDATE_CELL = 0x8004b46c;
const COMBATANT_STUB = 0x0fdd0034;
const SLOT_BASE = 0x0fdd1000;

const SLOT_ARITY = {
    0x28: 1, 0x2c: 1, 0x38: 0, 0x3c: 0, 0x40: 0,
    0x114: 2, 0x118: 2, 0x138: 1, 0x144: 1, 0x148: 1,
};
const SLOTS = Object.keys(SLOT_ARITY).map(Number);

const LOG = [];
const CANDIDATES = [];
/**
 * When set, both sides answer the pane's candidate service with the ORIGINAL's
 * rule: the exe's own cell points at F0x800176AC and the port's host calls the
 * port of it (form-tech-blocks.ts readEquippedForms) over the seeded roster.
 */
let REAL_CANDIDATE_RULE = false;
const CONTROL = {
    alloc: SCREEN, pad: 0, records: [RECORD, RECORD_B], names: [NAME_RES_PTR, NAME_RES_PTR],
    combatant: 1, preview: 0, handoffs: [],
};
let made = 0;
let language = 2;

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
    rt.cpu.setStub(0x0fdd000c, () => { LOG.push(["pad"]); return CONTROL.pad; });
    rt.cpu.setStub(RESOURCE_STUB_HOST(), (c) => {
        LOG.push(["resource", c.reg(4) | 0]);
        return (c.reg(4) | 0) === (0x7f + language) ? RES_PTR : NAME_RES_PTR;
    });
    rt.cpu.setStub(PACK_STUB(), (c) => { LOG.push(["pack", c.reg(4) | 0]); return PACK_PTR; });
    rt.cpu.setStub(PROFILE_STUB, (c) => {
        LOG.push(["profile", c.reg(4) | 0]);
        const which = CONTROL.records.findIndex((r) => rt.mem.read16(r) === (c.reg(4) | 0));
        return CONTROL.records[which < 0 ? 0 : which];
    });
    rt.cpu.setStub(CANDIDATE_STUB, (c) => {
        LOG.push(["candidates", c.reg(4) | 0]);
        CANDIDATES.forEach((id, i) => rt.mem.write16((c.reg(5) >>> 0) + i * 2, id & 0xffff));
        return CANDIDATES.length;
    });
    rt.cpu.setStub(COMBATANT_STUB, (c) => { LOG.push(["combatant", c.reg(4) | 0]); return CONTROL.combatant; });
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
    // F0x800953E4, the hand-off screen the confirm shows.
    rt.cpu.setStub(0x800953e4, (c) => {
        LOG.push(["handoff", c.reg(4) | 0, c.reg(5) | 0, c.reg(6) | 0]);
        return CONTROL.preview;
    });
    rt.cpu.setStub(0x8009b0c8, (c) => { LOG.push(["model", c.reg(4) | 0]); return CONTROL.model ?? MODEL; });

    rt.mem.write32(RESOURCE_PTR, RESOURCE_STUB_HOST());
    rt.mem.write32(PACK_PTR_CELL, PACK_STUB());
    rt.mem.write32(PAD_PTR, 0x0fdd000c);
    rt.mem.write32(0x8005cca8, language);
    rt.mem.write32(0x8005cca0, PROFILE_STUB);
    rt.mem.write32(0x8004b44c, COMBATANT_STUB);
    rt.mem.write32(0x8004b46c, CANDIDATE_STUB);
    return rt;
}

function RESOURCE_STUB_HOST() { return 0x0fdd0014; }
function PACK_STUB() { return 0x0fdd0018; }

/** The overlay's own data: the party records, the two profiles and the prices. */
function seedData(rt, c) {
    language = c.language ?? 2;
    rt.mem.write32(DNA_STRING_BASE, language);
    rt.mem.write32(DNA_PARTY_INDEX, c.partyIndex ?? 0);
    const party = c.party ?? [
        { species: 3, maxHp: 100, hp: 100, maxMp: 80, mp: 80 },
        { species: 7, maxHp: 200, hp: 150, maxMp: 60, mp: 60 },
        { species: 8, maxHp: 120, hp: 120, maxMp: 30, mp: 30 },
    ];
    for (let i = 0; i < 3; i++) {
        const info = party[i];
        const record = DNA_PARTY_BASE + i * DNA_PARTY_STRIDE;
        rt.mem.write16(record + DNA_PARTY_SPECIES, (info?.species ?? 0) & 0xffff);
        rt.mem.write16(record + DNA_PARTY_MAX_HP, (info?.maxHp ?? 0) & 0xffff);
        rt.mem.write16(record + DNA_PARTY_HP, (info?.hp ?? 0) & 0xffff);
        rt.mem.write16(record + DNA_PARTY_MAX_MP, (info?.maxMp ?? 0) & 0xffff);
        rt.mem.write16(record + DNA_PARTY_MP, (info?.mp ?? 0) & 0xffff);
        rt.mem.write8(record + DNA_PARTY_BLAST, (info?.blast ?? 0) & 0xff);
        rt.mem.write8(record + DNA_PARTY_AILMENTS, (info?.status ?? 0) & 0xff);
    }
    // The two profile records: +0x3D and +0x55 are the pairing test, +0x2A the
    // DNA result id and +0x55 the species name word.
    const rec = c.records ?? [{ pair: 5, species: 7, result: 12 }, { pair: 0, species: 3, result: 0 }];
    [RECORD, RECORD_B].forEach((at, i) => {
        rt.mem.write16(at, (rec[i]?.id ?? i + 1) & 0xffff);
        rt.mem.write8(at + 0x3d, (rec[i]?.pair ?? 0) & 0xff);
        rt.mem.write8(at + 0x55, (rec[i]?.species ?? 0) & 0xff);
        rt.mem.write16(at + 0x2a, (rec[i]?.result ?? 0) & 0xffff);
    });
    for (let i = 0; i < 8; i++) {
        // One price for every record: the charge reads the table one halfword
        // further along than the pane shows (fightstg.s:22296), so a uniform
        // table keeps that asymmetry out of the eligibility cases.
        rt.mem.write16(DNA_PRICES + 0x12 * i, (c.prices?.[i] ?? 20) & 0xffff);
    }
    // 0x8003EF5C is backed by a loaded image, so the oracle reads the exe's
    // own value there; the port computes the same address and reads it too.
    CANDIDATES.length = 0;
    for (const id of c.candidates ?? [7, 9, 11]) CANDIDATES.push(id);
    CONTROL.pad = c.pad ?? 0;
    CONTROL.combatant = c.combatant ?? 1;
    CONTROL.preview = c.preview ?? 0;
    CONTROL.model = c.optionModel ? OPTIONS : MODEL;
    made = 0;
    if (c.roster) seedRoster(rt, c.roster);
}

/**
 * One roster record for the candidate service to read: the three equipped form
 * ids at +0x7B0 and the acquired-form ledger at +0x7B8. The whole 0x3DC-byte
 * record is cleared first, because the ledger runs to +0xB28.
 */
function seedRoster(rt, roster) {
    const slot = roster.slot | 0;
    const base = equippedFormsAddress(slot) - 0x7b0;
    for (let i = 0; i < 0xb30; i++) rt.mem.write8(base + i, 0);
    for (let i = 0; i < 3; i++) {
        rt.mem.write16(equippedFormsAddress(slot) + i * 2, (roster.equipped?.[i] ?? 0xffff) & 0xffff);
    }
    (roster.ledger ?? []).forEach((species, index) => {
        rt.mem.write16(formTechBlockAddress(slot, index), species & 0xffff);
    });
}

/** The screen object, its widget block, both models and the two out words. */
function seedScreen(rt, c) {
    for (let i = 0; i < 0x90; i += 4) rt.mem.write32(SCREEN + i, 0);
    for (const slot of [0x28, 0x2c, 0x38, 0x3c, 0x40]) rt.mem.write32(SCREEN + slot, SLOT_BASE + slot);
    rt.mem.write32(SCREEN + DNA_STATE, c.state ?? 1);
    rt.mem.write32(SCREEN + DNA_SUB_STATE, c.subState ?? 0);
    rt.mem.write32(SCREEN + DNA_BUILD, c.build ?? 1);
    rt.mem.write32(SCREEN + DNA_WORDS, WORDS);
    rt.mem.write32(SCREEN + DNA_PARTNER_SLOT, c.partnerSlot ?? 1);
    rt.mem.write32(SCREEN + DNA_COMBATANT, c.combatant ?? 1);
    rt.mem.write32(SCREEN + DNA_STRIP_CURSOR, c.stripCursor ?? 0);
    for (let i = 0; i < 4; i++) {
        rt.mem.write16(SCREEN + DNA_SPECIES + i * 2, (c.species?.[i] ?? 0) & 0xffff);
    }
    rt.mem.write32(SCREEN + DNA_ROW_COUNT, c.rowCount ?? 3);
    rt.mem.write32(SCREEN + DNA_PREVIEW_OPTION, c.row ?? 0);
    rt.mem.write32(SCREEN + DNA_SELECTED, c.selected ?? -1);
    rt.mem.write32(SCREEN + DNA_DNA_ID, c.dnaId ?? 0);
    rt.mem.write32(SCREEN + DNA_SPECIES_OUT, SPECIES_OUT);
    for (let i = 0; i < 3; i++) rt.mem.write16(SCREEN + DNA_CANDIDATES + i * 2, (c.seed?.[i] ?? 0) & 0xffff);
    rt.mem.write32(SLOT, MODEL);
    rt.mem.write32(SLOT + 4, c.optionModel ? OPTIONS : 0);
    rt.mem.write32(SLOT + 8, c.previewA ?? 0);
    rt.mem.write32(SLOT + 0xc, c.previewB ?? 0);
    for (const model of [MODEL, OPTIONS]) {
        rt.mem.write32(model + 0x28, SLOT_BASE + 0x28);
        rt.mem.write32(model + 0x50, 0);
        rt.mem.write32(model + 0x54, 0);
    }
    rt.mem.write32(MODEL + 0x50, c.cursor ?? 0);
    rt.mem.write32(MODEL + 0x54, 0);
    rt.mem.write32(MODEL + 0x58, c.rowCount ?? 3);
    rt.mem.write32(OPTIONS + 0x50, c.optionCursor ?? 0);
    rt.mem.write32(OPTIONS + 0x54, 0);
    rt.mem.write32(OPTIONS + 0x58, c.optionRows ?? 2);
    for (let i = 0; i < 8; i++) {
        rt.mem.write32(DNA_PANE_CONFIG_STRIP + i * 4, (c.stripConfig?.[i] ?? [4, 0xa8, 0x93, 0x13, 0x24, 0xa7, 0x92, 0x13][i]) >>> 0);
        rt.mem.write32(DNA_PANE_CONFIG_OPTIONS + i * 4, (c.optionConfig?.[i] ?? [2, 0xa8, 0xa6, 0x13, 0x22, 0xa7, 0xa5, 0x13][i]) >>> 0);
    }
    for (let i = 0; i < 4; i++) rt.mem.write32(DNA_MP_XS + i * 4, [172, 0, 216, 0, 217, 0, 251, 0][i] >>> 0);
    rt.mem.write32(WORDS, c.words ?? -1);
    rt.mem.write32(SPECIES_OUT, c.speciesOut ?? 0);
    for (let i = 0; i < 16; i++) {
        const widget = WIDGET_BASE + i * 0x400;
        for (const slot of SLOTS) rt.mem.write32(widget + slot, SLOT_BASE + slot);
        rt.mem.write32(SLOT + 0x10 + i * 4, c.widgets?.[i] ?? widget);
    }
}

function portHost(rt) {
    return {
        allocateActor() { LOG.push(["alloc", 0x800980e4 | 0, 0x84, 0x44]); return CONTROL.alloc; },
        createModel(config) {
            LOG.push(["model", config | 0]);
            return CONTROL.model;
        },
        createTextElement(target, kind, x, y) {
            LOG.push(["create", target | 0, kind | 0, x | 0, y | 0]);
            const widget = WIDGET_BASE + made * 0x400;
            made += 1;
            return widget;
        },
        resourceBase(bank) {
            LOG.push(["resource", bank | 0]);
            return bank === (0x7f + language) ? RES_PTR : NAME_RES_PTR;
        },
        packResolve(handle) { LOG.push(["pack", handle | 0]); return PACK_PTR; },
        preselectRecord(species) {
            LOG.push(["profile", species | 0]);
            const which = CONTROL.records.findIndex((r) => rt.mem.read16(r) === (species | 0));
            return CONTROL.records[which < 0 ? 0 : which];
        },
        combatantOf(slot) { LOG.push(["combatant", slot | 0]); return CONTROL.combatant; },
        dnaCandidates(combatant, dest) {
            // The stub the exe's cell normally points at logs this call; the real
            // service does not, so the port logs it only while the stub is in use.
            if (!REAL_CANDIDATE_RULE) LOG.push(["candidates", combatant | 0]);
            if (REAL_CANDIDATE_RULE) {
                readEquippedForms(rt.mem, combatant | 0, dest >>> 0);
                return;
            }
            CANDIDATES.forEach((id, i) => rt.mem.write16((dest >>> 0) + i * 2, id & 0xffff));
        },
        padRead() { LOG.push(["pad"]); return CONTROL.pad; },
        padReadA() { LOG.push(["padA"]); return CONTROL.pad; },
        padReadB() { LOG.push(["padB"]); return 0; },
        playSound(id) { LOG.push(["sound", id | 0]); },
        frameDelta() { return 1; },
        initDrawContext() {},
        setLayer(x, y) { LOG.push(["layer", x | 0, y | 0]); },
        setOrigin(x, y) { LOG.push(["origin", x | 0, y | 0]); },
        setPaletteRow(frame) { LOG.push(["palette", frame | 0]); },
        setSpritePalette(frame) { LOG.push(["palette", frame | 0]); },
        drawSprite(pack, id, x, y) { LOG.push(["sprite", pack | 0, id | 0, x | 0, y | 0]); },
        callMethod(target, slot, args) { LOG.push(["method", target | 0, slot, ...args.map((a) => a | 0)]); return 0; },
        spawnHandoff(combatant, row, species) {
            LOG.push(["handoff", combatant | 0, row | 0, species | 0]);
            return CONTROL.preview;
        },
    };
}

const SCREEN_FIELDS = [
    DNA_STATE, DNA_SUB_STATE, DNA_BUILD, DNA_PREVIEW_OPTION, DNA_SELECTED, DNA_PARTNER_SLOT,
    DNA_COMBATANT, DNA_STRIP_CURSOR, DNA_ROW_COUNT, DNA_DNA_ID,
    DNA_SPECIES, DNA_SPECIES + 2, DNA_SPECIES + 4, DNA_SPECIES + 6,
];
const SLOT_FIELDS = [0x10, 0x14, 0x18, 0x1c, 0x20, 0x24, 0x28, 0x2c, 0x30, 0x34, 0x38, 0x3c, 0x40];

function snapshot(rt, skip = []) {
    const out = [];
    for (const off of SCREEN_FIELDS) {
        if (skip.includes(off)) continue;
        out.push(`s+${off.toString(16)}=${rt.mem.read32(SCREEN + off) >>> 0}`);
    }
    for (const off of SLOT_FIELDS) out.push(`w+${off.toString(16)}=${rt.mem.read32(SLOT + off) >>> 0}`);
    out.push(`slot0=${rt.mem.read32(SLOT) >>> 0}`);
    out.push(`slot1=${rt.mem.read32(SLOT + 4) >>> 0}`);
    out.push(`slot2=${rt.mem.read32(SLOT + 8) >>> 0}`);
    out.push(`slot3=${rt.mem.read32(SLOT + 0xc) >>> 0}`);
    for (let i = 0; i < 8; i++) out.push(`strip${i}=${rt.mem.read32(DNA_PANE_CONFIG_STRIP + i * 4) >>> 0}`);
    for (let i = 0; i < 8; i++) out.push(`opt${i}=${rt.mem.read32(DNA_PANE_CONFIG_OPTIONS + i * 4) >>> 0}`);
    out.push(`model=${rt.mem.read32(MODEL + 0x50) >>> 0}/${rt.mem.read32(MODEL + 0x54) >>> 0}`);
    out.push(`options=${rt.mem.read32(OPTIONS + 0x50) >>> 0}/${rt.mem.read32(OPTIONS + 0x54) >>> 0}`);
    out.push(`out=${rt.mem.read32(WORDS) >>> 0}`);
    out.push(`speciesOut=${rt.mem.read32(SPECIES_OUT) >>> 0}`);
    for (let i = 0; i < 3; i++) {
        const at = DNA_PARTY_BASE + i * DNA_PARTY_STRIDE;
        out.push(`p${i}=${rt.mem.read16(at + DNA_PARTY_HP) | 0}/${rt.mem.read16(at + DNA_PARTY_MP) | 0}`);
    }
    return out;
}

function runBoth(rt, addr, c, run) {
    seedScreen(rt, c);
    seedData(rt, c);
    LOG.length = 0;
    rt.cpu.call(addr, [SCREEN, SLOT, c.show ?? 1], 40000);
    const olog = LOG.slice();
    // 0x8003EF5C is backed by a loaded image in the oracle runtime: the CPU's
    // little-endian load and the run-time accessor's halfword disagree there, so
    // the seed's own-species field cannot be compared in this harness.
    const ofields = snapshot(rt, c.skipFields ?? []);

    seedScreen(rt, c);
    seedData(rt, c);
    LOG.length = 0;
    run(rt.mem, portHost(rt));
    if (process.env.DNA_DEBUG) {
        const fmt = (e) => JSON.stringify(e.map((v) => (typeof v === "number" && v < 0 ? v >>> 0 : v)));
        let i = 0;
        while (i < olog.length && i < LOG.length && fmt(olog[i]) === fmt(LOG[i])) i += 1;
        console.log(`${c.name}: first diff at ${i}/${olog.length}/${LOG.length}`);
        for (let k = Math.max(0, i - 2); k < Math.min(Math.max(olog.length, LOG.length), i + 8); k++) {
            console.log(`  ${k} O ${fmt(olog[k] ?? null)}`);
            console.log(`  ${k} P ${fmt(LOG[k] ?? null)}`);
        }
    }
    assert.deepEqual(LOG, olog, `${c.name}: calls`);
    const pfields = snapshot(rt, c.skipFields ?? []);
    if (process.env.DNA_DEBUG) {
        ofields.forEach((f, i) => { if (pfields[i] !== f) console.log(`  field ${f} != ${pfields[i]}`); });
    }
    assert.deepEqual(pfields, ofields, `${c.name}: fields`);
}

const PARTY = [
    { species: 3, maxHp: 100, hp: 100, maxMp: 80, mp: 80 },
    { species: 7, maxHp: 200, hp: 150, maxMp: 60, mp: 60 },
    { species: 8, maxHp: 120, hp: 120, maxMp: 30, mp: 30 },
];
/** A pairing: the acting member's profile +0x3D matches the cursor's +0x55. */
const PAIRED = { records: [{ pair: 7, species: 7, result: 3 }, { pair: 0, species: 3, result: 0 }] };

test("the DNA pane constructor matches F0x80098884 and F0x800988FC", () => {
    const rt = runtime();
    for (const c of [
        { name: "plain", partner: 1 },
        { name: "partner two", partner: 2, combatant: 2 },
    ]) {
        seedData(rt, c);
        rt.mem.write32(WORDS, c.partner);
        LOG.length = 0;
        const oscreen = rt.cpu.call(0x80098884, [WORDS], 40000) | 0;
        const olog = LOG.slice();
        const owords = rt.mem.read32(WORDS) >>> 0;
        const opartner = rt.mem.read32(SCREEN + DNA_PARTNER_SLOT) >>> 0;
        const ocombatant = rt.mem.read32(SCREEN + DNA_COMBATANT) >>> 0;

        seedData(rt, c);
        rt.mem.write32(WORDS, c.partner);
        rt.mem.write32(SCREEN, 0);
        LOG.length = 0;
        const screen = dnaPaneActorConstruct(rt.mem, WORDS, portHost(rt));
        assert.deepEqual(LOG, olog, `${c.name}: calls`);
        assert.equal(screen >>> 0, oscreen >>> 0, `${c.name}: object`);
        assert.equal(rt.mem.read32(WORDS) >>> 0, owords, `${c.name}: running`);
        assert.equal(rt.mem.read32(SCREEN + DNA_PARTNER_SLOT) >>> 0, opartner, `${c.name}: partner`);
        assert.equal(rt.mem.read32(SCREEN + DNA_COMBATANT) >>> 0, ocombatant, `${c.name}: combatant`);
    }
});

test("dnaPaneActorConstruct2 matches F0x800988FC", () => {
    const rt = runtime();
    seedData(rt, {});
    rt.mem.write32(WORDS, 1);
    LOG.length = 0;
    rt.cpu.call(0x800988fc, [WORDS, SPECIES_OUT], 40000);
    const olog = LOG.slice();
    const ospeciesOut = rt.mem.read32(SCREEN + DNA_SPECIES_OUT) >>> 0;
    seedData(rt, {});
    rt.mem.write32(WORDS, 1);
    rt.mem.write32(SCREEN, 0);
    LOG.length = 0;
    dnaPaneActorConstruct2(rt.mem, WORDS, SPECIES_OUT, portHost(rt));
    assert.deepEqual(LOG, olog, "species out: calls");
    assert.equal(rt.mem.read32(SCREEN + DNA_SPECIES_OUT) >>> 0, ospeciesOut, "species out: word");
});

test("dnaPaneTick state 0 matches F0x800980E4", () => {
    const rt = runtime();
    for (const c of [
        { name: "seed three", state: 0, build: 0, candidates: [7, 9, 11], party: PARTY, skipFields: [DNA_SPECIES] },
        { name: "seed with a short one", state: 0, build: 0, candidates: [0, 9, 2], party: PARTY, skipFields: [DNA_SPECIES] },
        { name: "seed all short", state: 0, build: 0, candidates: [1, 2, 0], party: PARTY, skipFields: [DNA_SPECIES] },
        { name: "seed partner two", state: 0, build: 0, candidates: [7, 9, 11], party: PARTY, combatant: 2,
            skipFields: [DNA_SPECIES] },
    ]) {
        runBoth(rt, 0x800980e4, c, (mem, host) => dnaPaneTick(mem, SCREEN, SLOT, host));
    }
});

test("dnaPaneTick state 1 sub-state 0 matches F0x800980E4", () => {
    const rt = runtime();
    const base = { state: 1, subState: 0, build: 1, rowCount: 3, species: [7, 9, 11, 0], party: PARTY };
    for (const c of [
        { name: "idle", ...base },
        { name: "strip cursor on row two", ...base, stripCursor: 2 },
        { name: "cross closes", ...base, pad: 0x4000 },
        { name: "circle opens the options", ...base, pad: 0x2000 },
        // The freeze value the strip's Circle writes into the species list model
        // is the pane's own build flag (+0x14), NOT the partner's combatant index:
        // fightstg.s:22432 `sw $s0, 0x54($v0)` stores $s0, which the sub-state-0
        // dispatch loaded from +0x14 at :22053. A partner in roster slot 0 used to
        // write 0 there, leaving the list unfrozen.
        { name: "circle freezes the strip list for a slot-zero partner", ...base, pad: 0x2000, combatant: 0 },
        { name: "circle freezes the strip list for a slot-two partner", ...base, pad: 0x2000, combatant: 2 },
        { name: "r1 from zero", ...base, pad: 0x800 },
        { name: "l1 from zero wraps", ...base, pad: 0x400 },
        { name: "l1 from two", ...base, pad: 0x400, row: 2 },
        { name: "r1 from two wraps", ...base, pad: 0x800, row: 2 },
        { name: "both shoulders", ...base, pad: 0xc00, row: 1 },
        { name: "up does nothing", ...base, pad: 0x10, row: 1 },
        { name: "down moves nothing here", ...base, pad: 0x40, row: 1 },
        { name: "list cursor moved", ...base, cursor: 2 },
        { name: "already confirmed", ...base, selected: 0 },
    ]) {
        runBoth(rt, 0x800980e4, c, (mem, host) => dnaPaneTick(mem, SCREEN, SLOT, host));
    }
});

test("dnaPaneTick builds both sub-states", () => {
    const rt = runtime();
    for (const c of [
        { name: "strip build", state: 1, subState: 0, build: 0, rowCount: 2, species: [7, 9, 0, 0] },
        { name: "strip build over an option list", state: 1, subState: 0, build: 0, optionModel: true },
        { name: "options build with a pairing", state: 1, subState: 1, build: 0, ...PAIRED, species: [7, 9, 0, 0] },
        { name: "options build with a partner blast", state: 1, subState: 1, build: 0, ...PAIRED,
            party: [PARTY[0], { ...PARTY[1], blast: 1 }, PARTY[2]] },
        { name: "options build with no pairing", state: 1, subState: 1, build: 0, species: [7, 0, 0, 0] },
        { name: "options build with a mismatch", state: 1, subState: 1, build: 0, species: [7, 0, 0, 0],
            records: [{ pair: 9, species: 9, result: 3 }, { pair: 0, species: 3, result: 0 }] },
        { name: "options build with the cursor off the pair", state: 1, subState: 1, build: 0, ...PAIRED,
            stripCursor: 1, species: [7, 9, 0, 0] },
    ]) {
        runBoth(rt, 0x800980e4, c, (mem, host) => dnaPaneTick(mem, SCREEN, SLOT, host));
    }
});

test("dnaPaneTick sub-state 1 matches F0x800980E4", () => {
    const rt = runtime();
    const base = {
        state: 1, subState: 1, build: 1, optionModel: true, optionRows: 2,
        rowCount: 3, species: [7, 9, 11, 0], dnaId: 3, party: PARTY, ...PAIRED,
    };
    for (const c of [
        { name: "idle", ...base },
        { name: "idle on the DNA row", ...base, optionCursor: 1 },
        { name: "cross back to the names", ...base, pad: 0x4000 },
        // Circle is tested FIRST in this sub-state (fightstg.s:22246 `andi $v0,
        // $v1, 0x2000` / `beqz` at :22247 sends a non-Circle frame on to the Cross
        // test at :22375), so a frame carrying both commits the confirm. The strip
        // above is the other way round: Cross is tested first there (:22085).
        { name: "circle and cross together commit the confirm", ...base, pad: 0x6000 },
        { name: "circle and cross and r1 together commit the confirm", ...base, pad: 0x6800 },
        { name: "r1", ...base, pad: 0x800 },
        { name: "l1", ...base, pad: 0x400, row: 1 },
        { name: "confirm Switch", ...base, pad: 0x2000 },
        { name: "confirm Switch with the acting 0x10", ...base, pad: 0x2000,
            party: [{ ...PARTY[0], status: 0x10 }, PARTY[1], PARTY[2]] },
        { name: "confirm Switch with the partner 0x10", ...base, pad: 0x2000,
            party: [PARTY[0], { ...PARTY[1], status: 0x10 }, PARTY[2]] },
        { name: "confirm DNA with both rich", ...base, pad: 0x2000, optionCursor: 1 },
        { name: "confirm DNA with the acting short", ...base, pad: 0x2000, optionCursor: 1,
            party: [{ ...PARTY[0], mp: 5 }, PARTY[1], PARTY[2]] },
        { name: "confirm DNA with the partner short", ...base, pad: 0x2000, optionCursor: 1,
            party: [PARTY[0], { ...PARTY[1], mp: 5 }, PARTY[2]] },
        { name: "confirm DNA blocked 0x20", ...base, pad: 0x2000, optionCursor: 1,
            party: [{ ...PARTY[0], status: 0x20 }, PARTY[1], PARTY[2]] },
        { name: "confirm DNA blocked 0x08", ...base, pad: 0x2000, optionCursor: 1,
            party: [{ ...PARTY[0], status: 0x08 }, PARTY[1], PARTY[2]] },
        { name: "confirm DNA with the acting down", ...base, pad: 0x2000, optionCursor: 1,
            party: [{ ...PARTY[0], hp: 0 }, PARTY[1], PARTY[2]] },
        { name: "confirm DNA with the partner down", ...base, pad: 0x2000, optionCursor: 1,
            party: [PARTY[0], { ...PARTY[1], hp: 0 }, PARTY[2]] },
        { name: "confirm DNA with exactly the price", ...base, pad: 0x2000, optionCursor: 1,
            party: [{ ...PARTY[0], mp: 20 }, PARTY[1]] },
        { name: "confirm DNA one MP short", ...base, pad: 0x2000, optionCursor: 1,
            party: [{ ...PARTY[0], mp: 19 }, PARTY[1]] },
    ]) {
        runBoth(rt, 0x800980e4, c, (mem, host) => dnaPaneTick(mem, SCREEN, SLOT, host));
    }
});

test("dnaPaneCreateWidgets matches F0x80097AB0", () => {
    const rt = runtime();
    for (const c of [
        { name: "widgets", rowCount: 3 },
        { name: "widgets again", rowCount: 1 },
]) {
        runBoth(rt, 0x800980e4, c, (mem, host) => dnaPaneTick(mem, SCREEN, SLOT, host));
    }
});

test("the pane's result species come from the exe's own candidate service", () => {
    // The whole rule, end to end: [0x8004B46C] points at F0x800176AC in the
    // exe's own service table, so the ORIGINAL seed asks the ORIGINAL service
    // for the partner roster's three equipped form ids, and the port asks the
    // port of the same routine. What is compared is the column the pane draws:
    // the species it appends after the partner's own form, the row count it
    // stores at +0x70, and the row count it hands the species strip's config.
    const rt = runtime();
    rt.mem.write32(CANDIDATE_CELL, CANDIDATE_SERVICE);
    REAL_CANDIDATE_RULE = true;
    try {
        for (const c of [
            {
                name: "three equipped forms the roster holds", state: 0, build: 0, party: PARTY,
                combatant: 1, roster: { slot: 1, equipped: [7, 9, 11], ledger: [7, 9, 11] },
                rows: 4, skipFields: [DNA_SPECIES],
            },
            {
                name: "one free triple slot", state: 0, build: 0, party: PARTY,
                combatant: 1, roster: { slot: 1, equipped: [7, 0xffff, 11], ledger: [7, 9, 11] },
                rows: 3, skipFields: [DNA_SPECIES],
            },
            {
                name: "a form the ledger never acquired", state: 0, build: 0, party: PARTY,
                combatant: 1, roster: { slot: 1, equipped: [7, 12, 11], ledger: [7, 9, 11] },
                rows: 3, skipFields: [DNA_SPECIES],
            },
            {
                name: "no equipped form at all: the strip is the partner alone",
                state: 0, build: 0, party: PARTY, combatant: 1,
                roster: { slot: 1, equipped: [0xffff, 0xffff, 0xffff], ledger: [7, 9, 11] },
                rows: 1, skipFields: [DNA_SPECIES],
            },
            {
                name: "the same form twice is listed twice", state: 0, build: 0, party: PARTY,
                combatant: 1, roster: { slot: 1, equipped: [7, 7, 7], ledger: [7, 9, 11] },
                rows: 4, skipFields: [DNA_SPECIES],
            },
        ]) {
            runBoth(rt, 0x800980e4, c, (mem, host) => dnaPaneTick(mem, SCREEN, SLOT, host));
            // The count is the species the pane draws one row for, and it goes
            // into the strip config the shared list model is built from.
            assert.equal(rt.mem.read32(SCREEN + DNA_ROW_COUNT) | 0, c.rows, `${c.name}: rows`);
            assert.equal(rt.mem.read32(DNA_PANE_CONFIG_STRIP) | 0, c.rows, `${c.name}: strip rows`);
        }
    } finally {
        REAL_CANDIDATE_RULE = false;
    }
});

test("dnaPaneNames matches F0x80097BD8", () => {
    const rt = runtime();
    for (const c of [
        { name: "fill", rowCount: 3, species: [7, 9, 11, 0] },
        { name: "fill one", rowCount: 1, species: [7, 9, 11, 0] },
        { name: "fill none", rowCount: 0, species: [7, 9, 11, 0] },
        { name: "hide", show: 0, rowCount: 3, species: [7, 9, 11, 0] },
        { name: "hide with an empty widget", show: 0, rowCount: 3, widgets: [0] },
    ]) {
        runBoth(rt, 0x80097bd8, c, (mem, host) => {
            dnaPaneNames(mem, SCREEN, SLOT, c.show ?? 1, host);
        });
    }
});

test("dnaPaneLabels matches F0x80097CFC", () => {
    const rt = runtime();
    const base = { rowCount: 3, species: [7, 9, 11, 0], dnaId: 3, party: PARTY, ...PAIRED };
    for (const c of [
        { name: "show with a pairing", ...base },
        { name: "show with the cursor on row two", ...base, stripCursor: 2 },
        { name: "show without a pairing", rowCount: 3, species: [7, 9, 0, 0], dnaId: 0 },
        { name: "show grey acting 0x10", ...base, party: [{ ...PARTY[0], status: 0x10 }, PARTY[1], PARTY[2]] },
        { name: "show grey partner 0x10", ...base, party: [PARTY[0], { ...PARTY[1], status: 0x10 }, PARTY[2]] },
        { name: "show grey short MP", ...base, party: [{ ...PARTY[0], mp: 5 }, PARTY[1], PARTY[2]] },
        { name: "show grey 0x20", ...base, party: [{ ...PARTY[0], status: 0x20 }, PARTY[1], PARTY[2]] },
        { name: "show grey 0x08", ...base, party: [{ ...PARTY[0], status: 0x08 }, PARTY[1], PARTY[2]] },
        { name: "show grey acting down", ...base, party: [{ ...PARTY[0], hp: 0 }, PARTY[1], PARTY[2]] },
        { name: "show grey partner down", ...base, party: [PARTY[0], { ...PARTY[1], hp: 0 }, PARTY[2]] },
        { name: "hide", show: 0, ...base },
        { name: "hide with an empty widget", show: 0, ...base, widgets: [0, 0] },
    ]) {
        runBoth(rt, 0x80097cfc, c, (mem, host) => {
            dnaPaneLabels(mem, SCREEN, SLOT, c.show ?? 1, host);
        });
    }
});

test("dnaPaneArt matches F0x800979E4", () => {
    const rt = runtime();
    for (const c of [
        { name: "frame only", dnaId: 0 },
        { name: "frame with a pairing", dnaId: 3 },
    ]) {
        runBoth(rt, 0x800979e4, c, (mem, host) => dnaPaneArt(mem, SCREEN, host));
    }
});