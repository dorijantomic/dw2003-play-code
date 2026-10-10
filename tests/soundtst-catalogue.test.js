// The Sound Test's catalogue: every sound the developers' own screen can play,
// pinned entry for entry against the dump taken from the running screen.
//
// docs/research/audio/soundtst-categories.json is generated data that is also
// committed: tools/extract_soundtst.py walks the overlay's three tables
// (file 0x20c4 sound arrays / 0x2a34 array pointers / 0x2b50 category
// records; docs/research/audio/soundtst-full-decode-2026-08-05.md) and writes
// it. On 2026-10-05 the same three tables were walked out of live RAM in the
// native-screen lab (71 pointers at 0x800856e4, 72 category records at
// 0x80085800) and the committed catalogue matched the dump on all 231 ids and
// all 231 names (ledger soundtst-catalogue-and-navigation-2026-10-05; review
// AUDIO-SOUNDTST-EXTRACTION-CORRECTION-001).
//
// LIVE_DUMP below is that dump: the screen's 71 banks and all 231 sound rows
// exactly as the running instance held them (survivor file
// .dw3-research/rig-sweep-2026-10-05/lab-audio-worker.md, Appendix A). The
// catalogue must carry every one of them. The hand-kept
// soundtst-all-categories.json list this data replaces carried only 201 rows
// across 70 categories and dropped category 70 (TTLBGM) entirely.
//
// The last test regenerates the catalogue by running the extractor against the
// overlay, so a change that stops it reproducing the screen's own tables fails
// here instead of shipping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const CATALOGUE = JSON.parse(
    readFileSync(new URL("../docs/research/audio/soundtst-categories.json", import.meta.url)));

// The overlay the extractor reads; the regeneration test skips without it.
const OVERLAY = join(homedir(), "ddw3/asm/dw2003/pro/soundtst.s");

