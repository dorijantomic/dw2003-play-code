// Card 06-card-limit: one exported card-id bound and one copy cap, everywhere.
// The bound is SAVE_CARD_MAX (0x13b), EXCLUSIVE: ids 1..314. The copy cap is
// COLLECTION_CAP (9), re-exported from save-block as SAVE_CARD_COPIES.
// Invented collection data only; no game files are read.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("save-block exports the exclusive card bound and the one copy cap", async () => {
  const sb = await import("../engine/dw3/save-block.ts");
  assert.equal(sb.SAVE_CARD_MAX, 0x13b);
  assert.equal(sb.SAVE_CARD_COPIES, 9);
  const bb = await import("../engine/systems/card-battle.ts");
  assert.equal(sb.SAVE_CARD_COPIES, bb.COLLECTION_CAP);
});

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\/\/[^\n"']*$/gm, "");

test("no screen keeps a private copy of the card bound", () => {
  const files = [
    "engine/dw3/ui/folder-session.ts",
    "engine/dw3/ui/card-shop-session.ts",
    "engine/dw3/ui/native/album-grid.ts",
    "engine/dw3/ui/native/folder-card-grid.ts",
    "engine/native/bridge.ts",
    "web/cardalbum-native.js",
    "web/carddeck-native.js",
    "web/cardduel-native.js",
    "web/cardshop-native.js",
    "web/status-native.js",
  ];
  for (const f of files) {
    const src = stripComments(read(f));
    assert.ok(!/0x13b/i.test(src), `${f} still spells the bound as a literal`);
    assert.ok(
      /SAVE_CARD_MAX/.test(src),
      `${f} does not use the shared SAVE_CARD_MAX`,
    );
  }
});

test("no screen keeps a private copy of the copy cap", () => {
  for (const f of ["web/carddeck-native.js", "web/cardduel-native.js", "web/cardshop-native.js", "web/status-native.js"]) {
    const src = read(f);
    assert.ok(!/CARD_COPIES_MAX/.test(src), `${f} still has its own copy cap`);
    assert.ok(/COLLECTION_CAP/.test(src), `${f} does not use COLLECTION_CAP`);
  }
});

test("the folder editor's save write cannot store more than the cap", () => {
  const src = read("engine/dw3/ui/folder-session.ts");
  assert.ok(
    /Math\.min\(\s*SAVE_CARD_COPIES\s*,/.test(src),
    "folder-session.ts writes the owned count without the 9-copy clamp",
  );
  assert.ok(!/count \& 0xff/.test(src), "folder-session.ts still masks the count with 0xff");
});
