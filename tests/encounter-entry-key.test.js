// Family-B zone groups — the live record is chosen by the ENTRY WARP's own parameter.
//
// Authority: original SLES-03936 assembly + the shipped extracted tables.
//   * pro/fieldstg.s: the warp executor F0x800885d4's active ("opcode 1") case stores
//     cmd+0x14 -> 0x80048d78 and cmd+0x16 -> 0x80048d7a, unconditionally, at the case's
//     convergence point RAM 0x800886b8-0x800886dc. Second writer: F0x8008aa10.
//   * The step record holds `op` at +0x8 and params[i] at 0xa+2i, so params[5] IS the
//     +0x14 field and params[6] the +0x16 field.
//   * Each family-B stage's init hands its record table to the scene_struct+0x7c helper,
//     which matches a record's `key` word against [0x80048d78].
//
// So: which door you enter by selects which of the stage's zone-block groups is live.
// Ledger: encounter-zone-group-key-written-on-map-transition (partially_verified),
// evidence EV-encounter-zone-group-key-writer-found-2026-07-27 and
// EV-encounter-zone-group-key-is-entry-warp-2026-07-27.
//
// These run against the SHIPPED data, so they lock the real numbers, not a fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encounterGroupIndex, stageZoneBlocks, selectScreenId,
} from "../engine/index.ts";

const ENC = JSON.parse(readFileSync("web/assets/data/stage_encounters.json", "utf8"));
const STEPS = JSON.parse(readFileSync("web/assets/data/story_steps.json", "utf8")).stages;
const SCREENS = JSON.parse(readFileSync("data/screen_table.json", "utf8"));

const stage = (n) => ENC.stages[String(n)];
const slot0 = () => 0;
// Destination resolution must be ALIAS-AWARE: for source stages >= 920 a screen
// resolves through its `alt` entry, exactly as tools/gen_scenes.py stage_for_screen
// does. Resolving s922's warps through the plain table reports them landing in the
// ordinary world (s830) and makes valid keys look invalid.
function resolveDest(screen, src) {
  const e = SCREENS[String(screen)];
  if (!e) return undefined;
  if (Number(src) >= 920 && e.alt?.stage != null) return String(e.alt.stage);
  return e.stage == null ? undefined : String(e.stage);
}

/**
 * Every group-selecting entry warp in the shipped step data.
 *
 * op=9 and op=10 are the two that carry a key: across all 633 step records these
 * two ops have a NONZERO params[5] in 42 of 42 cases and every other op has zero
 * in all but one. Both are dispatched by fieldstg's step handler through the
 * field-character vtable slot +0x124 with `cmd+0xa` (the params pointer) as a1,
 * which is the pointer site B later reads as [$s4+0x7c].
 */
function entryWarps() {
  const out = [];
  for (const [src, v] of Object.entries(STEPS))
    for (const st of v.steps ?? [])
      if (st.op === 9 || st.op === 10) {
        const dst = resolveDest(st.params[0], src);
        if (dst) out.push({ src, dst, op: st.op, key: st.params[5], params: st.params });
      }
  return out;
}

// --------------------------------------------------------------------------
// The worked example: the Seabed s825 (screen 736) from two different areas.
// Same destination, same spawn point, different params[5].
// --------------------------------------------------------------------------
test("s825 — the two Seabed entrances carry different group keys", () => {
  const into825 = entryWarps().filter((w) => w.dst === "825");
  const from320 = into825.find((w) => w.src === "320");
  const from525 = into825.find((w) => w.src === "525");
  assert.ok(from320 && from525, "both Seabed entrances present in step data");

  // Identical destination screen and spawn point...
  assert.deepEqual(from320.params.slice(0, 4), [736, 576, 216, 1]);
  assert.deepEqual(from525.params.slice(0, 4), [736, 576, 216, 1]);
  // ...differing only in the group key at params[5].
  assert.equal(from320.key, 2);
  assert.equal(from525.key, 7);

  const s = stage(825);
  assert.equal(s.selector.family, "runtime_key");
  const keys = s.groups.map((g) => g.key);
  assert.ok(keys.includes(2) && keys.includes(7), `s825 keys ${keys}`);

  // Each key selects a DIFFERENT record, and therefore different blocks.
  const g2 = encounterGroupIndex(s, 0, 2);
  const g7 = encounterGroupIndex(s, 0, 7);
  assert.notEqual(g2, g7);
  assert.equal(s.groups[g2].key, 2);
  assert.equal(s.groups[g7].key, 7);
  assert.notDeepEqual(stageZoneBlocks(s, 0, 2), stageZoneBlocks(s, 0, 7));
});

// --------------------------------------------------------------------------
// Corpus properties — the two facts that make this more than a coincidence.
// --------------------------------------------------------------------------
test("keyed warps overwhelmingly target multi-group stages (152 of 157)", () => {
  // Corrected 2026-07-27. The earlier "42 of 42, none otherwise" was measured on
  // the 98-stage step corpus; with 287 stages covered it is 152 of 157. The five
  // exceptions target s961/s962/s965, which carry at most one selector group.
  const ws = entryWarps();
  assert.equal(ws.length, 157, "keyed warps with a resolvable destination");
  const multi = ws.filter((w) => (stage(w.dst)?.groups ?? []).length > 1);
  assert.equal(multi.length, 152);
  for (const w of ws.filter((x) => !multi.includes(x)))
    assert.ok(["961", "962", "965"].includes(w.dst), `unexpected exception -> s${w.dst}`);
});

