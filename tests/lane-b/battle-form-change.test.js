// Lane B oracle: the ONE shared form-change routine
// (engine/dw3/battle-form-change.ts) must write exactly what the original
// pro/wfightmn commit writes.
//
// The original runs through engine/native (the interpreter) as the oracle: the
// turn loop's event-1 handler at file 0x19d4 = RAM 0x800A77B4, with its two
// callees 0x800A69F0 (the equipped-form flags) and 0x800A7328 (the
// reserved-second-form release) executed for real. Only the presentation
// (F0x8008A7F4) and the three resident services it calls through pointers
// ([0x800A4374], [0x8004B44C], [0x8004B46C]) are stubbed, on both sides. The
// interpreter and the port then run over the SAME memory image and every byte
// each of them wrote is compared.
//
// Two form changes are compared: the Digimon takes a form that is one of its
// equipped forms, and it takes one that is not, with and without a reserved
// second form standing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    commitManualDigivolve, formChangeRamView, formChangeCoreStats, markEquippedFormFlags,
    PARTY_ACTIVE_SLOT, PARTY_RECORD_BASE, PARTY_RECORD_STRIDE,
    FORM_FLAG_BASE, FORM_FLAG_STRIDE, FORM_FLAG_CHANGED, FORM_FLAG_EQUIPPED,
    FORM_GAUGE_BASE, FORM_GAUGE_STRIDE, FORM_GAUGE_OFFSET,
    TIMELINE_BASE, TIMELINE_STRIDE, ROSTER_PROFILE_BASE, ROSTER_PROFILE_STRIDE,
} from "../../engine/dw3/battle-form-change.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const wfight = new Uint8Array(readFileSync(join(dir, "pro_wfightmn.bin")));
const entry = { size: wfight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };
const BASE = 0x800a5de0;

const HANDLER = 0x800a77b4;      // file 0x19d4, index 1 of the table at 0x800AADF0
const PRESENT_FN = 0x8008a7f4;    // the change presentation, a stub on both sides
const TIMELINE_PTR = 0x800a3868 + 0xb0c;
const ROSTER_KEY_PTR = 0x8004b44c;
const ROSTER_FORMS_PTR = 0x8004b46c;

const TIMELINE_STUB = 0x0fdc0000;
const KEY_STUB = 0x0fdc0004;
const FORMS_STUB = 0x0fdc0008;


const TURN = 0x80150000;      // the turn loop's state object ($s1)
const CTX = 0x80160000;      // the battle context ($s2)
const SCREEN = 0x80170000;   // $s2 + 0x04, the class-0x0E screen holding +0x64

const LOG = [];
const CONTROL = { timeline: { 0x13: -1, 0x8: -1 }, key: 0x40, forms: [-1, -1, -1], species: 0 };

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 };
    const rt = new NativeStageRuntime(wfight, entry, host, undefined, undefined, BASE, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(PRESENT_FN, (c) => {
        LOG.push(["present", c.reg(4) | 0, c.reg(5) | 0]);
        return 0x80190000;
    });
    rt.cpu.setStub(TIMELINE_STUB, (c) => {
        LOG.push(["timeline", c.reg(4) | 0]);
        const kind = c.reg(4) | 0;
        return CONTROL.timeline[kind] ?? -1;
    });
    rt.cpu.setStub(KEY_STUB, (c) => { LOG.push(["rosterKey", c.reg(4) | 0]); return CONTROL.key; });
    rt.cpu.setStub(FORMS_STUB, (c) => {
        LOG.push(["rosterForms", c.reg(4) | 0]);
        const forms = CONTROL.forms;
        for (let i = 0; i < 3; i++) rt.mem.write16((c.reg(5) | 0) + i * 2, forms[i] & 0xffff);
        return forms.filter((id) => id > 0).length;
    });
    rt.mem.write32(TIMELINE_PTR, TIMELINE_STUB);
    rt.mem.write32(ROSTER_KEY_PTR, KEY_STUB);
    rt.mem.write32(ROSTER_FORMS_PTR, FORMS_STUB);
    return rt;
}

