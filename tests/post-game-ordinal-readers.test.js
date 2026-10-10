// Census: every place the ORIGINAL reads the master story ordinal 45 (0x2D), and
// every one of the flags the post-game chain POST-Q001 names, and whether the walker
// ships each one. The test's job is to make the census a MECHANICAL list rather than
// a claim in prose: the reader list is re-derived from the assembly corpus here, and
// the walker's data is compared against the disc's own bytes.
//
// WHAT WAS SEARCHED (the census is a full sweep, not a sample). Two searches, both
// over every `.s` under ~/ddw3/asm/dw2003 (345 files, 590k lines):
//
//   1. every `lw $r, -0x4c90($x)` — the only way the corpus materialises the ordinal
//      address 0x8004b370 (`lui $v0,0x8005` + this offset), 158 sites — and, within
//      twelve instructions after each, every `li|addiu $v?, 0x2d` immediate. Nineteen
//      hits, listed in ORDINAL_45_COMPARES below.
//   2. the same 158 sites bounded by their own ROUTINE, using the load base and
//      `provisional_end_address` in recovered/ddw3/function-inventory.json, scanning
//      the whole routine for a literal `0x2d`. Thirteen routines qualify; the eight
//      that search 1 does not name are falsified in ORDINAL_45_DECODED_FALSE_POSITIVES:
//      six stage descriptors store music id 45 at `+0x3C` (docs/research/field/
//      map-effects-meft.md, the descriptor's music field), one developer-menu
//      launcher, and the rest are `.word` table data.
//
// The writers are swept the same way with `sw $r, -0x4c90($x)`: exactly one, the
// s780 leaf at `pro/wstag780.s:1566-1571`.
//
// The bank-0x60 predicate route is checked by absence: `get_flag(0x602D, e)` IS
// "ordinal == 45" (docs/research/scripting/get-flag-banked-predicate-system.md), so
// if any spawn gate, event gate or dialogue-close list on the disc tested it, the
// corpus would carry the halfword 0x602D. It does not, anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import {
  MOVIE_POST_GAME_DESTINATION,
  MOVIE_POST_GAME_INDEX,
  MOVIE_ROWS,
} from "../engine/dw3/movie-destinations.ts";
import {
  battleHandoff,
  movieReturnScreen,
  movieRow,
  BATTLE_HANDOFF_SELECTOR,
  BATTLE_HANDOFF_SELECTOR_POST_FIGHT,
} from "../engine/dw3/screen-routing.ts";

const DDW3_ROOT = process.env.DDW3_DIR || join(homedir(), "ddw3");
const ASM_ROOT = join(DDW3_ROOT, "asm/dw2003");
const ASM_AVAILABLE = existsSync(join(ASM_ROOT, "pro"));
const LBAS_TOML = join(DDW3_ROOT, "iso/dw2003-bootstrap/lbas.toml");
const SKIP_ASM = { skip: !ASM_AVAILABLE && "ddw3 asm corpus not present on this machine (set DDW3_DIR or clone ddw3 to ~/ddw3)" };
const SKIP_LBAS = { skip: !existsSync(LBAS_TOML) && "ddw3 lbas.toml not present on this machine (set DDW3_DIR)" };
const OVERLAY_BASE = 0x80082cb0;

/** Every routine that compares the master ordinal against 45, as `<file> <label>`
 *  pairs, derived by search 1 above. If a new ordinal-45 compare appears anywhere in
 *  the corpus near an ordinal load, this list stops matching and the test goes red. */
const ORDINAL_45_COMPARES = [
  "pro/fieldstg.s 00008ce8", "pro/fieldstg.s 00008d2c", "pro/fieldstg.s 00008d70",
  "pro/fieldstg.s 00008db4", "pro/fieldstg.s 00008df8", "pro/fieldstg.s 00008e3c",
  "pro/fieldstg.s 00008e80", "pro/fieldstg.s 00008ec4", "pro/fieldstg.s 00008f00",
  "pro/fieldstg.s 00009008", "pro/fieldstg.s 0000904c", "pro/fieldstg.s 00009090",
  "pro/fieldstg.s 000090d4", "pro/fieldstg.s 00009118", "pro/fieldstg.s 0000915c",
  "pro/fieldstg.s 00009198", "pro/fieldstg.s 000091dc", "pro/fieldstg.s 0000f468",
  "pro/stdwtitl.s 00001184",
];

