// The TECH menu's list words and their flags — FIGHTSTG_F0x800967A0's build.
//
// The port's caller (web/battle.js battleTechWords) hands it the list the disc
// builds: the current form's own slots with bit 14 cleared, the sibling loans
// with bit 14 kept, and (while Blast is active) the current form's signature
// marked or appended with bit 15. The build must carry those words into the
// list at +0x9C unchanged, and its Blast step must MARK an existing entry
// rather than appending a duplicate (`.L0x80096878`: the entry is rewritten as
// id | 0x8000).
//
// Fail-before: the port cleared bit 14 on every entry (`& TECH_CLEAR_FLAGS`) and
// appended a duplicate signature in the Blast branch's match case.
import test from "node:test";
import assert from "node:assert/strict";
import {
    techListBuild, TECH_FLAG_LOADED, TECH_FLAG_PRESELECTED, TECH_ID_MASK,
    TECH_LIST_COUNT, TECH_LIST_ENTRIES, TECH_LIST_ENTRY_STRIDE,
    TECH_LIST_PAGE_FILL, TECH_LIST_PAGE_STRIDE,
    TECH_PARTY_BASE, TECH_PARTY_INDEX, TECH_PARTY_NO_CHARGE, TECH_PARTY_TECH_COUNT,
    TECH_PARTY_STRIDE,
} from "../engine/dw3/ui/native/battle-tech-menu.ts";

const BASE = 0x80000000;
class Mem {
    constructor() { this.bytes = new Uint8Array(0x2000000); }
    a(addr) { return (addr - BASE) >>> 0; }
    read8(addr) { return this.bytes[this.a(addr)]; }
    read16(addr) { const i = this.a(addr); return this.bytes[i] | (this.bytes[i + 1] << 8); }
    read16s(addr) { return (this.read16(addr) << 16) >> 16; }
    read32(addr) {
        const i = this.a(addr);
        return (this.bytes[i] | (this.bytes[i + 1] << 8) | (this.bytes[i + 2] << 16) | (this.bytes[i + 3] << 24)) >>> 0;
    }
    write8(addr, v) { this.bytes[this.a(addr)] = v & 0xff; }
    write16(addr, v) { const i = this.a(addr); this.bytes[i] = v & 0xff; this.bytes[i + 1] = (v >> 8) & 0xff; }
    write32(addr, v) {
        const i = this.a(addr);
        this.bytes[i] = v & 0xff; this.bytes[i + 1] = (v >> 8) & 0xff;
        this.bytes[i + 2] = (v >> 16) & 0xff; this.bytes[i + 3] = (v >> 24) & 0xff;
    }
}

const SCREEN = 0x80100000;
const SLOT = 0x80100100;
const MODEL = 0x80100200;
const WIDGETS = 0x80101000;
const PRESELECT = 0x80102000;
const PAGE_WORDS = [];

function build({ techCount = 3, noCharge = 0, pages = 1, pageWords = [], preselect = false } = {}) {
    const mem = new Mem();
    mem.write32(TECH_PARTY_INDEX, 0);
    const party = TECH_PARTY_BASE;
    mem.write16(party + TECH_PARTY_TECH_COUNT, techCount & 0xffff);
    mem.write8(party + TECH_PARTY_NO_CHARGE, noCharge & 0xff);
    mem.write16(PRESELECT + 0x28, 0x2a);
    PAGE_WORDS.length = 0;
    PAGE_WORDS.push(...pageWords);
    let widgets = 0;
    const host = {
        mem,
        activeMember: () => 0,
        techListBegin: () => pages,
        techListPage: (_member, _header, dest) => {
            mem.write16(dest, techCount & 0xffff);
            for (let i = 0; i < 6; i++) mem.write16(dest + 8 + i * 2, PAGE_WORDS[i] ?? 0);
        },
        preselectRecord: () => (preselect ? PRESELECT : null),
        techCost: () => 0,
        createModel: () => MODEL,
        createTextElement: () => { widgets += 1; return WIDGETS + widgets * 0x100; },
        resourceBase: () => 0,
        callMethod: () => {},
    };
    techListBuild(mem, SCREEN, SLOT, host);
    const count = mem.read32(SCREEN + TECH_LIST_COUNT) | 0;
    const entries = [];
    for (let i = 0; i < count; i++) entries.push(mem.read32(SCREEN + TECH_LIST_ENTRIES + i * TECH_LIST_ENTRY_STRIDE) | 0);
    return entries;
}

test("the TECH list keeps a loan's 0x4000 and the current form's cleared word", () => {
    // What battleTechWords hands over for a digivolved form: its own slots with
    // bit 14 cleared, then a sibling's loaned word with the flag.
    const entries = build({ pageWords: [0x2069, 0x006b, 0x406c, 0, 0, 0] });
    assert.deepEqual(entries, [0x2069, 0x006b, 0x406c]);
    assert.equal(entries[2] & TECH_FLAG_LOADED, TECH_FLAG_LOADED,
        "the loan keeps bit 14 — the row palette and the price rule read it");
});

test("blast active marks an existing signature entry instead of duplicating it", () => {
    const entries = build({ noCharge: 1, preselect: true, pageWords: [0x2069, 0x002a, 0, 0, 0, 0] });
    assert.deepEqual(entries, [0x2069, 0x802a],
        "the signature entry is rewritten as id | 0x8000, not appended again");
    assert.equal(entries[1] & TECH_ID_MASK, 0x2a);
});

test("blast active appends the signature when the list does not carry it", () => {
    const entries = build({ noCharge: 1, preselect: true, pageWords: [0x2069, 0, 0, 0, 0, 0] });
    assert.deepEqual(entries, [0x2069, 0x802a]);
    assert.equal(entries[1] & TECH_FLAG_PRESELECTED, TECH_FLAG_PRESELECTED);
});

test("without the blast flag nothing is appended", () => {
    assert.deepEqual(build({ pageWords: [0x2069, 0x002a, 0, 0, 0, 0] }), [0x2069, 0x002a]);
});