function seed(rt, c) {
    LOG.length = 0;
    for (let i = 0; i < 0x40; i += 4) rt.mem.write32(CTX + i, 0);
    for (let i = 0; i < 0x20; i += 4) rt.mem.write32(TURN + i, 0);
    for (let i = 0; i < 0x80; i += 4) rt.mem.write32(SCREEN + i, 0);
    rt.mem.write32(TURN + 0x14, c.phase ?? 0);
    rt.mem.write32(CTX + 0x04, SCREEN);
    rt.mem.write16(SCREEN + 0x64, c.species & 0xffff);
    rt.mem.write32(PARTY_ACTIVE_SLOT, c.slot ?? 0);
    for (let s = 0; s < 3; s++) {
        const record = PARTY_RECORD_BASE + s * PARTY_RECORD_STRIDE;
        for (let i = 0; i < 0x20; i += 4) rt.mem.write32(record + i, 0);
        rt.mem.write16(record + 0x00, (c.live?.[s] ?? 0x30) & 0xffff);
        rt.mem.write16(record + 0x02, (c.reserved?.[s] ?? 0x40) & 0xffff);
        rt.mem.write8(record + 0x1a, (c.hasReserved?.[s] ?? 0) & 0xff);
        for (let k = 0; k < 4; k++) {
            rt.mem.write8(FORM_FLAG_BASE + s * FORM_FLAG_STRIDE + k, (c.flags?.[s]?.[k] ?? 0) & 0xff);
        }
        rt.mem.write16(FORM_GAUGE_BASE + s * FORM_GAUGE_STRIDE + FORM_GAUGE_OFFSET, (c.gauge?.[s] ?? 40) & 0xffff);
    }
    for (let i = 0; i < 6; i++) {
        rt.mem.write16(TIMELINE_BASE + i * TIMELINE_STRIDE, (c.timeline?.[i] ?? 0x11) & 0xffff);
    }
    for (let k = 0; k < 0x58; k += 2) {
        rt.mem.write16(ROSTER_PROFILE_BASE + CONTROL.key * ROSTER_PROFILE_STRIDE + k, 0);
    }
    rt.mem.write16(ROSTER_PROFILE_BASE + CONTROL.key * ROSTER_PROFILE_STRIDE, c.rosterSpecies & 0xffff);
    CONTROL.timeline = c.timelineIndex ?? { 0x13: -1, 0x8: -1 };
    CONTROL.key = c.key ?? 0x40;
    CONTROL.forms = c.forms ?? [-1, -1, -1];
}

/** Every byte either side wrote: the combatant records, the flags, the gauge and
 *  the two timeline counters the release clears. */
function snapshot(rt, indexes) {
    const out = [];
    for (let s = 0; s < 3; s++) {
        const record = PARTY_RECORD_BASE + s * PARTY_RECORD_STRIDE;
        for (let i = 0; i < 0x20; i += 4) out.push(`rec${s}+${i.toString(16)}=${rt.mem.read32(record + i) >>> 0}`);
        for (let k = 0; k < 10; k++) {
            out.push(`flag${s}+${k}=${rt.mem.read8(FORM_FLAG_BASE + s * FORM_FLAG_STRIDE + k)}`);
        }
        out.push(`gauge${s}=${rt.mem.read16(FORM_GAUGE_BASE + s * FORM_GAUGE_STRIDE + FORM_GAUGE_OFFSET)}`);
    }
    for (const index of indexes) {
        out.push(`tl${index}=${rt.mem.read16(TIMELINE_BASE + index * TIMELINE_STRIDE)}`);
    }
    return out;
}

function services() {
    return {
        timelineIndex: (kind) => { LOG.push(["timeline", kind]); return CONTROL.timeline[kind] ?? -1; },
        rosterKey: (position) => { LOG.push(["rosterKey", position]); return CONTROL.key; },
        equippedForms: (key) => { LOG.push(["rosterForms", key]); return [...CONTROL.forms]; },
    };
}

/** Run both over the same memory image and compare every write. */
function runBoth(rt, c) {
    seed(rt, c);
    const indexes = [0, 1, 2, 3, 4, 5];
    rt.cpu.call(HANDLER, [TURN, CTX], 40000);
    // The presentation (F0x8008A7F4) and the turn counter belong to the caller of
    // the commit, not to it, so they are checked apart from the commit's own
    // service sequence.
    const present = LOG.findIndex((row) => row[0] === "present");
    const olog = LOG.slice(0, present === -1 ? LOG.length : present);
    const presentCall = present === -1 ? null : LOG[present];
    const ofields = snapshot(rt, indexes);
    // The commit's surroundings, which the port deliberately does not own: the
    // presentation object and the turn counter.
    const presentation = rt.mem.read32(CTX + 0x1c) >>> 0;
    const phase = rt.mem.read32(TURN + 0x14) >>> 0;

    seed(rt, c);
    LOG.length = 0;
    commitManualDigivolve(formChangeRamView(rt.mem, services()), c.species & 0xffff);
    assert.deepEqual(LOG, olog, `${c.name}: calls`);
    assert.deepEqual(snapshot(rt, indexes), ofields, `${c.name}: writes`);
    return { presentation, phase, presentCall };
}

