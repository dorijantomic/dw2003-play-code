// Frame-owner test for the translated fight report (pro/stfgtrep): the whole
// screen runs as engine code over the shipped data files, with no PlayStation
// instruction. The pieces are oracle-tested against the original in
// tests/lane-b/fight-report-*.test.js and tests/form-ledger-edit-oracle.test.js;
// this file checks the composition: the payout, the participation shares, the
// two adapters, the count-up, the level curve, the private record and the failure
// behaviour, and that the session imports no interpreter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FightReportSession } from "../engine/dw3/ui/fight-report-session.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const D = join(root, "web/assets/data");
const bytes = (p) => new Uint8Array(readFileSync(join(D, p)));
const manifest = JSON.parse(readFileSync(join(D, "report/manifest.json"), "utf8"));

function resources(language = 2) {
    const banks = new Map();
    for (const [offset, dir] of [[0x55, "report"], [0x4e, "wizard"], [0x6a, "shop-banks"], [0xa2, "pause"]]) {
        banks.set(offset + language, bytes(`${dir}/${offset + language}.bin`));
    }
    return {
        tables: bytes("report/tables.bin"), profiles: bytes("digimon_profiles.bin"),
        textButtons: Uint8Array.from(manifest.textButtons.bytes), font: bytes("shop_font.bin"), banks,
    };
}

const name = (text) => [...text].map((c) => (c >= "a" ? 40 + c.charCodeAt(0) - 97 : 14 + c.charCodeAt(0) - 65));
let rng = 12345;
const host = () => ({ playSound() {}, rand: () => ((rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) >>> 8) & 0xffff });
const member = (position, extra = {}) => ({
    position, rosterSlot: position, nameBytes: name(`Digi${position}`), exp: 8188, level: 20, tp: 10,
    participated: true, ...extra,
});
const seedOf = (members, extra = {}) => ({
    language: 2, battleId: 5, dropItemId: 0, activePosition: 0, bits: 4321, bag: [], members, ...extra,
});

/** Tick with Confirm pressed every other frame until the screen retires. */
function run(session, limit = 4000) {
    let frame = 0;
    for (; frame < limit && !session.finished(); frame++) {
        session.tick(frame % 4 < 2 ? ["circle"] : [], frame + 1, 1);
    }
    assert.ok(session.finished(), `the screen must finish within ${limit} frames`);
    return frame;
}

// Battle 5 pays [dvexp 27, exp 268, bits 645] (overlay reward table 0x80086A88).
test("a solo win pays the reward table's BIT, counts the EXP up and retires", () => {
    const s = new FightReportSession(seedOf([member(0, { level: 20, exp: 8188 })]), resources(), host());
    const frames = run(s);
    assert.ok(frames > 100 && frames < 2000, `frames ${frames}`);
    assert.equal(s.bits(), 4321 + 645);
    assert.deepEqual(s.transition(), [0, 0]);
    const r = s.record(0);
    assert.equal(r.exp, 8188 + 268);
    assert.equal(r.level, 21, "the screen's level curve crosses the level-21 threshold 8288");
    assert.equal(r.tp, 15, "TP +5 per level");
    assert.deepEqual(s.displayCalls.map((c) => c.call), ["displayReset", "displayPacketSize", "displayRegion", "displayView", "viewColour"]);
    assert.ok(s.sounds.includes(0x4000b), "the level-up cue");
    assert.equal(s.tree.tasks.size, 1, "only the boot task is left in the tree");
});

test("the EXP Adapter adds a fifth to the row and the BIT Adapter adds a fifth to the payout", () => {
    const worn = { acc0: 321, acc1: 322 };
    const s = new FightReportSession(seedOf([member(0, { equipment: worn })]), resources(), host());
    run(s);
    assert.equal(s.record(0).exp, 8188 + 268 + Math.floor(268 / 5));
    assert.equal(s.bits(), 4321 + 645 + Math.floor(645 / 5));
    const plain = new FightReportSession(seedOf([member(0)]), resources(), host());
    run(plain);
    assert.equal(plain.bits(), 4321 + 645);
});

