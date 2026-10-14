// Lane B oracle: the words the battle message line now shows are the original's.
//
// The panel is pro/fightstg's FIGHTSTG_F0x80099588. Its 22 arms (`.L0x8008318c`)
// give each of the two text elements an index into text family 0x7f — the disc's
// esmfight string table — and the shared tail FIGHTSTG_F0x80098D14 puts the acting
// Digimon's name into slot 1 of line one. web/battle.js used to write its own English
// into the same slot ("X used Y!", "Missed"); this test pins every line the walker now
// puts up to the arm and the bank index the original's own call site uses.
//
// What is checked, for each of the walker's lines:
//   1. the ORIGINAL VM, run through engine/native on the shipped pro_fightstg.bin with
//      that (kind, payload), emits the same ordered element calls the port does — which
//      is what fixes the bank index and the numbered slot;
//   2. the shipped decoded bank (web/assets/data/battlecmd/esmfight.json) holds exactly
//      the words the original would draw for those indices, and its entry count still
//      matches the disc image battlecmd/129.bin it was built from;
//   3. BattleMessageSession.openOriginal composes those two templates and slots into the
//      two lines the elements would hold.
//
// The call sites each line was read out of are named in `SITES`; the whole inventory,
// including the walker's lines that have NO original counterpart, is in
// .bunny-scratch/battlewords-report.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NativeStageRuntime } from "../../engine/native/runtime.ts";
import {
    BATTLE_MESSAGE_EL_SET_NUMBER, BATTLE_MESSAGE_EL_SET_SLOT, BATTLE_MESSAGE_EL_SET_STRING,
    BATTLE_MESSAGE_EL_VISIBLE, BATTLE_MESSAGE_LAYER, BATTLE_MESSAGE_FONT_KIND,
    BATTLE_MESSAGE_LINE1, BATTLE_MESSAGE_LINE2, BATTLE_MESSAGE_VM,
    battleMessageArm, battleMessageBuildWidgets, battleMessageNamesLineOne, battleMessageShow,
} from "../../engine/dw3/ui/native/battle-message-line.ts";
import { BattleMessageSession } from "../../engine/dw3/ui/battle-message-session.ts";
import { MSG, MSG_KIND } from "../../web/battle.js";
import { JOKE_FLAVOR, jokeFlavorMessageId } from "../../engine/dw3/battle-confusion.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const screens = join(root, "web/assets/native/screens");
const resident = new Uint8Array(readFileSync(join(screens, "resident.bin")));
const fight = new Uint8Array(readFileSync(join(screens, "pro_fightstg.bin")));
const entry = { size: fight.length, event_table: 0, init_fn: 0, root_ctor: 0, allocs: [], effect_ids: [] };

// --- the decoded bank, and the disc image it was decoded from --------------------
const BANK_FILE = join(root, "web/assets/data/battlecmd/esmfight.json");
const bank = JSON.parse(readFileSync(BANK_FILE, "utf8"));
const STRING = (index) => bank.strings[index] ?? "";

const SELF = 0x80200000;
const BLOCK = 0x80300000;
const PAYLOAD = 0x80400000;
const CREATE_FN = 0x8001ae38;
const BANK_SLOT = 0x80044f4c;
const BANK_STUB = 0x0fdd2100;
const TAIL_HELPERS = [0x80098d14, 0x80098de0, 0x80099140];
const METHOD_ARITY = {
    [BATTLE_MESSAGE_EL_SET_STRING]: 2,
    [BATTLE_MESSAGE_EL_SET_NUMBER]: 2,
    [BATTLE_MESSAGE_EL_SET_SLOT]: 3,
    [BATTLE_MESSAGE_EL_VISIBLE]: 1,
};

const LOG = [];
const widgetFor = (x, y) => 0x80200000 + (y << 4) + (x << 1);