// The live dump, per category: [bank name, archive id, [[sound name, packed id], ...]].
const LIVE_DUMP = [
  // COMMON — archive 1 (113 sounds)
  ["COMMON", 1, [
    ["BT_LOOP0", "0xa004e03c"],
    ["BT_LOOP1", "0xa004e0bd"],
    ["BT_LOOP2", "0xa004e13e"],
    ["BT_LOOP3", "0xa004e1bf"],
    ["BT_LOOP4", "0xa004e240"],
    ["BT_LOOP5", "0xa004e2c1"],
    ["BT_LOOP6", "0xa004e342"],
    ["BT_LOOP7", "0xa004e3c3"],
    ["CARD_000", "0x8004603c"],
    ["CARD_001", "0x800460bd"],
    ["CARD_002", "0x8004613e"],
    ["COM_CNFS", "0x60040000"],
    ["COMAT102", "0x8004213e"],
    ["COMAT103", "0x800421bf"],
    ["COMAT104", "0xa0042240"],
    ["COMAT106", "0x80042342"],
    ["COMAT108", "0x80042444"],
    ["COMCD102", "0x8004293e"],
    ["COMCD103", "0x800429bf"],
    ["COMCD104", "0x80042a40"],
    ["COMCD105", "0x00040001"],
    ["COMCD106", "0x80042b42"],
    ["COMCD108", "0x80042c44"],
    ["COMCD109", "0x80042cc5"],
    ["COMCD110", "0x80042d46"],
    ["COMCD111", "0x80042dc7"],
    ["COMCD112", "0x80042e48"],
    ["COMCD114", "0xa0042f4a"],
    ["COMCD115", "0xa0042fcb"],
    ["COMCD200", "0xa004303c"],
    ["COMCD201", "0x800430bd"],
    ["COMCD202", "0x8004313e"],
    ["COMCD203", "0xa00431bf"],
    ["COMCD204", "0xa0043240"],
    ["COMCD205", "0x800432c1"],
    ["COMCD206", "0x80043342"],
    ["COMCD207", "0x800433c3"],
    ["COMCD209", "0x800434c5"],
    ["COMCD210", "0x80043546"],
    ["COMCD211", "0xa00435c7"],
    ["COMCD212", "0x80043648"],
    ["COMCD214", "0x8004374a"],
    ["COMCD215", "0x800437cb"],
    ["COMCD300", "0x8004383c"],
    ["COMCD304", "0x80043a40"],
    ["COMCD307", "0xa0043bc3"],
    ["COMCD308", "0xa0043c44"],
    ["COMEX101", "0x800440bd"],
    ["COMEX102", "0x8004413e"],
    ["COMEX103", "0x800441bf"],
    ["COMEX104", "0x80044240"],
    ["COMEX105", "0x800442c1"],
    ["COMEX108", "0x80044444"],
    ["COMEX111", "0x800445c7"],
    ["COMEX112", "0x80044648"],
    ["COMEX113", "0x800446c9"],
    ["COMEX114", "0x8004474a"],
    ["COMEX200", "0x8004483c"],
    ["DEMO_BGM", "0x60040002"],
    ["DIG_DEMO", "0x00040003"],
    ["DIG_MOVE", "0x80045fcb"],
    ["DIGIMENT", "0x00040004"],
    ["DIGM_DIG", "0x80045e48"],
    ["ENCOUNTS", "0x00040005"],
    ["EX_AT_LP", "0x20040006"],
    ["FUKIDASH", "0x00040007"],
    ["GAMEOVER", "0x60040008"],
    ["ITEM_GET", "0x00040009"],
    ["JINGLE01", "0x0004000a"],
    ["JINGLE02", "0x0004000b"],
    ["JINGLE03", "0x0004000c"],
    ["JINGLE04", "0x4004000d"],
    ["LRG_DOWN", "0x0004000e"],
    ["LRG_STEP", "0x0004000f"],
    ["MID_DOWN", "0x00040010"],
    ["MID_STEP", "0x00040011"],
    ["MTL_DOWN", "0x00040012"],
    ["PIYOPIYO", "0x00040013"],
    ["PLAYER00", "0x8004583c"],
    ["PLAYER01", "0x800458bd"],
    ["PLAYER02", "0x8004593e"],
    ["PLAYER03", "0x800459bf"],
    ["PLAYER04", "0x80045a40"],
    ["PLAYER05", "0x80045ac1"],
    ["PLAYER06", "0x80045b42"],
    ["PLAYER07", "0x80045bc3"],
    ["PLAYER08", "0x80045c44"],
    ["PLAYER09", "0x80045cc5"],
    ["PLAYER10", "0x80045d46"],
    ["PLAYER11", "0xa0045ec9"],
    ["RECOVERY", "0x00040014"],
    ["SAVEDEMO", "0x00040015"],
    ["SHT_DOWN", "0x00040016"],
    ["SHT_STEP", "0x00040017"],
    ["SUB_DEMO", "0x00040018"],
    ["SUB_MOVE", "0xa0045f4a"],
    ["SWITCH01", "0x8004103c"],
    ["SWITCH02", "0x800410bd"],
    ["SWITCH03", "0x8004113e"],
    ["SYSTEM00", "0x8004503c"],
    ["SYSTEM01", "0x800450bd"],
    ["SYSTEM02", "0x8004513e"],
    ["SYSTEM03", "0x00040019"],
    ["SYSTEM04", "0x0004001a"],
    ["SYSTEM05", "0x80045341"],
    ["SYSTEM06", "0x0004001b"],
    ["SYSTEM07", "0x0004001c"],
    ["SYSTEM08", "0x800454c4"],
    ["SYSTEM10", "0x800452c6"],
    ["TELEPORT", "0x0004001d"],
    ["TRESUREB", "0x80045dc7"],
    ["W_JINGLE", "0x6004001e"],
    ["WNG_STEP", "0x0004001f"],
  ]],
  // BATL00 — archive 2 (1 sound)
  ["BATL00", 2, [
    ["BATL0000", "0x60080000"],
  ]],
  // BATL10 — archive 3 (1 sound)
  ["BATL10", 3, [
    ["BATL1000", "0x600c0000"],
  ]],
  // BGM001 — archive 4 (1 sound)
  ["BGM001", 4, [
    ["ASKA_BGM", "0x60100000"],
  ]],
  // BGM002 — archive 5 (1 sound)
  ["BGM002", 5, [
    ["KANRIBGM", "0x60140000"],
  ]],
  // BGM003 — archive 6 (1 sound)
  ["BGM003", 6, [
    ["BGM_0003", "0x60180000"],
  ]],
  // BGM004 — archive 7 (1 sound)
  ["BGM004", 7, [
    ["SHOP1BGM", "0x601c0000"],
  ]],
  // BGM005 — archive 8 (1 sound)
  ["BGM005", 8, [
    ["SHOP2BGM", "0x60200000"],
  ]],
  // BGM007 — archive 9 (1 sound)
  ["BGM007", 9, [
    ["FIELDBGM", "0x60240000"],
  ]],
  // BGM008 — archive 10 (1 sound)
  ["BGM008", 10, [
    ["BGM_0008", "0x60280000"],
  ]],
  // BGM009 — archive 11 (1 sound)
  ["BGM009", 11, [
    ["PYRA_BGM", "0x602c0000"],
  ]],
  // BGM010 — archive 12 (1 sound)
  ["BGM010", 12, [
    ["SEIR_BGM", "0x60300000"],
  ]],
  // BGM011 — archive 13 (5 sounds)
  ["BGM011", 13, [
    ["BGM_0011", "0x60340000"],
    ["BULB_000", "0x00340001"],
    ["BULB_001", "0x00340002"],
    ["GONDRA_B", "0x00340003"],
    ["GONDRA_S", "0x00340004"],
  ]],
  // BGM012 — archive 14 (1 sound)
  ["BGM012", 14, [
    ["BGM_0012", "0x60380000"],
  ]],
  // BGM013 — archive 15 (2 sounds)
  ["BGM013", 15, [
    ["BGM_0013", "0x603c0000"],
    ["MASK_SET", "0x803c503c"],
  ]],
  // BGM014 — archive 16 (1 sound)
  ["BGM014", 16, [
    ["BGM_0014", "0x60400000"],
  ]],
  // BGM015 — archive 17 (3 sounds)
  ["BGM015", 17, [
    ["BGM_0015", "0x60440000"],
    ["BULB_003", "0x00440001"],
    ["BULB_004", "0x00440002"],
  ]],
  // BGM016 — archive 18 (1 sound)
  ["BGM016", 18, [
    ["BGM_0016", "0x60480000"],
  ]],
  // BGM017 — archive 19 (3 sounds)
  ["BGM017", 19, [
    ["BGM_0017", "0x604c0000"],
    ["BULB_002", "0x004c0001"],
    ["FLOOR_LT", "0x004c0002"],
  ]],
  // BGM018 — archive 20 (1 sound)
  ["BGM018", 20, [
    ["BGM_0018", "0x60500000"],
  ]],
  // BGM019 — archive 21 (4 sounds)
  ["BGM019", 21, [
    ["BEAM_HIT", "0xa054583c"],
    ["BEAM_SHT", "0x805458bd"],
    ["BGM_0019", "0x60540000"],
    ["DIGITAMA", "0x00540001"],
  ]],
  // BGM020 — archive 22 (1 sound)
  ["BGM020", 22, [
    ["BGM_0020", "0x60580000"],
  ]],
  // BGM021 — archive 23 (1 sound)
  ["BGM021", 23, [
    ["BGM_0021", "0x605c0000"],
  ]],
  // BGM022 — archive 24 (1 sound)
  ["BGM022", 24, [
    ["BGM_0022", "0x60600000"],
  ]],
  // BGM023 — archive 25 (3 sounds)
  ["BGM023", 25, [
    ["BGM_0023", "0x60640000"],
    ["TRAP_ICE", "0xa064683c"],
    ["TRAP_LGT", "0x8064703c"],
  ]],
  // BGM024 — archive 26 (1 sound)
  ["BGM024", 26, [
    ["BGM_0024", "0x60680000"],
  ]],
  // BGM025 — archive 27 (1 sound)
  ["BGM025", 27, [
    ["ON_CNBGM", "0x606c0000"],
  ]],
  // BGM026 — archive 28 (2 sounds)
  ["BGM026", 28, [
    ["BGM_0026", "0x60700000"],
    ["TRAP_OFF", "0x00700001"],
  ]],
  // BGM027 — archive 29 (1 sound)
  ["BGM027", 29, [
    ["BGM_0027", "0x60740000"],
  ]],
  // BGM028 — archive 30 (1 sound)
  ["BGM028", 30, [
    ["BGM_0028", "0x60780000"],
  ]],
  // BGM029 — archive 31 (1 sound)
  ["BGM029", 31, [
    ["BGM_0029", "0x607c0000"],
  ]],
  // BGM030 — archive 32 (1 sound)
  ["BGM030", 32, [
    ["BGM_0030", "0x60800000"],
  ]],
  // BGM031 — archive 33 (4 sounds)
  ["BGM031", 33, [
    ["TRAIN_CH", "0xa084603c"],
    ["TRAIN_NG", "0x00840000"],
    ["TRAIN_OK", "0x00840001"],
    ["TRAINING", "0x60840002"],
  ]],
  // BOSS00 — archive 34 (1 sound)
  ["BOSS00", 34, [
    ["BOSS_000", "0x60880000"],
  ]],
  // BOSS01 — archive 35 (1 sound)
  ["BOSS01", 35, [
    ["BOSS_001", "0x608c0000"],
  ]],
  // BOSS02 — archive 36 (1 sound)
  ["BOSS02", 36, [
    ["LASTBOSS", "0x60900000"],
  ]],
  // BOSS03 — archive 37 (1 sound)
  ["BOSS03", 37, [
    ["LASTB_01", "0x60940000"],
  ]],
  // BOSS04 — archive 38 (1 sound)
  ["BOSS04", 38, [
    ["LASTB_02", "0x60980000"],
  ]],
  // CBTL00 — archive 39 (5 sounds)
  ["CBTL00", 39, [
    ["CARDDMGE", "0x009c0000"],
    ["CARDFIRE", "0x009c0001"],
    ["CARDSGNL", "0x009c0002"],
    ["CARDTHND", "0x009c0003"],
    ["CBTLMAIN", "0x609c0004"],
  ]],
  // CONFUS — archive 40 (1 sound)
  ["CONFUS", 40, [
    ["CONFUSIO", "0x60a00000"],
  ]],
  // ENV001 — archive 41 (8 sounds)
  ["ENV001", 41, [
    ["BGM00000", "0x60a40000"],
    ["BGM00001", "0x60a40001"],
    ["BGM00002", "0x60a40002"],
    ["BGM00003", "0x60a40003"],
    ["DOOROPEN", "0x80a4203c"],
    ["SE000000", "0x00a40004"],
    ["SE000001", "0x00a40005"],
    ["SE000002", "0x00a40006"],
  ]],
  // ENV002 — archive 42 (1 sound)
  ["ENV002", 42, [
    ["ENV_0002", "0x60a80000"],
  ]],
  // ENV003 — archive 43 (1 sound)
  ["ENV003", 43, [
    ["ENV_0003", "0x60ac0000"],
  ]],
  // ENV004 — archive 44 (1 sound)
  ["ENV004", 44, [
    ["ENV_0004", "0x60b00000"],
  ]],
  // ENV005 — archive 45 (1 sound)
  ["ENV005", 45, [
    ["ENV05_00", "0x60b40000"],
  ]],
  // ENV006 — archive 46 (2 sounds)
  ["ENV006", 46, [
    ["ENV_0006", "0x60b80000"],
    ["INFO_SIG", "0x00b80001"],
  ]],
  // ENV007 — archive 47 (1 sound)
  ["ENV007", 47, [
    ["ENV_0007", "0x60bc0000"],
  ]],
  // ENV008 — archive 48 (1 sound)
  ["ENV008", 48, [
    ["ENV_0008", "0x60c00000"],
  ]],
  // ENV009 — archive 49 (1 sound)
  ["ENV009", 49, [
    ["ENV_0009", "0x60c40000"],
  ]],
  // ENV010 — archive 50 (1 sound)
  ["ENV010", 50, [
    ["ENV10_00", "0x60c80000"],
  ]],
  // ENV011 — archive 51 (2 sounds)
  ["ENV011", 51, [
    ["ENV_0011", "0x60cc0000"],
    ["LOGINEF", "0x00cc0001"],
  ]],
  // ENV012 — archive 52 (1 sound)
  ["ENV012", 52, [
    ["ENV_0012", "0x60d00000"],
  ]],
  // ENV013 — archive 53 (1 sound)
  ["ENV013", 53, [
    ["ENV_0013", "0x60d40000"],
  ]],
  // ENV014 — archive 54 (1 sound)
  ["ENV014", 54, [
    ["ENV_0014", "0x60d80000"],
  ]],
  // ENV015 — archive 55 (1 sound)
  ["ENV015", 55, [
    ["ENV_0015", "0x60dc0000"],
  ]],
  // ENV016 — archive 56 (1 sound)
  ["ENV016", 56, [
    ["ENV_0016", "0x60e00000"],
  ]],
  // ENV017 — archive 57 (1 sound)
  ["ENV017", 57, [
    ["ENV_0017", "0x60e40000"],
  ]],
  // ENV018 — archive 58 (2 sounds)
  ["ENV018", 58, [
    ["ENV_0018", "0x60e80000"],
    ["WEAR_OFF", "0x80e8383c"],
  ]],
  // ENV019 — archive 59 (2 sounds)
  ["ENV019", 59, [
    ["ENV_0019", "0x60ec0000"],
    ["FLOOR_DN", "0x00ec0001"],
  ]],
  // ENV020 — archive 60 (1 sound)
  ["ENV020", 60, [
    ["ENV_0020", "0x60f00000"],
  ]],
  // ENV021 — archive 61 (1 sound)
  ["ENV021", 61, [
    ["ENV_0021", "0x60f40000"],
  ]],
  // ENV022 — archive 62 (1 sound)
  ["ENV022", 62, [
    ["ENV_0022", "0x60f80000"],
  ]],
  // ENV023 — archive 63 (1 sound)
  ["ENV023", 63, [
    ["ENV_0023", "0x60fc0000"],
  ]],
  // ENV024 — archive 64 (5 sounds)
  ["ENV024", 64, [
    ["CCOMBINE", "0x8100383c"],
    ["DOORCLSE", "0x8100303c"],
    ["ENTRY_02", "0x01000000"],
    ["ENV_0024", "0x61000001"],
    ["SIGNALON", "0x01000002"],
  ]],
  // ENV025 — archive 65 (1 sound)
  ["ENV025", 65, [
    ["ENV_0025", "0x61040000"],
  ]],
  // ENV204 — archive 66 (3 sounds)
  ["ENV204", 66, [
    ["EAUCTION", "0x61080000"],
    ["ELEVATER", "0x01080001"],
    ["ENV_0204", "0x61080002"],
  ]],
  // ENV205 — archive 67 (5 sounds)
  ["ENV205", 67, [
    ["DIGI_EN0", "0x010c0000"],
    ["DIGI_EN1", "0x010c0001"],
    ["DIGI_EN2", "0x010c0002"],
    ["ENV_0205", "0x610c0003"],
    ["GAYALOOP", "0xa10c703c"],
  ]],
  // ENV206 — archive 68 (6 sounds)
  ["ENV206", 68, [
    ["BM_ERASE", "0x01100000"],
    ["ENV_0206", "0x61100001"],
    ["LD_ERASE", "0x01100002"],
    ["LD_VACUM", "0x811031bf"],
    ["SN_ENTRY", "0x8110303c"],
    ["SN_ERASE", "0x81103240"],
  ]],
  // EVO_00 — archive 69 (1 sound)
  ["EVO_00", 69, [
    ["EVOLUTIO", "0x41140000"],
  ]],
  // JOG_00 — archive 70 (1 sound)
  ["JOG_00", 70, [
    ["JOGRESSE", "0x41180000"],
  ]],
  // TTLBGM — archive 71 (1 sound)
  ["TTLBGM", 71, [
    ["TITLEBGM", "0x611c0000"],
  ]],
];

