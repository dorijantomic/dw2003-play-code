// The battle command family's own data files are cut out of the disc's images, so
// no battle screen loads an executable image at run time.
//
// This covers battlecmd/dna-tables.bin, the DNA pane's two shared-list configs and its
// four MP-plate x anchors at 0x800A3594..0x800A35E4 in pro/fightstg, checked against
// the committed image, which is the disc's own bytes (tools/build_native_screens.py
// writes read_overlay() and load_exe() output verbatim), so this is a byte-for-byte
// comparison with the original and not a re-reading of the walker's own numbers.
// The Digimon profile records moved to the one shared cut every screen reads
// (assets/data/digimon_profiles.bin); tests/digimon-profiles-shared.test.js holds that
// to one file, so only the loader's own reference is checked here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const data = "web/assets/data";
const screens = "web/assets/native/screens";
const raw = (path) => new Uint8Array(readFileSync(path));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const manifest = JSON.parse(readFileSync(`${data}/battlecmd/manifest.json`, "utf8"));

const FIGHT_BASE = 0x80082cb0;
const EXE_BASE = 0x80010000;
const DNA_TABLES = 0x800a3594;
const DNA_TABLES_SIZE = 0x50;

const words = (bytes, at, count) =>
    Array.from({ length: count }, (_, i) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(at + i * 4, true));

test("dna-tables.bin is the pane's own 0x50 bytes of pro/fightstg", () => {
    const image = raw(`${screens}/pro_fightstg.bin`);
    const extracted = raw(`${data}/battlecmd/dna-tables.bin`);
    assert.equal(extracted.length, DNA_TABLES_SIZE);
    assert.deepEqual([...extracted], [...image.subarray(DNA_TABLES - FIGHT_BASE, DNA_TABLES - FIGHT_BASE + DNA_TABLES_SIZE)],
        "the file is the disc's bytes at 0x800A3594, not a re-typed copy");
    assert.equal(sha256(extracted), manifest.dnaTables.sha256);
    // The values engine/dw3/ui/native/battle-dna-menu.ts reads and prints.
    assert.deepEqual(words(extracted, 0, 8), [4, 0xa8, 0x93, 0x13, 0x24, 0xa7, 0x92, 0x13]);
    assert.deepEqual(words(extracted, 0x20, 8), [2, 0xa8, 0xa6, 0x13, 0x22, 0xa7, 0xa5, 0x13]);
    assert.deepEqual(words(extracted, 0x40, 4), [172, 216, 217, 251]);
    assert.deepEqual(manifest.dnaTables.ranges.map((r) => [r.role, r.base, r.offset, r.size]), [
        ["dna-strip-config", DNA_TABLES, 0, 32],
        ["dna-option-config", DNA_TABLES + 0x20, 32, 32],
        ["dna-mp-plate-xs", DNA_TABLES + 0x40, 64, 16],
    ]);
});

test("no battle screen asks the browser for an executable image", () => {
    // resident-data.js is the shared loader both battle screens read the profile
    // table through; battledna-translated.js and battleform-translated.js are the
    // screens that call it. An assets/native request in any of them is the whole
    // defect tools/verify_translated_report.mjs checks for at run time.
    const files = [
        "web/resident-data.js",
        "web/battledna-translated.js",
        "web/battleform-translated.js",
        "web/battlecmd-translated.js",
    ];
    const offenders = [];
    for (const file of files) {
        for (const [i, line] of readFileSync(file, "utf8").split("\n").entries()) {
            // Comments name the images on purpose; a request is a quoted path.
            const quoted = line.match(/["'`]assets\/native\/[^"'`]+["'`]/g);
            if (quoted) offenders.push(`${file}:${i + 1} ${quoted.join(", ")}`);
        }
    }
    assert.deepEqual(offenders, [], "these loaders must fetch assets/data/** only");
});

test("the loaders name the two files this test just checked", () => {
    assert.match(readFileSync("web/resident-data.js", "utf8"), /fetchBytes\("digimon_profiles\.bin"/,
        "the profile table is the one shared cut (tests/digimon-profiles-shared.test.js)");
    assert.match(readFileSync("web/battledna-translated.js", "utf8"), /fetchBytes\("battlecmd\/dna-tables\.bin"/);
});