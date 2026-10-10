// What a picture-table row index MEANS, pinned as the original's own answer.
//
// The eight rows of the disc's one Digimon picture table are walked by a party
// position, and the walker's screens must ask the same question the original asks.
// The original's answer is the ROSTER SLOT, reached three ways that all return the
// same 0..7 ordinal:
//
//   [0x80048D34]+0x2718 = F0x80016D94 (exe/fns.s:7506-7516) — ctx+0x70[position],
//     -1 for a position of 3 or more. pro/ststatus.s:10074-10077 puts the return
//     value straight into the ×7 row stride, so it IS the row.
//   [0x80048D34]+0x2728 = F0x80016FD8 (exe/fns.s:7672-7686) — the same ctx+0x70
//     word scaled by the 0x3DC record stride, read at record+0x760 and `addiu -0x3`.
//     F0x80016DC0 (exe/fns.s:7520-7548) wrote that field as slot+3.
//   pro/stgmcard.s:882-893 — the save record's own starter byte (3..10) less three,
//     i.e. the same ordinal (docs/research/ui/stgmcard-decoded-2026-08-05.md §3).
//
// The eight roster slots are the eight starter lines in starter order (0 Kotemon,
// 1 Kumamon, 2 Monmon, 3 Agumon, 4 Veemon, 5 Guilmon, 6 Renamon, 7 Patamon), which
// is digimon.json id − 1 — engine/dw3/roster.ts `rosterSlotDigimonId`.
//
// Ledger claim: digimon-picture-row-is-the-roster-slot-2026-10-03.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
    DIGIMON_PICTURE_TABLE,
    DIGIMON_PICTURE_ROWS,
    DIGIMON_PICTURE_ROW_WORDS,
    STARTER_PICTURE_ROW,
    advanceDigimonPictures,
    digimonPictureClip,
    digimonPictureRow,
} from "../engine/dw3/ui/digimon-picture.ts";
import { ROSTER_SLOT_CHARIDS, rosterSlotDigimonId } from "../engine/dw3/roster.ts";
import {
    PARTY_MAP,
    PARTY_CONTEXT,
    ROSTER_STRIDE,
    partyPositionToRosterSlot,
    getFollowerRosterSlot,
} from "../engine/dw3/party-context.ts";

/** A sparse RAM big enough for the three party words and the eight records. */
function ram() {
    const words = new Map();
    return {
        read32(addr) {
            return words.get(addr >>> 0) ?? 0;
        },
        write32(addr, value) {
            words.set(addr >>> 0, value >>> 0);
        },
    };
}

/** F0x80016DC0's own writes: the party map plus `slot+3` at each record's +0x760. */
function seedParty(mem, slots) {
    for (let i = 0; i < 3; i++) {
        const slot = slots[i];
        mem.write32(PARTY_MAP + i * 4, slot === undefined ? 0xffffffff : slot);
        if (slot !== undefined) mem.write32(PARTY_CONTEXT + slot * ROSTER_STRIDE + 0x760, slot + 3);
    }
}

/** The first clip of each row, as read off the sheets by eye on 2026-10-03. */
const ROW_FIRST_CLIP = [7, 14, 11, 3, 25, 0, 17, 21];

test("the row the original asks for is the roster slot, on both of its services", () => {
    // A party in neither slot order nor id order, which is the case a per-screen
    // guess gets wrong: Renamon (slot 6), Kotemon (slot 0), Agumon (slot 3).
    const mem = ram();
    seedParty(mem, [6, 0, 3]);

    // Renamon, Kotemon, Agumon — the three rows their slots name, read off the
    // sheets by eye (ststat_sheet.png / stdglabo_sheet.png, 2026-10-03).
    const wanted = [[17, 18, 19, 20, 19, 18], [7, 8, 9, 10, 9, 8], [3, 4, 5, 6, 5, 4]];
    for (let position = 0; position < 3; position++) {
        const byPosition = partyPositionToRosterSlot(mem, position);
        const byRecord = getFollowerRosterSlot(mem, position);
        assert.equal(byPosition, [6, 0, 3][position], `ctx+0x2718 at position ${position}`);
        assert.equal(byRecord, byPosition, `ctx+0x2728 must re-derive the same slot at ${position}`);
        assert.deepEqual(digimonPictureRow(byPosition), wanted[position],
            `position ${position} must walk row ${byPosition}, nothing else`);
    }

    // F0x80016D94's own guard: a position of three or more has no row at all.
    assert.equal(partyPositionToRosterSlot(mem, 3), -1);
    assert.equal(getFollowerRosterSlot(mem, 3), -1);
});