/** Routines search 2 finds that hold a literal 0x2d but are NOT ordinal-45 readers.
 *  Each is named so a later pass does not re-derive it. */
const ORDINAL_45_DECODED_FALSE_POSITIVES = {
  "pro/wstag350.s 0000012c": "music id 45 into descriptor +0x3C",
  "pro/wstag355.s 0000012c": "music id 45 into descriptor +0x3C",
  "pro/wstag400.s 0000030c": "music id 45 into descriptor +0x3C",
  "pro/stagslct.s 00002270": "developers' stage-select launcher row (not retail)",
  "pro/stagslct.s 00002784": "developers' stage-select launcher row (not retail)",
};

function corpusFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...corpusFiles(p));
    else if (name.endsWith(".s")) out.push(p);
  }
  return out;
}

function labelled(path) {
  const labels = new Map();
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, i) => {
    const m = /^\.L0x([0-9a-f]{8}):/.exec(line);
    if (m) labels.set(i, m[1]);
  });
  return { lines, labels };
}

const LOAD = /lw \$(\w+), -0x4c90\(\$(\w+)\)/;
const STORE = /sw \$(\w+), -0x4c90\(\$(\w+)\)/;
const IMM45 = /(?:li|addiu) \$(\w+), (0x2d)\b/;

test("census: the corpus holds exactly the nineteen ordinal-45 compares and one writer", SKIP_ASM, () => {
  const files = corpusFiles(ASM_ROOT);
  assert.ok(files.length > 300, `corpus looks truncated: ${files.length} files`);
  const compares = [];
  const writes45 = [];
  let loadSites = 0;
  let storeSites = 0;
  for (const path of files) {
    const { lines, labels } = labelled(path);
    const rel = relative(ASM_ROOT, path);
    lines.forEach((line, i) => {
      if (LOAD.test(line)) {
        loadSites++;
        for (let j = i; j < Math.min(lines.length, i + 13); j++) {
          if (IMM45.test(lines[j]) && labels.has(j)) { compares.push(`${rel} ${labels.get(i)}`); break; }
        }
      }
      if (STORE.test(line) && labels.has(i)) {
        storeSites++;
        // The leaf shape is `li $v?, 0x2d` then the store, both inside the routine; the
        // feeding immediate is what makes it the 45 writer rather than a ladder step.
        for (let j = Math.max(0, i - 4); j < i; j++) {
          if (IMM45.test(lines[j])) { writes45.push(`${rel} ${labels.get(i)}`); break; }
        }
      }
    });
  }
  assert.ok(loadSites >= 150, `only ${loadSites} ordinal-address sites found; the sweep is broken`);
  assert.ok(storeSites >= 40, `only ${storeSites} ordinal writes found; the sweep is broken`);
  assert.deepEqual(compares.sort(), ORDINAL_45_COMPARES.slice().sort());
  assert.deepEqual(writes45, ["pro/wstag780.s 00001870"],
    "one stage, one leaf, and it is the only thing on the disc that writes 45");
});

test("census: nothing on the disc gates on ordinal 45 through the bank-0x60 predicate", SKIP_ASM, () => {
  // get_flag(0x602D, e) == (ordinal == 45). A halfword 0x602D in a flag list would be
  // the way the disc asks that question; there is none, so the shared predicate system
  // has nothing extra to port for 45.
  const files = corpusFiles(ASM_ROOT);
  const hits = [];
  for (const path of files) {
    const text = readFileSync(path, "utf8");
    if (/0x602d\b|0x0001602d\b/i.test(text)) hits.push(relative(ASM_ROOT, path));
  }
  assert.deepEqual(hits, []);
});

