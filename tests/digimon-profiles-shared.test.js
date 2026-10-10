// One Digimon profile table, cut once, read through one loader.
//
// The disc holds the table once, in the executable image at 0x8003EF5C: 0x58 bytes per
// record, and 0x8003EF5C + 55*0x58 = 0x80040244, exactly where the shop descriptor table
// begins, so 55 records is the whole of it. Five screens show a Digimon and each needs
// it - the pause pages (pro/ststatus), the fight report (pro/stfgtrep), the battle tag
// list (pro/stfgtrep), the training gym (pro/stgtrain), the Digimon lab (pro/stgdglab) -
// and the battle command list's DNA pane and Digivolve form list (pro/fightstg), which
// index it with no bound at all (fightstg.s:22014 / :18057 build 0x8003EF5C + 0x58*row).
//
// These tests hold the cut to ONE file and the 52-row scan bound to the reader that
// bounds it, because a per-screen copy is what let one screen see 52 records and another
// see 55 with nothing in the data saying so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PROFILE_ROWS, PROFILE_SCAN_ROWS } from "../engine/dw3/ui/native/pause-status.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = join(root, "web/assets/data");
const images = join(root, "web/assets/native/screens");
const bytes = (path) => new Uint8Array(readFileSync(path));
const text = (path) => readFileSync(path, "utf8");

const EXE_BASE = 0x80010000;
const PROFILES = 0x8003ef5c;
const PROFILE_STRIDE = 0x58;
/** Where the shop descriptor table starts: the profile table ends here exactly. */
const SHOP_DESCRIPTORS = 0x80040244;
/** The one cut. Shared by every screen that shows a Digimon. */
const SHARED_FILE = "digimon_profiles.bin";
/** The screens that read the table, and the adapter file each one loads through. */
const SCREENS = {
    "pause pages": "web/status-translated.js",
    "fight report": "web/fightreport-translated.js",
    "battle tag list": "web/battletag-translated.js",
    "training gym": "web/gym-translated.js",
    "digimon lab": "web/lab-translated.js",
    "battle DNA pane": "web/battledna-translated.js",
    "digivolve form list": "web/battleform-translated.js",
};
/** Each screen's own data manifest, where it records where its profile records come from. */
const MANIFESTS = {
    "pause pages": "pause/manifest.json",
    "fight report": "report/manifest.json",
    "battle tag list": "report/manifest.json",
    "training gym": "gym/manifest.json",
    "digimon lab": "lab/manifest.json",
    "battle DNA pane": "battlecmd/manifest.json",
    "digivolve form list": "battlecmd/manifest.json",
};

/** Every .bin under web/assets/data, as [assets/data-relative path, bytes]. */
function dataBinaries(dir = data, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) dataBinaries(path, out);
        else if (entry.name.endsWith(".bin")) out.push([relative(data, path).split("\\").join("/"), readFileSync(path)]);
    }
    return out;
}

test("the one cut is the disc's own 55 records and nothing else", () => {
    const resident = bytes(join(images, "resident.bin"));
    const shared = bytes(join(data, SHARED_FILE));
    assert.equal(shared.length, PROFILE_ROWS * PROFILE_STRIDE,
        `${SHARED_FILE} is 55 records of 0x58 bytes`);
    assert.equal(PROFILES + shared.length, SHOP_DESCRIPTORS,
        "the table ends exactly where the shop descriptors begin, so 55 rows is the whole table");
    assert.deepEqual([...shared], [...resident.subarray(PROFILES - EXE_BASE, PROFILES - EXE_BASE + shared.length)],
        "the file is the disc's bytes at 0x8003EF5C, not a re-typed copy");
    // Every record's +0x55 is its own 1-based row, which is also the walker's own
    // Digimon id, so the slice only lines up if it starts at 0x8003EF5C.
    for (let row = 0; row < PROFILE_ROWS; row++) {
        assert.equal(shared[row * PROFILE_STRIDE + 0x55], row + 1, `row ${row} names itself`);
    }
});

