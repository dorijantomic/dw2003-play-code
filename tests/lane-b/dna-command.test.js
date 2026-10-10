// Lane B oracle: the DNA COMMAND's answer — who can DNA, what it costs, and
// which action runs — read from the extracted tables through the one shared
// rule (engine/dw3/ui/native/battle-dna-menu.ts `dnaPairing` / `dnaActionRecord`).
//
// The original runs through engine/native (the interpreter) as the oracle, and
// this harness is the one place where its species getter is NOT stubbed: the
// exe's own cell [0x8005CCA0] holds F0x800134E8 (read out of the resident image
// here: 0x800134E8), so the original scans the real 55-row profile table at
// 0x8003EF5C itself. Only the services that would allocate or draw are stubbed.
//
// FIGHTSTG_F0x800980e4's option build branch (fightstg.s 0x8009832c-0x800983b8,
// lines 22132-22163) is the whole rule:
//
//   lbu $v1, 0x3d($s0)   the acting profile record's DNA partner, a 1-based index
//   bnez $v1, …          zero cannot DNA at all
//   lbu $v0, 0x55($v0)   the cursor species record's own 1-based index
//   bne  $v1, $v0, …     and the two must be equal
//   lhu $v0, 0x2a($s0)   the acting record's DNA result/action id → self+0x7C
//
// and the commit at 0x800985b4-0x80098680 reads
// `0x80042bdc + 0x12*(self+0x7C - 1)` and debits it from BOTH records. So the
// original's own MP debit is this file's oracle for the price.
//
// Every pair of the 55 profile rows is run, 55 × 55 = 3025 ordered pairs, and
// each paired pair is then confirmed so the price is compared as an amount that
// actually came off a member's MP. digimon.json's 55 rows are checked against the
// same table in both directions, because the walker addresses its own profiles by
// row: row i's halfword at +0x2A must be that profile's `tech_dna_dv`, and its
// byte at +0x55 must be i + 1.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    dnaActionRecord, dnaActionPrice, dnaPairing,
    DNA_BUILD, DNA_COMBATANT, DNA_COMBATANT_STRIDE, DNA_DNA_ID, DNA_MP_XS,
    DNA_PANE_CONFIG_OPTIONS, DNA_PANE_CONFIG_STRIP, DNA_PARTNER_SLOT, DNA_PARTY_AILMENTS,
    DNA_PARTY_BASE, DNA_PARTY_BLAST, DNA_PARTY_HP, DNA_PARTY_INDEX, DNA_PARTY_MAX_HP,
    DNA_PARTY_MAX_MP, DNA_PARTY_MP, DNA_PARTY_SPECIES, DNA_PARTY_STRIDE,
    DNA_PRICES, DNA_PROFILE_PAIR, DNA_PROFILE_INDEX, DNA_PROFILE_RESULT, DNA_PROFILE_ROWS,
    DNA_SPECIES, DNA_SPECIES_OUT, DNA_SPECIES_TABLE, DNA_STATE, DNA_STRIP_CURSOR,
    DNA_SUB_STATE, DNA_WORDS,
} from "../../engine/dw3/ui/native/battle-dna-menu.ts";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(dir, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(dir, "pro_fightstg.bin")));
const digimon = JSON.parse(readFileSync(resolve(dir, "../../data/digimon.json"), "utf8")).digimon;
const evolutions = JSON.parse(readFileSync(resolve(dir, "../../data/evolutions.json"), "utf8"));
const techRows = JSON.parse(readFileSync(resolve(dir, "../../data/fight_tech_table.json"), "utf8"));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

const PANE = 0x800980e4;
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
const SLOT_BASE = 0x0fdd1000;
const PAD_STUB = 0x0fdd000c;
const RESOURCE_STUB = 0x0fdd0014;
const PACK_STUB = 0x0fdd0018;
const COMBATANT_STUB = 0x0fdd0034;
const CANDIDATE_STUB = 0x0fdd0030;

const SLOT_ARITY = { 0x28: 1, 0x2c: 1, 0x38: 0, 0x3c: 0, 0x40: 0, 0x114: 2, 0x118: 2, 0x138: 1, 0x144: 1, 0x148: 1 };
const SLOTS = Object.keys(SLOT_ARITY).map(Number);
const language = 2;
let made = 0;
let padWord = 0;
/** web/battle.js:543 PROFILE_NAME_ALIASES: the walker's transcription spells
 *  three forms differently from digimon.json. */
