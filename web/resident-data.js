// Browser loaders for the resident text data that the translated screens share: the UI font
// (shop_font.bin), the resident RAM ranges (dialogue-box/resident-ranges.bin) and the cursor glyph
// table (shop_catalog.json cursorGlyphs). The result is the ResidentTextResources object that
// engine/dw3/ui/resident-text-host.ts loadResidentResources installs. One cache serves every screen.
// Also the ESDMG entry reader (the cutscene SAY bank) that the dialogue and Yes/No screens use.
// It never executes original instructions and never requests an executable asset.
import { ui } from "./vendor/engine.js";

const RESIDENT_LABEL = "Resident data";

/** Fetch assets/data/<path> as bytes. `label` names the screen in the error. */
export const fetchBytes = async (path, label) => {
    const response = await fetch(`assets/data/${path}`);
    if (!response.ok) throw new Error(`${label} ${path}: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
};

/** Fetch assets/data/<path> as JSON. `label` names the screen in the error. */
export const fetchJson = async (path, label) => {
    const response = await fetch(`assets/data/${path}`);
    if (!response.ok) throw new Error(`${label} ${path}: ${response.status}`);
    return response.json();
};

let residentPromise = null;
/** The font, the resident ranges and the cursor glyphs: { font, ranges, cursorGlyphs }. Cached; a failure clears the cache. */
export const loadResidentResources = () => {
    residentPromise ??= Promise.all([
        fetchBytes("shop_font.bin", RESIDENT_LABEL),
        fetchBytes("dialogue-box/resident-ranges.bin", RESIDENT_LABEL),
        fetchJson("shop_catalog.json", RESIDENT_LABEL),
    ])
        .then(([font, ranges, catalog]) => {
            // Install the cursor glyph table into the shared loader ONCE, so no screen has to
            // remember to forward it into its own resources (engine/dw3/ui/resident-text-host.ts
            // setDefaultCursorGlyphs). Without it a screen's selection cursor builds its glyph
            // child with a null string and draws nothing. Optional call: a bundle built before
            // this function existed still boots (every cursor screen also forwards the table).
            ui.setDefaultCursorGlyphs?.(catalog.cursorGlyphs);
            return { font, ranges: ui.dialogueRangesFromFile(ranges), cursorGlyphs: catalog.cursorGlyphs };
        })
        .catch((error) => { residentPromise = null; throw error; });
    return residentPromise;
};

const fileCache = new Map();
/** The bytes of dialogue-box/<file>.bin. Cached; a failure clears that file's entry. */
export const loadDialogueFile = (file, label) => {
    const name = `dialogue-box/${file}.bin`;
    if (!fileCache.has(name)) fileCache.set(name, fetchBytes(name, label).catch((e) => { fileCache.delete(name); throw e; }));
    return fileCache.get(name);
};

// The Digimon profile table, the one disc table every screen showing a Digimon reads:
// the pause pages, the fight report and the battle tag list, the training gym, the
// Digimon lab, and the battle command list's DNA pane and Digivolve form list. It lives
// in the resident executable image (base 0x80010000), so the data build cuts it out of
// it ONCE - assets/data/digimon_profiles.bin is those 55 records and nothing else - and
// no screen loads the image. 55 is the table's whole length (0x8003EF5C + 55*0x58 =
// 0x80040244, and the shop descriptor table follows at 0x80040244), so a form with no
// row in it is a form the game itself has no record of. The 52-record bound is the
// LOOKUP's, not the table's: the species getter F0x800134AC stops at `slti $v0, cur_idx,
// 0x34` (exe/f1.s:26), and that bound lives with the reader that walks it
// (engine/dw3/ui/native/pause-status.ts PROFILE_SCAN_ROWS), never in the data.
const PROFILE_RECORDS = 0x37;
const PROFILE_STRIDE = 0x58;
let profilePromise = null;
/** The 55 profile records, 0x58 bytes each, for every screen that shows a Digimon. Cached; a failure clears the cache. */
export const loadProfileRecords = (label) => {
    profilePromise ??= fetchBytes("digimon_profiles.bin", label)
        .then((records) => {
            if (records.length !== PROFILE_RECORDS * PROFILE_STRIDE) {
                throw new Error(`${label} profile table is ${records.length} bytes, not 55 records`);
            }
            return records;
        })
        .catch((error) => { profilePromise = null; throw error; });
    return profilePromise;
};

/** One entry of an ESDMG file (the cutscene SAY bank): [u32 entry offsets], each entry a [count][offsets] pack. */
export const loadEsdmgEntry = async (file, entry, label) => {
    const data = await loadDialogueFile(file, label);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const entries = view.getUint32(0, true) / 4;
    if (!(entry >= 0 && entry < entries)) throw new Error(`${label} ${file}: no entry ${entry}`);
    const start = view.getUint32(entry * 4, true);
    const end = entry + 1 < entries ? view.getUint32((entry + 1) * 4, true) : data.length;
    return data.subarray(start, end);
};