/** Every category and every sound must be the one the running screen dumped. */
function assertCatalogueMatchesDump(cats, label) {
    assert.equal(cats.length, LIVE_DUMP.length, `${label}: 71 categories`);
    LIVE_DUMP.forEach(([name, archive, sounds], i) => {
        const cat = cats[i];
        assert.equal(cat.category, i, `${label}: row ${i} is category ${i}`);
        assert.equal(cat.name, name, `${label}: category ${i} name`);
        assert.equal(cat.archive_id, archive, `${label}: category ${i} (${name}) archive id`);
        assert.equal(cat.count, sounds.length, `${label}: category ${i} (${name}) count`);
        assert.deepEqual(cat.sounds, sounds.map(([n, id]) => ({ name: n, id })),
            `${label}: category ${i} (${name}): the sound rows`);
    });
}

test("the catalogue is the screen's own 71 banks and 231 sounds", () => {
    assert.equal(CATALOGUE.categoryCount, 71, "categoryCount");
    assert.equal(CATALOGUE.soundCount, 231, "soundCount");
    assert.equal(CATALOGUE.categories.length, 71, "category records");
    assert.equal(CATALOGUE.categories.reduce((n, c) => n + c.sounds.length, 0), 231,
        "one row per sound across every category");
    // The screen's own shape: COMMON first with 113 sounds (a dump with a cap
    // silently truncates it), and no packed id anywhere twice.
    assert.equal(CATALOGUE.categories[0].name, "COMMON");
    assert.equal(CATALOGUE.categories[0].archive_id, 1);
    assert.equal(CATALOGUE.categories[0].count, 113);
    const ids = CATALOGUE.categories.flatMap((c) => c.sounds.map((s) => s.id));
    assert.equal(new Set(ids).size, ids.length, "zero duplicate packed ids");
    // The three tables tile exactly -- arrays 0x20c4..0x2a34, pointers
    // 0x2a34..0x2b50, records 0x2b50..0x2d90 -- which is what fixes the
    // category count at 71 (tools/extract_soundtst.py asserts the same).
    const arrays = CATALOGUE.categories.map((c) => parseInt(c.array_file_offset, 16));
    assert.equal(arrays[0], 0x20c4, "the first sound array");
    assert.deepEqual(arrays, [...arrays].sort((a, b) => a - b),
        "the arrays follow the pointer table's order");
    assert.equal(arrays[arrays.length - 1] + (CATALOGUE.categories[70].count + 1) * 8,
        0x2a34, "the last array ends where the pointer table begins");
});

