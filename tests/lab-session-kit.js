// Shared helpers for the Digimon lab's frame-owner tests: the shipped data files as session
// resources, a seed builder and a frame driver.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const D = join(root, "web/assets/data");
const bytes = (p) => new Uint8Array(readFileSync(join(D, p)));
const manifest = JSON.parse(readFileSync(join(D, "lab/manifest.json"), "utf8"));

export function labResources(language = 2) {
    const banks = new Map();
    const shared = { wizard: "wizard", pause: "pause" };
    for (let l = 0; l < 7; l++) {
        banks.set(0x39 + l, bytes(`lab/${0x39 + l}.bin`));
        for (const { offset, dir } of manifest.sharedBanks) banks.set(offset + l, bytes(`${shared[dir]}/${offset + l}.bin`));
    }
    return {
        tables: bytes("lab/tables.bin"), resident: bytes("lab/resident.bin"), ranges: manifest.resident.ranges,
        profiles: bytes("digimon_profiles.bin"),
        textButtons: Uint8Array.from(manifest.textButtons.bytes), font: bytes("shop_font.bin"), banks,
        catalog: JSON.parse(readFileSync(join(D, "shop_catalog.json"), "utf8")), itemRecords: bytes("shop_item_records.bin"),
        descriptors: [bytes("shop_descriptors_main.bin"), bytes("shop_descriptors_extra.bin")],
    };
}

export const name = (text) => [...text].map((c) => (c >= "a" ? 40 + c.charCodeAt(0) - 97 : 14 + c.charCodeAt(0) - 65));
export const FORMS = [383, 3, 5, 6, 12, 19, 20];
/** A member owning the starter form plus a few of the chart's forms, each with a technique row. */
export function member(slot, extra = {}) {
    const ledger = Array.from({ length: 44 }, (_, i) => (i < FORMS.length
        ? { value: FORMS[i], formLevel: 3, present: 1, dvexp: 100 * i, techniques: [0x2001 + i, 0x2010 + i, 0, 0x6020, 0, 0] }
        : null));
    return {
        slot, nameBytes: name(`Digi${slot}`), exp: 5000, level: 20, tp: 40, hp: 300, maxHp: 400, mp: 100, maxMp: 120,
        core: [100, 90, 80, 70, 60, 50], elements: [10, 20, 30, 40, 50, 60, 70], equipment: {},
        currentForm: 0, equipped: [FORMS[0], FORMS[1], 0xffff], ledger, ...extra,
    };
}
export const seedOf = (members, party, extra = {}) => ({ language: 2, party, members, returnSelector: 0x23d, ...extra });

export class Driver {
    constructor(session) { this.s = session; this.frame = 0; }
    hold(buttons, n = 1) { for (let i = 0; i < n; i++) this.s.tick(buttons, ++this.frame); }
    /** A press: two frames down, three up (the pad words see one press). */
    press(button) { this.hold([button], 2); this.hold([], 3); }
    until(test, what, limit = 3000) {
        for (let i = 0; i < limit; i++) {
            if (test()) return this.frame;
            this.hold([], 1);
        }
        throw new Error(`lab did not reach: ${what} (state ${JSON.stringify(this.s.state())}, child ${this.s.childScreen()})`);
    }
}
export const host = () => ({ playSound() {} });

/** The Select Action pane's phase word, or -1 when it is not in the tree. */
export function panePhase(session) {
    const root = [...session.tree.tasks.values()].find((t) => session.tree.classes.get(t.classId).name === "lab root");
    const pane = root ? session.mem.read32(root.children) >>> 0 : 0;
    return pane && session.tree.tasks.has(pane) ? session.mem.read32(pane + 0x10) | 0 : -1;
}

/** From the idle Select Action: choose row 0..2 and a party member, until a child screen runs. */
export function openRow(d, row) {
    d.until(() => d.s.state()?.root === 1 && d.s.state().phase === 1 && panePhase(d.s) === 3, "Select Action ready");
    for (let i = 0; i < row; i++) d.press("down");
    d.press("circle");
    for (let i = 0; i < 900 && !d.s.childScreen(); i++) {
        if (panePhase(d.s) === 15) d.press("circle");
        else d.hold([], 1);
    }
    if (!d.s.childScreen()) throw new Error(`row ${row} opened no child screen`);
}

/** The live task of a named class, or null. */
export function taskNamed(session, name) {
    return [...session.tree.tasks.values()].find((t) => session.tree.classes.get(t.classId).name === name) ?? null;
}
/** A word of a named task's object. */
export function wordOf(session, name, offset) {
    const task = taskNamed(session, name);
    return task ? session.mem.read32(task.address + offset) | 0 : null;
}
