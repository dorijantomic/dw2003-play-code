// web/fight/clip-names.js — the developers' own 62 battle animation names, and the one
// clip-label table the research pages print.
//
// The list and the id arithmetic are typed in as facts from
// ddw3-walker/docs/research/battle/scene-test-tool-wfightts-2026-08-05.md: the developers'
// hidden battle scene test tool (`wfightts`) keeps a 62-entry clip picker, and its confirm
// arm stores source-index + 1 into the animation actor's slot — the same arithmetic the
// engine's op2 mode-0 handler does, so clip id 1..62 is timeline table 0..61. The names are
// the tool's own Shift-JIS labels; this module spells them exactly as the label image does
// (fullwidth digits, the fullwidth minus −, the fullwidth colon ：). No disc file is copied.
//
// What is NOT settled, and the page must keep saying: the identity between the picker's
// 62-entry source table and the engine's op2-indexed timeline array rests on the loop bound
// plus label-to-slot alignment, and the join against fightstg's own selectors is still
// `needs_evidence` (SCENE-Q002). CLIP_ID_CAVEAT below is the sentence the Codex prints.
//
// The pack counts are numbers, not guesses: `packCountsFrom` recomputes each table's count
// from the 249 shipped `web/assets/battle/models/*/anim.json` files, and
// tests/clip-names.test.js runs it over every pack and compares it with PACK_COUNTS, so a
// typed count that drifts from the assets fails the suite. A table counts as authored by a
// pack when that pack's `timeline[table].table` carries at least one frame.
//
// Pure: no DOM, no fetch, no node built-ins. The Codex imports the rows; the sound-audit and
// animation-viewer pages import clipLabel().

export const PACK_TOTAL = 249;

/** The caveat the Codex header states, in the research doc's own words. */
export const CLIP_ID_CAVEAT =
  "The tool passes a clip's list position + 1 as the engine animation id; "
  + "the join against fightstg's own selectors (SCENE-Q002) is still needs_evidence.";

// One row per animation, in the tool's own order: [jp, en, family, packs].
// `packs` = how many of the 249 model packs author `timeline[id - 1]` (computed from the
// shipped anim.json files; the test recomputes them from the files themselves).
const ROWS = [
  ["ウェイト−０", "wait (still)", "wait", 249],
  ["ウェイト−１", "wait (breathing)", "wait", 246],
  ["ガード", "guard", "guard", 246],
  ["Ｓダメージ", "small damage (flinch)", "damage", 246],
  ["Ｌダメージ−０", "large damage 0", "damage", 246],
  ["Ｌダメージ−１", "large damage 1", "damage", 158],
  ["Ｌダメージ−２", "large damage 2", "damage", 91],
  ["Ｌダメージ−３", "large damage 3", "damage", 0],
  ["Ｌダメージ−４", "large damage 4", "damage", 0],
  ["Ｌダメージ−５", "large damage 5", "damage", 0],
  ["デッド", "dead", "dead", 246],
  ["おきあがり", "get up", "get-up", 246],
  ["キメポーズ", "victory pose", "victory", 249],
  ["いかり", "anger", "anger", 53],
  ["タタカウ−０", "fight 0", "fight", 243],
  ["タタカウ−１", "fight 1", "fight", 214],
  ["タタカウ−２", "fight 2", "fight", 127],
  ["タタカウ−３", "fight 3", "fight", 126],
  ["タタカウ−４", "fight 4", "fight", 115],
  ["タタカウ−５", "fight 5", "fight", 7],
  ["ワ：ブ：１−０", "combo ワ：ブ：１, step 0", "combo", 57],
  ["ワ：ブ：１−１", "combo ワ：ブ：１, step 1", "combo", 40],
  ["ワ：ブ：１−２", "combo ワ：ブ：１, step 2", "combo", 40],
  ["ワ：ブ：１−３", "combo ワ：ブ：１, step 3", "combo", 38],
  ["ワ：ブ：１−４", "combo ワ：ブ：１, step 4", "combo", 35],
  ["ワ：ブ：１−５", "combo ワ：ブ：１, step 5", "combo", 4],
  ["ワ：ブ：２−０", "combo ワ：ブ：２, step 0", "combo", 54],
  ["ワ：ブ：２−１", "combo ワ：ブ：２, step 1", "combo", 38],
  ["ワ：ブ：２−２", "combo ワ：ブ：２, step 2", "combo", 38],
  ["ワ：ブ：２−３", "combo ワ：ブ：２, step 3", "combo", 37],
  ["ワ：ブ：２−４", "combo ワ：ブ：２, step 4", "combo", 34],
  ["ワ：ブ：２−５", "combo ワ：ブ：２, step 5", "combo", 4],
  ["ワ：ブ：３−０", "combo ワ：ブ：３, step 0", "combo", 53],
  ["ワ：ブ：３−１", "combo ワ：ブ：３, step 1", "combo", 38],
  ["ワ：ブ：３−２", "combo ワ：ブ：３, step 2", "combo", 38],
  ["ワ：ブ：３−３", "combo ワ：ブ：３, step 3", "combo", 37],
  ["ワ：ブ：３−４", "combo ワ：ブ：３, step 4", "combo", 34],
  ["ワ：ブ：３−５", "combo ワ：ブ：３, step 5", "combo", 4],
  ["ワ：マ：ウ−０", "combo ワ：マ：ウ, step 0", "ワ：マ：ウ", 101],
  ["ワ：マ：ウ−１", "combo ワ：マ：ウ, step 1", "ワ：マ：ウ", 64],
  ["ワ：マ：ウ−２", "combo ワ：マ：ウ, step 2", "ワ：マ：ウ", 2],
  ["ワ：マ：ウ−３", "combo ワ：マ：ウ, step 3", "ワ：マ：ウ", 0],
  ["ワ：マ：ウ−４", "combo ワ：マ：ウ, step 4", "ワ：マ：ウ", 0],
  ["ワ：マ：ウ−５", "combo ワ：マ：ウ, step 5", "ワ：マ：ウ", 0],
  ["ワ：マ：カ−０", "combo ワ：マ：カ, step 0", "ワ：マ：カ", 76],
  ["ワ：マ：カ−１", "combo ワ：マ：カ, step 1", "ワ：マ：カ", 76],
  ["ワ：マ：カ−２", "combo ワ：マ：カ, step 2", "ワ：マ：カ", 0],
  ["ワ：マ：カ−３", "combo ワ：マ：カ, step 3", "ワ：マ：カ", 0],
  ["ワ：マ：カ−４", "combo ワ：マ：カ, step 4", "ワ：マ：カ", 0],
  ["ワ：マ：カ−５", "combo ワ：マ：カ, step 5", "ワ：マ：カ", 0],
  ["ヒッサツ−０", "signature move 0", "hissatsu", 67],
  ["ヒッサツ−１", "signature move 1", "hissatsu", 36],
  ["ヒッサツ−２", "signature move 2", "hissatsu", 26],
  ["ヒッサツ−３", "signature move 3", "hissatsu", 13],
  ["ヒッサツ−４", "signature move 4", "hissatsu", 11],
  ["ヒッサツ−５", "signature move 5", "hissatsu", 7],
  ["ジョグレス−０", "Jogress (DNA digivolution) 0", "jogres", 10],
  ["ジョグレス−１", "Jogress (DNA digivolution) 1", "jogres", 4],
  ["ジョグレス−２", "Jogress (DNA digivolution) 2", "jogres", 1],
  ["ジョグレス−３", "Jogress (DNA digivolution) 3", "jogres", 0],
  ["ジョグレス−４", "Jogress (DNA digivolution) 4", "jogres", 0],
  ["ジョグレス−５", "Jogress (DNA digivolution) 5", "jogres", 0],
];