test("every starter line names its own row, through the roster table and not a list", () => {
    assert.equal(ROSTER_SLOT_CHARIDS.length, DIGIMON_PICTURE_ROWS);
    ROSTER_SLOT_CHARIDS.forEach((charId, slot) => {
        const digimonId = rosterSlotDigimonId(slot);
        assert.equal(STARTER_PICTURE_ROW[digimonId], slot, `${charId} (id ${digimonId}) -> row ${slot}`);
        assert.equal(DIGIMON_PICTURE_TABLE[slot][0], ROW_FIRST_CLIP[slot], `row ${slot} starts on clip ${ROW_FIRST_CLIP[slot]}`);
    });
    // Nothing outside the eight starter lines names a row: an evolution, an enemy
    // and a non-starter partner must all fall back rather than borrow a neighbour's.
    for (const id of [0, 9, 31, 100, 383]) {
        assert.equal(STARTER_PICTURE_ROW[id], undefined, `id ${id} is not a starter line`);
    }
});

test("a digivolved partner still shows its starter line's figures", () => {
    // The original keys the row on the roster slot, which digivolution never writes
    // (it writes the record's current-form field), so a champion form must not move
    // the picture. The slot is the only input the walk takes.
    const mem = ram();
    seedParty(mem, [3, 3]);
    const before = digimonPictureClip(partyPositionToRosterSlot(mem, 0), 0);
    mem.write32(PARTY_CONTEXT + 3 * ROSTER_STRIDE + 0x08, 0x017f); // the champion form
    const after = digimonPictureClip(partyPositionToRosterSlot(mem, 0), 0);
    assert.equal(before, 3, "Agumon at roster slot 3 walks row 3");
    assert.equal(after, 3, "the row follows the slot, not the live form");
});

test("the shared walk draws the shared table's word for the row the service returned", () => {
    const mem = ram();
    seedParty(mem, [6, 0, 3]);
    const table = 0x8008f000;
    const cell = 0x8008e000; // the overlay's pointer cell onto the table
    mem.write32(cell, table);
    for (let row = 0; row < DIGIMON_PICTURE_ROWS; row++) {
        for (let word = 0; word < DIGIMON_PICTURE_ROW_WORDS; word++) {
            mem.write32(table + (row * DIGIMON_PICTURE_ROW_WORDS + word) * 4, DIGIMON_PICTURE_TABLE[row][word]);
        }
    }
    const timer = 0x8008f200;
    const counters = [0x8008f300, 0x8008f304, 0x8008f308];
    let frame = 0;
    const step = () => {
        advanceDigimonPictures({
            mem,
            tableCell: cell,
            timer,
            cadence: 13,
            frame: () => frame,
            groups: [{
                counterBase: counters[0],
                count: 3,
                rowAt: (i) => partyPositionToRosterSlot(mem, i),
                skipNegativeRow: false,
                capAtRowLength: true,
            }],
        });
    };
    const drawn = [];
    // Nine steps: enough for the longest row (Renamon, six figures) to wrap once.
    // The original advances the counter BEFORE it draws, so the first picture on
    // screen after a step is the row's SECOND word; the walk starts from counter 0.
    for (let i = 0; i < 9; i++) {
        frame += 13;
        step();
        drawn.push([0, 1, 2].map((p) => {
            const row = partyPositionToRosterSlot(mem, p);
            const clip = mem.read32(table + (row * DIGIMON_PICTURE_ROW_WORDS + mem.read32(counters[p])) * 4) | 0;
            assert.equal(clip, digimonPictureClip(row, mem.read32(counters[p])), `subject ${p} frame ${i}`);
            return clip;
        }));
    }
    // Renamon 18 19 20 19 18 17(restart) | Kotemon 8 9 10 9 8 7 | Agumon 4 5 6 5 4 3,
    // then all three start the row again.
    assert.deepEqual(drawn, [
        [18, 8, 4], [19, 9, 5], [20, 10, 6], [19, 9, 5], [18, 8, 4],
        [17, 7, 3], [18, 8, 4], [19, 9, 5], [20, 10, 6],
    ]);
});

test("an empty pedestal has no row, and the row the walk takes is the one it draws", () => {
    // A two-member party: the third pedestal's word is -1 and the Lab's sites skip
    // it, so no row is reached for it. The row that IS reached must be the row the
    // draw reads — a screen that passed the position instead of the slot would show
    // Renamon's figures for Kotemon here.
    const mem = ram();
    seedParty(mem, [0, 6, undefined]);
    assert.equal(partyPositionToRosterSlot(mem, 2), -1);
    const rows = [0, 1, 2].map((i) => partyPositionToRosterSlot(mem, i));
    assert.deepEqual(rows, [0, 6, -1]);
    assert.equal(digimonPictureClip(rows[0], 0), 7, "Kotemon walks row 0");
    assert.equal(digimonPictureClip(rows[1], 0), 17, "Renamon walks row 6");
});