test("commitManualDigivolve writes what the turn loop's event-1 handler writes", () => {
    const rt = runtime();
    for (const c of [
        {
            // The form taken is the first equipped one and differs from the
            // roster's own species: flag byte 6 and byte 7 both go to 1.
            name: "equipped first", species: 0x50, rosterSpecies: 0x30,
            live: [0x30, 0x40, 0x60], forms: [0x50, 0x60, -1], gauge: [40, 0, 0],
        },
        {
            // The second equipped row: byte 8 instead of byte 7.
            name: "equipped second", species: 0x60, rosterSpecies: 0x30,
            live: [0x30, 0x40, 0x60], forms: [0x50, 0x60, -1], gauge: [40, 0, 0],
        },
        {
            // Not an equipped form: only byte 6.
            name: "not equipped", species: 0x70, rosterSpecies: 0x30,
            live: [0x30, 0x40, 0x60], forms: [0x50, 0x60, -1], gauge: [40, 0, 0],
        },
        {
            // The roster is already in the form taken: the original's equal test
            // skips both lookups, so no equipped byte is written.
            name: "already the roster form", species: 0x30, rosterSpecies: 0x30,
            live: [0x30, 0x40, 0x60], forms: [0x50, 0x60, -1], gauge: [40, 0, 0],
        },
        {
            // No equipped forms at all: get_equipped answers 0 and the loop is
            // skipped (`.L0x00000cc0 blez`).
            name: "no equipped forms", species: 0x70, rosterSpecies: 0x30,
            live: [0x30, 0x40, 0x60], forms: [-1, -1, -1], gauge: [40, 0, 0],
        },
        {
            // A reserved second form is standing: the release runs, the gauge
            // goes to zero, the record's +0x02/flag are cleared and BOTH timeline
            // counters it names are zeroed.
            name: "reserved standing", species: 0x50, rosterSpecies: 0x30,
            live: [0x30, 0x40, 0x60], reserved: [0x30, 0x40, 0x60], hasReserved: [1, 0, 0],
            forms: [0x50, 0x60, -1], gauge: [55, 0, 0],
            timelineIndex: { 0x13: 2, 0x8: 4 },
        },
        {
            // The first lookup answers "none" and the second a real index.
            name: "reserved one index", species: 0x50, rosterSpecies: 0x30,
            live: [0x30, 0x40, 0x60], hasReserved: [1, 0, 0], forms: [0x50, -1, -1],
            gauge: [55, 0, 0], timelineIndex: { 0x13: -1, 0x8: 3 },
        },
        {
            // Nothing reserved: the release returns after its first lookup and
            // the gauge and the flag bytes stay as they were.
            name: "nothing reserved", species: 0x50, rosterSpecies: 0x30,
            live: [0x30, 0x40, 0x60], forms: [0x50, -1, -1], gauge: [55, 0, 0],
            timelineIndex: { 0x13: 1, 0x8: 2 },
        },
        {
            // The acting slot is the second party member.
            name: "second slot", species: 0x60, rosterSpecies: 0x30, slot: 1,
            live: [0x30, 0x40, 0x60], forms: [0x60, -1, -1], gauge: [0, 40, 0],
        },
    ]) {
        const { presentation, phase, presentCall } = runBoth(rt, c);
        assert.equal(phase, 1, `${c.name}: the turn steps on`);
        assert.equal(presentation, 0x80190000, `${c.name}: the presentation object is kept`);
        assert.deepEqual(presentCall, ["present", c.species, 0],
            `${c.name}: the change presentation takes the new form id and a1 = 0`);
    }
});

