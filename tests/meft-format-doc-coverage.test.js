import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const census = JSON.parse(readFileSync("docs/research/field/meft-pack-tag-census.json", "utf8"));
const doc = readFileSync("docs/research/field/map-effects-meft.md", "utf8");

test("every pack tag in the census has a documented format section", () => {
  const tags = new Set();
  for (const entries of Object.values(census)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) tags.add(e.tag);
  }
  for (const tag of tags) {
    const hex = "0x" + tag.toString(16);
    assert.ok(doc.includes(hex), `tag ${hex} has no section in map-effects-meft.md`);
  }
});
