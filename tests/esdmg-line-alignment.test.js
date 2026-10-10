// Every cutscene SAY line must resolve to a real string in its own ESDMG entry.
//
// THE FAULT (operator, 2026-10-07, the Asuka City Digimon Lab): "that same navi's text bar
// appears but shows no text at all". The Digimon Navi's info scene (s220 event 53, esdmg200
// entry 13) ends with `SAY 0 7 36 2` — "That's all of the information. Well, good luck!". The
// cutscene manager resolves a SAY line as `_strings[p1 - 1]`
// (engine/systems/cutscene-manager.ts:412; the disc's raw line 0 is always empty, so removing
// the placeholder is exactly the -1). `build_esdmg.py` ALSO dropped every interior `"a"`
// filler, which shifts every line after it: esdmg200 entry 13 has a filler at raw index 6, so
// the walker looked for `strings[6]` in a 6-item list, found nothing, and SKIPPED the closing
// line — the beat showed no text and the scene ran on.
//
// THE RULE. A SAY operand is a DIRECT index into the disc's raw string list. Our JSON may drop
// only the leading placeholder, never an interior filler, or the index no longer lines up. This
// test walks every shipped cutscene event and fails on any SAY line that reads past its entry
// or lands on a blank string. It fails on the pre-fix content (esdmg200/13 p1=7) and passes
// after, and it stops the same mistake in any other stage.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("..", import.meta.url);
const readJson = (p) => JSON.parse(readFileSync(new URL(p, ROOT), "utf8"));

const wstag = readJson("web/assets/events/wstag_events.json");
const cache = new Map();
const esdmg = (stage) => {
  if (!cache.has(stage)) {
    let data = null;
    try { data = readJson(`web/assets/events/esdmg${stage}.json`); } catch { data = null; }
    cache.set(stage, data);
  }
  return cache.get(stage);
};

test("every cutscene SAY line resolves to a real string in its ESDMG entry", () => {
  const bad = [];
  for (const [mapId, events] of Object.entries(wstag)) {
    for (const e of events) {
      const says = (e.disasm ?? []).filter((l) => String(l).startsWith("SAY "));
      if (!says.length) continue;
      const stage = e.esdmg_stage, entry = e.esdmg_entry;
      if (stage == null || entry == null) continue;
      const data = esdmg(stage);
      const rec = data?.[String(entry)];
      if (!rec || rec.type !== "cutscene") continue;
      const strings = rec.strings ?? [];
      for (const line of says) {
        const p1 = Number(String(line).split(/\s+/)[2]);
        if (!(p1 >= 1)) continue;                 // p1 0 is a decode artifact, not a line
        const s = strings[p1 - 1];
        if (typeof s !== "string" || s === "")
          bad.push(`${mapId} event ${e.id} (esdmg${stage}[${entry}]) SAY p1=${p1} has no string (entry has ${strings.length})`);
      }
    }
  }
  assert.deepEqual(bad, [], `SAY lines reading past their entry:\n${bad.join("\n")}`);
});

test("the Digimon Navi's closing line is present (esdmg200 entry 13, SAY p1=7)", () => {
  const rec = readJson("web/assets/events/esdmg200.json")["13"];
  assert.equal(rec.type, "cutscene");
  // raw list: 0 placeholder, 1..5 the info pages, 6 the "a" filler, 7 the close. Only the
  // placeholder is dropped, so strings[6] (p1-1 for p1=7) must be the closing line.
  assert.ok(rec.strings[6]?.includes("That's all of the"),
    `expected the closing line at strings[6], got ${JSON.stringify(rec.strings[6] ?? null)}`);
});