test("the commit stores no stat, HP, technique or ailment value", () => {
    const rt = runtime();
    const c = {
        name: "no stat writes", species: 0x50, rosterSpecies: 0x30,
        live: [0x30, 0x40, 0x60], forms: [0x50, 0x60, -1], gauge: [40, 0, 0],
    };
    seed(rt, c);
    // Fill the whole 0x20-byte combatant record with a pattern first: the
    // original must leave every byte of it alone except the form id.
    const record = PARTY_RECORD_BASE;
    const before = new Uint8Array(0x20);
    for (let i = 0; i < 0x20; i++) { rt.mem.write8(record + i, (i * 7 + 3) & 0xff); before[i] = rt.mem.read8(record + i); }
    rt.mem.write16(record + 0x00, 0x30);
    before[0] = 0x30; before[1] = 0x00;
    rt.cpu.call(HANDLER, [TURN, CTX], 40000);
    const changed = [];
    for (let i = 0; i < 0x20; i++) if (rt.mem.read8(record + i) !== before[i]) changed.push(i.toString(16));
    // Byte 0 is the form id's low byte; byte 0x1A is the reserved-second-form
    // flag, which the pattern left non-zero so the release has something to
    // clear. Every other byte of the record — including +0x04..+0x0B, where HP
    // and MP live — is untouched.
    assert.deepEqual(changed, ["0", "1a"], "only the form id and the reserved flag changed");
    assert.equal(rt.mem.read16(record), 0x50, "the record carries the form that was taken");
});

test("F0x8009EC94 adds the live form's core stats only when the form differs", () => {
    const base = { str: 40, def: 42, spt: 26, wis: 37, spd: 55 };
    assert.deepEqual(formChangeCoreStats(0x30, 0x30, base),
        { str: 0, def: 0, spt: 0, wis: 0, spd: 0 });
    assert.deepEqual(formChangeCoreStats(0x50, 0x30, base), base);
    // A record with no roster form (an enemy, or a battle that never changed
    // form) gets nothing, whatever the live id is.
    assert.deepEqual(formChangeCoreStats(0x50, undefined, base),
        { str: 0, def: 0, spt: 0, wis: 0, spd: 0 });
    assert.deepEqual(formChangeCoreStats(0x50, null, base),
        { str: 0, def: 0, spt: 0, wis: 0, spd: 0 });
    assert.deepEqual(formChangeCoreStats(0x50, 0x30, null),
        { str: 0, def: 0, spt: 0, wis: 0, spd: 0 });
});

test("the equipped-form scan stops on the first row that matches, as the original's jump does", () => {
    // 0x800A69F0's loop stores into byte 7+row and leaves the routine in the
    // delay slot of that store (`j 0x800a6afc`, wfightmn.s:840-841), so a second
    // equipped row carrying the same form is never marked. The jump target is
    // file 0x0D1C (wfightmn.s:846), the routine's own epilogue. The rule is
    // pinned here against the two stores and the jump.
    const flags = [];
    let equipped = [0x50, 0x50, 0x50];
    const view = {
        activeSlot: () => 1,
        liveFormId: () => 0x50,
        writeLiveFormId: () => {},
        reservedSecondForm: () => 0,
        reservedFormId: () => 0,
        clearReservedSecondForm: () => {},
        setFormFlag: (slot, k, value) => { flags.push([slot, k, value]); },
        clearFormGauge: () => {},
        findTimelineIndex: () => -1,
        clearTimelineCounter: () => {},
        rosterKey: () => 0x40,
        equippedForms: (_key, dest) => { dest.length = 0; for (const id of equipped) dest.push(id); return equipped.length; },
        rosterSpecies: () => 0x30,
    };
    markEquippedFormFlags(view, 0x50);
    assert.deepEqual(flags, [[1, FORM_FLAG_CHANGED, 1], [1, FORM_FLAG_EQUIPPED, 1]],
        "byte 6 and the FIRST matching row only");
    // The second row carries the form, and none of the rows does.
    flags.length = 0;
    equipped = [0x60, 0x50, 0x60];
    markEquippedFormFlags(view, 0x50);
    assert.deepEqual(flags, [[1, FORM_FLAG_CHANGED, 1], [1, FORM_FLAG_EQUIPPED + 1, 1]]);
    flags.length = 0;
    equipped = [0x60, 0x70, 0x60];
    markEquippedFormFlags(view, 0x50);
    assert.deepEqual(flags, [[1, FORM_FLAG_CHANGED, 1]]);
});