test("the participation share is 100% solo, 60% for two, one third for three", () => {
    const solo = new FightReportSession(seedOf([member(0), member(1, { participated: false })]), resources(), host());
    run(solo);
    assert.equal(solo.record(0).exp, 8188 + 268);
    assert.equal(solo.record(1).exp, 8188, "a partner who did not fight gains nothing");
    const pair = new FightReportSession(seedOf([member(0), member(1)]), resources(), host());
    run(pair);
    assert.equal(pair.record(0).exp, 8188 + 160);
    assert.equal(pair.record(1).exp, 8188 + 160);
    const trio = new FightReportSession(seedOf([member(0), member(1), member(2)]), resources(), host());
    run(trio);
    for (const p of [0, 1, 2]) assert.equal(trio.record(p).exp, 8188 + 89);
});

test("the dropped item is paid once, capped at 99, and the BIT clamps at 9,999,999", () => {
    const one = new FightReportSession(seedOf([member(0)], { dropItemId: 7, bag: [{ id: 7, held: 3, worn: 0 }] }), resources(), host());
    run(one);
    assert.equal(one.heldCount(7), 4);
    const full = new FightReportSession(seedOf([member(0)], { dropItemId: 7, bag: [{ id: 7, held: 99, worn: 0 }], bits: 9_999_500 }), resources(), host());
    run(full);
    assert.equal(full.heldCount(7), 99);
    assert.equal(full.bits(), 9_999_999);
    const none = new FightReportSession(seedOf([member(0)], { dropItemId: 0, bag: [{ id: 7, held: 3, worn: 0 }] }), resources(), host());
    run(none);
    assert.equal(none.heldCount(7), 3);
});

test("the EXP total caps at 999,999 and the count-up is skipped there", () => {
    const s = new FightReportSession(seedOf([member(0, { exp: 999_900, level: 99 })]), resources(), host());
    run(s);
    assert.equal(s.record(0).exp, 999_999);
    assert.equal(s.record(0).level, 99);
});

test("the count-up rolls its digits and lands on the total", () => {
    const s = new FightReportSession(seedOf([member(0)]), resources(), host());
    const shown = [];
    for (let frame = 0; frame < 4000 && !s.finished(); frame++) {
        s.tick(frame % 4 < 2 ? ["circle"] : [], frame + 1, 1);
        const row = s.rows()[0];
        if (row && row.shown !== shown[shown.length - 1]) shown.push(row.shown);
    }
    assert.equal(shown[0], 8188);
    assert.equal(shown[shown.length - 1], 8456);
    assert.ok(shown.length >= 5, `rolling values ${shown}`);
});

test("the screen refuses seeds the disc never builds", () => {
    assert.throws(() => new FightReportSession(seedOf([member(0)], { language: 9 }), resources(), host()), /language/);
    assert.throws(() => new FightReportSession(seedOf([]), resources(), host()), /party size/);
    assert.throws(() => new FightReportSession(seedOf([member(1)]), resources(), host()), /contiguous/);
    assert.throws(() => new FightReportSession(seedOf([member(0)], { dropItemId: 403 }), resources(), host()), /item id/);
    assert.throws(() => new FightReportSession(seedOf([member(0)]), { ...resources(), banks: new Map() }, host()), /Missing fight report text bank/);
});

test("dispose removes every task", () => {
    const s = new FightReportSession(seedOf([member(0)]), resources(), host());
    for (let frame = 0; frame < 30; frame++) s.tick([], frame + 1, 1);
    assert.ok(s.tree.tasks.size >= 2, `tasks ${s.tree.tasks.size}`);
    s.dispose();
    assert.equal(s.tree.tasks.size, 0);
});

test("the session and its ports import no interpreter and no original code", () => {
    const files = ["engine/dw3/ui/fight-report-session.ts", "engine/dw3/ui/native/fight-report-boot.ts",
        "engine/dw3/ui/native/fight-report-fade.ts", "engine/dw3/ui/native/fight-report-rewards.ts",
        "engine/dw3/form-ledger-edit.ts", "web/fightreport-translated.js"];
    for (const file of files) {
        const source = readFileSync(join(root, file), "utf8");
        assert.doesNotMatch(source, /native\/(runtime|mips|bridge|stubs)|NativeStageRuntime|native-screen\.js|native-screen-host|openNativeScreen|assets\/native/, file);
    }
});