test("every category and every sound is the one the running screen dumped", () => {
    assertCatalogueMatchesDump(CATALOGUE.categories, "committed catalogue");
});

test("category 70 is TTLBGM, the title bank the old list never had", () => {
    const cat = CATALOGUE.categories[70];
    assert.equal(cat.name, "TTLBGM");
    assert.equal(cat.archive_id, 71);
    assert.equal(cat.count, 1);
    assert.deepEqual(cat.sounds, [{ name: "TITLEBGM", id: "0x611c0000" }]);
});

test("the extractor regenerates the committed catalogue from the overlay, entry for entry",
    { skip: existsSync(OVERLAY) ? false
        : `${OVERLAY} is not present; the live-dump checks above still ran` },
    () => {
        const scratch = join(ROOT, ".bunny-scratch/soundtst-catalogue");
        rmSync(scratch, { recursive: true, force: true });
        mkdirSync(scratch, { recursive: true });
        const out = join(scratch, "soundtst-categories.json");
        // tools/extract_soundtst.py writes its OUT directly; load it as a
        // module and point OUT at the scratch file so a test run never touches
        // the committed catalogue.
        execFileSync(join(ROOT, ".venv/bin/python3"), ["-c", `
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("extract_soundtst", "tools/extract_soundtst.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.OUT = pathlib.Path(sys.argv[1])
mod.main()
`, out], { cwd: ROOT, encoding: "utf8" });
        const regenerated = JSON.parse(readFileSync(out, "utf8"));
        assert.equal(regenerated.categoryCount, 71);
        assert.equal(regenerated.soundCount, 231);
        assertCatalogueMatchesDump(regenerated.categories, "regenerated catalogue");
        assert.deepEqual(regenerated.categories, CATALOGUE.categories,
            "the regenerated catalogue must equal the committed one, entry for entry");
        rmSync(scratch, { recursive: true, force: true });
    });