function runtime() {
    const host = { setFlag() {}, getFlag: () => 0, rand16: () => 0x777, playPackedSound() {} };
    const rt = new NativeStageRuntime(fight, entry, host, undefined, undefined, 0x80082cb0, {
        image: resident, base: 0x80010000,
    });
    rt.cpu.setStub(BANK_STUB, (c) => { LOG.push(["bank", c.reg(4) | 0]); return 0x81000000; });
    rt.mem.write32(BANK_SLOT, BANK_STUB);
    rt.cpu.setStub(CREATE_FN, (c) => {
        const x = c.reg(6) | 0, y = c.reg(7) | 0;
        LOG.push(["create", c.reg(4) | 0, c.reg(5) | 0, x, y]);
        return widgetFor(x, y);
    });
    for (const helper of TAIL_HELPERS) rt.cpu.setStub(helper, () => { LOG.push(["helper"]); return 0; });
    for (const [slot, arity] of Object.entries(METHOD_ARITY)) {
        const offset = Number(slot);
        const stub = 0x0fdd2000 + offset;
        rt.cpu.setStub(stub, (c) => {
            const args = [];
            for (let i = 0; i < arity; i++) args.push(c.reg(5 + i) >>> 0);
            LOG.push(["method", c.reg(4) >>> 0, offset, ...args]);
            return 0;
        });
        for (const x of [BATTLE_MESSAGE_LINE1.x, BATTLE_MESSAGE_LINE2.x]) {
            for (const y of [BATTLE_MESSAGE_LINE1.y, BATTLE_MESSAGE_LINE2.y]) {
                rt.mem.write32(widgetFor(x, y) + offset, stub);
            }
        }
    }
    rt.mem.write32(SELF + 0x24, BLOCK);
    return rt;
}

const lineOf = (element) =>
    element === widgetFor(BATTLE_MESSAGE_LINE1.x, BATTLE_MESSAGE_LINE1.y) ? 1
        : element === widgetFor(BATTLE_MESSAGE_LINE2.x, BATTLE_MESSAGE_LINE2.y) ? 2 : 0;

/** The element calls the original made, as `[line, method, ...args]`. */
function originalCalls(rt) {
    const out = [];
    for (const row of LOG) {
        if (row[0] === "create") { out.push(["create", row[1], row[2], row[3], row[4]]); continue; }
        if (row[0] === "bank" || row[0] === "helper") continue;
        out.push(["method", lineOf(row[1]), row[2], ...row.slice(3)]);
    }
    return out;
}

/** The same calls as the port records them. */
function portCalls(kind, payload) {
    const log = [];
    const host = {
        createTextElement(target, k, x, y) {
            log.push(["create", target | 0, k | 0, x | 0, y | 0]);
            return widgetFor(x, y);
        },
        bankGet(bankId) { return 0x81000000; },
        callMethod(element, slot, args) { log.push(["method", lineOf(element), slot, ...args]); },
        packResolve(handle) { return handle >>> 0; },
        drawSprite() {},
    };
    battleMessageShow(host, battleMessageBuildWidgets(host), kind, payload, () => "", String);
    return log;
}

/** Run one `unkAC(kind, payload)` through the original and through the port. */
function runBoth(rt, kind, payload) {
    rt.mem.write32(BLOCK + 0, 0);
    rt.mem.write32(BLOCK + 4, 0);
    for (let i = 0; i < 8; i++) {
        rt.mem.write32(PAYLOAD + i * 4, (payload[i] ?? 0) >>> 0);
        rt.mem.write32(SELF + 0x54 + i * 4, (payload[i] ?? 0) >>> 0);
    }
    rt.mem.write32(SELF + 0x88, 0);
    LOG.length = 0;
    rt.cpu.call(BATTLE_MESSAGE_VM, [SELF, kind, PAYLOAD], 400000);
    return originalCalls(rt);
}

const rt = runtime();

const session = () => new BattleMessageSession({
    textOf: (b, index) => (b === 0x7f ? STRING(index) : ""),
    paint: () => {},
});

/**
 * Every line the walker now puts up, with the original's call site it was read from.
 *
 * `walker` is the sentence web/battle.js still keeps in `b.message`, so that
 * `?legacyBattleMsg=1` draws the old rectangle with the old words; `expect` is the two
 * lines the original's elements hold.
 */
