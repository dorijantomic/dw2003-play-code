// The card-battle screens the ordinary-route measurement once named
// interpreter-reachable — the Card Album (pro/stcrdabm), the folder editor
// (pro/stcrddek) and the card duel (pro/cardgame). The Card Album and the folder
// editor are now CONVERTED: the translated AlbumSession and FolderSession compose
// their lane-b fragments over the shared shop services, the ordinary route runs
// them (web/game.js), and the audit measures stcrdabm and stcrddek as "ours"
// (proof: tests/album-execution-forbidden.test.js,
// tests/folder-execution-forbidden.test.js, tools/verify_translated_album.mjs,
// tools/verify_translated_folder.mjs). The card duel still builds the original
// overlay on its ordinary route; its match is un-ported.
//
// This file freezes two properties: the translated lane-b fragments reach NO
// engine/native module at all, so a future session that bundles them cannot
// smuggle in engine/native/runtime.ts; and the frozen audit's classes are what
// they are today (album and folder ours, duel interpreter-reachable), so a
// change that silently flips a class without a translated route is caught. The
// negative control proves the check can see the interpreter whenever a graph
// does link it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

/** The engine/native modules a bundle of these entry points can reach. */
async function nativeInputs(entryPoints) {
  const result = await build({ entryPoints, outdir: "/tmp/ui-chrome-execution-forbidden",
    bundle: true, write: false, metafile: true, format: "esm" });
  return Object.keys(result.metafile.inputs)
    .filter((path) => path.startsWith("engine/native/"))
    .sort();
}

// The translated album fragments (lane-b + the shared album-residue body).
const ALBUM_FRAGMENTS = [
  "engine/dw3/ui/native/album-lifecycle.ts",
  "engine/dw3/ui/native/album-tick.ts",
  "engine/dw3/ui/native/album-grid-object.ts",
  "engine/dw3/ui/native/album-grid.ts",
  "engine/dw3/ui/native/album-cells-draw.ts",
  "engine/dw3/ui/native/album-panel.ts",
  "engine/dw3/ui/native/album-banks.ts",
  "engine/dw3/ui/album-residue.ts",
];

// The translated folder-editor fragments.
const FOLDER_FRAGMENTS = [
  "engine/dw3/ui/native/folder-screen.ts",
  "engine/dw3/ui/native/folder-lifecycle.ts",
  "engine/dw3/ui/native/folder-picker-tick.ts",
  "engine/dw3/ui/native/folder-banks.ts",
  "engine/dw3/ui/folder-list-create.ts",
  "engine/dw3/ui/folder-list-row.ts",
  "engine/dw3/ui/folder-list-colours.ts",
];

test("the translated album fragments link no interpreter module", async () => {
  const native = await nativeInputs(ALBUM_FRAGMENTS);
  assert.deepEqual(native, [],
    "the album fragments must not reach an interpreter, bridge or loader");
});

test("the translated folder fragments link no interpreter module", async () => {
  const native = await nativeInputs(FOLDER_FRAGMENTS);
  assert.deepEqual(native, [],
    "the folder fragments must not reach an interpreter, bridge or loader");
});

test("the interpreter check detects the interpreter when a graph links one", async () => {
  // Negative control: bundling an interpreter module must surface it. This
  // pins the filter itself, independent of the production barrel, which since
  // the 2026-10-06 bundle split no longer reaches the interpreter (the research
  // entry engine/native-entry.ts does).
  const flagged = await nativeInputs(["engine/native/runtime.ts"]);
  assert.ok(flagged.includes("engine/native/runtime.ts") && flagged.includes("engine/native/mips.ts"),
    `expected the interpreter when bundling it, saw ${JSON.stringify(flagged)}`);
});

test("the audit measures the Card Album and folder editor converted and the duel still interpreter-reachable", () => {
  // The Album and folder editor ordinary routes now run our composed sessions;
  // the card duel still builds the original overlay. The frozen audit must keep
  // saying so — a change that silently flips a class without a translated route
  // is the drift the measurement exists to catch.
  const audit = JSON.parse(readFileSync(new URL("../tools/execution-forbidden-audit.json", import.meta.url), "utf8"));
  const album = audit.surfaces.find((s) => s.id === "stcrdabm");
  assert.ok(album, "the Card Album is in the frozen audit");
  assert.equal(album.class, "ours", "the Card Album's ordinary route runs the translated session");
  assert.equal(album.entry, "engine/dw3/ui/album-session.ts", "the album's measured entry is the session");
  assert.deepEqual(album.forbidden, [], "the album reaches no forbidden native module");

  const folder = audit.surfaces.find((s) => s.id === "stcrddek");
  assert.ok(folder, "the folder editor is in the frozen audit");
  assert.equal(folder.class, "ours", "the folder editor's ordinary route runs the translated session");
  assert.equal(folder.entry, "engine/dw3/ui/folder-session.ts", "the folder's measured entry is the session");
  assert.deepEqual(folder.forbidden, [], "the folder reaches no forbidden native module");
  assert.equal(folder.reference && folder.reference.flag, "nativeFolder", "the overlay survives only behind ?nativeFolder=1");

  const duel = audit.surfaces.find((s) => s.id === "cardgame");
  assert.ok(duel, "the card duel is in the frozen audit");
  assert.equal(duel.class, "interpreter-reachable", "the card duel's ordinary route still runs the original overlay");
  assert.ok(duel.forbidden.includes("engine/native/runtime.ts"),
    "cardgame reaches engine/native/runtime.ts today, so it has no translated route");

  // The six system rows too: card-battle and ui-chrome are mixed, and each names
  // its card-screen surfaces rather than collapsing to one class.
  for (const id of ["system:card-battle", "system:ui-chrome"]) {
    const system = audit.surfaces.find((s) => s.id === id);
    assert.ok(system, `${id} is in the frozen audit`);
    assert.equal(system.class, "ours", `${id}: own routes run our code`);
    const components = system.components ?? [];
    assert.ok(components.some((c) => /duel/.test(c.id) && c.class === "interpreter-reachable"),
      `${id} must name its card duel surface as interpreter-reachable`);
    assert.ok(components.some((c) => /album/.test(c.id) && c.class === "ours"),
      `${id} must name its Card Album surface as ours`);
    assert.ok(components.some((c) => /folder/.test(c.id) && c.class === "ours"),
      `${id} must name its folder editor surface as ours`);
  }
});
