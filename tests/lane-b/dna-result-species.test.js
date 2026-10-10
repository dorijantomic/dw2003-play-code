// Lane B oracle: the DNA result species the in-battle DNA pane lists.
//
// The pane is F0x800980E4 (pro/fightstg), and its state-0 seed
// (fightstg.s:21978-22003) fills the species strip from ONE resident service:
//
//   * [0x8004B46C](self+0x60, &self+0x74)   the cell at 0x8004B46C holds
//     0x800176AC (read out of the exe's own service table), so this is
//     F0x800176AC, the roster's three EQUIPPED form ids.
//   * self+0x68 = *(u16 *)(0x8003EF5C + 0x58*self+0x60)  the deployed Digimon's
//     own form, from the profile table, written first.
//   * the three halfwords the service wrote that are >= 3 follow it, packed at
//     self+0x6A/0x6C/0x6E, and the counter starts at 1, so self+0x70 counts the
//     own species too (fightstg.s:22013-22021).
//
// F0x800176AC itself (exe/fns.s:8095-8140) reads the roster record at
// 0x80048D34 + 0x3DC*slot: the three equipped ids at +0x7B0, and through
// F0x8001764C the 44 acquired-form blocks at +0x7B8 (0x14 bytes each, the search
// key at the block's own +0x00). An equipped id below 3 is a free triple slot, an
// id the ledger does not hold is dropped, the tail of the caller's buffer is
// padded with -1, and the answer is the kept count.
//
// This file runs the ORIGINAL service beside the port that both the pane and the
// carry-over preview now read (engine/dw3/form-tech-blocks.ts readEquippedForms)
// over the same seeded roster, comparing every halfword the service writes and
// the count it answers, across every partner pair the table can hold: three
// resolved forms, a free slot in each of the three positions, a repeated form, an
// id the ledger has never heard of, and the 44-block scan's own bound.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    EQUIPPED_FORMS_COUNT, equippedFormsAddress, findFormTechBlock, formTechBlockAddress,
    readEquippedForms, TECH_BLOCK_SIZE,
} from "../../engine/dw3/form-tech-blocks.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const entry = { size: 8, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

/** The service the pane's seed calls, and the matcher inside it. */
const SERVICE = 0x800176ac;
const MATCHER = 0x8001764c;
/** The caller's buffer, clear of the roster the seeds write. */
const DEST = 0x80170000;
const DEST_ALT = 0x80171000;

// The species ids are the game's own, taken out of the profile table the pane's
// own-species read comes from: 0x8003EF5C, one 0x58-byte row per form, its first
// halfword the form id. So every case names a real form rather than a made-up
// number (the walker's digimon.json is keyed by its own ids, not these).
const SPECIES = [];
for (let row = 0; row < 55 && SPECIES.length < 16; row++) {
    const id = (resident[0x8003ef5c + row * 0x58 - 0x80010000]
        | (resident[0x8003ef5c + row * 0x58 - 0x80010000 + 1] << 8)) & 0xffff;
    if (id >= 3 && !SPECIES.includes(id)) SPECIES.push(id);
}
assert.ok(SPECIES.length >= 8, "the profile table has enough forms for the cases");

function runtime() {
    const rt = new NativeStageRuntime(new Uint8Array(8), entry,
        { setFlag() {}, getFlag: () => 0, rand16: () => 0x777 }, undefined, undefined, 0x80082cb0,
        { image: resident, base: 0x80010000 });
    return rt;
}

/**
 * One partner's roster record: the three equipped form ids at +0x7B0 and the
 * acquired-form ledger at +0x7B8. The record is 0x3DC bytes and the ledger runs
 * to +0xB28, so the clear covers the whole of it — a shorter one would leave the
 * previous case's blocks in place and the search would find them.
 */
function seedRoster(rt, slot, equipped, ledger) {
    const base = equippedFormsAddress(slot) - 0x7b0;
    for (let i = 0; i < 0xb30; i++) rt.mem.write8(base + i, 0);
    for (let i = 0; i < EQUIPPED_FORMS_COUNT; i++) {
        rt.mem.write16(equippedFormsAddress(slot) + i * 2, (equipped[i] ?? 0xffff) & 0xffff);
    }
    ledger.forEach((species, index) => {
        const at = formTechBlockAddress(slot, index);
        rt.mem.write16(at, species & 0xffff);
        rt.mem.write8(at + 0x02, (index % 9) + 1);
        rt.mem.write32(at + 0x04, (index + 1) * 0x1111);
        for (let i = 0; i < TECH_BLOCK_SIZE - 8; i += 2) rt.mem.write16(at + 0x08 + i, (species * 7 + i) & 0xffff);
    });
}

const triple = (rt, at) => [0, 1, 2].map((i) => rt.mem.read16(at + i * 2));