test("entry keys are always one of the destination's own group keys", () => {
  // Scoped to destinations that HAVE groups: the five warps into s961/s962/s965
  // carry a key but their destination has at most one selector record, so there is
  // no key set to be a member of. 152 of 152 where the property is meaningful.
  let checked = 0;
  for (const w of entryWarps()) {
    const groups = stage(w.dst)?.groups;
    if (!groups || groups.length < 2) continue;
    const keys = groups.map((g) => g.key);
    assert.ok(keys.includes(w.key),
      `s${w.src} -> s${w.dst} key ${w.key} not in ${JSON.stringify(keys)}`);
    checked++;
  }
  assert.equal(checked, 152);
});

test("every key-carrying op has a nonzero key; other ops do not", () => {
  let carrying = 0, other = 0;
  for (const v of Object.values(STEPS))
    for (const st of v.steps ?? [])
      if (st.op === 9 || st.op === 10) { assert.ok(st.params[5] > 0); carrying++; }
      else if (st.params[5]) other++;
  assert.equal(carrying, 157);
  assert.ok(other <= 4, `only the few known non-keyed-op exceptions, got ${other}`);
});

test("one destination is reached under several DIFFERENT keys", () => {
  // FALSIFIED and replaced 2026-07-27. On the 98-stage corpus every entrance to a
  // given stage carried a distinct key, and that was recorded as the substantive
  // property. With 287 stages covered it is FALSE: s850 is entered with key 1 from
  // both s330 and s450, and s865 with key 7 from both s396 and s695. Two surface
  // doors can drop the player into the same maze section, so the key identifies the
  // SECTION, not the door. What actually holds is that a destination is reached
  // under more than one key -- which is what makes the group selection observable.
  const byDst = new Map();
  for (const w of entryWarps()) {
    if (!byDst.has(w.dst)) byDst.set(w.dst, new Set());
    byDst.get(w.dst).add(w.key);
  }
  const multiKey = [...byDst].filter(([d, ks]) =>
    (stage(d)?.groups ?? []).length > 1 && ks.size > 1);
  assert.ok(multiKey.length >= 5,
    `expected several stages reachable under >1 key, got ${multiKey.length}`);
});

// --------------------------------------------------------------------------
// Selection behaviour, including the fallbacks that must NOT regress.
// --------------------------------------------------------------------------
test("an unknown or absent entry key falls back to group 0", () => {
  const s = stage(825);
  assert.equal(encounterGroupIndex(s, 0, undefined), 0);
  assert.equal(encounterGroupIndex(s, 0, 9999), 0);
  assert.equal(stageZoneBlocks(s, 0, undefined), s.groups[0].blocks);
});

test("the entry key does not disturb progress_ordinal stages", () => {
  // s335 is family A: its group comes from the story ordinal, and an entry key
  // must be ignored entirely.
  const s = stage(335);
  assert.equal(s.selector.family, "progress_ordinal");
  for (const key of [undefined, 1, 2, 7, 12]) {
    assert.equal(encounterGroupIndex(s, 5, key), 0);
    assert.equal(encounterGroupIndex(s, 11, key), 1);
    assert.equal(encounterGroupIndex(s, 24, key), 2);
  }
});

test("single-group stages ignore the entry key and stay flat", () => {
  const single = Object.entries(ENC.stages)
    .filter(([, v]) => !v.groups || v.groups.length < 2).slice(0, 20);
  assert.ok(single.length > 0);
  for (const [id, s] of single) {
    assert.equal(encounterGroupIndex(s, 0, 7), 0, `s${id}`);
    assert.equal(stageZoneBlocks(s, 0, 7), undefined, `s${id}`);
  }
});

test("a family-B stage actually yields different monsters per entrance", () => {
  // The point of the whole change: same map, same zone, same rand slot, different door.
  const s = stage(825);
  const seen = new Set();
  for (const key of s.groups.map((g) => g.key)) {
    for (let zone = 1; zone <= 4; zone++) {
      const scr = selectScreenId(s.zones, zone, slot0, stageZoneBlocks(s, 0, key));
      if (scr) seen.add(`${key}:${zone}:${scr}`);
    }
  }
  const screensByKey = new Map();
  for (const key of s.groups.map((g) => g.key)) {
    const list = [];
    for (let zone = 1; zone <= 4; zone++)
      list.push(selectScreenId(s.zones, zone, slot0, stageZoneBlocks(s, 0, key)));
    screensByKey.set(key, JSON.stringify(list));
  }
  assert.ok(new Set(screensByKey.values()).size > 1,
    `s825 must not resolve every entrance to the same pools: ${[...screensByKey]}`);
});