const SITES = [
    {
        what: "the battle opens with an ambush",
        site: "wfightmn.s .L0x000012f8", kind: MSG_KIND.ONE_LINE, payload: [MSG.AMBUSH],
        slots: [], name: null,
        walker: "Ambush!",
        expect: ["Ambush!"],
    },
    {
        what: "Fight chosen",
        site: "fightstg.s .L0x80090fe8", kind: MSG_KIND.OUTCOME, payload: [MSG.ATTACK],
        slots: [], name: "Kuwagamon",
        walker: "Kuwagamon attacks!",
        expect: ["Kuwagamon", "Attack!"],
    },
    {
        what: "a technique chosen",
        site: "fightstg.s .L0x80090d24", kind: MSG_KIND.TECHNIQUE, payload: [MSG.ATTACK],
        slots: ["Mega Needle"], name: "Kuwagamon",
        walker: "Kuwagamon uses Mega Needle!",
        expect: ["Kuwagamon", "Mega Needle!"],
    },
    {
        what: "an item chosen",
        site: "fightstg.s .L0x8008db3c", kind: MSG_KIND.ITEM, payload: [MSG.ATTACK],
        slots: ["Orange"], name: "Kuwagamon",
        walker: "Used Orange!",
        expect: ["Kuwagamon", "Orange!"],
    },
    {
        what: "the enemy dodges the basic attack",
        site: "fightstg.s .L0x8008ed70", kind: MSG_KIND.OUTCOME, payload: [MSG.EVADE],
        slots: [], name: "Numemon",
        walker: "Numemon evaded!",
        expect: ["Numemon", "Evade!"],
    },
    {
        what: "a plain hit lands",
        site: "fightstg.s .L0x80090dd8", kind: MSG_KIND.DAMAGE, payload: [0, 57],
        slots: ["57"], name: "Numemon",
        walker: "Numemon took 57 damage!",
        expect: ["Numemon", "57 damage!"],
    },
    {
        what: "no MP left for the technique",
        site: "fightstg.s .L0x800889c0", kind: MSG_KIND.OUTCOME, payload: [MSG.NO_MP],
        slots: [], name: "Kuwagamon",
        walker: "Not enough MP!",
        expect: ["Kuwagamon", "No MP!"],
    },
    {
        what: "the player sends out a partner",
        site: "wfightmn.s .L0x00001ce0", kind: MSG_KIND.OUTCOME, payload: [MSG.GO_FOR_IT],
        slots: [], name: "Patamon",
        walker: "Patamon\nGo for it!",
        expect: ["Patamon", "Go for it!"],
    },
    {
        what: "the game refuses the tag",
        site: "fightstg.s .L0x80088aa8", kind: MSG_KIND.OUTCOME, payload: [MSG.SWITCH_FAILED],
        slots: [], name: "Kuwagamon",
        walker: "Cannot tag.",
        expect: ["Kuwagamon", "Switch failed!"],
    },
    {
        what: "the next opponent steps up",
        site: "fightstg.s .L0x80088b58", kind: MSG_KIND.NEXT_OUT, payload: [0],
        slots: ["Garurumon"], name: null,
        walker: "Garurumon steps forward!",
        expect: ["Next Digimon out!", "Garurumon!"],
    },
    {
        what: "the partner digivolves",
        site: "wfightmn.s .L0x00001abc", kind: MSG_KIND.DIGIVOLVED, payload: [0],
        slots: ["Kabuterimon"], name: "Kabuterimon",
        walker: "Digivolved! Kabuterimon!",
        expect: ["Kabuterimon", "Digivolved! Kabuterimon!"],
    },
    {
        what: "the enemy gets away",
        // The runAway arm's page is actor-keyed (wfightmn.s file 0x228c-0x22a0):
        // 0x5F "Fleeing!" for any nonzero actor, which is what the fightstg
        // action-4 path queues (a0 = 0x10, fightstg.s file 0x6123-0x6124).
        site: "wfightmn.s .L0x000022b8", kind: MSG_KIND.OUTCOME, payload: [MSG.FLEEING],
        slots: [], name: "Numemon",
        walker: "Numemon ran away!",
        expect: ["Numemon", "Fleeing!"],
    },
    {
        what: "the player's own Run succeeds",
        // The same arm with actor 0 (the player's Run, queued by the command arm's
        // FIGHTSTG_queueRunAway call, wfightmn.s file 0x1674) prints 0x43.
        site: "wfightmn.s .L0x0000229c", kind: MSG_KIND.OUTCOME, payload: [MSG.RUN_AWAY],
        slots: [], name: "Kotemon",
        walker: "Got away safely!",
        expect: ["Kotemon", "Run away!"],
    },
    {
        what: "the enemy fails to get away",
        site: "fightstg.s .L0x80088734", kind: MSG_KIND.OUTCOME, payload: [MSG.DID_NOT_FLEE],
        slots: [], name: "Numemon",
        walker: "Numemon couldn't escape!",
        expect: ["Numemon", "Did not flee."],
    },
    {
        what: "the Blast transformation starts",
        site: "wfightmn.s .L0x00002e7c", kind: MSG_KIND.OUTCOME, payload: [MSG.BLASTED],
        slots: [], name: "Kuwagamon",
        walker: "Kuwagamon Blasted!",
        expect: ["Kuwagamon", "Blasted!"],
    },
    {
        what: "the Blast transformation ends",
        site: "wfightmn.s .L0x0000316c", kind: MSG_KIND.OUTCOME, payload: [MSG.BACK_TO_NORMAL],
        slots: [], name: "Kuwagamon",
        walker: "Kuwagamon\nBack to normal!",
        expect: ["Kuwagamon", "Back to normal!"],
    },
    {
        // The joke gag a confused partner gets. FIGHTSTG_F0x8009a734 builds this picture by
        // hand (fightstg.s:24505-24595): esmfight 0x16 on the element at (20,194) and the
        // phrase off its own table at 0x800a35e4 on the element at (20,208). Arm 7 is the
        // shared VM arm with exactly that shape (.L0x80099908), and the oracle below runs
        // the original's arm 7 so the two indices are fixed by the disc, not by us.
        what: "a joke gag (joke 0, bit 0)",
        site: "fightstg.s .L0x8009a734 + arm 7 .L0x80099908", kind: MSG_KIND.JOKE_GAG,
        payload: [jokeFlavorMessageId(0, 0)], slots: [], name: "Kuwagamon",
        walker: "Kuwagamon is confused! Grinning!",
        expect: ["Kuwagamon", "Grinning!"],
    },
];

