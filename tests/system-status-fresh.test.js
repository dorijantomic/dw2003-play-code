// The System Status page (web/systems.html) must match the research records it
// is built from. When this fails, run: node tools/build_system_status.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { renderSystemStatus } from "../tools/build_system_status.mjs";

test("the system status page data matches the ledger, catalog, ownership report and progress list", () => {
  const committed = readFileSync("web/system-status.json", "utf8");
  assert.ok(committed === renderSystemStatus(), "web/system-status.json is stale. Run: node tools/build_system_status.mjs");
});

test("every shared engine file and every catalog-named file is accounted for", () => {
  const data = JSON.parse(readFileSync("web/system-status.json", "utf8"));
  assert.deepEqual(data.catalogGaps.unclaimedEngine, [], "name each engine/systems file under its system in docs/research/systems/catalog.json");
  assert.deepEqual(data.systems.filter((s) => s.gaps.missingFiles.length).map((s) => [s.id, s.gaps.missingFiles]), []);
});

// A shared engine service with no system under it is a gap in the records: the
// page has to be able to say which system owns each file of ours, so a new
// engine/systems/*.ts fails here until its `owns` glob is added to the catalog.
// This reads the builder's own output, not the committed file, so it cannot be
// satisfied by a file that is merely stale-but-newer.
test("every shared engine service is owned by a catalog system", () => {
  const data = JSON.parse(renderSystemStatus());
  const owned = new Set(data.systems.flatMap((s) => s.ownedFiles));
  const shared = readdirSync("engine/systems").filter((f) => f.endsWith(".ts")).map((f) => `engine/systems/${f}`);
  const orphans = shared.filter((p) => !owned.has(p));
  assert.deepEqual(orphans, [], `no catalog system owns these; add them to a system's owns list in docs/research/systems/catalog.json: ${orphans.join(", ")}`);
});