const NAME_ALIASES = { BKWarGreymon: "BK WarGreymon", ImperialdramonFM: "Imperialdramon-F", ImperialdramonPM: "Imperialdramon-P" };
const canonical = (name) => NAME_ALIASES[name] ?? name;

/** The 55 rows, straight out of the table the original reads. */
const ROWS = [];
for (let row = 0; row < DNA_PROFILE_ROWS; row++) {
    const at = DNA_SPECIES_TABLE - 0x80010000 + row * DNA_COMBATANT_STRIDE;
    ROWS.push({
        row,
        gameId: resident[at] | (resident[at + 1] << 8),
        pair: resident[at + DNA_PROFILE_PAIR],
        self: resident[at + DNA_PROFILE_INDEX],
        resultId: resident[at + DNA_PROFILE_RESULT] | (resident[at + DNA_PROFILE_RESULT + 1] << 8),
        address: (DNA_SPECIES_TABLE + DNA_COMBATANT_STRIDE * row) >>> 0,
    });
}
assert.equal(ROWS.length, 55, "the profile table has 55 rows");

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound() {} };
    const rt = new NativeStageRuntime(fight, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident,
        base: 0x80010000,
    });
    rt.cpu.setStub(0x80014504, () => SCREEN);
    rt.cpu.setStub(0x8001ae38, () => {
        const widget = WIDGET_BASE + made * 0x400;
        made += 1;
        for (const slot of SLOTS) rt.mem.write32(widget + slot, SLOT_BASE + slot);
        return widget;
    });
    rt.cpu.setStub(PAD_STUB, () => padWord);
    rt.cpu.setStub(RESOURCE_STUB, (c) => ((c.reg(4) | 0) === (0x7f + language) ? RES_PTR : NAME_RES_PTR));
    rt.cpu.setStub(PACK_STUB, () => PACK_PTR);
    rt.cpu.setStub(COMBATANT_STUB, () => 1);
    rt.cpu.setStub(CANDIDATE_STUB, () => 0);
    for (const slot of SLOTS) rt.cpu.setStub(SLOT_BASE + slot, () => 0);
    rt.cpu.setStub(0x8001ecbc, () => 0);
    rt.cpu.setStub(0x8001ed34, () => 0);
    rt.cpu.setStub(0x8001ecec, () => 0);
    rt.cpu.setStub(0x8001ed6c, () => 0);
    rt.cpu.setStub(0x800953e4, () => 0);
    rt.cpu.setStub(0x8009b0c8, () => MODEL);
    rt.mem.write32(0x80044f4c, RESOURCE_STUB);
    rt.mem.write32(0x80044f5c, PACK_STUB);
    rt.mem.write32(0x8004bbc4, PAD_STUB);
    rt.mem.write32(0x8005cca8, language);
    rt.mem.write32(0x8004b44c, COMBATANT_STUB);
    rt.mem.write32(0x8004b46c, CANDIDATE_STUB);
    // [0x8005CCA0] is left as the resident image has it: F0x800134E8, the species
    // getter that scans the profile table. Asserting it here is what makes this
    // file an oracle over the real rows rather than over two fake records.
    assert.equal(rt.mem.read32(0x8005cca0) >>> 0, 0x800134e8, "[0x8005CCA0] is F0x800134E8");
    return rt;
}