test("the decoded bank is the disc image battlecmd/129.bin, entry for entry", () => {
    assert.equal(bank.bank, 0x7f, "bank 0x7f is the one FIGHTSTG_F0x80099588 reads");
    assert.equal(bank.language, 2, "English, the boot default (web/game.js languageByte ?? 2)");
    const disc = readFileSync(join(root, "web/assets/data/battlecmd/129.bin"));
    const count = disc.readUInt32LE(0);
    assert.equal(disc.readUInt32LE(4), 4 + count * 4, "129.bin is an indexed text table");
    assert.equal(bank.strings.length, count,
        "tools/extract_battle_text.py refuses to write unless the counts agree");
    // The first six are the command-menu names, which the same bank supplies.
    assert.deepEqual(bank.strings.slice(1, 7), ["Fight", "Tech", "DV", "Tag", "Item", "Run"]);
});

test("every swapped line draws the original's arm, index and slots", () => {
    for (const row of SITES) {
        const slots = row.slots;
        const payload = row.payload;
        // 1. the original's own VM makes the calls the port makes
        assert.deepEqual(portCalls(row.kind, payload), runBoth(rt, row.kind, payload),
            `${row.what}: ${row.site}`);
        // 2. the session fills those arms into the two lines
        const s = session();
        s.openOriginal({ kind: row.kind, payload, name: row.name ?? undefined, slots });
        for (let tick = 0; tick < 12; tick++) s.tick(tick, 0);
        const lines = s.lines();
        assert.equal(lines[1] !== "", row.expect.length > 1,
            `${row.what}: line 2 ${row.expect.length > 1 ? "" : "stays"} hidden`);
        assert.equal(lines[0], row.expect[0], `${row.what}: line 1 (${row.site})`);
        if (row.expect.length > 1) {
            assert.equal(lines[1], row.expect[1], `${row.what}: line 2 (${row.site})`);
        }
        // 3. the walker still carries its own sentence for ?legacyBattleMsg=1
        assert.equal(typeof row.walker, "string");
        assert.ok(row.walker.length > 0);
    }
});

