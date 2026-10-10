// Talk-triggered cutscenes — the bank-0x90 launcher.
//
// set_flag(bank 0x90, bit) is not storage: the resident dispatcher F0x800165ac
// routes it to fieldstg F0x8008bfa4, which looks the event id up in the u16
// array at RAM 0x800978d8 and calls the same start_event (0x800853f8) the
// step-VM's op-8 handler calls.
//
// Decode: tools/extract_talk_event_launches.py,
// docs/research/scripting/talk-event-launcher-bank90-2026-07-28.md.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const LAUNCH = JSON.parse(readFileSync("web/assets/data/talk_event_launches.json", "utf8"));
const EVENTS = JSON.parse(readFileSync("web/assets/events/wstag_events.json", "utf8"));
const FIELDSTG = readFileSync("web/assets/native/fieldstg.bin");

const FIELDSTG_BASE = 0x80082cb0;
const TABLE_RAM = 0x800978d8;
const BANK = 0x90;

/** Every bank-0x90 on_close write in the shipped scenes: {stage, bit}. */
function bankWrites() {
    const out = [];
    for (const f of readdirSync("web/assets/scenes")) {
        if (!f.endsWith(".json")) continue;
        const scene = JSON.parse(readFileSync(`web/assets/scenes/${f}`, "utf8"));
        for (const npc of scene.npcs || [])
            for (const st of npc.dialogue_states || [])
                for (const oc of st.on_close || [])
                    if (((oc.id >> 8) & 0xfe) === BANK)
                        out.push({ stage: f.replace(/\.json$/, ""), bit: oc.id & 0x1ff, npc: npc.npc_id });
    }
    return out;
}

test("the shipped table is the fieldstg array at 0x800978d8, verbatim", () => {
    const off = TABLE_RAM - FIELDSTG_BASE;
    assert.equal(LAUNCH.bank, BANK);
    assert.equal(LAUNCH.table_ram, "0x800978d8");
    assert.ok(LAUNCH.events.length > 0, "table is non-empty");
    LAUNCH.events.forEach((id, i) => {
        assert.equal(id, FIELDSTG.readUInt16LE(off + i * 2), `entry ${i}`);
        assert.notEqual(id, 0, `entry ${i} is before the terminator`);
    });
    // The emitted length stops at the first zero — that zero must be real, not
    // an artifact of truncating early.
    assert.equal(FIELDSTG.readUInt16LE(off + LAUNCH.events.length * 2), 0);
});

test("the Kicking Forest hide-and-seek resolves end to end", () => {
    // The four searchable spots in s400 write bits 49–52. Each must land on the
    // event whose completion sets that spot's own "searched" flag, and the
    // Veemon one (bit 52) must be the handoff that leads to the Tree Boots.
    const s400 = EVENTS.s400;
    const expected = { 49: 1301, 50: 1302, 51: 1303, 52: 1304 };
    for (const [bit, eventId] of Object.entries(expected)) {
        assert.equal(LAUNCH.events[bit], eventId, `bit ${bit}`);
        assert.ok(s400.some((e) => e.id === eventId), `s400 owns event ${eventId}`);
    }
    // Bit 52 is Veemon: his event is the one that hands off to another screen.
    const veemon = s400.find((e) => e.id === LAUNCH.events[52]);
    assert.ok(veemon.handoff_to, "finding Veemon hands off out of the forest");
});

test("every shipped bank-0x90 write resolves in its own stage, bar the recorded residue", () => {
    const writes = bankWrites();
    assert.ok(writes.length >= 200, `found ${writes.length} talk launches`);
    const unresolved = [];
    for (const w of writes) {
        assert.ok(w.bit < LAUNCH.events.length, `bit ${w.bit} (${w.stage}) is in the table`);
        const ids = new Set((EVENTS[w.stage] || []).map((e) => e.id));
        if (ids.size && !ids.has(LAUNCH.events[w.bit])) unresolved.push(`${w.stage}:${w.bit}`);
    }
    // start_event has no cross-stage lookup, so these three genuinely find
    // nothing on their own stage. Pinned so the count cannot grow unnoticed.
    assert.deepEqual(unresolved.sort(), ["s537:54", "s550:17", "s551:18"]);
    assert.equal(LAUNCH.unresolved_bindings.length, 3);
});