/** The pane mid-build: the option sub-state's build branch and nothing else. */
function seed(rt, actorId, partnerId) {
    made = 0;
    for (let i = 0; i < 0x90; i += 4) rt.mem.write32(SCREEN + i, 0);
    for (const slot of [0x28, 0x2c, 0x38, 0x3c, 0x40]) rt.mem.write32(SCREEN + slot, SLOT_BASE + slot);
    rt.mem.write32(SCREEN + DNA_STATE, 1);
    rt.mem.write32(SCREEN + DNA_SUB_STATE, 1);
    rt.mem.write32(SCREEN + DNA_BUILD, 0);
    rt.mem.write32(SCREEN + DNA_WORDS, WORDS);
    rt.mem.write32(SCREEN + DNA_PARTNER_SLOT, 1);
    rt.mem.write32(SCREEN + DNA_COMBATANT, 1);
    rt.mem.write32(SCREEN + DNA_STRIP_CURSOR, 0);
    // The strip's leading row is the species under the cursor, so the rule is
    // asked about the partner the player picked.
    rt.mem.write16(SCREEN + DNA_SPECIES, partnerId & 0xffff);
    rt.mem.write16(SCREEN + DNA_SPECIES + 2, 0);
    rt.mem.write16(SCREEN + DNA_SPECIES + 4, 0);
    rt.mem.write16(SCREEN + DNA_SPECIES + 6, 0);
    rt.mem.write32(SCREEN + 0x70, 1);
    rt.mem.write32(SCREEN + 0x54, 0);
    rt.mem.write32(SCREEN + 0x58, -1);
    rt.mem.write32(SCREEN + DNA_DNA_ID, 0);
    rt.mem.write32(SCREEN + DNA_SPECIES_OUT, SPECIES_OUT);
    rt.mem.write32(SLOT, MODEL);
    rt.mem.write32(SLOT + 4, 0);
    rt.mem.write32(SLOT + 8, 0);
    rt.mem.write32(SLOT + 0xc, 0);
    rt.mem.write32(MODEL + 0x50, 0);
    rt.mem.write32(MODEL + 0x54, 0);
    rt.mem.write32(MODEL + 0x58, 1);
    rt.mem.write32(OPTIONS + 0x50, 0);
    rt.mem.write32(OPTIONS + 0x54, 0);
    rt.mem.write32(OPTIONS + 0x58, 2);
    rt.mem.write32(WORDS, -1);
    rt.mem.write32(SPECIES_OUT, 0);
    for (let i = 0; i < 8; i++) {
        rt.mem.write32(DNA_PANE_CONFIG_STRIP + i * 4, [4, 0xa8, 0x93, 0x13, 0x24, 0xa7, 0x92, 0x13][i] >>> 0);
        rt.mem.write32(DNA_PANE_CONFIG_OPTIONS + i * 4, [2, 0xa8, 0xa6, 0x13, 0x22, 0xa7, 0xa5, 0x13][i] >>> 0);
    }
    for (let i = 0; i < 4; i++) rt.mem.write32(DNA_MP_XS + i * 4, [172, 0, 216, 0, 217, 0, 251, 0][i] >>> 0);
    rt.mem.write32(DNA_PARTY_INDEX, 0);
    // 9999 MP, as the runtime capture had: the refusal test reads it with `lh`
    // (0x800985d4), which sign-extends, and the dearest DNA action costs 480.
    const mp = 9999;
    for (let i = 0; i < 3; i++) {
        const at = DNA_PARTY_BASE + i * DNA_PARTY_STRIDE;
        rt.mem.write16(at + DNA_PARTY_SPECIES, i === 0 ? actorId : i === 1 ? partnerId : 0);
        rt.mem.write16(at + DNA_PARTY_MAX_HP, 999);
        rt.mem.write16(at + DNA_PARTY_HP, 999);
        rt.mem.write16(at + DNA_PARTY_MAX_MP, mp);
        rt.mem.write16(at + DNA_PARTY_MP, mp);
        rt.mem.write8(at + DNA_PARTY_BLAST, 0);
        rt.mem.write8(at + DNA_PARTY_AILMENTS, 0);
    }
}

test("digimon.json's 55 profiles are the profile table's 55 rows, in order", () => {
    assert.equal(digimon.length, DNA_PROFILE_ROWS, "digimon.json has one profile a row");
    ROWS.forEach((row, i) => {
        const profile = digimon[i];
        assert.equal(profile.tech_dna_dv, row.resultId, `row ${i} ${profile.name}: +0x2A is tech_dna_dv`);
        assert.equal(row.self, i + 1, `row ${i} ${profile.name}: +0x55 is its own 1-based index`);
    });
});

