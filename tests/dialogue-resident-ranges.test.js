// The data-only dialogue ranges equal the resident image at the same addresses, and the manifest is honest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DIALOGUE_RESIDENT_RANGES, dialogueRangesFromFile, dialogueRangesFromResident } from "../engine/dw3/ui/dialogue-session.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "web/assets/data/dialogue-box");
const resident = new Uint8Array(readFileSync(join(root, "web/assets/native/screens/resident.bin")));
const blob = new Uint8Array(readFileSync(join(dir, "resident-ranges.bin")));
const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));

test("resident-ranges.bin equals resident.bin at every range", () => {
    const fromFile = dialogueRangesFromFile(blob);
    const fromResident = dialogueRangesFromResident(resident);
    assert.equal(fromFile.length, DIALOGUE_RESIDENT_RANGES.length);
    fromFile.forEach((r, i) => {
        assert.equal(r.base, fromResident[i].base);
        assert.deepEqual(r.bytes, fromResident[i].bytes);
    });
});

test("manifest rows match the ranges and the files' hashes", () => {
    const sha = (b) => createHash("sha256").update(b).digest("hex");
    assert.equal(manifest.residentRanges.sha256, sha(blob));
    manifest.residentRanges.ranges.forEach((row, i) => {
        assert.equal(row.address, DIALOGUE_RESIDENT_RANGES[i].base);
        assert.equal(row.size, DIALOGUE_RESIDENT_RANGES[i].size);
        assert.equal(row.sha256, sha(blob.subarray(row.offset, row.offset + row.size)));
    });
    for (const p of manifest.estalk) assert.equal(p.sha256, sha(readFileSync(join(dir, p.file))));
});
