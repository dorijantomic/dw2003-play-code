// Post-game trigger chain (plan section 4 post-game row / POST-Q001).
//
// Two claims are pinned here as one model:
//   POST-CL-002: s820 advances the master story ordinal to 0x2b (43) and the
//   s780 reunion event advances it to the terminal 0x2d (45) -- both setters now
//   read from raw wstag assembly (evidence POST-EV-012/013 and POST-EV-006..008).
//   POST-CL-001: fieldstg's screen-table loader re-bases on exactly 0x2d, which
//   the walker mirrors as screenRouter's useAlt gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nextProgressOrdinal, createScreenRouter } from "../engine/index.ts";

const content = JSON.parse(readFileSync("web/assets/engine-content.json", "utf8"));
const table = JSON.parse(readFileSync("data/screen_table.json", "utf8"));

test("s820 raises the ordinal to 43 and s780 to the post-game marker 45", () => {
  const { allOrdinals, byStage } = content.ordinal;
  assert.ok(byStage.s820?.includes(43), `s820 ladder: ${JSON.stringify(byStage.s820)}`);
  assert.ok(byStage.s780?.includes(45), `s780 ladder: ${JSON.stringify(byStage.s780)}`);
  assert.equal(nextProgressOrdinal(42, byStage.s820, allOrdinals), 43);
  assert.equal(nextProgressOrdinal(43, byStage.s780, allOrdinals), 45);
  // A replay after the beat cannot move the ordinal or skip ahead.
  assert.equal(nextProgressOrdinal(43, byStage.s820, allOrdinals), 43);
  assert.equal(nextProgressOrdinal(45, byStage.s780, allOrdinals), 45);
});

test("only ordinal 45 flips the 55 shadowed maps to their alias stage", () => {
  const alts = Object.entries(table).filter(([, rec]) => rec?.alt?.stage != null);
  assert.equal(alts.length, 55, "the alias table must cover all 55 shadowed maps");

  let ordinal = 44;
  const router = createScreenRouter(table, { useAlt: () => ordinal === 0x2d });
  for (const [id, rec] of alts) {
    assert.equal(router.route(Number(id))?.to, `s${rec.stage}`,
      `screen ${id}: ordinal 44 must stay in the base world`);
  }
  ordinal = 45;
  for (const [id, rec] of alts) {
    const to = router.route(Number(id))?.to;
    assert.equal(to, `s${rec.alt.stage}`, `screen ${id}: ordinal 45 must use the alias`);
    const stage = Number(String(to).slice(1));
    assert.ok(stage >= 920 && stage <= 974, `screen ${id}: alias ${to} outside s920-s974`);
  }
});