test("the shared rule matches the original over every pair of the 55 rows", () => {
    const rt = runtime();
    let paired = 0;
    const pairs = new Set();
    for (const actor of ROWS) {
        for (const partner of ROWS) {
            seed(rt, actor.gameId, partner.gameId);
            rt.cpu.call(PANE, [SCREEN, SLOT, 1], 60000);
            const original = rt.mem.read32(SCREEN + DNA_DNA_ID) >>> 0;
            const answer = dnaPairing(rt.mem, actor.address, partner.address);
            const label = `${actor.gameId} x ${partner.gameId}`;
            assert.equal(answer === null ? 0 : answer.resultId, original, `${label}: DNA id`);
            if (answer === null) continue;
            paired += 1;
            pairs.add([Math.min(actor.row, partner.row), Math.max(actor.row, partner.row)].join("+"));

            // The price, as the original actually charges it: confirm the DNA DV
            // row and read what came off BOTH members' MP.
            const before = [
                rt.mem.read16(DNA_PARTY_BASE + DNA_PARTY_MP),
                rt.mem.read16(DNA_PARTY_BASE + DNA_PARTY_STRIDE + DNA_PARTY_MP),
            ];
            rt.mem.write32(SCREEN + DNA_BUILD, 1);
            rt.mem.write32(SLOT + 4, OPTIONS);
            rt.mem.write32(OPTIONS + 0x50, 1);
            padWord = 0x2000;
            rt.cpu.call(PANE, [SCREEN, SLOT, 1], 60000);
            padWord = 0;
            const after = [
                rt.mem.read16(DNA_PARTY_BASE + DNA_PARTY_MP),
                rt.mem.read16(DNA_PARTY_BASE + DNA_PARTY_STRIDE + DNA_PARTY_MP),
            ];
            assert.equal(before[0] - after[0], dnaActionPrice(rt.mem, answer.resultId), `${label}: the actor pays`);
            assert.equal(before[1] - after[1], dnaActionPrice(rt.mem, answer.resultId), `${label}: the partner pays`);
            assert.equal(rt.mem.read32(SPECIES_OUT) >>> 0, answer.resultId, `${label}: species out word`);
            // The action's own numbers, cross-checked against the other
            // extraction of the same 18-byte rows (assets/data/fight_tech_table.json).
            const row = techRows[String(answer.resultId)];
            assert.deepEqual(dnaActionRecord(rt.mem, answer.resultId), {
                mp: row.mp, power: row.power, category: row.category, element: row.elem1, clip: row.clip,
            }, `${label}: the action record`);
            assert.equal(row.clip, 12, `${label}: a DNA action runs on clip 12`);
        }
    }
    assert.equal(paired, 22, "22 ordered pairs of rows carry a pairing");
    assert.equal(pairs.size, 11, "11 unordered pairs");
});

test("what the walker's own DNA table allowed that the original refuses, and the reverse", () => {
    const name = (row) => digimon[row].name;
    // A tree row names its forms by DigimonId, which is the 1-based species row;
    // `name` above is the 0-based array index the profile-table walk uses.
    const species = (id) => digimon[id - 1].name;
    const originalPairs = [];
    for (const actor of ROWS) {
        if (actor.pair === 0) continue;
        const partner = ROWS[actor.pair - 1];
        assert.equal(partner.self, actor.pair, `row ${actor.row}: +0x3D names a real row`);
        assert.equal(partner.resultId, actor.resultId, `row ${actor.row}: both records agree on the action`);
        originalPairs.push([name(actor.row), name(partner.row)].sort().join(" + "));
    }
    const original = [...new Set(originalPairs)].sort();
    // The walker's own table: the disc's eight lines, where a row with BOTH
    // requirement slots filled is one of the DNA gates (pro/stfgtrep.s file 0x3748,
    // the loop that steps $s0 by 4 and runs twice).
    const walker = new Set();
    for (const line of evolutions.lines) {
        for (const row of line.records) {
            if (!row.req0 || !row.req1) continue;
            walker.add([canonical(species(row.req0)), canonical(species(row.req1))].sort().join(" + "));
        }
    }
    const refused = original.filter((pair) => !walker.has(pair));
    const allowed = [...walker].filter((pair) => !original.includes(pair)).sort();
    // Three of each, named, so the report can quote them.
    assert.equal(refused.length, 7, "seven of the original's pairs the walker's table refused");
    assert.deepEqual(refused.slice(0, 3), [
        "Diaboromon + Imperialdramon-P", "Digitamamon + WarGrowlmon", "Dinohumon + Kyubimon",
    ], "three of the original's pairs the walker's table refused");
    assert.deepEqual(allowed, [
        "Imperialdramon + Kabuterimon", "Imperialdramon-F + Omnimon",
    ], "both pairs the walker's table allowed and the disc refuses");
});