/** Twenty-four partner pairs over the table's own shapes, plus the named bounds. */
function cases() {
    const out = [];
    for (let i = 0; i < 24; i++) {
        const a = SPECIES[i % SPECIES.length];
        const b = SPECIES[(i + 3) % SPECIES.length];
        const c = SPECIES[(i + 7) % SPECIES.length];
        // Every fourth case leaves a different part of the triple free, one of
        // them repeats a form and one asks for a form the ledger never acquired.
        const shape = i % 4;
        const equipped = shape === 0 ? [a, b, c]
            : shape === 1 ? [a, 0xffff, b]
                : shape === 2 ? [a, b, b]
                    : [a, b, 0xffff];
        const ledger = shape === 3 ? [a, b, 0, c] : [a, b, c];
        out.push({
            name: `partner ${i}: ${JSON.stringify(equipped)} of ${JSON.stringify(ledger)}`,
            slot: i % 3,
            equipped,
            ledger,
            // The shape's own expectation, so a case that stopped comparing the
            // two sides would still fail on the numbers a player sees.
            expect: shape === 0 ? [a, b, c, 3]
                : shape === 1 ? [a, b, 0xffff, 2]
                    : shape === 2 ? [a, b, b, 3]
                        : [a, b, 0xffff, 2],
        });
    }
    out.push(
        {
            name: "a ledger that starts late still holds the equipped form",
            slot: 1, equipped: [SPECIES[9], SPECIES[10]],
            ledger: Array.from({ length: 43 }, (_, i) => (i === 42 ? SPECIES[9] : SPECIES[1])),
            expect: [SPECIES[9], 0xffff, 0xffff, 1],
        },
        {
            name: "the last of the forty-four blocks is found",
            slot: 2, equipped: [SPECIES[11]],
            ledger: Array.from({ length: 44 }, (_, i) => (i === 43 ? SPECIES[11] : 3 + i)),
            expect: [SPECIES[11], 0xffff, 0xffff, 1],
        },
        {
            name: "a form the forty-four blocks never acquired is not found",
            slot: 2, equipped: [0x199], ledger: Array.from({ length: 44 }, (_, i) => 3 + i),
            expect: [0xffff, 0xffff, 0xffff, 0],
        },
        {
            name: "an id below three is a free slot, never a form",
            slot: 0, equipped: [2, 0, SPECIES[4]],
            ledger: [SPECIES[4]],
            expect: [SPECIES[4], 0xffff, 0xffff, 1],
        },
        {
            name: "three free slots leave nothing to list",
            slot: 0, equipped: [0xffff, 0xffff, 0xffff], ledger: [SPECIES[5], SPECIES[6]],
            expect: [0xffff, 0xffff, 0xffff, 0],
        },
        {
            name: "the roster index, not the party position, is the record",
            slot: 5, equipped: [SPECIES[6]], ledger: [SPECIES[6], SPECIES[7]],
            expect: [SPECIES[6], 0xffff, 0xffff, 1],
        },
    );
    return out;
}

test("readEquippedForms matches F0x800176AC for every partner pair", () => {
    const rt = runtime();
    const list = cases();
    assert.ok(list.length >= 20, `the table holds ${list.length} partner pairs`);
    for (const c of list) {
        seedRoster(rt, c.slot, c.equipped, c.ledger);
        for (let i = 0; i < 8; i++) rt.mem.write32(DEST + i, 0xcccc);
        const count = rt.cpu.call(SERVICE, [c.slot, DEST], 40000) | 0;
        const original = triple(rt, DEST);

        seedRoster(rt, c.slot, c.equipped, c.ledger);
        for (let i = 0; i < 8; i++) rt.mem.write32(DEST_ALT + i, 0xcccc);
        const port = readEquippedForms(rt.mem, c.slot, DEST_ALT);
        const portTriple = triple(rt, DEST_ALT);

        assert.deepEqual(portTriple, original, `${c.name}: the three species it lists`);
        assert.equal(port, count, `${c.name}: the kept count`);
        assert.deepEqual(
            [...portTriple, count], c.expect, `${c.name}: what the player is shown`,
        );
        // The service pads the tail with -1 and leaves the rest of the caller's
        // buffer alone, so a caller that reads three halfwords always can.
        assert.equal(original.length, 3);
        for (let i = count; i < EQUIPPED_FORMS_COUNT; i++) {
            assert.equal(original[i], 0xffff, `${c.name}: slot ${i} is padded with -1`);
        }
    }
});

test("findFormTechBlock matches F0x8001764C on the same records", () => {
    // The matcher is the service's own inner rule, so it is proved on the same
    // ledgers: the pane's column depends on which block an equipped id finds.
    const rt = runtime();
    for (const c of cases().slice(0, 24)) {
        seedRoster(rt, c.slot, c.equipped, c.ledger);
        for (const id of [...c.ledger, ...c.equipped, 0, 1, 2, 3]) {
            const original = rt.cpu.call(MATCHER, [c.slot, id & 0xffff], 40000) | 0;
            seedRoster(rt, c.slot, c.equipped, c.ledger);
            assert.equal(findFormTechBlock(rt.mem, c.slot, id), original, `${c.name}: id ${id}`);
        }
    }
});