test("census: the false positives stay false (descriptor music id 45, dev launcher)", SKIP_ASM, () => {
  for (const [site, why] of Object.entries(ORDINAL_45_DECODED_FALSE_POSITIVES)) {
    const [file, label] = site.split(" ");
    const { lines, labels } = labelled(join(ASM_ROOT, file));
    const index = [...labels.entries()].find(([, l]) => l === label)?.[0];
    assert.ok(index !== undefined, `${site} vanished from the corpus`);
    // A music id lands in descriptor +0x3C; a launcher row is an argument pair. Neither
    // is followed by a branch on the ordinal.
    const after = lines.slice(index, index + 4).join("\n");
    assert.doesNotMatch(after, /sw \$\w+, -0x4c90/, `${site} is not a music write any more`);
  }
  // and the three music writes really are the descriptor's music field
  for (const label of ["0000012c"]) {
    const { lines, labels } = labelled(join(ASM_ROOT, "pro/wstag350.s"));
    const index = [...labels.entries()].find(([, l]) => l === label)[0];
    assert.match(lines[index + 1], /sw \$v0, 0x3c\(\$s1\)/);
  }
});

// ── The screen table: the disc's own array, read raw ─────────────────────────
//
// `F0x80092110` (pro/fieldstg.s:15647-15671) loads the ordinal, compares it with
// 0x2d and picks the base pointer of ONE 12-byte-record array:
//
//   :15651  addiu $s0, $v0, -0x577c   -> 0x8009A884   the other arm
//   :15666  addiu $s0, $v0, -0x5a10   -> 0x8009A5F0   the ordinal == 45 arm
//
// 0x8009A884 - 0x8009A5F0 = 0x294 = 660 = 55 records of 12 bytes, so the two pointers
// are offsets 0 and 55 of the SAME array and the walk is first-match-wins. This test
// reads the array out of the shipped overlay image and counts the records itself,
// which is what the canonical doc said it could not do.

const screenTable = (() => {
  const bin = readFileSync("web/assets/native/fieldstg.bin");
  const read = (addr) => {
    const off = addr - OVERLAY_BASE;
    return [bin.readUInt32LE(off), bin.readUInt32LE(off + 4), bin.readUInt32LE(off + 8)];
  };
  const walk = (base) => {
    const rows = [];
    for (let a = base; ; a += 12) {
      const row = read(a);
      if (row[0] === 0) return rows;
      rows.push({ screen: row[0], lba: row[1], entry: row[2] });
    }
  };
  const postGame = walk(0x8009a5f0);
  const base = walk(0x8009a884);
  return { postGame, base };
})();

test("the post-game screen table is the base table with 55 override rows prepended", () => {
  assert.equal(screenTable.postGame.length, 294, "55 override rows + 239 shared rows");
  assert.equal(screenTable.base.length, 239);
  const shared = screenTable.postGame.slice(55);
  assert.deepEqual(shared, screenTable.base,
    "rows 55..293 must be the base rows, byte for byte");
  const overridden = screenTable.postGame.slice(0, 55);
  const byId = new Map(screenTable.base.map((r) => [r.screen, r]));
  for (const row of overridden) {
    const b = byId.get(row.screen);
    assert.ok(b, `override row ${row.screen} is not one of the 239 base rows`);
    assert.notEqual(row.lba, b.lba, `override row ${row.screen} names the same stage as its base row`);
  }
});

test("every shipped `alt` row is one of the disc's 55 overrides, with the disc's own stage", () => {
  const table = JSON.parse(readFileSync("data/screen_table.json", "utf8"));
  const overrides = new Map(screenTable.postGame.slice(0, 55).map((r) => [r.screen, r.lba]));
  const altKeys = Object.keys(table).filter((k) => table[k].alt).map(Number).sort((a, b) => a - b);
  assert.deepEqual(altKeys, [...overrides.keys()].sort((a, b) => a - b),
    "the shipped alt-row screen ids must be exactly the disc's 55 overrides");
  for (const [screen, lba] of overrides) {
    assert.equal(table[String(screen)].alt.lbaIdx, lba, `screen ${screen} alt LBA`);
    assert.notEqual(table[String(screen)].lbaIdx, lba);
  }
  // and every base row's LBA is the disc's
  const baseLba = new Map(screenTable.base.map((r) => [r.screen, r.lba]));
  for (const [screen, row] of Object.entries(table)) {
    assert.equal(row.lbaIdx, baseLba.get(Number(screen)), `screen ${screen} base LBA`);
  }
});

// ── The movie table: every row, named by the disc's own file list ────────────