/** The 62 rows: {id (1..62), table (id - 1), jp, en, family, packs}. Frozen. */
export const CLIP_NAMES_62 = Object.freeze(
  ROWS.map(([jp, en, family, packs], i) =>
    Object.freeze({ id: i + 1, table: i, jp, en, family, packs })),
);

/** The typed pack count per table (index = table = id - 1). */
export const PACK_COUNTS = Object.freeze(CLIP_NAMES_62.map((r) => r.packs));

/** The group a clip id belongs to ("wait", "damage", "combo", …), or null off the list. */
export function clipFamily(id) {
  if (!Number.isInteger(id)) return null;
  return CLIP_NAMES_62[id - 1]?.family ?? null;
}

// The battle engine's 18 action slots (the vocabulary the research pages print). These are
// NOT the tool's 62 names above: the engine numbers its action scripts 0..17, and the game's
// own records name those slots, not the cut-scene test list.
const CLIP_LABELS = {
  0: "idle",
  1: "multi-hit contact",
  2: "survive",
  3: "death",
  4: "evade",
  5: "basic attack",
  6: "combo 2",
  7: "combo 3",
  8: "combo 4",
  9: "cast",
  10: "item use",
  11: "signature",
  12: "DNA presentation",
  13: "second cast",
  14: "typed item arm",
  15: "typed item arm",
  16: "typed item arm",
  17: "typed item arm",
};

/** The plain name of one engine action slot; an unknown slot says its own number. */
export function clipLabel(clip) {
  const n = Number(clip);
  if (Number.isInteger(n) && Object.hasOwn(CLIP_LABELS, n)) return CLIP_LABELS[n];
  return `clip ${clip}`;
}

/**
 * Count, per timeline table 0..61, how many of the given packs author it — a table counts
 * when `timeline[table].table` carries at least one frame. `anims` is any iterable of
 * anim.json-shaped objects (or null/undefined = 62 zeroes). Pure.
 */
export function packCountsFrom(anims) {
  const counts = new Array(62).fill(0);
  for (const anim of anims ?? []) {
    const timeline = Array.isArray(anim?.timeline) ? anim.timeline : [];
    for (let table = 0; table < 62; table++) {
      const entry = timeline[table];
      if (Array.isArray(entry?.table) && entry.table.length > 0) counts[table]++;
    }
  }
  return counts;
}
