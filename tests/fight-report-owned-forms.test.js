// The results screen's "Digivolve learned" works on the roster record, which holds only 44
// ledger cells. A partner can own every species, so those cells are a PAGE of the real ledger.
// The rule this file pins:
//
//   * reportUnlockForm must test "already acquired" against the full ledger the walker hands in
//     (setReportOwnedForms), not the cells — otherwise the screen announces a form the player
//     already owns, once per win, forever, because the screen never writes back;
//   * the report grants at most ONE form per partner (the walker grants one per battle); when the
//     page is full addForm cannot record the grant, so the rule lives at the report boundary
//     (unlockOncePerReport) and the routine stays byte-faithful to the original;
//   * the page itself (windowLedger) keeps the current/equipped forms and covers the rest.
//
// Every value here is derived from the shipped tables: the control call finds the form the
// line grants first, and the cases differ only in whether the partner owns it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FightReportSession, unlockOncePerReport } from "../engine/dw3/ui/fight-report-session.ts";
import {
    registerExtraProfiles, extraProfileCount, PROFILE_ROWS, walkerIdOf,
} from "../engine/dw3/ui/native/pause-status.ts";
import { reportUnlockForm, setReportOwnedForms } from "../engine/dw3/ui/native/fight-report-rewards.ts";
import { windowLedger } from "../engine/dw3/ui/roster-form-state.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const D = join(root, "web/assets/data");
const bytes = (p) => new Uint8Array(readFileSync(join(D, p)));
const manifest = JSON.parse(readFileSync(join(D, "report/manifest.json"), "utf8"));
const extraPath = join(D, "extra_profiles.bin");
if (existsSync(extraPath)) registerExtraProfiles(bytes("extra_profiles.bin"));
const ALL_IDS = Array.from({ length: PROFILE_ROWS + extraProfileCount() }, (_, i) => i + 1);

function resources(language = 2) {
    const banks = new Map();
    for (const [offset, dir] of [[0x55, "report"], [0x4e, "wizard"], [0x6a, "shop-banks"], [0xa2, "pause"]]) {
        banks.set(offset + language, bytes(`${dir}/${offset + language}.bin`));
    }
    return { tables: bytes("report/tables.bin"), profiles: bytes("digimon_profiles.bin"),
        textButtons: Uint8Array.from(manifest.textButtons.bytes), font: bytes("shop_font.bin"), banks };
}
const name = (text) => [...text].map((c) => (c >= "a" ? 40 + c.charCodeAt(0) - 97 : 14 + c.charCodeAt(0) - 65));
const host = () => ({ playSound() {}, rand: () => 1234 });

/** A report session for one partner at roster slot 3 (= the fourth starter line), level 30. */
function session(ownedIds) {
    const forms = {
        digimonId: 4, equippedForms: [4, 0, 0],
        formLedger: ownedIds.map((id) => ({ id, formLevel: 99, dvexp: 0, techSlots: [0, 0, 0, 0, 0, 0] })),
    };
    const s = new FightReportSession({
        language: 2, battleId: 5, dropItemId: 0, activePosition: 0, bits: 4321, bag: [],
        members: [{ position: 0, rosterSlot: 3, nameBytes: name("Partner"), exp: 5000, level: 30, tp: 10,
            hp: 100, maxHp: 100, mp: 10, maxMp: 10, participated: true, forms }],
    }, resources(), host());
    const scratch = s.widgets.arena.alloc(0x40, 4);
    return { s, slot: 3, host: { rand: () => 0, scratch } };
}

const ownedMap = (ids) => new Map(ids.map((id) => [id, 99]));

test("an owned form outside the 44 cells is not announced as new", () => {
    // Every species owned: the cells hold one page of 44, so a cell-only test would call the
    // other entries "new" — the bug. With the full ledger handed in there is nothing to learn.
    const { s, slot, host } = session(ALL_IDS);
    setReportOwnedForms(slot, ownedMap(ALL_IDS));
    assert.equal(reportUnlockForm(s.mem, slot, host), 0, "a partner that owns every form learns nothing");
});

test("the report grants at most ONE form, and only an unowned one", () => {
    // Control: with an empty ledger the routine grants some form — the line's first passing row.
    const empty = session([]);
    setReportOwnedForms(empty.slot, new Map());
    const granted = reportUnlockForm(empty.s.mem, empty.slot, empty.host);
    assert.notEqual(granted, 0, "an empty ledger has something to learn");
    const grantedId = walkerIdOf(empty.s.mem, granted);
    assert.ok(grantedId > 0, "the granted form resolves back to a species id");

    // Own everything except that form, with the record's 44 cells already full (the page cannot
    // record the grant), so only the report-level rule stops it being handed out twice.
    const owned = ALL_IDS.filter((id) => id !== grantedId);
    const s2 = session(owned);
    setReportOwnedForms(s2.slot, ownedMap(owned));
    const unlock = unlockOncePerReport((slot) => reportUnlockForm(s2.s.mem, slot, s2.host));
    assert.equal(unlock(s2.slot), granted, "the one missing form is granted");
    assert.equal(unlock(s2.slot), 0, "one acquisition per partner per report");
});

test("the screens' 44-cell page always shows the current/equipped forms, and pages the rest", () => {
    // The report and the lab read a 44-cell page of the walker's ledger (windowLedger). The page
    // must hold the forms the screens must accept (current + equipped) on every page, and cover
    // the whole ledger by flipping pages — that is why the page can never be the truth.
    const owned = ALL_IDS.map((id) => ({ id, formLevel: 1 + (id % 5), dvexp: id, techSlots: [id, 0, 0, 0, 0, 0] }));
    const pinned = new Set([4, 144]);
    const page0 = windowLedger(owned, pinned, 0);
    assert.equal(page0.shown.length, 44, "the record's own capacity");
    assert.ok(owned.length > page0.shown.length, "this case has more forms than the record can hold");
    assert.ok(page0.shown.some((e) => e.id === 4) && page0.shown.some((e) => e.id === 144),
        "the current form and the equipped forms are always on the page");
    const page1 = windowLedger(owned, pinned, 1);
    assert.ok(page1.shown.filter((e) => !pinned.has(e.id)).every((e) => !page0.shown.some((c) => c.id === e.id)),
        "page 2 shows entries page 1 does not");
    const seen = new Set();
    for (let p = 0; p < page0.pages; p++) for (const e of windowLedger(owned, pinned, p).shown) seen.add(e.id);
    assert.equal(seen.size, owned.length, "every owned form is reachable by flipping pages");
});