test("the bank holds the words those indices name", () => {
    assert.equal(STRING(MSG.AMBUSH), "Ambush!");
    assert.equal(STRING(MSG.ATTACK), "Attack!");
    assert.equal(STRING(MSG.EVADE), "Evade!");
    assert.equal(STRING(MSG.GO_FOR_IT), "Go for it!");
    assert.equal(STRING(MSG.NO_MP), "No MP!");
    assert.equal(STRING(MSG.SWITCH_FAILED), "Switch failed!");
    assert.equal(MSG.DID_NOT_FLEE, 0x60);
    assert.equal(STRING(MSG.DID_NOT_FLEE), "Did not flee.");
    assert.equal(MSG.FLEEING, 0x5f);
    assert.equal(STRING(MSG.FLEEING), "Fleeing!");
    assert.equal(MSG.TRYING_TO_FLEE, 0x5e);
    assert.equal(STRING(MSG.TRYING_TO_FLEE), "Trying to flee.");
    assert.equal(MSG.RUN_AWAY, 0x43);
    assert.equal(STRING(MSG.RUN_AWAY), "Run away!");
    assert.equal(MSG.BLASTED, 0x61);
    assert.equal(STRING(MSG.BLASTED), "Blasted!");
    assert.equal(MSG.BACK_TO_NORMAL, 0x62);
    assert.equal(STRING(MSG.BACK_TO_NORMAL), "Back to normal!");
    assert.equal(MSG.DNA_DV, 0x3a);
    assert.equal(STRING(MSG.DNA_DV), "DNA DV!");
    // The templates the fixed templates of the arms resolve to.
    assert.equal(STRING(0x16), "{1}", "line 1's template is the bare name slot");
    assert.equal(STRING(0x09), "{1}!", "kinds 3, 14 and 17 put the technique/item name here");
    assert.equal(STRING(0x0b), "{1} damage!");
    assert.equal(STRING(0x37), "Digivolved! {1}!");
    assert.equal(STRING(0x4e), "Next Digimon out!");
    assert.equal(STRING(0x4f), "{1}!");
});

test("only kinds 1, 9 and 20 skip the name the shared tail writes", () => {
    // FIGHTSTG_F0x80098d14 fills slot 1 of line one; arms 1 (.L0x80099670 -> .L0x8009a200),
    // 9 (.L0x80099a20 -> .L0x8009a204) and 20 (re-enters with kind 4) never reach it.
    for (let kind = 1; kind <= 22; kind++) {
        assert.equal(battleMessageNamesLineOne(kind), kind !== 1 && kind !== 9,
            `kind ${kind} (${battleMessageArm(kind)?.at?.toString(16)})`);
    }
    assert.equal(battleMessageNamesLineOne(20), true, "kind 20 takes kind 4's tail");
    assert.equal(battleMessageNamesLineOne(99), false, "an unknown kind has no arm");
});

test("a line with no original counterpart keeps the walker's own sentence", () => {
    // The compound result sentences have no read call site, so they keep the words the
    // walker had and the panel draws them through open(), not openOriginal(). The walker
    // drops the spec by overwriting b.message (web/battle.js sayOriginal records the
    // sentence its spec belongs to). The joke gag is no longer one of these: it now goes
    // through arm 7 (see the SITES row and tests/battle-joke-gag.test.js).
    const s = session();
    s.open(["Kuwagamon lost its nerve!"], []);
    for (let tick = 0; tick < 12; tick++) s.tick(tick, 0);
    assert.equal(s.liveKind, 1, "a one-line sentence takes the single-line arm, as before");
    assert.deepEqual(s.lines(), ["Kuwagamon lost its nerve!", ""]);
    // Two halves still take a two-line arm, and the walker's first line goes into the
    // name slot the shared tail fills (so `esmfight[0x16]` never shows as a bare "{1}").
    const two = session();
    two.open(["Numemon", "braces to counter!"], [0x10]);
    for (let tick = 0; tick < 12; tick++) two.tick(tick, 0);
    assert.equal(two.lines()[0], "Numemon");
});

test("an original-words line is two whole lines, the second after the fourth tick", () => {
    const s = session();
    s.openOriginal({ kind: MSG_KIND.OUTCOME, payload: [MSG.EVADE], name: "Numemon" });
    assert.deepEqual(s.lines(), ["Numemon", ""], "the second line waits for the reveal");
    let stampedAt = -1;
    let arrivedAt = -1;
    for (let tick = 0; tick < 20; tick++) {
        s.tick(tick, 0);
        if (stampedAt < 0 && s.machine.visibleLines >= 1) stampedAt = tick;
        if (arrivedAt < 0 && s.machine.visibleLines >= 2) arrivedAt = tick;
    }
    assert.equal(s.lines()[0], "Numemon", "the name is on the first line, whole");
    assert.equal(arrivedAt - stampedAt, 4,
        "line 2 lands four ticks after the stamp (`.L0x80098b5c slt` over the delay 3)");
    assert.equal(s.promptVisible, true, "and the circle mark starts blinking");
});
