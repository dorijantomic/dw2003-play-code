// Regression test for the stgtrain drill-icon frame table (docs/research/ui/
// stgtrain-decoded-2026-07-11.md), read live from RAM 2026-07-12 (rig
// savestate 9, %APPDATA%/Roaming/pcsx-redux/SLES03936.sstate9) since static
// disasm alone could not resolve it (the table pointer at 0x8008cfcc+0x2dc
// has no writer in any of the six overlays that reference it).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const layout = JSON.parse(readFileSync(path.join(ROOT, "web/assets/data/stgtrain_ui.json"), "utf8"));
const sheet = JSON.parse(readFileSync(path.join(ROOT, "web/assets/ui/sttrng0_sheet.json"), "utf8"));
const DRILL_NAMES = [null,
  "Punch", "Defense", "Yoga", "Study", "Jump Rope",
  "Heat Tolerance", "Water Tolerance", "Ice Tolerance", "Wind Tolerance",
  "Thunder Defense", "Missile Defense", "Haunting",
  "Super Punch", "Super Defense", "Super Yoga", "Super Study", "Super Jump Rope",
  "S Heat Tolerance", "S Water Tolerance", "S Ice Tolerance", "S Wind Tolerance",
  "S Thunder Defense", "Super Missile DF", "Super Haunting",
];

test("drill icon frame table covers every raw drill id 19-42 exactly once", () => {
  const frames = layout.drill_icon_grid.frames;
  const ids = Object.keys(frames).map(Number).sort((a, b) => a - b);
  assert.deepEqual(ids, Array.from({ length: 24 }, (_, i) => 19 + i));
});

test("every drill icon frame table entry has 4 distinct clip ids that exist in sttrng0_sheet.json", () => {
  const frames = layout.drill_icon_grid.frames;
  for (const [drillId, clips] of Object.entries(frames)) {
    assert.equal(clips.length, 4, `drill ${drillId} should have 4 anim frames`);
    assert.equal(new Set(clips).size, 4, `drill ${drillId} frames should be distinct`);
    for (const c of clips) assert.ok(sheet[String(c)], `clip ${c} (drill ${drillId}) missing from sttrng0_sheet.json`);
  }
});

test("compact-index drill name for drill 20 is Defense (matches the rig screenshot cross-check)", () => {
  // Raw RAM word0=20 (0x14) -> compact index 20-18=2 -> DRILL_NAMES[2].
  assert.equal(DRILL_NAMES[20 - 18], "Defense");
  assert.deepEqual(layout.drill_icon_grid.frames["20"], [4, 5, 6, 7]);
});