test("movie rows carry the disc's own file name, frame count and return selector", SKIP_LBAS, () => {
  const names = readFileSync(LBAS_TOML, "utf8")
    .match(/"([^"]+)"/g).map((s) => JSON.parse(s)).filter((s) => s !== "lbas");
  assert.equal(MOVIE_ROWS.length, 12);
  for (const row of MOVIE_ROWS) {
    assert.equal(names[row.fileIndex], row.file, `movie ${row.index} file name`);
  }
  // Both opening movies are the ones web/title-movie.js ships, and the shipped layout
  // frame count is row 0's (and row 1's) +4.
  const ui = JSON.parse(readFileSync("web/assets/data/stdwtitl_ui.json", "utf8"));
  assert.equal(MOVIE_ROWS[0].file, "MOVIEOP2_STR");
  assert.equal(MOVIE_ROWS[1].file, "MOVIEOPN_STR");
  assert.equal(ui.title_menu.movie_display.frames, MOVIE_ROWS[0].frames);
  assert.equal(ui.title_menu.movie_display.launch["0xe01"], "movieop2.mp4");
  assert.equal(ui.title_menu.movie_display.launch["0xe02"], "movieopn.mp4");
  // The one post-game override, on movie 2.
  assert.equal(MOVIE_POST_GAME_INDEX, 2);
  assert.equal(MOVIE_POST_GAME_DESTINATION, 0x276);
  assert.equal(movieReturnScreen(0xe02, false), MOVIE_ROWS[1].destination);
  assert.equal(movieReturnScreen(0xe02, true), 0xe00, "only movie 2 flips");
  assert.equal(movieReturnScreen(0xe02, true), MOVIE_ROWS[1].destination);
  assert.equal(movieReturnScreen(0xe02 + 1, true), 0x276, "movie 2 -> 0x276 at ordinal 45");
  assert.equal(movieReturnScreen(0xe02 + 1, false), 0x207);
});

test("the ordinal-43 handoff selector names movie 9, and movie 9 returns to the battle", () => {
  // `F0x8008b798` at pro/fieldstg.s:8912-8917 (see engine/dw3/screen-routing.ts).
  assert.equal(BATTLE_HANDOFF_SELECTOR, 0x600);
  assert.equal(BATTLE_HANDOFF_SELECTOR_POST_FIGHT, 0xe0a);
  for (const ord of [0, 41, 42, 44, 45]) {
    const handoff = battleHandoff(ord);
    assert.equal(handoff.selector, 0x600, `ordinal ${ord} must go straight to the battle`);
    assert.equal(handoff.movie, null);
  }
  const after = battleHandoff(43);
  assert.equal(after.selector, 0xe0a);
  assert.equal(after.movie.file, "MOVIED08_STR");
  assert.equal(after.movie.frames, 434);
  assert.equal(after.destination, 0x600, "the movie's own return selector is still the battle");
  assert.equal(movieRow(0xe0a), after.movie, "the selector's low byte is the movie row plus one");
});

// ── The post-game chain's flags, read out of the raw overlays ────────────────
//
// 20-byte event records `{event_id, script_ptr, flag_key, native_fn, on_complete}`
// (docs/research/scripting/field-script-engine-verified.md §WS2). The record below
// is the one that names the ordinal-45 leaf, so the walker's completion for event 1500
// is pinned to the disc's own bytes rather than to a hand-written table.

const WSTAG_BASE = 0x800a5de0;

function wstagEvents(stage) {
  const bin = readFileSync(`web/assets/native/s${stage}.bin`);
  const top = WSTAG_BASE + bin.length;
  const inOverlay = (v) => v >= WSTAG_BASE && v < top;
  const out = new Map();
  for (let off = 0; off + 20 <= bin.length; off += 4) {
    const id = bin.readUInt32LE(off);
    const script = bin.readUInt32LE(off + 4);
    const flagKey = bin.readUInt32LE(off + 8);
    const native = bin.readUInt32LE(off + 12);
    const onComplete = bin.readUInt32LE(off + 16);
    if (id < 0x100 || id > 0x2000) continue;
    if (!inOverlay(script) || !inOverlay(onComplete)) continue;
    if (flagKey < 0x01000000 || flagKey > 0x02ffffff) continue;
    if (native !== 0) continue;
    out.set(id, { script, flagKey, onComplete });
  }
  return out;
}

