import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const font = JSON.parse(readFileSync("web/assets/ui/uifont.json", "utf8"));

test("CMFONT banks 1, 2 and 3 are extracted", () => {
  assert.deepEqual(Object.keys(font.kinds).sort(), ["1", "2", "3"]);
  assert.equal(font.kinds["1"].basic["10"].h, 12);
  assert.equal(font.kinds["2"].basic["10"].h, 9);
  assert.ok(font.kinds["3"].basic["10"]);
});

test("kind-1 CLUT offset 1 is the cyan face and offset 4 is green", () => {
  const rows = font.cluts["1"].rows;
  assert.equal(font.cluts["1"].y, 232);
  assert.deepEqual(rows["1"][2], [56, 184, 248, 255]);
  assert.deepEqual(rows["4"][2], [56, 200, 112, 255]);
});

test("drawText accepts a clut offset", () => {
  const src = readFileSync(new URL("../web/uifont.js", import.meta.url), "utf8");
  assert.match(src, /sheetForClut\(kind, clut\)/);
});