test("the 52-row bound is the reader's scan, not the table's length", () => {
    // exe/f1.s:26 `slti $v0, cur_idx, 0x34` stops the species lookup after 52 records;
    // the table itself is 55 records long and the battle screens index all of it.
    assert.equal(PROFILE_SCAN_ROWS, 0x34, "the reader walks the original's 52 records");
    assert.equal(PROFILE_ROWS, 0x37, "and the table it walks is the original's 55");
    assert.ok(PROFILE_ROWS > PROFILE_SCAN_ROWS,
        "so a screen may load all 55 rows without any screen seeing more than the original's 52");
});

test("no other data file carries a second copy of the table", () => {
    const shared = readFileSync(join(data, SHARED_FILE));
    // The 52 rows the original's own lookup walks are the shortest copy that means
    // anything, so a file carrying even those is a copy of the table: the old per-screen
    // files were cut at 52, which is exactly how a screen silently lost rows 52..54.
    const marker = shared.subarray(0, PROFILE_SCAN_ROWS * PROFILE_STRIDE);
    const carriers = [];
    for (const [path, bytes] of dataBinaries()) {
        if (bytes.includes(marker)) carriers.push(path);
    }
    assert.deepEqual(carriers, [SHARED_FILE],
        "one disc table, one file: a per-screen copy is how one screen quietly lost rows 52..54");
});

test("every screen that shows a Digimon resolves the table through the one loader", async () => {
    for (const [screen, file] of Object.entries(SCREENS)) {
        const source = text(join(root, file));
        assert.ok(/import \{[^}]*loadProfileRecords[^}]*\} from "\.\/resident-data\.js"/.test(source),
            `${screen} takes its profile records from the shared loader (${file})`);
    }
    // No screen's own data file declares the table as its own: the shared cut is the
    // one place it is named, so nothing can drift to a second copy or a second length.
    for (const [screen, manifestFile] of Object.entries(MANIFESTS)) {
        const manifest = JSON.parse(text(join(data, manifestFile)));
        assert.ok(manifest.sharedProfiles,
            `${screen} records where its profile records come from (${manifestFile})`);
        assert.deepEqual([manifest.sharedProfiles.path, manifest.sharedProfiles.rows,
            manifest.sharedProfiles.scanRows], [SHARED_FILE, PROFILE_ROWS, PROFILE_SCAN_ROWS]);
        assert.equal(manifest.species, undefined, `${screen} carries no species file of its own`);
        assert.equal(manifest.profiles, undefined, `${screen} carries no profile file of its own`);
        assert.deepEqual((manifest.resident?.ranges ?? []).filter((range) => range.role === "profiles"), [],
            `${screen} declares no profile range among its own resident ranges`);
    }
    // The loader really hands back the shared file's bytes, once per screen: a fresh
    // module instance per screen, so each one resolves the path for itself.
    const shared = bytes(join(data, SHARED_FILE));
    for (const screen of Object.keys(SCREENS)) {
        const requested = [];
        globalThis.fetch = async (url) => {
            requested.push(url);
            const file = new URL(url.replace("assets/data/", ""), "file://" + resolve(data, ".") + "/");
            return { ok: true, arrayBuffer: async () => bytes(file.pathname) };
        };
        const loader = await import(`../web/resident-data.js?screen=${encodeURIComponent(screen)}`);
        const records = await loader.loadProfileRecords(screen);
        assert.deepEqual(requested, [`assets/data/${SHARED_FILE}`],
            `${screen} asks the browser for the one cut and nothing else`);
        assert.deepEqual([...records], [...shared], `${screen} gets the table's bytes`);
    }
});

test("the battle's own DNA rule reads the pane's records under the same name", () => {
    // The DNA pane hands its profile bytes to web/battle.js, which reads them to find
    // the fused form's roster row (dnaFusedForm). That hand-off is a name, not a type,
    // so nothing else in the suites notices when the two sides disagree: renaming the
    // pane's `tables()` key on its own silently stopped the pane opening.
    const battle = text(join(root, "web/battle.js"));
    assert.ok(battle.includes("dnaTableReader(tables.profiles, tables.techniques)"),
        "battle.js reads the pane's profiles key");
    assert.ok(battle.includes("jogressFused(pairing.resultId, tables.profiles)"),
        "and hands the same key to the fused-form lookup");
    assert.ok(!battle.includes("tables.species"), "no stale tables.species read is left");
});
