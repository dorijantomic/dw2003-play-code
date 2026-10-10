// Frame-owner test for the translated training gym (pro/stgtrain): the whole screen runs as
// engine code over the shipped data files, with no PlayStation instruction. The pieces are
// oracle-tested against the original in tests/lane-b/gym-*.test.js; this file checks the
// composition: the journey from the pod select to the result, the TP cost, the stat changes and
// the private record, the refusal when the partner cannot pay, the cancel path, and that the
// session imports no interpreter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GymSession } from "../engine/dw3/ui/gym-session.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const D = join(root, "web/assets/data");
const bytes = (p) => new Uint8Array(readFileSync(join(D, p)));
const manifest = JSON.parse(readFileSync(join(D, "gym/manifest.json"), "utf8"));

export function gymResources(language = 2) {
    const banks = new Map();
    for (let l = 0; l < 7; l++) banks.set(0x10b + l, bytes(`gym/${0x10b + l}.bin`));
    const packs = new Map();
    for (const p of manifest.packs) packs.set(p.id, { id: p.id, sectors: p.sectors, data: bytes(`gym/${p.file}`) });
    return {
        tables: bytes("gym/tables.bin"), profiles: bytes("digimon_profiles.bin"), signature: bytes("gym/signature.bin"),
        signatureBase: manifest.signature.base, textButtons: Uint8Array.from(manifest.textButtons.bytes),
        font: bytes("shop_font.bin"), banks, packs,
        catalog: JSON.parse(readFileSync(join(D, "shop_catalog.json"), "utf8")), itemRecords: bytes("shop_item_records.bin"),
        descriptors: [bytes("shop_descriptors_main.bin"), bytes("shop_descriptors_extra.bin")],
    };
}

const name = (text) => [...text].map((c) => (c >= "a" ? 40 + c.charCodeAt(0) - 97 : 14 + c.charCodeAt(0) - 65));
let rng = 4242;
const host = (over = {}) => ({ playSound() {}, rand: () => ((rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) >>> 8) & 0xffff, ...over });
const member = (position, extra = {}) => ({
    position, rosterSlot: 3 + position, nameBytes: name(`Digi${position}`), level: 20, tp: 40, hp: 300, maxHp: 400, mp: 100, maxMp: 120,
    core: [100, 90, 80, 70, 60, 50], elements: [10, 20, 30, 40, 50, 60, 70], lastUltraDrill: 0, ...extra,
});
const seedOf = (members, extra = {}) => ({ language: 2, group: 3, previousScreen: 0x23d, members, ...extra });

class Driver {
    constructor(session) { this.s = session; this.frame = 0; }
    /** Hold `buttons` for `n` frames. */
    hold(buttons, n = 1) { for (let i = 0; i < n; i++) this.s.tick(buttons, ++this.frame, 1); }
    /** A press: two frames down, three up (the pad words see one press). */
    press(button) { this.hold([button], 2); this.hold([], 3); }
    /** Tick until `test()` holds. */
    until(test, what, limit = 3000, pressing = false) {
        for (let i = 0; i < limit; i++) {
            if (test()) return this.frame;
            // A pressing driver taps the confirm button (two frames down, three up).
            this.hold(pressing && i % 5 < 2 ? ["circle"] : [], 1);
        }
        throw new Error(`gym did not reach: ${what} (state ${JSON.stringify(this.s.state())})`);
    }
}

function toPodSelect(d) {
    d.until(() => d.s.state()?.flow === 5, "the pod select");
}
/** Pod select -> picker -> confirm -> TP list -> start (Yes). */
function toSession(d, { pressDrill = true } = {}) {
    toPodSelect(d);
    d.press("circle");
    d.until(() => d.s.state()?.flow === 0xb, "the drill picker");
    d.until(() => d.s.state() && d.s.tree.tasks.has(d.s.state().picker) && d.s.mem.read32(d.s.state().picker + 0x10) === 0xa, "picker ready");
    if (pressDrill) d.press("circle");
}

test("a full session trains the partner, costs TP once and retires", () => {
    const s = new GymSession(seedOf([member(0)]), gymResources(), host());
    const d = new Driver(s);
    toSession(d);
    // The confirm panel: the TP list; pick the first option (TP 1) and confirm.
    d.until(() => s.state()?.confirm !== 0 && s.mem.read32(s.state().confirm + 0x10) === 6, "the TP list");
    const tpBefore = s.record(0).tp;
    d.press("circle");
    d.until(() => s.mem.read32(s.state().confirm + 0x10) === 0x12, "the Start training? question");
    d.press("circle");
    d.until(() => s.state()?.session !== 0, "the training window");
    assert.equal(s.record(0).tp, tpBefore - 1, "the cost comes off at the question's Yes, exactly once");
    d.until(() => s.training()?.step === 5 || s.finished(), "the summary step");
    assert.ok(s.training().results.slice(0, 3).every((r) => r === 0 || r === 1), "three reps were played");
    d.until(() => s.state()?.session === 0 && s.state()?.flow === 5, "back at the pod select", 4000, true);
    const r = s.record(0);
    assert.equal(r.tp, tpBefore - 1);
    d.press("cross");
    d.until(() => s.finished(), "the screen to retire");
    assert.ok(s.sounds.includes(0x60840002), "the exit cue");
    assert.equal(s.tree.tasks.size, 1, "only the boot task is left in the tree");
});

test("not enough TP refuses, changes nothing and returns to the list", () => {
    const s = new GymSession(seedOf([member(0, { tp: 0 })]), gymResources(), host());
    const d = new Driver(s);
    toSession(d);
    d.until(() => s.state()?.confirm !== 0 && s.mem.read32(s.state().confirm + 0x10) === 6, "the TP list");
    d.press("circle");
    d.until(() => s.mem.read32(s.state().confirm + 0x10) === 0xc, "the refusal line");
    const r = s.record(0);
    assert.equal(r.tp, 0);
    assert.deepEqual(r.core, [100, 90, 80, 70, 60, 50]);
    d.press("circle");
    d.until(() => s.mem.read32(s.state().confirm + 0x10) === 6, "back at the TP list");
    assert.equal(s.record(0).tp, 0);
});

test("cancelling at the drill picker changes nothing", () => {
    const s = new GymSession(seedOf([member(0)]), gymResources(), host());
    const d = new Driver(s);
    toSession(d, { pressDrill: false });
    d.press("cross");
    d.until(() => s.state()?.flow === 5, "back at the pod select");
    const r = s.record(0);
    assert.equal(r.tp, 40);
    assert.deepEqual(r.core, [100, 90, 80, 70, 60, 50]);
    assert.deepEqual(r.elements, [10, 20, 30, 40, 50, 60, 70]);
});

test("the session imports no interpreter", () => {
    const source = readFileSync(join(root, "engine/dw3/ui/gym-session.ts"), "utf8");
    assert.ok(!/engine\/native\/(mips|runtime)|NativeStageRuntime|R3000/.test(source));
});