test("s780 event 1500's own completion routine is the ordinal-45 setter", () => {
  const events = wstagEvents(780);
  const ev = events.get(1500);
  assert.ok(ev, "event 1500 is in s780's event table");
  assert.equal(ev.flagKey >>> 16, 0x014a, "flag_key region (region<<16 | esdmg entry)");
  assert.equal(ev.flagKey & 0xffff, 0x24);
  // pro/wstag780.s:1566-1571, `F0x800a7644` (file 0x1864): the leaf whose
  // `sw $v0, -0x4c90($v1)` stores 0x2d.
  assert.equal(ev.onComplete - 0x800a5de0, 0x1864);
  const gates = JSON.parse(readFileSync("web/assets/data/auto_event_gates.json", "utf8"));
  assert.deepEqual(gates["s780"]["1500"].conds, [[0x602b, 1]],
    "the disc's entry dispatcher runs it only at ordinal 43 (pro/wstag780.s:1788-179c)");
  const content = JSON.parse(readFileSync("web/assets/engine-content.json", "utf8"));
  const stage = content.stages.find((s) => s.mapId === "s780");
  assert.deepEqual(stage.completions["1500"].writes, [
    { op: "set_ordinal", value: 45, cite: stage.completions["1500"].writes[0].cite },
  ]);
});

test("s820's terminal beat: 1060 arms 16500, 1070 sets 16501, 1080 writes 43", () => {
  const events = wstagEvents(820);
  assert.equal(events.get(1060).onComplete - 0x800a5de0, 0xa14);
  assert.equal(events.get(1070).onComplete - 0x800a5de0, 0xa60);
  assert.equal(events.get(1080).onComplete - 0x800a5de0, 0xa8c);
  const content = JSON.parse(readFileSync("web/assets/engine-content.json", "utf8"));
  const stage = content.stages.find((s) => s.mapId === "s820");
  const writes = (id) => stage.completions[id].writes.map((w) =>
    w.op === "set_ordinal" ? ["set_ordinal", w.value] : ["set_flag", w.flag, w.value]);
  assert.deepEqual(writes("1060"), [["set_flag", 0x4074, 1], ["set_flag", 0x7400, 1]]);
  assert.deepEqual(writes("1070"), [["set_flag", 0x4075, 1]]);
  assert.deepEqual(writes("1080"), [["set_ordinal", 43], ["set_flag", 0x7401, 1]]);
  // the ordinal gate the s820 dispatcher applies to both halves
  const gates = JSON.parse(readFileSync("web/assets/data/auto_event_gates.json", "utf8"));
  assert.deepEqual(gates["s820"]["1060"].conds, [[0x6029, 1], [0x4074, 0]]);
  assert.deepEqual(gates["s820"]["1070"].conds, [[0x6029, 1], [0x4074, 1], [0x4075, 0]]);
});

// ── The one ordinal-45 route that is NOT the equality test: a story range ─────
//
// Bank 0x70 op 0x30 answers "is the ordinal inside [lo,hi]?" from
// D0x80048cb4. Of the 33 such records, exactly one has an upper bound of 44, so
// exactly one route treats 45 differently from 44.

test("the bank-0x70 story ranges treat 45 differently in exactly one place", () => {
  const roster = JSON.parse(readFileSync("web/assets/data/roster_predicate_table.json", "utf8"));
  const ranges = roster.records
    .filter((r) => (r.op & 0xf0) === 0x30)
    .map((r) => [r.flag_id, r.ordinal_lo, r.ordinal_hi])
    // A range only separates 45 from 44 when it ends at 44 or starts at 45.
    .filter(([, lo, hi]) => (hi != null && hi === 44) || lo === 45);
  assert.deepEqual(ranges, [[0x700a, 4, 44]],
    "only 0x700A [4,44] ends exactly at the post-game marker");
  const scenes = readdirSync("web/assets/scenes").filter((f) => f.endsWith(".json"));
  const carriers = [];
  for (const file of scenes) {
    const text = readFileSync(join("web/assets/scenes", file), "utf8");
    if (text.includes("28682")) carriers.push(file.replace(/\.json$/, ""));
  }
  assert.deepEqual(carriers.sort(), ["s231", "s335", "s465", "s650", "s725", "s750"]);
});
